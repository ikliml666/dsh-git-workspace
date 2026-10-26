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
  - src/ports.ts
  - tests/adapters-safe-file.test.ts
tags: [adapters, git, registry, project-skills]
---

## Overview

`src/adapters/` 模块是 DSH（DeepSeek Session Harness）插件 `dsh-git-worktree` 的核心基础设施层，将宿主能力适配为领域端口（端口接口定义于 `src/ports.ts`，本次已随源码提供并文档化于下方）。该层作为插件与底层系统（Git、文件系统、Workspace Registry、Harness 会话服务、Project Skills 文件系统）之间的隔离带，确保状态机逻辑不直接依赖具体的运行时服务。装配点在插件的 `apply()` 方法；领域消费方主要为 Session Checkout 状态机与 Apply 引擎。

核心职责包括：
1. **Git 操作抽象**：通过 `ctx.subprocess` 安全执行 Git 命令，处理超时、环境隔离与子进程树静默（`src/adapters/git.ts`），超时参数由 `src/adapters/git-options.ts` 管理。
2. **文件原子性与安全性**：提供崩溃安全的 JSON 读写、目录身份核验（CAS）与 quarantine 机制（`src/adapters/files.ts`、`src/adapters/safe-file.ts`）。
3. **持久化注册表**：基于原子 JSON 文件的 checkout 状态管理，支持 v1→v2 版本迁移与严格数据校验（`src/adapters/registry.ts`）。
4. **上下文查找**：动态适配 Harness 的 Workspace 与会话查询服务（`src/adapters/lookup.ts`）。
5. **Worktree 创建保障**：严格的容器身份核验与失败回滚路径（`src/adapters/worktree-creation.ts`）。
6. **初始提交能力**：将非 Git 或 unborn 仓库在显式确认后变为有首次提交的仓库（`src/adapters/initial-commit.ts`）。
7. **Project Skills 携带**：在项目技能目录间同步文件，支持 snapshot/carry/forget 生命周期及额外的 Claude 技能提供方（`src/adapters/project-skills.ts`、`project-skill-io.ts`、`project-skill-provider.ts`）。

## Key Components

### Git Options (`src/adapters/git-options.ts`)

- `GitTimeoutOptions` 接口 (L3-L6)：字段 `gitTimeoutMs?: number | LiveValue<number | undefined>` (L4)，`worktreeAddTimeoutMs?: number | LiveValue<number | undefined>` (L5)。
- `DEFAULT_GIT_TIMEOUT_MS = 120_000` (L8)：普通 Git 命令默认超时。
- `DEFAULT_WORKTREE_ADD_TIMEOUT_MS = 5 * 60_000` (L9)：worktree add 默认超时（5 分钟）。
- `MAX_GIT_TIMEOUT_MS = 60 * 60_000` (L10)：超时上限。
- `validateGitTimeouts(options)` (L12-L19)：遍历 `['gitTimeoutMs', 'worktreeAddTimeoutMs']`，通过 `liveConfigValue` 读当前值；若非 `undefined` 且非 1000~MAX_GIT_TIMEOUT_MS 间的安全整数则抛 `RangeError` (L15-L16)。
- `gitTimeoutMs(args, options)` (L21-L27)：按命令返回超时；`args[0]==='worktree' && args[1]==='add'` 用 `worktreeAddTimeoutMs` 或默认 5 分钟 (L24)；`args[0]==='worktree' && args[1]==='remove'` 固定 5 分钟 (L25)；其他用 `gitTimeoutMs` 或默认 120 秒 (L26)。

### Git Port (`src/adapters/git.ts`)

模块文档 (L6-L24) 说明：通过 `ctx.subprocess` 运行 git，禁用钩子、无可选锁、无终端提示、C locale、Windows 下 worktree 移除 5 分钟硬上限；内部 ref 使用 `refs/dsh-worktree/session-checkouts/<key>` 命名空间。

`createDshGitPort(ctx, options)` (L249-L772) 构建并返回 `SessionCheckoutGitPort` 对象，最后通过 `Object.assign(port, initialCommitActions(port.inspect, runSessionGit))` (L772) 混入初始提交动作。

#### 常量与配置

- `GIT_TERMINATION_GRACE_MS = 1_000` (L38)：终止宽限期，独立于命令截止时间。
- `GIT_COLLECT_BYTES = 1 << 20` (L40)：单流收集输出上限 1MB。
- `WIP_PATCH_COLLECT_BYTES = 16 << 20` (L42)：WIP patch 收集上限 16MB（应对 base85 膨胀）。
- `GitPortOptions` 接口 (L44-L48)：继承 `GitTimeoutOptions`，扩展字段：
  - `hooksPath: string` (L46)：空 `core.hooksPath` 目标目录，由调用者创建。
  - `projectSkills?: ProjectSkillStore` (L47)：可选技能存储，缺省时在 `dirname(hooksPath)/project-skills` 新建 (L251)。

#### 内部辅助函数与接口

