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

# Client Boot 客户端入口与启动

Client 侧是插件的浏览器运行时：把 Host 暴露的 Remote 服务适配成 `WorktreeConsoleAdapter`，向 Harness Workspace 注册 ToolView、会话徽章、会话前开关与 Target 胶囊等 UI，并完成 Workspace 代际探测与启动上报。共享契约定义在 `src/console-contract.ts`（目标状态、capabilities、错误码 meta、Adapter 接口）。

## Overview

该模块负责在 DSH Web 环境中初始化 Git Worktree 插件。它包含两个入口点：

1. **Browser Entry**（`src/client/index.tsx`）：直接挂载 UI 槽位的轻量模式（测试或无 Remote 环境时使用）。
2. **Remote Entry**（`src/client/console-remote/index.ts`）：生产环境主入口，通过 Cordis Context 挂载 Remote Proxy、解析 Sidebar Topology，并按 Host 的 Workspace 代际（legacy / modern / alpha / next）选择「接管」还是「装饰」策略。

核心组成部分：

- **Adapter Layer**：把 RPC 调用转换为带超时与严格 schema 校验的结果对象。
- **Sidebar Projection**：把远程拓扑投影为本地 Workspace 视图，处理 Session/Workspace 的保护、隐藏与重定位；同时给每行拼出**带分支名**的徽章标签。
- **ToolView Models**：从日志化 call/result 块解析出稳定的 UI 模型。

## Key Components

### Browser Entry (`src/client/index.tsx`)

- **`WORKTREE_CONSOLE_ADAPTER_SERVICE`**（16）：常量 `'worktreeConsole'`，服务容器里的适配器键。
- **`inject`**（34）：`['slots', 'workspaces', 'sessions', 'conversation', 'connection', 'locale']`。
- **`servicesOf(ctx)`**（36-45）：取出并类型断言所需服务（`locale`、`workspaces`、`sessions`、`uiWorkspace`、`conversation`）。
- **`apply(ctx, adapterOverride?)`**（47-96）：
  - **Localized Slots Proxy**（51-59）：包装 `ctx.slots.register`，自动为注册的 React 组件套 `ClientI18nProvider`。
  - **Adapter Resolution**（61-62）：优先 `adapterOverride`，否则从 Context 取。
  - **Style Injection**（68-76）：创建 `<style>`，标 `data-dsh-git-worktree` / `data-plugin` / `data-plugin-css`，注入 `WORKTREE_STYLES` 与 `TARGET_CONSOLE_STYLES`；cleanup 时移除。自打标签是必须的——client-module 系统会收养任何没有 `data-plugin` 的 head `<style>`，并在该模块失效时删掉它。
  - **ToolView Registration**（79-88）：两次 `ctx.slots.inject('tool.call.toolview', …)`，key 分别为 `worktree_create` 与 `worktree_ready_for_review`。
  - **Target Console**（90-95）：仅当 Adapter 存在时调 `registerTargetConsole`。

### Remote Entry (`src/client/console-remote/index.ts`)

- **`inject`**（45-60）：继承官方 Workspace 的 inject 并过滤掉 `remote.directoryPicker` / `remoteAccess`（避免死锁），额外声明 `slots` 与 `configForms`。
- **`apply(ctx)`**（62-206）：
  - **Remote Mount**（64-71）：`ctx.remote.$mount(contribution)` → `ctx.get('remote.gitWorktree')` → `createWorktreeConsoleRemoteAdapter` → `ctx.provide('worktreeConsole', adapter)`。
  - **`mountTools`**（75-81）：`workspaceCtx.inject(toolViewInject, child => applyToolViews(child, adapter))`——会话相关视图必须挂在 UI Workspace provider 之下，兄弟 fiber 不能假定导航服务存在。
  - **`reportBoot`**（86-102）：`remote.clientBootReport({flavor, branch, registered, detail?, elapsedMountMs, elapsedTopologyMs}, undefined)`，尾部 locale 必须显式传（Remote proxy 按位置校验 arity）；诊断是尽力而为，绝不阻断启动。
  - **Topology Fetch**（103-109）：`adapter.sidebarTopology()` 失败则 `reportBoot('topology-failed', …)` 并抛 `workspaceGenerationUnknown`。
  - **Branch Routing**（110-206）：`legacy`（112-121，要求 `sessions.open` 可用）→ `registerManagedWorkspaceSidebar` + `mountTools`；`modern`（122-161）：`officialWorkspaceActive === true` 时先 `reportBoot('modern', false, 'decorate-pending')` 再 `ctx.inject(inject, …)` 走 `registerDecoratedWorkspaceSidebar`，否则走接管；`alpha` / `next`（162-200）同构，分别用 `alphaWorkspaceInject`/`applyAlphaWorkspace` 与 `nextWorkspaceInject`/`applyNextWorkspace`；其余（201-205）只挂 Tools。

