---
title: Session Checkout State Machine
type: module
source_files:
  - src/session-checkout-module.ts
  - src/types.ts
  - src/ports.ts
  - src/checkpoint.ts
  - src/creation-failure.ts
  - src/managed-worktree-path.ts
  - tests/session-checkout-module.test.ts
tags:
  - state-machine
  - checkout
  - recovery
  - retention
---

# Session Checkout State Machine

`createSessionCheckoutModule`（src/session-checkout-module.ts:200，全文件约 4716 行几乎都在此工厂内）是插件核心：从 Domi 移植的 session-checkout 状态机（头注释 src/session-checkout-module.ts:72），保留 receipt-first Local Preview、回滚/finalize、项目验收槽、崩溃恢复与 fingerprint CAS，同时把所有权适配到 Harness 分离的 source Local Session 与 target owner Session。进程内全部状态持久化于 `ManagedCheckoutsRegistry`（version 2，src/ports.ts:438）。

## Overview

该模块管理“受管 Worktree”（Managed Worktree）的全生命周期：创建、绑定会话、预览（Preview）、接受（Review）、交付（Finalize/Deliver）、保留（Retain）与清理（Cleanup）。它通过严格的互斥锁（withBindingLock）保证并发安全，通过 journal 机制支持崩溃恢复，并通过指纹（fingerprint/CAS）防止脏写。

本地适配特性：
- **自动推送**：Finish 成功后尽力 `git push`（src/session-checkout-module.ts:138-149）。
- **仓库移动修复**：自动重连断链 Worktree（src/session-checkout-module.ts:4295）。
- **Worktree 根目录配置**：支持 `worktreesRoot` 自定义存储位置（src/session-checkout-module.ts:4451）。
- **继承未提交修改**：新 Worktree 可继承 Local 的 WIP（src/session-checkout-module.ts:4267）。
- **放弃快照**：带未提交内容放弃前生成快照，支持恢复（src/session-checkout-module.ts:3356）。
- **常驻标记**：永久豁免自动清理（src/session-checkout-module.ts:3961）。

## Key Components

### 公开函数与接口 (src/session-checkout-module.ts)

所有公开方法均在工厂返回对象中定义（src/session-checkout-module.ts:4625-4715），绝大多数操作通过 `withBindingLock` 串行执行。

