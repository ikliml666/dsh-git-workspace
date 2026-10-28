---
title: src
type: module
source_files:
  - src/index.ts
  - src/types.ts
  - src/ports.ts
  - src/commands.ts
  - src/tools.ts
  - src/commit-message.ts
  - src/concurrent-session-guard.ts
  - src/console-contract.ts
  - src/checkpoint.ts
  - src/creation-failure.ts
  - src/delivery-excludes.ts
  - src/host-compat.ts
  - src/managed-worktree-path.ts
  - src/session-checkout-apply.ts
  - src/session-target-context.ts
  - src/workspace-provider-lifecycle.ts
  - src/adapters/files.ts
  - src/adapters/git-options.ts
  - src/adapters/git.ts
  - src/adapters/initial-commit.ts
  - src/adapters/lookup.ts
  - src/adapters/project-skill-io.ts
  - src/adapters/project-skill-provider.ts
  - src/adapters/project-skills.ts
  - src/adapters/registry.ts
  - src/adapters/safe-file.ts
  - src/adapters/working-directory.ts
  - src/adapters/worktree-creation.ts
  - src/console-host/control-plane.ts
  - src/console-host/errors.ts
  - src/console-host/projection.ts
  - src/console-host/review-diff.ts
  - src/console-host/service.ts
  - src/console-remote/descriptors.ts
  - src/console-remote/remote.ts
  - src/console-remote/schemas.ts
  - src/i18n/core.ts
  - src/i18n/host-messages.ts
  - src/i18n/host.ts
  - src/client/WorktreeCreateRow.tsx
  - src/client/WorktreeReviewRow.tsx
  - src/client/actions.ts
  - src/client/console-remote/adapter.ts
  - src/client/console-remote/index.ts
  - src/client/harness-platform.d.ts
  - src/client/i18n.tsx
  - src/client/index.tsx
  - src/client/model.ts
  - src/client/pre-session/PreSessionWorktreeToggle.tsx
  - src/client/pre-session/controller.ts
  - src/client/pre-session/harness-input.ts
  - src/client/pre-session/index.tsx
  - src/client/review-console/DeliveryProof.tsx
  - src/client/review-console/PreflightStatus.tsx
  - src/client/review-console/ReviewActions.tsx
  - src/client/review-console/ReviewDetailsModal.tsx
  - src/client/review-console/ReviewIcon.tsx
  - src/client/review-console/WorktreeReviewPanel.tsx
  - src/client/review-console/index.ts
  - src/client/review-console/preflight-cache.ts
  - src/client/review-console/preview-recovery-cache.ts
  - src/client/review-console/recovery-continuation.ts
  - src/client/review-console/request-cache.ts
  - src/client/review-console/status-events.ts
  - src/client/settings-card/WorktreeSettingsCard.tsx
  - src/client/settings-card/form-model.ts
  - src/client/settings-card/index.ts
  - src/client/settings-card/worktree-settings-card.ts
  - src/client/target-console/BranchGraphModal.tsx
  - src/client/target-console/TagManagerModal.tsx
  - src/client/target-console/TargetStatusAction.tsx
  - src/client/target-console/WorktreeConsoleView.tsx
  - src/client/target-console/WorktreeHeroChip.tsx
  - src/client/target-console/WorktreeManagerModal.tsx
  - src/client/target-console/WorktreeReviewStatus.tsx
  - src/client/target-console/branch-overview-cache.ts
  - src/client/target-console/current-polling.ts
  - src/client/target-console/index.ts
  - src/client/workspace-sidebar/index.tsx
  - src/client/workspace-sidebar/model.ts
tags: [git-worktree, dsh-plugin, session-checkout, rpc, react, i18n]
---

## Overview

`src/` 是 **dsh-git-worktree** 插件的完整源码：一个跑在 DSH（DeepSeek Harness / Cordis 宿主）之上的受管 Git Worktree（"Isolated Checkout"）系统。领域核心（状态机、apply 引擎、ports）从 Domi 的 `session-checkout` 域移植而来且与宿主无关（见 `src/index.ts` 3-10 行的模块注释）；本目录在此之上补齐了三层 DSH 适配：

1. **Host 侧**：`src/index.ts` 的 `apply()`（358-458 行）把端口适配器（git/files/registry/lookup）、`session-checkout-apply.ts` 应用引擎、模型工具（`tools.ts`）、人类命令（`commands.ts`）、系统提示上下文（`session-target-context.ts`）和 RPC 服务（`console-host/service.ts`）组装到 Cordis Context 上。
2. **RPC 契约层**：`src/console-contract.ts` 定义 JSON-only DTO；`src/console-remote/` 定义 Typert strict schema + 描述符；`src/console-host/` 是服务端控制面。
3. **Web 客户端**：`src/client/` 用 React 实现 ToolView 回放卡、验收 Dock、目标胶囊、分支图/标签管理、侧栏投影、设置卡与空白会话 "Start in a Worktree" 流。

持久化只有两处：`stateDir/managed-checkouts.json`（v2 原子 JSON 注册表，`src/adapters/registry.ts`）与 Git 内部 ref 命名空间 `refs/dsh-worktree/session-checkouts/<sha256前24>`、`refs/dsh-worktree/abandoned/<checkoutId>`（`src/adapters/git.ts` 201-233 行）。

## Key Components

### 1. 插件入口与模块契约（`src/index.ts`）

| 导出 | 行号 | 说明 |
| --- | --- | --- |
| `SessionCheckoutError` | 41-53 | 域错误类；字段 `readonly code: SessionCheckoutErrorCode`（42 行），构造器接受 `code` + 面向用户原样透出的 `message`（48-52 行） |
| `SessionCheckoutReconcileSummary` | 55-61 | 字段：`recoveryRequiredCheckoutIds`(56)、`orphanedCheckoutIds`(57)、`dirtyOrphanedCheckoutIds`(58)、`staleRootCheckoutIds`(59)、`retainedCheckoutCount`(60) |
| `ManageManagedWorktreeInput` | 63-71 | 字段：`checkoutId`(64)、`expectedRevision`(65)、`action`(66，取值 `'cleanup_retained' \| 'retry_cleanup' \| 'set_retention' \| 'set_permanent' \| 'clear_sidebar_badge' \| 'discard'`)、`retention?`(67)、`permanent?`(68)、`confirmDirty?`(69)、`rollbackPreview?`(70) |
| `ListManagedWorktreesInput` | 73-78 | `projectId?`/`needsAttention?`/`checkoutId?`/`includeDiagnostics?` |
| `PruneMergedBranchesInput` | 80-85 | `dryRun?`(82)、`olderThanDays?`(84) |
| `MergeBranchForSessionInput` | 87-94 | `sourceBranch`(89)、`dryRun?`(91)、`direction?: 'forward' \| 'reverse'`(93) |
| `MarkReadyForReviewInput` | 96-103 | `detailsMarkdown?`、`summary`、`validationStatus`、`validationSummary?`、`tests`、`suggestedCommitMessage` |
| `IsolatedTargetLaunch` | 105-110 | `targetSessionId`(107)、`managedRoot`(108)、`target: SessionTargetView`(109) |
| `SessionCheckoutModule`（接口） | 113-219 | 完整核心契约：`inspect`(114)、`runtimeContext(sessionId, cwd?)`(120)、`refreshBranchRaceGuards?`(126)、`preflight?`(128)、`preflightPreviewRecovery?`(130-135)、`runExclusiveSessionMutation`(137-140)、`bind`(141)、`createIsolatedTarget(sourceSessionId, targetSessionId, createOptions?)`(143)、`beginNextIteration`(145)、`resumeRevision`(147-152)、`prepareReviewRegeneration`(154-159)、`preparePreviewRecoveryAnalysis`(161-165)、`createPreviewRecoveryHandoff`(167-172)、`markReadyForReview`(173)、`operate`(174)、`isAutoDeliverEnabled`(176)、`listManagedWorktrees`(177)、`listManagedWorktreesForSession`(179)、`pruneMergedBranchesForSession`(181)、`autoPruneStaleMergedBranches`(183)、`mergeBranchForSession`(185)、`listAbandonedWorktreeSnapshots`(187)、`restoreAbandonedWorktreeSnapshot`(189)、`manageManagedWorktreeForSession`(191)、`inspectManagedWorktreeCleanup`(193)、`bulkCleanupManagedWorktrees`(194)、`manageManagedWorktree`(195)、`resolveManagedRoot`(197)、`resolveRoots`(199)、`observeManagedCheckout?`(201-207)、`observeManagedCheckouts?`(209-214)、`cleanupExpiredRetained`(215)、`enforceWorktreeKeepCount`(217)、`reconcile`(218) |
| `inject` | 253 | `{ tools: {}, commands: {}, subprocess: {}, loader: { await: false } }`——Loader 按命名导出读取插件元数据 |
| `volatile<T>()` | 256-259 | 给 schema 打 `meta.volatile`，使设置页编辑落到 `cordis.patch.yml` 且值以 LiveValue 引用到达 |
| `Config` | 261-319 | `stateDir`(268)、`gitTimeoutMs`(271，默认 `DEFAULT_GIT_TIMEOUT_MS`)、`worktreeAddTimeoutMs`(272)、`autoDeliver`(279，默认 true)、`autoPush`(284，默认 true)、`worktreesRoot`(291)、`inheritLocalChanges`(297，默认 true)、`worktreeKeepCount`(302，默认 15)、`branchRaceGuard`(309，默认 true)、`branchRaceWindowMs`(311，默认 30 分钟)、`enableWorkspaceProvider`(318，默认 false) |
| `resolveStateDir` | 337-341 | 默认 `$DSH_HOME/plugins/dsh-git-worktree`（无 `DSH_HOME` 时 `~/.dsh`） |
| 常量 | 343-347 | `RETENTION_MAINTENANCE_INTERVAL_MS`=15min(343)、`AUTO_PRUNE_INTERVAL_MS`=24h(345)、`AUTO_PRUNE_FIRST_RUN_DELAY_MS`=60s(346)、`AUTO_PRUNE_OLDER_THAN_DAYS`=7(347) |
| `apply(ctx, config)` | 358-458 | 挂载流程：`mountWorkspaceProviderLifecycle`(363) → 建 stateDir/hooksPath(364-367) → worktreesRoot 包成 `{ get }`(370-373) → 四个端口 + `AtomicJsonCheckoutRegistry`(375-379) → `mountProjectSkillProvider`(380) → `createSessionCheckoutModule`(381-396) → `new WorktreeConsoleService(...)`(398-405，diag 文件 `stateDir/sidebar-diag.ndjson`) → `registerTools`/`registerWorktreeCommand`/`registerSessionTargetContext`(407-409) → `events.on('ready')` 里 `reconcile()`+`enforceWorktreeKeepCount()`(414-428) → 保留期 `setInterval`(429-436) → 7 天自动 prune 定时器(437-452) → `ctx.effect` 统一清理(453-458) |

