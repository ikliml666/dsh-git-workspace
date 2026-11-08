import type { Language } from '../i18n/core.js'
import type { RemoteResult, TypertRemoteNamespace } from '@deepseek-ai/dsh-typert-protocol'
import type {
  WorktreeConsoleAbandonedListResponse,
  WorktreeConsoleCreatePreviewRecoveryHandoffResponse,
  WorktreeConsoleCurrentResponse,
  WorktreeConsoleInspectResponse,
  WorktreeConsoleListResponse,
  WorktreeConsoleMutationResponse,
  WorktreeConsoleOutcome,
  WorktreeConsolePreflightResponse,
  WorktreeConsolePreviewRecoveryPreflightResponse,
  WorktreeConsoleRestoreAbandonedResponse,
  WorktreeConsoleReturnToLocalResponse,
  WorktreeConsoleCreateWorktreeResponse,
  WorktreeConsoleReviewDiffResponse,
  WorktreeConsoleGitGraphResponse,
  WorktreeConsoleGitMutationResponse,
  WorktreeConsoleGitOverviewResponse,
  WorktreeConsoleGitPruneResponse,
  WorktreeConsoleGitTagListResponse,
  WorktreeConsoleGitTagMutationResponse,
  WorktreeApplyConflictContinuation,
  WorktreeClientBootReport,
  WorktreeSidebarTopologyResponse,
} from '../console-contract.js'
import type { WorktreePreviewRecoveryProof, WorktreeRetentionMode } from '../types.js'
import { WORKTREE_CONSOLE_REMOTE } from './descriptors.js'

export type GitWorktreeRemote = TypertRemoteNamespace<'gitWorktree'>

