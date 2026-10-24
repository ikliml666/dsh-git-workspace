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
tags: [client, target-console, polling, navigation, git-branch-ui]
---

## Overview

本模块在 Harness 客户端 UI 中展示与管理 Worktree（工作区）。通过 `src/client/target-console/index.ts` 的 `registerTargetConsole` (L19-46) 将三类贡献注入插槽系统：

1. **会话头胶囊**（`TargetStatusAction`，包裹于 `HeaderAction`）注入 `conversation.session.header.actions`（id `worktree-target`, order 30，L30-35），显示当前会话关联 Worktree 状态，提供分支切换/创建/修剪/标签管理/提交图查看等菜单。
2. **输入坞评审状态条**（`WorktreeReviewStatus`，包裹于 `ReviewStatus`）注入 `conversation.input.dock`（id `worktree-review-status`, order 10，L36-40），在输入框上方显示评审准备、预览或恢复状态。
3. **空白会话 Hero 行胶囊**（`WorktreeHeroChip`，包裹于 `HeroChip`）注入 `conversation.input.dock`（id `worktree-hero-chip`, order 20，L41-45），将状态胶囊 portal 到新建会话的初始 Hero 区域。

管理面板由 `WorktreeManagerModal` (L18-49) 承载，内部嵌入 `WorktreeConsoleView`（embedded 模式，L39-46），提供完整的 Worktree 列表、创建、丢弃、常驻标记、保留期设置、废弃快照恢复等。所有数据通过 `WorktreeConsoleAdapter`（来自 `../../console-contract.js`）与 Host 通信；UI 状态依赖 `current-polling.ts` 的轻量轮询订阅（Poll 类 L11-73）与 `branch-overview-cache.ts` 的分支概览缓存（TTL_MS L17）。

## Key Components

### src/client/target-console/index.ts

- **接口 `TargetConsoleContextLike`** (L8-16)
  - 字段：
    - `slots: { inject(name: 'conversation.session.header.actions' | 'conversation.input.dock', callback: () => unknown): void; register(descriptor: Record<string, unknown>, component: ComponentType<any>): unknown }` (L9-15)
- **函数 `registerTargetConsole(ctx, adapter, services)`** (L19-46)
  - 核心注册：向 `ctx.slots.inject` 提交三个回调，分别注册 `HeaderAction`（L24-25, L30-35）、`ReviewStatus`（L26-27, L36-40）、`HeroChip`（L28-29, L41-45）。
- **重导出** (L48-52)：`TargetStatusAction`、`WorktreeConsoleView`、`WorktreeHeroChip`、`WorktreeManagerModal`、`WorktreeReviewStatus`。

### src/client/target-console/TargetStatusAction.tsx

- **接口 `TargetStatusActionProps`** (L26-30)
  - `sessionId: string` (L27)
  - `adapter: WorktreeConsoleAdapter` (L28)
  - `services: WorktreeClientServices` (L29)
