---
title: Console Host Control Plane
type: module
source_files:
  - src/console-host/control-plane.ts
  - src/console-host/service.ts
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

## Key Components

### src/console-host/control-plane.ts (540+ 行)

核心业务逻辑实现，定义 `WorktreeConsoleControlPlane` 接口及其具体实现。

- **`createWorktreeConsoleControlPlane(options)`** (Line 193): 工厂函数，接收 `WorktreeConsoleControlPlaneOptions`（包含 module, lookup, files, registry, git, reviewDiff 等依赖），返回控制面实例。
- **`sidebarTopology()`** (Line 529): 聚合所有受管检查点（managedCheckouts），按项目分组，计算每个会话的最新任务状态（iteration/revision），并注入成员身份信息。
- **`current(sessionId)`** (Line 585): 获取当前会话的目标视图。如果是本地上下文，返回 `projectLocal`；否则解析为具体的 worktree 详情。
- **`list(request)`** (Line 649): 列出会话可见的工作树。支持过滤（needsAttention/includeDelivered）。优化了批量观察（`observeManagedCheckouts`）以并行验证非 discarded 记录，失败时降级为逐条观察或无观察投影。
- **`preflightCreate(sourceSessionId)`** (Line 719): 预检创建条件。如果仓库为空，生成带过期时间（300s）和上限（500个）的确认令牌（confirmation token）；如果就绪，返回分支列表。
- **`createWithInitialCommit(sourceSessionId, confirmationToken)`** (Line 736): 执行空仓库初始化并提交首次提交，随后创建工作树。双重互斥守卫（`withCreation`）防止并发冲突。
- **`create(sourceSessionId, branch?)`** (Line 752): 基于现有分支或默认分支创建工作树。
- **`initProject(sourceSessionId)`** (Line 753): 初始化非 Git 项目目录为有首次提交的仓库。
- **`inspect(sessionId, checkoutId)`** (Line 760): 检查特定 checkout 的详细信息，包括权限验证和状态投影。
- **`reviewDiff(request)`** (Line 761): 读取待审查的差异。前后夹心校验（preflight），确保 isolated HEAD 和 review ID 未变更，防止脏数据读取。
- **`preflight(request)`** (Line 801): 预检接受前状态，验证 owner、revision 和 review ID。
- **`previewRecoveryPreflight(...)`** (Line 812): 预检预览恢复流程，验证 detached preview 身份。
- **`preparePreviewRecoveryAnalysis(...)`** (Line 832): 准备预览恢复分析，生成 continuation 请求。
- **`createPreviewRecoveryHandoff(...)`** (Line 862): 创建预览恢复交接，生成新的 target session 并验证 lineage。
- **`preview(request)`** (Line 918): 应用预览更改到本地工作树。处理冲突（conflict）并返回 continuation。
- **`checkpoint(request)`** (Line 943): 保存检查点（commit），更新 revision 和 review 信息。
- **`resumeRevision(request)`** (Line 983): 恢复编辑，支持冲突恢复路径（conflictContinuation）。
- **`prepareReviewRegeneration(...)`** (Line 1026): 准备重新生成审查，生成 regeneration continuation。
- **`rollbackPreview(request)`** (Line 1051): 回滚本地预览，支持 resumeRevision 和 recoveryProof。
- **`discard(request)`** (Line 1075): 丢弃工作树。区分 owner 和非 owner 路径，处理 dirty 确认和预览回滚。
- **`finalize(request)`** (Line 1100): 最终提交（Acceptance）。CAS 夹心校验，应用更改到本地，生成 delivery proof。
- **`finalizePreview(request)`** (Line 1144): 最终提交本地预览。
- **`setRetention(request)`** (Line 1189): 设置保留策略。
- **`setPermanent(request)`** (Line 1200): 设置为永久保留。
- **`retryCleanup(request)`** (Line 1211): 重试清理操作。
- **`beginNextIteration(request)`** (Line 1221): 开始下一次迭代，要求前驱状态为 delivered+discarded，并验证 lineage。
- **`gitOverview(sessionId)`** (Line 603): 获取本地 Git 仓库的分支概览。
- **`gitGraph(sessionId, limit?)`** (Line 615): 获取 Git 提交图日志。
- **`gitCreateBranch(sessionId, name)`** (Line 627): 创建本地分支。
- **`gitSwitchBranch(sessionId, branch)`** (Line 635): 切换本地分支。如果在交付过程中持有 acceptance slot，则拒绝。
- **`listAbandoned(sessionId)`** (Line 650): 列出被放弃的工作树快照。
- **`restoreAbandoned(request)`** (Line 657): 恢复被放弃的工作树快照。

