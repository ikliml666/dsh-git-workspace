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

src/adapters/ 把 DSH 宿主能力适配为领域端口（SessionCheckoutDependencies，src/ports.ts:377）。装配点在插件 apply()（[[host-overview|Host Entry and Registration Surface]]）；领域消费方见 [[session-checkout-module|Session Checkout State Machine]]。

## Git 端口（src/adapters/git.ts，344 行）

`createDshGitPort` 经 ctx.subprocess 运行 git（tree 作用域遥测），实现 inspect/findContainingWorktreeRoot/status/createDetachedWorktree/removeWorktree/retainApplyBase/retainInternalArtifact/readInternalArtifact/releaseInternalArtifacts/isAncestor/pushBranch（尽力而为、绝不 force、失败返回而不抛）、listLocalBranches/resolveLocalBranchTip（v0.9.4，基准分支下拉与创建时 tip 解析；rev-parse --verify --quiet 对缺失 ref 返回 null）与可选 preflightInitialCommit/initializeEmptyRepository/initializeProject（v0.9.4，非 Git 渐进增强）。超时选择（src/adapters/git-options.ts:19-26）：`worktree add` → worktreeAddTimeoutMs、`worktree remove` → 固定 300_000、其余 gitTimeoutMs；两个字段均 `number | LiveValue<number | undefined>`，validateGitTimeouts 与 gitTimeoutMs 经 `liveConfigValue` 逐条命令解包（volatile 设置页改超时对下一条命令即生效，缺省回退 120s/300s）。

## 文件端口（src/adapters/files.ts，100 行 + src/adapters/safe-file.ts，130 行）

`createNodeFilesPort`：measureDirectoryBytes（src/adapters/files.ts:16，递归、symlink 计 0）、removeEmptyDirectoryTree（只删空目录）、quarantineDirectoryTree（rename 到隔离名）、removeDirectoryTree、inspectDirectoryIdentity（device/inode/birthtimeNs）。safe-file.ts 提供写前安全校验，防止覆盖符号链接/重定向路径。

## Registry（src/adapters/registry.ts）

`AtomicJsonCheckoutRegistry`：managed-checkouts.json 的原子读写（临时文件+rename），实现 SessionCheckoutRegistryPort（src/ports.ts:372）。version 2 结构 {revision, sessionBindings, managedCheckouts}。

## Lookup（src/adapters/lookup.ts）

`createDshLookupPort`：把 ctx 会话/项目查询适配为 SessionCheckoutLookupPort（getSession/getProject/getSidebarMemberships）——getSidebarMemberships 只是导航证据，授权一律在控制面（[[console-host|Console Host Control Plane]]）重新校验。

## Worktree 创建与初始提交

- worktree-creation.ts（250 行）：`createWorktree(localRoot, target, baseOid, run, saveEvidence)`——容器身份核验（inspectDirectoryIdentity 前后一致）、detached worktree 创建、证据回写（WorktreeCreationEvidence，src/ports.ts:126）；锁的获取/释放顺序保证「只有在前一把锁下完成收尾工作的事务才发布 commit」，finally 逆序 close+unlink（src/adapters/worktree-creation.ts 尾部注释）；失败路径与状态机 finishFailedCreation 协同（WorktreeCreationFailure.rolledBack，src/creation-failure.ts:2）。
- initial-commit.ts（117 行）：preflightInitialCommit（ready|files|empty + fingerprint）、initializeEmptyRepository（含复核回调）与 initializeProject（v0.9.4：非 Git 目录先 `git init -b main`；已有提交的仓库拒绝 operation_not_allowed `projectAlreadyVersioned`；`git add -A` + `git commit -m "Initial commit"`，身份缺失 → git_operation_failed `initialIdentityMissing`），支撑空仓库 createWithInitialCommit 与非 Git 渐进增强（见 [[non-git-incremental-enablement|Non-Git Incremental Enablement]]）。

## Project Skills

- project-skills.ts（239 行）：`ProjectSkillStore`——把项目技能目录随任务携带进 worktree（carried.fingerprint 叠加进 snapshotFingerprint，见 [[session-checkout-apply|Session Checkout Apply Pipeline]]）；`trackedSkillPaths(ls-files --stage, ls-tree HEAD)` 供 review-diff 剔除携带技能。
- project-skill-io.ts（88 行）：技能文件读写原语。
- project-skill-provider.ts（122 行）：`mountProjectSkillProvider(ctx, registry)` 把技能目录暴露给会话装配。
