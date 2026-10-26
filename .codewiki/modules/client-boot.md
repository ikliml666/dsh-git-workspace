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

Client 侧是插件的浏览器运行时：把 Host 暴露的 Remote 服务适配成 `WorktreeConsoleAdapter`（契约见 `src/console-contract.ts` 行723-761），向 Harness Workspace 注册 ToolView、会话徽章、侧栏装饰等 UI，并完成 Workspace 代际探测与启动上报。共享契约定义了目标状态、capabilities、错误码 meta、Adapter 接口。

该模块负责在 DSH Web 环境中初始化 Git Worktree 插件，包含两个入口点：

1. **Browser Entry**（`src/client/index.tsx`）：轻量模式，直接挂载 UI 槽位，可由测试或无 Remote 环境使用，接受可选的 `adapterOverride`（行49-106）。
2. **Remote Entry**（`src/client/console-remote/index.ts`）：生产主入口，通过 Cordis Context 挂载 Remote Proxy、解析 Sidebar Topology，并按 Host 的 Workspace 代际（legacy / modern / alpha / next / unsupported，契约定义见 `src/console-contract.ts` 行242）选择「接管」（`registerManagedWorkspaceSidebar`，`src/client/workspace-sidebar/index.tsx` 行328-334）还是「装饰」（`registerDecoratedWorkspaceSidebar`，同文件行495-535）策略。

核心组成：

- **Adapter Layer**：把 RPC 调用转换为带超时与严格 schema 校验的 `WorktreeConsoleOutcome` 对象（`src/client/console-remote/adapter.ts` 行79-153）。
- **Sidebar Projection**：把远程拓扑投影为本地 Workspace 视图，处理 Session/Workspace 的保护、隐藏与重定位；同时给每行拼出**带分支名**的徽章标签（`src/client/workspace-sidebar/model.ts` 行51-74）。
- **ToolView Models**：从日志化 call/result 块解析出稳定的 UI 模型（`src/client/model.ts`）。
- **i18n**：语言归一化与翻译器，支持 zh/en（`src/client/i18n.tsx`、`src/i18n/core.ts`、`src/i18n/transport-messages.ts`）。
- **Upstream Decoration**：脚本对官方 Workspace Client 源码做精确替换以注入托管装饰（`scripts/workspace-sidebar-upstream.mjs`）。

## Key Components

### Browser Entry (`src/client/index.tsx`)

- **重导出 `registerTargetConsole`**（行15）：从 `./target-console/index.js` 重导出。
- **重导出 `registerPreSessionWorktree`**（行16）：从 `./pre-session/index.js` 重导出。
- **常量 `WORKTREE_CONSOLE_ADAPTER_SERVICE`**（行18）：`'worktreeConsole'`，服务容器里的适配器键。
- **接口 `ClientContextLike`**（行20-33）：字段 `get(name: string): unknown`、`effect(setup: () => void | (() => void), label?: string): void`、`slots: { inject(name: 'tool.call.toolview' | 'conversation.session.header.actions' | 'conversation.input.dock' | 'conversation.input.left', callback: () => unknown): void; register(descriptor: Record<string, unknown>, component: ComponentType<any>): unknown }`。
- **`inject`**（行36）：`['slots', 'workspaces', 'sessions', 'conversation', 'connection', 'locale']`。
- **`servicesOf(ctx)`**（行38-46）：取出并类型断言所需服务，返回对象字段：`locale`（行40）、`workspaces`（行41）、`sessions`（行42）、`uiWorkspace`（行43，来自 `ctx.get('uiWorkspace')`）、`conversation`（行44）。
- **`apply(ctx, adapterOverride?)`**（行49-106）：
  - **Localized Slots Proxy**（行53-59）：包装 `ctx.slots.register`，自动为注册的 React 组件套 `ClientI18nProvider`（行55-56）。
  - **Adapter Resolution**（行63-64）：优先 `adapterOverride`，否则 `ctx.get(WORKTREE_CONSOLE_ADAPTER_SERVICE)`（行64）。
  - **Style Injection**（行69-77）：`ctx.effect` 内创建 `<style>`，标 `data-dsh-git-worktree`（行71）、`data-plugin`（行72）、`data-plugin-css`（行73），注入 `WORKTREE_STYLES` 与 `TARGET_CONSOLE_STYLES`（行74），cleanup 时 `style.remove()`（行76）。
  - **ToolView Registration**（行79-88）：定义 `CreateRow`/`ReviewRow`（行79-80），两次 `ctx.slots.inject('tool.call.toolview', …)`（行81-88），key 分别为 `worktree_create`（行82）与 `worktree_ready_for_review`（行86）。
  - **Target Console & PreSession**（行91-105）：仅当 `adapter !== undefined` 时调 `registerTargetConsole`（行92-96）与 `registerPreSessionWorktree`（行100-104）；注释行97-99 说明空白会话切换「在 composer 左侧 dock 开始 Worktree」。

### Remote Entry (`src/client/console-remote/index.ts`)

