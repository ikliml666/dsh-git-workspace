---
title: Client Boot 客户端入口与启动
type: module
source_files:
  - src/client/index.tsx
  - src/client/console-remote/index.ts
  - src/client/console-remote/adapter.ts
  - src/client/model.ts
  - src/client/styles.ts
  - src/client/i18n.tsx
  - src/client/workspace-sidebar/index.tsx
  - src/client/workspace-sidebar/model.ts
  - src/i18n/core.ts
  - src/i18n/transport-messages.ts
  - src/console-contract.ts
  - scripts/workspace-sidebar-upstream.mjs
tags: [client, boot, adapter, toolview, i18n, sidebar]
---

## Overview

Client 侧是插件的浏览器运行时：把 Host 暴露的 Remote 服务适配成 `WorktreeConsoleAdapter`（契约见 `src/console-contract.ts` 行672‑706），向 Harness Workspace 注册 ToolView、会话徽章、侧栏装饰等 UI，并完成 Workspace 代际探测与启动上报。共享契约定义了目标状态、capabilities、错误码 meta、Adapter 接口。

该模块负责在 DSH Web 环境中初始化 Git Worktree 插件，包含两个入口点：

1. **Browser Entry**（`src/client/index.tsx`）：轻量模式，直接挂载 UI 槽位，可由测试或无 Remote 环境使用，接受可选的 `adapterOverride`。
2. **Remote Entry**（`src/client/console-remote/index.ts`）：生产主入口，通过 Cordis Context 挂载 Remote Proxy、解析 Sidebar Topology，并按 Host 的 Workspace 代际（legacy / modern / alpha / next）选择「接管」（`registerManagedWorkspaceSidebar`）还是「装饰」（`registerDecoratedWorkspaceSidebar`）策略。

核心组成：

- **Adapter Layer**：把 RPC 调用转换为带超时与严格 schema 校验的 `WorktreeConsoleOutcome` 对象。
- **Sidebar Projection**：把远程拓扑投影为本地 Workspace 视图，处理 Session/Workspace 的保护、隐藏与重定位；同时给每行拼出**带分支名**的徽章标签（`src/client/workspace-sidebar/model.ts` 行59）。
- **ToolView Models**：从日志化 call/result 块解析出稳定的 UI 模型（`src/client/model.ts`）。
- **i18n**：语言归一化与翻译器，支持 zh/en。
- **Upstream Decoration**：脚本对官方 Workspace Client 源码做精确替换以注入托管装饰（`scripts/workspace-sidebar-upstream.mjs`）。

## Key Components

### Browser Entry (`src/client/index.tsx`)

- **常量 `WORKTREE_CONSOLE_ADAPTER_SERVICE`**（行16）：`'worktreeConsole'`，服务容器里的适配器键。
- **`inject`**（行34）：`['slots', 'workspaces', 'sessions', 'conversation', 'connection', 'locale']`。
- **接口 `ClientContextLike`**（行18‑31）：字段：
  - `get(name: string): unknown`
  - `effect(setup: () => void | (() => void), label?: string): void`
  - `slots: { inject(name, callback): void; register(descriptor, component): unknown }`
- **`servicesOf(ctx)`**（行36‑44）：取出并类型断言所需服务，返回对象字段：`locale`、`workspaces`、`sessions`、`uiWorkspace`、`conversation`。
- **`apply(ctx, adapterOverride?)`**（行47‑95）：
  - **Localized Slots Proxy**（行51‑57）：包装 `ctx.slots.register`，自动为注册的 React 组件套 `ClientI18nProvider`（行54）。
  - **Adapter Resolution**（行61‑62）：优先 `adapterOverride`，否则 `ctx.get(WORKTREE_CONSOLE_ADAPTER_SERVICE)`。
  - **Style Injection**（行67‑75）：`ctx.effect` 内创建 `<style>`，标 `data-dsh-git-worktree`、`data-plugin`、`data-plugin-css`，注入 `WORKTREE_STYLES` 与 `TARGET_CONSOLE_STYLES`（行72），cleanup 时 `style.remove()`。
  - **ToolView Registration**（行77‑86）：定义 `CreateRow`/`ReviewRow`（行77‑78），两次 `ctx.slots.inject('tool.call.toolview', …)`，key 分别为 `worktree_create` 与 `worktree_ready_for_review`。
  - **Target Console**（行88‑95）：仅当 `adapter !== undefined` 时调 `registerTargetConsole`。

