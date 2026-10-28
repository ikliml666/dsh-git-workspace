---
title: client_review_console
type: module
source_files:
  - src/client/review-console/index.ts
  - src/client/review-console/status-events.ts
  - src/client/review-console/recovery-continuation.ts
  - src/client/review-console/WorktreeReviewPanel.tsx
  - src/client/review-console/ReviewActions.tsx
  - src/client/review-console/ReviewDetailsModal.tsx
  - src/client/review-console/DeliveryProof.tsx
  - src/client/review-console/PreflightStatus.tsx
  - src/client/review-console/preview-recovery-cache.ts
  - src/client/review-console/preflight-cache.ts
  - src/client/review-console/request-cache.ts
  - src/client/review-console/review-console.styles.ts
  - src/client/review-console/ReviewIcon.tsx
  - src/client/WorktreeReviewRow.tsx
  - src/console-contract.ts
  - src/types.ts
  - src/i18n/client-messages.ts
tags: [client_core, review-console, recovery-queue, preflight, delivery-proof, cas]
---

## Overview

`client_review_console` 是 [[client_core]] 下负责把 Worktree 验收状态渲染为可交互 UI 的子能力，目录位于 `src/client/review-console/`。它把 Host 权威的 `WorktreeConsoleTargetSummary` / `WorktreeConsoleReviewSummary`（定义于 `src/console-contract.ts:149` 与 `:135`）以及解析后的 `ParsedTool` 模型（由 `src/client/model.ts` 的 `parseReviewTool` 产出，被 `src/client/WorktreeReviewRow.tsx:29` 调用）投影成以下产物：

- **验收卡** `WorktreeReviewPanel`（`WorktreeReviewPanel.tsx:54`）：紧凑的迭代验收摘要、验证状态、文件数、可展开的验证细节。
- **验收详情弹窗** `ReviewDetailsModal`（`ReviewDetailsModal.tsx:36`）：完整版本信息、冲突文件、变更清单、测试、只读版本面板。
- **交付证明** `DeliveryProof`（`DeliveryProof.tsx:16`）：基于 `target.deliveryProof` 的提交/本地 HEAD/验证/本地历史证据，支持 `compact` 单行变体。
- **preflight 状态** `PreflightStatus`（`PreflightStatus.tsx:21`）与 `PreviewRecoveryPreflight` 缓存（`preview-recovery-cache.ts:1`）、`ReviewPreflight` 缓存（`preflight-cache.ts:1`）：只读同步预检与 detached preview 恢复预检。
- **durable 恢复请求队列** `recovery-continuation.ts`：在 `queued/sending/sent/failed/cancelled` 状态机下通过 `enqueue/restore/retry/cancel` 把恢复请求推给精确 owner Session 的 Harness prompt，并把未发送的请求用 `localStorage` 持久化到 `dsh-git-worktree:recovery:v1:<sessionId>`。每次实际发送前都通过 `adapter.inspect` + Session 绑定重做 Host/Session 身份 CAS 校验。

模块入口 `index.ts:12` 提供 `reviewEvidenceFromTarget` 与 `reviewIdentityFromTarget` 两个桥接函数，把 `WorktreeConsoleTargetSummary` 投影为面板依赖的 `WorktreeReviewEvidence` / `WorktreeReviewIdentity`。状态事件 `status-events.ts` 暴露 `requestWorktreeReviewRefresh` / `WORKTREE_REVIEW_REFRESH_EVENT`，让 `WorktreeReviewRow.tsx:51` 在解析到 review 时通知所有挂载的验收面重读 Host 权威 target。`review-console.styles.ts` 提供全部 CSS（`REVIEW_CONSOLE_STYLES`，`:1`，205 行），`ReviewIcon.tsx` 提供 lucide 图标映射。

## Key Components

### `index.ts`（模块入口与桥接）

- `reviewEvidenceFromTarget(target, detailsMarkdown?)` — `index.ts:12`。输入 `WorktreeConsoleTargetSummary` 与可选 Markdown 正文，输出 `WorktreeReviewEvidence | null`；若 `target.review` 为空返回 `null`，否则用 `target.review` 展开并可选地附加 `detailsMarkdown`（`index.ts:16-20`）。
- `reviewIdentityFromTarget(sessionId, target)` — `index.ts:24`。输出 `WorktreeReviewIdentity | null`；要求 `target.checkoutId` 与 `target.review` 都存在（`index.ts:28`），从 `target` 提取 `checkoutId`、`revision`、`review.reviewId`（`index.ts:29-34`）。
- 重导出：`WorktreeReviewPanel` 与类型 `WorktreeReviewEvidence`/`WorktreeReviewIdentity`/`WorktreeReviewPanelProps`（`index.ts:4-9`）。

