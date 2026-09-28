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
  - src/i18n/client-messages.ts
  - src/i18n/transport-messages.ts
tags:
  - client
  - boot
  - adapter
  - toolview
  - i18n
---

# Client Boot 客户端入口与启动

Client 侧是插件的浏览器运行时：把 Host 暴露的 Remote 服务适配成 `WorktreeConsoleAdapter`，向 Harness Workspace 注册 ToolView、会话徽章、会话前开关等 UI，并完成 Workspace 代际探测与启动上报。共享契约定义在 src/console-contract.ts（10 个目标状态、capabilities、错误码 meta、Adapter 接口）。

## 入口装配 apply（src/client/index.tsx）

- src/client/index.tsx:17 定义服务名常量 `WORKTREE_CONSOLE_ADAPTER_SERVICE = 'worktreeConsole'`；src/client/index.tsx:35 声明模块依赖 `inject = ['slots','workspaces','sessions','conversation','connection','locale']`。
- src/client/index.tsx:48 `apply(ctx, adapterOverride?)` 用 Proxy 包裹 `ctx.slots.register`：每个注册组件自动包一层 `ClientI18nProvider`（src/client/index.tsx:52-58），所有插件 UI 统一获得语言上下文。
- src/client/index.tsx:62-63 解析适配器：`adapterOverride ?? ctx.get('worktreeConsole')`（测试/装饰分支可注入替身）。
- src/client/index.tsx:64-76 样式注入：`ctx.effect` 创建 `<style>` 并打上 `dataset.dshGitWorktree`、`dataset.plugin='dsh-git-worktree'`、`dataset.pluginCss='dsh-git-worktree/styles'` 自标签。注释说明 DSH client-module 系统会"收养" head 中没有 data-plugin 的 `<style>` 并在自身模块失效时删除——自标签即所有权凭证；cleanup 按引用移除。
- src/client/index.tsx:80-87 注册 `tool.call.toolview` 槽位：`'worktree_create'` → WorktreeCreateRow，`'worktree_ready_for_review'` → WorktreeReviewRow（props 携带 services 与 adapter；两个 Row 组件是 model.ts 解析器的薄展示壳）。
- src/client/index.tsx:90-101 仅当 `adapter !== undefined` 才注册 `registerTargetConsole` 与 `registerPreSessionWorktree`——无 Remote 时插件以纯 ToolView 降级运行。

## ToolView 模型层（src/client/model.ts）

- 纯函数把日志化的 call/result 块重放为稳定视图模型：`WorktreeCreatePayload` kind `'worktree_target_created'`（src/client/model.ts:31-39）、`WorktreeReviewPayload` kind `'worktree_ready_for_review'`（src/client/model.ts:41-48）。
- src/client/model.ts:96-113 `parseCreateTool` 与 src/client/model.ts:148-181 `parseReviewTool` 对解析结果做严格字段校验，失败落到 `t('malformed.worktree.create.result')` / `t('malformed.ready.for.review.result')` 错误文案而不是崩溃。
- 细节：运行中的块 args 在顶层、完成块在 `call.argsRaw`（src/client/model.ts:152）；lifecycle 由 `error.code==='interrupted'` → `'stopped'`（src/client/model.ts:82-86）；iteration 归一为非负整数缺省 0（src/client/model.ts:175）。

## 样式与 i18n

- src/client/styles.ts:3 `WORKTREE_STYLES` 用 `String.raw` 聚合侧边栏徽章/卡片样式，并在 :143 插值 `REVIEW_CONSOLE_STYLES`；:145-148 是 pre-session/创建对话框按钮的晚期覆盖。
- src/client/i18n.tsx:19-21 `readClientLanguage` 从 LocaleFace `snapshot.active` 归一语言（失败回退 `'zh'`）；:29-40 `ClientI18nProvider` 用 `useSyncExternalStore` 订阅语言变化；:49-51 `translatorForServices` 在调用时才解析语言（命令式路径不能吃模块加载时的快照）。
- 词典与占位符插值基础在 src/i18n/core.ts（`createTranslator`/`normalizeLanguage`），client 文案集中在 src/i18n/client-messages.ts 与 src/i18n/transport-messages.ts 两份 zh/en 目录。

## Remote 装配与 Workspace 代际分支（src/client/console-remote/index.ts）

