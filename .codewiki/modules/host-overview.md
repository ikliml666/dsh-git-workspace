---
title: Host Entry and Registration Surface
type: module
source_files:
  - src/index.ts
  - src/commands.ts
  - src/tools.ts
  - src/session-target-context.ts
  - src/host-compat.ts
  - src/i18n/host.ts
  - src/i18n/host-messages.ts
tags:
  - host
  - entry
  - tools
  - commands
  - i18n
---

# Host Entry and Registration Surface

dsh-git-worktree 是 DeepSeek Harness 的 Git worktree 会话目标插件。宿主入口把端口适配器（[[adapters|Adapter Layer]]）、核心状态机（[[session-checkout-module|Session Checkout Module]]）、执行引擎（[[session-checkout-apply|Session Checkout Apply Pipeline]]）与 RPC 控制面（[[console-host|Console Host Control Plane]]）装配成一个插件，并向模型、用户、UI 三个方向暴露能力。v0.9.4 起新增管理面能力：按基准分支创建（[[create-from-branch-is-base-only|Create From Branch Is Base Only]]）、非 Git 目录渐进增强（[[non-git-incremental-enablement|Non-Git Incremental Enablement]]）、侧边栏任务携带 sourceBranch、volatile 设置页（[[settings-card|Settings Card]]，决策 [[volatile-settings-live-config]]）。

## 插件身份与错误基类

- 插件名 `git-worktree`（src/index.ts:184）；命名导出 `inject = { tools:{}, commands:{}, subprocess:{}, loader:{await:false} }`（src/index.ts:188）——loader 以命名导出读取插件元数据，裸函数导出会触发 "cannot get property without inject"。
- `export * from './console-contract.js'`（src/index.ts:182）把 RPC 契约类型并入公共入口。
- `SessionCheckoutError`（src/index.ts:38）：携带 `readonly code: SessionCheckoutErrorCode` 的 Error，消息原文透传给工具与命令，是全插件统一的领域错误。

## 配置模式（src/index.ts:190-235）

- `stateDir`：默认 `$DSH_HOME/plugins/dsh-git-worktree`（回退 `~/.dsh`）——registry、project-skills、诊断文件都落在这里。
- `gitTimeoutMs`（默认 DEFAULT_GIT_TIMEOUT_MS，下限 1000，上限 MAX_GIT_TIMEOUT_MS）、`worktreeAddTimeoutMs`（默认 300_000）。
- `autoDeliver`（默认 true）：代理自主交付开关，把 Working 态的模型指引切到 worktree_deliver；`autoPush`（默认 true）：Finish 后尽力 `git push`，绝不 force。
- `worktreesRoot`：受管 worktree 放到 `<worktreesRoot>/<project>/<topic>-<YYYYMMDD>`，应指向任何 git checkout 之外。
- `enableWorkspaceProvider`（默认 false）：接管官方 ui-workspace 的严格 opt-in 开关（历史上 "cannot open a new conversation" 事故背后的机制）。
- **volatile 标记**：前五个字段经 `volatile()` 助手（src/index.ts:190，设 `schema.meta.volatile = true`——schemastery 3.18.2 无 `.volatile()` 方法）进入设置页；值以 `{get()}` LiveRef 到达、消费方逐次解包（[[volatile-settings-live-config]]）；stateDir 与 enableWorkspaceProvider 保持非 volatile（启动期语义）。

## apply() 装配序列（src/index.ts:258-320)

1. `validateGitTimeouts(config)` 校验超时配置。
2. `mountWorkspaceProviderLifecycle(ctx, hostWorkspaceClientFlavor(), {enabled})` 挂载工作区 provider 生命周期。
3. 创建 `stateDir` 与 disabled-git-hooks 目录。
4. 组装端口：`createDshLookupPort(ctx)`、`new ProjectSkillStore(join(stateDir,'project-skills'))`、`createDshGitPort(ctx, {hooksPath, projectSkills, gitTimeoutMs, worktreeAddTimeoutMs})`、`createNodeFilesPort()`、`new AtomicJsonCheckoutRegistry(join(stateDir,'managed-checkouts.json'))`。
5. `mountProjectSkillProvider(ctx, registry)`。
6. `createSessionCheckoutModule({lookup, git, files, registry, applyEngine: createSessionCheckoutApplyEngine({projectSkills}), managedCheckoutsRoot: stateDir, createCheckoutId: randomUUID, autoDeliver, autoPush, worktreesRoot?})`（src/index.ts:283-296）——autoDeliver/autoPush 传原始 config 值（LiveRef 原样下传，消费点 `?? true` 归一）；worktreesRoot 包装为 `{ get: () => resolveWorktreesRootValue(input) }` 逐次解析。
7. `new WorktreeConsoleService(ctx, createWorktreeConsoleControlPlane({module, lookup, files, registry, git, reviewDiff: createGitWorktreeReviewDiffReader(projectSkills)}), join(stateDir,'sidebar-diag.ndjson'), providerLifecycle.officialWorkspaceActive)`。
8. `registerTools(ctx, module)` + `registerWorktreeCommand(ctx, module)` + `registerSessionTargetContext(ctx, module)`。
9. 启动收敛：`ctx.events.on('ready', () => void module.reconcile())`（src/index.ts:299）。
10. 保留期维护：`setInterval(cleanupExpiredRetained, RETENTION_MAINTENANCE_INTERVAL_MS=15*60*1000)` 并 `.unref()`（src/index.ts:304-309）；`ctx.effect` 卸载时注销事件监听与定时器（src/index.ts:310-313）。

