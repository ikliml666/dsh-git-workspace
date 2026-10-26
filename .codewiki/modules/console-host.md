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

## Overview

该模块在宿主进程中暴露 Git Worktree 的控制平面，采用三层架构：客户端 UI（Worktree 卡片/验收界面）↔ strict Typert RPC（`gitWorktree` 服务）↔ 宿主控制面。控制面将状态机（[[session-checkout-module|Session Checkout Module]]）的领域能力投影为 UI 可用的读/写端点，并集中实现授权、并发守卫与 Git 操作封装。

`src/console-host/service.ts` 中的 `WorktreeConsoleService` 类（L34）继承自 `TypertRemoteService`，构造函数中调用 `super(hostContext, 'gitWorktree')`（L42）注册服务名。它不直接处理复杂 Git 逻辑，而是通过 `controlPlane` 实例（L37）协调底层操作。所有对外接口均通过 `@Remote` 装饰器暴露，支持多语言本地化（`withHostLanguage`，L2、L55 等）和严格参数校验。

核心职责包括：
- **RPC 适配**：通过 `service.ts` 将内部逻辑包装为 Typert Remote 调用。
- **权限与一致性**：通过 `authorize`（control-plane.ts L298）和 `linkedReadAccess`（L320）确保会话所有权、项目匹配及根目录一致性。
- **并发安全**：通过 `withCreation`（L535）实现基于 Session 和 Root 的双重互斥，防止并发创建冲突。
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
- `appendDiag(line)`（L46-51）：使用 `appendFileSync` 同步写入 JSON 行到指定文件。采用“尽力而为”策略，捕获异常以防止破坏 RPC 表面（L50 `catch { /* best effort */ }`）。记录内容包括时间戳、操作结果、项目数量、主机 flavor 及锚点信息。

