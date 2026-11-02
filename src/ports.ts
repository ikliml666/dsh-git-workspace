/**
 * Port interfaces for the session-checkout domain, ported from Domi's
 * `session-checkout/ports.ts`. The domain logic depends only on these ports;
 * the DSH adapters (subprocess-backed git, plugin-owned registry storage,
 * session/workspace lookup) live behind them so the state machine and apply
 * engine stay host-agnostic and testable with fakes.
 * @module dsh-git-worktree/ports
 */

import type {
  ApplyBaseStrategy,
  MergeLocalBranchResult,
  SessionCheckoutPhase,
  SessionTargetRef,
  WorktreeValidationItem,
  WorktreeCleanupReason,
  WorktreeRetentionMode,
  WorktreeValidationStatus,
} from './types.js'
import type { SessionCheckoutApplyEngine } from './session-checkout-apply.js'

export interface SessionCheckoutSessionRecord {
  id: string
  projectId?: string
  /** Only used for readable managed worktree directory names; never identity. */
  title?: string
}

export interface SessionCheckoutProjectRecord {
  id: string
  name: string
  root: string
}

export interface SidebarDirectoryMembership {
  managedRoot: string
  workspaceIds: string[]
  sessionIds: string[]
}

export interface SessionCheckoutLookupPort {
  /** Read-only navigation evidence; never used to authorize a checkout operation. */
  getSidebarMemberships?(managedRoots: readonly string[]): Promise<SidebarDirectoryMembership[]>
  getSession(sessionId: string): SessionCheckoutSessionRecord | undefined
  getProject(projectId: string): SessionCheckoutProjectRecord | undefined
  /**
   * The Session's LIVE working directory, when the host exposes one. A managed
   * owner Session's cwd IS its immutable worktree root while the task runs,
   * whereas `getProject().root` is always the Local checkout — authorizing only
   * against the project root rejects every owner call with `project_mismatch`.
   * Kept separate from `getSession` so the navigation record stays free of
   * authorization evidence. Missing on hosts without the sessions service.
   */
  getSessionCwd?(sessionId: string): string | undefined
  /**
   * Local adaptation: live sessions from the harness sessions store (creation
   * order, header createdAt/cwd). Missing on hosts without the service; the
   * concurrent branch-race guard then stays silent rather than guessing.
   */
  listLiveSessions?(): readonly { id: string; createdAt?: number; cwd?: string }[]
}

export interface GitCheckoutSnapshot {
  root: string
  commonDir: string
  gitDir: string
  branch: string | null
  headOid: string
  headRef: string
}

/** One local branch in the header chip's branch overview (one spawn per refresh). */
export interface BranchOverviewEntry {
  name: string
  oid: string
  isCurrent: boolean
  upstream: string | null
}

/** One local tag in the tag manager (annotated tags keep their message). */
export interface TagOverviewEntry {
  name: string
  oid: string
  /** Commit the tag points at, when it resolves (annotated tags peel to it). */
  commitOid: string | null
  annotated: boolean
  message: string | null
  /** True when `origin` already has a tag of the same name; null when the
   *  remote could not be queried, so "not pushed" is never invented. */
  pushed: boolean | null
}

/** One parsed `git log` row for the commit graph (lanes are computed client-side). */
export interface GraphLogCommit {
  oid: string
  parents: string[]
  author: string
  /** Author time in epoch seconds. */
  authorTime: number
  refs: string[]
  subject: string
}

export interface InitialCommitPreflight {
  kind: 'ready' | 'empty' | 'files'
  fingerprint: string
  snapshot: GitCheckoutSnapshot
}

