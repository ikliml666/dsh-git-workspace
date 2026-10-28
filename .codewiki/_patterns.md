---
title: 仓库反复出现的模式
type: pattern
source_files:
  - src/index.ts
  - src/types.ts
  - src/ports.ts
  - src/commands.ts
  - src/tools.ts
  - src/commit-message.ts
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
  - src/managed-worktree-path.ts
  - src/session-checkout-apply.ts
  - src/session-target-context.ts
  - src/checkpoint.ts
  - src/creation-failure.ts
  - src/delivery-excludes.ts
  - src/host-compat.ts
  - src/workspace-provider-lifecycle.ts
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
tags: [patterns, naming-conventions, error-handling, testing, directory-structure, concurrency, i18n, dsh-git-worktree]
---

## Overview

本文基于 `src.md`、`lib.md`、`tests.md` 三个模块文章，横向提炼 `dsh-git-worktree` 插件仓库中反复出现的工程模式。这些模式跨越宿主运行时（`src/` 与 `lib/` 实质同构，前者为 TypeScript 源、后者为编译/等价 JS 产物）与测试套件（`tests/`），体现在命名约定、错误处理风格、构建/测试流程、目录与模块边界、并发原子性以及国际化等维度。每一节均引用具体模块文章中所出现的文件与函数名作为证据，以便追溯到确切实现。

## Patterns

### 1. 命名约定（Naming Conventions）

仓库在标识符、文件路径与测试夹具上保持高度一致的命名纪律：

- **内部 Git 引用命名空间**：所有插件内部 ref 统一落在 `refs/dsh-worktree/` 下，避免与用户分支冲突。证据：`src/adapters/git.ts` 的 `checkoutRefRoot`（201-204 行，产出 `refs/dsh-worktree/session-checkouts/<sha256前24>`）与 `lib/adapters/git.js` 的 `checkoutRefRoot`（191-194 行）。
- **会话分支命名**：受管 worktree 挂载到会话分支时采用 `feat/sess-<session>[--<topic>]` 并支持 `-2..-N` 重名后缀。证据：`src/managed-worktree-path.ts` 的 `createSessionBranchCandidates`（63-75 行）与 `lib/managed-worktree-path.js` 的同名函数（55-64 行）。
- **稳定错误码枚举**：领域错误使用固定字符串码而非动态消息。证据：`src/types.ts` 的 `SESSION_CHECKOUT_ERROR_CODES`（597-627 行，29 个码）与 `lib/types.d.ts` 的同名常量（499 行）。
- **模块级超时/间隔常量**：使用 `UPPER_SNAKE_CASE` 导出自解释常量。证据：`src/index.ts` 的 `RETENTION_MAINTENANCE_INTERVAL_MS`（343 行）/`AUTO_PRUNE_INTERVAL_MS`（345 行）与 `lib/index.js` 的对应常量（122-126 行）。
- **测试夹具函数命名**：确定性夹具以 `readyTarget()`、`fixture()`、`create*Fixture` 等形状出现。证据：`tests/support/worktree-console.ts` 的 `readyTarget()`（60-111 行）与 `createWorktreeConsoleAdapterFixture`（124-534 行）；`tests/session-branch-delivery.test.ts` 的 `fixture()`（32-79 行）。

### 2. 错误处理风格（Error Handling Style）

错误处理强调“失败可见、第三方隔离、清理保守、写操作可补偿”：

