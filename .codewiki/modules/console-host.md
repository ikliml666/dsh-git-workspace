---
title: Console Host Control Plane
type: module
source_files:
  - src/console-host/control-plane.ts
  - src/console-host/service.ts
  - src/console-host/projection.ts
  - src/console-host/errors.ts
  - src/console-host/review-diff.ts
  - src/console-remote/remote.ts
  - src/console-remote/descriptors.ts
  - src/console-remote/schemas.ts
tags:
  - rpc
  - control-plane
  - typert
  - projection
---

# Console Host Control Plane

三层结构：客户端 UI（Worktree 卡片/验收界面）↔ strict Typert RPC（`gitWorktree` 服务）↔ 宿主控制面。控制面把状态机（[[session-checkout-module|Session Checkout Module]]）的领域能力投影为 UI 可用的读/写端点，并集中实现授权与并发守卫。

## 控制面编排（src/console-host/control-plane.ts，1260 行）

- Options（src/console-host/control-plane.ts:59）：{module, lookup, files, registry, git, reviewDiff, createTargetSessionId=randomUUID}；接口（src/console-host/control-plane.ts:69-101）定义 31 个业务端点，全部返回 `Promise<WorktreeConsoleOutcome<T>>`——sidebarTopology/current/list/preflightCreate/createWithInitialCommit/create/initProject/inspect/reviewDiff/preflight/previewRecoveryPreflight/preparePreviewRecoveryAnalysis/createPreviewRecoveryHandoff/preview/checkpoint/resumeRevision/prepareReviewRegeneration/rollbackPreview/discard/finalize/finalizePreview/setRetention/setPermanent/retryCleanup/beginNextIteration/gitOverview/gitGraph/gitCreateBranch/gitSwitchBranch/listAbandoned/restoreAbandoned。
- **authorize**（src/console-host/control-plane.ts:249）：读端点传请求内观察到的 caller；mutation 一律重新 inspect。校验 owner 或 source 会话（not_owner）、projectId 匹配（project_mismatch）、verifyCallerRoot（canonicalize 后 sameLocalRoot；例外 cleanedOwnerCwd——owner 会话本身+discarded+delivered+原 project.root 已不存在）、非 discarded 记录必须出现在 listManagedWorktreesForSession。
- **linkedReadAccess**（src/console-host/control-plane.ts:271）：非 owner 读路径——caller 须 isolated 且先 authorize 自身 anchor；sameLinkedGroup=同 projectId+同 source 会话+同 localRoot；或 exactAcceptanceHolder（caller 持 ready_for_review 验收槽且目标即验收对象），验收槽持有人需从 registry 重新校验（`theAcceptanceSlotHolderHasChangedCheckAgain`）。
- **withCreation**（src/console-host/control-plane.ts:486）：`session:${id}`+`root:${canonical}` 双键 creating Set 守卫 → operation_not_allowed `initialRepositoryBusy`；createTarget 后回验 record.sourceSessionId/ownerSessionId/managedRoot 与 launch 一致（`hostIdentityVerificationFailedForTheNewlyCreatedWorktree`，src/console-host/control-plane.ts:509）。
- 读端点：sidebarTopology（src/console-host/control-plane.ts:529，按 project 分组、跨 iteration 并集）/ current（src/console-host/control-plane.ts:585，local→projectLocal / isolated→details）/ list（src/console-host/control-plane.ts:649，isolated caller 先 authorize anchor 推导 sourceSessionId+localRoot；记录观察优先批量 `module.observeManagedCheckouts`——一次拿锁并行验证全部非 discarded 记录，模块缺批量方法时回退逐条 observe）/ observe（src/console-host/control-plane.ts:331，discarded→null，优先 module.observeManagedCheckout）/ details。
- list 降级观察：批量观察整体拒绝（src/console-host/control-plane.ts:681-684）或回退路径上单条验证失败（src/console-host/control-plane.ts:699-703）时，该记录以无观察投影呈现（projectRecord 的 observed 可选——回退 fallbackOid 与模块 summary），面板其余记录照常，list 不再抛 `checkout_mismatch` 整表失败；mutation 的 CAS/authorize 仍在操作时兜底拒绝。
- 项目级互斥投影：acceptanceHolder（src/console-host/control-plane.ts:353，另一同 localRoot 非 discarded checkout 持 preview_active 或 preview/rollback_preview/finalize_preview/finish journal）；projectReviewSlot（src/console-host/control-plane.ts:368，ready_for_review 时 reviewSlot available/waiting，waiting 时 preview/checkpoint/finalize 能力关闭）。
- 预检与 CAS 夹心：reviewDiff（src/console-host/control-plane.ts:761）在 diff 前后各做一次 module.preflight（reviewId+isolatedHeadOid 必须匹配，否则 stale_isolated `isolatedContentChangedAfterReadyDiffBytesWereDiscarded`）；preflight（src/console-host/control-plane.ts:801）/previewRecoveryPreflight（src/console-host/control-plane.ts:812）owner+revision(+reviewId/previewId) CAS。
- 空仓库创建：preflightCreate（src/console-host/control-plane.ts:719）→ confirmation token（Map 上限 500、300_000ms 过期）→ createWithInitialCommit（src/console-host/control-plane.ts:736，校验 token/root/projectId 后 initializeEmptyRepository）。
- 取长补短创建入口：create 增加可选 branch 参数（src/console-host/control-plane.ts:752，createTarget(sourceSessionId, branch?) → module.createIsolatedTarget(..., {branch})）；preflightCreate 的 ready 分支附带 branches（经 git.listLocalBranches，供 UI 基准分支下拉）；initProject（src/console-host/control-plane.ts:753，withCreation 守卫 + git.initializeProject）在用户显式确认后把非 Git/未出生项目初始化为有首次提交的仓库；sidebarTopology 任务携带 sourceBranch（src/console-host/projection.ts:105，sourceBranchFromRef 导出自该文件）。
- 恢复链：preparePreviewRecoveryAnalysis（src/console-host/control-plane.ts:832）/createPreviewRecoveryHandoff（src/console-host/control-plane.ts:862）——proof 五元组身份校验（stale_target）后调 module；handoff 回验 ownerSessionId==targetSessionId+continuation+managedRoot（`hostIdentityVerificationFailedForTheRecoveryHandoffWorktree`）。
- resumeRevision（src/console-host/control-plane.ts:963）支持 conflictContinuation（worktree_apply_conflict kind）带冲突恢复路径；prepareReviewRegeneration（src/console-host/control-plane.ts:1026）生成 review regeneration continuation；rollbackPreview（src/console-host/control-plane.ts:1051）支持 resumeRevision/recoveryProof 选项。
- finalize（src/console-host/control-plane.ts:1100）/finalizePreview（src/console-host/control-plane.ts:1144）CAS 夹心 + delivery proof 优先传递；setRetention（src/console-host/control-plane.ts:1189）/setPermanent（src/console-host/control-plane.ts:1200）/retryCleanup（src/console-host/control-plane.ts:1211）通过 manageManagedWorktreeForSession 下发管理动作；beginNextIteration（src/console-host/control-plane.ts:1221）要求 predecessor 为 delivered+discarded 态，回验 lineage 一致性。
- helper：recordOf（src/console-host/control-plane.ts:103）/sidebarTaskState（src/console-host/control-plane.ts:109）/readyReview（src/console-host/control-plane.ts:123）/previewReview（src/console-host/control-plane.ts:130）/safeRecoveryRequestId（src/console-host/control-plane.ts:140）/safeConflictFile（src/console-host/control-plane.ts:144）/applyConflictContinuation（src/console-host/control-plane.ts:150）/preflightFailure（src/console-host/control-plane.ts:175）。

