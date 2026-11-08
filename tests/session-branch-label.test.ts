import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { createNodeSessionCheckoutDependencies } from './support/production-adapters.js'
import { createOfficialWorktreesFixture } from './support/official-worktrees.js'
import { createSessionCheckoutModule } from '../src/session-checkout-module.js'
import { createDshGitPort } from '../src/adapters/git.js'
import { createWorktreeConsoleControlPlane } from '../src/console-host/control-plane.js'

/** 隔离宿主环境里的 GIT_* 变量，否则 adapter 会读到本仓库的仓库指针。 */
function testEnvironment(overrides: Record<string, string | undefined> = {}) {
  const env = {
    ...process.env,
    ...overrides,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
  }
  for (const key of Object.keys(env)) {
    if (env[key] === undefined || /^GIT_(AUTHOR_|COMMITTER_|DIR$|WORK_TREE$|INDEX_FILE$)/.test(key)) delete env[key]
  }
  return env
}

/**
 * 回归：对话栏 Session Target 胶囊的分支标签。
 *
 * 用户报告「分支标签丢失」的机制根因是 Worktree 停在 detached HEAD：
 * `git symbolic-ref HEAD` 取不到分支 → `snapshot.branch === null` →
 * `currentBranch === null` → 胶囊塌成 `Worktree · <状态>`。创建即建会话分支之后，
 * 端到端链路（创建 → control-plane `current` → WorktreeConsoleTargetSummary.currentBranch）
 * 必须给出真实分支名。
 */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-branch-label-'))
  const repo = join(root, 'repo')
  mkdirSync(repo)
  const git = (...args: string[]) => {
    const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8', env: testEnvironment() })
    if (result.status) throw Error(`${args.join(' ')}: ${result.stderr}`)
    return result.stdout.trim()
  }
  git('init', '-b', 'main')
  git('config', 'user.name', 'Test')
  git('config', 'user.email', 'test@example.test')
  writeFileSync(join(repo, 'shared.txt'), 'base\n')
  git('add', '.')
  git('commit', '-m', 'base')
  const ctx = {
    subprocess: {
      spawn(options: { argv: string[]; cwd: string; stdio: { stdin: string }; env?: Record<string, string | undefined> }) {
        const child = spawn('git', options.argv.slice(1), { cwd: options.cwd, env: testEnvironment(options.env) })
        let stdout = ''
        let stderr = ''
        child.stdout.on('data', data => { stdout += data })
        child.stderr.on('data', data => { stderr += data })
        if (options.stdio.stdin !== 'pipe') child.stdin.end()
        const done = new Promise<{ exitCode: number | null }>(resolve => child.on('close', exitCode => resolve({ exitCode })))
        return {
          done,
          terminate: () => { if (child.exitCode === null) child.kill() },
          waitForExit: async () => { await done; return true },
          stdin: child.stdin,
          collected: {
            stdout: { readFrom: () => ({ text: stdout }) },
            stderr: { readFrom: () => ({ text: stderr }) },
          },
        }
      },
    },
  } as unknown as Context
  const port = createDshGitPort(ctx, { hooksPath: join(root, 'no-hooks') })
  const sessions = new Map([['source', { id: 'source', projectId: 'project' }]])
  const projects = new Map([['project', { id: 'project', name: 'Project', root: repo }]])
  const lookup = {
    getSession: (id: string) => sessions.get(id),
    getProject: (id: string) => projects.get(id),
    getUnboundTargetPolicy: () => 'unselected' as const,
  }
  const dependencies = createNodeSessionCheckoutDependencies({ configDir: join(root, 'config'), lookup })
  const official = createOfficialWorktreesFixture(repo)
  dependencies.officialWorktrees = () => official.port
  dependencies.git = port
  dependencies.inheritLocalChanges = false
  return {
    root, repo, git, port, dependencies, projects, sessions, lookup,
    cleanup: () => rmSync(root, { force: true, recursive: true }),
  }
}

