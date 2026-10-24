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
tags: [state-machine, checkout, recovery, retention, session-branch]
---

# Session Checkout State Machine

`createSessionCheckoutModule`（src/session-checkout-module.ts:235-5176）是插件核心：一套从 Domi 移植来的 session-checkout 状态机，保留 receipt-first Local Preview、回滚/finalize、项目验收槽、崩溃恢复与 fingerprint CAS，同时把所有权适配到 Harness 分离的 source Local Session 与 target owner Session。全部持久化状态落在 `ManagedCheckoutsRegistry`（version 2，src/ports.ts:491-496）。

当前版本最关键的语义变化是**交付不再写回 Local**：每个受管 Worktree 在创建阶段就挂到属于自己会话的分支（`refs/heads/feat/sess-<会话>[--<主题>]`），`finish` 只在这条会话分支上提交，Local 的工作区、索引与 HEAD 全程不被读写；合并由 `mergeBranchForSession` 显式发起。为此模块新增了 `branchNameOf`（src/session-checkout-module.ts:231-233）、`attachSessionBranch`（743）、`ensureSessionBranch`（799）、`refuseLegacyLocalWrite`（1561）与 `explainApplyConflict`（1531）。同一语义已延伸到验收侧：`markReadyForReviewTarget`（1589）在 `inspectReview` 之前先 `ensureSessionBranch`，让验收指纹记录交付期真实的 HEAD 身份（详见「生命周期操作」）。

## Overview

模块管理「受管 Worktree」（Managed Worktree）的全生命周期：绑定会话、创建、检查点（Checkpoint）、预览（Preview）、Review、交付（Deliver/Finish）、保留（Retain）与清理（Cleanup）。三个机制贯穿始终：

- **互斥**：所有变更操作经 `withBindingLock`（src/session-checkout-module.ts:1194）串行化；maintenance 模式允许只读 `inspect` 并发旁路，但必须先关闭旁路并排空已启动的 inspect。
- **崩溃恢复**：`record.journal` 记录可重放的 receipt，`reconcile()`（1267）按 journal 的 step 把记录确定性收敛到 `ready` 或 `recovery_required`。
- **CAS / 指纹**：`revision`、`isolatedFingerprint`、`reviewId`、`generation` 共同构成乐观并发校验；Preview 用 receipt 记录写入前后的 Local 指纹，任何漂移都让预览进入 `preview_detached`。

本地适配特性（相对 Domi 原版）：

- **会话分支交付**：创建即挂分支，交付只提交会话分支（743、799、3244）。
- **自动推送**：Finish 成功后尽力推送**会话分支**（`pushLocalBranchBestEffort`，src/session-checkout-module.ts:127-138）；失败降级为「已跳过」备注。
- **仓库移动修复**：`git worktree repair` 重连断链 Worktree（`repairStaleWorktreeLinks`，4703）。
- **Worktree 根目录配置**：`worktreesRoot` + 主题命名（路径候选生成在 `createManagedWorktreePathCandidates`，src/managed-worktree-path.ts:132-175）。
- **继承未提交修改**：`carryLocalWorkInProgress`（4675），仅当基点等于 Local HEAD 时生效。
- **放弃快照**：带未提交内容放弃前固化快照（`operateDiscard` 3491）。
- **常驻标记**：`permanent` 豁免保留期到期清理与 LRU 逐出（4408）。

## Key Components

### 模块级常量与工具函数（src/session-checkout-module.ts）

- **`UNVERSIONED_OID` / `UNVERSIONED_REF`**（89-90）：未版本化项目的伪 OID 与伪 ref（`'unversioned'` / `'WORKING_TREE'`）。
- **`RETENTION_24H_MS` / `RETENTION_3D_MS`**（91-92）：保留期时长。
- **`CLEANUP_IDENTITY_CHANGED_MESSAGE`**（93）、**`CLEANUP_RESIDUE_MESSAGE`**（94）：清理被身份变更/残留证据挡住时的固定文案。
- **`TRANSIENT_CLEANUP_RETRY_DELAYS_MS`**（95）：`[100, 300, 800]`。
- **`CHECKOUT_CLEANUP_TIMEOUT_MS`**（104）：`120_000`，Windows 文件占用下防止清理无限挂起。
- **`withCleanupTimeout(checkoutId, operation)`**（106-124）：给清理/收敛加 120s 兜底超时。
- **`pushLocalBranchBestEffort(push, localRoot)`**（127-138）：尽力推送，返回 `WorktreePushOutcome`，异常降级为 note。
- **`cleanupReasonForMessage(message)`**（140-148）：把历史清理文案映射回结构化 `WorktreeCleanupReason`。
- **`persistedCleanupReason(delivery)`**（154-159）：优先读结构化 `cleanupReason`，否则回退文案映射。
- **`isTransientCleanupError(error)`**（161-168）：识别 `EBUSY` / `EPERM` / `ENOTEMPTY` / `EACCES` 等瞬时错误。
- **`retryTransientCleanup(operation)`**（170-182）：按 `TRANSIENT_CLEANUP_RETRY_DELAYS_MS` 退避重试。
- **`retentionExpiresAt(retention, retainedAt)`**（184-188）：保留到期时间戳；`retain_manual` 为 `null`。
- **`pathForIdentity(root)`**（190-196）：去掉尾部分隔符的规范化路径，仅用于身份比较。
- **`pathsEqual(left, right)`**（198-204）：大小写/分隔符归一后比较。
- **`resolvedPathsEqual(left, right)`**（207-213）：canonical 路径与 registry 原始路径比较，**不做 realpath**，防止 Junction 冒充。
- **`pathIsWithin(parent, child)`**（220-228）：判断包含关系。
- **`branchNameOf(ref)`**（231-233）：`refs/heads/x` → `x`；其他 ref（含 detached 的 `HEAD`）返回 `null`。会话分支名一律经它从 ref 取出。

