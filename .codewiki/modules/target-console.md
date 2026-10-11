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
tags:
  - client
  - target-console
  - polling
  - navigation
  - git-branch-ui
---

# Target Console 目标徽章与 Worktree 控制台

注册会话头的 Worktree 状态胶囊、输入坞评审状态条，以及源会话内打开的 Worktree 管理面板；数据经 `src/client/actions.ts` 适配出的 `WorktreeConsoleAdapter` 读取 Host，会话跳转与身份校验复用该模块的编排层。

## Overview

本模块负责在 Harness 客户端 UI 中展示和管理 Worktree（工作区）。它通过三个主要入口点集成到会话界面：
1. **会话头胶囊** (`TargetStatusAction`)：显示当前会话关联的 Worktree 状态，并提供分支切换、创建、提交图查看等快捷操作。
2. **输入坞状态条** (`WorktreeReviewStatus`)：在对话输入框上方显示评审准备状态、预览状态或恢复状态。
3. **空白会话 Hero 行** (`WorktreeHeroChip`)：在新建会话的初始状态下，将状态胶囊注入到 Hero 区域。
4. **管理面板** (`WorktreeManagerModal` + `WorktreeConsoleView`)：以模态框形式提供完整的 Worktree 列表管理视图，支持创建、丢弃、常驻设置等操作。

所有数据交互均通过 `WorktreeConsoleAdapter` 进行，确保与后端 Host 的一致性。UI 状态更新依赖于 `current-polling.ts` 提供的轻量级轮询订阅机制。

## Key Components

### `src/client/target-console/index.ts`

**导出函数：**

*   `registerTargetConsole(ctx, adapter, services)` (L25-L46)
    *   核心注册函数。将组件挂载到 Harness 的 Slot 系统中。
    *   注入 `conversation.session.header.actions`：注册 `HeaderAction` (包裹 `TargetStatusAction`)，ID `worktree-target`, Order 30。
    *   注入 `conversation.input.dock`：注册 `ReviewStatus` (包裹 `WorktreeReviewStatus`)，ID `worktree-review-status`, Order 10。
    *   注入 `conversation.input.dock`：注册 `HeroChip` (包裹 `WorktreeHeroChip`)，ID `worktree-hero-chip`, Order 20。
*   `export { TargetStatusAction }` (L48)
*   `export { WorktreeConsoleView }` (L49)
*   `export { WorktreeHeroChip }` (L50)
*   `export { WorktreeManagerModal }` (L51)
*   `export { WorktreeReviewStatus }` (L52)

**接口定义：**

*   `TargetConsoleContextLike` (L10-L17)
    *   `slots.inject(name, callback)`: 注入插槽回调。
    *   `slots.register(descriptor, component)`: 注册具体组件。

### `src/client/target-console/TargetStatusAction.tsx`

**组件：**

*   `TargetStatusAction(props: TargetStatusActionProps)` (L48-L472)
    *   **Props**: `sessionId`, `adapter`, `services`.
    *   **状态**:
        *   `target`: `WorktreeConsoleTargetDetails | null` (L51)
        *   `loading`, `error`, `menuOpen`, `managerOpen`, `cleanupConfirmOpen` (L52-L56)
        *   `pendingAction`: `'discard' | 'retry_cleanup' | 'begin_next_iteration' | 'switch_branch' | null` (L57)
        *   `overview`: `WorktreeConsoleGitOverviewResponse | null` (L58)
        *   `graphOpen`, `createOpen`, `createName`, `createBusy` (L59-L62)
        *   `pruneOpen`, `prunePreview`, `pruneLoading`, `pruneBusy` (L63-L66)
        *   `actionScope`, `activeSession`, `mounted` (Refs, L67-L70)
    *   **Effect (L76-L105)**:
        *   监听 `[adapter, language, sessionId]`。重置状态后调用 `subscribeCurrent`。
        *   处理错误和成功结果，更新 `target` 和 `loading`。
    *   **Effect (L109-L115)**:
        *   预取分支概览 `ensureBranchOverview`。
    *   **方法**:
        *   `refresh()` (L78): 触发 `requestWorktreeReviewRefresh`。
        *   `reveal()` (L128-L134): 打开 `managedRoot` 目录。
        *   `openSource()` (L136-L142): 跳转到源会话。
        *   `switchBranch(branch)` (L144-L173): 切换分支。成功后乐观更新缓存 `patchBranchOverview`。
        *   `createBranch()` (L175-L204): 创建新分支。前端校验 `branchNameSchema`，后端调用 `gitCreateBranch`。
        *   `openPrunePreview()` (L206-L228): 预览清理已合并分支。
        *   `confirmPrune()` (L230-L256): 确认清理。成功后 `invalidateBranchOverview`。
        *   `retryCleanup()` (L258-L286): 重试环境清理。
        *   `beginNextIteration()` (L288-L312): 开始下一次迭代。
        *   `discard()` (L314-L346): 丢弃任务和工作区。处理 `preview_active` 的回滚逻辑。
    *   **渲染**:
        *   构建 Menu 项 `items` (L348-L382) 和 Footer `footer` (L383-L388)。
        *   渲染 `<Menu>` 锚点在 `.dsh-wtc-target-chip` 按钮上 (L390-L418)。
        *   渲染子模态框：`WorktreeManagerModal`, `BranchGraphModal`, 新建分支 Modal, 清理确认 Modal, 分支清理预览 Modal。