- **重导出 `createWorktreeConsoleRemoteAdapter`**（行16）。
- **`inject`**（行45-49）：继承官方 Workspace 的 inject 并过滤掉 `remote.directoryPicker` 与 `remoteAccess`（行46），额外声明 `slots` 与 `configForms`（行47-48）；行18-44 注释详述原因：`remote.directoryPicker` 会死锁（行23-28）、`remoteAccess` 在 0.2.0-rc.2 主机缺失会导致永久 pending（行37-43）、`slots`/`configForms` 缺失会使设置卡片不挂载（行30-36）。
- **接口 `ConsoleClientContext`**（行51-53）：扩展 `Context` 加 `remote: ClientRemote & { gitWorktree: GitWorktreeRemote }`。
- **`declare module '@deepseek-ai/cordis'`**（行55-59）：为 `Context` 增加 `worktreeConsole: WorktreeConsoleAdapter`。
- **`apply(ctx)`**（行62-206）：
  - **Remote Mount**（行63-66）：`ctx.remote.$mount(contribution)`（行64），记录耗时 `elapsedMountMs`（行65），`ctx.effect(() => disposeRemote)`（行66）。
  - **Adapter Build**（行67-72）：取 `remote.gitWorktree`（行67），`createWorktreeConsoleRemoteAdapter(remote, getLanguage)`（行71），`ctx.provide('worktreeConsole', adapter)`（行72）。
  - **`mountSettingsCard`**（行73）。
  - **`mountTools`**（行75-81）：`workspaceCtx.inject(toolViewInject, child => applyToolViews(child, adapter))`（行78-80）——会话相关视图必须挂在 UI Workspace provider 之下。
  - **`reportBoot`**（行86-102）：调用 `remote.clientBootReport({ flavor: topology.ok ? String(topology.value.workspaceClientFlavor ?? 'missing') : 'unknown', branch, registered, detail?, elapsedMountMs, elapsedTopologyMs }, undefined)`（行91-95），尾部 locale 显式传 `undefined`；诊断尽力而为，catch 仅日志（行99-101）。
  - **Topology Fetch**（行103-109）：`adapter.sidebarTopology()`（行104），失败则 `reportBoot('topology-failed', …)`（行107）并抛 `workspaceGenerationUnknown`（行108）。
  - **Branch Routing**（行110-205）：
    - `legacy`（行112-121）：要求 `sessions.open` 为函数（行113-116），否则抛错；走 `registerManagedWorkspaceSidebar` + `mountTools`（行118-121）。
    - `modern`（行122-161）：`officialWorkspaceActive === true` 时先 `reportBoot('modern', false, 'decorate-pending')`（行128）再 `ctx.inject(inject, …)`（行130）走 `registerDecoratedWorkspaceSidebar`（行132-135）；否则走接管（传入 `applyOfficialWorkspace`，行147-160）。
    - `alpha`/`next`（行162-200）：同构，分别用 `alphaWorkspaceInject`/`applyAlphaWorkspace` 与 `nextWorkspaceInject`/`applyNextWorkspace`（行163-165）；`officialWorkspaceActive` 为 true 走装饰（行171-183），否则走接管（行186-199）。
    - 其余（行201-205，`unsupported` 或未知）：只挂 Tools（`mountTools(ctx)`，行204）。

### Adapter Layer (`src/client/console-remote/adapter.ts` & `src/console-contract.ts`)

- **超时档位**（行55-56）：`FAST_TIMEOUT_MS = 30_000`、`SLOW_TIMEOUT_MS = 180_000`。
- **`FAST_METHODS`**（行59-64）：含 `sidebarTopology`、`current`、`inspect`、`previewRecoveryPreflight`、`gitOverview`、`gitGraph`、`listAbandoned`；其余落慢档（注释行57-58说明 `list`/`preflight`/`preflightCreate` 全量重算可能逼近30s放SLOW档）。
- **辅助函数**：
  - `transport<T>`（行30-32）：返回 `transport_unavailable` 错误。
  - `malformed<T>`（行34-36）：返回 `malformed_response` 错误。
  - `messageOf`（行38-42）：提取错误文本。
  - `isCodecRejection`（行44-47）：检测 codec 拒绝消息。
  - `timeoutOutcome`（行66-77）：返回 `timeout` 错误。
- **`createWorktreeConsoleRemoteAdapter(remote, getLanguage)`**（行79-153）：
  - **`invoke<T>`**（行82-111）：`Promise.race` 超时（行88-93）；异常经 `isCodecRejection` 转 `malformed_response` 否则 `transport_unavailable`（行96）；校验 `carrier` 形状（行102）、`descriptor.result.mode === 'strict'`（行105）及 schema `.parse()`（行107）。
  - **返回对象**（行113-153）实现 `WorktreeConsoleAdapter`（契约行723-761）全部方法：`sidebarTopology`(114)、`current`(115)、`list`(116)、`preflightCreate`(117)、`createWithInitialCommit`(118)、`create`(119)、`initializeProject`(120)、`inspect`(121)、`reviewDiff`(122)、`preflight`(123)、`previewRecoveryPreflight`(124)、`preparePreviewRecoveryAnalysis`(125)、`createPreviewRecoveryHandoff`(126)、`preview`(127)、`checkpoint`(128)、`resumeRevision`(129-131)、`prepareReviewRegeneration`(132)、`rollbackPreview`(133)、`discard`(134)、`finalize`(135)、`finalizePreview`(136)、`setRetention`(137)、`setPermanent`(138)、`retryCleanup`(139)、`beginNextIteration`(140)、`clearSidebarBadge`(141)、`gitOverview`(142)、`gitGraph`(143)、`gitCreateBranch`(144)、`gitSwitchBranch`(145)、`gitPruneMergedBranches`(146)、`gitListTags`(147)、`gitCreateTag`(148)、`gitDeleteTag`(149)、`gitPushTag`(150)、`listAbandoned`(151)、`restoreAbandoned`(152)。
