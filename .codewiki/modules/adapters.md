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

`src/adapters/` 模块是 DSH（DeepSeek Session Harness）插件的核心基础设施层，将宿主能力适配为领域端口（`SessionCheckoutDependencies`，定义于 `src/ports.ts`）。该层作为插件与底层系统（Git、文件系统、Workspace Registry）之间的隔离带，确保状态机逻辑不直接依赖具体的运行时服务。装配点在插件的 `apply()` 方法（参见 [[host-overview|Host Entry and Registration Surface]]）；领域消费方主要为 [[session-checkout-module|Session Checkout State Machine]]。

核心职责包括：
1. **Git 操作抽象**：通过 `ctx.subprocess` 安全执行 Git 命令，处理超时、环境隔离与子进程树静默。
2. **文件原子性与安全性**：提供崩溃安全的 JSON 读写、目录身份核验（CAS）与 quarantine 机制。
3. **持久化注册表**：基于原子 JSON 文件的 checkout 状态管理，支持版本迁移与数据校验。
4. **上下文查找**：动态适配 Harness 的 Workspace 与会话查询服务。
5. **Worktree 创建保障**：严格的容器身份核验与失败回滚路径。
6. **Project Skills 携带**：在项目技能目录间同步文件，支持 snapshot/carry/forget 生命周期。

## Key Components

### Git Port (`src/adapters/git.ts`)

`createDshGitPort(ctx, options)` (git.ts L97) 构建并返回 `SessionCheckoutGitPort` 对象，混入初始提交相关方法。

#### 常量与配置
- `GIT_TERMINATION_GRACE_MS = 1_000` (git.ts L39): 终止宽限期。
- `GIT_COLLECT_BYTES = 1 << 20` (git.ts L41): 单流收集输出上限 (1MB)。
- `WIP_PATCH_COLLECT_BYTES = 16 << 20` (git.ts L43): WIP patch 收集上限 (16MB)。
- `DEFAULT_GIT_TIMEOUT_MS = 120_000` (来自 `git-options.ts`, git.ts): 默认超时 2 分钟。
- `DEFAULT_WORKTREE_ADD_TIMEOUT_MS = 5 * 60_000` (来自 `git-options.ts`, git.ts): worktree add 超时 5 分钟。
- `GitPortOptions` (git.ts L48): 扩展 `GitTimeoutOptions`，包含 `hooksPath` 与 `projectSkills`。

#### 核心执行器
- `runGit(...)` (git.ts L65):
  - 底层执行器。处理超时、信号、输入管道（支持 `GitCommitProtocol`）、输出收集。
  - 关键逻辑：创建时等待 `quiescent` 状态 (git.ts L110-L122)。
  - 返回值 `GitCommandResult` 包含 `code`, `stdout`, `stderr`, `quiescent`。
- `runGitChecked(...)` (git.ts L126): 包装 `runGit`，非零退出码抛出 `SessionCheckoutError`。
- `settleCreationTree(handle)` (git.ts L52): 最多等待 10s 确保子进程树完全退出。
- `parseDecoration(decoration)` (git.ts L46): 解析 `%D` 装饰字符串，去除 `HEAD ->` 和 `tag: ` 前缀。

#### 内部引用命名空间
- `checkoutRefRoot(checkoutId)` (git.ts L128): 生成内部 Ref 根路径 `refs/dsh-worktree/session-checkouts/<hash>`。
- `internalArtifactRef(...)`, `applyBaseRef(...)`, `abandonedSnapshotRef(...)` (git.ts L133-L151): Ref 命名辅助函数。
- `hasGitMetadata(root)` (git.ts L153): 向上遍历查找 `.git`。

#### Port 方法实现
- `inspect(root)` (git.ts L163-L233):
  - 快径：单次 `rev-parse --show-toplevel --path-format=absolute --git-common-dir --absolute-git-dir HEAD^{commit}` + 并行 `symbolic-ref`。
  - 回退：处理 unborn/broken HEAD、换行路径歧义、not-a-repo 情况。
