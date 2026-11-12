import { isValidCommitMessage } from './commit-message.js'
import { hostMessages, hostPersistedCleanupMessage, type PersistedCleanupKey } from './i18n/host-messages.js'
import { hostMessage } from './i18n/host.js'
import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type {
  AbandonedWorktreeSnapshotView,
  ApplyConflictReason,
  BulkCleanupManagedWorktreeCandidate,
  BulkCleanupManagedWorktreesResult,
  ManagedWorktreeCleanupView,
  ManagedWorktreeSummaryView,
  MergeBranchForSessionView,
  PruneMergedBranchEntry,
  PruneMergedBranchesView,
  SessionCheckoutErrorCode,
  SessionCheckoutOperation,
  SessionCheckoutOperationErrorResult,
  SessionCheckoutOperationResult,
  SessionTargetBindChoice,
  SessionTargetCurrentView,
  SessionTargetView,
  WorktreeApplyPreflightBlockedReason,
  WorktreeApplyPreflightView,
  WorktreePreviewRecoveryPreflightView,
  WorktreePreviewRecoveryProof,
  WorktreeCleanupReason,
  WorktreeDeliveryProofView,
  WorktreeRetentionMode,
  WorktreeCheckpointView,
  WorktreePushOutcome,
} from './types.js'
import { DEFAULT_WORKTREE_RETENTION } from './types.js'
import { worktreeReachedDelivery } from './console-contract.js'
import { SessionCheckoutError } from './index.js'
import { WorktreeCreationFailure } from './creation-failure.js'
import type { WorktreeCreationEvidence } from './ports.js'
import { adoptWorktreeForSession, registerOfficialWorktree } from './official-worktree-registration.js'
import { checkpointGenerationForRecord } from './checkpoint.js'
import {
  createManagedWorktreePathCandidates,
  createManagedWorktreeRepositoryKey,
  createSessionBranchCandidates,
} from './managed-worktree-path.js'
import type {
  IsolatedTargetLaunch,
  ListManagedWorktreesInput,
  ManageManagedWorktreeInput,
  MarkReadyForReviewInput,
  MergeBranchForSessionInput,
  PruneMergedBranchesInput,
  SessionCheckoutModule,
  SessionCheckoutReconcileSummary,
} from './index.js'
import type {
  DirectoryIdentity,
  GitCheckoutSnapshot,
  ManagedCheckoutRecord,
  ManagedDeliveryProof,
  ManagedPreviewReceipt,
  ManagedApplyConflictRecoveryContinuation,
  ManagedPreviewRecoveryAnalysisContinuation,
  ManagedPreviewRecoveryHandoffContinuation,
  ManagedReviewRegenerationContinuation,
  ManagedWorktreeCheckpointRecord,
  ManagedWorktreePreviousReviewRecord,
  ManagedWorktreeReviewRecord,
  SessionBindingRecord,
  SessionCheckoutDependencies,
  SessionCheckoutGitPort,
  SessionCheckoutProjectRecord,
  SessionCheckoutSessionRecord,
} from './ports.js'
import { liveConfigValue } from './ports.js'

/**
 * dsh-git-worktree session-checkout state machine, ported from Domi. It keeps
 * receipt-first Local Preview, rollback/finalize, project acceptance slots,
 * crash recovery and fingerprint CAS while adapting ownership to Harness's
 * separate source Local Session and target owner Session.
 * @module dsh-git-worktree/session-checkout-module
 */

interface ResolvedSessionProject {
  session: SessionCheckoutSessionRecord
  project: SessionCheckoutProjectRecord
}

const UNVERSIONED_OID = 'unversioned'
const UNVERSIONED_REF = 'WORKING_TREE'
const RETENTION_24H_MS = 24 * 60 * 60 * 1000
const RETENTION_3D_MS = 3 * RETENTION_24H_MS
const CLEANUP_IDENTITY_CHANGED_MESSAGE = hostMessages.cleanupIdentityChanged.zh
const CLEANUP_RESIDUE_MESSAGE = hostMessages.cleanupResidue.zh
const TRANSIENT_CLEANUP_RETRY_DELAYS_MS = [100, 300, 800]

/**
 * 单个 checkout 清理/维护操作的启动收敛超时。
 * Windows 上 Worktree 被外部进程（如残留 Agent 运行）占用时，git/fs 操作可能无限期挂起；
 * 启动收敛必须在有限时间内继续，不能因为一个损坏记录卡住整个应用启动。
 * 超时不能取消操作（files/git ports 没有 AbortSignal），后台仍会继续跑完并写台账。
 * 因此同一 checkout 的在跑清理必须复用：若每次超时都新起一个 cleanupFinalized，
 * 两个读-改-写周期就会在 registry 上交错，丢更新是必然的。
 */
const CHECKOUT_CLEANUP_TIMEOUT_MS = 120_000

/** 同一 checkout 正在进行（含已超时但仍在后台跑）的清理。 */
const cleanupInFlight = new Map<string, Promise<unknown>>()

async function withCleanupTimeout<T>(
  checkoutId: string,
  operation: () => Promise<T>,
): Promise<T | null> {
  let pending = cleanupInFlight.get(checkoutId) as Promise<T> | undefined
  if (pending === undefined) {
    const started = operation()
    pending = started
    cleanupInFlight.set(checkoutId, started)
    // 超时后调用方不再 await 它，失败必须在这里被消费，否则成为 unhandled rejection。
    const settle = (): void => {
      if (cleanupInFlight.get(checkoutId) === started) cleanupInFlight.delete(checkoutId)
    }
    started.then(settle, settle)
  }
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      pending,
      new Promise<null>((resolve) => {
        timeoutHandle = setTimeout(() => {
          console.warn(hostMessage('cleanupTimeout', { p0: checkoutId.slice(0, 8), p1: CHECKOUT_CLEANUP_TIMEOUT_MS }))
          resolve(null)
        }, CHECKOUT_CLEANUP_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
  }
}

/** Local adaptation: best-effort automatic push; failures degrade to a result note. */
async function pushLocalBranchBestEffort(
  push: NonNullable<SessionCheckoutGitPort['pushBranch']>,
  localRoot: string,
): Promise<WorktreePushOutcome> {
  try {
    const result = await push(localRoot)
    if (result.ok) return { status: 'pushed' }
    return { status: 'failed', message: result.message }
  } catch (error) {
    return { status: 'failed', message: error instanceof Error ? error.message : String(error) }
  }
}

function cleanupReasonForMessage(message: string): WorktreeCleanupReason {
  // ponytail: 文本匹配只兜底历史持久化记录（新记录写 delivery.cleanupReason），
  // 写点必须显式传结构化 reason；zh/en 关键词成对匹配。
  if (message.includes('提交后出现了新修改') || message.includes('new changes')) return 'modified_after_finalize'
  if (message.includes('解除注册') || message.includes('目录残余') || message.includes('unregistered') || message.includes('residue')) return 'detached_residue'
  if (message.includes('quarantine')) return 'quarantine_busy'
  if (message.includes('身份') || message.includes('记录') || message.includes('Local index') || message.includes('identity')) return 'identity_changed'
  return 'directory_busy'
}

/**
 * Reason a finalized/retained record's cleanup stopped. Structured field first;
 * legacy records persisted only the prose, so fall back to keyword matching.
 */
function persistedCleanupReason(delivery: {
  cleanupReason?: WorktreeCleanupReason
  cleanupMessage?: string
}): WorktreeCleanupReason | undefined {
  return delivery.cleanupReason ?? (delivery.cleanupMessage ? cleanupReasonForMessage(delivery.cleanupMessage) : undefined)
}

function isTransientCleanupError(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : ''
  const message = error instanceof Error ? error.message : String(error)
  return /^(EBUSY|EPERM|EACCES|ENOTEMPTY)$/i.test(code)
    || /EBUSY|EPERM|EACCES|ENOTEMPTY|being used|access is denied|permission denied/i.test(message)
}

async function retryTransientCleanup<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt <= TRANSIENT_CLEANUP_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (!isTransientCleanupError(error) || attempt === TRANSIENT_CLEANUP_RETRY_DELAYS_MS.length) throw error
      await new Promise((resolve) => setTimeout(resolve, TRANSIENT_CLEANUP_RETRY_DELAYS_MS[attempt] ?? 0))
    }
  }
  throw lastError
}

function retentionExpiresAt(mode: Exclude<WorktreeRetentionMode, 'cleanup'>, retainedAt: number): number | null {
  if (mode === 'retain_24h') return retainedAt + RETENTION_24H_MS
  if (mode === 'retain_3d') return retainedAt + RETENTION_3D_MS
  return null
}

function pathForIdentity(path: string): string {
  try {
    return realpathSync.native(resolve(path)).replace(/\\/g, '/')
  } catch {
    return resolve(path).replace(/\\/g, '/')
  }
}

function pathsEqual(left: string, right: string): boolean {
  const normalizedLeft = pathForIdentity(left)
  const normalizedRight = pathForIdentity(right)
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight
}

/** canonical 路径与 registry 原始路径比较时不得再次 realpath，否则 Junction 会冒充原目录。 */
function resolvedPathsEqual(left: string, right: string): boolean {
  const normalizedLeft = resolve(left).replace(/\\/g, '/')
  const normalizedRight = resolve(right).replace(/\\/g, '/')
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight
}

/**
 * True when `candidate` is `root` itself or nested under it. Mirrors the
 * Session working-directory port's containment rule so the injected guidance and
 * the actual cwd switch never disagree about "inside the Worktree".
 */
