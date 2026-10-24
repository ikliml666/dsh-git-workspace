---
title: Adapter Layer
type: module
source_files:
  - src/adapters/git.ts
  - src/adapters/files.ts
  - src/adapters/git-options.ts
  - src/adapters/safe-file.ts
  - src/adapters/registry.ts
  - src/adapters/lookup.ts
  - src/adapters/worktree-creation.ts
  - src/adapters/initial-commit.ts
  - src/adapters/project-skills.ts
  - src/adapters/project-skill-io.ts
  - src/adapters/project-skill-provider.ts
  - tests/adapters-safe-file.test.ts
tags: [adapters, git, registry, project-skills]
---

## Overview

`src/adapters/` 模块是 DSH（DeepSeek Session Harness）插件的核心基础设施层，将宿主能力适配为领域端口（定义于 `src/ports.ts`）。该层作为插件与底层系统（Git、文件系统、Workspace Registry）之间的隔离带，确保状态机逻辑不直接依赖具体的运行时服务。装配点在插件的 `apply()` 方法（参见 [[host-overview|Host Entry and Registration Surface]]）；领域消费方主要为 [[session-checkout-module|Session Checkout State Machine]]。

核心职责包括：
1. **Git 操作抽象**：通过 `ctx.subprocess` 安全执行 Git 命令，处理超时、环境隔离与子进程树静默（`src/adapters/git.ts`），超时参数由 `src/adapters/git-options.ts` 管理。
2. **文件原子性与安全性**：提供崩溃安全的 JSON 读写、目录身份核验（CAS）与 quarantine 机制（`src/adapters/files.ts`、`src/adapters/safe-file.ts`）。
3. **持久化注册表**：基于原子 JSON 文件的 checkout 状态管理，支持版本迁移与数据校验（`src/adapters/registry.ts`）。
4. **上下文查找**：动态适配 Harness 的 Workspace 与会话查询服务（`src/adapters/lookup.ts`）。
5. **Worktree 创建保障**：严格的容器身份核验与失败回滚路径（`src/adapters/worktree-creation.ts`）。
6. **Project Skills 携带**：在项目技能目录间同步文件，支持 snapshot/carry/forget 生命周期（`src/adapters/project-skills.ts`、`project-skill-io.ts`、`project-skill-provider.ts`）。

## Key Components

### Git Options (`src/adapters/git-options.ts`)

- `GitTimeoutOptions` 接口 (L3-L6)：字段 `gitTimeoutMs?: number | LiveValue<number | undefined>` (L4)，`worktreeAddTimeoutMs?: number | LiveValue<number | undefined>` (L5)。
- `DEFAULT_GIT_TIMEOUT_MS = 120_000` (L8)：普通 Git 命令默认超时。
- `DEFAULT_WORKTREE_ADD_TIMEOUT_MS = 5 * 60_000` (L9)：worktree add 默认超时（5 分钟）。
- `MAX_GIT_TIMEOUT_MS = 60 * 60_000` (L10)：超时上限。
- `validateGitTimeouts(options)` (L12-L19)：校验两个超时字段为 1000~MAX_GIT_TIMEOUT_MS 间的整数，否则抛 `RangeError`。
- `gitTimeoutMs(args, options)` (L21-L27)：按命令返回超时；`args[0]==='worktree' && args[1]==='add'` 用 `worktreeAddTimeoutMs` 或默认 (L24)；`args[1]==='remove'` 固定 5 分钟 (L25)；其他用 `gitTimeoutMs` 或默认 (L26)。

### Git Port (`src/adapters/git.ts`)

`createDshGitPort(ctx, options)` (L249-L752) 构建并返回 `SessionCheckoutGitPort` 对象，最后通过 `Object.assign(port, initialCommitActions(port.inspect, runSessionGit))` 混入初始提交动作 (L752)。

#### 常量与配置
- `GIT_TERMINATION_GRACE_MS = 1_000` (L38)：终止宽限期。
- `GIT_COLLECT_BYTES = 1 << 20` (L40)：单流收集输出上限 1MB。
- `WIP_PATCH_COLLECT_BYTES = 16 << 20` (L42)：WIP patch 收集上限 16MB（应对 base85 膨胀）。
- `GitPortOptions` 接口 (L44-L48)：继承 `GitTimeoutOptions`，扩展字段：
  - `hooksPath: string` (L46)：空 `core.hooksPath` 目标目录，由调用者创建。
  - `projectSkills?: ProjectSkillStore` (L47)：可选技能存储。

