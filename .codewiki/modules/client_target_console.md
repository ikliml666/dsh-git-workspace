

## Overview

`client_target_console` 是「目标控制台」的浏览器端（Harness-native）实现，全部代码位于 `src/client/target-console/`。它把 `WorktreeConsoleAdapter`（`src/console-contract.ts:745` 定义的归一化客户端接缝）暴露成几类 UI 贡献点，并通过 `registerTargetConsole`（`src/client/target-console/index.ts:19`）注入到 Harness 的会话槽位里：

- **Header 胶囊** `TargetStatusAction`（`TargetStatusAction.tsx:51`）—— 会话头部一个只读的「Session Target」胶囊，展示当前分支/状态，点击展开管理菜单（切换分支、新建/剪枝分支、管理标签、提交图、打开工作位置、返回来源、开始下一轮迭代、回退到 Local、放弃并清理、重试清理），以及对非 Git 项目的 `git init` 入口。
- **Hero 胶囊** `WorktreeHeroChip`（`WorktreeHeroChip.tsx:84`）—— 在空会话（blank conversation）时把一个 `TargetStatusAction` 通过 portal 塞进 Harness 的 hero workspace row。
- **输入坞状态条** `WorktreeReviewStatus`（`WorktreeReviewStatus.tsx:25`）—— 在 `conversation.input.dock` 里渲染 Domi 风格的「待验收 / 预览中 / 已交付」紧凑状态条，复用 `review-console` 的 `ReviewActions` / `ReviewDetailsModal`。
- **管理面板** `WorktreeConsoleView`（`WorktreeConsoleView.tsx:93`）—— 完整的「关联 Worktrees」管理面（当前目标 + 逻辑链接列表 + 放弃快照恢复条），既可作为独立面板，也可被 `WorktreeManagerModal`（`WorktreeManagerModal.tsx:18`）以 `embedded` 模式包成对话框。

另有两个支撑模块：

- `current-polling.ts` —— 全局共享的 `current` 轮询循环（`subscribeCurrent`），只用于展示，绝不用于授权变更或 Git 清理。
- `branch-overview-cache.ts` —— 模块级分支总览缓存，stale-while-revalidate，支撑胶囊 popover 的即时展开。

状态投影（local / creating / working / ready_for_review / preview_active / preview_detached / retained / cleanup_pending / recovery_required / delivered / discarded）由 Host 端通过 `adapter.current` / `adapter.list` 直接给出，契约层的纯函数 `consoleStateFromDomain`（`src/console-contract.ts:76`）与 `worktreeReachedDelivery`（`src/console-contract.ts:64`）定义投影规则但属于 Host；客户端只负责渲染这些已经投影好的 `state` 字段（见 `WorktreeConsoleView.tsx:67` 的 `TargetState` 与 `TargetStatusAction.tsx:32` 的 `STATE_LABELS`）。

## Key Components

### `src/client/target-console/index.ts`

- `TargetConsoleContextLike` 接口（`index.ts:8`–`16`）：编队接缝，含 `slots.inject`（注入 `conversation.session.header.actions` 或 `conversation.input.dock` 槽位）与 `slots.register`（登记一个组件）。
- `registerTargetConsole(ctx, adapter, services)`（`index.ts:19`–`46`）：登记三处贡献点——`HeaderAction`（header.actions，id `worktree-target`）、`ReviewStatus`（input.dock，id `worktree-review-status`）、`HeroChip`（input.dock，id `worktree-hero-chip`）。每个都包装成 `createElement` 调用，把 `adapter` / `services` 透传进对应组件。
- 重导出（`index.ts:48`–`52`）：`TargetStatusAction`、`WorktreeConsoleView`、`WorktreeHeroChip`、`WorktreeManagerModal`、`WorktreeReviewStatus`。

### `src/client/target-console/current-polling.ts`

展示用的 `current` 轮询，绝不作为变更/Git 清理的授权依据（注释见 `current-polling.ts:21`）。

- 模块常量 `DELAY = 5_000`（`current-polling.ts:8`）与 `HIDDEN_DELAY = 60_000`（`current-polling.ts:15`）：隐藏标签页把轮询间隔从 5s 拉长到 60s（隐藏窗口无法显示胶囊，却仍要付出 `git status` + 两次 `git rev-parse` 的开销，注释见 `current-polling.ts:9`–`15`）。
- `clients`：`WeakMap<adapter, Map<sessionKey, Poll>>`（`current-polling.ts:7`），按 adapter 实例隔离；key 为 `JSON.stringify([sessionId, language])`（`current-polling.ts:99`）。
- `isHidden()`（`current-polling.ts:17`–`19`）：读取 `document.visibilityState`。
- class `Poll`（`current-polling.ts:22`–`91`）：
  - 字段：`listeners`（`current-polling.ts:23`）、`timer`（`current-polling.ts:24`）、`running`（`current-polling.ts:25`）、`dirty`（`current-polling.ts:26`）、`generation`（`current-polling.ts:27`）、`last`（`current-polling.ts:28`）。
  - 构造器 `constructor(adapter, sessionId, release)`（`current-polling.ts:30`）。
  - `onRefresh`（`current-polling.ts:32`–`34`）：监听 `WORKTREE_REVIEW_REFRESH_EVENT`，仅当 `detail.sessionId === this.sessionId` 时 `invalidate()`。
  - `onVisibility`（`current-polling.ts:37`–`39`）：visibilitychange 回到可见时 `invalidate()`。
  - `subscribe(listener)`（`current-polling.ts:41`–`64`）：首个订阅者启动监听并 `invalidate`；后续订阅者立即收到 `last`（若有）；退订时若无人则 `clearTimeout` 并 `release()`。
  - `invalidate()`（`current-polling.ts:66`–`72`）：自增 generation、清空 `last`、置 `dirty`、未运行则 `run()`。
  - `run()`（`current-polling.ts:74`–`91`）：执行一次 `adapter.current({ sessionId })`，按 generation 决定结果是否回放；结束后若隐藏用 `HIDDEN_DELAY`、否则 `DELAY` 安排下一次 `setTimeout`。
- `subscribeCurrent(adapter, sessionId, language, listener)`（`current-polling.ts:94`–`107`）：取/建 `Poll` 并返回 `poll.subscribe(listener)`；不同 session、language、adapter 实例各自独立（测试见 `current-polling.test.ts:101`）。

### `src/client/target-console/branch-overview-cache.ts`

模块级分支总览缓存，避免 popover 展开等待 git spawn（注释见 `branch-overview-cache.ts:6`–`16`）。keyed by sessionId，repo-wide。

- 常量 `TTL_MS = 60_000`（`branch-overview-cache.ts:17`）。
- 模块映射：`cache`（`branch-overview-cache.ts:19`）、`flights`（`branch-overview-cache.ts:20`）、`patchEpochs`（`branch-overview-cache.ts:21`）。
- `bumpEpoch(sessionId)`（`branch-overview-cache.ts:23`–`25`）：epoch 自增。
- `cachedBranchOverview(sessionId)`（`branch-overview-cache.ts:27`–`29`）：同步读取缓存值。
- `isFresh(entry)`（`branch-overview-cache.ts:31`–`33`）：是否仍在 TTL 内。
- `invalidateBranchOverview(sessionId)`（`branch-overview-cache.ts:35`–`38`）：bump epoch + 删除缓存。
- `patchBranchOverview(sessionId, patch)`（`branch-overview-cache.ts:40`–`46`）：mutation（switch/create）后乐观补丁，bump epoch 并就地改写缓存 `fetchedAt`（不刷新 TTL）。
- `fetchOverview(adapter, sessionId)`（`branch-overview-cache.ts:48`–`73`）：发起 `adapter.gitOverview`；用 `patchEpochs` 纪元防止飞行中结果踩掉已落地的乐观补丁或失效后的空槽；失败（`!ok` 或 catch）仅在纪元未变时删除缓存槽（避免展示陈旧快照，`branch-overview-cache.ts:56`–`69`）。
- `ensureBranchOverview(adapter, sessionId)`（`branch-overview-cache.ts:80`–`84`）：TTL 内同步返回，否则 await 一次 fetch。
- `refreshBranchOverviewInBackground(adapter, sessionId)`（`branch-overview-cache.ts:87`–`92`）：stale-while-revalidate，返回缓存值（即使陈旧）并在后台刷新。