- `findContainingWorktreeRoot(root)` (git.ts L234): `rev-parse --show-toplevel`。
- `status(root)` (git.ts L242): 检查工作树脏状态，结合 `ProjectSkillStore` 过滤可交付文件。
- `createDetachedWorktree(...)` (git.ts L247):
  - 检查 Project Skills 变更，调用 `worktree-creation.ts` 中的逻辑，并携带 skills。
- `removeWorktree(...)` (git.ts L257):
  - 验证技能可移除性，强制移除，遗忘技能。
- `pruneWorktrees(...)` (git.ts L267): 清理过期工作树。
- `retain/releaseApplyBase(...)` (git.ts L270-L275): 管理应用基础 Ref。
- `retainInternalArtifact(...)`, `readInternalArtifact(...)`, `releaseInternalArtifacts(...)` (git.ts L277-L301): 管理内部工件 Ref。批量删除使用 `update-ref --stdin` 事务。
- `isAncestor(...)` (git.ts L303): 检查祖先关系。
- `listLocalBranches(...)` (git.ts L309): 列出本地分支并排序。
- `resolveLocalBranchTip(...)` (git.ts L314): 解析分支 Tip OID。
- `pushBranch(...)` (git.ts L321): 推送到上游。若无本地分支或上游则跳过。
- `repairWorktreeLinks(...)` (git.ts L336): 修复移动后的工作树链接。
- `listWorktreeincludeFiles(...)` (git.ts L342): 找出被忽略但匹配 `.worktreeinclude` 的文件，包含 `AGENTS.override.md`。
- `branchOverview(...)` (git.ts L360): 获取分支概览（名称、OID、是否当前、上游、脏计数）。
- `branchTipTimes(...)` (git.ts L377): 获取分支提交时间戳。
- `deleteLocalBranch(...)` (git.ts L393): 删除分支，返回成功与否及原因。
- `graphLog(...)` (git.ts L401): 获取图日志，格式化输出为对象数组。
- `createLocalBranch(...)` (git.ts L418): 创建新分支，校验格式。
- `switchLocalBranch(...)` (git.ts L427): 切换分支，处理已被其他工作树占用的错误。
- `mergeLocalBranch(...)` (git.ts L439): 合并分支。支持 `dryRun`（在临时探测工作树中试合并）。正式合并保留冲突状态供上层处理。
- `captureLocalWip(...)` (git.ts L486): 捕获未提交的 WIP 差异（二进制格式）。
- `applyWorktreePatch(...)` (git.ts L497): 应用补丁。
- `listUntrackedFiles(...)` (git.ts L507): 列出非忽略的未跟踪文件。
- `snapshotAbandonedWorktree(...)` (git.ts L512): 将废弃工作树内容快照为独立提交，保存 Ref。
- `restoreAbandonedSnapshot(...)` (git.ts L532): 从快照恢复，创建新分支。

#### 初始提交混入 (`initialCommitActions`)
- `preflightInitialCommit(root)` (initial-commit.ts): 返回 `ready` | `files` | `empty` 三态及 fingerprint。
- `initializeEmptyRepository(root, fingerprint, assertAuthorized?)` (initial-commit.ts):
  - CAS 复核指纹 → 拿 `index.lock` → re-preflight → `var GIT_AUTHOR_IDENT` → `mktree` → `commit-tree` → `update-ref --stdin` CAS 写入 unborn HEAD。
- `initializeProject(root)` (initial-commit.ts):
  - 非 Git → `git init -b main`。
  - Unborn → `add -A` + `commit -m "Initial commit"`。

### Files Port (`src/adapters/files.ts`)

`createNodeFilesPort()` (files.ts L65) 返回 `SessionCheckoutFilesPort`。

