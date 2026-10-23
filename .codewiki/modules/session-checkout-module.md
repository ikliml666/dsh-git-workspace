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

`createSessionCheckoutModule`（src/session-checkout-module.ts:234-236，工厂体延伸到 `return { … }` 的 5077-5176）是插件核心：一套从 Domi 移植来的 session-checkout 状态机（模块头注释 src/session-checkout-module.ts:234-240），保留 receipt-first Local Preview、回滚/finalize、项目验收槽、崩溃恢复与 fingerprint CAS，同时把所有权适配到 Harness 分离的 source Local Session 与 target owner Session。全部持久化状态落在 `ManagedCheckoutsRegistry`（version 2，src/ports.ts:491-496）。

当前版本最关键的语义变化是**交付不再写回 Local**：每个受管 Worktree 在创建阶段就挂到属于自己会话的分支（`refs/heads/feat/sess-<会话>[--<主题>]`），`worktree_deliver` / `finish` 只在这条会话分支上提交，Local 的工作区、索引与 HEAD 全程不被读写；合并由 `worktree_merge` 显式发起。为此模块新增了 `branchNameOf`（src/session-checkout-module.ts:230 起）、`attachSessionBranch`（745-786）、`ensureSessionBranch`（801-851）、`refuseLegacyLocalWrite`（1563-1575）与 `explainApplyConflict`（1533-1554）。同一语义已延伸到验收侧：`markReadyForReviewTarget`（1591-1673）在 `inspectReview` 之前先 `ensureSessionBranch`，让验收指纹记录交付期真实的 HEAD 身份（详见「生命周期操作」）。

## Overview

模块管理「受管 Worktree」（Managed Worktree）的全生命周期：绑定会话、创建、检查点（Checkpoint）、预览（Preview）、Review、交付（Deliver/Finish）、保留（Retain）与清理（Cleanup）。三个机制贯穿始终：

- **互斥**：所有变更操作经 `withBindingLock`（src/session-checkout-module.ts:1196-1231）串行化；maintenance 模式允许只读 `inspect` 并发旁路，但必须先关闭旁路并排空已启动的 inspect。
- **崩溃恢复**：`record.journal` 记录可重放的 receipt，`reconcile()`（1269-1516）按 journal 的 step 把记录确定性收敛到 `ready` 或 `recovery_required`。
- **CAS / 指纹**：`revision`、`isolatedFingerprint`、`reviewId`、`generation` 共同构成乐观并发校验；Preview 用 receipt 记录写入前后的 Local 指纹，任何漂移都让预览进入 `preview_detached`。

本地适配特性（相对 Domi 原版）：

- **会话分支交付**：创建即挂分支，交付只提交会话分支（745-772、3338-3342、3405-3410）。
- **自动推送**：Finish 成功后尽力推送**会话分支**（`pushLocalBranchBestEffort`，src/session-checkout-module.ts:126-137；调用点 3450-3453），失败降级为「已跳过」备注。
- **仓库移动修复**：`git worktree repair` 重连断链 Worktree（`repairStaleWorktreeLinks`，4704-4737）。
- **Worktree 根目录配置**：`worktreesRoot` + 主题命名（路径候选生成在 `createManagedWorktreePathCandidates`，src/managed-worktree-path.ts:132-175）。
- **继承未提交修改**：`carryLocalWorkInProgress`（4676-4702），仅当基点等于 Local HEAD 时生效。
- **放弃快照**：带未提交内容放弃前固化快照（3597-3612 附近，见 `operateDiscard` 3492-3656）。
- **常驻标记**：`permanent` 豁免保留期到期清理与 LRU 逐出（4409-4431）。

## Key Components

### 模块级常量与工具函数（src/session-checkout-module.ts）

- **`UNVERSIONED_OID` / `UNVERSIONED_REF`**（88-89）：未版本化项目的伪 OID 与伪 ref（`'unversioned'` / `'WORKING_TREE'`）。
- **`RETENTION_24H_MS` / `RETENTION_3D_MS`**（90-91）：保留期时长。
- **`CLEANUP_IDENTITY_CHANGED_MESSAGE`**（92）、**`CLEANUP_RESIDUE_MESSAGE`**（93）：清理被身份变更/残留证据挡住时的固定文案。
- **`TRANSIENT_CLEANUP_RETRY_DELAYS_MS`**（94）：`[100, 300, 800]`。
- **`CHECKOUT_CLEANUP_TIMEOUT_MS`**（103）：`120_000`，Windows 文件占用下防止清理无限挂起。
- **`withCleanupTimeout(checkoutId, operation)`**（105-123）：给清理/收敛加 120s 兜底超时。
- **`pushLocalBranchBestEffort(push, localRoot)`**（126-137）：尽力推送，返回 `WorktreePushOutcome`，异常降级为 note。
- **`cleanupReasonForMessage(message)`**（139-147）：把历史清理文案映射回结构化 `WorktreeCleanupReason`。
- **`persistedCleanupReason(delivery)`**（153-158）：优先读结构化 `cleanupReason`，否则回退文案映射。
- **`isTransientCleanupError(error)`**（160-167）：识别 `EBUSY` / `EPERM` / `ENOTEMPTY` / `EACCES` 等瞬时错误。
- **`retryTransientCleanup(operation)`**（169-181）：按 `TRANSIENT_CLEANUP_RETRY_DELAYS_MS` 退避重试。
- **`retentionExpiresAt(retention, retainedAt)`**（183-187）：保留到期时间戳；`retain_manual` 为 `null`。
- **`pathForIdentity(root)`**（189-195）：去掉尾部分隔符的规范化路径，仅用于身份比较。
- **`pathsEqual(left, right)`**（197-203）：大小写/分隔符归一后比较。
- **`resolvedPathsEqual(left, right)`**（206-212）：canonical 路径与 registry 原始路径比较，**不做 realpath**，防止 Junction 冒充。
- **`pathIsWithin(parent, child)`**（219-227）：判断包含关系。
- **`branchNameOf(ref)`**（230-232）：`refs/heads/x` → `x`；其他 ref（含 detached 的 `HEAD`）返回 `null`。会话分支名一律经它从 ref 取出。

### 工厂内基础件