- **领域错误携带稳定 code**：错误类包装 `code` 字段，消息仅作原样透出。证据：`src/index.ts` 的 `SessionCheckoutError`（41-53 行，构造器接收 `code` + `message`）与 `lib/index.js` 的同名类（4-15 行）。
- **第三方错误本地透出但远程需脱敏**：Host 侧把非域错误折叠为 `git_error` 并原样带消息，但注释明确远程序列化前必须截断。证据：`src/console-host/errors.ts` 的 `consoleFailure`（13-41 行，30-33 行 ponytail 注释）与 `lib/console-host/errors.js` 的 `consoleFailure`（6-32 行，21-24 行注释）。
- **创建失败绝不视同“空路径安全”**：创建中途失败必须保留现场，绝不误删或覆盖。证据：`src/creation-failure.ts` 的 `WorktreeCreationFailure`（`rolledBack` 布尔，1 行注释）与 `lib/creation-failure.js` 的同名类型（2-9 行）；以及 `src/adapters/files.ts` 的 `quarantineDirectoryTree`（52-72 行，“绝不删除身份不符对象”）与 `lib/adapters/files.js` 的同名函数（54-74 行）。
- **CAS 与事务补偿**：Git 引用更新使用 `update-ref <branch> <new> <old>` 实现比较交换；复杂写如 `finalize` 具备三级回滚补偿。证据：`src/adapters/git.ts` 的 `attachWorktreeBranch`（405-425 行 CAS 语义）与 `lib/adapters/git.js` 的同名方法（401-415 行）；`src/session-checkout-apply.ts` 的 `finalize`（2093-2367 行，失败补偿回滚树）与 `lib/session-checkout-apply.js` 的 `finalize`（1316-1522 行）。
- **损坏数据 loud fail**：注册表文件损坏直接抛 `registry_corrupt` 而非静默重置。证据：`src/adapters/registry.ts` 的 `AtomicJsonCheckoutRegistry.read`（400-410 行）与 `lib/adapters/registry.js` 的同名方法（385-397 行）。

### 3. 构建与测试流程（Build & Test Flow）

测试与插件装载遵循可重复的纪律：

- **三轨测试结构**：Host（Node）、Client（jsdom + RTL）、平台（真实 git 子进程）分开。证据：`tests.md` Overview 明确列出 `console-host.test.ts`/`client-*.test.tsx`/`git-*.test.ts` 三类轨道。
- **共享确定性夹具**：避免重复组装依赖。证据：`tests/support/worktree-console.ts` 的 `createWorktreeConsoleAdapterFixture`（124 行，注释 “Shared deterministic fake used by the three parallel Worktree Console tracks”）与 `tests/support/production-adapters.ts` 的 `createNodeSessionCheckoutDependencies`（514 行，同时实现 v1→v2 迁移与校验器）。
- **环境隔离**：集成测试主动剥离 `GIT_*` 变量以防读到开发者仓库配置。证据：`tests/session-branch-delivery.test.ts` 的 `testEnvironment()`（12-23 行）、`tests/git-unborn.test.ts` 的 `testEnvironment()`（17-23 行）。
- **插件注入清单必须具名导出**：Cordis 加载要求 `inject` 命名导出，否则首次访问 `ctx.tools` 报错。证据：`src/index.ts` 的 `inject`（253 行，注释 “必须具名导出”）与 `lib/index.js` 的 `inject`（46 行，40-45 行注释）。
- **假定时器恢复纪律**：使用 `vi.useFakeTimers` 的测试必须在 afterEach/finally 恢复，否则污染后续。证据：`tests/current-polling.test.ts`（8 行）、`tests/git-timeouts.test.ts`（8 行）及 `tests.md` Known Issues 中“假定时器”条目。

### 4. 目录与模块约定（Directory & Module Conventions）

代码组织严格遵循“端口反转”与“按面拆目录”：

- **端口反转分层**：领域只依赖 `ports.ts`/`ports.d.ts` 接口，DSH 细节挡在 `adapters/`。证据：`src/index.ts` 模块注释（3-10 行，“领域核心从 Domi 移植且与宿主无关”）与 `lib/index.js` Architecture 图（“领域引擎只依赖 ports”）。
- **客户端子域划分**：`client/` 下按功能切成 `review-console/`、`target-console/`、`pre-session/`、`workspace-sidebar/`、`settings-card/`、`console-remote/`。证据：`src/client/index.tsx` 的 `apply`（49-106 行，注册 ToolView 与 `registerTargetConsole`/`registerPreSessionWorktree`）与 `lib/client/index.js` 的同名函数（26-67 行）。
- **两处持久化与崩溃安全写**：状态仅落 `stateDir/managed-checkouts.json`（v2 原子 JSON）与 Git ref 命名空间；JSON 写使用唯一 tmp + `.bak` + 原子 rename。证据：`src/index.ts` 的 `apply`（364-379 行装配 `AtomicJsonCheckoutRegistry`）与 `src/adapters/safe-file.ts` 的 `writeJsonFileAtomic`（82-100 行）；`lib/adapters/safe-file.js` 的同名函数（79-95 行，76-77 行注释“无跨进程锁”）。
- **i18n 模块集中**：文案与语言解析统一在 `i18n/` 子目录。证据：`src/i18n/core.ts`（Translator 推导）、`src/i18n/host.ts`（AsyncLocalStorage 语言快照）、`src/i18n/host-messages.ts`（hostMessages 目录）与 `lib/i18n/` 下同名文件。
- **测试支持目录**：共享替身与夹具置于 `tests/support/`。证据：`tests/support/worktree-console.ts`、`tests/support/production-adapters.ts`、`tests/support/official-client.ts`、`tests/support/ui-primitives.tsx` 等均在 `tests.md` Key Components 中列为共享夹具。