export interface SessionCheckoutGitPort {
  /** Optional for third-party ports; unsupported ports must not initialize. */
  preflightInitialCommit?(root: string): Promise<InitialCommitPreflight>
  initializeEmptyRepository?(root: string, fingerprint: string, assertAuthorized?: () => Promise<void>): Promise<string>
  /** Local adaptation: turn a non-Git or unborn project into a committed repository on explicit user confirmation. */
  initializeProject?(root: string): Promise<void>
  /** Short names of local branches, sorted, for the create-time base picker. */
  listLocalBranches?(root: string): Promise<string[]>
  /** Tip commit of a local branch, or null when the ref does not resolve. */
  resolveLocalBranchTip?(root: string, branch: string): Promise<string | null>
  inspect(root: string): Promise<GitCheckoutSnapshot | null>
  /** Top-level of the Git checkout containing the directory; does not require a HEAD. */
  findContainingWorktreeRoot(root: string): Promise<string | null>
  status(root: string): Promise<{ dirty: boolean }>
  createDetachedWorktree(localRoot: string, managedRoot: string, baseOid: string, saveEvidence?: (evidence: WorktreeCreationEvidence) => void): Promise<void>
  /**
   * Local adaptation: point a freshly created managed Worktree's HEAD at a real
   * session-owned branch without touching a single file. `expectedOldOid` null
   * creates the branch only when the ref does not exist yet; otherwise the ref
   * moves only from that exact old OID, so a concurrent session never loses
   * commits. Ports without it keep the legacy detached-HEAD behaviour.
   */
  attachWorktreeBranch?(managedRoot: string, branchRef: string, headOid: string, expectedOldOid: string | null): Promise<void>
  /** Deletion after the host verified checkout identity and the full fingerprint including untracked. */
  removeWorktree(localRoot: string, managedRoot: string): Promise<void>
  retainApplyBase(localRoot: string, checkoutId: string, oid: string): Promise<void>
  releaseApplyBase(localRoot: string, checkoutId: string): Promise<void>
  retainInternalArtifact(localRoot: string, checkoutId: string, artifactName: string, oid: string): Promise<void>
  /** Read one retained internal ref without modifying refs or object storage. */
  readInternalArtifact(localRoot: string, checkoutId: string, artifactName: string): Promise<string | null>
  releaseInternalArtifacts(localRoot: string, checkoutId: string, artifactPrefix?: string): Promise<void>
  /** Read-only ancestry proof; only accepts host-verified checkout roots and OIDs. */
  isAncestor(root: string, ancestorOid: string, descendantOid: string): Promise<boolean>
  listWorktreeincludeFiles?(localRoot: string, includeFile: string): Promise<string[]>
  /**
   * Local adaptation: best-effort `git push` of the given worktree's current
   * branch. Never force-pushes; never rewrites remote history. Returns the
   * human-readable failure instead of throwing so callers can degrade softly.
   */
  pushBranch?(root: string): Promise<{ ok: boolean; message?: string }>
  /**
   * Local adaptation: re-link Worktrees whose `.git` pointer broke because the
   * repository moved, via `git worktree repair`. Returns false instead of
   * throwing so callers can leave the stale record untouched.
   */
  repairWorktreeLinks?(repoCommonDir: string, managedRoot: string): Promise<boolean>
  /**
   * Local adaptation: drop Worktree admin entries whose working tree vanished
   * from disk (`git worktree prune`). Hygiene only; callers tolerate absence.
   */
  pruneWorktrees?(localRoot: string): Promise<void>
  /**
   * Local adaptation: branch overview for the header chip popover — every
   * local branch with its tip, upstream, and the checkout marker, plus the
   * dirty entry count (`-1` when the status read overflowed and the count is
   * unknown). Two parallel spawns per refresh; null on git failure.
   */
  branchOverview?(root: string): Promise<{ branches: BranchOverviewEntry[]; dirtyCount: number } | null>
  /**
   * Local adaptation: the repository's trunk branch name (`origin/HEAD`, then
   * `init.defaultBranch`); null when neither resolves. Never guesses 'main'.
   */
  defaultBranch?(root: string): Promise<string | null>
  /**
   * Local adaptation: tip committer time (ms) per local branch name, one spawn.
   * Powers the stale-branch age filter; ports without it disable age filtering.
   */
  branchTipTimes?(root: string): Promise<Record<string, number>>
  /**
   * Local adaptation: creation time (ms) per local branch name, parsed in one
   * spawn from every branch reflog's `branch: Created from` entries. Powers
   * the concurrent branch-race guard; ports without it leave the guard silent.
   */
  branchCreationTimes?(root: string): Promise<Record<string, number> | undefined>
  /** Local adaptation: safely delete a fully merged local branch (`git branch -d`); never force. */
  deleteLocalBranch?(root: string, name: string): Promise<{ deleted: boolean; reason?: string }>
  /**
   * Local adaptation: merge a session-owned worktree branch into the local checkout HEAD.
   * dryRun probes in a throwaway detached worktree and never touches the checkout;
   * a real merge leaves conflict state in place (never aborts) so the caller can resolve.
   */
  mergeLocalBranch?(root: string, source: string, options?: { dryRun?: boolean }): Promise<MergeLocalBranchResult>
  /** Local adaptation: one read-only page of the commit graph (topo-order, all refs). */
  graphLog?(root: string, limit: number): Promise<GraphLogCommit[]>
  /** Local adaptation: create a local branch at HEAD after `git check-ref-format`. */
  createLocalBranch?(root: string, name: string): Promise<void>
  /** Local adaptation: switch the local checkout to an existing local branch. */
  switchLocalBranch?(root: string, branch: string): Promise<void>
  /**
   * Local adaptation: local tags with their commit, annotation state and
   * whether `origin` already carries the same name. One spawn for tags, one
   * best-effort spawn for the remote check; null when git fails.
   */
  listTags?(root: string): Promise<TagOverviewEntry[] | null>
  /** Local adaptation: create a lightweight or annotated tag after `git check-ref-format`. */
  createTag?(root: string, name: string, options?: { message?: string; target?: string }): Promise<void>
  /** Local adaptation: delete a local tag (`git tag -d`); never touches the remote. */
  deleteLocalTag?(root: string, name: string): Promise<void>
  /**
   * Local adaptation: push a single tag to `origin` without force. Returns the
   * human-readable failure instead of throwing so callers can degrade softly.
   */
  pushTag?(root: string, name: string): Promise<{ ok: boolean; message?: string }>
  /** Local adaptation: delete a tag on `origin` (never forced). */
  deleteRemoteTag?(root: string, name: string): Promise<{ ok: boolean; message?: string }>
  /**
   * Local adaptation (codex parity): capture the checkout's uncommitted tracked
   * changes as a binary patch against HEAD, or null when the worktree is clean.
   */
  captureLocalWip?(root: string): Promise<string | null>
  /** Local adaptation (codex parity): apply a captured WIP patch inside a freshly created worktree. */
  applyWorktreePatch?(root: string, patch: string): Promise<void>
  /** Local adaptation (codex parity): non-ignored untracked paths, relative to root. */
  listUntrackedFiles?(root: string): Promise<string[]>
  /**
   * codex 对齐：删除带未提交内容的受管 Worktree 前，把全部可丢失内容
   * （tracked 修改 + 未 ignore 的 untracked 文件）固化为一个提交，保留在
   * `refs/dsh-worktree/abandoned/<checkoutId>`；返回快照提交号。
   */
  snapshotAbandonedWorktree?(localRoot: string, managedRoot: string, checkoutId: string): Promise<string>
  /** codex 对齐：把放弃快照恢复为 Local 仓库中的分支并释放快照 ref；返回分支名。 */
  restoreAbandonedSnapshot?(localRoot: string, checkoutId: string, snapshotOid: string): Promise<string>
}

