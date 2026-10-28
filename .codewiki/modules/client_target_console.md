---
title: client_target_console
type: module
source_files:
  - src/client/target-console/index.ts
  - src/client/target-console/WorktreeConsoleView.tsx
  - src/client/target-console/current-polling.ts
  - src/client/target-console/TargetStatusAction.tsx
  - src/client/target-console/branch-overview-cache.ts
  - src/client/target-console/WorktreeManagerModal.tsx
  - src/client/target-console/BranchGraphModal.tsx
  - src/client/target-console/TagManagerModal.tsx
  - src/client/target-console/WorktreeHeroChip.tsx
  - src/client/target-console/WorktreeReviewStatus.tsx
  - src/client/target-console/target-console.styles.ts
  - src/client/review-console/status-events.ts
  - src/console-contract.ts
  - src/client/index.tsx
  - tests/client-target-console.test.tsx
  - tests/current-polling.test.ts
  - tests/client-branch-overview-cache.test.ts
  - tests/support/worktree-console.ts
tags: [client, react, target-console, polling, branch, tags, worktree]
---

## Overview

`client_target_console` 是「目标控制台（Target Console）」在 Harness-native 客户端一侧的全部实现：它把 `WorktreeConsoleAdapter`（`src/console-contract.ts:745`）这一个归一化的 JSON 适配层，投影成三处 UI 入口——会话头部的状态胶囊、输入框上方的验收状态条、以及空白会话 hero 行里的胶囊——并承载了分支总览、提交图谱、本地标签管理这三块「源仓库视图」交互。

模块的核心职责可以拆成三条主线：

- **轮询（polling）**：`current-polling.ts` 提供一个基于 `adapter.current()` 的共享、去抖、`request-id` 隔离的观察器 `subscribeCurrent`。头部胶囊与验收 dock 都订阅它来获取「目标 Worktree 当前状态」，避免每个挂载点各发一次 `git status` + 两次 `git rev-parse`。
- **目标控制台视图（Worktree Console View）**：`WorktreeConsoleView.tsx` 是项目级「受管 Worktree 清单」的全功能面板，列举每个源会话/关联任务、其生命周期动作（create / open / discard / setPermanent / retryCleanup / restoreAbandoned）、保留期与恢复快照，并通过 `WorktreeManagerModal.tsx` 作为独立弹层复用。
- **分支与标签管理**：`TargetStatusAction.tsx` 的胶囊点击后展开分支/标签/图谱菜单；分支总览走 `branch-overview-cache.ts` 的模块级缓存（stale-while-revalidate），标签走 `TagManagerModal.tsx`，提交图谱走 `BranchGraphModal.tsx`（纯客户端 lane 拓扑计算）。

这些组件全部通过 `registerTargetConsole`（`src/client/target-console/index.ts:19`）注入到 Harness 的 slot 体系；真正的挂载发生在 `src/client/index.tsx:92` 的 `apply()`，仅当 `WORKTREE_CONSOLE_ADAPTER_SERVICE`（`src/client/index.tsx:18`）这个归一化适配器可用时才注册。样式由 `target-console.styles.ts` 一次性注入（`src/client/index.tsx:49`）。

## Key Components

### `src/client/target-console/index.ts`（模块入口 / slot 注册）

- `TargetConsoleContextLike`（接口，`index.ts:8`）：仅声明 `slots.inject` 与 `slots.register`，是注入点的形态约定。
- `registerTargetConsole(ctx, adapter, services)`（`index.ts:19`）：把三个贡献注册进 slot：
  - `conversation.session.header.actions` → id `worktree-target`，`order: 30`（`index.ts:30`），组件 `TargetStatusAction`。
  - `conversation.input.dock` → id `worktree-review-status`，`order: 10`（`index.ts:36`），组件 `WorktreeReviewStatus`（验收状态条）。
  - `conversation.input.dock` → id `worktree-hero-chip`，`order: 20`（`index.ts:41`），组件 `WorktreeHeroChip`（空白会话 hero 胶囊）。
  - 注意：并不注册 `conversation.view`（见 `tests/client-target-console.test.tsx:926` 断言）。
- 重导出：`TargetStatusAction`、`WorktreeConsoleView`、`WorktreeHeroChip`、`WorktreeManagerModal`、`WorktreeReviewStatus`（`index.ts:51`–`53`）。

### `src/client/target-console/current-polling.ts`（共享轮询观察器）

