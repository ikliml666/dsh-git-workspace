import { longCommitMessage } from './support/commit-message.js'
import { createHash } from 'node:crypto'
import { WorktreeCreationFailure } from '../src/creation-failure.js'
import { afterEach, describe, expect, test } from 'vitest'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import type { SessionCheckoutModule } from '../src/index.js'
import type { SessionCheckoutDependencies } from '../src/ports.js'
import { createSessionCheckoutApplyEngine, type SessionCheckoutApplyEngine } from '../src/session-checkout-apply.ts'

import { createSessionCheckoutModule } from '../src/session-checkout-module.ts'
import { createManagedWorktreeRepositoryKey } from '../src/managed-worktree-path.ts'
import { AtomicJsonCheckoutRegistry } from '../src/adapters/registry.ts'
import { createNodeSessionCheckoutDependencies } from './support/production-adapters.ts'

interface TestSession {
  id: string
  projectId?: string
  title?: string
}

interface TestProject {
  id: string
  name: string
  root: string
}

interface ManagedInspectPause {
  started: Promise<void>
  resume(): void
}

interface DirectoryMeasurePause {
  started: Promise<void>
  resume(): void
}

interface TestContext {
  root: string
  configDir: string
  projectRoot: string
  repositoryRoot: string
  module: SessionCheckoutModule
  restart(): SessionCheckoutModule
  pauseNextGitInspect(expectedPath?: string): ManagedInspectPause
  failNextGitInspect(expectedPath?: string): void
  pauseNextDirectoryMeasure(): DirectoryMeasurePause
  getRemoveWorktreeCallCount(): number
  getCreateWorktreeCallCount(): number
  getMeasureDirectoryCallCount(): number
  getContainerReclaimAttempts(): number
  setSessionProject(sessionId: string, projectId: string): void
  setProjectRoot(projectId: string, root: string): void
  setLiveSessions(next: readonly { id: string; createdAt?: number; cwd?: string }[]): void
  setSessionCwd(sessionId: string, cwd: string): void
  dependencies: SessionCheckoutDependencies
  addProject(projectId: string, name: string, root: string): void
  addSession(sessionId: string, projectId: string, title?: string): void
  removeSession(sessionId: string): void
  removeProject(projectId: string): void
}

const temporaryRoots: string[] = []

// Real Git/worktree integration is slower; the global timeout lives in vitest.config.ts (60s).

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} 失败: ${result.stderr}`)
  }
  return result.stdout.trim()
}

/** Same as git() but pins author/committer dates so tip-age filters can be tested. */
function gitDated(cwd: string, committerDate: string, ...args: string[]): string {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_DATE: committerDate, GIT_COMMITTER_DATE: committerDate },
  })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} 失败: ${result.stderr}`)
  }
  return result.stdout.trim()
}

function createContext(options: {
  projectSubdirectory?: string
  applyEngine?: SessionCheckoutApplyEngine
  crashAfterWorktreeCreate?: boolean
  rolledBackCreationCall?: number
  createWorktreeFailures?: number
  createWorktreeFailureLeavesFile?: boolean
  removeWorktreeFailures?: number
  transientRemoveWorktreeFailures?: number
  removeWorktreeFailureLeavesResidue?: boolean
  removeDirectoryTreeFailures?: number
  ensureDirectoryFailures?: number
  outerRepository?: boolean
  checkoutIds?: string[]
  autoDeliverRef?: () => boolean | undefined
  worktreeKeepCount?: number
} = {}): TestContext {
  // Compare physical paths consistently with the canonical roots persisted by the Host.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'domi-checkout-测试 空格-')))
  temporaryRoots.push(root)
  const repositoryRoot = join(root, '本地 project')
  const projectRoot = options.projectSubdirectory
    ? join(repositoryRoot, options.projectSubdirectory)
    : repositoryRoot
  const configDir = options.outerRepository
    ? realpathSync(mkdtempSync(join(tmpdir(), 'domi-checkout-config-')))
    : join(root, 'config')
  if (options.outerRepository) temporaryRoots.push(configDir)
  const sessions = new Map<string, TestSession>([
    ['session-1', { id: 'session-1', projectId: 'project-1', title: '测试思路' }],
    ['child-session', { id: 'child-session', projectId: 'project-1', title: '测试思路 (worktree)' }],
  ])
  // Workspace-contention inputs the guard reads; empty by default so existing
  // cases keep seeing a silent guard, exactly like a host without the store.
  let liveSessions: readonly { id: string; createdAt?: number; cwd?: string }[] = []
  const sessionCwds = new Map<string, string>()
  const projects = new Map<string, TestProject>([
    ['project-1', { id: 'project-1', name: '示例 Project', root: projectRoot }],
  ])

  if (options.outerRepository) {
    git(root, 'init', '-b', 'outer')
    git(root, 'config', 'user.name', 'Domi Outer Test')
    git(root, 'config', 'user.email', 'domi-outer@example.test')
    writeFileSync(join(root, 'outer.txt'), 'outer\n')
    git(root, 'add', 'outer.txt')
    git(root, 'commit', '-m', 'outer base')
  }

  git(root, 'init', '-b', 'main', repositoryRoot)
  mkdirSync(projectRoot, { recursive: true })
  git(projectRoot, 'config', 'user.name', 'Domi Test')
  git(projectRoot, 'config', 'user.email', 'domi@example.test')
  git(projectRoot, 'config', 'core.autocrlf', 'false')
  writeFileSync(join(projectRoot, 'tracked.txt'), 'base\n')
  git(projectRoot, 'add', 'tracked.txt')
  git(projectRoot, 'commit', '-m', 'base')

  const dependencies = createNodeSessionCheckoutDependencies({
    configDir,
    ...(options.autoDeliverRef ? { autoDeliver: { get: options.autoDeliverRef } } : {}),
    lookup: {
      getSession: (sessionId) => sessions.get(sessionId),
      getProject: (projectId) => projects.get(projectId),
      listLiveSessions: () => liveSessions,
      getSessionCwd: (sessionId) => sessionCwds.get(sessionId),
      markDelegationCheckoutReleased: (sessionId, releasedAt) => {
        const session = sessions.get(sessionId)
        if (!session) throw new Error(`测试会话不存在: ${sessionId}`)
        session.delegationCheckoutReleasedAt = releasedAt
      },
      getUnboundTargetPolicy: () => 'unselected',
    },
  })
  // 官方 `worktrees` 服务的替身：真的跑 `git worktree add`，落在官方布局
  // `<repo>/.agents/worktrees/<branch>` 下。建树路径统一走官方之后，测试要
  // 复现的是「Host 负责 Git、本插件负责台账」，而不是本插件自己建树。
  dependencies.officialWorktrees = () => ({
    create: async (_agent, request = {}) => {
      const branch = request.name ?? `dsh-test-${dependencies.createCheckoutId().slice(0, 8)}`
      const from = request.from ?? 'HEAD'
      const pool = join(repositoryRoot, '.agents', 'worktrees')
      mkdirSync(pool, { recursive: true })
      // 官方 prepareDirectory 会写一个自忽略的 .gitignore；漏掉它会让
      // 「继承本地未提交修改」把新树自己拷进自己。
      writeFileSync(join(pool, '.gitignore'), '*\n')
      const path = join(pool, branch)
      git(repositoryRoot, 'worktree', 'add', '-b', branch, path, from)
      return {
        path: realpathSync(path),
        branch,
        baseCommit: git(path, 'rev-parse', 'HEAD').trim(),
        repositoryRoot: realpathSync(repositoryRoot),
      }
    },
    restore: async () => { throw new Error('official restore is not used by these tests') },
  })
  if (options.checkoutIds !== undefined) {
    const generatedIds = [...options.checkoutIds]
    const defaultCreateCheckoutId = dependencies.createCheckoutId
    dependencies.createCheckoutId = () => generatedIds.shift() ?? defaultCreateCheckoutId()
  }
  if (options.worktreeKeepCount !== undefined) {
    dependencies.worktreeKeepCount = { get: () => options.worktreeKeepCount }
  }
  const inspectGit = dependencies.git.inspect
  let nextInspectPause: {
    expectedPath?: string
    signalStarted(): void
    waitForResume: Promise<void>
  } | undefined
  let nextInspectFailurePath: string | undefined
  dependencies.git.inspect = async (path) => {
    const canonicalPath = realpathSync.native(path)
    if (nextInspectFailurePath && canonicalPath === nextInspectFailurePath) {
      nextInspectFailurePath = undefined
      throw Object.assign(new Error('模拟 Git inspect 瞬时超时'), { code: 'ETIMEDOUT' })
    }
    const pause = nextInspectPause
    if (pause && (!pause.expectedPath || canonicalPath === pause.expectedPath)) {
      nextInspectPause = undefined
      pause.signalStarted()
      await pause.waitForResume
    }
    return inspectGit(path)
  }
  const removeWorktree = dependencies.git.removeWorktree
  let removeWorktreeCallCount = 0
  let removeWorktreeFailures = options.removeWorktreeFailures ?? 0
  let transientRemoveWorktreeFailures = options.transientRemoveWorktreeFailures ?? 0
  dependencies.git.removeWorktree = async (...args) => {
    removeWorktreeCallCount += 1
    if (transientRemoveWorktreeFailures > 0) {
      transientRemoveWorktreeFailures -= 1
      throw Object.assign(new Error('EPERM: Windows 正在使用 Worktree 目录'), { code: 'EPERM' })
    }
    if (removeWorktreeFailures > 0) {
      removeWorktreeFailures -= 1
      if (options.removeWorktreeFailureLeavesResidue) {
        rmSync(join(args[1], '.git'), { force: true })
        git(args[0], 'worktree', 'prune', '--expire', 'now')
        mkdirSync(join(args[1], 'service', 'node_modules', 'locked-package'), { recursive: true })
        mkdirSync(join(args[1], 'web', 'dist', 'assets'), { recursive: true })
        mkdirSync(join(args[1], 'tmp', 'design-prototypes'), { recursive: true })
        writeFileSync(join(args[1], 'service', 'node_modules', 'locked-package', 'index.js'), 'module.exports = true\n')
        writeFileSync(join(args[1], 'web', 'dist', 'assets', 'bundle.js'), 'console.log("residue")\n')
        writeFileSync(join(args[1], 'tmp', 'design-prototypes', 'notes.md'), '# cleanup residue\n')
      }
      throw new Error('模拟 Worktree 文件占用')
    }
    return removeWorktree(...args)
  }
  const removeDirectoryTree = dependencies.files.removeDirectoryTree
  let removeDirectoryTreeFailures = options.removeDirectoryTreeFailures ?? 0
  dependencies.files.removeDirectoryTree = async (...args) => {
    if (removeDirectoryTreeFailures > 0) {
      removeDirectoryTreeFailures -= 1
      throw new Error('模拟 quarantine 目录仍被占用')
    }
    await removeDirectoryTree(...args)
  }
  const ensureDirectory = dependencies.files.ensureDirectory
  let ensureDirectoryFailures = options.ensureDirectoryFailures ?? 0
  dependencies.files.ensureDirectory = (path) => {
    if (ensureDirectoryFailures > 0) {
      ensureDirectoryFailures -= 1
      throw Object.assign(new Error(`EPERM: operation not permitted, mkdir '${path}'`), { code: 'EPERM' })
    }
    return ensureDirectory(path)
  }
  if (options.applyEngine) dependencies.applyEngine = options.applyEngine
  // 容器回收是「未知内容不删」的判定点：记录它被调了几次，才能断言
  const removeEmptyDirectoryTree = dependencies.files.removeEmptyDirectoryTree
  let containerReclaimAttempts = 0
  dependencies.files.removeEmptyDirectoryTree = (path) => {
    containerReclaimAttempts += 1
    return removeEmptyDirectoryTree(path)
  }
  const measureDirectoryBytes = dependencies.files.measureDirectoryBytes
  let measureDirectoryCallCount = 0
  let nextDirectoryMeasurePause: {
    signalStarted(): void
    waitForResume: Promise<void>
  } | undefined
  dependencies.files.measureDirectoryBytes = async (...args) => {
    measureDirectoryCallCount += 1
    const pause = nextDirectoryMeasurePause
    if (pause) {
      nextDirectoryMeasurePause = undefined
      pause.signalStarted()
      await pause.waitForResume
    }
    return measureDirectoryBytes(...args)
  }
  const createDetachedWorktree = dependencies.git.createDetachedWorktree
  let createWorktreeCallCount = 0
  let createWorktreeFailures = options.createWorktreeFailures ?? 0
  dependencies.git.createDetachedWorktree = async (localRoot, managedRoot, baseOid) => {
    createWorktreeCallCount += 1
    if (createWorktreeCallCount === options.rolledBackCreationCall) throw new WorktreeCreationFailure('creation timed out and rolled back', true)
    if (createWorktreeFailures > 0) {
      createWorktreeFailures -= 1
      mkdirSync(join(managedRoot, 'web'), { recursive: true })
      if (options.createWorktreeFailureLeavesFile) {
        writeFileSync(join(managedRoot, 'web', 'unknown.txt'), '保留\n')
      }
      throw new Error('模拟 worktree add 留下半成品目录')
    }
    await createDetachedWorktree(localRoot, managedRoot, baseOid)
    if (options.crashAfterWorktreeCreate) {
      throw new Error('模拟 create 落盘后的进程崩溃')
    }
  }

  /**
   * 给某个会话造一棵「官方建的树」并接进台账。
   *
   * 旧创建器（本插件自建、worktreesRoot 布局）已随产品路径删除，测试改用真实
   * 产品 API 组合：先用 git 在官方布局下建树，再让 `adoptOfficialWorktree`
   * 把这棵树登记成该会话的 isolated target。这样用例验证的仍是台账、交付、
   * 迭代那一套服务端行为，而不是一条已不存在的创建代码。
   */
  async function createOwnerTarget(
    ownerSessionId: string,
    branch: string,
    from?: string,
  ): Promise<IsolatedTargetLaunch> {
    // 调用方常常只写会话 id 就建树；这里补齐会话与项目，避免每个用例重复登记。
    if (!sessions.has(ownerSessionId)) {
      sessions.set(ownerSessionId, { id: ownerSessionId, projectId: 'project-1', title: ownerSessionId })
    }
    const pool = join(repositoryRoot, '.agents', 'worktrees')
    mkdirSync(pool, { recursive: true })
    writeFileSync(join(pool, '.gitignore'), '*\n')
    const path = join(pool, branch)
    git(repositoryRoot, 'worktree', 'add', '-b', branch, path, from ?? 'HEAD')
    await module.adoptOfficialWorktree(ownerSessionId, realpathSync(path))
    const target = await module.inspect(ownerSessionId)
    if (target.checkout.kind !== 'isolated') throw new Error(`未登记成 isolated：${ownerSessionId}`)
    // 形状与旧创建器一致，用例不必改写读取方式。
    return { targetSessionId: ownerSessionId, managedRoot: realpathSync(path), target }
  }

  const module = createSessionCheckoutModule(dependencies)

  return {
    root,
    configDir,
    projectRoot,
    repositoryRoot,
    module,
    createOwnerTarget,
    restart: () => createSessionCheckoutModule(createNodeSessionCheckoutDependencies({
      configDir,
      lookup: dependencies.lookup,
    })),
    pauseNextGitInspect: (expectedPath) => {
      let signalStarted = (): void => undefined
      let resume = (): void => undefined
      const started = new Promise<void>((resolve) => { signalStarted = resolve })
      const waitForResume = new Promise<void>((resolve) => { resume = resolve })
      nextInspectPause = {
        ...(expectedPath ? { expectedPath: realpathSync.native(expectedPath) } : {}),
        signalStarted,
        waitForResume,
      }
      return { started, resume }
    },
    failNextGitInspect: (expectedPath) => {
      nextInspectFailurePath = realpathSync.native(expectedPath ?? projectRoot)
    },
    pauseNextDirectoryMeasure: () => {
      let signalStarted = (): void => undefined
      let resume = (): void => undefined
      const started = new Promise<void>((resolve) => { signalStarted = resolve })
      const waitForResume = new Promise<void>((resolve) => { resume = resolve })
      nextDirectoryMeasurePause = { signalStarted, waitForResume }
      return { started, resume }
    },
    getRemoveWorktreeCallCount: () => removeWorktreeCallCount,
    getCreateWorktreeCallCount: () => createWorktreeCallCount,
    getMeasureDirectoryCallCount: () => measureDirectoryCallCount,
    getContainerReclaimAttempts: () => containerReclaimAttempts,
    setSessionProject: (sessionId, projectId) => {
      const session = sessions.get(sessionId)
      if (session) session.projectId = projectId
    },
    setProjectRoot: (projectId, projectRoot) => {
      const project = projects.get(projectId)
      if (project) project.root = projectRoot
    },
    setLiveSessions: (next) => { liveSessions = next },
    setSessionCwd: (sessionId, cwd) => { sessionCwds.set(sessionId, cwd) },
    dependencies,
    addProject: (projectId, name, projectRoot) => {
      projects.set(projectId, { id: projectId, name, root: projectRoot })
    },
    addSession: (sessionId, projectId, title) => {
      sessions.set(sessionId, { id: sessionId, projectId, title })
    },
    setSessionDelegation: (sessionId, status, delegationId = `delegation-${sessionId}`) => {
      const session = sessions.get(sessionId)
      if (!session) throw new Error(`测试会话不存在: ${sessionId}`)
      session.sourceDelegationId = delegationId
      session.delegationStatus = status as TestSession['delegationStatus']
    },
    markSessionDelegationCheckoutReleased: (sessionId) => {
      const session = sessions.get(sessionId)
      if (!session) throw new Error(`测试会话不存在: ${sessionId}`)
      session.delegationCheckoutReleasedAt = Date.now()
    },
    removeSession: (sessionId) => {
      sessions.delete(sessionId)
    },
    removeProject: (projectId) => {
      projects.delete(projectId)
    },
  }
}

