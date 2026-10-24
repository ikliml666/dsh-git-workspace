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
1. **Git 操作抽象**：通过 `ctx.subprocess` 安全执行 Git 命令，处理超时、环境隔离与子进程树静默（`src/adapters/git.ts`）。
2. **文件原子性与安全性**：提供崩溃安全的 JSON 读写、目录身份核验（CAS）与 quarantine 机制（`src/adapters/files.ts`、`src/adapters/safe-file.ts`）。
3. **持久化注册表**：基于原子 JSON 文件的 checkout 状态管理，支持版本迁移与数据校验（`src/adapters/registry.ts`）。
4. **上下文查找**：动态适配 Harness 的 Workspace 与会话查询服务（`src/adapters/lookup.ts`）。
5. **Worktree 创建保障**：严格的容器身份核验与失败回滚路径（`src/adapters/worktree-creation.ts`）。
6. **Project Skills 携带**：在项目技能目录间同步文件，支持 snapshot/carry/forget 生命周期（`src/adapters/project-skills.ts`、`project-skill-io.ts`、`project-skill-provider.ts`）。

## Key Components

### Git Port (`src/adapters/git.ts`)

`createDshGitPort(ctx, options)` (git.ts L242-L674) 构建并返回 `SessionCheckoutGitPort` 对象，最后混入 `initialCommitActions` 返回的方法 (git.ts L674)。

#### 常量与配置
- `GIT_TERMINATION_GRACE_MS = 1_000` (git.ts L38): 终止宽限期。
- `GIT_COLLECT_BYTES = 1 << 20` (git.ts L40): 单流收集输出上限 (1MB)。
- `WIP_PATCH_COLLECT_BYTES = 16 << 20` (git.ts L42): WIP patch 收集上限 (16MB)，应对 base85 膨胀。
- `GitPortOptions` 接口 (git.ts L44-L48): 继承 `GitTimeoutOptions`，含 `hooksPath: string` 与可选 `projectSkills?: ProjectSkillStore`。
- 超时默认值来自 `git-options.ts`：`DEFAULT_GIT_TIMEOUT_MS = 120_000` (git-options.ts L8)，`DEFAULT_WORKTREE_ADD_TIMEOUT_MS = 5 * 60_000` (git-options.ts L9)。

#### 内部辅助函数与接口
- `GitCommandResult` 接口 (git.ts L50-L56): 字段 `code: number`, `stdout: string`, `stderr: string`, `quiescent?: boolean`。
- `parseDecoration(decoration)` (git.ts L59-L64): 解析 `%D` 装饰字符串，去除 `HEAD -> ` 与 `tag: ` 前缀。
- `settleCreationTree(handle)` (git.ts L66-L79): 最多等待 10s 确保子进程树完全退出，返回 boolean。
- `runGit(ctx, cwd, args, options, input?, creation?, collectBytes?)` (git.ts L86-L181): 底层执行器。构建 argv 包含 `--no-pager`, `--no-optional-locks`, Windows 下 `core.longpaths=true`, `core.quotePath=false`, `core.fsmonitor=false`, `core.hooksPath=${options.hooksPath}` (git.ts L95-L104)；环境变量清除敏感 GIT_* 覆盖并强制 `GIT_OPTIONAL_LOCKS=0`, `GIT_TERMINAL_PROMPT=0`, `LC_ALL=C`, `LANG=C` (git.ts L114-L124)。支持 `input` 为字符串或 `GitCommitProtocol` (git.ts L126-L147)。creation 模式等待树静默 (git.ts L150-L161)。
- `runGitChecked(...)` (git.ts L183-L192): 包装 `runGit`，非零退出抛 `SessionCheckoutError`。
- `checkoutRefRoot(checkoutId)` (git.ts L194-L197): 生成 `refs/dsh-worktree/session-checkouts/<sha256前24字符>`。
- `assertArtifactName(artifactName)` (git.ts L199-L207): 校验片段符合 `^[A-Za-z0-9][A-Za-z0-9._-]*$`。
- `internalArtifactRef(checkoutId, artifactName)` (git.ts L209-L212): 组合 ref 路径。
- `applyBaseRef(checkoutId)` (git.ts L214-L216): 返回 `internalArtifactRef(checkoutId, 'apply-base')`。
- `abandonedSnapshotRef(checkoutId)` (git.ts L223-L226): 返回 `refs/dsh-worktree/abandoned/${checkoutId}`，调用 `assertArtifactName(checkoutId)`。
- `hasGitMetadata(root)` (git.ts L228-L239): 向上遍历查找 `.git` 元数据。