### 工厂内基础件（绑定/校验/视图）

- **`requireSession(sessionId)`**（238）、**`resolveSessionProject(sessionId)`**（244，缺项目根时抛 `project_root_missing`）。
- **`inspectLocal(binding)`**（255）：Local 目标视图。
- **`projectPreviousReview(record)`**（283）：`suggestedCommitMessage` 截断 500、`changedFiles` 截 50。
- **`projectCheckpoint(record)`**（293）。
- **`projectDelivery(record, commitInLocalHistory)`**（305）：按 `delivery.state` 投影 review/preview/proof/cleanup 视图。
- **`bindingForManagedRecord(record)`**（372）：从托管记录合成绑定记录。
- **`recoveryView(binding, record?, dirty)`**（387）：`phase` 为 `discarded` 时保持 `discarded`，否则 `recovery_required`。
- **`validateCommittedLocalCheckout(binding, record)`**（412）、**`committedFollowupView(binding, record)`**（436）：commit 是权威事实，残余环境异常只影响 cleanup，不把会话降级。
- **`saveCreationEvidence`**（485）、**`finishFailedCreation(sessionId, checkoutId, error, previous?)`**（496）、**`markRecoveryRequired(record)`**（521）。
- **`checkpointHeadInvariantHolds(record)`**（550）：结构校验 + 并行取证（`readInternalArtifact` / `isAncestor`）验证检查点链。
- **`validateManagedCheckoutDetailed(binding, record, requireCreateBase)`**（586）：多重身份判定——binding 四元组、`managedRoot`/`managedGitRoot`/`localRoot` 的 realpath 比较、`gitCommonDir`、`gitDir`；`requireCreateBase` 时要求 `headOid === baseOid`，否则校验检查点不变式；`catch` 返回 `unavailable`，避免瞬时 I/O 把健康 Worktree 判成 `recovery_required`。
- **`validateManagedCheckout`**（644）：上面函数的薄包装，只取 valid/invalid。
- **`directoryIdentitiesEqual`**（658）、**`hasCleanupRemovalReceipt`**（662）、**`hasLegacyCleanupResidueEvidence`**（668）、**`validateCleanupLocalIdentity`**（677）、**`validateDetachedCleanupResidue`**（695）：清理链的身份与残留取证。
- **`validateCleanupQuarantine(record)`**（851）：校验隔离目录身份（目录名形如 `.dsh-wt-cleanup--<checkoutId 前 8 位>--<operationId>`）。
- **`attachSessionBranch({localRoot, managedRoot, sessionId, topic})`**（743）：把新建/重建的 Worktree 从 detached HEAD 挂到会话分支。端口缺 `attachWorktreeBranch` 时 `console.warn` 并返回 `null`（退回旧 detached 行为）；否则取 `inspect(managedRoot).headOid`，对 `createSessionBranchCandidates`（src/managed-worktree-path.ts:63-75）逐个候选拼 `refs/heads/${branch}`，先用 `resolveLocalBranchTip` 取该名现有 tip。**同名分支已存在时不再无条件跳过**：若 `existing === headOid`，或 `existing` 是当前 HEAD 的祖先（`isAncestor`），则视为可复用，用 `attach(managedRoot, branchRef, headOid, existing)`（CAS 到该 old 值）挂上去并复验；其余情况才换下一个候选名——**绝不覆盖带别的提交的同名分支**。分支不存在时 `attach(managedRoot, branchRef, headOid, null)` 创建，同样复验后才返回 `{branch, branchRef}`。
- **`EnsureSessionBranchResult`**（787）：`{ok:true, record}` | `{ok:false, code, message}`。
- **`ensureSessionBranch(record)`**（799）：交付前保证 Worktree 挂在自己的会话分支上。端口缺 `attachWorktreeBranch` 时 warn 并原样 `ok:true`；`inspect` 失败 → `recovery_required`；`record.sessionBranch` 已存在且 `headRef` 相符则直接 `ok`；有记录但 HEAD 已离开 → attach 回记录值并复验，成功则 revision+1；attach 失败**另建独立会话分支**（绝不覆盖别人提交）；`attachSessionBranch` 返回 null → `git_operation_failed`；成功后 `updateManagedCheckout` 同时把 `sessionBranch` 与 `sourceRef` 写成同一个 branch ref，revision+1；记录不存在 → `checkout_missing`。**历史记录（旧版本创建、detached、`sourceRef` 记的是 Local 当时所在分支——可能属于别的会话）不复用 `sourceRef` 作为交付目标**，`sourceRef` 从此只作「分叉来源」展示。
- **`inspectIsolated(binding, persistRecovery = true)`**（870）：`discarded` + `delivered` 走 `committedFollowupView`；`recovery_required` 且 `journal === null` 且目录仍在时，先用 `validateManagedCheckoutDetailed` 尝试修复回 `ready`；只有 `invalid` 才持久化 recovery；命中 `ready_for_review` 时计算 `reviewSlot`。
- **`getPersistedBinding(sessionId)`**（980）。
- **`runtimeContext(sessionId, cwd?)`**（984）：给模型的运行时指引。Local 分支按 pending 给提示。Isolated 分支：`recovery_required`、`discarded`+`delivered`、`finalized` 或 `retained` 且 cwd 不在 `managedRoot` 时输出允许在 Local 工作等提示，消除「人在 Local 却禁止写 Local」矛盾；否则输出 Isolated Checkout 权威 cwd 与 write-guard 规则。
- **`resolveBinding(sessionId)`**（1127）：`project_mismatch` / `target_unselected`；`discarded`+`delivered` 且 `workspace.root` 等于 `managedRoot` 时放行。
- **`withBindingLock(operation, {allowConcurrentInspect?})`**（1194）：排他/维护锁队列，串行化变更操作。
- **`inspectTarget`**（1231）、**`inspectDuringMaintenance`**（1237，只读不写 registry）、**`inspectAvailable`**（1249）。
- **`reconcile()`**（1267）：清 `discarded` 空壳与空容器；回收 predecessor 记录；`finalized` 直接进 `cleanupFinalized`；按 journal step 确定性收敛；结尾 `cleanupExpiredRetained`。
- **`operationError(code, message, target?)`**（1516）。
- **`explainApplyConflict({localRoot, conflictingFiles})`**（1531）：把 `apply_conflict` 分类并给出 `resolveHint`——先 `listUntrackedFiles` 取未跟踪集，命中即 `untracked_conflict`；否则 `git.status().dirty` → `local_dirty`；否则 `content_conflict`。
- **`refuseLegacyLocalWrite(record, binding)`**（1561）：`if (!record.sessionBranch) return null`；否则旧的「写回 Local」操作一律返回 `operation_not_allowed`，并把 `inspectIsolated(binding)` 作为 target 指路 `worktree_deliver`。调用点：`operateApply`（2092）、`operatePreview`（2538）、`operateFinalizePreview`（3071）。
- **`updateManagedCheckout(checkoutId, mutate)`**（1575）：CAS 写 registry。

