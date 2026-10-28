---
title: adapters
type: module
source_files:
  - src/ports.ts
  - src/adapters/files.ts
  - src/adapters/git.ts
  - src/adapters/registry.ts
  - src/adapters/lookup.ts
  - src/adapters/working-directory.ts
  - src/adapters/safe-file.ts
  - src/adapters/git-options.ts
  - src/adapters/initial-commit.ts
  - src/adapters/worktree-creation.ts
  - src/adapters/project-skills.ts
  - src/adapters/project-skill-io.ts
  - src/adapters/project-skill-provider.ts
  - tests/working-directory-adapter.test.ts
  - tests/lookup.test.ts
tags: [adapters, ports, git, filesystem, registry, skills, working-directory]
---

## Overview

`src/adapters/` 是 session-checkout 领域的**底层适配器层**（port adapters）。领域状态机与 apply 引擎（`session-checkout-apply.ts`）只依赖 `src/ports.ts` 里声明的端口接口（`SessionCheckoutGitPort`、`SessionCheckoutFilesPort`、`SessionCheckoutRegistryPort`、`SessionCheckoutLookupPort` 以及宿主提供的 `SessionWorkingDirectoryPort`），而真正的副作用——跑 `git` 子进程、读写磁盘、读写注册表 JSON、查 Harness 工作区、把 Session 迁进/迁出受管 Worktree——全部落在这层。

设计上每个端口都有明确的安全边界：

- **Git 适配器**（`git.ts`）通过宿主 `ctx.subprocess` 跑 git，禁用 hook、关闭可选锁、C locale、清掉 GIT_* 环境变量（仅保留身份变量），内部产物统一放进 `refs/dsh-worktree/...` 命名空间，绝不污染用户引用。`worktree-creation.ts` 负责带「所有权证明」的 Worktree 创建（身份指纹 + 注册后再结账）。
- **文件系统适配器**（`files.ts`）只做目录身份（`device/inode/birthtimeNs`）、空目录回收、隔离区 CAS、符号链接守卫的递归删除与字节测算。
- **注册表适配器**（`registry.ts` + `safe-file.ts`）把 v2 注册表作为单个原子 JSON 文件持久化，每次读都做字段级校验；v1 记录保守迁移到 `recovery_required`；崩溃残留靠 `.tmp`/`.bak` 多层恢复。
- **查找适配器**（`lookup.ts`）把 Session/Project 映射到 Harness 的 `workspaceRegistry` 服务，并在已清理的不可变 cwd 上从 live header 恢复会话投影。
- **工作目录适配器**（`working-directory.ts`）把宿主 `workingDirectory` 服务包成 `enter`/`leave`，让 Session 真正进入/离开受管 Worktree；宿主未挂载该服务时退化为「只给引导、不动 Session」的无操作。
- **Project Skills 适配器**（`project-skills.ts` / `project-skill-io.ts` / `project-skill-provider.ts`）把 Local 仓库里的 `.dsh/.agents/.claude/skills` 作为受信任的、主机私有的溯源带到每个受管 Worktree，并提供只读的 Claude 项目 Skill provider 挂到宿主 `skills` 服务。

## Key Components

下面是 `src/adapters/` 下每个公开导出与其关键私有实现，按文件分组。行号取自 `read_code` 返回前缀（文件:行）。

### `src/adapters/files.ts` — Node fs 文件端口

| 符号 | 行号 | 用途 |
| --- | --- | --- |
| `measureDirectoryBytes(path)` | 16 | 递归测算真实磁盘占用，不跟随符号链接（链接返回 0）。 |
| `removeEmptyDirectoryTree(path)` | 26 | 仅当整棵树不含文件/符号链接时才递归删除，用于回收 `git worktree add` 的空残留。 |
| `inspectDirectoryIdentity(path)` | 37 | 读 `device/inode/birthtimeNs`（bigint）作为目录身份，用于隔离区 CAS。 |
| `directoryIdentitiesEqual(left, right)` | 48 | 比较三段身份字段是否全等。 |
| `quarantineDirectoryTree(path, expectedIdentity, quarantinePath)` | 52 | 原子 `rename` 进插件隔离区并复验身份；身份不符则尝试回滚，绝不删除身份不匹配的对象。 |
| `removeDirectoryTree(path)` | 74 | 删除完全拥有的非空目录树，根若是文件/符号链接则抛 `checkout_mismatch`。 |
| `createNodeFilesPort()` | 89 | 工厂，返回 `SessionCheckoutFilesPort`：把上述函数包进对象，外加 `exists`/`canonicalize`/`ensureDirectory`/`readTextFile`/`copyFile`/`isSymbolicLink`（后三者可选）。 |