### `src/client/target-console/WorktreeConsoleView.tsx`

完整的关联 Worktree 管理面；可作为独立面板，也可被 `WorktreeManagerModal` 以 `embedded` 包裹。

- `WorktreeConsoleViewProps`（`WorktreeConsoleView.tsx:23`–`30`）：`embedded?`、`sessionId`、`adapter`、`services`、`focusCheckoutId?`、`onTargetChange?`。
- `STATE_LABELS`（`WorktreeConsoleView.tsx:32`–`44`）：state → i18n 文案。
- `ConsoleSnapshot`（`WorktreeConsoleView.tsx:46`–`50`）：`{ sessionId, current, list }`。
- `errorText(error, t)`（`WorktreeConsoleView.tsx:52`–`59`）：用 `worktreeConsoleErrorMeta`（`src/console-contract.ts:740`）取 category/recovery 拼文案。
- `retentionLabel(retention, t)`（`WorktreeConsoleView.tsx:61`–`65`）：保留期文案。
- `TargetState({ target })`（`WorktreeConsoleView.tsx:67`–`76`）：渲染带颜色点的状态徽章。
- `ATTENTION_RANK`（`WorktreeConsoleView.tsx:78`–`90`）：列表排序的关注度权重。
- 组件 `WorktreeConsoleView`（`WorktreeConsoleView.tsx:93`–`700`）关键回调（均受 `sessionGeneration`/`request` 代次保护，避免跨会话注入）：
  - `refresh(clearError)`（`WorktreeConsoleView.tsx:145`–`176`）：`Promise.all` 拉 `adapter.current` + `adapter.list`（按 `needsAttentionOnly`/`includeDelivered` 加参）+ 可选 `adapter.listAbandoned`，写入 `snapshot`/`abandoned`；`listAbandoned` 缺失时跳过且不影响主面板（`WorktreeConsoleView.tsx:155`）。
  - `refreshAbandoned()`（`WorktreeConsoleView.tsx:179`–`190`）：仅轻量重拉恢复条。
  - `applyMutation(response, generation)`（`WorktreeConsoleView.tsx:197`–`215`）：把 mutation 结果并入 `snapshot` 的 `current` 与 `list.worktrees`。
  - `mutationError(code, message, generation)`（`WorktreeConsoleView.tsx:217`–`223`）：展示错误；`stale_*` 类错误触发 `refresh(false)`。
  - `loadBranches()`（`WorktreeConsoleView.tsx:225`–`234`）：`focus` 时调 `adapter.preflightCreate` 取已知分支。
  - `createTarget()`（`WorktreeConsoleView.tsx:236`–`291`）：调 `adapter.create`，做来源/身份校验后 `openIsolatedTarget`（`src/client/actions.ts`），并把新建目标并入 `snapshot.list`。
  - `discardTarget(target, confirmDirty)`（`WorktreeConsoleView.tsx:293`–`319`）：`adapter.discard`，preview_active 或 `rollbackPreview` 时带 `rollbackPreview: true`。
  - `retryCleanup(target)`（`WorktreeConsoleView.tsx:321`–`344`）：`adapter.retryCleanup`。
  - `setPermanentFlag(target, permanent)`（`WorktreeConsoleView.tsx:346`–`369`）：`adapter.setPermanent`。
  - `setRetentionMode(target, retention)`（`WorktreeConsoleView.tsx:371`–`389`）：`adapter.setRetention`。
  - `restoreAbandonedSnapshot(row)`（`WorktreeConsoleView.tsx:391`–`412`）：`adapter.restoreAbandoned`，成功后 `invalidateBranchOverview(sessionId)` + `refresh(false)` + 提示。
  - `openListedTarget(target)`（`WorktreeConsoleView.tsx:414`–`437`）：`openAuthorizedWorktreeTarget`（`src/client/actions.ts`）。
  - `orderedWorktrees`（`WorktreeConsoleView.tsx:439`–`447`）：按 `focusCheckoutId` + `ATTENTION_RANK` + `iteration` 排序。

### `src/client/target-console/TargetStatusAction.tsx`

Header 胶囊 + 管理菜单 + 各类对话框。

- `TargetStatusActionProps`（`TargetStatusAction.tsx:26`–`30`）。
- `STATE_LABELS`（`TargetStatusAction.tsx:32`–`44`）。
- `shortOid(value)`（`TargetStatusAction.tsx:46`–`48`）：`unversioned` 原样，否则取前 7 位。
- 组件 `TargetStatusAction`（`TargetStatusAction.tsx:51`–`764`）关键回调：
  - `refresh()`（`TargetStatusAction.tsx:94`–`96`）：`requestWorktreeReviewRefresh`（`src/client/review-console/status-events.ts:4`）。
  - 挂载即 `subscribeCurrent`（副作用 `TargetStatusAction.tsx:98`–`138`）：把 `current` 结果写入 `target`，失败区分 `client_error` / 契约 `code` / `not_git_repository`（胶囊显示专用灰态而非「不可用」，注释见 `TargetStatusAction.tsx:144`–`149`）。
  - `reveal()`（`TargetStatusAction.tsx:170`–`176`）：`services.workspaces.openPath(target.managedRoot)`。
  - `openSource()`（`TargetStatusAction.tsx:178`–`184`）：`openExistingSession`（`src/client/actions.ts`）跳回来源会话。
  - `switchBranch(branch)`（`TargetStatusAction.tsx:186`–`224`）：`adapter.gitSwitchBranch` + `patchBranchOverview` + 读回缓存 + `switchNotice` 900ms + `requestWorktreeReviewRefresh`。
  - `createBranch()`（`TargetStatusAction.tsx:226`–`255`）：`branchNameSchema`（`src/console-remote/schemas.ts`）校验后 `adapter.gitCreateBranch`，再 `invalidateBranchOverview` + `ensureBranchOverview`。
  - `initializeRepository()`（`TargetStatusAction.tsx:257`–`285`）：仅当 `adapter.initializeProject` 是函数时调用，之后 `requestWorktreeReviewRefresh` + `invalidateBranchOverview`。
  - `openPrunePreview()` / `confirmPrune()`（`TargetStatusAction.tsx:287`–`310`、`312`–`337`）：`adapter.gitPruneMergedBranches(dryRun=true/false)`。
  - `retryCleanup()` / `beginNextIteration()` / `returnToLocal()` / `discard()`（`TargetStatusAction.tsx:339`–`453`）：各自调对应 adapter，并用 `requestWorktreeReviewRefresh` 通知其它面板。
  - 菜单渲染（`TargetStatusAction.tsx:494`–`554`）：非 Git 项目只列「初始化 Git 仓库」；否则列分支（>12 条显示搜索框，`MAX_BRANCH_ITEMS = 12`，`TargetStatusAction.tsx:471`）、新建/剪枝分支、管理标签、提交图、打开位置、返回来源、开始下一轮、回退 Local、管理关联 Worktrees。
  - 渲染（`TargetStatusAction.tsx:561`–`763`）：`Menu` 胶囊、`WorktreeManagerModal`、`cleanupConfirm`/`initialize`/`graph`/`tags`/`create`/`prune` 等 `Modal`。锚点按钮首次展开时 stale-while-revalidate 拉 `gitOverview`（`TargetStatusAction.tsx:595`–`612`）。

### `src/client/target-console/WorktreeHeroChip.tsx`

- `PortalRenderer` 类型（`WorktreeHeroChip.tsx:6`），`cachedPortalRenderer`（`WorktreeHeroChip.tsx:8`）。
- `resolvePortalRenderer()`（`WorktreeHeroChip.tsx:10`–`29`）：延迟 `require('react-dom')` 解析 `createPortal`，失败降级为 `null`（无 hero chip 也不崩）。
- `isHeroRow(element)`（`WorktreeHeroChip.tsx:31`–`36`）：判定 `heroWorkspaceRow` 类。
- `findHeroRowFrom(anchor)`（`WorktreeHeroChip.tsx:44`–`69`）：从 dock 锚点结构定位 hero row（先 sibling/祖先，再 `composerStack` 查询，最后全局 `document.querySelector`），注释见 `WorktreeHeroChip.tsx:38`–`43`。
- `WorktreeHeroChipProps`（`WorktreeHeroChip.tsx:71`–`76`）。
- 组件 `WorktreeHeroChip`（`WorktreeHeroChip.tsx:84`–`142`）：`MutationObserver` + 500ms / 最多 8 次的兜底轮询（`WorktreeHeroChip.tsx:111`–`124`）定位 hero row 后，把 `TargetStatusAction` portal 进去；`session.blank === false` 时不渲染（`WorktreeHeroChip.tsx:131`）。

