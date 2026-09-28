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

## 控制面编排（src/console-host/control-plane.ts，1125 行）

- Options（src/console-host/control-plane.ts:52）：{module, lookup, files, registry, git, reviewDiff, createTargetSessionId=randomUUID}；接口（src/console-host/control-plane.ts:62-86）定义 23 个业务端点，全部返回 `Promise<WorktreeConsoleOutcome<T>>`。
- **authorize**（src/console-host/control-plane.ts:234）：读端点传请求内观察到的 caller；mutation 一律重新 inspect。校验 owner 或 source 会话（not_owner）、projectId 匹配（project_mismatch）、verifyCallerRoot（canonicalize 后 sameLocalRoot；例外 cleanedOwnerCwd——owner 会话本身+discarded+delivered+原 project.root 已不存在）、非 discarded 记录必须出现在 listManagedWorktreesForSession。
- **linkedReadAccess**（src/console-host/control-plane.ts:256）：非 owner 读路径——caller 须 isolated 且先 authorize 自身 anchor；sameLinkedGroup=同 projectId+同 source 会话+同 localRoot；或 exactAcceptanceHolder（caller 持 ready_for_review 验收槽且目标即验收对象），验收槽持有人需从 registry 重新校验（`theAcceptanceSlotHolderHasChangedCheckAgain`）。
- **withCreation**（src/console-host/control-plane.ts:454）：`session:${id}`+`root:${canonical}` 双键 creating Set 守卫 → operation_not_allowed `initialRepositoryBusy`；createTarget 后回验 record.sourceSessionId/ownerSessionId/managedRoot 与 launch 一致（`hostIdentityVerificationFailedForTheNewlyCreatedWorktree`，src/console-host/control-plane.ts:472）。
- 读端点：sidebarTopology（src/console-host/control-plane.ts:497，按 project 分组、跨 iteration 并集）/ current（src/console-host/control-plane.ts:552）/ list（src/console-host/control-plane.ts:560，isolated caller 先 authorize anchor 推导 sourceSessionId+localRoot）/ observe（src/console-host/control-plane.ts:316，discarded→null，优先 module.observeManagedCheckout）/ details。
- 项目级互斥投影：acceptanceHolder（src/console-host/control-plane.ts:338，另一同 localRoot 非 discarded checkout 持 preview_active 或 preview/rollback_preview/finalize_preview/finish journal）；projectReviewSlot（src/console-host/control-plane.ts:353，ready_for_review 时 reviewSlot waiting/available，waiting 时 preview/checkpoint/finalize 能力关闭）。
- 预检与 CAS 夹心：reviewDiff（src/console-host/control-plane.ts:637）在 diff 前后各做一次 module.preflight（reviewId+isolatedHeadOid 必须匹配，否则 stale_isolated `isolatedContentChangedAfterReadyDiffBytesWereDiscarded`）；preflight（src/console-host/control-plane.ts:677）/previewRecoveryPreflight（src/console-host/control-plane.ts:688）owner+revision(+reviewId/previewId) CAS。
- 空仓库创建：preflightCreate（src/console-host/control-plane.ts:603）→ confirmation token（Map 上限 500、300_000ms 过期）→ createWithInitialCommit（src/console-host/control-plane.ts:617，校验 token/root/projectId 后 initializeEmptyRepository）。
- 恢复链：preparePreviewRecoveryAnalysis（src/console-host/control-plane.ts:708）/createPreviewRecoveryHandoff（src/console-host/control-plane.ts:738）——proof 五元组身份校验（stale_target）后调 module；handoff 回验 ownerSessionId==targetSessionId+continuation+managedRoot（`hostIdentityVerificationFailedForTheRecoveryHandoffWorktree`）。

## Typert 宿主服务（src/console-host/service.ts，264 行）

- `WorktreeConsoleService extends TypertRemoteService`，服务名 `gitWorktree`（src/console-host/service.ts:36）。
- 网关先解析 agentId 再进业务代码（src/console-host/service.ts:27）；每个 @Remote 方法参数带 (agent, ..., locale?)，统一 `withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? hostContext))` 包裹。
- `appendDiag`（src/console-host/service.ts:40）：ndjson 诊断 appendFileSync，best-effort——诊断失败绝不打断 RPC；`clientBootReport`（src/console-host/service.ts:63）记录 {kind:'client'} 后返回 true。
- 服务在控制面 23 个端点之上加 sidebarTopology 诊断与 clientBootReport，共 24 个 RPC 方法。

## 投影层（src/console-host/projection.ts，282 行）