### `src/adapters/git.ts` — ctx.subprocess 支撑的 Git 端口

常量与类型：

- `GIT_TERMINATION_GRACE_MS = 1_000`（38）、`GIT_COLLECT_BYTES = 1<<20`（40）、`WIP_PATCH_COLLECT_BYTES = 16<<20`（42，二进制 WIP 补丁可能超标）。
- `interface GitPortOptions extends GitTimeoutOptions`（44）：`hooksPath`（空 `core.hooksPath` 目标目录）、`projectSkills?: ProjectSkillStore`。
- `interface GitCommandResult`（50）：`code/stdout/stderr/quiescent?`。

关键私有函数：

- `parseDecoration(decoration)`（63）：`%D` 装饰 → 引用名，tag 保留 `tag:` 标记，裸 `HEAD` 不算引用。
- `settleCreationTree(handle)`（73）：创建场景下强制终止并等待整树静默（10s 上限）。
- `runGit(ctx, cwd, args, options, input?, creation?, collectBytes?)`（93）：核心执行器。argv 原样传入（绝不做 shell 解释），注入 `--no-pager --no-optional-locks`、`core.hooksPath`、C locale、清空 `GIT_*` 环境变量（仅保留身份变量）；`creation` 模式带超时并对退出后整树静默做二次确认。`input` 可为字符串或 `GitCommitProtocol`（用于 `update-ref --stdin` 的 prepare/beforeCommit 交互）。
- `runGitChecked(...)`（190）：非零退出抛 `git_operation_failed`。
- `checkoutRefRoot(checkoutId)`（201）：`sha256(checkoutId)` 前 24 位 → `refs/dsh-worktree/session-checkouts/<key>`。
- `assertArtifactName(artifactName)`（206）：仅允许 `[A-Za-z0-9._-]` 段。
- `internalArtifactRef` / `applyBaseRef` / `abandonedSnapshotRef`（216/221/230）：内部产物引用构造；放弃快照故意放在 `refs/dsh-worktree/abandoned/<checkoutId>`，独立于 per-checkout 命名空间。
- `hasGitMetadata(root)`（235）：从 `root` 向上找 `.git`。

主导出：

- `createDshGitPort(ctx, options)`（249）：构建 `SessionCheckoutGitPort`。除 `ports.ts` 声明的所有可选方法（`preflightInitialCommit`/`initializeEmptyRepository`/`initializeProject`/`attachWorktreeBranch`/`pushBranch`/`repairWorktreeLinks`/`pruneWorktrees`/`branchOverview`/`defaultBranch`/`branchTipTimes`/`branchCreationTimes`/`deleteLocalBranch`/`mergeLocalBranch`/`graphLog`/`createLocalBranch`/`switchLocalBranch`/`listTags`/`createTag`/`deleteLocalTag`/`pushTag`/`deleteRemoteTag`/`captureLocalWip`/`applyWorktreePatch`/`listUntrackedFiles`/`snapshotAbandonedWorktree`/`restoreAbandonedSnapshot` 等）外，还用 `Object.assign(port, initialCommitActions(...))`（772）把 initial-commit 动作挂到端口上。涉及 Project Skills 的 `createDetachedWorktree`（336）/`removeWorktree`（349）会经 `projectSkills` 校验与搬运。

### `src/adapters/registry.ts` — 耐久注册表端口

校验谓词（`isRecord` 26、`isStringArray` 30、`isOid` 34、`isBoundedText` 38、`isSafeRelativePath` 42、`isTargetRef` 48、`isSessionBinding` 55、`isReview` 67、`isPreviousReview` 87、`isCheckpoint` 97、`isPreviewReceipt` 116、`isDeliveryProof` 138、`isDelivery` 152、`isJournal` 193、`safeRecoveryString` 252、`safeRecoveryRevision` 256、`safeConflictFile` 260、`isRecoveryContinuation` 266、`isManagedCheckout` 292、`isRegistry` 327）逐字段把关 v2 结构，含长度上限、相对路径安全、冲突文件数 ≤500 等。