## 模型工具（src/tools.ts）

头部注释（src/tools.ts:3）：**破坏性交付动作刻意缺席**——Finish/Discard/Remove 是人类命令，由客户端 ToolView 呈现；模型只负责保留目标会话、检查自己的作用域 worktree、让未同步的 review 失效、安全开启同会话新迭代，并止步于 Ready for Review。

`registerTools`（src/tools.ts:32）注册 6 个工具，全部经 `withHostLanguage(languageForInvocation(exec.agent, ctx))` 包裹：

- `worktree_create`（src/tools.ts:34）：`topic?` → `module.createIsolatedTarget(sourceSessionId, randomUUID(), {topic?})` → `{kind worktree_target_created, checkoutId, targetSessionId, managedRoot, phase, currentOid, sourceSessionId}`。
- `worktree_list`（src/tools.ts:79）：`listManagedWorktreesForSession` 的会话作用域列表。
- `worktree_resume_revision`（src/tools.ts:133）：仅 ready_for_review 可用，否则 Error `theCurrentWorktreeHasNoUnsyncedReviewToResume372`；结果必须回到 working 态。
- `worktree_begin_next_iteration`（src/tools.ts:180）：必须进入 working，否则 `theNextWorktreeIterationDidNotEnterWorkingState`。
- `worktree_ready_for_review`（src/tools.ts:220）：summary ≤240、details ≤12000、validationStatus 枚举、tests[]、suggestedCommitMessage 必填 → `markReadyForReview`。
- `worktree_deliver`（src/tools.ts:307）：仅 working|ready_for_review 可用（`worktreeDeliverNotAllowedInState`）；ready_for_review 时自动携带 expectedReviewId、commitMessage 缺省取 review.suggestedCommitMessage（无消息则 `worktreeDeliverRequiresCommitMessage`）；执行 `operate action finish`（retention 默认 cleanup）→ `{kind worktree_delivered, commitOid?, changedFiles, cleanup, push?, report?}`。

## /worktree 用户命令（src/commands.ts）

`registerWorktreeCommand`（src/commands.ts:42）注册 `/worktree`，动词：`status`（inspect）/`list`（listManagedWorktreesForSession）/`continue`（resumeRevision，需 ready_for_review）/`next`（beginNextIteration）/`finalize [reviewId revision retention]`（CAS 校验 `thisReviewCardHasExpiredConfirmTheLatestReady` 后以 review.suggestedCommitMessage 执行 finish）/`finish <message>`/`discard`（confirmDirty:true，preview_active 时附带 rollbackPreview）/`remove <checkoutId>`（经 manageManagedWorktreeForSession 走 discard）。头部注释（src/commands.ts:4）：破坏性动词刻意只由用户发起；模型工具止步 Ready for Review。

## 会话目标上下文注入（src/session-target-context.ts:13）

`registerSessionTargetContext` 经 `ctx.inject(['systemPrompt'], …)` 注册 per-assembly 系统提示片段 `git-worktree:session-target`（order 118，src/session-target-context.ts:16-17），text 回调同步读取 `module.runtimeContext(sessionId)`——不执行任何 Git/文件 I/O，保证回放稳定。

## Host 兼容探测（src/host-compat.ts）

- `WorkspaceClientFlavor = legacy | alpha | next | unsupported`；版本映射 `0.1.2-rc.1→legacy`、`0.1.6-alpha.2→alpha`、`0.1.7-rc.2→next`（src/host-compat.ts:7-12）。
- `workspaceClientFlavorFromAnchors`（src/host-compat.ts:32）：锚点按最像宿主的顺序探测（entry→cwd→plugin）。link: 安装时插件自身 node_modules 会遮蔽 Host 树，因此运行入口脚本与 cwd 优先，插件路径只作兜底。
- `workspaceFlavorDiagnostics`（src/host-compat.ts:55）记录每次探测，供 RPC 诊断上报（console-host 的 sidebarTopology 携带）。

## i18n（src/i18n/host.ts、src/i18n/host-messages.ts）

host.ts 用 `AsyncLocalStorage<Language>` 提供每次调用的不可变 locale 快照（默认 zh，src/i18n/host.ts:6），`languageFromSettings` 只读公开 settings 缝隙（src/i18n/host.ts:16）；host-messages.ts 是宿主侧全部用户可见文案的 zh 目录，`hostMessage(key, params)` 经 `createTranslator` 取词，持久化的 cleanup 消息由 hostPersistedCleanupMessage 复原。
