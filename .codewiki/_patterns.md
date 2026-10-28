---
title: _patterns
type: pattern
source_files:
  - cordis.patch.yml
  - package.json
  - scripts/check-publish.mjs
  - scripts/check-workspace-sidebar-version.mjs
  - scripts/clean-lib.mjs
  - scripts/workspace-sidebar-upstream.mjs
  - src/adapters/files.ts
  - src/adapters/git-options.ts
  - src/adapters/git.ts
  - src/adapters/lookup.ts
  - src/adapters/project-skill-provider.ts
  - src/adapters/registry.ts
  - src/adapters/safe-file.ts
  - src/adapters/working-directory.ts
  - src/adapters/worktree-creation.ts
  - src/checkpoint.ts
  - src/client/console-remote/adapter.ts
  - src/client/console-remote/index.ts
  - src/client/i18n.tsx
  - src/client/pre-session/controller.ts
  - src/client/pre-session/index.tsx
  - src/client/review-console/ReviewActions.tsx
  - src/client/review-console/preflight-cache.ts
  - src/client/review-console/preview-recovery-cache.ts
  - src/client/review-console/recovery-continuation.ts
  - src/client/review-console/request-cache.ts
  - src/client/review-console/status-events.ts
  - src/client/settings-card/index.ts
  - src/client/target-console/WorktreeConsoleView.tsx
  - src/client/target-console/WorktreeHeroChip.tsx
  - src/client/target-console/branch-overview-cache.ts
  - src/client/target-console/current-polling.ts
  - src/client/target-console/index.ts
  - src/commands.ts
  - src/console-contract.ts
  - src/console-host/control-plane.ts
  - src/console-host/errors.ts
  - src/console-host/projection.ts
  - src/console-host/review-diff.ts
  - src/console-host/service.ts
  - src/console-remote/descriptors.ts
  - src/console-remote/remote.ts
  - src/console-remote/schemas.ts
  - src/console-remote/typert.ts
  - src/concurrent-session-guard.ts
  - src/creation-failure.ts
  - src/i18n/client-messages.ts
  - src/i18n/core.ts
  - src/i18n/host-messages.ts
  - src/i18n/host.ts
  - src/i18n/transport-messages.ts
  - src/index.ts
  - src/ports.ts
  - src/session-checkout-apply.ts
  - src/session-checkout-module.ts
  - src/session-target-context.ts
  - src/tools.ts
  - src/types.ts
  - src/workspace-provider-lifecycle.ts
  - tests/adapters-safe-file.test.ts
  - tests/client-recovery-continuation.test.ts
  - tests/concurrent-session-guard.test.ts
  - tests/console-host.test.ts
  - tests/console-remote.test.ts
  - tests/dev-dsh.test.ts
  - tests/i18n-catalogs.test.ts
  - tests/i18n-references.test.ts
  - tests/surface.test.ts
  - tests/support/worktree-console.ts
  - tests/worktree-creation.test.ts
  - tests/workspace-provider-lifecycle.test.ts
tags: [patterns, cross-cutting, conventions, error-handling, concurrency, caching, i18n, build, testing]
---

## Overview

本文从 `modules/` 各篇横切归纳出本仓库（`dsh-git-worktree` 插件）反复出现的工程模式。每节给出具体出处（文件 + 函数/符号 + 行号），覆盖六类主题：架构分层与目录/命名约定、错误处理风格、并发与缓存卫生、持久化与删除安全、i18n、构建/测试流程。这些模式不是某一模块的局部实现，而是在 Host 领域层、Console 控制面、wire 契约层与浏览器客户端四个物理面上被重复执行的约定；理解它们是读懂任何单篇模块文章的前提。

## Patterns

### 1. 端口-适配器分层：host-agnostic 领域 + 注入依赖

领域状态机从不直接触碰宿主，一切 I/O 都藏在可替换的端口实现后面。

- 领域工厂 `createSessionCheckoutModule`（`src/session-checkout-module.ts:237`）只依赖注入的 `SessionCheckoutDependencies`（`git`/`files`/`lookup`/`registry`/`applyEngine` + live config，`src/ports.ts`）；apply 引擎（`src/session-checkout-apply.ts`）同样经 `dependencies.applyEngine` 被注入。
- 真正的 I/O 全部收在 `src/adapters/`：`createNodeFilesPort`（`src/adapters/files.ts:89`）、`createDshGitPort`（`src/adapters/git.ts:249`）、`AtomicJsonCheckoutRegistry`（`src/adapters/registry.ts:397`）、`createDshLookupPort`（`src/adapters/lookup.ts:65`）、`createSessionWorkingDirectoryPort`（`src/adapters/working-directory.ts:61`）。
- 组装只发生在插件入口 `apply()`（`src/index.ts:358-409`）；console 控制面 `createWorktreeConsoleControlPlane`（`src/console-host/control-plane.ts:206`）同样只接收端口，因此可用 fake 全量测试（`tests/console-host.test.ts`）。

