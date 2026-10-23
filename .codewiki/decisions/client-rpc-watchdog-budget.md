---
title: "Worktree Console RPC 适配器：超时看门狗与契约校验"
type: decision
source_files:
  - src/client/console-remote/adapter.ts
  - src/console-contract.ts
  - src/console-remote/descriptors.ts
  - src/console-remote/schemas.ts
tags:
  - rpc
  - timeout
  - design
  - client
---

## Overview

`src/client/console-remote/adapter.ts` 实现了 `createWorktreeConsoleRemoteAdapter`（Lines 77-147），作为客户端与远程 Worktree Console 宿主之间的传输层代理。核心职责包括：

1. **超时防护**：底层 Web RPC 传输无原生超时机制（注释 Lines 47-52），适配器通过 `Promise.race` 注入看门狗（Lines 86-91），防止 UI 永久冻结，且服务端变更调用在超时后仍在宿主安全运行并可重试。
2. **严格契约校验**：基于 `WORKTREE_CONSOLE_DESCRIPTORS` 中的描述符（Line 78 构建 Map，Line 102-105 获取 `descriptor` 并调用 `descriptor.result.create().parse` 对 `carrier.value` 进行严格解析），依赖 `src/console-remote/schemas.ts` 的 Zod schemas 确保数据一致性。
3. **错误标准化**：将网络异常、超时和格式错误统一转换为 `WorktreeConsoleOutcome<T>` 结构（类型定义见 `src/console-contract.ts` Lines 622-624），并映射到 `src/console-contract.ts` 定义的语义化错误代码与元数据（Lines 536-541, 632-665）。

## Key Components

### 常量与配置 (adapter.ts)

*   **`FAST_TIMEOUT_MS = 30_000`** (Line 53)：快速路径方法的超时阈值（毫秒）。
*   **`SLOW_TIMEOUT_MS = 180_000`** (Line 54)：慢速路径方法的超时阈值。
*   **`FAST_METHODS`** (Lines 57-62)：`Set` 结构，包含快路径方法名。根据 Lines 55-56 注释，`list`/`preflight`/`preflightCreate` 因全量重算（多记录时 20+ 次 git spawn）归入 SLOW 档。

| 档位 | 超时常量 (行号) | 包含方法 (行号) | 特征 |
| --- | --- | --- | --- |
| FAST | `FAST_TIMEOUT_MS` 30_000 (L53) | `sidebarTopology`, `current`, `inspect`, `previewRecoveryPreflight`, `gitOverview`, `gitGraph`, `listAbandoned` (L57-62) | 只读、不触发大量 git spawn |
| SLOW | `SLOW_TIMEOUT_MS` 180_000 (L54) | 其余方法（如 `list`, `preflight`, `preflightCreate`, `create`, `finalize` 等） | 涉及 git 操作或全量重算 (L55-56) |

### 辅助函数 (adapter.ts)

*   **`transport<T>(message)`** (Lines 28-30)：构造 `{ ok: false, error: { code: 'transport_unavailable', message } }`。
*   **`malformed<T>(method, locale)`** (Lines 32-34)：构造格式错误结果，使用 i18n 翻译器生成 `malformed_response` 消息。
*   **`messageOf(value)`** (Lines 36-40)：从 `Error` 或含 `message` 字段的对象中提取字符串。
*   **`isCodecRejection(value)`** (Lines 42-45)：检测消息是否含 `rejected "` 或 `返回了不符合 strict contract`，区分 codec 拒绝与传输错误。
*   **`timeoutOutcome<T>(method, locale, timeoutMs)`** (Lines 64-75)：构造标准化超时错误，`code: 'timeout'` 并附 i18n 消息。

### 核心函数与接口