- **`requireSession(sessionId)`**（237-241）、**`resolveSessionProject(sessionId)`**（243-252，缺项目根时抛 `project_root_missing`）。
- **`inspectLocal(binding)`**（254-280）：Local 目标视图。
- **`projectPreviousReview(record)`**（282-293）：`suggestedCommitMessage` 截断 500、`changedFiles` 截 50。
- **`projectCheckpoint(record)`**（295-305）。
- **`projectDelivery(record, commitInLocalHistory)`**（307-372）：按 `delivery.state` 投影 review/preview/proof/cleanup 视图。
- **`bindingForManagedRecord(record)`**（374-387）：从托管记录合成绑定记录。
- **`recoveryView(binding, record?, dirty)`**（389-412）：`phase` 为 `discarded` 时保持 `discarded`，否则 `recovery_required`。
- **`validateCommittedLocalCheckout(binding, record)`**（414-436）、**`committedFollowupView(binding, record)`**（438-485）：commit 是权威事实，残余环境异常只影响 cleanup，不把会话降级。
- **`saveCreationEvidence`**（487-496）、**`finishFailedCreation(sessionId, checkoutId, error, previous?)`**（498-521）、**`markRecoveryRequired(record)`**（523-538）。
- **`checkpointHeadInvariantHolds(record)`**（552-586）：结构校验 + 并行取证（`readInternalArtifact` / `isAncestor`）验证检查点链。
- **`validateManagedCheckoutDetailed(binding, record, requireCreateBase)`**（588-644）：多重身份判定——binding 四元组、`managedRoot`/`managedGitRoot`/`localRoot` 的 realpath 比较、`gitCommonDir`、`gitDir`；`requireCreateBase` 时要求 `headOid === baseOid`，否则校验检查点不变式；`catch` 返回 `unavailable`，避免瞬时 I/O 把健康 Worktree 判成 `recovery_required`。
- **`validateManagedCheckout`**（646-653）：上面函数的薄包装，只取 valid/invalid。
- **`directoryIdentitiesEqual`**（660-662）、**`hasCleanupRemovalReceipt`**（664-668）、**`hasLegacyCleanupResidueEvidence`**（670-677）、**`validateCleanupLocalIdentity`**（679-695）、**`validateDetachedCleanupResidue`**（697-735）：清理链的身份与残留取证。
- **`validateCleanupQuarantine(record)`**（853-870）：校验隔离目录身份（目录名形如 `.dsh-wt-cleanup--<checkoutId 前 8 位>--<operationId>`）。

### 会话分支：交付目标的建立与保护

- **`attachSessionBranch({localRoot, managedRoot, sessionId, topic})`**（745-786）：把新建/重建的 Worktree 从 detached HEAD 挂到会话分支。端口缺 `attachWorktreeBranch` 时 `console.warn(hostMessage('theSessionBranchCouldNotBeAttachedFallingBackTo'))` 并返回 `null`（退回旧 detached 行为）；否则取 `inspect(managedRoot).headOid`，对 `createSessionBranchCandidates`（src/managed-worktree-path.ts:63-75，形如 `feat/sess-<会话>[--<主题>]`，重名追加 `-2`、`-3`…）逐个候选拼 `refs/heads/${branch}`，先用 `resolveLocalBranchTip` 取该名现有 tip。**同名分支已存在时不再无条件跳过**：若 `existing === headOid`，或 `existing` 是当前 HEAD 的祖先（`dependencies.git.isAncestor(input.localRoot, existing, headOid)`，可快进），则视为可复用，用 `attach(managedRoot, branchRef, headOid, existing)`（CAS 到该 old 值）挂上去并复验 `headRef === branchRef`；其余情况（分支带着别的提交）才换下一个候选名——**绝不覆盖带别的提交的同名分支**。分支不存在时 `attach(managedRoot, branchRef, headOid, null)` 创建，同样复验后才返回 `{branch, branchRef}`。
- **`EnsureSessionBranchResult`**（789-791）：`{ok:true, record}` | `{ok:false, code, message}`。
- **`ensureSessionBranch(record)`**（801-851）：交付前保证 Worktree 挂在自己的会话分支上。端口缺 `attachWorktreeBranch` 时 warn 并原样 `ok:true`（退回旧行为）；`inspect` 失败 → `recovery_required`；`record.sessionBranch` 已存在且 `headRef` 相符则直接 `ok`；有记录但 HEAD 已离开（checkpoint 会写游离提交）→ attach 回记录值并复验，成功则 revision+1；attach 失败**另建独立会话分支**（绝不覆盖别人提交）；`attachSessionBranch` 返回 null → `git_operation_failed('theSessionBranchCouldNotBeAttachedToTheWorktree')`；成功后 `updateManagedCheckout` 同时把 `sessionBranch` 与 `sourceRef` 写成同一个 branch ref，revision+1；记录不存在 → `checkout_missing`。**历史记录（旧版本创建、detached、`sourceRef` 记的是 Local 当时所在分支——可能属于别的会话）不复用 `sourceRef` 作为交付目标**，`sourceRef` 从此只作「分叉来源」展示。
- **`refuseLegacyLocalWrite(record, binding)`**（1563-1575）：`if (!record.sessionBranch) return null`；否则旧的「写回 Local」操作一律返回 `operation_not_allowed`，消息键 `deliveryNoLongerWritesLocalUseDeliverInstead`（带分支名），并把 `inspectIsolated(binding)` 作为 target 指路 `worktree_deliver`。三个调用点：`operateApply`（2132）、`operatePreview`（2573）、`operateFinalizePreview`（3112，前一行为注释 `// Harness plugin does not expose Domi collaborator checkout inheritance.`）。
- **`explainApplyConflict({localRoot, conflictingFiles})`**（1533-1554）：把 `apply_conflict` 分类并给出 `resolveHint`——先 `listUntrackedFiles` 取未跟踪集（路径统一反斜杠→斜杠），命中即 `untracked_conflict` + `applyConflictUntrackedHint`；否则 `git.status().dirty` → `local_dirty` + `applyConflictLocalDirtyHint`；否则 `content_conflict` + `applyConflictContentHint`。preview 里只取前 5 个路径。

### 视图、绑定解析与锁

- **`inspectIsolated(binding, persistRecovery = true)`**（872-980）：`discarded` + `delivered` 走 `committedFollowupView`；`recovery_required` 且 `journal === null` 且目录仍在时，先用 `validateManagedCheckoutDetailed` 尝试修复回 `ready`；只有 `invalid` 才持久化 recovery；命中 `ready_for_review` 时计算 `reviewSlot`（`activePreview` 由 `holdsProjectAcceptanceSlot` 判定）。
- **`getPersistedBinding(sessionId)`**（982-984）。
- **`runtimeContext(sessionId, cwd?)`**（986-1127）：给模型的运行时指引。Local 分支按 pending 给 5 类提示（无 pending / `preview_active` / `preview_detached` / 待处理 handoff / 本会话持有）。Isolated 分支：`recovery_required`、`discarded`+`delivered`（已交付并清理，允许 Local 普通工作，要新改动先 `worktree_begin_next_iteration`）、**交付后语义 1050-1064**（`finalized` 或 `retained` 且 cwd 不在 `managedRoot` 时输出 `Session Target: Local Checkout（已交付）`、`Working boundary: <localRoot>`、明确允许在 Local 工作、`Task commit is on session branch <branch>.`（无 `sessionBranch` 时说明是 legacy 无会话分支）、提示用 `worktree_merge` 合并会话分支、`worktree_cleanup` 清理冻结运行时），消除「人在 Local 却禁止写 Local」的自相矛盾；否则输出 Isolated Checkout 权威 cwd 与 write-guard 规则（1066-1127，含 `insideWorktree` 判定、checkpoints 提示、各 `delivery.state` 的交付指令，`working` 态在 autoDeliver 下要求用 `worktree_deliver` 只提交会话分支、Local 不动）。
- **`resolveBinding(sessionId)`**（1129-1164）：`project_mismatch` / `target_unselected`；`discarded`+`delivered` 且 `workspace.root` 等于 `managedRoot` 时放行。
- **`withBindingLock(operation, {allowConcurrentInspect?})`**（1196-1231）：`BindingOperationMode`（1166）与队列变量 `bindingQueue` / `activeBindingOperation` / `pendingMaintenanceOperations` / `maintenanceReady` / `activeMaintenanceInspects`（1168-1176）。maintenance 模式先关只读旁路，再等已启动的 inspect 排空。
- **`inspectTarget`**（1233-1237）、**`inspectDuringMaintenance`**（1239-1249，只读不写 registry）、**`inspectAvailable`**（1251-1267）。

