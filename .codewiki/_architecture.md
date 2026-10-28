---
title: dsh-git-worktree 系统总览
type: architecture
source_files:
  - scripts/check-publish.mjs
  - scripts/check-workspace-sidebar-version.mjs
  - scripts/clean-lib.mjs
  - scripts/dev-dsh.mjs
  - scripts/dev-dsh-lib.mjs
  - scripts/dsh-source-runner.mjs
  - scripts/workspace-sidebar-upstream.mjs
  - scripts/workspace-sidebar-upstream-next.mjs
  - scripts/workspace-sidebar-upstream-alpha.mjs
  - scripts/workspace-sidebar-upstream.d.mts
  - tests/dev-dsh.test.ts
  - tests/official-workspace-client.mock.ts
  - tests/official-workspace-client-next.mock.ts
  - tests/official-workspace-client-alpha.mock.ts
  - package.json
  - tsdown.config.ts
  - vitest.config.ts
  - cordis.patch.yml
  - src/index.ts
  - src/types.ts
  - src/ports.ts
  - src/session-checkout-apply.ts
  - src/checkpoint.ts
  - src/concurrent-session-guard.ts
  - src/console-contract.ts
  - src/creation-failure.ts
  - src/commit-message.ts
  - src/delivery-excludes.ts
  - src/host-compat.ts
  - src/managed-worktree-path.ts
  - src/workspace-provider-lifecycle.ts
  - src/session-target-context.ts
  - src/tools.ts
  - src/commands.ts
  - src/adapters/files.ts
  - src/adapters/git-options.ts
  - src/adapters/git.ts
  - src/adapters/initial-commit.ts
  - src/adapters/lookup.ts
  - src/adapters/registry.ts
  - src/adapters/safe-file.ts
  - src/adapters/working-directory.ts
  - src/adapters/worktree-creation.ts
  - src/adapters/project-skills.ts
  - src/adapters/project-skill-io.ts
  - src/adapters/project-skill-provider.ts
  - src/console-host/control-plane.ts
  - src/console-host/errors.ts
  - src/console-host/projection.ts
  - src/console-host/review-diff.ts
  - src/console-host/service.ts
  - src/console-remote/descriptors.ts
  - src/console-remote/remote.ts
  - src/console-remote/schemas.ts
  - src/client/index.tsx
  - src/client/model.ts
  - src/client/actions.ts
  - src/client/i18n.tsx
  - src/client/harness-platform.d.ts
  - src/client/WorktreeCreateRow.tsx
  - src/client/WorktreeReviewRow.tsx
  - src/client/console-remote/adapter.ts
  - src/client/console-remote/index.ts
  - src/client/pre-session/index.tsx
  - src/client/pre-session/controller.ts
  - src/client/pre-session/harness-input.ts
  - src/client/pre-session/PreSessionWorktreeToggle.tsx
  - src/client/review-console/index.ts
  - src/client/review-console/WorktreeReviewPanel.tsx
  - src/client/review-console/ReviewActions.tsx
  - src/client/review-console/ReviewDetailsModal.tsx
  - src/client/review-console/PreflightStatus.tsx
  - src/client/review-console/DeliveryProof.tsx
  - src/client/review-console/ReviewIcon.tsx
  - src/client/review-console/request-cache.ts
  - src/client/review-console/preflight-cache.ts
  - src/client/review-console/preview-recovery-cache.ts
  - src/client/review-console/recovery-continuation.ts
  - src/client/review-console/status-events.ts
  - src/client/settings-card/index.ts
  - src/client/settings-card/worktree-settings-card.ts
  - src/client/settings-card/form-model.ts
  - src/client/settings-card/WorktreeSettingsCard.tsx
  - src/client/target-console/index.ts
  - src/client/target-console/TargetStatusAction.tsx
  - src/client/target-console/WorktreeConsoleView.tsx
  - src/client/target-console/WorktreeManagerModal.tsx
  - src/client/target-console/BranchGraphModal.tsx
  - src/client/target-console/TagManagerModal.tsx
  - src/client/target-console/WorktreeHeroChip.tsx
  - src/client/target-console/WorktreeReviewStatus.tsx
  - src/client/target-console/branch-overview-cache.ts
  - src/client/target-console/current-polling.ts
  - src/client/workspace-sidebar/index.tsx
  - src/client/workspace-sidebar/model.ts
  - src/i18n/core.ts
  - src/i18n/host.ts
  - src/i18n/host-messages.ts
  - lib/index.js
  - lib/index.d.ts
  - lib/types.d.ts
  - lib/ports.d.ts
  - lib/ports.js
  - lib/console-contract.d.ts
  - lib/console-contract.js
  - lib/adapters/files.js
  - lib/adapters/git.js
  - lib/adapters/git.d.ts
  - lib/adapters/git-options.js
  - lib/adapters/git-options.d.ts
  - lib/adapters/initial-commit.js
  - lib/adapters/initial-commit.d.ts
  - lib/adapters/lookup.js
  - lib/adapters/lookup.d.ts
  - lib/adapters/project-skill-io.js
  - lib/adapters/project-skill-io.d.ts
  - lib/adapters/project-skill-provider.js
  - lib/adapters/project-skill-provider.d.ts
  - lib/adapters/project-skills.js
  - lib/adapters/project-skills.d.ts
  - lib/adapters/registry.js
  - lib/adapters/registry.d.ts
  - lib/adapters/safe-file.js
  - lib/adapters/working-directory.js
  - lib/adapters/worktree-creation.js
  - lib/checkpoint.js
  - lib/client.js
  - lib/client/WorktreeCreateRow.js
  - lib/client/WorktreeCreateRow.d.ts
  - lib/client/WorktreeReviewRow.js
  - lib/client/WorktreeReviewRow.d.ts
  - lib/client/actions.js
  - lib/client/actions.d.ts
  - lib/client/console-remote/adapter.js
  - lib/client/console-remote/index.js
  - lib/client/console-remote/index.d.ts
  - lib/client/i18n.js
  - lib/client/i18n.d.ts
  - lib/client/index.js
  - lib/client/index.d.ts
  - lib/client/model.js
  - lib/client/model.d.ts
  - lib/client/pre-session/PreSessionWorktreeToggle.js
  - lib/client/pre-session/PreSessionWorktreeToggle.d.ts
  - lib/client/pre-session/controller.js
  - lib/client/pre-session/controller.d.ts
  - lib/client/pre-session/harness-input.js
  - lib/client/pre-session/harness-input.d.ts
  - lib/client/pre-session/index.js
  - lib/client/pre-session/index.d.ts
  - lib/client/review-console/DeliveryProof.js
  - lib/client/review-console/PreflightStatus.js
  - lib/client/review-console/PreflightStatus.d.ts
  - lib/client/review-console/ReviewActions.js
  - lib/client/review-console/ReviewActions.d.ts
  - lib/client/review-console/ReviewDetailsModal.js
  - lib/client/review-console/ReviewDetailsModal.d.ts
  - lib/client/review-console/ReviewIcon.js
  - lib/client/review-console/WorktreeReviewPanel.js
  - lib/client/review-console/WorktreeReviewPanel.d.ts
  - lib/client/review-console/index.js
  - lib/client/review-console/preflight-cache.js
  - lib/client/review-console/preview-recovery-cache.js
  - lib/client/review-console/recovery-continuation.js
  - lib/client/review-console/recovery-continuation.d.ts
  - lib/client/review-console/request-cache.js
  - lib/client/review-console/request-cache.d.ts
  - lib/client/review-console/status-events.js
  - lib/client/settings-card/WorktreeSettingsCard.js
  - lib/client/settings-card/WorktreeSettingsCard.d.ts
  - lib/client/settings-card/form-model.js
  - lib/client/settings-card/form-model.d.ts
  - lib/client/settings-card/index.js
  - lib/client/settings-card/worktree-settings-card.js
  - lib/client/settings-card/worktree-settings-card.d.ts
  - lib/client/target-console/BranchGraphModal.js
  - lib/client/target-console/BranchGraphModal.d.ts
  - lib/client/target-console/TagManagerModal.js
  - lib/client/target-console/TagManagerModal.d.ts
  - lib/client/target-console/TargetStatusAction.js
  - lib/client/target-console/TargetStatusAction.d.ts
  - lib/client/target-console/WorktreeConsoleView.js
  - lib/client/target-console/WorktreeConsoleView.d.ts
  - lib/client/target-console/WorktreeHeroChip.js
  - lib/client/target-console/WorktreeHeroChip.d.ts
  - lib/client/target-console/WorktreeManagerModal.js
  - lib/client/target-console/WorktreeManagerModal.d.ts
  - lib/client/target-console/WorktreeReviewStatus.js
  - lib/client/target-console/WorktreeReviewStatus.d.ts
  - lib/client/target-console/branch-overview-cache.js
  - lib/client/target-console/current-polling.js
  - lib/client/target-console/index.js
  - lib/client/target-console/index.d.ts
  - lib/client/workspace-sidebar/index.js
  - lib/client/workspace-sidebar/index.d.ts
  - lib/client/workspace-sidebar/model.js
  - lib/client/workspace-sidebar/model.d.ts
  - lib/commands.js
  - lib/commit-message.js
  - lib/concurrent-session-guard.js
  - lib/concurrent-session-guard.d.ts
  - lib/console-host/control-plane.js
  - lib/console-host/control-plane.d.ts
  - lib/console-host/errors.js
  - lib/console-host/projection.js
  - lib/console-host/review-diff.js
  - lib/console-host/review-diff.d.ts
  - lib/console-host/service.js
  - lib/console-host/service.d.ts
  - lib/console-remote/descriptors.js
  - lib/console-remote/remote.d.ts
  - lib/console-remote/schemas.js
  - lib/creation-failure.js
  - lib/creation-failure.d.ts
  - lib/delivery-excludes.js
  - lib/host-compat.js
  - lib/host-compat.d.ts
  - lib/i18n/core.js
  - lib/i18n/host.js
  - lib/i18n/host-messages.js
  - lib/managed-worktree-path.js
  - lib/managed-worktree-path.d.ts
  - lib/session-checkout-apply.js
  - lib/session-checkout-apply.d.ts
  - lib/session-target-context.js
  - lib/tools.js
  - lib/workspace-provider-lifecycle.js
  - lib/workspace-provider-lifecycle.d.ts
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
  - tests/project-skill-provider.test.ts
  - tests/project-skills-race.test.ts
  - tests/project-skills.test.ts
  - tests/session-branch-adopt.test.ts
  - tests/session-branch-delivery.test.ts
  - tests/session-branch-label.test.ts
  - tests/session-checkout-apply.test.ts
  - tests/session-checkout-module.test.ts
  - tests/support/official-client.ts
  - tests/support/production-adapters.ts
  - tests/support/review-actions-harness.tsx
  - tests/support/ui-primitives.tsx
  - tests/support/worktree-console.ts
  - tests/surface.test.ts
  - tests/working-directory-adapter.test.ts
  - tests/workspace-provider-lifecycle.test.ts
  - tests/worktree-creation.test.ts
