---
title: "Web RPC 传输层超时修复：从永久卡死到时中断"
type: learning
source_files:
  - src/client/console-remote/adapter.ts
  - src/client/console-remote/index.ts
  - src/i18n/transport-messages.ts
tags:
  - rpc
  - timeout
  - client
  - debugging
---

## Overview

本文档记录了 `Worktree Console` 模块中 Web RPC 传输层超时机制的设计与实现。底层 Web RPC 载体（Browser Fetch + Gateway + Host Handler）本身不具备超时能力，服务端 handler 若发生停滞（如绑定锁队列阻塞、git 命令挂起），将导致客户端 UI 永久冻结在 pending 状态（见 `src/client/console-remote/adapter.ts:50-55` 的注释说明）。

为解决此问题，在 `src/client/console-remote/adapter.ts` 的 `createWorktreeConsoleRemoteAdapter` 函数（行 80-156）中引入了客户端侧超时兜底策略。通过 `invoke` 内部（行 83-112）的 `Promise.race` 竞争实际 RPC 调用与定时器（行 89-94），强制在特定时间阈值后中断等待，并返回标准化的错误响应（行 100-102 检测超时并返回 `timeoutOutcome`）。这确保了即使服务端操作仍在继续，客户端也能及时释放 UI 资源，且基于幂等性设计的 mutating 调用可安全重试。

## Key Components

### `src/client/console-remote/adapter.ts`

该文件是 Worktree Console 的远程适配器核心，负责封装所有与后端交互的 RPC 调用，并提供统一的错误处理、国际化翻译和超时控制。

**常量定义**

*   **`FAST_TIMEOUT_MS = 30_000`** (`adapter.ts:56`): 快速路径方法的超时阈值，单位为毫秒。适用于大多数即时响应的方法。
*   **`SLOW_TIMEOUT_MS = 180_000`** (`adapter.ts:57`): 慢速路径方法的超时阈值。适用于涉及全量重算或多次 git spawn 的操作（见行 58-59 注释：`list/preflight/preflightCreate` 全量重算可能逼近 30s，放 SLOW 档；其余快路径方法保持 30s）。
*   **`FAST_METHODS`** (`adapter.ts:60-65`): 一个 `Set<string>`，包含使用快速超时阈值的 RPC 方法名列表：
    *   `'sidebarTopology'`: 侧边栏拓扑结构获取。
    *   `'current'`: 当前会话状态获取。
    *   `'inspect'`: 检查点检查。
    *   `'previewRecoveryPreflight'`: 预览恢复预检。
    *   `'gitOverview'`: Git 概览信息。
    *   `'gitGraph'`: Git 图结构。
    *   `'listAbandoned'`: 列出已放弃的工作树。

**辅助函数**

*   **`transport<T>(message: string): WorktreeConsoleOutcome<T>`** (`adapter.ts:32-34`): 生成标准的传输不可用错误结果，错误码为 `transport_unavailable`。
*   **`malformed<T>(method: string, locale: Language): WorktreeConsoleOutcome<T>`** (`adapter.ts:36-38`): 生成响应格式错误的结果，错误码为 `malformed_response`，消息经过 i18n 翻译（调用 `createTranslator(transportMessages, locale)('malformed', { method })`）。
*   **`messageOf(value: unknown): string`** (`adapter.ts:39-43`): 从任意值中提取错误消息字符串。优先取 `Error` 对象的 `message`，其次取对象属性的 `message`，最后转为字符串。
*   **`isCodecRejection(value: unknown): boolean`** (`adapter.ts:45-48`): 判断错误是否由编解码器拒绝引起。检测消息中是否包含 `rejected "` 或 `返回了不符合 strict contract`。
*   **`timeoutOutcome<T>(method: string, locale: Language, timeoutMs: number): WorktreeConsoleOutcome<T>`** (`adapter.ts:67-78`): 生成超时错误结果，错误码为 `timeout`，消息通过 `transportMessages.invokeTimeout` 翻译，包含方法名和超时秒数（使用 `Math.round(timeoutMs / 1000)`）。