## Typert 宿主服务（src/console-host/service.ts，315 行）

- `WorktreeConsoleService extends TypertRemoteService`，服务名 `gitWorktree`（src/console-host/service.ts:33-41）。
- 网关先解析 agentId 再进业务代码（src/console-host/service.ts:32）；每个 @Remote 方法参数带 (agent, ..., locale?)，统一 `withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? hostContext))` 包裹。
- `appendDiag`（src/console-host/service.ts:45）：ndjson 诊断 appendFileSync，best-effort——诊断失败绝不打断 RPC；`clientBootReport`（src/console-host/service.ts:68）记录 {kind:'client'} 后返回 true。
- sidebarTopology（src/console-host/service.ts:53）额外注入 workspaceClientFlavor + officialWorkspaceActive 诊断信息。
- 共 32 个 @Remote 方法（src/console-host/service.ts:52-314），覆盖控制面 31 个端点 + clientBootReport。

## 投影层（src/console-host/projection.ts，285 行）

- `capabilities()`（src/console-host/projection.ts:61）：14 个 UI 能力位；create 恒 false；discard=(owner||sourceReservation)&&active&&!cleanup&&!previewDetached；preflight/preview/finalize=owner&&ready；checkpoint=owner&&(ready||previewActive)；resumeRevision=owner&&ready；rollbackPreview=owner&&(previewActive||previewDetached||previewRecovery)；finalizePreview=owner&&(previewActive||previewDetached)；setRetention/manageAuthorized&&retained；setPermanent=manageAuthorized&&active；retryCleanup=manageAuthorized&&cleanup；beginNextIteration=owner&&delivered。
- `projectRecord`（src/console-host/projection.ts:109）：TargetSummary（state=consoleStateFromDomain、phase、dirty、currentOid、commitOid、sourceBranch、retention/expiresAt（当 retained）、cleanupMessage（经 hostPersistedCleanupMessage 复原）、deliveryProof（observed proof 优先，persisted proof 的 commitInLocalHistory 置 null 待验证）、review、checkpoints、checkpointGeneration CAS token、reviewSlot、previewRecovery）。
- `projectDetails`（src/console-host/projection.ts:181）：+ managedRoot/sourceRoot/sourceOid/currentBranch + owner-only recoveryContinuation（4 种 kind：worktree_apply_conflict/worktree_review_regeneration/worktree_preview_recovery_analysis/worktree_preview_recovery_handoff）。
- `projectLocal`（src/console-host/projection.ts:248）：checkoutId null、phase 'local'、仅 open/inspect 能力为 true；create = currentOid !== 'unversioned'。
- `sourceBranchFromRef`（src/console-host/projection.ts:105）：提取 refs/heads/ 后的分支名。
- 辅助函数：fallbackOid（src/console-host/projection.ts:100）、review（src/console-host/projection.ts:15）、commitOid（src/console-host/projection.ts:32）、deliveryProof（src/console-host/projection.ts:36）、iteration（src/console-host/projection.ts:57）。

