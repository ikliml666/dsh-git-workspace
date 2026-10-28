---
title: client_console_remote（客户端远程控制台通信适配）
type: module
source_files:
  - src/console-remote/remote.ts
  - src/console-remote/descriptors.ts
  - src/console-remote/schemas.ts
  - src/console-remote/typert.ts
  - src/console-contract.ts
  - src/client/console-remote/adapter.ts
  - src/client/console-remote/index.ts
  - src/i18n/transport-messages.ts
  - src/i18n/core.ts
  - tests/console-remote.test.ts
  - tests/client-console-remote-routing.test.ts
tags: [git-worktree, dsh-plugin, cordis, typert, rpc, remote, client, strict-contract]
---

## Overview

`client_console_remote` 是 dsh-git-worktree 插件里负责「浏览器客户端 ↔ Host 控制台」远程通信适配的一层。它由两部分组成：

1. **共享严格契约层（`src/console-remote/`）**：被 Host 与 Client 两份独立部署的产物同时引用。它用 zod `strict` schema（`schemas.ts`）为每个 RPC 方法定义请求/响应校验，用 `descriptors.ts` 把方法描述成 Typert `InvocationDescriptor`，用 `typert.ts` 暴露成可被官方 Loader 自动发现的 Host 贡献，用 `remote.ts` 以 `module augmentation` 声明 `gitWorktree/*` 命名空间的全部 39 个方法签名。客户端与 Host 必须共用同一份 `WORKTREE_CONSOLE_DESCRIPTORS`，否则契约校验会整条塌掉。
2. **客户端适配层（`src/client/console-remote/`）**：`adapter.ts` 把上面的 Typert Remote 代理（`remote.gitWorktree.*`）包成类型安全的 `WorktreeConsoleAdapter`，负责超时（`Promise.race`）、运输层错误归一、以及结果在客户端侧的**严格 re-parse**（防 Host 返回不符合 contract 的 payload）；`index.ts` 在客户端 fiber 启动期 `$mount` 该贡献，按 `sidebarTopology` 探测出的 Host 形态（legacy/alpha/next/modern/unsupported）选择注册哪一代 Workspace 浏览器。

整条链路的权威判断全部在 Host 侧（`src/console-host/`，见 [[console-host]]）完成；本模块只负责把调用送出去、把结果收回来并校验形状。相关共享 DTO 定义在 [[console-contract]]。

## Key Components

### 共享契约声明（src/console-remote/descriptors.ts）

| 成员 | 行号 | 用途 |
| --- | --- | --- |
| `PACKAGE` / `SERVICE` / `AGENT_WIRE_TYPE` | 46-48 | 包名 `dsh-git-worktree`、服务名 `gitWorktree`、agent 线制类型 `@deepseek-ai/dsh-session/types#SessionId` |
| `strictCodec(typeSymbol, schema)` | 52-56 | 构造 `TypertCodec`：`{ mode:'strict', create:()=>schema, schema }`；`create()` 惰性返回 schema 以兼容 DSH 0.2，旧适配器仍可读 `schema` 字段 |
| `agentParameter` | 58-64 | 每个身份绑定方法的首参：`name:'agent'`、`wire:'agentId'`、`source:'lookup'`、`lookup:'agent'`、`codec: strictCodec(AGENT_WIRE_TYPE, sessionIdSchema)` |
| `json(name, schema, typeSymbol, acceptsUndefined?)` | 66-74 | 构造 `source:'json'` 的参数描述符；`acceptsUndefined=true` 时附 `acceptsUndefined:true`（可选参数允许 undefined） |
| `descriptor(method, parameters, resultSchema, resultType, withAgent=true)` | 76-92 | 组装 `InvocationDescriptor`：`id`=`${PACKAGE}#${SERVICE}/${method}`、末位恒定追加 `json('locale', optionalLanguageSchema, ...)`，且 `locale` 允许 undefined；结果 codec 带 `${PACKAGE}/console-contract#${resultType}` 类型标记 |
| `WORKTREE_CONSOLE_DESCRIPTORS` | 94-246 | 冻结的 39 个 `InvocationDescriptor` 数组（Object.freeze），方法顺序即 `tests/console-remote.test.ts:50-90` 的 `METHODS` 常量 |
| `WORKTREE_CONSOLE_REMOTE` | 248-251 | 冻结的 `TypertRemoteContribution = { package: PACKAGE, descriptors: WORKTREE_CONSOLE_DESCRIPTORS }` |

