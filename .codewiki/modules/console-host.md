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

`src/console-host/service.ts` 中的 `WorktreeConsoleService` 类（L35）继承自 `TypertRemoteService`，构造函数中调用 `super(hostContext, 'gitWorktree')`（L43）注册服务名。Gateway 在业务逻辑运行前解析 `agentId`（L34 注释）。它不直接处理复杂 Git 逻辑，而是通过 `controlPlane` 实例（L38）协调底层操作。所有对外接口均通过 `@Remote` 装饰器暴露，支持多语言本地化（`withHostLanguage`，L2、L56 等）和严格参数校验。

核心职责包括：
- **RPC 适配**：通过 `service.ts` 将内部逻辑包装为 Typert Remote 调用。
- **权限与一致性**：通过 `authorize`（control-plane.ts L318）和 `linkedReadAccess`（L340）确保会话所有权、项目匹配及根目录一致性。
- **并发安全**：通过 `withCreation`（L604）实现基于 Session 和 Root 的双重互斥，防止并发创建冲突。
- **状态投影**：利用 `projection.ts` 中的辅助函数将内部记录转换为 UI 友好的目标视图（Target Details / Summary）。
- **差异读取**：`review-diff.ts` 提供安全的 Git diff 取证，用于审查界面。

## Key Components

### src/console-host/service.ts

Typert RPC 服务层，继承自 `TypertRemoteService`（L35），充当网关层。负责参数校验、国际化上下文注入（通过 `withHostLanguage`）、诊断日志记录，并将请求路由至 `controlPlane` 实例。

**构造函数依赖（L36-44）**:
- `hostContext`: 运行时上下文（L37）。
- `controlPlane`: `WorktreeConsoleControlPlane` 实例，实际业务逻辑执行者（L38）。
- `diagFile?`: 可选的诊断文件路径，用于追加 NDJSON 格式的调试信息（L39）。
- `officialWorkspaceActive`: 布尔值，标记官方工作区是否处于活跃状态（来自 mountWorkspaceProviderLifecycle 的 provider 选举结果），默认 `true`（L40-41）。

**关键私有方法**:
- `appendDiag(line)`（L47-52）：使用 `appendFileSync` 同步写入 JSON 行到指定文件。采用“尽力而为”策略，捕获异常以防止破坏 RPC 表面（L51 `catch { /* best effort */ }`）。记录内容包括时间戳、操作结果、项目数量、主机 flavor（L57 `hostWorkspaceClientFlavor`）及锚点信息（L62 `workspaceFlavorDiagnostics().anchors`）。

