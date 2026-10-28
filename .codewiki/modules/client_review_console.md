---
title: client_review_console
type: module
source_files:
  - src/client/review-console/index.ts
  - src/client/review-console/WorktreeReviewPanel.tsx
  - src/client/review-console/request-cache.ts
  - src/client/review-console/preflight-cache.ts
  - src/client/review-console/preview-recovery-cache.ts
  - src/client/review-console/recovery-continuation.ts
  - src/client/review-console/ReviewActions.tsx
  - src/client/review-console/ReviewDetailsModal.tsx
  - src/client/review-console/DeliveryProof.tsx
  - src/client/review-console/PreflightStatus.tsx
  - src/client/review-console/ReviewIcon.tsx
  - src/client/review-console/status-events.ts
  - src/client/review-console/review-console.styles.ts
  - src/client/WorktreeReviewRow.tsx
  - tests/client-review-console.test.tsx
  - src/console-contract.ts
  - src/types.ts
tags: [client, review-console, ui, cache, preflight, recovery]
---

## Overview

`client_review_console` 是评审控制台的 React 客户端模块，位于 `src/client/review-console/`。它负责把一次「工作树验收快照（Worktree Review）」以紧凑卡片形式展示，并围绕该验收结果提供所有交付/恢复动作，以及支撑这些动作的只读预检缓存与中断恢复队列。

模块边界（以目录为单位）：

- **展示层**：`WorktreeReviewPanel.tsx` 只读验收卡；`ReviewDetailsModal.tsx` 全量详情弹窗；`DeliveryProof.tsx` 交付证明；`PreflightStatus.tsx` 只读同步预检状态；`ReviewIcon.tsx` 图标映射；`review-console.styles.ts` 内联 CSS。
- **动作层**：`ReviewActions.tsx` 是交付/恢复/恢复续跑的唯一入口，承载 `preview / checkpoint / resume_revision / recovery / finalize / discard / rollback` 等所有 mutation 前的强制重检与写入。
- **缓存层**：`request-cache.ts` 是通用 identity-keyed 单飞只读缓存工厂；`preflight-cache.ts` 与 `preview-recovery-cache.ts` 分别实例化出「同步预检」和「Detached Preview 恢复预检」两个共享缓存。
- **恢复层**：`recovery-continuation.ts` 是一个跨渲染、可持久化到 `localStorage` 的「恢复请求队列」（durable context queue），负责把冲突解决/只读验收重生成请求安全地通过 Session.prompt 续跑。
- **事件层**：`status-events.ts` 仅定义并向 `window` 广播一个 `review-refresh` 事件，用来通知所有已挂载的评审表面重读 Host 权威 target。
- **桥接导出**：`index.ts` 重导出面板与两类投影类型，并提供 `reviewEvidenceFromTarget` / `reviewIdentityFromTarget` 两个把 `WorktreeConsoleTargetSummary` 投影成面板所需证据的纯函数。

该模块不直接触碰 Cordis / Remote / 文件系统。所有写操作都通过 `WorktreeConsoleAdapter`（`src/console-contract.ts` 的 `WorktreeConsoleAdapter` 接口，第 745–784 行）下发到 Host，Host 在执行时重新校验 session / owner / cwd / revision / review 身份。客户端的核心职责是「身份绑定 + 写入前强制重检 + fail-closed 过期校验」。

## Key Components

### index.ts — 桥接导出

- `reviewEvidenceFromTarget(target, detailsMarkdown?)` (12–21)：把 `WorktreeConsoleTargetSummary.review` 投影成 `WorktreeReviewEvidence`（`WorktreeConsoleReviewSummary` + 可选 `detailsMarkdown`）。`target.review` 为空时返回 `null`。
- `reviewIdentityFromTarget(sessionId, target)` (24–35)：构造 `WorktreeReviewIdentity`（CAS 身份），需要 `target.checkoutId` 与 `target.review` 都存在；缺项返回 `null`。`expectedRevision` 取 `target.revision`，`expectedReviewId` 取 `target.review.reviewId`。
- 重导出 `WorktreeReviewPanel` 与类型 `WorktreeReviewEvidence` / `WorktreeReviewIdentity` / `WorktreeReviewPanelProps`（4–9）。

### WorktreeReviewPanel.tsx — 只读验收卡