**核心函数**

*   **`createWorktreeConsoleRemoteAdapter(remote: GitWorktreeRemote, getLanguage: () => Language = () => 'zh'): WorktreeConsoleAdapter`** (`adapter.ts:80-156`):
    *   **用途**: 工厂函数，创建符合 `WorktreeConsoleAdapter` 接口的适配器实例。
    *   **参数**:
        *   `remote`: `GitWorktreeRemote` 类型的远程代理对象，包含所有具体的 RPC 方法实现。
        *   `getLanguage`: 可选函数，用于获取当前用户语言环境，默认为 `'zh'`。
    *   **内部逻辑**:
        *   初始化 `descriptors` Map（行 81），映射方法名到其契约描述符（来自 `WORKTREE_CONSOLE_DESCRIPTORS`）。
        *   定义内部泛型函数 `invoke<T>`（行 83-112），这是所有 RPC 调用的统一入口。
        *   返回包含所有具体方法实现的适配器对象（行 114-155），每个方法都委托给 `invoke`。

*   **`invoke<T>(method: string, call: (locale: Language) => Promise<RemoteResult<WorktreeConsoleOutcome<T>>>): Promise<WorktreeConsoleOutcome<T>>`** (`adapter.ts:83-112`):
    *   **用途**: 执行单个 RPC 调用，并应用超时、错误分类和响应校验逻辑。
    *   **步骤**:
        1.  **确定超时阈值** (行 84-85): 调用 `normalizeLanguage(getLanguage())` 获取 locale；检查 `method` 是否在 `FAST_METHODS` 中，决定使用 `FAST_TIMEOUT_MS` 还是 `SLOW_TIMEOUT_MS`。
        2.  **启动竞争** (行 88-94): 使用 `Promise.race` 竞争两个 Promise：
            *   `call(locale)`: 实际的远程 RPC 调用。
            *   `new Promise<{timedOut: true}>(resolve => setTimeout(...))`: 超时定时器，将 `timer` 变量赋值（行 92）。
        3.  **异常处理** (行 95-98): 如果 `call` 抛出异常，清除定时器（行 96），如果是编解码器拒绝 (`isCodecRejection`)，返回 `malformed` 错误；否则返回 `transport` 错误。
        4.  **超时处理** (行 99-102): 清除定时器后，若 `carrier` 为非 null 对象且含有 `timedOut` 属性，返回 `timeoutOutcome`。
        5.  **响应结构校验** (行 103): 确保 `carrier` 是对象且包含布尔类型的 `ok` 字段，否则返回 `malformed`。
        6.  **业务错误传递** (行 104): 如果 `carrier.ok` 为 false，检查是否为编解码器拒绝，若是则返回 `malformed`，否则返回 `transport` 错误（使用 `carrier.error.message`）。
        7.  **严格契约解析** (行 105-111): 获取描述符，若 `descriptor?.result.mode !== 'strict'` 返回 `malformed`；否则尝试 `descriptor.result.create().parse(carrier.value)`，捕获异常返回 `malformed`，成功则返回解析后的值。

**导出的适配器方法列表** (`adapter.ts:114-155`)

以下方法均直接委托给 `invoke`，参数结构略有不同，但核心逻辑一致：