### `status-events.ts`（跨面刷新事件）

- `WORKTREE_REVIEW_REFRESH_EVENT = 'dsh-git-worktree:review-refresh'` — `status-events.ts:1`。
- `requestWorktreeReviewRefresh(sessionId)` — `status-events.ts:4`。通过 `window.dispatchEvent(new CustomEvent(..., { detail: { sessionId } }))` 广播（`status-events.ts:5`）；`WorktreeReviewRow.tsx:51` 与 `:60` 监听此事件触发 `setRefreshNonce` 重读 target。

### `WorktreeReviewPanel.tsx`（验收卡）

模型/类型：

- `WorktreeReviewEvidence extends WorktreeConsoleReviewSummary` 并可选 `detailsMarkdown`（`WorktreeReviewPanel.tsx:9-11`）。
- `WorktreeReviewIdentity`：`sessionId`、`checkoutId`、`expectedRevision`、`expectedReviewId`（`WorktreeReviewPanel.tsx:13-18`）。
- `WorktreeReviewPanelProps`：`review`、`identity?`、`target?`、`unavailableMessage?`（`WorktreeReviewPanel.tsx:20-25`）。

函数：

- `validationLabel(status, t?)` — `:27`。映射 `passed/failed/partial` 到文案，默认 `automated.validation.not.run`。
- `testStatusLabel(status, t?)` — `:34`。映射测试 `passed/failed/not.run`。
- `reviewIsStale(target, identity, review)` — `:40`。若 `target` 为空返回 `false`；`target.state==='working'` 视为过期（`:46`）；否则在允许的状态集合内（`:47`），当 `target.review` 缺失，或 `target.revision !== expectedRevision`，或 `target.review.reviewId !== review.reviewId` 时返回 `true`（`:48-51`）。
- `WorktreeReviewPanel({review,target,identity,unavailableMessage})` — `:54`。渲染紧凑头（图标+标题+摘要，`:66-72`）、meta 行（验证/文件数/阶段数/细节开关，`:74-91`）、可展开验证细节（身份码+验证摘要+测试列表，`:93-113`），以及过期/不可用提示（`:115`）。`useEffect` 在 `review.reviewId/revision` 变化时折叠细节（`:58`）。

### `ReviewActions.tsx`（验收操作面板，1200 行）

Props：`ReviewActionsProps`（`ReviewActions.tsx:35-50`）含 `review`、`adapter?`、`services?`、`identity?`、`target?`、`disabled`、`unavailableMessage`、`renderStatus?`、`proofVariant?`、`isActive?`、`onStale`、`onTargetChange`。

组件级常量与状态：

- `DEFAULT_RETAIN_ENVIRONMENT = true`（`:80`），提交默认保留运行环境。
- `Mutation` 联合类型（`:52`）：`preview | checkpoint | resume_revision | recovery | recovery_analysis | recovery_handoff | open_holder | rollback | finish | finalize_preview | discard | retry_cleanup`。
- `CommitMode = 'finish' | 'finalize_preview'`（`:53`）。
- 本地 hooks 状态：`submitting`、`commitMode`、`checkpointOpen`、`discardOpen`、`commitMessage`、`checkpointMessage`、`retainEnvironment`、`retention`、`message`、`error`、`runtimeConflict`、`mutationLock`（`:101-114`），以及 `observedTargetRevision`/`observedReviewSlot` ref（`:115-116`），`recoverySnapshot = useWorktreeRecoverySnapshot(identity?.sessionId)`（`:117`）。

关键派生：

- `autoPreflightEnabled`（`:118-124`）：当 `adapter && identity && !disabled && target.state==='ready_for_review' && target.capabilities.preflight` 时启用自动预检快照。
- `safeReadyPreflight`（`:130-132`）：预检成功且非 `blocked`/`conflict`。
- `recoveryIdentity`（`:133-138`）：仅当 `target.state==='preview_detached' && target.previewRecovery` 时附加 `expectedPreviewId`。
- `activeRecovery`（`:148-153`）：把 `recoverySnapshot` 与 `identity` 的 `checkoutId`/`expectedReviewId` 对齐后返回。

Effect 与生命周期：

- `:155-158`：挂载/依赖变化时 `restoreWorktreeRecovery({sessionId, adapter, services, isActive})` 从 localStorage 恢复未发送的请求。
- `:160-168`：review 变化时重置消息/错误/checkpoint/retention。
- `:190-198`：target.revision 变化时清消息（除非正在提交）。
- `:200-212`：reviewSlot 从 `waiting` 变 `available` 时 `invalidateReviewPreflight` + `readReviewPreflight`。

