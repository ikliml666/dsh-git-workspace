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

`createSessionCheckoutModule`（src/session-checkout-module.ts:236-5262）是插件核心：一套从 Domi 移植来的 session-checkout 状态机（模块自述见 77-83），保留 receipt-first Local Preview、回滚/finalize、项目验收槽、崩溃恢复与 fingerprint CAS，同时把所有权适配到 Harness 分离的 source Local Session 与 target owner Session。全部持久化状态落在 `ManagedCheckoutsRegistry`（version 2，src/ports.ts:542-547）。

当前版本最关键的语义变化是**交付不再写回 Local**：每个受管 Worktree 在创建阶段就挂到属于自己会话的分支（`refs/heads/feat/sess-<会话>[--<主题>]`），`finish` 只在这条会话分支上提交，Local 的工作区、索引与 HEAD 全程不被读写；合并由 `mergeBranchForSession` 显式发起。为此模块新增了 `branchNameOf`（src/session-checkout-module.ts:232-234）、`attachSessionBranch`（744）、`ensureSessionBranch`（800）、`refuseLegacyLocalWrite`（1646）与 `explainApplyConflict`（1616）。同一语义已延伸到验收侧：`markReadyForReviewTarget`（1674）在 `inspectReview` 之前先 `ensureSessionBranch`，让验收指纹记录交付期真实的 HEAD 身份（详见「生命周期操作」）。

## Overview

模块管理「受管 Worktree」（Managed Worktree）的全生命周期：绑定会话、创建、检查点（Checkpoint）、预览（Preview）、Review、交付（Deliver/Finish）、保留（Retain）与清理（Cleanup）。三个机制贯穿始终：

- **互斥**：所有变更操作经 `withBindingLock`（src/session-checkout-module.ts:1279）串行化；maintenance 模式允许只读 `inspect` 并发旁路，但必须先关闭旁路并排空已启动的 inspect。
- **崩溃恢复**：`record.journal` 记录可重放的 receipt，`reconcile()`（1352）按 journal 的 step 把记录确定性收敛到 `ready` 或 `recovery_required`。
- **CAS / 指纹**：`revision`、`isolatedFingerprint`、`reviewId`、`generation` 共同构成乐观并发校验；Preview 用 receipt 记录写入前后的 Local 指纹（`localFingerprintBefore`/`localFingerprintPreview`，src/ports.ts:386-387），任何漂移都让预览进入 `preview_detached`。

本地适配特性（相对 Domi 原版）：

- **会话分支交付**：创建即挂分支，交付只提交会话分支（744、800、3329）。
- **清理收敛超时**：`withCleanupTimeout`（107-125）给启动期清理/收敛加 120s 兜底，单条被占用的损坏记录不再卡死应用启动。
- **自动推送**：Finish 成功后尽力推送**会话分支**（`pushLocalBranchBestEffort`，src/session-checkout-module.ts:128-139）；失败降级为「已跳过」备注。
- **仓库移动修复**：`git worktree repair` 重连断链 Worktree（`repairStaleWorktreeLinks`，4788）。
- **Worktree 根目录配置**：`worktreesRoot` + 主题命名（路径候选生成在 `createManagedWorktreePathCandidates`，src/managed-worktree-path.ts:132-175）。
- **继承未提交修改**：`carryLocalWorkInProgress`（4760），仅当基点等于 Local HEAD 时生效（门控在 5084）。
- **放弃快照**：带未提交内容放弃前固化快照（`operateDiscard` 3576，快照写入 3704-3719）。
- **常驻标记**：`permanent` 豁免保留期到期清理与 LRU 逐出（`set_permanent` 4389-4404；豁免点 4470、4499）。
- **侧栏徽章清除**：`clear_sidebar_badge`（4405-4416）记录 `sidebarBadgeClearedRevision` 且刻意不 bump revision。
- **空容器回收**：worktree 删除后若项目容器已空且无其他记录引用，一并回收（`collectEmptyManagedContainer`，2953-2967，注释 2949-2952）。
- **并发分支竞态守卫**：`refreshBranchRaceGuards`（992）/`branchRaceNotice`（1025）检测同仓库内其他活跃会话新近创建的分支，命令后启动的会话先隔离。

## Key Components

### 模块级常量与工具函数（src/session-checkout-module.ts）

- **`ResolvedSessionProject`**（85-88）：`session` + `project` 的内部解析结果。
- **`UNVERSIONED_OID` / `UNVERSIONED_REF`**（90-91）：未版本化项目的伪 OID 与伪 ref（`'unversioned'` / `'WORKING_TREE'`）。
- **`RETENTION_24H_MS` / `RETENTION_3D_MS`**（92-93）：保留期时长。
- **`CLEANUP_IDENTITY_CHANGED_MESSAGE`**（94）、**`CLEANUP_RESIDUE_MESSAGE`**（95）：清理被身份变更/残留证据挡住时的固定文案。
- **`TRANSIENT_CLEANUP_RETRY_DELAYS_MS`**（96）：`[100, 300, 800]`。
- **`CHECKOUT_CLEANUP_TIMEOUT_MS`**（105）：`120_000`，Windows 文件占用下防止清理无限挂起；注释（98-104）明确「不做取消」——超时后后台操作继续跑完，只保证启动收敛先走。
- **`withCleanupTimeout(checkoutId, operation)`**（107-125）：`Promise.race` 实现的 120s 兜底超时，超时返回 `null` 并 `console.warn`（117）。
- **`pushLocalBranchBestEffort(push, localRoot)`**（128-139）：尽力推送，返回 `WorktreePushOutcome`，异常降级为 `{status:'failed', message}`。
- **`cleanupReasonForMessage(message)`**（141-149）：把历史清理文案（zh/en 关键词成对匹配，注释 142-143）映射回结构化 `WorktreeCleanupReason`，只兜底旧持久化记录。
- **`persistedCleanupReason(delivery)`**（155-160，文档 151-154）：优先读结构化 `cleanupReason`，否则回退文案映射。
- **`isTransientCleanupError(error)`**（162-169）：识别 `EBUSY` / `EPERM` / `EACCES` / `ENOTEMPTY` 等瞬时错误（code 或 message）。
- **`retryTransientCleanup(operation)`**（171-183）：按 `TRANSIENT_CLEANUP_RETRY_DELAYS_MS` 退避重试，最多 4 次尝试。
- **`retentionExpiresAt(mode, retainedAt)`**（185-189）：保留到期时间戳；`retain_24h` → +24h、`retain_3d` → +3d、`retain_manual` → `null`。
- **`pathForIdentity(path)`**（191-197）：realpath + 分隔符归一，仅用于身份比较；失败退回 `resolve` 结果。
- **`pathsEqual(left, right)`**（199-205）：Windows 下大小写不敏感的 realpath 后比较。
- **`resolvedPathsEqual(left, right)`**（208-214）：canonical 路径与 registry 原始路径比较，**不做 realpath**（注释 207），防止 Junction 冒充原目录。
- **`pathIsWithin(candidate, root)`**（221-229，文档 216-220）：判断 `candidate` 是 `root` 本身或嵌套其下（包含而非相等，Session 常 `cd` 进子目录）。
- **`branchNameOf(ref)`**（232-234，注释 231）：`refs/heads/x` → `x`；其他 ref（含 detached 的 `HEAD`）返回 `null`。会话分支名一律经它从 ref 取出。

### 工厂内基础件（绑定/校验/视图）