#### Port 方法实现（对象字面量 L248-L673）
- `inspect(root)` (git.ts L249-L315): 快径单次 `rev-parse` 取四行，回退处理 unborn/broken HEAD。
- `findContainingWorktreeRoot(root)` (git.ts L316-L323): `rev-parse --show-toplevel`。
- `status(root)` (git.ts L324-L328): `status --porcelain=v1 -z --untracked-files=all`，结合 `ProjectSkillStore.scope` 过滤。
- `createDetachedWorktree(localRoot, managedRoot, baseOid, saveEvidence)` (git.ts L329-L341): 校验技能变更后调 `createWorktree` 并 `carry`。
- `removeWorktree(localRoot, managedRoot)` (git.ts L342-L352): 校验技能可移除性后强制移除并 `forget`。
- `pruneWorktrees(localRoot)` (git.ts L353-L355): `worktree prune --expire now`。
- `retainApplyBase(localRoot, checkoutId, oid)` (git.ts L356-L358): `update-ref applyBaseRef oid`。
- `releaseApplyBase(localRoot, checkoutId)` (git.ts L359-L361): `update-ref -d applyBaseRef`。
- `retainInternalArtifact(localRoot, checkoutId, artifactName, oid)` (git.ts L362-L364)
- `readInternalArtifact(localRoot, checkoutId, artifactName)` (git.ts L365-L370)
- `releaseInternalArtifacts(localRoot, checkoutId, artifactPrefix?)` (git.ts L371-L381): 批量 `update-ref --stdin` 事务删除。
- `isAncestor(root, ancestorOid, descendantOid)` (git.ts L382-L387): `merge-base --is-ancestor`。
- `listLocalBranches(root)` (git.ts L388-L391)
- `resolveLocalBranchTip(root, branch)` (git.ts L392-L397)
- `attachWorktreeBranch(managedRoot, branchRef, headOid, expectedOldOid?)` (git.ts L398-L418): 仅更新 ref/HEAD，CAS 语义。
- `pushBranch(root)` (git.ts L419-L435): 推送到上游，无分支/上游则返回 `{ok:false, message}`。
- `repairWorktreeLinks(repoCommonDir, managedRoot)` (git.ts L436-L441): `worktree repair`。
- `listWorktreeincludeFiles(localRoot, includeFile)` (git.ts L442-L461): 交集忽略文件与 `.worktreeinclude` 匹配，自动带入 `AGENTS.override.md`。
- `branchOverview(root)` (git.ts L462-L478)
- `defaultBranch(root)` (git.ts L479-L486): 从 `origin/HEAD` 或 `init.defaultBranch` 解析。
- `branchTipTimes(root)` (git.ts L487-L500)
- `deleteLocalBranch(root, name)` (git.ts L501-L505)
- `graphLog(root, limit)` (git.ts L506-L528): 解析 `%H%x00%P...` 记录。
- `createLocalBranch(root, name)` (git.ts L529-L538)
- `switchLocalBranch(root, branch)` (git.ts L539-L550): 处理 worktree 占用错误。
- `mergeLocalBranch(root, source, options?)` (git.ts L551-L621): 支持 `dryRun` 临时 detached probe (git.ts L588-L610)，正式合并保留冲突 (git.ts L612-L621)。
- `captureLocalWip(root)` (git.ts L622-L630): `diff --binary HEAD` 收集上限 `WIP_PATCH_COLLECT_BYTES`。
- `applyWorktreePatch(root, patch)` (git.ts L631-L637): `apply --binary`。
- `listUntrackedFiles(root)` (git.ts L638-L642)
- `snapshotAbandonedWorktree(localRoot, managedRoot, checkoutId)` (git.ts L643-L663): `add -A` + `write-tree` + `commit-tree` 固定身份。
- `restoreAbandonedSnapshot(localRoot, checkoutId, snapshotOid)` (git.ts L664-L672): 创建分支并删除 abandoned ref。