### Adapter Layer (`src/client/console-remote/adapter.ts`)

- **超时档位**（53-54）：`FAST_TIMEOUT_MS = 30_000`、`SLOW_TIMEOUT_MS = 180_000`；`FAST_METHODS`（57-62）含 `sidebarTopology`、`current`、`inspect`、`previewRecoveryPreflight`、`gitOverview`、`gitGraph`、`listAbandoned`；`list`/`preflight`/`preflightCreate` 因多记录时 20+ 次 git spawn 逼近 30s 而落慢档。
- **`createWorktreeConsoleRemoteAdapter(remote, getLanguage)`**（77-148）：
  - **`invoke<T>`**（80-109）：`Promise.race` 超时；`isCodecRejection` → `malformed_response`，其余异常 → `transport_unavailable`；`carrier` 形状非法、`descriptor.result.mode !== 'strict'`、schema `.parse()` 抛错一律 `malformed_response`。
- **方法映射**（111-148）：`sidebarTopology`、`current`、`list`、`preflightCreate`、`createWithInitialCommit`、`create`、`reviewDiff`、`gitCreateBranch` 等。

### Model Layer (`src/client/model.ts`)

- **接口**：`ToolContentBlock`（4）、`ToolCallBlockLike`（10）、`ToolCallViewPropsLike`（20）、`WorktreeCreatePayload`（31）、`WorktreeReviewPayload`（45）、`ReviewArgs`（54）、`ToolLifecycle`（63）、`ParsedTool`（65）。
- **函数**：`textContent`（72）、`parseJson`（81）、`lifecycle`（86）、`isRecord`（92）、`stringField`（96）、`parseCreateTool`（100）、`reviewArgs`（119）、`parseReviewTool`（152）。

### Sidebar Logic (`src/client/workspace-sidebar/index.tsx`)

- **`ManagedOfficialWorkspaceBrowser`**（67-200）：接收官方 Browser，投影 workspace/session 状态，监听 `WORKTREE_REVIEW_REFRESH_EVENT` 刷新拓扑，守卫 `startSession` / `forkSession` / `insertSessionBefore`。
- **`deferredRemoteDirectoryPicker`**（216-232）：延迟解析 `remote.directoryPicker`，解决现代 Host 的死锁。
- **`officialContextProxy`**（234-318）：代理 `slots.register`，对 `sidebar.workspaces.session.menu.item` 与 `row.action` 做守卫（pin 除外），把 `sidebar.workspaces` 注册替换为 `ManagedOfficialWorkspaceBrowser`。
- **`registerManagedWorkspaceSidebar`**（325-331）：`applyWorkspace(officialContextProxy(ctx, adapter))`。
- **`ClearSidebarBadgeMenuItem`**（344-378）与 **`registerClearSidebarBadgeEntry`**（380-390）：侧栏行菜单里的「清除 Worktree 徽章」入口。
- **`registerDecoratedWorkspaceSidebar`**（417-470）：读 slot registry 找到优先级最低的官方注册项，以 `priority - 10` 降级注册自己的装饰组件，并订阅 slot 变化动态重试。

### Sidebar Model (`src/client/workspace-sidebar/model.ts`)

- **`STATE_LABELS(t)`**（38-47）：状态 → 文案表。
- **`currentTasks(topology, t)`**（48-70）：按 owner 聚合，`iteration`/`revision` 取大者；**第 59 行**是徽章标签的唯一生成点：
  ```ts
  label: task.sourceBranch ? `${stateLabel} · ${task.sourceBranch}` : stateLabel,
  ```
- **`projectManagedWorkspaceSidebar(input)`**（77-199）：合并远程 task 与本地 workspace/session 状态，算出 `protectedSessionIds`、`suppressedSessionIds`、`relocatedSessionIds`、`hiddenWorkspaceIds`；Workspace 归属歧义时 fail open（宁可让官方行继续可见，也不隐藏无法证明安全的 Session）。

