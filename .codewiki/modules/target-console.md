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
  - src/client/target-console/TagManagerModal.tsx
  - src/client/target-console/branch-overview-cache.ts
  - src/client/target-console/current-polling.ts
  - src/console-contract.js
  - src/client/actions.js
tags: [client, target-console, polling, navigation, git-branch-ui]
---

## Overview

本模块在 Harness 客户端 UI 中展示与管理 Worktree（工作区）。通过 `src/client/target-console/index.ts` 的 `registerTargetConsole`（行19-46）将三类贡献注入插槽系统：

1. **会话头胶囊**（`TargetStatusAction`，包裹于 `HeaderAction`）注入 `conversation.session.header.actions`（id `worktree-target`, order 30，行24-25、行30-35），显示当前会话关联 Worktree 状态，提供分支切换/创建/修剪/标签管理/提交图查看/初始化仓库等菜单。
2. **输入坞评审状态条**（`WorktreeReviewStatus`，包裹于 `ReviewStatus`）注入 `conversation.input.dock`（id `worktree-review-status`, order 10，行26-27、行36-40），在输入框上方显示评审准备、预览或恢复状态。
3. **空白会话 Hero 行胶囊**（`WorktreeHeroChip`，包裹于 `HeroChip`）注入 `conversation.input.dock`（id `worktree-hero-chip`, order 20，行28-29、行41-45），将状态胶囊 portal 到新建会话的初始 Hero 区域。

管理面板由 `WorktreeManagerModal`（行18-49）承载，内部嵌入 `WorktreeConsoleView`（embedded 模式，行39-46），提供完整的 Worktree 列表、创建、丢弃、常驻标记、保留期设置、废弃快照恢复等。所有数据通过 `WorktreeConsoleAdapter`（来自 `../../console-contract.js`）与 Host 通信；UI 状态依赖 `current-polling.ts` 的轻量轮询订阅（Poll 类行11-73）与 `branch-overview-cache.ts` 的分支概览缓存（TTL_MS 行17）。`index.ts` 末尾重导出五大组件（行48-52）。

## Key Components

### src/client/target-console/index.ts

- **接口 `TargetConsoleContextLike`**（行8-16）
  - 字段：
    - `slots: { inject(name: 'conversation.session.header.actions' | 'conversation.input.dock', callback: () => unknown): void; register(descriptor: Record<string, unknown>, component: ComponentType<any>): unknown }`（行9-15）
- **函数 `registerTargetConsole(ctx, adapter, services)`**（行19-46）
  - 核心注册：向 `ctx.slots.inject` 提交三个回调，分别注册 `HeaderAction`（行24-25, 行30-35）、`ReviewStatus`（行26-27, 行36-40）、`HeroChip`（行28-29, 行41-45）。
- **重导出**（行48-52）：`TargetStatusAction`、`WorktreeConsoleView`、`WorktreeHeroChip`、`WorktreeManagerModal`、`WorktreeReviewStatus`。

### src/client/target-console/TargetStatusAction.tsx

- **接口 `TargetStatusActionProps`**（行26-30）
  - `sessionId: string`（行27）
  - `adapter: WorktreeConsoleAdapter`（行28）
  - `services: WorktreeClientServices`（行29）
