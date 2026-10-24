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

`createSessionCheckoutModule`（src/session-checkout-module.ts:235-5176）是插件核心：一套从 Domi 移植来的 session-checkout 状态机，保留 receipt-first Local Preview、回滚/finalize、项目验收槽、崩溃恢复与 fingerprint CAS，同时把所有权适配到 Harness 分离的 source Local Session 与 target owner Session。全部持久化状态落在 `ManagedCheckoutsRegistry`（version 2，src/ports.ts:521-526）。

当前版本最关键的语义变化是**交付不再写回 Local**：每个受管 Worktree 在创建阶段就挂到属于自己会话的分支（`refs/heads/feat/sess-<会话>[--<主题>]`），`finish` 只在这条会话分支上提交，Local 的工作区、索引与 HEAD 全程不被读写；合并由 `mergeBranchForSession` 显式发起。为此模块新增了 `branchNameOf`（src/session-checkout-module.ts:231-233）、`attachSessionBranch`（743）、`ensureSessionBranch`（799）、`refuseLegacyLocalWrite`（1561）与 `explainApplyConflict`（1531）。同一语义已延伸到验收侧：`markReadyForReviewTarget`（1589）在 `inspectReview` 之前先 `ensureSessionBranch`，让验收指纹记录交付期真实的 HEAD 身份（详见「生命周期操作」）。

## Overview

模块管理「受管 Worktree」（Managed Worktree）的全生命周期：绑定会话、创建、检查点（Checkpoint）、预览（Preview）、Review、交付（Deliver/Finish）、保留（Retain）与清理（Cleanup）。三个机制贯穿始终：

- **互斥**：所有变更操作经 `withBindingLock`（src/session-checkout-module.ts:1194）串行化；maintenance 模式允许只读 `inspect` 并发旁路，但必须先关闭旁路并排空已启动的 inspect。
- **崩溃恢复**：`record.journal` 记录可重放的 receipt，`reconcile()`（1267）按 journal 的 step 把记录确定性收敛到 `ready` 或 `recovery_required`。
- **CAS / 指纹**：`revision`、`isolatedFingerprint`、`reviewId`、`generation` 共同构成乐观并发校验；Preview 用 receipt 记录写入前后的 Local 指纹，任何漂移都让预览进入 `preview_detached`。

本地适配特性（相对 Domi 原版）：

- **会话分支交付**：创建即挂分支，交付只提交会话分支（743、799、3244）。
- **清理收敛超时**：`withCleanupTimeout`（106-124）给启动期清理/收敛加 120s 兜底，单条被占用的损坏记录不再卡死应用启动。
- **自动推送**：Finish 成功后尽力推送**会话分支**（`pushLocalBranchBestEffort`，src/session-checkout-module.ts:127-138）；失败降级为「已跳过」备注。
- **仓库移动修复**：`git worktree repair` 重连断链 Worktree（`repairStaleWorktreeLinks`，4703）。
- **Worktree 根目录配置**：`worktreesRoot` + 主题命名（路径候选生成在 `createManagedWorktreePathCandidates`，src/managed-worktree-path.ts:132-175）。
- **继承未提交修改**：`carryLocalWorkInProgress`（4675），仅当基点等于 Local HEAD 时生效（门控在 4999）。
- **放弃快照**：带未提交内容放弃前固化快照（`operateDiscard` 3491）。
- **常驻标记**：`permanent` 豁免保留期到期清理与 LRU 逐出（4408）。

## Key Components

### 模块级常量与工具函数（src/session-checkout-module.ts）

- **`UNVERSIONED_OID` / `UNVERSIONED_REF`**（89-90）：未版本化项目的伪 OID 与伪 ref（`'unversioned'` / `'WORKING_TREE'`）。
- **`RETENTION_24H_MS` / `RETENTION_3D_MS`**（91-92）：保留期时长。
- **`CLEANUP_IDENTITY_CHANGED_MESSAGE`**（93）、**`CLEANUP_RESIDUE_MESSAGE`**（94）：清理被身份变更/残留证据挡住时的固定文案。
- **`TRANSIENT_CLEANUP_RETRY_DELAYS_MS`**（95）：`[100, 300, 800]`。
- **`CHECKOUT_CLEANUP_TIMEOUT_MS`**（104）：`120_000`，Windows 文件占用下防止清理无限挂起；注释（97-103）明确「不做取消」——超时后后台操作继续跑完，只保证启动收敛先走。
- **`withCleanupTimeout(checkoutId, operation)`**（106-124）：`Promise.race` 实现的 120s 兜底超时，超时返回 `null` 并 `console.warn`。
- **`pushLocalBranchBestEffort(push, localRoot)`**（127-138）：尽力推送，返回 `WorktreePushOutcome`，异常降级为 `{status:'failed', message}`。
- **`cleanupReasonForMessage(message)`**（140-148）：把历史清理文案（zh/en 关键词成对匹配）映射回结构化 `WorktreeCleanupReason`，只兜底旧持久化记录。
- **`persistedCleanupReason(delivery)`**（154-159）：优先读结构化 `cleanupReason`，否则回退文案映射。
- **`isTransientCleanupError(error)`**（161-168）：识别 `EBUSY` / `EPERM` / `EACCES` / `ENOTEMPTY` 等瞬时错误（code 或 message）。
- **`retryTransientCleanup(operation)`**（170-182）：按 `TRANSIENT_CLEANUP_RETRY_DELAYS_MS` 退避重试，最多 4 次尝试。
- **`retentionExpiresAt(mode, retainedAt)`**（184-188）：保留到期时间戳；`retain_24h` → +24h、`retain_3d` → +3d、`retain_manual` → `null`。
- **`pathForIdentity(path)`**（190-196）：realpath + 分隔符归一，仅用于身份比较；失败退回 `resolve` 结果。
- **`pathsEqual(left, right)`**（198-204）：Windows 下大小写不敏感的 realpath 后比较。
- **`resolvedPathsEqual(left, right)`**（207-213）：canonical 路径与 registry 原始路径比较，**不做 realpath**（注释 206），防止 Junction 冒充原目录。
- **`pathIsWithin(candidate, root)`**（220-228）：判断 `candidate` 是 `root` 本身或嵌套其下（包含而非相等，Session 常 `cd` 进子目录）。
- **`branchNameOf(ref)`**（231-233）：`refs/heads/x` → `x`；其他 ref（含 detached 的 `HEAD`）返回 `null`。会话分支名一律经它从 ref 取出。

### 工厂内基础件（绑定/校验/视图）