### 生命周期操作

- **`markReadyForReviewTarget(sessionId, input)`**（1589）：长度上限 summary ≤240、commitMessage ≤500、details ≤12000、validationSummary ≤500、tests ≤20；`inspectReview` 产出 `reviewId` / `changedFiles` / `isolatedFingerprint` / `isolatedHeadOid`。
- **`operateCheckpoint`**（1672）：`requestId` 幂等重放、`expectedGeneration` CAS、`preview_active` 先 rollback；journal `planning` → `updating_ref` 并 `retainInternalArtifact('checkpoints/<id>')`；提交后 delivery 回 `working`。
- **`resumeRevisionTarget`**（1902）、**`prepareReviewRegenerationTarget`**（1975）、**`preparePreviewRecoveryAnalysisTarget`**（2008）、**`createPreviewRecoveryHandoffTarget`**（2044）。
- **`operateApply`**（2092）：旧的「写回 Local」路径。开头插入 legacy 门（调用 `refuseLegacyLocalWrite`）；冲突时用 `explainApplyConflict` 填充 `reason` + `resolveHint`。
- **`holdsProjectAcceptanceSlot`**（2251）、**`findProjectAcceptanceHolder`**（2259）、**`retainPreviewArtifacts`**（2271）、**`releasePreviewArtifactsBestEffort`**（2279）、**`previewArtifactsMatch`**（2287）。
- **`blockedPreviewRecovery`**（2301）、**`canonicalJson`**（2320，数组/对象递归键排序并过滤 `undefined`）、**`sha256Facts`**（2331）、**`recoveryGeneration`**（2335）。
- **`preflightPreviewRecoveryTarget`**（2339）：`not_owner` → `checkout_unavailable` → `stale_target` → `not_preview_detached` → `checkout_unavailable` → `artifacts_missing` → `assessPreviewRecovery` → `git_error`；项目验收槽被占时 rollback/finalize 都置 `{status:'blocked', code:'project_acceptance_busy'}`；facts 含 `receiptFingerprint`、`localFingerprint` 等，二次 CAS 后返回 `{status:'assessed', localModified:false, proof:{…, generation}}`。
- **`recoveryProofMatches(left, right)`**（2427）、**`blockedPreflight`**（2433）、**`preflightTarget(sessionId, expectedRevision)`**（2458）：`applyEngine.preflight` 后按 `changedFiles` 空 → `already_in_local`、`localHeadOid !== baseOid` → `local_advanced`、否则 `ready`。
- **`operatePreview`**（2538）：legacy 门之后写 journal `planning`，`plan` 冲突则回 `ready` 并用 `explainApplyConflict` 返回 `apply_conflict`；`writing_local` 阶段在 `beforeWrite` 内 `retainPreviewArtifacts` + delivery `preview_active` + journal `artifacts_retained`；成功返回 `{status:'previewed'}`。
- **`detachPreviewAfterLocalDrift`**（2690）：`preview_active` → `preview_detached`。
- **`operateRollbackPreview`**（2729）：detached 恢复需 `recoveryProofMatches` + `proof.rollback.status === 'safe'`；成功按 `resumeRevision` 回 `working` 或 `ready_for_review`。
- **`retainFinalized(record, retention)`**（2836）：`finalized` → `retained`，写 `retention`/`retainedAt`/`expiresAt`/`cleanup:'scheduled'`。
- **`collectEmptyManagedContainer(managedGitRoot, excludedCheckoutId)`**（2868）。
- **`cleanupFinalized(record, {allowLegacyResidue?})`**（2884）：非 `finalized`/`retained` 直接 `directory_busy`；`identity_changed` 直接复述；`hasLegacyCleanupResidueEvidence` 且 `managedGitRoot` 仍在 → `detached_residue`；`beginRemoval` 写 journal `{operation:'cleanup', step:'removing_worktree', …}`；`quarantineAndRemove` 走 `.dsh-wt-cleanup--…` 隔离目录；`removeWorktree` 后若目录仍在，转 `validateDetachedCleanupResidue` + 隔离链；收尾 `collectEmptyManagedContainer`、`releaseApplyBaseBestEffort`，并把记录写成 `phase:'discarded'` + `delivery.state:'delivered'`；`catch` 打 `console.warn('[session-checkout] finalized Worktree cleanup failed:', error)`，`finalized` 记 `cleanup:'pending'`、`retained` 记 `cleanup:'blocked'`。
- **`operateFinalizePreview`**（3071）：`preview_detached` 时先验 `proof.finalize.status === 'safe'`，再走 legacy 门；`applyEngine.finalize` 的 `beforeCommit` 写 journal `updating_ref` + `commitOid`；成功写 `delivery.state:'finalized'` 与 `proof`，`retention !== 'cleanup'` 走 `retainFinalized`，否则 `cleanupFinalized`。
- **`operateRetryCleanup`**（3217）：仅 `finalized`/`retained` 可重试。
- **`operateFinish`**（3244）：见下节「会话分支交付链」。
- **`releaseApplyBaseBestEffort(record)`**（3481）：释放 apply base 与内部 artifact，失败只 `console.warn`。
- **`operateDiscard`**（3491）：`preview_active` 需 `rollbackPreview` 或拒绝；`recovery_required` 且目录已消失 → 直接 `discarded`；`ready` 且目录连同 git 顶层都没了 → prune + 清台账；脏工作树需 `confirmDirty`，并先 `snapshotAbandonedWorktree` 固化放弃快照，快照失败则中止放弃。
- **`operateRecover`**（3657）：终态记录（`delivered`/`discarded`/`finalized`/`retained`）不允许被 Recover 复活；`journal.operation === 'create'` 且有 creation 证据 → `recovery_unsafe`；有 journal 时先 `reconcile()` 收敛再判断。
- **`operateTarget`**（3721）：按 `action` 分发（`apply`/`finish`/`preview`/`checkpoint`/`rollback_preview`/`finalize_preview`/`retry_cleanup`/`discard`/`recover`），`SessionCheckoutError` 转 `operationError`。