- `GitCommandResult` 接口 (L50-L56)：字段 `code: number` (L51)，`stdout: string` (L52)，`stderr: string` (L53)，`quiescent?: boolean` (L55，仅当子进程服务确认整树静止时为 true)。
- `parseDecoration(decoration)` (L63-L71)：解析 `%D` 装饰字符串，去 `HEAD` 裸项、去 `HEAD -> ` 前缀、保留 `tag:` 标记 (L68)，空白返回 `[]` (L64)。
- `settleCreationTree(handle)` (L73-L86)：最多等 10s 确保子进程树退出，返回 boolean (L73-L86)。
- `runGit(ctx, cwd, args, options, input?, creation?, collectBytes?)` (L93-L188)：底层执行器。argv 含 `git --no-pager --no-optional-locks`、Windows 下 `-c core.longpaths=true` (L107)、`core.quotePath=false`、`core.fsmonitor=false`、`core.hooksPath=` (L108-L110)；环境清除敏感 `GIT_*` 覆盖并强制 `GIT_OPTIONAL_LOCKS=0`、`GIT_TERMINAL_PROMPT=0`、`LC_ALL=C`、`LANG=C` (L121-L131)。`input` 为字符串或 `GitCommitProtocol`（L133-L154，协议模式等待 `prepare: ok` 后调 `beforeCommit()` 再发 `commit\n`/`abort\n`）。creation 模式等待树静默 (L157-L168)。超时/信号返回 `code:-1` 及本地化消息 (L177-L179)。
- `runGitChecked(ctx, cwd, args, options)` (L190-L199)：包装 `runGit`，非零退出抛 `SessionCheckoutError('git_operation_failed', ...)` (L193-L196)。
- `checkoutRefRoot(checkoutId)` (L201-L204)：SHA-256 前 24 字符生成 `refs/dsh-worktree/session-checkouts/<key>`。
- `assertArtifactName(artifactName)` (L206-L214)：校验每段符合 `^[A-Za-z0-9][A-Za-z0-9._-]*$` (L210)，否则抛 `invalid_input`。
- `internalArtifactRef(checkoutId, artifactName)` (L216-L219)：组合 ref。
- `applyBaseRef(checkoutId)` (L221-L223)：返回 `internalArtifactRef(checkoutId, 'apply-base')`。
- `abandonedSnapshotRef(checkoutId)` (L230-L233)：返回 `refs/dsh-worktree/abandoned/${checkoutId}`，调用 `assertArtifactName` (L231)。
- `hasGitMetadata(root)` (L235-L246)：向上遍历查找 `.git`，遇非 ENOENT 错误返回 `true` (L239-L240)。

#### Port 方法实现（对象 L255-L771）

