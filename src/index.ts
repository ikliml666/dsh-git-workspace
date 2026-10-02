import { ProjectSkillStore } from './adapters/project-skills.js'
import { mountProjectSkillProvider } from './adapters/project-skill-provider.js'
/**
 * dsh-git-worktree plugin entry. The session-checkout domain (state machine,
 * apply engine, ports) is Domi-ported and host-agnostic; this file is the DSH
 * plugin face: exports the domain error type and module contract, builds the
 * DSH adapters, mounts the state machine, and registers safe model tools,
 * human `/worktree` acceptance commands, and Session Target runtime context.
 * @module dsh-git-worktree
 */

import type { Context } from '@deepseek-ai/cordis'
import type {
  GitCheckoutSnapshot,
  ManagedApplyConflictRecoveryContinuation,
  ManagedPreviewRecoveryAnalysisContinuation,
  ManagedPreviewRecoveryHandoffContinuation,
  ManagedReviewRegenerationContinuation,
} from './ports.js'
import type {
  AbandonedWorktreeSnapshotView,
  ManagedWorktreeSummaryView,
  BulkCleanupManagedWorktreeCandidate,
  BulkCleanupManagedWorktreesResult,
  SessionCheckoutErrorCode,
  SessionCheckoutOperation,
  SessionCheckoutOperationResult,
  SessionTargetBindChoice,
  SessionTargetView,
  WorktreeRetentionMode,
  WorktreeValidationItem,
  WorktreeValidationStatus,
  WorktreeApplyPreflightView,
  WorktreePreviewRecoveryPreflightView,
  WorktreePreviewRecoveryProof,
} from './types.js'

/** Stable domain failure raised by the session-checkout state machine and its adapters. */
export class SessionCheckoutError extends Error {
  readonly code: SessionCheckoutErrorCode

  /**
   * @param code - stable error code from `SESSION_CHECKOUT_ERROR_CODES`.
   * @param message - user-facing message, surfaced verbatim by tools.
   */
  constructor(code: SessionCheckoutErrorCode, message: string) {
    super(message)
    this.name = 'SessionCheckoutError'
    this.code = code
  }
}

export interface SessionCheckoutReconcileSummary {
  recoveryRequiredCheckoutIds: string[]
  orphanedCheckoutIds: string[]
  dirtyOrphanedCheckoutIds: string[]
  staleRootCheckoutIds: string[]
  retainedCheckoutCount: number
}

export interface ManageManagedWorktreeInput {
  checkoutId: string
  expectedRevision: number
  action: 'cleanup_retained' | 'retry_cleanup' | 'set_retention' | 'set_permanent' | 'discard'
  retention?: Exclude<WorktreeRetentionMode, 'cleanup'>
  permanent?: boolean
  confirmDirty?: boolean
  rollbackPreview?: boolean
}

export interface ListManagedWorktreesInput {
  projectId?: string
  needsAttention?: boolean
  checkoutId?: string
  includeDiagnostics?: boolean
}

export interface MarkReadyForReviewInput {
  detailsMarkdown?: string
  summary: string
  validationStatus: WorktreeValidationStatus
  validationSummary?: string
  tests: WorktreeValidationItem[]
  suggestedCommitMessage: string
}

/** Handoff data used by the client to create the authoritative isolated Workspace/Session. */
export interface IsolatedTargetLaunch {
  targetSessionId: string
  managedRoot: string
  target: SessionTargetView
}