### 2. 目录与分层约定

- `src/` 根平铺领域与合约文件（`session-checkout-module.ts`、`session-checkout-apply.ts`、`types.ts`、`console-contract.ts`，以及零依赖叶子助手 `checkpoint.ts`/`commit-message.ts`/`creation-failure.ts`/`delivery-excludes.ts`）；`src/adapters/` 只放实现 `src/ports.ts` 端口的基础设施。
- `src/i18n/` 按运行边界拆分：`core.ts`（两端共享原语，不 import 宿主/浏览器）+ `host.ts`/`host-messages.ts`（宿主）+ `client-messages.ts`/`transport-messages.ts`（客户端/传输）。
- `src/console-host/`（Host RPC 面）、`src/console-remote/`（wire 编解码）、`src/client/`（浏览器 UI，按特性分子目录 `review-console/`、`target-console/`、`pre-session/`、`settings-card/`、`console-remote/`）。
- `tests/` 镜像被测结构；`tests/support/` 放确定性测试替身（如 `createWorktreeConsoleAdapterFixture`，`tests/support/worktree-console.ts:124`）；`scripts/` 只含构建期/开发期工具，不进运行时产物。

### 3. 命名约定：create / register / mount 与类型后缀

- `create*` = 闭包工厂，返回接口对象：`createSessionCheckoutModule`、`createNodeFilesPort`、`createDshGitPort`、`createDshLookupPort`、`createSessionWorkingDirectoryPort`、`createWorktreeConsoleControlPlane`（`src/console-host/control-plane.ts:206`）、`createGitWorktreeReviewDiffReader`（`src/console-host/review-diff.ts:123`）、`createRequestCache`（`src/client/review-console/request-cache.ts:41`）、`createTranslator`（`src/i18n/core.ts:19`）、`createWorktreeConsoleRemoteAdapter`（`src/client/console-remote/adapter.ts:80`）、`createPreSessionWorktreeController`（`src/client/pre-session/controller.ts:232`）。
- `register*` = 把表面挂进宿主契约：`registerTools`（`src/tools.ts:94`）、`registerWorktreeCommand`（`src/commands.ts:44`）、`registerSessionTargetContext`（`src/session-target-context.ts:14`）、`registerTargetConsole`（`src/client/target-console/index.ts:19`）、`registerPreSessionWorktree`（`src/client/pre-session/index.tsx:30`）。
- `mount*` = 带生命周期/订阅的挂载：`mountWorkspaceProviderLifecycle`（`src/workspace-provider-lifecycle.ts:66`）、`mountSettingsCard`（`src/client/settings-card/index.ts:35`）、`mountProjectSkillProvider`（`src/adapters/project-skill-provider.ts:121`）。
- 类型后缀：`*Port`（五族端口接口，`src/ports.ts`）、`*View`（path-free 只读投影，如 `SessionTargetView`/`ManagedWorktreeSummaryView`，`src/types.ts`）、`*Schema`（`sessionIdSchema`/`outcomeSchema`，`src/console-remote/schemas.ts:227/227`）、`*Cache`（`preflight-cache.ts`/`preview-recovery-cache.ts`）。
- 标识符风格：错误码 snake_case（`stale_target`、`not_owner`，`src/types.ts:597-627`）；窗口事件常量全大写（`WORKTREE_REVIEW_REFRESH_EVENT`，`src/client/review-console/status-events.ts:1`）；宿主 i18n key 驼峰（`worktreeDeliverDisabledByAutoDeliver`）、客户端 key 点分（`settings.save`，`src/i18n/client-messages.ts:1599`）。

### 4. 失败即降级的动态服务解析

宿主服务按需 `ctx.get` 动态解析，缺失即静默降级为「无此能力」，绝不抛错阻断主流程。