- `inspect(root)` (L256-L322)：单次 `rev-parse --show-toplevel --path-format=absolute --git-common-dir --absolute-git-dir HEAD^{commit}` 取四行快径 (L261-L263)，回退处理 unborn/broken HEAD (L298-L310)。
- `findContainingWorktreeRoot(root)` (L323-L330)：`rev-parse --show-toplevel`，非 git 仓库且 `hasGitMetadata` 为假时返 `null` (L326)。
- `status(root)` (L331-L335)：`status --porcelain=v1 -z --untracked-files=all`，结合 `ProjectSkillStore.scope` 过滤非交付状态 (L333-L334)。
- `createDetachedWorktree(localRoot, managedRoot, baseOid, saveEvidence)` (L336-L348)：校验本地技能变更（diff `PROJECT_SKILL_ROOTS`）后调 `createWorktree` 并 `carry` (L337-L347)。
- `removeWorktree(localRoot, managedRoot)` (L349-L359)：校验技能可移除性（`assertRemovable`）后强制移除并 `forget` (L352-L358)。
- `pruneWorktrees(localRoot)` (L360-L362)：`worktree prune --expire now`。
- `retainApplyBase(localRoot, checkoutId, oid)` (L363-L365)：`update-ref applyBaseRef oid`。
- `releaseApplyBase(localRoot, checkoutId)` (L366-L368)：`update-ref -d applyBaseRef`。
- `retainInternalArtifact(localRoot, checkoutId, artifactName, oid)` (L369-L371)：`update-ref internalArtifactRef oid`。
- `readInternalArtifact(localRoot, checkoutId, artifactName)` (L372-L377)：`rev-parse --verify --quiet`，code=1 返 `null` (L375)。
- `releaseInternalArtifacts(localRoot, checkoutId, artifactPrefix?)` (L378-L388)：批量 `update-ref --stdin` 事务删除（start/delete/commit）(L386)。
- `isAncestor(root, ancestorOid, descendantOid)` (L389-L394)：`merge-base --is-ancestor`，code=0 真、code=1 假。
- `listLocalBranches(root)` (L395-L398)：`for-each-ref --format=%(refname:short) refs/heads` 排序返回。
- `resolveLocalBranchTip(root, branch)` (L399-L404)：校验 40/64 位十六进制 OID。
- `attachWorktreeBranch(managedRoot, branchRef, headOid, expectedOldOid?)` (L405-L425)：仅更新 ref/HEAD，CAS 语义（expectedOldOid 为 null 时用全零）(L410-L411)。
- `pushBranch(root)` (L426-L442)：推送到已配置上游，无本地分支/上游返回 `{ok:false, message}` (L432, L437)，永不强制。
- `repairWorktreeLinks(repoCommonDir, managedRoot)` (L443-L448)：`worktree repair`，返回 boolean。
- `listWorktreeincludeFiles(localRoot, includeFile)` (L449-L468)：交集忽略文件与 `.worktreeinclude` 匹配（`--exclude-from`），自动带入 `AGENTS.override.md` (L466)。
- `branchOverview(root)` (L469-L485)：并行 `for-each-ref` 与 `status`，返回 `{branches, dirtyCount}` (L484)。
- `defaultBranch(root)` (L486-L493)：从 `origin/HEAD` 或 `init.defaultBranch` 解析，皆无返 `null`。
- `branchTipTimes(root)` (L494-L507)：返回分支名→提交时间(ms)映射。
- `branchCreationTimes(root)` (L508-L527)：遍历 reflog 取 `branch: Created from` 最早时间，返回 `Record<string, number> | undefined`。
- `deleteLocalBranch(root, name)` (L528-L532)：`branch -d`，返回 `{deleted, reason?}`。
- `graphLog(root, limit)` (L533-L555)：解析 `%H%x00%P%x00%an%x00%at%x00%D%x00%s%x1e` 记录 (L538)。
- `createLocalBranch(root, name)` (L556-L565)：`check-ref-format --branch` 后 `branch name HEAD`。
- `switchLocalBranch(root, branch)` (L566-L577)：处理 worktree 占用错误（正则匹配 `is already used by|already checked out at`）(L571)。
- `listTags(root)` (L578-L615)：列出标签（注解标签剥 peeled commit）及是否已被 origin 推送 (L607-L612)。
- `createTag(root, name, options?)` (L616-L631)：`check-ref-format refs/tags/<name>` 后建轻量或注解标签。
- `deleteLocalTag(root, name)` (L632-L637)：`tag -d`。
- `pushTag(root, name)` (L638-L643)：推标签到 origin，不强制。
- `deleteRemoteTag(root, name)` (L644-L648)：`:refs/tags/<name>` 删除远端标签。
- `mergeLocalBranch(root, source, options?)` (L649-L719)：支持 `dryRun` 临时 detached probe (L686-L708，用 `mkdtemp` 建探测 worktree 试合并后 `worktree remove --force` 回收)，正式合并保留冲突不 abort (L711-L718)。
- `captureLocalWip(root)` (L720-L728)：`diff --binary --full-index HEAD`，收集上限 `WIP_PATCH_COLLECT_BYTES` (L723)，空输出返 `null`。
- `applyWorktreePatch(root, patch)` (L729-L735)：`apply --binary --whitespace=nowarn -` 原子应用。
- `listUntrackedFiles(root)` (L736-L740)：非 ignore 的 untracked（`--others --exclude-standard`）。
- `snapshotAbandonedWorktree(localRoot, managedRoot, checkoutId)` (L741-L761)：`add -A` + `write-tree` + `commit-tree`（固定 `user.name=dsh-git-worktree`）生成快照提交并 `update-ref abandonedSnapshotRef` (L759)。
- `restoreAbandonedSnapshot(localRoot, checkoutId, snapshotOid)` (L762-L770)：创建 `worktree-restore-<8位>` 分支并删除 abandoned ref，返回分支名。

### Files Port (`src/adapters/files.ts`)

`createNodeFilesPort()` (L89-L108) 返回 `SessionCheckoutFilesPort`。

辅助函数：
- `measureDirectoryBytes(path)` (L16-L24)：递归计算字节，忽略符号链接 (L19)。
- `removeEmptyDirectoryTree(path)` (L26-L35)：同步删空目录树，遇非目录/符号链接返 `false` (L29)。
- `inspectDirectoryIdentity(path)` (L37-L46)：返回 `{device, inode, birthtimeNs}` 字符串三元组或 `null` (L41-L45)，使用 `bigint: true` (L39)。
- `directoryIdentitiesEqual(left, right)` (L48-L50)：三字段全等。
- `quarantineDirectoryTree(path, expectedIdentity, quarantinePath)` (L52-L72)：同父目录原子 `rename` 并校验身份，不符则尝试还原并抛 `checkout_mismatch` (L67-L71)。
- `removeDirectoryTree(path)` (L74-L86)：异步递归删，Windows 重试 6 次、其他 2 次 (L83)，根不能是文件或符号链接 (L77-L78)。

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

崩溃安全的 JSON/文本读写，解决强制关机/崩溃导致的截断问题（模块文档 L2-L8）。