- `capabilities()`（src/console-host/projection.ts:61）：14 个 UI 能力位；host 侧 create 恒 false；discard=(owner||sourceReservation)&&active&&!cleanup&&!previewDetached；preflight/preview/finalize=owner&&ready；checkpoint=owner&&(ready||previewActive)；beginNextIteration=owner&&delivered。
- `projectRecord`（src/console-host/projection.ts:108）：TargetSummary（state=consoleStateFromDomain、phase、dirty、currentOid、retention、cleanupMessage 经 hostPersistedCleanupMessage 复原、deliveryProof（observed proof 优先，persisted proof 的 commitInLocalHistory 置 null 待验证）、review、checkpoints、checkpointGeneration CAS token、reviewSlot、previewRecovery）。
- `projectDetails`（src/console-host/projection.ts:179）：+ managedRoot/sourceRoot/sourceOid/currentBranch + owner-only recoveryContinuation（4 种 kind：worktree_apply_conflict/worktree_review_regeneration/worktree_preview_recovery_analysis/worktree_preview_recovery_handoff）。
- `projectLocal`（src/console-host/projection.ts:246）：checkoutId null、phase 'local'、仅 open/inspect 能力为 true；create = currentOid !== 'unversioned'。

## 错误与评审 diff

- errors.ts：`consoleFailure`（src/console-host/errors.ts:13）——领域错误码（SESSION_CHECKOUT_ERROR_CODES 内）透传 code/message/continuation，未知错误归一为 git_error；`outcome`（src/console-host/errors.ts:56）把异步操作包成 WorktreeConsoleOutcome；`domainError`（src/console-host/errors.ts:5）构造带 code 的 Error。
- review-diff.ts：容量上限 REVIEW_DIFF_MAX_FILES=200 / REVIEW_DIFF_MAX_PATCH_BYTES=100KB / REVIEW_DIFF_MAX_PAYLOAD_BYTES=1MB（src/console-host/review-diff.ts:9-11）；diff 在临时 object 目录计算（GIT_OBJECT_DIRECTORY+GIT_ALTERNATE_OBJECT_DIRECTORIES，src/console-host/review-diff.ts:135-141），read-tree baseOid + add -A 反映当前工作树；carried project skills 用 update-index --force-remove 批量剔除；实际 changedPathSet 必须与请求完全一致，否则 `ReviewDiffStaleError`（src/console-host/review-diff.ts:25）；payload 超限按 utf8Prefix 截 patch 并标记 truncated。

## strict RPC 契约（src/console-remote/）

- remote.ts（58 行）：`GitWorktreeRemote = TypertRemoteNamespace<'gitWorktree'>`（src/console-remote/remote.ts:22），并对 `TypertRemoteMap` 做 module augmentation 声明全部 24 个方法签名（首参 agentId、尾参 locale?、返回 `RemoteResult<WorktreeConsoleOutcome<T>>`）。
- descriptors.ts（192 行）：PACKAGE='dsh-git-worktree'、SERVICE='gitWorktree'（src/console-remote/descriptors.ts:33-34）；`strictCodec`（src/console-remote/descriptors.ts:39）同时携带 schema 与 create()——旧 Harness 读 schema、新 strict 网关经 create() 具化，两者必须引用同一 schema 以保线缆契约；agent 参数 wire=agentId、source=lookup（src/console-remote/descriptors.ts:43）；`WORKTREE_CONSOLE_DESCRIPTORS` 24 条冻结描述符（src/console-remote/descriptors.ts:79，sidebarTopology/clientBootReport 的 withAgent=false）；`WORKTREE_CONSOLE_REMOTE` 冻结贡献 {package, descriptors}（src/console-remote/descriptors.ts:189）。
- schemas.ts（358 行）：zod strict 对象覆盖所有请求/响应/错误载荷——sessionIdSchema（1-200、禁 \0\r\n，src/console-remote/schemas.ts:21）、checkoutIdSchema（禁 '..' 与路径分隔符，src/console-remote/schemas.ts:22）、oidSchema='unversioned'|'unborn'|40/64 位 hex（src/console-remote/schemas.ts:27）、generationSchema=64 hex、capabilitiesSchema 14 位（src/console-remote/schemas.ts:68）、checkpointSchema changedFiles ≤500 且带路径安全 refine（src/console-remote/schemas.ts:47）。

交叉链接：[[host-overview|Host Entry and Registration Surface]]、[[session-checkout-module|Session Checkout State Machine]]、[[adapters|Adapter Layer]]。