- 常量：`DELAY = 5_000`（`current-polling.ts:8`），隐藏窗口下的 `HIDDEN_DELAY = 60_000`（`current-polling.ts:15`，避免后台 GUI 空转烧 CPU/磁盘）。
- `clients`：`WeakMap<WorktreeConsoleAdapter, Map<string, Poll>>`（`current-polling.ts:7`），按适配器隔离 Client 实例。
- 类型：`Result` = `{ outcome } | { error }`（`current-polling.ts:5`），`Listener`（`current-polling.ts:6`）。
- `isHidden()`（`current-polling.ts:17`）：读取 `document.visibilityState === 'hidden'`。
- `class Poll`（`current-polling.ts:22`）：
  - 字段：`listeners: Set<Listener>`、`timer`、`running`、`dirty`、`generation`、`last: Result | undefined`（`current-polling.ts:78`–`28`）。
  - `subscribe(listener)`（`current-polling.ts:41`）：首个订阅者启动循环（监听 `WORKTREE_REVIEW_REFRESH_EVENT` 与 `visibilitychange`），后续订阅者直接回放 `last`。
  - `invalidate()`（`current-polling.ts:66`）：自增 `generation`、清 `timer`、标记 `dirty` 并立即 `run()`。
  - `run()`（`current-polling.ts:74`）：调用 `adapter.current({ sessionId })`，按 `generation` 防旧响应；空闲后按 `isHidden() ? HIDDEN_DELAY : DELAY` 排下一轮（`current-polling.ts:78`）。
  - `onRefresh`（`current-polling.ts:32`）/ `onVisibility`（`current-polling.ts:37`）：事件监听，按 `sessionId` 过滤刷新、隐藏→可见时立即 `invalidate()`。
- `subscribeCurrent(adapter, sessionId, language, listener)`（`current-polling.ts:94`）：按 `[sessionId, language]`（`current-polling.ts:99`）建 key，语言隔离翻译结果；适配器实例、会话、语言三者互不共享结果（见 `tests/current-polling.test.ts:101`）。

### `src/client/target-console/TargetStatusAction.tsx`（头部状态胶囊 + 分支/标签菜单）

- 接口 `TargetStatusActionProps`（`TargetStatusAction.tsx:26`）：`sessionId`、`adapter`、`services`。
- `STATE_LABELS`（函数，`TargetStatusAction.tsx:32`）与 `shortOid`（`TargetStatusAction.tsx:46`）：状态文案与 short-oid。
- `TargetStatusAction`（组件，`TargetStatusAction.tsx:51`）：
  - 大量本地 state：`target`、`loading`、`error`、`failure`（`TargetStatusAction.tsx:55`–`59`）、`menuOpen`、`managerOpen`、`cleanupConfirmOpen`、`pendingAction`（`TargetStatusAction.tsx:60`–`63`）、`overview`、`graphOpen`、`createOpen`、`createName`、`createBusy`、`pruneOpen/prunePreview/pruneLoading/pruneBusy`、`branchQuery`、`switchNotice`、`tagsOpen`、`tagTarget`、`initializeOpen`、`initializeBusy`（`TargetStatusAction.tsx:64`–`80`）。
  - `actionScope` ref（`TargetStatusAction.tsx:81`）：会话切换时自增，用于丢弃旧请求（防跨 Session 注入，见 `tests/client-target-console.test.tsx:520`）。
  - 订阅逻辑在 `useEffect`（`TargetStatusAction.tsx:98`）：挂载时调用 `subscribeCurrent`；结果落到 `target` 或 `failure`（失败码存入 `failure.code/message`，用于 tooltip，见 `TargetStatusAction.tsx:120`–`137`）。
  - `notGitRepository`（`TargetStatusAction.tsx:149`）：`failure.code === 'not_git_repository'` 时给出专属文案而非「不可用」。
  - 动作函数：`reveal`（`TargetStatusAction.tsx:170`，`services.workspaces.openPath`）、`openSource`（`TargetStatusAction.tsx:178`，`openExistingSession`）、`switchBranch`（`TargetStatusAction.tsx:186`，`adapter.gitSwitchBranch` + 乐观 `patchBranchOverview`）、`createBranch`（`TargetStatusAction.tsx:226`，`adapter.gitCreateBranch`）、`initializeRepository`（`TargetStatusAction.tsx:257`，`adapter.initializeProject`）、`openPrunePreview`/`confirmPrune`（`TargetStatusAction.tsx:312`/`312`，`adapter.gitPruneMergedBranches`）、`retryCleanup`/`beginNextIteration`/`returnToLocal`/`discard`（`TargetStatusAction.tsx:419`/`371`/`395`/`419`）。
  - 分支列表逻辑：`MAX_BRANCH_ITEMS = 12`（`TargetStatusAction.tsx:471`），超 12 条才显示搜索框（`TargetStatusAction.tsx:486`），Enter 切首个匹配（`TargetStatusAction.tsx:513`）。
  - 菜单项构建：`items`（`TargetStatusAction.tsx:494`/`498`）区分 `notGitRepository` 与非 Git；`footer`（`TargetStatusAction.tsx:555`）按 capabilities 提供 `retry_cleanup` 或 `discard`（危险）。
  - 渲染：`<Menu>` 胶囊（`TargetStatusAction.tsx:624`）+ 一系列 `<Modal>`：`WorktreeManagerModal`、`cleanupConfirmOpen`、`initializeOpen`、`BranchGraphModal`、`TagManagerModal`、`createOpen`、`pruneOpen`（见 `TargetStatusAction.tsx:678`–`761`）。
  - 点击展开时按需拉 `refreshBranchOverviewInBackground` / `ensureBranchOverview`（`TargetStatusAction.tsx:604`–`611`）。

