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

`src/console-host/service.ts` 中的 `WorktreeConsoleService` 类（L34）继承自 `TypertRemoteService`，构造函数中调用 `super(hostContext, 'gitWorktree')`（L42）注册服务名。Gateway 在业务逻辑运行前解析 `agentId`（L33 注释）。它不直接处理复杂 Git 逻辑，而是通过 `controlPlane` 实例（L37）协调底层操作。所有对外接口均通过 `@Remote` 装饰器暴露，支持多语言本地化（`withHostLanguage`，L2、L55 等）和严格参数校验。

核心职责包括：
- **RPC 适配**：通过 `service.ts` 将内部逻辑包装为 Typert Remote 调用。
- **权限与一致性**：通过 `authorize`（control-plane.ts L315）和 `linkedReadAccess`（L337）确保会话所有权、项目匹配及根目录一致性。
- **并发安全**：通过 `withCreation`（L552）实现基于 Session 和 Root 的双重互斥，防止并发创建冲突。
- **状态投影**：利用 `projection.ts` 中的辅助函数将内部记录转换为 UI 友好的目标视图（Target Details / Summary）。
- **差异读取**：`review-diff.ts` 提供安全的 Git diff 取证，用于审查界面。

## Key Components

### src/console-host/service.ts

Typert RPC 服务层，继承自 `TypertRemoteService`（L34），充当网关层。负责参数校验、国际化上下文注入（通过 `withHostLanguage`）、诊断日志记录，并将请求路由至 `controlPlane` 实例。

**构造函数依赖（L35-43）**:
- `hostContext`: 运行时上下文（L36）。
- `controlPlane`: `WorktreeConsoleControlPlane` 实例，实际业务逻辑执行者（L37）。
- `diagFile?`: 可选的诊断文件路径，用于追加 NDJSON 格式的调试信息（L38）。
- `officialWorkspaceActive`: 布尔值，标记官方工作区是否处于活跃状态（来自 mountWorkspaceProviderLifecycle 的 provider 选举结果），默认 `true`（L39-40）。

**关键私有方法**:
- `appendDiag(line)`（L46-51）：使用 `appendFileSync` 同步写入 JSON 行到指定文件。采用“尽力而为”策略，捕获异常以防止破坏 RPC 表面（L50 `catch { /* best effort */ }`）。记录内容包括时间戳、操作结果、项目数量、主机 flavor（L56 `hostWorkspaceClientFlavor`）及锚点信息（L61 `workspaceFlavorDiagnostics().anchors`）。

**公开 RPC 方法（均使用 `@Remote` 装饰，行号区间含装饰器与函数体）**:
- `sidebarTopology(locale?)`（L53-66）：返回侧边栏拓扑，附加 `workspaceClientFlavor` 和 `officialWorkspaceActive`（L64），并记录诊断（L57-62）。
- `clientBootReport(report)`（L68-72）：接收客户端启动报告，仅记录诊断并返回 `true`。
- `current(agent, locale?)`（L74-85）：获取当前工作区状态，注入诊断面包屑（L79-83）。
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

**注意**：control-plane.ts 中实现了 `gitListTags`（L719-725）、`gitCreateTag`（L727-737）、`gitDeleteTag`（L739-753）、`gitPushTag`（L755-764），且接口 `WorktreeConsoleControlPlane` 在 L110-113 声明了这些方法，但 `service.ts` 未提供对应的 `@Remote` 方法，宿主 RPC 面目前无法直接调用标签管理。

### src/console-host/control-plane.ts

核心业务逻辑实现，定义 `WorktreeConsoleControlPlane` 接口及其具体实现。它是 Console 与底层 `SessionCheckoutModule` 及 Git 端口之间的适配层。