- **常量 `STATE_LABELS`** (L32-44)：接收 `ClientTranslator`，返回 11 种状态（local/creating/working/ready_for_review/preview_active/preview_detached/retained/cleanup_pending/recovery_required/delivered/discarded）的本地化标签映射。
- **函数 `shortOid(value: string)`** (L46-48)：`unversioned` 原样返回，否则截取前 7 字符。
- **组件 `TargetStatusAction`** (L51-650)
  - 状态与 Refs：
    - `t` (L52), `language` (L53)
    - `target` (L55), `loading` (L56), `error` (L57), `menuOpen` (L58), `managerOpen` (L59), `cleanupConfirmOpen` (L60), `pendingAction` (L61), `overview` (L62), `graphOpen` (L63), `createOpen` (L64), `createName` (L65), `createBusy` (L66), `pruneOpen` (L67), `prunePreview` (L68), `pruneLoading` (L69), `pruneBusy` (L70), `branchQuery` (L71), `switchNotice` (L72), `tagsOpen` (L73), `tagTarget` (L74-75)
    - `actionScope` ref (L76), `activeSession` ref (L77-81), `mounted` ref (L82)
  - 效果：
    - 挂载设置 `mounted` (L84-87)
    - `refresh` 回调 (L89-91) 调用 `requestWorktreeReviewRefresh`
    - 订阅效果 (L93-125) 依赖 `[adapter, language, sessionId]` 重置状态并调用 `subscribeCurrent`，结果写入 `target` (L118) 或 `error` (L116, L121)
    - 注释明言挂载时不预取分支概览 (L127-129)
  - 计算属性 (L131-140)：`state`, `stateLabel`, `branchLabel`, `triggerLabel`, `expiry`, `accessibleLabel`
  - 方法：
    - `reveal` (L142-148)：打开 `target.managedRoot` workspace 路径（调用 `services.workspaces.openPath`）。
    - `openSource` (L150-156)：跳转源会话（调用 `openExistingSession`）。
    - `switchBranch` (L158-196)：调用 `adapter.gitSwitchBranch`，成功后用 `patchBranchOverview` 乐观更新缓存 (L172-180)，并 `requestWorktreeReviewRefresh`。
    - `createBranch` (L198-227)：前端校验 `branchNameSchema` (L201)，调用 `adapter.gitCreateBranch`，后 `invalidateBranchOverview` 并 `ensureBranchOverview` 重取 (L218-221)。
    - `openPrunePreview` (L229-252)：调用 `adapter.gitPruneMergedBranches(sessionId, true)` 预览 (L237)。
    - `confirmPrune` (L254-279)：调用 `adapter.gitPruneMergedBranches(sessionId, false)` 执行 (L261)，后失效缓存并重取 (L270-273)。
    - `retryCleanup` (L281-311)：调用 `adapter.retryCleanup` (L289)，处理 `stale_target` 后刷新 (L297)。
    - `beginNextIteration` (L313-335)：调用 `adapter.beginNextIteration` (L321)。
    - `discard` (L337-371)：调用 `adapter.discard` (L345)，对 `preview_active` 或 `rollbackPreview` 传 `rollbackPreview: true` (L350-352)。
  - 菜单项构建：`summary` (L373-381)；`MAX_BRANCH_ITEMS = 12` (L383)；分支排序与过滤 (L384-402)；`items` 数组 (L404-459) 涵盖 summary/分支列表/创建/修剪/标签/图/打开/源/迭代/管理；`footer` 数组 (L460-464) 涵盖 retry_cleanup 与 discard。
  - 渲染：`<Menu>` 锚点按钮 `.dsh-wtc-target-chip` (L468-525)，首次展开时通过 `refreshBranchOverviewInBackground` 或 `ensureBranchOverview` 加载分支列表 (L507-514)；子模态 `WorktreeManagerModal` (L527-537)、清理确认 `Modal` (L538-553)、`BranchGraphModal` (L554-563)、`TagManagerModal` (L564-571)、创建分支 `Modal` (L572-603)、修剪预览 `Modal` (L604-647)。

### src/client/target-console/WorktreeConsoleView.tsx

- **接口 `WorktreeConsoleViewProps`** (L23-30)
  - `embedded?` (L24), `sessionId` (L25), `adapter` (L26), `services` (L27), `focusCheckoutId?` (L28), `onTargetChange?` (L29)
- **常量 `STATE_LABELS`** (L32-44)：同 TargetStatusAction 的映射。
- **接口 `ConsoleSnapshot`** (L46-50)
  - `sessionId: string` (L47), `current: WorktreeConsoleTargetDetails` (L48), `list: WorktreeConsoleListResponse` (L49)
