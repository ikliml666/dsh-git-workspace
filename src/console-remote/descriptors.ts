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
  previewRecoveryProofSchema,
  previewIdSchema,
  retainedModeSchema,
  recoveryContinuationSchema,
  retentionSchema,
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
  descriptor('discard', [
    json('checkoutId', checkoutIdSchema, `${PACKAGE}/console-contract#WorktreeConsoleDiscardRequest.checkoutId`),
    json('expectedRevision', revisionSchema, `${PACKAGE}/console-contract#WorktreeConsoleDiscardRequest.expectedRevision`),
    json('confirmDirty', booleanSchema, 'boolean'),
    json('rollbackPreview', optionalBooleanSchema, `${PACKAGE}/console-contract#WorktreeConsoleDiscardRequest.rollbackPreview`, true),
  ], outcomeSchema(mutationResponseSchema), 'WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>'),
  descriptor('deliver', [
    json('checkoutId', checkoutIdSchema, `${PACKAGE}/console-contract#WorktreeConsoleDeliverRequest.checkoutId`),
    json('expectedRevision', revisionSchema, `${PACKAGE}/console-contract#WorktreeConsoleDeliverRequest.expectedRevision`),
    json('commitMessage', commitMessageSchema, `${PACKAGE}/console-contract#WorktreeConsoleDeliverRequest.commitMessage`),
    json('retention', retentionSchema, `${PACKAGE}/types#WorktreeRetentionMode`),
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
