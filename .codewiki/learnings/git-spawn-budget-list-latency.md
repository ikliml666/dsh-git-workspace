---
title: git spawn 预算与 list 延迟
type: learning
source_files:
  - src/adapters/git.ts
tags: [performance, spawn-budget, git, list-latency]
---

## Overview

- `ctx.subprocess.spawn` 的固定单价约 125ms（harness runner 启动税）；list/current 的耗时几乎完全由 **spawn 次数 × 125ms** 解释。
- 在当前 `src/adapters/git.ts` 中，`inspect` 方法（行 256-322）正常路径通过单次 `rev-parse` 组合调用（行 261-263）加上并行的 `symbolic-ref`（行 259），将原本需要多次 spawn 的 inspect 压减至 2 次 spawn。这直接降低了上层观察的基础开销。
- 批量列表接口（如 `branchOverview` 行 469、`graphLog` 行 533、`listTags` 行 578、`branchCreationTimes` 行 508）通过单次 spawn 返回多记录，避免上层循环调用导致 N×spawn 预算爆炸，是原“批量观察”杠杆在 `git.ts` 层的彻底实现。
- `releaseInternalArtifacts`（行 378-388）将原逐个 `update-ref -d` 的 1+N 次串行删除优化为单次 `update-ref --stdin` 事务（行 386），进一步压减了 Ref 清理的 spawn 预算。

## Key Components

`src/adapters/git.ts` 中的全部公开常量、接口、函数与端口方法（行号以源码前缀为准）：

