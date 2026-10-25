/**
 * Concurrent-session branch-race guard.
 *
 * Detects the exact scenario where multiple live Sessions share one Local Git
 * checkout (the same workspace) and a new local branch was created recently:
 * every later-started Session that keeps working in that checkout would branch
 * off the same HEAD and switch Local HEAD underneath the other Session. The
 * guard itself is a pure synchronous predicate over data the caller collects
 * (live sessions from the harness `sessions` store, branch creation times from
 * a background reflog refresh) so the runtimeContext provider — which the
 * system-prompt contract requires to stay synchronous — can evaluate it.
 * @module dsh-git-worktree/concurrent-session-guard
 */

/** Minimal live-session projection the guard needs from the sessions store. */
export interface GuardSessionInfo {
  readonly id: string
  /** Millisecond epoch from the session header; missing on legacy hosts. */
  readonly createdAt?: number
  readonly cwd?: string
}

export interface BranchRaceFacts {
  readonly status: 'race_detected' | 'clear'
  /** Live Sessions rooted in this Local boundary that started before this one. */
  readonly earlierLocalSessionIds: readonly string[]
  /** Local branches created inside the detection window, newest first. */
  readonly recentBranchNames: readonly string[]
}

export interface BranchRaceInput {
  readonly sessions: readonly GuardSessionInfo[]
  readonly sessionId: string
  /**
   * Local boundary root. A session counts as sharing the checkout when its
   * cwd is the root itself or a descendant, or its cwd is missing (assume it
   * shares — the caller only passes sessions it already scoped to the
   * workspace when cwd projection is unavailable).
   */
  readonly localRoot: string
  /** branch name → millisecond creation time (from per-branch reflog). */
  readonly branchCreationTimes: Record<string, number> | undefined
  readonly now: number
  /** Detection window in milliseconds. */
  readonly windowMs: number
  /**
   * Branches owned by managed worktrees never race: they live in isolated
   * checkouts, so exclude them from the "recent new branch" evidence.
   */
  readonly managedBranches?: readonly string[]
}

function normalizePath(path: string): string {
  const resolved = path.replace(/\\/gu, '/')
  const withSlash = resolved.endsWith('/') ? resolved : `${resolved}/`
  return process.platform === 'win32' ? withSlash.toLowerCase() : withSlash
}

/** Containment with the boundary itself included; paths are compared textually. */
export function cwdWithinLocalRoot(cwd: string | undefined, localRoot: string): boolean {
  if (typeof cwd !== 'string' || cwd.length === 0) return true
  const normalizedCwd = normalizePath(cwd)
  const normalizedRoot = normalizePath(localRoot)
  return normalizedCwd === normalizedRoot || normalizedCwd.startsWith(normalizedRoot)
}

/** Pure race predicate; see the module comment for the data sources. */
export function detectLocalBranchRace(input: BranchRaceInput): BranchRaceFacts {
  const self = input.sessions.find((session) => session.id === input.sessionId)
  const earlierLocalSessionIds = input.sessions
    .filter((session) => session.id !== input.sessionId)
    .filter((session) => cwdWithinLocalRoot(session.cwd, input.localRoot))
    // Without this session's own createdAt the ordering is unknown; keep the
    // guard useful by treating every other session as potentially earlier.
    .filter((session) => self?.createdAt === undefined
      || session.createdAt === undefined
      || session.createdAt <= self.createdAt)
    .map((session) => session.id)
  const managed = new Set(input.managedBranches ?? [])
  const windowStart = input.now - input.windowMs
  const recentBranchNames = Object.entries(input.branchCreationTimes ?? {})
    .filter(([name, createdAt]) => !managed.has(name) && createdAt >= windowStart)
    .sort((left, right) => right[1] - left[1])
    .map(([name]) => name)
  if (earlierLocalSessionIds.length === 0 || recentBranchNames.length === 0) {
    return { status: 'clear', earlierLocalSessionIds, recentBranchNames }
  }
  return { status: 'race_detected', earlierLocalSessionIds, recentBranchNames }
}
