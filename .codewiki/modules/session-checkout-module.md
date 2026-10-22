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

`createSessionCheckoutModule`（src/session-checkout-module.ts:234-236，工厂体延伸到 `return { … }` 的 5047-5146）是插件核心：一套从 Domi 移植来的 session-checkout 状态机（模块头注释 src/session-checkout-module.ts:234-240），保留 receipt-first Local Preview、回滚/finalize、项目验收槽、崩溃恢复与 fingerprint CAS，同时把所有权适配到 Harness 分离的 source Local Session 与 target owner Session。全部持久化状态落在 `ManagedCheckoutsRegistry`（version 2，src/ports.ts:484-489）。

当前版本最关键的语义变化是**交付不再写回 Local**：每个受管 Worktree 在创建阶段就挂到属于自己会话的分支（`refs/heads/feat/sess-<会话>[--<主题>]`），`worktree_deliver` / `finish` 只在这条会话分支上提交，Local 的工作区、索引与 HEAD 全程不被读写；合并由 `worktree_merge` 显式发起。为此模块新增了 `branchNameOf`（src/session-checkout-module.ts:1100-1103）、`attachSessionBranch`（745-772）、`ensureSessionBranch`（786-834）、`refuseLegacyLocalWrite`（1546-1558）与 `explainApplyConflict`（1516-1537）。

## Overview

模块管理「受管 Worktree」（Managed Worktree）的全生命周期：绑定会话、创建、检查点（Checkpoint）、预览（Preview）、Review、交付（Deliver/Finish）、保留（Retain）与清理（Cleanup）。三个机制贯穿始终：

- **互斥**：所有变更操作经 `withBindingLock`（src/session-checkout-module.ts:1179-1214）串行化；maintenance 模式允许只读 `inspect` 并发旁路，但必须先关闭旁路并排空已启动的 inspect。
- **崩溃恢复**：`record.journal` 记录可重放的 receipt，`reconcile()`（1252-1499）按 journal 的 step 把记录确定性收敛到 `ready` 或 `recovery_required`。
- **CAS / 指纹**：`revision`、`isolatedFingerprint`、`reviewId`、`generation` 共同构成乐观并发校验；Preview 用 receipt 记录写入前后的 Local 指纹，任何漂移都让预览进入 `preview_detached`。

本地适配特性（相对 Domi 原版）：

- **会话分支交付**：创建即挂分支，交付只提交会话分支（745-772、3313-3321、3382-3387）。
- **自动推送**：Finish 成功后尽力推送**会话分支**（`pushLocalBranchBestEffort`，src/session-checkout-module.ts:126-137；调用点 3436-3439），失败降级为「已跳过」备注。
- **仓库移动修复**：`git worktree repair` 重连断链 Worktree（`repairStaleWorktreeLinks`，4676-4709）。
- **Worktree 根目录配置**：`worktreesRoot` + 主题命名（路径候选生成在 `createManagedWorktreePathCandidates`，src/managed-worktree-path.ts:132-175）。
- **继承未提交修改**：`carryLocalWorkInProgress`（4648-4674），仅当基点等于 Local HEAD 时生效。
- **放弃快照**：带未提交内容放弃前固化快照（3597-3612）。
- **常驻标记**：`permanent` 豁免保留期到期清理与 LRU 逐出（4386-4408）。

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
- **`branchNameOf(ref)`**（229-232）：`refs/heads/x` → `x`；其他 ref（含 detached 的 `HEAD`）返回 `null`。会话分支名一律经它从 ref 取出。

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
- **`validateCleanupQuarantine(record)`**（836-853）：校验隔离目录身份（目录名形如 `.dsh-wt-cleanup--<checkoutId 前 8 位>--<operationId>`）。

### 会话分支：交付目标的建立与保护