export default WORKTREE_CONSOLE_REMOTE
export { WORKTREE_CONSOLE_DESCRIPTORS, WORKTREE_CONSOLE_REMOTE } from './descriptors.js'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteMap {
    'gitWorktree/sidebarTopology': (locale?: Language) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeSidebarTopologyResponse>>>
    'gitWorktree/clientBootReport': (report: WorktreeClientBootReport, locale?: Language) => Promise<RemoteResult<boolean>>
    'gitWorktree/current': (agentId: string, locale?: Language) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleCurrentResponse>>>
    'gitWorktree/list': (agentId: string, needsAttention?: boolean, includeDelivered?: boolean, locale?: Language) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleListResponse>>>
    'gitWorktree/initProject': (agentId: string, locale?: Language) => Promise<RemoteResult<WorktreeConsoleOutcome<boolean>>>
    'gitWorktree/inspect': (agentId: string, checkoutId: string, locale?: Language) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleInspectResponse>>>
    'gitWorktree/reviewDiff': (agentId: string, checkoutId: string, expectedRevision: number, expectedReviewId: string, locale?: Language) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleReviewDiffResponse>>>
    'gitWorktree/preflight': (agentId: string, checkoutId: string, expectedRevision: number, expectedReviewId: string, locale?: Language) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsolePreflightResponse>>>
    'gitWorktree/previewRecoveryPreflight': (agentId: string, checkoutId: string, expectedRevision: number, expectedReviewId: string, expectedPreviewId: string, locale?: Language) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsolePreviewRecoveryPreflightResponse>>>
    'gitWorktree/preparePreviewRecoveryAnalysis': (agentId: string, checkoutId: string, expectedRevision: number, expectedReviewId: string, expectedPreviewId: string, recoveryProof: WorktreePreviewRecoveryProof, locale?: Language) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>>
    'gitWorktree/createPreviewRecoveryHandoff': (agentId: string, checkoutId: string, expectedRevision: number, expectedReviewId: string, expectedPreviewId: string, recoveryProof: WorktreePreviewRecoveryProof, locale?: Language) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleCreatePreviewRecoveryHandoffResponse>>>
    'gitWorktree/preview': (agentId: string, checkoutId: string, expectedRevision: number, expectedReviewId: string, locale?: Language) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>>
    'gitWorktree/checkpoint': (agentId: string, checkoutId: string, expectedRevision: number, expectedReviewId: string, expectedGeneration: string, requestId: string, commitMessage: string, locale?: Language) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>>
    'gitWorktree/resumeRevision': (agentId: string, checkoutId: string, expectedRevision: number, expectedReviewId: string, conflictContinuation?: WorktreeApplyConflictContinuation, locale?: Language) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>>
    'gitWorktree/prepareReviewRegeneration': (agentId: string, checkoutId: string, expectedRevision: number, expectedReviewId: string, locale?: Language) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>>
    'gitWorktree/rollbackPreview': (agentId: string, checkoutId: string, expectedRevision: number, resumeRevision?: boolean, recoveryProof?: WorktreePreviewRecoveryProof, locale?: Language) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>>
    'gitWorktree/discard': (agentId: string, checkoutId: string, expectedRevision: number, confirmDirty: boolean, rollbackPreview?: boolean, locale?: Language) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>>
    'gitWorktree/finalize': (agentId: string, checkoutId: string, expectedRevision: number, expectedReviewId: string, commitMessage: string, retention: WorktreeRetentionMode, locale?: Language) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>>
    'gitWorktree/deliver': (agentId: string, checkoutId: string, expectedRevision: number, commitMessage: string, retention: WorktreeRetentionMode, locale?: Language) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>>
    'gitWorktree/finalizePreview': (agentId: string, checkoutId: string, expectedRevision: number, expectedReviewId: string, commitMessage: string, retention: WorktreeRetentionMode, recoveryProof?: WorktreePreviewRecoveryProof, locale?: Language) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>>
    'gitWorktree/setRetention': (agentId: string, checkoutId: string, expectedRevision: number, retention: Exclude<WorktreeRetentionMode, 'cleanup'>, locale?: Language) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>>
    'gitWorktree/setPermanent': (agentId: string, checkoutId: string, expectedRevision: number, permanent: boolean, locale?: Language) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>>
    'gitWorktree/retryCleanup': (agentId: string, checkoutId: string, expectedRevision: number, discardPostDeliveryChanges?: boolean, locale?: Language) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>>
    'gitWorktree/beginNextIteration': (agentId: string, checkoutId: string, expectedRevision: number, locale?: Language) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>>
    'gitWorktree/returnToLocal': (agentId: string, checkoutId: string, locale?: Language) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleReturnToLocalResponse>>>
    'gitWorktree/createWorktree': (agentId: string, from: string | null, locale?: Language) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleCreateWorktreeResponse>>>
    'gitWorktree/clearSidebarBadge': (agentId: string, checkoutId: string, expectedRevision: number, locale?: Language) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>>
    'gitWorktree/gitOverview': (agentId: string, locale?: Language) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleGitOverviewResponse>>>
    'gitWorktree/gitGraph': (agentId: string, limit?: number, locale?: Language) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleGitGraphResponse>>>
    'gitWorktree/gitCreateBranch': (agentId: string, name: string, locale?: Language) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleGitMutationResponse>>>
    'gitWorktree/gitSwitchBranch': (agentId: string, branch: string, locale?: Language) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleGitMutationResponse>>>
    'gitWorktree/gitPruneMergedBranches': (agentId: string, dryRun: boolean, locale?: Language) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleGitPruneResponse>>>
    'gitWorktree/gitListTags': (agentId: string, locale?: Language) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleGitTagListResponse>>>
    'gitWorktree/gitCreateTag': (agentId: string, name: string, message?: string, target?: string, push?: boolean, locale?: Language) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleGitTagMutationResponse>>>
    'gitWorktree/gitDeleteTag': (agentId: string, name: string, remote?: boolean, locale?: Language) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleGitTagMutationResponse>>>
    'gitWorktree/gitPushTag': (agentId: string, name: string, locale?: Language) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleGitTagMutationResponse>>>
    'gitWorktree/listAbandoned': (agentId: string, locale?: Language) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleAbandonedListResponse>>>
    'gitWorktree/restoreAbandoned': (agentId: string, checkoutId: string, locale?: Language) => Promise<RemoteResult<WorktreeConsoleOutcome<WorktreeConsoleRestoreAbandonedResponse>>>
  }

  interface TypertRemoteNamespaceMap {
    gitWorktree: TypertRemoteNamespace<'gitWorktree'>
  }
}
