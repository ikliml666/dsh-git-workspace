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
tags:
  - adapters
  - git
  - registry
  - project-skills
---

## Overview

`src/adapters/` 模块将 DSH（DeepSeek Session Harness）宿主能力适配为领域端口（`SessionCheckoutDependencies`，定义于 `src/ports.ts`）。该层是插件与底层系统（Git、文件系统、Workspace Registry）之间的隔离带，确保状态机逻辑不直接依赖具体的运行时服务。装配点在插件的 `apply()` 方法（参见 [[host-overview|Host Entry and Registration Surface]]）；领域消费方主要为 [[session-checkout-module|Session Checkout State Machine]]。

核心职责包括：
1. **Git 操作抽象**：通过 `ctx.subprocess` 安全执行 Git 命令，处理超时、环境隔离与子进程树静默。
2. **文件原子性与安全性**：提供崩溃安全的 JSON 读写、目录身份核验（CAS）与 quarantine 机制。
3. **持久化注册表**：基于原子 JSON 文件的 checkout 状态管理，支持版本迁移与数据校验。
4. **上下文查找**：动态适配 Harness 的 Workspace 与会话查询服务。
5. **Worktree 创建保障**：严格的容器身份核验与失败回滚路径。
6. **Project Skills 携带**：在项目技能目录间同步文件，支持 snapshot/carry/forget 生命周期。

## Key Components

### Git Port (`src/adapters/git.ts`)

`createDshGitPort(ctx, options)` 构建并返回 `SessionCheckoutGitPort` 对象，混入初始提交相关方法。

#### 常量与配置
- `GIT_TERMINATION_GRACE_MS = 1_000` (git.ts:28): 终止宽限期。
- `GIT_COLLECT_BYTES = 1 << 20` (git.ts:30): 单流收集输出上限 (1MB)。
- `WIP_PATCH_COLLECT_BYTES = 16 << 20` (git.ts:32): WIP patch 收集上限 (16MB)。
- `GitPortOptions` (git.ts:37): 扩展 `GitTimeoutOptions`，包含 `hooksPath` 与 `projectSkills`。

#### 核心执行器
- `runGit(ctx, cwd, args, options, input?, creation?, collectBytes?)` (git.ts:77-172):
  - 通过 `ctx.subprocess.spawn` 启动 git。
  - 强制参数：`--no-pager`, `--no-optional-locks`, `-c core.quotePath=false`, `-c core.fsmonitor=false`, `-c core.hooksPath=<options.hooksPath>`。
  - Windows 自动注入 `-c core.longpaths=true` (git.ts:92)。
  - 环境变量清洗：仅保留 `GIT_*` 路由变量，设置 `GIT_OPTIONAL_LOCKS=0`, `GIT_TERMINAL_PROMPT=0`, `LC_ALL=C`, `LANG=C` (git.ts:103-113)。
  - 输入协议：支持 `string` 或 `GitCommitProtocol`（包含 `prepare` 字符串与 `beforeCommit` 回调，git.ts:117-138）。
  - Creation 模式：退出码 0 后调用 `settleCreationTree` 等待子进程树静默 (git.ts:139-153)。
  - 返回值 `GitCommandResult` 包含 `code`, `stdout`, `stderr`, `quiescent`。
- `runGitChecked(ctx, cwd, args, options)` (git.ts:174-183): `runGit` 的 throw 封装，非零退出码抛出 `SessionCheckoutError`。
- `settleCreationTree(handle)` (git.ts:57-70): 最多等待 10s 确保子进程树完全退出。
- `parseDecoration(decoration)` (git.ts:49-55): 解析 `%D` 装饰字符串，去除 `HEAD ->` 和 `tag: ` 前缀。

#### 内部引用命名空间
- `checkoutRefRoot(checkoutId)` (git.ts:185-188): 生成 `refs/dsh-worktree/session-checkouts/<sha256_prefix_24>`。
- `internalArtifactRef(checkoutId, artifactName)` (git.ts:190-198): 结合 root 与 artifact 名称，校验 artifact 格式。
- `abandonedSnapshotRef(checkoutId)` (git.ts:205-209): 生成 `refs/dsh-worktree/abandoned/<checkoutId>`，独立于 checkout namespace 以防 discard 流程误删。

