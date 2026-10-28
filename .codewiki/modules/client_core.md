---
title: client_core
type: module
source_files:
  - src/client/actions.ts
  - src/client/model.ts
  - src/client/i18n.tsx
  - src/client/index.tsx
  - src/client/WorktreeCreateRow.tsx
  - src/client/WorktreeReviewRow.tsx
  - src/i18n/core.ts
  - src/i18n/client-messages.ts
  - tests/client-actions.test.ts
  - tests/client-i18n.test.tsx
  - tests/client-toolview.test.tsx
  - tests/i18n-core.test.ts
tags: [client, state, actions, model, i18n, toolview]
---

## Overview

`client_core` 是插件在浏览器端的「客户端核心」：它把 Harness/DSH 提供的运行时面（sessions、workspaces、uiWorkspace、conversation、locale）封装成一组编排动作（`src/client/actions.ts`），把 ToolView 日志切片（call/result）解析成可回放（replay-stable）的纯模型（`src/client/model.ts`），并提供一个 React 国际化层（`src/client/i18n.tsx` + `src/i18n/core.ts` + `src/i18n/client-messages.ts`）。入口文件 `src/client/index.tsx` 通过 DSH 的 `slots` 把两类专用 ToolView（`WorktreeCreateRow`、`WorktreeReviewRow`）注册到 `tool.call.toolview`，并把可选的 `WorktreeConsoleAdapter` 接到 `target-console` 与 `pre-session` 子模块。

核心设计约束（来自源码注释）：

- 所有模型解析都是**纯函数、仅依赖日志切片**，因此同一份 ToolView 日志在重放时渲染出完全相同的 UI（`src/client/model.ts` 第 2 行注释）。
- 所有导航动作都遵循「fail closed（失败即拒绝）」原则：Session 的 cwd 必须与 Host 记录严格一致、owner/target 身份必须被 Host `inspect` 二次校验，否则抛错而不是默默丢失目标选择（`src/client/actions.ts` 第 23–25 行、`navigateToSession` 第 124–132 行）。
- 语言偏好在**调用时**解析，而不是模块加载时，避免多实例 Client 共享可变语言状态（`src/client/i18n.tsx` 第 48–51 行）。

该模块不直接接触 Cordis、Remote transport 或文件系统实现；它与 Host 之间的唯一契约是 `WorktreeConsoleAdapter`（`src/console-contract.ts` 第 745–784 行）与 `WorktreeConsoleAdapter.inspect` 等 JSON 接口。

## Key Components

### `src/client/actions.ts` — 客户端编排动作

公开接口/类型：

- `IsolatedTargetLocation`（第 6–9 行）：`{ managedRoot: string; targetSessionId: string }`，描述一个隔离 Worktree 目标位置。
- `SnapshotStore<T>`（第 11–14 行）：`getSnapshot(): T` + `subscribe(listener): () => void`，Harness 外部存储的通用形状。
- `ClientSessionSnapshot`（第 16–20 行）：`{ running: boolean; openState: 'cold'|'loading'|'open'|'error'; removed: boolean }`。
- `ClientSessionBinding`（第 22–42 行）：Agent 作用域的上下文 `ctx?` 与 `session` 对象，含 `sessionId?`、`getSnapshot?()`、`subscribe?()`、`prompt?()`（queue/steer 两种模式）、`command(line)`。`command` 返回 `{ ok, value:{matched} }` 或 `{ ok:false, error }`。
- `ClientSessions`（第 44–61 行）：`list: SnapshotStore<{current?; ids; byId}>`、`create({workspaceId, sessionId, agentPreset?})`、`using?()`（新 Session Controller 用，在 open 与回调 handoff 期间保留目标）、`open?()`（遗留导航，UI Workspace 接管选择后移除）、`binding(sessionId)`。
- `ClientWorkspaces`（第 63–66 行）：`create({path})`、`openPath(path)`。
- `WorktreeClientServices`（第 68–80 行）：组合面，`uiWorkspace?.openSession`、`locale?`、`sessions`、`workspaces`、`conversation?`（仅手动 draft 预填用）。
- `PreSessionWorktreeServices`（第 87–102 行）：继承自 `WorktreeClientServices`，扩展了 `workspaces.archiveSession/delete` 与 `conversation.blocks.set/storeFor`，用于空白会话准备流程。
- `PreSessionInput`（第 105–113 行）：草稿动作联合类型，旧版 `setDraft/addImages/removeImage` 与新版 `setDraft/addAttachments/removeAttachment`（Harness 把仅图片 API 改名为通用附件）。