核心回调（全部为组件内闭包）：

- `begin(mutation)`（`:214`）：加锁并返回 `false` 当 `disabled||!adapter||!identity||!target||mutationLock`。
- `finish()`（`:223`）、`closeMoreMenu()`（`:228`）、`finishError(nextError)`（`:232`）：处理 `apply_conflict` 写入 `runtimeConflict`（`:233-240`），`stale_target` 调 `onStale`（`:242-245`），`stale_local/stale_isolated` 调 `refreshPreflight`（`:246-249`）。
- `applyTarget(nextTarget)`（`:253`）：写 `observedTargetRevision` 后 `onTargetChange`，并通过 `requestWorktreeReviewRefresh(identity.sessionId)` 广播（`:257`）。
- `enqueueRecovery(request)`（`:260`）：包装 `enqueueWorktreeRecovery`。
- `startConflictRecovery(preflight, requestId?)`（`:265`）：requestId 默认 `preflight-conflict:<checkoutId>:<reviewId>:<revision>:<localHeadOid>`（`:267`）；先 `readReviewPreflight` 复检，`adapter.resumeRevision({...conflictContinuation})`（`:301`）恢复 Working，校验返回身份后 `enqueueRecovery`（`:346`）。
- `startReviewRegeneration(preflight)`（`:360`）：针对 `blocked && reason==='stale_isolated'`；`adapter.prepareReviewRegeneration` 后 `enqueueRecovery({kind:'worktree_review_regeneration',...})`（`:412`）。
- `recoverPreflight(preflight)`（`:424`）：按 conflict/blocked 分发到上面两个函数。
- `recoverRuntimeConflict()`（`:434`）：从 `runtimeConflict` 构造一个 `conflict` preflight 投给 `startConflictRecovery`。
- `previewLocal()`（`:453`）、`openCheckpoint()`（`:487`）、`checkpoint()`（`:494`）、`resumeRevision()`（`:536`）、`rollbackPreview()`（`:561`）、`submitCommit()`（`:625`）、`discard()`（`:699`）：各对应一处 Host 写操作的乐观 UI；均先 `readReviewPreflight(...,true)` 强制复检，再调 adapter，最后 `applyTarget`。
- `freshRecoveryProof()`（`:724`）、`analyzeRecovery()`（`:741`，读取式分析 prompt）、`handoffRecovery()`（`:797`，新 Worktree handoff prompt）。
- `retryCleanup()`（`:858`）、`openHolder()`（`:878`，打开占用验收槽位的 Worktree）。
- 渲染态派生：`live`/`allDisabled`/`ready`/`previewActive`/`previewRecovery`/`rollbackRecoverySafe`/`finalizeRecoverySafe`/`cleanupPending`/`terminal`/`canDiscard`（`:897-909`）。
- `primary` 按钮族（`:923-948`）按状态切换 preview / confirm-and-save / recover / retry-cleanup。
- 三个 `Modal`：`checkpointOpen`（`:1026`）、`commitMode!==null`（`:1054`）、`discardOpen`（`:1096`）。
- 渲染 `PreflightStatus`（`:1114-1123`，仅 `ready`）、detached preview recovery 面板（`:1124-1163`）、runtime conflict 提示（`:1164-1169`）、`activeRecovery` 状态机提示（`:1170-1187`，含 `retryWorktreeRecovery` 重发按钮 `:1183`）、`DeliveryProof`（`:1188`，`cleanup_pending||terminal` 时）、`error`（`:1192-1195`）。

### `ReviewDetailsModal.tsx`（详情弹窗）

- `validationText(status, t)`（`:8`）、`validationIcon(status)`（`:11`，返回 `ReviewIconName`）。
- `COLLAPSED_LIST_LIMIT = 5`（`:15`）。
- `ReviewDetailsList({label,className,items})`（`:17`）：可折叠列表，超过 5 项才显示展开/收起按钮（`:21-32`）。
- `ReviewDetailsModal({open,onClose,target,preflight})`（`:36`）：聚焦陷阱（`:41-64`）；根据 `target.state` 与 `preflight.status` 计算 `state`/`note`（`:68-71`）；渲染标题、迭代、文件/验证 meta、冲突文件、变更文件、测试、只读版本面板（reviewId/revision/currentOid，`:85`）。

### `DeliveryProof.tsx`（交付证明）

- `shortOid(value)`（`:4`）：取前 8 位。
- `validationLabel(status, t?)`（`:8`）：`passed/failed/partial/not_run` 到文案。
- `DeliveryProof({target,compact=false})`（`:16`）：读 `target.deliveryProof`，为空返回 `null`（`:20-21`）；`lifecycle` 文案按 `delivered/retained/cleanup_pending/else` 计算（`:22-28`）；`compact` 单行（`:29-34`）与完整 `section`（`:36-47`，含 commit/local HEAD before→after/files/validation/commitInLocalHistory）。

