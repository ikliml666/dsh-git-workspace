---
title: client_pre_session
type: module
source_files:
  - src/client/pre-session/controller.ts
  - src/client/pre-session/harness-input.ts
  - src/client/pre-session/index.tsx
  - src/client/pre-session/PreSessionWorktreeToggle.tsx
  - src/client/review-console/ReviewIcon.js
  - src/client/actions.ts
  - src/console-contract.ts
  - src/client/i18n.tsx
  - src/i18n/client-messages.ts
  - src/client/styles.ts
  - src/client/index.tsx
  - tests/client-pre-session.test.tsx
tags: [client, pre-session, worktree, ui, controller]
---

## Overview

`client_pre_session` 是「会话前（pre-session）工作树切换」的浏览器端 UI 与控制器模块。它的目标是在 Harness 普通 composer 发送第一条消息**之前**，把一个空白、隔离的 Worktree 会话准备好：用户在 composer 左侧工具条里点一个 `Worktree` 开关 → 弹出确认框 → 控制器在 Host 端创建一个空白的目标 Session（managed Worktree），把当前草稿与附件「迁移」到新 Session，再导航过去，并把原来的本地源 Session 退役（archive）。

模块位于 `src/client/pre-session/`，由四个文件组成：

- `controller.ts` —— 纯逻辑控制器 `PreSessionWorktreeController`，负责与服务端 adapter 和 Harness Session/Workspace 运行时协作，完成「创建 → 迁移草稿 → 导航 → 退役源」全流程，并包含完整的回滚路径。
- `harness-input.ts` —— 处理 Harness 两种 draft API（旧 `imageIds` / 新 `attachmentIds`）的适配与归一化。
- `index.tsx` —— 注册入口 `registerPreSessionWorktree`，把开关挂到 Harness 的 `conversation.input.left` 插槽（`src/client/pre-session/index.tsx:30`）。
- `PreSessionWorktreeToggle.tsx` —— React 组件，渲染开关按钮、加载/错误态、确认对话框，并编排与 `adapter.current` / `adapter.preflightCreate` / `controller.prepare` 的交互。

该模块**从不**调用 composer 的发送（prompt/submit）路径：控制器一旦把目标打开，目标会话里常驻的 composer 才是唯一的提交入口（见 `controller.ts:62-66` 注释）。

## Key Components

### `src/client/pre-session/controller.ts`

**Interfaces / types**

- `PreSessionDraftState`（第 10–17 行）：UI 在确认打开时「冻结」的草稿快照。`draft: string`、`imageIds: readonly string[]`、`occurrences: readonly unknown[]`（未序列化引用芯片）、`phase: string`，以及可选 `draftRev?: number`（打开确认时捕获的单调 Harness input 修订号，用于 CAS 比对）。
- `PreSessionDraftActions`（第 19–23 行）：源/目标 Session 的草稿动作接口 —— `setDraft(text)`、`addImages(ids) => boolean`、`removeImage(id)`。
- `PreparePreSessionWorktreeRequest`（第 25–35 行）：`prepare()` 入参。`sessionId`、`input: PreSessionDraftState`（不可变确认期快照）、`currentInput?(): PreSessionDraftState`（用于最终 compare-and-clear 边界的「实时」源状态）、`inputActions: PreSessionDraftActions`、`initialCommitConfirmationToken?`（首次提交确认令牌，触发 adapter 的 `createWithInitialCommit` 分支）、`isCurrentSession?(): boolean`（composer 离开源 Session 时失效）。

**Class `PreSessionWorktreeError`**（第 37–42 行）：`extends Error`，构造签名 `constructor(message: string, readonly recoveryRequired = false)`，固定 `name = 'PreSessionWorktreeError'`。`recoveryRequired` 为 `true` 时表示 Worktree 已持久化但自动回滚失败，需要用户在 Worktree Console 打开 owner Session 恢复。

**Module-private helpers**

