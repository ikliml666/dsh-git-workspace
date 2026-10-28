---
title: client_target_console
type: module
source_files:
  - src/client/target-console/index.ts
  - src/client/target-console/current-polling.ts
  - src/client/target-console/branch-overview-cache.ts
  - src/client/target-console/TargetStatusAction.tsx
  - src/client/target-console/WorktreeHeroChip.tsx
  - src/client/target-console/WorktreeReviewStatus.tsx
  - src/client/target-console/WorktreeConsoleView.tsx
  - src/client/target-console/WorktreeManagerModal.tsx
  - src/client/target-console/BranchGraphModal.tsx
  - src/client/target-console/TagManagerModal.tsx
  - src/client/target-console/target-console.styles.ts
  - src/client/index.tsx
  - src/console-contract.ts
  - src/client/review-console/status-events.ts
tags: [client, target-console, worktree, harness-slots, polling]
---

## Overview

`client_target_console` 是 `client_core` 的子能力模块，负责把「Worktree Target」相关的 UI 贡献注册到 Harness 原生的会话头（Session header）与输入 dock（input dock）槽位上。它的入口是 `src/client/target-console/index.ts` 中的 `registerTargetConsole`，由宿主插件 `src/client/index.tsx:91-96` 在后端注入了可选的归一化 `WorktreeConsoleAdapter` 时才调用（见 `src/client/index.tsx:91` 的 `if (adapter !== undefined)` 守卫）。

该模块不自己实现任何 git / Host 逻辑，所有读写都通过 `WorktreeConsoleAdapter`（`src/console-contract.ts:745-784`）这个归一化 seam 完成；轮询与缓存也都在客户端本地完成，与具体的 Remote transport 解耦。

注册后贡献给 Harness 原生壳的三类槽位（slot）：

- `conversation.session.header.actions`（order 30，id `worktree-target`）：渲染 `TargetStatusAction` 胶囊（含分支切换、tag/prune/graph 管理、worktree 清理等菜单）。
- `conversation.input.dock`（order 10，id `worktree-review-status`）：渲染 `WorktreeReviewStatus` 评审交付状态 dock。
- `conversation.input.dock`（order 20，id `worktree-hero-chip`）：通过 `WorktreeHeroChip` 把胶囊 portal 进「空白会话」的 hero workspace row。

两个 polling / cache 辅助模块支撑上面的 UI：

- `current-polling.ts`：每 5 秒拉一次 `adapter.current({ sessionId })`（隐藏页 60 秒），用发布/订阅模型给所有订阅者推 `WorktreeConsoleTargetDetails`。
- `branch-overview-cache.ts`：模块级 Git overview 缓存（TTL 60s，stale-while-revalidate），避免每次展开胶囊 popover 都重新 git spawn。

## Key Components

### `index.ts` — 注册入口

- `TargetConsoleContextLike`（`src/client/target-console/index.ts:8-16`）：注册所需的最小上下文契约，仅含 `slots.inject(name, callback)` 与 `slots.register(descriptor, component)`。
- `registerTargetConsole(ctx, adapter, services)`（`src/client/target-console/index.ts:19-46`）：把三个贡献注册进 Harness 原生槽位。内部先用 `createElement` 把 `TargetStatusAction`/`WorktreeReviewStatus`/`WorktreeHeroChip` 包成匿名组件，再 `ctx.slots.inject(name, () => ctx.slots.register(descriptor, component))`。三个注册的明细见下：
  - `conversation.session.header.actions`（`src/client/target-console/index.ts:30-35`）：`id: 'worktree-target'`、`order: 30`、`label: 'Worktree Target'`，组件为 `HeaderAction`（封装 `TargetStatusAction`）。
  - `conversation.input.dock`（`src/client/target-console/index.ts:36-40`）：`id: 'worktree-review-status'`、`order: 10`，组件为 `ReviewStatus`（封装 `WorktreeReviewStatus`）。
  - `conversation.input.dock`（`src/client/target-console/index.ts:41-45`）：`id: 'worktree-hero-chip'`、`order: 20`，组件为 `HeroChip`（封装 `WorktreeHeroChip`）。
