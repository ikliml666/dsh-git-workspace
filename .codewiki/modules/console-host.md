---
title: Console Host Control Plane
type: module
source_files:
  - src/console-host/service.ts
  - src/console-host/control-plane.ts
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

该模块负责在宿主进程中暴露 Git Worktree 的控制平面。它不直接处理复杂的 Git 逻辑，而是通过 `module`（Session Checkout Module）协调底层操作，并通过 `registry` 维护工作树的生命周期状态。所有对外接口均通过 `TypertRemoteService` 暴露（服务名 `'gitWorktree'`，见 service.ts L42），支持多语言本地化（i18n）和严格的参数校验。

核心职责包括：
- **RPC 适配**：通过 `service.ts` 将内部逻辑包装为 Typert Remote 调用（`@Remote` 装饰器）。
- **权限与一致性**：通过 `authorize`（control-plane.ts L275）和 `linkedReadAccess`（L297）确保会话所有权、项目匹配及根目录一致性。
- **并发安全**：通过 `withCreation`（L512）实现基于 Session 和 Root 的双重互斥，防止并发创建冲突。
- **状态投影**：利用 `projection.ts` 中的辅助函数将内部记录转换为 UI 友好的目标视图（Target Details / Summary）。
- **差异读取**：`review-diff.ts` 提供安全的 Git diff 取证，用于审查界面。

## Key Components

### src/console-host/service.ts

Typert RPC 服务层，继承自 `TypertRemoteService`（L34），充当网关层。负责参数校验、国际化上下文注入（通过 `withHostLanguage`）、诊断日志记录，并将请求路由至 `controlPlane` 实例。

**构造函数依赖（L35-43）**:
- `hostContext`: 运行时上下文（L36）。
- `controlPlane`: `WorktreeConsoleControlPlane` 实例，实际业务逻辑执行者（L37）。
- `diagFile?`: 可选的诊断文件路径，用于追加 NDJSON 格式的调试信息（L38）。
- `officialWorkspaceActive`: 布尔值，标记官方工作区是否处于活跃状态（来自 mountWorkspaceProviderLifecycle 的 provider 选举结果），默认 `true`（L40）。

**关键私有方法**:
- `appendDiag(line)`（L46-51）：使用 `appendFileSync` 同步写入 JSON 行到指定文件。采用“尽力而为”策略，捕获异常以防止破坏 RPC 表面。记录内容包括时间戳、操作结果、项目数量、主机 flavor 及锚点信息。