- `emptyRegistry()`（17）：返回空 v2 注册表。
- `migrateLegacyRegistry(value)`（339）：v1 记录保守迁移到 `recovery_required`（除 `ready`/`discarded` 相位保留），成功返回 v2 并 `revision+1`。
- `class AtomicJsonCheckoutRegistry implements SessionCheckoutRegistryPort`（397）：
  - `read()`（400）：主文件 → 迁移 → 空注册表（文件不存在）→ 否则抛 `registry_corrupt`。
  - `write(registry)`（412）：`mkdirSync` 后 `writeJsonFileAtomic`。

### `src/adapters/lookup.ts` — Harness 工作区查找端口

结构类型：`WorkspaceLike`（19）、`WorkspaceRegistryLike`（26）、`LiveSessionLike`（34）、`SessionStoreLike`（38）；守卫 `isWorkspaceRegistryLike`（43）、`isSessionStoreLike`（50）；`sameResolvedPath`（56）跨平台归一化比较。

- `liveHeaderCwd(sessionId)`（81）：单一读取 live header cwd 的助手（3 处调用点复用，避免守卫漂移）。
- `createDshLookupPort(ctx)`（65）：构建 `SessionCheckoutLookupPort`。`getSidebarMemberships`（87）并查 `workspaceRegistry` 与 `sessionQuery.listSessions()`；`listLiveSessions`（109）取创建序 + header 的 `createdAt`/`cwd`；`getSession`（134）先扫 workspace 投影，已清理的不可变 cwd 再从 live header 恢复；`getSessionCwd`（152）返回 live header 真实工作目录；`getProject`（158）映射 `id/title/path`。

### `src/adapters/working-directory.ts` — Session 工作目录端口

- `interface WorkingDirectoryServiceLike`（18）：宿主服务的结构视图 `get`/`ensure?`/`set`。
- `interface SessionWorkingDirectoryPort`（27）：`current`/`enter`/`leave`。
- `isWorkingDirectoryLike`（45）、`sessionOf`（52，取 `agent.session`）。
- `createSessionWorkingDirectoryPort(ctx)`（61）：宿主未挂载 `workingDirectory` 时 `current` 返回 `undefined`、`enter` 不移动只 resolved `undefined`（绝不让调用方谎称已选 cwd）。
- `isWithin(candidate, root)`（103）：跨平台判断 `candidate` 是否为 `root` 自身或嵌套子目录。

### `src/adapters/safe-file.ts` — 崩溃安全 JSON 读写

- `RETRYABLE_RENAME_CODES`（14）：Windows 额外含 `EBUSY/EPERM/EACCES/ENOTEMPTY`。
- `sleepSync(ms)`（20）：`Atomics.wait` 退化为忙等。
- `renameAtomicWithRetry(source, target, maxAttempts=5)`（30）：保留原子 rename 语义并有限重试瞬时句柄竞争。
- `tmpPathFor(file)`（50）：唯一命名 `<file>.<pid>.<uuid>.tmp`，避免并发写者互踩。
- `listTmpFiles(file)`（55）：按 mtime 新→旧列出 `.tmp` 残留。
- `cleanupTmpFiles(file)`（70）：清理残留。
- `writeJsonFileAtomic(file, data, skipBackup=false)`（82）：先备份 `.bak` → 写唯一 tmp → 原子 rename。
- `writeTextFileAtomic(file, content)`（103）：原子重写文本文件（用于 JSONL 等非单文档）。
- `readJsonFileSafe<T>(file)`（113）：主文件 → 最新可解析 `.tmp` → `.bak` 多层容错，全失败返回 `null`（上层从 JSONL 重建）。

### `src/adapters/git-options.ts` — Git 超时配置

