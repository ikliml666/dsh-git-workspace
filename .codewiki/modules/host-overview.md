---
title: Host Entry and Registration Surface
type: module
source_files:
  - src/index.ts
  - src/commands.ts
  - src/tools.ts
  - src/session-target-context.ts
  - src/host-compat.ts
  - src/i18n/host.ts
tags: [host, entry, tools, commands, i18n]
---

## Overview

`dsh-git-worktree` 是 DeepSeek Harness (DSH) 的 Git worktree 会话目标插件。`src/index.ts` 是插件的宿主门面（模块注释见 `src/index.ts:3-10`）：它把端口适配器（Git / 文件 / 查找 / 注册表）、核心状态机模块 `SessionCheckoutModule`、应用引擎与控制台服务装配成一个 Cordis 插件，并同时向三类消费者暴露能力——模型（`ctx.tools`）、人类用户（`/worktree` 命令）、UI 与提示层（系统提示上下文、控制台 RPC）。

本文件涵盖的是「注册面」：模块契约 `SessionCheckoutModule`、配置模式 `Config`、挂载入口 `apply`、9 个模型工具、`/worktree` 命令族、会话目标上下文注入、宿主版本兼容探测，以及宿主语言（i18n）运行时。

生命周期的关键语义（当前代码）：`worktree_create` 是 **in-place 创建**——worktree 所有权直接绑到当前会话并进入该 checkout（`src/tools.ts:101-168`），其中 `sourceSessionId = targetSessionId = sessionIdOf(exec.agent)`（`src/tools.ts:101-102`），创建时即建好**会话分支**（返回 `branch` 字段，`src/tools.ts:158`）；`worktree_deliver` 的交付提交落在**会话自己的分支**上、不写 Local，并把分支名回传给调用方用于后续合并（返回 `branch` 见 `src/tools.ts:497`，注释见 `src/tools.ts:101`；`worktree_create` 注册于 `src/tools.ts:101-168`，`worktree_deliver` 注册于 `src/tools.ts:101-202`）。

## Key Components

### 模块契约与类型 (src/index.ts)

- **`SessionCheckoutError`** (`src/index.ts:41-53`)：领域错误基类，继承 `Error`；`readonly code: SessionCheckoutErrorCode`（`src/index.ts:42`），构造函数签名 `constructor(code: SessionCheckoutErrorCode, message: string)`（`src/index.ts:48`），并设置 `this.name = 'SessionCheckoutError'`（`src/index.ts:50`）。`message` 会被工具层逐字透出给用户（注释 `src/index.ts:41-44`）。
- **`SessionCheckoutReconcileSummary`** (`src/index.ts:55-61`)：启动收敛摘要接口，字段为 `recoveryRequiredCheckoutIds: string[]`、`orphanedCheckoutIds: string[]`、`dirtyOrphanedCheckoutIds: string[]`、`staleRootCheckoutIds: string[]`、`retainedCheckoutCount: number`。
- **`ManageManagedWorktreeInput`** (`src/index.ts:63-71`)：管理输入接口。`checkoutId: string`、`expectedRevision: number`（CAS 校验）、`action: 'cleanup_retained' | 'retry_cleanup' | 'set_retention' | 'set_permanent' | 'clear_sidebar_badge' | 'discard'`（`src/index.ts:66`）、`retention?: Exclude<WorktreeRetentionMode, 'cleanup'>`、`permanent?: boolean`、`confirmDirty?: boolean`、`rollbackPreview?: boolean`。
- **`ListManagedWorktreesInput`** (`src/index.ts:73-78`)：列表输入接口，`projectId?`、`needsAttention?`、`checkoutId?`、`includeDiagnostics?`。
- **`PruneMergedBranchesInput`** (`src/index.ts:80-85`)：`dryRun?: boolean`（`src/index.ts:82`，只报告不碰 ref）、`olderThanDays?: number`（`src/index.ts:84`，仅修剪 tip 提交早于该天数的分支；省略则不按时间过滤）。
- **`MergeBranchForSessionInput`** (`src/index.ts:87-94`)：`sourceBranch: string`（本会话的 worktree 分支，forward 时合入 Local、reverse 时接收 Local HEAD）、`dryRun?: boolean`（`src/index.ts:91`，在一次性 detached worktree 中试合并，绝不碰 checkout）、`direction?: 'forward' | 'reverse'`（`src/index.ts:93`，reverse 时冲突现场留在 worktree）。
- **`MarkReadyForReviewInput`** (`src/index.ts:96-103`)：`detailsMarkdown?`、`summary: string`、`validationStatus: WorktreeValidationStatus`、`validationSummary?`、`tests: WorktreeValidationItem[]`、`suggestedCommitMessage: string`。
- **`IsolatedTargetLaunch`** (`src/index.ts:106-110`)：客户端创建权威隔离 Workspace/Session 的回执数据接口，字段 `targetSessionId: string`、`managedRoot: string`、`target: SessionTargetView`。
- **`SessionCheckoutModule`** (`src/index.ts:113-208`)：模块向业务调用方暴露的完整核心接口（声明自 `src/index.ts:113`）。方法清单：
  - `inspect(sessionId: string): Promise<SessionTargetView>` (`src/index.ts:114`)
  - `runtimeContext(sessionId: string, cwd?: string): string` (`src/index.ts:120`)：同步注册表快照，用于回放稳定的模型运行时上下文；`cwd` 由宿主提供时决定是否仍需声明绝对路径规则。
  - `refreshBranchRaceGuards?(): Promise<void>` (`src/index.ts:126`)：并发分支竞争守卫刷新，后台定时采集分支创建时间。
  - `preflight?(sessionId, expectedRevision): Promise<WorktreeApplyPreflightView>` (`src/index.ts:128`)：只读同步预检，不改 Local / worktree / 注册表 / review 状态 / Git ref。
  - `preflightPreviewRecovery?(sessionId, expectedRevision, expectedReviewId, expectedPreviewId): Promise<WorktreePreviewRecoveryPreflightView>` (`src/index.ts:130-135`)：严格只读的 detached Preview 恢复评估。
  - `runExclusiveSessionMutation<T>(sessionId, operation): Promise<T>` (`src/index.ts:137-140`)：与 bind/apply/discard/cleanup 共用同一把独占锁的跨模块突变。
  - `bind(sessionId, choice: SessionTargetBindChoice): Promise<SessionTargetView>` (`src/index.ts:141`)
  - `createIsolatedTarget(sourceSessionId, targetSessionId, createOptions?: { topic?: string; branch?: string }): Promise<IsolatedTargetLaunch>` (`src/index.ts:143`)：预留一个独立的 owner 会话与 checkout，且**不改动源会话的 cwd/身份**。
  - `beginNextIteration(sessionId, expectedRevision): Promise<SessionTargetView>` (`src/index.ts:145`)：把已清理的已交付 owner 的不可变 cwd 重建为下一轮隔离迭代。
  - `resumeRevision(sessionId, expectedRevision, expectedReviewId, recovery?): Promise<SessionTargetView>` (`src/index.ts:147-152`)：作废未同步的 review 并在同一轮迭代内恢复，不触碰 Local。
  - `prepareReviewRegeneration(sessionId, expectedRevision, expectedReviewId, requestId): Promise<ManagedReviewRegenerationContinuation>` (`src/index.ts:154-159`)：持久化宿主权威的一次性 review 重生成请求。
  - `preparePreviewRecoveryAnalysis(sessionId, proof, requestId): Promise<ManagedPreviewRecoveryAnalysisContinuation>` (`src/index.ts:161-165`)
  - `createPreviewRecoveryHandoff(sessionId, proof, targetSessionId, requestId): Promise<IsolatedTargetLaunch & { continuation: ManagedPreviewRecoveryHandoffContinuation }>` (`src/index.ts:167-172`)：在最新 Local HEAD 上新建受管 Worktree，旧 detached 证据全部保留。
  - `markReadyForReview(sessionId, input: MarkReadyForReviewInput): Promise<SessionTargetView>` (`src/index.ts:173`)
  - `operate(input: SessionCheckoutOperation): Promise<SessionCheckoutOperationResult>` (`src/index.ts:174`)：统一的变更入口（finish / discard 等 action 由该入口分发）。
  - `isAutoDeliverEnabled(): boolean` (`src/index.ts:176`)：读取实时 `autoDeliver` 设置；关闭时工具层拒绝模型驱动的交付。
  - `listManagedWorktrees(input?)` (`src/index.ts:177`) / `listManagedWorktreesForSession(sessionId, input?)` (`src/index.ts:179`)：后者是面向模型与人类会话面的「调用方作用域」列表。
  - `pruneMergedBranchesForSession(sessionId, input?)` (`src/index.ts:181`)：调用方作用域内安全修剪已完全合并的本地分支（`git branch -d` 语义，绝不 force）。
  - `autoPruneStaleMergedBranches(olderThanDays: number)` (`src/index.ts:183`)：维护扫描，跨全部受管项目修剪早于该天数的已合并分支。
  - `mergeBranchForSession(sessionId, input)` (`src/index.ts:185`)：把会话自有的 worktree 分支合入 Local checkout HEAD。
  - `listAbandonedWorktreeSnapshots(sessionId)` (`src/index.ts:187`) / `restoreAbandonedWorktreeSnapshot(sessionId, checkoutId)` (`src/index.ts:189`)：codex 对齐的放弃快照列举与恢复（恢复为 Local 分支并清除快照标记）。
  - `manageManagedWorktreeForSession(sessionId, input)` (`src/index.ts:191`)：调用方作用域管理，**绝不把持久化的 owner id 当授权**。
  - `inspectManagedWorktreeCleanup(input?)` (`src/index.ts:193`)：Main 持有的只读清理巡检，不写注册表/ref/目录。
  - `bulkCleanupManagedWorktrees(candidates: BulkCleanupManagedWorktreeCandidate[])` (`src/index.ts:194`)
  - `manageManagedWorktree(input)` (`src/index.ts:195`)
  - `resolveManagedRoot(checkoutId): Promise<string>` (`src/index.ts:197`)：身份校验后解析受管 checkout 的规范根（用于 workspace 注册）。
  - `resolveRoots(checkoutId): { managedRoot: string; localRoot: string } | undefined` (`src/index.ts:199`)：从注册表直接取两侧边界，**无 Git I/O**（cwd 恢复路径用）。
  - `observeManagedCheckout?(checkoutId)` (`src/index.ts:201`) / `observeManagedCheckouts?(checkoutIds)` (`src/index.ts:203`)：新鲜校验过的观察快照，批量版本在一把锁下执行且结果与请求顺序对齐。
  - `cleanupExpiredRetained(now?: number): Promise<string[]>` (`src/index.ts:204`)
  - `enforceWorktreeKeepCount(): Promise<string[]>` (`src/index.ts:206`)：按 `worktree-keep-count` LRU 逐出最旧的已交付托管 Worktree，`permanent` 豁免。
  - `reconcile(): Promise<SessionCheckoutReconcileSummary>` (`src/index.ts:207`)

