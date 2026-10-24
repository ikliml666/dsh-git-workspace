---
title: git spawn 预算与 list 延迟
type: learning
source_files:
  - src/adapters/git.ts
tags: [performance, spawn-budget, git, list-latency]
---

## Overview

- `ctx.subprocess.spawn` 的固定单价 ≈125ms（harness runner 启动税已由 harness 侧 `freshBuiltRunnerEntry` 从 ~358ms 修到 ~125ms）；list/current 的耗时几乎完全由 **spawn 次数 × 125ms** 解释。
- 在当前 `src/adapters/git.ts` 中，`inspect` 方法（行 256-322）正常路径通过单次 `rev-parse` 组合调用（行 261-263）加上并行的 `symbolic-ref`（行 259），将原本需要 4 次 spawn 的 inspect 压减至 2 次 spawn。这直接降低了上层观察的基础开销。
- 批量列表接口（如 `branchOverview` 行 469、`graphLog` 行 513、`listTags` 行 558）通过单次 spawn 返回多记录，避免上层循环调用导致 N×spawn 预算爆炸，是原“批量观察”杠杆在 `git.ts` 层的彻底实现。

## Key Components

`src/adapters/git.ts` 中的全部公开常量、函数与端口方法（行号以源码前缀为准）：

- 常量 `GIT_TERMINATION_GRACE_MS` (行 38)：终止宽限时间，独立于命令截止期。
- 常量 `GIT_COLLECT_BYTES` (行 40)：每流收集输出上限 1MB。
- 常量 `WIP_PATCH_COLLECT_BYTES` (行 42)：二进制 WIP 补丁收集上限 16MB。
- 函数 `parseDecoration` (行 63-71)：将 `%D` 装饰解析为引用名数组，标签保留 `tag:` 前缀。
- 函数 `settleCreationTree` (行 73-86)：等待创建树安静退出，10s 超时防护。
- 函数 `runGit` (行 93-188)：通过 `ctx.subprocess` 运行单个 git 命令的核心适配器，处理环境擦除、截止期与静默确认。
- 函数 `runGitChecked` (行 190-199)：运行 git 并在非零退出时抛出 `SessionCheckoutError`。
- 函数 `checkoutRefRoot` (行 201-204)：基于 checkoutId 哈希生成 `refs/dsh-worktree/session-checkouts/<key>` 命名空间。
- 函数 `assertArtifactName` (行 206-214)：校验内部构件名格式。
- 函数 `internalArtifactRef` (行 216-219)：拼接内部构件 ref。
- 函数 `applyBaseRef` (行 221-223)：返回 apply-base 构件 ref。
- 函数 `abandonedSnapshotRef` (行 230-233)：返回废弃快照 ref（位于 checkoutRefRoot 之外）。
- 函数 `hasGitMetadata` (行 235-246)：向上递归查找 `.git` 元数据。
- 函数 `createDshGitPort` (行 249-752)：构建并返回 `SessionCheckoutGitPort` 对象，内含全部 git 操作接口：
  - `inspect` (行 256-322)：单次 rev-parse 组合 + 并行 symbolic-ref，2 次 spawn 取仓库位置事实。
  - `findContainingWorktreeRoot` (行 323-330)
  - `status` (行 331-335)：调用 `git status --porcelain=v1 -z` 并结合 ProjectSkillStore 判断脏状态。
  - `createDetachedWorktree` (行 336-348)
  - `removeWorktree` (行 349-359)
  - `pruneWorktrees` (行 360-362)
  - `retainApplyBase` / `releaseApplyBase` (行 363-368)
  - `retainInternalArtifact` / `readInternalArtifact` (行 369-377)
  - `releaseInternalArtifacts` (行 378-388)：使用单次 `update-ref --stdin` 事务删除多个 ref，替代 1+N 次串行。
  - `isAncestor` (行 389-394)
  - `listLocalBranches` (行 395-398)
  - `resolveLocalBranchTip` (行 399-404)
  - `attachWorktreeBranch` (行 405-425)：仅动 ref 与 HEAD 指向，CAS 语义更新分支。
  - `pushBranch` (行 426-442)
  - `repairWorktreeLinks` (行 443-448)
  - `listWorktreeincludeFiles` (行 449-468)
  - `branchOverview` (行 469-485)：一次 `for-each-ref` + 一次 `status` 并行返回所有分支概览与脏计数。
  - `defaultBranch` (行 486-493)
  - `branchTipTimes` (行 494-507)
  - `deleteLocalBranch` (行 508-512)
  - `graphLog` (行 513-535)：单次 `log` 带 `--max-count` 与格式控制返回提交图。
  - `createLocalBranch` (行 536-545)
  - `switchLocalBranch` (行 546-557)
  - `listTags` (行 558-595)：一次 `for-each-ref` 列出标签，二次 `ls-remote` 标记远程推送状态。
  - `createTag` / `deleteLocalTag` / `pushTag` / `deleteRemoteTag` (行 596-628)
  - `mergeLocalBranch` (行 629-699)：含 dryRun 探测 worktree 与正式合并，收集冲突详情。
  - `captureLocalWip` (行 700-708)：使用 `WIP_PATCH_COLLECT_BYTES` 提升的收集上限捕获二进制补丁。
  - `applyWorktreePatch` (行 709-715)
  - `listUntrackedFiles` (行 716-720)
  - `snapshotAbandonedWorktree` (行 721-741)
  - `restoreAbandonedSnapshot` (行 742-750)
- 导出混合 (行 752)：`Object.assign(port, initialCommitActions(port.inspect, runSessionGit))` 混入初始提交动作。

## Architecture