### Files Port (`src/adapters/files.ts`)

`createNodeFilesPort()` (files.ts L89-L108) 返回 `SessionCheckoutFilesPort`。

辅助函数：
- `measureDirectoryBytes(path)` (files.ts L16-L24): 递归计算字节，忽略符号链接。
- `removeEmptyDirectoryTree(path)` (files.ts L26-L35): 同步删空目录树。
- `inspectDirectoryIdentity(path)` (files.ts L37-L46): 返回 `{device, inode, birthtimeNs}` 或 null。
- `directoryIdentitiesEqual(left, right)` (files.ts L48-L50)
- `quarantineDirectoryTree(path, expectedIdentity, quarantinePath)` (files.ts L52-L72): 同父目录原子 rename 并校验身份。
- `removeDirectoryTree(path)` (files.ts L74-L86): 异步递归删，Windows 重试 6 次。

端口方法（L91-L107）：
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

- `RETRYABLE_RENAME_CODES` (safe-file.ts L14-L18): Windows 含 EBUSY/EPERM/EACCES/ENOTEMPTY，其他含 EBUSY/ENOTEMPTY。
- `sleepSync(milliseconds)` (safe-file.ts L20-L27): 用 `Atomics.wait` 或回退忙等。
- `renameAtomicWithRetry(source, target, maxAttempts=5)` (safe-file.ts L30-L44): 可重试原子重命名。
- `tmpPathFor(filePath)` (safe-file.ts L50-L52): `<file>.<pid>.<uuid>.tmp` 唯一名。
- `listTmpFiles(filePath)` (safe-file.ts L55-L68): 列出 `.tmp` 残留按 mtime 新→旧。
- `cleanupTmpFiles(filePath)` (safe-file.ts L70-L74): 删除所有 `.tmp`。
- `writeJsonFileAtomic(filePath, data, skipBackup=false)` (safe-file.ts L82-L100): 写唯一 tmp → 可选 `.bak` 备份 → 原子 rename。
- `writeTextFileAtomic(filePath, content)` (safe-file.ts L103-L107): 同上用于文本。
- `readJsonFileSafe<T>(filePath)` (safe-file.ts L113-L161): 主文件 → 最新可解析 `.tmp` 提升 → `.bak` 回退，全失败返 null。

### Registry (`src/adapters/registry.ts`)

`AtomicJsonCheckoutRegistry` 实现 `SessionCheckoutRegistryPort`，管理 `managed-checkouts.json`。

- `emptyRegistry()` (registry.ts L17-L24): 返回 `{version:2, revision:0, sessionBindings:{}, managedCheckouts:{}}`。
- 类型守卫（全部私有函数）：
  - `isRecord` L26-L28, `isStringArray` L30-L32, `isOid` L34-L36, `isBoundedText` L38-L40, `isSafeRelativePath` L42-L46
  - `isTargetRef` L48-L53, `isSessionBinding` L55-L65, `isReview` L67-L85, `isPreviousReview` L87-L95, `isCheckpoint` L97-L114, `isPreviewReceipt` L116-L136, `isDeliveryProof` L138-L150, `isDelivery` L152-L191, `isJournal` L193-L250
  - `safeRecoveryString` L252-L254, `safeRecoveryRevision` L256-L258, `safeConflictFile` L260-L264, `isRecoveryContinuation` L266-L290, `isManagedCheckout` L292-L325, `isRegistry` L327-L337
