---
title: client_pre_session
type: module
source_files:
  - src/client/pre-session/controller.ts
  - src/client/pre-session/harness-input.ts
  - src/client/pre-session/index.tsx
  - src/client/pre-session/PreSessionWorktreeToggle.tsx
  - src/client/actions.ts
  - src/console-contract.ts
  - tests/client-pre-session.test.tsx
tags: [client, pre-session, worktree, composer, controller, harness-injection]
---

## Overview

`client_pre_session` 是「会话前（pre-session）工作树预创建」功能的浏览器侧实现：在 Harness 普通 composer 把第一条 prompt 发出去**之前**，先为一个空白（blank）本地 Session 在 Host 侧分配一个隔离工作树与专属目标 Session，把当前草稿/附件移动过去，再把导航切到新 Session，让常驻 composer 成为唯一的提交入口。整个流程不会由本模块直接发送任何 prompt。

模块由 4 个源文件组成，职责分明：

- `controller.ts`：核心控制器 `PreSessionWorktreeController`，承载「准备（prepare）→ 创建 Host 工作树 → 注册 Workspace/Session → 移交草稿 → 导航切换 → 退役源 Session」的完整编排，并提供失败回滚（rollback）。
- `harness-input.ts`：把 Harness 的新旧 composer 草稿接口（`imageIds` 旧 API 与 `attachmentIds` 新 API）适配到本模块统一的 `PreSessionDraftState` / `PreSessionDraftActions`。
- `index.tsx`：把开关组件注册进 Harness 公共 composer 工具行（`conversation.input.left` 槽位），并把 Harness 标准 hooks 的快照归一化成组件 props。
- `PreSessionWorktreeToggle.tsx`：React 开关 / 确认弹窗组件，负责探测当前 Session 是否可创建（通过 `adapter.current`）、做 preflight（可选 `adapter.preflightCreate`）、弹出确认对话框，并在用户确认后调用 `controller.prepare`。

控制器本身不碰 Cordis / Remote / 文件系统，只通过 `WorktreeConsoleAdapter`（`src/console-contract.ts`）与 Host 通信，通过 `PreSessionWorktreeServices`（`src/client/actions.ts`）与 Harness 浏览器运行时（Workspace / Session / Conversation）交互。

## Key Components

### `src/client/pre-session/controller.ts`