- **`requireSession(sessionId)`**（239-243）、**`resolveSessionProject(sessionId)`**（245-254，缺项目根时抛 `project_root_missing`，250-252）。
- **`inspectLocal(binding)`**（256-282）：Local 目标视图；先挂 `statusPromise` 并 noop catch 防 rejection 冒泡（261-262）。
- **`projectPreviousReview(record)`**（284-292）：保留 `reviewId`/`iteration`/`summary`/`suggestedCommitMessage`（**完整保留，不截断**），仅 `changedFiles.slice(0, 50)`（290）。
- **`projectCheckpoint(record)`**（294-304）：checkpoint 记录 → 视图投影。
- **`projectDelivery(record, commitInLocalHistory)`**（306-371）：按 `delivery.state` 投影 review/preview/proof/cleanup 视图；`cleanupMessage` 经 `hostPersistedCleanupMessage` 重译（344、357）。
- **`bindingForManagedRecord(record)`**（373-386）：从托管记录合成绑定记录（持久化绑定不匹配时兜底）。
- **`recoveryView(binding, record?, dirty)`**（388-411）：`phase` 为 `discarded` 时保持 `discarded`，否则 `recovery_required`（393）。
- **`validateCommittedLocalCheckout(binding, record)`**（413-435）、**`committedFollowupView(binding, record)`**（437-484）：commit 是权威交付事实，残余环境异常只影响 cleanup，不把会话降级（注释 471）；用 `git.isAncestor` 判 `commitInLocalHistory`（450-460，无法判定时为 `null`）。
- **`saveCreationEvidence`**（486-495）、**`finishFailedCreation(sessionId, checkoutId, error, previous?)`**（497-520）、**`markRecoveryRequired(record)`**（522-537，revision/phase 双 CAS 在 527）。
- **`ValidatedManagedCheckout`**（539-544）、**`ManagedCheckoutValidationResult`**（546-549）：`valid` / `invalid` / `unavailable` 三态。
- **`checkpointHeadInvariantHolds(record, managedRoot, headOid)`**（551-585）：先结构校验（sequence 连续、checkpointId/reviewId 去重，560-568），再并行取证（`readInternalArtifact` + `isAncestor` 链，`Promise.all`，570-578），最后验证末位 checkpoint 是 `headOid` 祖先（584）。
- **`validateManagedCheckoutDetailed(binding, record, requireCreateBase)`**（587-643）：多重身份判定——binding 四元组与 `managedRoot` 存在（592-598）、canonicalize 后 `pathsEqual(canonicalProjectRoot, canonicalLocalRoot)`（607-608）、`resolvedPathsEqual` 比较 canonical 与 registry 原始路径（622-624）、`pathsEqual` 比较 `snapshot.root`/`commonDir`/`gitDir`（625-629）；`requireCreateBase` 时要求 `headOid === baseOid`（630），否则校验检查点不变式（631）；`catch` 返回 `{status:'unavailable'}`（639-642，注释 640），避免瞬时 Git/I/O 故障把健康 Worktree 判成 `recovery_required`。
- **`validateManagedCheckout`**（645-652）：上面函数的薄包装，只取 valid。
- **`ValidatedCleanupResidue`**（654-657）、**`directoryIdentitiesEqual`**（659-661）、**`hasCleanupRemovalReceipt`**（663-667）、**`hasLegacyCleanupResidueEvidence`**（669-676）、**`validateCleanupLocalIdentity`**（678-694）、**`validateDetachedCleanupResidue`**（696-734）：清理链的身份与残留取证。
- **`attachSessionBranch({localRoot, managedRoot, sessionId, topic})`**（744-786，文档 736-743）：把新建/重建的 Worktree 从 detached HEAD 挂到会话分支。端口缺 `attachWorktreeBranch` 时 `console.warn` 并返回 `null`（750-754，退回旧 detached 行为）；否则取 `inspect(managedRoot).headOid`（755-756），对 `createSessionBranchCandidates`（src/managed-worktree-path.ts:63-75）逐个候选拼 `refs/heads/${branch}`，先用 `resolveLocalBranchTip` 取该名现有 tip（761）。**同名分支已存在时不再无条件跳过**：若 `existing === headOid`，或 `existing` 是当前 HEAD 的祖先（`isAncestor`），则视为可复用，用 `attach(managedRoot, branchRef, headOid, existing)`（CAS 到该 old 值）挂上去并复验（762-776）；其余情况换下一个候选名——**绝不覆盖带别的提交的同名分支**。分支不存在时 `attach(managedRoot, branchRef, headOid, null)` 创建，同样复验后才返回 `{branch, branchRef}`（777-783）。
- **`EnsureSessionBranchResult`**（788-790）：`{ok:true, record}` | `{ok:false, code, message}`。
- **`ensureSessionBranch(record)`**（800-850，文档 792-799）：交付前保证 Worktree 挂在自己的会话分支上。端口缺 `attachWorktreeBranch` 时 warn 并原样 `ok:true`（801-807）；`inspect` 失败 → `recovery_required`（808-811）；`record.sessionBranch` 已存在且 `headRef` 相符则直接 `ok`（812-814）；有记录但 HEAD 已离开（例如 checkpoint 把 HEAD 写成游离提交）→ attach 回记录值并复验（816-828），attach 失败**另建独立会话分支**（注释 826，绝不覆盖别人提交）；`attachSessionBranch` 返回 null → `git_operation_failed`（837-839）；成功后 `updateManagedCheckout` 同时把 `sessionBranch` 与 `sourceRef` 写成同一个 branch ref（840-845）；记录不存在 → `checkout_missing`。**历史记录（旧版本创建、detached、`sourceRef` 记的是 Local 当时所在分支——可能属于别的会话）不复用 `sourceRef` 作为交付目标**（注释 795-798），`sourceRef` 从此只作「分叉来源」展示。
- **`validateCleanupQuarantine(record)`**（852-869）：校验隔离目录身份（目录名形如 `.dsh-wt-cleanup--<checkoutId 前 8 位>--<operationId>`，857）。
- **`inspectIsolated(binding, persistRecovery = true)`**（871-979）：`discarded` + `delivered` 走 `committedFollowupView`（883-894）；`recovery_required` 且 `journal === null` 且目录仍在时，先用 `validateManagedCheckoutDetailed` 尝试修复回 `ready`（896-917）；只有 `invalid` 才持久化 recovery（943，注释 942），瞬时 `unavailable` 允许下次重试；命中 `ready_for_review` 时计算 `reviewSlot`（948-955、972-977）。
- **`getPersistedBinding(sessionId)`**（981-983）。
- **`branchRaceCache` / `branchRaceWindowMsDefault`**（989-990）：分支创建时间快照（keyed by Local root）与 30 分钟默认窗口（注释 985-988：system-prompt 契约禁止 await，快照由异步刷新写入、同步读取）。
- **`refreshBranchRaceGuards()`**（992-1017）：`branchRaceGuard === false` 直接返回（993）；端口缺 `branchCreationTimes` 时静默（994）；从 sessionBindings、managedCheckouts 与 `listLiveSessions`（1001-1006）收集项目根，逐根探测 reflog 分支创建时间写入缓存（1007-1016）；探测失败保留上一份快照（1013-1015）。
- **`branchRaceNotice(sessionId, registry)`**（1025-1065，文档 1019-1024）：守卫关闭或活跃会话 <2 返回空串（1026-1030）；排除已隔离的会话（1037-1043）；调 `detectLocalBranchRace`（1047-1055，窗口取 `branchRaceWindowMs` 配置，1053）；命中竞态时返回一段给模型的指引——后启动的会话**不得**在 Local 建分支/直接提交，必须先 `worktree_create` 隔离（1057-1064）。
- **`runtimeContext(sessionId, cwd?)`**（1067-1210）：给模型的运行时指引。完全无绑定时只返回竞态通知（1069-1070）。Local 分支按 pending 记录给出提示：无 pending → 普通 Local 工作（1087-1095，末尾附 `branchRaceNotice`，1088-1094）；`preview_active` → 只读（1096-1102）；`preview_detached` → 恢复（1103-1109）；pending 属于别的会话 → handoff pending（1113-1119，注释 1110-1112）；属于本会话 → 回到该 checkout 工作（1120-1124）。Isolated 分支：`recovery_required`（1129-1131）、`discarded`+`delivered`（1136-1143，注释 1132-1135）、`finalized`/`retained` 且 cwd 不在 `managedRoot`（1150-1165，注释 1144-1149）时输出「允许在 Local 工作」等提示，消除「人在 Local 却禁止写 Local」矛盾；否则输出 Isolated Checkout 权威 cwd 与 write-guard 规则（1166-1209，cwd 不在 Worktree 内时追加绝对路径规则 1180-1184）；checkpoint 与各 delivery state 的专属指引在 1186-1208（`working` 态按 `autoDeliver` 分叉为 `worktree_deliver` 或 `worktree_ready_for_review`，1199-1201）。
- **`resolveBinding(sessionId)`**（1212-1247）：`project_mismatch` / `target_unselected`（1246）；`discarded`+`delivered` 且 `workspace.root` 等于 `managedRoot` 时放行（1221-1236）。
- **`BindingOperationMode`**（1249）与锁队列变量（1251-1259）；**`prepareMaintenanceReadySignal`**（1261-1263）、**`beginMaintenanceInspect`**（1265-1272）、**`finishMaintenanceInspect`**（1274-1277）。
- **`withBindingLock(operation, {allowConcurrentInspect?})`**（1279-1314）：排他/维护锁队列；maintenance 退出时先置 `maintenance_draining` 并等待已启动 inspect 排空（1302-1309）。
- **`inspectTarget`**（1316-1320）、**`inspectDuringMaintenance`**（1322-1332，只读不写 registry，注释 1326-1327）、**`inspectAvailable`**（1334-1350）。
- **`reconcile()`**（1352-1599）：清 `discarded` 空壳 cwd 与空容器（1362-1372，注释 1363-1364）；回收 predecessor 记录中断的下一轮创建（1373-1401）；`finalized` 记录经 `withCleanupTimeout` 进 `cleanupFinalized`（1581-1587，注释 1584、调用 1585）；按 journal step 确定性收敛（finalize/finish `updating_ref`/`replacing_index` → `recovery_required` 1408-1423；checkpoint 恢复 1424-1502；preview planning 1503-1520，注释 1511；finalize/finish planning 1521-1535；artifacts_retained 1536-1550）；其余 `preparing`/`mutating` → `recovery_required`（1551-1560）；结尾 `cleanupExpiredRetained`（1588）。
- **`operationError(code, message, target?)`**（1601-1607）。
- **`explainApplyConflict({localRoot, conflictingFiles})`**（1616-1637，文档 1609-1615）：把 `apply_conflict` 分类并给出 `resolveHint`——先 `listUntrackedFiles` 取未跟踪集，命中即 `untracked_conflict`（1621-1631）；否则 `git.status().dirty` → `local_dirty`（1632-1634）；否则 `content_conflict`（1636）。
- **`refuseLegacyLocalWrite(record, binding)`**（1646-1658，文档 1639-1645）：`if (!record.sessionBranch) return null`（1650）；否则旧的「写回 Local」操作一律返回 `operation_not_allowed`，并把 `inspectIsolated(binding)` 作为 target 指路 `worktree_deliver`。调用点：`operateApply`（2213-2214）、`operatePreview`（2654-2655）、`operateFinalizePreview`（3196-3197）。
- **`updateManagedCheckout(checkoutId, mutate)`**（1660-1672）：CAS 写 registry。