公开函数：

- `samePath(left, right)`（第 115–122 行）：归一化尾部斜杠与反斜杠后比较；Windows 盘符路径大小写不敏感比较。
- `navigateToSession(services, sessionId)`（第 125–132 行）：优先用 `uiWorkspace.openSession`，否则 `sessions.open`，都不可用时抛错（`harness.session.navigation.unavailable`）。
- `selectedSessionId(snapshot)`（第 135–142 行）：在遗留 `current` 选择与新增的 `retainedBy.mainView` 契约间解析唯一可见主 Session；若保留多个或 `current` 与保留项不一致则返回 `undefined`。
- `openExistingSession(services, sessionId, expectedCwd)`（第 145–154 行）：仅当 `byId[sessionId].cwd` 存在且与 `expectedCwd` 经 `samePath` 一致时才 `navigateToSession`，否则返回 `false`。
- `waitForProjectedSessionPath(...)`（第 156–196 行，私有）：订阅 `sessions.list`，2 秒超时（`2_000`）内等待新建 Session 投影出可信 cwd；用 `isActive()` 守卫在组件卸载时静默取消。
- `openIsolatedTarget(services, payload, isActive?)`（第 199–230 行）：幂等——已存在则走 `openExistingSession`（cwd 不一致抛错）；否则 `workspaces.create` → 校验 `workspace.path === managedRoot` → `sessions.create` → `waitForProjectedSessionPath` → `navigateToSession`。
- `openAuthorizedWorktreeTarget(adapter, services, callerSessionId, expected, isActive?)`（第 236–263 行）：先 `adapter.inspect` 校验 `capabilities.inspect/open`、checkout/owner/target 身份与 `managedRoot`，再委托 `openIsolatedTarget`。
- `prefillSessionDraft(services, sessionId, text)`（第 266–275 行）：仅写入草稿（`binding.ctx + conversation.input.for(ctx).setDraft`），**绝不**调用 command/send/followup，返回是否成功。
- `finalizeCurrentSession(services, reviewId, revision, retention)`（第 278–293 行）：用 `selectedSessionId` 取唯一主 Session，对其 `binding.session.command('/worktree finalize <id> <rev> <retention>')`，校验 `matched`。

### `src/client/model.ts` — 可回放 ToolView 模型

公开接口：

- `ToolContentBlock`（第 4–8 行）、`ToolCallBlockLike`（第 10–18 行：`callId/argsRaw/call/content/kind/isError/error`）、`ToolCallViewPropsLike`（第 20–29 行：`callId/sessionId?/toolName/block/cwd?/openFile?/inspect?`）。
- `WorktreeCreatePayload`（第 31–43 行）：`worktree_target_created` 事件载荷，全部字段 `checkoutId/targetSessionId/managedRoot/phase/currentOid/sourceSessionId` 为必填字符串，可选 `cwd?`、`cwdSelected?`。
- `WorktreeReviewPayload`（第 45–52 行）：`worktree_ready_for_review`，含 `reviewId/revision/iteration/changedFiles[]`。
- `ReviewArgs`（第 54–61 行）：验收参数 `summary/details?/validationStatus/tests[]/suggestedCommitMessage`。
- `ToolLifecycle`（第 63 行）：`'running'|'ok'|'error'|'stopped'`。
- `ParsedTool<TPayload, TArgs>`（第 65–70 行）：`{ lifecycle; payload; args; error }`。

函数（全部纯函数）：

- `parseCreateTool(block, t?)`（第 100–117 行）：从 `block` 文本 JSON 解析并**逐个字段强校验**（`isRecord` + `stringField`），缺少任一必填字段返回 `lifecycle:'error'`。
- `parseReviewTool(block, t?)`（第 152–185 行）：同时解析结果 JSON 与 `argsRaw`（通过 `block.call?.argsRaw` 或 `block.argsRaw`），递归校验 `reviewArgs`（第 119–150 行）的 `tests[]` 与 `tests[].status`，`iteration` 规范化（非负整数，否则 0）。
- 辅助 `textContent`（第 72–79 行）、`parseJson`（第 81–84 行）、`lifecycle`（第 86–90 行，注意 `interrupted` 错误码映射为 `stopped`）、`isRecord`、`stringField`。