注意：状态机工厂 `createSessionCheckoutModule`（234 行 import 自 `./session-checkout-module.js`）与 `createSessionCheckoutApplyEngine`（233 行）是组装点；`session-checkout-module.ts` 本体不在本快照内。

### 2. 领域类型与错误码（`src/types.ts`）

- `SessionTargetRef`（11-14 行）：`{ kind: 'unselected' } | { kind: 'local' } | { kind: 'isolated'; checkoutId }`。
- `SessionCheckoutPhase`（18-27 行）：`preparing | ready | applying(已废弃, 21 行注释) | mutating | recovery_required | finalized | retained | discarded`。
- `WorktreeRetentionMode`（32 行）与 `DEFAULT_WORKTREE_RETENTION = 'retain_24h'`（39 行）——默认保留冻结环境 24 小时使误交付可回滚。
- `WorktreeCleanupReason`（41-46 行）：`directory_busy | modified_after_finalize | identity_changed | detached_residue | quarantine_busy`。
- `WorktreeValidationItem`（48-52 行）：`{ command, status: 'passed'|'failed'|'not_run', summary? }`。
- `WorktreeCheckpointView`（55-63 行）：`{ checkpointId, sequence, reviewId, createdAt, summary, validationStatus, changedFiles }`。
- `WorktreeReviewView`（65-77 行）：`{ reviewId, iteration, preparedAt, detailsMarkdown?, summary, validationStatus, validationSummary?, tests, changedFiles, suggestedCommitMessage }`。
- `WorktreeDeliveryProofView`（79-90 行）：`{ localBranch, localHeadBefore, localHeadAfter, changedFiles, validationStatus?, validationSummary?, commitInLocalHistory: boolean | null }`。
- `WorktreeDeliveryView`（92-127 行）：七个状态联合（working / ready_for_review / preview_active / preview_detached / finalized / retained / delivered），finalized 带 `cleanup: 'pending'|'blocked'`、retained 带 `cleanup: 'scheduled'|'blocked'`，两者均另有 `cleanupMessage?`、`cleanupReason?`。
- 预检视图 `WorktreeApplyPreflightView`（159-172 行）：`ready | local_advanced | already_in_local | conflict(带 conflictingFiles/conflictDetails) | blocked(reason 129-137 行枚举 + blocker)`，所有分支都 `localModified: false`。
- `SessionTargetView`（198-216 行）：`{ project, checkout, source, current, ownership: 'owner'|'inherited', dirty, revision, delivery?, checkpoints?, checkpointGeneration?, reviewSlot?, reviewSlotOwnerSessionId? }`。
- 操作类型（222-353 行）：`SessionCheckoutApplyOperation` / `FinishOperation(带 commitMessage, retention?, expectedReviewId?)` / `PreviewOperation` / `CheckpointOperation(带 expectedReviewId, expectedGeneration, requestId)` / `RollbackPreviewOperation(resumeRevision?, recoveryProof?)` / `FinalizePreviewOperation` / `RetryCleanupOperation` / `DiscardOperation(confirmDirty, rollbackPreview?)` / `RecoverOperation`。
- `WorktreePreviewRecoveryProof`（273-291 行）：Host 签发的只读恢复凭证，字段含 `sessionId, checkoutId, reviewId, previewId, revision, generation, receiptFingerprint, localFingerprint, localHeadOid, localHeadRef, localHeadTreeOid, localIndexTreeOid, localWorkingTreeOid, rollback, finalize, blocker?`。
- 结果类型（355-411、550-595 行）：applied/previewed/checkpointed/preview_rolled_back/preview_detached/finished(带 `branch?`、`cleanup: 'discarded'|'pending'|'retained'`、`push?: WorktreePushOutcome`(388-392))/conflict(`SessionCheckoutConflictResult` 550-566，含 `reason: ApplyConflictReason`(548)、`localHeadOid`、`conflictDetails?`、`resolveHint?`)/discarded/recovered/error。
- `CONFLICT_DETAIL_FILE_LIMIT = 6`、`CONFLICT_DETAIL_DIFF_LIMIT = 4096`（517-518 行）。
- `SESSION_CHECKOUT_ERROR_CODES`（597-627 行）：29 个稳定错误码（session_not_found … recovery_unsafe）；`SessionCheckoutErrorCode`(629)、`SessionCheckoutFailure`(631-634)。
- `MergeLocalBranchResult`/`MergeBranchForSessionView`（522-540 行）、`ManagedWorktreeSummaryView`（453-480 行，含 `approximateBytes`、`updatedAt`、`canCleanup`、`cleanup?`、`activeSessionIds?`）、`AbandonedWorktreeSnapshotView`（497-503 行）。

### 3. 端口接口（`src/ports.ts`）

- `SessionCheckoutLookupPort`（40-60 行）：`getSession`、`getProject`、`getSidebarMemberships?`(42)、`getSessionCwd?`(53，owner 会话的活 cwd 即 worktree 根，用于授权)、`listLiveSessions?`(59)。
- `GitCheckoutSnapshot`（62-69 行）：`{ root, commonDir, gitDir, branch, headOid, headRef }`。
- `BranchOverviewEntry`（72-77）、`TagOverviewEntry`（80-90，`pushed: boolean | null` 区分"离线未知"与"未推送"）、`GraphLogCommit`（93-101）、`InitialCommitPreflight`（103-107，`kind: 'ready'|'empty'|'files'`）。
- `SessionCheckoutGitPort`（109-230 行）：必选 `inspect / findContainingWorktreeRoot / status / createDetachedWorktree / retainApplyBase / releaseApplyBase / retainInternalArtifact / readInternalArtifact / releaseInternalArtifacts / isAncestor / removeWorktree`；本地适配可选方法带详细注释：`preflightInitialCommit`、`initializeEmptyRepository`、`initializeProject`、`listLocalBranches`、`resolveLocalBranchTip`、`attachWorktreeBranch`（124-131 行 CAS 语义）、`pushBranch`、`repairWorktreeLinks`、`pruneWorktrees`、`branchOverview`、`defaultBranch`、`branchTipTimes`、`branchCreationTimes`、`deleteLocalBranch`、`mergeLocalBranch`、`graphLog`、`createLocalBranch`、`switchLocalBranch`、`listTags`、`createTag`、`deleteLocalTag`、`pushTag`、`deleteRemoteTag`、`captureLocalWip`、`applyWorktreePatch`、`listUntrackedFiles`、`snapshotAbandonedWorktree`、`restoreAbandonedSnapshot`。
- `DirectoryIdentity`（232-236 行）：`{ device, inode, birthtimeNs }`（字符串化的 bigint）——隔离区 CAS 的目录身份。
- `SessionCheckoutFilesPort`（238-255 行）：`exists / canonicalize / inspectDirectoryIdentity / ensureDirectory / removeEmptyDirectoryTree / quarantineDirectoryTree / removeDirectoryTree / measureDirectoryBytes / readTextFile? / copyFile? / isSymbolicLink?`。
- `SessionBindingRecord`（257-267 行）：`{ sessionId, projectId, projectName, target, ownerSessionId, inheritedFromSessionId?, sourceRef, sourceOid, revision }`。
- Journal 类型：`WorktreeCreationEvidence`（274-286 行，字段 `root, rootIdentity, parentIdentity, commonDir, commonIdentity, lockReason, gitDir?, gitIdentity?, metadataFingerprint?, indexFingerprint?, quarantinePath?`）、`ManagedCheckoutCreateJournal`(288-292)、`ManagedCheckoutMutationJournal`(294-329，operation 枚举 + step 枚举 + 计划/预览/检查点字段)。
- `ManagedWorktreeCheckpointRecord`（333-350 行）：`{ checkpointId, sequence, reviewId, requestId?, requestedRevision?, generation?, iteration, createdAt, commitOid, parentOid, summary, commitMessage, validationStatus, changedFiles }`。
- `ManagedWorktreeReviewRecord`（361-374 行）、`ManagedPreviewReceipt`（376-395 行，18 个字段含 `localWorkingTreeOid/localIndexTreeOid/previewWorkingTreeOid/isolatedSnapshotOid`）、`ManagedDeliveryProof`（397-405 行）。
- 恢复续体（407-447 行）：`ManagedApplyConflictRecoveryContinuation`(407-415)、`ManagedReviewRegenerationContinuation`(417-422)、`ManagedPreviewRecoveryAnalysisContinuation`(424-431)、`ManagedPreviewRecoveryHandoffContinuation`(433-441)。
- `ManagedCheckoutDelivery`（449-485 行）：与 `WorktreeDeliveryView` 对应的持久层七态联合。
- `ManagedCheckoutRecord`（487-540 行）：核心持久记录，全部字段见上表（含 `sessionBranch?`(521-528)、`sessionTopic?`(529-535)、`permanent?`、`sidebarBadgeClearedRevision?`、`abandonedSnapshotOid?`）。
- `ManagedCheckoutsRegistry`（542-547 行）：`{ version: 2, revision, sessionBindings, managedCheckouts }`。
- `liveConfigValue<T>()`（560-565 行）：统一读取普通值或 `LiveValue<T>.get()`。
- `SessionCheckoutDependencies`（567-608 行）：模块依赖注入面（含全部 volatile 配置）。

### 4. 应用引擎（`src/session-checkout-apply.ts`）

这是交付安全性的核心（约 2678 行）。关键类型：

- `ApplyPlan`（20-31 行）：`{ revision, localFingerprint, isolatedFingerprint, effectiveBaseOid, baseStrategy, localHeadOid, localHeadRef: string|null, isolatedHeadOid, changedFiles }`；`localHeadRef: null` 显式表示 detached HEAD（27 行注释）。
- `ApplyConflictPlanResult`（47-60 行）：冲突时返回 `localHeadOid` 供 Isolated Agent 就地同步（54 行注释）与可选 `conflictDetails`。
- `CommitIsolatedSuccess`（94-104 行）：`{ status:'committed', commitOid, changedFiles, isolatedFingerprint, branch: string|null, created }`。
- `PreviewReceipt`（128-147 行）：18 个字段（见 ports 节）。
- `ApplyError` 联合（227-277 行）：`invalid_input / invalid_plan / stale_local / stale_isolated / git_error(带 recoveryState: 'unchanged'|'uncertain') / commit_isolation_conflict / operation_not_allowed / preview_modified`。
- `SessionCheckoutApplyEngine` 接口（279-317 行）：`inspectReview, checkpoint, recoverCheckpoint, preflight, plan, apply, finish, commitIsolated?, reviewIsolated?, preview, assessPreviewRecovery, rollback, finalize`。
- 测试 seam（319-329 行）：`beforeFinalLocalValidation`、`afterLocalWriteBeforeVerification`、`beforeFinalIsolatedValidation`、`afterIsolatedWriteBeforeVerification`。

基础设施：

