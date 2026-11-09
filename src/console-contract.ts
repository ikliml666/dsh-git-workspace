/**
 * JSON-only shared contract for the future Harness-native Worktree Console.
 *
 * This module deliberately contains no Cordis, React, Remote or filesystem
 * implementation. Host and Client tracks share these DTOs while preserving one
 * authority rule: every Host operation resolves an exact caller Session and
 * re-validates project, owner, cwd, revision and review identity at execution.
 * @module dsh-git-worktree/console-contract
 */

import {
  SESSION_CHECKOUT_ERROR_CODES,
  type SessionCheckoutErrorCode,
  type SessionCheckoutPhase,
  type WorktreeRetentionMode,
  type WorktreeCleanupReason,
  type WorktreeApplyPreflightView,
  type WorktreePreviewRecoveryPreflightView,
  type WorktreePreviewRecoveryProof,
  type WorktreeAcceptanceBlockerView,
  type WorktreeDeliveryProofView,
  type WorktreeValidationItem,
  type WorktreeValidationStatus,
  type WorktreeCheckpointView,
} from './types.js'

export const WORKTREE_CONSOLE_TARGET_STATES = [
  'local',
  'creating',
  'working',
  'ready_for_review',
  'preview_active',
  'preview_detached',
  'retained',
  'cleanup_pending',
  'recovery_required',
  'delivered',
  'discarded',
] as const

export type WorktreeConsoleTargetState = typeof WORKTREE_CONSOLE_TARGET_STATES[number]

export type WorktreeConsoleDeliveryState =
  | 'working'
  | 'ready_for_review'
  | 'preview_active'
  | 'preview_detached'
  | 'finalized'
  | 'retained'
  | 'delivered'

/** Minimal domain facts required to project a stable, UI-facing state. */
export interface WorktreeConsoleProjectionSource {
  kind: 'local' | 'isolated'
  phase: SessionCheckoutPhase
  deliveryState?: WorktreeConsoleDeliveryState
}

/**
 * A record whose task reached the user (delivered), or whose environment is
 * retained/finalized after delivery. The work tree may already be gone, but the
 * task completed and must never be projected as abandoned. Delivery wins over
 * phase because a successful cleanup moves phase on to 'discarded'.
 */
export function worktreeReachedDelivery(
  phase: SessionCheckoutPhase,
  deliveryState?: WorktreeConsoleDeliveryState,
): boolean {
  return deliveryState === 'delivered'
    || deliveryState === 'finalized'
    || deliveryState === 'retained'
    || phase === 'finalized'
    || phase === 'retained'
}

/** Recovery and mutation phases take precedence over a stale delivery label. */
export function consoleStateFromDomain(source: WorktreeConsoleProjectionSource): WorktreeConsoleTargetState {
  if (source.kind === 'local') return 'local'
  if (source.phase === 'recovery_required') return 'recovery_required'
  if (source.phase === 'preparing') return 'creating'
  if (source.deliveryState === 'delivered') return 'delivered'
  // Abandoned records keep whatever delivery label preceded the discard, so the
  // discarded phase must win over `retained`/`finalized` here; only a delivered
  // record means the changes landed in Local.
  if (source.phase === 'discarded') return 'discarded'
  if (source.deliveryState === 'retained' || source.phase === 'retained') return 'retained'
  if (source.deliveryState === 'finalized' || source.phase === 'finalized') return 'cleanup_pending'
  if (source.deliveryState === 'preview_detached') return 'preview_detached'
  if (source.deliveryState === 'preview_active') return 'preview_active'
  if (source.deliveryState === 'ready_for_review') return 'ready_for_review'
  return 'working'
}

export interface WorktreeConsoleProject {
  id: string
  name: string
}

