import { ProjectSkillStore, PROJECT_SKILL_ROOTS, hasDeliverableStatus, trackedSkillPaths } from './project-skills.js'
import { createWorktree } from './worktree-creation.js'
import { gitTimeoutMs, validateGitTimeouts, type GitTimeoutOptions } from './git-options.js'
import { initialCommitActions, type GitCommitProtocol } from './initial-commit.js'
import { hostMessage } from '../i18n/host.js'
/**
 * DSH adapter for the session-checkout git port: runs git through
 * `ctx.subprocess` (tree-scoped termination, bounded collected output,
 * scrubbed ambient environment) with Domi's hardening preserved — disabled
 * git hooks, no optional locks, no terminal prompts, C locale, and a 5-minute
 * hard cap for worktree removal on Windows. Internal refs use the
 * `refs/dsh-worktree/session-checkouts/<key>` namespace so plugin artifacts
 * never collide with user refs.
 *
 * Deliberate divergence from the official experimental worktree service: that
 * service resolves `sandboxPolicy` per call and wraps git in `sandbox.confine`
 * (`packages/experimental/worktree/src/process.ts:52-54`). This plugin cannot
 * copy that — a managed checkout lives OUTSIDE the session workspace
 * (worktreesRoot is a sibling tree), so a workspace-write confinement around
 * `git worktree add` would deny the very directory the plugin was asked to
 * create. Session file-policy enforcement stays where it belongs: the Host's
 * own file/shell tools. See CHANGELOG for the reasoning trail.
 * @module dsh-git-worktree/adapters/git
 */