### `src/client/target-console/WorktreeManagerModal.tsx`

- `WorktreeManagerModalProps`（`WorktreeManagerModal.tsx:7`–`15`）。
- 组件 `WorktreeManagerModal`（`WorktreeManagerModal.tsx:18`–`49`）：以 `Modal` 包裹 `<WorktreeConsoleView embedded ... />`，把 `onTargetChange` 转成 `requestWorktreeReviewRefresh`（`WorktreeManagerModal.tsx:631`–`633`）。

### `src/client/target-console/WorktreeReviewStatus.tsx`

- `WorktreeReviewStatusProps`（`WorktreeReviewStatus.tsx:18`–`22`）。
- 组件 `WorktreeReviewStatus`（`WorktreeReviewStatus.tsx:25`–`184`）：
  - 挂载 `subscribeCurrent`（`WorktreeReviewStatus.tsx:57`–`73`）与 `restoreWorktreeRecovery`（`WorktreeReviewStatus.tsx:52`–`54`）。
  - 独立恢复条（`standaloneRecovery`，`WorktreeReviewStatus.tsx:75`–`99`）：复用 `recovery-continuation` 的 `useWorktreeRecoverySnapshot` / `retryWorktreeRecovery`。
  - 主状态条（`WorktreeReviewStatus.tsx:102`–`183`）：仅在目标处于 review 相关 state 且 `target.review` 存在时渲染；用 `review-console` 的 `reviewEvidenceFromTarget` / `reviewIdentityFromTarget` 取 review，交给 `ReviewActions`（`proofVariant="compact"`）；`cleanup_pending`/`retained` 终态可 `dismissed`（`WorktreeReviewStatus.tsx:173`–`181`）。

### `src/client/target-console/BranchGraphModal.tsx`

- `GraphEdge`（`BranchGraphModal.tsx:10`–`16`）、`GraphRowLanes`（`BranchGraphModal.tsx:18`–`23`）、`GraphRefBadge`（`BranchGraphModal.tsx:25`–`32`）。
- `mergeRefs(refs)`（`BranchGraphModal.tsx:39`–`57`）：合并同短名的本地+远程 ref 成一个徽章；`tag:` 前缀标记 tag 且与同名的 branch 不合并。
- `computeGraphLanes(rows)`（`BranchGraphModal.tsx:66`–`127`）：把 `git log --topo-order` 行转成 SVG lane 边几何（移植自 `@linxin666/dsh-client-ui-git-graph` 的 `computeLanes`，注释见 `BranchGraphModal.tsx:59`–`65`）；回收空闲 lane 让 lane 数跟随并发分支而非总量。
- 常量 `LANE_COLORS`/`LANE_WIDTH`/`ROW_HEIGHT`/`NODE_RADIUS`/`INITIAL_LIMIT=200`/`PAGE_STEP=100`（`BranchGraphModal.tsx:129`–`134`）。
- `formatTime(epochSeconds, t)`（`BranchGraphModal.tsx:136`–`145`）：相对时间。
- `BranchGraphModalProps`（`BranchGraphModal.tsx:147`–`158`）：`open`、`onClose`、`adapter`、`sessionId`、`t`、`currentBranch`、`onTagCommit?`、`onManageTags?`。
- `laneX(column)`（`BranchGraphModal.tsx:160`–`162`）、`edgePath(edge)`（`BranchGraphModal.tsx:164`–`172`）：SVG 路径生成。
- 组件 `BranchGraphModal`（`BranchGraphModal.tsx:175`–`311`）：`adapter.gitGraph(sessionId, limit)` 拉提交，分页 `PAGE_STEP`；渲染 SVG lane + 引用徽章 + 标签动作按钮（`BranchGraphModal.tsx:293`–`302`）。

### `src/client/target-console/TagManagerModal.tsx`

- `TagManagerModalProps`（`TagManagerModal.tsx:9`–`17`）：含 `target?`（提交/ref，默认 HEAD）。
- `BusyAction = 'create' | 'delete' | 'push' | null`（`TagManagerModal.tsx:19`）。
- 组件 `TagManagerModal`（`TagManagerModal.tsx:26`–`263`）：
  - `load()`（`TagManagerModal.tsx:39`–`53`）：`adapter.gitListTags`；不清除 `error`（避免创建成功但推送失败的消息被覆盖，注释见 `TagManagerModal.tsx:42`–`44`）。
  - `createTag()`（`TagManagerModal.tsx:70`–`100`）：`adapter.gitCreateTag`；`pushed === false` 视为「本地成功、仅推送失败」并保留标签。
  - `deleteTag()`（`TagManagerModal.tsx:102`–`120`）、`pushTag()`（`TagManagerModal.tsx:122`–`142`）：每次变更后 `load()` 重读列表。

### `src/client/target-console/target-console.styles.ts`

- `TARGET_CONSOLE_STYLES`（`target-console.styles.ts:1`–`225`）：以 `String.raw` 写成的 CSS 变量 + 规则，含胶囊状态色（`data-target-state` 各档，`target-console.styles.ts:44`–`54`）、`not_git_repository` 中性灰（`target-console.styles.ts:52`）、console 面板、`dsh-wtc-graph-*` 提交图样式、`dsh-wtc-tag-*` 标签样式等。

## Architecture

```text
registerTargetConsole (index.ts:19)
   │ 注入三个 Harness 槽位
   ├── conversation.session.header.actions ──► HeaderAction ──► TargetStatusAction (TargetStatusAction.tsx:51)
   ├── conversation.input.dock ─────────────► HeroChip ──────► WorktreeHeroChip (WorktreeHeroChip.tsx:84)
   │                                            └─portal──► TargetStatusAction
   └── conversation.input.dock ─────────────► ReviewStatus ──► WorktreeReviewStatus (WorktreeReviewStatus.tsx:25)
                                                └─► ReviewActions / ReviewDetailsModal (review-console)

TargetStatusAction 展开的对话框：
   BranchGraphModal (BranchGraphModal.tsx:175) ─┐
   TagManagerModal  (TagManagerModal.tsx:26)  ─┤
   WorktreeManagerModal (WorktreeManagerModal.tsx:18)         │
      └─ embedded ► WorktreeConsoleView (WorktreeConsoleView.tsx:93)

所有面板都经由统一的轮询/缓存与适配器访问 Host：
   subscribeCurrent (current-polling.ts:94) ──► Poll (current-polling.ts:22) ──► adapter.current
   branch-overview-cache (branch-overview-cache.ts) ◄── adapter.gitOverview
   WorktreeConsoleView / TargetStatusAction ───────► WorktreeConsoleAdapter (console-contract.ts:745)
```

## Data Flow

1. **当前目标探测（展示用）**：任意面板挂载时调用 `subscribeCurrent`（`current-polling.ts:94`）；`Poll.run` 调 `adapter.current({ sessionId })`（`current-polling.ts:80`），结果（成功/契约错误/传输异常）通过 `listener` 回放。首个订阅者启动 `WORKTREE_REVIEW_REFRESH_EVENT` 与 `visibilitychange` 监听（`current-polling.ts:46`–`47`）；事件或可见性变化触发 `invalidate()`（`current-polling.ts:66`）立即重拉。默认 5s 轮询（`DELAY`，`current-polling.ts:8`），隐藏标签页拉长到 60s（`HIDDEN_DELAY`，`current-polling.ts:15`）。代次（`generation`，`current-polling.ts:27`）保证陈旧 flight 不会回放给新的挂载。

2. **管理面列表拉取**：`WorktreeConsoleView.refresh`（`WorktreeConsoleView.tsx:145`）并行 `adapter.current` + `adapter.list`（可选 `needsAttention`/`includeDelivered`）+ 可选 `adapter.listAbandoned`。`listAbandoned` 缺失时整段跳过且不影响主面板（增强功能，注释见 `WorktreeConsoleView.tsx:167`）。结果写入 `snapshot`，mutation 后由 `applyMutation`（`WorktreeConsoleView.tsx:197`）并入。

