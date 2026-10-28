---
title: console_remote
type: module
source_files:
  - src/console-remote/descriptors.ts
  - src/console-remote/schemas.ts
  - src/console-remote/remote.ts
  - src/console-remote/typert.ts
  - tests/console-remote.test.ts
  - src/console-contract.ts
  - src/client/console-remote/adapter.ts
  - src/console-host/service.ts
  - package.json
  - src/types.ts
tags: [remote, typert, protocol, schema, codec, console]
---

## Overview

`console_remote` 是 Worktree Console 的**远程协议层**：它不实现任何业务逻辑，只负责把 Host 侧的命令式接口（`src/console-host/control-plane.ts` 的 `WorktreeConsoleControlPlane`）描述成一套 DSH Typert 协议描述符，并配套一套 strict（拒绝未知字段）的 Zod 校验 schema，供 Host 与 Client 两份独立部署的产物共享同一套 wire 契约。

模块由四个文件组成：

- `descriptors.ts` — 用 `descriptor()` 工厂拼出 39 个 `InvocationDescriptor`，导出冻结的 `WORKTREE_CONSOLE_DESCRIPTORS` 数组与 `WORKTREE_CONSOLE_REMOTE` 贡献对象。
- `schemas.ts` — 全部请求参数与响应体的 Zod 校验 schema（strict object，拒绝未知键），是 Host/Client 共享的“单一真伪边界”。
- `remote.ts` — 通过 `declare module '@deepseek-ai/dsh-typert-protocol'` 把 39 个方法的签名注入 `TypertRemoteMap`，使 Client 拿到强类型调用面；并导出 `GitWorktreeRemote` 与 `WORKTREE_CONSOLE_REMOTE`。
- `typert.ts` — `TYPERT` 手动贡献对象（face `'host'`），供官方 Typert Loader 通过包 `./typert` 导出自动发现。

设计要点：
- **一份描述符、两端共享**：Host（via `service.ts`）与 Client（via `adapter.ts`）都引用 `WORKTREE_CONSOLE_DESCRIPTORS`，避免 Host/Client 各自维护 schema 导致漂移。
- **strict 双重契约**：每个参数的 codec 同时携带旧版 `schema` 字段与 DSH 0.2 的惰性 `create()` 字段（`descriptors.ts:52-56`），保证旧适配器与 0.2 Gateway 都能消费。
- **`locale` 一律追加、`agent` 仅在该方法带身份时追加**：见 `descriptor()` 的 `withAgent` 参数（`descriptors.ts:76-92`）。`sidebarTopology` 与 `clientBootReport` 是唯二 `withAgent=false` 的方法。
- **身份由 Gateway 在业务执行前解析**：Agent 以 `source: 'lookup', lookup: 'agent'` 注入，参数名 `agent`、wire 名 `agentId`（`descriptors.ts:58-64`），Host 端在 dispatch 前完成 Session 解析（见 `tests/console-remote.test.ts:453-481`）。

## Key Components

### `src/console-remote/descriptors.ts`

| 名称 | 行号 | 用途 |
| --- | --- | --- |
| `PACKAGE` / `SERVICE` / `AGENT_WIRE_TYPE` | `46-48` | 包名 `dsh-git-worktree`、服务名 `gitWorktree`、Agent wire 类型 `@deepseek-ai/dsh-session/types#SessionId` |
| `strictCodec(typeSymbol, schema)` | `52-56` | 构造 `TypertCodec`：`{ mode: 'strict', typeSymbol, create: () => schema, schema }`，同时保留 legacy `schema` 字段与 0.2 惰性 `create()` |
| `agentParameter` | `58-64` | 共享的 Agent 参数描述符（`name:'agent'`、`wire:'agentId'`、`source:'lookup'`、`lookup:'agent'`、`codec: strictCodec(AGENT_WIRE_TYPE, sessionIdSchema)`） |
| `json(name, schema, typeSymbol, acceptsUndefined?)` | `66-74` | 构造 JSON 来源的参数描述符；当 `acceptsUndefined=true` 时追加 `acceptsUndefined: true as const` |
| `descriptor(method, parameters, resultSchema, resultType, withAgent=true)` | `76-92` | 构造单个 `InvocationDescriptor`；`id` 形如 `dsh-git-worktree#gitWorktree/<method>`，`namespace/service` 均为 `gitWorktree`，`invocation.kind:'direct'`；参数 = `[agentParameter?, ...parameters, json('locale', optionalLanguageSchema, 'string | undefined', true)]`；`result` 用 `strictCodec('dsh-git-worktree/console-contract#<resultType>', resultSchema)` 包裹 |
| `WORKTREE_CONSOLE_DESCRIPTORS` | `94-246` | `Object.freeze` 的 39 个 `InvocationDescriptor` 只读数组，每个方法一行（行 `95-245`） |
| `WORKTREE_CONSOLE_REMOTE` | `248-251` | `Object.freeze` 的 `TypertRemoteContribution`：`{ package: 'dsh-git-worktree', descriptors: WORKTREE_CONSOLE_DESCRIPTORS }` |