- `GitCommandFailure`（383-390 行）；`AMBIENT_GIT_ENV_PATTERN`（394 行，洗掉 `GIT_DIR/GIT_WORK_TREE/.../GIT_CONFIG_*` 等环境重定向）；`scrubbedAmbientGitEnv()`（396-402）；`disabledGitHooksPath()`（404-411，懒创建一次性空 hooks 目录）；`GIT_TIMEOUT_MS = 30_000`（415 行）；`OID_PATTERN`（416 行）。
- `runGit`（418-480 行）：spawn git，win32 加 `-c core.longpaths=true`（427 行），`core.quotePath=false / core.fsmonitor=false / core.hooksPath=空目录`（428-430 行），`options.env` 是刻意注入通道且总是胜出（437 行注释）。
- `selectEffectiveApplyBase`（551-572 行）：只有 recorded base 可证明在两侧历史中才允许前移；否则保守 `'recorded_base'`。
- `snapshotFingerprint`（589-604 行）：sha256(headOid ∥ headRef∥'DETACHED' ∥ indexEntries ∥ treeOid)。
- `captureSnapshot`（606-659 行）：`read-tree HEAD` → 重放 staged patch → `write-tree`（index tree）→ `add -A -- . <excludes>`（647 行，排除宿主运行期产物）→ 剔除随会话携带的 Project Skills（649-653 行）→ `write-tree` → 与 skills fingerprint 组合（655-656 行）。
- `createSnapshotCommit`（661-681 行）：`commit-tree`，身份固定 `Domi Apply <domi-apply@localhost>`。
- `computeMerge`（706-802 行）：临时仓库做三方合并（`merge --no-commit --no-ff`），冲突收集 `--diff-filter=U`（751-759 行），成功则产 patch + central merged tree（788-801 行）。
- `computeTreeMerge`（804-893 行）：任意 base/ours/theirs 树合并，`finish` 的任务剥离用。
- `prepareRollbackAssessment`（969-1042 行）/`prepareFinalizeAssessment`（1044-1105 行）：detached preview 恢复的只读安全评估（Local HEAD 前进时用树合并推演）。
- `writeIndexLock`（1147-1166 行）：`open(lock, 'wx')` 拿 Git 原生 index.lock，失败时清理自建 lock。

`DefaultSessionCheckoutApplyEngine`（1175-2672 行）方法与行号：

| 方法 | 行号 | 要点 |
| --- | --- | --- |
| `checkpoint` | 1190-1331 | 独占 index.lock marker `${lock}.dsh-${commitOid}`(1227-1228)；分支附着时 `update-ref <headRef>` 而非 `--no-deref`（1242-1250 行注释解释 detached 危险）；`rename` 邻接 index(1254)；写后完整验证(1284-1315) |
| `recoverCheckpoint` | 1333-1419 | 崩溃恢复：区分 aborted/recovered，锁 marker 归属校验（1351-1359、1373-1387） |
| `inspectReview` | 1421-1470 | 只读：同仓库对象库校验(1434-1436)、项目前缀一致(1438-1441)、隔离树变更集(1449-1463) |
| `reviewIsolated` | 1476-1512 | 会话分支交付用：完全不读 Local（1473-1475 行注释） |
| `commitIsolated` | 1521-1608 | 会话分支提交：守门 HEAD 必须在目标分支(1543-1552)；提交树来自评审快照同路径临时 index（1554-1556 行注释：不会把宿主产物/Project Skills 带进提交）；`update-ref HEAD`(1570)、`reset --quiet`(1572)；`empty ident` 错误翻译成可执行提示(1601-1603) |
| `preflight` / `plan` / `calculatePlan` | 1610-1735 | `persistPlan=false` 时为纯只读预检；plans Map 每个 isolated 路径只保留一份（1711-1716 行 ponytail 注释） |
| `apply` | 1737-1816 | 计划比对(1739-1741) → 双侧重拍快照 CAS(1752-1770) → 持久 isolated 内部快照 commit `nextBaseOid`(1774-1790) → 最终 Local CAS(1792-1804) → `git apply --binary`（1806-1808） |
| `preview` | 1818-1958 | 持久 receipt（`beforeWrite` 在 Local 写之前，1930 行）→ 打 patch → 写后树比对（1940-1945） |
| `assessPreviewRecovery` | 1960-1986 | 只读，不持久化可执行 plan（302 行注释） |
| `rollback` | 1988-2091 | `beforeWrite` → 最终 CAS → `apply -R` 等价 patch → 写后指纹验证（2044-2085） |
| `finalize` | 2093-2367 | 最复杂：index 备份(2207-2208) → index.lock(2210-2219) → `update-ref <branch> commitOid oldOid` + rename index（2240-2247）→ 写后验证 → 失败补偿回滚树（2283-2315，ref 回滚 CAS / 备份 index 恢复）→ 无法证明成功或完整回滚时保留备份并报 `uncertain`（2350-2359） |
| `finish` | 2369-2655 | 复验冲突/文件集(2429-2440)；任务剥离 `C = H + (M - L)`（2475 行）与 index 保留 `S' = C + (S - H)`（2496 行）；持锁串行 `校验→打补丁→update-ref→换 index`（2568-2607）；失败按 ref/worktree 逆序补偿（2608-2640） |
| `errorMessage` / `cleanup` | 2657-2671 | 临时目录清理失败只 warn（2668 行注释） |

`createSessionCheckoutApplyEngine(options)`（2674-2678 行）返回该单例。

### 5. 适配器（`src/adapters/`）

#### files.ts — Node fs 文件端口
- `measureDirectoryBytes`（16-24 行，符号链接计 0）；`removeEmptyDirectoryTree`（26-35 行）；`inspectDirectoryIdentity`（37-46 行，lstat bigint 提取 device/inode/birthtimeNs）；`directoryIdentitiesEqual`（48-50 行）。
- `quarantineDirectoryTree`（52-72 行）：父目录一致性（win32 小写比较，59-61 行）+ quarantine 未占用 → `rename`（65 行）→ 重验身份，不符则尽力回滚且**绝不删除身份不符对象**（68-70 行注释）。
- `removeDirectoryTree`（74-86 行）：根必须是真实目录（77-79 行拒绝链接/文件）；win32 `maxRetries: 6` vs 其他 2，`retryDelay: 150`（83-84 行）。
- `createNodeFilesPort()`（89-108 行）：组装上述端口，另含 `copyFile`（自动 mkdir + 强制覆盖，100-104 行）与 `isSymbolicLink`（105-107 行）。

#### git.ts — `ctx.subprocess` 支撑的 git 端口
- 常量：`GIT_TERMINATION_GRACE_MS = 1_000`（38 行）、`GIT_COLLECT_BYTES = 1 << 20`（40 行）、`WIP_PATCH_COLLECT_BYTES = 16 << 20`（42 行）。
- `parseDecoration`（63-71 行）：`%D` → ref 名（`tag:` 前缀保留、`HEAD -> ` 剥离）。
- `settleCreationTree`（73-86 行）：创建超时后的整树静默确认。
- `runGit`（93-188 行）：argv 逐字传递不经 shell（88-92 行注释）；统一 `-c core.hooksPath=<空目录>`（110 行）；win32 `core.longpaths=true`（107 行）；环境清洗正则（124-126 行）+ `GIT_OPTIONAL_LOCKS=0 / GIT_TERMINAL_PROMPT=0 / LC_ALL=C`（127-130 行）；支持 `GitCommitProtocol`（`prepare` 写入 stdin，轮询 stdout 出现 `prepare: ok` 后调 `beforeCommit()` 再写 `commit\n`，137-153 行）；创建路径有独立 deadline 与 quiescent 语义（157-168 行）；lossy 输出视为失败（174-176 行）。
- `runGitChecked`（190-199 行）：非零即抛 `git_operation_failed`。
- ref 命名：`checkoutRefRoot`（201-204 行，sha256 前 24 hex）；`assertArtifactName`（206-214 行，段正则 `^[A-Za-z0-9][A-Za-z0-9._-]*$`）；`applyBaseRef`（221-223）；`abandonedSnapshotRef`（230-233 行，故意放在 checkoutRefRoot 之外——discard 会整命名空间释放，见 225-229 行注释）。
- `hasGitMetadata`（235-246 行）：向上找 `.git`；**任何非 ENOENT 错误都返回 true**（保守视作 git 仓库，240 行）。
- `createDshGitPort(ctx, options)`（249-772 行）：先 `validateGitTimeouts`(250)；端口方法一览（行号）：`inspect` 256-322（单次 rev-parse 取全部位置事实 + symbolic-ref 并行补分支，257-259 行注释；unborn/broken HEAD 回退逐项读取 282-321）、`findContainingWorktreeRoot` 323-330、`status` 331-335、`createDetachedWorktree` 336-348（Project Skills 冲突预检 338-340；创建 deadline 341）、`removeWorktree` 349-359（skills 可删校验 352-356）、`pruneWorktrees` 360-362、`retain/releaseApplyBase` 363-368、`retain/read/releaseInternalArtifact(s)` 369-388（批量 ref 删除用 `update-ref --stdin` 事务，385-387 行）、`isAncestor` 389-394、`listLocalBranches` 395-398、`resolveLocalBranchTip` 399-404、`attachWorktreeBranch` 405-425（CAS：`expectedOldOid ?? 全零 oid`，410-411 行；`symbolic-ref HEAD`，418 行）、`pushBranch` 426-442（绝不 force）、`repairWorktreeLinks` 443-448、`listWorktreeincludeFiles` 449-468（两次 `ls-files --others --ignored` 求交，含自动带入 `AGENTS.override.md` 466 行）、`branchOverview` 469-485、`defaultBranch` 486-493、`branchTipTimes` 494-507、`branchCreationTimes` 508-527（reflog `branch: Created from`）、`deleteLocalBranch` 528-532、`graphLog` 533-555、`createLocalBranch` 556-565、`switchLocalBranch` 566-577（解析 "already used by worktree at" 错误，571-574 行）、`listTags` 578-615、`createTag` 616-631、`deleteLocalTag` 632-637、`pushTag` 638-643、`deleteRemoteTag` 644-648、`mergeLocalBranch` 649-719（dryRun 用临时 detached worktree 试合并 686-708；正式合并冲突不 abort 留现场，710-718）、`captureLocalWip` 720-728、`applyWorktreePatch` 729-735、`listUntrackedFiles` 736-740、`snapshotAbandonedWorktree` 741-761（`add -A` + `write-tree` + 显式身份 `commit-tree`）、`restoreAbandonedSnapshot` 762-770。末尾 `Object.assign(port, initialCommitActions(port.inspect, runSessionGit))`（772 行）。

#### git-options.ts
- `GitTimeoutOptions`（3-6 行）；`DEFAULT_GIT_TIMEOUT_MS = 120_000`（8）、`DEFAULT_WORKTREE_ADD_TIMEOUT_MS = 5 * 60_000`（9）、`MAX_GIT_TIMEOUT_MS = 60 * 60_000`（10）。
- `validateGitTimeouts`（12-19 行）：必须为 [1_000, MAX] 的安全整数。
- `gitTimeoutMs(args, options)`（21-27 行）：`worktree add` → worktreeAddTimeoutMs；`worktree remove` 固定 `5 * 60_000`（25 行）；其余 gitTimeoutMs。volatile 字段每次调用读取（22-23 行注释）。