- `interface GitTimeoutOptions`（3）：`gitTimeoutMs?`/`worktreeAddTimeoutMs?`，均可为 `LiveValue`。
- `DEFAULT_GIT_TIMEOUT_MS = 120_000`（8）、`DEFAULT_WORKTREE_ADD_TIMEOUT_MS = 5*60_000`（9）、`MAX_GIT_TIMEOUT_MS = 60*60_000`（10）。
- `validateGitTimeouts(options)`（12）：校验 1000ms~MAX 区间。
- `gitTimeoutMs(args, options)`（21）：`worktree add` → worktreeAdd 超时（缺省 5min）；`worktree remove` → 5min；其余 → git 超时（缺省 120s）。每次调用重读 `LiveValue`。

### `src/adapters/initial-commit.ts` — 首次提交动作

- `interface GitCommitProtocol { prepare: string; beforeCommit(): Promise<void> }`（8）。
- `type Run`（10）：与 git 端口一致的 `(root, args, input?) => Promise<...>`。
- `initialCommitActions(inspect, run)`（13）：返回 `{ preflightInitialCommit, initializeEmptyRepository, initializeProject }`：
  - `preflightInitialCommit(root)`（29）：区分 `ready`/`empty`/`files` 三类，对空仓算 SHA256 指纹（含 root/git/common 身份、HEAD、index 字节、文件列表）。
  - `initializeEmptyRepository(root, fingerprint, assertAuthorized?)`（48）：拿 `index.lock`、双检指纹、校验 `GIT_AUTHOR/COMMITTER_IDENT`、`mktree`+`commit-tree`、再用 `update-ref --stdin` 的 prepare/beforeCommit 在锁下 CAS 发布到原 unborn 分支。
  - `initializeProject(root)`（104）：用户显式确认后 `git init -b main` + `add -A` + `commit`（已版本化仓库拒绝）。

### `src/adapters/worktree-creation.ts` — 带所有权证明的 Worktree 创建

- `type Result`（9）、`type Run`（10）；模块级 `files = createNodeFilesPort()`（11）、`samePath`（12）、`sameIdentity`（14）。
- `createWorktree(localRoot, target, baseOid, run, saveEvidence=()=>{})`（17）：核心创建流程——先 `mkdir` 抢占目录并采集身份证据（根/父/common 身份、lockReason），`saveEvidence` 后才跑 `worktree add --detach --no-checkout --lock`，再读 `.git`/index 指纹、发布索引（`checkout-index`，sparse 仓走 `reset --hard`），解锁；失败时按「是否已注册」与 `failure.quiescent` 决定 rmdir 回收还是整体 `move --force`→`remove --force`（保留所有身份指纹，绝不删未验证残留）。
- `verifyIdentity(e, baseOid)`（126）：校验根/父/common/gitDir 身份、`.git` 指针、commonDir、HEAD、locked 与各 metadata 字节。
- `verifyRollbackMetadata(e, baseOid)`（150）：校验 metadata/index 指纹与 `ORIG_HEAD`。
- `metadataFingerprint(gitDir)`（162）：递归 SHA256 整个 gitDir 元数据（白名单字段）。
- `verifyUnmodified(root, baseOid, run)`（185）：逐文件重新哈希校验索引与磁盘内容一致、无未追踪/已改内容，才授权删除失败结账。

### `src/adapters/project-skills.ts` — Project Skills 溯源与搬运

- `PROJECT_SKILL_ROOTS = ['.dsh/skills', '.agents/skills', '.claude/skills']`（7）、`MAX_FILES = 5000`（8）、`MAX_BYTES = 64MiB`（9）。
- 接口 `Entry`/`Manifest{version:1;root;identity;phase:'copying'|'ready';files;directories?}`/`SkillSnapshot`/`CarriedSkillState`。
- `safePath`（17）、`identity`（23）、`inspectPath`（29）、`boundedRead`（40，带 `O_NOFOLLOW` 与读时一致性检查）、`assertSkillTree`（60）、`ownedSkillDirectories`（71）、`inventory`（74）。
- `class ProjectSkillStore`（101）：按 `digest(realpath(root))` 持久化 manifest。
  - `snapshot(source)`（104）、`load(root)`（108，校验 manifest 身份/阶段/字段）、`carry(snapshot, target)`（125，冲突预检 + 写 manifest + 复制 + 验证 + 原子 rename 到 ready）、`scope(root)`（168）、`paths(root)`（172）、`state(root, tracked?)`（173）、`assertRemovable(root, tracked)`（204，删 Worktree 前确认 Skills 未被改）、`forget(root)`（213）。
