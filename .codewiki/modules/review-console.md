---
title: Review Console 评审操作与恢复
type: module
source_files:
  - src/client/review-console/index.ts
  - src/client/review-console/WorktreeReviewPanel.tsx
  - src/client/review-console/ReviewActions.tsx
  - src/client/review-console/PreflightStatus.tsx
  - src/client/review-console/ReviewDetailsModal.tsx
  - src/client/review-console/DeliveryProof.tsx
  - src/client/review-console/ReviewIcon.tsx
  - src/client/review-console/preflight-cache.ts
  - src/client/review-console/preview-recovery-cache.ts
  - src/client/review-console/recovery-continuation.ts
  - src/client/review-console/status-events.ts
  - src/client/review-console/review-console.styles.ts
  - src/client/review-console/request-cache.ts
tags:
  - client
  - review
  - preflight
  - recovery
---

# Review Console 评审操作与恢复

评审证据展示与全部 Worktree 变更动作的执行中枢：预检门禁、预览/检查点/回滚/提交/丢弃，以及 apply 冲突后的只读恢复与持久化恢复队列。数据源与导航编排分别来自 [[client-boot|Client Boot]] 与 [[target-console|Target Console]]。

## 证据与身份模型（src/client/review-console/index.ts、WorktreeReviewPanel.tsx）

- `src/client/review-console/index.ts:12-21` `reviewEvidenceFromTarget` 把持久化评审投到紧凑卡形状；`:24-35` `reviewIdentityFromTarget` 构造 Finalize 与高级评审读所要求的 CAS 身份 `{sessionId, checkoutId, expectedRevision, expectedReviewId}`。
- `src/client/review-console/WorktreeReviewPanel.tsx:9-18` 类型声明：`WorktreeReviewEvidence`（扩展 `WorktreeConsoleReviewSummary`，增加 `detailsMarkdown?`）、`WorktreeReviewIdentity`（四字段 CAS）。
- `WorktreeReviewPanel.tsx:27-38` `validationLabel` / `testStatusLabel`：按 `passed/failed/partial/not-run` 映射 i18n 标签。
- `WorktreeReviewPanel.tsx:40-52` `reviewIsStale`：`target.state === 'working'` 或 revision/reviewId 与身份不符即 stale（提示 `t('review.is.stale.please.refresh')`）——评审读 = Finalize 身份（`src/console-contract.ts:394-399`）。
- `WorktreeReviewPanel.tsx:54-118` 紧凑评审卡：状态图标（按 `validationStatus` 着色）、迭代标题、summary、验证标签、文件计数、保存阶段计数、可折叠验证详情（identity 短码 + validation summary + 测试列表）。

## 请求缓存基础设施（src/client/review-console/request-cache.ts）

- `request-cache.ts:9-13` `RequestSnapshot<TPreflight>` 四态 `idle/loading/success/error`。
- `:15-20` `Entry<TPreflight>`：snapshot + listeners + promise（单飞）+ generation（守卫过期响应）。
- `:22-30` `RequestCache<TIdentity, TPreflight>` 接口：`read` / `invalidate` / `useSnapshot`。
- `:41-150` `createRequestCache` 工厂函数：`WeakMap<adapter, Map<key, Entry>>` 隔离适配器；`read` 单飞 — 在途 promise 直接复用，命中 success/error 直接返回，写路径必须 `force=true`；发布前 bump generation 使过期响应不 re-publish；`useSnapshot` 用 `useSyncExternalStore` 订阅 + `enabled` 门控 effect 读取，`refresh()` 强制重读。

## 预检缓存（src/client/review-console/preflight-cache.ts、preview-recovery-cache.ts）

- `preflight-cache.ts:5` `PreflightSnapshot = RequestSnapshot<WorktreeApplyPreflightView>`；`:7-15` `createRequestCache` 以 `[sessionId, checkoutId, expectedRevision, expectedReviewId].join('\u0000')` 为 key、`adapter.preflight(identity)` 为请求。
- `preview-recovery-cache.ts:5` `PreviewRecoverySnapshot = RequestSnapshot<WorktreePreviewRecoveryPreflightView>`；`:7-16` key 额外拼 `expectedPreviewId`、请求为 `adapter.previewRecoveryPreflight(identity)`。
- 两个模块各导出 `read*` / `invalidate*` / `use*` 三函数（`:18-23`），调用方通过 `useReviewPreflight` / `usePreviewRecoveryPreflight` 订阅 React 状态。