**接口与类型**:
- `WorktreeConsoleControlPlaneOptions`（L68-76）：依赖注入配置，字段包括 `module: SessionCheckoutModule`、`lookup: SessionCheckoutLookupPort`、`files: SessionCheckoutFilesPort`、`registry: SessionCheckoutRegistryPort`、`git: SessionCheckoutGitPort`、`reviewDiff: WorktreeReviewDiffReader`、`createTargetSessionId?: () => string`。
- `WorktreeConsoleControlPlane`（L78-116）：定义所有公开 API 方法签名，涵盖 `sidebarTopology`、`current`、`list`、`preflightCreate`、`createWithInitialCommit`、`create`、`initProject`、`inspect`、`reviewDiff`、`preflight`、`previewRecoveryPreflight`、`preparePreviewRecoveryAnalysis`、`createPreviewRecoveryHandoff`、`preview`、`checkpoint`、`resumeRevision`、`prepareReviewRegeneration`、`rollbackPreview`、`discard`、`finalize`、`finalizePreview`、`setRetention`、`setPermanent`、`retryCleanup`、`beginNextIteration`、`clearSidebarBadge`、`gitOverview`、`gitGraph`、`gitCreateBranch`、`gitSwitchBranch`、`gitPruneMergedBranches`、`listAbandoned`、`restoreAbandoned`，并在 L110-113 声明了 `gitListTags`、`gitCreateTag`、`gitDeleteTag`、`gitPushTag`。

**工厂函数**:
- `createWorktreeConsoleControlPlane(options)`（L203-L1415）：返回 `WorktreeConsoleControlPlane` 实例。`createTargetSessionId` 默认 `randomUUID`（L204）。

**内部私有辅助函数（非导出，但为核心逻辑）**:
- `recordOf(registry, checkoutId)`（L118-122）：从 Registry 读取 Checkout 记录，不存在抛 `domainError('checkout_missing')`。
- `sidebarTaskState(record)`（L124-135）：根据 `phase` 和 `delivery.state` 计算侧边栏任务状态。Delivery 完成优先于 Phase（L128 `worktreeReachedDelivery`）。
- `readyReview(record)`（L137-142）：校验记录处于 `ready`+`ready_for_review`，返回 review。
- `previewReview(record)`（L144-152）：校验记录处于 `ready` 且 `preview_active`/`preview_detached`，返回 review。
- `safeRecoveryRequestId(value)`（L154-156）：验证 ID 长度 1..500 且无 `\0\r\n`。
- `safeConflictFile(file)`（L158-162）：验证冲突文件路径合法（长度≤1000，无控制字符，非绝对路径，无 `.`/`..` 段）。
- `applyConflictContinuation(result, reviewId)`（L164-187）：构造冲突恢复 Continuation，严格校验 OID 格式（40/64 十六进制，L170）和文件列表（L174）。
- `preflightFailure(view)`（L189-201）：将预检 `blocked` 状态映射为错误码（如 `stale_isolated`、`not_owner` 等）。
- `unboundLocalTarget(sessionId)`（L206-225）：获取未绑定隔离会话的本地目标视图。
- `callerTarget(sessionId)`（L227-236）：尝试 inspect 模块，若 `target_unselected` 则回退 `unboundLocalTarget`。
- `verifyCallerRoot(sessionId, record, expectedRoot)`（L238-313）：核心权限校验，处理交付后根目录验证逻辑（含 liveCwd 与 workspace-root 回退，L286-309）。
- `authorize(sessionId, checkoutId, observedCaller?)`（L315-335）：综合校验 Owner/Source 身份、Project 匹配、Root 验证及可见性。
- `linkedReadAccess(sessionId, checkoutId, observedCaller?)`（L337-395）：处理链接读取场景（非 Owner 但同链接组），涉及 Acceptance Holder 检查（L419 `acceptanceHolder`）。
- `observe(record)`（L397-409）：观察 Checkout 状态，优先 `module.observeManagedCheckout`，否则解析 managedRoot 并 inspect。
- `ownerSessionAvailable(record)`（L411-413）：检查 owner session 是否存在。
- `sameLocalRoot(left, right)`（L415-417）：跨平台路径比较（win32 忽略大小写）。
- `acceptanceHolder(record)`（L419-432）：查找同 localRoot 上持有 Review Slot 的其他 Worktree（基于 `preview_active` 或 journal 操作）。
- `projectReviewSlot<T>(record, target)`（L434-451）：若存在 Holder，修改 Target 的 `reviewSlot` 和 `capabilities`（L448 强制将 `preview`、`checkpoint`、`finalize` 置 false）。
- `deliveryProofFromTarget(target)`（L453-460）：从 SessionTargetView 提取 delivery proof。
- `details(sessionId, checkoutId, observedDeliveryProof?, observedCaller?)`（L462-498）：组合访问、观察、投影生成详情。
- `mutationResponse(sessionId, checkoutId, observedDeliveryProof?)`（L500-522）：生成突变操作后响应。
- `confirmations` Map 与 `creating` Set（L524-525）：用于创建令牌与并发锁。
- `localProject(sessionId)`（L526-534）：解析调用会话的本地项目仓库。
- `projectRootFor(sessionId)`（L541-551）：解析项目根（本地根，非 managed worktree）用于 Git 分支操作。
- `withCreation(sessionId, action)`（L552-569）：防并发创建锁，基于 sessionKey + rootKey 双重互斥。
- `createTarget(sourceSessionId, branch?)`（L570-592）：调用模块创建隔离目标并验证身份一致性。

