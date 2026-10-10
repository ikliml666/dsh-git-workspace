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
tags:
  - host
  - entry
  - tools
  - commands
  - i18n
---

## Overview

`dsh-git-worktree` 是 DeepSeek Harness (DSH) 的 Git worktree 会话目标插件。宿主入口文件 `src/index.ts` 负责将端口适配器（Git、文件、查找）、核心状态机模块 (`SessionCheckoutModule`)、执行引擎、控制台服务装配为一个插件，并向模型（工具）、人类用户（命令）和 UI（系统提示上下文）暴露能力。

该模块管理受管 Worktree 的生命周期，包括创建隔离目标、迭代、准备审查、交付（commit/push/cleanup）以及清理。它支持 volatile 配置热更新，并在启动时自动恢复与定期维护（保留期过期、合并分支修剪）。

## Key Components

### 导出类型与接口 (src/index.ts)

- **`SessionCheckoutError`** (`src/index.ts:35`): 领域错误基类。继承 `Error`，包含 `readonly code: SessionCheckoutErrorCode` 和 `message`。构造函数设置 `name = 'SessionCheckoutError'`。
- **`SessionCheckoutReconcileSummary`** (`src/index.ts:49`): 收敛摘要接口，包含 `recoveryRequiredCheckoutIds`, `orphanedCheckoutIds`, `dirtyOrphanedCheckoutIds`, `staleRootCheckoutIds`, `retainedCheckoutCount`。
- **`ManageManagedWorktreeInput`** (`src/index.ts:57`): 管理输入接口，包含 `checkoutId`, `expectedRevision`, `action` ('cleanup_retained' | 'retry_cleanup' | 'set_retention' | 'set_permanent' | 'discard'), `retention?`, `permanent?`, `confirmDirty?`, `rollbackPreview?`。
- **`ListManagedWorktreesInput`** (`src/index.ts:67`): 列表查询输入，包含 `projectId?`, `needsAttention?`, `checkoutId?`, `includeDiagnostics?`。
- **`PruneMergedBranchesInput`** (`src/index.ts:74`): 修剪输入，包含 `dryRun?`, `olderThanDays?`。
- **`MergeBranchForSessionInput`** (`src/index.ts:82`): 合并输入，包含 `sourceBranch`, `dryRun?`, `direction?` ('forward' | 'reverse')。
- **`MarkReadyForReviewInput`** (`src/index.ts:90`): 准备审查输入，包含 `detailsMarkdown?`, `summary`, `validationStatus`, `validationSummary?`, `tests`, `suggestedCommitMessage`。
- **`IsolatedTargetLaunch`** (`src/index.ts:102`): 隔离目标启动数据，包含 `targetSessionId`, `managedRoot`, `target` (`SessionTargetView`)。
- **`SessionCheckoutModule`** (`src/index.ts:107`): 核心模块接口。主要方法包括：
    - `inspect(sessionId)`: 检查会话目标。
    - `runtimeContext(sessionId)`: 同步注册表快照，用于回放稳定。
    - `preflight?`, `preflightPreviewRecovery?`: 只读预检。
    - `runExclusiveSessionMutation<T>`: 独占锁下的跨模块突变。
    - `bind`, `createIsolatedTarget`, `beginNextIteration`, `resumeRevision`, `prepareReviewRegeneration`, `preparePreviewRecoveryAnalysis`, `createPreviewRecoveryHandoff`, `markReadyForReview`, `operate`: 核心工作流操作。
    - `isAutoDeliverEnabled()`: 检查自动交付开关。
    - `listManagedWorktrees`, `listManagedWorktreesForSession`: 列出托管 worktree。
    - `pruneMergedBranchesForSession`, `autoPruneStaleMergedBranches`: 修剪已合并分支。
    - `mergeBranchForSession`: 合并会话分支。
    - `listAbandonedWorktreeSnapshots`, `restoreAbandonedWorktreeSnapshot`: Codex 对齐的放弃快照管理。
    - `manageManagedWorktreeForSession`, `inspectManagedWorktreeCleanup`, `bulkCleanupManagedWorktrees`, `manageManagedWorktree`: 管理工作流。
    - `resolveManagedRoot`, `observeManagedCheckout`, `observeManagedCheckouts`: 根路径解析与观察。
    - `cleanupExpiredRetained`, `enforceWorktreeKeepCount`: 清理过期保留与强制执行数量限制。
    - `reconcile`: 启动收敛。

### 配置模式 (src/index.ts:222-270)