- `messageOf(value)`（第 44–46 行）：把未知错误规整为字符串。
- `sameStrings(left, right)`（第 48–50 行）：长度相同且逐项相等的字符串数组比较（用于 `imageIds` 比对）。
- `sourceStillMatches(request)`（第 52–60 行）：在 `run()` 内做最终 CAS 校验 —— 目标 Session 仍是当前 Session（`isCurrentSession?.() !== false`）、源 `phase === 'plain'`、草稿相等、`imageIds` 逐项相等、occurrences 长度相等、且（若提供）`draftRev` 相等。

**Class `PreSessionWorktreeController`**（第 67–230 行）

- 私有字段 `inflight = new Map<string, Promise<WorktreeConsoleTargetDetails>>`（第 68 行）：按 `sessionId` 做单飞（single-flight），避免同一空白 Session 重复创建。
- 构造器 `constructor(adapter: WorktreeConsoleAdapter, services: PreSessionWorktreeServices)`（第 70–73 行）。
- `prepare(request)`（第 75–83 行）：公开入口。若同一 `sessionId` 已有 `inflight` 任务则直接复用；否则调用私有 `run()`，并在完成后（无论成败）从 `inflight` 中删除该 key。
- `run(request)` 私有（第 85–195 行）：核心流程。`translateForServices` 取翻译器（第 86 行）；先做前置校验（见 Known Issues / 时序）：`isCurrentSession?.() === false` → 抛 `t("pre.session.changed")`（第 88 行）；`input.phase !== 'plain'` → 抛 `t("the.draft.is.being.submitted.or.parsed.wait")`（第 90 行）；`input.occurrences.length > 0` → 抛 `t("the.draft.contains.unserialized.references.remove.the.reference")`（第 93 行）；无可用导航器（`!uiWorkspace?.openSession && !sessions.open`）→ 抛 `t('harness.session.navigation.unavailable')`（第 96–98 行）。之后读取源 Session 的 `agentPreset` 预设（第 102–103 行）、设置 composer 阻塞块（第 104–105 行）。调用 `adapter.create` 或 `adapter.createWithInitialCommit`（第 114–116 行），再 `workspaces.create`（第 120 行）、`sessions.create`（第 126–130 行），最后通过 `sessions.using()`（新 Host）或 `sessions.binding()`（旧 Host）拿到目标 binding，在 `handoff` 闭包里把草稿写进目标、调用 `navigateToSession`、`setDraft('')` 与 `removeImage`（第 138–164 行），再 `archiveSession(request.sessionId)`（第 170 行）。异常时走 `rollback()`（第 172–191 行）。`finally` 还原 composer 块（第 192–194 行）。
- `rollback(sourceSessionId, targetSessionId, target, workspaceId, actualSessionId)` 私有（第 197–229 行）：`target.checkoutId === null` 直接返回 `false`（无法回滚一个没有 checkout 的创建）。依次对 `[targetSessionId, sourceSessionId]` 调 `adapter.discard`（带 `expectedRevision: target.revision`），成功即停（第 206–217 行）；再 `workspaces.archiveSession` 目标（第 224 行）与（可选）`workspaces.delete` 工作区（第 226 行）。

**Factory `createPreSessionWorktreeController(adapter, services)`**（第 232–237 行）：等价于 `new PreSessionWorktreeController(adapter, services)`。

### `src/client/pre-session/harness-input.ts`

- `HarnessInputState` 类型（第 4–6 行）：`PreSessionDraftState | (Omit<PreSessionDraftState,'imageIds'> & { attachmentIds: readonly string[] })` —— Harness 在新版把仅图片 API 改名为通用附件。
- `HarnessInputActions` 类型（第 8–12 行）：旧 `PreSessionDraftActions` 或新方法组的联合类型（`setDraft` / `addAttachments` / `removeAttachment`）。
- `readHarnessInput(input)`（第 14–19 行）：把 `attachmentIds` 归一化为 `imageIds`，返回 `PreSessionDraftState`。
- `adaptHarnessInputActions(input)`（第 22–31 行）：若入参含 `addAttachments`（新版），把目标动作映射到 `PreSessionDraftActions`（`addImages→addAttachments`、`removeImage→removeAttachment`）；否则原样返回。注释说明要「穿过原始 receiver」——目标 input 可能是 class 实例。