- **`PreSessionDraftState`** (10–17)：确认时刻的不可变草稿快照。字段：`draft: string`、`imageIds: readonly string[]`、`occurrences: readonly unknown[]`（未序列化引用）、`phase: string`、`draftRev?: number`（确认打开时捕获的单调 Harness 输入修订号）。
- **`PreSessionDraftActions`** (19–23)：源草稿操作接口：`setDraft(text)`、`addImages(ids): boolean`、`removeImage(id)`。
- **`PreparePreSessionWorktreeRequest`** (25–35)：`prepare()` 入参。`sessionId`、`input: PreSessionDraftState`（确认时快照）、`currentInput?(): PreSessionDraftState`（最终比较-清除时用的实时源状态）、`inputActions: PreSessionDraftActions`、`initialCommitConfirmationToken?`（空仓初始提交确认令牌）、`isCurrentSession?(): boolean`（composer 离开源 Session 时失效）。
- **`PreSessionWorktreeError`** (37–42)：`extends Error`，构造器 `constructor(message, readonly recoveryRequired = false)`，并固定 `this.name = 'PreSessionWorktreeError'`。`recoveryRequired=true` 表示工作树已在 Host 持久化但自动回滚失败，需要用户侧恢复。
- **`messageOf(value)`** (44–46)：把任意值规整为 `string`（Error 取 `message`）。
- **`sameStrings(left, right)`** (48–50)：按长度与逐元素相等比较两个只读字符串数组。
- **`sourceStillMatches(request)`** (52–60)：比较时实源状态与确认快照是否一致（`isCurrentSession?.() !== false`、`phase === 'plain'`、`draft` 相等、`imageIds` 逐元素相等、`occurrences.length` 相等、`draftRev` 相等或请求未带 `draftRev`）。用于「最终源 CAS」边界。
- **`PreSessionWorktreeController`** (67–230)：
  - 私有字段 `inflight: Map<string, Promise<WorktreeConsoleTargetDetails>>` (68)：按 `sessionId` 做单飞（single-flight）去重。
  - 构造函数 `constructor(adapter, services)` (70–73)。
  - **`prepare(request)`** (75–83)：若 `inflight` 中已有该 `sessionId` 的 promise 直接复用；否则调用 `run(request)`，并在其 `finally` 中清除 `inflight` 条目，返回该 promise。
  - **`run(request)`（私有 async）** (85–195)：完整编排。依次：翻译器 `t` (86)；前置校验——`isCurrentSession?.() === false` 抛 `pre.session.changed` (88)、`input.phase !== 'plain'` 抛 `the.draft.is.being.submitted.or.parsed.wait` (90)、`input.occurrences.length > 0` 抛 `the.draft.contains.unserialized.references.remove.the.reference` (93)、无导航可用性（`!uiWorkspace?.openSession && !sessions.open`）抛 `harness.session.navigation.unavailable` (96–98)。随后读取源 `projectionValues.agentPreset` (102–103)、用 `conversation.blocks.set` 打上阻塞块 `creating.isolated.worktree` (104–105)。进入 `try`：若带 `initialCommitConfirmationToken` 但 `adapter.createWithInitialCommit` 不存在则抛 `pre.session.initial.unavailable` (111–113)；调用 `adapter.createWithInitialCommit` 或 `adapter.create` (114–116)；非 ok 抛 `code: message` (117)；`workspaces.create({ path: created.managedRoot })` 并校验路径 (120–124)；`sessions.create({ workspaceId, sessionId: created.targetSessionId, ...(agentPreset) })` 并校验 `actualSessionId === created.targetSessionId` (126–135)；定义 `handoff(targetBinding)` 闭包 (138–156)：校验 `targetBinding.ctx` (139–141)、`adaptHarnessInputActions(conversation.input.for(targetBinding.ctx))` (142)、再次 `sourceStillMatches` 校验 (143–145)、**无 await 地** `setDraft` + `addImages` + `navigateToSession` + 源 `setDraft('')` + 逐个 `removeImage` (149–155)；若 `sessions.using` 存在则 `await sessions.using(targetSessionId, { source: 'controllerOperation' }, ref => handoff(ref.binding))` (160–161)，否则 `handoff(sessions.binding(targetSessionId))` (163)；最后 `workspaces.archiveSession(request.sessionId)` 退役源（失败被吞掉，因为目标移交已权威）(170)；返回 `created.target` (171)。`catch` (172–191)：若 `created` 已存在且带 initial token，包装为 `pre.session.initial.created.failure` (173–175)；若 `created` 已存在则调用 `rollback(...)` 并依其结果决定抛 `the.worktree.was.persisted.but.automatic.rollback.failed`（`recoveryRequired=true`）(176–190)。`finally` 还原 `conversation.blocks.set` 为先前快照 (192–194)。
  - **`rollback(sourceSessionId, targetSessionId, target, workspaceId, actualSessionId)`（私有 async）** (197–229)：若 `target.checkoutId === null` 直接返回 `false`（无 checkout 可丢弃）(204)；依次对 `[targetSessionId, sourceSessionId]` 调用 `adapter.discard`，任一成功即 `discarded=true` 并 break (206–217)；否则返回 `false`；`sessionToArchive = actualSessionId ?? targetSessionId` (220)，`archiveSession` (224)；若 `workspaceId` 存在则 `workspaces.delete` (225–227)；返回 `true`。
- **`createPreSessionWorktreeController(adapter, services)`** (232–237)：工厂函数，`new PreSessionWorktreeController(...)`。

### `src/client/pre-session/harness-input.ts`

- **`HarnessInputState`** (4–6)：`PreSessionDraftState` 或 `{ ...PreSessionDraftState 去掉 imageIds } & { attachmentIds: readonly string[] }`——兼容 Harness 改名后的附件 API。
- **`HarnessInputActions`** (8–12)：`PreSessionDraftActions` 或 `{ setDraft, addAttachments(ids): boolean, removeAttachment(id) }`。
- **`readHarnessInput(input)`** (14–19)：把 `attachmentIds` 归一为 `imageIds` 后返回 `PreSessionDraftState`。
- **`adaptHarnessInputActions(input)`** (22–31)：若含 `addAttachments` 则包成 `{ setDraft, addImages -> addAttachments, removeImage -> removeAttachment }`；否则原样透传。注释说明目标 input 可能是类实例，须通过原始 receiver 绑定（22）。

### `src/client/pre-session/index.tsx`

