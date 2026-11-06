import { beforeEach, describe, expect, test, vi } from 'vitest'

const spies = vi.hoisted(() => ({
  register: vi.fn(),
  decorate: vi.fn(),
  applyTools: vi.fn(),
  topology: vi.fn(),
}))
vi.mock('../src/client/index.js', () => ({ apply: spies.applyTools, inject: ['conversation'] }))
vi.mock('../src/client/workspace-sidebar/index.js', () => ({
  registerManagedWorkspaceSidebar: spies.register,
  registerDecoratedWorkspaceSidebar: spies.decorate,
}))
vi.mock('../src/client/console-remote/adapter.js', () => ({
  createWorktreeConsoleRemoteAdapter: () => ({ sidebarTopology: spies.topology }),
}))

import { apply } from '../src/client/console-remote/index.js'
import { apply as applyAlpha } from './official-workspace-client-alpha.mock.js'
import { apply as applyNext } from './official-workspace-client-next.mock.js'
import { apply as applyRc1 } from './official-workspace-client.mock.js'
import { apply as applyRc5 } from './official-workspace-client-rc5.mock.js'

function clientContext(legacy = false) {
  const session = legacy ? { open: vi.fn() } : {}
  const ctx: any = {
    remote: { $mount: vi.fn(async () => () => {}) },
    effect: vi.fn(),
    provide: vi.fn(),
    inject: vi.fn((_inject, callback) => callback(ctx)),
    get: vi.fn((key: string) => key === 'sessions' ? session : key === 'remote.gitWorktree' ? {} : undefined),
  }
  return ctx
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('one Host-pinned Browser provider per Client startup', () => {
  test.each([
    ['legacy', true, undefined],
    ['alpha', false, applyAlpha],
    ['next', false, applyNext],
  ] as const)('%s registers exactly its own Browser', async (flavor, legacy, selected) => {
    spies.topology.mockResolvedValue({ ok: true, value: { projects: [], workspaceClientFlavor: flavor } })
    const ctx = clientContext(legacy)
    await apply(ctx)
    expect(spies.register).toHaveBeenCalledTimes(1)
    expect(spies.register.mock.calls[0]?.[2]).toBe(selected)
    expect(spies.applyTools).toHaveBeenCalledTimes(1)
    expect(ctx.inject.mock.calls.map(([inject]: [string[]]) => inject)).toEqual(flavor === 'legacy'
      ? [['conversation']]
      : [flavor === 'alpha'
        ? ['slots', 'sessions', 'workspaces', 'locale', 'remote', 'remote.directoryPicker', 'layout']
        : ['slots', 'sessions', 'workspaces', 'locale', 'remote', 'remote.directoryPicker', 'layout', 'shortcuts'], ['conversation']])
  })

  test('unknown Host leaves official Browser untouched', async () => {
    spies.topology.mockResolvedValue({ ok: true, value: { projects: [], workspaceClientFlavor: 'unsupported' } })
    const ctx = clientContext()
    await apply(ctx)
    expect(spies.register).not.toHaveBeenCalled()
    expect(spies.applyTools).toHaveBeenCalledTimes(1)
  })

  test.each(['alpha', 'next'] as const)('%s with the official Workspace live decorates instead of replaying', async (flavor) => {
    spies.topology.mockResolvedValue({ ok: true, value: { projects: [], workspaceClientFlavor: flavor, officialWorkspaceActive: true } })
    const ctx = clientContext()
    await apply(ctx)
    expect(spies.decorate).toHaveBeenCalledTimes(1)
    expect(spies.decorate.mock.calls[0]?.[0]).toBe(ctx)
    expect(spies.decorate.mock.calls[0]?.[1]).toBeDefined()
    expect(spies.register).not.toHaveBeenCalled()
    expect(spies.applyTools).toHaveBeenCalledTimes(1)
  })

  test.each([
    ['modern-rc5', applyRc5],
    ['modern-rc1', applyRc1],
  ] as const)('%s replays its own derivative when the takeover cleared the official Workspace', async (flavor, selected) => {
    spies.topology.mockResolvedValue({ ok: true, value: { projects: [], workspaceClientFlavor: flavor, officialWorkspaceActive: false } })
    await apply(clientContext())
    expect(spies.register).toHaveBeenCalledTimes(1)
    // The applied derivative is what renders the row decoration the decorate
    // path cannot: the official leading seat is replaced by status dots while a
    // Session runs, so only the derived row keeps the Worktree badge visible.
    expect(spies.register.mock.calls[0]?.[2]).toBe(selected)
    expect(spies.decorate).not.toHaveBeenCalled()
    expect(spies.applyTools).toHaveBeenCalledTimes(1)
  })

  test.each([
    ['modern-rc5'],
    ['modern-rc1'],
  ] as const)('%s with the official Workspace live decorates instead of replaying', async (flavor) => {
    spies.topology.mockResolvedValue({ ok: true, value: { projects: [], workspaceClientFlavor: flavor, officialWorkspaceActive: true } })
    await apply(clientContext())
    expect(spies.decorate).toHaveBeenCalledTimes(1)
    expect(spies.register).not.toHaveBeenCalled()
    expect(spies.applyTools).toHaveBeenCalledTimes(1)
  })

  test('fails before registering a mismatched Browser', async () => {    spies.topology.mockResolvedValueOnce({ ok: true, value: { projects: [], workspaceClientFlavor: 'legacy' } })
    await expect(apply(clientContext())).rejects.toThrow(/sessions\.open/u)
    expect(spies.register).not.toHaveBeenCalled()
  })

  test('still mounts the tools when the topology cannot be read', async () => {
    // 拓扑读不出来通常意味着 registry 损坏，而这正是用户需要工具视图去修的东西：
    // 整条挂载失败会连修复入口一起带走，所以这里只放弃侧栏装配。
    spies.topology.mockResolvedValueOnce({ ok: false, error: { code: 'unavailable', message: 'unreadable' } })
    await apply(clientContext())
    expect(spies.register).not.toHaveBeenCalled()
    expect(spies.decorate).not.toHaveBeenCalled()
    expect(spies.applyTools).toHaveBeenCalledTimes(1)
  })
})
