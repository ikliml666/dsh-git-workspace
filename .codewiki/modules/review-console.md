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
tags:
  - client
  - review
  - preflight
  - recovery
---

# Review Console 评审操作与恢复

评审证据展示与全部 Worktree 变更动作的执行中枢：预检门禁、预览/检查点/回滚/提交/丢弃，以及 apply 冲突后的只读恢复与持久化恢复队列。数据源与导航编排分别来自 [[client-boot|Client Boot]] 与 [[target-console|Target Console]]。

## 证据与身份模型（src/client/review-console/index.ts、WorktreeReviewPanel.tsx）

- src/client/review-console/index.ts:12-21 `reviewEvidenceFromTarget` 把持久化评审投到紧凑卡形状；:24-35 `reviewIdentityFromTarget` 构造 Finalize 与高级评审读所要求的 CAS 身份 `{sessionId, checkoutId, expectedRevision, expectedReviewId}`。
- src/client/review-console/WorktreeReviewPanel.tsx:40-52 `reviewIsStale`：target.state === 'working' 或 revision/reviewId 与身份不符即 stale（提示 `t('review.is.stale.please.refresh')`）——评审读 = Finalize 身份（src/console-contract.ts:394-399）。
- WorktreeReviewPanel.tsx:54-118 紧凑评审卡：validation/tests 列表、检查点计数、可折叠验证详情。

## 预检缓存（src/client/review-console/preflight-cache.ts、preview-recovery-cache.ts）

- `PreflightSnapshot` 四态 idle/loading/success/error（src/client/review-console/preflight-cache.ts:9-13）；`caches = WeakMap<adapter, Map<identityKey, Entry>>`（:23），identityKey 由 sessionId/checkoutId/expectedRevision/expectedReviewId `join('\u0000')` 组成（:25-27）；preview-recovery-cache.ts 额外拼 expectedPreviewId（:25-33）且字段名用 epoch（:19）。
- `readReviewPreflight`（preflight-cache.ts:54-83）：共享只读请求，`entry.promise` 在途即复用（单飞）；缓存 success|error 直接返回；写路径必须 `force=true` 绕过缓存（:54 注释）。发布用 generation 守卫，失配的在途结果只落孤儿条目；`invalidateReviewPreflight`（:86-95）generation++ 后发 IDLE。
- `useReviewPreflight`（:97-126）`useSyncExternalStore` 订阅 + enabled 门控的 effect 读取，`refresh()` 强制重读。

## 评审操作中枢（src/client/review-console/ReviewActions.tsx）

- `mutationLock`（src/client/review-console/ReviewActions.tsx:204-216）串行化所有变更；checkpoint 请求 id 由 `` `checkpoint:${generation}` `` 派生（:52-54）。
- `finishError`（:222-241）错误分流：apply_conflict 且带 continuation → 记录运行时冲突并提示 `t('the.live.write.check.found.conflicts.local.is')`；stale_target → onStale；stale_local/stale_isolated → 刷新预检。
- :190-202 监听 reviewSlot waiting→available 变化，invalidate 后重读预检。
- 状态驱动的主按钮（:913-938）：ready_for_review → 预检安全才允许 Preview；preview_active → 确认+保存（finalize_preview）；previewRecovery → rollback（需 proof 安全）或再检查；cleanup_pending → retry cleanup。
- 变更动作全部"先强制预检/身份校验，再调用 adapter"：
  - `previewLocal`（:443-475）force 预检 → blocked/conflict 即停 → `adapter.preview`。
  - `checkpoint`（:484-524）校验保存序号 === expectedCount+1、target working 且无 review、最后检查点 id。
  - `resumeRevision`（:526-549）`adapter.resumeRevision` + `prefillSessionDraft('please.recheck...')`。
  - `rollbackPreview`（:551-613）：preview_detached 必须先取新鲜恢复预检 proof 且 `rollback.status === 'safe'`（:554-583）。
  - `submitCommit`（:615-687）finish 模式 force 预检门禁、finalize_preview 模式校验 `proof.finalize === 'safe'`；retention 按 retainEnvironment 决定缺省 cleanup；commitMessage 上限 500。
  - `discard`（:689-712）`confirmDirty: true`。