interface `WorktreeReviewEvidence extends WorktreeConsoleReviewSummary` (9–11)：比契约多一个可选 `detailsMarkdown?: string`。
interface `WorktreeReviewIdentity` (13–18) 字段：`sessionId`、`checkoutId`、`expectedRevision: number`、`expectedReviewId: string`。
interface `WorktreeReviewPanelProps` (20–25) 字段：`review`、`identity?`、`target?`、`unavailableMessage?`。

- `validationLabel(status, t)` (27–32)：把 `validationStatus` 译为「自动验证通过 / 自动化验证失败但可继续 / 部分通过 / 未运行」。
- `testStatusLabel(status, t)` (34–38)：把测试 `status` 译为 `passed / failed / not.run`。
- `reviewIsStale(target, identity, review)` (40–52)（`export`）：过期判定核心。规则——`target` 为 `undefined` 不 stale；`target.state === 'working'` 视为 stale；其余仅当 target 处于验收/预览/恢复/保留等非 working 状态且「无 review / revision 不匹配 / reviewId 不匹配」时才 stale。注意 `expectedRevision` 回退到 `review.revision`（48）。
- `WorktreeReviewPanel` (54–118)（`export`）：紧凑卡片。标题、摘要、验证状态、文件数、可选阶段数；可折叠的「验证与版本详情」（点击切换 `detailsExpanded`，`reviewId`/`revision` 变化时自动收起，58）；用 `reviewIsStale` 计算 `invalidReason`。只展示文件数量，不渲染 Diff / Inspect / Retention，也不含任何写按钮——动作只存在于 dock（见 `ReviewActions`）。

### request-cache.ts — 通用只读缓存工厂（ponytail）

- `RequestSnapshot<TPreflight>` (9–14)：联合类型 `{idle} | {loading} | {success; preflight} | {error; error}`。
- `Entry<TPreflight>` (15–20)：单条缓存项，含 `snapshot`、`listeners: Set`、`promise?`、`generation: number`。
- `RequestCache<TIdentity, TPreflight>` (22–30)：接口 `read` / `invalidate` / `useSnapshot`。
- `createRequestCache(options)` (41–151)（`export`）：
  - 内部 `caches: WeakMap<WorktreeConsoleAdapter, Map<string, Entry>>`（51）——每个 adapter 独立命名空间，防止 remount 串读；identity 字符串是唯一共享键。
  - `read(adapter, identity, force=false)` (78–109)：**单飞**（in-flight promise 直接 join，84）；非 force 时复用上次 `success`/`error`（85）；发布 `loading`（86）；用 `generation` 快照防止过期响应 republish（93、105）；transport 异常归一为 `code: 'transport_unavailable'`（99）。
  - `invalidate(adapter, identity)` (111–117)：`generation += 1` 并清空 `promise`，发布 `idle`——这是「写入后让旧响应失效」的关键。
  - `useSnapshot(adapter, identity, enabled)` (119–148)：基于 `useSyncExternalStore` 订阅；`adapter && identity && enabled` 时自动 `read`（137–139）；`refresh` 走 `read(..., true)`（143–146）。

### preflight-cache.ts — 同步只读预检缓存

- `PreflightSnapshot = RequestSnapshot<WorktreeApplyPreflightView>` (5)。
- 单例 `cache = createRequestCache<WorktreeConsolePreflightRequest, WorktreeApplyPreflightView>` (7–15)，key 由 `sessionId/checkoutId/expectedRevision/expectedReviewId` 以 `\u0000` 拼接（8–13），`request` 委托 `adapter.preflight(identity)`（14）。
- 导出 `readReviewPreflight = cache.read` (18)、`invalidateReviewPreflight = cache.invalidate` (21)、`useReviewPreflight = cache.useSnapshot` (23)。

### preview-recovery-cache.ts — Detached Preview 恢复预检缓存

- `PreviewRecoverySnapshot = RequestSnapshot<WorktreePreviewRecoveryPreflightView>` (5)。
- 单例 `cache = createRequestCache<WorktreeConsolePreviewRecoveryPreflightRequest, WorktreePreviewRecoveryPreflightView>` (7–16)，key 额外含 `expectedPreviewId`（8–14），`request` 委托 `adapter.previewRecoveryPreflight(identity)`（15）。
- 导出 `readPreviewRecoveryPreflight` (19)、`invalidatePreviewRecoveryPreflight` (21)、`usePreviewRecoveryPreflight` (23)。

