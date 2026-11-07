import { isValidCommitMessage } from '../commit-message.js'
import { hostMessage } from '../i18n/host.js'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import type {
  WorktreeConsoleAbandonedListResponse,
  WorktreeConsoleBeginNextIterationRequest,
  WorktreeConsoleClearSidebarBadgeRequest,
  WorktreeConsoleCreatePreviewRecoveryHandoffRequest,
  WorktreeConsoleCreatePreviewRecoveryHandoffResponse,
  WorktreeConsoleCheckpointRequest,
  WorktreeConsoleCurrentResponse,
  WorktreeConsoleDiscardRequest,
  WorktreeConsoleFinalizePreviewRequest,
  WorktreeConsoleFinalizeRequest,
  WorktreeConsoleGitCreateTagRequest,
  WorktreeConsoleGitDeleteTagRequest,
  WorktreeConsoleGitGraphResponse,
  WorktreeConsoleGitMutationResponse,
  WorktreeConsoleGitOverviewResponse,
  WorktreeConsoleGitPruneResponse,
  WorktreeConsoleGitPushTagRequest,
  WorktreeConsoleGitTagListResponse,
  WorktreeConsoleGitTagMutationResponse,
  WorktreeConsoleInspectResponse,
  WorktreeConsoleListRequest,
  WorktreeConsoleListResponse,
  WorktreeConsoleMutationResponse,
  WorktreeConsoleOutcome,
  WorktreeConsolePreflightRequest,
  WorktreeConsolePreflightResponse,
  WorktreeConsolePreparePreviewRecoveryAnalysisRequest,
  WorktreeConsolePreviewRecoveryPreflightRequest,
  WorktreeConsolePreviewRecoveryPreflightResponse,
  WorktreeConsolePrepareRegenerationRequest,
  WorktreeConsolePreviewRequest,
  WorktreeConsoleRestoreAbandonedRequest,
  WorktreeConsoleRestoreAbandonedResponse,
  WorktreeConsoleResumeRevisionRequest,
  WorktreeConsoleRollbackPreviewRequest,
  WorktreeConsoleRetryCleanupRequest,
  WorktreeConsoleReturnToLocalRequest,
  WorktreeConsoleReturnToLocalResponse,
  WorktreeConsoleReviewDiffRequest,
  WorktreeConsoleReviewDiffResponse,
  WorktreeConsoleWorktreeRequestRequest,
  WorktreeConsoleWorktreeRequestResponse,
  WorktreeConsoleSetRetentionRequest,
  WorktreeConsoleSetPermanentRequest,
  WorktreeConsoleTargetSummary,
  WorktreeConsoleDeliveryProof,
  WorktreeSidebarTaskState,
  WorktreeSidebarTopologyResponse,
} from '../console-contract.js'
import { worktreeReachedDelivery } from '../console-contract.js'
import type {
  GitCheckoutSnapshot,
  ManagedCheckoutRecord,
  SessionCheckoutFilesPort,
  SessionCheckoutGitPort,
  SessionCheckoutLookupPort,
  SessionCheckoutRegistryPort,
} from '../ports.js'
import type { SessionCheckoutModule } from '../index.js'
import type { SessionTargetView } from '../types.js'
import { consoleFailure, domainError, failure, outcome } from './errors.js'
import { projectDetails, projectLocal, projectRecord, sourceBranchFromRef } from './projection.js'
import { ReviewDiffStaleError, type WorktreeReviewDiffReader } from './review-diff.js'

export interface WorktreeConsoleControlPlaneOptions {
  module: SessionCheckoutModule
  lookup: SessionCheckoutLookupPort
  files: SessionCheckoutFilesPort
  registry: SessionCheckoutRegistryPort
  git: SessionCheckoutGitPort
  reviewDiff: WorktreeReviewDiffReader
  createTargetSessionId?: () => string
  /**
   * 记录或撤回「下一次 turn 在新树里开始」。
   *
   * 由 Host 侧注入而不是在这里直接读 session：写 plugin record 需要活的
   * Session 对象，而 control-plane 只拿得到 lookup 的只读导航记录。
   */
  setWorktreeRequest: (sessionId: string, from: string | null | undefined) => { from: string | null } | null
  /**
   * 读「还在排队等下一个 turn」的请求，供 `current` 一并回给胶囊。
   *
   * 会话不在活列表里（已归档、或还没在本进程恢复）时返回 null：没有会话就
   * 不可能有待办，这里不需要为不可达的 Session 造一个空记录。
   */
  pendingWorktreeRequest: (sessionId: string) => { from: string | null } | null
}

