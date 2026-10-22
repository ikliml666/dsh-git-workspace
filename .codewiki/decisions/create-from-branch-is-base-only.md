---
title: "隔离工作树创建与交付链路设计"
type: decision
source_files:
  - src/adapters/worktree-creation.ts
  - src/console-host/control-plane.ts
tags:
  - design
  - create
  - delivery
  - worktree
  - isolation
---

## Overview

本决策记录的是隔离工作树（Isolated Worktree）创建时「分支参数」的语义定位：**创建请求里传入的 `branch` 只用来确定一个基准提交（baseOid），既不把工作树挂到该分支上，也不改变交付目标分支。** 工作树的检出始终是 detached 的。

决策要解决的问题是双重归属。Git 的工作树一旦 attach 到某个分支，该分支就被这个检出「占用」，同一分支无法同时在 Local 检出与工作树检出；更麻烦的是交付语义：如果工作树自己持有分支，那么「把改动交给谁」就退化成「把这个分支合到哪」，交付目标会从源会话的上下文漂移到分支名上，用户看到的 Review 基准和最终写回的分支不再唯一确定。

因此实现把两件事彻底拆开：创建阶段只做「在某个提交上开一个无名检出」，交付阶段的写回基准由 Local 侧决定而非工作树决定。代码上的落点有三处，它们共同构成这个决策的证据链：

- `src/adapters/worktree-creation.ts:44` 的 `git worktree add --detach --no-checkout --lock --reason <uuid> <target> <baseOid>`：注册时强制 `--detach`，分支名甚至没有进入这条命令。
- `src/adapters/worktree-creation.ts:144` 的 `verifyIdentity` 要求 `.git` 目录中 `HEAD` 的内容严格等于 `baseOid`，并在 `src/adapters/worktree-creation.ts:140-145` 里校验 `.git` 指针文件、`gitdir` 反向链接、`commondir` 与 `locked` 内容——工作树的身份被定义为「目录 + 一个裸提交 + 一把锁」，不是「目录 + 一个分支」。
- `src/console-host/control-plane.ts:822` 的 Review 差异基准取 `record.applyBaseOid ?? record.baseOid`，`src/console-host/control-plane.ts:659-660` 的注释直接写明切换 Local 根目录会「re-bases every future apply-to-local」，并在 `src/console-host/control-plane.ts:661-668` 拒绝在交付进行中切换本地分支。写回的基准落在 Local 身上，工作树无分支可被误认为目标。

## Key Components

### src/adapters/worktree-creation.ts

这个文件是决策的执行体：它必须自己完成「detached 检出」的全部工作，因为一旦放弃 `worktree add` 内置的分支检出，检出正确性与可回滚性就得自己证明。