#### Port 方法实现
- `inspect(root)` (git.ts:240-306):
  - 快径：单次 `rev-parse --show-toplevel --path-format=absolute --git-common-dir --absolute-git-dir HEAD^{commit}` + 并行 `symbolic-ref` (git.ts:243-248)。
  - 回退：处理 unborn/broken HEAD、换行路径歧义、not-a-repo 情况 (git.ts:250-306)。
- `findContainingWorktreeRoot(root)` (git.ts:307-314): `rev-parse --show-toplevel`。
- `status(root)` (git.ts:315-319): 集成 `ProjectSkillStore.scope`，从 porcelain status 中剔除携带技能目录内容后判断 dirty。
- `createDetachedWorktree(localRoot, managedRoot, baseOid, saveEvidence)` (git.ts:320-332):
  - 校验本地无 Skill tracked 变更 (git.ts:322-325)。
  - 调用 `createWorktree` (worktree-creation.ts) 创建 detached worktree (git.ts:326-330)。
  - 调用 `projectSkills.carry` 携带技能文件 (git.ts:331)。
- `removeWorktree(localRoot, managedRoot)` (git.ts:333-343):
  - 校验 Project Skills 可移除性 (git.ts:335-338)。
  - `worktree remove --force` (git.ts:340)。
  - `projectSkills.forget` (git.ts:341)。
- `pruneWorktrees(localRoot)` (git.ts:344-346): `worktree prune --expire now`。
- `retainApplyBase(localRoot, checkoutId, oid)` (git.ts:347-349): `update-ref` 保存 apply-base。
- `releaseApplyBase(localRoot, checkoutId)` (git.ts:350-352): `update-ref -d` 删除 apply-base。
- `retainInternalArtifact(localRoot, checkoutId, artifactName, oid)` (git.ts:353-355): `update-ref` 保存内部 artifact。
- `readInternalArtifact(localRoot, checkoutId, artifactName)` (git.ts:356-362): `rev-parse --verify --quiet`，返回 null 或 oid。
- `releaseInternalArtifacts(localRoot, checkoutId, artifactPrefix)` (git.ts:363-372):
  - `for-each-ref` 批量收集 refs。
  - 单次 `update-ref --stdin` 事务删除（start/delete.../commit），避免 1+N 串行开销 (git.ts:370-372)。
- `isAncestor(root, ancestorOid, descendantOid)` (git.ts:373-378): `merge-base --is-ancestor`。
- `listLocalBranches(root)` (git.ts:379-382): `for-each-ref --format=%(refname:short) refs/heads`。
- `resolveLocalBranchTip(root, branch)` (git.ts:383-388): `rev-parse --verify --quiet refs/heads/<branch>`。
- `pushBranch(root)` (git.ts:389-405):
  - `symbolic-ref` 取当前分支 → `rev-parse` 查 upstream → `push`。
  - 失败不 force，返回 `{ok: false, message}`。
- `repairWorktreeLinks(repoCommonDir, managedRoot)` (git.ts:406-411): `worktree repair` 重链 .git 指针。
- `listWorktreeincludeFiles(localRoot, includeFile)` (git.ts:412-431):
  - 计算 `ls-files --others --ignored --exclude-standard` 与 `--exclude-from=<includeFile>` 的交集 (git.ts:420-423)。
  - 自动带入 `AGENTS.override.md` (git.ts:427)。
- `branchOverview(root)` (git.ts:432-448): 并行 `for-each-ref` + `status`，返回 branches[] 与 dirtyCount。
- `branchTipTimes(root)` (git.ts:449-462): `for-each-ref` 获取 committerdate unix 时间戳。
- `deleteLocalBranch(root, name)` (git.ts:463-467): `branch -d <name>`，返回 deleted 状态与原因。
- `graphLog(root, limit)` (git.ts:468-490):
  - `log --branches --tags --remotes --topo-order --parents`，格式化输出 (git.ts:473-476)。
  - `limit` 钳制在 1-1000 之间 (git.ts:469)。
  - 解析 `%H%x00%P%x00%an%x00%at%x00%D%x00%s%x1e` 记录 (git.ts:480-488)。