export interface WorktreeConsoleCapabilities {
  create: boolean
  open: boolean
  inspect: boolean
  discard: boolean
  preflight: boolean
  preview: boolean
  /** Save the exact reviewed snapshot as a managed-Worktree-only stage and continue editing. */
  checkpoint: boolean
  /** Invalidate an unsynced review and resume the same iteration without touching Local. */
  resumeRevision: boolean
  rollbackPreview: boolean
  /** Direct Ready → Commit path that skips Local Preview. */
  finalize: boolean
  finalizePreview: boolean
  setRetention: boolean
  setPermanent: boolean
  retryCleanup: boolean
  /** Recreate a cleaned delivered owner's immutable cwd for iteration + 1. */
  beginNextIteration: boolean
  /**
   * Rebind this Session from a delivered managed Worktree back to the Local
   * checkout. Only meaningful while the Session still points at `isolated`;
   * once it is back on Local there is nothing left to release.
   */
  returnToLocal: boolean
}

export interface WorktreeConsolePreviewRecovery {
  previewId: string
  detachedAt: number
  reason: 'stale_local' | 'preview_modified'
  attemptedAction: 'rollback_preview' | 'finalize_preview' | 'discard'
}

export type WorktreeConsoleDeliveryProof = WorktreeDeliveryProofView

export interface WorktreeConsoleReviewSummary {
  reviewId: string
  revision: number
  iteration: number
  preparedAt: number
  summary: string
  validationStatus: WorktreeValidationStatus
  validationSummary?: string
  tests: WorktreeValidationItem[]
  changedFiles: string[]
  suggestedCommitMessage: string
}

/** Path-free row safe for project lists and header status chips. */
export interface WorktreeConsoleTargetSummary {
  project: WorktreeConsoleProject
  checkoutId: string | null
  sourceSessionId: string
  ownerSessionId: string
  targetSessionId: string | null
  iteration: number
  revision: number
  state: WorktreeConsoleTargetState
  phase: SessionCheckoutPhase | 'local'
  dirty: boolean
  currentOid: string
  commitOid: string | null
  /** The branch this target works on: the Session's own branch when the record has one, otherwise the recorded source ref (the fork point). null when the Local side was detached or unversioned. */
  sourceBranch: string | null
  retention?: Exclude<WorktreeRetentionMode, 'cleanup'>
  retainedAt?: number
  expiresAt?: number | null
  /** codex 对齐：常驻标记的 Worktree 豁免自动清理。 */
  permanent?: boolean
  cleanupMessage?: string
  /**
   * 结构化清理阻塞原因。客户端据此在「交付后出现新改动」时给出放弃改动再清理的
   * 显式确认，而不是让人对着一句说明反复点重试。
   */
  cleanupReason?: WorktreeCleanupReason
  deliveryProof?: WorktreeConsoleDeliveryProof
  review?: WorktreeConsoleReviewSummary
  checkpoints?: WorktreeCheckpointView[]
  checkpointGeneration?: string
  reviewSlot?: 'available' | 'waiting'
  reviewSlotOwnerSessionId?: string
  reviewSlotHolder?: WorktreeAcceptanceBlockerView
  previewRecovery?: WorktreeConsolePreviewRecovery
  capabilities: WorktreeConsoleCapabilities
}

/** Identity-validated detail used only when the caller may open this target. */
export interface WorktreeConsoleTargetDetails extends WorktreeConsoleTargetSummary {
  managedRoot: string | null
  /** Host-validated canonical Local root used only for source Session navigation. */
  sourceRoot: string | null
  sourceOid: string
  /**
   * Branch the conversation chip names: what Git reports for the Worktree right
   * now, falling back to the recorded session branch when the Worktree cannot be
   * observed this instant. null only when neither is known.
   */
  currentBranch: string | null
  /** Owner-only Host proof for one explicitly authorized recovery continuation. */
  recoveryContinuation?: WorktreeRecoveryProof
}

export interface WorktreeConsoleCurrentRequest {
  sessionId: string
}

export interface WorktreeConsoleCurrentResponse {
  target: WorktreeConsoleTargetDetails
  /**
   * 官方建的树没能接进台账时的原因。
   *
   * 那棵树对列表、交付、清理都是隐形的，静默失败会让用户以为插件坏了，所以
   * 由胶囊直接显示。成功接管后立刻清空。
   */
  adoptionFailure?: string | null
}

