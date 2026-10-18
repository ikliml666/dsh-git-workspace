---
title: Console Host Control Plane
type: module
source_files:
  - src/console-host/control-plane.ts
  - src/console-host/errors.ts
tags:
  - rpc
  - control-plane
  - typert
  - projection
---

# Console Host Control Plane

三层架构：客户端 UI（Worktree 卡片/验收界面）↔ strict Typert RPC（`gitWorktree` 服务）↔ 宿主控制面。控制面将状态机（[[session-checkout-module|Session Checkout Module]]）的领域能力投影为 UI 可用的读/写端点，并集中实现授权、并发守卫与 Git 操作封装。

## Overview

该模块负责在宿主进程中暴露 Git Worktree 的控制平面。它不直接处理复杂的 Git 逻辑，而是通过 `module`（Session Checkout Module）协调底层操作，并通过 `registry` 维护工作树的生命周期状态。所有对外接口均通过 `TypertRemoteService` 暴露，支持多语言本地化（i18n）和严格的参数校验。

核心职责包括：
- **RPC 适配**：通过 `service.ts` 将内部逻辑包装为 Typert Remote 调用。
- **权限与一致性**：通过 `authorize` 和 `linkedReadAccess` 确保会话所有权、项目匹配及根目录一致性。
- **并发安全**：通过 `withCreation` 实现基于 Session 和 Root 的双重互斥，防止并发创建冲突。
- **状态投影**：利用 `projection.ts` 中的辅助函数将内部记录转换为 UI 友好的目标视图（Target Details）。

## Key Components

### src/console-host/control-plane.ts (605+ 行)

核心业务逻辑实现，定义 `WorktreeConsoleControlPlane` 接口及其具体实现。

- **`createWorktreeConsoleControlPlane(options)`**: 工厂函数，接收 `WorktreeConsoleControlPlaneOptions`（包含 module, lookup, files, registry, git, reviewDiff 等依赖），返回控制面实例。内部初始化 `confirmations` Map 和 `creating` Set 用于并发控制。
- **`sidebarTopology()`**: 聚合所有受管检查点（managedCheckouts），按项目分组，计算每个会话的最新任务状态（iteration/revision），并注入成员身份信息。处理终端徽章清除逻辑。
- **`current(sessionId)`**: 获取当前会话的目标视图。如果是本地上下文，返回 `projectLocal`；否则解析为具体的 worktree 详情。
- **`list(request)`**: 列出会话可见的工作树。支持过滤（needsAttention/includeDelivered）。优化了批量观察（`observeManagedCheckouts`）以并行验证非 discarded 记录，失败时降级为逐条观察或无观察投影。
- **`preflightCreate(sourceSessionId)`**: 预检创建条件。如果仓库为空，生成带过期时间（300s）和上限（500个）的确认令牌（confirmation token）；如果就绪，返回分支列表。
- **`createWithInitialCommit(sourceSessionId, confirmationToken)`**: 执行空仓库初始化并提交首次提交，随后创建工作树。双重互斥守卫（`withCreation`）防止并发冲突。
- **`create(sourceSessionId, branch?)`**: 基于现有分支或默认分支创建工作树。
- **`initProject(sourceSessionId)`**: 初始化非 Git 项目目录为有首次提交的仓库。
- **`inspect(sessionId, checkoutId)`**: 检查特定 checkout 的详细信息，包括权限验证和状态投影。
- **`reviewDiff(request)`**: 读取待审查的差异。前后夹心校验（preflight），确保 isolated HEAD 和 review ID 未变更，防止脏数据读取。
- **`preflight(request)`**: 预检接受前状态，验证 owner、revision 和 review ID。
- **`previewRecoveryPreflight(...)`**: 预检预览恢复流程，验证 detached preview 身份。
- **`preparePreviewRecoveryAnalysis(...)`**: 准备预览恢复分析，生成 continuation 请求。
- **`createPreviewRecoveryHandoff(...)`**: 创建预览恢复交接，生成新的 target session 并验证 lineage。
- **`preview(request)`**: 应用预览更改到本地工作树。处理冲突（conflict）并返回 continuation。
- **`checkpoint(request)`**: 保存检查点（commit），更新 revision 和 review 信息。
- **`resumeRevision(request)`**: 恢复编辑，支持冲突恢复路径（conflictContinuation）。
- **`prepareReviewRegeneration(...)`**: 准备重新生成审查，生成 regeneration continuation。
- **`rollbackPreview(request)`**: 回滚本地预览，支持 resumeRevision 和 recoveryProof。
- **`discard(request)`**: 丢弃工作树。区分 owner 和非 owner 路径，处理 dirty 确认和预览回滚。
- **`finalize(request)`**: 最终提交（Acceptance）。CAS 夹心校验，应用更改到本地，生成 delivery proof。
- **`finalizePreview(request)`**: 最终提交本地预览。
- **`setRetention(request)`**: 设置保留策略。
- **`setPermanent(request)`**: 设置为永久保留。
- **`retryCleanup(request)`**: 重试清理操作。
- **`beginNextIteration(request)`**: 开始下一次迭代，要求前驱状态为 delivered+discarded，并验证 lineage。
- **`clearSidebarBadge(request)`**: 清除侧边栏徽章，仅允许 terminal 状态（discarded/finalized）。
- **`gitOverview(sessionId)`**: 获取本地 Git 仓库的分支概览。
- **`gitGraph(sessionId, limit?)`**: 获取 Git 提交图日志。
- **`gitCreateBranch(sessionId, name)`**: 创建本地分支。
- **`gitSwitchBranch(sessionId, branch)`**: 切换本地分支。如果在交付过程中持有 acceptance slot，则拒绝。
- **`listAbandoned(sessionId)`**: 列出被放弃的工作树快照。
- **`restoreAbandoned(request)`**: 恢复被放弃的工作树快照。
- **`gitPruneMergedBranches(sessionId, dryRun)`**: 修剪已合并的本地分支。