## 评审操作中枢（src/client/review-console/ReviewActions.tsx）

- `Mutation` 类型（`:51`）：`'preview' | 'checkpoint' | 'resume_revision' | 'recovery' | 'recovery_analysis' | 'recovery_handoff' | 'open_holder' | 'rollback' | 'finish' | 'finalize_preview' | 'discard' | 'retry_cleanup'`。
- `commitRequestIdForGeneration`（`:54-56`）：`` `checkpoint:${generation}` ``。
- `mutationLock`（`:107`）`useRef(false)` 串行化所有变更；`:207-219` `begin` / `finish` 加锁解锁。
- `finishError`（`:225-244`）错误分流：`apply_conflict` 且带 continuation → 记录运行时冲突并提示 `t("the.live.write.check.found.conflicts.local.is")`；`stale_target` → `onStale`；`stale_local/stale_isolated` → 刷新预检。
- `:183-191` 监听 `target.revision` 变化清除 message/error/runtimeConflict；`:193-205` 监听 `reviewSlot waiting→available` 变化，invalidate 后重读预检。
- `autoPreflightEnabled`（`:111-117`）：`ready_for_review` + 无 disabled + adapter/capabilities.preflight 开启时自动触发预检。
- `recoveryIdentity`（`:126-131`）：`preview_detached` 时扩展 `expectedPreviewId` 用于恢复预检。
- `recoveryProof`（`:137-140`）：恢复预检成功且 status=`assessed` 时提取 proof。
- `activeRecovery`（`:141-146`）：快照的 checkoutId/reviewId 匹配当前 identity 时激活。
- `:148-151` 组件挂载时 `restoreWorktreeRecovery` 恢复持久化条目。
- `:153-161` reviewId/suggestedCommitMessage 变化时重置表单状态。
- 变更动作全部"先强制预检/身份校验，再调用 adapter"：
  - `previewLocal`（`:446-478`）force 预检 → blocked/conflict 即停 → `adapter.preview`。
  - `checkpoint`（`:487-527`）校验保存序号 === expectedCount+1、target working 且无 review、最后检查点 id。
  - `resumeRevision`（`:529-552`）`adapter.resumeRevision` + `prefillSessionDraft('please.recheck...')`。
  - `rollbackPreview`（`:554-616`）：`preview_detached` 必须先取新鲜恢复预检 proof 且 `rollback.status === 'safe'`；捕获 transport error 并重发 refresh。
  - `submitCommit`（`:618-690`）`finish` 模式 force 预检门禁、`finalize_preview` 模式校验 `proof.finalize === 'safe'`；retention 按 `retainEnvironment` 决定缺省 cleanup；commitMessage 上限 500。
  - `discard`（`:692-715`）`confirmDirty: true`；`preview_active` 时带 `rollbackPreview: true`。
  - `freshRecoveryProof`（`:717-732`）统一获取恢复 proof 的 helper。
  - `analyzeRecovery`（`:734-788`）`preparePreviewRecoveryAnalysis` → 校验 continuation → `openAuthorizedWorktreeTarget` 回源会话 → 二次 inspect 核对 recoveryContinuation requestId/generation → `binding.session.prompt([...], 'queue')` 下发只读分析指令。
  - `handoffRecovery`（`:790-849`）`createPreviewRecoveryHandoff` → 校验 sourceCheckoutId 且 checkoutId 与当前不同 → `openIsolatedTarget` 切到新 owner 会话 → 二次 inspect → prompt 交接。
  - `retryCleanup`（`:851-869`）`adapter.retryCleanup`。
  - `openHolder`（`:871-888`）打开持有者会话。
