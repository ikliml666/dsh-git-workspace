/**
 * 真仓库验收：把「新建工作树」的完整链路在一个真实的、有几百个被跟踪文件的
 * 仓库上跑一遍，用的是 `lib/` 构建产物 —— Host 真正加载的那份代码。
 *
 * 默认跳过：它需要一个本机的真实仓库，别的机器上没有。指定仓库路径才跑：
 *
 *   REAL_REPO="E:/path/to/repo" npx vitest run tests/real-repo-acceptance.test.ts
 *
 * 跑完把建出来的树、分支、临时配置与工作区改动全部还原。
 */
import { afterAll, describe, expect, test } from 'vitest'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import type { Context } from '@deepseek-ai/cordis'
import { Session } from '@deepseek-ai/dsh-session'
import { createDshGitPort } from '../lib/adapters/git.js'
import { createSessionCheckoutModule } from '../lib/session-checkout-module.js'
import { createNodeSessionCheckoutDependencies } from './support/production-adapters.ts'
import { liveWorktreeRequest, mountWorktreeRequest, pendingWorktreeRequest, setWorktreeRequest } from '../lib/worktree-request.js'

const repo = process.env.REAL_REPO

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf-8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout.trim()
}

function report(label: string, data: Record<string, unknown>): void {
  console.log(JSON.stringify({ [label]: data }))
}

