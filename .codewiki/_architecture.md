---
title: architecture
type: architecture
source_files:
  - cordis.patch.yml
  - package.json
  - scripts/check-publish.mjs
  - scripts/check-workspace-sidebar-version.mjs
  - scripts/clean-lib.mjs
  - scripts/dev-dsh-lib.mjs
  - scripts/dev-dsh.mjs
  - scripts/dsh-source-runner.mjs
  - scripts/workspace-sidebar-upstream-alpha.mjs
  - scripts/workspace-sidebar-upstream-next.mjs
  - scripts/workspace-sidebar-upstream.mjs
  - tsdown.config.ts
  - vitest.config.ts
  - src/adapters/files.ts
  - src/adapters/git-options.ts
  - src/adapters/git.ts
  - src/adapters/initial-commit.ts
  - src/adapters/lookup.ts
  - src/adapters/project-skill-io.ts
  - src/adapters/project-skill-provider.ts
  - src/adapters/project-skills.ts
  - src/adapters/registry.ts
  - src/adapters/safe-file.ts
  - src/adapters/working-directory.ts
  - src/adapters/worktree-creation.ts
  - src/checkpoint.ts
  - src/client/WorktreeCreateRow.tsx
  - src/client/WorktreeReviewRow.tsx
  - src/client/actions.ts
  - src/client/console-remote/adapter.ts
  - src/client/console-remote/index.ts
  - src/client/i18n.tsx
  - src/client/index.tsx
  - src/client/model.ts
  - src/client/pre-session/PreSessionWorktreeToggle.tsx
  - src/client/pre-session/controller.ts
  - src/client/pre-session/harness-input.ts
  - src/client/pre-session/index.tsx
  - src/client/review-console/ReviewActions.tsx
  - src/client/review-console/WorktreeReviewPanel.tsx
  - src/client/review-console/index.ts
  - src/client/review-console/preflight-cache.ts
  - src/client/review-console/preview-recovery-cache.ts
  - src/client/review-console/recovery-continuation.ts
  - src/client/review-console/request-cache.ts
  - src/client/review-console/status-events.ts
  - src/client/settings-card/WorktreeSettingsCard.tsx
  - src/client/settings-card/form-model.ts
  - src/client/settings-card/index.ts
  - src/client/settings-card/worktree-settings-card.ts
  - src/client/styles.ts
  - src/client/target-console/BranchGraphModal.tsx
  - src/client/target-console/TagManagerModal.tsx
  - src/client/target-console/TargetStatusAction.tsx
  - src/client/target-console/WorktreeConsoleView.tsx
  - src/client/target-console/WorktreeHeroChip.tsx
  - src/client/target-console/WorktreeManagerModal.tsx
  - src/client/target-console/WorktreeReviewStatus.tsx
  - src/client/target-console/branch-overview-cache.ts
  - src/client/target-console/current-polling.ts
  - src/client/target-console/index.ts
  - src/client/target-console/target-console.styles.ts
  - src/commands.ts
  - src/concurrent-session-guard.ts
  - src/console-contract.ts
  - src/console-host/control-plane.ts
  - src/console-host/errors.ts
  - src/console-host/projection.ts
  - src/console-host/review-diff.ts
  - src/console-host/service.ts
  - src/console-remote/descriptors.ts
  - src/console-remote/remote.ts
  - src/console-remote/schemas.ts
  - src/console-remote/typert.ts
  - src/creation-failure.ts
  - src/delivery-excludes.ts
  - src/host-compat.ts
  - src/i18n/client-messages.ts
  - src/i18n/core.ts
  - src/i18n/host-messages.ts
  - src/i18n/host.ts
  - src/i18n/transport-messages.ts
  - src/index.ts
  - src/managed-worktree-path.ts
  - src/ports.ts
  - src/session-checkout-apply.ts
  - src/session-checkout-module.ts
  - src/session-target-context.ts
  - src/tools.ts
  - src/types.ts
  - src/workspace-provider-lifecycle.ts
tags: [architecture, overview, system-map, data-flow, dependency-graph, dsh-git-worktree]
---

## Overview

本文是 `dsh-git-worktree` 插件的横切总览，写给零上下文的未来 agent。该插件运行在 DSH（Harness）宿主内，为每个 Session 提供 **Local / Isolated** 两种工作目标：绑定在项目本地 checkout（`local`），或绑定在一个由插件托管生命周期与路径命名的 git worktree（`isolated`，即 Managed Checkout）。托管记录持久化在 `registry.json`（v2 结构，`revision` 单调递增，用作 CAS 版本号），完整生命周期为 **绑定 → 创建 → 评审→ 预览→ 交付（finish）→ 清理/保留→ 下一轮迭代→ 崩溃恢复**。