export interface WorktreeConsoleListRequest {
  sessionId: string
  needsAttention?: boolean
  includeDelivered?: boolean
}

export interface WorktreeConsoleListResponse {
  project: WorktreeConsoleProject
  worktrees: WorktreeConsoleTargetSummary[]
}

export type WorktreeSidebarTaskState =
  | 'working'
  | 'ready_for_review'
  | 'preview_active'
  | 'preview_detached'
  | 'recovery_required'
  | 'finalized'
  | 'discarded'

/** Path-free, read-only task identity used only to aggregate the Workspace sidebar. */
export interface WorktreeSidebarTask {
  checkoutId: string
  ownerSessionId: string
  sourceSessionId: string
  iteration: number
  revision: number
  phase: SessionCheckoutPhase
  state: WorktreeSidebarTaskState
  /** The branch this task delivers onto: its own Session branch when recorded, otherwise the fork point; null when unknown. */
  sourceBranch: string | null
}

export interface WorktreeSidebarProject {
  project: WorktreeConsoleProject
  tasks: WorktreeSidebarTask[]
  /** Host-proven directory membership, including cleaned and older iterations. No paths or mutation authority. */
  memberships?: { workspaceIds: string[]; sessionIds: string[] }
}

export interface WorktreeSidebarTopologyResponse {
  projects: WorktreeSidebarProject[]
  /** Server-pinned Host package generation; unknown generations must not mount a guessed Client Browser. */
  workspaceClientFlavor?: 'legacy' | 'alpha' | 'next' | 'modern-rc5' | 'modern-rc1' | 'unsupported'
  /** Host-reported election result: the official Workspace Client is the live sidebar provider. */
  officialWorkspaceActive?: boolean
}

/** Client-side breadcrumb reporting which sidebar branch actually ran. */
export interface WorktreeClientBootReport {
  flavor: string
  branch: 'legacy' | 'alpha' | 'next' | 'modern-rc5' | 'modern-rc1' | 'unsupported' | 'topology-failed' | 'boot-failed'
  registered: boolean
  detail?: string
  /** Elapsed ms spent awaiting the Remote namespace mount before UI registration. */
  elapsedMountMs?: number
  /** Elapsed ms spent awaiting the first sidebarTopology probe. */
  elapsedTopologyMs?: number
}

export interface WorktreeConsoleCreateResponse {
  target: WorktreeConsoleTargetDetails
  targetSessionId: string
  managedRoot: string
}

export interface WorktreeConsoleInspectRequest {
  sessionId: string
  checkoutId: string
}

export interface WorktreeConsoleInspectResponse {
  target: WorktreeConsoleTargetDetails
}

export interface WorktreeConsoleDiscardRequest {
  sessionId: string
  checkoutId: string
  expectedRevision: number
  confirmDirty: boolean
  rollbackPreview?: boolean
}













/**
 * 评审面板已删除，会话做完工作就停在 `working`。`finalize` 强制要求
 * `ready_for_review` + reviewId，那条路只剩 `/worktree finalize` 那个老命令能走；
 * 胶囊菜单的「交付」用这个：不要求评审身份，直接从 `working` 交付。
 */
export interface WorktreeConsoleDeliverRequest {
  sessionId: string
  checkoutId: string
  expectedRevision: number
  commitMessage: string
  retention: WorktreeRetentionMode
}


export interface WorktreeConsoleSetRetentionRequest {
  sessionId: string
  checkoutId: string
  expectedRevision: number
  retention: Exclude<WorktreeRetentionMode, 'cleanup'>
}

/** codex 对齐：设置/取消常驻标记，豁免自动清理。 */
export interface WorktreeConsoleSetPermanentRequest {
  sessionId: string
  checkoutId: string
  expectedRevision: number
  permanent: boolean
}

export interface WorktreeConsoleRetryCleanupRequest {
  sessionId: string
  checkoutId: string
  expectedRevision: number
  /**
   * 用户确认「交付后出现的那些改动我不要了」。清理默认在发现这类改动时停下，
   * 只有带上这个确认才越过 modified_after_finalize。
   */
  discardPostDeliveryChanges?: boolean
}