### Remote Entry (`src/client/console-remote/index.ts`)

- **`inject`**（行45‑49）：继承官方 Workspace 的 inject 并过滤掉 `remote.directoryPicker` 与 `remoteAccess`（行46），额外声明 `slots` 与 `configForms`。
- **接口 `ConsoleClientContext`**（行51‑53）：扩展 `Context` 加 `remote: ClientRemote & { gitWorktree: GitWorktreeRemote }`。
- **`declare module '@deepseek-ai/cordis'`**（行55‑59）：为 `Context` 增加 `worktreeConsole: WorktreeConsoleAdapter`。
- **`apply(ctx)`**（行62‑205）：
  - **Remote Mount**（行63‑66）：`ctx.remote.$mount(contribution)`，记录耗时，`ctx.effect(() => disposeRemote)`。
  - **Adapter Build**（行67‑72）：取 `remote.gitWorktree`，`createWorktreeConsoleRemoteAdapter`，`ctx.provide('worktreeConsole', adapter)`。
  - **`mountSettingsCard`**（行73）。
  - **`mountTools`**（行75‑81）：`workspaceCtx.inject(toolViewInject, child => applyToolViews(child, adapter))`——会话相关视图必须挂在 UI Workspace provider 之下。
  - **`reportBoot`**（行86‑102）：调用 `remote.clientBootReport({flavor, branch, registered, detail?, elapsedMountMs, elapsedTopologyMs}, undefined)`（行91‑95），尾部 locale 显式传 `undefined`；诊断尽力而为。
  - **Topology Fetch**（行103‑109）：`adapter.sidebarTopology()`（行104），失败则 `reportBoot('topology-failed', …)`（行107）并抛 `workspaceGenerationUnknown`。
  - **Branch Routing**（行110‑205）：
    - `legacy`（行112‑121）：要求 `sessions.open` 为函数，否则抛错；走 `registerManagedWorkspaceSidebar` + `mountTools`。
    - `modern`（行122‑161）：`officialWorkspaceActive === true` 时先 `reportBoot('modern', false, 'decorate-pending')` 再 `ctx.inject(inject, …)` 走 `registerDecoratedWorkspaceSidebar`；否则走接管（传入 `applyOfficialWorkspace`）。
    - `alpha`/`next`（行162‑200）：同构，分别用 `alphaWorkspaceInject`/`applyAlphaWorkspace` 与 `nextWorkspaceInject`/`applyNextWorkspace`。
    - 其余（行201‑205）：只挂 Tools。

### Adapter Layer (`src/client/console-remote/adapter.ts` & `src/console-contract.ts`)

- **超时档位**（行53‑54）：`FAST_TIMEOUT_MS = 30_000`、`SLOW_TIMEOUT_MS = 180_000`。
- **`FAST_METHODS`**（行57‑62）：含 `sidebarTopology`、`current`、`inspect`、`previewRecoveryPreflight`、`gitOverview`、`gitGraph`、`listAbandoned`；其余落慢档（注释说明 `list`/`preflight`/`preflightCreate` 因多记录 git spawn 逼近 30s）。
- **辅助函数**：
  - `transport<T>`（行28‑30）：返回 `transport_unavailable` 错误。
  - `malformed<T>`（行32‑34）：返回 `malformed_response` 错误。
  - `messageOf`（行36‑40）：提取错误文本。
  - `isCodecRejection`（行42‑45）：检测 codec 拒绝消息。
  - `timeoutOutcome`（行64‑75）：返回 `timeout` 错误。