**公开 RPC 方法（均使用 `@Remote` 装饰，行号区间含装饰器与函数体）**:
- `sidebarTopology(locale?)`（L54-67）：返回侧边栏拓扑，附加 `workspaceClientFlavor` 和 `officialWorkspaceActive`（L65），并记录诊断（L58-63）。
- `clientBootReport(report)`（L69-73）：接收客户端启动报告，仅记录诊断并返回 `true`。
- `current(agent, locale?)`（L75-86）：获取当前工作区状态，注入诊断面包屑（L80-84）。
- `list(agent, needsAttention?, includeDelivered?, locale?)`（L88-91）：列出工作区。
- `preflightCreate(agent, locale?)`（L93-96）：创建前预检。
- `createWithInitialCommit(agent, confirmationToken, locale?)`（L98-101）：带初始提交创建。
- `create(agent, branch?, locale?)`（L103-106）：标准创建。
- `initProject(agent, locale?)`（L108-111）：初始化项目。
- `inspect(agent, checkoutId, locale?)`（L113-116）：检查特定检出点。
- `reviewDiff(agent, checkoutId, expectedRevision, expectedReviewId, locale?)`（L118-121）：审查差异。
- `preflight(agent, checkoutId, expectedRevision, expectedReviewId, locale?)`（L123-126）：预检操作。
- `previewRecoveryPreflight(agent, checkoutId, expectedRevision, expectedReviewId, expectedPreviewId, locale?)`（L128-140）：预览恢复预检。
- `preparePreviewRecoveryAnalysis(agent, checkoutId, expectedRevision, expectedReviewId, expectedPreviewId, recoveryProof, locale?)`（L142-155）：准备预览恢复分析。
- `createPreviewRecoveryHandoff(agent, checkoutId, expectedRevision, expectedReviewId, expectedPreviewId, recoveryProof, locale?)`（L157-170）：创建预览恢复交接。
- `preview(agent, checkoutId, expectedRevision, expectedReviewId, locale?)`（L172-175）：预览变更。
- `checkpoint(agent, checkoutId, expectedRevision, expectedReviewId, expectedGeneration, requestId, commitMessage, locale?)`（L177-191）：检查点提交。
- `prepareReviewRegeneration(agent, checkoutId, expectedRevision, expectedReviewId, locale?)`（L193-202）：准备审查重新生成。
- `resumeRevision(agent, checkoutId, expectedRevision, expectedReviewId, conflictContinuation?, locale?)`（L204-216）：恢复修订，支持冲突继续。
- `rollbackPreview(agent, checkoutId, expectedRevision, resumeRevision?, recoveryProof?, locale?)`（L218-228）：回滚预览。
- `discard(agent, checkoutId, expectedRevision, confirmDirty, rollbackPreview?, locale?)`（L230-233）：丢弃更改。
- `finalize(agent, checkoutId, expectedRevision, expectedReviewId, commitMessage, retention, locale?)`（L235-246）：最终化操作。
- `finalizePreview(agent, checkoutId, expectedRevision, expectedReviewId, commitMessage, retention, recoveryProof?, locale?)`（L248-262）：最终化预览，其中 `recoveryProof?` 参数在 L256 声明。
- `setRetention(agent, checkoutId, expectedRevision, retention, locale?)`（L264-273）：设置保留模式，L269 明确将参数类型约束为 `Exclude<WorktreeRetentionMode, 'cleanup'>`（即禁用 cleanup 保留模式）。
- `setPermanent(agent, checkoutId, expectedRevision, permanent, locale?)`（L275-284）：设置永久状态。
- `retryCleanup(agent, checkoutId, expectedRevision, locale?)`（L286-289）：重试清理。
- `beginNextIteration(agent, checkoutId, expectedRevision, locale?)`（L291-294）：开始下一次迭代。
- `returnToLocal(agent, checkoutId, locale?)`（L296-299）：回到 Local 边界，放行已交付记录。
- `clearSidebarBadge(agent, checkoutId, expectedRevision, locale?)`（L301-304）：清除侧边栏徽章。
- `gitOverview(agent, locale?)`（L306-309）：Git 概览。
- `gitGraph(agent, limit?, locale?)`（L311-314）：Git 图。
- `gitCreateBranch(agent, name, locale?)`（L316-319）：创建分支。
- `gitSwitchBranch(agent, branch, locale?)`（L321-324）：切换分支。
- `gitPruneMergedBranches(agent, dryRun, locale?)`（L326-329）：修剪已合并分支。
- `listAbandoned(agent, locale?)`（L331-334）：列出被放弃的工作区。
- `restoreAbandoned(agent, checkoutId, locale?)`（L336-339）：恢复被放弃的工作区。

**国际化处理模式**:
- 所有对外暴露的 RPC 方法均包裹在 `withHostLanguage` 中（如 L56）。
- 语言优先级：传入的 `locale` > `agent.ctx` 中的设置 > `this.hostContext` 中的设置（通过 `languageFromSettings` 获取，L77 等）。

**注意**：control-plane.ts 中实现了 `gitListTags`（L771-777）、`gitCreateTag`（L779-789）、`gitDeleteTag`（L791-805）、`gitPushTag`（L807-816），且接口 `WorktreeConsoleControlPlane` 在 L113-116 声明了这些方法，但 `service.ts` 未提供对应的 `@Remote` 方法，宿主 RPC 面目前无法直接调用标签管理。