/** Complete core interface the session-checkout module exposes to business callers. */
export interface SessionCheckoutModule {
  inspect(sessionId: string): Promise<SessionTargetView>
  /** Synchronous registry snapshot for replay-stable model runtime context. */
  runtimeContext(sessionId: string): string
  /** Read-only sync preflight; modifies no Local, worktree, registry, review state, or Git refs. */
  preflight?(sessionId: string, expectedRevision: number): Promise<WorktreeApplyPreflightView>
  /** Strictly read-only detached Preview recovery assessment and deterministic revalidation context. */
  preflightPreviewRecovery?(
    sessionId: string,
    expectedRevision: number,
    expectedReviewId: string,
    expectedPreviewId: string,
  ): Promise<WorktreePreviewRecoveryPreflightView>
  /** Cross-module mutation under the same exclusive lock as bind/apply/discard/cleanup. */
  runExclusiveSessionMutation<T>(
    sessionId: string,
    operation: (target: SessionTargetView) => Promise<T>,
  ): Promise<T>
  bind(sessionId: string, choice: SessionTargetBindChoice): Promise<SessionTargetView>
  /** Reserve a distinct owner session and checkout without changing the source session cwd/identity. */
  createIsolatedTarget(sourceSessionId: string, targetSessionId: string, createOptions?: { topic?: string; branch?: string }): Promise<IsolatedTargetLaunch>
  /** Recreate a cleaned delivered owner's immutable cwd as the next isolated iteration. */
  beginNextIteration(sessionId: string, expectedRevision: number): Promise<SessionTargetView>
  /** Invalidate an unsynced review and resume the same iteration without touching Local. */
  resumeRevision(
    sessionId: string,
    expectedRevision: number,
    expectedReviewId: string,
    recovery?: Omit<ManagedApplyConflictRecoveryContinuation, 'workingRevision'>,
  ): Promise<SessionTargetView>
  /** Persist a Host-authoritative one-shot Read Only review-regeneration request. */
  prepareReviewRegeneration(
    sessionId: string,
    expectedRevision: number,
    expectedReviewId: string,
    requestId: string,
  ): Promise<ManagedReviewRegenerationContinuation>
  /** Persist an exact detached Recovery proof before the Client prompts the owner Agent for read-only analysis. */
  preparePreviewRecoveryAnalysis(
    sessionId: string,
    proof: WorktreePreviewRecoveryProof,
    requestId: string,
  ): Promise<ManagedPreviewRecoveryAnalysisContinuation>
  /** Create a fresh managed Worktree at latest Local HEAD while preserving all old detached evidence. */
  createPreviewRecoveryHandoff(
    sessionId: string,
    proof: WorktreePreviewRecoveryProof,
    targetSessionId: string,
    requestId: string,
  ): Promise<IsolatedTargetLaunch & { continuation: ManagedPreviewRecoveryHandoffContinuation }>
  markReadyForReview(sessionId: string, input: MarkReadyForReviewInput): Promise<SessionTargetView>
  operate(input: SessionCheckoutOperation): Promise<SessionCheckoutOperationResult>
  /** Live autoDeliver setting; the tool layer refuses model-driven delivery while it is off. */
  isAutoDeliverEnabled(): boolean
  listManagedWorktrees(input?: ListManagedWorktreesInput): Promise<ManagedWorktreeSummaryView[]>
  /** Caller-scoped list for model and human session surfaces. */
  listManagedWorktreesForSession(sessionId: string, input?: Omit<ListManagedWorktreesInput, 'projectId'>): Promise<ManagedWorktreeSummaryView[]>
  /** codex 对齐：当前会话项目内可恢复的放弃快照列表。 */
  listAbandonedWorktreeSnapshots(sessionId: string): Promise<AbandonedWorktreeSnapshotView[]>
  /** codex 对齐：把放弃快照恢复为 Local 仓库中的分支，并清除记录上的快照标记。 */
  restoreAbandonedWorktreeSnapshot(sessionId: string, checkoutId: string): Promise<{ branch: string }>
  /** Caller-scoped management; never treats persisted owner ids as authorization. */
  manageManagedWorktreeForSession(sessionId: string, input: ManageManagedWorktreeInput): Promise<ManagedWorktreeSummaryView>
  /** Main-owned read-only cleanup inspection; writes no registry, refs, or directories. */
  inspectManagedWorktreeCleanup(input?: ListManagedWorktreesInput): Promise<ManagedWorktreeSummaryView[]>
  bulkCleanupManagedWorktrees(candidates: BulkCleanupManagedWorktreeCandidate[]): Promise<BulkCleanupManagedWorktreesResult>
  manageManagedWorktree(input: ManageManagedWorktreeInput): Promise<ManagedWorktreeSummaryView>
  /** Resolve a managed checkout's canonical root after identity validation (workspace registration). */
  resolveManagedRoot(checkoutId: string): Promise<string>
  /** Fresh validated observation; callers can project it without re-reading Git. */
  observeManagedCheckout?(checkoutId: string): Promise<{ managedRoot: string; snapshot: GitCheckoutSnapshot; dirty: boolean }>
  /** Batch observation under one lock; results align with the requested checkoutIds. */
  observeManagedCheckouts?(checkoutIds: string[]): Promise<Array<{ managedRoot: string; snapshot: GitCheckoutSnapshot; dirty: boolean }>>
  cleanupExpiredRetained(now?: number): Promise<string[]>
  /** codex 对齐：按 worktree-keep-count LRU 逐出最旧的已交付托管 Worktree（豁免 permanent）。 */
  enforceWorktreeKeepCount(): Promise<string[]>
  reconcile(): Promise<SessionCheckoutReconcileSummary>
}

