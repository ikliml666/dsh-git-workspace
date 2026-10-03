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
tags:
  - adapters
  - git
  - registry
  - project-skills
---

# Adapter Layer

src/adapters/ 把 DSH 宿主能力适配为领域端口（SessionCheckoutDependencies，src/ports.ts:465）。装配点在插件 apply()（[[host-overview|Host Entry and Registration Surface]]）；领域消费方见 [[session-checkout-module|Session Checkout State Machine]]。

## Git 端口（src/adapters/git.ts，544 行）

`createDshGitPort(ctx, options)` 经 ctx.subprocess 运行 git（tree 作用域遥测），实现 inspect/findContainingWorktreeRoot/status/createDetachedWorktree/removeWorktree/pruneWorktrees/retainApplyBase/releaseApplyBase/retainInternalArtifact/readInternalArtifact/releaseInternalArtifacts/isAncestor/pushBranch（尽力而为、绝不 force、失败返回而不抛）、listLocalBranches/resolveLocalBranchTip（v0.9.4，基准分支下拉与创建时 tip 解析；rev-parse --verify --quiet 对缺失 ref 返回 null）与可选 preflightInitialCommit/initializeEmptyRepository/initializeProject（v0.9.4，非 Git 渐进增强）。inspect 的身份事实合并为单次 `rev-parse --show-toplevel --path-format=absolute --git-common-dir --absolute-git-dir HEAD^{commit}`，`symbolic-ref` 并行补分支（src/adapters/git.ts:240-241→248；lines.length === 4 快径，lines ≠4 换行路径歧义、unborn/broken HEAD 与 not-a-repo 分类保留原逐项读取回退，语义不变）。超时选择（src/adapters/git-options.ts:21-26）：`worktree add` → worktreeAddTimeoutMs、`worktree remove` → 固定 300_000、其余 gitTimeoutMs；两个字段均 `number | LiveValue<number | undefined>`，validateGitTimeouts 与 gitTimeoutMs 经 `liveConfigValue` 逐条命令解包（volatile 设置页改超时对下一条命令即生效，缺省回退 120s/300s）。

内部常量（git.ts:26-30）：`GIT_TERMINATION_GRACE_MS = 1_000`、`GIT_COLLECT_BYTES = 1 << 20`、`WIP_PATCH_COLLECT_BYTES = 16 << 20`。runGit（git.ts:74-169）是核心执行器：通过 ctx.subprocess.spawn 启动 git，C locale + GIT_OPTIONAL_LOCKS=0 + GIT_TERMINAL_PROMPT=0 禁止交互；Windows 下自动注入 `-c core.longpaths=true`；hooksPath 由 options.hooksPath 传入禁用 git hooks。输入支持 string 或 GitCommitProtocol（prepare/ok/abort 协议管道，git.ts:114-134）。creation 模式在退出码 0 后调用 settleCreationTree（git.ts:54-67，最多 10s 等子进程树静默）。quiescent=true 表示整棵子进程树已清静。超时或信号终止返回 quiescent 状态（git.ts:158-159）。

artifact 引用命名空间（git.ts:182-214）：checkoutRefRoot 用 sha256(checkoutId) 前 24 位生成 `refs/dsh-worktree/session-checkouts/<key>`；abandonedSnapshotRef 使用独立命名空间 `refs/dsh-worktree/abandoned/<checkoutId>` 避免 discard 流程释放 artifact namespace 时连带丢弃安全快照。

新增方法（与上次编译相比）：

- repairWorktreeLinks（git.ts:403-408）：仓库磁盘移动后通过 `git worktree repair` 重链 .git 指针。
- listWorktreeincludeFiles（git.ts:409-428）：.worktreeinclude 机制——`ls-files --others --ignored` 的交集 = "matched ∧ gitignored"；自动带入 AGENTS.override.md（codex 语义）。
- branchOverview（git.ts:429-445）：头芯片分支概览——并行 for-each-ref + status，返回 branches[] + dirtyCount。
- graphLog（git.ts:446-468）：只读 commit 图分页（topo-order, 所有 refs），parseDecoration 解析 `%D` 装饰去 HEAD/tag 前缀。
- createLocalBranch（git.ts:469-478）：先 check-ref-format 再 branch HEAD。
- switchLocalBranch（git.ts:479-490）：switch 分支，检测 worktree 冲突错误。
- captureLocalWip（git.ts:491-499）：`diff --binary HEAD` 覆盖已暂存与未暂存 tracked 修改，空输出返回 null。
- applyWorktreePatch（git.ts:500-506）：`apply --binary --whitespace=nowarn` 原子应用。
- listUntrackedFiles（git.ts:507-511）：非 ignore 的 untracked 路径列表。
- snapshotAbandonedWorktree（git.ts:512-532）：add -A + write-tree + commit-tree 以 dsh-git-worktree 身份固化快照到 abandonedSnapshotRef。
- restoreAbandonedSnapshot（git.ts:533-541）：branch + update-ref -d 恢复快照为分支。