- `RETRYABLE_RENAME_CODES` (L14-L18)：Windows 含 EBUSY/EPERM/EACCES/ENOTEMPTY，其他含 EBUSY/ENOTEMPTY。
- `sleepSync(milliseconds)` (L20-L27)：用 `Atomics.wait` 或回退忙等。
- `renameAtomicWithRetry(source, target, maxAttempts=5)` (L30-L44)：可重试原子重命名，遇可重试错误指数退避 (L40)。
- `tmpPathFor(filePath)` (L50-L52)：`<file>.<pid>.<uuid>.tmp` 唯一名。
- `listTmpFiles(filePath)` (L55-L68)：列出 `.tmp` 残留（含旧版固定 `<file>.tmp`）按 mtime 新→旧 (L63)。
- `cleanupTmpFiles(filePath)` (L70-L74)：删除所有 `.tmp`。
- `writeJsonFileAtomic(filePath, data, skipBackup=false)` (L82-L100)：写唯一 tmp → 可选 `.bak` 备份 (L87-L93) → 原子 rename (L99)。
- `writeTextFileAtomic(filePath, content)` (L103-L107)：同上用于文本文档。
- `readJsonFileSafe<T>(filePath)` (L113-L161)：主文件 (L117-L126) → 最新可解析 `.tmp` 提升 (L129-L141) → `.bak` 回退 (L145-L158)，全失败返 `null` (L160)。

### Registry (`src/adapters/registry.ts`)

`AtomicJsonCheckoutRegistry` 实现 `SessionCheckoutRegistryPort`，管理 `managed-checkouts.json`（模块文档 L3-L9）。

- `emptyRegistry()` (L17-L24)：返回 `{version:2, revision:0, sessionBindings:{}, managedCheckouts:{}}`。
- 类型守卫（全部私有函数）：
  - `isRecord` L26-L28, `isStringArray` L30-L32, `isOid` L34-L36 (匹配 40 或 64 位十六进制), `isBoundedText` L38-L40, `isSafeRelativePath` L42-L46 (拒绝绝对路径与 `..`/`.`)
  - `isTargetRef` L48-L53 (`unselected`/`local`/`isolated`), `isSessionBinding` L55-L65, `isReview` L67-L85, `isPreviousReview` L87-L95, `isCheckpoint` L97-L114, `isPreviewReceipt` L116-L136, `isDeliveryProof` L138-L150, `isDelivery` L152-L191 (按 `state` 分发校验 `working`/`ready_for_review`/`preview_active`/`preview_detached`/`finalized`/`retained`/`delivered`), `isJournal` L193-L250 (校验 `create` 操作的 `creation` 证据与 `apply`/`preview` 等 7 种操作与 7 种 step)
  - `safeRecoveryString` L252-L254, `safeRecoveryRevision` L256-L258, `safeConflictFile` L260-L264, `isRecoveryContinuation` L266-L290 (4 种 kind), `isManagedCheckout` L292-L325 (含 `checkpoints` 序列/唯一性校验 L308-L317), `isRegistry` L327-L337 (version===2 严格校验)
- `migrateLegacyRegistry(value)` (L339-L394)：v1→v2，非 `ready`/`discarded` 阶段标记 `recovery_required` (L366-L368)，delivery 置 `{state:'working', iteration:1}` (L383)，revision 按是否保持原阶段递增 (L385)。
- 类 `AtomicJsonCheckoutRegistry` (L397-L415):
  - `constructor(private readonly path: string)` L398
  - `read()` L400-L410：`readJsonFileSafe` → `isRegistry` 校验 → 尝试 `migrateLegacyRegistry` 并写回 → 不存在返空 → 损坏抛 `SessionCheckoutError('registry_corrupt', ...)` (L409)。
  - `write(registry)` L412-L415：`mkdirSync(dirname, recursive)` + `writeJsonFileAtomic` (L414)。

### Lookup (`src/adapters/lookup.ts`)

`createDshLookupPort(ctx)` (L65-L154) 适配 Harness 服务为 `SessionCheckoutLookupPort`（模块文档 L1-L12）。

- 接口 `WorkspaceLike` L19-L24（字段 `id: string`, `path: string`, `title: string`, `sessionIds: readonly string[]`），`WorkspaceRegistryLike` L26-L32（方法 `list()`, `get(id)`, `resolveByPath(path)`, `create(path, title?)`, `delete(id)`），`LiveSessionLike` L34-L36（`header?: { readonly cwd?: unknown }`），`SessionStoreLike` L38-L40（`get(sessionId)`, `list?()`）。
- `isWorkspaceRegistryLike` L43-L48, `isSessionStoreLike` L50-L53, `sameResolvedPath` L56-L62（Windows 忽略大小写）。
- `getSidebarMemberships(managedRoots)` L76-L97：结合 `registry()?.list()` 与 `ctx.get('sessionQuery').listSessions()` 头 cwd 匹配 (L79-L93)。
- `listLiveSessions()` L98-L122：从 `sessions().list()` 提取 `{id, createdAt?, cwd?}` 数组，异常返 `[]` (L119-L120)。
- `getSession(sessionId)` L123-L140：先扫 workspace sessionIds，未果则用 `sessions().get(sessionId).header.cwd` 恢复单工作区匹配 (L134-L138)。
- `getSessionCwd(sessionId)` L141-L147：返回 live header 的 cwd（owner Session 的 immutabe worktree root）。
- `getProject(projectId)` L148-L153：返回 `{id, name:title, root:path}`。

### Worktree Creation (`src/adapters/worktree-creation.ts`)

`createWorktree(localRoot, target, baseOid, run, saveEvidence?)` (L17-L124) 严格身份核验与回滚（模块文档隐含于代码）。