### 5. 并发与原子性约定（Concurrency & CAS Patterns）

为避免竞态与半写，仓库广泛使用身份指纹、单飞缓存与节流：

- **目录身份三元组 CAS**：用 `{device, inode, birthtimeNs}` 作为清理/隔离的授权证据。证据：`src/ports.ts` 的 `DirectoryIdentity`（232-236 行）与 `lib/ports.d.ts` 的同名类型（238-242 行）；`src/adapters/files.ts` 的 `inspectDirectoryIdentity`（37-46 行）与 `lib/adapters/files.js` 的同名函数（39-50 行）。
- **单飞读缓存与 generation 防回写**：客户端对 adapter 响应做身份键单飞，并用 generation 防止迟到响应覆盖新状态。证据：`src/client/review-console/request-cache.ts` 的 `createRequestCache`（41-151 行，`WeakMap<adapter, Map>` 注释）与 `lib/client/review-console/request-cache.js` 的同名函数（11-104 行，2-9 行注释）。
- **轮询节流与隐藏降频**：胶囊轮询默认 5s，文档隐藏时降至 60s 且仅用于显示不授权变更。证据：`src/client/target-console/current-polling.ts` 的 `DELAY`/`HIDDEN_DELAY`（8/15 行）与 `lib/client/target-console/current-polling.js` 的同名常量（4-10 行）。

### 6. 国际化与语言解析约定（i18n & Localization Pattern）

语言解析按“调用现场”绑定，客户端与宿主对称：

- **调用现场语言快照**：每次调用通过 `AsyncLocalStorage` 绑定不可变 locale，优先用 `agent.ctx` 防跨用户泄漏。证据：`src/i18n/host.ts` 的 `withHostLanguage`（12-14 行）、`languageForInvocation`（30-33 行）与 `lib/i18n/host.js` 的同名函数（9-11/26-29 行）。
- **客户端 React 订阅**：用 `useSyncExternalStore` 订阅 locale 快照。证据：`src/client/i18n.tsx` 的 `ClientI18nProvider`（29-40 行）与 `lib/client/i18n.js` 的同名提供器（26-33 行）。
- **持久化消息白名单映射**：持久化的旧中文 cleanup 消息经有限白名单映射到当前语言，绝不解释第三方文本。证据：`src/i18n/host-messages.ts` 的 `hostPersistedCleanupMessage`（1770-1773 行，1763-1767 行注释）与 `lib/i18n/host-messages.js` 的同名函数（1763-1766 行）。

### 7. 宿主 RPC 与契约容忍约定（RPC Contract Tolerance）

Client 与 Host 独立部署，契约必须向前兼容：

- **新增能力位缺省 false**：zod schema 用 `.default(false)` 而非 `optional()`，防旧 Host 让整条 `current` 校验失败。证据：`src/console-remote/schemas.ts` 的 `capabilitiesSchema`（`returnToLocal: z.boolean().default(false)`，100-104 行注释）与 `lib/console-remote/schemas.js` 的同名 schema（54-76 行，70-75 行注释）。
- **错误 continuation 受限**：`continuation` 仅允许出现在 `apply_conflict` 错误。证据：`src/console-remote/schemas.ts` 的 `consoleErrorSchema.superRefine`（221-225 行）与 `lib/console-remote/schemas.js` 的 `consoleErrorSchema`（187-196 行，192-195 行）。
- **标签 pushed 三态**：远端不可查时为 `null` 而非强转 false。证据：`src/console-remote/schemas.ts` 的 `gitTagSchema.pushed`（注释 437 行、字段 438 行）与 `lib/console-remote/schemas.js` 的 `gitTagSchema`（394-402 行，注释 "null=无法查询远端，绝不强转”）。
