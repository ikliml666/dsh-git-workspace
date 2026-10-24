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

dsh-git-worktree 插件通过宿主 settings 服务将 `Config` schema 中标为 volatile 的字段投影为设置表单，写入 `cordis.patch.yml` 且通过 revision CAS 生效。宿主 settings `schema.ts` 读取 `meta.volatile`（见 `src/index.ts:238` 注释）。volatile 编辑**不重挂载插件**：`apply` 不重跑，配置值以 `LiveValue<T>`（即 `{ get(): T }`）形式到达（见 `src/ports.ts:533-536`）。

## 决策

1. **7 个字段标 volatile**：`src/index.ts` 的 `Config` 用 `z.object()` 定义（行 244-293）。以下字段通过 `volatile()` 助手（行 239-242，设 `schema.meta.volatile = true`）包装：
   - `gitTimeoutMs`（行 254）：`volatile(z.number().min(1_000).max(MAX_GIT_TIMEOUT_MS).step(1).default(DEFAULT_GIT_TIMEOUT_MS))`
   - `worktreeAddTimeoutMs`（行 255）：`volatile(z.number().min(1_000).max(MAX_GIT_TIMEOUT_MS).step(1).default(300_000))`
   - `autoDeliver`（行 262）：`volatile(z.boolean().default(true))`
   - `autoPush`（行 267）：`volatile(z.boolean().default(true))`
   - `worktreesRoot`（行 274）：`volatile(z.string())`
   - `inheritLocalChanges`（行 280）：`volatile(z.boolean().default(true))`
   - `worktreeKeepCount`（行 285）：`volatile(z.number().min(0).max(500).step(1).default(15))`
   `stateDir`（行 251）与 `enableWorkspaceProvider`（行 292）保持非 volatile——前者是启动期目录（`resolveStateDir` 在 `apply` 期解析并 `mkdirSync`，见行 309-313、336-339），后者是 Workspace 接管开关（`mountWorkspaceProviderLifecycle` 在行 335 使用，语义上挂载期决策，重启生效）。

2. **类型上显式建模 LiveValue 与依赖接口**：`src/ports.ts` 定义 `LiveValue<T> { get(): T }`（行 533-536）与 `liveConfigValue(value)` duck-type 解包（行 538-544，判断 `typeof (value as { get?: unknown } | undefined)?.get === 'function'`；不引 cosmokit 依赖）。`SessionCheckoutDependencies` 接口（行 546-577）字段含 `lookup`、`git`、`files`、`registry`、`applyEngine`、`managedCheckoutsRoot`、`createCheckoutId()`，以及放宽为 `T | LiveValue<T>` 的 volatile 字段：`autoPush`（行 555）、`autoDeliver`（行 557）、`worktreesRoot`（行 563）、`inheritLocalChanges`（行 570）、`worktreeKeepCount`（行 577）。`GitTimeoutOptions`（`src/adapters/git-options.ts` 行 3-6）含 `gitTimeoutMs?` 与 `worktreeAddTimeoutMs?`，均放宽为 `number | LiveValue<number | undefined>`。此外 `src/index.ts` 的 `LocalAdaptationConfig` 接口（行 295-302）字段含 `autoDeliver?`、`autoPush?`、`worktreesRoot?`、`inheritLocalChanges?`、`worktreeKeepCount?`、`enableWorkspaceProvider?`，前 5 者类型定义为 `boolean | LiveValue<boolean | undefined>` 或 `string | LiveValue<string | undefined>` 等。

3. **消费点逐次解包**，不做启动期归一：
   - `src/adapters/git-options.ts` 的 `gitTimeoutMs(args, options)` 函数（行 21-27）对 `worktree add` 解包 `worktreeAddTimeoutMs`（默认 `DEFAULT_WORKTREE_ADD_TIMEOUT_MS = 5*60_000`，见行 9），`worktree remove` 硬编码 300000，其他解包 `gitTimeoutMs`（默认 `DEFAULT_GIT_TIMEOUT_MS = 120_000`，见行 8）；`validateGitTimeouts`（行 12-19）校验时也逐次解包。设置页改超时对下一条 git 命令即生效。
   - `src/index.ts` 行 239-242 `volatile()` 助手设 `schema.meta.volatile = true`（宿主读 `meta.volatile`）。
   - `src/index.ts` 行 304-307 `resolveWorktreesRootValue(raw)` 延迟到读时解析 relative→absolute（`liveConfigValue(raw)?.trim()` 后 `resolve(value)`）；`src/index.ts` 行 342-345 `apply()` 传入 `{ get: () => resolveWorktreesRootValue(worktreesRootInput) }` 包装器（中途改根目录只影响之后新建的 worktree，既有 registry 的 `managedRoot` 是绝对路径不受影响）。
   - `src/index.ts` 行 330 `apply()` 将 `autoDeliver`/`autoPush`/`inheritLocalChanges`/`worktreeKeepCount`（行 361-364）直接透传给 `createSessionCheckoutModule`，模块内部逐次解包；`gitTimeoutMs`/`worktreeAddTimeoutMs` 透传给 `createDshGitPort`（行 349）。