- **`requireSession(sessionId)`**（238）、**`resolveSessionProject(sessionId)`**（244，缺项目根时抛 `project_root_missing`，249-251）。
- **`inspectLocal(binding)`**（255）：Local 目标视图；先挂 `statusPromise` 并 noop catch 防 rejection 冒泡（260-261）。
- **`projectPreviousReview(record)`**（283-291）：保留 `reviewId`/`iteration`/`summary`/`suggestedCommitMessage`（**完整保留，不截断**），仅 `changedFiles.slice(0, 50)`（289）。
- **`projectCheckpoint(record)`**（293-303）：checkpoint 记录 → 视图投影。
- **`projectDelivery(record, commitInLocalHistory)`**（305-370）：按 `delivery.state` 投影 review/preview/proof/cleanup 视图；`cleanupMessage` 经 `hostPersistedCleanupMessage` 重译（343、356）。
- **`bindingForManagedRecord(record)`**（372-385）：从托管记录合成绑定记录（持久化绑定不匹配时兜底）。
- **`recoveryView(binding, record?, dirty)`**（387-410）：`phase` 为 `discarded` 时保持 `discarded`，否则 `recovery_required`。
- **`validateCommittedLocalCheckout(binding, record)`**（412-434）、**`committedFollowupView(binding, record)`**（436-483）：commit 是权威交付事实，残余环境异常只影响 cleanup，不把会话降级（注释 470）；用 `git.isAncestor` 判 `commitInLocalHistory`（448-459，无法判定时为 `null`）。
- **`saveCreationEvidence`**（485-494）、**`finishFailedCreation(sessionId, checkoutId, error, previous?)`**（496-519）、**`markRecoveryRequired(record)`**（521-536，revision/phase 双 CAS）。
- **`checkpointHeadInvariantHolds(record, managedRoot, headOid)`**（550-584）：先结构校验（sequence 连续、checkpointId/reviewId 去重，559-568），再并行取证（`readInternalArtifact` + `isAncestor` 链，`Promise.all`，569-577），最后验证末位 checkpoint 是 `headOid` 祖先（583）。
- **`validateManagedCheckoutDetailed(binding, record, requireCreateBase)`**（586-642）：多重身份判定——binding 四元组与 `managedRoot` 存在（591-597）、canonicalize 后 `pathsEqual(canonicalProjectRoot, canonicalLocalRoot)`（607）、`resolvedPathsEqual` 比较 canonical 与 registry 原始路径（621-623）、`pathsEqual` 比较 `snapshot.root`/`commonDir`/`gitDir`（624-628）；`requireCreateBase` 时要求 `headOid === baseOid`（629），否则校验检查点不变式（630）；`catch` 返回 `{status:'unavailable'}`（638-641），避免瞬时 Git/I/O 故障把健康 Worktree 判成 `recovery_required`。
- **`validateManagedCheckout`**（644-651）：上面函数的薄包装，只取 valid。
- **`directoryIdentitiesEqual`**（658-660）、**`hasCleanupRemovalReceipt`**（662-666）、**`hasLegacyCleanupResidueEvidence`**（668-675）、**`validateCleanupLocalIdentity`**（677-693）、**`validateDetachedCleanupResidue`**（695-733）：清理链的身份与残留取证。
- **`attachSessionBranch({localRoot, managedRoot, sessionId, topic})`**（743-785）：把新建/重建的 Worktree 从 detached HEAD 挂到会话分支。端口缺 `attachWorktreeBranch` 时 `console.warn` 并返回 `null`（749-753，退回旧 detached 行为）；否则取 `inspect(managedRoot).headOid`（754-755），对 `createSessionBranchCandidates`（src/managed-worktree-path.ts:63-75）逐个候选拼 `refs/heads/${branch}`，先用 `resolveLocalBranchTip` 取该名现有 tip（760）。**同名分支已存在时不再无条件跳过**：若 `existing === headOid`，或 `existing` 是当前 HEAD 的祖先（`isAncestor`），则视为可复用，用 `attach(managedRoot, branchRef, headOid, existing)`（CAS 到该 old 值）挂上去并复验（761-775）；其余情况换下一个候选名——**绝不覆盖带别的提交的同名分支**。分支不存在时 `attach(managedRoot, branchRef, headOid, null)` 创建，同样复验后才返回 `{branch, branchRef}`（776-783）。
- **`EnsureSessionBranchResult`**（787-789）：`{ok:true, record}` | `{ok:false, code, message}`。
- **`ensureSessionBranch(record)`**（799-849）：交付前保证 Worktree 挂在自己的会话分支上。端口缺 `attachWorktreeBranch` 时 warn 并原样 `ok:true`（800-806）；`inspect` 失败 → `recovery_required`（807-810）；`record.sessionBranch` 已存在且 `headRef` 相符则直接 `ok`（811-813）；有记录但 HEAD 已离开（例如 checkpoint 把 HEAD 写成游离提交）→ attach 回记录值并复验（815-827），attach 失败**另建独立会话分支**（注释 825，绝不覆盖别人提交）；`attachSessionBranch` 返回 null → `git_operation_failed`（836-838）；成功后 `updateManagedCheckout` 同时把 `sessionBranch` 与 `sourceRef` 写成同一个 branch ref（839-844）；记录不存在 → `checkout_missing`。**历史记录（旧版本创建、detached、`sourceRef` 记的是 Local 当时所在分支——可能属于别的会话）不复用 `sourceRef` 作为交付目标**（注释 791-798），`sourceRef` 从此只作「分叉来源」展示。
- **`validateCleanupQuarantine(record)`**（851-868）：校验隔离目录身份（目录名形如 `.dsh-wt-cleanup--<checkoutId 前 8 位>--<operationId>`，856-857）。
- **`inspectIsolated(binding, persistRecovery = true)`**（870-978）：`discarded` + `delivered` 走 `committedFollowupView`（882-893）；`recovery_required` 且 `journal === null` 且目录仍在时，先用 `validateManagedCheckoutDetailed` 尝试修复回 `ready`（895-916）；只有 `invalid` 才持久化 recovery（942），瞬时 `unavailable` 允许下次重试（注释 941）；命中 `ready_for_review` 时计算 `reviewSlot`（947-954、971-976）。
- **`getPersistedBinding(sessionId)`**（980-982）。
- **`runtimeContext(sessionId, cwd?)`**（984-1125）：给模型的运行时指引。Local 分支按 pending 记录给出提示：无 pending → 普通 Local 工作（1004-1010）；`preview_active` → 只读（1011-1017）；`preview_detached` → 恢复（1018-1024）；pending 属于别的会话 → handoff pending（1028-1034）；属于本会话 → 回到该 checkout 工作（1035-1040）。Isolated 分支：`recovery_required`（1044-1046）、`discarded`+`delivered`（1051-1058）、`finalized`/`retained` 且 cwd 不在 `managedRoot`（1065-1080）时输出「允许在 Local 工作」等提示，消除「人在 Local 却禁止写 Local」矛盾；否则输出 Isolated Checkout 权威 cwd 与 write-guard 规则（1081-1124，cwd 不在 Worktree 内时追加绝对路径规则 1094-1099）。
- **`resolveBinding(sessionId)`**（1127-1162）：`project_mismatch` / `target_unselected`；`discarded`+`delivered` 且 `workspace.root` 等于 `managedRoot` 时放行（1131-1158）。
- **`withBindingLock(operation, {allowConcurrentInspect?})`**（1194-1229）：排他/维护锁队列；maintenance 退出时先置 `maintenance_draining` 并等待已启动 inspect 排空（1217-1224）。
- **`inspectTarget`**（1231-1235）、**`inspectDuringMaintenance`**（1237-1247，只读不写 registry，注释 1241-1242）、**`inspectAvailable`**（1249-1265）。
- **`reconcile()`**（1267-1514）：清 `discarded` 空壳 cwd 与空容器（1277-1287，注释 1278-1280）；回收 predecessor 记录中断的下一轮创建（1288-1316）；`finalized` 记录经 `withCleanupTimeout` 进 `cleanupFinalized`（1496-1502，注释 1499）；按 journal step 确定性收敛（checkpoint 恢复 1339-1417、preview planning 1418-1435、finalize/finish planning 1436-1450、artifacts_retained 1451-1465）；其余 `preparing`/`mutating` → `recovery_required`（1466-1475）；结尾 `cleanupExpiredRetained`（1503）。
- **`operationError(code, message, target?)`**（1516-1522）。
- **`explainApplyConflict({localRoot, conflictingFiles})`**（1531-1552）：把 `apply_conflict` 分类并给出 `resolveHint`——先 `listUntrackedFiles` 取未跟踪集，命中即 `untracked_conflict`（1541-1546）；否则 `git.status().dirty` → `local_dirty`（1547-1550）；否则 `content_conflict`（1551）。
- **`refuseLegacyLocalWrite(record, binding)`**（1561-1573）：`if (!record.sessionBranch) return null`（1565）；否则旧的「写回 Local」操作一律返回 `operation_not_allowed`，并把 `inspectIsolated(binding)` 作为 target 指路 `worktree_deliver`。调用点：`operateApply`（2128）、`operatePreview`（2569）、`operateFinalizePreview`（3111）。
- **`updateManagedCheckout(checkoutId, mutate)`**（1575-1587）：CAS 写 registry。

