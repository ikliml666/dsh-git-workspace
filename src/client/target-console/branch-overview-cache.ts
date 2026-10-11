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
 *
 * 起飞于补丁/失效之前的 flight 解析时不得回写缓存：否则会踩掉 switch 确认后
 * 写入的乐观补丁并重赋 TTL。patchEpochs 让每次 patch/invalidate 自增，
 * flight 只在纪元未变时回写。
 */
const TTL_MS = 60_000

const cache = new Map<string, { value: WorktreeConsoleGitOverviewResponse; fetchedAt: number }>()
const flights = new Map<string, Promise<WorktreeConsoleGitOverviewResponse | null>>()
const patchEpochs = new Map<string, number>()

function bumpEpoch(sessionId: string): void {
  patchEpochs.set(sessionId, (patchEpochs.get(sessionId) ?? 0) + 1)
}

export function cachedBranchOverview(sessionId: string): WorktreeConsoleGitOverviewResponse | null {
  return cache.get(sessionId)?.value ?? null
}

function isFresh(entry: { fetchedAt: number }): boolean {
  return Date.now() - entry.fetchedAt < TTL_MS
}

export function invalidateBranchOverview(sessionId: string): void {
  bumpEpoch(sessionId)
  cache.delete(sessionId)
}

/** Optimistic local patch after a mutation (switch/create) the RPC already confirmed. */
export function patchBranchOverview(sessionId: string, patch: (overview: WorktreeConsoleGitOverviewResponse) => WorktreeConsoleGitOverviewResponse): void {
  const entry = cache.get(sessionId)
  if (entry === undefined) return
  bumpEpoch(sessionId)
  cache.set(sessionId, { value: patch(entry.value), fetchedAt: entry.fetchedAt })
}

async function fetchOverview(adapter: WorktreeConsoleAdapter, sessionId: string): Promise<WorktreeConsoleGitOverviewResponse | null> {
  const existing = flights.get(sessionId)
  if (existing !== undefined) return existing
  const epoch = patchEpochs.get(sessionId) ?? 0
  const flight = adapter.gitOverview(sessionId)
    .then(outcome => {
      flights.delete(sessionId)
      if (!outcome.ok) {
        // 失败必须清槽：否则陈旧快照会带着过期 TTL 一直展示（doc 声称的行为）。
        // 仅在纪元未变时清，避免踩掉飞行中落地的乐观补丁。
        if ((patchEpochs.get(sessionId) ?? 0) === epoch) cache.delete(sessionId)
        return null
      }
      if ((patchEpochs.get(sessionId) ?? 0) === epoch) {
        cache.set(sessionId, { value: outcome.value, fetchedAt: Date.now() })
      }
      return outcome.value
    })
    .catch(() => {
      flights.delete(sessionId)
      if ((patchEpochs.get(sessionId) ?? 0) === epoch) cache.delete(sessionId)
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