**公开 RPC 方法（均使用 `@Remote` 装饰，行号区间含装饰器与函数体）**:
- `sidebarTopology(locale?)`（L53-66）：返回侧边栏拓扑，附加 `workspaceClientFlavor` 和 `officialWorkspaceActive`，并记录诊断。
- `clientBootReport(report)`（L68-72）：接收客户端启动报告，仅记录诊断并返回 `true`。
- `current(agent, locale?)`（L74-85）：获取当前工作区状态，注入诊断面包屑。
- `list(agent, needsAttention?, includeDelivered?, locale?)`（L87-90）：列出工作区。
- `preflightCreate(agent, locale?)`（L92-95）：创建前预检。
- `createWithInitialCommit(agent, confirmationToken, locale?)`（L97-100）：带初始提交创建。
- `create(agent, branch?, locale?)`（L102-105）：标准创建。
- `initProject(agent, locale?)`（L107-110）：初始化项目。
- `inspect(agent, checkoutId, locale?)`（L112-115）：检查特定检出点。
- `reviewDiff(agent, checkoutId, expectedRevision, expectedReviewId, locale?)`（L117-120）：审查差异。
- `preflight(agent, checkoutId, expectedRevision, expectedReviewId, locale?)`（L122-125）：预检操作。
- `previewRecoveryPreflight(agent, checkoutId, expectedRevision, expectedReviewId, expectedPreviewId, locale?)`（L127-139）：预览恢复预检。
- `preparePreviewRecoveryAnalysis(agent, checkoutId, expectedRevision, expectedReviewId, expectedPreviewId, recoveryProof, locale?)`（L141-154）：准备预览恢复分析。
- `createPreviewRecoveryHandoff(agent, checkoutId, expectedRevision, expectedReviewId, expectedPreviewId, recoveryProof, locale?)`（L156-169）：创建预览恢复交接。
- `preview(agent, checkoutId, expectedRevision, expectedReviewId, locale?)`（L171-174）：预览变更。
- `checkpoint(agent, checkoutId, expectedRevision, expectedReviewId, expectedGeneration, requestId, commitMessage, locale?)`（L176-190）：检查点提交。
- `prepareReviewRegeneration(agent, checkoutId, expectedRevision, expectedReviewId, locale?)`（L192-201）：准备审查重新生成。
- `resumeRevision(agent, checkoutId, expectedRevision, expectedReviewId, conflictContinuation?, locale?)`（L203-215）：恢复修订，支持冲突继续。
- `rollbackPreview(agent, checkoutId, expectedRevision, resumeRevision?, recoveryProof?, locale?)`（L217-227）：回滚预览。
- `discard(agent, checkoutId, expectedRevision, confirmDirty, rollbackPreview?, locale?)`（L229-232）：丢弃更改。
- `finalize(agent, checkoutId, expectedRevision, expectedReviewId, commitMessage, retention, locale?)`（L234-245）：最终化操作。
- `finalizePreview(agent, checkoutId, expectedRevision, expectedReviewId, commitMessage, retention, recoveryProof?, locale?)`（L247-261）：最终化预览，其中 `recoveryProof?` 参数在 L255 声明。
- `setRetention(agent, checkoutId, expectedRevision, retention, locale?)`（L263-272）：设置保留模式，L268 明确将参数类型约束为 `Exclude<WorktreeRetentionMode, 'cleanup'>`（即禁用 cleanup 保留模式）。
- `setPermanent(agent, checkoutId, expectedRevision, permanent, locale?)`（L274-283）：设置永久状态。
- `retryCleanup(agent, checkoutId, expectedRevision, locale?)`（L285-288）：重试清理。
- `beginNextIteration(agent, checkoutId, expectedRevision, locale?)`（L290-293）：开始下一次迭代。
- `clearSidebarBadge(agent, checkoutId, expectedRevision, locale?)`（L295-298）：清除侧边栏徽章。
- `gitOverview(agent, locale?)`（L300-303）：Git 概览。
- `gitGraph(agent, limit?, locale?)`（L305-308）：Git 图。
- `gitCreateBranch(agent, name, locale?)`（L310-313）：创建分支。
- `gitSwitchBranch(agent, branch, locale?)`（L315-318）：切换分支。
- `gitPruneMergedBranches(agent, dryRun, locale?)`（L320-323）：修剪已合并分支。
- `listAbandoned(agent, locale?)`（L325-328）：列出被放弃的工作区。
- `restoreAbandoned(agent, checkoutId, locale?)`（L330-333）：恢复被放弃的工作区。

**国际化处理模式**:
- 所有对外暴露的 RPC 方法均包裹在 `withHostLanguage` 中（如 L55）。
- 语言优先级：传入的 `locale` > `agent.ctx` 中的设置 > `this.hostContext` 中的设置（通过 `languageFromSettings` 获取，L76 等）。

**注意**：control-plane.ts 中实现了 `gitListTags`、`gitCreateTag`、`gitDeleteTag`、`gitPushTag`（L702-747），但 `service.ts` 未提供对应的 `@Remote` 方法，宿主 RPC 面目前无法直接调用标签管理。

### src/console-host/control-plane.ts

核心业务逻辑实现，定义 `WorktreeConsoleControlPlane` 接口及其具体实现。它是 Console 与底层 `SessionCheckoutModule` 及 Git 端口之间的适配层。

