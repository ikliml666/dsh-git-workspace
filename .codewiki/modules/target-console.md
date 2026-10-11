---
title: Target Console 目标徽章与 Worktree 控制台
type: module
source_files:
  - src/client/target-console/index.ts
  - src/client/target-console/TargetStatusAction.tsx
  - src/client/target-console/WorktreeConsoleView.tsx
  - src/client/target-console/WorktreeHeroChip.tsx
  - src/client/target-console/WorktreeReviewStatus.tsx
  - src/client/target-console/WorktreeManagerModal.tsx
  - src/client/target-console/BranchGraphModal.tsx
  - src/client/target-console/branch-overview-cache.ts
  - src/client/target-console/current-polling.ts
  - src/client/target-console/target-console.styles.ts
tags:
  - client
  - target-console
  - polling
  - navigation
  - git-branch-ui
---

# Target Console 目标徽章与 Worktree 控制台

注册会话头的 Worktree 状态胶囊、输入坞评审状态条，以及源会话内打开的 Worktree 管理面板；数据经 [[client-boot|Client Boot]] 适配出的 `WorktreeConsoleAdapter` 读取 Host，会话跳转与身份校验复用 `src/client/actions.ts` 的编排层。

## 槽位注册（src/client/target-console/index.ts）

- src/client/target-console/index.ts:27-39 `registerTargetConsole` 注入两个槽位三条目：`conversation.session.header.actions` 注册 `{id 'worktree-target', order 30}` → TargetStatusAction；`conversation.input.dock` 注册 `{id 'worktree-review-status', order 10}` → WorktreeReviewStatus 与 `{id 'worktree-hero-chip', order 20}` → WorktreeHeroChip（空白会话，见下节）。:41-45 再导出面板组件供 Manager Modal 复用。

## 会话导航编排（src/client/actions.ts）

浏览器侧对 Harness Workspace/Session 运行时面孔的编排层，评审恢复同样复用：

- `samePath`（src/client/actions.ts:102-109）：统一斜杠与尾斜杠后比较，任一路径带 Windows 盘符则大小写不敏感。
- `navigateToSession`（:112-119）：优先 `uiWorkspace.openSession`（导航的 UI 所有者），退化 `sessions.open`，两者皆无则抛 `t('harness.session.navigation.unavailable')`——拒绝静默丢失目标选择。
- `selectedSessionId`（:122-129）：`retainedBy.mainView > 0` 的会话才算主视图持有者；current 与唯一 retained 冲突时返回 undefined（歧义优先于错误选择）。
- `openExistingSession`（:132-141）：先校验 `sessions.list` 快照中该会话 cwd 与期望路径 `samePath`，再导航。
- `waitForProjectedSessionPath`（:143-183）：订阅 `sessions.list` 等待 Host 把 cwd 投影到新会话；`isActive()` 失效即 settle(false)；cwd 不匹配抛 `t('the.cwd.of.new.harness.session.does.not')`；src/client/actions.ts:175-177 设 2000ms 超时兜底 `t('harness.has.not.projected.a.trusted.cwd.for')`。
- `openIsolatedTarget`（:186-217）：已有会话则走 openExistingSession 校验 cwd；否则 `workspaces.create({path managedRoot})` → 校验 `workspace.path === managedRoot` → `sessions.create` 校验 sessionId 一致 → waitForProjectedSessionPath → navigateToSession，每步身份不匹配都显式抛错。
- `openAuthorizedWorktreeTarget`（:223-250）：先 `adapter.inspect`，校验 `capabilities.inspect/open` 与 checkoutId/ownerSessionId/targetSessionId 三元身份、managedRoot 非空后才导航——Host 最新状态可能已撤销打开权限。
- `prefillSessionDraft`（:253-262）只写草稿不发送；`finalizeCurrentSession`（:265-280）经 `binding.session.command('/worktree finalize <reviewId> <revision> <retention>')` 完成命令式收尾。

## 5s 轮询订阅（src/client/target-console/current-polling.ts）