系统有三条用户可见表面：

- **模型工具**：9 个 `worktree_*` 工具，由 `src/tools.ts:94` 的 `registerTools` 注册；模型驱动的交付受 `autoDeliver` 设置门槛约束（`src/tools.ts:8`）。
- **人类命令**：单一 `/worktree` 命令（status/list/continue/next/finalize/finish/discard/remove），由 `src/commands.ts:44` 注册；破坏性动词仅限人类发起。
- **浏览器 Worktree Console**：Client 端 UI 经 Typert Remote RPC 调用 Host 端控制平面，覆盖同一个领域门面。

架构主轴有四条：

1. **领域与宿主解耦**：`src/session-checkout-module.ts:237` 的 `createSessionCheckoutModule` 是唯一领域门面（接口声明在 `src/index.ts:381`），只依赖 `src/ports.ts` 的端口接口；真实 I/O 全部在 `src/adapters/` 中实现并由 `src/index.ts:358` 的 `apply()` 注入（依赖倒置）。
2. **单一 JSON 契约**：Host 与 Client 两份独立部署产物只通过 `src/console-contract.ts`（纯类型 DTO）与 `src/console-remote/descriptors.ts:94`（一份冻结的 39 方法 strict 描述符数组）共享 wire 契约。
3. **双语文案贯穿两端**：`src/i18n/core.ts` 是平台无关叶子；Host 侧用 `AsyncLocalStorage` 做 per-invocation locale 快照（`src/i18n/host.ts:6`），Client 侧每次调用注入 locale（`src/client/console-remote/adapter.ts:84`）。
4. **失败关闭的安全设计**：删除 checkout 前必须先把 Session cwd 迁出（迁出失败即中止删除，`src/tools.ts:51`）；worktree 创建失败绝不强删，只回滚或标记 `recovery_required`（`src/adapters/worktree-creation.ts:17` + `src/creation-failure.ts:2`）。

本文综合以下模块文章写成：`cli`、`module_core`、`support`、`adapters`、`session_guard`、`i18n`、`types`、`console_contract`、`console_host`、`console_remote`、`client_console_remote`、`client_core`、`client_target_console`、`client_review_console`、`client_pre_session`、`client_settings_card`、`client_i18n`、`workspace_provider`、`scripts`。文中行号均引自这些模块文章；各模块的完整细节请进入对应模块文章阅读。

## System Overview

下图给出静态分层：浏览器端、wire 契约层、Host 端与外部世界，外加不进入运行时的构建工具链。

