---
title: client_core
type: module
source_files:
  - src/client/actions.ts
  - src/client/model.ts
  - src/client/i18n.tsx
  - src/i18n/core.ts
  - src/i18n/client-messages.ts
  - src/i18n/transport-messages.ts
  - src/client/index.tsx
  - src/client/styles.ts
  - src/client/WorktreeCreateRow.tsx
  - src/client/WorktreeReviewRow.tsx
  - src/client/review-console/index.ts
  - src/client/review-console/WorktreeReviewPanel.tsx
  - src/client/review-console/recovery-continuation.ts
  - src/client/review-console/status-events.ts
  - src/console-contract.ts
  - tests/client-actions.test.ts
  - tests/client-i18n.test.tsx
tags: [client, session, i18n, toolview, ui, react]
---

## Overview

`client_core` 是 dsh-git-worktree 浏览器端（Client / React）能力的根模块，位于 `src/client/`。它把「会话动作编排」「ToolView 模型解析」「国际化（i18n）」「基础样式与卡片组件」四块最底层的、被所有上层特性共用的能力集中在这里，作为其余客户端特性子模块的基座。

模块边界（引用真实文件行号）：

- **会话动作编排** `src/client/actions.ts`：`navigateToSession`、`selectedSessionId`、`openExistingSession`、`openIsolatedTarget`、`openAuthorizedWorktreeTarget`、`prefillSessionDraft`、`finalizeCurrentSession` 等纯函数，描述「如何验证 Host/Session 身份并把目标 Worktree 导航/提交到当前会话」。这些是幂等、无副作用、可在测试中直接调用的编排原语（参见 `tests/client-actions.test.ts`）。
- **ToolView 模型解析** `src/client/model.ts`：`parseCreateTool` / `parseReviewTool`，把 Harness 日志里记录的 call/result 切片重放成稳定的 `ParsedTool<WorktreeCreatePayload>` / `ParsedTool<WorktreeReviewPayload, ReviewArgs>`。模型只依赖记录，不依赖任何运行时状态，因此「回放稳定」（replay-stable）。
- **国际化** `src/client/i18n.tsx` + `src/i18n/core.ts` + `src/i18n/client-messages.ts`：`createTranslator` / `normalizeLanguage` 共享原语，`clientMessages` 插件自有的双语目录，以及 React Provider / Hook `ClientI18nProvider` / `useClientTranslator` / `translatorForServices`。`translatorForServices` 关键点是「在调用时刻解析语言，而不是模块加载时刻」（见 `src/client/i18n.tsx:49-51`）。
- **入口注册与样式** `src/client/index.tsx`：浏览器入口 `apply(ctx, adapterOverride?)`，挂接两个关键的 ToolView（`worktree_create`、`worktree_ready_for_review`），并拉起子模块（target-console、pre-session、workspace-sidebar、settings-card、console-remote）。`src/client/styles.ts` 提供全局 CSS（`WORKTREE_STYLES`）与卡片基础类（`.dsh-wt-card` 等）。

上层特性（review-console、target-console、pre-session 空白会话开关、workspace-sidebar 投影、console-remote Remote 适配、settings-card）各自作为独立子模块，依赖本模块的模型、动作与 i18n 构建。详见 [[client_review_console]]、[[client_target_console]]、[[client_pre_session]]、[[client_workspace_sidebar]]、[[client_console_remote]]。

## Key Components

### `src/client/actions.ts` — 会话动作编排

**接口（契约）**

