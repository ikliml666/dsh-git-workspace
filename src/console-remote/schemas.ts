import { z } from 'zod'
import { isValidCommitMessage } from '../commit-message.js'
import {
  WORKTREE_CONSOLE_ERROR_CODES,
  WORKTREE_CONSOLE_TARGET_STATES,
  type WorktreeConsoleAbandonedListResponse,
  type WorktreeConsoleAbandonedSnapshot,
  type WorktreeConsoleCreatePreviewRecoveryHandoffResponse,
  type WorktreeConsoleCreateResponse,
  type WorktreeConsoleCurrentResponse,
  type WorktreeConsoleInspectResponse,
  type WorktreeConsoleListResponse,
  type WorktreeConsoleMutationResponse,
  type WorktreeConsoleOutcome,
  type WorktreeConsolePreflightResponse,
  type WorktreeConsolePreviewRecoveryPreflightResponse,
  type WorktreeConsoleRestoreAbandonedResponse,
  type WorktreeConsoleReviewDiffResponse,
  type WorktreeConsoleGitGraphResponse,
  type WorktreeConsoleGitMutationResponse,
  type WorktreeConsoleGitOverviewResponse,
  type WorktreeConsoleGitPruneResponse,
  type WorktreeConsoleGitTagListResponse,
  type WorktreeConsoleGitTagMutationResponse,
  type WorktreeClientBootReport,
  type WorktreeSidebarTopologyResponse,
} from '../console-contract.js'

const strict = <T extends z.core.$ZodLooseShape>(shape: T) => z.object(shape).strict()