- **`createWorktreeConsoleRemoteAdapter(remote, getLanguage)`**（行77‑148）：
  - **`invoke<T>`**（行80‑109）：`Promise.race` 超时；异常经 `isCodecRejection` 转 `malformed_response` 否则 `transport_unavailable`；校验 `carrier` 形状、`descriptor.result.mode === 'strict'` 及 schema `.parse()`。
  - **返回对象**（行111‑147）实现 `WorktreeConsoleAdapter`（契约行672‑706）全部方法：`sidebarTopology`、`current`、`list`、`preflightCreate`、`createWithInitialCommit`、`create`、`initializeProject`、`inspect`、`reviewDiff`、`preflight`、`previewRecoveryPreflight`、`preparePreviewRecoveryAnalysis`、`createPreviewRecoveryHandoff`、`preview`、`checkpoint`、`resumeRevision`、`prepareReviewRegeneration`、`rollbackPreview`、`discard`、`finalize`、`finalizePreview`、`setRetention`、`setPermanent`、`retryCleanup`、`beginNextIteration`、`clearSidebarBadge`、`gitOverview`、`gitGraph`、`gitCreateBranch`、`gitSwitchBranch`、`gitPruneMergedBranches`、`listAbandoned`、`restoreAbandoned`。
- **契约关键类型**：
  - `WorktreeConsoleAdapter`（行672‑706）：上述方法签名集合，含可选 `preflightCreate?` 等。
  - `WorktreeSidebarTopologyResponse`（行239‑245）：字段 `projects: WorktreeSidebarProject[]`、`workspaceClientFlavor?: 'legacy'|'alpha'|'next'|'modern'|'unsupported'`、`officialWorkspaceActive?: boolean`。
  - `WorktreeClientBootReport`（行248‑257）：字段 `flavor`、`branch`、`registered`、`detail?`、`elapsedMountMs?`、`elapsedTopologyMs?`。

### Model Layer (`src/client/model.ts`)

- **`ToolContentBlock`**（行4‑8）：字段 `type: string`、`text?: string`、`[key: string]: unknown`。
- **`ToolCallBlockLike`**（行10‑18）：字段 `callId: string`、`argsRaw?`、`call?: { argsRaw? }`、`content?`、`kind?`、`isError?`、`error?: { name?; code? }`。
- **`ToolCallViewPropsLike`**（行20‑29）：字段 `callId: string`、`sessionId?`、`toolName: string`、`block: ToolCallBlockLike`、`cwd?`、`openFile?`、`inspect?`。
- **`WorktreeCreatePayload`**（行31‑43）：字段 `kind: 'worktree_target_created'`、`checkoutId`、`targetSessionId`、`managedRoot`、`phase`、`currentOid`、`sourceSessionId`、`cwd?`、`cwdSelected?`。
- **`WorktreeReviewPayload`**（行45‑52）：字段 `kind: 'worktree_ready_for_review'`、`state: 'ready_for_review'`、`reviewId`、`revision`、`iteration`、`changedFiles: string[]`。
- **`ReviewArgs`**（行54‑61）：字段 `summary: string`、`details?`、`validationStatus: 'passed'|'failed'|'partial'|'not_run'`、`validationSummary?`、`tests: Array<{command; status; summary?}>`、`suggestedCommitMessage: string`。
- **`ToolLifecycle`**（行63）：类型 `'running'|'ok'|'error'|'stopped'`。
- **`ParsedTool<TPayload, TArgs>`**（行65‑70）：字段 `lifecycle`、`payload`、`args`、`error`。
- **函数**：
  - `textContent`（行72‑79）：拼接文本内容。
  - `parseJson`（行81‑84）：安全 JSON 解析。
  - `lifecycle`（行86‑90）：从 block 推断生命周期。
  - `isRecord`（行92‑94）：类型守卫。
  - `stringField`（行96‑98）：提取非空字符串字段。
  - `parseCreateTool`（行100‑117）：解析创建工具结果。
  - `reviewArgs`（行119‑150）：校验并构造 `ReviewArgs`。
  - `parseReviewTool`（行152‑185）：解析评审工具结果，含 `iteration` 修正（行179）。