`descriptors.ts:94-246` 覆盖的方法（按 `descriptor(...)` 调用顺序）：

- **无 agent 参数**（`withAgent=false`）：`sidebarTopology`（95，参数仅 `locale`）、`clientBootReport`（96，参数为 `report` + `locale`，结果 `boolean`）。
- **带 agent 参数**：`current`（97）、`list`（98-101，含可选 `needsAttention`/`includeDelivered`）、`gitOverview`（102）、`gitGraph`（103-105，可选 `limit`）、`preflightCreate`（106）、`createWithInitialCommit`（107，含 `confirmationToken`）、`create`（108，可选 `branch`）、`initProject`（109）、`inspect`（110-112，含 `checkoutId`）、`reviewDiff`（113-117）、`preflight`（118-122）、`previewRecoveryPreflight`（123-128）、`preparePreviewRecoveryAnalysis`（129-135）、`createPreviewRecoveryHandoff`（136-142）、`preview`（143-147）、`checkpoint`（148-155）、`resumeRevision`（156-161，可选 `conflictContinuation`）、`prepareReviewRegeneration`（162-166）、`rollbackPreview`（167-172，可选 `resumeRevision`/`recoveryProof`）、`discard`（173-178）、`finalize`（179-185）、`finalizePreview`（186-193，可选 `recoveryProof`）、`setRetention`（194-198）、`setPermanent`（199-203）、`retryCleanup`（204-207）、`beginNextIteration`（208-211）、`returnToLocal`（212-214）、`clearSidebarBadge`（215-218）、`gitCreateBranch`（219-221）、`gitSwitchBranch`（222-224）、`gitPruneMergedBranches`（225-227）、`gitListTags`（228）、`gitCreateTag`（229-234，可选 `message`/`target`/`push`）、`gitDeleteTag`（235-238，可选 `remote`）、`gitPushTag`（239-241）、`listAbandoned`（242）、`restoreAbandoned`（243-245）。

所有结果 schema 都用 `outcomeSchema(...)` 包裹（`schemas.ts:227-232`），即 `{ ok:true, value } | { ok:false, error }` 判别联合（`console-contract.ts:695-697`），便于客户端把「业务失败」与「运输/损坏失败」区分开。

### 共享 zod 严格 Schema（src/console-remote/schemas.ts）

所有响应/请求都用 `strict = z.object(shape).strict()`（29）构建，未知键一律拒绝。

