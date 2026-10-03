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

Client 侧是插件的浏览器运行时：把 Host 暴露的 Remote 服务适配成 `WorktreeConsoleAdapter`，向 Harness Workspace 注册 ToolView、会话徽章、会话前开关等 UI，并完成 Workspace 代际探测与启动上报。共享契约定义在 src/console-contract.ts（目标状态、capabilities、错误码 meta、Adapter 接口）。

## 入口装配 apply（src/client/index.tsx）

- src/client/index.tsx:16 定义服务名常量 `WORKTREE_CONSOLE_ADAPTER_SERVICE = 'worktreeConsole'`；src/client/index.tsx:34 声明模块依赖 `inject = ['slots','workspaces','sessions','conversation','connection','locale']`。
- src/client/index.tsx:36-44 `servicesOf(ctx)` 从 ctx 提取 locale/workspaces/sessions/uiWorkspace/conversation 合并为 `WorktreeClientServices`。
- src/client/index.tsx:47 `apply(ctx, adapterOverride?)` 用 Proxy 包裹 `ctx.slots.register`（src/client/index.tsx:51-57）：每个注册组件自动包一层 `ClientI18nProvider`（src/client/index.tsx:53），所有插件 UI 统一获得语言上下文。
- src/client/index.tsx:61-62 解析适配器：`adapterOverride ?? ctx.get('worktreeConsole')`（测试/装饰分支可注入替身）。
- src/client/index.tsx:67-75 样式注入：`ctx.effect` 创建 `<style>` 并打上 `dataset.dshGitWorktree`、`dataset.plugin='dsh-git-worktree'`、`dataset.pluginCss='dsh-git-worktree/styles'` 自标签。文本内容为 `${WORKTREE_STYLES}\n${TARGET_CONSOLE_STYLES}` 两段拼接；cleanup 按引用移除。注释说明 DSH client-module 系统会"收养" head 中没有 data-plugin 的 `<style>` 并在自身模块失效时删除——自标签即所有权凭证。
- src/client/index.tsx:77-86 注册 `tool.call.toolview` 槽位：`'worktree_create'` → WorktreeCreateRow，`'worktree_ready_for_review'` → WorktreeReviewRow（props 携带 services 与 adapter；两个 Row 组件是 model.ts 解析器的薄展示壳）。注册描述符格式为 `{ name: 'tool.call.toolview', key: '...' }`。
- src/client/index.tsx:89-95 仅当 `adapter !== undefined` 才调用 `registerTargetConsole`——无 Remote 时插件以纯 ToolView 降级运行。

## ToolView 模型层（src/client/model.ts）

- 纯函数把日志化的 call/result 块重放为稳定视图模型：`WorktreeCreatePayload` kind `'worktree_target_created'`（src/client/model.ts:31-39）、`WorktreeReviewPayload` kind `'worktree_ready_for_review'`（src/client/model.ts:41-48）。
- src/client/model.ts:50-57 新增 `ReviewArgs` 接口：`summary`/`details?`/`validationStatus`/`validationSummary?`/`tests[]`/`suggestedCommitMessage`，供 parseReviewTool 解析完成块参数。
- src/client/model.ts:68-75 `textContent(block)` 从 content blocks 提取 text 字段或 JSON.stringify 非 text 项，失败块附加 error.name/code。
- src/client/model.ts:82-86 `lifecycle(block)`：`error.code==='interrupted'` → `'stopped'`；`isError` → `'error'`；否则 `'ok'`。
- src/client/model.ts:96-113 `parseCreateTool` 对解析结果做严格字段校验，失败落到 `t('malformed.worktree.create.result')` 错误文案而不是崩溃。
- src/client/model.ts:115-146 `reviewArgs(value)` 严格校验 ReviewArgs 结构：summary/validationStatus/tests/suggestedCommitMessage 必填，test 条目需 command/status，details/validationSummary 可选字符串。
- src/client/model.ts:148-181 `parseReviewTool` 对解析结果做严格字段校验：payload 校验 reviewId/revision/changedFiles，args 通过 reviewArgs 校验；`block.kind ? block.call?.argsRaw : block.argsRaw`（src/client/model.ts:152）取 args；`parsedArgs` 不存在时返回 `t('malformed.ready.for.review.arguments')` 错误（src/client/model.ts:165-167）；iteration 归一为非负整数缺省 0（src/client/model.ts:175）。