3. **分支总览缓存（SWR）**：胶囊首次展开 popover 时调 `refreshBranchOverviewInBackground`，有缓存立即渲染、否则 `ensureBranchOverview`（`TargetStatusAction.tsx:604`–`611`）。switch/create/prune 类 mutation 后走 `patchBranchOverview`/`invalidateBranchOverview` + 重取（如 `TargetStatusAction.tsx:200`、`:246`、`:329`）。`patchEpochs` 纪元（`branch-overview-cache.ts:21`）确保飞行中的旧 fetch 不会踩掉已落地的乐观补丁或失效后的空槽（`branch-overview-cache.test.ts:31`、`:57`、`:116`）。

4. **提交图**：`BranchGraphModal.load`（`BranchGraphModal.tsx:183`）调 `adapter.gitGraph(sessionId, limit)`，分页 `limit += PAGE_STEP`（`BranchGraphModal.tsx:231`）；`computeGraphLanes`（`BranchGraphModal.tsx:66`）把 `git log` 行转成 lane 几何，行内 `mergeRefs`（`BranchGraphModal.tsx:280`）合并引用徽章。

5. **跨面板刷新**：任何 owner 生命周期变更（discard / retryCleanup / switchBranch / initialize 等）后都会 `requestWorktreeReviewRefresh(sessionId)`（`TargetStatusAction.tsx:218`、`:279`、`:363` 等），经 `WORKTREE_REVIEW_REFRESH_EVENT`（`src/client/review-console/status-events.ts:1`）触发所有已挂载面板的 `subscribeCurrent` 重拉，同步胶囊、dock、manager 三处状态。

## Connections

- 统一适配器接缝 `WorktreeConsoleAdapter` 定义在 [[console-contract]]（`src/console-contract.ts:745`），全部 DTO 类型（`WorktreeConsoleTargetDetails`、`WorktreeConsoleTargetSummary`、`WorktreeConsoleGitOverviewResponse`、`WorktreeConsoleGitGraphCommit`、`WorktreeConsoleGitTag` 等）也在此。投影纯函数 `consoleStateFromDomain`（`src/console-contract.ts:76`）/`worktreeReachedDelivery`（`src/console-contract.ts:64`）描述 Host 端状态投影规则。
- 会话/工作区运行时由 [[client-actions]] 提供：`openAuthorizedWorktreeTarget`、`openIsolatedTarget`（createTarget/openListedTarget）、`openExistingSession`（openSource）。`WorktreeClientServices` 接口亦在此。
- 会话切换/恢复通知来自 [[review-console]]：`requestWorktreeReviewRefresh` / `WORKTREE_REVIEW_REFRESH_EVENT`（`src/client/review-console/status-events.ts`）、`ReviewActions`/`ReviewDetailsModal`/`reviewEvidenceFromTarget`/`reviewIdentityFromTarget`（dock 渲染）、`recovery-continuation`（`useWorktreeRecoverySnapshot`/`retryWorktreeRecovery`）、`preflight-cache`（`useReviewPreflight`）。
- i18n 文案与 `ClientTranslator` 来自 [[client-i18n]]（`src/client/i18n.tsx`）。
- 分支名校验 `branchNameSchema` 来自 [[console-remote]]（`src/console-remote/schemas.ts`）。
- 会话/项目目录聚合可视化可参见 [[workspace-sidebar]]（同属目标控制台生态的相邻模块）。

## Known Issues

- **恢复条是可选增强**：`adapter.listAbandoned` / `adapter.restoreAbandoned` 在契约里为可选方法（`src/console-contract.ts:782`–`783`）；缺失时 `WorktreeConsoleView` 直接跳过恢复条且不报错（`WorktreeConsoleView.tsx:155`、`:180`），恢复条失败也只置空隐藏（`WorktreeConsoleView.tsx:168`、`:188`）。
- **非 Git 项目专用路径**：`not_git_repository` 错误码在 `TargetStatusAction` 里被特判为中性灰态（`TargetStatusAction.tsx:149`–`155`），而非与真实探测失败混用「不可用」；其菜单只保留「初始化 Git 仓库」（`TargetStatusAction.tsx:494`）。注意契约 `consoleStateFromDomain` 并未枚举该态，它由客户端在 `current` 失败时本地合成（`TargetStatusAction.tsx:150`）。
- **Header 胶囊不预取 gitOverview**：胶囊为每个会话挂载，`gitOverview` 代价（3 次 git spawn）不预取，仅在首次展开 popover 时拉取（注释见 `TargetStatusAction.tsx:140`–`142`）。
- **Hero 芯片依赖 DOM 结构**：`WorktreeHeroChip` 通过 `MutationObserver` + 兜底 `setInterval`（500ms × 8 次，`WorktreeHeroChip.tsx:119`–`124`）定位 hero row，并对缺少 `react-dom` 的 shell 降级（`WorktreeHeroChip.tsx:10`–`29`）。结构不匹配时会无 hero chip。
- **跨会话结果丢弃**：`WorktreeConsoleView` 与 `TargetStatusAction` 都用 `sessionGeneration`/`request`（`WorktreeConsoleView.tsx:104`–`107`、`:142`）或 `actionScope`（`TargetStatusAction.tsx:81`–`86`）丢弃旧请求/旧 mutation 结果，避免把会话 A 的目标/Preview 注入会话 B（测试见 `client-target-console.test.tsx:520`、`:624`、`:649`）。
- **分支搜索上限 12**：popover 分支 >`MAX_BRANCH_ITEMS`(12) 才显示搜索框，否则「N more」占位（`TargetStatusAction.tsx:471`–`490`）；`showBranchSearch` 仅在 ≥12 时启用。
- **标签创建成功但推送失败**：`TagManagerModal` 把 `pushed === false` 当成「本地成功、推送失败」而非失败 mutation，保留标签并报告 `pushMessage`（`TagManagerModal.tsx:91`–`96`、`115`、`135`）。`pushed === null`（远端不可查）绝不误判为「未推送」，推送按钮保持可用（`TagManagerModal.tsx:203`、`client-target-console.test.tsx:353`）。
- **测试覆盖**：行为由 `tests/client-target-console.test.tsx`（槽位登记、状态投影、分支搜索/切换、标签增删推、跨会话丢弃）、`tests/current-polling.test.ts`（共享结果/5s 轮询/隐藏暂停/代次隔离）、`tests/client-branch-overview-cache.test.ts`（纪元保护、失效清槽）、`tests/branch-graph-lanes.test.ts`（`computeGraphLanes`/`mergeRefs`）共同保证。

---
title: client_target_console
type: module
source_files:
  - src/client/target-console/index.ts
  - src/client/target-console/branch-overview-cache.ts
  - src/client/target-console/current-polling.ts
  - src/client/target-console/WorktreeConsoleView.tsx
  - src/client/target-console/TargetStatusAction.tsx
  - src/client/target-console/WorktreeHeroChip.tsx
  - src/client/target-console/WorktreeReviewStatus.tsx
  - src/client/target-console/WorktreeManagerModal.tsx
  - src/client/target-console/BranchGraphModal.tsx
  - src/client/target-console/TagManagerModal.tsx
  - src/client/target-console/target-console.styles.ts
  - src/client/review-console/status-events.ts
  - tests/client-target-console.test.tsx
  - tests/client-branch-overview-cache.test.ts
  - tests/current-polling.test.ts
tags: [client, target-console, polling, branch-overview-cache, modals, review-dock]
---

## Overview

`client_target_console` 是 Harness-native Session Target 的前端模块，负责把 `WorktreeConsoleAdapter` 暴露的「源关联（source-linked）」Worktree 管理能力渲染成 UI，并注册进 Harness 的几处宿主插槽（session header、input dock）。它包含：