### `src/client/pre-session/index.tsx`

- `PreSessionSlotProps` 接口（第 11–17 行）：注册进 Harness 的组件 props。`sessionId`、`useSession` / `useConversation` / `useInput`（`SnapshotSelectorHook`，rc.1 标准 hooks，无旧版 owner snapshot props）、`inputActions: HarnessInputActions`。
- `PreSessionSlotContextLike` 接口（第 19–27 行）：插槽契约 —— `slots.inject('conversation.input.left', cb)` 与 `slots.register(descriptor, component)`。
- `registerPreSessionWorktree(ctx, adapter, services)`（第 30–60 行）：创建控制器与 `Entry` 组件（闭包）。`Entry` 用 Harness `conversationPhase` 推断 `sessionPhase`（第 39–40 行：`blank`/`engaging`/`active`），读 `activeTargets`（第 41 行）、`readHarnessInput` 归一化草稿（第 42 行），渲染 `PreSessionWorktreeToggle`。通过 `ctx.slots.inject('conversation.input.left', …)` 注册描述符 `{ name:'conversation.input.left', id:'worktree-pre-session', order:40 }`（第 52–59 行）。
- 再导出（第 62–63 行）：`PreSessionWorktreeController`、`PreSessionWorktreeError`、`createPreSessionWorktreeController`、`PreSessionWorktreeToggle`。

### `src/client/pre-session/PreSessionWorktreeToggle.tsx`

- `PreSessionWorktreeToggleProps` 接口（第 8–15 行）：`sessionId`、`session: { composerPhase: string }`、`input: PreSessionDraftState`、`inputActions`、`adapter: WorktreeConsoleAdapter`、`controller: { prepare(request): Promise<WorktreeConsoleTargetDetails> }`。
- `LoadState` 类型（第 17 行）：`'loading' | 'idle' | 'preparing' | 'error' | 'unsupported'`。
- `errorMessage(value)`（第 19–21 行）：错误规整。
- `snapshotInput(input)`（第 23–25 行）：浅拷贝并把 `imageIds`/`occurrences` 展开成新数组，作为确认期不可变快照。
- `confirmationDescription(input, t)`（第 27–33 行）：根据「草稿 + 附件数」组合返回确认文案键（`the.current.input.and.will.move.to.the` / `will.move.to.the.new.worktree.session` / `the.current.input.will.move.to.the.new` / `a.new.worktree.session.will.be.created.the`）。
- `PreSessionWorktreeToggle` 组件（第 36–180 行）：核心 UI。用 `useRef` 维护 `latestInput`（第 42–43 行）与 `scopeRef`（第 47–52 行，在 render 期间失效旧 scope 以防导航/清除新选 Session 的草稿）；`refreshCurrent()`（第 55–77 行）调 `adapter.current({sessionId})` 检测仓库与 capabilities，`not_git_repository` 时置 `unsupported`、其余错误置 `error`；`useEffect`（第 79–85 行）在 `blank` 时自动刷新。`beginConfirmation()`（第 96–116 行）调 `adapter.preflightCreate`（若有）决定 `kind`（`ready`/`empty`/`files`）并缓存 `pending`。`cancelConfirmation()`（第 118–123 行）、`confirm()`（第 125–147 行）调 `controller.prepare`。渲染开关 `<button role="switch">`（第 150–157 行，含 `ReviewIcon` 勾选标记）、错误告警 `<span role="alert">` 与 `Modal` 确认框（第 163–177 行），文案由 `pending.kind` 决定（`pre.session.initial.title/description` 或 `start.in.a.worktree`）。

### 共享契约与依赖（被本模块引用，行号以源码为准）