```text
┌──────────────────────────────────────────────────────────────────────┐
│ dsh-git-worktree 系统总览（静态分层）                                  │
│                                                                      │
│ [1] 浏览器端 Client —— src/client/（随宿主 Web 面加载）                │
│   index.tsx apply()：注册 ToolView、注入样式、按需拉起各子模块          │
│     ├─ WorktreeCreateRow / WorktreeReviewRow（tool.call.toolview 行）  │
│     ├─ target-console：TargetStatusAction · WorktreeConsoleView ·      │
│     │   WorktreeReviewStatus · WorktreeHeroChip · 提交图/标签弹层       │
│     ├─ review-console：ReviewActions · WorktreeReviewPanel ·           │
│     │   preflight / preview-recovery 缓存 · recovery-continuation 队列  │
│     ├─ pre-session：PreSessionWorktreeToggle + Controller（空白会话）   │
│     ├─ settings-card：WorktreeSettingsCard + SettingsFormModel         │
│     └─ console-remote/index.ts（flavor 路由）► adapter.ts（RPC 适配）   │
│   共享基座：actions.ts · model.ts · i18n.tsx · styles.ts                │
└─────────────────────────────────────┬────────────────────────────────┘
                                     │ WorktreeConsoleAdapter（JSON DTO）
                                     ▼
┌──────────────────────────────────────────────────────────────────────┐
│ [2] wire 契约与传输层 —— Host 与 Client 双端共享的唯一边界              │
│   console-contract.ts：纯类型 DTO · 状态投影 · ERROR_META              │
│   console-remote/descriptors.ts：39 个 strict InvocationDescriptor     │
│   console-remote/schemas.ts：Zod strict 校验（拒绝未知键）              │
│   console-remote/remote.ts（客户端类型面）· typert.ts（Host 贡献）      │
└─────────────────────────────────────┬────────────────────────────────┘
                                     │ gitWorktree/* @Remote（Typert Gateway）
                                     ▼
┌──────────────────────────────────────────────────────────────────────┐
│ [3] Host 端 —— src/（Node 进程内）                                     │
│   index.ts apply()：组合根 —— 构建端口与领域模块，注册全部表面，         │
│     挂载 Workspace 竞选，启动 reconcile 与保留期定时器（:358 起）        │
│   ├─ 表现面：tools.ts（模型 worktree_* 工具）· commands.ts（/worktree） │
│   │    session-target-context.ts（系统提示 runtimeContext）             │
│   ├─ 控制台：console-host/service.ts ► control-plane.ts                │
│   │    ► projection.ts · review-diff.ts · errors.ts                    │
│   ├─ 领域：session-checkout-module.ts（状态机 + withBindingLock）       │
│   │    session-checkout-apply.ts（apply 引擎）                         │
│   │    concurrent-session-guard.ts（分支竞态）· support 助手            │
│   │    （checkpoint · commit-message · creation-failure ·              │
│   │      delivery-excludes · managed-worktree-path）                   │
│   ├─ 端口：ports.ts ◄ adapters/{git, files, registry, lookup,          │
│   │    project-skills, working-directory}.ts                           │
│   └─ 宿主特有：workspace-provider-lifecycle.ts（uiWorkspace 竞选）      │
│        + host-compat.ts + i18n/host.ts（宿主双语文案）                  │
└─────────────────────────────────────┬────────────────────────────────┘
                                     ▼
       Harness 宿主服务（subprocess · sessions · workspaceRegistry ·
       uiWorkspace · settings · locale）· git 子进程 · node:fs
       · registry.json（AtomicJsonCheckoutRegistry 原子读写）

┌──────────────────────────────────────────────────────────────────────┐
│ [4] 构建 / 开发工具链（不进入运行时）                                   │
│   package.json 门禁 · tsdown.config.ts · vitest.config.ts             │
│   scripts/：check-publish · dev-dsh-lib · workspace-sidebar-upstream*  │
└──────────────────────────────────────────────────────────────────────┘
```

分层要点：

- **组合根唯一**。`src/index.ts:358` 的 `apply()` 构建全部适配器与领域模块，依次注册工具（`src/index.ts:381`）、命令（`:408`）、系统提示上下文（`:409`）、控制台服务（`:398-405`），挂载 uiWorkspace 竞选（`:363`），并在 ready 时与每 15 分钟（`:343`）运行 `reconcile`（`:414`）。
- **三条入口，一个门面**。tools / commands / console-host 都调用同一个 `SessionCheckoutModule`；区别只在表面层（工具输出 JSON、命令渲染文本、控制台产出 DTO）。
- **uiWorkspace 竞选是 Host 侧特例**。`mountWorkspaceProviderLifecycle`（`src/workspace-provider-lifecycle.ts:66`）用 Cordis Loader 在宿主侧禁用/恢复官方 `uiWorkspace` 入口，其结果 `officialWorkspaceActive` 单向传入 `WorktreeConsoleService`（`src/index.ts:398-405` → `src/console-host/service.ts:35`），并经 `sidebarTopology` 告知 Client 该走哪条 flavor 分支。
- **构建工具链与运行时隔离**。`scripts/` 只在构建/发布/开发时执行；`tsdown.config.ts` 通过 virtual id 消费 `workspace-sidebar-upstream*.mjs` 对官方 Workspace 客户端做 SHA-256 门控派生。

跨切面不变量（读任何模块前先记住）：

- **路径无关投影**：`*View` 与 `WorktreeConsoleTargetSummary` 不携带路径；只有鉴权通过后的 `WorktreeConsoleTargetDetails` 才含 `managedRoot`/`sourceRoot`（`src/console-contract.ts:185`）。
- **CAS 一致性**：所有变更携带 `expectedRevision`/`expectedReviewId`；`registry.revision` 在 `withBindingLock`（`src/session-checkout-module.ts:1289`）下单调递增。
- **严苛 JSON**：Host 拒绝 `undefined` 键；wire 层 Zod strict 拒绝未知键（`src/console-remote/schemas.ts:29`）。
- **locale 快照隔离**：Host 每个 RPC 在 `withHostLanguage` 内运行；用户数据（路径、分支名、JSON）永不翻译。

## Data Flow

