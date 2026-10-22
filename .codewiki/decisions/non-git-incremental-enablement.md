---
title: "非 Git 目录渐进增强：显式确认下的 init + 首次提交，而非静默或死路"
type: decision
source_files:
  - src/adapters/initial-commit.ts
tags:
  - design
  - non-git
  - onboarding
---

## Overview

本决策解决一个必然出现的场景：用户把一个**尚未纳入 Git 版本控制的目录**（完全裸目录，或 `git init` 过但还一次都没提交过的「未出生」仓库）交给 worktree 插件。插件的全部价值建立在「从某次提交切出隔离 worktree」之上，而零提交的仓库切不出任何东西——如果没有额外设计，这类目录对插件是**死路**。

决策的核心不是「要不要支持」，而是**以什么代价、在谁授权的前提下**把目录从「不可用」推到「可用」。最终选择是**渐进增强 + 显式确认**：插件不替用户做决定，但把每条死路改造成一条「用户点一下就能走通、且事后可解释」的路径，并按仓库当前状态分成三条互不混淆的通路。

### 被否决的候选方案

| 候选 | 做法 | 为什么否决 |
| --- | --- | --- |
| A. 静默 autocreate | 检测到非 Git 目录即自动 `git init` + `git add -A` + `git commit`，用户零感知 | 在用户目录里凭空造出 `.git` 并把**全部**文件（含未被 `.gitignore` 覆盖的密钥、构建产物）写成一条提交，是不可撤销的副作用。插件不得单方面改变用户工作区的版本控制状态 |
| B. 直接拒绝 + 让用户自己去终端 | 抛 `not_git_repository`，README 里写「请先 `git init`」 | 零风险但体验断裂：用户在插件里被踢出流程，需要离开应用、记住并执行命令、再回来。而且用户手工执行 `git init` 后仍是零提交，**死路照旧**——`git init` 本身不产生提交 |
| C. 显式确认 + 分状处理（**采纳**） | 预检判定仓库状态，按 `ready` / `files` / `empty` 分流；需要写入用户文件时先发确认令牌，用户确认后才执行 | 代价是代码量与状态机复杂度（`confirmations` Map、令牌过期、指纹 CAS），收益是「危险操作被收窄到用户明确点过的那一次」 |

### 三条通路的分工

分流发生在 `src/adapters/initial-commit.ts:29-47` 的 `preflightInitialCommit`，它返回三种 `kind`：

- **`ready`**（`src/adapters/initial-commit.ts:32`）：`snapshot.headOid !== 'unborn'`，已有提交，什么都不用做，走常规 `create`。
- **`files`**（`src/adapters/initial-commit.ts:38`）：未出生且根目录里有条目（或索引非空）。**注意此分支的 `fingerprint` 是空字符串**——有文件时无法界定「哪些文件算用户的既有内容」，因此不做指纹。
- **`empty`**（`src/adapters/initial-commit.ts:41-48`）：未出生且目录为空（除 `.git`）。此时才计算 SHA-256 指纹，把 `snapshot`、根目录/规范根/`gitDir`/`commonDir` 的 stat 身份、`HEAD` 字节、`HEAD` 的 stat 身份、`.git/index` 的 base64 内容、排序后的文件列表全部纳入。

这两类「未出生」被**故意分成两条不同的 RPC**，是本决策最实质的取舍：

- 空仓库 → `createWithInitialCommit`（需调用 `initializeEmptyRepository`）：不需要 `git add -A`，用一个 `mktree` 空树 + `commit-tree` 直接造出提交，**一个用户文件都不碰**，因此可以用指纹 CAS 把并发与偷跑挡死。
- 有文件 → `initProject`：必须执行 `git add -A`，这是对用户全部文件的写入，因此**不做指纹 CAS**，安全性完全由「用户看过预检结论并显式点击」承担（`src/adapters/initial-commit.ts:101-103` 的注释明确写下了这个交换：提交失败原样报错，不回滚任何字节）。

### 为什么 `initializeEmptyRepository` 反而是最重的那个

`src/adapters/initial-commit.ts:48-100` 是全文件防护最密的一段，因为它的语义是「**凭空创造一个提交**」，一旦误判就会污染用户仓库历史。它叠了四层：