- `IsolatedTargetLocation`（6-9）：`{ managedRoot: string; targetSessionId: string }`，描述一个隔离 Worktree 目标位置。
- `SnapshotStore<T>`（11-14）：`getSnapshot(): T` + `subscribe(listener): () => void`，外部存储（external store）读取契约。
- `ClientSessionSnapshot`（16-20）：`{ running; openState: 'cold'|'loading'|'open'|'error'; removed }`。
- `ClientSessionBinding`（22-42）：包裹 Harness Session，`session` 暴露 `getSnapshot?` / `subscribe?` / `prompt?` / `command?`。`ctx?` 是 Agent 作用域上下文，真实 Harness 绑定上存在。
- `ClientSessions`（44-61）：`list: SnapshotStore<...>`（含 `current`/`ids`/`byId`，`byId` 含 `cwd`/`retainedBy`/`projectionValues`）、`create(input): Promise<string>`、`using?`、`open?`（legacy，已注释「UI Workspace owns selection」时移除，见 58-59）、`binding(sessionId)`。
- `ClientWorkspaces`（63-66）：`create({path}): Promise<{workspaceId,path}>`、`openPath(path): Promise<void>`。
- `WorktreeClientServices`（68-80）：聚合 `sessions`/`workspaces`，可选 `uiWorkspace.openSession`、`locale`、`conversation`。
- `PreSessionWorktreeServices`（87-102）：在 `WorktreeClientServices` 之上扩展 `workspaces.archiveSession`/`delete`，以及 `conversation.blocks.set`/`storeFor`（空白会话准备的归档/删除/阻塞面）。
- `PreSessionInput`（105-113）：composer 草稿动作，分「图片版 `addImages/removeImage`」与「通用附件版 `addAttachments/removeAttachment`」两种形态（Harness 重命名 image-only API 时使用后者）。

**导出函数**