- **契约关键类型**（`src/console-contract.ts`）：
  - `WORKTREE_CONSOLE_TARGET_STATES`（行26-38）与 `WorktreeConsoleTargetState`（行40）：目标状态联合类型，含 `'local' | 'creating' | 'working' | 'ready_for_review' | 'preview_active' | 'preview_detached' | 'retained' | 'cleanup_pending' | 'recovery_required' | 'delivered' | 'discarded'`。
  - `WorktreeConsoleDeliveryState`（行42-50）：联合 `'working' | 'ready_for_review' | 'preview_active' | 'preview_detached' | 'finalized' | 'retained' | 'delivered'`。
  - `WorktreeConsoleProjectionSource`（行52-56）：字段 `kind: 'local' | 'isolated'`、`phase: SessionCheckoutPhase`、`deliveryState?: WorktreeConsoleDeliveryState`。
  - `worktreeReachedDelivery`（行64-73）：函数，参数 `phase: SessionCheckoutPhase, deliveryState?: WorktreeConsoleDeliveryState`，返回布尔。
  - `consoleStateFromDomain`（行76-91）：函数，参数 `source: WorktreeConsoleProjectionSource`，返回 `WorktreeConsoleTargetState`。
  - `WorktreeConsoleProject`（行93-96）：字段 `id: string`、`name: string`。
  - `WorktreeConsoleCapabilities`（行98-118）：布尔能力字段 `create`、`open`、`inspect`、`discard`、`preflight`、`preview`、`checkpoint`、`resumeRevision`、`rollbackPreview`、`finalize`、`finalizePreview`、`setRetention`、`setPermanent`、`retryCleanup`、`beginNextIteration`。
  - `WorktreeConsolePreviewRecovery`（行120-125）：字段 `previewId: string`、`detachedAt: number`、`reason: 'stale_local' | 'preview_modified'`、`attemptedAction: 'rollback_preview' | 'finalize_preview' | 'discard'`。
  - `WorktreeConsoleDeliveryProof`（行127）：类型别名 `WorktreeDeliveryProofView`。
  - `WorktreeConsoleReviewSummary`（行129-140）：字段 `reviewId: string`、`revision: number`、`iteration: number`、`preparedAt: number`、`summary: string`、`validationStatus: WorktreeValidationStatus`、`validationSummary?: string`、`tests: WorktreeValidationItem[]`、`changedFiles: string[]`、`suggestedCommitMessage: string`。
  - `WorktreeConsoleTargetSummary`（行143-173）：字段 `project: WorktreeConsoleProject`、`checkoutId: string | null`、`sourceSessionId: string`、`ownerSessionId: string`、`targetSessionId: string | null`、`iteration: number`、`revision: number`、`state: WorktreeConsoleTargetState`、`phase: SessionCheckoutPhase | 'local'`、`dirty: boolean`、`currentOid: string`、`commitOid: string | null`、`sourceBranch: string | null`、`retention?: Exclude<WorktreeRetentionMode, 'cleanup'>`、`retainedAt?: number`、`expiresAt?: number | null`、`permanent?: boolean`、`cleanupMessage?: string`、`deliveryProof?: WorktreeConsoleDeliveryProof`、`review?: WorktreeConsoleReviewSummary`、`checkpoints?: WorktreeCheckpointView[]`、`checkpointGeneration?: string`、`reviewSlot?: 'available' | 'waiting'`、`reviewSlotOwnerSessionId?: string`、`reviewSlotHolder?: WorktreeAcceptanceBlockerView`、`previewRecovery?: WorktreeConsolePreviewRecovery`、`capabilities: WorktreeConsoleCapabilities`。
  - `WorktreeConsoleTargetDetails`（行176-189）：扩展 `TargetSummary` 加 `managedRoot: string | null`、`sourceRoot: string | null`、`sourceOid: string`、`currentBranch: string | null`、`recoveryContinuation?: WorktreeRecoveryProof`。
  - `WorktreeConsoleCurrentRequest`（行191-193）/`Response`（行195-197）：请求含 `sessionId: string`；响应含 `target: WorktreeConsoleTargetDetails`。
  - `WorktreeConsoleListRequest`（行199-203）/`Response`（行205-208）：请求含 `sessionId`、`needsAttention?`、`includeDelivered?`；响应含 `project`、`worktrees: WorktreeConsoleTargetSummary[]`。
  - `WorktreeSidebarTaskState`（行210-217）：联合 `'working' | 'ready_for_review' | 'preview_active' | 'preview_detached' | 'recovery_required' | 'finalized' | 'discarded'`。
  - `WorktreeSidebarTask`（行220-230）：字段 `checkoutId: string`、`ownerSessionId: string`、`sourceSessionId: string`、`iteration: number`、`revision: number`、`phase: SessionCheckoutPhase`、`state: WorktreeSidebarTaskState`、`sourceBranch: string | null`。
  - `WorktreeSidebarProject`（行232-237）：字段 `project: WorktreeConsoleProject`、`tasks: WorktreeSidebarTask[]`、`memberships?: { workspaceIds: string[]; sessionIds: string[] }`。
  - `WorktreeSidebarTopologyResponse`（行239-245）：字段 `projects: WorktreeSidebarProject[]`、`workspaceClientFlavor?: 'legacy' | 'alpha' | 'next' | 'modern' | 'unsupported'`、`officialWorkspaceActive?: boolean`。
  - `WorktreeClientBootReport`（行248-257）：字段 `flavor: string`、`branch: 'legacy' | 'alpha' | 'next' | 'modern' | 'unsupported' | 'topology-failed' | 'boot-failed'`、`registered: boolean`、`detail?`、`elapsedMountMs?`、`elapsedTopologyMs?`。
  - `WorktreeConsoleCreatePreflightResponse`（行260-263）：联合 `{ kind: 'ready'; branches?: string[] } | { kind: 'empty'; confirmationToken: string } | { kind: 'files' }`。
  - `WorktreeConsoleCreateRequest`（行265-269）：字段 `sourceSessionId: string`、`branch?: string`。
  - `WorktreeConsoleCreateResponse`（行271-275）：字段 `target: WorktreeConsoleTargetDetails`、`targetSessionId: string`、`managedRoot: string`。
  - `WorktreeConsoleInspectRequest`（行277-280）/`Response`（行282-284）：请求含 `sessionId`、`checkoutId`；响应含 `target`。
  - `WorktreeConsoleDiscardRequest`（行286-292）：字段 `sessionId`、`checkoutId`、`expectedRevision`、`confirmDirty`、`rollbackPreview?`。
  - `WorktreeConsolePreflightRequest`（行294-299）/`Response`（行301-303）：请求含 session/checkout/expectedRevision/expectedReviewId；响应含 `preflight: WorktreeApplyPreflightView`。
  - `WorktreeConsolePreviewRequest`（行305-310）：字段 `sessionId`、`checkoutId`、`expectedRevision`、`expectedReviewId`。
  - `WorktreeConsoleCheckpointRequest`（行312-320）：字段 `sessionId`、`checkoutId`、`expectedRevision`、`expectedReviewId`、`expectedGeneration`、`requestId`、`commitMessage`。
  - `WorktreeConsoleResumeRevisionRequest`（行322-329）：含 `conflictContinuation?: WorktreeApplyConflictContinuation`。
  - `WorktreeConsolePreviewRecoveryPreflightRequest`（行331-337）/`Response`（行339-341）：含 `expectedPreviewId`；响应含 `preflight: WorktreePreviewRecoveryPreflightView`。
  - `WorktreeConsolePreparePreviewRecoveryAnalysisRequest`（行343-345）与 `CreatePreviewRecoveryHandoffRequest`（行347-349）扩展上述含 `recoveryProof`。
  - `WorktreeConsoleCreatePreviewRecoveryHandoffResponse`（行351-353）扩展 CreateResponse 加 `recoveryContinuation: WorktreePreviewRecoveryHandoffProof`。
  - `WorktreeConsoleRollbackPreviewRequest`（行355-361）：含 `resumeRevision?`、`recoveryProof?`。
  - `WorktreeConsoleFinalizeRequest`（行363-371）：含 `commitMessage`、`retention`。
  - `WorktreeConsoleFinalizePreviewRequest`（行373-381）：含 `recoveryProof?`。
  - `WorktreeConsoleSetRetentionRequest`（行383-388）：含 `retention: Exclude<WorktreeRetentionMode, 'cleanup'>`。
  - `WorktreeConsoleSetPermanentRequest`（行391-396）：含 `permanent: boolean`。
  - `WorktreeConsoleRetryCleanupRequest`（行398-402）、`BeginNextIterationRequest`（行404-408）：身份字段。
  - `WorktreeConsoleClearSidebarBadgeRequest`（行411-415）：含 `sessionId`、`checkoutId`、`expectedRevision`。
  - `WorktreeConsoleMutationResponse`（行417-423）：字段 `target: WorktreeConsoleTargetSummary`、`changedFiles?`、`commitOid?`、`checkpoint?`、`recoveryContinuation?`。
  - `WorktreeConsoleAbandonedSnapshot`（行426-432）：字段 `checkoutId`、`projectName`、`snapshotOid`、`snapshotAt`、`revision`。
  - `WorktreeConsoleAbandonedListRequest`（行434-436）/`Response`（行438-440）：响应含 `snapshots: WorktreeConsoleAbandonedSnapshot[]`。
  - `WorktreeConsoleRestoreAbandonedRequest`（行442-445）/`Response`（行447-450）：响应含 `checkoutId`、`branch`。
  - `WorktreeConsolePrepareRegenerationRequest`（行452-457）：身份字段。
  - `WorktreeConsoleDiffFile`（行461-467）：字段 `path`、`previousPath?`、`status`、`patch`、`truncated`。
  - `WorktreeConsoleReviewDiffRequest`（行470-475）/`Response`（行477-482）：响应含 `reviewId`、`revision`、`files`、`truncated`。
  - `WorktreeConsoleGitBranch`（行485-490）：字段 `name`、`oid`、`isCurrent`、`upstream`。
  - `WorktreeConsoleGitOverviewResponse`（行492-498）：字段 `root`、`branch`、`headOid`、`branches`、`dirtyCount`。
  - `WorktreeConsoleGitPruneEntry`（行501-505）/`Response`（行507-512）：字段 `dryRun`、`headBranch`、`pruned`、`skipped`。
  - `WorktreeConsoleGitGraphCommit`（行515-523）/`Response`（行525-529）：字段 `commits`。
  - `WorktreeConsoleGitMutationResponse`（行531-534）：字段 `branch`。
  - `WorktreeConsoleGitTag`（行537-549）：字段 `name`、`oid`、`commitOid`、`annotated`、`message`、`pushed`。
  - `WorktreeConsoleGitTagListResponse`（行551-554）：字段 `root`、`tags`。
  - `WorktreeConsoleGitTagMutationResponse`（行556-562）：字段 `tag`、`pushed?`、`pushMessage?`。
  - `WorktreeConsoleGitCreateTagRequest`（行565-573）、`GitDeleteTagRequest`（行575-580）、`GitPushTagRequest`（行582-585）：各含对应参数。
  - `WORKTREE_CONSOLE_ERROR_CODES`（行587-592）与 `WorktreeConsoleErrorCode`（行594）：错误码联合。
  - `WorktreeConsoleErrorCategory`（行595-603）、`WorktreeConsoleRecovery`（行604）：类型。
  - `WorktreeApplyConflictContinuation`（行606-617）、`WorktreeApplyConflictRecoveryProof`（行619-628）、`WorktreeReviewRegenerationProof`（行630-636）、`WorktreePreviewRecoveryAnalysisProof`（行638-646）、`WorktreePreviewRecoveryHandoffProof`（行648-657）：各 proof 结构。
  - `WorktreeRecoveryProof`（行659-663）联合上述 proof；`WorktreeConsoleContinuation`（行664）为冲突续做。
  - `WorktreeConsoleError`（行666-671）：字段 `code`、`message`、`details?`、`continuation?`。
  - `WorktreeConsoleOutcome<T>`（行673-675）：`{ ok: true; value: T } | { ok: false; error: WorktreeConsoleError }`。
  - `WorktreeConsoleErrorMeta`（行677-681）：字段 `category`、`recovery`、`retryable`。
  - `ERROR_META`（行683-716）常量映射；`worktreeConsoleErrorMeta`（行718-720）函数。
  - `WorktreeConsoleAdapter`（行723-761）：上述方法签名集合，含可选 `preflightCreate?`、`createWithInitialCommit?`、`initializeProject?`、`listAbandoned?`、`restoreAbandoned?` 等。