- **`PreSessionSlotProps`** (11–17)：`sessionId`、`useSession: SnapshotSelectorHook<SessionSnapshot>`、`useConversation: SnapshotSelectorHook<{ activeTargets: ReadonlySet<string> }>`、`useInput: SnapshotSelectorHook<HarnessInputState>`、`inputActions: HarnessInputActions`。
- **`PreSessionSlotContextLike`** (19–27)：`slots.inject(name: 'conversation.input.left', cb)` 与 `slots.register(descriptor, component)`。
- **`registerPreSessionWorktree(ctx, adapter, services)`** (30–60)：创建 `controller` (35)；定义 `Entry` 组件 (36–51)：用 `useSession` 算出 `sessionPhase`（`active` / `engaging` / `blank`，对齐 Harness 的 conversationPhase）(39–40)、`hasActiveTarget` (41)、`readHarnessInput(useInput(...))` (42)；渲染 `PreSessionWorktreeToggle` 并把 `composerPhase`（`hasActiveTarget ? 'active' : sessionPhase`）、`input`（`adaptHarnessInputActions(inputActions)`）等传入 (43–50)；通过 `ctx.slots.inject('conversation.input.left', () => ctx.slots.register({ name, id: 'worktree-pre-session', order: 40 }, Entry))` 注册 (52–59)。
- 再导出 (62–63)：`PreSessionWorktreeController`、`PreSessionWorktreeError`、`createPreSessionWorktreeController`、`PreSessionWorktreeToggle`。

### `src/client/pre-session/PreSessionWorktreeToggle.tsx`

- **`PreSessionWorktreeToggleProps`** (8–15)：`sessionId`、`session: { composerPhase: string }`、`input: PreSessionDraftState`、`inputActions: PreSessionDraftActions`、`adapter: WorktreeConsoleAdapter`、`controller: { prepare(request): Promise<WorktreeConsoleTargetDetails> }`。
- **`LoadState`** (17)：`'loading' | 'idle' | 'preparing' | 'error' | 'unsupported'`。
- **`errorMessage(value)`** (19–21)：同 `messageOf`，规整错误为字符串。
- **`snapshotInput(input)`** (23–25)：浅拷贝并把 `imageIds`/`occurrences` 展开成新数组，产生确认时刻的可序列化快照。
- **`confirmationDescription(input, t)`** (27–33)：根据草稿/附件情况返回本地化确认文案（含 `1.attachment` / `attachments` / `the.current.input.and.will.move.to.the` / `will.move.to.the.new.worktree.session` / `the.current.input.will.move.to.the.new` / `a.new.worktree.session.will.be.created.the`）。
- **`PreSessionWorktreeToggle({...})`** (36–180)：核心 UI。要点：
  - `useClientTranslator` 取 `t` (37)；`target`/`state`/`error`/`pending` 等 `useState` (38–41)；`latestInput` ref 始终指向最新 input (42–43)。
  - `scopeRef` 通过 `sessionId`/`adapter`/`blank` 变化来失效旧渲染中的 `alive`（render 时就地失效，避免旧 continuation 误导航/误清草稿）(47–52)；`isCurrent()` 判定 `scope.alive && scopeRef.current === scope` (53)。
  - `refreshCurrent()` (55–77)：调 `adapter.current({ sessionId })`；非 ok 时按 `not_git_repository` 置 `unsupported`（无 alert），其它置 `error`（带 alert）。
  - `useEffect` (79–85)：`scope.alive=true`、清空 target/pending，仅当 `blank` 时 `refreshCurrent()`，卸载时 `scope.alive=false`。
  - 渲染门控 (87–94)：非 `blank` 或 `loading`/`unsupported` 返回 `null`；`target.state === 'local' && !target.capabilities.create` 返回 `null`；计算 `selected`/`canCreate`/`busy`/`disabled`。
  - `beginConfirmation()` (96–116)：snapshot 输入框、`adapter.preflightCreate?.({ sourceSessionId })`（无则 `kind: 'ready'`），按 `result.kind`（`ready`/`empty`/`files`）与 `empty` 的 `confirmationToken` 设置 `pending`。
  - `cancelConfirmation()` (118–123)、`confirm()` (125–147)：构造 `controller.prepare({ sessionId, input: captured.input, currentInput: () => latestInput.current, isCurrentSession: isCurrent, inputActions, initialCommitConfirmationToken: captured.token })`；令牌单次使用，失败清空 `pending`。
  - 返回 JSX (149–179)：`<span class="dsh-wt-pre-session" data-state>` 内含 `aria-checked` 的 `role="switch"` 按钮、`error` 区（带「重试」）与 `Modal` 确认对话框（标题/描述随 `pending.kind` 切换，含 `create`、`pre.session.initial.confirm`、`create.and.switch` 等按钮；`files` 类无确认按钮）。

### 依赖接口（来自其它文件，本模块引用但不在本目录）