### 配置模式 (src/index.ts)

`Config` 由 `@deepseek-ai/schemastery` 的 `z.object` 定义（`src/index.ts:250-308`）。`volatile<T>(schema)` 函数定义在 `src/index.ts:250-253`，给 schema 注入 `meta.volatile = true`——harness 设置页读到该标记后会把字段投影到设置界面，编辑写入 `cordis.patch.yml` 而**不重挂插件**，值以 live 引用到达（注释 `src/index.ts:244`）。

| 字段 | 行号 | volatile | 类型/默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `stateDir` | `src/index.ts:257` | 否 | `z.string()` | 插件状态目录（注册表、disabled-hooks 根），默认 `$DSH_HOME/plugins/dsh-git-worktree`（`~/.dsh` 当 `DSH_HOME` 未设）；被列为可选属性（注释 `src/index.ts:353-358`） |
| `gitTimeoutMs` | `src/index.ts:260` | 是 | `1_000..MAX_GIT_TIMEOUT_MS`，默认 `DEFAULT_GIT_TIMEOUT_MS` | 单个 git 操作超时 |
| `worktreeAddTimeoutMs` | `src/index.ts:261` | 是 | 默认 `300_000` | `git worktree add` 超时 |
| `autoDeliver` | `src/index.ts:268` | 是 | 默认 `true` | Agent 自主交付开关；Working 态指引模型走 `worktree_deliver`，不等人工验收 UI |
| `autoPush` | `src/index.ts:273` | 是 | 默认 `true` | Finish 成功后对 Local 分支尽力 `git push`（绝不 force），失败只报告不阻断 |
| `worktreesRoot` | `src/index.ts:280` | 是 | `z.string()` | 受管 Worktree 根；设为 `<worktreesRoot>/<project>/<topic>-<YYYYMMDD>`，应指向任何 Git checkout 之外 |
| `inheritLocalChanges` | `src/index.ts:286` | 是 | 默认 `true` | codex 对齐：创建时继承本地未提交修改（tracked 打补丁、未 ignore 的 untracked 复制）；仅在 Worktree 基点与本地 HEAD 一致时生效，失败只告警 |
| `worktreeKeepCount` | `src/index.ts:291` | 是 | `0..500`，默认 `15` | 托管 Worktree 总量上限（LRU 按最近更新时间逐出已交付记录；`permanent` 与进行中会话豁免）；`0` 关闭该机制 |
| `branchRaceGuard` | `src/index.ts:298` | 是 | 默认 `true` | 并发分支竞争守卫：当其他活会话共享 Local 且新本地分支在窗口内出现时，后启动会话被指引先隔离 |
| `branchRaceWindowMs` | `src/index.ts:300` | 是 | `60_000..24*3600*1000`，默认 `30*60*1000` | 分支竞争检测窗口（毫秒） |
| `enableWorkspaceProvider` | `src/index.ts:307` | 否 | `z.boolean()`，默认 `false` | 接管官方 ui-workspace；注释强调「只有显式 `true` 才接管」，因为接管会禁用官方入口、使其 client 包从宿主 client graph 移除，所有 import 它的 UI 包都会丢 bundle |