## 样式与 i18n

- src/client/styles.ts:3 `WORKTREE_STYLES` 用 `String.raw` 聚合侧边栏徽章/卡片样式；:132 插值 `REVIEW_CONSOLE_STYLES`；:134-135 是创建对话框按钮的晚期覆盖。包含状态色映射（working/ready_for_review/preview_active/preview_detached/recovery_required/finalized/discarded 七种 state 的 accent 变量）。
- src/client/i18n.tsx:19-21 `readClientLanguage` 从 LocaleFace `snapshot.active` 归一语言（失败回退 `'zh'`）；:29-40 `ClientI18nProvider` 用 `useSyncExternalStore` 订阅语言变化；:49-51 `translatorForServices` 在调用时才解析语言（命令式路径不能吃模块加载时的快照）。
- 词典与占位符插值基础在 src/i18n/core.ts（`createTranslator`/`normalizeLanguage`），client 文案集中在 src/i18n/client-messages.ts（~1428 行，数百条 zh/en 文案）与 src/i18n/transport-messages.ts（4 条：malformed/mountFailed/workspaceGenerationUnknown/invokeTimeout）两份目录。

## Remote 装配与 Workspace 代际分支（src/client/console-remote/index.ts）

- src/client/console-remote/index.ts:30 `inject` 继承 officialWorkspaceInject 但过滤掉 `remote.directoryPicker`（避免死锁——picker provider entry 等 uiWorkspace，而此 entry 不能等 picker）。
- 启动序列 src/client/console-remote/index.ts:43-53：`ctx.remote.$mount(contribution)` → `ctx.get('remote.gitWorktree')`（undefined 即抛 mountFailed）→ `createWorktreeConsoleRemoteAdapter(remote, getLanguage)` → `ctx.provide('worktreeConsole', adapter)`；同时 mountSettingsCard。
- src/client/console-remote/index.ts:66-77 `reportBoot` 尽力上报 `WorktreeClientBootReport`（flavor/branch/registered/detail/elapsedMountMs/elapsedTopologyMs）；注释提醒 Remote 代理按位置校验参数个数，末尾 locale 即使 undefined 也必须传。
- src/client/console-remote/index.ts:78-84 拉取 `sidebarTopology` 决定分支：失败则 `reportBoot('topology-failed', false, ...)` 并抛 `workspaceGenerationUnknown` 错误。
- 分支路由（src/client/console-remote/index.ts:86-176）：
  - `flavor === 'legacy'`（:86-95）：要求 `sessions.open` 存在后 `registerManagedWorkspaceSidebar`；
  - `flavor === 'modern'`（:96-132）：`officialWorkspaceActive === true` 走 DECORATE（:101-115，shadow 官方 Browser 注册）；否则 MANAGED 分支 `registerManagedWorkspaceSidebar(..., applyOfficialWorkspace)`（:116-131）；
  - `flavor === 'alpha' || 'next'`（:133-171）：同 modern 逻辑——decorate 或 managed，`applyWorkspace` 分别指向 `applyAlphaWorkspace` / `applyNextWorkspace`；
  - unsupported（:172-176）：仅 `mountTools(ctx)`。
- 三种官方 Browser 声明同一顶层 Slot，按 Host 解析的包版本选择而非 Client 服务时序（:63-65 注释）。

## 侧边栏接管与装饰（src/client/workspace-sidebar）