- `createSessionWorkingDirectoryPort`（`src/adapters/working-directory.ts:61`）解析 `ctx.get('workingDirectory')` 失败时 `enter/leave/current` 返回 `undefined`，工具层退化为 guidance-only 并如实上报 `cwdSelected:false`（`src/tools.ts:99`）。
- 数据源降级：`createDshLookupPort.listLiveSessions` 出错返回 `[]`（`src/adapters/lookup.ts:109`）；branch-race guard 在 `branchRaceGuard:false` 或 `git.branchCreationTimes` 端口缺失时静默返回空 notice（`src/session-checkout-module.ts:1003-1004`）。
- UI 挂载 fail-soft：`mountSettingsCard` 探测 `configForms`/`slots` 缺一即整页不挂载（`src/client/settings-card/index.ts:39-41`）；`resolvePortalRenderer` 解析 `react-dom` 失败降级为 null（`src/client/target-console/WorktreeHeroChip.tsx:10`）。
- 契约层可选方法：`listAbandoned`/`restoreAbandoned` 缺失时 `WorktreeConsoleView` 直接跳过恢复条而不报错（`src/console-contract.ts:782-783`、`src/client/target-console/WorktreeConsoleView.tsx:93`）。

### 5. CAS 乐观并发与一次性令牌

- 领域层每次变更携带 `sessionId + expectedRevision`（`SessionCheckoutOperationBase`，`src/types.ts:222-225`）；`updateManagedCheckout` 每次写都 bump `registry.revision`（`src/session-checkout-module.ts:1670`），不匹配抛 `stale_target`。`expectedReviewId` 把 finish 绑定到已验收快照（`SessionCheckoutFinishOperation`，`src/types.ts:231`）。
- 内容寻址第二层：`checkpointGenerationForRecord`（`src/checkpoint.ts:16`）对 Review + checkpoint 链的 canonical JSON 做 SHA-256；`checkpoint` 操作要求 `expectedGeneration`（`src/console-contract.ts:323`）。
- Console 合约延续同一形态：`WorktreeConsoleDiscardRequest`/`WorktreeConsoleFinalizeRequest` 均带 `expectedRevision`（`src/console-contract.ts:292/369`）；`ERROR_META` 把 `stale_target` 映射为 `{stale, refresh, retryable:true}`（`:719`）引导客户端刷新。
- 一次性令牌防重复应用：空仓库创建的 `confirmationToken`（5 分钟 TTL，`src/console-host/control-plane.ts:956-988`）、checkpoint 的 `requestId`（`src/console-contract.ts:318`）；测试替身 `createWorktreeConsoleAdapterFixture(stateful=true)` 镜像该 CAS（`tests/support/worktree-console.ts:124-138`）。

### 6. 双端共享的 strict wire 契约与冻结描述符单源

- 全部 schema 经 `strict()` 生成 `.strict()` 对象，未知键一律拒绝（`src/console-remote/schemas.ts:29`）；结果统一包 `outcomeSchema` 判别联合（`:227`）。
- 单一事实来源：`WORKTREE_CONSOLE_DESCRIPTORS` 是 `Object.freeze` 的 39 个 `InvocationDescriptor`（`src/console-remote/descriptors.ts:94`），同时供给 Host 贡献 `TYPERT`（`src/console-remote/typert.ts:5`，经 `package.json` 的 `./typert` 导出被 Loader 自动发现）与 Client 类型面 `GitWorktreeRemote`（`src/console-remote/remote.ts:31`）。
- 双端复验：Client 解码后用同一 schema 再 parse 一次 —— `descriptor.result.create().parse(carrier.value)`（`src/client/console-remote/adapter.ts:108`），契约不符折叠为 `malformed_response`。
- 兼容演进规则：增量能力位必须写成 `.default(false)` 而非 `optional()`（`capabilitiesSchema.returnToLocal`，`src/console-remote/schemas.ts:105`），保证旧 Host 的 payload 仍能通过新 Client 的 strict 校验（回归 `tests/console-remote.test.ts:215-237`）。
- 构建期守卫：check-publish Check 4 断言 Host/Client 共享同一描述符数组实例（`scripts/check-publish.mjs:145`）并逐一校验方法名与 strict codec；`tests/console-remote.test.ts:93-116` 断言两端描述符一致。

### 7. 错误处理风格：稳定错误码 + 统一信封 + 恢复元数据