使用 `@deepseek-ai/schemastery` (`z.object`) 定义 `Config`：
- **`stateDir`** (`src/index.ts:230`): 插件状态目录。默认 `$DSH_HOME/plugins/dsh-git-worktree`，回退到 `~/.dsh/plugins/dsh-git-worktree`。非 volatile。
- **`gitTimeoutMs`** (`src/index.ts:234`): volatile。Git 操作超时毫秒数。默认 `DEFAULT_GIT_TIMEOUT_MS`，范围 1,000–MAX_GIT_TIMEOUT_MS。
- **`worktreeAddTimeoutMs`** (`src/index.ts:235`): volatile。添加 worktree 超时。默认 300,000ms。
- **`autoDeliver`** (`src/index.ts:242`): volatile。代理自主交付开关。默认 `true`。
- **`autoPush`** (`src/index.ts:248`): volatile。Finish 后自动 push。默认 `true`。
- **`worktreesRoot`** (`src/index.ts:254`): volatile。受管 worktree 根目录。格式 `<worktreesRoot>/<project>/<topic>-<YYYYMMDD>`。
- **`inheritLocalChanges`** (`src/index.ts:261`): volatile。Codex 对齐，创建时继承本地未提交修改。默认 `true`。
- **`worktreeKeepCount`** (`src/index.ts:268`): volatile。托管 worktree 总量上限 (LRU)。默认 15，范围 0–500。0 关闭。
- **`enableWorkspaceProvider`** (`src/index.ts:275`): 接管官方 ui-workspace 的开关。默认 `false`；仅对 legacy 宿主（0.1.x）生效——modern 宿主（0.2.x）自动接管（decorated 路径在 0.2.x 结构性必崩），flag 在 modern 上仅 advisory。非 volatile。

辅助函数：
- **`volatile<T>`** (`src/index.ts:217`): 给 schema 注入 `meta.volatile = true`。
- **`resolveWorktreesRootValue`** (`src/index.ts:281`): 解析 `worktreesRoot` 配置值（处理 LiveValue）。
- **`resolveStateDir`** (`src/index.ts:286`): 解析 `stateDir`。

### apply() 装配序列 (src/index.ts:299-380)

**`apply(ctx: Context, config)`** (`src/index.ts:299`): 插件挂载入口。
1. 校验 Git 超时 (`validateGitTimeouts`)。
2. 挂载 Workspace Provider 生命周期 (`mountWorkspaceProviderLifecycle`)：legacy 宿主严格 opt-in (`config.enableWorkspaceProvider === true`)，modern 宿主自动接管（flag 仅 advisory）。
3. 创建 `stateDir` 和 `disabled-git-hooks` 目录。
4. 组装端口：
    - `createDshLookupPort(ctx)`
    - `new ProjectSkillStore(join(stateDir, 'project-skills'))`
    - `createDshGitPort(ctx, ...)`
    - `createNodeFilesPort()`
    - `new AtomicJsonCheckoutRegistry(...)`
5. 挂载项目技能提供者 (`mountProjectSkillProvider`)。
6. 创建核心模块 `createSessionCheckoutModule`，传入端口、应用引擎、配置（autoDeliver, autoPush, inheritLocalChanges, worktreeKeepCount, worktreesRoot）。
7. 初始化控制台服务 `WorktreeConsoleService`。
8. 注册工具 (`registerTools`)、命令 (`registerWorktreeCommand`)、上下文 (`registerSessionTargetContext`)。
9. 启动收敛：监听 `ready` 事件，调用 `module.reconcile()` 和 `module.enforceWorktreeKeepCount()`。
10. 保留期维护定时器：每 15 分钟 (`RETENTION_MAINTENANCE_INTERVAL_MS`) 调用 `cleanupExpiredRetained` 和 `enforceWorktreeKeepCount`。
11. 自动修剪定时器：首次运行延迟 60 秒 (`AUTO_PRUNE_FIRST_RUN_DELAY_MS`)，之后每 24 小时 (`AUTO_PRUNE_INTERVAL_MS`) 调用 `autoPruneStaleMergedBranches(AUTO_PRUNE_OLDER_THAN_DAYS)`。
12. `ctx.effect` 清理所有定时器和监听器。

### 模型工具 (src/tools.ts)

**`registerTools(ctx, module)`** (`src/tools.ts:34`): 注册 9 个模型工具，均包裹在 `withHostLanguage` 中。