- `live/allDisabled/ready/previewActive/previewRecovery/rollbackRecoverySafe/finalizeRecoverySafe/cleanupPending/terminal/canDiscard`（`:890-902`）状态标志。
- `primary` 主按钮（`:916-941`）：`ready_for_review` → Preview（需 safeReadyPreflight）；`preview_active` → Confirm & Save；`preview_recovery` → rollback（需 proof safe）或 check again；`cleanup_pending` → retry cleanup。
- `renderStatus?.(submitting)`（`:945`）由 TargetConsole 的 WorktreeReviewStatus 提供 dock 内行内状态条。
- `:948-954` 终态标题行由 `terminal && !renderStatus` 守卫（dock 场景由 TargetConsole 渲染紧凑 dock，避免重复标题）。
- 恢复面板按钮（`:1145-1150`）：ask.agent.for.read.only.analysis / hand.off.to.a.new.worktree；活动恢复状态条（`:1161-1178`）：queued/sending/sent/cancelled/failed（failed 可 Resend）。
- 错误条（`:1183-1186`）按 `error.category.*` / `error.recovery.*` 翻译键渲染。
- 交付后终态 dock（`retained/delivered`）：`DeliveryProof` 以 `compact` 变体渲染（`.dsh-wt-delivery-proof-compact`），整卡只经「查看详情」弹窗展示；`:948` 的终态标题行由 `terminal && !renderStatus` 守卫。dock 内 `.dsh-wt-review-actions` 为纵向 flex（flex:1 1 0 + min-width:0），`.dsh-wt-delivery-proof(-compact)` 限 min-width:0/max-width:100%——防止全卡 grid 的 max-content 撑爆横向 flex 行。关闭 dock 由 WorktreeReviewStatus 的 `dismissed {checkoutId, reviewId}` 身份失效实现（见 [[target-console]]）。

## 恢复请求持久队列（src/client/review-console/recovery-continuation.ts）

- 请求两种 kind：`worktree_apply_conflict`（revision 为 resumeRevision 后的权威 Working revision）与 `worktree_review_regeneration`（Ready revision 只读路径）（`:6-27`）；状态机 `queued/sending/sent/failed/cancelled`（`:30`）。
- `WorktreeRecoverySnapshot`（`:32-36`）：status + request + error?。
- 模块级 `entries Map<sessionId, entry>`（`:49`）+ listenerSets（`:50`）+ localStorage 前缀 `'dsh-git-worktree:recovery:v1:'`（`:51`）；`sent/cancelled` 即删除，其余持久化（`:73-91`），注释声明浏览器持久化只是尽力上下文，Host 身份校验始终权威。
- `readPersisted`（`:93-118`）严格重验：`hasExactKeys` 精确键集、version 1、状态白名单、`validRequest`（`:140-167`）校验长度上限、checkoutId 禁 '..' 与斜杠、localHeadOid 正则 `/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu`、`safeConflictFile` 单文件 ≤1000 且非绝对路径（`:129-133`）；非法即 removeItem。
- `targetMatchesRequest`（`:195-225`）：conflict 要求 state working、无 review、proof 逐字段匹配；regeneration 要求 state ready_for_review、有 review、capabilities.preflight。
- `activeSessionState`（`:227-236`）用 retainedBy 契约判定 pending/mismatch/active。
- `sessionReady`（`:238-252`）：binding prompt/getSnapshot/subscribe 就绪 + cwd 匹配 managedRoot + openState=open。
- `waitForSession`（`:264-278`）：订阅 sessions list + binding session subscribe + 250ms 兜底轮询。
- `attempt`（`:280-376`）：claimed 单飞；inspect 后 `targetMatchesRequest` 不匹配即 cancel；binding 未就绪 → waitForSession；发送前再 inspect 一次（第一次 inspect 可能在等会话就绪）；挂会话切换 watcher + 100ms isActive 间隔；`binding.session.prompt(buildWorktreeRecoveryPrompt(request, t), 'queue', abort.signal)` → sent。
- `buildWorktreeRecoveryPrompt`（`:378-386`）：冲突时附冲突文件 JSON 数组，regeneration 附 checkoutId/reviewId/revision。
- `enqueueWorktreeRecovery`（`:389-427`）：同 requestId 刷新引用；不同请求先 cancel 旧条目；invalidRequest 直接 failed。
- `restoreWorktreeRecovery`（`:429-489`）处理运行时重建：sending 被打断 → abort + failed（`t("the.session.runtime.was.rebuilt.during.sending.the")`）；queued → attempt；从 localStorage 恢复时 sending 状态视为 failed。
- `retryWorktreeRecovery`（`:491-501`）仅 failed/cancelled 且会话 active。
- `cancelWorktreeRecovery`（`:523-528`）/ `detachWorktreeRecoveryRuntime`（`:531-538`）/ `clearWorktreeRecovery`（`:540-549`）。
- `useWorktreeRecoverySnapshot`（`:513-520`）供状态条订阅。