describe('SessionCheckoutModule', () => {
  test('Given an idle Session in the same checkout When contention is assembled Then it is not counted', async () => {
    const context = createContext()
    context.setLiveSessions([
      { id: 'session-1', cwd: context.projectRoot },
      { id: 'session-idle', cwd: context.projectRoot },
    ])
    context.dependencies.lookup.sessionAgentState = (sessionId) => ({ status: sessionId === 'session-idle' ? 'idle' : 'running' })
    expect(context.module.workspaceContention('session-1')).toBe('')
  })

  test('Given this Session already stands inside an official Worktree When contention is assembled Then no notice is emitted', async () => {
    const context = createContext()
    context.setLiveSessions([
      { id: 'session-1', cwd: context.projectRoot },
      { id: 'session-other', cwd: context.projectRoot },
    ])
    const tree = join(context.repositoryRoot, '.agents', 'worktrees', 'mine')
    expect(context.module.workspaceContention('session-1', tree)).toBe('')
  })

  test('Given another live Session shares the Local checkout When contention is assembled Then it directs this Session to worktree_create', async () => {
    const context = createContext()
    context.setLiveSessions([
      { id: 'session-1', cwd: context.projectRoot },
      { id: 'session-other', cwd: context.projectRoot },
    ])
    const text = context.module.workspaceContention('session-1')
    expect(text).toContain('Workspace contention: 1 other live Session is working')
    expect(text).toContain('worktree_create')
    expect(text).not.toContain('Branch "')
  })

  test('Given the Local branch is checked out by another Worktree When warmed and assembled Then the notice names that branch', async () => {
    const context = createContext()
    await context.module.bind('session-1', { kind: 'local' })
    context.setLiveSessions([{ id: 'session-1', cwd: context.projectRoot }])
    const otherWorktree = join(context.repositoryRoot, '.agents', 'worktrees', 'other')
    context.dependencies.git.worktreeOccupancy = async () => [
      { path: context.projectRoot, branch: 'main' },
      { path: otherWorktree, branch: 'main' },
    ]
    await context.module.warmWorkspaceContention?.()
    const text = context.module.workspaceContention('session-1')
    expect(text).toContain('Branch "main" is also checked out in another Worktree')
    expect(text).toContain(otherWorktree)
  })

  test('Given another live Session shares the Local checkout When the structural summary is read Then it lists that Session', async () => {
    const context = createContext()
    context.setLiveSessions([
      { id: 'session-1', cwd: context.projectRoot },
      { id: 'session-other', cwd: context.projectRoot },
    ])
    const summary = context.module.workspaceContentionSummary('session-1')
    expect(summary?.otherSessionIds).toEqual(['session-other'])
  })

  test('Given this Session already isolated When contention is assembled Then no notice is emitted', async () => {
    const context = createContext()
    await context.createOwnerTarget('session-1', 'feat/isolated')
    context.setLiveSessions([
      { id: 'session-1', cwd: context.projectRoot },
      { id: 'session-other', cwd: context.projectRoot },
    ])
    expect(context.module.workspaceContention('session-1')).toBe('')
  })

  test('Given another Session already works inside an official Worktree When contention is assembled Then it is not counted', async () => {
    const context = createContext()
    context.setLiveSessions([
      { id: 'session-1', cwd: context.projectRoot },
      { id: 'session-other', cwd: join(context.repositoryRoot, '.agents', 'worktrees', 'other') },
    ])
    expect(context.module.workspaceContention('session-1')).toBe('')
  })

  test('Given a host rewind owns the exclusive session mutation lock When bind starts Then checkout mutation waits until rewind releases', async () => {
    const context = createContext()
    await context.module.bind('session-1', { kind: 'local' })
    let signalStarted = (): void => undefined
    let release = (): void => undefined
    const started = new Promise<void>((resolve) => { signalStarted = resolve })
    const gate = new Promise<void>((resolve) => { release = resolve })
    const exclusive = context.module.runExclusiveSessionMutation('session-1', async (target) => {
      signalStarted()
      await gate
      return target.checkout.kind
    })
    await started

    let bindCompleted = false
    const bind = context.module.bind('session-1', { kind: 'local' }).then((view) => {
      bindCompleted = true
      return view
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(bindCompleted).toBe(false)

    release()
    expect(await exclusive).toBe('local')
    expect((await bind).checkout.kind).toBe('local')
  })

  test('Given 一个 Git 项目 When 会话绑定 Local Then inspect 展示项目与实时 branch/HEAD', async () => {
    const context = createContext()
    const expectedOid = git(context.projectRoot, 'rev-parse', 'HEAD')

    await context.module.bind('session-1', { kind: 'local' })
    const target = await context.module.inspect('session-1')

    expect(target).toEqual({
      project: { id: 'project-1', name: '示例 Project' },
      checkout: {
        id: 'local:project-1',
        kind: 'local',
        label: '本地检出',
        phase: 'ready',
      },
      source: { ref: 'refs/heads/main', oid: expectedOid },
      current: { branch: 'main', oid: expectedOid },
      ownership: 'owner',
      dirty: false,
      revision: 1,
    })
  })

  test('Given Local Checkout 在绑定后出现修改 When inspect Then dirty 实时变为 true', async () => {
    const context = createContext()
    await context.module.bind('session-1', { kind: 'local' })
    writeFileSync(join(context.projectRoot, 'tracked.txt'), 'local dirty\n')

    const target = await context.module.inspect('session-1')

    expect(target).toMatchObject({ ownership: 'owner', dirty: true })
  })

  test('Given batch observation When observing owned checkouts Then results align with the requested ids', async () => {
    const context = createContext()

    const first = await context.createOwnerTarget('target-session-1', 'feat/sess-target-session-1')
    const second = await context.createOwnerTarget('target-session-2', 'feat/sess-target-session-2')
    const observed = await context.module.observeManagedCheckouts([first.target.checkout.id, second.target.checkout.id])

    expect(observed.map(entry => entry.managedRoot)).toEqual([first.managedRoot, second.managedRoot])
    expect(observed.every(entry => entry.snapshot.root.length > 0 && typeof entry.dirty === 'boolean')).toBe(true)
    await expect(context.module.observeManagedCheckouts(['missing-checkout'])).rejects.toMatchObject({ code: 'checkout_missing' })
  })

  test('Given a reserved target session opens on another cwd When inspected Then identity validation fails closed', async () => {
    const context = createContext()
    await context.createOwnerTarget('target-session-1', 'feat/sess-target-session-1')
    context.addProject('wrong-workspace', 'Wrong Workspace', context.projectRoot)
    context.addSession('target-session-1', 'wrong-workspace')

    await expect(context.module.inspect('target-session-1')).rejects.toMatchObject({ code: 'project_mismatch' })
  })

  test('Given a normal Local Session When runtime context is assembled Then ordinary Local work ends without Worktree-only tools', async () => {
    const context = createContext()
    await context.module.bind('session-1', { kind: 'local' })

    const runtime = context.module.runtimeContext('session-1')

    expect(runtime).toContain('Session Target: Local Checkout')
    expect(runtime).toContain('current cwd')
    expect(runtime).toContain('ordinary assistant reply')
    expect(runtime).toContain('worktree_deliver')
    expect(runtime).toContain('worktree_cleanup')
    expect(runtime).toContain('worktree_begin_next_iteration')
    expect(runtime).not.toContain('Session Target is unselected')
    expect(runtime).not.toContain('Do not mutate project files')
  })

  test('Given the Session cwd sits in a subdirectory of the Worktree When runtime context is assembled Then the absolute-path rule is not re-imposed', async () => {
    const context = createContext()
    // In-place creation keeps the owner's own cwd, so this is the ordinary case:
    // the Session is inside the checkout but not exactly at its root.
    const launch = await context.createOwnerTarget('session-1', 'feat/sess-session-1')
    const nested = join(launch.managedRoot, 'src', 'nested')

    expect(context.module.runtimeContext('session-1', nested)).not.toContain('In-place binding')
    expect(context.module.runtimeContext('session-1', launch.managedRoot)).not.toContain('In-place binding')
    // Outside the Worktree (or no cwd knowledge) the rule still applies.
    expect(context.module.runtimeContext('session-1', context.projectRoot)).toContain('In-place binding')
    expect(context.module.runtimeContext('session-1')).toContain('In-place binding')
  })

  test('Given an unsynced Ready review When the owner requests more file changes Then editing resumes without touching Local', async () => {
    const context = createContext()
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const managedRoot = await context.module.resolveManagedRoot(target.checkout.id)
    writeFileSync(join(managedRoot, 'tracked.txt'), 'reviewed draft\n')
    const ready = await context.module.markReadyForReview('session-1', {
      summary: 'reviewed draft', validationStatus: 'passed', tests: [], suggestedCommitMessage: 'test: reviewed draft',
    })
    if (ready.delivery?.state !== 'ready_for_review') throw new Error('expected ready review')
    const localHead = git(context.projectRoot, 'rev-parse', 'HEAD')
    const localBytes = readFileSync(join(context.projectRoot, 'tracked.txt'), 'utf8')

    const resumed = await context.module.resumeRevision(
      'session-1',
      ready.revision,
      ready.delivery.review.reviewId,
    )

    expect(resumed).toMatchObject({
      checkout: { id: target.checkout.id, phase: 'ready' },
      revision: ready.revision + 1,
      delivery: { state: 'working', iteration: ready.delivery.review.iteration },
    })
    expect(git(context.projectRoot, 'rev-parse', 'HEAD')).toBe(localHead)
    expect(readFileSync(join(context.projectRoot, 'tracked.txt'), 'utf8')).toBe(localBytes)
    expect(readFileSync(join(managedRoot, 'tracked.txt'), 'utf8')).toBe('reviewed draft\n')
    // resume 之后状态回到 working：引导应指向 worktree_deliver，而不是已删除的评审工具。
    expect(context.module.runtimeContext('session-1')).toContain('worktree_deliver')
  })

  test('Given invalid commit bodies When any commit action is requested Then it rejects before persisting a mutation', async () => {
    const context = createContext()
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const managedRoot = await context.module.resolveManagedRoot(target.checkout.id)
    writeFileSync(join(managedRoot, 'tracked.txt'), 'invalid commit candidate\n')
    const ready = await context.module.markReadyForReview('session-1', {
      summary: 'invalid message regression', validationStatus: 'passed', tests: [], suggestedCommitMessage: 'test: valid suggestion',
    })
    if (ready.delivery?.state !== 'ready_for_review' || !ready.checkpointGeneration) throw new Error('expected ready')
    const registryPath = join(context.configDir, 'managed-checkouts.json')
    const before = readFileSync(registryPath, 'utf8')
    for (const action of ['checkpoint', 'finish', 'finalize_preview'] as const) {
      for (const commitMessage of [' \n ', 'feat: bad\0message']) {
        const result = await context.module.operate({
          action, sessionId: 'session-1', expectedRevision: ready.revision,
          expectedReviewId: ready.delivery.review.reviewId,
          expectedGeneration: ready.checkpointGeneration, requestId: `checkpoint:${ready.checkpointGeneration}`,
          commitMessage,
        })
        expect(result).toMatchObject({ status: 'error', code: 'invalid_input' })
        expect(readFileSync(registryPath, 'utf8')).toBe(before)
      }
    }
    await expect(context.module.markReadyForReview('session-1', {
      summary: 'invalid suggestion', validationStatus: 'passed', tests: [], suggestedCommitMessage: 'feat: bad\0message',
    })).rejects.toMatchObject({ code: 'invalid_input' })
    expect(readFileSync(registryPath, 'utf8')).toBe(before)
  })

  test('Given a long suggested commit message When a review becomes previous Then persistence and restart preserve the complete Unicode message', async () => {
    const context = createContext()
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const managedRoot = await context.module.resolveManagedRoot(target.checkout.id)
    writeFileSync(join(managedRoot, 'tracked.txt'), 'oversized review\n')
    const oversizedMessage = `${'x'.repeat(499)}😀${'y'.repeat(438)}`
    const ready = await context.module.markReadyForReview('session-1', {
      summary: 'oversized commit message', validationStatus: 'passed', tests: [], suggestedCommitMessage: oversizedMessage,
    })
    if (ready.delivery?.state !== 'ready_for_review') throw new Error('expected ready review')

    await context.module.resumeRevision('session-1', ready.revision, ready.delivery.review.reviewId)

    const registryPath = join(context.configDir, 'managed-checkouts.json')
    const persisted = JSON.parse(readFileSync(registryPath, 'utf8')) as any
    expect(persisted.managedCheckouts[target.checkout.id].previousReview.suggestedCommitMessage).toBe(oversizedMessage)
    expect(() => context.restart()).not.toThrow()

    persisted.managedCheckouts[target.checkout.id].previousReview.suggestedCommitMessage = oversizedMessage
    writeFileSync(registryPath, JSON.stringify(persisted, null, 2))
    const reloaded = new AtomicJsonCheckoutRegistry(registryPath).read()
    expect(reloaded.managedCheckouts[target.checkout.id].previousReview?.suggestedCommitMessage).toBe(oversizedMessage)
    const onDisk = JSON.parse(readFileSync(registryPath, 'utf8')) as any
    expect(onDisk.managedCheckouts[target.checkout.id].previousReview.suggestedCommitMessage).toBe(oversizedMessage)
  })

  test('Given oversized review fields When marking ready for review Then the module rejects with invalid_input', async () => {
    const context = createContext()
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const managedRoot = await context.module.resolveManagedRoot(target.checkout.id)
    writeFileSync(join(managedRoot, 'tracked.txt'), 'oversized fields\n')
    const base = { validationStatus: 'passed' as const, tests: [] }
    await expect(context.module.markReadyForReview('session-1', {
      ...base, summary: 'x'.repeat(241), suggestedCommitMessage: 'test: ok',
    })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(context.module.markReadyForReview('session-1', {
      ...base, summary: 'ok', suggestedCommitMessage: 'test: ok', validationSummary: 'x'.repeat(501),
    })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(context.module.markReadyForReview('session-1', {
      ...base, summary: 'ok', suggestedCommitMessage: 'test: ok', detailsMarkdown: 'x'.repeat(12001),
    })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(context.module.markReadyForReview('session-1', {
      ...base, summary: 'ok', suggestedCommitMessage: 'test: ok', tests: [{ command: 'x'.repeat(501), summary: 'ok' }],
    })).rejects.toMatchObject({ code: 'invalid_input' })
  })

  test('Given a long finish commit message When operating finish Then the complete body is committed on the session branch only', async () => {
    const context = createContext()
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const managedRoot = await context.module.resolveManagedRoot(target.checkout.id)
    writeFileSync(join(managedRoot, 'tracked.txt'), 'finish long body\n')
    const ready = await context.module.markReadyForReview('session-1', {
      summary: 'finish long body', validationStatus: 'passed', tests: [], suggestedCommitMessage: 'test: finish long body',
    })
    if (ready.delivery?.state !== 'ready_for_review') throw new Error('expected ready review')

    // 提交信息没有 500 字符上限（上游 eb1f49f）：多行 / Unicode 正文原样写进提交。
    const longFinishMessage = `feat: keep the whole body\n\n${'x'.repeat(499)}😀${'y'.repeat(438)}`
    const localHead = git(context.projectRoot, 'rev-parse', 'HEAD')
    const outcome = await context.module.operate({
      action: 'finish', sessionId: 'session-1', expectedRevision: ready.revision,
      expectedReviewId: ready.delivery.review.reviewId, commitMessage: longFinishMessage, retention: 'retain_manual',
    })
    expect(outcome).toMatchObject({ status: 'finished' })
    // 交付只落在会话分支：Local 的 HEAD 不动，Worktree 的 HEAD 是交付提交。
    expect(git(context.projectRoot, 'rev-parse', 'HEAD')).toBe(localHead)
    expect(git(managedRoot, 'show', '-s', '--format=%B', 'HEAD')).toBe(longFinishMessage)
  })

  test('Given an exact Ready review When checkpoint is confirmed Then it saves one Worktree-only stage, replays the same request idempotently, and final delivery remains one cumulative Local commit', async () => {
    const context = createContext({ checkoutIds: ['checkpoint-checkout', 'checkpoint-operation', 'checkpoint-id', 'checkpoint-mutation', 'finish-operation'] })
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const managedRoot = await context.module.resolveManagedRoot(target.checkout.id)
    writeFileSync(join(context.projectRoot, 'local-staged.txt'), 'keep staged\n')
    git(context.projectRoot, 'add', 'local-staged.txt')
    writeFileSync(join(context.projectRoot, 'local-untracked.txt'), 'keep untracked\n')
    const localHeadBefore = git(context.projectRoot, 'rev-parse', 'HEAD')
    const localStatusBefore = git(context.projectRoot, 'status', '--porcelain=v1', '-uall')

    writeFileSync(join(managedRoot, 'tracked.txt'), 'checkpoint stage one\n')
    writeFileSync(join(managedRoot, 'stage-one.txt'), 'stage one\n')
    const ready = await context.module.markReadyForReview('session-1', {
      summary: 'checkpoint stage one', validationStatus: 'passed', tests: [], suggestedCommitMessage: 'feat: checkpoint stage one',
    })
    if (ready.delivery?.state !== 'ready_for_review' || !ready.checkpointGeneration) throw new Error('expected checkpoint generation')
    const request = {
      action: 'checkpoint' as const,
      sessionId: 'session-1',
      expectedRevision: ready.revision,
      expectedReviewId: ready.delivery.review.reviewId,
      expectedGeneration: ready.checkpointGeneration,
      requestId: `checkpoint:${ready.checkpointGeneration}`,
      commitMessage: longCommitMessage,
    }

    const saved = await context.module.operate(request)
    if (saved.status === 'error') throw new Error(`${saved.code}: ${saved.message}`)

    expect(saved).toMatchObject({
      status: 'checkpointed',
      checkpoint: { sequence: 1, reviewId: ready.delivery.review.reviewId },
      target: { delivery: { state: 'working', iteration: 1 }, checkpoints: [expect.objectContaining({ sequence: 1 })] },
    })
    if (saved.status !== 'checkpointed') throw new Error('expected checkpointed')
    expect(git(context.projectRoot, 'rev-parse', 'HEAD')).toBe(localHeadBefore)
    expect(git(context.projectRoot, 'status', '--porcelain=v1', '-uall')).toBe(localStatusBefore)
    expect(git(managedRoot, 'status', '--porcelain=v1', '-uall')).toBe('')
    expect(git(managedRoot, 'rev-parse', 'HEAD')).not.toBe(localHeadBefore)
    expect(git(managedRoot, 'show', '-s', '--format=%B', 'HEAD')).toBe(longCommitMessage)
    const registry = new AtomicJsonCheckoutRegistry(join(context.configDir, 'managed-checkouts.json')).read()
    expect(registry.managedCheckouts[target.checkout.id]?.checkpoints?.[0]?.commitMessage).toBe(longCommitMessage)
    expect(() => context.restart()).not.toThrow()
    expect(context.module.runtimeContext('session-1')).toContain('Saved Worktree checkpoints: 1')
    expect(context.module.runtimeContext('session-1')).toContain('remain unpublished to Local')

    const replayed = await context.restart().operate(request)
    expect(replayed).toMatchObject({ status: 'checkpointed', checkpoint: { checkpointId: saved.checkpoint.checkpointId, sequence: 1 } })
    expect((await context.module.inspect('session-1')).checkpoints).toHaveLength(1)

    writeFileSync(join(managedRoot, 'stage-two.txt'), 'stage two\n')
    const finalReady = await context.module.markReadyForReview('session-1', {
      summary: 'cumulative final review', validationStatus: 'passed', tests: [], suggestedCommitMessage: 'feat: deliver cumulative task',
    })
    if (finalReady.delivery?.state !== 'ready_for_review') throw new Error('expected final ready')
    const finished = await context.module.operate({
      action: 'finish', sessionId: 'session-1', expectedRevision: finalReady.revision,
      expectedReviewId: finalReady.delivery.review.reviewId,
      commitMessage: longCommitMessage, retention: 'retain_manual',
    })

    expect(finished).toMatchObject({ status: 'finished', cleanup: 'retained' })
    if (finished.status !== 'finished') throw new Error(`expected finished, got ${finished.status}`)
    // 交付只落在会话分支：Local 的 HEAD、索引、未跟踪文件一个字节都不动。
    expect(git(context.projectRoot, 'rev-parse', 'HEAD')).toBe(localHeadBefore)
    expect(git(managedRoot, 'rev-parse', 'HEAD')).toBe(finished.commitOid)
    expect(finished.changedFiles.slice().sort()).toEqual(['stage-one.txt', 'stage-two.txt', 'tracked.txt'])
    expect(git(context.projectRoot, 'diff', '--cached', '--name-only')).toBe('local-staged.txt')
    expect(readFileSync(join(context.projectRoot, 'local-untracked.txt'), 'utf8')).toBe('keep untracked\n')
  })

  test('Given a long checkpoint message journaled before a crash When Host restarts Then recovery and replay retain the exact body', async () => {
    const engine = createSessionCheckoutApplyEngine()
    const checkpoint = engine.checkpoint.bind(engine)
    engine.checkpoint = input => checkpoint({
      ...input,
      beforeCommit: async prepared => {
        await input.beforeCommit?.(prepared)
        throw new Error('simulate interruption after checkpoint journal persistence')
      },
    })
    const context = createContext({ applyEngine: engine })
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const managedRoot = await context.module.resolveManagedRoot(target.checkout.id)
    writeFileSync(join(managedRoot, 'tracked.txt'), 'recover long checkpoint\n')
    const ready = await context.module.markReadyForReview('session-1', {
      summary: 'checkpoint recovery', validationStatus: 'passed', tests: [], suggestedCommitMessage: longCommitMessage,
    })
    if (ready.delivery?.state !== 'ready_for_review' || !ready.checkpointGeneration) throw new Error('expected ready')
    const request = {
      action: 'checkpoint' as const, sessionId: 'session-1', expectedRevision: ready.revision,
      expectedReviewId: ready.delivery.review.reviewId, expectedGeneration: ready.checkpointGeneration,
      requestId: `checkpoint:${ready.checkpointGeneration}`, commitMessage: longCommitMessage,
    }
    expect(await context.module.operate(request)).toMatchObject({ status: 'error', code: 'git_error' })
    const registryPath = join(context.configDir, 'managed-checkouts.json')
    const journaled = new AtomicJsonCheckoutRegistry(registryPath).read().managedCheckouts[target.checkout.id]
    expect(journaled?.journal).toMatchObject({ operation: 'checkpoint', checkpointMessage: longCommitMessage })
    if (!journaled?.journal?.commitOid || !journaled.journal.parentOid) throw new Error('expected prepared checkpoint')
    // Model a process stop after HEAD CAS, before completing the journal/index update.
    git(managedRoot, 'update-ref', '--no-deref', 'HEAD', journaled.journal.commitOid, journaled.journal.parentOid)
    const restarted = context.restart()
    await restarted.reconcile()
    const recovered = new AtomicJsonCheckoutRegistry(registryPath).read().managedCheckouts[target.checkout.id]
    expect(recovered?.journal).toBeNull()
    expect(recovered?.checkpoints?.[0]?.commitMessage).toBe(longCommitMessage)
    expect(git(managedRoot, 'show', '-s', '--format=%B', 'HEAD')).toBe(longCommitMessage)
    expect(await restarted.operate(request)).toMatchObject({ status: 'checkpointed', checkpoint: { sequence: 1 } })
  })

  test('Given an active Local Preview When checkpoint is confirmed Then Host rolls back the receipt first and saves the reviewed Worktree stage without leaving Preview bytes in Local', async () => {
    const context = createContext()
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const managedRoot = await context.module.resolveManagedRoot(target.checkout.id)
    writeFileSync(join(context.projectRoot, 'local-note.txt'), 'preserve local note\n')
    const localBefore = readFileSync(join(context.projectRoot, 'tracked.txt'), 'utf8')
    const statusBefore = git(context.projectRoot, 'status', '--porcelain=v1', '-uall')
    writeFileSync(join(managedRoot, 'tracked.txt'), 'preview checkpoint stage\n')
    const ready = await context.module.markReadyForReview('session-1', {
      summary: 'preview checkpoint', validationStatus: 'passed', tests: [], suggestedCommitMessage: 'feat: preview checkpoint',
    })
    if (ready.delivery?.state !== 'ready_for_review') throw new Error('expected ready')
    const previewed = await context.module.operate({ action: 'preview', sessionId: 'session-1', expectedRevision: ready.revision })
    if (previewed.status !== 'previewed' || previewed.target.delivery?.state !== 'preview_active' || !previewed.target.checkpointGeneration) {
      throw new Error('expected preview generation')
    }
    expect(readFileSync(join(context.projectRoot, 'tracked.txt'), 'utf8').replace(/\r\n/gu, '\n')).toBe('preview checkpoint stage\n')

    const saved = await context.module.operate({
      action: 'checkpoint', sessionId: 'session-1', expectedRevision: previewed.target.revision,
      expectedReviewId: previewed.target.delivery.review.reviewId,
      expectedGeneration: previewed.target.checkpointGeneration,
      requestId: `checkpoint:${previewed.target.checkpointGeneration}`,
      commitMessage: 'feat(checkpoint): save preview stage',
    })

    expect(saved).toMatchObject({ status: 'checkpointed', target: { delivery: { state: 'working' } } })
    expect(readFileSync(join(context.projectRoot, 'tracked.txt'), 'utf8').replace(/\r\n/gu, '\n')).toBe(localBefore.replace(/\r\n/gu, '\n'))
    expect(readFileSync(join(context.projectRoot, 'local-note.txt'), 'utf8')).toBe('preserve local note\n')
    expect(git(context.projectRoot, 'status', '--porcelain=v1', '-uall')).toBe(statusBefore)
  })

  test('Given a stale or foreign checkpoint identity When checkpoint is requested Then it fails closed before changing Worktree or Local', async () => {
    const context = createContext()
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const managedRoot = await context.module.resolveManagedRoot(target.checkout.id)
    writeFileSync(join(managedRoot, 'tracked.txt'), 'checkpoint candidate\n')
    const ready = await context.module.markReadyForReview('session-1', {
      summary: 'checkpoint candidate', validationStatus: 'passed', tests: [], suggestedCommitMessage: 'test: checkpoint candidate',
    })
    if (ready.delivery?.state !== 'ready_for_review' || !ready.checkpointGeneration) throw new Error('expected generation')
    const localHead = git(context.projectRoot, 'rev-parse', 'HEAD')
    const managedHead = git(managedRoot, 'rev-parse', 'HEAD')

    expect(await context.module.operate({
      action: 'checkpoint', sessionId: 'session-1', expectedRevision: ready.revision,
      expectedReviewId: 'stale-review', expectedGeneration: ready.checkpointGeneration,
      requestId: 'checkpoint:stale-review', commitMessage: 'test: stale',
    })).toMatchObject({ status: 'error', code: 'stale_target' })
    expect(await context.module.operate({
      action: 'checkpoint', sessionId: 'session-1', expectedRevision: ready.revision,
      expectedReviewId: ready.delivery.review.reviewId, expectedGeneration: '0'.repeat(64),
      requestId: 'checkpoint:stale-generation', commitMessage: 'test: stale',
    })).toMatchObject({ status: 'error', code: 'stale_target' })
    expect(git(context.projectRoot, 'rev-parse', 'HEAD')).toBe(localHead)
    expect(git(managedRoot, 'rev-parse', 'HEAD')).toBe(managedHead)
  })

  test('Given an exact apply conflict When recovery resumes Then Host CAS persists a proof for the new Working revision without touching Local', async () => {
    const context = createContext()
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const managedRoot = await context.module.resolveManagedRoot(target.checkout.id)
    writeFileSync(join(managedRoot, 'tracked.txt'), 'task version\n')
    const ready = await context.module.markReadyForReview('session-1', {
      summary: 'conflicting draft', validationStatus: 'passed', tests: [], suggestedCommitMessage: 'test: conflict recovery',
    })
    if (ready.delivery?.state !== 'ready_for_review') throw new Error('expected ready review')
    writeFileSync(join(context.projectRoot, 'tracked.txt'), 'local version\n')
    const localBytes = readFileSync(join(context.projectRoot, 'tracked.txt'), 'utf8')
    const preflight = await context.module.preflight?.('session-1', ready.revision)
    if (!preflight || preflight.status !== 'conflict') throw new Error('expected conflict preflight')
    expect(preflight.conflictingFiles).toEqual(['tracked.txt'])
    expect(preflight.conflictDetails?.[0]?.file).toBe('tracked.txt')
    expect(preflight.conflictDetails?.[0]?.diff).toContain('<<<')

    const resumed = await context.module.resumeRevision(
      'session-1',
      ready.revision,
      ready.delivery.review.reviewId,
      {
        kind: 'worktree_apply_conflict',
        requestId: 'host-conflict-proof-1',
        reviewId: ready.delivery.review.reviewId,
        readyRevision: ready.revision,
        localHeadOid: preflight.localHeadOid,
        conflictingFiles: [...preflight.conflictingFiles],
      },
    )

    expect(resumed).toMatchObject({ revision: ready.revision + 1, delivery: { state: 'working' } })
    expect(readFileSync(join(context.projectRoot, 'tracked.txt'), 'utf8')).toBe(localBytes)
    const registry = JSON.parse(readFileSync(join(context.configDir, 'managed-checkouts.json'), 'utf8')) as any
    expect(registry.managedCheckouts[target.checkout.id].recoveryContinuation).toEqual({
      kind: 'worktree_apply_conflict',
      requestId: 'host-conflict-proof-1',
      reviewId: ready.delivery.review.reviewId,
      readyRevision: ready.revision,
      workingRevision: ready.revision + 1,
      localHeadOid: preflight.localHeadOid,
      conflictingFiles: preflight.conflictingFiles,
    })
  })

  test('Given stale isolated bytes When regeneration is prepared Then Ready remains read-only and Host persists the exact proof', async () => {
    const context = createContext()
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const managedRoot = await context.module.resolveManagedRoot(target.checkout.id)
    writeFileSync(join(managedRoot, 'tracked.txt'), 'reviewed version\n')
    const ready = await context.module.markReadyForReview('session-1', {
      summary: 'stale draft', validationStatus: 'passed', tests: [], suggestedCommitMessage: 'test: regenerate review',
    })
    if (ready.delivery?.state !== 'ready_for_review') throw new Error('expected ready review')
    writeFileSync(join(managedRoot, 'tracked.txt'), 'changed after review\n')
    const localBytes = readFileSync(join(context.projectRoot, 'tracked.txt'), 'utf8')

    const proof = await context.module.prepareReviewRegeneration?.(
      'session-1', ready.revision, ready.delivery.review.reviewId, 'host-regeneration-proof-1',
    )

    expect(proof).toEqual({
      kind: 'worktree_review_regeneration',
      requestId: 'host-regeneration-proof-1',
      reviewId: ready.delivery.review.reviewId,
      revision: ready.revision,
    })
    expect(await context.module.inspect('session-1')).toMatchObject({
      revision: ready.revision,
      delivery: { state: 'ready_for_review', review: { reviewId: ready.delivery.review.reviewId } },
    })
    expect(readFileSync(join(context.projectRoot, 'tracked.txt'), 'utf8')).toBe(localBytes)
    const registry = JSON.parse(readFileSync(join(context.configDir, 'managed-checkouts.json'), 'utf8')) as any
    expect(registry.managedCheckouts[target.checkout.id].recoveryContinuation).toEqual(proof)
  })

  test('Given a stale or foreign Ready review When resume is requested Then it fails closed and preserves the review', async () => {
    const context = createContext()
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const managedRoot = await context.module.resolveManagedRoot(target.checkout.id)
    writeFileSync(join(managedRoot, 'tracked.txt'), 'reviewed draft\n')
    const ready = await context.module.markReadyForReview('session-1', {
      summary: 'reviewed draft', validationStatus: 'passed', tests: [], suggestedCommitMessage: 'test: reviewed draft',
    })
    if (ready.delivery?.state !== 'ready_for_review') throw new Error('expected ready review')

    await expect(context.module.resumeRevision('session-1', ready.revision, 'old-review'))
      .rejects.toMatchObject({ code: 'stale_target' })
    context.addSession('session-2', 'project-1')
    await expect(context.module.resumeRevision('session-2', ready.revision, ready.delivery.review.reviewId))
      .rejects.toMatchObject({ code: 'target_unselected' })
    expect((await context.module.inspect('session-1')).delivery).toMatchObject({
      state: 'ready_for_review', review: { reviewId: ready.delivery.review.reviewId },
    })
  })

  test('Given a confirmed creation rollback When bind fails Then original Local remains usable and a manual retry succeeds without hidden retries', async () => {
    const context = createContext({ rolledBackCreationCall: 1 })
    await expect(context.module.bind('session-1', { kind: 'isolated' })).rejects.toMatchObject({ code: 'git_operation_failed' })
    expect(context.getCreateWorktreeCallCount()).toBe(1)
    await expect(context.module.inspect('session-1')).rejects.toMatchObject({ code: 'target_unselected' })
    expect(git(context.projectRoot, 'status', '--porcelain')).toBe('')
    const retry = await context.module.bind('session-1', { kind: 'isolated' })
    expect(retry.checkout.phase).toBe('ready')
    expect(context.getCreateWorktreeCallCount()).toBe(2)
  })

  test('Given a cleaned delivered owner Session When it begins the next iteration Then the same Session and cwd receive a new checkout from the previous session branch', async () => {
    const context = createContext({
      checkoutIds: ['checkout-first', 'operation-first', 'checkout-failed', 'operation-failed', 'checkout-second', 'operation-second'],
      // 建树已改走官方服务，不再经过 createDetachedWorktree：第一次迭代就是这里的第 1 次调用。
      rolledBackCreationCall: 1,
    })
    const launch = await context.createOwnerTarget('target-session-1', 'feat/sess-target-session-1')
    context.addProject('target-workspace-1', 'Target Workspace', launch.managedRoot)
    context.addSession('target-session-1', 'target-workspace-1')
    writeFileSync(join(launch.managedRoot, 'tracked.txt'), 'first iteration\n')
    const ready = await context.module.markReadyForReview('target-session-1', {
      summary: 'first iteration', validationStatus: 'passed', tests: [], suggestedCommitMessage: 'test: first iteration',
    })
    if (ready.delivery?.state !== 'ready_for_review') throw new Error('expected first review')
    const finished = await context.module.operate({
      action: 'finish', sessionId: 'target-session-1', expectedRevision: ready.revision,
      expectedReviewId: ready.delivery.review.reviewId, commitMessage: 'test: first iteration', retention: 'cleanup',
    })
    if (finished.status !== 'finished') throw new Error(`expected finished, got ${finished.status}`)
    expect(finished.cleanup).toBe('discarded')
    expect(existsSync(launch.managedRoot)).toBe(false)
    expect(context.module.runtimeContext('target-session-1')).toContain('worktree_begin_next_iteration')
    expect(context.module.runtimeContext('target-session-1')).toContain('Do not call worktree_create')

    writeFileSync(join(context.projectRoot, 'local-next.txt'), 'latest local head\n')
    git(context.projectRoot, 'add', 'local-next.txt')
    git(context.projectRoot, 'commit', '-m', 'local advances before iteration 2')
    const latestLocalHead = git(context.projectRoot, 'rev-parse', 'HEAD')

    await expect(context.module.beginNextIteration('target-session-1', finished.target.revision)).rejects.toMatchObject({ code: 'git_operation_failed' })
    const restored = await context.module.inspect('target-session-1')
    expect(restored.checkout.id).toBe(finished.target.checkout.id)
    expect(restored.delivery?.state).toBe('delivered')
    const next = await context.module.beginNextIteration('target-session-1', restored.revision)
    // 交付只写会话分支、Local 不动，所以新迭代以「上一轮会话分支的 tip」为起点：
    // 起点包含上一轮的交付提交，而不是 Local 现在指向的那个新提交。
    const previousTip = git(context.repositoryRoot, 'rev-parse', 'feat/sess-target-session-1').trim()
    expect(next).toMatchObject({
      checkout: { kind: 'isolated', phase: 'ready' },
      delivery: { state: 'working', iteration: 2 },
      current: { oid: previousTip },
    })
    expect(next.current.oid).not.toBe(latestLocalHead)
    expect(next.checkout.id).not.toBe(launch.target.checkout.id)
    expect(await context.module.resolveManagedRoot(next.checkout.id)).toBe(launch.managedRoot)
    // 起点是上一轮会话分支的 tip，不是 Local 后来推进的提交：Local 那份工作
    // 要等用户显式合并才进 Worktree，这条断言就是那个语义的守卫。
    expect(existsSync(join(launch.managedRoot, 'local-next.txt'))).toBe(false)
    expect((await context.module.inspect('target-session-1')).checkout.id).toBe(next.checkout.id)
    const persisted = JSON.parse(readFileSync(join(context.configDir, 'managed-checkouts.json'), 'utf8')) as {
      managedCheckouts: Record<string, { phase: string; delivery: { state: string; iteration: number } }>
    }
    expect(persisted.managedCheckouts[launch.target.checkout.id]).toMatchObject({
      phase: 'discarded', delivery: { state: 'delivered', iteration: 1 },
    })
  }, 60_000)

  test('Given a cleaned delivered owner Session When the immutable cwd path reappears Then the next iteration refuses to overwrite it', async () => {
    const context = createContext()
    const launch = await context.createOwnerTarget('target-session-1', 'feat/sess-target-session-1')
    context.addProject('target-workspace-1', 'Target Workspace', launch.managedRoot)
    context.addSession('target-session-1', 'target-workspace-1')
    writeFileSync(join(launch.managedRoot, 'tracked.txt'), 'first iteration\n')
    const ready = await context.module.markReadyForReview('target-session-1', {
      summary: 'first iteration', validationStatus: 'passed', tests: [], suggestedCommitMessage: 'test: first iteration',
    })
    if (ready.delivery?.state !== 'ready_for_review') throw new Error('expected first review')
    const finished = await context.module.operate({
      action: 'finish', sessionId: 'target-session-1', expectedRevision: ready.revision,
      expectedReviewId: ready.delivery.review.reviewId, commitMessage: 'test: first iteration', retention: 'cleanup',
    })
    if (finished.status !== 'finished') throw new Error(`expected finished, got ${finished.status}`)
    mkdirSync(launch.managedRoot, { recursive: true })
    writeFileSync(join(launch.managedRoot, 'foreign.txt'), 'do not overwrite\n')

    await expect(context.module.beginNextIteration('target-session-1', finished.target.revision))
      .rejects.toMatchObject({ code: 'checkout_mismatch' })
    expect(readFileSync(join(launch.managedRoot, 'foreign.txt'), 'utf8')).toBe('do not overwrite\n')
    expect((await context.module.inspect('target-session-1')).delivery).toMatchObject({ state: 'delivered', iteration: 1 })
  }, 30_000)

  test('Given an in-place delivered Session still rooted at the Local boundary When it begins the next iteration Then the iteration starts instead of failing as a project mismatch', async () => {
    const context = createContext()
    // In-place binding: the Session owns the checkout while its workspace root
    // stays the Local boundary (the managed root is gone after cleanup), so
    // accepting only the managed root rejected every in-place next iteration.
    const launch = await context.createOwnerTarget('session-1', 'feat/sess-session-1')
    expect(launch.targetSessionId).toBe('session-1')
    writeFileSync(join(launch.managedRoot, 'tracked.txt'), 'first iteration\n')
    const ready = await context.module.markReadyForReview('session-1', {
      summary: 'first iteration', validationStatus: 'passed', tests: [], suggestedCommitMessage: 'test: first iteration',
    })
    if (ready.delivery?.state !== 'ready_for_review') throw new Error('expected first review')
    const finished = await context.module.operate({
      action: 'finish', sessionId: 'session-1', expectedRevision: ready.revision,
      expectedReviewId: ready.delivery.review.reviewId, commitMessage: 'test: first iteration', retention: 'cleanup',
    })
    if (finished.status !== 'finished') throw new Error(`expected finished, got ${finished.status}`)
    expect(existsSync(launch.managedRoot)).toBe(false)

    const next = await context.module.beginNextIteration('session-1', finished.target.revision)

    expect(next).toMatchObject({ checkout: { kind: 'isolated', phase: 'ready' }, delivery: { state: 'working', iteration: 2 } })
  }, 30_000)

  test('Given a delivered and cleaned Worktree When runtime context is assembled Then it stops claiming the deleted directory as the authoritative cwd', async () => {
    const context = createContext()
    const launch = await context.createOwnerTarget('session-1', 'feat/sess-session-1')
    writeFileSync(join(launch.managedRoot, 'tracked.txt'), 'first iteration\n')
    const ready = await context.module.markReadyForReview('session-1', {
      summary: 'first iteration', validationStatus: 'passed', tests: [], suggestedCommitMessage: 'test: first iteration',
    })
    if (ready.delivery?.state !== 'ready_for_review') throw new Error('expected first review')
    const finished = await context.module.operate({
      action: 'finish', sessionId: 'session-1', expectedRevision: ready.revision,
      expectedReviewId: ready.delivery.review.reviewId, commitMessage: 'test: first iteration', retention: 'cleanup',
    })
    if (finished.status !== 'finished') throw new Error(`expected finished, got ${finished.status}`)
    expect(existsSync(launch.managedRoot)).toBe(false)

    const runtime = context.module.runtimeContext('session-1')

    expect(runtime).not.toContain(`Authoritative cwd: ${launch.managedRoot}`)
    expect(runtime).not.toContain('never write directly to the Original Local boundary')
    expect(runtime).toContain('delivered and cleaned')
    expect(runtime).toContain('Ordinary Local work is allowed again')
    expect(runtime).toContain('worktree_begin_next_iteration')
  }, 30_000)

  test('Given the process stops before recreating a cleaned cwd When reconcile runs Then the predecessor binding is restored', async () => {
    const context = createContext()
    const launch = await context.createOwnerTarget('target-session-1', 'feat/sess-target-session-1')
    context.addProject('target-workspace-1', 'Target Workspace', launch.managedRoot)
    context.addSession('target-session-1', 'target-workspace-1')
    writeFileSync(join(launch.managedRoot, 'tracked.txt'), 'first iteration\n')
    const ready = await context.module.markReadyForReview('target-session-1', {
      summary: 'first iteration', validationStatus: 'passed', tests: [], suggestedCommitMessage: 'test: first iteration',
    })
    if (ready.delivery?.state !== 'ready_for_review') throw new Error('expected first review')
    const finished = await context.module.operate({
      action: 'finish', sessionId: 'target-session-1', expectedRevision: ready.revision,
      expectedReviewId: ready.delivery.review.reviewId, commitMessage: 'test: first iteration', retention: 'cleanup',
    })
    if (finished.status !== 'finished') throw new Error(`expected finished, got ${finished.status}`)

    const registryPath = join(context.configDir, 'managed-checkouts.json')
    const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as {
      revision: number
      sessionBindings: Record<string, any>
      managedCheckouts: Record<string, any>
    }
    const predecessor = registry.managedCheckouts[launch.target.checkout.id]
    registry.managedCheckouts['interrupted-next'] = {
      ...predecessor,
      checkoutId: 'interrupted-next',
      predecessorCheckoutId: predecessor.checkoutId,
      phase: 'preparing',
      delivery: { state: 'working', iteration: 2 },
      journal: { operation: 'create', operationId: 'interrupted-op', step: 'creating_worktree', startedAt: Date.now() },
      revision: predecessor.revision + 1,
    }
    registry.sessionBindings['target-session-1'] = {
      ...registry.sessionBindings['target-session-1'],
      target: { kind: 'isolated', checkoutId: 'interrupted-next' },
      revision: registry.sessionBindings['target-session-1'].revision + 1,
    }
    registry.revision += 1
    writeFileSync(registryPath, JSON.stringify(registry, null, 2))

    const restarted = context.restart()
    await restarted.reconcile()
    const restored = await restarted.inspect('target-session-1')
    expect(restored).toMatchObject({
      checkout: { id: launch.target.checkout.id, phase: 'discarded' },
      delivery: { state: 'delivered', iteration: 1 },
    })
    const persisted = JSON.parse(readFileSync(registryPath, 'utf8')) as { managedCheckouts: Record<string, unknown> }
    expect(persisted.managedCheckouts['interrupted-next']).toBeUndefined()
  }, 30_000)

  test('Given merged and unmerged local branches When the session prunes Then only fully merged ones are deleted', async () => {
    const context = createContext()
    const projectRoot = context.projectRoot
    git(projectRoot, 'branch', 'merged-branch')
    git(projectRoot, 'checkout', '-b', 'unmerged-branch')
    writeFileSync(join(projectRoot, 'unmerged.txt'), 'unmerged', 'utf8')
    git(projectRoot, 'add', 'unmerged.txt')
    git(projectRoot, 'commit', '-m', 'unmerged work')
    git(projectRoot, 'checkout', 'main')

    const preview = await context.module.pruneMergedBranchesForSession('session-1', { dryRun: true })
    expect(preview.dryRun).toBe(true)
    expect(preview.headBranch).toBe('main')
    expect(preview.pruned.map((entry) => entry.name)).toEqual(['merged-branch'])
    expect(preview.skipped.map((entry) => entry.name)).toEqual(['unmerged-branch'])
    expect(git(projectRoot, 'rev-parse', '--verify', 'refs/heads/merged-branch')).toMatch(/^[0-9a-f]{40,64}$/u)

    const result = await context.module.pruneMergedBranchesForSession('session-1')
    expect(result.dryRun).toBe(false)
    expect(result.pruned.map((entry) => entry.name)).toEqual(['merged-branch'])
    expect(result.skipped.map((entry) => entry.name)).toEqual(['unmerged-branch'])
    expect(result.skipped[0]?.reason).toContain('main')
    const remaining = git(projectRoot, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').split(/\r?\n/)
    expect(remaining).not.toContain('merged-branch')
    expect(remaining).toContain('unmerged-branch')
    await expect(context.module.pruneMergedBranchesForSession('ghost-session')).rejects.toMatchObject({ code: 'session_not_found' })
  })

  test('Given an olderThanDays filter When the session prunes Then young merged branches are kept and stale ones deleted', async () => {
    const context = createContext()
    const projectRoot = context.projectRoot
    // 造「已合并但 tip 旧」：旧日期提交后 ff 合并回 main，main 再前进出年轻 tip。
    git(projectRoot, 'checkout', '-b', 'old-merged')
    writeFileSync(join(projectRoot, 'old.txt'), 'old', 'utf8')
    git(projectRoot, 'add', 'old.txt')
    gitDated(projectRoot, new Date(Date.now() - 20 * 86_400_000).toISOString(), 'commit', '-m', 'old work')
    git(projectRoot, 'checkout', 'main')
    git(projectRoot, 'merge', '--ff-only', 'old-merged')
    git(projectRoot, 'commit', '--allow-empty', '-m', 'advance main')
    git(projectRoot, 'branch', 'young-merged')

    const result = await context.module.pruneMergedBranchesForSession('session-1', { olderThanDays: 7 })
    expect(result.pruned.map((entry) => entry.name)).toEqual(['old-merged'])
    const youngSkip = result.skipped.find((entry) => entry.name === 'young-merged')
    expect(youngSkip?.reason).toContain('7')
    const remaining = git(projectRoot, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').split(/\r?\n/)
    expect(remaining).not.toContain('old-merged')
    expect(remaining).toContain('young-merged')
  }, 30_000)

  test('Given a delivered Worktree still holding its merged branch When a manual prune runs Then it reclaims the Worktree inside the window while the sweep waits', async () => {
    const context = createContext()
    const registryPath = join(context.configDir, 'managed-checkouts.json')
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const managedRoot = await context.module.resolveManagedRoot(target.checkout.id)
    // 测试端口没有 attachWorktreeBranch：交付前就把工作树切到会话分支、并把台账补成
    // 已认领的形态，复现生产里「分支被这棵树检出」的交付链路。
    const branch = 'feat/sess-session-1'
    git(managedRoot, 'switch', '-c', branch)
    const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as any
    registry.managedCheckouts[target.checkout.id].sessionBranch = `refs/heads/${branch}`
    registry.managedCheckouts[target.checkout.id].revision += 1
    registry.revision += 1
    writeFileSync(registryPath, JSON.stringify(registry, null, 2))
    writeFileSync(join(managedRoot, 'retained.txt'), 'retained work\n', 'utf8')
    const ready = await context.module.markReadyForReview('session-1', {
      summary: 'retained work', validationStatus: 'passed', tests: [], suggestedCommitMessage: 'test: retained work',
    })
    if (ready.delivery?.state !== 'ready_for_review') throw new Error('expected ready review')
    await context.module.operate({
      action: 'finish', sessionId: 'session-1', expectedRevision: ready.revision,
      expectedReviewId: ready.delivery.review.reviewId, commitMessage: 'test: retained work', retention: 'retain_24h',
    })
    git(context.projectRoot, 'merge', '--ff-only', branch)

    // 每日自动 sweep 尊重保留窗口：窗口内不动那棵树，理由点名 checkoutId。
    const sweep = await context.module.autoPruneStaleMergedBranches(0)
    const swept = sweep.flatMap((view) => view.skipped).find((entry) => entry.name === branch)
    expect(swept?.reason).toContain(target.checkout.id)
    expect(existsSync(managedRoot)).toBe(true)

    // 手动清理就是「现在就清」：已合并且已交付的树先回收，再删分支，不等窗口。
    const result = await context.module.pruneMergedBranchesForSession('session-1')
    expect(result.skipped).toEqual([])
    expect(result.pruned.map((entry) => entry.name)).toContain(branch)
    expect(existsSync(managedRoot)).toBe(false)
    const after = JSON.parse(readFileSync(registryPath, 'utf8')) as any
    expect(after.managedCheckouts[target.checkout.id].phase).toBe('discarded')
    const remaining = git(context.projectRoot, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').split(/\r?\n/)
    expect(remaining).not.toContain(branch)
  }, 30_000)

  test('Given a retained record whose Worktree directory is gone When its branch is merged Then prune deletes the branch instead of reporting a live checkout', async () => {
    const context = createContext()
    const registryPath = join(context.configDir, 'managed-checkouts.json')
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const managedRoot = await context.module.resolveManagedRoot(target.checkout.id)
    writeFileSync(join(managedRoot, 'gone.txt'), 'gone work\n', 'utf8')
    const ready = await context.module.markReadyForReview('session-1', {
      summary: 'gone work', validationStatus: 'passed', tests: [], suggestedCommitMessage: 'test: gone work',
    })
    if (ready.delivery?.state !== 'ready_for_review') throw new Error('expected ready review')
    await context.module.operate({
      action: 'finish', sessionId: 'session-1', expectedRevision: ready.revision,
      expectedReviewId: ready.delivery.review.reviewId, commitMessage: 'test: gone work', retention: 'retain_24h',
    })
    const branch = 'feat/sess-session-1-gone'
    git(context.projectRoot, 'branch', branch, 'HEAD')
    const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as any
    registry.managedCheckouts[target.checkout.id].sessionBranch = `refs/heads/${branch}`
    registry.managedCheckouts[target.checkout.id].revision += 1
    registry.revision += 1
    writeFileSync(registryPath, JSON.stringify(registry, null, 2))

    // 目录被手工移除后，Git 不再登记这棵树：台账记录不该继续冒充「占用中」。
    rmSync(managedRoot, { recursive: true, force: true })
    git(context.projectRoot, 'worktree', 'prune', '--expire', 'now')
    const result = await context.module.pruneMergedBranchesForSession('session-1')
    expect(result.pruned.map((entry) => entry.name)).toContain(branch)
    expect(result.skipped.find((entry) => entry.name === branch)).toBeUndefined()
  }, 30_000)

  test('Given a managed project with a stale merged branch When the maintenance sweep runs Then only stale merged branches are pruned', async () => {
    const context = createContext()
    const projectRoot = context.projectRoot
    await context.createOwnerTarget('target-session-1', 'feat/sess-target-session-1')
    // 造「已合并但 tip 旧」：旧日期提交后 ff 合并回 main，main 再前进出年轻 tip。
    git(projectRoot, 'checkout', '-b', 'stale-merged')
    writeFileSync(join(projectRoot, 'stale.txt'), 'stale', 'utf8')
    git(projectRoot, 'add', 'stale.txt')
    gitDated(projectRoot, new Date(Date.now() - 10 * 86_400_000).toISOString(), 'commit', '-m', 'stale work')
    git(projectRoot, 'checkout', 'main')
    git(projectRoot, 'merge', '--ff-only', 'stale-merged')
    git(projectRoot, 'commit', '--allow-empty', '-m', 'advance main')
    git(projectRoot, 'branch', 'young-merged')

    const results = await context.module.autoPruneStaleMergedBranches(7)
    expect(results).toHaveLength(1)
    const [sweep] = results
    expect(sweep!.headBranch).toBe('main')
    expect(sweep!.pruned.map((entry) => entry.name)).toEqual(['stale-merged'])
    expect(sweep!.skipped.find((entry) => entry.name === 'young-merged')).toBeTruthy()
    const remaining = git(projectRoot, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').split(/\r?\n/)
    expect(remaining).not.toContain('stale-merged')
    expect(remaining).toContain('young-merged')
  }, 30_000)

  test('Given a session-owned worktree branch When the session merges it Then dryRun probes first and the real merge lands in Local', async () => {
    const context = createContext()
    const launch = await context.createOwnerTarget('session-1', 'feat/sess-target-session-1')
    // 托管 worktree 初始为 detached HEAD：模型在 worktree 里建主题分支后再合并。
    const branch = 'feat/wt-merge-clean'
    git(launch.managedRoot, 'switch', '-c', branch)
    writeFileSync(join(launch.managedRoot, 'from-worktree.txt'), 'worktree work\n', 'utf8')
    git(launch.managedRoot, 'add', 'from-worktree.txt')
    git(launch.managedRoot, 'commit', '-m', 'feat: worktree work')

    const preview = await context.module.mergeBranchForSession('session-1', { sourceBranch: branch, dryRun: true })
    expect(preview).toMatchObject({ dryRun: true, sourceBranch: branch, localBranch: 'main', type: 'merged' })
    expect(preview.mergedFiles).toEqual(['from-worktree.txt'])
    expect(existsSync(join(context.projectRoot, 'from-worktree.txt'))).toBe(false)

    const result = await context.module.mergeBranchForSession('session-1', { sourceBranch: branch })
    expect(result).toMatchObject({ dryRun: false, type: 'merged' })
    expect(result.mergedFiles).toEqual(['from-worktree.txt'])
    expect(readFileSync(join(context.projectRoot, 'from-worktree.txt'), 'utf8')).toBe('worktree work\n')

    await expect(context.module.mergeBranchForSession('session-1', { sourceBranch: 'main' }))
      .rejects.toMatchObject({ code: 'invalid_input' })
    await expect(context.module.mergeBranchForSession('session-1', { sourceBranch: 'not-this-session' }))
      .rejects.toMatchObject({ code: 'not_owner' })
    await expect(context.module.mergeBranchForSession('ghost-session', { sourceBranch: branch }))
      .rejects.toMatchObject({ code: 'session_not_found' })
  }, 30_000)

  test('Given conflicting edits on both sides When the session merges its worktree branch Then dryRun surfaces conflict details and the real merge leaves them for in-place resolution', async () => {
    const context = createContext()
    const launch = await context.createOwnerTarget('session-1', 'feat/sess-target-session-1')
    const branch = 'feat/wt-merge-conflict'
    git(launch.managedRoot, 'switch', '-c', branch)
    writeFileSync(join(launch.managedRoot, 'tracked.txt'), 'worktree version\n', 'utf8')
    git(launch.managedRoot, 'add', 'tracked.txt')
    git(launch.managedRoot, 'commit', '-m', 'feat: worktree version')
    // 7 个额外冲突文件把详情推送过 CONFLICT_DETAIL_FILE_LIMIT=6 截断线。
    for (let i = 1; i <= 7; i++) {
      writeFileSync(join(launch.managedRoot, `extra-${i}.txt`), `worktree ${i}\n`, 'utf8')
      writeFileSync(join(context.projectRoot, `extra-${i}.txt`), `local ${i}\n`, 'utf8')
    }
    git(launch.managedRoot, 'add', '.')
    git(launch.managedRoot, 'commit', '-m', 'feat: worktree extras')
    writeFileSync(join(context.projectRoot, 'tracked.txt'), 'local version\n', 'utf8')
    git(context.projectRoot, 'add', '.')
    git(context.projectRoot, 'commit', '-m', 'feat: local version')

    const preview = await context.module.mergeBranchForSession('session-1', { sourceBranch: branch, dryRun: true })
    expect(preview.type).toBe('conflict')
    expect(preview.conflictingFiles).toHaveLength(8)
    expect(preview.conflictDetails).toHaveLength(7)
    expect(preview.conflictDetails?.[0]?.file).toBe('extra-1.txt')
    expect(preview.conflictDetails?.[0]?.diff).toContain('<<<')
    expect(preview.conflictDetails?.at(-1)?.diff).toBe('')
    expect(readFileSync(join(context.projectRoot, 'tracked.txt'), 'utf8')).toBe('local version\n')

    const result = await context.module.mergeBranchForSession('session-1', { sourceBranch: branch })
    expect(result.type).toBe('conflict')
    expect(readFileSync(join(context.projectRoot, 'tracked.txt'), 'utf8')).toContain('<<<<<<<')
  }, 30_000)

  test('Given Local advanced cleanly When the session reverse-syncs Then the worktree receives the merge and Local stays untouched', async () => {
    const context = createContext()
    const launch = await context.createOwnerTarget('session-1', 'feat/sess-target-session-1')
    const branch = 'feat/wt-reverse-clean'
    git(launch.managedRoot, 'switch', '-c', branch)
    writeFileSync(join(launch.managedRoot, 'worktree-note.txt'), 'note\n', 'utf8')
    git(launch.managedRoot, 'add', 'worktree-note.txt')
    git(launch.managedRoot, 'commit', '-m', 'feat: worktree note')
    writeFileSync(join(context.projectRoot, 'local-advance.txt'), 'from local\n', 'utf8')
    git(context.projectRoot, 'add', 'local-advance.txt')
    git(context.projectRoot, 'commit', '-m', 'feat: local advance')

    const result = await context.module.mergeBranchForSession('session-1', { sourceBranch: branch, direction: 'reverse' })
    expect(result).toMatchObject({ direction: 'reverse', dryRun: false, type: 'merged', sourceBranch: branch, localBranch: 'main', targetBranch: branch })
    expect(result.mergedFiles).toEqual(['local-advance.txt'])
    expect(readFileSync(join(launch.managedRoot, 'local-advance.txt'), 'utf8')).toBe('from local\n')
    expect(readFileSync(join(launch.managedRoot, 'worktree-note.txt'), 'utf8')).toBe('note\n')
    expect(existsSync(join(context.projectRoot, 'worktree-note.txt'))).toBe(false)
  }, 30_000)

  test('Given Local advanced past the worktree When the session reverse-syncs Then the conflict scene stays in the worktree', async () => {
    const context = createContext()
    const launch = await context.createOwnerTarget('session-1', 'feat/sess-target-session-1')
    const branch = 'feat/wt-reverse-conflict'
    git(launch.managedRoot, 'switch', '-c', branch)
    // Local 在 main 上前进；任务分支另改同一文件制造反向冲突。
    writeFileSync(join(context.projectRoot, 'tracked.txt'), 'local newer\n', 'utf8')
    git(context.projectRoot, 'add', 'tracked.txt')
    git(context.projectRoot, 'commit', '-m', 'feat: local advance')
    writeFileSync(join(launch.managedRoot, 'tracked.txt'), 'worktree version\n', 'utf8')
    git(launch.managedRoot, 'add', 'tracked.txt')
    git(launch.managedRoot, 'commit', '-m', 'feat: worktree version')

    const preview = await context.module.mergeBranchForSession('session-1', { sourceBranch: branch, direction: 'reverse', dryRun: true })
    expect(preview).toMatchObject({ direction: 'reverse', dryRun: true, type: 'conflict', sourceBranch: branch, localBranch: 'main', targetBranch: branch })
    expect(readFileSync(join(launch.managedRoot, 'tracked.txt'), 'utf8')).toBe('worktree version\n')

    const result = await context.module.mergeBranchForSession('session-1', { sourceBranch: branch, direction: 'reverse' })
    expect(result.type).toBe('conflict')
    expect(readFileSync(join(launch.managedRoot, 'tracked.txt'), 'utf8')).toContain('<<<<<<<')
    expect(readFileSync(join(context.projectRoot, 'tracked.txt'), 'utf8')).toBe('local newer\n')

    await expect(context.module.mergeBranchForSession('session-1', { sourceBranch: branch, direction: 'sideways' as never }))
      .rejects.toMatchObject({ code: 'invalid_input' })
  }, 30_000)

  test('Given a discarded checkout When the sidebar badge is cleared Then the flag is persisted without bumping the revision and stays idempotent', async () => {
    const context = createContext()
    const launch = await context.createOwnerTarget('session-1', 'feat/sess-target-session-1')
    const checkoutId = launch.target.checkout.id
    const [summary] = await context.module.listManagedWorktreesForSession('session-1')
    await context.module.manageManagedWorktreeForSession('session-1', {
      checkoutId,
      expectedRevision: summary.revision,
      action: 'discard',
      confirmDirty: true,
    })

    const registryPath = join(context.configDir, 'managed-checkouts.json')
    const recordOf = () => (JSON.parse(readFileSync(registryPath, 'utf8')) as {
      managedCheckouts: Record<string, { revision: number, sidebarBadgeClearedRevision?: number }>
    }).managedCheckouts[checkoutId]
    const recordBefore = recordOf()
    expect(recordBefore.sidebarBadgeClearedRevision).toBeUndefined()

    const first = await context.module.manageManagedWorktreeForSession('session-1', {
      checkoutId,
      expectedRevision: recordBefore.revision,
      action: 'clear_sidebar_badge',
    })
    expect(first.revision).toBe(recordBefore.revision)
    expect(recordOf()).toMatchObject({
      revision: recordBefore.revision,
      sidebarBadgeClearedRevision: recordBefore.revision,
    })

    const second = await context.module.manageManagedWorktreeForSession('session-1', {
      checkoutId,
      expectedRevision: recordBefore.revision,
      action: 'clear_sidebar_badge',
    })
    expect(second.revision).toBe(recordBefore.revision)
    expect(recordOf().sidebarBadgeClearedRevision).toBe(recordBefore.revision)
  })

  test('Given autoDeliver arrives as a volatile live reference When the value flips without remounting Then the Working guidance follows the current value', async () => {
    let autoDeliver: boolean | undefined = true
    const context = createContext({ autoDeliverRef: () => autoDeliver })
    const launch = await context.createOwnerTarget('target-session-1', 'feat/sess-target-session-1')
    context.addProject('target-workspace-1', 'Target Workspace', launch.managedRoot)
    context.addSession('target-session-1', 'target-workspace-1')
    expect(context.module.runtimeContext('target-session-1')).toContain('call worktree_deliver as the final model tool')

    autoDeliver = false
    expect(context.module.runtimeContext('target-session-1')).toContain('the model must not call worktree_deliver')
  })

  test('Given another session in the same project When it lists or manages a checkout Then persisted owner ids do not authorize it', async () => {
    const context = createContext()
    const launch = await context.createOwnerTarget('session-1', 'feat/sess-target-session-1')
    context.addSession('intruder-session', 'project-1')

    expect(await context.module.listManagedWorktreesForSession('intruder-session')).toEqual([])
    const [owned] = await context.module.listManagedWorktreesForSession('session-1')
    expect(owned.checkoutId).toBe(launch.target.checkout.id)
    await expect(context.module.manageManagedWorktreeForSession('intruder-session', {
      checkoutId: owned.checkoutId,
      expectedRevision: owned.revision,
      action: 'discard',
      confirmDirty: true,
    })).rejects.toMatchObject({ code: 'not_owner' })
  })

  test('Given a reviewed Worktree changes after Ready When strict Finish is requested Then unreviewed bytes never reach Local', async () => {
    const context = createContext()
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const managedRoot = await context.module.resolveManagedRoot(target.checkout.id)
    writeFileSync(join(managedRoot, 'tracked.txt'), 'reviewed\n')
    const ready = await context.module.markReadyForReview('session-1', {
      summary: 'reviewed snapshot',
      validationStatus: 'passed',
      tests: [],
      suggestedCommitMessage: 'test: reviewed snapshot',
    })
    if (ready.delivery?.state !== 'ready_for_review') throw new Error('expected review')
    writeFileSync(join(managedRoot, 'tracked.txt'), 'unreviewed\n')

    const result = await context.module.operate({
      action: 'finish',
      sessionId: 'session-1',
      expectedRevision: ready.revision,
      expectedReviewId: ready.delivery.review.reviewId,
      commitMessage: ready.delivery.review.suggestedCommitMessage,
    })

    expect(result).toMatchObject({ status: 'error', code: 'stale_isolated' })
    expect(readFileSync(join(context.projectRoot, 'tracked.txt'), 'utf8')).toBe('base\n')
    expect((await context.module.inspect('session-1')).delivery).toMatchObject({ state: 'working' })
  })

  test('Given a Ready Worktree When the user skips Local review Then receipt-first direct Finish creates exactly one task Commit', async () => {
    const context = createContext()
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const managedRoot = await context.module.resolveManagedRoot(target.checkout.id)
    writeFileSync(join(managedRoot, 'tracked.txt'), 'direct finish task\n')
    writeFileSync(join(context.projectRoot, 'local-note.txt'), 'keep local note\n')
    const ready = await context.module.markReadyForReview('session-1', {
      summary: 'direct finish', validationStatus: 'passed', validationSummary: 'full validation passed',
      tests: [], suggestedCommitMessage: 'test: direct finish',
    })
    if (ready.delivery?.state !== 'ready_for_review') throw new Error('expected ready review')
    const before = git(context.projectRoot, 'rev-parse', 'HEAD')

    const finished = await context.module.operate({
      action: 'finish', sessionId: 'session-1', expectedRevision: ready.revision,
      expectedReviewId: ready.delivery.review.reviewId, commitMessage: 'test: direct finish', retention: 'retain_manual',
    })

    expect(finished).toMatchObject({
      status: 'finished',
      cleanup: 'retained',
      target: {
        delivery: {
          state: 'retained',
          proof: { validationStatus: 'passed', validationSummary: 'full validation passed' },
        },
      },
    })
    // 交付只落在会话分支上：Local 的 HEAD 与工作区一个字节都不动。
    expect(git(context.projectRoot, 'rev-parse', 'HEAD')).toBe(before)
    expect(git(managedRoot, 'rev-list', '--count', `${before}..HEAD`)).toBe('1')
    expect(git(managedRoot, 'show', '-s', '--format=%s', 'HEAD')).toBe('test: direct finish')
    expect(git(managedRoot, 'show', '--format=', '--name-only', 'HEAD')).toBe('tracked.txt')
    expect(readFileSync(join(context.projectRoot, 'local-note.txt'), 'utf8')).toBe('keep local note\n')
  })

  test('Given more delivered Worktrees than the keep-count limit When maintenance runs Then the oldest retention is cleaned', async () => {
    const context = createContext({ worktreeKeepCount: 1 })
    const registryPath = join(context.configDir, 'managed-checkouts.json')
    const deliverRetained = async (sessionId: string, commitMessage: string): Promise<string> => {
      const target = await context.module.bind(sessionId, { kind: 'isolated' })
      const managedRoot = await context.module.resolveManagedRoot(target.checkout.id)
      writeFileSync(join(managedRoot, 'tracked.txt'), `${commitMessage}\n`)
      const ready = await context.module.markReadyForReview(sessionId, {
        summary: commitMessage, validationStatus: 'passed', tests: [], suggestedCommitMessage: commitMessage,
      })
      if (ready.delivery?.state !== 'ready_for_review') throw new Error('expected ready review')
      const finished = await context.module.operate({
        action: 'finish', sessionId, expectedRevision: ready.revision,
        expectedReviewId: ready.delivery.review.reviewId, commitMessage, retention: 'retain_24h',
      })
      expect(finished).toMatchObject({ status: 'finished', cleanup: 'retained' })
      return target.checkout.id
    }
    const oldest = await deliverRetained('session-1', 'test: oldest delivery')
    const newest = await deliverRetained('child-session', 'test: newest delivery')
    // 固定 LRU 顺序：两次交付可能落在同一毫秒，retainedAt 必须能区分新旧。
    const before = JSON.parse(readFileSync(registryPath, 'utf8')) as any
    before.managedCheckouts[oldest].delivery.retainedAt = 1000
    before.managedCheckouts[newest].delivery.retainedAt = 2000
    writeFileSync(registryPath, JSON.stringify(before))

    const cleaned = await context.module.enforceWorktreeKeepCount()

    expect(cleaned).toEqual([oldest])
    const after = JSON.parse(readFileSync(registryPath, 'utf8')) as any
    expect(after.managedCheckouts[oldest]).toMatchObject({ phase: 'discarded', delivery: { state: 'delivered' } })
    expect(after.managedCheckouts[newest]).toMatchObject({ phase: 'retained', delivery: { state: 'retained' } })
    expect(existsSync(before.managedCheckouts[oldest].managedGitRoot)).toBe(false)
  })

  test('Given a retained Worktree whose cleanup hit a transient lock When its retention expires Then the sweep retries and still cleans it', async () => {
    const context = createContext({ removeWorktreeFailures: 1 })
    const registryPath = join(context.configDir, 'managed-checkouts.json')
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const managedRoot = await context.module.resolveManagedRoot(target.checkout.id)
    writeFileSync(join(managedRoot, 'tracked.txt'), 'retired task\n')
    const ready = await context.module.markReadyForReview('session-1', {
      summary: 'retired task', validationStatus: 'passed', tests: [], suggestedCommitMessage: 'test: retired task',
    })
    if (ready.delivery?.state !== 'ready_for_review') throw new Error('expected ready review')
    await context.module.operate({
      action: 'finish', sessionId: 'session-1', expectedRevision: ready.revision,
      expectedReviewId: ready.delivery.review.reviewId, commitMessage: 'test: retired task', retention: 'retain_24h',
    })
    const expired = JSON.parse(readFileSync(registryPath, 'utf8')) as any
    expired.managedCheckouts[target.checkout.id].delivery.expiresAt = Date.now() - 1000
    writeFileSync(registryPath, JSON.stringify(expired))

    // 第一次到期清理撞上瞬时占用：记为 blocked，但必须保留重试资格。
    expect(await context.module.cleanupExpiredRetained()).toEqual([])
    const blocked = JSON.parse(readFileSync(registryPath, 'utf8')) as any
    expect(blocked.managedCheckouts[target.checkout.id].delivery.cleanup).toBe('blocked')

    // 占用消失后的下一次维护必须继续清理，不能永久留在磁盘上。
    expect(await context.module.cleanupExpiredRetained()).toEqual([target.checkout.id])
    const after = JSON.parse(readFileSync(registryPath, 'utf8')) as any
    expect(after.managedCheckouts[target.checkout.id].phase).toBe('discarded')
  })

  test('Given a retained Worktree When its retention window is open, pinned, or expired Then the sweep honours each case', async () => {
    const context = createContext()
    const registryPath = join(context.configDir, 'managed-checkouts.json')
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const managedRoot = await context.module.resolveManagedRoot(target.checkout.id)
    writeFileSync(join(managedRoot, 'tracked.txt'), 'retention window\n')
    const ready = await context.module.markReadyForReview('session-1', {
      summary: 'retention window', validationStatus: 'passed', tests: [], suggestedCommitMessage: 'test: retention window',
    })
    if (ready.delivery?.state !== 'ready_for_review') throw new Error('expected ready review')
    await context.module.operate({
      action: 'finish', sessionId: 'session-1', expectedRevision: ready.revision,
      expectedReviewId: ready.delivery.review.reviewId, commitMessage: 'test: retention window', retention: 'retain_24h',
    })

    // 窗口仍在：到期清理不得动它。
    const fresh = JSON.parse(readFileSync(registryPath, 'utf8')) as any
    fresh.managedCheckouts[target.checkout.id].delivery.expiresAt = Date.now() + 60_000
    writeFileSync(registryPath, JSON.stringify(fresh))
    expect(await context.module.cleanupExpiredRetained()).toEqual([])

    // 已过期但被标记永久保留：同样豁免。
    const pinned = JSON.parse(readFileSync(registryPath, 'utf8')) as any
    pinned.managedCheckouts[target.checkout.id].delivery.expiresAt = Date.now() - 1000
    pinned.managedCheckouts[target.checkout.id].permanent = true
    writeFileSync(registryPath, JSON.stringify(pinned))
    expect(await context.module.cleanupExpiredRetained()).toEqual([])

    // 解除永久保留：过期记录按 scheduled 正常清理。
    const expired = JSON.parse(readFileSync(registryPath, 'utf8')) as any
    delete expired.managedCheckouts[target.checkout.id].permanent
    writeFileSync(registryPath, JSON.stringify(expired))
    expect(await context.module.cleanupExpiredRetained()).toEqual([target.checkout.id])
    const after = JSON.parse(readFileSync(registryPath, 'utf8')) as any
    expect(after.managedCheckouts[target.checkout.id].phase).toBe('discarded')
  })

  test('Given a Preview When the owner explicitly continues editing Then Local is restored and the review becomes working', async () => {
    const context = createContext()
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const managedRoot = await context.module.resolveManagedRoot(target.checkout.id)
    writeFileSync(join(managedRoot, 'tracked.txt'), 'preview task\n')
    const ready = await context.module.markReadyForReview('session-1', {
      summary: 'preview review', validationStatus: 'passed', tests: [], suggestedCommitMessage: 'test: preview review',
    })
    if (ready.delivery?.state !== 'ready_for_review') throw new Error('expected ready review')
    const localHead = git(context.projectRoot, 'rev-parse', 'HEAD')

    const preview = await context.module.operate({ action: 'preview', sessionId: 'session-1', expectedRevision: ready.revision })

    expect(preview).toMatchObject({ status: 'previewed', target: { delivery: { state: 'preview_active' } } })
    if (preview.status !== 'previewed') throw new Error(`expected previewed, got ${preview.status}`)
    expect(readFileSync(join(context.projectRoot, 'tracked.txt'), 'utf8').replace(/\r\n/g, '\n')).toBe('preview task\n')
    expect(git(context.projectRoot, 'rev-parse', 'HEAD')).toBe(localHead)
    expect(context.module.runtimeContext('session-1')).toContain('Local Preview active')

    const rolledBack = await context.module.operate({
      action: 'rollback_preview', sessionId: 'session-1', expectedRevision: preview.target.revision, resumeRevision: true,
    })

    expect(rolledBack).toMatchObject({
      status: 'preview_rolled_back',
      target: { delivery: { state: 'working', iteration: ready.delivery.review.iteration } },
    })
    expect(readFileSync(join(context.projectRoot, 'tracked.txt'), 'utf8').replace(/\r\n/g, '\n')).toBe('base\n')
    expect(existsSync(managedRoot)).toBe(true)
  })

  test('Withdrawing preserves the same review and Worktree bytes; latest revision can preview again and save', async () => {
    const context = createContext()
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const managedRoot = await context.module.resolveManagedRoot(target.checkout.id)
    writeFileSync(join(managedRoot, 'tracked.txt'), 'hello worktree\n')
    const ready = await context.module.markReadyForReview('session-1', {
      summary: 'withdraw and retry', validationStatus: 'not_run', tests: [], suggestedCommitMessage: 'test: repeated preview',
    })
    if (ready.delivery?.state !== 'ready_for_review') throw new Error('expected review')
    const reviewId = ready.delivery.review.reviewId
    const before = git(context.projectRoot, 'rev-parse', 'HEAD')
    const preview = await context.module.operate({ action: 'preview', sessionId: 'session-1', expectedRevision: ready.revision })
    if (preview.status !== 'previewed') throw new Error('expected preview')
    expect(readFileSync(join(context.projectRoot, 'tracked.txt'), 'utf8')).toBe('hello worktree\n')
    const withdrawn = await context.module.operate({ action: 'rollback_preview', sessionId: 'session-1', expectedRevision: preview.target.revision })
    if (withdrawn.status !== 'preview_rolled_back') throw new Error('expected rollback')
    expect(withdrawn.target.delivery).toMatchObject({ state: 'ready_for_review', review: { reviewId } })
    expect(withdrawn.target.revision).toBeGreaterThan(preview.target.revision)
    expect(readFileSync(join(context.projectRoot, 'tracked.txt'), 'utf8').replace(/\r\n/g, '\n')).toBe('base\n')
    expect(readFileSync(join(managedRoot, 'tracked.txt'), 'utf8')).toBe('hello worktree\n')
    expect(git(context.projectRoot, 'rev-parse', 'HEAD')).toBe(before)
    expect(await context.module.operate({ action: 'preview', sessionId: 'session-1', expectedRevision: ready.revision })).toMatchObject({ status: 'error', code: 'stale_target' })
    const again = await context.module.operate({ action: 'preview', sessionId: 'session-1', expectedRevision: withdrawn.target.revision })
    if (again.status !== 'previewed') throw new Error('expected second preview')
    expect(again.target.delivery).toMatchObject({ state: 'preview_active', review: { reviewId } })
    const saved = await context.module.operate({ action: 'finalize_preview', sessionId: 'session-1', expectedRevision: again.target.revision, commitMessage: 'test: repeated preview', retention: 'retain_manual' })
    expect(saved).toMatchObject({ status: 'finished', target: { delivery: { state: 'retained' } } })
    expect(readFileSync(join(context.projectRoot, 'tracked.txt'), 'utf8')).toBe('hello worktree\n')
    expect(git(context.projectRoot, 'rev-list', '--count', `${before}..HEAD`)).toBe('1')
  })

  test('Given a Local Preview is accepted When the owner finalizes Then only the task becomes one retained Commit', async () => {
    const context = createContext()
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const managedRoot = await context.module.resolveManagedRoot(target.checkout.id)
    writeFileSync(join(managedRoot, 'tracked.txt'), 'accepted preview\n')
    const ready = await context.module.markReadyForReview('session-1', {
      summary: 'accepted preview', validationStatus: 'partial', validationSummary: 'focused tests passed; full suite not run',
      tests: [], suggestedCommitMessage: 'test: accepted preview',
    })
    const preview = await context.module.operate({ action: 'preview', sessionId: 'session-1', expectedRevision: ready.revision })
    if (preview.status !== 'previewed') throw new Error(`expected previewed, got ${preview.status}`)
    writeFileSync(join(context.projectRoot, 'review-note.txt'), 'keep local review work\n')

    const finalized = await context.module.operate({
      action: 'finalize_preview',
      sessionId: 'session-1',
      expectedRevision: preview.target.revision,
      commitMessage: longCommitMessage,
      retention: 'retain_manual',
    })

    expect(finalized).toMatchObject({
      status: 'finished',
      cleanup: 'retained',
      target: {
        delivery: {
          state: 'retained',
          proof: { validationStatus: 'partial', validationSummary: 'focused tests passed; full suite not run' },
        },
      },
    })
    expect(git(context.projectRoot, 'show', '-s', '--format=%B', 'HEAD')).toBe(longCommitMessage)
    expect(git(context.projectRoot, 'show', '--format=', '--name-only', 'HEAD')).toBe('tracked.txt')
    expect(readFileSync(join(context.projectRoot, 'review-note.txt'), 'utf8')).toBe('keep local review work\n')
  })

  test('Given Preview is active When the user abandons the task Then Discard rolls Local back before removing the Worktree', async () => {
    const context = createContext()
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const managedRoot = await context.module.resolveManagedRoot(target.checkout.id)
    writeFileSync(join(managedRoot, 'tracked.txt'), 'abandoned preview\n')
    const ready = await context.module.markReadyForReview('session-1', {
      summary: 'abandon preview', validationStatus: 'passed', tests: [], suggestedCommitMessage: 'test: abandon preview',
    })
    const preview = await context.module.operate({ action: 'preview', sessionId: 'session-1', expectedRevision: ready.revision })
    if (preview.status !== 'previewed') throw new Error(`expected previewed, got ${preview.status}`)
    expect(readFileSync(join(context.projectRoot, 'tracked.txt'), 'utf8').replace(/\r\n/g, '\n')).toBe('abandoned preview\n')

    const discarded = await context.module.operate({
      action: 'discard', sessionId: 'session-1', expectedRevision: preview.target.revision,
      confirmDirty: true, rollbackPreview: true,
    })

    expect(discarded.status).toBe('discarded')
    expect(readFileSync(join(context.projectRoot, 'tracked.txt'), 'utf8').replace(/\r\n/g, '\n')).toBe('base\n')
    expect(existsSync(managedRoot)).toBe(false)
  })

  test('Given a detached Preview and Local only fast-forwarded with disjoint content When rollback is retried Then it preserves the new commit and resumes the Worktree', async () => {
    const context = createContext()
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const managedRoot = await context.module.resolveManagedRoot(target.checkout.id)
    writeFileSync(join(managedRoot, 'tracked.txt'), 'preview after fast-forward\n')
    const ready = await context.module.markReadyForReview('session-1', {
      summary: 'fast-forward recovery', validationStatus: 'passed', tests: [], suggestedCommitMessage: 'test: fast-forward recovery',
    })
    const preview = await context.module.operate({ action: 'preview', sessionId: 'session-1', expectedRevision: ready.revision })
    if (preview.status !== 'previewed') throw new Error(`expected previewed, got ${preview.status}`)
    writeFileSync(join(context.projectRoot, 'external-commit.txt'), 'new Local commit\n')
    git(context.projectRoot, 'add', 'external-commit.txt')
    git(context.projectRoot, 'commit', '--only', 'external-commit.txt', '-m', 'external fast-forward')
    const advancedHead = git(context.projectRoot, 'rev-parse', 'HEAD')

    const registryPath = join(context.configDir, 'managed-checkouts.json')
    const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as any
    const record = registry.managedCheckouts[target.checkout.id]
    const previewId = record.delivery.preview.previewId as string
    record.delivery = {
      ...record.delivery,
      state: 'preview_detached',
      detachedAt: Date.now(),
      reason: 'stale_local',
      attemptedAction: 'rollback_preview',
    }
    record.revision += 1
    registry.revision += 1
    writeFileSync(registryPath, JSON.stringify(registry, null, 2))

    const restarted = context.restart()
    const detached = await restarted.inspect('session-1')
    expect(detached.delivery).toMatchObject({ state: 'preview_detached', reason: 'stale_local' })
    const registryBefore = readFileSync(registryPath, 'utf8')
    const refsBefore = git(context.projectRoot, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/dsh-worktree/session-checkouts')
    const recovery = await restarted.preflightPreviewRecovery?.(
      'session-1', detached.revision, ready.delivery?.state === 'ready_for_review' ? ready.delivery.review.reviewId : '', previewId,
    )
    expect(recovery).toMatchObject({
      status: 'assessed',
      localModified: false,
      proof: { rollback: { status: 'safe' }, finalize: { status: 'safe' } },
    })
    expect(readFileSync(registryPath, 'utf8')).toBe(registryBefore)
    expect(git(context.projectRoot, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/dsh-worktree/session-checkouts')).toBe(refsBefore)
    if (!recovery || recovery.status !== 'assessed') throw new Error('expected assessed recovery')
    const withoutProof = await restarted.operate({
      action: 'rollback_preview', sessionId: 'session-1', expectedRevision: detached.revision, resumeRevision: true,
    })
    expect(withoutProof).toMatchObject({ status: 'error', code: 'stale_target' })
    const rolledBack = await restarted.operate({
      action: 'rollback_preview', sessionId: 'session-1', expectedRevision: detached.revision, resumeRevision: true,
      recoveryProof: recovery.proof,
    })

    expect(rolledBack).toMatchObject({ status: 'preview_rolled_back', target: { delivery: { state: 'working' } } })
    expect(git(context.projectRoot, 'rev-parse', 'HEAD')).toBe(advancedHead)
    expect(git(context.projectRoot, 'show', 'HEAD:external-commit.txt')).toBe('new Local commit')
    expect(readFileSync(join(context.projectRoot, 'tracked.txt'), 'utf8').replace(/\r\n/g, '\n')).toBe('base\n')
    expect(git(context.projectRoot, 'for-each-ref', '--format=%(refname)', 'refs/dsh-worktree/session-checkouts')).not.toContain(previewId)
    expect(existsSync(managedRoot)).toBe(true)
  })

  test('Given a detached Preview and a fresh Host proof When finalize is requested Then it commits onto the latest Local HEAD', async () => {
    const context = createContext()
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const managedRoot = await context.module.resolveManagedRoot(target.checkout.id)
    writeFileSync(join(managedRoot, 'tracked.txt'), 'finalize after fast-forward\n')
    const ready = await context.module.markReadyForReview('session-1', {
      summary: 'finalize recovery', validationStatus: 'passed', tests: [], suggestedCommitMessage: 'test: finalize recovery',
    })
    if (ready.delivery?.state !== 'ready_for_review') throw new Error('expected review')
    const preview = await context.module.operate({ action: 'preview', sessionId: 'session-1', expectedRevision: ready.revision })
    if (preview.status !== 'previewed') throw new Error(`expected previewed, got ${preview.status}`)
    writeFileSync(join(context.projectRoot, 'external-commit.txt'), 'new Local commit\n')
    git(context.projectRoot, 'add', 'external-commit.txt')
    git(context.projectRoot, 'commit', '--only', 'external-commit.txt', '-m', 'external fast-forward')
    const advancedHead = git(context.projectRoot, 'rev-parse', 'HEAD')

    const registryPath = join(context.configDir, 'managed-checkouts.json')
    const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as any
    const record = registry.managedCheckouts[target.checkout.id]
    const previewId = record.delivery.preview.previewId as string
    record.delivery = {
      ...record.delivery,
      state: 'preview_detached',
      detachedAt: Date.now(),
      reason: 'stale_local',
      attemptedAction: 'finalize_preview',
    }
    record.revision += 1
    registry.revision += 1
    writeFileSync(registryPath, JSON.stringify(registry, null, 2))

    const restarted = context.restart()
    const detached = await restarted.inspect('session-1')
    const recovery = await restarted.preflightPreviewRecovery?.(
      'session-1', detached.revision, ready.delivery.review.reviewId, previewId,
    )
    expect(recovery).toMatchObject({ status: 'assessed', proof: { finalize: { status: 'safe', commitRequired: true } } })
    if (!recovery || recovery.status !== 'assessed') throw new Error('expected assessed recovery')

    const finalized = await restarted.operate({
      action: 'finalize_preview',
      sessionId: 'session-1',
      expectedRevision: detached.revision,
      commitMessage: 'test: finalize recovery',
      retention: 'retain_manual',
      recoveryProof: recovery.proof,
    })

    expect(finalized).toMatchObject({ status: 'finished', cleanup: 'retained' })
    expect(git(context.projectRoot, 'rev-parse', 'HEAD^')).toBe(advancedHead)
    expect(git(context.projectRoot, 'show', '--format=', '--name-only', 'HEAD')).toBe('tracked.txt')
    expect(git(context.projectRoot, 'show', 'HEAD^:external-commit.txt')).toBe('new Local commit')
  })

  test('Given detached Preview evidence changes after assessment When recovery is retried Then Host fails closed and preserves detached state', async () => {
    const context = createContext()
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const managedRoot = await context.module.resolveManagedRoot(target.checkout.id)
    writeFileSync(join(managedRoot, 'tracked.txt'), 'artifact recovery\n')
    const ready = await context.module.markReadyForReview('session-1', {
      summary: 'artifact recovery', validationStatus: 'passed', tests: [], suggestedCommitMessage: 'test: artifact recovery',
    })
    if (ready.delivery?.state !== 'ready_for_review') throw new Error('expected review')
    const preview = await context.module.operate({ action: 'preview', sessionId: 'session-1', expectedRevision: ready.revision })
    if (preview.status !== 'previewed') throw new Error('expected previewed')
    const registryPath = join(context.configDir, 'managed-checkouts.json')
    const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as any
    const record = registry.managedCheckouts[target.checkout.id]
    const previewId = record.delivery.preview.previewId as string
    record.delivery = { ...record.delivery, state: 'preview_detached', detachedAt: Date.now(), reason: 'stale_local', attemptedAction: 'rollback_preview' }
    record.revision += 1
    registry.revision += 1
    writeFileSync(registryPath, JSON.stringify(registry, null, 2))
    const restarted = context.restart()
    const detached = await restarted.inspect('session-1')
    const assessed = await restarted.preflightPreviewRecovery?.(
      'session-1', detached.revision, ready.delivery.review.reviewId, previewId,
    )
    if (!assessed || assessed.status !== 'assessed') throw new Error('expected assessed')

    const forged = { ...assessed.proof, generation: '0'.repeat(64) }
    const denied = await restarted.operate({
      action: 'rollback_preview', sessionId: 'session-1', expectedRevision: detached.revision,
      resumeRevision: true, recoveryProof: forged,
    })
    expect(denied).toMatchObject({ status: 'error', code: 'stale_target' })
    expect((await restarted.inspect('session-1')).delivery).toMatchObject({ state: 'preview_detached' })

    const refKey = createHash('sha256').update(target.checkout.id).digest('hex').slice(0, 24)
    git(context.projectRoot, 'update-ref', '-d', `refs/dsh-worktree/session-checkouts/${refKey}/previews/${previewId}/local-working`)
    const missing = await restarted.preflightPreviewRecovery?.(
      'session-1', detached.revision, ready.delivery.review.reviewId, previewId,
    )
    expect(missing).toMatchObject({ status: 'blocked', reason: 'artifacts_missing', localModified: false })
  })

  test('Given detached rollback writes Local but exact verification becomes uncertain When Host receives the result Then it preserves the journal and enters recovery_required', async () => {
    let injectFault = false
    const context = createContext({
      applyEngine: createSessionCheckoutApplyEngine({
        afterLocalWriteBeforeVerification: () => {
          if (injectFault) throw new Error('simulated post-write verification fault')
        },
      }),
    })
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const managedRoot = await context.module.resolveManagedRoot(target.checkout.id)
    writeFileSync(join(managedRoot, 'tracked.txt'), 'uncertain rollback task\n')
    const ready = await context.module.markReadyForReview('session-1', {
      summary: 'uncertain rollback', validationStatus: 'passed', tests: [], suggestedCommitMessage: 'test: uncertain rollback',
    })
    if (ready.delivery?.state !== 'ready_for_review') throw new Error('expected review')
    const preview = await context.module.operate({ action: 'preview', sessionId: 'session-1', expectedRevision: ready.revision })
    if (preview.status !== 'previewed') throw new Error('expected preview')
    const registryPath = join(context.configDir, 'managed-checkouts.json')
    const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as any
    const record = registry.managedCheckouts[target.checkout.id]
    const previewId = record.delivery.preview.previewId as string
    record.delivery = {
      ...record.delivery,
      state: 'preview_detached',
      detachedAt: Date.now(),
      reason: 'stale_local',
      attemptedAction: 'rollback_preview',
    }
    record.revision += 1
    registry.revision += 1
    writeFileSync(registryPath, JSON.stringify(registry, null, 2))
    const detached = await context.module.inspect('session-1')
    const assessed = await context.module.preflightPreviewRecovery?.(
      'session-1', detached.revision, ready.delivery.review.reviewId, previewId,
    )
    if (!assessed || assessed.status !== 'assessed' || assessed.proof.rollback.status !== 'safe') {
      throw new Error('expected safe rollback assessment')
    }

    injectFault = true
    const result = await context.module.operate({
      action: 'rollback_preview', sessionId: 'session-1', expectedRevision: detached.revision,
      resumeRevision: true, recoveryProof: assessed.proof,
    })

    expect(result).toMatchObject({
      status: 'error', code: 'git_error', target: { checkout: { phase: 'recovery_required' } },
    })
    const persisted = JSON.parse(readFileSync(registryPath, 'utf8')) as any
    expect(persisted.managedCheckouts[target.checkout.id]).toMatchObject({
      phase: 'recovery_required',
      delivery: { state: 'preview_detached' },
      journal: {
        operation: 'rollback_preview', step: 'writing_local', previewId,
        recoveryGeneration: assessed.proof.generation,
      },
    })
    expect(existsSync(managedRoot)).toBe(true)
  })

  test('Given detached finalize receives a concurrent staged update after writing its index When compensation cannot CAS restore Then Host preserves the journal and enters recovery_required', async () => {
    let injectRace = false
    let projectRoot = ''
    const context = createContext({
      applyEngine: createSessionCheckoutApplyEngine({
        afterLocalWriteBeforeVerification: () => {
          if (!injectRace) return
          writeFileSync(join(projectRoot, 'concurrent-stage.txt'), 'preserve staged race\n')
          git(projectRoot, 'add', 'concurrent-stage.txt')
          throw new Error('simulated finalize verification fault after concurrent git add')
        },
      }),
    })
    projectRoot = context.projectRoot
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const managedRoot = await context.module.resolveManagedRoot(target.checkout.id)
    writeFileSync(join(managedRoot, 'tracked.txt'), 'uncertain finalize task\n')
    const ready = await context.module.markReadyForReview('session-1', {
      summary: 'uncertain finalize', validationStatus: 'passed', tests: [], suggestedCommitMessage: 'test: uncertain finalize',
    })
    if (ready.delivery?.state !== 'ready_for_review') throw new Error('expected review')
    const preview = await context.module.operate({ action: 'preview', sessionId: 'session-1', expectedRevision: ready.revision })
    if (preview.status !== 'previewed') throw new Error('expected preview')
    const registryPath = join(context.configDir, 'managed-checkouts.json')
    const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as any
    const record = registry.managedCheckouts[target.checkout.id]
    const previewId = record.delivery.preview.previewId as string
    record.delivery = {
      ...record.delivery,
      state: 'preview_detached',
      detachedAt: Date.now(),
      reason: 'stale_local',
      attemptedAction: 'finalize_preview',
    }
    record.revision += 1
    registry.revision += 1
    writeFileSync(registryPath, JSON.stringify(registry, null, 2))
    const detached = await context.module.inspect('session-1')
    const assessed = await context.module.preflightPreviewRecovery?.(
      'session-1', detached.revision, ready.delivery.review.reviewId, previewId,
    )
    if (!assessed || assessed.status !== 'assessed' || assessed.proof.finalize.status !== 'safe') {
      throw new Error('expected safe finalize assessment')
    }

    injectRace = true
    const result = await context.module.operate({
      action: 'finalize_preview', sessionId: 'session-1', expectedRevision: detached.revision,
      commitMessage: 'test: uncertain finalize', retention: 'retain_manual', recoveryProof: assessed.proof,
    })

    expect(result).toMatchObject({
      status: 'error', code: 'git_error', target: { checkout: { phase: 'recovery_required' } },
    })
    expect(git(context.projectRoot, 'show', '--format=', '--name-only', 'HEAD')).toBe('tracked.txt')
    expect(git(context.projectRoot, 'diff', '--cached', '--name-only')).toBe('concurrent-stage.txt')
    const persisted = JSON.parse(readFileSync(registryPath, 'utf8')) as any
    expect(persisted.managedCheckouts[target.checkout.id]).toMatchObject({
      phase: 'recovery_required',
      delivery: { state: 'preview_detached' },
      journal: {
        operation: 'finalize_preview', step: 'updating_ref', previewId,
        recoveryGeneration: assessed.proof.generation,
      },
    })
    expect(existsSync(managedRoot)).toBe(true)
  })

  test('Given Local changes after detached assessment When rollback uses the old proof Then Host rejects it before journaling and preserves every Local byte', async () => {
    const context = createContext()
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const managedRoot = await context.module.resolveManagedRoot(target.checkout.id)
    writeFileSync(join(managedRoot, 'tracked.txt'), 'stale proof task\n')
    const ready = await context.module.markReadyForReview('session-1', {
      summary: 'stale proof', validationStatus: 'passed', tests: [], suggestedCommitMessage: 'test: stale proof',
    })
    if (ready.delivery?.state !== 'ready_for_review') throw new Error('expected review')
    const preview = await context.module.operate({ action: 'preview', sessionId: 'session-1', expectedRevision: ready.revision })
    if (preview.status !== 'previewed') throw new Error('expected preview')
    const registryPath = join(context.configDir, 'managed-checkouts.json')
    const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as any
    const record = registry.managedCheckouts[target.checkout.id]
    const previewId = record.delivery.preview.previewId as string
    record.delivery = {
      ...record.delivery,
      state: 'preview_detached',
      detachedAt: Date.now(),
      reason: 'stale_local',
      attemptedAction: 'rollback_preview',
    }
    record.revision += 1
    registry.revision += 1
    writeFileSync(registryPath, JSON.stringify(registry, null, 2))

    const detached = await context.module.inspect('session-1')
    const assessed = await context.module.preflightPreviewRecovery?.(
      'session-1', detached.revision, ready.delivery.review.reviewId, previewId,
    )
    if (!assessed || assessed.status !== 'assessed') throw new Error('expected assessment')
    writeFileSync(join(context.projectRoot, 'late-local.txt'), 'late Local byte\n')
    const localStatusBefore = git(context.projectRoot, 'status', '--porcelain=v1', '-uall')

    const result = await context.module.operate({
      action: 'rollback_preview', sessionId: 'session-1', expectedRevision: detached.revision,
      resumeRevision: true, recoveryProof: assessed.proof,
    })

    expect(result).toMatchObject({ status: 'error', code: 'stale_target' })
    expect(readFileSync(join(context.projectRoot, 'late-local.txt'), 'utf8')).toBe('late Local byte\n')
    expect(git(context.projectRoot, 'status', '--porcelain=v1', '-uall')).toBe(localStatusBefore)
    const persisted = JSON.parse(readFileSync(registryPath, 'utf8')) as any
    expect(persisted.managedCheckouts[target.checkout.id].delivery).toMatchObject({ state: 'preview_detached' })
    expect(persisted.managedCheckouts[target.checkout.id].journal).toBeNull()
  })

  test('Given another checkout occupies the acceptance slot during detached recovery When proof is checked and the slot later changes Then both actions fail closed without journaling', async () => {
    const context = createContext()
    context.addSession('session-2', 'project-1', 'Second owner')
    const first = await context.module.bind('session-1', { kind: 'isolated' })
    const second = await context.module.bind('session-2', { kind: 'isolated' })
    const firstRoot = await context.module.resolveManagedRoot(first.checkout.id)
    const secondRoot = await context.module.resolveManagedRoot(second.checkout.id)
    writeFileSync(join(firstRoot, 'tracked.txt'), 'first detached task\n')
    writeFileSync(join(secondRoot, 'second-task.txt'), 'second active task\n')
    const firstReady = await context.module.markReadyForReview('session-1', {
      summary: 'first', validationStatus: 'passed', tests: [], suggestedCommitMessage: 'test: first',
    })
    const secondReady = await context.module.markReadyForReview('session-2', {
      summary: 'second', validationStatus: 'passed', tests: [], suggestedCommitMessage: 'test: second',
    })
    if (firstReady.delivery?.state !== 'ready_for_review' || secondReady.delivery?.state !== 'ready_for_review') {
      throw new Error('expected both reviews')
    }
    const firstPreview = await context.module.operate({ action: 'preview', sessionId: 'session-1', expectedRevision: firstReady.revision })
    if (firstPreview.status !== 'previewed') throw new Error('expected first preview')

    const registryPath = join(context.configDir, 'managed-checkouts.json')
    const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as any
    const firstRecord = registry.managedCheckouts[first.checkout.id]
    const previewId = firstRecord.delivery.preview.previewId as string
    firstRecord.delivery = {
      ...firstRecord.delivery,
      state: 'preview_detached',
      detachedAt: Date.now(),
      reason: 'stale_local',
      attemptedAction: 'rollback_preview',
    }
    firstRecord.revision += 1
    registry.revision += 1
    writeFileSync(registryPath, JSON.stringify(registry, null, 2))

    const secondCurrent = await context.module.inspect('session-2')
    const secondPreview = await context.module.operate({ action: 'preview', sessionId: 'session-2', expectedRevision: secondCurrent.revision })
    if (secondPreview.status !== 'previewed') throw new Error(`expected second preview, got ${secondPreview.status}`)
    const detached = await context.module.inspect('session-1')
    const assessed = await context.module.preflightPreviewRecovery?.(
      'session-1', detached.revision, firstReady.delivery.review.reviewId, previewId,
    )
    expect(assessed).toMatchObject({
      status: 'assessed',
      proof: {
        rollback: { status: 'blocked', code: 'project_acceptance_busy' },
        finalize: { status: 'blocked', code: 'project_acceptance_busy' },
        blocker: {
          checkoutId: second.checkout.id,
          ownerSessionId: 'session-2',
          revision: secondPreview.target.revision,
          state: 'preview_active',
        },
      },
    })
    if (!assessed || assessed.status !== 'assessed') throw new Error('expected blocked assessment')
    const blocked = await context.module.operate({
      action: 'rollback_preview', sessionId: 'session-1', expectedRevision: detached.revision,
      resumeRevision: true, recoveryProof: assessed.proof,
    })
    expect(blocked).toMatchObject({ status: 'error', code: 'project_acceptance_busy' })
    let persisted = JSON.parse(readFileSync(registryPath, 'utf8')) as any
    expect(persisted.managedCheckouts[first.checkout.id].journal).toBeNull()

    const released = await context.module.operate({
      action: 'rollback_preview', sessionId: 'session-2', expectedRevision: secondPreview.target.revision,
    })
    expect(released.status).toBe('preview_rolled_back')
    const stale = await context.module.operate({
      action: 'rollback_preview', sessionId: 'session-1', expectedRevision: detached.revision,
      resumeRevision: true, recoveryProof: assessed.proof,
    })
    expect(stale).toMatchObject({ status: 'error', code: 'stale_target' })
    persisted = JSON.parse(readFileSync(registryPath, 'utf8')) as any
    expect(persisted.managedCheckouts[first.checkout.id].delivery).toMatchObject({ state: 'preview_detached' })
    expect(persisted.managedCheckouts[first.checkout.id].journal).toBeNull()
  })

  test('Given a detached Preview and fresh proof When recovery handoff is created Then old evidence stays intact and the new Worktree starts at latest Local HEAD', async () => {
    const context = createContext()
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const managedRoot = await context.module.resolveManagedRoot(target.checkout.id)
    writeFileSync(join(managedRoot, 'tracked.txt'), 'handoff task\n')
    const ready = await context.module.markReadyForReview('session-1', {
      summary: 'handoff recovery', validationStatus: 'passed', tests: [], suggestedCommitMessage: 'test: handoff recovery',
    })
    if (ready.delivery?.state !== 'ready_for_review') throw new Error('expected review')
    const preview = await context.module.operate({ action: 'preview', sessionId: 'session-1', expectedRevision: ready.revision })
    if (preview.status !== 'previewed') throw new Error('expected previewed')
    writeFileSync(join(context.projectRoot, 'later.txt'), 'later local layer\n')
    const registryPath = join(context.configDir, 'managed-checkouts.json')
    const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as any
    const record = registry.managedCheckouts[target.checkout.id]
    const previewId = record.delivery.preview.previewId as string
    record.delivery = { ...record.delivery, state: 'preview_detached', detachedAt: Date.now(), reason: 'preview_modified', attemptedAction: 'finalize_preview' }
    record.revision += 1
    registry.revision += 1
    writeFileSync(registryPath, JSON.stringify(registry, null, 2))
    const restarted = context.restart()
    const detached = await restarted.inspect('session-1')
    const assessed = await restarted.preflightPreviewRecovery?.(
      'session-1', detached.revision, ready.delivery.review.reviewId, previewId,
    )
    if (!assessed || assessed.status !== 'assessed') throw new Error('expected assessed')
    const oldRegistry = JSON.parse(readFileSync(registryPath, 'utf8')) as any
    const oldDelivery = oldRegistry.managedCheckouts[target.checkout.id].delivery
    const localHead = git(context.projectRoot, 'rev-parse', 'HEAD')

    const handoff = await restarted.createPreviewRecoveryHandoff(
      'session-1', assessed.proof, 'recovery-session', 'handoff-request-1',
    )

    expect(handoff.targetSessionId).toBe('recovery-session')
    expect(handoff.continuation).toMatchObject({
      kind: 'worktree_preview_recovery_handoff', sourceCheckoutId: target.checkout.id,
      reviewId: ready.delivery.review.reviewId, previewId, generation: assessed.proof.generation,
    })
    expect(git(handoff.managedRoot, 'rev-parse', 'HEAD')).toBe(localHead)
    expect(readFileSync(join(handoff.managedRoot, 'tracked.txt'), 'utf8').replace(/\r\n/g, '\n')).toBe('base\n')
    expect(existsSync(join(handoff.managedRoot, 'later.txt'))).toBe(false)
    const after = JSON.parse(readFileSync(registryPath, 'utf8')) as any
    expect(after.managedCheckouts[target.checkout.id].delivery).toEqual(oldDelivery)
    const refKey = createHash('sha256').update(target.checkout.id).digest('hex').slice(0, 24)
    expect(git(context.projectRoot, 'for-each-ref', '--format=%(refname)', `refs/dsh-worktree/session-checkouts/${refKey}`)).toContain(previewId)
  })

  test('Given Local commits the Preview bytes When rollback is requested Then it fails closed, preserves committed history and releases the acceptance slot', async () => {
    const context = createContext()
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const managedRoot = await context.module.resolveManagedRoot(target.checkout.id)
    writeFileSync(join(managedRoot, 'tracked.txt'), 'preview becomes stale\n')
    const ready = await context.module.markReadyForReview('session-1', {
      summary: 'stale preview', validationStatus: 'passed', tests: [], suggestedCommitMessage: 'test: stale preview',
    })
    const preview = await context.module.operate({ action: 'preview', sessionId: 'session-1', expectedRevision: ready.revision })
    if (preview.status !== 'previewed') throw new Error(`expected previewed, got ${preview.status}`)
    git(context.projectRoot, 'add', 'tracked.txt')
    git(context.projectRoot, 'commit', '-m', 'local advanced during preview')
    const localHead = git(context.projectRoot, 'rev-parse', 'HEAD')
    const localBytes = readFileSync(join(context.projectRoot, 'tracked.txt'), 'utf8')

    const detached = await context.module.operate({
      action: 'rollback_preview', sessionId: 'session-1', expectedRevision: preview.target.revision,
    })

    expect(detached).toMatchObject({
      status: 'preview_detached', reason: 'preview_modified', attemptedAction: 'rollback_preview',
      target: { delivery: { state: 'preview_detached' } },
    })
    expect(git(context.projectRoot, 'rev-parse', 'HEAD')).toBe(localHead)
    expect(readFileSync(join(context.projectRoot, 'tracked.txt'), 'utf8')).toBe(localBytes)
    if (detached.status !== 'preview_detached') throw new Error(`expected detached, got ${detached.status}`)
    const discard = await context.module.operate({
      action: 'discard', sessionId: 'session-1', expectedRevision: detached.target.revision,
      confirmDirty: true, rollbackPreview: true,
    })
    expect(discard).toMatchObject({ status: 'error', code: 'preview_modified' })
    expect(existsSync(managedRoot)).toBe(true)
    expect(readFileSync(join(context.projectRoot, 'tracked.txt'), 'utf8')).toBe(localBytes)
  })

  test('Given one Worktree owns the Local Preview When another target requests acceptance Then it waits until rollback releases the project slot', async () => {
    const context = createContext()
    context.addSession('session-2', 'project-1', 'Second owner')
    context.addSession('local-observer', 'project-1', 'Local observer')
    await context.module.bind('local-observer', { kind: 'local' })
    const first = await context.module.bind('session-1', { kind: 'isolated' })
    const second = await context.module.bind('session-2', { kind: 'isolated' })
    const firstRoot = await context.module.resolveManagedRoot(first.checkout.id)
    const secondRoot = await context.module.resolveManagedRoot(second.checkout.id)
    writeFileSync(join(firstRoot, 'tracked.txt'), 'first preview\n')
    writeFileSync(join(secondRoot, 'tracked.txt'), 'second preview\n')
    const ready1 = await context.module.markReadyForReview('session-1', {
      summary: 'first', validationStatus: 'passed', tests: [], suggestedCommitMessage: 'test: first',
    })
    const ready2 = await context.module.markReadyForReview('session-2', {
      summary: 'second', validationStatus: 'passed', tests: [], suggestedCommitMessage: 'test: second',
    })
    const preview1 = await context.module.operate({ action: 'preview', sessionId: 'session-1', expectedRevision: ready1.revision })
    if (preview1.status !== 'previewed') throw new Error(`expected previewed, got ${preview1.status}`)
    expect(context.module.runtimeContext('local-observer')).toContain('Worktree Preview active')

    const waiting = await context.module.inspect('session-2')
    expect(waiting).toMatchObject({ reviewSlot: 'waiting', reviewSlotOwnerSessionId: 'session-1' })
    expect(await context.module.preflight?.('session-2', waiting.revision)).toMatchObject({
      status: 'blocked',
      reason: 'project_acceptance_busy',
      blocker: {
        checkoutId: first.checkout.id,
        ownerSessionId: 'session-1',
        state: 'preview_active',
      },
    })
    expect(await context.module.operate({ action: 'preview', sessionId: 'session-2', expectedRevision: waiting.revision })).toMatchObject({
      status: 'error', code: 'project_acceptance_busy',
    })

    await context.module.operate({ action: 'rollback_preview', sessionId: 'session-1', expectedRevision: preview1.target.revision })
    const available = await context.module.inspect('session-2')
    expect(available.reviewSlot).toBe('available')
    expect((await context.module.operate({ action: 'preview', sessionId: 'session-2', expectedRevision: available.revision })).status).toBe('previewed')
  })

  test('Given a legacy Apply already wrote Local When Finish or Discard is requested Then the module fails closed', async () => {
    const context = createContext()
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const managedRoot = await context.module.resolveManagedRoot(target.checkout.id)
    writeFileSync(join(managedRoot, 'tracked.txt'), 'applied change\n')
    const ready = await context.module.markReadyForReview('session-1', {
      summary: 'legacy apply',
      validationStatus: 'passed',
      tests: [],
      suggestedCommitMessage: 'test: legacy apply',
    })
    const applied = await context.module.operate({
      action: 'apply',
      sessionId: 'session-1',
      expectedRevision: ready.revision,
    })
    expect(applied.status).toBe('applied')
    const afterApply = await context.module.inspect('session-1')

    const finish = await context.module.operate({
      action: 'finish',
      sessionId: 'session-1',
      expectedRevision: afterApply.revision,
      commitMessage: 'must not commit zero delta',
    })
    expect(finish).toMatchObject({ status: 'error', code: 'operation_not_allowed' })
    const discard = await context.module.operate({
      action: 'discard',
      sessionId: 'session-1',
      expectedRevision: afterApply.revision,
      confirmDirty: true,
    })
    expect(discard).toMatchObject({ status: 'error', code: 'operation_not_allowed' })
    expect(git(context.repositoryRoot, 'status', '--porcelain=v1')).toContain('M tracked.txt')
  })

  test('Given worktree add 残余包含未知文件 When 创建 Isolated Then fail closed 并保留恢复现场', async () => {
    const context = createContext({ createWorktreeFailures: 1, createWorktreeFailureLeavesFile: true })

    await expect(context.module.bind('session-1', { kind: 'isolated' })).rejects.toMatchObject({ code: 'recovery_required' })
    const target = await context.module.inspect('session-1')

    expect(target.checkout.phase).toBe('recovery_required')
    expect(target.dirty).toBe(true)
    expect(context.getCreateWorktreeCallCount()).toBe(1)
  })












  test('Given 会话已经选择 Isolated When 重复同一选择 Then 返回同一个 checkout', async () => {
    const context = createContext()
    const first = await context.module.bind('session-1', { kind: 'isolated' })

    const second = await context.module.bind('session-1', { kind: 'isolated' })

    expect(second.checkout.id).toBe(first.checkout.id)
  })

  test('Given 同一会话并发提交相同选择 When 绑定 Isolated Then 只产生一个 checkout 身份', async () => {
    const context = createContext()

    const [first, second] = await Promise.all([
      context.module.bind('session-1', { kind: 'isolated' }),
      context.module.bind('session-1', { kind: 'isolated' }),
    ])

    expect(second.checkout.id).toBe(first.checkout.id)
  })

  test('Given 会话已经选择 Local When 尝试改绑 Isolated Then 拒绝切换', async () => {
    const context = createContext()
    await context.module.bind('session-1', { kind: 'local' })

    const rebind = context.module.bind('session-1', { kind: 'isolated' })

    await expect(rebind).rejects.toMatchObject({ code: 'target_already_bound' })
  })





  test('Given 项目不是 Git 仓库 When 选择 Isolated Then fail closed', async () => {
    const context = createContext()
    rmSync(join(context.repositoryRoot, '.git'), { recursive: true, force: true })

    const binding = context.module.bind('session-1', { kind: 'isolated' })

    await expect(binding).rejects.toMatchObject({ code: 'not_git_repository' })
  })

  test('Given 仓库移动导致台账与 Worktree 断链 When 在新位置绑定 Isolated Then 台账与链接自动搬迁', async () => {
    const context = createContext()
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const managedRoot = await context.module.resolveManagedRoot(target.checkout.id)
    const registryPath = join(context.configDir, 'managed-checkouts.json')
    const movedRoot = join(context.root, 'moved-away')
    const staleRegistry = JSON.parse(readFileSync(registryPath, 'utf8')) as any
    const record = staleRegistry.managedCheckouts[target.checkout.id]
    const adminDirName = basename(record.gitDir)
    record.localRoot = movedRoot
    record.gitCommonDir = join(movedRoot, '.git')
    record.gitDir = join(movedRoot, '.git', 'worktrees', adminDirName)
    staleRegistry.revision += 1
    writeFileSync(registryPath, JSON.stringify(staleRegistry))
    const deadPointer = `gitdir: ${join(movedRoot, '.git', 'worktrees', adminDirName)}\n`
    // Windows 上 git 会把 worktree 的 .git 指针标为隐藏（core.hideDotFiles），先删后写绕开 EPERM
    rmSync(join(managedRoot, '.git'), { force: true })
    writeFileSync(join(managedRoot, '.git'), deadPointer)

    await context.module.bind('child-session', { kind: 'isolated' })

    const healed = JSON.parse(readFileSync(registryPath, 'utf8')) as any
    const healedRecord = healed.managedCheckouts[target.checkout.id]
    expect(healedRecord.localRoot).toBe(realpathSync(context.repositoryRoot))
    expect(healedRecord.projectId).toBe('project-1')
    expect(healedRecord.gitDir).toContain(adminDirName)
    expect(readFileSync(join(managedRoot, '.git'), 'utf8')).not.toBe(deadPointer)
    git(managedRoot, 'status', '--porcelain')
  })

  test('Given 仓库根有 .worktreeinclude When 创建 Isolated Then gitignored 匹配文件被带入新 worktree', async () => {
    const context = createContext()
    writeFileSync(join(context.repositoryRoot, '.gitignore'), '.env*\n')
    writeFileSync(join(context.repositoryRoot, '.worktreeinclude'), '.env.local\n')
    writeFileSync(join(context.repositoryRoot, '.env.local'), 'SECRET=1\n')
    writeFileSync(join(context.repositoryRoot, '.env.other'), 'OTHER=1\n')
    git(context.repositoryRoot, 'add', '.gitignore', '.worktreeinclude')
    git(context.repositoryRoot, 'commit', '-m', 'include')

    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const managedRoot = await context.module.resolveManagedRoot(target.checkout.id)

    expect(readFileSync(join(managedRoot, '.env.local'), 'utf8')).toBe('SECRET=1\n')
    expect(existsSync(join(managedRoot, '.env.other'))).toBe(false)
  })

  test('Given .worktreeinclude 为空 When 创建 Isolated Then 不复制任何 gitignored 文件', async () => {
    const context = createContext()
    writeFileSync(join(context.repositoryRoot, '.gitignore'), '.env*\n')
    writeFileSync(join(context.repositoryRoot, '.worktreeinclude'), '# 仅注释\n\n')
    writeFileSync(join(context.repositoryRoot, '.env.local'), 'SECRET=1\n')
    git(context.repositoryRoot, 'add', '.gitignore', '.worktreeinclude')
    git(context.repositoryRoot, 'commit', '-m', 'include')

    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const managedRoot = await context.module.resolveManagedRoot(target.checkout.id)

    expect(existsSync(join(managedRoot, '.env.local'))).toBe(false)
  })

  test('Given 台账指向已消失路径 When 项目不是 Git 仓库时创建 Isolated Then 报错指出仓库可能已被移动', async () => {
    const context = createContext()
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const registryPath = join(context.configDir, 'managed-checkouts.json')
    const movedRoot = join(context.root, 'moved-away')
    const staleRegistry = JSON.parse(readFileSync(registryPath, 'utf8')) as any
    staleRegistry.managedCheckouts[target.checkout.id].localRoot = movedRoot
    staleRegistry.revision += 1
    writeFileSync(registryPath, JSON.stringify(staleRegistry))
    rmSync(join(context.repositoryRoot, '.git'), { recursive: true, force: true })

    const binding = context.module.bind('child-session', { kind: 'isolated' })

    await expect(binding).rejects.toMatchObject({ code: 'not_git_repository' })
    await expect(binding).rejects.toThrowError(movedRoot)
  })

  test('Given 台账指向已消失路径 When reconcile 与列出 Worktree Then 上报 staleRoot 且状态标记 needs_attention', async () => {
    const context = createContext()
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const registryPath = join(context.configDir, 'managed-checkouts.json')
    const staleRegistry = JSON.parse(readFileSync(registryPath, 'utf8')) as any
    staleRegistry.managedCheckouts[target.checkout.id].localRoot = join(context.root, 'moved-away')
    staleRegistry.revision += 1
    writeFileSync(registryPath, JSON.stringify(staleRegistry))

    const summary = await context.module.reconcile()

    expect(summary.staleRootCheckoutIds).toContain(target.checkout.id)

    const list = await context.module.listManagedWorktrees()

    expect(list.find((entry) => entry.checkoutId === target.checkout.id)?.state).toBe('needs_attention')
  })

  test('Given worktree 目录已被外部删除 When 放弃任务 Then 直接清台账并 prune 残余注册', async () => {
    const context = createContext()
    const launch = await context.createOwnerTarget('session-1', 'feat/sess-target-session-1')
    const [summary] = await context.module.listManagedWorktreesForSession('session-1')
    rmSync(launch.managedRoot, { recursive: true, force: true })

    const discarded = await context.module.manageManagedWorktreeForSession('session-1', {
      checkoutId: launch.target.checkout.id,
      expectedRevision: summary.revision,
      action: 'discard',
      confirmDirty: true,
    })

    expect(discarded.phase).toBe('discarded')
    expect(existsSync(launch.managedRoot)).toBe(false)
    expect(git(context.repositoryRoot, 'worktree', 'list', '--porcelain')).not.toContain('--worktree')
  }, 30_000)

  test('Given 旧 ready inspect 被可控 deferred 暂停 When owner 并发 Discard Then inspect 与 Discard 串行且 discarded 不会被旧结果覆盖', async () => {
    const context = createContext()
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const pause = context.pauseNextGitInspect()
    const staleInspect = context.module.inspect('session-1')
    await pause.started

    const discard = context.module.operate({
      action: 'discard',
      sessionId: 'session-1',
      expectedRevision: target.revision,
      confirmDirty: false,
    })
    await new Promise((resolve) => setTimeout(resolve, 100))

    try {
      expect(context.getRemoveWorktreeCallCount()).toBe(0)
    } finally {
      pause.resume()
    }
    const [, discarded] = await Promise.all([staleInspect, discard])
    const final = await context.module.inspect('session-1')

    expect(discarded).toMatchObject({ status: 'discarded' })
    expect(final.checkout.phase).toBe('discarded')
    if (discarded.status !== 'discarded') throw new Error(`预期 discarded，实际为 ${discarded.status}`)
    expect(final.revision).toBe(discarded.target.revision)
  }, 15_000)

  test('Given a valid v1 managed checkout registry When the module restarts Then it migrates to v2 without losing the checkout identity', async () => {
    const context = createContext()
    const original = await context.module.bind('session-1', { kind: 'isolated' })
    const registryPath = join(context.configDir, 'managed-checkouts.json')
    const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as {
      version: number
      managedCheckouts: Record<string, Record<string, unknown>>
    }
    registry.version = 1
    for (const record of Object.values(registry.managedCheckouts)) delete record.delivery
    writeFileSync(registryPath, JSON.stringify(registry, null, 2))

    const migrated = await context.restart().inspect('session-1')
    const persisted = JSON.parse(readFileSync(registryPath, 'utf8')) as { version: number }

    expect(migrated.checkout.id).toBe(original.checkout.id)
    expect(migrated.checkout.phase).toBe('ready')
    expect(migrated.delivery).toEqual({ state: 'working', iteration: 1 })
    expect(persisted.version).toBe(2)
  })










  test('Given an interrupted evidenced creation When restart Recover or Discard is requested Then neither adopts nor deletes the residue', async () => {
    const context = createContext()
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const managedRoot = await context.module.resolveManagedRoot(target.checkout.id)
    const path = join(context.configDir, 'managed-checkouts.json')
    const registry = JSON.parse(readFileSync(path, 'utf8'))
    const record = registry.managedCheckouts[target.checkout.id]
    const identity = { device: 'test', inode: 'test', birthtimeNs: 'test' }
    record.phase = 'preparing'
    record.journal = { operation: 'create', operationId: 'interrupted', step: 'creating_worktree', startedAt: Date.now(),
      creation: { root: managedRoot, commonDir: join(context.repositoryRoot, '.git'), lockReason: 'dsh-create-test',
        rootIdentity: identity, parentIdentity: identity, commonIdentity: identity } }
    registry.revision++
    writeFileSync(path, JSON.stringify(registry))
    const restarted = context.restart()
    await restarted.reconcile()
    for (const action of ['recover', 'discard'] as const) {
      const current = await restarted.inspect('session-1')
      const result = await restarted.operate({ action, sessionId: 'session-1', expectedRevision: current.revision })
      expect(result).toMatchObject({ status: 'error', code: 'recovery_unsafe' })
      expect(existsSync(join(managedRoot, 'tracked.txt'))).toBe(true)
    }
  })

  test('Given an interrupted evidenced creation When the residue is already gone Then Recover no longer reports recovery_unsafe', async () => {
    const context = createContext()
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const managedRoot = await context.module.resolveManagedRoot(target.checkout.id)
    const path = join(context.configDir, 'managed-checkouts.json')
    const registry = JSON.parse(readFileSync(path, 'utf8'))
    const record = registry.managedCheckouts[target.checkout.id]
    const identity = { device: 'test', inode: 'test', birthtimeNs: 'test' }
    record.phase = 'recovery_required'
    record.journal = { operation: 'create', operationId: 'interrupted', step: 'creating_worktree', startedAt: Date.now(),
      creation: { root: managedRoot, commonDir: join(context.repositoryRoot, '.git'), lockReason: 'dsh-create-test',
        rootIdentity: identity, parentIdentity: identity, commonIdentity: identity } }
    registry.revision++
    writeFileSync(path, JSON.stringify(registry))
    // The user already deleted the residue by hand, so nothing on disk needs protecting.
    rmSync(managedRoot, { recursive: true, force: true })
    const restarted = context.restart()
    await restarted.reconcile()
    const current = await restarted.inspect('session-1')
    const result = await restarted.operate({ action: 'recover', sessionId: 'session-1', expectedRevision: current.revision })
    // Recover cannot resurrect a directory that is gone, but it must route the user to
    // Discard instead of reporting an unsafe identity it can no longer inspect.
    expect(result).toMatchObject({ status: 'error', code: 'recovery_required' })
  })

  test('Given an interrupted evidenced creation When the residue is already gone Then Discard clears the ledger', async () => {
    const context = createContext()
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const managedRoot = await context.module.resolveManagedRoot(target.checkout.id)
    const path = join(context.configDir, 'managed-checkouts.json')
    const registry = JSON.parse(readFileSync(path, 'utf8'))
    const record = registry.managedCheckouts[target.checkout.id]
    const identity = { device: 'test', inode: 'test', birthtimeNs: 'test' }
    record.phase = 'recovery_required'
    record.journal = { operation: 'create', operationId: 'interrupted', step: 'creating_worktree', startedAt: Date.now(),
      creation: { root: managedRoot, commonDir: join(context.repositoryRoot, '.git'), lockReason: 'dsh-create-test',
        rootIdentity: identity, parentIdentity: identity, commonIdentity: identity } }
    registry.revision++
    writeFileSync(path, JSON.stringify(registry))
    rmSync(managedRoot, { recursive: true, force: true })
    const restarted = context.restart()
    await restarted.reconcile()
    const current = await restarted.inspect('session-1')
    const result = await restarted.operate({ action: 'discard', sessionId: 'session-1', expectedRevision: current.revision })
    expect(result.status).toBe('discarded')
    const settled = JSON.parse(readFileSync(path, 'utf8')).managedCheckouts[target.checkout.id]
    expect(settled.phase).toBe('discarded')
  })

  test('Given preparing journal 且 worktree 已完整创建 When 重启后 Recover Then 恢复 ready 而不覆盖文件', async () => {
    const context = createContext({ crashAfterWorktreeCreate: true })
    await expect(context.module.bind('session-1', { kind: 'isolated' }))
      .rejects.toThrow('模拟 create 落盘后的进程崩溃')
    const restarted = context.restart()
    const recovery = await restarted.inspect('session-1')

    const result = await restarted.operate({
      action: 'recover',
      sessionId: 'session-1',
      expectedRevision: recovery.revision,
    })

    expect(result.status).toBe('recovered')
    if (result.status !== 'recovered') throw new Error(`预期 recovered，实际为 ${result.status}`)
    expect(result.target.checkout.phase).toBe('ready')
    expect(git(context.repositoryRoot, 'worktree', 'list', '--porcelain')).toContain('-worktrees/')
  })



















































  test('Given process restarts after Preview artifacts were retained When reconcile runs Then receipt survives and Preview remains safely withdrawable', async () => {
    const context = createContext()
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const managedRoot = await context.module.resolveManagedRoot(target.checkout.id)
    writeFileSync(join(managedRoot, 'tracked.txt'), 'crash preview\n')
    const ready = await context.module.markReadyForReview('session-1', {
      summary: 'crash preview', validationStatus: 'passed', tests: [], suggestedCommitMessage: 'test: crash preview',
    })
    const preview = await context.module.operate({ action: 'preview', sessionId: 'session-1', expectedRevision: ready.revision })
    if (preview.status !== 'previewed') throw new Error(`expected previewed, got ${preview.status}`)
    const registryPath = join(context.configDir, 'managed-checkouts.json')
    const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as any
    const record = registry.managedCheckouts[preview.target.checkout.id]
    record.phase = 'mutating'
    record.journal = {
      operation: 'preview', operationId: 'crash-preview', step: 'artifacts_retained', startedAt: Date.now(),
      previewId: record.delivery.preview.previewId, reviewId: record.delivery.review.reviewId,
    }
    record.revision += 1
    registry.revision += 1
    writeFileSync(registryPath, JSON.stringify(registry, null, 2))

    const restarted = context.restart()
    await restarted.reconcile()
    const recovered = await restarted.inspect('session-1')
    expect(recovered).toMatchObject({ checkout: { phase: 'ready' }, delivery: { state: 'preview_active' } })
    const rollback = await restarted.operate({ action: 'rollback_preview', sessionId: 'session-1', expectedRevision: recovered.revision })
    expect(rollback.status).toBe('preview_rolled_back')
    expect(readFileSync(join(context.projectRoot, 'tracked.txt'), 'utf8').trim()).toBe('base')
  })

  test('Given process restarts after branch CAS but before exact Finalize verification When reconcile runs Then it fails closed and preserves all recovery evidence', async () => {
    const context = createContext()
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const managedRoot = await context.module.resolveManagedRoot(target.checkout.id)
    writeFileSync(join(managedRoot, 'tracked.txt'), 'crash finalize\n')
    const ready = await context.module.markReadyForReview('session-1', {
      summary: 'crash finalize', validationStatus: 'passed', validationSummary: 'recovery validation passed',
      tests: [], suggestedCommitMessage: 'test: crash finalize',
    })
    const preview = await context.module.operate({ action: 'preview', sessionId: 'session-1', expectedRevision: ready.revision })
    if (preview.status !== 'previewed') throw new Error(`expected previewed, got ${preview.status}`)
    git(context.projectRoot, 'add', 'tracked.txt')
    git(context.projectRoot, 'commit', '-m', 'test: crash finalize')
    const commitOid = git(context.projectRoot, 'rev-parse', 'HEAD')
    const registryPath = join(context.configDir, 'managed-checkouts.json')
    const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as any
    const record = registry.managedCheckouts[preview.target.checkout.id]
    record.phase = 'mutating'
    record.journal = {
      operation: 'finalize_preview', operationId: 'crash-finalize', step: 'updating_ref', startedAt: Date.now(),
      previewId: record.delivery.preview.previewId, reviewId: record.delivery.review.reviewId, commitOid,
    }
    record.revision += 1
    registry.revision += 1
    writeFileSync(registryPath, JSON.stringify(registry, null, 2))

    const restarted = context.restart()
    await restarted.reconcile()
    const recovered = await restarted.inspect('session-1')
    expect(recovered).toMatchObject({
      checkout: { phase: 'recovery_required' },
      delivery: { state: 'preview_active' },
    })
    const persisted = JSON.parse(readFileSync(registryPath, 'utf8')) as any
    expect(persisted.managedCheckouts[target.checkout.id].journal).toMatchObject({
      operation: 'finalize_preview', step: 'updating_ref', commitOid,
    })
    expect(git(context.projectRoot, 'rev-parse', 'HEAD')).toBe(commitOid)
    expect(existsSync(managedRoot)).toBe(true)
  })

  test('Given Apply engine detects stale Local When module returns operation result Then stale_local remains stable for renderer recompute guidance', async () => {
    const staleEngine: SessionCheckoutApplyEngine = {
      inspectReview: async () => ({
        status: 'ready', isolatedFingerprint: 'isolated-ready', isolatedHeadOid: 'c'.repeat(40), changedFiles: ['tracked.txt'],
      }),
      preflight: async () => ({ status: 'error', error: { code: 'stale_local', message: '不会执行' } }),
      plan: async () => ({
        status: 'ready',
        plan: {
          revision: 'plan-1',
          localFingerprint: 'local-1',
          isolatedFingerprint: 'isolated-ready',
          effectiveBaseOid: 'a'.repeat(40),
          baseStrategy: 'recorded_base',
          localHeadOid: 'b'.repeat(40),
          localHeadRef: 'refs/heads/main',
          isolatedHeadOid: 'c'.repeat(40),
          changedFiles: ['tracked.txt'],
        },
      }),
      apply: async () => ({
        status: 'error',
        error: { code: 'stale_local', message: 'Local 在 plan 后发生变化，请重新计算' },
      }),
      finish: async () => ({
        status: 'error',
        error: { code: 'stale_local', message: 'Local 在 plan 后发生变化，请重新计算' },
      }),
      preview: async () => ({ status: 'error', error: { code: 'stale_local', message: '不会执行' } }),
      rollback: async () => ({ status: 'error', error: { code: 'stale_local', message: '不会执行' } }),
      finalize: async () => ({ status: 'error', error: { code: 'stale_local', message: '不会执行' } }),
    }
    const context = createContext({ applyEngine: staleEngine })
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const managedRoot = await context.module.resolveManagedRoot(target.checkout.id)
    writeFileSync(join(managedRoot, 'tracked.txt'), 'stale local preflight\n')
    const ready = await context.module.markReadyForReview('session-1', {
      summary: 'stale local', validationStatus: 'passed', tests: [], suggestedCommitMessage: 'test: stale local',
    })

    expect(await context.module.preflight?.('session-1', ready.revision)).toMatchObject({
      status: 'blocked', reason: 'stale_local', localModified: false,
    })

    const result = await context.module.operate({
      action: 'apply',
      sessionId: 'session-1',
      expectedRevision: ready.revision,
    })

    expect(result).toMatchObject({
      status: 'error',
      code: 'stale_local',
      target: { checkout: { phase: 'ready' } },
    })
  })

  test('Given an in-place session When runtimeContext Then it instructs absolute paths into the managed root', async () => {
    const context = createContext()
    await context.createOwnerTarget('session-1', 'feat/sess-session-1')

    const text = context.module.runtimeContext('session-1')

    expect(text).toContain('In-place binding')
    expect(text).toContain('Authoritative cwd')
  })

  test('Given a plain local session When runtimeContext Then no in-place hint appears', async () => {
    const context = createContext()
    await context.module.bind('session-1', { kind: 'local' })

    const text = context.module.runtimeContext('session-1')

    expect(text).not.toContain('In-place binding')
  })

  test('Given a configured default branch while the session is on a feature branch When pruning Then merged-ness is decided against the trunk', async () => {
    const context = createContext()
    const projectRoot = context.projectRoot
    // 仓库没有 origin：defaultBranch 退到 init.defaultBranch。
    git(projectRoot, 'config', 'init.defaultBranch', 'main')
    git(projectRoot, 'checkout', '-b', 'merged-on-main')
    git(projectRoot, 'commit', '--allow-empty', '-m', 'main work')
    git(projectRoot, 'checkout', 'main')
    git(projectRoot, 'merge', '--ff-only', 'merged-on-main')
    git(projectRoot, 'checkout', '-b', 'feature')
    git(projectRoot, 'checkout', '-b', 'only-on-feature')
    git(projectRoot, 'commit', '--allow-empty', '-m', 'feature work')
    git(projectRoot, 'checkout', 'feature')
    git(projectRoot, 'merge', '--ff-only', 'only-on-feature')

    const preview = await context.module.pruneMergedBranchesForSession('session-1', { dryRun: true })

    // 旧逻辑以当前 HEAD（feature）为基准，会把只存在于 feature 的分支也当成已合并；
    // trunk（main）上的已合并分支才是安全删除对象。
    expect(preview.headBranch).toBe('feature')
    expect(preview.pruned.map((entry) => entry.name)).toEqual(['merged-on-main'])
    expect(preview.skipped.find((entry) => entry.name === 'only-on-feature')?.reason).toContain('main')
  }, 30_000)

  test('Given the project Local is in the middle of an acceptance preview When a merge is requested Then the Local write is refused while dryRun still previews', async () => {
    const context = createContext()
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const managedRoot = await context.module.resolveManagedRoot(target.checkout.id)
    const branch = 'feat/wt-slot'
    git(managedRoot, 'switch', '-c', branch)
    writeFileSync(join(managedRoot, 'slot.txt'), 'slot\n', 'utf8')
    git(managedRoot, 'add', 'slot.txt')
    git(managedRoot, 'commit', '-m', 'feat: slot work')

    const ready = await context.module.markReadyForReview('session-1', {
      summary: 'slot review', validationStatus: 'passed', tests: [], suggestedCommitMessage: 'feat: slot work',
    })
    const preview = await context.module.operate({ action: 'preview', sessionId: 'session-1', expectedRevision: ready.revision })
    expect(preview.status).toBe('previewed')

    // 真实验收占着项目 Local：任何真实合并都会绕过 preview 收据直接改写 Local。
    await expect(context.module.mergeBranchForSession('session-1', { sourceBranch: branch }))
      .rejects.toMatchObject({ code: 'project_acceptance_busy' })
    // dryRun 只在临时 worktree 试合，不动 Local，保持可预览。
    await expect(context.module.mergeBranchForSession('session-1', { sourceBranch: branch, dryRun: true }))
      .resolves.toMatchObject({ dryRun: true, type: 'merged' })
  }, 30_000)

  test('Given another session owns a worktree branch When this session asks to merge it Then the guard names the real owner', async () => {
    const context = createContext()
    context.addSession('session-2', 'project-1', 'Second owner')
    const mine = await context.module.bind('session-1', { kind: 'isolated' })
    const foreign = await context.module.bind('session-2', { kind: 'isolated' })
    const foreignRoot = await context.module.resolveManagedRoot(foreign.checkout.id)
    const foreignBranch = 'feat/wt-other-session'
    git(foreignRoot, 'switch', '-c', foreignBranch)
    writeFileSync(join(foreignRoot, 'other-session.txt'), 'other session work\n', 'utf8')
    git(foreignRoot, 'add', 'other-session.txt')
    git(foreignRoot, 'commit', '-m', 'feat: other session work')

    // 端口未实现 attachWorktreeBranch 时不会写 sessionBranch，这里直接把记录改成
    // 「已认领会话分支」的形态，复现并发会话互相看到对方分支的真实台账。
    const registryPath = join(context.configDir, 'managed-checkouts.json')
    const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as {
      revision: number
      managedCheckouts: Record<string, { revision: number; sessionBranch?: string; sourceRef: string }>
    }
    const foreignRecord = registry.managedCheckouts[foreign.checkout.id]!
    foreignRecord.sessionBranch = `refs/heads/${foreignBranch}`
    foreignRecord.revision += 1
    registry.revision += 1
    writeFileSync(registryPath, JSON.stringify(registry, null, 2))

    // 本会话自己的 worktree 分支仍然可合（归属门不误伤）。
    const mineRoot = await context.module.resolveManagedRoot(mine.checkout.id)
    const mineBranch = 'feat/wt-mine'
    git(mineRoot, 'switch', '-c', mineBranch)
    writeFileSync(join(mineRoot, 'mine.txt'), 'mine\n', 'utf8')
    git(mineRoot, 'add', 'mine.txt')
    git(mineRoot, 'commit', '-m', 'feat: mine')
    const own = await context.module.mergeBranchForSession('session-1', { sourceBranch: mineBranch, dryRun: true })
    expect(own).toMatchObject({ dryRun: true, type: 'merged' })

    // 别人会话的分支必须被拒，并指名真正的 owner，便于诊断。
    await expect(context.module.mergeBranchForSession('session-1', { sourceBranch: foreignBranch }))
      .rejects.toMatchObject({ code: 'not_owner', message: expect.stringContaining('session-2') })
    // 归属判定只看台账归属，dryRun 也不例外——试合同样拒绝，避免用 dryRun 探别人的分支。
    await expect(context.module.mergeBranchForSession('session-1', { sourceBranch: foreignBranch, dryRun: true }))
      .rejects.toMatchObject({ code: 'not_owner', message: expect.stringContaining('session-2') })
  }, 30_000)

  test('Given a delivered checkout whose directory residue survived cleanup When Recover is requested Then the terminal record is not revived', async () => {
    const context = createContext()
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const managedRoot = await context.module.resolveManagedRoot(target.checkout.id)
    const path = join(context.configDir, 'managed-checkouts.json')
    const registry = JSON.parse(readFileSync(path, 'utf8')) as {
      managedCheckouts: Record<string, { revision: number } & Record<string, unknown>>
    }
    const record = registry.managedCheckouts[target.checkout.id]!
    record.phase = 'discarded'
    record.delivery = { state: 'delivered', iteration: 1, commitOid: null, deliveredAt: Date.now() }
    writeFileSync(path, JSON.stringify(registry))

    const result = await context.module.operate({
      action: 'recover',
      sessionId: 'session-1',
      expectedRevision: record.revision,
    })

    expect(result).toMatchObject({ status: 'error', code: 'operation_not_allowed' })
    expect(existsSync(managedRoot)).toBe(true)
    const after = JSON.parse(readFileSync(path, 'utf8')) as { managedCheckouts: Record<string, { phase: string }> }
    expect(after.managedCheckouts[target.checkout.id]!.phase).toBe('discarded')
  }, 30_000)

  test('Given cleanup was blocked When only the legacy prose was persisted Then the reason falls back to the message and the structured field wins', async () => {
    const context = createContext()
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const path = join(context.configDir, 'managed-checkouts.json')
    const registry = JSON.parse(readFileSync(path, 'utf8')) as {
      managedCheckouts: Record<string, Record<string, unknown>>
    }
    const record = registry.managedCheckouts[target.checkout.id]!
    record.phase = 'retained'
    record.delivery = {
      state: 'retained',
      review: {
        reviewId: 'review-legacy',
        iteration: 1,
        preparedAt: Date.now(),
        summary: 'legacy review',
        validationStatus: 'passed',
        tests: [],
        changedFiles: [],
        suggestedCommitMessage: 'feat: legacy',
        isolatedFingerprint: 'f'.repeat(64),
        isolatedHeadOid: 'a'.repeat(40),
      },
      commitOid: null,
      isolatedFingerprint: 'f'.repeat(64),
      retention: 'retain_24h',
      retainedAt: Date.now(),
      expiresAt: Date.now() + 86_400_000,
      cleanup: 'blocked',
      cleanupMessage: 'The Worktree quarantine identity cannot be verified.',
    }
    writeFileSync(path, JSON.stringify(registry))

    const legacy = await context.module.inspectManagedWorktreeCleanup({ checkoutId: target.checkout.id })
    expect(legacy[0]?.cleanupReason).toBe('quarantine_busy')

    const persisted = JSON.parse(readFileSync(path, 'utf8')) as {
      managedCheckouts: Record<string, { delivery: Record<string, unknown> }>
    }
    persisted.managedCheckouts[target.checkout.id]!.delivery.cleanupReason = 'directory_busy'
    writeFileSync(path, JSON.stringify(persisted))

    const structured = await context.module.inspectManagedWorktreeCleanup({ checkoutId: target.checkout.id })
    expect(structured[0]?.cleanupReason).toBe('directory_busy')
  }, 30_000)
})

