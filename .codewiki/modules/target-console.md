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
tags: [client, target-console, polling, navigation, git-branch-ui]
---

## Overview

本模块在 Harness 客户端 UI 中展示与管理 Worktree（工作区）。通过 `src/client/target-console/index.ts` 的 `registerTargetConsole` 将三类贡献注入插槽系统：

1. **会话头胶囊**（`TargetStatusAction`，包裹于 `HeaderAction`）注入 `conversation.session.header.actions`（Order 30），显示当前会话关联 Worktree 状态，提供分支切换/创建/修剪/提交图查看等菜单。
2. **输入坞评审状态条**（`WorktreeReviewStatus`，包裹于 `ReviewStatus`）注入 `conversation.input.dock`（Order 10），在输入框上方显示评审准备、预览或恢复状态。
3. **空白会话 Hero 行胶囊**（`WorktreeHeroChip`，包裹于 `HeroChip`）注入 `conversation.input.dock`（Order 20），将状态胶囊 portal 到新建会话的初始 Hero 区域。

管理面板由 `WorktreeManagerModal` 承载，内部嵌入 `WorktreeConsoleView`（embedded 模式），提供完整的 Worktree 列表、创建、丢弃、常驻标记、保留期设置、废弃快照恢复等。所有数据通过 `WorktreeConsoleAdapter`（来自 `../../console-contract.js`）与 Host 通信；UI 状态依赖 `current-polling.ts` 的轻量轮询订阅与 `branch-overview-cache.ts` 的分支概览缓存。

## Key Components

### `src/client/target-console/index.ts`

- **接口 `TargetConsoleContextLike`** (L8-16)
  - 字段：
    - `slots: { inject(name: 'conversation.session.header.actions' | 'conversation.input.dock', callback: () => unknown): void; register(descriptor: Record<string, unknown>, component: ComponentType<any>): unknown }`
- **函数 `registerTargetConsole(ctx, adapter, services)`** (L19-46)
  - 核心注册：向 `ctx.slots.inject` 提交三个回调，分别注册 `HeaderAction`（`TargetStatusAction` 包裹，id `worktree-target`, order 30）、`ReviewStatus`（`WorktreeReviewStatus` 包裹，id `worktree-review-status`, order 10）、`HeroChip`（`WorktreeHeroChip` 包裹，id `worktree-hero-chip`, order 20）。
- **重导出** (L48-52)：`TargetStatusAction`、`WorktreeConsoleView`、`WorktreeHeroChip`、`WorktreeManagerModal`、`WorktreeReviewStatus`。

### `src/client/target-console/TargetStatusAction.tsx`

- **接口 `TargetStatusActionProps`** (L25-29)
  - 字段：`sessionId: string`; `adapter: WorktreeConsoleAdapter`; `services: WorktreeClientServices`
- **常量 `STATE_LABELS`** (L31-43)：接收 `ClientTranslator`，返回 11 种状态（local/creating/working/ready_for_review/preview_active/preview_detached/retained/cleanup_pending/recovery_required/delivered/discarded）的本地化标签映射。
- **函数 `shortOid(value: string)`** (L45-47)：`unversioned` 原样返回，否则截取前 7 字符。
- **组件 `TargetStatusAction`** (L50-581)
  - Props 同上接口。
  - 主要状态：`target` (L54), `loading` (L55), `error` (L56), `menuOpen` (L57), `managerOpen` (L58), `cleanupConfirmOpen` (L59), `pendingAction` (L60), `overview` (L61), `graphOpen` (L62), `createOpen/Name/Busy` (L63-65), `pruneOpen/Preview/Loading/Busy` (L66-69), refs `actionScope/activeSession/mounted` (L70-76)。
  - 订阅效果 (L87-115)：依赖 `[adapter, language, sessionId]` 重置状态并调用 `subscribeCurrent`，结果写入 `target` 或 `error`。
  - 方法：
    - `refresh` (L83-85)：调用 `requestWorktreeReviewRefresh(sessionId)`。
    - `reveal` (L132-138)：打开 `target.managedRoot` workspace 路径。
    - `openSource` (L140-146)：跳转源会话（`openExistingSession`）。
    - `switchBranch` (L148-177)：调用 `adapter.gitSwitchBranch`，成功后用 `patchBranchOverview` 乐观更新缓存，并 `requestWorktreeReviewRefresh`。
    - `createBranch` (L179-208)：前端校验 `branchNameSchema`，调用 `adapter.gitCreateBranch`，后 `invalidateBranchOverview` 并 `ensureBranchOverview` 重取。
    - `openPrunePreview` (L210-233)：调用 `adapter.gitPruneMergedBranches(sessionId, true)` 预览。
    - `confirmPrune` (L235-260)：调用 `adapter.gitPruneMergedBranches(sessionId, false)` 执行，后失效缓存并重取。
    - `retryCleanup` (L262-292)：调用 `adapter.retryCleanup`，处理 `stale_target` 后刷新。
    - `beginNextIteration` (L294-316)：调用 `adapter.beginNextIteration`。
    - `discard` (L318-352)：调用 `adapter.discard`，对 `preview_active` 或 `rollbackPreview` 传 `rollbackPreview: true`。
  - 菜单项构建 (L376-408)：包含 summary、分支列表（最多 12 项）、创建/修剪/图/打开/源/迭代/管理/清理等。
  - 渲染：`<Menu>` 锚点按钮 `.dsh-wtc-target-chip` (L432-466)，以及子模态 `WorktreeManagerModal` (L468-478)、清理确认 `Modal` (L479-494)、`BranchGraphModal` (L495-502)、创建分支 `Modal` (L503-534)、修剪预览 `Modal` (L535-578)。
  - 注意：挂载时不预取分支概览，注释明言避免无谓 git spawns (L117-119)。

