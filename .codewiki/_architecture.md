---
title: dsh-git-worktree 系统总览
type: architecture
source_files:
  - src/index.ts
  - src/types.ts
  - src/ports.ts
  - src/commands.ts
  - src/tools.ts
  - src/commit-message.ts
  - src/concurrent-session-guard.ts
  - src/console-contract.ts
  - src/checkpoint.ts
  - src/creation-failure.ts
  - src/delivery-excludes.ts
  - src/host-compat.ts
  - src/managed-worktree-path.ts
  - src/session-checkout-apply.ts
  - src/session-target-context.ts
  - src/workspace-provider-lifecycle.ts
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
  - src/console-host/control-plane.ts
  - src/console-host/errors.ts
  - src/console-host/projection.ts
  - src/console-host/review-diff.ts
  - src/console-host/service.ts
  - src/console-remote/descriptors.ts
  - src/console-remote/remote.ts
  - src/console-remote/schemas.ts
  - src/i18n/core.ts
  - src/i18n/host-messages.ts
  - src/i18n/host.ts
  - src/client/WorktreeCreateRow.tsx
  - src/client/WorktreeReviewRow.tsx
  - src/client/actions.ts
  - src/client/console-remote/adapter.ts
  - src/client/console-remote/index.ts
  - src/client/harness-platform.d.ts
  - src/client/i18n.tsx
  - src/client/index.tsx
  - src/client/model.ts
  - src/client/pre-session/PreSessionWorktreeToggle.tsx
  - src/client/pre-session/controller.ts
  - src/client/pre-session/harness-input.ts
  - src/client/pre-session/index.tsx
  - src/client/review-console/DeliveryProof.tsx
  - src/client/review-console/PreflightStatus.tsx
  - src/client/review-console/ReviewActions.tsx
  - src/client/review-console/ReviewDetailsModal.tsx
  - src/client/review-console/ReviewIcon.tsx
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
  - src/client/workspace-sidebar/index.tsx
  - src/client/workspace-sidebar/model.ts
  - lib/index.js
  - lib/ports.js
  - lib/ports.d.ts
  - lib/types.d.ts
  - lib/adapters/files.js
  - lib/adapters/git-options.js
  - lib/adapters/git.js
  - lib/adapters/git.d.ts
  - lib/adapters/initial-commit.js
  - lib/adapters/lookup.js
  - lib/adapters/project-skill-io.js
  - lib/adapters/project-skill-provider.js
  - lib/adapters/project-skills.js
  - lib/adapters/registry.js
  - lib/adapters/safe-file.js
  - lib/adapters/working-directory.js
  - lib/adapters/worktree-creation.js
  - lib/checkpoint.js
  - lib/commit-message.js
  - lib/concurrent-session-guard.js
  - lib/console-contract.js
  - lib/console-contract.d.ts
  - lib/console-host/control-plane.js
  - lib/console-host/errors.js
  - lib/console-host/projection.js
  - lib/console-host/review-diff.js
  - lib/console-host/service.js
  - lib/console-remote/descriptors.js
  - lib/console-remote/schemas.js
  - lib/creation-failure.js
  - lib/delivery-excludes.js
  - lib/host-compat.js
  - lib/i18n/core.js
  - lib/i18n/host.js
  - lib/i18n/host-messages.js
  - lib/managed-worktree-path.js
  - lib/session-checkout-apply.js
  - lib/session-target-context.js
  - lib/tools.js
  - lib/commands.js
  - lib/workspace-provider-lifecycle.js
  - lib/client/index.js
  - lib/client/i18n.js
  - lib/client/model.js
  - lib/client/actions.js
  - lib/client/WorktreeCreateRow.js
  - lib/client/WorktreeReviewRow.js
  - lib/client/console-remote/adapter.js
  - lib/client/console-remote/index.js
  - lib/client/pre-session/controller.js
  - lib/client/pre-session/PreSessionWorktreeToggle.js
  - lib/client/pre-session/harness-input.js
  - lib/client/pre-session/index.js
  - lib/client/review-console/DeliveryProof.js
  - lib/client/review-console/PreflightStatus.js
  - lib/client/review-console/ReviewActions.js
  - lib/client/review-console/ReviewDetailsModal.js
  - lib/client/review-console/ReviewIcon.js
  - lib/client/review-console/WorktreeReviewPanel.js
  - lib/client/review-console/index.js
  - lib/client/review-console/preflight-cache.js
  - lib/client/review-console/preview-recovery-cache.js
  - lib/client/review-console/recovery-continuation.js
  - lib/client/review-console/request-cache.js
  - lib/client/review-console/status-events.js
  - lib/client/settings-card/WorktreeSettingsCard.js
  - lib/client/settings-card/form-model.js
  - lib/client/settings-card/index.js
  - lib/client/settings-card/worktree-settings-card.js
  - lib/client/target-console/BranchGraphModal.js
  - lib/client/target-console/TagManagerModal.js
  - lib/client/target-console/TargetStatusAction.js
  - lib/client/target-console/WorktreeConsoleView.js
  - lib/client/target-console/WorktreeHeroChip.js
  - lib/client/target-console/WorktreeManagerModal.js
  - lib/client/target-console/WorktreeReviewStatus.js
  - lib/client/target-console/branch-overview-cache.js
  - lib/client/target-console/current-polling.js
  - lib/client/target-console/index.js
  - lib/client/workspace-sidebar/index.js
  - lib/client/workspace-sidebar/model.js
  - tests/adapters-safe-file.test.ts
  - tests/client-actions.test.ts
  - tests/client-branch-overview-cache.test.ts
  - tests/client-bundle.test.ts
  - tests/client-conflict-display.test.tsx
  - tests/client-console-remote-routing.test.ts
  - tests/client-i18n.test.tsx
  - tests/client-polling-diagnostic.test.tsx
  - tests/client-pre-session.test.tsx
  - tests/client-preview-recovery-cache.test.ts
  - tests/client-recovery-continuation.test.ts
  - tests/client-review-console.test.tsx
  - tests/client-review-details.test.tsx
  - tests/client-settings-card.test.tsx
  - tests/client-target-console.test.tsx
  - tests/client-toolview.test.tsx
  - tests/client-workspace-sidebar-actions.test.ts
  - tests/client-workspace-sidebar-model.test.ts
  - tests/client-workspace-sidebar-profile.test.ts
  - tests/client-workspace-sidebar-status.test.tsx
  - tests/client-workspace-sidebar.test.tsx
  - tests/concurrent-session-guard.test.ts
  - tests/console-contract.test.ts
  - tests/console-host.test.ts
  - tests/console-remote.test.ts
  - tests/current-polling.test.ts
  - tests/dev-dsh.test.ts
  - tests/git-creation-lifecycle.test.ts
  - tests/git-tags.test.ts
  - tests/git-timeouts.test.ts
  - tests/git-unborn.test.ts
  - tests/host-i18n.test.ts
  - tests/host-locale-context.test.ts
  - tests/host-query-budget.test.ts
  - tests/i18n-catalogs.test.ts
  - tests/i18n-references.test.ts
  - tests/lookup.test.ts
  - tests/official-workspace-client-next.mock.ts
  - tests/official-workspace-client.mock.ts
  - tests/project-skill-provider.test.ts
  - tests/project-skills-race.test.ts
  - tests/project-skills.test.ts
  - tests/session-branch-adopt.test.ts
  - tests/session-branch-delivery.test.ts
  - tests/session-branch-label.test.ts
  - tests/session-checkout-apply.test.ts
  - tests/session-checkout-module.test.ts
  - tests/surface.test.ts
  - tests/support/official-client.ts
  - tests/support/production-adapters.ts
  - tests/support/review-actions-harness.tsx
  - tests/support/ui-primitives.tsx
  - tests/support/worktree-console.ts
  - tests/working-directory-adapter.test.ts
  - tests/workspace-provider-lifecycle.test.ts
  - tests/worktree-creation.test.ts