export interface DirectoryIdentity {
  device: string
  inode: string
  birthtimeNs: string
}

export interface SessionCheckoutFilesPort {
  exists(path: string): boolean
  canonicalize(path: string): Promise<string>
  inspectDirectoryIdentity(path: string): Promise<DirectoryIdentity | null>
  ensureDirectory(path: string): void
  /** Deletes only when the whole tree contains no files; links inside it are unlinked, never followed. Used to collect empty `git worktree add` residue. */
  removeEmptyDirectoryTree(path: string): boolean
  /** Atomically moves residue whose file identity matches into the plugin quarantine. */
  quarantineDirectoryTree(path: string, expectedIdentity: DirectoryIdentity, quarantinePath: string): Promise<void>
  /** Deletes a fully owned non-empty directory tree; the root must not be a file or symlink. */
  removeDirectoryTree(path: string): Promise<void>
  /** Estimates real file usage; does not follow symlinks. */
  measureDirectoryBytes(path: string): Promise<number>
  readTextFile?(path: string): string | null
  copyFile?(from: string, to: string): void
  /** Reports whether an existing path is a symlink; copy sources that are links are skipped (.worktreeinclude). */
  isSymbolicLink?(path: string): Promise<boolean>
}

export interface SessionBindingRecord {
  sessionId: string
  projectId: string
  projectName: string
  target: SessionTargetRef
  ownerSessionId: string
  inheritedFromSessionId?: string
  sourceRef: string
  sourceOid: string
  revision: number
}

interface ManagedCheckoutJournalBase {
  operationId: string
  startedAt: number
}