### Sidebar Logic (`src/client/workspace-sidebar/index.tsx`)

- **`EMPTY_TOPOLOGY`**（行15）：默认空拓扑。
- **`OWNER_SAFE_SESSION_ACTIONS`**（行18）：`Set(['pin','rename','archive','session-id'])`。
- **共享拓扑机制**（行24‑40）：`sharedTopology` 与 `sharedTopologyListeners`，`setSharedTopology`（行27‑30）、`useSharedTopology`（行32‑40）。
- **`ManagedWorktreeSessionDecoration`**（行43‑48）：字段 `kind: 'managed-worktree'`、`state`、`label`、`originalTitle`。
- **`ManagedWorkspaceGuard`**（行50‑56）：字段 `ready`、`sessionIds: ReadonlySet`、`workspaceIds: ReadonlySet`、`blockSession(id)`、`blockWorkspace(id)`。
- **`OfficialWorkspaceBrowserProps`**（行58‑64）：扩展 `WorkspaceBrowserProps` 加 `adapter`、`OfficialBrowser`、`guard?`、`registerSessionMenuEntry?`。
- **`ManagedOfficialWorkspaceBrowser`**（行70‑203）：
  - 内部 `useEffect` 注册清除徽章菜单（行91‑98）。
  - `useEffect` 刷新拓扑并监听 `WORKTREE_REVIEW_REFRESH_EVENT`（行100‑125）。
  - `useMemo` 投影（行127‑133）。
  - `useLayoutEffect` 更新 guard（行135‑141）。
  - 构造 `projectedWorkspaceState`/`projectedSessionState`（行143‑172），包装 `OfficialBrowser`（行181‑202）。
- **`deferredRemoteDirectoryPicker`**（行219‑235）：延迟解析 `remote.directoryPicker` 的 Proxy。
- **`officialContextProxy`**（行237‑321）：代理 `slots.register` 对菜单项守卫（行259‑272），替换 `sidebar.workspaces` 为 `ManagedOfficialWorkspaceBrowser`（行273‑282）；代理 `remote.directoryPicker` 与 `remoteAccess` 延迟/ stub（行292‑316）。
- **`registerManagedWorkspaceSidebar`**（行328‑334）：`applyWorkspace(officialContextProxy(ctx, adapter))`。
- **`OfficialSessionMenuEntryProps`**（行337‑340）：字段 `sessionId?`、`useMenuOpenState?`。
- **`ClearSidebarBadgeMenuItem`**（行347‑381）：终态行菜单项，调用 `adapter.clearSidebarBadge`（行366）。
- **`registerClearSidebarBadgeEntry`**（行383‑393）：注册描述符 `name: 'sidebar.workspaces.session.menu.item', id: 'clear-sidebar-badge', order: 500`。
- **`SlotRegistryEntry`/`SlotRegistryService`**（行396‑410）：结构定义。
- **`registerDecoratedWorkspaceSidebar`**（行420‑472）：读 slot registry 找最低优先级官方项，以 `priority - 10` 降级注册装饰组件（行451‑463），订阅变化重试。

### Sidebar Model (`src/client/workspace-sidebar/model.ts`)

