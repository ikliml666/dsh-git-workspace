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

## Overview

dsh-git-worktree 插件通过宿主 settings 服务将 `Config` schema 中标为 volatile 的字段投影为设置表单，写入 `cordis.patch.yml` 且通过 revision CAS 生效。宿主 settings `schema.ts` 读取 `meta.volatile`（见 `src/index.ts:244` 注释）。volatile 编辑**不重挂载插件**：`apply` 不重跑，配置值以 `LiveValue<T>`（即 `{ get(): T }`）形式到达（见 `src/ports.ts:551-553`）。

当前代码相较旧版新增了 `branchRaceGuard` 与 `branchRaceWindowMs` 两个 volatile 字段，使 volatile 字段总数达到 9 个；客户端设置卡片仍仅编辑其中 5 个字段。所有消费点通过 `liveConfigValue`（src/ports.ts:551-556）逐次解包，不做启动期归一。

## Key Components

### src/index.ts
- `volatile<T>(schema: T): T`（行 245-248）：助手函数，设 `schema.meta.volatile = true` 后返回，用于包装 Config 中的可变字段。
- `Config`（行 250-308）：schemastery `z.object` 定义。非 volatile 字段：`stateDir`（行 257，启动期目录）、`enableWorkspaceProvider`（行 307，Workspace 接管开关）。volatile 字段（均通过 `volatile()` 包装）：
  - `gitTimeoutMs`（行 260）：`volatile(z.number().min(1_000).max(MAX_GIT_TIMEOUT_MS).step(1).default(DEFAULT_GIT_TIMEOUT_MS))`
  - `worktreeAddTimeoutMs`（行 261）：`volatile(z.number().min(1_000).max(MAX_GIT_TIMEOUT_MS).step(1).default(300_000))`
  - `autoDeliver`（行 268）：`volatile(z.boolean().default(true))`
  - `autoPush`（行 273）：`volatile(z.boolean().default(true))`
  - `worktreesRoot`（行 280）：`volatile(z.string())`
  - `inheritLocalChanges`（行 286）：`volatile(z.boolean().default(true))`
  - `worktreeKeepCount`（行 291）：`volatile(z.number().min(0).max(500).step(1).default(15))`
  - `branchRaceGuard`（行 298）：`volatile(z.boolean().default(true))`
  - `branchRaceWindowMs`（行 300）：`volatile(z.number().min(60_000).max(24 * 60 * 60 * 1000).default(30 * 60 * 1000))`
- `LocalAdaptationConfig` 接口（行 310-319）：描述 `apply` 接收的配置形状。字段 `autoDeliver?`、`autoPush?`、`worktreesRoot?`、`inheritLocalChanges?`、`worktreeKeepCount?`、`branchRaceGuard?`、`branchRaceWindowMs?` 类型均为 `boolean | LiveValue<boolean | undefined>` 或 `string | LiveValue<string | undefined>` 或 `number | LiveValue<number | undefined>`；`enableWorkspaceProvider?` 为普通 `boolean`。
- `resolveWorktreesRootValue(raw)`（行 321-324）：延迟解包 live 引用并将相对路径解析为绝对路径（`liveConfigValue(raw)?.trim()` 后 `resolve(value)`）。
- `resolveStateDir(config)`（行 326-330）：解析状态目录，未配置时回退到 `$DSH_HOME/plugins/dsh-git-worktree` 或 `~/.dsh/plugins/dsh-git-worktree`。
- `apply(ctx, config)`（行 347-448）：插件挂载入口。将 volatile 字段直接透传给 `createSessionCheckoutModule`（行 370-385，含 `autoDeliver`、`autoPush`、`inheritLocalChanges`、`worktreeKeepCount`、`branchRaceGuard`、`branchRaceWindowMs` 等）与 `createDshGitPort`（行 366，含 `gitTimeoutMs`、`worktreeAddTimeoutMs`），并将 `worktreesRoot` 包装为 `{ get: () => resolveWorktreesRootValue(worktreesRootInput) }`（行 359-362）以实现读时解析。