- `src/console-contract.ts` —— `WorktreeConsoleAdapter` 接口（第 745–784 行），本模块用到：`current`（第 750 行）、`create`（第 752 行）、`createWithInitialCommit?`（第 747 行）、`preflightCreate?`（第 746 行）、`discard`（第 764 行）。`WorktreeConsoleCreatePreflightResponse`（第 266–269 行）：`{kind:'ready';branches?}` | `{kind:'empty';confirmationToken}` | `{kind:'files'}`。`WorktreeConsoleTargetDetails`（第 182–195 行）、`WorktreeConsoleCreateResponse`（第 277–281 行：`target` / `targetSessionId` / `managedRoot`）、`WorktreeConsoleOutcome<T>`（第 695–697 行）。
- `src/client/actions.ts` —— `PreSessionWorktreeServices`（第 87–102 行，扩展 `WorktreeClientServices`，新增 `workspaces.archiveSession` / `workspaces.delete` / `conversation.blocks.set` / `conversation.blocks.storeFor` / `conversation.input.for`）。`navigateToSession(services, sessionId)`（第 125–132 行）：优先 `uiWorkspace.openSession`，否则 `sessions.open`，再否则抛 `harness.session.navigation.unavailable`。`PreSessionInput` 类型（第 105–113 行）。
- `src/client/i18n.tsx` —— `useClientTranslator()`（第 43–46 行）、`translatorForServices(services)`（第 49–51 行）、`defaultClientTranslator`（第 26 行）。
- `src/i18n/client-messages.ts` —— 本模块使用的文案键（行号已核验）：`worktree`（第 115–118 行）、`close`（第 119–122 行）、`cancel`（第 123–126 行）、`retry`（第 111–114 行）、`creating`（第 107–110 行）、`pre.session.initial.title`（第 1607–1610 行）、`pre.session.initial.description`（第 1611–1614 行）、`pre.session.initial.confirm`（第 1619–1622 行）、`pre.session.initial.unavailable`（第 1623–1626 行）、`pre.session.initial.created.failure`（第 1627–1630 行）、`pre.session.changed`（第 1631–1634 行）、`the.draft.is.being.submitted.or.parsed.wait`（第 1635–1638 行）、`the.draft.contains.unserialized.references.remove.the.reference`（第 1639–1642 行）、`creating.isolated.worktree`（第 1643–1646 行）、`harness.registered.the.managed.root.at.a.different`（第 1647–1650 行）、`harness.created.unexpected.session.expected.2`（第 1651–1654 行）、`the.target.session.was.created.but.harness.has`（第 1655–1658 行）、`the.local.draft.or.attachments.changed.after.confirmation`（第 1659–1662 行）、`the.target.session.is.temporarily.refusing.draft.attachments`（第 1663–1666 行）、`the.worktree.was.persisted.but.automatic.rollback.failed`（第 1667–1670 行）、`1.attachment`（第 1671–1674 行）、`attachments`（第 1675–1678 行）、`the.current.input.and.will.move.to.the`（第 1679–1682 行）、`will.move.to.the.new.worktree.session`（第 1683–1686 行）、`the.current.input.will.move.to.the.new`（第 1687–1690 行）、`a.new.worktree.session.will.be.created.the`（第 1691–1694 行）、`start.in.a.worktree`（第 1703–1706 行）、`create.and.switch`（第 1707–1710 行）、`the.local.session.will.not.receive.this.message`（第 1711–1714 行）、`pre.session.files.description`（第 1615–1618 行）、`harness.session.navigation.unavailable`（第 71–74 行）。
- `src/client/styles.ts` —— `WORKTREE_STYLES` 含 pre-session 相关规则：`.dsh-wt-pre-session`（第 152 行）、`.dsh-wt-pre-session-toggle`（第 154–158 行，模拟 Harness PermissionSelect 工具条触发态，透明背景、28px 高、switch 语义）、`.dsh-wt-pre-session-check`（第 159 行）、`.dsh-wt-pre-session-error`（第 160 行，absolute 浮层告警）、`.dsh-wt-pre-session-note`（第 162 行）、`.dsh-wt-create-dialog`（第 166–169 行）。