tags: [git-worktree, dsh-plugin, session-checkout, rpc, react, i18n, architecture, overview]
---

## Overview

`dsh-git-worktree` 是一个运行在 DSH（DeepSeek Harness / Cordis 宿主）之上的受管 Git Worktree（"Isolated Checkout"）系统插件。其领域核心（状态机、`session-checkout-apply` 引擎、ports 接口）从 Domi 的 `session-checkout` 域移植而来且与宿主无关（`src/index.ts` 3-10 行模块注释，`lib/index.js` 顶层说明），本插件在此之上补齐三层 DSH 适配：

1. **Host 侧**：`src/index.ts` 的 `apply()`（358-459 行 / `lib/index.js` 对应）把端口适配器（git/files/registry/lookup）、应用引擎、模型工具（`tools.ts`/`tools.js`）、人类命令（`commands.ts`/`commands.js`）、系统提示上下文（`session-target-context.ts`）和 RPC 服务（`console-host/service.ts`）组装到 Cordis Context 上。
2. **RPC 契约层**：`src/console-contract.ts`（及 `lib/console-contract.js`）定义 JSON-only DTO；`src/console-remote/`（及 `lib/console-remote/`）定义 Typert strict schema + 描述符；`src/console-host/`（及 `lib/console-host/`）是服务端控制面。
3. **Web 客户端**：`src/client/`（及 `lib/client/`）用 React 实现 ToolView 回放卡、验收 Dock、目标胶囊、分支图/标签管理、侧栏投影、设置卡与空白会话 "Start in a Worktree" 流。