下图给出一次典型变更（`finalize`）从三条入口到结果投影的完整管线；A/B 两条入口直连领域门面，C 经过 wire 链路。

```text
┌──────────────────────────────────────────────────────────────────────┐
│ [入口] 三条路径 → 同一领域门面                                         │
│   A 模型 Agent：tools.ts:94 registerTools → 9 个 worktree_* 工具       │
│     （worktree_create :101 · ready_for_review :319 · deliver :406）    │
│   B 人类用户：commands.ts:44 → /worktree 动词（status / list /         │
│     continue / next / finalize / finish / discard / remove）           │
│   C 浏览器 Console：review-console/ReviewActions.submitCommit(:625)    │
│     → adapter.finalize（WorktreeConsoleAdapter）                       │
└─────────────────────────────────────┬────────────────────────────────┘
                                     │ A/B 直连门面；C 经下方 wire 链路
                                     ▼
┌──────────────────────────────────────────────────────────────────────┐
│ [C 的 wire 链路]（A/B 跳过本框）                                       │
│   client/console-remote/adapter.ts invoke(:83)：locale 注入(:84)       │
│     · 30s/180s 超时(:56) · descriptor strict 复验(:108)                │
│        ▼ Typert Gateway：descriptors.ts:94（agentId 先解析 :58）       │
│   console-host/service.ts:35 @Remote：withHostLanguage 薄封装          │
│        ▼                                                              │
│   control-plane.ts:206：authorize(:318) · expectedRevision CAS ·      │
│     readyReview(:140) → module.operate / module.*                     │
└─────────────────────────────────────┬────────────────────────────────┘
                                     ▼
┌──────────────────────────────────────────────────────────────────────┐
│ [领域核心] SessionCheckoutModule 门面                                  │
│   （src/session-checkout-module.ts:237 返回，接口 src/index.ts:113）   │
│   withBindingLock(:1289)：单进程互斥 · registry.revision 单调递增      │
│   operate(:3816) · inspect(:1344) · bindTarget(:4841)                 │
│   beginNextIteration(:4535) · markReadyForReview(:1684)               │
└─────────────────────────────────────┬────────────────────────────────┘
                                     ▼
┌──────────────────────────────────────────────────────────────────────┐
│ [端口 → 适配器 → 外部世界]                                             │
│   git.ts:249：加固 git 子进程（--no-optional-locks · C locale）        │
│     runGit(:93) · createDetachedWorktree(:336)                        │
│     → worktree-creation.ts:17（证据优先，失败仅回滚不强删）             │
│   registry.ts:397 + safe-file.ts:82/:113：registry.json 原子读写       │
│   lookup.ts:65：Harness sessions / workspaceRegistry                  │
│   project-skills.ts:101：Skill 快照/携带 · working-directory.ts:61     │
└─────────────────────────────────────┬────────────────────────────────┘
                                     ▼
        Git 仓库（session 分支 · refs/dsh-worktree/*）· registry.json
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────┐
│ [结果投影返回]                                                         │
│   operate → SessionCheckoutOperationResult（types.ts:585）             │
│   A/B ► tools / commands 渲染 *View 文本（JSON 输出）                   │
│   C ► projection.ts projectRecord(:116) → WorktreeConsoleTarget*      │
│     （路径无关）► adapter strict 复验 ► ReviewActions.applyTarget(:253) │
│     ► requestWorktreeReviewRefresh 广播刷新全部挂载面                   │
└──────────────────────────────────────────────────────────────────────┘
```

### 流程 1 —— 模型工具（worktree_deliver，`src/tools.ts:447` 起）

1. `sessionIdOf(exec.agent)` 解析调用者 Session（`:449`），`module.inspect` 读取当前目标（`:450`）。
2. `module.isAutoDeliverEnabled()` 为 false 即拒绝（`:451`）；`delivery.state` 必须是 `working`/`ready_for_review`（`:455`）。
3. `leaveCheckoutBeforeRemoval`（`src/tools.ts:51`）先把 Session cwd 迁出 checkout（`:470`）；迁出失败直接抛出并中止——Session 绝不指向一个即将消失的目录。
4. `module.operate({ action: 'finish', … })`（`:474`）进入 `operateTarget`（`src/session-checkout-module.ts:3816`）：CAS 校验 → apply 引擎在隔离侧提交；提交只落在 session 分支，Local 工作树/索引/HEAD 永不被写（`refuseLegacyLocalWrite`，`:1656`）。
5. 失败时 `enterCheckout` 把 Session 送回存活 checkout（`:486`）；成功返回 `SessionCheckoutFinishedResult`（`src/types.ts:394`），含 `commitOid`、保留策略与尽力而为的 `push` 结果。