tags: [architecture, overview, dsh-git-worktree, git-worktree, system-design, scripts, src, lib, tests]
---

## Overview

`dsh-git-worktree` 是一个挂载在 DSH（DeepSeek Agent 宿主，基于 Cordis 框架）上的插件，为每个 Agent 会话提供“托管 Git Worktree（隔离检出）”：把会话的工作切进一个隔离检出，任务完成后经“Ready for Review →（可选 Local Preview）→ 交付（提交到会话分支）”的显式验收链路落地。整个仓库由四个逻辑模块组成，互为补充：

- **src/** 完整 TypeScript 源码（领域核心、适配器、Console 合同、Host 控制面、React Client、i18n）。
- **lib/** 由 src 编译得到的 JavaScript 运行时产物，被 DSH 宿主实际加载。
- **scripts/** 构建期 / 开发期 / 发布期门禁工具（清空产物、派生官方客户端、本地 harness、发布检查）。
- **tests/** Vitest 测试套件，覆盖 Host 域、Client UI、合同边界与脚本工作流。

本文档面向零上下文的未来 agent，提供系统级地图：各模块职责、相互连接、关键数据流与依赖方向。文中行号引用自对应模块文章（modules/scripts.md、modules/src.md、modules/lib.md、modules/tests.md）中记录的符号行号。

## System Overview

```text
┌──────────────────────────── src/ (TypeScript 源码) ────────────────────────────┐
│ 领域核心: index.ts types.ts ports.ts session-checkout-apply.ts                 │
│ 适配器:   adapters/git.ts adapters/registry.ts adapters/worktree-creation.ts   │
│ 合同:     console-contract.ts console-remote/{schemas,descriptors,remote}       │
│ Host:     console-host/{service,control-plane,projection,review-diff,errors}   │
│ Client:   client/* (React ToolView/侧栏/设置卡/预会话)                          │
│ i18n:     i18n/*  host-compat.ts  workspace-provider-lifecycle.ts               │
└───────────────────────────────┬───────────────────────────────────────────────┘
                                │ ① tsc 类型检查 + tsdown.config.ts 打包
                                ▼
┌──────────────────────────── lib/ (编译 JS 产物) ──────────────────────────────┐
│ 与 src 同构的 .js/.d.ts；运行时由 DSH Cordis 宿主加载                          │
│ apply()(lib/index.js) 装配 SessionCheckoutModule + Console 服务                 │
└───────┬───────────────────────────────┬───────────────────────────────────────┘
        │ ② 发布前门禁                    │ ③ 测试时由 vitest.config.ts 解析虚拟模块
        ▼                                ▼
┌────────────────── scripts/ (构建/开发/发布) ──────────────┐   ┌──────── tests/ ─────────────┐
│ clean-lib.mjs(1-7) 清空 lib/                              │   │ support/* 假体+真实 git 仓库 │
│ workspace-sidebar-upstream*.mjs 派生官方客户端(11-209)    │   │ Host/Client/合同 全覆盖      │
│ dev-dsh.mjs + dev-dsh-lib.mjs 本地 harness(19-98)        │   │ 回归产品 bug 写进注释        │
│ check-publish.mjs 7步检查(256) + sidebar-version(18)     │   └────────────┬───────────────────┘
└──────────────────────────┬───────────────────────────────┘                │ 导入 lib/src 验行为
                          │ 受 package.json(70-83) npm scripts 驱动          └──────────┬───────────┘
                          ▼                                                      │
                ┌──────────────────────────────────┐                             │
                │ cordis.patch.yml / tsdown.config.ts│◄────────────────────────────┘
                └──────────────────────────────────┘
```

**连接说明**：
- `src/` 经 `tsc` + `tsdown.config.ts` 编译为 `lib/`，两者保持目录与符号同构（`src/index.ts` → `lib/index.js` 等）。
- `scripts/` 在构建时通过 `tsdown.config.ts` 的虚拟模块（`virtual:dsh-official-workspace-client*`）注入由 `workspace-sidebar-upstream*.mjs` 派生的官方客户端源码；在发布前由 `package.json` 的 `prepublishOnly` 触发 `check-publish.mjs` 与 `check-workspace-sidebar-version.mjs` 做 fail-closed 校验。
- `tests/` 通过 `vitest.config.ts` 将同样的虚拟模块重定向到 `tests/official-workspace-client*.mock.ts`，直接导入 `lib/` 与 `src/` 验证行为，不依赖真实构建派生。

## Data Flow

```text
┌────────── Agent 模型调用 ──────────┐      ┌────────── 用户在 Web Client ──────────┐
│ tools.ts: worktree_create          │      │ ReviewActions.tsx → adapter           │
└────────────────┬──────────────────┘      └─────────────────┬─────────────────────┘
                 │                                          │
                 ▼                                          ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ SessionCheckoutModule (src/index.ts:113) ──► ApplyEngine (session-checkout-apply.ts)│
│    │                                   ▲                                         │
│    │ ports.ts 端口                      │ Typert RPC (@Remote)                     │
│    ▼                                   │                                         │
│ adapters/git.ts ──spawn git──► OS      │ console-host/service.ts ──► control-plane.ts│
└───────────────┬───────────────────────┬──────────────────────────────────────────┘
                ▼                       ▼
┌──────────────── managed-checkouts.json ─────────┐  ┌── 官方 Workspace 派生 ──────────┐
│ AtomicJsonCheckoutRegistry 写                    │  │ scripts/workspace-sidebar-upstream*.mjs│
└─────────────────────────────────────────────────┘  └───────────┬───────────────────┘
                                                                  ▼
                                                       lib/client.js (虚拟模块注入)
```

**主要流动**：
1. **创建流**：模型调 `worktree_create`（`src/tools.ts`）→ `module.createIsolatedTarget` → `adapters/worktree-creation.ts` 的 `createWorktree`（独占 mkdir + `worktree add --lock`）→ 写 `managed-checkouts.json` → `workingDirectory` 端口把会话 cwd 移入。
2. **评审/交付流**：`worktree_ready_for_review`（`src/tools.ts`）→ 引擎 `reviewIsolated`/`commitIsolated`（`src/session-checkout-apply.ts:1521`）提交到会话分支，完全不写 Local。
3. **Console 读取链**：客户端 `createWorktreeConsoleRemoteAdapter`（超时+strict parse）→ Typert RPC → `WorktreeConsoleService`（lib/console-host/service.js）→ `control-plane.ts` 授权投影 → zod schema 校验 → React 面板。
4. **构建流**：`package.json` 的 `build` 调 `clean-lib.mjs` 清空 `lib/` → `tsc` → `tsdown.config.ts` 解析虚拟模块并调用 `materializeOfficialWorkspaceClientModule()` 等将官方客户端派生嵌入 `lib/client.js`。

## Dependency Graph

```text
┌──────────────┐      ┌────────────────┐      ┌──────────────┐
│  scripts/    │─────►│ package.json   │◄─────│   tests/      │
│ (build/dev)  │      │ (npm scripts)  │      │ (vitest)     │
└──────┬───────┘      └───────┬────────┘      └──────┬───────┘
       │ derive               │ builds              │ imports
       ▼                      ▼                      ▼
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│ virtual mods │─────►│    src/      │─────►│    lib/      │
│ (official UI)│      │ (TypeScript) │      │ (JS runtime) │
└──────────────┘      └──────┬──────┘      └──────────────┘
                            │ depends
                            ▼
                     ┌──────────────┐
                     │ adapters/*   │
                     │ ports.ts     │
                     └──────────────┘
        ┌─────────────────────────────────────────┐
        │ client/* ──► console-remote/* ──► host/* │
        └─────────────────────────────────────────┘
```

**依赖方向**：
- `scripts/` 依赖 `package.json` 的 npm 脚本契约与 `tsdown.config.ts` / `vitest.config.ts`；其派生脚本读取钉住的官方包版本，但不进入运行时 `lib/` 的依赖图。
- `src/` 被编译为 `lib/`；`lib/` 是运行时唯一被 DSH 宿主加载的制品，逆向依赖 `src/` 提供的类型与结构。
- `tests/` 依赖 `lib/`、`src/`，`vitest.config.ts` 将官方客户端虚拟模块重定向为 mock 文件（`tests/official-workspace-client*.mock.ts`），并通过 `support/` 假体隔离真实 git 行为。
- 在 `src/`/`lib/` 内部：`client/*` 依赖 `console-remote/*` 的严格 schema 与 RPC 描述符；`console-remote/*` 与 `console-host/*` 共享 `console-contract`；领域层（`session-checkout-apply`、`index`）依赖 `adapters/*` 对 `ports.ts` 的实现。

## Module Roles

### scripts 模块
负责构建期、开发期与发布期工具，不进入运行时包体。
- `scripts/clean-lib.mjs`（modules/scripts.md 行 1–7）：构建前递归删除 `lib/`，防止陈旧输出泄漏进 tarball。
- `scripts/workspace-sidebar-upstream*.mjs`（modules/scripts.md 行 11–209）：读取钉住版本的 `@deepseek-ai/dsh-client-ui-workspace[-next|-alpha]`，做精确字符串补丁（`replaceExactlyOnce`），经 `materialize*Module()` 输出 ESM 字符串，由 `tsdown.config.ts` 以虚拟模块 ID 注入。
- `scripts/dev-dsh.mjs` + `dev-dsh-lib.mjs`（modules/scripts.md 行 19–98、25–547）：本地开发 harness，管理 fixture Git 仓库、构建并安装快照 tgz、调用 `dsh-source-runner.mjs` 桥接 Harness 源码 CLI。
- `scripts/check-publish.mjs`（modules/scripts.md 行 256）：7 步 fail-closed 发布门禁，校验宿主单例、Host bundle patch、导出文件覆盖、Typert 构件、Browser ToolView 闭包等。
- `scripts/check-workspace-sidebar-version.mjs`（modules/scripts.md 行 1–18）：版本 + SHA-256 漂移预警。

### src 模块
完整 TypeScript 源码，分层清晰。
- 入口 `src/index.ts`（modules/src.md 行 358–459）的 `apply()` 装配主流程：`mountWorkspaceProviderLifecycle`、`createSessionCheckoutModule`、注册工具/命令/上下文。
- 领域契约：`src/types.ts`（行 18–627）、`src/ports.ts`（行 40–608）定义状态机与端口；`src/session-checkout-apply.ts`（行 279–2672）为实现 Apply 引擎。
- 适配器 `src/adapters/*`：`git.ts` 实现 ctx.subprocess git 端口，`registry.ts` 实现原子 JSON 注册表，`worktree-creation.ts` 实现创建与回滚证据链。
- Console 层：`src/console-contract.ts` 定义 Host↔Client 共享 DTO；`src/console-host/*` 提供 Typert Remote 服务与控制平面；`src/console-remote/*` 提供 zod strict schema 与方法描述符。
- Client：`src/client/*` 为 React 面板（目标胶囊、评审坞、侧栏投影、预会话开关、设置卡），`src/i18n/*` 与 `src/host-compat.ts`、`src/workspace-provider-lifecycle.ts` 处理双语与宿主世代选举。

### lib 模块
`src/` 的编译产物，结构镜像，运行时被加载。
- `lib/index.js` 的 `apply()` 装配 `createSessionCheckoutModule` 与 `WorktreeConsoleService`。
- `lib/session-checkout-apply.js` 为 Apply 引擎 JS 实现，含 `checkpoint`/`commitIsolated`/`preview`/`finalize` 等 CAS 协议。
- `lib/console-host/control-plane.js` 实现所有端点授权矩阵；`lib/adapters/git.js` 为真实 git 端口。
- `lib/client/*` 为打包后 UI；`lib/i18n/host-messages.js` 集中双语文案。三层安全边界（目录身份、CAS、journal）贯穿全库。

### tests 模块
Vitest 验证套件，覆盖三主线并把产品回归写进注释。
- `tests/support/worktree-console.ts` 提供 Console adapter 确定性假实现，记录每次调用。
- `tests/support/production-adapters.ts` 装配真实 Node git/files/AtomicJson 注册表依赖。
- Host 核心：`tests/session-checkout-module.test.ts` 覆盖全生命周期；`tests/console-host.test.ts`、`tests/session-checkout-apply.test.ts` 验证控制面与引擎 CAS。
- Client：`tests/client-*.test.tsx` 用 jsdom + RTL 验证 UI；`tests/client-bundle.test.ts` 将 `lib/client.js` 当被测对象。
- 脚本与合同：`tests/dev-dsh.test.ts` 验证本地工作流；`tests/console-remote.test.ts`、`tests/workspace-provider-lifecycle.test.ts` 验证远程边界与官方客户端选举。
