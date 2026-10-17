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
tags:
  - client
  - boot
  - adapter
  - toolview
  - i18n
---

# Client Boot 客户端入口与启动

Client 侧是插件的浏览器运行时：把 Host 暴露的 Remote 服务适配成 `WorktreeConsoleAdapter`，向 Harness Workspace 注册 ToolView、会话徽章、会话前开关等 UI，并完成 Workspace 代际探测与启动上报。共享契约定义在 `src/console-contract.ts`（目标状态、capabilities、错误码 meta、Adapter 接口）。

## Overview

该模块负责在 DSH Web 环境中初始化 Git Worktree 插件。它包含两个主要的入口点：
1. **Browser Entry (`src/client/index.tsx`)**：用于直接嵌入 ToolView 的轻量级模式（通常用于测试或无 Remote 环境）。
2. **Remote Entry (`src/client/console-remote/index.ts`)**：生产环境的主入口，通过 Cordis Context 挂载 Remote Proxy，解析 Sidebar Topology，并根据 Host 的 Workspace 版本（Legacy/Modern/Alpha/Next）执行接管或装饰策略。

核心组件包括：
- **Adapter Layer**: 将 RPC 调用转换为带超时和严格校验的结果对象。
- **Sidebar Projection**: 将远程拓扑数据投影到本地 Workspace 视图，处理 Session/Workspace 的保护、隐藏和重定位逻辑。
- **ToolView Models**: 从日志化的 call/result 块中解析出稳定的 UI 模型。

## Key Components

### Browser Entry (`src/client/index.tsx`)

- **`WORKTREE_CONSOLE_ADAPTER_SERVICE`** (Line 23): 常量 `'worktreeConsole'`，用于在服务容器中查找适配器。
- **`inject`** (Line 36): 依赖列表 `['slots', 'workspaces', 'sessions', 'conversation', 'connection', 'locale']`。
- **`servicesOf(ctx)`** (Lines 39-47): 从 Context 提取并类型断言必要的服务 (`locale`, `workspaces`, `sessions`, `uiWorkspace`, `conversation`)。
- **`apply(ctx, adapterOverride?)`** (Lines 50-93):
    - **Localized Slots Proxy** (Lines 53-59): 包装 `ctx.slots.register`，自动为注册的 React 组件包裹 `ClientI18nProvider`。
    - **Adapter Resolution** (Lines 64-65): 优先使用 `adapterOverride`，否则从 Context 获取。
    - **Style Injection** (Lines 69-77): 创建 `<style>` 元素，设置 `data-dsh-git-worktree`, `data-plugin='dsh-git-worktree'` 等属性，注入 `WORKTREE_STYLES` 和 `TARGET_CONSOLE_STYLES`。Cleanup 时移除该元素。
    - **ToolView Registration** (Lines 79-88): 注册 `tool.call.toolview` 槽位，key 分别为 `'worktree_create'` 和 `'worktree_ready_for_review'`。
    - **Target Console** (Lines 90-93): 如果 Adapter 存在，调用 `registerTargetConsole`。

### Remote Entry (`src/client/console-remote/index.ts`)

- **`inject`** (Lines 57-63): 继承官方 Workspace 的 inject 列表，但过滤掉 `remote.directoryPicker` 和 `remoteAccess` 以避免死锁，额外声明 `slots` 和 `configForms`。
- **`apply(ctx)`** (Lines 75-200):
    - **Remote Mount** (Lines 77-85): 挂载 `contribution`，获取 `remote.gitWorktree`，创建 Adapter 并提供给 Context。
    - **Topology Fetch** (Lines 114-121): 调用 `adapter.sidebarTopology()`。失败则报告 `topology-failed` 并抛出错误。
    - **Branch Routing** (Lines 122-200):
        - **Legacy** (Lines 123-133): 检查 `sessions.open`，调用 `registerManagedWorkspaceSidebar`。
        - **Modern** (Lines 134-163): 根据 `officialWorkspaceActive` 决定 Decorate 还是 Managed。
        - **Alpha/Next** (Lines 164-193): 同 Modern 逻辑，使用对应的 `applyAlphaWorkspace` / `applyNextWorkspace`。
        - **Unsupported** (Lines 194-198): 仅挂载 Tools。
    - **`reportBoot`** (Lines 96-112): 异步上报启动报告，包含 flavor, branch, registered, elapsed times。