### `src/client/i18n.tsx` + `src/i18n/core.ts` — 客户端国际化

- `src/i18n/core.ts`：
  - `Language = 'zh' | 'en'`（第 2 行）。
  - `normalizeLanguage(value)`（第 4–6 行）：以 `en`/`-` 开头识别英文，其余一律 `'zh'`。
  - `MessageCatalog` 类型（第 8 行）：`Record<string, {readonly zh; readonly en}>`。
  - `Translator<C>`（第 14–17 行）：基于占位符字符串字面量推断必填参数类型。
  - `createTranslator(catalog, language)`（第 19–25 行）：用正则 `/\{([^{}]+)\}/g` 替换占位符，缺失参数保留原占位符。
- `src/client/i18n.tsx`：
  - `ClientTranslator = Translator<typeof clientMessages>`（第 5 行）。
  - `ClientLocaleSource`（第 6–9 行）：`getSnapshot()/subscribe()`。
  - `localeSource(locale)`（第 11–16 行）：鸭子类型校验；`readClientLanguage(locale)`（第 19–21 行）读取 `snapshot.active`，异常回退 `'zh'`。
  - `clientTranslator(language?)` / `defaultClientTranslator`（第 23–26 行）。
  - `ClientI18nProvider`（第 29–40 行）：用 `useSyncExternalStore` 订阅 locale，下插 `ClientLanguageContext`。
  - `useClientLanguage()`（第 42 行）、`useClientTranslator()`（第 43–46 行）。
  - `translatorForServices(services)`（第 49–51 行）：命令式动作调用时解析语言。

### `src/client/index.tsx` — 浏览器入口

- `WORKTREE_CONSOLE_ADAPTER_SERVICE = 'worktreeConsole'`（第 18 行）。
- `inject = ['slots','workspaces','sessions','conversation','connection','locale']`（第 36 行）。
- `servicesOf(ctx)`（第 38–46 行）：从 DSH `ctx.get` 组装 `PreSessionWorktreeServices`。
- `apply(ctx, adapterOverride?)`（第 49–106 行）：用 `Proxy` 包裹 `slots.register` 自动包一层 `ClientI18nProvider`；注入 `<style>`（`data-dsh-git-worktree`）；注册 `worktree_create` 与 `worktree_ready_for_review` 两个 ToolView；当 `adapter` 存在时再 `registerTargetConsole` 与 `registerPreSessionWorktree`。

### `src/client/WorktreeCreateRow.tsx` — 创建卡（有状态）

- `OpenState = 'idle'|'opening'|'error'`（第 11 行）。
- `WorktreeCreateRow({block, services})`（第 13–83 行）：`parseCreateTool` 得到模型；`useState` 维护 `openState/openError`；`useEffect` 用 `mounted` ref 防止卸载后 setState；`openTarget()`（第 27–39 行）调用 `openIsolatedTarget(services, payload)`。`cwdSelected` 为真时隐藏「打开隔离会话」按钮。

### `src/client/WorktreeReviewRow.tsx` — 验收卡（有状态）

- `WorktreeReviewRow({block, sessionId, adapter})`（第 26–123 行）：`parseReviewTool` 得到 `payload/args` 后构造 `WorktreeReviewEvidence`（第 36–48 行）。`useState` 维护 `liveTarget/liveError/refreshNonce`。三个 `useEffect`：挂载时对 `sessionId` 触发 `requestWorktreeReviewRefresh`（第 50–52 行）；监听 `WORKTREE_REVIEW_REFRESH_EVENT` 自增 `refreshNonce`（第 54–62 行）；与 `adapter.current({sessionId})` 拉取实时 `target`（第 64–88 行，带 `active` 守卫与增量刷新逻辑）。`isLocalTargetUnselected`（第 20–24 行）：`target_unselected` 错误时整张卡渲染 `null`。

### `src/i18n/client-messages.ts` — 文案目录