## 辅组件与跨面板事件

- `src/client/review-console/PreflightStatus.tsx:11-19` `statusLabel` 五态文案；`:21-99` `PreflightStatus` 组件：idle/loading/error 快速返回，success 显示本地/worktree/base/changes 事实、conflict 列冲突文件、blocked 显示 holder 信息 + open-holder 按钮、底部 recovery 动作区。
- `src/client/review-console/ReviewDetailsModal.tsx:8-13` `validationText` / `validationIcon`；`:15-65` `ReviewDetailsModal`：状态徽章按 recovery/conflict/blocked/preview/saved/ready 切换（`:48`），conflict 时给冲突文件打标（`:57`），`:20-43` 自实现焦点陷阱（Tab 循环 + 关闭后焦点归还）。
- `src/client/review-console/DeliveryProof.tsx:4-6` `shortOid`；`:8-14` `validationLabel`；`:16-48` `DeliveryProof`：lifecycle 按 delivered/retained/cleanup_pending 分支，compact 单行变体（`:29-35`），完整版含 commit/local head before-after/files/validation/local history。
- `src/client/review-console/ReviewIcon.tsx:1-21` lucide-react 图标表：file/branch/check/warning/minus/close/list/more/preview/confirm/rollback/edit/save/discard/local/down/create/search/manager/retain/send/shield/help/folder/external/refresh/chevron/pin/pinOff 共 30 个图标。
- `src/client/review-console/review-console.styles.ts:1-193` CSS 变量定义（--wt-ink/--wt-muted/--wt-line/--wt-panel/--wt-green/--wt-amber/--wt-red）+ 评审面板/详情 Modal/预检/交付证据/ Dock/移动端适配样式。
- `src/client/review-console/status-events.ts:1-6` `WORKTREE_REVIEW_REFRESH_EVENT = 'dsh-git-worktree:review-refresh'` CustomEvent：任何面板变更成功后 `requestWorktreeReviewRefresh(sessionId)` 广播所有挂载的评审面重读 Host 权威状态。

## Data Flow

```
用户点击操作按钮
  → begin(mutation) 加锁
  → readReviewPreflight(force=true) 或 readPreviewRecoveryPreflight(force=true)
  → 预检 success 且非 blocked/conflict
    → adapter.<operation>(identity)
    → outcome.ok ? applyTarget(nextTarget) : finishError(error)
  → finish() 解锁
  → requestWorktreeReviewRefresh(sessionId) 广播刷新
```

## Connections

- **Client Boot** (`[[client-boot]]`)：评审数据源入口，`reviewEvidenceFromTarget` / `reviewIdentityFromTarget` 转换函数。
- **Target Console** (`[[target-console]]`)：Dock 内紧凑状态条与终态 dismiss 逻辑。
- **console-contract** (`src/console-contract.ts`)：`WorktreeConsoleAdapter` / `WorktreeConsoleTargetSummary` / `WorktreeConsoleError` 类型契约。
- **actions** (`src/client/actions.ts`)：`openAuthorizedWorktreeTarget` / `openIsolatedTarget` / `prefillSessionDraft` / `selectedSessionId`。

## Known Issues

- 无已知 issue。恢复队列依赖 localStorage 持久化，浏览器进程崩溃后恢复尽力而为，Host 身份校验仍是权威。
- `request-cache.ts` 使用 WeakMap 绑定 adapter，remount 后新 adapter 会清空旧缓存——这是预期行为而非 bug。