export interface WorktreeCreationEvidence {
  root: string
  rootIdentity: DirectoryIdentity
  parentIdentity: DirectoryIdentity
  commonDir: string
  commonIdentity: DirectoryIdentity
  lockReason: string
  gitDir?: string
  gitIdentity?: DirectoryIdentity
  metadataFingerprint?: string
  indexFingerprint?: string
  quarantinePath?: string
}

export interface ManagedCheckoutCreateJournal extends ManagedCheckoutJournalBase {
  operation: 'create'
  step: 'creating_worktree'
  creation?: WorktreeCreationEvidence
}

export interface ManagedCheckoutMutationJournal extends ManagedCheckoutJournalBase {
  operation: 'apply' | 'preview' | 'checkpoint' | 'rollback_preview' | 'finish' | 'finalize_preview' | 'cleanup'
  step:
    | 'planning'
    | 'artifacts_retained'
    | 'committing_session_branch'
    | 'writing_local'
    | 'updating_ref'
    | 'replacing_index'
    | 'removing_worktree'
  baseOid?: string
  planRevision?: string
  previewId?: string
  reviewId?: string
  localFingerprint?: string
  isolatedFingerprint?: string
  effectiveBaseOid?: string
  baseStrategy?: ApplyBaseStrategy
  localHeadOid?: string
  isolatedHeadOid?: string
  commitOid?: string
  checkpointId?: string
  checkpointSequence?: number
  checkpointRequestId?: string
  checkpointRequestedRevision?: number
  checkpointMessage?: string
  checkpointIndexTreeOid?: string
  parentOid?: string
  retention?: WorktreeRetentionMode
  recoveryGeneration?: string
  /** rollback_preview crash recovery must preserve whether the review returns to working or ready_for_review. */
  resumeRevision?: boolean
  changedFiles?: string[]
  managedDirectoryIdentity?: DirectoryIdentity
  cleanupQuarantinePath?: string
}

export type ManagedCheckoutJournal = ManagedCheckoutCreateJournal | ManagedCheckoutMutationJournal

export interface ManagedWorktreeCheckpointRecord {
  checkpointId: string
  sequence: number
  reviewId: string
  /** Idempotency key for the exact user-confirmed checkpoint request. */
  requestId?: string
  /** Review revision and Host generation accepted for the request. */
  requestedRevision?: number
  generation?: string
  iteration: number
  createdAt: number
  commitOid: string
  parentOid: string
  summary: string
  commitMessage: string
  validationStatus: WorktreeValidationStatus
  changedFiles: string[]
}

/** Previous review context with bounded file paths; never replaces the final diff as fact source. */
export interface ManagedWorktreePreviousReviewRecord {
  reviewId: string
  iteration: number
  summary: string
  suggestedCommitMessage: string
  changedFiles: string[]
}

export interface ManagedWorktreeReviewRecord {
  reviewId: string
  iteration: number
  preparedAt: number
  detailsMarkdown?: string
  summary: string
  validationStatus: WorktreeValidationStatus
  validationSummary?: string
  tests: WorktreeValidationItem[]
  changedFiles: string[]
  suggestedCommitMessage: string
  isolatedFingerprint: string
  isolatedHeadOid: string
}

export interface ManagedPreviewReceipt {
  previewId: string
  reviewId: string
  iteration: number
  previewedAt: number
  configuredBaseOid: string
  effectiveBaseOid: string
  baseStrategy: ApplyBaseStrategy
  localHeadOid: string
  localHeadRef: string | null
  localFingerprintBefore: string
  localFingerprintPreview: string
  localWorkingTreeOid: string
  localIndexTreeOid: string
  previewWorkingTreeOid: string
  isolatedHeadOid: string
  isolatedFingerprint: string
  isolatedSnapshotOid: string
  changedFiles: string[]
}

export interface ManagedDeliveryProof {
  localBranch: string | null
  localHeadBefore: string
  localHeadAfter: string
  changedFiles: string[]
  /** Optional for backward compatibility with historical version-2 registries. */
  validationStatus?: WorktreeValidationStatus
  validationSummary?: string
}

export interface ManagedApplyConflictRecoveryContinuation {
  kind: 'worktree_apply_conflict'
  requestId: string
  reviewId: string
  readyRevision: number
  workingRevision: number
  localHeadOid: string
  conflictingFiles: string[]
}