import { createHash } from 'node:crypto'
import { realpath, lstat, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import type { ApplyConflictDetail, MergeLocalBranchResult } from '../types.js'
import { CONFLICT_DETAIL_DIFF_LIMIT, CONFLICT_DETAIL_FILE_LIMIT } from '../types.js'
import type { GitCheckoutSnapshot, SessionCheckoutGitPort } from '../ports.js'
import { SessionCheckoutError } from '../index.js'

/** Termination grace is separate from the command deadline. */
const GIT_TERMINATION_GRACE_MS = 1_000
/** Collected-output cap per stream; git output is small but removals can warn. */
const GIT_COLLECT_BYTES = 1 << 20
/** Binary WIP patches can legitimately exceed the default cap (base85 inflation). */
const WIP_PATCH_COLLECT_BYTES = 16 << 20
/**
 * `status` is the one read whose size is set by the repository, not by git:
 * `--untracked-files=all` prints one record per untracked file, and a single
 * un-ignored dependency tree (a venv, a build cache) produces megabytes of
 * them. A 1 MiB cap turned that into a hard "cannot read the repository"
 * failure on every 5s poll, so status gets the wide cap.
 */
const STATUS_COLLECT_BYTES = 16 << 20
/**
 * Untracked modes for `status`, most precise first. `all` lists every file;
 * `normal` lists an untracked directory as one record, which turns an
 * un-ignored dependency tree from megabytes into bytes without hiding tracked
 * edits, renames, or deletions.
 */
const STATUS_UNTRACKED_MODES = ['all', 'normal'] as const

export interface GitPortOptions extends GitTimeoutOptions {
  /** Directory holding the empty `core.hooksPath` target; created by the caller. */
  hooksPath: string
  projectSkills?: ProjectSkillStore
}

interface GitCommandResult {
  code: number
  stdout: string
  stderr: string
  /** Only true after the subprocess service confirmed whole-tree quiescence. */
  quiescent?: boolean
  /**
   * The collected stream exceeded its in-memory cap, so the text is a partial
   * tail. Callers that can answer with less output must retry narrower instead
   * of reporting a repository failure.
   */
  truncated?: boolean
}

/**
 * `%D` decoration → ref names. Tag refs keep a `tag:` marker so the client can
 * style them apart from branches; the HEAD handoff prefix is dropped and a
 * bare detached `HEAD` entry is not a ref.
 */
function parseDecoration(decoration: string): string[] {
  if (decoration === '') return []
  return decoration.split(', ').map((part) => {
    const trimmed = part.trim()
    if (trimmed === 'HEAD') return ''
    if (trimmed.startsWith('tag: ')) return `tag:${trimmed.slice('tag: '.length).trim()}`
    return trimmed.replace(/^HEAD -> /u, '').trim()
  }).filter((name) => name !== '')
}

async function settleCreationTree(handle: SubprocessHandle): Promise<boolean> {
  if (typeof handle.waitForExit !== 'function' || typeof handle.terminate !== 'function') return false
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  timeout.unref?.()
  try {
    handle.terminate()
    return await handle.waitForExit(controller.signal)
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Run one git command through `ctx.subprocess`. Returns an outcome object —
 * the caller decides whether a non-zero exit is an error. Never
 * shell-interpreted; argv passes verbatim.
 */
async function runGit(ctx: Context, cwd: string, args: string[], options: GitPortOptions, input?: string | GitCommitProtocol, creation?: { deadline: number }, collectBytes?: number): Promise<GitCommandResult> {
  const graceMs = creation ? creation.deadline - Date.now() : gitTimeoutMs(args, options)
  if (creation && graceMs <= 0) return { code: -1, stdout: '', stderr: hostMessage('gitTimedOutMsAndWasTerminated', { p0: args.join(' '), p1: 0 }), quiescent: true }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), graceMs)
  timeout.unref?.()
  let handle: SubprocessHandle | undefined
  try {
    handle = ctx.subprocess.spawn({
      argv: [
        'git',
        '--no-pager',
        '--no-optional-locks',
        // Worktree prefixes can exceed MAX_PATH even when the source checkout fits.
        ...(process.platform === 'win32' ? ['-c', 'core.longpaths=true'] : []),
        '-c', 'core.quotePath=false',
        '-c', 'core.fsmonitor=false',
        '-c', `core.hooksPath=${options.hooksPath}`,
        ...args,
      ],
      cwd,
      stdio: {
        stdin: input === undefined ? 'ignore' : 'pipe',
        stdout: { maxBytes: collectBytes ?? GIT_COLLECT_BYTES },
        stderr: { maxBytes: GIT_COLLECT_BYTES },
      },
      graceMs: GIT_TERMINATION_GRACE_MS,
      signal: controller.signal,
      env: {
        // Repository routing must come from the authorized cwd, never ambient Git
        // overrides. Preserve identity variables and normal user configuration.
        ...Object.fromEntries(Object.keys(process.env).filter(key =>
          /^(GIT_(DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|CEILING_DIRECTORIES|DISCOVERY_ACROSS_FILESYSTEM|CONFIG_PARAMETERS|CONFIG_COUNT|CONFIG_KEY_.*|CONFIG_VALUE_.*))$/i.test(key),
        ).map(key => [key, undefined])),
        GIT_OPTIONAL_LOCKS: '0',
        GIT_TERMINAL_PROMPT: '0',
        LC_ALL: 'C',
        LANG: 'C',
      },
    })
    if (input !== undefined) {
      handle.stdin?.on('error', () => { /* Exit status reports a closed Git protocol pipe. */ })
      if (typeof input === 'string') handle.stdin?.end(input)
      else {
        handle.stdin?.write(input.prepare)
        let exited = false
        void handle.done.then(() => { exited = true })
        while (!exited && !controller.signal.aborted && !handle.collected.stdout?.readFrom(0).text.includes('prepare: ok')) {
          await new Promise(resolve => setTimeout(resolve, 5))
        }
        if (!exited && !controller.signal.aborted) {
          try {
            await input.beforeCommit()
            handle.stdin?.end('commit\n')
          } catch (error) {
            handle.stdin?.end('abort\n')
            await handle.done
            throw error
          }
        } else handle.stdin?.end()
      }
    }
    const outcome = await handle.done
    let quiescent: boolean | undefined
    if (creation) {
      let completed = false
      if (outcome.exitCode === 0 && !outcome.signal && !controller.signal.aborted && typeof handle.waitForExit === 'function') {
        try { completed = await handle.waitForExit(controller.signal) } catch { /* Preserve unless termination is confirmed below. */ }
      }
      if (completed && !controller.signal.aborted) quiescent = true
      else {
        quiescent = await settleCreationTree(handle)
        if (outcome.exitCode === 0) return { code: -1, stdout: '', stderr: hostMessage('repositoryInspectionFailed'), quiescent }
      }
      if (!quiescent) return { code: -1, stdout: '', stderr: hostMessage('repositoryInspectionFailed'), quiescent: false }
    }
    clearTimeout(timeout)
    const stdoutRead = handle.collected.stdout?.readFrom(0)
    const stderrRead = handle.collected.stderr?.readFrom(0)
    const stdout = stdoutRead?.text ?? ''
    const stderr = stderrRead?.text ?? ''
    if (stdoutRead?.lossy || stderrRead?.lossy) {
      // Reported as truncated rather than fatal: a partial tail is enough for
      // "is anything uncommitted?" (see `status`), and callers that need the
      // whole stream retry with a shape that produces less of it.
      return { code: -1, stdout: '', stderr: hostMessage('repositoryInspectionFailed'), quiescent, truncated: true }
    }
    if (outcome.signal === 'SIGTERM' || outcome.signal === 'SIGKILL' || controller.signal.aborted) {
      return { code: -1, stdout, stderr: hostMessage('gitTimedOutMsAndWasTerminated', { p0: args.join(' '), p1: graceMs }), quiescent }
    }
    return { code: outcome.exitCode ?? -1, stdout: stdout.trim(), stderr: stderr.trim(), quiescent }
  } catch (error) {
    if (error instanceof SessionCheckoutError) throw error
    const quiescent = creation && handle ? await settleCreationTree(handle) : false
    return { code: -1, stdout: '', stderr: error instanceof Error ? error.message : String(error), quiescent }
  } finally {
    clearTimeout(timeout)
  }
}

async function runGitChecked(ctx: Context, cwd: string, args: string[], options: GitPortOptions, collectBytes?: number): Promise<string> {
  const result = await runGit(ctx, cwd, args, options, undefined, undefined, collectBytes)
  if (result.code !== 0) {
    throw new SessionCheckoutError(
      'git_operation_failed',
      hostMessage('gitOperationFailedGit', { p0: args.join(' '), p1: result.stderr ? `: ${result.stderr}` : '' }),
    )
  }
  return result.stdout
}

function checkoutRefRoot(checkoutId: string): string {
  const key = createHash('sha256').update(checkoutId).digest('hex').slice(0, 24)
  return `refs/dsh-worktree/session-checkouts/${key}`
}

function assertArtifactName(artifactName: string): void {
  const segments = artifactName.split('/')
  if (
    segments.length === 0
    || segments.some((segment) => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment))
  ) {
    throw new SessionCheckoutError('invalid_input', hostMessage('invalidInternalGitArtifactName'))
  }
}

function internalArtifactRef(checkoutId: string, artifactName: string): string {
  assertArtifactName(artifactName)
  return `${checkoutRefRoot(checkoutId)}/${artifactName}`
}

function applyBaseRef(checkoutId: string): string {
  return internalArtifactRef(checkoutId, 'apply-base')
}

