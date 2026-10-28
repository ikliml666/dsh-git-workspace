---
title: src
type: module
source_files:
  - src/index.ts
  - src/types.ts
  - src/ports.ts
  - src/session-checkout-apply.ts
  - src/checkpoint.ts
  - src/concurrent-session-guard.ts
  - src/console-contract.ts
  - src/creation-failure.ts
  - src/commit-message.ts
  - src/delivery-excludes.ts
  - src/host-compat.ts
  - src/managed-worktree-path.ts
  - src/workspace-provider-lifecycle.ts
  - src/session-target-context.ts
  - src/tools.ts
  - src/commands.ts
  - src/adapters/files.ts
  - src/adapters/git-options.ts
  - src/adapters/git.ts
  - src/adapters/initial-commit.ts
  - src/adapters/lookup.ts
  - src/adapters/registry.ts
  - src/adapters/safe-file.ts
  - src/adapters/working-directory.ts
  - src/adapters/worktree-creation.ts
  - src/adapters/project-skills.ts
  - src/adapters/project-skill-io.ts
  - src/adapters/project-skill-provider.ts
  - src/console-host/control-plane.ts
  - src/console-host/errors.ts
  - src/console-host/projection.ts
  - src/console-host/review-diff.ts
  - src/console-host/service.ts
  - src/console-remote/descriptors.ts
  - src/console-remote/remote.ts
  - src/console-remote/schemas.ts
  - src/client/index.tsx
  - src/client/model.ts
  - src/client/actions.ts
  - src/client/i18n.tsx
  - src/client/harness-platform.d.ts
  - src/client/WorktreeCreateRow.tsx
  - src/client/WorktreeReviewRow.tsx
  - src/client/console-remote/adapter.ts
  - src/client/console-remote/index.ts
  - src/client/pre-session/index.tsx
  - src/client/pre-session/controller.ts
  - src/client/pre-session/harness-input.ts
  - src/client/pre-session/PreSessionWorktreeToggle.tsx
  - src/client/review-console/index.ts
  - src/client/review-console/WorktreeReviewPanel.tsx
  - src/client/review-console/ReviewActions.tsx
  - src/client/review-console/ReviewDetailsModal.tsx
  - src/client/review-console/PreflightStatus.tsx
  - src/client/review-console/DeliveryProof.tsx
  - src/client/review-console/ReviewIcon.tsx
  - src/client/review-console/request-cache.ts
  - src/client/review-console/preflight-cache.ts
  - src/client/review-console/preview-recovery-cache.ts
  - src/client/review-console/recovery-continuation.ts
  - src/client/review-console/status-events.ts
  - src/client/settings-card/index.ts
  - src/client/settings-card/worktree-settings-card.ts
  - src/client/settings-card/form-model.ts
  - src/client/settings-card/WorktreeSettingsCard.tsx
  - src/client/target-console/index.ts
  - src/client/target-console/TargetStatusAction.tsx
  - src/client/target-console/WorktreeConsoleView.tsx
  - src/client/target-console/WorktreeManagerModal.tsx
  - src/client/target-console/BranchGraphModal.tsx
  - src/client/target-console/TagManagerModal.tsx
  - src/client/target-console/WorktreeHeroChip.tsx
  - src/client/target-console/WorktreeReviewStatus.tsx
  - src/client/target-console/branch-overview-cache.ts
  - src/client/target-console/current-polling.ts
  - src/client/workspace-sidebar/index.tsx
  - src/client/workspace-sidebar/model.ts
  - src/i18n/core.ts
  - src/i18n/host.ts
  - src/i18n/host-messages.ts
tags: [git-worktree, dsh-plugin, session-checkout, worktree, react-client, typert-rpc, i18n, git]
---

## Overview

`src` 是 `dsh-git-worktree` 插件的完整源码。该插件挂载在 DSH 宿主上，为 Agent 会话提供「托管 Git Worktree」：把会话的工作切进一个隔离检出，任务完成后经「Ready for Review →（可选 Local Preview）→ 交付」的显式验收链路落地。整个模块分六层：

1. **领域核心**：`session-checkout-apply.ts`（apply 引擎）、`ports.ts`（宿主无关端口）、`types.ts`（类型面）、`checkpoint.ts`、`concurrent-session-guard.ts`。状态机本体 `session-checkout-module.ts`（由 `src/index.ts:234` 导入 `createSessionCheckoutModule`）不在本文源码清单内，但它是所有调用的汇聚点。
2. **DSH 适配器**：`adapters/` 下的 git、文件系统、注册表、lookup、workingDirectory、Project Skills 等端口实现。
3. **模型/人工界面**：`tools.ts`（模型工具）、`commands.ts`（`/worktree` 命令）、`session-target-context.ts`（运行上下文注入）。
4. **Console 合同层**：`console-contract.ts`（JSON-only DTO 契约）+ `console-remote/`（Typert strict schema/descriptor）+ `console-host/`（RPC 服务与控制面）。
5. **Web Client**：`client/` 下的 React 组件（会话胶囊、评审坞、侧栏投影、空白会话预创建、设置卡）。
6. **基础设施**：`i18n/`（宿主/Client 双语消息）、`safe-file.ts`（崩溃安全 JSON）、`host-compat.ts`（Workspace 客户端世代探测）、`workspace-provider-lifecycle.ts`（uiWorkspace 接管选举）。

关键设计不变量：**每次 Host 操作都在执行时重新解析调用方 Session 并校验 project/owner/cwd/revision/review 身份**（见 `src/console-contract.ts:7`）；**所有删除都以目录身份（device/inode/birthtimeNs）CAS 为前提**（`src/ports.ts:232-236`）；**交付默认不写 Local**——任务提交落在会话自己的分支上，由 `worktree_merge` 显式合并（`src/console-host/../i18n/host-messages.ts:1323-1326`）。

## Key Components

### 插件入口 src/index.ts

- `SessionCheckoutError`（41-53）：领域失败类型，字段 `name='SessionCheckoutError'`、`code: SessionCheckoutErrorCode`。
- `SessionCheckoutReconcileSummary`（55-61）：`recoveryRequiredCheckoutIds` / `orphanedCheckoutIds` / `dirtyOrphanedCheckoutIds` / `staleRootCheckoutIds` / `retainedCheckoutCount`。
- `ManageManagedWorktreeInput`（63-71）：`checkoutId`、`expectedRevision`、`action: 'cleanup_retained'|'retry_cleanup'|'set_retention'|'set_permanent'|'clear_sidebar_badge'|'discard'`、可选 `retention` / `permanent` / `confirmDirty` / `rollbackPreview`。
- `ListManagedWorktreesInput`（73-78）、`PruneMergedBranchesInput`（80-85：`dryRun`、`olderThanDays`）、`MergeBranchForSessionInput`（87-94：`sourceBranch`/`dryRun`/`direction`）、`MarkReadyForReviewInput`（96-103：`summary`/`detailsMarkdown`/`validationStatus`/`validationSummary`/`tests`/`suggestedCommitMessage`）、`IsolatedTargetLaunch`（106-110：`targetSessionId`/`managedRoot`/`target`）。
- `SessionCheckoutModule` 接口（113-219）：核心模块契约，含 `inspect`、`runtimeContext(sessionId, cwd?)`（同步、供 system prompt）、`refreshBranchRaceGuards?`、`preflight?`、`preflightPreviewRecovery?`、`runExclusiveSessionMutation`、`bind`、`createIsolatedTarget(sourceSessionId, targetSessionId, createOptions?)`、`beginNextIteration`、`resumeRevision`、`prepareReviewRegeneration`、`preparePreviewRecoveryAnalysis`、`createPreviewRecoveryHandoff`、`markReadyForReview`、`operate`、`isAutoDeliverEnabled`、`listManagedWorktreesForSession`、`pruneMergedBranchesForSession`、`autoPruneStaleMergedBranches`、`mergeBranchForSession`、`listAbandonedWorktreeSnapshots` / `restoreAbandonedWorktreeSnapshot`、`manageManagedWorktreeForSession`、`observeManagedCheckout?` / `observeManagedCheckouts?`、`cleanupExpiredRetained`、`enforceWorktreeKeepCount`、`reconcile`、`resolveManagedRoot`、`resolveRoots`。
- `inject`（253）：`{ tools:{}, commands:{}, subprocess:{}, loader:{ await:false } }`——loader 以命名导出读取注入元数据。
- `volatile<T>()`（256-259）：给 schema 打 `meta.volatile` 标记，使设置页热更新（不经 remount、值以 `LiveValue` 引用到达）。
- `Config`（261-319）字段：`stateDir`(268)、`gitTimeoutMs`(271，默认 120_000)、`worktreeAddTimeoutMs`(272，默认 300_000)、`autoDeliver`(279，默认 true)、`autoPush`(284，默认 true)、`worktreesRoot`(291)、`inheritLocalChanges`(297，默认 true)、`worktreeKeepCount`(302，默认 15)、`branchRaceGuard`(309，默认 true)、`branchRaceWindowMs`(311，默认 30 分钟)、`enableWorkspaceProvider`(318，**默认 false**——官方 Workspace 接管是 opt-in)。
- `resolveWorktreesRootValue`（332-335）、`resolveStateDir`（337-341：`$DSH_HOME/plugins/dsh-git-worktree`，缺省 `~/.dsh`）。
- `apply()`（358-459）：装配主流程。行号要点：`mountWorkspaceProviderLifecycle`(363)、stateDir/hooksPath 建 `disabled-git-hooks` 空目录(364-367)、`worktreesRoot` 包成 live getter(370-373)、`createDshLookupPort`(375)、`new ProjectSkillStore(join(stateDir,'project-skills'))`(376)、`createDshGitPort`(377)、`createNodeFilesPort`(378)、`new AtomicJsonCheckoutRegistry(join(stateDir,'managed-checkouts.json'))`(379)、`mountProjectSkillProvider`(380)、`createSessionCheckoutModule`(381-396)、`new WorktreeConsoleService(...)`(398-405，诊断文件 `sidebar-diag.ndjson`)、`registerTools`(407)、`registerWorktreeCommand`(408)、`registerSessionTargetContext`(409)、`ctx.events.on('ready')` 触发 `reconcile()` + `enforceWorktreeKeepCount()`(414-428)、保留期定时器 15 分钟(429-436，`RETENTION_MAINTENANCE_INTERVAL_MS` 定义在 343)、自动 prune 已合并分支每日一次、首次延迟 60 秒、阈 7 天(344-347, 437-452)、`ctx.effect` 清理(453-458)。