| 成员 | 行号 | 用途 |
| --- | --- | --- |
| `sessionIdSchema` | 31 | `z.string().min(1).max(200)`，拒绝 `\0\r\n` |
| `checkoutIdSchema` | 32 | 同上，拒绝 `..` 与 `\/\0\r\n` |
| `reviewIdSchema` | 33 | 拒绝 `\0\r\n` |
| `commitMessageSchema` | 34 | `z.string().trim().refine(isValidCommitMessage)`，来自 `../commit-message.ts` |
| `revisionSchema` | 35 | `z.number().int().nonnegative()` |
| `gitOidSchema` | 36 | 40 或 64 位十六进制 |
| `oidSchema` | 37-41 | `z.union(['unversioned','unborn', gitOidSchema])` |
| `previewIdSchema` | 42 | 拒绝 `/\0\r\n` |
| `generationSchema` | 43 | 64 位十六进制 |
| `requestIdSchema` | 44 | 拒绝 `\0\r\n` |
| `branchNameSchema` | 45-50 | 拒绝 `\0\t\r\n\\ ~^:?*[]`、首尾 `/`、`-` 开头、`..`、`xxx.lock` 结尾 |
| `booleanSchema` | 51 | `z.boolean()` |
| `optionalLanguageSchema` | 52 | `z.enum(['zh','en']).optional()` |
| `optionalBooleanSchema` | 53 | `z.union([booleanSchema, z.undefined()])` |
| `retentionSchema` | 54 | `'cleanup'\|'retain_24h'\|'retain_3d'\|'retain_manual'` |
| `retainedModeSchema` | 55 | 同上但排除 `'cleanup'` |
| `projectSchema` | 57 | `{ id, name }` |
| `validationItemSchema` | 58-62 | 校验项：`command`/`status`(`passed|failed|not_run`)/可选 `summary` |
| `checkpointSchema` | 63-71 | `checkpointId`/`sequence`/`reviewId`/`createdAt`/`summary`/`validationStatus`/`changedFiles`（路径安全校验） |
| `reviewSchema` | 72-83 | 评审摘要：`reviewId`/`revision`/`iteration`/`preparedAt`/`summary`/`tests`/`changedFiles`/`suggestedCommitMessage` |
| `capabilitiesSchema` | 84-106 | 16 个能力位；**`returnToLocal` 用 `z.boolean().default(false)`（105）**——对 Host 新增纯增量能力位的反向兼容：旧 Host 不认识该键时落定为 `false`，不能让整条 `current` payload 校验失败 |
| `acceptanceBlockerSchema` | 107-112 | 验收阻塞者：`checkoutId`/`ownerSessionId`/`revision`/`state` |
| `deliveryProofSchema` | 113-121 | 本地交付凭证：`localBranch`/`localHeadBefore`/`localHeadAfter`/`changedFiles`/`validationStatus?`/`commitInLocalHistory` |
| `targetSummarySchema` | 122-155 | 列表/详情共用的目标摘要（见下文字段表） |
| `safeConflictFile` | 156-160 | 冲突文件路径安全校验（拒绝绝对路径/`\0-\x1f`/空段/`..`） |
| `recoveryContinuationSchema` | 162-170 | `worktree_apply_conflict` 续传凭证 |
| `reviewRegenerationProofSchema` | 171-177 | `worktree_review_regeneration` 凭证 |
| `previewRecoveryAnalysisProofSchema` | 178-186 | `worktree_preview_recovery_analysis` 凭证 |
| `previewRecoveryHandoffProofSchema` | 187-196 | `worktree_preview_recovery_handoff` 凭证 |
| `recoveryProofSchema` | 197-202 | 上述四者的 `z.discriminatedUnion('kind', ...)` |
| `targetDetailsSchema` | 203-209 | 在 `targetSummarySchema` 基础上 `.extend` 出 `managedRoot`/`sourceRoot`/`sourceOid`/`currentBranch`/`recoveryContinuation?` 并 `.strict()` |
| `previewRecoveryHandoffResponseSchema` | 210-215 | `{ target, targetSessionId, managedRoot, recoveryContinuation }` |
| `consoleErrorSchema` | 216-225 | `{ code, message, details?, continuation? }`；`superRefine`（221-225）限制只有 `code==='apply_conflict'` 才能携带 `continuation` |
| `outcomeSchema<T>(value)` | 227-232 | `z.discriminatedUnion('ok', [{ok:true,value},{ok:false,error:consoleErrorSchema}])` |
| `currentResponseSchema` | 234 | `{ target: targetDetailsSchema }` |
| `createPreflightResponseSchema` | 235-239 | 三态判别：`ready`/`files`/`empty`(含 uuid `confirmationToken`) |
| `createResponseSchema` | 240-244 | `{ target, targetSessionId, managedRoot }` |
| `inspectResponseSchema` | 245 | `{ target: targetDetailsSchema }` |
| `listResponseSchema` | 246 | `{ project, worktrees: targetSummarySchema[] }` |
| `sidebarTopologyResponseSchema` | 247-264 | `{ workspaceClientFlavor?, officialWorkspaceActive?, projects[] }`，其中 `projects[].tasks[]` 是构成客户端浏览器分支选择的依据（`workspaceClientFlavor` 取值 `legacy/alpha/next/modern/unsupported`） |
| `clientBootReportSchema` | 265-272 | 客户端启动面包屑：`flavor`/`branch`(`legacy/alpha/next/modern/unsupported/topology-failed/boot-failed`)/`registered`/`detail?`/`elapsedMountMs?`/`elapsedTopologyMs?` |
| `mutationResponseSchema` | 273-279 | `{ target, changedFiles?, commitOid?, checkpoint?, recoveryContinuation? }` |
| `diffFileSchema` | 280-286 | review diff 单文件：`path`/`previousPath?`/`status`/`patch`/`truncated` |
| `preflightFactsSchema` + `preflightSchema` + `preflightResponseSchema` | 287-314 | apply 预检：`ready`/`local_advanced`/`already_in_local`/`conflict`/`blocked` + `reason` 枚举 |
| `previewRecoveryBlockedReasonSchema` | 316-322 | 恢复预检阻塞原因枚举 |
| `previewRecoveryRollbackSchema`/`previewRecoveryFinalizeSchema` | 329-342 | 恢复 `rollback`(`safe` 含 `targetTreeOid`)/`finalize`(`safe` 含 `taskTreeOid`/`finalIndexTreeOid`/`expectedWorkingTreeOid`/`commitRequired`) 两个判别联合 |
| `previewRecoveryProofSchema` | 343-360 | 恢复证明：12 个指纹/oid 字段 + `rollback` + `finalize` + `blocker?` |
| `previewRecoveryPreflightSchema` + `previewRecoveryPreflightResponseSchema` | 361-376 | recovery 预检：`assessed`(含 `proof`)/`blocked` |
| `reviewDiffResponseSchema` | 378-383 | `{ reviewId, revision, files:diffFileSchema[] (≤200), truncated }` |
| `gitBranchSchema`/`gitOverviewResponseSchema`/`gitGraphResponseSchema`/`gitMutationResponseSchema`/`gitGraphLimitSchema` | 385-413 | git 概览/图/分支 mutation 响应 |
| `gitPruneEntrySchema`/`gitPruneResponseSchema` | 415-425 | 合并分支 prune 结果：`dryRun`/`headBranch`/`pruned[]`/`skipped[]` |
| `tagNameSchema`/`tagMessageSchema`/`tagTargetSchema` | 427-429 | 标签名/消息/目标 |
| `gitTagSchema`/`gitTagListResponseSchema`/`gitTagMutationResponseSchema` | 431-448 | 标签列表/创建/删除/推送响应（`pushed: boolean|null`，`null`=远端不可达，绝不 coerce 成 false） |
| `abandonedSnapshotSchema`/`abandonedListResponseSchema`/`restoreAbandonedResponseSchema` | 450-463 | 放弃快照列表与恢复响应 |