### `src/client/target-console/branch-overview-cache.ts`（分支总览模块级缓存）

- 常量 `TTL_MS = 60_000`（`branch-overview-cache.ts:17`）。
- 模块级 `cache` / `flights` / `patchEpochs`（`branch-overview-cache.ts:21`–`21`）。
- `bumpEpoch`（`branch-overview-cache.ts:23`）：每次 patch/invalidate 自增，使「飞行中」的旧 `fetch` 解析时不会踩掉乐观补丁（见 `tests/client-branch-overview-cache.test.ts:33`）。
- `cachedBranchOverview(sessionId)`（`branch-overview-cache.ts:27`）、`invalidateBranchOverview(sessionId)`（`branch-overview-cache.ts:35`）、`patchBranchOverview(sessionId, patch)`（`branch-overview-cache.ts:41`，乐观局部补丁）。
- `fetchOverview(adapter, sessionId)`（内部，`branch-overview-cache.ts:48`）：单飞（single-flight）；`!ok`/异常时清槽，且只在 epoch 未变时回写（`branch-overview-cache.ts:55`–`70`）。
- `ensureBranchOverview(adapter, sessionId)`（`branch-overview-cache.ts:80`）：在 TTL 内立即返回缓存，否则 await 一次 fetch。
- `refreshBranchOverviewInBackground(adapter, sessionId)`（`branch-overview-cache.ts:87`）：返回「可能陈旧」的缓存并后台刷新（stale-while-revalidate）。

### `src/client/target-console/TagManagerModal.tsx`（本地标签管理弹层）

- 接口 `TagManagerModalProps`（`TagManagerModal.tsx:9`）：含 `target?`（指向具体 commit/oid，null=HEAD，`TagManagerModal.tsx:16`）。
- `type BusyAction = 'create' | 'delete' | 'push' | null`（`TagManagerModal.tsx:19`）。
- `TagManagerModal`（组件，`TagManagerModal.tsx:26`）：
  - state：`tags`、`error`、`notice`、`loading`、`busy`、`createName`、`createMessage`、`pushOnCreate`、`confirmDelete`、`deleteRemote`、`requestSeq`（`TagManagerModal.tsx:37`–`37`）。
  - `load`（`TagManagerModal.tsx:39`）：开弹时 `adapter.gitListTags(sessionId)`；`requestSeq` 防旧响应。注意 `load` 不清 `error`（避免覆盖「本地创建成功但推送失败」的消息，`TagManagerModal.tsx:42`）。
  - `createTag`（`TagManagerModal.tsx:70`）：`adapter.gitCreateTag({ sessionId, name, message, target, push })`；`pushed===false` 时保留标签并报告 push 失败（`TagManagerModal.tsx:77`）。
  - `deleteTag`（`TagManagerModal.tsx:102`）：`adapter.gitDeleteTag({ sessionId, name, remote })`，支持 `remote` 同时删 origin。
  - `pushTag`（`TagManagerModal.tsx:122`）：`adapter.gitPushTag({ sessionId, name })`；被拒 push 视为可报告结果而非失败。
  - 每次 mutation 后重新 `load()`，使列表永不展示陈旧 tag（`TagManagerModal.tsx:99`）。

### `src/client/target-console/BranchGraphModal.tsx`（提交图谱弹层 + lane 计算）