### 生命周期操作

- **`reconcile()`**（1269-1516）：清 `discarded` 空壳与空容器；回收 predecessor 记录；`finalized` 直接进 `cleanupFinalized`（`withCleanupTimeout` 兜底）；按 journal step 确定性收敛（checkpoint 走 `applyEngine.recoverCheckpoint`；preview 的 `planning`/`writing_local`/`artifacts_retained` 回 `ready`；`finalize_preview`/`finish` 的 `update_ref`/`replacing_index` 等进 `recovery_required`）；统计孤儿/脏记录；结尾 `cleanupExpiredRetained`。
- **`operationError(code, message, target?)`**（1518-1524）、**`updateManagedCheckout(checkoutId, mutate)`**（1577-1589）。
- **`markReadyForReviewTarget(sessionId, input)`**（1591-1673）：长度上限 summary ≤240、commitMessage ≤500、details ≤12000、validationSummary ≤500、tests ≤20；`inspectReview` 产出 `reviewId` / `changedFiles` / `isolatedFingerprint` / `isolatedHeadOid`。
- **`operateCheckpoint`**（1675-1904）：`requestId` 幂等重放、`expectedGeneration` CAS、`preview_active` 先 rollback；journal `planning` → `updating_ref` 并 `retainInternalArtifact('checkpoints/<id>')`；提交后 delivery 回 `working`。
- **`resumeRevisionTarget`**（1906-1977）、**`prepareReviewRegenerationTarget`**（1979-2010）、**`preparePreviewRecoveryAnalysisTarget`**（2012-2046）、**`createPreviewRecoveryHandoffTarget`**（2048-2094）。
- **`operateApply`**（2096-2253）：旧的「写回 Local」路径。开头插入 legacy 门（2132）；冲突时用 `explainApplyConflict` 填充 `reason` + `resolveHint`（2153-2167）。
- **`holdsProjectAcceptanceSlot`**（2255-2261）、**`findProjectAcceptanceHolder`**（2263-2273）、**`retainPreviewArtifacts`**（2275-2281）、**`releasePreviewArtifactsBestEffort`**（2283-2289）、**`previewArtifactsMatch`**（2291-2303）。
- **`blockedPreviewRecovery`**（2305-2322）、**`canonicalJson`**（2324-2333，数组/对象递归键排序并过滤 `undefined`）、**`sha256Facts`**（2335-2337）、**`recoveryGeneration`**（2339-2341）。
- **`preflightPreviewRecoveryTarget`**（2343-2429）：`not_owner` → `checkout_unavailable` → `stale_target` → `not_preview_detached` → `checkout_unavailable` → `artifacts_missing` → `assessPreviewRecovery` → `git_error`；项目验收槽被占时 rollback/finalize 都置 `{status:'blocked', code:'project_acceptance_busy'}` 并附 `blocker`；facts 含 `receiptFingerprint`、`localFingerprint`、`localHeadOid`/`localHeadRef`/`localHeadTreeOid`/`localIndexTreeOid`/`localWorkingTreeOid`、`rollback`、`finalize`，二次 CAS 后返回 `{status:'assessed', localModified:false, proof:{…, generation}}`。
- **`recoveryProofMatches(left, right)`**（2431-2435）、**`blockedPreflight`**（2437-2460）、**`preflightTarget(sessionId, expectedRevision)`**（2462-2540）：`applyEngine.preflight` 后按 `changedFiles` 空 → `already_in_local`、`localHeadOid !== baseOid` → `local_advanced`、否则 `ready`。
- **`operatePreview`**（2542-2692）：legacy 门之后写 journal `planning`，`plan` 冲突则回 `ready` 并用 `explainApplyConflict` 返回 `apply_conflict`；`writing_local` 阶段在 `beforeWrite` 内 `retainPreviewArtifacts` + delivery `preview_active` + journal `artifacts_retained`；成功返回 `{status:'previewed'}`。
- **`detachPreviewAfterLocalDrift`**（2694-2731）：`preview_active` → `preview_detached`（`detachedAt`/`reason`/`attemptedAction`）。
- **`operateRollbackPreview`**（2733-2838）：detached 恢复需 `recoveryProofMatches` + `proof.rollback.status === 'safe'`；成功按 `resumeRevision` 回 `working` 或 `ready_for_review`。
- **`retainFinalized(record, retention)`**（2840-2866）：`finalized` → `retained`，写 `retention`/`retainedAt`/`expiresAt`/`cleanup:'scheduled'`。
- **`collectEmptyManagedContainer(managedGitRoot, excludedCheckoutId)`**（2872-2886）。
- **`cleanupFinalized(record, {allowLegacyResidue?})`**（2888-3072）：非 `finalized`/`retained` 直接 `directory_busy`；`identity_changed` 直接复述；`hasLegacyCleanupResidueEvidence` 且 `managedGitRoot` 仍在 → `detached_residue`；binding 优先取 registry 里的 isolated 绑定，否则 `bindingForManagedRecord`；`beginRemoval` 写 journal `{operation:'cleanup', step:'removing_worktree', …}`；`quarantineAndRemove` 走 `.dsh-wt-cleanup--…` 隔离目录；`removeWorktree` 后若目录仍在，转 `validateDetachedCleanupResidue` + 隔离链；收尾 `collectEmptyManagedContainer`、`releaseApplyBaseBestEffort`，并把记录写成 `phase:'discarded'` + `delivery.state:'delivered'`；`catch` 打 `console.warn('[session-checkout] finalized Worktree cleanup failed:', error)`，`finalized` 记 `cleanup:'pending'`、`retained` 记 `cleanup:'blocked'`。
- **`operateFinalizePreview`**（3075-3216）：`preview_detached` 时先验 `proof.finalize.status === 'safe'`，再走 legacy 门（3112）；`applyEngine.finalize` 的 `beforeCommit` 写 journal `updating_ref` + `commitOid`；成功写 `delivery.state:'finalized'` 与 `proof`，`retention !== 'cleanup'` 走 `retainFinalized`，否则 `cleanupFinalized`。
- **`operateRetryCleanup`**（3218-3243）：仅 `finalized`/`retained` 可重试。
- **`operateFinish`**（3245-3480）：见下节「会话分支交付链」。
- **`releaseApplyBaseBestEffort(record)`**（3482-3490）：释放 apply base 与内部 artifact，失败只 `console.warn(hostMessage('internalRefsCleanupFailed'))`。
- **`operateDiscard`**（3492-3656）：`preview_active` 需 `rollbackPreview` 或拒绝；`recovery_required` 且目录已消失 → 直接 `discarded`；`ready` 且目录连同 git 顶层都没了 → prune + 清台账；脏工作树需 `confirmDirty`，并先 `snapshotAbandonedWorktree` 固化放弃快照（3620-3635，快照失败则中止放弃）。
- **`operateRecover`**（3658-3720）：终态记录（`delivered`/`discarded`/`finalized`/`retained`）不允许被 Recover 复活；`journal.operation === 'create'` 且有 creation 证据 → `recovery_unsafe`；有 journal 时先 `reconcile()` 收敛再判断。
- **`operateTarget`**（3722-3740）：按 `action` 分发（`apply`/`finish`/`preview`/`checkpoint`/`rollback_preview`/`finalize_preview`/`retry_cleanup`/`discard`/`recover`），`SessionCheckoutError` 转 `operationError`。