### Adapter Layer (`src/client/console-remote/adapter.ts`)

- **`createWorktreeConsoleRemoteAdapter(remote, getLanguage)`** (Lines 83-151):
    - **Timeout Configuration** (Lines 59-68): `FAST_TIMEOUT_MS = 30_000`, `SLOW_TIMEOUT_MS = 180_000`. `FAST_METHODS` 包含 `sidebarTopology`, `current`, `inspect`, `previewRecoveryPreflight`, `gitOverview`, `gitGraph`, `listAbandoned`。
    - **`invoke<T>`** (Lines 86-115):
        - 使用 `Promise.race` 实现超时控制。
        - 异常处理：区分 `isCodecRejection` (映射为 `malformed_response`) 和其他错误 (`transport_unavailable`)。
        - 结果校验：检查 `carrier.ok`，校验 descriptor mode 为 `strict`，并使用 schema `.parse()` 验证 payload。
    - **Method Mappings** (Lines 117-151): 将 Remote 方法映射为 Adapter 方法，例如 `sidebarTopology`, `createWithInitialCommit`, `reviewDiff`, `gitCreateBranch` 等。

### Model Layer (`src/client/model.ts`)

- **Interfaces**:
    - `ToolContentBlock` (Lines 7-10)
    - `ToolCallBlockLike` (Lines 12-19)
    - `ToolCallViewPropsLike` (Lines 21-28)
    - `WorktreeCreatePayload` (Lines 30-38)
    - `WorktreeReviewPayload` (Lines 40-47)
    - `ReviewArgs` (Lines 49-56)
    - `ParsedTool<TPayload, TArgs>` (Lines 62-66)
- **Functions**:
    - **`textContent(block)`** (Lines 68-75): 提取文本内容。
    - **`lifecycle(block)`** (Lines 82-86): 判断生命周期状态 (`running`, `stopped`, `error`, `ok`)。
    - **`parseCreateTool(block, t)`** (Lines 96-113): 解析 Create 工具调用，校验 `kind === 'worktree_target_created'` 及必填字段。
    - **`reviewArgs(value)`** (Lines 115-146): 严格校验 ReviewArgs 结构。
    - **`parseReviewTool(block, t)`** (Lines 148-181): 解析 Review 工具调用，校验 payload 和 args。

### Sidebar Logic (`src/client/workspace-sidebar/index.tsx`)

- **`ManagedOfficialWorkspaceBrowser`** (Lines 42-159):
    - 接收官方 Browser 组件，投影 workspace/session 状态。
    - 监听 `WORKTREE_REVIEW_REFRESH_EVENT` 刷新拓扑。
    - 保护 `startSession`, `forkSession`, `insertSessionBefore` 操作。
- **`deferredRemoteDirectoryPicker`** (Lines 175-191): 延迟解析 `remote.directoryPicker`，解决现代 Host 中的死锁问题。
- **`officialContextProxy`** (Lines 193-264):
    - 代理 `slots.register`，对 `sidebar.workspaces.session.menu.item` 和 `row.action` 进行守卫（除 pin 外）。
    - 替换 `sidebar.workspaces` 注册为 `ManagedOfficialWorkspaceBrowser`。
    - 提供 `__dshGitWorktreeManagedGuard` 和 deferred picker。
- **`registerManagedWorkspaceSidebar`** (Lines 271-277): 调用 `applyWorkspace` 并传入代理后的 Context。
- **`registerDecoratedWorkspaceSidebar`** (Lines 304-354):
    - 读取 slot registry，找到最低优先级的官方注册项。
    - 以 `priority - 10` 降级注册自己的 `Decorated` 组件。
    - 订阅 slot 变化，动态尝试重新装饰。

### Sidebar Model (`src/client/workspace-sidebar/model.ts`)