持久化只有两处：`stateDir/managed-checkouts.json`（v2 原子 JSON 注册表，`src/adapters/registry.ts` / `lib/adapters/registry.js`）与 Git 内部 ref 命名空间 `refs/dsh-worktree/session-checkouts/<sha256前24>`、`refs/dsh-worktree/abandoned/<checkoutId>`（`src/adapters/git.ts` / `lib/adapters/git.js`）。测试套件（`tests/`）覆盖 Host 域、Client 域与平台适配器域（见 `tests.md` Overview）。

## System Overview

```text
┌──────────────────────────────── DSH Host (Cordis ctx) ────────────────────────────────┐
│  src/index.ts :: apply() 组装全部子系统 (358-459) / lib/index.js apply()                │
└───────┬───────────────────────┬───────────────────────┬───────────────────┬───────────┘
        ▼                       ▼                       ▼                   ▼
┌────────────────┐    ┌──────────────────────┐  ┌─────────────┐  ┌──────────────────────┐
│ adapters/      │───►│ session-checkout-     │◄─│ tools.ts    │  │ console-host/        │
│ git/files/     │    │ apply.ts (引擎)       │  │ commands.ts │  │ service.ts (@Remote) │
│ registry/      │    │ (src 4 / lib 领域核心)│  └─────────────┘  └──────────┬───────────┘
│ lookup/ports   │    └──────────────────────┘                             │ Typert RPC
└───────▲────────┘ ┌────────────────────────────────┐ ┌──────────────────────┐ │
        │ ports.ts  │ 持久化: managed-checkouts.json │ │ console-remote/      │◄┘
        │ (接口)    │ (v2 原子) + refs/dsh-worktree/ │ │ schemas/descriptors  │
        └──────────┤ (git.ts)                       │ └───────────┬───────────┘
                   └────────────────────────────────┘            ▼
                                                          ┌──────────────────────┐
                                                          │ client/ (React UI)   │
                                                          │ src/client/*         │
                                                          └──────────────────────┘
```