#### 内部辅助函数与接口
- `GitCommandResult` 接口 (L50-L56)：`code: number` (L51)，`stdout: string` (L52)，`stderr: string` (L53)，`quiescent?: boolean` (L55，仅当子进程服务确认整树静止时为 true)。
- `parseDecoration(decoration)` (L63-L71)：解析 `%D` 装饰字符串，去除 `HEAD -> ` 与保留 `tag:` 标记。
- `settleCreationTree(handle)` (L73-L86)：最多等 10s 确保子进程树退出，返回 boolean。
- `runGit(ctx, cwd, args, options, input?, creation?, collectBytes?)` (L93-L188)：底层执行器。argv 含 `--no-pager`, `--no-optional-locks`, Windows 下 `core.longpaths=true` (L107), `core.quotePath=false`, `core.fsmonitor=false`, `core.hooksPath=` (L108-L110)；环境清除敏感 `GIT_*` 覆盖并强制 `GIT_OPTIONAL_LOCKS=0`, `GIT_TERMINAL_PROMPT=0`, `LC_ALL=C`, `LANG=C` (L121-L131)。`input` 为字符串或 `GitCommitProtocol` (L133-L154)。creation 模式等待树静默 (L157-L168)。
- `runGitChecked(...)` (L190-L199)：包装 `runGit`，非零退出抛 `SessionCheckoutError('git_operation_failed')`。
- `checkoutRefRoot(checkoutId)` (L201-L204)：SHA-256 前 24 字符生成 `refs/dsh-worktree/session-checkouts/<key>`。
- `assertArtifactName(artifactName)` (L206-L214)：校验每段符合 `^[A-Za-z0-9][A-Za-z0-9._-]*$`。
- `internalArtifactRef(checkoutId, artifactName)` (L216-L219)：组合 ref。
- `applyBaseRef(checkoutId)` (L221-L223)：返回 `internalArtifactRef(checkoutId, 'apply-base')`。
- `abandonedSnapshotRef(checkoutId)` (L230-L233)：返回 `refs/dsh-worktree/abandoned/${checkoutId}`，调用 `assertArtifactName`。
- `hasGitMetadata(root)` (L235-L246)：向上遍历查找 `.git`。