**常量：**

*   `STATE_LABELS(t)` (L30-L40): 映射 10 种状态标签。
*   `shortOid(value)` (L43-L45): 截断 OID 为 7 位。

### `src/client/target-console/WorktreeConsoleView.tsx`

**组件：**

*   `WorktreeConsoleView(props: WorktreeConsoleViewProps)` (L91-L698)
    *   **Props**: `embedded`, `sessionId`, `adapter`, `services`, `focusCheckoutId`, `onTargetChange`.
    *   **状态**:
        *   `snapshot`: `ConsoleSnapshot` (包含 `current` 和 `list`) (L108)
        *   `abandoned`: `WorktreeConsoleAbandonedSnapshot[]` (L109)
        *   `notice`, `loading`, `error`, `pendingAction`, `confirmTarget`, `createBranch`, `knownBranches`, `needsAttentionOnly`, `includeDelivered` (L110-L118)
    *   **Effect**:
        *   `useLayoutEffect` (L102-L106): 重置状态并 bump `sessionGeneration`。
        *   `refresh()` (L143-L174): 并发获取 `current`, `list`, `listAbandoned`。
        *   `refreshAbandoned()` (L177-L188): 仅刷新废弃快照。
        *   `loadBranches()` (L223-L232): 懒加载分支列表。
        *   `createTarget()` (L234-L289): 创建工作区。严格校验 Host 返回的身份信息。
        *   `discardTarget()` (L291-L317), `retryCleanup()` (L319-L342), `setPermanentFlag()` (L344-L367), `setRetentionMode()` (L369-L387), `restoreAbandonedSnapshot()` (L389-L410), `openListedTarget()` (L412-L435).
    *   **渲染**:
        *   Loading 状态 (L447-L449).
        *   Header (L451-L455).
        *   Current Target Section (L457-L478): 显示项目名、分支、状态、创建控件。
        *   Linked Worktrees List (L480-L658): 过滤、排序 (`ATTENTION_RANK`)、渲染每行 Facts 和 Actions。
        *   Abandoned Snapshots Strip (L659-L693).
        *   Confirm Dialog (L695-L726): 脏数据丢弃确认。

**辅助函数/组件：**

*   `StateLabels` (L32-L43): 状态标签映射。
*   `errorText(error, t)` (L51-L58): 格式化错误信息。
*   `retentionLabel(retention, t)` (L60-L64): 保留策略标签。
*   `TargetState({ target })` (L66-L75): 状态圆点组件。
*   `ATTENTION_RANK` (L77-L88): 状态优先级映射。

### `src/client/target-console/WorktreeHeroChip.tsx`

**组件：**

*   `WorktreeHeroChip(props: WorktreeHeroChipProps)` (L45-L72)
    *   **Props**: `session`, `sessionId`, `adapter`, `services`.
    *   **逻辑**:
        *   查找 hero 工作区行 `findHeroWorkspaceRow()` (L31-L34).
        *   使用 `resolvePortalRenderer()` (L10-L29) 获取 React DOM Portal 渲染器（兼容 CommonJS require）。
        *   如果找到 hero 行且非空白会话结束，则将 `TargetStatusAction` 渲染进该行的 Portal 中。
        *   轮询查找 late-mounted hero 行 (L52-L68, 250ms * 40次)。

### `src/client/target-console/WorktreeReviewStatus.tsx`

**组件：**

*   `WorktreeReviewStatus(props: WorktreeReviewStatusProps)` (L28-L181)
    *   **Props**: `session`, `adapter`, `services`.
    *   **逻辑**:
        *   挂载时调用 `restoreWorktreeRecovery` (L53).
        *   订阅 `current` 并保持 target 单调性 (L57-L73).
        *   渲染 Standalone Recovery Card (L75-L99).
        *   渲染 Review Dock (L102-L181): 包含状态图标、详情按钮、`ReviewDetailsModal`、`ReviewActions` (compact 模式)、Dismiss 按钮。

### `src/client/target-console/WorktreeManagerModal.tsx`

**组件：**

*   `WorktreeManagerModal(props: WorktreeManagerModalProps)` (L15-L48)
    *   薄包装层，内部嵌入 `WorktreeConsoleView` (embedded 模式)。

### `src/client/target-console/BranchGraphModal.tsx`

**组件：**

*   `BranchGraphModal(props: BranchGraphModalProps)` (L115-L193)
    *   **Props**: `open`, `onClose`, `adapter`, `sessionId`, `t`, `currentBranch`.
    *   **逻辑**:
        *   加载 Git Graph 数据 `adapter.gitGraph` (L123-L134).
        *   计算 Lane 拓扑 `computeGraphLanes` (L31-L75).
        *   渲染 SVG Lane 连线 (L165-L182).
        *   支持分页加载更多 commits (L148-L156).