export interface WorktreeConsoleBeginNextIterationRequest {
  sessionId: string
  checkoutId: string
  expectedRevision: number
}

/** 清除 Sidebar 终态徽章（已放弃/已完成）：记录端不再显示该标签。 */
export interface WorktreeConsoleClearSidebarBadgeRequest {
  sessionId: string
  checkoutId: string
  expectedRevision: number
}

/**
 * 回到 Local：把一个已交付的隔离会话释放回 Local 边界。
 *
 * 只针对已经交付（delivered）的 Worktree —— 任务成果已经在 Local，冻结环境
 * 只是保留期内的回滚材料。未交付的 Worktree 拒绝：中途解绑会把未合并的工作
 * 留在冻结目录里。记录本身不动，保留期倒计时与已交付徽章照旧。
 */
export interface WorktreeConsoleReturnToLocalRequest {
  sessionId: string
  checkoutId: string
}

export interface WorktreeConsoleReturnToLocalResponse {
  target: WorktreeConsoleTargetDetails
}

/**
 * `from` 是基点分支；`null` 表示当前 HEAD。
 *
 * 这个调用**立即建树**：返回时 checkout 已经在磁盘上、台账已经登记、会话 cwd
 * 已经切过去。早先的版本只记一条待办、留到 turn 的第 1 步再建，那是照抄官方
 * forge 面板的做法——想建树的人点完就在等着，再要求他发一条消息才生效只是
 * 多一道手续。
 */
export interface WorktreeConsoleCreateWorktreeRequest {
  sessionId: string
  from: string | null
}

export interface WorktreeConsoleCreateWorktreeResponse {
  /** 建好（或复用）的目标；失败时为 null。 */
  target: WorktreeConsoleTargetDetails | null
  /** 失败说明；成功时为 null。 */
  failure: string | null
}

export interface WorktreeConsoleMutationResponse {
  target: WorktreeConsoleTargetSummary
  changedFiles?: string[]
  commitOid?: string | null
  checkpoint?: WorktreeCheckpointView
  recoveryContinuation?: WorktreeRecoveryProof
}

/** codex 对齐：放弃快照列表与恢复的请求/响应（discarded 记录没有活 target）。 */
export interface WorktreeConsoleAbandonedSnapshot {
  checkoutId: string
  projectName: string
  snapshotOid: string
  snapshotAt: number
  revision: number
}

export interface WorktreeConsoleAbandonedListRequest {
  sessionId: string
}

export interface WorktreeConsoleAbandonedListResponse {
  snapshots: WorktreeConsoleAbandonedSnapshot[]
}

export interface WorktreeConsoleRestoreAbandonedRequest {
  sessionId: string
  checkoutId: string
}

export interface WorktreeConsoleRestoreAbandonedResponse {
  checkoutId: string
  branch: string
}


export type WorktreeConsoleFileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'binary'

export interface WorktreeConsoleDiffFile {
  path: string
  previousPath?: string
  status: WorktreeConsoleFileStatus
  patch: string | null
  truncated: boolean
}



/** Read-only branch overview behind the header chip's branch popover. */
export interface WorktreeConsoleGitBranch {
  name: string
  oid: string
  isCurrent: boolean
  upstream: string | null
}

export interface WorktreeConsoleGitOverviewResponse {
  root: string
  branch: string | null
  headOid: string
  branches: WorktreeConsoleGitBranch[]
  /**
   * Uncommitted entries, or `-1` when `git status` could not be read. A
   * repository can hold more untracked files than one status read can carry;
   * reporting 0 there would claim "clean" about an unknown state.
   */
  dirtyCount: number
}

/** Safe prune of fully merged local branches (git branch -d semantics; mirrors PruneMergedBranchesView). */
export interface WorktreeConsoleGitPruneEntry {
  name: string
  oid: string
  reason?: string
}

export interface WorktreeConsoleGitPruneResponse {
  dryRun: boolean
  headBranch: string | null
  pruned: WorktreeConsoleGitPruneEntry[]
  skipped: WorktreeConsoleGitPruneEntry[]
}

