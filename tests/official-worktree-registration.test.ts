import { describe, expect, test, vi } from 'vitest'
import { registerOfficialWorktree } from '../src/official-worktree-registration.js'
import type { ManagedCheckoutsRegistry } from '../src/ports.js'

const REPO = 'C:\\work\\repo'
const CHECKOUT = `${REPO}\\.agents\\worktrees\\feat-sess-abc`

function emptyRegistry(): ManagedCheckoutsRegistry {
  return { version: 2, revision: 0, sessionBindings: {}, managedCheckouts: {} }
}

function fixture(overrides: { snapshot?: { root: string; commonDir: string; gitDir: string; headRef: string } | null } = {}) {
  let registry = emptyRegistry()
  const inspect = vi.fn(async () => (overrides.snapshot === undefined
    ? {
        root: CHECKOUT,
        commonDir: 'C:\\work\\repo\\.git',
        gitDir: 'C:\\work\\repo\\.git\\worktrees\\feat-sess-abc',
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
  branch: 'feat/sess-abc',
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
      sessionBranch: 'feat/sess-abc',
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
    expect(record.gitDir).toBe('C:\\work\\repo\\.git\\worktrees\\feat-sess-abc')
    expect(record.sourceRef).toBe('refs/heads/feat/sess-abc')
  })

  test('refuses a path that is not a readable Git checkout', async () => {
    const f = fixture({ snapshot: null })
    await expect(registerOfficialWorktree(f.dependencies as never, registration))
      .rejects.toThrow(/not a readable Git checkout/)
    expect(f.current().managedCheckouts).toEqual({})
  })
})