export interface ManagedReviewRegenerationContinuation {
  kind: 'worktree_review_regeneration'
  requestId: string
  reviewId: string
  revision: number
}

export interface ManagedPreviewRecoveryAnalysisContinuation {
  kind: 'worktree_preview_recovery_analysis'
  requestId: string
  reviewId: string
  previewId: string
  revision: number
  generation: string
}

export interface ManagedPreviewRecoveryHandoffContinuation {
  kind: 'worktree_preview_recovery_handoff'
  requestId: string
  sourceCheckoutId: string
  reviewId: string
  previewId: string
  sourceRevision: number
  generation: string
}

export type ManagedRecoveryContinuation =
  | ManagedApplyConflictRecoveryContinuation
  | ManagedReviewRegenerationContinuation
  | ManagedPreviewRecoveryAnalysisContinuation
  | ManagedPreviewRecoveryHandoffContinuation

export type ManagedCheckoutDelivery =
  | { state: 'working'; iteration: number }
  | { state: 'ready_for_review'; review: ManagedWorktreeReviewRecord }
  | { state: 'preview_active'; review: ManagedWorktreeReviewRecord; preview: ManagedPreviewReceipt }
  | {
      state: 'preview_detached'
      review: ManagedWorktreeReviewRecord
      preview: ManagedPreviewReceipt
      detachedAt: number
      reason: 'stale_local' | 'preview_modified'
      attemptedAction: 'rollback_preview' | 'finalize_preview' | 'discard'
    }
  | {
      state: 'finalized'
      review: ManagedWorktreeReviewRecord
      commitOid: string | null
      /** Newer delivery proof; historical registries may omit it. */
      proof?: ManagedDeliveryProof
      /** The delivered isolated snapshot; cleanup retry must do fingerprint CAS. */
      isolatedFingerprint: string
      finalizedAt: number
      cleanup: 'pending' | 'blocked'
      cleanupMessage?: string
      /** i18n key of cleanupMessage; new records always persist it. */
      cleanupMessageKey?: string
      cleanupReason?: WorktreeCleanupReason
    }
  | {
      state: 'retained'
      review: ManagedWorktreeReviewRecord
      commitOid: string | null
      proof?: ManagedDeliveryProof
      isolatedFingerprint: string
      retention: Exclude<WorktreeRetentionMode, 'cleanup'>
      retainedAt: number
      expiresAt: number | null
      cleanup: 'scheduled' | 'blocked'
      cleanupMessage?: string
      /** i18n key of cleanupMessage; new records always persist it. */
      cleanupMessageKey?: string
      cleanupReason?: WorktreeCleanupReason
    }
  | { state: 'delivered'; iteration: number; commitOid: string | null; proof?: ManagedDeliveryProof; deliveredAt: number }

export interface ManagedCheckoutRecord {
  checkoutId: string
  /** Prior delivered checkout whose immutable Harness cwd path this iteration safely reuses. */
  predecessorCheckoutId?: string
  projectId: string
  projectName: string
  ownerSessionId: string
  /** Local session that created this target; historical records may omit it. */
  sourceSessionId?: string
  /** Canonical root of the project in the user's Local Checkout. */
  localRoot: string
  /** Canonical root of the project in the managed worktree; also the lease cwd. */
  managedRoot: string
  /** Repo top level of the managed Git worktree; the project root may be a subdirectory. */
  managedGitRoot: string
  gitCommonDir: string
  gitDir: string
  baseOid: string
  /** Last successfully applied isolated snapshot; does not change the user-visible Session Base. */
  applyBaseOid?: string
  /** Bounded cumulative-review context retained after a review is invalidated. */
  previousReview?: ManagedWorktreePreviousReviewRecord
  /** Linear saved stages that remain private to the managed Worktree. */
  checkpoints?: ManagedWorktreeCheckpointRecord[]
  /** Host-authoritative one-shot context for an explicitly resumed apply conflict. */
  recoveryContinuation?: ManagedRecoveryContinuation
  /** codex 对齐：放弃前快照的提交号；恢复入口据此在 Local 重建分支。 */
  abandonedSnapshotOid?: string
  abandonedSnapshotAt?: number
  /** codex 对齐：常驻标记；豁免保留期到期清理与 keep-count LRU 逐出（手动清理不受限）。 */
  permanent?: boolean
  /** Sidebar 终态徽章已被用户手动清除时的 record.revision；此后任何 revision 变更使该标记自然失效。 */
  sidebarBadgeClearedRevision?: number
  sourceRef: string
  /**
   * Local adaptation: the session-owned branch this Worktree commits to
   * (`refs/heads/feat/sess-…`). Absent on historical records; delivery then
   * adopts the Worktree onto a freshly created branch instead of reusing
   * `sourceRef`, which for those records names the Local branch the session
   * merely happened to fork from.
   */
  sessionBranch?: string
  /**
   * Local adaptation: the agent supplied topic that named the Worktree directory
   * and the session branch (`feat/sess-<session>--<topic>`). Persisted so that a
   * record adopted later derives the SAME branch name instead of falling back to
   * the project name, which would rename the Worktree's branch out from under it.
   */
  sessionTopic?: string
  phase: SessionCheckoutPhase
  delivery: ManagedCheckoutDelivery
  journal: ManagedCheckoutJournal | null
  revision: number
}