- **`attachSessionBranch({localRoot, managedRoot, sessionId, topic})`**（745-772）：把新建/重建的 Worktree 从 detached HEAD 挂到会话分支。端口缺 `attachWorktreeBranch` 时 `console.warn(hostMessage('theSessionBranchCouldNotBeAttachedFallingBackTo'))` 并返回 `null`（退回旧 detached 行为）；否则取 `inspect(managedRoot).headOid`，对 `createSessionBranchCandidates`（src/managed-worktree-path.ts:63-75，形如 `feat/sess-<会话>[--<主题>]`，重名追加 `-2`、`-3`…）逐个候选拼 `refs/heads/${branch}`，用 `resolveLocalBranchTip` 跳过已存在的分支，再 `attach(managedRoot, branchRef, headOid, null)`，最后 `inspect()` 复验 `headRef === branchRef` 才返回 `{branch, branchRef}`。
- **`EnsureSessionBranchResult`**（774-776）：`{ok:true, record}` | `{ok:false, code, message}`。
- **`ensureSessionBranch(record)`**（786-834）：交付前保证 Worktree 挂在自己的会话分支上。端口缺 `attachWorktreeBranch` 时 warn 并原样 `ok:true`（退回旧行为）；`inspect` 失败 → `recovery_required`；`record.sessionBranch` 已存在且 `headRef` 相符则直接 `ok`；有记录但 HEAD 已离开（checkpoint 会写游离提交）→ attach 回记录值并复验，成功则 revision+1；attach 失败**另建独立会话分支**（绝不覆盖别人提交）；`attachSessionBranch` 返回 null → `git_operation_failed('theSessionBranchCouldNotBeAttachedToTheWorktree')`；成功后 `updateManagedCheckout` 同时把 `sessionBranch` 与 `sourceRef` 写成同一个 branch ref，revision+1；记录不存在 → `checkout_missing`。**历史记录（旧版本创建、detached、`sourceRef` 记的是 Local 当时所在分支——可能属于别的会话）不复用 `sourceRef` 作为交付目标**，`sourceRef` 从此只作「分叉来源」展示。
- **`refuseLegacyLocalWrite(record, binding)`**（1546-1558）：`if (!record.sessionBranch) return null`；否则旧的「写回 Local」操作一律返回 `operation_not_allowed`，消息键 `deliveryNoLongerWritesLocalUseDeliverInstead`（带分支名），并把 `inspectIsolated(binding)` 作为 target 指路 `worktree_deliver`。三个调用点：`operateApply`（2109-2110）、`operatePreview`（2550-2551）、`operateFinalizePreview`（3088-3090，前一行为注释 `// Harness plugin does not expose Domi collaborator checkout inheritance.`）。
- **`explainApplyConflict({localRoot, conflictingFiles})`**（1516-1537）：把 `apply_conflict` 分类并给出 `resolveHint`——先 `listUntrackedFiles` 取未跟踪集（路径统一反斜杠→斜杠），命中即 `untracked_conflict` + `applyConflictUntrackedHint`；否则 `git.status().dirty` → `local_dirty` + `applyConflictLocalDirtyHint`；否则 `content_conflict` + `applyConflictContentHint`。preview 里只取前 5 个路径。

### 视图、绑定解析与锁

- **`inspectIsolated(binding, persistRecovery = true)`**（855-963）：`discarded` + `delivered` 走 `committedFollowupView`；`recovery_required` 且 `journal === null` 且目录仍在时，先用 `validateManagedCheckoutDetailed` 尝试修复回 `ready`；只有 `invalid` 才持久化 recovery；命中 `ready_for_review` 时计算 `reviewSlot`（`activePreview` 由 `holdsProjectAcceptanceSlot` 判定）。
- **`getPersistedBinding(sessionId)`**（965-967）。
- **`runtimeContext(sessionId, cwd?)`**（969-1110）：给模型的运行时指引。Local 分支按 pending 给 5 类提示（无 pending / `preview_active` / `preview_detached` / 待处理 handoff / 本会话持有）。Isolated 分支：`recovery_required`、`discarded`+`delivered`（已交付并清理，允许 Local 普通工作，要新改动先 `worktree_begin_next_iteration`）、**交付后语义 1050-1064**（`finalized` 或 `retained` 且 cwd 不在 `managedRoot` 时输出 `Session Target: Local Checkout（已交付）`、`Working boundary: <localRoot>`、明确允许在 Local 工作、`Task commit is on session branch <branch>.`（无 `sessionBranch` 时说明是 legacy 无会话分支）、提示用 `worktree_merge` 合并会话分支、`worktree_cleanup` 清理冻结运行时），消除「人在 Local 却禁止写 Local」的自相矛盾；否则输出 Isolated Checkout 权威 cwd 与 write-guard 规则（1066-1109，含 `insideWorktree` 判定、checkpoints 提示、各 `delivery.state` 的交付指令，`working` 态在 autoDeliver 下要求用 `worktree_deliver` 只提交会话分支、Local 不动）。
- **`resolveBinding(sessionId)`**（1112-1147）：`project_mismatch` / `target_unselected`；`discarded`+`delivered` 且 `workspace.root` 等于 `managedRoot` 时放行。
- **`withBindingLock(operation, {allowConcurrentInspect?})`**（1179-1214）：`BindingOperationMode`（1149）与队列变量 `bindingQueue` / `activeBindingOperation` / `pendingMaintenanceOperations` / `maintenanceReady` / `activeMaintenanceInspects`（1151-1159）。maintenance 模式先关只读旁路，再等已启动的 inspect 排空。
- **`inspectTarget`**（1216-1220）、**`inspectDuringMaintenance`**（1222-1232，只读不写 registry）、**`inspectAvailable`**（1234-1250）。