1. 进入前后各做一次完整预检并要求 `kind === 'empty'` 且指纹一致（`src/adapters/initial-commit.ts:49-50`、`59-60`、`69-70`）；
2. `index.lock` 以 `wx` 独占创建（`src/adapters/initial-commit.ts:55-58`），既排除协作的索引写入者也排除另一个初始化者；`EEXIST` 被翻译成 `operation_not_allowed` / `initialRepositoryBusy`（`src/adapters/initial-commit.ts:87-89`）；只删自己建的锁（`91-98`）；
3. `update-ref --stdin` 的两阶段事务（`src/adapters/initial-commit.ts:74-84`）：`prepare` 阶段让 Git 锁住 `HEAD` 与解析出的分支，`beforeCommit` 回调里**再加一次**预检（`80-81`）并**再调一次** `assertAuthorized`（`82`），两者都过才允许 `commit`。这就是「比较并交换」：`'0'.repeat(oid.length)` 作为旧值，未出生分支才匹配，绝不覆盖竞态中诞生的提交（`71-73` 注释）。

对应的取舍是：这几层防护只在 `empty` 路径支付，`files` 路径一分不付——因为指纹能约束的前提是「文件集合为空」，一旦有文件，指纹既算不准也拦不住用户自己在别处改文件。

### 确认令牌的绑定关系

确认令牌一次写入五项：`token`、`root`、`projectId`、`fingerprint`、`expires`（`Date.now() + 300_000`，即 5 分钟）。校验在控制平面进行，任何一项不匹配都退回 `stale_local` / `initialStateChanged`：

- `token` 不匹配 → 令牌被别的预检覆盖；
- `expires` 已过 → 用户看的是 5 分钟前的旧结论；
- `root` / `projectId` 不匹配 → 会话已漂移到另一个项目；
- `fingerprint` 由适配器在真正加锁后再比对（`src/adapters/initial-commit.ts:50`、`60`、`70`、`81`）。

绑定 `root` 与 `projectId` 而不只绑 session，是因为一个会话的项目归属在执行期间可能变化（控制平面的 `assertAuthorized` 回调又复核了一遍）。

## Key Components

### src/adapters/initial-commit.ts

工厂函数 `initialCommitActions(inspect, run)`（`src/adapters/initial-commit.ts:13-118`）把「读仓库状态」和「执行 git」两个能力作为参数注入，自身不直接触碰进程与 fs 之外的东西。

- **`GitCommitProtocol`**（`src/adapters/initial-commit.ts:8`）：`{ prepare: string; beforeCommit(): Promise<void> }`。`prepare` 是直接喂给 `git update-ref --stdin` 的脚本文本，`beforeCommit` 是 Git 已持锁、尚未发布前的回调窗口。这个接口存在的唯一理由就是让调用方能在持锁状态下插入复检。
- **`Run`**（`src/adapters/initial-commit.ts:10`）：`(root, args, input?) => Promise<{ code, stdout, stderr }>`。`input` 可为字符串或 `GitCommitProtocol`——后者是 `update-ref --stdin` 专用的两阶段形态。
- **`stale()`**（`src/adapters/initial-commit.ts:14`）：统一的 `SessionCheckoutError('stale_local', hostMessage('initialStateChanged'))` 工厂，全文所有「世界变了」都收敛到这一个码。
- **`checked(root, args, input?)`**（`src/adapters/initial-commit.ts:15-19`）：执行并以 `code !== 0` 抛 `git_operation_failed` / `initialCommitFailed`，成功返回 `stdout`。
- **`identity(path, trackChanges = false)`**（`src/adapters/initial-commit.ts:20-24`）：以 `dev:ino:birthtimeNs`（`trackChanges` 为真时追加 `:mtimeNs:ctimeNs`）构成 stat 身份；**符号链接一律直接 `stale()`**（`src/adapters/initial-commit.ts:22`），不做解析后比对。这是刻意保守：根目录若被替换成 symlink，指纹体系整体失效，宁可拒绝。
- **`indexBytes(gitDir)`**（`src/adapters/initial-commit.ts:25-28`）：把 `.git/index` 读成 base64，`ENOENT` 归一化为空串（未出生仓库本就没有索引），其它错误继续抛。
- **`preflightInitialCommit(root)`**（`src/adapters/initial-commit.ts:29-47`）：三态判定器。`snapshot === null` 抛 `not_git_repository`（`31`）；`headOid !== 'unborn'` 返回 `ready` 且指纹为空（`32`）；枚举 `readdir(snapshot.root)` 并过滤掉 `.git`（`33-36`），`files.length || index` 即返回 `files`（`37-38`）；否则算指纹返回 `empty`（`39-46`）。**枚举时刻意不套用任何忽略规则**（`34-35` 注释）：被 `.gitignore` 忽略的文件、符号链接、嵌套仓库、空目录都需要用户显式决定，不能让适配器替用户预判。
- **`initializeEmptyRepository(root, fingerprint, assertAuthorized?)`**（`src/adapters/initial-commit.ts:48-100`）：见上文四层防护。补充三点：身份检查对 `GIT_AUTHOR_IDENT` 与 `GIT_COMMITTER_IDENT` **两者**都跑，且带 `-c user.useConfigOnly=true`（`62-65`），因此环境变量注入的身份不算数，必须有本地/全局配置；`mktree` 用空 stdin 造空树，**不触碰索引**（`66-67` 注释）；提交消息固定为 `Initial commit`（`68`）。
- **`initializeProject(root)`**（`src/adapters/initial-commit.ts:104-117`）：面向「有文件的未出生仓库」。`inspect` 后若已有提交抛 `operation_not_allowed` / `projectAlreadyVersioned`（`106-108`）；`snapshot === null` 才 `git init -b main`（`110-111`，`-b` 直接命名初始分支、不写 config，要求 Git ≥ 2.28）；只检查 `GIT_AUTHOR_IDENT`（`113-114`）；`add -A`（`115`）与 `commit -m 'Initial commit'`（`116`）。**不做指纹比对、不做锁、不回滚**——`101-103` 的注释把这条边界写死：`add -A` 遵循 `.gitignore`，全部被忽略或身份未配置时原样报错，已写入的 `.git` 保留。
- **返回值**（`src/adapters/initial-commit.ts:118`）：`{ preflightInitialCommit, initializeEmptyRepository, initializeProject }`。

