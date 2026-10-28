---
title: client_pre_session
type: module
source_files:
  - src/client/pre-session/index.tsx
  - src/client/pre-session/controller.ts
  - src/client/pre-session/harness-input.ts
  - src/client/pre-session/PreSessionWorktreeToggle.tsx
  - src/client/index.tsx
  - src/client/actions.ts
tags: [client_core, pre-session, worktree, blank-session, composer]
---

## Overview

`client_pre_session` 是 `client_core` 的子能力（pre-session 空白会话开关），负责在 composer 的 `conversation.input.left` 工具行里注册一个「在 Worktree 中开始」开关。它允许用户在**发送第一条消息之前**就准备好一个隔离的空白 Session（一个 checkout + workspace + session），而无需先手动创建一个一次性的本地 Session 再切换过去。

核心职责由 `PreSessionWorktreeController.prepare`（`src/client/pre-session/controller.ts:75-195`）承接：在 agent 动作真正发生之前，先 CAS 校验源草稿/附件，创建 checkout + workspace + session，把草稿/图片写入目标 Session，导航过去（`navigateToSession`），清空源、archive 源；任一阶段失败则 `rollback`。

入口由 `src/client/index.tsx:100-104` 的 `registerPreSessionWorktree` 拉起（仅当 `adapter !== undefined` 时）。该开关只在会话处于「空白（blank）」阶段可见，即在任意一个「真实」Conversation 目标出现、或首个 turn 已经提交之前才展示，避免污染已有会话。

模块四个文件分工：
- `index.tsx`：暴露 `registerPreSessionWorktree`，把开关注册进 Harness 的 `conversation.input.left` slot，并把 Harness 快照/动作适配成控制器需要的形态。
- `controller.ts`：`PreSessionWorktreeController` 类，封装 prepare/run/rollback 原子流程。
- `harness-input.ts`：`readHarnessInput` / `adaptHarnessInputActions`，做 Harness 新旧输入 API 形态适配（`imageIds` ↔ `attachmentIds`）。
- `PreSessionWorktreeToggle.tsx`：`PreSessionWorktreeToggle` React 组件，渲染开关 + 确认弹窗，捕获确认时刻的草稿快照并调用 `controller.prepare`。

依赖的运行时服务类型定义在 `src/client/actions.ts`，即 `PreSessionWorktreeServices`（带 `archiveSession` / `delete` / `blocks` 扩展的 `WorktreeClientServices`）。

## Key Components

### `src/client/pre-session/index.tsx`

- `PreSessionSlotProps`（interface，`index.tsx:11-17`）：注入组件收到的 props。`sessionId: string`；`useSession` / `useConversation` / `useInput` 三个 Harness 快照 hook；`inputActions: HarnessInputActions` 草稿动作。
- `PreSessionSlotContextLike`（interface，`index.tsx:19-27`）：宿主注入上下文。`slots.inject(name: 'conversation.input.left', callback: () => unknown)` 与 `slots.register(descriptor, component)`。
- `registerPreSessionWorktree(ctx, adapter, services)`（`index.tsx:30-60`）：核心注册函数。内部：
  - 调用 `createPreSessionWorktreeController(adapter, services)`（`index.tsx:35`）建立控制器。
  - 定义 `Entry` 组件（`index.tsx:36-51`），用 `useSession` 计算 `sessionPhase`（`index.tsx:39-40`：`active` / `engaging` / `blank`），用 `useConversation` 判断 `hasActiveTarget`（`index.tsx:41`），用 `readHarnessInput(useInput(...))` 归一化输入（`index.tsx:42`），再渲染 `PreSessionWorktreeToggle`，传入 `composerPhase`、`input`、`adaptHarnessInputActions(inputActions)`、`adapter`、`controller`。
  - 通过 `ctx.slots.inject('conversation.input.left', ...)` + `ctx.slots.register({ name, id: 'worktree-pre-session', order: 40 }, Entry)`（`index.tsx:52-59`）把开关注册进 composer 左侧工具行。
- re-export（`index.tsx:62-63`）：`PreSessionWorktreeController` / `PreSessionWorktreeError` / `createPreSessionWorktreeController`（来自 `controller.ts`），以及 `PreSessionWorktreeToggle`（来自 `PreSessionWorktreeToggle.tsx`）。

### `src/client/pre-session/controller.ts`