- src/client/console-remote/index.ts:22 `inject` 继承 officialWorkspaceInject（与官方 Workspace Client 相同前置服务）；对话相关视图挂子 fiber——:46-52 `mountTools` 注入 `toolViewInject`，保证视图位于 UI Workspace provider 之下。
- 启动序列 src/client/console-remote/index.ts:35-44：`ctx.remote.$mount(contribution)` → `ctx.get('remote.gitWorktree')`（undefined 即抛 mountFailed）→ `createWorktreeConsoleRemoteAdapter(remote, getLanguage)` → `ctx.provide('worktreeConsole', adapter)`。
- src/client/console-remote/index.ts:69-75 拉取 `sidebarTopology` 决定分支：失败则 `reportBoot('topology-failed', false)` 并抛 "Could not identify the installed Host Workspace generation."。
- 分支路由：flavor `'legacy'` 要求 `sessions.open` 存在后 `registerManagedWorkspaceSidebar`（:76-86）；`'alpha'`/`'next'` 且 `topology.officialWorkspaceActive === true` 走 DECORATE——宿主保留官方 Workspace Client，重放模块 apply 会重复 provide `uiWorkspace` 直接崩溃，只能以更低 priority shadow 官方 Browser 注册（:91-108）；否则 MANAGED 分支 `applyWorkspace(officialContextProxy(ctx))` 接管（:109-125）；unsupported 仅 mountTools（:126-130）。三种官方 Browser 声明同一顶层 Slot，按 Host 解析的包版本选择而非 Client 服务时序（:54-56 注释）。
- src/client/console-remote/index.ts:57-68 `reportBoot` 尽力上报 `WorktreeClientBootReport`（flavor/branch/registered/elapsedMountMs/elapsedTopologyMs）；注释提醒 Remote 代理按位置校验参数个数，末尾 locale 即使 undefined 也必须传；诊断失败绝不阻塞 boot。

## 侧边栏接管与装饰（src/client/workspace-sidebar）

两种模式对应 boot 分支：MANAGED 接管（`registerManagedWorkspaceSidebar`，src/client/workspace-sidebar/index.tsx:233-239 = `applyWorkspace(officialContextProxy(ctx))`）与 DECORATE 影子注册（`registerDecoratedWorkspaceSidebar`，src/client/workspace-sidebar/index.tsx:266-315：官方 Workspace Client 存活时找到最低优先级的 `sidebar.workspaces` 条目，以 priority-10、registrant `'dsh-git-worktree'` 重注册同选项并包一层 ManagedOfficialWorkspaceBrowser；slot registry 不可用即抛 "The official Workspace is active but the slot registry is unavailable."）。

- src/client/workspace-sidebar/model.ts:76-198 `projectManagedWorkspaceSidebar` 把每个 managed checkout 的 owner 会话合并回原 Local 项目：歧义时 fail-open（保持官方行可见），protectedSessionIds/relocatedSessionIds 来自 Host memberships claims（:137-148，多重认领的 id 跳过），canHide 仅当成员全部 archived 或 blank 非 current（:124-131）；输出 `ManagedWorkspaceSidebarProjection`（:29-36）。`currentTasks` 按 ownerSessionId 去重保留最高 iteration/revision（:48-69）。
- src/client/workspace-sidebar/index.tsx:42-159 `ManagedOfficialWorkspaceBrowser` 用投影 memo 重投影官方 workspace/session 状态，给 byId 条目挂 `__dshGitWorktree` `ManagedWorktreeSessionDecoration`（:115-121），守卫 startSession/forkSession/insertSessionBefore（:141-157），并在挂载与 `WORKTREE_REVIEW_REFRESH_EVENT`（src/client/review-console/status-events.ts）时刷新拓扑（:59-81）。
- src/client/workspace-sidebar/index.tsx:169-226 `officialContextProxy` 用 Proxy 包 `slots.register`：`sidebar.workspaces.session.menu.item` / `row.action`（除 pin）包成 GuardedAction，guard 未就绪或 id 受保护时返回 null（:186-199）；guard 经 `ctx.get('__dshGitWorktreeManagedGuard')` 暴露（:218-222）。

## Remote 适配层与超时看门狗（src/client/console-remote/adapter.ts）

- src/client/console-remote/adapter.ts:67 `createWorktreeConsoleRemoteAdapter(remote, getLanguage)` 把 `GitWorktreeRemote` 的每个方法映射为 `invoke('<method>', ...)`（:101-127）；`resumeRevision` 按 `conflictContinuation` 是否存在分流（:116-118）。
- 看门狗动机（:41-46 注释）：Web RPC 载体本身无超时，卡死的 Host handler（绑定锁队列、挂起的 git）会永久挂起调用 UI；客户端按方法分级失败——服务端继续跑，变更调用可安全重试。`FAST_TIMEOUT_MS = 30_000` / `SLOW_TIMEOUT_MS = 180_000`（:47-48），`FAST_METHODS` 仅读类 7 个方法（sidebarTopology/current/list/inspect/preflight/preflightCreate/previewRecoveryPreflight，:49-52）。
- `invoke`（:70-99）：`Promise.race([call(locale), 定时器 promise])`（:76-81）→ 超时 resolve `{timedOut:true}` → timeoutOutcome 错误码 `'timeout'`（:54-65）；异常按 `isCodecRejection`（消息含 `'rejected "'` 或 `'返回了不符合 strict contract'`，:36-39）映射 `'malformed_response'` 否则 `'transport_unavailable'`；`carrier.ok` 非布尔、`descriptor.result.mode !== 'strict'`、`schema.parse` 失败一律 `'malformed_response'`（:90-98）。

## 相关模块

- 会话徽章/控制台/轮询见 [[target-console|Target Console]]；会话前开关见 [[pre-session-toggle|Pre-Session Toggle]]；评审与恢复见 [[review-console|Review Console]]。