### 类型面 src/types.ts

- `SessionTargetRef`（11-14）：`{kind:'unselected'} | {kind:'local'} | {kind:'isolated', checkoutId}`。
- `SessionCheckoutPhase`（18-27）：`preparing|ready|applying(已废弃,见 22 行 @deprecated)|mutating|recovery_required|finalized|retained|discarded`。
- `WorktreeValidationStatus`（29）、`WorktreeRetentionMode`（32：`cleanup|retain_24h|retain_3d|retain_manual`）、`DEFAULT_WORKTREE_RETENTION='retain_24h'`（39）。
- `WorktreeCleanupReason`（41-47）：`directory_busy|modified_after_finalize|identity_changed|detached_residue|quarantine_busy`。
- `WorktreeValidationItem`（48-53）：`command`/`status`/`summary?`。
- `WorktreeCheckpointView`（55-63）：`checkpointId`/`sequence`/`reviewId`/`createdAt`/`summary`/`validationStatus`/`changedFiles`。
- `WorktreeReviewView`（65-77）：`reviewId`/`iteration`/`preparedAt`/`detailsMarkdown?`/`summary`/`validationStatus`/`validationSummary?`/`tests`/`changedFiles`/`suggestedCommitMessage`。
- `WorktreeDeliveryProofView`（79-90）：`localBranch|null`/`localHeadBefore`/`localHeadAfter`/`changedFiles`/`validationStatus?`/`validationSummary?`/`commitInLocalHistory: boolean|null`。
- `WorktreeDeliveryView`（92-127）：`working`/`ready_for_review`/`preview_active`/`preview_detached`（含 `detachedAt`、`reason`、`attemptedAction`）/`finalized`（`commitOid`、`proof?`、`cleanup:'pending'|'blocked'`、`cleanupMessage?`、`cleanupReason?`）/`retained`（`retention`/`retainedAt`/`expiresAt`/`cleanup:'scheduled'|'blocked'`）/`delivered`（`iteration`/`commitOid`/`proof?`/`deliveredAt`）。
- `WorktreeApplyPreflightView`（159-172）：`ready|local_advanced|already_in_local` / `conflict`（`conflictingFiles`+`conflictDetails?`）/ `blocked`（`reason`+`blocker?`），公共事实 `WorktreeApplyPreflightFacts`（139-150：`checkoutId`/`reviewId`/`revision`/`configuredBaseOid`/`effectiveBaseOid`/`baseStrategy`/`localBranch`/`localHeadOid`/`isolatedHeadOid`/`changedFiles`）。
- `SessionTargetView`（198-216）：`project`/`checkout{id,kind,label,phase}`/`source{ref,oid}`/`current{branch|null,oid}`/`ownership:'owner'|'inherited'`/`dirty`/`revision`/`delivery?`/`checkpoints?`/`checkpointGeneration?`/`reviewSlot?`/`reviewSlotOwnerSessionId?`。
- `WorktreePreviewRecoveryProof`（273-291）：完整恢复凭证（`generation`、`receiptFingerprint`、Local 五元树 OID、`rollback`/`finalize` 动作、`blocker?`）。
- 操作类型（222-353）：`SessionCheckoutApplyOperation`、`FinishOperation`（含 `expectedReviewId?`）、`PreviewOperation`、`CheckpointOperation`（含 `expectedGeneration`/`requestId`）、`RollbackPreviewOperation`（`resumeRevision?`/`recoveryProof?`）、`FinalizePreviewOperation`、`RetryCleanupOperation`、`DiscardOperation`（`confirmDirty`）、`RecoverOperation`。
- 结果类型（355-595）：`SessionCheckoutFinishedResult`（394-411，含 `branch?`——会话分支、`cleanup:'discarded'|'pending'|'retained'`、`push?: WorktreePushOutcome`）、`SessionCheckoutConflictResult`（550-566，含 `reason: ApplyConflictReason` 与 `resolveHint?`）等。
- `SESSION_CHECKOUT_ERROR_CODES`（597-627）与 `SessionCheckoutErrorCode`（629）。
- `CONFLICT_DETAIL_FILE_LIMIT=6` / `CONFLICT_DETAIL_DIFF_LIMIT=4096`（517-518）。
- `PruneMergedBranchesView`（489-494）、`AbandonedWorktreeSnapshotView`（497-503：`checkoutId`/`projectName`/`snapshotOid`/`snapshotAt`/`revision`）、`ManagedWorktreeSummaryView`（453-480，含 `approximateBytes`/`updatedAt`/`canCleanup`/`cleanup?`/`activeSessionIds?`）。

### 端口 src/ports.ts