### Model Layer (`src/client/model.ts`)

- **`ToolContentBlock`**（行4-8）：字段 `type: string`、`text?: string`、`[key: string]: unknown`。
- **`ToolCallBlockLike`**（行10-18）：字段 `callId: string`、`argsRaw?: string`、`call?: { argsRaw?: string }`、`content?: ToolContentBlock[]`、`kind?: string`、`isError?: boolean`、`error?: { name?: string; code?: string }`。
- **`ToolCallViewPropsLike`**（行20-29）：字段 `callId: string`、`sessionId?: string`、`toolName: string`、`block: ToolCallBlockLike`、`cwd?: string`、`openFile?: (path: string) => void`、`inspect?: () => void`。
- **`WorktreeCreatePayload`**（行31-43）：字段 `kind: 'worktree_target_created'`、`checkoutId: string`、`targetSessionId: string`、`managedRoot: string`、`phase: string`、`currentOid: string`、`sourceSessionId: string`、`cwd?: string`、`cwdSelected?: boolean`。
- **`WorktreeReviewPayload`**（行45-52）：字段 `kind: 'worktree_ready_for_review'`、`state: 'ready_for_review'`、`reviewId: string`、`revision: number`、`iteration: number`、`changedFiles: string[]`。
- **`ReviewArgs`**（行54-61）：字段 `summary: string`、`details?: string`、`validationStatus: 'passed' | 'failed' | 'partial' | 'not_run'`、`validationSummary?: string`、`tests: Array<{ command: string; status: 'passed' | 'failed' | 'not_run'; summary?: string }>`、`suggestedCommitMessage: string`。
- **`ToolLifecycle`**（行63）：类型 `'running' | 'ok' | 'error' | 'stopped'`。
- **`ParsedTool<TPayload, TArgs>`**（行65-70）：字段 `lifecycle: ToolLifecycle`、`payload: TPayload | null`、`args: TArgs | null`、`error: string | null`。
- **函数**：
  - `textContent`（行72-79）：拼接文本内容。
  - `parseJson`（行81-84）：安全 JSON 解析。
  - `lifecycle`（行86-90）：从 block 推断生命周期。
  - `isRecord`（行92-94）：类型守卫。
  - `stringField`（行96-98）：提取非空字符串字段。
  - `parseCreateTool`（行100-117）：解析创建工具结果。
  - `reviewArgs`（行119-150）：校验并构造 `ReviewArgs`。
  - `parseReviewTool`（行152-185）：解析评审工具结果，含 `iteration` 修正（行179 非负整数回退 0）。