function pathIsWithin(candidate: string, root: string): boolean {
  const normalize = (value: string): string => {
    const slashed = resolve(value).replace(/\\/g, '/').replace(/\/+$/, '')
    return process.platform === 'win32' ? slashed.toLowerCase() : slashed
  }
  const normalizedCandidate = normalize(candidate)
  const normalizedRoot = normalize(root)
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`)
}

/** `refs/heads/x` → `x`；其他 ref（含 detached 的 `HEAD`）返回 null。 */
function branchNameOf(ref: string | null | undefined): string | null {
  return ref && ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : null
}

export function createSessionCheckoutModule(
  dependencies: SessionCheckoutDependencies,
): SessionCheckoutModule {
  function requireSession(sessionId: string): SessionCheckoutSessionRecord {
    const session = dependencies.lookup.getSession(sessionId)
    if (!session) throw new SessionCheckoutError('session_not_found', hostMessage('sessionNotFound', { p0: sessionId }))
    return session
  }

  async function resolveSessionProject(sessionId: string): Promise<ResolvedSessionProject> {
    const session = requireSession(sessionId)
    if (!session.projectId) throw new SessionCheckoutError('project_not_found', hostMessage('theSessionIsNotAssociatedWithAProject'))
    const project = dependencies.lookup.getProject(session.projectId)
    if (!project) throw new SessionCheckoutError('project_not_found', hostMessage('projectNotFound', { p0: session.projectId }))
    if (!dependencies.files.exists(project.root)) {
      throw new SessionCheckoutError('project_root_missing', hostMessage('projectRootDirectoryNotFound', { p0: project.name }))
    }
    return { session, project }
  }

  async function inspectLocal(binding: SessionBindingRecord): Promise<SessionTargetView> {
    const project = dependencies.lookup.getProject(binding.projectId)
    if (!project || !dependencies.files.exists(project.root)) return recoveryView(binding)

    const statusPromise = dependencies.git.status(project.root)
    // 仅在快照证明是仓库时才消费；提前挂 noop catch 防未消费的 rejection 冒泡。
    statusPromise.catch(() => undefined)
    const snapshot = await dependencies.git.inspect(project.root)
    const current: SessionTargetCurrentView = snapshot
      ? { branch: snapshot.branch, oid: snapshot.headOid }
      : { branch: null, oid: UNVERSIONED_OID }
    const status = snapshot ? await statusPromise : { dirty: false }
    return {
      project: { id: binding.projectId, name: project.name },
      checkout: {
        id: `local:${binding.projectId}`,
        kind: 'local',
        label: hostMessage('localCheckout'),
        phase: 'ready',
      },
      source: { ref: binding.sourceRef, oid: binding.sourceOid },
      current,
      ownership: binding.inheritedFromSessionId ? 'inherited' : 'owner',
      dirty: status.dirty,
      revision: binding.revision,
    }
  }

  function projectPreviousReview(review: ManagedWorktreeReviewRecord): ManagedWorktreePreviousReviewRecord {
    return {
      reviewId: review.reviewId,
      iteration: review.iteration,
      summary: review.summary,
      suggestedCommitMessage: review.suggestedCommitMessage,
      changedFiles: review.changedFiles.slice(0, 50),
    }
  }

  function projectCheckpoint(checkpoint: ManagedWorktreeCheckpointRecord): WorktreeCheckpointView {
    return {
      checkpointId: checkpoint.checkpointId,
      sequence: checkpoint.sequence,
      reviewId: checkpoint.reviewId,
      createdAt: checkpoint.createdAt,
      summary: checkpoint.summary,
      validationStatus: checkpoint.validationStatus,
      changedFiles: [...checkpoint.changedFiles],
    }
  }

  function projectDelivery(
    record: ManagedCheckoutRecord,
    commitInLocalHistory: boolean | null = null,
  ): SessionTargetView['delivery'] {
    const delivery = record.delivery
    const projectProof = (proof: ManagedDeliveryProof | undefined): WorktreeDeliveryProofView | undefined => proof
      ? {
          localBranch: proof.localBranch,
          localHeadBefore: proof.localHeadBefore,
          localHeadAfter: proof.localHeadAfter,
          changedFiles: [...proof.changedFiles],
          ...(proof.validationStatus === undefined ? {} : { validationStatus: proof.validationStatus }),
          ...(proof.validationSummary === undefined ? {} : { validationSummary: proof.validationSummary }),
          commitInLocalHistory,
        }
      : undefined
    if (delivery.state === 'working') return delivery
    if (delivery.state === 'ready_for_review') return { state: delivery.state, review: delivery.review }
    if (delivery.state === 'preview_active') {
      return { state: delivery.state, review: delivery.review, previewedAt: delivery.preview.previewedAt }
    }
    if (delivery.state === 'preview_detached') {
      return {
        state: delivery.state,
        review: delivery.review,
        previewedAt: delivery.preview.previewedAt,
        detachedAt: delivery.detachedAt,
        reason: delivery.reason,
        attemptedAction: delivery.attemptedAction,
      }
    }
    if (delivery.state === 'finalized') {
      return {
        state: delivery.state,
        review: delivery.review,
        commitOid: delivery.commitOid,
        ...(projectProof(delivery.proof) ? { proof: projectProof(delivery.proof) } : {}),
        cleanup: delivery.cleanup,
        ...(delivery.cleanupMessage ? { cleanupMessage: hostPersistedCleanupMessage(delivery.cleanupMessage, hostMessage) } : {}),
      }
    }
    if (delivery.state === 'retained') {
      return {
        state: delivery.state,
        review: delivery.review,
        commitOid: delivery.commitOid,
        ...(projectProof(delivery.proof) ? { proof: projectProof(delivery.proof) } : {}),
        retention: delivery.retention,
        retainedAt: delivery.retainedAt,
        expiresAt: delivery.expiresAt,
        cleanup: delivery.cleanup,
        ...(delivery.cleanupMessage ? { cleanupMessage: hostPersistedCleanupMessage(delivery.cleanupMessage, hostMessage) } : {}),
      }
    }
    if (delivery.state === 'delivered') {
      const deliveredProof = projectProof(delivery.proof)
      return {
        state: delivery.state,
        iteration: delivery.iteration,
        commitOid: delivery.commitOid,
        deliveredAt: delivery.deliveredAt,
        ...(deliveredProof ? { proof: deliveredProof } : {}),
      }
    }
    return delivery
  }

  function bindingForManagedRecord(record: ManagedCheckoutRecord): SessionBindingRecord {
    const persisted = dependencies.registry.read().sessionBindings[record.ownerSessionId]
    if (persisted?.target.kind === 'isolated' && persisted.target.checkoutId === record.checkoutId) return persisted
    return {
      sessionId: record.ownerSessionId,
      projectId: record.projectId,
      projectName: record.projectName,
      target: { kind: 'isolated', checkoutId: record.checkoutId },
      ownerSessionId: record.ownerSessionId,
      sourceRef: record.sourceRef,
      sourceOid: record.baseOid,
      revision: record.revision,
    }
  }

  function recoveryView(
    binding: SessionBindingRecord,
    record?: ManagedCheckoutRecord,
    dirty = false,
  ): SessionTargetView {
    const phase = record?.phase === 'discarded' ? 'discarded' : 'recovery_required'
    return {
      project: { id: binding.projectId, name: binding.projectName },
      checkout: {
        id: record?.checkoutId ?? (binding.target.kind === 'isolated' ? binding.target.checkoutId : `local:${binding.projectId}`),
        kind: binding.target.kind === 'isolated' ? 'isolated' : 'local',
        label: binding.target.kind === 'isolated' ? hostMessage('isolatedCheckout') : hostMessage('localCheckout'),
        phase,
      },
      source: { ref: binding.sourceRef, oid: binding.sourceOid },
      current: { branch: null, oid: binding.sourceOid },
      ownership: binding.inheritedFromSessionId ? 'inherited' : 'owner',
      dirty,
      revision: record?.revision ?? binding.revision,
      ...(record ? { delivery: projectDelivery(record) } : {}),
      ...((record?.checkpoints?.length ?? 0) > 0 ? { checkpoints: record!.checkpoints!.map(projectCheckpoint) } : {}),
      ...(record && checkpointGenerationForRecord(record) ? { checkpointGeneration: checkpointGenerationForRecord(record) } : {}),
    }
  }

  async function validateCommittedLocalCheckout(
    binding: SessionBindingRecord,
    record: ManagedCheckoutRecord,
  ): Promise<{ canonicalLocalRoot: string; snapshot: GitCheckoutSnapshot } | undefined> {
    if (
      binding.target.kind !== 'isolated'
      || binding.target.checkoutId !== record.checkoutId
      || binding.projectId !== record.projectId
      || binding.ownerSessionId !== record.ownerSessionId
    ) return undefined
    try {
      const project = dependencies.lookup.getProject(record.projectId)
      if (!project || !dependencies.files.exists(project.root) || !dependencies.files.exists(record.localRoot)) return undefined
      const canonicalProjectRoot = await dependencies.files.canonicalize(project.root)
      const canonicalLocalRoot = await dependencies.files.canonicalize(record.localRoot)
      if (!pathsEqual(canonicalProjectRoot, canonicalLocalRoot)) return undefined
      const snapshot = await dependencies.git.inspect(canonicalLocalRoot)
      if (!snapshot || !pathsEqual(snapshot.commonDir, record.gitCommonDir)) return undefined
      return { canonicalLocalRoot, snapshot }
    } catch {
      return undefined
    }
  }

  async function committedFollowupView(
    binding: SessionBindingRecord,
    record: ManagedCheckoutRecord,
  ): Promise<SessionTargetView> {
    if (
      record.delivery.state !== 'finalized'
      && record.delivery.state !== 'retained'
      && record.delivery.state !== 'delivered'
    ) return recoveryView(binding, record, true)
    const local = await validateCommittedLocalCheckout(binding, record)
    if (!local) return recoveryView(binding, record, true)
    const localSnapshot = local.snapshot
    let commitInLocalHistory: boolean | null = null
    if (record.delivery.commitOid) {
      try {
        commitInLocalHistory = await dependencies.git.isAncestor(
          local.canonicalLocalRoot,
          record.delivery.commitOid,
          localSnapshot.headOid,
        )
      } catch {
        commitInLocalHistory = null
      }
    }
    const delivery = projectDelivery(record, commitInLocalHistory)
    if (!delivery || (delivery.state !== 'finalized' && delivery.state !== 'retained' && delivery.state !== 'delivered')) {
      return recoveryView(binding, record, true)
    }
    return {
      project: { id: record.projectId, name: record.projectName },
      checkout: {
        id: record.checkoutId,
        kind: 'isolated',
        label: hostMessage('isolatedCheckout'),
        // Commit 已是权威交付事实；残余环境异常只能影响 cleanup，不能降级整个会话。
        phase: delivery.state === 'retained' ? 'retained' : delivery.state === 'delivered' ? 'discarded' : 'finalized',
      },
      source: { ref: record.sourceRef, oid: record.baseOid },
      current: {
        branch: localSnapshot.branch,
        oid: localSnapshot.headOid,
      },
      ownership: binding.inheritedFromSessionId ? 'inherited' : 'owner',
      dirty: true,
      revision: record.revision,
      delivery,
    }
  }

  function saveCreationEvidence(checkoutId: string, operationId: string, evidence: WorktreeCreationEvidence): void {
    const registry = dependencies.registry.read()
    const record = registry.managedCheckouts[checkoutId]
    if (!record || record.phase !== 'preparing' || record.journal?.operation !== 'create' || record.journal.operationId !== operationId) {
      throw new SessionCheckoutError('stale_target', hostMessage('theSessionTargetHasChangedRefreshAndRetry'))
    }
    record.journal.creation = evidence
    registry.revision += 1
    dependencies.registry.write(registry)
  }

  function finishFailedCreation(sessionId: string, checkoutId: string, error: unknown, previous?: SessionBindingRecord): boolean {
    const registry = dependencies.registry.read()
    const record = registry.managedCheckouts[checkoutId]
    if (!(error instanceof WorktreeCreationFailure)) {
      if (record?.journal?.operation !== 'create' || !record.journal.creation) return false
      error = new WorktreeCreationFailure(error instanceof Error ? error.message : String(error), false)
    }
    const failure = error as WorktreeCreationFailure
    const reported = new SessionCheckoutError(failure.rolledBack ? 'git_operation_failed' : 'recovery_required', failure.message)
    if (!record) throw reported
    if (!failure.rolledBack) {
      markRecoveryRequired(record)
      throw reported
    }
    const binding = registry.sessionBindings[sessionId]
    if (binding?.target.kind === 'isolated' && binding.target.checkoutId === checkoutId) {
      if (previous) registry.sessionBindings[sessionId] = { ...previous, revision: Math.max(previous.revision, binding.revision) + 1 }
      else delete registry.sessionBindings[sessionId]
    }
    delete registry.managedCheckouts[checkoutId]
    registry.revision += 1
    dependencies.registry.write(registry)
    throw reported // A failed checkout is not a reason to silently repeat the entire creation deadline.
  }

  /**
   * An interrupted creation is only unsafe while its residue can still be mistaken for
   * a checkout. Once every path the creation claimed is gone from disk there is no
   * identity to verify and no bytes to protect, so Recover/Discard may close the record.
   * The quarantine path is included because a failed rollback parks the Worktree there.
   */
  function hasCreationResidue(record: ManagedCheckoutRecord): boolean {
    return creationResiduePaths(record).length > 0
  }

  function creationResiduePaths(record: ManagedCheckoutRecord): string[] {
    const creation = record.journal?.operation === 'create' ? record.journal.creation : undefined
    const claimed = [record.managedRoot, record.managedGitRoot, creation?.quarantinePath]
    return claimed.filter((path): path is string => path !== undefined && dependencies.files.exists(path))
  }

  function markRecoveryRequired(record: ManagedCheckoutRecord): ManagedCheckoutRecord {
    if (record.phase === 'recovery_required' || record.phase === 'discarded') return record
    const registry = dependencies.registry.read()
    const current = registry.managedCheckouts[record.checkoutId]
    if (!current) return record
    if (current.revision !== record.revision || current.phase !== record.phase) return current
    const recovered = {
      ...current,
      phase: 'recovery_required' as const,
      revision: current.revision + 1,
    }
    registry.managedCheckouts[record.checkoutId] = recovered
    registry.revision += 1
    dependencies.registry.write(registry)
    return recovered
  }

  interface ValidatedManagedCheckout {
    canonicalManagedRoot: string
    canonicalManagedGitRoot: string
    snapshot: GitCheckoutSnapshot
    status: { dirty: boolean }
    /**
     * The Local checkout observed in the same validation pass.
     *
     * `validateManagedCheckoutDetailed` already inspects `localRoot` to prove
     * both sides share one repository. Carrying that snapshot out lets callers
     * that need the Local branch (the conversation chip after delivery) reuse
     * it instead of paying a second `git rev-parse` for the same directory.
     */
    localSnapshot: GitCheckoutSnapshot
  }

  type ManagedCheckoutValidationResult =
    | { status: 'valid'; checkout: ValidatedManagedCheckout }
    | { status: 'invalid' }
    | { status: 'unavailable' }

  async function checkpointHeadInvariantHolds(
    record: ManagedCheckoutRecord,
    managedRoot: string,
    headOid: string,
  ): Promise<boolean> {
    const checkpoints = record.checkpoints ?? []
    if (checkpoints.length === 0) return true
    const checkpointIds = new Set<string>()
    const reviewIds = new Set<string>()
    for (let index = 0; index < checkpoints.length; index += 1) {
      const checkpoint = checkpoints[index]!
      if (
        checkpoint.sequence !== index + 1
        || checkpointIds.has(checkpoint.checkpointId)
        || reviewIds.has(checkpoint.reviewId)
      ) return false
      checkpointIds.add(checkpoint.checkpointId)
      reviewIds.add(checkpoint.reviewId)
    }
    // 结构校验通过后并行取证（原为循环内 3n+1 次串行 spawn），再按原短路顺序判定。
    const [artifactResults, pairResults] = await Promise.all([
      Promise.all(checkpoints.map(async (checkpoint) =>
        await dependencies.git.readInternalArtifact(record.localRoot, record.checkoutId, `checkpoints/${checkpoint.checkpointId}`) === checkpoint.commitOid)),
      Promise.all(checkpoints.map(async (checkpoint, index) => Promise.all([
        dependencies.git.isAncestor(managedRoot, checkpoint.parentOid, checkpoint.commitOid),
        index > 0 ? dependencies.git.isAncestor(managedRoot, checkpoints[index - 1]!.commitOid, checkpoint.parentOid) : true,
      ]))),
    ])
    for (let index = 0; index < checkpoints.length; index += 1) {
      if (!artifactResults[index]) return false
      if (!pairResults[index]![0]) return false
      if (index > 0 && !pairResults[index]![1]) return false
    }
    return dependencies.git.isAncestor(managedRoot, checkpoints[checkpoints.length - 1]!.commitOid, headOid)
  }

  async function validateManagedCheckoutDetailed(
    binding: SessionBindingRecord,
    record: ManagedCheckoutRecord,
    requireCreateBase: boolean,
  ): Promise<ManagedCheckoutValidationResult> {
    if (
      binding.target.kind !== 'isolated'
      || binding.target.checkoutId !== record.checkoutId
      || binding.projectId !== record.projectId
      || binding.ownerSessionId !== record.ownerSessionId
      || !dependencies.files.exists(record.managedRoot)
    ) return { status: 'invalid' }

    try {
      // 顶部胶囊每 5 秒走一次这条路径：四个 realpath 互不依赖，串行等四趟
      // syscall 只是把延迟堆在一起。
      const project = dependencies.lookup.getProject(record.projectId)
      if (project && !dependencies.files.exists(project.root)) return { status: 'invalid' }
      const [canonicalManagedRoot, canonicalManagedGitRoot, canonicalLocalRoot, canonicalProjectRoot] = await Promise.all([
        dependencies.files.canonicalize(record.managedRoot),
        dependencies.files.canonicalize(record.managedGitRoot),
        dependencies.files.canonicalize(record.localRoot),
        project ? dependencies.files.canonicalize(project.root) : null,
      ])
      if (canonicalProjectRoot !== null && !pathsEqual(canonicalProjectRoot, canonicalLocalRoot)) return { status: 'invalid' }
      const statusPromise = dependencies.git.status(canonicalManagedRoot)
      statusPromise.catch(() => undefined)
      const [snapshot, localSnapshot] = await Promise.all([
        dependencies.git.inspect(canonicalManagedRoot),
        dependencies.git.inspect(canonicalLocalRoot),
      ])
      if (!snapshot || !localSnapshot) return { status: 'invalid' }

      const projectRelativePath = relative(localSnapshot.root, canonicalLocalRoot)
      if (
        projectRelativePath.startsWith('..')
        || isAbsolute(projectRelativePath)
        || !resolvedPathsEqual(canonicalManagedRoot, record.managedRoot)
        || !resolvedPathsEqual(canonicalManagedGitRoot, record.managedGitRoot)
        || !resolvedPathsEqual(canonicalLocalRoot, record.localRoot)
        || !pathsEqual(snapshot.root, canonicalManagedGitRoot)
        || !pathsEqual(snapshot.commonDir, record.gitCommonDir)
        || !pathsEqual(localSnapshot.commonDir, record.gitCommonDir)
        || !pathsEqual(resolve(snapshot.root, projectRelativePath), canonicalManagedRoot)
        || (!requireCreateBase && !pathsEqual(snapshot.gitDir, record.gitDir))
        || (requireCreateBase && snapshot.headOid !== record.baseOid)
        || (!requireCreateBase && !(await checkpointHeadInvariantHolds(record, canonicalManagedRoot, snapshot.headOid)))
      ) return { status: 'invalid' }

      const status = await statusPromise
      return {
        status: 'valid',
        checkout: { canonicalManagedRoot, canonicalManagedGitRoot, snapshot, status, localSnapshot },
      }
    } catch {
      // Git 子进程超时、杀毒软件占用等瞬时 I/O 故障不能永久污染健康 Worktree。
      return { status: 'unavailable' }
    }
  }

  async function validateManagedCheckout(
    binding: SessionBindingRecord,
    record: ManagedCheckoutRecord,
    requireCreateBase: boolean,
  ): Promise<ValidatedManagedCheckout | undefined> {
    const result = await validateManagedCheckoutDetailed(binding, record, requireCreateBase)
    return result.status === 'valid' ? result.checkout : undefined
  }

  interface ValidatedCleanupResidue {
    canonicalManagedGitRoot: string
    directoryIdentity: DirectoryIdentity
  }

  function directoryIdentitiesEqual(left: DirectoryIdentity, right: DirectoryIdentity): boolean {
    return left.device === right.device && left.inode === right.inode && left.birthtimeNs === right.birthtimeNs
  }

  function hasCleanupRemovalReceipt(record: ManagedCheckoutRecord): boolean {
    return record.journal?.operation === 'cleanup'
      && record.journal.step === 'removing_worktree'
      && record.journal.managedDirectoryIdentity !== undefined
  }

  function hasLegacyCleanupResidueEvidence(record: ManagedCheckoutRecord): boolean {
    if (record.journal !== null) return false
    if (record.delivery.state !== 'finalized' && record.delivery.state !== 'retained') return false
    if (record.delivery.cleanup !== 'blocked') return false
    if (record.delivery.cleanupMessageKey !== undefined
      ? record.delivery.cleanupMessageKey !== 'cleanupIdentityChanged'
      : record.delivery.cleanupMessage !== CLEANUP_IDENTITY_CHANGED_MESSAGE) return false
    const checkoutIdentity = record.checkoutId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)
    return checkoutIdentity.length > 0 && basename(record.managedGitRoot).endsWith(`--${checkoutIdentity}`)
  }

  async function validateCleanupLocalIdentity(record: ManagedCheckoutRecord): Promise<GitCheckoutSnapshot | undefined> {
    if (!dependencies.files.exists(record.localRoot)) return undefined
    const project = dependencies.lookup.getProject(record.projectId)
    if (!project || !dependencies.files.exists(project.root)) return undefined
    try {
      const canonicalLocalRoot = await dependencies.files.canonicalize(record.localRoot)
      const canonicalProjectRoot = await dependencies.files.canonicalize(project.root)
      if (!resolvedPathsEqual(canonicalLocalRoot, record.localRoot) || !pathsEqual(canonicalProjectRoot, canonicalLocalRoot)) return undefined
      const localSnapshot = await dependencies.git.inspect(canonicalLocalRoot)
      if (!localSnapshot || !pathsEqual(localSnapshot.commonDir, record.gitCommonDir)) return undefined
      const projectRelativePath = relative(localSnapshot.root, canonicalLocalRoot)
      if (projectRelativePath.startsWith('..') || isAbsolute(projectRelativePath)) return undefined
      return localSnapshot
    } catch {
      return undefined
    }
  }

  async function validateDetachedCleanupResidue(
    record: ManagedCheckoutRecord,
    allowLegacyResidue = false,
  ): Promise<ValidatedCleanupResidue | undefined> {
    if (record.delivery.state !== 'finalized' && record.delivery.state !== 'retained') return undefined
    const receipt = hasCleanupRemovalReceipt(record)
    const legacy = allowLegacyResidue && hasLegacyCleanupResidueEvidence(record)
    if (!receipt && !legacy) return undefined
    if (!dependencies.files.exists(record.managedGitRoot) || dependencies.files.exists(record.gitDir)) return undefined

    try {
      const localSnapshot = await validateCleanupLocalIdentity(record)
      if (!localSnapshot) return undefined
      const canonicalManagedGitRoot = await dependencies.files.canonicalize(record.managedGitRoot)
      if (!resolvedPathsEqual(canonicalManagedGitRoot, record.managedGitRoot)) return undefined

      const projectRelativePath = relative(localSnapshot.root, record.localRoot)
      const expectedManagedRoot = resolve(canonicalManagedGitRoot, projectRelativePath)
      if (!pathsEqual(expectedManagedRoot, record.managedRoot)) return undefined
      if (dependencies.files.exists(record.managedRoot)) {
        const canonicalManagedRoot = await dependencies.files.canonicalize(record.managedRoot)
        if (!resolvedPathsEqual(canonicalManagedRoot, record.managedRoot) || !pathsEqual(canonicalManagedRoot, expectedManagedRoot)) return undefined
      }

      const managedSnapshot = await dependencies.git.inspect(canonicalManagedGitRoot)
      if (managedSnapshot) return undefined
      const containingWorktreeRoot = await dependencies.git.findContainingWorktreeRoot(canonicalManagedGitRoot)
      if (containingWorktreeRoot) return undefined
      const directoryIdentity = await dependencies.files.inspectDirectoryIdentity(canonicalManagedGitRoot)
      if (!directoryIdentity) return undefined
      const expectedIdentity = record.journal?.operation === 'cleanup'
        ? record.journal.managedDirectoryIdentity
        : undefined
      if (expectedIdentity && !directoryIdentitiesEqual(directoryIdentity, expectedIdentity)) return undefined
      return { canonicalManagedGitRoot, directoryIdentity }
    } catch {
      return undefined
    }
  }

  /**
   * 把新建的 Worktree 挂到它自己的会话分支上。
   *
   * 只动 ref 与 HEAD 指向，不碰工作区文件，所以创建路径原有的一整套身份校验
   * （read-tree/checkout-index/证据回滚）都照旧生效。候选名逐个尝试，重名时
   * 用 `-2`、`-3`… 兜底；端口未提供 `attachWorktreeBranch` 时保持旧的
   * detached HEAD 行为并给出警告。
   */
  async function attachSessionBranch(input: {
    localRoot: string
    managedRoot: string
    sessionId: string
    topic: string | null | undefined
  }): Promise<{ branch: string; branchRef: string } | null> {
    const attach = dependencies.git.attachWorktreeBranch
    if (!attach) {
      console.warn(hostMessage('theSessionBranchCouldNotBeAttachedFallingBackTo'))
      return null
    }
    const headOid = (await dependencies.git.inspect(input.managedRoot))?.headOid
    if (!headOid) return null
    const isAncestor = dependencies.git.isAncestor
    for (const branch of createSessionBranchCandidates({ sessionId: input.sessionId, topic: input.topic })) {
      const branchRef = `refs/heads/${branch}`
      const existing = await dependencies.git.resolveLocalBranchTip(input.localRoot, branch)
      if (existing !== null) {
        // 同名分支已存在：只有「它正指着当前 HEAD」或「它是当前 HEAD 的祖先
        // （可以快进）」时才复用。别的情况下它带着别的提交，绝不覆盖——换下一个候选名。
        const reusable = existing === headOid
          || (isAncestor ? await isAncestor(input.localRoot, existing, headOid) : false)
        if (!reusable) continue
        try {
          await attach(input.managedRoot, branchRef, headOid, existing)
        } catch {
          continue
        }
        const verified = await dependencies.git.inspect(input.managedRoot)
        if (verified?.headRef === branchRef) return { branch, branchRef }
        continue
      }
      try {
        await attach(input.managedRoot, branchRef, headOid, null)
      } catch {
        continue
      }
      const verified = await dependencies.git.inspect(input.managedRoot)
      if (verified?.headRef === branchRef) return { branch, branchRef }
    }
    return null
  }

  type EnsureSessionBranchResult =
    | { ok: true; record: ManagedCheckoutRecord }
    | { ok: false; code: SessionCheckoutErrorCode; message: string }

  /**
   * 交付前保证 Worktree 挂在自己的会话分支上。
   *
   * 历史记录（旧版本创建）是 detached HEAD、且 `sourceRef` 记的是 Local 当时
   * 所在的分支——那可能就是**别的会话**的分支，绝不能作为交付目标。这里改用
   * 独立的会话分支：Worktree 当前 HEAD 就是它的起点，至于那条记录里的
   * `sourceRef`，从此只当作「分叉来源」展示。
   */
  async function ensureSessionBranch(record: ManagedCheckoutRecord): Promise<EnsureSessionBranchResult> {
    const attach = dependencies.git.attachWorktreeBranch
    if (!attach) {
      // 端口没实现挂分支时不能把交付整个堵死：退回「在 Worktree 当前 HEAD 上
      // 提交」的旧行为，并明确告知分支归属信息缺失。生产 adapter 已实现该端口。
      console.warn(hostMessage('theSessionBranchCouldNotBeAttachedFallingBackTo'))
      return { ok: true, record }
    }
    const current = await dependencies.git.inspect(record.managedRoot)
    if (!current) {
      return { ok: false, code: 'recovery_required', message: hostMessage('theIsolatedCheckoutIdentityCannotBeVerifiedRecoveryIs') }
    }
    const recorded = record.sessionBranch
    if (recorded && current.headRef === recorded) {
      return { ok: true, record }
    }
    if (recorded) {
      // 记录里已有会话分支，但 Worktree 离开了它（例如 checkpoint 会把 HEAD
      // 写成游离提交）：先按记录值把分支快进到当前 HEAD，再重新检出。
      try {
        await attach(record.managedRoot, recorded, current.headOid, null)
        const replaced = await dependencies.git.inspect(record.managedRoot)
        if (replaced?.headRef === recorded) {
          return { ok: true, record: updateManagedCheckout(record.checkoutId, (value) => ({ ...value, revision: value.revision + 1 })) ?? record }
        }
      } catch {
        // 分支已被推进到别处：退回「另建一条会话分支」，绝不覆盖别人的提交。
      }
    }
    const attached = await attachSessionBranch({
      localRoot: record.localRoot,
      managedRoot: record.managedRoot,
      sessionId: record.ownerSessionId,
      // 优先用记录里保存的主题：adopt 出来的分支名必须与创建时一致，否则
      // 用项目名会得到另一条分支，看起来像「换了归属」。
      topic: record.sessionTopic ?? record.projectName,
    })
    if (!attached) {
      return { ok: false, code: 'git_operation_failed', message: hostMessage('theSessionBranchCouldNotBeAttachedToTheWorktree') }
    }
    const updated = updateManagedCheckout(record.checkoutId, (value) => ({
      ...value,
      sessionBranch: attached.branchRef,
      sourceRef: attached.branchRef,
      revision: value.revision + 1,
    }))
    if (!updated) {
      return { ok: false, code: 'checkout_missing', message: hostMessage('theIsolatedCheckoutRecordDoesNotExist') }
    }
    return { ok: true, record: updated }
  }

  async function validateCleanupQuarantine(record: ManagedCheckoutRecord): Promise<string | undefined> {
    const journal = record.journal?.operation === 'cleanup' ? record.journal : undefined
    const quarantinePath = journal?.cleanupQuarantinePath
    const expectedIdentity = journal?.managedDirectoryIdentity
    if (!quarantinePath || !expectedIdentity || !dependencies.files.exists(quarantinePath)) return undefined
    const expectedName = `.dsh-wt-cleanup--${record.checkoutId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)}--${journal.operationId}`
    if (!resolvedPathsEqual(dirname(quarantinePath), dirname(record.managedGitRoot)) || basename(quarantinePath) !== expectedName) return undefined
    try {
      if (!await validateCleanupLocalIdentity(record)) return undefined
      const canonicalQuarantinePath = await dependencies.files.canonicalize(quarantinePath)
      if (!resolvedPathsEqual(canonicalQuarantinePath, quarantinePath)) return undefined
      const identity = await dependencies.files.inspectDirectoryIdentity(canonicalQuarantinePath)
      if (!identity || !directoryIdentitiesEqual(identity, expectedIdentity)) return undefined
      return canonicalQuarantinePath
    } catch {
      return undefined
    }
  }

  async function inspectIsolated(binding: SessionBindingRecord, persistRecovery = true): Promise<SessionTargetView> {
    if (binding.target.kind !== 'isolated') return recoveryView(binding)
    const registry = dependencies.registry.read()
    let record = registry.managedCheckouts[binding.target.checkoutId]
    if (!record) return recoveryView(binding)
    if (
      record.projectId !== binding.projectId
      || record.ownerSessionId !== binding.ownerSessionId
    ) {
      if (persistRecovery) record = markRecoveryRequired(record)
      return recoveryView(binding, record)
    }
    if (record.phase === 'discarded') {
      if (record.delivery.state === 'delivered') return committedFollowupView(binding, record)
      return {
        ...recoveryView(binding, record),
        checkout: {
          id: record.checkoutId,
          kind: 'isolated',
          label: hostMessage('isolatedCheckout'),
          phase: 'discarded',
        },
      }
    }

    let prefetchedValidation: ValidatedManagedCheckout | undefined
    if (
      record.phase === 'recovery_required'
      && record.journal === null
      && dependencies.files.exists(record.managedRoot)
    ) {
      const recoveryValidation = await validateManagedCheckoutDetailed(binding, record, false)
      if (recoveryValidation.status === 'valid' && persistRecovery) {
        const restored = updateManagedCheckout(record.checkoutId, (current) => ({
          ...current,
          managedRoot: recoveryValidation.checkout.canonicalManagedRoot,
          managedGitRoot: recoveryValidation.checkout.canonicalManagedGitRoot,
          gitDir: recoveryValidation.checkout.snapshot.gitDir,
          phase: 'ready',
          revision: current.revision + 1,
        }))
        if (restored) {
          record = restored
          prefetchedValidation = recoveryValidation.checkout
        }
      }
    }

    if ((record.phase !== 'ready' && record.phase !== 'finalized' && record.phase !== 'retained') || !dependencies.files.exists(record.managedRoot)) {
      if (record.delivery.state === 'finalized' || record.delivery.state === 'retained') {
        return committedFollowupView(binding, record)
      }
      if (persistRecovery) record = markRecoveryRequired(record)
      let dirty = false
      if (dependencies.files.exists(record.managedRoot)) {
        try {
          dirty = (await dependencies.git.status(record.managedRoot)).dirty
        } catch {
          dirty = true
        }
      }
      return recoveryView(binding, record, dirty)
    }

    const validation = prefetchedValidation
      ? { status: 'valid' as const, checkout: prefetchedValidation }
      : await validateManagedCheckoutDetailed(binding, record, false)
    if (validation.status !== 'valid') {
      if (record.delivery.state === 'finalized' || record.delivery.state === 'retained') {
        return committedFollowupView(binding, record)
      }
      // 只有确定的身份/路径不匹配才持久进入 recovery；瞬时 Git/I/O 故障允许下一次 inspect 直接重试。
      if (persistRecovery && validation.status === 'invalid') record = markRecoveryRequired(record)
      return recoveryView(binding, record)
    }
    const { snapshot, status } = validation.checkout
    const delivery = projectDelivery(record)
    const activePreview = delivery?.state === 'ready_for_review'
      ? Object.values(registry.managedCheckouts).find((candidate) => (
          candidate.checkoutId !== record.checkoutId
          && candidate.phase !== 'discarded'
          && pathsEqual(candidate.localRoot, record.localRoot)
          && holdsProjectAcceptanceSlot(candidate)
        ))
      : undefined
    return {
      project: { id: record.projectId, name: record.projectName },
      checkout: {
        id: record.checkoutId,
        kind: 'isolated',
        label: hostMessage('isolatedCheckout'),
        phase: record.phase,
      },
      source: { ref: record.sourceRef, oid: record.baseOid },
      current: { branch: snapshot.branch, oid: snapshot.headOid },
      ownership: binding.inheritedFromSessionId ? 'inherited' : 'owner',
      dirty: status.dirty,
      revision: record.revision,
      delivery,
      ...((record.checkpoints?.length ?? 0) > 0 ? { checkpoints: record.checkpoints!.map(projectCheckpoint) } : {}),
      ...(checkpointGenerationForRecord(record) ? { checkpointGeneration: checkpointGenerationForRecord(record) } : {}),
      ...(delivery?.state === 'ready_for_review'
        ? {
            reviewSlot: activePreview ? 'waiting' as const : 'available' as const,
            ...(activePreview ? { reviewSlotOwnerSessionId: activePreview.ownerSessionId } : {}),
          }
        : {}),
    }
  }

  function getPersistedBinding(sessionId: string): SessionBindingRecord | undefined {
    return dependencies.registry.read().sessionBindings[sessionId]
  }

  function runtimeContext(sessionId: string, cwd?: string): string {
    const registry = dependencies.registry.read()
    const binding = registry.sessionBindings[sessionId]
    if (!binding) return ''
    if (binding.target.kind === 'local') {
      const projectPreview = Object.values(registry.managedCheckouts)
        .filter((record) => record.projectId === binding.projectId && record.phase !== 'discarded')
        .filter((record) => record.delivery.state === 'preview_active'
          || record.delivery.state === 'preview_detached')
        .sort((left, right) => managedUpdatedAt(right) - managedUpdatedAt(left))[0]
      const pending = projectPreview ?? Object.values(registry.managedCheckouts)
        .filter((record) => record.sourceSessionId === sessionId && record.phase !== 'discarded')
        .filter((record) => record.delivery.state === 'working'
          || record.delivery.state === 'ready_for_review'
          || record.delivery.state === 'preview_active'
          || record.delivery.state === 'preview_detached'
          || record.phase === 'preparing'
          || record.phase === 'mutating'
          || record.phase === 'recovery_required')
        .sort((left, right) => managedUpdatedAt(right) - managedUpdatedAt(left))[0]
      if (!pending) {
        return [
          'Session Target: Local Checkout. No isolated target is active for this Session.',
          'Complete ordinary Local work in the current cwd and finish with an ordinary assistant reply.',
          'Do not call Worktree-only tools such as worktree_deliver, worktree_cleanup, or worktree_begin_next_iteration unless this Session first selects an Isolated Checkout.',
        ].join('\n')
      }
      if (pending.delivery.state === 'preview_active') {
        return [
          'Session Target: Local Checkout (Worktree Preview active).',
          `Managed checkout ${pending.checkoutId} has a reversible Preview in this Local boundary.`,
          'Do not modify project files or run repository-changing commands. Only the user may accept, rollback, or discard the Preview through the Worktree acceptance UI.',
        ].join('\n')
      }
      if (pending.delivery.state === 'preview_detached') {
        return [
          'Session Target: Local Checkout (Worktree Preview recovery required).',
          `Managed checkout ${pending.checkoutId} still has preserved Preview recovery evidence.`,
          'Do not modify project files or attempt automatic cleanup. The user must retry rollback; the Worktree stays preserved until rollback succeeds.',
        ].join('\n')
      }
      // An in-place creation binds the checkout to this very Session, so a
      // pending record owned by it is a resumable state, not a handoff: the
      // cwd is already inside (or can be re-entered), no second Session exists.
      if (pending.ownerSessionId !== sessionId) {
        return [
          'Session Target: Local Checkout (handoff pending).',
          `Managed checkout ${pending.checkoutId} is reserved for Session ${pending.ownerSessionId}.`,
          'Stop code modifications in this Local Session. Ask the user to open the isolated Session from the Worktree card.',
        ].join('\n')
      }
      return [
        'Session Target: Local Checkout (this Session owns an isolated checkout).',
        `Managed checkout ${pending.checkoutId} belongs to this Session (delivery state: ${pending.delivery.state}, phase: ${pending.phase}).`,
        'Do not create a second worktree. Work in that checkout: file writes MUST use absolute paths under its managed root until this Session cwd points there again.',
      ].join('\n')
    }
    if (binding.target.kind !== 'isolated') return 'Session Target is unselected. Do not mutate project files until a target is chosen.'
    const record = registry.managedCheckouts[binding.target.checkoutId]
    if (!record) return 'Session Target: Isolated Checkout record missing. Stop mutations and request recovery.'
    if (record.phase === 'recovery_required') {
      return `Session Target: Isolated Checkout ${record.checkoutId} requires recovery. Do not modify Local or clean up automatically.`
    }
    // Delivered and cleaned: the managed root is gone and the Session is back at
    // the Local boundary. Say that plainly — claiming a deleted directory is the
    // authoritative cwd (while the write-guard blocks Local) locks the Session
    // out of every write until the user starts a next iteration.
    if (record.phase === 'discarded' && record.delivery.state === 'delivered') {
      return [
        `Session Target: Local Checkout (the previous Worktree ${record.checkoutId} was delivered and cleaned).`,
        `Original Local boundary (now the working boundary again): ${record.localRoot}`,
        'Ordinary Local work is allowed again in this Session.',
        'If the user requests new code or file changes, call worktree_begin_next_iteration first; it safely recreates this Session immutable cwd for the next iteration. Do not call worktree_create.',
      ].join('\n')
    }
    // Delivered but the runtime is still preserved (retention) or awaiting
    // cleanup: the task commit already lives on the session branch and Local was
    // never written, yet the Session cwd is back at the Local boundary. Saying
    // "Isolated Checkout + write-guard blocks Local" here produced the
    // self-contradictory state a user could not finish from; state the real
    // boundary instead, and keep the cleanup/recovery wording separate.
    if (
      (record.delivery.state === 'finalized' || record.delivery.state === 'retained')
      && (!cwd || !pathIsWithin(cwd, record.managedRoot))
    ) {
      const deliveredBranch = record.sessionBranch
        ? `Task commit is on session branch ${branchNameOf(record.sessionBranch) ?? record.sessionBranch}.`
        : 'The task commit is already stored; no session branch was recorded for this legacy Worktree.'
      return [
        `Session Target: Local Checkout (this Session's Worktree ${record.checkoutId} is already delivered).`,
        `Working boundary: ${record.localRoot}`,
        'Ordinary Local work is allowed again in this Session: the delivery did not write Local, so finish Local-side chores (baseline refresh, changelog, follow-up edits) normally.',
        deliveredBranch,
        'The preserved Worktree is frozen for rollback and cleanup only; do not edit it. Merge the session branch into Local with worktree_merge, and remove the frozen runtime with worktree_cleanup.',
        'If the user requests new code or file changes, call worktree_begin_next_iteration first to recreate this Session immutable cwd. Do not call worktree_create.',
      ].join('\n')
    }
    const lines = [
      `Session Target: Isolated Checkout ${record.checkoutId}.`,
      `Authoritative cwd: ${record.managedRoot}`,
      `Original Local boundary: ${record.localRoot}`,
      'Make task changes only in the authoritative cwd; never write directly to the Original Local boundary.',
    ]
    // The authoritative cwd is normally the Session's live working directory
    // (worktree_create enters the checkout through ctx.workingDirectory.set,
    // mirroring the official create_worktree tool). Only when the host lacks
    // that service, or the cwd was moved away afterwards, does the Session still
    // stand in the Original Local boundary and needs the absolute-path rule.
    // Containment, not equality: the Session routinely `cd`s into a
    // subdirectory, which is still working inside the Worktree.
    const insideWorktree = typeof cwd === 'string' && pathIsWithin(cwd, record.managedRoot)
    if (!insideWorktree) {
      lines.push(
        'In-place binding: this Session cwd does not currently point at the Authoritative cwd. All task file writes MUST use absolute paths under the Authoritative cwd above; the worktree-write-guard hook will block any write that lands in the Original Local boundary.',
      )
    }
    lines.push('Official Worktree tools: the host-experimental create_worktree tool (if enabled) creates unmanaged .agents/worktrees copies and is unrelated to this managed checkout. All isolated delivery, review, and cleanup for this Session goes through the worktree_* tools only; never deliver or merge through create_worktree output.')
    if ((record.checkpoints?.length ?? 0) > 0) {
      lines.push(
        `Saved Worktree checkpoints: ${record.checkpoints!.length}. They remain unpublished to Local.`,
        'Final review and commit wording must summarize the cumulative diff from the original delivery base to the final Worktree snapshot. Do not manually reset, rewrite, or publish checkpoint commits.',
      )
    }
    if (record.delivery.state === 'ready_for_review') {
      lines.push('Delivery state: Ready for Review, not yet synchronized to Local. Continue ordinary discussion and answer questions without changing this Review. If the user requests new code or file changes, tell them to deliver first through the capsule menu ("Deliver to the session branch"); this build ships no tool that resumes a frozen Review in place, so do not call one and do not synchronize Local yourself. Until it is delivered, treat the Worktree as read-only.')
    } else if (record.delivery.state === 'preview_active') {
      lines.push('Delivery state: Local Preview active. The model must remain read-only; only the user may accept and commit, rollback, or discard through the Worktree acceptance UI.')
    } else if (record.delivery.state === 'preview_detached') {
      lines.push('Delivery state: Preview detached after Local drift. Do not mutate Local or the Worktree; the user must retry rollback, and Discard remains blocked until recovery succeeds.')
    } else if (record.delivery.state === 'working') {
      lines.push((liveConfigValue(dependencies.autoDeliver) ?? true)
        ? 'Delivery state: Working. When implementation and validation are complete, call worktree_deliver as the final model tool: put the complete report only in its report parameter (commitMessage carries the commit wording). It commits the Worktree snapshot on this Session own branch; Local working tree, index and HEAD are never touched, so merging into Local is a separate, explicit step (worktree_merge). Do not duplicate that report in ordinary assistant prose.'
        : 'Delivery state: Working. autoDeliver is off, so the model must not call worktree_deliver. When implementation and validation are complete, put the complete report in your ordinary reply and stop; the user delivers through the capsule menu ("Deliver to the session branch"). Do not call any tool to hand the work over.')
    } else if (record.delivery.state === 'delivered') {
      lines.push('Delivery state: Delivered and cleaned. This Session own branch holds the commit; Local was never written, so merge it with worktree_merge. If the user requests new code or file changes in this conversation, call worktree_begin_next_iteration first; it safely recreates this Session immutable cwd for the next iteration. Do not call worktree_create.')
    } else if (record.delivery.state === 'retained') {
      lines.push('Delivery state: Retained. The commit is on the Session own branch and Local was never written. This frozen environment must be cleaned through the user controls before a next iteration can start; merge first with worktree_merge, then worktree_cleanup.')
    } else {
      lines.push(`Delivery state: ${record.delivery.state}. Treat this Session as terminal until cleanup or recovery completes.`)
    }
    return lines.join('\n')
  }

  async function resolveBinding(sessionId: string): Promise<SessionBindingRecord> {
    const session = requireSession(sessionId)
    const persisted = getPersistedBinding(sessionId)
    if (persisted) {
      if (session.projectId !== persisted.projectId) {
        const record = persisted.target.kind === 'isolated'
          ? dependencies.registry.read().managedCheckouts[persisted.target.checkoutId]
          : undefined
        const workspace = session.projectId ? dependencies.lookup.getProject(session.projectId) : undefined
        let isolatedWorkspaceMatches = Boolean(
          record
          && workspace
          && record.phase === 'discarded'
          && record.delivery.state === 'delivered'
          && !dependencies.files.exists(workspace.root)
          && resolvedPathsEqual(workspace.root, record.managedRoot),
        )
        if (!isolatedWorkspaceMatches && record && workspace && dependencies.files.exists(workspace.root)) {
          try {
            const workspaceRoot = await dependencies.files.canonicalize(workspace.root)
            isolatedWorkspaceMatches = pathsEqual(workspaceRoot, record.managedRoot)
          } catch {
            isolatedWorkspaceMatches = false
          }
        }
        if (!isolatedWorkspaceMatches) {
          throw new SessionCheckoutError(
            'project_mismatch',
            hostMessage('theSessionWorkspaceNoLongerMatchesItsBoundSession'),
          )
        }
      }
      return persisted
    }
    throw new SessionCheckoutError('target_unselected', hostMessage('theSessionHasNotSelectedASessionTarget'))
  }

  type BindingOperationMode = 'exclusive' | 'maintenance' | 'maintenance_draining'

  let bindingQueue: Promise<void> = Promise.resolve()
  let activeBindingOperation: BindingOperationMode | null = null
  let activeBindingOperationDone: Promise<void> = Promise.resolve()
  let pendingMaintenanceOperations = 0
  let maintenanceReady: Promise<void> | undefined
  let signalMaintenanceReady = (): void => undefined
  let activeMaintenanceInspects = 0
  let maintenanceInspectsDrained: Promise<void> = Promise.resolve()
  let signalMaintenanceInspectsDrained = (): void => undefined

  function prepareMaintenanceReadySignal(): void {
    maintenanceReady = new Promise<void>((resolveReady) => { signalMaintenanceReady = resolveReady })
  }

  function beginMaintenanceInspect(): void {
    if (activeMaintenanceInspects === 0) {
      maintenanceInspectsDrained = new Promise<void>((resolveDrained) => {
        signalMaintenanceInspectsDrained = resolveDrained
      })
    }
    activeMaintenanceInspects += 1
  }

  function finishMaintenanceInspect(): void {
    activeMaintenanceInspects -= 1
    if (activeMaintenanceInspects === 0) signalMaintenanceInspectsDrained()
  }

  async function withBindingLock<T>(
    operation: () => Promise<T>,
    options: { allowConcurrentInspect?: boolean } = {},
  ): Promise<T> {
    const maintenance = options.allowConcurrentInspect === true
    if (maintenance) {
      pendingMaintenanceOperations += 1
      if (pendingMaintenanceOperations === 1) prepareMaintenanceReadySignal()
    }

    const previous = bindingQueue
    let release = (): void => undefined
    bindingQueue = new Promise<void>((resolveLock) => { release = resolveLock })
    await previous.catch(() => undefined)

    let signalOperationDone = (): void => undefined
    activeBindingOperationDone = new Promise<void>((resolveDone) => { signalOperationDone = resolveDone })
    activeBindingOperation = maintenance ? 'maintenance' : 'exclusive'
    if (maintenance) signalMaintenanceReady()

    try {
      return await operation()
    } finally {
      if (maintenance) {
        // 先关闭新的只读旁路，再等待已启动 inspect 结束，之后 mutation 才能接管队列。
        activeBindingOperation = 'maintenance_draining'
        if (activeMaintenanceInspects > 0) await maintenanceInspectsDrained
        pendingMaintenanceOperations -= 1
        if (pendingMaintenanceOperations > 0) prepareMaintenanceReadySignal()
        else maintenanceReady = undefined
      }
      activeBindingOperation = null
      signalOperationDone()
      release()
    }
  }

  async function inspectTarget(sessionId: string, persistRecovery = true): Promise<SessionTargetView> {
    const binding = await resolveBinding(sessionId)
    if (binding.target.kind === 'local') return inspectLocal(binding)
    return inspectIsolated(binding, persistRecovery)
  }

  async function inspectDuringMaintenance(sessionId: string): Promise<SessionTargetView> {
    if (activeBindingOperation !== 'maintenance') return inspectAvailable(sessionId)
    beginMaintenanceInspect()
    try {
      // 后台 reconcile/retention cleanup 可能因 Windows 文件占用持续数十秒。
      // 此时 inspect 只读取权威快照，不写 registry，避免一个历史 Worktree 阻塞所有会话。
      return await inspectTarget(sessionId, false)
    } finally {
      finishMaintenanceInspect()
    }
  }

  async function inspectAvailable(sessionId: string): Promise<SessionTargetView> {
    while (true) {
      if (activeBindingOperation === 'maintenance') return inspectDuringMaintenance(sessionId)
      if (activeBindingOperation === 'maintenance_draining') {
        const operationDone = activeBindingOperationDone
        await operationDone.catch(() => undefined)
        continue
      }
      if (pendingMaintenanceOperations > 0 && maintenanceReady) {
        // maintenance 可能排在当前交互操作之后；等它真正取得锁后再走只读旁路，
        // 避免 inspect 被预先排到 maintenance 后面，也避免与当前交互 mutation 并发。
        await maintenanceReady
        continue
      }
      return withBindingLock(() => inspectTarget(sessionId, true))
    }
  }

  async function reconcile(): Promise<SessionCheckoutReconcileSummary> {
    const registry = dependencies.registry.read()
    const recoveryRequiredCheckoutIds: string[] = []
    const orphanedCheckoutIds: string[] = []
    const dirtyOrphanedCheckoutIds: string[] = []
    const staleRootCheckoutIds: string[] = []
    const finalizedCheckoutIds: string[] = []
    // 空掉的已交付记录不能在本轮循环里立刻删：同一次遍历中，后续「创建中断」
    // 记录要读它的 predecessor 决定是否恢复 binding，删早了那条分支就永远走不通。
    const emptyDiscardedCheckoutIds: string[] = []
    let changed = false

    for (const [checkoutId, current] of Object.entries(registry.managedCheckouts)) {
      if (current.phase === 'discarded') {
        // 本地适配：交付/放弃时 owner 会话可能仍开着，宿主会重建已删 worktree
        // 的空壳 cwd。空壳无用户字节，reconcile 时顺手清掉并回收空容器。
        // 交付记录是台账，不是日志：它一旦不再指向任何磁盘内容，就没有第二个人
        // 会来删它。留着只会让台账无限增长，并让同 topic 的新建继续撞上已被
        // 放弃的旧路径。只有路径彻底空掉（或压根不存在）时才删记录，避免把
        // 还有内容的目录从账上抹掉。
        if (
          !dependencies.files.exists(current.managedRoot)
          && !dependencies.files.exists(current.managedGitRoot)
        ) {
          emptyDiscardedCheckoutIds.push(checkoutId)
        }
        continue
      }
      if (
        current.predecessorCheckoutId
        && current.journal?.operation === 'create'
        && !current.journal.creation
        && (current.phase === 'preparing' || current.phase === 'recovery_required')
        && !dependencies.files.exists(current.managedGitRoot)
        && !dependencies.files.exists(current.managedRoot)
      ) {
        const predecessor = registry.managedCheckouts[current.predecessorCheckoutId]
        const binding = registry.sessionBindings[current.ownerSessionId]
        if (
          predecessor?.phase === 'discarded'
          && predecessor.delivery.state === 'delivered'
          && binding?.target.kind === 'isolated'
          && binding.target.checkoutId === current.checkoutId
        ) {
          delete registry.managedCheckouts[checkoutId]
          registry.sessionBindings[current.ownerSessionId] = {
            ...binding,
            target: { kind: 'isolated', checkoutId: predecessor.checkoutId },
            sourceRef: predecessor.sourceRef,
            sourceOid: predecessor.baseOid,
            revision: binding.revision + 1,
          }
          registry.revision += 1
          changed = true
          continue
        }
      }
      let record = current
      if (current.delivery.state === 'finalized') {
        // 兼容旧版本曾把 cleanup 残余错误持久化为 recovery_required；Commit 事实优先，继续收口资源即可。
        finalizedCheckoutIds.push(checkoutId)
        continue
      }
      if (
        current.phase === 'mutating'
        && current.journal?.operation === 'finish'
        && current.journal.step === 'committing_session_branch'
      ) {
        // 提交可能已经写进会话分支才失败。退还就绪态而不是判定 recovery_required：
        // 提交是否真的落地由下一次交付按 tree 比较得出（相同则不新建提交），
        // 因此退回就绪态既不会重复提交，也不会把记录永久卡在恢复态。
        record = { ...current, phase: 'ready', journal: null, revision: current.revision + 1 }
        registry.managedCheckouts[checkoutId] = record
        registry.revision += 1
        changed = true
        continue
      }
      if (
        current.phase === 'mutating'
        && (current.journal?.operation === 'finalize_preview' || current.journal?.operation === 'finish')
        && (current.journal.step === 'updating_ref' || current.journal.step === 'replacing_index')
      ) {
        // HEAD/ref alone cannot prove that the adjacent index replacement and working-tree preservation completed.
        // Preserve delivery, receipt, retained artifacts and journal until an explicit recovery path can verify all facts.
        record = {
          ...current,
          phase: 'recovery_required',
          revision: current.revision + 1,
        }
        registry.managedCheckouts[checkoutId] = record
        registry.revision += 1
        recoveryRequiredCheckoutIds.push(checkoutId)
        changed = true
      } else if (
        (current.phase === 'mutating' || current.phase === 'recovery_required')
        && current.journal?.operation === 'checkpoint'
        && current.delivery.state === 'ready_for_review'
      ) {
        const journal = current.journal
        if (journal.step === 'planning') {
          record = { ...current, phase: 'ready', journal: null, revision: current.revision + 1 }
        } else if (
          journal.step === 'updating_ref'
          && typeof journal.commitOid === 'string'
          && typeof journal.parentOid === 'string'
          && typeof journal.checkpointId === 'string'
          && typeof journal.checkpointSequence === 'number'
          && typeof journal.checkpointRequestId === 'string'
          && typeof journal.checkpointRequestedRevision === 'number'
          && typeof journal.recoveryGeneration === 'string'
          && typeof journal.checkpointMessage === 'string'
          && typeof journal.checkpointIndexTreeOid === 'string'
          && Array.isArray(journal.changedFiles)
        ) {
          const recovered = await dependencies.applyEngine.recoverCheckpoint({
            isolatedPath: current.managedRoot,
            commitOid: journal.commitOid,
            parentOid: journal.parentOid,
            expectedIndexTreeOid: journal.checkpointIndexTreeOid,
          })
          if (recovered.status === 'checkpoint_aborted') {
            try {
              await dependencies.git.releaseInternalArtifacts(current.localRoot, current.checkoutId, `checkpoints/${journal.checkpointId}`)
            } catch {
              console.warn(hostMessage('checkpointRefCleanupFailed'))
            }
            record = { ...current, phase: 'ready', journal: null, revision: current.revision + 1 }
          } else if (recovered.status === 'checkpoint_recovered') {
            const retained = await dependencies.git.readInternalArtifact(current.localRoot, current.checkoutId, `checkpoints/${journal.checkpointId}`)
            if (retained !== journal.commitOid) {
              record = { ...current, phase: 'recovery_required', revision: current.revision + 1 }
              recoveryRequiredCheckoutIds.push(checkoutId)
            } else {
              const review = current.delivery.review
              const checkpoint: ManagedWorktreeCheckpointRecord = {
                checkpointId: journal.checkpointId,
                sequence: journal.checkpointSequence,
                reviewId: review.reviewId,
                requestId: journal.checkpointRequestId,
                requestedRevision: journal.checkpointRequestedRevision,
                generation: journal.recoveryGeneration,
                iteration: review.iteration,
                createdAt: journal.startedAt,
                commitOid: journal.commitOid,
                parentOid: journal.parentOid,
                summary: review.summary,
                commitMessage: journal.checkpointMessage,
                validationStatus: review.validationStatus,
                changedFiles: [...journal.changedFiles],
              }
              record = {
                ...current,
                phase: 'ready',
                previousReview: projectPreviousReview(review),
                checkpoints: [...(current.checkpoints ?? []), checkpoint],
                delivery: { state: 'working', iteration: review.iteration },
                recoveryContinuation: undefined,
                journal: null,
                revision: current.revision + 1,
              }
            }
          } else {
            record = { ...current, phase: 'recovery_required', revision: current.revision + 1 }
            recoveryRequiredCheckoutIds.push(checkoutId)
          }
        } else {
          record = { ...current, phase: 'recovery_required', revision: current.revision + 1 }
          recoveryRequiredCheckoutIds.push(checkoutId)
        }
        registry.managedCheckouts[checkoutId] = record
        registry.revision += 1
        changed = true
      } else if (
        current.phase === 'mutating'
        && current.journal?.operation === 'preview'
        && (
          current.journal.step === 'planning'
          || (current.journal.step === 'writing_local' && current.delivery.state === 'ready_for_review')
        )
      ) {
        // Preview receipt 尚未保留，apply patch 也尚未执行；可证明 Local 未被触碰。
        record = {
          ...current,
          phase: 'ready',
          journal: null,
          revision: current.revision + 1,
        }
        registry.managedCheckouts[checkoutId] = record
        registry.revision += 1
        changed = true
      } else if (
        current.phase === 'mutating'
        && (current.journal?.operation === 'finalize_preview' || current.journal?.operation === 'finish')
        && current.journal.step === 'planning'
      ) {
        // Finalize 的 branch/index 写入发生在 updating_ref 之后；planning 中断可安全重试。
        record = {
          ...current,
          phase: 'ready',
          journal: null,
          revision: current.revision + 1,
        }
        registry.managedCheckouts[checkoutId] = record
        registry.revision += 1
        changed = true
      } else if (
        current.phase === 'mutating'
        && (current.journal?.operation === 'preview' || current.journal?.operation === 'finish')
        && current.journal.step === 'artifacts_retained'
        && current.delivery.state === 'preview_active'
      ) {
        // 走到 artifacts_retained 说明 preview refs 已经写进 Local 仓库；这里把
        // 记录退回就绪态却没人释放它们，那些 ref 会一直留在仓库里。回滚路径
        // （applying → ready）释放过，中断恢复这条路同样是回滚，也得释放。
        await releasePreviewArtifactsBestEffort(current, current.delivery.preview.previewId)
        record = {
          ...current,
          phase: 'ready',
          journal: null,
          revision: current.revision + 1,
        }
        registry.managedCheckouts[checkoutId] = record
        registry.revision += 1
        changed = true
      } else if (current.phase === 'preparing' || current.phase === 'mutating') {
        record = {
          ...current,
          phase: 'recovery_required',
          revision: current.revision + 1,
        }
        registry.managedCheckouts[checkoutId] = record
        registry.revision += 1
        recoveryRequiredCheckoutIds.push(checkoutId)
        changed = true
      } else if (current.phase === 'recovery_required') {
        recoveryRequiredCheckoutIds.push(checkoutId)
      }

      if (!dependencies.files.exists(record.localRoot)) staleRootCheckoutIds.push(checkoutId)

      if (dependencies.lookup.getSession(record.ownerSessionId)) continue
      orphanedCheckoutIds.push(checkoutId)
      let dirty = true
      if (dependencies.files.exists(record.managedRoot)) {
        try {
          dirty = (await dependencies.git.status(record.managedRoot)).dirty
        } catch {
          dirty = true
        }
      }
      if (dirty) dirtyOrphanedCheckoutIds.push(checkoutId)
    }

    for (const checkoutId of emptyDiscardedCheckoutIds) {
      // 还有 binding 指向它、或别的记录把它当 predecessor 时不能删：那句话就是
      // 「这个 checkout 仍然是一个可解析的落点」，删掉它会让那些会话在
      // resolveBinding 里变成 project_mismatch，永远打不开。
      const referenced = Object.values(registry.sessionBindings).some((binding) =>
        binding.target.kind === 'isolated' && binding.target.checkoutId === checkoutId)
        || Object.values(registry.managedCheckouts).some((record) => record.predecessorCheckoutId === checkoutId)
      if (referenced) continue
      if (delete registry.managedCheckouts[checkoutId]) changed = true
    }
    if (changed) dependencies.registry.write(registry)
    for (const checkoutId of finalizedCheckoutIds) {
      const current = dependencies.registry.read().managedCheckouts[checkoutId]
      // 交付后清理只在这里和配额逐出里发生。目录已经消失的记录（用户手删、
      // 外部清理工具）永远等不到清理成功，会一直占着 finalized 位置；先让
      // cleanupFinalized 在无残留时收口台账，再由它自己写 discarded。
      if (current?.delivery.state === 'finalized' || current?.delivery.state === 'retained') {
        // 启动收敛不受单个卡死记录阻塞：超时后跳过，下次启动再试。
        await withCleanupTimeout(checkoutId, () => cleanupFinalized(current))
      }
    }
    await cleanupExpiredRetained()
    const currentRegistry = dependencies.registry.read()
    return {
      recoveryRequiredCheckoutIds,
      orphanedCheckoutIds,
      dirtyOrphanedCheckoutIds,
      staleRootCheckoutIds,
      retainedCheckoutCount: Object.values(currentRegistry.managedCheckouts)
        .filter((record) => record.phase !== 'discarded')
        .length,
    }
  }

  function operationError(
    code: SessionCheckoutErrorCode,
    message: string,
    target?: SessionTargetView,
  ): SessionCheckoutOperationErrorResult {
    return { status: 'error', code, message, ...(target ? { target } : {}) }
  }

  /**
   * 把一次 Local 合并冲突翻译成可动作的原因。
   *
   * 旧行为只会说 `apply_conflict` + 路径列表，而同一份路径列表可能来自两种完全
   * 不同的处境：Local 工作区本来就脏（未提交改动与交付重叠），或者两侧真的改了
   * 同一段内容。调用方只能靠试错区分，所以这里先判定原因，再给一条具体命令。
   */
  async function explainApplyConflict(input: {
    localRoot: string
    conflictingFiles: string[]
  }): Promise<{ reason: ApplyConflictReason; resolveHint: string }> {
    const preview = input.conflictingFiles.slice(0, 5).join(', ')
    const untracked = dependencies.git.listUntrackedFiles
      ? await dependencies.git.listUntrackedFiles(input.localRoot).catch(() => [] as string[])
      : []
    const untrackedSet = new Set(untracked.map((path) => path.replace(/\\/gu, '/')))
    const untrackedHits = input.conflictingFiles.filter((path) => untrackedSet.has(path.replace(/\\/gu, '/')))
    if (untrackedHits.length > 0) {
      return {
        reason: 'untracked_conflict',
        resolveHint: hostMessage('applyConflictUntrackedHint', { p0: untrackedHits.slice(0, 5).join(', ') }),
      }
    }
    const status = await dependencies.git.status(input.localRoot).catch(() => null)
    if (status?.dirty) {
      return { reason: 'local_dirty', resolveHint: hostMessage('applyConflictLocalDirtyHint', { p0: preview }) }
    }
    return { reason: 'content_conflict', resolveHint: hostMessage('applyConflictContentHint', { p0: preview }) }
  }

  /**
   * 交付语义已改为「只在会话分支内提交，Local 完全不动」。
   *
   * apply / preview / finalize_preview 都属于「把改动写进 Local」的旧路径，
   * 而写进 Local 正是当初把改动混到别的会话分支上的原因。会话分支存在时这些
   * 遗留操作一律拒绝，并指向正确的出口（deliver 后由 worktree_merge 合并）。
   */
  async function refuseLegacyLocalWrite(
    record: ManagedCheckoutRecord,
    binding: SessionBindingRecord,
  ): Promise<SessionCheckoutOperationErrorResult | null> {
    if (!record.sessionBranch) return null
    return operationError(
      'operation_not_allowed',
      hostMessage('deliveryNoLongerWritesLocalUseDeliverInstead', {
        p0: branchNameOf(record.sessionBranch) ?? record.sessionBranch,
      }),
      await inspectIsolated(binding),
    )
  }

  function updateManagedCheckout(
    checkoutId: string,
    update: (record: ManagedCheckoutRecord) => ManagedCheckoutRecord,
  ): ManagedCheckoutRecord | undefined {
    let result: ManagedCheckoutRecord | undefined
    dependencies.registry.update((registry) => {
      const current = registry.managedCheckouts[checkoutId]
      if (!current) return registry
      const next = update(current)
      result = next
      registry.managedCheckouts[checkoutId] = next
      registry.revision += 1
      return registry
    })
    return result
  }

  async function markReadyForReviewTarget(
    sessionId: string,
    input: MarkReadyForReviewInput,
  ): Promise<SessionTargetView> {
    const binding = await resolveBinding(sessionId)
    if (binding.ownerSessionId !== sessionId || binding.target.kind !== 'isolated') {
      throw new SessionCheckoutError('not_owner', hostMessage('onlyTheOwnerIsolatedSessionCanPrepareAReview'))
    }
    const summary = input.summary.trim()
    const suggestedCommitMessage = input.suggestedCommitMessage.trim()
    if (!summary || !isValidCommitMessage(suggestedCommitMessage) || input.tests.length > 20) {
      throw new SessionCheckoutError('invalid_input', hostMessage('theReviewSummaryCommitMessageOrValidationItemsAre'))
    }
    if (
      summary.length > 240
      || (input.detailsMarkdown?.trim().length ?? 0) > 12_000
      || (input.validationSummary?.trim().length ?? 0) > 500
      || input.tests.some(test => test.command.trim().length > 500 || (test.summary?.trim().length ?? 0) > 500)
    ) {
      throw new SessionCheckoutError('invalid_input', hostMessage('reviewFieldsExceedLengthLimits'))
    }
    const record = dependencies.registry.read().managedCheckouts[binding.target.checkoutId]
    if (!record) throw new SessionCheckoutError('checkout_missing', hostMessage('theIsolatedCheckoutRecordDoesNotExist'))
    if (record.phase !== 'ready' || record.delivery.state === 'preview_active' || record.delivery.state === 'preview_detached') {
      throw new SessionCheckoutError('operation_not_allowed', hostMessage('cannotPrepareAReviewInTheCurrentState', { p0: record.phase, p1: record.delivery.state }))
    }
    const inspected = await inspectIsolated(binding)
    if (inspected.checkout.phase !== 'ready') {
      throw new SessionCheckoutError('recovery_required', hostMessage('theIsolatedCheckoutIdentityCannotBeVerifiedRecoveryIs'))
    }
    // Review 之前就把 Worktree 挂到它自己的会话分支（历史记录在这里补建），
    // 让验收指纹记录的是交付期真实的 HEAD 身份。否则交付时才挂分支，
    // headRef 会从 DETACHED 变成本会话分支，指纹必然不同而被误判成 stale_isolated。
    const branched = await ensureSessionBranch(record)
    if (!branched.ok) throw new SessionCheckoutError(branched.code, branched.message)
    const reviewable = branched.record
    const snapshot = await dependencies.applyEngine.inspectReview({
      baseOid: reviewable.applyBaseOid ?? reviewable.baseOid,
      isolatedPath: reviewable.managedRoot,
      localPath: reviewable.localRoot,
    })
    if (snapshot.status === 'error') {
      throw new SessionCheckoutError(snapshot.error.code, snapshot.error.message)
    }
    const reviewId = dependencies.createCheckoutId()
    updateManagedCheckout(record.checkoutId, (current) => {
      const { recoveryContinuation: _recovery, ...withoutRecovery } = current
      return {
      ...withoutRecovery,
      ...(current.delivery.state !== 'working' && current.delivery.state !== 'delivered'
        ? { previousReview: projectPreviousReview(current.delivery.review) }
        : {}),
      delivery: {
        state: 'ready_for_review',
        review: {
          reviewId,
          iteration: current.delivery.state === 'working'
            ? current.delivery.iteration
            : current.delivery.state === 'delivered'
              ? current.delivery.iteration + 1
              : current.delivery.review.iteration,
          preparedAt: Date.now(),
          ...(input.detailsMarkdown?.trim() ? { detailsMarkdown: input.detailsMarkdown.trim() } : {}),
          summary,
          validationStatus: input.validationStatus,
          ...(input.validationSummary?.trim() ? { validationSummary: input.validationSummary.trim() } : {}),
          tests: input.tests.map((test) => ({
            command: test.command.trim(),
            status: test.status,
            ...(test.summary?.trim() ? { summary: test.summary.trim() } : {}),
          })),
          changedFiles: [...snapshot.changedFiles],
          suggestedCommitMessage,
          isolatedFingerprint: snapshot.isolatedFingerprint,
          isolatedHeadOid: snapshot.isolatedHeadOid,
        },
      },
      revision: current.revision + 1,
    }
    })
    return inspectIsolated(binding)
  }

  async function operateCheckpoint(
    input: Extract<SessionCheckoutOperation, { action: 'checkpoint' }>,
    binding: SessionBindingRecord,
  ): Promise<SessionCheckoutOperationResult> {
    if (binding.ownerSessionId !== input.sessionId || binding.target.kind !== 'isolated') {
      return operationError('not_owner', hostMessage('onlyTheOwnerIsolatedSessionCanSaveACheckpoint'))
    }
    const commitMessage = input.commitMessage.trim()
    if (
      !isValidCommitMessage(commitMessage)
      || !input.expectedReviewId.trim()
      || !/^[0-9a-f]{64}$/u.test(input.expectedGeneration)
      || !input.requestId.trim()
      || input.requestId.length > 200
      || /[\0\r\n]/u.test(input.requestId)
    ) return operationError('invalid_input', hostMessage('theCheckpointRequestOrCommitMessageIsInvalid'))

    let record = dependencies.registry.read().managedCheckouts[binding.target.checkoutId]
    if (!record) return operationError('checkout_missing', hostMessage('theIsolatedCheckoutRecordDoesNotExist'))
    const previousRequest = record.checkpoints?.find(checkpoint => checkpoint.requestId === input.requestId)
    if (previousRequest) {
      const exactReplay = record.delivery.state === 'working'
        && record.checkpoints?.at(-1)?.checkpointId === previousRequest.checkpointId
        && previousRequest.reviewId === input.expectedReviewId
        && previousRequest.requestedRevision === input.expectedRevision
        && previousRequest.generation === input.expectedGeneration
        && previousRequest.commitMessage === commitMessage
      if (!exactReplay) return operationError('stale_target', hostMessage('theCheckpointRequestIdIsAlreadyUsedByAnotherState'))
      return {
        status: 'checkpointed',
        target: await inspectIsolated(binding),
        checkpoint: projectCheckpoint(previousRequest),
        changedFiles: [...previousRequest.changedFiles],
      }
    }
    if (record.revision !== input.expectedRevision) {
      return operationError('stale_target', hostMessage('theSessionTargetHasChangedRefreshAndRetry'), await inspectIsolated(binding))
    }
    if (record.phase !== 'ready' || (record.delivery.state !== 'ready_for_review' && record.delivery.state !== 'preview_active')) {
      return operationError('operation_not_allowed', hostMessage('cannotSaveACheckpointInTheCurrentState', { p0: record.phase, p1: record.delivery.state }), await inspectIsolated(binding))
    }
    if (record.delivery.review.reviewId !== input.expectedReviewId || checkpointGenerationForRecord(record) !== input.expectedGeneration) {
      return operationError('stale_target', hostMessage('theCheckpointReviewOrGenerationHasChangedRefreshAnd'), await inspectIsolated(binding))
    }
    const holder = findProjectAcceptanceHolder(record)
    if (holder) {
      return operationError('project_acceptance_busy', hostMessage('anotherTaskIsOccupyingThisProjectSLocalAcceptance'), await inspectIsolated(binding))
    }
    const inspected = await inspectIsolated(binding)
    if (inspected.checkout.phase !== 'ready') {
      return operationError('recovery_required', hostMessage('theIsolatedCheckoutIdentityCannotBeVerifiedRecoveryIs'), inspected)
    }
    record = dependencies.registry.read().managedCheckouts[record.checkoutId]
    if (
      !record
      || record.revision !== input.expectedRevision
      || record.phase !== 'ready'
      || (record.delivery.state !== 'ready_for_review' && record.delivery.state !== 'preview_active')
      || record.delivery.review.reviewId !== input.expectedReviewId
      || checkpointGenerationForRecord(record) !== input.expectedGeneration
    ) return operationError('stale_target', hostMessage('theCheckpointStateChangedBeforeTheHostCASRefresh'))

    if (record.delivery.state === 'preview_active') {
      const { preview, review } = record.delivery
      const rollbackOperationId = dependencies.createCheckoutId()
      updateManagedCheckout(record.checkoutId, (current) => ({
        ...current,
        phase: 'mutating',
        journal: {
          operation: 'rollback_preview',
          operationId: rollbackOperationId,
          step: 'planning',
          startedAt: Date.now(),
          previewId: preview.previewId,
          reviewId: review.reviewId,
          resumeRevision: false,
        },
        revision: current.revision + 1,
      }))
      const rollback = await dependencies.applyEngine.rollback({
        localPath: record.localRoot,
        receipt: preview,
        beforeWrite: async () => {
          updateManagedCheckout(record!.checkoutId, (current) => ({
            ...current,
            journal: current.journal?.operation === 'rollback_preview'
              ? { ...current.journal, step: 'writing_local' }
              : current.journal,
            revision: current.revision + 1,
          }))
        },
      })
      if (rollback.status === 'error') {
        const current = dependencies.registry.read().managedCheckouts[record.checkoutId]
        const writeStarted = current?.journal?.operation === 'rollback_preview' && current.journal.step === 'writing_local'
        if (rollback.error.code === 'stale_local' || rollback.error.code === 'preview_modified') {
          return detachPreviewAfterLocalDrift(record, binding, rollback.error.code, 'rollback_preview')
        }
        if (!writeStarted || (rollback.error.code === 'git_error' && rollback.error.recoveryState === 'unchanged')) {
          updateManagedCheckout(record.checkoutId, (currentRecord) => ({ ...currentRecord, phase: 'ready', journal: null, revision: currentRecord.revision + 1 }))
        } else {
          updateManagedCheckout(record.checkoutId, (currentRecord) => ({ ...currentRecord, phase: 'recovery_required', revision: currentRecord.revision + 1 }))
        }
        return operationError(rollback.error.code, rollback.error.message, await inspectIsolated(binding))
      }
      const restored = updateManagedCheckout(record.checkoutId, (current) => ({
        ...current,
        phase: 'ready',
        delivery: { state: 'ready_for_review', review },
        journal: null,
        revision: current.revision + 1,
      }))
      if (!restored) return operationError('checkout_missing', hostMessage('previewWasRolledBackButTheCheckoutRecordIs'))
      await releasePreviewArtifactsBestEffort(record, preview.previewId)
      record = restored
    }

    if (record.delivery.state !== 'ready_for_review') {
      return operationError('operation_not_allowed', hostMessage('thereIsNoReviewCheckpointToSave'), await inspectIsolated(binding))
    }
    const review = record.delivery.review
    const checkpointId = dependencies.createCheckoutId()
    const checkpointSequence = (record.checkpoints?.length ?? 0) + 1
    const operationId = dependencies.createCheckoutId()
    const startedAt = Date.now()
    const mutating = updateManagedCheckout(record.checkoutId, (current) => ({
      ...current,
      phase: 'mutating',
      journal: {
        operation: 'checkpoint',
        operationId,
        step: 'planning',
        startedAt,
        reviewId: review.reviewId,
        checkpointId,
        checkpointSequence,
        checkpointRequestId: input.requestId,
        checkpointRequestedRevision: input.expectedRevision,
        checkpointMessage: commitMessage,
        recoveryGeneration: input.expectedGeneration,
        isolatedFingerprint: review.isolatedFingerprint,
        isolatedHeadOid: review.isolatedHeadOid,
      },
      revision: current.revision + 1,
    }))
    if (!mutating) return operationError('checkout_missing', hostMessage('theIsolatedCheckoutRecordDoesNotExist'))

    const result = await dependencies.applyEngine.checkpoint({
      isolatedPath: mutating.managedRoot,
      expectedFingerprint: review.isolatedFingerprint,
      expectedHeadOid: review.isolatedHeadOid,
      commitMessage,
      beforeCommit: async (prepared) => {
        const journaled = updateManagedCheckout(mutating.checkoutId, (current) => ({
          ...current,
          journal: current.journal?.operation === 'checkpoint'
            ? {
                ...current.journal,
                step: 'updating_ref',
                commitOid: prepared.commitOid,
                parentOid: prepared.parentOid,
                checkpointIndexTreeOid: prepared.indexTreeOid,
                changedFiles: [...prepared.changedFiles],
              }
            : current.journal,
          revision: current.revision + 1,
        }))
        if (!journaled?.journal || journaled.journal.operation !== 'checkpoint' || journaled.journal.commitOid !== prepared.commitOid) {
          throw new SessionCheckoutError('stale_target', hostMessage('theCheckpointJournalChangedBeforeRetainingTheInternalRef'))
        }
        await dependencies.git.retainInternalArtifact(mutating.localRoot, mutating.checkoutId, `checkpoints/${checkpointId}`, prepared.commitOid)
      },
    })
    if (result.status === 'error') {
      const current = dependencies.registry.read().managedCheckouts[mutating.checkoutId]
      const commitPrepared = current?.journal?.operation === 'checkpoint' && typeof current.journal.commitOid === 'string'
      if (!commitPrepared) {
        updateManagedCheckout(mutating.checkoutId, (checkout) => ({
          ...checkout,
          phase: 'ready',
          ...(result.error.code === 'stale_isolated' ? { previousReview: projectPreviousReview(review) } : {}),
          delivery: result.error.code === 'stale_isolated'
            ? { state: 'working', iteration: review.iteration }
            : { state: 'ready_for_review', review },
          journal: null,
          revision: checkout.revision + 1,
        }))
      } else {
        updateManagedCheckout(mutating.checkoutId, (checkout) => ({ ...checkout, phase: 'recovery_required', revision: checkout.revision + 1 }))
      }
      return operationError(result.error.code, result.error.message, await inspectIsolated(binding, false))
    }

    const checkpoint: ManagedWorktreeCheckpointRecord = {
      checkpointId,
      sequence: checkpointSequence,
      reviewId: review.reviewId,
      requestId: input.requestId,
      requestedRevision: input.expectedRevision,
      generation: input.expectedGeneration,
      iteration: review.iteration,
      createdAt: startedAt,
      commitOid: result.commitOid,
      parentOid: result.parentOid,
      summary: review.summary,
      commitMessage,
      validationStatus: review.validationStatus,
      changedFiles: [...result.changedFiles],
    }
    const completed = updateManagedCheckout(mutating.checkoutId, (current) => {
      const { recoveryContinuation: _continuation, ...withoutContinuation } = current
      return {
        ...withoutContinuation,
        phase: 'ready',
        previousReview: projectPreviousReview(review),
        checkpoints: [...(current.checkpoints ?? []), checkpoint],
        delivery: { state: 'working', iteration: review.iteration },
        journal: null,
        revision: current.revision + 1,
      }
    })
    if (!completed) return operationError('checkout_missing', hostMessage('checkpointWasCreatedButTheCheckoutRecordIsMissing'))
    return {
      status: 'checkpointed',
      target: await inspectIsolated(binding),
      checkpoint: projectCheckpoint(checkpoint),
      changedFiles: [...checkpoint.changedFiles],
    }
  }

  async function resumeRevisionTarget(
    sessionId: string,
    expectedRevision: number,
    expectedReviewId: string,
    recovery?: Omit<ManagedApplyConflictRecoveryContinuation, 'workingRevision'>,
  ): Promise<SessionTargetView> {
    const binding = await resolveBinding(sessionId)
    if (binding.ownerSessionId !== sessionId || binding.target.kind !== 'isolated') {
      throw new SessionCheckoutError('not_owner', hostMessage('onlyTheOwnerIsolatedSessionCanResumeEditing'))
    }
    let record = dependencies.registry.read().managedCheckouts[binding.target.checkoutId]
    if (!record) throw new SessionCheckoutError('checkout_missing', hostMessage('theIsolatedCheckoutRecordDoesNotExist'))
    if (record.revision !== expectedRevision) {
      throw new SessionCheckoutError('stale_target', hostMessage('theSessionTargetHasChangedRefreshAndRetry'))
    }
    if (record.phase !== 'ready' || record.delivery.state !== 'ready_for_review') {
      throw new SessionCheckoutError('operation_not_allowed', hostMessage('theCurrentWorktreeHasNoUnsyncedReviewToResume'))
    }
    if (record.delivery.review.reviewId !== expectedReviewId) {
      throw new SessionCheckoutError('stale_target', hostMessage('thisReviewCardIsNoLongerTheCurrentReview'))
    }
    const inspected = await inspectIsolated(binding)
    if (inspected.checkout.phase !== 'ready') {
      throw new SessionCheckoutError('recovery_required', hostMessage('theIsolatedCheckoutIdentityCannotBeVerifiedRecoveryIs'))
    }
    record = dependencies.registry.read().managedCheckouts[record.checkoutId]
    if (
      !record
      || record.revision !== expectedRevision
      || record.phase !== 'ready'
      || record.delivery.state !== 'ready_for_review'
      || record.delivery.review.reviewId !== expectedReviewId
    ) {
      throw new SessionCheckoutError('stale_target', hostMessage('theAcceptanceStateChangedBeforeResumingEditingRefreshAnd'))
    }
    if (recovery) {
      const preflight = await preflightTarget(sessionId, expectedRevision)
      const sameFiles = preflight.status === 'conflict'
        && preflight.conflictingFiles.length === recovery.conflictingFiles.length
        && preflight.conflictingFiles.every((file, index) => file === recovery.conflictingFiles[index])
      if (
        recovery.kind !== 'worktree_apply_conflict'
        || recovery.reviewId !== expectedReviewId
        || recovery.readyRevision !== expectedRevision
        || preflight.status !== 'conflict'
        || preflight.localHeadOid !== recovery.localHeadOid
        || !sameFiles
      ) throw new SessionCheckoutError('stale_target', hostMessage('theConflictRecoveryIdentityChangedBeforeHostCASRun'))
      record = dependencies.registry.read().managedCheckouts[record.checkoutId]
      if (
        !record
        || record.revision !== expectedRevision
        || record.delivery.state !== 'ready_for_review'
        || record.delivery.review.reviewId !== expectedReviewId
      ) throw new SessionCheckoutError('stale_target', hostMessage('theAcceptanceStateChangedBeforeConflictRecoveryRefreshAnd'))
    }
    const reviewBeforeResume = record.delivery.review
    const iteration = reviewBeforeResume.iteration
    updateManagedCheckout(record.checkoutId, (current) => {
      const { recoveryContinuation: _previousRecovery, ...withoutRecovery } = current
      return {
        ...withoutRecovery,
        previousReview: projectPreviousReview(reviewBeforeResume),
        ...(recovery ? {
          recoveryContinuation: { ...recovery, workingRevision: current.revision + 1 },
        } : {}),
        delivery: { state: 'working', iteration },
        revision: current.revision + 1,
      }
    })
    return inspectIsolated(binding)
  }

  async function prepareReviewRegenerationTarget(
    sessionId: string,
    expectedRevision: number,
    expectedReviewId: string,
    requestId: string,
  ): Promise<ManagedReviewRegenerationContinuation> {
    const binding = await resolveBinding(sessionId)
    if (binding.ownerSessionId !== sessionId || binding.target.kind !== 'isolated') {
      throw new SessionCheckoutError('not_owner', hostMessage('onlyTheOwnerIsolatedSessionCanRequestReviewRegeneration'))
    }
    const preflight = await preflightTarget(sessionId, expectedRevision)
    if (
      preflight.status !== 'blocked'
      || preflight.reason !== 'stale_isolated'
      || preflight.checkoutId !== binding.target.checkoutId
      || preflight.reviewId !== expectedReviewId
      || preflight.revision !== expectedRevision
    ) throw new SessionCheckoutError('stale_target', hostMessage('theReadOnlyReviewRegenerationIdentityChangedBeforeHost'))
    const continuation: ManagedReviewRegenerationContinuation = {
      kind: 'worktree_review_regeneration', requestId, reviewId: expectedReviewId, revision: expectedRevision,
    }
    const updated = updateManagedCheckout(binding.target.checkoutId, (current) => {
      if (
        current.revision !== expectedRevision
        || current.delivery.state !== 'ready_for_review'
        || current.delivery.review.reviewId !== expectedReviewId
      ) throw new SessionCheckoutError('stale_target', hostMessage('theReadyReviewChangedBeforeReadOnlyAuthorization'))
      return { ...current, recoveryContinuation: continuation }
    })
    if (!updated) throw new SessionCheckoutError('checkout_missing', hostMessage('theIsolatedCheckoutRecordDoesNotExist'))
    return continuation
  }

  async function preparePreviewRecoveryAnalysisTarget(
    sessionId: string,
    proof: WorktreePreviewRecoveryProof,
    requestId: string,
  ): Promise<ManagedPreviewRecoveryAnalysisContinuation> {
    const recovery = await preflightPreviewRecoveryTarget(
      sessionId,
      proof.revision,
      proof.reviewId,
      proof.previewId,
    )
    if (recovery.status !== 'assessed' || !recoveryProofMatches(proof, recovery.proof)) {
      throw new SessionCheckoutError('stale_target', hostMessage('theDetachedPreviewRecoveryProofHasChangedCheckAgain'))
    }
    const continuation: ManagedPreviewRecoveryAnalysisContinuation = {
      kind: 'worktree_preview_recovery_analysis',
      requestId,
      reviewId: proof.reviewId,
      previewId: proof.previewId,
      revision: proof.revision,
      generation: proof.generation,
    }
    const updated = updateManagedCheckout(proof.checkoutId, (current) => {
      if (
        current.ownerSessionId !== sessionId
        || current.revision !== proof.revision
        || current.delivery.state !== 'preview_detached'
        || current.delivery.review.reviewId !== proof.reviewId
        || current.delivery.preview.previewId !== proof.previewId
      ) throw new SessionCheckoutError('stale_target', hostMessage('theDetachedPreviewChangedBeforeAnalysisAuthorization'))
      return { ...current, recoveryContinuation: continuation }
    })
    if (!updated) throw new SessionCheckoutError('checkout_missing', hostMessage('theIsolatedCheckoutRecordDoesNotExist'))
    return continuation
  }

  async function createPreviewRecoveryHandoffTarget(
    sessionId: string,
    proof: WorktreePreviewRecoveryProof,
    targetSessionId: string,
    requestId: string,
  ): Promise<IsolatedTargetLaunch & { continuation: ManagedPreviewRecoveryHandoffContinuation }> {
    if (!targetSessionId || targetSessionId === sessionId) {
      throw new SessionCheckoutError('invalid_input', hostMessage('recoveryHandoffRequiresANewPreallocatedSessionID'))
    }
    if (dependencies.lookup.getSession(targetSessionId) || getPersistedBinding(targetSessionId)) {
      throw new SessionCheckoutError('target_already_bound', hostMessage('theRecoveryHandoffSessionIDIsAlreadyInUse'))
    }
    const recovery = await preflightPreviewRecoveryTarget(
      sessionId,
      proof.revision,
      proof.reviewId,
      proof.previewId,
    )
    if (recovery.status !== 'assessed' || !recoveryProofMatches(proof, recovery.proof)) {
      throw new SessionCheckoutError('stale_target', hostMessage('theDetachedPreviewRecoveryProofHasChangedCheckAgain'))
    }
    const source = dependencies.registry.read().managedCheckouts[proof.checkoutId]
    if (!source || source.ownerSessionId !== sessionId || source.delivery.state !== 'preview_detached') {
      throw new SessionCheckoutError('stale_target', hostMessage('thePreviousDetachedPreviewIdentityHasChanged'))
    }
    const originSessionId = source.sourceSessionId ?? source.ownerSessionId
    if (!dependencies.lookup.getSession(originSessionId)) {
      throw new SessionCheckoutError('session_not_found', hostMessage('theOriginalSourceSessionIsUnavailableNoHandoffWorktree'))
    }
    const target = await bindTarget(targetSessionId, { kind: 'isolated' }, 0, Date.now(), originSessionId)
    const binding = getPersistedBinding(targetSessionId)
    const created = binding?.target.kind === 'isolated'
      ? dependencies.registry.read().managedCheckouts[binding.target.checkoutId]
      : undefined
    if (!created) throw new SessionCheckoutError('checkout_missing', hostMessage('theRecoveryHandoffWorktreeRecordIsMissingAfterCreation'))
    const continuation: ManagedPreviewRecoveryHandoffContinuation = {
      kind: 'worktree_preview_recovery_handoff',
      requestId,
      sourceCheckoutId: source.checkoutId,
      reviewId: proof.reviewId,
      previewId: proof.previewId,
      sourceRevision: proof.revision,
      generation: proof.generation,
    }
    updateManagedCheckout(created.checkoutId, (current) => ({ ...current, recoveryContinuation: continuation }))
    return { targetSessionId, managedRoot: created.managedRoot, target, continuation }
  }

  async function operateApply(
    input: Extract<SessionCheckoutOperation, { action: 'apply' }>,
    binding: SessionBindingRecord,
  ): Promise<SessionCheckoutOperationResult> {
    if (binding.ownerSessionId !== input.sessionId) {
      return operationError('not_owner', hostMessage('aSessionThatInheritedItsSessionTargetCannotPerform'))
    }
    if (binding.target.kind !== 'isolated') {
      return operationError('operation_not_allowed', hostMessage('localCheckoutDoesNotSupportApply'))
    }

    let record = dependencies.registry.read().managedCheckouts[binding.target.checkoutId]
    if (!record) return operationError('checkout_missing', hostMessage('theIsolatedCheckoutRecordDoesNotExist'))
    if (record.revision !== input.expectedRevision) {
      return operationError('stale_target', hostMessage('theSessionTargetHasChangedRefreshAndRetry'), await inspectIsolated(binding))
    }
    if (record.phase !== 'ready') {
      return operationError('operation_not_allowed', hostMessage('cannotApplyInTheCurrentState', { p0: record.phase, p1: record.delivery.state }), await inspectIsolated(binding))
    }
    const holder = findProjectAcceptanceHolder(record)
    if (holder) {
      return operationError(
        'project_acceptance_busy',
        hostMessage('anotherAcceptanceTaskInTheSameProjectIsOccupying', { p0: holder.projectName }),
        await inspectIsolated(binding),
      )
    }

    const inspected = await inspectIsolated(binding)
    if (inspected.checkout.phase !== 'ready') {
      return operationError('recovery_required', hostMessage('theIsolatedCheckoutIdentityCannotBeVerifiedRecoveryIs'), inspected)
    }
    record = dependencies.registry.read().managedCheckouts[record.checkoutId]
    if (!record || record.phase !== 'ready') {
      return operationError('recovery_required', hostMessage('theIsolatedCheckoutStateHasChangedRecoveryIsRequired'))
    }
    const legacyGate = await refuseLegacyLocalWrite(record, binding)
    if (legacyGate) return legacyGate

    const startedAt = Date.now()
    const operationId = dependencies.createCheckoutId()
    const applyBaseOid = record.applyBaseOid ?? record.baseOid
    const applying = updateManagedCheckout(record.checkoutId, (current) => ({
      ...current,
      phase: 'mutating',
      journal: { operation: 'apply', operationId, step: 'planning', startedAt, baseOid: applyBaseOid },
      revision: current.revision + 1,
    }))
    if (!applying) return operationError('checkout_missing', hostMessage('theIsolatedCheckoutRecordDoesNotExist'))

    const planResult = await dependencies.applyEngine.plan({
      baseOid: applyBaseOid,
      isolatedPath: applying.managedRoot,
      localPath: applying.localRoot,
    })
    if (planResult.status === 'conflict') {
      updateManagedCheckout(applying.checkoutId, (current) => ({ ...current, phase: 'ready', journal: null, revision: current.revision + 1 }))
      const explained = await explainApplyConflict({ localRoot: applying.localRoot, conflictingFiles: planResult.conflictingFiles })
      return {
        status: 'conflict',
        code: 'apply_conflict',
        reason: explained.reason,
        target: await inspectIsolated(binding),
        baseStrategy: planResult.baseStrategy,
        effectiveBaseOid: planResult.effectiveBaseOid,
        localHeadOid: planResult.localHeadOid,
        isolatedHeadOid: planResult.isolatedHeadOid,
        canRetryAfterRefresh: false,
        conflictingFiles: planResult.conflictingFiles,
        ...(planResult.conflictDetails ? { conflictDetails: planResult.conflictDetails } : {}),
        resolveHint: explained.resolveHint,
      }
    }
    if (planResult.status === 'error') {
      updateManagedCheckout(applying.checkoutId, (current) => ({ ...current, phase: 'ready', journal: null, revision: current.revision + 1 }))
      return operationError(planResult.error.code, planResult.error.message, await inspectIsolated(binding))
    }
    if (
      applying.delivery.state === 'ready_for_review'
      && planResult.plan.isolatedFingerprint !== applying.delivery.review.isolatedFingerprint
    ) {
      updateManagedCheckout(applying.checkoutId, (current) => ({
        ...current,
        phase: 'ready',
        delivery: { state: 'working', iteration: applying.delivery.state === 'ready_for_review' ? applying.delivery.review.iteration : 1 },
        journal: null,
        revision: current.revision + 1,
      }))
      return operationError('stale_isolated', hostMessage('worktreeChangedAfterBeingMarkedReadyForReviewPrepare'), await inspectIsolated(binding))
    }
    if (planResult.plan.changedFiles.length === 0) {
      updateManagedCheckout(applying.checkoutId, (current) => ({ ...current, phase: 'ready', journal: null, revision: current.revision + 1 }))
      return { status: 'applied', target: await inspectIsolated(binding), changedFiles: [] }
    }

    const iteration = applying.delivery.state === 'working'
      ? applying.delivery.iteration
      : applying.delivery.state === 'delivered'
        ? applying.delivery.iteration + 1
        : applying.delivery.review.iteration
    const review = applying.delivery.state === 'ready_for_review'
      ? applying.delivery.review
      : {
          reviewId: operationId,
          iteration,
          preparedAt: startedAt,
          summary: hostMessage('worktreeChangesWereWrittenToLocalPreviewThroughApplyWorktree'),
          validationStatus: 'not_run' as const,
          tests: [],
          changedFiles: [...planResult.plan.changedFiles],
          suggestedCommitMessage: hostMessage('choreCommitWorktreeChanges'),
          isolatedFingerprint: planResult.plan.isolatedFingerprint,
          isolatedHeadOid: planResult.plan.isolatedHeadOid,
        }

    updateManagedCheckout(applying.checkoutId, (current) => ({
      ...current,
      delivery: { state: 'ready_for_review', review },
      journal: {
        operation: 'apply',
        operationId,
        step: 'writing_local',
        startedAt,
        baseOid: applyBaseOid,
        planRevision: planResult.plan.revision,
        localFingerprint: planResult.plan.localFingerprint,
        isolatedFingerprint: planResult.plan.isolatedFingerprint,
        effectiveBaseOid: planResult.plan.effectiveBaseOid,
        baseStrategy: planResult.plan.baseStrategy,
        localHeadOid: planResult.plan.localHeadOid,
        isolatedHeadOid: planResult.plan.isolatedHeadOid,
        changedFiles: [...planResult.plan.changedFiles],
      },
      revision: current.revision + 1,
    }))

    const result = await dependencies.applyEngine.apply(planResult.plan)
    if (result.status === 'error') {
      if (
        result.error.code === 'invalid_plan'
        || result.error.code === 'stale_local'
        || result.error.code === 'stale_isolated'
      ) {
        // 这些错误码可证明未触碰 Local，恢复 ready；git_error 交由 reconcile 兜底 recovery_required。
        updateManagedCheckout(applying.checkoutId, (checkout) => ({ ...checkout, phase: 'ready', journal: null, revision: checkout.revision + 1 }))
      }
      return operationError(result.error.code, result.error.message, await inspectIsolated(binding))
    }

    updateManagedCheckout(applying.checkoutId, (current) => ({
      ...current,
      applyBaseOid: result.nextBaseOid,
      phase: 'ready',
      journal: null,
      revision: current.revision + 1,
    }))
    return { status: 'applied', target: await inspectIsolated(binding), changedFiles: result.changedFiles }
  }

  function holdsProjectAcceptanceSlot(record: ManagedCheckoutRecord): boolean {
    return record.delivery.state === 'preview_active'
      || record.journal?.operation === 'preview'
      || record.journal?.operation === 'rollback_preview'
      || record.journal?.operation === 'finalize_preview'
      || record.journal?.operation === 'finish'
  }

  function findProjectAcceptanceHolder(
    owner: Pick<ManagedCheckoutRecord, 'checkoutId' | 'localRoot'>,
    options: { includeSelf?: boolean } = {},
  ): ManagedCheckoutRecord | undefined {
    return Object.values(dependencies.registry.read().managedCheckouts).find((candidate) => (
      (options.includeSelf === true || candidate.checkoutId !== owner.checkoutId)
      && candidate.phase !== 'discarded'
      && pathsEqual(candidate.localRoot, owner.localRoot)
      && holdsProjectAcceptanceSlot(candidate)
    ))
  }

  async function retainPreviewArtifacts(record: ManagedCheckoutRecord, receipt: ManagedPreviewReceipt): Promise<void> {
    const prefix = `previews/${receipt.previewId}`
    await dependencies.git.retainInternalArtifact(record.localRoot, record.checkoutId, `${prefix}/local-working`, receipt.localWorkingTreeOid)
    await dependencies.git.retainInternalArtifact(record.localRoot, record.checkoutId, `${prefix}/local-index`, receipt.localIndexTreeOid)
    await dependencies.git.retainInternalArtifact(record.localRoot, record.checkoutId, `${prefix}/preview-working`, receipt.previewWorkingTreeOid)
    await dependencies.git.retainInternalArtifact(record.localRoot, record.checkoutId, `${prefix}/isolated-snapshot`, receipt.isolatedSnapshotOid)
  }

  async function releasePreviewArtifactsBestEffort(record: ManagedCheckoutRecord, previewId: string): Promise<void> {
    try {
      await dependencies.git.releaseInternalArtifacts(record.localRoot, record.checkoutId, `previews/${previewId}`)
    } catch {
      console.warn(hostMessage('previewRefsCleanupFailed'))
    }
  }

  async function previewArtifactsMatch(record: ManagedCheckoutRecord, receipt: ManagedPreviewReceipt): Promise<boolean> {
    const prefix = `previews/${receipt.previewId}`
    const expected: Array<[string, string]> = [
      [`${prefix}/local-working`, receipt.localWorkingTreeOid],
      [`${prefix}/local-index`, receipt.localIndexTreeOid],
      [`${prefix}/preview-working`, receipt.previewWorkingTreeOid],
      [`${prefix}/isolated-snapshot`, receipt.isolatedSnapshotOid],
    ]
    for (const [name, oid] of expected) {
      if (await dependencies.git.readInternalArtifact(record.localRoot, record.checkoutId, name) !== oid) return false
    }
    return true
  }

  function blockedPreviewRecovery(
    record: ManagedCheckoutRecord | undefined,
    reason: Extract<WorktreePreviewRecoveryPreflightView, { status: 'blocked' }>['reason'],
    message: string,
  ): WorktreePreviewRecoveryPreflightView {
    const delivery = record?.delivery
    const detached = delivery?.state === 'preview_detached' ? delivery : undefined
    return {
      status: 'blocked',
      localModified: false,
      checkoutId: record?.checkoutId ?? '',
      reviewId: detached?.review.reviewId ?? null,
      previewId: detached?.preview.previewId ?? null,
      revision: record?.revision ?? 0,
      reason,
      message,
    }
  }

  function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
    if (value !== null && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
      return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`
    }
    return JSON.stringify(value)
  }

  function sha256Facts(value: unknown): string {
    return createHash('sha256').update(canonicalJson(value)).digest('hex')
  }

  function recoveryGeneration(facts: Omit<WorktreePreviewRecoveryProof, 'generation'>): string {
    return sha256Facts(facts)
  }

  async function preflightPreviewRecoveryTarget(
    sessionId: string,
    expectedRevision: number,
    expectedReviewId: string,
    expectedPreviewId: string,
  ): Promise<WorktreePreviewRecoveryPreflightView> {
    const binding = await resolveBinding(sessionId)
    if (binding.ownerSessionId !== sessionId || binding.target.kind !== 'isolated') {
      return blockedPreviewRecovery(undefined, 'not_owner', hostMessage('onlyTheOwnerIsolatedSessionCanCheckPreviewRecovery'))
    }
    const record = dependencies.registry.read().managedCheckouts[binding.target.checkoutId]
    if (!record) return blockedPreviewRecovery(undefined, 'checkout_unavailable', hostMessage('theIsolatedCheckoutRecordDoesNotExist'))
    if (record.revision !== expectedRevision) {
      return blockedPreviewRecovery(record, 'stale_target', hostMessage('theSessionTargetHasChangedRefreshBeforeCheckingAgain'))
    }
    if (
      record.phase !== 'ready'
      || record.delivery.state !== 'preview_detached'
      || record.delivery.review.reviewId !== expectedReviewId
      || record.delivery.preview.previewId !== expectedPreviewId
    ) {
      return blockedPreviewRecovery(record, 'not_preview_detached', hostMessage('theCurrentStateIsNotTheSpecifiedDetachedPreview'))
    }
    const validated = await validateManagedCheckoutDetailed(binding, record, false)
    if (validated.status !== 'valid') {
      return blockedPreviewRecovery(record, 'checkout_unavailable', hostMessage('theWorktreeIdentityPathOrGitStateCannotCurrently'))
    }
    const { review, preview } = record.delivery
    try {
      if (!await previewArtifactsMatch(record, preview)) {
        return blockedPreviewRecovery(record, 'artifacts_missing', hostMessage('previewRetainedArtifactsAreMissingOrDoNotMatch'))
      }
      const assessment = await dependencies.applyEngine.assessPreviewRecovery({
        localPath: record.localRoot,
        receipt: preview,
      })
      if ('error' in assessment) {
        return blockedPreviewRecovery(record, 'git_error', assessment.error.message)
      }
      const holder = findProjectAcceptanceHolder(record)
      const blocker = holder
        ? { checkoutId: holder.checkoutId, ownerSessionId: holder.ownerSessionId, revision: holder.revision, state: holder.delivery.state }
        : undefined
      const rollback = holder
        ? { status: 'blocked' as const, code: 'project_acceptance_busy' as const, message: hostMessage('anotherTaskIsOccupyingThisProjectSLocalAcceptance') }
        : assessment.rollback
      const finalize = holder
        ? { status: 'blocked' as const, code: 'project_acceptance_busy' as const, message: hostMessage('anotherTaskIsOccupyingThisProjectSLocalAcceptance') }
        : assessment.finalize
      const facts: Omit<WorktreePreviewRecoveryProof, 'generation'> = {
        sessionId,
        checkoutId: record.checkoutId,
        reviewId: review.reviewId,
        previewId: preview.previewId,
        revision: record.revision,
        receiptFingerprint: sha256Facts(preview),
        localFingerprint: assessment.localFingerprint,
        localHeadOid: assessment.localHeadOid,
        localHeadRef: assessment.localHeadRef,
        localHeadTreeOid: assessment.localHeadTreeOid,
        localIndexTreeOid: assessment.localIndexTreeOid,
        localWorkingTreeOid: assessment.localWorkingTreeOid,
        rollback,
        finalize,
        ...(blocker ? { blocker } : {}),
      }
      const current = dependencies.registry.read().managedCheckouts[record.checkoutId]
      if (
        !current
        || current.revision !== record.revision
        || current.phase !== 'ready'
        || current.delivery.state !== 'preview_detached'
        || current.delivery.review.reviewId !== review.reviewId
        || current.delivery.preview.previewId !== preview.previewId
      ) {
        return blockedPreviewRecovery(current, 'stale_target', hostMessage('thePreviewRecoveryStateChangedDuringTheCheck'))
      }
      if (!await previewArtifactsMatch(current, current.delivery.preview)) {
        return blockedPreviewRecovery(current, 'artifacts_missing', hostMessage('previewRetainedArtifactsChangedDuringTheCheck'))
      }
      const proof: WorktreePreviewRecoveryProof = { ...facts, generation: recoveryGeneration(facts) }
      return { status: 'assessed', localModified: false, proof }
    } catch (error) {
      const message = error instanceof Error ? error.message : hostMessage('previewRecoveryCheckFailed')
      return blockedPreviewRecovery(record, 'git_error', message)
    }
  }

  function recoveryProofMatches(left: WorktreePreviewRecoveryProof | undefined, right: WorktreePreviewRecoveryProof): boolean {
    if (left === undefined) return false
    const { generation: leftGeneration, ...leftFacts } = left
    return leftGeneration === recoveryGeneration(leftFacts) && leftGeneration === right.generation
  }

  function blockedPreflight(
    record: ManagedCheckoutRecord | undefined,
    reason: WorktreeApplyPreflightBlockedReason,
    message: string,
    blocker?: ManagedCheckoutRecord,
  ): WorktreeApplyPreflightView {
    return {
      status: 'blocked',
      localModified: false,
      checkoutId: record?.checkoutId ?? '',
      reviewId: record?.delivery.state === 'ready_for_review' ? record.delivery.review.reviewId : null,
      revision: record?.revision ?? 0,
      reason,
      message,
      ...(blocker === undefined ? {} : {
        blocker: {
          checkoutId: blocker.checkoutId,
          ownerSessionId: blocker.ownerSessionId,
          revision: blocker.revision,
          state: blocker.delivery.state,
        },
      }),
    }
  }

  async function preflightTarget(sessionId: string, expectedRevision: number): Promise<WorktreeApplyPreflightView> {
    const binding = await resolveBinding(sessionId)
    if (binding.ownerSessionId !== sessionId || binding.target.kind !== 'isolated') {
      return blockedPreflight(undefined, 'not_owner', hostMessage('onlyTheOwnerIsolatedSessionCanRunSyncPreflight'))
    }
    const record = dependencies.registry.read().managedCheckouts[binding.target.checkoutId]
    if (!record) return blockedPreflight(undefined, 'checkout_unavailable', hostMessage('theIsolatedCheckoutRecordDoesNotExist'))
    if (record.revision !== expectedRevision) {
      return blockedPreflight(record, 'stale_target', hostMessage('theSessionTargetHasChangedRefreshBeforeRunningPreflight'))
    }
    if (record.phase !== 'ready' || record.delivery.state !== 'ready_for_review') {
      return blockedPreflight(record, 'not_ready_for_review', hostMessage('theCurrentWorktreeIsNotReadyForReview'))
    }
    const holder = findProjectAcceptanceHolder(record)
    if (holder) {
      return blockedPreflight(record, 'project_acceptance_busy', hostMessage('anotherTaskIsOccupyingThisProjectSLocalAcceptance'), holder)
    }
    const validated = await validateManagedCheckoutDetailed(binding, record, false)
    if (validated.status !== 'valid') {
      return blockedPreflight(record, 'checkout_unavailable', hostMessage('theWorktreeIdentityPathOrGitStateCannotCurrently'))
    }
    const review = record.delivery.review
    const result = await dependencies.applyEngine.preflight({
      baseOid: record.applyBaseOid ?? record.baseOid,
      isolatedPath: validated.checkout.canonicalManagedRoot,
      localPath: record.localRoot,
    })
    const current = dependencies.registry.read().managedCheckouts[record.checkoutId]
    if (
      !current
      || current.revision !== expectedRevision
      || current.delivery.state !== 'ready_for_review'
      || current.delivery.review.reviewId !== review.reviewId
    ) return blockedPreflight(current, 'stale_target', hostMessage('theSessionTargetChangedDuringPreflightRefreshAndRetry'))
    if (result.status === 'error') {
      const reason = result.error.code === 'stale_isolated'
        ? 'stale_isolated'
        : result.error.code === 'stale_local'
          ? 'stale_local'
          : 'git_error'
      return blockedPreflight(current, reason, result.error.message)
    }
    const isolatedFingerprint = result.status === 'ready'
      ? result.plan.isolatedFingerprint
      : result.isolatedFingerprint
    if (isolatedFingerprint !== review.isolatedFingerprint) {
      return blockedPreflight(current, 'stale_isolated', hostMessage('worktreeChangedAfterTheReviewWasPreparedRegenerateThe'))
    }
    const localBranch = result.status === 'ready' && result.plan.localHeadRef?.startsWith('refs/heads/')
      ? result.plan.localHeadRef.slice('refs/heads/'.length)
      : validated.checkout.snapshot.branch
    const common = {
      localModified: false as const,
      checkoutId: record.checkoutId,
      reviewId: review.reviewId,
      revision: expectedRevision,
      configuredBaseOid: record.baseOid,
      effectiveBaseOid: result.status === 'ready' ? result.plan.effectiveBaseOid : result.effectiveBaseOid,
      baseStrategy: result.status === 'ready' ? result.plan.baseStrategy : result.baseStrategy,
      localBranch,
      localHeadOid: result.status === 'ready' ? result.plan.localHeadOid : result.localHeadOid,
      isolatedHeadOid: result.status === 'ready' ? result.plan.isolatedHeadOid : result.isolatedHeadOid,
      changedFiles: result.status === 'ready' ? [...result.plan.changedFiles] : [...review.changedFiles],
    }
    if (result.status === 'conflict') {
      return {
        ...common,
        status: 'conflict',
        conflictingFiles: [...result.conflictingFiles],
        ...(result.conflictDetails ? { conflictDetails: [...result.conflictDetails] } : {}),
      }
    }
    const status = result.plan.changedFiles.length === 0
      ? 'already_in_local' as const
      : result.plan.localHeadOid !== record.baseOid
        ? 'local_advanced' as const
        : 'ready' as const
    return { ...common, status }
  }

  async function operatePreview(
    input: Extract<SessionCheckoutOperation, { action: 'preview' }>,
    binding: SessionBindingRecord,
  ): Promise<SessionCheckoutOperationResult> {
    if (binding.ownerSessionId !== input.sessionId || binding.target.kind !== 'isolated') {
      return operationError('not_owner', hostMessage('onlyTheOwnerIsolatedSessionCanSyncAReview'))
    }
    let record = dependencies.registry.read().managedCheckouts[binding.target.checkoutId]
    if (!record) return operationError('checkout_missing', hostMessage('theIsolatedCheckoutRecordDoesNotExist'))
    if (record.revision !== input.expectedRevision) {
      return operationError('stale_target', hostMessage('theSessionTargetHasChangedRefreshAndRetry'), await inspectIsolated(binding))
    }
    if (record.phase !== 'ready' || record.delivery.state !== 'ready_for_review') {
      return operationError('operation_not_allowed', hostMessage('theCurrentWorktreeIsNotReadyForReview'), await inspectIsolated(binding))
    }
    const holder = findProjectAcceptanceHolder(record)
    if (holder) {
      return operationError(
        'project_acceptance_busy',
        hostMessage('anotherAcceptanceTaskInTheSameProjectIsOccupying', { p0: holder.projectName }),
        await inspectIsolated(binding),
      )
    }
    const inspected = await inspectIsolated(binding)
    if (inspected.checkout.phase !== 'ready') {
      return operationError('recovery_required', hostMessage('theIsolatedCheckoutIdentityCannotBeVerifiedRecoveryIs'), inspected)
    }
    record = dependencies.registry.read().managedCheckouts[record.checkoutId]
    if (!record || record.delivery.state !== 'ready_for_review') {
      return operationError('stale_target', hostMessage('theAcceptanceStateHasChangedRefreshAndRetry'))
    }
    const legacyGate = await refuseLegacyLocalWrite(record, binding)
    if (legacyGate) return legacyGate
    const review = record.delivery.review
    const operationId = dependencies.createCheckoutId()
    const previewId = dependencies.createCheckoutId()
    const startedAt = Date.now()
    const applyBaseOid = record.applyBaseOid ?? record.baseOid
    const mutating = updateManagedCheckout(record.checkoutId, (current) => ({
      ...current,
      phase: 'mutating',
      journal: {
        operation: 'preview',
        operationId,
        step: 'planning',
        startedAt,
        baseOid: applyBaseOid,
        previewId,
        reviewId: review.reviewId,
      },
      revision: current.revision + 1,
    }))
    if (!mutating) return operationError('checkout_missing', hostMessage('theIsolatedCheckoutRecordDoesNotExist'))

    const planResult = await dependencies.applyEngine.plan({
      baseOid: applyBaseOid,
      isolatedPath: mutating.managedRoot,
      localPath: mutating.localRoot,
    })
    if (planResult.status === 'conflict') {
      updateManagedCheckout(mutating.checkoutId, (current) => ({ ...current, phase: 'ready', journal: null, revision: current.revision + 1 }))
      const explained = await explainApplyConflict({ localRoot: mutating.localRoot, conflictingFiles: planResult.conflictingFiles })
      return {
        status: 'conflict',
        code: 'apply_conflict',
        reason: explained.reason,
        target: await inspectIsolated(binding),
        baseStrategy: planResult.baseStrategy,
        effectiveBaseOid: planResult.effectiveBaseOid,
        localHeadOid: planResult.localHeadOid,
        isolatedHeadOid: planResult.isolatedHeadOid,
        canRetryAfterRefresh: false,
        conflictingFiles: planResult.conflictingFiles,
        ...(planResult.conflictDetails ? { conflictDetails: planResult.conflictDetails } : {}),
        resolveHint: explained.resolveHint,
      }
    }
    if (planResult.status === 'error') {
      updateManagedCheckout(mutating.checkoutId, (current) => ({ ...current, phase: 'ready', journal: null, revision: current.revision + 1 }))
      return operationError(planResult.error.code, planResult.error.message, await inspectIsolated(binding))
    }
    if (planResult.plan.isolatedFingerprint !== review.isolatedFingerprint) {
      updateManagedCheckout(mutating.checkoutId, (current) => ({
        ...current,
        phase: 'ready',
        delivery: { state: 'working', iteration: review.iteration },
        journal: null,
        revision: current.revision + 1,
      }))
      return operationError('stale_isolated', hostMessage('worktreeChangedAfterBeingMarkedReadyForReviewPrepare'), await inspectIsolated(binding))
    }
    updateManagedCheckout(mutating.checkoutId, (current) => ({
      ...current,
      journal: {
        operation: 'preview',
        operationId,
        step: 'writing_local',
        startedAt,
        baseOid: applyBaseOid,
        previewId,
        reviewId: review.reviewId,
        planRevision: planResult.plan.revision,
        localFingerprint: planResult.plan.localFingerprint,
        isolatedFingerprint: planResult.plan.isolatedFingerprint,
        effectiveBaseOid: planResult.plan.effectiveBaseOid,
        baseStrategy: planResult.plan.baseStrategy,
        localHeadOid: planResult.plan.localHeadOid,
        isolatedHeadOid: planResult.plan.isolatedHeadOid,
        changedFiles: [...planResult.plan.changedFiles],
      },
      revision: current.revision + 1,
    }))
    const previewResult = await dependencies.applyEngine.preview(planResult.plan, {
      previewId,
      reviewId: review.reviewId,
      iteration: review.iteration,
      beforeWrite: async (receipt) => {
        await retainPreviewArtifacts(mutating, receipt)
        updateManagedCheckout(mutating.checkoutId, (current) => ({
          ...current,
          delivery: { state: 'preview_active', review, preview: receipt },
          journal: current.journal?.operation === 'preview'
            ? { ...current.journal, step: 'artifacts_retained' }
            : current.journal,
          revision: current.revision + 1,
        }))
      },
    })
    if (previewResult.status === 'error') {
      const current = dependencies.registry.read().managedCheckouts[mutating.checkoutId]
      const definitelyUnchanged = previewResult.error.code === 'stale_local'
        || previewResult.error.code === 'stale_isolated'
        || previewResult.error.code === 'invalid_plan'
        || previewResult.error.code === 'invalid_input'
        || current?.journal?.step === 'writing_local'
      if (current?.journal?.step === 'writing_local') await releasePreviewArtifactsBestEffort(mutating, previewId)
      if (definitelyUnchanged || current?.journal?.step === 'artifacts_retained') {
        updateManagedCheckout(mutating.checkoutId, (checkout) => ({ ...checkout, phase: 'ready', journal: null, revision: checkout.revision + 1 }))
      }
      return operationError(previewResult.error.code, previewResult.error.message, await inspectIsolated(binding))
    }
    const receipt: ManagedPreviewReceipt = previewResult.receipt
    updateManagedCheckout(mutating.checkoutId, (current) => ({
      ...current,
      phase: 'ready',
      delivery: { state: 'preview_active', review, preview: receipt },
      journal: null,
      revision: current.revision + 1,
    }))
    return { status: 'previewed', target: await inspectIsolated(binding), changedFiles: previewResult.changedFiles }
  }

  async function detachPreviewAfterLocalDrift(
    record: ManagedCheckoutRecord,
    binding: SessionBindingRecord,
    reason: 'stale_local' | 'preview_modified',
    attemptedAction: 'rollback_preview' | 'finalize_preview' | 'discard',
  ): Promise<SessionCheckoutOperationResult> {
    if (record.delivery.state !== 'preview_active') {
      return operationError('preview_not_active', hostMessage('thereIsNoLocalPreviewToRelease'), await inspectIsolated(binding))
    }
    const { review, preview } = record.delivery
    const detached = updateManagedCheckout(record.checkoutId, (current) => {
      if (current.delivery.state !== 'preview_active') return current
      return {
        ...current,
        phase: 'ready',
        delivery: {
          state: 'preview_detached',
          review: current.delivery.review,
          preview: current.delivery.preview,
          detachedAt: Date.now(),
          reason,
          attemptedAction,
        },
        journal: null,
        revision: current.revision + 1,
      }
    })
    if (!detached || detached.delivery.state !== 'preview_detached') {
      return operationError('stale_target', hostMessage('thePreviewStateHasChangedRefreshAndRetry'), await inspectIsolated(binding))
    }
    return {
      status: 'preview_detached',
      target: await inspectIsolated(binding),
      changedFiles: [...preview.changedFiles],
      reason,
      attemptedAction,
    }
  }

  async function operateRollbackPreview(
    input: Extract<SessionCheckoutOperation, { action: 'rollback_preview' }>,
    binding: SessionBindingRecord,
  ): Promise<SessionCheckoutOperationResult> {
    if (binding.ownerSessionId !== input.sessionId || binding.target.kind !== 'isolated') {
      return operationError('not_owner', hostMessage('onlyTheOwnerIsolatedSessionCanRollBackAcceptance'))
    }
    const record = dependencies.registry.read().managedCheckouts[binding.target.checkoutId]
    if (!record) return operationError('checkout_missing', hostMessage('theIsolatedCheckoutRecordDoesNotExist'))
    if (record.revision !== input.expectedRevision) {
      return operationError('stale_target', hostMessage('theSessionTargetHasChangedRefreshAndRetry'), await inspectIsolated(binding))
    }
    const retryingRecovery = record.phase === 'recovery_required'
      && record.delivery.state === 'preview_active'
      && record.journal?.operation === 'rollback_preview'
    if (
      (record.phase !== 'ready' && !retryingRecovery)
      || (record.delivery.state !== 'preview_active' && record.delivery.state !== 'preview_detached')
    ) {
      return operationError('preview_not_active', hostMessage('thereIsNoLocalPreviewToRollBack'), await inspectIsolated(binding))
    }
    const retryingDetached = record.delivery.state === 'preview_detached'
    if (retryingDetached) {
      const recovery = await preflightPreviewRecoveryTarget(
        input.sessionId,
        input.expectedRevision,
        record.delivery.review.reviewId,
        record.delivery.preview.previewId,
      )
      if (recovery.status !== 'assessed') {
        return operationError('stale_target', recovery.message, await inspectIsolated(binding))
      }
      if (!recoveryProofMatches(input.recoveryProof, recovery.proof)) {
        return operationError('stale_target', hostMessage('thePreviewRecoveryProofHasExpiredOrDoesNot'), await inspectIsolated(binding))
      }
      if (recovery.proof.rollback.status !== 'safe') {
        return operationError(recovery.proof.rollback.code, recovery.proof.rollback.message, await inspectIsolated(binding))
      }
    }
    const resumeRevision = input.resumeRevision ?? (
      retryingRecovery && record.journal?.operation === 'rollback_preview'
        ? record.journal.resumeRevision ?? false
        : false
    )
    const { preview, review } = record.delivery
    const operationId = dependencies.createCheckoutId()
    const startedAt = Date.now()
    updateManagedCheckout(record.checkoutId, (current) => ({
      ...current,
      phase: 'mutating',
      journal: {
        operation: 'rollback_preview',
        operationId,
        step: 'planning',
        startedAt,
        previewId: preview.previewId,
        reviewId: review.reviewId,
        resumeRevision,
        ...(input.recoveryProof ? { recoveryGeneration: input.recoveryProof.generation } : {}),
      },
      revision: current.revision + 1,
    }))
    const result = await dependencies.applyEngine.rollback({
      localPath: record.localRoot,
      receipt: preview,
      beforeWrite: async () => {
        updateManagedCheckout(record.checkoutId, (current) => ({
          ...current,
          journal: current.journal?.operation === 'rollback_preview'
            ? { ...current.journal, step: 'writing_local' }
            : current.journal,
          revision: current.revision + 1,
        }))
      },
    })
    if (result.status === 'error') {
      const current = dependencies.registry.read().managedCheckouts[record.checkoutId]
      const writeStarted = current?.journal?.operation === 'rollback_preview' && current.journal.step === 'writing_local'
      if (result.error.code === 'stale_local' || result.error.code === 'preview_modified') {
        if (!retryingDetached) {
          return detachPreviewAfterLocalDrift(record, binding, result.error.code, 'rollback_preview')
        }
        updateManagedCheckout(record.checkoutId, (checkout) => ({ ...checkout, phase: 'ready', journal: null, revision: checkout.revision + 1 }))
      } else if (
        result.error.code === 'invalid_input'
        || !writeStarted
        || (result.error.code === 'git_error' && result.error.recoveryState === 'unchanged')
      ) {
        updateManagedCheckout(record.checkoutId, (checkout) => ({ ...checkout, phase: 'ready', journal: null, revision: checkout.revision + 1 }))
      } else {
        updateManagedCheckout(record.checkoutId, (checkout) => ({ ...checkout, phase: 'recovery_required', revision: checkout.revision + 1 }))
      }
      return operationError(result.error.code, result.error.message, await inspectIsolated(binding))
    }
    updateManagedCheckout(record.checkoutId, (current) => ({
      ...current,
      phase: 'ready',
      delivery: resumeRevision
        ? { state: 'working', iteration: review.iteration }
        : { state: 'ready_for_review', review },
      journal: null,
      revision: current.revision + 1,
    }))
    await releasePreviewArtifactsBestEffort(record, preview.previewId)
    return { status: 'preview_rolled_back', target: await inspectIsolated(binding), changedFiles: result.changedFiles }
  }

  function retainFinalized(
    record: ManagedCheckoutRecord,
    retention: Exclude<WorktreeRetentionMode, 'cleanup'>,
  ): ManagedCheckoutRecord | undefined {
    if (record.delivery.state !== 'finalized') return undefined
    const retainedAt = Date.now()
    return updateManagedCheckout(record.checkoutId, (current) => {
      if (current.delivery.state !== 'finalized') return current
      return {
        ...current,
        phase: 'retained',
        delivery: {
          state: 'retained',
          review: current.delivery.review,
          commitOid: current.delivery.commitOid,
          ...(current.delivery.proof ? { proof: current.delivery.proof } : {}),
          isolatedFingerprint: current.delivery.isolatedFingerprint,
          retention,
          retainedAt,
          expiresAt: retentionExpiresAt(retention, retainedAt),
          cleanup: 'scheduled',
        },
        journal: null,
        revision: current.revision + 1,
      }
    })
  }

  async function cleanupFinalized(
    record: ManagedCheckoutRecord,
    options: { allowLegacyResidue?: boolean; discardPostDeliveryChanges?: boolean } = {},
  ): Promise<{ cleaned: boolean; message?: string; reason?: WorktreeCleanupReason }> {
    const block = (key: PersistedCleanupKey, reason: WorktreeCleanupReason): { cleaned: false; message: string; reason: WorktreeCleanupReason } => {
      const message = hostMessages[key].zh
      updateManagedCheckout(record.checkoutId, (current) => {
        const journal = current.journal?.operation === 'cleanup' ? current.journal : null
        if (current.delivery.state === 'finalized') {
          return {
            ...current,
            phase: 'finalized',
            delivery: {
              ...current.delivery,
              cleanup: 'blocked',
              cleanupMessage: message,
              cleanupMessageKey: key,
              cleanupReason: reason,
            },
            journal,
            revision: current.revision + 1,
          }
        }
        if (current.delivery.state === 'retained') {
          return {
            ...current,
            phase: 'retained',
            delivery: {
              ...current.delivery,
              cleanup: 'blocked',
              cleanupMessage: message,
              cleanupMessageKey: key,
              cleanupReason: reason,
            },
            journal,
            revision: current.revision + 1,
          }
        }
        return current
      })
      return { cleaned: false, message: hostPersistedCleanupMessage(message, hostMessage, key), reason }
    }
    if (record.delivery.state !== 'finalized' && record.delivery.state !== 'retained') {
      return block('cleanupIncompleteDelivery', 'directory_busy')
    }
    // 身份变更阻塞原本没有出口：目录换了人、记录还在，每次重试都只把同一句
    // 说明再写一遍。目录已经不在时没有可校验的身份，也没有可保护的字节，
    // 这时清掉台账是唯一能走完的路。
    if (
      (record.delivery.state === 'finalized' || record.delivery.state === 'retained')
      && record.delivery.cleanup === 'blocked'
      && persistedCleanupReason(record.delivery) === 'identity_changed'
      && !dependencies.files.exists(record.managedRoot)
      && !dependencies.files.exists(record.managedGitRoot)
    ) {
      await releaseApplyBaseBestEffort(record)
      updateManagedCheckout(record.checkoutId, (current) => {
        if (current.delivery.state !== 'finalized' && current.delivery.state !== 'retained') return current
        return {
          ...current,
          phase: 'discarded',
          delivery: {
            state: 'delivered',
            iteration: current.delivery.review.iteration,
            commitOid: current.delivery.commitOid,
            ...(current.delivery.proof ? { proof: current.delivery.proof } : {}),
            deliveredAt: Date.now(),
          },
          journal: null,
          revision: current.revision + 1,
        }
      })
      return { cleaned: true }
    }
    if (
      (record.delivery.state === 'finalized' || record.delivery.state === 'retained')
      && record.delivery.cleanup === 'blocked'
      && record.delivery.cleanupMessage
      && persistedCleanupReason(record.delivery) === 'identity_changed'
    ) {
      // 已经是身份变更阻塞：原文可能来自旧记录，只更新原因，不重写说明。
      return {
        cleaned: false,
        message: hostPersistedCleanupMessage(
          record.delivery.cleanupMessage,
          hostMessage,
          record.delivery.cleanupMessageKey,
        ),
        reason: 'identity_changed',
      }
    }
    if (hasLegacyCleanupResidueEvidence(record) && !options.allowLegacyResidue && dependencies.files.exists(record.managedGitRoot)) {
      return { cleaned: false, message: CLEANUP_RESIDUE_MESSAGE, reason: 'detached_residue' }
    }
    const registry = dependencies.registry.read()
    const persistedBinding = registry.sessionBindings[record.ownerSessionId]
    const binding: SessionBindingRecord = persistedBinding?.target.kind === 'isolated'
      && persistedBinding.target.checkoutId === record.checkoutId
      ? persistedBinding
      : bindingForManagedRecord(record)

    const beginRemoval = (
      currentRecord: ManagedCheckoutRecord,
      managedDirectoryIdentity: DirectoryIdentity,
    ): ManagedCheckoutRecord | undefined => {
      if (hasCleanupRemovalReceipt(currentRecord)) return currentRecord
      return updateManagedCheckout(currentRecord.checkoutId, (current) => ({
        ...current,
        journal: {
          operation: 'cleanup',
          operationId: dependencies.createCheckoutId(),
          step: 'removing_worktree',
          startedAt: Date.now(),
          commitOid: current.delivery.state === 'finalized' || current.delivery.state === 'retained'
            ? current.delivery.commitOid ?? undefined
            : undefined,
          isolatedFingerprint: current.delivery.state === 'finalized' || current.delivery.state === 'retained'
            ? current.delivery.isolatedFingerprint
            : undefined,
          managedDirectoryIdentity,
        },
        revision: current.revision + 1,
      }))
    }

    const quarantineAndRemove = async (
      currentRecord: ManagedCheckoutRecord,
      residue: ValidatedCleanupResidue,
    ): Promise<void> => {
      const journal = currentRecord.journal?.operation === 'cleanup' ? currentRecord.journal : undefined
      if (!journal?.managedDirectoryIdentity) throw new SessionCheckoutError('checkout_mismatch', hostMessages.cleanupIncompleteReceipt.zh)
      const quarantinePath = journal.cleanupQuarantinePath ?? join(
        dirname(currentRecord.managedGitRoot),
        `.dsh-wt-cleanup--${currentRecord.checkoutId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)}--${journal.operationId}`,
      )
      const quarantining = journal.cleanupQuarantinePath
        ? currentRecord
        : updateManagedCheckout(currentRecord.checkoutId, (current) => ({
            ...current,
            journal: current.journal?.operation === 'cleanup'
              ? { ...current.journal, cleanupQuarantinePath: quarantinePath }
              : current.journal,
            revision: current.revision + 1,
          }))
      if (!quarantining) throw new SessionCheckoutError('checkout_missing', hostMessages.cleanupMissingBeforeQuarantine.zh)
      if (!dependencies.files.exists(quarantinePath)) {
        await retryTransientCleanup(() => dependencies.files.quarantineDirectoryTree(
          residue.canonicalManagedGitRoot,
          residue.directoryIdentity,
          quarantinePath,
        ))
      }
      const validatedQuarantine = await validateCleanupQuarantine(quarantining)
      if (!validatedQuarantine) throw new SessionCheckoutError('checkout_mismatch', hostMessages.cleanupQuarantineIdentity.zh)
      await retryTransientCleanup(() => dependencies.files.removeDirectoryTree(validatedQuarantine))
    }

    try {
      const existingQuarantine = await validateCleanupQuarantine(record)
      if (existingQuarantine) {
        await retryTransientCleanup(() => dependencies.files.removeDirectoryTree(existingQuarantine))
      } else if (record.journal?.operation === 'cleanup' && record.journal.cleanupQuarantinePath && dependencies.files.exists(record.journal.cleanupQuarantinePath)) {
        return block('cleanupIdentityChanged', 'identity_changed')
      } else if (dependencies.files.exists(record.managedGitRoot)) {
        const validated = dependencies.files.exists(record.managedRoot)
          ? await validateManagedCheckout(binding, record, false)
          : undefined
        if (validated) {
          const snapshot = await dependencies.applyEngine.inspectReview({
            baseOid: record.applyBaseOid ?? record.baseOid,
            isolatedPath: record.managedRoot,
            localPath: record.localRoot,
          })
          if (
            snapshot.status !== 'ready'
            || snapshot.isolatedFingerprint !== record.delivery.isolatedFingerprint
          ) {
            // 交付后的新改动默认保留：那是用户可能还没取走的工作。只有显式确认
            // 放弃它们时，才继续走下面的删除链。
            if (options.discardPostDeliveryChanges !== true) {
              return block('cleanupNewChanges', 'modified_after_finalize')
            }
          }
          const directoryIdentity = await dependencies.files.inspectDirectoryIdentity(validated.canonicalManagedGitRoot)
          if (!directoryIdentity) return block('cleanupIdentityChanged', 'identity_changed')
          const removing = beginRemoval(record, directoryIdentity)
          if (!removing) return block('cleanupMissingBeforeRemoval', 'directory_busy')
          await retryTransientCleanup(() => dependencies.git.removeWorktree(removing.localRoot, removing.managedGitRoot))
          if (dependencies.files.exists(removing.managedGitRoot)) {
            const residue = await validateDetachedCleanupResidue(removing)
            if (!residue) return block('cleanupIdentityChanged', 'identity_changed')
            await quarantineAndRemove(removing, residue)
          }
        } else {
          const residue = await validateDetachedCleanupResidue(record, options.allowLegacyResidue === true)
          if (!residue) return block('cleanupIdentityChanged', 'identity_changed')
          const removing = beginRemoval(record, residue.directoryIdentity)
          if (!removing) return block('cleanupMissingBeforeRemoval', 'directory_busy')
          const revalidatedResidue = await validateDetachedCleanupResidue(removing)
          if (!revalidatedResidue) return block('cleanupIdentityChanged', 'identity_changed')
          await quarantineAndRemove(removing, revalidatedResidue)
        }
      }
      await releaseApplyBaseBestEffort(record)
      updateManagedCheckout(record.checkoutId, (current) => {
        if (current.delivery.state !== 'finalized' && current.delivery.state !== 'retained') return current
        return {
          ...current,
          phase: 'discarded',
          delivery: {
            state: 'delivered',
            iteration: current.delivery.review.iteration,
            commitOid: current.delivery.commitOid,
            ...(current.delivery.proof ? { proof: current.delivery.proof } : {}),
            deliveredAt: Date.now(),
          },
          journal: null,
          revision: current.revision + 1,
        }
      })
      return { cleaned: true }
    } catch (error) {
      console.warn('[session-checkout] finalized Worktree cleanup failed:', error)
      const failureRecord = dependencies.registry.read().managedCheckouts[record.checkoutId] ?? record
      const quarantineBusy = failureRecord.journal?.operation === 'cleanup' && Boolean(failureRecord.journal.cleanupQuarantinePath)
      // 归因决定这条记录以后会不会被自动重试。目录身份对不上（checkout_mismatch）
      // 不是「暂时占用」，重试一万次也不会变；把它写成 directory_busy 会让一条
      // 永远清不掉的记录长期占着配额。
      const identityMismatch = error instanceof SessionCheckoutError && error.code === 'checkout_mismatch'
      const reason: WorktreeCleanupReason = quarantineBusy
        ? 'quarantine_busy'
        : identityMismatch ? 'identity_changed' : 'directory_busy'
      const message = quarantineBusy
        ? hostMessages.cleanupQuarantineBusy.zh
        : identityMismatch ? hostMessages.cleanupIdentityChanged.zh : hostMessages.cleanupDirectoryBusy.zh
      updateManagedCheckout(record.checkoutId, (current) => {
        const journal = current.journal?.operation === 'cleanup' ? current.journal : null
        if (current.delivery.state === 'finalized') {
          return { ...current, phase: 'finalized', delivery: { ...current.delivery, cleanup: 'pending', cleanupMessage: message, cleanupReason: reason }, journal, revision: current.revision + 1 }
        }
        if (current.delivery.state === 'retained') {
          return { ...current, phase: 'retained', delivery: { ...current.delivery, cleanup: 'blocked', cleanupMessage: message, cleanupReason: reason }, journal, revision: current.revision + 1 }
        }
        return current
      })
      return { cleaned: false, message, reason }
    }
  }


  async function operateFinalizePreview(
    input: Extract<SessionCheckoutOperation, { action: 'finalize_preview' }>,
    binding: SessionBindingRecord,
  ): Promise<SessionCheckoutOperationResult> {
    if (binding.ownerSessionId !== input.sessionId || binding.target.kind !== 'isolated') {
      return operationError('not_owner', hostMessage('onlyTheOwnerIsolatedSessionCanFinalizeTheAcceptance'))
    }
    if (!isValidCommitMessage(input.commitMessage)) {
      return operationError('invalid_input', hostMessage('theCommitMessageMustBeNonemptyAndContainNoNul'))
    }
    const record = dependencies.registry.read().managedCheckouts[binding.target.checkoutId]
    if (!record) return operationError('checkout_missing', hostMessage('theIsolatedCheckoutRecordDoesNotExist'))
    if (record.revision !== input.expectedRevision) {
      return operationError('stale_target', hostMessage('theSessionTargetHasChangedRefreshAndRetry'), await inspectIsolated(binding))
    }
    if (
      record.phase !== 'ready'
      || (record.delivery.state !== 'preview_active' && record.delivery.state !== 'preview_detached')
    ) {
      return operationError('preview_not_active', hostMessage('thereIsNoLocalPreviewAwaitingAcceptance'), await inspectIsolated(binding))
    }
    const retryingDetached = record.delivery.state === 'preview_detached'
    if (retryingDetached) {
      const recovery = await preflightPreviewRecoveryTarget(
        input.sessionId,
        input.expectedRevision,
        record.delivery.review.reviewId,
        record.delivery.preview.previewId,
      )
      if (recovery.status !== 'assessed') {
        return operationError('stale_target', recovery.message, await inspectIsolated(binding))
      }
      if (!recoveryProofMatches(input.recoveryProof, recovery.proof)) {
        return operationError('stale_target', hostMessage('thePreviewRecoveryProofHasExpiredOrDoesNot'), await inspectIsolated(binding))
      }
      if (recovery.proof.finalize.status !== 'safe') {
        return operationError(recovery.proof.finalize.code, recovery.proof.finalize.message, await inspectIsolated(binding))
      }
    }
    // Harness plugin does not expose Domi collaborator checkout inheritance.
    const legacyGate = await refuseLegacyLocalWrite(record, binding)
    if (legacyGate) return legacyGate
    const { preview, review } = record.delivery
    const operationId = dependencies.createCheckoutId()
    const startedAt = Date.now()
    updateManagedCheckout(record.checkoutId, (current) => ({
      ...current,
      phase: 'mutating',
      journal: {
        operation: 'finalize_preview',
        operationId,
        step: 'planning',
        startedAt,
        previewId: preview.previewId,
        reviewId: review.reviewId,
        retention: input.retention ?? DEFAULT_WORKTREE_RETENTION,
        ...(input.recoveryProof ? { recoveryGeneration: input.recoveryProof.generation } : {}),
      },
      revision: current.revision + 1,
    }))
    const result = await dependencies.applyEngine.finalize({
      localPath: record.localRoot,
      receipt: preview,
      commitMessage: input.commitMessage,
      beforeCommit: async (commitOid) => {
        updateManagedCheckout(record.checkoutId, (current) => ({
          ...current,
          journal: current.journal?.operation === 'finalize_preview'
            ? { ...current.journal, step: 'updating_ref', commitOid }
            : current.journal,
          revision: current.revision + 1,
        }))
      },
    })
    if (result.status === 'error') {
      if ((result.error.code === 'stale_local' || result.error.code === 'preview_modified') && !retryingDetached) {
        return detachPreviewAfterLocalDrift(record, binding, result.error.code, 'finalize_preview')
      }
      const current = dependencies.registry.read().managedCheckouts[record.checkoutId]
      const writeStarted = current?.journal?.operation === 'finalize_preview' && current.journal.step === 'updating_ref'
      if (
        result.error.code === 'commit_isolation_conflict'
        || result.error.code === 'operation_not_allowed'
        || result.error.code === 'invalid_input'
        || result.error.code === 'stale_local'
        || result.error.code === 'preview_modified'
        || !writeStarted
        || (result.error.code === 'git_error' && result.error.recoveryState === 'unchanged')
      ) {
        updateManagedCheckout(record.checkoutId, (checkout) => ({ ...checkout, phase: 'ready', journal: null, revision: checkout.revision + 1 }))
      } else {
        updateManagedCheckout(record.checkoutId, (checkout) => ({ ...checkout, phase: 'recovery_required', revision: checkout.revision + 1 }))
      }
      return operationError(result.error.code, result.error.message, await inspectIsolated(binding))
    }
    const finalized = updateManagedCheckout(record.checkoutId, (current) => ({
      ...current,
      phase: 'finalized',
      delivery: {
        state: 'finalized',
        review,
        commitOid: result.commitOid,
        proof: {
          localBranch: input.recoveryProof?.localHeadRef?.startsWith('refs/heads/')
            ? input.recoveryProof.localHeadRef.slice('refs/heads/'.length)
            : preview.localHeadRef?.startsWith('refs/heads/')
              ? preview.localHeadRef.slice('refs/heads/'.length)
              : null,
          localHeadBefore: input.recoveryProof?.localHeadOid ?? preview.localHeadOid,
          localHeadAfter: result.commitOid ?? input.recoveryProof?.localHeadOid ?? preview.localHeadOid,
          changedFiles: [...result.changedFiles],
          validationStatus: review.validationStatus,
          ...(review.validationSummary === undefined ? {} : { validationSummary: review.validationSummary }),
        },
        isolatedFingerprint: preview.isolatedFingerprint,
        finalizedAt: Date.now(),
        cleanup: 'pending',
      },
      journal: null,
      revision: current.revision + 1,
    }))
    if (!finalized) return operationError('checkout_missing', hostMessage('theCommitWasCreatedButTheCheckoutRecordIs'))
    const retention = input.retention ?? DEFAULT_WORKTREE_RETENTION
    if (retention !== 'cleanup') {
      const retained = retainFinalized(finalized, retention)
      if (!retained) return operationError('checkout_missing', hostMessage('theCommitWasCreatedButSavingTheRetainedWorktree'))
      return {
        status: 'finished',
        target: await inspectIsolated(binding),
        changedFiles: result.changedFiles,
        commitOid: result.commitOid,
        cleanup: 'retained',
      }
    }
    const cleanup = await cleanupFinalized(finalized)
    return {
      status: 'finished',
      target: await inspectIsolated(binding),
      changedFiles: result.changedFiles,
      commitOid: result.commitOid,
      cleanup: cleanup.cleaned ? 'discarded' : 'pending',
      ...(cleanup.message ? { cleanupMessage: cleanup.message } : {}),
      ...(cleanup.reason ? { cleanupReason: cleanup.reason } : {}),
    }
  }

  async function operateRetryCleanup(
    input: Extract<SessionCheckoutOperation, { action: 'retry_cleanup' }>,
    binding: SessionBindingRecord,
  ): Promise<SessionCheckoutOperationResult> {
    if (binding.ownerSessionId !== input.sessionId || binding.target.kind !== 'isolated') {
      return operationError('not_owner', hostMessage('onlyTheOwnerIsolatedSessionCanRetryCleanup'))
    }
    const record = dependencies.registry.read().managedCheckouts[binding.target.checkoutId]
    if (!record) return operationError('checkout_missing', hostMessage('theIsolatedCheckoutRecordDoesNotExist'))
    if (record.revision !== input.expectedRevision) {
      return operationError('stale_target', hostMessage('theSessionTargetHasChangedRefreshAndRetry'), await inspectIsolated(binding))
    }
    if (record.delivery.state !== 'finalized' && record.delivery.state !== 'retained') {
      return operationError('operation_not_allowed', hostMessage('thereIsNoWorktreeCleanupToRetry'), await inspectIsolated(binding))
    }
    const cleanup = await cleanupFinalized(record, { allowLegacyResidue: true })
    return {
      status: 'finished',
      target: await inspectIsolated(binding),
      changedFiles: [...record.delivery.review.changedFiles],
      commitOid: record.delivery.commitOid,
      cleanup: cleanup.cleaned ? 'discarded' : 'pending',
      ...(cleanup.message ? { cleanupMessage: cleanup.message } : {}),
      ...(cleanup.reason ? { cleanupReason: cleanup.reason } : {}),
    }
  }

  async function operateFinish(
    input: Extract<SessionCheckoutOperation, { action: 'finish' }>,
    binding: SessionBindingRecord,
  ): Promise<SessionCheckoutOperationResult> {
    if (binding.ownerSessionId !== input.sessionId) {
      return operationError('not_owner', hostMessage('aSessionThatInheritedItsSessionTargetCannotPerform162'))
    }
    if (binding.target.kind !== 'isolated') {
      return operationError('operation_not_allowed', hostMessage('localCheckoutDoesNotSupportFinish'))
    }
    const finishCommitMessage = input.commitMessage.trim()
    if (!finishCommitMessage) {
      return operationError('invalid_input', hostMessage('worktreeFinishCommitMessageRequired'))
    }

    if (!isValidCommitMessage(input.commitMessage)) {
      return operationError('invalid_input', hostMessage('theCommitMessageMustBeNonemptyAndContainNoNul'))
    }
    let record = dependencies.registry.read().managedCheckouts[binding.target.checkoutId]
    if (!record) return operationError('checkout_missing', hostMessage('theIsolatedCheckoutRecordDoesNotExist'))
    if (record.revision !== input.expectedRevision) {
      return operationError('stale_target', hostMessage('theSessionTargetHasChangedRefreshAndRetry'), await inspectIsolated(binding))
    }
    if (input.expectedReviewId !== undefined && (
      record.delivery.state !== 'ready_for_review'
      || record.delivery.review.reviewId !== input.expectedReviewId
    )) {
      return operationError('stale_target', hostMessage('thisReviewCardIsNoLongerTheCurrentReview166'), await inspectIsolated(binding))
    }
    // 历史记录仍停在「把改动写进 Local」那套中间态时，先让它按旧规则收口。
    if (record.applyBaseOid && (record.delivery.state === 'working' || record.delivery.state === 'ready_for_review')) {
      return operationError(
        'operation_not_allowed',
        hostMessage('thisLegacyWorktreeWasWrittenToLocalThroughAn'),
        await inspectIsolated(binding),
      )
    }
    if (record.phase !== 'ready' || record.delivery.state === 'preview_active' || record.delivery.state === 'preview_detached') {
      return operationError('operation_not_allowed', hostMessage('cannotFinishDirectlyInTheCurrentState', { p0: record.phase, p1: record.delivery.state }), await inspectIsolated(binding))
    }
    const holder = findProjectAcceptanceHolder(record)
    if (holder) {
      return operationError(
        'project_acceptance_busy',
        hostMessage('anotherAcceptanceTaskInTheSameProjectIsOccupying', { p0: holder.projectName }),
        await inspectIsolated(binding),
      )
    }

    const inspected = await inspectIsolated(binding)
    if (inspected.checkout.phase !== 'ready') {
      return operationError('recovery_required', hostMessage('theIsolatedCheckoutIdentityCannotBeVerifiedRecoveryIs'), inspected)
    }
    record = dependencies.registry.read().managedCheckouts[record.checkoutId]
    if (!record || record.phase !== 'ready') {
      return operationError('recovery_required', hostMessage('theIsolatedCheckoutStateHasChangedRecoveryIsRequired'))
    }
    // bind 回引擎实例：这些方法通过 this 访问内部状态，脱开实例调用会崩。
    const engine = dependencies.applyEngine
    const reviewIsolated = engine.reviewIsolated ? engine.reviewIsolated.bind(engine) : undefined
    const commitIsolated = engine.commitIsolated ? engine.commitIsolated.bind(engine) : undefined
    if (!reviewIsolated || !commitIsolated) {
      return operationError('operation_not_allowed', hostMessage('thisVersionCannotDeliverToASessionBranch'), await inspectIsolated(binding))
    }

    const startedAt = Date.now()
    const operationId = dependencies.createCheckoutId()
    const applyBaseOid = record.applyBaseOid ?? record.baseOid
    const mutating = updateManagedCheckout(record.checkoutId, (current) => ({
      ...current,
      phase: 'mutating',
      journal: {
        operation: 'finish',
        operationId,
        step: 'committing_session_branch',
        startedAt,
        baseOid: applyBaseOid,
      },
      revision: current.revision + 1,
    }))
    if (!mutating) return operationError('checkout_missing', hostMessage('theIsolatedCheckoutRecordDoesNotExist'))

    const restoreReady = (): void => {
      updateManagedCheckout(mutating.checkoutId, (current) => ({
        ...current,
        phase: 'ready',
        journal: null,
        revision: current.revision + 1,
      }))
    }

    // 先把 Worktree 挂到它自己的会话分支（历史记录在这里补建），再只在该分支上提交。
    // Local 的工作区、索引与 HEAD 全程不被读写。
    const branched = await ensureSessionBranch(mutating)
    if (!branched.ok) {
      restoreReady()
      return operationError(branched.code, branched.message, await inspectIsolated(binding))
    }
    const deliverable = branched.record
    const branchRef = deliverable.sessionBranch ?? null

    const isolatedReview = await reviewIsolated({ isolatedPath: deliverable.managedRoot, baseOid: applyBaseOid })
    if (isolatedReview.status === 'error') {
      restoreReady()
      return operationError(isolatedReview.error.code, isolatedReview.error.message, await inspectIsolated(binding))
    }
    if (
      input.expectedReviewId !== undefined
      && deliverable.delivery.state === 'ready_for_review'
      && (
        deliverable.delivery.review.reviewId !== input.expectedReviewId
        || isolatedReview.isolatedFingerprint !== deliverable.delivery.review.isolatedFingerprint
        || isolatedReview.isolatedHeadOid !== deliverable.delivery.review.isolatedHeadOid
      )
    ) {
      const reviewIteration = deliverable.delivery.review.iteration
      updateManagedCheckout(mutating.checkoutId, (current) => ({
        ...current,
        phase: 'ready',
        delivery: { state: 'working', iteration: reviewIteration },
        journal: null,
        revision: current.revision + 1,
      }))
      return operationError('stale_isolated', hostMessage('worktreeChangedAfterReviewPrepareTheReviewAgain'), await inspectIsolated(binding))
    }

    const iteration = deliverable.delivery.state === 'working'
      ? deliverable.delivery.iteration
      : deliverable.delivery.state === 'delivered'
        ? deliverable.delivery.iteration + 1
        : deliverable.delivery.review.iteration
    const reviewed = deliverable.delivery.state === 'ready_for_review'
      ? deliverable.delivery.review
      : {
          reviewId: operationId,
          iteration,
          preparedAt: startedAt,
          summary: hostMessage('skipLocalAcceptanceAndCommitDirectly'),
          validationStatus: 'not_run' as const,
          tests: [],
          changedFiles: [...isolatedReview.changedFiles],
          suggestedCommitMessage: finishCommitMessage,
          isolatedFingerprint: isolatedReview.isolatedFingerprint,
          isolatedHeadOid: isolatedReview.isolatedHeadOid,
        }
    updateManagedCheckout(mutating.checkoutId, (current) => ({
      ...current,
      delivery: { state: 'ready_for_review', review: reviewed },
      journal: {
        operation: 'finish',
        operationId,
        step: 'committing_session_branch',
        startedAt,
        baseOid: applyBaseOid,
        isolatedFingerprint: isolatedReview.isolatedFingerprint,
        changedFiles: [...isolatedReview.changedFiles],
      },
      revision: current.revision + 1,
    }))

    const committed = await commitIsolated({
      isolatedPath: deliverable.managedRoot,
      baseOid: applyBaseOid,
      commitMessage: finishCommitMessage,
      branchRef,
    })
    if (committed.status === 'error') {
      const landedOid = committed.committedOid
      if (landedOid !== undefined) {
        // 提交已经写进会话分支，撤销它等于改写用户刚拿到的历史。保留 journal 与
        // 已落地的 OID 作为恢复证据，让记录停在可检视的状态而不是退回 ready。
        updateManagedCheckout(mutating.checkoutId, (current) => ({
          ...current,
          delivery: {
            state: 'ready_for_review',
            review: { ...reviewed, isolatedHeadOid: landedOid },
          },
          journal: {
            operation: 'finish',
            operationId,
            step: 'committing_session_branch',
            startedAt,
            baseOid: applyBaseOid,
            isolatedFingerprint: reviewed.isolatedFingerprint,
            changedFiles: [...reviewed.changedFiles],
            committedOid: landedOid,
          },
          revision: current.revision + 1,
        }))
        return operationError(committed.error.code, committed.error.message, await inspectIsolated(binding))
      }
      restoreReady()
      return operationError(committed.error.code, committed.error.message, await inspectIsolated(binding))
    }

    const finalReview = {
      ...reviewed,
      changedFiles: [...committed.changedFiles],
      isolatedFingerprint: committed.isolatedFingerprint,
      isolatedHeadOid: committed.commitOid,
    }
    const finalized = updateManagedCheckout(mutating.checkoutId, (current) => ({
      ...current,
      phase: 'finalized',
      delivery: {
        state: 'finalized' as const,
        review: finalReview,
        commitOid: committed.commitOid,
        proof: {
          localBranch: branchNameOf(branchRef),
          localHeadBefore: isolatedReview.isolatedHeadOid,
          localHeadAfter: committed.commitOid,
          changedFiles: [...committed.changedFiles],
          validationStatus: reviewed.validationStatus,
          ...(reviewed.validationSummary === undefined ? {} : { validationSummary: reviewed.validationSummary }),
        },
        isolatedFingerprint: committed.isolatedFingerprint,
        finalizedAt: Date.now(),
        cleanup: 'pending' as const,
      },
      journal: null,
      revision: current.revision + 1,
    }))
    if (!finalized) {
      return operationError('checkout_missing', hostMessage('theTaskCommitWasCreatedButTheCheckoutRecord'))
    }
    const retention = input.retention ?? DEFAULT_WORKTREE_RETENTION
    // 自动 push 推的是会话分支（Worktree 的 HEAD），不是 Local 的当前分支；
    // 新分支通常没有 upstream，于是退化成一条「已跳过」的备注，不会误推。
    const push: WorktreePushOutcome | undefined = (liveConfigValue(dependencies.autoPush) ?? true)
      && dependencies.git.pushBranch
      ? await pushLocalBranchBestEffort(dependencies.git.pushBranch, deliverable.managedRoot)
      : undefined
    const branchName = branchNameOf(branchRef)
    if (retention !== 'cleanup') {
      const retained = retainFinalized(finalized, retention)
      if (!retained) return operationError('checkout_missing', hostMessage('theTaskCommitWasCreatedButSavingTheRetained'))
      return {
        status: 'finished',
        target: await inspectIsolated(binding),
        changedFiles: committed.changedFiles,
        commitOid: committed.commitOid,
        ...(branchName ? { branch: branchName } : {}),
        cleanup: 'retained',
        ...(push ? { push } : {}),
      }
    }
    const cleanup = await cleanupFinalized(finalized)
    return {
      status: 'finished',
      target: await inspectIsolated(binding),
      changedFiles: committed.changedFiles,
      commitOid: committed.commitOid,
      ...(branchName ? { branch: branchName } : {}),
      cleanup: cleanup.cleaned ? 'discarded' : 'pending',
      ...(cleanup.message ? { cleanupMessage: cleanup.message } : {}),
      ...(cleanup.reason ? { cleanupReason: cleanup.reason } : {}),
      ...(push ? { push } : {}),
    }
  }

  async function releaseApplyBaseBestEffort(record: ManagedCheckoutRecord): Promise<void> {
    try {
      await dependencies.git.releaseApplyBase(record.localRoot, record.checkoutId)
      await dependencies.git.releaseInternalArtifacts(record.localRoot, record.checkoutId)
    } catch {
      // checkout 删除优先；内部无 ref artifact 的清理失败不能阻止 owner 明确收口。
      console.warn(hostMessage('internalRefsCleanupFailed'))
    }
  }

  async function operateDiscard(
    input: Extract<SessionCheckoutOperation, { action: 'discard' }>,
    binding: SessionBindingRecord,
  ): Promise<SessionCheckoutOperationResult> {
    if (binding.ownerSessionId !== input.sessionId) {
      return operationError('not_owner', hostMessage('aSessionThatInheritedItsSessionTargetCannotPerform178'))
    }
    if (binding.target.kind !== 'isolated') {
      return operationError('operation_not_allowed', hostMessage('localCheckoutDoesNotSupportDiscard'))
    }

    let record = dependencies.registry.read().managedCheckouts[binding.target.checkoutId]
    if (!record) return operationError('checkout_missing', hostMessage('theIsolatedCheckoutRecordDoesNotExist'))
    if (record.revision !== input.expectedRevision) {
      return operationError('stale_target', hostMessage('theSessionTargetHasChangedRefreshAndRetry'), await inspectIsolated(binding))
    }
    if (record.delivery.state === 'preview_detached') {
      return operationError(
        'preview_modified',
        hostMessage('localPreviewDriftedIntoDetachedRecoveryToPreserveRecovery'),
        await inspectIsolated(binding),
      )
    }
    if (record.applyBaseOid && (record.delivery.state === 'working' || record.delivery.state === 'ready_for_review')) {
      return operationError(
        'operation_not_allowed',
        hostMessage('thisLegacyWorktreeWasWrittenToLocalThroughAn183'),
        await inspectIsolated(binding),
      )
    }
    if (record.delivery.state === 'preview_active') {
      if (!input.rollbackPreview) {
        return operationError(
          'preview_not_active',
          hostMessage('thisTaskIsPreviewingInLocalSafelyRollBack'),
          await inspectIsolated(binding),
        )
      }
      const rollback = await dependencies.applyEngine.rollback({
        localPath: record.localRoot,
        receipt: record.delivery.preview,
      })
      if (rollback.status === 'error') {
        if (rollback.error.code === 'stale_local' || rollback.error.code === 'preview_modified') {
          return detachPreviewAfterLocalDrift(record, binding, rollback.error.code, 'discard')
        }
        return operationError(rollback.error.code, rollback.error.message, await inspectIsolated(binding))
      }
      const previewId = record.delivery.preview.previewId
      const iteration = record.delivery.review.iteration
      const rolledBack = updateManagedCheckout(record.checkoutId, (current) => ({
        ...current,
        delivery: { state: 'working', iteration },
        journal: null,
        revision: current.revision + 1,
      }))
      if (!rolledBack) return operationError('checkout_missing', hostMessage('theIsolatedCheckoutRecordDoesNotExist'))
      await releasePreviewArtifactsBestEffort(record, previewId)
      record = rolledBack
    }
    // An interrupted creation may still own a Git registration at a quarantined path.
    // Missing original cwd is not proof that its process tree or residue has gone away,
    // so a residue on disk is never deletion authority. When nothing is left on disk
    // there is nothing to protect, and the ledger must not stay wedged forever: every
    // path below this point only clears the record.
    if (record.journal?.operation === 'create' && record.journal.creation && hasCreationResidue(record)) {
      return operationError('recovery_unsafe', hostMessage('creationResidueBlocksRecovery', { p0: creationResiduePaths(record).join(', ') }))
    }
    // Harness plugin has no inherited collaborator checkout ownership.
    if (record.phase === 'recovery_required' && !dependencies.files.exists(record.managedRoot)) {
      await releaseApplyBaseBestEffort(record)
      updateManagedCheckout(record.checkoutId, (current) => ({
        ...current,
        phase: 'discarded',
        journal: null,
        revision: current.revision + 1,
      }))
      return { status: 'discarded', target: await inspectIsolated(binding) }
    }
    // 本地适配：worktree 目录连同 git 顶层已被外部删除（用户手动清理等）。
    // 磁盘上没有可保护的内容，身份无从验证；放弃任务应清台账并 prune 残余
    // 注册，而不是把用户引向注定失败的恢复流程。
    if (
      record.phase === 'ready'
      && !dependencies.files.exists(record.managedRoot)
      && !dependencies.files.exists(record.managedGitRoot)
    ) {
      await dependencies.git.pruneWorktrees?.(record.localRoot).catch(() => undefined)
      await releaseApplyBaseBestEffort(record)
      updateManagedCheckout(record.checkoutId, (current) => ({
        ...current,
        phase: 'discarded',
        journal: null,
        revision: current.revision + 1,
      }))
      return { status: 'discarded', target: await inspectIsolated(binding) }
    }
    if (record.phase !== 'ready' && record.phase !== 'recovery_required') {
      return operationError('operation_not_allowed', hostMessage('cannotDiscardInTheCurrentState', { p0: record.phase }), await inspectIsolated(binding))
    }

    let inspected: SessionTargetView
    let dirty = true
    if (record.phase === 'ready') {
      inspected = await inspectIsolated(binding)
      if (inspected.checkout.phase !== 'ready') {
        return operationError('recovery_required', hostMessage('theIsolatedCheckoutIdentityCannotBeVerifiedRecoveryIs'), inspected)
      }
      record = dependencies.registry.read().managedCheckouts[record.checkoutId]
      if (!record || record.phase !== 'ready') {
        return operationError('recovery_required', hostMessage('theIsolatedCheckoutStateHasChangedRecoveryIsRequired'))
      }
      dirty = (await dependencies.git.status(record.managedRoot)).dirty || (record.checkpoints?.length ?? 0) > 0
    } else {
      try {
        dirty = (await dependencies.git.status(record.managedRoot)).dirty || (record.checkpoints?.length ?? 0) > 0
      } catch {
        dirty = true
      }
      inspected = recoveryView(binding, record, dirty)
    }
    if (dirty && !input.confirmDirty) {
      const checkpointDetail = (record.checkpoints?.length ?? 0) > 0
        ? hostMessage('confirmationWillPermanentlyDeleteCheckpointsNotYetDeliveredTo', { p0: record.checkpoints!.length })
        : ''
      return operationError('dirty_confirmation_required', hostMessage('theIsolatedCheckoutHasUncommittedChangesUndeliveredCheckpointsOr', { p0: checkpointDetail }), inspected)
    }

    // codex 对齐：带未提交内容放弃前先快照（tracked 修改 + 未 ignore 的
    // untracked 文件），失败则中止放弃——数据保护优先。逃逸口=手动删除
    // managed 目录后重试，走 worktree 已消失的丢弃路径。
    if (dirty && dependencies.git.snapshotAbandonedWorktree) {
      let snapshotOid: string
      try {
        snapshotOid = await dependencies.git.snapshotAbandonedWorktree(record.localRoot, record.managedRoot, record.checkoutId)
      } catch (error) {
        return operationError('git_operation_failed', hostMessage('worktreeDiscardAbortedBecauseTheAbandonedSnapshotFailed', {
          p0: error instanceof Error ? error.message : String(error),
        }), await inspectIsolated(binding))
      }
      updateManagedCheckout(record.checkoutId, (current) => ({
        ...current,
        abandonedSnapshotOid: snapshotOid,
        abandonedSnapshotAt: Date.now(),
        revision: current.revision + 1,
      }))
    }

    try {
      await dependencies.git.removeWorktree(record.localRoot, record.managedGitRoot)
    } catch {
      return operationError('git_operation_failed', hostMessage('failedToDeleteTheManagedCheckout'), await inspectIsolated(binding))
    }
    try {
      dependencies.files.removeEmptyDirectoryTree(record.managedGitRoot)
    } catch {
      // 尽力清理：git 移除成功后偶发的空壳（例如宿主重建 cwd 所致）。
    }
    await releaseApplyBaseBestEffort(record)
    updateManagedCheckout(record.checkoutId, (current) => ({
      ...current,
      phase: 'discarded',
      journal: null,
      revision: current.revision + 1,
    }))
    return { status: 'discarded', target: await inspectIsolated(binding) }
  }

  async function operateRecover(
    input: Extract<SessionCheckoutOperation, { action: 'recover' }>,
    binding: SessionBindingRecord,
  ): Promise<SessionCheckoutOperationResult> {
    if (binding.ownerSessionId !== input.sessionId) {
      return operationError('not_owner', hostMessage('aSessionThatInheritedItsSessionTargetCannotPerform192'))
    }
    if (binding.target.kind !== 'isolated') {
      return operationError('operation_not_allowed', hostMessage('localCheckoutDoesNotSupportRecover'))
    }

    let record = dependencies.registry.read().managedCheckouts[binding.target.checkoutId]
    if (!record) return operationError('checkout_missing', hostMessage('theIsolatedCheckoutRecordDoesNotExist'))
    if (record.revision !== input.expectedRevision) {
      return operationError('stale_target', hostMessage('theSessionTargetHasChangedRefreshAndRetry'), await inspectIsolated(binding))
    }
    // 终态记录（已交付/已放弃）即使目录还有残留也不能被 Recover 复活成 ready：
    // 那会让已完成的任务重新出现在进行中列表里。收口交给 reconcile/cleanup。
    if (record.delivery.state === 'delivered'
      || record.phase === 'discarded'
      || record.phase === 'finalized'
      || record.phase === 'retained') {
      return operationError('operation_not_allowed', hostMessage('thisWorktreeHasAlreadyReachedATerminalDeliveryState'))
    }
    const recoverCreate = record.journal?.operation === 'create'
    if (record.journal?.operation === 'create' && record.journal.creation && hasCreationResidue(record)) {
      return operationError('recovery_unsafe', hostMessage('theIsolatedCheckoutIdentityCannotBeVerifiedRecoveryIs'))
    }
    if ((record.journal !== null && !recoverCreate) || record.phase === 'mutating') {
      // journal 记录的是可重放的 receipt：先让 reconcile 按 receipt 前进/回退到确定态
      // （ready 或 recovery_required），而不是一律拒绝、把用户卡在手工等待里。
      await reconcile()
      const refreshed = dependencies.registry.read().managedCheckouts[binding.target.checkoutId]
      if (!refreshed) return operationError('checkout_missing', hostMessage('theIsolatedCheckoutRecordDoesNotExist'))
      record = refreshed
      if (record.phase !== 'ready' || record.journal !== null) {
        return operationError(
          'recovery_unsafe',
          hostMessage('cannotSafelyDetermineWhetherApplyModifiedLocalItWill'),
          await inspectIsolated(binding),
        )
      }
    }
    if (!dependencies.files.exists(record.managedRoot)) {
      return operationError('recovery_required', hostMessage('theIsolatedCheckoutIsMissingOnlyAnExplicitDiscard'))
    }

    const validated = await validateManagedCheckout(binding, record, recoverCreate)
    if (!validated) {
      return operationError('recovery_unsafe', hostMessage('theIsolatedCheckoutPathGitIdentityProjectHEADOr'))
    }

    updateManagedCheckout(record.checkoutId, (current) => ({
      ...current,
      managedRoot: validated.canonicalManagedRoot,
      managedGitRoot: validated.canonicalManagedGitRoot,
      gitDir: validated.snapshot.gitDir,
      phase: 'ready',
      journal: null,
      revision: current.revision + 1,
    }))
    return { status: 'recovered', target: await inspectIsolated(binding) }
  }

  async function operateTarget(input: SessionCheckoutOperation): Promise<SessionCheckoutOperationResult> {
    try {
      const binding = await resolveBinding(input.sessionId)
      if (input.action === 'apply') return await operateApply(input, binding)
      if (input.action === 'finish') return await operateFinish(input, binding)
      if (input.action === 'preview') return await operatePreview(input, binding)
      if (input.action === 'checkpoint') return await operateCheckpoint(input, binding)
      if (input.action === 'rollback_preview') return await operateRollbackPreview(input, binding)
      if (input.action === 'finalize_preview') return await operateFinalizePreview(input, binding)
      if (input.action === 'retry_cleanup') return await operateRetryCleanup(input, binding)
      if (input.action === 'discard') return await operateDiscard(input, binding)
      if (input.action === 'recover') return await operateRecover(input, binding)
      const exhaustive: never = input
      return exhaustive
    } catch (error) {
      if (error instanceof SessionCheckoutError) return operationError(error.code, error.message)
      throw error
    }
  }

  function managedIteration(record: ManagedCheckoutRecord): number {
    if (record.delivery.state === 'working' || record.delivery.state === 'delivered') return record.delivery.iteration
    return record.delivery.review.iteration
  }

  function managedUpdatedAt(record: ManagedCheckoutRecord): number {
    if (record.delivery.state === 'working') return record.journal?.startedAt ?? 0
    if (record.delivery.state === 'ready_for_review') return record.delivery.review.preparedAt
    if (record.delivery.state === 'preview_active') return record.delivery.preview.previewedAt
    if (record.delivery.state === 'preview_detached') return record.delivery.detachedAt
    if (record.delivery.state === 'finalized') return record.delivery.finalizedAt
    if (record.delivery.state === 'retained') return record.delivery.retainedAt
    return record.delivery.deliveredAt
  }

  async function summarizeManagedWorktree(
    record: ManagedCheckoutRecord,
    includeDiagnostics = false,
  ): Promise<ManagedWorktreeSummaryView> {
    // 快速列表必须保守且不扫描 Git/磁盘；只有后台单项诊断完成后才开放清理。
    let dirty = true
    let cleanupResidue = false
    let approximateBytes: number | null = null
    if (includeDiagnostics) {
      if (record.delivery.state === 'finalized' || record.delivery.state === 'retained') {
        const quarantine = await validateCleanupQuarantine(record)
        const residue = quarantine ? undefined : await validateDetachedCleanupResidue(record, true)
        if (quarantine || residue) {
          cleanupResidue = true
          dirty = false
        } else if (dependencies.files.exists(record.managedRoot)) {
          try {
            const snapshot = await dependencies.applyEngine.inspectReview({
              baseOid: record.applyBaseOid ?? record.baseOid,
              isolatedPath: record.managedRoot,
              localPath: record.localRoot,
            })
            dirty = snapshot.status !== 'ready' || snapshot.isolatedFingerprint !== record.delivery.isolatedFingerprint
          } catch { dirty = true }
        }
      } else if (dependencies.files.exists(record.managedRoot)) {
        try { dirty = (await dependencies.git.status(record.managedRoot)).dirty } catch { dirty = true }
      }
      const physicalRoot = record.journal?.operation === 'cleanup' && record.journal.cleanupQuarantinePath
        ? record.journal.cleanupQuarantinePath
        : record.managedGitRoot
      if (dependencies.files.exists(physicalRoot)) {
        try { approximateBytes = await dependencies.files.measureDirectoryBytes(physicalRoot) } catch { approximateBytes = null }
      }
    }
    const delivery = record.delivery
    const staleRoot = record.phase !== 'discarded' && !dependencies.files.exists(record.localRoot)
    const state: ManagedWorktreeSummaryView['state'] = staleRoot
      ? 'needs_attention'
      : record.phase === 'recovery_required'
      ? 'needs_attention'
      : delivery.state === 'retained'
        ? delivery.cleanup === 'blocked' ? 'needs_attention' : 'retained'
        : delivery.state === 'finalized'
          ? delivery.cleanup === 'blocked' ? 'needs_attention' : 'cleanup_pending'
          : delivery.state === 'preview_active'
            ? 'preview_active'
            : delivery.state === 'preview_detached'
              ? 'needs_attention'
              : delivery.state === 'ready_for_review'
            ? 'ready_for_review'
            : delivery.state === 'delivered'
              ? 'delivered'
              : 'working'
    const commitOid = delivery.state === 'finalized' || delivery.state === 'retained' || delivery.state === 'delivered'
      ? delivery.commitOid
      : null
    const cleanupMessage = cleanupResidue
      ? hostPersistedCleanupMessage(CLEANUP_RESIDUE_MESSAGE, hostMessage, 'cleanupResidue')
      : delivery.state === 'finalized' || delivery.state === 'retained'
        ? delivery.cleanupMessage === undefined
          ? undefined
          : hostPersistedCleanupMessage(delivery.cleanupMessage, hostMessage, delivery.cleanupMessageKey)
        : undefined
    const cleanupReason = cleanupResidue
      ? 'detached_residue' as const
      : delivery.state === 'finalized' || delivery.state === 'retained'
        ? persistedCleanupReason(delivery)
        : undefined
    return {
      checkoutId: record.checkoutId,
      revision: record.revision,
      ownerSessionId: record.ownerSessionId,
      ownerSessionTitle: dependencies.lookup.getSession(record.ownerSessionId)?.title?.trim() || hostMessage('deletedAgentSession'),
      project: { id: record.projectId, name: record.projectName },
      iteration: managedIteration(record),
      state,
      phase: record.phase,
      dirty,
      // 台账里就有分支名（建树时 attach、交付后仍在），列表因此不必为每棵树
      // 跑一次 git——模型却要靠它才知道这棵树的工作落在哪条分支上。
      branch: branchNameOf(record.sessionBranch),
      commitOid,
      ...((record.checkpoints?.length ?? 0) > 0 ? { checkpointCount: record.checkpoints!.length } : {}),
      ...(delivery.state === 'retained' ? {
        retention: delivery.retention,
        retainedAt: delivery.retainedAt,
        expiresAt: delivery.expiresAt,
      } : {}),
      ...(record.permanent === true ? { permanent: true } : {}),
      ...(cleanupMessage ? { cleanupMessage: hostPersistedCleanupMessage(cleanupMessage, hostMessage) } : {}),
      ...(cleanupReason ? { cleanupReason } : {}),
      approximateBytes,
      updatedAt: managedUpdatedAt(record),
      canCleanup: includeDiagnostics && (delivery.state === 'retained' || delivery.state === 'finalized') && !dirty,
    }
  }

  function cleanupBlocked(reason: ManagedWorktreeCleanupView['reason'], message: string, revision: number): ManagedWorktreeCleanupView {
    return { eligibility: 'blocked', reason, message, inspectedRevision: revision }
  }

  async function inspectCleanupForRecord(record: ManagedCheckoutRecord): Promise<ManagedWorktreeCleanupView> {
    if (record.delivery.state === 'working') return cleanupBlocked('working', hostMessage('theCurrentIterationIsStillBeingEditedAndHas'), record.revision)
    if (record.delivery.state === 'ready_for_review') return cleanupBlocked('review_pending', hostMessage('theCurrentIterationIsAwaitingAcceptanceAndCannotBe'), record.revision)
    if (record.delivery.state === 'preview_active' || record.delivery.state === 'preview_detached') {
      return cleanupBlocked('preview_active', hostMessage('localPreviewHasNotBeenSafelyResolvedAndCannot'), record.revision)
    }
    if (record.delivery.state === 'delivered' || record.phase === 'discarded') {
      return cleanupBlocked('unknown', hostMessage('worktreeHasBeenDeliveredAndReleasedFromManagementNo'), record.revision)
    }
    if (record.delivery.commitOid && record.delivery.proof) {
      const local = await validateCommittedLocalCheckout(bindingForManagedRecord(record), record)
      if (!local) return cleanupBlocked('identity_mismatch', hostMessage('theLocalCheckoutIdentityCannotBeVerifiedThisIteration'), record.revision)
      try {
        const delivered = await dependencies.git.isAncestor(local.canonicalLocalRoot, record.delivery.commitOid, local.snapshot.headOid)
        if (!delivered) return cleanupBlocked('identity_mismatch', hostMessage('thisIterationSDeliveryCommitIsNoLongerIn'), record.revision)
      } catch {
        return cleanupBlocked('unknown', hostMessage('cannotVerifyWhetherThisIterationSDeliveryCommitIs'), record.revision)
      }
    }
    const quarantine = await validateCleanupQuarantine(record)
    const residue = quarantine ? undefined : await validateDetachedCleanupResidue(record, true)
    if (record.journal?.operation === 'cleanup' && record.journal.cleanupQuarantinePath && !quarantine) {
      return cleanupBlocked('identity_mismatch', hostMessage('theCleanupDirectoryIdentityCannotBeReverifiedTheEnvironment'), record.revision)
    }
    if (!quarantine && !residue && dependencies.files.exists(record.managedRoot)) {
      const binding = bindingForManagedRecord(record)
      const validated = await validateManagedCheckout(binding, record, false)
      if (!validated) return cleanupBlocked('identity_mismatch', hostMessage('theWorktreeCheckoutIdentityCannotBeVerifiedTheEnvironment'), record.revision)
      try {
        const snapshot = await dependencies.applyEngine.inspectReview({
          baseOid: record.applyBaseOid ?? record.baseOid,
          isolatedPath: record.managedRoot,
          localPath: record.localRoot,
        })
        if (snapshot.status !== 'ready' || snapshot.isolatedFingerprint !== record.delivery.isolatedFingerprint) {
          return cleanupBlocked('uncommitted_changes', hostMessage('newChangesWereDetectedAfterCommitOrRetentionBulk'), record.revision)
        }
      } catch {
        return cleanupBlocked('unknown', hostMessage('cannotProveTheCurrentWorktreeStateIsSafeThe'), record.revision)
      }
    }
    if (record.delivery.cleanup === 'blocked' || record.delivery.cleanup === 'pending') {
      const cleanupReason = persistedCleanupReason(record.delivery)
      const cleanupMessage = record.delivery.cleanupMessage ? hostPersistedCleanupMessage(record.delivery.cleanupMessage, hostMessage) : hostMessage('thePreviousCleanupDidNotFinishRevalidateAndRetry')
      if (cleanupReason === 'identity_changed') return cleanupBlocked('identity_mismatch', cleanupMessage, record.revision)
      if (cleanupReason === 'modified_after_finalize') return cleanupBlocked('uncommitted_changes', cleanupMessage, record.revision)
    }
    if (
      record.delivery.state === 'retained'
      && (record.delivery.retention === 'retain_manual' || record.delivery.expiresAt === null || record.delivery.expiresAt > Date.now())
    ) {
      return { eligibility: 'retained', reason: 'retention_active', message: record.delivery.retention === 'retain_manual' ? hostMessage('retainedManuallyAtTheUserSRequest') : hostMessage('theRetentionPeriodHasNotExpired'), inspectedRevision: record.revision }
    }
    return { eligibility: 'safe', reason: 'cleanup_failed', message: record.delivery.cleanupMessage ? hostPersistedCleanupMessage(record.delivery.cleanupMessage, hostMessage) : hostMessage('readOnlySafetyInspectionPassedCleanupIsAvailable'), inspectedRevision: record.revision }
  }

  async function inspectManagedWorktreeCleanup(input: ListManagedWorktreesInput = {}): Promise<ManagedWorktreeSummaryView[]> {
    const records = Object.values(dependencies.registry.read().managedCheckouts)
      .filter((record) => record.phase !== 'discarded')
      .filter((record) => !input.projectId || record.projectId === input.projectId)
      .filter((record) => !input.checkoutId || record.checkoutId === input.checkoutId)
    const summaries = await Promise.all(records.map(async (record) => ({
      ...(await summarizeManagedWorktree(record, true)),
      cleanup: await inspectCleanupForRecord(record),
    })))
    return summaries
      .filter((summary) => !input.needsAttention || summary.cleanup?.eligibility === 'blocked')
      .sort((left, right) => right.updatedAt - left.updatedAt)
  }

  async function bulkCleanupManagedWorktrees(
    candidates: BulkCleanupManagedWorktreeCandidate[],
  ): Promise<BulkCleanupManagedWorktreesResult> {
    const cleaned: BulkCleanupManagedWorktreesResult['cleaned'] = []
    const retained: BulkCleanupManagedWorktreesResult['retained'] = []
    const uniqueCandidates = [...new Map(candidates.map((candidate) => [candidate.checkoutId, candidate])).values()]
      .sort((left, right) => left.checkoutId.localeCompare(right.checkoutId))
    for (const candidate of uniqueCandidates) {
      const record = dependencies.registry.read().managedCheckouts[candidate.checkoutId]
      if (!record || record.phase === 'discarded') continue
      if (record.revision !== candidate.expectedRevision) {
        retained.push({
          checkoutId: record.checkoutId,
          iteration: managedIteration(record),
          cleanup: cleanupBlocked('unknown', hostMessage('theWorktreeRevisionHasChangedCleanupWasNotPerformed'), record.revision),
        })
        continue
      }
      const inspection = await inspectCleanupForRecord(record)
      if (inspection.eligibility !== 'safe') {
        retained.push({ checkoutId: record.checkoutId, iteration: managedIteration(record), cleanup: inspection })
        continue
      }
      const latest = dependencies.registry.read().managedCheckouts[candidate.checkoutId]
      if (!latest || latest.revision !== candidate.expectedRevision) {
        retained.push({
          checkoutId: record.checkoutId,
          iteration: managedIteration(record),
          cleanup: cleanupBlocked('unknown', hostMessage('worktreeChangedBeforeCleanupCleanupWasNotPerformed'), latest?.revision ?? record.revision),
        })
        continue
      }
      const result = await cleanupFinalized(latest, { allowLegacyResidue: true })
      const updated = dependencies.registry.read().managedCheckouts[candidate.checkoutId]
      if (result.cleaned) {
        cleaned.push({
          checkoutId: record.checkoutId,
          iteration: managedIteration(record),
          commitOid: record.delivery.state === 'finalized' || record.delivery.state === 'retained' ? record.delivery.commitOid : null,
        })
      } else if (updated) {
        retained.push({
          checkoutId: updated.checkoutId,
          iteration: managedIteration(updated),
          cleanup: await inspectCleanupForRecord(updated),
        })
      }
    }
    return { cleaned, retained }
  }

  async function listManagedWorktrees(input: ListManagedWorktreesInput = {}): Promise<ManagedWorktreeSummaryView[]> {
    const records = Object.values(dependencies.registry.read().managedCheckouts)
      .filter((record) => record.phase !== 'discarded')
      .filter((record) => !input.projectId || record.projectId === input.projectId)
      .filter((record) => !input.checkoutId || record.checkoutId === input.checkoutId)
    const summaries = await Promise.all(records.map((record) => summarizeManagedWorktree(record, input.includeDiagnostics === true)))
    return summaries
      .filter((summary) => !input.needsAttention || summary.state === 'needs_attention' || summary.state === 'cleanup_pending')
      .sort((left, right) => right.updatedAt - left.updatedAt)
  }

  async function listManagedWorktreesForSession(
    sessionId: string,
    input: Omit<ListManagedWorktreesInput, 'projectId'> = {},
  ): Promise<ManagedWorktreeSummaryView[]> {
    const session = requireSession(sessionId)
    const persisted = getPersistedBinding(sessionId)
    const projectId = persisted?.projectId ?? session.projectId
    if (!projectId) throw new SessionCheckoutError('project_not_found', hostMessage('theSessionIsNotAssociatedWithAProject'))
    const allowedCheckoutIds = new Set(Object.values(dependencies.registry.read().managedCheckouts)
      .filter((record) => record.projectId === projectId)
      .filter((record) => record.ownerSessionId === sessionId || record.sourceSessionId === sessionId)
      .map((record) => record.checkoutId))
    const summaries = await listManagedWorktrees({ ...input, projectId })
    return summaries.filter((summary) => allowedCheckoutIds.has(summary.checkoutId))
  }

  /**
   * Safe-prune core shared by the session tool and the maintenance sweep:
   * fully merged tips only (`git branch -d` semantics), current and trunk
   * branches never enter the candidate set. `olderThanDays` additionally
   * requires the tip committer date to be older than the cutoff; omit it for
   * no age filter (manual tool callers keep the unfiltered behavior).
   */
  async function pruneMergedBranchesInRepo(
    localRoot: string,
    input: { dryRun?: boolean; olderThanDays?: number } = {},
  ): Promise<PruneMergedBranchesView> {
    const { branchOverview, isAncestor, deleteLocalBranch, branchTipTimes, defaultBranch } = dependencies.git
    if (!branchOverview || !isAncestor || !deleteLocalBranch) {
      throw new SessionCheckoutError('operation_not_allowed', hostMessage('theGitPortOfThisInstallationDoesNotSupportBranchPrune'))
    }
    const overview = await branchOverview(localRoot)
    if (!overview) {
      throw new SessionCheckoutError('git_operation_failed', hostMessage('gitOperationFailedGit', { p0: 'for-each-ref', p1: '' }))
    }
    const headBranch = overview.branches.find((branch) => branch.isCurrent) ?? null
    // 安全删只认「已完全合并」：tip 可达主干才算；当前分支与主干分支永不进入候选。
    // 主干名从仓库推断（origin/HEAD → init.defaultBranch），不能假设 main/master。
    const trunkName = defaultBranch ? await defaultBranch(localRoot) : null
    const trunkBranches = new Set(['main', 'master', ...(trunkName ? [trunkName] : [])])
    const trunkBranch = trunkName ? overview.branches.find((branch) => branch.name === trunkName) ?? null : null
    // 合并基准：优先主干（分支已并入主干即可删，哪怕当前 HEAD 停在其他分支上）；
    // 主干未知或不存在时退回当前 HEAD，保持旧行为。
    const mergeTarget = trunkBranch ?? headBranch
    const dryRun = input.dryRun === true
    const cutoff = input.olderThanDays === undefined ? null : Date.now() - input.olderThanDays * 86_400_000
    // 年龄过滤需要 tip 时间；port 未实现时跳过全部候选而不是放宽为不过滤。
    let tipTimes: Record<string, number> | null = null
    if (cutoff !== null) {
      if (!branchTipTimes) {
        throw new SessionCheckoutError('operation_not_allowed', hostMessage('theGitPortOfThisInstallationDoesNotSupportBranchPrune'))
      }
      tipTimes = await branchTipTimes(localRoot)
    }
    const pruned: PruneMergedBranchEntry[] = []
    const skipped: PruneMergedBranchEntry[] = []
    // 会话分支归插件管：它可能已经合并、也过了年龄门槛，但还有一条会话断言自己
    // 在那条分支上工作。删掉它，那个会话的下一次交付就写到一个不存在的地方。
    const activeSessionBranches = new Set(
      Object.values(dependencies.registry.read().managedCheckouts)
        .filter((record) => record.phase !== 'discarded')
        .map((record) => record.sessionBranch)
        .filter((ref): ref is string => ref !== undefined)
        .map((ref) => ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref),
    )
    const headOid = mergeTarget?.oid
    if (headOid) {
      for (const branch of overview.branches) {
        if (branch.isCurrent || trunkBranches.has(branch.name)) continue
        if (activeSessionBranches.has(branch.name)) {
          skipped.push({ name: branch.name, oid: branch.oid, reason: hostMessage('thisBranchBelongsToALiveManagedCheckout') })
          continue
        }
        let merged: boolean
        try {
          merged = await isAncestor(localRoot, branch.oid, headOid)
        } catch {
          skipped.push({ name: branch.name, oid: branch.oid, reason: hostMessage('cannotVerifyWhetherThisBranchIsFullyMerged') })
          continue
        }
        if (!merged) {
          skipped.push({ name: branch.name, oid: branch.oid, reason: hostMessage('thisBranchHasCommitsNotYetMergedInto', { p0: mergeTarget?.name ?? 'HEAD' }) })
          continue
        }
        if (tipTimes && cutoff !== null) {
          const tipTime = tipTimes[branch.name] ?? 0
          if (tipTime >= cutoff) {
            skipped.push({ name: branch.name, oid: branch.oid, reason: hostMessage('branchTipYoungerThanCutoffDays', { p0: String(input.olderThanDays ?? 0) }) })
            continue
          }
        }
        if (dryRun) {
          pruned.push({ name: branch.name, oid: branch.oid })
          continue
        }
        const result = await deleteLocalBranch(localRoot, branch.name)
        if (result.deleted) pruned.push({ name: branch.name, oid: branch.oid })
        else skipped.push({ name: branch.name, oid: branch.oid, reason: result.reason || hostMessage('gitOperationFailedGit', { p0: 'branch -d', p1: '' }) })
      }
    }
    return { dryRun, headBranch: headBranch?.name ?? null, pruned, skipped }
  }

  async function pruneMergedBranchesForSession(
    sessionId: string,
    input: PruneMergedBranchesInput = {},
  ): Promise<PruneMergedBranchesView> {
    const session = requireSession(sessionId)
    const persisted = getPersistedBinding(sessionId)
    const projectId = persisted?.projectId ?? session.projectId
    if (!projectId) throw new SessionCheckoutError('project_not_found', hostMessage('theSessionIsNotAssociatedWithAProject'))
    const project = dependencies.lookup.getProject(projectId)
    const localRoot = project?.root ?? Object.values(dependencies.registry.read().managedCheckouts)
      .filter((record) => record.projectId === projectId)
      .filter((record) => record.ownerSessionId === sessionId || record.sourceSessionId === sessionId)
      .map((record) => record.localRoot)
      .find((root) => root.length > 0)
    if (!localRoot) throw new SessionCheckoutError('project_not_found', hostMessage('theSessionIsNotAssociatedWithAProject'))
    return pruneMergedBranchesInRepo(localRoot, input)
  }

  /**
   * Maintenance sweep: safe-prune fully merged stale branches in every managed
   * project's Local root. Per-project failures are reported as a skipped entry,
   * never thrown — one broken repository must not block the others.
   */
  async function autoPruneStaleMergedBranches(olderThanDays: number): Promise<PruneMergedBranchesView[]> {
    const projectRoots = new Set<string>()
    for (const record of Object.values(dependencies.registry.read().managedCheckouts)) {
      const root = dependencies.lookup.getProject(record.projectId)?.root ?? record.localRoot
      if (root && dependencies.files.exists(root)) projectRoots.add(root)
    }
    const results: PruneMergedBranchesView[] = []
    for (const root of projectRoots) {
      try {
        results.push(await pruneMergedBranchesInRepo(root, { olderThanDays }))
      } catch (error) {
        results.push({
          dryRun: false,
          headBranch: null,
          pruned: [],
          skipped: [{ name: root, oid: '', reason: error instanceof Error ? error.message : String(error) }],
        })
      }
    }
    return results
  }

  async function mergeBranchForSession(sessionId: string, input: MergeBranchForSessionInput): Promise<MergeBranchForSessionView> {
    const session = requireSession(sessionId)
    const persisted = getPersistedBinding(sessionId)
    const projectId = persisted?.projectId ?? session.projectId
    if (!projectId) throw new SessionCheckoutError('project_not_found', hostMessage('theSessionIsNotAssociatedWithAProject'))
    const project = dependencies.lookup.getProject(projectId)
    const records = Object.values(dependencies.registry.read().managedCheckouts)
      .filter((record) => record.projectId === projectId)
      .filter((record) => record.ownerSessionId === sessionId || record.sourceSessionId === sessionId)
    const localRoot = project?.root ?? records.map((record) => record.localRoot).find((root) => root.length > 0)
    if (!localRoot) throw new SessionCheckoutError('project_not_found', hostMessage('theSessionIsNotAssociatedWithAProject'))
    const { mergeLocalBranch, branchOverview } = dependencies.git
    if (!mergeLocalBranch || !branchOverview) {
      throw new SessionCheckoutError('operation_not_allowed', hostMessage('theGitPortOfThisInstallationDoesNotSupportBranchMerge'))
    }
    const sourceBranch = input.sourceBranch.trim()
    if (!sourceBranch) throw new SessionCheckoutError('invalid_input', hostMessage('worktreeMergeSourceBranchRequired'))
    if (input.direction !== undefined && input.direction !== 'forward' && input.direction !== 'reverse') {
      throw new SessionCheckoutError('invalid_input', hostMessage('worktreeMergeDirectionInvalid', { p0: input.direction }))
    }
    const direction = input.direction === 'reverse' ? 'reverse' : 'forward'
    // 门控：sourceBranch 必须是本会话某个托管 worktree 的当前分支；Local 自身分支不可作为来源。
    // 会话分支名直接来自记录，即使该 worktree 当前脱离分支（历史记录、checkpoint 后）
    // 也仍然认得出「这是本会话的分支」。
    const managedRootByBranch = new Map<string, string>()
    for (const record of records) {
      if (record.sessionBranch) {
        managedRootByBranch.set(branchNameOf(record.sessionBranch) ?? record.sessionBranch, record.managedGitRoot)
      }
      const overview = await branchOverview(record.managedGitRoot)
      const current = overview?.branches.find((branch) => branch.isCurrent)
      if (current) managedRootByBranch.set(current.name, record.managedGitRoot)
    }
    const localOverview = await branchOverview(localRoot)
    const localBranch = localOverview?.branches.find((branch) => branch.isCurrent)?.name ?? null
    if (localBranch === sourceBranch) {
      throw new SessionCheckoutError('invalid_input', hostMessage('worktreeMergeSourceIsLocalHead', { p0: sourceBranch }))
    }
    const managedRoot = managedRootByBranch.get(sourceBranch)
    if (!managedRoot) {
      // 归因：这条分支是否属于**另一个会话**？并行会话里这几乎总是误操作，
      // 明确说出来比「不是本会话的」好诊断。
      const foreign = Object.values(dependencies.registry.read().managedCheckouts)
        .find((record) => record.projectId === projectId
          && record.ownerSessionId !== sessionId
          && record.sourceSessionId !== sessionId
          && (branchNameOf(record.sessionBranch) === sourceBranch
            || branchNameOf(record.sourceRef) === sourceBranch))
      if (foreign) {
        throw new SessionCheckoutError(
          'not_owner',
          hostMessage('worktreeMergeSourceBelongsAnotherSession', { p0: sourceBranch, p1: foreign.ownerSessionId }),
        )
      }
      throw new SessionCheckoutError('not_owner', hostMessage('worktreeMergeSourceNotOwnedBySession', { p0: sourceBranch }))
    }
    const dryRun = input.dryRun === true
    // 与 checkpoint/preflight 同一互斥源：项目 Local 已有 acceptance slot holder
    // （含本会话自己）时，任何真实合并都会绕过 preview 收据直接改写 Local，必须拒绝。
    // dryRun 只在临时 worktree 试合，不改工作树，保持可预览。
    if (!dryRun) {
      const holder = findProjectAcceptanceHolder({ checkoutId: '', localRoot }, { includeSelf: true })
      if (holder) {
        throw new SessionCheckoutError('project_acceptance_busy', hostMessage('anotherTaskIsOccupyingThisProjectSLocalAcceptance'))
      }
    }
    if (direction === 'reverse') {
      // 反向同步：把 Local 当前分支合进任务 worktree 的当前分支；冲突现场留在任务 worktree。
      if (!localBranch) {
        throw new SessionCheckoutError('invalid_input', hostMessage('worktreeMergeLocalHeadDetached'))
      }
      const result = await mergeLocalBranch(managedRoot, localBranch, { dryRun })
      return { direction, dryRun, sourceBranch, localBranch, targetBranch: sourceBranch, ...result }
    }
    const result = await mergeLocalBranch(localRoot, sourceBranch, { dryRun })
    return { direction, dryRun, sourceBranch, localBranch, targetBranch: localBranch, ...result }
  }

  async function listAbandonedWorktreeSnapshots(sessionId: string): Promise<AbandonedWorktreeSnapshotView[]> {
    const session = requireSession(sessionId)
    const persisted = getPersistedBinding(sessionId)
    const projectId = persisted?.projectId ?? session.projectId
    if (!projectId) throw new SessionCheckoutError('project_not_found', hostMessage('theSessionIsNotAssociatedWithAProject'))
    return Object.values(dependencies.registry.read().managedCheckouts)
      .filter((record) => record.abandonedSnapshotOid !== undefined)
      .filter((record) => record.projectId === projectId)
      .filter((record) => record.ownerSessionId === sessionId || record.sourceSessionId === sessionId)
      .map((record) => ({
        checkoutId: record.checkoutId,
        projectName: record.projectName,
        snapshotOid: record.abandonedSnapshotOid!,
        snapshotAt: record.abandonedSnapshotAt ?? 0,
        revision: record.revision,
      }))
  }

  async function restoreAbandonedWorktreeSnapshot(sessionId: string, checkoutId: string): Promise<{ branch: string }> {
    requireSession(sessionId)
    const record = dependencies.registry.read().managedCheckouts[checkoutId]
    if (!record) throw new SessionCheckoutError('checkout_missing', hostMessage('theWorktreeRecordDoesNotExist'))
    if (record.ownerSessionId !== sessionId && record.sourceSessionId !== sessionId) {
      throw new SessionCheckoutError('not_owner', hostMessage('theCurrentSessionIsNotAllowedToManageThis'))
    }
    const snapshotOid = record.abandonedSnapshotOid
    if (!snapshotOid) throw new SessionCheckoutError('operation_not_allowed', hostMessage('thisWorktreeHasNoAbandonedSnapshotTo'))
    if (!dependencies.git.restoreAbandonedSnapshot) {
      throw new SessionCheckoutError('operation_not_allowed', hostMessage('theCurrentSessionCheckoutModuleDoesNotSupportAbandonedSnapshotRestore'))
    }
    if (!dependencies.files.exists(record.localRoot)) {
      throw new SessionCheckoutError('operation_not_allowed', hostMessage('theLocalRepositoryIsMissingSoTheAbandoned'))
    }
    const branch = await dependencies.git.restoreAbandonedSnapshot(record.localRoot, checkoutId, snapshotOid)
    updateManagedCheckout(checkoutId, (current) => ({
      ...current,
      abandonedSnapshotOid: undefined,
      abandonedSnapshotAt: undefined,
      revision: current.revision + 1,
    }))
    return { branch }
  }

  async function manageManagedWorktreeForSession(
    sessionId: string,
    input: ManageManagedWorktreeInput,
  ): Promise<ManagedWorktreeSummaryView> {
    requireSession(sessionId)
    const record = dependencies.registry.read().managedCheckouts[input.checkoutId]
    if (!record) throw new SessionCheckoutError('checkout_missing', hostMessage('theWorktreeRecordDoesNotExist'))
    if (record.ownerSessionId !== sessionId && record.sourceSessionId !== sessionId) {
      throw new SessionCheckoutError('not_owner', hostMessage('theCurrentSessionIsNotAllowedToManageThis'))
    }
    if (record.ownerSessionId !== sessionId && dependencies.lookup.getSession(record.ownerSessionId)) {
      throw new SessionCheckoutError('not_owner', hostMessage('theOwnerSessionHasTakenOverThisWorktreeOnly'))
    }
    const persisted = getPersistedBinding(sessionId)
    const callerProjectId = persisted?.projectId ?? dependencies.lookup.getSession(sessionId)?.projectId
    if (callerProjectId !== record.projectId) {
      throw new SessionCheckoutError('project_mismatch', hostMessage('theCurrentSessionAndWorktreeDoNotBelongTo'))
    }
    return manageManagedWorktree(input)
  }

  async function manageManagedWorktree(input: ManageManagedWorktreeInput): Promise<ManagedWorktreeSummaryView> {
    const record = dependencies.registry.read().managedCheckouts[input.checkoutId]
    if (!record) throw new SessionCheckoutError('checkout_missing', hostMessage('theWorktreeRecordDoesNotExist'))
    if (record.revision !== input.expectedRevision) throw new SessionCheckoutError('stale_target', hostMessage('theWorktreeStateHasChangedRefreshAndRetry'))
    if (input.action === 'discard') {
      // Caller authorization is performed by the scoped wrapper (or a trusted Host manager).
      // The reserved owner Session may not exist yet, so do not re-resolve it through lookup.
      const result = await operateDiscard({
        action: 'discard',
        sessionId: record.ownerSessionId,
        expectedRevision: input.expectedRevision,
        confirmDirty: input.confirmDirty === true,
        ...(input.rollbackPreview === undefined ? {} : { rollbackPreview: input.rollbackPreview }),
      }, bindingForManagedRecord(record))
      if (result.status === 'error') throw new SessionCheckoutError(result.code, result.message)
      const updated = dependencies.registry.read().managedCheckouts[record.checkoutId]
      if (!updated) throw new SessionCheckoutError('checkout_missing', hostMessage('theWorktreeRecordDoesNotExist'))
      return summarizeManagedWorktree(updated)
    }
    if (input.action === 'set_retention') {
      if (record.phase !== 'retained' || record.delivery.state !== 'retained' || !input.retention) {
        throw new SessionCheckoutError('operation_not_allowed', hostMessage('onlyRetainedFrozenWorktreesCanHaveTheirRetentionPeriod'))
      }
      const retainedAt = Date.now()
      const updated = updateManagedCheckout(record.checkoutId, (current) => {
        if (current.delivery.state !== 'retained') return current
        return {
          ...current,
          delivery: {
            ...current.delivery,
            retention: input.retention!,
            retainedAt,
            expiresAt: retentionExpiresAt(input.retention!, retainedAt),
            cleanup: 'scheduled',
            cleanupMessage: undefined,
          },
          revision: current.revision + 1,
        }
      })
      if (!updated) throw new SessionCheckoutError('checkout_missing', hostMessage('theWorktreeRecordDoesNotExist'))
      return summarizeManagedWorktree(updated)
    }
    if (input.action === 'set_permanent') {
      // codex 对齐：常驻标记豁免自动清理；手动清理（下方 fall-through）不受限制。
      if (record.phase === 'discarded' || record.delivery.state === 'delivered') {
        throw new SessionCheckoutError('operation_not_allowed', hostMessage('aDeliveredWorktreeCannotBeMarkedPermanent'))
      }
      const updated = updateManagedCheckout(record.checkoutId, (current) => {
        if (current.permanent === (input.permanent === true)) return current
        return {
          ...current,
          permanent: input.permanent === true,
          revision: current.revision + 1,
        }
      })
      if (!updated) throw new SessionCheckoutError('checkout_missing', hostMessage('theWorktreeRecordDoesNotExist'))
      return summarizeManagedWorktree(updated)
    }
    if (input.action === 'clear_sidebar_badge') {
      // Terminal-state gating lives in the console control plane (sidebarTaskState).
      // The flag deliberately does not bump revision: any later revision change
      // (new iteration, retention, cleanup) invalidates it on its own.
      if (record.sidebarBadgeClearedRevision === record.revision) return summarizeManagedWorktree(record)
      const cleared = updateManagedCheckout(record.checkoutId, (current) => ({
        ...current,
        sidebarBadgeClearedRevision: current.revision,
      }))
      if (!cleared) throw new SessionCheckoutError('checkout_missing', hostMessage('theWorktreeRecordDoesNotExist'))
      return summarizeManagedWorktree(cleared)
    }
    if (record.delivery.state !== 'retained' && record.delivery.state !== 'finalized') {
      throw new SessionCheckoutError('operation_not_allowed', hostMessage('theCurrentWorktreeIsNotInACleanableState'))
    }
    await cleanupFinalized(record, {
      allowLegacyResidue: true,
      ...(input.discardPostDeliveryChanges === true ? { discardPostDeliveryChanges: true } : {}),
    })
    const updated = dependencies.registry.read().managedCheckouts[record.checkoutId]
    if (!updated) throw new SessionCheckoutError('checkout_missing', hostMessage('theWorktreeRecordDoesNotExist'))
    return summarizeManagedWorktree(updated)
  }

  async function observeManagedCheckout(checkoutId: string) {
    const record = dependencies.registry.read().managedCheckouts[checkoutId]
    if (!record || record.phase === 'discarded') throw new SessionCheckoutError('checkout_missing', hostMessage('theWorktreeDirectoryNoLongerExists'))
    const validated = await validateManagedCheckout(bindingForManagedRecord(record), record, false)
    if (!validated) throw new SessionCheckoutError('checkout_mismatch', hostMessage('theWorktreeDirectoryIdentityCannotBeVerified'))
    // `localSnapshot` rides along because validation already inspected the Local
    // side to prove one shared repository; consumers that need the Local branch
    // (the conversation chip after delivery) would otherwise spawn Git again.
    return {
      managedRoot: validated.canonicalManagedRoot,
      snapshot: validated.snapshot,
      localSnapshot: validated.localSnapshot,
      dirty: validated.status.dirty,
    }
  }

  /** 一次拿锁批量观察多个 checkout；单条失败整体抛错，与逐条 observe 语义一致。 */
  function observeManagedCheckouts(checkoutIds: string[]) {
    return Promise.all(checkoutIds.map((checkoutId) => observeManagedCheckout(checkoutId)))
  }

  async function resolveManagedRoot(checkoutId: string): Promise<string> {
    return (await observeManagedCheckout(checkoutId)).managedRoot
  }

  /**
   * Both boundaries of a managed checkout, read straight from the registry
   * without touching Git. Used to restore a Session cwd that was left pointing
   * inside a checkout the caller is about to remove.
   */
  function resolveRoots(checkoutId: string): { managedRoot: string; localRoot: string } | undefined {
    const record = dependencies.registry.read().managedCheckouts[checkoutId]
    return record ? { managedRoot: record.managedRoot, localRoot: record.localRoot } : undefined
  }

  /**
   * 到期清理只在数据保护判定下停下：identity_changed（目录已被别的东西替换）
   * 与 modified_after_finalize（交付后又有改动）需要人工判断。
   * directory_busy / quarantine_busy 是暂时性文件占用，必须留在定期重试里，
   * 否则一次瞬时失败就会把已到期的目录永久留在磁盘上。
   */
  function retryableCleanupBlock(record: ManagedCheckoutRecord): boolean {
    if (record.delivery.state !== 'retained' || record.delivery.cleanup !== 'blocked') return false
    const reason = persistedCleanupReason(record.delivery)
    return reason === 'directory_busy' || reason === 'quarantine_busy'
  }

  async function cleanupExpiredRetained(now = Date.now()): Promise<string[]> {
    const expired = Object.values(dependencies.registry.read().managedCheckouts).filter((record) => (
      record.phase === 'retained'
      && record.delivery.state === 'retained'
      && (record.delivery.cleanup === 'scheduled' || retryableCleanupBlock(record))
      && record.permanent !== true
      && record.delivery.expiresAt !== null
      && record.delivery.expiresAt <= now
    ))
    const cleaned: string[] = []
    for (const record of expired) {
      try {
        // 到期保留清理同样受收敛超时保护，避免单个占用记录卡住后续启动。
        const result = await withCleanupTimeout(record.checkoutId, () => cleanupFinalized(record))
        if (result?.cleaned) cleaned.push(record.checkoutId)
      } catch (error) {
        console.warn(`[session-checkout] expired retained Worktree cleanup skipped: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return cleaned
  }

  /**
   * codex 对齐：按 worktree-keep-count LRU 收口托管 Worktree 总量。
   * 配额数的是磁盘上真实存在的托管 Worktree，进行中的会话同样占地方，
   * 所以统计包含它们；逐出只从已交付（finalized/retained）里挑。
   * 逐出走完整 discard 安全链（含 G2 放弃前快照），confirmDirty 跳过人工确认。
   */
  async function enforceWorktreeKeepCount(): Promise<string[]> {
    const limitRaw = liveConfigValue(dependencies.worktreeKeepCount)
    const limit = typeof limitRaw === 'number' ? Math.floor(limitRaw) : 0
    if (!Number.isFinite(limit) || limit <= 0) return []
    const managed = Object.values(dependencies.registry.read().managedCheckouts)
      .filter((record) => record.permanent !== true && record.phase !== 'discarded')
    const ordered = managed
      .filter((record) => (
        (record.phase === 'finalized' || record.phase === 'retained')
        && (record.delivery.state === 'finalized' || record.delivery.state === 'retained')
      ))
      .sort((left, right) => managedUpdatedAt(left) - managedUpdatedAt(right))
    const evictable = ordered.slice(0, Math.max(0, managed.length - limit))
    const cleaned: string[] = []
    for (const record of evictable) {
      // 逐出一个已交付 Worktree 就是普通清理：走 cleanupFinalized 的目录身份校验
      // 与隔离/残留链。不能复用 operateDiscard——它只接受 ready/recovery_required，
      // 对 finalized/retained 一律返回 operation_not_allowed，逐出会静默全失败。
      const result = await withCleanupTimeout(record.checkoutId, () => cleanupFinalized(record))
      if (result?.cleaned) cleaned.push(record.checkoutId)
      else console.warn(`[session-checkout] keep-count Worktree eviction skipped: ${record.checkoutId}`)
    }
    return cleaned
  }

  async function beginNextIterationTarget(
    sessionId: string,
    expectedRevision: number,
  ): Promise<SessionTargetView> {
    const session = requireSession(sessionId)
    const registry = dependencies.registry.read()
    const previousBinding = registry.sessionBindings[sessionId]
    if (!previousBinding || previousBinding.target.kind !== 'isolated') {
      throw new SessionCheckoutError('operation_not_allowed', hostMessage('onlyADeliveredIsolatedSessionCanBeginTheNext'))
    }
    const predecessor = registry.managedCheckouts[previousBinding.target.checkoutId]
    if (!predecessor) throw new SessionCheckoutError('checkout_missing', hostMessage('thePreviousIterationSWorktreeRecordDoesNotExist'))
    if (predecessor.ownerSessionId !== sessionId || previousBinding.ownerSessionId !== sessionId) {
      throw new SessionCheckoutError('not_owner', hostMessage('onlyTheOwnerSessionCanBeginTheNextIteration'))
    }
    if (predecessor.revision !== expectedRevision) {
      throw new SessionCheckoutError('stale_target', hostMessage('theWorktreeStateHasChangedRefreshBeforeBeginningThe'))
    }
    if (predecessor.phase !== 'discarded' || predecessor.delivery.state !== 'delivered') {
      throw new SessionCheckoutError('operation_not_allowed', hostMessage('onlyADeliveredStateWithSuccessfulCleanupCanBegin'))
    }
    if (!session.projectId) throw new SessionCheckoutError('project_not_found', hostMessage('theCurrentSessionIsNotAssociatedWithAWorkspace'))
    const ownerWorkspace = dependencies.lookup.getProject(session.projectId)
    // The Session must still be rooted at this Worktree lineage. A separate
    // isolated Session lives at the managed root; an in-place Session lives at
    // the Local boundary and re-enters the managed root on the next iteration,
    // so accepting only the managed root made every in-place next iteration fail
    // right after a successful cleanup (the managed root is gone by then).
    const ownerRootMatches = Boolean(ownerWorkspace) && (
      resolvedPathsEqual(ownerWorkspace!.root, predecessor.managedRoot)
      || resolvedPathsEqual(ownerWorkspace!.root, predecessor.localRoot)
    )
    if (!ownerRootMatches) {
      throw new SessionCheckoutError('project_mismatch', hostMessage('theCurrentSessionSImmutableCwdDoesNotMatch'))
    }
    if (dependencies.files.exists(predecessor.managedGitRoot) || dependencies.files.exists(predecessor.managedRoot)) {
      throw new SessionCheckoutError('checkout_mismatch', hostMessage('thePreviousIterationSWorktreePathHasReappearedUnknown'))
    }

    const localProject = dependencies.lookup.getProject(predecessor.projectId)
    if (!localProject || !dependencies.files.exists(localProject.root) || !dependencies.files.exists(predecessor.localRoot)) {
      throw new SessionCheckoutError('project_root_missing', hostMessage('theOriginalLocalProjectIsUnavailableTheNextIteration'))
    }
    const canonicalProjectRoot = await dependencies.files.canonicalize(localProject.root)
    const canonicalLocalRoot = await dependencies.files.canonicalize(predecessor.localRoot)
    if (!pathsEqual(canonicalProjectRoot, canonicalLocalRoot)) {
      throw new SessionCheckoutError('project_mismatch', hostMessage('theOriginalLocalProjectIdentityHasChanged'))
    }
    const snapshot = await dependencies.git.inspect(canonicalLocalRoot)
    if (!snapshot || !pathsEqual(snapshot.commonDir, predecessor.gitCommonDir)) {
      throw new SessionCheckoutError('checkout_mismatch', hostMessage('theOriginalLocalGitIdentityHasChanged'))
    }
    const projectRelativePath = relative(snapshot.root, canonicalLocalRoot)
    if (projectRelativePath.startsWith('..') || isAbsolute(projectRelativePath)) {
      throw new SessionCheckoutError('checkout_mismatch', hostMessage('theProjectRootIsNotInsideItsGitCheckout'))
    }
    // 交付只写会话分支、Local 永远不动，所以上一轮的提交在 Local HEAD 上看不到：
    // 新迭代必须以「上一轮会话分支的 tip」为起点，否则迭代链会在交付处断开，
    // 上一轮的工作内容整段丢失。分支解析不到（被删/被改名）才退回 Local HEAD。
    const predecessorBranch = branchNameOf(predecessor.sessionBranch) ?? branchNameOf(predecessor.sourceRef)
    const predecessorTip = predecessorBranch === null
      ? null
      : await dependencies.git.resolveLocalBranchTip(canonicalLocalRoot, predecessorBranch)
    const iterationBaseOid = predecessorTip ?? snapshot.headOid
    if (!resolvedPathsEqual(resolve(predecessor.managedGitRoot, projectRelativePath), predecessor.managedRoot)) {
      throw new SessionCheckoutError('checkout_mismatch', hostMessage('thePreviousIterationSManagedProjectPathCannotBe'))
    }

    const managedContainer = dirname(predecessor.managedGitRoot)
    if (!dependencies.files.exists(managedContainer)) dependencies.files.ensureDirectory(managedContainer)
    const containerIdentity = await dependencies.files.inspectDirectoryIdentity(managedContainer)
    if (!containerIdentity) throw new SessionCheckoutError('checkout_mismatch', hostMessage('theWorktreeContainerIsNotATrustedDirectory'))
    const canonicalContainer = await dependencies.files.canonicalize(managedContainer)
    if (!resolvedPathsEqual(canonicalContainer, managedContainer)) {
      throw new SessionCheckoutError('checkout_mismatch', hostMessage('theWorktreeContainerPathHasBeenRedirected'))
    }

    const checkoutId = dependencies.createCheckoutId()
    const iteration = predecessor.delivery.iteration + 1
    const record: ManagedCheckoutRecord = {
      checkoutId,
      predecessorCheckoutId: predecessor.checkoutId,
      projectId: predecessor.projectId,
      projectName: predecessor.projectName,
      ownerSessionId: sessionId,
      ...(predecessor.sourceSessionId ? { sourceSessionId: predecessor.sourceSessionId } : {}),
      localRoot: canonicalLocalRoot,
      managedRoot: predecessor.managedRoot,
      managedGitRoot: predecessor.managedGitRoot,
      gitCommonDir: snapshot.commonDir,
      gitDir: '',
      baseOid: iterationBaseOid,
      sourceRef: snapshot.headRef,
      phase: 'preparing',
      delivery: { state: 'working', iteration },
      journal: {
        operation: 'create',
        operationId: dependencies.createCheckoutId(),
        step: 'creating_worktree',
        startedAt: Date.now(),
      },
      revision: predecessor.revision + 1,
    }
    const binding: SessionBindingRecord = {
      sessionId,
      projectId: predecessor.projectId,
      projectName: predecessor.projectName,
      target: { kind: 'isolated', checkoutId },
      ownerSessionId: sessionId,
      sourceRef: snapshot.headRef,
      sourceOid: iterationBaseOid,
      revision: previousBinding.revision + 1,
    }
    registry.sessionBindings[sessionId] = binding
    registry.managedCheckouts[checkoutId] = record
    registry.revision += 1
    dependencies.registry.write(registry)

    try {
      await dependencies.git.createDetachedWorktree(snapshot.root, predecessor.managedGitRoot, iterationBaseOid,
        evidence => saveCreationEvidence(checkoutId, record.journal!.operationId, evidence))
      const canonicalManagedGitRoot = await dependencies.files.canonicalize(predecessor.managedGitRoot)
      const canonicalManagedRoot = await dependencies.files.canonicalize(predecessor.managedRoot)
      const containerAfterCreate = await dependencies.files.inspectDirectoryIdentity(managedContainer)
      const created = await dependencies.git.inspect(canonicalManagedRoot)
      if (
        !containerAfterCreate
        || !directoryIdentitiesEqual(containerIdentity, containerAfterCreate)
        || !resolvedPathsEqual(canonicalManagedGitRoot, predecessor.managedGitRoot)
        || !resolvedPathsEqual(canonicalManagedRoot, predecessor.managedRoot)
        || !created
        || !pathsEqual(created.root, canonicalManagedGitRoot)
        || !pathsEqual(created.commonDir, snapshot.commonDir)
        || created.headOid !== iterationBaseOid
      ) {
        throw new SessionCheckoutError('checkout_mismatch', hostMessage('theNextIterationSCheckoutGitIdentityDoesNot'))
      }
      const readyRegistry = dependencies.registry.read()
      const current = readyRegistry.managedCheckouts[checkoutId]
      if (!current || current.phase !== 'preparing') {
        throw new SessionCheckoutError('stale_target', hostMessage('theStateChangedWhileCreatingTheNextIterationS'))
      }
      // 下一轮同样落在（新的）会话分支上，交付才有一条属于本会话的分支可写。
      // 主题沿用上一轮记录里的值，避免同一会话的迭代之间分支命名漂移。
      const iterationTopic = predecessor.sessionTopic ?? predecessor.projectName
      const attached = await attachSessionBranch({
        localRoot: canonicalLocalRoot,
        managedRoot: canonicalManagedRoot,
        sessionId,
        topic: iterationTopic,
      })
      readyRegistry.managedCheckouts[checkoutId] = {
        ...current,
        managedRoot: canonicalManagedRoot,
        managedGitRoot: canonicalManagedGitRoot,
        gitDir: created.gitDir,
        ...(attached
          ? { sessionBranch: attached.branchRef, sourceRef: attached.branchRef, sessionTopic: iterationTopic }
          : {}),
        phase: 'ready',
        journal: null,
        revision: current.revision + 1,
      }
      const readyBinding: SessionBindingRecord = attached
        ? { ...binding, sourceRef: attached.branchRef, sourceOid: created.headOid }
        : binding
      readyRegistry.sessionBindings[sessionId] = readyBinding
      readyRegistry.revision += 1
      dependencies.registry.write(readyRegistry)
      return inspectIsolated(readyBinding)
    } catch (error) {
      finishFailedCreation(sessionId, checkoutId, error, previousBinding)
      let partialCheckout: GitCheckoutSnapshot | null = null
      try {
        if (dependencies.files.exists(join(predecessor.managedGitRoot, '.git'))) {
          partialCheckout = await dependencies.git.inspect(predecessor.managedRoot)
        }
      } catch {
        partialCheckout = null
      }
      if (partialCheckout) {
        const current = dependencies.registry.read().managedCheckouts[checkoutId]
        if (current) markRecoveryRequired(current)
        throw error
      }

      let residueRemoved = false
      try {
        residueRemoved = dependencies.files.removeEmptyDirectoryTree(predecessor.managedGitRoot)
      } catch {
        residueRemoved = false
      }
      if (!residueRemoved) {
        const current = dependencies.registry.read().managedCheckouts[checkoutId]
        if (current) markRecoveryRequired(current)
        throw new SessionCheckoutError('recovery_required', hostMessage('creatingTheNextIterationSWorktreeFailedAndIts'))
      }

      const failedRegistry = dependencies.registry.read()
      delete failedRegistry.managedCheckouts[checkoutId]
      const currentBinding = failedRegistry.sessionBindings[sessionId]
      if (currentBinding?.target.kind === 'isolated' && currentBinding.target.checkoutId === checkoutId) {
        failedRegistry.sessionBindings[sessionId] = { ...previousBinding, revision: previousBinding.revision + 1 }
      }
      failedRegistry.revision += 1
      dependencies.registry.write(failedRegistry)
      throw new SessionCheckoutError('git_operation_failed', error instanceof Error ? error.message : String(error))
    }
  }

  /** 本地适配：仓库移动后，旧台账记录的 localRoot/gitDir 指向失效路径，Worktree 的
   *  `.git` 指针也随之断链。绑定到有效 Git 项目时，若当前仓库的 `.git/worktrees`
   *  下仍保留该 checkout 的管理目录，则用 `git worktree repair` 重连 Worktree，
   *  并把台账记录搬迁到当前项目；验证失败的记录保持原样。 */
  async function copyWorktreeincludeFiles(sourceRoot: string, targetRoot: string): Promise<void> {
    if (!dependencies.files.readTextFile || !dependencies.files.copyFile || !dependencies.git.listWorktreeincludeFiles) return
    try {
      const includeFile = join(sourceRoot, '.worktreeinclude')
      const content = dependencies.files.readTextFile(includeFile)
      // 空文件/全注释须跳过：空清单会让交集退化为「全部 gitignored」
      if (!content?.split('\n').some((line) => { const trimmed = line.trim(); return trimmed !== '' && !trimmed.startsWith('#') })) return
      const files = await dependencies.git.listWorktreeincludeFiles(sourceRoot, includeFile)
      for (const relative of files) {
        const target = join(targetRoot, relative)
        if (dependencies.files.exists(target)) continue
        // codex 对齐：跳过符号链接——链接目标可能在 checkout 之外。
        if (await dependencies.files.isSymbolicLink?.(join(sourceRoot, relative))) continue
        try {
          dependencies.files.copyFile(join(sourceRoot, relative), target)
        } catch (error) {
          console.warn(`[dsh-git-worktree] .worktreeinclude copy failed for ${relative}:`, error instanceof Error ? error.message : error)
        }
      }
    } catch (error) {
      console.warn('[dsh-git-worktree] .worktreeinclude copy skipped:', error instanceof Error ? error.message : error)
    }
  }

  /** codex 对齐：新 Worktree 继承本地未提交修改——tracked 修改走 diff 补丁，
   *  非 ignore 的 untracked 文件逐个复制。只在调用方确认基点与本地 HEAD 一致
   *  时调用（补丁基于本地 HEAD 生成）。任何失败只告警：本地副本始终完好，
   *  携带是尽力而为，绝不阻断创建。 */
  async function carryLocalWorkInProgress(sourceRoot: string, targetRoot: string): Promise<void> {
    const { captureLocalWip, applyWorktreePatch, listUntrackedFiles } = dependencies.git
    if (!captureLocalWip || !applyWorktreePatch) return
    try {
      const patch = await captureLocalWip(sourceRoot)
      if (patch !== null) await applyWorktreePatch(targetRoot, patch)
    } catch (error) {
      console.warn('[dsh-git-worktree] local WIP carry skipped:', error instanceof Error ? error.message : error)
    }
    if (!listUntrackedFiles || !dependencies.files.copyFile) return
    let untracked: string[] = []
    try {
      untracked = await listUntrackedFiles(sourceRoot)
    } catch (error) {
      console.warn('[dsh-git-worktree] untracked carry skipped:', error instanceof Error ? error.message : error)
      return
    }
    for (const relative of untracked) {
      const target = join(targetRoot, relative)
      if (dependencies.files.exists(target)) continue
      try {
        dependencies.files.copyFile(join(sourceRoot, relative), target)
      } catch (error) {
        console.warn(`[dsh-git-worktree] untracked carry failed for ${relative}:`, error instanceof Error ? error.message : error)
      }
    }
  }

  async function repairStaleWorktreeLinks(
    projectId: string,
    projectName: string,
    projectRoot: string,
    projectSnapshot: GitCheckoutSnapshot,
  ): Promise<void> {
    const registry = dependencies.registry.read()
    const projectLocalRoot = await dependencies.files.canonicalize(projectRoot)
    let changed = false
    for (const record of Object.values(registry.managedCheckouts)) {
      if (record.phase === 'discarded') continue
      if (dependencies.files.exists(record.localRoot)) continue
      const adminDirName = basename(record.gitDir)
      const adminDir = adminDirName
        ? join(projectSnapshot.commonDir, 'worktrees', adminDirName)
        : undefined
      if (!adminDir || !dependencies.files.exists(adminDir)) continue
      const repaired = await dependencies.git.repairWorktreeLinks?.(projectSnapshot.commonDir, record.managedRoot)
      if (!repaired) continue
      const repairedSnapshot = await dependencies.git.inspect(record.managedRoot).catch(() => null)
      if (!repairedSnapshot || !resolvedPathsEqual(repairedSnapshot.commonDir, projectSnapshot.commonDir)) continue
      record.localRoot = projectLocalRoot
      record.gitCommonDir = projectSnapshot.commonDir
      record.gitDir = adminDir
      record.projectId = projectId
      record.projectName = projectName
      record.revision += 1
      changed = true
    }
    if (changed) {
      registry.revision += 1
      dependencies.registry.write(registry)
    }
  }

  async function bindTarget(
    sessionId: string,
    choice: SessionTargetBindChoice,
    createAttempt = 0,
    requestStartedAt = Date.now(),
    sourceSessionId = sessionId,
    createOptions?: { topic?: string; branch?: string },
  ): Promise<SessionTargetView> {
      const session = requireSession(sourceSessionId)
      let nextIteration = 1
      let replacedDeliveredBinding: SessionBindingRecord | undefined
      const existing = getPersistedBinding(sessionId)
      // An isolated Session whose task already reached Local may be released
      // back to the Local boundary. The Worktree record itself is untouched: it
      // stays readable for its retention window, and only the binding stops
      // pointing at it. A live (undelivered) checkout keeps the old refusal —
      // unbinding mid-task would strand unmerged work in a frozen directory.
      let releasedDeliveredCheckout = false
      if (existing) {
        if (choice.kind === 'local' && existing.target.kind === 'local') {
          return inspectLocal(existing)
        }
        if (choice.kind === 'local' && existing.target.kind === 'isolated') {
          const registry = dependencies.registry.read()
          const record = registry.managedCheckouts[existing.target.checkoutId]
          const delivered = record !== undefined
            && worktreeReachedDelivery(record.phase, record.delivery.state)
            && (record.phase === 'discarded' || record.phase === 'finalized' || record.phase === 'retained')
          if (!delivered) {
            throw new SessionCheckoutError(
              'operation_not_allowed',
              hostMessage('theWorktreeHasNotBeenDeliveredToLocalYet'),
            )
          }
          // The bind below rewrites this Session's binding to Local; the record
          // keeps its own history so the delivered badge and the retention
          // countdown stay correct.
          releasedDeliveredCheckout = true
        } else if (
          choice.kind === 'isolated'
          && existing.target.kind === 'local'
          && sessionId === sourceSessionId
          && createAttempt === 0
          && createOptions !== undefined
        ) {
          // in-place 升级：createIsolatedTarget(sourceSessionId, sourceSessionId, options) 把本会话
          // 从 local 直接升级为 isolated。仅该调用形（带 createOptions）走此分支；
          // 普通 bind(sessionId, {kind:'isolated'}) 不带 options，仍走 target_already_bound。
          // 落入下方创建流程：existing 记录被创建成功后的新 isolated binding 覆盖。
        } else if (choice.kind === 'isolated' && existing.target.kind === 'isolated') {
          const existingView = await inspectIsolated(existing)
          const registry = dependencies.registry.read()
          const existingRecord = registry.managedCheckouts[existing.target.checkoutId]
          if (
            existingView.ownership === 'owner'
            && existingRecord
            && (
              (existingView.checkout.phase === 'discarded' && existingRecord.delivery.state === 'delivered')
              || (existingView.checkout.phase === 'finalized' && existingRecord.delivery.state === 'finalized')
              || (existingView.checkout.phase === 'retained' && existingRecord.delivery.state === 'retained')
            )
          ) {
            nextIteration = managedIteration(existingRecord) + 1
            replacedDeliveredBinding = {
              ...existing,
              target: { ...existing.target },
            }
            delete registry.sessionBindings[sessionId]
            registry.revision += 1
            dependencies.registry.write(registry)
          } else {
            return existingView
          }
        }
        if (
          !releasedDeliveredCheckout
          && !(choice.kind === 'isolated' && existing.target.kind === 'isolated' && nextIteration > 1)
          && !(choice.kind === 'isolated' && existing.target.kind === 'local' && sessionId === sourceSessionId && createAttempt === 0 && createOptions !== undefined)
        ) {
          throw new SessionCheckoutError('target_already_bound', hostMessage('theSessionIsAlreadyBoundToASessionTarget'))
        }
      }

      const { project } = await resolveSessionProject(sourceSessionId)
      const snapshot = await dependencies.git.inspect(project.root)

      if (snapshot) await repairStaleWorktreeLinks(project.id, project.name, project.root, snapshot)

      if (choice.kind === 'local') {
        const binding: SessionBindingRecord = {
          sessionId,
          projectId: project.id,
          projectName: project.name,
          target: { kind: 'local' },
          ownerSessionId: sessionId,
          sourceRef: snapshot?.headRef ?? UNVERSIONED_REF,
          sourceOid: snapshot?.headOid ?? UNVERSIONED_OID,
          revision: 1,
        }
        const registry = dependencies.registry.read()
        registry.sessionBindings[sessionId] = binding
        registry.revision += 1
        dependencies.registry.write(registry)
        return inspectLocal(binding)
      }

      if (!snapshot) {
        const staleRoots = Object.values(dependencies.registry.read().managedCheckouts)
          .filter((record) => record.phase !== 'discarded' && !dependencies.files.exists(record.localRoot))
          .map((record) => record.localRoot)
        if (staleRoots.length > 0) {
          throw new SessionCheckoutError('not_git_repository', hostMessage(
            'theProjectRootIsNotAGitRepositoryAndTheLedgerReferencesStaleRoots',
            { p0: project.root, p1: staleRoots.join('; ') },
          ))
        }
        throw new SessionCheckoutError('not_git_repository', hostMessage('aNonGitProjectCannotCreateAnIsolatedCheckout'))
      }
      if (snapshot.headOid === 'unborn') throw new SessionCheckoutError('operation_not_allowed', hostMessage('initialConfirmationRequired'))
      // managed Worktree 不再使用全局数量硬上限；生命周期通过交付后清理收口。
      const checkoutId = dependencies.createCheckoutId()
      const localRoot = await dependencies.files.canonicalize(project.root)
      const localGitRoot = await dependencies.files.canonicalize(snapshot.root)
      // 本地适配（按分支创建）：以指定本地分支的当前指向为起点。sourceRef/sourceOid
      // 仍记录源会话的分支与 HEAD，交付语义不变（交付目标是源会话检出的分支）。
      let baseOid = snapshot.headOid
      if (createOptions?.branch !== undefined) {
        const tip = await dependencies.git.resolveLocalBranchTip(localGitRoot, createOptions.branch)
        if (tip === null) throw new SessionCheckoutError('invalid_input', hostMessage('branchDoesNotExist'))
        baseOid = tip
      }
      const repositoryKey = createManagedWorktreeRepositoryKey(localGitRoot)
      const pathCandidates = [8, 12, 32].map(identityLength => createManagedWorktreePathCandidates({
        localGitRoot,
        managedCheckoutsRoot: dependencies.managedCheckoutsRoot,
        repositoryKey,
        checkoutId,
        identityLength,
      }))
      // Prefer one repository-owned sibling container so Local never sees its
      // managed worktrees as untracked. A container that is a file/symlink is
      // untrusted and falls back without modification. Existing child paths
      // are never reused or cleaned: extend the trusted checkout identity.
      const outerContainingRoot = await dependencies.git.findContainingWorktreeRoot(dirname(localGitRoot))
      const siblingWouldPolluteOuter = outerContainingRoot !== null && !pathsEqual(outerContainingRoot, localGitRoot)
      const usingSibling = createAttempt === 0 && !siblingWouldPolluteOuter
      // 配置 worktreesRoot 时 sibling 与 fallback 指向同一容器，重试只会面对
      // 同一个目录与同一份内容，注定再失败一次。
      const fallbackContainerDiffers = !pathsEqual(
        pathCandidates[0]!.siblingContainer,
        pathCandidates[0]!.fallbackContainer,
      )
      const managedContainer = usingSibling
        ? pathCandidates[0]!.siblingContainer
        : pathCandidates[0]!.fallbackContainer
      const knownContainer = Object.values(dependencies.registry.read().managedCheckouts)
        .some(record => pathsEqual(dirname(record.managedGitRoot), managedContainer))
      const containerExisted = dependencies.files.exists(managedContainer)
      let containerCreationError: unknown
      let containerIdentity = containerExisted
        ? await dependencies.files.inspectDirectoryIdentity(managedContainer)
        : null
      if (containerExisted && containerIdentity !== null && !knownContainer) {
        // A same-named directory with unknown content is not ours. An empty
        // directory has no user bytes to preserve, so remove/recreate it as the
        // ownership boundary; a non-empty tree is left untouched and rejected.
        let reclaimedEmpty = false
        try { reclaimedEmpty = dependencies.files.removeEmptyDirectoryTree(managedContainer) } catch { /* fail closed below */ }
        if (!reclaimedEmpty) containerIdentity = null
        else {
          try {
            dependencies.files.ensureDirectory(managedContainer)
            containerIdentity = await dependencies.files.inspectDirectoryIdentity(managedContainer)
          } catch {
            containerIdentity = null
          }
        }
      } else if (!containerExisted) {
        try {
          dependencies.files.ensureDirectory(managedContainer)
          containerIdentity = await dependencies.files.inspectDirectoryIdentity(managedContainer)
        } catch (error) {
          containerIdentity = null
          containerCreationError = error
        }
      }
      if (containerIdentity === null) {
        if (usingSibling && fallbackContainerDiffers) {
          return bindTarget(sessionId, choice, createAttempt + 1, requestStartedAt, sourceSessionId, createOptions)
        }
        // A failed mkdir is environmental (denied permissions, sandbox or
        // antivirus), not untrusted content: report the container path and the
        // OS error so the cause is actionable instead of a blanket trust error.
        const creationCode = (containerCreationError as NodeJS.ErrnoException | undefined)?.code
        if (creationCode === 'EPERM' || creationCode === 'EACCES') {
          throw new SessionCheckoutError('checkout_mismatch', hostMessage(
            'theWorktreeContainerCouldNotBeCreatedOrAccessed',
            { p0: managedContainer, p1: `${creationCode}: ${(containerCreationError as Error).message}` },
          ))
        }
        throw new SessionCheckoutError(
          'checkout_mismatch',
          hostMessage('theFallbackWorktreeContainerIsNotATrustedDirectory', { p0: managedContainer }),
        )
      }
      // 候选只按「磁盘上不存在」来挑会漏掉一个情形：另一条记录仍然声明着这个
      // 路径，而它的目录已经被删掉。那种路径看起来是空的，实际属于别人的台账。
      const claimedPaths = new Set(
        Object.values(dependencies.registry.read().managedCheckouts).map(record => record.managedGitRoot),
      )
      const managedGitRoot = pathCandidates
        .map(candidate => usingSibling ? candidate.siblingRoot : candidate.fallbackRoot)
        .find(candidate => !claimedPaths.has(candidate) && !dependencies.files.exists(candidate))
      if (managedGitRoot === undefined) {
        if (usingSibling) {
          return bindTarget(sessionId, choice, createAttempt + 1, requestStartedAt, sourceSessionId, createOptions)
        }
        throw new SessionCheckoutError(
          'checkout_mismatch',
          hostMessage('allWorktreeCheckoutIdentityPathsAlreadyExistUnknownDirectories'),
        )
      }
      const projectRelativePath = relative(localGitRoot, localRoot)
      if (projectRelativePath.startsWith('..') || isAbsolute(projectRelativePath)) {
        throw new SessionCheckoutError('checkout_mismatch', hostMessage('theProjectRootIsNotInsideItsGitCheckout'))
      }
      const managedRoot = join(managedGitRoot, projectRelativePath)
      const record: ManagedCheckoutRecord = {
        checkoutId,
        projectId: project.id,
        projectName: project.name,
        ownerSessionId: sessionId,
        sourceSessionId,
        localRoot,
        managedRoot: resolve(managedRoot),
        managedGitRoot: resolve(managedGitRoot),
        gitCommonDir: snapshot.commonDir,
        gitDir: '',
        baseOid,
        sourceRef: snapshot.headRef,
        phase: 'preparing',
        delivery: { state: 'working', iteration: nextIteration },
        journal: {
          operation: 'create',
          operationId: dependencies.createCheckoutId(),
          step: 'creating_worktree',
          startedAt: Date.now(),
        },
        revision: 1,
      }
      const binding: SessionBindingRecord = {
        sessionId,
        projectId: project.id,
        projectName: project.name,
        target: { kind: 'isolated', checkoutId },
        ownerSessionId: sessionId,
        sourceRef: snapshot.headRef,
        sourceOid: snapshot.headOid,
        revision: 1,
      }
      const preparingRegistry = dependencies.registry.read()
      preparingRegistry.sessionBindings[sessionId] = binding
      preparingRegistry.managedCheckouts[checkoutId] = record
      preparingRegistry.revision += 1
      dependencies.registry.write(preparingRegistry)

      try {
        await dependencies.git.createDetachedWorktree(localGitRoot, managedGitRoot, baseOid,
          evidence => saveCreationEvidence(checkoutId, record.journal!.operationId, evidence))
        const canonicalManagedGitRoot = await dependencies.files.canonicalize(managedGitRoot)
        const canonicalManagedRoot = await dependencies.files.canonicalize(managedRoot)
        const created = await dependencies.git.inspect(canonicalManagedRoot)
        if (
          !created
          || !pathsEqual(created.root, canonicalManagedGitRoot)
          || !pathsEqual(created.commonDir, snapshot.commonDir)
        ) {
          throw new SessionCheckoutError('checkout_mismatch', hostMessage('theNewCheckoutSGitCommonDirectoryDoesNot'))
        }
        await copyWorktreeincludeFiles(snapshot.root, canonicalManagedRoot)
        // 会话分支：创建阶段就把 Worktree 挂到自己的分支上，而不是留在
        // detached HEAD。交付只写这条分支，所以它的名字必须能说明属于哪个会话。
        const attached = await attachSessionBranch({
          localRoot: localGitRoot,
          managedRoot: canonicalManagedRoot,
          sessionId,
          topic: createOptions?.topic,
        })
        // codex 对齐：仅当受管基点与本地 HEAD 一致时继承未提交修改——补丁
        // 以本地 HEAD 为基准，基点不同（按分支创建且分支 tip ≠ HEAD）则不适用。
        if (baseOid === snapshot.headOid && liveConfigValue(dependencies.inheritLocalChanges) !== false) {
          await carryLocalWorkInProgress(localGitRoot, canonicalManagedRoot)
        }
        const readyRegistry = dependencies.registry.read()
        const readyRecord: ManagedCheckoutRecord = {
          ...record,
          managedRoot: canonicalManagedRoot,
          managedGitRoot: canonicalManagedGitRoot,
          gitDir: created.gitDir,
          // sourceRef 从「Local 当时所在的分支」改为「本会话自己的分支」：
          // 旧语义会让侧栏与交付都把别人的分支当成这个 Worktree 的归属。
          ...(attached
            ? { sessionBranch: attached.branchRef, sourceRef: attached.branchRef, ...(createOptions?.topic ? { sessionTopic: createOptions.topic } : {}) }
            : {}),
          phase: 'ready',
          journal: null,
          revision: record.revision + 1,
        }
        const readyBinding: SessionBindingRecord = attached
          ? { ...binding, sourceRef: attached.branchRef, sourceOid: created.headOid }
          : binding
        readyRegistry.managedCheckouts[checkoutId] = readyRecord
        readyRegistry.sessionBindings[sessionId] = readyBinding
        readyRegistry.revision += 1
        dependencies.registry.write(readyRegistry)
        return inspectIsolated(readyBinding)
      } catch (error) {
        finishFailedCreation(sessionId, checkoutId, error, replacedDeliveredBinding)
        let partialCheckout: GitCheckoutSnapshot | null = null
        try {
          // 仓库内布局下，残余目录会被 git 识别为上层主仓库 checkout；
          // 有效 worktree 必须带 .git 文件（git worktree add 创建），否则视为残余。
          if (dependencies.files.exists(join(managedGitRoot, '.git'))) {
            partialCheckout = await dependencies.git.inspect(managedRoot)
          }
        } catch {
          partialCheckout = null
        }
        if (partialCheckout) {
          markRecoveryRequired(record)
          throw error
        }

        let residueRemoved = false
        try {
          residueRemoved = dependencies.files.removeEmptyDirectoryTree(managedGitRoot)
        } catch {
          residueRemoved = false
        }
        if (!residueRemoved) {
          markRecoveryRequired(record)
          throw new SessionCheckoutError(
            'recovery_required',
            hostMessage('worktreeCreationFailedAndTheRemainingDirectoryContainsUnknown'),
          )
        }

        const failedRegistry = dependencies.registry.read()
        delete failedRegistry.managedCheckouts[checkoutId]
        const currentBinding = failedRegistry.sessionBindings[sessionId]
        if (currentBinding?.target.kind === 'isolated' && currentBinding.target.checkoutId === checkoutId) {
          if (replacedDeliveredBinding) {
            failedRegistry.sessionBindings[sessionId] = replacedDeliveredBinding
          } else {
            delete failedRegistry.sessionBindings[sessionId]
          }
        }
        failedRegistry.revision += 1
        dependencies.registry.write(failedRegistry)

        if (createAttempt < 1) {
          return bindTarget(sessionId, choice, createAttempt + 1, requestStartedAt, sourceSessionId, createOptions)
        }
        throw new SessionCheckoutError('git_operation_failed', hostMessage('worktreeCreationFailedTheRemainingDirectoryWasSafelyCleaned'))
      }
  }

  async function createOfficialTarget(
    agent: unknown,
    createOptions?: { topic?: string; branch?: string },
  ): Promise<IsolatedTargetLaunch> {
    const sessionId = (agent as { session?: { id?: unknown } } | undefined)?.session?.id
    if (typeof sessionId !== 'string' || sessionId === '') {
      throw new SessionCheckoutError('invalid_input', hostMessage('worktreeToolsCanOnlyBeCalledInADSH'))
    }
    const official = dependencies.officialWorktrees?.()
    if (official === undefined) {
      throw new SessionCheckoutError(
        'operation_not_allowed',
        'No worktrees service is mounted on this host, so dsh-git-worktree cannot create one.',
      )
    }
    return withBindingLock(async () => {
      const { project } = await resolveSessionProject(sessionId)
      // 已经站在这棵树里时复用而不是再建一棵：官方每条请求都真的执行
      // `git worktree add`，重复调用会留下没人认领的第二棵树。
      const bound = getPersistedBinding(sessionId)
      if (bound?.target.kind === 'isolated') {
        const record = dependencies.registry.read().managedCheckouts[bound.target.checkoutId]
        if (record !== undefined && record.phase !== 'discarded') {
          return {
            targetSessionId: sessionId,
            managedRoot: record.managedRoot,
            target: await inspectTarget(sessionId),
          }
        }
      }
      // 官方服务把分支名同时当目录名，同名会直接失败，所以挑一个还没被占用的。
      const name = await firstFreeBranchName(project.root, createSessionBranchCandidates({
        sessionId,
        topic: createOptions?.topic,
      }))
      const created = await official.create(agent, {
        name,
        ...(createOptions?.branch === undefined ? {} : { from: createOptions.branch }),
      })
      // 官方只做 `git worktree add`，这两件是官方没有、本插件补的能力：带上
      // `.worktreeinclude` 列的 gitignored 文件，并在基点就是本地 HEAD 时继承
      // 未提交修改（补丁以本地 HEAD 为基准，基点不同则不适用）。
      const createdSnapshot = await dependencies.git.inspect(created.path)
      const localSnapshot = await dependencies.git.inspect(project.root)
      if (localSnapshot !== null) {
        // 项目 Skills 只存在于工作区、不在 Git 里：官方建树不认识它们，必须单独携过去。
        await dependencies.git.carryProjectSkills?.(localSnapshot.root, created.path)
        await copyWorktreeincludeFiles(localSnapshot.root, created.path)
        if (
          created.baseCommit === localSnapshot.headOid
          && liveConfigValue(dependencies.inheritLocalChanges) !== false
        ) {
          await carryLocalWorkInProgress(localSnapshot.root, created.path)
        }
      }
      const record = await registerOfficialWorktree(
        {
          lookup: dependencies.lookup,
          git: dependencies.git,
          registry: dependencies.registry,
          createCheckoutId: dependencies.createCheckoutId,
        },
        {
          ownerSessionId: sessionId,
          projectId: project.id,
          projectName: project.name,
          localRoot: project.root,
          path: created.path,
          baseCommit: created.baseCommit,
          ...(createOptions?.topic === undefined ? {} : { sessionTopic: createOptions.topic }),
          ...(createdSnapshot === null ? {} : { snapshot: createdSnapshot }),
        },
      )
      return {
        targetSessionId: sessionId,
        managedRoot: record.managedRoot,
        target: await inspectTarget(sessionId),
      }
    })
  }

  async function firstFreeBranchName(root: string, candidates: readonly string[]): Promise<string> {
    for (const candidate of candidates) {
      if (await dependencies.git.resolveLocalBranchTip(root, candidate) === null) return candidate
    }
    throw new SessionCheckoutError(
      'operation_not_allowed',
      `Every candidate branch name for this Session already exists: ${candidates.join(', ')}`,
    )
  }

  /**
   * 会话走进 `.agents/worktrees/` 下的树时把它接进台账。
   *
   * 官方 `create_worktree` 与 forge 面板建的树只存在于磁盘上，本插件的列表、
   * 交付、评审、清理全靠台账定位，所以必须在这一刻补记。已有的 binding 与已
   * 在台账里的树都会被跳过，重复的 cwd 事件不会产生第二条记录。
   */
  /**
   * 最近一次「官方建的树没能接进台账」的原因，按会话记。
   *
   * 不进台账的树对本插件的列表、交付、清理都是隐形的，用户看到的现象会是
   * 「树明明建了，胶囊说没有」。这不是可以静默的失败，所以留在内存里等胶囊
   * 下一次轮询取走——它只在进程内有效，重启后那棵树已经在盘上，重进一次就会
   * 重新触发登记。
   */
  const adoptionFailures = new Map<string, string>()

  function recordAdoptionFailure(sessionId: string, reason: string): void {
    adoptionFailures.set(sessionId, reason)
  }

  function adoptionFailure(sessionId: string): string | null {
    return adoptionFailures.get(sessionId) ?? null
  }

  async function adoptOfficialWorktree(sessionId: string, cwd: string): Promise<void> {
    await withBindingLock(async () => {
      await adoptWorktreeForSession(
        {
          lookup: dependencies.lookup,
          git: dependencies.git,
          registry: dependencies.registry,
          createCheckoutId: dependencies.createCheckoutId,
        },
        sessionId,
        cwd,
      )
    })
    adoptionFailures.delete(sessionId)
  }

  return {
    inspect: inspectAvailable,
    runtimeContext,
    adoptOfficialWorktree,
    recordAdoptionFailure,
    adoptionFailure,
    preflight: (sessionId, expectedRevision) => withBindingLock(
      () => preflightTarget(sessionId, expectedRevision),
    ),
    preflightPreviewRecovery: (sessionId, expectedRevision, expectedReviewId, expectedPreviewId) => withBindingLock(
      () => preflightPreviewRecoveryTarget(sessionId, expectedRevision, expectedReviewId, expectedPreviewId),
      { allowConcurrentInspect: true },
    ),
    runExclusiveSessionMutation: (sessionId, operation) => withBindingLock(async () => (
      operation(await inspectTarget(sessionId, true))
    )),
    bind: (sessionId, choice) => {
      const requestStartedAt = Date.now()
      return withBindingLock(() => bindTarget(sessionId, choice, 0, requestStartedAt))
    },
    createOfficialTarget,
    beginNextIteration: (sessionId, expectedRevision) => withBindingLock(
      () => beginNextIterationTarget(sessionId, expectedRevision),
    ),
    resumeRevision: (sessionId, expectedRevision, expectedReviewId, recovery) => withBindingLock(
      () => resumeRevisionTarget(sessionId, expectedRevision, expectedReviewId, recovery),
    ),
    prepareReviewRegeneration: (sessionId, expectedRevision, expectedReviewId, requestId) => withBindingLock(
      () => prepareReviewRegenerationTarget(sessionId, expectedRevision, expectedReviewId, requestId),
    ),
    preparePreviewRecoveryAnalysis: (sessionId, proof, requestId) => withBindingLock(
      () => preparePreviewRecoveryAnalysisTarget(sessionId, proof, requestId),
    ),
    createPreviewRecoveryHandoff: (sessionId, proof, targetSessionId, requestId) => withBindingLock(
      () => createPreviewRecoveryHandoffTarget(sessionId, proof, targetSessionId, requestId),
    ),
    markReadyForReview: (sessionId, input) => withBindingLock(
      () => markReadyForReviewTarget(sessionId, input),
    ),
    operate: (input) => withBindingLock(() => operateTarget(input)),
    // 记录在 API 面暴露 autoDeliver 的实时取值：工具层据此拒绝模型自行交付。
    isAutoDeliverEnabled: (): boolean => liveConfigValue(dependencies.autoDeliver) ?? true,
    // 只读管理列表不占用全局 mutation lock；慢速目录诊断与用户操作互不阻塞。
    listManagedWorktrees,
    listManagedWorktreesForSession,
    pruneMergedBranchesForSession: (sessionId, input) => withBindingLock(
      () => pruneMergedBranchesForSession(sessionId, input),
    ),
    autoPruneStaleMergedBranches: (olderThanDays) => withBindingLock(
      () => autoPruneStaleMergedBranches(olderThanDays),
    ),
    mergeBranchForSession: (sessionId, input) => withBindingLock(
      () => mergeBranchForSession(sessionId, input),
    ),
    listAbandonedWorktreeSnapshots,
    restoreAbandonedWorktreeSnapshot: (sessionId, checkoutId) => withBindingLock(
      () => restoreAbandonedWorktreeSnapshot(sessionId, checkoutId),
    ),
    manageManagedWorktreeForSession: (sessionId, input) => withBindingLock(
      () => manageManagedWorktreeForSession(sessionId, input),
    ),
    inspectManagedWorktreeCleanup,
    bulkCleanupManagedWorktrees: (candidates) => withBindingLock(() => bulkCleanupManagedWorktrees(candidates)),
    manageManagedWorktree: (input) => withBindingLock(() => manageManagedWorktree(input)),
    resolveManagedRoot: (checkoutId) => withBindingLock(() => resolveManagedRoot(checkoutId)),
    resolveRoots,
    observeManagedCheckout: (checkoutId) => withBindingLock(() => observeManagedCheckout(checkoutId)),
    observeManagedCheckouts: (checkoutIds) => withBindingLock(() => observeManagedCheckouts(checkoutIds)),
    cleanupExpiredRetained: (now) => withBindingLock(
      () => cleanupExpiredRetained(now),
      { allowConcurrentInspect: true },
    ),
    enforceWorktreeKeepCount: () => withBindingLock(
      () => enforceWorktreeKeepCount(),
      { allowConcurrentInspect: true },
    ),
    reconcile: () => withBindingLock(reconcile, { allowConcurrentInspect: true }),
  }
}