- 重导出（`src/client/target-console/index.ts:48-52`）：`TargetStatusAction`、`WorktreeConsoleView`、`WorktreeHeroChip`、`WorktreeManagerModal`、`WorktreeReviewStatus`，供 `WorktreeManagerModal` 等接入。

### `current-polling.ts` — `current` 轮询

- `type Result`（`:5`）：`{ outcome: WorktreeConsoleOutcome<WorktreeConsoleCurrentResponse> } | { error: unknown }`，订阅者回调收到的载荷。
- `type Listener`（`:6`）：`(result: Result) => void`。
- `clients`（`:7`）：`WeakMap<WorktreeConsoleAdapter, Map<string, Poll>>`，按 adapter 隔离不同 Client 实例；language 区分翻译结果（见 `subscribeCurrent` 的 key）。
- `DELAY = 5_000`（`:8`）：常规轮询间隔；`HIDDEN_DELAY = 60_000`（`:15`）：隐藏页（visibilityState === 'hidden'）时拉长为 60s，避免隐藏窗口空烧 CPU/disk（注释见 `:9-15`）。
- `isHidden()`（`:17-19`）：判定 `document.visibilityState === 'hidden'`。
- `class Poll`（`:22-91`）：每 session 的隐藏轮询循环。字段：`listeners: Set<Listener>`、私有 `timer`、`running`、`dirty`、`generation`、`last: Result | undefined`。关键方法：
  - `onRefresh`（`:32-34`）：监听 `WORKTREE_REVIEW_REFRESH_EVENT`，仅当 `detail.sessionId === this.sessionId` 时 `invalidate()`。
  - `onVisibility`（`:37-39`）：`visibilitychange` 回到非隐藏页时 `invalidate()`（此时 chip 必须立刻准确）。
  - `subscribe(listener)`（`:41-64`）：首个订阅者才真正启动循环并加监听；返回退订函数，最后一位退订且未在跑时 `release()`。
  - `invalidate()`（`:66-72`）：自增 `generation`、清 `timer`、置 `dirty`、若未跑则 `run()`。
  - `run()`（`:74-90`）：调用 `this.adapter.current({ sessionId })`（`:80`）；用 `generation` 防止竞态；完成后按 `isHidden()` 决定 `DELAY`/`HIDDEN_DELAY` 排下轮（`:89`）。
- `subscribeCurrent(adapter, sessionId, language, listener)`（`:94-107`）：对外订阅函数。key 为 `JSON.stringify([sessionId, language])`（`:99`）；同 key 复用 `Poll`（`:101-105`），无则创建并在 `release` 回调里从 map 删除（`:103`）。

### `branch-overview-cache.ts` — Git overview 缓存

- 模块级状态：`cache: Map<sessionId, { value, fetchedAt }>`（`:19`）、`flights: Map<sessionId, Promise<...>>` 去重并发请求（`:20`）、`patchEpochs: Map<sessionId, number>`（`:21`）防止飞行中补丁被覆盖。`TTL_MS = 60_000`（`:17`）。
- `bumpEpoch(sessionId)`（`:23-25`）：自增 epoch，每次 patch/invalidate 调用。
- `cachedBranchOverview(sessionId)`（`:27-29`）：返回当前缓存值或 `null`。
- `isFresh(entry)`（`:31-33`）：`Date.now() - entry.fetchedAt < TTL_MS`。
- `invalidateBranchOverview(sessionId)`（`:35-38`）：`bumpEpoch` 后删缓存。
- `patchBranchOverview(sessionId, patch)`（`:41-46`）：mutation 已确认后的乐观本地补丁；仅在已有 entry 时生效。
- `fetchOverview(adapter, sessionId)`（`:48-73`）：若已有 flight 直接复用（`:49-50`）；调 `adapter.gitOverview(sessionId)`（`:52`），仅在 epoch 未变时回写缓存或清缓存（`:58`、`:61-62`、`:68`）。
- `ensureBranchOverview(adapter, sessionId)`（`:80-84`）：TTL 内直接返回缓存，否则 await 一次 `fetchOverview`。
- `refreshBranchOverviewInBackground(adapter, sessionId)`（`:87-92`）：stale-while-revalidate，返回缓存（即使过期）并在后台 `fetchOverview`。