### 会话分支交付链（`operateFinish`，3245-3480）

1. 身份与前置校验：owner（继承会话 → `aSessionThatInheritedItsSessionTargetCannotPerform162`）→ 只接受 isolated → `commitMessage` trim 非空且 ≤500 → `checkout_missing` → `stale_target` → `expectedReviewId` 不符 → `stale_target`。
2. **历史 wrote-to-Local 记录**（`record.applyBaseOid && (state === 'working' || state === 'ready_for_review')`）→ `operation_not_allowed('thisLegacyWorktreeWasWrittenToLocalThroughAn')`（3275-3281）。
3. 状态门：`phase !== 'ready'` 或 `preview_active`/`preview_detached` → `operation_not_allowed`；项目验收槽被占 → `project_acceptance_busy`；`inspectIsolated` 后 `phase` 非 `ready` → `recovery_required`。
4. 引擎能力探测：`const reviewIsolated = engine.reviewIsolated ? engine.reviewIsolated.bind(engine) : undefined`（3303-3305，注释：「bind 回引擎实例：这些方法通过 this 访问内部状态，脱开实例调用会崩」），缺任一 → `operation_not_allowed('thisVersionCannotDeliverToASessionBranch')`。
5. 写 journal `{operation:'finish', step:'committing_session_branch', baseOid: applyBaseOid}`（3310-3324）。
6. **`ensureSessionBranch(mutating)`**（3338，调用点；函数本体 801-851，注释：先挂会话分支再只在该分支提交，Local 全程不被读写）；失败 → `restoreReady()` + 错误。`branchRef = deliverable.sessionBranch ?? null`。
7. `reviewIsolated({isolatedPath: deliverable.managedRoot, baseOid: applyBaseOid})`；`expectedReviewId` 下 `reviewId`/`isolatedFingerprint`/`isolatedHeadOid` 任一不符 → 回 `working` + `stale_isolated`。
8. 沿用 `ready_for_review` 的 review，否则现造一个：`reviewId = operationId`、`summary = hostMessage('skipLocalAcceptanceAndCommitDirectly')`、`validationStatus: 'not_run'`、`suggestedCommitMessage = finishCommitMessage`（3355-3389）。
9. **`commitIsolated({isolatedPath, baseOid, commitMessage, branchRef})`**（3405-3410）；失败 → `restoreReady()`。
10. 写 `delivery.state:'finalized'` 与 `proof`：`localBranch: branchNameOf(branchRef)`、`localHeadBefore: isolatedReview.isolatedHeadOid`、`localHeadAfter: committed.commitOid`、`changedFiles`、`validationStatus/Summary`（3422-3443）。
11. 自动 push：`(liveConfigValue(dependencies.autoPush) ?? true) && dependencies.git.pushBranch` → `pushLocalBranchBestEffort(dependencies.git.pushBranch, deliverable.managedRoot)`（3450-3453；注释 3448-3449 说明推的是**会话分支**而非 Local 分支，新分支通常没有 upstream，于是退化成「已跳过」备注，不会误推）。
12. 收尾：`branchName = branchNameOf(branchRef)`，`retention !== 'cleanup'` 走 `retainFinalized`，否则 `cleanupFinalized`；两者都在结果里带 `branch`（有会话分支时）与 `push`。

### 清理资格、列表与管理