- **`SidebarWorkspaceView`**（行7‑12）：字段 `workspaceId`、`title`、`path`、`sessionIds: readonly string[]`。
- **`SidebarSessionSummary`**（行14‑21）：字段 `id`、`displayTitle`、`title?`、`cwd?`、`updatedAt?`、`blank?`。
- **`ProjectedManagedTask`**（行23‑27）：扩展 `WorktreeSidebarTask` 加 `projectId`、`projectName`、`label`。
- **`ManagedWorkspaceSidebarProjection`**（行29‑36）：字段 `workspaces`、`managedBySessionId`、`protectedSessionIds`、`protectedWorkspaceIds`、`relocatedSessionIds`、`suppressedSessionIds`。
- **`STATE_LABELS(t)`**（行38‑46）：状态→文案映射（working/ready_for_review/preview_active/preview_detached/recovery_required/finalized/discarded）。
- **`currentTasks(topology, t)`**（行48‑70）：按 owner 聚合，取 `iteration`/`revision` 大者；**行59** 生成徽章标签：`label: task.sourceBranch ? `${stateLabel} · ${task.sourceBranch}` : stateLabel`。
- **`projectManagedWorkspaceSidebar(input)`**（行77‑199）：合并远程 task 与本地状态，计算保护/隐藏/重定位集合；歧义时 fail open。

### i18n (`src/client/i18n.tsx`, `src/i18n/core.ts`, `src/i18n/transport-messages.ts`)

- **`src/i18n/core.ts`**：
  - `Language`（行2）：`'zh'|'en'`。
  - `normalizeLanguage`（行4‑6）：正则判定 en。
  - `MessageCatalog`（行8）：类型。
  - `Translator`（行14‑17）：泛型类型。
  - `createTranslator`（行19‑25）：返回翻译函数，替换 `{placeholder}`。
- **`src/i18n/transport-messages.ts`**：
  - `transportMessages`（行3‑19）：含 `malformed`、`mountFailed`、`workspaceGenerationUnknown`、`invokeTimeout` 每条带 `zh`/`en`。
- **`src/client/i18n.tsx`**：
  - `ClientTranslator`（行5）、`ClientLocaleSource`（行6‑9）。
  - `readClientLanguage`（行19‑21）：归一化语言，失败回退 `'zh'`。
  - `clientTranslator`/`defaultClientTranslator`（行23‑26）。
  - `ClientI18nProvider`（行29‑40）：`useSyncExternalStore` 管理语言。
  - `useClientLanguage`（行42）、`useClientTranslator`（行43‑46）、`translatorForServices`（行49‑51）。

### Styles (`src/client/styles.ts`)

- **`WORKTREE_STYLES`**（行3‑137）：含侧栏图标/徽章（行5‑70）、卡片（行72‑132）、评审样式（行133）、创建对话框（行135‑136）。
  - 徽章块（行17‑34）：`max-width: 168px`（行20），悬停让位（行37‑39），状态色（行40‑70）。

### Upstream Decoration Script (`scripts/workspace-sidebar-upstream.mjs`)

- **版本常量**（行5‑9）：`WORKSPACE_UI_VERSION`、`WORKSPACE_CLIENT_SHA256` 等。
- **`readOfficialWorkspaceClient`**（行11‑25）：版本与 SHA256 校验（行15‑23）。
- **`replaceExactlyOnce`**（行27‑34）、**`replaceIfPresent`**（行38‑42）：精确替换工具。
- **`decorateOfficialWorkspaceClient`**（行49‑162）：注入托管守卫、locale、元数据及 `managedWorktreeDecoration` 函数（行89‑104 注入 `managedWorktreeDecoration` 与 `ManagedWorktreeIdentity`，使用 `value.label` 优先）。
- **`materializeOfficialWorkspaceClientModule`**（行164‑196）：抽取 factory 生成虚拟模块。

## Architecture