- 类型 `Result = { code: number; stdout: string; stderr: string; quiescent?: boolean }` L9, `Run = (cwd, args, creating?) => Promise<Result>` L10, `files = createNodeFilesPort()` L11, `samePath` L12-L13, `sameIdentity` L14（JSON 串比较）。
- 阶段①（L29-L69）：验 commonDir/parent 身份 (L30-L35) → `mkdir(target)` claimed (L38-L39) → 存 evidence (L42-L43) → `worktree add --detach --no-checkout --lock --reason` (L44) → 验 gitDir 身份与 metadataFingerprint (L45-L48) → `verifyIdentity` (L51) → sparse 分支 `reset --hard` (L61) 或 `read-tree`+`checkout-index --all` (L63-L66) → 再 `verifyIdentity` (L68) → `unlock` (L69)。
- 阶段②失败处理（L70-L123）：
  - `!claimed` → `WorktreeCreationFailure(message, true)` L72
  - `claimed && !registered && failure?.quiescent===true` → 条件性 `rmdir` 回收 (L73-L87)
  - `registered && failure?.quiescent===true` → 全链路 rollback：verify → `worktree move --force --force` 至 quarantine (L104) → `worktree remove --force --force` (L113) → 确认无残留 (L115)
- `verifyIdentity(e, baseOid)` L126-L148：检查 root/parent/common/gitDir 身份、`.git` 指针双向、`commondir`、`HEAD===baseOid`、`locked` 匹配、无 `.lock` 文件 (L147)。
- `verifyRollbackMetadata(e, baseOid)` L150-L160：校验 `metadataFingerprint`、`indexFingerprint`、`ORIG_HEAD`。
- `metadataFingerprint(gitDir)` L162-L183：SHA-256 遍历 gitDir，排除 `index`/`gitdir`/`ORIG_HEAD` 后对每个文件/目录哈希 (L168-L178)。
- `verifyUnmodified(root, baseOid, run)` L185-L250：校验 index 条目 hash、拒绝 submodule (L193)、拒绝 filter/encoding 转换 (L215-L219)、拒绝 unknown contents (L245-L247)、仅允许对 baseOid 的删除 (L248-L249)。

### Initial Commit (`src/adapters/initial-commit.ts`)

`GitCommitProtocol` 接口 (L8)：字段 `prepare: string; beforeCommit(): Promise<void>`。
`Run` 类型 L10：`(root, args, input?) => Promise<{ code: number; stdout: string; stderr: string }>`。
`initialCommitActions(inspect, run)` (L13-L118) 返回 `{ preflightInitialCommit, initializeEmptyRepository, initializeProject }`。

- `stale()` L14 返回 `SessionCheckoutError('stale_local', ...)`；`checked` L15-L19 包装 run 非零抛 `initialCommitFailed`；`identity` L20-L24 取 dev:ino:birthtimeNs（可选含 mtimeNs/ctimeNs）；`indexBytes` L25-L28 读 index 文件 base64。
- `preflightInitialCommit(root)` L29-L47：返回 `ready`(headOid!=='unborn') / `files`(有文件或 index) / `empty`(带 fingerprint SHA-256) (L39-L46)。
- `initializeEmptyRepository(root, fingerprint, assertAuthorized?)` L48-L100：拿 `index.lock` (`open wx`) → CAS 复核 → 校验 `GIT_AUTHOR_IDENT`/`GIT_COMMITTER_IDENT` (L62-L65) → `mktree`+`commit-tree` → `update-ref --stdin` 事务（prepare 阶段再复核）(L74-L84)。
- `initializeProject(root)` L104-L117（本地适配注释 L101-L103）：非 Git 则 `init -b main` (L111)，unborn 则校验 identity 后 `add -A` + `commit -m 'Initial commit'` (L115-L116)。

### Project Skills (`src/adapters/project-skills.ts`, `project-skill-io.ts`, `project-skill-provider.ts`)

`project-skills.ts`:
- `PROJECT_SKILL_ROOTS = ['.dsh/skills', '.agents/skills', '.claude/skills']` L7
- `MAX_FILES = 5000` L8, `MAX_BYTES = 64 * 1024 * 1024` L9
- `Entry` 接口 L10：字段 `path: string; hash: string; mode: number`
- `Manifest` 接口 L11：字段 `version: 1; root: string; identity: string; phase: 'copying' | 'ready'; files: Entry[]; directories?: string[]`
- `SkillSnapshot` 接口 L12：字段 `directories?: string[]; files: Array<Entry & { content: Buffer }>`
- `CarriedSkillState` 接口 L13：字段 `paths: string[]; fingerprint: string; modified: boolean`
- 函数：`digest` L14, `missing` L15, `failure` L16, `safePath` L17-L22（拒绝 `..`/`.`/非法字符）, `identity` L23-L27, `inspectPath` L29-L39（逐段 lstat 拒绝符号链接）, `boundedRead` L40-L58（O_NOFOLLOW + 读取前后 stat 比对防竞争）, `assertSkillTree` L60-L70（限深 64/万项）, `ownedSkillDirectories` L71-L73, `inventory` L74-L98（遍历 roots 收集文件并哈希）
- `ProjectSkillStore` 类 L101-L214:
  - `constructor(directory)` L102（provenance 目录）
  - `file(root)` L103：`digest(resolve(root))` 命名 json
  - `snapshot(source)` L104-L107：返回 `SkillSnapshot`
  - `load(root)` L108-L124 严格校验 Manifest（version/identity/safePath/hash 格式）
  - `carry(snapshot, target)` L125-L167 冲突预检+独占写 Manifest(`flag:'wx'`)+原子 rename 替换 (L165-L166)
  - `scope(root)` L168-L171 返回 `{paths, directories}`
  - `paths(root)` L172 返回 `scope().paths`
  - `state(root, tracked?)` L173-L203 计算 fingerprint 与 modified
  - `assertRemovable(root, tracked)` L204-L212 修改或新增则抛错
  - `forget(root)` L213-L214 删 provenance 文件
