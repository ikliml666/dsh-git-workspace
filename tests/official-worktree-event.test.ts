import { beforeEach, describe, expect, test, vi } from 'vitest'
import { registerOfficialWorktreeAdoption } from '../src/session-target-context.ts'
import type { SessionCheckoutModule } from '../src/index.ts'

type Listener = (session: { id?: unknown }, event: { type?: unknown; data?: unknown }) => void

function harness() {
  const listeners: Listener[] = []
  const ctx = {
    on: (name: string, listener: Listener) => {
      if (name === 'session/event') listeners.push(listener)
      return () => {}
    },
  }
  const adoptOfficialWorktree = vi.fn(async () => {})
  const recordAdoptionFailure = vi.fn()
  const module = { adoptOfficialWorktree, recordAdoptionFailure } as unknown as SessionCheckoutModule
  return {
    ctx,
    module,
    adoptOfficialWorktree,
    emit: (session: { id?: unknown }, event: { type?: unknown; data?: unknown }) => {
      for (const listener of listeners) listener(session, event)
    },
  }
}

describe('adopting a Worktree when a Session walks into it', () => {
  let h: ReturnType<typeof harness>

  beforeEach(() => {
    h = harness()
    registerOfficialWorktreeAdoption(h.ctx as never, h.module)
  })

  test('subscribes to the session event feed', () => {
    expect(h.ctx.on).toBeDefined()
    h.emit({ id: 'session-1' }, { type: 'working-directory/change', data: { cwd: 'C:/work/repo/.agents/worktrees/x' } })
    expect(h.adoptOfficialWorktree).toHaveBeenCalledWith('session-1', 'C:/work/repo/.agents/worktrees/x')
  })

  test('ignores every other session event', () => {
    h.emit({ id: 'session-1' }, { type: 'step/start', data: {} })
    h.emit({ id: 'session-1' }, { type: 'working-directory/change', data: { cwd: 42 } })
    h.emit({}, { type: 'working-directory/change', data: { cwd: '/tmp' } })
    expect(h.adoptOfficialWorktree).not.toHaveBeenCalled()
  })

  test('a rejecting adoption does not escape the fire-and-forget feed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    h.adoptOfficialWorktree.mockRejectedValueOnce(new Error('git timed out'))
    h.emit({ id: 'session-1' }, { type: 'working-directory/change', data: { cwd: '/x/.agents/worktrees/y' } })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