### 生命周期操作

- **`markReadyForReviewTarget(sessionId, input)`**（1589-1670）：owner + isolated 校验（1594-1596）；`summary`/`suggestedCommitMessage` trim 后非空且通过 `isValidCommitMessage`、`tests ≤ 20`（1597-1601）；长度上限 **summary ≤240、detailsMarkdown ≤12000、validationSummary ≤500、单条 test command/summary ≤500**（1602-1609）——**`suggestedCommitMessage` 没有长度上限**（只要求合法）；record 门（1610-1614）；`inspectIsolated` 后 phase 非 `ready` → `recovery_required`（1615-1618）；**先 `ensureSessionBranch`（1619-1624，历史记录在此补建分支，否则交付时 headRef 从 DETACHED 变会话分支导致指纹必被误判 `stale_isolated`，注释 1619-1621）**；`inspectReview` 用 `applyBaseOid ?? baseOid`（1625-1629）；写 `ready_for_review` delivery 含 `isolatedFingerprint`/`isolatedHeadOid`（1634-1668）。
- **`operateCheckpoint`**（1672-1900）：`requestId` 幂等重放（1691-1706，`exactReplay` 才返回原 checkpoint）、`expectedGeneration` 64 位 hex CAS（1683、1713）、revision 双检（1707-1709、1724-1732）、`preview_active` 先 rollback（1734-1787）；journal `planning` → `updating_ref` 并 `retainInternalArtifact('checkpoints/<id>')`（1819-1844）；提交后 delivery 回 `working` 并追加 checkpoint 记录（1881-1892）。
- **`resumeRevisionTarget`**（1902-1973）、**`prepareReviewRegenerationTarget`**（1975-2006）、**`preparePreviewRecoveryAnalysisTarget`**（2008-2042）、**`createPreviewRecoveryHandoffTarget`**（2044-2090）。
- **`operateApply`**（2092-2249）：旧的「写回 Local」路径。开头插入 legacy 门（2128-2129）；冲突时用 `explainApplyConflict` 填充 `reason` + `resolveHint`（2147-2164）；`invalid_plan`/`stale_local`/`stale_isolated` 可证明未触碰 Local，恢复 `ready`（2229-2238）；成功更新 `applyBaseOid`（2241-2248）。
- **`holdsProjectAcceptanceSlot`**（2251-2257）、**`findProjectAcceptanceHolder`**（2259-2269）、**`retainPreviewArtifacts`**（2271-2277，四个内部 ref）、**`releasePreviewArtifactsBestEffort`**（2279-2285）、**`previewArtifactsMatch`**（2287-2299）。
- **`blockedPreviewRecovery`**（2301-2318）、**`canonicalJson`**（2320-2329，递归键排序并过滤 `undefined`）、**`sha256Facts`**（2331-2333）、**`recoveryGeneration`**（2335-2337）。
- **`preflightPreviewRecoveryTarget`**（2339-2425）：`not_owner` → `checkout_unavailable` → `stale_target` → `not_preview_detached` → `checkout_unavailable` → `artifacts_missing` → `assessPreviewRecovery` → `git_error`；项目验收槽被占时 rollback/finalize 都置 `{status:'blocked', code:'project_acceptance_busy'}`（2378-2387）；facts 含 `receiptFingerprint`、`localFingerprint` 等（2388-2404），二次 CAS 后返回 `{status:'assessed', localModified:false, proof:{…, generation}}`（2419-2420）。
- **`recoveryProofMatches(left, right)`**（2427-2431）、**`blockedPreflight`**（2433-2456）、**`preflightTarget(sessionId, expectedRevision)`**（2458-2536）：`applyEngine.preflight` 后按 `changedFiles` 空 → `already_in_local`、`localHeadOid !== baseOid` → `local_advanced`、否则 `ready`（2530-2534）。
- **`operatePreview`**（2538-2688）：legacy 门（2569-2570）之后写 journal `planning`，`plan` 冲突则回 `ready` 并用 `explainApplyConflict` 返回 `apply_conflict`（2597-2614）；`beforeWrite` 内 `retainPreviewArtifacts` + delivery `preview_active` + journal `artifacts_retained`（2654-2664）；成功返回 `{status:'previewed'}`（2679-2687）。
- **`detachPreviewAfterLocalDrift`**（2690-2727）：`preview_active` → `preview_detached`。
- **`operateRollbackPreview`**（2729-2834）：detached 恢复需 `recoveryProofMatches` + `proof.rollback.status === 'safe'`（2750-2767）；成功按 `resumeRevision` 回 `working` 或 `ready_for_review`（2823-2831）。
- **`retainFinalized(record, retention)`**（2836-2862）：`finalized` → `retained`，写 `retention`/`retainedAt`/`expiresAt`/`cleanup:'scheduled'`。
- **`collectEmptyManagedContainer(managedGitRoot, excludedCheckoutId)`**（2868-2882）：worktree 移除后回收空项目容器（`removeEmptyDirectoryTree` 遇任何条目返回 false，绝不删用户字节，注释 2864-2867）。
- **`cleanupFinalized(record, {allowLegacyResidue?})`**（2884-3068）：非 `finalized`/`retained` 直接 `directory_busy`（2913-2915）；`identity_changed` 直接复述（2916-2923）；`hasLegacyCleanupResidueEvidence` 且 `managedGitRoot` 仍在 → `detached_residue`（2924-2926）；`beginRemoval` 写 journal `{operation:'cleanup', step:'removing_worktree', managedDirectoryIdentity}`（2934-2956）；`quarantineAndRemove` 走 `.dsh-wt-cleanup--…` 隔离目录（2958-2988）；`removeWorktree` 后若目录仍在，转 `validateDetachedCleanupResidue` + 隔离链（3014-3018）；收尾 `collectEmptyManagedContainer`（3029）、`releaseApplyBaseBestEffort`（3030），并把记录写成 `phase:'discarded'` + `delivery.state:'delivered'`（3031-3046）；`catch` 打 `console.warn('[session-checkout] finalized Worktree cleanup failed:', error)`（3049），`finalized` 记 `cleanup:'pending'`、`retained` 记 `cleanup:'blocked'`（3056-3065）。
- **`operateFinalizePreview`**（3071-3215）：`preview_detached` 时先验 `proof.finalize.status === 'safe'`（3092-3109），再走 legacy 门（3110-3112）；`applyEngine.finalize` 的 `beforeCommit` 写 journal `updating_ref` + `commitOid`（3135-3143）；成功写 `delivery.state:'finalized'` 与 `proof`（3166-3191），`retention !== 'cleanup'` 走 `retainFinalized`（3193-3204），否则 `cleanupFinalized`（3205）。
- **`operateRetryCleanup`**（3217-3242）：仅 `finalized`/`retained` 可重试（3229-3231），`allowLegacyResidue: true`（3232）。
- **`operateFinish`**（3244-3479）：见下节「会话分支交付链」。
- **`releaseApplyBaseBestEffort(record)`**（3481-3489）：释放 apply base 与内部 artifact，失败只 `console.warn`（3486-3488）。
- **`operateDiscard`**（3491-3655）：`preview_active` 需 `rollbackPreview` 或拒绝（3521-3528）；`recovery_required` 且目录已消失 → 直接 `discarded`（3557-3566）；`ready` 且目录连同 git 顶层都没了 → prune + 清台账（3567-3584，注释 3567-3569）；脏工作树或未交付 checkpoint 需 `confirmDirty`（3600、3603、3609-3614），并先 `snapshotAbandonedWorktree` 固化放弃快照（3619-3634），快照失败则中止放弃（数据保护优先，注释 3616-3618）；带 creation 证据的记录 → `recovery_unsafe`（3553-3555）。
- **`operateRecover`**（3657-3719）：终态记录（`delivered`/`discarded`/`finalized`/`retained`）不允许被 Recover 复活（3673-3680，注释 3673-3674）；`journal.operation === 'create'` 且有 creation 证据 → `recovery_unsafe`（3681-3684）；有 journal 时先 `reconcile()` 收敛再判断（3685-3699，注释 3686-3687）；验证通过后写回 canonical 路径并转 `ready`（3709-3717）。
- **`operateTarget`**（3721-3739）：按 `action` 分发（`apply`/`finish`/`preview`/`checkpoint`/`rollback_preview`/`finalize_preview`/`retry_cleanup`/`discard`/`recover`，3724-3732），`SessionCheckoutError` 转 `operationError`（3735-3738）。