it('names the Session branch on the conversation target capsule right after creation', async () => {
  const env = fixture()
  try {
    const module = createSessionCheckoutModule(env.dependencies)
    env.sessions.set('owner', { id: 'owner', projectId: 'project' })
    const launch = await module.createOfficialTarget({ session: { id: 'owner' } }, { topic: 'labels' })
    env.projects.set('owner-project', { id: 'owner-project', name: 'Owner', root: launch.managedRoot })
    env.sessions.set('owner', { id: 'owner', projectId: 'owner-project' })

    const control = createWorktreeConsoleControlPlane({
      module,
      lookup: env.lookup,
      files: env.dependencies.files,
      registry: env.dependencies.registry,
      git: env.port,
      createWorktree: async () => ({ ok: false, message: 'unused' }),
      adoptionFailure: () => null,
    })

    const current = await control.current('owner')
    if (!current.ok) throw Error(JSON.stringify(current))
    const target = current.value.target

    // 胶囊主标签直接取 currentBranch（TargetStatusAction: branchLabel ?? `Worktree · 状态`）。
    // 这里必须是真实分支名，而不是 null（null 就会塌成裸状态标签）。
    expect(target.currentBranch).toBe('feat/sess-owner--labels')
    // 侧栏/胶囊的「来源分支」也应指向本会话自己的分支，而不是 Local 当时的分叉点。
    expect(target.sourceBranch).toBe('feat/sess-owner--labels')
    // Git 侧确认：Worktree 真的挂在分支上，而不是 detached。
    expect(env.git('-C', launch.managedRoot, 'symbolic-ref', '--quiet', 'HEAD')).toBe('refs/heads/feat/sess-owner--labels')
  } finally {
    env.cleanup()
  }
}, 120_000)

it('keeps naming the Session branch after delivery, when Local is back in charge', async () => {
  const env = fixture()
  try {
    const module = createSessionCheckoutModule(env.dependencies)
    env.sessions.set('owner', { id: 'owner', projectId: 'project' })
    const launch = await module.createOfficialTarget({ session: { id: 'owner' } }, { topic: 'labels' })
    env.projects.set('owner-project', { id: 'owner-project', name: 'Owner', root: launch.managedRoot })
    env.sessions.set('owner', { id: 'owner', projectId: 'owner-project' })

    writeFileSync(join(launch.managedRoot, 'shared.txt'), 'base\nedit\n')
    const ready = await module.inspect('owner')
    const delivered = await module.operate({
      action: 'finish',
      sessionId: 'owner',
      expectedRevision: ready.revision,
      commitMessage: 'fix: labels',
      retention: 'retain_manual',
    })
    if (delivered.status !== 'finished') throw Error(JSON.stringify(delivered))

    const control = createWorktreeConsoleControlPlane({
      module,
      lookup: env.lookup,
      files: env.dependencies.files,
      registry: env.dependencies.registry,
      git: env.port,
      createWorktree: async () => ({ ok: false, message: 'unused' }),
      adoptionFailure: () => null,
    })
    const current = await control.current('owner')
    if (!current.ok) throw Error(JSON.stringify(current))
    const target = current.value.target

    // 交付后 owner 会话已回到 Local 边界：胶囊要跟随用户真正站着的分支
    // （master/main），而不是冻结在 Worktree 里的任务分支——否则合并完成后
    // 胶囊会一直显示 feat/…，用户以为还困在 Worktree 里。
    expect(target.currentBranch).toBe('main')
    // 「来源分支」仍然记录这次改动落在哪条分支上。
    expect(target.sourceBranch).toBe('feat/sess-owner--labels')
    // Local 从未被写入，仍停在自己的分支上。
    expect(env.git('symbolic-ref', 'HEAD')).toBe('refs/heads/main')
  } finally {
    env.cleanup()
  }
}, 120_000)