### `PreflightStatus.tsx`（同步预检状态）

- `shortOid`（`:7`）、`statusLabel(preflight,t?)`（`:11`）。
- `PreflightStatus({snapshot,target,compact,onRefresh,onRecovery,onOpenHolder,busy})`（`:21`）：按 `snapshot.status` 渲染 idle/null（`:40`）、loading（`:41`）、error（`:44`）以及 `conflict`（`:54`）与默认 facts 面板（`:76-112`）。conflict 提供「check again」与「ask agent to resolve conflicts」（`:65-70`）；blocked 提供重新检查 / regenerate-review / open-holding-task（`:100-111`）。

### `recovery-continuation.ts`（durable 恢复队列，550 行）

类型：

- `WorktreeApplyConflictRecoveryRequest`（`:6-17`）：`kind:'worktree_apply_conflict'` + `sessionId/requestId/checkoutId/reviewId/revision/localHeadOid/conflictingFiles`。
- `WorktreeReviewRegenerationRequest`（`:19-27`）：`kind:'worktree_review_regeneration'` + `sessionId/requestId/checkoutId/reviewId/revision`。
- `WorktreeRecoveryRequest`（`:29`）、`WorktreeRecoveryStatus`（`:30`）= `queued|sending|sent|failed|cancelled`。
- `WorktreeRecoverySnapshot`（`:32-36`）：`status`、`request`、`error?`。
- `RecoveryEntry`（`:38-47`）：运行时条目，含 `snapshot/adapter/services/isActive/claimed/abort/unsubscribers/listeners`。
- 模块级：`entries` Map（`:49`）、`listenerSets`（`:50`）、`STORAGE_PREFIX = 'dsh-git-worktree:recovery:v1:'`（`:51`）。
- `PersistedRecoveryStatus`（`:53`）= `queued|sending|failed`；`PersistedRecovery`（`:54-59`）：`version:1,status,request,error?`。

持久化与校验（关键安全边界）：

- `browserStorage()`（`:61`）：安全取 `localStorage`，未定义/抛错返回 `undefined`。
- `storageKey(sessionId)`（`:69`）：`STORAGE_PREFIX + sessionId`。
- `persistSnapshot(snapshot)`（`:73`）：`sent`/`cancelled` 时 `removeItem`（`:77-79`），其余写入 JSON（`:81-87`）；best-effort 吞异常（`:88-90`）。
- `readPersisted(sessionId)`（`:93`）：读出后做 `hasExactKeys` + 版本/状态/error 类型/`sessionId` 一致/`validRequest` 全套校验（`:100-109`），不合法则删键返回 `undefined`。
- `safeConflictFile(file)`（`:129`）：路径白名单（长度≤1000、无控制字符、非绝对路径、无 `..`/`''` 段）。
- `hasExactKeys(value,allowed)`（`:135`）：精确键集合匹配。
- `validRequest(request)`（`:140`）：校验 `sessionId/requestId/checkoutId/reviewId/revision` 边界与长度，按 `kind` 校验精确键集（`worktree_review_regeneration` 6 键、`worktree_apply_conflict` 8 键含 40/64 位 `localHeadOid` 与 ≤500 个安全文件路径，`:154-166`）。

状态机与调度：

- `publish(entry,snapshot)`（`:169`）：写 `entry.snapshot`、`persistSnapshot`、通知 listeners。
- `cancel(entry)`（`:179`）：`abort?.abort()`、`claimed=false`、`stopWatching`、`publish cancelled`。
- `samePath`（`:186`）、`targetMatchesRequest(target,request)`（`:195`）：把请求与 Host `inspect` 返回的 `WorktreeConsoleTargetDetails` 做精确字段比对（含 `recoveryContinuation` 逐项 `conflictingFiles` 长度与顺序相等，`:213-214`），这是「精确 Host/Session 身份 CAS 重校验」的核心。
- `activeSessionState(entry)`（`:227`）：返回 `active|pending|mismatch`，基于 `selectedSessionId`（来自 `src/client/actions.ts`）与 `retainedBy`（`:233-235`）。
- `sessionReady(entry,target,binding)`（`:238`）：要求 binding prompt 存在、选定 Session 一致、cwd 与 `managedRoot` 一致、Session `openState==='open' && !running && !removed`（`:244-251`）。
- `isCurrent(entry)`（`:254`）：确认本 entry 仍是当前条目且未取消且 `isActive`。
- `waitForSession(entry,binding)`（`:264`）：发布 `queued`，订阅 session 列表 / binding，250ms 轮询 `attempt`。
- `attempt(entry)`（`:280`，异步）：核心发送流程——`isCurrent`/`activeSessionState` 检查 → `adapter.inspect` → `targetMatchesRequest` → `sessionReady`/`binding.session.prompt` → 发布 `sending` → 重 inspect（确保精确身份）→ `binding.session.prompt([{type:'text',text: buildWorktreeRecoveryPrompt(request,t)}], 'queue', abort.signal)`（`:351`）→ 成功发布 `sent`，失败发布 `failed`（`:357-361`），异常发布 `failed`（`:363-370`）。