- 三个宿主胶囊/状态条组件：`TargetStatusAction`（session header 里的分支胶囊）、`WorktreeHeroChip`（空白会话的 hero row 占位）、`WorktreeReviewStatus`（input dock 里紧凑的验收状态条）。
- 一个完整的「关联 Worktrees」管理面板 `WorktreeConsoleView`，及其弹层壳 `WorktreeManagerModal`。
- 三个交互式弹层：`BranchGraphModal`（提交图 + GitHub 风格泳道）、`TagManagerModal`（标签增删推）、以及组合在 `TargetStatusAction` 内的清理/初始化确认 `Modal`。
- 两个非 React 的纯状态模块：`branch-overview-cache.ts`（模块级分支总览缓存，stale-while-revalidate + 乐观补丁纪元保护）与 `current-polling.ts`（基于 `WorktreeConsoleAdapter.current` 的轮询订阅，去重、隐藏页暂停、刷新事件驱动）。
- 一组样式常量 `TARGET_CONSOLE_STYLES`（注入到 `dsh-wtc-*` CSS 类）。

模块通过 `registerTargetConsole`（`src/client/target-console/index.ts` 第 19-46 行）把三个组件注入到宿主插槽，所有 Mutation 都走 `WorktreeConsoleAdapter` 的 RPC 边界，组件本身不持有任何 Git 实现。

## Key Components

### `src/client/target-console/index.ts`

- `TargetConsoleContextLike`（interface，第 8-16 行）：宿主插槽抽象。`slots.inject(name, callback)` 把胶囊挂到 `conversation.session.header.actions` 或 `conversation.input.dock`；`slots.register(descriptor, component)` 注册一个具名插槽组件。
- `registerTargetConsole(ctx, adapter, services)`（函数，第 19-46 行）：把三个组件包装成 `createElement` 调用后注入插槽：
  - `conversation.session.header.actions` / `id:'worktree-target'` / `order:30` → `HeaderAction`（渲染 `TargetStatusAction`）。
  - `conversation.input.dock` / `id:'worktree-review-status'` / `order:10` → `ReviewStatus`（渲染 `WorktreeReviewStatus`）。
  - `conversation.input.dock` / `id:'worktree-hero-chip'` / `order:20` → `HeroChip`（渲染 `WorktreeHeroChip`）。
- 重新导出（第 48-53 行）：`TargetStatusAction`、`WorktreeConsoleView`、`WorktreeHeroChip`、`WorktreeManagerModal`、`WorktreeReviewStatus`。

### `src/client/target-console/branch-overview-cache.ts`

模块级分支总览缓存。注释（第 6-16 行）说明：展开胶囊 popover 不应等待 git spawn；按 session id 缓存，TTL 短暂，stale-while-revalidate；overview 是全仓库范围的，所以同一项目的多个 session 会覆盖同一个底层视图；`patchEpochs` 防止「patch/invalidate 之前起飞的 flight」回写缓存、踩掉乐观补丁。

- 常量：`TTL_MS = 60_000`（第 17 行）。
- 模块级状态（第 19-21 行）：
  - `cache: Map<sessionId, { value: WorktreeConsoleGitOverviewResponse; fetchedAt: number }>`。
  - `flights: Map<sessionId, Promise<… | null>>`（去重中的在途请求）。
  - `patchEpochs: Map<sessionId, number>`（每次 patch/invalidate 自增）。
- `bumpEpoch(sessionId)`（第 23-25 行）：`patchEpochs[sessionId] += 1`。
- `cachedBranchOverview(sessionId)`（第 27-29 行）：立即返回缓存值，无则 `null`。
- `isFresh(entry)`（第 31-33 行）：`Date.now() - fetchedAt < TTL_MS`。
- `invalidateBranchOverview(sessionId)`（第 35-38 行）：`bumpEpoch` + 删除缓存槽。
- `patchBranchOverview(sessionId, patch)`（第 41-46 行）：乐观本地补丁（switch/create 后 RPC 已确认）。仅当已有缓存时改写 `value`，并把 `fetchedAt` 保留；同时 `bumpEpoch`。
- `fetchOverview(adapter, sessionId)`（内部 async，第 48-73 行）：去重 flight；起飞时记录 `epoch`；`.then` 中仅在 `patchEpochs[sessionId] === epoch` 时才 `cache.set`（失败/`!ok`/reject 时也同样只在纪元未变时 `cache.delete`，避免踩掉飞行中落地的乐观补丁，见第 56-58、68 行注释）。
- `ensureBranchOverview(adapter, sessionId)`（第 80-84 行）：新鲜则立即返回缓存，否则 `fetchOverview` 并 await。
- `refreshBranchOverviewInBackground(adapter, sessionId)`（第 87-92 行）：stale-while-revalidate；返回缓存值（即使陈旧）并后台触发 `fetchOverview`（仅在非 fresh 且当前无 flight 时）。

### `src/client/target-console/current-polling.ts`

基于 `adapter.current` 的轮询订阅，`current-polling.ts` 第 1-108 行。注释（第 9-16 行）说明：隐藏窗口无法显示胶囊，但 host 端 `current` 仍要 `git status` + 两次 `git rev-parse`，因此隐藏标签页把循环停住，下次可见时立即恢复（`HIDDEN_DELAY = 60_000`）；普通轮询间隔 `DELAY = 5_000`。

- 类型：`Result = { outcome } | { error }`（第 5 行）、`Listener`（第 6 行）、`clients: WeakMap<adapter, Map<sessionId+language, Poll>>`（第 7 行）。
- `isHidden()`（第 17-19 行）：`typeof document !== 'undefined' && document.visibilityState === 'hidden'`。
- class `Poll`（第 22-91 行）：
  - 字段（第 23-28 行）：`listeners: Set<Listener>`、`timer`、`running`、`dirty`、`generation`、`last: Result | undefined`。
  - 构造函数（第 30 行）：`(adapter, sessionId, release)`。
  - `onRefresh`（第 32-34 行）：监听 `WORKTREE_REVIEW_REFRESH_EVENT`，`detail.sessionId === this.sessionId` 时 `invalidate()`。
  - `onVisibility`（第 37-39 行）：隐藏→可见时 `invalidate()`。
  - `subscribe(listener)`（第 41-64 行）：首个订阅者 `generation++`、挂监听、立即 `invalidate()`；后续订阅者直接收到 `last`（若有）。取消订阅时若还有监听者则保留；否则 `clearTimeout`、移除监听，若 `!running` 则 `release()`。
  - `invalidate()`（第 66-72 行）：`generation++`、`last=undefined`、清 timer、`dirty=true`，未运行则 `run()`。
  - `run()`（第 74-90 行）：调 `adapter.current({ sessionId })`，成功 `{outcome}` 失败 `{error}`；仅当 `generation === this.generation`（丢弃旧请求）且仍有监听者时广播；之后按需用 `setTimeout`（隐藏时用 `HIDDEN_DELAY`，否则 `DELAY`）再跑一次，或 `dirty` 立即重跑，最后无监听者则 `release()`。
- `subscribeCurrent(adapter, sessionId, language, listener)`（第 94-107 行）：Adapter 实例隔离 Client（WeakMap），`[sessionId, language]` JSON 序列化后隔离语言维度；创建/复用 `Poll`，返回 `poll.subscribe(listener)`。`release` 回调在该 `Poll` 仍存在时从 `sessions` Map 删除它。

### `src/client/target-console/WorktreeConsoleView.tsx`

关联 Worktrees 管理主面板（`embedded` 与否两种形态），`WorktreeConsoleView.tsx` 第 1-701 行。