### 生命周期操作

- **`markReadyForReviewTarget(sessionId, input)`**（1674-1755）：owner + isolated 校验（1679-1681）；`summary`/`suggestedCommitMessage` trim 后非空且通过 `isValidCommitMessage`、`tests ≤ 20`（1682-1686）；长度上限 **summary ≤240、detailsMarkdown ≤12000、validationSummary ≤500、单条 test command/summary ≤500**（1687-1694）——**`suggestedCommitMessage` 没有长度上限**（只要求合法）；record 门（1695-1699）；`inspectIsolated` 后 phase 非 `ready` → `recovery_required`（1700-1703）；**先 `ensureSessionBranch`（注释 1704-1706，调用 1707-1709；历史记录在此补建分支，否则交付时 headRef 从 DETACHED 变会话分支导致指纹必被误判 `stale_isolated`）**；`inspectReview` 用 `applyBaseOid ?? baseOid`（1710-1714）；写 `ready_for_review` delivery 含 `isolatedFingerprint`/`isolatedHeadOid`（1718-1753）。
- **`operateCheckpoint`**（1757-1985）：`requestId` 幂等重放（1776-1791，`exactReplay` 才返回原 checkpoint）、`expectedGeneration` 64 位 hex CAS（1768、1798）、revision 双检（1792-1794、1809-1817）、`preview_active` 先 rollback（1819-1872）；journal `planning` → `updating_ref` 并 `retainInternalArtifact('checkpoints/<id>')`（1904-1929，retain 在 1927）；提交后 delivery 回 `working` 并追加 checkpoint 记录（1966-1977）。幂等重放与崩溃恢复的端到端行为见 tests/session-checkout-module.test.ts:721-790、792-829。
- **`resumeRevisionTarget`**（1987-2058）、**`prepareReviewRegenerationTarget`**（2060-2091）、**`preparePreviewRecoveryAnalysisTarget`**（2093-2127）、**`createPreviewRecoveryHandoffTarget`**（2129-2175）。
- **`operateApply`**（2177-2334）：旧的「写回 Local」路径。开头插入 legacy 门（2213-2214）；冲突时用 `explainApplyConflict` 填充 `reason` + `resolveHint`（2232-2249，调用 2234）；`invalid_plan`/`stale_local`/`stale_isolated` 可证明未触碰 Local，恢复 `ready`（2314-2321，注释 2320）；成功更新 `applyBaseOid`（2326-2332）。
- **`holdsProjectAcceptanceSlot`**（2336-2342）、**`findProjectAcceptanceHolder`**（2344-2354）、**`retainPreviewArtifacts`**（2356-2362，四个内部 ref）、**`releasePreviewArtifactsBestEffort`**（2364-2370）、**`previewArtifactsMatch`**（2372-2384）。
- **`blockedPreviewRecovery`**（2386-2403）、**`canonicalJson`**（2405-2414，递归键排序并过滤 `undefined`）、**`sha256Facts`**（2416-2418）、**`recoveryGeneration`**（2420-2422）。
- **`preflightPreviewRecoveryTarget`**（2424-2510）：`not_owner` → `checkout_unavailable` → `stale_target` → `not_preview_detached` → `checkout_unavailable` → `artifacts_missing` → `assessPreviewRecovery` → `git_error`；项目验收槽被占时 rollback/finalize 都置 `{status:'blocked', code:'project_acceptance_busy'}`（2463-2472）；facts 含 `receiptFingerprint`、`localFingerprint` 等（2473-2489），二次 CAS（2490-2499）与二次工件校验（2501-2503）后返回 `{status:'assessed', localModified:false, proof:{…, generation}}`（2504-2505）。
- **`recoveryProofMatches(left, right)`**（2512-2516）、**`blockedPreflight`**（2518-2541）、**`preflightTarget(sessionId, expectedRevision)`**（2543-2621）：`applyEngine.preflight` 后按 `changedFiles` 空 → `already_in_local`、`localHeadOid !== baseOid` → `local_advanced`、否则 `ready`（2615-2619）。
- **`operatePreview`**（2623-2773）：legacy 门（2654-2655）之后写 journal `planning`，`plan` 冲突则回 `ready` 并用 `explainApplyConflict` 返回 `apply_conflict`（2682-2699）；`beforeWrite` 内 `retainPreviewArtifacts` + delivery `preview_active` + journal `artifacts_retained`（2735-2750）；成功返回 `{status:'previewed'}`（2764-2772）。
- **`detachPreviewAfterLocalDrift`**（2775-2812）：`preview_active` → `preview_detached`。
- **`operateRollbackPreview`**（2814-2919）：detached 恢复需 `recoveryProofMatches` + `proof.rollback.status === 'safe'`（2835-2852）；成功按 `resumeRevision` 回 `working` 或 `ready_for_review`（2908-2916）。
- **`retainFinalized(record, retention)`**（2921-2947）：`finalized` → `retained`，写 `retention`/`retainedAt`/`expiresAt`/`cleanup:'scheduled'`。
- **`collectEmptyManagedContainer(managedGitRoot, excludedCheckoutId)`**（2953-2967，注释 2949-2952）：worktree 移除后回收空项目容器（`removeEmptyDirectoryTree` 遇任何条目返回 false，绝不删用户字节）。
- **`cleanupFinalized(record, {allowLegacyResidue?})`**（2969-3153）：非 `finalized`/`retained` 直接 `directory_busy`（2998-3000）；`identity_changed` 直接复述（3001-3008）；`hasLegacyCleanupResidueEvidence` 且 `managedGitRoot` 仍在 → `detached_residue`（3009-3011）；`beginRemoval` 写 journal `{operation:'cleanup', step:'removing_worktree', managedDirectoryIdentity}`（3019-3041）；`quarantineAndRemove` 走 `.dsh-wt-cleanup--…` 隔离目录（3043-3073）；`removeWorktree` 后若目录仍在，转 `validateDetachedCleanupResidue` + 隔离链（3099-3103）；指纹不符 → `modified_after_finalize`（3091-3092）；收尾 `collectEmptyManagedContainer`（3114）、`releaseApplyBaseBestEffort`（3115），并把记录写成 `phase:'discarded'` + `delivery.state:'delivered'`（3116-3131）；`catch` 打 `console.warn('[session-checkout] finalized Worktree cleanup failed:', error)`（3134），`finalized` 记 `cleanup:'pending'`、`retained` 记 `cleanup:'blocked'`（3141-3150）。
- **`operateFinalizePreview`**（3156-3300）：`preview_detached` 时先验 `proof.finalize.status === 'safe'`（3177-3194），再走 legacy 门（3196-3197）；`applyEngine.finalize` 的 `beforeCommit` 写 journal `updating_ref` + `commitOid`（3220-3228）；成功写 `delivery.state:'finalized'` 与 `proof`（3251-3276），`retention !== 'cleanup'` 走 `retainFinalized`（3278-3289），否则 `cleanupFinalized`（3290-3299）。
- **`operateRetryCleanup`**（3302-3327）：仅 `finalized`/`retained` 可重试（3314-3316），`allowLegacyResidue: true`（3317）。
- **`operateFinish`**（3329-3564）：见下节「会话分支交付链」。
- **`releaseApplyBaseBestEffort(record)`**（3566-3574）：释放 apply base 与内部 artifact，失败只 `console.warn`（3572-3573）。
- **`operateDiscard`**（3576-3740）：`preview_active` 需 `rollbackPreview` 或拒绝（3606-3613）；带 creation 证据的记录 → `recovery_unsafe`（3638-3640）；`recovery_required` 且目录已消失 → 直接 `discarded`（3642-3651）；`ready` 且目录连同 git 顶层都没了 → prune + 清台账（3655-3669，注释 3652-3654）；脏工作树或未交付 checkpoint 需 `confirmDirty`（3694-3699），并先 `snapshotAbandonedWorktree` 固化放弃快照（3704-3719，注释 3701-3703），快照失败则中止放弃（数据保护优先）。
- **`operateRecover`**（3742-3804）：终态记录（`delivered`/`discarded`/`finalized`/`retained`）不允许被 Recover 复活（3760-3765，注释 3758-3759）；`journal.operation === 'create'` 且有 creation 证据 → `recovery_unsafe`（3767-3769）；有 journal 时先 `reconcile()` 收敛再判断（3770-3784，注释 3771-3772）；验证通过后写回 canonical 路径并转 `ready`（3794-3802）。
- **`operateTarget`**（3806-3824）：按 `action` 分发（`apply`/`finish`/`preview`/`checkpoint`/`rollback_preview`/`finalize_preview`/`retry_cleanup`/`discard`/`recover`，3809-3817），`SessionCheckoutError` 转 `operationError`（3820-3823）。