- `createLocalBranch(root, name)` (git.ts:491-500): 先 `check-ref-format --branch` 再 `branch <name> HEAD`。
- `switchLocalBranch(root, branch)` (git.ts:501-512): `switch <branch>`，检测 worktree 冲突错误 (git.ts:506-509)。
- `mergeLocalBranch(root, source, options)` (git.ts:513-583):
  - `dryRun` 模式：创建临时 detached worktree (mkdtemp) 试合并，零改动触碰原 checkout (git.ts:528-553)。
  - 正式合并：`merge --no-ff --no-edit`，冲突不 abort，提取 conflictingFiles 与 conflictDetails (git.ts:556-572)。
  - 冲突详情限制：`CONFLICT_DETAIL_FILE_LIMIT` 与 `CONFLICT_DETAIL_DIFF_LIMIT` (git.ts:520-526)。
- `captureLocalWip(root)` (git.ts:584-592): `diff --binary --full-index HEAD`，空输出返回 null。
- `applyWorktreePatch(root, patch)` (git.ts:593-599): `apply --binary --whitespace=nowarn -` 原子应用。
- `listUntrackedFiles(root)` (git.ts:600-604): `ls-files --others --exclude-standard -z`。
- `snapshotAbandonedWorktree(localRoot, managedRoot, checkoutId)` (git.ts:605-625):
  - `add -A` + `write-tree` + `commit-tree` 以 `dsh-git-worktree` 身份固化快照 (git.ts:610-618)。
  - `update-ref` 保存到 `abandonedSnapshotRef` (git.ts:621)。
- `restoreAbandonedSnapshot(localRoot, checkoutId, snapshotOid)` (git.ts:626-634):
  - `branch worktree-restore-<oid_slice> <snapshotOid>` (git.ts:628)。
  - `update-ref -d` 删除 abandoned ref (git.ts:631)。

#### 初始提交混入 (`initialCommitActions`)
- `preflightInitialCommit(root)` (initial-commit.ts:29-47): 返回 `ready` | `files` | `empty` 三态及 fingerprint。
- `initializeEmptyRepository(root, fingerprint, assertAuthorized?)` (initial-commit.ts:48-99):
  - CAS 复核指纹 → 拿 `index.lock` → re-preflight → `var GIT_AUTHOR_IDENT` → `mktree` → `commit-tree` → `update-ref --stdin` CAS 写入 unborn HEAD (initial-commit.ts:60-93)。
- `initializeProject(root)` (initial-commit.ts:104-117):
  - 非 Git → `git init -b main` (initial-commit.ts:110)。
  - Unborn → `add -A` + `commit -m "Initial commit"` (initial-commit.ts:114-115)。

### Files Port (`src/adapters/files.ts`)

`createNodeFilesPort()` 返回 `SessionCheckoutFilesPort`。

- `measureDirectoryBytes(path)` (files.ts:16-24): 递归测量目录字节数，symlink 计 0。
- `removeEmptyDirectoryTree(path)` (files.ts:26-35): 同步递归删除空目录树。
- `inspectDirectoryIdentity(path)` (files.ts:37-46): 返回 `{device, inode, birthtimeNs}` (bigint to string)。
- `directoryIdentitiesEqual(left, right)` (files.ts:48-50): 比较三个 identity 字段。
- `quarantineDirectoryTree(path, expectedIdentity, quarantinePath)` (files.ts:52-72):
  - 同父目录 rename CAS。
  - 校验 quarantine 后的 identity 是否匹配，不匹配则尝试恢复并报错 (files.ts:64-68)。
- `removeDirectoryTree(path)` (files.ts:74-86): `rm` recursive，Windows maxRetries=6，其他 2。
- `existsSync`, `canonicalize`, `ensureDirectory`, `readTextFile`, `copyFile`, `isSymbolicLink`: 基础文件操作包装。

### Safe File Utilities (`src/adapters/safe-file.ts`)

崩溃安全的 JSON/文本文件读写，解决强制关机/崩溃导致的截断问题。

- `renameAtomicWithRetry(source, target, maxAttempts=5)` (safe-file.ts:30-44):
  - 针对 Windows 短暂句柄占用有限重试 (EBUSY/EPERM/EACCES/ENOTEMPTY)。
  - 使用 `sleepSync` 进行指数退避 (safe-file.ts:38)。
- `sleepSync(milliseconds)` (safe-file.ts:20-27): `Atomics.wait` + fallback 轮询。
- `tmpPathFor(filePath)` (safe-file.ts:50-52): 生成 `<file>.<pid>.<uuid>.tmp`，避免并发写者互踩。
- `listTmpFiles(filePath)` (safe-file.ts:55-68): 列出所有 tmp 残留（含旧版固定 `.tmp`），按 mtime 新→旧排序。
- `cleanupTmpFiles(filePath)` (safe-file.ts:70-76): 清理所有 tmp 残留。
- `writeJsonFileAtomic(filePath, data, skipBackup?)` (safe-file.ts:82-100):
  - 备份当前文件为 `.bak` (safe-file.ts:88-92)。
  - 写入唯一 tmp → `renameAtomicWithRetry` (safe-file.ts:95-98)。