#### Port 方法实现（对象 L255-L751）
- `inspect(root)` (L256-L322)：单次 `rev-parse` 取四行快径，回退处理 unborn/broken HEAD。
- `findContainingWorktreeRoot(root)` (L323-L330)：`rev-parse --show-toplevel`。
- `status(root)` (L331-L335)：`status --porcelain=v1 -z --untracked-files=all`，结合 `ProjectSkillStore.scope` 过滤。
- `createDetachedWorktree(localRoot, managedRoot, baseOid, saveEvidence)` (L336-L348)：校验技能变更后调 `createWorktree` 并 `carry`。
- `removeWorktree(localRoot, managedRoot)` (L349-L359)：校验技能可移除性后强制移除并 `forget`。
- `pruneWorktrees(localRoot)` (L360-L362)：`worktree prune --expire now`。
- `retainApplyBase(localRoot, checkoutId, oid)` (L363-L365)：`update-ref applyBaseRef oid`。
- `releaseApplyBase(localRoot, checkoutId)` (L366-L368)：`update-ref -d applyBaseRef`。
- `retainInternalArtifact(localRoot, checkoutId, artifactName, oid)` (L369-L371)：`update-ref internalArtifactRef oid`。
- `readInternalArtifact(localRoot, checkoutId, artifactName)` (L372-L377)：`rev-parse --verify --quiet`，code=1 返 null。
- `releaseInternalArtifacts(localRoot, checkoutId, artifactPrefix?)` (L378-L388)：批量 `update-ref --stdin` 事务删除。
- `isAncestor(root, ancestorOid, descendantOid)` (L389-L394)：`merge-base --is-ancestor`。
- `listLocalBranches(root)` (L395-L398)：`for-each-ref` 排序返回。
- `resolveLocalBranchTip(root, branch)` (L399-L404)：校验 40/64 位十六进制 OID。
- `attachWorktreeBranch(managedRoot, branchRef, headOid, expectedOldOid?)` (L405-L425)：仅更新 ref/HEAD，CAS 语义（expectedOldOid 为 null 时用全零）。
- `pushBranch(root)` (L426-L442)：推送到上游，无分支/上游返回 `{ok:false, message}`。
- `repairWorktreeLinks(repoCommonDir, managedRoot)` (L443-L448)：`worktree repair`。
- `listWorktreeincludeFiles(localRoot, includeFile)` (L449-L468)：交集忽略文件与 `.worktreeinclude` 匹配，自动带入 `AGENTS.override.md`。
- `branchOverview(root)` (L469-L485)：返回分支列表与 dirtyCount。
- `defaultBranch(root)` (L486-L493)：从 `origin/HEAD` 或 `init.defaultBranch` 解析。
- `branchTipTimes(root)` (L494-L507)：返回分支名→提交时间映射。
- `deleteLocalBranch(root, name)` (L508-L512)：`branch -d`，返回 `{deleted, reason?}`。
- `graphLog(root, limit)` (L513-L535)：解析 `%H%x00%P...` 记录。
- `createLocalBranch(root, name)` (L536-L545)：`check-ref-format` 后 `branch name HEAD`。
- `switchLocalBranch(root, branch)` (L546-L557)：处理 worktree 占用错误。
- `listTags(root)` (L558-L595)：列出标签及是否已被 origin 推送。
- `createTag(root, name, options)` (L596-L611)：校验名后建轻量或注解标签。
- `deleteLocalTag(root, name)` (L612-L617)：`tag -d`。
- `pushTag(root, name)` (L618-L623)：推标签，不强制。
- `deleteRemoteTag(root, name)` (L624-L628)：`:refs/tags/<name>` 删除远端标签。
- `mergeLocalBranch(root, source, options?)` (L629-L699)：支持 `dryRun` 临时 detached probe (L666-L688)，正式合并保留冲突 (L691-L698)。
- `captureLocalWip(root)` (L700-L708)：`diff --binary HEAD` 收集上限 `WIP_PATCH_COLLECT_BYTES`。
- `applyWorktreePatch(root, patch)` (L709-L715)：`apply --binary`。
- `listUntrackedFiles(root)` (L716-L720)：非 ignore 的 untracked。
- `snapshotAbandonedWorktree(localRoot, managedRoot, checkoutId)` (L721-L741)：`add -A` + `write-tree` + `commit-tree` 固定身份。
- `restoreAbandonedSnapshot(localRoot, checkoutId, snapshotOid)` (L742-L750)：创建分支并删除 abandoned ref。

### Files Port (`src/adapters/files.ts`)

`createNodeFilesPort()` (L89-L108) 返回 `SessionCheckoutFilesPort`。

辅助函数：
- `measureDirectoryBytes(path)` (L16-L24)：递归计算字节，忽略符号链接。
- `removeEmptyDirectoryTree(path)` (L26-L35)：同步删空目录树。
- `inspectDirectoryIdentity(path)` (L37-L46)：返回 `{device, inode, birthtimeNs}` 或 null。
- `directoryIdentitiesEqual(left, right)` (L48-L50)：三字段全等。
- `quarantineDirectoryTree(path, expectedIdentity, quarantinePath)` (L52-L72)：同父目录原子 rename 并校验身份。
- `removeDirectoryTree(path)` (L74-L86)：异步递归删，Windows 重试 6 次。

端口方法（L90-L108）：
- `exists`: L91 `existsSync`
- `canonicalize`: L92 `realpath(resolve(path))`
- `inspectDirectoryIdentity`: L93 引用上述函数
- `ensureDirectory`: L94 `mkdirSync(recursive)`
- `removeEmptyDirectoryTree`: L95 引用
- `quarantineDirectoryTree`: L96 引用
- `removeDirectoryTree`: L97 引用
- `measureDirectoryBytes`: L98 引用
- `readTextFile`: L99 存在则读否则 null
- `copyFile`: L100-L104 建目录并覆盖写
- `isSymbolicLink`: L105-L107 `lstatSync().isSymbolicLink()`

### Safe File Utilities (`src/adapters/safe-file.ts`)

崩溃安全的 JSON/文本读写，解决强制关机/崩溃导致的截断问题。