**接口与类型**:
- `WorktreeConsoleControlPlaneOptions`（L68-76）：依赖注入配置，字段包括 `module: SessionCheckoutModule`、`lookup: SessionCheckoutLookupPort`、`files: SessionCheckoutFilesPort`、`registry: SessionCheckoutRegistryPort`、`git: SessionCheckoutGitPort`、`reviewDiff: WorktreeReviewDiffReader`、`createTargetSessionId?: () => string`。
- `WorktreeConsoleControlPlane`（L78-116）：定义所有公开 API 方法签名，涵盖 `sidebarTopology`、`current`、`list`、`preflightCreate`、`createWithInitialCommit`、`create`、`initProject`、`inspect`、`reviewDiff`、`preflight`、`previewRecoveryPreflight`、`preparePreviewRecoveryAnalysis`、`createPreviewRecoveryHandoff`、`preview`、`checkpoint`、`resumeRevision`、`prepareReviewRegeneration`、`rollbackPreview`、`discard`、`finalize`、`finalizePreview`、`setRetention`、`setPermanent`、`retryCleanup`、`beginNextIteration`、`clearSidebarBadge`、`gitOverview`、`gitGraph`、`gitCreateBranch`、`gitSwitchBranch`、`gitPruneMergedBranches`、`listAbandoned`、`restoreAbandoned`，并在 L110-113 声明了 `gitListTags`、`gitCreateTag`、`gitDeleteTag`、`gitPushTag`。

**工厂函数**:
- `createWorktreeConsoleControlPlane(options)`（L203-1397）：返回 `WorktreeConsoleControlPlane` 实例。`createTargetSessionId` 默认 `randomUUID`（L204）。

**内部私有辅助函数（非导出，但为核心逻辑）**:
- `recordOf(registry, checkoutId)`（L118-122）：从 Registry 读取 Checkout 记录，不存在抛 `domainError('checkout_missing')`。
- `sidebarTaskState(record)`（L124-135）：根据 `phase` 和 `delivery.state` 计算侧边栏任务状态。Delivery 完成优先于 Phase（L128）。
- `readyReview(record)`（L137-142）：校验记录处于 `ready`+`ready_for_review`，返回 review。
- `previewReview(record)`（L144-152）：校验记录处于 `ready` 且 `preview_active`/`preview_detached`，返回 review。
- `safeRecoveryRequestId(value)`（L154-156）：验证 ID 长度 1..500 且无 `\0\r\n`。
- `safeConflictFile(file)`（L158-162）：验证冲突文件路径合法（长度≤1000，无控制字符，非绝对路径，无 `.`/`..` 段）。
- `applyConflictContinuation(result, reviewId)`（L164-187）：构造冲突恢复 Continuation，严格校验 OID 格式（40/64 十六进制）和文件列表。
- `preflightFailure(view)`（L189-201）：将预检 `blocked` 状态映射为错误码。
- `unboundLocalTarget(sessionId)`（L206-225）：获取未绑定隔离会话的本地目标视图。
- `callerTarget(sessionId)`（L227-236）：尝试 inspect 模块，若 `target_unselected` 则回退 `unboundLocalTarget`。
- `verifyCallerRoot(sessionId, record, expectedRoot)`（L238-296）：核心权限校验，处理交付后根目录验证逻辑（含 liveCwd 与 workspace-root 回退）。
- `authorize(sessionId, checkoutId, observedCaller?)`（L298-318）：综合校验 Owner/Source 身份、Project 匹配、Root 验证及可见性。
- `linkedReadAccess(sessionId, checkoutId, observedCaller?)`（L320-378）：处理链接读取场景（非 Owner 但同链接组），涉及 Acceptance Holder 检查（L402 `acceptanceHolder`）。
- `observe(record)`（L380-392）：观察 Checkout 状态，优先 `module.observeManagedCheckout`，否则解析 managedRoot 并 inspect。
- `ownerSessionAvailable(record)`（L394-396）：检查 owner session 是否存在。
- `sameLocalRoot(left, right)`（L398-400）：跨平台路径比较（win32 忽略大小写）。
- `acceptanceHolder(record)`（L402-415）：查找同 localRoot 上持有 Review Slot 的其他 Worktree。
- `projectReviewSlot<T>(record, target)`（L417-434）：若存在 Holder，修改 Target 的 `reviewSlot` 和 `capabilities`（L431 强制将 `preview`、`checkpoint`、`finalize` 置 false）。
- `deliveryProofFromTarget(target)`（L436-443）：从 SessionTargetView 提取 delivery proof。
- `details(sessionId, checkoutId, observedDeliveryProof?, observedCaller?)`（L445-481）：组合访问、观察、投影生成详情。
- `mutationResponse(sessionId, checkoutId, observedDeliveryProof?)`（L483-505）：生成突变操作后响应。
- `confirmations` Map 与 `creating` Set（L507-508）：用于创建令牌与并发锁。
- `localProject(sessionId)`（L509-517）：解析调用会话的本地项目仓库。
- `projectRootFor(sessionId)`（L524-534）：解析项目根（本地根，非 managed worktree）用于 Git 分支操作。
- `withCreation(sessionId, action)`（L535-552）：防并发创建锁，基于 sessionKey + rootKey 双重互斥。
- `createTarget(sourceSessionId, branch?)`（L553-575）：调用模块创建隔离目标并验证身份一致性。