### 会话分支交付链（`operateFinish`，3244-3479）

1. 身份与前置校验：owner（3248）→ 只接受 isolated（3251）→ `commitMessage` trim 非空（3254-3257）且通过 `isValidCommitMessage`（3259-3261，**无长度上限**，多行/Unicode 正文原样提交，见 tests/session-checkout-module.test.ts:442-451）→ `checkout_missing`（3262-3263）→ `stale_target`（3264-3266）→ `expectedReviewId` 不符 → `stale_target`（3267-3272）。
2. **历史 wrote-to-Local 记录**（`record.applyBaseOid && (state === 'working' || state === 'ready_for_review')`，3273-3280）→ `operation_not_allowed`。
3. 状态门：`phase !== 'ready'` 或 `preview_active`/`preview_detached` → `operation_not_allowed`（3281-3283）；项目验收槽被占 → `project_acceptance_busy`（3284-3291）；`inspectIsolated` 后 `phase` 非 `ready` → `recovery_required`（3293-3300）。
4. 引擎能力探测：`reviewIsolated` / `commitIsolated` 缺失 → `operation_not_allowed('thisVersionCannotDeliverToASessionBranch')`（3301-3307；两者先 `.bind(engine)`，因为这些方法经 `this` 访问内部状态，注释 3301）。
5. 写 journal `{operation:'finish', step:'committing_session_branch', baseOid: applyBaseOid}`（3309-3324）。
6. **`ensureSessionBranch(mutating)`**（3335-3341，调用 799）；失败 → `restoreReady()` + 错误。`branchRef = deliverable.sessionBranch ?? null`（3343）。
7. `reviewIsolated({isolatedPath: deliverable.managedRoot, baseOid: applyBaseOid})`（3345-3349）；`expectedReviewId` 下 reviewId/指纹/HEAD 任一不符 → 回 `working` + `stale_isolated`（3350-3368）。
8. 沿用 `ready_for_review` 的 review，否则现造一个（3370-3388）。
9. **`commitIsolated({isolatedPath, baseOid, commitMessage, branchRef})`**（3404-3413）；失败 → `restoreReady()`。
10. 写 `delivery.state:'finalized'` 与 `proof`：`localBranch: branchNameOf(branchRef)`、`localHeadBefore/After` 等（3415-3445）。
11. 自动 push：`(liveConfigValue(dependencies.autoPush) ?? true) && dependencies.git.pushBranch` → `pushLocalBranchBestEffort`（3449-3452；推的是**会话分支**，新分支通常无 upstream，注释 3447-3448）。
12. 收尾：`retention !== 'cleanup'` 走 `retainFinalized`（3454-3466），否则 `cleanupFinalized`（3467）；两者都带 `branch`（3453）与 `push`。

### 清理资格、列表与管理