### recovery-continuation.ts — 中断恢复队列（durable context queue）

interface `WorktreeApplyConflictRecoveryRequest` (6–17)：`kind:'worktree_apply_conflict'` + `sessionId/requestId/checkoutId/reviewId/revision/localHeadOid/conflictingFiles`。
interface `WorktreeReviewRegenerationRequest` (19–27)：`kind:'worktree_review_regeneration'`，只读验收重生成（revision 视为不可变）。
type `WorktreeRecoveryRequest` (29)；type `WorktreeRecoveryStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'cancelled'` (30)。
interface `WorktreeRecoverySnapshot` (32–36)：`status` / `request` / `error?`。

模块级状态：`entries: Map<sessionId, RecoveryEntry>` (49)、`listenerSets` (50)、`STORAGE_PREFIX = 'dsh-git-worktree:recovery:v1:'` (51)。
持久化：`PersistedRecovery`（54–59，仅持久化 `queued|sending|failed`）、`browserStorage()`（61–67，避开 SSR）、`storageKey`（69–71）、`persistSnapshot`（73–91，sent/cancelled 即删除）、`readPersisted`（93–118，带 `hasExactKeys`/`validRequest` 严格校验，非法数据静默丢弃）。
校验：`safeConflictFile`（129–133，拦截绝对路径/控制字符/`..`）、`hasExactKeys`（135–138）、`validRequest`（140–167，按 kind 做精确字段白名单）。

内部：`publish`（169–173，写快照 + 写 localStorage + 通知）、`stopWatching`（175–177）、`cancel`（179–184，abort + publish `cancelled`）、`samePath`（186–193，跨平台路径归一比较）、`targetMatchesRequest`（195–225，把 target 与 request 逐项比对以判定是否仍对得上）、`activeSessionState`（227–236，`'active'|'pending'|'mismatch'`）、`sessionReady`（238–252）、`isCurrent`（254–258）、`waitForSession`（264–278，250ms 轮询等 Session 就绪）、`attempt`（280–376，完整续跑状态机：inspect→匹配→等 prompt→再次 inspect→发 `prompt(['{type:"text"}'],'queue',abort.signal)`）。

- `buildWorktreeRecoveryPrompt(request, t)` (378–386)（`export`）：生成给 Agent 的只读提示词（冲突解决 / 验收重生成）。
- `enqueueWorktreeRecovery(input)` (389–427)（`export`）：入队；同 sessionId 同 requestId 复用既有 entry，否则先 `cancel` 旧的；`validRequest` 失败直接 `failed`；否则 `attempt`。
- `restoreWorktreeRecovery(input)` (429–489)（`export`）：运行时重建时恢复（含从 `localStorage` 读取 `readPersisted`，sending 态降级为 failed，queued 态续跑）。
- `retryWorktreeRecovery(sessionId)` (491–501)（`export`）：仅 `failed`/`cancelled` 可重发，会重新走 `attempt` 重校验。
- `getWorktreeRecoverySnapshot(sessionId)` (503–505)、`subscribeWorktreeRecovery(sessionId, listener)` (507–511)、`useWorktreeRecoverySnapshot(sessionId)` (513–520，`useSyncExternalStore`)。
- `cancelWorktreeRecovery(sessionId, requestId?)` (522–528)：仅在非 `sent`/`failed` 时取消。
- `detachWorktreeRecoveryRuntime(sessionId)` (530–538)：模拟渲染层卸载但保留 localStorage（abort + 删内存 entry + 通知）。
- `clearWorktreeRecovery(sessionId)` (540–549)（`export`）：彻底清除（内存 + localStorage），测试 `afterEach` 调它（见 `tests/client-review-console.test.tsx` 18–21）。

### ReviewActions.tsx — 交付/恢复动作层（核心，1199 行）

interface `ReviewActionsProps` (35–50)：`review`、`adapter?`、`services?`、`identity?`、`target?`、`disabled`、`unavailableMessage`、`renderStatus?`、`proofVariant?`、`focusReview?`、`isActive?`、`onStale`、`onTargetChange`。
type `Mutation` (52)：`'preview' | 'checkpoint' | 'resume_revision' | 'recovery' | 'recovery_analysis' | 'recovery_handoff' | 'open_holder' | 'rollback' | 'finish' | 'finalize_preview' | 'discard' | 'retry_cleanup'`。
type `CommitMode = 'finish' | 'finalize_preview'` (53)。