```text
┌────────────────────────┐
│ createDshGitPort       │ (src/adapters/git.ts:249)
│ returns SessionCheckoutGitPort
└───────────┬────────────┘
            │ contains
            ▼
┌────────────────────────┐       ┌────────────────────────┐
│ inspect (行 256)       │       │ branchOverview (行 469)│
│ 2 spawns (合并杠杆)    │       │ 2 spawns (批量杠杆)    │
└───────────┬────────────┘       └───────────┬────────────┘
            │                                │
            ▼                                ▼
┌────────────────────────┐       ┌────────────────────────┐
│ runSessionGit (行 252) │       │ runSessionGit (行 252) │
│ -> runGit (行 93)      │       │ -> runGit (行 93)      │
└───────────┬────────────┘       └───────────┬────────────┘
            │                                │
            ▼                                ▼
┌────────────────────────┐
│ ctx.subprocess.spawn   │ (~125ms/次税)
└────────────────────────┘
```

基于当前 `git.ts` 的 spawn 预算杠杆：

1. **合并（git.ts 层 inspect）**：`symbolic-ref --quiet HEAD` 作为并行 promise 提前发起（行 259），挂 `catch(() => undefined)` noop 防 unhandledRejection（行 260），随后单次 `rev-parse --show-toplevel --path-format=absolute --git-common-dir --absolute-git-dir HEAD^{commit}` 一次性取全部位置事实（行 261-263）。输出按参数顺序一行一值，`lines.length === 4`（行 266）即解析成功；行数 ≠4 即回退逐项读取（换行路径歧义，行 279-321）；unborn/broken HEAD 分类逻辑原样保留在回退分支（行 298-321）。

2. **并行读（git.ts 层接口下沉）**：原 caller 层提前起 `statusPromise` 的逻辑，现由 `branchOverview`（行 469）内部通过 `Promise.all`（行 470-473）并行执行 `for-each-ref` 与 `status` 实现，将原本上层 3 次串行 reduce 为端口内的 2 次并行 spawn。

3. **批量观察（单次 spawn 聚合）**：`branchOverview`（行 469）、`graphLog`（行 513）、`listTags`（行 558）等接口直接通过单次 `for-each-ref` / `log` 返回全量记录，彻底消除了原上层 `observeManagedCheckouts` 对 `inspect` 的 `Promise.all` 映射（即 N 次 spawn）。`releaseInternalArtifacts`（行 378-388）更使用单次 `update-ref --stdin` 事务（start/delete/commit）替代 1+N 次串行 `update-ref -d`，将 N 个 ref 清理压减至 1 次 spawn。

## Data Flow

- 上层调用 `inspect(root)` → 触发 `runSessionGit(root, ['symbolic-ref', ...])` 与 `runSessionGit(root, ['rev-parse', ...])` 并发 → `runGit` 调用 `ctx.subprocess.spawn` 各计 1 次 → 合并输出解析为 `GitCheckoutSnapshot`。
- 批量列表场景：原多记录循环 observe 被 `branchOverview` 等批量接口吸收，数据流由 `for-each-ref` 单次输出按 `\r?\n` 与 `\0` 分割（行 475-483），直接映射为分支对象数组，spawn 预算从 O(N) 降为 O(1)。
- 标签列举流：`listTags` 先 `for-each-ref` 取全量（行 562-566），再用最佳努力的 `ls-remote` 标记 `pushed` 状态（行 587-593），两次 spawn 覆盖全量标签与远程同步。

## Connections

- 依赖 `[[dsh-git-worktree-project-skills]]`（`ProjectSkillStore` 来自 `./project-skills.js` 行 1，用于 `status` 与 `createDetachedWorktree` 的 Skill 路径保护）。
- 依赖 `[[dsh-git-worktree-worktree-creation]]`（`createWorktree` 来自 `./worktree-creation.js` 行 2，被 `createDetachedWorktree` 调用）。
- 依赖 `[[dsh-git-worktree-options]]`（`gitTimeoutMs` 等来自 `./git-options.js` 行 3，决定 spawn 截止期预算）。
- 依赖 `[[dsh-git-worktree-initial-commit]]`（`initialCommitActions` 来自 `./initial-commit.js` 行 4，混入端口）。
- 底层能力来自 `[[dsh-subprocess]]`（`ctx.subprocess.spawn` 提供树作用域终止与有界输出收集）。

## Known Issues

- 合并调用的 `not-a-repo → null` 判定基于 stderr 分类（行 279，匹配 `/^fatal: not a git repository/` 且 `!await hasGitMetadata(root)` 辅助判断）；合并调用失败但非 not-a-repo 时走原逐项路径二次分类（行 282-321），不会误判。
- `symbolicPromise` 的 noop catch（行 260）仅防止未处理拒绝冒泡，合并调用 `combined` 的结果解析或回退分支中的 `throw new SessionCheckoutError` 仍会正确消费错误（如行 285、行 307）。
- `releaseInternalArtifacts` 的单次 `update-ref --stdin` 事务（行 386）若失败则整体抛出 `SessionCheckoutError`（行 387），无部分删除或静默丢失 ref 的风险。
- `branchOverview` 依赖 `for-each-ref` 格式严格按 `%00` 与 `\r?\n` 分割（行 471、475），若 refname 含不可预期字符仍由 `filter(Boolean)` 与 oid 正则（行 483）兜底，避免脏数据进入面板。
- 回退路径中 `paths.length === 2` 的判断（行 294-297）依赖 `rev-parse` 多值输出的行数；遇到 POSIX 合法换行路径时主动降级为单次 `rev-parse` 读取，确保路径解析安全。