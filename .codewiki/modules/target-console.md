---
title: Target Console 目标徽章与 Worktree 控制台
type: module
source_files:
  - src/client/target-console/index.ts
  - src/client/target-console/TargetStatusAction.tsx
  - src/client/target-console/WorktreeConsoleView.tsx
  - src/client/target-console/WorktreeReviewStatus.tsx
  - src/client/target-console/WorktreeManagerModal.tsx
  - src/client/target-console/current-polling.ts
  - src/client/target-console/target-console.styles.ts
  - src/client/actions.ts
tags:
  - client
  - target-console
  - polling
  - navigation
---

# Target Console 目标徽章与 Worktree 控制台

注册会话头的 Worktree 状态胶囊、输入坞评审状态条，以及源会话内打开的 Worktree 管理面板；数据经 [[client-boot|Client Boot]] 适配出的 `WorktreeConsoleAdapter` 读取 Host，会话跳转与身份校验复用 src/client/actions.ts 的编排层。

## 槽位注册（src/client/target-console/index.ts）

- src/client/target-console/index.ts:18-38 `registerTargetConsole` 注入两个槽位：`conversation.session.header.actions` 注册 `{id 'worktree-target', order 30}` → TargetStatusAction；`conversation.input.dock` 注册 `{id 'worktree-review-status', order 10}` → WorktreeReviewStatus。:40-43 再导出面板组件供 Manager Modal 复用。

## 会话导航编排（src/client/actions.ts）

浏览器侧对 Harness Workspace/Session 运行时面孔的编排层，pre-session 与评审恢复同样复用：

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

- src/client/target-console/TargetStatusAction.tsx:20-31 `STATE_LABELS` 覆盖契约 10 态；:33-35 `shortOid` 截 7 位（`'unversioned'` 直通）。
- :49-54 渲染期失效：`activeSession.current !== sessionId` 时当场 bump `actionScope`，旧会话的异步回调一律作废；:66-85 effect 按 `[adapter, language, sessionId]` 重置全部状态后 `subscribeCurrent`。
- 菜单动作全部先查 capabilities：reveal → `workspaces.openPath(managedRoot)`（:95-101）；openSource 用 openExistingSession 校验源会话 cwd（:103-109）；retryCleanup（:111-139）与 beginNextIteration（:141-163）成功后本地合并 `outcome.value.target`，`stale_target` 触发 `requestWorktreeReviewRefresh` 让各面板重读；discard（:165-197）恒传 `confirmDirty: true`，`preview_active || capabilities.rollbackPreview` 时带 `rollbackPreview: true`（:176-179），phase discarded 后把 managedRoot 置 null（:131、:189）。
- :225-260 Menu 锚定在按钮 `.dsh-wtc-target-chip[data-target-state]`；:261-271 打开 WorktreeManagerModal；:272-287 清理确认 Modal 按 preview_active 切换"先安全回滚本地预览"与"永久丢弃"文案。

## 管理面板（src/client/target-console/WorktreeConsoleView.tsx）

- 源会话视角的 Worktree 管理面；src/client/target-console/WorktreeManagerModal.tsx:18-48 是薄 Modal 包装（embedded 模式复用同一视图）。
- 错误呈现用契约 meta：`errorText`（src/client/target-console/WorktreeConsoleView.tsx:49-59）按 `worktreeConsoleErrorMeta(code).recovery` 附加下一步提示（refresh/confirm_dirty/open_recovery/retry/无权限说明）。
- 会话切换守卫：:119-127 `useLayoutEffect` 在 sessionId 变化时 bump `sessionGeneration` 与 request 并重置；:129-131 `isActive(generation) = mounted && sessionGeneration 相等`。
- `refresh`（:132-159）：generation+token 双守卫下 `Promise.all([adapter.current, adapter.list])`；`applyMutation`（:166-184）按 checkoutId 就地补丁 current 与 list 行；`mutationError`（:186-192）对 stale_* 错误自动 `refresh(false)`。
- `createTarget`（:200-256）：创建后逐项校验 Host 返回身份（sourceSessionId 是自己、targetSessionId 不是自己、checkoutId 非空、ownerSessionId === targetSessionId、managedRoot 与 project 匹配、capabilities.open），再经 openIsolatedTarget 落地；列表摘要剥掉 managedRoot/sourceRoot/sourceOid/currentBranch（:239-242）。v0.9.4：创建按钮旁有基准分支 `<select>`（`.dsh-wtc-branch-select`，aria-label 从分支创建，:363-390）——`onFocus` 懒加载 `adapter.preflightCreate` 的 ready.branches（`loadBranches`，:194-202，每会话缓存），默认选项是源会话当前分支（`currentSourceBranch`），选中值随 `adapter.create({sourceSessionId, branch})` 提交；语义是基准选择而非 adopt（见 [[create-from-branch-is-base-only|Create From Branch Is Base Only]]）。
- `discardTarget`（:252-278）/`retryCleanup`（:280-303）带代际守卫；`openListedTarget`（:305-328）经 openAuthorizedWorktreeTarget；排序 `orderedWorktrees`（:330-338）focus 优先，其次 `ATTENTION_RANK`（recovery_required 0 → local 9，:78-89），再 iteration 降序；:458-489 脏丢弃确认用 `role=alertdialog`、Escape 关闭、确认按钮 autofocus。

## 输入坞评审状态条（src/client/target-console/WorktreeReviewStatus.tsx）

- src/client/target-console/WorktreeReviewStatus.tsx:50-52 挂载即 `restoreWorktreeRecovery`（恢复持久化的恢复请求，机制见 [[review-console|Review Console]]）。
- :55-71 订阅 current 时保持 target 单调：仅当 checkoutId 相同且 revision 不回退才更新（:64）；`applyTarget`（:111-113）同规则。
- :73-97 standaloneRecovery 卡片：恢复请求与当前 target 匹配且（state working 或无 review）时展示 queued/sending/sent/cancelled/failed 状态与重试按钮。
- :100-108 渲染门槛：无 review 或 state 不在 `[ready_for_review, preview_active, preview_detached, cleanup_pending, recovery_required, retained]` 直接 null；:115-132 按 state 出文案（reviewSlot waiting 提示占用者、preview_detached + stale_local 提示分支快进）。
- :134-166 把 `reviewEvidenceFromTarget`/`reviewIdentityFromTarget` 的产物交给 ReviewActions；`isActive`（:161）叠加 mounted、会话与代际三重校验；onStale → refresh，onTargetChange → applyTarget。

样式见 src/client/target-console/target-console.styles.ts（`TARGET_CONSOLE_STYLES`，String.raw 胶囊/菜单样式，被 client 样式聚合注入）。