- `trackedSkillPaths(indexEntries, headPaths?)`（216）、`hasDeliverableStatus(output, auxiliary, directories?)`（225，仅 `??` 辅助项不计入脏）、`assertSkillPath`（237）。

### `src/adapters/project-skill-io.ts` — 受信任的读写原语

- 接口 `SkillRead`（5）、`SkillBytes`（6）。
- `checkRoot(root, expected)`（10）：确认 checkout 目录身份未变。
- `checkPath(root, path, createParents?)`（16）：逐段校验合法 skill 路径，不跟随链接。
- `readSkillFiles(root, identity, files)`（38）、`createSkillDirectories(root, identity, directories)`（66）、`createSkillFiles(root, identity, files)`（75，`O_EXCL` 原子创建 + 验证）。

### `src/adapters/project-skill-provider.ts` — 只读 Claude 项目 Skill provider

- `NAME = 'worktree-project-claude'`（10）、`interface Locator { root; candidate }`（11）。
- `candidatePath(candidate)`（14）：兼容 DSH 0.1 `candidate.path` 与 0.2 `locator.path`。
- `managedSkillRoot(registry)`（22）：从注册表 `managedCheckouts`（仅 `phase==='ready'`）反查 cwd 对应的受管根（校验 `.git` 指针与 gitdir 双向 backlink）。
- `class ClaudeProjectSkillProvider implements SkillProvider`（48）：`list`/`listNow`（75/78）、`get`/`getNow`（95/98）、`observeHostMutation`（109）、`dispose`（112）；内部按 root 缓存至多 32 个 `FileSystemSkillProvider`，所有操作经 `run` 串行化。
- `mountProjectSkillProvider(ctx, registry)`（121）：`ctx.inject(['skills'])` 注册 provider 并转发 `fs/observed` 变更。

## Architecture

领域层（`session-checkout-apply.ts` 等）只认 `ports.ts` 的端口接口；`src/adapters/` 是这些端口在宿主（Cordis `ctx`）上的具体实现。适配器之间通过明确的「安全边界」协作，关键的跨文件产物是 `WorktreeCreationEvidence`（创建证据，含身份指纹）和 `ProjectSkillStore` 溯源。

```text
┌──────────────────────────── domain ────────────────────────────┐
│ SessionCheckoutApplyEngine  ──依赖──►  port interfaces (ports.ts) │
└────────────────────────────────────────────────────────────────┘
        │ uses                │ uses              │ uses
        ▼                     ▼                   ▼
┌──────────────────┐  ┌───────────────┐  ┌──────────────────────┐
│ createDshGitPort │  │ AtomicJson…   │  │ createDshLookupPort  │
│ (git.ts)         │  │ (registry.ts) │  │ (lookup.ts)          │
│  ├ runGit ───────┼─► ctx.subprocess│  │  ├ workspaceRegistry │
│  ├ worktree-…    │  │  +safe-file.ts│  │  ├ sessions (live)   │
│  └ initialCommit │  │  (atomic JSON)│  │  └ sessionQuery      │
└──────┬───────────┘  └───────────────┘  └──────────────────────┘
       │ calls                 │ called by
       ▼                      ▼
┌──────────────────┐  ┌──────────────────────────────────────────┐
│ worktree-creation│  │ createSessionWorkingDirectoryPort         │
│ (worktree-… .ts) │  │ (working-directory.ts) ──► ctx.workingDir │
│  use files.ts    │  └──────────────────────────────────────────┘
│  identity CAS    │
└──────────────────┘
       │ skills carry
       ▼
┌──────────────────────────────────────────────────────────────┐
│ project-skills.ts (ProjectSkillStore)                         │
│   ├ snapshot/carry/state/assertRemovable                       │
│   ├ project-skill-io.ts  (read/write primitives)              │
│   └ project-skill-provider.ts (ClaudeProjectSkillProvider)     │
│         └ mountProjectSkillProvider ──► ctx.inject(['skills']) │
└──────────────────────────────────────────────────────────────┘
        config feed
┌───────────────┐
│ git-options.ts│ (timeout LiveValue → git.ts gitTimeoutMs)
└───────────────┘
```