- 常量 `GIT_TERMINATION_GRACE_MS` (行 38)：终止宽限时间（1_000ms），独立于命令截止期。
- 常量 `GIT_COLLECT_BYTES` (行 40)：每流收集输出上限 1MB（1 << 20）。
- 常量 `WIP_PATCH_COLLECT_BYTES` (行 42)：二进制 WIP 补丁收集上限 16MB（16 << 20）。
- 接口 `GitPortOptions` (行 44-48)：继承 `GitTimeoutOptions`，定义 `hooksPath: string` 与可选 `projectSkills?: ProjectSkillStore`。
- 接口 `GitCommandResult` (行 50-56)：定义命令结果 `code: number`、`stdout: string`、`stderr: string` 及可选的 `quiescent?: boolean` 标志。
- 函数 `parseDecoration` (行 63-71)：将 `%D` 装饰解析为引用名数组，标签保留 `tag:` 前缀，剥离 `HEAD -> ` 前缀。
- 函数 `settleCreationTree` (行 73-86)：等待创建树安静退出，10s 超时防护，通过 `handle.terminate()` 与 `handle.waitForExit()` 确认。
- 函数 `runGit` (行 93-188)：通过 `ctx.subprocess` 运行单个 git 命令的核心适配器，处理环境擦除、截止期与静默确认，支持 `creation` 参数判断安静退出。
- 函数 `runGitChecked` (行 190-199)：运行 git 并在非零退出时抛出 `SessionCheckoutError`。
- 函数 `checkoutRefRoot` (行 201-204)：基于 checkoutId 哈希生成 `refs/dsh-worktree/session-checkouts/<key>` 命名空间。
- 函数 `assertArtifactName` (行 206-214)：校验内部构件名格式（仅允许字母数字及 `._-`）。
- 函数 `internalArtifactRef` (行 216-219)：拼接内部构件 ref。
- 函数 `applyBaseRef` (行 221-223)：返回 apply-base 构件 ref。
- 函数 `abandonedSnapshotRef` (行 230-233)：返回废弃快照 ref（位于 checkoutRefRoot 之外，避免随 checkout 丢弃）。
- 函数 `hasGitMetadata` (行 235-246)：向上递归查找 `.git` 元数据判断是否为 git 仓库。
- 函数 `createDshGitPort` (行 249-773)：构建并返回 `SessionCheckoutGitPort` 对象，内含全部 git 操作接口：
  - `inspect` (行 256-322)：单次 rev-parse 组合 + 并行 symbolic-ref，2 次 spawn 取仓库位置事实，含 unborn/broken HEAD 回退分支。
  - `findContainingWorktreeRoot` (行 323-330)：解析包含当前路径的 worktree 根目录。
  - `status` (行 331-335)：调用 `git status --porcelain=v1 -z` 并结合 ProjectSkillStore 判断脏状态。
  - `createDetachedWorktree` (行 336-348)：创建 detached worktree，检查 Skill 变更并携带 Skill 快照。
  - `removeWorktree` (行 349-359)：强制移除 worktree 并校验 Skill 路径可删除。
  - `pruneWorktrees` (行 360-362)：`git worktree prune --expire now`。
  - `retainApplyBase` / `releaseApplyBase` (行 363-368)：保存/释放 apply-base ref。
  - `retainInternalArtifact` / `readInternalArtifact` (行 369-377)：保存/读取内部构件 ref。
  - `releaseInternalArtifacts` (行 378-388)：使用单次 `update-ref --stdin` 事务删除多个 ref，替代 1+N 次串行。
  - `isAncestor` (行 389-394)：`merge-base --is-ancestor` 判断提交祖先关系。
  - `listLocalBranches` (行 395-398)：`for-each-ref` 列出本地分支并排序。
  - `resolveLocalBranchTip` (行 399-404)：解析本地分支 tip OID。
  - `attachWorktreeBranch` (行 405-425)：仅动 ref 与 HEAD 指向，CAS 语义更新分支，避免覆盖并发会话提交。
  - `pushBranch` (行 426-442)：推送当前分支到已配置上游，无上游则跳过。
  - `repairWorktreeLinks` (行 443-448)：仓库移动后修复 worktree 链接。
  - `listWorktreeincludeFiles` (行 449-468)：取交集忽略且被 `.worktreeinclude` 匹配的文件列表。
  - `branchOverview` (行 469-485)：一次 `for-each-ref` + 一次 `status` 并行返回所有分支概览与脏计数。
  - `defaultBranch` (行 486-493)：从 origin HEAD 或 `init.defaultBranch` 获取默认分支。
  - `branchTipTimes` (行 494-507)：`for-each-ref` 获取各分支 tip 的 committerdate 时间戳。
  - `branchCreationTimes` (行 508-527)：单次 `reflog show --all` 聚合所有分支的 `branch: Created from` 记录解析创建时间。
  - `deleteLocalBranch` (行 528-532)：`branch -d` 删除本地分支。
  - `graphLog` (行 533-555)：单次 `log` 带 `--max-count` 与格式控制返回提交图，解析 `%D` 装饰。
  - `createLocalBranch` (行 556-565)：`check-ref-format` 校验后从 HEAD 创建本地分支。
  - `switchLocalBranch` (行 566-577)：`switch` 切换分支，处理 worktree 占用错误。
  - `listTags` (行 578-615)：一次 `for-each-ref` 列出标签（含注释标签剥离），二次 `ls-remote` 标记远程推送状态。
  - `createTag` / `deleteLocalTag` / `pushTag` / `deleteRemoteTag` (行 616-648)：标签创建（支持 annotated）、删除、推送与远程删除。
  - `mergeLocalBranch` (行 649-719)：含 dryRun 探测 worktree 与正式合并，收集冲突详情并支持合并后不 abort。
  - `captureLocalWip` (行 720-728)：使用 `WIP_PATCH_COLLECT_BYTES` 提升的收集上限捕获二进制补丁（`diff --binary`）。
  - `applyWorktreePatch` (行 729-735)：原子应用 `git apply --binary` 补丁。
  - `listUntrackedFiles` (行 736-740)：列出非 ignore 的 untracked 文件。
  - `snapshotAbandonedWorktree` (行 741-761)：add -A 后 write-tree/commit-tree 生成快照提交，并更新 abandoned ref。
  - `restoreAbandonedSnapshot` (行 762-770)：从废弃快照创建恢复分支并清理 abandoned ref。
- 导出混合 (行 772)：`Object.assign(port, initialCommitActions(port.inspect, runSessionGit))` 混入初始提交动作。

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

2. **并行读（git.ts 层接口下沉）**：原 caller 层提前起 `statusPromise` 的逻辑，现由 `branchOverview`（行 469）内部通过 `Promise.all`（行 470-473）并行执行 `for-each-ref` 与 `status` 实现，将原本上层多次串行 reduce 为端口内的 2 次并行 spawn。

3. **批量观察（单次 spawn 聚合）**：`branchOverview`（行 469）、`graphLog`（行 533）、`listTags`（行 578）、`branchCreationTimes`（行 508）等接口直接通过单次 `for-each-ref` / `log` / `reflog` 返回全量记录，彻底消除了原上层对 `inspect` 的 `Promise.all` 映射（即 N 次 spawn）。`releaseInternalArtifacts`（行 378-388）更使用单次 `update-ref --stdin` 事务（start/delete/commit）替代 1+N 次串行 `update-ref -d`，将 N 个 ref 清理压减至 1 次 spawn。

