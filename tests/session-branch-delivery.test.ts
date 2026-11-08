import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { createNodeSessionCheckoutDependencies } from './support/production-adapters.js'
import { createSessionCheckoutModule } from '../src/session-checkout-module.js'
import { createDshGitPort } from '../src/adapters/git.js'

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
 * 回归：交付只写会话自己的分支，Local 的工作区/索引/HEAD 一概不动。
 *
 * 这里复现用户报告的最严重问题——Local 停在**另一个会话**的主题分支上时创建
 * Worktree：旧实现会从那条分支分叉，并把交付提交写回同一条分支，把本会话的
 * 改动混进别人的分支。修正后创建即建本会话分支、交付写该分支。
 */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-session-branch-'))
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
  const baseOid = git('rev-parse', 'HEAD')
  // Local 停在另一个并行会话的主题分支上，并且工作区还留着它自己的未提交改动。
  git('switch', '-c', 'fix/sess-session--dock-action-click')
  git('commit', '--allow-empty', '-m', 'other session work')
  writeFileSync(join(repo, 'other-session-note.txt'), 'someone else mid-edit\n')
  const otherHead = git('rev-parse', 'HEAD')
  const ctx = { subprocess: { spawn(options: { argv: string[]; cwd: string; stdio: { stdin: string }; env?: Record<string, string | undefined> }) {
    const child = spawn('git', options.argv.slice(1), { cwd: options.cwd, env: testEnvironment(options.env) })
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
  const port = createDshGitPort(ctx, { hooksPath: join(root, 'no-hooks') })
  const sessions = new Map([['source', { id: 'source', projectId: 'project' }]])
  const projects = new Map([['project', { id: 'project', name: 'Project', root: repo }]])
  const lookup = {
    getSession: (id: string) => sessions.get(id),
    getProject: (id: string) => projects.get(id),
    getUnboundTargetPolicy: () => 'unselected' as const,
  }
  const dependencies = createNodeSessionCheckoutDependencies({ configDir: join(root, 'config'), lookup })
  dependencies.git = port
  return {
    root, repo, git, port, dependencies, projects, sessions, baseOid, otherHead,
    cleanup: () => rmSync(root, { force: true, recursive: true }),
  }
}

it('delivers onto the session branch and leaves Local completely untouched', async () => {
  const env = fixture()
  try {
    // 关掉「创建时继承 Local 未提交改动」这条既有策略：本用例只考察交付本身。
    // （那条策略会把 Local 工作区里**别人**的未提交文件一并带进 Worktree，属于
    // 另一个问题域；交付路径完全不读 Local，这一点下面逐条断言。）
    env.dependencies.inheritLocalChanges = false
    const module = createSessionCheckoutModule(env.dependencies)
    const launch = await module.createIsolatedTarget('source', 'owner', { topic: 'sleep-wake' })
    env.projects.set('owner-project', { id: 'owner-project', name: 'Owner', root: launch.managedRoot })
    env.sessions.set('owner', { id: 'owner', projectId: 'owner-project' })

    // 创建即建好会话分支：Worktree 不是 detached HEAD，分支名带上本会话与主题。
    const created = await module.inspect('owner')
    if (created.current.branch === null) throw Error('creation left the Worktree on a detached HEAD')
    const sessionBranch = created.current.branch
    expect(sessionBranch).toMatch(/^feat\/sess-owner--sleep-wake/u)
    // 分支从 Local 当时的 HEAD 起算（那是本次工作的基线），但它是**本会话自己的**
    // 分支，而不是 Local 正停着的那条他人分支。
    expect(env.git('rev-parse', `refs/heads/${sessionBranch}`)).toBe(env.otherHead)
    expect(sessionBranch).not.toBe('fix/sess-session--dock-action-click')
    // 分叉点不是 Local 当时所在的那条（他人的）分支。
    expect(env.git('symbolic-ref', 'HEAD')).toBe('refs/heads/fix/sess-session--dock-action-click')
    expect(env.git('rev-parse', 'HEAD')).toBe(env.otherHead)

    writeFileSync(join(launch.managedRoot, 'shared.txt'), 'base\nworktree edit\n')
    const ready = await module.inspect('owner')
    // 宿主运行期产物不能被卷进评审变更集（#2）。
    mkdirSync(join(launch.managedRoot, '.dsh-ops', 'panel'), { recursive: true })
    writeFileSync(join(launch.managedRoot, '.dsh-ops', 'panel', 'session-abc.ndjson'), '{"tick":1}\n')
    const delivered = await module.operate({
      action: 'finish',
      sessionId: 'owner',
      expectedRevision: ready.revision,
      commitMessage: 'fix: worktree edit',
      retention: 'cleanup',
    })
    if (delivered.status !== 'finished') throw Error(JSON.stringify(delivered))

    // 交付提交落在会话分支上；宿主运行期产物（.dsh-ops）绝不进变更集。
    // 注：创建阶段按既有「codex 对齐」策略会继承 Local 的未提交改动
    // （other-session-note.txt 因此出现在提交里），那是创建期行为，可用
    // inheritLocalChanges=false 关闭；交付本身完全不读 Local。
    expect(delivered.changedFiles).toContain('shared.txt')
    expect(delivered.changedFiles.filter(path => path.startsWith('.dsh-ops/'))).toEqual([])
    expect((delivered as { branch?: string }).branch).toBe(sessionBranch)
    expect(env.git('rev-parse', `refs/heads/${sessionBranch}`)).toBe(delivered.commitOid)
    // 会话分支从 Local 当时的 HEAD 起算（那是本次工作的基线），只多出交付这一个提交。
    expect(env.git('rev-list', '--count', `${env.otherHead}..${sessionBranch}`)).toBe('1')
    expect(env.git('show', '--name-only', '--pretty=format:', delivered.commitOid).split('\n').filter(Boolean))
      .toEqual(['shared.txt'])
    // Local 上那条他人分支的提交内容没有被带进会话分支。
    expect(env.git('rev-parse', `refs/heads/fix/sess-session--dock-action-click`)).toBe(env.otherHead)

    // Local 完全没被动过：HEAD、当前分支、他人的未提交改动、索引都保持原样。
    expect(env.git('rev-parse', 'HEAD')).toBe(env.otherHead)
    expect(env.git('symbolic-ref', 'HEAD')).toBe('refs/heads/fix/sess-session--dock-action-click')
    expect(env.git('status', '--porcelain')).toBe('?? other-session-note.txt')
    expect(readFileSync(join(env.repo, 'other-session-note.txt'), 'utf8')).toBe('someone else mid-edit\n')
    expect(readFileSync(join(env.repo, 'shared.txt'), 'utf8')).toBe('base\n')
    expect(env.git('rev-parse', 'refs/heads/main')).toBe(env.baseOid)
  } finally {
    env.cleanup()
  }
}, 120_000)

it('keeps a second session on its own branch even when both start from the same Local commit', async () => {
  const env = fixture()
  try {
    const module = createSessionCheckoutModule(env.dependencies)
    const first = await module.createIsolatedTarget('source', 'owner-a', { topic: 'alpha' })
    const second = await module.createIsolatedTarget('source', 'owner-b', { topic: 'alpha' })
    env.projects.set('a', { id: 'a', name: 'A', root: first.managedRoot })
    env.sessions.set('owner-a', { id: 'owner-a', projectId: 'a' })
    env.projects.set('b', { id: 'b', name: 'B', root: second.managedRoot })
    env.sessions.set('owner-b', { id: 'owner-b', projectId: 'b' })

    const branchOf = async (sessionId: string) => {
      const branch = (await module.inspect(sessionId)).current.branch
      if (branch === null) throw Error(`${sessionId} is detached`)
      return branch
    }
    // 同一主题、同一会话前缀不同的两个会话不允许抢同一条分支。
    expect(await branchOf('owner-a')).not.toBe(await branchOf('owner-b'))
    expect(await branchOf('owner-a')).toMatch(/^feat\/sess-owner-a--alpha/u)
    expect(await branchOf('owner-b')).toMatch(/^feat\/sess-owner-b--alpha/u)
  } finally {
    env.cleanup()
  }
}, 120_000)