### Sidebar Logic (`src/client/workspace-sidebar/index.tsx`)

- **`EMPTY_TOPOLOGY`**（行15）：默认空拓扑 `WorktreeSidebarTopologyResponse`。
- **`OWNER_SAFE_SESSION_ACTIONS`**（行18）：`Set(['pin','rename','archive','session-id'])`。
- **共享拓扑机制**（行24-40）：`sharedTopology`（行24）与 `sharedTopologyListeners`（行25），`setSharedTopology`（行27-30）、`useSharedTopology`（行32-40）。
- **`ManagedWorktreeSessionDecoration`**（行43-48）：字段 `kind: 'managed-worktree'`、`state: WorktreeSidebarTaskState`、`label: string`、`originalTitle: string`。
- **`ManagedWorkspaceGuard`**（行50-56）：字段 `ready: boolean`、`sessionIds: ReadonlySet<string>`、`workspaceIds: ReadonlySet<string>`、方法 `blockSession(id: string): boolean`（行54）、`blockWorkspace(id: string): boolean`（行55）。
- **`OfficialWorkspaceBrowserProps`**（行58-64）：扩展 `WorkspaceBrowserProps` 加 `adapter: WorktreeConsoleAdapter`、`OfficialBrowser: ComponentType<WorkspaceBrowserProps>`、`guard?`: ManagedWorkspaceGuard、`registerSessionMenuEntry?`: 函数。
- **`ManagedOfficialWorkspaceBrowser`**（行70-203）：
  - 内部 `useEffect` 注册清除徽章菜单（行91-98）。
  - `useEffect` 刷新拓扑并监听 `WORKTREE_REVIEW_REFRESH_EVENT`（行100-125）。
  - `useMemo` 投影（行127-133）。
  - `useLayoutEffect` 更新 guard（行135-141）。
  - 构造 `projectedWorkspaceState`/`projectedSessionState`（行143-172），包装 `OfficialBrowser`（行181-202）并在行159-164 设置 `__dshGitWorktree` 元数据。