### src/console-host/control-plane.ts

- **`WorktreeConsoleControlPlaneOptions`**：包含 `module`、`lookup`、`files`、`registry`、`git`、`reviewDiff`、可选 `createTargetSessionId`。
- **`WorktreeConsoleControlPlane`**：控制平面接口。与本决策直接相关的三条签名——`preflightCreate(sourceSessionId)`、`createWithInitialCommit(sourceSessionId, confirmationToken)`、`initProject(sourceSessionId)`。
- **`confirmations`**：`Map<string, { token; root; projectId; fingerprint; expires }>`，**以 `sourceSessionId` 为键**，即「每个会话最多一个待确认的空仓库初始化」。
- **`creating`**：`Set<string>`，与 `confirmations` 相邻声明，两个互斥键（`session:` / `root:`）共用它。
- **`localProject(sessionId)`**：要求目标 checkout 为 `local`、项目存在、且 `project.id` 与会话目标一致、根目录仍在磁盘上，任一不满足抛 `operation_not_allowed` / `initialStateChanged`。这是所有写路径的入口闸门。
- **`projectRootFor(sessionId)`**：分支 chip 的 Git 面板用，要求 `options.git.inspect(project.root)` 非 `null`，否则抛 `not_git_repository`。**它与 `initProject` 形成有意的不对称**：git 面板是只读观察面，非 Git 目录在那里就是不可用；而创建流程有 `initProject` 这条写路径可以把它变成可用。
- **`withCreation(sessionId, action)`**：两把锁。先占 `session:${sessionId}`，再 `localProject` + `canonicalize`，用 `root:${canonical}` 占第二把，Windows 上 `canonical.toLowerCase()`。冲突一律 `operation_not_allowed` / `initialRepositoryBusy`。`finally` 双删。**必须先解析项目再加根锁**，否则拿不到 canonical 路径——这也是它没法在 `localProject` 之前做根级判重的原因。
- **`createTarget(sourceSessionId, branch?)`**：调 `module.createIsolatedTarget`，随后对 registry 记录做三项身份核对，不一致抛 `checkout_mismatch`。
- **`preflightCreate`**：`preflightInitialCommit?.()` 可选调用；**`!check` 与 `kind === 'ready'` 合并处理**，即适配器未实现预检时按「已就绪」返回并附带 `listLocalBranches?.()`；`files` 分支删掉本会话旧令牌后返回 `{ kind: 'files' }`；`empty` 分支先惰性清理过期项、超 500 条时 FIFO 驱逐、再发新令牌。
- **`createWithInitialCommit`**：`withCreation` 内先取值**并立即删除**令牌，再逐项校验（含 `!options.git.initializeEmptyRepository` 的存在性检查），然后以 `assertAuthorized` 回调复核会话归属，最后 `createTarget`；`createTarget` 的任何异常被改写成 `git_operation_failed` / `initialCreatedWorktreeFailed`。
- **`create`**：纯常规路径，`withCreation` 包 `createTarget`。
- **`initProject`**：`withCreation` 内检查 `options.git.initializeProject` 存在性（不存在抛 `operation_not_allowed` / `initializationUnsupported`），调用 `initializeProject(project.root)`，返回 `true`。**不消费确认令牌**。