- src/client/target-console/current-polling.ts:10 注释即契约："Display-only observation. Never used to authorize a mutation or Git cleanup."——轮询只驱动显示，变更授权永远走显式 preflight/inspect。
- :7 `clients = WeakMap<adapter, Map<key, Poll>>`（按适配器实例隔离 Client）；:8 `DELAY = 5_000`；:76-89 订阅键 `JSON.stringify([sessionId, language])`，语言参与键隔离翻译结果。
- Poll 类（:11-73）：首个订阅者才 `addEventListener(WORKTREE_REVIEW_REFRESH_EVENT)` 并立即 invalidate；后续订阅者直接复用 last 缓存；`invalidate()`（:48-54）generation++、清定时器、标 dirty、不在跑就立刻 run；`run()`（:56-72）以 generation 快照守卫发布，结束后 dirty 则立即重跑否则 `setTimeout` 下轮。

## 会话头状态胶囊（src/client/target-console/TargetStatusAction.tsx）

- src/client/target-console/TargetStatusAction.tsx:30-41 `STATE_LABELS` 覆盖契约 10 态；:43-45 `shortOid` 截 7 位（`'unversioned'` 直通）。
- :48-69 渲染期失效：`activeSession.current !== sessionId` 时当场 bump `actionScope`，旧会话的异步回调一律作废；:72-75 mounted 守卫；:81-105 effect 按 `[adapter, language, sessionId]` 重置全部状态后 `subscribeCurrent`。
- :109-115 mount 预取分支概览（`ensureBranchOverview`），菜单打开时用 stale-while-revalidate 后台刷新。
- 菜单动作全部先查 capabilities：reveal → `workspaces.openPath(managedRoot)`（:128-134）；openSource 用 openExistingSession 校验源会话 cwd（:136-142）；retryCleanup（:206-236）与 beginNextIteration（:238-260）成功后本地合并 `outcome.value.target`，`stale_target` 触发 `requestWorktreeReviewRefresh` 让各面板重读；discard（:262-296）恒传 `confirmDirty: true`，`preview_active || capabilities.rollbackPreview` 时带 `rollbackPreview: true`（:275-277），phase discarded 后把 managedRoot 置 null（:228、:288）。
- :144-173 `switchBranch`：RPC 确认后乐观补丁 `patchBranchOverview`，直接读回补丁后缓存跳过一次重取；:175-204 `createBranch`：前端 `branchNameSchema` 校验 + Modal 输入 + `adapter.gitCreateBranch`，创建后 `invalidateBranchOverview` + 后台重新拉取。
- :308-346 Menu 项：分支列表最多 12 项（当前分支与会话分支置顶，显示 upstream 与「当前会话」徽章），新建分支 / 查看提交图 / reveal / source / begin_next_iteration / manager，footer 区 retry_cleanup 或 discard（danger）。
- :353-472 JSX：Menu 锚定在按钮 `.dsh-wtc-target-chip[data-target-state]`；:404-414 打开 WorktreeManagerModal；:415-430 清理确认 Modal 按 preview_active 切换"先安全回滚本地预览"与"永久丢弃"文案；:431-438 BranchGraphModal；:439-470 新建分支 Modal（含输入框 Enter 快捷提交）。

## 空白会话 hero 胶囊（src/client/target-console/WorktreeHeroChip.tsx）

- 新会话顶行「标准模式」旁的分支胶囊：挂 `conversation.input.dock`（`{id 'worktree-hero-chip', order 20}`），把 TargetStatusAction 原样 portal 进 hero 工作区行 `'[class*="heroWorkspaceRow"]'`（`isConnected` 守卫）——与 git-graph BranchChip 的 lift 模式一致；非空白会话（`session?.blank === false`）或找不到 hero 行时渲染 null。
- src/client/target-console/WorktreeHeroChip.tsx:10-29 `resolvePortalRenderer()` 模块级缓存懒取 react-dom：`typeof require === 'function'` 判定后经 factory 注入的 `require('react-dom')` 取 `createPortal`（兼容函数与 `{createPortal}` 两种形态），try/catch 兜底——宿主缺 react-dom 时只隐藏胶囊，不拖垮整包加载。
- :31-34 `findHeroWorkspaceRow()` DOM query + isConnected 校验；:52-72 空白会话 poll 查找 late-mounted hero 行（250ms × 40 次上限），MutationObserver 是零延迟升级路线但尚未实现。
- 空白会话的 `adapter.current` 命中 control-plane 的 callerTarget 兜底（target_unselected → unboundLocalTarget），返回 workspace local target，故胶囊显示 workspace 当前分支，菜单的分支切换/创建/提交图作用于 workspace cwd。

## 管理面板（src/client/target-console/WorktreeConsoleView.tsx）