### 会话分支交付链（`operateFinish`，3244）

1. 身份与前置校验：owner → 只接受 isolated → `commitMessage` trim 非空且 ≤500 → `checkout_missing` → `stale_target` → `expectedReviewId` 不符 → `stale_target`。
2. **历史 wrote-to-Local 记录**（`record.applyBaseOid && (state === 'working' || state === 'ready_for_review')`）→ `operation_not_allowed`。
3. 状态门：`phase !== 'ready'` 或 `preview_active`/`preview_detached` → `operation_not_allowed`；项目验收槽被占 → `project_acceptance_busy`；`inspectIsolated` 后 `phase` 非 `ready` → `recovery_required`。
4. 引擎能力探测：`reviewIsolated` / `commitIsolated` 缺失 → `operation_not_allowed('thisVersionCannotDeliverToASessionBranch')`。
5. 写 journal `{operation:'finish', step:'committing_session_branch', baseOid: applyBaseOid}`。
6. **`ensureSessionBranch(mutating)`**（799 调用）；失败 → `restoreReady()` + 错误。`branchRef = deliverable.sessionBranch ?? null`。
7. `reviewIsolated({isolatedPath: deliverable.managedRoot, baseOid: applyBaseOid})`；`expectedReviewId` 下任一不符 → 回 `working` + `stale_isolated`。
8. 沿用 `ready_for_review` 的 review，否则现造一个。
9. **`commitIsolated({isolatedPath, baseOid, commitMessage, branchRef})`**；失败 → `restoreReady()`。
10. 写 `delivery.state:'finalized'` 与 `proof`：`localBranch: branchNameOf(branchRef)`、`localHeadBefore/After` 等。
11. 自动 push：`(liveConfigValue(dependencies.autoPush) ?? true) && dependencies.git.pushBranch` → `pushLocalBranchBestEffort`（推的是**会话分支**）。
12. 收尾：`retention !== 'cleanup'` 走 `retainFinalized`，否则 `cleanupFinalized`；两者都带 `branch` 与 `push`。

### 清理资格、列表与管理

- **`managedIteration`**（3741）、**`managedUpdatedAt`**（3746）。
- **`summarizeManagedWorktree(record, includeDiagnostics = false)`**（3756）：快速列表保守且不扫 Git/磁盘；`includeDiagnostics` 时才算 dirty、残留、字节数；`state` 由 `staleRoot` / `phase` / `delivery.state` 组合得出。
- **`cleanupBlocked(reason, message, revision)`**（3849）、**`inspectCleanupForRecord(record)`**（3853）：按 `delivery.state` 与指纹给出 `safe` / `retained` / `blocked` 及结构化原因。
- **`inspectManagedWorktreeCleanup`**（3909）、**`bulkCleanupManagedWorktrees`**（3923，逐条 CAS 后 `cleanupFinalized`）、**`listManagedWorktrees`**（3974）、**`listManagedWorktreesForSession`**（3985）。
- **`pruneMergedBranchesInRepo`**（4008）：只删「已完全合并」的本地分支；主干名从 `origin/HEAD` → `init.defaultBranch` 推断；`olderThanDays` 需 `branchTipTimes`，端口缺该能力时直接拒绝。
- **`pruneMergedBranchesForSession`**（4075）、**`autoPruneStaleMergedBranches`**（4098）。
- **`mergeBranchForSession(sessionId, input)`**（4120）：先注册 `record.sessionBranch`，再补各 Worktree 的当前分支；来源分支等于 Local 当前分支直接 `invalid_input`；**分支找不到时区分**「属于另一个会话 X 的分支」（`not_owner`）与「不属于本会话」；真实合并（非 dryRun）前检查项目验收槽；`direction === 'reverse'` 把 Local 当前分支合进任务 worktree。
- **`listAbandonedWorktreeSnapshots`**（4198）、**`restoreAbandonedWorktreeSnapshot`**（4216）。
- **`manageManagedWorktreeForSession`**（4241）、**`manageManagedWorktree`**（4262，`discard` / `set_retention` / `set_permanent` / `clear_sidebar_badge` / 清理）。
- **`observeManagedCheckout`**（4341）、**`observeManagedCheckouts`**（4350）、**`resolveManagedRoot`**（4354）、**`resolveRoots`**（4363）。
- **`retryableCleanupBlock`**（4374）、**`cleanupExpiredRetained(now)`**（4380）、**`enforceWorktreeKeepCount()`**（4408）：`permanent` 与进行中记录豁免，只逐出最旧的 `finalized`/`retained`，且必须走 `cleanupFinalized`。
- **`beginNextIterationTarget(sessionId, expectedRevision)`**（4432）：要求 predecessor 已是 `discarded`+`delivered`、owner 与 cwd 归属匹配、旧路径未复活、Local 项目与 git 身份未变；**迭代以「上一轮会话分支 tip」为 `iterationBaseOid`**（`branchNameOf(predecessor.sessionBranch) ?? branchNameOf(predecessor.sourceRef)` → `resolveLocalBranchTip`），解析不到才退回 `snapshot.headOid`；重建后 `attachSessionBranch` 重新挂会话分支并同步 `sourceRef`/`sessionBinding.sourceRef`。
- **`copyWorktreeincludeFiles`**（4647）、**`carryLocalWorkInProgress`**（4675）、**`repairStaleWorktreeLinks`**（4703）。
- **`bindTarget(sessionId, choice, createAttempt, requestStartedAt, sourceSessionId, createOptions)`**（4738）：创建路径在 `createDetachedWorktree` 成功后立即 `attachSessionBranch`（743），`readyRecord` 同时写 `sessionBranch` 与 `sourceRef` 为同一个 branch ref，`binding.sourceRef` 同步；失败按 `WorktreeCreationFailure` / 残留是否清掉决定 `markRecoveryRequired` 还是重试。