### 生命周期操作

- **`reconcile()`**（1252-1499）：清 `discarded` 空壳与空容器；回收 predecessor 记录；`finalized` 直接进 `cleanupFinalized`（`withCleanupTimeout` 兜底）；按 journal step 确定性收敛（checkpoint 走 `applyEngine.recoverCheckpoint`；preview 的 `planning`/`writing_local`/`artifacts_retained` 回 `ready`；`finalize_preview`/`finish` 的 `update_ref`/`replacing_index` 等进 `recovery_required`）；统计孤儿/脏记录；结尾 `cleanupExpiredRetained`。
- **`operationError(code, message, target?)`**（1501-1507）、**`updateManagedCheckout(checkoutId, mutate)`**（1560-1572）。
- **`markReadyForReviewTarget(sessionId, input)`**（1574-1650）：长度上限 summary ≤240、commitMessage ≤500、details ≤12000、validationSummary ≤500、tests ≤20；`inspectReview` 产出 `reviewId` / `changedFiles` / `isolatedFingerprint` / `isolatedHeadOid`。
- **`operateCheckpoint`**（1652-1881）：`requestId` 幂等重放、`expectedGeneration` CAS、`preview_active` 先 rollback；journal `planning` → `updating_ref` 并 `retainInternalArtifact('checkpoints/<id>')`；提交后 delivery 回 `working`。
- **`resumeRevisionTarget`**（1883-1954）、**`prepareReviewRegenerationTarget`**（1956-1987）、**`preparePreviewRecoveryAnalysisTarget`**（1989-2023）、**`createPreviewRecoveryHandoffTarget`**（2025-2071）。
- **`operateApply`**（2073-2230）：旧的「写回 Local」路径。开头插入 legacy 门（2109-2110）；冲突时用 `explainApplyConflict` 填充 `reason` + `resolveHint`（2128-2145）。
- **`holdsProjectAcceptanceSlot`**（2232-2238）、**`findProjectAcceptanceHolder`**（2240-2250）、**`retainPreviewArtifacts`**（2252-2258）、**`releasePreviewArtifactsBestEffort`**（2260-2266）、**`previewArtifactsMatch`**（2268-2280）。
- **`blockedPreviewRecovery`**（2282-2299）、**`canonicalJson`**（2301-2310，数组/对象递归键排序并过滤 `undefined`）、**`sha256Facts`**（2312-2314）、**`recoveryGeneration`**（2316-2318）。
- **`preflightPreviewRecoveryTarget`**（2320-2406）：`not_owner` → `checkout_unavailable` → `stale_target` → `not_preview_detached` → `checkout_unavailable` → `artifacts_missing` → `assessPreviewRecovery` → `git_error`；项目验收槽被占时 rollback/finalize 都置 `{status:'blocked', code:'project_acceptance_busy'}` 并附 `blocker`；facts 含 `receiptFingerprint`、`localFingerprint`、`localHeadOid`/`localHeadRef`/`localHeadTreeOid`/`localIndexTreeOid`/`localWorkingTreeOid`、`rollback`、`finalize`，二次 CAS 后返回 `{status:'assessed', localModified:false, proof:{…, generation}}`。
- **`recoveryProofMatches(left, right)`**（2408-2412）、**`blockedPreflight`**（2414-2437）、**`preflightTarget(sessionId, expectedRevision)`**（2439-2517）：`applyEngine.preflight` 后按 `changedFiles` 空 → `already_in_local`、`localHeadOid !== baseOid` → `local_advanced`、否则 `ready`。
- **`operatePreview`**（2519-2669）：legacy 门之后写 journal `planning`，`plan` 冲突则回 `ready` 并用 `explainApplyConflict` 返回 `apply_conflict`；`writing_local` 阶段在 `beforeWrite` 内 `retainPreviewArtifacts` + delivery `preview_active` + journal `artifacts_retained`；成功返回 `{status:'previewed'}`。
- **`detachPreviewAfterLocalDrift`**（2671-2708）：`preview_active` → `preview_detached`（`detachedAt`/`reason`/`attemptedAction`）。
- **`operateRollbackPreview`**（2710-2815）：detached 恢复需 `recoveryProofMatches` + `proof.rollback.status === 'safe'`；成功按 `resumeRevision` 回 `working` 或 `ready_for_review`。
- **`retainFinalized(record, retention)`**（2817-2843）：`finalized` → `retained`，写 `retention`/`retainedAt`/`expiresAt`/`cleanup:'scheduled'`。
- **`collectEmptyManagedContainer(managedGitRoot, excludedCheckoutId)`**（2849-2863）。
- **`cleanupFinalized(record, {allowLegacyResidue?})`**（2865-3049）：非 `finalized`/`retained` 直接 `directory_busy`；`identity_changed` 直接复述；`hasLegacyCleanupResidueEvidence` 且 `managedGitRoot` 仍在 → `detached_residue`；binding 优先取 registry 里的 isolated 绑定，否则 `bindingForManagedRecord`；`beginRemoval` 写 journal `{operation:'cleanup', step:'removing_worktree', …}`；`quarantineAndRemove` 走 `.dsh-wt-cleanup--…` 隔离目录；`removeWorktree` 后若目录仍在，转 `validateDetachedCleanupResidue` + 隔离链；收尾 `collectEmptyManagedContainer`、`releaseApplyBaseBestEffort`，并把记录写成 `phase:'discarded'` + `delivery.state:'delivered'`；`catch` 打 `console.warn('[session-checkout] finalized Worktree cleanup failed:', error)`，`finalized` 记 `cleanup:'pending'`、`retained` 记 `cleanup:'blocked'`。
- **`operateFinalizePreview`**（3052-3193）：`preview_detached` 时先验 `proof.finalize.status === 'safe'`，再走 legacy 门（3088-3090）；`applyEngine.finalize` 的 `beforeCommit` 写 journal `updating_ref` + `commitOid`；成功写 `delivery.state:'finalized'` 与 `proof`，`retention !== 'cleanup'` 走 `retainFinalized`，否则 `cleanupFinalized`。
- **`operateRetryCleanup`**（3195-3220）：仅 `finalized`/`retained` 可重试。
- **`operateFinish`**（3222-3457）：见下节「会话分支交付链」。
- **`releaseApplyBaseBestEffort(record)`**（3459-3467）：释放 apply base 与内部 artifact，失败只 `console.warn(hostMessage('internalRefsCleanupFailed'))`。
- **`operateDiscard`**（3469-3633）：`preview_active` 需 `rollbackPreview` 或拒绝；`recovery_required` 且目录已消失 → 直接 `discarded`；`ready` 且目录连同 git 顶层都没了 → prune + 清台账；脏工作树需 `confirmDirty`，并先 `snapshotAbandonedWorktree` 固化放弃快照（3597-3612，快照失败则中止放弃）。
- **`operateRecover`**（3635-3697）：终态记录（`delivered`/`discarded`/`finalized`/`retained`）不允许被 Recover 复活；`journal.operation === 'create'` 且有 creation 证据 → `recovery_unsafe`；有 journal 时先 `reconcile()` 收敛再判断。
- **`operateTarget`**（3699-3717）：按 `action` 分发（`apply`/`finish`/`preview`/`checkpoint`/`rollback_preview`/`finalize_preview`/`retry_cleanup`/`discard`/`recover`），`SessionCheckoutError` 转 `operationError`。