### src/console-host/control-plane.ts

核心业务逻辑实现，定义 `WorktreeConsoleControlPlane` 接口及其具体实现。它是 Console 与底层 `SessionCheckoutModule` 及 Git 端口之间的适配层。

**接口与类型**:
- `WorktreeConsoleControlPlaneOptions`（L70-78）：依赖注入配置，字段包括 `module: SessionCheckoutModule`、`lookup: SessionCheckoutLookupPort`、`files: SessionCheckoutFilesPort`、`registry: SessionCheckoutRegistryPort`、`git: SessionCheckoutGitPort`、`reviewDiff: WorktreeReviewDiffReader`、`createTargetSessionId?: () => string`。
- `WorktreeConsoleControlPlane`（L80-119）：定义所有公开 API 方法签名，涵盖 `sidebarTopology`、`current`、`list`、`preflightCreate`、`createWithInitialCommit`、`create`、`initProject`、`inspect`、`reviewDiff`、`preflight`、`previewRecoveryPreflight`、`preparePreviewRecoveryAnalysis`、`createPreviewRecoveryHandoff`、`preview`、`checkpoint`、`resumeRevision`、`prepareReviewRegeneration`、`rollbackPreview`、`discard`、`finalize`、`finalizePreview`、`setRetention`、`setPermanent`、`retryCleanup`、`beginNextIteration`、`returnToLocal`、`clearSidebarBadge`、`gitOverview`、`gitGraph`、`gitCreateBranch`、`gitSwitchBranch`、`gitPruneMergedBranches`、`listAbandoned`、`restoreAbandoned`，并在 L113-116 声明了 `gitListTags`、`gitCreateTag`、`gitDeleteTag`、`gitPushTag`。

**工厂函数**:
- `createWorktreeConsoleControlPlane(options)`（L206-L1502）：返回 `WorktreeConsoleControlPlane` 实例。`createTargetSessionId` 默认 `randomUUID`（L207）。