import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { createDshGitPort } from './adapters/git.js'
import { DEFAULT_GIT_TIMEOUT_MS, MAX_GIT_TIMEOUT_MS, validateGitTimeouts, type GitTimeoutOptions } from './adapters/git-options.js'
import { createNodeFilesPort } from './adapters/files.js'
import { AtomicJsonCheckoutRegistry } from './adapters/registry.js'
import { mountWorkspaceProviderLifecycle } from './workspace-provider-lifecycle.js'
import { hostWorkspaceClientFlavor } from './host-compat.js'
import { createDshLookupPort } from './adapters/lookup.js'
import { createSessionCheckoutApplyEngine } from './session-checkout-apply.js'
import { createSessionCheckoutModule } from './session-checkout-module.js'
import { registerTools } from './tools.js'
import { registerWorktreeCommand } from './commands.js'
import { registerSessionTargetContext } from './session-target-context.js'
import { createWorktreeConsoleControlPlane } from './console-host/control-plane.js'
import { createGitWorktreeReviewDiffReader } from './console-host/review-diff.js'
import { WorktreeConsoleService } from './console-host/service.js'
import { liveConfigValue, type LiveValue } from './ports.js'

export * from './console-contract.js'

const name = 'git-worktree'
// Named export: the loader reads inject/apply named exports as plugin
// metadata. A bare function export mounts with no injection list, and the
// first ctx.tools access then fails with "cannot get property without inject".
export const inject = { tools: {}, commands: {}, subprocess: {}, loader: { await: false } }

/** Mark a config field volatile: the harness settings host (packages/settings schema.ts reads `meta.volatile`) then projects it into the settings page, edits write to cordis.patch.yml without remounting, and the value arrives as a live reference. */
function volatile<T>(schema: T): T {
  ;((schema as { meta?: { volatile?: boolean } }).meta ??= {}).volatile = true
  return schema
}

export const Config = z.object({
  /**
   * Plugin state directory (registry, disabled-hooks root). Defaults to
   * `$DSH_HOME/plugins/dsh-git-worktree` (`~/.dsh` when `DSH_HOME` is unset).
   * The property is optional by construction (schemastery object properties
   * are optional inputs).
   */
  stateDir: z.string(),
  // Volatile fields are editable from the settings page without remounting
  // the plugin: values arrive as live references and are read on every use.
  gitTimeoutMs: volatile(z.number().min(1_000).max(MAX_GIT_TIMEOUT_MS).step(1).default(DEFAULT_GIT_TIMEOUT_MS)),
  worktreeAddTimeoutMs: volatile(z.number().min(1_000).max(MAX_GIT_TIMEOUT_MS).step(1).default(300_000)),
  // --- Local adaptation (dsh-git-worktree-local) ---
  /**
   * Agent-autonomous delivery: the Working-state guidance steers the model to
   * worktree_deliver, which commits, (optionally) pushes and cleans up without
   * waiting for the human acceptance UI. Default true.
   */
  autoDeliver: volatile(z.boolean().default(true)),
  /**
   * After a successful Finish with a new commit, best-effort `git push` of the
   * Local branch (never force). Failure is reported and never blocks. Default true.
   */
  autoPush: volatile(z.boolean().default(true)),
  /**
   * Root for managed Worktrees. When set, Worktrees are created under
   * `<worktreesRoot>/<project>/<topic>-<YYYYMMDD>` (topic supplied by the
   * agent) instead of the repository sibling / state directory. Should point
   * outside any Git checkout.
   */
  worktreesRoot: volatile(z.string()),
  /**
   * codex 对齐：创建受管 Worktree 时继承本地未提交修改（tracked 修改打补丁，
   * 未 ignore 的 untracked 文件复制）。仅当 Worktree 基点与本地 HEAD 一致时
   * 生效；继承失败只告警，不阻断创建。Default true.
   */
  inheritLocalChanges: volatile(z.boolean().default(true)),
  /**
   * codex 对齐：托管 Worktree 总量上限（LRU，按最近更新时间逐出最旧的已交付
   * 记录；permanent 常驻与进行中会话豁免）。0 关闭该机制。Default 15.
   */
  worktreeKeepCount: volatile(z.number().min(0).max(500).step(1).default(15)),
  /**
   * Explicitly take over the official Workspace UI (ui-workspace). Keep false
   * unless the replacement sidebar is wanted; taking over is the mechanism
   * behind the historical "cannot open a new conversation" breakage.
   */
  enableWorkspaceProvider: z.boolean().default(false),
})

interface LocalAdaptationConfig {
  autoDeliver?: boolean | LiveValue<boolean | undefined>
  autoPush?: boolean | LiveValue<boolean | undefined>
  worktreesRoot?: string | LiveValue<string | undefined>
  inheritLocalChanges?: boolean | LiveValue<boolean | undefined>
  worktreeKeepCount?: number | LiveValue<number | undefined>
  enableWorkspaceProvider?: boolean
}