### 会话分支交付链（`operateFinish`，3222-3457）

1. 身份与前置校验：owner（继承会话 → `aSessionThatInheritedItsSessionTargetCannotPerform162`）→ 只接受 isolated → `commitMessage` trim 非空且 ≤500 → `checkout_missing` → `stale_target` → `expectedReviewId` 不符 → `stale_target`。
2. **历史 wrote-to-Local 记录**（`record.applyBaseOid && (state === 'working' || state === 'ready_for_review')`）→ `operation_not_allowed('thisLegacyWorktreeWasWrittenToLocalThroughAn')`。
3. 状态门：`phase !== 'ready'` 或 `preview_active`/`preview_detached` → `operation_not_allowed`；项目验收槽被占 → `project_acceptance_busy`；`inspectIsolated` 后 `phase` 非 `ready` → `recovery_required`。
4. 引擎能力探测：`const reviewIsolated = engine.reviewIsolated ? engine.reviewIsolated.bind(engine) : undefined`（3279-3282，注释：「bind 回引擎实例：这些方法通过 this 访问内部状态，脱开实例调用会崩」），缺任一 → `operation_not_allowed('thisVersionCannotDeliverToASessionBranch')`。
5. 写 journal `{operation:'finish', step:'committing_session_branch', baseOid: applyBaseOid}`（3290-3301）。
6. **`ensureSessionBranch(mutating)`**（3313-3319，注释：先挂会话分支再只在该分支提交，Local 全程不被读写）；失败 → `restoreReady()` + 错误。`branchRef = deliverable.sessionBranch ?? null`。
7. `reviewIsolated({isolatedPath: deliverable.managedRoot, baseOid: applyBaseOid})`；`expectedReviewId` 下 `reviewId`/`isolatedFingerprint`/`isolatedHeadOid` 任一不符 → 回 `working` + `stale_isolated`。
8. 沿用 `ready_for_review` 的 review，否则现造一个：`reviewId = operationId`、`summary = hostMessage('skipLocalAcceptanceAndCommitDirectly')`、`validationStatus: 'not_run'`、`suggestedCommitMessage = finishCommitMessage`（3355-3366）。
9. **`commitIsolated({isolatedPath, baseOid, commitMessage, branchRef})`**（3382-3387）；失败 → `restoreReady()`。
10. 写 `delivery.state:'finalized'` 与 `proof`：`localBranch: branchNameOf(branchRef)`、`localHeadBefore: isolatedReview.isolatedHeadOid`、`localHeadAfter: committed.commitOid`、`changedFiles`、`validationStatus/Summary`（3408-3420）。
11. 自动 push：`(liveConfigValue(dependencies.autoPush) ?? true) && dependencies.git.pushBranch` → `pushLocalBranchBestEffort(dependencies.git.pushBranch, deliverable.managedRoot)`（3436-3439；注释 3425-3426 说明推的是**会话分支**而非 Local 分支，新分支通常没有 upstream，于是退化成「已跳过」备注，不会误推）。
12. 收尾：`branchName = branchNameOf(branchRef)`，`retention !== 'cleanup'` 走 `retainFinalized`，否则 `cleanupFinalized`；两者都在结果里带 `branch`（有会话分支时）与 `push`。