### 工厂返回的公开接口（5076-5175）

| 成员 | 行号范围 | 说明 |
| --- | --- | --- |
| `inspect` | 5076-5175 | → `inspectAvailable` |
| `runtimeContext` | 5076-5175 | 模型运行时指引 |
| `preflight` | 5076-5175 | 加锁 → `preflightTarget` |
| `preflightPreviewRecovery` | 5076-5175 | `allowConcurrentInspect: true` |
| `runExclusiveSessionMutation` | 5076-5175 | 独占变更包装 |
| `bind` | 5076-5175 | 加锁 → `bindTarget` |
| `createIsolatedTarget` | 5076-5175 | in-place 与独立会话两种形态 |
| `beginNextIteration` | 5076-5175 | 下一轮迭代 |
| `resumeRevision` | 5076-5175 | 恢复编辑 Review |
| `prepareReviewRegeneration` | 5076-5175 | `stale_isolated` 时重出 Review |
| `preparePreviewRecoveryAnalysis` | 5076-5175 | 预览恢复分析 |
| `createPreviewRecoveryHandoff` | 5076-5175 | 预览恢复移交 |
| `markReadyForReview` | 5076-5175 | 标记 Review |
| `operate` | 5076-5175 | 操作分发 |
| `isAutoDeliverEnabled` | 5076-5175 | 暴露 autoDeliver 实时取值 |
| `listManagedWorktrees` / `listManagedWorktreesForSession` | 5076-5175 | 只读列表，不加全局锁 |
| `pruneMergedBranchesForSession` / `autoPruneStaleMergedBranches` | 5076-5175 | 分支修剪 |
| `mergeBranchForSession` | 5076-5175 | 合并会话分支 |
| `listAbandonedWorktreeSnapshots` / `restoreAbandonedWorktreeSnapshot` | 5076-5175 | 放弃快照 |
| `manageManagedWorktreeForSession` | 5076-5175 | 受限管理工作台 |
| `inspectManagedWorktreeCleanup` | 5076-5175 | 清理资格检查 |
| `bulkCleanupManagedWorktrees` / `manageManagedWorktree` | 5076-5175 | 批量清理与管理工作台 |
| `resolveManagedRoot` / `resolveRoots` | 5076-5175 | 路径解析 |
| `observeManagedCheckout` / `observeManagedCheckouts` | 5076-5175 | 纯读观察 |
| `cleanupExpiredRetained` / `enforceWorktreeKeepCount` | 5076-5175 | `allowConcurrentInspect: true` |
| `reconcile` | 5076-5175 | `allowConcurrentInspect: true` |

### 类型定义（src/types.ts）