`targetSummarySchema`（122-155）字段：`project`/`checkoutId`(nullable)/`sourceSessionId`/`ownerSessionId`/`targetSessionId`(nullable)/`iteration`/`revision`/`state`/`phase`/`dirty`/`currentOid`/`commitOid`(nullable)/`sourceBranch`(nullable)/`retention?`/`retainedAt?`/`expiresAt?`/`permanent?`/`cleanupMessage?`/`deliveryProof?`/`review?`/`checkpoints?(≤100)`/`checkpointGeneration?`/`reviewSlot?`/`reviewSlotOwnerSessionId?`/`reviewSlotHolder?`/`previewRecovery?`/`capabilities`。

### 客户端命名空间类型与 Loader 贡献（src/console-remote/remote.ts、typert.ts）

| 成员 | 行号 | 用途 |
| --- | --- | --- |
| `GitWorktreeRemote` | remote.ts:31 | `TypertRemoteNamespace<'gitWorktree'>`，客户端持有 `remote.gitWorktree` 的静态类型 |
| default export | remote.ts:33 | `WORKTREE_CONSOLE_REMOTE`（同 remote.ts:34 再导出 `WORKTREE_CONSOLE_DESCRIPTORS`/`WORKTREE_CONSOLE_REMOTE`） |
| `declare module ... TypertRemoteMap` | remote.ts:36-82 | 模块扩充声明 `gitWorktree/*` 全部 39 个方法的精确签名（参数含 `locale?: Language` 末位、返回 `Promise<RemoteResult<WorktreeConsoleOutcome<...>>>`）。这是客户端调用 `remote.gitWorktree.current(...)` 时获得的类型 |
| `declare module ... TypertRemoteNamespaceMap` | remote.ts:79-81 | 把 `gitWorktree` 映射到 `TypertRemoteNamespace<'gitWorktree'>` |
| `TYPERT` | typert.ts:5-15 | 冻结的 `TypertContribution`：`package:'dsh-git-worktree'`、`face:'host'`、`schemas:[]`、`model` 全空、`invocations: WORKTREE_CONSOLE_DESCRIPTORS`。官方 Typert Loader 通过 `./typert` 子路径自动发现它（见 `tests/console-remote.test.ts:350-365`） |