### 清理资格、列表与管理

- **`managedIteration`**（3719-3722）、**`managedUpdatedAt`**（3724-3732）。
- **`summarizeManagedWorktree(record, includeDiagnostics = false)`**（3734-3825）：快速列表保守且不扫 Git/磁盘；`includeDiagnostics` 时才算 dirty、残留、字节数；`state` 由 `staleRoot` / `phase` / `delivery.state` 组合得出（`needs_attention`、`retained`、`cleanup_pending`、`preview_active`、`ready_for_review`、`delivered`、`working`）。
- **`cleanupBlocked(reason, message, revision)`**（3827-3829）、**`inspectCleanupForRecord(record)`**（3831-3885）：按 `delivery.state` 与指纹给出 `safe` / `retained` / `blocked` 及结构化原因。
- **`inspectManagedWorktreeCleanup`**（3887-3899）、**`bulkCleanupManagedWorktrees`**（3901-3950，逐条 CAS 后 `cleanupFinalized`）、**`listManagedWorktrees`**（3952-3961）、**`listManagedWorktreesForSession`**（3963-3977）。
- **`pruneMergedBranchesInRepo`**（3986-4051）：只删「已完全合并」的本地分支（`git branch -d` 语义），当前分支与主干永不进候选；主干名从 `origin/HEAD` → `init.defaultBranch` 推断；合并基准优先主干，否则退回当前 HEAD；`olderThanDays` 需 `branchTipTimes`，端口缺该能力时直接拒绝而不是放宽。
- **`pruneMergedBranchesForSession`**（4053-4069）、**`autoPruneStaleMergedBranches`**（4076-4096）。
- **`mergeBranchForSession(sessionId, input)`**（4098-4174）：`managedRootByBranch` 先注册 `record.sessionBranch`（4122-4126），再补各 Worktree 的当前分支；来源分支等于 Local 当前分支直接 `invalid_input`；**分支找不到时区分**「属于另一个会话 X 的分支」（`not_owner`，指名 `ownerSessionId`，4136-4151）与「不属于本会话」；真实合并（非 dryRun）前检查项目验收槽（含本会话，4158-4163）；`direction === 'reverse'` 把 Local 当前分支合进任务 worktree，冲突现场留在 worktree。
- **`listAbandonedWorktreeSnapshots`**（4176-4192）、**`restoreAbandonedWorktreeSnapshot`**（4194-4217）。
- **`manageManagedWorktreeForSession`**（4219-4238）、**`manageManagedWorktree`**（4240-4317，`discard` / `set_retention` / `set_permanent` / `clear_sidebar_badge` / 清理）。
- **`observeManagedCheckout`**（4319-4325）、**`observeManagedCheckouts`**（4327-4330）、**`resolveManagedRoot`**（4332-4334）、**`resolveRoots`**（4341-4344）。
- **`retryableCleanupBlock`**（4352-4356）、**`cleanupExpiredRetained(now)`**（4358-4378）、**`enforceWorktreeKeepCount()`**（4386-4408）：`permanent` 与进行中记录豁免，只逐出最旧的 `finalized`/`retained`，且必须走 `cleanupFinalized`（不能复用 `operateDiscard`——它对 `finalized`/`retained` 一律拒绝）。
- **`beginNextIterationTarget(sessionId, expectedRevision)`**（4410-4614）：要求 predecessor 已是 `discarded`+`delivered`、owner 与 cwd 归属匹配（managed 或 Local 边界都接受，4433-4443）、旧路径未复活、Local 项目与 git 身份未变；**迭代以「上一轮会话分支 tip」为 `iterationBaseOid`**（`branchNameOf(predecessor.sessionBranch) ?? branchNameOf(predecessor.sourceRef)` → `resolveLocalBranchTip`），解析不到才退回 `snapshot.headOid`（4469-4474，注释说明否则迭代链会在交付处断开、上一轮工作整段丢失）；重建后 `attachSessionBranch` 重新挂会话分支并同步 `sourceRef`/`sessionBinding.sourceRef`（4554-4572）。
- **`copyWorktreeincludeFiles`**（4620-4642）、**`carryLocalWorkInProgress`**（4648-4674）、**`repairStaleWorktreeLinks`**（4676-4709）。
- **`bindTarget(sessionId, choice, createAttempt, requestStartedAt, sourceSessionId, createOptions)`**（4711-5045）：创建路径在 `createDetachedWorktree` 成功后立即 `attachSessionBranch`（4964-4969），`readyRecord` 同时写 `sessionBranch` 与 `sourceRef` 为同一个 branch ref（4976-4983，注释说明旧语义会让侧栏与交付把别人的分支当成归属），`binding.sourceRef` 同步（4988-4990）；失败按 `WorktreeCreationFailure` / 残留是否清掉决定 `markRecoveryRequired` 还是重试（5040-5043）。