- `SessionCheckoutLookupPort`（40-60）：`getSidebarMemberships?`、`getSession`、`getProject`、`getSessionCwd?`（owner 会话的实时 cwd 即其 immutable worktree 根）、`listLiveSessions?`。
- `GitCheckoutSnapshot`（62-69）：`root`/`commonDir`/`gitDir`/`branch|null`/`headOid`/`headRef`。
- `SessionCheckoutGitPort`（109-230）：40 个方法，全部/可选实现见行号——`preflightInitialCommit?`(111)、`initializeEmptyRepository?`(112)、`initializeProject?`(114)、`listLocalBranches?`(116)、`resolveLocalBranchTip?`(118)、`inspect`(119)、`findContainingWorktreeRoot`(121)、`status`(122)、`createDetachedWorktree`(123)、`attachWorktreeBranch?`(131，CAS 语义 `expectedOldOid=null` 只在分支不存在时创建)、`removeWorktree`(133)、`retainApplyBase`(134)/`releaseApplyBase`(135)/`retainInternalArtifact`(136)/`readInternalArtifact`(138)/`releaseInternalArtifacts`(139)、`isAncestor`(141)、`listWorktreeincludeFiles?`(142)、`pushBranch?`(148，绝不 force)、`repairWorktreeLinks?`(154)、`pruneWorktrees?`(159)、`branchOverview?`(165)、`defaultBranch?`(170)、`branchTipTimes?`(175)、`branchCreationTimes?`(181)、`deleteLocalBranch?`(183)、`mergeLocalBranch?`(189)、`graphLog?`(191)、`createLocalBranch?`(193)、`switchLocalBranch?`(195)、`listTags?`(201)、`createTag?`(203)、`deleteLocalTag?`(205)、`pushTag?`(210)、`deleteRemoteTag?`(212)、`captureLocalWip?`(217)、`applyWorktreePatch?`(219)、`listUntrackedFiles?`(221)、`snapshotAbandonedWorktree?`(227)、`restoreAbandonedSnapshot?`(229)。
- `DirectoryIdentity`（232-236）：`device`/`inode`/`birthtimeNs`（字符串）。
- `SessionCheckoutFilesPort`（238-255）：`exists`/`canonicalize`/`inspectDirectoryIdentity`/`ensureDirectory`/`removeEmptyDirectoryTree`/`quarantineDirectoryTree`/`removeDirectoryTree`/`measureDirectoryBytes`/`readTextFile?`/`copyFile?`/`isSymbolicLink?`。
- `SessionBindingRecord`（257-267）：`sessionId`/`projectId`/`projectName`/`target: SessionTargetRef`/`ownerSessionId`/`inheritedFromSessionId?`/`sourceRef`/`sourceOid`/`revision`。
- `WorktreeCreationEvidence`（274-286）：`root`/`rootIdentity`/`parentIdentity`/`commonDir`/`commonIdentity`/`lockReason`/`gitDir?`/`gitIdentity?`/`metadataFingerprint?`/`indexFingerprint?`/`quarantinePath?`。
- Journal（288-331）：`ManagedCheckoutCreateJournal`（`operation:'create'`、`step:'creating_worktree'`、`creation?`）与 `ManagedCheckoutMutationJournal`（`operation: 'apply'|'preview'|'checkpoint'|'rollback_preview'|'finish'|'finalize_preview'|'cleanup'`，`step` 七种，含 `baseOid?`/`planRevision?`/`previewId?`/`reviewId?`/`localFingerprint?`/`isolatedFingerprint?`/`effectiveBaseOid?`/`baseStrategy?`/`localHeadOid?`/`isolatedHeadOid?`/`commitOid?`/`checkpoint*`/`parentOid?`/`retention?`/`recoveryGeneration?`/`resumeRevision?`/`changedFiles?`）。
- `ManagedWorktreeCheckpointRecord`（333-350）：`checkpointId`/`sequence`/`reviewId`/`requestId?`/`requestedRevision?`/`generation?`/`iteration`/`createdAt`/`commitOid`/`parentOid`/`summary`/`commitMessage`/`validationStatus`/`changedFiles`。
- `ManagedWorktreeReviewRecord`（361-374）：含 `isolatedFingerprint`/`isolatedHeadOid`；`ManagedPreviewReceipt`（376-395）：含 `localWorkingTreeOid`/`localIndexTreeOid`/`previewWorkingTreeOid`/`isolatedSnapshotOid`；`ManagedDeliveryProof`（397-405）。
- 恢复续体（407-447）：`ManagedApplyConflictRecoveryContinuation`（`readyRevision`/`workingRevision`）、`ManagedReviewRegenerationContinuation`、`ManagedPreviewRecoveryAnalysisContinuation`、`ManagedPreviewRecoveryHandoffContinuation`（`sourceCheckoutId`/`sourceRevision`）。
- `ManagedCheckoutDelivery`（449-485）与 `ManagedCheckoutRecord`（487-540）：`checkoutId`/`predecessorCheckoutId?`/`projectId`/`projectName`/`ownerSessionId`/`sourceSessionId?`/`localRoot`/`managedRoot`/`managedGitRoot`/`gitCommonDir`/`gitDir`/`baseOid`/`applyBaseOid?`/`previousReview?`/`checkpoints?`/`recoveryContinuation?`/`abandonedSnapshotOid?`/`abandonedSnapshotAt?`/`permanent?`/`sidebarBadgeClearedRevision?`/`sourceRef`/`sessionBranch?`/`sessionTopic?`/`phase`/`delivery`/`journal`/`revision`。
- `ManagedCheckoutsRegistry`（542-547）：`version:2`/`revision`/`sessionBindings`/`managedCheckouts`；`SessionCheckoutRegistryPort`（549-552）。
- `LiveValue<T>`（555-557）与 `liveConfigValue`（560-565）：volatile 配置的实时读取。
- `SessionCheckoutDependencies`（567-608）：模块装配依赖（`lookup`/`git`/`files`/`registry`/`applyEngine`/`managedCheckoutsRoot`/`createCheckoutId`/`autoPush?`/`autoDeliver?`/`worktreesRoot?`/`inheritLocalChanges?`/`worktreeKeepCount?`/`branchRaceGuard?`/`branchRaceWindowMs?`）。

### Apply 引擎 src/session-checkout-apply.ts

- 计划类型（14-67）：`ApplyPlan`（`revision`(UUID)、`localFingerprint`、`isolatedFingerprint`、`effectiveBaseOid`、`baseStrategy`、`localHeadOid`、`localHeadRef|null`、`isolatedHeadOid`、`changedFiles`）；`ApplyConflictPlanResult`（47-60）含逐文件 `conflictDetails`。
- `SessionCheckoutApplyEngine` 接口（279-317）：`inspectReview`、`checkpoint`、`recoverCheckpoint`、`preflight`（复用计算不落 plan）、`plan`、`apply`、`finish`（旧「写回 Local」路径）、`commitIsolated?`（**新交付路径：把 Worktree 工作区提交到它检出的会话分支，完全不读不写 Local**，注释见 1514-1520）、`reviewIsolated?`、`preview`、`assessPreviewRecovery`、`rollback`、`finalize`。
- `SessionCheckoutApplyEngineOptions`（319-329）：`projectSkills?` 与 4 个测试 seam（`beforeFinalLocalValidation`/`afterLocalWriteBeforeVerification`/`beforeFinalIsolatedValidation`/`afterIsolatedWriteBeforeVerification`）。
- 基础设施：`runGit`（418-480，spawn git，剥除环境变量 `GIT_DIR` 等——`AMBIENT_GIT_ENV_PATTERN` 在 394，`scrubbedAmbientGitEnv` 在 396-402；`disabledGitHooksPath` 在 408-411；默认 30s 超时 `GIT_TIMEOUT_MS` 415）；`captureSnapshot`（606-659：headOid/headRef/indexEntries/staged 补丁重建 + `add -A` 带 `deliveryExcludePathspecs()` 排除宿主运行期产物 + Project Skills 指纹混入，655-656）；`createSnapshotCommit`（661-681，身份 `Domi Apply`）；`collectConflictDetails`（684-704）；`computeMerge`（706-802，三方合并产出 patch+mergedTreeOid+中央 index）；`computeTreeMerge`（804-893，纯 tree 级合并用于「剥离任务增量 C = H + (M − L)」）；`treePatch`（895-919）；`selectEffectiveApplyBase`（551-572，ancestry 前移策略）；`writeIndexLock`（1147-1166，`wx` 排他 + fsync）；`isIndexLockContention`（1168-1173）。
- `DefaultSessionCheckoutApplyEngine`（1175-2672）方法与行号：
  - `checkpoint`（1190-1331）：CAS 校验→建提交→`beforeCommit` 持久化→制造 `index.lock` 与 marker→`advanceHead`（1242-1250，分支附着时 `update-ref <headRef>` 而非 `--no-deref`）→rename index→写后复验（1284-1298）。失败回滚分支 1258-1282，`preserveRecoveryEvidence`（1199）保留恢复证据。
  - `recoverCheckpoint`（1333-1419）：根据 `index.lock` marker 归属（`checkpointLockMarkerOwned` 1130-1136）判定 aborted / recovered。
  - `inspectReview`（1421-1470）与 `reviewIsolated`（1476-1512，完全不读 Local）。
  - `commitIsolated`（1521-1608）：守门「HEAD 必须在指定会话分支」（1543-1552）、用临时 index 构造提交树以排除宿主产物与 Skills（1554-1564）、`update-ref HEAD` + `reset --quiet`（1570-1572）、空树不建提交（1565 `created = pending.treeOid !== headTreeOid`）、git 身份未配置时转译为 `initialIdentityMissing`（1601-1603）。
  - `calculatePlan`（1618-1735，`preflight` 1610 / `plan` 1614 复用）：plans map 每个 isolated path 只保留最新一个 plan（ponytail 注释 1710-1716）。
  - `apply`（1737-1816）：三重快照校验→持久 `nextBaseOid` 快照 commit→最后 Local CAS→`git apply`。
  - `preview`（1818-1958）：`beforeWrite` 回调先持久化 receipt 再写 Local，写后 `previewedLocal.treeOid !== previewWorkingTreeOid` 校验（1940）。
  - `assessPreviewRecovery`（1960-1986）→ `prepareRollbackAssessment`（969-1042）与 `prepareFinalizeAssessment`（1044-1105）。
  - `rollback`（1988-2091）与 `finalize`（2093-2367）：finalize 用 Git 原生 `index.lock` 协议（2213），备份 index（2207），三段补偿回滚（2282-2315），无法证明恢复时保留备份并报 `uncertain`（2350-2358）。
  - `finish`（2369-2655）：旧路径，同样持 `index.lock`（2568-2577），失败补偿回滚 ref+worktree（2608-2640）。
- `createSessionCheckoutApplyEngine`（2674-2678）。

### 领域辅助