- `writeTextFileAtomic(filePath, content)` (safe-file.ts:103-107): 同模式原子写文本文件。
- `readJsonFileSafe<T>(filePath)` (safe-file.ts:113-161):
  1. 尝试读取主文件 (safe-file.ts:116-122)。
  2. 检查 `.tmp` 残留，取最新可解析的提升并重命名为主文件 (safe-file.ts:125-134)。
  3. Fallback 到 `.bak`，恢复主文件 (safe-file.ts:137-148)。
  4. 全部失败返回 null。

### Registry (`src/adapters/registry.ts`)

`AtomicJsonCheckoutRegistry` 实现 `SessionCheckoutRegistryPort`，管理 `managed-checkouts.json`。

- `read()` (registry.ts:414-425):
  - `readJsonFileSafe` 读取 → `isRegistry` 校验。
  - 修复 oversized `suggestedCommitMessage` (registry.ts:418-420)。
  - 迁移 v1 → v2 (registry.ts:421-423)。
  - 文件不存在返回空 registry，损坏则抛 `SessionCheckoutError`。
- `write(registry)` (registry.ts:427-430): 确保目录存在 → `writeJsonFileAtomic`。
- 数据校验函数 (registry.ts:25-334):
  - `isRecord`, `isStringArray`, `isOid`, `isBoundedText`, `isSafeRelativePath`, `isTargetRef`, `isSessionBinding`, `isReview`, `isPreviousReview`, `isCheckpoint`, `isPreviewReceipt`, `isDeliveryProof`, `isDelivery`, `isJournal`, `isManagedCheckout`, `isRegistry`。
  - `isDelivery` 按 state 分多态校验：working, ready_for_review, preview_active, preview_detached, finalized, retained, delivered (registry.ts:185-225)。
  - `isJournal` 按 operation 分校验：create, apply, preview, checkpoint, rollback_preview, finish, finalize_preview, cleanup (registry.ts:227-270)。
- `repairOversizedPreviousReviewCommitMessage(value)` (registry.ts:336-355): 截断 >500 字符的 `suggestedCommitMessage`。
- `migrateLegacyRegistry(value)` (registry.ts:357-412): v1 → v2 保守迁移，非 ready/discarded phase 标记为 `recovery_required`。

### Lookup (`src/adapters/lookup.ts`)

`createDshLookupPort(ctx)` 适配 Harness 服务为 `SessionCheckoutLookupPort`。

- `getSidebarMemberships(managedRoots)` (lookup.ts:72-90):
  - 查询 `workspaceRegistry.list()` 与 `sessionQuery.listSessions()` headers。
  - 通过 `sameResolvedPath` 匹配 managedRoot 与 workspace/path/header.cwd (lookup.ts:80-88)。
- `getSession(sessionId)` (lookup.ts:92-103):
  - 扫描 `workspaceRegistry.list()` 的 sessionIds (lookup.ts:94-97)。
  - 若未找到，通过 `sessions().get(sessionId)?.header?.cwd` 恢复映射 (lookup.ts:99-102)。
- `getProject(projectId)` (lookup.ts:105-110): `workspaceRegistry.get(projectId)` 映射为 `{id, name, root}`。
- `sameResolvedPath(left, right)` (lookup.ts:55-61): 处理 Win32 大小写不敏感的路径比较。

### Worktree Creation (`src/adapters/worktree-creation.ts`)

`createWorktree(localRoot, target, baseOid, run, saveEvidence)` 提供严格的容器身份核验与失败回滚。

- **阶段 ① 创建与验证**:
  1. Inspect `commonDir` & `parent` identity (worktree-creation.ts:45-49)。
  2. `mkdir(target)` claimed (worktree-creation.ts:51)。
  3. Inspect `rootIdentity` → `saveEvidence` (worktree-creation.ts:53-55)。
  4. `worktree add --detach --no-checkout --lock --reason` (worktree-creation.ts:57)。
  5. Inspect `gitDir` & `gitIdentity` & `metadataFingerprint` → `saveEvidence` (worktree-creation.ts:59-62)。
  6. `verifyIdentity(evidence, baseOid)` (worktree-creation.ts:63)。
  7. Sparse checkout 分支：`reset --hard` 或 `read-tree` + `checkout-index` (worktree-creation.ts:65-78)。
  8. `verifyIdentity` & `unlock` (worktree-creation.ts:79-80)。