- **inspectAvailable** (src/session-checkout-module.ts:1043): 异步获取会话目标视图。处理 maintenance 模式下的只读旁路，确保后台清理不阻塞前端 inspect。
- **runtimeContext** (src/session-checkout-module.ts:836): 同步生成模型上下文指引字符串。根据 delivery.state 和 phase 提供不同的操作指令（如 "call worktree_deliver", "Do not mutate" 等）。
- **preflightTarget** (src/session-checkout-module.ts:2164): 提交前预检。检查冲突、stale_isolated/stale_local 状态，返回 WorktreeApplyPreflightView。
- **preflightPreviewRecoveryTarget** (src/session-checkout-module.ts:2085): 预览恢复预检。评估 detached preview 的可恢复性，生成 recoveryProof。
- **runExclusiveSessionMutation** (src/session-checkout-module.ts:4635): 执行独占会话变更操作。
- **bind** (src/session-checkout-module.ts:4640): 绑定目标（Local 或 Isolated）。内部调用 bindTarget。
- **createIsolatedTarget** (src/session-checkout-module.ts:4642): 为源会话创建隔离目标到新会话。
- **beginNextIteration** (src/session-checkout-module.ts:4650): 开始下一轮迭代。复用上一轮的 managedRoot 路径。
- **resumeRevision** (src/session-checkout-module.ts:4655): 恢复编辑已提交的 Review。
- **prepareReviewRegeneration** (src/session-checkout-module.ts:4660): 准备 Review 再生（stale_isolated 时）。
- **preparePreviewRecoveryAnalysis** (src/session-checkout-module.ts:4665): 准备预览恢复分析。
- **createPreviewRecoveryHandoff** (src/session-checkout-module.ts:4670): 创建预览恢复移交。
- **markReadyForReview** (src/session-checkout-module.ts:4675): 标记为 Ready for Review。
- **operate** (src/session-checkout-module.ts:4680): 分发操作（apply, finish, preview, checkpoint, rollback_preview, finalize_preview, retry_cleanup, discard, recover）。
- **isAutoDeliverEnabled** (src/session-checkout-module.ts:4683): 检查 autoDeliver 配置。
- **listManagedWorktrees** (src/session-checkout-module.ts:3735): 列出受管 Worktree（不加锁，只读）。
- **listManagedWorktreesForSession** (src/session-checkout-module.ts:3746): 按会话列出受管 Worktree。
- **pruneMergedBranchesForSession** (src/session-checkout-module.ts:3606): 修剪已合并的本地分支。
- **autoPruneStaleMergedBranches** (src/session-checkout-module.ts:3635): 自动修剪陈旧已合并分支（维护扫描）。
- **mergeBranchForSession** (src/session-checkout-module.ts:3650): 合并分支到 Local 或反向同步。
- **listAbandonedWorktreeSnapshots** (src/session-checkout-module.ts:3684): 列出放弃的快照。
- **restoreAbandonedWorktreeSnapshot** (src/session-checkout-module.ts:3695): 恢复放弃的快照。
- **manageManagedWorktreeForSession** (src/session-checkout-module.ts:3898): 管理 Worktree（discard/set_retention/set_permanent/cleanup）。
- **inspectManagedWorktreeCleanup** (src/session-checkout-module.ts:3670): 检查清理资格。
- **bulkCleanupManagedWorktrees** (src/session-checkout-module.ts:3684): 批量清理。
- **manageManagedWorktree** (src/session-checkout-module.ts:3919): 通用管理工作台。
- **resolveManagedRoot** (src/session-checkout-module.ts:3990): 解析受管根路径。
- **observeManagedCheckout** (src/session-checkout-module.ts:3986): 观察单个 checkout（纯读验证）。
- **observeManagedCheckouts** (src/session-checkout-module.ts:3995): 批量观察多个 checkout。
- **cleanupExpiredRetained** (src/session-checkout-module.ts:4003): 清理过期的保留记录。
- **enforceWorktreeKeepCount** (src/session-checkout-module.ts:4031): 强制执行 Worktree 数量上限（LRU）。
- **reconcile** (src/session-checkout-module.ts:1061): 启动收敛/恢复。处理 orphaned, recovery_required, staleRoot 等状态。

### 内部辅助函数

