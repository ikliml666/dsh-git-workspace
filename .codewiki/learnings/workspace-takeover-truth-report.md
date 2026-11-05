---
title: "Learning: 接管谎报 —— patch 未合并时必须上报 officialWorkspaceActive: true"
type: learning
source_files: []
tags: []
---

# Learning: 接管谎报 —— patch 未合并时必须上报 officialWorkspaceActive: true

日期：2026-10-11　提交：edce4a7　分支：fix/sess-session--workspace-takeover-fallback

## 现象

宿主重装（DeepSeek Harness.exe + app.asar 2026-10-10 23:02 重写，版本仍 0.2.0-rc.2）后，desktop profile 的 dsh-git-worktree 侧边栏连续 boot 失败：sidebar-diag.ndjson 里 client 行 `registered:false`，detail 两种——`inject-pending`（瞬态）与 `service "uiWorkspace" has been registered at <mf>`（真错）。最后一次成功接管是 10-10 23:22。

## 根因（三层叠加）

1. **profile write-back**：宿主 internal/plugin 事件会把 fiber.entry 的 disabled 状态写回 cordis.yml。10-11 09:41 的 write-back 把 ui-workspace 条目重写回 `disabled: false`，插件 cordis.patch.yml 的 disabled jsExpr（`{__jsExpr: WORKSPACE_PROVIDER_CONDITION}`）没进 live tree。
2. **patch 合并失败是静默的**：宿主 dsh-app-boot loadProfileDirectory 对失败 bundle 只进 skippedBundles，无任何用户可见报错。
3. **谎报（本插件 bug，本次修复点）**：`mountWorkspaceProviderLifecycle` 尾部无条件 `return { officialWorkspaceActive: false }`，不检查 `owned()` 是否为空、disable 是否真的发生。Web 客户端（lib/client.js modern 分支）见 false 走 managed 路径 `registerManagedWorkspaceSidebar(child, adapter, apply$2)`——重放官方 apply → `new UiWorkspaceService` 构造器 provide('uiWorkspace') → 官方 uiWorkspace 还活着 → cordis index.js:813 抛 `service "uiWorkspace" has been registered at <mf>`（`<mf>` 是 cordis 取最近具名 runtime 的 fiber.name）。

## 修复原则

**topology 响应必须反映真实结果，不能声明一个没验证过的状态。** 选举后逐个 owned 条目核算：`entry.disabled === true`（或操作仍 inFlight、求值抛错——保守视为接管中）→ 接管成立；owned 为空或 disable 后仍可求值为 false → `officialWorkspaceActive: true`，客户端落到 decorated 共存分支（官方 Workspace 活着时的安全路径）。decorate 分支本就是官方存活时的正确降级，不重放 apply、无注册冲突。

## 教训

- 「先声明接管、后补 reconcile」的模式在 patch 层可能整个缺失时是错的：声明必须以 owned() 实际状态为准。
- profile write-back 会抹掉 patch 层注入的 jsExpr——不能假设「昨晚能跑今早就能跑」，宿主重装/重启都可能重写 cordis.yml。
- 排查这类问题时 sidebar-diag.ndjson 的 client 行 detail 是唯一现场；`inject-pending` 是正常瞬态，`has been registered` 才是判定信号。

## 相关

- `src/workspace-provider-lifecycle.ts`（WORKSPACE_PROVIDER_CONDITION :5、owned :75、reconcile :119、结果核算 :167-186）
- `tests/workspace-provider-lifecycle.test.ts`（25 用例，real Cordis Loader fixture）
- CHANGELOG 2026-10-11 条目