- **函数 `errorText(error, t)`** (L52-59)：组合 `worktreeConsoleErrorMeta` 生成分类/恢复文案。
- **函数 `retentionLabel(retention, t)`** (L61-65)：映射 `retain_24h`/`retain_3d`/`retain_manual`。
- **组件 `TargetState`** (L67-76)：渲染状态圆点 + 标签。
- **常量 `ATTENTION_RANK`** (L78-90)：状态优先级数值映射（recovery_required:0 至 discarded:10），用于列表排序。
- **组件 `WorktreeConsoleView`** (L93-700)
  - 状态/Refs：`mounted` (L104), `request` (L105), `abandonedRequest` (L106), `sessionGeneration` (L107), `snapshot` (L108), `abandoned` (L109), `notice` (L110), `loading` (L111), `error` (L112), `pendingAction` (L113), `confirmTarget` (L114), `createBranch` (L115), `knownBranches` (L116), `needsAttentionOnly` (L117), `includeDelivered` (L118), `confirmButton` (L119), `visibleSnapshot` (L120), `currentSourceBranch` (L121)
  - 初始化效果 (L123-140)：`sessionId` 变更时重置状态并递增 `sessionGeneration`。
  - 方法：
    - `isActive` (L142-143)：校验 `mounted` 与 `sessionGeneration`。
    - `refresh` (L145-176)：并发 `adapter.current`, `adapter.list`（带 `needsAttention`/`includeDelivered` 过滤）, `adapter.listAbandoned`（可选，L155）。
    - `refreshAbandoned` (L179-190)：仅刷废弃快照，失败静默（L187-189）。
    - `applyMutation` (L197-215)：根据 `WorktreeConsoleMutationResponse` 更新 `snapshot` 列表与目标。
    - `mutationError` (L217-223)：处理错误，对 stale 码触发 `refresh(false)`。
    - `loadBranches` (L225-234)：调用 `adapter.preflightCreate` 获取已知分支（L228）。
    - `createTarget` (L236-291)：调 `adapter.create`（L243），严格校验 Host 返回身份（L250-265），后 `openIsolatedTarget`（L266）。
    - `discardTarget` (L293-319)：调 `adapter.discard`（L300），脏数据先确认（L590 触发）。
    - `retryCleanup` (L321-344)：调 `adapter.retryCleanup`（L327）。
    - `setPermanentFlag` (L346-369)：调 `adapter.setPermanent`（L352）。
    - `setRetentionMode` (L371-389)：调 `adapter.setRetention`（L377）。
    - `restoreAbandonedSnapshot` (L391-412)：调 `adapter.restoreAbandoned`（L397），后 `invalidateBranchOverview` + `refresh`。
    - `openListedTarget` (L414-437)：调 `openAuthorizedWorktreeTarget`（L425）。
  - 列表排序 `orderedWorktrees` (L439-447)：依据 `focusCheckoutId` 与 `ATTENTION_RANK` 排序。
  - 渲染：加载态 (L449-451)、头部 (L454-460)、当前目标段 (L463-499)、链接列表段 (L500-625，含过滤与 `orderedWorktrees` 映射)、废弃快照段 (L626-663)、确认对话框 (L666-697)。
  - 注释：废弃快照为增强功能，加载失败不打断主面板 (L167-168, L187-189)。

### src/client/target-console/WorktreeHeroChip.tsx

- **类型 `PortalRenderer`** (L6)：`(children: ReactNode, container: Element) => ReactNode`。
- **变量 `cachedPortalRenderer`** (L8)：模块级缓存（null | undefined 区分未解析/解析失败）。
- **函数 `resolvePortalRenderer`** (L10-29)：尝试 `require('react-dom')` 的 `createPortal`，失败降级 null (L25-27)。
- **函数 `isHeroRow`** (L31-36)：校验元素为 HTMLElement、connected 且 className 包含 `heroWorkspaceRow`。
- **函数 `findHeroRowFrom`** (L44-69)：从 dock anchor 的兄弟/祖先结构解析 hero 行（L46-62），fallback 到 `document.querySelector` (L64-66)。
- **接口 `WorktreeHeroChipProps`** (L71-76)：`session?` (L72), `sessionId?` (L73), `adapter` (L74), `services` (L75)。
- **组件 `WorktreeHeroChip`** (L84-142)
  - 逻辑：计算 `targetSessionId` (L87)，effect 中 (L88-129) 查找 hero 行并启动 `MutationObserver` (L111-118) 与 bounded poll (`window.setInterval` 500ms，tries >= 8 停止，即最多 4s，L119-124)；若 `renderPortal` 存在且 `heroRow` 非空且非 `session.blank === false` (L131) 则 portal `TargetStatusAction` (L132-141)。

