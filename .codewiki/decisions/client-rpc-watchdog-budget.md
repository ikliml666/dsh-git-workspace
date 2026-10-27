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

`src/client/console-remote/adapter.ts` 实现了 `createWorktreeConsoleRemoteAdapter`（行 80-156），作为客户端与远程 Worktree Console 宿主之间的传输层代理。核心职责包括：

1. **超时防护**：底层 Web RPC 传输无原生超时机制（注释行 50-55），适配器通过 `Promise.race` 注入看门狗（行 89-94），防止 UI 永久冻结，且服务端变更调用在超时后仍在宿主安全运行并可重试。
2. **严格契约校验**：基于 `WORKTREE_CONSOLE_DESCRIPTORS` 中的描述符（行 81 构建 Map，行 105 获取 `descriptor` 并调用 `descriptor.result.create().parse` 对 `carrier.value` 进行严格解析，行 108），依赖 `src/console-remote/schemas.ts` 的 Zod schemas 确保数据一致性。
3. **错误标准化**：将网络异常、超时和格式错误统一转换为 `WorktreeConsoleOutcome<T>` 结构（类型定义见 `src/console-contract.ts` 行 695-697），并映射到 `src/console-contract.ts` 定义的语义化错误代码与元数据（行 705-738）。

## Key Components

### 常量与配置 (adapter.ts)

*   **`FAST_TIMEOUT_MS = 30_000`** (行 56)：快速路径方法的超时阈值（毫秒）。
*   **`SLOW_TIMEOUT_MS = 180_000`** (行 57)：慢速路径方法的超时阈值。
*   **`FAST_METHODS`** (行 60-65)：`Set` 结构，包含快路径方法名 `sidebarTopology`, `current`, `inspect`, `previewRecoveryPreflight`, `gitOverview`, `gitGraph`, `listAbandoned`。根据行 58-59 注释，`list`/`preflight`/`preflightCreate` 因全量重算（多记录时 20+ 次 git spawn）归入 SLOW 档，其余快路径方法保持 30s。

| 档位 | 超时常量 (行号) | 包含方法 (行号) | 特征 |
| --- | --- | --- | --- |
| FAST | `FAST_TIMEOUT_MS` 30_000 (L56) | `sidebarTopology`, `current`, `inspect`, `previewRecoveryPreflight`, `gitOverview`, `gitGraph`, `listAbandoned` (L60-L65) | 只读、不触发大量 git spawn |
| SLOW | `SLOW_TIMEOUT_MS` 180_000 (L57) | 其余方法（如 `list`, `preflight`, `preflightCreate`, `create`, `finalize` 等）(L85 三元判断) | 涉及 git 操作或全量重算 (L58-L59) |

### 辅助函数 (adapter.ts)

*   **`transport<T>(message)`** (行 31-33)：构造 `{ ok: false, error: { code: 'transport_unavailable', message } }`。
*   **`malformed<T>(method, locale)`** (行 35-37)：构造格式错误结果，使用 i18n 翻译器生成 `malformed_response` 消息。
*   **`messageOf(value)`** (行 39-43)：从 `Error` 或含 `message` 字段的对象中提取字符串。
*   **`isCodecRejection(value)`** (行 45-48)：检测消息是否含 `rejected "` 或 `返回了不符合 strict contract`，区分 codec 拒绝与传输错误。
*   **`timeoutOutcome<T>(method, locale, timeoutMs)`** (行 67-78)：构造标准化超时错误，`code: 'timeout'` 并附 i18n 消息。

### 核心函数与接口

*   **`createWorktreeConsoleRemoteAdapter(remote, getLanguage)`** (行 80-156)：
    *   输入：`remote: GitWorktreeRemote`，`getLanguage: () => Language`（默认 `() => 'zh'`）（行 80）。
    *   初始化：构建 `descriptors` Map（行 81），映射方法名到 `WORKTREE_CONSOLE_DESCRIPTORS`。
    *   内部函数 **`invoke<T>(method, call)`** (行 83-112)：
        1. 获取并标准化语言（行 84）。
        2. 依 `FAST_METHODS` 决定 `timeoutMs`（行 85）。
        3. `Promise.race` 竞跑调用与定时器（行 89-94）。
        4. 捕获异常：清定时器，按 `isCodecRejection` 返回 `malformed` 或 `transport`（行 95-98）。
        5. 检测 `timedOut` 标志返回 `timeoutOutcome`（行 100-102）。
        6. 基础结构校验：非对象或无 `ok` 布尔则 `malformed`（行 103）。
        7. 业务错误：`!carrier.ok` 时按 `isCodecRejection(carrier.error)` 转 `malformed` 或 `transport(carrier.error.message)`（行 104）。
        8. 严格校验：取 `descriptor`，非 `'strict'` 模式报 `malformed`（行 105-106），用 `descriptor.result.create().parse` 解析（行 107-111）。
    *   返回对象（行 114-155）实现 `WorktreeConsoleAdapter`，封装全部方法：
        *   `sidebarTopology` (L115)
        *   `current` (L116)
        *   `list` (L117)
        *   `preflightCreate` (L118)
        *   `createWithInitialCommit` (L119)
        *   `create` (L120)
        *   `initializeProject` (L121，内部调用 remote 方法名 `initProject`)
        *   `inspect` (L122)
        *   `reviewDiff` (L123)
        *   `preflight` (L124)
        *   `previewRecoveryPreflight` (L125)
        *   `preparePreviewRecoveryAnalysis` (L126)
        *   `createPreviewRecoveryHandoff` (L127)
        *   `preview` (L128)
        *   `checkpoint` (L129)
        *   `resumeRevision` (L130-L132)
        *   `prepareReviewRegeneration` (L133)
        *   `rollbackPreview` (L134)
        *   `discard` (L135)
        *   `finalize` (L136)
        *   `finalizePreview` (L137)
        *   `setRetention` (L138)
        *   `setPermanent` (L139)
        *   `retryCleanup` (L140)
        *   `beginNextIteration` (L141)
        *   `returnToLocal` (L142)
        *   `clearSidebarBadge` (L143)
        *   `gitOverview` (L144)
        *   `gitGraph` (L145)
        *   `gitCreateBranch` (L146)
        *   `gitSwitchBranch` (L147)
        *   `gitPruneMergedBranches` (L148)
        *   `gitListTags` (L149)
        *   `gitCreateTag` (L150)
        *   `gitDeleteTag` (L151)
        *   `gitPushTag` (L152)
        *   `listAbandoned` (L153)
        *   `restoreAbandoned` (L154)

