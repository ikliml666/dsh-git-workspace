import type { WorktreeConsolePreflightRequest } from '../../console-contract.js'
import type { WorktreeApplyPreflightView } from '../../types.js'
import { createRequestCache, type RequestSnapshot } from './request-cache.js'

export type PreflightSnapshot = RequestSnapshot<WorktreeApplyPreflightView>

const cache = createRequestCache<WorktreeConsolePreflightRequest, WorktreeApplyPreflightView>({
  key: (identity) => [
    identity.sessionId,
    identity.checkoutId,
    identity.expectedRevision,
    identity.expectedReviewId,
  ].join('\u0000'),
  request: (adapter, identity) => adapter.preflight(identity),
})

/** Shared read-only request. `force` bypasses cached success and is mandatory before writes. */
export const readReviewPreflight = cache.read

/** Discard one identity result; in-flight reads still publish only to the orphaned entry. */
export const invalidateReviewPreflight = cache.invalidate

export const useReviewPreflight = cache.useSnapshot