- `samePath(left, right)`（115-122）：归一化路径分隔符并做大小写无关比较（Windows 盘符 `C:\` 前缀特判）。open 系列全部用它校验 cwd。
- `navigateToSession(services, sessionId)`（125-132）：优先 `uiWorkspace.openSession`，否则 legacy `sessions.open`，两者皆无则抛 `harness.session.navigation.unavailable`。
- `selectedSessionId(snapshot)`（135-142）：在新旧两套选择契约（legacy `current` 与 `retainedBy.mainView`）下解析唯一的主视图 Session；多于一个 retained Session、或 projected 的 selected 与 `current` 不一致时返回 `undefined`。
- `openExistingSession(services, sessionId, expectedCwd)`（145-154）：只有列表证明 `cwd` 存在且与 `expectedCwd` 经 `samePath` 一致才导航，否则返回 `false`（fails closed）。
- `waitForProjectedSessionPath(...)`（156-196）：内部 `Promise`，订阅 Session 列表；在 2000ms 超时（188-190）或 `cwd` 与 Host 不一致时 reject，否则 cwd 投影到预期值时 resolve。
- `openIsolatedTarget(services, payload, isActive?)`（199-230）：幂等路径——若目标 Session 已存在则走 `openExistingSession`；否则 `workspaces.create` → `sessions.create`（校验返回的 `sessionId` 与 `targetSessionId` 一致，225）→ 等投影 cwd（227）→ 导航。每个 await 之后都用 `isActive()` 守门。
- `openAuthorizedWorktreeTarget(adapter, services, callerSessionId, expected, isActive?)`（236-263）：先 `adapter.inspect` 验证 `capabilities.inspect/open`、checkoutId/ownerSessionId/targetSessionId 三元身份一致、`managedRoot` 非 null，再转交 `openIsolatedTarget`。这是「路径无关（path-free）Host 鉴权后复用 cwd 校验导航」的入口。
- `prefillSessionDraft(services, sessionId, text)`（266-275）：仅写入 composer 草稿（调用 `conversation.input.for(binding.ctx).setDraft`），**绝不** `command`/`send`/`followup`。
- `finalizeCurrentSession(services, reviewId, revision, retention)`（278-293）：用 `selectedSessionId` 取当前 Session，对其 binding 发送精确命令 `/worktree finalize ${reviewId} ${revision} ${retention}`，校验 `matched`。

### `src/client/model.ts` — ToolView 模型

**接口**

- `ToolContentBlock`（4-8）、`ToolCallBlockLike`（10-18：含 `callId`/`argsRaw`/`call`/`content`/`kind`/`isError`/`error`）、`ToolCallViewPropsLike`（20-29：含 `sessionId?`/`toolName`/`block`/`cwd?`/`openFile?`/`inspect?`）。
- `WorktreeCreatePayload`（31-43）：`worktree_target_created` 事件载荷，含 `checkoutId`/`targetSessionId`/`managedRoot`/`phase`/`currentOid`/`sourceSessionId`，可选 `cwd`/`cwdSelected`。
- `WorktreeReviewPayload`（45-52）：`worktree_ready_for_review`，含 `state`/`reviewId`/`revision`/`iteration`/`changedFiles`。
- `ReviewArgs`（54-61）：验收参数 `summary`/`details?`/`validationStatus`/`validationSummary?`/`tests[]`/`suggestedCommitMessage`。
- `ToolLifecycle`（63）：`'running'|'ok'|'error'|'stopped'`。
- `ParsedTool<TPayload, TArgs>`（65-70）：`{ lifecycle; payload; args; error }`。

**导出函数**

- `parseCreateTool(block, t?)`（100-117）：`running`→空 payload；非 ok→`error`；否则用 `isRecord`/`stringField` 严格校验 6 个必填字段（`checkoutId`/`targetSessionId`/`managedRoot`/`phase`/`currentOid`/`sourceSessionId`，106-113），失败报 `malformed.worktree.create.result`。
- `parseReviewTool(block, t?)`（152-185）：解析 result 与 args（`reviewArgs`，119-150），对 `validationStatus`、`tests[].status`、整数非负 `iteration`（179）做严格校验。
- 辅助：`textContent`（72-79）、`parseJson`（81-84，容错 `JSON.parse`）、`lifecycle`（86-90，`interrupted`→`stopped`）、`isRecord`（92-94）、`stringField`（96-98）。

### `src/client/i18n.tsx` — 客户端国际化

- `ClientTranslator = Translator<typeof clientMessages>`（5）。
- `ClientLocaleSource`（6-9）：`getSnapshot(): {active?}` + `subscribe`，DSH LocaleFace 形态。
- `localeSource(locale)`（11-16）：鸭子类型识别 LocaleFace。
- `readClientLanguage(locale)`（19-21）：从 `snapshot.active` 经 `normalizeLanguage` 解析，异常回退 `'zh'`。
- `clientTranslator(language?)`（23-25）→ `defaultClientTranslator`（26，默认 `'zh'`）。
- `ClientI18nProvider`（29-40）：用 `useSyncExternalStore` 订阅 locale，向 context 注入 `Language`。
- `useClientLanguage`（42）、`useClientTranslator`（43-46）。
- `translatorForServices(services)`（49-51）：在调用时刻用 `readClientLanguage(services.locale)` 解析语言——命令式动作（如 `finalizeCurrentSession`）依赖它，而非加载时刻。

### `src/i18n/core.ts` — 共享翻译原语（无浏览器/Host 依赖）

- `Language = 'zh' | 'en'`（2）。
- `normalizeLanguage(value)`（4-6）：仅以 `en`/`-` 前缀判定英文，其余 `'zh'`。
- `createTranslator(catalog, language)`（19-25）：字面量模板替换 `{name}` 占位符；缺参保留原占位符。
- `Translator<C>`（14-17）、`MessageCatalog`（8）类型；占位符类型由模板字面量推断（9-12）。

### `src/i18n/client-messages.ts` 与 `transport-messages.ts`

- `clientMessages`（4 起）：插件自有的双语目录，约 1800 行；键形如 `worktree.creation.failed`、`finalize.command.failed`（带 `p0`/`p1` 参数）、`the.cwd.of.new.harness.session.does.not` 等。测试 `tests/client-i18n.test.tsx:73-82` 断言每条目的 `zh`/`en` 占位符集合一致、英文不含 CJK。
- `transportMessages`（`src/i18n/transport-messages.ts:3-20`）：Remote 层专用消息 `malformed`/`mountFailed`/`workspaceGenerationUnknown`/`invokeTimeout`，被 `console-remote/adapter.ts` 使用。

### `src/client/index.tsx` — 入口注册

- `WORKTREE_CONSOLE_ADAPTER_SERVICE = 'worktreeConsole'`（18）。
- `inject = ['slots','workspaces','sessions','conversation','connection','locale']`（36）。
- `apply(ctx, adapterOverride?)`（49-106）：构造 `servicesOf`（38-46），用 `Proxy` 包裹 `ctx.slots.register` 让本插件每个注册组件都被 `ClientI18nProvider` 包裹（53-59）；注入单个 `<style data-dsh-git-worktree>`（69-77）；注册两个 ToolView：`worktree_create`→`WorktreeCreateRow`、`worktree_ready_for_review`→`WorktreeReviewRow`（81-88）；当存在 `adapter` 时再拉起 `registerTargetConsole` 与 `registerPreSessionWorktree`（91-105）。

### `src/client/styles.ts` — 基础样式

- `WORKTREE_STYLES`（3-170）：含 sidebar 装饰（`.dsh-git-worktree-sidebar-icon`/`-badge`，按 `data-worktree-state` 取色，41-90）、卡片 `.dsh-wt-card` 及派生类、`pre-session` 开关样式（152-170），并拼入 `REVIEW_CONSOLE_STYLES`（164）。

### 基础卡片组件

- `WorktreeCreateRow`（`src/client/WorktreeCreateRow.tsx:13-83`）：用 `parseCreateTool` 解析，渲染 `worktree_create` 卡片；`openTarget`（27-39）调用 `openIsolatedTarget(services, payload)`（32），用 `mounted`/`openState`/`openError` 管理开目标过程。
- `WorktreeReviewRow`（`src/client/WorktreeReviewRow.tsx:26-123`）：用 `parseReviewTool` 解析，构造 `WorktreeReviewEvidence` 与 `WorktreeReviewIdentity`，订阅 `WORKTREE_REVIEW_REFRESH_EVENT`（`requestWorktreeReviewRefresh`，见 `status-events.ts:1-6`）与 `adapter.current` 拉取实时 target（69-88）。在 `model.lifecycle === 'error'` 且为 `target_unselected` 本地错误时整体返回 `null`（90）。

### `src/client/review-console/` 子能力（基础类型与恢复队列）

- `WorktreeReviewPanel.tsx:9-25`：`WorktreeReviewEvidence`（扩展 `WorktreeConsoleReviewSummary` + `detailsMarkdown?`）、`WorktreeReviewIdentity`、`WorktreeReviewPanelProps`；`reviewIsStale`（40-52）按 target 状态/rev/reviewId 判定验收卡是否过期。
- `recovery-continuation.ts`：持久的恢复请求队列。`WorktreeRecoveryRequest`（29）= conflict 或 regeneration 两种；`enqueueWorktreeRecovery`（389-427）、`restoreWorktreeRecovery`（429-489）、`retryWorktreeRecovery`（491-501）、`useWorktreeRecoverySnapshot`（513-520）、`buildWorktreeRecoveryPrompt`（378-386，生成带精确 ID/hash/JSON 路径的 agent 提示）。完整行为见 [[client_review_console]]。

> 上层 UI 子模块（review-console 完整、target-console、pre-session、workspace-sidebar、settings-card、console-remote）各自独立成文，下面 Architecture / Connections 指向它们。

## Architecture

本模块是浏览器端能力的基座；上层特性子模块都通过本模块的模型、动作与 i18n 构建。组件关系如下（标注真实文件/类）：

```text
┌─────────────────────────── src/client/index.tsx ───────────────────────────┐
│ apply(ctx, adapter?) 注册两个 ToolView + 拉起子模块                          │
│  WorktreeCreateRow ◄── actions.openIsolatedTarget                           │
│  WorktreeReviewRow ◄── actions.finalizeCurrentSession                       │
└───────┬───────────────────────┬───────────────────────┬───────────────────┘
        ▼                       ▼                       ▼