### `TargetStatusAction.tsx` — 会话头胶囊

- `TargetStatusActionProps`（`:26-30`）：`sessionId`、`adapter`、`services`。
- `TargetStatusAction({ sessionId, adapter, services })`（`:51-764`）：核心胶囊组件。状态 hook：`target`（`WorktreeConsoleTargetDetails | null`）、`loading`、`error`、`failure`（`{ code, message }`）、各类弹窗开关（`managerOpen`/`graphOpen`/`tagsOpen`/`pruneOpen`/`createOpen`/`initializeOpen`/`cleanupConfirmOpen`）等。
  - 挂载时 `useEffect`（`:98-138`）订阅 `subscribeCurrent`，把轮询结果写进 `target`（`:120-137`）；`sessionId` 变化用 `activeSession`/`actionScope` ref（`:82-86`）做作用域隔离，避免旧请求落地。
  - 关键交互：`switchBranch`（`:186-224`）走 `adapter.gitSwitchBranch` 后 `patchBranchOverview` + `cachedBranchOverview` 直接读回（`:200-208`）；`createBranch`（`:226-255`）走 `adapter.gitCreateBranch` 后 `invalidateBranchOverview`+`ensureBranchOverview`；`initializeRepository`（`:257-285`）走可选 `adapter.initializeProject`；`openPrunePreview`/`confirmPrune`（`:287-337`）走 `adapter.gitPruneMergedBranches`；`retryCleanup`/`beginNextIteration`/`returnToLocal`/`discard`（`:339-453`）走对应 adapter 方法。
  - 渲染：菜单项 `items`（`:494-554`）+ 页脚 `footer`（`:555-559`）交给 `Menu`；anchor 按钮（`:587-621`）首次展开时走 `refreshBranchOverviewInBackground` 或 `ensureBranchOverview`（`:604-611`）。
  - 挂载的子弹窗：`<WorktreeManagerModal>`（`:624-634`）、清理确认 `<Modal>`（`:635-650`）、`initializeGit` `<Modal>`（`:651-667`）、`<BranchGraphModal>`（`:668-677`）、`<TagManagerModal>`（`:678-685`）、创建分支 `<Modal>`（`:686-717`）、prune `<Modal>`（`:718-761`）。

### `WorktreeHeroChip.tsx` — 空白会话胶囊（portal）

- `PortalRenderer`（`:6`）、`cachedPortalRenderer`（`:8`）/`resolvePortalRenderer()`（`:10-29`）：惰性 `require('react-dom')` 拿 `createPortal`，失败则降级为 `null`（无 hero chip）。
- `isHeroRow(element)`（`:31-36`）、`findHeroRowFrom(anchor)`（`:44-69`）：从 dock anchor 的兄弟 / `composerStack` 祖先 / `document` 回退三档定位 `heroWorkspaceRow`。
- `WorktreeHeroChipProps`（`:71-76`）、`WorktreeHeroChip(...)`（`:84-142`）：`useEffect`（`:88-129`）用 `MutationObserver` + 有界 `setInterval`（500ms × 8 次 = 4s）探测 hero row，命中后把 `TargetStatusAction` 经 `renderPortal` 塞进 hero row（`:134-138`）。`session?.blank === false` 或非空白会话时返回 `null`（`:131`）。

### `WorktreeReviewStatus.tsx` — 评审状态 dock

- `WorktreeReviewStatusProps`（`:18-22`）、`WorktreeReviewStatus({ session, adapter, services })`（`:25-184`）：`useEffect`（`:57-73`）订阅 `subscribeCurrent` 写 `target`；独立恢复流程 `recovery`（`:35`、`useWorktreeRecoverySnapshot`、`restoreWorktreeRecovery`（`src/client/review-console/recovery-continuation.ts`））；当 `target.state` 处于 `ready_for_review`/`preview_active`/`preview_detached`/`cleanup_pending`/`recovery_required`/`retained` 且存在 review 时渲染 `<section class="dsh-wt-review-dock">`（`:102-107`、`:139-183`），内嵌 `ReviewDetailsModal` 与 `ReviewActions`。

### `WorktreeConsoleView.tsx` / `WorktreeManagerModal.tsx` — 管理器主体