- **withBindingLock** (src/session-checkout-module.ts:988): 核心互斥锁。支持 exclusive 和 maintenance 模式。maintenance 允许只读 inspect 并发，但需等待现有 inspect 完成。
- **withCleanupTimeout** (src/session-checkout-module.ts:115): 清理操作超时保护（120s）。防止 Windows 上文件占用导致无限挂起。
- **pushLocalBranchBestEffort** (src/session-checkout-module.ts:138): 尽力推送本地分支，失败不阻断流程。
- **cleanupReasonForMessage** (src/session-checkout-module.ts:160): 将清理消息文本映射为结构化 reason。
- **retryTransientCleanup** (src/session-checkout-module.ts:178): 临时错误重试（EBUSY/EPERM 等），退避延迟 [100, 300, 800]ms。
- **retentionExpiresAt** (src/session-checkout-module.ts:196): 计算保留过期时间。
- **pathForIdentity / pathsEqual / resolvedPathsEqual** (src/session-checkout-module.ts:206-226): 路径规范化与比较。resolvedPathsEqual 不使用 realpath 以避免 Junction 冒充。
- **requireSession / resolveSessionProject** (src/session-checkout-module.ts:236-252): 会话与项目查找。
- **inspectLocal / inspectIsolated** (src/session-checkout-module.ts:256, 636): 检查 Local 或 Isolated 目标状态。
- **projectPreviousReview / projectCheckpoint / projectDelivery** (src/session-checkout-module.ts:286-356): 数据转换辅助函数。
- **bindingForManagedRecord** (src/session-checkout-module.ts:364): 从托管记录构建绑定记录。
- **recoveryView / committedFollowupView** (src/session-checkout-module.ts:382, 436): 构建恢复或已交付视图。
- **saveCreationEvidence / finishFailedCreation / markRecoveryRequired** (src/session-checkout-module.ts:474-516): 创建证据保存与失败处理。
- **validateManagedCheckoutDetailed** (src/session-checkout-module.ts:554): 详细验证托管 checkout 身份（路径、Git 状态、checkpoint 链）。
- **checkpointHeadInvariantHolds** (src/session-checkout-module.ts:518): 并行验证 checkpoint 链的祖先关系。
- **directoryIdentitiesEqual / hasCleanupRemovalReceipt / hasLegacyCleanupResidueEvidence** (src/session-checkout-module.ts:618-634): 清理残留验证辅助。
- **validateCleanupLocalIdentity / validateDetachedCleanupResidue / validateCleanupQuarantine** (src/session-checkout-module.ts:642-716): 清理过程中的身份验证。
- **getPersistedBinding / runtimeContext** (src/session-checkout-module.ts:724, 836): 获取持久化绑定与运行时上下文。
- **resolveBinding** (src/session-checkout-module.ts:921): 解析并校验会话绑定。
- **prepareMaintenanceReadySignal / beginMaintenanceInspect / finishMaintenanceInspect** (src/session-checkout-module.ts:970-984): Maintenance 模式信号控制。
- **inspectDuringMaintenance / inspectAvailable** (src/session-checkout-module.ts:1026, 1043): Maintenance 期间的 inspect 策略。
- **operationError / updateManagedCheckout** (src/session-checkout-module.ts:1108, 1116): 错误构造与记录更新。
- **markReadyForReviewTarget** (src/session-checkout-module.ts:1126): 标记为 Ready for Review 的核心逻辑。
- **operateCheckpoint** (src/session-checkout-module.ts:1410): 保存 Checkpoint。处理 preview_active 时的回滚。
- **resumeRevisionTarget** (src/session-checkout-module.ts:1716): 恢复编辑 Review。
- **prepareReviewRegenerationTarget** (src/session-checkout-module.ts:1780): 准备 Review 再生。
- **preparePreviewRecoveryAnalysisTarget / createPreviewRecoveryHandoffTarget** (src/session-checkout-module.ts:1816, 1846): 预览恢复相关。
- **operateApply** (src/session-checkout-module.ts:1936): 应用更改到 Local。
- **holdsProjectAcceptanceSlot / findProjectAcceptanceHolder** (src/session-checkout-module.ts:2256, 2266): 项目验收槽管理。
- **retainPreviewArtifacts / releasePreviewArtifactsBestEffort / previewArtifactsMatch** (src/session-checkout-module.ts:2276-2316): 预览工件管理。
- **blockedPreviewRecovery / canonicalJson / sha256Facts / recoveryGeneration** (src/session-checkout-module.ts:2324-2356): 恢复证明生成。
- **preflightTarget** (src/session-checkout-module.ts:2164): 预检逻辑。
- **operatePreview** (src/session-checkout-module.ts:2270): 执行 Preview。
- **detachPreviewAfterLocalDrift** (src/session-checkout-module.ts:2418): Local 漂移后分离预览。
- **operateRollbackPreview** (src/session-checkout-module.ts:2457): 回滚预览。
- **retainFinalized** (src/session-checkout-module.ts:2564): 将 finalized 转为 retained。
- **collectEmptyManagedContainer** (src/session-checkout-module.ts:2596): 回收空容器。
- **cleanupFinalized** (src/session-checkout-module.ts:2612): 清理已交付 Worktree。包含 quarantine 逻辑。
- **operateFinalizePreview** (src/session-checkout-module.ts:2799): 确认预览（Finalize）。
- **operateRetryCleanup** (src/session-checkout-module.ts:2950): 重试清理。
- **operateFinish** (src/session-checkout-module.ts:2967): 直接交付（Finish）。包含 autoPush。
- **releaseApplyBaseBestEffort** (src/session-checkout-module.ts:3238): 释放 Apply Base 引用。
- **operateDiscard** (src/session-checkout-module.ts:3272): 放弃 Worktree。包含快照逻辑。
- **operateRecover** (src/session-checkout-module.ts:3438): 恢复 Worktree。
- **operateTarget** (src/session-checkout-module.ts:3486): 操作分发器。
- **managedIteration / managedUpdatedAt** (src/session-checkout-module.ts:3506, 3516): 辅助排序与筛选。
- **summarizeManagedWorktree** (src/session-checkout-module.ts:3521): 生成摘要视图。
- **cleanupBlocked / inspectCleanupForRecord** (src/session-checkout-module.ts:3566, 3576): 清理资格检查。
- **inspectManagedWorktreeCleanup / bulkCleanupManagedWorktrees** (src/session-checkout-module.ts:3670, 3684): 清理列表与批量清理。
- **listManagedWorktrees / listManagedWorktreesForSession** (src/session-checkout-module.ts:3735, 3746): 列表查询。
- **pruneMergedBranchesInRepo / pruneMergedBranchesForSession** (src/session-checkout-module.ts:3566, 3606): 分支修剪。
- **autoPruneStaleMergedBranches** (src/session-checkout-module.ts:3635): 自动修剪。
- **mergeBranchForSession** (src/session-checkout-module.ts:3650): 分支合并。
- **listAbandonedWorktreeSnapshots / restoreAbandonedWorktreeSnapshot** (src/session-checkout-module.ts:3684, 3695): 快照管理。
- **manageManagedWorktreeForSession / manageManagedWorktree** (src/session-checkout-module.ts:3898, 3919): 管理工作台。
- **observeManagedCheckout / observeManagedCheckouts** (src/session-checkout-module.ts:3986, 3995): 观察接口。
- **resolveManagedRoot** (src/session-checkout-module.ts:3990): 解析路径。
- **cleanupExpiredRetained** (src/session-checkout-module.ts:4003): 清理过期保留。
- **enforceWorktreeKeepCount** (src/session-checkout-module.ts:4031): 强制数量限制。
- **beginNextIterationTarget** (src/session-checkout-module.ts:4058): 开始下一轮迭代。
- **copyWorktreeincludeFiles / carryLocalWorkInProgress / repairStaleWorktreeLinks** (src/session-checkout-module.ts:4239, 4267, 4295): 本地适配辅助。
- **bindTarget** (src/session-checkout-module.ts:4330): 绑定目标核心逻辑。