### src/client/target-console/WorktreeReviewStatus.tsx

- **接口 `WorktreeReviewStatusProps`** (L18-22)：`session: { sessionId: string }` (L19), `adapter` (L20), `services` (L21)。
- **组件 `WorktreeReviewStatus`** (L25-184)
  - 状态：`detailsOpen` (L28), `dismissed` (L30), `sessionId` (L32), `target` (L33), `error` (L34), `recovery` (L35), `detailPreflight` (L36) 等，refs `mounted` (L38), `sessionGeneration` (L39), `currentSessionId` (L40-41)。
  - 效果：挂载调 `restoreWorktreeRecovery` (L52-54)；订阅 `subscribeCurrent` 并保持 target 单调 (L57-73)；`sessionId` 或 `reviewId` 变时关详情 (L37)。
  - 独立恢复卡 (L75-99)：当 `standaloneRecovery` 存在（recovery 匹配且 target 无 review 或 working）时渲染排队/发送/失败状态与重发按钮 (L94-96)。
  - 评审 Dock (L102-183)：仅当 target 有 review 且状态在白名单内 (`ready_for_review`/`preview_active`/`preview_detached`/`cleanup_pending`/`recovery_required`/`retained`) 才渲染；包含 `ReviewDetailsModal` (L143)、`ReviewActions` (L144-172, compact)、Dismiss 按钮（终态时，L173-181）。
  - 标签逻辑 (L122-132) 依据状态映射文案。

### src/client/target-console/WorktreeManagerModal.tsx

- **接口 `WorktreeManagerModalProps`** (L7-15)：`open` (L8), `sessionId` (L9), `adapter` (L10), `services` (L11), `focusCheckoutId?` (L12), `onClose` (L13), `onTargetChange?` (L14)。
- **组件 `WorktreeManagerModal`** (L18-49)：薄包装 `Modal` 嵌入 `<WorktreeConsoleView embedded ... />` (L39-46)。

### src/client/target-console/BranchGraphModal.tsx

- **接口 `GraphEdge`** (L10-16)：`x1, y1, x2, y2: number`; `color: number`。
- **接口 `GraphRowLanes`** (L18-23)：`nodeColumn: number`; `laneCount: number`; `edges: GraphEdge[]`。
- **接口 `GraphRefBadge`** (L25-32)：`label: string`; `full: string`; `tag: boolean`。
- **函数 `mergeRefs(refs: string[])`** (L39-57)：合并本地/远程同名 ref 为一个 badge；Tag ref 标记 `tag:`，绝不与同名 branch 合并 (L42-46)。
- **函数 `computeGraphLanes(rows)`** (L66-127)：移植自 git-graph 的 lane 拓扑算法，产出边几何（处理 first parent 保持 lane、其他 parent 开新 lane、quiet lane 复用）。
- **常量** (L129-134)：`LANE_COLORS` (L129), `LANE_WIDTH=14` (L130), `ROW_HEIGHT=36` (L131), `NODE_RADIUS=4` (L132), `INITIAL_LIMIT=200` (L133), `PAGE_STEP=100` (L134)。
- **函数 `formatTime(epochSeconds, t)`** (L136-145)：相对时间格式化。
- **接口 `BranchGraphModalProps`** (L147-158)：`open` (L148), `onClose` (L149), `adapter` (L150), `sessionId` (L151), `t` (L152), `currentBranch` (L153), `onTagCommit?` (L155), `onManageTags?` (L157)。
- **函数 `laneX(column)`** (L160-162)：列索引转 x 坐标。
- **函数 `edgePath(edge)`** (L164-172)：生成 SVG 贝塞尔曲线路径。
- **组件 `BranchGraphModal`** (L175-311)：加载 `adapter.gitGraph`（分页 L183-196，初始 L198-206），用 `computeGraphLanes` 渲染 SVG lane 与提交行 (L247-307)，支持“加载更多” (L225-238)。

