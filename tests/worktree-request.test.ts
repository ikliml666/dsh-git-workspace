import { beforeEach, describe, expect, test, vi } from 'vitest'
import { Session } from '@deepseek-ai/dsh-session'
import {
  cancelWorktreeRequest,
  liveWorktreeRequest,
  mountWorktreeRequest,
  pendingWorktreeRequest,
  requestWorktree,
  setWorktreeRequest,
} from '../src/worktree-request.ts'
import type { SessionCheckoutModule } from '../src/index.ts'

function session(): Session {
  return Session.create('session-1')
}

describe('the queued "start in a new worktree" request', () => {
  test('folds the newest request out of the session log', () => {
    const s = session()
    expect(pendingWorktreeRequest(s)).toBeNull()
    requestWorktree(s, 'main')
    expect(pendingWorktreeRequest(s)).toEqual({ from: 'main', failure: null })
    requestWorktree(s, null)
    expect(pendingWorktreeRequest(s)).toEqual({ from: null, failure: null })
  })

  test('a cancel clears the request and leaves nothing pending', () => {
    const s = session()
    requestWorktree(s, 'release')
    cancelWorktreeRequest(s)
    expect(pendingWorktreeRequest(s)).toBeNull()
  })

  test('survives a fresh fold over the same log, which is what a restart does', () => {
    const s = session()
    requestWorktree(s, 'main')
    // 重放整份日志（重启 / 刷新页面）必须得到同一个待办，不能依赖内存状态。
    expect(pendingWorktreeRequest(Session.create('session-1', s.snapshotEvents()))).toEqual({ from: 'main', failure: null })
  })
})

describe('the Host side write entry point', () => {
  const store = () => {
    const map = new Map<string, Session>()
    const s = session()
    map.set(s.id, s)
    return {
      ctx: { get: (name: string) => (name === 'sessions' ? { get: (id: string) => map.get(id) } : undefined) },
      s,
    }
  }

  test('records a request for a live session', () => {
    const { ctx, s } = store()
    expect(setWorktreeRequest(ctx as never, s.id, 'main')).toEqual({ from: 'main', failure: null })
    expect(pendingWorktreeRequest(s)).toEqual({ from: 'main', failure: null })
  })

  test('undefined withdraws the request', () => {
    const { ctx, s } = store()
    setWorktreeRequest(ctx as never, s.id, 'main')
    expect(setWorktreeRequest(ctx as never, s.id, undefined)).toBeNull()
  })

  test('a session that is not live is refused instead of silently dropped', () => {
    const { ctx } = store()
    expect(() => setWorktreeRequest(ctx as never, 'session-gone', 'main'))
      .toThrow('Session session-gone is not live, so its worktree request cannot be recorded.')
  })

  test('reading a session that is not live reports nothing pending', () => {
    const { ctx } = store()
    expect(liveWorktreeRequest(ctx as never, 'session-gone')).toBeNull()
  })
})

type PreStepListener = (
  payload: { agent: unknown; step: number; messages: readonly unknown[] },
  next: () => unknown,
) => unknown

function harness(options: { kind?: 'local' | 'isolated'; unbound?: boolean } = {}) {
  const listeners: PreStepListener[] = []
  const ctxSessions = new Map<string, Session>()
  const ctx = {
    get: (name: string) => {
      if (name === 'workingDirectory') {
        return { get: () => 'C:/repo', set: async (_agent: unknown, path: string) => path }
      }
      if (name === 'sessions') return { get: (id: string) => ctxSessions.get(id) }
      return undefined
    },
    on: (name: string, listener: PreStepListener) => {
      if (name === 'agent/pre-step') listeners.push(listener)
      return () => {}
    },
  }
  const createOfficialTarget = vi.fn(async () => ({
    targetSessionId: 'session-1',
    managedRoot: 'C:/repo/.agents/worktrees/x',
    target: {},
  }))
  // unbound: 还没选 Session Target 的会话，inspect 直接抛 target_unselected。
  const inspect = vi.fn(async () => {
    if (options.unbound === true) throw new Error('会话尚未选择 Session Target')
    return { checkout: { kind: options.kind ?? 'local' } }
  })
  const module = { inspect, createOfficialTarget } as unknown as SessionCheckoutModule
  mountWorktreeRequest(ctx as never, module)
  return { ctx, ctxSessions, createOfficialTarget, inspect, listener: () => listeners[0]! }
}