### 类型定义 (src/types.ts)

- **SessionTargetRef** (src/types.ts:11): { kind: 'unselected' } | { kind: 'local' } | { kind: 'isolated'; checkoutId: string }。
- **SessionCheckoutPhase** (src/types.ts:18): preparing | ready | applying(废弃) | mutating | recovery_required | finalized | retained | discarded。
- **WorktreeRetentionMode** (src/types.ts:32): cleanup | retain_24h | retain_3d | retain_manual。
- **WorktreeCleanupReason** (src/types.ts:38): directory_busy | modified_after_finalize | identity_changed | detached_residue | quarantine_busy。
- **WorktreeCheckpointView** (src/types.ts:46): 保存的检查点视图。
- **WorktreeReviewView** (src/types.ts:56): Review 视图。
- **WorktreeDeliveryProofView** (src/types.ts:70): 交付证明视图。
- **WorktreeDeliveryView** (src/types.ts:85): 七种交付状态联合类型。
- **WorktreeApplyPreflightBlockedReason** (src/types.ts:116): 预检阻塞原因。
- **WorktreeApplyPreflightView** (src/types.ts:136): 预检结果视图。
- **SessionTargetProjectView / SessionTargetCheckoutView / SessionTargetSourceView / SessionTargetCurrentView** (src/types.ts:156-176): 目标视图子组件。
- **SessionTargetView** (src/types.ts:180): 完整的目标视图。
- **SessionTargetBindChoice** (src/types.ts:198): 绑定选择。
- **SessionCheckoutOperation** (src/types.ts:250): 操作联合类型。
- **WorktreePreviewRecoveryProof** (src/types.ts:262): 预览恢复证明。
- **WorktreePreviewRecoveryPreflightView** (src/types.ts:306): 预览恢复预检视图。
- **SessionCheckoutAppliedResult / PreviewedResult / CheckpointedResult / PreviewRolledBackResult / PreviewDetachedResult / FinishedResult / ConflictResult / DiscardedResult / RecoveredResult / OperationErrorResult** (src/types.ts:326-436): 操作结果类型。
- **ManagedWorktreeCleanupEligibility / ManagedWorktreeCleanupBlockReason** (src/types.ts:440-446): 清理资格与原因。
- **ManagedWorktreeCleanupView** (src/types.ts:452): 清理检查结果。
- **BulkCleanupManagedWorktreeCandidate / BulkCleanupManagedWorktreesResult** (src/types.ts:462-468): 批量清理候选与结果。
- **ManagedWorktreeSummaryState** (src/types.ts:472): 摘要状态。
- **ManagedWorktreeSummaryView** (src/types.ts:478): 摘要视图。
- **PruneMergedBranchEntry / PruneMergedBranchesView** (src/types.ts:504-512): 分支修剪条目与视图。
- **AbandonedWorktreeSnapshotView** (src/types.ts:518): 放弃快照视图。
- **ApplyBaseStrategy** (src/types.ts:524): 应用基线策略。
- **ApplyConflictDetail** (src/types.ts:530): 冲突详情。
- **CONFLICT_DETAIL_FILE_LIMIT / CONFLICT_DETAIL_DIFF_LIMIT** (src/types.ts:536-537): 冲突详情限制常量（6 文件，4KB diff）。
- **MergeLocalBranchOutcome / MergeLocalBranchResult / MergeBranchForSessionView** (src/types.ts:542-562): 合并结果。
- **SESSION_CHECKOUT_ERROR_CODES** (src/types.ts:567-597): 28 个错误码数组。
- **SessionCheckoutErrorCode** (src/types.ts:599): 错误码类型。
- **SessionCheckoutFailure** (src/types.ts:603): 失败结构。