**内部辅助函数:**
- **`authorize(sessionId, checkoutId, observedCaller?)`** (Line 249): 核心授权逻辑。验证 owner/source 会话、projectId 匹配、根目录一致性（verifyCallerRoot），以及非 discarded 记录的可见性。
- **`linkedReadAccess(...)`** (Line 271): 处理非 owner 的只读访问。支持 linked group 读取和 exact acceptance holder 验证。
- **`observe(record)`** (Line 331): 观察 worktree 状态。优先使用 module 的批量观察方法，失败则降级。
- **`acceptanceHolder(record)`** (Line 353): 查找同一 localRoot 上持有验收槽的其他 record。
- **`projectReviewSlot(record, target)`** (Line 368): 根据 acceptance holder 状态调整 reviewSlot 和能力集。
- **`details(...)`** (Line 394): 组装详细的 TargetDetails，处理 acceptance anchor 的动态校验。
- **`mutationResponse(...)`** (Line 426): 组装 MutationResponse，用于 mutation 操作后的状态投影。
- **`localProject(sessionId)`** (Line 465): 获取调用者的本地项目信息。
- **`projectRootFor(sessionId)`** (Line 476): 获取调用者项目的 Git 根目录和快照。
- **`withCreation(sessionId, action)`** (Line 491): 双键互斥守卫（sessionKey + rootKey），防止并发创建导致的状态不一致。
- **`createTarget(sourceSessionId, branch?)`** (Line 509): 调用 module 创建隔离目标，并验证 launch 结果的一致性。

### src/console-host/service.ts (315 行)

Typert RPC 服务层，将控制面方法暴露为远程过程调用。

- **`class WorktreeConsoleService extends TypertRemoteService`** (Line 33): 服务类，注册名为 `gitWorktree` 的服务。
- **`constructor(...)`** (Line 34): 初始化 hostContext, controlPlane, diagFile, officialWorkspaceActive。
- **`appendDiag(line)`** (Line 45): 异步追加诊断日志到文件，best-effort，不中断 RPC。
- **`@Remote sidebarTopology(locale?)`** (Line 53): 拓扑查询，注入 workspaceClientFlavor 和 officialWorkspaceActive。
- **`@Remote clientBootReport(report)`** (Line 68): 客户端启动报告，返回 true。
- **`@Remote current(agent, locale?)`** (Line 73): 获取当前目标。
- **`@Remote list(agent, needsAttention?, includeDelivered?, locale?)`** (Line 78): 列表查询。
- **`@Remote preflightCreate(agent, locale?)`** (Line 83): 创建预检。
- **`@Remote createWithInitialCommit(agent, confirmationToken, locale?)`** (Line 88): 初始提交创建。
- **`@Remote create(agent, branch?, locale?)`** (Line 93): 创建工作树。
- **`@Remote initProject(agent, locale?)`** (Line 98): 初始化项目。
- **`@Remote inspect(agent, checkoutId, locale?)`** (Line 103): 检查详情。
- **`@Remote reviewDiff(agent, checkoutId, expectedRevision, expectedReviewId, locale?)`** (Line 108): 审查差异。
- **`@Remote preflight(agent, checkoutId, expectedRevision, expectedReviewId, locale?)`** (Line 113): 预检。
- **`@Remote previewRecoveryPreflight(...)`** (Line 118): 预览恢复预检。
- **`@Remote preparePreviewRecoveryAnalysis(...)`** (Line 132): 准备预览恢复分析。
- **`@Remote createPreviewRecoveryHandoff(...)`** (Line 146): 创建预览恢复交接。
- **`@Remote preview(agent, ...)`** (Line 160): 预览。
- **`@Remote checkpoint(agent, ...)`** (Line 165): 检查点。
- **`@Remote prepareReviewRegeneration(...)`** (Line 179): 准备审查再生。
- **`@Remote resumeRevision(agent, ..., conflictContinuation?, locale?)`** (Line 186): 恢复修订。
- **`@Remote rollbackPreview(agent, ..., resumeRevision?, recoveryProof?, locale?)`** (Line 196): 回滚预览。
- **`@Remote discard(agent, ..., confirmDirty, rollbackPreview?, locale?)`** (Line 206): 丢弃。
- **`@Remote finalize(agent, ..., retention, locale?)`** (Line 213): 最终提交。
- **`@Remote finalizePreview(agent, ..., retention, recoveryProof?, locale?)`** (Line 223): 最终提交预览。
- **`@Remote setRetention(agent, ..., retention, locale?)`** (Line 233): 设置保留。
- **`@Remote setPermanent(agent, ..., permanent, locale?)`** (Line 242): 设置永久。
- **`@Remote retryCleanup(agent, ..., locale?)`** (Line 251): 重试清理。
- **`@Remote beginNextIteration(agent, ..., locale?)`** (Line 258): 开始下一次迭代。
- **`@Remote gitOverview(agent, locale?)`** (Line 265): Git 概览。
- **`@Remote gitGraph(agent, limit?, locale?)`** (Line 270): Git 图。
- **`@Remote gitCreateBranch(agent, name, locale?)`** (Line 275): 创建分支。
- **`@Remote gitSwitchBranch(agent, branch, locale?)`** (Line 280): 切换分支。
- **`@Remote listAbandoned(agent, locale?)`** (Line 285): 列出放弃的。
- **`@Remote restoreAbandoned(agent, checkoutId, locale?)`** (Line 290): 恢复放弃的。

### src/console-host/errors.ts (65 行)

错误处理工具。

- **`domainError(code, message, continuation?)`** (Line 5): 构造带 code 和可选 continuation 的 Error。
- **`consoleFailure(error)`** (Line 13): 将 Error 转换为 `WorktreeConsoleOutcome<never>`。领域错误码透传，未知错误归一化为 git_error。
- **`failure<T>(code, message, details?, continuation?)`** (Line 43): 构造失败的 Outcome。
- **`outcome<T>(operation)`** (Line 60): 包装 Promise 操作，捕获异常并转换为 Outcome。

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
│   - @Remote Methods (32 endpoints)                                   │
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
│   - Git Operations (overview/graph/branch)                           │
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