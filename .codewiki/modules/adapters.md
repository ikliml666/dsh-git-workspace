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
test_files:
  - tests/adapters-safe-file.test.ts
tags:
  - adapters
  - git
  - registry
  - project-skills
---

# Adapter Layer

src/adapters/ 把 DSH 宿主能力适配为领域端口（SessionCheckoutDependencies，src/ports.ts:465）。装配点在插件 apply()（[[host-overview|Host Entry and Registration Surface]]）；领域消费方见 [[session-checkout-module|Session Checkout State Machine]]。

## Git 端口（src/adapters/git.ts，623 行）

`createDshGitPort(ctx, options)` 经 ctx.subprocess 运行 git（tree 作用域遥测），实现 SessionCheckoutGitPort 全部方法：inspect/findContainingWorktreeRoot/status/createDetachedWorktree/removeWorktree/pruneWorktrees/retainApplyBase/releaseApplyBase/retainInternalArtifact/readInternalArtifact/releaseInternalArtifacts/isAncestor/listLocalBranches/resolveLocalBranchTip/pushBranch/deleteLocalBranch/mergeLocalBranch/repairWorktreeLinks/listWorktreeincludeFiles/branchOverview/graphLog/createLocalBranch/switchLocalBranch/captureLocalWip/applyWorktreePatch/listUntrackedFiles/snapshotAbandonedWorktree/restoreAbandonedSnapshot（尽力而为、绝不 force、失败返回而不抛）。v0.9.4 新增 preflightInitialCommit/initializeEmptyRepository/initializeProject（非 Git 渐进增强），通过 initialCommitActions 混入 port 对象（git.ts:622）。

### 核心执行器 runGit（git.ts:77-172）

通过 ctx.subprocess.spawn 启动 git，C locale + GIT_OPTIONAL_LOCKS=0 + GIT_TERMINAL_PROMPT=0 禁止交互；Windows 下自动注入 `-c core.longpaths=true`；hooksPath 由 options.hooksPath 传入禁用 git hooks。输入支持 string 或 GitCommitProtocol（prepare/ok/abort 协议管道，git.ts:117-138）。creation 模式在退出码 0 后调用 settleCreationTree（git.ts:57-70，最多 10s 等子进程树静默）。quiescent=true 表示整棵子进程树已清静。超时或信号终止返回 quiescent 状态（git.ts:161-162）。内部常量（git.ts:28-33）：`GIT_TERMINATION_GRACE_MS = 1_000`、`GIT_COLLECT_BYTES = 1 << 20`、`WIP_PATCH_COLLECT_BYTES = 16 << 20`。

runGitChecked（git.ts:174-183）是 runGit 的 throw 封装，code ≠0 时抛出 SessionCheckoutError。

### inspect（git.ts:240-306）

单次 rev-parse 同时取全部位置事实，symbolic-ref 并行补分支；顺序逐项读取保留为 unborn/broken HEAD 与换行路径歧义时的回退。lines.length === 4 快径（git.ts:250→254），lines ≠4 换行路径歧义、unborn/broken HEAD 与 not-a-repo 分类保留原逐项读取回退，语义不变。

### artifact 引用命名空间（git.ts:185-217）

checkoutRefRoot 用 sha256(checkoutId) 前 24 位生成 `refs/dsh-worktree/session-checkouts/<key>`；abandonedSnapshotRef 使用独立命名空间 `refs/dsh-worktree/abandoned/<checkoutId>` 避免 discard 流程释放 artifact namespace 时连带丢弃安全快照。

### 超时选择（git-options.ts:21-27）

`worktree add` → worktreeAddTimeoutMs、`worktree remove` → 固定 5×60_000、其余 gitTimeoutMs；两个字段均 `number | LiveValue<number | undefined>`，validateGitTimeouts 与 gitTimeoutMs 经 `liveConfigValue` 逐条命令解包（volatile 设置页改超时对下一条命令即生效，缺省回退 120s/300s）。DEFAULT_GIT_TIMEOUT_MS=120_000、DEFAULT_WORKTREE_ADD_TIMEOUT_MS=5*60_000、MAX_GIT_TIMEOUT_MS=60*60_000。

### 各方法详解