- `exists(path)` (files.ts L73): 同步存在性检查。
- `canonicalize(path)` (files.ts L74): 解析真实路径。
- `ensureDirectory(path)` (files.ts L75): 递归创建目录。
- `readTextFile(path)` (files.ts L76): 读取文本文件，不存在返回 null。
- `copyFile(from, to)` (files.ts L77): 复制文件，目标存在则强制删除。
- `isSymbolicLink(path)` (files.ts L78): 检查是否为符号链接。
- `measureDirectoryBytes(path)` (files.ts L16): 递归计算目录大小，忽略符号链接。
- `removeEmptyDirectoryTree(path)` (files.ts L24): 同步递归删除空目录树。
- `inspectDirectoryIdentity(path)` (files.ts L33): 获取目录的设备、inode、创建时间。
- `directoryIdentitiesEqual(...)` (files.ts L42): 比较两个身份。
- `quarantineDirectoryTree(path, expectedIdentity, quarantinePath)` (files.ts L33): 原子移动目录到隔离区。验证源和目标父目录相同，且目标不存在。若移动后身份不匹配或原路径仍存在，尝试回滚。
- `removeDirectoryTree(path)` (files.ts L50): 异步递归删除，Windows 下重试更多次。

### Safe File Utilities (`src/adapters/safe-file.ts`)

崩溃安全的 JSON/文本文件读写，解决强制关机/崩溃导致的截断问题。

- `renameAtomicWithRetry(source, target, maxAttempts)` (safe-file.ts L35): Windows 下处理文件句柄竞争的重试重命名。
- `writeJsonFileAtomic(filePath, data, skipBackup)` (safe-file.ts L76): 写入唯一命名的 tmp 文件，原子 rename。可选备份。
- `writeTextFileAtomic(filePath, content)` (safe-file.ts L99): 同上，用于非 JSON 文本。
- `readJsonFileSafe<T>(filePath)` (safe-file.ts L105): 安全读取。优先级：主文件 -> 最新可解析 .tmp -> .bak。失败返回 null。

### Registry (`src/adapters/registry.ts`)

`AtomicJsonCheckoutRegistry` 实现 `SessionCheckoutRegistryPort`，管理 `managed-checkouts.json`。

- `constructor(path)` (registry.ts): 注册表文件路径。
- `read()` (registry.ts L283): 读取并验证。若损坏，尝试修复过大的 commit message 或迁移 v1。若完全无法恢复则抛出错误。
- `write(registry)` (registry.ts L293): 原子写入。
- 验证函数（大量私有函数，确保数据结构完整性）(registry.ts L33-L263):
  - `isRecord`, `isStringArray`, `isOid`, `isBoundedText`, `isSafeRelativePath`。
  - `isTargetRef`, `isSessionBinding`, `isReview`, `isPreviousReview`, `isCheckpoint`, `isPreviewReceipt`, `isDeliveryProof`, `isDelivery`, `isJournal`, `isRecoveryContinuation`, `isManagedCheckout`, `isRegistry`。
- `repairOversizedPreviousReviewCommitMessage(value)` (registry.ts L243): 修复过长的 commit message。
- `migrateLegacyRegistry(value)` (registry.ts L265): 将 v1 注册表迁移到 v2，未知阶段标记为 `recovery_required`。

### Lookup (`src/adapters/lookup.ts`)

`createDshLookupPort(ctx)` (lookup.ts L55) 适配 Harness 服务为 `SessionCheckoutLookupPort`。

- `getSidebarMemberships(managedRoots)` (lookup.ts L60): 根据受管根目录查找关联的工作区和会话 ID。同时扫描工作区记录和活动会话头。
- `getSession(sessionId)` (lookup.ts L78): 查找会话的项目 ID。优先在工作区列表中查找，若找不到则尝试从活动会话头恢复 cwd 映射。
- `getProject(projectId)` (lookup.ts L91): 查找项目记录。

### Worktree Creation (`src/adapters/worktree-creation.ts`)

`createWorktree(localRoot, target, baseOid, run, saveEvidence)` (worktree-creation.ts L22) 提供严格的容器身份核验与失败回滚。

- **阶段 ① 创建与验证**:
  1. Inspect `commonDir` & `parent` identity。
  2. `mkdir(target)` claimed。
  3. Inspect `rootIdentity` → `saveEvidence`。
  4. `worktree add --detach --no-checkout --lock`。
  5. Inspect `gitDir` & `gitIdentity` & `metadataFingerprint` → `saveEvidence`。
  6. `verifyIdentity(evidence, baseOid)` (worktree-creation.ts L105)。
  7. Sparse checkout 分支：`reset --hard` 或 `read-tree` + `checkout-index`。
  8. `verifyIdentity` & `unlock`。