- **`managedIteration`**（3741-3744）、**`managedUpdatedAt`**（3746-3754）。
- **`summarizeManagedWorktree(record, includeDiagnostics = false)`**（3756-3847）：快速列表必须保守且不扫描 Git/磁盘（注释 3760）；`includeDiagnostics` 时才算 dirty、隔离/残留、`approximateBytes`（3764-3790）；`state` 由 `staleRoot` / `phase` / `delivery.state` 组合得出（3792-3809）；`canCleanup` 仅在诊断完成且非 dirty 时为 true（3845）。
- **`cleanupBlocked(reason, message, revision)`**（3849-3851）、**`inspectCleanupForRecord(record)`**（3853-3907）：按 `delivery.state` 与指纹给出 `safe` / `retained` / `blocked` 及结构化原因；retention 窗口未过或 `retain_manual` → `retained`（3900-3905）。
- **`inspectManagedWorktreeCleanup`**（3909-3921）、**`bulkCleanupManagedWorktrees`**（3923-3972，逐条 revision CAS 后 `cleanupFinalized`）、**`listManagedWorktrees`**（3974-3983）、**`listManagedWorktreesForSession`**（3985-3999）。
- **`pruneMergedBranchesInRepo`**（4008-4073）：只删「已完全合并」的本地分支（tip 可达主干，注释 4021）；主干名从 `origin/HEAD` → `init.defaultBranch` 推断（4023-4025），合并基准优先主干、退回当前 HEAD（4026-4028）；`olderThanDays` 需 `branchTipTimes`，端口缺该能力时直接拒绝而非放宽（4031-4038）。
- **`pruneMergedBranchesForSession`**（4075-4091）、**`autoPruneStaleMergedBranches`**（4098-4118，逐项目失败记为 skipped 条目，绝不抛出）。
- **`mergeBranchForSession(sessionId, input)`**（4120-4196）：先注册 `record.sessionBranch`，再补各 Worktree 的当前分支（4144-4152）；来源分支等于 Local 当前分支直接 `invalid_input`（4153-4157）；**分支找不到时区分**「属于另一个会话 X 的分支」（`not_owner` 并指名 owner，4158-4175）；真实合并（非 dryRun）前检查项目验收槽（4180-4185）；`direction === 'reverse'` 把 Local 当前分支合进任务 worktree，冲突现场留在 worktree（4186-4193）。
- **`listAbandonedWorktreeSnapshots`**（4198-4214）、**`restoreAbandonedWorktreeSnapshot`**（4216-4239）。
- **`manageManagedWorktreeForSession`**（4241-4260）、**`manageManagedWorktree`**（4262-4339，`discard` / `set_retention` / `set_permanent` / `clear_sidebar_badge` / 清理 fall-through；`clear_sidebar_badge` 刻意不 bump revision，注释 4321-4323）。
- **`observeManagedCheckout`**（4341-4347）、**`observeManagedCheckouts`**（4349-4352）、**`resolveManagedRoot`**（4354-4356）、**`resolveRoots`**（4358-4366，纯读 registry 不碰 Git）。
- **`retryableCleanupBlock`**（4374-4378，注释 4368-4373：暂时性占用必须留在定期重试里）、**`cleanupExpiredRetained(now)`**（4380-4400）：只清 `cleanup:'scheduled'` 或 `directory_busy`/`quarantine_busy` 阻塞的到期记录，`permanent` 豁免，逐条经 `withCleanupTimeout`（4393）。
- **`enforceWorktreeKeepCount()`**（4408-4430）：`permanent` 与进行中记录豁免（4413-4417），只逐出最旧的 `finalized`/`retained`；**必须走 `cleanupFinalized`**（4425）——不能复用 `operateDiscard`，它对 finalized/retained 一律返回 `operation_not_allowed`（注释 4422-4424）。
- **`beginNextIterationTarget(sessionId, expectedRevision)`**（4432-4641）：要求 predecessor 已是 `discarded`+`delivered`（4450-4452）、owner 与 cwd 归属匹配（4460-4466，in-place 会话 rooted 在 Local 边界也放行，注释 4455-4459）、旧路径未复活（4467-4469）、Local 项目与 git 身份未变（4471-4487）；**迭代以「上一轮会话分支 tip」为 `iterationBaseOid`**（`branchNameOf(predecessor.sessionBranch) ?? branchNameOf(predecessor.sourceRef)` → `resolveLocalBranchTip`，4488-4496），解析不到才退回 `snapshot.headOid`；重建后 `attachSessionBranch` 重新挂会话分支并同步 `sourceRef`/`sessionBinding.sourceRef`（4577-4599）。
- **`copyWorktreeincludeFiles`**（4647-4669）、**`carryLocalWorkInProgress`**（4675-4701）、**`repairStaleWorktreeLinks`**（4703-4736）。
- **`bindTarget(sessionId, choice, createAttempt, requestStartedAt, sourceSessionId, createOptions)`**（4738-5074）：in-place 升级仅认 `createIsolatedTarget(sourceSessionId, sourceSessionId, options)` 调用形（4760-4764）；终态 replaced binding 复用（4765-4789）；支持 `createOptions.branch` 以指定本地分支 tip 为 `baseOid`（4838-4845）；路径候选（8/12/32 位身份，4848-4858）与容器信任校验（4869-4918，同名未知目录非空即拒绝、空目录回收重建；EPERM/EACCES 报 OS 错误而非笼统信任错误，4907-4913）；创建路径在 `createDetachedWorktree` 成功后立即 `attachSessionBranch`（4989-4996），`readyRecord` 同时写 `sessionBranch` 与 `sourceRef` 为同一个 branch ref（5002-5016），`binding.sourceRef` 同步（5017-5019）；基点等于 Local HEAD 且 `inheritLocalChanges !== false` 时 `carryLocalWorkInProgress`（4997-5001）；失败按 `WorktreeCreationFailure` / 残留是否清掉决定 `markRecoveryRequired` 还是重试一次（5025-5073）。

### 工厂返回的公开接口（5076-5175）