辅助：`checkpointRequestIdForGeneration` (55–57)、`isStale` (59–61)、`sameStrings` (63–65)、`preflightMessage` (67–74，`WorktreeApplyPreflightView.status` 各分支文案)、`DEFAULT_RETAIN_ENVIRONMENT = true` (80，默认保留冻结环境使误交付可恢复)。

`ReviewActions` (82–1199) 内部 hook 与状态：`autoPreflightEnabled`（118–124，仅 `ready_for_review` + `capabilities.preflight` 才自动预检）、`useReviewPreflight`/`usePreviewRecoveryPreflight`（125–143）、`recoveryProof`（144–147）、`activeRecovery`（148–153）、`restoreWorktreeRecovery` 挂载恢复（155–158）、`reviewSlot` 从 waiting→available 时作废并强制重检（200–212）。
写入动作（全部以 `begin`/`finish` 锁 + `isActive()` 守卫）：
- `previewLocal` (453–485)：写入前 `readReviewPreflight(identity, true)`，conflict/blocked 不写。
- `openCheckpoint` / `checkpoint` (487–534)：用 generation-bound `requestId`（55–57），写前校验 `checkpoint` 响应。
- `resumeRevision` (536–559)：恢复编辑并 `prefillSessionDraft`。
- `rollbackPreview` (561–623)：`preview_detached` 时先 `readPreviewRecoveryPreflight`，proceed 仅当 proof.rollback 为 `safe`。
- `submitCommit` (625–697)：`finish` mode 写前重检；`finalize_preview` mode 需 recoveryProof；写 `adapter.finalize` / `adapter.finalizePreview`。
- `discard` (699–722)：`preview_active` 时带 `rollbackPreview: true`。
- `startConflictRecovery` (265–358) / `startReviewRegeneration` (360–422) / `recoverPreflight` (424–432) / `recoverRuntimeConflict` (434–451)：把预检冲突 / stale_isolated / 运行时冲突转成 `enqueueRecovery(...)` 请求。
- `freshRecoveryProof` / `analyzeRecovery` / `handoffRecovery` (724–856)：detached preview 的只读分析与交接（先 `openAuthorizedWorktreeTarget`/`openIsolatedTarget`，再 `inspect` 二次校验，最后 `prompt`）。
- `retryCleanup` (858–876)、`openHolder` (878–895)。
UI（950–1199）：主操作按 target 状态分派（`ready`→preview、`preview_active`→confirm/save、`preview_detached`→rollback/check.again、`cleanup_pending`→retry）；`more` 菜单承载 checkpoint/resume/finish/discard；三个 `Modal`（checkpoint/commit/discard）；`PreflightStatus` 与 detached 恢复面板；`DeliveryProof`；`dsh-wt-action-status` aria-live；错误用 `worktreeConsoleErrorMeta(error.code)` 渲染 category/recovery（1192–1195）。

### ReviewDetailsModal.tsx — 详情弹窗

- `validationText(status, t)` (8–10)、`validationIcon(status)` (11–13)（`export`）。
- `ReviewDetailsList` (17–34)：可折叠列表，`COLLAPSED_LIST_LIMIT = 5`（15）。
- `ReviewDetailsModal({open,onClose,target,preflight})` (36–88)：焦点陷阱（41–64）；按 `recovery/conflict/blocked/preview/saved/ready` 选 badge 与 notice；变更文件、冲突文件、验证测试、版本详情（reviewId/revision/commitOid）分段展示。注意最后一个 `</>` 与 `return` 之间缺少闭合 `div`（87 行 `</Modal>` 前的 `</div>` 与 86 行 `</div>` 配对，结构见 74–86）。

### DeliveryProof.tsx — 交付证明

- `shortOid` (4–6)、`validationLabel(status, t)` (8–14)。
- `DeliveryProof({target, compact})` (16–48)：`proof = target.deliveryProof` 为空返回 null；`compact` 渲染单行摘要（29–34），否则渲染 `commit`/`local`/`files`/`validation`/`local.history` 证据面板（36–46）。`lifecycle` 文案按 `delivered/retained/cleanup_pending` 区分（22–28）。