- 领域失败类型 `SessionCheckoutError{code, message}`（`src/index.ts:41-53`），错误码是封闭枚举 `SESSION_CHECKOUT_ERROR_CODES`（`src/types.ts:597`）。
- Console 层统一 `WorktreeConsoleOutcome<T>`（`src/console-contract.ts:727`）；`consoleFailure` 只原样透传已识别 code，未知第三方错误折叠为 `git_error`（`src/console-host/errors.ts:13-41`）；控制面各门禁用 `domainError` 构造带 code 的 Error（如 `recordOf` 抛 `checkout_missing`，`src/console-host/control-plane.ts:121`）。
- 每个 code 在 `ERROR_META` 有固定 `{category, recovery, retryable}`（`src/console-contract.ts:705`），客户端经 `worktreeConsoleErrorMeta(code)` 驱动恢复动作（`:740`）；传输层三码 `transport_unavailable`/`malformed_response`/`timeout` 由 Client adapter 自产（`src/client/console-remote/adapter.ts:31-78`）。
- 错误码与语言无关，i18n 只翻译 message：tool/command 层抛宿主本地化文案但语义稳定（如 `worktreeDeliverDisabledByAutoDeliver`，`src/tools.ts:452`）。strict schema 也约束错误形态：`consoleErrorSchema.superRefine` 禁止非 `apply_conflict` 携带 `continuation`（`src/console-remote/schemas.ts:221-224`）。

### 8. 路径无关只读视图与双层投影

- `src/types.ts` 的 `*View` 投影被注释明确为「path-free、只读、不授权」（`types.ts:425/477/479`）；真实变更必须在宿主锁下重验证。
- `WorktreeConsoleTargetSummary` 无路径字段（`src/console-contract.ts:149`），`WorktreeConsoleTargetDetails` 才在宿主验证 open 权限后追加 `managedRoot/sourceRoot/sourceOid/currentBranch`（`:182-195`）。
- 投影是纯函数：`projectRecord`/`projectDetails`/`capabilities`（`src/console-host/projection.ts:62/192/62`）；状态归并由 `consoleStateFromDomain`/`worktreeReachedDelivery`（`src/console-contract.ts:64/64`）完成。
- wire 层对应 `targetSummarySchema` vs `targetDetailsSchema`（`src/console-remote/schemas.ts:203/203`）；`tests/console-host.test.ts:1458-1467` 断言 list 行保持 path-free 而 `inspect` 才揭示 `managedRoot`。

### 9. 崩溃安全的原子持久化

- `tmpPathFor` 生成 `<file>.<pid>.<uuid>.tmp`，防并发写互相截断（`src/adapters/safe-file.ts:50`）；`writeJsonFileAtomic` 先 `.bak` 备份再原子 rename（`:82`）；`renameAtomicWithRetry` 对 Windows `EBUSY/EPERM/ENOTEMPTY` 指数退避重试（`:30`）。
- `readJsonFileSafe` 恢复链：主文件 → 最新可解析 tmp（原子晋升）→ `.bak`（回填主文件），全败返回 null 交上层重建（`:113`）。
- `AtomicJsonCheckoutRegistry.read` 在其上做 v1→v2 迁移（`migrateLegacyRegistry`，`src/adapters/registry.ts:339`，非 ready/discarded 相位转 `recovery_required`），无法恢复则抛 `registry_corrupt`（`:400-410`）。覆盖见 `tests/adapters-safe-file.test.ts`。

### 10. 身份证据优先、绝不强制删除

- 创建前先采集 `WorktreeCreationEvidence`（device/inode/birthtimeNs、gitDir 指纹，`src/ports.ts:274-286`），`createWorktree` 在每个持久步骤后 `saveEvidence`（`src/adapters/worktree-creation.ts:17`）。
- 失败路径绝不以 force 作为删除权威：仅当树被独占认领且身份可证明未变才回滚，否则保留残骸并抛 `WorktreeCreationFailure{rolledBack}`（`src/creation-failure.ts:3`）；`finishFailedCreation`（`src/session-checkout-module.ts:498`）按 `rolledBack` 决定删记录还是 `markRecoveryRequired`（`:509`）。`tests/worktree-creation.test.ts:54-77` 断言各不确定情形残骸原样保留。
- 目录级身份验证：`quarantineDirectoryTree` 同父目录原子 rename 后复核 identity，不匹配则移回并抛 `checkout_mismatch`（`src/adapters/files.ts:52`）。
- 删除 checkout 前必须先把 Session cwd 移出：`leaveCheckout`/`leaveCheckoutBeforeRemoval`（`src/commands.ts:51`、`src/tools.ts:51`）返回非空 reason 时调用方中止删除（如 `src/tools.ts:470-471`）；`enterCheckout` 失败则是 best-effort 仅告警。

