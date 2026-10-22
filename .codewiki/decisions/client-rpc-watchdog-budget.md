---
title: "Worktree Console RPC 适配器：超时看门狗与契约校验"
type: decision
source_files:
  - src/client/console-remote/adapter.ts
  - src/console-contract.ts
  - src/console-remote/schemas.ts
tags:
  - rpc
  - timeout
  - design
  - client
---

## Overview

`src/client/console-remote/adapter.ts` 实现了 `createWorktreeConsoleRemoteAdapter`，作为客户端与远程 Worktree Console 宿主之间的传输层代理。核心职责包括：
1. **超时防护**：由于底层 Web RPC 传输无原生超时机制，适配器通过 `Promise.race` 注入看门狗，防止 UI 永久冻结。
2. **严格契约校验**：基于 `src/console-remote/schemas.ts` 中的 Zod schemas 对服务端响应进行严格解析（strict parsing），确保数据一致性。
3. **错误标准化**：将网络异常、超时和格式错误统一转换为 `WorktreeConsoleOutcome<T>` 结构，并映射到 `src/console-contract.ts` 定义的语义化错误代码。

## Key Components

### 常量与配置 (adapter.ts)

*   **`FAST_TIMEOUT_MS = 30_000`** (Line 53): 快速路径方法的超时阈值（毫秒）。
*   **`SLOW_TIMEOUT_MS = 180_000`** (Line 54): 慢速路径方法（通常涉及 git 操作或全量重算）的超时阈值。
*   **`FAST_METHODS`** (Lines 57-62): 一个 `Set`，包含被视为“快路径”的方法名。这些方法通常只读且不触发大量 git spawn。
    *   内容: `'sidebarTopology'`, `'current'`, `'inspect'`, `'previewRecoveryPreflight'`, `'gitOverview'`, `'gitGraph'`, `'listAbandoned'`。
    *   注释指出 `list/preflight/preflightCreate` 因可能触发 20+ 次 git spawn 被排除在此集合外，归入 SLOW 档。

### 辅助函数 (adapter.ts)

*   **`transport<T>(message)`** (Lines 28-30): 构造表示传输不可用的错误结果 `{ ok: false, error: { code: 'transport_unavailable', ... } }`。
*   **`malformed<T>(method, locale)`** (Lines 32-34): 构造表示响应格式错误的结果，使用 i18n 翻译器生成消息。
*   **`messageOf(value)`** (Lines 36-40): 从 Error 对象或普通值中提取人类可读的错误消息字符串。
*   **`isCodecRejection(value)`** (Lines 42-45): 检测错误消息是否包含 codec 拒绝特征（如 `rejected "` 或 `返回了不符合 strict contract`），用于区分传输层错误和协议校验错误。
*   **`timeoutOutcome<T>(method, locale, timeoutMs)`** (Lines 64-75): 构造标准化的超时错误结果，包含 `code: 'timeout'` 及对应的 i18n 消息。

### 核心类/函数

*   **`createWorktreeConsoleRemoteAdapter(remote, getLanguage)`** (Lines 77-147):
    *   **输入**: `remote: GitWorktreeRemote` (远程调用实现), `getLanguage: () => Language` (默认 `'zh'`)。
    *   **初始化**: 构建 `descriptors` Map (Line 78)，将方法名映射到 `WORKTREE_CONSOLE_DESCRIPTORS` 中的 Schema 描述符。
    *   **内部函数 `invoke<T>`** (Lines 80-109):
        *   **逻辑**:
            1.  获取语言环境并标准化 (Line 81)。
            2.  根据 `FAST_METHODS` 决定超时时间 (Line 82)。
            3.  启动 `Promise.race` 竞跑实际调用与定时器 (Lines 86-91)。
            4.  捕获异常：清除定时器，检查是否为 codec 拒绝（返回 `malformed`）或其他传输错误（返回 `transport`）(Lines 92-95)。
            5.  检查 `timedOut` 标志：若是，返回 `timeoutOutcome` (Lines 97-99)。
            6.  基础结构校验：检查返回值是否为对象且包含 `ok` 布尔字段，否则返回 `malformed` (Line 100)。
            7.  业务错误处理：若 `ok === false`，再次检查是否为 codec 拒绝，否则透传错误消息 (Line 101)。
            8.  **严格校验**: 获取对应方法的 descriptor，若非 `strict` 模式则报错 (Line 103)。尝试使用 descriptor 的 schema 解析 `carrier.value` (Lines 104-108)。解析失败则返回 `malformed`。
    *   **返回**: 实现 `WorktreeConsoleAdapter` 接口的对象，包含所有工作树控制台操作方法（Lines 111-147）。每个方法都封装了对 `invoke` 的调用，传入具体的 remote 方法和参数。

*   **`WorktreeConsoleAdapter` 接口定义** (`src/console-contract.ts`, Lines 672-705):
    *   定义了所有公开的异步方法签名，如 `preflightCreate`, `create`, `sidebarTopology`, `gitOverview` 等。
    *   所有方法均返回 `Promise<WorktreeConsoleOutcome<T>>`。

*   **`WorktreeConsoleOutcome<T>` 类型** (`src/console-contract.ts`, Lines 622-624):
    *   联合类型：`{ ok: true; value: T }` | `{ ok: false; error: WorktreeConsoleError }`。

