---
title: Pre-Session Toggle 会话前隔离开关
type: module
source_files:
  - src/client/pre-session/index.tsx
  - src/client/pre-session/PreSessionWorktreeToggle.tsx
  - src/client/pre-session/controller.ts
  - src/client/pre-session/harness-input.ts
tags:
  - client
  - pre-session
  - state-machine
  - handoff
---

# Pre-Session Toggle 会话前隔离开关

空白会话输入行左侧的开关：点按后把当前草稿与附件整体迁移到一个新建的隔离 Worktree 会话，源会话退化为空启动器。UI 状态机与迁移控制器分离，导航与 cwd 投影等待复用 [[target-console|Target Console]] 记录的 src/client/actions.ts 编排。

## 槽位注册与会话阶段判定（src/client/pre-session/index.tsx）

- src/client/pre-session/index.tsx:52-59 注入 `conversation.input.left`，id `'worktree-pre-session'`、order 40。
- src/client/pre-session/index.tsx:39-40 composerPhase 三态：`(!session.blank && !session.awaitingFirstTurn) || session.running` → `'active'`；`session.promptAttempted` → `'engaging'`（注释：pending first turn 不算空白启动器）；否则 `'blank'`。
- `useConversation(c => c.activeTargets.size > 0)` 非空时强制 `'active'`（:41）——已挂 Worktree 目标的会话不再渲染开关。
- 快照经标准 hooks（useSession/useConversation/useInput）读取：rc.1 的 input.left 没有属主快照 props（:11-17 注释）。

## 开关 UI 状态机（src/client/pre-session/PreSessionWorktreeToggle.tsx）

- `LoadState` 五态：`loading / idle / preparing / error / unsupported`（src/client/pre-session/PreSessionWorktreeToggle.tsx:17）。
- blank 门控：`session.composerPhase !== 'blank'` 时渲染 null（:87）——非空白会话绝不出现开关；unsupported 不再隐藏（v0.9.4 非 Git 渐进增强，见下）。
- 代际守卫在渲染期失效（:47-53）：scopeRef 换届后旧 prepare 续体不允许再导航或清空新会话草稿；`isCurrent() = scope.alive && scopeRef.current === scope`。
- `refreshCurrent`（:55-77）：`adapter.current` 探测；错误码 `'not_git_repository'` → unsupported；loading 态渲染禁用占位开关（:88-100），保持输入行高度稳定不弹跳。
- 可用性：target 为 local 且 `capabilities.create` 为假 → null（:101）；`disabled = busy || selected || (!canCreate && !retryingLookup && state !== 'unsupported') || input.phase !== 'plain'`（:107）——unsupported 态开关保持可点。
- `beginConfirmation`（:109-140）：state==='unsupported' 直接进入初始化确认（不发预检）；capabilities 存在 `preflightCreate` 则 `adapter.preflightCreate` 预检，pending 保存输入不可变快照 + kind `ready|empty|files` + confirmationToken（empty 即 `createWithInitialCommit` 的令牌）；预检返回 `not_git_repository`（.git 中途消失）时转 setTarget(null)+unsupported+初始化确认。
- `confirm`（:138-160）调用 `controller.prepare({sessionId, input: captured.input, currentInput, isCurrentSession, inputActions, initialCommitConfirmationToken})`；失败回到 error 态；注释强调令牌一次性（:155）。
- :171-190+ 错误气泡（重试按钮）与确认 Modal 按 kind 切换描述；空会话确认文案固定提示源会话不会收到该消息。files kind 的 footer 从「无确认按钮」改为「初始化并创建首次提交」入口（v0.9.4）。
- 非 Git 渐进增强（v0.9.4）：`initConfirm` 状态 + `runInitialize(reopen)`（src/client/pre-session/PreSessionWorktreeToggle.tsx:138-166）调用 `adapter.initializeProject`（git init -b main 缺失时 + add -A + Initial commit）；reopen=true（未出生仓库带文件）初始化后重新预检并回到常规创建确认；reopen=false（目录非 Git）成功后 refreshCurrent 回 idle。设计依据见 [[non-git-incremental-enablement|Non-Git Incremental Enablement]]。

## 准备控制器（src/client/pre-session/controller.ts）