**公开 RPC 方法（均使用 `@Remote` 装饰，行号对应方法声明起始行）**:
- `sidebarTopology(locale?)`（L54-66）：返回侧边栏拓扑，附加 `workspaceClientFlavor` 和 `officialWorkspaceActive`。
- `clientBootReport(report)`（L69-72）：接收客户端启动报告，仅记录诊断并返回 `true`。
- `current(agent, locale?)`（L75-77）：获取当前工作区状态。
- `list(agent, needsAttention?, includeDelivered?, locale?)`（L80-82）：列出工作区。
- `preflightCreate(agent, locale?)`（L85-87）：创建前预检。
- `createWithInitialCommit(agent, confirmationToken, locale?)`（L90-92）：带初始提交创建。
- `create(agent, branch?, locale?)`（L95-97）：标准创建。
- `initProject(agent, locale?)`（L100-102）：初始化项目。
- `inspect(agent, checkoutId, locale?)`（L105-107）：检查特定检出点。
- `reviewDiff(agent, checkoutId, expectedRevision, expectedReviewId, locale?)`（L110-112）：审查差异。
- `preflight(agent, checkoutId, expectedRevision, expectedReviewId, locale?)`（L115-117）：预检操作。
- `previewRecoveryPreflight(agent, checkoutId, expectedRevision, expectedReviewId, expectedPreviewId, locale?)`（L120-131）：预览恢复预检。
- `preparePreviewRecoveryAnalysis(agent, checkoutId, expectedRevision, expectedReviewId, expectedPreviewId, recoveryProof, locale?)`（L134-146）：准备预览恢复分析。
- `createPreviewRecoveryHandoff(agent, checkoutId, expectedRevision, expectedReviewId, expectedPreviewId, recoveryProof, locale?)`（L149-161）：创建预览恢复交接。
- `preview(agent, checkoutId, expectedRevision, expectedReviewId, locale?)`（L164-166）：预览变更。
- `checkpoint(agent, checkoutId, expectedRevision, expectedReviewId, expectedGeneration, requestId, commitMessage, locale?)`（L169-182）：检查点提交。
- `prepareReviewRegeneration(agent, checkoutId, expectedRevision, expectedReviewId, locale?)`（L185-193）：准备审查重新生成。
- `resumeRevision(agent, checkoutId, expectedRevision, expectedReviewId, conflictContinuation?, locale?)`（L196-207）：恢复修订，支持冲突继续。
- `rollbackPreview(agent, checkoutId, expectedRevision, resumeRevision?, recoveryProof?, locale?)`（L210-219）：回滚预览。
- `discard(agent, checkoutId, expectedRevision, confirmDirty, rollbackPreview?, locale?)`（L222-224）：丢弃更改。
- `finalize(agent, checkoutId, expectedRevision, expectedReviewId, commitMessage, retention, locale?)`（L227-237）：最终化操作。
- `finalizePreview(agent, checkoutId, expectedRevision, expectedReviewId, commitMessage, retention, recoveryProof?, locale?)`（L240-253）：最终化预览。
- `setRetention(agent, checkoutId, expectedRevision, retention, locale?)`（L256-264）：设置保留模式（排除 `'cleanup'`）。
- `setPermanent(agent, checkoutId, expectedRevision, permanent, locale?)`（L267-275）：设置永久状态。
- `retryCleanup(agent, checkoutId, expectedRevision, locale?)`（L278-280）：重试清理。
- `beginNextIteration(agent, checkoutId, expectedRevision, locale?)`（L283-285）：开始下一次迭代。
- `clearSidebarBadge(agent, checkoutId, expectedRevision, locale?)`（L288-290）：清除侧边栏徽章。
- `gitOverview(agent, locale?)`（L293-295）：Git 概览。
- `gitGraph(agent, limit?, locale?)`（L298-300）：Git 图。
- `gitCreateBranch(agent, name, locale?)`（L303-305）：创建分支。
- `gitSwitchBranch(agent, branch, locale?)`（L308-310）：切换分支。
- `gitPruneMergedBranches(agent, dryRun, locale?)`（L313-315）：修剪已合并分支。
- `listAbandoned(agent, locale?)`（L318-320）：列出被放弃的工作区。
- `restoreAbandoned(agent, checkoutId, locale?)`（L323-325）：恢复被放弃的工作区。

**国际化处理模式**:
- 所有对外暴露的 RPC 方法均包裹在 `withHostLanguage` 中（如 L55 等）。
- 语言优先级：传入的 `locale` > `agent.ctx` 中的设置 > `this.hostContext` 中的设置（通过 `languageFromSettings` 获取）。

### src/console-host/control-plane.ts

核心业务逻辑实现，定义 `WorktreeConsoleControlPlane` 接口及其具体实现。它是 Console 与底层 `SessionCheckoutModule` 及 Git 端口之间的适配层。

**接口与类型**:
- `WorktreeConsoleControlPlaneOptions`（L63-71）：依赖注入配置，字段包括 `module: SessionCheckoutModule`、`lookup: SessionCheckoutLookupPort`、`files: SessionCheckoutFilesPort`、`registry: SessionCheckoutRegistryPort`、`git: SessionCheckoutGitPort`、`reviewDiff: WorktreeReviewDiffReader`、`createTargetSessionId?: () => string`。
- `WorktreeConsoleControlPlane`（L73-107）：定义所有公开 API 方法签名，涵盖 `sidebarTopology`、`current`、`list`、`preflightCreate`、`createWithInitialCommit`、`create`、`initProject`、`inspect`、`reviewDiff`、`preflight`、`previewRecoveryPreflight`、`preparePreviewRecoveryAnalysis`、`createPreviewRecoveryHandoff`、`preview`、`checkpoint`、`resumeRevision`、`prepareReviewRegeneration`、`rollbackPreview`、`discard`、`finalize`、`finalizePreview`、`setRetention`、`setPermanent`、`retryCleanup`、`beginNextIteration`、`clearSidebarBadge`、`gitOverview`、`gitGraph`、`gitCreateBranch`、`gitSwitchBranch`、`gitPruneMergedBranches`、`listAbandoned`、`restoreAbandoned`。

**工厂函数**:
- `createWorktreeConsoleControlPlane(options)`（L194）：返回 `WorktreeConsoleControlPlane` 实例。`createTargetSessionId` 默认 `randomUUID`（L195）。