## Architecture

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Console / UI：预检结果 → 用户显式点击 → 再发起写 RPC                  │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ RPC（读 / 写 严格分离）
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│ control-plane.ts :: createWorktreeConsoleControlPlane                │
│                                                                      │
│  preflightCreate ──发令牌──► confirmations Map                       │
│  createWithInitialCommit ──验令牌──┘                                 │
│  initProject ──────────（不看令牌，只靠 UI 确认）                     │
│                                                                      │
│  withCreation：互斥键 session:<id> + root:<canonical>                │
└──────────────┬────────────────────────────────┬──────────────────────┘
        empty  │                                │ files
               ▼                                ▼
┌──────────────────────────────┐  ┌──────────────────────────────────┐
│ initializeEmptyRepository    │  │ initializeProject                │
│                              │  │ init -b main → add -A → commit   │
│ 锁 index.lock + 三次指纹 CAS │  │ 无指纹 / 无锁 / 不回滚           │
│ mktree + commit-tree         │  │ 已有提交则拒绝                   │
│ update-ref --stdin 两阶段    │  │                                  │
└──────────────────────────────┘  └──────────────────────────────────┘
               │                                │
               └──────────► 提交诞生 → createTarget → worktree
```

框里的行号只对应 `src/adapters/initial-commit.ts` 与 `src/console-host/control-plane.ts`；跨文件调用靠注入的 `inspect` / `run` / `options.git`，适配层自身不持有仓库状态。

## Data Flow

### 通路一：空仓库 → 原子空提交后直接建 worktree

1. UI 调 `preflightCreate`；`preflightInitialCommit` 返回 `kind: 'empty'` 与指纹。
2. 控制平面清理过期令牌、容量超限则 FIFO 驱逐，写入 `{ token, root, projectId, fingerprint, expires: now + 300_000 }`，返回 `{ kind: 'empty', confirmationToken }`。
3. 用户确认后调 `createWithInitialCommit(sessionId, token)`：进入 `withCreation` 双锁；取令牌并**立即 delete**；逐项校验 token / expires / root / projectId / 适配器能力。
4. 进入 `initializeEmptyRepository`：预检 → 建 `index.lock` → **再**预检 → `assertAuthorized` → 校验 AUTHOR/COMMITTER 身份 → `mktree` → `commit-tree` → **第三次**预检 → `update-ref --stdin` 的 `prepare`，在 `beforeCommit` 内做**第四次**预检并**第二次** `assertAuthorized`。
5. `finally` 关句柄、删锁，返回新 OID。
6. `createTarget` 建 worktree；失败统一为 `git_operation_failed` / `initialCreatedWorktreeFailed`。

### 通路二：有文件的未出生仓库 → `initProject` → 再常规创建

1. `preflightCreate` 调 `preflightInitialCommit`，根目录非空即得 `kind: 'files'`，此时**不产生令牌**，并顺手删掉本会话可能残留的旧令牌。
2. UI 展示「目录里有内容」的说明，用户确认后调 `initProject`。
3. `withCreation` 双锁 → 存在性检查 → `initializeProject(project.root)`。
4. 适配器：`inspect` 确认无提交（有则拒绝）→ 需要时 `git init -b main` → 校验 `GIT_AUTHOR_IDENT` → `git add -A` → `git commit -m 'Initial commit'`。
5. RPC 返回 `true`；UI 随后重新走一次 `preflightCreate`（此时已是 `ready`），再调 `create` 建 worktree。

### 通路三：已有提交 → 什么都不特殊

`preflightCreate` 返回 `ready` 并附 `listLocalBranches` → `create(sessionId, branch?)` → `createTarget`。适配层的两个初始化函数都不会被触及。

## Connections

- [[session-checkout]]：`SessionCheckoutModule` 提供 `createIsolatedTarget` 与 `preflight`，被 `control-plane.ts` 注入式使用。
- [[ports]]：`GitCheckoutSnapshot`、`InitialCommitPreflight`、`SessionCheckoutGitPort` 定义在这里；`preflightInitialCommit` / `initializeEmptyRepository` / `initializeProject` 在端口上是**可选成员**，这正是控制平面三处存在性检查的由来。
- [[i18n-host]]：`hostMessage` 提供 `initialStateChanged`、`initialCommitFailed`、`initialIdentityMissing`、`initialRepositoryBusy`、`initializationUnsupported`、`projectAlreadyVersioned`、`initialCreatedWorktreeFailed` 等文案键。
- [[console-host-errors]]：`consoleFailure` / `domainError` / `failure` / `outcome` 把异常收敛为 `WorktreeConsoleOutcome`，是 `stale_local`、`operation_not_allowed`、`git_operation_failed` 三条错误通道的出口。
- [[console-contract]]：三条 RPC 的请求/响应形状（`WorktreeConsoleCreatePreflightResponse` 的 `kind` 联合即本决策的状态机外化）。
- [[git-adapters]]：`initialCommitActions` 的 `inspect` 与 `run` 由 Git 适配器注入，`git init` / `mktree` / `commit-tree` / `update-ref --stdin` 的可用性取决于宿主的 Git 版本（前缀要求见 `src/adapters/initial-commit.ts:13` 注释）。

## Known Issues

- **令牌一读即删，失败不可重试**：控制平面先 `get` 再 `delete`，随后任何校验失败或下游异常都不会把令牌放回。用户必须重新 `preflightCreate` 才能再试一次。这是刻意的「一次性令牌」语义，但对瞬时错误（如身份尚未配置）不够友好。
- **`initProject` 不复核世界状态**：没有指纹、没有 `stale_local` 复检，只由 `initializeProject` 内部的「已有提交则拒绝」兜底。若用户在「确认前」与「执行时」之间新增了敏感文件，那些文件仍会被 `git add -A` 一并提交。指纹在这里帮不上忙，因为 `files` 分支的指纹本就是空串。
- **`initializeProject` 失败不回滚**：`git init` 成功但 `commit` 失败（全部文件被 `.gitignore` 排除、身份未配置）时，`.git` 会留在用户目录里，仓库从「裸目录」变成「零提交的 Git 仓库」。这是 `src/adapters/initial-commit.ts:104-106` 注释明示的取舍（「不回滚任何字节」），用户再次操作会走 `files` 分支而不是 `empty` 分支。
- **`initializeEmptyRepository` 要求身份为配置值**：`-c user.useConfigOnly=true` 意味着仅靠 `GIT_AUTHOR_NAME` 等环境变量不会通过校验，CI 或临时 shell 里会落到 `initialIdentityMissing`。
- **根目录为符号链接时 `empty` 路径直接不可用**：`identity()` 遇 symlink 即 `stale()`，而项目根、规范根、`gitDir`、`commonDir` 全部要过 `identity()`。macOS 的 `/var` → `/private/var` 一类规范根差异会走到这里，表现为无法定位原因的 `stale_local`。
- **`confirmations` 只有惰性清理**：过期项仅在 `preflightCreate` 被调用时清，容量上限 500 条并按 Map 插入顺序 FIFO 驱逐。若某会话刚拿到令牌而其它会话连续预检 500 次，**尚未使用的令牌可能被挤掉**，表现为莫名其妙的 `stale_local`。此外键只有 `sourceSessionId`，同一会话对两个不同项目预检会互相覆盖。
- **`preflightCreate` 把「无预检能力」当成「已就绪」**：`!check` 与 `kind === 'ready'` 共用一条返回路径。适配器未实现 `preflightInitialCommit` 时，UI 会看到 `kind: 'ready'`，随后 `create` 才可能失败，错误码与真实原因（非 Git 目录）不一致。
- **`createTarget` 的错误被抹平**：成功初始化后的任何建 worktree 异常统一改写为 `git_operation_failed` / `initialCreatedWorktreeFailed`，原始错误码丢失。副作用是：提交已经落地（仓库已可用），但用户看到的是一次失败——重试会走 `ready` 分支，语义上能自愈，但日志里查不到首因。
- **互斥只在进程内**：`creating` 是普通 `Set`，只在单进程内有效；跨进程的并发保护实际由适配层的 `index.lock` 与 `update-ref` 事务承担，其余路径（`initProject`）在跨进程场景下没有等价兜底。
- **Win32 路径大小写归一依赖 `canonical.toLowerCase()`**，是非 Windows 平台上唯一的分支差异，也是互斥键唯一按平台改写的地方；若 `canonicalize` 返回的形态与 `localProject` 拿到的 `project.root` 不一致，两把锁会锁到不同的键。