- **`managedIteration`**（3742-3745）、**`managedUpdatedAt`**（3747-3755）。
- **`summarizeManagedWorktree(record, includeDiagnostics = false)`**（3757-3848）：快速列表保守且不扫 Git/磁盘；`includeDiagnostics` 时才算 dirty、残留、字节数；`state` 由 `staleRoot` / `phase` / `delivery.state` 组合得出（`needs_attention`、`retained`、`cleanup_pending`、`preview_active`、`ready_for_review`、`delivered`、`working`）。
- **`cleanupBlocked(reason, message, revision)`**（3850-3852）、**`inspectCleanupForRecord(record)`**（3854-3908）：按 `delivery.state` 与指纹给出 `safe` / `retained` / `blocked` 及结构化原因。
- **`inspectManagedWorktreeCleanup`**（3910-3922）、**`bulkCleanupManagedWorktrees`**（3924-3973，逐条 CAS 后 `cleanupFinalized`）、**`listManagedWorktrees`**（3975-3984）、**`listManagedWorktreesForSession`**（3986-4000）。
- **`pruneMergedBranchesInRepo`**（4009-4074）：只删「已完全合并」的本地分支（`git branch -d` 语义），当前分支与主干永不进候选；主干名从 `origin/HEAD` → `init.defaultBranch` 推断；合并基准优先主干，否则退回当前 HEAD；`olderThanDays` 需 `branchTipTimes`，端口缺该能力时直接拒绝而不是放宽。
- **`pruneMergedBranchesForSession`**（4076-4092）、**`autoPruneStaleMergedBranches`**（4099-4119）。
- **`mergeBranchForSession(sessionId, input)`**（4121-4197）：`managedRootByBranch` 先注册 `record.sessionBranch`（4122-4126），再补各 Worktree 的当前分支；来源分支等于 Local 当前分支直接 `invalid_input`；**分支找不到时区分**「属于另一个会话 X 的分支」（`not_owner`，指名 `ownerSessionId`，4136-4151）与「不属于本会话」；真实合并（非 dryRun）前检查项目验收槽（含本会话，4182-4185）；`direction === 'reverse'` 把 Local 当前分支合进任务 worktree，冲突现场留在 worktree。
- **`listAbandonedWorktreeSnapshots`**（4199-4215）、**`restoreAbandonedWorktreeSnapshot`**（4217-4240）。
- **`manageManagedWorktreeForSession`**（4242-4261）、**`manageManagedWorktree`**（4263-4340，`discard` / `set_retention` / `set_permanent` / `clear_sidebar_badge` / 清理）。
- **`observeManagedCheckout`**（4342-4348）、**`observeManagedCheckouts`**（4351-4353）、**`resolveManagedRoot`**（4355-4357）、**`resolveRoots`**（4364-4367）。
- **`retryableCleanupBlock`**（4375-4379）、**`cleanupExpiredRetained(now)`**（4381-4401）、**`enforceWorktreeKeepCount()`**（4409-4431）：`permanent` 与进行中记录豁免，只逐出最旧的 `finalized`/`retained`，且必须走 `cleanupFinalized`（不能复用 `operateDiscard`——它对 `finalized`/`retained` 一律拒绝）。
- **`beginNextIterationTarget(sessionId, expectedRevision)`**（4433-4642）：要求 predecessor 已是 `discarded`+`delivered`、owner 与 cwd 归属匹配（managed 或 Local 边界都接受，4443-4467）、旧路径未复活、Local 项目与 git 身份未变；**迭代以「上一轮会话分支 tip」为 `iterationBaseOid`**（`branchNameOf(predecessor.sessionBranch) ?? branchNameOf(predecessor.sourceRef)` → `resolveLocalBranchTip`），解析不到才退回 `snapshot.headOid`（4492-4497，注释说明否则迭代链会在交付处断开、上一轮工作整段丢失）；重建后 `attachSessionBranch` 重新挂会话分支并同步 `sourceRef`/`sessionBinding.sourceRef`（4579-4601）。
- **`copyWorktreeincludeFiles`**（4648-4670）、**`carryLocalWorkInProgress`**（4676-4702）、**`repairStaleWorktreeLinks`**（4704-4737）。
- **`bindTarget(sessionId, choice, createAttempt, requestStartedAt, sourceSessionId, createOptions)`**（4739-5075）：创建路径在 `createDetachedWorktree` 成功后立即 `attachSessionBranch`（4992-4997），`readyRecord` 同时写 `sessionBranch` 与 `sourceRef` 为同一个 branch ref（5004-5013，注释说明旧语义会让侧栏与交付把别人的分支当成归属），`binding.sourceRef` 同步（5018-5019）；失败按 `WorktreeCreationFailure` / 残留是否清掉决定 `markRecoveryRequired` 还是重试（5026-5074）。

### 工厂返回的公开接口（5077-5176）

| 成员 | 行号 | 说明 |
| --- | --- | --- |
| `inspect` | 5078 | → `inspectAvailable` |
| `runtimeContext` | 5079 | 模型运行时指引 |
| `preflight` | 5080-5082 | 加锁 → `preflightTarget` |
| `preflightPreviewRecovery` | 5083-5086 | `allowConcurrentInspect: true` |
| `runExclusiveSessionMutation` | 5087-5089 | 独占变更包装 |
| `bind` | 5090-5093 | 加锁 → `bindTarget` |
| `createIsolatedTarget` | 5094-5119 | in-place 与独立会话两种形态 |
| `beginNextIteration` | 5120-5122 | 下一轮迭代 |
| `resumeRevision` | 5123-5125 | 恢复编辑 Review |
| `prepareReviewRegeneration` | 5126-5128 | `stale_isolated` 时重出 Review |
| `preparePreviewRecoveryAnalysis` | 5129-5131 | 预览恢复分析 |
| `createPreviewRecoveryHandoff` | 5132-5134 | 预览恢复移交 |
| `markReadyForReview` | 5135-5137 | 标记 Review |
| `operate` | 5138 | 操作分发 |
| `isAutoDeliverEnabled` | 5140 | 暴露 autoDeliver 实时取值 |
| `listManagedWorktrees` / `listManagedWorktreesForSession` | 5142-5143 | 只读列表，不加全局锁 |
| `pruneMergedBranchesForSession` / `autoPruneStaleMergedBranches` | 5144-5149 | 分支修剪 |
| `mergeBranchForSession` | 5150-5152 | 合并会话分支 |
| `listAbandonedWorktreeSnapshots` / `restoreAbandonedWorktreeSnapshot` | 5153-5156 | 放弃快照 |
| `manageManagedWorktreeForSession` | 5157-5159 | 受限管理工作台 |
| `inspectManagedWorktreeCleanup` | 5160 | 清理资格检查 |
| `bulkCleanupManagedWorktrees` / `manageManagedWorktree` | 5161-5162 | 批量清理与管理工作台 |
| `resolveManagedRoot` / `resolveRoots` | 5163-5164 | 路径解析 |
| `observeManagedCheckout` / `observeManagedCheckouts` | 5165-5166 | 纯读观察 |
| `cleanupExpiredRetained` / `enforceWorktreeKeepCount` | 5167-5174 | `allowConcurrentInspect: true` |
| `reconcile` | 5175 | `allowConcurrentInspect: true` |

### 类型定义（src/types.ts）