- 接口/类型：`GraphEdge`（`BranchGraphModal.tsx:10`）、`GraphRowLanes`（`BranchGraphModal.tsx:18`）、`GraphRefBadge`（`BranchGraphModal.tsx:25`）。
- `mergeRefs(refs)`（`BranchGraphModal.tsx:39`）：把同名 local/remote/tag ref 折叠成一个 badge（tag 与同名 branch 不折叠）。
- `computeGraphLanes(rows)`（`BranchGraphModal.tsx:66`）：从 `@linxin666/dsh-client-ui-git-graph` 移植的 lane 拓扑，输出每条 commit 的 `nodeColumn`/`laneCount`/`edges`。
- 常量：`LANE_COLORS`、`LANE_WIDTH=14`、`ROW_HEIGHT=36`、`NODE_RADIUS=4`、`INITIAL_LIMIT=200`、`PAGE_STEP=100`（`BranchGraphModal.tsx:129`–`134`）；`formatTime`（`BranchGraphModal.tsx:136`）。
- 接口 `BranchGraphModalProps`（`BranchGraphModal.tsx:147`）：含 `currentBranch`、`onTagCommit(oid)`、`onManageTags()`（`BranchGraphModal.tsx:154`/`157`）。
- `edgePath`（`BranchGraphModal.tsx:164`）：把 lane 几何渲染成 SVG path。
- `BranchGraphModal`（组件，`BranchGraphModal.tsx:175`）：`load(nextLimit)` 调 `adapter.gitGraph(sessionId, nextLimit)`（`BranchGraphModal.tsx:187`），分页「更多」按钮（`BranchGraphModal.tsx:183`）；每行有「在此提交打标签」按钮，回调 `onTagCommit(commit.oid)`（`BranchGraphModal.tsx:293`）。

### `src/client/target-console/WorktreeConsoleView.tsx`（项目级目标控制台面板）

- 接口 `WorktreeConsoleViewProps`（`WorktreeConsoleView.tsx:23`）：`embedded`、`sessionId`、`adapter`、`services`、`focusCheckoutId?`、`onTargetChange?`。
- 常量 `STATE_LABELS`（`WorktreeConsoleView.tsx:32`）、`ATTENTION_RANK`（`WorktreeConsoleView.tsx:78`，排序权重，recovery_required 最前）。
- `errorText`（`WorktreeConsoleView.tsx:52`）、`retentionLabel`（`WorktreeConsoleView.tsx:61`）、`TargetState`（子组件，`WorktreeConsoleView.tsx:67`）。
- `WorktreeConsoleView`（组件，`WorktreeConsoleView.tsx:93`）：
  - 关键 refs：`mounted`、`request`、`abandonedRequest`、`sessionGeneration`（`WorktreeConsoleView.tsx:107`–`107`）。
  - `refresh()`（`WorktreeConsoleView.tsx:145`）：并发 `adapter.current` + `adapter.list` + `adapter.listAbandoned`（可选，`WorktreeConsoleView.tsx:152`），用 `isActive(generation)` + token 防旧响应。
  - `refreshAbandoned()`（`WorktreeConsoleView.tsx:179`）：仅重拉恢复条，不打断主面板。
  - `applyMutation`（`WorktreeConsoleView.tsx:197`）：把 mutation 结果合并进 `snapshot`（按 `checkoutId` 匹配 current/list）。
  - `loadBranches`（`WorktreeConsoleView.tsx:225`，`adapter.preflightCreate`）、`createTarget`（`WorktreeConsoleView.tsx:236`，含对 Host 返回身份的多重校验 `WorktreeConsoleView.tsx:250`–`265`）、`discardTarget`（`WorktreeConsoleView.tsx:293`）、`retryCleanup`（`WorktreeConsoleView.tsx:321`）、`setPermanentFlag`（`WorktreeConsoleView.tsx:346`）、`setRetentionMode`（`WorktreeConsoleView.tsx:371`）、`restoreAbandonedSnapshot`（`WorktreeConsoleView.tsx:391`，调 `invalidateBranchOverview`）、`openListedTarget`（`WorktreeConsoleView.tsx:414`，`adapter.openAuthorizedWorktreeTarget`/`openIsolatedTarget`）。
  - 排序 `orderedWorktrees`（`WorktreeConsoleView.tsx:439`）：focus 优先 + `ATTENTION_RANK` + iteration。
  - 渲染：当前目标卡（`WorktreeConsoleView.tsx:465`）、清单（`WorktreeConsoleView.tsx:500`，含 needsAttention/includeDelivered 过滤）、恢复快照段（`WorktreeConsoleView.tsx:626`）、discard 确认框（`WorktreeConsoleView.tsx:666`）。