status（git.ts:312-316）集成 ProjectSkillStore.scope：从 status porcelain 中剔除携带技能目录内容后再判断 dirty。

removeWorktree（git.ts:330-340）：先 ls-files --stage + ls-tree HEAD 计算 trackedSkillPaths，调 projectSkills.assertRemovable 校验无变更后才 worktree remove --force。

releaseInternalArtifacts（git.ts:359-368）：for-each-ref 批量收集 refs → 单次 update-ref --stdin 事务删除（原逐个 update-ref -d 为 1+N 次串行）。

graphLog parseDecoration（git.ts:47-52）：去除 `HEAD -> ` 和 `tag: ` 前缀。

## 文件端口（src/adapters/files.ts，109 行 + src/adapters/safe-file.ts，161 行）

`createNodeFilesPort()`（files.ts:89-108）：measureDirectoryBytes（files.ts:16-24，递归、symlink 计 0）、removeEmptyDirectoryTree（files.ts:26-35，同步递归删空目录）、quarantineDirectoryTree（files.ts:52-72，rename CAS 身份校验）、removeDirectoryTree（files.ts:74-86，rm recursive maxRetries Win32:6/others:2）、inspectDirectoryIdentity（files.ts:37-46，device/inode/birthtimeNs）。readTextFile/copyFile/isSymbolicLink 为可选扩展。

safe-file.ts 提供崩溃安全的 JSON 文件读写：writeJsonFileAtomic（safe-file.ts:82-100）唯一命名 tmp → rename（POSIX 原子操作）+ .bak 备份；readJsonFileSafe（safe-file.ts:113-161）主文件 → 最新可解析 .tmp 残留 → .bak 回退，多层容错。renameAtomicWithRetry（safe-file.ts:30-44）针对 Windows 短暂句柄占用有限重试 5 次（EBUSY/EPERM/EACCES/ENOTMET）。sleepSync（safe-file.ts:20-27）Atomics.wait + fallback。

## Registry（src/adapters/registry.ts，439 行）

`AtomicJsonCheckoutRegistry`：managed-checkouts.json 的原子读写（通过 safe-file.ts readJsonFileSafe/writeJsonFileAtomic），实现 SessionCheckoutRegistryPort（src/ports.ts:447）。version 2 结构 {revision, sessionBindings, managedCheckouts}。

数据校验函数（registry.ts:25-334）：isRecord/isStringArray/isOid/isBoundedText/isSafeRelativePath/isTargetRef/isSessionBinding/isReview/isPreviousReview/isCheckpoint/isPreviewReceipt/isDeliveryProof/isDelivery/isJournal/isManagedCheckout/isRegistry 层层嵌套验证。

迁移修复：repairOversizedPreviousReviewCommitMessage（registry.ts:336-355）截断 >500 字符的 suggestedCommitMessage；migrateLegacyRegistry（registry.ts:357-412）v1→v2 保守迁移，非 ready/discarded phase 标记为 recovery_required。

## Lookup（src/adapters/lookup.ts，122 行）

`createDshLookupPort(ctx)`：把 ctx 会话/项目查询适配为 SessionCheckoutLookupPort（getSession/getProject/getSidebarMemberships）——getSidebarMemberships 只是导航证据，授权一律在控制面（[[console-host|Console Host Control Plane]]）重新校验。

实现细节（lookup.ts:64-121）：workspaceRegistry 动态获取 ctx.get('workspaceRegistry')，sessions 动态获取 ctx.get('sessions')；sameResolvedPath 处理 Win32 大小写不敏感。getSession 在 workspace.sessionIds 过滤后通过 liveCwd 恢复映射（lookup.ts:105-113）。

## Worktree 创建与初始提交

- worktree-creation.ts（250 行）：`createWorktree(localRoot, target, baseOid, run, saveEvidence)`——容器身份核验（inspectDirectoryIdentity 前后一致）、detached worktree 创建（`--detach --no-checkout --lock --reason`）、证据回写（WorktreeCreationEvidence，src/ports.ts:196）；锁的获取/释放顺序保证「只有在前一把锁下完成收尾工作的事务才发布 commit」，finally 逆序 close+unlink（src/adapters/worktree-creation.ts 尾部注释）；失败路径与状态机 finishFailedCreation 协同（WorktreeCreationFailure.rolledBack，src/creation-failure.ts:2）。