- **`projectManagedWorkspaceSidebar(input, t)`** (Lines 82-187):
    - 输入：workspaces, sessions, topology, archivedSessionIds, currentSessionId。
    - 输出：`ManagedWorkspaceSidebarProjection`。
    - 逻辑：
        - 提取当前任务 (`currentTasks`)。
        - 合并 Owner Session 到 Local Project。
        - 处理 Protected/Suppressed/Relocated Session IDs。
        - 基于 Directory Membership 重定位 Session。
        - 隐藏空的 Workspace。

### i18n (`src/client/i18n.tsx`, `src/i18n/core.ts`, `src/i18n/transport-messages.ts`)

- **`readClientLanguage(locale)`** (Lines 19-21): 归一化语言，失败回退 `'zh'`。
- **`ClientI18nProvider`** (Lines 29-40): 使用 `useSyncExternalStore` 管理语言上下文。
- **`transportMessages`** (`src/i18n/transport-messages.ts`): 包含 `malformed`, `mountFailed`, `workspaceGenerationUnknown`, `invokeTimeout` 四条消息。

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
│                   Client Fiber (Cordis)                       │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │              apply (console-remote/index.ts)            │  │
│  │                                                         │  │
│  │  1. Mount Remote Contribution                           │  │
│  │  2. Create Adapter (adapter.ts)                         │  │
│  │  3. Fetch Topology                                      │  │
│  │  4. Route: Legacy / Modern / Alpha / Next               │  │
│  └───────────────────┬─────────────────────────────────────┘  │
│                      │                                        │
│          ┌───────────┴───────────┐                            │
│          ▼                       ▼                            │
│  ┌──────────────────┐   ┌──────────────────────────────────┐  │
│  │ registerManaged  │   │ registerDecorated                  │  │
│  │ WorkspaceSidebar │   │ WorkspaceSidebar                   │  │
│  │ (index.tsx:271)  │   │ (index.tsx:304)                    │  │
│  │                  │   │                                    │  │
│  │ Uses             │   │ Reads Slot Registry                │  │
│  │ officialContext  │   │ Finds Lowest Priority              │  │
│  │ Proxy            │   │ Re-registers with lower priority   │  │
│  └────────┬─────────┘   └──────────────┬───────────────────┘  │
│           │                            │                       │
│           ▼                            ▼                       │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │         ManagedOfficialWorkspaceBrowser                 │  │
│  │         (index.tsx:42)                                  │  │
│  │                                                         │  │
│  │  - Projects Workspace/Session State                     │  │
│  │  - Guards Actions (start/fork/insert)                   │  │
│  │  - Renders Official Browser                             │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │              ToolViews (index.tsx:77)                   │  │
│  │                                                         │  │
│  │  worktree_create  → WorktreeCreateRow                   │  │
│  │  ready_for_review → WorktreeReviewRow                   │  │
│  └─────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

## Data Flow

1. **Initialization**:
   - `apply` is called by the Host.
   - Remote contribution is mounted.
   - `WorktreeConsoleAdapter` is created, wrapping `GitWorktreeRemote`.

2. **Topology Resolution**:
   - `adapter.sidebarTopology()` is called.
   - Result determines the `flavor` (legacy/modern/alpha/next) and `officialWorkspaceActive` status.

3. **Sidebar Integration**:
   - **Managed Mode**: The entire official Workspace Client is re-applied via a proxy context (`officialContextProxy`). This proxy intercepts service reads and slot registrations to inject protection logic.
   - **Decorated Mode**: The existing official Workspace registration is found in the slot registry. A new registration with lower priority is added, wrapping the official browser component with `ManagedOfficialWorkspaceBrowser`.

4. **State Projection**:
   - `projectManagedWorkspaceSidebar` merges remote task data with local workspace/session state.
   - It calculates `protectedSessionIds`, `suppressedSessionIds`, and `relocatedSessionIds`.
   - The `ManagedOfficialWorkspaceBrowser` uses these projections to filter and modify the UI state passed to the official browser.

5. **ToolView Interaction**:
   - User actions in ToolViews trigger methods on the `WorktreeConsoleAdapter`.
   - Adapter methods use `invoke` to make RPC calls with timeouts and strict validation.
   - Results are parsed by `parseCreateTool` or `parseReviewTool` into stable models for rendering.

## Connections

- [[target-console|Target Console]]: Handles session badges and console integration.
- [[review-console|Review Console]]: Handles review diffs and recovery logic.