function resolveWorktreesRootValue(raw: string | LiveValue<string | undefined> | undefined): string | undefined {
  const value = liveConfigValue(raw)?.trim()
  return value ? resolve(value) : undefined
}

function resolveStateDir(config: { stateDir?: string }): string {
  if (config.stateDir) return resolve(config.stateDir)
  const home = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  return join(home, 'plugins', 'dsh-git-worktree')
}

const RETENTION_MAINTENANCE_INTERVAL_MS = 15 * 60 * 1000

/**
 * Mount the plugin: DSH adapters, the session-checkout module, safe worktree
 * tools, human acceptance command, dynamic target context, startup recovery,
 * the retention-expiry timer. Local adaptation: the Workspace provider election is strictly opt-in (enableWorkspaceProvider) — by default it is a no-op and the official ui-workspace stays active, so it cannot starve the boot chain; when enabled, every Loader operation is ceiling-bounded and re-enters on the next Loader event.
 */
export async function apply(ctx: Context, config: { stateDir?: string } & GitTimeoutOptions & LocalAdaptationConfig = {}): Promise<void> {
  validateGitTimeouts(config)
  // Local adaptation: Workspace takeover is strictly opt-in. Unless
  // enableWorkspaceProvider === true, the service is never provided and the
  // official ui-workspace stays active.
  const providerLifecycle = await mountWorkspaceProviderLifecycle(ctx, hostWorkspaceClientFlavor(), { enabled: config.enableWorkspaceProvider === true })
  const stateDir = resolveStateDir(config)
  mkdirSync(stateDir, { recursive: true })
  const hooksPath = join(stateDir, 'disabled-git-hooks')
  mkdirSync(hooksPath, { recursive: true })
  // Volatile fields stay live: wrap the worktreesRoot so each read resolves
  // the current value, letting a settings-page edit apply without remounting.
  const worktreesRootInput = config.worktreesRoot
  const worktreesRoot = worktreesRootInput === undefined
    ? undefined
    : { get: () => resolveWorktreesRootValue(worktreesRootInput) }

  const lookup = createDshLookupPort(ctx)
  const projectSkills = new ProjectSkillStore(join(stateDir, 'project-skills'))
  const git = createDshGitPort(ctx, { hooksPath, projectSkills, gitTimeoutMs: config.gitTimeoutMs, worktreeAddTimeoutMs: config.worktreeAddTimeoutMs })
  const files = createNodeFilesPort()
  const registry = new AtomicJsonCheckoutRegistry(join(stateDir, 'managed-checkouts.json'))
  mountProjectSkillProvider(ctx, registry)
  const module = createSessionCheckoutModule({
    lookup,
    git,
    files,
    registry,
    applyEngine: createSessionCheckoutApplyEngine({ projectSkills }),
    managedCheckoutsRoot: stateDir,
    createCheckoutId: randomUUID,
    autoDeliver: config.autoDeliver,
    autoPush: config.autoPush,
    inheritLocalChanges: config.inheritLocalChanges,
    worktreeKeepCount: config.worktreeKeepCount,
    ...(worktreesRoot ? { worktreesRoot } : {}),
  })

  new WorktreeConsoleService(ctx, createWorktreeConsoleControlPlane({
    module,
    lookup,
    files,
    registry,
    git,
    reviewDiff: createGitWorktreeReviewDiffReader(projectSkills),
  }), join(stateDir, 'sidebar-diag.ndjson'), providerLifecycle.officialWorkspaceActive)

  registerTools(ctx, module)
  registerWorktreeCommand(ctx, module)
  registerSessionTargetContext(ctx, module)

  // Startup recovery plus periodic expiry of retained worktrees. cordis's
  // typed Events map omits the runtime 'ready' event; the events service's
  // loose runtime signature covers it.
  const reconcileOnReady = ctx.events.on('ready', () => {
    void module.reconcile()
      .then((summary) => {
        if (summary.staleRootCheckoutIds.length > 0) {
          console.warn(
            '[dsh-git-worktree] worktrees whose local root vanished (repository likely moved):',
            summary.staleRootCheckoutIds.join(', '),
          )
        }
      })
      .then(() => module.enforceWorktreeKeepCount())
      .catch((error) => {
        console.warn('[dsh-git-worktree] reconcile failed:', error)
      })
  })
  const retentionTimer = setInterval(() => {
    void module.cleanupExpiredRetained()
      .then(() => module.enforceWorktreeKeepCount())
      .catch((error) => {
        console.warn('[dsh-git-worktree] retained worktree maintenance failed:', error)
      })
  }, RETENTION_MAINTENANCE_INTERVAL_MS)
  retentionTimer.unref?.()
  ctx.effect(() => () => {
    reconcileOnReady()
    clearInterval(retentionTimer)
  })
}
