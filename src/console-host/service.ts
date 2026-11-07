import { appendFileSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { withHostLanguage, languageFromSettings } from '../i18n/host.js'
import { hostWorkspaceClientFlavor, workspaceFlavorDiagnostics } from '../host-compat.js'
import type { Language } from '../i18n/core.js'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  WorktreeConsoleAbandonedListResponse,
  WorktreeConsoleCreatePreviewRecoveryHandoffResponse,
  WorktreeConsoleCurrentResponse,
  WorktreeConsoleGitGraphResponse,
  WorktreeConsoleGitMutationResponse,
  WorktreeConsoleGitOverviewResponse,
  WorktreeConsoleGitPruneResponse,
  WorktreeConsoleGitTagListResponse,
  WorktreeConsoleGitTagMutationResponse,
  WorktreeConsoleInspectResponse,
  WorktreeConsoleListResponse,
  WorktreeConsoleMutationResponse,
  WorktreeConsoleOutcome,
  WorktreeConsolePreflightResponse,
  WorktreeConsolePreviewRecoveryPreflightResponse,
  WorktreeConsoleRestoreAbandonedResponse,
  WorktreeConsoleReturnToLocalResponse,
  WorktreeConsoleReviewDiffResponse,
  WorktreeConsoleWorktreeRequestResponse,
  WorktreeApplyConflictContinuation,
  WorktreeClientBootReport,
  WorktreeSidebarTopologyResponse,
} from '../console-contract.js'
import type { WorktreePreviewRecoveryProof, WorktreeRetentionMode } from '../types.js'
import type { WorktreeConsoleControlPlane } from './control-plane.js'

/** Diagnostics log cap; rotating keeps one previous segment. */
const DIAG_MAX_BYTES = 8 * 1024 * 1024

/** Official Typert Remote service; the Gateway resolves `agentId` before business code runs. */
export class WorktreeConsoleService extends TypertRemoteService {
  constructor(
    private readonly hostContext: Context,
    private readonly controlPlane: WorktreeConsoleControlPlane,
    private readonly diagFile?: string,
    /** Provider election outcome from mountWorkspaceProviderLifecycle; true keeps the official Workspace live. */
    private readonly officialWorkspaceActive = true,
  ) {
    super(hostContext, 'gitWorktree')
  }

  /**
   * Diagnostics sink: an ndjson breadcrumb trail must never break the RPC surface.
   * 顶部胶囊每 5 秒写一条 current，一天就是一万多行；不设上限时这个文件只增不减
   * （实测 30 天 12MB）。超过上限就拆成 `.1` 备份，只留最近一段。
   */
  private appendDiag(line: Record<string, unknown>): void {
    if (this.diagFile === undefined) return
    try {
      this.rotateDiagIfNeeded()
      appendFileSync(this.diagFile, `${JSON.stringify(line)}
`, { encoding: 'utf8' })
    } catch { /* best effort */ }
  }

  private rotateDiagIfNeeded(): void {
    if (this.diagFile === undefined) return
    let size: number
    try {
      size = statSync(this.diagFile).size
    } catch {
      // 文件还不存在：第一条写入会创建它。
      return
    }
    if (size < DIAG_MAX_BYTES) return
    const backup = `${this.diagFile}.1`
    try {
      unlinkSync(backup)
    } catch { /* 没有旧备份，正常路径 */ }
    renameSync(this.diagFile, backup)
  }

  @Remote
  async sidebarTopology(locale?: Language): Promise<WorktreeConsoleOutcome<WorktreeSidebarTopologyResponse>> {
    const outcome = await withHostLanguage(locale ?? languageFromSettings(this.hostContext), () => this.controlPlane.sidebarTopology())
    const flavor = hostWorkspaceClientFlavor()
    this.appendDiag({
      kind: 'host', ts: Date.now(), ok: outcome.ok,
      projects: outcome.ok ? outcome.value.projects.length : undefined,
      flavor,
      anchors: workspaceFlavorDiagnostics().anchors,
    })
    return outcome.ok
      ? { ok: true, value: { ...outcome.value, workspaceClientFlavor: flavor, officialWorkspaceActive: this.officialWorkspaceActive } }
      : outcome
  }