1.  **`worktree_create`** (`src/tools.ts:48`): 创建隔离目标。参数 `topic?`。调用 `module.createIsolatedTarget`。返回 `{kind: 'worktree_target_created', checkoutId, targetSessionId, managedRoot, phase, currentOid, sourceSessionId}`。
2.  **`worktree_list`** (`src/tools.ts:106`): 列出当前会话可见的托管 worktree。调用 `module.listManagedWorktreesForSession`。返回 `{kind: 'worktree_list', worktrees: [...]}`。
3.  **`worktree_resume_revision`** (`src/tools.ts:162`): 恢复未同步的审查。仅当 `delivery.state === 'ready_for_review'` 时可用。调用 `module.resumeRevision`。返回 `{kind: 'worktree_revision_resumed', ...}`。
4.  **`worktree_begin_next_iteration`** (`src/tools.ts:210`): 开始新的同会话迭代。调用 `module.beginNextIteration`。返回 `{kind: 'worktree_next_iteration_started', ...}`。
5.  **`worktree_ready_for_review`** (`src/tools.ts:251`): 标记为待审查。参数 `summary`, `details?`, `validationStatus`, `validationSummary?`, `tests`, `suggestedCommitMessage`。调用 `module.markReadyForReview`。返回 `{kind: 'worktree_ready_for_review', state, reviewId, revision, iteration, changedFiles}`。
6.  **`worktree_deliver`** (`src/tools.ts:340`): 交付工作树。仅在 `isAutoDeliverEnabled()` 开启时可用。参数 `commitMessage?`, `retention?`, `report?`。如果处于 `ready_for_review` 态，自动携带 `expectedReviewId` 并使用 `suggestedCommitMessage`。调用 `module.operate({action: 'finish', ...})`。返回 `{kind: 'worktree_delivered', state, commitOid?, changedFiles, cleanup, push?, report?}`。
7.  **`worktree_cleanup`** (`src/tools.ts:428`): 清理已交付/保留的 worktree。参数 `checkoutId`, `expectedRevision`。调用 `module.manageManagedWorktreeForSession(action: 'cleanup_retained')`。返回 `{kind: 'worktree_cleanup', ...}`。
8.  **`worktree_prune_branches`** (`src/tools.ts:475`): 修剪已合并的本地分支。参数 `dryRun?`, `olderThanDays?`。调用 `module.pruneMergedBranchesForSession`。返回 `{kind: 'worktree_prune_branches', dryRun, headBranch?, pruned[], skipped[]}`。
9.  **`worktree_merge`** (`src/tools.ts:538`): 合并会话分支到 Local。参数 `sourceBranch`, `dryRun?`, `direction?`。调用 `module.mergeBranchForSession`。返回 `{kind: 'worktree_merge', direction, dryRun, sourceBranch, localBranch?, targetBranch?, type, mergedFiles?, conflictingFiles?, conflictDetails?, reason?}`。

### 用户命令 (src/commands.ts)

**`registerWorktreeCommand(ctx, module)`** (`src/commands.ts:42`): 注册 `/worktree` 命令。

动词及行为：
-   **`status`**: 调用 `module.inspect`，返回目标文本。
-   **`list`**: 调用 `module.listManagedWorktreesForSession`，返回列表。
-   **`continue`**: 如果当前是 `ready_for_review`，调用 `module.resumeRevision`。
-   **`next`**: 调用 `module.beginNextIteration`。
-   **`finalize [<reviewId> <revision>] [retention]`**: CAS 校验后执行 `finish`。`retention` 默认为 `cleanup`。
-   **`finish <message>`**: 直接执行 `finish` 操作。
-   **`discard`**: 执行 `discard`，`confirmDirty: true`，如果是 `preview_active` 则 `rollbackPreview: true`。
-   **`remove <checkoutId>`**: 通过 `manageManagedWorktreeForSession(action: 'discard')` 移除指定 checkout。

### 会话目标上下文 (src/session-target-context.ts)

**`registerSessionTargetContext(ctx, module)`** (`src/session-target-context.ts:13`): 通过 `ctx.inject(['systemPrompt'])` 注册 `git-worktree:session-target` 上下文片段 (order 118)。同步调用 `module.runtimeContext(sessionId)` 提供回放稳定的上下文，不执行 I/O。

### Host 兼容探测 (src/host-compat.ts)

-   **`WorkspaceClientFlavor`** (`src/host-compat.ts:6`): 类型 `'legacy' | 'alpha' | 'next' | 'modern' | 'unsupported'`。
-   **`workspaceClientFlavorForAgentVersion`** (`src/host-compat.ts:8`): 版本映射函数。四个精确锚点（0.1.2-rc.1→legacy、0.1.6-alpha.2→alpha、0.1.7-rc.2→next、0.2.0-rc.2→modern）之外，`0.2.x` 系未列版本兜底 `modern`（modern 分支消费的宿主服务与槽位契约已对照 0.2.1-alpha.1 宿主源码验证未变）；`0.1.x`（三种 flavor 并存）与 `0.3+`（未经源码验证）的未知版本保持 `unsupported`。
-   **`isModernGeneration`** (`src/host-compat.ts:22`): 0.2.x 兜底判定的主次版本匹配。
-   **`agentVersionFromAnchor`** (`src/host-compat.ts:27`): 从文件锚点读取 `@deepseek-ai/dsh-agent/package.json` 获取版本号。
-   **`workspaceFlavorDiagnostics`** (`src/host-compat.ts:60`): 诊断函数，按 `[entry, cwd, plugin]` 顺序探测锚点，返回 flavor 和探针详情。
-   **`hostWorkspaceClientFlavor`** (`src/host-compat.ts:74`): 返回当前宿主 flavor。