- props 接口 `WorktreeConsoleViewProps`（第 23-30 行）：`embedded?`、`sessionId`、`adapter`、`services`、`focusCheckoutId?`、`onTargetChange?`。
- 常量：`STATE_LABELS`（第 32-44 行，状态→文案）、`ATTENTION_RANK`（第 78-90 行，按关注度排序的权重，`recovery_required:0` 最高、`discarded:10` 最低）、`ConsoleSnapshot`（第 46-50 行：`{sessionId, current, list}`）。
- 辅助函数：`errorText(error, t)`（第 52-59 行）、`retentionLabel(retention, t)`（第 61-65 行）、`TargetState`（子组件，第 67-76 行）。
- 主组件 `WorktreeConsoleView`（第 93-700 行）：
  - 状态与 ref（第 104-119 行）：`mounted`、`request`、`abandonedRequest`、`sessionGeneration`、若干 `useState`（`snapshot/abandoned/notice/loading/error/pendingAction/confirmTarget/createBranch/knownBranches/needsAttentionOnly/includeDelivered`）、`confirmButton`。
  - `useLayoutEffect`（第 123-126 行）：挂载置 `mounted.current=true`；第 128-140 行：`sessionId` 变化时 `sessionGeneration++`、重置所有状态、`setLoading(true)`。
  - `isActive(generation)`（第 142-143 行）：`mounted && sessionGeneration === generation`。
  - `refresh()`（第 145-176 行）：`Promise.all` 并行拉 `adapter.current` / `adapter.list`（带 `needsAttention`/`includeDelivered` 过滤）/ `adapter.listAbandoned`（可选）；按 `isActive` + `request` token 去重跨 session 注入；`current.ok`/`list.ok` 失败设 `error`；主面板加载失败时 `setAbandoned([])` 仅隐藏恢复条（增强功能，第 167-168 行）。
  - `refreshAbandoned()`（第 179-190 行）：轻量只拉恢复条。
  - `applyMutation(response, generation)`（第 197-215 行）：把 mutation 结果合并进 `snapshot.current`/`list.worktrees`；`onTargetChange?.()`。
  - `mutationError(code, message, generation)`（第 217-223 行）：`stale_target/stale_local/stale_isolated` 时 `refresh(false)`。
  - `loadBranches()`（第 225-234 行）：首次聚焦下拉时 `adapter.preflightCreate({sourceSessionId})` 取分支列表。
  - 各类 Mutation（第 236-437 行）：`createTarget`、`discardTarget`、`retryCleanup`、`setPermanentFlag`、`setRetentionMode`、`restoreAbandonedSnapshot`（`invalidateBranchOverview(sessionId)` 见第 404 行）、`openListedTarget`。每个都用 `pendingAction` 互斥、`generation` 守卫、`applyMutation`/`refresh` 收尾。
  - `orderedWorktrees`（第 439-447 行）：按 `focusCheckoutId` 优先、再 `ATTENTION_RANK`、再 `iteration` 倒序排序。
  - 渲染（第 449-699 行）：loading 态、header（刷新按钮）、`error`/`notice`、`current` 区块（含从分支创建下拉）、`list` 区块（过滤勾选 + 排序列表，每行含状态/事实/操作按钮：open/discard/setPermanent/retryCleanup）、`abandoned` 区块、`confirmTarget` 内联确认框（role=alertdialog，Esc 关闭，第 666-697 行）。

### `src/client/target-console/TargetStatusAction.tsx`

session header 里的交互式 Target 胶囊（分支胶囊 + popover + 多个弹层），第 1-765 行。

- props `TargetStatusActionProps`（第 26-30 行）：`sessionId`、`adapter`、`services`。
- 常量：`STATE_LABELS`（第 32-44 行）、`shortOid(value)`（第 46-48 行，`'unversioned'` 原样返回，否则取前 7 位）、`MAX_BRANCH_ITEMS = 12`（第 471 行）。
- 主组件 `TargetStatusAction`（第 51-764 行）：
  - 状态（第 55-80 行）：`target/loading/error/failure{code,message}/menuOpen/managerOpen/cleanupConfirmOpen/pendingAction/overview/graphOpen/createOpen/createName/createBusy/pruneOpen/prunePreview/pruneLoading/pruneBusy/branchQuery/switchNotice/tagsOpen/tagTarget/initializeOpen/initializeBusy`。
  - `actionScope`/`activeSession` ref（第 81-86 行）：sessionId 变化时 `actionScope++`，`active()` = `mounted && scope===actionScope`，用于在异步回调里区分旧 session/旧动作。
  - `useEffect`（第 98-138 行）：`subscribeCurrent(adapter, sessionId, language, ...)` 订阅；`error` 分支记 `failure`；`result.outcome.ok` 设 `target`；失败保留 `target=null`，并把 `code+message` 记到 `failure` 以便 tooltip 显示原因（第 129-135 行）。**首屏不预取分支总览**（第 140-142 行注释），避免每个 session 都白付 3 次 git spawn。
  - `notGitRepository` 派生状态（第 149 行）：`failure?.code === 'not_git_repository'`；普通文件夹返回此码，给中性灰色（第 44-52 行样式）而非红色「不可用」。
  - 各类动作（第 170-453 行）：`reveal`（打开 managedRoot）、`openSource`（回到来源 session）、`switchBranch`（`patchBranchOverview` 乐观补丁 + 读回 `cachedBranchOverview`，见第 200-208 行）、`createBranch`（`invalidateBranchOverview` + `ensureBranchOverview`）、`initializeRepository`、`openPrunePreview`/`confirmPrune`、`retryCleanup`、`beginNextIteration`、`returnToLocal`、`discard`（带 `cleanupConfirmOpen` 二次确认）。
  - 分支列表与菜单构建（第 455-559 行）：`summary`、`sortedBranches`/`matchedBranches`/`visibleBranches`（超过 12 条出现搜索框，第 486-490 行）、`items`（`not_git_repository` 时只留 `initialize`；否则分支列表 + 创建/修剪/标签/提交图/打开/来源/迭代/回到本地/管理 等条目）、`footer`（`retryCleanup` 或 `discard`）。
  - 渲染（第 561-763 行）：`Menu` 胶囊按钮（`refreshBranchOverviewInBackground` 先给陈旧值，否则 `ensureBranchOverview`，见第 604-611 行）、`WorktreeManagerModal`、`cleanupConfirm` Modal、`initializeRepository` Modal、`BranchGraphModal`、`TagManagerModal`、`createBranch` Modal、`prune` Modal（预览 `pruned`/`skipped` 列表）。

### `src/client/target-console/WorktreeHeroChip.tsx`

空白会话的 hero row 胶囊（`WorktreeHeroChip.tsx` 第 1-143 行）。

- `PortalRenderer` 类型（第 6 行）；`cachedPortalRenderer`（第 8 行，模块级单例）。
- `resolvePortalRenderer()`（第 10-29 行）：用 `require('react-dom')` 懒解析 `createPortal`，失败降级为 `null`（无 hero 胶囊）。
- `isHeroRow(element)`（第 31-36 行）：校验 `heroWorkspaceRow` 类名且 `isConnected`。
- `findHeroRowFrom(anchor)`（第 44-69 行）：从 dock anchor 的兄弟/祖先（`composerStack`/`composerHero`）结构定位 hero row，最后回退到 `document.querySelector`。
- props `WorktreeHeroChipProps`（第 71-76 行）：`session?`、`sessionId?`、`adapter`、`services`。
- 主组件 `WorktreeHeroChip`（第 84-142 行）：`targetSessionId = sessionId ?? session?.sessionId`；`useEffect`（第 88-129 行）用 `MutationObserver` + 有界 `setInterval`（4s、8 次）定位 hero row；`renderPortal` 把 `<TargetStatusAction>` 注入 hero row（仅当 `targetSessionId` 非空且 `session?.blank !== false`，第 131-140 行）。

### `src/client/target-console/WorktreeReviewStatus.tsx`

input dock 紧凑验收状态条（`WorktreeReviewStatus.tsx` 第 1-185 行）。

- props `WorktreeReviewStatusProps`（第 18-22 行）：`session`、`adapter`、`services`。
- 主组件 `WorktreeReviewStatus`（第 25-184 行）：
  - 状态（第 28-41 行）：`detailsOpen`、`dismissed{checkoutId,reviewId}`（按迭代作用域消除）、`target`、`error`、`recovery`（`useWorktreeRecoverySnapshot`）、`detailPreflight`（`useReviewPreflight`）、`sessionGeneration`/`currentSessionId` ref。
  - `useEffect`（第 52-54 行）：`restoreWorktreeRecovery`；第 57-73 行：`subscribeCurrent` 订阅，按 `checkoutId`+`revision` 守卫避免旧值覆盖；卸载时 `sessionGeneration++` + `stop()`。
  - `standaloneRecovery` 短路渲染（第 75-99 行）：独立的恢复续传状态条（`worktree_apply_conflict` / 只读恢复再生）。
  - 主分支（第 102-183 行）：仅当 `target.review` 存在且 state 在允许集合内才渲染；`reviewEvidenceFromTarget`/`reviewIdentityFromTarget` 取证据与身份；`terminalDock`（`cleanup_pending`/`retained`）支持 `dismissed` 消除；用 `ReviewActions` + `ReviewDetailsModal` 渲染操作与状态文案（`renderStatus` 提供摘要），`onTargetChange={applyTarget}` 合并增量。