### 客户端适配层（src/client/console-remote/adapter.ts）

| 成员 | 行号 | 用途 |
| --- | --- | --- |
| `transport<T>(message)` | 31-33 | 返回 `{ ok:false, error:{ code:'transport_unavailable', message } }` |
| `malformed<T>(method, locale)` | 35-37 | 返回 `{ ok:false, error:{ code:'malformed_response', message: transportMessages.malformed } }` |
| `messageOf(value)` | 39-43 | 从 Error 或 `{message}` 对象取消息文本 |
| `isCodecRejection(value)` | 45-48 | 判断消息是否含 `rejected "` 或 `返回了不符合 strict contract`，用于区分「codec 拒绝（→ malformed）」与「运输失败（→ transport）」 |
| `FAST_TIMEOUT_MS` / `SLOW_TIMEOUT_MS` | 56-57 | 30_000 / 180_000；web RPC 无超时，客户端侧用 `Promise.race` 兜底，避免 UI 永久 pending（注释 50-55） |
| `FAST_METHODS` | 60-65 | 快路径集合：`sidebarTopology`/`current`/`inspect`/`previewRecoveryPreflight`/`gitOverview`/`gitGraph`/`listAbandoned` 用 30s，其余（list/preflight 等全量重算）用 180s |
| `timeoutOutcome<T>(method, locale, timeoutMs)` | 67-78 | 返回 `{ ok:false, error:{ code:'timeout', message: invokeTimeout } }` |
| `createWorktreeConsoleRemoteAdapter(remote, getLanguage=()=>'zh')` | 80-156 | 核心工厂：用 `descriptors` Map（81）做方法→descriptor 查表；返回完整的 `WorktreeConsoleAdapter` 对象（114-155），每个方法都调用内部 `invoke` |
| `invoke<T>(method, call)` | 83-112 | 统一调用编排：`normalizeLanguage(getLanguage())`→按 `FAST_METHODS` 选超时→`Promise.race(call, timeout)`（89-95）→捕获异常归一成 transport/malformed（96-98）→timeout 归一成 `timeoutOutcome`（100-102）→非对象/`ok` 非布尔→`malformed`（103-104）→`!carrier.ok` 按 `isCodecRejection` 归一成 malformed 或 transport（104）→拿到 descriptor，若 `result.mode!=='strict'`→`malformed`（105-106）→`descriptor.result.create().parse(carrier.value)` 严格 re-parse，失败→`malformed`（107-111）。即使 Host 通过了服务端校验，客户端仍独立再 parse 一次，保证 payload 真正符合 contract |