### src/ports.ts
- `LiveValue<T>` 接口（行 546-548）：`{ get(): T }`，表示宿主注入的活引用。
- `liveConfigValue<T>(value)`（行 551-556）：duck-type 解包函数，判断 `value.get` 是否为函数，是则调用否则原样返回；不依赖 cosmokit。
- `SessionCheckoutDependencies` 接口（行 558-599）：域依赖集合。其中 volatile 字段放宽为 `T | LiveValue<T>`：
  - `autoPush?`（行 567）
  - `autoDeliver?`（行 569）
  - `worktreesRoot?`（行 575）
  - `inheritLocalChanges?`（行 582）
  - `worktreeKeepCount?`（行 589）
  - `branchRaceGuard?`（行 596）
  - `branchRaceWindowMs?`（行 598）

### src/adapters/git-options.ts
- `GitTimeoutOptions` 接口（行 3-6）：含 `gitTimeoutMs?` 与 `worktreeAddTimeoutMs?`，类型均为 `number | LiveValue<number | undefined>`。
- 常量：`DEFAULT_GIT_TIMEOUT_MS = 120_000`（行 8）、`DEFAULT_WORKTREE_ADD_TIMEOUT_MS = 5 * 60_000`（行 9）、`MAX_GIT_TIMEOUT_MS = 60 * 60 * 1000`（行 10）。
- `validateGitTimeouts(options)`（行 12-19）：校验时逐次解包 `liveConfigValue(options[key])` 确保整数且在 [1000, MAX] 内。
- `gitTimeoutMs(args, options)`（行 21-27）：每次调用解包；`worktree add` 用 `worktreeAddTimeoutMs`（默认 5*60_000），`worktree remove` 硬编码 300000，其他用 `gitTimeoutMs`（默认 120_000）。设置页改超时对下一条命令即生效。

### src/client/settings-card/index.ts
- `ConfigFormsService` 接口（行 19-22）：宿主配置表单服务抽象，含 `get<T>(ns)` 与 `whileServed(namespaces, callback)`。
- `SlotsService` 接口（行 25-28）：宿主插槽服务抽象。
- `mountSettingsCard(ctx)`（行 35-57）：fail-soft 探测 `configForms` 与 `slots`（行 39-41）；通过 `ctx.effect` 创建 `WorktreeSettingsCardController`（行 45-47）并在 `WORKTREE_SETTINGS_NS` 可用时注入 `plugins.bundle.config` 插槽挂载 `WorktreeSettingsCard` 组件（行 52-56）。

### src/client/settings-card/worktree-settings-card.ts
- `WORKTREE_SETTINGS_NS = 'dsh-git-worktree'`（行 14）：配置命名空间常量。
- `WorktreeSettings` 接口（行 17-23）：卡片编辑的 volatile 映射，仅含 5 字段：`autoDeliver?`、`autoPush?`、`worktreesRoot?`、`gitTimeoutMs?`、`worktreeAddTimeoutMs?`（**不含** `inheritLocalChanges`、`worktreeKeepCount`、`branchRaceGuard`、`branchRaceWindowMs`）。
- `WorktreeSettingsCardState` 接口（行 26-32）：继承 `SettingsFormShell`，含上述 5 个 `SettingsFieldState` 字段。
- `WorktreeSettingsCardFace` 接口（行 35-37）：继承 `SettingsFormActions`，含 `hooks: { worktreeCard: SnapshotStore<WorktreeSettingsCardState> }`。
- `WorktreeSettingsCardController` 类（行 39-69）：
  - 构造器（行 43-52）：用 `SettingsFormModel` 绑定 5 个 field（`settingsBooleanField('autoDeliver')`、`settingsBooleanField('autoPush')`、`settingsTextField('worktreesRoot')`、`settingsNumberField('gitTimeoutMs')`、`settingsNumberField('worktreeAddTimeoutMs')`）。
  - `projection()`（行 54-63）：返回 `WorktreeSettingsCardState`。
  - `inject()`（行 65-67）：返回 `WorktreeSettingsCardFace`。
  - `dispose()`（行 69）：释放 form。