describe('creating the Worktree at the first step of a turn', () => {
  let h: ReturnType<typeof harness>

  beforeEach(() => {
    h = harness()
  })

  test('a queued request becomes a worktree and is cleared', async () => {
    const s = session()
    h.ctxSessions.set(s.id, s)
    requestWorktree(s, 'main')
    const agent = { session: s, inbox: { prepend: vi.fn() } }
    const next = vi.fn(() => 'continued')

    const result = await h.listener()({ agent, step: 1, messages: [{ id: 1 }] }, next)

    expect(result).toBe('continued')
    expect(h.createOfficialTarget).toHaveBeenCalledWith(agent, { branch: 'main' })
    expect(pendingWorktreeRequest(s)).toBeNull()
    expect(agent.inbox.prepend).not.toHaveBeenCalled()
  })

  test('no request means the turn runs untouched', async () => {
    const s = session()
    h.ctxSessions.set(s.id, s)
    const agent = { session: s, inbox: { prepend: vi.fn() } }
    const next = vi.fn(() => 'continued')

    await h.listener()({ agent, step: 1, messages: [] }, next)

    expect(next).toHaveBeenCalled()
    expect(h.createOfficialTarget).not.toHaveBeenCalled()
  })

  test('only the first step builds; a later step lets the turn continue', async () => {
    const s = session()
    h.ctxSessions.set(s.id, s)
    requestWorktree(s, null)
    const agent = { session: s, inbox: { prepend: vi.fn() } }
    const next = vi.fn(() => 'continued')

    await h.listener()({ agent, step: 2, messages: [] }, next)

    expect(next).toHaveBeenCalled()
    expect(h.createOfficialTarget).not.toHaveBeenCalled()
    expect(pendingWorktreeRequest(s)).toEqual({ from: null, failure: null })
  })

  test('a Session with no target yet still gets its worktree', async () => {
    // 真仓库上抓到的 bug：unbound 会话 inspect 抛 target_unselected，而抛出点在
    // try 之外，于是 pre-step 直接炸掉——消息已 claim，等于凭空丢失。这是新建会话
    // 最常见的入口，绝不能因为「读不出当前目标」就放弃建树。
    h = harness({ unbound: true })
    const s = session()
    h.ctxSessions.set(s.id, s)
    requestWorktree(s, 'main')
    const agent = { session: s, inbox: { prepend: vi.fn() } }
    const next = vi.fn(() => 'continued')

    const result = await h.listener()({ agent, step: 1, messages: [{ id: 1 }] }, next)

    expect(result).toBe('continued')
    expect(h.createOfficialTarget).toHaveBeenCalledWith(agent, { branch: 'main' })
    expect(pendingWorktreeRequest(s)).toBeNull()
    expect(agent.inbox.prepend).not.toHaveBeenCalled()
  })

  test('a request that outlived its purpose only clears the flag', async () => {
    // 会话已经站在某棵托管树里（例如用户在别处建了树），不该再建第二棵。
    h = harness({ kind: 'isolated' })
    const s = session()
    h.ctxSessions.set(s.id, s)
    requestWorktree(s, 'main')
    const agent = { session: s, inbox: { prepend: vi.fn() } }
    const next = vi.fn(() => 'continued')

    await h.listener()({ agent, step: 1, messages: [] }, next)

    expect(next).toHaveBeenCalled()
    expect(h.createOfficialTarget).not.toHaveBeenCalled()
    expect(pendingWorktreeRequest(s)).toBeNull()
  })

  test('a failed creation returns the claimed messages instead of losing them', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const s = session()
    h.ctxSessions.set(s.id, s)
    requestWorktree(s, 'main')
    const messages = [{ id: 1 }, { id: 2 }]
    const agent = { session: s, inbox: { prepend: vi.fn() } }
    h.createOfficialTarget.mockRejectedValueOnce(new Error('git timed out'))

    const result = await h.listener()({ agent, step: 1, messages }, vi.fn())

    // inbox.claim() 已经把这批消息移出队列；不还回去等于用户的消息凭空消失。
    expect(agent.inbox.prepend).toHaveBeenCalledTimes(2)
    // prepend 插队头，所以按逆序插回去，队列里的最终顺序才和用户发出的一致。
    expect(agent.inbox.prepend.mock.calls.map(call => call[1]).reverse()).toEqual([{ id: 1 }, { id: 2 }])
    expect(result).toEqual({ kind: 'reject' })
    expect(warn).toHaveBeenCalled()
    // 请求留着（用户修好原因后重发即会重试），并把原因写进日志供胶囊显示。
    expect(pendingWorktreeRequest(s)).toEqual({ from: 'main', failure: 'git timed out' })
    warn.mockRestore()
  })
})