### 端口契约 (src/ports.ts)

- **SessionCheckoutSessionRecord** (src/ports.ts:26): 会话记录。
- **SessionCheckoutProjectRecord** (src/ports.ts:32): 项目记录。
- **SidebarDirectoryMembership** (src/ports.ts:38): 侧边栏目录成员。
- **SessionCheckoutLookupPort** (src/ports.ts:44): 查找端口。
- **GitCheckoutSnapshot** (src/ports.ts:54): Git 快照。
- **BranchOverviewEntry** (src/ports.ts:62): 分支概览条目。
- **GraphLogCommit** (src/ports.ts:68): 图日志提交。
- **InitialCommitPreflight** (src/ports.ts:78): 初始提交预检。
- **SessionCheckoutGitPort** (src/ports.ts:81): Git 端口，包含大量可选适配方法。
- **DirectoryIdentity** (src/ports.ts:163): 目录身份（device, inode, birthtimeNs）。
- **SessionCheckoutFilesPort** (src/ports.ts:169): 文件端口。
- **SessionBindingRecord** (src/ports.ts:188): 会话绑定记录。
- **ManagedCheckoutJournalBase / ManagedCheckoutCreateJournal / ManagedCheckoutMutationJournal** (src/ports.ts:196-255): Journal 类型。
- **ManagedWorktreeCheckpointRecord** (src/ports.ts:259): 检查点记录。
- **ManagedWorktreePreviousReviewRecord** (src/ports.ts:280): 上一个 Review 记录。
- **ManagedWorktreeReviewRecord** (src/ports.ts:288): Review 记录。
- **ManagedPreviewReceipt** (src/ports.ts:304): 预览收据。
- **ManagedDeliveryProof** (src/ports.ts:320): 交付证明。
- **ManagedApplyConflictRecoveryContinuation / ManagedReviewRegenerationContinuation / ManagedPreviewRecoveryAnalysisContinuation / ManagedPreviewRecoveryHandoffContinuation** (src/ports.ts:330-356): 恢复继续上下文。
- **ManagedCheckoutDelivery** (src/ports.ts:362): 交付联合类型。
- **ManagedCheckoutRecord** (src/ports.ts:388): 托管 Checkout 记录。
- **ManagedCheckoutsRegistry** (src/ports.ts:438): 注册表。
- **SessionCheckoutRegistryPort** (src/ports.ts:450): 注册表端口。
- **LiveValue** (src/ports.ts:456): 实时值包装。
- **liveConfigValue** (src/ports.ts:462): 解包 LiveValue。
- **SessionCheckoutDependencies** (src/ports.ts:472): 依赖注入接口。

### 支撑模块

