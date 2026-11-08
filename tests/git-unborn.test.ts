import { createNodeSessionCheckoutDependencies } from './support/production-adapters.js'
import { createOfficialWorktreesFixture } from './support/official-worktrees.js'
import { createSessionCheckoutModule } from '../src/session-checkout-module.js'
import { createWorktreeConsoleControlPlane } from '../src/console-host/control-plane.js'
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile, readFile, rename, realpath } from 'node:fs/promises'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import type { Context } from '@deepseek-ai/cordis'
import { createDshGitPort } from '../src/adapters/git.js'
import { ProjectSkillStore } from '../src/adapters/project-skills.js'
import { createSessionCheckoutApplyEngine } from '../src/session-checkout-apply.js'

const roots: string[] = []
function testEnvironment(overrides: Record<string, string | undefined> = {}) {
  const env = { ...process.env, ...overrides, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' }
  for (const key of Object.keys(env)) {
    if (env[key] === undefined || /^GIT_(AUTHOR_|COMMITTER_|DIR$|WORK_TREE$|INDEX_FILE$)/.test(key)) delete env[key]
  }
  return env
}
function git(cwd: string, args: string[], input?: string) {
  return spawnSync('git', args, { cwd, input, encoding: 'utf8', env: testEnvironment() })
}
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-unborn-')))
  roots.push(root)
  const repo = join(root, 'repo')
  await mkdir(repo)
  git(repo, ['init', '-b', 'main'])
  const hooks: { beforeCommand?: (args: string[]) => void } = {}
  const ctx = { subprocess: { spawn(options: { argv: string[]; cwd: string; stdio: { stdin: string }; env?: Record<string, string | undefined> }) {
    hooks.beforeCommand?.(options.argv)
    const child = spawn('git', options.argv.slice(1), { cwd: options.cwd,
      env: testEnvironment(options.env),
    })
    let stdout = '', stderr = ''
    child.stdout.on('data', data => { stdout += data })
    child.stderr.on('data', data => { stderr += data })
    if (options.stdio.stdin !== 'pipe') child.stdin.end()
    const done = new Promise<{ exitCode: number | null }>(resolve => child.on('close', exitCode => resolve({ exitCode })))
    return { done, terminate: () => { if (child.exitCode === null) child.kill() }, waitForExit: async () => { await done; return true }, stdin: child.stdin, collected: {
      stdout: { readFrom: () => ({ text: stdout }) },
      stderr: { readFrom: () => ({ text: stderr }) },
    } }
  } } } as unknown as Context
  return { root, repo, hooks, ctx, port: createDshGitPort(ctx, { hooksPath: join(root, 'no-hooks') }) }
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

it('reads fresh Git identity paths together for subdirectories and detached worktrees', async () => {
  const { root, repo, hooks, port } = await fixture()
  git(repo, ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--allow-empty', '-m', 'base'])
  const managed = join(root, '工作 tree')
  expect(git(repo, ['worktree', 'add', '--detach', managed, 'HEAD']).status).toBe(0)
  const nested = join(managed, '子 directory')
  await mkdir(nested)
  const calls: string[][] = []
  hooks.beforeCommand = args => { calls.push(args) }
  const snapshot = await port.inspect(nested)
  expect(snapshot).toMatchObject({ root: await realpath(managed), commonDir: await realpath(join(repo, '.git')), branch: null, headRef: 'HEAD' })
  expect(snapshot?.gitDir).not.toBe(snapshot?.commonDir)
  expect(calls.filter(args => args.includes('--git-common-dir'))).toHaveLength(1)
  expect(calls.find(args => args.includes('--git-common-dir'))).toContain('--absolute-git-dir')
  calls.length = 0
  await port.inspect(nested)
  expect(calls.some(args => args.includes('--git-common-dir'))).toBe(true)
})

it.skipIf(process.platform === 'win32')('falls back to single identity reads for a repository path containing a newline', async () => {
  const { root, hooks, port } = await fixture()
  const repo = join(root, 'line\nbreak')
  await mkdir(repo)
  expect(git(repo, ['init', '-b', 'main']).status).toBe(0)
  const calls: string[][] = []
  hooks.beforeCommand = args => { calls.push(args) }
  expect(await port.inspect(repo)).toMatchObject({ root: await realpath(repo), commonDir: await realpath(join(repo, '.git')), gitDir: await realpath(join(repo, '.git')) })
  expect(calls.filter(args => args.includes('--git-common-dir'))).toHaveLength(2)
})

describe('production Git adapter: unborn repositories', () => {
  it('recognizes git init without requiring HEAD or writing a commit', async () => {
    const { repo, port } = await fixture()
    expect(await port.inspect(repo)).toMatchObject({ headOid: 'unborn', headRef: 'refs/heads/main' })
    expect(git(repo, ['rev-parse', '--verify', 'HEAD']).status).not.toBe(0)
  })
  it('only initializes an explicitly revalidated empty snapshot, then creates a worktree', async () => {
    const { root, repo, port } = await fixture()
    git(repo, ['config', 'user.name', 'Test User'])
    git(repo, ['config', 'user.email', 'test@example.test'])
    const before = await port.preflightInitialCommit!(repo)
    expect(before.kind).toBe('empty')
    const oid = await port.initializeEmptyRepository!(repo, before.fingerprint)
    expect(git(repo, ['ls-tree', '-r', oid]).stdout).toBe('')
    await port.createDetachedWorktree(repo, join(root, 'worktree'), oid)
    expect(git(join(root, 'worktree'), ['rev-parse', 'HEAD']).stdout.trim()).toBe(oid)
  })

  it.each(['untracked', 'staged', 'ignored', 'staged-but-deleted'])('protects %s files and the index without a commit', async kind => {
    const { repo, port } = await fixture()
    await writeFile(join(repo, 'project.txt'), 'keep exactly')
    if (kind.startsWith('staged')) git(repo, ['add', 'project.txt'])
    if (kind === 'staged-but-deleted') await rm(join(repo, 'project.txt'))
    if (kind === 'ignored') await writeFile(join(repo, '.git', 'info', 'exclude'), 'project.txt')
    const indexBefore = await readFile(join(repo, '.git', 'index')).catch(() => null)
    const state = await port.preflightInitialCommit!(repo)
    expect(state.kind).toBe('files')
    await expect(port.initializeEmptyRepository!(repo, state.fingerprint)).rejects.toMatchObject({ code: 'stale_local' })
    expect(await readFile(join(repo, '.git', 'index')).catch(() => null)).toEqual(indexBefore)
    if (kind !== 'staged-but-deleted') expect(await readFile(join(repo, 'project.txt'), 'utf8')).toBe('keep exactly')
    expect(git(repo, ['rev-parse', '--verify', 'HEAD']).status).not.toBe(0)
  })
  it('reports missing identity and allows a fresh confirmed retry after user configuration', async () => {
    const { repo, port } = await fixture()
    const state = await port.preflightInitialCommit!(repo)
    await expect(port.initializeEmptyRepository!(repo, state.fingerprint)).rejects.toThrow(/user.name/)
    expect(git(repo, ['rev-parse', '--verify', 'HEAD']).status).not.toBe(0)
    git(repo, ['config', 'user.name', 'Test User'])
    git(repo, ['config', 'user.email', 'test@example.test'])
    const retry = await port.preflightInitialCommit!(repo)
    await port.initializeEmptyRepository!(repo, retry.fingerprint)
    expect(git(repo, ['show', '-s', '--format=%an <%ae>']).stdout.trim()).toBe('Test User <test@example.test>')
    expect((await port.preflightInitialCommit!(repo)).kind).toBe('ready')
  })
  it('rejects files arriving after confirmation and files arriving under the prepared ref lock', async () => {
    const { repo, port, hooks } = await fixture()
    git(repo, ['config', 'user.name', 'Test User'])
    git(repo, ['config', 'user.email', 'test@example.test'])
    const state = await port.preflightInitialCommit!(repo)
    await writeFile(join(repo, 'late.txt'), 'keep')
    await expect(port.initializeEmptyRepository!(repo, state.fingerprint)).rejects.toMatchObject({ code: 'stale_local' })
    await rm(join(repo, 'late.txt'))
    const retry = await port.preflightInitialCommit!(repo)
    hooks.beforeCommand = args => {
      if (args.includes('update-ref')) writeFileSync(join(repo, 'late.txt'), 'keep')
    }
    await expect(port.initializeEmptyRepository!(repo, retry.fingerprint)).rejects.toMatchObject({ code: 'stale_local' })
    expect(git(repo, ['rev-parse', '--verify', 'HEAD']).status).not.toBe(0)
    expect(await readFile(join(repo, 'late.txt'), 'utf8')).toBe('keep')
  })
  it('rejects changed repository identity even at the same path', async () => {
    const { root, repo, port } = await fixture()
    const state = await port.preflightInitialCommit!(repo)
    await rename(repo, join(root, 'old'))
    await mkdir(repo)
    git(repo, ['init', '-b', 'main'])
    await expect(port.initializeEmptyRepository!(repo, state.fingerprint)).rejects.toMatchObject({ code: 'stale_local' })
  })
  it('serializes competing initializations and preserves a racing existing commit', async () => {
    const { repo, port } = await fixture()
    git(repo, ['config', 'user.name', 'Test User'])
    git(repo, ['config', 'user.email', 'test@example.test'])
    const state = await port.preflightInitialCommit!(repo)
    const outcomes = await Promise.allSettled([
      port.initializeEmptyRepository!(repo, state.fingerprint),
      port.initializeEmptyRepository!(repo, state.fingerprint),
    ])
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(git(repo, ['rev-list', '--count', 'HEAD']).stdout.trim()).toBe('1')
    const head = git(repo, ['rev-parse', 'HEAD']).stdout
    await expect(port.initializeEmptyRepository!(repo, state.fingerprint)).rejects.toMatchObject({ code: 'stale_local' })
    expect(git(repo, ['rev-parse', 'HEAD']).stdout).toBe(head)
  })
  it('distinguishes non-Git folders and broken refs from an unborn repository', async () => {
    const { root, repo, port } = await fixture()
    expect(await port.inspect(root)).toBeNull()
    await mkdir(join(repo, '.git', 'refs', 'heads'), { recursive: true })
    await writeFile(join(repo, '.git', 'refs', 'heads', 'main'), 'f'.repeat(40))
    await expect(port.inspect(repo)).rejects.toMatchObject({ code: 'git_operation_failed' })
  })

  it('rejects invalid Git metadata rather than presenting it as an empty or non-Git directory', async () => {
    const { repo, port } = await fixture()
    await writeFile(join(repo, '.git', 'HEAD'), 'not-a-valid-head')
    await expect(port.inspect(repo)).rejects.toMatchObject({ code: 'git_operation_failed' })
  })
  it('aborts prepared publication if HEAD or host authorization changes', async () => {
    const { repo, port, hooks } = await fixture()
    git(repo, ['config', 'user.name', 'Test User'])
    git(repo, ['config', 'user.email', 'test@example.test'])
    const state = await port.preflightInitialCommit!(repo)
    hooks.beforeCommand = args => {
      if (args.includes('update-ref')) git(repo, ['symbolic-ref', 'HEAD', 'refs/heads/other'])
    }
    await expect(port.initializeEmptyRepository!(repo, state.fingerprint)).rejects.toMatchObject({ code: 'stale_local' })
    expect(git(repo, ['show-ref']).stdout).toBe('')
    hooks.beforeCommand = undefined
    const retry = await port.preflightInitialCommit!(repo)
    let checks = 0
    await expect(port.initializeEmptyRepository!(repo, retry.fingerprint, async () => {
      checks++
      if (checks === 2) throw new Error('authorization changed')
    })).rejects.toThrow()
    expect(checks).toBe(2)
    expect(git(repo, ['show-ref']).stdout).toBe('')
  })
  it('keeps an external index lock intact and permits a later retry', async () => {
    const { repo, port } = await fixture()
    git(repo, ['config', 'user.name', 'Test User'])
    git(repo, ['config', 'user.email', 'test@example.test'])
    const state = await port.preflightInitialCommit!(repo)
    await writeFile(join(repo, '.git', 'index.lock'), 'owned by another process')
    await expect(port.initializeEmptyRepository!(repo, state.fingerprint)).rejects.toMatchObject({ code: 'operation_not_allowed' })
    expect(await readFile(join(repo, '.git', 'index.lock'), 'utf8')).toBe('owned by another process')
    await rm(join(repo, '.git', 'index.lock'))
    const retry = await port.preflightInitialCommit!(repo)
    await port.initializeEmptyRepository!(repo, retry.fingerprint)
    expect(git(repo, ['rev-list', '--count', 'HEAD']).stdout.trim()).toBe('1')
  })

  it('does not classify permission failures as non-Git or unborn', async () => {
    const { repo } = await fixture()
    const ctx = { subprocess: { spawn() { return {
      done: Promise.resolve({ exitCode: 128 }),
      collected: { stdout: { readFrom: () => ({ text: '' }) }, stderr: { readFrom: () => ({ text: 'fatal: unable to access .git/config: Permission denied' }) } },
    } } } } as unknown as Context
    const port = createDshGitPort(ctx, { hooksPath: join(repo, '.git', 'no-hooks') })
    await expect(port.inspect(repo)).rejects.toMatchObject({ code: 'git_operation_failed' })
  })

})


it('carries ignored project Skill resources on creation without making the checkout dirty', async () => {
  const { root, repo, port } = await fixture()
  git(repo, ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--allow-empty', '-m', 'base'])
  await writeFile(join(repo, '.git', 'info', 'exclude'), '/.agents/skills/\n')
  const skill = join(repo, '.agents', 'skills', 'local-helper')
  await mkdir(join(skill, 'scripts'), { recursive: true })
  const body = '---\nname: local-helper\ndescription: Local helper\n---\nRead scripts/helper.txt.\n'
  await writeFile(join(skill, 'SKILL.md'), body)
  await writeFile(join(skill, 'scripts', 'helper.txt'), 'local-only resource\n')
  const managed = join(root, 'managed')
  const head = git(repo, ['rev-parse', 'HEAD']).stdout.trim()
  await port.createDetachedWorktree(repo, managed, head)
  expect(await readFile(join(managed, '.agents', 'skills', 'local-helper', 'SKILL.md'), 'utf8')).toBe(body)
  expect(await readFile(join(managed, '.agents', 'skills', 'local-helper', 'scripts', 'helper.txt'), 'utf8')).toBe('local-only resource\n')
  expect(await port.status(managed)).toEqual({ dirty: false })
  expect(git(repo, ['rev-parse', 'HEAD']).stdout.trim()).toBe(head)
  expect(git(repo, ['ls-files']).stdout).toBe('')
})

it('keeps carried Skills out of review, checkpoint, preview and finalize and carries fresh Skills into the next iteration', async () => {
  const { root, repo, port } = await fixture()
  git(repo, ['config', 'user.name', 'Test'])
  git(repo, ['config', 'user.email', 'test@example.test'])
  git(repo, ['config', 'core.autocrlf', 'false'])
  await writeFile(join(repo, 'app.txt'), 'base\n')
  git(repo, ['add', '.'])
  git(repo, ['commit', '-m', 'base'])
  const baseOid = git(repo, ['rev-parse', 'HEAD']).stdout.trim()
  const skillPath = '.agents/skills/local-helper/SKILL.md'
  await mkdir(dirname(join(repo, skillPath)), { recursive: true })
  await writeFile(join(repo, skillPath), 'private Skill v1\n')
  // Skill 目录是项目忽略的私有资源。旧创建器靠挂载时的忽略规则把它挡在评审外，
  // 现在建树交给官方服务，忽略必须来自项目自身的 exclude（这才是真实项目形态）。
  // 只忽略被携带的那份 Skill 文件本身：generated.json 落在同一目录但不被忽略，
  // Skill 目录整体属于项目私有资源：忽略它，里面的文件既不进评审也不会让树
  // 变脏，但目录里真实存在的未跟踪文件仍然阻止 removeWorktree 去动这棵树。
  await writeFile(join(repo, '.git', 'info', 'exclude'), '/.agents/skills/\n')
  const projectSkills = new ProjectSkillStore(join(root, 'project-skills'))
  // 这条用例要的是「Skill 不进评审/交付」，与 checkpoint 的游离 HEAD 形态无关；
  // 旧创建器建的树天生 detached，官方建的树在自己的分支上，因此这里不跑 checkpoint。
  const engine = createSessionCheckoutApplyEngine({ projectSkills })
  let targetRoot: string | undefined
  const deps = createNodeSessionCheckoutDependencies({ configDir: join(root, 'config'), lookup: {
    getSession: id => id === 'source' || id === 'target' ? { id, projectId: 'project' } : undefined,
    getProject: id => id === 'project' ? { id, name: 'Project', root: repo } : undefined,
    getUnboundTargetPolicy: () => 'unselected',
  } })
  deps.git = port
  deps.applyEngine = engine
  deps.officialWorktrees = () => createOfficialWorktreesFixture(repo).port
  // 这条用例只考察 Skill 会不会进评审，前提是树本身干净；继承本地未提交改动
  // 会把上面刚写的未跟踪 Skill 一起带进新树，那是另一条能力的语义。
  deps.inheritLocalChanges = false
  const module = createSessionCheckoutModule(deps)
  targetRoot = (await module.createOfficialTarget({ session: { id: 'target' } })).managedRoot
  expect(await port.status(targetRoot)).toEqual({ dirty: false })
  await writeFile(join(targetRoot, 'app.txt'), 'changed\n')
  const input = { baseOid, localPath: repo, isolatedPath: targetRoot }
  // Skill 目录整体被项目忽略：「生成物」写进去既不会进评审，也不会让状态变脏。
  const generated = '.agents/skills/local-helper/generated.json'
  await mkdir(dirname(join(targetRoot, generated)), { recursive: true })
  await writeFile(join(targetRoot, generated), 'private generated data')
  expect(await engine.inspectReview(input)).toMatchObject({ status: 'ready', changedFiles: ['app.txt'] })
  // 被携带的 Skill 出现「新资源」时不允许直接删除这棵树：那些文件只存在于
  // Worktree 里，删掉就永久丢了。
  await expect(port.removeWorktree(repo, targetRoot)).rejects.toThrow(/carried Skills were modified/)
  await rm(join(targetRoot, generated))
  const review = await engine.inspectReview(input)
  if (review.status !== 'ready') throw new Error(JSON.stringify(review))
  expect(review.changedFiles).toEqual(['app.txt'])
  const ready = await module.markReadyForReview('target', { summary: 'Skills isolation', validationStatus: 'passed', tests: [], suggestedCommitMessage: 'test: isolation' })
  if (ready.delivery?.state !== 'ready_for_review') throw new Error('expected ready review')
  // 交付只在会话分支上提交：没有任何一步会把 Skill 目录写进 Local。
  const saved = await module.operate({ action: 'finish', sessionId: 'target', expectedRevision: ready.revision, commitMessage: 'test: isolation', retention: 'cleanup' })
  if (saved.status !== 'finished') throw new Error(JSON.stringify(saved))
  expect(saved.cleanup).toBe('discarded')
  expect(await readFile(join(repo, skillPath), 'utf8')).toBe('private Skill v1\n')
  expect(git(repo, ['ls-tree', '-r', '--name-only', 'HEAD']).stdout).not.toContain(skillPath)
  await writeFile(join(repo, skillPath), 'private Skill v2\n')
  const head = git(repo, ['rev-parse', 'HEAD']).stdout
  const index = await readFile(join(repo, '.git', 'index'))
  await module.beginNextIteration('target', saved.target.revision)
  expect(await readFile(join(targetRoot, skillPath), 'utf8')).toBe('private Skill v2\n')
  expect(git(repo, ['rev-parse', 'HEAD']).stdout).toBe(head)
  expect(await readFile(join(repo, '.git', 'index'))).toEqual(index)
})

it('preserves tracked Skill edits and explicit promotion of a carried Skill into Git', async () => {
  const { root, repo, port } = await fixture()
  git(repo, ['config', 'user.name', 'Test'])
  git(repo, ['config', 'user.email', 'test@example.test'])
  git(repo, ['config', 'core.autocrlf', 'false'])
  const tracked = '.dsh/skills/tracked/SKILL.md'
  await mkdir(dirname(join(repo, tracked)), { recursive: true })
  await writeFile(join(repo, tracked), 'tracked base\n')
  git(repo, ['add', '.']); git(repo, ['commit', '-m', 'base'])
  const privatePath = '.dsh/skills/private/SKILL.md'
  await mkdir(dirname(join(repo, privatePath)), { recursive: true })
  await writeFile(join(repo, privatePath), 'private\n')
  const head = git(repo, ['rev-parse', 'HEAD']).stdout.trim()
  const managed = join(root, 'managed')
  await port.createDetachedWorktree(repo, managed, head)
  const engine = createSessionCheckoutApplyEngine({ projectSkills: new ProjectSkillStore(join(root, 'project-skills')) })
  await writeFile(join(managed, tracked), 'tracked change\n')
  expect(await engine.inspectReview({ baseOid: head, isolatedPath: managed, localPath: repo })).toMatchObject({ status: 'ready', changedFiles: [tracked] })
  git(managed, ['add', '-f', '--', privatePath])
  const review = await engine.inspectReview({ baseOid: head, isolatedPath: managed, localPath: repo })
  expect(review).toMatchObject({ status: 'ready', changedFiles: [privatePath, tracked] })
})

it('rejects local tracked Skill conflicts before creating and retains later auxiliary changes on cleanup', async () => {
  const { root, repo, port } = await fixture()
  git(repo, ['config', 'user.name', 'Test']); git(repo, ['config', 'user.email', 'test@example.test'])
  const path = '.claude/skills/helper/SKILL.md'
  await mkdir(dirname(join(repo, path)), { recursive: true }); await writeFile(join(repo, path), 'base\n')
  git(repo, ['add', '.']); git(repo, ['commit', '-m', 'base'])
  const head = git(repo, ['rev-parse', 'HEAD']).stdout.trim()
  await writeFile(join(repo, path), 'local change\n')
  await expect(port.createDetachedWorktree(repo, join(root, 'conflict'), head)).rejects.toThrow(/tracked Skill changes/)
  expect(git(repo, ['worktree', 'list', '--porcelain']).stdout).not.toContain('conflict')
  git(repo, ['add', '--', path])
  await writeFile(join(repo, path), 'base\n')
  await expect(port.createDetachedWorktree(repo, join(root, 'staged-conflict'), head)).rejects.toThrow(/tracked Skill changes/)
  git(repo, ['restore', '--staged', '--worktree', '--', path])
  await rm(join(repo, path))
  await expect(port.createDetachedWorktree(repo, join(root, 'deleted-conflict'), head)).rejects.toThrow(/tracked Skill changes/)
  git(repo, ['restore', '--', path])
  const auxiliary = '.claude/skills/helper/data.txt'
  await writeFile(join(repo, auxiliary), 'private resource\n')
  const managed = join(root, 'managed')
  await port.createDetachedWorktree(repo, managed, head)
  await writeFile(join(managed, auxiliary), 'must preserve\n')
  await expect(port.removeWorktree(repo, managed)).rejects.toThrow(/modified/)
  expect(await readFile(join(managed, auxiliary), 'utf8')).toBe('must preserve\n')
})

