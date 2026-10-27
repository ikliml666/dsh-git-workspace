---
title: "volatile 设置字段与 LiveValue 运行时解包"
type: decision
source_files:
  - src/index.ts
  - src/ports.ts
  - src/adapters/git-options.ts
  - src/client/settings-card/index.ts
  - src/client/settings-card/worktree-settings-card.ts
  - tests/git-timeouts.test.ts
  - tests/client-settings-card.test.tsx
tags:
  - volatile-config
  - settings
  - live-ref
  - decision
---

## Overview

dsh-git-worktree 插件通过宿主 settings 服务把 `Config` schema 中标为 volatile 的字段投影为设置表单，写入 `cordis.patch.yml` 并经过 revision CAS 生效，且编辑**不重挂载插件**。宿主 settings（host 的 schema.ts）读取 `meta.volatile`（由 `src/index.ts:255-259` 的 `volatile()` 助手写入）。volatile 字段的值以 `LiveValue<T>`（`{ get(): T }`，定义见 `src/ports.ts:554-557`）形式到达 `apply`，消费点通过 `liveConfigValue`（见 `src/ports.ts:559-565`）在每次使用时解包，而非启动期归一。

当前 `Config`（`src/index.ts:261-319`）共有 9 个 volatile 字段：`gitTimeoutMs`（271）、`worktreeAddTimeoutMs`（272）、`autoDeliver`（279）、`autoPush`（284）、`worktreesRoot`（291）、`inheritLocalChanges`（297）、`worktreeKeepCount`（302）、`branchRaceGuard`（309）、`branchRaceWindowMs`（311）；非 volatile 字段为 `stateDir`（268，可选输入）与 `enableWorkspaceProvider`（318，默认 false）。客户端设置卡片（`WorktreeSettings` 接口，`src/client/settings-card/worktree-settings-card.ts:17-23`）仅编辑其中 5 个字段（`autoDeliver`、`autoPush`、`worktreesRoot`、`gitTimeoutMs`、`worktreeAddTimeoutMs`）。

测试覆盖：`tests/git-timeouts.test.ts:77-84` 断言 `Config` schema 中 `gitTimeoutMs`、`worktreeAddTimeoutMs`、`autoDeliver`、`autoPush`、`worktreesRoot` 被标 volatile，且 `stateDir`/`enableWorkspaceProvider` 未标 volatile；`tests/client-settings-card.test.tsx:21-35` 验证卡片渲染这 5 行（2 个开关 + 3 个文本/数字字段）且未编辑时 Save 禁用。

## Key Components

### src/index.ts
- `volatile<T>(schema: T): T`（行 255-259）：助手函数，设 `schema.meta.volatile = true` 后返回（行 257-258），用于包装 Config 中的可变字段。
- `Config`（行 261-319）：`z.object` 定义。非 volatile 字段：`stateDir`（行 268，启动期目录，可选输入）、`enableWorkspaceProvider`（行 318，Workspace 接管开关，非 volatile，默认 false）。9 个 volatile 字段（均通过 `volatile()` 包装）：
  - `gitTimeoutMs`（行 271）：`volatile(z.number().min(1_000).max(MAX_GIT_TIMEOUT_MS).step(1).default(DEFAULT_GIT_TIMEOUT_MS))`
  - `worktreeAddTimeoutMs`（行 272）：`volatile(z.number().min(1_000).max(MAX_GIT_TIMEOUT_MS).step(1).default(300_000))`
  - `autoDeliver`（行 279）：`volatile(z.boolean().default(true))`
  - `autoPush`（行 284）：`volatile(z.boolean().default(true))`
  - `worktreesRoot`（行 291）：`volatile(z.string())`
  - `inheritLocalChanges`（行 297）：`volatile(z.boolean().default(true))`
  - `worktreeKeepCount`（行 302）：`volatile(z.number().min(0).max(500).step(1).default(15))`
  - `branchRaceGuard`（行 309）：`volatile(z.boolean().default(true))`
  - `branchRaceWindowMs`（行 311）：`volatile(z.number().min(60_000).max(24 * 60 * 60 * 1000).default(30 * 60 * 1000))`