- `trackedSkillPaths(indexEntries, headPaths?)` L216-L223 从 `-z` 文本解析路径集合
- `hasDeliverableStatus(output, auxiliary, directories?)` L225-L235 仅 `?? ` 且不在 auxiliary/directories 才计为 dirty
- `assertSkillPath(root, path)` L237-L239 校验 safePath + inspectPath

`project-skill-io.ts`:
- `SkillRead` 接口 L5：字段 `path: string; maxBytes: number`
- `SkillBytes` 接口 L6：字段 `path: string; content: Buffer; mode: number`
- `checkRoot(root, expected)` L10-L15 比对 dev:ino:birthtimeNs
- `checkPath(root, path, createParents?)` L16-L36 校验三段式根与逐段非符号链接
- `readSkillFiles(root, identity, files)` L38-L64 批量读，每次 `checkRoot`+`checkPath`+`O_NOFOLLOW`+stat ino/dev 比对
- `createSkillDirectories(root, identity, directories)` L66-L73 通过 `.directory-check` 原子建目录
- `createSkillFiles(root, identity, files)` L75-L88 `O_CREAT|O_EXCL` 写文件并 chmod

`project-skill-provider.ts`:
- `NAME = 'worktree-project-claude'` L10, `Locator` 接口 L11：字段 `root: string; candidate: SkillCandidate`
- `candidatePath` L14-L19 兼容 DSH 0.1(`locator.path`)/0.2(`candidate.path`)
- `managedSkillRoot(registry)` L22-L45 遍历 `managedCheckouts` phase==='ready' 验证 `.git` 双向链接与 gitDir 一致性
- `ClaudeProjectSkillProvider` 类 L48-L119:
  - `name = NAME` L49, `providers` Map L50 (≤32 实例池 L63-L67), `operations` L51 序列化, `disposed` L52
  - `run` L53-L57 串行化操作
  - `constructor(ctx, control, resolveRoot)` L58-L59
  - `provider(root)` L60-L74 实例池管理
  - `list` L75-L77 → `listNow` L78-L94 过滤 rank=250、source='project-claude'
  - `get` L95-L97 → `getNow` L98-L108
  - `observeHostMutation` L109-L111, `dispose` L112-L118
- `mountProjectSkillProvider(ctx, registry)` L121-L133 注册 provider 并转发 `fs/observed` 事件

### Ports Contract (`src/ports.ts`)

领域端口接口与记录类型（模块文档 L1-L8 说明 domain 仅依赖这些端口）：