导出 API：

- `buildWorktreeRecoveryPrompt(request, t?)`（`:378`）：见下方专节。
- `enqueueWorktreeRecovery(input)`（`:389`）：新建/替换条目，非活跃直接 `cancelled`，`validRequest` 失败发 `failed`，否则 `attempt`（`:389-427`）。
- `restoreWorktreeRecovery(input)`（`:429`）：从内存或 localStorage 恢复；运行中重建则 `sending` 中止并置 `failed`（`:452-460`）。
- `retryWorktreeRecovery(sessionId)`（`:491`）：仅 `failed`/`cancelled` 可重发，`active` 否 `cancel`。
- `getWorktreeRecoverySnapshot(sessionId)`（`:503`）、`subscribeWorktreeRecovery`（`:507`）、`useWorktreeRecoverySnapshot(sessionId?)`（`:513`，基于 `useSyncExternalStore`）。
- `cancelWorktreeRecovery(sessionId,requestId?)`（`:523`）、`detachWorktreeRecoveryRuntime(sessionId)`（`:531`）、`clearWorktreeRecovery(sessionId)`（`:540`，清内存+localStorage）。

### `preflight-cache.ts` / `preview-recovery-cache.ts` / `request-cache.ts`（身份键缓存）

- `request-cache.ts`：`RequestSnapshot<TPreflight>`（`:9-13`）= `idle|loading|success|error`；`Entry`（`:15-20`）；`createRequestCache(options)`（`:41`）基于 **per-adapter WeakMap**（`caches`，`:51`），`key()` 生成身份串（用 `\u0000` 连接，见 `preflight-cache.ts:8-13`），`read` 单飞 + generation 防过期（`:78-109`），`invalidate` bump generation（`:111-117`），`useSnapshot` 经 `useSyncExternalStore` 暴露（`:119-148`）。
- `preflight-cache.ts`：`PreflightSnapshot`（`:5`）类型别名；用 `adapter.preflight(identity)` 建缓存（`:7-15`）；导出 `readReviewPreflight = cache.read`（`:18`）、`invalidateReviewPreflight = cache.invalidate`（`:21`）、`useReviewPreflight = cache.useSnapshot`（`:23`）。
- `preview-recovery-cache.ts`：同样形状，键含 `expectedPreviewId`（`:8-14`），请求 `adapter.previewRecoveryPreflight(identity)`（`:15`）；导出 `readPreviewRecoveryPreflight`（`:19`）、`invalidatePreviewRecoveryPreflight`（`:21`）、`usePreviewRecoveryPreflight`（`:23`）。

### `review-console.styles.ts`（样式表）

- `REVIEW_CONSOLE_STYLES`（`:1`，String.raw 模板，205 行）：`.dsh-wt-review-panel`、`.dsh-wt-details-modal`、`.dsh-wt-review-dock` 等全部 CSS 变量与布局，包括 responsive `@media (max-width:620px)`（`:118`、`:170`、`:195`）。

### `ReviewIcon.tsx`（图标）

- `icons` 映射（`:8-15`）：`file/branch/check/warning/minus/close/list/more/preview/confirm/rollback/edit/save/discard/local/down/create/search/manager/retain/send/shield/help/folder/external/refresh/chevron/pin/pinOff` → lucide 组件。
- `ReviewIconName`（`:16`）、`ReviewIcon({name,className})`（`:18`）：统一渲染 18px / stroke 1.75 的图标。

### `buildWorktreeRecoveryPrompt`（精确 ID/hash/JSON 路径的 agent 提示）

`buildWorktreeRecoveryPrompt(request, t=defaultClientTranslator)` 在 `recovery-continuation.ts:378`，是队列真正推给 owner Session 的 Harness prompt 文本。它只做两件事：把请求的精确身份（checkoutId、reviewId、revision、localHeadOid）填入 i18n 模板，并把冲突文件路径以 **JSON 编码**（`JSON.stringify` 逐文件 `- <json>`）作为「不可信路径数据」呈现（绝不解释为指令）。