- `migrateLegacyRegistry(value)` (registry.ts L339-L394): v1→v2，非 ready/discarded 阶段标记 `recovery_required`，delivery 置 `{state:'working', iteration:1}`。
- 类 `AtomicJsonCheckoutRegistry` (registry.ts L397-L415):
  - `constructor(private readonly path: string)` L398
  - `read()` L400-L410: `readJsonFileSafe` → `isRegistry` 校验 → 尝试迁移 → 不存在返空 → 损坏抛 `SessionCheckoutError('registry_corrupt')`。
  - `write(registry)` L412-L415: `mkdirSync` + `writeJsonFileAtomic`。

### Lookup (`src/adapters/lookup.ts`)

`createDshLookupPort(ctx)` (lookup.ts L64-L121) 适配 Harness 服务为 `SessionCheckoutLookupPort`。

- 接口 `WorkspaceLike` L19-L24, `WorkspaceRegistryLike` L26-L32, `LiveSessionLike` L34-L36, `SessionStoreLike` L38-L40。
- `isWorkspaceRegistryLike` L42-L47, `isSessionStoreLike` L49-L53, `sameResolvedPath` L55-L61。
- `getSidebarMemberships(managedRoots)` L75-L96: 结合 `registry()?.list()` 与 `sessionQuery.listSessions()` 头 cwd 匹配。
- `getSession(sessionId)` L97-L114: 先扫 workspace sessionIds，未果则用 `sessions().get(sessionId).header.cwd` 恢复。
- `getProject(projectId)` L115-L120: 返回 `{id, name:title, root:path}`。

### Worktree Creation (`src/adapters/worktree-creation.ts`)

`createWorktree(localRoot, target, baseOid, run, saveEvidence?)` (worktree-creation.ts L17-L124) 严格身份核验与回滚。

- 阶段①（L29-L69）：验 commonDir/parent 身份 → `mkdir` claimed → 存 evidence → `worktree add --detach --no-checkout --lock` → 验 gitDir 身份与 metadataFingerprint → `verifyIdentity` → sparse 分支 `reset --hard` 或 `read-tree`+`checkout-index` → 再 `verifyIdentity` → `unlock`。
- 阶段②失败处理（L70-L123）：
  - `!claimed` → `WorktreeCreationFailure(message, true)` L72
  - `claimed && !registered && quiescent` → 条件性 `rmdir` L74-L87
  - `registered && quiescent` → 全链路 rollback：verify → `worktree move --force` 至 quarantine → `worktree remove --force` L94-L120
- `verifyIdentity(e, baseOid)` L126-L148: 检查 root/parent/common/gitDir 身份、`.git` 指针、`commondir`、`HEAD`、`locked`、无 `.lock`。
- `verifyRollbackMetadata(e, baseOid)` L150-L160: 校验 `metadataFingerprint`、`indexFingerprint`、`ORIG_HEAD`。
- `metadataFingerprint(gitDir)` L162-L183: SHA-256 遍历 gitDir，排除 index/gitdir/ORIG_HEAD。
- `verifyUnmodified(root, baseOid, run)` L185-L250: 校验 index 条目 hash、submodule、filters、unknown contents、staged/untracked/changed。

### Initial Commit (`src/adapters/initial-commit.ts`)

`GitCommitProtocol` 接口 (initial-commit.ts L8-L9): `{ prepare: string; beforeCommit(): Promise<void> }`。

`initialCommitActions(inspect, run)` (initial-commit.ts L13-L118) 返回 `{ preflightInitialCommit, initializeEmptyRepository, initializeProject }`。
- `checked` L15-L19
- `identity` L20-L24
- `indexBytes` L25-L28
- `preflightInitialCommit(root)` L29-L47: 返回 `ready`/`files`/`empty`(带 fingerprint)
- `initializeEmptyRepository(root, fingerprint, assertAuthorized?)` L48-L100: 拿 `index.lock` → CAS 复核 → `mktree`+`commit-tree` → `update-ref --stdin` 事务
- `initializeProject(root)` L104-L117: 非 Git 则 `init -b main`，unborn 则 `add -A` + `commit`

### Project Skills (`src/adapters/project-skills.ts`, `project-skill-io.ts`, `project-skill-provider.ts`)