**各区域职责**：
- **Host 装配层**（`src/index.ts` / `lib/index.js`）：读取 volatile 配置、建 stateDir、挂载 WorkspaceProvider 生命周期、装配端口与引擎、启动 `WorktreeConsoleService`、注册工具/命令/上下文、安排 reconcile 与定时保留/剪枝。
- **端口与适配器层**（`src/adapters/` / `lib/adapters/`）：用 Node fs、`ctx.subprocess`、宿主 `workspaceRegistry`/`sessions`/`workingDirectory` 实现 `ports.ts` 定义的宿主无关接口；含崩溃安全注册表（`registry.ts`/`safe-file.ts`）、Project Skills 搬运、worktree 创建与失败回滚（`worktree-creation.ts`）。
- **领域引擎层**（`src/session-checkout-apply.ts` / `lib/session-checkout-apply.js`）：`DefaultSessionCheckoutApplyEngine` 实现快照指纹、三方合并、Local 预览/回滚/终审、checkpoint、会话分支交付 `commitIsolated`；只依赖端口接口。
- **服务面层**（`src/tools.ts`、`src/commands.ts`、`src/console-host/` / `lib` 对应）：模型工具、`/worktree` 命令、控制台宿主 RPC 与控制面（授权、投影、review-diff）。
- **RPC 契约层**（`src/console-contract.ts`、`src/console-remote/` / `lib` 对应）：JSON-only 共享契约 + Typert strict 描述符，是 Host/Client 唯一共享面。
- **Web 客户端层**（`src/client/` / `lib/client/`）：React ToolView、评审控制台、目标胶囊、空白会话预创建、侧栏投影与设置页。

## Data Flow

```text
┌──────────┐ worktree_create ┌───────────────┐ createDetachedWorktree ┌──────────────────┐
│ tools.ts│─────────────────►│ module        │──────────────────────►│ git.ts /         │
│ (94-693)│ (100-166)        │ (index.ts)    │ (git.ts)               │ worktree-creation│
└──────────┘                 └───────┬───────┘                       │                  │
       │ enterCheckout (148)         │ createIsolatedTarget          └──────────────────┘
       ▼                            ▼                                       │
┌──────────┐ ready_for_review ┌───────────────┐ inspectReview         ┌──────────────────┐
│ client   │─────────────────►│ control-plane │─────────────────────►│ engine           │
│ UI       │ (ReviewActions) │               │ (1421-1470)           │ (apply/preview)  │
└──────────┘                 └───────┬───────┘                       └──────────────────┘
       │ adapter.invoke              │ authorize/verifyCallerRoot
       ▼                             ▼
┌──────────┐ Typert RPC      ┌──────────────────┐  observeFromCaller ┌──────────────────┐
│ remote   │────────────────►│ console-host/     │──────────────────►│ projection.ts    │
│ adapter  │                 │ service.ts        │                   │                  │
└──────────┘                 └──────────────────┘                   └──────────────────┘
       ▲                                                                 │
       │ sidebarTopology/current polling (current-polling.ts)           │
       └───────────────────────────────────────────────────────────────┘
```

**关键数据流路径**（引用模块文章行号）：
1. **创建（Local → Isolated）**：`worktree_create`（`src/tools.ts` 100-166）→ `module.createIsolatedTarget` → `createDetachedWorktree`（`src/adapters/git.ts`）→ `createWorktree`（`src/adapters/worktree-creation.ts`：排他 mkdir → `worktree add --detach --no-checkout --lock` → `read-tree` + `checkout-index --all` → 双重 `verifyIdentity` → `unlock`）→ `attachWorktreeBranch`（`src/adapters/git.ts`）→ `enterCheckout`（`src/tools.ts` 148）。
2. **编辑 → 评审**：`worktree_ready_for_review`（`src/tools.ts` 318-403）→ `markReadyForReview` → 引擎 `inspectReview`（`src/session-checkout-apply.ts` 1421-1470）→ 记录 `delivery = ready_for_review`、`revision++`；`checkpointGenerationForRecord`（`src/checkpoint.ts` 16-28）派生 CAS generation。
3. **预览 / 交付（两条互斥路径）**：Local Preview 走 `ReviewActions.previewLocal` → 控制面 `preview`（`src/console-host/control-plane.ts`）→ 引擎 `plan`（1614-1616）+`preview`（1818-1958）；回滚 `rollback`（1988-2091），确认 `finalize`（2093-2367）。会话分支路径：`worktree_deliver`（`src/tools.ts` 405-506）→ 引擎 `commitIsolated`（1521-1608，**完全不读写 Local**）→ 清理/`pushBranch`。
4. **放弃与恢复**：`discard` 前 `snapshotAbandonedWorktree`（`src/adapters/git.ts`）→ `refs/dsh-worktree/abandoned/<checkoutId>`；恢复 `restoreAbandonedSnapshot`（`src/adapters/git.ts`）。
5. **控制台读路径（轮询）**：`TargetStatusAction` → `subscribeCurrent`（`src/client/target-console/current-polling.ts`，5s 可见/60s 隐藏）→ `adapter.current` → RPC → `control-plane.current` → `projectDetails`（`src/console-host/projection.ts`）→ 渲染；评审面共享 `request-cache.ts` 单飞缓存与 `WORKTREE_REVIEW_REFRESH_EVENT` 失效广播。
6. **恢复请求队列（Client→Agent）**：冲突/评审过期 → `enqueueWorktreeRecovery`（`src/client/review-console/recovery-continuation.ts`）→ localStorage 持久化 → `attempt` 在 owner 会话 open/idle 且 target 精确匹配时发送重建 prompt；Host 端每次发送前重新 `inspect` 验证。