- src/checkpoint.ts：`canonicalJson`（4-13，键排序、剔除 undefined）；`checkpointGenerationForRecord`（16-29）——仅 `ready_for_review`/`preview_active` 状态生成，SHA-256 over `{checkoutId, revision, reviewId, isolatedHeadOid, isolatedFingerprint, checkpointCount, previewId, phase}`。
- src/concurrent-session-guard.ts：`GuardSessionInfo`（16-21）、`BranchRaceFacts`（23-29）、`BranchRaceInput`（31-51）；`normalizePath`（53-57）、`cwdWithinLocalRoot`（60-65，cwd 缺失视为共享——62 行注释）、`detectLocalBranchRace`（68-89）：早期会话 + 检测窗口内新分支（排除 `managedBranches`）同时存在才判 `race_detected`（85-88）。
- src/commit-message.ts：`isValidCommitMessage`（2-4）——非空、无 `\0`（500 字符非 Git 限制，经 stdin 传入）。
- src/creation-failure.ts：`WorktreeCreationFailure`（2-6），字段 `rolledBack: boolean`——`false` 时「空目录」绝不可推断为安全。
- src/delivery-excludes.ts：`HOST_RUNTIME_ARTIFACTS`（12-16：`.dsh-ops`、`desktop-runtime.json`、`.dsh-runtime.json`）；`deliveryExcludePathspecs`（22-30）生成 4 类 `:(exclude)` pathspec（整棵、`**` 变体）。
- src/host-compat.ts：`WorkspaceClientFlavor`（5）；`workspaceClientFlavorForAgentVersion`（7-25，固定映射 `0.1.2-rc.1→legacy`、`0.1.6-alpha.2→alpha`、`0.1.7-rc.2→next`、`0.2.0-rc.2→modern`，任意 0.2.x→modern、0.3+→unsupported）；`agentVersionFromAnchor`（32-42）；`workspaceFlavorDiagnostics`（65-77，anchors 依次为 `process.argv[1]`、`process.cwd()`、`import.meta.url`）；`hostWorkspaceClientFlavor`（79-81）。
- src/managed-worktree-path.ts：`sanitizeManagedWorktreeLabel`（15-29，Windows 保留名、40 码点截断）；`createManagedWorktreeRepositoryKey`（38-40，canonical root 的 sha256 前 12 位）；`sanitizeBranchSegment`（46-55）；`createSessionBranchCandidates`（63-75，`feat/sess-<session>[--<topic>]` 重名 `-2`/`-3`… 递增）；`createManagedWorktreeDirectoryName`（78-86，`<repo>--<identity>--worktree`）；`createTopicManagedWorktreeDirectoryName`（101-112，`<topic>-<YYYYMMDD>`）；`createTopicDateStamp`（115-120）；`createManagedWorktreePathCandidates`（132-175：有 `worktreesRoot` 时全部容器落到 `<worktreesRoot>/<projectLabel|repositoryKey>`；否则 sibling `<repo>--worktrees` 与 fallback state 目录）。

### 适配器 src/adapters/

- **git-options.ts**：`GitTimeoutOptions`（3-6，值可为 `number | LiveValue`）；`DEFAULT_GIT_TIMEOUT_MS=120_000`(8)、`DEFAULT_WORKTREE_ADD_TIMEOUT_MS=5*60_000`(9)、`MAX_GIT_TIMEOUT_MS=60*60_000`(10)；`validateGitTimeouts`（12-19，1s~1h 整数）；`gitTimeoutMs`（21-27）——`worktree add` 用专用超时，`worktree remove` 固定 5 分钟，volatile 值每次调用实时读（注释 22-23）。
- **git.ts**：常量 `GIT_TERMINATION_GRACE_MS=1_000`(38)、`GIT_COLLECT_BYTES=1<<20`(40)、`WIP_PATCH_COLLECT_BYTES=16<<20`(42)；`parseDecoration`（63-71，`%D`→ref 名，`tag:` 前缀保留）；`settleCreationTree`（73-86，10s 内等待整树静默）；`runGit`（93-188）——argv 原样传递不经 shell(103-111)、Windows `-c core.longpaths=true`(107)、`core.hooksPath=<空目录>`(110)、剥除环境 Git 路由变量(124-126)、`GIT_TERMINAL_PROMPT=0`/`LC_ALL=C`(128-130)、双流收集上限+`lossy` 即失败(174-176)、创建路径的 quiescent 判定(157-167)、`GitCommitProtocol` 协议输入（137-153，`prepare: ok` 轮询→`beforeCommit()`→`commit\n`/`abort\n`）；`runGitChecked`（190-199）；ref 命名空间 `checkoutRefRoot`（201-204，`refs/dsh-worktree/session-checkouts/<sha256[0..24]>`）、`assertArtifactName`（206-214）、`internalArtifactRef`（216-219）、`applyBaseRef`（221-223）、`abandonedSnapshotRef`（230-233，**故意在 checkoutRefRoot 之外**，注释 226-229）；`hasGitMetadata`（235-246）；`createDshGitPort`（249-772）：`validateGitTimeouts`(250)、port 对象（255-771）按上节 `SessionCheckoutGitPort` 实现，其中 `inspect`（256-322）单次 `rev-parse` 五事实 + 并行 `symbolic-ref`（259-263）， unborn/broken HEAD 回退路径（298-310）；`attachWorktreeBranch`（405-425，`update-ref` CAS + `symbolic-ref HEAD`，注释 407-409）；`releaseInternalArtifacts`（378-388）单次 spawn `update-ref --stdin` 事务删除（385-386）；`mergeLocalBranch`（649-719，dryRun 用 `mkdtemp` 临时 detached worktree 试合并，704-707 强制回收；正式合并冲突不 abort——注释 710）；`snapshotAbandonedWorktree`（741-761，`add -A`→`write-tree`→`commit-tree` 显式身份）；`captureLocalWip`（720-728）/`applyWorktreePatch`（729-735）；`listWorktreeincludeFiles`（449-468，两个 `ls-files --others --ignored` 的交集 + 自动带入 `AGENTS.override.md`(466)）。
- **initial-commit.ts**：`GitCommitProtocol`（8）；`initialCommitActions`（13-118）返回 `{preflightInitialCommit, initializeEmptyRepository, initializeProject}`；`initializeEmptyRepository`（48-100）流程：preflight→排他 `index.lock`（`open(path,'wx')` 55-58）→二次 preflight(59-60)→`assertAuthorized`→身份检查（62-65，`user.useConfigOnly=true`）→`mktree` 空 tree(67)→`commit-tree`(68)→三次 preflight→`update-ref --stdin` 事务 CAS 未出生 HEAD（74-84，`beforeCommit` 里在锁下再验）；`EEXIST`→`initialRepositoryBusy`(87-89)；锁清理 best-effort（92-99，ponytail 注释 92）。`initializeProject`（104-117）：仅限非 Git / unborn；`git init -b main`(110-111)→`add -A`→`commit`。
- **registry.ts**：约 30 个类型守卫（`isOid` 34、`isBoundedText` 38、`isSafeRelativePath` 42、`isTargetRef` 48、`isSessionBinding` 55、`isReview` 67、`isCheckpoint` 97、`isPreviewReceipt` 116、`isDeliveryProof` 138、`isDelivery` 152、`isJournal` 193、`isRecoveryContinuation` 266、`isManagedCheckout` 292、`isRegistry` 327）；`migrateLegacyRegistry`（339-394，v1→v2，非 ready/discarded 的 phase 一律迁 `recovery_required`，366-368）；`AtomicJsonCheckoutRegistry`（397-415）：`read()`（400-410）校验失败响亮抛 `registry_corrupt`（409）、`write()`（412-415）经 `writeJsonFileAtomic`。
- **safe-file.ts**：`RETRYABLE_RENAME_CODES`（14-18，Windows 多含 EPERM/EACCES/ENOTEMPTY）；`sleepSync`（20-27）；`renameAtomicWithRetry`（30-44，指数退避 5 次）；`tmpPathFor`（50-52，`<file>.<pid>.<uuid>.tmp` 唯一命名，防并发互踩）；`listTmpFiles`（55-68，按 mtime 新→旧）；`writeJsonFileAtomic`（82-100，写 tmp→rename，先拷 `.bak`）；`writeTextFileAtomic`（103-107）；`readJsonFileSafe`（113-161）三级回退：主文件→最新可解析 .tmp 提升并 `cleanupTmpFiles`→`.bak` 恢复（151 行 `skipBackup=true` 避免坏主文件覆盖好备份）。
- **working-directory.ts**：`WorkingDirectoryServiceLike`（18-24）；`SessionWorkingDirectoryPort`（27-43）：`current(agent)`/`enter(agent,path)`（无服务或无 live Agent 返回 `undefined`，**调用方不得谎报已选中 cwd**——82-84 注释）/`leave(agent,path,fallback)`（87-99，仅在 cwd 处于 `path` 内时切回）；`createSessionWorkingDirectoryPort`（61-101，`ctx.get('workingDirectory')` 动态解析 fail-soft，65-67）；`isWithin`（104-112）。
- **worktree-creation.ts**：`createWorktree`（17-124）——evidence 链分四步 `saveEvidence`（42/48/64-65/100-102）：排他 `mkdir(target)`(38)→`worktree add --detach --no-checkout --lock --reason`(44)→读 `gitDir`/gitIdentity/metadataFingerprint(45-48)→`read-tree`+`checkout-index --all` 或 sparse `reset --hard`(54-67)→`worktree unlock`(69)。失败分支：未 claimed→可安全抛（72-73）；已注册且 quiescent→`verifyIdentity`+`verifyRollbackMetadata`+`verifyUnmodified` 三验通过才 `worktree move` 进隔离区并 `remove --force --force`（94-121）；否则保留现场（122）。`verifyIdentity`（126-148，`.git` 指针/gitdir 反链/commondir/HEAD/locked 全对账 + 拒绝任何 `.lock` 残留 147）；`verifyRollbackMetadata`（150-160）；`metadataFingerprint`（162-183，允许名单外的元数据即抛）；`verifyUnmodified`（185-250，index 全量=base、拒绝 submodule(193)、拒绝 filter/encoding(215-219)、逐文件 blob 哈希对账 221-241、`ls-files -v` 标志校验 243-244）。
- **lookup.ts**：`WorkspaceLike`/`WorkspaceRegistryLike`（19-32）；`createDshLookupPort`（65-164）：`getSidebarMemberships`（87-108，查 `sessionQuery.listSessions()` headers 而非 transcript——93-95 注释）、`listLiveSessions`（109-133，结构未知降级空表）、`getSession`（134-151，先 workspace membership 再 live-header cwd 恢复 144-149）、`getSessionCwd`（152-157）、`getProject`（158-163）。
- **project-skills.ts**：`PROJECT_SKILL_ROOTS`（7：`.dsh/skills`、`.agents/skills`、`.claude/skills`）；`MAX_FILES=5000`(8)、`MAX_BYTES=64MB`(9)；`safePath`（17-22）；`identity`（23-27）；`inspectPath`（29-39，逐段拒绝 symlink/junction）；`boundedRead`（40-58，读前后 mtime/ino/dev 复验）；`assertSkillTree`（60-70，10000 项/64 层上限）；`inventory`（74-98）；`ProjectSkillStore`（101-214）：`snapshot(source)`(104-107)、私有 `load(root)`(108-124，manifest 校验 + `realpath`/identity 复核)、`carry(snapshot,target)`(125-167：冲突预检 133-149→`wx` 0600 manifest `phase:'copying'`(151-155)→`createSkillDirectories`/`createSkillFiles`→读回复验 hash(158-161)→identity 复验(162)→`phase:'ready'` 临时文件+rename 164-166)、`scope`(168-171)/`paths`(172)、`state(root,tracked?)`(173-203，输出 `CarriedSkillState{paths,fingerprint,modified}`)、`assertRemovable`(204-212)、`forget`(213)。
- **project-skill-io.ts**：`SkillRead`(5)/`SkillBytes`(6)；`checkRoot`(10-15)/`checkPath`(16-36，白名单 `['.dsh','.agents','.claude']/skills` 前缀)；`readSkillFiles`（38-64，`O_NOFOLLOW` + open/stat/lstat 双重 ino/dev 对账 + 总量预算 64MB）；`createSkillDirectories`（66-73）；`createSkillFiles`（75-88，`O_CREAT|O_EXCL|O_NOFOLLOW` + chmod + fsync）。
- **project-skill-provider.ts**：`candidatePath`（14-19，DSH 0.1/0.2 locator 兼容）；`managedSkillRoot`（22-45，对 `registry.read().managedCheckouts` 里 `phase==='ready'` 的记录做 `.git` 指针 + gitDir 反链 + realpath 三重验证）；`ClaudeProjectSkillProvider`（48-119）：`name='worktree-project-claude'`(10)、串行化 `run`(53-57)、`provider(root)`（60-74，LRU 上限 32）、`list`(75-77)/`listNow`(78-94，`rank:250`,`source:'project-claude'`)、`get`(95-97)/`getNow`(98-108)、`observeHostMutation`(109-111)、`dispose`(112-118)；`mountProjectSkillProvider`（121-133，注入 `['skills']`，监听 `fs/observed`）。