- **`SessionTargetRef`**（src/types.ts:11-14）：`unselected` | `local` | `isolated{checkoutId}`。
- **`SessionCheckoutKind`**（16）、**`SessionCheckoutPhase`**（18-27）：`preparing` / `ready` / `applying`（@deprecated）/ `mutating` / `recovery_required` / `finalized` / `retained` / `discarded`。
- **`WorktreeValidationStatus`**（29）：`passed` / `failed` / `partial` / `not_run`。
- **`WorktreeRetentionMode`**（32）：`cleanup` / `retain_24h` / `retain_3d` / `retain_manual`；**`DEFAULT_WORKTREE_RETENTION`**（39）= `retain_24h`。
- **`WorktreeCleanupReason`**（41-46）：`directory_busy` / `modified_after_finalize` / `identity_changed` / `detached_residue` / `quarantine_busy`。
- **`WorktreeValidationItem`**（48-52）：`command`、`status`、`summary?`。
- **`WorktreeCheckpointView`**（55-63）：`checkpointId`、`sequence`、`reviewId`、`createdAt`、`summary`、`validationStatus`、`changedFiles`。
- **`WorktreeReviewView`**（65-77）：`reviewId`、`iteration`、`preparedAt`、`detailsMarkdown?`、`summary`、`validationStatus`、`validationSummary?`、`tests`、`changedFiles`、`suggestedCommitMessage`。
- **`WorktreeDeliveryProofView`**（79-90）：`localBranch`、`localHeadBefore`、`localHeadAfter`、`changedFiles`、`validationStatus?`、`validationSummary?`、`commitInLocalHistory`。会话分支交付后 `localBranch` 记的是**会话分支名**，`localHeadBefore/After` 是 Worktree 侧 OID。
- **`WorktreeDeliveryView`**（92-127）：7 种状态联合——`working{iteration}`、`ready_for_review{review}`、`preview_active{review, previewedAt}`、`preview_detached{review, previewedAt, detachedAt, reason, attemptedAction}`、`finalized{review, commitOid, proof?, cleanup, cleanupMessage?, cleanupReason?}`、`retained{…, retention, retainedAt, expiresAt, cleanup:'scheduled'|'blocked', …}`、`delivered{iteration, commitOid, proof?, deliveredAt}`。
- **`WorktreeApplyPreflightBlockedReason`**（129-137）：`not_owner` / `not_ready_for_review` / `stale_target` / `stale_local` / `stale_isolated` / `project_acceptance_busy` / `checkout_unavailable` / `git_error`。
- **`WorktreeApplyPreflightFacts`**（139-150）：`checkoutId`、`reviewId`、`revision`、`configuredBaseOid`、`effectiveBaseOid`、`baseStrategy`、`localBranch`、`localHeadOid`、`isolatedHeadOid`、`changedFiles`。
- **`WorktreeAcceptanceBlockerView`**（152-157）：`checkoutId`、`ownerSessionId`、`revision`、`state`。
- **`WorktreeApplyPreflightView`**（159-172）：`ready`/`local_advanced`/`already_in_local` | `conflict{conflictingFiles, conflictDetails?}` | `blocked{reason, message, blocker?}`，三者都带 `localModified: false`。
- **`SessionTargetProjectView`**（174-177）、**`SessionTargetCheckoutView`**（179-184）、**`SessionTargetSourceView`**（186-190）、**`SessionTargetCurrentView`**（192-196）。
- **`SessionTargetView`**（198-216）：`project`、`checkout`、`source`、`current`、`ownership`、`dirty`、`revision`、`delivery?`、`checkpoints?`、`checkpointGeneration?`、`reviewSlot?`、`reviewSlotOwnerSessionId?`。
- **`SessionTargetBindChoice`**（218-220）。
- **`SessionCheckoutOperationBase`**（222-225）及 9 个操作接口（227-354）：`apply`、`finish{commitMessage, retention?, expectedReviewId?}`、`preview`、`checkpoint{commitMessage, expectedReviewId, expectedGeneration, requestId}`、`rollback_preview{resumeRevision?, recoveryProof?}`、`finalize_preview{commitMessage, retention?, recoveryProof?}`、`retry_cleanup`、`discard{confirmDirty, rollbackPreview?}`、`recover`；`SessionCheckoutOperation`（344-353）为其联合。
- **`WorktreePreviewRecoveryActionBlockReason`**（251-256）、**`WorktreePreviewRecoveryRollbackAction`**（258-260）、**`WorktreePreviewRecoveryFinalizeAction`**（262-270）。
- **`WorktreePreviewRecoveryProof`**（273-291）：`sessionId`、`checkoutId`、`reviewId`、`previewId`、`revision`、`generation`、`receiptFingerprint`、`localFingerprint`、`localHeadOid`、`localHeadRef`、`localHeadTreeOid`、`localIndexTreeOid`、`localWorkingTreeOid`、`rollback`、`finalize`、`blocker?`。
- **`WorktreePreviewRecoveryPreflightBlockedReason`**（293-299）、**`WorktreePreviewRecoveryPreflightView`**（301-312）。
- **结果类型**：`SessionCheckoutAppliedResult`（355-359）、`PreviewedResult`（361-365）、`CheckpointedResult`（367-372）、`PreviewRolledBackResult`（374-378）、`PreviewDetachedResult`（380-386）、**`WorktreePushOutcome`**（388-392，`pushed`/`skipped`/`failed`）、`SessionCheckoutFinishedResult`（394-411，含 `commitOid`、**`branch?`**（任务提交落在哪条会话分支）、`cleanup`、`cleanupMessage?`、`cleanupReason?`、`push?`）、**`ApplyConflictReason`**（548，`content_conflict` | `local_dirty` | `untracked_conflict`）、`SessionCheckoutConflictResult`（550-566，含 `reason`、`resolveHint?`、`conflictDetails?`）、`DiscardedResult`（568-571）、`RecoveredResult`（573-576）、`OperationErrorResult`（578-583）、`SessionCheckoutOperationResult`（585-595）。
- **`ManagedWorktreeCleanupEligibility`**（413）、**`ManagedWorktreeCleanupBlockReason`**（415-423）、**`ManagedWorktreeCleanupView`**（425-431）、**`BulkCleanupManagedWorktreeCandidate` / `BulkCleanupManagedWorktreesResult`**（433-441）。
- **`ManagedWorktreeSummaryState`**（443-450）、**`ManagedWorktreeSummaryView`**（452-480）：`checkoutId`、`revision`、`ownerSessionId`、`ownerSessionTitle`、`project`、`iteration`、`state`、`phase`、`dirty`、`commitOid`、`checkpointCount?`、`retention?`、`retainedAt?`、`expiresAt?`、`permanent?`、`cleanupMessage?`、`cleanupReason?`、`approximateBytes`、`updatedAt`、`canCleanup`、`cleanup?`、`activeSessionIds?`。
- **`PruneMergedBranchEntry` / `PruneMergedBranchesView`**（483-494）、**`AbandonedWorktreeSnapshotView`**（496-503）。
- **`ApplyBaseStrategy`**（505-509）：`recorded_base` | `isolated_contains_local_head` | `local_contains_isolated_head`。
- **`ApplyConflictDetail`**（510-514）、**`CONFLICT_DETAIL_FILE_LIMIT = 6`** 与 **`CONFLICT_DETAIL_DIFF_LIMIT = 4096`**（517-518）。
- **`MergeLocalBranchOutcome`**（520）、**`MergeLocalBranchResult`**（522-529）、**`MergeBranchForSessionView`**（531-540，含 `direction: 'forward'|'reverse'`）。
- **`SESSION_CHECKOUT_ERROR_CODES`**（597-627，29 个错误码）、**`SessionCheckoutErrorCode`**（629）、**`SessionCheckoutFailure`**（631-634）。

### 端口契约（src/ports.ts）