**内部私有辅助函数（非导出，但为核心逻辑）**:
- `recordOf(registry, checkoutId)`（L109-113）：从 Registry 读取 Checkout 记录，不存在抛 `domainError('checkout_missing')`。
- `sidebarTaskState(record)`（L115-126）：根据 `phase` 和 `delivery.state` 计算侧边栏任务状态（`finalized`/`discarded`/`recovery_required`/`preview_detached`/`preview_active`/`ready_for_review`/`working`）。Delivery 完成优先于 Phase。
- `readyReview(record)`（L128-133）：校验记录处于 `ready`+`ready_for_review`，返回 review。
- `previewReview(record)`（L135-143）：校验记录处于 `ready` 且 `preview_active`/`preview_detached`，返回 review。
- `safeRecoveryRequestId(value)`（L145-147）：验证 ID 长度 1..500 且无 `\0\r\n`。
- `safeConflictFile(file)`（L149-153）：验证冲突文件路径合法（长度≤1000，无控制字符，非绝对路径，无 `.`/`..` 段）。
- `applyConflictContinuation(result, reviewId)`（L155-178）：构造冲突恢复 Continuation，严格校验 OID 格式（40/64 十六进制）和文件列表。
- `preflightFailure(view)`（L180-192）：将预检 `blocked` 状态映射为错误码。
- `unboundLocalTarget(sessionId)`（L197-216）：获取未绑定隔离会话的本地目标视图。
- `callerTarget(sessionId)`（L218-227）：尝试 inspect 模块，若 `target_unselected` 则回退 `unboundLocalTarget`。
- `verifyCallerRoot(sessionId, record, expectedRoot)`（L229-273）：核心权限校验，处理交付后根目录验证逻辑，允许 Owner Session 在 CWD 回到 Local 后仍通过 Local Root 授权（L247-269）。
- `authorize(sessionId, checkoutId, observedCaller?)`（L275-295）：综合校验 Owner/Source 身份、Project 匹配、Root 验证及可见性。
- `linkedReadAccess(sessionId, checkoutId, observedCaller?)`（L297-355）：处理链接读取场景（非 Owner 但同链接组），涉及 Acceptance Holder 检查（L379 `acceptanceHolder`）。
- `observe(record)`（L357-369）：观察 Checkout 状态（managedRoot, snapshot, dirty），优先 `module.observeManagedCheckout`。
- `ownerSessionAvailable(record)`（L371-373）：检查 owner session 是否存在。
- `sameLocalRoot(left, right)`（L375-377）：跨平台路径比较。
- `acceptanceHolder(record)`（L379-392）：查找同 localRoot 上持有 Review Slot 的其他 Worktree。
- `projectReviewSlot<T>(record, target)`（L394-411）：若存在 Holder，修改 Target 的 `reviewSlot` 和 `capabilities`（禁用 preview/checkpoint/finalize）。
- `deliveryProofFromTarget(target)`（L413-420）：从 SessionTargetView 提取 delivery proof。
- `details(sessionId, checkoutId, observedDeliveryProof?, observedCaller?)`（L422-458）：组合访问、观察、投影生成详情。
- `mutationResponse(sessionId, checkoutId, observedDeliveryProof?)`（L460-482）：生成突变操作后响应。
- `confirmations` Map 与 `creating` Set（L484-485）：用于创建令牌与并发锁。
- `localProject(sessionId)`（L486-494）：解析调用会话的本地项目仓库。
- `projectRootFor(sessionId)`（L501-511）：解析项目根（本地根，非 managed worktree）用于 Git 分支操作。
- `withCreation(sessionId, action)`（L512-529）：防并发创建锁，基于 sessionKey + rootKey 双重互斥。
- `createTarget(sourceSessionId, branch?)`（L530-552）：调用模块创建隔离目标并验证身份一致性。