## Architecture

UI（开关 + 确认框）只在「空白 Local 会话」下出现，并编排三个 Host/适配器端点；控制器拥有全部运行时协作与回滚逻辑。

```text
 Harness composer (left dock)
        │ conversation.input.left
        ▼
┌─────────────────────────────────────┐
│ PreSessionWorktreeToggle (React)      │  PreSessionWorktreeToggle.tsx
│  role=switch button + Modal           │
│  state: loading|idle|preparing|…      │
└───────────┬───────────────┬───────────┘
   refresh   │               │  confirm()
   (detect)  │               ▼
            ▼          ┌───────────────────────────┐
  ┌──────────────────┐ │ PreSessionWorktreeController│ controller.ts
  │ WorktreeConsole  │ │  prepare() → run() → rollback│
  │ Adapter          │ │  inflight single-flight Map │
  │  current         │ └───┬───────────┬─────────────┘
  │  preflightCreate │     │ create    │ discard
  │  create          │     ▼           ▼
  │  createWithInit… │  ┌────────────────────────────┐
  │  discard         │  │ Harness runtime (actions.ts) │
  └──────────────────┘ │ workspaces/sessions/convers. │
                       │ navigateToSession, archive   │
                       └──────────────────────────────┘
        harness-input.ts: readHarnessInput / adaptHarnessInputActions
        (imageIds ⇄ attachmentIds normalization)
```

组件边界小结：

- `PreSessionWorktreeToggle`（UI 层，≥3 个状态、确认框、失败重试）负责「是否展示、何时弹框、调哪个端点」。
- `PreSessionWorktreeController`（逻辑层）负责「确认后如何原子地建好目标并迁移草稿、失败如何回滚」。
- `harness-input.ts` 是零依赖的纯归一化层，屏蔽 Harness 新旧 draft API 差异。
- `index.tsx` 是装配层，把控制器与 UI 注册进 Harness 插槽。

## Data Flow

1. **挂载与检测**：`registerPreSessionWorktree`（`index.tsx:30`）在 Harness `conversation.input.left` 注册 `Entry`。`Entry` 用 `useSession` 推断 `composerPhase`（`index.tsx:39-40`）。`PreSessionWorktreeToggle` 仅在 `blank` 且 `state !== 'loading'/'unsupported'`、`target?.state !== 'local' || capabilities.create` 时渲染开关（`PreSessionWorktreeToggle.tsx:87-91`）。挂载后 `useEffect` 调 `adapter.current({sessionId})`（`PreSessionWorktreeToggle.tsx:61,83`）探测仓库：`not_git_repository` 置 `unsupported` 并隐藏（`PreSessionWorktreeToggle.tsx:65,87`）；否则得 `target` 进入 `idle`。
2. **点击开关 → preflight**：`beginConfirmation()`（`PreSessionWorktreeToggle.tsx:96`）先 `snapshotInput` 冻结当前草稿（`PreSessionWorktreeToggle.tsx:103`），再调可选 `adapter.preflightCreate({sourceSessionId})`（`PreSessionWorktreeToggle.tsx:104`），依返回 `kind` 决定 `pending = { input, kind, token? }`（`ready`/`empty`/`files`）。`empty` 会把 `confirmationToken` 带进 `pending.token`（`PreSessionWorktreeToggle.tsx:108`）。
3. **确认对话框**：`Modal` 依 `pending.kind` 渲染不同标题/说明（`PreSessionWorktreeToggle.tsx:163-166`）：`empty` 用 `pre.session.initial.title/description`；`files` 用 `pre.session.files.description` 且该情况下**不显示确认按钮**（只能取消，`PreSessionWorktreeToggle.tsx:170-172`）；默认用 `start.in.a.worktree` + `confirmationDescription` 文案。
4. **确认 → 控制器**：`confirm()`（`PreSessionWorktreeToggle.tsx:125`）调 `controller.prepare({ sessionId, input: captured.input, currentInput: () => latestInput.current, isCurrentSession: isCurrent, inputActions, initialCommitConfirmationToken: captured.token })`（`PreSessionWorktreeToggle.tsx:132-135`）。
5. **控制器 run 流程**（`controller.ts:85-195`）：
   - 前置校验：`isCurrentSession?.()===false`（第 88 行）、`phase!=='plain'`（第 90 行）、`occurrences.length>0`（第 93 行）、无导航器（第 96-98 行）均直接抛错。
   - 读源 `agentPreset`（第 102-103 行），置 composer 阻塞块（第 104-105 行）。
   - `create`/`createWithInitialCommit`（第 114-116 行）→ `workspaces.create`（第 120 行）→ `sessions.create`（第 126-130 行，带 `agentPreset` 当仅当是 string）。
   - 通过 `sessions.using()`（新 Host，第 160-161 行）或 `sessions.binding()`（旧 Host，第 163 行）取目标 binding，在 `handoff` 闭包（第 138-156 行）内：再次 `sourceStillMatches` CAS（第 143 行）→ `targetInput.setDraft` + `addImages`（第 149-152 行）→ `navigateToSession`（第 153 行）→ 源 `setDraft('')` + `removeImage`（第 154-155 行）。该段「从最终源 CAS 到目标写、导航、源清除」全程无 `await`（第 146-148 行注释），避免失败目标释放浏览器持有的字节。
   - 退役源 `workspaces.archiveSession(request.sessionId)`（第 170 行，失败被吞，目标是权威）。`finally` 还原 composer 块（第 192-194 行）。