**内部私有辅助函数（非导出，但为核心逻辑）**:
- `recordOf(registry, checkoutId)`（L121-125）：从 Registry 读取 Checkout 记录，不存在抛 `domainError('checkout_missing')`。
- `sidebarTaskState(record)`（L127-138）：根据 `phase` 和 `delivery.state` 计算侧边栏任务状态。Delivery 完成优先于 Phase（L131 `worktreeReachedDelivery`）。
- `readyReview(record)`（L140-145）：校验记录处于 `ready`+`ready_for_review`，返回 review。
- `previewReview(record)`（L147-155）：校验记录处于 `ready` 且 `preview_active`/`preview_detached`，返回 review。
- `safeRecoveryRequestId(value)`（L157-159）：验证 ID 长度 1..500 且无 `\0\r\n`。
- `safeConflictFile(file)`（L161-165）：验证冲突文件路径合法（长度≤1000，无控制字符，非绝对路径，无 `.`/`..` 段）。
- `applyConflictContinuation(result, reviewId)`（L167-190）：构造冲突恢复 Continuation，严格校验 OID 格式（40/64 十六进制，L173）和文件列表（L177）。
- `preflightFailure(view)`（L192-204）：将预检 `blocked` 状态映射为错误码（如 `stale_isolated`、`not_owner` 等）。
- `unboundLocalTarget(sessionId)`（L209-228）：获取未绑定隔离会话的本地目标视图。
- `callerTarget(sessionId)`（L230-239）：尝试 inspect 模块，若 `target_unselected` 则回退 `unboundLocalTarget`。
- `verifyCallerRoot(sessionId, record, expectedRoot)`（L241-316）：核心权限校验，处理交付后根目录验证逻辑（含 liveCwd 与 workspace-root 回退，L289-312）。
- `authorize(sessionId, checkoutId, observedCaller?)`（L318-338）：综合校验 Owner/Source 身份、Project 匹配、Root 验证及可见性。
- `linkedReadAccess(sessionId, checkoutId, observedCaller?)`（L340-398）：处理链接读取场景（非 Owner 但同链接组），涉及 Acceptance Holder 检查（L470 `acceptanceHolder`）。
- `observe(record)`（L400-412）：观察 Checkout 状态，优先 `module.observeManagedCheckout`，否则解析 managedRoot 并 inspect。
- `ownerSessionAvailable(record)`（L414-416）：检查 owner session 是否存在。
- `withinRoot(candidate, root)`（L418-427）：跨平台判断 candidate 是否位于 root 内或等价于 root。
- `settledLocalBranch(record, sessionId, managedRoot)`（L444-464）：解析已交付 owner 实际所在的 Local 分支。
- `sameLocalRoot(left, right)`（L466-468）：跨平台路径比较（win32 忽略大小写）。
- `acceptanceHolder(record)`（L470-483）：查找同 localRoot 上持有 Review Slot 的其他 Worktree（基于 `preview_active` 或 journal 操作）。
- `projectReviewSlot<T>(record, target)`（L485-502）：若存在 Holder，修改 Target 的 `reviewSlot` 和 `capabilities`（L499 强制将 `preview`、`checkpoint`、`finalize` 置 false）。
- `deliveryProofFromTarget(target)`（L504-511）：从 SessionTargetView 提取 delivery proof。
- `details(sessionId, checkoutId, observedDeliveryProof?, observedCaller?)`（L513-550）：组合访问、观察、投影生成详情。
- `mutationResponse(sessionId, checkoutId, observedDeliveryProof?)`（L552-574）：生成突变操作后响应。
- `confirmations` Map 与 `creating` Set（L576-577）：用于创建令牌与并发锁。
- `localProject(sessionId)`（L578-586）：解析调用会话的本地项目仓库。
- `projectRootFor(sessionId)`（L593-603）：解析项目根（本地根，非 managed worktree）用于 Git 分支操作。
- `withCreation(sessionId, action)`（L604-621）：防并发创建锁，基于 sessionKey + rootKey 双重互斥。
- `createTarget(sourceSessionId, branch?)`（L622-644）：调用模块创建隔离目标并验证身份一致性。