### Console 合同与 Remote

- **console-contract.ts**：`WORKTREE_CONSOLE_TARGET_STATES`（26-38，11 态）；`worktreeReachedDelivery`（64-73）；`consoleStateFromDomain`（76-91，discarded 相位优先于 retained/finalized 交付标签——81-83 注释）；`WorktreeConsoleTargetSummary`（149-179，含 `checkoutId|null`、`sourceBranch`、`retention?`/`expiresAt?`、`permanent?`、`deliveryProof?`、`review?`、`checkpoints?`、`checkpointGeneration?`、`reviewSlot?`、`previewRecovery?`、`capabilities`）；`WorktreeConsoleTargetDetails`（182-195，加 `managedRoot`/`sourceRoot`/`sourceOid`/`currentBranch`/`recoveryContinuation?`）；`WorktreeConsoleCapabilities`（98-124，17 个布尔）；四种恢复凭证（628-686）；`WorktreeConsoleError`（688-693）与 `ERROR_META`（705-738，每码的 `category/recovery/retryable`）、`worktreeConsoleErrorMeta`（740-742）；`WorktreeConsoleAdapter`（745-784，约 37 个方法，`preflightCreate?`/`createWithInitialCommit?`/`initializeProject?`/`listAbandoned?`/`restoreAbandoned?` 为可选）。
- **console-remote/schemas.ts**：zod strict schema 全集——`sessionIdSchema`(31)/`checkoutIdSchema`(32)/`reviewIdSchema`(33)/`commitMessageSchema`(34)/`oidSchema`(37-41，40/64 位 hex 或 `unversioned`/`unborn`)/`previewIdSchema`(42)/`generationSchema`(43)/`requestIdSchema`(44)/`branchNameSchema`(45-50)/`retentionSchema`(54)；`capabilitiesSchema`（84-106，**`returnToLocal` 用 `.default(false)` 而非 optional**——注释 100-105 解释新能力位必须容忍旧 Host）；`outcomeSchema`（227-232）；`consoleErrorSchema`（216-225，仅 `apply_conflict` 可带 continuation——222-224）；`previewRecoveryProofSchema`（343-360）；`gitOverviewResponseSchema`（391-397）等全部响应 schema。
- **console-remote/descriptors.ts**：`strictCodec`（52-56，同时挂 legacy `schema` 与 0.2 的 `create()`）；`agentParameter`（58-64，`wire:'agentId'`）；`descriptor`（76-92，末尾恒附 `locale` 参数）；`WORKTREE_CONSOLE_DESCRIPTORS`（94-246，冻结数组，每方法一条）；`WORKTREE_CONSOLE_REMOTE`（248-251）。
- **console-remote/remote.ts**：`GitWorktreeRemote`（31，`TypertRemoteNamespace<'gitWorktree'>`）；`TypertRemoteMap` 声明（36-77，37 个方法签名）；`TypertRemoteNamespaceMap`（79-81）。

### Host 控制面 src/console-host/