4. **客户端卡片自建**：`src/client/settings-card/index.ts` 的 `mountSettingsCard(ctx)`（行 35-57）fail-soft 探测 `configForms` 与 `slots`（行 39-40 用 `ctx.get()` 读服务），照抄 `whileServed` + `plugins.bundle.config` 模式（行 52-56）挂载 `WorktreeSettingsCard`。`src/client/settings-card/worktree-settings-card.ts` 定义常量 `WORKTREE_SETTINGS_NS = 'dsh-git-worktree'`（行 14）；`WorktreeSettings` 接口（行 17-23）含 5 个 volatile 字段映射（`autoDeliver?`、`autoPush?`、`worktreesRoot?`、`gitTimeoutMs?`、`worktreeAddTimeoutMs?`；不含 `inheritLocalChanges`/`worktreeKeepCount`）；`WorktreeSettingsCardState` 接口（行 26-32）继承 `SettingsFormShell` 并含上述 5 个 `SettingsFieldState` 字段；`WorktreeSettingsCardFace` 接口（行 35-37）继承 `SettingsFormActions` 并含 `hooks: { worktreeCard: SnapshotStore<WorktreeSettingsCardState> }`；`WorktreeSettingsCardController` 类（行 39-69）构造器（行 43-52）通过 `SettingsFormModel` 绑定 5 个 field（`settingsBooleanField('autoDeliver')`、`settingsBooleanField('autoPush')`、`settingsTextField('worktreesRoot')`、`settingsNumberField('gitTimeoutMs')`、`settingsNumberField('worktreeAddTimeoutMs')`），方法含 `projection()`（行 54-63，返回 `WorktreeSettingsCardState`）、`inject()`（行 65-67，返回 `WorktreeSettingsCardFace`）、`dispose()`（行 69，释放 form）。

### 配置流架构

```text
┌────────────────┐  volatile meta  ┌──────────────────┐
│ Settings Page  │ ──────────────► │ Host schema.ts   │
│ (client/*.ts)  │ ── patch.yml ──► │ cordis config    │
└────────────────┘                 └──────────────────┘
        │                                   │ LiveValue<T>
        │                                   ▼
┌────────────────┐                 ┌──────────────────┐
│ mountSettings  │                 │ apply() (index)  │
│ Card (35-57)   │                 │ liveConfigValue  │
└────────────────┘                 └──────────────────┘
                                           │
                           ┌───────────────┼───────────────┐
                           ▼               ▼               ▼
                   ┌──────────────┐┌──────────────┐┌──────────────┐
                   │ git-options  ││ createSess   ││ resolveRoot  │
                   │ (21-27)      ││ ionModule    ││ Value        │
                   └──────────────┘└──────────────┘└──────────────┘
```

## 后果与映射

- 设置页改 volatile 字段即时生效、零重挂载；代价是所有消费点必须逐次解包，新增消费点忘记解包会在 typecheck 阶段被抓出（类型是显式联合 `T | LiveValue<T>`）。
- **孤儿工作区自愈映射**：设置页暴露 `worktreesRoot` 后，改根目录可能留下旧根下的孤儿 worktree。无需新代码——`module.reconcile()`（`SessionCheckoutModule` 接口的 `reconcile` 方法定义于 `src/index.ts:201`，启动时 `ctx.events.on('ready')` 于行 384-398 调用）已有孤儿检测（`SessionCheckoutReconcileSummary` 接口定义于行 55-61，含全部字段 `recoveryRequiredCheckoutIds`、`orphanedCheckoutIds`、`dirtyOrphanedCheckoutIds`、`staleRootCheckoutIds`、`retainedCheckoutCount`），路径候选解析本身也按当前值逐次进行（`resolveWorktreesRootValue` 定义于行 304-307，在 `apply` 中于行 342-345 包装为 live getter）。运维口径：换根目录后旧根目录可整目录手工删除，reconcile 会按当前配置把状态收敛到新根。
- `autoDeliver`/`autoPush` 的 `?? true` 归一从 apply 期移到消费期：未设置 = true 的语义不变（`Config` 里 `z.boolean().default(true)` 定义于行 262/267，live ref 解包后未定义则走默认）。
- `isAutoDeliverEnabled()` 模块方法（`SessionCheckoutModule` 接口 `src/index.ts:170`）实时读取 volatile 值，工具层在其关闭时拒绝 model-driven delivery（`registerTools` 于行 377 注册的工具会检查）。

## 参考

- 宿主机制：packages/settings/settings/src/index.ts + schema.ts（isVolatilePath/meta.volatile；见 `src/index.ts:238` 注释）
- 模块说明：[[settings-card]]
- 关联：[[host-overview]] 配置模式、[[adapters]] git-options
- 客户端卡片：[[client-settings-card]]（`src/client/settings-card/index.ts` 与 `worktree-settings-card.ts`）