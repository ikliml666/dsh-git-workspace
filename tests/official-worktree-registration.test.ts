import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { adoptWorktreeForSession, registerOfficialWorktree } from '../src/official-worktree-registration.js'
import type { ManagedCheckoutsRegistry } from '../src/ports.js'

// 平台无关的绝对路径：Windows 字面量在 Linux 上会被 resolve 成 cwd 下的相对路径。
const REPO = join(tmpdir(), 'dsh-worktree-registration', 'repo')
const CHECKOUT = join(REPO, '.agents', 'worktrees', 'feat-sess-abc')

function emptyRegistry(): ManagedCheckoutsRegistry {
  return { version: 2, revision: 0, sessionBindings: {}, managedCheckouts: {} }
}

function fixture(overrides: { snapshot?: { root: string; commonDir: string; gitDir: string; headRef: string } | null } = {}) {
  let registry = emptyRegistry()
  const inspect = vi.fn(async () => (overrides.snapshot === undefined
    ? {
        root: CHECKOUT,
        commonDir: join(REPO, '.git'),
        gitDir: join(REPO, '.git', 'worktrees', 'feat-sess-abc'),
        headRef: 'refs/heads/feat/sess-abc',
      }
    : overrides.snapshot))
  const createCheckoutId = vi.fn(() => 'checkout-new')
  return {
    inspect,
    current: () => registry,
    dependencies: {
      lookup: {} as never,
      git: { inspect } as never,
      registry: {
        read: () => registry,
        update: (mutate: (current: ManagedCheckoutsRegistry) => ManagedCheckoutsRegistry) => {
          registry = mutate(registry)
          return registry
        },
      },
      createCheckoutId,
    },
  }
}

const registration = {
  ownerSessionId: 'session-abc',
  projectId: 'p1',
  projectName: 'repo',
  localRoot: REPO,
  path: CHECKOUT,
  baseCommit: 'b'.repeat(40),
}

describe('registering a Worktree the official service created', () => {
  test('records the checkout as ready and binds its owner Session', async () => {
    const f = fixture()
    const record = await registerOfficialWorktree(f.dependencies as never, registration)

    expect(record).toMatchObject({
      checkoutId: 'checkout-new',
      projectId: 'p1',
      projectName: 'repo',
      ownerSessionId: 'session-abc',
      sourceSessionId: 'session-abc',
      managedRoot: CHECKOUT,
      baseOid: 'b'.repeat(40),
      sessionBranch: 'refs/heads/feat/sess-abc',
      phase: 'ready',
      delivery: { state: 'working', iteration: 1 },
      journal: null,
    })
    expect(f.current().sessionBindings['session-abc']).toMatchObject({
      target: { kind: 'isolated', checkoutId: 'checkout-new' },
      ownerSessionId: 'session-abc',
      projectId: 'p1',
    })
  })

  test('takes git identity from the checkout instead of guessing the layout', async () => {
    const f = fixture()
    const record = await registerOfficialWorktree(f.dependencies as never, registration)

    expect(f.inspect).toHaveBeenCalledWith(CHECKOUT)
    expect(record.managedGitRoot).toBe(CHECKOUT)
    expect(record.gitDir).toBe(join(REPO, '.git', 'worktrees', 'feat-sess-abc'))
    expect(record.sourceRef).toBe('refs/heads/feat/sess-abc')
  })

  test('refuses a path that is not a readable Git checkout', async () => {
    const f = fixture({ snapshot: null })
    await expect(registerOfficialWorktree(f.dependencies as never, registration))
      .rejects.toThrow(/not a readable Git checkout/)
    expect(f.current().managedCheckouts).toEqual({})
  })
})

describe('adopting the Worktree a Session walked into', () => {
  const deps = (f: ReturnType<typeof fixture>, project = { id: 'p1', name: 'repo', root: REPO }) => ({
    ...f.dependencies,
    lookup: {
      getSession: (id: string) => (id === 'session-abc' ? { id, projectId: 'p1' } : undefined),
      getProject: (pid: string) => (pid === 'p1' ? project : undefined),
    },
  })

  test('records the checkout the Session just entered', async () => {
    const f = fixture()
    const record = await adoptWorktreeForSession(deps(f) as never, 'session-abc', CHECKOUT)

    expect(record).toMatchObject({
      ownerSessionId: 'session-abc',
      managedRoot: CHECKOUT,
      sessionBranch: 'refs/heads/feat/sess-abc',
      phase: 'ready',
    })
    expect(f.current().sessionBindings['session-abc']).toMatchObject({ target: { kind: 'isolated' } })
  })

  test('ignores a working directory outside the official layout', async () => {
    const f = fixture()
    const result = await adoptWorktreeForSession(deps(f) as never, 'session-abc', join(REPO, 'src'))

    expect(result).toBeUndefined()
    expect(f.current().managedCheckouts).toEqual({})
    expect(f.inspect).not.toHaveBeenCalled()
  })

  test('ignores a path that merely looks like the official layout but escapes it', async () => {
    const f = fixture()
    const result = await adoptWorktreeForSession(deps(f) as never, 'session-abc', `${REPO}\\.agents\\worktrees\\..\\..\\escape`)

    expect(result).toBeUndefined()
    expect(f.current().managedCheckouts).toEqual({})
  })

  test('does nothing for a Session that already has a target', async () => {
    const f = fixture()
    await adoptWorktreeForSession(deps(f) as never, 'session-abc', CHECKOUT)
    const again = await adoptWorktreeForSession(deps(f) as never, 'session-abc', CHECKOUT)

    expect(again).toBeUndefined()
    expect(Object.keys(f.current().managedCheckouts)).toHaveLength(1)
  })

  test('does nothing when the checkout is already in the ledger', async () => {
    const f = fixture()
    await registerOfficialWorktree(f.dependencies as never, registration)
    const adopted = await adoptWorktreeForSession(
      {
        ...deps(f),
        registry: f.dependencies.registry,
      } as never,
      'other-session',
      CHECKOUT,
    )

    expect(adopted).toBeUndefined()
    expect(Object.keys(f.current().managedCheckouts)).toHaveLength(1)
  })

  test('ignores a Session with no project', async () => {
    const f = fixture()
    const result = await adoptWorktreeForSession(
      { ...f.dependencies, lookup: { getSession: () => undefined } } as never,
      'nobody',
      CHECKOUT,
    )

    expect(result).toBeUndefined()
    expect(f.current().managedCheckouts).toEqual({})
  })
})