- `LocalAdaptationConfig` 接口（行 321-330）：描述 `apply` 接收的配置形状。字段 `autoDeliver?`、`autoPush?`、`worktreesRoot?`、`inheritLocalChanges?`、`worktreeKeepCount?`、`branchRaceGuard?`、`branchRaceWindowMs?` 类型均为 `boolean | LiveValue<boolean | undefined>` 或 `string | LiveValue<string | undefined>` 或 `number | LiveValue<number | undefined>`；`enableWorkspaceProvider?` 为普通 `boolean`。
- `resolveWorktreesRootValue(raw)`（行 332-335）：延迟解包 live 引用并将相对路径解析为绝对路径（`liveConfigValue(raw)?.trim()` 后 `resolve(value)`，空串回退 undefined）。
- `resolveStateDir(config)`（行 337-341）：解析状态目录，未配置时回退到 `$DSH_HOME/plugins/dsh-git-worktree` 或 `~/.dsh/plugins/dsh-git-worktree`（`DSH_HOME` 未设则用 `homedir()/.dsh`）。
- `apply(ctx, config)`（行 358-459）：插件挂载入口。先 `validateGitTimeouts(config)`（行 359），再将 volatile 字段直接透传给 `createSessionCheckoutModule`（行 381-396，含 `autoDeliver` 行 389、`autoPush` 行 390、`inheritLocalChanges` 行 391、`worktreeKeepCount` 行 392、`branchRaceGuard` 行 393、`branchRaceWindowMs` 行 394，以及按需注入的 `worktreesRoot` 行 395）与 `createDshGitPort`（行 377，含 `gitTimeoutMs`、`worktreeAddTimeoutMs`）；`worktreesRoot` 被包装为 `{ get: () => resolveWorktreesRootValue(worktreesRootInput) }`（行 370-373）以实现读时解析，`undefined` 时不注入（行 395 的 spread 跳过）。
- `SessionCheckoutReconcileSummary` 接口（行 55-61）：含 `recoveryRequiredCheckoutIds`、`orphanedCheckoutIds`、`dirtyOrphanedCheckoutIds`、`staleRootCheckoutIds`、`retainedCheckoutCount`。
- `SessionCheckoutModule` 接口（行 113-219）：域核心接口。`isAutoDeliverEnabled(): boolean`（行 176）实时读取 volatile `autoDeliver` 值，工具层在其关闭时拒绝 model-driven delivery。

### src/ports.ts
- `LiveValue<T>` 接口（行 554-557）：`{ get(): T }`，表示宿主注入的活引用。
- `liveConfigValue<T>(value)`（行 559-565）：duck-type 解包函数，判断 `value.get` 是否为函数，是则调用否则原样返回；不依赖 cosmokit。
- `SessionCheckoutDependencies` 接口（行 567-608）：域依赖集合。其中 volatile 字段放宽为 `T | LiveValue<T | undefined>`：
  - `autoPush?`（行 576）
  - `autoDeliver?`（行 578）
  - `worktreesRoot?`（行 584）
  - `inheritLocalChanges?`（行 591）
  - `worktreeKeepCount?`（行 598）
  - `branchRaceGuard?`（行 605）
  - `branchRaceWindowMs?`（行 607）

### src/adapters/git-options.ts
- `GitTimeoutOptions` 接口（行 3-6）：含 `gitTimeoutMs?` 与 `worktreeAddTimeoutMs?`，类型均为 `number | LiveValue<number | undefined>`。
- 常量：`DEFAULT_GIT_TIMEOUT_MS = 120_000`（行 8）、`DEFAULT_WORKTREE_ADD_TIMEOUT_MS = 5 * 60_000`（行 9）、`MAX_GIT_TIMEOUT_MS = 60 * 60_000`（行 10）。
- `validateGitTimeouts(options)`（行 12-19）：校验时逐次解包 `liveConfigValue(options[key])` 确保整数且在 [1000, MAX] 内（行 14-15），否则抛 `RangeError`。
- `gitTimeoutMs(args, options)`（行 21-27）：每次调用解包；`worktree add` 用 `worktreeAddTimeoutMs`（默认 300000，行 24），`worktree remove` 硬编码 300000（行 25），其他用 `gitTimeoutMs`（默认 120000，行 26）。设置页改超时对下一条命令即生效。

### src/client/settings-card/index.ts
- `ConfigFormsService` 接口（行 19-22）：宿主配置表单服务抽象，含 `get<T>(ns)` 与 `whileServed(namespaces, callback)`。
- `SlotsService` 接口（行 25-28）：宿主插槽服务抽象，含 `inject(slot, register)` 与 `register(options, component)`。
- `mountSettingsCard(ctx)`（行 35-57）：fail-soft 探测 `configForms` 与 `slots`（行 39-41，缺失则直接 return）；通过 `ctx.effect` 创建 `WorktreeSettingsCardController`（行 44-47）并在 `WORKTREE_SETTINGS_NS` 可用时注入 `plugins.bundle.config` 插槽挂载 `WorktreeSettingsCard` 组件（行 52-56）。

### src/client/settings-card/worktree-settings-card.ts
- `WORKTREE_SETTINGS_NS = 'dsh-git-worktree'`（行 14）：配置命名空间常量（Loader entry id）。
- `WorktreeSettings` 接口（行 17-23）：卡片编辑的 volatile 映射，仅含 5 字段：`autoDeliver?`、`autoPush?`、`worktreesRoot?`、`gitTimeoutMs?`、`worktreeAddTimeoutMs?`（**不含** `inheritLocalChanges`、`worktreeKeepCount`、`branchRaceGuard`、`branchRaceWindowMs`）。
- `WorktreeSettingsCardState` 接口（行 26-32）：继承 `SettingsFormShell`，含上述 5 个 `SettingsFieldState` 字段。
- `WorktreeSettingsCardFace` 接口（行 35-37）：继承 `SettingsFormActions`，含 `hooks: { worktreeCard: SnapshotStore<WorktreeSettingsCardState> }`。
- `WorktreeSettingsCardController` 类（行 39-70）：
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