- `RETRYABLE_RENAME_CODES` (L14-L18)：Windows 含 EBUSY/EPERM/EACCES/ENOTEMPTY，其他含 EBUSY/ENOTEMPTY。
- `sleepSync(milliseconds)` (L20-L27)：用 `Atomics.wait` 或回退忙等。
- `renameAtomicWithRetry(source, target, maxAttempts=5)` (L30-L44)：可重试原子重命名。
- `tmpPathFor(filePath)` (L50-L52)：`<file>.<pid>.<uuid>.tmp` 唯一名。
- `listTmpFiles(filePath)` (L55-L68)：列出 `.tmp` 残留按 mtime 新→旧。
- `cleanupTmpFiles(filePath)` (L70-L74)：删除所有 `.tmp`。
- `writeJsonFileAtomic(filePath, data, skipBackup=false)` (L82-L100)：写唯一 tmp → 可选 `.bak` 备份 → 原子 rename。
- `writeTextFileAtomic(filePath, content)` (L103-L107)：同上用于文本。
- `readJsonFileSafe<T>(filePath)` (L113-L161)：主文件 → 最新可解析 `.tmp` 提升 → `.bak` 回退，全失败返 null。

### Registry (`src/adapters/registry.ts`)

`AtomicJsonCheckoutRegistry` 实现 `SessionCheckoutRegistryPort`，管理 `managed-checkouts.json`。

- `emptyRegistry()` (L17-L24)：返回 `{version:2, revision:0, sessionBindings:{}, managedCheckouts:{}}`。
- 类型守卫（全部私有函数）：
  - `isRecord` L26-L28, `isStringArray` L30-L32, `isOid` L34-L36, `isBoundedText` L38-L40, `isSafeRelativePath` L42-L46
  - `isTargetRef` L48-L53, `isSessionBinding` L55-L65, `isReview` L67-L85, `isPreviousReview` L87-L95, `isCheckpoint` L97-L114, `isPreviewReceipt` L116-L136, `isDelivery` L152-L191, `isJournal` L193-L250
  - `safeRecoveryString` L252-L254, `safeRecoveryRevision` L256-L258, `safeConflictFile` L260-L264, `isRecoveryContinuation` L266-L290, `isManagedCheckout` L292-L325, `isRegistry` L327-L337
- `migrateLegacyRegistry(value)` (L339-L394)：v1→v2，非 ready/discarded 阶段标记 `recovery_required`，delivery 置 `{state:'working', iteration:1}`。
- 类 `AtomicJsonCheckoutRegistry` (L397-L415):
  - `constructor(private readonly path: string)` L398
  - `read()` L400-L410：`readJsonFileSafe` → `isRegistry` 校验 → 尝试迁移 → 不存在返空 → 损坏抛 `SessionCheckoutError('registry_corrupt')`。
  - `write(registry)` L412-L415：`mkdirSync` + `writeJsonFileAtomic`。

### Lookup (`src/adapters/lookup.ts`)

`createDshLookupPort(ctx)` (L64-L121) 适配 Harness 服务为 `SessionCheckoutLookupPort`。

- 接口 `WorkspaceLike` L19-L24（字段 `id`, `path`, `title`, `sessionIds`），`WorkspaceRegistryLike` L26-L32（方法 `list`, `get`, `resolveByPath`, `create`, `delete`），`LiveSessionLike` L34-L36（`header?.cwd`），`SessionStoreLike` L38-L40（`get`）。
- `isWorkspaceRegistryLike` L42-L47, `isSessionStoreLike` L49-L53, `sameResolvedPath` L55-L61。
- `getSidebarMemberships(managedRoots)` L75-L96：结合 `registry()?.list()` 与 `sessionQuery.listSessions()` 头 cwd 匹配。
- `getSession(sessionId)` L97-L114：先扫 workspace sessionIds，未果则用 `sessions().get(sessionId).header.cwd` 恢复。
- `getProject(projectId)` L115-L120：返回 `{id, name:title, root:path}`。

### Worktree Creation (`src/adapters/worktree-creation.ts`)

`createWorktree(localRoot, target, baseOid, run, saveEvidence?)` (L17-L124) 严格身份核验与回滚。

- 类型 `Result` L9, `Run` L10, `files = createNodeFilesPort()` L11, `samePath` L12-L13, `sameIdentity` L14。
- 阶段①（L29-L69）：验 commonDir/parent 身份 → `mkdir` claimed → 存 evidence → `worktree add --detach --no-checkout --lock` → 验 gitDir 身份与 metadataFingerprint → `verifyIdentity` → sparse 分支 `reset --hard` 或 `read-tree`+`checkout-index` → 再 `verifyIdentity` → `unlock`。
- 阶段②失败处理（L70-L123）：
  - `!claimed` → `WorktreeCreationFailure(message, true)` L72
  - `claimed && !registered && quiescent` → 条件性 `rmdir` L74-L87
  - `registered && quiescent` → 全链路 rollback：verify → `worktree move --force` 至 quarantine → `worktree remove --force` L94-L120