- 源会话视角的 Worktree 管理面；src/client/target-console/WorktreeManagerModal.tsx:18-48 是薄 Modal 包装（embedded 模式复用同一视图）。
- 错误呈现用契约 meta：`errorText`（src/client/target-console/WorktreeConsoleView.tsx:51-58）按 `worktreeConsoleErrorMeta(code).recovery` 附加下一步提示（refresh/confirm_dirty/open_recovery/retry/无权限说明）。
- :32-43 `STATE_LABELS` / :60-64 `retentionLabel` / :66-75 `TargetState` 子组件（圆点色标 + 中文态名）；:77-88 `ATTENTION_RANK` recovery_required(0) → local(9)。
- :91-698 主组件：:121-138 `useLayoutEffect` 在 sessionId 变化时 bump `sessionGeneration` 与 request 并重置全部 state；:140-141 `isActive(generation) = mounted && sessionGeneration 相等`。
- `refresh`（:143-174）：generation+token 双守卫下 `Promise.all([adapter.current, adapter.list, adapter.listAbandoned])`（三路并发：current、list、abandoned 恢复条）；`refreshAbandoned`（:177-188）轻量刷新仅拉恢复条；`applyMutation`（:195-213）按 checkoutId 就地补丁 current 与 list 行；`mutationError`（:215-221）对 stale_* 错误自动 `refresh(false)`。
- `loadBranches`（:223-232）：`onFocus` 懒加载 `adapter.preflightCreate` 的 ready.branches（每会话缓存）；`createTarget`（:234-289）：创建后逐项校验 Host 返回身份（sourceSessionId 是自己、targetSessionId 不是自己、checkoutId 非空、ownerSessionId === targetSessionId、managedRoot 与 project 匹配、capabilities/open），再经 openIsolatedTarget 落地；列表摘要剥掉 managedRoot/sourceRoot/sourceOid/currentBranch（:274）。
- `discardTarget`（:291-317）/`retryCleanup`（:319-342）带代际守卫；`setPermanentFlag`（:344-367）pendingAction `permanent:<id>`，capabilities.setPermanent 门控切换常驻标记——行操作区 pin/pinOff 按钮 + facts 里「常驻」徽标；`setRetentionMode`（:369-387）dropdown 切换 retention 策略；`restoreAbandonedSnapshot`（:389-410）恢复放弃快照后 invalidateBranchOverview + refresh。
- `openListedTarget`（:412-435）经 openAuthorizedWorktreeTarget；排序 `orderedWorktrees`（:437-445）focus 优先，其次 `ATTENTION_RANK`，再 iteration 降序。
- JSX 结构：:447-449 loading 态；:451-697 完整布局——console-head（标题 + 刷新钮）、error/notice、current target section（项目名 + 分支 + 状态 + 基准分支 `<select>` + 创建按钮）、linked worktrees list（filter: needsAttentionOnly/includeDelivered + 计数 + 每行 facts/actions）、abandoned snapshots strip（可恢复放弃快照）、脏丢弃确认（:664-695 `role=alertdialog`、Escape 关闭、确认按钮 autofocus）。

## 输入坞评审状态条（src/client/target-console/WorktreeReviewStatus.tsx）

- src/client/target-console/WorktreeReviewStatus.tsx:53 挂载即 `restoreWorktreeRecovery`（恢复持久化的恢复请求，机制见 [[review-console|Review Console]]）。
- :57-73 订阅 current 时保持 target 单调：仅当 checkoutId 相同且 revision 不回退才更新（:66）；`applyTarget`（:116-118）同规则。
- :75-99 standaloneRecovery 卡片：恢复请求与当前 target 匹配且（state working 或无 review）时展示 queued/sending/sent/cancelled/failed 状态与重试按钮。
- :102-107 渲染门槛：无 review 或 state 不在 `[ready_for_review, preview_active, preview_detached, cleanup_pending, recovery_required, retained]` 直接 null；:122-137 按 state 出文案（reviewSlot waiting 提示占用者、preview_detached + stale_local 提示分支快进）。
- :139-181 JSX：dock 布局含 ReviewIcon + error + detail 按钮 + ReviewDetailsModal + ReviewActions（传 `proofVariant="compact"`）——terminal 态（retained/cleanup_pending）附「收起」钮，按 `checkoutId+reviewId` 记忆于 dismissed state，同轮验收不再重现，新一轮验收自动恢复。
- :155-166 renderStatus 内联 operation 阶段文案（preparing/withdrawing/saving/processing）+ 文件数 + 校验文本。