/** One `git log` row of the commit graph (lane topology is computed client-side). */
export interface WorktreeConsoleGitGraphCommit {
  oid: string
  parents: string[]
  author: string
  /** Author time in epoch seconds. */
  authorTime: number
  refs: string[]
  subject: string
}

export interface WorktreeConsoleGitGraphResponse {
  root: string
  branch: string | null
  commits: WorktreeConsoleGitGraphCommit[]
}

export interface WorktreeConsoleGitMutationResponse {
  /** The branch that was created or switched to. */
  branch: string
}

/**
 * Why Git refused a branch switch. Mirrors the host port's parsed refusal so
 * the console can render a specific message and, for overwrite refusals, offer
 * "commit these changes, then switch".
 */
export type WorktreeConsoleGitSwitchIssueCode =
  | 'tracked-changes-would-be-overwritten'
  | 'untracked-changes-would-be-overwritten'
  | 'conflicts-present'
  | 'operation-in-progress'
  | 'branch-in-other-worktree'
  | 'target-branch-not-found'
  | 'invalid-branch-name'
  | 'unknown'

export interface WorktreeConsoleGitSwitchIssue {
  code: WorktreeConsoleGitSwitchIssueCode
  /** Repository-relative paths Git reported; empty when the refusal is not file-scoped. */
  paths: string[]
  detail: string | null
}

/** Commit the Local checkout's uncommitted work so the blocked switch can be retried. */
export interface WorktreeConsoleGitCommitLocalRequest {
  sessionId: string
  message: string
}

export interface WorktreeConsoleGitCommitLocalResponse {
  commitOid: string
}

/** One local tag in the tag manager (annotated tags keep their message). */
export interface WorktreeConsoleGitTag {
  name: string
  oid: string
  /** Commit the tag points at, when it resolves. */
  commitOid: string | null
  annotated: boolean
  /** Tag message for annotated tags; null for lightweight tags. */
  message: string | null
  /** True when `origin` already has a tag of the same name; null when the
   *  remote could not be queried (offline / no `origin`), which must not be
   *  reported as "not pushed". */
  pushed: boolean | null
}

export interface WorktreeConsoleGitTagListResponse {
  root: string
  tags: WorktreeConsoleGitTag[]
}

export interface WorktreeConsoleGitTagMutationResponse {
  tag: string
  /** Push outcome for the remote-aware operations; absent when no push was requested. */
  pushed?: boolean
  /** Human-readable push failure; absent when the push succeeded or was not requested. */
  pushMessage?: string
}

/** Create a tag at HEAD (or a given ref), optionally annotated and optionally pushed. */
export interface WorktreeConsoleGitCreateTagRequest {
  sessionId: string
  name: string
  message?: string
  /** Ref/oid to tag; defaults to HEAD. */
  target?: string
  /** Push the new tag to `origin` after creating it. */
  push?: boolean
}

export interface WorktreeConsoleGitDeleteTagRequest {
  sessionId: string
  name: string
  /** Also delete the tag on `origin` (never forced). */
  remote?: boolean
}

export interface WorktreeConsoleGitPushTagRequest {
  sessionId: string
  name: string
}

export const WORKTREE_CONSOLE_ERROR_CODES = [
  ...SESSION_CHECKOUT_ERROR_CODES,
  'transport_unavailable',
  'malformed_response',
  'timeout',
] as const

export type WorktreeConsoleErrorCode = SessionCheckoutErrorCode | 'transport_unavailable' | 'malformed_response' | 'timeout'
export type WorktreeConsoleErrorCategory =
  | 'permission'
  | 'stale'
  | 'confirmation'
  | 'recovery'
  | 'conflict'
  | 'unavailable'
  | 'invalid'
  | 'internal'
export type WorktreeConsoleRecovery = 'none' | 'refresh' | 'confirm_dirty' | 'open_recovery' | 'retry'

export interface WorktreeApplyConflictContinuation {
  kind: 'worktree_apply_conflict'
  /** Stable identity for Client single-flight and retry within this renderer lifetime. */
  requestId: string
  checkoutId: string
  /** Review that remains Ready until the user explicitly resumes it for conflict resolution. */
  reviewId: string
  /** Authoritative revision after the failed real-time write attempt returned to Ready. */
  revision: number
  localHeadOid: string
  conflictingFiles: string[]
}