### src/client/target-console/TagManagerModal.tsx

- **接口 `TagManagerModalProps`** (L9-17)：`open` (L10), `onClose` (L11), `adapter` (L12), `sessionId` (L13), `t` (L14), `target?` (L16)。
- **类型 `BusyAction`** (L19)：`'create' | 'delete' | 'push' | null`。
- **组件 `TagManagerModal`** (L26-263)
  - 状态：`tags` (L27), `error` (L28), `notice` (L29), `loading` (L30), `busy` (L31), `createName` (L32), `createMessage` (L33), `pushOnCreate` (L34), `confirmDelete` (L35), `deleteRemote` (L36), `requestSeq` (L37)。
  - 方法：
    - `load` (L39-53)：调用 `adapter.gitListTags`。
    - `createTag` (L70-100)：调 `adapter.gitCreateTag`（L77），本地成功推送失败时报错不隐标签 (L91-93)。
    - `deleteTag` (L102-120)：调 `adapter.gitDeleteTag`（L108）。
    - `pushTag` (L122-142)：调 `adapter.gitPushTag`（L128）。
  - 渲染：创建表单 (L160-196)、标签列表 (L199-233)、删除确认 (L234-259)。

### src/client/target-console/branch-overview-cache.ts

- **常量 `TTL_MS`** (L17)：60000。
- **变量** (L19-21)：`cache`, `flights`, `patchEpochs` 模块级 Map。
- **函数 `bumpEpoch(sessionId)`** (L23-25)：递增某 session 的 epoch。
- **函数 `cachedBranchOverview(sessionId)`** (L27-29)：返回缓存值或 null。
- **函数 `isFresh(entry)`** (L31-33)：判断 TTL 内。
- **函数 `invalidateBranchOverview(sessionId)`** (L35-38)：删缓存并 bump epoch。
- **函数 `patchBranchOverview(sessionId, patch)`** (L41-46)：对现存缓存打补丁并 bump epoch。
- **函数 `fetchOverview(adapter, sessionId)`** (L48-73)：执行 `adapter.gitOverview`，根据 epoch 冲突决定是否写缓存/清槽（L51-64）。
- **函数 `ensureBranchOverview(adapter, sessionId)`** (L80-84)：新鲜读，过期则 fetch。
- **函数 `refreshBranchOverviewInBackground(adapter, sessionId)`** (L87-92)：stale-while-revalidate 读。
- 注释强调 epoch 防止飞行请求踩掉乐观补丁 (L13-15, L51-58, L67-68)。

### src/client/target-console/current-polling.ts

- **类型 `Result`** (L5)：`{ outcome: WorktreeConsoleOutcome<WorktreeConsoleCurrentResponse> } | { error: unknown }`；`Listener` (L6)。
- **变量 `clients` / `DELAY`** (L7-8)：WeakMap 按 adapter 隔离；`DELAY = 5_000`。
- **类 `Poll`** (L11-73)
  - 字段：`listeners` (L12), `timer` (L13), `running` (L14), `dirty` (L15), `generation` (L16), `last` (L17), `adapter`, `sessionId`, `release` (L19)。
  - 私有方法 `onRefresh` (L21-23)：监听 `WORKTREE_REVIEW_REFRESH_EVENT` 触发 `invalidate`。
  - 方法 `subscribe` (L25-46)：返回取消订阅；首订阅启动轮询与事件监听，后续订阅直接回放 `last`。
  - 方法 `invalidate` (L48-54)：bump generation，立即跑。
  - 方法 `run` (L56-72)：执行 `adapter.current`，分发结果，5s 后重跑 (L71)。
  - 注释：仅用于展示，不授权 mutation 或 Git cleanup (L10)。