- **阶段 ② 失败处理**:
  - `claimed=false`: 抛 `WorktreeCreationFailure.rolledBack`。
  - `registered=false`: 条件性 `rmdir`（验证 clean 且 identity 未变）(worktree-creation.ts L68)。
  - `registered=true`: 全链路 rollback：
    - `verifyIdentity` → `verifyRollbackMetadata` → `verifyUnmodified`。
    - `worktree move --force` 至 quarantine path。
    - 再次 verify → `worktree remove --force` (worktree-creation.ts L85)。
- `verifyIdentity(e, baseOid)` (worktree-creation.ts L105): 检查 root/parent/common/gitDir identity、`.git` pointer、`commondir`、`HEAD`、`locked` 文件、无 `.lock` 残留。
- `verifyRollbackMetadata(e, baseOid)` (worktree-creation.ts L168): 检查 `metadataFingerprint`、`indexFingerprint`、`ORIG_HEAD`。
- `metadataFingerprint(gitDir)` (worktree-creation.ts L125): SHA-256 哈希遍历 gitDir，排除 `index`, `gitdir`, `ORIG_HEAD`。
- `verifyUnmodified(root, baseOid, run)` (worktree-creation.ts L145): 检查 index 条目 hash、submodule 残留、conversion filters、unknown contents、staged/untracked/changed 状态。

### Initial Commit (`src/adapters/initial-commit.ts`)

由 `initialCommitActions` (initial-commit.ts L12, L136) 暴露的方法。

- `checked(root, args, input?)` (initial-commit.ts L15-L19): 执行 git 命令，非零退出码抛出 `SessionCheckoutError('git_operation_failed')`。
- `identity(path, trackChanges?)` (initial-commit.ts L20-L24): 基于 `lstat` 生成唯一标识符 `${dev}:${ino}:${birthtimeNs}`。若为符号链接则抛出 `stale()` 错误。
- `indexBytes(gitDir)` (initial-commit.ts L25-L27): 读取 `.git/index` 的 base64 编码内容，不存在时返回空字符串。
- `preflightInitialCommit(root)` (initial-commit.ts L30-L48):
  - `ready`: 已有 commit。
  - `files`: 有文件或 index 条目。
  - `empty`: 无文件无 index，生成 fingerprint。
- `initializeEmptyRepository(root, fingerprint, assertAuthorized?)` (initial-commit.ts L53-L96):
  - CAS 复核指纹 → 拿 `index.lock` → re-preflight → `var GIT_AUTHOR_IDENT` → `mktree` → `commit-tree` → `update-ref --stdin` CAS 写入 unborn HEAD。
  - `finally` 块清理锁文件（即使失败也不掩盖主错误）(initial-commit.ts L91-L96)。
- `initializeProject(root)` (initial-commit.ts L103-L112):
  - 非 Git → `git init -b main`。
  - Unborn → `add -A` + `commit -m "Initial commit"`。

### Project Skills (`src/adapters/project-skills.ts`, `project-skill-io.ts`, `project-skill-provider.ts`)