**API 实现细节（返回对象的方法，行号对应实现起始）**:
- `sidebarTopology`（L578-642）：聚合 managed checkouts，合并 membership，按 project 分组，处理已清除徽章（L603-609）。
- `current`（L644-650）：返回 caller target 或 details。
- `gitOverview`（L652-665）：调用 `projectRootFor` 后取分支概览，返回 `root`、`branch`、`headOid`、`branches`、`dirtyCount`。
- `gitGraph`（L667-672）：取 git log 图，若 `options.git.graphLog` 未定义则抛出 `git_error`（L669）。
- `gitCreateBranch`（L674-679）：创建本地分支，若 `options.git.createLocalBranch` 未定义则抛出错误（L676）。
- `gitSwitchBranch`（L681-696）：切换分支，交付中禁止（L685-692 遍历 registry 检查 `delivering`）。
- `gitPruneMergedBranches`（L698-700）：调用模块修剪。
- `gitListTags`（L702-708）：列出 Git 标签，若 `options.git.listTags` 未定义或返回 null 则抛出 `git_error`。
- `gitCreateTag`（L710-720）：创建标签，支持推送（L714-719 软降级处理 `pushMessage`）。
- `gitDeleteTag`（L722-736）：删除标签，远程优先（L726-732 先处理 `request.remote` 远程删除再本地删除）。
- `gitPushTag`（L738-747）：推送标签，软降级（L744-746 返回 `pushed: false` 和 `pushMessage`）。
- `listAbandoned`（L749-751）：列出放弃快照。
- `restoreAbandoned`（L753-757）：恢复放弃工作树。
- `list`（L759-834）：列出工作树，支持批量 `observeManagedCheckouts` 优化（L788-795），失败降级逐条 observe（L809-813）。
- `preflightCreate`（L836-852）：空仓库生成确认令牌（TTL 5 分钟，上限 500，L847-851）。
- `createWithInitialCommit`（L853-868）：验证令牌并初始化空仓库后创建。
- `create`（L869）：带锁创建。
- `initProject`（L870-874）：初始化项目。
- `inspect`（L876）：返回 details。
- `reviewDiff`（L878-916）：**未使用 `outcome` 包裹**，手动 try/catch 返回 `failure`/`consoleFailure`，严格校验 revision/reviewId，捕获 `ReviewDiffStaleError` 转 `stale_isolated`（L913）。
- `preflight`（L918-927）：预检。
- `previewRecoveryPreflight`（L929-947）：预览恢复预检。
- `preparePreviewRecoveryAnalysis`（L949-977）：准备分析。
- `createPreviewRecoveryHandoff`（L979-1026）：创建交接。
- `checkpoint`（L1028-1054）：检查点。
- `preview`（L1056-1078）：预览，冲突抛 `apply_conflict`（L1066-1071）。
- `resumeRevision`（L1080-1141）：恢复修订，支持冲突继续。
- `prepareReviewRegeneration`（L1143-1166）：准备审查再生。
- `rollbackPreview`（L1168-1186）：回滚预览。
- `discard`（L1188-1215）：丢弃。
- `finalize`（L1217-1259）：**未使用 `outcome` 包裹**，手动捕获，冲突返回带 continuation 的失败（L1235-1241）。
- `finalizePreview`（L1261-1304）：**未使用 `outcome` 包裹**，手动捕获。
- `setRetention`（L1306-1315）：设置保留。
- `setPermanent`（L1317-1326）：设置永久。
- `retryCleanup`（L1328-1336）：重试清理。
- `clearSidebarBadge`（L1338-1350）：清除徽章。
- `beginNextIteration`（L1352-1396）：开始下次迭代，校验前置 `discarded`+`delivered`（L1360-1361）。

