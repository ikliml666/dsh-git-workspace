---
title: 会话检出状态机模块（session-checkout-module）
description: src/session-checkout-module.ts 是 dsh-git-worktree 插件的核心编排层：它导出工厂函数 createSessionCheckoutModule(dependencies)，组装出一个完整的 SessionCheckoutModule（接口定义见…
---

# 会话检出状态机模块（session-checkout-module）

!!! info "Generated documentation"
    This page was written by CodeWiki from the source code at commit [`46e0c382`](https://github.com/wloops/dsh-git-worktree/commit/46e0c382490ad42db423bf5c77b7b61d01910892) on 2026-11-07 with `doubao-seed-2.1-lite`. Check the code before relying on details.

## 简介

`src/session-checkout-module.ts` 是 dsh-git-worktree 插件的**核心编排层**：它导出工厂函数 `createSessionCheckoutModule(dependencies)`，组装出一个完整的 `SessionCheckoutModule`（接口定义见 [组合根、领域端口与国际化（root_6）](root_6.md)）。该模块由 Domi 的 session-checkout 状态机移植而来，负责：

- 把 Session 绑定到「本地检出（local）」或「隔离 Worktree（isolated）」两种工作目标；
- 管理托管 Worktree 的**创建、交付（finish）、评审（review）、预览（preview）、检查点（checkpoint）、清理（cleanup）、回收（discard）、恢复（recover）** 全生命周期；
- 以台账（registry）为唯一权威，用 `phase` + `delivery.state` + `journal` 三元组记录任何可能被中断的写操作，使进程崩溃后可以通过 `reconcile()` 确定性收敛；
- 通过注入端口（lookup / git / files / registry）保持宿主无关，磁盘、Git、宿主会话全部经端口访问。

模块内唯一显式导出的组件除工厂外，只有类型 `ResolvedSessionProject`（`{ session, project }`），其余全部实现为工厂闭包内的私有函数——这意味着该模块没有对外的子模块页面，所有行为都通过 `SessionCheckoutModule` 接口暴露。

---

## 架构总览

```mermaid
flowchart TB
    subgraph Host["宿主调用方"]
        Tools["模型工具层<br/>src/tools.ts"]
        Commands["人工命令层<br/>src/commands.ts"]
        Console["Console 控制面<br/>console-host/*"]
        ReconcileCron["启动/定时维护<br/>reconcile、过期清理、LRU 逐出"]
    end

    subgraph Module["session-checkout-module.ts（本模块）"]
        API["SessionCheckoutModule API 面<br/>inspect / bind / operate / manage ..."]
        Lock["绑定锁 withBindingLock<br/>exclusive 队列 + maintenance 只读旁路"]
        Validate["身份校验族<br/>validateManagedCheckoutDetailed<br/>validateCleanupQuarantine ..."]
        State["状态机与投影<br/>inspectIsolated / runtimeContext<br/>projectDelivery / recoveryView"]
        Recover["崩溃恢复族<br/>reconcile / markRecoveryRequired<br/>cleanupFinalized / finishFailedCreation"]
    end

    subgraph Engines["协作引擎"]
        Apply["会话检出应用引擎<br/>plan/apply/preview/rollback/<br/>finalize/checkpoint/commitIsolated"]
    end

    subgraph Ports["端口层（宿主实现）"]
        PRegistry["registry<br/>原子 JSON 台账"]
        PGit["git<br/>worktree 生命周期与分支操作"]
        PFiles["files<br/>目录身份、隔离区、树删除"]
        PLookup["lookup<br/>会话/项目导航"]
        POfficial["officialWorktrees（可选）<br/>宿主自带 worktrees 服务"]
    end

    subgraph Disk["磁盘与 Git 仓库"]
        RegistryFile["registry v2 JSON"]
        ManagedRoot["托管 Worktree managedRoot"]
        LocalRoot["本地检出 localRoot"]
        InternalRefs["内部 refs<br/>previews/*、checkpoints/*、applyBase"]
    end

    Tools --> API
    Commands --> API
    Console --> API
    ReconcileCron --> API
    API --> Lock
    Lock --> Validate
    Lock --> State
    Lock --> Recover
    State --> Apply
    Recover --> Apply
    Validate --> PRegistry
    Validate --> PGit
    Validate --> PFiles
    State --> PRegistry
    Apply --> PGit
    Apply --> PFiles
    PRegistry --- RegistryFile
    PGit --- ManagedRoot
    PGit --- LocalRoot
    PGit --- InternalRefs
    PFiles --- ManagedRoot
    PFiles --- LocalRoot
    POfficial --> ManagedRoot
```

**分层要点**：

1. 本模块是唯一同时持有「台账读写 + 端口调用 + 状态机判定」的层；它不直接 spawn Git 子进程，也不直接操作文件系统，全部经端口完成（可测试、可换宿主）。
2. `applyEngine`（见 [session-checkout-apply 应用引擎](src_session-checkout-apply.ts.md)）负责一切「真实改变磁盘或 refs」的原子操作；本模块负责**在调用前后写 journal、比较指纹、判定冲突归属**。
3. 台账 `ManagedCheckoutsRegistry`（`sessionBindings` + `managedCheckouts`）是崩溃恢复的唯一权威来源；磁盘上的 Worktree 目录只是被校验的对象。

---

## 依赖注入（SessionCheckoutDependencies）

工厂接收的依赖结构（类型见 [组合根、领域端口与国际化（root_6）](root_6.md) 的 `ports.ts` 部分）：

| 依赖 | 角色 | 本模块中的典型用法 |
| --- | --- | --- |
| `lookup` | 会话/项目只读导航 | `requireSession` / `resolveSessionProject` / 归属校验 |
| `git` | Git 端口（见 [组合根、领域端口与国际化（root_6）](root_6.md)） | `inspect`、`status`、`createDetachedWorktree`、`attachWorktreeBranch`、`removeWorktree`、`isAncestor`、内部 refs 保留/释放、分支 prune/merge |
| `files` | 文件端口 | `canonicalize`、`inspectDirectoryIdentity`、`quarantineDirectoryTree`、`removeDirectoryTree`、空目录树回收 |
| `registry` | 原子 JSON 台账 | `read` / `write` / `update`（单条记录读-改-写必须走 `update`） |
| `applyEngine` | 应用引擎 | `plan`、`apply`、`preview`、`rollback`、`finalize`、`checkpoint`、`recoverCheckpoint`、`commitIsolated`、`reviewIsolated`、`assessPreviewRecovery`、`preflight`、`inspectReview` |
| `managedCheckoutsRoot` | 状态目录默认容器 | 未配置 `worktreesRoot` 时的托管根 |
| `createCheckoutId()` | 标识生成 | 生成 `checkoutId` / `operationId` / `reviewId` / `previewId` |
| `officialWorktrees?` | 宿主自带 worktrees 服务懒加载 | `createOfficialTarget` 走官方创建路径 |
| `autoPush` / `autoDeliver` | 实时配置（可 `LiveValue`） | finish 后尽力推送；工具层据 `isAutoDeliverEnabled()` 拒绝模型自行交付 |
| `worktreesRoot` | 自定义托管根 | 按 `<worktreesRoot>/<项目>/<主题>-<日期>` 布局落盘 |
| `inheritLocalChanges` | 新建时继承本地未提交改动 | `carryLocalWorkInProgress`（补丁 + 未跟踪文件复制） |
| `worktreeKeepCount` | LRU 保留数量 | `enforceWorktreeKeepCount` 逐出已交付 Worktree |

---

## 核心数据模型

### 两类台账记录

```mermaid
erDiagram
    SESSION_BINDING ||--o{ MANAGED_CHECKOUT : "target.checkoutId 指向"
    SESSION_BINDING {
        string sessionId
        string projectId
        SessionTargetRef target "local 或 isolated+checkoutId"
        string ownerSessionId
        string sourceRef
        string sourceOid
        number revision
    }
    MANAGED_CHECKOUT {
        string checkoutId
        string ownerSessionId
        string localRoot "本地检出根"
        string managedRoot "托管 Worktree 内项目根"
        string managedGitRoot "托管 Git 顶层"
        string gitCommonDir "共享 commonDir（同一仓库证明）"
        string baseOid "分叉基点"
        string sessionBranch "会话分支 refs/heads/..."
        Phase phase "preparing|ready|mutating|recovery_required|finalized|retained|discarded"
        Delivery delivery "工作交付状态"
        Journal journal "进行中操作收据，无则为 null"
        number revision "乐观并发版本号"
    }
    MANAGED_CHECKOUT ||--o{ CHECKPOINT_RECORD : "checkpoints[]"
    CHECKPOINT_RECORD {
        string checkpointId
        number sequence
        string commitOid
        string parentOid
    }
```

- **SessionBindingRecord**：「这个会话现在面向哪个目标」。`target.kind = 'local'` 表示在本地检出直接工作；`'isolated'` 表示面向某个托管 Worktree。
- **ManagedCheckoutRecord**：托管 Worktree 的权威台账。`localRoot` 永远是用户本地检出边界，`managedRoot` 是隔离环境内的项目根；两者 `commonDir` 相同证明同属一个仓库。
- **revision** 是每个调用方必须回传的乐观锁：任何写操作不匹配 `expectedRevision` 立即返回 `stale_target`。

### 双维度状态：phase × delivery.state

| 维度 | 取值 | 语义 |
| --- | --- | --- |
| `phase`（执行生命周期） | `preparing` / `ready` / `mutating` / `recovery_required` / `finalized` / `retained` / `discarded` | 当前记录是否处于可服务、正在变、需要人工介入 |
| `delivery.state`（交付进度） | `working` / `ready_for_review` / `preview_active` / `preview_detached` / `finalized` / `retained` / `delivered` | 工作成果走到了哪一步 |

两者组合才能表达完整状态，例如 `phase=ready + delivery.state=preview_active` 表示「预览已写入本地、等待用户验收」。

---

## 并发与锁模型

模块内有两套互斥原语，必须区分清楚：

```mermaid
flowchart LR
    subgraph Queue["bindingQueue 串行队列"]
        Ex1["exclusive 操作<br/>bind / operate / finish ..."]
        Ex2["exclusive 操作"]
        Ex3["exclusive 操作"]
    end

    subgraph Maint["maintenance 只读旁路"]
        M1["reconcile<br/>cleanupExpiredRetained<br/>enforceWorktreeKeepCount<br/>preflightPreviewRecovery"]
    end

    Inspect["inspectAvailable<br/>inspect / 运行期检查"]

    Ex1 --> Ex2 --> Ex3
    Maint -. "允许并发读<br/>不写 registry" .-> Inspect
    Queue --> Drain["maintenance_draining 过渡态<br/>等待进行中 inspect 排空后<br/>新的 mutation 才能接管"]
```

- **`withBindingLock(operation)`**：所有交互性 mutation（bind、operate、finish、manage…）串行化；同一时刻只有一个在飞。
- **`withBindingLock(..., { allowConcurrentInspect: true })`**：维护类操作（启动 `reconcile`、到期清理、LRU 逐出、detached preview 评估）以 maintenance 身份取锁——它们可以与同一时期发起的只读 `inspectDuringMaintenance` 并发，避免「一个 Windows 上被占用的历史 Worktree 卡住所有会话刷新」。
- **`inspectAvailable`**：读路径会根据当前锁状态动态决定——处于 maintenance 时走只读旁路（`persistRecovery=false`，不写台账），处于 draining 时先排空再排队取锁。
- **`cleanupInFlight` 超时表**：`withCleanupTimeout(checkoutId, op)` 给单个 checkout 的清理加上 120 秒收敛超时；同一 checkout 若已有在跑（含已超时仍在后台跑）的清理会复用同一个 Promise，防止两个读-改-写周期在台账上交错丢更新。超时不可取消端口操作（端口无 AbortSignal），后台仍继续跑完并写台账。

---

## 交付状态机

```mermaid
stateDiagram-v2
    [*] --> preparing: bindTarget / createIsolatedTarget
    preparing --> ready: createDetachedWorktree 成功<br/>attachSessionBranch 成功
    preparing --> recovery_required: 创建中断且磁盘有残余
    preparing --> [*]: 残余已清空，台账删除

    ready --> working: （初始即 working）
    working --> ready_for_review: markReadyForReview<br/>快照指纹 + 校验项入台账
    ready_for_review --> ready_for_review: checkpoint 保存检查点<br/>（写入 detached 提交链）
    ready_for_review --> preview_active: operatePreview（预览写入本地）
    preview_active --> ready_for_review: rollback_preview（按 receipt 回滚）
    preview_active --> preview_detached: 本地漂移 stale_local / preview_modified
    preview_detached --> preview_active: 携带 recoveryProof 重试 rollback
    preview_detached --> finalized: 携带 recoveryProof 重试 finalize
    preview_active --> finalized: finalize_preview（验收提交）
    ready_for_review --> finalized: finish（仅提交到会话分支，不动本地）
    working --> finalized: finish（无评审直接交付）

    finalized --> retained: retention != cleanup<br/>冻结环境
    finalized --> discarded: cleanupFinalized 成功<br/>delivery.state = delivered
    retained --> discarded: 保留期到期 / 手动清理成功
    ready_for_review --> working: resumeRevision（撤回评审继续改）
    ready --> discarded: operateDiscard<br/>（带未提交内容先快照 abandoned）
    recovery_required --> ready: operateRecover 身份校验通过
```

关键语义：

- **现代交付只写会话分支**（`finish` / `commitIsolated`）：Worktree 的工作区、索引、HEAD 与本地完全隔离，本地检出永不被写。只有旧路径 `apply` / `preview` / `finalize_preview`（往本地写 diff）仍存在，但只要记录上已有 `sessionBranch`，`refuseLegacyLocalWrite` 会直接拒绝并提示改用 `worktree_merge` 合并。
- **`retained` 是冻结检查窗口**：默认 `retain_manual`（无到期时间），用户可设 `retain_24h` / `retain_3d`；到期与 LRU 逐出都走同一条 `cleanupFinalized` 安全链。
- **`delivered` 是交付事实**：cleanup 成功后 phase 变 `discarded` 而 delivery 停在 `delivered`；「commit 已在会话分支」优先于「目录还在不在」，所以后续 `committedFollowupView` 不会把已交付会话误判为 recovery_required。

---

## 关键流程

### 1. 创建隔离目标（bindTarget / createIsolatedTarget）

```mermaid
sequenceDiagram
    participant Caller as 调用方
    participant Mod as SessionCheckoutModule
    participant Reg as registry 台账
    participant Git as git 端口
    participant Files as files 端口

    Caller->>Mod: createIsolatedTarget(sourceSessionId, targetSessionId, options)
    Mod->>Mod: withBindingLock 取排他锁
    Mod->>Reg: read（已有 binding？）
    alt 已绑定终态交付记录
        Mod->>Reg: 释放旧 binding，进入下一迭代计数
    end
    Mod->>Files: canonicalize(project.root)
    Mod->>Git: inspect(localRoot)
    Mod->>Mod: repairStaleWorktreeLinks（仓库搬家后 git worktree repair）
    Mod->>Files: 候选路径容器身份校验/空目录回收
    Mod->>Reg: 写 preparing 记录 + isolated binding（revision=1）
    Mod->>Git: createDetachedWorktree(localRoot, managedGitRoot, baseOid, saveEvidence)
    Git-->>Mod: creation evidence（root/commonDir 身份指纹）
    Mod->>Files: canonicalize 回读 + 容器身份复核
    Mod->>Git: attachSessionBranch（候选分支名逐个尝试，带祖先可快进判定）
    Mod->>Files: carryLocalWorkInProgress（基点==本地 HEAD 时继承未提交改动）
    Mod->>Reg: 更新为 ready（canonical 路径 + sessionBranch）
    Mod->>Mod: inspectIsolated(binding) 返回 SessionTargetView
    Mod-->>Caller: IsolatedTargetLaunch { targetSessionId, managedRoot, target }
```

失败路径（`finishFailedCreation`）：只有 `WorktreeCreationFailure(rolledBack=false)` 或磁盘存在残余目录时才进入 `recovery_required`；若残余为空壳，`removeEmptyDirectoryTree` 回收后直接删除台账并把 binding 退回创建前状态，还会在 sibling 容器不可信时自动 `createAttempt+1` 换 fallback 容器重试一次。

### 2. 交付（finish）

```mermaid
sequenceDiagram
    participant Model as 模型/工具层
    participant Mod as Module
    participant Reg as 台账
    participant Engine as applyEngine
    participant Git as git 端口

    Model->>Mod: operate({ action: 'finish', sessionId, expectedRevision, commitMessage, retention })
    Mod->>Mod: resolveBinding + 归属校验（owner 才能交付）
    Mod->>Mod: inspectIsolated 身份复核（CAS：路径/commonDir/checkpoint 链）
    Mod->>Reg: 更新 phase=mutating, journal={operation:'finish', step:'committing_session_branch'}
    Mod->>Mod: ensureSessionBranch（历史 detached 记录在此补建会话分支）
    Mod->>Engine: reviewIsolated（只看 Worktree 快照，不读本地）
    alt expectedReviewId 存在且指纹不符
        Mod->>Reg: 退回 working，返回 stale_isolated
    end
    Mod->>Engine: commitIsolated（把 Worktree 快照提交到会话分支）
    alt 提交已落地但 ref 更新失败
        Mod->>Reg: 保留 journal.committedOid 作为恢复证据（不回滚已落地提交）
    end
    Mod->>Reg: phase=finalized, delivery.state=finalized + proof
    alt retention != cleanup
        Mod->>Reg: 转 retained（expiresAt 计算）
    else retention == cleanup
        Mod->>Mod: cleanupFinalized（身份校验 → removeWorktree → 隔离区兜底）
    end
    Mod->>Git: pushLocalBranchBestEffort（autoPush 时尽力推会话分支，失败不阻断）
    Mod-->>Model: { status:'finished', commitOid, branch, cleanup, push? }
```

### 3. 预览生命周期（preview / rollback / finalize）

- `operatePreview`：先 `applyEngine.plan` 计算 diff，校验 `isolatedFingerprint` 与评审快照一致；写 `journal={operation:'preview', step:'writing_local'}` 后，在 `beforeWrite` 回调里把 4 个 receipt OID（local-working / local-index / preview-working / isolated-snapshot）**保留为内部 refs**，再真正写本地。任何「可证明未碰本地」的错误（`stale_local` / `stale_isolated` / `invalid_plan`）直接退 ready；已写到 `artifacts_retained` 的失败则释放 preview refs 后再退 ready。
- `operateRollbackPreview`：按 receipt 把本地恢复到写入前快照；遇到 `stale_local` / `preview_modified` 时不硬闯，而是 `detachPreviewAfterLocalDrift` 进入 `preview_detached`，把 receipt 证据冻结在台账里等待人工恢复。
- `operateFinalizePreview`：用户验收后把预览快照在本地提交；detached 状态重试必须携带 `WorktreePreviewRecoveryProof`（SHA-256 over 全部 receipt 事实），模块内重新跑 `assessPreviewRecovery` 并比对 `recoveryGeneration`——proof 只是待复核的上下文，不是免验令牌。

### 4. 检查点（checkpoint）

检查点是评审期间保存在 Worktree 内部历史中的线性阶段（不发布到本地）：

- 入参必须带 `requestId`（幂等键）、`expectedReviewId`、`expectedGeneration`（由 [root_2/root_2_host_adapters.md](root_2/root_2_host_adapters.md) 的 `checkpointGenerationForRecord` 对 review 事实做 SHA-256 得出）。
- journal 完整记录 `commitOid / parentOid / checkpointIndexTreeOid / changedFiles`；`beforeCommit` 回调先把内部 ref 保留进仓库，再允许 detached HEAD/index 变更。
- 中途崩溃后由 `reconcile` 调用 `applyEngine.recoverCheckpoint` 决策：`checkpoint_aborted` 清理内部 ref 退 ready；`checkpoint_recovered` 把检查点正式入台账、delivery 退回 working。
- `checkpointHeadInvariantHolds` 在每次 inspect 时校验整条链（sequence 连续、parent 祖先关系、内部 ref 与 commitOid 一致、最后一个检查点是当前 HEAD 祖先）。

### 5. 启动 reconcile（崩溃收敛）

```mermaid
sequenceDiagram
    participant Cron as 启动/定时
    participant Mod as Module
    participant Reg as 台账
    participant Engine as applyEngine

    Cron->>Mod: reconcile()
    Mod->>Reg: read 全量台账
    loop 逐条记录扫描
        alt phase=discarded 且目录已空
            Mod->>Mod: 空壳目录回收 + 延迟删除无引用台账
        else 创建中断且 predecessor 已交付
            Mod->>Reg: binding 指回 predecessor（继续下一迭代）
        else journal=finish/committing_session_branch
            Mod->>Reg: 退回 ready（提交是否落地由下次交付按 tree 比较得出）
        else journal=finalize_preview/finish 且 step=updating_ref/replacing_index
            Mod->>Reg: 转 recovery_required（ref 已动，index 无法证明）
        else journal=checkpoint
            Mod->>Engine: recoverCheckpoint → 入链 或 abort 或 recovery_required
        else journal=preview 且 receipt 未保留
            Mod->>Reg: 退 ready（可证明未碰本地）
        else journal=preview 且 artifacts_retained
            Mod->>Mod: releasePreviewArtifactsBestEffort 后退 ready
        else 其余 preparing/mutating
            Mod->>Reg: 转 recovery_required
        end
    end
    Mod->>Reg: 一次性 write（revision++）
    Mod->>Mod: 对每个 finalized 记录 withCleanupTimeout(cleanupFinalized)
    Mod->>Mod: cleanupExpiredRetained（到期冻结环境）
    Mod-->>Cron: reconcile 汇总（recovery/orphan/stale 列表 + retainedCount）
```

设计取向：**能按 journal 收据证明「没写过」就安全回退；证明不了本地或索引状态的，一律停在 `recovery_required` 等人来，绝不猜**。

### 6. 清理（cleanupFinalized）

清理是数据保护最严格的一条链：

1. **阻塞分类**：`modified_after_finalize`（交付后又有新改动，默认保留）、`identity_changed`（目录身份 device/inode/birthtime 与台账不符）、`detached_residue`、`quarantine_busy`、`directory_busy`（瞬时占用，参与自动重试）。原因优先取结构化字段 `cleanupReason`，旧记录才回退到中英文关键词匹配。
2. **删除前取证**：`removeWorktree` 前先把 `managedDirectoryIdentity`（device/inode/birthtime）写进 journal，作为「移除收据」。
3. **残留隔离兜底**：git 删完若 `managedGitRoot` 仍在（Windows 文件占用常见），走 `validateDetachedCleanupResidue` 复核身份后 `quarantineDirectoryTree` 到 `.dsh-wt-cleanup--<id>--<opId>` 目录，`retryTransientCleanup`（100/300/800ms 三档）后删除。
4. **清理后收尾**：释放 applyBase 与全部内部 refs；空容器（无人引用的 worktreesRoot 子目录）经 `removeEmptyDirectoryTree` 回收；台账置 `discarded + delivered`。
5. **超时保护**：每个 checkout 的清理最多 120 秒前台等待；`permanent` 标记、`retain_manual`、未到期 retained 不参与自动清理。

---

## API 面分组（SessionCheckoutModule 实现要点）

完整接口签名见 [组合根、领域端口与国际化（root_6）](root_6.md)，这里只列实现侧的分组语义：

| 分组 | 方法 | 说明 |
| --- | --- | --- |
| 读取 | `inspect`、`runtimeContext`、`listManagedWorktrees`、`listManagedWorktreesForSession`、`inspectManagedWorktreeCleanup` | `runtimeContext` 直接面向模型输出多段英文指导文本（当前边界、delivery 状态、该调哪个工具）；`inspect` 动态决定是否旁路 maintenance 锁 |
| 目标绑定 | `bind`、`createIsolatedTarget`、`createOfficialTarget`、`adoptOfficialWorktree` | 官方树（`.agents/worktrees/`）由 [组合根、领域端口与国际化（root_6）](root_6.md) 中 `official-worktree-registration.ts` 的函数登记入台账 |
| 演进 | `beginNextIteration`、`resumeRevision` | 已交付清理后在下一轮以「上一轮会话分支 tip」为基点重建 Worktree；迭代链不丢上一轮成果 |
| 评审/交付 | `markReadyForReview`、`operate`、`preflight`、`isAutoDeliverEnabled` | `operate` 是 9 种写操作（apply/finish/preview/checkpoint/rollback_preview/finalize_preview/retry_cleanup/discard/recover）的统一入口，先 `resolveBinding` 再分发 |
| 恢复授权 | `prepareReviewRegeneration`、`preparePreviewRecoveryAnalysis`、`createPreviewRecoveryHandoff` | 把 Host 权威的只读上下文（continuation）先持久化进台账，客户端提示模型前再回来复核 |
| 分支/合并 | `mergeBranchForSession`、`pruneMergedBranchesForSession`、`autoPruneStaleMergedBranches` | 合并来源必须是本会话分支（`git branch -d` 语义、当前分支/主干/活跃会话分支永不删） |
| 放弃快照 | `listAbandonedWorktreeSnapshots`、`restoreAbandonedWorktreeSnapshot` | 带未提交内容放弃前先把内容固化为 `refs/dsh-worktree/abandoned/<checkoutId>` |
| 管理 | `manageManagedWorktree`、`manageManagedWorktreeForSession`、`bulkCleanupManagedWorktrees`、`resolveManagedRoot(s)`、`observeManagedCheckout(s)` | 后台 console 只读观察接口 |
| 维护 | `reconcile`、`cleanupExpiredRetained`、`enforceWorktreeKeepCount` | 启动收敛与配额收口 |

---

## 设计上的关键不变量（排障速查）

1. **路径不是身份**：一切校验以 `device + inode + birthtime`（`DirectoryIdentity`）和 git `commonDir` 为准；canonicalize 后的字符串比较只防 Junction/软链冒充。
2. **revision CAS**：交互操作一律双检（取操作前检一次、`inspectIsolated` 通过后再读台账检一次），防止「Host 锁拿到之前状态已被改」。
3. **可证明未写 = 安全回退**：凡是错误码能证明本地/索引未被触碰的（`stale_local`、`stale_isolated`、`invalid_plan` 等），journal 直接清空退 ready；其余停 `recovery_required`。
4. **已落地提交永不回滚**：`commitIsolated` 失败但 `committedOid` 已存在时，保留证据而非撤销用户历史。
5. **项目验收槽互斥**：同一 `localRoot` 上任何处于 preview/finalize/finish 中段的记录都占用项目验收槽（`findProjectAcceptanceHolder`），其他任务的 apply/preview/merge 一律返回 `project_acceptance_busy`。
6. **模型指导文本与真实边界一致**：`runtimeContext` 用 `pathIsWithin(cwd, managedRoot)` 判定会话是否真站在 Worktree 内；交付已清理后如实告知「边界回到本地」，避免把写守门规则自相矛盾地套在已完成任务上。

---

## 相关模块链接

- 应用引擎（plan/apply/preview/rollback/checkpoint/commitIsolated 的真实磁盘操作）：[session-checkout-apply 应用引擎](src_session-checkout-apply.ts.md)
- 端口、台账、注册、路径与创建登记类型：[组合根、领域端口与国际化（root_6）](root_6.md)（`ports.ts`、`managed-worktree-path.ts`、`official-worktree-registration.ts`、`index.ts`）
- 视图类型、错误码、操作联合类型：[root_7：dsh-git-worktree 插件出口层](root_7.md)（`types.ts`）
- 检查点 CAS 指纹、台账原子注册表：[root_2/root_2_host_adapters.md](root_2/root_2_host_adapters.md)（`checkpoint.ts`、`adapters/registry.ts`）
- 控制台投影判定（`worktreeReachedDelivery`）：[root_4：Worktree 控制台客户端与宿主命令面](root_4.md)（`console-contract.ts`）
- 创建失败异常类型：[Worktree Console 宿主与远程协议层（root_5）](root_5.md)（`creation-failure.ts`）
- 提交信息校验、面向模型的工具封装：[root_4：Worktree 控制台客户端与宿主命令面](root_4.md)（`commit-message.ts`）与 [root_7：dsh-git-worktree 插件出口层](root_7.md)（`tools.ts`）

??? abstract "Documented components (1)"
    - [`ResolvedSessionProject`](https://github.com/wloops/dsh-git-worktree/blob/46e0c382490ad42db423bf5c77b7b61d01910892/src%5Csession-checkout-module.ts) — `src\session-checkout-module.ts`