- **`SessionTargetRef`**（11-14）：`unselected` | `local` | `isolated{checkoutId}`。
- **`SessionCheckoutKind`**（16）、**`SessionCheckoutPhase`**（18-27）：`preparing` / `ready` / `applying`（弃用）/ `mutating` / `recovery_required` / `finalized` / `retained` / `discarded`。
- **`WorktreeValidationStatus`**（29）：`passed` / `failed` / `partial` / `not_run`。
- **`WorktreeRetentionMode`**（32）：`cleanup` / `retain_24h` / `retain_3d` / `retain_manual`；**`DEFAULT_WORKTREE_RETENTION`**（39）= `retain_24h`。
- **`WorktreeCleanupReason`**（41-46）：`directory_busy` / `modified_after_finalize` / `identity_changed` / `detached_residue` / `quarantine_busy`。
- **`WorktreeValidationItem`**（48-52）：`command`、`status`、`summary?`。
- **`WorktreeCheckpointView`**（55-63）：`checkpointId`、`sequence`、`reviewId`、`createdAt`、`summary`、`validationStatus`、`changedFiles`。
- **`WorktreeReviewView`**（65-77）：`reviewId`、`iteration`、`preparedAt`、`detailsMarkdown?`、`summary`、`validationStatus`、`validationSummary?`、`tests`、`changedFiles`、`suggestedCommitMessage`。
- **`WorktreeDeliveryProofView`**（79-90）：`localBranch`、`localHeadBefore`、`localHeadAfter`、`changedFiles`、`validationStatus?`、`validationSummary?`、`commitInLocalHistory`。会话分支交付后 `localBranch` 记的是**会话分支名**。
- **`WorktreeDeliveryView`**（92-127）：7 种状态联合——`working{iteration}`、`ready_for_review{review}`、`preview_active{review, previewedAt}`、`preview_detached{review, previewedAt, detachedAt, reason, attemptedAction}`、`finalized{review, commitOid, proof?, cleanup, cleanupMessage?, cleanupReason?}`、`retained{…, retention, retainedAt, expiresAt, cleanup:'scheduled'|'blocked', …}`、`delivered{iteration, commitOid, proof?, deliveredAt}`。
- **`WorktreeApplyPreflightBlockedReason`**（129-137）：`not_owner` / `not_ready_for_review` / `stale_target` / `stale_local` / `stale_isolated` / `project_acceptance_busy` / `checkout_unavailable` / `git_error`。
- **`WorktreeApplyPreflightFacts`**（139-150）：`checkoutId`、`reviewId`、`revision`、`configuredBaseOid`、`effectiveBaseOid`、`baseStrategy`、`localBranch`、`localHeadOid`、`isolatedHeadOid`、`changedFiles`。
- **`WorktreeAcceptanceBlockerView`**（152-157）：`checkoutId`、`ownerSessionId`、`revision`、`state`。
- **`WorktreeApplyPreflightView`**（159-172）：`ready`/`local_advanced`/`already_in_local` | `conflict{conflictingFiles, conflictDetails?}` | `blocked{reason, message, blocker?}`，三者都带 `localModified: false`。
- **`SessionTargetProjectView`**（174-177）、**`SessionTargetCheckoutView`**（179-184）、**`SessionTargetSourceView`**（186-190）、**`SessionTargetCurrentView`**（192-196）。
- **`SessionTargetView`**（198-216）：`project`、`checkout`、`source`、`current`、`ownership`、`dirty`、`revision`、`delivery?`、`checkpoints?`、`checkpointGeneration?`、`reviewSlot?`、`reviewSlotOwnerSessionId?`。
- **`SessionTargetBindChoice`**（218-220）。
- **操作接口**（227-340）：`SessionCheckoutApplyOperation`(227)、`SessionCheckoutFinishOperation`(231,含 commitMessage/retention/expectedReviewId)、`SessionCheckoutPreviewOperation`(239)、`SessionCheckoutCheckpointOperation`(243,含 commitMessage/expectedReviewId/expectedGeneration/requestId)、`WorktreePreviewRecoveryProof`(273,含 generation/receiptFingerprint 等)、`SessionCheckoutRollbackPreviewOperation`(314)、`SessionCheckoutFinalizePreviewOperation`(322)、`SessionCheckoutRetryCleanupOperation`(330)、`SessionCheckoutDiscardOperation`(334)、`SessionCheckoutRecoverOperation`(340)；`SessionCheckoutOperation`(344-353) 联合上述。
- **结果类型**：`SessionCheckoutAppliedResult`(355)、`Previewed`(361)、`Checkpointed`(367)、`PreviewRolledBack`(374)、`PreviewDetached`(380)、`WorktreePushOutcome`(389)、`SessionCheckoutFinishedResult`(394,含 branch/cleanup/push)、`ManagedWorktreeCleanupView`(426)、`BulkCleanupManagedWorktreeCandidate`(433)、`ManagedWorktreeSummaryView`(453, path-free 投影)、`PruneMergedBranchEntry`(483)、`PruneMergedBranchesView`(489)、`AbandonedWorktreeSnapshotView`(497)。
- **`ApplyBaseStrategy`**(505)、**`ApplyConflictDetail`**(510)、**`CONFLICT_DETAIL_FILE_LIMIT=6`**(517)、**`CONFLICT_DETAIL_DIFF_LIMIT=4096`**(518)、**`MergeLocalBranchOutcome`**(520)、**`MergeLocalBranchResult`**(522)、**`MergeBranchForSessionView`**(531)。
- **`ApplyConflictReason`**(548)：`content_conflict` / `local_dirty` / `untracked_conflict`。
- **`SessionCheckoutConflictResult`**(550)、`Discarded`(568)、`Recovered`(573)、`SessionCheckoutOperationErrorResult`(578)、`SessionCheckoutOperationResult`(585-595)。
- **`SESSION_CHECKOUT_ERROR_CODES`**(597-627) 及 **`SessionCheckoutErrorCode`**(629)、**`SessionCheckoutFailure`**(631-634)。

### 端口契约（src/ports.ts）

- **`SessionCheckoutSessionRecord`**(21-26)、**`SessionCheckoutProjectRecord`**(28-32)、**`SidebarDirectoryMembership`**(34-38)、**`SessionCheckoutLookupPort`**(40-45)。
- **`GitCheckoutSnapshot`**(47-54)：`root`、`commonDir`、`gitDir`、`branch`、`headOid`、`headRef`。
- **`BranchOverviewEntry`**(57-62)、**`GraphLogCommit`**(65-73)、**`InitialCommitPreflight`**(75-79)。
- **`SessionCheckoutGitPort`**(81-179)：大量可选方法，如 `inspect`/`findContainingWorktreeRoot`/`status`/`createDetachedWorktree`/`attachWorktreeBranch?`(103)/`removeWorktree`/`retainInternalArtifact`/`readInternalArtifact`/`isAncestor`/`pushBranch?`/`repairWorktreeLinks?`/`pruneWorktrees?`/`branchOverview?`/`defaultBranch?`/`branchTipTimes?`/`deleteLocalBranch?`/`mergeLocalBranch?`/`captureLocalWip?`/`applyWorktreePatch?`/`listUntrackedFiles?`/`snapshotAbandonedWorktree?`/`restoreAbandonedSnapshot?` 等。
- **`DirectoryIdentity`**(181-185)：`device`/`inode`/`birthtimeNs`。
- **`SessionCheckoutFilesPort`**(187-204)：`exists`/`canonicalize`/`inspectDirectoryIdentity`/`ensureDirectory`/`removeEmptyDirectoryTree`/`quarantineDirectoryTree`/`removeDirectoryTree`/`measureDirectoryBytes` 等。
- **`SessionBindingRecord`**(206-216)：`sessionId`、`projectId`、`projectName`、`target`、`ownerSessionId`、`inheritedFromSessionId?`、`sourceRef`、`sourceOid`、`revision`。
- **`WorktreeCreationEvidence`**(223-235)、**`ManagedCheckoutCreateJournal`**(237)、**`ManagedCheckoutMutationJournal`**(243，含 operation step 枚举及众多可选字段如 cleanupQuarantinePath)、**`ManagedCheckoutJournal`**(280)。
- **`ManagedWorktreeCheckpointRecord`**(282)、**`ManagedWorktreePreviousReviewRecord`**(302)、**`ManagedWorktreeReviewRecord`**(310)、**`ManagedPreviewReceipt`**(325)、**`ManagedDeliveryProof`**(346)。
- 恢复续传类型：`ManagedApplyConflictRecoveryContinuation`(356)、`ManagedReviewRegenerationContinuation`(366)、`ManagedPreviewRecoveryAnalysisContinuation`(373)、`ManagedPreviewRecoveryHandoffContinuation`(382)、`ManagedRecoveryContinuation`(392)。
- **`ManagedCheckoutDelivery`**(398-434)：与 `WorktreeDeliveryView` 对应的持久化形态。
- **`ManagedCheckoutRecord`**(436-489)：核心持久化记录，含 `checkoutId`/`predecessorCheckoutId?`/`localRoot`/`managedRoot`/`managedGitRoot`/`gitCommonDir`/`baseOid`/`applyBaseOid?`/`checkpoints?`/`sessionBranch?`/`sessionTopic?`/`phase`/`delivery`/`journal`/`revision` 等。
- **`ManagedCheckoutsRegistry`**(491-496)：version=2, sessionBindings, managedCheckouts。
- **`SessionCheckoutRegistryPort`**(498-501)。
- **`LiveValue<T>`**(504) 与 **`liveConfigValue<T>`**(509-514)。
- **`SessionCheckoutDependencies`**(516-548)：聚合 lookup/git/files/registry/applyEngine/managedCheckoutsRoot/createCheckoutId 及可选 live 配置 autoPush/autoDeliver/worktreesRoot/inheritLocalChanges/worktreeKeepCount。