- **findContainingWorktreeRoot**（git.ts:307-314）：rev-parse --show-toplevel 取根目录。
- **status**（git.ts:315-319）：集成 ProjectSkillStore.scope——从 status porcelain 中剔除携带技能目录内容后再判断 dirty。
- **createDetachedWorktree**（git.ts:320-332）：先校验本地无 Skill tracked 变更 → createWorktree 创建 detached worktree → projectSkills.carry 携带技能文件。
- **removeWorktree**（git.ts:333-343）：先 ls-files --stage + ls-tree HEAD 计算 trackedSkillPaths，调 projectSkills.assertRemovable 校验无变更后才 worktree remove --force。
- **pruneWorktrees**（git.ts:344-346）：worktree prune --expire now。
- **retain/releaseInternalArtifact**（git.ts:347-372）：update-ref / rev-parse --verify --quiet / for-each-ref + update-ref --stdin 事务删除。releaseInternalArtifacts 批量收集 refs → 单次 update-ref --stdin 事务删除（原逐个 update-ref -d 为 1+N 次串行）。
- **isAncestor**（git.ts:373-378）：merge-base --is-ancestor。
- **listLocalBranches**（git.ts:379-382）：for-each-ref --format=%(refname:short) refs/heads。
- **resolveLocalBranchTip**（git.ts:383-388）：rev-parse --verify --quiet refs/heads/<branch>，对缺失 ref 返回 null。
- **pushBranch**（git.ts:389-405）：symbolic-ref 取当前分支 → rev-parse 查 upstream → push，失败不 force。
- **deleteLocalBranch**（git.ts:449-453）：branch -d <name>，返回 deleted:true/false+reason。
- **mergeLocalBranch**（git.ts:499-569）：dryRun 模式创建临时 detached worktree 试合并（mkdtemp probe），零改动触碰 checkout；正式合并走 merge --no-ff --no-edit，冲突不 abort——冲突状态留在 Local，collectConflict 提取 conflictingFiles + conflictDetails（受 CONFLICT_DETAIL_FILE_LIMIT/CONFLICT_DETAIL_DIFF_LIMIT 限制）。
- **repairWorktreeLinks**（git.ts:406-411）：仓库磁盘移动后通过 worktree repair 重链 .git 指针。
- **listWorktreeincludeFiles**（git.ts:412-431）：.worktreeinclude 机制——`ls-files --others --ignored` 的交集 = "matched ∧ gitignored"；自动带入 AGENTS.override.md（codex 语义）。
- **branchOverview**（git.ts:432-448）：头芯片分支概览——并行 for-each-ref + status，返回 branches[] + dirtyCount。
- **graphLog**（git.ts:454-476）：只读 commit 图分页（topo-order, 所有 refs），parseDecoration（git.ts:49-55）解析 %D 装饰去 HEAD/tag 前缀，limit 钳制 1-1000。
- **createLocalBranch**（git.ts:477-486）：先 check-ref-format --branch 再 branch HEAD。
- **switchLocalBranch**（git.ts:487-498）：switch 分支，检测 worktree 冲突错误（already used by/already checked out at）。
- **captureLocalWip**（git.ts:570-578）：`diff --binary --full-index HEAD` 覆盖已暂存与未暂存 tracked 修改，空输出返回 null（WIP_PATCH_COLLECT_BYTES=16MB 上限）。
- **applyWorktreePatch**（git.ts:579-585）：`apply --binary --whitespace=nowarn -` 原子应用。
- **listUntrackedFiles**（git.ts:586-590）：非 ignore 的 untracked 路径列表。
- **snapshotAbandonedWorktree**（git.ts:591-611）：add -A + write-tree + commit-tree 以 dsh-git-worktree 身份固化快照到 abandonedSnapshotRef。
- **restoreAbandonedSnapshot**（git.ts:612-620）：branch + update-ref -d 恢复快照为分支。

### 初始提交（initial-commit.ts 混入，git.ts:622）

initialCommitActions(inspect, run) 返回 preflightInitialCommit/initializeEmptyRepository/initializeProject 三个方法，附加到 port 对象上。preflightInitialCommit（initial-commit.ts:29-47）：ready|files|empty + fingerprint 三态；initializeEmptyRepository（initial-commit.ts:48-99）含复核回调、index.lock CAS、mktree + commit-tree + update-ref --stdin unborn HEAD；initializeProject（initial-commit.ts:104-117）：非 Git → git init -b main；unborn → add -A + commit。

## 文件端口（src/adapters/files.ts，109 行 + src/adapters/safe-file.ts，161 行）