- **`PreSessionWorktreeServices`** (`src/client/actions.ts` 87–102)：继承 `WorktreeClientServices`，扩展 `workspaces.archiveSession` / `workspaces.delete`、`conversation.blocks.set` / `conversation.blocks.storeFor`、`conversation.input.for`。
- **`navigateToSession(services, sessionId)`** (`src/client/actions.ts` 125–132)：优先 `uiWorkspace.openSession`，否则 `sessions.open`，都无则抛 `harness.session.navigation.unavailable`。
- **`WorktreeConsoleAdapter` / `WorktreeConsoleTargetDetails` / `WorktreeConsoleCreateResponse` / `WorktreeConsoleCreatePreflightResponse`** (`src/console-contract.ts` 745–784、182–195、277–281、266–269)：Host 通信契约。`adapter.create` / `createWithInitialCommit?` / `current` / `preflightCreate?` / `discard` 被本模块使用。

## Architecture

```text
┌──────────────────────────────────────────────┐
│ Harness composer (conversation.input.left 槽)  │
│ registerPreSessionWorktree  index.tsx:30-60    │
└───────────────────┬──────────────────────────┘
                    │ 渲染 Entry（归一化 hooks 快照）
                    ▼
┌──────────────────────────────────────────────┐
│ PreSessionWorktreeToggle  (UI)                │
│ PreSessionWorktreeToggle.tsx:36-180           │
│ adapter.current → preflightCreate? → Modal    │
└───────────────────┬──────────────────────────┘
                    │ confirm()
                    ▼
┌──────────────────────────────────────────────┐
│ PreSessionWorktreeController.prepare  :75-83  │
│   └ run()  :85-195                            │
│     adapter.create / createWithInitialCommit  │
│     workspaces.create → sessions.create       │
│     sessions.using|binding → handoff()        │
│     adaptHarnessInputActions → 目标 input     │
│     navigateToSession → 源清空 + archive      │
└───────────────────┬──────────────────────────┘
                    │ 任意步骤失败且 created 已存在
                    ▼
┌──────────────────────────────────────────────┐
│ rollback()  :197-229                          │
│ adapter.discard(targetSessionId|sourceSessionId)
│ → workspaces.archiveSession → workspaces.delete│
└──────────────────────────────────────────────┘
```

## Data Flow

1. **注册**：`registerPreSessionWorktree`（`index.tsx:30`）在 Harness 的 `conversation.input.left` 槽注册 `id: 'worktree-pre-session'`、`order: 40` 的 `Entry` 组件（`index.tsx:52-59`）。
2. **探测可用性**：`PreSessionWorktreeToggle` 仅对 `blank` 本地 Session 渲染（`PreSessionWorktreeToggle.tsx:44`、`:79-85`）。挂载后 `refreshCurrent()` 调 `adapter.current({ sessionId })`（`:61`）：ok 且 `state !== 'local'` 即 `selected`；`state === 'local' && capabilities.create` 即 `canCreate`；错误码 `not_git_repository` 静默隐藏（`:87-94`）。
3. **确认前 preflight**：点击开关触发 `beginConfirmation()`（`:96`）。若有 `adapter.preflightCreate`，调之得到 `{ kind: 'ready' | 'empty' | 'files' }`（`console-contract.ts:746-749`）；`empty` 带一次性 `confirmationToken`（用于后续空仓初始提交），`files` 表示仓库有未提交文件、禁止切换（`:104-108`、`:876-893`）。
4. **用户确认**：`Modal` 中 `confirm()`（`:125`）以 `snapshotInput(latestInput.current)` 为确认时刻快照，调用 `controller.prepare({ sessionId, input, currentInput, isCurrentSession, inputActions, initialCommitConfirmationToken })`（`:132-135`）。
5. **控制器编排（`run`，`controller.ts:85`）**：
   - 校验：源 Session 仍当前、草稿 `phase==='plain'`、无未序列化引用、存在导航能力（`:88-98`）。
   - 阻塞 composer：`conversation.blocks.set(sessionId, { reason: 'creating.isolated.worktree' })`（`:105`），`finally` 还原（`:192-194`）。
   - Host 创建：`adapter.createWithInitialCommit`（带 token）或 `adapter.create`（`:114-116`）。
   - 注册 Workspace：`workspaces.create({ path: created.managedRoot })` 并校验路径一致（`:120-124`）。
   - 创建目标 Session：`sessions.create({ workspaceId, sessionId: created.targetSessionId, ...agentPreset })` 并校验身份（`:126-135`）。
   - 草稿移交 `handoff()`（`:138-156`）：先 `sourceStillMatches` 最终 CAS 校验（`:143`），再**无 await**地 `setDraft` + `addImages` + `navigateToSession` + 源 `setDraft('')` + 逐个 `removeImage`（`:149-155`）；`sessions.using` 存在时在此回调内执行（保留绑定直至导航接管，`:160-161`），否则直接 `sessions.binding(...)`（`:163`）。
   - 退役源：`workspaces.archiveSession(request.sessionId)`（`:170`）；失败被吞（目标移交已权威）。
   - 返回 `created.target`（`:171`）。