两种模式对应 boot 分支：MANAGED 接管（`registerManagedWorkspaceSidebar`，src/client/workspace-sidebar/index.tsx:271-277 = `applyWorkspace(officialContextProxy(ctx, adapter))`）与 DECORATE 影子注册（`registerDecoratedWorkspaceSidebar`，src/client/workspace-sidebar/index.tsx:304-354：官方 Workspace Client 存活时找到最低优先级的 `sidebar.workspaces` 条目，以 priority-10 降级 `registrant:'dsh-git-worktree'` 重注册同选项并包一层 ManagedOfficialWorkspaceBrowser；slot registry 不可用则抛 "The official Workspace is active but the slot registry is unavailable."）。

- src/client/workspace-sidebar/index.tsx:14-15 `EMPTY_TOPOLOGY` 常量；:17-22 `ManagedWorktreeSessionDecoration` 接口（kind/state/label/originalTitle）；:24-30 `ManagedWorkspaceGuard` 接口（ready/sessionIds/workspaceIds/blockSession/blockWorkspace）。
- src/client/workspace-sidebar/index.tsx:42-159 `ManagedOfficialWorkspaceBrowser` 用投影 memo 重投影官方 workspace/session 状态，给 byId 条目挂 `__dshGitWorktree` `ManagedWorktreeSessionDecoration`（:115-121），守卫 startSession/forkSession/insertSessionBefore（:141-157），并在挂载与 `WORKTREE_REVIEW_REFRESH_EVENT`（src/client/review-console/status-events.ts）时刷新拓扑（:59-81）。
- src/client/workspace-sidebar/index.tsx:175-191 `deferredRemoteDirectoryPicker`：Proxy 延迟解析 `remote.directoryPicker`，解决现代 Host 中 picker provider 等待 uiWorkspace 的死锁问题。
- src/client/workspace-sidebar/index.tsx:193-264 `officialContextProxy(ctx, adapter)` 用 Proxy 包 `slots.register`：`sidebar.workspaces.session.menu.item` / `sidebar.workspaces.session.row.action`（除 pin）包成 GuardedAction（:210-222）；`sidebar.workspaces` 注册替换为 `ManagedOfficialWorkspaceBrowser`（:224-233）；`get` 方法暴露 `__dshGitWorktreeManagedGuard`（:255-256）和 deferred picker（:257-258）。

## Remote 适配层与超时看门狗（src/client/console-remote/adapter.ts）

- src/client/console-remote/adapter.ts:76 `createWorktreeConsoleRemoteAdapter(remote, getLanguage)` 把 `GitWorktreeRemote` 的每个方法映射为 `invoke('<method>', ...)`（:110-144）；`resumeRevision` 按 `conflictContinuation` 是否存在分流（:126-128）。
- 看门狗动机（:47-50 注释）：Web RPC 载体本身无超时，卡死的 Host handler（绑定锁队列、挂起的 git）会永久挂起调用 UI；客户端按方法分级失败——服务端继续跑，变更调用可安全重试。`FAST_TIMEOUT_MS = 30_000` / `SLOW_TIMEOUT_MS = 180_000`（:52-53），`FAST_METHODS` 现含 8 个方法：sidebarTopology/current/inspect/previewRecoveryPreflight/gitOverview/gitGraph/listAbandoned（:56-61）。
- `invoke`（:79-108）：`Promise.race([call(locale), 定时器 promise])`（:85-90）→ 超时 resolve `{timedOut:true}` → timeoutOutcome 错误码 `'timeout'`（:52-65）；异常按 `isCodecRejection`（消息含 `'rejected "'` 或 `'返回了不符合 strict contract'`，:41-44）映射 `'malformed_response'` 否则 `'transport_unavailable'`；carrier.ok 非布尔、descriptor.result.mode !== 'strict'、schema.parse 失败一律 `'malformed_response'`（:99-107）。

## 相关模块

- 会话徽章/控制台/轮询见 [[target-console|Target Console]]；评审与恢复见 [[review-console|Review Console]]。