- **常量 `STATE_LABELS`**（行32-44）：接收 `ClientTranslator`，返回 11 种状态（local/creating/working/ready_for_review/preview_active/preview_detached/retained/cleanup_pending/recovery_required/delivered/discarded）的本地化标签映射。
- **函数 `shortOid(value: string)`**（行46-48）：`unversioned` 原样返回，否则截取前 7 字符。
- **组件 `TargetStatusAction`**（行51-738）
  - 状态与 Refs：
    - `t`（行52）、`language`（行53）
    - `target`（行55）、`loading`（行56）、`error`（行57）、`failure`（行59，记录探针失败 code/message）、`menuOpen`（行60）、`managerOpen`（行61）、`cleanupConfirmOpen`（行62）、`pendingAction`（行63）、`overview`（行64）、`graphOpen`（行65）、`createOpen`（行66）、`createName`（行67）、`createBusy`（行68）、`pruneOpen`（行69）、`prunePreview`（行70）、`pruneLoading`（行71）、`pruneBusy`（行72）、`branchQuery`（行73）、`switchNotice`（行74）、`tagsOpen`（行75）、`tagTarget`（行77，提交打标签的目标 commit，null 为 HEAD）、`initializeOpen`（行79）、`initializeBusy`（行80）
    - `actionScope` ref（行81）、`activeSession` ref（行82-86）、`mounted` ref（行87）
  - 效果：
    - 挂载设置 `mounted`（行89-92）
    - `refresh` 回调（行94-96）调用 `requestWorktreeReviewRefresh`
    - 订阅效果（行98-138）依赖 `[adapter, language, sessionId]` 重置状态并调用 `subscribeCurrent`（行120），结果分支写入 `target`（行126）、`failure`（行123/133）、`error`（行124/134）
    - 注释明言挂载时不预取分支概览（行140-142）
    - 注释非 Git 仓库为正常预期，单独标签与初始化出口（行144-149）
  - 计算属性（行149-168）：`notGitRepository`、`state`、`stateLabel`、`branchLabel`、`triggerLabel`、`expiry`、`accessibleLabel`、`triggerTitle`
  - 方法：
    - `reveal`（行170-176）：打开 `target.managedRoot` workspace 路径（调用 `services.workspaces.openPath`）
    - `openSource`（行178-184）：跳转源会话（调用 `openExistingSession`）
    - `switchBranch`（行186-224）：调用 `adapter.gitSwitchBranch`（行194），成功后用 `patchBranchOverview` 乐观更新缓存（行200-204）并直接读 `cachedBranchOverview`（行207），随后 `requestWorktreeReviewRefresh`（行218）
    - `createBranch`（行226-255）：前端校验 `branchNameSchema`（行229），调用 `adapter.gitCreateBranch`（行238），后 `invalidateBranchOverview` 并 `ensureBranchOverview` 重取（行246-249）
    - `initializeRepository`（行257-285）：调用 `adapter.initializeProject`（行268），处理非 Git 项目转换，后 `requestWorktreeReviewRefresh` 与 `invalidateBranchOverview`（行278-279）
    - `openPrunePreview`（行287-310）：调用 `adapter.gitPruneMergedBranches(sessionId, true)` 预览（行295）
    - `confirmPrune`（行312-337）：调用 `adapter.gitPruneMergedBranches(sessionId, false)` 执行（行319），后失效缓存并重取（行328-331）
    - `retryCleanup`（行339-369）：调用 `adapter.retryCleanup`（行347），处理 `stale_target` 后刷新（行355）
    - `beginNextIteration`（行371-393）：调用 `adapter.beginNextIteration`（行379）
    - `discard`（行395-429）：调用 `adapter.discard`（行403），对 `preview_active` 或 `rollbackPreview` 传 `rollbackPreview: true`（行408-410）
  - 菜单项构建：`summary`（行431-445）；`MAX_BRANCH_ITEMS = 12`（行447）；分支排序与过滤（行448-466）；`items` 数组（行470-529，非 Git 仓库仅 summary+initialize 行470-473，正常含分支列表/创建/修剪/标签/图/打开/源/迭代/管理）；`footer` 数组（行530-534）涵盖 retry_cleanup 与 discard
  - 渲染：`<Menu>` 锚点按钮 `.dsh-wtc-target-chip`（行538-597），首次展开时通过 `refreshBranchOverviewInBackground` 或 `ensureBranchOverview` 加载分支列表（行578-585）；子模态 `WorktreeManagerModal`（行598-608）、清理确认 `Modal`（行609-624）、初始化 `Modal`（行625-641）、`BranchGraphModal`（行642-651）、`TagManagerModal`（行652-659）、创建分支 `Modal`（行660-691）、修剪预览 `Modal`（行692-735）

### src/client/target-console/WorktreeConsoleView.tsx

- **接口 `WorktreeConsoleViewProps`**（行23-30）
  - `embedded?`（行24）、`sessionId`（行25）、`adapter`（行26）、`services`（行27）、`focusCheckoutId?`（行28）、`onTargetChange?`（行29）
- **常量 `STATE_LABELS`**（行32-44）：同 TargetStatusAction 的映射。
- **接口 `ConsoleSnapshot`**（行46-50）
  - `sessionId: string`（行47）、`current: WorktreeConsoleTargetDetails`（行48）、`list: WorktreeConsoleListResponse`（行49）