### 流程 2 —— 人类命令（`/worktree finalize`，`src/commands.ts:121`）

解析 `reviewId revision retention` 三元组 → 校验评审卡未过期（`:133`）→ `leaveCheckout`（`src/commands.ts:51`；失败即中止删除，`:139`）→ `module.operate({ action: 'finish', … })` → `finishedText` 渲染（`:35`）。浏览器侧 `finalizeCurrentSession`（`src/client/actions.ts:278`）发送同一条命令。

### 流程 3 —— Console RPC（finalize）

1. `ReviewActions.submitCommit`（`src/client/review-console/ReviewActions.tsx:625`）先**强制刷新** preflight 缓存（写前必须拿新鲜 Host 读数），再调 `adapter.finalize`。
2. `createWorktreeConsoleRemoteAdapter`（`src/client/console-remote/adapter.ts:80`）的 `invoke`（`:83`）：注入 locale（`:84`）、按方法选 30s/180s 超时（`:56`）、成功载荷经 descriptor strict 复验（`:108`）。
3. Typert Gateway 依 `WORKTREE_CONSOLE_DESCRIPTORS`（`src/console-remote/descriptors.ts:94`）先解析 `agentId`（`:58`）再做业务派发。
4. `WorktreeConsoleService`（`src/console-host/service.ts:35`）在 `withHostLanguage` 下委托 `control-plane.finalize`（`src/console-host/control-plane.ts:1337`）：`authorize`（`:318`）+ `expectedRevision`/`expectedReviewId` CAS → `module.operate({ action: 'finish' })`。
5. `conflict` → `apply_conflict` + 冲突续传（`control-plane.ts:167`）；`finished` → `mutationResponse` 经 `projection.projectRecord`（`src/console-host/projection.ts:116`）返回路径无关 DTO。
6. 客户端 `applyTarget`（`ReviewActions.tsx:253`）广播 `requestWorktreeReviewRefresh`（`src/client/review-console/status-events.ts:4`），所有挂载面重读 Host 权威 target。

### 流程 4 —— 只读系统提示（同步契约）

`registerSessionTargetContext`（`src/session-target-context.ts:14`）注册 order 118 的 `systemPrompt.context`，其 text **同步**调用 `module.runtimeContext`（`src/session-checkout-module.ts:1077`）。每 45 秒（`src/session-target-context.ts:22`）fire-and-forget `refreshBranchRaceGuards`（`:1002`）把 `git.branchCreationTimes`（`src/adapters/git.ts:508`，reflog 派生）写入 `branchRaceCache`（`:999`）；`branchRaceNotice`（`:1035`）同步消费缓存并调用纯函数 `detectLocalBranchRace`（`src/concurrent-session-guard.ts:68`），命中则在提示中注入「Branch Race detected」，引导后启动的 Session 先调 `worktree_create` 隔离。

### 流程 5 —— 生命周期与持久化

`bindTarget`（`:4841`）写 `preparing` 记录 + `sessionBindings` → `git.createDetachedWorktree`（`src/adapters/git.ts:336` → `worktree-creation.ts:17`：先采集身份证据，失败按 `WorktreeCreationFailure.rolledBack` 决定回滚删除或 `recovery_required`）→ `attachSessionBranch`（`:754`）→ `ready`。`markReadyForReview`（`:1684`）快照评审并经 `checkpointGenerationForRecord`（`src/checkpoint.ts:16`）盖章 CAS 世代。交付后 `cleanupFinalized`（`:2979`) 拆除 worktree 至 `discarded`+`delivered`；保留期与 LRU 由 `cleanupExpiredRetained`/`enforceWorktreeKeepCount` 定时收敛。registry 读写全程经 `AtomicJsonCheckoutRegistry`（`src/adapters/registry.ts:397`）与 safe-file（原子写 `src/adapters/safe-file.ts:82`；崩溃后从 `.tmp`/`.bak` 恢复 `:113`）。

### 流程 6 —— i18n（横切）

每个 `@Remote` 在 `withHostLanguage` 内运行（`service.ts:76` 为范式）；tools/commands 用 `languageForInvocation`（`src/i18n/host.ts:30`）按调用者绑定语言；客户端每次 `invoke` 注入 locale（`adapter.ts:83`）。错误码语言无关，`consoleFailure`（`src/console-host/errors.ts:13`）保持 `code` 稳定、仅 message 本地化。