### `src/client/target-console/WorktreeConsoleView.tsx`

- **接口 `WorktreeConsoleViewProps`** (L23-30)：`embedded?`, `sessionId`, `adapter`, `services`, `focusCheckoutId?`, `onTargetChange?`。
- **常量 `STATE_LABELS`** (L32-44)：同 TargetStatusAction 的映射。
- **接口 `ConsoleSnapshot`** (L46-50)：`sessionId`, `current: WorktreeConsoleTargetDetails`, `list: WorktreeConsoleListResponse`。
- **函数 `errorText(error, t)`** (L52-59)：组合 `worktreeConsoleErrorMeta` 生成分类/恢复文案。
- **函数 `retentionLabel(retention, t)`** (L61-65)：映射 `retain_24h`/`retain_3d`/`retain_manual`。
- **组件 `TargetState`** (L67-76)：渲染状态圆点 + 标签。
- **常量 `ATTENTION_RANK`** (L78-90)：状态优先级数值映射，用于列表排序。
- **组件 `WorktreeConsoleView`** (L93-700)
  - 状态：`snapshot` (L108), `abandoned` (L109), `notice` (L110), `loading` (L111), `error` (L112), `pendingAction` (L113), `confirmTarget` (L114), `createBranch` (L115), `knownBranches` (L116), `needsAttentionOnly` (L117), `includeDelivered` (L118), refs 等。
  - 方法：
    - `refresh` (L145-176)：并发 `adapter.current`, `adapter.list`（带过滤）, `adapter.listAbandoned`（可选）。
    - `refreshAbandoned` (L179-190)：仅刷废弃快照，失败静默。
    - `applyMutation` (L197-215)：根据 `WorktreeConsoleMutationResponse` 更新快照。
    - `mutationError` (L217-223)：处理错误，对 stale 码触发 `refresh(false)`。
    - `loadBranches` (L225-234)：调用 `adapter.preflightCreate` 获取已知分支。
    - `createTarget` (L236-291)：调 `adapter.create`，严格校验 Host 返回身份，后 `openIsolatedTarget`。
    - `discardTarget` (L293-319)：调 `adapter.discard`，脏数据先确认。
    - `retryCleanup` (L321-344)：调 `adapter.retryCleanup`。
    - `setPermanentFlag` (L346-369)：调 `adapter.setPermanent`。
    - `setRetentionMode` (L371-389)：调 `adapter.setRetention`。
    - `restoreAbandonedSnapshot` (L391-412)：调 `adapter.restoreAbandoned`，后 `invalidateBranchOverview` + `refresh`。
    - `openListedTarget` (L414-437)：调 `openAuthorizedWorktreeTarget`。
  - 渲染：加载态 (L449-451)、头部 (L454-460)、当前目标段 (L465-499)、链接列表段 (L500-625，含过滤与 `orderedWorktrees` 排序)、废弃快照段 (L626-663)、确认对话框 (L666-697)。
  - 注释：废弃快照为增强功能，加载失败不打断主面板 (L167-168, L187-189)。

### `src/client/target-console/WorktreeHeroChip.tsx`