- 冲突/再生恢复入口：`startConflictRecovery`（:255-348）强制重读预检 → 核对冲突身份五元组（checkoutId/reviewId/revision/localHeadOid/conflictingFiles，:280-286）→ `adapter.resumeRevision` 带 conflictContinuation → 核验返回 target state working、revision+1、recoveryContinuation 精确匹配（:309-333）→ `enqueueWorktreeRecovery`；`startReviewRegeneration`（:350-412）走 blocked + stale_isolated → `prepareReviewRegeneration` → 入队。
- 只读分析与交接：`analyzeRecovery`（:731-785）`preparePreviewRecoveryAnalysis` → 校验 continuation → openAuthorizedWorktreeTarget 回源会话 → 二次 inspect 核对 recoveryContinuation requestId/generation（:765-770）→ `binding.session.prompt([...], 'queue')` 下发只读分析指令；`handoffRecovery`（:787-846）`createPreviewRecoveryHandoff` → 校验 sourceCheckoutId 且 checkoutId 与当前不同 → openIsolatedTarget 切到新 owner 会话 → 二次 inspect → prompt 交接。
- :1143-1175 恢复面板按钮（ask.agent.for.read.only.analysis / hand.off.to.a.new.worktree / ask.agent.to.resolve.conflicts）与活动恢复状态条（failed 可 Resend）；:1180-1182 错误条按 meta 渲染 error.category.*/error.recovery.* 翻译键。
- 交付后终态 dock（retained/cleanup_pending）：ReviewActions 接受 `proofVariant?: 'compact'`（:44/:85），DeliveryProof 以紧凑单行变体渲染（`.dsh-wt-delivery-proof-compact`），整卡只经「查看详情」弹窗展示；`:948` 的终态标题行由 `terminal && !renderStatus` 守卫（dock 场景由 TargetConsole 的 WorktreeReviewStatus 渲染紧凑 dock，避免重复标题）。dock 内 `.dsh-wt-review-actions` 为纵向 flex（flex:1 1 0 + min-width:0），`.dsh-wt-delivery-proof(-compact)` 限 min-width:0/max-width:100%——防止全卡 grid 的 max-content 撑爆横向 flex 行（此前把左侧文案挤成一字宽竖排）。关闭 dock 由 WorktreeReviewStatus 的 `dismissed {checkoutId, reviewId}` 身份失效实现（见 [[target-console]]）。

## 恢复请求持久队列（src/client/review-console/recovery-continuation.ts）

- 请求两种 kind：`worktree_apply_conflict`（revision 为 resumeRevision 后的权威 Working revision）与 `worktree_review_regeneration`（Ready revision 只读路径）（src/client/review-console/recovery-continuation.ts:6-27）；状态机 queued/sending/sent/failed/cancelled（:30）。
- 模块级 `entries Map<sessionId, entry>`（:49）+ localStorage 前缀 `'dsh-git-worktree:recovery:v1:'`（:51）；sent/cancelled 即删除，其余持久化（:73-91），注释声明浏览器持久化只是尽力上下文，Host 身份校验始终权威。
- `readPersisted`（:93-118）严格重验：hasExactKeys 精确键集、version 1、状态白名单、`validRequest`（:140-167）校验长度上限、checkoutId 禁 '..' 与斜杠、localHeadOid 正则 `/^[0-9a-f]{40}|[0-9a-f]{64}$/iu`、`safeConflictFile` 单文件 ≤1000 且非绝对路径（:129-133）；非法即 removeItem。
- `attempt`（:280-376）：claimed 单飞；inspect 后 `targetMatchesRequest`（:195-225，conflict 要求 state working、无 review、proof 逐字段匹配）不匹配即 cancel；binding 未就绪 → `waitForSession`（:264-278，订阅 list 与 binding，250ms 兜底轮询）；发送前再 inspect 一次（:323-338，第一次 inspect 可能在等会话就绪）；挂会话切换 watcher + 100ms isActive 间隔（:344-350）；`binding.session.prompt(buildWorktreeRecoveryPrompt(request, t), 'queue', abort.signal)`（:351）→ sent。
- `enqueueWorktreeRecovery`（:389-427）：同 requestId 刷新引用；不同请求先 cancel 旧条目；invalidRequest 直接 failed。`restoreWorktreeRecovery`（:429-489）处理运行时重建：sending 被打断 → abort + failed（`t('the.session.runtime.was.rebuilt.during.sending.the')`）；queued → attempt；从 localStorage 恢复时 sending 状态视为 failed（发送中断不可知）。`retryWorktreeRecovery`（:491-500）仅 failed 且会话 active；cancel/detach/clear（:522-548）。
- `useWorktreeRecoverySnapshot`（:512-519）供状态条订阅；`activeSessionState`（:227-236）用 retainedBy 契约判定 pending/mismatch/active。

## 辅组件与跨面板事件

- src/client/review-console/PreflightStatus.tsx:11-99 只读预检展示：ready/local_advanced/already_in_local/conflict/blocked 五态文案（:11-19），conflict 列冲突文件，blocked + project_acceptance_busy 显示占用者并给 open-holder 按钮，conflict/blocked 底部附 check-again 与恢复动作。
- src/client/review-console/ReviewDetailsModal.tsx:15-64 详情 Modal：状态徽章按 recovery/conflict/blocked/preview/saved/ready 切换（:46-49），conflict 时给冲突文件打标（:57），:20-43 自实现焦点陷阱（Tab 循环 + 关闭后焦点归还）。
- src/client/review-console/DeliveryProof.tsx:16-47 交付证据（commit、local head before/after、validation、commit 是否仍在本地历史）。
- src/client/review-console/ReviewIcon.tsx:7-18 lucide 图标表；src/client/review-console/review-console.styles.ts 输出 `REVIEW_CONSOLE_STYLES` 由 client 样式聚合。
- src/client/review-console/status-events.ts:1-6 `WORKTREE_REVIEW_REFRESH_EVENT = 'dsh-git-worktree:review-refresh'` CustomEvent：任何面板变更成功后 `requestWorktreeReviewRefresh(sessionId)` 广播所有挂载的评审面重读 Host 权威状态。