`WORKTREE_CONSOLE_DESCRIPTORS` 包含的 39 个方法（`descriptors.ts:95-245`）按声明顺序为：`sidebarTopology`、`clientBootReport`、`current`、`list`、`gitOverview`、`gitGraph`、`preflightCreate`、`createWithInitialCommit`、`create`、`initProject`、`inspect`、`reviewDiff`、`preflight`、`previewRecoveryPreflight`、`preparePreviewRecoveryAnalysis`、`createPreviewRecoveryHandoff`、`preview`、`checkpoint`、`resumeRevision`、`prepareReviewRegeneration`、`rollbackPreview`、`discard`、`finalize`、`finalizePreview`、`setRetention`、`setPermanent`、`retryCleanup`、`beginNextIteration`、`returnToLocal`、`clearSidebarBadge`、`gitCreateBranch`、`gitSwitchBranch`、`gitPruneMergedBranches`、`gitListTags`、`gitCreateTag`、`gitDeleteTag`、`gitPushTag`、`listAbandoned`、`restoreAbandoned`。

每个方法的参数均经过 `json()`（参数 wire 名默认与参数名相同）包装，并以 `outcomeSchema(<响应 schema>)` 作为结果；`sidebarTopology` 与 `clientBootReport` 因 `withAgent=false` 没有 `agent` 参数（`descriptors.ts:95-96`，对应 `descriptor(..., false)` 的末参）。例如 `checkpoint`（`descriptors.ts:148-155`）参数为 `checkoutId`、`expectedRevision`、`expectedReviewId`、`expectedGeneration`、`requestId`、`commitMessage`；`resumeRevision` 的 `conflictContinuation` 用 `recoveryContinuationSchema.optional()` 且 `acceptsUndefined=true`（`descriptors.ts:160`）；`rollbackPreview`/`finalizePreview` 的 `recoveryProof` 同理（`descriptors.ts:171, 192`）。

### `src/console-remote/schemas.ts`

所有 schema 均由 `strict = shape => z.object(shape).strict()`（`schemas.ts:29`）构造——strict 意味着**任何未知键都会让校验失败**，这是 Host/Client 共享契约的核心约束。

**标量 / 标识符 schema：**

| 名称 | 行号 | 约束 |
| --- | --- | --- |
| `sessionIdSchema` | `31` | `string().min(1).max(200)`，拒绝 `\0 \r \n` |
| `checkoutIdSchema` | `32` | `min(1).max(200)`，拒绝 `..`、`/ \ \0 \r \n` |
| `reviewIdSchema` | `33` | `min(1).max(200)`，拒绝 `\0 \r \n` |
| `commitMessageSchema` | `34` | `string().trim()` 且经 `isValidCommitMessage`（`../commit-message.js`）校验；支持超 500 字符多行（见测试 `tests/console-remote.test.ts:174-184`） |
| `revisionSchema` | `35` | `z.number().int().nonnegative()` |
| `gitOidSchema` | `36` | 40 或 64 位十六进制 |
| `oidSchema` | `37-41` | `'unversioned' \| 'unborn' \| gitOidSchema` 的 union |
| `previewIdSchema` | `42` | `min(1).max(200)`，拒绝 `/ \ \0 \r \n` |
| `generationSchema` | `43` | 64 位十六进制 |
| `requestIdSchema` | `44` | `min(1).max(200)`，拒绝 `\0 \r \n` |
| `branchNameSchema` | `45-50` | `trim().min(1).max(200)`，拒绝非法字符、`-`/`/` 开头、`..` 结尾、`.lock` 结尾 |
| `booleanSchema` | `51` | `z.boolean()` |
| `optionalLanguageSchema` | `52` | `z.enum(['zh','en']).optional()` |
| `optionalBooleanSchema` | `53` | `z.union([booleanSchema, z.undefined()])` |
| `retentionSchema` | `54` | `z.enum(['cleanup','retain_24h','retain_3d','retain_manual'])` |
| `retainedModeSchema` | `55` | `z.enum(['retain_24h','retain_3d','retain_manual'])`（不含 `cleanup`） |