**API 实现细节（返回对象的方法，行号对应实现起始）**:
- `sidebarTopology`（L555-619）：聚合 managed checkouts，合并 membership，按 project 分组，保留历史迭代。
- `current`（L621-627）：返回 caller target 或 details。
- `gitOverview`（L629-642）：调用 `projectRootFor` 后取分支概览。
- `gitGraph`（L644-649）：取 git log 图。
- `gitCreateBranch`（L651-656）：创建本地分支。
- `gitSwitchBranch`（L658-673）：切换分支，交付中禁止（L662-669）。
- `gitPruneMergedBranches`（L675-677）：调用模块修剪。
- `listAbandoned`（L679-681）：列出放弃快照。
- `restoreAbandoned`（L683-687）：恢复放弃工作树。
- `list`（L689-764）：列出工作树，支持批量 `observeManagedCheckouts` 优化（L717-725），失败降级逐条 observe（L736-743）。
- `preflightCreate`（L766-782）：空仓库生成确认令牌（TTL 5 分钟，上限 500）。
- `createWithInitialCommit`（L783-798）：验证令牌并初始化空仓库后创建。
- `create`（L799）：带锁创建。
- `initProject`（L800-804）：初始化项目。
- `inspect`（L806）：返回 details。
- `reviewDiff`（L808-846）：**未使用 `outcome` 包裹**，手动 try/catch 返回 `failure`/`consoleFailure`，严格校验 revision/reviewId，捕获 `ReviewDiffStaleError` 转 `stale_isolated`。
- `preflight`（L848-857）：预检。
- `previewRecoveryPreflight`（L859-877）：预览恢复预检。
- `preparePreviewRecoveryAnalysis`（L879-907）：准备分析。
- `createPreviewRecoveryHandoff`（L909-956）：创建交接。
- `checkpoint`（L958-984）：检查点。
- `preview`（L986-1008）：预览，冲突抛 `apply_conflict`。
- `resumeRevision`（L1010-1071）：恢复修订，支持冲突继续。
- `prepareReviewRegeneration`（L1073-1096）：准备审查再生。
- `rollbackPreview`（L1098-1116）：回滚预览。
- `discard`（L1118-1145）：丢弃。
- `finalize`（L1147-1189）：**未使用 `outcome` 包裹**，手动捕获，冲突返回带 continuation 的失败。
- `finalizePreview`（L1191-1234）：**未使用 `outcome` 包裹**，手动捕获。
- `setRetention`（L1236-1245）：设置保留。
- `setPermanent`（L1247-1256）：设置永久。
- `retryCleanup`（L1258-1266）：重试清理。
- `clearSidebarBadge`（L1268-1280）：清除徽章。
- `beginNextIteration`（L1282-1326）：开始下次迭代，校验前置 `discarded`+`delivered`。

### src/console-host/errors.ts

统一错误类型转换和 Outcome 包装器。

- `domainError(code, message, continuation?)`（L5-11）：创建带 `code` 和可选 `continuation` 的 Error。
- `consoleFailure(error)`（L13-41）：将未知 Error 转为 `WorktreeConsoleOutcome<never>`；若 code 在 `SESSION_CHECKOUT_ERROR_CODES` 中透传，否则转 `git_error`（本地允许泄露原消息，远程需截断）。
- `failure<T>(code, message, details?, continuation?)`（L43-58）：直接构造失败 Outcome。
- `outcome<T>(operation)`（L60-66）：核心包装器，成功 `{ok:true,value}`，失败调 `consoleFailure`。

### src/console-host/projection.ts

将内部域模型（`ManagedCheckoutRecord`）转换为 UI 消费的数据结构。

- `review(record)`（L15-30）：内部，提取 review 摘要。
- `commitOid(record)`（L32-34）：内部，取交付 commit OID。
- `deliveryProof(record, observed?)`（L36-55）：内部，构建交付证明。
- `iteration(record)`（L57-59）：内部，取迭代号。
- `capabilities(record, callerSessionId, ownerSessionAvailable?, linkedRead?)`（L61-98）：**导出**，返回能力对象，全部字段（布尔）：
  - `create: false`
  - `open: readAuthorized && active && (!linkedRead || ownerSessionAvailable)`
  - `inspect: readAuthorized`
  - `discard: (owner || sourceReservation) && active && !cleanup && !previewDetached`
  - `preflight: owner && ready`
  - `preview: owner && ready`
  - `checkpoint: owner && (ready || previewActive)`
  - `resumeRevision: owner && ready`
  - `rollbackPreview: owner && (previewActive || previewDetached || previewRecovery)`
  - `finalize: owner && ready`
  - `finalizePreview: owner && (previewActive || previewDetached)`
  - `setRetention: manageAuthorized && record.delivery.state === 'retained'`
  - `setPermanent: manageAuthorized && active`
  - `retryCleanup: manageAuthorized && cleanup`
  - `beginNextIteration: owner && delivered`