**工具函数：**

*   `mergeRefs(refs)` (L28-L42): 合并本地/远程 Refs 为 Badge。
*   `computeGraphLanes(rows)` (L44-L93): 移植自 git-graph 的 Lane 算法。
*   `formatTime(epochSeconds, t)` (L95-L104): 相对时间格式化。
*   `laneX(column)` (L106-L108), `edgePath(edge)` (L110-L117): SVG 路径生成。

### `src/client/target-console/branch-overview-cache.ts`

**变量：**

*   `cache`: Map<sessionId, Entry> (L18)
*   `flights`: Map<sessionId, Promise> (L19)
*   `patchEpochs`: Map<sessionId, number> (L20)

**函数：**

*   `cachedBranchOverview(sessionId)` (L23): 获取缓存值。
*   `invalidateBranchOverview(sessionId)` (L29): 清除缓存并 bump Epoch。
*   `patchBranchOverview(sessionId, patch)` (L33): 乐观补丁，bump Epoch。
*   `fetchOverview(adapter, sessionId)` (L37-L56): 执行网络请求，处理 Epoch 冲突和失败清理。
*   `ensureBranchOverview(adapter, sessionId)` (L60-L64): 新鲜读取，过期则 fetch。
*   `refreshBranchOverviewInBackground(adapter, sessionId)` (L68-L72): Stale-while-revalidate 读取。

### `src/client/target-console/current-polling.ts`

**类：**

*   `Poll` (L10-L73)
    *   `constructor(adapter, sessionId, release)` (L12-L15)
    *   `subscribe(listener)` (L21-L45): 返回取消订阅函数。首个订阅者启动轮询。
    *   `invalidate()` (L47-L53): 标记 dirty 并可能立即重跑。
    *   `run()` (L55-L71): 执行一次 API 调用，分发结果，调度下一次。

**函数：**

*   `subscribeCurrent(adapter, sessionId, language, listener)` (L75-L89): 创建或复用 Poll 实例。

## Architecture

```text
┌──────────────────────────────────────────────────────────────┐
│                        Client Shell                          │
│                                                              │
│  ┌─────────────────┐   ┌──────────────────────┐             │
│  │ Harness Slots   │   │   Worktree Console   │             │
│  │                 │   │                      │             │
│  │ Header Actions  │──►│ TargetStatusAction   │             │
│  │ Input Dock      │──►│ WorktreeReviewStatus │             │
│  │ Input Dock      │──►│ WorktreeHeroChip     │             │
│  └─────────────────┘   └──────────┬───────────┘             │
│                                   │                          │
│                    ┌──────────────▼──────────────┐           │
│                    │   WorktreeConsoleAdapter    │           │
│                    │   (Host Communication)      │           │
│                    └──────────────┬──────────────┘           │
│                                   │                          │
│  ┌────────────────────────────────▼────────────────────────┐ │
│  │                   Data & State Layer                     │ │
│  │                                                         │ │
│  │ current-polling.ts ◄────────► WorktreeConsoleView       │ │
│  │ branch-overview-cache.ts ◄──► TargetStatusAction        │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

1.  **Integration**: `index.ts` registers components into Harness slots.
2.  **Data Source**: `WorktreeConsoleAdapter` proxies calls to the Host backend.
3.  **State Management**:
    *   `current-polling.ts` provides a shared, debounced subscription for the latest session target state.
    *   `branch-overview-cache.ts` manages optimistic updates and caching for branch lists to ensure instant UI response during menu interactions.
4.  **Components**:
    *   `TargetStatusAction` handles interactive branch operations and displays the header chip.
    *   `WorktreeReviewStatus` displays review-specific status in the input dock.
    *   `WorktreeConsoleView` provides the comprehensive list view inside the manager modal.

## Data Flow

1.  **Initialization**: `registerTargetConsole` mounts components.
2.  **Polling**: `subscribeCurrent` starts a 5-second poll for `adapter.current()`. Results are distributed to all subscribers (`TargetStatusAction`, `WorktreeReviewStatus`).
3.  **Branch Cache**: On mount or menu open, `ensureBranchOverview` fetches `adapter.gitOverview()`. Subsequent opens use stale cache while refreshing in background.
4.  **Mutations**:
    *   User action (e.g., Switch Branch) → `adapter.gitSwitchBranch()` → Success → `patchBranchOverview()` (Optimistic Update) → UI updates immediately.
    *   User action (e.g., Create Target) → `adapter.create()` → Validation → `openIsolatedTarget` (Navigation).
5.  **Review Status**: `WorktreeReviewStatus` listens to `current` updates and triggers `ReviewActions` for preview/recovery workflows.

## Connections

*   [[client-boot|Client Boot]]: Initializes the adapter seam.
*   [[review-console|Review Console]]: `WorktreeReviewStatus` and `TargetStatusAction` integrate with review states, recovery, and actions.
*   [[client-actions|Client Actions]]: Handles session navigation (`openExistingSession`, `openIsolatedTarget`) and workspace management.