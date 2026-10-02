import type { WorktreeConsolePreviewRecoveryPreflightRequest } from '../../console-contract.js'
import type { WorktreePreviewRecoveryPreflightView } from '../../types.js'
import { createRequestCache, type RequestSnapshot } from './request-cache.js'

export type PreviewRecoverySnapshot = RequestSnapshot<WorktreePreviewRecoveryPreflightView>

const cache = createRequestCache<WorktreeConsolePreviewRecoveryPreflightRequest, WorktreePreviewRecoveryPreflightView>({
  key: (identity) => [
    identity.sessionId,
    identity.checkoutId,
    identity.expectedRevision,
    identity.expectedReviewId,
    identity.expectedPreviewId,
  ].join('\u0000'),
  request: (adapter, identity) => adapter.previewRecoveryPreflight(identity),
})

/** Identity-keyed, single-flight, read-only recovery assessment. Writes must force refresh. */
export const readPreviewRecoveryPreflight = cache.read

export const invalidatePreviewRecoveryPreflight = cache.invalidate

export const usePreviewRecoveryPreflight = cache.useSnapshot