| 成员 | 行号 | 说明 |
| --- | --- | --- |
| `inspect` | 5077 | → `inspectAvailable` |
| `runtimeContext` | 5078 | 模型运行时指引 |
| `preflight` | 5079-5081 | 加锁 → `preflightTarget` |
| `preflightPreviewRecovery` | 5082-5085 | `allowConcurrentInspect: true` |
| `runExclusiveSessionMutation` | 5086-5088 | 独占变更包装 |
| `bind` | 5089-5092 | 加锁 → `bindTarget` |
| `createIsolatedTarget` | 5093-5118 | in-place（targetSessionId === sourceSessionId，5096）与独立会话两种形态 |
| `beginNextIteration` | 5119-5121 | 下一轮迭代 |
| `resumeRevision` | 5122-5124 | 恢复编辑 Review |
| `prepareReviewRegeneration` | 5125-5127 | `stale_isolated` 时重出 Review |
| `preparePreviewRecoveryAnalysis` | 5128-5130 | 预览恢复分析 |
| `createPreviewRecoveryHandoff` | 5131-5133 | 预览恢复移交 |
| `markReadyForReview` | 5134-5136 | 标记 Review |
| `operate` | 5137 | 操作分发 |
| `isAutoDeliverEnabled` | 5138-5139 | 暴露 autoDeliver 实时取值 |
| `listManagedWorktrees` / `listManagedWorktreesForSession` | 5140-5142 | 只读列表，不加全局锁 |
| `pruneMergedBranchesForSession` / `autoPruneStaleMergedBranches` | 5143-5148 | 分支修剪 |
| `mergeBranchForSession` | 5149-5151 | 合并会话分支 |
| `listAbandonedWorktreeSnapshots` / `restoreAbandonedWorktreeSnapshot` | 5152-5155 | 放弃快照 |
| `manageManagedWorktreeForSession` | 5156-5158 | 受限管理工作台 |
| `inspectManagedWorktreeCleanup` | 5159 | 清理资格检查 |
| `bulkCleanupManagedWorktrees` / `manageManagedWorktree` | 5160-5161 | 批量清理与管理工作台 |
| `resolveManagedRoot` / `resolveRoots` | 5162-5163 | 路径解析 |
| `observeManagedCheckout` / `observeManagedCheckouts` | 5164-5165 | 纯读观察 |
| `cleanupExpiredRetained` / `enforceWorktreeKeepCount` | 5166-5173 | `allowConcurrentInspect: true` |
| `reconcile` | 5174 | `allowConcurrentInspect: true` |

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
- **`WorktreeDeliveryView`**（92-127）：7 种状态联合——`working{iteration}`、`ready_for_review{review}`、`preview_active{review, previewedAt}`、`preview_detached{review, previewedAt, detachedAt, reason, attemptedAction}`、`finalized{review, commitOid, proof?, cleanup, cleanupMessage?, cleanupReason?}`、`retained{…, retention, retainedAt, expiresAt, cleanup:'scheduled'|'blocked', cleanupMessage?, cleanupReason?}`、`delivered{iteration, commitOid, proof?, deliveredAt}`。
- **`WorktreeApplyPreflightBlockedReason`**（129-137）、**`WorktreeApplyPreflightFacts`**（139-150）、**`WorktreeAcceptanceBlockerView`**（152-157）、**`WorktreeApplyPreflightView`**（159-172）：`ready`/`local_advanced`/`already_in_local` | `conflict{conflictingFiles, conflictDetails?}` | `blocked{reason, message, blocker?}`，三者都带 `localModified: false`。
- **`SessionTargetProjectView`**（174-177）、**`SessionTargetCheckoutView`**（179-184）、**`SessionTargetSourceView`**（186-190）、**`SessionTargetCurrentView`**（192-196）。
- **`SessionTargetView`**（198-216）：`project`、`checkout`、`source`、`current`、`ownership`、`dirty`、`revision`、`delivery?`、`checkpoints?`、`checkpointGeneration?`、`reviewSlot?`、`reviewSlotOwnerSessionId?`。
- **`SessionTargetBindChoice`**（218-220）。
- 操作接口（227-342）：`SessionCheckoutApplyOperation`(227-229)、`SessionCheckoutFinishOperation`(231-237, 含 commitMessage/retention/expectedReviewId)、`SessionCheckoutPreviewOperation`(239-241)、`SessionCheckoutCheckpointOperation`(243-249, 含 commitMessage/expectedReviewId/expectedGeneration/requestId)、`WorktreePreviewRecoveryActionBlockReason`(251-256)、`WorktreePreviewRecoveryRollbackAction`(258-260)、`WorktreePreviewRecoveryFinalizeAction`(262-270)、`WorktreePreviewRecoveryProof`(273-291, 含 generation/receiptFingerprint/localFingerprint/rollback/finalize/blocker?)、`WorktreePreviewRecoveryPreflightBlockedReason`(293-299)、`WorktreePreviewRecoveryPreflightView`(301-312)、`SessionCheckoutRollbackPreviewOperation`(314-320, 含 resumeRevision?/recoveryProof?)、`SessionCheckoutFinalizePreviewOperation`(322-328)、`SessionCheckoutRetryCleanupOperation`(330-332)、`SessionCheckoutDiscardOperation`(334-338)、`SessionCheckoutRecoverOperation`(340-342)；`SessionCheckoutOperation`(344-353) 联合上述。
- 结果类型：`SessionCheckoutAppliedResult`(355-359)、`Previewed`(361-365)、`Checkpointed`(367-372)、`PreviewRolledBack`(374-378)、`PreviewDetached`(380-386)、`WorktreePushOutcome`(389-392)、`SessionCheckoutFinishedResult`(394-411, 含 branch/cleanup/cleanupMessage?/cleanupReason?/push?)、`ManagedWorktreeCleanupEligibility`(413)、`ManagedWorktreeCleanupBlockReason`(415-423)、`ManagedWorktreeCleanupView`(426-431)、`BulkCleanupManagedWorktreeCandidate`(433-436)、`BulkCleanupManagedWorktreesResult`(438-441)、`ManagedWorktreeSummaryView`(453-480, path-free 投影，含 `permanent?`/`approximateBytes`/`canCleanup`/`cleanup?`/`activeSessionIds?`)、`PruneMergedBranchEntry`(483-487)、`PruneMergedBranchesView`(489-494)、`AbandonedWorktreeSnapshotView`(497-503)。
- `ApplyBaseStrategy`(505-509)、`ApplyConflictDetail`(510-514)、`CONFLICT_DETAIL_FILE_LIMIT=6`(517)、`CONFLICT_DETAIL_DIFF_LIMIT=4096`(518)、`MergeLocalBranchOutcome`(520)、`MergeLocalBranchResult`(522-529)、`MergeBranchForSessionView`(531-540, 含 `direction: 'forward' | 'reverse'`)。
- `ApplyConflictReason`(548)：`content_conflict` / `local_dirty` / `untracked_conflict`。
- `SessionCheckoutConflictResult`(550-566, 含 `reason`/`resolveHint?`/`conflictDetails?`)、`Discarded`(568-571)、`Recovered`(573-576)、`SessionCheckoutOperationErrorResult`(578-583)、`SessionCheckoutOperationResult`(585-595)。
- `SESSION_CHECKOUT_ERROR_CODES`(597-627) 及 `SessionCheckoutErrorCode`(629)、`SessionCheckoutFailure`(631-634)。

### 端口契约（src/ports.ts）