`adapter.ts:114-155` 逐个方法把 `WorktreeConsoleAdapter` 请求映射成 `remote.gitWorktree.*` 调用并透传 `locale`：例如 `current`（116）调 `remote.current(request.sessionId, locale)`，`checkpoint`（129）透传 7 个参数，`resumeRevision`（130-132）按 `request.conflictContinuation` 是否存在选择是否传冲突续传，`gitListTags`（149）等 git 操作也走同一条 `invoke`。

### 客户端挂载入口（src/client/console-remote/index.ts）

| 成员 | 行号 | 用途 |
| --- | --- | --- |
| `inject` | 45-49 | 与官方 Workspace 客户端注入集合对齐，但过滤掉 `remote.directoryPicker` 与 `remoteAccess`——前者由 `officialContextProxy` 延迟解析以免死锁 web 启动（注释 18-44），后者在旧 Host 上会导致 web 启动永久 pending；另补 `slots`/`configForms`（注释 30-36） |
| `ConsoleClientContext` | 51-53 | `Context & { remote: ClientRemote & { gitWorktree: GitWorktreeRemote } }` |
| `declare module ... Context` | 55-59 | 把 `worktreeConsole: WorktreeConsoleAdapter` 服务注入到 cordis Context |
| `apply(ctx)` | 62-206 | 挂载主流程（见 Data Flow）；先 `ctx.remote.$mount(contribution)`（64）→ `effect` 登记卸载（66）→ `ctx.get('remote.gitWorktree')`（67，取不到则抛 `mountFailed`，70）→ `createWorktreeConsoleRemoteAdapter`（71）→ `ctx.provide('worktreeConsole', adapter)`（72）→ `mountSettingsCard`（73）→ 拉 `sidebarTopology`（104）决定四代 Browser 分支 |
| `reportBoot(branch, registered, detail?)` | 86-102 | 启动面包屑上报：构造 `clientBootReport`（91-95，注意 locale 末位即便 undefined 也要传），best-effort 不可破坏启动路径 |

`apply` 的分支逻辑（104-205）：
- `topology.ok===false` → 上报 `topology-failed` 并抛 `workspaceGenerationUnknown`（107-109）。
- `flavor==='legacy'`（112-121）：要求 `ctx.get('sessions').open` 是函数，否则抛 `Legacy Workspace Browser requires sessions.open()`（114-117）；调 `registerManagedWorkspaceSidebar` 并 `mountTools`。
- `flavor==='modern'`（122-161）：`officialWorkspaceActive===true` 走 **decorate** 分支（`registerDecoratedWorkspaceSidebar`，132）；否则 inject 分支（`registerManagedWorkspaceSidebar` + `applyOfficialWorkspace`，149-154）。
- `flavor==='alpha'|'next'`（162-200）：分别选 `alphaWorkspaceInject`/`applyAlphaWorkspace` 或 `nextWorkspaceInject`/`applyNextWorkspace`；同样按 `officialWorkspaceActive` 决定 decorate 还是 inject。
- 其它（201-205）：`unsupported`，仅 `mountTools`。

每代浏览器都通过 `reportBoot(flavor, true)` 上报注册成功（或失败 detail），经由 `remote.gitWorktree.clientBootReport` 落到 Host 侧诊断 ndjson（`console-host/service.ts` 的 `appendDiag`）。

该四代分支路由（`legacy`/`alpha`/`next`/`modern`/`unsupported` 及 decorate-vs-inject）由 `tests/client-console-remote-routing.test.ts` 全程覆盖：`legacy` 须有 `sessions.open`（78）；`unsupported` 不注册官方浏览器（57-63）；`alpha|next` 且 `officialWorkspaceActive===true` 走 decorate 而非重放 inject（65-74）；`topology` 失败或未知形态在注册前就抛错（76-82）。

### 共享契约类型（src/console-contract.ts，适配器直接依赖）