**复合 DTO schema（均 strict）：**

- `projectSchema`（`57`）：`{ id, name }`，均 `min(1)`。
- `validationItemSchema`（`58-62`）：`{ command, status: enum(passed|failed|not_run), summary? }`。
- `checkpointSchema`（`63-71`）：`checkpointId`(`checkoutIdSchema`)、`sequence`(`positive int`)、`reviewId`、`createdAt`(`finite nonnegative`)、`summary`(`max(1000)`)、`validationStatus`(enum)、`changedFiles`(`max(500)`，每项经 path 安全校验)。
- `reviewSchema`（`72-83`）：`reviewId`、`revision`、`iteration`、`preparedAt`、`summary`、`validationStatus`、`validationSummary?`、`tests: validationItemSchema[]`、`changedFiles: string[]`、`suggestedCommitMessage`(`min(1)`)。
- `capabilitiesSchema`（`84-106`）：15 个布尔能力位（`create`、`open`、`inspect`、`discard`、`preflight`、`preview`、`checkpoint`、`resumeRevision`、`rollbackPreview`、`finalize`、`finalizePreview`、`setRetention`、`setPermanent`、`retryCleanup`、`beginNextIteration`）。`returnToLocal` 用 `z.boolean().default(false)`（`105`）——**必须容忍缺失**，因为 Client 与 Host 是独立部署产物，旧 Host 不认识新增能力位，若写成必填会让整条 `current` payload 校验失败、胶囊塌成「不可用」（见注释 `100-104` 与测试 `tests/console-remote.test.ts:215-237`）。
- `acceptanceBlockerSchema`（`107-112`）：`checkoutId`、`ownerSessionId`、`revision`、`state`(enum)。
- `deliveryProofSchema`（`113-121`）：`localBranch: string|null`、`localHeadBefore`/`localHeadAfter: oidSchema`、`changedFiles: string[]`、`validationStatus?`、`validationSummary?`、`commitInLocalHistory: boolean|null`。
- `targetSummarySchema`（`122-155`）：列表/只读态下投影出的路径无关 target 摘要；字段含 `project`、`checkoutId: nullable`、`sourceSessionId`、`ownerSessionId`、`targetSessionId: nullable`、`iteration`、`revision`、`state: enum(WORKTREE_CONSOLE_TARGET_STATES)`、`phase: enum([local,preparing,ready,applying,mutating,recovery_required,finalized,retained,discarded])`、`dirty`、`currentOid`、`commitOid: nullable`、`sourceBranch: nullable`、`retention?`、`retainedAt?`、`expiresAt?`、`permanent?`、`cleanupMessage?`、`deliveryProof?`、`review?`、`checkpoints?(max100)`、`checkpointGeneration?`、`reviewSlot?`、`reviewSlotOwnerSessionId?`、`reviewSlotHolder?: acceptanceBlockerSchema`、`previewRecovery?`（`{ previewId, detachedAt, reason: enum(stale_local|preview_modified), attemptedAction: enum(rollback_preview|finalize_preview|discard) }`）、`capabilities`。
- `safeConflictFile(file)`（`156-160`）：校验文件段不含绝对前缀、控制字符、`.`/`..` 空段。
- `recoveryContinuationSchema`（`162-170`）：`{ kind:'worktree_apply_conflict', requestId, checkoutId, reviewId, revision, localHeadOid: oidSchema, conflictingFiles: string[](max500) }`。
- `reviewRegenerationProofSchema`（`171-177`）、`previewRecoveryAnalysisProofSchema`（`178-186`）、`previewRecoveryHandoffProofSchema`（`187-196`）：三种 recovery proof（字面量 `kind` 区分）。
- `recoveryProofSchema`（`197-202`）：上述四者的 `z.discriminatedUnion('kind', ...)`。
- `targetDetailsSchema`（`203-209`）：`targetSummarySchema.extend({ managedRoot, sourceRoot, sourceOid, currentBranch, recoveryContinuation? }).strict()`——**打开 target 时才携带的路径字段**（见测试断言 `tests/console-remote.test.ts:279` 把这几个字段从 `target` 解构丢弃）。