- `verifyIdentity(e, baseOid)` L126-L148：检查 root/parent/common/gitDir 身份、`.git` 指针、`commondir`、`HEAD`、`locked`、无 `.lock`。
- `verifyRollbackMetadata(e, baseOid)` L150-L160：校验 `metadataFingerprint`、`indexFingerprint`、`ORIG_HEAD`。
- `metadataFingerprint(gitDir)` L162-L183：SHA-256 遍历 gitDir，排除 index/gitdir/ORIG_HEAD。
- `verifyUnmodified(root, baseOid, run)` L185-L250：校验 index 条目 hash、submodule、filters、unknown contents、staged/untracked/changed。

### Initial Commit (`src/adapters/initial-commit.ts`)

`GitCommitProtocol` 接口 (L8)：`prepare: string; beforeCommit(): Promise<void>` (L8)。
`Run` 类型 L10。
`initialCommitActions(inspect, run)` (L13-L118) 返回 `{ preflightInitialCommit, initializeEmptyRepository, initializeProject }`。
- `stale` L14, `checked` L15-L19, `identity` L20-L24, `indexBytes` L25-L28
- `preflightInitialCommit(root)` L29-L47：返回 `ready`/`files`/`empty`(带 fingerprint)
- `initializeEmptyRepository(root, fingerprint, assertAuthorized?)` L48-L100：拿 `index.lock` → CAS 复核 → `mktree`+`commit-tree` → `update-ref --stdin` 事务
- `initializeProject(root)` L104-L117：非 Git 则 `init -b main`，unborn 则 `add -A` + `commit`

### Project Skills (`src/adapters/project-skills.ts`, `project-skill-io.ts`, `project-skill-provider.ts`)

`project-skills.ts`:
- `PROJECT_SKILL_ROOTS` L7：`['.dsh/skills', '.agents/skills', '.claude/skills']`
- `MAX_FILES = 5000` L8, `MAX_BYTES = 64*1024*1024` L9
- `Entry` 接口 L10：`path: string`, `hash: string`, `mode: number`
- `Manifest` 接口 L11：`version: 1`, `root: string`, `identity: string`, `phase: 'copying' | 'ready'`, `files: Entry[]`, `directories?: string[]`
- `SkillSnapshot` 接口 L12：`directories?: string[]`, `files: Array<Entry & {content: Buffer}>`
- `CarriedSkillState` 接口 L13：`paths: string[]`, `fingerprint: string`, `modified: boolean`
- 函数：`digest` L14, `missing` L15, `failure` L16, `safePath` L17-L22, `identity` L23-L27, `inspectPath` L29-L39, `boundedRead` L40-L58, `assertSkillTree` L60-L70, `ownedSkillDirectories` L71-L73, `inventory` L74-L98
- `ProjectSkillStore` 类 L101-L214:
  - `constructor(directory)` L102
  - `file(root)` L103
  - `snapshot(source)` L104-L107
  - `load(root)` L108-L124 严格校验 Manifest
  - `carry(snapshot, target)` L125-L167 冲突预检+独占写 Manifest+原子替换
  - `scope(root)` L168-L171
  - `paths(root)` L172
  - `state(root, tracked?)` L173-L203
  - `assertRemovable(root, tracked)` L204-L212
  - `forget(root)` L213-L214
- `trackedSkillPaths` L216-L223, `hasDeliverableStatus` L225-L235, `assertSkillPath` L237-L239

`project-skill-io.ts`:
- `SkillRead` L5：`path: string`, `maxBytes: number`
- `SkillBytes` L6：`path: string`, `content: Buffer`, `mode: number`
- `checkRoot` L10-L15, `checkPath` L16-L36
- `readSkillFiles` L38-L64 批量读，每次 `checkRoot`+`checkPath`+`O_NOFOLLOW`+stat 比对
- `createSkillDirectories` L66-L73 通过 `.directory-check` 原子建目录
- `createSkillFiles` L75-L88 `O_CREAT|O_EXCL` 写文件