**API 实现细节（返回对象的方法，行号对应实现起始）**:
- `sidebarTopology`（L647-711）：聚合 managed checkouts，合并 membership（L649），按 project 分组，处理已清除徽章（L672-678）。
- `current`（L713-719）：返回 caller target 或 details。
- `gitOverview`（L721-734）：调用 `projectRootFor` 后取分支概览（`branchOverview`，L723），返回 `root`、`branch`、`headOid`、`branches`、`dirtyCount`。
- `gitGraph`（L736-741）：取 git log 图，若 `options.git.graphLog` 未定义则抛出 `git_error`（L738）。
- `gitCreateBranch`（L743-748）：创建本地分支，若 `options.git.createLocalBranch` 未定义则抛出错误（L745）。
- `gitSwitchBranch`（L750-765）：切换分支，交付中禁止（L754-761 遍历 registry 检查 `delivering`）；若 `options.git.switchLocalBranch` 未定义抛错（L762）。
- `gitPruneMergedBranches`（L767-769）：调用模块 `pruneMergedBranchesForSession`。
- `gitListTags`（L771-777）：列出 Git 标签，若 `options.git.listTags` 未定义或返回 null 则抛出 `git_error`。
- `gitCreateTag`（L779-789）：创建标签，支持推送（L783-788 软降级处理 `pushMessage`）。
- `gitDeleteTag`（L791-805）：删除标签，远程优先（L795-801 先处理 `request.remote` 远程删除再本地删除 L802-803）。
- `gitPushTag`（L807-816）：推送标签，软降级（L813-815 返回 `pushed: false` 和 `pushMessage`）。
- `listAbandoned`（L818-820）：列出放弃快照（`listAbandonedWorktreeSnapshots`）。
- `restoreAbandoned`（L822-826）：恢复放弃工作树（`restoreAbandonedWorktreeSnapshot`）。
- `list`（L828-903）：列出工作树，支持批量 `observeManagedCheckouts` 优化（L857-864），失败降级逐条 observe（L878-882）。
- `preflightCreate`（L905-921）：空仓库生成确认令牌（TTL 5 分钟，上限 500，L916-919）。
- `createWithInitialCommit`（L922-937）：验证令牌并初始化空仓库后创建。
- `create`（L938）：带锁创建。
- `initProject`（L939-943）：初始化项目。
- `inspect`（L945）：返回 details。
- `reviewDiff`（L947-985）：**未使用 `outcome` 包裹**，手动 try/catch 返回 `failure`/`consoleFailure`，严格校验 revision/reviewId，捕获 `ReviewDiffStaleError` 转 `stale_isolated`（L982）。
- `preflight`（L987-996）：预检。
- `previewRecoveryPreflight`（L998-1016）：预览恢复预检。
- `preparePreviewRecoveryAnalysis`（L1018-1046）：准备分析。
- `createPreviewRecoveryHandoff`（L1048-1095）：创建交接。
- `checkpoint`（L1097-1123）：检查点。
- `preview`（L1125-1147）：预览，冲突抛 `apply_conflict`（L1136-1140）。
- `resumeRevision`（L1149-1210）：恢复修订，支持冲突继续。
- `prepareReviewRegeneration`（L1212-1235）：准备审查再生。
- `rollbackPreview`（L1237-1255）：回滚预览。
- `discard`（L1257-1284）：丢弃。
- `finalize`（L1286-1328）：**未使用 `outcome` 包裹**，手动捕获，冲突返回带 continuation 的失败（L1304-1311）。
- `finalizePreview`（L1330-1373）：**未使用 `outcome` 包裹**，手动捕获。
- `setRetention`（L1375-1384）：设置保留。
- `setPermanent`（L1386-1395）：设置永久。
- `retryCleanup`（L1397-1405）：重试清理。
- `clearSidebarBadge`（L1407-1419）：清除徽章。
- `beginNextIteration`（L1421-1465）：开始下次迭代，校验前置 `discarded`+`delivered`（L1429-1431）。
- `returnToLocal`（L1477-1500）：回到 Local，校验已交付（L1482-1487），解绑或返回 Local 投影。

### src/console-host/errors.ts

统一错误类型转换和 Outcome 包装器。

- `domainError(code, message, continuation?)`（L5-11）：创建带 `code` 和可选 `continuation` 的 Error（L10 `Object.assign`）。
- `consoleFailure(error)`（L13-41）：将未知 Error 转为 `WorktreeConsoleOutcome<never>`；若 code 在 `SESSION_CHECKOUT_ERROR_CODES` 中透传（L14-29），否则转 `git_error`（L34-40）。L31 注释标明本地允许泄露原消息（`tests/host-i18n.test.ts` 可观察），远程需脱敏（L33 标记 `ponytail: local-only leak ceiling`）。
- `failure<T>(code, message, details?, continuation?)`（L43-58）：直接构造失败 Outcome。
- `outcome<T>(operation)`（L60-66）：核心包装器，成功 `{ok:true,value}`，失败调 `consoleFailure`。

### src/console-host/projection.ts

将内部域模型（`ManagedCheckoutRecord`）转换为 UI 消费的数据结构。

- `review(record)`（L16-31）：内部，提取 review 摘要。
- `commitOid(record)`（L33-35）：内部，取交付 commit OID。
- `deliveryProof(record, observed?)`（L37-56）：内部，构建交付证明。
- `iteration(record)`（L58-60）：内部，取迭代号。
- `capabilities(record, callerSessionId, ownerSessionAvailable?, linkedRead?)`（L62-105）：**导出**，返回能力对象，全部字段（布尔）：

