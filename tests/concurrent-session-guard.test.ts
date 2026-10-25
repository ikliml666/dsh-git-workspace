import { afterEach, describe, expect, test } from 'vitest'
import { mkdtempSync, realpathSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { cwdWithinLocalRoot, detectLocalBranchRace } from '../src/concurrent-session-guard.ts'
import { createSessionCheckoutModule } from '../src/session-checkout-module.ts'
import { createNodeSessionCheckoutDependencies } from './support/production-adapters.ts'

const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

const NOW = 1_700_000_000_000
const WINDOW = 30 * 60 * 1000
const LOCAL_ROOT = '/repo/project'

describe('cwdWithinLocalRoot', () => {
  test('含边界与子目录、win32 大小写与反斜杠不敏感', () => {
    expect(cwdWithinLocalRoot('/repo/project', LOCAL_ROOT)).toBe(true)
    expect(cwdWithinLocalRoot('/repo/project/sub', LOCAL_ROOT)).toBe(true)
    expect(cwdWithinLocalRoot('/repo/project-other', LOCAL_ROOT)).toBe(false)
    expect(cwdWithinLocalRoot('/repo/other', LOCAL_ROOT)).toBe(false)
    expect(cwdWithinLocalRoot(undefined, LOCAL_ROOT)).toBe(true)
  })
})

describe('detectLocalBranchRace', () => {
  const sessions = [
    { id: 'early', createdAt: NOW - 60_000, cwd: LOCAL_ROOT },
    { id: 'late', createdAt: NOW - 1_000, cwd: LOCAL_ROOT },
  ]

  test('后启动会话 + 窗口内新分支 → 命中', () => {
    const facts = detectLocalBranchRace({
      sessions, sessionId: 'late', localRoot: LOCAL_ROOT,
      branchCreationTimes: { 'feat/other': NOW - 30_000 }, now: NOW, windowMs: WINDOW,
    })
    expect(facts.status).toBe('race_detected')
    expect(facts.earlierLocalSessionIds).toEqual(['early'])
    expect(facts.recentBranchNames).toEqual(['feat/other'])
  })

  test('先启动会话不告警', () => {
    const facts = detectLocalBranchRace({
      sessions, sessionId: 'early', localRoot: LOCAL_ROOT,
      branchCreationTimes: { 'feat/other': NOW - 30_000 }, now: NOW, windowMs: WINDOW,
    })
    expect(facts.status).toBe('clear')
    expect(facts.earlierLocalSessionIds).toEqual([])
  })

  test('窗口外旧分支不告警', () => {
    const facts = detectLocalBranchRace({
      sessions, sessionId: 'late', localRoot: LOCAL_ROOT,
      branchCreationTimes: { 'feat/old': NOW - WINDOW - 1 }, now: NOW, windowMs: WINDOW,
    })
    expect(facts.status).toBe('clear')
  })

  test('受管分支不算竞态证据', () => {
    const facts = detectLocalBranchRace({
      sessions, sessionId: 'late', localRoot: LOCAL_ROOT,
      branchCreationTimes: { 'feat/sess-managed': NOW - 30_000 }, now: NOW, windowMs: WINDOW,
      managedBranches: ['feat/sess-managed'],
    })
    expect(facts.status).toBe('clear')
  })

  test('其他工作区的会话与分支数据缺失均不告警', () => {
    const outside = detectLocalBranchRace({
      sessions: [
        { id: 'early', createdAt: NOW - 60_000, cwd: '/elsewhere' },
        { id: 'late', createdAt: NOW - 1_000, cwd: LOCAL_ROOT },
      ],
      sessionId: 'late', localRoot: LOCAL_ROOT,
      branchCreationTimes: { 'feat/other': NOW - 30_000 }, now: NOW, windowMs: WINDOW,
    })
    expect(outside.status).toBe('clear')
    const noData = detectLocalBranchRace({
      sessions, sessionId: 'late', localRoot: LOCAL_ROOT,
      branchCreationTimes: undefined, now: NOW, windowMs: WINDOW,
    })
    expect(noData.status).toBe('clear')
  })

  test('本会话 createdAt 缺失时视其他会话为更早（保守告警）', () => {
    const facts = detectLocalBranchRace({
      sessions: [
        { id: 'early', createdAt: NOW - 1 },
        { id: 'unknown-self' },
      ],
      sessionId: 'unknown-self', localRoot: LOCAL_ROOT,
      branchCreationTimes: { 'feat/other': NOW - 30_000 }, now: NOW, windowMs: WINDOW,
    })
    expect(facts.status).toBe('race_detected')
  })
})

describe('runtimeContext 集成（真实 git reflog）', () => {
  function git(cwd: string, ...args: string[]): void {
    const result = spawnSync('git', args, { cwd, encoding: 'utf-8' })
    if (result.status !== 0) throw new Error(`git ${args.join(' ')} 失败: ${result.stderr}`)
  }

  function createRaceContext(options: { branchRaceGuard?: boolean } = {}) {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'domi-race-')))
    temporaryRoots.push(root)
    git(root, 'init', '-b', 'main')
    git(root, 'config', 'user.name', 'Race Test')
    git(root, 'config', 'user.email', 'race@example.test')
    writeFileSync(join(root, 'base.txt'), 'base\n')
    git(root, 'add', 'base.txt')
    git(root, 'commit', '-m', 'base')
    // 早会话刚建的新分支：reflog 写入 branch: Created from，时间在窗口内
    git(root, 'branch', 'feat/other-session')
    const now = Date.now()
    const dependencies = createNodeSessionCheckoutDependencies({
      configDir: join(root, 'config'),
      ...(options.branchRaceGuard !== undefined ? { branchRaceGuard: options.branchRaceGuard } : {}),
      lookup: {
        getSession: (sessionId) => sessionId === 'session-late' ? { id: 'session-late', projectId: 'project-1' } : undefined,
        getProject: (projectId) => projectId === 'project-1' ? { id: 'project-1', name: 'race', root } : undefined,
        listLiveSessions: () => [
          { id: 'session-early', createdAt: now - 60_000, cwd: root },
          { id: 'session-late', createdAt: now - 1_000, cwd: root },
        ],
      },
    })
    mkdirSync(join(root, 'config'), { recursive: true })
    return { module: createSessionCheckoutModule(dependencies) }
  }

  test('刷新缓存后，后启动且无 binding 的会话收到 Branch Race 提示', async () => {
    const { module } = createRaceContext()
    await module.refreshBranchRaceGuards!()
    const text = module.runtimeContext('session-late')
    expect(text).toContain('Branch Race detected')
    expect(text).toContain('feat/other-session')
    expect(text).toContain('worktree_create')
  })

  test('刷新前缓存为空 → 静默；guard 关闭 → 始终静默', async () => {
    const { module } = createRaceContext()
    expect(module.runtimeContext('session-late')).toBe('')
    await module.refreshBranchRaceGuards!()
    const disabled = createRaceContext({ branchRaceGuard: false })
    await disabled.module.refreshBranchRaceGuards!()
    expect(disabled.module.runtimeContext('session-late')).toBe('')
  })
})