| 成员 | 行号 | 用途 |
| --- | --- | --- |
| `WorktreeConsoleOutcome<T>` | 695-697 | 判别联合：`{ok:true,value:T} \| {ok:false,error:WorktreeConsoleError}` |
| `WorktreeConsoleError` | 688-693 | `{ code, message, details?, continuation? }` |
| `WORKTREE_CONSOLE_ERROR_CODES` | 609-614 | 含 `transport_unavailable`/`malformed_response`/`timeout`（611-613）三个本模块专有的运输层错误码 |
| `WorktreeConsoleErrorCode` | 616 | 上述 + 领域错误码 |
| `WorktreeConsoleAdapter` | 745-784 | 客户端统一 seam 接口（适配器返回该类型）；`preflightCreate?`/`createWithInitialCommit?`/`initializeProject?`/`listAbandoned?`/`restoreAbandoned?` 为可选 |
| `WorktreeConsoleClientBootReport` | 254-263 | 启动上报结构（`flavor`/`branch`/`registered`/`detail?`/`elapsedMountMs?`/`elapsedTopologyMs?`） |

### i18n（src/i18n/transport-messages.ts、core.ts）

| 成员 | 行号 | 用途 |
| --- | --- | --- |
| `transportMessages` | transport-messages.ts:3-20 | `malformed`(5-7)/`mountFailed`(8-11)/`workspaceGenerationUnknown`(12-15)/`invokeTimeout`(16-19) 双语文案；适配器 `malformed`/`timeoutOutcome` 与 `index.ts` 抛错都引用它 |
| `Language` | core.ts:2 | `'zh' \| 'en'` |
| `normalizeLanguage(value)` | core.ts:4-6 | 非 en 起手一律归 `'zh'` |
| `createTranslator(catalog, language)` | core.ts:19-25 | 占位符 `{name}` 替换 |

## Architecture

```text
┌───────────────────────────┐  $mount(WORKTREE_CONSOLE_REMOTE)  ┌─────────────────────────┐
│ client/console-remote/     │ ────────────────────────────────► │ Typert client Remote     │
│ index.ts apply() (62-206)  │                                    │ (remote.gitWorktree proxy)│
└───────────────┬───────────┘                                    └───────────┬─────────────┘
                │ provide('worktreeConsole', adapter)                       │ web RPC carrier
                ▼                                                            ▼
┌───────────────────────────┐  invoke() Promise.race + strict re-parse   ┌─────────────────────────┐
│ client/console-remote/     │ ◄────────── RemoteResult ────────────────► │ Host TypertGateway       │
│ adapter.ts (80-156)        │                                            │ → WorktreeConsoleService │
└───────────────┬───────────┘   descriptors: WORKTREE_CONSOLE_DESCRIPTORS  │ (console-host/service.ts) │
                │             (descriptors.ts 94-246, shared strict)      └─────────────────────────┘
                ▼
┌───────────────────────────┐
│ console-remote/{descriptors│  Host + Client 共用同一份严格契约
│ , schemas, remote, typert}│  自动发现：typert.ts TYPERT via ./typert
└───────────────────────────┘
```

## Data Flow

以客户端调用 `current` 为例：

1. **入口挂载**：客户端 fiber 启动 `apply(ctx)`（`index.ts:62`）→ `ctx.remote.$mount(contribution)`（64）把 `WORKTREE_CONSOLE_REMOTE`（`remote.ts:33`）注册进 Typert 客户端。贡献源 `TYPERT`（`typert.ts:5-15`）由官方 Loader 从 `./typert` 子路径自动发现（`tests/console-remote.test.ts:350-365`）。挂载后会拿到 `remote.gitWorktree`（67）。
2. **能力探测**：`apply` 先 `adapter.sidebarTopology()`（`index.ts:104`）探 Host 形态；`sidebarTopology` 是少数 `withAgent=false` 的方法（`descriptors.ts:95`），不绑定 agent、可无当前会话调用。返回的 `workspaceClientFlavor`/`officialWorkspaceActive` 决定注册哪代浏览器（104-205）。
3. **业务调用**：UI 经 `ctx.get('worktreeConsole')` 拿到适配器，调用 `adapter.current({ sessionId })`（`adapter.ts:116`）→ `invoke('current', locale => remote.current(sessionId, locale))`（83-112）。
4. **超时兜底**：`invoke` 用 `Promise.race(call, timeout)`（89-95）；`current` 在 `FAST_METHODS` 中（60-65），超时 30s（91-93），超时返回 `timeoutOutcome`（100-102）。
5. **异常归一**：调用抛错时，按 `isCodecRejection`（45-48）区分成 `malformed`（codec/schema 拒绝）或 `transport`（运输失败）（96-98）。
6. **结果再校验**：即使 Host 已通过服务端校验，客户端仍 `descriptor.result.create().parse(carrier.value)`（108）独立 strict re-parse；失败 → `malformed`。这是「Host 返回不符合 contract 的 payload 也不让客户端塌掉」的双保险（`tests/console-remote.test.ts:545-609`）。
7. **Host 侧落地**：web RPC carrier 把调用送到 Host `TypertGateway`，转发到 `WorktreeConsoleService`（`console-host/service.ts`）→ 控制面方法，最终在 Host 完成身份/CAS/根校验后返回 `WorktreeConsoleOutcome<T>`。