- **`samePath` / `sameIdentity`**（`src/adapters/worktree-creation.ts:12-14`）：路径比较在 win32 上折叠大小写，身份比较用 `JSON.stringify` 结构等值。它们是全部「同一性」判断的基石——决策依赖于「这个目录对象还是我创建的那个」，而不是「这个路径上现在是某个目录」。
- **`createWorktree(localRoot, target, baseOid, run, saveEvidence?)`**（`src/adapters/worktree-creation.ts:17-124`）：唯一入口，接收的是 `baseOid` 而不是分支名，这是决策在类型层面的固化——适配器层根本没有「分支」这个概念可用。
- **`checked`**（`src/adapters/worktree-creation.ts:24-28`）：统一包装 `run`，非零退出即记入 `failure` 并抛出，把「失败现场」留给外层判定是否可清理。
- **注册阶段**（`src/adapters/worktree-creation.ts:30-51`）：解析 `git-common-dir` 与父目录的 realpath，校验两者未被替换（`src/adapters/worktree-creation.ts:30-35`），快照已有 `worktrees` 注册目录清单（`src/adapters/worktree-creation.ts:36-37`），用排他 `mkdir(target)` 抢占目录（`src/adapters/worktree-creation.ts:38-39`），采集 `rootIdentity/parentIdentity/commonIdentity` 与随机 `lockReason` 后立刻落盘证据（`src/adapters/worktree-creation.ts:40-43`），然后才执行 `worktree add --detach ...`（`src/adapters/worktree-creation.ts:44`）。`src/adapters/worktree-creation.ts:16` 的注释就是这个顺序的理由：注册是廉价的，昂贵的检出必须等所有权证明持久化之后才跑。
- **检出阶段**（`src/adapters/worktree-creation.ts:52-69`）：`src/adapters/worktree-creation.ts:52-53` 的注释说明了两条不变量——`read-tree` 在任何工作区文件写入前先发布完整索引，`checkout-index` 不加 `-f` 因而永不覆盖别的写入者提供的文件。稀疏检出走 `reset --hard --no-recurse-submodules` 以对齐原生 `worktree add` 的语义（`src/adapters/worktree-creation.ts:58-61`），非稀疏走 `read-tree` + 记录 `indexFingerprint` + `checkout-index --all`（`src/adapters/worktree-creation.ts:63-66`）。检出后再校验一次身份（`src/adapters/worktree-creation.ts:68`），最后 `worktree unlock`（`src/adapters/worktree-creation.ts:69`）。
- **回滚**（`src/adapters/worktree-creation.ts:70-122`）：未 `claimed` 直接抛可忽略失败（`src/adapters/worktree-creation.ts:72`）；未注册时只在「静默退出 + 未出现在 `worktree list` + 元数据无新增 + 四处目录身份一致 + 目标目录为空」同时成立才 `rmdir`（`src/adapters/worktree-creation.ts:73-87`）；已注册时就地隔离为 `<target>.failed-<uuid>` 再强制移除，两轮身份与内容校验（`src/adapters/worktree-creation.ts:94-116`）；回滚自身失败则抛不可忽略失败并保留现场（`src/adapters/worktree-creation.ts:117-122`）。`src/adapters/worktree-creation.ts:92-93` 的注释明确：注册超时、进程树观察丢失、持久身份缺失，都不构成删除授权。
- **`verifyIdentity(e, baseOid)`**（`src/adapters/worktree-creation.ts:126-148`）：四目录身份比对，`worktrees/` 下子目录名必须是一段无分隔符的相对路径（`src/adapters/worktree-creation.ts:133-134`），`.git` 指针与反向 `gitdir`、`commondir`、`HEAD === baseOid`、`locked === lockReason` 全部严格校验（`src/adapters/worktree-creation.ts:140-145`），且发现任何 `.lock` 文件即判失败（`src/adapters/worktree-creation.ts:146-147`）。
- **`verifyRollbackMetadata`**（`src/adapters/worktree-creation.ts:150-160`）：元数据指纹与索引字节指纹必须与创建时一致，`ORIG_HEAD` 若存在必须等于 `baseOid`。
- **`metadataFingerprint(gitDir)`**（`src/adapters/worktree-creation.ts:162-183`）：递归哈希 `.git` 目录，顶层跳过 Git 会改写的 `index`/`gitdir`/`ORIG_HEAD`（`src/adapters/worktree-creation.ts:166-168`），其余按白名单匹配（`src/adapters/worktree-creation.ts:172`），遇到白名单之外的对象直接抛错。
- **`verifyUnmodified(root, baseOid, run)`**（`src/adapters/worktree-creation.ts:185-259`）：删除授权的内容证明。拒绝含子模块条目（`src/adapters/worktree-creation.ts:193`），拒绝任何被 `filter`/`working-tree-encoding` 转换过的路径——注释指出语义比较无法授权删除（`src/adapters/worktree-creation.ts:194-220`），逐目录/逐文件比对「索引里声明的路径集合」与实际文件系统（`src/adapters/worktree-creation.ts:203-213`），逐条目重算 blob 哈希（含符号链接与流式普通文件，`src/adapters/worktree-creation.ts:221-241`），再用 `diff-index`、`ls-files -v`、`ls-files --others`、`diff --name-status` 兜底（`src/adapters/worktree-creation.ts:242-249`）。

### src/console-host/control-plane.ts

控制面是决策的「不发分支」的那一半：请求层的 `branch` 被原样透传给模块，本层不解释它，也不把工作树绑定到它。