- `PROJECT_SKILL_ROOTS` (project-skills.ts L8): 常量数组 `['.dsh/skills', '.agents/skills', '.claude/skills']`。
- `MAX_FILES = 5000`, `MAX_BYTES = 64MB` (project-skills.ts L9-L10): 资源限制常量。
- `Manifest` (project-skills.ts L13): 版本 1，包含 root, identity, phase ('copying'|'ready'), files, directories。
- `SkillSnapshot` (project-skills.ts L15): 接口，包含 `directories?` 和 `files: Array<Entry & { content: Buffer }>`。
- `CarriedSkillState` (project-skills.ts L17): 接口，包含 `paths`, `fingerprint`, `modified`。
- `assertSkillTree(root, skillRoot)` (project-skills.ts L65-L73): 递归遍历 Skill 目录树，限制深度 64 和节点数 10000，确保无符号链接或特殊文件。
- `inventory(...)` (project-skills.ts L79-L105): 递归遍历技能根，收集文件元数据。校验 `safePath`，限制总字节数和文件数。调用 `readSkillFiles` 读取内容并计算 SHA256 Hash。
- `ProjectSkillStore(directory)` (project-skills.ts):
  - `file(root)` (project-skills.ts): 生成 Manifest 文件路径。
  - `snapshot(source)` (project-skills.ts L112-L115): 调用 `inventory` 收集所有 Skill 文件及其内容。
  - `load(root)` (project-skills.ts L117-L135): 加载并严格校验 Manifest JSON。
  - `carry(snapshot, target)` (project-skills.ts L138-L175): 将 Skill 从源复制到目标工作区，含预检冲突、独占写 Manifest、原子替换。
  - `scope(root)` (project-skills.ts L177-L179): 返回 Manifest 中定义的路径和目录集合。
  - `state(root, tracked)` (project-skills.ts L181-L210): 对比当前文件系统与 Manifest，计算 `fingerprint` 和 `modified` 标志。
  - `assertRemovable(root, tracked)` (project-skills.ts L212-L218): 检查是否可以安全移除 Skill 记录。
  - `forget(root)` (project-skills.ts L219): 删除 Manifest 文件。
- `trackedSkillPaths(indexEntries, headPaths)` (project-skills.ts L222-L228): 解析 Git Index 和 Head 输出，提取被跟踪的技能路径集合。
- `hasDeliverableStatus(output, auxiliary, directories)` (project-skills.ts L231-L240): 检查 Git status 输出，判断是否有非辅助性的可交付变更。
- `assertSkillPath(root, path)` (project-skills.ts L243-L245): 验证单个 Skill 路径的安全性和存在性。
- `ProjectSkillIO` (project-skill-io.ts): 技能文件读写原语，`checkRoot/checkPath` 验证身份与安全，`boundedRead` 限长读取，`createSkillDirectories/createSkillFiles` 原子创建。
  - `readSkillFiles(root, identity, files)` (project-skill-io.ts L35-L66): 批量读取技能文件。每次操作前调用 `checkRoot` 验证根目录身份（防替换攻击），调用 `checkPath` 验证路径组件合法性。使用 `O_NOFOLLOW` 打开文件，比对 stat 信息（ino, dev, size, mtime），防止读取过程中文件被替换。累计字节数限制（64MB）。
  - `createSkillDirectories(root, identity, directories)` (project-skill-io.ts L69-L75): 通过创建 `.directory-check` 文件来原子性地创建目录结构，同时验证路径安全性。
  - `createSkillFiles(root, identity, files)` (project-skill-io.ts L78-L86): 使用 `O_CREAT | O_EXCL` 原子创建文件，防止覆盖。设置文件权限，同步磁盘。创建后再次验证路径和根身份。
- `ClaudeProjectSkillProvider` (project-skill-provider.ts): 封装 `FileSystemSkillProvider` 实例池（≤32），list/get 经过安全校验后注入 `provider=NAME/source='project-claude'/rank=250`。
  - `list(options)` (project-skill-provider.ts L63-L85): 列出技能候选者，过滤出属于当前项目的技能，赋予 `rank: 250`。
  - `get(candidate, options)` (project-skill-provider.ts L87-L102): 获取技能定义，验证路径安全性。
  - `observeHostMutation(path)` (project-skill-provider.ts L104-L105): 转发文件系统变更通知给底层 Provider。
  - `dispose()` (project-skill-provider.ts L107-L112): 清理所有子 Provider。
- `mountProjectSkillProvider(ctx, registry)` (project-skill-provider.ts L114-L125): 注册 skills provider + fs/observed 转发 + dispose effect。
- `managedSkillRoot(cwd, registry)` (project-skill-provider.ts L20-L38): 遍历 `registry.managedCheckouts[phase==='ready']` 匹配 cwd 子目录并验证 `.git` 指针双向链接。

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
   - Caller → `runGit(ctx, cwd, args, options, input?, creation?)` (git.ts)。
   - `ctx.subprocess.spawn` 启动 git，注入安全环境变量与参数 (git.ts)。
   - 若为 `GitCommitProtocol`，通过 stdin pipe 发送 `prepare`，等待 `prepare: ok` 后执行 `beforeCommit` 回调，最后发送 `commit\n` 或 `abort\n` (git.ts)。
   - 若为 creation 模式，等待子进程树静默 (`settleCreationTree`) (git.ts)。
   - 返回 `GitCommandResult`，caller 决定非零退出码的处理策略 (git.ts)。