*   `sidebarTopology()` (行 115): 获取侧边栏拓扑。
*   `current(request)` (行 116): 获取当前会话。
*   `list(request)` (行 117): 列出工作树。
*   `preflightCreate(request)` (行 118): 创建预检。
*   `createWithInitialCommit(request)` (行 119): 带初始提交的创建。
*   `create(request)` (行 120): 基本创建。
*   `initializeProject(request)` (行 121): 初始化项目（方法名映射为 `'initProject'`）。
*   `inspect(request)` (行 122): 检查点检查。
*   `reviewDiff(request)` (行 123): 审查差异。
*   `preflight(request)` (行 124): 预检。
*   `previewRecoveryPreflight(request)` (行 125): 预览恢复预检。
*   `preparePreviewRecoveryAnalysis(request)` (行 126): 准备预览恢复分析。
*   `createPreviewRecoveryHandoff(request)` (行 127): 创建预览恢复交接。
*   `preview(request)` (行 128): 预览。
*   `checkpoint(request)` (行 129): 检查点。
*   `resumeRevision(request)` (行 130-132): 恢复修订（根据 `conflictContinuation` 存在与否调用不同远程重载）。
*   `prepareReviewRegeneration(request)` (行 133): 准备审查再生。
*   `rollbackPreview(request)` (行 134): 回滚预览。
*   `discard(request)` (行 135): 丢弃。
*   `finalize(request)` (行 136): 最终化。
*   `finalizePreview(request)` (行 137): 最终化预览。
*   `setRetention(request)` (行 138): 设置保留期。
*   `setPermanent(request)` (行 139): 设置永久。
*   `retryCleanup(request)` (行 140): 重试清理。
*   `beginNextIteration(request)` (行 141): 开始下一次迭代。
*   `returnToLocal(request)` (行 142): 返回本地。
*   `clearSidebarBadge(request)` (行 143): 清除侧边栏徽标。
*   `gitOverview(sessionId)` (行 144): Git 概览。
*   `gitGraph(sessionId, limit)` (行 145): Git 图。
*   `gitCreateBranch(sessionId, name)` (行 146): 创建 Git 分支。
*   `gitSwitchBranch(sessionId, branch)` (行 147): 切换 Git 分支。
*   `gitPruneMergedBranches(sessionId, dryRun)` (行 148): 修剪已合并分支。
*   `gitListTags(sessionId)` (行 149): 列出 Git 标签。
*   `gitCreateTag(request)` (行 150): 创建 Git 标签。
*   `gitDeleteTag(request)` (行 151): 删除 Git 标签。
*   `gitPushTag(request)` (行 152): 推送 Git 标签。
*   `listAbandoned(request)` (行 153): 列出已放弃项。
*   `restoreAbandoned(request)` (行 154): 恢复已放弃项。

### `src/client/console-remote/index.ts`

该文件是 Client Fiber 的入口点，负责挂载 Remote 贡献、创建适配器、注册 UI 组件并报告启动状态。

**导出成员**

*   **`inject`** (`index.ts:45-49`): 一个服务注入数组。它是官方 Workspace 注入列表的子集，通过 `officialWorkspaceInject.filter(service => service !== 'remote.directoryPicker' && service !== 'remoteAccess')` 过滤掉了 `remote.directoryPicker` 和 `remoteAccess` 以避免死锁（详见行 18-44 注释），并附加 `'slots'` 和 `'configForms'` 以确保插件设置卡片能正确挂载。
*   **`apply(ctx: ConsoleClientContext): Promise<void>`** (`index.ts:62-196`):
    *   **用途**: 主激活函数，执行 Worktree Console 的完整启动流程。
    *   **步骤**:
        1.  **挂载 Remote** (行 63-66): 调用 `ctx.remote.$mount(contribution)` 挂载 Git Worktree Remote 命名空间，并记录挂载耗时 `elapsedMountMs`。
        2.  **获取远程代理** (行 67-70): 从上下文获取 `remote.gitWorktree`。如果未找到，抛出 `mountFailed` 错误（使用 `transportMessages` 的 `mountFailed` 翻译）。
        3.  **创建适配器** (行 71): 调用 `createWorktreeConsoleRemoteAdapter` 创建适配器实例，传入 `remote` 和 `getLanguage`。
        4.  **提供适配器** (行 72): 将适配器作为 `worktreeConsole` 服务提供给上下文（`ctx.provide('worktreeConsole', adapter)`）。
        5.  **挂载设置卡片** (行 73): 调用 `mountSettingsCard`。
        6.  **定义工具挂载函数** (行 75-81): `mountTools` 函数用于在工作区上下文中注入工具视图（`applyToolViews`）。
        7.  **定义启动报告函数** (行 84-100): `reportBoot` 函数用于向远程发送启动报告（调用 `remote.clientBootReport`），包含 flavor、注册状态、耗时等信息，诊断最佳努力。
        8.  **获取拓扑** (行 101-109): 调用 `adapter.sidebarTopology()` 获取工作区客户端形态（记录 `elapsedTopologyMs`）。如果失败，报告并抛出 `workspaceGenerationUnknown` 错误。
        9.  **分支注册逻辑** (行 110-195): 根据 `topology.value.workspaceClientFlavor` 分发不同的注册策略：
            *   `'legacy'` (行 110-119): 检查 `sessions.open` 可用性，注册托管侧边栏 (`registerManagedWorkspaceSidebar`) 并挂载工具。
            *   `'modern'` (行 120-155):
                *   如果 `officialWorkspaceActive` 为真，注册装饰侧边栏 (`registerDecoratedWorkspaceSidebar`) 并挂载工具（行 121-138）。
                *   否则，注册托管侧边栏并传入 `applyOfficialWorkspace`（行 139-154）。
            *   `'alpha'` / `'next'` (行 156-191):
                *   如果 `officialWorkspaceActive` 为真，注册装饰侧边栏（行 160-174）。
                *   否则，注册托管侧边栏并传入对应的 `applyWorkspace`（行 175-190）。
            *   其他 (行 192-194): 报告不支持，仅挂载工具。