- `fallbackOid(record)`（L100-103）：内部，回退 OID 计算。
- `sourceBranchFromRef(sourceRef)`（L105-107）：**导出**，从 `refs/heads/` 提取分支名。
- `projectRecord(record, callerSessionId, observed?)`（L109-183）：**导出**，构建 `WorktreeConsoleTargetSummary`，包含 project、checkoutId、sourceSessionId、ownerSessionId、targetSessionId、iteration、revision、state、phase、dirty、currentOid、commitOid、sourceBranch、retention 信息、cleanupMessage、permanent、deliveryProof、review、checkpoints、checkpointGeneration、reviewSlot、previewRecovery、capabilities 等字段。
- `projectDetails(record, callerSessionId, managedRoot, snapshot?, dirty?, ownerSessionAvailable?, linkedRead?, observedDeliveryProof?)`（L185-255）：**导出**，构建 `WorktreeConsoleTargetDetails`，继承 Summary 并补 `managedRoot`、`sourceRoot`、`sourceOid`、`currentBranch`，以及 owner 的 `recoveryContinuation` 展开。
- `projectLocal(target, sessionId)`（L257-294）：**导出**，构建 Local 目标投影，Worktree 特定能力全 false，仅 `create`（若未版本化）、`open`、`inspect` 真。

### src/console-host/review-diff.ts

高效、安全地读取 Git 差异内容，用于 Code Review。

**常量（导出）**:
- `REVIEW_DIFF_MAX_FILES = 200`（L9）
- `REVIEW_DIFF_MAX_PATCH_BYTES = 100 * 1024`（L10）
- `REVIEW_DIFF_MAX_PAYLOAD_BYTES = 1024 * 1024`（L11）

**接口/类（导出）**:
- `ReviewDiffReadInput`（L13-19）：字段 `managedRoot: string`、`baseOid: string`、`reviewId: string`、`revision: number`、`changedFiles: readonly string[]`。
- `WorktreeReviewDiffReader`（L21-23）：方法 `read(input: ReviewDiffReadInput): Promise<WorktreeConsoleReviewDiffResponse>`。
- `ReviewDiffStaleError`（L25-30）：自定义错误类，表示快照过期。
- `createGitWorktreeReviewDiffReader(projectSkills?)`（L123-244）：工厂函数，返回 reader 对象。

**内部辅助（非导出）**:
- `GitOutput` 接口（L32-32）：字段 `stdout: Buffer`、`truncated: boolean`。
- `git(cwd, args, env, maxBytes)`（L34-64）：spawn git 并截断输出。
- `projectPath(value)`（L66-70）：校验项目相对路径安全。
- `utf8Prefix(value, maxBytes)`（L72-78）：UTF-8 安全截断。
- `payloadBytes(response)`（L80-82）：计算 JSON 字节。
- `ChangedEntry` 接口（L84-88）：`path`、`previousPath?`、`status`。
- `parseNameStatus(output)`（L90-113）：解析 `git diff --name-status -z`。
- `sortedUnique(values)`（L115-117）：排序去重。
- `changedPathSet(entries)`（L119-121）：收集变更路径集。
- `read` 实现逻辑（L125-243）：建临时对象目录，用 `GIT_ALTERNATE_OBJECT_DIRECTORIES` 避免复制；`read-tree` 基线；技能追踪移除；`diff --cached --name-status` 取列表；校验一致性抛 `ReviewDiffStaleError`；分批并行（每批 8）取证 numstat 和 patch；总负载超 `MAX_PAYLOAD_BYTES` 时截断当前 patch 并停止。

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
│         src/console-host/service.ts (L34 class)                      │
│   - @Remote Methods (42 endpoints)                                   │
│   - i18n wrapping (withHostLanguage)                                 │
│   - Diagnostics appendDiag (L46)                                     │
└──────────────────────────┬───────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│                  Control Plane Implementation                        │
│         src/console-host/control-plane.ts (L194 factory)             │
│   - authorize()/linkedReadAccess() (L275/L297)                       │
│   - withCreation() Mutex (L512)                                      │
│   - CRUD & Mutation Operations                                       │
│   - Git Operations (overview/graph/branch/prune)                     │
└──────────────────────────┬───────────────────────────────────────────┘
                           │
      ┌────────────────────┼────────────────────┐
      ▼                    ▼                    ▼
