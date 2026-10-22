---
title: Console Host Control Plane
type: module
source_files:
  - src/console-host/service.ts
  - src/console-host/errors.ts
  - src/console-host/projection.ts
  - src/console-host/review-diff.ts
tags:
  - rpc
  - control-plane
  - typert
  - projection
  - git-worktree
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

### src/console-host/service.ts

Typert RPC 服务层，继承自 `TypertRemoteService` (L34)，充当网关层。负责参数校验、国际化上下文注入（通过 `withHostLanguage`）、诊断日志记录，并将请求路由至 `controlPlane` 实例。

**构造函数依赖**:
- `hostContext`: 运行时上下文 (L36)。
- `controlPlane`: `WorktreeConsoleControlPlane` 实例，实际业务逻辑执行者 (L37)。
- `diagFile?`: 可选的诊断文件路径，用于追加 NDJSON 格式的调试信息 (L38)。
- `officialWorkspaceActive`: 布尔值，标记官方工作区是否处于活跃状态，默认 `true` (L40)。

**关键方法**:
- **`appendDiag(line)` (L46-51)**: 使用 `appendFileSync` 同步写入 JSON 行到指定文件。采用“尽力而为”策略，捕获异常以防止破坏 RPC 表面。记录内容包括时间戳、操作结果、项目数量、主机 flavor 及锚点信息。
- **`sidebarTopology(locale?)` (L54-66)**: 返回侧边栏拓扑结构，额外附加 `workspaceClientFlavor` 和 `officialWorkspaceActive` 状态。
- **`clientBootReport(report)` (L69-72)**: 接收客户端启动报告，仅记录诊断并返回 `true`。
- **`current(agent, locale?)` (L75-77)**: 获取当前工作区状态。
- **`list(agent, needsAttention?, includeDelivered?, locale?)` (L80-82)**: 列出工作区，支持筛选关注项和已交付项。
- **`preflightCreate(agent, locale?)` (L85-87)**: 创建前的预检。
- **`createWithInitialCommit(agent, confirmationToken, locale?)` (L90-92)**: 带初始提交的创建工作区。
- **`create(agent, branch?, locale?)` (L95-97)**: 标准创建工作区。
- **`initProject(agent, locale?)` (L100-102)**: 初始化项目。
- **`inspect(agent, checkoutId, locale?)` (L105-107)**: 检查特定检出点。
- **`reviewDiff(agent, checkoutId, expectedRevision, expectedReviewId, locale?)` (L110-112)**: 审查差异。
- **`preflight(agent, checkoutId, expectedRevision, expectedReviewId, locale?)` (L115-117)**: 预检操作。
- **`previewRecoveryPreflight(...expectedPreviewId...)` (L120-131)**: 预览恢复预检。
- **`preparePreviewRecoveryAnalysis(...)` (L134-146)**: 准备预览恢复分析。
- **`createPreviewRecoveryHandoff(...)` (L149-161)**: 创建预览恢复交接。
- **`preview(agent, checkoutId, expectedRevision, expectedReviewId, locale?)` (L164-166)**: 预览操作。
- **`checkpoint(agent, checkoutId, expectedRevision, expectedReviewId, expectedGeneration, requestId, commitMessage, locale?)` (L169-182)**: 检查点提交。
- **`prepareReviewRegeneration(agent, checkoutId, expectedRevision, expectedReviewId, locale?)` (L185-193)**: 准备审查重新生成。
- **`resumeRevision(agent, checkoutId, expectedRevision, expectedReviewId, conflictContinuation?, locale?)` (L196-207)**: 恢复修订，支持冲突继续。
- **`rollbackPreview(agent, checkoutId, expectedRevision, resumeRevision?, recoveryProof?, locale?)` (L210-219)**: 回滚预览。
- **`discard(agent, checkoutId, expectedRevision, confirmDirty, rollbackPreview?, locale?)` (L222-224)**: 丢弃更改。
- **`finalize(agent, checkoutId, expectedRevision, expectedReviewId, commitMessage, retention, locale?)` (L227-237)**: 最终化操作。
- **`finalizePreview(agent, checkoutId, expectedRevision, expectedReviewId, commitMessage, retention, recoveryProof?, locale?)` (L240-253)**: 最终化预览。
- **`setRetention(agent, checkoutId, expectedRevision, retention, locale?)` (L256-264)**: 设置保留模式（排除 'cleanup'）。
- **`setPermanent(agent, checkoutId, expectedRevision, permanent, locale?)` (L267-275)**: 设置永久状态。
- **`retryCleanup(agent, checkoutId, expectedRevision, locale?)` (L278-280)**: 重试清理。
- **`beginNextIteration(agent, checkoutId, expectedRevision, locale?)` (L283-285)**: 开始下一次迭代。
- **`clearSidebarBadge(agent, checkoutId, expectedRevision, locale?)` (L288-290)**: 清除侧边栏徽章。
- **`gitOverview(agent, locale?)` (L293-295)**: Git 概览。
- **`gitGraph(agent, limit?, locale?)` (L298-300)**: Git 图，支持限制深度。
- **`gitCreateBranch(agent, name, locale?)` (L303-305)**: 创建分支。
- **`gitSwitchBranch(agent, branch, locale?)` (L308-310)**: 切换分支。
- **`gitPruneMergedBranches(agent, dryRun, locale?)` (L313-315)**: 修剪已合并分支，支持干运行。
- **`listAbandoned(agent, locale?)` (L318-320)**: 列出被放弃的工作区。
- **`restoreAbandoned(agent, checkoutId, locale?)` (L323-325)**: 恢复被放弃的工作区。