- `PreSessionDraftState`（interface，`controller.ts:10-17`）：不可变草稿快照。`draft: string`、`imageIds: readonly string[]`、`occurrences: readonly unknown[]`、`phase: string`，以及可选的 `draftRev?: number`（打开确认时捕获的单调 Harness 输入修订号）。
- `PreSessionDraftActions`（interface，`controller.ts:19-23`）：`setDraft(text)`、`addImages(ids): boolean`、`removeImage(id)`。
- `PreparePreSessionWorktreeRequest`（interface，`controller.ts:25-35`）：`prepare` 入参。`sessionId`、`input: PreSessionDraftState`（确认时刻快照）、`currentInput?: () => PreSessionDraftState`（最终边界用的「实时源态」）、`inputActions: PreSessionDraftActions`、`initialCommitConfirmationToken?`、`isCurrentSession?: () => boolean`（当 composer 离开源 Session 时失效）。
- `PreSessionWorktreeError extends Error`（`controller.ts:37-42`）：构造入参 `message` 与 `recoveryRequired = false`，设 `name = 'PreSessionWorktreeError'`。`recoveryRequired` 为 true 表示已持久化 worktree 但自动 rollback 失败，需要人工介入。
- `messageOf(value)`（`controller.ts:44-46`）、`sameStrings(left, right)`（`controller.ts:48-50`）：错误串化与字符串数组相等辅助。
- `sourceStillMatches(request)`（`controller.ts:52-60`）：最终 CAS 校验——要求 `isCurrentSession?.() !== false`、`current.phase === 'plain'`、`current.draft` 与 `request.input.draft` 相等、`imageIds` 顺序相等、`occurrences.length` 相等、且 `draftRev` 未被推进（当定义时）。
- `class PreSessionWorktreeController`（`controller.ts:67-230`）：
  - 私有字段 `inflight: Map<string, Promise<WorktreeConsoleTargetDetails>>`（`controller.ts:68`），按 `sessionId` 去重并发的 prepare。
  - 构造器 `constructor(adapter, services)`（`controller.ts:70-73`）。
  - `prepare(request)`（`controller.ts:75-83`）：已存在 in-flight 则直接返回；否则 `run(request)` 并在 `.finally` 里清掉 in-flight 映射后返回。
  - `run(request)`（`controller.ts:85-195`）：原子流程（详见下节）。
  - `rollback(sourceSessionId, targetSessionId, target, workspaceId, actualSessionId)`（`controller.ts:197-229`）：失败清理。
  - `createPreSessionWorktreeController(adapter, services)`（`controller.ts:232-237`）：工厂函数。

#### `run` 流程（`controller.ts:85-195`）

1. 守卫：`isCurrentSession?.() === false` → `pre.session.changed`（`controller.ts:88`）；`input.phase !== 'plain'` → `the.draft.is.being.submitted.or.parsed.wait`（`controller.ts:89-91`）；`input.occurrences.length > 0`（含未序列化引用） → `the.draft.contains.unserialized.references.remove.the.reference`（`controller.ts:92-94`）；导航能力缺失（`!uiWorkspace?.openSession && !sessions.open`）→ `harness.session.navigation.unavailable`（`controller.ts:96-98`）。
2. 读取源 Session 的 `projectionValues.agentPreset`（`controller.ts:102-103`），若有则透传到目标 Session 的 agent 预设。
3. 记录 `previousBlock` 并 `conversation.blocks.set(sessionId, { reason: 'creating.isolated.worktree' })`（`controller.ts:104-105`）以在准备期间阻塞源 composer。
4. 进入 try：
   - 若带 `initialCommitConfirmationToken` 但 adapter 无 `createWithInitialCommit` → `pre.session.initial.unavailable`（`controller.ts:111-113`）。
   - 调 `adapter.createWithInitialCommit`（带 token）或 `adapter.create`（无 token）（`controller.ts:114-116`）；`!outcome.ok` → 抛 `outcome.error.code: message`（`controller.ts:117`）。
   - `services.workspaces.create({ path: created.managedRoot })`（`controller.ts:120`），路径不一致 → `harness.registered.the.managed.root.at.a.different`（`controller.ts:121-123`）。
   - `services.sessions.create({ workspaceId, sessionId: created.targetSessionId, ...agentPreset })`（`controller.ts:126-130`）；返回 id 与 `targetSessionId` 不一致 → `harness.created.unexpected.session.expected.2`（`controller.ts:131-135`）。
   - `handoff` 闭包（`controller.ts:138-156`）：校验目标 binding 存在（`controller.ts:142-144`）、用 `adaptHarnessInputActions(...conversation.input.for(targetBinding.ctx))` 拿到目标输入、再 `sourceStillMatches` 最终 CAS（`controller.ts:142-145`）、`setDraft` 写草稿（`controller.ts:149`）、`addImages` 写附件（`controller.ts:150-152`，失败 → `the.target.session.is.temporarily.refusing.draft.attachments`）、`navigateToSession`（`controller.ts:153`）、清空源 `setDraft('')` 与逐个 `removeImage`（`controller.ts:154-155`）。
   - 若新 Host 有 `sessions.using` 则 `await using(targetSessionId, { source: 'controllerOperation' }, ref => handoff(ref.binding))`（`controller.ts:160-161`），否则 `handoff(this.services.sessions.binding(targetSessionId))`（`controller.ts:162-164`）。
   - 源 session 退休：`await workspaces.archiveSession(request.sessionId)`，失败被静默吞掉（目标 handoff 仍是权威来源）（`controller.ts:170`）。
   - 返回 `created.target`（`controller.ts:171`）。