`createNodeFilesPort()`（files.ts:89-108）：measureDirectoryBytes（files.ts:16-24，递归、symlink 计 0）、removeEmptyDirectoryTree（files.ts:26-35，同步递归删空目录）、quarantineDirectoryTree（files.ts:52-72，rename CAS 身份校验）、removeDirectoryTree（files.ts:74-86，rm recursive maxRetries Win32:6/others:2）、inspectDirectoryIdentity（files.ts:37-46，device/inode/birthtimeNs）、directoryIdentitiesEqual（files.ts:48-50）。readTextFile/copyFile/isSymbolicLink/exists/canonicalize/ensureDirectory 为可选扩展。

safe-file.ts 提供崩溃安全的 JSON 文件读写：writeJsonFileAtomic（safe-file.ts:82-100）唯一命名 tmp（含 PID+UUID）→ rename（POSIX 原子操作）+ .bak 备份；writeTextFileAtomic（safe-file.ts:103-107）文本文件同模式原子写；readJsonFileSafe（safe-file.ts:113-161）主文件 → 最新可解析 .tmp 残留 → .bak 回退，多层容错。renameAtomicWithRetry（safe-file.ts:30-44）针对 Windows 短暂句柄占用有限重试 5 次（EBUSY/EPERM/EACCES/ENOTMET）。sleepSync（safe-file.ts:20-27）Atomics.wait + fallback。tmpPathFor（safe-file.ts:50-52）唯一命名，listTmpFiles（safe-file.ts:55-68）按 mtime 排序清理。

## Registry（src/adapters/registry.ts，439 行）

`AtomicJsonCheckoutRegistry`：managed-checkouts.json 的原子读写（通过 safe-file.ts readJsonFileSafe/writeJsonFileAtomic），实现 SessionCheckoutRegistryPort（src/ports.ts:447）。version 2 结构 {revision, sessionBindings, managedCheckouts}。

数据校验函数（registry.ts:25-334）：isRecord/isStringArray/isOid/isBoundedText/isSafeRelativePath/isTargetRef/isSessionBinding/isReview/isPreviousReview/isCheckpoint/isPreviewReceipt/isDeliveryProof/isDelivery/isJournal/isManagedCheckout/isRegistry 层层嵌套验证。isDelivery 按 state 分 working/ready_for_review/preview_active/preview_detached/finalized/retained/delivered 多态校验。isJournal 按 operation 分 create/apply/preview/checkpoint/rollback_preview/finish/finalize_preview/cleanup 校验。

迁移修复：repairOversizedPreviousReviewCommitMessage（registry.ts:336-355）截断 >500 字符的 suggestedCommitMessage；migrateLegacyRegistry（registry.ts:357-412）v1→v2 保守迁移，非 ready/discarded phase 标记为 recovery_required。

## Lookup（src/adapters/lookup.ts，122 行）

`createDshLookupPort(ctx)`：把 ctx 会话/项目查询适配为 SessionCheckoutLookupPort（getSession/getProject/getSidebarMemberships）——getSidebarMemberships 只是导航证据，授权一律在控制面（[[console-host|Console Host Control Plane]]）重新校验。

实现细节（lookup.ts:64-121）：workspaceRegistry 动态获取 ctx.get('workspaceRegistry')，sessions 动态获取 ctx.get('sessions')；sameResolvedPath（lookup.ts:55-61）处理 Win32 大小写不敏感。getSession 在 workspace.sessionIds 过滤后通过 liveCwd 恢复映射（lookup.ts:105-113）。getSidebarMemberships 还查询 ctx.get('sessionQuery').listSessions() 获取 header cwd 补充 sessionIds。

## Worktree 创建与初始提交

- worktree-creation.ts（250 行）：`createWorktree(localRoot, target, baseOid, run, saveEvidence)`——容器身份核验（inspectDirectoryIdentity 前后一致）、detached worktree 创建（`--detach --no-checkout --lock --reason`）、证据回写（WorktreeCreationEvidence，src/ports.ts:196）；锁的获取/释放顺序保证「只有在前一把锁下完成收尾工作的事务才发布 commit」，finally 逆序 close+unlink；失败路径与状态机 finishFailedCreation 协同（WorktreeCreationFailure.rolledBack，src/creation-failure.ts:2）。