- 当 `kind === 'worktree_review_regeneration'`：调 `t("the.current.managed.worktree.review.snapshot.is.stale", { p0: checkoutId, p1: reviewId, p2: revision })`（`:379-381`）。该模板（`src/i18n/client-messages.ts:279`）要求 agent **严格 Read Only**：核对 session/checkout 身份，确认无后台写入后重跑验证并再次 `ReadyForReview`，禁止 `ApplyWorktree`/`FinishWorktree`。
- 当 `kind === 'worktree_apply_conflict'`：先拼 `files`——若 `conflictingFiles` 非空则 `map(file => "- " + JSON.stringify(file)).join('\n')`，否则用 `t("no.conflicting.files.provided.rerun.the.read.only")` 占位（`:382-384`）；再调 `t("the.user.approved.worktree.sync.encountered.real.conflicts", { p0: checkoutId, p1: reviewId, p2: revision, p3: localHeadOid, p4: files })`（`:385`）。模板（`client-messages.ts:287`）列出精确身份与「Local HEAD to integrate」`{p3}`、冲突文件 `{p4}`，要求只在 managed Worktree 内 merge、不修改 Local、不切换 checkout、解冲突后重跑聚焦测试并再次 `ReadyForReview`。

调用点在 `attempt()` 的 `binding.session.prompt([{ type:'text', text: buildWorktreeRecoveryPrompt(request, t) }], 'queue', abort.signal)`（`recovery-continuation.ts:351`），且 `t` 来自 `translatorForServices(entry.services)`（`:281`）。

## Architecture

```text
WorktreeReviewRow.tsx ──parseReviewTool──> WorktreeReviewPanel.tsx (验收卡)
 (tool 证据)                  │                      │ review/identity/target
                              │ requestWorktreeReviewRefresh (status-events.ts:4)
                              ▼
ReviewActions.tsx (操作面板) ── enqueueWorktreeRecovery/restore/retry/cancel
   │  useReviewPreflight / usePreviewRecoveryPreflight
   │  deliver / discard / rollback / checkpoint …
   ▼
recovery-continuation.ts  ┌─────────── 状态机 ───────────┐
   entries Map            │ queued → sending → sent      │
   STORAGE_PREFIX v1      │   (failed ↔ retry)           │
   localStorage           │   (cancelled)                │
                          └────────────┬─────────────────┘
                                       │ attempt(): adapter.inspect + sessionReady
                                       │ buildWorktreeRecoveryPrompt() → binding.session.prompt
                          ┌────────────▼─────────────────┐
                          │ Host adapter.inspect / preflight │
                          │ WorktreeConsoleTargetDetails     │
                          └─────────────────────────────────┘
preflight-cache.ts / preview-recovery-cache.ts ── request-cache.ts (per-adapter WeakMap)
ReviewDetailsModal.tsx (弹窗)   DeliveryProof.tsx (证明)   PreflightStatus.tsx (状态)
ReviewIcon.tsx + review-console.styles.ts (图标/样式)
```

组件关系要点：
- `WorktreeReviewRow`（`src/client/WorktreeReviewRow.tsx:26`）是宿主编织点：从 tool block 解析出 `ParsedTool`，构造 `WorktreeReviewEvidence`（`:36-48`）与 `WorktreeReviewIdentity`（`:92-101`），把 `WorktreeReviewPanel` 挂载到 tool 视图里。
- `ReviewActions` 是被同一宿主（或 dock 上下文）挂载的操作面板，依赖 `adapter/services/identity/target`，并消费 `recovery-continuation` 的 React 订阅钩子 `useWorktreeRecoverySnapshot`。
- `recovery-continuation.ts` 是纯模块单例（非 React 组件），通过 `entries` Map 持有每个 session 的运行时条目与持久化键，UI 仅通过 `subscribeWorktreeRecovery` / `useWorktreeRecoverySnapshot` 订阅。

## Data Flow

### 1. 验收证据从 tool → 验收卡

1. `WorktreeReviewRow.tsx:29` 调 `parseReviewTool(block, t)` 得到 `model`；取 `payload`/`args`。
2. `:36-48` 构造 `WorktreeReviewEvidence`（带 `detailsMarkdown` 当 `args.details` 存在）。
3. `:50-52` 在解析到 review 时广播 `requestWorktreeReviewRefresh(sessionId)`。
4. `:69-88` 通过 `adapter.current({sessionId})` 拉取 Host 权威 `WorktreeConsoleTargetSummary`（liveTarget），并在收到 `WORKTREE_REVIEW_REFRESH_EVENT` 时通过 `refreshNonce` 重读。
5. `:92-101` 构造 `WorktreeReviewIdentity`（注意 `expectedRevision` 优先取 `liveTarget.review.reviewId === payload.reviewId ? liveTarget.revision : payload.revision`）。
6. 传给 `WorktreeReviewPanel`（`:105-110`），由 `reviewIsStale`（`:40`）判定是否显示「review is stale」。