/**
 * Abandoned-snapshot refs live OUTSIDE checkoutRefRoot on purpose: the discard
 * flow releases the whole per-checkout artifact namespace, which must not take
 * the freshly written safety snapshot with it.
 */
function abandonedSnapshotRef(checkoutId: string): string {
  assertArtifactName(checkoutId)
  return `refs/dsh-worktree/abandoned/${checkoutId}`
}

async function hasGitMetadata(root: string): Promise<boolean> {
  let directory = resolve(root)
  for (;;) {
    try { await lstat(join(directory, '.git')); return true }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return true
    }
    const parent = dirname(directory)
    if (parent === directory) return false
    directory = parent
  }
}

/** Build the `ctx.subprocess`-backed git port. */
export function createDshGitPort(ctx: Context, options: GitPortOptions): SessionCheckoutGitPort {
  validateGitTimeouts(options)
  const projectSkills = options.projectSkills ?? new ProjectSkillStore(join(dirname(options.hooksPath), 'project-skills'))
  const runSessionGit = (cwd: string, args: string[], input?: string | GitCommitProtocol) => runGit(ctx, cwd, args, options, input)
  const runSessionGitChecked = (cwd: string, args: string[]) => runGitChecked(ctx, cwd, args, options)

  /**
   * One `git status --porcelain=v1 -z` read, widening only as far as the
   * collected stream allows. `all` is the only precise mode, so it stays
   * first; `normal` collapses untracked directories into one record each,
   * which is what keeps a tree with tens of thousands of untracked files
   * readable. Returns `null` when even the narrowest mode overflows, and the
   * failed result unchanged for a genuine Git error.
   */
  const runStatus = async (root: string): Promise<GitCommandResult | null> => {
    for (const untracked of STATUS_UNTRACKED_MODES) {
      const result = await runGit(ctx, root, ['status', '--porcelain=v1', '-z', `--untracked-files=${untracked}`], options, undefined, undefined, STATUS_COLLECT_BYTES)
      if (result.code === 0 || !result.truncated) return result
    }
    return null
  }

  const port: SessionCheckoutGitPort = {
    inspect: async (root): Promise<GitCheckoutSnapshot | null> => {
      // 单次 rev-parse 同时取全部位置事实，symbolic-ref 并行补分支；顺序逐项
      // 读取保留为 unborn/broken HEAD 与换行路径歧义时的回退。
      const symbolicPromise = runSessionGit(root, ['symbolic-ref', '--quiet', 'HEAD'])
      symbolicPromise.catch(() => undefined)
      const combined = await runSessionGit(root, [
        'rev-parse', '--show-toplevel', '--path-format=absolute', '--git-common-dir', '--absolute-git-dir', 'HEAD^{commit}',
      ])
      if (combined.code === 0 && combined.stdout) {
        const lines = combined.stdout.split('\n')
        if (lines.length === 4) {
          const symbolic = await symbolicPromise
          const headRef = symbolic.code === 0 && symbolic.stdout ? symbolic.stdout : 'HEAD'
          const branch = headRef.startsWith('refs/heads/') ? headRef.slice('refs/heads/'.length) : null
          return {
            root: await realpath(resolve(lines[0]!)),
            commonDir: await realpath(resolve(lines[1]!)),
            gitDir: await realpath(resolve(lines[2]!)),
            branch,
            headOid: lines[3]!,
            headRef,
          }
        }
      } else if (combined.code === 128 && /^fatal: not a git repository/.test(combined.stderr) && !await hasGitMetadata(root)) {
        return null
      }
      const topLevel = await runSessionGit(root, ['rev-parse', '--show-toplevel'])
      if (topLevel.code !== 0 || !topLevel.stdout) {
        if (topLevel.code === 128 && /^fatal: not a git repository/.test(topLevel.stderr) && !await hasGitMetadata(root)) return null
        throw new SessionCheckoutError('git_operation_failed', hostMessage('repositoryInspectionFailed'))
      }
      // Both paths come from the same fresh Git invocation. Do not cache across
      // operations: the worktree/common-directory identity is a safety boundary.
      const paths = (await runSessionGitChecked(root, [
        'rev-parse', '--path-format=absolute', '--git-common-dir', '--absolute-git-dir',
      ])).split('\n')
      // Newlines are legal in POSIX paths; retain the unambiguous single-value
      // reads when the multi-value output cannot be parsed safely.
      const commonDir = paths.length === 2 ? paths[0]!
        : await runSessionGitChecked(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
      const gitDir = paths.length === 2 ? paths[1]!
        : await runSessionGitChecked(root, ['rev-parse', '--path-format=absolute', '--absolute-git-dir'])
      const head = await runSessionGit(root, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'])
      let headOid = head.stdout
      if (head.code !== 0) {
        const symbolicHead = await runSessionGit(root, ['symbolic-ref', '--quiet', 'HEAD'])
        const refs = await runSessionGit(root, ['show-ref'])
        // A missing commit is unborn only with a valid symbolic HEAD and no refs.
        // Broken refs, unreadable metadata, and missing objects remain Git errors.
        if (head.code !== 1 || symbolicHead.code !== 0 || !symbolicHead.stdout.startsWith('refs/heads/')
          || refs.code !== 1 || refs.stdout || refs.stderr) {
          throw new SessionCheckoutError('git_operation_failed', hostMessage('repositoryInspectionFailed'))
        }
        headOid = 'unborn'
      }
      const symbolic = await runSessionGit(root, ['symbolic-ref', '--quiet', 'HEAD'])
      const headRef = symbolic.code === 0 && symbolic.stdout ? symbolic.stdout : 'HEAD'
      const branch = headRef.startsWith('refs/heads/') ? headRef.slice('refs/heads/'.length) : null
      return {
        root: await realpath(resolve(topLevel.stdout)),
        commonDir: await realpath(resolve(commonDir)),
        gitDir: await realpath(resolve(gitDir)),
        branch,
        headOid,
        headRef,
      }
    },
    findContainingWorktreeRoot: async (root) => {
      const topLevel = await runSessionGit(root, ['rev-parse', '--show-toplevel'])
      if (topLevel.code !== 0 || !topLevel.stdout) {
        if (topLevel.code === 128 && /^fatal: not a git repository/.test(topLevel.stderr) && !await hasGitMetadata(root)) return null
        throw new SessionCheckoutError('git_operation_failed', hostMessage('repositoryInspectionFailed'))
      }
      return realpath(resolve(topLevel.stdout))
    },
    status: async (root) => {
      const carried = await projectSkills.scope(root)
      const auxiliary = new Set(carried?.paths ?? [])
      const directories = carried?.directories ?? []
      const result = await runStatus(root)
      if (result === null) {
        throw new SessionCheckoutError('git_operation_failed', hostMessage('gitOperationFailedGit', {
          p0: 'status --porcelain=v1 -z --untracked-files=all',
          p1: `: ${hostMessage('repositoryInspectionFailed')}`,
        }))
      }
      if (result.code !== 0) {
        throw new SessionCheckoutError('git_operation_failed', hostMessage('gitOperationFailedGit', {
          p0: 'status --porcelain=v1 -z --untracked-files=all',
          p1: result.stderr ? `: ${result.stderr}` : '',
        }))
      }
      return { dirty: hasDeliverableStatus(result.stdout, auxiliary, directories) }
    },
    createDetachedWorktree: async (localRoot, managedRoot, baseOid, saveEvidence) => {
      const skills = await projectSkills.snapshot(localRoot)
      const changed = await runSessionGitChecked(localRoot, ['diff', '--name-only', '-z', baseOid, '--', ...PROJECT_SKILL_ROOTS])
        + await runSessionGitChecked(localRoot, ['diff', '--cached', '--name-only', '-z', baseOid, '--', ...PROJECT_SKILL_ROOTS])
      if (changed) throw new SessionCheckoutError('git_operation_failed', `Project Skills: commit or resolve local tracked Skill changes before creating a Worktree (${changed.split('\0').filter(Boolean).join(', ')})`)
      const deadline = Date.now() + gitTimeoutMs(['worktree', 'add'], options)
      await createWorktree(localRoot, managedRoot, baseOid,
        (cwd, args, creating) => runGit(ctx, cwd, args, options, undefined, creating ? { deadline }
          : args[0] === 'worktree' && ['move', 'remove'].includes(args[1] ?? '')
            ? { deadline: Date.now() + gitTimeoutMs(args, options) } : undefined),
        saveEvidence)
      await projectSkills.carry(skills, managedRoot)
    },
    removeWorktree: async (localRoot, managedRoot) => {
      // Git treats a reviewed-but-uncommitted final snapshot as modified/untracked;
      // the caller has already verified checkout identity and the full fingerprint.
      if (await projectSkills.paths(managedRoot)) {
        const index = await runSessionGitChecked(managedRoot, ['ls-files', '--stage', '-z'])
        const head = await runSessionGitChecked(managedRoot, ['ls-tree', '-r', '--name-only', '-z', 'HEAD'])
        await projectSkills.assertRemovable(managedRoot, trackedSkillPaths(index, head))
      }
      await runSessionGitChecked(localRoot, ['worktree', 'remove', '--force', managedRoot])
      await projectSkills.forget(managedRoot)
    },
    pruneWorktrees: async (localRoot) => {
      await runSessionGitChecked(localRoot, ['worktree', 'prune', '--expire', 'now'])
    },
    retainApplyBase: async (localRoot, checkoutId, oid) => {
      await runSessionGitChecked(localRoot, ['update-ref', applyBaseRef(checkoutId), oid])
    },
    releaseApplyBase: async (localRoot, checkoutId) => {
      await runSessionGitChecked(localRoot, ['update-ref', '-d', applyBaseRef(checkoutId)])
    },
    retainInternalArtifact: async (localRoot, checkoutId, artifactName, oid) => {
      await runSessionGitChecked(localRoot, ['update-ref', internalArtifactRef(checkoutId, artifactName), oid])
    },
    readInternalArtifact: async (localRoot, checkoutId, artifactName) => {
      const result = await runSessionGit(localRoot, ['rev-parse', '--verify', '--quiet', internalArtifactRef(checkoutId, artifactName)])
      if (result.code === 0 && result.stdout) return result.stdout
      if (result.code === 1) return null
      throw new SessionCheckoutError('git_operation_failed', result.stderr || hostMessage('cannotReadTheInternalGitArtifact'))
    },
    releaseInternalArtifacts: async (localRoot, checkoutId, artifactPrefix) => {
      const prefix = artifactPrefix
        ? internalArtifactRef(checkoutId, artifactPrefix)
        : `${checkoutRefRoot(checkoutId)}/`
      const output = await runSessionGitChecked(localRoot, ['for-each-ref', '--format=%(refname)', prefix])
      const refs = output.split(/\r?\n/).map((ref) => ref.trim()).filter(Boolean)
      if (refs.length === 0) return
      // 单次 spawn 事务删除全部 ref（原逐个 update-ref -d 为 1+N 次串行）。
      const result = await runSessionGit(localRoot, ['update-ref', '--stdin'], `start\n${refs.map((ref) => `delete ${ref}`).join('\n')}\ncommit\n`)
      if (result.code !== 0) throw new SessionCheckoutError('git_operation_failed', result.stderr || hostMessage('gitOperationFailedGit', { p0: 'update-ref', p1: '' }))
    },
    isAncestor: async (root, ancestorOid, descendantOid) => {
      const result = await runSessionGit(root, ['merge-base', '--is-ancestor', ancestorOid, descendantOid])
      if (result.code === 0) return true
      if (result.code === 1) return false
      throw new Error(result.stderr || hostMessage('cannotProveGitCommitAncestry'))
    },
    listLocalBranches: async (root) => {
      const output = await runSessionGitChecked(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])
      return output.split(/\r?\n/).map((branch) => branch.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b))
    },
    resolveLocalBranchTip: async (root, branch) => {
      const result = await runSessionGit(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])
      if (result.code === 0 && /^[0-9a-f]{40,64}$/iu.test(result.stdout)) return result.stdout
      if (result.code === 1) return null
      throw new SessionCheckoutError('git_operation_failed', result.stderr || hostMessage('repositoryInspectionFailed'))
    },
    attachWorktreeBranch: async (managedRoot, branchRef, headOid, expectedOldOid) => {
      // 只动 ref 与 HEAD 指向，绝不碰工作区：Worktree 的检出内容与分支的
      // 树必须完全一致，否则 `git status` 会凭空多出一堆改动。
      // CAS 语义：expectedOldOid 为 null 时只在分支不存在时创建（以全零为
      // 旧值），否则只允许从该提交推进，避免覆盖并发会话的提交。
      const zeroOid = '0'.repeat(headOid.length)
      const update = await runSessionGit(managedRoot, ['update-ref', branchRef, headOid, expectedOldOid ?? zeroOid])
      if (update.code !== 0) {
        throw new SessionCheckoutError(
          'git_operation_failed',
          update.stderr || hostMessage('gitOperationFailedGit', { p0: 'update-ref', p1: branchRef }),
        )
      }
      const symbolic = await runSessionGit(managedRoot, ['symbolic-ref', 'HEAD', branchRef])
      if (symbolic.code !== 0) {
        throw new SessionCheckoutError(
          'git_operation_failed',
          symbolic.stderr || hostMessage('gitOperationFailedGit', { p0: 'symbolic-ref', p1: branchRef }),
        )
      }
    },
    pushBranch: async (root) => {
      // Local adaptation: push the checked-out branch to its configured
      // upstream. Plain `git push` never rewrites remote history; a missing
      // upstream or rejected push is reported, never forced.
      const head = await runSessionGit(root, ['symbolic-ref', '--quiet', 'HEAD'])
      if (head.code !== 0 || !head.stdout.startsWith('refs/heads/')) {
        return { ok: false, message: hostMessage('pushSkippedNoLocalBranch') }
      }
      const branch = head.stdout.slice('refs/heads/'.length).trim()
      const upstream = await runSessionGit(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', `${branch}@{upstream}`])
      if (upstream.code !== 0 || !upstream.stdout) {
        return { ok: false, message: hostMessage('pushSkippedNoUpstream', { p0: branch }) }
      }
      const pushed = await runSessionGit(root, ['push', '--', branch])
      if (pushed.code === 0) return { ok: true }
      return { ok: false, message: (pushed.stderr || pushed.stdout || hostMessage('gitOperationFailedGit', { p0: 'push', p1: '' })).trim() }
    },
    repairWorktreeLinks: async (repoCommonDir, managedRoot) => {
      // Local adaptation: the repository moved on disk; git's own repair
      // rewrites the Worktree's `.git` pointer to the current admin dir.
      const result = await runSessionGit(repoCommonDir, ['worktree', 'repair', managedRoot])
      return result.code === 0
    },
    listWorktreeincludeFiles: async (localRoot, includeFile) => {
      // Local adaptation (.worktreeinclude): the intersection of the two
      // `ls-files --others --ignored` calls is exactly "matched ∧ gitignored"
      // — negation/anchoring/dir patterns all stay in git, no local matcher.
      // The matched call uses --exclude-from (not --exclude-standard + -c
      // core.excludesFile): --exclude-standard unions the repo .gitignore,
      // which would let through ignored-but-unlisted files. `ls-files -s`
      // prints no mode for --others entries, so symlink detection happens
      // at copy time via the files port instead.
      const [all, matched] = await Promise.all([
        runSessionGit(localRoot, ['ls-files', '--others', '--ignored', '--exclude-standard', '-z']),
        runSessionGit(localRoot, ['ls-files', '--others', '--ignored', `--exclude-from=${includeFile}`, '-z']),
      ])
      if (all.code !== 0 || matched.code !== 0) return []
      const ignored = new Set(all.stdout.split('\0').filter(Boolean))
      const files = new Set(matched.stdout.split('\0').filter(Boolean).filter((path) => path && ignored.has(path)))
      // 自动带入被 ignore 的 AGENTS.override.md（codex 语义）。
      if (ignored.has('AGENTS.override.md')) files.add('AGENTS.override.md')
      return [...files]
    },
    branchOverview: async (root) => {
      const [refs, status] = await Promise.all([
        runSessionGit(root, ['for-each-ref', '--format=%(refname)%00%(objectname)%00%(HEAD)%00%(upstream:short)', 'refs/heads']),
        runStatus(root),
      ])
      if (refs.code !== 0) return null
      const branches = refs.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
        const [refname, oid, head, upstream] = line.split('\0')
        return {
          name: (refname ?? '').replace(/^refs\/heads\//u, ''),
          oid: oid ?? '',
          isCurrent: head === '*',
          upstream: upstream ? upstream : null,
        }
      }).filter((branch) => branch.name && /^[0-9a-f]{40,64}$/iu.test(branch.oid))
      // A failed status must not read as "nothing uncommitted": the menu draws
      // its dirty hint from this count, and 0 on a repository whose status
      // could not be read is a false claim rather than an unknown.
      return { branches, dirtyCount: status !== null && status.code === 0 ? status.stdout.split('\0').filter(Boolean).length : -1 }
    },
    defaultBranch: async (root) => {
      const symbolic = await runSessionGit(root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])
      const fromOrigin = symbolic.code === 0 ? symbolic.stdout.trim().replace(/^origin\//u, '') : ''
      if (fromOrigin) return fromOrigin
      const configured = await runSessionGit(root, ['config', '--get', 'init.defaultBranch'])
      const fromConfig = configured.code === 0 ? configured.stdout.trim() : ''
      return fromConfig || null
    },
    branchTipTimes: async (root) => {
      const refs = await runSessionGit(root, ['for-each-ref', '--format=%(refname)%00%(committerdate:unix)', 'refs/heads'])
      if (refs.code !== 0) {
        throw new SessionCheckoutError('git_operation_failed', refs.stderr.trim() || hostMessage('gitOperationFailedGit', { p0: 'for-each-ref', p1: '' }))
      }
      const times: Record<string, number> = {}
      for (const line of refs.stdout.split(/\r?\n/).filter(Boolean)) {
        const [refname, unix] = line.split('\0')
        const name = (refname ?? '').replace(/^refs\/heads\//u, '')
        const seconds = Number.parseInt(unix ?? '', 10)
        if (name && Number.isFinite(seconds)) times[name] = seconds * 1000
      }
      return times
    },
    deleteLocalBranch: async (root, name) => {
      const result = await runSessionGit(root, ['branch', '-d', name])
      if (result.code === 0) return { deleted: true }
      return { deleted: false, reason: (result.stderr || result.stdout).trim() }
    },
    graphLog: async (root, limit) => {
      const capped = Math.max(1, Math.min(1000, Math.floor(limit)))
      const result = await runSessionGit(root, [
        'log', '--branches', '--tags', '--remotes', '--topo-order', '--parents',
        `--max-count=${capped}`,
        '--format=%H%x00%P%x00%an%x00%at%x00%D%x00%s%x1e',
      ])
      if (result.code !== 0) {
        throw new SessionCheckoutError('git_operation_failed', result.stderr.trim() || hostMessage('gitOperationFailedGit', { p0: 'log', p1: '' }))
      }
      return result.stdout.split('\x1e').map((record) => record.replace(/^[\r\n]+/u, '').trimEnd()).filter(Boolean).map((record) => {
        const parts = record.split('\0')
        const [oid = '', parentsLine = '', author = '', time = '', decoration = ''] = parts
        return {
          oid,
          parents: parentsLine ? parentsLine.split(' ').filter(Boolean) : [],
          author,
          authorTime: Number.parseInt(time, 10) || 0,
          refs: parseDecoration(decoration),
          subject: parts.slice(5).join('\0'),
        }
      }).filter((commit) => /^[0-9a-f]{40,64}$/iu.test(commit.oid))
    },
    createLocalBranch: async (root, name) => {
      const check = await runSessionGit(root, ['check-ref-format', '--branch', name])
      if (check.code !== 0) {
        throw new SessionCheckoutError('git_operation_failed', check.stderr.trim() || hostMessage('gitOperationFailedGit', { p0: 'check-ref-format', p1: name }))
      }
      const created = await runSessionGit(root, ['branch', name, 'HEAD'])
      if (created.code !== 0) {
        throw new SessionCheckoutError('git_operation_failed', (created.stderr || created.stdout).trim() || hostMessage('gitOperationFailedGit', { p0: 'branch', p1: name }))
      }
    },
    switchLocalBranch: async (root, branch) => {
      const switched = await runSessionGit(root, ['switch', branch])
      if (switched.code !== 0) {
        const stderr = (switched.stderr || switched.stdout).trim()
        // git: fatal: '<branch>' is already used by worktree at '<path>'（旧版为 already checked out at）
        const busy = stderr.match(/'(?:[^']*)' is (?:already used by|already checked out at) worktree at '([^']+)'/u)
        if (busy) {
          throw new SessionCheckoutError('git_operation_failed', hostMessage('branchCheckedOutInAnotherWorktree', { p0: branch, p1: busy[1] ?? '' }))
        }
        throw new SessionCheckoutError('git_operation_failed', stderr || hostMessage('gitOperationFailedGit', { p0: 'switch', p1: branch }))
      }
    },
    listTags: async (root) => {
      // One spawn lists tags with their object, peeled commit and subject;
      // a second best-effort spawn marks which names `origin` already has.
      // Annotated tags peel via `*objectname`/`*subject` (format v2 markers).
      const refs = await runSessionGit(root, [
        'for-each-ref',
        '--format=%(refname:short)%00%(objectname)%00%(objecttype)%00%(*objectname)%00%(*objecttype)%00%(contents:subject)',
        'refs/tags',
      ])
      if (refs.code !== 0) return null
      const tags = refs.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
        const [name = '', oid = '', objectType = '', peeledOid = '', peeledType = '', subject = ''] = line.split('\0')
        const annotated = objectType === 'tag'
        const commitOid = annotated
          ? (peeledType === 'commit' && /^[0-9a-f]{40,64}$/iu.test(peeledOid) ? peeledOid : null)
          : (/^[0-9a-f]{40,64}$/iu.test(oid) ? oid : null)
        return {
          name,
          oid,
          commitOid,
          annotated,
          // Lightweight tags have no message: `contents:subject` would print the
          // commit subject, so only annotated tags keep a body.
          message: annotated && subject.trim() !== '' ? subject.trim() : null,
          // Unknown until `ls-remote` answers: being offline (or having no
          // `origin`) must not be reported as "not pushed".
          pushed: null as boolean | null,
        }
      }).filter(tag => tag.name !== '' && /^[0-9a-f]{40,64}$/iu.test(tag.oid))
      const remote = await runSessionGit(root, ['ls-remote', '--tags', 'origin'])
      if (remote.code === 0) {
        const remoteNames = new Set(remote.stdout.split(/\r?\n/).map(line => line.split('\t')[1] ?? '')
          .map(ref => ref.replace(/^refs\/tags\//u, '').replace(/\^\{\}$/u, ''))
          .filter(Boolean))
        for (const tag of tags) tag.pushed = remoteNames.has(tag.name)
      }
      return tags
    },
    createTag: async (root, name, options) => {
      // `check-ref-format --branch` also validates tag names: both share the
      // same refname rules (no spaces, no leading dash, no `..`/`~`/`^`).
      const check = await runSessionGit(root, ['check-ref-format', `refs/tags/${name}`])
      if (check.code !== 0) {
        throw new SessionCheckoutError('git_operation_failed', check.stderr.trim() || hostMessage('gitOperationFailedGit', { p0: 'check-ref-format', p1: name }))
      }
      const target = options?.target && options.target.trim() !== '' ? options.target.trim() : 'HEAD'
      const message = options?.message?.trim() ?? ''
      const created = message !== ''
        ? await runSessionGit(root, ['tag', '-a', name, '-m', message, target])
        : await runSessionGit(root, ['tag', name, target])
      if (created.code !== 0) {
        throw new SessionCheckoutError('git_operation_failed', (created.stderr || created.stdout).trim() || hostMessage('gitOperationFailedGit', { p0: 'tag', p1: name }))
      }
    },
    deleteLocalTag: async (root, name) => {
      const deleted = await runSessionGit(root, ['tag', '-d', name])
      if (deleted.code !== 0) {
        throw new SessionCheckoutError('git_operation_failed', (deleted.stderr || deleted.stdout).trim() || hostMessage('gitOperationFailedGit', { p0: 'tag -d', p1: name }))
      }
    },
    pushTag: async (root, name) => {
      // Never force: a rejected or missing remote is reported, not overwritten.
      const pushed = await runSessionGit(root, ['push', 'origin', `refs/tags/${name}:refs/tags/${name}`])
      if (pushed.code === 0) return { ok: true }
      return { ok: false, message: (pushed.stderr || pushed.stdout || hostMessage('gitOperationFailedGit', { p0: 'push', p1: name })).trim() }
    },
    deleteRemoteTag: async (root, name) => {
      const deleted = await runSessionGit(root, ['push', 'origin', `:refs/tags/${name}`])
      if (deleted.code === 0) return { ok: true }
      return { ok: false, message: (deleted.stderr || deleted.stdout || hostMessage('gitOperationFailedGit', { p0: 'push', p1: name })).trim() }
    },
    mergeLocalBranch: async (root, source, options) => {
      const dryRun = options?.dryRun === true
      const collectConflict = async (cwd: string): Promise<{ conflictingFiles: string[]; conflictDetails: ApplyConflictDetail[] } | null> => {
        const unmerged = await runSessionGit(cwd, ['diff', '--name-only', '--diff-filter=U', '-z'])
        const conflictingFiles = unmerged.stdout.split('\0').filter(Boolean).sort()
        if (conflictingFiles.length === 0) return null
        const conflictDetails: ApplyConflictDetail[] = []
        for (const file of conflictingFiles.slice(0, CONFLICT_DETAIL_FILE_LIMIT)) {
          const diff = await runSessionGit(cwd, ['diff', '--', file])
          const text = diff.stdout.length > CONFLICT_DETAIL_DIFF_LIMIT
            ? `${diff.stdout.slice(0, CONFLICT_DETAIL_DIFF_LIMIT)}\n… ${hostMessage('worktreeConflictDiffTruncated')}`
            : diff.stdout
          conflictDetails.push({ file, diff: text })
        }
        if (conflictingFiles.length > CONFLICT_DETAIL_FILE_LIMIT) {
          conflictDetails.push({
            file: hostMessage('worktreeConflictMoreFiles', { p0: String(conflictingFiles.length - CONFLICT_DETAIL_FILE_LIMIT) }),
            diff: '',
          })
        }
        return { conflictingFiles, conflictDetails }
      }

      const head = await runSessionGit(root, ['rev-parse', 'HEAD'])
      if (head.code !== 0) {
        return { type: 'failed', reason: (head.stderr || head.stdout).trim() || hostMessage('gitOperationFailedGit', { p0: 'rev-parse', p1: 'HEAD' }) }
      }
      const tip = await runSessionGit(root, ['rev-parse', '--verify', '--quiet', `${source}^{commit}`])
      if (tip.code !== 0) {
        return { type: 'failed', reason: hostMessage('worktreeMergeUnknownSourceBranch', { p0: source }) }
      }
      const headOid = head.stdout.trim()
      const tipOid = tip.stdout.trim()
      if (headOid === tipOid) return { type: 'up_to_date' }
      const ancestor = await runSessionGit(root, ['merge-base', headOid, tipOid])
      if (ancestor.code === 0 && ancestor.stdout.trim() === tipOid) return { type: 'up_to_date' }

      if (dryRun) {
        // 干跑：临时 detached worktree 指向当前 HEAD 试合并，零改动触碰 checkout。
        const probe = await mkdtemp(join(tmpdir(), 'dsh-merge-probe-'))
        let added = false
        try {
          const addedResult = await runSessionGit(root, ['worktree', 'add', '--detach', probe, headOid])
          if (addedResult.code !== 0) {
            return { type: 'failed', reason: (addedResult.stderr || addedResult.stdout).trim() }
          }
          added = true
          const merge = await runSessionGit(probe, ['merge', '--no-commit', '--no-ff', source])
          if (merge.code === 0) {
            const files = await runSessionGit(probe, ['diff', '--name-only', headOid])
            return { type: 'merged', mergedFiles: files.stdout.split('\n').map((line) => line.trim()).filter(Boolean) }
          }
          const conflict = await collectConflict(probe)
          if (conflict) return { type: 'conflict', ...conflict }
          return { type: 'failed', reason: (merge.stderr || merge.stdout).trim() }
        } finally {
          // 探测 worktree 必须回收；remove --force 覆盖未提交的合并状态。
          if (added) await runSessionGit(root, ['worktree', 'remove', '--force', probe])
        }
      }

      // 正式合并：冲突不 abort——冲突状态留在 Local，调用方拿到详情后自行解决提交。
      const merge = await runSessionGit(root, ['merge', '--no-ff', '--no-edit', source])
      if (merge.code === 0) {
        const files = await runSessionGit(root, ['diff', '--name-only', 'HEAD^1', 'HEAD'])
        return { type: 'merged', mergedFiles: files.stdout.split('\n').map((line) => line.trim()).filter(Boolean) }
      }
      const conflict = await collectConflict(root)
      if (conflict) return { type: 'conflict', ...conflict }
      return { type: 'failed', reason: (merge.stderr || merge.stdout).trim() }
    },
    captureLocalWip: async (root) => {
      // codex 对齐：`diff --binary HEAD` 同时覆盖已暂存与未暂存的 tracked
      // 修改；空输出返回 null（干净工作树无需携带）。
      const diff = await runGit(ctx, root, ['diff', '--binary', '--full-index', 'HEAD'], options, undefined, undefined, WIP_PATCH_COLLECT_BYTES)
      if (diff.code !== 0) {
        throw new SessionCheckoutError('git_operation_failed', diff.stderr.trim() || hostMessage('gitOperationFailedGit', { p0: 'diff', p1: '' }))
      }
      return diff.stdout.trim() === '' ? null : diff.stdout
    },
    applyWorktreePatch: async (root, patch) => {
      // git apply 默认原子：整包应用或整体失败，不会留下半套修改。
      const applied = await runSessionGit(root, ['apply', '--binary', '--whitespace=nowarn', '-'], patch)
      if (applied.code !== 0) {
        throw new SessionCheckoutError('git_operation_failed', (applied.stderr || applied.stdout).trim() || hostMessage('gitOperationFailedGit', { p0: 'apply', p1: '' }))
      }
    },
    listUntrackedFiles: async (root) => {
      // 非 ignore 的 untracked（ignored 文件由 .worktreeinclude 通道负责）。
      const output = await runSessionGitChecked(root, ['ls-files', '--others', '--exclude-standard', '-z'])
      return output.split('\0').filter(Boolean)
    },
    snapshotAbandonedWorktree: async (localRoot, managedRoot, checkoutId) => {
      // codex 对齐：add -A 把 tracked 修改与未 ignore 的 untracked 文件一并
      // 写入 worktree 索引（ignored 文件源头在 Local，不属可丢失内容），
      // write-tree 固化目录，commit-tree 以显式身份生成快照提交——不依赖
      // 用户的 git 身份配置。
      await runSessionGitChecked(managedRoot, ['add', '-A'])
      const tree = await runSessionGitChecked(managedRoot, ['write-tree'])
      const head = await runSessionGit(managedRoot, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'])
      const parentArgs = head.code === 0 && /^[0-9a-f]{40,64}$/iu.test(head.stdout) ? ['-p', head.stdout] : []
      const committed = await runSessionGit(localRoot, [
        '-c', 'user.name=dsh-git-worktree',
        '-c', 'user.email=dsh-git-worktree@localhost',
        'commit-tree', tree, ...parentArgs,
      ])
      if (committed.code !== 0) {
        throw new SessionCheckoutError('git_operation_failed', (committed.stderr || committed.stdout).trim() || hostMessage('gitOperationFailedGit', { p0: 'commit-tree', p1: '' }))
      }
      const snapshotOid = committed.stdout.trim()
      await runSessionGitChecked(localRoot, ['update-ref', abandonedSnapshotRef(checkoutId), snapshotOid])
      return snapshotOid
    },
    restoreAbandonedSnapshot: async (localRoot, checkoutId, snapshotOid) => {
      const branch = `worktree-restore-${snapshotOid.slice(0, 8)}`
      const created = await runSessionGit(localRoot, ['branch', branch, snapshotOid])
      if (created.code !== 0) {
        throw new SessionCheckoutError('git_operation_failed', (created.stderr || created.stdout).trim() || hostMessage('gitOperationFailedGit', { p0: 'branch', p1: branch }))
      }
      await runSessionGitChecked(localRoot, ['update-ref', '-d', abandonedSnapshotRef(checkoutId)])
      return branch
    },
  }
  return Object.assign(port, initialCommitActions(port.inspect, runSessionGit))
}