┌─────────────┐   ┌─────────────┐   ┌────────────────────┐
│ Session     │   │ Registry    │   │ Git Adapter        │
│ Checkout    │   │ (State DB)  │   │ (Inspect/Status)   │
│ Module      │   │ L109        │   │                    │
└─────────────┘   └─────────────┘   └────────────────────┘
      │
      ▼
┌──────────────────────────────────────────────────────────────────────┐
│   Projection (projection.ts) & ReviewDiff (review-diff.ts)           │
│   projectRecord/projectDetails (L109/L185) | createGitWorktree...    │
└──────────────────────────────────────────────────────────────────────┘
```

## Data Flow

1. **RPC 入口**：客户端发起 RPC 调用，`WorktreeConsoleService` 接收（如 L54 起），通过 `withHostLanguage` 设置本地化上下文（L55 等）。
2. **授权与验证**：控制面方法首先调用 `authorize`（L275）或 `linkedReadAccess`（L297）验证会话权限、项目匹配性和根目录一致性（`verifyCallerRoot` L229）。
3. **并发守卫**：对于创建类操作，`withCreation`（L512）使用 `creating` Set 进行双重互斥（sessionKey + rootKey），防止竞态。
4. **状态观察**：读操作（如 `list` L689、`current` L621）调用 `observe`（L357）获取最新 Git 状态，优先批量 `observeManagedCheckouts`（L718）失败降级逐条。
5. **业务逻辑**：根据操作类型调用 `module.operate`（如 L965 checkpoint）或 `module.createIsolatedTarget`（L532）等执行实际工作树管理。
6. **投影**：结果通过 `projection.ts` 函数（`projectRecord` L109、`projectDetails` L185、`capabilities` L61）转换为 UI 格式，包括能力计算和状态映射。
7. **响应包装**：多数方法通过 `outcome`（errors.ts L60）包装为 `WorktreeConsoleOutcome`；但 `reviewDiff` (L808)、`finalize` (L1147)、`finalizePreview` (L1191) 手动 try/catch 返回 `failure`/`consoleFailure`。

## Connections

- [[session-checkout-module|Session Checkout State Machine]]：核心状态机，提供 `operate`、`preflight`、`createIsolatedTarget`、`beginNextIteration` 等方法（control-plane.ts L965、L532、L1306 等）。
- [[host-overview|Host Entry and Registration Surface]]：宿主入口与注册机制，此处 `TypertRemoteService` 子类由 Gateway 解析 `agentId` 前挂载（service.ts L33 注释）。
- [[adapters|Adapter Layer]]：Git 适配器（`SessionCheckoutGitPort`）和文件系统适配器（`SessionCheckoutFilesPort`），在 control-plane.ts L66-68 注入。
- [[i18n-host|Host i18n]]：`withHostLanguage`、`languageFromSettings`、`hostMessage` 来自 `../i18n/host.js`，用于多语言消息。

## Known Issues

- **诊断隔离**：`appendDiag`（service.ts L46-51）静默捕获异常，诊断写入失败不可见，但确保不破坏 RPC 表面。
- **语言回退**：若 `agent.ctx` 与 `hostContext` 均未设语言，`languageFromSettings`（service.ts L76 等）提供默认，具体行为依赖 `../i18n/host.js`。
- **错误传播差异**：`reviewDiff`/`finalize`/`finalizePreview`（control-plane.ts L808、L1147、L1191）未使用 `outcome` 包装，而是内部 try/catch 返回 `failure` 或 `consoleFailure`，其余方法多用 `outcome` 包裹；未统一。
- **批量观察降级**：`list` 中 `observeManagedCheckouts` 若抛错则整批降级逐条 observe（L718-725），个别记录观察失败以无观察投影呈现（L739-743），后续 CAS 校验兜底。
- **空仓库创建令牌限制**：`confirmations` Map 上限 500，TTL 5 分钟（L777-780），高并发空仓库初始化可能淘汰旧令牌。
- **预览恢复能力禁用**：当 `projectReviewSlot` 检测到 `acceptanceHolder` 存在时，强制将 `capabilities` 中 `preview`/`checkpoint`/`finalize` 置 false（projection.ts L408），可能导致 UI 混淆。
- **本地错误消息泄露**：`consoleFailure`（errors.ts L34-40）对非契约错误直接使用原 Error message，注释标明仅本地控制台允许，远程传输前需脱敏（ponytail 标记）。