### 会话分支交付链（`operateFinish`，3329-3564）

1. 身份与前置校验：owner（3333-3335）→ 只接受 isolated（3336-3338）→ `commitMessage` trim 非空（3339-3342）且通过 `isValidCommitMessage`（3344-3346，**无长度上限**，多行/Unicode 正文原样提交，见 tests/session-checkout-module.test.ts:442-463，注释 708）→ `checkout_missing`（3347-3348）→ `stale_target`（3349-3351）→ `expectedReviewId` 不符 → `stale_target`（3352-3357）。
2. **历史 wrote-to-Local 记录**（`record.applyBaseOid && (state === 'working' || state === 'ready_for_review')`，3359-3365，注释 3358）→ `operation_not_allowed`。
3. 状态门：`phase !== 'ready'` 或 `preview_active`/`preview_detached` → `operation_not_allowed`（3366-3368）；项目验收槽被占 → `project_acceptance_busy`（3369-3376）；`inspectIsolated` 后 `phase` 非 `ready` → `recovery_required`（3378-3381）。
4. 引擎能力探测：`reviewIsolated` / `commitIsolated` 缺失 → `operation_not_allowed('thisVersionCannotDeliverToASessionBranch')`（3387-3392；两者先 `.bind(engine)`，因为这些方法经 `this` 访问内部状态，注释 3386）。
5. 写 journal `{operation:'finish', step:'committing_session_branch', baseOid: applyBaseOid}`（3394-3409）。
6. **`ensureSessionBranch(mutating)`**（3422，注释 3420-3421，实现见 800）；失败 → `restoreReady()`（3411-3418）+ 错误。`branchRef = deliverable.sessionBranch ?? null`（3427-3428）。
7. `reviewIsolated({isolatedPath: deliverable.managedRoot, baseOid: applyBaseOid})`（3430-3434）；`expectedReviewId` 下 reviewId/指纹/HEAD 任一不符 → 回 `working` + `stale_isolated`（3435-3453）。
8. 沿用 `ready_for_review` 的 review，否则现造一个（3455-3473），写 `delivery.state:'ready_for_review'`（3474-3487）。
9. **`commitIsolated({isolatedPath, baseOid, commitMessage, branchRef})`**（3489-3494）；失败 → `restoreReady()`（3495-3498）。
10. 写 `delivery.state:'finalized'` 与 `proof`：`localBranch: branchNameOf(branchRef)`、`localHeadBefore/After` 等（3500-3527）。
11. 自动 push：`(liveConfigValue(dependencies.autoPush) ?? true) && dependencies.git.pushBranch` → `pushLocalBranchBestEffort`（3534-3537；推的是**会话分支**，新分支通常无 upstream，注释 3532-3533）。
12. 收尾：`retention !== 'cleanup'` 走 `retainFinalized`（3539-3551），否则 `cleanupFinalized`（3552-3563）；两者都带 `branch`（3538/3547/3558）与 `push`。

### 清理资格、列表与管理