**API 实现细节（返回对象的方法，行号对应实现起始）**:
- `sidebarTopology`（L595-659）：聚合 managed checkouts，合并 membership（L597），按 project 分组，处理已清除徽章（L620-626）。
- `current`（L661-667）：返回 caller target 或 details。
- `gitOverview`（L669-682）：调用 `projectRootFor` 后取分支概览（`branchOverview`，L671），返回 `root`、`branch`、`headOid`、`branches`、`dirtyCount`。
- `gitGraph`（L684-689）：取 git log 图，若 `options.git.graphLog` 未定义则抛出 `git_error`（L686）。
- `gitCreateBranch`（L691-696）：创建本地分支，若 `options.git.createLocalBranch` 未定义则抛出错误（L693）。
- `gitSwitchBranch`（L698-713）：切换分支，交付中禁止（L702-709 遍历 registry 检查 `delivering`）；若 `options.git.switchLocalBranch` 未定义抛错（L710）。
- `gitPruneMergedBranches`（L715-717）：调用模块 `pruneMergedBranchesForSession`。
- `gitListTags`（L719-725）：列出 Git 标签，若 `options.git.listTags` 未定义或返回 null 则抛出 `git_error`。
- `gitCreateTag`（L727-737）：创建标签，支持推送（L731-736 软降级处理 `pushMessage`）。
- `gitDeleteTag`（L739-753）：删除标签，远程优先（L743-749 先处理 `request.remote` 远程删除再本地删除 L750-751）。
- `gitPushTag`（L755-764）：推送标签，软降级（L761-763 返回 `pushed: false` 和 `pushMessage`）。
- `listAbandoned`（L766-768）：列出放弃快照（`listAbandonedWorktreeSnapshots`）。
- `restoreAbandoned`（L770-774）：恢复放弃工作树（`restoreAbandonedWorktreeSnapshot`）。
- `list`（L776-851）：列出工作树，支持批量 `observeManagedCheckouts` 优化（L805-812），失败降级逐条 observe（L826-830）。
- `preflightCreate`（L853-869）：空仓库生成确认令牌（TTL 5 分钟，上限 500，L864-867）。
- `createWithInitialCommit`（L870-885）：验证令牌并初始化空仓库后创建。
- `create`（L886）：带锁创建。
- `initProject`（L887-891）：初始化项目。
- `inspect`（L893）：返回 details。
- `reviewDiff`（L895-933）：**未使用 `outcome` 包裹**，手动 try/catch 返回 `failure`/`consoleFailure`，严格校验 revision/reviewId，捕获 `ReviewDiffStaleError` 转 `stale_isolated`（L930）。
- `preflight`（L935-944）：预检。
- `previewRecoveryPreflight`（L946-964）：预览恢复预检。
- `preparePreviewRecoveryAnalysis`（L966-994）：准备分析。
- `createPreviewRecoveryHandoff`（L996-1043）：创建交接。
- `checkpoint`（L1045-1071）：检查点。
- `preview`（L1073-1095）：预览，冲突抛 `apply_conflict`（L1083-1089）。
- `resumeRevision`（L1097-1158）：恢复修订，支持冲突继续。
- `prepareReviewRegeneration`（L1160-1183）：准备审查再生。
- `rollbackPreview`（L1185-1203）：回滚预览。
- `discard`（L1205-1232）：丢弃。
- `finalize`（L1234-1276）：**未使用 `outcome` 包裹**，手动捕获，冲突返回带 continuation 的失败（L1252-1258）。
- `finalizePreview`（L1278-1321）：**未使用 `outcome` 包裹**，手动捕获。
- `setRetention`（L1323-1332）：设置保留。
- `setPermanent`（L1334-1343）：设置永久。
- `retryCleanup`（L1345-1353）：重试清理。
- `clearSidebarBadge`（L1355-1367）：清除徽章。
- `beginNextIteration`（L1369-1413）：开始下次迭代，校验前置 `discarded`+`delivered`（L1377-1379）。