- **service.ts**：`WorktreeConsoleService extends TypertRemoteService`（35-343）——构造参数 `hostContext`/`controlPlane`/`diagFile?`/`officialWorkspaceActive`(41)；`appendDiag`（47-52，ndjson best-effort）；`sidebarTopology`（55-67，注入 `workspaceClientFlavor` + `officialWorkspaceActive`）；`clientBootReport`（70-73）；`current`（76-89，**记录耗时与失败 code/message 到诊断**——77-88 注释）；其余 `@Remote` 方法（92-343）一一转发 control plane，`withHostLanguage(locale ?? languageFromSettings(...))` 包裹。
- **errors.ts**：`domainError`（5-11，Error + `code`/`continuation`）；`consoleFailure`（13-41，领域码透传；否则 `git_error` 包装——**30-34 注释明确第三方错误文本原样透出是 local-only 泄漏上限**）；`failure`（43-58）；`outcome`（60-66，try/catch 包裹器）。
- **projection.ts**：`review`（16-31）/`commitOid`（33-35）/`deliveryProof`（37-56，`commitInLocalHistory` 未知时置 null 54）/`iteration`（58-60）；`capabilities`（62-105，17 能力位矩阵：`owner`/`source`/`linkedRead`/`sourceReservation` 组合，`returnToLocal` 仅 owner+已交付 98-103）；`fallbackOid`（107-110）；`sourceBranchFromRef`（112-114）；`projectRecord`（116-190）；`projectDetails`（192-270，`currentBranch` = Git 实时分支 → 记录的 `sessionBranch` 兜底 → `settledLocalBranch` 优先，212-226 注释解释交付后胶囊必须显示 Local 分支）；`projectLocal`（272-310，`create` 仅当 `currentOid !== 'unversioned'`(288)）。
- **review-diff.ts**：`REVIEW_DIFF_MAX_FILES=200`/`REVIEW_DIFF_MAX_PATCH_BYTES=100KB`/`REVIEW_DIFF_MAX_PAYLOAD_BYTES=1MB`（9-11）；`ReviewDiffStaleError`（25-30）；`git()`（34-64，截断收集）；`parseNameStatus`（90-113，**R/C 语义折叠为 'renamed'**——97-99 ponytail）；`createGitWorktreeReviewDiffReader`（123-245）：临时 index + `GIT_OBJECT_DIRECTORY`/`GIT_ALTERNATE_OBJECT_DIRECTORIES` 隔离对象库（140-145）→`read-tree baseOid`+`add -A`→剥离 carried Skills（147-162）→`name-status` 与 `expected.changedFiles` 全序对账（174-177，不符抛 `ReviewDiffStaleError`）→8 路并行批取证（183-208）→payload 1MB 预算截断折叠（215-238）。
- **control-plane.ts**：`createWorktreeConsoleControlPlane`（206-1553）。内部核心：`recordOf`(121-125)、`sidebarTaskState`(127-138)、`readyReview`(140-145)/`previewReview`(147-155)、`applyConflictContinuation`(167-190，`requestId = apply-conflict:<checkoutId>:<reviewId>:<revision>:<localHeadOid>`)、`preflightFailure`(192-204)、`unboundLocalTarget`(209-228)/`callerTarget`(230-239，`target_unselected` 回退 Local 投影)、`verifyCallerRoot`(241-316，owner 的 live cwd 直通 + 已交付终态 Local 边界直通 + realpath memoize 269-276)、`authorize`(318-338)、`linkedReadAccess`(340-398，同源组 / 精确验收槽持有者)、`observe`(400-419)与 `observeFromCaller`(443-461，**复用 callerTarget 已付的三 spawn**——425-437 注释量化 warm Windows 下每次轮询省约 1/3)、`withinRoot`(464-472)、`settledLocalBranch`(489-513)、`acceptanceHolder`(519-532)、`projectReviewSlot`(534-551)、`details`(562-601)、`mutationResponse`(603-625)、`withCreation`(655-672，session+root 双键互斥)、`createTarget`(673-695)。公开方法（697-1552）：`sidebarTopology`(698-762，徽章清除即不再投影任务 720-729)、`current`(764-770)、`gitOverview`(772-785)/`gitGraph`(787-792)/`gitCreateBranch`(794-799)/`gitSwitchBranch`(801-816，**交付中拒切**——805-813)、`gitPruneMergedBranches`(818-820)、tag 五方法（822-867，`gitDeleteTag` 先远端后本地 842-856）、`listAbandoned`(869-871)/`restoreAbandoned`(873-877)、`list`(879-954，批量 `observeManagedCheckouts` 失败降级逐条无观察投影 906-934)、`preflightCreate`(956-972，空仓库发 5 分钟确认令牌 967-971)、`createWithInitialCommit`(973-988)/`create`(989)/`initProject`(990-994)、`inspect`(996)、`reviewDiff`(998-1036，前后双 preflight 对账)、`preflight`(1038-1047)、`previewRecoveryPreflight`(1049-1067)、`preparePreviewRecoveryAnalysis`(1069-1097)、`createPreviewRecoveryHandoff`(1099-1146)、`checkpoint`(1148-1174)、`preview`(1176-1198，冲突抛 `apply_conflict`+continuation 1186-1192)、`resumeRevision`(1200-1261，冲突恢复路径重验并核对持久化续体 1241-1248)、`prepareReviewRegeneration`(1263-1286)、`rollbackPreview`(1288-1306)、`discard`(1308-1335，source Session 仅当 owner 不可用时可行使 1310-1312)、`finalize`(1337-1379)/`finalizePreview`(1381-1424)、`setRetention`(1426-1435)/`setPermanent`(1437-1446)/`retryCleanup`(1448-1456)/`clearSidebarBadge`(1458-1470)、`beginNextIteration`(1472-1516)、`returnToLocal`(1528-1551，仅 delivered/finalized/retained，幂等——1539-1545)。

### 工具与命令

- **tools.ts**：`registerTools`（94-692）。`leaveCheckoutBeforeRemoval`（51-66，cwd 恢复失败必须中止删除）、`enterCheckout`（76-91，**优先读台账 `resolveRoots`**——70-74 注释解释验证路径失败不应困住会话）。九个 `defineTool`（行号为注册起点）：`worktree_create`(100-166，in-place，`targetSessionId = sourceSessionId`，输出 `worktree_target_created` 含 `cwdSelected`)、`worktree_list`(168-224)、`worktree_resume_revision`(226-271)、`worktree_begin_next_iteration`(273-316)、`worktree_ready_for_review`(318-403)、`worktree_deliver`(405-506，`autoDeliver` 关闭即拒 451-453；交付前 leave，失败回 enter 482-490)、`worktree_cleanup`(508-558)、`worktree_prune_branches`(560-628)、`worktree_merge`(630-692，`direction` forward/reverse)。所有 `execute` 用 `withHostLanguage(languageForInvocation(...))` 包裹。
- **commands.ts**：`registerWorktreeCommand`（44-228）。`leaveCheckout`(51-61)/`enterCheckout`(62-72) 闭包。动词：`status`(84-86)、`list`(87-96)、`continue`(97-109)、`next`(110-120)、`finalize`(121-159，reviewId+revision 可选 CAS、retention 白名单 `RETENTIONS`(32))、`finish`(160-179)、`discard`(180-200)、`remove`(201-219)、未知动词报 usage(220-221)。`finishedText`(35-41) 拼 autoPush 结果。
- **session-target-context.ts**：`registerSessionTargetContext`（14-41）——45 秒后台刷新 branch-race 缓存（21-26，保证 `runtimeContext` 同步）、注入 `['systemPrompt']`，`order:118` 的 `git-worktree:session-target` 上下文块，传入 `workingDirectory.current(agent)`（33-39）。

### i18n

- **i18n/core.ts**：`Language='zh'|'en'`(2)；`normalizeLanguage`（4-6）；`MessageCatalog`（8）；`Translator<C>`（14-17，占位符类型从模板字面量推导）；`createTranslator`（19-24）。
- **i18n/host.ts**：`AsyncLocalStorage<Language>`(6)；`currentHostLanguage`(8-10)/`withHostLanguage`(12-14)/`languageFromSettings`(17-27，只读 `settings.get('locale').preference`)/`languageForInvocation`(30-33)/`hostMessage`(35-38)。
- **i18n/host-messages.ts**：`hostMessages`（4-1756，约 480 条双语消息，键稳定、用户数据仅经 `{p0}` 插值——3 行注释）；`hostRegistrationMessage`（1759-1761，中英拼接用于注册元数据）；`hostPersistedCleanupMessage`（1770-1773，**持久化清理消息白名单反查**，`persistedCleanupKeys`(1768)——存储值不变、投影本地化）。

### Web Client src/client/