- **`SessionCheckoutSessionRecord`**（21-26）、**`SessionCheckoutProjectRecord`**（28-32）、**`SidebarDirectoryMembership`**（34-38）、**`SessionCheckoutLookupPort`**（40-45）。
- **`GitCheckoutSnapshot`**（47-54）：`root`、`commonDir`、`gitDir`、`branch`、`headOid`、`headRef`。
- **`BranchOverviewEntry`**（56-62）、**`GraphLogCommit`**（64-73）、**`InitialCommitPreflight`**（75-79）。
- **`SessionCheckoutGitPort`**（81-179）。与本文强相关的可选能力：`resolveLocalBranchTip`（90，判断会话分支是否已存在）、**`attachWorktreeBranch(managedRoot, branchRef, headOid, expectedOldOid)`**（103，注释明确「点向会话自有分支而不动任何文件；`expectedOldOid` 为 null 时只在 ref 不存在时创建，避免并发会话丢提交；不实现该方法的端口保持 legacy detached-HEAD 行为」）、`pushBranch`（120）、`repairWorktreeLinks`（126）、`pruneWorktrees`（131）、`branchOverview`（137）、`defaultBranch`（142）、`branchTipTimes`（147）、`deleteLocalBranch`（149）、`mergeLocalBranch`（155）、`snapshotAbandonedWorktree`（176）、`restoreAbandonedSnapshot`（177）。
- **`DirectoryIdentity`**（181-185）：`device`、`inode`、`birthtimeNs`。
- **`SessionCheckoutFilesPort`**（187-204）。
- **`SessionBindingRecord`**（206-216）：`sessionId`、`projectId`、`projectName`、`target`、`ownerSessionId`、`inheritedFromSessionId?`、`sourceRef`、`sourceOid`、`revision`。
- **`ManagedCheckoutJournalBase`**（218-221）、**`WorktreeCreationEvidence`**（223-235）、**`ManagedCheckoutCreateJournal`**（237-241）。
- **`ManagedCheckoutMutationJournal`**（243-278）：`operation` 为 `'apply' | 'preview' | 'checkpoint' | 'rollback_preview' | 'finish' | 'finalize_preview' | 'cleanup'`；`step` 为 `'planning' | 'artifacts_retained' | 'committing_session_branch' | 'writing_local' | 'updating_ref' | 'replacing_index' | 'removing_worktree'`——其中 **`committing_session_branch`**（248）是为会话分支交付新增的步骤；字段含 `baseOid?`、`planRevision?`、`previewId?`、`reviewId?`、`localFingerprint?`、`isolatedFingerprint?`、`effectiveBaseOid?`、`baseStrategy?`、`localHeadOid?`、`isolatedHeadOid?`、`commitOid?`、`checkpointId?`、`checkpointSequence?`、`checkpointRequestId?`、`checkpointRequestedRevision?`、`checkpointMessage?`、`checkpointIndexTreeOid?`、`parentOid?`、`retention?`、`recoveryGeneration?`、`resumeRevision?`、`changedFiles?`、`managedDirectoryIdentity?`、`cleanupQuarantinePath?`。
- **`ManagedWorktreeCheckpointRecord`**（282-299）、**`ManagedWorktreePreviousReviewRecord`**（301-308）、**`ManagedWorktreeReviewRecord`**（310-323）、**`ManagedPreviewReceipt`**（325-344）、**`ManagedDeliveryProof`**（346-354）。
- **恢复继续上下文**（356-396）：`ManagedApplyConflictRecoveryContinuation`、`ManagedReviewRegenerationContinuation`、`ManagedPreviewRecoveryAnalysisContinuation`、`ManagedPreviewRecoveryHandoffContinuation`，以及联合 `ManagedRecoveryContinuation`。
- **`ManagedCheckoutDelivery`**（398-434）：与 `WorktreeDeliveryView` 对应的持久化形态（`finalized`/`retained` 额外带 `isolatedFingerprint`、`finalizedAt`）。
- **`ManagedCheckoutRecord`**（436-489）字段全集：`checkoutId`、`predecessorCheckoutId?`、`projectId`、`projectName`、`ownerSessionId`、`sourceSessionId?`、`localRoot`、`managedRoot`、`managedGitRoot`、`gitCommonDir`、`gitDir`、`baseOid`、`applyBaseOid?`、`previousReview?`、`checkpoints?`、`recoveryContinuation?`、`abandonedSnapshotOid?`、`abandonedSnapshotAt?`、`permanent?`、`sidebarBadgeClearedRevision?`、`sourceRef`、**`sessionBranch?`**（469-477，注释：本 Worktree 提交所用的会话自有分支 `refs/heads/feat/sess-…`；历史记录缺失，交付时改为把 Worktree 采纳到新建分支而不是复用 `sourceRef`——对那些记录 `sourceRef` 只表示会话恰好从哪条 Local 分支分叉）、`sessionTopic?`、`phase`、`delivery`、`journal`、`revision`。
- **`ManagedCheckoutsRegistry`**（491-496）、**`SessionCheckoutRegistryPort`**（498-501）、**`LiveValue` / `liveConfigValue`**（503-514）。
- **`SessionCheckoutDependencies`**（516-547）：`lookup`、`git`、`files`、`registry`、`applyEngine`、`managedCheckoutsRoot`、`createCheckoutId()`、`autoPush?`、`autoDeliver?`、`worktreesRoot?`、`inheritLocalChanges?`、`worktreeKeepCount?`（默认 15，0 关闭）。

### 支撑模块

- **`checkpointGenerationForRecord(record)`**（src/checkpoint.ts:16-29）：对 `checkoutId`/`revision`/`reviewId`/`isolatedHeadOid`/`isolatedFingerprint`/`checkpointCount`/`previewId`/`phase` 做 canonical JSON 的 SHA-256；非 `ready_for_review`/`preview_active` 返回 `undefined`。内部 `canonicalJson`（4-13）。
- **`WorktreeCreationFailure`**（src/creation-failure.ts:2-7）：带 `rolledBack` 标志，创建失败不等于可以推断空目录安全。
- **`sanitizeManagedWorktreeLabel`**（src/managed-worktree-path.ts:15-29）、**`createManagedWorktreeRepositoryKey`**（38-40）、**`sanitizeBranchSegment`**（46-55）、**`createSessionBranchCandidates`**（63-75）、**`createManagedWorktreeDirectoryName`**（78-86）、**`createTopicManagedWorktreeDirectoryName`**（101-112）、**`createTopicDateStamp`**（115-120）、**`createManagedWorktreePathCandidates`**（132-175）。

## Architecture