### 11. 缓存与刷新卫生：后台刷新、单飞、代次守卫

- 同步契约 + 后台刷新：`runtimeContext` 必须同步（system-prompt 契约），因此 `refreshBranchRaceGuards`（`src/session-checkout-module.ts:1002`）由 45 秒 interval 驱动（`src/session-target-context.ts`），结果写 `branchRaceCache`（`:999`），`branchRaceNotice`（`:1035`）同步消费；判定本身是纯谓词 `detectLocalBranchRace`（`src/concurrent-session-guard.ts:68`）。全链路覆盖见 `tests/concurrent-session-guard.test.ts:110`。
- 浏览器同型：`Poll`（`src/client/target-console/current-polling.ts:22`）5s 轮询、隐藏页降为 60s、`generation` 丢弃陈旧回放（`run`，`:74`）；`branch-overview-cache.ts` 做 stale-while-revalidate + `patchEpochs` 纪元保护（`:21/:87`），防止飞行中旧请求踩掉乐观补丁。
- 单飞：`createRequestCache` 并发调用合流 in-flight promise、迟到响应经 `generation` 比对后才回放（`src/client/review-console/request-cache.ts:87/93`）；`PreSessionWorktreeController.inflight` 按 sessionId 去重（`src/client/pre-session/controller.ts:68`）；控制面 `withCreation` 用 `creating` Set 拒绝并发创建（`src/console-host/control-plane.ts:628`）；`ReviewActions` 用 `mutationLock` 串行化变更（`src/client/review-console/ReviewActions.tsx`）。
- 跨面板刷新走 window CustomEvent 扇出：`requestWorktreeReviewRefresh` 派发 `WORKTREE_REVIEW_REFRESH_EVENT`（`src/client/review-console/status-events.ts:1/4`），`Poll.onRefresh` 等各挂载面监听后 invalidate（`src/client/target-console/current-polling.ts:32`）。

### 12. locale 快照隔离的双语 i18n

- 平台无关原语：`Language`/`normalizeLanguage`/`createTranslator`（`src/i18n/core.ts:19/4/19`）；`core.ts` 不 import 宿主或浏览器模块，可两端打包。catalog 按边界拆为 `host-messages.ts`/`client-messages.ts`/`transport-messages.ts`，均 `as const satisfies MessageCatalog`。
- 宿主 locale 快照隔离：每次 RPC/tool 调用经 `withHostLanguage`（`src/i18n/host.ts:12`，基于 `AsyncLocalStorage<Language>` `:6`）拍语言快照，并发调用互不泄漏；`@Remote` 方法（`src/console-host/service.ts:76`）与工具 handler（`languageForInvocation`，`src/i18n/host.ts:30`）统一包裹。注册期共享元数据用 `hostRegistrationMessage` 返回 `zh / en` 双语对（`src/i18n/host-messages.ts:1759`）。
- 客户端两条路径：React 经 `ClientI18nProvider`/`useClientTranslator`（`src/client/i18n.tsx:43/43`，`useSyncExternalStore` 响应 LocaleFace 变化）；命令式代码在调用时刻解析 `translatorForServices`（`:49`），不固化模块加载语言。
- 契约测试：`tests/i18n-catalogs.test.ts`（每条目双语且占位符一致）、`tests/i18n-references.test.ts`（`t("…")` 字面量 key 静态守卫）。

### 13. 写前强制预检：本地存储只是上下文，不是授权

- UI 层每次变更前强制重读 Host：`previewLocal`/`submitCommit`/`rollbackPreview` 先 `readReviewPreflight(force)` / `readPreviewRecoveryPreflight(force)`（`src/client/review-console/ReviewActions.tsx:561/625/561`）；`preview-recovery-cache.ts:19` 注释明确「读缓存只做评估，写必须 force 刷新」。
- 恢复队列在外发 `Session.prompt` 前重新 `inspect` 并逐字段比对身份（`targetMatchesRequest`，`src/client/review-console/recovery-continuation.ts:195`）；localStorage 仅是「待重验的上下文」，`readPersisted`（`:93`）严格形状校验、伪造即删除（`tests/client-recovery-continuation.test.ts:384`）；teardown 中的 `sending` 一律降级 `failed` 要求显式重发，绝不自动重放（`:468`，`tests/client-recovery-continuation.test.ts:348`）。
- Host 侧镜像同一纪律：`reviewDiff` 在读前后各跑一次 `module.preflight` 防中途漂移（`src/console-host/control-plane.ts:1005/1018`），快照不一致抛 `ReviewDiffStaleError`（`src/console-host/review-diff.ts:25`）折叠为 `stale_isolated`。