- **函数 `errorText(error, t)`**（行52-59）：组合 `worktreeConsoleErrorMeta` 生成分类/恢复文案。
- **函数 `retentionLabel(retention, t)`**（行61-65）：映射 `retain_24h`/`retain_3d`/`retain_manual`。
- **组件 `TargetState`**（行67-76）：渲染状态圆点 + 标签。
- **常量 `ATTENTION_RANK`**（行78-90）：状态优先级数值映射（recovery_required:0 至 discarded:10），用于列表排序。
- **组件 `WorktreeConsoleView`**（行93-700）
  - 状态/Refs：`mounted`（行104）、`request`（行105）、`abandonedRequest`（行106）、`sessionGeneration`（行107）、`snapshot`（行108）、`abandoned`（行109）、`notice`（行110）、`loading`（行111）、`error`（行112）、`pendingAction`（行113）、`confirmTarget`（行114）、`createBranch`（行115）、`knownBranches`（行116）、`needsAttentionOnly`（行117）、`includeDelivered`（行118）、`confirmButton`（行119）、`visibleSnapshot`（行120）、`currentSourceBranch`（行121）
  - 初始化效果（行123-140）：`sessionId` 变更时重置状态并递增 `sessionGeneration`
  - 方法：
    - `isActive`（行142-143）：校验 `mounted` 与 `sessionGeneration`
    - `refresh`（行145-176）：并发 `adapter.current`、`adapter.list`（带 `needsAttention`/`includeDelivered` 过滤）、`adapter.listAbandoned`（可选，行155）
    - `refreshAbandoned`（行179-190）：仅刷废弃快照，失败静默（行187-189）
    - `applyMutation`（行197-215）：根据 `WorktreeConsoleMutationResponse` 更新 `snapshot` 列表与目标
    - `mutationError`（行217-223）：处理错误，对 stale 码触发 `refresh(false)`
    - `loadBranches`（行225-234）：调用 `adapter.preflightCreate` 获取已知分支（行228）
    - `createTarget`（行236-291）：调 `adapter.create`（行243），严格校验 Host 返回身份（行250-265），后 `openIsolatedTarget`（行266）
    - `discardTarget`（行293-319）：调 `adapter.discard`（行300），脏数据先确认（行589 触发）
    - `retryCleanup`（行321-344）：调 `adapter.retryCleanup`（行327）
    - `setPermanentFlag`（行346-369）：调 `adapter.setPermanent`（行352）
    - `setRetentionMode`（行371-389）：调 `adapter.setRetention`（行377）
    - `restoreAbandonedSnapshot`（行391-412）：调 `adapter.restoreAbandoned`（行397），后 `invalidateBranchOverview` + `refresh`（行404-405）
    - `openListedTarget`（行414-437）：调 `openAuthorizedWorktreeTarget`（行425）
  - 列表排序 `orderedWorktrees`（行439-447）：依据 `focusCheckoutId` 与 `ATTENTION_RANK` 排序
  - 渲染：加载态（行449-451）、头部（行454-460）、当前目标段（行463-499）、链接列表段（行500-625，含过滤与 `orderedWorktrees` 映射）、废弃快照段（行626-663）、确认对话框（行666-697）
  - 注释：废弃快照为增强功能，加载失败不打断主面板（行167-168, 行187-189）

### src/client/target-console/WorktreeHeroChip.tsx

- **类型 `PortalRenderer`**（行6）：`(children: ReactNode, container: Element) => ReactNode`
- **变量 `cachedPortalRenderer`**（行8）：模块级缓存（null | undefined 区分未解析/解析失败）
- **函数 `resolvePortalRenderer`**（行10-29）：尝试 `require('react-dom')` 的 `createPortal`，失败降级 null（行25-27）
- **函数 `isHeroRow`**（行31-36）：校验元素为 HTMLElement、connected 且 className 包含 `heroWorkspaceRow`
- **函数 `findHeroRowFrom`**（行44-69）：从 dock anchor 的兄弟/祖先结构解析 hero 行（行46-62），fallback 到 `document.querySelector`（行64-66）
- **接口 `WorktreeHeroChipProps`**（行71-76）：`session?`（行72）、`sessionId?`（行73）、`adapter`（行74）、`services`（行75）
- **组件 `WorktreeHeroChip`**（行84-142）
  - 逻辑：计算 `targetSessionId`（行87），effect 中（行88-129）查找 hero 行并启动 `MutationObserver`（行111-118）与 bounded poll（`window.setInterval` 500ms，tries >= 8 停止，即最多 4s，行119-124）；若 `renderPortal` 存在且 `heroRow` 非空且非 `session.blank === false`（行131）则 portal `TargetStatusAction`（行132-141）