## Dependency Graph

```text
┌────────────────────────┐   depends on    ┌────────────────────────┐
│ domain engine          │───────────────►│ ports.ts (宿主无关接口)│
│ session-checkout-apply │                │ lib/ports.d.ts         │
│ src 4 / lib 领域核心   │                └───────────▲────────────┘
└────────────────────────┘                            │ implemented by
                                                     │
┌────────────────────────┐  implements    ┌──────────┴────────────┐
│ adapters/ (git, files, │───────────────►│ Node fs / ctx.subprocess│
│ registry, lookup)      │                │ DSH workspaceRegistry │
└────────────────────────┘                └───────────────────────┘

┌────────────────────────┐  calls via     ┌────────────────────────┐
│ client/ (React)        │─ strict RPC ──►│ console-remote/        │
│ src/client/*           │                │ descriptors/schemas    │
└────────────────────────┘                └───────────▲────────────┘
                                                     │ served by
                                                     │
┌────────────────────────┐  uses          ┌──────────┴────────────┐
│ console-host/          │───────────────►│ control-plane.ts      │
│ service.ts             │                │ module (SessionCheckout│
└────────────────────────┘                │ Module 接口)          │
                                           └────────────────────────┘
```

**依赖方向约束**：
- **端口反转**：领域逻辑（apply 引擎、状态机）只依赖 `ports.ts`/`ports.d.ts` 接口；`adapters/` 提供 DSH 实现，因此可用 fake 测试（`src/ports.ts` 1-8 行注释，`lib/ports.js` 唯一运行时导出 `liveConfigValue`）。
- **单一 RPC 通道**：Client 永远通过 `WorktreeConsoleAdapter`（`console-contract.ts` 745-784）→ Typert strict 描述符（`console-remote/descriptors.ts`）→ `WorktreeConsoleService`（`console-host/service.ts`）→ 控制面 → 模块；Client 与 Host 是两份独立部署产物，schema 用 `default(false)` 等手段容忍增量（`console-remote/schemas.ts`）。
- **授权边界**：每个 Host 操作都解析精确 caller 会话并在执行时复验 project/owner/cwd/revision/review 身份（`console-contract.ts` 5-8 行注释）；`capabilities()` 投影只影响 UI 可见性，真实 mutation 都重新 CAS。
- **ref 命名空间隔离**：插件产物全部在 `refs/dsh-worktree/` 下，永不与用户 ref 冲突（`src/adapters/git.ts`）。
- **测试依赖**：`tests/support/production-adapters.ts` 与 `tests/support/worktree-console.ts` 分别提供 Node 生产依赖与确定性 Console 适配器夹具，被 Host/Client/平台测试复用（`tests.md` Key Components）。

## Module Roles