## Data Flow

- 上层调用 `inspect(root)` → 触发 `runSessionGit(root, ['symbolic-ref', ...])` 与 `runSessionGit(root, ['rev-parse', ...])` 并发（行 259、261-263） → `runGit` 调用 `ctx.subprocess.spawn` 各计 1 次（行 101-132） → 合并输出解析为 `GitCheckoutSnapshot`（行 264-277）。
- 批量列表场景：原多记录循环 observe 被 `branchOverview`（行 469-485）、`graphLog`（行 533-555）、`listTags`（行 578-615）等批量接口吸收，数据流由 `for-each-ref` / `log` 单次输出按 `\r?\n` 与 `\0` 分割（如行 475-483、543-554、588-606），直接映射为对象数组，spawn 预算从 O(N) 降为 O(1)。
- 标签列举流：`listTags` 先 `for-each-ref` 取全量（行 582-586），再用最佳努力的 `ls-remote` 标记 `pushed` 状态（行 607-613），两次 spawn 覆盖全量标签与远程同步。
- 分支创建时间流：`branchCreationTimes` 通过单次 `reflog show --all` 聚合所有分支的 `branch: Created from` 记录（行 512-515），在单次 spawn 内按 reflog 选择器解析创建时间（行 517-525）。
- Ref 释放流：`releaseInternalArtifacts` 先 `for-each-ref` 列出前缀匹配 ref（行 382），构造 `start\n${refs.map(ref => 'delete '+ref).join('\n')}\ncommit\n` 标准输入，单次调用 `update-ref --stdin`（行 386）完成事务删除。

## Connections

- 依赖 `[[dsh-git-worktree-project-skills]]`（`ProjectSkillStore` 来自 `./project-skills.js` 行 1，用于 `status` 行 333 与 `createDetachedWorktree` 行 337 的 Skill 路径保护）。
- 依赖 `[[dsh-git-worktree-worktree-creation]]`（`createWorktree` 来自 `./worktree-creation.js` 行 2，被 `createDetachedWorktree` 行 342 调用）。
- 依赖 `[[dsh-git-worktree-options]]`（`gitTimeoutMs` 等来自 `./git-options.js` 行 3，决定 spawn 截止期预算，如行 94、341）。
- 依赖 `[[dsh-git-worktree-initial-commit]]`（`initialCommitActions` 来自 `./initial-commit.js` 行 4，混入端口行 772）。
- 底层能力来自 `[[dsh-subprocess]]`（`ctx.subprocess.spawn` 提供树作用域终止与有界输出收集，类型 `SubprocessHandle` 来自行 31，在 `runGit` 行 101 使用）。

## Known Issues

- 合并调用的 `not-a-repo → null` 判定基于 stderr 分类（行 279 与行 284，匹配 `/^fatal: not a git repository/` 且 `!await hasGitMetadata(root)` 辅助判断）；合并调用失败但非 not-a-repo 时走原逐项路径二次分类（行 282-321），不会误判。
- `symbolicPromise` 的 noop catch（行 260）仅防止未处理拒绝冒泡，合并调用 `combined` 的结果解析或回退分支中的 `throw new SessionCheckoutError` 仍会正确消费错误（如行 285、行 307）。
- `releaseInternalArtifacts` 的单次 `update-ref --stdin` 事务（行 386）若失败则整体抛出 `SessionCheckoutError`（行 387），无部分删除或静默丢失 ref 的风险。
- `branchOverview` 依赖 `for-each-ref` 格式严格按 `%00` 与 `\r?\n` 分割（行 471、475），若 refname 含不可预期字符仍由 `filter(Boolean)` 与 oid 正则（行 483）兜底，避免脏数据进入面板。
- 回退路径中 `paths.length === 2` 的判断（行 294-297）依赖 `rev-parse` 多值输出的行数；遇到 POSIX 合法换行路径时主动降级为单次 `rev-parse` 读取，确保路径解析安全。
- `branchCreationTimes` 解析 reflog 时通过正则剥离工作树选择器（行 520），仅当 subject 以 `branch: Created from` 开头才计入（行 519），避免把普通 reflog 误判为分支创建；若 reflog 丢失则 `return undefined`（行 515），不影响其他列表。