### 工厂返回的公开接口（5047-5146）

| 成员 | 行号 | 说明 |
| --- | --- | --- |
| `inspect` | 5048 | → `inspectAvailable` |
| `runtimeContext` | 5049 | 模型运行时指引 |
| `preflight` | 5050-5052 | 加锁 → `preflightTarget` |
| `preflightPreviewRecovery` | 5053-5056 | `allowConcurrentInspect: true` |
| `runExclusiveSessionMutation` | 5057-5059 | 独占变更包装 |
| `bind` | 5060-5063 | 加锁 → `bindTarget` |
| `createIsolatedTarget` | 5064-5089 | in-place 与独立会话两种形态 |
| `beginNextIteration` | 5090-5092 | 下一轮迭代 |
| `resumeRevision` | 5093-5095 | 恢复编辑 Review |
| `prepareReviewRegeneration` | 5096-5098 | `stale_isolated` 时重出 Review |
| `preparePreviewRecoveryAnalysis` | 5099-5101 | 预览恢复分析 |
| `createPreviewRecoveryHandoff` | 5102-5104 | 预览恢复移交 |
| `markReadyForReview` | 5105-5107 | 标记 Review |
| `operate` | 5108 | 操作分发 |
| `isAutoDeliverEnabled` | 5110 | 暴露 autoDeliver 实时取值 |
| `listManagedWorktrees` / `listManagedWorktreesForSession` | 5112-5113 | 只读列表，不加全局锁 |
| `pruneMergedBranchesForSession` / `autoPruneStaleMergedBranches` | 5114-5119 | 分支修剪 |
| `mergeBranchForSession` | 5120-5122 | 合并会话分支 |
| `listAbandonedWorktreeSnapshots` / `restoreAbandonedWorktreeSnapshot` | 5123-5126 | 放弃快照 |
| `manageManagedWorktreeForSession` | 5127-5129 | 受限管理工作台 |
| `inspectManagedWorktreeCleanup` | 5130 | 清理资格检查 |
| `bulkCleanupManagedWorktrees` / `manageManagedWorktree` | 5131-5132 | 批量清理与管理工作台 |
| `resolveManagedRoot` / `resolveRoots` | 5133-5134 | 路径解析 |
| `observeManagedCheckout` / `observeManagedCheckouts` | 5135-5136 | 纯读观察 |
| `cleanupExpiredRetained` / `enforceWorktreeKeepCount` | 5137-5144 | `allowConcurrentInspect: true` |
| `reconcile` | 5145 | `allowConcurrentInspect: true` |

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
- **`SessionCheckoutGitPort`**（81-179）。与本文强相关的可选能力：`resolveLocalBranchTip`（90，判断会话分支是否已存在）、**`attachWorktreeBranch(managedRoot, branchRef, headOid, expectedOldOid)`**（96-103，注释明确「点向会话自有分支而不动任何文件；`expectedOldOid` 为 null 时只在 ref 不存在时创建，避免并发会话丢提交；不实现该方法的端口保持 legacy detached-HEAD 行为」）、`pushBranch`（115-120）、`repairWorktreeLinks`（121-126）、`pruneWorktrees`（127-131）、`branchOverview`（132-137）、`defaultBranch`（138-142）、`branchTipTimes`（143-147）、`deleteLocalBranch`（148-149）、`mergeLocalBranch`（150-155）、`snapshotAbandonedWorktree`（171-176）、`restoreAbandonedSnapshot`（177-178）。
- **`DirectoryIdentity`**（181-185）：`device`、`inode`、`birthtimeNs`。
- **`SessionCheckoutFilesPort`**（187-204）。
- **`SessionBindingRecord`**（206-216）：`sessionId`、`projectId`、`projectName`、`target`、`ownerSessionId`、`inheritedFromSessionId?`、`sourceRef`、`sourceOid`、`revision`。
- **`ManagedCheckoutJournalBase`**（218-221）、**`WorktreeCreationEvidence`**（223-235）、**`ManagedCheckoutCreateJournal`**（237-241）。
- **`ManagedCheckoutMutationJournal`**（243-278）：`operation` 为 `'apply' | 'preview' | 'checkpoint' | 'rollback_preview' | 'finish' | 'finalize_preview' | 'cleanup'`；`step` 为 `'planning' | 'artifacts_retained' | 'committing_session_branch' | 'writing_local' | 'updating_ref' | 'replacing_index' | 'removing_worktree'`——其中 **`committing_session_branch`**（248）是为会话分支交付新增的步骤；字段含 `baseOid?`、`planRevision?`、`previewId?`、`reviewId?`、`localFingerprint?`、`isolatedFingerprint?`、`effectiveBaseOid?`、`baseStrategy?`、`localHeadOid?`、`isolatedHeadOid?`、`commitOid?`、`checkpointId?`、`checkpointSequence?`、`checkpointRequestId?`、`checkpointRequestedRevision?`、`checkpointMessage?`、`checkpointIndexTreeOid?`、`parentOid?`、`retention?`、`recoveryGeneration?`、`resumeRevision?`、`changedFiles?`、`managedDirectoryIdentity?`、`cleanupQuarantinePath?`。
- **`ManagedWorktreeCheckpointRecord`**（282-299）、**`ManagedWorktreePreviousReviewRecord`**（301-308）、**`ManagedWorktreeReviewRecord`**（310-323）、**`ManagedPreviewReceipt`**（325-344）、**`ManagedDeliveryProof`**（346-354）。
- **恢复继续上下文**（356-396）：`ManagedApplyConflictRecoveryContinuation`、`ManagedReviewRegenerationContinuation`、`ManagedPreviewRecoveryAnalysisContinuation`、`ManagedPreviewRecoveryHandoffContinuation`，以及联合 `ManagedRecoveryContinuation`。
- **`ManagedCheckoutDelivery`**（398-434）：与 `WorktreeDeliveryView` 对应的持久化形态（`finalized`/`retained` 额外带 `isolatedFingerprint`、`finalizedAt`）。
- **`ManagedCheckoutRecord`**（436-482）字段全集：`checkoutId`、`predecessorCheckoutId?`、`projectId`、`projectName`、`ownerSessionId`、`sourceSessionId?`、`localRoot`、`managedRoot`、`managedGitRoot`、`gitCommonDir`、`gitDir`、`baseOid`、`applyBaseOid?`、`previousReview?`、`checkpoints?`、`recoveryContinuation?`、`abandonedSnapshotOid?`、`abandonedSnapshotAt?`、`permanent?`、`sidebarBadgeClearedRevision?`、`sourceRef`、**`sessionBranch?`**（469-477，注释：本 Worktree 提交所用的会话自有分支 `refs/heads/feat/sess-…`；历史记录缺失，交付时改为把 Worktree 采纳到新建分支而不是复用 `sourceRef`——对那些记录 `sourceRef` 只表示会话恰好从哪条 Local 分支分叉）、`phase`、`delivery`、`journal`、`revision`。
- **`ManagedCheckoutsRegistry`**（484-489）、**`SessionCheckoutRegistryPort`**（491-494）、**`LiveValue` / `liveConfigValue`**（496-507）。
- **`SessionCheckoutDependencies`**（509-541）：`lookup`、`git`、`files`、`registry`、`applyEngine`、`managedCheckoutsRoot`、`createCheckoutId()`、`autoPush?`、`autoDeliver?`、`worktreesRoot?`、`inheritLocalChanges?`、`worktreeKeepCount?`（默认 15，0 关闭）。

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
│  │ 4711-5045   │   │ finish       │   │ inspectCleanupForRecord   │  │
│  └──────┬──────┘   │ 3222-3457    │   └─────────────┬─────────────┘  │
│         │          └──────┬───────┘                 │                │
│         └────────► withBindingLock (1179-1214) ◄─────┘                │
│                     exclusive / maintenance / draining                │
│                            │                                          │
│         ┌──────────────────┼──────────────────┬────────────────────┐ │
│         ▼                  ▼                  ▼                    ▼ │
│  ┌────────────┐  ┌────────────────┐  ┌──────────────┐  ┌──────────┐ │
│  │ 身份校验    │  │ applyEngine    │  │ registry     │  │ git port │ │
│  │ validate*  │  │ plan/preview/  │  │ v2 读写      │  │ branch/  │ │
│  │ 588-735    │  │ finalize/      │  │ 1560-1572    │  │ worktree │ │
│  │            │  │ reviewIsolated │  │              │  │ 端口 81+ │ │
│  │            │  │ commitIsolated │  │              │  │          │ │
│  └────────────┘  └────────────────┘  └──────────────┘  └──────────┘ │
│                                                                       │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ 会话分支层 attachSessionBranch(745) ensureSessionBranch(786)    │  │
│  │ refuseLegacyLocalWrite(1546)  ──► 交付只写 refs/heads/feat/…    │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