辅助类型与函数：

- **`LocalAdaptationConfig`** (`src/index.ts:310-319`)：`apply` 的本地适配配置形状，`autoDeliver`/`autoPush`/`worktreesRoot`/`inheritLocalChanges`/`worktreeKeepCount`/`branchRaceGuard`/`branchRaceWindowMs` 允许直接值或 `LiveValue<...>`，`enableWorkspaceProvider` 只允许布尔。
- **`resolveWorktreesRootValue(raw)`** (`src/index.ts:321-324`)：`liveConfigValue(raw)?.trim()` 后 `resolve()`，空值返回 `undefined`。
- **`resolveStateDir(config)`** (`src/index.ts:326-330`)：优先 `config.stateDir`；否则 `process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')`，再拼 `plugins/dsh-git-worktree`。

维护常量：

- **`RETENTION_MAINTENANCE_INTERVAL_MS`** (`src/index.ts:332`)：`15 * 60 * 1000`。
- **`AUTO_PRUNE_INTERVAL_MS`** (`src/index.ts:334`)：`24 * 60 * 60 * 1000`。
- **`AUTO_PRUNE_FIRST_RUN_DELAY_MS`** (`src/index.ts:335`)：`60 * 1000`（重启频繁的宿主也能每天扫到）。
- **`AUTO_PRUNE_OLDER_THAN_DAYS`** (`src/index.ts:336`)：`7`。

### 插件元数据 (src/index.ts)

- **`export * from './console-contract.js'`** (`src/index.ts:232`)：控制台契约类型随入口再导出。
- **`name = 'git-worktree'`** (`src/index.ts:234`)。
- **`inject`** (`src/index.ts:242`)：`{ tools: {}, commands: {}, subprocess: {}, loader: { await: false } }`。注释 `src/index.ts:235-241` 说明为何必须是具名导出：loader 从 `inject`/`apply` 具名导出读取插件元数据，裸函数导出会导致首次 `ctx.tools` 访问报 "cannot get property without inject"；`workingDirectory` 是可选服务（桌面壳挂载它，官方实验性 `create_worktree` bundle 也要求它），老宿主保持「只给指引」的行为，因为适配器是动态解析该服务。
- **`volatile<T>(schema)`** (`src/index.ts:245-248`)：给 schema 注入 `meta.volatile = true` 的实现（返回带 `meta.volatile = true` 的 schema）。

### apply() 装配序列 (src/index.ts)

**`apply(ctx: Context, config: { stateDir?: string } & GitTimeoutOptions & LocalAdaptationConfig = {}): Promise<void>`** (`src/index.ts:347`)，语义说明见注释 `src/index.ts:338-346`（每次 Loader 操作都有上限约束，并在下一个 Loader 事件重新进入）。执行顺序：

1. `validateGitTimeouts(config)` (`src/index.ts:348`，来自 `src/adapters/git-options.js` 的导入 `src/index.ts:216`)。
2. 挂载 Workspace Provider 生命周期：`mountWorkspaceProviderLifecycle(ctx, hostWorkspaceClientFlavor(), { enabled: config.enableWorkspaceProvider === true })` (`src/index.ts:352`)，结果记为 `providerLifecycle`。
3. 解析并创建目录：`stateDir = resolveStateDir(config)` (`src/index.ts:353`)、`mkdirSync(stateDir, { recursive: true })` (`src/index.ts:354`)、`hooksPath = join(stateDir, 'disabled-git-hooks')` (`src/index.ts:355`)、再 `mkdirSync(hooksPath, ...)` (`src/index.ts:356`)。
4. 包一层 `worktreesRoot`：`worktreesRootInput = config.worktreesRoot` (`src/index.ts:359`)；若为 `undefined` 则整体 `undefined`，否则 `{ get: () => resolveWorktreesRootValue(worktreesRootInput) }` (`src/index.ts:360-362`)——每次读都解析当前值，使设置页编辑无需重挂即生效。
5. 组装端口：`lookup = createDshLookupPort(ctx)` (`src/index.ts:364`)、`projectSkills = new ProjectSkillStore(join(stateDir, 'project-skills'))` (`src/index.ts:365`)、`git = createDshGitPort(ctx, { hooksPath, projectSkills, gitTimeoutMs: config.gitTimeoutMs, worktreeAddTimeoutMs: config.worktreeAddTimeoutMs })` (`src/index.ts:366`)、`files = createNodeFilesPort()` (`src/index.ts:367`)、`registry = new AtomicJsonCheckoutRegistry(join(stateDir, 'managed-checkouts.json'))` (`src/index.ts:368`)。
6. `mountProjectSkillProvider(ctx, registry)` (`src/index.ts:369`)。
7. 创建核心模块 `createSessionCheckoutModule({ lookup, git, files, registry, applyEngine: createSessionCheckoutApplyEngine({ projectSkills }), managedCheckoutsRoot: stateDir, createCheckoutId: randomUUID, autoDeliver, autoPush, inheritLocalChanges, worktreeKeepCount, branchRaceGuard, branchRaceWindowMs, ...(worktreesRoot ? { worktreesRoot } : {}) })` (`src/index.ts:370-385`)。
8. 构造控制台服务：`new WorktreeConsoleService(ctx, createWorktreeConsoleControlPlane({ module, lookup, files, registry, git, reviewDiff: createGitWorktreeReviewDiffReader(projectSkills) }), join(stateDir, 'sidebar-diag.ndjson'), providerLifecycle.officialWorkspaceActive)` (`src/index.ts:387-394`)。
9. 注册三个面：`registerTools(ctx, module)` (`src/index.ts:396`)、`registerWorktreeCommand(ctx, module)` (`src/index.ts:397`)、`registerSessionTargetContext(ctx, module)` (`src/index.ts:398`)。
10. 启动收敛：`ctx.events.on('ready', ...)` (`src/index.ts:403`) 中执行 `module.reconcile()`（`src/index.ts:404`），当 `summary.staleRootCheckoutIds.length > 0` 时 `console.warn` 提示「本地根已消失（仓库大概率被移动）」（`src/index.ts:407-411`），随后链式 `module.enforceWorktreeKeepCount()`（`src/index.ts:413`），整体 `.catch` 打 warn（`src/index.ts:370-372`）。
11. 保留期维护定时器：`setInterval(..., RETENTION_MAINTENANCE_INTERVAL_MS)` (`src/index.ts:418-424`) 内先 `cleanupExpiredRetained()` 再 `enforceWorktreeKeepCount()`，失败打 warn；`retentionTimer.unref?.()` (`src/index.ts:425`)。
12. 自动修剪：`autoPruneSweep` (`src/index.ts:426-437`) 调用 `module.autoPruneStaleMergedBranches(AUTO_PRUNE_OLDER_THAN_DAYS)`，有结果时 `console.info` 打印 `auto-pruned merged branches older than 7d` 列表；`setTimeout(autoPruneSweep, AUTO_PRUNE_FIRST_RUN_DELAY_MS)` (`src/index.ts:438`) + `setInterval(autoPruneSweep, AUTO_PRUNE_INTERVAL_MS)` (`src/index.ts:440`)，分别 `.unref?.()`（`src/index.ts:426`、`src/index.ts:426`）。
13. `ctx.effect(() => () => { ... })` (`src/index.ts:442-447`) 的清理体注销 `ready` 监听并 `clearInterval`/`clearTimeout` 两个定时器与首次运行 timeout。