- **`managedIteration`**（3826-3829）、**`managedUpdatedAt`**（3831-3839）。
- **`summarizeManagedWorktree(record, includeDiagnostics = false)`**（3841-3932）：快速列表必须保守且不扫描 Git/磁盘（注释 3845）；`includeDiagnostics` 时才算 dirty、隔离/残留、`approximateBytes`（3849-3875）；`state` 由 `staleRoot` / `phase` / `delivery.state` 组合得出（3877-3894）；`canCleanup` 仅在诊断完成且非 dirty 时为 true（3930）。
- **`cleanupBlocked(reason, message, revision)`**（3934-3936）、**`inspectCleanupForRecord(record)`**（3938-3992）：按 `delivery.state` 与指纹给出 `safe` / `retained` / `blocked` 及结构化原因；retention 窗口未过或 `retain_manual` → `retained`（3985-3990）；否则 `safe`（3991）。
- **`inspectManagedWorktreeCleanup`**（3994-4006）、**`bulkCleanupManagedWorktrees`**（4008-4057，逐条 revision CAS 后 `cleanupFinalized`）、**`listManagedWorktrees`**（4059-4068）、**`listManagedWorktreesForSession`**（4070-4084）。
- **`pruneMergedBranchesInRepo`**（4093-4158，文档 4086-4092）：只删「已完全合并」的本地分支（tip 可达主干，注释 4106-4107）；主干名从 `origin/HEAD` → `init.defaultBranch` 推断（4108-4110），合并基准优先主干、退回当前 HEAD（4111-4113）；`olderThanDays` 需 `branchTipTimes`，端口缺该能力时直接拒绝而非放宽（4116-4123）。行为测试见 tests/session-checkout-module.test.ts:1187-1213（基础 prune）、1215-1235（年龄过滤）、1237-1260（维护清扫）。
- **`pruneMergedBranchesForSession`**（4160-4176）、**`autoPruneStaleMergedBranches`**（4183-4203，逐项目失败记为 skipped 条目，绝不抛出）。
- **`mergeBranchForSession(sessionId, input)`**（4205-4281）：先注册 `record.sessionBranch`，再补各 Worktree 的当前分支（4229-4237）；来源分支等于 Local 当前分支直接 `invalid_input`（4240-4242）；**分支找不到时区分**「属于另一个会话 X 的分支」（`not_owner` 并指名 owner，4245-4259）；真实合并（非 dryRun）前检查项目验收槽（4262-4270，注释 4262-4264）；`direction === 'reverse'` 把 Local 当前分支合进任务 worktree，冲突现场留在 worktree（4271-4278，注释 4272）。验收槽门控与归属守卫见 tests/session-checkout-module.test.ts:3006-3028、3030-3071。
- **`listAbandonedWorktreeSnapshots`**（4283-4299）、**`restoreAbandonedWorktreeSnapshot`**（4301-4324）。
- **`manageManagedWorktreeForSession`**（4326-4345）、**`manageManagedWorktree`**（4347-4424，`discard`（4351-4365）/ `set_retention`（4366-4388）/ `set_permanent`（4389-4404）/ `clear_sidebar_badge`（4405-4416，刻意不 bump revision，注释 4406-4408）/ 清理 fall-through（4417-4424））。
- **`observeManagedCheckout`**（4426-4432）、**`observeManagedCheckouts`**（4435-4437，注释 4434）、**`resolveManagedRoot`**（4439-4441）、**`resolveRoots`**（4448-4451，文档 4443-4447，纯读 registry 不碰 Git）。
- **`retryableCleanupBlock`**（4459-4463，注释 4453-4458：暂时性占用必须留在定期重试里）、**`cleanupExpiredRetained(now)`**（4465-4485）：只清 `cleanup:'scheduled'` 或 `directory_busy`/`quarantine_busy` 阻塞的到期记录，`permanent` 豁免（4470），逐条经 `withCleanupTimeout`（4478）。
- **`enforceWorktreeKeepCount()`**（4493-4515，文档 4487-4492）：`permanent` 与进行中记录豁免（4497-4502），只逐出最旧的 `finalized`/`retained`；**必须走 `cleanupFinalized`**（4510）——不能复用 `operateDiscard`，它对 finalized/retained 一律返回 `operation_not_allowed`（注释 4507-4509）。
- **`beginNextIterationTarget(sessionId, expectedRevision)`**（4517-4726）：要求 predecessor 已是 `discarded`+`delivered`（4535-4537）、owner 与 cwd 归属匹配（4545-4551，in-place 会话 rooted 在 Local 边界也放行，注释 4540-4544）、旧路径未复活（4552-4554）、Local 项目与 git 身份未变（4556-4568）；**迭代以「上一轮会话分支 tip」为 `iterationBaseOid`**（`branchNameOf(predecessor.sessionBranch) ?? branchNameOf(predecessor.sourceRef)` → `resolveLocalBranchTip`，4576-4581，注释 4573-4575），解析不到才退回 `snapshot.headOid`；重建后 `attachSessionBranch` 重新挂会话分支并同步 `sourceRef`/`sessionBinding.sourceRef`（4660-4686）。
- **`copyWorktreeincludeFiles`**（4732-4754，注释 4728-4731）、**`carryLocalWorkInProgress`**（4760-4786，注释 4756-4759）、**`repairStaleWorktreeLinks`**（4788-4821，仓库移动后的 `git worktree repair` 搬迁见 tests/session-checkout-module.test.ts:2493-2521）。
- **`bindTarget(sessionId, choice, createAttempt, requestStartedAt, sourceSessionId, createOptions)`**（4823-5159）：in-place 升级仅认 `createIsolatedTarget(sourceSessionId, sourceSessionId, options)` 调用形（4839-4849）；终态 replaced binding 复用（4850-4874）；支持 `createOptions.branch` 以指定本地分支 tip 为 `baseOid`（4923-4930，测试见 tests/session-checkout-module.test.ts:259-277）；路径候选（8/12/32 位身份，4931-4943，主题命名 4940-4942）与容器信任校验（4954-5003，同名未知目录非空即拒绝、空目录回收重建；EPERM/EACCES 报 OS 错误而非笼统信任错误，4992-4998）；创建路径在 `createDetachedWorktree` 成功后立即 `attachSessionBranch`（5076-5081），`readyRecord` 同时写 `sessionBranch` 与 `sourceRef` 为同一个 branch ref（5087-5101，注释 5093-5094），`binding.sourceRef` 同步（5102-5104）；基点等于 Local HEAD 且 `inheritLocalChanges !== false` 时 `carryLocalWorkInProgress`（5082-5086）；失败按 `WorktreeCreationFailure` / 残留是否清掉决定 `markRecoveryRequired` 还是重试一次（5110-5158）。

### 工厂返回的公开接口（5161-5261）