## Data Flow

1. **绑定与创建**：`bind` / `createIsolatedTarget` 经 `bindTarget`（4711-5045）解析项目与 git 快照、生成路径候选、写入 `preparing` 记录与 binding、`createDetachedWorktree` 后复验 git 身份，随后立即 `attachSessionBranch` 把 Worktree 挂到 `feat/sess-<会话>[--<主题>]`（4964-4969），`sessionBranch` 与 `sourceRef` 同写该 ref，记录转 `ready`。
2. **编辑与检查点**：改动只发生在 Worktree。`checkpoint` 用 `requestId` 幂等 + `expectedGeneration` CAS，在 `refs/…/checkpoints/<id>` 上留证，提交后回 `working`。
3. **Review 与 Preview**：`markReadyForReview` 固化 review 指纹；`preview` 在 receipt 保护下把改动写进 Local，`beforeWrite` 内先留工件再置 `preview_active`。Local 一旦漂移，预览进入 `preview_detached`，需要 `preflightPreviewRecovery` 生成的 proof 才能继续。
4. **交付（只写会话分支）**：`finish` 先 `ensureSessionBranch`（历史记录在此补建分支），再 `reviewIsolated` + `commitIsolated(branchRef)`，`proof.localBranch` 记会话分支名，自动 push 也推会话分支（3436-3439），Local 的三个面全程不读写。旧的 `apply` / `preview` / `finalize_preview` 在存在 `sessionBranch` 时被 `refuseLegacyLocalWrite` 拒绝并指向 `worktree_deliver`。
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

