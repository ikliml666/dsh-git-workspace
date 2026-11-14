export const WORKTREE_REVIEW_REFRESH_EVENT = 'dsh-git-workspace:review-refresh'

/** Notify all mounted review surfaces to re-read the Host-authoritative target. */
export function requestWorktreeReviewRefresh(sessionId: string): void {
  window.dispatchEvent(new CustomEvent(WORKTREE_REVIEW_REFRESH_EVENT, { detail: { sessionId } }))
}