## Dependency Graph

依赖规则：**`X ──► Y` 表示「X 依赖 Y」**；`◄──` 用于标注「实现端口接口」的关系。

```text
┌──────────────────────────────────────────────────────────────────────┐
│ [Client] src/client/（依赖方向：A ──► B 表示 A 依赖 B）                 │
│   target-console ──► client_core（actions · model · i18n · styles）    │
│   review-console ──► client_core + request-cache（单飞缓存）           │
│   pre-session ──► client_core ；settings-card ──► client_i18n          │
│   全部 UI ──► console-contract.ts（WorktreeConsoleAdapter :745）        │
│   console-remote/index.ts + adapter.ts ──► console-remote/             │
│     descriptors.ts + schemas.ts（与 Host 共享同一冻结数组 :94）          │
└─────────────────────────────────────┬────────────────────────────────┘
                                     │ Client 对下依赖的唯一通道
                                     ▼
┌──────────────────────────────────────────────────────────────────────┐
│ [共享叶子] Client 与 Host 双端依赖；自身不依赖任何业务模块               │
│   types.ts ◄── console-contract.ts ◄── console-remote/*                │
│   i18n/core.ts ◄── i18n/host.ts（Host 专用）                           │
│                 ◄── i18n/client-messages.ts（Client 专用）             │
└─────────────────────────────────────┬────────────────────────────────┘
                                     ▲
                                     │ Host 对上依赖同一批叶子
┌─────────────────────────────────────┴────────────────────────────────┐
│ [Host] src/                                                           │
│   tools.ts / commands.ts / session-target-context.ts                  │
│     ──► SessionCheckoutModule 门面（session-checkout-module.ts）       │
│   console-host/{service, control-plane, projection, review-diff}      │
│     ──► 模块门面 + ports.ts + console-contract.ts                     │
│   session-checkout-module.ts ──► ports.ts（只依赖接口＝依赖倒置）       │
│     ──► session-checkout-apply.ts ──► ports.ts                        │
│     ──► support 助手 + concurrent-session-guard.ts                    │
│   adapters/{git, files, registry, lookup, project-skills,             │
│     working-directory}.ts ──► ports.ts（实现接口；index.ts 注入）       │
│   workspace-provider-lifecycle.ts ──► host-compat.ts                  │
│     officialWorkspaceActive ──► console-host/service.ts（单向）        │
│   index.ts apply()（:358）＝ 组合根：依赖上述全部并完成装配              │
└─────────────────────────────────────┬────────────────────────────────┘
                                     ▼
        Harness 宿主 / git 子进程 / node:fs / registry.json

  构建期（与运行时隔离）：
    package.json ──► scripts/check-publish.mjs（7 项发布门禁）
    tsdown.config.ts ──► scripts/workspace-sidebar-upstream*.mjs（virtual 派生）
    vitest.config.ts ──► tests/*（不进入发布产物）
```

依赖规则：

1. **组合根唯一**：只有 `src/index.ts` 的 `apply()` 构建并装配对象；模块之间不互相实例化。
2. **依赖倒置**：领域（`session-checkout-module.ts`、`session-checkout-apply.ts`）只 import `ports.ts` 接口；`src/adapters/` 实现端口并被注入。领域文件永不直接触 git / fs / 宿主服务。
3. **契约是共享叶子**：`console-contract.ts` 只依赖 `types.ts`；`console-remote/{descriptors,schemas}` 与 `client/console-remote/adapter.ts` 消费**同一份冻结描述符数组**（`descriptors.ts:94`），两端独立部署仍做同构 strict 校验。
4. **Client 只见契约**：`src/client/*` 不 import 任何 Host 内部模块（仅 `console-contract` 与 `console-remote` 公共面）；宿主服务以结构化接口注入（`WorktreeClientServices` 等）。
5. **i18n 三段式**：`core.ts` 无平台依赖（其文件头 `:1` 明示）；`host.ts` 仅 Host、`client-messages.ts` 仅 Client，两端在各自边界解析 locale。
6. **support 与 types 是叶子**：四个 support 助手互不依赖；`types.ts` 是最底层类型面，被领域、契约与表面共同消费。
7. **`workspace_provider` 特例**：它是 Host 侧对 Cordis Loader 的控制器，不依赖领域；其产出 `officialWorkspaceActive` 只向 `console-host/service.ts` 单向流动。
8. **构建期隔离**：`scripts/` 不被任何运行时代码 import；`tsdown` 经 virtual id 消费派生产物，`vitest` 用 mock 替身。