#### initial-commit.ts
- `GitCommitProtocol`（8 行）：`{ prepare: string; beforeCommit(): Promise<void> }`。
- `initialCommitActions(inspect, run)`（13-119 行）返回三个动作：
  - `preflightInitialCommit`（29-47 行）：`ready | files | empty`（empty 时对 root/canonical/gitDir/HEAD/index 做身份+内容 sha256 指纹，39-45 行）。
  - `initializeEmptyRepository`（48-100 行）：`index.lock` `wx` 排他（55-58 行）→ 二次指纹 → `mktree` 空树（67）→ `commit-tree`（68）→ `update-ref --stdin` 事务 CAS 出生分支（74-84 行，`beforeCommit` 钩子在锁内复验）；`EEXIST` → `initialRepositoryBusy`（87-89 行）；finally 逆序清锁（91-99 行）。
  - `initializeProject`（104-117 行，本地适配）：`git init -b main`（111，Git ≥ 2.28）、`add -A`（115，遵循 .gitignore）、`commit`（116）；失败原样报错不回滚（101-103 行注释）。

#### lookup.ts
- `WorkspaceLike`（19-24 行）/`WorkspaceRegistryLike`（26-32 行）；`sameResolvedPath`（56-62 行，win32 忽略大小写）。
- `createDshLookupPort(ctx)`（65-164 行）：动态 `ctx.get('workspaceRegistry')` / `ctx.get('sessions')`；`liveHeaderCwd`（81-84 行）收敛三处重复守卫；端口方法：`getSidebarMemberships`（87-108 行，用 query header 而非 transcript，93-95 行注释）、`listLiveSessions`（109-133 行，结构未知降级为空数组）、`getSession`（134-151 行，Workspace 过滤后用 live header cwd 恢复已交付会话的归属，142-150 行）、`getSessionCwd`（152-157 行）、`getProject`（158-163 行）。

#### project-skill-io.ts
- `checkRoot`（10-15 行，目录身份校验）；`checkPath`（16-36 行，首段必须 `.dsh/.agents/.claude`、次段 `skills`（18 行），逐段 lstat 拒绝链接/特殊文件）；`readSkillFiles`（38-64 行，总预算 64MB，O_NOFOLLOW + inode/dev 比对 44-49 行）；`createSkillDirectories`（66-73 行）；`createSkillFiles`（75-88 行，`O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW`，79 行）。

#### project-skill-provider.ts
- `candidatePath`（14-19 行，兼容 DSH 0.1 `candidate.path` 与 0.2 `locator.path`）。
- `managedSkillRoot(registry)`（22-45 行）：以 Host 持有记录为准验证 `.git` 指针 ↔ gitDir 回链（30-40 行）。
- `ClaudeProjectSkillProvider`（48-119 行）：`name = 'worktree-project-claude'`（10 行）；`run()` 串行化操作（53-57 行）；provider LRU 上限 32（63-67 行）；`listNow`（78-94 行）产出 `rank: 250, source: 'project-claude'`（91 行）；`getNow`（98-108 行）；`observeHostMutation`(109-111)、`dispose`(112-118)。
- `mountProjectSkillProvider(ctx, registry)`（121-133 行）：`ctx.inject(['skills'])` 内 `registerProvider` + 监听 `fs/observed` + effect 清理。

#### project-skills.ts
- 常量：`PROJECT_SKILL_ROOTS = ['.dsh/skills', '.agents/skills', '.claude/skills']`（7 行）、`MAX_FILES = 5000`（8）、`MAX_BYTES = 64MB`（9）。
- `safePath`（17-22 行，skill 根本身可为文件——Windows symlink 占位符场景）；`identity`（23-27）；`inspectPath`（29-39，逐段验证）；`boundedRead`（40-58，读前后 stat/inode/mtime 比对）；`assertSkillTree`（60-70，10000 节点/64 深度上限）；`ownedSkillDirectories`（71-73）；`inventory`（74-98）。
- `ProjectSkillStore`（101-214 行）：`constructor(directory)`(102)、`file(root)`(103，sha256(resolve(root))+'.json')、`snapshot(source)`(104-107)、`load(root)`(108-124，2MB 上限 + 严格 manifest 校验)、`carry(snapshot, target)`(125-167：冲突预检先行(133-143)、`wx` 发布 copying manifest(155)、复制+哈希复验(156-161)、`ready` 经临时文件 rename 提交(163-166))、`scope`(168-171)、`paths`(172)、`state(root, tracked)`(173-203，含目录缺失/新文件的 modified 判定与 fingerprint)、`assertRemovable`(204-212)、`forget`(213)。
- `trackedSkillPaths(indexEntries, headPaths)`（216-223 行）；`hasDeliverableStatus(output, auxiliary, directories)`（225-235 行，只有 `??` 记录算辅助，224 行注释）；`assertSkillPath`（237-239 行）。

#### registry.ts
- 校验器群（17-337 行）：`emptyRegistry`(17-24)、`isOid`(34-36，40 或 64 hex)、`isSafeRelativePath`(42-46)、`isTargetRef`(48-53)、`isSessionBinding`(55-65)、`isReview`(67-85)、`isPreviousReview`(87-95)、`isCheckpoint`(97-114)、`isPreviewReceipt`(116-136)、`isDeliveryProof`(138-150)、`isDelivery`(152-191，七态逐一校验)、`isJournal`(193-250，create 的 creation 证据可选且"旧 journal 永不获得新删除权限"（203 行注释）)、`isRecoveryContinuation`(266-290)、`isManagedCheckout`(292-325，phase 枚举在 321 行)、`isRegistry`(327-337)。
- `migrateLegacyRegistry`（339-394 行）：v1 → v2，非 ready/discarded 的 legacy phase 一律迁移为 `recovery_required`（365-368 行），revision 递增。
- `AtomicJsonCheckoutRegistry`（397-415 行）：`read()`（400-410 行，先 isRegistry，再 legacy 迁移并回写，**损坏文件 fail loud** 抛 `registry_corrupt` 409 行）；`write()`（412-415 行，`writeJsonFileAtomic`）。

#### safe-file.ts — 崩溃安全 JSON 读写
- `RETRYABLE_RENAME_CODES`（14-18 行，win32 多含 EPERM/EACCES/ENOTEMPTY）；`sleepSync`（20-27，Atomics.wait 回退忙等）；`renameAtomicWithRetry`（30-44，5 次指数退避 20*2^(n-1)）；`tmpPathFor`（50-52，`${file}.${pid}.${uuid}.tmp` 唯一命名）；`listTmpFiles`（55-68，按 mtime 新→旧）；`writeJsonFileAtomic`（82-100，先 `.bak` 备份(87-93)再 tmp→rename；79-80 行 ponytail 注释：无跨进程锁，last-writer-wins 仍在）；`writeTextFileAtomic`（103-107）；`readJsonFileSafe`（113-161：主文件 → 最新可解析 .tmp 提升并清理(129-141) → `.bak` 恢复且 `skipBackup` 防止坏主文件覆盖好备份(145-158) → null）。

#### working-directory.ts
- `WorkingDirectoryServiceLike`（18-24 行：`get / ensure? / set`）；`SessionWorkingDirectoryPort`（27-43 行：`current / enter / leave`，`enter` 返回 undefined 时调用方不得谎报 cwd——33-35 行注释）；`createSessionWorkingDirectoryPort(ctx)`（61-101 行，动态解析可选服务，65-67 行连 `ctx.get` 不存在也当未挂载）；`isWithin`（104-112 行）。

#### worktree-creation.ts
- 模块级 `const files = createNodeFilesPort()`（11 行）；`samePath`/`sameIdentity`（12-14 行）。
- `createWorktree(localRoot, target, baseOid, run, saveEvidence)`（17-124 行）：注册短、昂贵 checkout 延后（16 行注释）→ commonDir/parent 身份（30-37）→ **排他 mkdir target**（38 行注释：已存在目录包括空目录都不是本次尝试的）→ 证据 `lockReason = dsh-create-<uuid>`（42）→ `git worktree add --detach --no-checkout --lock --reason …`（44）→ gitDir 身份 + metadataFingerprint（45-48）→ `verifyIdentity`（51）→ sparse 分支 `reset --hard --no-recurse-submodules`（58-61）否则 `read-tree` + index 指纹 + `checkout-index --all`（63-66）→ 复验（68）→ `worktree unlock`（69）。catch 路径：未 claim → `WorktreeCreationFailure(message, true)`（72）；已 claim 未注册且 quiescent → 校验元数据集合未变后 `rmdir`（73-91）；已注册且 quiescent → 复验身份/metadata/unmodified 后 `worktree move --force --force` 进 quarantine 再 `remove --force --force`（94-121）；否则保留现场（122）。**超时/失去进程树观察/身份缺失永不是删除权限**（92-93 行注释）。
- `verifyIdentity`（126-148 行）：`.git` 指针、`gitdir`/`commondir`/`HEAD`/`locked` 回链逐字节校验（135-145）；任何 `.lock` 存在即失败（147 行注释：绝不破坏 index lock）。
- `verifyRollbackMetadata`（150-160 行）；`metadataFingerprint`（162-183 行，白名单条目 172 行，`index/gitdir/ORIG_HEAD` 单独校验 168 行）；`verifyUnmodified`（185-249 行：全 index 等于授权 base、拒绝 submodule（193）、拒绝 filter/working-tree-encoding（214-220）、逐文件重算 git blob hash（221-241）、`diff-index`/`ls-files -v`/`ls-files --others` 全干净（242-249））。

### 6. 控制台 Host（`src/console-host/`）

#### errors.ts
- `domainError(code, message, continuation?)`（5-11 行）；`consoleFailure(error)`（13-41 行：域错误透传 code/continuation，其他归为 `git_error`；**30-33 行 ponytail 注释：本地 UI 故意原样透出第三方消息，将来有远程序列化前必须截断/替换**）；`failure()`（43-58）；`outcome(operation)`（60-66）。