### 2. preflight / preview-recovery 只读预检

- `ReviewActions.tsx:125-129` 用 `useReviewPreflight(adapter, identity, autoPreflightEnabled)`；`autoPreflightEnabled` 在 `ready_for_review && capabilities.preflight` 时为真（`:118-124`）。
- `preflight-cache.ts:7-15` 以 `sessionId\u0000checkoutId\u0000expectedRevision\u0000expectedReviewId` 为键，调 `adapter.preflight(identity)`；`useSnapshot`（`request-cache.ts:119`）在 `enabled` 时自动 `read`。
- `preview-recovery-cache.ts:7-16` 同样结构，键含 `expectedPreviewId`，调 `adapter.previewRecoveryPreflight`；`ReviewActions.tsx:139-143` 在 `recoveryIdentity` 存在时启用。
- `readReviewPreflight(...,true)` 在每次写前被强制调用（如 `submitCommit` `:632`、`startConflictRecovery` `:276`）以 CAS 重校验；`reviewSlot` 由 `waiting→available` 时（`ReviewActions.tsx:200-212`）`invalidateReviewPreflight` + `readReviewPreflight`。

### 3. durable 恢复队列生命周期（enqueue → 持久化 → restore → retry/cancel）

- 触发：用户在 conflict（`recoverPreflight`→`startConflictRecovery`，`:265`）或 stale_isolated（`startReviewRegeneration`，`:360`）点击恢复；或运行时冲突 `recoverRuntimeConflict`（`:434`）。三者最终 `enqueueRecovery`（`WorktreeRecoveryRequest`）→ `enqueueWorktreeRecovery`（`recovery-continuation.ts:389`）。
- 入队：`enqueueWorktreeRecovery` 建 `RecoveryEntry`，非活跃直接 `cancelled`，`validRequest` 失败发 `failed`，否则 `attempt`（`recovery-continuation.ts:280`）。
- `attempt` 流程：`isCurrent`/`activeSessionState` 检查 → `adapter.inspect` 拿 `WorktreeConsoleTargetDetails` → `targetMatchesRequest`（`:195`，逐项比对 `checkoutId/ownerSessionId/targetSessionId/revision/managedRoot/recoveryContinuation`，含 `conflictingFiles` 顺序相等）→ 若 Session 未就绪则 `waitForSession`（`:264`，250ms 轮询）→ 否则发 `sending`，重 inspect→`binding.session.prompt([buildWorktreeRecoveryPrompt(request,t)], 'queue', abort.signal)`（`:351`）→ `sent`；任何不匹配/失败/异常 → `cancel`/`failed`（`:357-370`）。
- 持久化：进入 `queued/sending/failed` 任一状态时 `persistSnapshot`（`:73`）写入 `localStorage["dsh-git-worktree:recovery:v1:"+sessionId]`（键 `:51`、`:69`）；`sent`/`cancelled` 则 `removeItem`（`:77-79`）。`readPersisted`（`:93`）读回时做精确键、版本、状态、`sessionId` 一致性、`validRequest` 全套校验，失败即删键。
- 恢复：`ReviewActions.tsx:155-158` 的 effect 调 `restoreWorktreeRecovery({sessionId,adapter,services,isActive})`（`:429`）；缓存未命中时从 localStorage 读 `PersistedRecovery`，`sending` 态降级为 `failed` 并提示「上次页面关闭时恢复请求正在发送」（`client-messages.ts:299`），`queued` 则重试 `attempt`。
- 重发/取消：UI 在 `activeRecovery.status==='failed'` 时显示「resend」按钮，调 `retryWorktreeRecovery`（`ReviewActions.tsx:1183`，`recovery-continuation.ts:491`）；`cancelWorktreeRecovery`（`:523`）/`clearWorktreeRecovery`（`:540`，清 localStorage）供会话结束或确认取消时调用。
- 订阅：React 通过 `useWorktreeRecoverySnapshot(sessionId)`（`recovery-continuation.ts:513`，基于 `useSyncExternalStore`）渲染状态机提示（`ReviewActions.tsx:1170-1187`）。

### 4. 交付证明与终态

- 写操作成功 `applyTarget`（`:253`）后，target 进入 `cleanup_pending/retained/delivered`；`ReviewActions.tsx:253` 当 `target.state==='cleanup_pending' || terminal` 时渲染 `DeliveryProof`（附 `compact={proofVariant==='compact'}`）。
- `DeliveryProof.tsx:16` 读 `target.deliveryProof`（`WorktreeConsoleDeliveryProof`，`console-contract.ts:133`），输出 commit / local HEAD before→after / files / validation / commitInLocalHistory。

