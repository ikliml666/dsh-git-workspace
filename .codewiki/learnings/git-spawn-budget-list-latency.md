---
title: git spawn 预算与 list 延迟
type: learning
source_files:
  - src/adapters/git.ts
  - src/session-checkout-module.ts
  - src/console-host/control-plane.ts
tags: [performance, spawn-budget, git, list-latency]
---

# git spawn 预算与 list 延迟

## 现象与成本模型

- dsh web 源码模式下每次 `ctx.subprocess.spawn` 的固定单价 ≈125ms（harness runner 启动税已由 harness 侧 `freshBuiltRunnerEntry` 从 ~358ms 修到 ~125ms）；list/current 的耗时几乎完全由 **spawn 次数 × 125ms** 解释。
- 修复前 list 链 spawn 计数：callerTarget `inspectLocal` 5（inspect 4 + status 1，全串行）+ 每条记录 observe 9（`validateManagedCheckoutDetailed` 双端 inspect 8 + status 1，全串行）。3 条记录 ≈ 32 次 spawn ≈ 3.6s（实测 3647ms 吻合）。

## 三个杠杆（2026-09-29 实施后）

1. **合并**：`git.inspect` 4 次顺序调用（toplevel / commondir+gitdir / HEAD / symbolic-ref）合并为 1 次 `rev-parse` + 并行 `symbolic-ref`。输出按参数顺序一行一值，行数 ≠4 即回退逐项读取（换行路径歧义）；unborn/broken HEAD 分类逻辑原样保留在回退分支。
2. **并行读**：`inspectLocal` 与 `validateManagedCheckoutDetailed` 的独立 git 读并发化。要保留「失败才抛」语义：提前起 status promise 并立即挂 `promise.catch(() => undefined)` noop 防 unhandledRejection，仅在原逻辑会消费它的路径 `await`。
3. **批量**：`observeManagedCheckouts(checkoutIds)` 一次 `withBindingLock` 内 `Promise.all` 并行验证。当年 client-rpc-watchdog 决策否决「客户端并行 observe」的理由正是锁内重串行化——正确解法是把并行移到**锁内**（服务端改锁粒度），而不是客户端发并发请求。

## 安全边界

- 锁内并行验证是安全的：exclusive 锁下没有 mutation 交错，读的是同一 registry 快照；并行不会引入竞态。
- 逐条 observe 的错误语义（checkout_missing / checkout_mismatch 整体抛出）在批量入口保持一致。
- `not-a-repo → null` 判定基于合并调用的 stderr 分类；合并调用失败但非 not-a-repo 时走原逐项路径二次分类，不会误判。