详细阶段：① inspect commonDir/parent/commonIdentity → mkdir(target) claimed → inspect rootIdentity → saveEvidence → `worktree add --detach --no-checkout --lock --reason` → inspect gitDir/gitIdentity/metadataFingerprint → saveEvidence → verifyIdentity → sparse checkout 分支（read-tree 或 reset --hard）→ checkout-index → unlock。② 失败处理：claimed=false → rolledBack WorktreeCreationFailure；registered=false → 条件性 rmdir；registered=true → 全链路 rollback（verifyIdentity → verifyRollbackMetadata → verifyUnmodified → quarantine rename → verify → remove → verify → remove）。metadataFingerprint（worktree-creation.ts:162-183）遍历 gitDir 排除 index/gitDir/ORIG_HEAD 做 SHA-256 哈希。

- initial-commit.ts（119 行）：preflightInitialCommit（ready|files|empty + fingerprint）、initializeEmptyRepository（含复核回调）与 initializeProject（v0.9.4：非 Git 目录先 `git init -b main`；已有提交的仓库拒绝 operation_not_allowed `projectAlreadyVersioned`；`git add -A` + `git commit -m "Initial commit"`，身份缺失 → git_operation_failed `initialIdentityMissing`），支撑空仓库 createWithInitialCommit 与非 Git 渐进增强（见 [[non-git-incremental-enablement|Non-Git Incremental Enablement]]）。

初始化流程（initial-commit.ts:48-99）：preflight → fingerprint CAS → 拿 index.lock → re-preflight → var GIT_AUTHOR_IDENT/GIT_COMMITTER_IDENT → mktree → commit-tree → update-ref --stdin CAS 写入 unborn HEAD。initializeProject（initial-commit.ts:104-117）：非 Git → git init -b main；unborn → add -A + commit。

## Project Skills

- project-skills.ts（239 行）：`ProjectSkillStore(directory)`——把项目技能目录随任务携带进 worktree（carried.fingerprint 叠加进 snapshotFingerprint，见 [[session-checkout-apply|Session Checkout Apply Pipeline]]）；`trackedSkillPaths(ls-files --stage, ls-tree HEAD)` 供 review-diff 剔除携带技能。

核心 API：snapshot（project-skills.ts:104-107）扫描 PROJECT_SKILL_ROOTS=[.dsh/skills, .agents/skills, .claude/skills] 生成 SkillSnapshot；carry（project-skills.ts:125-167）写前校验冲突 → 写 manifest.phase='copying' → mkdir + writeFile(wx) → createSkillDirectories/createSkillFiles → verify copied → manifest.phase='ready' + atomic rename；scope（project-skills.ts:168-171）加载 manifest 返回 paths；state（project-skills.ts:173-203）对比 manifest 与实际文件系统算 modified/fingerprint；assertRemovable（project-skills.ts:204-212）移除前校验无变更；forget（project-skills.ts:213）删除 manifest。

辅助函数：hasDeliverableStatus（project-skills.ts:225-235）从 status porcelain 中剔除携带技能后判断 dirty；assertSkillTree/assertSkillPath（project-skills.ts:60-70, 237-239）树/路径安全校验；boundedRead（project-skills.ts:40-58）限长带完整性校验的文件读取。

- project-skill-io.ts（88 行）：技能文件读写原语。checkRoot/checkPath 验证目录身份与路径安全性；readSkillFiles（project-skill-io.ts:38-64）按 SkillRead 数组 bounded 读取；createSkillDirectories/createSkillFiles（project-skill-io.ts:66-88）原子创建带身份校验。

- project-skill-provider.ts（133 行）：`ClaudeProjectSkillProvider` + `mountProjectSkillProvider(ctx, registry)`。managedSkillRoot（project-skill-provider.ts:22-45）遍历 registry.managedCheckouts[phase==='ready'] 匹配 cwd 子目录并验证 .git 指针双向链接。ClaudeProjectSkillProvider（project-skill-provider.ts:48-118）封装 FileSystemSkillProvider 实例池（≤32），list/get 经过 assertSkillTree/assertSkillPath 安全校验后注入 provider=NAME/source='project-claude'/rank=250。mountProjectSkillProvider（project-skill-provider.ts:121-133）注册 skills provider + fs/observed 转发 + dispose effect。
