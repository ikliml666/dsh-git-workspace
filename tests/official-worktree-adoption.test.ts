import { describe, expect, test, vi } from 'vitest'
import { adoptOfficialWorktrees } from '../src/official-worktree-adoption.js'
import type { ManagedCheckoutsRegistry, SessionCheckoutProjectRecord } from '../src/ports.js'

const REPO = 'C:\\work\\repo'
const OFFICIAL = `${REPO}\\.agents\\worktrees\\worktree-abc`
const HANDMADE = 'C:\\elsewhere\\my-own-tree'

function emptyRegistry(): ManagedCheckoutsRegistry {
  return { version: 2, revision: 0, sessionBindings: {}, managedCheckouts: {} }
}

interface Fixture {
  projects?: SessionCheckoutProjectRecord[]
  sessions?: { id: string }[]
  cwd?: (sessionId: string) => string | undefined
  worktrees?: Array<{ path: string; headOid: string; branchRef: string | null }>
  snapshot?: { root: string; commonDir: string; gitDir: string; headRef: string } | null
  registry?: ManagedCheckoutsRegistry
}

function fixture(overrides: Fixture = {}) {
  let registry = overrides.registry ?? emptyRegistry()
  const createCheckoutId = vi.fn(() => 'checkout-adopted')
  const listWorktrees = vi.fn(async () => overrides.worktrees ?? [])
  const inspect = vi.fn(async () => (overrides.snapshot === undefined
    ? { root: OFFICIAL, commonDir: 'C:\\work\\repo\\.git', gitDir: `${OFFICIAL}\\.git`, headRef: 'refs/heads/worktree-abc' }
    : overrides.snapshot))
  const dependencies = {
    lookup: {
      listProjects: () => overrides.projects ?? [{ id: 'p1', name: 'repo', root: REPO }],
      listLiveSessions: () => overrides.sessions ?? [{ id: 's1' }],
      getSessionCwd: overrides.cwd ?? (() => OFFICIAL),
      getSession: () => undefined,
      getProject: () => undefined,
    },
    git: { listWorktrees, inspect } as never,
    registry: {
      read: () => registry,
      write: (next: ManagedCheckoutsRegistry) => { registry = next },
      update: (mutate: (current: ManagedCheckoutsRegistry) => ManagedCheckoutsRegistry) => {
        registry = mutate(registry)
        return registry
      },
    },
    createCheckoutId,
  }
  return { dependencies, createCheckoutId, listWorktrees, inspect, current: () => registry }
}

const officialEntry = {
  path: OFFICIAL,
  headOid: 'a'.repeat(40),
  branchRef: 'refs/heads/worktree-abc',
}

describe('adopting Worktrees the official tool created', () => {
  test('records an official Worktree a live Session is standing in', async () => {
    const f = fixture({ worktrees: [officialEntry] })
    const result = await adoptOfficialWorktrees(f.dependencies as never)
    expect(result.adopted).toEqual([OFFICIAL])
    const registry = f.current()
    const record = registry.managedCheckouts['checkout-adopted']
    expect(record).toMatchObject({
      checkoutId: 'checkout-adopted',
      projectId: 'p1',
      ownerSessionId: 's1',
      managedRoot: OFFICIAL,
      managedGitRoot: OFFICIAL,
      phase: 'ready',
      delivery: { state: 'working', iteration: 1 },
      journal: null,
      sessionBranch: 'worktree-abc',
    })
    expect(registry.sessionBindings.s1).toMatchObject({
      target: { kind: 'isolated', checkoutId: 'checkout-adopted' },
      ownerSessionId: 's1',
    })
  })

  test('ignores Worktrees Git knows about that this plugin never created', async () => {
    // 用户手工 `git worktree add` 出来的目录不属于本插件：纳管它等于凭空接管
    // 用户自己的目录。
    const f = fixture({ worktrees: [{ ...officialEntry, path: HANDMADE }] })
    const result = await adoptOfficialWorktrees(f.dependencies as never)
    expect(result.adopted).toEqual([])
    expect(f.current().managedCheckouts).toEqual({})
  })

  test('ignores the repository main working tree', async () => {
    // Git 不给主工作区任何标记，它和普通条目一样只有 path/HEAD/branch；靠路径
    // 前缀排除。
    const f = fixture({ worktrees: [{ ...officialEntry, path: REPO }], cwd: () => REPO })
    const result = await adoptOfficialWorktrees(f.dependencies as never)
    expect(result.adopted).toEqual([])
  })

  test('skips an official Worktree no live Session is standing in', async () => {
    const f = fixture({ worktrees: [officialEntry], cwd: () => REPO })
    const result = await adoptOfficialWorktrees(f.dependencies as never)
    expect(result.adopted).toEqual([])
    expect(f.createCheckoutId).not.toHaveBeenCalled()
  })

  test('skips an official Worktree two live Sessions share', async () => {
    // 两个会话站在同一棵树里时归属无法判定；猜一个 owner 会把另一方的交付
    // 写进错误的记录。
    const f = fixture({ worktrees: [officialEntry], sessions: [{ id: 's1' }, { id: 's2' }] })
    const result = await adoptOfficialWorktrees(f.dependencies as never)
    expect(result.adopted).toEqual([])
  })

  test('does not adopt the same Worktree twice', async () => {
    const f = fixture({ worktrees: [officialEntry] })
    await adoptOfficialWorktrees(f.dependencies as never)
    const second = await adoptOfficialWorktrees(f.dependencies as never)
    expect(second.adopted).toEqual([])
    expect(Object.keys(f.current().managedCheckouts)).toEqual(['checkout-adopted'])
  })

  test('leaves an already isolated Session alone', async () => {
    const registry = emptyRegistry()
    registry.sessionBindings.s1 = {
      sessionId: 's1',
      projectId: 'p1',
      projectName: 'repo',
      target: { kind: 'isolated', checkoutId: 'existing' },
      ownerSessionId: 's1',
      sourceRef: 'refs/heads/main',
      sourceOid: 'b'.repeat(40),
      revision: 1,
    }
    const f = fixture({ worktrees: [officialEntry], registry })
    const result = await adoptOfficialWorktrees(f.dependencies as never)
    expect(result.adopted).toEqual([])
    expect(f.current().sessionBindings.s1?.target).toEqual({ kind: 'isolated', checkoutId: 'existing' })
  })

  test('keeps adopting other projects when one repository cannot be read', async () => {
    const f = fixture({
      projects: [
        { id: 'broken', name: 'broken', root: 'C:\\work\\broken' },
        { id: 'p1', name: 'repo', root: REPO },
      ],
      worktrees: [officialEntry],
    })
    f.listWorktrees.mockRejectedValueOnce(new Error('git unavailable'))
    const result = await adoptOfficialWorktrees(f.dependencies as never)
    expect(result.adopted).toEqual([OFFICIAL])
  })

  test('skips a Worktree whose Git snapshot cannot be read', async () => {
    const f = fixture({ worktrees: [officialEntry], snapshot: null })
    const result = await adoptOfficialWorktrees(f.dependencies as never)
    expect(result.adopted).toEqual([])
  })

  test('does nothing on a Host without worktree listing or project lookup', async () => {
    const f = fixture()
    const withoutListing = { ...f.dependencies, git: { inspect: f.inspect } }
    expect(await adoptOfficialWorktrees(withoutListing as never)).toEqual({ adopted: [] })
    const withoutProjects = { ...f.dependencies, lookup: { ...f.dependencies.lookup, listProjects: undefined } }
    expect(await adoptOfficialWorktrees(withoutProjects as never)).toEqual({ adopted: [] })
  })
})
