import type { InvocationDescriptor, InvocationParameterDescriptor, TypertCodec, TypertRemoteContribution, TypertSchema } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import {
  booleanSchema,
  branchNameSchema,
  clientBootReportSchema,
  optionalLanguageSchema,
  checkoutIdSchema,
  commitMessageSchema,
  currentResponseSchema,
  generationSchema,
  gitGraphLimitSchema,
  gitGraphResponseSchema,
  gitMutationResponseSchema,
  gitOverviewResponseSchema,
  gitPruneResponseSchema,
  gitTagListResponseSchema,
  gitTagMutationResponseSchema,
  tagMessageSchema,
  tagNameSchema,
  tagTargetSchema,
  abandonedListResponseSchema,
  restoreAbandonedResponseSchema,
  requestIdSchema,
  inspectResponseSchema,
  listResponseSchema,
  mutationResponseSchema,
  optionalBooleanSchema,
  outcomeSchema,
  preflightResponseSchema,
  previewRecoveryHandoffResponseSchema,
  previewRecoveryPreflightResponseSchema,
  previewRecoveryProofSchema,
  previewIdSchema,
  retainedModeSchema,
  recoveryContinuationSchema,
  retentionSchema,
  reviewDiffResponseSchema,
  reviewIdSchema,
  revisionSchema,
  sessionIdSchema,
  createWorktreeResponseSchema,
  sidebarTopologyResponseSchema,
} from './schemas.js'

const PACKAGE = 'dsh-git-worktree'
const SERVICE = 'gitWorktree'
const AGENT_WIRE_TYPE = '@deepseek-ai/dsh-session/types#SessionId'

// DSH 0.2 materializes strict schemas through create(). Keep one schema instance
// per descriptor so client-side validation and generated Typert metadata agree.
function strictCodec(typeSymbol: string, schema: TypertSchema): TypertCodec {
  // Keep the legacy `schema` field as an extra runtime property for older
  // client adapters; DSH 0.2 consumes the canonical lazy `create()` field.
  return { mode: 'strict', typeSymbol, create: () => schema, schema } as TypertCodec
}

const agentParameter: InvocationParameterDescriptor = {
  name: 'agent',
  wire: 'agentId',
  source: 'lookup',
  lookup: 'agent',
  codec: strictCodec(AGENT_WIRE_TYPE, sessionIdSchema),
}

function json(name: string, schema: { parse(value: unknown): unknown }, typeSymbol: string, acceptsUndefined = false): InvocationParameterDescriptor {
  return {
    name,
    wire: name,
    source: 'json',
    ...(acceptsUndefined ? { acceptsUndefined: true as const } : {}),
    codec: strictCodec(typeSymbol, schema),
  }
}

function descriptor(
  method: string,
  parameters: readonly InvocationParameterDescriptor[],
  resultSchema: { parse(value: unknown): unknown },
  resultType: string,
  withAgent = true,
): InvocationDescriptor {
  return {
    id: `${PACKAGE}#${SERVICE}/${method}`,
    service: SERVICE,
    namespace: SERVICE,
    method,
    invocation: { kind: 'direct' },
    parameters: [...(withAgent ? [agentParameter, ...parameters] : parameters), json('locale', optionalLanguageSchema, 'string | undefined', true)],
    result: strictCodec(`${PACKAGE}/console-contract#${resultType}`, resultSchema),
  }
}