- **`createWorktreeConsoleControlPlane(options)`**（`src/console-host/control-plane.ts:193-1327`）：工厂函数，注入 `module`/`lookup`/`files`/`registry`/`git`/`reviewDiff`，`createTargetSessionId` 默认为 `randomUUID`（`src/console-host/control-plane.ts:194`）。
- **`create(sourceSessionId, branch?)`**（`src/console-host/control-plane.ts:78` 声明，`src/console-host/control-plane.ts:798` 实现）：`branch` 是可选的，且只作为 `createIsolatedTarget` 的入参往下传。
- **`withCreation(sessionId, action)`**（`src/console-host/control-plane.ts:511-528`）：按 `session:<id>` 与 `root:<canonical>` 双键串行化创建，避免同一仓库并发创建（`src/console-host/control-plane.ts:512-522`），`finally` 中双键释放（`src/console-host/control-plane.ts:524-527`）。`creating` 集合与确认令牌表在 `src/console-host/control-plane.ts:483-484`。
- **`createTarget(sourceSessionId, branch?)`**（`src/console-host/control-plane.ts:529-551`）：`branch === undefined ? undefined : { branch }`（`src/console-host/control-plane.ts:531`）——这是 `branch` 在控制面里唯一的用法，随即调用 `module.createIsolatedTarget`。返回前校验 `sourceSessionId`、`ownerSessionId` 与 `managedRoot` 三元一致（`src/console-host/control-plane.ts:534-538`）。
- **`preflightCreate(sourceSessionId)`**（`src/console-host/control-plane.ts:765-781`）：返回 `kind: 'ready'` 时附带 `listLocalBranches` 的结果（`src/console-host/control-plane.ts:769-770`），即 UI 上的分支选择器；空仓库走确认令牌路径（`src/console-host/control-plane.ts:776-780`），令牌 5 分钟过期、上限 500（`src/console-host/control-plane.ts:777`、`src/console-host/control-plane.ts:779`）。
- **`createWithInitialCommit`**（`src/console-host/control-plane.ts:782-797`）：空仓库初始化成功后调用 `createTarget(sourceSessionId)`（`src/console-host/control-plane.ts:795`）——**不传 `branch`**，因为初始提交刚刚产生，没有可选分支。
- **`reviewDiff`**（`src/console-host/control-plane.ts:807-845`）：差异基准取 `record.applyBaseOid ?? record.baseOid`（`src/console-host/control-plane.ts:822`），并在读取前后各做一次 preflight 与记录比对（`src/console-host/control-plane.ts:814-839`）。
- **`gitSwitchBranch`**（`src/console-host/control-plane.ts:657-672`）：交付进行中（`recovery_required`，或 `ready` 且处于 `ready_for_review`/`preview_active`/`preview_detached`）直接拒绝切换本地分支（`src/console-host/control-plane.ts:661-668`），理由是注释所说的「re-bases every future apply-to-local」（`src/console-host/control-plane.ts:659-660`）。
- **`gitOverview`**（`src/console-host/control-plane.ts:628-641`）：分支面按会话所属**项目 Local 根**投影（`snapshot.branch` 与 `branchOverview`），不跟随工作树，见 `projectRootFor`（`src/console-host/control-plane.ts:495-510`）的注释意图。
- **`sidebarTopology`**（`src/console-host/control-plane.ts:554-618`）：任务的 `sourceBranch` 由 `sourceBranchFromRef(record.sessionBranch ?? record.sourceRef)` 得出（`src/console-host/control-plane.ts:596`）——分支名是记录上的元数据，不是工作树 HEAD 的属性。
- **`beginNextIteration`**（`src/console-host/control-plane.ts:1281-1325`）：新一迭代要求前驱为 `phase === 'discarded'` 且 `delivery.state === 'delivered'`（`src/console-host/control-plane.ts:1289-1291`），并接受「独立的隔离会话在 managedRoot」与「就地会话已回到 Local」两种归属根（`src/console-host/control-plane.ts:1294-1303`）——迭代不携带分支意图，只携带 lineage。

## Architecture

```text
┌────────────────────────────────────────────────────────────────────┐
│ UI / Client    create(sessionId, branch?)                          │
└──────────────────────────────┬─────────────────────────────────────┘
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│ control-plane.ts:193   L511 withCreation ─► L529 createTarget      │
│ branch 只在 L531 编成 { branch } 透传，本层不解析也不保存          │
└──────────────────────────────┬─────────────────────────────────────┘
                               ▼  模块把 branch 解析为 baseOid
┌────────────────────────────────────────────────────────────────────┐
│ worktree-creation.ts:17  createWorktree(localRoot, target, baseOid)│
│ L30-43   身份采集 + 排他建目录 + 落盘证据                          │
│ L44      worktree add --detach --no-checkout --lock <baseOid>      │
│ L52-69   read-tree + checkout-index（或稀疏时 reset --hard）        │
│ L126-148 verifyIdentity：HEAD === baseOid，工作树无分支可言        │
└──────────────────────────────┬─────────────────────────────────────┘
                               ▼  交付基准回到 Local 侧
┌────────────────────────────────────────────────────────────────────┐
│ control-plane.ts:822 差异基准 = applyBaseOid ?? baseOid            │
│ control-plane.ts:657 交付期内拒绝切本地分支（apply 会被 re-base）  │
└────────────────────────────────────────────────────────────────────┘
```

## Data Flow