`project-skill-provider.ts`:
- `NAME = 'worktree-project-claude'` L10, `Locator` L11：`root: string; candidate: SkillCandidate`
- `candidatePath` L14-L19 兼容 DSH 0.1/0.2
- `managedSkillRoot(registry)` L22-L45 遍历 `managedCheckouts` phase==='ready' 验证 `.git` 双向链接
- `ClaudeProjectSkillProvider` 类 L48-L119:
  - `name` L49, `providers` Map L50, `operations` L51, `disposed` L52
  - `run` L53-L57 序列化操作
  - `constructor(ctx, control, resolveRoot)` L58-L59
  - `provider(root)` L60-L74 实例池≤32
  - `list` L75-L77 → `listNow` L78-L94 过滤 rank=250
  - `get` L95-L97 → `getNow` L98-L108
  - `observeHostMutation` L109-L111, `dispose` L112-L118
- `mountProjectSkillProvider(ctx, registry)` L121-L133 注册 provider 与 fs/observed 转发

### Tests (`tests/adapters-safe-file.test.ts`)

覆盖 `safe-file.ts` 行为：
- `scratch()` L8-L12 建临时目录
- `afterEach` L14-L16 清理
- `describe` 内 test:
  - 最新 tmp 提升 L19-L31
  - legacy 固定 `.tmp` 提升 L33-L40
  - 无残留可解析返 null L42-L50
  - 原子写与 `.bak` L52-L64
  - `writeTextFileAtomic` 替换内容 L66-L73

## Architecture

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Plugin Apply / Host Entry                          │
│                                  (cordis Context)                           │
└──────────────────────────┬──────────────────────────────────────────────────┘
                           │ ctx.get('workspaceRegistry'), ctx.get('sessions')
                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Adapter Layer (src/adapters/)                       │
│                                                                             │
│  ┌──────────────────┐   ┌──────────────────┐   ┌──────────────────────┐   │
│  │ createDshGitPort │   │createNodeFilesPort│   │ AtomicJsonCheckoutRe │   │
│  │ (git.ts)         │   │ (files.ts)       │   │ gistry (registry.ts) │   │
│  │                  │   │                  │   │                      │   │
│  │ - runGit/subproc │   │ - measureBytes   │   │ - read/write atomic  │   │
│  │ - inspect/status │   │ - quarantine     │   │ - isRegistry/v2      │   │
│  │ - merge/snapshot │   │ - identity CAS   │   │ - migrate v1→v2      │   │
│  └────────┬─────────┘   └────────┬─────────┘   └──────────┬───────────┘   │
│           │                      │                        │               │
│  ┌────────▼─────────┐   ┌────────▼─────────┐   ┌──────────▼───────────┐   │
│  │ createWorktree   │   │ writeJsonFile    │   │ createDshLookupPort  │   │
│  │ (worktree-        │   │ Atomic /         │   │ (lookup.ts)          │   │
│  │  creation.ts)    │   │  readJsonFileSafe│   │                      │   │
│  │                  │   │ (safe-file.ts)   │   │ - getSidebarMembers  │   │
│  │ - identity CAS   │   │                  │   │ - getSession/liveCwd │   │
│  │ - rollback/move  │   │ - rename retry   │   │ - getProject         │   │
│  │ - verifyUnmodif  │   │ - tmp/.bak recov │   └──────────────────────┘   │
│  └──────────────────┘   └──────────────────┘                                │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                     Project Skills Integration                       │   │
│  │                                                                      │   │
│  │  ProjectSkillStore ◄──► ProjectSkillIO ◄──► ClaudeProjectSkillProv │   │
│  │  (snapshot/carry/forget)  (atomic create/read)  (pool ≤32, rank 250)│   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────┬──────────────────────────────────────────────────┘
                           │ SessionCheckoutDependencies (ports.ts)
                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                   Session Checkout State Machine                            │
│                   ([[session-checkout-module]])                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Data Flow

1. **Git Command Execution**:
   - Caller → `runGit(ctx, cwd, args, options, input?, creation?)` (git.ts L93)。
   - `ctx.subprocess.spawn` 启动 git，注入安全环境变量与参数 (git.ts L101-L132)。
   - 若为 `GitCommitProtocol`，通过 stdin pipe 发送 `prepare`，等待 `prepare: ok` 后执行 `beforeCommit` 回调，最后发送 `commit\n` 或 `abort\n` (git.ts L133-L154)。
   - 若为 creation 模式，等待子进程树静默 (`settleCreationTree`) (git.ts L73, L157-L168)。
   - 返回 `GitCommandResult`，caller 决定非零退出码的处理策略 (git.ts L190 `runGitChecked` 抛错)。