- `SessionCheckoutSessionRecord`(21-26)、`SessionCheckoutProjectRecord`(28-32)、`SidebarDirectoryMembership`(34-38)、`SessionCheckoutLookupPort`(40-45)。
- `GitCheckoutSnapshot`(47-54)：`root`、`commonDir`、`gitDir`、`branch`、`headOid`、`headRef`。
- `BranchOverviewEntry`(57-62)、`TagOverviewEntry`(65-75, `name`/`oid`/`commitOid?`/`annotated`/`message?`/`pushed`)、`GraphLogCommit`(78-86)、`InitialCommitPreflight`(88-92)。
- `SessionCheckoutGitPort`(94-209)：核心方法 `inspect`(104)/`findContainingWorktreeRoot`(105-106)/`status`(107)/`createDetachedWorktree`(108)/`attachWorktreeBranch?`(116, CAS 到 `expectedOldOid`)/`removeWorktree`(117-118)/`retainApplyBase`(119)/`releaseApplyBase`(120)/`retainInternalArtifact`(121)/`readInternalArtifact`(122-123)/`releaseInternalArtifacts`(124)/`isAncestor`(125-126)；本地适配可选方法 `resolveLocalBranchTip?`(102-103)、`listLocalBranches?`(100-101)、`listWorktreeincludeFiles?`(127)、`pushBranch?`(128-133)、`repairWorktreeLinks?`(134-139)、`pruneWorktrees?`(140-144)、`branchOverview?`(145-150)、`defaultBranch?`(151-155)、`branchTipTimes?`(156-160)、`deleteLocalBranch?`(161-162)、`mergeLocalBranch?`(163-168)、`graphLog?`(169-170)、`createLocalBranch?`(171-172)、`switchLocalBranch?`(173-174)、`listTags?`(175-180)、`createTag?`(181-182)、`deleteLocalTag?`(183-184)、`pushTag?`(185-189)、`deleteRemoteTag?`(190-191)、`captureLocalWip?`(192-196)、`applyWorktreePatch?`(197-198)、`listUntrackedFiles?`(199-200)、`snapshotAbandonedWorktree?`(201-206)、`restoreAbandonedSnapshot?`(207-208)。
- `DirectoryIdentity`(211-215)：`device`/`inode`/`birthtimeNs`。
- `SessionCheckoutFilesPort`(217-234)：`exists`/`canonicalize`/`inspectDirectoryIdentity`/`ensureDirectory`/`removeEmptyDirectoryTree`/`quarantineDirectoryTree`/`removeDirectoryTree`/`measureDirectoryBytes`/`readTextFile?`/`copyFile?`/`isSymbolicLink?`。
- `SessionBindingRecord`(236-246)：`sessionId`、`projectId`、`projectName`、`target`、`ownerSessionId`、`inheritedFromSessionId?`、`sourceRef`、`sourceOid`、`revision`。
- `WorktreeCreationEvidence`(253-265)：`root`、`rootIdentity`、`parentIdentity`、`commonDir`、`commonIdentity`、`lockReason`、`gitDir?`、`gitIdentity?`、`metadataFingerprint?`、`indexFingerprint?`、`quarantinePath?`。
- `ManagedCheckoutCreateJournal`(267-271)、`ManagedCheckoutMutationJournal`(273-308, operation 枚举含 `cleanup`，step 枚举含会话分支交付专用的 `committing_session_branch`(278) 及 `cleanupQuarantinePath?`(307))、`ManagedCheckoutJournal`(310)。
- `ManagedWorktreeCheckpointRecord`(312-329, 含幂等键 `requestId?`/`requestedRevision?`/`generation?`)、`ManagedWorktreePreviousReviewRecord`(331-338)、`ManagedWorktreeReviewRecord`(340-353)、`ManagedPreviewReceipt`(355-374, 含 `localWorkingTreeOid`/`localIndexTreeOid`/`previewWorkingTreeOid`/`isolatedSnapshotOid` 四个回滚锚点)、`ManagedDeliveryProof`(376-384)。
- 恢复续传类型：`ManagedApplyConflictRecoveryContinuation`(386-394)、`ManagedReviewRegenerationContinuation`(396-401)、`ManagedPreviewRecoveryAnalysisContinuation`(403-410)、`ManagedPreviewRecoveryHandoffContinuation`(412-420)、`ManagedRecoveryContinuation`(422-424)。
- `ManagedCheckoutDelivery`(428-464)：与 `WorktreeDeliveryView` 对应的持久化形态（finalized/retained 成员有 `cleanupMessage?` 但**未声明** `cleanupReason`）。
- `ManagedCheckoutRecord`(466-519)：核心持久化记录——`checkoutId`、`predecessorCheckoutId?`(469)、`projectId`、`projectName`、`ownerSessionId`、`sourceSessionId?`(474)、`localRoot`、`managedRoot`、`managedGitRoot`、`gitCommonDir`、`gitDir`、`baseOid`、`applyBaseOid?`(485)、`previousReview?`、`checkpoints?`、`recoveryContinuation?`、`abandonedSnapshotOid?`/`abandonedSnapshotAt?`(493-494)、`permanent?`(496)、`sidebarBadgeClearedRevision?`(498)、`sourceRef`、`sessionBranch?`(507)、`sessionTopic?`(514)、`phase`、`delivery`、`journal`、`revision`。
- `ManagedCheckoutsRegistry`(521-526)：`version: 2`、`revision`、`sessionBindings`、`managedCheckouts`。
- `SessionCheckoutRegistryPort`(528-531)。
- `LiveValue<T>`(534-536) 与 `liveConfigValue<T>`(538-544)。
- `SessionCheckoutDependencies`(546-578)：聚合 lookup/git/files/registry/applyEngine/managedCheckoutsRoot/createCheckoutId 及可选 live 配置 `autoPush`(555)/`autoDeliver`(557)/`worktreesRoot`(563)/`inheritLocalChanges`(570)/`worktreeKeepCount`(577)。

### 支撑模块

- `checkpoint.ts`：
  - `canonicalJson` (4-13，内部) 规范化 JSON 串。
  - `checkpointGenerationForRecord(record: ManagedCheckoutRecord): string | undefined` (16-29)：仅当 delivery.state 为 ready_for_review 或 preview_active 时，对 checkoutId/revision/reviewId/isolatedHeadOid/isolatedFingerprint/checkpointCount/previewId/phase 做 sha256 生成 CAS generation；否则 undefined。
- `creation-failure.ts`：
  - `export class WorktreeCreationFailure extends Error` (2-7)：构造 `(message: string, readonly rolledBack: boolean)`，标识创建失败是否已回滚，防止误判空路径安全。