### src/client/target-console/WorktreeReviewStatus.tsx

- **接口 `WorktreeReviewStatusProps`**（行18-22）：`session`（行19）、`adapter`（行20）、`services`（行21）
- **组件 `WorktreeReviewStatus`**（行25-184）
  - 状态：`detailsOpen`（行28）、`dismissed`（行30，按 delivery iteration 范围 dismiss）、`sessionId`（行32）、`target`（行33）、`error`（行34）、`recovery`（行35）、`detailPreflight`（行36）
  - Refs：`mounted`（行38）、`sessionGeneration`（行39）、`currentSessionId`（行40-41）
  - 效果：挂载调 `restoreWorktreeRecovery`（行52-54）；订阅 `subscribeCurrent` 并保持 target 单调（行57-73）；`sessionId` 或 `reviewId` 变时关详情（行37）
  - 独立恢复卡（行75-99）：当 `standaloneRecovery` 存在（recovery 匹配且 target 无 review 或 working）时渲染排队/发送/失败状态与重发按钮（行94-96）
  - 评审 Dock（行102-183）：仅当 target 有 review 且状态在白名单内（`ready_for_review`/`preview_active`/`preview_detached`/`cleanup_pending`/`recovery_required`/`retained`，行106）才渲染；包含 `ReviewDetailsModal`（行143）、`ReviewActions`（行144-172, compact）、Dismiss 按钮（终态时，行173-181）
  - 标签逻辑（行122-132）依据状态映射文案；`applyTarget`（行116-118）局部更新

### src/client/target-console/WorktreeManagerModal.tsx

- **接口 `WorktreeManagerModalProps`**（行7-15）：`open`（行8）、`sessionId`（行9）、`adapter`（行10）、`services`（行11）、`focusCheckoutId?`（行12）、`onClose`（行13）、`onTargetChange?`（行14）
- **组件 `WorktreeManagerModal`**（行18-49）：薄包装 `Modal` 嵌入 `<WorktreeConsoleView embedded ... />`（行39-46）

### src/client/target-console/BranchGraphModal.tsx

- **接口 `GraphEdge`**（行10-16）：`x1: number`（行11）、`y1: number`（行12）、`x2: number`（行13）、`y2: number`（行14）、`color: number`（行15）
- **接口 `GraphRowLanes`**（行18-23）：`nodeColumn: number`（行19）、`laneCount: number`（行20）、`edges: GraphEdge[]`（行22）
- **接口 `GraphRefBadge`**（行25-32）：`label: string`（行27）、`full: string`（行29）、`tag: boolean`（行31）
- **函数 `mergeRefs(refs: string[])`**（行39-57）：合并本地/远程同名 ref 为一个 badge；Tag ref 标记 `tag:`，绝不与同名 branch 合并（行42-46）
- **函数 `computeGraphLanes(rows)`**（行66-127）：移植自 git-graph 的 lane 拓扑算法，产出边几何（处理 first parent 保持 lane、其他 parent 开新 lane、quiet lane 复用）
- **常量**（行129-134）：`LANE_COLORS`（行129）、`LANE_WIDTH=14`（行130）、`ROW_HEIGHT=36`（行131）、`NODE_RADIUS=4`（行132）、`INITIAL_LIMIT=200`（行133）、`PAGE_STEP=100`（行134）
- **函数 `formatTime(epochSeconds, t)`**（行136-145）：相对时间格式化
- **接口 `BranchGraphModalProps`**（行147-158）：`open`（行148）、`onClose`（行149）、`adapter`（行150）、`sessionId`（行151）、`t`（行152）、`currentBranch`（行153）、`onTagCommit?`（行155）、`onManageTags?`（行157）
- **函数 `laneX(column)`**（行160-162）：列索引转 x 坐标
- **函数 `edgePath(edge)`**（行164-172）：生成 SVG 贝塞尔曲线路径
- **组件 `BranchGraphModal`**（行175-311）：加载 `adapter.gitGraph`（分页行183-196，初始行198-206），用 `computeGraphLanes` 渲染 SVG lane 与提交行（行247-307），支持“加载更多”（行225-238）

### src/client/target-console/TagManagerModal.tsx