1. 用户在客户端设置卡片（`WorktreeSettingsCardController`，src/client/settings-card/worktree-settings-card.ts:39-70）编辑 5 个暴露字段，通过宿主 `configForms` 服务写入 `cordis.patch.yml`。
2. 宿主 settings 机制读取 `Config` 中 `meta.volatile = true` 的字段（由 src/index.ts:255-259 的 `volatile` 助手设置），将其作为 `LiveValue<T>` 注入插件 `apply` 的配置参数，而非 plain 值。
3. `apply`（src/index.ts:358-459）收到 `LocalAdaptationConfig` 与 `GitTimeoutOptions`，将 live 引用原样透传给域模块与 git 适配器（行 377、381-396）。
4. 消费点每次使用配置时调用 `liveConfigValue`（src/ports.ts:560-566）解包：
   - `gitTimeoutMs(args, options)`（src/adapters/git-options.ts:21-27）按命令类型解包超时。
   - `resolveWorktreesRootValue`（src/index.ts:332-335）解包并 `resolve` 绝对路径。
   - 域模块内部读取 `autoDeliver`/`autoPush`/`branchRaceGuard` 等决定是否自动交付、推送或启用并发分支竞态保护（`isAutoDeliverEnabled()` 在 src/index.ts:176）。
5. 设置页修改后，下一次 git 命令或模块方法调用即读到新值，无需插件重挂载。

## Connections

- 客户端挂载逻辑详见 [[settings-card]]
- 宿主配置模式参见 [[host-overview]]
- Git 适配器超时解包见 [[adapters]] 的 git-options
- 相关模块入口 [[settings-card]]（src/client/settings-card/index.ts 与 worktree-settings-card.ts）
- 行为测试：`tests/client-settings-card.test.tsx`（卡片渲染与保存）、`tests/git-timeouts.test.ts`（超时与 live ref 解包、volatile 标记断言）

## Known Issues

- **客户端卡片字段覆盖不全**：当前 `WorktreeSettings`（src/client/settings-card/worktree-settings-card.ts:17-23）仅暴露 `autoDeliver`、`autoPush`、`worktreesRoot`、`gitTimeoutMs`、`worktreeAddTimeoutMs` 五个 volatile 字段。其余四个 volatile 字段（`inheritLocalChanges`、`worktreeKeepCount`、`branchRaceGuard`、`branchRaceWindowMs`，定义于 src/index.ts:297,302,309,311）虽在 `Config` 中标 volatile 且模块内部支持热更新，但无设置页 UI 编辑入口，只能通过直接修改 `cordis.patch.yml` 生效。`tests/git-timeouts.test.ts:77-84` 只校验这 5 个字段标 volatile，未对另 4 个提要求。
- **孤儿工作区自愈映射**：设置页暴露 `worktreesRoot` 后，改根目录可能留下旧根下的孤儿 worktree。无需新代码——`module.reconcile()`（`SessionCheckoutModule` 接口定义于 src/index.ts:113-219，启动时 `ctx.events.on('ready')` 于行 414-428 调用）已有孤儿检测（`SessionCheckoutReconcileSummary` 接口定义于行 55-61，含 `recoveryRequiredCheckoutIds`、`orphanedCheckoutIds`、`dirtyOrphanedCheckoutIds`、`staleRootCheckoutIds`、`retainedCheckoutCount`），路径候选解析本身也按当前值逐次进行（`resolveWorktreesRootValue` 定义于行 332-335，在 `apply` 中于行 370-373 包装为 live getter）。运维口径：换根目录后旧根目录可整目录手工删除，reconcile 会按当前配置把状态收敛到新根。
- **默认值归一时机**：`autoDeliver`/`autoPush` 的 `?? true` 归一从 apply 期移到消费期：未设置 = true 的语义不变（`Config` 里 `z.boolean().default(true)` 定义于行 279/284，live ref 解包后未定义则走默认）。`isAutoDeliverEnabled()` 模块方法（`SessionCheckoutModule` 接口 src/index.ts:176）实时读取 volatile 值，工具层在其关闭时拒绝 model-driven delivery（`registerTools` 于行 407 注册的工具会检查）。
- **类型安全约束**：所有消费点必须逐次解包，新增消费点若忘记解包会在 typecheck 阶段被抓出（类型是显式联合 `T | LiveValue<T>`）。`tests/git-timeouts.test.ts:60-75` 验证了 `gitTimeoutMs`/`validateGitTimeouts` 对 live ref 的逐次解包与默认值回落（`gitTimeoutMs: { get: () => timeout }` 改动后下次调用即读到新值，undefined 时回落到 120000/300000）。