### `src/i18n/transport-messages.ts`

该文件定义了传输层相关的国际化消息。

**常量**

*   **`transportMessages`** (`transport-messages.ts:3-20`): 一个满足 `MessageCatalog` 类型的对象，包含以下消息：
    *   **`malformed`** (`transport-messages.ts:4-7`): 当 Remote 返回不符合 strict contract 的 payload 时使用。
        *   zh: `Remote {method} 返回了不符合 strict contract 的 payload`
        *   en: `Remote {method} returned a payload that does not match the strict contract`
    *   **`mountFailed`** (`transport-messages.ts:8-11`): 当 Worktree Console Remote 命名空间挂载失败时使用。
        *   zh: `Worktree Console Remote namespace 挂载失败`
        *   en: `Failed to mount the Worktree Console Remote namespace`
    *   **`workspaceGenerationUnknown`** (`transport-messages.ts:12-15`): 当无法识别 Host Workspace Client 形态时使用。
        *   zh: `无法识别当前安装的 Host Workspace Client 形态`
        *   en: `Could not identify the installed Host Workspace generation`
    *   **`invokeTimeout`** (`transport-messages.ts:16-19`): 当 RPC 调用超时时使用。
        *   zh: `Remote {method} 在 {seconds} 秒内未返回响应，本次调用已中止。服务端操作可能仍在进行，可稍后重试或重启 dsh web。`
        *   en: `Remote {method} returned no response within {seconds}s and the call was aborted. The server-side work may still be running; retry shortly or restart dsh web.`

## Architecture

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Client Fiber (index.ts)                             │
│                                                                             │
│  1. Mount Remote Contribution (index.ts:64)                                │
│  2. Create Adapter (adapter.ts:71,80-156)                                  │
│  3. Resolve Topology (adapter.sidebarTopology, index.ts:102)               │
│  4. Branch Registration (Legacy/Modern/Alpha/Next) (index.ts:110-195)     │
│  5. Report Boot Status (reportBoot, index.ts:84-100)                       │
└──────────────────────────────────────────────────────────────────────────┼──┘
                                                                         │
┌────────────────────────────────────────────────────────────────────────▼──┐
│                     Adapter Layer (adapter.ts)                            │
│                                                                           │
│  createWorktreeConsoleRemoteAdapter (adapter.ts:80)                       │
│  ├── invoke<T>() (adapter.ts:83-112) [Core Logic]                         │
│  │   ├── Determine Timeout (FAST vs SLOW) (adapter.ts:85)                │
│  │   ├── Promise.race(RPC Call, Timer) (adapter.ts:89-94)                 │
│  │   ├── Handle Error (Malformed vs Transport) (adapter.ts:97,104)        │
│  │   ├── Handle Timeout (adapter.ts:100-102)                              │
│  │   └── Parse Strict Contract (adapter.ts:105-108)                       │
│  └── Concrete Methods (sidebarTopology, current, list, ...) (114-155)      │
│       └── delegate to invoke()                                            │
└──────────────────────────────────────────────────────────────────────────┼──┘
                                                                         │