- `clientMessages` 常量（第 4 行起）：每个 key 形如 `"key": {"zh","en"}`，大量含占位符 `{p0}/{p1}/{count}`。覆盖导航、验收、同步预检、恢复、Git 分支/标签等全部客户端 UI 文案。每条 zh/en 的占位符集合必须一致（由 `tests/client-i18n.test.tsx` 第 73–82 行与 `tests/i18n-catalogs.test.ts` 校验），且 en 文案不得含中文字符。

## Architecture

```text
┌──────────────────────────────────────────────────────────────┐
│ DSH Client runtime (ctx)                                       │
│  slots · workspaces · sessions · conversation · locale         │
└───────────────┬───────────────────────────┬──────────────────┘
                │ apply()                    │ ctx.get('locale')
                ▼                            ▼
┌──────────────────────────┐      ┌─────────────────────────────┐
│ src/client/index.tsx     │      │ src/client/i18n.tsx          │
│ apply() 注册两个 ToolView │      │ ClientI18nProvider/useClient │
│ 包裹 ClientI18nProvider   │      │ translatorForServices()      │
└────────┬─────────────┬────┘      └──────────────┬──────────────┘
         │             │                          │
         ▼             ▼                          │
┌────────────────┐ ┌──────────────────────────┐  │ 注入 locale
│ WorktreeCreate │ │ WorktreeReviewRow         │  │
│ Row.tsx        │ │ (live adapter.current)    │  │
└───────┬────────┘ └───────────┬──────────────┘  │
        │ parseCreateTool       │ parseReviewTool │
        ▼                      ▼                 │
┌────────────────────────────────────────────┐  │
│ src/client/model.ts  (纯解析, replay-stable) │◄─┘ 读 clientMessages
└────────────────────────────────────────────┘
        │ openIsolatedTarget / finalizeCurrentSession ...
        ▼
┌────────────────────────────────────────────┐
│ src/client/actions.ts                        │
│ navigateToSession · selectedSessionId        │
│ openAuthorizedWorktreeTarget · prefillDraft  │
└───────────────┬──────────────────────────────┘
                │ WorktreeConsoleAdapter.inspect / current
                ▼
┌────────────────────────────────────────────┐
│ src/console-contract.ts (WorktreeConsole...) │
│ JSON-only Host/Client 契约 (无 Cordis/React) │
└────────────────────────────────────────────┘
```

组件关系要点：

- `index.tsx` 是唯一对外入口；它用 `Proxy` 包裹 `slots.register`（`src/client/index.tsx` 第 53–59 行），让每个本插件注册的组件都自动被 `ClientI18nProvider` 包裹，从而每个 DSH Client 实例的语言状态互相隔离。
- 两个有状态组件（Create/Review Row）只依赖 `model.ts` 的纯解析结果和 `actions.ts` 的编排函数；实时能力（Review 卡的 `liveTarget`）通过可选的 `WorktreeConsoleAdapter` 获取，缺失时仍可用日志证据回放（`tests/client-toolview.test.tsx` 第 166–202 行）。

## Data Flow

1. **注册期**：DSH 调用 `apply(ctx)`（`src/client/index.tsx` 第 49 行）。`servicesOf` 拼出 `PreSessionWorktreeServices`；`apply` 通过 `slots.inject('tool.call.toolview', ...)` 注册 `WorktreeCreateRow`（key `worktree_create`）与 `WorktreeReviewRow`（key `worktree_ready_for_review`）。若 `ctx.get('worktreeConsole')` 或 `adapterOverride` 可用，再注册 target-console 与 pre-session 子模块（第 91–105 行）。
2. **渲染期（无状态模型）**：Harness 把 `block`（call/result 切片）交给 ToolView。`WorktreeCreateRow` 调 `parseCreateTool(block, t)`（`src/client/WorktreeCreateRow.tsx` 第 16 行），`WorktreeReviewRow` 调 `parseReviewTool(block, t)`（`src/client/WorktreeReviewRow.tsx` 第 29 行）。解析是纯函数，只依赖日志文本，因此重放稳定。
3. **交互期（创建）**：用户点「打开隔离会话」→ `openTarget()` → `openIsolatedTarget(services, payload)`（`src/client/actions.ts` 第 199 行）。该函数先查 `sessions.list.byId[payload.targetSessionId]`：存在则 `openExistingSession`（cwd 必须 `samePath` 匹配）；不存在则 `workspaces.create` → 校验路径 → `sessions.create` → `waitForProjectedSessionPath`（订阅 2 秒超时）→ `navigateToSession`。全程受 `isActive()` 守卫，组件卸载即静默取消。
4. **交互期（验收/打开授权目标）**：`openAuthorizedWorktreeTarget`（第 236 行）先 `adapter.inspect` 校验 `capabilities.inspect/open`、checkout/owner/target 身份与 `managedRoot`，再委托 `openIsolatedTarget`。`finalizeCurrentSession`（第 278 行）用 `selectedSessionId` 解析唯一主 Session（mainView 保留契约），对其发 `/worktree finalize` 命令。
5. **国际化数据流**：`locale` 经 `ClientI18nProvider`/ `useSyncExternalStore` 下插；命令式 `actions` 通过 `translatorForServices(services)` 在**每次调用时**读 `readClientLanguage(services.locale)` 解析语言（`src/client/i18n.tsx` 第 49–51 行），保证多实例不共享可变状态。