#### projection.ts
- 内部：`review()`(16-31)、`commitOid()`(33-35)、`deliveryProof()`(37-56)、`iteration()`(58-60)、`fallbackOid()`(107-110)。
- `capabilities(record, callerSessionId, ownerSessionAvailable, linkedRead)`（62-105 行）：16 个能力位的完整推导（owner/source/sourceReservation/readAuthorized/manageAuthorized × phase/deliveryState）。
- `sourceBranchFromRef`（112-114 行）。
- `projectRecord`（116-190 行）→ `WorktreeConsoleTargetSummary`：`sourceBranch` 用 `record.sessionBranch ?? record.sourceRef`（148-150 行注释：session branch 优先，避免把 fork 点误标为归属）；retained 附 retention/retainedAt/expiresAt；cleanupMessage 经 `hostPersistedCleanupMessage` 本地化（156-158）；`reviewSlot: 'available'`（174）；preview_detached 附 `previewRecovery`（175-182）。
- `projectDetails`（192-270 行）→ `WorktreeConsoleTargetDetails`：`currentBranch = settledLocalBranch ?? snapshot?.branch ?? sessionBranch`（226 行及 214-225 行注释：已交付 Worktree 的 owner 回到 Local，胶囊必须报用户实际所在分支）；owner 且非 linkedRead 时附 `recoveryContinuation`（227-268，四种 kind 逐一映射）。
- `projectLocal`（272-310 行）：Local 目标投影，`create: target.current.oid !== 'unversioned'`（288），其余能力全 false。

#### control-plane.ts
- `WorktreeConsoleControlPlaneOptions`（70-78 行）/`WorktreeConsoleControlPlane` 接口（80-119 行，39 个方法）。
- 辅助：`recordOf`(121-125)、`sidebarTaskState`(127-138，交付优先于 phase——130-131 行注释)、`readyReview`(140-145)、`previewReview`(147-155)、`applyConflictContinuation`(167-190，requestId 形如 `apply-conflict:<checkoutId>:<reviewId>:<revision>:<localHeadOid>` 183 行)、`preflightFailure`(192-204)。
- `createWorktreeConsoleControlPlane(options)`（206-1553 行）内部关键函数：
  - `unboundLocalTarget`(209-228)、`callerTarget`(230-239)、`verifyCallerRoot`(241-316，owner 的活 cwd/已交付终态的 Local 边界/丢失 project.root 的 missingOwnerCwd 分支，realpath 记忆化 268-276)、`authorize`(318-338，owner/source 校验 + 项目匹配 + 可见性)、`linkedReadAccess`(340-398，同链路会话读 + 验收槽持有者精确锚定)、`observe`(400-419)、`observeFromCaller`(443-461，复用 `current` 已付的三 spawn 成本，425-441 行注释量化 ~30-50ms/spawn)、`withinRoot`(464-472)、`settledLocalBranch`(489-513)、`acceptanceHolder`(519-532)、`projectReviewSlot`(534-551)、`details`(562-601)、`mutationResponse`(603-625)、`withCreation`(655-672，session+root 双重互斥)、`createTarget`(673-695)。
  - 导出方法（697-1553 行）：`sidebarTopology`(698-762，memberships 保留全部迭代的目录身份)、`current`(764-770)、`gitOverview`(772-785)、`gitGraph`(787-792)、`gitCreateBranch`(794-799)、`gitSwitchBranch`(801-816，交付中禁止切分支 805-812)、`gitPruneMergedBranches`(818-820)、`gitListTags/gitCreateTag/gitDeleteTag(先远端后本地 844-852)/gitPushTag`(822-867)、`listAbandoned`(869-871)、`restoreAbandoned`(873-877)、`list`(879-954，批量观察 + 降级观察 905-934)、`preflightCreate`(956-972，确认令牌 5 分钟过期 970)、`createWithInitialCommit`(973-988)、`create`(989)、`initProject`(990-994)、`inspect`(996)、`reviewDiff`(998-1036，diff 前后双 preflight CAS 1005-1030)、`preflight`(1038-1047)、`previewRecoveryPreflight`(1049-1067)、`preparePreviewRecoveryAnalysis`(1069-1097)、`createPreviewRecoveryHandoff`(1099-1146)、`checkpoint`(1148-1174)、`preview`(1176-1198，冲突抛 `apply_conflict` + continuation 1186-1192)、`resumeRevision`(1200-1261，冲突恢复请求身份校验 1206-1216)、`prepareReviewRegeneration`(1263-1286)、`rollbackPreview`(1288-1306)、`discard`(1308-1335)、`finalize`(1337-1379)、`finalizePreview`(1381-1424)、`setRetention/setPermanent/retryCleanup/clearSidebarBadge`(1426-1470)、`beginNextIteration`(1472-1516，predecessor lineage + cwd 校验)、`returnToLocal`(1518-1551，只放行已交付记录，边界说明在 1518-1527 行注释)。

#### review-diff.ts
- 限额：`REVIEW_DIFF_MAX_FILES = 200`（9）、`REVIEW_DIFF_MAX_PATCH_BYTES = 100KB`（10）、`REVIEW_DIFF_MAX_PAYLOAD_BYTES = 1MB`（11）。
- `ReviewDiffStaleError`（25-30）；`git()`（34-64，直接 spawn 带 `GIT_TERMINAL_PROMPT=0` 与截断统计）；`projectPath`（66-70）；`utf8Prefix`（72-78，不切破 UTF-8）；`parseNameStatus`（90-113，R/C 折叠为 renamed，97-99 行注释）。
- `createGitWorktreeReviewDiffReader(projectSkills?)`（123-245 行）：mkdtemp 临时对象目录 + `GIT_OBJECT_DIRECTORY/GIT_ALTERNATE_OBJECT_DIRECTORIES`（132-144）→ `read-tree baseOid` + `add -A`（145-146）→ 剔除 skills 路径（147-162，批 4000 字符 `update-index --force-remove`）→ `diff --cached --name-status --find-renames`（163-168）→ 与评审 changedFiles 精确比对（174-177）→ **8 个文件一批并行取证**（183-186 行注释：逐文件 2 spawn 串行最坏 400 次会顶爆 180s 超时）→ 1MB payload 预算折叠（217-237）。

#### service.ts
- `WorktreeConsoleService extends TypertRemoteService`（35-343 行）：构造器 `(hostContext, controlPlane, diagFile?, officialWorkspaceActive = true)`（36-44）；`appendDiag`（47-52，ndjson 面包屑绝不破坏 RPC）；每个 `@Remote` 方法把 `agent.id` 映射到 control-plane 并包 `withHostLanguage`。`sidebarTopology`（55-67）附加 `workspaceClientFlavor` 与 `officialWorkspaceActive`；`clientBootReport`（70-73）；`current`（76-89）记录耗时与失败 code/message（77-82 行注释：胶囊排障唯一现场证据）。

### 7. RPC 契约（`src/console-contract.ts` + `src/console-remote/`）

#### console-contract.ts（JSON-only 共享契约，1-9 行注释声明"零 Cordis/React/Remote/文件系统"）
- `WORKTREE_CONSOLE_TARGET_STATES`（26-38 行）：`local, creating, working, ready_for_review, preview_active, preview_detached, retained, cleanup_pending, recovery_required, delivered, discarded`。
- `worktreeReachedDelivery(phase, deliveryState)`（64-73 行）；`consoleStateFromDomain`（76-91 行，**discarded 相位压过 retained/finalized 交付标签**，81-83 行注释）。
- `WorktreeConsoleCapabilities`（98-124 行）：`create, open, inspect, discard, preflight, preview, checkpoint, resumeRevision, rollbackPreview, finalize, finalizePreview, setRetention, setPermanent, retryCleanup, beginNextIteration, returnToLocal`。
- `WorktreeConsoleTargetSummary`（149-179 行）字段：`project, checkoutId, sourceSessionId, ownerSessionId, targetSessionId, iteration, revision, state, phase, dirty, currentOid, commitOid, sourceBranch, retention?, retainedAt?, expiresAt?, permanent?, cleanupMessage?, deliveryProof?, review?, checkpoints?, checkpointGeneration?, reviewSlot?, reviewSlotOwnerSessionId?, reviewSlotHolder?, previewRecovery?, capabilities`。
- `WorktreeConsoleTargetDetails`（182-195 行）扩展：`managedRoot, sourceRoot, sourceOid, currentBranch, recoveryContinuation?`。
- Sidebar 拓扑（216-263 行）：`WorktreeSidebarTask`、`WorktreeSidebarProject.memberships?`（Host 证明的目录成员关系，241 行）、`WorktreeSidebarTopologyResponse { projects, workspaceClientFlavor?, officialWorkspaceActive? }`、`WorktreeClientBootReport`。
- 创建预检（266-269 行）：`{ kind:'ready', branches? } | { kind:'empty', confirmationToken } | { kind:'files' }`。
- 错误面（609-742 行）：`WORKTREE_CONSOLE_ERROR_CODES`（域码 + transport_unavailable/malformed_response/timeout）；`WorktreeApplyConflictContinuation`(628-639)、四种 `RecoveryProof`(641-679)、`WorktreeConsoleError`(688-693，`continuation` 仅 apply_conflict 可带)、`WorktreeConsoleOutcome<T>`(695-697)、`ERROR_META` 表（705-738，每个码的 category/recovery/retryable）+ `worktreeConsoleErrorMeta()`(740-742)。
- `WorktreeConsoleAdapter` 接口（745-784 行）：Client 侧规范化 seam，38 个方法（可选：`preflightCreate?/createWithInitialCommit?/initializeProject?/listAbandoned?/restoreAbandoned?`）。

#### console-remote/schemas.ts（zod strict）
- 基础（31-55 行）：`sessionIdSchema/checkoutIdSchema/reviewIdSchema/commitMessageSchema/revisionSchema/gitOidSchema/oidSchema(含 'unversioned'|'unborn')/previewIdSchema/generationSchema/requestIdSchema/branchNameSchema(46-50 行规则)/retentionSchema/retainedModeSchema`。
- `capabilitiesSchema`：`returnToLocal: z.boolean().default(false)`（105 行及 100-104 行注释——**新增能力位必须容忍缺失**，Client 与 Host 独立部署）。
- `consoleErrorSchema.superRefine`（221-225 行）：continuation 只允许出现在 `apply_conflict`。
- `outcomeSchema<T>()`（227-232）；响应 schema：`currentResponseSchema`(234)、`createPreflightResponseSchema`(235-239，confirmationToken 为 uuid)、`createResponseSchema`(240-244)、`inspectResponseSchema`(245)、`listResponseSchema`(246)、`sidebarTopologyResponseSchema`(247-264)、`clientBootReportSchema`(265-272)、`mutationResponseSchema`(273-279)、`preflightSchema`(300-313)、preview recovery 证明/预检（316-376）、`reviewDiffResponseSchema`(378-383)、git 面 schema（385-448，`gitTagSchema.pushed: booleanSchema.nullable()` 438 行注释：null=无法查询远端，绝不强转为 false）、abandoned（450-463）。

#### console-remote/descriptors.ts
- `strictCodec(typeSymbol, schema)`（52-56 行：DSH 0.2 消费 lazy `create()`，同时保留 legacy `schema` 字段）；`agentParameter`（58-64，wire `agentId`）；`json()`（66-74）；`descriptor()`（76-92，自动追加 `locale` 参数）。
- `WORKTREE_CONSOLE_DESCRIPTORS`（94-246 行，`Object.freeze`）：全部方法的 invocation 描述符（checkoutId/revision/reviewId/proof 等参数逐一绑定 schema）。
- `WORKTREE_CONSOLE_REMOTE`（248-251）：`{ package: 'dsh-git-worktree', descriptors }`。