| 字段 | 表达式 / 值 | 行号 |
| --- | --- | --- |
| `create` | `false`（硬编码禁用，创建只能从 Local 发起） | L83 |
| `open` | `readAuthorized && active && (!linkedRead || ownerSessionAvailable)` | L84 |
| `inspect` | `readAuthorized` | L85 |
| `discard` | `(owner || sourceReservation) && active && !cleanup && !previewDetached` | L86 |
| `preflight` | `owner && ready` | L87 |
| `preview` | `owner && ready` | L88 |
| `checkpoint` | `owner && (ready || previewActive)` | L89 |
| `resumeRevision` | `owner && ready` | L90 |
| `rollbackPreview` | `owner && (previewActive || previewDetached || previewRecovery)` | L91 |
| `finalize` | `owner && ready` | L92 |
| `finalizePreview` | `owner && (previewActive || previewDetached)` | L93 |
| `setRetention` | `manageAuthorized && record.delivery.state === 'retained'` | L94 |
| `setPermanent` | `manageAuthorized && active` | L95 |
| `retryCleanup` | `manageAuthorized && cleanup` | L96 |
| `beginNextIteration` | `owner && delivered` | L97 |
| `returnToLocal` | `owner && worktreeReachedDelivery(record.phase, record.delivery.state)` | L103 |

- `fallbackOid(record)`（L107-110）：内部，回退 OID 计算。
- `sourceBranchFromRef(sourceRef)`（L112-114）：**导出**，从 `refs/heads/` 提取分支名。
- `projectRecord(record, callerSessionId, observed?)`（L116-190）：**导出**，构建 `WorktreeConsoleTargetSummary`，含 project、checkoutId、sourceSessionId、ownerSessionId、targetSessionId、iteration、revision、state、phase、dirty、currentOid、commitOid、sourceBranch、retention/permanent/reviewSlot/previewRecovery 等字段（L133-189），并嵌入 `capabilities`（L183-188）。
- `projectDetails(record, callerSessionId, managedRoot, snapshot?, dirty?, ownerSessionAvailable?, linkedRead?, observedDeliveryProof?, settledLocalBranch?)`（L192-270）：**导出**，构建 `WorktreeConsoleTargetDetails`，继承 Summary 并补 `managedRoot`、`sourceRoot`、`sourceOid`、`currentBranch`（L226），以及 owner 的 `recoveryContinuation` 展开（L227-268）。
- `projectLocal(target, sessionId)`（L272-310）：**导出**，构建 Local 目标投影，Worktree 特定能力全 false，仅 `create`（若 `target.current.oid !== 'unversioned'` 则 true，L288）、`open`、`inspect` 真。

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
│ (Cards)      │   │ Service (L35)      │
└──────────────┘   └─────────┬──────────┘
                             │ RPC (@Remote)
                             ▼
┌──────────────┐   ┌────────────────────┐
│ Projection   │◀──│ ControlPlane       │
│ L116/L192    │   │ (L206) authorize   │
│ ReviewDiff   │   │ L318 linkedRead    │
│ L123         │   └─────────┬──────────┘
└──────────────┘   ┌─────────▼──────────┐
                  │ Module/Registry/Git │
                  │ Ports (L70-78)      │
                  └────────────────────┘