- **接口 `TagManagerModalProps`**（行9-17）：`open`（行10）、`onClose`（行11）、`adapter`（行12）、`sessionId`（行13）、`t`（行14）、`target?`（行16，Commit/ref 指向，null 为 HEAD）
- **类型 `BusyAction`**（行19）：`'create' | 'delete' | 'push' | null`
- **组件 `TagManagerModal`**（行26-263）
  - 状态：`tags`（行27）、`error`（行28）、`notice`（行29）、`loading`（行30）、`busy`（行31）、`createName`（行32）、`createMessage`（行33）、`pushOnCreate`（行34）、`confirmDelete`（行35）、`deleteRemote`（行36）、`requestSeq`（行37）
  - 方法：
    - `load`（行39-53）：调用 `adapter.gitListTags`，保留 `error` 不被清除（行42-44 注释）
    - `createTag`（行70-100）：调 `adapter.gitCreateTag`（行77），本地成功推送失败时报错不隐标签（行91-93）
    - `deleteTag`（行102-120）：调 `adapter.gitDeleteTag`（行108）
    - `pushTag`（行122-142）：调 `adapter.gitPushTag`（行128）
  - 渲染：创建表单（行160-196）、标签列表（行199-233）、删除确认（行234-259）

### src/client/target-console/branch-overview-cache.ts

- **常量 `TTL_MS`**（行17）：60000
- **变量**（行19-21）：`cache`、`flights`、`patchEpochs` 模块级 Map
- **函数 `bumpEpoch(sessionId)`**（行23-25）：递增某 session 的 epoch
- **函数 `cachedBranchOverview(sessionId)`**（行27-29）：返回缓存值或 null
- **函数 `isFresh(entry)`**（行31-33）：判断 TTL 内
- **函数 `invalidateBranchOverview(sessionId)`**（行35-38）：删缓存并 bump epoch
- **函数 `patchBranchOverview(sessionId, patch)`**（行41-46）：对现存缓存打补丁并 bump epoch
- **函数 `fetchOverview(adapter, sessionId)`**（行48-73）：执行 `adapter.gitOverview`，根据 epoch 冲突决定是否写缓存/清槽（行51-64）
- **函数 `ensureBranchOverview(adapter, sessionId)`**（行80-84）：新鲜读，过期则 fetch
- **函数 `refreshBranchOverviewInBackground(adapter, sessionId)`**（行87-92）：stale-while-revalidate 读
- 注释强调 epoch 防止飞行请求踩掉乐观补丁（行13-15, 行51-58, 行67-68）

### src/client/target-console/current-polling.ts

- **类型 `Result`**（行5）：`{ outcome: WorktreeConsoleOutcome<WorktreeConsoleCurrentResponse> } | { error: unknown }`；`Listener`（行6）
- **变量 `clients` / `DELAY`**（行7-8）：WeakMap 按 adapter 隔离；`DELAY = 5_000`
- **类 `Poll`**（行11-73）
  - 字段：`listeners`（行12）、`timer`（行13）、`running`（行14）、`dirty`（行15）、`generation`（行16）、`last`（行17）、`adapter`/`sessionId`/`release`（行19）
  - 私有 `onRefresh`（行21-23）：监听 `WORKTREE_REVIEW_REFRESH_EVENT` 触发 `invalidate`
  - 方法 `subscribe`（行25-46）：返回取消订阅；首订阅启动轮询与事件监听，后续订阅直接回放 `last`
  - 方法 `invalidate`（行48-54）：bump generation，立即跑
  - 方法 `run`（行56-72）：执行 `adapter.current`，分发结果，5s 后重跑（行71）
  - 注释：仅用于展示，不授权 mutation 或 Git cleanup（行10）
- **函数 `subscribeCurrent(adapter, sessionId, language, listener)`**（行76-88）：按 adapter+sessionId+language（JSON key，行81）复用 `Poll` 实例

## Architecture

```text
┌───────────────────────────────────────────────┐
│ Client Shell (Harness Slots)                  │
│ index.ts: registerTargetConsole               │
│ ├─ header.actions ► TargetStatusAction.tsx    │
│ ├─ input.dock ► WorktreeReviewStatus.tsx      │
│ └─ input.dock ► WorktreeHeroChip.tsx (portal) │
└───────────────┬───────────────────────────────┘
                │ WorktreeConsoleAdapter (contract)
┌───────────────▼───────────────────────────────┐
│ UI Components                                 │
│ TargetStatusAction ─┬─ branch-overview-cache  │
│ WorktreeConsoleView │  (optimistic cache)     │
│ WorktreeManagerModal► WorktreeConsoleView     │
│ BranchGraphModal ───┘  gitGraph/gitOverview   │
│ WorktreeReviewStatus ── review-console/*      │
└───────────────┬───────────────────────────────┘
                │ subscribeCurrent
┌───────────────▼───────────────────────────────┐
│ current-polling.ts: Poll (5s display poll)    │
└───────────────────────────────────────────────┘
```