- **阶段 ② 失败处理**:
  - `claimed=false`: 抛 `WorktreeCreationFailure.rolledBack` (worktree-creation.ts:84)。
  - `registered=false`: 条件性 `rmdir`（验证 clean 且 identity 未变）(worktree-creation.ts:86-102)。
  - `registered=true`: 全链路 rollback：
    - `verifyIdentity` → `verifyRollbackMetadata` → `verifyUnmodified` (worktree-creation.ts:106-108)。
    - `worktree move --force` 至 quarantine path (worktree-creation.ts:112)。
    - 再次 verify → `worktree remove --force` (worktree-creation.ts:119-121)。
- `verifyIdentity(e, baseOid)` (worktree-creation.ts:125-148): 检查 root/parent/common/gitDir identity、`.git` pointer、`commondir`、`HEAD`、`locked` 文件、无 `.lock` 残留。
- `verifyRollbackMetadata(e, baseOid)` (worktree-creation.ts:150-160): 检查 `metadataFingerprint`、`indexFingerprint`、`ORIG_HEAD`。
- `metadataFingerprint(gitDir)` (worktree-creation.ts:162-183): SHA-256 哈希遍历 gitDir，排除 `index`, `gitdir`, `ORIG_HEAD`。
- `verifyUnmodified(root, baseOid, run)` (worktree-creation.ts:185-250):
  - 检查 index 条目 hash、submodule 残留、conversion filters、unknown contents (worktree-creation.ts:193-248)。
  - 检查 staged/untracked/changed 状态 (worktree-creation.ts:243-248)。

### Initial Commit (`src/adapters/initial-commit.ts`)

由 `initialCommitActions` 暴露的方法。

- `preflightInitialCommit(root)` (initial-commit.ts:29-47):
  - `ready`: 已有 commit。
  - `files`: 有文件或 index 条目。
  - `empty`: 无文件无 index，生成 fingerprint (initial-commit.ts:36-44)。
- `initializeEmptyRepository(root, fingerprint, assertAuthorized?)` (initial-commit.ts:48-99):
  - 见 Git Port 部分详细描述。
- `initializeProject(root)` (initial-commit.ts:104-117):
  - 见 Git Port 部分详细描述。

### Project Skills (`src/adapters/project-skills.ts`, `project-skill-io.ts`, `project-skill-provider.ts`)

- `ProjectSkillStore(directory)` (project-skills.ts):
  - `snapshot(localRoot)` (project-skills.ts:104-107): 扫描 `PROJECT_SKILL_ROOTS` 生成 `SkillSnapshot`。
  - `carry(skills, managedRoot)` (project-skills.ts:125-167): 写前校验 → `manifest.phase='copying'` → mkdir/writeFile → verify → `manifest.phase='ready'` + atomic rename。
  - `scope(root)` (project-skills.ts:168-171): 加载 manifest 返回 paths。
  - `state(managedRoot)` (project-skills.ts:173-203): 对比 manifest 与实际文件系统算 modified/fingerprint。
  - `assertRemovable(managedRoot, trackedPaths)` (project-skills.ts:204-212): 移除前校验无变更。
  - `forget(managedRoot)` (project-skills.ts:213): 删除 manifest。
- `hasDeliverableStatus(output, carriedPaths, carriedDirs)` (project-skills.ts:225-235): 从 status porcelain 中剔除携带技能后判断 dirty。
- `trackedSkillPaths(lsFilesStage, lsTreeHead)` (project-skills.ts): 计算 tracked skill 路径供 review-diff 剔除。
- `load(manifest)` (project-skills.ts:108-124): 校验 manifest version/root/identity/phase/files/directories。
- `ProjectSkillIO` (project-skill-io.ts): 技能文件读写原语，`checkRoot/checkPath` 验证身份与安全，`boundedRead` 限长读取，`createSkillDirectories/createSkillFiles` 原子创建。
- `ClaudeProjectSkillProvider` (project-skill-provider.ts:48-118): 封装 `FileSystemSkillProvider` 实例池（≤32），list/get 经过安全校验后注入 `provider=NAME/source='project-claude'/rank=250`。
- `mountProjectSkillProvider(ctx, registry)` (project-skill-provider.ts:121-133): 注册 skills provider + fs/observed 转发 + dispose effect。
- `managedSkillRoot(cwd, registry)` (project-skill-provider.ts:22-45): 遍历 `registry.managedCheckouts[phase==='ready']` 匹配 cwd 子目录并验证 `.git` 指针双向链接。

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
                           │ SessionCheckoutDependencies (ports.ts:465)
                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                   Session Checkout State Machine                            │