**国际化处理模式**:
- 所有对外暴露的 RPC 方法均包裹在 `withHostLanguage` 中。
- 语言优先级：传入的 `locale` > `agent.ctx` 中的设置 > `this.hostContext` 中的设置。
- 调用 `languageFromSettings` 获取默认语言环境。

### src/console-host/control-plane.ts

核心业务逻辑实现，定义 `WorktreeConsoleControlPlane` 接口及其具体实现。它是 Console 与底层 `SessionCheckoutModule` 及 Git 端口之间的适配层。

**接口定义**:
- **`WorktreeConsoleControlPlaneOptions`**: 依赖注入配置，包含 `module`, `lookup`, `files`, `registry`, `git`, `reviewDiff`。
- **`WorktreeConsoleControlPlane`**: 定义所有公开 API，涵盖 `sidebarTopology`, `current`, `list`, `create`, `inspect`, `reviewDiff`, `preview`, `checkpoint`, `finalize`, `gitOverview` 等约 30 个方法。

**工厂函数**:
- **`createWorktreeConsoleControlPlane(options)`**: 返回 `WorktreeConsoleControlPlane` 实例。内部包含大量私有异步函数。
    - `unboundLocalTarget`: 获取未绑定隔离会话的本地目标视图（基于 Project Root）。
    - `callerTarget`: 尝试 inspect 模块，若 `target_unselected` 则回退到 Local Target。
    - `verifyCallerRoot`: **核心权限校验**。处理交付后（Delivered/Retained/Discarded）的根目录验证逻辑，允许 Owner Session 在 CWD 回到 Local 后仍通过 Local Root 进行授权。
    - `authorize`: 综合校验 Owner/Source 身份、Project 匹配、Root 验证及可见性。
    - `linkedReadAccess`: 处理“链接读取”场景（非 Owner 但属于同一链接组），涉及 Acceptance Holder 的检查。
    - `observe`: 观察 Checkout 状态（managedRoot, snapshot, dirty）。若模块提供 `observeManagedCheckout` 则优先使用。
    - `acceptanceHolder`: 查找当前 Local Root 上持有 Review Slot 的其他 Worktree。
    - `projectReviewSlot`: 若存在 Holder，修改 Target Summary 中的 `reviewSlot` 和 `capabilities`。
    - `details`: 组合 `linkedReadAccess` + `observe` + `projectReviewSlot` + `projectDetails` 生成完整详情。
    - `mutationResponse`: 生成突变操作后的响应，包含最新的 Target 投影。
    - `withCreation`: **防并发创建锁**。使用 `creating` Set 防止同一 Session/Root 同时创建多个 Worktree。
    - `createTarget`: 调用模块创建隔离目标，并验证 Identity 一致性。