### PreflightStatus.tsx — 预检状态展示

- `shortOid` (7–9)、`statusLabel(preflight, t)` (11–19)。
- `PreflightStatus({snapshot, target, compact, onRefresh, onRecovery, onOpenHolder, busy})` (21–114)：idle 不渲染（40）；loading/error 各一态；conflict 态给「再次检查 / 让 Agent 解决冲突」（64–73）；blocked 态区分 `stale_isolated`（重新生成验收）与 `project_acceptance_busy`（打开占用任务 holder，95–99）。

### ReviewIcon.tsx — 图标

- `icons` 映射 (8–15)：`lucide-react` 图标名集合。
- `ReviewIconName = keyof typeof icons` (16)。
- `ReviewIcon({name, className})` (18–21)：渲染 18px / stroke 1.75 的图标，`aria-hidden`。

### status-events.ts — 刷新事件

- `WORKTREE_REVIEW_REFRESH_EVENT = 'dsh-git-worktree:review-refresh'` (1)。
- `requestWorktreeReviewRefresh(sessionId)` (4–6)：向 `window` 派发 `CustomEvent`，detail 带 `sessionId`。`WorktreeReviewRow` 监听它（见下）并在匹配时 bump `refreshNonce` 触发重读。

### review-console.styles.ts — 内联样式

- `REVIEW_CONSOLE_STYLES` (1–204)：CSS 字符串。定义 `.dsh-wt-review-panel`/`.dsh-wt-details-modal`/`.dsh-wt-review-dock` 三套布局；卡片向下展开、dock 向上展开（133–134）；dock 下隐藏 `loading/ready/local_advanced/already_in_local` 预检（109–114）；窄屏 `@media (max-width:620px)` 自适应（118–127、170–174、195）。

### WorktreeReviewRow.tsx — 模块外桥接（调用方）

- `isLocalTargetUnselected(error, t)` (20–24)：识别 `target_unselected` 文案以 fail-closed 隐藏卡片（90）。
- `WorktreeReviewRow({block, sessionId, adapter})` (26–123)：从 `parseReviewTool` 解析出 `review` 证据（29–48），监听 `adapter.current` 拉取 live target（69–88），根据 `review`/`identity`/`liveTarget` 渲染 `WorktreeReviewPanel`（102–119）。`identity` 的 `expectedRevision` 在 `liveTarget.review.reviewId === payload.reviewId` 时取 `liveTarget.revision`，否则取 `payload.revision`（92–101）。

## Architecture

评审控制台形成「只读卡 / 动作层 / 缓存层 / 恢复层」四层结构。卡片只展示证据、不含写入；写入全部汇聚到 `ReviewActions`；写入前的只读预检与恢复 proof 由 `request-cache` 派生的两个共享单飞缓存承载；跨渲染、可持久化的恢复请求由 `recovery-continuation` 续跑。

```text
┌─────────────────────────┐   review/identity/target   ┌──────────────────────┐
│ WorktreeReviewRow.tsx   │ ──────────────────────────► │ WorktreeReviewPanel  │
│ (解析 payload→证据,      │                              │ (只读卡: stale 校验)  │
│  拉 liveTarget)         │                              └──────────────────────┘
└───────────┬─────────────┘                                      │
            │ review/identity/target/adapter/services             │
            ▼                                                     │
┌─────────────────────────────────────────────────────┐         │
│ ReviewActions.tsx (动作层: begin/finish 锁, isActive) │◄────────┘
│  preview/checkpoint/resume/rollback/finalize/discard  │
│  analyze/handoff/recovery                             │
└───┬───────────────┬──────────────────┬───────────────┘
    │ useSnapshot   │ useSnapshot       │ enqueueRecovery
    ▼               ▼                  ▼
┌──────────────┐ ┌────────────────────┐ ┌──────────────────────────────┐
│ preflight-   │ │ preview-recovery-  │ │ recovery-continuation.ts      │
│ cache.ts     │ │ cache.ts           │ │ durable queue + localStorage  │
│ (adapter.    │ │ (adapter.preview   │ │ → Session.prompt 续跑          │
│  preflight)  │ │  RecoveryPreflight)│ │                                │
└──────┬───────┘ └─────────┬──────────┘ └──────────────┬───────────────┘
       │                   │                           │
       └─────────┬─────────┴───────────────────────────┘
                 ▼
       ┌──────────────────────────────┐   adapter.* (Host 权威)
       │ request-cache.ts (ponytail)  │ ──────────────────────────► Host
       │ WeakMap<adapter,Map<key,Entry>>│   重校验 session/owner/cwd/
       │ 单飞 + generation 失效         │   revision/review 身份
       └──────────────────────────────┘
                 ▲
                 │ WorktreeConsoleAdapter
   ReviewDetailsModal / DeliveryProof / PreflightStatus (展示)
   status-events: requestWorktreeReviewRefresh → window → 重读 target
```