### 模型工具 (src/tools.ts)

**`registerTools(ctx: Context, module: SessionCheckoutModule): void`** (`src/tools.ts:94`)，模块注释见 `src/tools.ts:3-12`：模型可预留真实目标会话、列举自己作用域的 worktree、在继续编辑前作废未同步的 review、安全开启已清理的同会话迭代，并停在 Ready for Review；Discard/Remove 仍是人类命令。每个 `execute` 都包在 `withHostLanguage(languageForInvocation(exec.agent, ctx), ...)` 内（`src/tools.ts:133` 等）。

辅助函数（同文件）：

- **`WORKTREE_RETENTION_VALUES`** (`src/tools.ts:22`)：`['cleanup', 'retain_24h', 'retain_3d', 'retain_manual'] as const`。
- **`parseWorktreeRetention(value)`** (`src/tools.ts:24-30`)：`undefined` → `DEFAULT_WORKTREE_RETENTION`；合法字符串原样返回；否则抛 `hostMessage('worktreeDeliverInvalidRetention', { p0: String(value) })` (`src/tools.ts:29`)。
- **`sessionIdOf(agent)`** (`src/tools.ts:32-38`)：从 `agent.session.id` 取会话 id，缺失时抛 `worktreeToolsCanOnlyBeCalledInADSH` (`src/tools.ts:35`)。
- **`renderJson(value)`** (`src/tools.ts:41-43`)：返回 `[{ type: 'text', text: JSON.stringify(value) }]`，模型与 keyed ToolView 共用同一份日志载荷。
- **`leaveCheckoutBeforeRemoval(port, module, agent, checkoutId)`** (`src/tools.ts:51-66`)：`module.resolveRoots?.(checkoutId)` 取两侧边界（`src/tools.ts:51`），无则直接返回 `undefined`；否则 `port.leave(agent, roots.managedRoot, roots.localRoot)` (`src/tools.ts:60`)。失败时打 warn 并把 message 作为「无法恢复 cwd 的原因」返回（`src/tools.ts:51-53`），调用方必须据此中止删除。
- **`enterCheckout(port, module, agent, checkoutId)`** (`src/tools.ts:76-91`)：先读注册表 `module.resolveRoots?.(checkoutId)?.managedRoot`，仅在拿不到时才回退 `module.resolveManagedRoot?.(checkoutId)`（`src/tools.ts:76-77`）——`resolveManagedRoot` 会在全局锁下跑完整 Git 校验，恢复中途的 checkout 或瞬态 git 错误不该把会话甩在 Worktree 之外（注释 `src/tools.ts:76-83`）。失败只 warn 并返回 `undefined`（`src/tools.ts:76-78`）。

九个工具的注册位置、参数与返回：