  @Remote
  clientBootReport(report: WorktreeClientBootReport): boolean {
    this.appendDiag({ kind: 'client', ts: Date.now(), ...report })
    return true
  }

  @Remote
  async current(agent: Agent, locale?: Language): Promise<WorktreeConsoleOutcome<WorktreeConsoleCurrentResponse>> {
    // 顶部胶囊每 5s 轮询一次，一次 current 的成本直接决定胶囊刷新手感：
    // 记录耗时，才能用 diag 回答「到底慢在哪」而不是靠猜。
    const startedAt = Date.now()
    const outcome = await withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.current(agent.id))
    // 顶部胶囊永远显示「不可用」时，唯一的现场证据就是这条：胶囊会立刻调一次
    // current，失败时的 code/message 决定是会话未持验收位、项目不匹配还是 git 报错。
    this.appendDiag({
      kind: 'current', ts: Date.now(), durationMs: Date.now() - startedAt, ok: outcome.ok, agentId: agent.id,
      code: outcome.ok ? undefined : outcome.error.code,
      message: outcome.ok ? undefined : outcome.error.message,
    })
    return outcome
  }

  @Remote
  list(agent: Agent, needsAttention?: boolean, includeDelivered?: boolean, locale?: Language): Promise<WorktreeConsoleOutcome<WorktreeConsoleListResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.list({ sessionId: agent.id, needsAttention, includeDelivered }))
  }

  @Remote
  initProject(agent: Agent, locale?: Language): Promise<WorktreeConsoleOutcome<boolean>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.initProject(agent.id))
  }

  @Remote
  inspect(agent: Agent, checkoutId: string, locale?: Language): Promise<WorktreeConsoleOutcome<WorktreeConsoleInspectResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.inspect(agent.id, checkoutId))
  }

  @Remote
  reviewDiff(agent: Agent, checkoutId: string, expectedRevision: number, expectedReviewId: string, locale?: Language): Promise<WorktreeConsoleOutcome<WorktreeConsoleReviewDiffResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.reviewDiff({ sessionId: agent.id, checkoutId, expectedRevision, expectedReviewId }))
  }

  @Remote
  preflight(agent: Agent, checkoutId: string, expectedRevision: number, expectedReviewId: string, locale?: Language): Promise<WorktreeConsoleOutcome<WorktreeConsolePreflightResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.preflight({ sessionId: agent.id, checkoutId, expectedRevision, expectedReviewId }))
  }

  @Remote
  previewRecoveryPreflight(
    agent: Agent,
    checkoutId: string,
    expectedRevision: number,
    expectedReviewId: string,
    expectedPreviewId: string,
    locale?: Language,
  ): Promise<WorktreeConsoleOutcome<WorktreeConsolePreviewRecoveryPreflightResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.previewRecoveryPreflight({
      sessionId: agent.id, checkoutId, expectedRevision, expectedReviewId, expectedPreviewId,
    }))
  }

  @Remote
  preparePreviewRecoveryAnalysis(
    agent: Agent,
    checkoutId: string,
    expectedRevision: number,
    expectedReviewId: string,
    expectedPreviewId: string,
    recoveryProof: WorktreePreviewRecoveryProof,
    locale?: Language,
  ): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.preparePreviewRecoveryAnalysis({
      sessionId: agent.id, checkoutId, expectedRevision, expectedReviewId, expectedPreviewId, recoveryProof,
    }))
  }

  @Remote
  createPreviewRecoveryHandoff(
    agent: Agent,
    checkoutId: string,
    expectedRevision: number,
    expectedReviewId: string,
    expectedPreviewId: string,
    recoveryProof: WorktreePreviewRecoveryProof,
    locale?: Language,
  ): Promise<WorktreeConsoleOutcome<WorktreeConsoleCreatePreviewRecoveryHandoffResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.createPreviewRecoveryHandoff({
      sessionId: agent.id, checkoutId, expectedRevision, expectedReviewId, expectedPreviewId, recoveryProof,
    }))
  }

  @Remote
  preview(agent: Agent, checkoutId: string, expectedRevision: number, expectedReviewId: string, locale?: Language): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.preview({ sessionId: agent.id, checkoutId, expectedRevision, expectedReviewId }))
  }

  @Remote
  checkpoint(
    agent: Agent,
    checkoutId: string,
    expectedRevision: number,
    expectedReviewId: string,
    expectedGeneration: string,
    requestId: string,
    commitMessage: string,
    locale?: Language,
  ): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.checkpoint({
      sessionId: agent.id, checkoutId, expectedRevision, expectedReviewId, expectedGeneration, requestId, commitMessage,
    }))
  }

  @Remote
  prepareReviewRegeneration(
    agent: Agent,
    checkoutId: string,
    expectedRevision: number,
    expectedReviewId: string,
    locale?: Language,
  ): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.prepareReviewRegeneration({ sessionId: agent.id, checkoutId, expectedRevision, expectedReviewId }))
  }

  @Remote
  resumeRevision(
    agent: Agent,
    checkoutId: string,
    expectedRevision: number,
    expectedReviewId: string,
    conflictContinuation?: WorktreeApplyConflictContinuation,
    locale?: Language,
  ): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.resumeRevision({
      sessionId: agent.id, checkoutId, expectedRevision, expectedReviewId, conflictContinuation,
    }))
  }

  @Remote
  rollbackPreview(
    agent: Agent,
    checkoutId: string,
    expectedRevision: number,
    resumeRevision?: boolean,
    recoveryProof?: WorktreePreviewRecoveryProof,
    locale?: Language,
  ): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.rollbackPreview({ sessionId: agent.id, checkoutId, expectedRevision, resumeRevision, recoveryProof }))
  }

  @Remote
  discard(agent: Agent, checkoutId: string, expectedRevision: number, confirmDirty: boolean, rollbackPreview?: boolean, locale?: Language): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.discard({ sessionId: agent.id, checkoutId, expectedRevision, confirmDirty, rollbackPreview }))
  }

  @Remote
  finalize(
    agent: Agent,
    checkoutId: string,
    expectedRevision: number,
    expectedReviewId: string,
    commitMessage: string,
    retention: WorktreeRetentionMode,
    locale?: Language,
  ): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.finalize({ sessionId: agent.id, checkoutId, expectedRevision, expectedReviewId, commitMessage, retention }))
  }

  @Remote
  finalizePreview(
    agent: Agent,
    checkoutId: string,
    expectedRevision: number,
    expectedReviewId: string,
    commitMessage: string,
    retention: WorktreeRetentionMode,
    recoveryProof?: WorktreePreviewRecoveryProof,
    locale?: Language,
  ): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.finalizePreview({
      sessionId: agent.id, checkoutId, expectedRevision, expectedReviewId, commitMessage, retention, recoveryProof,
    }))
  }

  @Remote
  setRetention(
    agent: Agent,
    checkoutId: string,
    expectedRevision: number,
    retention: Exclude<WorktreeRetentionMode, 'cleanup'>,
    locale?: Language,
  ): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.setRetention({ sessionId: agent.id, checkoutId, expectedRevision, retention }))
  }

  @Remote
  setPermanent(
    agent: Agent,
    checkoutId: string,
    expectedRevision: number,
    permanent: boolean,
    locale?: Language,
  ): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.setPermanent({ sessionId: agent.id, checkoutId, expectedRevision, permanent }))
  }

  @Remote
  retryCleanup(agent: Agent, checkoutId: string, expectedRevision: number, discardPostDeliveryChanges?: boolean, locale?: Language): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.retryCleanup({
      sessionId: agent.id,
      checkoutId,
      expectedRevision,
      ...(discardPostDeliveryChanges === undefined ? {} : { discardPostDeliveryChanges }),
    }))
  }

  @Remote
  beginNextIteration(agent: Agent, checkoutId: string, expectedRevision: number, locale?: Language): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.beginNextIteration({ sessionId: agent.id, checkoutId, expectedRevision }))
  }

  @Remote
  returnToLocal(agent: Agent, checkoutId: string, locale?: Language): Promise<WorktreeConsoleOutcome<WorktreeConsoleReturnToLocalResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.returnToLocal({ sessionId: agent.id, checkoutId }))
  }

  /**
   * 记录或撤回「下一次 turn 在新树里开始」。
   *
   * `from` 省略即撤回；传 `null` 表示基于当前 HEAD。只写一条 session record，
   * 建树发生在 turn 的第 1 步（见 worktree-request.ts）。
   */
  @Remote
  setWorktreeRequest(agent: Agent, from: string | null | undefined, locale?: Language): Promise<WorktreeConsoleOutcome<WorktreeConsoleWorktreeRequestResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.setWorktreeRequest({ sessionId: agent.id, ...(from === undefined ? {} : { from }) }))
  }

  @Remote
  clearSidebarBadge(agent: Agent, checkoutId: string, expectedRevision: number, locale?: Language): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.clearSidebarBadge({ sessionId: agent.id, checkoutId, expectedRevision }))
  }

  @Remote
  gitOverview(agent: Agent, locale?: Language): Promise<WorktreeConsoleOutcome<WorktreeConsoleGitOverviewResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.gitOverview(agent.id))
  }

  @Remote
  gitGraph(agent: Agent, limit?: number, locale?: Language): Promise<WorktreeConsoleOutcome<WorktreeConsoleGitGraphResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.gitGraph(agent.id, limit))
  }

  @Remote
  gitCreateBranch(agent: Agent, name: string, locale?: Language): Promise<WorktreeConsoleOutcome<WorktreeConsoleGitMutationResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.gitCreateBranch(agent.id, name))
  }

  @Remote
  gitSwitchBranch(agent: Agent, branch: string, locale?: Language): Promise<WorktreeConsoleOutcome<WorktreeConsoleGitMutationResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.gitSwitchBranch(agent.id, branch))
  }

  @Remote
  gitPruneMergedBranches(agent: Agent, dryRun: boolean, locale?: Language): Promise<WorktreeConsoleOutcome<WorktreeConsoleGitPruneResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.gitPruneMergedBranches(agent.id, dryRun))
  }

  @Remote
  gitListTags(agent: Agent, locale?: Language): Promise<WorktreeConsoleOutcome<WorktreeConsoleGitTagListResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.gitListTags(agent.id))
  }

  @Remote
  gitCreateTag(
    agent: Agent,
    name: string,
    message?: string,
    target?: string,
    push?: boolean,
    locale?: Language,
  ): Promise<WorktreeConsoleOutcome<WorktreeConsoleGitTagMutationResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.gitCreateTag({
      sessionId: agent.id,
      name,
      ...(message === undefined ? {} : { message }),
      ...(target === undefined ? {} : { target }),
      ...(push === undefined ? {} : { push }),
    }))
  }

  @Remote
  gitDeleteTag(
    agent: Agent,
    name: string,
    remote?: boolean,
    locale?: Language,
  ): Promise<WorktreeConsoleOutcome<WorktreeConsoleGitTagMutationResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.gitDeleteTag({
      sessionId: agent.id,
      name,
      ...(remote === undefined ? {} : { remote }),
    }))
  }

  @Remote
  gitPushTag(agent: Agent, name: string, locale?: Language): Promise<WorktreeConsoleOutcome<WorktreeConsoleGitTagMutationResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.gitPushTag({ sessionId: agent.id, name }))
  }

  @Remote
  listAbandoned(agent: Agent, locale?: Language): Promise<WorktreeConsoleOutcome<WorktreeConsoleAbandonedListResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.listAbandoned(agent.id))
  }

  @Remote
  restoreAbandoned(agent: Agent, checkoutId: string, locale?: Language): Promise<WorktreeConsoleOutcome<WorktreeConsoleRestoreAbandonedResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.restoreAbandoned({ sessionId: agent.id, checkoutId }))
  }
}