关键点：
- `request-cache.ts` 是唯一的缓存实现，两个业务缓存都只是 `createRequestCache(...)` 的实例（见 `preflight-cache.ts` 7–15、`preview-recovery-cache.ts` 7–16）。
- `WeakMap` 以 adapter 为命名空间（request-cache.ts 51），保证 remount 不串读；identity 字符串是唯一共享键。
- 写入一律「先 `read(..., true)` 强制重检、再 `adapter.*`、再 `requestWorktreeReviewRefresh` 广播刷新」（ReviewActions.tsx 200–212、257）。

## Data Flow

以「Ready → Preview → 交付」与「Detached Preview 恢复」两条主线说明：

1. **验收卡渲染**：`WorktreeReviewRow` 用 `parseReviewTool` 解析 tool 结果 → 构造 `WorktreeReviewEvidence`（`WorktreeReviewRow.tsx` 29–48）→ 调 `adapter.current` 拉 `liveTarget`（69–88）→ 渲染 `WorktreeReviewPanel`，并把 `review/identity/target` 传给它。
2. **自动预检（Ready）**：`ReviewActions` 在 `autoPreflightEnabled` 时 `useReviewPreflight` 自动 `read`，命中单飞缓存（`ReviewActions.tsx` 118–129，缓存见 `preflight-cache.ts` 7–15）。同一 identity 的多块卡片共享一次 `preflight` 调用（测试 `client-review-console.test.tsx` 220–230 验证）。
3. **写入前强制重检**：点击「预览修改」→ `previewLocal`（453–485）先 `readReviewPreflight(identity, true)` 强制重检；`conflict/blocked` 时**不**写（469），否则 `adapter.preview(identity)` → `applyTarget(outcome.value.target)`（482）→ `requestWorktreeReviewRefresh(sessionId)` 广播刷新（257）。
4. **过期失效**：`target.reviewSlot` 由 `waiting`→`available` 时（200–212）`invalidateReviewPreflight` + `readReviewPreflight`，丢弃旧 busy 预检并自动重检（测试 `client-review-console.test.tsx` 603–629）。
5. **冲突恢复**：预检返回 `conflict` → `PreflightStatus`/`ReviewActions` 调 `onRecovery` → `startConflictRecovery`（265–358）先 `readReviewPreflight(true)` 比对冲突身份，再 `adapter.resumeRevision({conflictContinuation})`；成功拿到 `recoveryContinuation` 后 `enqueueRecovery({kind:'worktree_apply_conflict', ...})`（`recovery-continuation.ts` 389 起）。`attempt` 状态机（280–376）随后 `inspect`→等 Session 就绪→再次 `inspect`→`session.prompt` 让 Agent 解冲突。
6. **Detached Preview 恢复**：`target.state === 'preview_detached'` → `usePreviewRecoveryPreflight`（139–143）强制重检 → `recoveryProof`（144–147）。rollback/finalize 仅当 `proof.rollback/finalize.status === 'safe'` 才允许（903–906，写前在 `rollbackPreview`/`submitCommit` 内再次 `readPreviewRecoveryPreflight(true)`，561–623 / 648–677）。只读分析与交接走 `analyzeRecovery`/`handoffRecovery`（741–856）。
7. **持久化恢复**：恢复请求状态机每步 `persistSnapshot` 写 `localStorage`（73–91，前缀 `dsh-git-worktree:recovery:v1:`）；运行时重建时 `restoreWorktreeRecovery`（429–489）从 `localStorage` `readPersisted`（93–118）恢复，但 Host/Session 身份在每次 `attempt` 中被重新校验——浏览器状态不可信。
8. **交付证明**：终态 `delivered/retained/cleanup_pending` 渲染 `DeliveryProof`（1188，`DeliveryProof.tsx` 16–48），从 `target.deliveryProof` 取证据。