### src/console-host/errors.ts

统一错误类型转换和 Outcome 包装器。

- `domainError(code, message, continuation?)`（L5-11）：创建带 `code` 和可选 `continuation` 的 Error。
- `consoleFailure(error)`（L13-41）：将未知 Error 转为 `WorktreeConsoleOutcome<never>`；若 code 在 `SESSION_CHECKOUT_ERROR_CODES` 中透传，否则转 `git_error`（L34-40）。L33 注释标明本地允许泄露原消息，远程需脱敏。
- `failure<T>(code, message, details?, continuation?)`（L43-58）：直接构造失败 Outcome。
- `outcome<T>(operation)`（L60-66）：核心包装器，成功 `{ok:true,value}`，失败调 `consoleFailure`。

### src/console-host/projection.ts

将内部域模型（`ManagedCheckoutRecord`）转换为 UI 消费的数据结构。

- `review(record)`（L15-30）：内部，提取 review 摘要。
- `commitOid(record)`（L32-34）：内部，取交付 commit OID。
- `deliveryProof(record, observed?)`（L36-55）：内部，构建交付证明。
- `iteration(record)`（L57-59）：内部，取迭代号。
- `capabilities(record, callerSessionId, ownerSessionAvailable?, linkedRead?)`（L61-98）：**导出**，返回能力对象，全部字段（布尔）：

| 字段 | 表达式 / 值 | 行号 |
| --- | --- | --- |
| `create` | `false`（硬编码禁用，创建只能从 Local 发起） | L82 |
| `open` | `readAuthorized && active && (!linkedRead || ownerSessionAvailable)` | L83 |
| `inspect` | `readAuthorized` | L84 |
| `discard` | `(owner || sourceReservation) && active && !cleanup && !previewDetached` | L85 |
| `preflight` | `owner && ready` | L86 |
| `preview` | `owner && ready` | L87 |
| `checkpoint` | `owner && (ready || previewActive)` | L88 |
| `resumeRevision` | `owner && ready` | L89 |
| `rollbackPreview` | `owner && (previewActive || previewDetached || previewRecovery)` | L90 |
| `finalize` | `owner && ready` | L91 |
| `finalizePreview` | `owner && (previewActive || previewDetached)` | L92 |
| `setRetention` | `manageAuthorized && record.delivery.state === 'retained'` | L93 |
| `setPermanent` | `manageAuthorized && active` | L94 |
| `retryCleanup` | `manageAuthorized && cleanup` | L95 |
| `beginNextIteration` | `owner && delivered` | L96 |

- `fallbackOid(record)`（L100-103）：内部，回退 OID 计算。
- `sourceBranchFromRef(sourceRef)`（L105-107）：**导出**，从 `refs/heads/` 提取分支名。
- `projectRecord(record, callerSessionId, observed?)`（L109-183）：**导出**，构建 `WorktreeConsoleTargetSummary`，含 project、checkoutId、sourceSessionId、ownerSessionId、targetSessionId、iteration、revision、state、phase、dirty、currentOid、commitOid、sourceBranch、retention/permanent/reviewSlot/previewRecovery 等字段。
- `projectDetails(record, callerSessionId, managedRoot, snapshot?, dirty?, ownerSessionAvailable?, linkedRead?, observedDeliveryProof?)`（L185-255）：**导出**，构建 `WorktreeConsoleTargetDetails`，继承 Summary 并补 `managedRoot`、`sourceRoot`、`sourceOid`、`currentBranch`，以及 owner 的 `recoveryContinuation` 展开（L212-253）。
- `projectLocal(target, sessionId)`（L257-294）：**导出**，构建 Local 目标投影，Worktree 特定能力全 false，仅 `create`（若 `target.current.oid !== 'unversioned'` 则 true，L273）、`open`、`inspect` 真。