### `src/client/target-console/WorktreeManagerModal.tsx`

`WorktreeConsoleView` 的弹层壳（`WorktreeManagerModal.tsx` 第 1-50 行）。

- props `WorktreeManagerModalProps`（第 7-15 行）：`open`、`sessionId`、`adapter`、`services`、`focusCheckoutId?`、`onClose`、`onTargetChange?`。
- 组件 `WorktreeManagerModal`（第 18-49 行）：用 `@deepseek-ai/dsh-client-ui-primitives` 的 `Modal`（`title`/`description`/`className:'dsh-wtc-manager-dialog'`/`contentClassName:'dsh-wtc-manager-content'`）包裹 `<WorktreeConsoleView embedded …>`，`onTargetChange` 触发 `requestWorktreeReviewRefresh(sessionId)`。

### `src/client/target-console/BranchGraphModal.tsx`

仓库级提交图弹层（GitHub 风格 SVG 泳道），`BranchGraphModal.tsx` 第 1-312 行。

- `GraphEdge`（第 10-16 行）：`{x1,y1,x2,y2,color}`（x 为泳道单位，y 为 0/0.5/1 行比例）。
- `GraphRowLanes`（第 18-23 行）：`{nodeColumn, laneCount, edges}`。
- `GraphRefBadge`（第 25-32 行）：`{label, full, tag}`。
- `mergeRefs(refs)`（第 39-57 行）：把本地+远程同名 ref（含 `tag:` 前缀标记）折叠成一个 badge，tag 不与同名 branch 折叠。
- `computeGraphLanes(rows)`（第 66-127 行）：从 `@linxin666/dsh-client-ui-git-graph` 的 `computeLanes` 移植的泳道拓扑，发射边几何而非逐行字形（首父保留泳道、其余父向右开新道、空道复用）。
- 常量（第 129-134 行）：`LANE_COLORS`（6 色）、`LANE_WIDTH=14`、`ROW_HEIGHT=36`、`NODE_RADIUS=4`、`INITIAL_LIMIT=200`、`PAGE_STEP=100`。
- `formatTime(epochSeconds, t)`（第 136-145 行）：相对时间格式化。
- props `BranchGraphModalProps`（第 147-158 行）：`open`、`onClose`、`adapter`、`sessionId`、`t`、`currentBranch`、`onTagCommit?`、`onManageTags?`。
- 组件 `BranchGraphModal`（第 175-311 行）：`load(limit)`（第 183-196 行，`adapter.gitGraph(sessionId, limit)` + `computeGraphLanes`，`requestSeq` 守卫）；`useEffect`（第 198-206 行）`open` 时加载、卸载 `requestSeq++`；分页「更多」（第 225-238 行）；每行渲染 oid、SVG 泳道（`edgePath`/`laneX`，第 160-172 行）、subject、refs（`mergeRefs`）、author、时间、打标签按钮（`onTagCommit`）。

### `src/client/target-console/TagManagerModal.tsx`

本地标签管理弹层（`TagManagerModal.tsx` 第 1-264 行）。

- `BusyAction = 'create' | 'delete' | 'push' | null`（第 19 行）。
- props `TagManagerModalProps`（第 9-17 行）：`open`、`onClose`、`adapter`、`sessionId`、`t`、`target?`（指向某 commit/ref；`null` 表示 HEAD）。
- 组件 `TagManagerModal`（第 26-263 行）：
  - `load()`（第 39-53 行）：`adapter.gitListTags`；**不清除 `error`**（第 42-44 行注释：本地创建成功但推送失败时通过 `error` 报出，重载不能抹掉）。`requestSeq` 守卫。
  - `useEffect`（第 55-68 行）：`open` 时重置并 `load()`，卸载 `requestSeq++`。
  - `createTag`（第 70-100 行）：`adapter.gitCreateTag({sessionId, name, message?, target?, push})`；`pushed===false` 时保留并已创建（报 `error`），否则提示成功；随后 `load()`。
  - `deleteTag`（第 102-120 行）：`adapter.gitDeleteTag({sessionId, name, remote})`；支持 `confirmDelete` + `deleteRemote` 二次确认（第 234-259 行）。
  - `pushTag`（第 122-142 行）：`adapter.gitPushTag({sessionId, name})`；拒绝式推送是「可报告结果」而非失败 mutation（第 135-138 行）。
  - 渲染（第 144-263 行）：创建表单（名称/说明/创建即推送勾选）、列表（`annotated`/`pushed`/`push-unknown` 徽章）、删除确认。

### `src/client/target-console/target-console.styles.ts`

- `TARGET_CONSOLE_STYLES`（第 1-226 行，`String.raw`）：所有 `dsh-wtc-*` 样式。要点：胶囊 `data-target-state` 配色（第 44-54 行；`not_git_repository` 中性灰、delivered/discarded 降透明）；管理面板卡片/行/筛选/确认框（第 57-159 行）；提交图 SVG 行（第 183-199 行）；标签弹层（第 200-215 行）；图谱行 hover 才显形的打标签按钮（第 216-224 行）。由宿主通过某种样式注入机制插入（被 `WorktreeConsoleView`/`index` 公共 bundle 消费）。

### `src/client/review-console/status-events.ts`

- `WORKTREE_REVIEW_REFRESH_EVENT = 'dsh-git-worktree:review-refresh'`（第 1 行）。
- `requestWorktreeReviewRefresh(sessionId)`（第 4-6 行）：派发 `CustomEvent`（detail 带 `sessionId`）；被 `current-polling.ts` 的 `Poll.onRefresh` 监听，也由 `TargetStatusAction`/`WorktreeReviewStatus`/`WorktreeManagerModal` 调用来通知所有挂载面重读 Host 权威 target。

## Architecture

```text
 Harness slots (registerTargetConsole, index.ts:19)
 ┌─────────────────────┐ ┌──────────────────────┐ ┌───────────────────────┐
 │ conversation.session │ │ conversation.input.dock│ │ conversation.input.dock│
 │ .header.actions      │ │ (worktree-review-     │ │ (worktree-hero-chip)  │
 │  id:worktree-target  │ │  status, order:10)   │ │  order:20             │
 └─────────┬───────────┘ └─────────┬────────────┘ └───────────┬───────────┘
           │                       │                          │
           ▼                       ▼                          ▼
 ┌──────────────────┐   ┌──────────────────────┐   ┌──────────────────────┐
 │ TargetStatusAction│   │ WorktreeReviewStatus │   │ WorktreeHeroChip     │
 │ (header capsule)  │   │ (input dock dock)    │   │ (portal into hero row│
 │  ├ Menu popover   │   │  └ ReviewActions +   │   │  → renders           │
 │  ├ WorktreeManager│   │    ReviewDetailsModal│   │    TargetStatusAction│
 │  │  Modal         │   └──────────────────────┘   └──────────────────────┘
 │  ├ BranchGraphModal│
 │  ├ TagManagerModal │   subscribeCurrent ──► Poll (current-polling.ts)
 │  └ cleanup/init    │        │ current({sessionId}) every 5s / hidden 60s
 │     Modals         │        │ listens WORKTREE_REVIEW_REFRESH_EVENT
 └─────────┬──────────┘        ▼
           │ refreshBranchOverviewInBackground / ensure / patch / invalidate
           ▼
 ┌──────────────────────────────────────────────┐
 │ branch-overview-cache.ts (module-level Map)   │
 │  cache / flights / patchEpochs  TTL=60s       │
 └──────────────────────────────────────────────┘
           │ gitOverview / gitGraph / gitSwitchBranch / gitCreateBranch /
           │ gitPruneMergedBranches / gitListTags / gitCreateTag / …
           ▼
              WorktreeConsoleAdapter (RPC seam, no Git impl here)
```

组件一律只通过 `WorktreeConsoleAdapter` 的 RPC 边界访问数据；UI 状态（轮询、缓存、弹层）全部留在客户端模块内。三个宿主插槽由 `registerTargetConsole` 一处注册，互不直接耦合——它们各自 `subscribeCurrent` 独立轮询、各自消费 `branch-overview-cache`。

## Data Flow