*   **`WorktreeConsoleError` 类型** (`src/console-contract.ts`, Lines 615-620):
    *   包含 `code` (ErrorCode), `message` (string), `details` (可选), `continuation` (可选恢复上下文)。

*   **`ERROR_META` 映射** (`src/console-contract.ts`, Lines 632-665):
    *   定义了每种 `WorktreeConsoleErrorCode` 对应的元数据：`category` (错误类别), `recovery` (推荐恢复动作), `retryable` (是否可重试)。
    *   关键条目:
        *   `timeout`: `{ category: 'unavailable', recovery: 'retry', retryable: true }`
        *   `transport_unavailable`: `{ category: 'unavailable', recovery: 'retry', retryable: true }`
        *   `malformed_response`: `{ category: 'internal', recovery: 'none', retryable: false }`

*   **Zod Schemas** (`src/console-remote/schemas.ts`):
    *   定义了所有请求/响应的严格验证规则。例如 `outcomeSchema` (Lines 218-223) 用于包装任意类型的成功/失败结果。
    *   `consoleErrorSchema` (Lines 207-216) 定义了错误对象的严格结构，并包含自定义校验逻辑（仅 `apply_conflict` 错误可携带 `continuation`）。
    *   具体响应 Schema 如 `currentResponseSchema`, `createResponseSchema`, `mutationResponseSchema` 等均在文件中定义并被 `adapter.ts` 引用。

## Architecture

```text
┌──────────────────────────────────────────────────────────────┐
│                     Client UI Layer                          │
└─────────────────────────────┬────────────────────────────────┘
                              │ calls adapter methods
                              ▼
┌──────────────────────────────────────────────────────────────┐
│              WorktreeConsoleRemoteAdapter                      │
│  File: src/client/console-remote/adapter.ts                  │
│                                                              │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │                   invoke<T>()                            │ │
│  │  1. Determine timeout (FAST vs SLOW)                     │ │
│  │  2. Promise.race(call(), setTimeout(timeout))            │ │
│  │  3. Handle Result:                                       │ │
│  │     - Error? → malformed/transport                       │ │
│  │     - Timeout? → timeoutOutcome                          │ │
│  │     - Invalid Structure? → malformed                     │ │
│  │     - Codec Reject? → malformed                          │ │
│  │     - Success? → Strict Parse via Descriptor Schema      │ │
│  └──────────────────────────┬───────────────────────────────┘ │
└─────────────────────────────┼────────────────────────────────┘
                              │ invokes remote method
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                  GitWorktreeRemote                           │
│  File: src/console-remote/remote.js (or .ts)                 │
│  - Underlying Web RPC Transport (No Timeout)                 │
└─────────────────────────────┬────────────────────────────────┘
                              │ returns RemoteResult<Outcome>
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                Host / Server Handler                         │
│  - Executes Worktree Operations                              │
│  - Returns JSON Response                                     │
└──────────────────────────────────────────────────────────────┘
```

## Data Flow

1.  **初始化**: `createWorktreeConsoleRemoteAdapter` 被调用时，遍历 `WORKTREE_CONSOLE_DESCRIPTORS` 构建 `descriptors` Map，将方法名与其对应的 Zod Schema 绑定。
2.  **方法调用**: 客户端调用 Adapter 上的某个方法（如 `current()`）。
3.  **路由与超时设置**: 该方法内部调用 `invoke<T>('current', ...)`。`invoke` 检查 `'current'` 是否在 `FAST_METHODS` 中，从而选择 `30s` 或 `180s` 超时。
4.  **竞跑执行**: `Promise.race` 同时启动实际的 `remote.current()` 调用和一个延迟 `timeoutMs` 的定时器。
5.  **结果处理**:
    *   **正常完成**: 定时器清除。检查返回值的结构。如果 `ok: true`，使用对应的 Descriptor Schema 进行严格解析。解析成功则返回 `{ ok: true, value: parsedData }`；解析失败则视为 `malformed`。
    *   **超时**: 定时器触发，`Promise.race` 返回 `{ timedOut: true }`。`invoke` 检测到该标志，返回 `timeoutOutcome`。
    *   **异常**: 捕获到 `error`。清除定时器。检查是否为 codec 拒绝（解析错误），是则返回 `malformed`，否则返回 `transport` 错误。
6.  **错误分类**: 无论哪种错误形式，最终都转化为 `WorktreeConsoleOutcome` 中的 `{ ok: false, error: { code, message, ... } }`。消费端可根据 `code` 查阅 `ERROR_META` 获取 `category` 和 `retryable` 信息以决定后续行为（如自动重试或显示用户提示）。

## Connections

*   [[web-rpc-transport-has-no-timeout]]: 解释了为什么需要客户端看门狗，因为底层传输无超时。
*   [[learnings/git-spawn-budget-list-latency]]: 解释了为什么 `list` 等方法被归类为 SLOW，以及与服务端批量优化的关系。
*   `src/console-contract.ts`: 定义了 `WorktreeConsoleAdapter` 接口、`WorktreeConsoleOutcome` 类型、错误代码及元数据。
*   `src/console-remote/schemas.ts`: 提供了 `adapter.ts` 中使用的严格 Zod 验证 Schema。