`PROJECT_SKILL_ROOTS` (project-skills.ts L7): `['.dsh/skills', '.agents/skills', '.claude/skills']`。
`MAX_FILES = 5000` L8, `MAX_BYTES = 64*1024*1024` L9。
类型：
- `Entry` L10: `{path: string; hash: string; mode: number}`
- `Manifest` L11: `{version:1; root:string; identity:string; phase:'copying'|'ready'; files:Entry[]; directories?:string[]}`
- `SkillSnapshot` L12: `{directories?:string[]; files: Array<Entry & {content: Buffer}>}`
- `CarriedSkillState` L13: `{paths:string[]; fingerprint:string; modified:boolean}`

函数：
- `digest` L14, `missing` L15, `failure` L16
- `safePath` L17-L22, `identity` L23-L27, `inspectPath` L29-L39, `boundedRead` L40-L58
- `assertSkillTree` L60-L70, `ownedSkillDirectories` L71-L73, `inventory` L74-L98
- `ProjectSkillStore` 类 L101-L214:
  - `constructor(directory)` L102
  - `file(root)` L103
  - `snapshot(source)` L104-L107
  - `load(root)` L108-L124 严格校验 Manifest
  - `carry(snapshot, target)` L125-L167 冲突预检+独占写 Manifest+原子替换
  - `scope(root)` L168-L171
  - `paths(root)` L172-L172
  - `state(root, tracked?)` L173-L203
  - `assertRemovable(root, tracked)` L204-L212
  - `forget(root)` L213-L214
- `trackedSkillPaths` L216-L223, `hasDeliverableStatus` L225-L235, `assertSkillPath` L237-L239

`project-skill-io.ts`:
- `SkillRead` L5, `SkillBytes` L6
- `checkRoot` L10-L15, `checkPath` L16-L36
- `readSkillFiles` L38-L64 批量读，每次 `checkRoot`+`checkPath`+`O_NOFOLLOW`+stat 比对
- `createSkillDirectories` L66-L73 通过 `.directory-check` 原子建目录
- `createSkillFiles` L75-L88 `O_CREAT|O_EXCL` 写文件

`project-skill-provider.ts`:
- `NAME = 'worktree-project-claude'` L10, `Locator` L11
- `candidatePath` L14-L19 兼容 DSH 0.1/0.2
- `managedSkillRoot(registry)` L22-L45 遍历 `managedCheckouts` phase==='ready' 验证 `.git` 双向链接
- `ClaudeProjectSkillProvider` 类 L48-L119:
  - 字段 `name` L49, `providers` Map L50, `operations` L51, `disposed` L52
  - `run` L53-L57 序列化操作
  - `constructor(ctx, control, resolveRoot)` L58-L59
  - `provider(root)` L60-L74 实例池≤32
  - `list` L75-L77 → `listNow` L78-L94 过滤 rank=250
  - `get` L95-L97 → `getNow` L98-L108
  - `observeHostMutation` L109-L111, `dispose` L112-L118
- `mountProjectSkillProvider(ctx, registry)` L121-L133 注册 provider 与 fs/observed 转发

### Tests (`tests/adapters-safe-file.test.ts`)

覆盖 `safe-file.ts` 行为：tmp 提升 (L19-L31)、legacy `.tmp` (L33-L40)、无残留返 null (L42-L50)、原子写与 `.bak` (L52-L64)、文本原子写 (L66-L73)。

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
   - Caller → `runGit(ctx, cwd, args, options, input?, creation?)` (git.ts L86)。
   - `ctx.subprocess.spawn` 启动 git，注入安全环境变量与参数 (git.ts L94-L125)。
   - 若为 `GitCommitProtocol`，通过 stdin pipe 发送 `prepare`，等待 `prepare: ok` 后执行 `beforeCommit` 回调，最后发送 `commit\n` 或 `abort\n` (git.ts L126-L146)。
   - 若为 creation 模式，等待子进程树静默 (`settleCreationTree`) (git.ts L66, L150-L161)。
   - 返回 `GitCommandResult`，caller 决定非零退出码的处理策略 (git.ts L183 `runGitChecked` 抛错)。