### src/console-host/errors.ts

统一错误类型转换和 Outcome 包装器。

- `domainError(code, message, continuation?)`（L5-11）：创建带 `code` 和可选 `continuation` 的 Error（L10 `Object.assign`）。
- `consoleFailure(error)`（L13-41）：将未知 Error 转为 `WorktreeConsoleOutcome<never>`；若 code 在 `SESSION_CHECKOUT_ERROR_CODES` 中透传（L14-29），否则转 `git_error`（L34-40）。L31 注释标明本地允许泄露原消息（`tests/host-i18n.test.ts` 可观察），远程需脱敏（L33 标记 `ponytail: local-only leak ceiling`）。
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
- `projectRecord(record, callerSessionId, observed?)`（L109-183）：**导出**，构建 `WorktreeConsoleTargetSummary`，含 project、checkoutId、sourceSessionId、ownerSessionId、targetSessionId、iteration、revision、state、phase、dirty、currentOid、commitOid、sourceBranch、retention/permanent/reviewSlot/previewRecovery 等字段（L126-182）。
- `projectDetails(record, callerSessionId, managedRoot, snapshot?, dirty?, ownerSessionAvailable?, linkedRead?, observedDeliveryProof?)`（L185-255）：**导出**，构建 `WorktreeConsoleTargetDetails`，继承 Summary 并补 `managedRoot`、`sourceRoot`、`sourceOid`、`currentBranch`（L204-211），以及 owner 的 `recoveryContinuation` 展开（L212-253）。
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
- `git(cwd, args, env, maxBytes)`（L34-64）：spawn git 并截断输出（L47-52）。
- `projectPath(value)`（L66-70）：校验项目相对路径安全（无 `\0`、无 `\`、非绝对、无 `..`）。
- `utf8Prefix(value, maxBytes)`（L72-78）：UTF-8 安全截断。
- `payloadBytes(response)`（L80-82）：计算 JSON 字节。
- `ChangedEntry` 接口（L84-88）：`path`、`previousPath?`、`status`。
- `parseNameStatus(output)`（L90-113）：解析 `git diff --name-status -z`，R/C 折叠为 `renamed`（L100-104）。
- `sortedUnique(values)`（L115-117）：排序去重。
- `changedPathSet(entries)`（L119-121）：收集变更路径集。
- `read` 实现逻辑（L125-243）：建临时对象目录，用 `GIT_ALTERNATE_OBJECT_DIRECTORIES` 避免复制（L142）；`read-tree` 基线（L145）；技能追踪移除（L147-162）；`diff --cached --name-status` 取列表（L163-168）；校验一致性抛 `ReviewDiffStaleError`（L175-176）；分批并行（每批 8，L184-186）取证 numstat 和 patch；总负载超 `MAX_PAYLOAD_BYTES` 时截断当前 patch 并停止（L223-234）。

## Architecture

```text
┌──────────────┐   ┌────────────────────┐
│ Client UI    │──▶│ WorktreeConsole    │
│ (Cards)      │   │ Service (L34)      │
└──────────────┘   └─────────┬──────────┘
                             │ RPC (@Remote)
                             ▼
┌──────────────┐   ┌────────────────────┐
│ Projection   │◀──│ ControlPlane       │
│ L109/L185    │   │ (L203) authorize   │
│ ReviewDiff   │   │ L315 linkedRead    │
│ L123         │   └─────────┬──────────┘
└──────────────┘   ┌─────────▼──────────┐
                  │ Module/Registry/Git │
                  │ Ports (L68-76)      │
                  └────────────────────┘