### 14. 有界等待与尽力而为的副操作

- 每类可能卡死的等待都有上限：Cordis Loader 操作 `DEFAULT_OPERATION_TIMEOUT_MS = 10_000`（`src/workspace-provider-lifecycle.ts:14`）；Git 按命令分级超时 `gitTimeoutMs`（`src/adapters/git-options.ts:21`，默认 120s、`worktree add` 5min）；启动清理 `withCleanupTimeout`（`src/session-checkout-module.ts:108`）；Web RPC 无原生超时故客户端 `Promise.race` `FAST_TIMEOUT_MS=30s`/`SLOW_TIMEOUT_MS=180s`（`src/client/console-remote/adapter.ts:89-90`）。
- 副操作尽力而为、失败不阻塞主流程：交付后自动 push 是 `WorktreePushOutcome{pushed|skipped|failed}`，永不阻塞交付（`src/types.ts:389`）；诊断 ndjson `appendDiag` 吞错（`src/console-host/service.ts:47`）；`reportBoot` 永不抛（`src/client/console-remote/index.ts:86`）；pre-session 归档源会话失败被吞、以目标会话为权威（`src/client/pre-session/controller.ts:170`）。

### 15. Host 端一次性决策，杜绝客户端表达式

- 教训：`disabled: !!js` 客户端表达式在两个不同步时刻求值，曾导致「没有任何 `uiWorkspace` provider」的 0.2.x 启动崩溃（长注释 `src/workspace-provider-lifecycle.ts:40-65`）。
- 现行模式：`mountWorkspaceProviderLifecycle` 在 Host 侧用 Cordis Loader `entry.update({disabled: true})` 写入纯确定性布尔（`:147`），决策一次、后续一切读取（Host 审计、序列化渲染树、模块事件）一致；配合 `adopted`/`ownedDisables` 所有权簿记与 `internal/status`/`internal/plugin` 事件重入（`:267-276`），teardown 只恢复自己禁用的条目。`tests/workspace-provider-lifecycle.test.ts:239-251` 覆盖失败激活后恢复官方 provider。
- 门禁固化：`cordis.patch.yml` 不含任何 disabled 表达式；check-publish Check 2 明确禁止 `!!js` 表达式与客户端求值补丁（`scripts/check-publish.mjs:88-91`）。

### 16. 构建与测试流程：fail-closed 门禁与静态契约测试

- 发布流水线：`prepublishOnly` 串联 `check:sidebar-version` → build → `check:publish:release` → test（`package.json:75-82`）；`clean-lib.mjs` 在 build 前清空 `lib/` 防止已删源文件的陈旧产物泄漏（`scripts/clean-lib.mjs:1-7`）。
- fail-closed：`check-publish.mjs` 的 7 项检查任何失败即打印并 `process.exit(1)`（`scripts/check-publish.mjs:16`），覆盖 Host 单例包依赖身份、bundle patch、导出完整性、Typert 工件、入口元数据、浏览器 ModuleLoader 闭包与干净树。
- 上游指纹锁定：派生官方 Workspace Client 前断言 `WORKSPACE_UI_VERSION` + `WORKSPACE_CLIENT_SHA256`（`scripts/workspace-sidebar-upstream.mjs:5-11`），每个缝补用 `replaceExactlyOnce` 在缺失或多次出现时抛错（`:27`）；`check-workspace-sidebar-version.mjs` 是上游漂移的早期预警。
- 测试即契约：`tests/i18n-references.test.ts`（文案 key 静态引用守卫）、`tests/i18n-catalogs.test.ts`（双语占位符一致性）、`tests/console-remote.test.ts` 的 `METHODS` 权威方法清单（`:50`）与双端描述符一致断言（`:93-116`）、`tests/surface.test.ts` 守卫「宿主拒绝 `undefined` 键」的 lossless JSON 形状（`:54-83`）、`tests/dev-dsh.test.ts` 全量单测 dev 工具链。新增跨端字段/方法时必须同步更新契约类型、schema 与对应守卫测试，这是本仓库契约演进的硬约束。