徽章最终显示在**脚本装饰**的官方侧栏里：`scripts/workspace-sidebar-upstream.mjs` 的 `managedWorktreeDecoration(node, t)`（89）取 `node.__dshGitWorktree`，`label` 优先用它（`typeof value.label === "string" && value.label !== "" ? value.label : stateLabel`），并给徽章 span 加 `title: decoration.label`。样式在 `src/client/styles.ts`：徽章块（17-36）`max-width: 168px`（20，够放「状态 · 分支名」，超长 ellipsis 由 `title` 兜底可读），悬停时若该行有安全操作容器则让位（37-39）。

### i18n (`src/client/i18n.tsx`, `src/i18n/core.ts`, `src/i18n/transport-messages.ts`)

- **`readClientLanguage(locale)`**（i18n.tsx:19-21）：归一化语言，失败回退 `'zh'`。
- **`clientTranslator(language)`**（23）、**`defaultClientTranslator`**（26）。
- **`ClientI18nProvider`**（29-40）：`useSyncExternalStore` 管理语言上下文；`useClientLanguage`（42）、`useClientTranslator`（43）、`translatorForServices`（49）。
- **`src/i18n/core.ts`**：`normalizeLanguage`（4）、`MessageCatalog`（8）、`Translator`（14）、`createTranslator`（19）。
- **`src/i18n/transport-messages.ts`**：`transportMessages`（3）含 `malformed`、`mountFailed`、`workspaceGenerationUnknown`、`invokeTimeout` 四条。

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
│  │          apply (console-remote/index.ts:62)            │  │
│  │  1. Mount Remote   2. Build Adapter   3. Fetch Topology│  │
│  │  4. Route: legacy / modern / alpha / next              │  │
│  └──────────────┬─────────────────────┬───────────────────┘  │
│                 ▼                     ▼                      │
│      ┌────────────────────┐  ┌──────────────────────────┐    │
│      │ registerManaged…   │  │ registerDecorated…       │    │
│      │ (sidebar:325)      │  │ (sidebar:417)            │    │
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

1. **Initialization**：Host 调 `apply`；Remote contribution 挂载，`WorktreeConsoleAdapter` 就绪并 `ctx.provide('worktreeConsole')`。
2. **Topology Resolution**：`adapter.sidebarTopology()` 返回 `workspaceClientFlavor` 与 `officialWorkspaceActive`，决定走「接管」（重放官方模块 apply）还是「装饰」（降级重注册包装官方 Browser）。
3. **Model Projection**：`projectManagedWorkspaceSidebar` 合并远程 task 与本地状态；`currentTasks`（src/client/workspace-sidebar/model.ts:48-70）同时算出每行的 `label`（含分支名）。
4. **Decoration Render**：装饰层 `managedWorktreeDecoration`（upstream.mjs:89）读取行节点的 `__dshGitWorktree`，优先用 `value.label`、缺失才退回 i18n 状态文案，产出带 `title` 的徽章——历史上这里只查状态文案、把 `value.label` 丢掉，导致徽章永远只有「进行中/待验收/已完成」。
5. **ToolView Interaction**：用户在 ToolView 的操作打到 Adapter，`invoke` 带超时与严格校验返回，再由 `parseCreateTool` / `parseReviewTool` 解析成稳定模型渲染。

## Connections

- [[target-console|Target Console]]：会话胶囊与 Target 面板，`currentBranch` 决定胶囊主标签。
- [[review-console|Review Console]]：评审差异与恢复流程。
- [[console-host]]：Remote 侧的 `sidebarTopology` / `current` / `list` 等投影来源。

## Known Issues

- **徽章宽度是硬编码值**：`max-width: 168px`（styles.ts:20）按「状态 · 分支名」的典型长度选，遇到超长分支名只能靠 ellipsis + `title` 兜底，不是自适应测量。
- **装饰层依赖官方 bundle 的精确片段匹配**：`scripts/workspace-sidebar-upstream.mjs` 用 `replaceExactlyOnce` 对官方 client 源码做逐字替换，官方升级后即触发 hash 校验失败（`WORKSPACE_CLIENT_SHA256`），必须同步更新脚本。
- **`value.label` 缺失时的回落是静默的**：装饰层不会区分「模型没给 label」和「label 是空串」，两者都退回状态文案，排查时看不出是哪一侧的问题。
- **`reportBoot` 的诊断不可靠作为健康判据**：它同样是尽力而为（catch 后只打日志），`registered: true` 只说明注册调用没抛错，不代表行渲染成功。