6. **失败回滚（`:172-194`）**：若 `created` 已存在，调 `rollback()`（`:197-229`）：`checkoutId === null` 直接 `false`；否则对 `[targetSessionId, sourceSessionId]` 各调一次 `adapter.discard`（带 `expectedRevision`/`confirmDirty:false`），任一成功即 `discarded=true`（`:206-217`）；随后 `archiveSession(sessionToArchive)` 与 `delete(workspaceId)`（`:224-227`）。回滚失败则抛 `recoveryRequired=true` 错误（`:185-188`）。

## Connections

- [[client-actions]]：`PreSessionWorktreeServices`、`navigateToSession`、`WorktreeClientServices` 均定义于此（`src/client/actions.ts`），控制器通过该接口操作 Harness 运行时。
- [[console-contract]]：`WorktreeConsoleAdapter` 及全部 DTO（`WorktreeConsoleTargetDetails` / `WorktreeConsoleCreateResponse` / `WorktreeConsoleCreatePreflightResponse`）定义于此（`src/console-contract.ts`），是 Host↔Client 的唯一 JSON 契约。
- [[client-i18n]]：控制器用 `translatorForServices`（`controller.ts:1,86`）、开关组件用 `useClientTranslator` / `defaultClientTranslator` / `ClientTranslator`（`PreSessionWorktreeToggle.tsx:2`）做本地化。
- [[review-console]]：开关图标复用 `ReviewIcon`（来自 `src/client/review-console/ReviewIcon.js`，`PreSessionWorktreeToggle.tsx:1`）。
- [[session-checkout-module]]：Host 侧 `create` / `createWithInitialCommit` / `discard` 的对应实现归属于会话 checkout 模块，本模块只消费其契约结果。

## Known Issues

- **`sessions.using` 可选**：新 Host 需要 `using` 在初始打开与 handoff 期间保留绑定（注释见 `controller.ts:157-159`）；旧 Host 无 `using` 时退化为 `sessions.binding(...)`（`:162-164`）。两套路径的导航时机不同，但都保证 `handoff` 内无 await（`:146-148`）。
- **`uiWorkspace?.openSession` 可选**：导航优先 `uiWorkspace.openSession`，否则 `sessions.open`，均无则 `prepare` 在创建前直接抛 `harness.session.navigation.unavailable`（`controller.ts:96-98`、`src/client/actions.ts:125-132`）。
- **`createWithInitialCommit` 可选**：仅当 `prepare` 收到 `initialCommitConfirmationToken` 且 `adapter.createWithInitialCommit` 存在时走初始提交路径；否则抛 `pre.session.initial.unavailable`（`controller.ts:111-113`）。若已创建初始提交但后续失败，错误包装为 `pre.session.initial.created.failure`（`:173-175`）。
- **令牌单次使用**：`initialCommitConfirmationToken` 一旦用于 `confirm()` 即消耗；`files` 类确认无提交按钮、无令牌（`:166`、`:876-893`）。
- **回滚不保证成功**：当 `checkoutId === null`（尚未创建 checkout）或两次 `discard` 均失败时，`rollback` 返回 `false`，`prepare` 抛 `recoveryRequired=true`，工作树已持久化但需用户侧恢复（`controller.ts:184-188`、测试 `tests/client-pre-session.test.tsx:361-379`）。
- **源草稿保护**：从确认时刻到最终 CAS 之间若源 `draft`/`imageIds`/`draftRev` 变化，`sourceStillMatches` 失败触发回滚而非清空源草稿（`controller.ts:52-60`、`:143-145`、测试 `:381-411`）。
- **单飞去重**：`prepare` 对同一 `sessionId` 复用同一 promise（`controller.ts:75-83`），但 `inflight` 仅用于去重、不防并发切换会话；UI 侧通过 `scopeRef` 的 `alive` 标志失效旧 continuation（`PreSessionWorktreeToggle.tsx:47-53`、测试 `:916-931`、`:955-977`）。