详细阶段：① inspect commonDir/parent/commonIdentity → mkdir(target) claimed → inspect rootIdentity → saveEvidence → `worktree add --detach --no-checkout --lock --reason` → inspect gitDir/gitIdentity/metadataFingerprint → saveEvidence → verifyIdentity → sparse checkout 分支（read-tree 或 reset --hard）→ checkout-index → unlock。② 失败处理：claimed=false → rolledBack WorktreeCreationFailure；registered=false → 条件性 rmdir（验证 clean 且 identity 未变）；registered=true → 全链路 rollback（verifyIdentity → verifyRollbackMetadata → verifyUnmodified → quarantine rename → verify → remove → verify → remove）。metadataFingerprint（worktree-creation.ts:162-183）遍历 gitDir 排除 index/gitDir/ORIG_HEAD 做 SHA-256 哈希。verifyUnmodified（worktree-creation.ts:185-250）检查 index 条目 hash、submodule 残留、conversion filters、unknown contents。

- initial-commit.ts（119 行）：preflightInitialCommit（ready|files|empty + fingerprint）、initializeEmptyRepository（含复核回调）与 initializeProject（v0.9.4：非 Git 目录先 `git init -b main`；已有提交的仓库拒绝 operation_not_allowed `projectAlreadyVersioned`；`git add -A` + `git commit -m "Initial commit"`，身份缺失 → git_operation_failed `initialIdentityMissing`），支撑空仓库 createWithInitialCommit 与非 Git 渐进增强（见 [[non-git-incremental-enablement|Non-Git Incremental Enablement]]）。

初始化流程（initial-commit.ts:48-99）：preflight → fingerprint CAS → 拿 index.lock → re-preflight → var GIT_AUTHOR_IDENT/GIT_COMMITTER_IDENT → mktree → commit-tree → update-ref --stdin CAS 写入 unborn HEAD。initializeProject（initial-commit.ts:104-117）：非 Git → git init -b main；unborn → add -A + commit。

## Project Skills

- project-skills.ts（239 行）：`ProjectSkillStore(directory)`——把项目技能目录随任务携带进 worktree（carried.fingerprint 叠加进 snapshotFingerprint，见 [[session-checkout-apply|Session Checkout Apply Pipeline]]）；`trackedSkillPaths(ls-files --stage, ls-tree HEAD)` 供 review-diff 剔除携带技能。

核心 API：snapshot（project-skills.ts:104-107）扫描 PROJECT_SKILL_ROOTS=[.dsh/skills, .agents/skills, .claude/skills] 生成 SkillSnapshot；carry（project-skills.ts:125-167）写前校验冲突 → 写 manifest.phase='copying' → mkdir + writeFile(wx) → createSkillDirectories/createSkillFiles → verify copied → manifest.phase='ready' + atomic rename；scope（project-skills.ts:168-171）加载 manifest 返回 paths；state（project-skills.ts:173-203）对比 manifest 与实际文件系统算 modified/fingerprint；assertRemovable（project-skills.ts:204-212）移除前校验无变更；forget（project-skills.ts:213）删除 manifest。load（project-skills.ts:108-124）校验 manifest version/root/identity/phase/files/directories。

辅助函数：hasDeliverableStatus（project-skills.ts:225-235）从 status porcelain 中剔除携带技能后判断 dirty；assertSkillTree/assertSkillPath（project-skills.ts:60-70, 237-239）树/路径安全校验；boundedRead（project-skills.ts:40-58）限长带完整性校验的文件读取；inventory（project-skills.ts:74-98）递归遍历 skill roots 收集文件；ownedSkillDirectories（project-skills.ts:71-73）提取 skill 目录归属。

- project-skill-io.ts（88 行）：技能文件读写原语。checkRoot/checkPath 验证目录身份与路径安全性；readSkillFiles（project-skill-io.ts:38-64）按 SkillRead 数组 bounded 读取；createSkillDirectories/createSkillFiles（project-skill-io.ts:66-88）原子创建带身份校验。

- project-skill-provider.ts（133 行）：`ClaudeProjectSkillProvider` + `mountProjectSkillProvider(ctx, registry)`。managedSkillRoot（project-skill-provider.ts:22-45）遍历 registry.managedCheckouts[phase==='ready'] 匹配 cwd 子目录并验证 .git 指针双向链接。ClaudeProjectSkillProvider（project-skill-provider.ts:48-118）封装 FileSystemSkillProvider 实例池（≤32），list/get 经过 assertSkillTree/assertSkillPath 安全校验后注入 provider=NAME/source='project-claude'/rank=250。mountProjectSkillProvider（project-skill-provider.ts:121-133）注册 skills provider + fs/observed 转发 + dispose effect。

## 测试文件

tests/adapters-safe-file.test.ts（74 行）：覆盖 writeJsonFileAtomic/readJsonFileSafe/writeTextFileAtomic 的原子写、.tmp 残留提升、.bak 回退、并发 tmp 清理。