6. **失败回滚**（`controller.ts:172-191, 197-229`）：若 `created !== undefined`，调 `rollback()`——对 `[targetSessionId, sourceSessionId]` 依次 `adapter.discard`（`expectedRevision: target.revision`，第 207-212 行），成功即停；再 `archiveSession` 目标、`delete` 工作区。若 `rollback` 失败（两 caller 都失败）且 `created !== undefined`，抛 `the.worktree.was.persisted.but.automatic.rollback.failed` 并 `recoveryRequired=true`（第 184-188 行）。
7. **UI 收尾**：`prepare` resolve 后 `setTarget(prepared)`、`setPending(null)`、`state='idle'`（`PreSessionWorktreeToggle.tsx:136-139`），开关 `aria-checked=true`，显示 `ReviewIcon` 勾选。reject 时清 `pending`、置 `error` 态并展示告警（第 140-146 行）；token 为一次性，失败时已清空（`pending=null`，第 143 行），重试需重新 preflight（测试 `client-pre-session.test.tsx:895-914`）。

## Connections

- `src/client/index.tsx` —— `apply()` 在适配器可用时调用 `registerPreSessionWorktree()`（`index.tsx:100-104`），并注入 `WORKTREE_STYLES`（第 74 行）。`servicesOf()` 组装 `PreSessionWorktreeServices`（第 38-46 行）。
- `[[client_actions]]`（`src/client/actions.ts`）—— 提供 `PreSessionWorktreeServices`、`navigateToSession`、`PreSessionInput` 等控制器依赖契约。
- `[[console_contract]]`（`src/console-contract.ts`）—— 定义 `WorktreeConsoleAdapter`、`WorktreeConsoleTargetDetails`、`WorktreeConsoleCreateResponse`、`WorktreeConsoleCreatePreflightResponse` 等所有 Host DTO 与端点契约。
- `[[client_i18n]]` / `src/i18n/client-messages.ts` —— 本模块全部用户可见文案键的来源（见 Key Components 中行号清单）。
- `[[client_review_console]]`（`src/client/review-console/`，`ReviewIcon` 来自 `review-console/ReviewIcon.js`）—— 提供确认框里的 `confirm`/`refresh`/`create` 图标。
- `[[client_styles]]`（`src/client/styles.ts`）—— 提供 `WORKTREE_STYLES` 中 pre-session 相关 CSS 类。
- `[[console_host]]` / `[[console_remote]]` —— 实现 `WorktreeConsoleAdapter`（含 `create`/`createWithInitialCommit`/`preflightCreate`/`current`/`discard`）的 Host 端与 Remote 传输端。
- `tests/client-pre-session.test.tsx` —— 针对本模块 UI 与控制器行为的测试（开关注册、preflight、`prepare` 全流程、回滚、token 失效、会话切换失效等）。