export const WORKTREE_CONSOLE_DESCRIPTORS: readonly InvocationDescriptor[] = Object.freeze([
  descriptor('sidebarTopology', [], outcomeSchema(sidebarTopologyResponseSchema), 'WorktreeConsoleOutcome<WorktreeSidebarTopologyResponse>', false),
  descriptor('clientBootReport', [json('report', clientBootReportSchema, 'WorktreeClientBootReport')], booleanSchema, 'boolean', false),
  descriptor('current', [], outcomeSchema(currentResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsoleCurrentResponse>'),
  descriptor('list', [
    json('needsAttention', optionalBooleanSchema, 'boolean | undefined', true),
    json('includeDelivered', optionalBooleanSchema, 'boolean | undefined', true),
  ], outcomeSchema(listResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsoleListResponse>'),
  descriptor('gitOverview', [], outcomeSchema(gitOverviewResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsoleGitOverviewResponse>'),
  descriptor('gitGraph', [
    json('limit', gitGraphLimitSchema, 'number | undefined', true),
  ], outcomeSchema(gitGraphResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsoleGitGraphResponse>'),
  descriptor('initProject', [], outcomeSchema(booleanSchema), 'WorktreeConsoleOutcome<boolean>'),
  descriptor('inspect', [
    json('checkoutId', checkoutIdSchema, `${PACKAGE}/console-contract#WorktreeConsoleInspectRequest.checkoutId`),
  ], outcomeSchema(inspectResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsoleInspectResponse>'),
  descriptor('reviewDiff', [
    json('checkoutId', checkoutIdSchema, `${PACKAGE}/console-contract#WorktreeConsoleReviewDiffRequest.checkoutId`),
    json('expectedRevision', revisionSchema, `${PACKAGE}/console-contract#WorktreeConsoleReviewDiffRequest.expectedRevision`),
    json('expectedReviewId', reviewIdSchema, `${PACKAGE}/console-contract#WorktreeConsoleReviewDiffRequest.expectedReviewId`),
  ], outcomeSchema(reviewDiffResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsoleReviewDiffResponse>'),
  descriptor('preflight', [
    json('checkoutId', checkoutIdSchema, `${PACKAGE}/console-contract#WorktreeConsolePreflightRequest.checkoutId`),
    json('expectedRevision', revisionSchema, `${PACKAGE}/console-contract#WorktreeConsolePreflightRequest.expectedRevision`),
    json('expectedReviewId', reviewIdSchema, `${PACKAGE}/console-contract#WorktreeConsolePreflightRequest.expectedReviewId`),
  ], outcomeSchema(preflightResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsolePreflightResponse>'),
  descriptor('previewRecoveryPreflight', [
    json('checkoutId', checkoutIdSchema, `${PACKAGE}/console-contract#WorktreeConsolePreviewRecoveryPreflightRequest.checkoutId`),
    json('expectedRevision', revisionSchema, `${PACKAGE}/console-contract#WorktreeConsolePreviewRecoveryPreflightRequest.expectedRevision`),
    json('expectedReviewId', reviewIdSchema, `${PACKAGE}/console-contract#WorktreeConsolePreviewRecoveryPreflightRequest.expectedReviewId`),
    json('expectedPreviewId', previewIdSchema, `${PACKAGE}/console-contract#WorktreeConsolePreviewRecoveryPreflightRequest.expectedPreviewId`),
  ], outcomeSchema(previewRecoveryPreflightResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsolePreviewRecoveryPreflightResponse>'),
  descriptor('preparePreviewRecoveryAnalysis', [
    json('checkoutId', checkoutIdSchema, `${PACKAGE}/console-contract#WorktreeConsolePreparePreviewRecoveryAnalysisRequest.checkoutId`),
    json('expectedRevision', revisionSchema, `${PACKAGE}/console-contract#WorktreeConsolePreparePreviewRecoveryAnalysisRequest.expectedRevision`),
    json('expectedReviewId', reviewIdSchema, `${PACKAGE}/console-contract#WorktreeConsolePreparePreviewRecoveryAnalysisRequest.expectedReviewId`),
    json('expectedPreviewId', previewIdSchema, `${PACKAGE}/console-contract#WorktreeConsolePreparePreviewRecoveryAnalysisRequest.expectedPreviewId`),
    json('recoveryProof', previewRecoveryProofSchema, `${PACKAGE}/console-contract#WorktreeConsolePreparePreviewRecoveryAnalysisRequest.recoveryProof`),
  ], outcomeSchema(mutationResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>'),
  descriptor('createPreviewRecoveryHandoff', [
    json('checkoutId', checkoutIdSchema, `${PACKAGE}/console-contract#WorktreeConsoleCreatePreviewRecoveryHandoffRequest.checkoutId`),
    json('expectedRevision', revisionSchema, `${PACKAGE}/console-contract#WorktreeConsoleCreatePreviewRecoveryHandoffRequest.expectedRevision`),
    json('expectedReviewId', reviewIdSchema, `${PACKAGE}/console-contract#WorktreeConsoleCreatePreviewRecoveryHandoffRequest.expectedReviewId`),
    json('expectedPreviewId', previewIdSchema, `${PACKAGE}/console-contract#WorktreeConsoleCreatePreviewRecoveryHandoffRequest.expectedPreviewId`),
    json('recoveryProof', previewRecoveryProofSchema, `${PACKAGE}/console-contract#WorktreeConsoleCreatePreviewRecoveryHandoffRequest.recoveryProof`),
  ], outcomeSchema(previewRecoveryHandoffResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsoleCreatePreviewRecoveryHandoffResponse>'),
  descriptor('preview', [
    json('checkoutId', checkoutIdSchema, `${PACKAGE}/console-contract#WorktreeConsolePreviewRequest.checkoutId`),
    json('expectedRevision', revisionSchema, `${PACKAGE}/console-contract#WorktreeConsolePreviewRequest.expectedRevision`),
    json('expectedReviewId', reviewIdSchema, `${PACKAGE}/console-contract#WorktreeConsolePreviewRequest.expectedReviewId`),
  ], outcomeSchema(mutationResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>'),
  descriptor('checkpoint', [
    json('checkoutId', checkoutIdSchema, `${PACKAGE}/console-contract#WorktreeConsoleCheckpointRequest.checkoutId`),
    json('expectedRevision', revisionSchema, `${PACKAGE}/console-contract#WorktreeConsoleCheckpointRequest.expectedRevision`),
    json('expectedReviewId', reviewIdSchema, `${PACKAGE}/console-contract#WorktreeConsoleCheckpointRequest.expectedReviewId`),
    json('expectedGeneration', generationSchema, `${PACKAGE}/console-contract#WorktreeConsoleCheckpointRequest.expectedGeneration`),
    json('requestId', requestIdSchema, `${PACKAGE}/console-contract#WorktreeConsoleCheckpointRequest.requestId`),
    json('commitMessage', commitMessageSchema, `${PACKAGE}/console-contract#WorktreeConsoleCheckpointRequest.commitMessage`),
  ], outcomeSchema(mutationResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>'),
  descriptor('resumeRevision', [
    json('checkoutId', checkoutIdSchema, `${PACKAGE}/console-contract#WorktreeConsoleResumeRevisionRequest.checkoutId`),
    json('expectedRevision', revisionSchema, `${PACKAGE}/console-contract#WorktreeConsoleResumeRevisionRequest.expectedRevision`),
    json('expectedReviewId', reviewIdSchema, `${PACKAGE}/console-contract#WorktreeConsoleResumeRevisionRequest.expectedReviewId`),
    json('conflictContinuation', recoveryContinuationSchema.optional(), `${PACKAGE}/console-contract#WorktreeConsoleResumeRevisionRequest.conflictContinuation`, true),
  ], outcomeSchema(mutationResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>'),
  descriptor('prepareReviewRegeneration', [
    json('checkoutId', checkoutIdSchema, `${PACKAGE}/console-contract#WorktreeConsolePrepareRegenerationRequest.checkoutId`),
    json('expectedRevision', revisionSchema, `${PACKAGE}/console-contract#WorktreeConsolePrepareRegenerationRequest.expectedRevision`),
    json('expectedReviewId', reviewIdSchema, `${PACKAGE}/console-contract#WorktreeConsolePrepareRegenerationRequest.expectedReviewId`),
  ], outcomeSchema(mutationResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>'),
  descriptor('rollbackPreview', [
    json('checkoutId', checkoutIdSchema, `${PACKAGE}/console-contract#WorktreeConsoleRollbackPreviewRequest.checkoutId`),
    json('expectedRevision', revisionSchema, `${PACKAGE}/console-contract#WorktreeConsoleRollbackPreviewRequest.expectedRevision`),
    json('resumeRevision', optionalBooleanSchema, `${PACKAGE}/console-contract#WorktreeConsoleRollbackPreviewRequest.resumeRevision`, true),
    json('recoveryProof', previewRecoveryProofSchema.optional(), `${PACKAGE}/console-contract#WorktreeConsoleRollbackPreviewRequest.recoveryProof`, true),
  ], outcomeSchema(mutationResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>'),
  descriptor('discard', [
    json('checkoutId', checkoutIdSchema, `${PACKAGE}/console-contract#WorktreeConsoleDiscardRequest.checkoutId`),
    json('expectedRevision', revisionSchema, `${PACKAGE}/console-contract#WorktreeConsoleDiscardRequest.expectedRevision`),
    json('confirmDirty', booleanSchema, 'boolean'),
    json('rollbackPreview', optionalBooleanSchema, `${PACKAGE}/console-contract#WorktreeConsoleDiscardRequest.rollbackPreview`, true),
  ], outcomeSchema(mutationResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>'),
  descriptor('finalize', [
    json('checkoutId', checkoutIdSchema, `${PACKAGE}/console-contract#WorktreeConsoleFinalizeRequest.checkoutId`),
    json('expectedRevision', revisionSchema, `${PACKAGE}/console-contract#WorktreeConsoleFinalizeRequest.expectedRevision`),
    json('expectedReviewId', reviewIdSchema, `${PACKAGE}/console-contract#WorktreeConsoleFinalizeRequest.expectedReviewId`),
    json('commitMessage', commitMessageSchema, `${PACKAGE}/console-contract#WorktreeConsoleFinalizeRequest.commitMessage`),
    json('retention', retentionSchema, `${PACKAGE}/types#WorktreeRetentionMode`),
  ], outcomeSchema(mutationResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>'),
  descriptor('deliver', [
    json('checkoutId', checkoutIdSchema, `${PACKAGE}/console-contract#WorktreeConsoleDeliverRequest.checkoutId`),
    json('expectedRevision', revisionSchema, `${PACKAGE}/console-contract#WorktreeConsoleDeliverRequest.expectedRevision`),
    json('commitMessage', commitMessageSchema, `${PACKAGE}/console-contract#WorktreeConsoleDeliverRequest.commitMessage`),
    json('retention', retentionSchema, `${PACKAGE}/types#WorktreeRetentionMode`),
  ], outcomeSchema(mutationResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>'),
  descriptor('finalizePreview', [
    json('checkoutId', checkoutIdSchema, `${PACKAGE}/console-contract#WorktreeConsoleFinalizePreviewRequest.checkoutId`),
    json('expectedRevision', revisionSchema, `${PACKAGE}/console-contract#WorktreeConsoleFinalizePreviewRequest.expectedRevision`),
    json('expectedReviewId', reviewIdSchema, `${PACKAGE}/console-contract#WorktreeConsoleFinalizePreviewRequest.expectedReviewId`),
    json('commitMessage', commitMessageSchema, `${PACKAGE}/console-contract#WorktreeConsoleFinalizePreviewRequest.commitMessage`),
    json('retention', retentionSchema, `${PACKAGE}/types#WorktreeRetentionMode`),
    json('recoveryProof', previewRecoveryProofSchema.optional(), `${PACKAGE}/console-contract#WorktreeConsoleFinalizePreviewRequest.recoveryProof`, true),
  ], outcomeSchema(mutationResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>'),
  descriptor('setRetention', [
    json('checkoutId', checkoutIdSchema, `${PACKAGE}/console-contract#WorktreeConsoleSetRetentionRequest.checkoutId`),
    json('expectedRevision', revisionSchema, `${PACKAGE}/console-contract#WorktreeConsoleSetRetentionRequest.expectedRevision`),
    json('retention', retainedModeSchema, `${PACKAGE}/console-contract#WorktreeConsoleSetRetentionRequest.retention`),
  ], outcomeSchema(mutationResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>'),
  descriptor('setPermanent', [
    json('checkoutId', checkoutIdSchema, `${PACKAGE}/console-contract#WorktreeConsoleSetPermanentRequest.checkoutId`),
    json('expectedRevision', revisionSchema, `${PACKAGE}/console-contract#WorktreeConsoleSetPermanentRequest.expectedRevision`),
    json('permanent', booleanSchema, `${PACKAGE}/console-contract#WorktreeConsoleSetPermanentRequest.permanent`),
  ], outcomeSchema(mutationResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>'),
  descriptor('retryCleanup', [
    json('checkoutId', checkoutIdSchema, `${PACKAGE}/console-contract#WorktreeConsoleRetryCleanupRequest.checkoutId`),
    json('expectedRevision', revisionSchema, `${PACKAGE}/console-contract#WorktreeConsoleRetryCleanupRequest.expectedRevision`),
    json('discardPostDeliveryChanges', optionalBooleanSchema, `${PACKAGE}/console-contract#WorktreeConsoleRetryCleanupRequest.discardPostDeliveryChanges`, true),
  ], outcomeSchema(mutationResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>'),
  descriptor('beginNextIteration', [
    json('checkoutId', checkoutIdSchema, `${PACKAGE}/console-contract#WorktreeConsoleBeginNextIterationRequest.checkoutId`),
    json('expectedRevision', revisionSchema, `${PACKAGE}/console-contract#WorktreeConsoleBeginNextIterationRequest.expectedRevision`),
  ], outcomeSchema(mutationResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>'),
  descriptor('returnToLocal', [
    json('checkoutId', checkoutIdSchema, `${PACKAGE}/console-contract#WorktreeConsoleReturnToLocalRequest.checkoutId`),
  ], outcomeSchema(currentResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsoleReturnToLocalResponse>'),
  descriptor('createWorktree', [
    json('from', z.union([branchNameSchema, z.null()]), `${PACKAGE}/console-contract#WorktreeConsoleCreateWorktreeRequest.from`),
  ], outcomeSchema(createWorktreeResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsoleCreateWorktreeResponse>'),
  descriptor('clearSidebarBadge', [
    json('checkoutId', checkoutIdSchema, `${PACKAGE}/console-contract#WorktreeConsoleClearSidebarBadgeRequest.checkoutId`),
    json('expectedRevision', revisionSchema, `${PACKAGE}/console-contract#WorktreeConsoleClearSidebarBadgeRequest.expectedRevision`),
  ], outcomeSchema(mutationResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>'),
  descriptor('gitCreateBranch', [
    json('name', branchNameSchema, `${PACKAGE}/console-contract#WorktreeConsoleGitBranch.name`),
  ], outcomeSchema(gitMutationResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsoleGitMutationResponse>'),
  descriptor('gitSwitchBranch', [
    json('branch', branchNameSchema, `${PACKAGE}/console-contract#WorktreeConsoleGitBranch.name`),
  ], outcomeSchema(gitMutationResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsoleGitMutationResponse>'),
  descriptor('gitPruneMergedBranches', [
    json('dryRun', booleanSchema, 'boolean'),
  ], outcomeSchema(gitPruneResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsoleGitPruneResponse>'),
  descriptor('gitListTags', [], outcomeSchema(gitTagListResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsoleGitTagListResponse>'),
  descriptor('gitCreateTag', [
    json('name', tagNameSchema, 'string'),
    json('message', tagMessageSchema, 'string | undefined', true),
    json('target', tagTargetSchema, 'string | undefined', true),
    json('push', optionalBooleanSchema, 'boolean | undefined', true),
  ], outcomeSchema(gitTagMutationResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsoleGitTagMutationResponse>'),
  descriptor('gitDeleteTag', [
    json('name', tagNameSchema, 'string'),
    json('remote', optionalBooleanSchema, 'boolean | undefined', true),
  ], outcomeSchema(gitTagMutationResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsoleGitTagMutationResponse>'),
  descriptor('gitPushTag', [
    json('name', tagNameSchema, 'string'),
  ], outcomeSchema(gitTagMutationResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsoleGitTagMutationResponse>'),
  descriptor('listAbandoned', [], outcomeSchema(abandonedListResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsoleAbandonedListResponse>'),
  descriptor('restoreAbandoned', [
    json('checkoutId', checkoutIdSchema, `${PACKAGE}/console-contract#WorktreeConsoleRestoreAbandonedRequest.checkoutId`),
  ], outcomeSchema(restoreAbandonedResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsoleRestoreAbandonedResponse>'),
])

export const WORKTREE_CONSOLE_REMOTE: TypertRemoteContribution = Object.freeze({
  package: PACKAGE,
  descriptors: WORKTREE_CONSOLE_DESCRIPTORS,
})
