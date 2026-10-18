import { describe, expect, test } from 'vitest'
import { createSessionWorkingDirectoryPort } from '../src/adapters/working-directory.js'

/**
 * The port is the only place that turns the host `workingDirectory` service
 * into a Session cwd move. Its contract matters twice: a real move (the whole
 * point of in-session Worktree creation) and a safe no-op on hosts without it.
 */
function fakeHost(initial: string, opts: { setFails?: boolean } = {}) {
  const calls: Array<{ op: string; path?: string }> = []
  let current = initial
  const service = {
    get: (session: unknown) => {
      if ((session as { id?: string }).id === 'no-service') throw new Error('unknown session')
      return current
    },
    set: async (_agent: unknown, path: string) => {
      if (opts.setFails) throw new Error('set failed')
      calls.push({ op: 'set', path })
      current = path
      return current
    },
    calls,
    current: () => current,
  }
  return service
}

function ctxWith(service: unknown): never {
  return { get: (name: string) => (name === 'workingDirectory' ? service : undefined) } as never
}

describe('working-directory port', () => {
  test('enter moves the session and reports the canonical cwd', async () => {
    const host = fakeHost('C:/repo')
    const port = createSessionWorkingDirectoryPort(ctxWith(host))
    const agent = { session: { id: 's1' } }

    await expect(port.enter(agent, 'C:/repo/wt/feature')).resolves.toBe('C:/repo/wt/feature')
    expect(host.calls).toEqual([{ op: 'set', path: 'C:/repo/wt/feature' }])
    expect(port.current(agent)).toBe('C:/repo/wt/feature')
  })

  test('enter degrades to a no-op when the host has no workingDirectory service', async () => {
    const port = createSessionWorkingDirectoryPort(ctxWith(undefined))
    // undefined, not the requested path: callers report "cwd selected" on a
    // defined value, and nothing was actually moved here.
    await expect(port.enter({ session: { id: 's1' } }, 'C:/repo/wt/feature')).resolves.toBeUndefined()
    expect(port.current({ session: { id: 's1' } })).toBeUndefined()
  })

  test('current stays undefined instead of throwing when the service rejects the session', () => {
    const port = createSessionWorkingDirectoryPort(ctxWith(fakeHost('C:/repo')))
    expect(port.current({ session: { id: 'no-service' } })).toBeUndefined()
  })

  test('leave restores the Local boundary only when the session is inside the checkout', async () => {
    const host = fakeHost('C:/repo')
    const port = createSessionWorkingDirectoryPort(ctxWith(host))
    const agent = { session: { id: 's1' } }

    // Standing in Local: nothing to restore.
    await expect(port.leave(agent, 'C:/repo/wt/feature', 'C:/repo')).resolves.toBeUndefined()
    expect(host.calls).toHaveLength(0)

    // Standing inside (including a nested directory): move back out.
    await port.enter(agent, 'C:/repo/wt/feature')
    await port.enter(agent, 'C:/repo/wt/feature/src')
    await expect(port.leave(agent, 'C:/repo/wt/feature', 'C:/repo')).resolves.toBe('C:/repo')
    expect(host.current()).toBe('C:/repo')
  })

  test('leave ignores a sibling path that merely shares a prefix', async () => {
    const host = fakeHost('C:/repo/wt/feature-2')
    const port = createSessionWorkingDirectoryPort(ctxWith(host))
    await expect(port.leave({ session: { id: 's1' } }, 'C:/repo/wt/feature', 'C:/repo')).resolves.toBeUndefined()
  })
})