export const sessionIdSchema = z.string().min(1).max(200).refine(value => !/[\0\r\n]/u.test(value), 'unsafe session id')
export const checkoutIdSchema = z.string().min(1).max(200).refine(value => !value.includes('..') && !/[\\/\0\r\n]/u.test(value), 'unsafe checkout id')
export const reviewIdSchema = z.string().min(1).max(200).refine(value => !/[\0\r\n]/u.test(value), 'unsafe review id')
export const commitMessageSchema = z.string().trim().refine(isValidCommitMessage, 'invalid commit message')
export const revisionSchema = z.number().int().nonnegative()
const gitOidSchema = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu)
export const oidSchema = z.union([
  z.literal('unversioned'),
  z.literal('unborn'),
  gitOidSchema,
])
export const previewIdSchema = z.string().min(1).max(200).refine(value => !/[\\/\0\r\n]/u.test(value), 'unsafe preview id')
export const generationSchema = z.string().regex(/^[0-9a-f]{64}$/u)
export const requestIdSchema = z.string().min(1).max(200).refine(value => !/[\0\r\n]/u.test(value), 'unsafe request id')
export const branchNameSchema = z.string().trim().min(1).max(200).refine(
  value => !/[\0\t\r\n\\ ~^:?*[]/u.test(value)
    && !value.startsWith('-') && !value.startsWith('/') && !value.endsWith('/')
    && !value.includes('..') && !value.endsWith('.lock'),
  'unsafe branch name',
)
export const booleanSchema = z.boolean()
export const optionalLanguageSchema = z.enum(['zh', 'en']).optional()
export const optionalBooleanSchema = z.union([booleanSchema, z.undefined()])
export const retentionSchema = z.enum(['cleanup', 'retain_24h', 'retain_3d', 'retain_manual'])
export const retainedModeSchema = z.enum(['retain_24h', 'retain_3d', 'retain_manual'])

const projectSchema = strict({ id: z.string().min(1), name: z.string().min(1) })
const validationItemSchema = strict({
  command: z.string(),
  status: z.enum(['passed', 'failed', 'not_run']),
  summary: z.string().optional(),
})
const checkpointSchema = strict({
  checkpointId: checkoutIdSchema,
  sequence: z.number().int().positive(),
  reviewId: reviewIdSchema,
  createdAt: z.number().finite().nonnegative(),
  summary: z.string().max(1000),
  validationStatus: z.enum(['passed', 'failed', 'partial', 'not_run']),
  changedFiles: z.array(z.string().min(1).max(1000).refine(value => !/^(?:[A-Za-z]:[\\/]|[\\/])/u.test(value) && !value.split(/[\\/]/u).some(segment => segment === '' || segment === '.' || segment === '..'), 'unsafe checkpoint file')).max(500),
})
const reviewSchema = strict({
  reviewId: reviewIdSchema,
  revision: revisionSchema,
  iteration: z.number().int().nonnegative(),
  preparedAt: z.number().finite(),
  summary: z.string(),
  validationStatus: z.enum(['passed', 'failed', 'partial', 'not_run']),
  validationSummary: z.string().optional(),
  tests: z.array(validationItemSchema),
  changedFiles: z.array(z.string()),
  suggestedCommitMessage: z.string().min(1),
})
const capabilitiesSchema = strict({
  create: z.boolean(),
  open: z.boolean(),
  inspect: z.boolean(),
  discard: z.boolean(),
  preflight: z.boolean(),
  preview: z.boolean(),
  checkpoint: z.boolean(),
  resumeRevision: z.boolean(),
  rollbackPreview: z.boolean(),
  finalize: z.boolean(),
  finalizePreview: z.boolean(),
  setRetention: z.boolean(),
  setPermanent: z.boolean(),
  retryCleanup: z.boolean(),
  beginNextIteration: z.boolean(),
  // 新增能力必须容忍缺失：Client 与 Host 是两份独立部署的产物，宿主重启前跑
  // 的是旧 Host，它根本不知道这个键。写成必填会让整条 `current` 的 payload
  // 校验失败，胶囊直接塌成「不可用」——一个纯增量的能力位没有资格否决整个
  // 响应。用 `default(false)` 而非 `optional()`：输入可缺省，输出仍是确定的
  // boolean，契约类型因此不必跟着变宽。
  returnToLocal: z.boolean().default(false),
})
const acceptanceBlockerSchema = strict({
  checkoutId: checkoutIdSchema,
  ownerSessionId: sessionIdSchema,
  revision: revisionSchema,
  state: z.enum(['preview_active', 'preview_detached', 'finalized', 'retained', 'working', 'ready_for_review', 'delivered']),
})
const deliveryProofSchema = strict({
  localBranch: z.string().nullable(),
  localHeadBefore: oidSchema,
  localHeadAfter: oidSchema,
  changedFiles: z.array(z.string()),
  validationStatus: z.enum(['passed', 'failed', 'partial', 'not_run']).optional(),
  validationSummary: z.string().optional(),
  commitInLocalHistory: z.boolean().nullable(),
})
const targetSummarySchema = strict({
  project: projectSchema,
  checkoutId: checkoutIdSchema.nullable(),
  sourceSessionId: sessionIdSchema,
  ownerSessionId: sessionIdSchema,
  targetSessionId: sessionIdSchema.nullable(),
  iteration: z.number().int().nonnegative(),
  revision: revisionSchema,
  state: z.enum(WORKTREE_CONSOLE_TARGET_STATES),
  phase: z.enum(['local', 'preparing', 'ready', 'applying', 'mutating', 'recovery_required', 'finalized', 'retained', 'discarded']),
  dirty: z.boolean(),
  currentOid: oidSchema,
  commitOid: oidSchema.nullable(),
  sourceBranch: z.string().nullable(),
  retention: retainedModeSchema.optional(),
  retainedAt: z.number().finite().optional(),
  expiresAt: z.number().finite().nullable().optional(),
  permanent: z.boolean().optional(),
  cleanupMessage: z.string().optional(),
  deliveryProof: deliveryProofSchema.optional(),
  review: reviewSchema.optional(),
  checkpoints: z.array(checkpointSchema).max(100).optional(),
  checkpointGeneration: generationSchema.optional(),
  reviewSlot: z.enum(['available', 'waiting']).optional(),
  reviewSlotOwnerSessionId: sessionIdSchema.optional(),
  reviewSlotHolder: acceptanceBlockerSchema.optional(),
  previewRecovery: strict({
    previewId: previewIdSchema,
    detachedAt: z.number().finite(),
    reason: z.enum(['stale_local', 'preview_modified']),
    attemptedAction: z.enum(['rollback_preview', 'finalize_preview', 'discard']),
  }).optional(),
  capabilities: capabilitiesSchema,
})
function safeConflictFile(file: string): boolean {
  if (/^[A-Za-z]:[\\/]|^[\\/]/u.test(file)) return false
  if (/[\0-\x1f\x7f]/u.test(file)) return false
  return !file.split(/[\\/]/u).some(segment => segment === '' || segment === '.' || segment === '..')
}

export const recoveryContinuationSchema = strict({
  kind: z.literal('worktree_apply_conflict'),
  requestId: z.string().min(1).max(500).refine(value => !/[\0\r\n]/u.test(value), 'unsafe request id'),
  checkoutId: checkoutIdSchema,
  reviewId: reviewIdSchema,
  revision: revisionSchema,
  localHeadOid: oidSchema,
  conflictingFiles: z.array(z.string().min(1).max(1000).refine(safeConflictFile, 'unsafe conflict file')).max(500),
})
export const reviewRegenerationProofSchema = strict({
  kind: z.literal('worktree_review_regeneration'),
  requestId: z.string().min(1).max(500).refine(value => !/[\0\r\n]/u.test(value), 'unsafe request id'),
  checkoutId: checkoutIdSchema,
  reviewId: reviewIdSchema,
  revision: revisionSchema,
})
export const previewRecoveryAnalysisProofSchema = strict({
  kind: z.literal('worktree_preview_recovery_analysis'),
  requestId: z.string().min(1).max(500).refine(value => !/[\0\r\n]/u.test(value), 'unsafe request id'),
  checkoutId: checkoutIdSchema,
  reviewId: reviewIdSchema,
  previewId: previewIdSchema,
  revision: revisionSchema,
  generation: generationSchema,
})
export const previewRecoveryHandoffProofSchema = strict({
  kind: z.literal('worktree_preview_recovery_handoff'),
  requestId: z.string().min(1).max(500).refine(value => !/[\0\r\n]/u.test(value), 'unsafe request id'),
  checkoutId: checkoutIdSchema,
  sourceCheckoutId: checkoutIdSchema,
  reviewId: reviewIdSchema,
  previewId: previewIdSchema,
  revision: revisionSchema,
  generation: generationSchema,
})
const recoveryProofSchema = z.discriminatedUnion('kind', [
  recoveryContinuationSchema,
  reviewRegenerationProofSchema,
  previewRecoveryAnalysisProofSchema,
  previewRecoveryHandoffProofSchema,
])
const targetDetailsSchema = targetSummarySchema.extend({
  managedRoot: z.string().min(1).nullable(),
  sourceRoot: z.string().min(1).nullable(),
  sourceOid: oidSchema,
  currentBranch: z.string().nullable(),
  recoveryContinuation: recoveryProofSchema.optional(),
}).strict()
export const previewRecoveryHandoffResponseSchema: z.ZodType<WorktreeConsoleCreatePreviewRecoveryHandoffResponse> = strict({
  target: targetDetailsSchema,
  targetSessionId: sessionIdSchema,
  managedRoot: z.string().min(1),
  recoveryContinuation: previewRecoveryHandoffProofSchema,
})
const consoleErrorSchema = strict({
  code: z.enum(WORKTREE_CONSOLE_ERROR_CODES),
  message: z.string(),
  details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  continuation: recoveryContinuationSchema.optional(),
}).superRefine((value, ctx) => {
  if (value.continuation !== undefined && value.code !== 'apply_conflict') {
    ctx.addIssue({ code: 'custom', path: ['continuation'], message: 'only apply_conflict may carry a continuation' })
  }
})

export function outcomeSchema<T>(value: z.ZodType<T>): z.ZodType<WorktreeConsoleOutcome<T>> {
  return z.discriminatedUnion('ok', [
    strict({ ok: z.literal(true), value }),
    strict({ ok: z.literal(false), error: consoleErrorSchema }),
  ]) as z.ZodType<WorktreeConsoleOutcome<T>>
}

export const currentResponseSchema: z.ZodType<WorktreeConsoleCurrentResponse> = strict({ target: targetDetailsSchema })
export const createPreflightResponseSchema = z.discriminatedUnion('kind', [
  strict({ kind: z.literal('ready'), branches: z.array(branchNameSchema).max(1000).optional() }),
  strict({ kind: z.literal('files') }),
  strict({ kind: z.literal('empty'), confirmationToken: z.string().uuid() }),
])
export const createResponseSchema: z.ZodType<WorktreeConsoleCreateResponse> = strict({
  target: targetDetailsSchema,
  targetSessionId: sessionIdSchema,
  managedRoot: z.string().min(1),
})
export const inspectResponseSchema: z.ZodType<WorktreeConsoleInspectResponse> = strict({ target: targetDetailsSchema })
export const listResponseSchema: z.ZodType<WorktreeConsoleListResponse> = strict({ project: projectSchema, worktrees: z.array(targetSummarySchema) })
export const sidebarTopologyResponseSchema: z.ZodType<WorktreeSidebarTopologyResponse> = strict({
  workspaceClientFlavor: z.enum(['legacy', 'alpha', 'next', 'modern-rc5', 'modern-rc1', 'unsupported']).optional(),
  officialWorkspaceActive: z.boolean().optional(),
  projects: z.array(strict({
    project: projectSchema,
    memberships: strict({ workspaceIds: z.array(z.string().min(1)), sessionIds: z.array(sessionIdSchema) }).optional(),
    tasks: z.array(strict({
      checkoutId: checkoutIdSchema,
      ownerSessionId: sessionIdSchema,
      sourceSessionId: sessionIdSchema,
      iteration: z.number().int().positive(),
      revision: revisionSchema,
      phase: z.enum(['preparing', 'ready', 'applying', 'mutating', 'finalized', 'retained', 'discarded', 'recovery_required']),
      state: z.enum(['working', 'ready_for_review', 'preview_active', 'preview_detached', 'recovery_required', 'finalized', 'discarded']),
      sourceBranch: z.string().nullable(),
    })),
  })),
})
export const clientBootReportSchema: z.ZodType<WorktreeClientBootReport> = strict({
  flavor: z.string(),
  branch: z.enum(['legacy', 'alpha', 'next', 'modern-rc5', 'modern-rc1', 'unsupported', 'topology-failed', 'boot-failed']),
  registered: z.boolean(),
  detail: z.string().max(2000).optional(),
  elapsedMountMs: z.number().int().nonnegative().optional(),
  elapsedTopologyMs: z.number().int().nonnegative().optional(),
})
export const mutationResponseSchema: z.ZodType<WorktreeConsoleMutationResponse> = strict({
  target: targetSummarySchema,
  changedFiles: z.array(z.string()).optional(),
  commitOid: oidSchema.nullable().optional(),
  checkpoint: checkpointSchema.optional(),
  recoveryContinuation: recoveryProofSchema.optional(),
})
const diffFileSchema = strict({
  path: z.string(),
  previousPath: z.string().optional(),
  status: z.enum(['added', 'modified', 'deleted', 'renamed', 'binary']),
  patch: z.string().nullable(),
  truncated: z.boolean(),
})
const preflightFactsSchema = {
  localModified: z.literal(false),
  checkoutId: checkoutIdSchema,
  reviewId: reviewIdSchema,
  revision: revisionSchema,
  configuredBaseOid: oidSchema,
  effectiveBaseOid: oidSchema,
  baseStrategy: z.enum(['recorded_base', 'isolated_contains_local_head', 'local_contains_isolated_head']),
  localBranch: z.string().nullable(),
  localHeadOid: oidSchema,
  isolatedHeadOid: oidSchema,
  changedFiles: z.array(z.string()),
}
const preflightSchema = z.union([
  strict({ status: z.enum(['ready', 'local_advanced', 'already_in_local']), ...preflightFactsSchema }),
  strict({ status: z.literal('conflict'), ...preflightFactsSchema, conflictingFiles: z.array(z.string().min(1).max(1000).refine(safeConflictFile, 'unsafe conflict file')).max(500) }),
  strict({
    status: z.literal('blocked'),
    localModified: z.literal(false),
    checkoutId: z.string(),
    reviewId: reviewIdSchema.nullable(),
    revision: revisionSchema,
    reason: z.enum(['not_owner', 'not_ready_for_review', 'stale_target', 'stale_local', 'stale_isolated', 'project_acceptance_busy', 'checkout_unavailable', 'git_error']),
    message: z.string(),
    blocker: acceptanceBlockerSchema.optional(),
  }),
])
export const preflightResponseSchema: z.ZodType<WorktreeConsolePreflightResponse> = strict({ preflight: preflightSchema })

const previewRecoveryBlockedReasonSchema = z.enum([
  'stale_local',
  'preview_modified',
  'commit_isolation_conflict',
  'operation_not_allowed',
  'project_acceptance_busy',
])
const previewRecoveryBlockedActionSchema = strict({
  status: z.literal('blocked'),
  code: previewRecoveryBlockedReasonSchema,
  message: z.string(),
  conflictingFiles: z.array(z.string().min(1).max(1000).refine(safeConflictFile, 'unsafe conflict file')).max(500).optional(),
})
const previewRecoveryRollbackSchema = z.union([
  strict({ status: z.literal('safe'), targetTreeOid: gitOidSchema }),
  previewRecoveryBlockedActionSchema,
])
const previewRecoveryFinalizeSchema = z.union([
  strict({
    status: z.literal('safe'),
    taskTreeOid: gitOidSchema,
    finalIndexTreeOid: gitOidSchema,
    expectedWorkingTreeOid: gitOidSchema,
    commitRequired: z.boolean(),
  }),
  previewRecoveryBlockedActionSchema,
])
export const previewRecoveryProofSchema = strict({
  sessionId: sessionIdSchema,
  checkoutId: checkoutIdSchema,
  reviewId: reviewIdSchema,
  previewId: previewIdSchema,
  revision: revisionSchema,
  generation: generationSchema,
  receiptFingerprint: generationSchema,
  localFingerprint: generationSchema,
  localHeadOid: gitOidSchema,
  localHeadRef: z.string().min(1).max(1000).refine(value => !/[\0\r\n]/u.test(value), 'unsafe head ref').nullable(),
  localHeadTreeOid: gitOidSchema,
  localIndexTreeOid: gitOidSchema,
  localWorkingTreeOid: gitOidSchema,
  rollback: previewRecoveryRollbackSchema,
  finalize: previewRecoveryFinalizeSchema,
  blocker: acceptanceBlockerSchema.optional(),
})
const previewRecoveryPreflightSchema = z.union([
  strict({ status: z.literal('assessed'), localModified: z.literal(false), proof: previewRecoveryProofSchema }),
  strict({
    status: z.literal('blocked'),
    localModified: z.literal(false),
    checkoutId: z.string().max(200),
    reviewId: reviewIdSchema.nullable(),
    previewId: previewIdSchema.nullable(),
    revision: revisionSchema,
    reason: z.enum(['not_owner', 'not_preview_detached', 'stale_target', 'artifacts_missing', 'checkout_unavailable', 'git_error']),
    message: z.string(),
  }),
])
export const previewRecoveryPreflightResponseSchema: z.ZodType<WorktreeConsolePreviewRecoveryPreflightResponse> = strict({
  preflight: previewRecoveryPreflightSchema,
})

export const reviewDiffResponseSchema: z.ZodType<WorktreeConsoleReviewDiffResponse> = strict({
  reviewId: reviewIdSchema,
  revision: revisionSchema,
  files: z.array(diffFileSchema).max(200),
  truncated: z.boolean(),
})

const gitBranchSchema = strict({
  name: branchNameSchema,
  oid: gitOidSchema,
  isCurrent: booleanSchema,
  upstream: z.string().min(1).max(300).nullable(),
})
export const gitOverviewResponseSchema: z.ZodType<WorktreeConsoleGitOverviewResponse> = strict({
  root: z.string().min(1),
  branch: z.string().min(1).max(300).nullable(),
  headOid: z.union([gitOidSchema, z.literal('unborn')]),
  branches: z.array(gitBranchSchema).max(2000),
  /** `-1` = unknown (the untracked read overflowed); never rendered as a count. */
  dirtyCount: z.number().int().min(-1),
})
export const gitGraphResponseSchema: z.ZodType<WorktreeConsoleGitGraphResponse> = strict({
  root: z.string().min(1),
  branch: z.string().min(1).max(300).nullable(),
  commits: z.array(strict({
    oid: gitOidSchema,
    parents: z.array(gitOidSchema).max(32),
    author: z.string().max(300),
    authorTime: z.number().int().nonnegative(),
    refs: z.array(z.string().min(1).max(300)).max(50),
    subject: z.string().max(2000),
  })).max(1000),
})
export const gitMutationResponseSchema: z.ZodType<WorktreeConsoleGitMutationResponse> = strict({
  branch: z.string().min(1).max(300),
})
export const gitGraphLimitSchema = z.number().int().min(1).max(1000).optional()

const gitPruneEntrySchema = strict({
  name: branchNameSchema,
  oid: gitOidSchema,
  reason: z.string().min(1).max(500).optional(),
})
export const gitPruneResponseSchema: z.ZodType<WorktreeConsoleGitPruneResponse> = strict({
  dryRun: booleanSchema,
  headBranch: z.string().min(1).max(300).nullable(),
  pruned: z.array(gitPruneEntrySchema).max(2000),
  skipped: z.array(gitPruneEntrySchema).max(2000),
})

export const tagNameSchema = z.string().min(1).max(255).regex(/^[^\s~^:?*[\\]+$/u)
export const tagMessageSchema = z.string().max(4000).optional()
export const tagTargetSchema = z.string().min(1).max(300).optional()

const gitTagSchema = strict({
  name: tagNameSchema,
  oid: gitOidSchema,
  commitOid: gitOidSchema.nullable(),
  annotated: booleanSchema,
  message: z.string().max(4000).nullable(),
  // null = the remote could not be queried; never coerced to false.
  pushed: booleanSchema.nullable(),
})
export const gitTagListResponseSchema: z.ZodType<WorktreeConsoleGitTagListResponse> = strict({
  root: z.string().min(1),
  tags: z.array(gitTagSchema).max(2000),
})
export const gitTagMutationResponseSchema: z.ZodType<WorktreeConsoleGitTagMutationResponse> = strict({
  tag: tagNameSchema,
  pushed: booleanSchema.optional(),
  pushMessage: z.string().max(4000).optional(),
})

export const abandonedSnapshotSchema: z.ZodType<WorktreeConsoleAbandonedSnapshot> = strict({
  checkoutId: checkoutIdSchema,
  projectName: z.string().max(500),
  snapshotOid: gitOidSchema,
  snapshotAt: z.number().int().nonnegative(),
  revision: revisionSchema,
})
export const abandonedListResponseSchema: z.ZodType<WorktreeConsoleAbandonedListResponse> = strict({
  snapshots: z.array(abandonedSnapshotSchema).max(200),
})
export const restoreAbandonedResponseSchema: z.ZodType<WorktreeConsoleRestoreAbandonedResponse> = strict({
  checkoutId: checkoutIdSchema,
  branch: z.string().min(1).max(300),
})