## Data Flow

1. **注册**：`registerTargetConsole`（index.ts 行19-46）将三个组件注入插槽。
2. **轮询**：组件 mount 时调用 `subscribeCurrent`（current-polling.ts 行76-88），启动 5s 轮询 `adapter.current()`，结果分发给 `TargetStatusAction`（行98-138）与 `WorktreeReviewStatus`（行57-73）。
3. **分支缓存**：`TargetStatusAction` 首次展开菜单时（行578-585）调用 `refreshBranchOverviewInBackground` 或 `ensureBranchOverview`（branch-overview-cache.ts 行87/行80）；switch/create/prune 后通过 `patchBranchOverview`/`invalidateBranchOverview` 维护（行200-204, 行246-249, 行328-331）。
4. **变更操作**：
   - 分支切换：`switchBranch`（TargetStatusAction 行186-224）→ `adapter.gitSwitchBranch` → 乐观补丁缓存 → `requestWorktreeReviewRefresh`
   - 创建目标：`createTarget`（WorktreeConsoleView 行236-291）→ `adapter.create` → 校验 → `openIsolatedTarget`（actions.js）
   - 丢弃/清理：调用 `adapter.discard`/`retryCleanup` 等，成功则 `applyMutation` 更新快照（行197-215）
   - 初始化仓库：`initializeRepository`（TargetStatusAction 行257-285）→ `adapter.initializeProject` 处理非 Git 项目
5. **评审状态**：`WorktreeReviewStatus` 依据 `target.review` 与状态白名单（行106）渲染 Dock，嵌入 `ReviewActions` 触发预览/回滚/完成（行144-172）。

## Connections

- [[client-actions]]：`actions.js` 提供 `WorktreeClientServices`、`openExistingSession`（TargetStatusAction 行13, 行178-184）、`openIsolatedTarget`（WorktreeConsoleView 行266）、`openAuthorizedWorktreeTarget`（WorktreeConsoleView 行425）等导航与 workspace 打开能力。
- [[review-console]]：`review-console/*` 提供 `ReviewIcon`、`ReviewActions`、`ReviewDetailsModal`、恢复续传 `recovery-continuation`（WorktreeReviewStatus 行11-14）、`status-events` 等，被 TargetStatusAction/WorktreeReviewStatus/BranchGraphModal 等依赖。
- [[console-contract]]：`../../console-contract.js` 定义 `WorktreeConsoleAdapter` 及所有请求/响应类型（如 `WorktreeConsoleTargetDetails`, `WorktreeConsoleGitOverviewResponse`，见各文件 import 行2-11 等），是本模块全部数据的契约源。
- [[client-boot]]：初始化 `WorktreeConsoleAdapter` seam 的客户端启动流程（外部上下文）。

## Known Issues

- **分支概览不预取**：`TargetStatusAction.tsx` 行140-142 注释明确挂载时不预取 `gitOverview`，避免每个会话无谓 git spawns，仅首次展开弹窗加载。
- **非 Git 仓库处理**：`TargetStatusAction.tsx` 行144-149 注释说明普通文件夹非仓库是正常预期，使用独立标签与初始化出口（`initializeRepository` 行257-285），避免误显 "unavailable"。
- **Hero 行轮询上限**：`WorktreeHeroChip.tsx` 行119-124 每 500ms 轮询查找 late-mounted hero 行，最多 8 次（4s），若更晚挂载则胶囊缺失。
- **废弃快照增强降级**：`WorktreeConsoleView.tsx` 行167-168 与 行187-189 注释声明 `listAbandoned` 失败仅置空隐藏，不打断主面板。
- **轮询仅展示用**：`current-polling.ts` 行10 注释声明 `Poll` 永远不用于授权 mutation 或 Git cleanup。
- **缓存 epoch 保护**：`branch-overview-cache.ts` 行13-15 与 行51-58 注释说明飞行中请求在 epoch 变化时不回写，防止踩掉 switch 后的乐观补丁。