```text
┌──────────────────────────────────────────────────────────────────────┐
│              createSessionCheckoutModule (session-checkout-module)    │
│                                                                       │
│  ┌─────────────┐   ┌──────────────┐   ┌───────────────────────────┐  │
│  │ bind/create │   │ operate*     │   │ list / manage / prune     │  │
│  │ bindTarget  │   │ preview      │   │ summarizeManagedWorktree  │  │
│  │ 4739-5075   │   │ finish       │   │ inspectCleanupForRecord   │  │
│  │             │   │ 3245-3480    │   │                          │  │
│  └──────┬──────┘   │              │   └─────────────┬─────────────┘  │
│         │          └──────┬───────┘                 │                │
│         └────────► withBindingLock (1196-1231) ◄─────┘                │
│                     exclusive / maintenance / draining                │
│                            │                                          │
│         ┌──────────────────┼──────────────────┬────────────────────┐ │
│         ▼                  ▼                  ▼                    ▼ │
│  ┌────────────┐  ┌────────────────┐  ┌──────────────┐  ┌──────────┐ │
│  │ 身份校验    │  │ applyEngine    │  │ registry     │  │ git port │ │
│  │ validate*  │  │ plan/preview/  │  │ v2 读写      │  │ branch/  │ │
│  │ 588-735    │  │ finalize/      │  │ 1577-1589    │  │ worktree │ │
│  │            │  │ reviewIsolated │  │              │  │ 端口 81+ │ │
│  │            │  │ commitIsolated │  │              │  │          │ │
│  └────────────┘  └────────────────┘  └──────────────┘  └──────────┘ │
│                                                                       │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ 会话分支层 attachSessionBranch(745) ensureSessionBranch(801)    │  │
│  │ refuseLegacyLocalWrite(1563)  ──► 交付只写 refs/heads/feat/…    │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

## Data Flow

1. **绑定与创建**：`bind` / `createIsolatedTarget` 经 `bindTarget`（4739-5075）解析项目与 git 快照、生成路径候选、写入 `preparing` 记录与 binding、`createDetachedWorktree` 后复验 git 身份，随后立即 `attachSessionBranch` 把 Worktree 挂到 `feat/sess-<会话>[--<主题>]`（4992-4997），`sessionBranch` 与 `sourceRef` 同写该 ref，记录转 `ready`。
2. **编辑与检查点**：改动只发生在 Worktree。`checkpoint` 用 `requestId` 幂等 + `expectedGeneration` CAS，在 `refs/…/checkpoints/<id>` 上留证，提交后回 `working`。
3. **Review 与 Preview**：`markReadyForReview` 固化 review 指纹；`preview` 在 receipt 保护下把改动写进 Local，`beforeWrite` 内先留工件再置 `preview_active`。Local 一旦漂移，预览进入 `preview_detached`，需要 `preflightPreviewRecovery` 生成的 proof 才能继续。
4. **交付（只写会话分支）**：`finish` 先 `ensureSessionBranch`（历史记录在此补建分支），再 `reviewIsolated` + `commitIsolated(branchRef)`，`proof.localBranch` 记会话分支名，自动 push 也推会话分支（3450-3453），Local 的三个面全程不读写。旧的 `apply` / `preview` / `finalize_preview` 在存在 `sessionBranch` 时被 `refuseLegacyLocalWrite` 拒绝并指向 `worktree_deliver`。
5. **合并**：`mergeBranchForSession` 先认 `record.sessionBranch`，拒绝把 Local 自身分支当来源，并区分「别的会话的分支」；真实合并前检查项目验收槽，冲突现场留给用户解决。
6. **保留与清理**：`finalized` 可 `retain_*` 冻结环境（默认 `retain_24h`），或直接 `cleanupFinalized` 删除目录；目录身份不符/交付后又有改动会被挡成 `identity_changed` / `modified_after_finalize`；到期由 `cleanupExpiredRetained`、总量由 `enforceWorktreeKeepCount` 收口。
7. **崩溃恢复**：启动或显式 `recover` 时 `reconcile()` 按 journal step 前进或回退（`committing_session_branch` 属交付链，被视作可能已产生提交，收敛为 `recovery_required` 而不是草率回 `ready`）。

## Connections

- [[session-checkout-apply]]：`applyEngine` 的实现，提供 `plan` / `preflight` / `preview` / `rollback` / `finalize` / `recoverCheckpoint` / `inspectReview` / `reviewIsolated` / `commitIsolated`。
- [[managed-worktree-path]]：会话分支名候选与 Worktree 目录/路径候选生成，`createSessionBranchCandidates` 是 `attachSessionBranch` 的唯一取名来源。
- [[registry]]：`ManagedCheckoutsRegistry` 的持久化与原子写入。
- [[git-port]]：`SessionCheckoutGitPort` 适配器，`attachWorktreeBranch` / `resolveLocalBranchTip` / `mergeLocalBranch` 是会话分支语义的底层支点。
- [[file-port]]：`SessionCheckoutFilesPort`，目录身份、隔离与删除能力。
- [[session-management]]：`lookup` 端口提供会话与项目记录，决定 owner 与 cwd 归属判定。
- [[host-messages]]：所有面向用户的文案键与持久化清理文案的映射表。

## Known Issues

- **detached 兼容残留**：端口不实现 `attachWorktreeBranch` 时，`attachSessionBranch`（745-786）与 `ensureSessionBranch`（801-851）都只 warn 并退回旧行为，此时 `record.sessionBranch` 永不写入。
- **历史记录仍可写 Local**：`refuseLegacyLocalWrite`（1563-1575）只对存在 `sessionBranch` 的记录生效，因此旧版本创建、无会话分支的记录仍可走 `apply` / `preview` / `finalize_preview` 写回 Local；`operateFinish` 对这类 wrote-to-Local 中间态另有显式拒绝（3275-3281）。
- **迭代基点会退化**：`beginNextIterationTarget` 用 `resolveLocalBranchTip` 找上一轮会话分支 tip，找不到（分支被删/改名）就退回 Local 的 `headOid`（4492-4497），上一轮内容会在迭代链上断开——源码注释已点明这一点。
- **`operateFinish` 重读记录只校验 phase**：`ensureSessionBranch` 之前那次 registry 重读（3298-3300）只判 `phase !== 'ready'`，不再比 `revision`，并发窗口依赖 `withBindingLock` 与 `updateManagedCheckout` 的 CAS 兜底。
- **清理失败原因被折叠**：`cleanupFinalized` 的 `catch`（3052-3071）把所有异常降级成 `quarantine_busy` / `directory_busy` 的 `pending`/`blocked`，不区分底层错误类型，只能靠 `console.warn('[session-checkout] finalized Worktree cleanup failed:', error)` 定位。
- **`retain_24h` 是默认值**：调用方未显式给 `retention` 时（`DEFAULT_WORKTREE_RETENTION`，src/types.ts:39）冻结环境会留一天，磁盘占用与 `approximateBytes` 会持续到到期清理。
- **旧写回校验仍在**：`inspectCleanupForRecord`（3854-3908）在 `commit + proof` 时仍用 `validateCommittedLocalCheckout` + `isAncestor` 验证交付提交在 Local 历史里，这是写回语义的遗留；会话分支交付的提交不在 Local 历史中，该分支逻辑对这类记录不再成立。
- **双轨记录共存**：`ManagedCheckoutDelivery`（src/ports.ts:398-434）与 `ManagedWorktreeCleanupView`（src/types.ts:425-431）仍需兼容旧 registry 形态（`cleanupReason` 可选、`persistedCleanupReason` 回退文案映射），新旧记录在同一份台账里语义不完全一致。