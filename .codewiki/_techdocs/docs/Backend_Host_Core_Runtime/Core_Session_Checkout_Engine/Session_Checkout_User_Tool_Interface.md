---
title: 会话签出用户工具接口（Session_Checkout_User_Tool_Interface）
description: 本模块是整个托管 Worktree 状态机面向 模型（Agent） 的唯一工具入口，对应源码文件 src/tools.ts。它对外导出一个 registerTools(ctx, module) 注册函数，把九个语义安全、参数受控的 DSH 模型工具挂载到宿主工具注册表上；自身 不实现任何 Git…
---

# 会话签出用户工具接口（Session_Checkout_User_Tool_Interface）

!!! info "Generated documentation"
    This page was written by CodeWiki from the source code at commit [`4910b846`](https://github.com/wloops/dsh-git-worktree/commit/4910b846b1a2225eb764858a3a7f38e857681333) on 2026-11-07 with `doubao-seed-2.1-lite`. Check the code before relying on details.

## 简介

本模块是整个托管 Worktree 状态机面向 **模型（Agent）** 的唯一工具入口，对应源码文件 [`src/tools.ts`](../../../src/tools.ts)。它对外导出一个 `registerTools(ctx, module)` 注册函数，把九个语义安全、参数受控的 DSH 模型工具挂载到宿主工具注册表上；自身 **不实现任何 Git 操作或状态机逻辑**，而是把每次调用翻译为对 [`SessionCheckoutModule`](../Core_Workspace___Worktree_Domain_Layer.md) 契约方法的幂等调用，并在前后包裹三类安全约束：

1. **会话作用域校验** —— 所有工具必须运行在真实 DSH Session 内（`sessionIdOf`），拒绝裸环境调用；
2. **Session 工作目录（cwd）生命周期** —— 在签出目录建立/重建时 `enter`，在目录被删除前 `leave`，在交付失败时回退 `enter`，避免相对路径写入落进原仓库；
3. **交付门禁** —— `worktree_deliver` 受 `autoDeliver` 配置开关与交付状态机双重约束，人工接受（Accept）通道始终绕开模型工具。

> 人类命令（`/worktree` 接受、Discard/Remove）不在本模块注册，它们由 [`src/commands.ts`](../../../src/commands.ts) 的 Human Command 层与客户端 ToolView 呈现；本模块只负责模型可调用的那一侧。

---

## 在系统中的位置

```mermaid
flowchart TB
    subgraph Host["DSH 宿主（cordis Context）"]
        ToolReg["ctx.tools 注册表"]
        CmdReg["ctx.commands 注册表（人类命令）"]
        WD["workingDirectory 服务（可选挂载）"]
    end

    subgraph Engine["Core_Session_Checkout_Engine 引擎层"]
        Tools["Session_Checkout_User_Tool_Interface<br/>src/tools.ts::registerTools<br/>（本模块）"]
        Apply["Session_Checkout_Apply_Execution_Engine<br/>默认状态机执行引擎"]
        Mod["SessionCheckoutModule 组装层<br/>（台账、校验、作用域收口）"]
        Path["Managed_Worktree_Path_Candidate_Resolution<br/>托管路径解析"]
    end

    subgraph Domain["Core_Workspace___Worktree_Domain_Layer"]
        Ports["ports.ts：SessionCheckoutModule 契约"]
        Types["types.ts：交付状态视图 / 校验枚举"]
    end

    subgraph Adapters["Adapter_Infrastructure_Implementations"]
        WDAdapter["adapters/working-directory.ts<br/>createSessionWorkingDirectoryPort"]
        Git["adapters/git.ts / registry.ts"]
    end

    subgraph Client["Client_UI_Application_Layer"]
        ReviewConsole["客户端评审台<br/>（人类 Accept 卡片）"]
        TargetConsole["目标控制台<br/>（状态徽章、分支图）"]
    end

    ToolReg --> Tools
    CmdReg -.->|人类命令不在本层| ReviewConsole
    Tools -->|类型依赖| Ports
    Tools -->|类型依赖| Types
    Tools --> WDAdapter
    WDAdapter --> WD
    Mod --> Apply
    Mod --> Path
    Ports --> Mod
    Apply --> Git
    ReviewConsole -->|RPC| TargetConsole
```

- 引擎层的其他组成与职责分工见父页 [会话检出核心引擎（Core_Session_Checkout_Engine）](../Core_Session_Checkout_Engine.md)；
- 本模块依赖的 domain 契约与视图类型定义见 [核心工作区与 Worktree 领域层](../Core_Workspace___Worktree_Domain_Layer.md)；
- 人类侧评审/接受界面如何消费本模块产生的 reviewId 与交付状态，见 [客户端评审控制台功能（Client Review Console Feature）](../../Client_UI_Application_Layer/Client_Review_Console_Feature.md)。

---

## 组件总览

`src/tools.ts` 内部由一个注册入口与五个私有辅助函数构成：

| 组件 | 角色 | 关键行为 |
| --- | --- | --- |
| `registerTools(ctx, module)` | 注册入口 | 构造 `SessionWorkingDirectoryPort`，循环 `ctx.tools.register(defineTool({...}))` 注册全部九个工具 |
| `sessionIdOf(agent)` | 作用域守卫 | 从 `exec.agent.session.id` 取 SessionId；缺失即抛 `worktreeToolsCanOnlyBeCalledInADSH` |
| `renderJson(value)` | 输出渲染器 | 把工具返回值序列化为单一 `{ type: 'text', text: JSON }` 块，供模型与客户端 keyed ToolView 共同消费 |
| `enterCheckout(port, module, agent, checkoutId)` | cwd 迁入 | 先从台账 `resolveRoots` 读 managedRoot（同步、免 Git 校验），缺失再回退 `resolveManagedRoot`（持锁全量校验）；失败返回 `failure` 而非静默 |
| `leaveCheckoutBeforeRemoval(port, module, agent, checkoutId)` | cwd 迁出 | 删除签出前把 Session 移出；返回非空原因表示迁出失败，调用方必须中止删除 |
| `parseWorktreeRetention(value)` | 参数解析 | 校验 `cleanup / retain_24h / retain_3d / retain_manual`，缺省回落到 `DEFAULT_WORKTREE_RETENTION`（`retain_manual`） |

所有工具执行体都被 `withHostLanguage(languageForInvocation(exec.agent, ctx), async () => {...})` 包裹，按本次调用的 Agent 作用域设定语言快照；i18n 机制细节见 [Internationalization (i18n) Layer](../../../Shared_Cross-Tier_Contracts___Utilities/Internationalization_(i18n)_Layer.md)。

---

## 注册的九个模型工具

```mermaid
flowchart LR
    subgraph Lifecycle["创建与迭代生命周期"]
        T1["worktree_create"]
        T2["worktree_list"]
        T3["worktree_resume_revision"]
        T4["worktree_begin_next_iteration"]
    end

    subgraph Delivery["评审与交付"]
        T5["worktree_ready_for_review"]
        T6["worktree_deliver"]
    end

    subgraph Maintenance["仓库维护"]
        T7["worktree_cleanup"]
        T8["worktree_prune_branches"]
        T9["worktree_merge"]
    end

    T1 -->|建立 isolated checkout| T5
    T5 -->|ready_for_review 状态| T6
    T5 -->|评审后需继续改| T3
    T6 -->|交付完成| T4
    T6 -->|已交付签出| T7
    T1 --> T2
    T9 -->|会话分支合并回 Local| T8
```

### 1. 创建与迭代生命周期

| 工具 | 调用的模块方法 | 入参 | 成功语义 |
| --- | --- | --- | --- |
| `worktree_create` | `module.createOfficialTarget(agent, {topic?, branch?})` → 随后 `enterCheckout` | 可选 `topic`（人类可读命名）、`branch`（以该分支 tip 为基点） | 经宿主官方 `worktrees` 服务建树，插件登记台账；会话 cwd 迁入新签出（`cwdSelected`/`cwdError` 如实报告） |
| `worktree_list` | `module.listManagedWorktreesForSession(sessionId)` | 无 | 返回当前会话可见的受管 Worktree 摘要（checkoutId、迭代号、revision、state、phase、dirty 等）；空 `commitOid` 键直接省略而非置 null |
| `worktree_resume_revision` | `module.inspect` 前置状态断言 → `module.resumeRevision(sessionId, revision, reviewId)` | 无 | 仅当当前处于 `ready_for_review` 时可用：作废未同步评审，同迭代回到 `working` |
| `worktree_begin_next_iteration` | `module.inspect` → `module.beginNextIteration(sessionId, revision)` → 随后 `enterCheckout` | 无 | 上一迭代已清理后重建签出为下一孤立迭代，并把会话 cwd 重新迁入 |

### 2. 评审与交付

| 工具 | 调用的模块方法 | 关键入参 | 门禁与语义 |
| --- | --- | --- | --- |
| `worktree_ready_for_review` | `module.markReadyForReview(sessionId, {...})` | 必填 `summary`（≤240 字）、`validationStatus`（`passed/failed/partial/not_run`）、`tests[]`、`suggestedCommitMessage`；可选 `details` Markdown | 把签出推进到 `ready_for_review`，产出 `reviewId`、changedFiles；人工 Accept 卡片随后由客户端渲染 |
| `worktree_deliver` | `module.inspect` → 门禁 → `leaveCheckoutBeforeRemoval` → `module.operate({action:'finish', expectedRevision, ...})` | 可选 `commitMessage`、`retention`、`report` | ① `isAutoDeliverEnabled()` 为 false 直接拒绝；② 状态必须是 `working` 或 `ready_for_review`；③ ready 状态下缺省沿用评审建议的提交信息；④ 交付失败时自动 `enterCheckout` 回迁并把失败细节一并抛出 |

> **设计约束**：注释明确写出——`autoDeliver` 关闭时交付被拒绝，改由 `worktree_ready_for_review` + 人类 Accept 栏完成；Discard/Remove 始终是人类命令，不出现在模型工具面。

### 3. 仓库维护

| 工具 | 调用的模块方法 | 关键入参 | 语义 |
| --- | --- | --- | --- |
| `worktree_cleanup` | `module.manageManagedWorktreeForSession(sessionId, {checkoutId, expectedRevision, action:'cleanup_retained'})` | 必填 `checkoutId`、`expectedRevision`（整数） | 删除保留期已结束的签出；删除前 `leaveCheckoutBeforeRemoval`，迁出失败即中止 |
| `worktree_prune_branches` | `module.pruneMergedBranchesForSession(sessionId, {dryRun?, olderThanDays?})` | 可选 `dryRun`、`olderThanDays` | 会话项目内对已完全合并分支做 `git branch -d` 语义安全剪枝，永不 force；返回 pruned / skipped 明细 |
| `worktree_merge` | `module.mergeBranchForSession(sessionId, {sourceBranch, dryRun?, direction?})` | 必填 `sourceBranch`；`direction` ∈ `forward/reverse` | forward：会话分支合入 Local；reverse：Local HEAD 同步进会话分支；`dryRun` 在临时 detached 工作区探测；冲突时返回 conflictingFiles 与 conflictDetails |

---

## 核心交互流程

### 流程一：`worktree_deliver` 的 cwd 安全闭环（最复杂的调用链）

```mermaid
sequenceDiagram
    participant M as 模型
    participant T as registerTools 工具层
    participant S as SessionCheckoutModule
    participant P as SessionWorkingDirectoryPort
    participant WD as 宿主 workingDirectory 服务

    M->>T: worktree_deliver(commitMessage?, retention?)
    T->>T: sessionIdOf(agent) 守卫
    T->>S: inspect(sessionId)
    S-->>T: current{revision, delivery.state, review?}
    T->>T: isAutoDeliverEnabled() 门禁#59 状态门禁
    T->>P: leaveCheckoutBeforeRemoval(checkoutId)
    P->>WD: leave(agent, managedRoot, localRoot)
    alt 迁出失败
        WD-->>P: 错误
        P-->>T: leaveFailure 原因
        T-->>M: 抛 worktreeCwdCouldNotBeRestoredBeforeRemoval
    end
    T->>S: operate(action:'finish', expectedRevision, commitMessage, retention)
    alt result.status != 'finished'
        S-->>T: error / conflict
        T->>P: enterCheckout(checkoutId)
        P->>WD: enter(agent, managedRoot)
        T-->>M: 抛交付细节 #59 附带 cwd 回迁结果
    else 交付成功
        S-->>T: finished{commitOid, branch, changedFiles, cleanup, push}
        T-->>M: worktree_delivered 规范化 JSON
    end
```

要点：**交付可能删除签出目录**，因此「先迁出、再操作、失败回迁」是一个原子性闭环——任何一步 cwd 操作失败都会以 `hostMessage` 错误抛回模型，绝不允许 Session 停留在即将消失或已消失的目录里。

### 流程二：`worktree_create` 与宿主官方建树的衔接

```mermaid
sequenceDiagram
    participant M as 模型
    participant T as registerTools 工具层
    participant S as SessionCheckoutModule
    participant H as 宿主 worktrees 服务
    participant P as SessionWorkingDirectoryPort

    M->>T: worktree_create(topic?, branch?)
    T->>T: sessionIdOf(agent)
    T->>S: createOfficialTarget(agent, opts)
    S->>H: 官方 git worktree add 唯一实现
    H-->>S: {managedRoot, target{checkout, current}}
    Note over S: 结果登记进插件台账（列表/交付/评审/清理复用）
    S-->>T: IsolatedTargetLaunch
    T->>P: enterCheckout(managedRoot)
    P-->>T: cwd 或 undefined（宿主未挂载服务时降级）
    T-->>M: worktree_target_created{checkoutId, phase, currentOid, branch, cwdSelected, cwd?}
```

设计意图在源码注释中明确：全机只有一份 `git worktree add`（宿主拥有），插件拥有跟踪、交付、评审与清理；`cwdSelected === false` 是合法降级而非错误——没有 `workingDirectory` 服务的老宿主退化为「引导式」工作树。

### 流程三：交付状态机与工具的映射

```mermaid
stateDiagram-v2
    [*] --> working: worktree_create、beginNextIteration、resumeRevision 进入
    working --> ready_for_review: worktree_ready_for_review
    ready_for_review --> working: worktree_resume_revision
    working --> finished: worktree_deliver（autoDeliver 开启）
    ready_for_review --> finished: worktree_deliver
    finished --> next_working: worktree_begin_next_iteration
    finished --> retained: worktree_deliver（retention != cleanup）
    retained --> [*]: worktree_cleanup
    working --> working: operate 返回 conflict 或 error（工具层抛错并回迁 cwd，状态不转移）
```

工具层不直接操作这些状态的转移——它只做 **前置断言**（如 `inspect` 看到的 `delivery.state` 必须符合预期），断言失败抛出对应 `hostMessage`，真正的状态机转移由 [会话检出应用执行引擎（Session_Checkout_Apply_Execution_Engine）](Session_Checkout_Apply_Execution_Engine.md) 完成。

---

## 依赖关系

```mermaid
flowchart TB
    subgraph This["src/tools.ts（本模块）"]
        RT["registerTools"]
    end

    subgraph Deps["直接依赖"]
        IDI18N["i18n/host.ts: hostMessage; withHostLanguage; languageForInvocation"]
        IDI18N2["i18n/host-messages.ts: hostRegistrationMessage"]
        ICtx["@deepseek-ai/cordis: Context"]
        ITools["@deepseek-ai/dsh-tools: defineTool"]
        IModule["index.ts: SessionCheckoutModule（契约）"]
        ITypes["types.ts: WorktreeValidationStatus; DEFAULT_WORKTREE_RETENTION"]
        IWD["adapters/working-directory.ts: SessionWorkingDirectoryPort"]
    end

    RT --> IDI18N
    RT --> IDI18N2
    RT --> ICtx
    RT --> ITools
    RT --> IModule
    RT --> ITypes
    RT --> IWD

    IWD -.->|可选动态解析| WDService["ctx.get('workingDirectory')（宿主可选）"]
    IModule -.->|运行时由组装层注入| EngineMod["createSessionCheckoutModule（见项目解析页）"]

    EngineMod -->|详见| ResPage["../Session_Checkout_Module_Project_Resolution.md"]
    IWD -->|详见| AdpPage["../../Adapter_Infrastructure_Implementations.md"]
    IModule -->|详见| DomainPage["../../Core_Workspace___Worktree_Domain_Layer.md"]
```

- `SessionCheckoutModule` 契约的完整方法清单与作用域收口规则：见 [会话检出模块 · 项目解析（Session_Checkout_Module_Project_Resolution）](Session_Checkout_Module_Project_Resolution.md)；
- `workingDirectory` 适配器的降级语义与跨平台路径归一化：见 [适配器基础设施实现（Adapter Infrastructure Implementations）](../Adapter_Infrastructure_Implementations.md)；
- 工具产出的 `reviewId`、`changedFiles` 等数据如何经控制台服务投影给客户端：见 [Worktree 控制台宿主服务（Worktree_Console_Host_Service）](../Worktree_Console_Host_Service.md) 与 [Shared_Worktree_Console_API_Contract —— 共享 Worktree 控制台 API 契约](../../Shared_Worktree_Console_API_Contract.md)。

---

## 关键设计约束速查

| 约束 | 位置 | 说明 |
| --- | --- | --- |
| 必须在 DSH Session 内调用 | 每个工具的 `sessionIdOf(exec.agent)` | 非 Session 上下文（如测试裸调用）直接抛错 |
| 语言按调用快照隔离 | `withHostLanguage(languageForInvocation(exec.agent, ctx), ...)` | 复用 i18n 层的 `AsyncLocalStorage`，避免跨用户串语言 |
| 输出一律规范化 JSON | `renderJson` | 模型侧与客户端 keyed ToolView 共用同一份载荷，空键省略（`commitOid`）而非置 `null`/`''` |
| 签出删除前必须迁出 cwd | `leaveCheckoutBeforeRemoval` | 失败即中止删除，由 `worktree_deliver`/`worktree_cleanup` 强制执行 |
| 交付失败必须回迁签出 | `worktree_deliver` 的 error 分支 | 否则相对路径写入会落回原 Local 仓库 |
| 模型交付受双门禁 | `isAutoDeliverEnabled()` + 状态白名单 | 关闭 autoDeliver 时人工 Accept 是唯一交付通道 |
| 保留期参数白名单 | `parseWorktreeRetention` | 缺省 `retain_manual`（无定时器，永久可检视） |

??? abstract "Documented components (1)"
    - [`enterCheckout`](https://github.com/wloops/dsh-git-worktree/blob/4910b846b1a2225eb764858a3a7f38e857681333/src%5Ctools.ts) — `src\tools.ts`