┌───────────────┐      ┌────────────────────┐   ┌──────────────────────────┐
│ actions.ts    │      │ model.ts           │   │ i18n.tsx + i18n/core.ts  │
│ 会话动作编排   │◄────►│ parseCreate/Review │   │ ClientI18nProvider /      │
│ (纯函数)      │      │ Tool(回放稳定模型) │   │ translatorForServices     │
└──────┬────────┘      └─────────┬──────────┘   └────────────┬─────────────┘
       │ navigateToSession       │ 证据/参数           ┌──────┴──────┐
       ▼                         ▼                     │ clientMessages│
┌──────────────────────┐  ┌──────────────────────────┐(src/i18n)    │
│ console-contract.ts  │  │ WorktreeCreateRow/        │  transportMessages │
│ WorktreeConsoleAdapter│ │  ReviewRow (卡片)        │               │
│ (Host 契约 DTO)      │  └──────────┬───────────────┘               │
└──────────┬───────────┘            │ 注入 WORKTREE_STYLES           │
          │ inspect/current/list    ▼                                │
          ▼                  src/client/styles.ts (.dsh-wt-card)     │
┌──────────────────────────────────────────────────────────────────┘
          │
          ▼  上层子模块（独立成文）
   review-console / target-console / pre-session / workspace-sidebar /
   console-remote / settings-card