1. **`worktree_create`** (`src/tools.ts:101-168`)：参数 `topic?` (`src/tools.ts:104-107`)、`branch?` (`src/tools.ts:108-111`)。输出字段 `kind`/`checkoutId`/`targetSessionId`/`managedRoot`/`phase`/`currentOid`/`branch?`/`sourceSessionId`/`cwd?`/`cwdSelected` (`src/tools.ts:101-116`)。执行体 `src/tools.ts:101-132`：`sourceSessionId = targetSessionId = sessionIdOf(exec.agent)`（in-place 创建，`src/tools.ts:136-137`），清洗 `topic`/`branch` (`src/tools.ts:138-139`)，**必须传 `createOptions`（空对象也行）以触发 `bindTarget` 的 local→isolated 升级分支**（`src/tools.ts:140-144`，注释 `src/tools.ts:101-102`），随后 `module.createIsolatedTarget(...)` (`src/tools.ts:140`)，再 `enterCheckout` 让相对路径/文件工具/子进程都落在新 checkout 内（`src/tools.ts:148`）；返回里 `cwdSelected: cwd !== undefined` (`src/tools.ts:160`)，并回传会话分支 `branch` (`src/tools.ts:158`)。
2. **`worktree_list`** (`src/tools.ts:204-261`)：无参数（`parameters: {}` 见 `src/tools.ts:204`）。输出 `{ kind: 'worktree_list', worktrees: [{ checkoutId, projectName, ownerSessionId, iteration, revision, state, phase, dirty, commitOid? }] }` (`src/tools.ts:204-231`)。执行体 `src/tools.ts:204-227`：调用 `module.listManagedWorktreesForSession(sessionId)` (`src/tools.ts:204`)，`commitOid` 用条件展开（`src/tools.ts:218`），注释 `src/tools.ts:204-205` 说明宿主把 `undefined` 判为「非无损 JSON」，而 `null` / `''` 又不携带提交语义。
3. **`worktree_resume_revision`** (`src/tools.ts:227-273`)：无参数 (`src/tools.ts:227`)。执行体 `src/tools.ts:227-250`：先 `module.inspect(sessionId)` (`src/tools.ts:248`)，`delivery.state !== 'ready_for_review'` 时抛 `theCurrentWorktreeHasNoUnsyncedReviewToResume372` (`src/tools.ts:250`)，再 `module.resumeRevision(sessionId, current.revision, current.delivery.review.reviewId)` (`src/tools.ts:252-256`)，未回到 `working` 态则抛 `worktreeDidNotReturnToWorkingState` (`src/tools.ts:257-259`)，返回 `{ kind: 'worktree_revision_resumed', checkoutId, iteration, revision, phase, sessionId }` (`src/tools.ts:227-234`)。
4. **`worktree_begin_next_iteration`** (`src/tools.ts:274-317`)：无参数 (`src/tools.ts:274`)。执行体 `src/tools.ts:274-294`：`module.beginNextIteration(sessionId, current.revision)` (`src/tools.ts:297`)，非 `working` 态抛错 (`src/tools.ts:298-300`)，随后 `enterCheckout` 重新进入重建出的 checkout（注释 `src/tools.ts:274-275`：上一轮迭代清理了 cwd，宿主已还原到原项目），返回 `{ kind: 'worktree_next_iteration_started', checkoutId, iteration, phase, currentOid, sessionId, cwd? }` (`src/tools.ts:274-282`)。
5. **`worktree_ready_for_review`** (`src/tools.ts:542-627`)：参数：`summary` (`src/tools.ts:322-326`，≤240 字符)、`details` (`src/tools.ts:327-330`，≤12000 字符)、`validationStatus`（枚举 `passed|failed|partial|not_run`，`src/tools.ts:331-335`）、`validationSummary` (`src/tools.ts:336-339`)、`tests`（数组，元素 `{ command, status: passed|failed|not_run, summary? }`，`src/tools.ts:340-352`）、`suggestedCommitMessage` (`src/tools.ts:353-357`)。执行体 `src/tools.ts:542-568`：`module.markReadyForReview(sessionId, {...})` (`src/tools.ts:377-388`)，非 `ready_for_review` 抛 `worktreeDidNotEnterAReviewableState` (`src/tools.ts:389-391`)，返回 `{ kind: 'worktree_ready_for_review', state, reviewId, revision, iteration, changedFiles }` (`src/tools.ts:542-549`)。
6. **`worktree_deliver`** (`src/tools.ts:452-553`)：参数 `commitMessage?` (`src/tools.ts:452-455`)、`retention?`（枚举四种保留模式，`src/tools.ts:452-456`）、`report?` (`src/tools.ts:452-455`)。执行体 `src/tools.ts:452-508`：先 `module.inspect(sessionId)` (`src/tools.ts:450`)，`!module.isAutoDeliverEnabled()` 直接抛 `worktreeDeliverDisabledByAutoDeliver` (`src/tools.ts:452-454`)；允许的状态仅 `working` / `ready_for_review`，否则抛 `worktreeDeliverNotAllowedInState` (`src/tools.ts:452-454`)；`ready_for_review` 时自动带上 `expectedReviewId` 并在未给消息时回落 `review.suggestedCommitMessage` (`src/tools.ts:460-463`)；消息仍为空抛 `worktreeDeliverRequiresCommitMessage` (`src/tools.ts:452-454`)；交付可能删除 checkout，故先 `leaveCheckoutBeforeRemoval` 且失败即中止 (`src/tools.ts:470-473`)；然后 `module.operate({ sessionId, expectedRevision, action: 'finish', commitMessage, retention, ...(expectedReviewId ? { expectedReviewId } : {}) })` (`src/tools.ts:474-481`)。非 `finished` 时先 `enterCheckout` 把会话放回 checkout（注释 `src/tools.ts:482-485`：留在 Local 边界会让所有相对路径写入落到原仓库），再抛 `worktreeDeliverUnexpectedResult` (`src/tools.ts:486-490`)；成功返回 `{ kind: 'worktree_delivered', state, commitOid?, branch?, changedFiles, cleanup, push?: { status, message? }, report? }`（`src/tools.ts:452-462`）——其中 `branch` 即会话分支，注释 `src/tools.ts:452` 明确「交付提交落在会话分支上（Local 未被写），把分支名交回调用方用于后续合并」。
7. **`worktree_cleanup`** (`src/tools.ts:533-583`)：参数 `checkoutId?` (`src/tools.ts:512`)、`expectedRevision?` (`src/tools.ts:513`)。执行体 `src/tools.ts:533-558`：`checkoutId` trim 后为空抛 `worktreeCleanupRequiresCheckoutId` (`src/tools.ts:535`)，`expectedRevision` 取 `Math.floor` 后非有限数抛 `worktreeCleanupRequiresExpectedRevision` (`src/tools.ts:536`)，先 `leaveCheckoutBeforeRemoval` (`src/tools.ts:538-541`)，再 `module.manageManagedWorktreeForSession(sessionId, { checkoutId, expectedRevision, action: 'cleanup_retained' })` (`src/tools.ts:542-546`)，返回 `{ kind: 'worktree_cleanup', checkoutId, state, phase, revision, cleanupMessage? }` (`src/tools.ts:533-540`)。
8. **`worktree_prune_branches`** (`src/tools.ts:607-675`)：参数 `dryRun?` (`src/tools.ts:607`)、`olderThanDays?` (`src/tools.ts:565`)。执行体 `src/tools.ts:607-628`：仅当 `olderThanDays` 是有限正数才透传 `Math.floor` 取值（`src/tools.ts:607-612`），调用 `module.pruneMergedBranchesForSession(sessionId, { dryRun: args?.dryRun === true, ... })` (`src/tools.ts:608-613`)，返回 `{ kind: 'worktree_prune_branches', dryRun, headBranch?, pruned: [{name, oid}], skipped: [{name, oid, reason?}] }` (`src/tools.ts:607-617`)。
9. **`worktree_merge`** (`src/tools.ts:671-693`)：参数 `sourceBranch?` (`src/tools.ts:634`)、`dryRun?` (`src/tools.ts:671`)、`direction?` (`src/tools.ts:636`)。执行体 `src/tools.ts:671-693`：`sourceBranch` trim 为空抛 `worktreeMergeSourceBranchRequired` (`src/tools.ts:672`)，`direction` 只接受 `'reverse'` / `'forward'` 否则 `undefined` (`src/tools.ts:673`)，调用 `module.mergeBranchForSession(...)` (`src/tools.ts:674`)；`result.type === 'failed'` 时抛 `result.reason || hostMessage('gitOperationFailedGit', { p0: 'merge', p1: sourceBranch })` (`src/tools.ts:675`)，否则返回 `{ kind: 'worktree_merge', direction, dryRun, sourceBranch, localBranch?, targetBranch?, type, mergedFiles?, conflictingFiles?, conflictDetails?, reason? }` (`src/tools.ts:671-685`)。

全部工具的 `presentCall` 都返回 `{ card: 'generic', title: <hostRegistrationMessage key>, kind: 'other', rawInput: {} }`（如 `src/tools.ts:165`、`src/tools.ts:223`、`src/tools.ts:270`、`src/tools.ts:315`、`src/tools.ts:402`、`src/tools.ts:505`、`src/tools.ts:557`、`src/tools.ts:627`、`src/tools.ts:691`），标题文案由 i18n 注册表提供。

### 用户命令 (src/commands.ts)

**`registerWorktreeCommand(ctx: Context, module: SessionCheckoutModule): void`** (`src/commands.ts:44`)，模块注释 `src/commands.ts:3-7`：破坏性动词刻意留给用户主动触发，模型工具止步于 Ready for Review。

同文件辅助：

- **`targetText(target: SessionTargetView)`** (`src/commands.ts:16-24`)：拼三到四行状态（`checkoutPhase`、`commandDirty`、`commandCurrent`，有 `target.delivery` 时追加 `commandDelivery`）。
- **`sessionIdOf(agent)`** (`src/commands.ts:26-30`)：缺失时抛 `worktreeCanOnlyBeUsedInADSHAgent` (`src/commands.ts:28`)。
- **`RETENTIONS`** (`src/commands.ts:32`)：`Set<WorktreeRetentionMode>` = `cleanup|retain_24h|retain_3d|retain_manual`。
- **`usage()`** (`src/commands.ts:33`)：返回 `usageWorktreeStatusListContinueNextFinalizeReviewIdRevision`。
- **`finishedText(result)`** (`src/commands.ts:35-41`)：拼「提交 N 个文件 / 提交号 / cleanup 结论」，再按 `result.push` 状态附加 `autoPushPushed` 或失败信息。
- **`leaveCheckout(agent, checkoutId)`** (`src/commands.ts:51-61`)：`module.resolveRoots?.(checkoutId)` 后 `workingDirectory.leave(...)`，失败返回错误消息而非吞掉——注释 `src/commands.ts:49-50` 强调「离开失败必须中止删除」，否则会话 cwd 指向已不存在的目录。
- **`enterCheckout(agent, checkoutId)`** (`src/commands.ts:62-72`)：与 tools 侧同构，先注册表后 `resolveManagedRoot` 回退；失败仅 warn 返回 `undefined`。