- **入口与配置**：`src/index.ts` / `lib/index.js` 定义 `SessionCheckoutModule` 接口（113-219 行 / `lib` 对应）、`Config`（261-319 / `lib` 对应）、`apply()`（358-459 / `lib` 对应）装配全部子系统；`volatile()` 使设置页编辑落到 `cordis.patch.yml` 且以 LiveValue 引用到达。
- **领域类型与错误码**：`src/types.ts` / `lib/types.d.ts` 定义 `SessionTargetRef`、`SessionCheckoutPhase`、`WorktreeDeliveryView` 七态、`SESSION_CHECKOUT_ERROR_CODES`（29 个稳定错误码）等。
- **端口接口**：`src/ports.ts` / `lib/ports.d.ts` / `lib/ports.js` 定义 `SessionCheckoutGitPort`、`SessionCheckoutFilesPort`、`SessionCheckoutLookupPort`、`ManagedCheckoutsRegistry` 与 `liveConfigValue` 统一读取。
- **应用引擎**：`src/session-checkout-apply.ts` / `lib/session-checkout-apply.js`（约 2678 行）实现 `DefaultSessionCheckoutApplyEngine`：`checkpoint`、`inspectReview`、`commitIsolated`、`preflight`/`plan`/`apply`、`preview`、`assessPreviewRecovery`、`rollback`、`finalize`、`finish` 等方法，负责快照指纹、三方合并与事务性写。
- **适配器**：
  - `adapters/files.ts` / `lib/adapters/files.js`：Node fs 文件端口（身份校验、隔离、删除重试）。
  - `adapters/git.ts` / `lib/adapters/git.js`：`ctx.subprocess` 支撑的 git 端口（ref 命名空间、inspect、worktree 创建/移除、分支/标签、merge、abandoned 快照）。
  - `adapters/git-options.ts` / `lib/adapters/git-options.js`：Git 超时校验与选择。
  - `adapters/initial-commit.ts` / `lib/adapters/initial-commit.js`：空仓库初始化协议。
  - `adapters/lookup.ts` / `lib/adapters/lookup.js`：会话/项目→Workspace 映射。
  - `adapters/project-skill-*.ts` / `lib/adapters/project-skill-*.js`：Project Skills 搬运与溯源存储。
  - `adapters/registry.ts` + `safe-file.ts` / `lib` 对应：v2 原子 JSON 注册表与崩溃安全读写。
  - `adapters/working-directory.ts` / `lib/adapters/working-directory.js`：会话 cwd 端口。
  - `adapters/worktree-creation.ts` / `lib/adapters/worktree-creation.js`：创建与失败回滚（最敏感安全代码）。
- **控制台 Host**：`src/console-host/`（errors/projection/control-plane/review-diff/service）实现 RPC 服务端控制面，含授权、投影、diff 限额与诊断。`control-plane.ts` 的 `createWorktreeConsoleControlPlane` 含 `verifyCallerRoot`、`authorize`、`observeFromCaller` 等内部函数与 39 个端点。
- **RPC 契约**：`src/console-contract.ts` + `src/console-remote/`（descriptors/schemas/remote）定义 JSON-only 共享契约、strict zod schema 与 Typert 描述符；`lib` 对应同名文件。
- **Web 客户端**：`src/client/`（及 `lib/client/`）含入口编排（`index.tsx`/`index.js`）、`console-remote/adapter`、actions/model/i18n、ToolView 行、review-console（验收动作巨组件 `ReviewActions.tsx`）、target-console（胶囊/管理面板/分支图/标签）、pre-session（空白会话流）、settings-card、workspace-sidebar（投影与徽章）。
- **工具与命令**：`src/tools.ts` / `lib/tools.js` 注册九个模型工具；`src/commands.ts` / `lib/commands.js` 注册 `/worktree` 人类命令（破坏性动词只给人用）。
- **i18n 与支撑**：`src/i18n/`（core/host/host-messages）提供 `withHostLanguage` 与约 370 键双语目录；`src/commit-message.ts`、`concurrent-session-guard.ts`、`checkpoint.ts`、`creation-failure.ts`、`delivery-excludes.ts`、`host-compat.ts`、`managed-worktree-path.ts`、`session-target-context.ts`、`workspace-provider-lifecycle.ts` 提供提交校验、分支竞态守卫、CAS generation、创建失败标记、交付排除、宿主代际探测、路径候选与 Workspace 选举。
- **测试套件**：`tests/` 下的 Host 域（`console-host.test.ts`、`session-checkout-module.test.ts` 等）、Client 域（`client-*.test.tsx`）、平台域（`git-*.test.ts`、`worktree-creation.test.ts` 等）与共享夹具（`support/`），完整覆盖三轨道（见 `tests.md`）。