2. **Worktree Creation & Verification**:
   - `createDetachedWorktree` (git.ts L336) → `createWorktree` (worktree-creation.ts L17)。
   - Inspect commonDir/parent identity → mkdir(target) → inspect rootIdentity → `saveEvidence` (worktree-creation.ts L30-L43)。
   - `worktree add --detach --no-checkout --lock` → inspect gitDir/gitIdentity/metadataFingerprint → `saveEvidence` (L44-L49)。
   - `verifyIdentity` → sparse checkout handling → `checkout-index` → `unlock` (L51-L69)。
   - 失败时：根据 `claimed`/`registered` 状态执行条件性 rmdir 或全链路 quarantine+rollback (L70-L123)。

3. **Registry Read/Write**:
   - `AtomicJsonCheckoutRegistry.read()` (registry.ts L400) → `readJsonFileSafe` (safe-file.ts L113)。
   - 主文件 → .tmp 提升 → .bak 回退 (safe-file.ts L113-L161)。
   - 校验 `isRegistry` → 迁移 v1→v2 → 返回或抛错 (registry.ts L327-L410)。
   - `write()` (registry.ts L412) → `writeJsonFileAtomic` (safe-file.ts L82)，含 .bak 备份与唯一 tmp rename。

4. **Project Skills Carry**:
   - `createDetachedWorktree` 校验本地无 Skill 变更 (git.ts L337-L340)。
   - `createWorktree` 完成后调用 `projectSkills.carry(skills, managedRoot)` (git.ts L347)。
   - `carry` 流程：校验冲突 → `manifest.phase='copying'` → mkdir/writeFile → verify → `manifest.phase='ready'` + atomic rename (project-skills.ts L125-L167)。
   - `removeWorktree` 调用 `projectSkills.assertRemovable` 校验无变更后 `worktree remove` (git.ts L352-L357)。

5. **Lookup Service Adaptation**:
   - `createDshLookupPort` 动态获取 `ctx.get('workspaceRegistry')` 与 `ctx.get('sessions')` (lookup.ts L65-L72)。
   - `getSidebarMemberships` 并行查询 workspace list 与 session query headers，通过 `sameResolvedPath` 匹配 managedRoot (lookup.ts L75-L96)。
   - `getSession` 优先扫描 workspace sessionIds，fallback 到 live session header cwd (lookup.ts L97-L114)。

## Connections

- [[host-overview|Host Entry and Registration Surface]]：插件装配点。
- [[session-checkout-module|Session Checkout State Machine]]：主要消费方，通过 `SessionCheckoutDependencies` 接口调用。
- [[console-host|Console Host Control Plane]]：授权校验面，Lookup 仅提供导航证据。
- [[non-git-incremental-enablement|Non-Git Incremental Enablement]]：initial-commit.ts 支撑的非 Git 渐进增强功能。
- [[session-checkout-apply|Session Checkout Apply Pipeline]]：Project Skills snapshot/carry 在此流程中被调用。

## Known Issues

- **竞态保护复杂性**: `initial-commit.ts` 的 `initializeEmptyRepository` (L48-L100) 和 `project-skills.ts` 的 `carry` (L125-L167) 均依赖复杂的指纹校验和锁机制来防止竞态条件。若指纹计算逻辑（如 `identity` L23-L27 或 `metadataFingerprint` worktree-creation.ts L162-L183）因文件系统元数据变化而失效，可能导致不必要的初始化拒绝或状态不一致。
- **Windows 兼容性**: `safe-file.ts` 中的 `renameAtomicWithRetry` (L30-L44) 和 `files.ts` 中的 `removeDirectoryTree` (L74-L86) 针对 Windows 文件句柄竞争实现了重试逻辑，但在极端高负载下仍可能失败，需监控重试次数上限。
- **注册表迁移**: `registry.ts` 的 `migrateLegacyRegistry` (L339-L394) 将非终态 checkout 标记为 `recovery_required`，这可能需要人工干预或额外的自动化恢复流程，否则这些 checkout 将处于挂起状态。
- **测试覆盖局限**: `tests/adapters-safe-file.test.ts` 仅验证 `safe-file.ts` 的读写恢复（L19-L73），其他适配器（如 git、registry 校验）缺乏单元测试，回归风险集中于集成环境。