**API 实现细节**:
- **`sidebarTopology`**: 聚合所有 Managed Checkouts，合并 Membership 信息，按 Project 分组，保留历史迭代信息。
- **`list`**: 列出 Worktrees。支持批量 `observeManagedCheckouts` 优化，失败时降级为逐条 observe。过滤已丢弃（除非 `includeDelivered`）且需关注的项。
- **`preflightCreate`**: 预检创建条件。若为空仓库，生成一次性 Token 存入 `confirmations` Map（TTL 5分钟，上限 500 个）。
- **`createWithInitialCommit`**: 验证 Token 并执行空仓库初始化，随后创建 Target。
- **`reviewDiff`**: 读取 Review Diff。严格校验 Revision/ReviewId 一致性，调用 `options.reviewDiff.read`。捕获 `ReviewDiffStaleError` 转为 `stale_isolated` 失败。
- **`checkpoint`**: 保存检查点。校验 Commit Message 和 RequestId。调用模块 `operate('checkpoint')`。
- **`preview`**: 预览变更。若发生冲突，抛出带有 `applyConflictContinuation` 的 `apply_conflict` 错误。
- **`resumeRevision`**: 恢复编辑。支持传入 `conflictContinuation` 以解决冲突。
- **`finalize` / `finalizePreview`**: 提交接受。校验 Commit Message。若冲突，返回带有 Continuation 的失败结果。
- **`beginNextIteration`**: 开始下一次迭代。校验前置状态为 `delivered` + `discarded`。验证 Workspace Root 匹配（支持 In-place 或 Isolated 模式）。

**内部辅助函数**:
- **`recordOf`**: 从 Registry 读取 Checkout 记录，不存在则抛 `domainError('checkout_missing')`。
- **`sidebarTaskState`**: 根据 `phase` 和 `delivery.state` 计算侧边栏任务状态（如 `'finalized'`, `'discarded'`, `'recovery_required'`）。关键逻辑：Delivery 完成优先于 Phase。
- **`readyReview` / `previewReview`**: 校验当前记录是否处于可审查或预览状态，否则抛错。
- **`safeRecoveryRequestId`**: 验证 ID 长度 <= 500 且无控制字符。
- **`safeConflictFile`**: 验证冲突文件路径合法性（长度 <= 1000，非绝对路径，无 `.`/`..`，无非法字符）。
- **`applyConflictContinuation`**: 构造冲突恢复的 Continuation 数据，严格校验 OID 格式和文件列表。
- **`preflightFailure`**: 将 Pre-flight 检查的 `blocked` 状态映射为具体的错误码（如 `'stale_isolated'`, `'not_owner'` 等）。

### src/console-host/errors.ts

统一错误类型转换和 Outcome 包装器。

- **`domainError(code, message, continuation?)` (L5-11)**: 创建带有 `code` 和可选 `continuation` 的标准 Error 对象。
- **`consoleFailure(error)` (L13-41)**: 将内部 Error 转换为 `WorktreeConsoleOutcome<never>` (`ok: false`)。
    - 若 Error code 在 `SESSION_CHECKOUT_ERROR_CODES` 中，透传 code/message/continuation。
    - 否则，统一转为 `git_error`，消息来自 i18n 或原 Error message（本地控制台允许泄露，远程传输需截断）。