### 支撑模块

- **`checkpoint.ts`**：
  - `canonicalJson` (4-13，内部) 规范化 JSON 串。
  - `checkpointGenerationForRecord(record: ManagedCheckoutRecord): string | undefined` (16-29)：仅当 delivery.state 为 ready_for_review 或 preview_active 时，对 checkoutId/revision/reviewId/isolatedHeadOid/isolatedFingerprint/checkpointCount/previewId/phase 做 sha256 生成 CAS generation；否则 undefined。
- **`creation-failure.ts`**：
  - `export class WorktreeCreationFailure extends Error` (2-7)：构造 `(message: string, readonly rolledBack: boolean)`，标识创建失败是否已回滚，防止误判空路径安全。
- **`managed-worktree-path.ts`**：
  - 常量 `WINDOWS_INVALID_CHARACTERS`(4)、`WINDOWS_RESERVED_NAME`(5)、`REPEATED_DASHES`(6)、`MAX_LABEL_LENGTH=40`(7)、`DEFAULT_IDENTITY_LENGTH=8`(8)
  - `truncateCodePoints` (10-12)
  - `sanitizeManagedWorktreeLabel` (15-29)：仓库名转安全目录段
  - `checkoutIdentity` (31-35)
  - `createManagedWorktreeRepositoryKey` (38-40)：对 canonicalGitRoot 做 sha256 取前12位
  - `sanitizeBranchSegment` (46-55)
  - `createSessionBranchCandidates` (63-75)：生成 `feat/sess-<session>[--topic]` 及 -2/-3 递增候选
  - `createManagedWorktreeDirectoryName` (78-86)：`<repoLabel>--<identity>--worktree`
  - `ManagedWorktreePathCandidates` (88-93)：sibling/fallback container/root
  - `createTopicManagedWorktreeDirectoryName` (101-112)：`<topic>-<date>[-<id>]`
  - `createTopicDateStamp` (115-120)：本地 YYYYMMDD
  - `createManagedWorktreePathCandidates` (132-175)：根据 worktreesRoot 是否设置决定容器位置，返回候选路径供调用方探测不存在者。

## Architecture