## Connections

- [[client_core]]：本模块是 `client_core` 的 review-console 子能力；宿主组件 `WorktreeReviewRow.tsx`（`src/client/WorktreeReviewRow.tsx:26`）与 `actions.ts`（`src/client/actions.ts` 的 `selectedSessionId`、`openAuthorizedWorktreeTarget`、`openIsolatedTarget`、`prefillSessionDraft`）均属 client_core；模块通过 `index.ts` 导出并回挂到 client_core。
- [[console_contract]]：`WorktreeConsoleTargetSummary`（`:149`）、`WorktreeConsoleReviewSummary`（`:135`）、`WorktreeConsoleTargetDetails`（`:182`，含 `recoveryContinuation`/`managedRoot`）、`WorktreeConsoleAdapter`（`:745`，`inspect/preflight/previewRecoveryPreflight/resumeRevision/prepareReviewRegeneration/...`）、`WorktreeConsoleError` / `worktreeConsoleErrorMeta`（`:688`、`:740`）是本模块的只读契约来源。
- [[types]]：`WorktreeApplyPreflightView`（`:159`）、`WorktreePreviewRecoveryPreflightView`（`:301`）、`WorktreePreviewRecoveryProof`（`:273`）、`WorktreeDeliveryProofView`（`:79`）、`WorktreeValidationStatus`/`WorktreeValidationItem`（`:29`、`:48`）等渲染所依赖的视图类型。
- [[client_model]]：`parseReviewTool`（被 `WorktreeReviewRow.tsx:5` 导入）产出 `ParsedTool`/`ToolCallViewPropsLike`，是「ParsedTool 模型」进入验收卡的入口。
- [[i18n]]：`src/i18n/client-messages.ts` 与本模块的 `defaultClientTranslator`/`useClientTranslator`、`translatorForServices`（`src/client/i18n.tsx`）配合，提供 prompt 模板（`the.current.managed.worktree.review.snapshot.is.stale`、`:279`；`the.user.approved.worktree.sync.encountered.real.conflicts`、`:287`）与全部 UI 文案。
- [[actions]]（client）：`useWorktreeRecoverySnapshot` 依赖 `WorktreeClientServices`（binding/prompt/sessions），`recovery-continuation.ts:1-4` 与 `ReviewActions.tsx:19` 直接消费；`startConflictRecovery`/`analyzeRecovery`/`handoffRecovery` 调 `openAuthorizedWorktreeTarget`/`openIsolatedTarget`/`prefillSessionDraft`。

## Known Issues

- 恢复队列的 `restoreWorktreeRecovery` 在「运行中 runtime 重建」时把 `sending` 置为 `failed`（`recovery-continuation.ts:452-460`），需要用户显式「resend」；这是有意为之（避免重复投递），但意味着任何带 streaming 的页面刷新都会丢失 in-flight 发送。
- `targetMatchesRequest` 对 `worktree_review_regeneration` 要求 `target.state === 'ready_for_review' && target.review?.reviewId === request.reviewId && target.capabilities.preflight`（`recovery-continuation.ts:195-202`）；若 Host 在排队期间把 review 重新生成（reviewId 变），请求会被 `cancel` 而非「自动升级」，UI 仅显示「session/checkout changed」（`ReviewActions.tsx:1179`）。
- `request-cache.ts` 的缓存按 **per-adapter WeakMap** 存放（`:51`）；adapter 被 GC 后其缓存随之消失，因此跨 adapter 重连不会读到旧的预检结果（符合「remounted client 不能读到其它 adapter 数据」设计，但也意味着重连必重新预检）。
- `ReviewActions.tsx` 体量极大（1200 行），`Mutation` 状态机与多个 Host 写操作回调（preview/checkpoint/resume/recovery/rollback/finalize/discard/retryCleanup）耦合在同一组件内，尚无拆分；若后续需独立成文，可考虑把「detached preview recovery 分析/handoff」（`analyzeRecovery` `:741`、`handoffRecovery` `:797`）抽为子模块。
- `review-console.styles.ts` 为单文件 String.raw CSS（`:1`，205 行），未启用 CSS Modules 或构建期作用域，全部类名以 `dsh-wt-` 前缀人工隔离（`:2-12` 的 `--wt-*` 变量与 `:13` 起的布局规则）。
- 无自动化测试文件伴随此模块（已读目录 `src/client/review-console/` 仅有 `.tsx/.ts` 源码，无 `__tests__`/`*.test.*`），因此 `source_files` 未列出任何测试文件。