## Connections

- [[console-contract]]：`WorktreeConsoleAdapter` 与 `WorktreeConsoleTargetSummary` 等 JSON DTO 的唯一契约源（`src/console-contract.ts` 第 745–784 行），客户端所有实时能力与导航校验都建立在它之上。
- [[client-target-console]]：当 `adapter` 存在时，`index.tsx` 调 `registerTargetConsole` 接入实时 Target Console（`src/client/index.tsx` 第 92 行）。
- [[client-pre-session]]：空白会话准备流程，扩展 `PreSessionWorktreeServices` 的 `conversation.blocks` 与 `workspaces.delete/archiveSession`（`src/client/index.tsx` 第 100 行）。
- [[client-review-console]]：`WorktreeReviewRow` 把解析后的 `WorktreeReviewEvidence` 交给 `WorktreeReviewPanel`，并消费 `requestWorktreeReviewRefresh`/`WORKTREE_REVIEW_REFRESH_EVENT`（`src/client/WorktreeReviewRow.tsx` 第 6、51、60 行）。
- [[i18n]]：`src/i18n/core.ts` 与 `src/i18n/client-messages.ts` 提供共享翻译原语与文案目录，Host 端有独立的 `host-messages.ts`，二者通过 `core.ts` 的 `Language`/`createTranslator` 保持一致。

## Known Issues

- **`ClientSessions.open` 已为遗留接口**：`open?()` 注释明确写「UI Workspace owns selection 后移除」（`src/client/actions.ts` 第 58–59 行）。新 Harness（0.1.6+）导航应由 `uiWorkspace.openSession` 接管；`navigateToSession` 在两者皆无时直接抛错，不会静默降级（第 124–132 行）。
- **`selectedSessionId` 的歧义返回 `undefined`**：当 `retainedBy.mainView > 0` 的 Session 多于一个，或保留项与 `snapshot.current` 不一致时返回 `undefined`，会导致 `finalizeCurrentSession` 抛 `no.session.is.currently.selected`（`src/client/actions.ts` 第 138–141、287 行；测试见 `tests/client-actions.test.ts` 第 64–76 行）。
- **`prefillSessionDraft` 仅在 `binding.ctx` 存在时生效**：旧式或没有 Agent 作用域上下文的绑定会直接返回 `false`，且该函数**从不**真正发送请求（第 266–275 行）。
- **实时 `liveTarget` 仅在 `adapter` 存在时拉取**：`WorktreeReviewRow` 第 64–88 行的 effect 在 `!adapter` 时直接 `return`，此时仅有日志回放证据、无任何实时 mutation 能力（`tests/client-toolview.test.tsx` 第 199–200 行确认 mutation 按钮不出现）。
- **`waitForProjectedSessionPath` 依赖 2 秒硬超时**：新建 Session 若在 `2_000`ms 内未投影可信 cwd，则拒绝打开（`src/client/actions.ts` 第 188–190 行），这是平台约束而非可配置项。
- **`clientMessages` 文案目录巨大且为手维护**：所有新增 key 必须 zh/en 成对、占位符集合一致、en 不含中文，否则 `tests/client-i18n.test.tsx` 第 73–82 行与 `tests/i18n-catalogs.test.ts` 会失败；当前文件约 1816 行，维护成本较高。