describe.skipIf(repo === undefined)('真仓库验收', () => {
  const root = repo ?? ''
  const configDir = join(root, '.acceptance-config')
  const pool = join(root, '.agents', 'worktrees')
  const createCalls: { branch: string; from: string }[] = []

  const sessions = new Map([['session-real', { id: 'session-real', projectId: 'project-real' }]])
  const projects = new Map([['project-real', { id: 'project-real', name: 'real', root }]])
  const dependencies = createNodeSessionCheckoutDependencies({
    configDir,
    lookup: {
      getSession: id => sessions.get(id),
      getProject: id => projects.get(id),
      getUnboundTargetPolicy: () => 'unselected',
    },
  })

  // 官方 worktrees 服务的等价实现：真跑 git worktree add，并在池目录写自忽略的
  // .gitignore（官方 prepareDirectory 的做法）。
  dependencies.officialWorktrees = () => ({
    create: async (_agent, request = {}) => {
      const branch = request.name ?? 'generated'
      const from = request.from ?? 'HEAD'
      createCalls.push({ branch, from })
      mkdirSync(pool, { recursive: true })
      writeFileSync(join(pool, '.gitignore'), '*\n')
      const path = join(pool, branch)
      git(root, 'worktree', 'add', '-b', branch, path, from)
      return { path, branch, baseCommit: git(path, 'rev-parse', 'HEAD'), repositoryRoot: root }
    },
    restore: async () => { throw new Error('not used') },
  })

  // 关键：用**生产** Git 适配器，不是测试夹具。production-adapters.ts 刻意不带
  // attachWorktreeBranch / captureLocalWip 等端口（多数用例走 detached HEAD 回退
  // 路径），拿它跑真仓库会静默跳过「会话分支挂载」这一环——而上一轮交付被拒的
  // bug 正出在这里。这里换成 Host 真正加载的那份适配器。
  //
  // runGit 通过 ctx.subprocess.spawn 跑命令，接口是 { argv, cwd, env } →
  // { done, terminate, waitForExit, collected:{stdout,stderr} }。
  const subprocessCtx = {
    subprocess: {
      spawn(spec: { argv: string[]; cwd: string; env: Record<string, string | undefined> }) {
        const child = spawn(spec.argv[0]!, spec.argv.slice(1), {
          cwd: spec.cwd,
          env: { ...process.env, ...spec.env },
        })
        let stdout = '', stderr = ''
        child.stdout?.on('data', chunk => { stdout += String(chunk) })
        child.stderr?.on('data', chunk => { stderr += String(chunk) })
        return {
          done: new Promise<{ exitCode: number | null }>(resolve => child.on('close', exitCode => resolve({ exitCode }))),
          terminate: () => { if (child.exitCode === null) child.kill() },
          waitForExit: async () => true,
          collected: {
            stdout: { readFrom: () => ({ text: stdout }) },
            stderr: { readFrom: () => ({ text: stderr }) },
          },
        }
      },
    },
  } as unknown as Context
  dependencies.git = createDshGitPort(subprocessCtx, { hooksPath: join(configDir, 'hooks') })

  const module = createSessionCheckoutModule(dependencies)
  const agent = { session: { id: 'session-real' } }
  // describe 回调在没有 REAL_REPO 时也会执行（skipIf 只跳 test，不跳收集），
  // 所以这里的 Git 读取必须等到 test 里再做，否则空路径会让整个文件在收集阶段
  // 崩掉、连累整套测试。
  let head = ''
  let branch = ''

  afterAll(() => {
    // 没跑过（REAL_REPO 缺失）就没有任何东西要还原。
    if (head === '') return
    // `git worktree list` 打印正斜杠，而 join() 在 Windows 上是反斜杠——直接
    // startsWith(pool) 永远为假，清理会静默失效并把树留在仓库里。比较前统一。
    const slashed = (value: string): string => value.replace(/\\/g, '/')
    for (const entry of git(root, 'worktree', 'list', '--porcelain').split('\n\n').filter(Boolean)) {
      const path = /^worktree (.+)$/m.exec(entry)?.[1]
      if (path !== undefined && slashed(path).startsWith(slashed(pool))) {
        spawnSync('git', ['worktree', 'remove', '--force', path], { cwd: root })
      }
    }
    spawnSync('git', ['worktree', 'prune'], { cwd: root })
    // 所有本文件造出来的会话分支都要清：pre-step 那条用的是 session-queued，
    // 只匹配 session-real 会把它漏在仓库里。
    for (const name of git(root, 'branch', '--list', 'feat/sess-session-*').split('\n').filter(Boolean)) {
      spawnSync('git', ['branch', '-D', name.trim()], { cwd: root })
    }
    rmSync(pool, { recursive: true, force: true })
    rmSync(configDir, { recursive: true, force: true })
    rmSync(join(root, '.worktreeinclude'), { force: true })
    rmSync(join(root, 'local-only'), { recursive: true, force: true })
    spawnSync('git', ['checkout', '--', '.'], { cwd: root })
    rmSync(join(root, 'tracked-change.txt'), { force: true })
    report('restored', {
      clean: git(root, 'status', '--porcelain') === '',
      worktrees: git(root, 'worktree', 'list').split('\n').length,
      branch: git(root, 'branch', '--show-current'),
      head: git(root, 'rev-parse', 'HEAD').slice(0, 8),
    })
  })

  test('建树 → 台账 → 评审 → 交付 → 清理，全程真实 Git', async () => {
    head = git(root, 'rev-parse', 'HEAD')
    branch = git(root, 'branch', '--show-current')
    report('repo', {
      branch,
      head: head.slice(0, 8),
      tracked: git(root, 'ls-files').split('\n').length,
      clean: git(root, 'status', '--porcelain') === '',
    })

    const started = performance.now()
    const launch = await module.createOfficialTarget(agent)
    const createMs = performance.now() - started
    report('create', { ms: Math.round(createMs), createCalls: createCalls.length, ...launch.target.checkout })

    expect(existsSync(launch.managedRoot)).toBe(true)
    expect(launch.target.checkout.kind).toBe('isolated')
    // 官方的布局：<repo>/.agents/worktrees/<branch>
    expect(launch.managedRoot).toContain(join('.agents', 'worktrees'))
    report('created-on-disk', {
      path: launch.managedRoot.replace(root, '<repo>'),
      isGitDir: existsSync(join(launch.managedRoot, '.git')),
      sameTrackedCount: git(launch.managedRoot, 'ls-files').split('\n').length === git(root, 'ls-files').split('\n').length,
      onOwnBranch: git(launch.managedRoot, 'branch', '--show-current'),
      detachedFromSameCommit: git(launch.managedRoot, 'rev-parse', 'HEAD') === head,
    })

    // 复用：已绑定且未放弃的会话不该建第二棵。
    const again = await module.createOfficialTarget(agent)
    expect(again.target.checkout.id).toBe(launch.target.checkout.id)
    expect(createCalls).toHaveLength(1)
    report('reuse', { createCalls: createCalls.length, sameCheckout: true })

    // 台账
    const listing = await module.listManagedWorktreesForSession('session-real')
    report('list', { count: listing.length, phases: listing.map(item => item.phase) })
    expect(listing).toHaveLength(1)

    // 改文件 → 评审 → 交付
    writeFileSync(join(launch.managedRoot, 'ACCEPTANCE.md'), '# acceptance\n')
    await module.markReadyForReview('session-real', {
      summary: '真仓库验收',
      validationStatus: 'passed',
      tests: [],
      suggestedCommitMessage: 'test: 真仓库验收',
    })
    const record = dependencies.registry.read().managedCheckouts[launch.target.checkout.id]!
    const deliverStarted = performance.now()
    const delivered = await module.operate({
      action: 'finish',
      sessionId: 'session-real',
      expectedRevision: record.revision,
      commitMessage: 'test: 真仓库验收',
      retention: 'cleanup',
    })
    report('deliver', {
      ms: Math.round(performance.now() - deliverStarted),
      status: delivered.status,
      checkoutId: launch.target.checkout.id.slice(0, 8),
    })
    expect(delivered.status).toBe('finished')
    report('after-deliver', {
      worktreeOnDisk: existsSync(launch.managedRoot),
      localHeadUnchanged: git(root, 'rev-parse', 'HEAD') === head,
      localBranchUnchanged: git(root, 'branch', '--show-current') === branch,
    })
    // 交付是往会话分支提交，不该动 Local 的 HEAD 与分支。
    expect(git(root, 'rev-parse', 'HEAD')).toBe(head)
    expect(git(root, 'branch', '--show-current')).toBe(branch)
  }, 180_000)

  test('已排队的请求在 turn 的第 1 步真的把树建出来并切进目录', async () => {
    // 这条链路此前只有假 module 的单元测试。这里用**真实** module、真实 Git 与
    // 真实仓库跑一遍 pre-step：请求 → 建树 → 工作目录切换。
    const session = Session.create('session-queued')
    const store = new Map([[session.id, session]])
    sessions.set('session-queued', { id: 'session-queued', projectId: 'project-real' })

    const moved: string[] = []
    const listeners: ((payload: unknown, next: () => unknown) => unknown)[] = []
    const ctx = {
      get: (name: string) => {
        if (name === 'sessions') return { get: (id: string) => store.get(id) }
        if (name === 'workingDirectory') {
          return { get: () => root, set: async (_agent: unknown, path: string) => { moved.push(path); return path } }
        }
        return undefined
      },
      on: (name: string, listener: (payload: unknown, next: () => unknown) => unknown) => {
        if (name === 'agent/pre-step') listeners.push(listener)
        return () => {}
      },
    }

    // 用真实的 mount 注册监听：这条链路的价值就在于它调用的是真 module。
    mountWorktreeRequest(ctx as never, module)

    setWorktreeRequest(ctx as never, session.id, 'main')
    expect(pendingWorktreeRequest(session)).toEqual({ from: 'main' })

    const agent = { session, inbox: { prepend: () => {} } }
    const next = () => 'continued'
    const result = await listeners[0]!({
      agent,
      step: 1,
      messages: [{ role: 'user', content: 'hi' }],
    }, next)

    const created = moved[0]
    report('pre-step-created', {
      result,
      cwd: created?.replace(root, '<repo>'),
      exists: created !== undefined && existsSync(created),
      requestCleared: pendingWorktreeRequest(session) === null,
    })
    expect(result).toBe('continued')
    expect(created).toBeDefined()
    expect(existsSync(created!)).toBe(true)
    // 建出来的就是官方布局里的会话分支树。
    expect(created).toContain(join('.agents', 'worktrees'))
    expect(pendingWorktreeRequest(session)).toBeNull()
    sessions.delete('session-queued')
  }, 180_000)

  test('待办请求能跨进程重放，也能撤回', () => {
    const session = Session.create('session-real')
    const store = new Map([[session.id, session]])
    const ctx = { get: (name: string) => (name === 'sessions' ? { get: (id: string) => store.get(id) } : undefined) }
    expect(pendingWorktreeRequest(session)).toBeNull()
    expect(setWorktreeRequest(ctx as never, session.id, 'main')).toEqual({ from: 'main' })
    expect(liveWorktreeRequest(ctx as never, session.id)).toEqual({ from: 'main' })
    // 重放整份日志（重启 / 刷新页面）必须得到同一个待办。
    expect(pendingWorktreeRequest(Session.create('session-real', session.snapshotEvents()))).toEqual({ from: 'main' })
    expect(setWorktreeRequest(ctx as never, session.id, undefined)).toBeNull()
    report('request-roundtrip', { ok: true })
  })
})