## Known Issues

- **`run()` 前置校验顺序与注释的「先 abort 再建」期望**：流程注释说「Abort before creating a checkout or moving draft bytes if no UI can own the target」（`controller.ts:95-98`），导航器缺失的检查（第 96-98 行）确实发生在「读取 `projectionValues` 与设置 composer 阻塞块（第 102-105 行）**之前**」。因此当 `uiWorkspace` 与 `sessions.open` 都缺失时，会直接抛出 `harness.session.navigation.unavailable`，不会设置 composer 阻塞块，也不存在冗余块写入；注释与实现一致。`openExistingSession`/`openIsolatedTarget`（`actions.ts:198-230`）等其它入口也有各自的导航契约，不是本模块问题。
- **`files` 类 preflight 永远无法开新会话**：当 `adapter.preflightCreate` 返回 `{kind:'files'}` 时，`beginConfirmation` 仍把 `pending.kind='files'` 缓存（`PreSessionWorktreeToggle.tsx:96-97`），而确认按钮对该 `kind` 被刻意隐藏（`PreSessionWorktreeToggle.tsx:170`），且 `confirm()` 直接 `return`（`PreSessionWorktreeToggle.tsx:126`）。这是设计行为（仓库有未提交文件时要求用户先提交或留在本地），但意味着 `files` 路径下 `controller.prepare` 永远不会被调用——测试 `client-pre-session.test.tsx:876-893` 验证了这一点。
- **`not_git_repository` 不报错误**：`refreshCurrent` 对 `not_git_repository` 仅置 `unsupported` 并隐藏开关，不设置 `error`（`PreSessionWorktreeToggle.tsx:65-66`）；测试 `client-pre-session.test.tsx:637-659` 断言此时「无告警、无 prepare」，符合预期。
- **`discard` 的幂等性依赖 Host**：`rollback()` 对 `[targetSessionId, sourceSessionId]` 两个 caller 各调一次 `adapter.discard`（`controller.ts:206-217`），只取首个成功。若 Host 两端都返回非 ok（如 `transport_unavailable`），`rollback` 返回 `false`，`run()` 抛出 `recoveryRequired=true`（`controller.ts:184-188`）。测试 `client-pre-session.test.tsx:361-379` 覆盖「两端 discard 失败 → 保留可恢复目标」。
- **`createWithInitialCommit` 缺省即失败**：若带 `initialCommitConfirmationToken` 但 adapter 未提供 `createWithInitialCommit`（可选方法），`run()` 抛 `pre.session.initial.unavailable`（`controller.ts:111-113`）。测试 `client-pre-session.test.tsx:933-953` 覆盖「initial commit 已创建但后续失败时回滚并报 `the.worktree.was.persisted.but.automatic.rollback.failed`」。
- **scope 失效靠 render 期同步检查**：`PreSessionWorktreeToggle` 用 `scopeRef` 在 render 期间比对 `sessionId`/`adapter`/`blank`（`PreSessionWorktreeToggle.tsx:47-52`），并在 `isCurrent()`（第 53 行）中允许 `scope.alive && scopeRef.current === scope`。切换 Session 时旧 `scope.alive=false`，进行中的 `prepare` 会在 `if(!isCurrent()) return` 处中止，避免清除新选 Session 的草稿（测试 `client-pre-session.test.tsx:955-977`）。
- **无独立子模块拆分**：本模块四个文件职责清晰（UI / 控制器 / 适配 / 注册），均 <3 个独立组件聚合度，按规则不拆分，全部在本文内描述。