命令注册：`ctx.commands.register({ name: 'worktree', description: hostRegistrationMessage('inspectAndExplicitlyAcceptManagedWorktreeDelivery'), input: { hint: ... }, handler })` (`src/commands.ts:73-227`)。`workingDirectory = createSessionWorkingDirectoryPort(ctx)` 在注册时构造一次（`src/commands.ts:77`），因为交付/丢弃可能删除 checkout，命令必须先退出（注释 `src/commands.ts:77-79`）。`handler` 把 `invocation.rawInput.trim().split(/\s+/u)` 切成 tokens，首 token 为 verb，缺省 `'status'`（`src/commands.ts:78-80`）。

动词分派（`src/commands.ts:83-222`）：

- **`status`** (`src/commands.ts:84-86`)：`module.inspect(sessionId)` → `targetText`。
- **`list`** (`src/commands.ts:87-96`)：`module.listManagedWorktreesForSession(sessionId)`；空则 `noManagedWorktreesVisibleToThisSession`，否则每行 `checkoutId  project.name  i<iteration>  <state>/<phase>  dirty=<bool>`。
- **`continue`** (`src/commands.ts:97-109`)：非 `ready_for_review` 报 `theCurrentWorktreeHasNoUnsyncedReadyForReview`；否则 `module.resumeRevision(sessionId, current.revision, current.delivery.review.reviewId)`，回报恢复到的迭代号。
- **`next`** (`src/commands.ts:110-120`)：`module.beginNextIteration(sessionId, current.revision)` 后 `enterCheckout` 重新进入（注释 `src/commands.ts:110`：重建的 checkout 再次成为会话 cwd）。
- **`finalize [<reviewId> <revision>] [retention]`** (`src/commands.ts:123-161`)：`tokens[1]` 若不是合法 retention 即视为 reviewId (`src/commands.ts:123`)，据此决定 `expectedReviewId` / `parsedRevision` / `retention`（默认 `DEFAULT_WORKTREE_RETENTION`，`src/commands.ts:125`）；非法组合回 `usage()` (`src/commands.ts:126-128`)；要求当前态为 `ready_for_review` (`src/commands.ts:130`)；reviewId 与 revision 双 CAS 不匹配报「该 review 卡片已过期」(`src/commands.ts:133-138`)；先 `leaveCheckout`，失败即中止 (`src/commands.ts:139-142`)；再 `module.operate({ action: 'finish', sessionId, expectedRevision, commitMessage: target.delivery.review.suggestedCommitMessage, retention, ...expectedReviewId })` (`src/commands.ts:143-150`)。失败分支会 `enterCheckout` 把会话放回仍存在的 checkout (`src/commands.ts:153`)，冲突时回报冲突文件与 Local HEAD 短 oid (`src/commands.ts:123-124`)。
- **`finish <message>`** (`src/commands.ts:33-52`)：`commitMessage = rawInput.slice(verb.length).trim()`，为空回 `usage()`；同样先 `leaveCheckout` 再 `module.operate({ action: 'finish', ... })`（不带 retention，走默认）。
- **`discard`** (`src/commands.ts:180-200`)：`leaveCheckout` 后 `module.operate({ action: 'discard', sessionId, expectedRevision: target.revision, confirmDirty: true, ...(target.delivery?.state === 'preview_active' ? { rollbackPreview: true } : {}) })` (`src/commands.ts:186-192`)；非 `discarded` 时把会话送回 checkout (`src/commands.ts:194`)。
- **`remove <checkoutId>`** (`src/commands.ts:33-51`)：缺参回 `usage()`；`module.listManagedWorktreesForSession(sessionId, { checkoutId })` 取作用域内摘要（无则 `noManagedWorktreeVisibleToThisSession`）；`leaveCheckout` 成功后 `module.manageManagedWorktreeForSession(sessionId, { checkoutId, expectedRevision: summary.revision, action: 'discard', confirmDirty: true, ...(summary.state === 'preview_active' ? { rollbackPreview: true } : {}) })` (`src/commands.ts:211-217`)。
- **`default`** (`src/commands.ts:220-221`)：`unknownVerb`（带 `JSON.stringify(verb)` 与 usage）。
- 整体 `try/catch` (`src/commands.ts:223-225`)：任何异常折叠为 `{ kind: 'error', text: ... }`，命令面永不抛穿。

### 会话目标上下文 (src/session-target-context.ts)

**`registerSessionTargetContext(ctx: Context, module: SessionCheckoutModule): void`** (`src/session-target-context.ts:14`)。它先构造 `workingDirectory = createSessionWorkingDirectoryPort(ctx)` (`src/session-target-context.ts:28`)，若 `module.refreshBranchRaceGuards` 是函数则注册一个 45 秒间隔的调用定时器（`src/session-target-context.ts:20-27`）。然后用 `ctx.inject(['systemPrompt'], ...)` (`src/session-target-context.ts:28`) 注册一个上下文片段：`scope.systemPrompt.context({ name: 'git-worktree:session-target', order: 118, text: (context) => ... })` (`src/session-target-context.ts:29-40`)。`text` 从 `context.agent.session.id` 取会话 id (`src/session-target-context.ts:33`)，在宿主语言上下文中同步调用 `module.runtimeContext(sessionId, workingDirectory.current(context.agent))` (`src/session-target-context.ts:36`)，会话 id 非字符串时返回空串。`workingDirectory.current(...)` 的用途由注释 `src/session-target-context.ts:28-29` 说明：判断本会话**已经站在自己的 checkout 内**（`worktree_create` 移进去了）还是仍在 Local，从而决定是否需要公告绝对路径规则。类型 `ContextAgent` 定义在 `src/session-target-context.ts:9-11`。

### 宿主兼容探测 (src/host-compat.ts)