#### console-remote/remote.ts
- `GitWorktreeRemote = TypertRemoteNamespace<'gitWorktree'>`（31 行）；`declare module '@deepseek-ai/dsh-typert-protocol'` 的 `TypertRemoteMap`（36-77 行）为每个方法声明签名（`agentId` 首参 + trailing `locale?`）；`TypertRemoteNamespaceMap`（79-81）。

### 8. Web 客户端（`src/client/`）

#### 入口与编排
- `src/client/index.tsx`：`WORKTREE_CONSOLE_ADAPTER_SERVICE = 'worktreeConsole'`（18）；`inject = ['slots','workspaces','sessions','conversation','connection','locale']`（36）；`apply(ctx, adapterOverride?)`（49-106）：Proxy 包装 `ctx.slots.register` 注入 `ClientI18nProvider`（53-59）、自持有样式表（data-plugin 标记，66-77）、注册 ToolView `worktree_create`/`worktree_ready_for_review`（81-88）、有 adapter 时挂 `registerTargetConsole` + `registerPreSessionWorktree`（91-105）。
- `src/client/console-remote/index.ts`：`inject`（45-49，从 officialWorkspaceInject 过滤掉 `remote.directoryPicker`/`remoteAccess` 再加 `slots`/`configForms`——19-44 行注释解释 picker/remoteAccess 死锁与 0.2.0-rc.2 boot 卡死）；`apply`（62-206）：mount remote → `worktreeConsole` provide（72）→ `mountSettingsCard`(73) → `sidebarTopology` 探测 flavor（103-111）→ legacy(112-121)/modern(122-161，officialWorkspaceActive 时 decorate 否则接管)/alpha|next(162-200)/unsupported(201-205) 四分支，每分支 `reportBoot` 上报。
- `src/client/console-remote/adapter.ts`：`FAST_TIMEOUT_MS = 30_000`（56）、`SLOW_TIMEOUT_MS = 180_000`（57）；`FAST_METHODS`（60-65：sidebarTopology/current/inspect/previewRecoveryPreflight/gitOverview/gitGraph/listAbandoned）；`createWorktreeConsoleRemoteAdapter(remote, getLanguage)`（80-156）：`Promise.race` 超时（89-94）、codec 拒绝识别（45-48）、结果用 descriptor strict parse（105-111）。

#### actions.ts（浏览器端编排）
- 服务接口：`ClientSessionSnapshot`(16-20)、`ClientSessionBinding`(22-42)、`ClientSessions`(44-61)、`ClientWorkspaces`(63-66)、`WorktreeClientServices`(68-80)、`PreSessionWorktreeServices`(87-102)、`PreSessionInput`(105-113)。
- `navigateToSession`（125-132，优先 uiWorkspace）；`selectedSessionId`（135-142，retainedBy 契约）；`openExistingSession`（145-154，cwd 校验后导航）；`waitForProjectedSessionPath`（156-196，2s 超时 190 行）；`openIsolatedTarget`（199-230，幂等注册 Workspace→创建 Session→等 cwd 投影→导航）；`openAuthorizedWorktreeTarget`（236-263，先 `adapter.inspect` 验能力与身份）；`prefillSessionDraft`（266-275）；`finalizeCurrentSession`（278-292，提交 `/worktree finalize ${reviewId} ${revision} ${retention}` 字面命令，290 行）。

#### model.ts（纯回放稳定模型）
- `WorktreeCreatePayload`（31-43）、`WorktreeReviewPayload`（45-52）、`ReviewArgs`（54-61）、`ToolLifecycle`（63）、`ParsedTool`（65-70）。
- `parseCreateTool`（100-117）/`reviewArgs`（119-150）/`parseReviewTool`（152-185）：仅从日志 call/result 切片派生，running/ok/error/stopped 全覆盖。

#### i18n.tsx
- `readClientLanguage`（19-21）、`clientTranslator`（23-25）、`ClientI18nProvider`（29-40，`useSyncExternalStore` 订阅 locale snapshot）、`useClientLanguage`(42)/`useClientTranslator`(43-46)、`translatorForServices`（49-51，命令式服务在调用时解析语言）。

#### ToolView 行
- `WorktreeCreateRow.tsx`（13-83）：创建卡，`openIsolatedTarget` 按钮 + `cwdSelected` 状态。
- `WorktreeReviewRow.tsx`（26-123）：评审卡，`review` 从日志证据合成（36-48）、监听 `WORKTREE_REVIEW_REFRESH_EVENT`（54-62）、live target 经 adapter.current 拉取（69-88）、`target_unselected` 错误整卡隐藏（90）。

#### review-console/
- `ReviewIcon.tsx`（8-21）：lucide 图标名映射。
- `WorktreeReviewPanel.tsx`：`WorktreeReviewEvidence`(9-11)、`WorktreeReviewIdentity`(13-18)、`reviewIsStale`(40-52)、面板组件（54-117）。
- `request-cache.ts`：`createRequestCache`（41-151）——identity-keyed 单飞读缓存，`WeakMap<adapter, Map>`（51 行注释：重挂载的 client 永远读不到别的 adapter 的数据）；`invalidate` 以 generation 防迟到响应回写（111-117）。
- `preflight-cache.ts`（7-22）/`preview-recovery-cache.ts`（7-22）：两个具体缓存实例。
- `recovery-continuation.ts`：恢复请求队列。类型（6-36）；`STORAGE_PREFIX = 'dsh-git-worktree:recovery:v1:'`（51）；localStorage 持久化（73-118，仅 queued/sending/failed，best-effort）；`validRequest`（140-167，精确键集合校验）；`targetMatchesRequest`（195-225）；`attempt`（280-376，发送前再 inspect、prompt 用 `'queue'` 模式 351 行）；`buildWorktreeRecoveryPrompt`（378-386）；`enqueueWorktreeRecovery`（389-427）、`restoreWorktreeRecovery`（429-489）、`retryWorktreeRecovery`（491-501，cancelled 也允许重发，493 行注释）、`cancelWorktreeRecovery`（523-528）、`detachWorktreeRecoveryRuntime`（531-538）。
- `ReviewActions.tsx`（82-1199）：验收动作巨组件。`Mutation` 类型（52）；`DEFAULT_RETAIN_ENVIRONMENT = true`（80，误交付可恢复）；自动预检（118-129）；冲突恢复 `startConflictRecovery`（265-358，五重身份比对后 `resumeRevision` + 入队恢复请求）；评审再生成 `startReviewRegeneration`（360-422）；`previewLocal`(453-485)、`checkpoint`(494-534)、`resumeRevision`(536-559)、`rollbackPreview`(561-623，detached 需 fresh recovery proof 564-593)、`submitCommit`(625-697，finish 前强制 force preflight 632-646)、`discard`(699-722)、`analyzeRecovery`(741-795，二次 inspect 验证 continuation 775-780 后向 owner 会话发只读分析 prompt)、`handoffRecovery`(797-856，新 worktree 交接)、`retryCleanup`(858-876)、`openHolder`(878-895)；三个 Modal（checkpoint 1026-1052 / commit 1054-1094 含保留期下拉 / discard 1096-1112）；detached 恢复面板（1124-1163）。
- `PreflightStatus.tsx`（21-114）、`DeliveryProof.tsx`（16-48）、`ReviewDetailsModal.tsx`（36-88，焦点陷阱 41-64）、`index.ts`（`reviewEvidenceFromTarget` 12-21、`reviewIdentityFromTarget` 24-35）。
- `status-events.ts`：`WORKTREE_REVIEW_REFRESH_EVENT = 'dsh-git-worktree:review-refresh'`（1）、`requestWorktreeReviewRefresh`（4-6，window CustomEvent 广播）。

#### target-console/
- `registerTargetConsole`（index.ts 19-46）：`conversation.session.header.actions`(order 30)、`conversation.input.dock` 两个席位（review-status order 10、hero-chip order 20）。
- `TargetStatusAction.tsx`（51-764）：目标胶囊。`STATE_LABELS`（32-44）；`subscribeCurrent` 订阅（98-138）；`notGitRepository` 分支（144-155，专属文案与初始化出口）；分支切换乐观补丁（200-218 行注释）；`gitPruneMergedBranches` dryRun 预览（287-310）；胶囊菜单 items（494-559）与 footer（555-559）；分支搜索框 Enter/方向键本地化（509-524）。
- `branch-overview-cache.ts`：`TTL_MS = 60_000`（17）；`patchEpochs` 防飞行回写踩掉乐观补丁（13-16 行注释）；`ensureBranchOverview`（80-84）、`refreshBranchOverviewInBackground`（87-92）、`invalidateBranchOverview`（35-38）。
- `current-polling.ts`：`DELAY = 5_000`（8）、`HIDDEN_DELAY = 60_000`（15，隐藏窗口省 CPU）；`Poll` 类（22-91，generation/dirty 合并、visibilitychange 恢复）；`subscribeCurrent`（94-107，adapter 身份隔离 Client 实例）。
- `WorktreeReviewStatus.tsx`（25-184）：Dock 验收条（Domi 风格，24 行注释）；standalone 恢复态渲染（75-99）；label/detail 按 state 推导（120-137）；`dismissed` 按 checkoutId+reviewId 作用域（29-30、111-113）。
- `WorktreeConsoleView.tsx`（93-700）：管理面板。`ATTENTION_RANK`（78-90）；`refresh` 三并发请求（145-176）；恢复条独立轻量刷新（178-190）；`createTarget`（236-291，五重身份断言 250-265）；discard/restoreAbandoned/setRetention/setPermanent/retryCleanup/openListedTarget（293-437）。
- `WorktreeHeroChip.tsx`（84-142）：空白会话 hero 行 chip，`findHeroRowFrom`（44-69）结构化查找 + MutationObserver + 4s 有界轮询兜底（88-129）；`resolvePortalRenderer`（10-29，懒解析 react-dom）。
- `BranchGraphModal.tsx`：`mergeRefs`（39-57，本地+远端同名折叠，tag 不与分支折叠）；`computeGraphLanes`（66-127，lane 拓扑来自 @linxin666/dsh-client-ui-git-graph 的 computeLanes，59-65 行注释）；SVG 渲染（247-307）。
- `TagManagerModal.tsx`（26-262）：列表单 RPC，变更后强制重读（21-25 行注释）；`load` 不清 error（39-47 行注释，避免 push 失败消息被擦掉）。
- `WorktreeManagerModal.tsx`（18-49）：`WorktreeConsoleView` 的会话内入口。