5. catch（`controller.ts:172-191`）：若 `created` 已存在且带 initial token，则把错误改写为 `pre.session.initial.created.failure`（`controller.ts:173-175`）；若 `created` 已存在则调 `rollback(...)`（`controller.ts:176-183`），若 rollback 失败则抛 `the.worktree.was.persisted.but.automatic.rollback.failed` 且 `recoveryRequired = true`（`controller.ts:184-189`）；否则重抛原错误。
6. finally（`controller.ts:192-194`）：`conversation.blocks.set(sessionId, previousBlock)` 还原阻塞态。

#### `rollback` 流程（`controller.ts:197-229`）

- `target.checkoutId === null` → 返回 `false`（无法撤销）（`controller.ts:204`）。
- 依次用 `targetSessionId`、`sourceSessionId` 调 `adapter.discard({ sessionId, checkoutId, expectedRevision, confirmDirty: false })`（`controller.ts:206-217`）；任一 `ok` 即 `discarded = true` 并 break。
- 未 discard 成功 → 返回 `false`（`controller.ts:218`）。
- `sessionToArchive = actualSessionId ?? targetSessionId`，调 `workspaces.archiveSession(sessionToArchive)`（幂等，binding 缺失不代表无 Session）（`controller.ts:220-224`）。
- 若 `workspaceId` 存在，调 `workspaces.delete(workspaceId)`（`controller.ts:225-227`）。
- 返回 `true`（`controller.ts:228`）。

### `src/client/pre-session/harness-input.ts`

- `HarnessInputState`（`harness-input.ts:4-6`）：Harness 现形态 = `PreSessionDraftState` 或（去掉 `imageIds` 后带 `attachmentIds: readonly string[]`）。注释说明 Harness 在加入通用 attachment 时重命名了原 image-only API。
- `HarnessInputActions`（`harness-input.ts:8-12`）：`PreSessionDraftActions` 或 `{ setDraft; addAttachments(ids): boolean; removeAttachment(id) }`。
- `readHarnessInput(input: HarnessInputState): PreSessionDraftState`（`harness-input.ts:14-19`）：把 `attachmentIds` 归一化回 `imageIds`（`'attachmentIds' in input ? input.attachmentIds : input.imageIds`）。
- `adaptHarnessInputActions(input: HarnessInputActions): PreSessionDraftActions`（`harness-input.ts:22-31`）：若含 `addAttachments` 则把 `addAttachments→addImages`、`removeAttachment→removeImage`、`setDraft` 透传；否则原样返回。注释提示「目标输入可能是 class 实例，需通过原 receiver 绑定」。

### `src/client/pre-session/PreSessionWorktreeToggle.tsx`