**响应 schema：**

- `previewRecoveryHandoffResponseSchema`（`210-215`）：`{ target: targetDetailsSchema, targetSessionId, managedRoot: min(1), recoveryContinuation: previewRecoveryHandoffProofSchema }`。
- `consoleErrorSchema`（`216-225`）：`{ code: enum(WORKTREE_CONSOLE_ERROR_CODES), message, details?: record, continuation?: recoveryContinuationSchema }`，`superRefine` 限定 `continuation` 仅 `code==='apply_conflict'` 时允许（`221-224`）。
- `outcomeSchema<T>(value)`（`227-232`）：`z.discriminatedUnion('ok', [ { ok:true, value }, { ok:false, error: consoleErrorSchema } ])`，即统一的 `WorktreeConsoleOutcome<T>`。几乎所有方法的结果都用它包裹。
- `currentResponseSchema`（`234`）、`createPreflightResponseSchema`（`235-239`，discriminated union `ready|files|empty`）、`createResponseSchema`（`240-244`）、`inspectResponseSchema`（`245`）、`listResponseSchema`（`246`，`{ project, worktrees: targetSummarySchema[] }`）、`sidebarTopologyResponseSchema`（`247-264`，`workspaceClientFlavor?`、`officialWorkspaceActive?`、`projects[]`）、`clientBootReportSchema`（`265-272`）、`mutationResponseSchema`（`273-279`，`{ target: targetSummarySchema, changedFiles?, commitOid?, checkpoint?, recoveryContinuation? }`）。
- `diffFileSchema`（`280-286`）、`preflightFactsSchema`（`287-299`）、`preflightSchema`（`300-313`，`ready|local_advanced|already_in_local|conflict|blocked` 的 union）、`preflightResponseSchema`（`314`）。
- `previewRecoveryBlockedReasonSchema`（`316-322`）、`previewRecoveryBlockedActionSchema`（`323-328`）、`previewRecoveryRollbackSchema`（`329-332`）、`previewRecoveryFinalizeSchema`（`333-342`）、`previewRecoveryProofSchema`（`343-360`，含 `rollback`/`finalize`/`blocker`）、`previewRecoveryPreflightSchema`（`361-373`）、`previewRecoveryPreflightResponseSchema`（`374-376`）。
- `reviewDiffResponseSchema`（`378-383`，`files: diffFileSchema[](max200)`）。
- `gitBranchSchema`（`385-390`）、`gitOverviewResponseSchema`（`391-397`）、`gitGraphResponseSchema`（`398-409`，`commits[](max1000)`，每 commit `parents[](max32)`）、`gitMutationResponseSchema`（`410-412`）、`gitGraphLimitSchema`（`413`，`int 1..1000 optional`）。
- `gitPruneEntrySchema`（`415-419`）、`gitPruneResponseSchema`（`420-425`）。
- `tagNameSchema`（`427`，正则拒绝空白/`~^:?*[\`）、`tagMessageSchema`（`428`）、`tagTargetSchema`（`429`）、`gitTagSchema`（`431-439`，`pushed: boolean|null`，null 表示远端无法查询、永不被 coerce 成 false）、`gitTagListResponseSchema`（`440-443`）、`gitTagMutationResponseSchema`（`444-448`）。
- `abandonedSnapshotSchema`（`450-456`）、`abandonedListResponseSchema`（`457-459`）、`restoreAbandonedResponseSchema`（`460-463`）。

### `src/console-remote/remote.ts`

| 名称 | 行号 | 用途 |
| --- | --- | --- |
| `GitWorktreeRemote` | `31` | `type GitWorktreeRemote = TypertRemoteNamespace<'gitWorktree'>` |
| `default export` | `33` | `export default WORKTREE_CONSOLE_REMOTE` |
| re-export | `34` | `export { WORKTREE_CONSOLE_DESCRIPTORS, WORKTREE_CONSOLE_REMOTE } from './descriptors.js'` |
| `declare module '@deepseek-ai/dsh-typert-protocol'` → `TypertRemoteMap` | `36-77` | 把 39 个方法签名注入 `TypertRemoteMap`；形如 `'gitWorktree/<method>': (arg1, arg2, ..., locale?: Language) => Promise<RemoteResult<WorktreeConsoleOutcome<...>>>`。`locale` 永远在最后且可选；带身份方法首参为 `agentId: string` |
| `TypertRemoteNamespaceMap` | `79-81` | `{ gitWorktree: TypertRemoteNamespace<'gitWorktree'> }` |

注：`remote.ts` 不实现任何运行时逻辑，纯类型与重导出。它与 `descriptors.ts` 的 39 个方法一一对应（`remote.ts:31-77`），Client 侧 `client/console-remote/adapter.ts` 正是用这份类型来构造 `GitWorktreeRemote` 调用面。

### `src/console-remote/typert.ts`

| 名称 | 行号 | 用途 |
| --- | --- | --- |
| `TYPERT` | `5-15` | `Object.freeze` 的 `TypertContribution`：`{ package: 'dsh-git-worktree', face: 'host', schemas: [], model: { services:[], events:[], objects:[] }, invocations: WORKTREE_CONSOLE_DESCRIPTORS }`。注释说明这是**手动 strict Host 贡献**，由官方 Typert Loader 通过包 `./typert` 导出自动发现（`tests/console-remote.test.ts:350-365` 验证自动发现）。 |

## Architecture

```text
┌──────────── Client ────────────┐         ┌──────────── Host ────────────┐
│ adapter.ts                     │  RPC    │ service.ts                   │
│ createWorktreeConsoleRemote-   │ ──────► │ WorktreeConsoleService       │
│ Adapter()                      │ ◄────── │ (extends TypertRemoteService)│
└──────────────┬─────────────────┘         └──────────────┬───────────────┘
               │ uses                                     │ delegates
               ▼                                           ▼