```text
┌──────────────────────────────────────────────────────────────┐
│                      Host Environment                        │
│  ┌──────────────┐   ┌──────────────────┐   ┌───────────────┐ │
│  │ Official WS  │   │ Remote Namespace │   │ Slot Registry │ │
│  │ (Legacy/Mod) │   │ (GitWorktree)    │   │               │ │
│  └──────┬───────┘   └────────┬─────────┘   └───────┬───────┘ │
└─────────┼────────────────────┼─────────────────────┼─────────┘
          │                    │                     │
          ▼                    ▼                     ▼
┌──────────────────────────────────────────────────────────────┐
│                   Client Fiber (Cordis)                      │
│  ┌────────────────────────────────────────────────────────┐  │
│  │     apply (console-remote/index.ts:62)                 │  │
│  │  1. Mount Remote   2. Build Adapter   3. Fetch Topology│  │
│  │  4. Route: legacy / modern / alpha / next              │  │
│  └──────────────┬─────────────────────┬───────────────────┘  │
│                 ▼                     ▼                      │
│      ┌────────────────────┐  ┌──────────────────────────┐    │
│      │ registerManaged…   │  │ registerDecorated…       │    │
│      │ (sidebar:328)      │  │ (sidebar:420)            │    │
│      │ 代理 Context 接管   │  │ 降级装饰官方注册         │    │
│      └─────────┬──────────┘  └────────────┬─────────────┘    │
│                └────────────┬─────────────┘                  │
│                             ▼                                │
│      ┌──────────────────────────────────────────────────┐    │
│      │ delegated rows → managedWorktreeDecoration        │    │
│      │ label = value.label ?? state text → 徽章 + title  │    │
│      └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

## Data Flow

1. **Initialization**：Host 调 `apply`（`console-remote/index.ts:62`）；Remote contribution 挂载（行64），`WorktreeConsoleAdapter` 就绪并 `ctx.provide('worktreeConsole', adapter)`（行72）。
2. **Topology Resolution**：`adapter.sidebarTopology()`（adapter.ts:112，契约行676）返回 `workspaceClientFlavor` 与 `officialWorkspaceActive`（契约行242‑244），决定走「接管」（`registerManagedWorkspaceSidebar` sidebar:328）还是「装饰」（`registerDecoratedWorkspaceSidebar` sidebar:420）。
3. **Model Projection**：`projectManagedWorkspaceSidebar`（model.ts:77）合并远程 task 与本地状态；`currentTasks`（model.ts:48‑70）行59 算出 `label`（含分支名）。
4. **Decoration Render**：装饰层 `managedWorktreeDecoration`（由 `scripts/workspace-sidebar-upstream.mjs` 行89‑104 注入）读取行节点 `__dshGitWorktree`（在 sidebar/index.tsx:159‑164 设置），优先用 `value.label`、缺失退回 i18n 状态文案，产出带 `title` 的徽章（样式见 styles.ts:101‑34）。
5. **ToolView Interaction**：用户在 ToolView 的操作打到 Adapter，`invoke`（adapter.ts:80）带超时与严格校验返回，再由 `parseCreateTool`（model.ts:100）/`parseReviewTool`（model.ts:152）解析成稳定模型渲染。

## Connections

- [[target-console|Target Console]]：会话胶囊与 Target 面板，`currentBranch` 决定胶囊主标签。
- [[review-console|Review Console]]：评审差异与恢复流程。
- [[console-host]]：Remote 侧的 `sidebarTopology` / `current` / `list` 等投影来源。

## Known Issues

- **徽章宽度硬编码**：`max-width: 168px`（`styles.ts:20`）按「状态 · 分支名」典型长度选，超长分支名靠 ellipsis + `title` 兜底，非自适应测量。
- **装饰层依赖官方 bundle 精确片段匹配**：`scripts/workspace-sidebar-upstream.mjs` 用 `replaceExactlyOnce`（行27‑34）对官方 client 源码逐字替换，hash 校验（行21‑23）失败即报错，官方升级需同步更新脚本。
- **`value.label` 缺失回落静默**：装饰层注入的 `managedWorktreeDecoration`（upstream.mjs 行103）不区分「模型没给 label」和「空串」，均退回状态文案，排查难。
- **`reportBoot` 诊断不可靠**：`console-remote/index.ts` 行86‑102 尽力而为，catch 仅日志，`registered: true` 只说明注册调用没抛错，不代表行渲染成功。
- **过滤服务声明**：Remote Entry 的 `inject`（行45‑49）故意过滤 `remote.directoryPicker` 与 `remoteAccess` 避免死锁/挂起，相关服务通过代理延迟解析（sidebar/index.tsx:219‑235, 304‑316）。