#### pre-session/
- `harness-input.ts`：`readHarnessInput`（14-19，attachmentIds/imageIds 双 API 兼容）、`adaptHarnessInputActions`（22-31，绑原 receiver——类实例方法）。
- `controller.ts`：`PreSessionDraftState`（10-17，含 `draftRev?` 单调修订号）、`PreSessionWorktreeError`（37-42，`recoveryRequired` 标志）、`sourceStillMatches`（52-60）、`PreSessionWorktreeController`（67-230）：`prepare`（75-83，inflight 去重）；`run`（85-195）：导航能力前置检查（96-98）、agent preset 保留（101-104）、composer 阻断块（104-105）、create/createWithInitialCommit（111-117）、Workspace/Session 创建（120-135）、`handoff`（138-156，**从最终 source CAS 到 target 写入/导航/清空 source 无任何 await**，146-148 行注释）、`sessions.using` 双路径（160-164）、source 归档（166-170，失败不回滚 target）、失败回滚（172-191）；`rollback`（197-229，先 discard 再幂等 archive 再删 workspace）。
- `PreSessionWorktreeToggle.tsx`（36-180）：render 期失效旧续体（46-53 行注释）、`preflightCreate` 捕获输入快照（96-116）、令牌一次性（141-143 行注释）、确认 Modal（163-177）。
- `index.tsx`（30-60）：`conversation.input.left` 席位（order 40），composerPhase 推导（39-41）。

#### settings-card/
- `form-model.ts`：`SettingsFormScopeSnapshot`（24-37，`status/value/base/user/writable/revision`）；`SettingsFieldSpec`（57-67）；`settingsBooleanField`（129-141）/`settingsNumberField`（149-162）/`settingsTextField`（170-179）；`SettingsFormModel<T>`（188-368）：`bind`(214-218)、`shell`(224-235)、`field`(242-254)、`actions`(260-275)、`save`(285-303，revision fence + 落地与否读回)、`plan`(313-328)。设计理由见 8-19 行注释（staged 文本 = 屏上即所存；override 以 user 层**存在性**判定）。
- `worktree-settings-card.ts`：`WORKTREE_SETTINGS_NS = 'dsh-git-worktree'`（14）、`WorktreeSettings`（17-23）、`WorktreeSettingsCardController`（39-69，五个字段 spec + snapshot store projection）。
- `WorktreeSettingsCard.tsx`（162-233）：内联样式自包含（1-7 行注释：插件附带的 client-ui-primitives 版本早于共享 SettingsForm）；summary/表单双视图；开关/输入/override 徽章/重置。
- `index.ts` `mountSettingsCard`（35-57）：fail-soft `ctx.get`（36-38 行注释）、`configForms.whileServed([NS], () => slots.inject('plugins.bundle.config', ...))`（52-56）。

#### workspace-sidebar/
- `model.ts`：`sidebarBadgeTasks`（51-74，每 owner 取 iteration/revision 最新）；`projectManagedWorkspaceSidebar`（81-203）：把 Managed owner 合并回原 Local 项目，歧义 fail-open（80-81 行注释），成员搬迁/空 workspace 隐藏/`memberships` 目录归属通道（139-193）。
- `index.tsx`：`ManagedOfficialWorkspaceBrowser`（70-203，投影 useWorkspaces/useSessions、保护 startSession/forkSession/insertSessionBefore 185-201、badge 菜单 mount 期注册 91-98）；`officialContextProxy`（237-321，guard 拦截 fork 类菜单、deferred `remote.directoryPicker`（219-235）、`remoteAccess` stub（309-316））；`registerManagedWorkspaceSidebar`（328-334）；`ClearSidebarBadgeMenuItem`（347-381）；`registerDecoratedWorkspaceSidebar`（495-535，Mode B：`ROW_SEATS = ['sidebar.session.row.leading','sidebar.session.row.hover']`（424 行，**DSH 0.2.x 没有 trailing 席位**，419-423/517-521 行注释））。

### 9. 工具与命令（`src/tools.ts`、`src/commands.ts`）

#### tools.ts — 模型工具（均 `withHostLanguage(languageForInvocation(...))` 包裹）
- `parseWorktreeRetention`（24-30）；`leaveCheckoutBeforeRemoval`（51-66，**cwd 恢复失败必须中止删除**，46-50 行注释）；`enterCheckout`（76-91，优先从台账 `resolveRoots` 读根避免全量校验锁）。
- `registerTools(ctx, module)`（94-693）注册九个工具：

| 工具 | 行号 | 要点 |
| --- | --- | --- |
| `worktree_create` | 100-166 | in-place 创建：`targetSessionId = sourceSessionId`（137 行）；创建即 `enterCheckout`（148）；输出含 `branch`/`cwdSelected`/`cwd` |
| `worktree_list` | 168-224 | `commitOid` 缺省而非空串（216-218 行注释：宿主拒绝 undefined 之外还拒绝 null/''） |
| `worktree_resume_revision` | 226-271 | Ready→Working，必须先于新的文件修改（227-229 行 description 注释） |
| `worktree_begin_next_iteration` | 273-316 | 交付+清理完成后重建 cwd 进入下一轮 |
| `worktree_ready_for_review` | 318-403 | summary/details/validationStatus/tests/suggestedCommitMessage |
| `worktree_deliver` | 405-506 | **autoDeliver 关闭即拒绝**（451-453）；Working 或 Ready 均可；先 leave 后 finish（470-473）；失败回 `enterCheckout`（482-490）；返回 `branch`（497 行注释：交付落在会话分支，Local 未写） |
| `worktree_cleanup` | 508-558 | `cleanup_retained` + CAS revision |
| `worktree_prune_branches` | 560-628 | `git branch -d` 语义，dryRun 预览 |
| `worktree_merge` | 630-692 | forward/reverse 合并，dryRun 试合并 |

#### commands.ts — `/worktree` 人类命令
- `registerWorktreeCommand(ctx, module)`（44-228）：先建 `createSessionWorkingDirectoryPort`（48）；`leaveCheckout`（51-61，失败即中止删除）；`enterCheckout`（62-72）。动词：`status`(84-86)、`list`(87-96)、`continue`(97-109)、`next`(110-120，创建后回 `enterCheckout`)、`finalize`(121-159，可选 `reviewId revision` + retention；验收卡过期检测 133-138；失败后把会话放回 checkout 152-153)、`finish`(160-179)、`discard`(180-200)、`remove <checkoutId>`(201-219)、未知动词(220-221)。破坏性动词刻意只给人用（3-5 行注释）。

### 10. i18n（`src/i18n/`）

- `core.ts`：`Language = 'zh' | 'en'`（2）；`normalizeLanguage`（4-6，`/^en(?:-|$)/i`）；`MessageCatalog`（8，`Record<string, { zh, en }>`）；带占位符类型推导的 `Translator<C>`（14-17）；`createTranslator`（19-25，`{name}` 插值，未提供参数时原样保留）。
- `host.ts`：`AsyncLocalStorage` 语言快照（6-10）；`withHostLanguage(language, op)`（12-14）；`languageFromSettings(ctx)`（17-27，只读 `settings.get('locale').preference`，异常回退 `'zh'`）；`languageForInvocation(agent, fallback)`（30-33，优先 agent.ctx 防跨用户泄漏）；`hostMessage`（35-38）。
- `host-messages.ts`：`hostMessages` 目录（4-1756，约 370 个键，zh/en 双语）；`hostRegistrationMessage(key)`（1759-1761，`zh + ' / ' + en`——注册元数据双语共享）；`persistedCleanupKeys`（1768）+ `hostPersistedCleanupMessage(message, translate)`（1770-1773，**有限白名单**把持久化的旧中文 cleanup 消息映射到当前语言，1763-1767 行注释：绝不解释/改写第三方错误文本）。

### 11. 支撑模块

- `src/commit-message.ts`：`isValidCommitMessage(value)`（2-4 行）：非空 trim 且不含 NUL；注释说明 500 字符非 Git 限制。
- `src/concurrent-session-guard.ts`：`GuardSessionInfo`(16-21)、`BranchRaceFacts`(23-29)、`BranchRaceInput`(31-51)；`cwdWithinLocalRoot`(60-65，cwd 缺失按共享处理)；`detectLocalBranchRace`(68-89)：更早启动的同 checkout 会话 × 检测窗内新建分支（managed 分支排除 79-82）→ `race_detected`；纯同步谓词（8-12 行注释：runtimeContext 必须同步）。
- `src/checkpoint.ts`：`canonicalJson`（4-13，键排序稳定序列化）；`checkpointGenerationForRecord(record)`（16-28）：仅 `ready_for_review/preview_active` 时对该 Review+检查点链做 sha256 CAS generation。
- `src/creation-failure.ts`：`WorktreeCreationFailure`（2-7），`rolledBack` 布尔——**创建失败绝不等于"空路径安全"**（1 行注释）。
- `src/delivery-excludes.ts`：`HOST_RUNTIME_ARTIFACTS = ['.dsh-ops', 'desktop-runtime.json', '.dsh-runtime.json']`（12-16）；`deliveryExcludePathspecs`（22-30，每路径产 4 个 pathspec：本体/子树/`**` 嵌套两种）。设计理由见 1-11 行注释（"评审看到的"必须等于"交付出去的"）。
- `src/host-compat.ts`：`workspaceClientFlavorForAgentVersion`（7-25：四个精确版本映射 + 0.2.x→modern（isModernGeneration，27-30）+ 其余 unsupported）；`agentVersionFromAnchor`（32-42）；`workspaceFlavorDiagnostics(anchors)`（65-77，anchors 依次 `process.argv[1]`、`process.cwd()`、`import.meta.url`，58-64 行注释解释 link: 安装下的遮蔽顺序）；`hostWorkspaceClientFlavor`（79-81）。
- `src/managed-worktree-path.ts`：`sanitizeManagedWorktreeLabel`（15-29，Windows 保留名/非法字符/NFC）；`createManagedWorktreeRepositoryKey`（38-40，sha256 前 12）；`sanitizeBranchSegment`（46-55）；`createSessionBranchCandidates`（63-75，`feat/sess-<session>[--<topic>]` + `-2..-N`）；`createManagedWorktreeDirectoryName`（78-86）；`createTopicManagedWorktreeDirectoryName`（101-112，`<topic>-<YYYYMMDD>[-<id>]`）；`createTopicDateStamp`（115-120）；`createManagedWorktreePathCandidates`（132-175，有 `worktreesRoot` 时两种容器都落在其下，127-131 行注释）。
- `src/session-target-context.ts`：`registerSessionTargetContext`（14-42）：45s 后台刷新 branch-race 缓存（20-27）；`ctx.inject(['systemPrompt'])` 内 `systemPrompt.context({ name: 'git-worktree:session-target', order: 118, text })`（28-41），无 session id 返回空串。
- `src/workspace-provider-lifecycle.ts`：`OFFICIAL_WORKSPACE = '@deepseek-ai/dsh-client-ui-workspace'`（11）；`UNLOADING: FiberState = 5`（13）；`DEFAULT_OPERATION_TIMEOUT_MS = 10_000`（18）；跨代 `ownedDisables = new WeakSet<Entry>()`（26）。`mountWorkspaceProviderLifecycle(ctx, flavor, options)`（66-304）：未启用/unsupported 直接放行（81-88）；`operate(entry, 'disable'|'restore')`（132-180，Loader 1.0.6 适配：disable 后 await 旧 fiber、restore 时重建死代，140-146 行注释）；`reconcile`（181-206，adopted/overridden 记账，`update` 同步提交 `options.disabled === true` 才算 adopt，196-201）；释放 effect（208-259，Cordis 4.0.5 并发卸载 → 先 `releaseMarker()`、`withdraw()` 时机、UNLOADING 等待）；`internal/status` / `internal/plugin` 事件重入选举（267-276）；最终 `await reconcile()`（281）并只在全部 owned 条目确实 disabled 时报告接管（285-303，2026-10-11 事故注释）。