## Module Roles

### 组合根与领域层（Host）

| 模块 | 核心文件（行号） | 职责 | 相互连接 |
|---|---|---|---|
| index.ts（插件入口） | `src/index.ts:333` | 组合根：构建端口与领域模块，注册工具/命令/上下文/控制台与 Workspace 竞选；启动 reconcile（`:414`）与 15 分钟维护定时（`:343`）；volatile 配置经 `liveConfigValue` 注入 | 连接下表所有模块 |
| module_core | `src/session-checkout-module.ts:237` | `createSessionCheckoutModule` 门面（接口 `src/index.ts:381`）：状态机、`withBindingLock`(`:1289`)、`operate`(`:3816`)、`bindTarget`(`:4841`)、`reconcile`(`:1362`)、`runtimeContext`(`:1077`)；`managed-worktree-path.ts` 提供分支/路径命名 | 被 cli、console_host、session-target-context 调用；依赖 ports、apply 引擎、support、session_guard |
| session-checkout-apply | `src/session-checkout-apply.ts` | apply 引擎：plan/apply/preview/checkpoint/rollback/finalize、`reviewIsolated`(`:1489`)/`commitIsolated`(`:1538`)、`captureSnapshot`(`:613`) | 由 module 经 `dependencies.applyEngine` 驱动；依赖 ports + support |
| session-target-context | `src/session-target-context.ts:14` | 注入 order 118 系统提示（同步 `runtimeContext`）；45s 刷新分支竞态缓存(`:22`) | 调用 module_core；消费 working-directory 端口 |
| session_guard | `src/concurrent-session-guard.ts:68` | 纯函数 `detectLocalBranchRace` + 模块侧 `branchRaceCache`(`:999`)/`branchRaceNotice`(`:1035`)，产出「Branch Race detected」提示 | 数据源 `adapters/git.branchCreationTimes`(`:508`)、`lookup.listLiveSessions`(`:109`) |
| support | `src/checkpoint.ts:16` · `commit-message.ts:2` · `creation-failure.ts:3` · `delivery-excludes.ts:22` | 叶子助手：Review/checkpoint CAS 世代、提交信息校验（空/NUL）、`WorktreeCreationFailure.rolledBack`、交付排除 pathspec | 被 module/apply/adapters 直接 import；组内无互相依赖 |
| types | `src/types.ts` | 纯类型面：`SessionTargetView`(`:198`)、Operation(`:344`)/Result(`:585`)、错误码(`:597`)；路径无关 `*View` | 被领域、console_contract、全部表面消费 |

### 端口与适配器（Host 基础设施）

| 模块 | 核心文件（行号） | 职责 | 相互连接 |
|---|---|---|---|
| ports | `src/ports.ts` | 端口接口：git/files/registry/lookup + `SessionCheckoutDependencies`（含 `LiveValue` 配置） | adapters 实现之；module/apply/console_host 依赖之 |
| adapters | `git.ts:93` · `files.ts:89` · `registry.ts:397` · `safe-file.ts:82` · `lookup.ts:65` · `project-skills.ts:101` · `working-directory.ts:61` · `worktree-creation.ts:17` · `git-options.ts` · `initial-commit.ts` | 端口实现：加固 git 子进程（`runGit` `:93`）、崩溃安全 JSON、Harness 查询、Skill 携带/校验、cwd 迁移端口、证据优先的 worktree 创建/回滚 | 实现 ports；由 index.ts 注入 module 与 console_host |

### 宿主表面与横切

| 模块 | 核心文件（行号） | 职责 | 相互连接 |
|---|---|---|---|
| cli | `src/tools.ts:8` · `src/commands.ts:44` | 9 个模型工具 + `/worktree` 命令；删除前迁出 cwd（`:51`/`:62`）；`autoDeliver` 门槛（`tools.ts:451`） | 调用 module_core；文案经 i18n host 包裹 |
| i18n | `core.ts:19` · `host.ts:6` · `host-messages.ts:1759` · `client-messages.ts` · `transport-messages.ts` | 双语目录与 locale 隔离；`hostRegistrationMessage`(`:1758`)；persistedCleanup 白名单(`:1768`) | Host 侧被 tools/commands/console-host 使用；Client 侧被全部 client UI 使用 |
| workspace_provider | `src/workspace-provider-lifecycle.ts:66` · `src/host-compat.ts:79` | uiWorkspace provider 竞选（Host 侧 Loader disable/restore 官方入口）；宿主 flavor 判定 | `officialWorkspaceActive` 单向进入 console-host/service.ts(`:40`) |
| console_contract | `src/console-contract.ts:705` · `:76` · `:695` · `:705` · `:745` | 纯类型契约：状态枚举/投影、全部 DTO、`ERROR_META` 错误策略、`WorktreeConsoleAdapter` 接缝 | 上游 types.ts；被 Host/Client/测试夹具三方 import |