- **`SidebarRegistrationContext`**（行205-211）：结构定义（含 `slots`）。
- **`deferredRemoteDirectoryPicker`**（行219-235）：延迟解析 `remote.directoryPicker` 的 Proxy，调用时才读服务（行228-235）。
- **`officialContextProxy`**（行237-321）：代理 `slots.register` 对菜单项守卫（行255-287），替换 `sidebar.workspaces` 为 `ManagedOfficialWorkspaceBrowser`（行273-282）；代理 `remote.directoryPicker` 与 `remoteAccess` 延迟/ stub（行292-316），避免启动死锁。
- **`registerManagedWorkspaceSidebar`**（行328-334）：`applyWorkspace(officialContextProxy(ctx, adapter))`（行333），默认 `applyWorkspace = applyOfficialWorkspace`（行331）。
- **`OfficialSessionMenuEntryProps`**（行337-340）：字段 `sessionId?: string`、`useMenuOpenState?: 函数`。
- **`ClearSidebarBadgeMenuItem`**（行347-381）：终态行菜单项，调用 `adapter.clearSidebarBadge`（行366）。
- **`registerClearSidebarBadgeEntry`**（行383-393）：注册描述符 `name: 'sidebar.workspaces.session.menu.item', id: 'clear-sidebar-badge', order: 500`（行388-392）。
- **`SlotRegistryService`**（行396-399）：接口含 `register(descriptor, component): unknown` 与 `inject(name, callback): unknown`。
- **`OfficialSessionRowEntryProps`**（行402-404）：字段 `sessionId?: string`。
- **`RowSeatProps`**（行407-409）：扩展 `OfficialSessionRowEntryProps` 加 `seat?: string`。
- **`ROW_SEATS`**（行424）：`['sidebar.session.row.leading', 'sidebar.session.row.hover'] as const`；注释（行411-423）说明 Host 声明这两个 seat，无 trailing seat（注入 trailing 会永远等待）。
- **`WorktreeIdentity`**（行433-453）：渲染分支图标与可选 chip 徽章，使用 `data-worktree-state` 样式类。
- **`WorktreeStatusBadgeEntry`**（行464-481）：行内徽章组件，使用 `sidebarBadgeTasks` 查找任务（行467-470）；返回 `WorktreeIdentity` 并总是传入 `chip`（行475-480），两个 seat 均渲染分支图标+状态 chip。
- **`registerDecoratedWorkspaceSidebar`**（行495-535）：读 slot registry 找 `slots`（行499-504），注入 `ROW_SEATS` 每个 seat（行522-527，描述符 `name: seat, id: 'dsh-git-worktree-status', order: 500`），注入 `sidebar.workspaces.session.menu.item` 清除徽章（行528-529），添加 refresh 监听（行507-513）与 effect 清理（行534）。