## 错误与评审 diff

- errors.ts：`domainError`（src/console-host/errors.ts:5）构造带 code 的 Error；`consoleFailure`（src/console-host/errors.ts:13）——领域错误码（SESSION_CHECKOUT_ERROR_CODES 内）透传 code/message/continuation，未知错误归一为 git_error；`failure`（src/console-host/errors.ts:43）把异步操作包成带 code/message/details/continuation 的 Outcome；`outcome`（src/console-host/errors.ts:60）把同步 Promise 包装为 WorktreeConsoleOutcome。
- review-diff.ts：容量上限 REVIEW_DIFF_MAX_FILES=200 / REVIEW_DIFF_MAX_PATCH_BYTES=100KB / REVIEW_DIFF_MAX_PAYLOAD_BYTES=1MB（src/console-host/review-diff.ts:9-11）；diff 在临时 object 目录计算（GIT_OBJECT_DIRECTORY+GIT_ALTERNATE_OBJECT_DIRECTORIES，src/console-host/review-diff.ts:128-142），read-tree baseOid + add -A 反映当前工作树；carried project skills 用 update-index --force-remove 批量剔除；实际 changedPathSet 必须与请求完全一致，否则 `ReviewDiffStaleError`（src/console-host/review-diff.ts:25）；payload 超限按 utf8Prefix 截 patch 并标记 truncated；批处理 REVIEWS_DIFF_BATCH_SIZE=8 并行取证。

## strict RPC 契约（src/console-remote/）

- remote.ts（71 行）：`GitWorktreeRemote = TypertRemoteNamespace<'gitWorktree'>`（src/console-remote/remote.ts:27），并对 `TypertRemoteMap` 做 module augmentation 声明全部 32 个方法签名（首参 agentId、尾参 locale?、返回 `RemoteResult<WorktreeConsoleOutcome<T>>`）。
- descriptors.ts（221 行）：PACKAGE='dsh-git-worktree'、SERVICE='gitWorktree'（src/console-remote/descriptors.ts:40-41）；`strictCodec`（src/console-remote/descriptors.ts:46）同时携带 schema 与 create()——旧 Harness 读 schema、新 strict 网关经 create() 具化，两者必须引用同一 schema 以保线缆契约；agent 参数 wire=agentId、source=lookup（src/console-remote/descriptors.ts:52）；`WORKTREE_CONSOLE_DESCRIPTORS` 32 条冻结描述符（src/console-remote/descriptors.ts:88，gitOverview/gitGraph/sidebarTopology/clientBootReport/initProject 的参数面、create 带可选 branch 标量参数 acceptsUndefined）；`WORKTREE_CONSOLE_REMOTE` 冻结贡献 {package, descriptors}（src/console-remote/descriptors.ts:218）。
- schemas.ts（418 行）：zod strict 对象覆盖所有请求/响应/错误载荷——sessionIdSchema（1-200、禁 \0\r\n，src/console-remote/schemas.ts:27）、checkoutIdSchema（禁 '..' 与路径分隔符，src/console-remote/schemas.ts:28）、oidSchema='unversioned'|'unborn'|40/64 位 hex（src/console-remote/schemas.ts:33）、generationSchema=64 hex、capabilitiesSchema 14 位（src/console-remote/schemas.ts:80）、checkpointSchema changedFiles ≤500 且带路径安全 refine（src/console-remote/schemas.ts:59）、recoveryContinuationSchema discriminated union 四种 kind、previewRecoveryProofSchema 含 rollback/finalize/blocker 子类型。

交叉链接：[[host-overview|Host Entry and Registration Surface]]、[[session-checkout-module|Session Checkout State Machine]]、[[adapters|Adapter Layer]]。