export interface WorktreeApplyConflictRecoveryProof {
  kind: 'worktree_apply_conflict'
  requestId: string
  checkoutId: string
  reviewId: string
  /** Exact Working revision produced by the Host conflict-resume CAS. */
  revision: number
  localHeadOid: string
  conflictingFiles: string[]
}

export interface WorktreeReviewRegenerationProof {
  kind: 'worktree_review_regeneration'
  requestId: string
  checkoutId: string
  reviewId: string
  revision: number
}

export interface WorktreePreviewRecoveryAnalysisProof {
  kind: 'worktree_preview_recovery_analysis'
  requestId: string
  checkoutId: string
  reviewId: string
  previewId: string
  revision: number
  generation: string
}

export interface WorktreePreviewRecoveryHandoffProof {
  kind: 'worktree_preview_recovery_handoff'
  requestId: string
  checkoutId: string
  sourceCheckoutId: string
  reviewId: string
  previewId: string
  revision: number
  generation: string
}

export type WorktreeRecoveryProof =
  | WorktreeApplyConflictRecoveryProof
  | WorktreeReviewRegenerationProof
  | WorktreePreviewRecoveryAnalysisProof
  | WorktreePreviewRecoveryHandoffProof
export type WorktreeConsoleContinuation = WorktreeApplyConflictContinuation

export interface WorktreeConsoleError {
  code: WorktreeConsoleErrorCode
  message: string
  details?: Record<string, string | number | boolean | null>
  continuation?: WorktreeConsoleContinuation
  /** Present only when Git refused a branch switch; drives the fix-up dialog. */
  switchIssue?: WorktreeConsoleGitSwitchIssue
}

export type WorktreeConsoleOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: WorktreeConsoleError }

export interface WorktreeConsoleErrorMeta {
  category: WorktreeConsoleErrorCategory
  recovery: WorktreeConsoleRecovery
  retryable: boolean
}

const ERROR_META = {
  session_not_found: { category: 'unavailable', recovery: 'refresh', retryable: true },
  project_not_found: { category: 'unavailable', recovery: 'refresh', retryable: true },
  project_root_missing: { category: 'unavailable', recovery: 'open_recovery', retryable: false },
  not_git_repository: { category: 'invalid', recovery: 'none', retryable: false },
  target_unselected: { category: 'unavailable', recovery: 'refresh', retryable: true },
  target_already_bound: { category: 'invalid', recovery: 'refresh', retryable: true },
  project_mismatch: { category: 'permission', recovery: 'none', retryable: false },
  checkout_missing: { category: 'unavailable', recovery: 'refresh', retryable: true },
  checkout_mismatch: { category: 'permission', recovery: 'open_recovery', retryable: false },
  recovery_required: { category: 'recovery', recovery: 'open_recovery', retryable: false },
  registry_corrupt: { category: 'recovery', recovery: 'open_recovery', retryable: false },
  git_operation_failed: { category: 'internal', recovery: 'retry', retryable: true },
  not_owner: { category: 'permission', recovery: 'none', retryable: false },
  stale_target: { category: 'stale', recovery: 'refresh', retryable: true },
  dirty_confirmation_required: { category: 'confirmation', recovery: 'confirm_dirty', retryable: true },
  apply_conflict: { category: 'conflict', recovery: 'open_recovery', retryable: false },
  apply_failed: { category: 'internal', recovery: 'retry', retryable: true },
  invalid_input: { category: 'invalid', recovery: 'none', retryable: false },
  invalid_plan: { category: 'invalid', recovery: 'refresh', retryable: true },
  stale_local: { category: 'stale', recovery: 'refresh', retryable: true },
  stale_isolated: { category: 'stale', recovery: 'refresh', retryable: true },
  git_error: { category: 'internal', recovery: 'retry', retryable: true },
  commit_isolation_conflict: { category: 'conflict', recovery: 'open_recovery', retryable: false },
  checkout_limit_reached: { category: 'invalid', recovery: 'none', retryable: false },
  project_acceptance_busy: { category: 'conflict', recovery: 'retry', retryable: true },
  operation_not_allowed: { category: 'invalid', recovery: 'refresh', retryable: true },
  preview_not_active: { category: 'invalid', recovery: 'refresh', retryable: true },
  preview_modified: { category: 'stale', recovery: 'open_recovery', retryable: false },
  recovery_unsafe: { category: 'recovery', recovery: 'open_recovery', retryable: false },
  transport_unavailable: { category: 'unavailable', recovery: 'retry', retryable: true },
  malformed_response: { category: 'internal', recovery: 'none', retryable: false },
  timeout: { category: 'unavailable', recovery: 'retry', retryable: true },
} as const satisfies Record<WorktreeConsoleErrorCode, WorktreeConsoleErrorMeta>