- **`WorkspaceClientFlavor`** (`src/host-compat.ts:5`)：`'legacy' | 'alpha' | 'next' | 'modern' | 'unsupported'`。
- **`workspaceClientFlavorForAgentVersion(version)`** (`src/host-compat.ts:7-23`)：精确锚点 `0.1.2-rc.1 → legacy` (`src/host-compat.ts:7`)、`0.1.6-alpha.2 → alpha` (`src/host-compat.ts:7`)、`0.1.7-rc.2 → next` (`src/host-compat.ts:7`)、`0.2.0-rc.2 → modern` (`src/host-compat.ts:11`)；此外任何 `0.2.x` 走 `isModernGeneration` 判为 `modern` (`src/host-compat.ts:21`)，其余（含 `0.1.x` 的未知版本与 `0.3+`）一律 `unsupported` (`src/host-compat.ts:22`)。注释 `src/host-compat.ts:12-20` 给出理由：modern 分支消费的 slots/sessions/workspaces/locale/remote/layout/shortcuts、`sidebar.workspaces` 及其子槽位都已对照 0.2.1-rc.3 宿主源码验证未变，所以未钉版本的 0.2.x 归到同一代；而 0.1.x 对应三种 flavor、0.3+ 未做源码验证，都保持 unsupported。
- **`isModernGeneration(version)`** (`src/host-compat.ts:25-28`，内部函数)：`/^(\d+)\.(\d+)\./` 匹配后要求主版本 `0`、次版本 `2`。
- **`agentVersionFromAnchor(anchor)`** (`src/host-compat.ts:30-40`，内部函数)：用 `createRequire(anchor.startsWith('file:') ? anchor : pathToFileURL(anchor).href)` (`src/host-compat.ts:33`) 解析 `@deepseek-ai/dsh-agent/package.json` 并读 `version`，仅当 `manifest.name === '@deepseek-ai/dsh-agent'` 才认 (`src/host-compat.ts:37`)，异常静默 `catch` (`src/host-compat.ts:38`)。
- **`WorkspaceFlavorAnchorDiagnostic`** (`src/host-compat.ts:42-47`)：`kind: 'entry' | 'cwd' | 'plugin' | 'extra'`、`anchor: string`、`ok: boolean`、`version?: string`。
- **`WorkspaceFlavorDiagnostics`** (`src/host-compat.ts:49-53`)：`{ flavor: WorkspaceClientFlavor; anchors: WorkspaceFlavorAnchorDiagnostic[] }`。
- **`ANCHOR_KINDS`** (`src/host-compat.ts:54`，内部常量)：`['entry', 'cwd', 'plugin']`。
- **`workspaceFlavorDiagnostics(anchors = [process.argv[1], process.cwd(), import.meta.url])`** (`src/host-compat.ts:63-75`)：按顺序探测，记录每个探针（超出前三的归为 `extra`，`src/host-compat.ts:71`），**第一个**解析成功的锚点决定 flavor (`src/host-compat.ts:63`)，全失败则 `'unsupported'` (`src/host-compat.ts:63`)。注释 `src/host-compat.ts:63-68` 说明锚点顺序：在 `link:` 安装下插件自己的 `node_modules` 会遮住宿主树，所以运行入口脚本与 cwd 优先，插件路径只作最后手段。
- **`hostWorkspaceClientFlavor()`** (`src/host-compat.ts:77-79`)：返回 `workspaceFlavorDiagnostics().flavor`，供 `apply` 传给 `mountWorkspaceProviderLifecycle`。

### 宿主语言运行时 (src/i18n/host.ts)

- **`languages`** (`src/i18n/host.ts:6`，内部常量)：`AsyncLocalStorage<Language>`，承载「每次调用一个不可变 locale 快照」，在异步续体之间隔离（注释 `src/i18n/host.ts:6`）。
- **`currentHostLanguage()`** (`src/i18n/host.ts:8-10`，导出)：读 store，缺省 `'zh'`。
- **`withHostLanguage(language, operation)`** (`src/i18n/host.ts:12-14`，导出)：`languages.run(normalizeLanguage(language), operation)`。
- **`languageFromSettings(ctx)`** (`src/i18n/host.ts:17-27`，导出)：只读公开且属于 context 的 DSH settings 缝隙（注释 `src/i18n/host.ts:17`）——`ctx.get?.('settings').get?.('locale').preference` 经 `normalizeLanguage` 归一；异常回退 `'zh'` (`src/i18n/host.ts:17-20`)，因为可选服务/命名空间在组合或拆卸期可能缺席。
- **`languageForInvocation(agent, fallbackContext)`** (`src/i18n/host.ts:30-33`，导出)：优先 `agent.ctx`，避免作用域设置在不同用户间泄漏。
- **`hostMessage`** (`src/i18n/host.ts:35-38`，导出)：`Translator<typeof hostMessages>`，内部用 `createTranslator(hostMessages, currentHostLanguage())`（来自 `./core.js`，导入见 `src/i18n/host.ts:2`）并转发首个参数对象。

## Architecture

```text
┌────────────────────────── src/index.ts apply() (347-447) ──────────────────────────┐
│ inject (242) Config (250-308) volatile() (245-248)                                  │
│ 348 validateGitTimeouts │ 352 mountWorkspaceProviderLifecycle ◄─ host-compat (77-79)│
│ 364-368 ports │ 370-385 createSessionCheckoutModule ─► session-checkout-module      │
│ 387-394 WorktreeConsoleService ─► console-host │ 396-398 register 3 faces           │
└───────┬───────────────────────┬────────────────────────┬───────────────────────────┘
        ▼                       ▼                        ▼
┌──────────────┐      ┌────────────────────┐     ┌──────────────────────────┐
│ src/tools.ts │      │ src/commands.ts    │     │ session-target-context   │
│ registerTools │      │ registerWorktreeCmd│     │ systemPrompt order 118   │
│ (94) 9 tools  │      │ (44) /worktree    │     │ runtimeContext(sessionId)│
└──────┬───────┘      └─────────┬──────────┘     └────────────┬─────────────┘
       │ leave/enter cwd        │ leave/enter cwd             │ 只读快照
       ▼                        ▼                             ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ adapters/working-directory.ts SessionWorkingDirectoryPort (enter/leave/current)│
└────────────────────────────────────────────────────────────────────────────┘
```

维护面：403 ready → reconcile+enforceWorktreeKeepCount；418 15min → cleanupExpiredRetained+enforceWorktreeKeepCount；438 60s首跑/440 24h → autoPruneStaleMergedBranches(7d)；定时器 unref(425/439/441)，442 ctx.effect 清理。

## Data Flow