│                   ([[session-checkout-module]])                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Data Flow

1. **Git Command Execution**:
   - Caller → `runGit(ctx, cwd, args, options, input?, creation?)` (git.ts:77)。
   - `ctx.subprocess.spawn` 启动 git，注入安全环境变量与参数 (git.ts:88-113)。
   - 若为 `GitCommitProtocol`，通过 stdin pipe 发送 `prepare`，等待 `prepare: ok` 后执行 `beforeCommit` 回调，最后发送 `commit\n` 或 `abort\n` (git.ts:117-138)。
   - 若为 creation 模式，等待子进程树静默 (`settleCreationTree`) (git.ts:139-153)。
   - 返回 `GitCommandResult`，caller 决定非零退出码的处理策略 (git.ts:155-172)。

2. **Worktree Creation & Verification**:
   - `createDetachedWorktree` (git.ts:320) → `createWorktree` (worktree-creation.ts:32)。
   - Inspect commonDir/parent identity → mkdir(target) → inspect rootIdentity → `saveEvidence` (worktree-creation.ts:45-55)。
   - `worktree add --detach --no-checkout --lock` → inspect gitDir/gitIdentity/metadataFingerprint → `saveEvidence` (worktree-creation.ts:57-62)。
   - `verifyIdentity` → sparse checkout handling → `checkout-index` → `unlock` (worktree-creation.ts:63-80)。
   - 失败时：根据 `claimed`/`registered` 状态执行 rolledBack、条件性 rmdir 或全链路 quarantine+rollback (worktree-creation.ts:84-123)。

3. **Registry Read/Write**:
   - `AtomicJsonCheckoutRegistry.read()` (registry.ts:414) → `readJsonFileSafe` (safe-file.ts:113)。
   - 主文件 → .tmp 提升 → .bak 回退 (safe-file.ts:116-148)。
   - 校验 `isRegistry` → 修复 oversized message → 迁移 v1→v2 → 返回或抛错 (registry.ts:415-424)。
   - `write()` (registry.ts:427) → `writeJsonFileAtomic` (safe-file.ts:82)，含 .bak 备份与唯一 tmp rename。

4. **Project Skills Carry**:
   - `createDetachedWorktree` 校验本地无 Skill 变更 (git.ts:322-325)。
   - `createWorktree` 完成后调用 `projectSkills.carry(skills, managedRoot)` (git.ts:331)。
   - `carry` 流程：校验冲突 → `manifest.phase='copying'` → mkdir/writeFile → verify → `manifest.phase='ready'` + atomic rename (project-skills.ts:125-167)。
   - `removeWorktree` 调用 `projectSkills.assertRemovable` 校验无变更后 `worktree remove` (git.ts:335-341)。

5. **Lookup Service Adaptation**:
   - `createDshLookupPort` 动态获取 `ctx.get('workspaceRegistry')` 与 `ctx.get('sessions')` (lookup.ts:66-70)。
   - `getSidebarMemberships` 并行查询 workspace list 与 session query headers，通过 `sameResolvedPath` 匹配 managedRoot (lookup.ts:72-90)。
   - `getSession` 优先扫描 workspace sessionIds，fallback 到 live session header cwd (lookup.ts:92-103)。

## Connections

- [[host-overview|Host Entry and Registration Surface]]: 插件装配点。
- [[session-checkout-module|Session Checkout State Machine]]: 主要消费方，通过 `SessionCheckoutDependencies` 接口调用。
- [[console-host|Console Host Control Plane]]: 授权校验面，Lookup 仅提供导航证据。
- [[non-git-incremental-enablement|Non-Git Incremental Enablement]]: initial-commit.ts 支撑的非 Git 渐进增强功能。
- [[session-checkout-apply|Session Checkout Apply Pipeline]]: Project Skills snapshot/carry 在此流程中被调用。