- `WorktreeConsoleView`（`:93-700`）：完整 source-linked worktree 管理面板。props `WorktreeConsoleViewProps`（`:23-30`）。核心：`refresh()`（`:145-176`）并行 `adapter.current` / `adapter.list` / 可选 `adapter.listAbandoned`；`createTarget`（`:236-291`）、`discardTarget`（`:293-319`）、`retryCleanup`（`:321-344`）、`setPermanentFlag`（`:346-369`）、`setRetentionMode`（`:371-389`）、`restoreAbandonedSnapshot`（`:391-412`）、`openListedTarget`（`:414-437`）；`ATTENTION_RANK`（`:78-90`）排序、`orderedWorktrees`（`:439-447`）。
- `WorktreeManagerModal`（`:18-49`）：把 `WorktreeConsoleView` 包进 `embedded` 模式的 `<Modal>`，作为 `TargetStatusAction` 菜单「manage linked worktrees」的入口（`:577` → `:624`）。

### `BranchGraphModal.tsx` — 提交图

- `GraphEdge`/`GraphRowLanes`/`GraphRefBadge`（`:10-32`）、`mergeRefs(refs)`（`:39-57`）、`computeGraphLanes(rows)`（`:66-127`）、`BranchGraphModal`（`:175-311`）：调 `adapter.gitGraph(sessionId, limit)`（`:187`），分页 `INITIAL_LIMIT=200`、`PAGE_STEP=100`（`:133-134`）。“Manage tags” 按钮与每行 tag 按钮分别回调 `onManageTags`/`onTagCommit`（`:154-157`、`:293-302`）。

### `TagManagerModal.tsx` — 标签管理

- `TagManagerModalProps`（`:9-17`）、`TagManagerModal(...)`（`:26-263`）：调 `adapter.gitListTags`（`:45`）、`adapter.gitCreateTag`（`:77`）、`adapter.gitDeleteTag`（`:108`）、`adapter.gitPushTag`（`:128`）。`target` 指定打 tag 的 commit，默认 HEAD（`:15-16`、`:81`）。

### `target-console.styles.ts`

- `TARGET_CONSOLE_STYLES`（`:1-225`）：胶囊、菜单、console 面板、graph、tag 弹窗的全部 CSS（以 `String.raw` 包裹的 `:1` 模板串）。由 `src/client/index.tsx:74` 注入 `<style data-dsh-git-worktree="true">`。

## Architecture

```text
 src/client/index.tsx:91-96
        registerTargetConsole(adapter)
                 │
                 ▼
   target-console/index.ts:19  registerTargetConsole
                 │  inject + register ×3 slots
   ┌─────────────┼───────────────────────────────────────┐
   ▼             ▼                                        ▼
header.actions  input.dock (order10)            input.dock (order20)
(30,worktree-   (10,worktree-review-            (20,worktree-hero-
 target)        status)                         chip)
   │             │                                        │ portal into
   ▼             ▼ heroWorkspaceRow              ┌─────────┘
TargetStatus  WorktreeReviewStatus           WorktreeHeroChip
   │(menu)        │ (subscribeCurrent)              │
   ├─WorktreeManagerModal─►WorktreeConsoleView      │
   │     └─ create/discard/retry/retention/          │
   │        restoreAbandoned (adapter.*)             │
   ├─BranchGraphModal  (adapter.gitGraph)            │
   ├─TagManagerModal   (adapter.git*Tag)            │
   ├─prune/create/initialize Modals                 │
   └─ TargetStatusAction ───────────────────────────┘
                 │
        subscribeCurrent (current-polling.ts:94)
                 │   Poll.run()  every DELAY=5s / HIDDEN_DELAY=60s
                 ▼
        adapter.current({sessionId})
                 │
        WORKTREE_REVIEW_REFRESH_EVENT (status-events.ts)
        invalidate → re-run

  TargetStatusAction also reads branch-overview-cache.ts:
   refreshBranchOverviewInBackground / ensureBranchOverview
   ──► adapter.gitOverview  (TTL 60s, stale-while-revalidate)
```