export interface ManagedCheckoutsRegistry {
  version: 2
  revision: number
  sessionBindings: Record<string, SessionBindingRecord>
  managedCheckouts: Record<string, ManagedCheckoutRecord>
}

export interface SessionCheckoutRegistryPort {
  read(): ManagedCheckoutsRegistry
  write(registry: ManagedCheckoutsRegistry): void
  /**
   * 在同一把跨进程锁里完成「读-改-写」并返回新表。
   * read 与 write 之间隔着两次调用，任何在这条缝里发生的另一个进程写入都会
   * 被后写者抹掉；单条记录更新必须走这里，而不是自己 read 完再 write。
   */
  update(mutate: (registry: ManagedCheckoutsRegistry) => ManagedCheckoutsRegistry): ManagedCheckoutsRegistry
}

/** Live configuration reference: volatile Cordis config fields arrive as these instead of plain values. */
export interface LiveValue<T> {
  get(): T
}

/** Read the current value behind a plain config value or a live volatile reference. */
export function liveConfigValue<T>(value: T | LiveValue<T>): T {
  if (typeof (value as { get?: unknown } | undefined)?.get === 'function') {
    return (value as unknown as LiveValue<T>).get()
  }
  return value as T
}

export interface SessionCheckoutDependencies {
  lookup: SessionCheckoutLookupPort
  git: SessionCheckoutGitPort
  files: SessionCheckoutFilesPort
  registry: SessionCheckoutRegistryPort
  applyEngine: SessionCheckoutApplyEngine
  managedCheckoutsRoot: string
  createCheckoutId(): string
  /** Local adaptation: after a successful Finish, push the Local branch (default true). Volatile Cordis config fields arrive as live references. */
  autoPush?: boolean | LiveValue<boolean | undefined>
  /** Local adaptation: agent-autonomous delivery; switches the Working-state guidance to worktree_deliver. */
  autoDeliver?: boolean | LiveValue<boolean | undefined>
  /**
   * Local adaptation: when set, managed Worktrees live under this root instead
   * of the state directory, using `<worktreesRoot>/<project>/<topic>-<YYYYMMDD>`
   * naming whenever the agent supplies a topic.
   */
  worktreesRoot?: string | LiveValue<string | undefined>
  /**
   * Local adaptation (codex parity): carry the local checkout's uncommitted
   * changes into a newly created managed Worktree. Only applies when the
   * Worktree's base commit equals the local HEAD; failures degrade to a
   * warning. Default true.
   */
  inheritLocalChanges?: boolean | LiveValue<boolean | undefined>
  /**
   * Local adaptation (codex parity): keep-count LRU cap for managed Worktrees.
   * When the number of live finalized/retained Worktrees exceeds this, the
   * oldest (by managedUpdatedAt) are evicted through the discard safety chain;
   * permanent records are exempt. 0 disables. Default 15.
   */
  worktreeKeepCount?: number | LiveValue<number | undefined>
  /**
   * Local adaptation: concurrent branch-race guard. When other live Sessions
   * share this Local checkout and a new local branch appeared inside
   * `branchRaceWindowMs`, the runtimeContext tells this (later-started)
   * Session to isolate through worktree_create before mutating. Default true.
   */
  branchRaceGuard?: boolean | LiveValue<boolean | undefined>
  /** Detection window for the branch-race guard, in milliseconds. Default 30 minutes. */
  branchRaceWindowMs?: number | LiveValue<number | undefined>
}