- `SessionCheckoutSessionRecord` (L21-L26)：`id: string`, `projectId?: string`, `title?: string`。
- `SessionCheckoutProjectRecord` (L28-L32)：`id: string`, `name: string`, `root: string`。
- `SidebarDirectoryMembership` (L34-L38)：`managedRoot: string`, `workspaceIds: string[]`, `sessionIds: string[]`。
- `SessionCheckoutLookupPort` (L40-L60)：方法 `getSidebarMemberships?`, `getSession`, `getProject`, `getSessionCwd?`, `listLiveSessions?`。
- `GitCheckoutSnapshot` (L62-L69)：`root`, `commonDir`, `gitDir`, `branch: string | null`, `headOid`, `headRef`。
- `BranchOverviewEntry` (L71-L77)：`name`, `oid`, `isCurrent`, `upstream: string | null`。
- `TagOverviewEntry` (L79-L90)：`name`, `oid`, `commitOid: string | null`, `annotated`, `message: string | null`, `pushed: boolean | null`。
- `GraphLogCommit` (L92-L101)：`oid`, `parents: string[]`, `author`, `authorTime: number`, `refs: string[]`, `subject`。
- `InitialCommitPreflight` (L103-L107)：`kind: 'ready' | 'empty' | 'files'`, `fingerprint`, `snapshot`。
- `SessionCheckoutGitPort` (L109-L230)：全部 Git 方法契约，含可选 `preflightInitialCommit`/`initializeEmptyRepository`/`initializeProject` (L111-L114)、`attachWorktreeBranch` (L131)、`pushBranch` (L148)、`mergeLocalBranch` (L189)、`captureLocalWip` (L217)、`snapshotAbandonedWorktree` (L227) 等本地适配方法。
- `DirectoryIdentity` (L232-L236)：`device`, `inode`, `birthtimeNs`。
- `SessionCheckoutFilesPort` (L238-L255)：`exists`, `canonicalize`, `inspectDirectoryIdentity`, `ensureDirectory`, `removeEmptyDirectoryTree`, `quarantineDirectoryTree`, `removeDirectoryTree`, `measureDirectoryBytes`, 可选 `readTextFile`/`copyFile`/`isSymbolicLink`。
- `SessionBindingRecord` (L257-L267)：`sessionId`, `projectId`, `projectName`, `target`, `ownerSessionId`, `inheritedFromSessionId?`, `sourceRef`, `sourceOid`, `revision`。
- `WorktreeCreationEvidence` (L274-L286)：`root`, `rootIdentity`, `parentIdentity`, `commonDir`, `commonIdentity`, `lockReason`, 可选 `gitDir`/`gitIdentity`/`metadataFingerprint`/`indexFingerprint`/`quarantinePath`。
- `ManagedCheckoutRecord` (L487-L540)：含 `checkoutId`, `predecessorCheckoutId?`, `projectId`, `projectName`, `ownerSessionId`, `sourceSessionId?`, `localRoot`, `managedRoot`, `managedGitRoot`, `gitCommonDir`, `gitDir`, `baseOid`, `applyBaseOid?`, `previousReview?`, `checkpoints?`, `recoveryContinuation?`, `abandonedSnapshotOid?`, `abandonedSnapshotAt?`, `permanent?`, `sidebarBadgeClearedRevision?`, `sourceRef`, `sessionBranch?`, `sessionTopic?`, `phase`, `delivery`, `journal`, `revision`。
- `ManagedCheckoutsRegistry` (L542-L547)：`version: 2`, `revision`, `sessionBindings`, `managedCheckouts`。
- `SessionCheckoutRegistryPort` (L549-L552)：`read()`, `write()`。
- `LiveValue<T>` (L555-L557) 与 `liveConfigValue<T>(value)` (L560-L565)：读普通值或 live 引用的 `.get()`。
- `SessionCheckoutDependencies` (L567-L607)：聚合 `lookup`/`git`/`files`/`registry`/`applyEngine`/`managedCheckoutsRoot`/`createCheckoutId` 及可选 live 配置 `autoPush`/`autoDeliver`/`worktreesRoot`/`inheritLocalChanges`/`worktreeKeepCount`/`branchRaceGuard`/`branchRaceWindowMs`。

### Tests (`tests/adapters-safe-file.test.ts`)

覆盖 `safe-file.ts` 行为（L1-L5 导入 `readJsonFileSafe`/`writeJsonFileAtomic`/`writeTextFileAtomic`）：
- `scratch()` L8-L12 建临时目录并登记清理
- `afterEach` L14-L16 递归删临时目录
- `describe('Safe JSON file persistence')` 内 test:
  - 最新 tmp 提升且清理残留 L19-L31（含 legacy 固定 `.tmp` 提升 L33-L40、无残留可解析返 null L42-L50）
  - 原子写留 `.bak` 且主文件损坏回退 L52-L64
  - `writeTextFileAtomic` 整体替换 L66-L73

## Architecture

```text
┌────────────────────────────────────────────────────────────────┐
│ Adapter Layer (src/adapters/)                                  │
│                                                                │
│  GitOpts: validateGitTimeouts/gitTimeoutMs (git-options.ts)    │
│  Git: createDshGitPort (git.ts) ──► runGit/ctx.subprocess      │
│  Files: createNodeFilesPort (files.ts) ──► CAS/quarantine      │
│  SafeFile: writeJsonFileAtomic/readJsonFileSafe (safe-file.ts) │
│  Registry: AtomicJsonCheckoutRegistry (registry.ts)           │
│  Lookup: createDshLookupPort (lookup.ts)                      │
│  Worktree: createWorktree (worktree-creation.ts)              │
│  InitCommit: initialCommitActions (initial-commit.ts)         │
│  Skills: ProjectSkillStore+IO+Provider (project-skills*.ts)   │
│                                                                │
│  Contract: SessionCheckoutDependencies (ports.ts)             │
└───────────────────────────────────┬────────────────────────────┘
                                    ▼
                       Session Checkout State Machine
```

## Data Flow

1. **Git Command Execution**:
   - Caller → `runGit(ctx, cwd, args, options, input?, creation?, collectBytes?)` (git.ts L93)。
   - `ctx.subprocess.spawn` 启动 git，注入安全环境变量与参数 (git.ts L101-L132)。
   - 若为 `GitCommitProtocol`，通过 stdin pipe 发送 `prepare`，轮询 `prepare: ok` 后执行 `beforeCommit()` 回调，最后发送 `commit\n` 或 `abort\n` (git.ts L133-L154)。
   - 若为 creation 模式，等待子进程树静默 (`settleCreationTree`) (git.ts L73, L157-L168)。
   - 返回 `GitCommandResult`，caller 决定非零退出码的处理策略 (`runGitChecked` 抛 `git_operation_failed` L190-L199)。