## 分支胶囊与提交图（git-graph 融合）

借鉴 `@linxin666/dsh-client-ui-git-graph`（BranchChip/BranchPopover/GraphDialog）重构会话头胶囊与分支操作：

- 胶囊主标签改为**分支名优先**（`target.currentBranch`，`.dsh-wtc-target-branch` 220px 省略），无分支时回退 `Worktree · <状态>`；chevron 旋转指示展开（aria-expanded 控制 transform:rotate），与图 2 参考形态一致。
- src/client/target-console/branch-overview-cache.ts：模块级按 `(adapter, sessionId)` 缓存 `gitOverview` 结果，TTL 60s + in-flight 去重（`ensureBranchOverview`）；`refreshBranchOverviewInBackground` 是 stale-while-revalidate——过期也先返回缓存值再后台刷新；`patchBranchOverview` 供切分支后就地改写（乐观 current 标记），`invalidateBranchOverview` 在切分支/建分支后强制重读。:14-21 patchEpochs 机制：每次 patch/invalidate 自增 epoch，flight 只在纪元未变时回写，防止起飞前的解析踩掉乐观补丁；失败路径（`!ok` outcome 或 reject）在 epoch 未变时 `cache.delete(sessionId)`——失败后不再供给陈旧快照，下次 ensure 直接重取。
- TargetStatusAction 菜单新增：分支列表（最多 12 项，当前分支与会话分支置顶，显示 upstream 与「当前会话」徽章，点击即 `adapter.gitSwitchBranch`）、新建分支（`branchNameSchema` 前端校验 + Modal 输入 + `adapter.gitCreateBranch`）、清理已合并分支（dryRun 预览弹窗 → 确认 `adapter.gitPruneMergedBranches`，成功后 invalidate+重取）、查看提交图。mount 预取 + 菜单打开时后台刷新，首次展开零等待。
- src/client/target-console/BranchGraphModal.tsx:31-75 `computeGraphLanes` 移植 git-graph 的 lane 算法（first parent 保留本道、其余 parent 开新道、无子提交后收道）；:81-82 `INITIAL_LIMIT=200`/`PAGE_STEP=100` 加载更多，:125 `requestSeq` 乱序守卫；:84-93 `formatTime` 相对时间格式化；行渲染 oid 7 位 + SVG lane 连线（贝塞尔曲线）+ 主题着色（LANE_COLORS 6 色循环）+ refs 徽章（当前分支高亮）+ 作者 + 相对时间。
- Host 语义：git 端点全部作用于**本地仓库根**（`projectRootFor`，repo 级读取，非 managed worktree）；`gitSwitchBranch` 在 owner 会话验收中途（ready_for_review/preview_active/preview_detached/recovery_required）拒绝（`localBranchSwitchBlockedDuringDelivery`），已交付后的本地漂移由既有 stale_local 机制容错。`gitPruneMergedBranches(sessionId, dryRun)` 直通 `module.pruneMergedBranchesForSession`（`git branch -d` 语义绝不强删，当前分支与 main/master 永不进候选，自带 withBindingLock）；返回 `{dryRun, headBranch, pruned[], skipped[]}`，skipped 条目恒带 reason；prune 需对候选分支逐个跑 isAncestor，client adapter 走 SLOW 180s 超时档（不在 FAST_METHODS）。

## 样式（src/client/target-console/target-console.styles.ts）

- src/client/target-console/target-console.styles.ts:1-188 `TARGET_CONSOLE_STYLES` 用 String.raw 定义全部 CSS 变量与类：
  - .dsh-wtc-target-chip: 胶囊样式（inline-flex、圆角、状态色 via --wtc-state 自定义属性，:43-50 各态颜色映射）。
  - .dsh-wtc-console: 面板 grid 布局（padding、gap、响应式 min-width）。
  - .dsh-wtc-row: 列表行（flex-between、border-bottom、current-target 高亮背景）。
  - .dsh-wtc-state: 状态圆点（--wtc-state 驱动颜色，:114-119 各态映射）。
  - .dsh-wtc-confirm: 脏丢弃确认 overlay（absolute z-index 2、box-shadow、role=alertdialog）。
  - .dsh-wtc-graph/*: 提交图 SVG lane 渲染（graph-row hover、oid 色、ref pill 高亮）。
  - .dsh-wtc-create-branch-input: 新建分支输入框样式。
  - 响应式：@media (max-width: 620px) 堆叠 current-actions/row-actions。