```

要点：

- `actions.ts` 是「无副作用的编排原语」：每个函数都接收 `WorktreeClientServices` + 显式 `isActive?` 守门，并依赖 `console-contract.ts` 的 `WorktreeConsoleAdapter` 进行 Host 身份校验（见 `console-contract.ts:745-784`）。
- `model.ts` 是「纯解析」：`parseCreateTool`/`parseReviewTool` 只把 Harness 日志的 call/result 切片重放成稳定对象，不持有任何运行时状态，因此可回放、可测试（`tests/client-i18n.test.tsx:84-90` 直接断言诊断文案）。
- i18n 分层：`i18n/core.ts`（平台无关）→ `i18n/client-messages.ts`（插件文案）→ `client/i18n.tsx`（React Provider + 命令式 `translatorForServices`）。
- 入口 `apply`（`index.tsx:49-106`）用 `Proxy` 把每个本插件注册组件包进 `ClientI18nProvider`，保证各 DSH Client 实例相互隔离（53-59）；同时通过 `document.createElement('style')` 注入本插件 CSS（69-77）。

## Data Flow

### 流程 A：打开一个隔离 Worktree 目标（创建/复用）

1. Harness 日志里出现 `worktree_target_created` 工具结果 → `WorktreeCreateRow`（`WorktreeCreateRow.tsx:13`）调用 `parseCreateTool` 得到 `WorktreeCreatePayload`。
2. 用户点击「打开隔离会话」→ `openTarget`（`WorktreeCreateRow.tsx:27-39`）调用 `openIsolatedTarget(services, payload)`（`actions.ts:199-230`）。
3. `openIsolatedTarget`：若目标 Session 已在 `sessions.list.byId` 中 → `openExistingSession`（校验 `cwd` 经 `samePath` 一致，145-154）；否则 `workspaces.create` → `sessions.create`（校验 sessionId 与 targetSessionId 一致，225）→ `waitForProjectedSessionPath` 等 2s 内 cwd 投影（156-196）→ `navigateToSession`（125-132）。每一步 `isActive()` 为 false 即提前返回。

### 流程 B：路径无关的已授权目标打开

1. `openAuthorizedWorktreeTarget`（`actions.ts:236-263`）先 `adapter.inspect`（来自 `console-contract.ts:744` 的 `WorktreeConsoleInspectRequest`）校验 `capabilities.inspect/open`、`checkoutId/ownerSessionId/targetSessionId` 三元身份、且 `managedRoot` 非空。
2. 身份通过后转交 `openIsolatedTarget`（`actions.ts:259-262`）。`isActive` 可在 `inspect` 在途时切换为假，从而放弃导航（`tests/client-actions.test.ts:159-178`）。

### 流程 C：验收卡（review）渲染与刷新

1. 日志出现 `worktree_ready_for_review` → `WorktreeReviewRow`（`WorktreeReviewRow.tsx:26`）调用 `parseReviewTool` 得到 `payload`（`WorktreeReviewPayload`）+ `args`（`ReviewArgs`）。
2. 组件在 `payload` 变化时 dispatch `requestWorktreeReviewRefresh(sessionId)`（`status-events.ts:4`）并订阅 `WORKTREE_REVIEW_REFRESH_EVENT`（窗口 CustomEvent）以 `setRefreshNonce`（54-62）。
3. 若有 `adapter`，`WorktreeReviewRow` 调用 `adapter.current({sessionId})`（`review-console` 内，对应 `console-contract.ts:750`）拉取实时 `WorktreeConsoleTargetSummary`，用于 `reviewIsStale`（`WorktreeReviewPanel.tsx:40-52`）判定过期，并构造 `WorktreeReviewIdentity`（`WorktreeReviewRow.tsx:92-101`）。
4. 最终交给 `WorktreeReviewPanel` 渲染（见 [[client_review_console]]）。

### 流程 D：最终化 / 草稿预填（命令式动作）

- `finalizeCurrentSession`（`actions.ts:278-293`）：`selectedSessionId` 取当前主视图 Session → `binding.session.command('/worktree finalize …')`，校验 `matched`。
- `prefillSessionDraft`（`actions.ts:266-275`）：仅 `conversation.input.for(binding.ctx).setDraft(text)`，**不发送**。

### 流程 E：空白会话准备（pre-session，跨模块）

- `PreSessionWorktreeController.prepare`（`pre-session/controller.ts:75-195`）在 composer 发送前准备隔离空白 Session：`adapter.create` → `workspaces.create` → `sessions.create`，再用 `sessions.using`（新版）或 `binding` 把草稿/附件 CAS 写入目标后 `navigateToSession` 并清空源草稿，失败则 `rollback`（197-229）。详见 [[client_pre_session]]。

## Connections

- [[console-contract]]：`src/console-contract.ts` 是本模块动作与所有上层 UI 依赖的共享 JSON 契约（`WorktreeConsoleAdapter` 745-784、`WorktreeConsoleTargetSummary` 149-179、`WorktreeConsoleReviewSummary` 135-146）。动作层对 Host 的所有身份校验都走这里。
- [[client_review_console]]：`src/client/review-console/`，验收面板、`WorktreeReviewPanel`、`ReviewActions`、`ReviewDetailsModal`、`recovery-continuation` 队列、各 preflight/recovery 缓存。本模块只放入口类型与 `reviewIsStale`/`buildWorktreeRecoveryPrompt`。
- [[client_target_console]]：`src/client/target-console/`，Harness 原生 Session Target 贡献（`registerTargetConsole`、`TargetStatusAction`、`WorktreeHeroChip`、`WorktreeManagerModal` 等），由 `index.tsx:91-96` 拉起。
- [[client_pre_session]]：`src/client/pre-session/`，空白会话开关 `registerPreSessionWorktree` 与 `PreSessionWorktreeController`，由 `index.tsx:100-104` 拉起。
- [[client_workspace_sidebar]]：`src/client/workspace-sidebar/`，把 Managed Checkout 投影进官方 Workspace 侧栏（`projectManagedWorkspaceSidebar` 见本模块 `workspace-sidebar/model.ts`，但注册逻辑独立成文）。
- [[client_console_remote]]：`src/client/console-remote/`，Remote 适配 `createWorktreeConsoleRemoteAdapter`（`adapter.ts`，30s/180s 超时与 strict contract 校验），以及按 Host Workspace 形态（legacy/alpha/next/modern）分支挂载的入口 `apply`。
- 宿主集成由 `src/client/index.tsx:36` 的 `inject = ['slots','workspaces','sessions','conversation','connection','locale']` 声明，并依赖 DSH 虚拟模块 `virtual:dsh-official-workspace-client[-alpha|-next]`（`harness-platform.d.ts:1-29`）。

## Known Issues

- **`ClientSessions.open` 为 legacy 且已弃用**：`actions.ts:58-59` 注释明确「Legacy Session Controller navigation (removed when UI Workspace owns selection)」；`openExistingSession`/`navigateToSession` 仍作为回退路径保留，但新 Host 应走 `uiWorkspace.openSession` 或 `sessions.using`（见 `actions.ts:125-132`、`controller.ts:160-164`）。
- **`samePath` 仅做字符串归一**，不含符号链接/挂载点解析；跨设备软链或非规范路径可能误判一致（`actions.ts:115-122`）。
- **`waitForProjectedSessionPath` 固定 2 秒超时**（`actions.ts:156-190`）：在极慢的 Host 投影下可能 reject；测试 `tests/client-actions.test.ts:213-226` 用 `vi.useFakeTimers` 覆盖该路径。
- **`WorktreeReviewRow` 对 `target_unselected` 本地错误返回 `null` 整卡隐藏**（`WorktreeReviewRow.tsx:90`）：依赖正则 `(?:^|\b)target_unselected(?:\b|$)` 与文案 `no.session.target.has.been.selected`（20-24）；若 Host 改该错误码文案，回退判定会失效。
- **i18n 仅支持 `zh`/`en` 两语**（`i18n/core.ts:4-6`）：`normalizeLanguage` 把一切非 `en` 前缀都归为 `zh`，包括 `ja`/`fr`（`tests/client-i18n.test.tsx:45-47` 已验证 `ja-JP`→`zh`）。
- **`styles.ts` 注入的 `<style>` 自贴上 `data-plugin="dsh-git-worktree"`**（`index.tsx:66-74`），由模块系统的 `claimStyles`/`removeOwnedStyles` 管理；若该机制失效，样式可能被邻居模块误删/误领。
- **`translatorForServices` 在每次命令式调用时解析语言**（`i18n.tsx:49-51`），若 Harness `locale` 快照未就绪会回退 `zh`；这是有意的「调用时刻解析」设计，但意味着在 locale 落地前触发的动作会用中文报错。