`registerTargetConsole` 自身不含任何 git 逻辑，所有 Host 交互都经由 `WorktreeConsoleAdapter`（`src/console-contract.ts:745-784`）。`current-polling.ts` 与 `branch-overview-cache.ts` 是两套互相独立的本地状态源：`current` 为「订阅式定时轮询」，`gitOverview` 为「按需 + TTL 缓存」。

## Data Flow

### `current` 轮询如何驱动两个原生槽位

1. `registerTargetConsole` 在 `src/client/target-console/index.ts:19-34` 注册了 `HeaderAction`/`ReviewStatus` 两个组件，二者分别渲染 `TargetStatusAction` 与 `WorktreeReviewStatus`。
2. 二者都在挂载 `useEffect` 里调用 `subscribeCurrent(adapter, sessionId, language, listener)`（`current-polling.ts:94`）：
   - `TargetStatusAction`：`:120-137`，把 `result.outcome.value.target` 写进 `target` state；失败时写 `failure`（`:121-135`）。
   - `WorktreeReviewStatus`：`:61-71`，带「revision 单调」保护（`current.revision > refreshedTarget.revision ? current : refreshedTarget`，`:66`）。
3. `subscribeCurrent` 以 `JSON.stringify([sessionId, language])` 为 key（`current-polling.ts:99`），在 `clients` WeakMap（`current-polling.ts:7`）里复用/创建 `Poll`。
4. `Poll.run()`（`current-polling.ts:74-90`）调 `this.adapter.current({ sessionId })`（`:80`），回调 `listen` 的订阅者，并按 `isHidden()` 排下轮：`DELAY=5_000` 或 `HIDDEN_DELAY=60_000`（`:89`）。
5. 主动刷新：任何 mutation 或「initialize」成功后都调 `requestWorktreeReviewRefresh(sessionId)`（`status-events.ts:4`，即派发 `WORKTREE_REVIEW_REFRESH_EVENT`）。`Poll.onRefresh`（`current-polling.ts:32-34`）监听该事件，`detail.sessionId` 匹配时 `invalidate()` 立刻重拉。`visibilitychange` 回到前台也走同一路径（`current-polling.ts:37-39`）。

### `branch-overview-cache` 如何被 `TargetStatusAction` 使用

- `TargetStatusAction` 不在挂载时预取 overview（注释见 `TargetStatusAction.tsx:51-53`，避免每个会话都白烧 3 次 git spawn）。
- 胶囊首次展开时（`TargetStatusAction.tsx:595-612`）：若 `refreshBranchOverviewInBackground` 返回非 null（命中缓存，可能过期但立即渲染），直接 `setOverview`；否则 `ensureBranchOverview` 阻塞拉一次（`TargetStatusAction.tsx:608-611`）。
- mutation 命中后维护缓存：`switchBranch` 用 `patchBranchOverview` + `cachedBranchOverview` 直接回写并读回（`:200-208`）；`createBranch`/`confirmPrune`/`restoreAbandonedSnapshot` 用 `invalidateBranchOverview` + `ensureBranchOverview`（`:246-249`、`:328-331`、`WorktreeConsoleView.tsx:404-405`）。
- `fetchOverview`（`branch-overview-cache.ts:48-73`）调 `adapter.gitOverview(sessionId)`（`:52`），仅当 `patchEpochs` 的 epoch 未变才回写/清缓存（`:58`、`:61-62`、`:68`），用 epoch 防「飞行中补丁被旧 flight 覆盖」。

### 数据落点：三个 Harness 槽位

| Slot | id | order | 组件 | 关键行 |
|------|----|-------|------|--------|
| `conversation.session.header.actions` | `worktree-target` | 30 | `TargetStatusAction` | `index.ts:30-35` |
| `conversation.input.dock` | `worktree-review-status` | 10 | `WorktreeReviewStatus` | `index.ts:36-40` |
| `conversation.input.dock` | `worktree-hero-chip` | 20 | `WorktreeHeroChip`（portal `TargetStatusAction`） | `index.ts:41-45` |

## Connections