- **checkpointGenerationForRecord** (src/checkpoint.ts:16): 生成 CAS generation token。
- **WorktreeCreationFailure** (src/creation-failure.ts:2): 创建失败异常，带 rolledBack 标志。
- **sanitizeManagedWorktreeLabel** (src/managed-worktree-path.ts:15): 清理工作区标签。
- **createManagedWorktreeRepositoryKey** (src/managed-worktree-path.ts:38): 生成仓库密钥。
- **createManagedWorktreeDirectoryName** (src/managed-worktree-path.ts:46): 生成目录名。
- **createTopicManagedWorktreeDirectoryName** (src/managed-worktree-path.ts:66): 生成主题目录名。
- **createTopicDateStamp** (src/managed-worktree-path.ts:80): 生成日期戳。
- **createManagedWorktreePathCandidates** (src/managed-worktree-path.ts:97): 生成路径候选。

## Architecture

```text
┌─────────────────────────────────────────────────────────────────────┐
│                        SessionCheckoutModule                         │
│                     (src/session-checkout-module.ts)                 │
│                                                                     │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────────┐    │
│  │  Bind/Create │   │  Operate     │   │  List/Manage         │    │
│  │  (mutating)  │   │  (mutating)  │   │  (read-only/maint)   │    │
│  └──────┬───────┘   └──────┬───────┘   └──────────┬───────────┘    │
│         │                  │                       │                │
│         ▼                  ▼                       ▼                │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                   withBindingLock                           │   │
│  │  (exclusive / maintenance / maintenance_draining)           │   │
│  └──────────────────────────┬──────────────────────────────────┘   │
│                             │                                      │
│         ┌───────────────────┼───────────────────┐                  │
│         ▼                   ▼                   ▼                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐    │
│  │ Validation   │  │ ApplyEngine  │  │ Registry Port        │    │
│  │ (paths,      │  │ (plan,       │  │ (read/write v2)      │    │
│  │  git status) │  │  apply,      │  │                      │    │
│  │              │  │  checkpoint) │  │                      │    │
│  └──────────────┘  └──────────────┘  └──────────────────────┘    │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Cleanup & Retention                       │   │
│  │  (cleanupFinalized, enforceWorktreeKeepCount,               │   │
│  │   cleanupExpiredRetained, collectEmptyManagedContainer)      │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

## Data Flow

1. **绑定 (Bind)**: 用户或系统调用 `bind` 或 `createIsolatedTarget`。`bindTarget` 检查现有绑定，创建新的 `ManagedCheckoutRecord` 和 `SessionBindingRecord`，写入 registry，并调用 `git createDetachedWorktree`。成功后更新 record 为 `ready` 状态。
2. **操作 (Operate)**: 通过 `operate` 分发具体动作（apply, preview, checkpoint, finish 等）。每个操作先通过 `withBindingLock` 获取互斥锁，然后进行 CAS 校验（revision, reviewId, generation），调用 `ApplyEngine` 执行实际 Git 操作，最后更新 registry。
3. **预览与恢复 (Preview & Recovery)**: Preview 操作先将工件保留（retainPreviewArtifacts），再应用补丁到 Local。如果 Local 发生变化，preview 会进入 `preview_detached` 状态，需要用户通过 UI 恢复。恢复过程需要验证 `WorktreePreviewRecoveryProof`。
4. **交付 (Finalize/Deliver)**: Finish 或 Finalize Preview 会将 Worktree 的更改提交到 Local，并可选地推送到远程。之后触发清理流程。
5. **清理 (Cleanup)**: `cleanupFinalized` 负责删除 Worktree 目录。如果目录被占用或身份不匹配，会进入 quarantine 或 blocked 状态。`cleanupExpiredRetained` 定期清理过期的保留记录。`enforceWorktreeKeepCount` 强制执行数量上限。
6. **恢复 (Reconcile)**: 启动时或定时运行 `reconcile`，检查 orphaned, recovery_required, staleRoot 等状态，尝试自动恢复或标记为需要人工干预。

## Connections

- [[session-checkout-apply]]: ApplyEngine 实现，负责 plan, apply, checkpoint 等底层 Git 操作。
- [[registry]]: 持久化存储层，管理 ManagedCheckoutsRegistry。
- [[git-port]]: Git 操作适配器。
- [[file-port]]: 文件系统操作适配器。
- [[session-management]]: 会话管理模块，提供会话与项目查找。