┌── Worktree Console Remote protocol layer (src/console-remote) ────────────┐
│ remote.ts: GitWorktreeRemote (TypertRemoteMap, 39 方法签名)               │
│ descriptors.ts: WORKTREE_CONSOLE_DESCRIPTORS (39 InvocationDescriptor)    │
│ schemas.ts: Zod strict 参数/响应校验 (Host↔Client 共享真伪边界)           │
│ typert.ts: TYPERT (Host contribution, face 'host', Loader 自动发现)      │
└───────────────────────────────┬───────────────────────────────────────┘
                                │ registered by / consumed by
                                ▼
                 console-host/control-plane.ts (WorktreeConsoleControlPlane)
```

组件清单（文件名 + 行号）：
- `descriptors.ts:94-251` — `WORKTREE_CONSOLE_DESCRIPTORS` / `WORKTREE_CONSOLE_REMOTE`，协议描述符唯一来源。
- `schemas.ts` — 全部 Zod 校验（strict），Host 与 Client 在 wire 边界共用。
- `remote.ts:31-81` — `GitWorktreeRemote` 与 `TypertRemoteMap` 类型面。
- `typert.ts:5-15` — `TYPERT`，Host 贡献，官方 Loader 自动发现。
- 消费方：`console-host/service.ts:35-43`（`WorktreeConsoleService extends TypertRemoteService`，`super(ctx, 'gitWorktree')`）、`client/console-remote/adapter.ts:80-156`（`createWorktreeConsoleRemoteAdapter`）。

## Data Flow

完整一次远程调用的双向数据流（以 `current` 为例）：

**1. Client → Host（请求参数校验）：**
- 客户端 `WorktreeConsoleAdapter.current({ sessionId })`（`adapter.ts:116`）调用 `invoke('current', locale => remote.current(sessionId, locale))`。
- `remote.current` 即 `remote.ts:40` 注入的 `TypertRemoteMap['gitWorktree/current']`，签名 `(agentId, locale?) => Promise<RemoteResult<...>>`。
- Gateway 进入 Host 前，根据 `descriptors.ts:58-64` 的 `agentParameter`（`source:'lookup', lookup:'agent'`）把 `agentId` 解析为具体 Session，业务代码运行前完成身份解析（测试 `tests/console-remote.test.ts:453-481` 验证 `agentId:'missing-agent'` 抛 `did not resolve the requested identity`）。

**2. Host 业务执行：**
- `WorktreeConsoleService`（继承 `TypertRemoteService`，`service.ts:35-44`）的 `@Remote` 方法接收解析后的参数，委托 `WorktreeConsoleControlPlane` 执行（如 `controlPlane.current()`）。

**3. Host → Client（响应校验）：**
- 业务返回 `WorktreeConsoleOutcome<T>`，经 `outcomeSchema(targetDetailsSchema)`（`schemas.ts:227-232` + `234`）序列化。
- Client 在 `adapter.ts:105-111`：取 `descriptors.get(method).result`，要求 `result.mode==='strict'`，调用 `descriptor.result.create().parse(carrier.value)` 做**响应侧 strict 校验**。
- 若 carrier 本身 `ok===false` 但由 codec 拒绝导致，则映射为 `malformed_response`（业务错误）而非 `transport_unavailable`（`adapter.ts:32-35` 的 `isCodecRejection` 判定，见测试 `tests/console-remote.test.ts:545-560`）。

**4. 超时与错误归一化（`adapter.ts:45-112`）：**
- Web RPC 无原生超时，`FAST_TIMEOUT_MS=30_000` / `SLOW_TIMEOUT_MS=180_000`（`adapter.ts:60-61`）；`FAST_METHODS`（`60-65`）含 `sidebarTopology/current/inspect/previewRecoveryPreflight/gitOverview/gitGraph/listAbandoned`，其余走 SLOW 档。
- 抛错 → `transport()`（carrier offline）；codec 拒绝 → `malformed()`（strict contract 不符）；超时 → `timeoutOutcome()`（`67-78`），错误码 `timeout`。

**伪造/越权边界（测试覆盖）：**
- `sidebarTopology` 与 `clientBootReport` 无 `agent`，非 owner 调用被 Gateway 以 `remote-access/denied` 拒绝（`tests/console-remote.test.ts:426-451`）。
- strict 边界拒绝畸形 wire 输入与业务输出：`inspect` 的 `checkoutId:'../checkout'` 被拒（`164-165`）；`managedRoot:42`、未知键 `managedRoot:'/secret'`、非法 `conflictingFiles` 均被拒（`tests/console-remote.test.ts:160-172, 209-213, 258-262, 310-325`）。

## Connections

- 业务实现上游：[[console-host]]（`src/console-host/service.ts` 消费 `TYPERT`/`WORKTREE_CONSOLE_DESCRIPTORS`，`service.ts:35-44`；`control-plane.ts` 提供 `WorktreeConsoleControlPlane`）。
- 契约类型与常量来源：[[console-contract]]（`src/console-contract.ts` 提供 `WorktreeConsoleOutcome`、各 `*Response` 类型、`WORKTREE_CONSOLE_TARGET_STATES` 行 `26-38`、`WORKTREE_CONSOLE_ERROR_CODES` 行 `609-614`）。
- Client 调用面：[[client]]（`src/client/console-remote/adapter.ts` 的 `createWorktreeConsoleRemoteAdapter` 引用 `WORKTREE_CONSOLE_DESCRIPTORS` 与 `GitWorktreeRemote`，`adapter.ts:28-29, 80-156`）。
- 领域类型：[[types]]（`src/types.ts` 的 `WorktreeRetentionMode`、`WorktreePreviewRecoveryProof` 被 `remote.ts:28` 与 `schemas.ts` 的 `retentionSchema` 引用）。
- i18n：[[i18n]]（`remote.ts:1` 的 `Language`、`adapter.ts:1` 的 `createTranslator`/`normalizeLanguage`、`service.ts:2` 的 `withHostLanguage`）。

## Known Issues

- **新增能力位必须写成 `default(false)` 而非必填字段**：`capabilitiesSchema.returnToLocal`（`schemas.ts:105`）已处理；未来任何纯增量能力位都必须保持「可缺失 + 默认 false」，否则旧 Host 的 `current` payload 会因严格校验整体失败，使整条 capsule 塌成不可用（设计说明见 `schemas.ts:100-104` 与回归测试 `tests/console-remote.test.ts:215-237`）。这是当前契约演进的硬约束，不是 bug。
- **`targetDetailsSchema` 与 `targetSummarySchema` 的路径字段差**：`managedRoot`/`sourceRoot`/`sourceOid`/`currentBranch` 仅在 `targetDetailsSchema`（`schemas.ts:203-209`）出现，只读列表（`listResponseSchema`）只投影 `targetSummarySchema`。客户端若误把详情字段喂给列表 schema 会触发 strict 拒绝（测试 `tests/console-remote.test.ts:279, 494` 显式解构丢弃这些字段）。
- 未发现被注释 / 禁用 / 弃用的函数或行；`strictCodec` 同时保留 legacy `schema` 字段与 0.2 的 `create()` 字段（`descriptors.ts:53-55`）是**有意为之**的双兼容，不是技术债标记。