## Connections

- [[client]]：`WorktreeReviewRow.tsx`（`src/client/WorktreeReviewRow.tsx`）是 `client_review_console` 的调用方，负责从 tool 结果投影证据并拉 live target；`ReviewActions` 通过 `../actions.js` 的 `openAuthorizedWorktreeTarget` / `openIsolatedTarget` / `prefillSessionDraft` 打开会话、预填草稿（ReviewActions.tsx 15–20）。`src/client/target-console/WorktreeReviewStatus.tsx` 与评审卡共享同一 identity 的预检（测试 `client-review-console.test.tsx` 113–115）。
- [[console-contract]]：`src/console-contract.ts` 定义本模块依赖的全部 DTO 与 `WorktreeConsoleAdapter` 接口（745–784）：`WorktreeConsolePreflightRequest`（300–305）、`WorktreeConsolePreviewRecoveryPreflightRequest`（337–343）、`WorktreeConsoleReviewSummary`（135–146）、`WorktreeConsoleTargetSummary`（149–179）、`WorktreeRecoveryProof` 联合类型（681–685）、`WorktreeConsoleErrorMeta`（699–742）。
- [[types]]：`src/types.ts` 提供 `WorktreeApplyPreflightView`（159–172，含 `ready/local_advanced/already_in_local/conflict/blocked` 五态）、`WorktreePreviewRecoveryPreflightView`（301–312）、`WorktreePreviewRecoveryProof`（273–291）、`WorktreeDeliveryProofView`（79–90）、`WorktreeValidationItem`（48–52）。
- [[client-preflight-cache]] / 缓存测试：`tests/client-preflight-cache.test.ts` 与 `tests/client-preview-recovery-cache.test.ts` 与 `tests/client-review-console.test.tsx` 共同覆盖单飞、失效、持久化恢复行为。
- i18n：`src/client/i18n.tsx` 提供 `useClientTranslator` / `defaultClientTranslator` / `translatorForServices`，本模块所有文案均走翻译 key（如 `automated.validation.passed`、`review.is.stale.please.refresh`、`detached.is.a.delivery.recovery.state.not.git` 等）。

## Known Issues

- **`ReviewDetailsModal` 的 `dsh-wt-details-body` 类被重复应用**：`ReviewDetailsModal.tsx` 72 行的 `<Modal contentClassName="dsh-wt-details-body">` 与 74 行内层 `<div ref={content} className="dsh-wt-details-body">` 给同一片内容套了两次同名 class（结构本身合法：`Modal` 包 `header` + `content` div，86 闭合、87 闭合 `Modal`）。改样式时需确认 `review-console.styles.ts` 136、185 行对 `.dsh-wt-details-body` 的两条规则不会因嵌套重复而翻倍作用。
- **`ReviewActions` 组件过长（1199 行）**：所有 mutation 与 UI 集中在一个文件与单一 `ReviewActions` 函数内，状态/锁较多（`mutationLock`、`observedTargetRevision`、`observedReviewSlot`），审阅成本高；但职责边界清晰（动作层），未再加子模块拆分。
- **localStorage 持久化的信任边界**：`recovery-continuation.ts` 虽对 `readPersisted` 做 `hasExactKeys`/`validRequest` 严格校验（93–167），但 `sending` 态在重建时被降级为 `failed`（469–471），用户恢复中刷新会丢失在途请求，只能重试。
- **dock 与 card 两套布局靠 CSS 区分**：预检/更多菜单在 card 向下展开、在 composer dock 向上展开（`review-console.styles.ts` 133–134、109–114），样式耦合于外部注入的 `WORKTREE_STYLES`，CSS 规则缺失会导致菜单被裁剪（测试 `client-review-console.test.tsx` 118–141 强制校验）。
- **`DEFAULT_RETAIN_ENVIRONMENT = true` 默认值**：`ReviewActions.tsx` 80 行与 `WorktreeRetentionMode` 默认 `retain_24h`（types.ts 39）一致——误交付默认保留冻结环境 24h 以可恢复，但若调用方未传 `retention` 仍需确认预期行为。