1. **轮询订阅（current）**
   - `TargetStatusAction`、`WorktreeReviewStatus`、`WorktreeHeroChip`（其内渲染的 `TargetStatusAction`）在挂载时都通过 `subscribeCurrent(adapter, sessionId, language, listener)`（`current-polling.ts` 第 94 行）订阅。
   - `Poll.run()`（第 74-90 行）调用 `adapter.current({ sessionId })`，`generation` 守卫丢弃过期回复；成功后 `setTimeout` 用 `DELAY=5_000`（可见）或 `HIDDEN_DELAY=60_000`（隐藏，`isHidden()` 第 17 行）再次轮询；隐藏标签直接暂停循环，可见时 `onVisibility` 立即 `invalidate()` 恢复。
   - 监听 `WORKTREE_REVIEW_REFRESH_EVENT`：`requestWorktreeReviewRefresh(sessionId)` 被任意挂载面调用时（如 `TargetStatusAction.refresh` 第 94-96 行、`onStale`、mutation 成功后），`Poll.onRefresh` 触发 `invalidate()`。

2. **分支总览缓存（branch-overview-cache）**
   - 首屏不预取（`TargetStatusAction` 第 140-142 行注释）；popover 首次展开时，胶囊 `onClick`（第 604-611 行）先 `refreshBranchOverviewInBackground`（陈旧即返回并后台刷新），否则 `ensureBranchOverview`（新鲜返回或 await 一次 `gitOverview`）。
   - 切换分支：`switchBranch`（第 186-224 行）乐观 `patchBranchOverview`（更新 `branch` 与 `branches.isCurrent`）后直接 `cachedBranchOverview` 读回，避免再 `invalidate+ensure`（4 次 git spawn + UI 闪回）。
   - 创建分支 / 修剪已合并分支后：`invalidateBranchOverview` + `ensureBranchOverview` 重新拉取（第 246-249、328-331 行）。
   - 纪元保护：`patchBranchOverview`/`invalidateBranchOverview` 都 `bumpEpoch`；`fetchOverview` 仅在 `patchEpochs[id]===epoch` 时回写/清除缓存（第 58、61、68 行），防止飞行中旧 flight 覆盖乐观补丁（见 `tests/client-branch-overview-cache.test.ts` 第 31-55、116-130 行）。

3. **管理面板与 Mutation**
   - `WorktreeConsoleView` 用 `Promise.all` 拉 `current`+`list`+`listAbandoned`（`refresh` 第 145-176 行），按 `sessionGeneration`/`request` token 防止跨 session 注入。
   - 每个 Mutation（create/discard/retryCleanup/setPermanent/setRetention/beginNextIteration/returnToLocal）用 `pendingAction` 互斥、`generation` 守卫，`applyMutation`（第 197 行）合并结果到 `snapshot`，失败命中 `stale_*` 时 `refresh(false)`。
   - `restoreAbandonedSnapshot` 调用 `invalidateBranchOverview`（第 404 行）让 next-overview 反映新分支。

4. **提交图与标签**
   - `BranchGraphModal`：`gitGraph(sessionId, limit)`（`load` 第 183 行），`computeGraphLanes` 算泳道，`requestSeq` 丢弃过期回复；分页 `INITIAL_LIMIT=200`/`PAGE_STEP=100`；每行「打标签」按钮调用 `onTagCommit(oid)` 打开 `TagManagerModal` 并以该 commit 为 `target`。
   - `TagManagerModal`：每次 mutation 后 `gitListTags` 重读（`load` 第 39 行，不清除 `error`），创建/推送失败时以 `error` 报告但保留已成功的本地标签。

## Connections

- [[client-actions]]：`TargetStatusAction`/`WorktreeConsoleView` 通过 `openAuthorizedWorktreeTarget`、`openIsolatedTarget`、`openExistingSession`（`WorktreeClientServices`）执行打开/来源导航；`WorktreeClientServices` 类型来自 `src/client/actions.js`。
- [[console-contract]]：`WorktreeConsoleAdapter` 及其全部 DTO（`WorktreeConsoleTargetDetails`、`WorktreeConsoleListResponse`、`WorktreeConsoleGitOverviewResponse`、`WorktreeConsoleGitGraphCommit`、`WorktreeConsoleGitTag`、`WorktreeConsoleMutationResponse` 等）在 `src/console-contract.ts` 定义；客户端不持任何 Git 实现。
- [[client-review-console]]：`WorktreeReviewStatus` 复用 `ReviewActions`、`ReviewDetailsModal`、`useReviewPreflight`、`useWorktreeRecoverySnapshot`、`recovery-continuation`、`review-console/index`（取 `reviewEvidenceFromTarget`/`reviewIdentityFromTarget`）；`WORKTREE_REVIEW_REFRESH_EVENT` 定义在 `src/client/review-console/status-events.ts`，被 `current-polling.ts` 的 `Poll` 监听。
- [[client-i18n]]：所有文案走 `useClientTranslator`/`useClientLanguage`/`ClientTranslator`（`src/client/i18n.js`），`STATE_LABELS` 与各类 `t(...)` key 来自 i18n 目录。
- [[client-console-remote]]：`WorktreeConsoleAdapter` 的 host 实现由 console-remote 提供；首屏 `gitOverview` 成本（3 次 git spawn）的规避策略依赖其 RPC 语义（见 `TargetStatusAction` 第 140-142 行注释）。
- [[client-workspace-sidebar]]：同为 Harness 宿主插槽的消费者；`WorktreeConsoleView` 的 `listAbandoned` 恢复条与 sidebar 的终态徽章语义互补。

## Known Issues

- **首屏不预取分支总览是有意取舍**：每个 session 都挂载 `TargetStatusAction`，若挂载即 `gitOverview`（3 次 git spawn）会严重浪费；因此总览仅在 popover 首次展开时拉取（`TargetStatusAction.tsx` 第 140-142 行注释）。副作用：胶囊初始不显示分支数/脏计数，直到用户展开。
- **非 Git 项目被当成常态而非失败**：`failure?.code === 'not_git_repository'` 时胶囊用中性灰（`target-console.styles.ts` 第 52 行 `opacity:.82`）、文案「非 Git 项目」，菜单只留「初始化 Git 仓库」（`TargetStatusAction.tsx` 第 149、494-501 行）。若 host 误报该码，胶囊将失去全部分支/标签/提交图入口。
- **隐藏标签轮询降级**：`isHidden()` 为 true 时 `Poll` 暂停，循环用 `HIDDEN_DELAY=60_000`（`current-polling.ts` 第 15 行）。恢复可见时若 `current` 恰好失败，胶囊会短暂显示 `unavailable` 直到下次轮询；这是为避免无头 GUI 白烧 `git status`+2×`git rev-parse` 的代价。
- **`branch-overview-cache` 覆盖同项目所有 session**：overview 是全仓库范围，缓存按 `sessionId` 键但「同一项目的多个 session 覆盖同一底层视图」（第 10-15 行注释）。切换到同项目另一个 session 时可能立刻看到上一个 session 写出的乐观补丁，需靠 `patchEpochs` 纪元与下一次 `ensure` 收敛。
- **`TagManagerModal` 的 `error` 不被 `load()` 清除**：为让「本地创建成功但推送失败」的错误对用户在重载后仍然可见（`TagManagerModal.tsx` 第 42-44 行注释）。副作用：若之前有过推送错误，重新打开弹层在 `useEffect` 里会把 `error` 清空（第 58 行），但 `createTag` 内部的二次 `load()` 不会清除，需留意旧错误残留。
- **`WorktreeHeroChip` 依赖宿主 DOM 结构**：通过 `findHeroRowFrom` 在 `composerStack`/`composerHero` 祖先里找 `heroWorkspaceRow` 类名（`WorktreeHeroChip.tsx` 第 44-69 行），并依赖 `react-dom` 的 `createPortal` 经 `require` 懒解析（第 10-29 行）。若宿主 shell 改变 hero row 挂载方式或无 `react-dom`，胶囊会静默不渲染（`renderPortal === null` 时返回 `null`）。
- **无禁用/注释状态的功能**：本模块所有导出组件、缓存函数、轮询逻辑均处于启用状态，未发现被 `disabled`、注释掉或条件关闭的代码路径（各 `adapter.*` 调用点都带可选的 `?` 判空，如 `adapter.listAbandoned`、`adapter.initializeProject`、`adapter.restoreAbandoned`，缺失时优雅降级而非报错）。