export function worktreeConsoleErrorMeta(code: WorktreeConsoleErrorCode): WorktreeConsoleErrorMeta {
  return ERROR_META[code]
}

/** Normalized Client seam; Remote transport details stay behind one adapter. */
export interface WorktreeConsoleAdapter {
  initializeProject?(request: { sourceSessionId: string }): Promise<WorktreeConsoleOutcome<boolean>>
  sidebarTopology(): Promise<WorktreeConsoleOutcome<WorktreeSidebarTopologyResponse>>
  current(request: WorktreeConsoleCurrentRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleCurrentResponse>>
  list(request: WorktreeConsoleListRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleListResponse>>
  inspect(request: WorktreeConsoleInspectRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleInspectResponse>>
  discard(request: WorktreeConsoleDiscardRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>
  deliver(request: WorktreeConsoleDeliverRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>
  setRetention(request: WorktreeConsoleSetRetentionRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>
  setPermanent(request: WorktreeConsoleSetPermanentRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>
  retryCleanup(request: WorktreeConsoleRetryCleanupRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>
  beginNextIteration(request: WorktreeConsoleBeginNextIterationRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>
  returnToLocal(request: WorktreeConsoleReturnToLocalRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleReturnToLocalResponse>>
  /** 立刻为本会话建一棵工作树。 */
  createWorktree(request: WorktreeConsoleCreateWorktreeRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleCreateWorktreeResponse>>
  clearSidebarBadge(request: WorktreeConsoleClearSidebarBadgeRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>
  gitOverview(sessionId: string): Promise<WorktreeConsoleOutcome<WorktreeConsoleGitOverviewResponse>>
  gitGraph(sessionId: string, limit?: number): Promise<WorktreeConsoleOutcome<WorktreeConsoleGitGraphResponse>>
  gitCreateBranch(sessionId: string, name: string): Promise<WorktreeConsoleOutcome<WorktreeConsoleGitMutationResponse>>
  gitSwitchBranch(sessionId: string, branch: string): Promise<WorktreeConsoleOutcome<WorktreeConsoleGitMutationResponse>>
  /** Commit Local's uncommitted work so a switch refused for overwriting can be retried. */
  gitCommitLocalChanges(request: WorktreeConsoleGitCommitLocalRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleGitCommitLocalResponse>>
  gitPruneMergedBranches(sessionId: string, dryRun: boolean): Promise<WorktreeConsoleOutcome<WorktreeConsoleGitPruneResponse>>
  gitListTags(sessionId: string): Promise<WorktreeConsoleOutcome<WorktreeConsoleGitTagListResponse>>
  gitCreateTag(request: WorktreeConsoleGitCreateTagRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleGitTagMutationResponse>>
  gitDeleteTag(request: WorktreeConsoleGitDeleteTagRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleGitTagMutationResponse>>
  gitPushTag(request: WorktreeConsoleGitPushTagRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleGitTagMutationResponse>>
  listAbandoned?(request: WorktreeConsoleAbandonedListRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleAbandonedListResponse>>
  restoreAbandoned?(request: WorktreeConsoleRestoreAbandonedRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleRestoreAbandonedResponse>>
}
