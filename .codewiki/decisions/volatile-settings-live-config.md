---
title: "volatile 设置字段与 LiveValue 运行时解包"
type: decision
source_files:
  - src/index.ts
  - src/ports.ts
  - src/adapters/git-options.ts
  - src/client/settings-card/index.ts
  - src/client/settings-card/worktree-settings-card.ts
tags:
  - volatile-config
  - settings
  - live-ref
  - decision
---

# 设置页走 volatile 字段 + LiveValue 逐次解包

**日期**: 2026-09-28 · **状态**: 已实施

## 背景

dsh-worktree-panel 有插件设置页；DSH 的等价机制是 settings 服务把 Config schema 的 volatile 字段投影为设置表单（写入 `cordis.patch.yml`，revision CAS）。volatile 编辑**不重挂载插件**：`apply` 不重跑，配置值以 `{get()}` LiveRef 到达。

## 决策

1. **7 个字段标 volatile**：`gitTimeoutMs`、`worktreeAddTimeoutMs`、`autoDeliver`、`autoPush`、`worktreesRoot`、`inheritLocalChanges`、`worktreeKeepCount`。`stateDir` 与 `enableWorkspaceProvider` 保持非 volatile——前者是启动期目录（中途改会撕裂已写状态），后者是 Workspace 接管开关（挂载期决策，语义上就该重启生效）。

2. **类型上显式建模 LiveRef**：`src/ports.ts` 定义 `LiveValue<T> { get(): T }`（line 462–464）与 `liveConfigValue(value)` duck-type 解包（line 467–472，`typeof (value as { get?: unknown } | undefined)?.get === 'function'`；不引 cosmokit 依赖）。`SessionCheckoutDependencies` 的 `autoPush`/`autoDeliver`/`worktreesRoot`/`inheritLocalChanges`/`worktreeKeepCount` 与 `GitTimeoutOptions` 的两个超时字段都放宽为 `T | LiveValue<T>`（ports.ts:483–505, git-options.ts:3–6）。

3. **消费点逐次解包**，不做启动期归一：
   - `session-checkout-module.ts:908` `runtimeContext` → `(liveConfigValue(dependencies.autoDeliver) ?? true)`；
   - `session-checkout-module.ts:3232` `operateFinish` → `(liveConfigValue(dependencies.autoPush) ?? true)`；
   - `session-checkout-module.ts:2597` `collectEmptyManagedContainer` → `liveConfigValue(dependencies.worktreesRoot)`；
   - `bindTarget` → `liveConfigValue(dependencies.worktreesRoot)`；relative→absolute 解析在 `index.ts:287–290` 的 `resolveWorktreesRootValue()` 中延迟到读时，`index.ts:317–320` `apply()` 传入 `{ get: () => resolveWorktreesRootValue(worktreesRootInput) }` 包装器（中途改根目录只影响之后新建的 worktree，既有 registry 的 managedRoot 是绝对路径不受影响）；
   - `git-options.ts` `validateGitTimeouts:14` 每条命令解包（`liveConfigValue(options[key])`，line 14；`gitTimeoutMs:21–27` 对 worktree add/remove/其他分别解包，设置页改超时对下一条 git 命令即生效）。
   - `inheritLocalChanges` 与 `worktreeKeepCount` 同样通过 LiveValue 联合类型传递，消费端逐次解包（`session-checkout-module.ts:4032` `enforceWorktreeKeepCount` `liveConfigValue(dependencies.worktreeKeepCount)`）。

4. **schemastery 3.18.2 无 .volatile() 方法** → `src/index.ts` 本地 `volatile()` 助手（line 223–226）设 `schema.meta.volatile = true`（宿主读的是 meta.volatile，不是方法）。Config schema 用 `z.object()` 定义（index.ts:228–276），volatile 字段包括 `gitTimeoutMs(:238)`、`worktreeAddTimeoutMs(:239)`、`autoDeliver(:246)`、`autoPush(:251)`、`worktreesRoot(:258)`、`inheritLocalChanges(:264)`、`worktreeKeepCount(:269)`。

5. **客户端卡片自建**：`src/client/settings-card/index.ts`（line 35–57）vendored form-model.js + `settingsBooleanField`/`settingsNumberField`/`settingsTextField`；`mountSettingsCard(ctx)` fail-soft 探测 configForms/slots，照抄 ui-settings-shell 的 whileServed + plugins.bundle.config 模式。不调用 settings.configure（宿主无抑制 autoGenerate 的先例，通用页保留为高级编辑器）。`worktree-settings-card.ts` 定义了 `WorktreeSettings` 接口（line 17–23）含 5 个 volatile 字段映射，`WorktreeSettingsCardController` 通过 `SettingsFormModel` 绑定 5 个 field（line 44–50）。

## 后果与映射

- 设置页改 volatile 字段即时生效、零重挂载；代价是所有消费点必须逐次解包，新增消费点忘记解包会在 typecheck 阶段被抓出（类型是显式联合）。
- **孤儿工作区自愈映射**：设置页暴露 worktreesRoot 后，改根目录可能留下旧根下的孤儿 worktree。无需新代码——module.reconcile() 已有孤儿检测（registry 有记录但目录缺失→recovery；目录存在但 registry 无记录→不碰用户字节），路径候选解析本身也按当前值逐次进行。运维口径：换根目录后旧根目录可整目录手工删除，reconcile 会按当前配置把状态收敛到新根。
- `autoDeliver`/`autoPush` 的 `?? true` 归一从 apply 期移到消费期：未设置 = true 的语义不变，但翻转 live ref 后**下一条指引/下一次交付**即按新值执行（有测试锁定）。
- `isAutoDeliverEnabled()` 模块方法（session-checkout-module.ts 导出接口，index.ts:162）实时读取 volatile 值，工具层在其关闭时拒绝 model-driven delivery。

## 参考

- 宿主机制：packages/settings/settings/src/index.ts + schema.ts（isVolatilePath/meta.volatile）
- 模块说明：[[settings-card]]
- 关联：[[host-overview]] 配置模式、[[adapters]] git-options