- **函数 `subscribeCurrent(adapter, sessionId, language, listener)`** (L76-88)：按 adapter+sessionId+language（JSON key，L81）复用 `Poll` 实例。

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
2. **轮询**：组件 mount 时调用 `subscribeCurrent` (current-polling.ts L76-88)，启动 5s 轮询 `adapter.current()`，结果分发给 `TargetStatusAction` (L93-125) 与 `WorktreeReviewStatus` (L57-73)。
3. **分支缓存**：`TargetStatusAction` 首次展开菜单时 (L507-514) 调用 `refreshBranchOverviewInBackground` 或 `ensureBranchOverview` (branch-overview-cache.ts L87/L80)；switch/create/prune 后通过 `patchBranchOverview`/`invalidateBranchOverview` 维护。
4. **变更操作**：
   - 分支切换：`switchBranch` (TargetStatusAction L158-196) → `adapter.gitSwitchBranch` → 乐观补丁缓存 → `requestWorktreeReviewRefresh`。
   - 创建目标：`createTarget` (WorktreeConsoleView L236-291) → `adapter.create` → 校验 → `openIsolatedTarget` (actions.js)。
   - 丢弃/清理：调用 `adapter.discard`/`retryCleanup` 等，成功则 `applyMutation` 更新快照 (L197-215)。
5. **评审状态**：`WorktreeReviewStatus` 依据 `target.review` 与状态白名单 (L102-107) 渲染 Dock，嵌入 `ReviewActions` 触发预览/回滚/完成 (L144-172)。

## Connections

- [[client-actions]]：`actions.js` 提供 `WorktreeClientServices`、`openExistingSession` (TargetStatusAction L13, L150)、`openIsolatedTarget` (WorktreeConsoleView L266)、`openAuthorizedWorktreeTarget` (WorktreeConsoleView L425) 等导航与 workspace 打开能力。
- [[review-console]]：`review-console/*` 提供 `ReviewIcon`、`ReviewActions`、`ReviewDetailsModal`、恢复续传 `recovery-continuation` (WorktreeReviewStatus L11-14)、`status-events` 等，被 TargetStatusAction/WorktreeReviewStatus/BranchGraphModal 等依赖。
- [[console-contract]]：`../../console-contract.js` 定义 `WorktreeConsoleAdapter` 及所有请求/响应类型（如 `WorktreeConsoleTargetDetails`, `WorktreeConsoleGitOverviewResponse`, 见各文件 import L2-11 等），是本模块全部数据的契约源。
- [[client-boot]]：初始化 `WorktreeConsoleAdapter` seam 的客户端启动流程（外部上下文）。

## Known Issues

- **分支概览不预取**：`TargetStatusAction.tsx` L127-129 注释明确挂载时不预取 `gitOverview`，避免每个会话无谓 git spawns，仅首次展开弹窗加载。
- **Hero 行轮询上限**：`WorktreeHeroChip.tsx` L119-124 每 500ms 轮询查找 late-mounted hero 行，最多 8 次（4s），若更晚挂载则胶囊缺失。
- **废弃快照增强降级**：`WorktreeConsoleView.tsx` L167-168 与 L187-189 注释声明 `listAbandoned` 失败仅置空隐藏，不打断主面板。
- **轮询仅展示用**：`current-polling.ts` L10 注释声明 `Poll` 永远不用于授权 mutation 或 Git cleanup。
- **缓存 epoch 保护**：`branch-overview-cache.ts` L13-15 与 L51-58 注释说明飞行中请求在 epoch 变化时不回写，防止踩掉 switch 后的乐观补丁。