*   **`WorktreeConsoleAdapter` 接口** (`src/console-contract.ts`, 行 745-784)：定义所有公开异步方法签名，均返回 `Promise<WorktreeConsoleOutcome<T>>`，部分方法可选（`preflightCreate?`, `createWithInitialCommit?`, `initializeProject?`, `listAbandoned?`, `restoreAbandoned?`）。
*   **`WorktreeConsoleOutcome<T>`** (`src/console-contract.ts`, 行 695-697)：联合类型 `{ ok: true; value: T }` | `{ ok: false; error: WorktreeConsoleError }`。字段：`ok` (布尔字面量)，`value` (泛型 T，仅成功分支)，`error` (WorktreeConsoleError，仅失败分支)。
*   **`WorktreeConsoleError`** (`src/console-contract.ts`, 行 688-693)：字段 `code: WorktreeConsoleErrorCode` (L689)、`message: string` (L690)、`details?: Record<string, string | number | boolean | null>` (L691)、`continuation?: WorktreeConsoleContinuation` (L692)。
*   **`WORKTREE_CONSOLE_ERROR_CODES`** (`src/console-contract.ts`, 行 609-614)：错误代码常量数组，含 `'transport_unavailable'`、`'malformed_response'`、`'timeout'`。
*   **`ERROR_META`** (`src/console-contract.ts`, 行 705-738)：映射各错误码到 `{ category, recovery, retryable }`，使用 `satisfies` 校验。

| 错误代码 | category | recovery | retryable | 定义行号 |
| --- | --- | --- | --- | --- |
| `timeout` | unavailable | retry | true | L737 |
| `transport_unavailable` | unavailable | retry | true | L735 |
| `malformed_response` | internal | none | false | L736 |

*   **`WORKTREE_CONSOLE_DESCRIPTORS`** (`src/console-remote/descriptors.ts`, 行 94-246)：冻结的 `InvocationDescriptor` 数组，覆盖 `sidebarTopology`, `clientBootReport`, `current`, `list`, `gitOverview`, `gitGraph`, `preflightCreate`, `createWithInitialCommit`, `create`, `initProject`, `inspect`, `reviewDiff`, `preflight`, `previewRecoveryPreflight`, `preparePreviewRecoveryAnalysis`, `createPreviewRecoveryHandoff`, `preview`, `checkpoint`, `resumeRevision`, `prepareReviewRegeneration`, `rollbackPreview`, `discard`, `finalize`, `finalizePreview`, `setRetention`, `setPermanent`, `retryCleanup`, `beginNextIteration`, `returnToLocal`, `clearSidebarBadge`, `gitCreateBranch`, `gitSwitchBranch`, `gitPruneMergedBranches`, `gitListTags`, `gitCreateTag`, `gitDeleteTag`, `gitPushTag`, `listAbandoned`, `restoreAbandoned`。
*   **`strictCodec`** (`src/console-remote/descriptors.ts`, 行 52-56)：构造 `{ mode: 'strict', typeSymbol, create: () => schema, schema }` 的 TypertCodec。字段：`mode` (固定 `'strict'`)，`typeSymbol` (字符串)，`create` (返回 schema 的懒加载函数)，`schema` (Zod schema 实例)。
*   **`descriptor` 工厂** (`src/console-remote/descriptors.ts`, 行 76-92)：生成 `InvocationDescriptor`，自动注入 agent 参数与 `locale` 参数。生成的 descriptor 字段：`id` (L84)，`service` (L85)，`namespace` (L86)，`method` (L87)，`invocation` (L88)，`parameters` (L89)，`result` (L90)。
*   **Zod Schemas** (`src/console-remote/schemas.ts`)：
    *   `consoleErrorSchema` (行 216-225)：错误严格结构，superRefine 确保仅 `apply_conflict` 可携带 `continuation`（行 222-224）。
    *   `outcomeSchema<T>` (行 227-232)：discriminatedUnion 包装成功/失败结果，对应 `WorktreeConsoleOutcome` 结构。
    *   响应 Schema（如 `currentResponseSchema` 行 234, `listResponseSchema` 行 246, `mutationResponseSchema` 行 273-279, `previewRecoveryPreflightResponseSchema` 行 374 等）被 `descriptors.ts` 引用，供 adapter 严格解析。