`clientBootReport` 走独立 `withAgent=false` 路径（`descriptors.ts:96`），由 `reportBoot`（`index.ts:86-102`）在每条浏览器分支注册后 best-effort 上报，落到 Host 诊断 ndjson。

## Connections

- [[console-host]] — `WorktreeConsoleService`（`src/console-host/service.ts`）与 `WorktreeConsoleControlPlane`（`src/console-host/control-plane.ts`）是本模块 RPC 的 Host 侧实现方；本模块所有 `gitWorktree/*` 方法最终落到它们。
- [[console-contract]] — `WorktreeConsoleAdapter`/`WorktreeConsoleOutcome`/`WorktreeConsoleClientBootReport` 等共享 DTO 定义在本模块依赖的契约文件。
- [[src]] — 整个插件根模块，`apply`（src/index.ts:358-458）装配 `WorktreeConsoleService` 并把本贡献注册进 Host。
- i18n（`src/i18n/transport-messages.ts`、`src/i18n/core.ts`）提供 `malformed`/`timeout`/`mountFailed` 文案与 `normalizeLanguage`。

## Known Issues

- **`returnToLocal` 能力位须容忍缺失**（`schemas.ts:100-105`）：因为 Client 与 Host 是两份独立部署产物，宿主重启前可能跑旧 Host（不认识新增的 `returnToLocal` 键）。若写成必填会让整条 `current` payload 校验失败、胶囊塌成「不可用」。故用 `z.boolean().default(false)` 而非 `optional()`：输入可缺省、输出仍是确定 boolean。`tests/console-remote.test.ts:215-237` 专门验证此行为。
- **`locale` 末位参数必须始终传递**（即便 `undefined`）：Typert Remote 代理按位置（arity）绑定参数，`adapter.ts` 与 `index.ts:88-95` 注释都强调 locale 即便 undefined 也要显式传入，否则代理会错位。
- **`remote.directoryPicker` 与 `remoteAccess` 被显式排除**（index.ts:45-49）：前者会引发 `uiWorkspace` 启动死锁，后者会让 0.2.0-rc.2 Host 的 web 启动永久 pending；它们改由 `officialContextProxy` 延迟/打桩提供（见 `src/client/workspace-sidebar/index.tsx` 的 `officialContextProxy`）。
- **web RPC 无服务端超时**（adapter.ts:89-96）：客户端必须自带 `Promise.race` 超时，否则挂起的 handler（锁队列、hung git）会让调用 UI 永久 pending；超时后服务端工作仍在跑、mutation 调用可安全重试。
- **客户端 strict re-parse 是双保险**：即使 Host 侧已校验，本模块仍在客户端对结果再 parse 一次（adapter.ts:36-42），保证任何不符合 contract 的 payload 都被归一为 `malformed_response` 而非污染 UI 状态。`tests/console-remote.test.ts:545-609` 用三个用例（业务失败 / 运输离线 / 损坏响应）验证该三段区分。