- `managed-worktree-path.ts`：
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
┌────────────────────────────────────────────────────────────────────┐
│       createSessionCheckoutModule (src/session-checkout-module.ts)  │
│                                                                    │
│  bind/create              operate*               list/manage/prune │
│  bindTarget 4738          finish 3244            summarize 3756    │
│  createIsolatedTarget     preview 2538           cleanup 检查 3909 │
│   5093                                                            │
│       └──────────► withBindingLock (1194) ◄───────────┘           │
│               exclusive / maintenance / draining                  │
│                          │                                        │
│     ┌────────────┬───────┴───────┬──────────────┐                │
│     ▼            ▼               ▼              ▼                │
│  身份校验      applyEngine      registry v2    git port           │
│  validate*     plan/preview/    读写 1575      ports.ts 94-209   │
│  586-733       commitIsolated                                    │
│                                                                    │
│  会话分支层 attachSessionBranch(743) ensureSessionBranch(799)      │
│  refuseLegacyLocalWrite(1561) ──► 交付只写 refs/heads/feat/…       │
└────────────────────────────────────────────────────────────────────┘
```

## Data Flow

1. **绑定与创建**：`bind` / `createIsolatedTarget` 经 `bindTarget`（4738）解析项目与 git 快照、生成路径候选、写入 `preparing` 记录与 binding、`createDetachedWorktree` 后复验 git 身份，随后立即 `attachSessionBranch`（743）把 Worktree 挂到 `feat/sess-<会话>[--<主题>]`，`sessionBranch` 与 `sourceRef` 同写该 ref，记录转 `ready`。
2. **编辑与检查点**：改动只发生在 Worktree。`checkpoint`（`operateCheckpoint` 1672）用 `requestId` 幂等 + `expectedGeneration` CAS，在 `refs/…/checkpoints/<id>` 上留证，提交后回 `working`。
3. **Review 与 Preview**：`markReadyForReviewTarget`（1589）先 `ensureSessionBranch` 再固化 review 指纹（1619-1629）；`operatePreview`（2538）在 receipt 保护下把改动写进 Local，`beforeWrite` 内先留工件再置 `preview_active`。Local 一旦漂移，预览进入 `preview_detached`（2690），需要 `preflightPreviewRecoveryTarget`（2339）生成的 proof 才能继续。
4. **交付（只写会话分支）**：`operateFinish`（3244）先 `ensureSessionBranch`（799），再 `reviewIsolated` + `commitIsolated(branchRef)`，`proof.localBranch` 记会话分支名，自动 push 也推会话分支，Local 的三个面全程不读写。旧的 `operateApply` / `operatePreview` / `operateFinalizePreview` 在存在 `sessionBranch` 时被 `refuseLegacyLocalWrite`（1561）拒绝并指向 `worktree_deliver`。
5. **合并**：`mergeBranchForSession`（4120）先认 `record.sessionBranch`，拒绝把 Local 自身分支当来源，并区分「别的会话的分支」；真实合并前检查项目验收槽，冲突现场留给用户解决。
6. **保留与清理**：`finalized` 可 `retain_*` 冻结环境（默认 `retain_24h`，src/types.ts:39），或直接 `cleanupFinalized`（2884）删除目录；目录身份不符/交付后又有改动会被挡成 `identity_changed` / `modified_after_finalize`；到期由 `cleanupExpiredRetained`（4380）、总量由 `enforceWorktreeKeepCount`（4408）收口。
7. **崩溃恢复**：启动或显式 `recover` 时 `reconcile()`（1267）按 journal step 前进或回退；finish 的 `committing_session_branch` step 落入通用 `mutating` 分支（1466-1475），被视作可能已产生提交，收敛为 `recovery_required` 而不是草率回 `ready`。

## Connections

- [[session-checkout-apply]]：`applyEngine` 的实现，提供 `plan` / `preflight` / `preview` / `rollback` / `finalize` / `recoverCheckpoint` / `inspectReview` / `reviewIsolated` / `commitIsolated`。
- [[managed-worktree-path]]：会话分支名候选与 Worktree 目录/路径候选生成，`createSessionBranchCandidates` 是 `attachSessionBranch` 的唯一取名来源。
- [[registry]]：`ManagedCheckoutsRegistry` 的持久化与原子写入。
- [[git-port]]：`SessionCheckoutGitPort` 适配器，`attachWorktreeBranch` / `resolveLocalBranchTip` / `mergeLocalBranch` 是会话分支语义的底层支点。
- [[file-port]]：`SessionCheckoutFilesPort`，目录身份、隔离与删除能力。
- [[session-management]]：`lookup` 端口提供会话与项目记录，决定 owner 与 cwd 归属判定。
- [[host-messages]]：所有面向用户的文案键与持久化清理文案的映射表。

## Known Issues

- **detached 兼容残留**：端口不实现 `attachWorktreeBranch` 时，`attachSessionBranch`（749-753）与 `ensureSessionBranch`（800-806）都只 warn 并退回旧行为，此时 `record.sessionBranch` 永不写入。
- **历史记录仍可写 Local**：`refuseLegacyLocalWrite`（1561-1573）只对存在 `sessionBranch` 的记录生效（1565），因此旧版本创建、无会话分支的记录仍可走 `operateApply` / `operatePreview` / `operateFinalizePreview` 写回 Local；`operateFinish`（3273-3280）与 `operateDiscard`（3514-3520）对这类 wrote-to-Local 中间态另有显式拒绝。
- **迭代基点会退化**：`beginNextIterationTarget`（4432）用 `resolveLocalBranchTip` 找上一轮会话分支 tip（4491-4496），找不到（分支被删/改名）就退回 Local 的 `headOid`，上一轮内容会在迭代链上断开——源码注释（4488-4490）已点明这一点。
- **`operateFinish` 重读记录只校验 phase**：`ensureSessionBranch` 之前那次 registry 重读只判 `phase !== 'ready'`（3297-3300），不再比 `revision`，并发窗口依赖 `withBindingLock`（1194）与 `updateManagedCheckout`（1575）的 CAS 兜底。
- **清理失败原因被折叠**：`cleanupFinalized`（2884）的 `catch`（3048-3067）把所有异常降级成 `quarantine_busy` / `directory_busy` 的 `pending`/`blocked`，不区分底层错误类型，只能靠 `console.warn('[session-checkout] finalized Worktree cleanup failed:', error)`（3049）定位。
- **清理超时不做取消**：`withCleanupTimeout`（106-124）只让启动收敛先走（超时返回 `null`），后台操作继续跑完；`withBindingLock` 保证同进程重试串行、台账写入安全（注释 100-103）。若实际挂起普遍超过 2min，需要给 files/git ports 加 AbortSignal。
- **`retain_24h` 是默认值**：调用方未显式给 `retention` 时（`DEFAULT_WORKTREE_RETENTION`，src/types.ts:39；使用点 3126、3446）冻结环境会留一天，磁盘占用与 `approximateBytes` 会持续到到期清理。
- **旧写回校验仍在**：`inspectCleanupForRecord`（3853）在 `commitOid + proof` 时仍用 `validateCommittedLocalCheckout` + `isAncestor` 验证交付提交在 Local 历史里（3862-3871），这是写回语义的遗留；会话分支交付的提交不在 Local 历史中，该分支逻辑对这类记录不再成立。
- **双轨记录共存**：`ManagedCheckoutDelivery`（src/ports.ts:428-464）的 finalized/retained 成员未声明 `cleanupReason`，但 `cleanupFinalized` 的 `block()`（2889-2912）运行时会写入该字段；视图类型 `WorktreeDeliveryView`（src/types.ts:104-126）已声明它。`persistedCleanupReason`（154-159）读不到结构化字段时回退文案匹配，新旧记录在同一份台账里语义不完全一致。