*   **`createWorktreeConsoleRemoteAdapter(remote, getLanguage)`** (Lines 77-147)：
    *   输入：`remote: GitWorktreeRemote`，`getLanguage: () => Language`（默认 `'zh'`）。
    *   初始化：构建 `descriptors` Map（Line 78），映射方法名到 `WORKTREE_CONSOLE_DESCRIPTORS`。
    *   内部函数 **`invoke<T>(method, call)`** (Lines 80-109)：
        1. 获取并标准化语言（Line 81）。
        2. 依 `FAST_METHODS` 决定 `timeoutMs`（Line 82）。
        3. `Promise.race` 竞跑调用与定时器（Lines 86-91）。
        4. 捕获异常：清定时器，按 `isCodecRejection` 返回 `malformed` 或 `transport`（Lines 92-95）。
        5. 检测 `timedOut` 标志返回 `timeoutOutcome`（Lines 97-99）。
        6. 基础结构校验：非对象或无 `ok` 布尔则 `malformed`（Line 100）。
        7. 业务错误：`!carrier.ok` 时按 `isCodecRejection(carrier.error)` 转 `malformed` 或 `transport(carrier.error.message)`（Line 101）。
        8. 严格校验：取 `descriptor`，非 `'strict'` 模式报 `malformed`（Line 103），用 `descriptor.result.create().parse` 解析（Lines 104-108）。
    *   返回对象（Lines 111-147）实现 `WorktreeConsoleAdapter`，封装全部方法：`sidebarTopology`, `current`, `list`, `preflightCreate`, `createWithInitialCommit`, `create`, `initializeProject`, `inspect`, `reviewDiff`, `preflight`, `previewRecoveryPreflight`, `preparePreviewRecoveryAnalysis`, `createPreviewRecoveryHandoff`, `preview`, `checkpoint`, `resumeRevision`, `prepareReviewRegeneration`, `rollbackPreview`, `discard`, `finalize`, `finalizePreview`, `setRetention`, `setPermanent`, `retryCleanup`, `beginNextIteration`, `clearSidebarBadge`, `gitOverview`, `gitGraph`, `gitCreateBranch`, `gitSwitchBranch`, `gitPruneMergedBranches`, `listAbandoned`, `restoreAbandoned`。

*   **`WorktreeConsoleAdapter` 接口** (`src/console-contract.ts`, Lines 672-705)：定义所有公开异步方法签名，均返回 `Promise<WorktreeConsoleOutcome<T>>`。
*   **`WorktreeConsoleOutcome<T>`** (`src/console-contract.ts`, Lines 622-624)：联合类型 `{ ok: true; value: T }` | `{ ok: false; error: WorktreeConsoleError }`。
*   **`WorktreeConsoleError`** (`src/console-contract.ts`, Lines 615-620)：字段 `code: WorktreeConsoleErrorCode`、`message: string`、`details?`、`continuation?`。
*   **`WORKTREE_CONSOLE_ERROR_CODES`** (`src/console-contract.ts`, Lines 536-541)：错误代码常量数组，含 `'transport_unavailable'`、`'malformed_response'`、`'timeout'`。
*   **`ERROR_META`** (`src/console-contract.ts`, Lines 632-665)：映射各错误码到 `{ category, recovery, retryable }`。

| 错误代码 | category | recovery | retryable | 定义行号 |
| --- | --- | --- | --- | --- |
| `timeout` | unavailable | retry | true | L664 |
| `transport_unavailable` | unavailable | retry | true | L662 |
| `malformed_response` | internal | none | false | L663 |

*   **Zod Schemas** (`src/console-remote/schemas.ts`)：
    *   `outcomeSchema<T>` (Lines 218-223)：discriminatedUnion 包装成功/失败结果。
    *   `consoleErrorSchema` (Lines 207-216)：错误严格结构，superRefine 确保仅 `apply_conflict` 可携带 `continuation`。
    *   响应 Schema（如 `currentResponseSchema` L225, `listResponseSchema` L237, `mutationResponseSchema` L264-270 等）被 `descriptors.ts` 引用，供 adapter 严格解析。

## Architecture