| 成员 | 行号 | 说明 |
| --- | --- | --- |
| `inspect` | 5162 | → `inspectAvailable` |
| `runtimeContext` | 5163 | 模型运行时指引 |
| `refreshBranchRaceGuards` | 5164 | 异步刷新分支创建时间快照（竞态守卫数据源） |
| `preflight` | 5165-5167 | 加锁 → `preflightTarget` |
| `preflightPreviewRecovery` | 5168-5171 | `allowConcurrentInspect: true`（5170） |
| `runExclusiveSessionMutation` | 5172-5174 | 独占变更包装 |
| `bind` | 5175-5178 | 加锁 → `bindTarget` |
| `createIsolatedTarget` | 5179-5204 | in-place（targetSessionId === sourceSessionId，5182）与独立会话两种形态 |
| `beginNextIteration` | 5205-5207 | 下一轮迭代 |
| `resumeRevision` | 5208-5210 | 恢复编辑 Review |
| `prepareReviewRegeneration` | 5211-5213 | `stale_isolated` 时重出 Review |
| `preparePreviewRecoveryAnalysis` | 5214-5216 | 预览恢复分析 |
| `createPreviewRecoveryHandoff` | 5217-5219 | 预览恢复移交 |
| `markReadyForReview` | 5220-5222 | 标记 Review |
| `operate` | 5223 | 操作分发 |
| `isAutoDeliverEnabled` | 5224-5225 | 暴露 autoDeliver 实时取值（注释 5224） |
| `listManagedWorktrees` / `listManagedWorktreesForSession` | 5226-5228 | 只读列表，不加全局锁（注释 5226） |
| `pruneMergedBranchesForSession` / `autoPruneStaleMergedBranches` | 5229-5234 | 分支修剪 |
| `mergeBranchForSession` | 5235-5237 | 合并会话分支 |
| `listAbandonedWorktreeSnapshots` / `restoreAbandonedWorktreeSnapshot` | 5238-5241 | 放弃快照 |
| `manageManagedWorktreeForSession` | 5242-5244 | 受限管理工作台 |
| `inspectManagedWorktreeCleanup` | 5245 | 清理资格检查 |
| `bulkCleanupManagedWorktrees` / `manageManagedWorktree` | 5246-5247 | 批量清理与管理工作台 |
| `resolveManagedRoot` / `resolveRoots` | 5248-5249 | 路径解析 |
| `observeManagedCheckout` / `observeManagedCheckouts` | 5250-5251 | 纯读观察 |
| `cleanupExpiredRetained` / `enforceWorktreeKeepCount` | 5252-5259 | `allowConcurrentInspect: true`（5254、5258） |
| `reconcile` | 5260 | `allowConcurrentInspect: true` |

### 类型定义（src/types.ts）

- **`SessionTargetRef`**（11-14）：`unselected` | `local` | `isolated{checkoutId}`。
- **`SessionCheckoutKind`**（16）、**`SessionCheckoutPhase`**（18-27）：`preparing` / `ready` / `applying`（弃用）/ `mutating` / `recovery_required` / `finalized` / `retained` / `discarded`。
- **`WorktreeValidationStatus`**（29）：`passed` / `failed` / `partial` / `not_run`。
- **`WorktreeRetentionMode`**（32）：`cleanup` / `retain_24h` / `retain_3d` / `retain_manual`；**`DEFAULT_WORKTREE_RETENTION`**（39）= `retain_24h`。
- **`WorktreeCleanupReason`**（41-46）：`directory_busy` / `modified_after_finalize` / `identity_changed` / `detached_residue` / `quarantine_busy`。
- **`WorktreeValidationItem`**（48-52）：`command`、`status`、`summary?`。
- **`WorktreeCheckpointView`**（55-63）：`checkpointId`、`sequence`、`reviewId`、`createdAt`、`summary`、`validationStatus`、`changedFiles`。
- **`WorktreeReviewView`**（65-77）：`reviewId`、`iteration`、`preparedAt`、`detailsMarkdown?`、`summary`、`validationStatus`、`validationSummary?`、`tests`、`changedFiles`、`suggestedCommitMessage`。
- **`WorktreeDeliveryProofView`**（79-90）：`localBranch`、`localHeadBefore`、`localHeadAfter`、`changedFiles`、`validationStatus?`、`validationSummary?`、`commitInLocalHistory`（89）。会话分支交付后 `localBranch` 记的是**会话分支名**。
- **`WorktreeDeliveryView`**（92-127）：7 种状态联合——`working{iteration}`、`ready_for_review{review}`、`preview_active{review, previewedAt}`、`preview_detached{review, previewedAt, detachedAt, reason, attemptedAction}`、`finalized{review, commitOid, proof?, cleanup, cleanupMessage?, cleanupReason?}`、`retained{…, retention, retainedAt, expiresAt, cleanup:'scheduled'|'blocked', cleanupMessage?, cleanupReason?}`、`delivered{iteration, commitOid, proof?, deliveredAt}`。
- **`WorktreeApplyPreflightBlockedReason`**（129-137）、**`WorktreeApplyPreflightFacts`**（139-150）、**`WorktreeAcceptanceBlockerView`**（152-157）、**`WorktreeApplyPreflightView`**（159-172）：`ready`/`local_advanced`/`already_in_local` | `conflict{conflictingFiles, conflictDetails?}` | `blocked{reason, message, blocker?}`，三者都带 `localModified: false`。
- **`SessionTargetProjectView`**（174-177）、**`SessionTargetCheckoutView`**（179-184）、**`SessionTargetSourceView`**（186-190）、**`SessionTargetCurrentView`**（192-196）。
- **`SessionTargetView`**（198-216）：`project`、`checkout`、`source`、`current`、`ownership`、`dirty`、`revision`、`delivery?`、`checkpoints?`、`checkpointGeneration?`、`reviewSlot?`（213）、`reviewSlotOwnerSessionId?`（215）。
- **`SessionTargetBindChoice`**（218-220）。
- 操作接口（222-353）：`SessionCheckoutOperationBase`(222-225)、`SessionCheckoutApplyOperation`(227-229)、`SessionCheckoutFinishOperation`(231-237, 含 commitMessage/retention/expectedReviewId)、`SessionCheckoutPreviewOperation`(239-241)、`SessionCheckoutCheckpointOperation`(243-249, 含 commitMessage/expectedReviewId/expectedGeneration/requestId)、`WorktreePreviewRecoveryActionBlockReason`(251-256)、`WorktreePreviewRecoveryRollbackAction`(258-260)、`WorktreePreviewRecoveryFinalizeAction`(262-270)、`WorktreePreviewRecoveryProof`(273-291, 含 generation/receiptFingerprint/localFingerprint/rollback/finalize/blocker?)、`WorktreePreviewRecoveryPreflightBlockedReason`(293-299)、`WorktreePreviewRecoveryPreflightView`(301-312)、`SessionCheckoutRollbackPreviewOperation`(314-320, 含 resumeRevision?/recoveryProof?)、`SessionCheckoutFinalizePreviewOperation`(322-328)、`SessionCheckoutRetryCleanupOperation`(330-332)、`SessionCheckoutDiscardOperation`(334-338)、`SessionCheckoutRecoverOperation`(340-342)；`SessionCheckoutOperation`(344-353) 联合上述。
- 结果类型：`SessionCheckoutAppliedResult`(355-359)、`Previewed`(361-365)、`Checkpointed`(367-372)、`PreviewRolledBack`(374-378)、`PreviewDetached`(380-386)、`WorktreePushOutcome`(389-392)、`SessionCheckoutFinishedResult`(394-411, 含 branch(403)/cleanup/cleanupMessage?/cleanupReason?/push?(410))、`ManagedWorktreeCleanupEligibility`(413)、`ManagedWorktreeCleanupBlockReason`(415-423)、`ManagedWorktreeCleanupView`(426-431)、`BulkCleanupManagedWorktreeCandidate`(433-436)、`BulkCleanupManagedWorktreesResult`(438-441)、`ManagedWorktreeSummaryState`(443-450)、`ManagedWorktreeSummaryView`(453-480, path-free 投影，含 `permanent?`(470)/`approximateBytes`(473)/`canCleanup`(475)/`cleanup?`(477)/`activeSessionIds?`(479))、`PruneMergedBranchEntry`(483-487)、`PruneMergedBranchesView`(489-494)、`AbandonedWorktreeSnapshotView`(497-503)。
- `ApplyBaseStrategy`(505-509)、`ApplyConflictDetail`(510-514)、`CONFLICT_DETAIL_FILE_LIMIT=6`(517)、`CONFLICT_DETAIL_DIFF_LIMIT=4096`(518)、`MergeLocalBranchOutcome`(520)、`MergeLocalBranchResult`(522-529)、`MergeBranchForSessionView`(531-540, 含 `direction: 'forward' | 'reverse'`(539))。
- `ApplyConflictReason`(548)：`content_conflict` / `local_dirty` / `untracked_conflict`。
- `SessionCheckoutConflictResult`(550-566, 含 `reason`(553)/`resolveHint?`(565)/`conflictDetails?`(563))、`Discarded`(568-571)、`Recovered`(573-576)、`SessionCheckoutOperationErrorResult`(578-583)、`SessionCheckoutOperationResult`(585-595)。
- `SESSION_CHECKOUT_ERROR_CODES`(597-627) 及 `SessionCheckoutErrorCode`(629)、`SessionCheckoutFailure`(631-634)。