## Architecture

```text
┌──────────────────────────────────────────────────────────┐
│                     Client UI Layer                       │
└─────────────────────────┬────────────────────────────────┘
                          │ calls adapter methods (adapter.ts L114-L155)
                          ▼
┌──────────────────────────────────────────────────────────┐
│           WorktreeConsoleRemoteAdapter                     │
│  File: src/client/console-remote/adapter.ts               │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ invoke<T>() (L83-L112)                               │ │
│  │ 1. Timeout: FAST vs SLOW (L85)                       │ │
│  │ 2. Promise.race(call, timer) (L89-L94)              │ │
│  │ 3. Branch: catch→malformed/transport (L95-L98)      │ │
│  │     timedOut→timeoutOutcome (L100-L102)             │ │
│  │     ok→descriptor.parse strict (L105-L111)          │ │
│  └───────────────────────────┬──────────────────────────┘ │
└──────────────────────────────┼───────────────────────────┘
                               │ invokes remote method
                               ▼
┌──────────────────────────────────────────────────────────┐
│  GitWorktreeRemote (Underlying Web RPC, No Native Timeout) │
└─────────────────────────┬────────────────────────────────┘
                          │ returns RemoteResult<Outcome>
                          ▼
┌──────────────────────────────────────────────────────────┐
│  Host / Server Handler (Executes Ops, validated by        │
│  src/console-remote/schemas.ts)                           │
└──────────────────────────────────────────────────────────┘
```

## Data Flow

1.  **初始化**：`createWorktreeConsoleRemoteAdapter` 被调用（行 80），遍历 `WORKTREE_CONSOLE_DESCRIPTORS` 构建 `descriptors` Map（行 81），绑定方法名与 Schema 描述符。
2.  **方法调用**：客户端调用 Adapter 方法（如 `current()` 在行 116）。
3.  **路由与超时设置**：内部调用 `invoke<T>('current', ...)`（行 83）。`invoke` 检查 `'current'` 在 `FAST_METHODS` 中（行 60-65），选 `FAST_TIMEOUT_MS` = 30s（行 85）。
4.  **竞跑执行**：`Promise.race` 同时启动 `remote.current()` 与延迟 `timeoutMs` 的定时器（行 89-94）。
5.  **结果处理**：
    *   **正常**：清定时器（行 99），校验结构（行 103）。`ok: true` 时取 descriptor（行 105），要求 `strict` 模式（行 106），用 `descriptor.result.create().parse` 解析（行 108），成功返回 `{ ok: true, value }`。
    *   **超时**：定时器触发返回 `{ timedOut: true }`，检测后返回 `timeoutOutcome`（行 100-102）。
    *   **异常**：捕获错误（行 95），清定时器（行 96），按 `isCodecRejection` 返回 `malformed` 或 `transport`（行 97）。
6.  **错误分类**：最终均封装为 `WorktreeConsoleOutcome` 的 `{ ok: false, error }`。消费端据 `code` 查 `worktreeConsoleErrorMeta`（行 740-742）获取类别与重试策略。

## Connections

*   [[web-rpc-transport-has-no-timeout]]：解释底层传输无超时，故需客户端看门狗（adapter.ts L50-L55, L89-L94）。
*   [[learnings/git-spawn-budget-list-latency]]：解释 `list` 等因 git spawn 预算归 SLOW 档（adapter.ts L58-L59, L85）。
*   `src/console-contract.ts`：定义 `WorktreeConsoleAdapter` 接口、类型、`ERROR_META` 与错误码。
*   `src/console-remote/schemas.ts`：提供 adapter 严格解析使用的 Zod 验证 Schema。
*   `src/console-remote/descriptors.ts`：提供方法描述符与 strict codec 构造。

## Known Issues

*   **客户端超时与服务端状态分歧**：超时仅终止客户端等待（adapter.ts L50-L55 注释明确 server work keeps running），对于 `create`/`finalize` 等 mutating 调用，重试安全依赖 Host 端 CAS（如 `expectedRevision` 参数，见 console-contract.ts L303、L372 等），adapter 本身不保证幂等。
*   **Descriptor 强依赖**：`invoke` 在行 105-106 要求 `descriptor?.result.mode !== 'strict'` 时直接返回 `malformed`。若 `WORKTREE_CONSOLE_DESCRIPTORS` 漏配新增方法，客户端将永远收到 `malformed_response`，需确保 descriptors.ts (L94-L246) 与 schemas.ts 同步。