- [[client_core]] — 本模块由 `src/client/index.tsx:91-96` 的 `registerTargetConsole` 拉起（仅在注入 `WorktreeConsoleAdapter` 时）；`registerTargetConsole` 与 `TARGET_CONSOLE_STYLES` 都由 `client_core` 导入（`src/client/index.tsx:11-12`），样式在 `src/client/index.tsx:74` 注入。
- [[client_review_console]] — `WorktreeReviewStatus` 复用 review-console 的 `ReviewIcon`、``ReviewDetailsModal``、`ReviewActions`、`useReviewPreflight`、`useWorktreeRecoverySnapshot`/`restoreWorktreeRecovery`/`retryWorktreeRecovery`、`reviewEvidenceFromTarget`/`reviewIdentityFromTarget`，以及刷新事件 `requestWorktreeReviewRefresh`/`WORKTREE_REVIEW_REFRESH_EVENT`（`src/client/review-console/status-events.ts`，被 `current-polling.ts:3` 与 `TargetStatusAction.tsx:14` 引用）。`current-polling.ts` 监听的刷新事件正是 review-console 派发的。
- [[client_pre_session_worktree]] — 在同一次 `apply`（`src/client/index.tsx:49-53`）里与 `registerTargetConsole` 并行拉起，负责空白 composer 左侧 dock 的「start in a Worktree」，`WorktreeHeroChip` 用的是同一种 hero-row portal 模式。
- [[console_contract]] — `WorktreeConsoleAdapter`（`src/console-contract.ts:745-784`）是所有 git/Host 调用的唯一归一化 seam；`WorktreeConsoleTargetDetails`/`WorktreeConsoleGitOverviewResponse`/`WorktreeConsoleGitPruneResponse`/`WorktreeConsoleGitGraphCommit`/`WorktreeConsoleGitTag` 等 DTO 均定义于此。
- [[client_actions]] — `WorktreeClientServices` 来自 `src/client/actions.ts`，被本模块全部组件通过 props 接收（`index.ts:22`、各组件 props）。`openExistingSession`/`openAuthorizedWorktreeTarget`/`openIsolatedTarget` 等由 `WorktreeConsoleView`/`TargetStatusAction` 调用。

## Known Issues

- `WorktreeHeroChip` 的 hero-row 探测依赖 Harness 壳的 DOM 结构（`heroWorkspaceRow` / `composerStack` class 名，见 `WorktreeHeroChip.tsx:31-69`）。若壳把 hero row 挂到观察子树之外，只能靠 4s 有界 `setInterval` 回退（`WorktreeHeroChip.tsx:119-124`），否则不显示胶囊；`resolvePortalRenderer` 找不到 `react-dom` 时直接降级为无 hero chip（`WorktreeHeroChip.tsx:10-29`）。
- `TargetStatusAction` 的 git overview 仅在用户展开胶囊时才拉取（`TargetStatusAction.tsx:51-53`），首屏不预取，因此首次展开有网络延迟（走 `ensureBranchOverview`）。
- 轮询 `Poll` 以 `[sessionId, language]` 为 key（`current-polling.ts:22`）区分翻译结果；切换 locale 会创建新的 `Poll` 实例，旧实例在订阅者清空前不会释放（但旧实例的 `release` 由退订触发，`current-polling.ts:103`）。
- `branch-overview-cache` 是按 `sessionId` 共享的模块级缓存（`branch-overview-cache.ts:19`），注释明确「同项目每个会话覆盖同一底层 repo view」（`:6-16`），因此多个会话共享同一 overview 快照——跨会话 mutation 后依赖 `invalidateBranchOverview`/`patchBranchOverview` 显式同步，否则可能短暂展示过期分支列表。
- `WorktreeConsoleView` 的 `adapter.listAbandoned` / `restoreAbandoned` / `preflightCreate` 都是可选方法（`WorktreeConsoleAdapter` 定义带 `?`，`src/console-contract.ts:746-747`、`782-783`）；无该能力时恢复快照区与创建分支下拉不出现（`WorktreeConsoleView.tsx:93`、`225-234`、`391-392`）。
- `current-polling.ts` 的轮询是「仅展示用观测」——注释强调绝不用于授权 mutation 或 git cleanup（`current-polling.ts:21`），实际清理/切换等写操作都由 `TargetStatusAction`/`WorktreeConsoleView` 显式发起并带 `expectedRevision` CAS。