### i18n (src/i18n/host.ts)

-   **`currentHostLanguage`** (`src/i18n/host.ts:9`): 从 `AsyncLocalStorage` 获取当前语言，默认 'zh'。
-   **`withHostLanguage`** (`src/i18n/host.ts:12`): 在指定语言上下文中执行操作。
-   **`languageFromSettings`** (`src/i18n/host.ts:16`): 从 settings 缝隙读取语言偏好。
-   **`languageForInvocation`** (`src/i18n/host.ts:26`): 优先使用 Agent 上下文中的语言。
-   **`hostMessage`** (`src/i18n/host.ts:31`): 翻译函数，使用 `createTranslator`。

## Architecture

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                         Plugin Entry (index.ts)                         │
│                                                                         │
│  apply(ctx, config) ───────────────────────────────────────►            │
│  ├─ mountWorkspaceProviderLifecycle (legacy opt-in / modern auto)      │
│  ├─ Create Ports: lookup, git, files, registry, skills                 │
│  ├─ createSessionCheckoutModule (core state machine)                   │
│  ├─ WorktreeConsoleService (RPC control plane)                         │
│  ├─ registerTools (model-facing)                                       │
│  ├─ registerWorktreeCommand (human-facing)                             │
│  └─ registerSessionTargetContext (system prompt injection)             │
│                                                                         │
│  Startup & Maintenance Timers:                                         │
│  ├─ ready event → reconcile + enforceWorktreeKeepCount                 │
│  ├─ setInterval (15m) → cleanupExpiredRetained + enforce...            │
│  └─ setInterval (24h) → autoPruneStaleMergedBranches                   │
└─────────────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
       ┌────────────┐  ┌────────────┐  ┌────────────┐
       │  Tools      │  │  Commands   │  │  Context   │
       │ (tools.ts)  │  │ (cmds.ts)   │  │ (ctx.ts)   │
       │             │  │             │  │            │
       │ worktree_   │  │ /worktree   │  │ session-   │
       │ create      │  │ status/list │  │ target     │
       │ list        │  │ continue/   │  │ runtime    │
       │ resume      │  │ next/       │  │ context    │
       │ begin_iter  │  │ finalize/   │  │            │
       │ ready_review│  │ finish/     │  │            │
       │ deliver     │  │ discard/    │  │            │
       │ cleanup     │  │ remove      │  │            │
       │ prune       │  │             │  │            │
       │ merge       │  │             │  │            │
       └────────────┘  └────────────┘  └────────────┘
```

## Data Flow

1.  **Initialization**: `apply` is called with configuration. It resolves paths, creates directories, and initializes ports (Git, File, Registry). The `SessionCheckoutModule` is created with these ports.
2.  **Registration**: Tools, Commands, and System Prompt Context are registered with the Cordis context.
3.  **Runtime**:
    *   **Model Interaction**: Agents call tools via `ctx.tools`. Tools validate inputs, check state (e.g., `isAutoDeliverEnabled`), and invoke `SessionCheckoutModule` methods. Results are rendered to JSON.
    *   **Human Interaction**: Users invoke `/worktree` commands. The command handler parses verbs and arguments, calls `SessionCheckoutModule`, and returns human-readable text.
    *   **Context Injection**: During assembly, `registerSessionTargetContext` injects a system prompt snippet that calls `module.runtimeContext(sessionId)` synchronously.
4.  **Maintenance**:
    *   On `ready` event, `reconcile` runs to fix stale/orphaned worktrees.
    *   Periodic timers run `cleanupExpiredRetained`, `enforceWorktreeKeepCount`, and `autoPruneStaleMergedBranches`.

## Connections

*   [[session-checkout-module]]: Core state machine and business logic.
*   [[session-checkout-apply]]: Apply engine for file changes.
*   [[console-host]]: RPC control plane for sidebar diagnostics.
*   [[adapters]]: Git, File, Lookup, and Registry adapters.
*   [[volatile-settings-live-config]]: Mechanism for volatile config fields.