各端口职责边界：

- **Git 端口（`git.ts`）**：唯一跑 `git` 的地方，所有命令经 `runGit` → `ctx.subprocess`，绝不触碰工作目录的会话文件策略（策略留在宿主的文件/shell 工具）。
- **文件端口（`files.ts`）**：只提供身份采集、空树回收、隔离区 CAS、递归删、字节测算等纯 fs 原语；`worktree-creation.ts` 复用它做身份校验。
- **注册表端口（`registry.ts` + `safe-file.ts`）**：单一的耐久真相来源，读时强校验，写时原子。
- **查找端口（`lookup.ts`）**：只读导航/授权证据，从不授权结账操作本身。
- **工作目录端口（`working-directory.ts`）**：把会话 cwd 搬进/迁出受管 Worktree，缺失服务时退化为引导。
- **Project Skills 三件套**：Local 仓库的 skills 当作主机私有溯源带到每个 Worktree，并额外挂一个只读 Claude 项目 provider。

## Data Flow

以「创建一个受管 Worktree 并投递」为主线，串起各适配器：

1. **查找与授权证据** — 工具层调用 `createDshLookupPort` 的 `getSession`/`getProject`/`getSessionCwd`（`lookup.ts` 134/158/152）从 `ctx.workspaceRegistry` 与 `ctx.sessions` live header 解析 `{projectId, root}` 与 Session 真实 cwd；`getSidebarMemberships`（87）供侧边栏徽章用。
2. **Worktree 创建（带所有权证明）** — `git.ts:createDetachedWorktree`（336）先 `projectSkills.snapshot(localRoot)`，再要求 baseOid 分支下无未提交 Skill 改动，接着委托 `worktree-creation.ts:createWorktree`（17）。后者 `mkdir` 抢占目录 → 采集 `root/parent/common/gitDir` 身份与 `lockReason` → 多次 `saveEvidence(evidence)`（证据每次更新都写进 `ManagedCheckoutJournal.creation`）→ `git worktree add --detach --no-checkout --lock` → 发布索引 → `worktree unlock`；失败则按 `quiescent` 标志决定 rmdir 或 `move --force`+`remove --force` 整体回滚（保留指纹，绝不删未验证残留）。
3. **工作目录迁移** — 创建成功后，`working-directory.ts:createSessionWorkingDirectoryPort().enter`（80）调用 `ctx.workingDirectory.set(agent, managedRoot)` 把 Session 真正搬进 Worktree；宿主无该服务时退化为 no-op。
4. **Skill 搬运** — `projectSkills.carry(skills, managedRoot)`（`project-skills.ts` 125）把快照按 manifest 复制到目标根并原子切换为 `ready`；后续 `assertRemovable`/`state` 在删 Worktree 前确认 Skills 未被改。
5. **状态持久化** — 每次相位/投递状态变更写 `AtomicJsonCheckoutRegistry.write`（412）→ `safe-file.ts:writeJsonFileAtomic`（82，先备 `.bak` 再唯一 tmp 原子 rename）。
6. **投递与保留** — apply 引擎用 `git.ts` 的 `retainApplyBase`/`retainInternalArtifact`/`readInternalArtifact`/`snapshotAbandonedWorktree` 等（363/369/372/741）把中间产物与放弃快照落到 `refs/dsh-worktree/...`，这些引用命名空间由 `git.ts` 的 `checkoutRefRoot`/`abandonedSnapshotRef`（201/230）统一管理。
7. **读时恢复** — 进程重启后 `registry.read`（400）按「主文件 → v1 迁移 → 空注册表 → 抛 corrupt」顺序恢复；`safe-file.ts:readJsonFileSafe`（113）额外走 `.tmp`/`.bak` 多层容错。

## Connections

- [[ports]] — 本层实现的所有端口接口声明（领域层的唯一依赖面）。
- [[session-checkout-apply]] — apply 引擎与状态机，消费这些适配器端口。
- [[session-checkout-module]] — 模块装配入口，负责 `createDshGitPort`/`createDshLookupPort`/`createSessionWorkingDirectoryPort`/`AtomicJsonCheckoutRegistry`/`mountProjectSkillProvider` 的实例化与注入。
- [[creation-failure]] — `worktree-creation.ts` 失败统一抛 `WorktreeCreationFailure`，区分「可回收」与「残留需保留」。
- [[index]] — 错误码 `SessionCheckoutError`（`git_operation_failed`/`checkout_mismatch`/`registry_corrupt`/`stale_local` 等）的出口与 `managedSkillRoot` 引用的 `gitDir`/`managedGitRoot` 字段。