### Sidebar Model (`src/client/workspace-sidebar/model.ts`)

- **`SidebarWorkspaceView`**（行7-12）：字段 `workspaceId: string`、`title: string`、`path: string`、`sessionIds: readonly string[]`。
- **`SidebarSessionSummary`**（行14-21）：字段 `id: string`、`displayTitle: string`、`title?: string`、`cwd?: string`、`updatedAt?: number`、`blank?: boolean`。
- **`ProjectedManagedTask`**（行23-30）：扩展 `WorktreeSidebarTask` 加 `projectId: string`、`projectName: string`、`stateLabel: string`、`label: string`。
- **`ManagedWorkspaceSidebarProjection`**（行32-39）：字段 `workspaces: SidebarWorkspaceView[]`、`managedBySessionId: Record<string, ProjectedManagedTask | undefined>`、`protectedSessionIds: ReadonlySet<string>`、`protectedWorkspaceIds: ReadonlySet<string>`、`relocatedSessionIds: ReadonlySet<string>`、`suppressedSessionIds: ReadonlySet<string>`。
- **`STATE_LABELS(t)`**（行41-49）：状态→文案映射（working/ready_for_review/preview_active/preview_detached/recovery_required/finalized/discarded）。
- **`sidebarBadgeTasks(topology, t)`**（行51-74）：按 owner 聚合，取 `iteration`/`revision` 大者；行62 生成徽章标签：`label: task.sourceBranch ? `${stateLabel} · ${task.sourceBranch}` : stateLabel`。
- **`projectManagedWorkspaceSidebar(input)`**（行81-203）：合并远程 task 与本地状态，计算保护/隐藏/重定位集合；歧义时 fail open。

### i18n (`src/client/i18n.tsx`, `src/i18n/core.ts`, `src/i18n/transport-messages.ts`)

- **`src/i18n/core.ts`**：
  - `Language`（行2）：`'zh'|'en'`。
  - `normalizeLanguage`（行4-6）：正则判定 en。
  - `MessageCatalog`（行8）：类型 `Record<string, { readonly zh: string; readonly en: string }>`。
  - `Placeholders`/`MessageArgs`（行9-12）：模板占位符推断类型。
  - `Translator`（行14-17）：泛型类型。
  - `createTranslator`（行19-25）：返回翻译函数，替换 `{placeholder}`。
- **`src/i18n/transport-messages.ts`**：
  - `transportMessages`（行3-19）：含 `malformed`、`mountFailed`、`workspaceGenerationUnknown`、`invokeTimeout` 每条带 `zh`/`en`。
- **`src/client/i18n.tsx`**：
  - `ClientTranslator`（行5）、`ClientLocaleSource`（行6-9：字段 `getSnapshot(): { active?: unknown }`、`subscribe(listener: () => void): () => void`）。
  - `localeSource`（行11-16）：提取合法 locale source。
  - `readClientLanguage`（行19-21）：归一化语言，失败回退 `'zh'`。
  - `clientTranslator`/`defaultClientTranslator`（行23-26）。
  - `ClientLanguageContext`（行27）。
  - `ClientI18nProvider`（行29-40）：`useSyncExternalStore` 管理语言。
  - `useClientLanguage`（行42）、`useClientTranslator`（行43-46）、`translatorForServices`（行49-51）。

### Styles (`src/client/styles.ts`)

- **`WORKTREE_STYLES`**（行3-170）：从 `REVIEW_CONSOLE_STYLES` 拼接（行1, 164），含侧栏图标/徽章（行5-90）、卡片（行92-160）、预会话（行152-160）、创建对话框（行166-170）。
  - 徽章块（行17-34）：`max-width: 168px`（行20），放宽 seat 宽度避免 chip 被裁剪（行41-55），状态色（行60-90）。

### Upstream Decoration Script (`scripts/workspace-sidebar-upstream.mjs`)

- **版本常量**（行5-9）：`WORKSPACE_UI_VERSION`、`WORKSPACE_LOCALE_VERSION`、`WORKSPACE_CLIENT_SHA256`、`OFFICIAL_WORKSPACE_VIRTUAL_ID`、`RESOLVED_OFFICIAL_WORKSPACE_VIRTUAL_ID`。
- **`readOfficialWorkspaceClient`**（行11-25）：版本与 SHA256 校验（行15-23），不匹配抛错。
- **`replaceExactlyOnce`**（行27-34）、**`replaceIfPresent`**（行38-42）：精确替换工具；后者用于可选装饰 seam（若不存在则跳过，行89-160 多处调用）。
- **`decorateOfficialWorkspaceClient`**（行49-174）：注入托管守卫、locale、元数据及 `managedWorktreeDecoration` 函数（行101-104 注入 `managedWorktreeDecoration` 与 `ManagedWorktreeIdentity`，使用 `value.label` 优先；现代行/搜索结果等 seam 经 `replaceIfPresent` 注入，缺失则静默跳过）。
- **`materializeOfficialWorkspaceClientModule`**（行176-208）：抽取 factory 生成虚拟模块。