2. **Worktree Creation & Verification**:
   - `createDetachedWorktree` (git.ts) → `createWorktree` (worktree-creation.ts)。
   - Inspect commonDir/parent identity → mkdir(target) → inspect rootIdentity → `saveEvidence` (worktree-creation.ts)。
   - `worktree add --detach --no-checkout --lock` → inspect gitDir/gitIdentity/metadataFingerprint → `saveEvidence` (worktree-creation.ts)。
   - `verifyIdentity` → sparse checkout handling → `checkout-index` → `unlock` (worktree-creation.ts)。
   - 失败时：根据 `claimed`/`registered` 状态执行 rolledBack、条件性 rmdir 或全链路 quarantine+rollback (worktree-creation.ts)。

3. **Registry Read/Write**:
   - `AtomicJsonCheckoutRegistry.read()` (registry.ts) → `readJsonFileSafe` (safe-file.ts)。
   - 主文件 → .tmp 提升 → .bak 回退 (safe-file.ts)。
   - 校验 `isRegistry` → 修复 oversized message → 迁移 v1→v2 → 返回或抛错 (registry.ts)。
   - `write()` (registry.ts) → `writeJsonFileAtomic` (safe-file.ts)，含 .bak 备份与唯一 tmp rename。

4. **Project Skills Carry**:
   - `createDetachedWorktree` 校验本地无 Skill 变更 (git.ts)。
   - `createWorktree` 完成后调用 `projectSkills.carry(skills, managedRoot)` (git.ts)。
   - `carry` 流程：校验冲突 → `manifest.phase='copying'` → mkdir/writeFile → verify → `manifest.phase='ready'` + atomic rename (project-skills.ts)。
   - `removeWorktree` 调用 `projectSkills.assertRemovable` 校验无变更后 `worktree remove` (git.ts)。

5. **Lookup Service Adaptation**:
   - `createDshLookupPort` 动态获取 `ctx.get('workspaceRegistry')` 与 `ctx.get('sessions')` (lookup.ts)。
   - `getSidebarMemberships` 并行查询 workspace list 与 session query headers，通过 `sameResolvedPath` 匹配 managedRoot (lookup.ts)。
   - `getSession` 优先扫描 workspace sessionIds，fallback 到 live session header cwd (lookup.ts)。

## Connections

- [[host-overview|Host Entry and Registration Surface]]: 插件装配点。
- [[session-checkout-module|Session Checkout State Machine]]: 主要消费方，通过 `SessionCheckoutDependencies` 接口调用。
- [[console-host|Console Host Control Plane]]: 授权校验面，Lookup 仅提供导航证据。
- [[non-git-incremental-enablement|Non-Git Incremental Enablement]]: initial-commit.ts 支撑的非 Git 渐进增强功能。
- [[session-checkout-apply|Session Checkout Apply Pipeline]]: Project Skills snapshot/carry 在此流程中被调用。

## Known Issues

- **竞态保护复杂性**: `initial-commit.ts` 和 `project-skills.ts` 均依赖复杂的指纹校验和锁机制来防止竞态条件。若指纹计算逻辑（如 `identity` 或 `metadataFingerprint`）因文件系统元数据变化而失效，可能导致不必要的初始化拒绝或状态不一致。
- **Windows 兼容性**: `safe-file.ts` 中的 `renameAtomicWithRetry` 和 `files.ts` 中的 `removeDirectoryTree` 针对 Windows 文件句柄竞争实现了重试逻辑，但在极端高负载下仍可能失败，需监控重试次数上限。
- **注册表迁移**: `registry.ts` 的 `migrateLegacyRegistry` 将非终态 checkout 标记为 `recovery_required`，这可能需要人工干预或额外的自动化恢复流程，否则这些 checkout 将处于挂起状态。