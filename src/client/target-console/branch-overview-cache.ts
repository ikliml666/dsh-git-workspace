import type {
  WorktreeConsoleAdapter,
  WorktreeConsoleGitOverviewResponse,
} from '../../console-contract.js'

/**
 * Module-level branch-overview cache: expanding the chip's popover must not
 * wait on git spawns. Entries live per session with a short TTL; refreshes
 * are stale-while-revalidate (stale data renders immediately, a flight
 * replaces it in place). Keyed by session id — the overview is repo-wide, so
 * every session of one project overwrites the same underlying repo view.
 */
const TTL_MS = 60_000

const cache = new Map<string, { value: WorktreeConsoleGitOverviewResponse; fetchedAt: number }>()
const flights = new Map<string, Promise<WorktreeConsoleGitOverviewResponse | null>>()

export function cachedBranchOverview(sessionId: string): WorktreeConsoleGitOverviewResponse | null {
  return cache.get(sessionId)?.value ?? null
}

function isFresh(entry: { fetchedAt: number }): boolean {
  return Date.now() - entry.fetchedAt < TTL_MS
}

export function invalidateBranchOverview(sessionId: string): void {
  cache.delete(sessionId)
}

/** Optimistic local patch after a mutation (switch/create) the RPC already confirmed. */
export function patchBranchOverview(sessionId: string, patch: (overview: WorktreeConsoleGitOverviewResponse) => WorktreeConsoleGitOverviewResponse): void {
  const entry = cache.get(sessionId)
  if (entry === undefined) return
  cache.set(sessionId, { value: patch(entry.value), fetchedAt: entry.fetchedAt })
}

async function fetchOverview(adapter: WorktreeConsoleAdapter, sessionId: string): Promise<WorktreeConsoleGitOverviewResponse | null> {
  const existing = flights.get(sessionId)
  if (existing !== undefined) return existing
  const flight = adapter.gitOverview(sessionId)
    .then(outcome => {
      flights.delete(sessionId)
      if (!outcome.ok) return null
      cache.set(sessionId, { value: outcome.value, fetchedAt: Date.now() })
      return outcome.value
    })
    .catch(() => {
      flights.delete(sessionId)
      return null
    })
  flights.set(sessionId, flight)
  return flight
}

/**
 * Fresh-on-demand read: resolves immediately from cache when still in TTL,
 * otherwise awaits one fetch. Failed fetches keep returning null and clear
 * the cache slot so the next call retries.
 */
export async function ensureBranchOverview(adapter: WorktreeConsoleAdapter, sessionId: string): Promise<WorktreeConsoleGitOverviewResponse | null> {
  const entry = cache.get(sessionId)
  if (entry !== undefined && isFresh(entry)) return entry.value
  return fetchOverview(adapter, sessionId)
}

/** Stale-while-revalidate read: returns the cached value (even stale) and refreshes in the background. */
export function refreshBranchOverviewInBackground(adapter: WorktreeConsoleAdapter, sessionId: string): WorktreeConsoleGitOverviewResponse | null {
  const entry = cache.get(sessionId)
  if (entry === undefined) return null
  if (!isFresh(entry) && !flights.has(sessionId)) void fetchOverview(adapter, sessionId)
  return entry.value
}
