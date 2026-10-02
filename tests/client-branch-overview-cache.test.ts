// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from 'vitest'
import type { WorktreeConsoleGitOverviewResponse } from '../src/console-contract.js'
import {
  cachedBranchOverview,
  ensureBranchOverview,
  invalidateBranchOverview,
  patchBranchOverview,
  refreshBranchOverviewInBackground,
} from '../src/client/target-console/branch-overview-cache.js'
import { createWorktreeConsoleAdapterFixture } from './support/worktree-console.js'

const sessionId = 'cache-session'

function overview(branches: { name: string; isCurrent: boolean }[]): WorktreeConsoleGitOverviewResponse {
  return {
    root: '/fixture/project',
    branch: branches.find(branch => branch.isCurrent)?.name ?? null,
    headOid: 'a'.repeat(40),
    branches: branches.map(branch => ({ ...branch, oid: 'a'.repeat(40), upstream: null })),
    dirtyCount: 0,
  }
}

afterEach(() => {
  invalidateBranchOverview(sessionId)
})

describe('Branch overview cache flights', () => {
  test('a background flight resolving after an optimistic patch does not clobber the patch', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    // Seed the cache with an artificially old fetchedAt so the stale-while-revalidate
    // refresh actually launches a flight against the deferred adapter below.
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(Date.now() - 61_000)
    fixture.adapter.gitOverview = vi.fn(async () => ({ ok: true as const, value: overview([{ name: 'main', isCurrent: true }]) }))
    await ensureBranchOverview(fixture.adapter, sessionId)
    nowSpy.mockRestore()

    let resolveFlight!: (value: { ok: true; value: WorktreeConsoleGitOverviewResponse }) => void
    fixture.adapter.gitOverview = vi.fn(() => new Promise<{ ok: true; value: WorktreeConsoleGitOverviewResponse }>(resolve => { resolveFlight = resolve }))
    refreshBranchOverviewInBackground(fixture.adapter, sessionId)

    patchBranchOverview(sessionId, current => ({
      ...current,
      branch: 'feature/patched',
      branches: current.branches.map(item => ({ ...item, isCurrent: item.name === 'feature/patched' })),
    }))
    expect(cachedBranchOverview(sessionId)?.branch).toBe('feature/patched')

    resolveFlight({ ok: true, value: overview([{ name: 'main', isCurrent: true }]) })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(cachedBranchOverview(sessionId)?.branch).toBe('feature/patched')
    expect(cachedBranchOverview(sessionId)?.branches.some(item => item.isCurrent)).toBe(false)
  })

  test('invalidation during a flight keeps the flight from re-populating the cache', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(Date.now() - 61_000)
    fixture.adapter.gitOverview = vi.fn(async () => ({ ok: true as const, value: overview([{ name: 'main', isCurrent: true }]) }))
    await ensureBranchOverview(fixture.adapter, sessionId)
    nowSpy.mockRestore()

    let resolveFlight!: (value: { ok: true; value: WorktreeConsoleGitOverviewResponse }) => void
    fixture.adapter.gitOverview = vi.fn(() => new Promise<{ ok: true; value: WorktreeConsoleGitOverviewResponse }>(resolve => { resolveFlight = resolve }))
    refreshBranchOverviewInBackground(fixture.adapter, sessionId)
    invalidateBranchOverview(sessionId)
    expect(cachedBranchOverview(sessionId)).toBeNull()

    resolveFlight({ ok: true, value: overview([{ name: 'main', isCurrent: true }]) })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(cachedBranchOverview(sessionId)).toBeNull()
  })

  test('a flight without an interleaved mutation still repopulates the cache', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    fixture.adapter.gitOverview = vi.fn(async () => ({ ok: true as const, value: overview([{ name: 'feature/fresh', isCurrent: true }]) }))
    invalidateBranchOverview(sessionId)
    await expect(ensureBranchOverview(fixture.adapter, sessionId)).resolves.toMatchObject({ branch: 'feature/fresh' })
    expect(cachedBranchOverview(sessionId)?.branch).toBe('feature/fresh')
  })
})