- `PreSessionWorktreeToggleProps`（interface，`PreSessionWorktreeToggle.tsx:8-15`）：`sessionId`、`session: { composerPhase: string }`、`input: PreSessionDraftState`、`inputActions`、`adapter: WorktreeConsoleAdapter`、`controller: { prepare(req): Promise<WorktreeConsoleTargetDetails> }`。
- `LoadState`（`PreSessionWorktreeToggle.tsx:17`）：`'loading' | 'idle' | 'preparing' | 'error' | 'unsupported'`。
- `errorMessage(value)`（`PreSessionWorktreeToggle.tsx:19-21`）、`snapshotInput(input)`（`PreSessionWorktreeToggle.tsx:23-25`，深拷贝 `imageIds`/`occurrences`）、`confirmationDescription(input, t)`（`PreSessionWorktreeToggle.tsx:27-33`，按草稿/附件组合生成确认文案）。
- `PreSessionWorktreeToggle(...)`（`PreSessionWorktreeToggle.tsx:36-180`）：组件本体。关键子逻辑：
  - `scopeRef`（`PreSessionWorktreeToggle.tsx:47-52`）：`{ sessionId, adapter, blank, alive, busy }`；当 `sessionId/adapter/blank` 变化即把旧 `alive` 置 false 并重建，配合 `isCurrent()`（`PreSessionWorktreeToggle.tsx:53`）保证旧 continuation 不会导航/清空新选 Session 的草稿。
  - `refreshCurrent()`（`PreSessionWorktreeToggle.tsx:55-77`）：调 `adapter.current({ sessionId })`；`not_git_repository` → `unsupported`，否则 `error`。
  - `useEffect`（`PreSessionWorktreeToggle.tsx:79-85`）：仅 `blank` 时 `refreshCurrent`，卸载时 `scope.alive = false`。
  - 可见性/禁用判断（`PreSessionWorktreeToggle.tsx:87-94`）：非 blank / loading / unsupported 时不渲染；本地且不可 create 不渲染；`disabled` 综合 `busy || selected || (!canCreate && !retryingLookup) || input.phase !== 'plain'`。
  - `beginConfirmation()`（`PreSessionWorktreeToggle.tsx:96-116`）：快照 `latestInput.current`，若 adapter 有 `preflightCreate` 则预检（`PreSessionWorktreeToggle.tsx:104`），据此设 `pending = { input, kind: 'ready'|'empty'|'files', token? }`（`PreSessionWorktreeToggle.tsx:42`）。
  - `cancelConfirmation()`（`PreSessionWorktreeToggle.tsx:118-123`）、`confirm()`（`PreSessionWorktreeToggle.tsx:125-147`）：调 `controller.prepare({ sessionId, input: captured.input, currentInput: () => latestInput.current, isCurrentSession: isCurrent, inputActions, initialCommitConfirmationToken: captured.token })`（`PreSessionWorktreeToggle.tsx:132-135`）。
  - 渲染（`PreSessionWorktreeToggle.tsx:149-179`）：`role="switch"` 按钮 + 错误区 + `Modal` 确认弹窗（仅在 `pending !== null` 且 `kind !== 'files'` 时显示确认按钮）。

### `src/client/actions.ts`（被依赖的服务类型与导航）

- `PreSessionWorktreeServices extends WorktreeClientServices`（`actions.ts:87-102`）：在 `sessions: ClientSessions`、`workspaces: ClientWorkspaces & { archiveSession(sessionId): Promise<void>; delete(workspaceId): Promise<void> }`（`actions.ts:89-92`）、`conversation: { input: { for(ctx): PreSessionInput }; blocks: { set(sessionId, block): void; storeFor(sessionId): { getSnapshot(): { reason } | undefined } } }`（`actions.ts:93-101`）。注释（`actions.ts:82-86`）说明：该 flow 用它来 archive/delete 一次性本地 session，并在准备期间切换 composer 的 blocking block。
- `navigateToSession(services, sessionId)`（`actions.ts:125-132`）：优先 `uiWorkspace.openSession`，否则 `sessions.open`，再否则抛 `harness.session.navigation.unavailable`。
- `ClientSessions`（`actions.ts:44-61`）：含 `list`（快照仓库）、`create`、`using?`（新 Host 保留绑定直到回调 handoff）、`open?`（旧 Host 导航）、`binding`。
- `WorktreeConsoleAdapter` 的 `create` / `createWithInitialCommit` / `discard` / `current` / `preflightCreate` 接口在 `../../console-contract.js`（未在本次阅读范围内，仅从调用处推断其形状）。

## Architecture

```text
Harness composer (conversation.input.left)
        │  register 'worktree-pre-session' (order:40)
        ▼
registerPreSessionWorktree ── index.tsx:30-60
        │ createPreSessionWorktreeController
        ▼
PreSessionWorktreeToggle ── PreSessionWorktreeToggle.tsx:36
        │ readHarnessInput / adaptHarnessInputActions (harness-input.ts)
        │ snapshot at confirm → controller.prepare(req)
        ▼
PreSessionWorktreeController.prepare ── controller.ts:75
        │ run (controller.ts:85) → CAS/guard
        │  ├─ adapter.create / createWithInitialCommit  (checkout)
        │  ├─ workspaces.create (workspace)
        │  ├─ sessions.create (session; inherit agentPreset)
        │  ├─ using()/binding → handoff
        │  │     ├─ sourceStillMatches (final CAS)
        │  │     ├─ targetInput.setDraft + addImages
        │  │     ├─ navigateToSession (actions.ts:125)
        │  │     └─ clear source draft/images
        │  ├─ archiveSession(source)  (retire)
        │  └─ catch → rollback (controller.ts:197)
        ▼
PreSessionWorktreeServices ── actions.ts:87
  (workspaces.archiveSession/delete, conversation.blocks, sessions.using)
```

## Data Flow

## Connections

## Known Issues
