---
title: "非 Git 目录渐进增强：显式确认下的 init + 首次提交，而非静默或死路"
type: decision
source_files:
  - "src/adapters/initial-commit.ts"
  - "src/console-host/control-plane.ts"
tags:
  - design
  - non-git
  - onboarding
---

> 2026-10-01 更新：作为入口 UI 的预会话开关（src/client/pre-session/，含 PreSessionWorktreeToggle）已整体移除，创建入口收敛到会话 Header 的 Worktree Manager 与 `/worktree` 命令。init + 首次提交的能力链（src/adapters/initial-commit.ts:104 `initializeProject` → control-plane `initProject` → 客户端 adapter `initializeProject`）保留，当前暂无客户端调用方，供未来入口复用。本文其余内容为当时的决策记录。

## 背景

非 Git 目录此前是双死角：`adapter.current()` 返回 `not_git_repository` → 开关直接隐藏（用户无从得知原因）；未出生仓库带未跟踪文件（preflight kind `files`）时 Modal 只给说明不给动作。dsh-worktree-panel 的做法是菜单里提供「git init -b main → add -A → commit -m init」，实用但静默。

## 决定

- 新增宿主能力 `git.initializeProject(root)`（src/adapters/initial-commit.ts:104-117）：本地适配函数，在 `initialCommitActions(inspect, run)` 工厂内返回。非 Git 目录先 `git init -b main`（-b 不写 config，Git ≥ 2.28）；已有提交的仓库直接拒绝（operation_not_allowed `projectAlreadyVersioned`，L106-108）；然后检查身份 `GIT_AUTHOR_IDENT`（L113-114，缺失 → git_operation_failed `initialIdentityMissing`）；接着 `git add -A`（遵循 .gitignore，L115）+ `git commit -m "Initial commit"`（L116）。不做指纹 CAS 事务——动作是用户显式确认的纯增量操作，最坏情况是提交失败原样报错，不回滚任何字节。注释 L101-103 明确保守立场：「ignored files、symlinks、嵌套仓库都需要显式用户决策」。
- 新 RPC `initProject(sourceSessionId)`（控制面经 `withCreation` 互斥守卫，src/console-host/control-plane.ts:753-757），接口声明 L76。与 `create`/`createWithInitialCommit` 共享 `withCreation`（L486-503：sessionKey + rootKey 双层互斥 Set），串行化执行，杜绝初始化与创建竞态。实现体仅两行核心逻辑：L754 检查 `options.git.initializeProject` 可用性（不可用 → operation_not_allowed `initializationUnsupported`），L755 调用 `await options.git.initializeProject(project.root)`，返回 `true`。
- 客户端两处入口（src/client/pre-session/PreSessionWorktreeToggle.tsx）已整体移除，不再适用。
- 确认文案明确列出将执行的三条命令与「只新增版本控制，不改动、不删除任何文件」。

## 否决的替代方案

- **照搬 panel 的静默 init**：把用户文件提交进版本库是不可逆的可见性变化（文件内容变历史），必须显式确认；与 initial-commit.ts 既有注释的保守立场（「ignored files、symlinks、嵌套仓库都需要显式用户决策」）一致。
- **对 kind `files` 复用 initializeEmptyRepository 的指纹 CAS**：CAS 保护的是 unborn HEAD 的 compare-and-swap（空树、无用户数据），add -A 提交涉及真实用户文件，指纹方案复杂度不成比例；用 withCreation 互斥 + 已有提交即拒绝足够。

## 后果

- 非 Git 目录从「报错死路」变成两步可用（确认初始化 → 常规创建）；.gitignore 忽略一切导致的空提交失败会以 initialCommitFailed 原样浮出。
- 管理面板（target-console）对非 Git 项目仍显示 unavailable——渐进增强只铺在预会话开关这个入口上。