**内部辅助函数:**
- **`authorize(sessionId, checkoutId, observedCaller?)`**: 核心授权逻辑。验证 owner/source 会话、projectId 匹配、根目录一致性（verifyCallerRoot），以及非 discarded 记录的可见性。
- **`linkedReadAccess(...)`**: 处理非 owner 的只读访问。支持 linked group 读取和 exact acceptance holder 验证。
- **`observe(record)`**: 观察 worktree 状态。优先使用 module 的批量观察方法，失败则降级。
- **`acceptanceHolder(record)`**: 查找同一 localRoot 上持有验收槽的其他 record。
- **`projectReviewSlot(record, target)`**: 根据 acceptance holder 状态调整 reviewSlot 和能力集。
- **`details(...)`**: 组装详细的 TargetDetails，处理 acceptance anchor 的动态校验。
- **`mutationResponse(...)`**: 组装 MutationResponse，用于 mutation 操作后的状态投影。
- **`localProject(sessionId)`**: 获取调用者的本地项目信息。
- **`projectRootFor(sessionId)`**: 获取调用者项目的 Git 根目录和快照。
- **`withCreation(sessionId, action)`**: 双键互斥守卫（sessionKey + rootKey），防止并发创建导致的状态不一致。
- **`createTarget(sourceSessionId, branch?)`**: 调用 module 创建隔离目标，并验证 launch 结果的一致性。
- **`recordOf(registry, checkoutId)`**: 从 registry 获取 checkout 记录，不存在则抛出 domainError。
- **`sidebarTaskState(record)`**: 将 record 的内部状态映射为侧边栏任务状态字符串。
- **`readyReview(record)`**: 验证记录处于 ready_for_review 状态，返回 review 对象。
- **`previewReview(record)`**: 验证记录处于 preview_active 或 preview_detached 状态，返回 review 对象。
- **`safeRecoveryRequestId(value)`**: 校验恢复请求 ID 的安全性（长度、字符）。
- **`safeConflictFile(file)`**: 校验冲突文件名的安全性。
- **`applyConflictContinuation(result, reviewId)`**: 将冲突结果转换为 continuation 对象。
- **`preflightFailure(view)`**: 将 preflight 视图转换为 failure Outcome。
- **`unboundLocalTarget(sessionId)`**: 获取未绑定本地的目标视图。
- **`callerTarget(sessionId)`**: 获取调用者目标，处理 target_unselected 异常。
- **`verifyCallerRoot(sessionId, record, expectedRoot)`**: 验证调用者根目录与工作树根目录的一致性。
- **`ownerSessionAvailable(record)`**: 检查 owner 会话是否可用。
- **`sameLocalRoot(left, right)`**: 跨平台比较本地根目录路径。
- **`deliveryProofFromTarget(target)`**: 从目标视图提取 delivery proof。