### 端口契约（src/ports.ts）

- `SessionCheckoutSessionRecord`(21-26)、`SessionCheckoutProjectRecord`(28-32)、`SidebarDirectoryMembership`(34-38)、`SessionCheckoutLookupPort`(40-60，含可选 `listLiveSessions?`(59)，竞态守卫据此枚举活跃会话)。
- `GitCheckoutSnapshot`(62-69)：`root`、`commonDir`、`gitDir`、`branch`、`headOid`、`headRef`。
- `BranchOverviewEntry`(71-77)、`TagOverviewEntry`(79-90, `name`/`oid`/`commitOid`/`annotated`/`message`/`pushed`)、`GraphLogCommit`(92-101)、`InitialCommitPreflight`(103-107)。
- `SessionCheckoutGitPort`(109-230)：核心方法 `inspect`(119)/`findContainingWorktreeRoot`(121)/`status`(122)/`createDetachedWorktree`(123)/`attachWorktreeBranch?`(131，CAS 到 `expectedOldOid`，文档 124-130)/`removeWorktree`(133)/`retainApplyBase`(134)/`releaseApplyBase`(135)/`retainInternalArtifact`(136)/`readInternalArtifact`(138)/`releaseInternalArtifacts`(139)/`isAncestor`(141)；本地适配可选方法 `resolveLocalBranchTip?`(118)、`listLocalBranches?`(116)、`listWorktreeincludeFiles?`(142)、`pushBranch?`(148)、`repairWorktreeLinks?`(154)、`pruneWorktrees?`(159)、`branchOverview?`(165)、`defaultBranch?`(170)、`branchTipTimes?`(175)、`branchCreationTimes?`(181)、`deleteLocalBranch?`(183)、`mergeLocalBranch?`(189)、`graphLog?`(191)、`createLocalBranch?`(193)、`switchLocalBranch?`(195)、`listTags?`(201)、`createTag?`(203)、`deleteLocalTag?`(205)、`pushTag?`(210)、`deleteRemoteTag?`(212)、`captureLocalWip?`(217)、`applyWorktreePatch?`(219)、`listUntrackedFiles?`(221)、`snapshotAbandonedWorktree?`(227)、`restoreAbandonedSnapshot?`(229)。
- `DirectoryIdentity`(232-236)：`device`/`inode`/`birthtimeNs`。
- `SessionCheckoutFilesPort`(238-255)：`exists`(239)/`canonicalize`(240)/`inspectDirectoryIdentity`(241)/`ensureDirectory`(242)/`removeEmptyDirectoryTree`(244)/`quarantineDirectoryTree`(246)/`removeDirectoryTree`(248)/`measureDirectoryBytes`(250)/`readTextFile?`(251)/`copyFile?`(252)/`isSymbolicLink?`(254)。
- `SessionBindingRecord`(257-267)：`sessionId`、`projectId`、`projectName`、`target`、`ownerSessionId`、`inheritedFromSessionId?`、`sourceRef`、`sourceOid`、`revision`。
- `ManagedCheckoutJournalBase`(269-272)、`WorktreeCreationEvidence`(274-286)、`ManagedCheckoutCreateJournal`(288-292)、`ManagedCheckoutMutationJournal`(294-329, operation 枚举含 `cleanup`(295)，step 枚举含会话分支交付专用的 `committing_session_branch`(299) 及 `cleanupQuarantinePath?`(328))、`ManagedCheckoutJournal`(331)。
- `ManagedWorktreeCheckpointRecord`(333-350, 幂等键 `requestId?`(338)/`requestedRevision?`(340)/`generation?`(341))、`ManagedWorktreePreviousReviewRecord`(352-359)、`ManagedWorktreeReviewRecord`(361-374)、`ManagedPreviewReceipt`(376-395, 含 `localWorkingTreeOid`(388)/`localIndexTreeOid`(389)/`previewWorkingTreeOid`(390)/`isolatedSnapshotOid`(393) 四个回滚锚点)、`ManagedDeliveryProof`(397-405)。
- 恢复续传类型：`ManagedApplyConflictRecoveryContinuation`(407-415)、`ManagedReviewRegenerationContinuation`(417-422)、`ManagedPreviewRecoveryAnalysisContinuation`(424-431)、`ManagedPreviewRecoveryHandoffContinuation`(433-441)、`ManagedRecoveryContinuation`(443-447)。
- `ManagedCheckoutDelivery`(449-485)：与 `WorktreeDeliveryView` 对应的持久化形态（finalized/retained 成员有 `cleanupMessage?` 但**未声明** `cleanupReason`）。
- `ManagedCheckoutRecord`(487-540)：核心持久化记录——`checkoutId`(488)、`predecessorCheckoutId?`(490)、`projectId`(491)、`projectName`(492)、`ownerSessionId`(493)、`sourceSessionId?`(495)、`localRoot`(497)、`managedRoot`(499)、`managedGitRoot`(501)、`gitCommonDir`(502)、`gitDir`(503)、`baseOid`(504)、`applyBaseOid?`(506)、`previousReview?`(508)、`checkpoints?`(510)、`recoveryContinuation?`(512)、`abandonedSnapshotOid?`/`abandonedSnapshotAt?`(514-515)、`permanent?`(517)、`sidebarBadgeClearedRevision?`(519)、`sourceRef`(520)、`sessionBranch?`(528，文档 521-527)、`sessionTopic?`(536，文档 529-535)、`phase`(537)、`delivery`(538)、`journal`(539)、`revision`(540)。
- `ManagedCheckoutsRegistry`(542-547)：`version: 2`、`revision`、`sessionBindings`、`managedCheckouts`。
- `SessionCheckoutRegistryPort`(549-552)。
- `LiveValue<T>`(555-557) 与 `liveConfigValue<T>`(560-565)。
- `SessionCheckoutDependencies`(567-608)：聚合 lookup/git/files/registry/applyEngine/managedCheckoutsRoot/createCheckoutId 及可选 live 配置 `autoPush`(576)/`autoDeliver`(578)/`worktreesRoot`(584)/`inheritLocalChanges`(591)/`worktreeKeepCount`(598)/`branchRaceGuard`(605)/`branchRaceWindowMs`(607)。

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
┌──────────────────────────────────────────────────────────────────┐
│    createSessionCheckoutModule (src/session-checkout-module.ts)  │
│                                                                  │
│  bind/create           operate*             list/manage/prune    │
│  bindTarget 4823       finish 3329          summarize 3841       │
│  createIsolatedTarget  preview 2623         cleanup 检查 3994    │
│   5179                                                           │
│      └─────────► withBindingLock (1279) ◄──────────┘             │
│           exclusive / maintenance / draining                     │
│                        │                                         │
│    ┌───────────┬────────┴──────┬─────────────┐                    │
│    ▼           ▼               ▼             ▼                    │
│ 身份校验    applyEngine      registry v2    git port              │
│ validate*   plan/preview/    读写 1660      ports.ts 109-230      │
│ 587-734     commitIsolated                                       │
│                                                                  │
│ 会话分支层 attachSessionBranch(744) / ensureSessionBranch(800)   │
│ refuseLegacyLocalWrite(1646) ──► 交付只写 refs/heads/feat/…      │
└──────────────────────────────────────────────────────────────────┘
```

## Data Flow

1. **绑定与创建**：`bind` / `createIsolatedTarget` 经 `bindTarget`（4823）解析项目与 git 快照、生成路径候选、写入 `preparing` 记录与 binding、`createDetachedWorktree` 后复验 git 身份，随后立即 `attachSessionBranch`（744）把 Worktree 挂到 `feat/sess-<会话>[--<主题>]`，`sessionBranch` 与 `sourceRef` 同写该 ref，记录转 `ready`。
2. **编辑与检查点**：改动只发生在 Worktree。`checkpoint`（`operateCheckpoint` 1757）用 `requestId` 幂等 + `expectedGeneration` CAS，在 `refs/…/checkpoints/<id>` 上留证，提交后回 `working`。
3. **Review 与 Preview**：`markReadyForReviewTarget`（1674）先 `ensureSessionBranch` 再固化 review 指纹（1707-1714）；`operatePreview`（2623）在 receipt 保护下把改动写进 Local，`beforeWrite` 内先留工件再置 `preview_active`。Local 一旦漂移，预览进入 `preview_detached`（2775），需要 `preflightPreviewRecoveryTarget`（2424）生成的 proof 才能继续。
4. **交付（只写会话分支）**：`operateFinish`（3329）先 `ensureSessionBranch`（800），再 `reviewIsolated` + `commitIsolated(branchRef)`，`proof.localBranch` 记会话分支名，自动 push 也推会话分支，Local 的三个面全程不读写。旧的 `operateApply` / `operatePreview` / `operateFinalizePreview` 在存在 `sessionBranch` 时被 `refuseLegacyLocalWrite`（1646）拒绝并指向 `worktree_deliver`。
5. **合并**：`mergeBranchForSession`（4205）先认 `record.sessionBranch`，拒绝把 Local 自身分支当来源，并区分「别的会话的分支」；真实合并前检查项目验收槽，冲突现场留给用户解决。
6. **保留与清理**：`finalized` 可 `retain_*` 冻结环境（默认 `retain_24h`，src/types.ts:39），或直接 `cleanupFinalized`（2969）删除目录；目录身份不符/交付后又有改动会被挡成 `identity_changed` / `modified_after_finalize`；到期由 `cleanupExpiredRetained`（4465）、总量由 `enforceWorktreeKeepCount`（4493）收口。
7. **崩溃恢复**：启动或显式 `recover` 时 `reconcile()`（1352）按 journal step 前进或回退；finish 的 `committing_session_branch` step 落入通用 `mutating` 分支（1551-1560），被视作可能已产生提交，收敛为 `recovery_required` 而不是草率回 `ready`。

## Connections

- [[session-checkout-apply]]：`applyEngine` 的实现，提供 `plan` / `preflight` / `preview` / `rollback` / `finalize` / `recoverCheckpoint` / `inspectReview` / `reviewIsolated` / `commitIsolated`。
- [[managed-worktree-path]]：会话分支名候选与 Worktree 目录/路径候选生成，`createSessionBranchCandidates` 是 `attachSessionBranch` 的唯一取名来源。
- [[registry]]：`ManagedCheckoutsRegistry` 的持久化与原子写入。
- [[git-port]]：`SessionCheckoutGitPort` 适配器，`attachWorktreeBranch` / `resolveLocalBranchTip` / `mergeLocalBranch` 是会话分支语义的底层支点。
- [[file-port]]：`SessionCheckoutFilesPort`，目录身份、隔离与删除能力。
- [[session-management]]：`lookup` 端口提供会话与项目记录，决定 owner 与 cwd 归属判定。
- [[concurrent-session-guard]]：`detectLocalBranchRace`（src/session-checkout-module.ts:75 引入）实现分支竞态判定，供 `branchRaceNotice` 消费。
- [[host-messages]]：所有面向用户的文案键与持久化清理文案的映射表。

## Known Issues

- **detached 兼容残留**：端口不实现 `attachWorktreeBranch` 时，`attachSessionBranch`（750-754）与 `ensureSessionBranch`（801-807）都只 warn 并退回旧行为，此时 `record.sessionBranch` 永不写入。
- **历史记录仍可写 Local**：`refuseLegacyLocalWrite`（1646-1658）只对存在 `sessionBranch` 的记录生效（1650），因此旧版本创建、无会话分支的记录仍可走 `operateApply` / `operatePreview` / `operateFinalizePreview` 写回 Local；`operateFinish`（3359-3365）与 `operateDiscard`（3599-3605）对这类 wrote-to-Local 中间态另有显式拒绝。
- **迭代基点会退化**：`beginNextIterationTarget`（4517）用 `resolveLocalBranchTip` 找上一轮会话分支 tip（4576-4581），找不到（分支被删/改名）就退回 Local 的 `headOid`，上一轮内容会在迭代链上断开——源码注释（4573-4575）已点明这一点。
- **`operateFinish` 重读记录只校验 phase**：`ensureSessionBranch` 之前那次 registry 重读只判 `phase !== 'ready'`（3382-3385），不再比 `revision`，并发窗口依赖 `withBindingLock`（1279）与 `updateManagedCheckout`（1660）的 CAS 兜底。
- **清理失败原因被折叠**：`cleanupFinalized`（2969）的 `catch`（3133-3152）把所有异常降级成 `quarantine_busy` / `directory_busy` 的 `pending`/`blocked`，不区分底层错误类型，只能靠 `console.warn('[session-checkout] finalized Worktree cleanup failed:', error)`（3134）定位。
- **清理超时不做取消**：`withCleanupTimeout`（107-125）只让启动收敛先走（超时返回 `null`），后台操作继续跑完；`withBindingLock` 保证同进程重试串行、台账写入安全（注释 100-103）。若实际挂起普遍超过 2min，需要给 files/git ports 加 AbortSignal。
- **`retain_24h` 是默认值**：调用方未显式给 `retention` 时（`DEFAULT_WORKTREE_RETENTION`，src/types.ts:39；使用点 3278、3531）冻结环境会留一天，磁盘占用与 `approximateBytes` 会持续到到期清理。
- **旧写回校验仍在**：`inspectCleanupForRecord`（3938）在 `commitOid + proof` 时仍用 `validateCommittedLocalCheckout` + `isAncestor` 验证交付提交在 Local 历史里（3947-3956），这是写回语义的遗留；会话分支交付的提交不在 Local 历史中，该分支逻辑对这类记录不再成立。
- **双轨记录共存**：`ManagedCheckoutDelivery`（src/ports.ts:449-485）的 finalized/retained 成员未声明 `cleanupReason`，但 `cleanupFinalized` 的 `block()`（2973-2997）与 `catch`（3141-3150）运行时会写入该字段；视图类型 `WorktreeDeliveryView`（src/types.ts:104-126）已声明它。`persistedCleanupReason`（155-160）读不到结构化字段时回退文案匹配，新旧记录在同一份台账里语义不完全一致。
- **分支竞态守卫静默降级**：`refreshBranchRaceGuards`（992）探测失败时保留旧快照（1013-1015），端口缺 `branchCreationTimes` 时守卫整体静默（994）；`branchRaceNotice`（1025）在这些环境下永远返回空串，不产生任何提示——守卫是尽力而为，不是硬保证。