2. **Worktree Creation & Verification**:
   - `createDetachedWorktree` (git.ts L336) → `createWorktree` (worktree-creation.ts L17)。
   - Inspect commonDir/parent identity → mkdir(target) → inspect rootIdentity → `saveEvidence` (worktree-creation.ts L30-L43)。
   - `worktree add --detach --no-checkout --lock` → inspect gitDir/gitIdentity/metadataFingerprint → `saveEvidence` (L44-L49)。
   - `verifyIdentity` → sparse checkout 分支 `reset --hard` 或 `read-tree`+`checkout-index` → `unlock` (L51-L69)。
   - 失败时：根据 `claimed`/`registered`/`quiescent` 状态执行条件性 rmdir 或全链路 quarantine+rollback (L70-L123)。

3. **Registry Read/Write**:
   - `AtomicJsonCheckoutRegistry.read()` (registry.ts L400) → `readJsonFileSafe` (safe-file.ts L113)。
   - 主文件 → .tmp 提升 → .bak 回退 (safe-file.ts L117-L158)。
   - 校验 `isRegistry` → 迁移 v1→v2 (`migrateLegacyRegistry`) → 返回或抛 `registry_corrupt` (registry.ts L327-L410)。
   - `write()` (registry.ts L412) → `writeJsonFileAtomic` (safe-file.ts L82)，含 .bak 备份与唯一 tmp rename。

4. **Project Skills Carry**:
   - `createDetachedWorktree` 校验本地无 Skill 变更（diff `PROJECT_SKILL_ROOTS`）(git.ts L337-L340)。
   - `createWorktree` 完成后调用 `projectSkills.carry(skills, managedRoot)` (git.ts L347)。
   - `carry` 流程：冲突预检 → `manifest.phase='copying'` → mkdir/writeFile → verify → `manifest.phase='ready'` + atomic rename (project-skills.ts L125-L167)。
   - `removeWorktree` 调用 `projectSkills.assertRemovable` 校验无变更后 `worktree remove` 并 `forget` (git.ts L352-L358)。

5. **Lookup Service Adaptation**:
   - `createDshLookupPort` 动态获取 `ctx.get('workspaceRegistry')` 与 `ctx.get('sessions')` (lookup.ts L66-L72)。
   - `getSidebarMemberships` 并行查询 workspace list 与 session query headers，通过 `sameResolvedPath` 匹配 managedRoot (lookup.ts L76-L97)。
   - `getSession` 优先扫描 workspace sessionIds，fallback 到 live session header cwd (lookup.ts L123-L140)。

## Connections

- [[host-overview|Host Entry and Registration Surface]]：插件装配点，注入各 adapter 工厂。
- [[session-checkout-module|Session Checkout State Machine]]：主要消费方，通过 `SessionCheckoutDependencies` 接口调用。
- [[console-host|Console Host Control Plane]]：授权校验面，Lookup 仅提供导航证据（`getSessionCwd` 用于 owner 鉴权）。
- [[non-git-incremental-enablement|Non-Git Incremental Enablement]]：`initial-commit.ts` 支撑的非 Git 渐进增强功能。
- [[session-checkout-apply|Session Checkout Apply Pipeline]]：Project Skills snapshot/carry 与 `createDetachedWorktree` 在此流程中被调用。
- [[project-skills-carry|Project Skills Carry Lifecycle]]：`project-skills.ts`/`project-skill-io.ts`/`project-skill-provider.ts` 共同实现技能跨 worktree 携带。

## Known Issues

- **竞态保护复杂性**: `initial-commit.ts` 的 `initializeEmptyRepository` (L48-L100) 和 `project-skills.ts` 的 `carry` (L125-L167) 均依赖复杂的指纹校验和锁机制防止竞态。若指纹计算逻辑（如 `identity` L23-L27 或 `metadataFingerprint` worktree-creation.ts L162-L183）因文件系统元数据变化而失效，可能导致不必要的初始化拒绝或状态不一致。
- **Windows 兼容性**: `safe-file.ts` 中的 `renameAtomicWithRetry` (L30-L44) 和 `files.ts` 中的 `removeDirectoryTree` (L74-L86) 针对 Windows 文件句柄竞争实现了重试逻辑，但在极端高负载下仍可能失败，需监控重试次数上限（5 次 / 6 次）。
- **注册表迁移**: `registry.ts` 的 `migrateLegacyRegistry` (L339-L394) 将非终态 checkout 标记为 `recovery_required` (L366-L368)，这可能需要人工干预或额外的自动化恢复流程，否则这些 checkout 将处于挂起状态。
- **测试覆盖局限**: `tests/adapters-safe-file.test.ts` 仅验证 `safe-file.ts` 的读写恢复（L19-L73），其他适配器（如 git、registry 校验、worktree-creation 身份核验）缺乏单元测试，回归风险集中于集成环境。
- **符号链接跳过语义**: `files.ts` 的 `measureDirectoryBytes` (L16-L24) 与 `inspectDirectoryIdentity` (L37-L46) 对符号链接返回 0 或 null，若宿主机滥用符号链接绕过目录边界，quarantine CAS 可能无法覆盖（参见 `quarantineDirectoryTree` L52-L72 仅校验身份不解析链接目标）。