## Architecture

```text
┌──────────────────────────────────────────────────────┐
│ Host: Official WS │ Remote NS (GitWorktree) │ Slots   │
└─────────┬────────────────────┬────────────────┬───────┘
          ▼                    ▼                ▼
┌──────────────────────────────────────────────────────┐
│ Client Fiber (Cordis)                                 │
│ apply (console-remote/index.ts:62)                    │
│  1.Mount 2.Build Adapter 3.Fetch Topology 4.Route     │
│       │                              │                 │
│       ▼                              ▼                 │
│ registerManagedWS (sidebar:328)  registerDecoratedWS  │
│   (proxy ctx takeover)           (sidebar:495,ROW_SEATS│
│    leading/hover order500)                          │
│       └──────────────┬───────────────┘                │
│                      ▼                                │
│ managedWorktreeDecoration(upstream.mjs:101-104)       │
│ label=meta.label ?? i18n state → 徽章+title           │
└──────────────────────────────────────────────────────┘
```

## Data Flow

1. **Initialization**：Host 调 `apply`（`console-remote/index.ts` 行62）；Remote contribution 挂载（行64），`WorktreeConsoleAdapter` 就绪并 `ctx.provide('worktreeConsole', adapter)`（行72）。
2. **Topology Resolution**：`adapter.sidebarTopology()`（adapter.ts 行114，契约行727）返回 `workspaceClientFlavor` 与 `officialWorkspaceActive`（契约行242-244），决定走「接管」（`registerManagedWorkspaceSidebar` sidebar 行328）还是「装饰」（`registerDecoratedWorkspaceSidebar` sidebar 行495）。
3. **Model Projection**：`projectManagedWorkspaceSidebar`（model.ts 行81）合并远程 task 与本地状态；`sidebarBadgeTasks`（model.ts 行51-74）行62 算出 `label`（含分支名）。
4. **Decoration Render**：装饰层 `managedWorktreeDecoration`（由 `scripts/workspace-sidebar-upstream.mjs` 行101-104 注入）读取行节点 `__dshGitWorktree`（在 sidebar/index.tsx 行159-164 设置），优先用 `value.label`、缺失退回 i18n 状态文案，产出带 `title` 的徽章（样式见 styles.ts 行17-34）。在装饰模式（`registerDecoratedWorkspaceSidebar`）下，`WorktreeStatusBadgeEntry`（sidebar/index.tsx 行464-481）通过 `ROW_SEATS`（行424）注入 `leading` 图标与 `hover` 文本标签（均含 chip）。
5. **ToolView Interaction**：用户在 ToolView 的操作打到 Adapter，`invoke`（adapter.ts 行82）带超时与严格校验返回，再由 `parseCreateTool`（model.ts 行100）/`parseReviewTool`（model.ts 行152）解析成稳定模型渲染。

## Connections

- [[target-console|Target Console]]：会话胶囊与 Target 面板，`currentBranch` 决定胶囊主标签（契约行186）。
- [[review-console|Review Console]]：评审差异与恢复流程（契约行469-482）。
- [[console-host]]：Remote 侧的 `sidebarTopology` / `current` / `list` 等投影来源（adapter.ts 行114-116）。

## Known Issues

- **徽章宽度硬编码**：`max-width: 168px`（`styles.ts` 行20）按「状态 · 分支名」典型长度选，超长分支名靠 ellipsis + `title` 兜底，非自适应测量。
- **装饰层依赖官方 bundle 精确片段匹配**：`scripts/workspace-sidebar-upstream.mjs` 用 `replaceExactlyOnce`（行27-34）对官方 client 源码逐字替换，hash 校验（行21-23）失败即报错，官方升级需同步更新脚本；部分 seam 使用 `replaceIfPresent`（行38-42）容错跳过。
- **`value.label` 缺失回落静默**：装饰层注入的 `managedWorktreeDecoration`（upstream.mjs 行101-104）不区分「模型没给 label」和「空串」，均退回状态文案，排查难。
- **`reportBoot` 诊断不可靠**：`console-remote/index.ts` 行86-102 尽力而为，catch 仅日志，`registered: true` 只说明注册调用没抛错，不代表行渲染成功。
- **过滤服务声明**：Remote Entry 的 `inject`（行45-49）故意过滤 `remote.directoryPicker` 与 `remoteAccess` 避免死锁/挂起，相关服务通过代理延迟解析（sidebar/index.tsx 行219-235, 292-316）。
- **FAST_METHODS 与注释一致性**：`adapter.ts` 行57-58 注释称 `list`/`preflight`/`preflightCreate` 放 SLOW 档，代码 `FAST_METHODS`（行59-64）未包含它们，逻辑一致但维护需注意超时档位分配。
- **装饰模式 slot 依赖**：`registerDecoratedWorkspaceSidebar`（sidebar/index.tsx 行495-535）注入 `sidebar.session.row.leading` 与 `sidebar.session.row.hover` seat（行522-527，描述符 `id: 'dsh-git-worktree-status', order: 500`）；若 Host 未声明这些 seats，回调永不执行，徽章不挂载（代码注释行411-423, 510-514 明确无 trailing seat）。