1. **装配**：宿主调用 `apply(ctx, config)`（`src/index.ts:347`）。`validateGitTimeouts` 校验超时（`src/index.ts:348`）→ `hostWorkspaceClientFlavor()` 探测宿主代次（`src/host-compat.ts:77-79`）→ `mountWorkspaceProviderLifecycle` 决定是否接管官方 Workspace UI（`src/index.ts:352`）→ 解析 `stateDir`/`hooksPath` 并建目录（`src/index.ts:353-356`）→ 组装 lookup/git/files/registry 端口（`src/index.ts:347-351`）→ 包装 `worktreesRoot` 为 live getter（`src/index.ts:359-362`）→ `createSessionCheckoutModule` 注入配置（`autoDeliver`/`autoPush`/`inheritLocalChanges`/`worktreeKeepCount`/`branchRaceGuard` 等，`src/index.ts:370-385`）。
2. **注册**：`WorktreeConsoleService` 挂 RPC 面（`src/index.ts:387-394`）；`registerTools` / `registerWorktreeCommand` / `registerSessionTargetContext` 分别把模型工具、人类命令、系统提示片段注册进 Cordis 上下文（`src/index.ts:396-398`）。三者都只在注册期拿到 `module` 引用，运行期才真正读配置（volatile 字段走 live 引用）。
3. **模型路径**：Agent 调 `ctx.tools` 上的 `worktree_*`。工具先 `sessionIdOf(exec.agent)` 锁定会话作用域（`src/tools.ts:32-38`），再过 `withHostLanguage` 建立语言快照（`src/i18n/host.ts:12-14`），然后做前置断言（`isAutoDeliverEnabled`、`delivery.state`、参数非空/CAS 数值），调用 `SessionCheckoutModule` 方法，结果经 `renderJson` 或结构化对象返回（`src/tools.ts:41-43`）。凡可能删除 checkout 的路径（`worktree_deliver`、`worktree_cleanup`）都先 `leaveCheckoutBeforeRemoval`，失败即中止（`src/tools.ts:51-66`）；失败回滚时再 `enterCheckout` 把会话送回 checkout（`src/tools.ts:76-91`）。
4. **人类路径**：`/worktree <verb>` 解析 tokens，缺省 `status`（`src/commands.ts:78-80`）；`finalize` 走 reviewId+revision 双 CAS（`src/commands.ts:121-159`），`finish` 直接用消息体（`src/commands.ts:160-179`），`discard`/`remove` 带 `confirmDirty: true` 并在 `preview_active` 时追加 `rollbackPreview: true`（`src/commands.ts:180-219`）。所有会删 checkout 的动作用同一套 `leaveCheckout → operate → 失败则 enterCheckout` 三段式（`src/commands.ts:51-72`）。
5. **上下文注入**：每次行内装配时，`git-worktree:session-target` 片段同步调用 `module.runtimeContext(sessionId, cwd)`（`src/session-target-context.ts:36`），`cwd` 来自 `workingDirectory.current(context.agent)`（`src/session-target-context.ts:15`）——不产生 Git/文件 I/O，保证回放稳定。
6. **维护**：`ready` 事件触发 `reconcile()`（`src/index.ts:403-416`，本地根消失会 warn 列出 `staleRootCheckoutIds`）并 `enforceWorktreeKeepCount()`；每 15 分钟清理过期保留再执行 LRU 逐出（`src/index.ts:431-437`）；每 24 小时（首次 60 秒后）跨项目修剪 7 天前的已合并本地分支（`src/index.ts:431`/`440`），有修剪结果时 `console.info`。

## Connections

- [[session-checkout-module]]：核心状态机，本入口所有方法的实现方（`inspect`/`operate`/`bind`/`markReadyForReview` 等），由 `src/index.ts:223` 导入 `createSessionCheckoutModule`。
- [[session-checkout-apply]]：`createSessionCheckoutApplyEngine({ projectSkills })` 提供文件变更应用引擎（`src/index.ts:222`、`375`）。
- [[console-host]]：`createWorktreeConsoleControlPlane` + `WorktreeConsoleService` 构成侧边栏/控制台 RPC 面（`src/index.ts:227-229`、`387-394`）。
- [[target-console]]：消费 console 契约（`src/index.ts:232` 的 `export * from './console-contract.js'`）的客户端目标视图。
- [[review-console]]：Ready for Review 卡片与人工验收条的 UI 侧。
- [[adapters]]：`createDshGitPort` / `createNodeFilesPort` / `createDshLookupPort` / `AtomicJsonCheckoutRegistry` / `createSessionWorkingDirectoryPort` 全部来自 `src/adapters/`。
- [[volatile-settings-live-config]]：`volatile()` 与 live 引用（`worktreesRoot` 的 `{ get }` 包装、`liveConfigValue`）的机制来源（`src/index.ts:245-248`、`321-324`）。
- [[git-worktree]]：插件入口模块本身的导航页。

## Known Issues

1. **`enableWorkspaceProvider` 的两处注释语义需对照代码**：`Config` 注释（`src/index.ts:250-254`）写「只有显式 `true` 才接管」，而 `apply` 的文档注释（`src/index.ts:250-258`）写「legacy 宿主 opt-in、modern 0.2.x 宿主自动接管，flag 在 modern 上仅 advisory」。代码实际行为由 `mountWorkspaceProviderLifecycle(ctx, hostWorkspaceClientFlavor(), { enabled: config.enableWorkspaceProvider === true })`（`src/index.ts:352`）与 `hostWorkspaceClientFlavor()`（`src/host-compat.ts:77-79`）共同决定，判定细节在 `workspace-provider-lifecycle.ts`（未在本文源码范围内）；读代码时不应只信 `Config` 注释。
2. **`0.1.x` 未知版本与 `0.3+` 一律 `unsupported`**（`src/host-compat.ts:22`）。0.1.x 有三种 flavor 无法从版本号唯一定位，0.3+ 未经宿主源码验证；碰到未验证宿主时 `hostWorkspaceClientFlavor()` 返回 `unsupported`（`src/host-compat.ts:77-79`），Workspace 接管路径退化为不可用。
3. **锚点探测在 `link:` 安装下会失真**：`workspaceFlavorDiagnostics` 的前两个锚点是 `process.argv[1]` 与 `process.cwd()`（`src/host-compat.ts:64`），插件路径只作最后手段（`src/host-compat.ts:63-71`）；若进程在这些锚点上解析到插件自己的 dev 依赖，读到的 `@deepseek-ai/dsh-agent` 版本是构建期版本而非宿主版本（注释 `src/host-compat.ts:63-68` 已警示）。`agentVersionFromAnchor` 的 `catch` 是静默的（`src/host-compat.ts:38`），失败只体现为该锚点 `ok: false`。
4. **`enterCheckout` 失败是软失败**：`src/tools.ts:76-91` 与 `src/commands.ts:62-72` 都只 `console.warn` 并返回 `undefined`，`worktree_create` 的 `cwdSelected` 因此可能为 `false`（`src/tools.ts:160`），此时模型仍拿到「已创建」的回执但实际 cwd 未移动，后续相对路径写入会落到别处。相反，`leaveCheckout*`（`src/tools.ts:76-91`、`src/commands.ts:51-61`）失败是硬失败，必须中止删除。
5. **`worktree_deliver` 被 `autoDeliver` 关闭时直接拒绝**（`src/tools.ts:8-10`），模型侧没有其他交付工具；此时只能走 `worktree_ready_for_review` + 人工验收条（模块注释 `src/tools.ts:8-17`、`src/commands.ts:3-7`）。Discard/Remove 也没有对应的模型工具，只有 `/worktree` 动词（`src/commands.ts:180-219`）。
6. **配置文件/目录膨胀无自动回收**：`stateDir` 下的 `managed-checkouts.json`（`src/index.ts:368`）、`disabled-git-hooks`（`src/index.ts:355`）、`project-skills`（`src/index.ts:365`）、`sidebar-diag.ndjson`（`src/index.ts:394`）由插件自行创建；前两者没有清理路径，`sidebar-diag.ndjson` 的截断策略在 `WorktreeConsoleService` 内部（未在本文源码范围内）。
7. **定时器依赖 `.unref?.()`**（`src/index.ts:442`、`src/index.ts:442`、`src/index.ts:442`）：在缺少该方法的运行时会残留句柄；`ctx.effect` 的清理体（`src/index.ts:442-447`）只是注销 `ready` 监听与清定时器，不清理 `WorktreeConsoleService` 已注册的 RPC 面（由该服务自身负责）。
8. **`languageFromSettings` 与 `currentHostLanguage` 都默认 `'zh'`**（`src/i18n/host.ts:8-10`、`src/i18n/host.ts:17-27`）：宿主 language 服务缺失或异常时不会给出英文兜底，非中文宿主会看到中文文案。