- **detached 兼容残留**：端口不实现 `attachWorktreeBranch` 时，`attachSessionBranch`（745-772）与 `ensureSessionBranch`（786-834）都只 warn 并退回旧行为，此时 `record.sessionBranch` 永不写入。
- **历史记录仍可写 Local**：`refuseLegacyLocalWrite`（1546-1558）只对存在 `sessionBranch` 的记录生效，因此旧版本创建、无会话分支的记录仍可走 `apply` / `preview` / `finalize_preview` 写回 Local；`operateFinish` 对这类 wrote-to-Local 中间态另有显式拒绝（3251-3258）。
- **迭代基点会退化**：`beginNextIterationTarget` 用 `resolveLocalBranchTip` 找上一轮会话分支 tip，找不到（分支被删/改名）就退回 Local 的 `headOid`（4469-4474），上一轮内容会在迭代链上断开——源码注释已点明这一点。
- **`operateFinish` 重读记录只校验 phase**：`ensureSessionBranch` 之前那次 registry 重读（3275-3277）只判 `phase !== 'ready'`，不再比 `revision`，并发窗口依赖 `withBindingLock` 与 `updateManagedCheckout` 的 CAS 兜底。
- **清理失败原因被折叠**：`cleanupFinalized` 的 `catch`（3029-3047）把所有异常降级成 `quarantine_busy` / `directory_busy` 的 `pending`/`blocked`，不区分底层错误类型，只能靠 `console.warn('[session-checkout] finalized Worktree cleanup failed:', error)` 定位。
- **`retain_24h` 是默认值**：调用方未显式给 `retention` 时（`DEFAULT_WORKTREE_RETENTION`，src/types.ts:39）冻结环境会留一天，磁盘占用与 `approximateBytes` 会持续到到期清理。
- **旧写回校验仍在**：`inspectCleanupForRecord`（3831-3885）在 `commit + proof` 时仍用 `validateCommittedLocalCheckout` + `isAncestor` 验证交付提交在 Local 历史里，这是写回语义的遗留；会话分支交付的提交不在 Local 历史中，该分支逻辑对这类记录不再成立。
- **双轨记录共存**：`ManagedCheckoutDelivery`（src/ports.ts:398-434）与 `ManagedWorktreeCleanupView`（src/types.ts:425-431）仍需兼容旧 registry 形态（`cleanupReason` 可选、`persistedCleanupReason` 回退文案映射），新旧记录在同一份台账里语义不完全一致。