- **类型 `PortalRenderer`** (L6)：`(children: ReactNode, container: Element) => ReactNode`。
- **变量 `cachedPortalRenderer`** (L8)：模块级缓存。
- **函数 `resolvePortalRenderer`** (L10-29)：尝试 `require('react-dom')` 的 `createPortal`，失败降级 null。
- **函数 `findHeroWorkspaceRow`** (L31-34)：`querySelector('[class*="heroWorkspaceRow"]')` 且 connected。
- **接口 `WorktreeHeroChipProps`** (L36-41)：`session?`, `sessionId?`, `adapter`, `services`。
- **组件 `WorktreeHeroChip`** (L49-79)
  - 逻辑：计算 `targetSessionId` (L51)，effect 中查找 hero 行并启动轮询（250ms×40 次）(L52-72)；若 `renderPortal` 存在且 `heroRow` 非空且非 `session.blank===false` 则 portal `TargetStatusAction` (L74-78)。
  - 限制：轮询最多 10s，更晚挂载则遗漏 (L61-70)。

### `src/client/target-console/WorktreeReviewStatus.tsx`

- **接口 `WorktreeReviewStatusProps`** (L18-22)：`session: { sessionId: string }`, `adapter`, `services`。
- **组件 `WorktreeReviewStatus`** (L25-184)
  - 状态：`detailsOpen` (L28), `dismissed` (L30), `target` (L33), `error` (L34), `recovery` (L35), `detailPreflight` (L36) 等。
  - 效果：挂载调 `restoreWorktreeRecovery` (L52-54)；订阅 `subscribeCurrent` 并保持 target 单调 (L57-73)；`sessionId` 或 `reviewId` 变时关详情 (L37)。
  - 独立恢复卡 (L80-99)：当 `standaloneRecovery` 存在时渲染排队/发送/失败状态与重发按钮。
  - 评审 Dock (L102-183)：仅当 target 有 review 且状态在白名单内才渲染；包含 `ReviewDetailsModal`、`ReviewActions` (compact)、Dismiss 按钮（终态时）。
  - 标签逻辑 (L122-132) 依据状态映射文案。

### `src/client/target-console/WorktreeManagerModal.tsx`

- **接口 `WorktreeManagerModalProps`** (L7-15)：`open`, `sessionId`, `adapter`, `services`, `focusCheckoutId?`, `onClose`, `onTargetChange?`。
- **组件 `WorktreeManagerModal`** (L18-49)：薄包装 `Modal` 嵌入 `<WorktreeConsoleView embedded ... />` (L39-46)。

### `src/client/target-console/BranchGraphModal.tsx`

- **接口 `GraphEdge`** (L10-16)：`x1,y1,x2,y2,color`。
- **接口 `GraphRowLanes`** (L18-23)：`nodeColumn`, `laneCount`, `edges`。
- **接口 `GraphRefBadge`** (L25-30)：`label`, `full`。
- **函数 `mergeRefs(refs)`** (L33-48)：合并本地/远程同名 ref 为一个 badge。
- **函数 `computeGraphLanes(rows)`** (L57-118)：移植自 git-graph 的 lane 拓扑算法，产出边几何。
- **常量** (L120-125)：`LANE_COLORS`, `LANE_WIDTH=14`, `ROW_HEIGHT=36`, `NODE_RADIUS=4`, `INITIAL_LIMIT=200`, `PAGE_STEP=100`。
- **函数 `formatTime`** (L127-136)：相对时间格式化。
- **接口 `BranchGraphModalProps`** (L138-145)：`open`, `onClose`, `adapter`, `sessionId`, `t`, `currentBranch`。
- **函数 `laneX`** (L147-149)：列索引转 x 坐标。
- **函数 `edgePath`** (L151-159)：生成 SVG 曲线路径。
- **组件 `BranchGraphModal`** (L162-282)：加载 `adapter.gitGraph`（分页），用 `computeGraphLanes` 渲染 SVG lane 与提交行，支持“加载更多” (L206-220)。

### `src/client/target-console/branch-overview-cache.ts`

- **常量 `TTL_MS`** (L17)：60000。
- **变量** (L19-21)：`cache`, `flights`, `patchEpochs` 模块级 Map。
- **函数 `bumpEpoch`** (L23-25)：递增某 session 的 epoch。
- **函数 `cachedBranchOverview`** (L27-29)：返回缓存值或 null。
- **函数 `isFresh`** (L31-33)：判断 TTL 内。
- **函数 `invalidateBranchOverview`** (L35-38)：删缓存并 bump epoch。
- **函数 `patchBranchOverview`** (L41-46)：对现存缓存打补丁并 bump epoch。
- **函数 `fetchOverview`** (L48-73)：执行 `adapter.gitOverview`，根据 epoch 冲突决定是否写缓存/清槽。
- **函数 `ensureBranchOverview`** (L80-84)：新鲜读，过期则 fetch。
- **函数 `refreshBranchOverviewInBackground`** (L87-92)：stale-while-revalidate 读。
- 注释强调 epoch 防止飞行请求踩掉乐观补丁 (L13-15, L51-58)。