### src/console-host/service.ts

Typert RPC 服务层，将控制面方法暴露为远程过程调用。

- **`class WorktreeConsoleService extends TypertRemoteService`**: 服务类，注册名为 `gitWorktree` 的服务。
- **`constructor(...)`**: 初始化 hostContext, controlPlane, diagFile, officialWorkspaceActive。
- **`appendDiag(line)`**: 异步追加诊断日志到文件，best-effort，不中断 RPC。
- **`@Remote sidebarTopology(locale?)`**: 拓扑查询，注入 workspaceClientFlavor 和 officialWorkspaceActive。
- **`@Remote clientBootReport(report)`**: 客户端启动报告，返回 true。
- **`@Remote current(agent, locale?)`**: 获取当前目标。
- **`@Remote list(agent, needsAttention?, includeDelivered?, locale?)`**: 列表查询。
- **`@Remote preflightCreate(agent, locale?)`**: 创建预检。
- **`@Remote createWithInitialCommit(agent, confirmationToken, locale?)`**: 初始提交创建。
- **`@Remote create(agent, branch?, locale?)`**: 创建工作树。
- **`@Remote initProject(agent, locale?)`**: 初始化项目。
- **`@Remote inspect(agent, checkoutId, locale?)`**: 检查详情。
- **`@Remote reviewDiff(agent, checkoutId, expectedRevision, expectedReviewId, locale?)`**: 审查差异。
- **`@Remote preflight(agent, checkoutId, expectedRevision, expectedReviewId, locale?)`**: 预检。
- **`@Remote previewRecoveryPreflight(...)`**: 预览恢复预检。
- **`@Remote preparePreviewRecoveryAnalysis(...)`**: 准备预览恢复分析。
- **`@Remote createPreviewRecoveryHandoff(...)`**: 创建预览恢复交接。
- **`@Remote preview(agent, ...)`**: 预览。
- **`@Remote checkpoint(agent, ...)`**: 检查点。
- **`@Remote prepareReviewRegeneration(...)`**: 准备审查再生。
- **`@Remote resumeRevision(agent, ..., conflictContinuation?, locale?)`**: 恢复修订。
- **`@Remote rollbackPreview(agent, ..., resumeRevision?, recoveryProof?, locale?)`**: 回滚预览。
- **`@Remote discard(agent, ..., confirmDirty, rollbackPreview?, locale?)`**: 丢弃。
- **`@Remote finalize(agent, ..., retention, locale?)`**: 最终提交。
- **`@Remote finalizePreview(agent, ..., retention, recoveryProof?, locale?)`**: 最终提交预览。
- **`@Remote setRetention(agent, ..., retention, locale?)`**: 设置保留。
- **`@Remote setPermanent(agent, ..., permanent, locale?)`**: 设置永久。
- **`@Remote retryCleanup(agent, ..., locale?)`**: 重试清理。
- **`@Remote beginNextIteration(agent, ..., locale?)`**: 开始下一次迭代。
- **`@Remote clearSidebarBadge(agent, ..., locale?)`**: 清除侧边栏徽章。
- **`@Remote gitOverview(agent, locale?)`**: Git 概览。
- **`@Remote gitGraph(agent, limit?, locale?)`**: Git 图。
- **`@Remote gitCreateBranch(agent, name, locale?)`**: 创建分支。
- **`@Remote gitSwitchBranch(agent, branch, locale?)`**: 切换分支。
- **`@Remote gitPruneMergedBranches(agent, dryRun, locale?)`**: 修剪已合并分支。
- **`@Remote listAbandoned(agent, locale?)`**: 列出放弃的。
- **`@Remote restoreAbandoned(agent, checkoutId, locale?)`**: 恢复放弃的。