┌────────────────────────────────────────────────────────────────────────▼──┐
│                        Remote Proxy (remote.js)                           │
│                                                                           │
│  GitWorktreeRemote                                                        │
│  ├── sidebarTopology()                                                   │
│  ├── current()                                                           │
│  ├── list()                                                              │
│  └── ... (all RPC methods)                                               │
└──────────────────────────────────────────────────────────────────────────┼──┘
                                                                         │
┌────────────────────────────────────────────────────────────────────────▼──┐
│                      Web RPC Carrier (No Timeout)                         │
│                                                                           │
│  Browser Fetch POST → Gateway AbortController → Host Handler Await        │
│  (If Handler Stalls, Response Never Returns → UI Freeze)                  │
└──────────────────────────────────────────────────────────────────────────┘
```

## Data Flow

以 `adapter.create` 为例（对应 `adapter.ts:120` 定义，委托给 `invoke('create', ...)`），数据流如下：

1.  **用户操作**: 用户在 UI 上点击「创建 Worktree」。
2.  **适配器调用**: `adapter.create(request)` 被触发（行 120）。
3.  **进入 Invoke**: 内部委托给 `invoke('create', call)`（行 83）。
4.  **确定超时**: `create` 不在 `FAST_METHODS`（行 60-65）中，因此 `timeoutMs` 设为 `SLOW_TIMEOUT_MS` (180,000ms)（行 85）。
5.  **启动竞争** (行 88-94):
    *   **RPC 路径**: `call(locale)` 执行 `remote.create(sessionId, request.branch, locale)`（行 120 内联）。
        *   这最终转化为浏览器端的 `fetch` POST 请求，经过网关到达宿主 handler。
    *   **超时路径**: `setTimeout` 启动 180 秒倒计时（行 92）。
6.  **结果分支**:
    *   **正常完成**: 如果 RPC 在 180 秒内返回，`Promise.race` 选择 RPC Promise（行 89-90）。
        *   检查 `carrier.ok`（行 103-104）。
        *   如果 `ok` 为 true，尝试解析 strict contract（行 105-108）。
        *   返回解析后的 `WorktreeConsoleOutcome<T>`。
    *   **超时**: 如果 180 秒内无响应，`Promise.race` 选择超时 Promise（行 91-93）。
        *   检测到 `timedOut` 属性（行 100）。
        *   调用 `timeoutOutcome`，生成 `{ code: 'timeout', message: ... }`（行 101, 67-78）。
        *   消息通过 `transportMessages.invokeTimeout` 翻译，包含方法名和超时秒数（行 72-75）。
        *   返回错误结果，前端展示给用户。
    *   **异常**: 如果 RPC 调用抛出异常（如网络断开）。
        *   清除定时器（行 96）。
        *   检查是否为编解码器拒绝（行 97）。
        *   返回相应的 `malformed` 或 `transport` 错误。

## Connections

*   [[console-contract]]: 定义了 `WorktreeConsoleAdapter`, `WorktreeConsoleOutcome`, `GitWorktreeRemote` 等类型和描述符（被 `adapter.ts` 导入，行 3-27）。
*   [[dsh-client-connection]]: 底层的 Web RPC 载体，提供 `fetch` 通信能力，但无内置超时。
*   [[dsh-api-gateway]]: 网关层，管理连接和 AbortController，但不设时限。
*   [[deepseek-harness]]: 宿主环境，其中的 `rpcFetchHandler` 负责执行服务端 handler，若 handler 挂起会导致无限等待。
*   [[i18n-core]]: 提供 `createTranslator` 和 `normalizeLanguage` 功能（见 `adapter.ts:1,84`），用于国际化支持。