```text
┌──────────────────────────────────────────────────────────────┐
│                     Client UI Layer                          │
└─────────────────────────────┬────────────────────────────────┘
                              │ calls adapter methods (adapter.ts L111-147)
                              ▼
┌──────────────────────────────────────────────────────────────┐
│              WorktreeConsoleRemoteAdapter                      │
│  File: src/client/console-remote/adapter.ts                  │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │                   invoke<T>()  (L80-109)                 │ │
│  │  1. Timeout: FAST vs SLOW (L82)                          │ │
│  │  2. Promise.race(call, timer) (L86-91)                   │ │
│  │  3. Branch:                                         │ │
│  │     - catch → malformed/transport (L92-95)                │ │
│  │     - timedOut → timeoutOutcome (L97-99)                  │ │
│  │     - ok → descriptor.parse strict (L102-108)             │ │
│  └──────────────────────────┬───────────────────────────────┘ │
└─────────────────────────────┼────────────────────────────────┘
                              │ invokes remote method
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                  GitWorktreeRemote                           │
│  - Underlying Web RPC Transport (No Native Timeout)          │
└─────────────────────────────┬────────────────────────────────┘
                              │ returns RemoteResult<Outcome>
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                Host / Server Handler                         │
│  - Executes Ops, returns JSON (validated by schemas.ts)     │
└──────────────────────────────────────────────────────────────┘
```

## Data Flow

1.  **初始化**：`createWorktreeConsoleRemoteAdapter` 被调用（L77），遍历 `WORKTREE_CONSOLE_DESCRIPTORS` 构建 `descriptors` Map（L78），绑定方法名与 Schema 描述符。
2.  **方法调用**：客户端调用 Adapter 方法（如 `current()` 在 L113）。
3.  **路由与超时设置**：内部调用 `invoke<T>('current', ...)`（L80）。`invoke` 检查 `'current'` 在 `FAST_METHODS` 中（L57-62），选 `FAST_TIMEOUT_MS` = 30s（L82）。
4.  **竞跑执行**：`Promise.race` 同时启动 `remote.current()` 与延迟 `timeoutMs` 的定时器（L86-91）。
5.  **结果处理**：
    *   **正常**：清定时器（L96），校验结构（L100）。`ok: true` 时取 descriptor（L102），要求 `strict` 模式（L103），用 `descriptor.result.create().parse` 解析（L105），成功返回 `{ ok: true, value }`。
    *   **超时**：定时器触发返回 `{ timedOut: true }`，检测后返回 `timeoutOutcome`（L98）。
    *   **异常**：捕获错误（L92），清定时器（L93），按 `isCodecRejection` 返回 `malformed` 或 `transport`（L94）。
6.  **错误分类**：最终均封装为 `WorktreeConsoleOutcome` 的 `{ ok: false, error }`。消费端据 `code` 查 `worktreeConsoleErrorMeta`（L667-669）获取类别与重试策略。

## Connections

*   [[web-rpc-transport-has-no-timeout]]：解释底层传输无超时，故需客户端看门狗（adapter.ts L47-52, L86-91）。
*   [[learnings/git-spawn-budget-list-latency]]：解释 `list` 等因 git spawn 预算归 SLOW 档（adapter.ts L55-56, L82）。
*   `src/console-contract.ts`：定义 `WorktreeConsoleAdapter` 接口、类型、`ERROR_META` 与错误码。
*   `src/console-remote/schemas.ts`：提供 adapter 严格解析使用的 Zod 验证 Schema。

## Known Issues

*   **客户端超时与服务端状态分歧**：超时仅终止客户端等待（adapter.ts L47-52 注释明确 server work keeps running），对于 `create`/`finalize` 等 mutating 调用，重试安全依赖 Host 端 CAS（如 `expectedRevision` 参数，见 contract.ts L289, L366 等），adapter 本身不保证幂等。
*   **Descriptor 强依赖**：`invoke` 在 L103 要求 `descriptor?.result.mode !== 'strict'` 时直接返回 `malformed`。若 `WORKTREE_CONSOLE_DESCRIPTORS` 漏配新增方法，客户端将永远收到 `malformed_response`，需确保 descriptors.ts 与 schemas.ts 同步。