- **index.tsx**：`WORKTREE_CONSOLE_ADAPTER_SERVICE='worktreeConsole'`(18)、`inject`(36)、`apply`（49-105）：`localizedSlots` Proxy 包 register 注入 `ClientI18nProvider`(53-59)、head `<style>` 自标 `dataset.plugin='dsh-git-worktree'`(69-77)、注册 ToolView `worktree_create`/`worktree_ready_for_review`(81-88)、有 adapter 时再挂 `registerTargetConsole`+`registerPreSessionWorktree`(91-105)。
- **model.ts**：纯回放稳定解析——`textContent`(72-79)/`lifecycle`(86-90)/`parseCreateTool`(100-117)/`reviewArgs`(119-150)/`parseReviewTool`(152-185)。
- **actions.ts**：服务面接口（`ClientSessions` 44-61、`ClientWorkspaces` 63-66、`WorktreeClientServices` 68-80、`PreSessionWorktreeServices` 87-102、`PreSessionInput` 105-113）；`navigateToSession`(125-132)、`selectedSessionId`(135-142，retainedBy>0 判定)、`openExistingSession`(145-154)、`waitForProjectedSessionPath`(156-196，2s 超时)、`openIsolatedTarget`(199-230)、`openAuthorizedWorktreeTarget`(236-263)、`prefillSessionDraft`(266-275)、`finalizeCurrentSession`(278-293)。
- **WorktreeCreateRow.tsx**：`WorktreeCreateRow`（13-83），`OpenState` 机（11），openTarget(27-39)。
- **WorktreeReviewRow.tsx**：`isLocalTargetUnselected`(20-24)、`WorktreeReviewRow`（26-123），监听 `WORKTREE_REVIEW_REFRESH_EVENT`（54-62）+ adapter.current 拉取 liveTarget（69-88）。
- **console-remote/adapter.ts**：`FAST_TIMEOUT_MS=30_000`(56)/`SLOW_TIMEOUT_MS=180_000`(57)、`FAST_METHODS`(60-65)、`isCodecRejection`(45-48)、`createWorktreeConsoleRemoteAdapter`（80-155）：`Promise.race` 超时（89-102）+ descriptor strict `parse` 复验（105-111）。
- **console-remote/index.ts**：`inject`（45-49，过滤 `remote.directoryPicker`/`remoteAccess` + 声明 `slots`/`configForms`——18-44 注释解释 web boot 死锁与 rc.2 pending 事故）；`apply`（62-206）：mount Remote contribution→读 topology→按 flavor 分支 `legacy`/`modern`/`alpha|next`/`unsupported`（112-205），每分支区分 takeover（`registerManagedWorkspaceSidebar`）与 decorate（`registerDecoratedWorkspaceSidebar`），`reportBoot`(86-102) 上报诊断。
- **review-console/**：`request-cache.ts` 的 `createRequestCache`（41-151，per-adapter WeakMap + 单飞 + generation 防过期回写，ponytail 33-40）；`preflight-cache.ts`（`readReviewPreflight`18/`invalidateReviewPreflight`21/`useReviewPreflight`23）；`preview-recovery-cache.ts`（19/21/23）；`status-events.ts`（`WORKTREE_REVIEW_REFRESH_EVENT`1/`requestWorktreeReviewRefresh`4-6）；`WorktreeReviewPanel.tsx`（`WorktreeReviewEvidence`9/`WorktreeReviewIdentity`13/`reviewIsStale`40-52/`WorktreeReviewPanel`54-118）；`ReviewIcon.tsx`（icons 8-15，`ReviewIcon`18-21）；`ReviewDetailsModal.tsx`（`validationText`8/`validationIcon`11/`ReviewDetailsList`17-34/`ReviewDetailsModal`36-88，焦点圈 41-64）；`PreflightStatus.tsx`（`statusLabel`11-19/`PreflightStatus`21-114）；`DeliveryProof.tsx`（`DeliveryProof`16-48，compact 变体 29-34）；`index.ts`（`reviewEvidenceFromTarget`12-21/`reviewIdentityFromTarget`24-34）；`ReviewActions.tsx`（82-1199，巨型组件）——`DEFAULT_RETAIN_ENVIRONMENT=true`(80)、mutation 锁 `begin/finish`(214-226)、`startConflictRecovery`(265-358)、`startReviewRegeneration`(360-422)、`previewLocal`(453-485)、`checkpoint`(494-534，`checkpointRequestIdForGeneration`55-57)、`resumeRevision`(536-559)、`rollbackPreview`(561-623)、`submitCommit`(625-697)、`discard`(699-722)、`analyzeRecovery`(741-795)/`handoffRecovery`(797-856，均要求二次 `inspect` 身份复核)、`retryCleanup`(858-876)、`openHolder`(878-895)；recovery 队列 `recovery-continuation.ts`：`validRequest`(140-167)/`persistSnapshot`(73-91，localStorage)/`targetMatchesRequest`(195-225)/`attempt`(280-376，发送前二次 inspect + 会话切换即取消 323-346)/`buildWorktreeRecoveryPrompt`(378-386)/`enqueueWorktreeRecovery`(389-427)/`restoreWorktreeRecovery`(429-489)/`retryWorktreeRecovery`(491-501，cancelled 亦可重发——493 注释)/`useWorktreeRecoverySnapshot`(513-520)/`detachWorktreeRecoveryRuntime`(531-538)/`clearWorktreeRecovery`(540-548)。
- **pre-session/**：`harness-input.ts`（`readHarnessInput`14-19/`adaptHarnessInputActions`22-31，image→attachment API 兼容）；`controller.ts`（`PreSessionDraftState`10-17/`PreparePreSessionWorktreeRequest`25-35/`PreSessionWorktreeError`37-42/`sourceStillMatches`52-60/`PreSessionWorktreeController`67-230——`prepare`75-83 单飞去重，`run`85-195 无 await 换入段 146-156 注释、源会话归档失败不回滚已安全目标 165-170、失败走 `rollback`197-229，`createPreSessionWorktreeController`232-237）；`index.tsx`（`registerPreSessionWorktree`30-60，槽位 `conversation.input.left` order 40）；`PreSessionWorktreeToggle.tsx`（`PreSessionWorktreeToggle`36-180，scopeRef 渲染期失效 47-53、单次令牌注释 142-143）。
- **settings-card/**：`form-model.ts`——`SettingsFormScopeSnapshot`（24-37，`base`/`user`/`revision`）、`SettingsFieldSpec`（57-67）、`SettingsFieldState`（70-77）、`SettingsFormShell`（80-93）、`SettingsFormActions`（96-105）、`settingsBooleanField`129-141/`settingsNumberField`149-162/`settingsTextField`170-179、`SettingsFormModel`（188-368）：`bind`214/`shell`224/`field`242/`actions`260-275/`save`285-303（revision fence、失败保草稿）/`dispose`306/`plan`313-328；`worktree-settings-card.ts`——`WORKTREE_SETTINGS_NS='dsh-git-worktree'`(14)、`WorktreeSettings`（17-23 五字段）、`WorktreeSettingsCardController`（39-70）；`index.ts` 的 `mountSettingsCard`（35-57，fail-soft probe + `whileServed` 注入 `plugins.bundle.config`）；`WorktreeSettingsCard.tsx`（162-234，内联样式自包含——1-7 注释）。
- **target-console/**：`index.ts` 的 `registerTargetConsole`（19-46，三个槽：`conversation.session.header.actions` order 30、`conversation.input.dock` order 10/20）；`current-polling.ts`（`Poll` 类 22-91，`DELAY=5s`(8)/`HIDDEN_DELAY=60s`(15，隐藏页降频——9-14 注释)、invalidate 失代 46-72）；`branch-overview-cache.ts`（`TTL_MS=60s`(17)、`cachedBranchOverview`27/`invalidateBranchOverview`35/`patchBranchOverview`41/`ensureBranchOverview`80-84/`refreshBranchOverviewInBackground`87-92，纪元防过期回写 23-25、56-64）；`TargetStatusAction.tsx`（51-764，会话目标胶囊：分支切换乐观补丁 200-211、非 Git 项目专属初始化路径 144-150/463-497、分支搜索框 502-527、prune 预览 287-337、`initializeRepository`257-285）；`WorktreeConsoleView.tsx`（`ATTENTION_RANK`78-90/`WorktreeConsoleView`93-700，创建目标身份五重校验 250-265、放弃快照恢复区 626-663）；`WorktreeManagerModal.tsx`（18-49）；`BranchGraphModal.tsx`（`GraphEdge`10/`GraphRowLanes`18/`GraphRefBadge`26/`mergeRefs`39-57/`computeGraphLanes`66-127，lane 拓扑移植自 git-graph 组件——59-65 注释/`BranchGraphModal`175-311）；`TagManagerModal.tsx`（26-263，读清不清 error——42-45 注释）；`WorktreeHeroChip.tsx`（`resolvePortalRenderer`10-29、`findHeroRowFrom`44-69、`WorktreeHeroChip`84-142，portal 到 heroWorkspaceRow）；`WorktreeReviewStatus.tsx`（25-184，交付坞：recovery 独立条 75-99、终态 dismiss 111-113）。
- **workspace-sidebar/**：`model.ts`（`sidebarBadgeTasks`51-74、`projectManagedWorkspaceSidebar`81-203，归属歧义 fail-open——79-80 注释）；`index.tsx`（`ManagedOfficialWorkspaceBrowser`70-203、`officialContextProxy`237-321（含 `deferredRemoteDirectoryPicker`219-235 与 `remoteAccess` stub 304-317）、`registerManagedWorkspaceSidebar`328-334、`ClearSidebarBadgeMenuItem`347-381/`registerClearSidebarBadgeEntry`383-393、`WorktreeIdentity`433-453/`WorktreeStatusBadgeEntry`464-481、`registerDecoratedWorkspaceSidebar`495-535——**0.2.x 只有 `leading`/`hover` 两个 row seat**，420-424/516-521 注释解释为何不存在 trailing seat）。
- **harness-platform.d.ts**：三个 virtual 官方 Workspace 模块与 `dsh-client-ui-primitives`（`Menu`/`Modal`/`MenuItemButton` 等）的结构声明（1-78）。

## Architecture

```text
┌──────────────────────────────────────────────────────────────┐
│ Web Client (React)                                           │
│ target-console / review-console / workspace-sidebar          │
│ pre-session / settings-card   (src/client/*)                 │
└──────────────┬───────────────────────────────────────────────┘
               │ WorktreeConsoleAdapter (超时 + strict parse)
┌──────────────▼───────────────────────────────────────────────┐
│ console-remote: schemas.ts ─ descriptors.ts ─ remote.ts      │
└──────────────┬───────────────────────────────────────────────┘
               │ Typert RPC (@Remote, agentId 解析)
┌──────────────▼───────────────────────────────────────────────┐
│ console-host: service.ts ──► control-plane.ts                │
│   projection.ts / review-diff.ts / errors.ts                 │
└──────────────┬───────────────────────────────────────────────┘
               │ SessionCheckoutModule 接口
┌──────────────▼───────────────────────────────────────────────┐
│ 领域: session-checkout-module(未列) ─ session-checkout-apply  │
│   checkpoint.ts / concurrent-session-guard.ts                │
└──────────────┬───────────────────────────────────────────────┘
               │ ports.ts 端口
┌──────────────▼───────────────────────────────────────────────┐
│ adapters: git.ts / files.ts / registry.ts / lookup.ts /      │
│   working-directory.ts / worktree-creation.ts / project-*    │
└──────────────────────────────────────────────────────────────┘
```

模型侧另有并行入口：`tools.ts` + `commands.ts` + `session-target-context.ts` 直接调用 `SessionCheckoutModule`；`src/index.ts apply()`（358-459）把三路全部装配到同一个 module 实例与同一个 `AtomicJsonCheckoutRegistry`。

## Data Flow

1. **创建（模型路径）**：`worktree_create`（`src/tools.ts:100-166`）→ `module.createIsolatedTarget` → `adapters/worktree-creation.ts createWorktree`（17-124）建立 evidence 链并 `worktree add --lock` → 写 `managed-checkouts.json`（`adapters/registry.ts`）→ `enterCheckout` 经 `workingDirectory` 端口把会话 cwd 移入 → 客户端 `WorktreeCreateRow` 回放日志渲染。
2. **评审**：`worktree_ready_for_review`（`src/tools.ts:318-403`）→ `markReadyForReview` → 引擎 `reviewIsolated`/`inspectReview` 产出 `isolatedFingerprint` → 客户端 `WorktreeReviewRow`（26-123）+ `WorktreeReviewPanel`。
3. **验收（用户路径）**：`ReviewActions`（`ReviewActions.tsx:82-1199`）→ `adapter.preview/finalize/checkpoint/...` → `console-remote/adapter.ts invoke`（80-155，超时 + strict parse）→ `WorktreeConsoleService @Remote`（`console-host/service.ts`）→ `control-plane` 授权（`authorize` 318-338）→ `module.operate` → 引擎 `preview`/`finalize`/`commitIsolated`。冲突返回 `apply_conflict` + continuation，客户端 `recovery-continuation.ts` 持久排队并经官方 `session.prompt` 重发（280-376）。
4. **交付（新路径）**：`worktree_deliver` → 引擎 `commitIsolated`（`session-checkout-apply.ts:1521-1608`）把 Worktree 工作区提交到会话分支 `feat/sess-…`（命名见 `managed-worktree-path.ts:63-75`），可选 `pushBranch`，随后按 retention 清理；合并到 Local 由 `worktree_merge` → `mergeLocalBranch`（`adapters/git.ts:649-719`）单独执行。
5. **维护**：`ready` 事件 `reconcile()`、15 分钟保留期清理、每日 auto-prune（`src/index.ts:414-452`）；侧栏拓扑 `sidebarTopology`（control-plane 698-762）驱动 `workspace-sidebar/model.ts` 投影。

## Connections

- `[[session-checkout-module]]`：状态机本体，`src/index.ts:234` 导入 `createSessionCheckoutModule`，其源文件不在本文清单；`SessionCheckoutModule` 契约见 `src/index.ts:113-219`。
- `[[ports]]` ↔ `[[adapters]]`：`src/ports.ts` 定义全部端口，`src/adapters/*` 逐一实现；测试/宿主可用 fake 替换（`ports.ts:2-8` 注释）。
- `[[console-contract]]` 被 `console-host/*`、`console-remote/*`、`client/*` 三方共享（JSON-only，`console-contract.ts:1-9` 注释）。
- `[[i18n]]`：`host.ts`/`host-messages.ts` 服务于 Host 侧全部面向用户文案；`client/i18n.tsx` 依赖未列出的 `i18n/client-messages.ts` 与 `i18n/transport-messages.ts`。
- `[[host-compat]]` ↔ `[[workspace-provider-lifecycle]]` ↔ `client/console-remote/index.ts`：flavor 探测决定接管/装饰分支（`console-remote/index.ts:110-205`）。
- `[[project-skills]]` ↔ `[[review-diff]]` ↔ `[[session-checkout-apply]]`：携带的 Project Skills 参与指纹（apply 648-656）、diff 剥离（review-diff 147-162）、删除守卫（git.ts:349-359 的 `assertRemovable`）。
- 相邻 Obsidian 笔记建议：`[[dsh-subprocess]]`（`ctx.subprocess`）、`[[typert-protocol]]`（`@Remote`/`RemoteResult`）、`[[cordis]]`（`ctx.inject`/`ctx.effect`）。

## Known Issues

1. **错误文本泄漏上限**：`consoleFailure`（`src/console-host/errors.ts:13-17`）原样透出第三方 Error message（注释自述 local-only leak ceiling）；若未来出现远程面需先截断/替换。
2. **safe-file 无跨进程锁**：`writeJsonFileAtomic`（`src/adapters/safe-file.ts:82-100`）注释（79-80）明确唯一 tmp + 原子 rename 消除了「tmp 互踩」与「半写提升」，但文件级 last-writer-wins 仍在，需强一致时才引入 lock 文件。
3. **plans map 单槽**：`DefaultSessionCheckoutApplyEngine.plans`（`src/session-checkout-apply.ts:1710-1716` ponytail）同一 isolated 路径新 plan 直接覆盖旧 plan；这是有意为之但依赖「最新计算即最新意图」。
4. **分支概览缓存竞态防护**：`branch-overview-cache.ts:13-16` 与 56-58 注释——飞行中解析晚于 patch/invalidate 时不得回写，靠 `patchEpochs` 纪元比较；若漏比较会踩掉 switch 的乐观补丁。
5. **request-cache 归属**：`request-cache.ts:33-40` ponytail——entry 存 per-adapter WeakMap，换 adapter 实例即换缓存；identity 字符串是唯一共享键。
6. **worktree inspect 换行路径歧义**：`adapters/git.ts:287-297`——POSIX 路径合法含换行，多值 `rev-parse` 输出不可安全解析时回退逐项单值读取。
7. **current 轮询成本**：`current-polling.ts:9-14` 注释——隐藏窗口一次 `current` 仍要 1 次 `git status` + 2 次 `rev-parse`，故 `HIDDEN_DELAY=60s`（15 行）；TargetStatusAction 特意不在挂载时预取 `gitOverview`（`TargetStatusAction.tsx:141-143` 注释，3 次 git spawn）。
8. **observeFromCaller 只复用活跃 owner 视图**：`control-plane.ts:439-457`——已交付终态保持权威路径，因为 `committedFollowupView` 故意保守报 `dirty:true`（430-441 注释）。
9. **Workspace Loader 兼容**：`workspace-provider-lifecycle.ts:140-155` 与 223-258——Loader 1.0.6 `update()` 不等待 dispose、失败 fiber 残留导致 `refresh()` 误判 running、`fiber.await()` 在已 settled 转移上自旋（2026-10-24 Windows 实测，见 225-231 注释）；每操作 10s 上限（18 行）。
10. **已废弃/受限能力位置**：
    - `SessionCheckoutPhase` 的 `'applying'` 已废弃（`src/types.ts:22`）。
    - `enableWorkspaceProvider` 默认 `false`（`src/index.ts:318`），接管仅显式开启；0.2.x Host 上装饰路径结构性崩溃故自动接管（`workspace-provider-lifecycle.ts:82-91` 注释），此时该开关仅作提示。
    - 旧「写回 Local」交付链（`session-checkout-apply.ts` 的 `apply`/`finish`/`preview`/`rollback`/`finalize`，1737-2655）仍存在但主路径已换为 `commitIsolated`；UI 文案 `deliveryNoLongerWritesLocalUseDeliverInstead`（`host-messages.ts:1323-1326`）明示旧路径停用。
    - worktree merge 源分支归属校验 `worktreeMergeSourceNotOwnedBySession`（`host-messages.ts:1127-1130`）——只允许合并本会话自己的 worktree 分支。
    - `client/index.tsx:36` 的 `inject` 列表与 `console-remote/index.ts:45-49` 的过滤集不同：后者刻意剔除 `remote.directoryPicker`/`remoteAccess` 以免 web boot 死锁/卡死（18-44 注释）。