### src/console-host/review-diff.ts

高效、安全地读取 Git 差异内容，用于 Code Review。

**常量（导出）**:

| 常量 | 值 | 行号 |
| --- | --- | --- |
| `REVIEW_DIFF_MAX_FILES` | `200` | L9 |
| `REVIEW_DIFF_MAX_PATCH_BYTES` | `100 * 1024` | L10 |
| `REVIEW_DIFF_MAX_PAYLOAD_BYTES` | `1024 * 1024` | L11 |
| `REVIEW_DIFF_BATCH_SIZE` | `8`（内部批处理常量） | L184 |

**接口/类（导出）**:
- `ReviewDiffReadInput`（L13-19）：字段 `managedRoot`、`baseOid`、`reviewId`、`revision`、`changedFiles`。
- `WorktreeReviewDiffReader`（L21-23）：方法 `read(input)`。
- `ReviewDiffStaleError`（L25-30）：自定义错误类，表示快照过期。
- `createGitWorktreeReviewDiffReader(projectSkills?)`（L123-244）：工厂函数，返回 reader 对象。

**内部辅助（非导出）**:
- `GitOutput` 接口（L32）：字段 `stdout: Buffer`、`truncated: boolean`。
- `git(cwd, args, env, maxBytes)`（L34-64）：spawn git 并截断输出。
- `projectPath(value)`（L66-70）：校验项目相对路径安全。
- `utf8Prefix(value, maxBytes)`（L72-78）：UTF-8 安全截断。
- `payloadBytes(response)`（L80-82）：计算 JSON 字节。
- `ChangedEntry` 接口（L84-88）：`path`、`previousPath?`、`status`。
- `parseNameStatus(output)`（L90-113）：解析 `git diff --name-status -z`。
- `sortedUnique(values)`（L115-117）：排序去重。
- `changedPathSet(entries)`（L119-121）：收集变更路径集。
- `read` 实现逻辑（L125-243）：建临时对象目录，用 `GIT_ALTERNATE_OBJECT_DIRECTORIES` 避免复制；`read-tree` 基线；技能追踪移除；`diff --cached --name-status` 取列表；校验一致性抛 `ReviewDiffStaleError`；分批并行（每批 8，L184）取证 numstat 和 patch；总负载超 `MAX_PAYLOAD_BYTES` 时截断当前 patch 并停止。

## Architecture

```text
┌──────────────┐   ┌────────────────────┐
│ Client UI    │──▶│ WorktreeConsole    │
│ (Cards)      │   │ Service (L34)      │
└──────────────┘   └─────────┬──────────┘
                             │ RPC
                             ▼
┌──────────────┐   ┌────────────────────┐
│ Projection   │◀──│ ControlPlane (L203)│
│ L109/L185    │   │ authorize L298     │
│ ReviewDiff   │   └─────────┬──────────┘
│ L123         │            │ calls
└──────────────┘   ┌─────────▼──────────┐
                  │ Module/Registry/Git │
                  └────────────────────┘
```

## Data Flow