```

## Data Flow

1. **RPC 入口**：客户端发起 RPC 调用，`WorktreeConsoleService` 接收（如 `sidebarTopology` L54 起），通过 `withHostLanguage` 设置本地化上下文（L56 等）。
2. **授权与验证**：控制面方法首先调用 `authorize`（L318）或 `linkedReadAccess`（L340）验证会话权限、项目匹配性和根目录一致性（`verifyCallerRoot` L241）。
3. **并发守卫**：对于创建类操作，`withCreation`（L604）使用 `creating` Set 进行双重互斥（sessionKey + rootKey，L605-620），防止竞态。
4. **状态观察**：读操作（如 `list` L828、`current` L713）调用 `observe`（L400）获取最新 Git 状态，优先批量 `observeManagedCheckouts`（L857）失败降级逐条（L878）。
5. **业务逻辑**：根据操作类型调用 `module.operate`（如 `checkpoint` L1104）或 `module.createIsolatedTarget`（L624）等执行实际工作树管理。
6. **投影**：结果通过 `projection.ts` 函数（`projectRecord` L116、`projectDetails` L192、`capabilities` L62）转换为 UI 格式，包括能力计算和状态映射。
7. **响应包装**：多数方法通过 `outcome`（errors.ts L60）包装为 `WorktreeConsoleOutcome`；但 `reviewDiff` (L947)、`finalize` (L1286)、`finalizePreview` (L1330) 手动 try/catch 返回 `failure`/`consoleFailure`。

## Connections

- [[session-checkout-module|Session Checkout State Machine]]：核心状态机，提供 `operate`、`preflight`、`createIsolatedTarget`、`beginNextIteration`、`preparePreviewRecoveryAnalysis`、`createPreviewRecoveryHandoff` 等方法（control-plane.ts L1104、L624、L1445、L1028、L1059 等）。
- [[host-overview|Host Entry and Registration Surface]]：宿主入口与注册机制，此处 `TypertRemoteService` 子类由 Gateway 解析 `agentId` 前挂载（service.ts L34 注释）。
- [[adapters|Adapter Layer]]：Git 适配器（`SessionCheckoutGitPort`）和文件系统适配器（`SessionCheckoutFilesPort`），在 control-plane.ts L73-74 注入。
- [[i18n-host|Host i18n]]：`withHostLanguage`、`languageFromSettings`、`hostMessage` 来自 `../i18n/host.js`，用于多语言消息（service.ts L2、L56；projection.ts L1；errors.ts L1）。
- [[console-contract|Console Contract]]：类型定义如 `WorktreeConsoleOutcome`、各类 Response 来自 `../console-contract.js`，被 service.ts 与 control-plane.ts 广泛引用（service.ts L8-30；control-plane.ts L5-54）。
- [[host-compat|Host Compat]]：`hostWorkspaceClientFlavor`、`workspaceFlavorDiagnostics` 来自 `../host-compat.js`（service.ts L3、L57-62）。

## Known Issues

- **诊断隔离**：`appendDiag`（service.ts L47-52）静默捕获异常（L51 `catch { /* best effort */ }`），诊断写入失败不可见，但确保不破坏 RPC 表面。
- **语言回退**：若 `agent.ctx` 与 `hostContext` 均未设语言，`languageFromSettings`（service.ts L77 等）提供默认，具体行为依赖 `../i18n/host.js`。
- **错误传播差异**：`reviewDiff`/`finalize`/`finalizePreview`（control-plane.ts L947、L1286、L1330）未使用 `outcome` 包装，而是内部 try/catch 返回 `failure` 或 `consoleFailure`，其余方法多用 `outcome` 包裹；未统一。
- **批量观察降级**：`list` 中 `observeManagedCheckouts` 若抛错则整批降级逐条 observe（L857-864），个别记录观察失败以无观察投影呈现（L878-882），后续 CAS 校验兜底。
- **空仓库创建令牌限制**：`confirmations` Map 上限 500，TTL 5 分钟（L916-919），高并发空仓库初始化可能淘汰旧令牌。
- **预览恢复能力禁用**：当 `projectReviewSlot` 检测到 `acceptanceHolder` 存在时，强制将 `capabilities` 中 `preview`/`checkpoint`/`finalize` 置 false（projection.ts L499），可能导致 UI 混淆。
- **本地错误消息泄露**：`consoleFailure`（errors.ts L34-40）对非契约错误直接使用原 Error message，注释标明仅本地控制台允许（L31 `tests/host-i18n.test.ts` 观察），远程传输前需脱敏（L33 标记 `ponytail`）。
- **标签管理 RPC 未暴露**：control-plane 实现了 `gitListTags`（L771-777）、`gitCreateTag`（L779-789）、`gitDeleteTag`（L791-805）、`gitPushTag`（L807-816），接口也已声明（L113-116），但 `service.ts` 中未提供对应的 `@Remote` 方法，宿主 RPC 面目前无法直接调用标签管理。