## Architecture

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

## Data Flow

1. 用户在客户端设置卡片（`WorktreeSettingsCardController`，src/client/settings-card/worktree-settings-card.ts:39-69）编辑 5 个暴露字段，通过宿主 `configForms` 服务写入 `cordis.patch.yml`。
2. 宿主 settings 机制读取 `Config` 中 `meta.volatile = true` 的字段（由 src/index.ts:245-248 的 `volatile` 助手设置），将其作为 `LiveValue<T>` 注入插件 `apply` 的配置参数，而非plain值。
3. `apply`（src/index.ts:347-448）收到 `LocalAdaptationConfig` 与 `GitTimeoutOptions`，将 live 引用原样透传给域模块与 git 适配器（行 366、370-385）。
4. 消费点每次使用配置时调用 `liveConfigValue`（src/ports.ts:551-556）解包：
   - `gitTimeoutMs(args, options)`（src/adapters/git-options.ts:21-27）按命令类型解包超时。
   - `resolveWorktreesRootValue`（src/index.ts:321-324）解包并 `resolve` 绝对路径。
   - 域模块内部读取 `autoDeliver`/`autoPush`/`branchRaceGuard` 等决定是否自动交付、推送或启用并发分支竞态保护。
5. 设置页修改后，下一次 git 命令或模块方法调用即读到新值，无需插件重挂载。

## Connections

- 客户端挂载逻辑详见 [[settings-card]]
- 宿主配置模式参见 [[host-overview]]
- Git 适配器超时解包见 [[adapters]] 的 git-options
- 相关模块入口 [[client-settings-card]]（src/client/settings-card/index.ts 与 worktree-settings-card.ts）

## Known Issues

- **客户端卡片字段覆盖不全**：当前 `WorktreeSettings`（src/client/settings-card/worktree-settings-card.ts:17-23）仅暴露 `autoDeliver`、`autoPush`、`worktreesRoot`、`gitTimeoutMs`、`worktreeAddTimeoutMs` 五个 volatile 字段。其余四个 volatile 字段（`inheritLocalChanges`、`worktreeKeepCount`、`branchRaceGuard`、`branchRaceWindowMs`，定义于 src/index.ts:286,291,298,300）虽在 `Config` 中标 volatile 且模块内部支持热更新，但无设置页 UI 编辑入口，只能通过直接修改 `cordis.patch.yml` 生效。
- **孤儿工作区自愈映射**：设置页暴露 `worktreesRoot` 后，改根目录可能留下旧根下的孤儿 worktree。无需新代码——`module.reconcile()`（`SessionCheckoutModule` 接口定义于 src/index.ts:207，启动时 `ctx.events.on('ready')` 于行 403-417 调用）已有孤儿检测（`SessionCheckoutReconcileSummary` 接口定义于行 55-61，含 `recoveryRequiredCheckoutIds`、`orphanedCheckoutIds`、`dirtyOrphanedCheckoutIds`、`staleRootCheckoutIds`、`retainedCheckoutCount`），路径候选解析本身也按当前值逐次进行（`resolveWorktreesRootValue` 定义于行 321-324，在 `apply` 中于行 359-362 包装为 live getter）。运维口径：换根目录后旧根目录可整目录手工删除，reconcile 会按当前配置把状态收敛到新根。
- **默认值归一时机**：`autoDeliver`/`autoPush` 的 `?? true` 归一从 apply 期移到消费期：未设置 = true 的语义不变（`Config` 里 `z.boolean().default(true)` 定义于行 268/273，live ref 解包后未定义则走默认）。`isAutoDeliverEnabled()` 模块方法（`SessionCheckoutModule` 接口 src/index.ts:176）实时读取 volatile 值，工具层在其关闭时拒绝 model-driven delivery（`registerTools` 于行 396 注册的工具会检查）。
- **类型安全约束**：所有消费点必须逐次解包，新增消费点若忘记解包会在 typecheck 阶段被抓出（类型是显式联合 `T | LiveValue<T>`）。