## Architecture

```text
┌─────────────────────── DSH Host (Cordis ctx) ────────────────────────┐
│        src/index.ts :: apply()  组装下列全部子系统 (358-458)          │
└──┬───────────────┬───────────────────┬────────────────┬─────────────┘
   ▼               ▼                   ▼                ▼
┌───────────┐ ┌───────────────┐ ┌───────────────┐ ┌────────────────────┐
│adapters/  │►│session-       │◄┤tools.ts       │ │console-host/       │
│git/files  │ │checkout-apply │ │commands.ts    │ │service.ts (@Remote)│
│registry/  │ │(引擎 2678 行) │ └───────────────┘ └─────────┬──────────┘
│lookup     │ └───────────────┘                             ▼ Typert RPC
└─────▲─────┘ ┌──────────────────────────────────┐ ┌────────────────────┐
      │ports.ts│managed-checkouts.json (v2 原子)  │ │console-remote/     │
      └────────┤refs/dsh-worktree/{session-…,…}   │ │schemas/descriptors │
               └──────────────────────────────────┘ └─────────┬──────────┘
                                                              ▼
                                                   ┌──────────────────────┐
                                                   │ client/ (React UI)   │
                                                   └──────────────────────┘
```

层次要点：

- **端口反转**：领域逻辑（apply 引擎、状态机）只依赖 `ports.ts` 接口；`adapters/` 提供 DSH 实现（1-8 行 ports.ts 模块注释），因此可用 fake 测试。
- **单一 RPC 通道**：Client 永远通过 `WorktreeConsoleAdapter`（console-contract.ts 745-784）→ Typert strict 描述符（console-remote/descriptors.ts）→ `WorktreeConsoleService`（console-host/service.ts）→ 控制面 → 模块；Client 与 Host 是两份独立部署产物，schema 用 `default(false)` 等手段容忍增量（schemas.ts 100-104）。
- **授权边界**：每个 Host 操作都解析精确 caller 会话并在执行时复验 project/owner/cwd/revision/review 身份（console-contract.ts 5-8 行注释）；`capabilities()` 投影只影响 UI 可见性，真实 mutation 都重新 CAS。
- **ref 命名空间隔离**：插件产物全部在 `refs/dsh-worktree/` 下，永不与用户 ref 冲突（git.ts 12-13 行注释）。

## Data Flow

1. **创建（Local → Isolated）**
   `worktree_create`（tools.ts 100-166）→ `module.createIsolatedTarget`（路径候选由 `managed-worktree-path.ts` 生成）→ `createDetachedWorktree`（git.ts 336-348）→ `createWorktree`（worktree-creation.ts 17-124：排他 mkdir → `worktree add --detach --no-checkout --lock` → `read-tree` + `checkout-index --all` → 双重 `verifyIdentity` → `unlock`）→ `attachWorktreeBranch`（git.ts 405-425，update-ref CAS + symbolic-ref，把 Worktree 挂到会话分支 `feat/sess-…`）→ `enterCheckout`（workingDirectory.set，tools.ts 148）。

2. **编辑 → 评审**
   `worktree_ready_for_review`（tools.ts 318-403）→ `markReadyForReview` → 引擎 `inspectReview`（session-checkout-apply.ts 1421-1470：`captureSnapshot` 隔离侧 → `changedTreePaths(baseOid, treeOid)`）→ 记录 `delivery = ready_for_review`、`isolatedFingerprint/isolatedHeadOid` 入 review（ports.ts 361-374），`revision++`；同时 `checkpointGenerationForRecord`（checkpoint.ts 16-28）派生 CAS generation。

3. **预览 / 交付（两条互斥路径）**
   - *Local Preview 路径*：`ReviewActions.previewLocal`（ReviewActions.tsx 453-485）→ 控制面 `preview`（control-plane.ts 1176-1198）→ 引擎 `plan`+`preview`（1818-1958：patch → `git apply` 到 Local → receipt 持久化 → 写后树比对）。回滚走 `rollback`（1988-2091），确认提交走 `finalize`（2093-2367：任务剥离 C=H+(M−L)，index 保留 S′=C+(S−H)，index.lock 内原子换 ref+index）。
   - *会话分支路径*：`worktree_deliver`（tools.ts 405-506）→ `operate finish` → 引擎 `commitIsolated`（1521-1608）：**完全不读写 Local**，把评审快照同构的临时 index 树提交到 Worktree 当前检出的会话分支，随后按 retention 清理（`removeWorktree`（git.ts 349-359）→ `removeDirectoryTree`/`quarantineDirectoryTree`（files.ts））。autoPush 可选 `pushBranch`（git.ts 426-442）。

4. **放弃与恢复**
   `discard` 前先 `snapshotAbandonedWorktree`（git.ts 741-761，`add -A` + `write-tree` + 显式身份 `commit-tree` → `refs/dsh-worktree/abandoned/<checkoutId>`）；恢复 `restoreAbandonedSnapshot`（762-770）在 Local 建分支并释放 ref。

5. **控制台读路径（轮询）**
   `TargetStatusAction` → `subscribeCurrent`（current-polling.ts，5s 可见/60s 隐藏）→ `adapter.current` → RPC → `control-plane.current`（764-770）→ `callerTarget` + `observe`（优先 `observeFromCaller` 复用 443-461）→ `projectDetails`（projection.ts 192-270）→ 客户端渲染；评审面共享 `request-cache.ts` 单飞缓存与 `WORKTREE_REVIEW_REFRESH_EVENT` 失效广播（status-events.ts）。

6. **恢复请求队列（Client→Agent）**
   冲突/评审过期 → `enqueueWorktreeRecovery`（recovery-continuation.ts 389-427）→ localStorage 持久化 → `attempt` 在 owner 会话 open/idle 且 target 精确匹配时通过 `session.prompt(..., 'queue')` 发送重建 prompt（351 行）；Host 端每次发送前都重新 `inspect` 验证（324 行），浏览器状态不可信（388 行注释）。

## Connections

- `[[session-checkout-apply]]` — 应用引擎细节（快照/合并/事务性写）单独成文。
- `[[adapters-git]]` / `[[adapters-registry]]` — git 子进程端口与原子注册表实现。
- `[[console-contract]]` / `[[console-remote-schemas]]` — Client↔Host DTO 与 zod strict schema。
- `[[client-review-console]]` / `[[client-target-console]]` / `[[client-workspace-sidebar]]` — 三大 UI 面。
- `[[i18n-host-messages]]` — 约四百键的宿主文案目录与持久化消息白名单。
- `[[workspace-provider-lifecycle]]` — Loader 选举与官方 Workspace 共存/接管。
- `[[session-checkout-module]]` — 状态机组装层（`src/session-checkout-module.ts`，由 `src/index.ts` 234 行引入，不在本快照内）。

## Known Issues

1. **`applying` 相位已废弃**：`src/types.ts` 21 行标注 `@deprecated v1 registry/runtime compatibility; new mutations use mutating`；`registry.ts` 的 v1 迁移把非 ready/discarded 旧记录统一压到 `recovery_required`（365-368 行）。
2. **本地错误信息原样透出**：`console-host/errors.ts` 30-33 行 ponytail 注释明确——`consoleFailure` 对非域错误把 `error.message` 原样放入 `git_error`，仅适用于本地控制台 UI；未来任何远程传输序列化前必须截断/替换（tests/host-i18n.test.ts 维持可观察性）。
3. **`worktree remove` 超时不可配**：`adapters/git-options.ts` 25 行硬编码 `return 5 * 60_000`，绕过 `gitTimeoutMs` 配置（仅 Windows 硬上限语义，见 git.ts 10-11 行注释）。
4. **`hasGitMetadata` 保守偏 true**：`adapters/git.ts` 239-240 行——任何非 ENOENT 的 lstat 错误（如权限拒绝）都返回 true，即"视为 git 仓库"；这是安全方向的误报。
5. **模块级单例文件端口**：`adapters/worktree-creation.ts` 11 行 `const files = createNodeFilesPort()` 在模块加载时创建，无法按调用注入（测试需 mock node:fs 层）。
6. **无跨进程文件锁**：`adapters/safe-file.ts` 79-80 行注释——唯一 tmp + 原子 rename 消除了"tmp 互踩"与"半写提升"，但文件级 last-writer-wins 仍在；需要强一致时要再引入 lock 文件。
7. **Web RPC 载体无超时**：`client/console-remote/adapter.ts` 50-55 行注释——服务端处理卡住会永久 pend，客户端以 30s/180s `Promise.race` 自行失败；服务端工作继续跑，mutating 调用可安全重试。
8. **i18n 键名携带历史计数后缀**：`host-messages.ts` 存在大量近似重复键（如 `onlyTheOwnerIsolatedSessionCanSaveACheckpoint` 与 `…Checkpoint447`，649-670 vs 1475-1478 行），取错键只会得到语义相同但来源不同的文案；新增消息时必须搜索确认。
9. **plans Map 的容量保证依赖清理逻辑**：`session-checkout-apply.ts` 1711-1716 行以"同一 isolatedPath 的新计划顶替旧计划"保证不无限增长；任何新增持久计划路径都必须复制该清理。
10. **`session-checkout-module.ts` 不在本快照**：`src/index.ts` 233-234 行 import 的 `createSessionCheckoutModule` 是端口与引擎的最终组装点，修改模块接口（`SessionCheckoutModule`，index.ts 113-219）时需对照该文件。
11. **DSH 0.2.x 侧栏无 trailing 席位**：`client/workspace-sidebar/index.tsx` 419-423 行注释——注入 `sidebar.session.row.trailing` 会永久等待一个不存在的声明，徽标必须走 `leading`/`hover` 两席（`ROW_SEATS`，424 行）。
12. **Windows rename 竞态需有限重试**：`adapters/safe-file.ts` 14-18 行与 `adapters/files.ts` 83-84 行分别以 `RETRYABLE_RENAME_CODES` 与 `maxRetries: 6` 处理 EBUSY/EPERM/EACCES/ENOTEMPTY；新增删除/改名路径若遗漏该处理会在杀软/索引服务下偶发失败。