2. **Worktree Creation & Verification**:
   - `createDetachedWorktree` (git.ts L329) → `createWorktree` (worktree-creation.ts L17)。
   - Inspect commonDir/parent identity → mkdir(target) → inspect rootIdentity → `saveEvidence` (worktree-creation.ts L30-L43)。
   - `worktree add --detach --no-checkout --lock` → inspect gitDir/gitIdentity/metadataFingerprint → `saveEvidence` (L44-L49)。
   - `verifyIdentity` → sparse checkout handling → `checkout-index` → `unlock` (L51-L69)。
   - 失败时：根据 `claimed`/`registered` 状态执行 rolledBack、条件性 rmdir 或全链路 quarantine+rollback (L70-L123)。

3. **Registry Read/Write**:
   - `AtomicJsonCheckoutRegistry.read()` (registry.ts L400) → `readJsonFileSafe` (safe-file.ts L113)。
   - 主文件 → .tmp 提升 → .bak 回退 (safe-file.ts L113-L161)。
   - 校验 `isRegistry` → 迁移 v1→v2 → 返回或抛错 (registry.ts L327-L410)。
   - `write()` (registry.ts L412) → `writeJsonFileAtomic` (safe-file.ts L82)，含 .bak 备份与唯一 tmp rename。

4. **Project Skills Carry**:
   - `createDetachedWorktree` 校验本地无 Skill 变更 (git.ts L330-L333)。
   - `createWorktree` 完成后调用 `projectSkills.carry(skills, managedRoot)` (git.ts L340)。
   - `carry` 流程：校验冲突 → `manifest.phase='copying'` → mkdir/writeFile → verify → `manifest.phase='ready'` + atomic rename (project-skills.ts L125-L167)。
   - `removeWorktree` 调用 `projectSkills.assertRemovable` 校验无变更后 `worktree remove` (git.ts L345-L351)。

5. **Lookup Service Adaptation**:
   - `createDshLookupPort` 动态获取 `ctx.get('workspaceRegistry')` 与 `ctx.get('sessions')` (lookup.ts L65-L72)。
   - `getSidebarMemberships` 并行查询 workspace list 与 session query headers，通过 `sameResolvedPath` 匹配 managedRoot (lookup.ts L75-L96)。
   - `getSession` 优先扫描 workspace sessionIds，fallback 到 live session header cwd (lookup.ts L97-L114)。

## Connections

- [[host-overview|Host Entry and Registration Surface]]: 插件装配点。
- [[session-checkout-module|Session Checkout State Machine]]: 主要消费方，通过 `SessionCheckoutDependencies` 接口调用。
- [[console-host|Console Host Control Plane]]: 授权校验面，Lookup 仅提供导航证据。
- [[non-git-incremental-enablement|Non-Git Incremental Enablement]]: initial-commit.ts 支撑的非 Git 渐进增强功能。
- [[session-checkout-apply|Session Checkout Apply Pipeline]]: Project Skills snapshot/carry 在此流程中被调用。

## Known Issues

- **竞态保护复杂性**: `initial-commit.ts` 和 `project-skills.ts` 均依赖复杂的指纹校验和锁机制来防止竞态条件。若指纹计算逻辑（如 `identity` 或 `metadataFingerprint`）因文件系统元数据变化而失效，可能导致不必要的初始化拒绝或状态不一致。
- **Windows 兼容性**: `safe-file.ts` 中的 `renameAtomicWithRetry` (L30) 和 `files.ts` 中的 `removeDirectoryTree` (L74) 针对 Windows 文件句柄竞争实现了重试逻辑，但在极端高负载下仍可能失败，需监控重试次数上限。
- **注册表迁移**: `registry.ts` 的 `migrateLegacyRegistry` (L339) 将非终态 checkout 标记为 `recovery_required`，这可能需要人工干预或额外的自动化恢复流程，否则这些 checkout 将处于挂起状态。
- **测试覆盖局限**: `tests/adapters-safe-file.test.ts` 仅验证 `safe-file.ts` 的读写恢复，其他适配器（如 git、registry 校验）缺乏单元测试，回归风险集中于集成环境。