- **`failure<T>(code, message, details?, continuation?)` (L43-58)**: 直接构造一个失败的 Outcome 对象，支持 `details` 和 `continuation`。
- **`outcome<T>(operation)` (L60-66)**: **核心包装器**。接收一个 Promise 函数，成功返回 `{ ok: true, value }`，失败捕获并调用 `consoleFailure`。

### src/console-host/projection.ts

将内部域模型（`ManagedCheckoutRecord`）转换为 UI 消费的数据结构（`WorktreeConsoleTargetSummary` / `WorktreeConsoleTargetDetails`）。

- **`capabilities` (L61-98)**: 根据 Caller Session ID、Owner 可用性、Linked Read 状态及 Record 当前 Phase/Delivery State，计算当前用户对该 Worktree 拥有的能力集合（如 `open`, `inspect`, `discard`, `finalize` 等布尔值）。
- **`projectRecord` (L109-183)**: 构建 Target Summary。提取 review, proof, iteration, state, dirty, oid, checkpoints, previewRecovery 等信息。
    - 若 `linkedRead` 为 true，隐藏 `deliveryProof`。
    - 处理 Retention 过期时间、Permanent 标记、Cleanup Message。
- **`projectDetails` (L185-255)**: 构建 Target Details。继承 Summary，补充 `managedRoot`, `sourceRoot`, `sourceOid`, `currentBranch`。
    - 若 Caller 是 Owner 且存在 `recoveryContinuation`，详细展开冲突恢复或预览恢复的上下文数据。
- **`projectLocal` (L257-294)**: 构建 Local 目标的投影。所有 Worktree 特定能力置为 false，仅保留 `create` (若未版本化), `open`, `inspect`。

### src/console-host/review-diff.ts

高效、安全地读取 Git 差异内容（Diff/Patch），用于 Code Review。

**常量**:
- `REVIEW_DIFF_MAX_FILES = 200` (L9)
- `REVIEW_DIFF_MAX_PATCH_BYTES = 100KB` (L10)
- `REVIEW_DIFF_MAX_PAYLOAD_BYTES = 1MB` (L11)

**类/函数**:
- **`ReviewDiffStaleError` (L25-30)**: 自定义错误类，表示快照已过期。
- **`createGitWorktreeReviewDiffReader` (L123-244)**: 工厂函数，返回 `read` 方法。
    - **实现逻辑**:
        1.  创建临时目录 (`mkdtemp`) 和 Object Directory。
        2.  使用 `GIT_ALTERNATE_OBJECT_DIRECTORIES` 指向源仓库的对象库，避免复制大对象。
        3.  `read-tree baseOid` 建立索引基线。
        4.  若启用 Project Skills，移除技能追踪文件。
        5.  `diff --cached --name-status -z` 获取变更文件列表，解析为 `ChangedEntry`。
        6.  校验实际变更文件与预期 `changedFiles` 是否一致，不一致抛 `ReviewDiffStaleError`。
        7.  **分批并行取证**：每批 8 个文件，并行执行 `diff --numstat` 和 `diff --cached --no-ext-diff`。
        8.  **大小限制与截断**：
            - 单文件 Patch 超过 `MAX_PATCH_BYTES` 标记 `truncated`。
            - 总 Payload 超过 `MAX_PAYLOAD_BYTES` 时，停止添加新文件，并对当前文件 Patch 进行 UTF-8 前缀截断（`utf8Prefix`），确保 JSON 序列化后不超限。
        9.  清理临时目录。

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

## Known Issues

- **诊断隔离**: `appendDiag` 的静默失败确保诊断写入问题不会导致主流程中断，但也意味着诊断失败不可见。
- **语言回退**: 如果 `agent.ctx` 或 `hostContext` 中没有设置语言，`languageFromSettings` 可能提供默认值，需参考 `../i18n/host.js` 的具体实现以确定最终行为。
- **错误传播**: 未显式捕获 `controlPlane` 调用的异常，意味着错误会直接向上传播至 RPC 框架，由框架决定如何序列化错误响应。