```text
┌──────────────────────────────────────────────────────────────────────┐
│              createSessionCheckoutModule (session-checkout-module)    │
│                                                                       │
│  ┌─────────────┐   ┌──────────────┐   ┌───────────────────────────┐  │
│  │ bind/create │   │ operate*     │   │ list / manage / prune     │  │
│  │ bindTarget  │   │ preview      │   │ summarizeManagedWorktree  │  │
│  │ 4738        │   │ finish       │   │ inspectCleanupForRecord   │  │
│  │             │   │ 3244         │   │                          │  │
│  └──────┬──────┘   │              │   └─────────────┬─────────────┘  │
│         │          └──────┬───────┘                 │                │
│         └────────► withBindingLock (1194) ◄─────────┘                │
│                     exclusive / maintenance / draining                │
│                            │                                          │
│         ┌──────────────────┼──────────────────┬────────────────────┐ │
│         ▼                  ▼                  ▼                    ▼ │
│  ┌────────────┐  ┌────────────────┐  ┌──────────────┐  ┌──────────┐ │
│  │ 身份校验    │  │ applyEngine    │  │ registry     │  │ git port │ │
│  │ validate*  │  │ plan/preview/  │  │ v2 读写      │  │ branch/  │ │
│  │ 586-695    │  │ finalize/      │  │ 1575         │  │ worktree │ │
│  │            │  │ reviewIsolated │  │              │  │ 端口 81+ │ │
│  │            │  │ commitIsolated │  │              │  │          │ │
│  └────────────┘  └────────────────┘  └──────────────┘  └──────────┘ │
│                                                                       │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ 会话分支层 attachSessionBranch(743) ensureSessionBranch(799)    │  │
│  │ refuseLegacyLocalWrite(1561)  ──► 交付只写 refs/heads/feat/…    │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

## Data Flow

1. **绑定与创建**：`bind` / `createIsolatedTarget` 经 `bindTarget`（4738）解析项目与 git 快照、生成路径候选、写入 `preparing` 记录与 binding、`createDetachedWorktree` 后复验 git 身份，随后立即 `attachSessionBranch`（743）把 Worktree 挂到 `feat/sess-<会话>[--<主题>]`，`sessionBranch` 与 `sourceRef` 同写该 ref，记录转 `ready`。
2. **编辑与检查点**：改动只发生在 Worktree。`checkpoint`（`operateCheckpoint` 1672）用 `requestId` 幂等 + `expectedGeneration` CAS，在 `refs/…/checkpoints/<id>` 上留证，提交后回 `working`。
3. **Review 与 Preview**：`markReadyForReviewTarget`（1589）固化 review 指纹；`operatePreview`（2538）在 receipt 保护下把改动写进 Local，`beforeWrite` 内先留工件再置 `preview_active`。Local 一旦漂移，预览进入 `preview_detached`（2690），需要 `preflightPreviewRecoveryTarget`（2339）生成的 proof 才能继续。
4. **交付（只写会话分支）**：`operateFinish`（3244）先 `ensureSessionBranch`（799），再 `reviewIsolated` + `commitIsolated(branchRef)`，`proof.localBranch` 记会话分支名，自动 push 也推会话分支，Local 的三个面全程不读写。旧的 `operateApply` / `operatePreview` / `operateFinalizePreview` 在存在 `sessionBranch` 时被 `refuseLegacyLocalWrite`（1561）拒绝并指向 `worktree_deliver`。
5. **合并**：`mergeBranchForSession`（4120）先认 `record.sessionBranch`，拒绝把 Local 自身分支当来源，并区分「别的会话的分支」；真实合并前检查项目验收槽，冲突现场留给用户解决。
6. **保留与清理**：`finalized` 可 `retain_*` 冻结环境（默认 `retain_24h`），或直接 `cleanupFinalized`（2884）删除目录；目录身份不符/交付后又有改动会被挡成 `identity_changed` / `modified_after_finalize`；到期由 `cleanupExpiredRetained`（4380）、总量由 `enforceWorktreeKeepCount`（4408）收口。
7. **崩溃恢复**：启动或显式 `recover` 时 `reconcile()`（1267）按 journal step 前进或回退（`committing_session_branch` 属交付链，被视作可能已产生提交，收敛为 `recovery_required` 而不是草率回 `ready`）。

## Connections

- [[session-checkout-apply]]：`applyEngine` 的实现，提供 `plan` / `preflight` / `preview` / `rollback` / `finalize` / `recoverCheckpoint` / `inspectReview` / `reviewIsolated` / `commitIsolated`。
- [[managed-worktree-path]]：会话分支名候选与 Worktree 目录/路径候选生成，`createSessionBranchCandidates` 是 `attachSessionBranch` 的唯一取名来源。
- [[registry]]：`ManagedCheckoutsRegistry` 的持久化与原子写入。
- [[git-port]]：`SessionCheckoutGitPort` 适配器，`attachWorktreeBranch` / `resolveLocalBranchTip` / `mergeLocalBranch` 是会话分支语义的底层支点。
- [[file-port]]：`SessionCheckoutFilesPort`，目录身份、隔离与删除能力。
- [[session-management]]：`lookup` 端口提供会话与项目记录，决定 owner 与 cwd 归属判定。
- [[host-messages]]：所有面向用户的文案键与持久化清理文案的映射表。

## Known Issues

- **detached 兼容残留**：端口不实现 `attachWorktreeBranch` 时，`attachSessionBranch`（743）与 `ensureSessionBranch`（799）都只 warn 并退回旧行为，此时 `record.sessionBranch` 永不写入。
- **历史记录仍可写 Local**：`refuseLegacyLocalWrite`（1561）只对存在 `sessionBranch` 的记录生效，因此旧版本创建、无会话分支的记录仍可走 `operateApply` / `operatePreview` / `operateFinalizePreview` 写回 Local；`operateFinish`（3244）对这类 wrote-to-Local 中间态另有显式拒绝。
- **迭代基点会退化**：`beginNextIterationTarget`（4432）用 `resolveLocalBranchTip` 找上一轮会话分支 tip，找不到（分支被删/改名）就退回 Local 的 `headOid`，上一轮内容会在迭代链上断开——源码注释已点明这一点。
- **`operateFinish` 重读记录只校验 phase**：`ensureSessionBranch` 之前那次 registry 重读只判 `phase !== 'ready'`，不再比 `revision`，并发窗口依赖 `withBindingLock`（1194）与 `updateManagedCheckout`（1575）的 CAS 兜底。
- **清理失败原因被折叠**：`cleanupFinalized`（2884）的 `catch` 把所有异常降级成 `quarantine_busy` / `directory_busy` 的 `pending`/`blocked`，不区分底层错误类型，只能靠 `console.warn('[session-checkout] finalized Worktree cleanup failed:', error)` 定位。
- **`retain_24h` 是默认值**：调用方未显式给 `retention` 时（`DEFAULT_WORKTREE_RETENTION`，src/types.ts:39）冻结环境会留一天，磁盘占用与 `approximateBytes` 会持续到到期清理。
- **旧写回校验仍在**：`inspectCleanupForRecord`（3853）在 `commit + proof` 时仍用 `validateCommittedLocalCheckout` + `isAncestor` 验证交付提交在 Local 历史里，这是写回语义的遗留；会话分支交付的提交不在 Local 历史中，该分支逻辑对这类记录不再成立。
- **双轨记录共存**：`ManagedCheckoutDelivery`（src/ports.ts:398-434）与 `ManagedWorktreeCleanupView`（src/types.ts:426）仍需兼容旧 registry 形态（`cleanupReason` 可选、`persistedCleanupReason` 回退文案映射），新旧记录在同一份台账里语义不完全一致。