1. **RPC 入口**：客户端发起 RPC 调用，`WorktreeConsoleService` 接收（如 `sidebarTopology` L53 起），通过 `withHostLanguage` 设置本地化上下文（L55 等）。
2. **授权与验证**：控制面方法首先调用 `authorize`（L298）或 `linkedReadAccess`（L320）验证会话权限、项目匹配性和根目录一致性（`verifyCallerRoot` L238）。
3. **并发守卫**：对于创建类操作，`withCreation`（L535）使用 `creating` Set 进行双重互斥（sessionKey + rootKey，L536-546），防止竞态。
4. **状态观察**：读操作（如 `list` L759、`current` L644）调用 `observe`（L380）获取最新 Git 状态，优先批量 `observeManagedCheckouts`（L788）失败降级逐条（L809）。
5. **业务逻辑**：根据操作类型调用 `module.operate`（如 `checkpoint` L1035）或 `module.createIsolatedTarget`（L555）等执行实际工作树管理。
6. **投影**：结果通过 `projection.ts` 函数（`projectRecord` L109、`projectDetails` L185、`capabilities` L61）转换为 UI 格式，包括能力计算和状态映射。
7. **响应包装**：多数方法通过 `outcome`（errors.ts L60）包装为 `WorktreeConsoleOutcome`；但 `reviewDiff` (L878)、`finalize` (L1217)、`finalizePreview` (L1261) 手动 try/catch 返回 `failure`/`consoleFailure`。

## Connections

- [[session-checkout-module|Session Checkout State Machine]]：核心状态机，提供 `operate`、`preflight`、`createIsolatedTarget`、`beginNextIteration` 等方法（control-plane.ts L1035、L555、L1376 等）。
- [[host-overview|Host Entry and Registration Surface]]：宿主入口与注册机制，此处 `TypertRemoteService` 子类由 Gateway 解析 `agentId` 前挂载（service.ts L33 注释）。
- [[adapters|Adapter Layer]]：Git 适配器（`SessionCheckoutGitPort`）和文件系统适配器（`SessionCheckoutFilesPort`），在 control-plane.ts L71-73 注入。
- [[i18n-host|Host i18n]]：`withHostLanguage`、`languageFromSettings`、`hostMessage` 来自 `../i18n/host.js`，用于多语言消息。
- [[console-contract|Console Contract]]：类型定义如 `WorktreeConsoleOutcome`、各类 Response 来自 `../console-contract.js`，被 service.ts 与 control-plane.ts 广泛引用。

## Known Issues

- **诊断隔离**：`appendDiag`（service.ts L46-51）静默捕获异常（L50 `catch { /* best effort */ }`），诊断写入失败不可见，但确保不破坏 RPC 表面。
- **语言回退**：若 `agent.ctx` 与 `hostContext` 均未设语言，`languageFromSettings`（service.ts L76 等）提供默认，具体行为依赖 `../i18n/host.js`。
- **错误传播差异**：`reviewDiff`/`finalize`/`finalizePreview`（control-plane.ts L878、L1217、L1261）未使用 `outcome` 包装，而是内部 try/catch 返回 `failure` 或 `consoleFailure`，其余方法多用 `outcome` 包裹；未统一。
- **批量观察降级**：`list` 中 `observeManagedCheckouts` 若抛错则整批降级逐条 observe（L788-795），个别记录观察失败以无观察投影呈现（L809-813），后续 CAS 校验兜底。
- **空仓库创建令牌限制**：`confirmations` Map 上限 500，TTL 5 分钟（L847-851），高并发空仓库初始化可能淘汰旧令牌。
- **预览恢复能力禁用**：当 `projectReviewSlot` 检测到 `acceptanceHolder` 存在时，强制将 `capabilities` 中 `preview`/`checkpoint`/`finalize` 置 false（projection.ts L431），可能导致 UI 混淆。
- **本地错误消息泄露**：`consoleFailure`（errors.ts L34-40）对非契约错误直接使用原 Error message，注释标明仅本地控制台允许，远程传输前需脱敏（L33 标记）。
- **标签管理 RPC 未暴露**：control-plane 实现了 `gitListTags`、`gitCreateTag`、`gitDeleteTag`、`gitPushTag`（L702-747），接口也已声明（L110-113），但 `service.ts` 中未提供对应的 `@Remote` 方法，宿主 RPC 面目前无法直接调用标签管理。