### src/console-host/errors.ts (65 行)

错误处理工具。

- **`domainError(code, message, continuation?)`**: 构造带 code 和可选 continuation 的 Error。
- **`consoleFailure(error)`**: 将 Error 转换为 `WorktreeConsoleOutcome<never>`。领域错误码透传，未知错误归一化为 git_error。
- **`failure<T>(code, message, details?, continuation?)`**: 构造失败的 Outcome。
- **`outcome<T>(operation)`**: 包装 Promise 操作，捕获异常并转换为 Outcome。

## Architecture

```text
┌──────────────────────────────────────────────────────────────────────┐
│                        Client UI                                     │
│              (Worktree Cards / Acceptance View)                      │
└──────────────────────────┬───────────────────────────────────────────┘
                           │ Typert RPC (gitWorktree)
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     WorktreeConsoleService                           │
│         src/console-host/service.ts                                  │
│   - @Remote Methods (33 endpoints)                                   │
│   - i18n wrapping (withHostLanguage)                                 │
│   - Diagnostics appendFileSync                                       │
└──────────────────────────┬───────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│                  Control Plane Implementation                        │
│         src/console-host/control-plane.ts                            │
│   - authorize() / linkedReadAccess()                                 │
│   - withCreation() (Mutex Guard)                                     │
│   - CRUD & Mutation Operations                                       │
│   - Git Operations (overview/graph/branch/prune)                     │
└──────────────────────────┬───────────────────────────────────────────┘
                           │
      ┌────────────────────┼────────────────────┐
      ▼                    ▼                    ▼
┌─────────────┐   ┌─────────────┐   ┌────────────────────┐
│ Session     │   │ Registry    │   │ Git Adapter        │
│ Checkout    │   │ (State DB)  │   │ (Inspect/Status)   │
│ Module      │   │             │   │                    │
└─────────────┘   └─────────────┘   └────────────────────┘
```

## Data Flow

1.  **RPC 入口**: 客户端发起 RPC 调用，`WorktreeConsoleService` 接收请求，通过 `withHostLanguage` 设置本地化上下文。
2.  **授权与验证**: 控制面的方法首先调用 `authorize` 或 `linkedReadAccess` 验证会话权限、项目匹配性和根目录一致性。
3.  **并发守卫**: 对于创建操作，`withCreation` 使用 `creating` Set 进行双重互斥（sessionKey + rootKey），防止竞态条件。
4.  **状态观察**: 读操作（如 `list`, `current`）调用 `observe` 获取最新 Git 状态。优先使用批量观察以提高性能，失败时降级。
5.  **业务逻辑**: 根据操作类型（preview, checkpoint, finalize 等）调用 `module.operate` 或相关方法执行实际工作树管理。
6.  **投影**: 结果数据通过 `projection.ts` 中的函数（`projectRecord`, `projectDetails`）转换为 UI 友好的格式，包括能力计算（`capabilities`）和状态映射。
7.  **响应**: 最终结果通过 `outcome` 或 `failure` 包装为 `WorktreeConsoleOutcome` 返回给客户端。

## Connections

- [[session-checkout-module|Session Checkout State Machine]]: 核心状态机，提供 `operate`, `preflight`, `createIsolatedTarget` 等方法。
- [[host-overview|Host Entry and Registration Surface]]: 宿主的入口和注册机制。
- [[adapters|Adapter Layer]]: Git 适配器和文件系统适配器。