### `src/client/target-console/WorktreeManagerModal.tsx`（管理器弹层外壳）

- 接口 `WorktreeManagerModalProps`（`WorktreeManagerModal.tsx:7`）。
- `WorktreeManagerModal`（组件，`WorktreeManagerModal.tsx:18`）：`<Modal>` 里嵌 `<WorktreeConsoleView embedded ...>`（`WorktreeManagerModal.tsx:39`），作为「管理关联 Worktrees」的独立弹层复用同一面板。

### `src/client/target-console/WorktreeHeroChip.tsx`（空白会话 hero 胶囊 portal）

- `resolvePortalRenderer()`（`WorktreeHeroChip.tsx:10`）：惰性 `require('react-dom')` 解析 `createPortal`，失败则降级为「无 hero 胶囊」（`WorktreeHeroChip.tsx:25`）。
- `findHeroRowFrom(anchor)`（`WorktreeHeroChip.tsx:44`）：从 dock anchor 的兄弟/祖先结构定位 `heroWorkspaceRow`（lift pattern），兜底 `document.querySelector`。
- 接口 `WorktreeHeroChipProps`（`WorktreeHeroChip.tsx:71`）。
- `WorktreeHeroChip`（组件，`WorktreeHeroChip.tsx:84`）：用 `MutationObserver` + 兜底 `setInterval`（500ms、最多 8 次，`WorktreeHeroChip.tsx:119`）解析 hero 行，再把 `<TargetStatusAction>` portal 进去；非 blank 会话返回 null（`WorktreeHeroChip.tsx:131`）。

### `src/client/target-console/WorktreeReviewStatus.tsx`（验收 dock 状态条）

- 接口 `WorktreeReviewStatusProps`（`WorktreeReviewStatus.tsx:18`）：`session`、`adapter`、`services`。
- `WorktreeReviewStatus`（组件，`WorktreeReviewStatus.tsx:25`）：订阅 `subscribeCurrent`（`WorktreeReviewStatus.tsx:61`），按 `sessionGeneration` 防旧；仅当 `target.review` 存在且 state 在允许集合（`ready_for_review`/`preview_active`/`preview_detached`/`cleanup_pending`/`recovery_required`/`retained`，`WorktreeReviewStatus.tsx:106`）才渲染 dock；通过 `ReviewActions` 渲染验收/preview/rollback/细节按钮，并复用 `review-console` 的恢复续传（`useWorktreeRecoverySnapshot`、`restoreWorktreeRecovery`、`retryWorktreeRecovery`）。

### `src/client/target-console/target-console.styles.ts`

- 导出 `TARGET_CONSOLE_STYLES`（CSS 字符串，`target-console.styles.ts:1`）：所有 `dsh-wtc-*` 与 `dsh-wt-*` 样式，按 `data-target-state` 着色（含 `not_git_repository` 中性灰，`target-console.styles.ts:52`），由 `src/client/index.tsx:74` 注入。

### 支撑类型（`src/console-contract.ts`）

- `WorktreeConsoleAdapter`（接口，`console-contract.ts:745`）：归一化适配层，`current/list/create/.../gitOverview/gitGraph/gitCreateBranch/gitSwitchBranch/gitPruneMergedBranches/gitListTags/gitCreateTag/gitDeleteTag/gitPushTag` 等均在此声明；`listAbandoned`/`restoreAbandoned` 为可选。
- `WorktreeConsoleTargetDetails`（`console-contract.ts:182`）：头部胶囊用到的身份详单（含 `managedRoot`、`sourceRoot`、`sourceOid`、`currentBranch`、`recoveryContinuation`）。
- `WorktreeConsoleGitOverviewResponse`（`console-contract.ts:514`）、`WorktreeConsoleGitGraphCommit`（`console-contract.ts:537`）、`WorktreeConsoleGitTag`（`console-contract.ts:559`）、`WorktreeConsoleGitPruneResponse`（`console-contract.ts:529`）等分支/标签/图谱 DTO。
- `WORKTREE_CONSOLE_ERROR_CODES` 与 `ERROR_META`（`console-contract.ts:705`/`705`）：`worktreeConsoleErrorMeta`（`console-contract.ts:740`）把错误码映射到 category/recovery。

### 支撑事件（`src/client/review-console/status-events.ts`）