1. **发起**：`create(sourceSessionId, branch)`（`src/console-host/control-plane.ts:798`）进入 `withCreation` 的双键锁，同会话或同仓库根已有创建在跑则报 `initialRepositoryBusy`（`src/console-host/control-plane.ts:512-522`）。
2. **分支只作为选项来源**：`preflightCreate` 已把本地分支列表交给 UI（`src/console-host/control-plane.ts:769-770`）；用户选中的名字随请求进来，编成 `{ branch }` 交给模块（`src/console-host/control-plane.ts:531`）。控制面自己不解析、不校验、不保存这个分支。
3. **模块解析为 baseOid**：`branch` 在模块侧被解析成一个提交对象 `baseOid`；此后适配器的入参里再无分支（`src/adapters/worktree-creation.ts:17`）。
4. **注册（廉价）**：采集目录身份 → 排他 `mkdir` → 落盘证据（`src/adapters/worktree-creation.ts:30-43`）→ `worktree add --detach --no-checkout --lock`（`src/adapters/worktree-creation.ts:44`）。此刻工作树存在、被锁、且 `.git/HEAD` 是裸提交。
5. **检出（昂贵）**：拆锁前先按 `core.sparseCheckout` 分流（`src/adapters/worktree-creation.ts:54-61`）或走 `read-tree` + `checkout-index --all`（`src/adapters/worktree-creation.ts:63-66`），完成后 `verifyIdentity`（`src/adapters/worktree-creation.ts:68`）并 `worktree unlock`（`src/adapters/worktree-creation.ts:69`）。
6. **开发期**：工作树没有当前分支，`gitSwitchBranch` 只作用于 Local 根（`src/console-host/control-plane.ts:657-672`），分支面的展示也来自项目根（`src/console-host/control-plane.ts:628-641`）。
7. **交付期**：Review 差异以 `applyBaseOid ?? baseOid` 为基准（`src/console-host/control-plane.ts:822`）；因为写回 Local 的路径由 Local 当前分支决定，交付窗口内切换本地分支被拒绝（`src/console-host/control-plane.ts:661-668`），交付完成后才允许下一轮（`src/console-host/control-plane.ts:1289-1303`）。

## Connections

- [[session-management]]：一个隔离工作树绑定一个目标会话，`createTarget` 用 `createTargetSessionId()` 生成（`src/console-host/control-plane.ts:194`、`src/console-host/control-plane.ts:530`），并在返回前校验会话归属与 `managedRoot` 一致（`src/console-host/control-plane.ts:534-538`）。
- [[git-operations]]：`run` 端口承载全部 git 调用，`quiescent` 标记是判定「失败现场是否可清理」的唯一依据（`src/adapters/worktree-creation.ts:9-10`、`src/adapters/worktree-creation.ts:73`、`src/adapters/worktree-creation.ts:94`）。
- [[file-system-port]]：目录身份采集与内容比对都走 `files` 端口（`src/adapters/worktree-creation.ts:11`、`src/adapters/worktree-creation.ts:33-40`），使身份语义不依赖具体平台。
- [[creation-failure]]：`WorktreeCreationFailure` 的布尔位区分「可忽略/可重试」与「必须保留现场」，回滚的三条出口都由它收尾（`src/adapters/worktree-creation.ts:72`、`src/adapters/worktree-creation.ts:86`、`src/adapters/worktree-creation.ts:116-122`）。

## Known Issues

- **回滚授权过窄，失败常需人工收尾。** 未注册清理与已注册回滚都要求 `failure?.quiescent === true`（`src/adapters/worktree-creation.ts:73`、`src/adapters/worktree-creation.ts:94`）。注册超时、进程树观察丢失、或身份缺失时一律保留现场并抛不可忽略失败（`src/adapters/worktree-creation.ts:92-93`、`src/adapters/worktree-creation.ts:122`），残余目录需手工处理。
- **带转换属性的仓库无法自动清理。** 只要索引中存在启用 `filter` 或 `working-tree-encoding` 的路径，`verifyUnmodified` 就以「语义比较不能授权删除」为由拒绝（`src/adapters/worktree-creation.ts:194-220`）；启用子模块的检出同样一律保留（`src/adapters/worktree-creation.ts:193`）。
- **稀疏检出回滚不自洽。** 稀疏分支走 `reset --hard`（`src/adapters/worktree-creation.ts:58-61`），注释已承认失败的 reset 可能留下 index lock 因而不能自动移除；而 `verifyIdentity` 见到任何 `.lock` 即判失败（`src/adapters/worktree-creation.ts:146-147`），于是这类残留只能保留。
- **元数据白名单与 Git 版本耦合。** `metadataFingerprint` 只接受固定的文件集合（`src/adapters/worktree-creation.ts:172`），Git 若在 worktree 元数据目录新增文件，校验会以 `Unknown creation metadata` 失败（`src/adapters/worktree-creation.ts:173`），表现为创建后回滚受阻。
- **`branch` 的可选性把「从哪起」交给调用方。** `create` 允许不传分支（`src/console-host/control-plane.ts:78`、`src/console-host/control-plane.ts:798`），空仓库路径也不传（`src/console-host/control-plane.ts:795`）；`baseOid` 的具体解析规则不在控制面，本层无法在创建前拒绝一个语义上不可用的分支名。
- **交付期禁切分支是硬门禁。** 交付进行中切换本地分支被直接拒绝（`src/console-host/control-plane.ts:661-668`），用户只能等交付结束；这是「交付目标由 Local 决定」这一决策的必然副作用。