### `src/client/target-console/current-polling.ts`

- **类型 `Result`** (L5)：`{ outcome } | { error }`；`Listener` (L6)。
- **类 `Poll`** (L11-73)
  - 字段：`listeners`, `timer`, `running`, `dirty`, `generation`, `last`, `adapter`, `sessionId`, `release`。
  - 方法：
    - `subscribe` (L25-46)：返回取消订阅；首订阅启动轮询与事件监听。
    - `invalidate` (L48-54)：bump generation，立即跑。
    - `run` (L56-72)：执行 `adapter.current`，分发结果，5s 后重跑 (DELAY L8)。
  - 注释：仅用于展示，不授权 mutation (L10)。
- **函数 `subscribeCurrent(adapter, sessionId, language, listener)`** (L76-89)：按 adapter+sessionId+language 复用 `Poll` 实例。

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

1. **注册**：`registerTargetConsole` (index.ts L19-46) 将三个组件注入插槽。
2. **轮询**：组件 mount 时调用 `subscribeCurrent` (current-polling.ts L76-89)，启动 5s 轮询 `adapter.current()`，结果分发给 `TargetStatusAction` (L104) 与 `WorktreeReviewStatus` (L61)。
3. **分支缓存**：`TargetStatusAction` 首次展开菜单时 (L449-456) 调用 `refreshBranchOverviewInBackground` 或 `ensureBranchOverview` (branch-overview-cache.ts L87/L80)；switch/create/prune 后通过 `patchBranchOverview`/`invalidateBranchOverview` 维护。
4. **变更操作**：
   - 分支切换：`switchBranch` (TargetStatusAction L148) → `adapter.gitSwitchBranch` → 乐观补丁缓存 → `requestWorktreeReviewRefresh`。
   - 创建目标：`createTarget` (WorktreeConsoleView L236) → `adapter.create` → 校验 → `openIsolatedTarget` (actions.js)。
   - 丢弃/清理：调用 `adapter.discard`/`retryCleanup` 等，成功则 `applyMutation` 更新快照。
5. **评审状态**：`WorktreeReviewStatus` 依据 `target.review` 与状态白名单渲染 Dock，嵌入 `ReviewActions` 触发预览/回滚/完成。

## Connections

- [[client-actions]]：`actions.js` 提供 `WorktreeClientServices`、`openExistingSession`、`openIsolatedTarget`、`openAuthorizedWorktreeTarget` 等导航与 workspace 打开能力，被 TargetStatusAction/WorktreeConsoleView/HeroChip 引用。
- [[review-console]]：`review-console/*` 提供 `ReviewIcon`、`ReviewActions`、`ReviewDetailsModal`、恢复续传 `recovery-continuation` 等，被 TargetStatusAction/WorktreeReviewStatus/BranchGraphModal 等依赖。
- [[console-contract]]：`../../console-contract.js` 定义 `WorktreeConsoleAdapter` 及所有请求/响应类型，是本模块全部数据的契约源。
- [[client-boot]]：初始化 `WorktreeConsoleAdapter` seam 的客户端启动流程（外部上下文）。

## Known Issues

- **分支概览不预取**：`TargetStatusAction.tsx` L117-119 注释明确挂载时不预取 `gitOverview`，避免每个会话无谓 3 次 git spawn，仅首次展开弹窗加载。
- **Hero 行轮询上限**：`WorktreeHeroChip.tsx` L61-70 每 250ms 轮询查找 late-mounted hero 行，最多 40 次（10s），若更晚挂载则胶囊缺失。
- **废弃快照增强降级**：`WorktreeConsoleView.tsx` L167-168 与 L187-189 注释声明 `listAbandoned` 失败仅置空隐藏，不打断主面板。
- **轮询仅展示用**：`current-polling.ts` L10 注释声明 `Poll` 永远不用于授权 mutation 或 Git cleanup。
- **缓存 epoch 保护**：`branch-overview-cache.ts` L13-15 与 L51-58 注释说明飞行中请求在 epoch 变化时不回写，防止踩掉 switch 后的乐观补丁。