- `PreSessionWorktreeController`（src/client/pre-session/controller.ts:67）单飞：`inflight` Map 按 sessionId 复用在途 Promise（:68、:75-83），`run().finally` 里仍是自己才删除。
- `run()` 前置守卫（:85-98）：`isCurrentSession() === false` → `t('pre.session.changed')`；`phase !== 'plain'` → 提交/解析中；`occurrences` 非空 → 草稿含未序列化引用；无导航面孔（`uiWorkspace.openSession` 与 `sessions.open` 都没有）→ 中止——注释强调必须在创建 checkout 或搬运草稿字节之前判定"没有任何 UI 能接管目标"。
- 输入阻塞：`conversation.blocks.set(sessionId, {reason t('creating.isolated.worktree')})`（:100-101），finally 恢复 previousBlock（:187-189）。
- 创建：有 initialCommitConfirmationToken 且 `capabilities.createWithInitialCommit` 走 `createWithInitialCommit`，否则 `adapter.create`（:107-113）；随后 `workspaces.create` 校验 `workspace.path === managedRoot`（:116-120）、`sessions.create` 校验实际 sessionId === targetSessionId（:122-130）。
- `handoff`（:133-151）：targetBinding 无 ctx → 抛错；先 `sourceStillMatches` CAS（比对 currentInput 的 draft/imageIds/occurrences/draftRev，:52-60）；注释（:141-143）：从最终 CAS 到目标写入/导航/源清空之间不允许任何 await——中途存档失败的目标会释放源仍引用的浏览器字节。随后无等待地 targetInput.setDraft → addImages → navigateToSession → 源 setDraft('') → 逐个 removeImage。
- `sessions.using`（:155-159）：新 Host 上 `create()` 只登记身份，必须持有官方 Session 引用直到导航取得 mainView 所有权；旧 Host 退化 `handoff(sessions.binding(...))`。
- `archiveSession(sourceSessionId)`（:160-165）：源会话已成空启动器，退役防止 New-Session 复用把它当并发任务入口；退役失败不得回滚已安全的交接。
- 失败路径（:167-186）：已创建则 `rollback`；rollback 不干净则抛 `PreSessionWorktreeError(recoveryRequired=true)`，文案 `t('the.worktree.was.persisted.but.automatic.rollback.failed')`。
- `rollback`（:192-224）：`adapter.discard` 依次以 targetSessionId、sourceSessionId 为调用者（`confirmDirty: false`），先成功即 discarded；:215-219 注释——create 响应丢失也可能已发布 Host Session，Discard 后无条件幂等 `archiveSession`；再 `workspaces.delete(workspaceId)`（过期 Workspace 保持用户可见，不隐藏）。

## 输入 API 适配（src/client/pre-session/harness-input.ts）

- Harness 把纯图片 composer API 泛化为通用附件：`imageIds` → `attachmentIds`（src/client/pre-session/harness-input.ts:4-6）。`readHarnessInput`（:14-19）归一读取；`adaptHarnessInputActions`（:22-31）包装 addAttachments/removeAttachment 变体并经原始 receiver 调用（目标输入面孔可能是类实例）。

## 流程与失败语义一览

1. 点按开关 → `adapter.preflightCreate` 预检（ready/empty/files）→ 确认 Modal（empty 附 createWithInitialCommit 令牌）。
2. confirm → `controller.prepare`（按 sessionId 单飞）→ 前置守卫：会话未变、输入 phase 为 plain、无未序列化引用、存在导航面孔。
3. `create` / `createWithInitialCommit` → `workspaces.create` → `sessions.create`，每步校验 Host 返回身份。
4. handoff：`sourceStillMatches` CAS → 无等待地搬草稿/附件 → 导航 → 清空源输入；期间输入行被 `conversation.blocks` 占位阻止新提交。
5. 成功后 `archiveSession(sourceSessionId)` 退役空启动器；任何失败走 `rollback`（discard 两个调用方 + 幂等 archive + workspace 删除）；rollback 不干净则抛 `recoveryRequired` 错误——Worktree 已保留但自动回滚失败，需要用户手动清理。

入口与样式注入机制见 [[client-boot|Client Boot]]。