- `WORKTREE_REVIEW_REFRESH_EVENT = 'dsh-git-worktree:review-refresh'`（`status-events.ts:1`）。
- `requestWorktreeReviewRefresh(sessionId)`（`status-events.ts:4`）：派发带 `detail.sessionId` 的 `CustomEvent`，触发所有挂载面的轮询 `invalidate()`（`current-polling.ts:33`）。

## Architecture

三处 UI 入口由 `registerTargetConsole`（`src/client/target-console/index.ts:19`）注入，各自订阅同一个 `subscribeCurrent` 轮询器；分支/标签/图谱交互通过胶囊菜单 + 弹层展开，由 `branch-overview-cache.ts` 做 stale-while-revalidate 加速。

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Harness slots (src/client/index.tsx:92 apply)                          │
│  conversation.session.header.actions  conversation.input.dock           │
└───────┬──────────────────────────┬───────────────────────┬────────────┘
        │ register                 │ register             │ register
        ▼                          ▼                      ▼
┌──────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
│ TargetStatusAction│  │ WorktreeReviewStatus │  │ WorktreeHeroChip     │
│ (header capsule)  │  │ (review dock bar)    │  │ (blank hero portal)  │
│ (TargetStatusAction│  │ (WorktreeReviewStatus│  │ (WorktreeHeroChip.tsx│
│   .tsx:51)        │  │   .tsx:25)           │  │   :84)               │
└────────┬─────────┘  └──────────┬───────────┘  └──────────┬───────────┘
         │ subscribeCurrent      │ subscribeCurrent       │ portal→TargetStatusAction
         ▼                       ▼                        │
┌──────────────────────────────────────────┐              │
│ current-polling.ts: subscribeCurrent      │◄─────────────┘
│   Poll: adapter.current() 5s / 60s hidden │
│   WeakMap<adapter, Map<session+lang,Poll>> │
└───────────────────────┬──────────────────┘
       refresh event     │  (WORKTREE_REVIEW_REFRESH_EVENT)
                         ▼
┌──────────────────────────────────────────┐   ┌────────────────────────┐
│ TargetStatusAction menu (TargetStatusAction│   │ WorktreeManagerModal   │
│   .tsx:494 items)                          │   │  (WorktreeManagerModal│
│  branch / create / prune / tags / graph /  │   │   .tsx:18)             │
│  manager / discard / initialize            │   │      │                 │
└───┬──────────┬───────────┬─────────────────┘   │      ▼                 │
    ▼          ▼           ▼                      │  WorktreeConsoleView  │
┌─────────┐ ┌───────────┐ ┌──────────────────┐    │   (WorktreeConsoleView │
│ Branch- │ │ TagManager│ │ BranchGraphModal  │    │    .tsx:93)           │
│ Graph-  │ │ Modal     │ │  gitGraph +       │    └────────────────────────┘
│ Modal   │ │ (TagManagerModal.tsx:26)        │
│ +cache  │ │ gitList/  │ │  computeGraphLanes│
│ (branch │ │ Create/   │ │  (BranchGraphModal │
│ -overvi-│ │ Delete/   │ │   .tsx:66)         │
│ ew-cache│ │ PushTag   │ └──────────────────┘
│ .tsx)   │ └───────────┘
└────┬────┘
     ▼
branch-overview-cache.ts (TTL 60s, single-flight, epoch-guarded)
  gitOverview  cachedBranchOverview / ensure / refresh / patch / invalidate
```

关键隔离边界：

- **适配器实例隔离**：`clients` 用 `WeakMap` 按 `adapter` 分桶（`current-polling.ts:7`），不同插件 fiber 的轮询互不串。
- **会话 + 语言隔离**：同一适配器下，key = `[sessionId, language]`（`current-polling.ts:99`），中文/英文结果分别缓存（测试 `tests/current-polling.test.ts:101`）。
- **epoch 守卫**：`branch-overview-cache.ts` 用 `patchEpochs`（`branch-overview-cache.ts:21`）防止「起飞于 patch 之前的 gitOverview 飞行」覆盖乐观补丁（`tests/client-branch-overview-cache.test.ts:31`）。
- **防旧响应**：`WorktreeConsoleView` 用 `sessionGeneration`+`request` token（`WorktreeConsoleView.tsx:105`–`107`、`142`），`TargetStatusAction` 用 `actionScope`（`TargetStatusAction.tsx:81`），`TagManagerModal` 用 `requestSeq`（`TagManagerModal.tsx:37`），三者机制同源但各自独立。

## Data Flow

## Connections

## Known Issues
