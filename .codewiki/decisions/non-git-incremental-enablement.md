---
title: "非 Git 目录渐进增强：显式确认下的 init + 首次提交，而非静默或死路"
type: decision
source_files:
  - "src/adapters/initial-commit.ts"
  - "src/console-host/control-plane.ts"
  - "src/client/pre-session/PreSessionWorktreeToggle.tsx"
tags:
  - design
  - non-git
  - onboarding
---

## 背景

非 Git 目录此前是双死角：`adapter.current()` 返回 `not_git_repository` → 开关直接隐藏（用户无从得知原因）；未出生仓库带未跟踪文件（preflight kind `files`）时 Modal 只给说明不给动作。dsh-worktree-panel 的做法是菜单里提供「git init -b main → add -A → commit -m init」，实用但静默。

## 决定

- 新增宿主能力 `git.initializeProject(root)`（src/adapters/initial-commit.ts）：非 Git 目录先 `git init -b main`（-b 不写 config，Git ≥ 2.28）；已有提交的仓库直接拒绝（operation_not_allowed `projectAlreadyVersioned`）；然后 `git add -A`（遵循 .gitignore）+ `git commit -m "Initial commit"`；身份缺失 → git_operation_failed `initialIdentityMissing`（复用空仓库流程的既有文案）。不做指纹 CAS 事务——动作是用户显式确认的纯增量操作，最坏情况是提交失败原样报错，不回滚任何字节。
- 新 RPC `gitWorktree/initProject`（控制面经 `withCreation` 互斥守卫，src/console-host/control-plane.ts），与 create 串行化，杜绝初始化与创建竞态。
- 客户端两处入口（src/client/pre-session/PreSessionWorktreeToggle.tsx）：
  1. unsupported 态不再隐藏：开关可点 → 直接进「初始化 Git 并启用 Worktree」确认 Modal（`initConfirm` 状态 + `runInitialize(false)`，成功后 refreshCurrent 回 idle）。
  2. kind `files` 的 Modal footer 增加同一动作（`runInitialize(true)`）：初始化后**重新预检**并回到常规创建确认——用户的原始意图（建 worktree）不被打断。
- 确认文案明确列出将执行的三条命令与「只新增版本控制，不改动、不删除任何文件」。

## 否决的替代方案

- **照搬 panel 的静默 init**：把用户文件提交进版本库是不可逆的可见性变化（文件内容变历史），必须显式确认；与 initial-commit.ts 既有注释的保守立场（「ignored files、symlinks、嵌套仓库都需要显式用户决策」）一致。
- **对 kind `files` 复用 initializeEmptyRepository 的指纹 CAS**：CAS 保护的是 unborn HEAD 的 compare-and-swap（空树、无用户数据），add -A 提交涉及真实用户文件，指纹方案复杂度不成比例；用 withCreation 互斥 + 已有提交即拒绝足够。

## 后果

- 非 Git 目录从「报错死路」变成两步可用（确认初始化 → 常规创建）；.gitignore 忽略一切导致的空提交失败会以 initialCommitFailed 原样浮出。
- 管理面板（target-console）对非 Git 项目仍显示 unavailable——渐进增强只铺在预会话开关这个入口上。