export interface WorktreeConsoleControlPlane {
  sidebarTopology(): Promise<WorktreeConsoleOutcome<WorktreeSidebarTopologyResponse>>
  current(sessionId: string): Promise<WorktreeConsoleOutcome<WorktreeConsoleCurrentResponse>>
  list(request: WorktreeConsoleListRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleListResponse>>
  initProject(sourceSessionId: string): Promise<WorktreeConsoleOutcome<boolean>>
  inspect(sessionId: string, checkoutId: string): Promise<WorktreeConsoleOutcome<WorktreeConsoleInspectResponse>>
  reviewDiff(request: WorktreeConsoleReviewDiffRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleReviewDiffResponse>>
  preflight(request: WorktreeConsolePreflightRequest): Promise<WorktreeConsoleOutcome<WorktreeConsolePreflightResponse>>
  previewRecoveryPreflight(request: WorktreeConsolePreviewRecoveryPreflightRequest): Promise<WorktreeConsoleOutcome<WorktreeConsolePreviewRecoveryPreflightResponse>>
  preparePreviewRecoveryAnalysis(request: WorktreeConsolePreparePreviewRecoveryAnalysisRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>
  createPreviewRecoveryHandoff(request: WorktreeConsoleCreatePreviewRecoveryHandoffRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleCreatePreviewRecoveryHandoffResponse>>
  preview(request: WorktreeConsolePreviewRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>
  checkpoint(request: WorktreeConsoleCheckpointRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>
  resumeRevision(request: WorktreeConsoleResumeRevisionRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>
  prepareReviewRegeneration(request: WorktreeConsolePrepareRegenerationRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>
  rollbackPreview(request: WorktreeConsoleRollbackPreviewRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>
  discard(request: WorktreeConsoleDiscardRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>
  finalize(request: WorktreeConsoleFinalizeRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>
  finalizePreview(request: WorktreeConsoleFinalizePreviewRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>
  setRetention(request: WorktreeConsoleSetRetentionRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>
  setPermanent(request: WorktreeConsoleSetPermanentRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>
  retryCleanup(request: WorktreeConsoleRetryCleanupRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>
  beginNextIteration(request: WorktreeConsoleBeginNextIterationRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>
  returnToLocal(request: WorktreeConsoleReturnToLocalRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleReturnToLocalResponse>>
  /** 记录或撤回「下一次 turn 在新树里开始」的待办请求。 */
  setWorktreeRequest(request: WorktreeConsoleWorktreeRequestRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleWorktreeRequestResponse>>
  clearSidebarBadge(request: WorktreeConsoleClearSidebarBadgeRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>
  gitOverview(sessionId: string): Promise<WorktreeConsoleOutcome<WorktreeConsoleGitOverviewResponse>>
  gitGraph(sessionId: string, limit?: number): Promise<WorktreeConsoleOutcome<WorktreeConsoleGitGraphResponse>>
  gitCreateBranch(sessionId: string, name: string): Promise<WorktreeConsoleOutcome<WorktreeConsoleGitMutationResponse>>
  gitSwitchBranch(sessionId: string, branch: string): Promise<WorktreeConsoleOutcome<WorktreeConsoleGitMutationResponse>>
  gitPruneMergedBranches(sessionId: string, dryRun: boolean): Promise<WorktreeConsoleOutcome<WorktreeConsoleGitPruneResponse>>
  gitListTags(sessionId: string): Promise<WorktreeConsoleOutcome<WorktreeConsoleGitTagListResponse>>
  gitCreateTag(request: WorktreeConsoleGitCreateTagRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleGitTagMutationResponse>>
  gitDeleteTag(request: WorktreeConsoleGitDeleteTagRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleGitTagMutationResponse>>
  gitPushTag(request: WorktreeConsoleGitPushTagRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleGitTagMutationResponse>>
  listAbandoned(sessionId: string): Promise<WorktreeConsoleOutcome<WorktreeConsoleAbandonedListResponse>>
  restoreAbandoned(request: WorktreeConsoleRestoreAbandonedRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleRestoreAbandonedResponse>>
}

function recordOf(registry: SessionCheckoutRegistryPort, checkoutId: string): ManagedCheckoutRecord {
  const record = registry.read().managedCheckouts[checkoutId]
  if (record === undefined) throw domainError('checkout_missing', hostMessage('theWorktreeRecordDoesNotExist'))
  return record
}

function sidebarTaskState(record: ManagedCheckoutRecord): WorktreeSidebarTaskState {
  // Delivery wins over phase: a worktree that reached Local and was then
  // cleaned up (phase 'discarded' + delivery 'delivered') completed its task
  // and must never read as abandoned. Only a discard without delivery is one.
  if (worktreeReachedDelivery(record.phase, record.delivery.state)) return 'finalized'
  if (record.phase === 'discarded') return 'discarded'
  if (record.phase === 'recovery_required') return 'recovery_required'
  if (record.delivery.state === 'preview_detached') return 'preview_detached'
  if (record.delivery.state === 'preview_active') return 'preview_active'
  if (record.delivery.state === 'ready_for_review') return 'ready_for_review'
  return 'working'
}

function readyReview(record: ManagedCheckoutRecord) {
  if (record.phase !== 'ready' || record.delivery.state !== 'ready_for_review') {
    throw domainError('operation_not_allowed', hostMessage('theCurrentWorktreeIsNotReadyForReview'))
  }
  return record.delivery.review
}

function previewReview(record: ManagedCheckoutRecord) {
  if (
    record.phase !== 'ready'
    || (record.delivery.state !== 'preview_active' && record.delivery.state !== 'preview_detached')
  ) {
    throw domainError('preview_not_active', hostMessage('thereIsNoLocalPreviewAwaitingAcceptance'))
  }
  return record.delivery.review
}

function safeRecoveryRequestId(value: string): boolean {
  return value.length > 0 && value.length <= 500 && !/[\0\r\n]/u.test(value)
}

function safeConflictFile(file: string): boolean {
  if (!file || file.length > 1000 || /[\0-\x1f\x7f]/u.test(file)) return false
  if (/^(?:[A-Za-z]:[\\/]|[\\/])/u.test(file)) return false
  return !file.split(/[\\/]/u).some(segment => segment === '' || segment === '.' || segment === '..')
}

function applyConflictContinuation(
  result: Extract<Awaited<ReturnType<SessionCheckoutModule['operate']>>, { status: 'conflict' }>,
  reviewId: string,
) {
  const checkoutId = result.target.checkout.id
  const revision = result.target.revision
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(result.localHeadOid)) {
    throw domainError('git_error', hostMessage('conflictRecoveryIsMissingAValidLocalHEADIdentity'))
  }
  const localHeadOid = result.localHeadOid
  if (result.conflictingFiles.length > 500 || !result.conflictingFiles.every(safeConflictFile)) {
    throw domainError('git_error', hostMessage('conflictRecoveryContainsUnsafeOrOutOfBoundsFile'))
  }
  const conflictingFiles = [...result.conflictingFiles]
  return {
    kind: 'worktree_apply_conflict' as const,
    requestId: `apply-conflict:${checkoutId}:${reviewId}:${revision}:${localHeadOid}`,
    checkoutId,
    reviewId,
    revision,
    localHeadOid,
    conflictingFiles,
  }
}

function preflightFailure(view: Awaited<ReturnType<NonNullable<SessionCheckoutModule['preflight']>>> | undefined) {
  if (view === undefined) return failure<never>('git_error', hostMessage('theCurrentSessionCheckoutModuleDoesNotSupportAcceptancePreflight'))
  if (view.status !== 'blocked') return undefined
  const code = view.reason === 'stale_isolated' ? 'stale_isolated'
    : view.reason === 'stale_local' ? 'stale_local'
      : view.reason === 'stale_target' ? 'stale_target'
      : view.reason === 'project_acceptance_busy' ? 'project_acceptance_busy'
        : view.reason === 'not_owner' ? 'not_owner'
          : view.reason === 'not_ready_for_review' ? 'operation_not_allowed'
            : view.reason === 'checkout_unavailable' ? 'checkout_mismatch'
              : 'git_error'
  return failure<never>(code, view.message)
}

export function createWorktreeConsoleControlPlane(options: WorktreeConsoleControlPlaneOptions): WorktreeConsoleControlPlane {
  const createTargetSessionId = options.createTargetSessionId ?? randomUUID

  async function unboundLocalTarget(sessionId: string): Promise<SessionTargetView> {
    const session = options.lookup.getSession(sessionId)
    if (session === undefined) throw domainError('session_not_found', hostMessage('theCurrentSessionDoesNotExist'))
    if (session.projectId === undefined) throw domainError('project_not_found', hostMessage('theCurrentSessionIsNotAssociatedWithAProject'))
    const project = options.lookup.getProject(session.projectId)
    if (project === undefined) throw domainError('project_not_found', hostMessage('theCurrentSessionSProjectDoesNotExist'))
    if (!options.files.exists(project.root)) throw domainError('project_root_missing', hostMessage('theCurrentSessionSProjectDirectoryDoesNotExist'))
    const snapshot = await options.git.inspect(project.root)
    if (snapshot === null) throw domainError('not_git_repository', hostMessage('theCurrentSessionSProjectIsNotAnAvailable'))
    const status = await options.git.status(project.root)
    return {
      project: { id: project.id, name: project.name },
      checkout: { id: 'local', kind: 'local', label: 'Local', phase: 'ready' },
      source: { ref: snapshot.headRef, oid: snapshot.headOid },
      current: { branch: snapshot.branch, oid: snapshot.headOid },
      ownership: 'owner',
      dirty: status.dirty,
      revision: 0,
    }
  }

  async function callerTarget(sessionId: string): Promise<SessionTargetView> {
    try {
      return await options.module.inspect(sessionId)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'target_unselected') {
        return unboundLocalTarget(sessionId)
      }
      throw error
    }
  }

  async function verifyCallerRoot(
    sessionId: string,
    record: ManagedCheckoutRecord,
    expectedRoot: string,
  ): Promise<void> {
    const session = options.lookup.getSession(sessionId)
    const project = session?.projectId === undefined ? undefined : options.lookup.getProject(session.projectId)
    if (project === undefined) {
      throw domainError('project_mismatch', hostMessage('theCurrentSessionWorkspaceCannotBeProvenToBelong'))
    }
    // Every delivered terminal state must read through the Local boundary, not
    // only the cleaned-up one: `worktree_deliver` defaults to `retain_24h`, so
    // for a whole day after delivery the record sits at (phase retained,
    // delivery retained) with the frozen environment still on disk while the
    // owner Session's cwd is already back at Local — and `cleanup pending`
    // (finalized) is the same story before the environment is removed. The
    // terminal-state predicate lives in src/console-contract.ts so this gate
    // cannot drift from the UI projection.
    const ownerDeliverySettled = record.ownerSessionId === sessionId
      && worktreeReachedDelivery(record.phase, record.delivery.state)
      // The delivery label alone is not enough: the record itself must sit in a
      // terminal phase, so a half-written or future-invalid combination (phase
      // still active while delivery already retained) cannot slip through the
      // Local-boundary bypass.
      && (record.phase === 'discarded' || record.phase === 'finalized' || record.phase === 'retained')
    // Canonicalizing a path is a realpath syscall; this gate can ask for the
    // same path up to four times (live cwd, expectedRoot, record.localRoot,
    // project.root). Memoize so each distinct path costs at most one IO.
    const canonicalCache = new Map<string, Promise<string>>()
    const canonical = (path: string): Promise<string> => {
      const cached = canonicalCache.get(path)
      if (cached !== undefined) return cached
      const computed = options.files.canonicalize(path)
      canonicalCache.set(path, computed)
      return computed
    }
    // The owner Session's LIVE cwd is its immutable worktree root while the
    // task runs, while the Workspace project record still points at the Local
    // checkout. Authorizing only against `project.root` therefore rejected
    // every owner call with `project_mismatch`, and the top capsule reported a
    // failure for a perfectly healthy managed checkout.
    //
    // This evidence speaks ONLY for the owner: a live cwd equal to `localRoot`
    // proves nothing about a source Session, whose whole point is to run at the
    // Local boundary. Applying it to `expectedRoot` would have accepted any
    // same-project source Session parked in the Local checkout and handed it
    // the owner's `managedRoot`, so the identity is checked explicitly here and
    // source Sessions keep the Workspace-root gate below.
    if (record.ownerSessionId === sessionId) {
      const liveCwd = options.lookup.getSessionCwd?.(sessionId)
      if (liveCwd !== undefined && options.files.exists(liveCwd)) {
        const callerRoot = await canonical(liveCwd)
        // A cleaned-up Worktree keeps its path in the record after the
        // directory is gone. Canonicalizing that path throws ENOENT, which
        // escaped as `git_error` and left the top capsule reading
        // "unavailable" forever; the settled-owner branch below is the answer
        // for exactly this case, so it must be reachable.
        if (options.files.exists(expectedRoot) && sameLocalRoot(callerRoot, await canonical(expectedRoot))) return
        if (ownerDeliverySettled && sameLocalRoot(callerRoot, await canonical(record.localRoot))) return
      }
    }
    const missingOwnerCwd = ownerDeliverySettled
      && !options.files.exists(project.root)
      && sameLocalRoot(resolve(project.root), resolve(expectedRoot))
    if (missingOwnerCwd) return
    if (!options.files.exists(project.root)) {
      throw domainError('project_mismatch', hostMessage('theCurrentSessionWorkspaceCannotBeProvenToBelong'))
    }
    const workspaceRoot = await canonical(project.root)
    // After delivery the owner Session's cwd is back at Local whether the frozen
    // environment is still on disk (retained / finalized) or already removed
    // (cleanup success writes phase discarded + delivery delivered), so it can
    // never match managedRoot again. For that settled case the Local checkout is
    // the authorization boundary — the task is over, its history stays readable.
    const settledOwner = ownerDeliverySettled
      && sameLocalRoot(workspaceRoot, await canonical(record.localRoot))
    if (settledOwner) return
    if (!sameLocalRoot(workspaceRoot, expectedRoot)) {
      throw domainError('project_mismatch', hostMessage('theCurrentSessionCwdDoesNotMatchTheWorktree'))
    }
  }

  async function authorize(sessionId: string, checkoutId: string, observedCaller?: SessionTargetView): Promise<ManagedCheckoutRecord> {
    // Only read endpoints pass a caller observed in this request. Mutations
    // always perform fresh inspection before their own transactional checks.
    const caller = observedCaller ?? await options.module.inspect(sessionId)
    const record = recordOf(options.registry, checkoutId)
    if (record.ownerSessionId !== sessionId && record.sourceSessionId !== sessionId) {
      throw domainError('not_owner', hostMessage('theCurrentSessionIsNotAllowedToAccessThis'))
    }
    if (record.projectId !== caller.project.id) {
      throw domainError('project_mismatch', hostMessage('worktreeDoesNotMatchTheCurrentSessionSProject'))
    }
    const expectedRoot = record.ownerSessionId === sessionId ? record.managedRoot : record.localRoot
    await verifyCallerRoot(sessionId, record, expectedRoot)
    if (record.phase !== 'discarded') {
      const visible = await options.module.listManagedWorktreesForSession(sessionId, { checkoutId })
      if (!visible.some(item => item.checkoutId === checkoutId)) {
        throw domainError('not_owner', hostMessage('theCurrentSessionIsNotAllowedToAccessThis'))
      }
    }
    return record
  }

  async function linkedReadAccess(
    sessionId: string,
    checkoutId: string,
    observedCaller?: SessionTargetView,
  ): Promise<{
    record: ManagedCheckoutRecord
    linkedRead: boolean
    acceptanceAnchorCheckoutId?: string
  }> {
    const requested = recordOf(options.registry, checkoutId)
    if (requested.ownerSessionId === sessionId || requested.sourceSessionId === sessionId) {
      return { record: await authorize(sessionId, checkoutId, observedCaller), linkedRead: false }
    }
    const caller = await callerTarget(sessionId)
    if (caller.checkout.kind !== 'isolated') {
      throw domainError('not_owner', hostMessage('theCurrentSessionIsNotAllowedToAccessThis'))
    }
    const anchor = await authorize(sessionId, caller.checkout.id)
    const sourceSessionId = anchor.sourceSessionId ?? anchor.ownerSessionId
    const requestedSourceSessionId = requested.sourceSessionId ?? requested.ownerSessionId
    const sameLinkedGroup = requested.projectId === anchor.projectId
      && requestedSourceSessionId === sourceSessionId
      && sameLocalRoot(requested.localRoot, anchor.localRoot)
    const holder = anchor.ownerSessionId === sessionId
      && anchor.phase === 'ready'
      && anchor.delivery.state === 'ready_for_review'
      ? acceptanceHolder(anchor)
      : undefined
    const exactAcceptanceHolder = holder?.checkoutId === requested.checkoutId
      && requested.projectId === anchor.projectId
      && sameLocalRoot(requested.localRoot, anchor.localRoot)
    if (!sameLinkedGroup && !exactAcceptanceHolder) {
      throw domainError('not_owner', hostMessage('theCurrentSessionIsNotAllowedToAccessThis'))
    }
    if (!ownerSessionAvailable(requested)) {
      throw domainError('checkout_missing', hostMessage('theAssociatedWorktreeSOwnerSessionIsUnavailable'))
    }
    await verifyCallerRoot(requested.ownerSessionId, requested, requested.managedRoot)
    if (exactAcceptanceHolder) {
      const currentAnchor = recordOf(options.registry, anchor.checkoutId)
      const currentRequested = recordOf(options.registry, requested.checkoutId)
      const currentHolder = currentAnchor.ownerSessionId === sessionId
        && currentAnchor.phase === 'ready'
        && currentAnchor.delivery.state === 'ready_for_review'
        ? acceptanceHolder(currentAnchor)
        : undefined
      if (
        currentHolder?.checkoutId !== currentRequested.checkoutId
        || currentRequested.ownerSessionId !== requested.ownerSessionId
        || !sameLocalRoot(currentRequested.localRoot, currentAnchor.localRoot)
      ) throw domainError('not_owner', hostMessage('theAcceptanceSlotHolderHasChangedCheckAgain'))
      return {
        record: currentRequested,
        linkedRead: true,
        acceptanceAnchorCheckoutId: currentAnchor.checkoutId,
      }
    }
    return { record: requested, linkedRead: true }
  }

  async function observe(
    record: ManagedCheckoutRecord,
    observedCaller?: SessionTargetView,
  ): Promise<{
    managedRoot: string | null
    snapshot?: Pick<GitCheckoutSnapshot, 'branch' | 'headOid'>
    /** Local-side snapshot from the same validation pass; only the module port supplies it. */
    localSnapshot?: GitCheckoutSnapshot
    dirty?: boolean
  }> {
    if (record.phase === 'discarded') return { managedRoot: null }
    const reused = observeFromCaller(record, observedCaller)
    if (reused !== undefined) return reused
    if (options.module.observeManagedCheckout) return options.module.observeManagedCheckout(record.checkoutId)
    const managedRoot = await options.module.resolveManagedRoot(record.checkoutId)
    const snapshot = await options.git.inspect(managedRoot)
    if (snapshot === null) throw domainError('checkout_mismatch', hostMessage('theWorktreeGitIdentityCannotBeVerified'))
    const status = await options.git.status(managedRoot)
    return { managedRoot, snapshot, dirty: status.dirty }
  }

  // Retention, permanence and cleanup dispatch delete the frozen directory on disk.
  // The module only falls back to the source Session while the owner Session is gone,
  // which would let a local Session clean up a Worktree it never owned.
  function requireOwner(record: ManagedCheckoutRecord, sessionId: string): void {
    if (record.ownerSessionId !== sessionId) {
      throw domainError('not_owner', hostMessage('onlyTheOwnerSessionCanManageThisWorktree'))
    }
  }

  function ownerSessionAvailable(record: ManagedCheckoutRecord): boolean {
    return options.lookup.getSession(record.ownerSessionId) !== undefined
  }

  /**
   * Reuse the observation `callerTarget` already paid for.
   *
   * The conversation chip polls `current` every few seconds, and that call runs
   * `options.module.inspect(sessionId)` first: `inspectIsolated` validates the
   * managed checkout with one `git status` plus two `git inspect` spawns. The
   * projection that follows then called `observe()` on the SAME record, which
   * replays that exact triple-spawn through `validateManagedCheckout` before
   * reading `current`/`dirty` — values the caller view is already holding. On a
   * warm Windows checkout each spawn costs ~30-50ms, so the duplicate was
   * roughly a third of every poll.
   *
   * Only an active (`ready`) owner view is reused, and only when it describes
   * exactly this checkout with a matching phase. Delivered terminal states stay
   * on the authoritative path on purpose: `committedFollowupView` reports a
   * deliberately conservative `dirty: true`, and the frozen environment's real
   * Git status must still be what the chip shows.
   */
  function observeFromCaller(
    record: ManagedCheckoutRecord,
    caller: SessionTargetView | undefined,
  ): { managedRoot: string | null; snapshot?: Pick<GitCheckoutSnapshot, 'branch' | 'headOid'>; dirty?: boolean } | undefined {
    if (caller === undefined) return undefined
    if (caller.checkout.kind !== 'isolated') return undefined
    if (caller.checkout.id !== record.checkoutId) return undefined
    if (caller.checkout.phase !== 'ready' || record.phase !== 'ready') return undefined
    if (caller.ownership !== 'owner') return undefined
    // `current` inspects first and reads the registry again during projection.
    // Only reuse when both observations describe the same revision: otherwise
    // old branch/HEAD data would be projected beside new review/proof state.
    if (caller.revision !== record.revision) return undefined
    return {
      managedRoot: record.managedRoot,
      snapshot: { branch: caller.current.branch, headOid: caller.current.oid },
      dirty: caller.dirty,
    }
  }

  /** True when `candidate` is `root` itself or nested under it (cross-platform). */
  function withinRoot(candidate: string, root: string): boolean {
    const normalize = (value: string): string => {
      const slashed = resolve(value).replace(/\\/g, '/').replace(/\/+$/u, '')
      return process.platform === 'win32' ? slashed.toLowerCase() : slashed
    }
    const normalizedCandidate = normalize(candidate)
    const normalizedRoot = normalize(root)
    return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`)
  }

  /**
   * The branch a delivered Worktree's owner is actually standing on.
   *
   * A delivered Worktree leaves the owner Session back at the Local boundary
   * (that is what "delivered" means: the changes are in Local and the task is
   * over), while the frozen environment still sits on disk for the retention
   * window. Reporting the frozen task branch there made the conversation chip
   * keep naming `feat/...` after the merge, so the user could not tell whether
   * they were on `master` or still isolated — the exact symptom that prompted
   * this rule.
   *
   * `undefined` = not a delivered-owner read at all, keep the Worktree branch.
   * `null` = delivered, but Local cannot be observed right now (missing root,
   * transient Git failure), so the recorded label remains the best answer.
   */
  async function settledLocalBranch(
    record: ManagedCheckoutRecord,
    sessionId: string,
    managedRoot: string | null,
    observedLocalSnapshot?: GitCheckoutSnapshot,
  ): Promise<string | null | undefined> {
    if (record.ownerSessionId !== sessionId) return undefined
    if (!worktreeReachedDelivery(record.phase, record.delivery.state)) return undefined
    if (record.phase !== 'discarded' && record.phase !== 'finalized' && record.phase !== 'retained') return undefined
    // The owner can also re-enter a retained environment after delivery (the
    // hook keeps it alive for rollback). Only a Session that is really back
    // outside the frozen root is described by the Local checkout.
    const liveCwd = options.lookup.getSessionCwd?.(sessionId)
    if (liveCwd !== undefined && managedRoot !== null && withinRoot(liveCwd, managedRoot)) return undefined
    // The observation that produced `managedRoot` already read the Local side
    // during identity validation; that snapshot IS this answer.
    if (observedLocalSnapshot !== undefined) return observedLocalSnapshot.branch
    if (!options.files.exists(record.localRoot)) return null
    try {
      const localSnapshot = await options.git.inspect(record.localRoot)
      return localSnapshot === null ? null : localSnapshot.branch
    } catch {
      return null
    }
  }

  function sameLocalRoot(left: string, right: string): boolean {
    return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
  }

  /**
   * Another Session delivering onto the same Local checkout. `gitSwitchBranch` moves that
   * checkout's HEAD, which is the baseline every pending apply-to-local is computed against.
   */
  function localDeliveryHolder(root: string, sessionId: string): ManagedCheckoutRecord | undefined {
    return Object.values(options.registry.read().managedCheckouts).find(candidate => (
      candidate.ownerSessionId !== sessionId
      && candidate.sourceSessionId !== sessionId
      && candidate.phase !== 'discarded'
      && sameLocalRoot(resolve(candidate.localRoot), resolve(root))
      && (candidate.phase === 'recovery_required'
        || (candidate.phase === 'ready'
          && (candidate.delivery.state === 'ready_for_review'
            || candidate.delivery.state === 'preview_active'
            || candidate.delivery.state === 'preview_detached')))
    ))
  }

  function acceptanceHolder(record: ManagedCheckoutRecord): ManagedCheckoutRecord | undefined {
    return Object.values(options.registry.read().managedCheckouts).find(candidate => (
      candidate.checkoutId !== record.checkoutId
      && candidate.phase !== 'discarded'
      && sameLocalRoot(candidate.localRoot, record.localRoot)
      && (
        candidate.delivery.state === 'preview_active'
        || candidate.journal?.operation === 'preview'
        || candidate.journal?.operation === 'rollback_preview'
        || candidate.journal?.operation === 'finalize_preview'
        || candidate.journal?.operation === 'finish'
      )
    ))
  }

  function projectReviewSlot<T extends WorktreeConsoleTargetSummary>(record: ManagedCheckoutRecord, target: T): T {
    if (record.delivery.state !== 'ready_for_review') return target
    const holder = acceptanceHolder(record)
    return {
      ...target,
      reviewSlot: holder ? 'waiting' : 'available',
      ...(holder ? {
        reviewSlotOwnerSessionId: holder.ownerSessionId,
        reviewSlotHolder: {
          checkoutId: holder.checkoutId,
          ownerSessionId: holder.ownerSessionId,
          revision: holder.revision,
          state: holder.delivery.state,
        },
        capabilities: { ...target.capabilities, preview: false, checkpoint: false, finalize: false },
      } : {}),
    } as T
  }

  function deliveryProofFromTarget(target: SessionTargetView): WorktreeConsoleDeliveryProof | undefined {
    const delivery = target.delivery
    if (!delivery || !('proof' in delivery) || !delivery.proof) return undefined
    return {
      ...delivery.proof,
      changedFiles: [...delivery.proof.changedFiles],
    }
  }

  async function details(
    sessionId: string,
    checkoutId: string,
    observedDeliveryProof?: WorktreeConsoleDeliveryProof,
    observedCaller?: SessionTargetView,
  ) {
    const access = await linkedReadAccess(sessionId, checkoutId, observedCaller)
    const observed = await observe(access.record, observedCaller)
    let projectedRecord = access.record
    if (access.acceptanceAnchorCheckoutId !== undefined) {
      const currentAnchor = recordOf(options.registry, access.acceptanceAnchorCheckoutId)
      const currentRequested = recordOf(options.registry, checkoutId)
      const currentHolder = currentAnchor.ownerSessionId === sessionId
        && currentAnchor.phase === 'ready'
        && currentAnchor.delivery.state === 'ready_for_review'
        ? acceptanceHolder(currentAnchor)
        : undefined
      if (
        currentHolder?.checkoutId !== currentRequested.checkoutId
        || currentRequested.ownerSessionId !== access.record.ownerSessionId
        || !sameLocalRoot(currentRequested.localRoot, currentAnchor.localRoot)
        || observed.managedRoot === null
        || !sameLocalRoot(observed.managedRoot, currentRequested.managedRoot)
      ) throw domainError('not_owner', hostMessage('theAcceptanceSlotHolderHasChangedCheckAgain'))
      projectedRecord = currentRequested
    }
    return projectReviewSlot(projectedRecord, projectDetails(
      projectedRecord,
      sessionId,
      observed.managedRoot,
      observed.snapshot,
      observed.dirty,
      ownerSessionAvailable(access.record),
      access.linkedRead,
      // A caller observed before a registry advance can carry an older proof.
      // In that case use the proof on the freshly authorized record instead.
      access.record.revision === observedCaller?.revision ? observedDeliveryProof : undefined,
      await settledLocalBranch(projectedRecord, sessionId, observed.managedRoot, observed.localSnapshot),
    ))
  }

  async function mutationResponse(
    sessionId: string,
    checkoutId: string,
    observedDeliveryProof?: WorktreeConsoleDeliveryProof,
  ): Promise<WorktreeConsoleMutationResponse> {
    const record = recordOf(options.registry, checkoutId)
    if (record.phase === 'discarded') {
      return {
        target: projectReviewSlot(record, projectRecord(record, sessionId, {
          ownerSessionAvailable: ownerSessionAvailable(record),
          deliveryProof: observedDeliveryProof,
        })),
      }
    }
    const observed = await observe(record)
    return {
      target: projectReviewSlot(record, projectRecord(record, sessionId, {
        ...observed,
        ownerSessionAvailable: ownerSessionAvailable(record),
        deliveryProof: observedDeliveryProof,
      })),
    }
  }

  const creating = new Set<string>()
  async function localProject(sessionId: string) {
    const target = await callerTarget(sessionId)
    const session = options.lookup.getSession(sessionId)
    const project = session?.projectId ? options.lookup.getProject(session.projectId) : undefined
    if (target.checkout.kind !== 'local' || !project || project.id !== target.project.id || !options.files.exists(project.root)) {
      throw domainError('operation_not_allowed', hostMessage('initialStateChanged'))
    }
    return project
  }

  /**
   * Resolve the calling session's project repo (the local root, never a
   * managed worktree): the branch chip's git surface is repo-wide and must
   * stay independent of which worktree the session happens to occupy.
   */
  async function projectRootFor(sessionId: string): Promise<{ root: string; snapshot: GitCheckoutSnapshot }> {
    const session = options.lookup.getSession(sessionId)
    if (session === undefined) throw domainError('session_not_found', hostMessage('theCurrentSessionDoesNotExist'))
    if (session.projectId === undefined) throw domainError('project_not_found', hostMessage('theCurrentSessionIsNotAssociatedWithAProject'))
    const project = options.lookup.getProject(session.projectId)
    if (project === undefined) throw domainError('project_not_found', hostMessage('theCurrentSessionSProjectDoesNotExist'))
    if (!options.files.exists(project.root)) throw domainError('project_root_missing', hostMessage('theCurrentSessionSProjectDirectoryDoesNotExist'))
    const snapshot = await options.git.inspect(project.root)
    if (snapshot === null) throw domainError('not_git_repository', hostMessage('theCurrentSessionSProjectIsNotAnAvailable'))
    return { root: project.root, snapshot }
  }
  async function withCreation<T>(sessionId: string, action: (project: Awaited<ReturnType<typeof localProject>>) => Promise<T>): Promise<T> {
    const sessionKey = `session:${sessionId}`
    if (creating.has(sessionKey)) throw domainError('operation_not_allowed', hostMessage('initialRepositoryBusy'))
    creating.add(sessionKey)
    let rootKey: string | undefined
    try {
      const project = await localProject(sessionId)
      const canonical = await options.files.canonicalize(project.root)
      const key = `root:${process.platform === 'win32' ? canonical.toLowerCase() : canonical}`
      if (creating.has(key)) throw domainError('operation_not_allowed', hostMessage('initialRepositoryBusy'))
      rootKey = key
      creating.add(key)
      return await action(project)
    } finally {
      creating.delete(sessionKey)
      if (rootKey) creating.delete(rootKey)
    }
  }

  return {
    sidebarTopology: () => outcome(async () => {
      const records = Object.values(options.registry.read().managedCheckouts)
      const memberships = await options.lookup.getSidebarMemberships?.(records.map(record => record.managedRoot))
      const membershipByRoot = new Map(memberships?.map(item => [item.managedRoot, item]))
      const projects = new Map<string, {
        project: { id: string; name: string }
        tasksByOwner: Map<string, WorktreeSidebarTopologyResponse['projects'][number]['tasks'][number]>
        workspaceIds: Set<string>
        sessionIds: Set<string>
      }>()
      for (const record of records) {
        const project = projects.get(record.projectId) ?? {
          project: { id: record.projectId, name: record.projectName },
          tasksByOwner: new Map(),
          workspaceIds: new Set<string>(),
          sessionIds: new Set<string>(),
        }
        // Preserve directory identities from all iterations, not just the
        // newest owner's badge. Cleanup may already have removed its members.
        const membership = membershipByRoot.get(record.managedRoot)
        for (const id of membership?.workspaceIds ?? []) project.workspaceIds.add(id)
        for (const id of membership?.sessionIds ?? []) project.sessionIds.add(id)
        // A user-cleared terminal badge stops projecting a task: the sidebar
        // row keeps its directory membership but loses icon/badge/menu entry.
        const badgeState = sidebarTaskState(record)
        if (
          record.sidebarBadgeClearedRevision === record.revision
          && (badgeState === 'discarded' || badgeState === 'finalized')
        ) {
          projects.set(record.projectId, project)
          continue
        }
        const task = {
          checkoutId: record.checkoutId,
          ownerSessionId: record.ownerSessionId,
          sourceSessionId: record.sourceSessionId ?? record.ownerSessionId,
          iteration: record.delivery.state === 'working' || record.delivery.state === 'delivered'
            ? record.delivery.iteration
            : record.delivery.review.iteration,
          revision: record.revision,
          phase: record.phase,
          state: badgeState,
          sourceBranch: sourceBranchFromRef(record.sessionBranch ?? record.sourceRef),
        }
        const previous = project.tasksByOwner.get(record.ownerSessionId)
        if (!previous
          || task.iteration > previous.iteration
          || (task.iteration === previous.iteration && task.revision > previous.revision)) {
          project.tasksByOwner.set(record.ownerSessionId, task)
        }
        projects.set(record.projectId, project)
      }
      return {
        projects: [...projects.values()].map(project => ({
          project: project.project,
          tasks: [...project.tasksByOwner.values()],
          ...(memberships === undefined ? {} : {
            memberships: {
              workspaceIds: [...project.workspaceIds],
              sessionIds: [...project.sessionIds],
            },
          }),
        })),
      }
    }),

    current: sessionId => outcome(async () => {
      const target = await callerTarget(sessionId)
      const worktreeRequest = options.pendingWorktreeRequest(sessionId)
      if (target.checkout.kind === 'local') return { target: projectLocal(target, sessionId), worktreeRequest }
      return {
        target: await details(sessionId, target.checkout.id, deliveryProofFromTarget(target), target),
        worktreeRequest,
      }
    }),

    gitOverview: sessionId => outcome(async () => {
      const { root, snapshot } = await projectRootFor(sessionId)
      const overview = options.git.branchOverview
        ? await options.git.branchOverview(root)
        : null
      if (overview === null) throw domainError('git_error', hostMessage('gitOperationFailedGit', { p0: 'for-each-ref', p1: '' }))
      return {
        root,
        branch: snapshot.branch,
        headOid: snapshot.headOid,
        branches: overview.branches,
        dirtyCount: overview.dirtyCount,
      }
    }),

    gitGraph: (sessionId, limit) => outcome(async () => {
      const { root, snapshot } = await projectRootFor(sessionId)
      if (options.git.graphLog === undefined) throw domainError('git_error', hostMessage('gitOperationFailedGit', { p0: 'log', p1: '' }))
      const commits = await options.git.graphLog(root, limit ?? 200)
      return { root, branch: snapshot.branch, commits }
    }),

    gitCreateBranch: (sessionId, name) => outcome(async () => {
      const { root } = await projectRootFor(sessionId)
      if (options.git.createLocalBranch === undefined) throw domainError('git_error', hostMessage('gitOperationFailedGit', { p0: 'branch', p1: name }))
      await options.git.createLocalBranch(root, name)
      return { branch: name }
    }),

    gitSwitchBranch: (sessionId, branch) => outcome(async () => {
      const { root } = await projectRootFor(sessionId)
      // Switching the local root re-bases every future apply-to-local; refuse
      // while this session holds an acceptance slot mid-delivery on that repo.
      const delivering = Object.values(options.registry.read().managedCheckouts).some(record =>
        (record.ownerSessionId === sessionId || record.sourceSessionId === sessionId)
        && (record.phase === 'recovery_required'
          || (record.phase === 'ready'
            && (record.delivery.state === 'ready_for_review'
              || record.delivery.state === 'preview_active'
              || record.delivery.state === 'preview_detached'))))
      if (delivering) throw domainError('operation_not_allowed', hostMessage('localBranchSwitchBlockedDuringDelivery'))
      const otherHolder = localDeliveryHolder(root, sessionId)
      if (otherHolder) {
        throw domainError('operation_not_allowed', hostMessage('localBranchSwitchBlockedByAnotherDelivery', { p0: otherHolder.ownerSessionId }))
      }
      if (options.git.switchLocalBranch === undefined) throw domainError('git_error', hostMessage('gitOperationFailedGit', { p0: 'switch', p1: branch }))
      await options.git.switchLocalBranch(root, branch)
      return { branch }
    }),

    gitPruneMergedBranches: (sessionId, dryRun) => outcome(async () => {
      return await options.module.pruneMergedBranchesForSession(sessionId, { dryRun })
    }),

    gitListTags: sessionId => outcome(async () => {
      const { root } = await projectRootFor(sessionId)
      if (options.git.listTags === undefined) throw domainError('git_error', hostMessage('gitOperationFailedGit', { p0: 'for-each-ref', p1: '' }))
      const tags = await options.git.listTags(root)
      if (tags === null) throw domainError('git_error', hostMessage('gitOperationFailedGit', { p0: 'for-each-ref', p1: '' }))
      return { root, tags }
    }),

    gitCreateTag: request => outcome(async () => {
      const { root } = await projectRootFor(request.sessionId)
      if (options.git.createTag === undefined) throw domainError('git_error', hostMessage('gitOperationFailedGit', { p0: 'tag', p1: request.name }))
      await options.git.createTag(root, request.name, { message: request.message, target: request.target })
      if (request.push !== true) return { tag: request.name }
      if (options.git.pushTag === undefined) return { tag: request.name, pushed: false, pushMessage: hostMessage('gitOperationFailedGit', { p0: 'push', p1: request.name }) }
      const pushed = await options.git.pushTag(root, request.name)
      return pushed.ok
        ? { tag: request.name, pushed: true }
        : { tag: request.name, pushed: false, pushMessage: pushed.message ?? hostMessage('gitOperationFailedGit', { p0: 'push', p1: request.name }) }
    }),

    gitDeleteTag: request => outcome(async () => {
      const { root } = await projectRootFor(request.sessionId)
      // Remote first: when the origin delete fails the local tag is still there,
      // so the user can retry instead of losing the only remaining copy.
      if (request.remote === true) {
        if (options.git.deleteRemoteTag === undefined) return { tag: request.name, pushed: false, pushMessage: hostMessage('gitOperationFailedGit', { p0: 'push', p1: request.name }) }
        const deleted = await options.git.deleteRemoteTag(root, request.name)
        if (!deleted.ok) {
          return { tag: request.name, pushed: false, pushMessage: deleted.message ?? hostMessage('gitOperationFailedGit', { p0: 'push', p1: request.name }) }
        }
      }
      if (options.git.deleteLocalTag === undefined) throw domainError('git_error', hostMessage('gitOperationFailedGit', { p0: 'tag -d', p1: request.name }))
      await options.git.deleteLocalTag(root, request.name)
      return request.remote === true ? { tag: request.name, pushed: true } : { tag: request.name }
    }),

    gitPushTag: request => outcome(async () => {
      const { root } = await projectRootFor(request.sessionId)
      if (options.git.pushTag === undefined) throw domainError('git_error', hostMessage('gitOperationFailedGit', { p0: 'push', p1: request.name }))
      const pushed = await options.git.pushTag(root, request.name)
      // Same soft-degrade channel as gitCreateTag's push step: a rejected push is
      // a reportable outcome, not a failed mutation.
      return pushed.ok
        ? { tag: request.name, pushed: true }
        : { tag: request.name, pushed: false, pushMessage: pushed.message ?? hostMessage('gitOperationFailedGit', { p0: 'push', p1: request.name }) }
    }),

    listAbandoned: sessionId => outcome(async () => {
      return { snapshots: await options.module.listAbandonedWorktreeSnapshots(sessionId) }
    }),

    restoreAbandoned: request => outcome(async () => {
      await authorize(request.sessionId, request.checkoutId)
      const { branch } = await options.module.restoreAbandonedWorktreeSnapshot(request.sessionId, request.checkoutId)
      return { checkoutId: request.checkoutId, branch }
    }),

    list: request => outcome(async () => {
      const caller = await callerTarget(request.sessionId)
      let sourceSessionId = request.sessionId
      let localRoot: string | undefined
      if (caller.checkout.kind === 'isolated') {
        const anchor = await authorize(request.sessionId, caller.checkout.id, caller)
        sourceSessionId = anchor.sourceSessionId ?? anchor.ownerSessionId
        localRoot = anchor.localRoot
      } else {
        const session = options.lookup.getSession(request.sessionId)
        const project = session?.projectId === undefined ? undefined : options.lookup.getProject(session.projectId)
        if (project === undefined || project.id !== caller.project.id || !options.files.exists(project.root)) {
          throw domainError('project_mismatch', hostMessage('theCurrentSessionWorkspaceCannotBeProvenToBe'))
        }
        localRoot = await options.files.canonicalize(project.root)
      }
      const active = await options.module.listManagedWorktreesForSession(sourceSessionId, {
        needsAttention: request.needsAttention,
      })
      const activeById = new Map(active.map(summary => [summary.checkoutId, summary]))
      const records = Object.values(options.registry.read().managedCheckouts)
        .filter(record => record.projectId === caller.project.id)
        .filter(record => (record.sourceSessionId ?? record.ownerSessionId) === sourceSessionId)
        .filter(record => localRoot === undefined || sameLocalRoot(record.localRoot, localRoot))
        .filter(record => request.includeDelivered === true || record.phase !== 'discarded')
        .filter(record => record.phase === 'discarded' || activeById.has(record.checkoutId))
      // 批量观察在模块侧一次拿锁并行验证；模块未提供批量方法时回退逐记录 observe。
      const observableRecords = records.filter(record => record.phase !== 'discarded')
      let observations: Awaited<ReturnType<NonNullable<typeof options.module.observeManagedCheckouts>>> | undefined
      if (options.module.observeManagedCheckouts) {
        try {
          observations = await options.module.observeManagedCheckouts(observableRecords.map(record => record.checkoutId))
        } catch {
          // 身份无法验证的记录不应拖垮整个面板：批量失败退回逐条降级观察。
          observations = undefined
        }
      }
      const worktrees = []
      let observedIndex = 0
      for (const record of records) {
        let observed: { managedRoot: string | null; snapshot?: Pick<GitCheckoutSnapshot, 'branch' | 'headOid'>; dirty?: boolean } | undefined
        if (record.phase === 'discarded') {
          observed = undefined
        } else if (observations) {
          const entry = observations[observedIndex]!
          observedIndex += 1
          observed = { managedRoot: entry.managedRoot, snapshot: entry.snapshot, dirty: entry.dirty }
        } else {
          // 降级观察：验证失败的记录以无观察投影呈现（回退 oid、不带新鲜快照），
          // 面板其余记录照常渲染，后续操作的 CAS 校验仍会兜底拒绝。
          try {
            observed = await observe(record)
          } catch {
            observed = undefined
          }
        }
        const linkedRead = record.ownerSessionId !== request.sessionId && record.sourceSessionId !== request.sessionId
        const projected = projectReviewSlot(record, projectRecord(record, request.sessionId, {
          ...observed,
          summary: activeById.get(record.checkoutId),
          ownerSessionAvailable: ownerSessionAvailable(record),
          linkedRead,
        }))
        // A preview that drifted from Local needs the user's attention just like a
        // blocked cleanup or an unrecoverable record; otherwise the panel hides it.
        if (
          request.needsAttention !== true
          || projected.state === 'cleanup_pending'
          || projected.state === 'preview_detached'
          || projected.state === 'recovery_required'
        ) {
          worktrees.push(projected)
        }
      }
      return { project: { ...caller.project }, worktrees }
    }),

    initProject: sourceSessionId => outcome(() => withCreation(sourceSessionId, async project => {
      if (!options.git.initializeProject) throw domainError('operation_not_allowed', hostMessage('initializationUnsupported'))
      await options.git.initializeProject(project.root)
      return true
    })),

    inspect: (sessionId, checkoutId) => outcome(async () => ({ target: await details(sessionId, checkoutId) })),

    reviewDiff: async request => {
      try {
        const record = await authorize(request.sessionId, request.checkoutId)
        if (record.ownerSessionId !== request.sessionId) return failure('not_owner', hostMessage('onlyTheOwnerIsolatedSessionCanReadTheReview'))
        if (record.revision !== request.expectedRevision) return failure('stale_target', hostMessage('theSessionTargetHasChangedRefresh'))
        const review = readyReview(record)
        if (review.reviewId !== request.expectedReviewId) return failure('stale_target', hostMessage('theReviewIdentityHasChangedRefresh'))
        const before = await options.module.preflight?.(request.sessionId, request.expectedRevision)
        if (before === undefined || before.status === 'blocked') return preflightFailure(before)!
        if (before.reviewId !== review.reviewId || before.isolatedHeadOid !== review.isolatedHeadOid) {
          return failure('stale_isolated', hostMessage('isolatedHEADChangedAfterReady'))
        }
        const observed = await observe(record)
        const diff = await options.reviewDiff.read({
          managedRoot: observed.managedRoot!,
          baseOid: record.applyBaseOid ?? record.baseOid,
          reviewId: review.reviewId,
          revision: record.revision,
          changedFiles: review.changedFiles,
        })
        const after = await options.module.preflight?.(request.sessionId, request.expectedRevision)
        if (after === undefined || after.status === 'blocked') {
          return failure('stale_isolated', hostMessage('isolatedContentChangedAfterReadyDiffBytesWereDiscarded'))
        }
        const current = recordOf(options.registry, request.checkoutId)
        if (
          after.reviewId !== review.reviewId
          || after.isolatedHeadOid !== review.isolatedHeadOid
          || current.revision !== request.expectedRevision
          || current.delivery.state !== 'ready_for_review'
          || current.delivery.review.reviewId !== review.reviewId
          || current.delivery.review.isolatedFingerprint !== review.isolatedFingerprint
        ) return failure('stale_isolated', hostMessage('isolatedContentChangedAfterReadyDiffBytesWereDiscarded'))
        return { ok: true, value: diff }
      } catch (error) {
        if (error instanceof ReviewDiffStaleError) return failure('stale_isolated', error.message)
        return consoleFailure(error)
      }
    },

    preflight: request => outcome(async () => {
      const record = await authorize(request.sessionId, request.checkoutId)
      if (record.ownerSessionId !== request.sessionId) throw domainError('not_owner', hostMessage('onlyTheOwnerIsolatedSessionCanRunSyncPreflight436'))
      if (record.revision !== request.expectedRevision) throw domainError('stale_target', hostMessage('theSessionTargetHasChangedRefresh'))
      const review = readyReview(record)
      if (review.reviewId !== request.expectedReviewId) throw domainError('stale_target', hostMessage('theReviewIdentityHasChangedRefresh'))
      const preflight = await options.module.preflight?.(request.sessionId, request.expectedRevision)
      if (preflight === undefined) throw domainError('git_error', hostMessage('theCurrentSessionCheckoutModuleDoesNotSupportAcceptancePreflight'))
      return { preflight }
    }),

    previewRecoveryPreflight: request => outcome(async () => {
      const record = await authorize(request.sessionId, request.checkoutId)
      if (record.ownerSessionId !== request.sessionId) throw domainError('not_owner', hostMessage('onlyTheOwnerIsolatedSessionCanCheckPreviewRecovery440'))
      if (record.revision !== request.expectedRevision) throw domainError('stale_target', hostMessage('theSessionTargetHasChangedRefresh'))
      if (
        record.phase !== 'ready'
        || record.delivery.state !== 'preview_detached'
        || record.delivery.review.reviewId !== request.expectedReviewId
        || record.delivery.preview.previewId !== request.expectedPreviewId
      ) throw domainError('stale_target', hostMessage('theDetachedPreviewIdentityHasChangedRefresh'))
      const preflight = await options.module.preflightPreviewRecovery?.(
        request.sessionId,
        request.expectedRevision,
        request.expectedReviewId,
        request.expectedPreviewId,
      )
      if (preflight === undefined) throw domainError('git_error', hostMessage('theCurrentSessionCheckoutModuleDoesNotSupportPreviewRecoveryPreflight'))
      return { preflight }
    }),

    preparePreviewRecoveryAnalysis: request => outcome(async () => {
      const record = await authorize(request.sessionId, request.checkoutId)
      if (
        record.ownerSessionId !== request.sessionId
        || request.recoveryProof.sessionId !== request.sessionId
        || request.recoveryProof.checkoutId !== request.checkoutId
        || request.recoveryProof.revision !== request.expectedRevision
        || request.recoveryProof.reviewId !== request.expectedReviewId
        || request.recoveryProof.previewId !== request.expectedPreviewId
      ) throw domainError('stale_target', hostMessage('thePreviewRecoveryAnalysisIdentityDoesNotMatch'))
      const prepared = await options.module.preparePreviewRecoveryAnalysis(
        request.sessionId,
        request.recoveryProof,
        `preview-recovery-analysis:${randomUUID()}`,
      )
      const response = await mutationResponse(request.sessionId, request.checkoutId)
      return {
        ...response,
        recoveryContinuation: {
          kind: prepared.kind,
          requestId: prepared.requestId,
          checkoutId: request.checkoutId,
          reviewId: prepared.reviewId,
          previewId: prepared.previewId,
          revision: prepared.revision,
          generation: prepared.generation,
        },
      }
    }),

    createPreviewRecoveryHandoff: request => outcome(async () => {
      const record = await authorize(request.sessionId, request.checkoutId)
      if (
        record.ownerSessionId !== request.sessionId
        || request.recoveryProof.sessionId !== request.sessionId
        || request.recoveryProof.checkoutId !== request.checkoutId
        || request.recoveryProof.revision !== request.expectedRevision
        || request.recoveryProof.reviewId !== request.expectedReviewId
        || request.recoveryProof.previewId !== request.expectedPreviewId
      ) throw domainError('stale_target', hostMessage('thePreviewRecoveryHandoffIdentityDoesNotMatch'))
      const targetSessionId = createTargetSessionId()
      const launch = await options.module.createPreviewRecoveryHandoff(
        request.sessionId,
        request.recoveryProof,
        targetSessionId,
        `preview-recovery-handoff:${randomUUID()}`,
      )
      const created = recordOf(options.registry, launch.target.checkout.id)
      const observed = await observe(created)
      if (
        created.ownerSessionId !== targetSessionId
        || created.recoveryContinuation?.kind !== 'worktree_preview_recovery_handoff'
        || created.recoveryContinuation.requestId !== launch.continuation.requestId
        || observed.managedRoot !== launch.managedRoot
      ) throw domainError('checkout_mismatch', hostMessage('hostIdentityVerificationFailedForTheRecoveryHandoffWorktree'))
      return {
        target: projectDetails(
          created,
          targetSessionId,
          observed.managedRoot,
          observed.snapshot,
          observed.dirty,
          false,
        ),
        targetSessionId,
        managedRoot: launch.managedRoot,
        recoveryContinuation: {
          kind: launch.continuation.kind,
          requestId: launch.continuation.requestId,
          checkoutId: created.checkoutId,
          sourceCheckoutId: launch.continuation.sourceCheckoutId,
          reviewId: launch.continuation.reviewId,
          previewId: launch.continuation.previewId,
          revision: launch.continuation.sourceRevision,
          generation: launch.continuation.generation,
        },
      }
    }),

    checkpoint: request => outcome(async () => {
      const record = await authorize(request.sessionId, request.checkoutId)
      if (record.ownerSessionId !== request.sessionId) throw domainError('not_owner', hostMessage('onlyTheOwnerIsolatedSessionCanSaveACheckpoint447'))
      const commitMessage = request.commitMessage.trim()
      if (!isValidCommitMessage(commitMessage) || !safeRecoveryRequestId(request.requestId)) {
        throw domainError('invalid_input', hostMessage('theCheckpointCommitMessageOrRequestIdIsInvalid'))
      }
      const result = await options.module.operate({
        action: 'checkpoint',
        sessionId: request.sessionId,
        expectedRevision: request.expectedRevision,
        expectedReviewId: request.expectedReviewId,
        expectedGeneration: request.expectedGeneration,
        requestId: request.requestId,
        commitMessage,
      })
      if (result.status === 'error') throw domainError(result.code, result.message)
      if (result.status === 'preview_detached') {
        return { ...(await mutationResponse(request.sessionId, request.checkoutId)), changedFiles: [...result.changedFiles] }
      }
      if (result.status !== 'checkpointed') throw domainError('operation_not_allowed', hostMessage('checkpointReturnedAnUnexpectedState'))
      const response = await mutationResponse(request.sessionId, request.checkoutId)
      if (response.target.state !== 'working' || response.target.revision !== result.target.revision) {
        throw domainError('checkout_mismatch', hostMessage('worktreeDidNotReturnToWorkingAfterCheckpoint'))
      }
      return { ...response, checkpoint: result.checkpoint, changedFiles: [...result.changedFiles] }
    }),

    preview: request => outcome(async () => {
      const record = await authorize(request.sessionId, request.checkoutId)
      if (record.ownerSessionId !== request.sessionId) throw domainError('not_owner', hostMessage('onlyTheOwnerIsolatedSessionCanPreviewChanges'))
      if (record.revision !== request.expectedRevision) throw domainError('stale_target', hostMessage('theSessionTargetHasChangedRefresh'))
      const review = readyReview(record)
      if (review.reviewId !== request.expectedReviewId) throw domainError('stale_target', hostMessage('theReviewIdentityHasChangedRefresh'))
      const result = await options.module.operate({
        action: 'preview', sessionId: request.sessionId, expectedRevision: request.expectedRevision,
      })
      if (result.status === 'error') throw domainError(result.code, result.message)
      if (result.status === 'conflict') {
        throw domainError(
          'apply_conflict',
          hostMessage('localPreviewPreflightFoundContentConflicts'),
          applyConflictContinuation(result, review.reviewId),
        )
      }
      if (result.status !== 'previewed') throw domainError('operation_not_allowed', hostMessage('previewReturnedAnUnexpectedState'))
      return {
        ...(await mutationResponse(request.sessionId, request.checkoutId)),
        changedFiles: [...result.changedFiles],
      }
    }),

    resumeRevision: request => outcome(async () => {
      const record = await authorize(request.sessionId, request.checkoutId)
      if (record.ownerSessionId !== request.sessionId) throw domainError('not_owner', hostMessage('onlyTheOwnerIsolatedSessionCanResumeEditing456'))
      if (record.revision !== request.expectedRevision) throw domainError('stale_target', hostMessage('theSessionTargetHasChangedRefresh'))
      const review = readyReview(record)
      if (review.reviewId !== request.expectedReviewId) throw domainError('stale_target', hostMessage('theReviewIdentityHasChangedRefresh'))
      const requestedRecovery = request.conflictContinuation
      if (requestedRecovery && (
        requestedRecovery.kind !== 'worktree_apply_conflict'
        || !safeRecoveryRequestId(requestedRecovery.requestId)
        || requestedRecovery.checkoutId !== request.checkoutId
        || requestedRecovery.reviewId !== request.expectedReviewId
        || requestedRecovery.revision !== request.expectedRevision
        || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(requestedRecovery.localHeadOid)
        || requestedRecovery.conflictingFiles.length > 500
        || !requestedRecovery.conflictingFiles.every(safeConflictFile)
      )) throw domainError('invalid_input', hostMessage('invalidConflictRecoveryRequestIdentity'))
      const recovery = requestedRecovery ? {
        kind: 'worktree_apply_conflict' as const,
        requestId: `conflict-recovery:${randomUUID()}`,
        reviewId: request.expectedReviewId,
        readyRevision: request.expectedRevision,
        localHeadOid: requestedRecovery.localHeadOid,
        conflictingFiles: [...requestedRecovery.conflictingFiles],
      } : undefined
      const target = recovery
        ? await options.module.resumeRevision(
            request.sessionId,
            request.expectedRevision,
            request.expectedReviewId,
            recovery,
          )
        : await options.module.resumeRevision(
            request.sessionId,
            request.expectedRevision,
            request.expectedReviewId,
          )
      if (target.checkout.id !== request.checkoutId || target.delivery?.state !== 'working') {
        throw domainError('checkout_mismatch', hostMessage('theWorktreeIdentityOrStateDoesNotMatchAfter'))
      }
      const response = await mutationResponse(request.sessionId, request.checkoutId)
      if (!requestedRecovery) return response
      const current = recordOf(options.registry, request.checkoutId).recoveryContinuation
      if (
        !current
        || current.kind !== 'worktree_apply_conflict'
        || current.requestId !== recovery!.requestId
        || current.workingRevision !== response.target.revision
      ) throw domainError('checkout_mismatch', hostMessage('theHostCouldNotPersistTheExactConflictRecovery'))
      return {
        ...response,
        recoveryContinuation: {
          kind: current.kind,
          requestId: current.requestId,
          checkoutId: request.checkoutId,
          reviewId: current.reviewId,
          revision: current.workingRevision,
          localHeadOid: current.localHeadOid,
          conflictingFiles: [...current.conflictingFiles],
        },
      }
    }),

    prepareReviewRegeneration: request => outcome(async () => {
      const record = await authorize(request.sessionId, request.checkoutId)
      if (record.ownerSessionId !== request.sessionId) throw domainError('not_owner', hostMessage('onlyTheOwnerIsolatedSessionCanRequestReviewRegeneration462'))
      if (record.revision !== request.expectedRevision) throw domainError('stale_target', hostMessage('theSessionTargetHasChangedRefresh'))
      const review = readyReview(record)
      if (review.reviewId !== request.expectedReviewId) throw domainError('stale_target', hostMessage('theReviewIdentityHasChangedRefresh'))
      const prepared = await options.module.prepareReviewRegeneration(
        request.sessionId,
        request.expectedRevision,
        request.expectedReviewId,
        `review-regeneration:${randomUUID()}`,
      )
      const response = await mutationResponse(request.sessionId, request.checkoutId)
      return {
        ...response,
        recoveryContinuation: {
          kind: prepared.kind,
          requestId: prepared.requestId,
          checkoutId: request.checkoutId,
          reviewId: prepared.reviewId,
          revision: prepared.revision,
        },
      }
    }),

    rollbackPreview: request => outcome(async () => {
      const record = await authorize(request.sessionId, request.checkoutId)
      if (record.ownerSessionId !== request.sessionId) throw domainError('not_owner', hostMessage('onlyTheOwnerIsolatedSessionCanRollBackLocal'))
      const result = await options.module.operate({
        action: 'rollback_preview',
        sessionId: request.sessionId,
        expectedRevision: request.expectedRevision,
        ...(request.resumeRevision === undefined ? {} : { resumeRevision: request.resumeRevision }),
        ...(request.recoveryProof === undefined ? {} : { recoveryProof: request.recoveryProof }),
      })
      if (result.status === 'error') throw domainError(result.code, result.message)
      if (result.status !== 'preview_rolled_back' && result.status !== 'preview_detached') {
        throw domainError('operation_not_allowed', hostMessage('rollbackPreviewReturnedAnUnexpectedState'))
      }
      return {
        ...(await mutationResponse(request.sessionId, request.checkoutId)),
        changedFiles: [...result.changedFiles],
      }
    }),

    discard: request => outcome(async () => {
      const record = await authorize(request.sessionId, request.checkoutId)
      if (record.ownerSessionId !== request.sessionId && ownerSessionAvailable(record)) {
        throw domainError('not_owner', hostMessage('theOwnerSessionHasTakenOverThisWorktreeOnly467'))
      }
      if (record.ownerSessionId === request.sessionId) {
        const result = await options.module.operate({
          action: 'discard',
          sessionId: request.sessionId,
          expectedRevision: request.expectedRevision,
          confirmDirty: request.confirmDirty,
          ...(request.rollbackPreview === undefined ? {} : { rollbackPreview: request.rollbackPreview }),
        })
        if (result.status === 'error') throw domainError(result.code, result.message)
        if (result.status === 'preview_detached') {
          return { ...(await mutationResponse(request.sessionId, request.checkoutId)), changedFiles: [...result.changedFiles] }
        }
        if (result.status !== 'discarded') throw domainError('operation_not_allowed', hostMessage('discardReturnedAnUnexpectedState'))
      } else {
        await options.module.manageManagedWorktreeForSession(request.sessionId, {
          checkoutId: request.checkoutId,
          expectedRevision: request.expectedRevision,
          action: 'discard',
          confirmDirty: request.confirmDirty,
        })
      }
      return mutationResponse(request.sessionId, request.checkoutId)
    }),

    finalize: async request => {
      try {
        const record = await authorize(request.sessionId, request.checkoutId)
        if (record.ownerSessionId !== request.sessionId) return failure('not_owner', hostMessage('onlyTheOwnerIsolatedSessionCanCommitAcceptance'))
        if (record.revision !== request.expectedRevision) return failure('stale_target', hostMessage('theSessionTargetHasChangedRefresh'))
        const review = readyReview(record)
        if (review.reviewId !== request.expectedReviewId) return failure('stale_target', hostMessage('theReviewIdentityHasChangedRefresh'))
        const commitMessage = request.commitMessage.trim()
        if (!isValidCommitMessage(commitMessage)) return failure('invalid_input', hostMessage('theCommitMessageMustBeNonemptyAndContainNoNul'))
        const result = await options.module.operate({
          sessionId: request.sessionId,
          expectedRevision: request.expectedRevision,
          action: 'finish',
          expectedReviewId: request.expectedReviewId,
          commitMessage,
          retention: request.retention,
        })
        if (result.status === 'error') return failure(result.code, result.message)
        if (result.status === 'conflict') {
          return failure(
            'apply_conflict',
            hostMessage('applyingToLocalCausedConflicts'),
            undefined,
            applyConflictContinuation(result, review.reviewId),
          )
        }
        if (result.status !== 'finished') return failure('operation_not_allowed', hostMessage('finalizeReturnedAnUnexpectedState'))
        return {
          ok: true,
          value: {
            ...(await mutationResponse(
              request.sessionId,
              request.checkoutId,
              deliveryProofFromTarget(result.target),
            )),
            changedFiles: [...result.changedFiles],
            commitOid: result.commitOid,
          },
        }
      } catch (error) {
        return consoleFailure(error)
      }
    },

    finalizePreview: async request => {
      try {
        const record = await authorize(request.sessionId, request.checkoutId)
        if (record.ownerSessionId !== request.sessionId) return failure('not_owner', hostMessage('onlyTheOwnerIsolatedSessionCanFinalizeLocalPreview'))
        if (record.revision !== request.expectedRevision) return failure('stale_target', hostMessage('theSessionTargetHasChangedRefresh'))
        const review = previewReview(record)
        if (review.reviewId !== request.expectedReviewId) return failure('stale_target', hostMessage('theReviewIdentityHasChangedRefresh'))
        const commitMessage = request.commitMessage.trim()
        if (!isValidCommitMessage(commitMessage)) return failure('invalid_input', hostMessage('theCommitMessageMustBeNonemptyAndContainNoNul'))
        const result = await options.module.operate({
          action: 'finalize_preview',
          sessionId: request.sessionId,
          expectedRevision: request.expectedRevision,
          commitMessage,
          retention: request.retention,
          ...(request.recoveryProof === undefined ? {} : { recoveryProof: request.recoveryProof }),
        })
        if (result.status === 'error') return failure(result.code, result.message)
        if (result.status === 'preview_detached') {
          return {
            ok: true,
            value: {
              ...(await mutationResponse(request.sessionId, request.checkoutId)),
              changedFiles: [...result.changedFiles],
            },
          }
        }
        if (result.status !== 'finished') return failure('operation_not_allowed', hostMessage('finalizePreviewReturnedAnUnexpectedState'))
        return {
          ok: true,
          value: {
            ...(await mutationResponse(
              request.sessionId,
              request.checkoutId,
              deliveryProofFromTarget(result.target),
            )),
            changedFiles: [...result.changedFiles],
            commitOid: result.commitOid,
          },
        }
      } catch (error) {
        return consoleFailure(error)
      }
    },

    setRetention: request => outcome(async () => {
      const record = await authorize(request.sessionId, request.checkoutId)
      requireOwner(record, request.sessionId)
      await options.module.manageManagedWorktreeForSession(request.sessionId, {
        checkoutId: request.checkoutId,
        expectedRevision: request.expectedRevision,
        action: 'set_retention',
        retention: request.retention,
      })
      return mutationResponse(request.sessionId, request.checkoutId)
    }),

    setPermanent: request => outcome(async () => {
      const record = await authorize(request.sessionId, request.checkoutId)
      requireOwner(record, request.sessionId)
      await options.module.manageManagedWorktreeForSession(request.sessionId, {
        checkoutId: request.checkoutId,
        expectedRevision: request.expectedRevision,
        action: 'set_permanent',
        permanent: request.permanent,
      })
      return mutationResponse(request.sessionId, request.checkoutId)
    }),

    retryCleanup: request => outcome(async () => {
      const record = await authorize(request.sessionId, request.checkoutId)
      requireOwner(record, request.sessionId)
      await options.module.manageManagedWorktreeForSession(request.sessionId, {
        checkoutId: request.checkoutId,
        expectedRevision: request.expectedRevision,
        action: 'retry_cleanup',
        ...(request.discardPostDeliveryChanges === true ? { discardPostDeliveryChanges: true } : {}),
      })
      return mutationResponse(request.sessionId, request.checkoutId)
    }),

    clearSidebarBadge: request => outcome(async () => {
      const record = await authorize(request.sessionId, request.checkoutId)
      const state = sidebarTaskState(record)
      if (state !== 'discarded' && state !== 'finalized') {
        throw domainError('operation_not_allowed', hostMessage('onlyATerminalWorktreeBadgeCanBeCleared'))
      }
      await options.module.manageManagedWorktreeForSession(request.sessionId, {
        checkoutId: request.checkoutId,
        expectedRevision: request.expectedRevision,
        action: 'clear_sidebar_badge',
      })
      return mutationResponse(request.sessionId, request.checkoutId)
    }),

    beginNextIteration: request => outcome(async () => {
      const predecessor = recordOf(options.registry, request.checkoutId)
      if (predecessor.ownerSessionId !== request.sessionId) {
        throw domainError('not_owner', hostMessage('onlyTheOwnerSessionCanBeginTheNextIteration'))
      }
      if (predecessor.revision !== request.expectedRevision) {
        throw domainError('stale_target', hostMessage('theWorktreeStateHasChangedRefreshBeforeBeginningThe'))
      }
      if (predecessor.phase !== 'discarded' || predecessor.delivery.state !== 'delivered') {
        throw domainError('operation_not_allowed', hostMessage('onlyADeliveredStateWithSuccessfulCleanupCanBegin'))
      }
      const session = options.lookup.getSession(request.sessionId)
      const workspace = session?.projectId === undefined ? undefined : options.lookup.getProject(session.projectId)
      // A separate isolated Session lives at the managed root; an in-place
      // Session lives back at the Local boundary after a successful cleanup,
      // so accepting only the managed root fails every in-place next iteration.
      const ownerRootMatches = workspace !== undefined && (
        sameLocalRoot(resolve(workspace.root), resolve(predecessor.managedRoot))
        || sameLocalRoot(resolve(workspace.root), resolve(predecessor.localRoot))
      )
      if (!ownerRootMatches) {
        throw domainError('project_mismatch', hostMessage('theCurrentSessionSImmutableCwdDoesNotMatch'))
      }

      const target = await options.module.beginNextIteration(request.sessionId, request.expectedRevision)
      if (target.checkout.kind !== 'isolated' || target.delivery?.state !== 'working') {
        throw domainError('checkout_mismatch', hostMessage('theNextWorktreeIterationDidNotEnterWorkingState484'))
      }
      const record = recordOf(options.registry, target.checkout.id)
      if (
        record.predecessorCheckoutId !== predecessor.checkoutId
        || record.ownerSessionId !== request.sessionId
        || !sameLocalRoot(record.managedRoot, predecessor.managedRoot)
      ) {
        throw domainError('checkout_mismatch', hostMessage('theNextIterationSWorktreeLineageOrCwdIdentity'))
      }
      const observed = await observe(record)
      return {
        target: projectRecord(record, request.sessionId, {
          snapshot: observed.snapshot,
          dirty: observed.dirty,
          ownerSessionAvailable: true,
        }),
      }
    }),

    // 回到 Local：把一个已交付的隔离会话释放回 Local 边界。
    //
    // 为什么需要它：交付之后 Worktree 记录进入 retained（默认保留 24 小时），
    // 会话仍被绑定在 isolated 上，于是顶部胶囊、侧栏与运行上下文都还按隔离态
    // 描述——用户看不到"我其实已经在 master 上了"，也没有任何入口主动回到
    // Local。上游同样缺这条路径（isolated → local 直接落到 target_already_bound）。
    //
    // 边界：只放行已交付（delivered/finalized/retained）的记录。未交付时解绑会把
    // 未合并的工作留在冻结目录里，那一律拒绝。记录本身不动，保留期倒计时与已
    // 交付徽章照旧，回滚材料还在。
    returnToLocal: request => outcome(async () => {      const record = recordOf(options.registry, request.checkoutId)
      if (record.ownerSessionId !== request.sessionId) {
        throw domainError('not_owner', hostMessage('onlyTheOwnerSessionCanBeginTheNextIteration'))
      }
      if (!worktreeReachedDelivery(record.phase, record.delivery.state)) {
        throw domainError('operation_not_allowed', hostMessage('theWorktreeHasNotBeenDeliveredToLocalYet'))
      }
      if (record.phase !== 'discarded' && record.phase !== 'finalized' && record.phase !== 'retained') {
        throw domainError('operation_not_allowed', hostMessage('theWorktreeHasNotBeenDeliveredToLocalYet'))
      }
      const binding = options.registry.read().sessionBindings[request.sessionId]
      if (binding?.target.kind !== 'isolated' || binding.target.checkoutId !== request.checkoutId) {
        // Already released (or the Session never pointed here): report the
        // current Local projection instead of failing a no-op.
        const localTarget = await callerTarget(request.sessionId)
        return { target: projectLocal(localTarget, request.sessionId) }
      }
      const target = await options.module.bind(request.sessionId, { kind: 'local' })
      if (target.checkout.kind !== 'local') {
        throw domainError('checkout_mismatch', hostMessage('theCurrentSessionIsNotAllowedToAccessThis'))
      }
      return { target: projectLocal(target, request.sessionId) }
    }),

    // 「下一次 turn 在新树里开始」的待办请求。写入只落一条 session record，
    // 真正的 `git worktree add` 由 mountWorktreeRequest 在 turn 的第 1 步兑现：
    // 勾选立刻建树会为用户没打算发的消息付一次完整 checkout 的代价。
    setWorktreeRequest: request => outcome(async () => ({
      request: options.setWorktreeRequest(request.sessionId, request.from),
    })),
  }
}