```

## Data Flow

1. **RPC 入口**：客户端发起 RPC 调用，`WorktreeConsoleService` 接收（如 `sidebarTopology` L53 起），通过 `withHostLanguage` 设置本地化上下文（L55 等）。
2. **授权与验证**：控制面方法首先调用 `authorize`（L315）或 `linkedReadAccess`（L337）验证会话权限、项目匹配性和根目录一致性（`verifyCallerRoot` L238）。
3. **并发守卫**：对于创建类操作，`withCreation`（L552）使用 `creating` Set 进行双重互斥（sessionKey + rootKey，L553-567），防止竞态。
4. **状态观察**：读操作（如 `list` L776、`current` L661）调用 `observe`（L397）获取最新 Git 状态，优先批量 `observeManagedCheckouts`（L805）失败降级逐条（L826）。
5. **业务逻辑**：根据操作类型调用 `module.operate`（如 `checkpoint` L1052）或 `module.createIsolatedTarget`（L572）等执行实际工作树管理。
6. **投影**：结果通过 `projection.ts` 函数（`projectRecord` L109、`projectDetails` L185、`capabilities` L61）转换为 UI 格式，包括能力计算和状态映射。
7. **响应包装**：多数方法通过 `outcome`（errors.ts L60）包装为 `WorktreeConsoleOutcome`；但 `reviewDiff` (L895)、`finalize` (L1234)、`finalizePreview` (L1278) 手动 try/catch 返回 `failure`/`consoleFailure`。

## Connections

- [[session-checkout-module|Session Checkout State Machine]]：核心状态机，提供 `operate`、`preflight`、`createIsolatedTarget`、`beginNextIteration`、`preparePreviewRecoveryAnalysis`、`createPreviewRecoveryHandoff` 等方法（control-plane.ts L1052、L572、L1376、L966、L996 等）。
- [[host-overview|Host Entry and Registration Surface]]：宿主入口与注册机制，此处 `TypertRemoteService` 子类由 Gateway 解析 `agentId` 前挂载（service.ts L33 注释）。
- [[adapters|Adapter Layer]]：Git 适配器（`SessionCheckoutGitPort`）和文件系统适配器（`SessionCheckoutFilesPort`），在 control-plane.ts L71-73 注入。
- [[i18n-host|Host i18n]]：`withHostLanguage`、`languageFromSettings`、`hostMessage` 来自 `../i18n/host.js`，用于多语言消息（service.ts L2、L55；projection.ts L1；errors.ts L1）。
- [[console-contract|Console Contract]]：类型定义如 `WorktreeConsoleOutcome`、各类 Response 来自 `../console-contract.js`，被 service.ts 与 control-plane.ts 广泛引用（service.ts L8-29；control-plane.ts L5-52）。
- [[host-compat|Host Compat]]：`hostWorkspaceClientFlavor`、`workspaceFlavorDiagnostics` 来自 `../host-compat.js`（service.ts L3、L56-61）。

## Known Issues

- **诊断隔离**：`appendDiag`（service.ts L46-51）静默捕获异常（L50 `catch { /* best effort */ }`），诊断写入失败不可见，但确保不破坏 RPC 表面。
- **语言回退**：若 `agent.ctx` 与 `hostContext` 均未设语言，`languageFromSettings`（service.ts L76 等）提供默认，具体行为依赖 `../i18n/host.js`。
- **错误传播差异**：`reviewDiff`/`finalize`/`finalizePreview`（control-plane.ts L895、L1234、L1278）未使用 `outcome` 包装，而是内部 try/catch 返回 `failure` 或 `consoleFailure`，其余方法多用 `outcome` 包裹；未统一。
- **批量观察降级**：`list` 中 `observeManagedCheckouts` 若抛错则整批降级逐条 observe（L805-812），个别记录观察失败以无观察投影呈现（L826-830），后续 CAS 校验兜底。
- **空仓库创建令牌限制**：`confirmations` Map 上限 500，TTL 5 分钟（L864-867），高并发空仓库初始化可能淘汰旧令牌。
- **预览恢复能力禁用**：当 `projectReviewSlot` 检测到 `acceptanceHolder` 存在时，强制将 `capabilities` 中 `preview`/`checkpoint`/`finalize` 置 false（projection.ts L448），可能导致 UI 混淆。
- **本地错误消息泄露**：`consoleFailure`（errors.ts L34-40）对非契约错误直接使用原 Error message，注释标明仅本地控制台允许（L31 `tests/host-i18n.test.ts` 观察），远程传输前需脱敏（L33 标记 `ponytail`）。
- **标签管理 RPC 未暴露**：control-plane 实现了 `gitListTags`（L719-725）、`gitCreateTag`（L727-737）、`gitDeleteTag`（L739-753）、`gitPushTag`（L755-764），接口也已声明（L110-113），但 `service.ts` 中未提供对应的 `@Remote` 方法，宿主 RPC 面目前无法直接调用标签管理。