### 控制台（Host ↔ Client）

| 模块 | 核心文件（行号） | 职责 | 相互连接 |
|---|---|---|---|
| console_host | `service.ts:35` · `control-plane.ts:318` · `projection.ts:116` · `review-diff.ts:123` · `errors.ts:13` | `@Remote` 薄封装 + 权威控制平面（`authorize` `:318`、CAS、`linkedReadAccess` `:340`）、路径无关投影、临时索引 review diff、`WorktreeConsoleOutcome` 构造 | 依赖 module + ports + contract；被 console_remote 的 wire 调用 |
| console_remote | `descriptors.ts:94` · `schemas.ts:29`/`:227` · `remote.ts:31` · `typert.ts:5` | 39 个 strict RPC 描述符 + Zod 校验 + Host `TYPERT` 贡献 + 客户端 `GitWorktreeRemote` 类型面 | 与 console_contract 同源；Host/Client 共享同一数组 |
| client_console_remote | `client/console-remote/index.ts:62` · `adapter.ts:80` | `$mount` + flavor 路由（legacy/alpha/next/modern/unsupported）；adapter：locale 注入(`:84`)、30s/180s 超时(`:56`)、strict 复验(`:108`) | 实现 `WorktreeConsoleAdapter`；被全部 client UI 消费 |

### 浏览器端 UI

| 模块 | 核心文件（行号） | 职责 | 相互连接 |
|---|---|---|---|
| client_core | `client/index.tsx:49` · `actions.ts:199`/`:278` · `model.ts:100`/`:152` · `i18n.tsx:29` · `styles.ts` | 客户端入口（ToolView 注册、i18n Proxy、样式注入）、导航/最终化编排、回放稳定 ToolView 模型 | 依赖 contract；被各 UI 子模块复用 |
| client_target_console | `target-console/index.ts:19` · `TargetStatusAction.tsx:51` · `WorktreeConsoleView.tsx:93` · `current-polling.ts:94` · `branch-overview-cache.ts` | header 胶囊 / dock 状态条 / hero chip / 关联 Worktrees 管理面 / 提交图 / 标签；5s 轮询与 SWR 分支缓存 | 走 adapter；复用 review-console 的 `ReviewActions` |
| client_review_console | `ReviewActions.tsx:82` · `WorktreeReviewPanel.tsx:54` · `request-cache.ts:41` · `recovery-continuation.ts:389` | 验收卡与全部交付 mutation；单飞 preflight/preview-recovery 缓存；跨渲染恢复续传（localStorage + Host 复验 `:195`） | 走 adapter + client_core actions；刷新事件驱动 target-console |
| client_pre_session | `pre-session/index.tsx:30` · `controller.ts:75` · `PreSessionWorktreeToggle.tsx` · `harness-input.ts` | 空白会话前创建隔离目标：创建 → 迁移草稿/附件 → 导航 → 退役源（含回滚 `:197`） | 走 adapter + client_core services |
| client_settings_card | `settings-card/index.ts:35` · `form-model.ts:188` | 设置页：暂存式表单模型（revision 围栏 `:293`）编辑 5 个 volatile 字段 | 由 console-remote 入口挂载（`client/console-remote/index.ts:73`） |
| client_i18n | `client/i18n.tsx:29`/`:49` | `LocaleFace` → `useSyncExternalStore` 响应式语言；命令式 `translatorForServices` | 被全部 client UI 使用 |

### 构建与开发工具链

| 模块 | 核心文件（行号） | 职责 | 相互连接 |
|---|---|---|---|
| scripts | `check-publish.mjs`（7 项门禁） · `dev-dsh-lib.mjs:466` · `workspace-sidebar-upstream.mjs:11`/`:176` · `clean-lib.mjs` · `check-workspace-sidebar-version.mjs` | 发布完整性门禁、本地快照安装与 dev fixture（`dev:dsh`）、官方 Workspace 客户端 SHA-256 门控派生、`lib/` 清理 | 被 `package.json` scripts / `tsdown.config.ts` / `vitest.config.ts` 消费；不进入运行时 |