## Known Issues

以下是源码中明确标注的局限、刻意偏离与降级行为（均指向真实行号，未读过的测试不臆断）：

- **无跨进程锁，文件级 last-writer-wins** — `safe-file.ts:79-80` 注释明确：唯一 tmp + 原子 rename 已消除「tmp 互踩」与「半写提升」，但注册表仍是文件级 last-writer-wins；需要强一致时再引入 lock 文件。多进程并发写注册表可能互相覆盖整文件。
- **刻意偏离官方 sandbox.confine** — `git.ts:15-22`：官方实验性 worktree 服务按调用解析 `sandboxPolicy` 并用 `sandbox.confine` 包裹 git；本插件因受管结账位于会话工作区之外（worktreesRoot 是兄弟树），workspace-write 限制会直接拒绝 `git worktree add` 要创建的目录，故 Session 文件策略仍留在宿主自身的文件/shell 工具里。
- **服务动态解析与缺失降级** — lookup 与 working-directory 适配器都用 `ctx.get('workspaceRegistry'|'sessions'|'sessionQuery'|'workingDirectory')` 动态取服务（`lookup.ts:66-73`、`working-directory.ts:62-68`），因为发布包版本落后于 rc.6 runtime。服务缺失时：`getSidebarMemberships`/`getSession`/`getSessionCwd`/`listLiveSessions` 退化为 `undefined`/空列表（`lookup.ts:87-163`），`enter`/`leave`/`current` 退化为 no-op 并返回 `undefined`（`working-directory.ts:70-99`），由面向模型的引导承担「把 Session 搬进 Worktree」的语义。
- **`enter` 不谎称已选 cwd** — `working-directory.ts:84`：宿主无 `workingDirectory` 服务或调用方没有 live Agent 时，`enter` 返回 `undefined` 而非请求路径，避免调用方把没真正设立的路径报成已选 cwd。
- **Git 端口的本地适配方法按需启用** — `ports.ts:109-230` 列出的 `pushBranch`/`repairWorktreeLinks`/`pruneWorktrees`/`branchOverview`/`branchCreationTimes`/`branchTipTimes`/`mergeLocalBranch`/`graphLog`/`listTags`/`snapshotAbandonedWorktree` 等均为可选；依赖 `reflog`/`for-each-ref`/`ls-remote` 的方法（如 `branchCreationTimes` 508、`listTags` 607）在离线或无 `origin` 时返回 `undefined`/`null`，相关特性（分支竞态守卫、年龄过滤、推送）随之静默禁用，绝不猜测。
- **v1 注册表保守迁移** — `registry.ts:339-394`：v1 记录仅保留 `ready`/`discarded` 相位，其余一律降级到 `recovery_required`，并 `revision+1`；读取时若主文件既非合法 v2 又非可迁移 v1 且文件存在，则抛 `registry_corrupt`（`registry.ts:409`）。
- **首次提交严格约束** — `initial-commit.ts:113-116` 的 `initializeProject` 要求 `GIT_AUTHOR_IDENT` 可用（`user.useConfigOnly=true`），身份未配置时抛 `git_operation_failed`；`initializeEmptyRepository`（48）全程持 `index.lock` 并在锁下 `update-ref --stdin` CAS 发布到原 unborn 分支，绝不覆盖并发提交。
- **测试覆盖** — 直接覆盖适配器的测试有 `tests/working-directory-adapter.test.ts`（enter/leave/no-op 契约）与 `tests/lookup.test.ts`（工作区投影与已清理 cwd 恢复）；其余相关测试（`git-timeouts`/`git-unborn`/`git-creation-lifecycle`/`worktree-creation`/`project-skills`/`project-skills-race`/`project-skill-provider`/`git-tags`）存在但本文未逐行读取，建议交叉核对其断言与上述行号行为是否一致。
