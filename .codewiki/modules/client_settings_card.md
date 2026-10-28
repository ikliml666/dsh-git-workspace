---
title: client_settings_card
type: module
source_files:
  - src/client/settings-card/index.ts
  - src/client/settings-card/form-model.ts
  - src/client/settings-card/worktree-settings-card.ts
  - src/client/settings-card/WorktreeSettingsCard.tsx
  - src/client/console-remote/index.ts
  - src/i18n/client-messages.ts
  - tests/client-settings-card.test.tsx
tags: [client, settings, form, config, ui]
---

## Overview

`client_settings_card` 是 Worktree 插件在 Host 的「Plugins」页面挂载的**工作树设置卡片**，负责编辑插件 Config 命名空间 `dsh-git-worktree` 下的 5 个易失（volatile）字段：`autoDeliver`、`autoPush`、`worktreesRoot`、`gitTimeoutMs`、`worktreeAddTimeoutMs`。

模块分三层：

- **`index.ts`（`mountSettingsCard`）**：挂载入口。fail-soft 探测 `configForms` 与 `slots` 两个 Host 服务，缺失则整页不挂载（第 35–57 行）。
- **`form-model.ts`（`SettingsFormModel<T>` 及字段 spec 工厂）**：一个**暂存式（staged）表单模型**。用户在控件里打字只写入本地草稿，点 Save 才把草稿聚合成一次 revision 围栏（fenced）的文档 mutation。它从共享配置表单（`SettingsFormScope<T>`）读取，但只有 Host 才是「值是否被接受」的最终权威（见 `save()` 注释，第 277–303 行）。
- **`worktree-settings-card.ts`（`WorktreeSettingsCardController`）**：把通用模型绑定到本插件的具体 5 个字段，产出组件订阅的 `SnapshotStore`。
- **`WorktreeSettingsCard.tsx`（`WorktreeSettingsCard`）**：纯渲染组件，用内联样式画出 5 行配置 + 底部 Save/Discard 操作区。

设计上刻意自包含：标题注释说明插件随附的 `client-ui-primitives` 版本早于共享 `SettingsForm`，故行用内联样式而非外部样式表（`WorktreeSettingsCard.tsx` 第 1–7 行；`form-model.ts` 第 1–19 行）。

挂载点：`mountSettingsCard` 由 `src/client/console-remote/index.ts` 第 73 行调用（`apply()` 内），依赖 `configForms` 与 `slots` 服务——`console-remote/index.ts` 第 45–49 行的 `inject` 显式声明这两个服务，否则 `ctx.get('slots')` 永远为 `undefined`、卡片静默不挂载（第 30–44 行注释）。

## Key Components

### `src/client/settings-card/index.ts`

- `export { WORKTREE_SETTINGS_NS, WorktreeSettingsCardController }` — 第 15 行，重导出命名空间常量与控制器类。
- `export type { WorktreeSettings, WorktreeSettingsCardFace, WorktreeSettingsCardState }` — 第 16 行，重导出类型。
- `interface ConfigFormsService` — 第 19–22 行。卡片对 Host 配置表单服务的最小需求：`get<T>(ns)` 取命名空间 scope；`whileServed(namespaces, callback)` 在命名空间被 Host 服务时回调（返回反注册函数）。
- `interface SlotsService` — 第 25–28 行。对 Host Plugins 页面 slot 的最小需求：`inject(slot, register)` 与 `register(options, component)`。
- `mountSettingsCard(ctx: Context): void` — 第 35–57 行。挂载函数：
  - 第 39–41 行：用 `ctx.get`（fail-soft）探 `configForms`、`slots`，任意一个 `undefined` 直接 return（不挂载）。
  - 第 44–47 行：`ctx.effect` 中 `new WorktreeSettingsCardController(configForms.get<WorktreeSettings>(WORKTREE_SETTINGS_NS))`，effect 清理时 `controller.dispose()`。
  - 第 52–56 行：`configForms.whileServed([WORKTREE_SETTINGS_NS], …)` 内 `slots.inject('plugins.bundle.config', () => slots.register({ name, key: WORKTREE_SETTINGS_NS, inject: () => controller?.inject() }, WorktreeSettingsCard))`。注意：卡片挂在 `plugins.bundle.config`（按 bundle 包名在本 bundle 自己的页面渲染），而非 `plugins.item`（官方插件列表，从不显示第三方 bundle 卡片），见第 48–51 行注释。

### `src/client/settings-card/form-model.ts`

**类型 / 接口**

- `interface SettingsFormScopeSnapshot<T>` — 第 24–37 行。字段：`status`（`'loading' | 'ready' | 'unavailable'`）、`value`（schema 解析后的分区值，首次接受前 `undefined`）、`base`（组合层，字段清空前回退到的值）、`user`（原始 user 层存储；字段在这里的**存在性**标记是否被覆盖）、`writable`、`revision`（`undefined` 可读，save 时围栏用）。
- `type SettingsFormPathOp` — 第 40–42 行。`{ op: 'set'; path: readonly string[]; value: unknown }` 或 `{ op: 'unset'; path: readonly string[] }`。
- `interface SettingsFormScope<T>` — 第 45–49 行。模型依赖的 scope 接口：`getSnapshot()`、`subscribe(listener)`、`mutate(ops, expectedRevision?)`。
- `type SettingsFieldWrite` — 第 52–54 行。`{ kind: 'set'; value }` 或 `{ kind: 'clear' }`。
- `interface SettingsFieldSpec` — 第 57–67 行。字段转换规格：`field`、`format(value) => string`（存储值→草稿文本，无值时空串）、`parse(text) => SettingsFieldWrite | undefined`（草稿→写入；`undefined` 表示该草稿不可接受、阻塞保存）。
- `interface SettingsFieldState` — 第 70–77 行。控件渲染用：`text`、`overridden`（保存是否会留下 user 层条目）、`invalid`（草稿不可接受、阻塞保存）。
- `interface SettingsFormShell` — 第 80–93 行。卡片级共享状态：`available`、`writable`、`dirty`、`invalid`、`saving`、`failed`。
- `interface SettingsFormActions` — 第 96–105 行。`edit(field, text)`、`resetField(field)`、`save()`、`discard()`。
- `interface StagedEdit` — 第 108–113 行（私有）。`text`、`clear: boolean`。
- `interface PlannedWrite` — 第 116–121 行（私有）。`field`、`op?`（草稿不可接受时 `op` 为 `undefined`）。

**字段 spec 工厂函数**

- `settingsBooleanField(field: string): SettingsFieldSpec` — 第 129–141 行。字面量 `'true'`/`'false'`，其他草稿阻塞保存，空草稿 clear。
- `settingsNumberField(field: string): SettingsFieldSpec` — 第 149–162 行。仅接受有限安全整数（`Number.isSafeInteger`），空草稿 clear。
- `settingsTextField(field: string): SettingsFieldSpec` — 第 170–179 行。空草稿 clear（清空控件 = 重置），否则 set 去空白文本。

**类 `SettingsFormModel<T>`** — 第 188–369 行

- 私有字段：第 189–195 行。`specs: Map<string, SettingsFieldSpec>`、`staged: Map<string, StagedEdit>`、`listeners: Set<() => void>`、`baseline`（`SettingsFormScopeSnapshot<T> | undefined`）、`unsubscribe`、`saving`、`failed`。
- `constructor(scope, specs)` — 第 201–207 行。把 `specs` 建成 `Map`，订阅 scope。
- `bind<S>(project: () => S): SnapshotStore<S>` — 第 214–218 行。用 `createSnapshotStore(project())` 建 store，并把 `project` 投影注册为 listener，scope/draft 变化时重算。
- `shell(): SettingsFormShell` — 第 224–235 行。由 `getSnapshot()` + `plan()` 计算：`available = status === 'ready'`、`dirty = plan.length > 0`、`invalid = plan.some(op === undefined)`。
- `field(field: string): SettingsFieldState` — 第 242–254 行。未暂存时显示 `format(sectionValue)`、`overridden = stored(field)`（user 层是否携带）；暂存时按 `parse` / clear 计算 `overridden`、`invalid`。
- `actions(): SettingsFormActions` — 第 260–275 行。返回 `edit`、`resetField`（把草稿设为 `format(baseValue)` 且 `clear: true`）、`save`、`discard`（draft 空且未 failed 直接返回；否则清 staged、baseline、`failed` 并 publish）。
- `async save(): Promise<void>` — 第 285–303 行。先 `plan()`，若无编辑/`saving`/`!writable`/含无效草稿则早返回；置 `saving`、`failed=false`；调用 `scope.mutate(plan.map(op), baseline?.revision)`；`landed` 时清 staged，否则 `failed=true`；异常也置 `failed=true`；finally 清 `saving` 并 publish。**未落地的 save 保留草稿**（便于纠正而非重打）。
- `dispose(): void` — 第 306 行。取消订阅、清空 listeners。
- 私有方法：
  - `plan(): PlannedWrite[]` — 第 313–328 行。遍历 staged：clear 且 `stored` 则 `unset`；文本与 `format(sectionValue)` 相同则跳过；`parse` 返回 `undefined` 则只压入 `{ field }`（无 op，脏但阻塞）；`clear` 则 `unset`；否则 `set`。
  - `stage(field, edit)` — 第 330–335 行。首次暂存时捕获 `baseline = scope.getSnapshot()`，置 staged、清 `failed`、publish。
  - `spec(field)` — 第 337–343 行。取 spec，缺失则抛 `plugin card has no field ${field}`（接线错误而非静默失效）。
  - `snapshotOf()` — 第 345–347 行。包装 `scope.getSnapshot()`。
  - `sectionValue(field)` — 第 349–351 行。从 `value` 取字段。
  - `baseValue(field)` — 第 353–355 行。从 `base` 取字段。
  - `userLayer()` — 第 357–359 行。返回 `user` 层。
  - `stored(field)` — 第 361–364 行。用 `Object.hasOwn(user, field)` 判定 user 层是否携带该字段（**覆盖判定靠存在性而非值比较**：等于组合层默认值的覆盖仍是覆盖）。
  - `publish()` — 第 366–368 行。触发所有 listeners。

### `src/client/settings-card/worktree-settings-card.ts`

- `export const WORKTREE_SETTINGS_NS = 'dsh-git-worktree'` — 第 14 行。Host 按此 loader entry id 索引配置表单。
- `interface WorktreeSettings` — 第 17–23 行。卡片编辑的 Config 分区：`autoDeliver?`、`autoPush?`、`worktreesRoot?`、`gitTimeoutMs?`、`worktreeAddTimeoutMs?`（全部可选）。
- `interface WorktreeSettingsCardState extends SettingsFormShell` — 第 26–32 行。共享 shell + 5 个 `SettingsFieldState` 字段（同名对应 5 个设置）。
- `interface WorktreeSettingsCardFace extends SettingsFormActions` — 第 35–37 行。slot 注入给组件的 face：`hooks: { worktreeCard: SnapshotStore<WorktreeSettingsCardState> }` + 全部 actions。
- `class WorktreeSettingsCardController` — 第 39–70 行：
  - 私有字段：第 40–41 行。`form: SettingsFormModel<WorktreeSettings>`、`store: SnapshotStore<WorktreeSettingsCardState>`。
  - `constructor(scope)` — 第 43–52 行。用 5 个 `settingsXxxField` 实例化 `SettingsFormModel`，并 `bind` 出 `store`（投影函数在第 54–63 行 `projection()`）。
  - `projection()` — 第 54–63 行。展开 `form.shell()` + 5 个 `form.field(...)`。
  - `inject(): WorktreeSettingsCardFace` — 第 65–67 行。返回 `{ hooks: { worktreeCard: this.store }, ...this.form.actions() }`。
  - `dispose()` — 第 69 行。转发 `this.form.dispose()`。

### `src/client/settings-card/WorktreeSettingsCard.tsx`

- `interface WorktreeSettingsCardProps extends SettingsFormActions` — 第 19–24 行。额外 `view?`（传 `'summary'` 渲染一句话简介，否则渲染表单）、`useWorktreeCard`（slot 运行时把 `hooks.worktreeCard` 绑定成的选择器 hook）。组件**不直接接收 `hooks` prop**（第 14–18 行注释）。
- 颜色/样式常量 — 第 26–124 行（`ACCENT`、`MUTED`、`DANGER`、`BORDER`、各类 `CSSProperties` 与 `switchStyle`、`knobStyle` 函数）。
- `interface FieldRowProps` — 第 126–134 行。`label`、`hint`、`state`、`control`、`disabled`、`onReset`、`t`。
- `fieldRow(props): ReactNode` — 第 136–155 行。渲染一行：label+hint 在左，控件 + （`invalid` 时）无效提示 + （`overridden` 时）`Overridden` 徽章与 `Reset` 按钮在右。
- `WorktreeSettingsCard(props)` — 第 162–234 行。组件：
  - 第 163–164 行：`useWorktreeCard(s => s)` 取 snapshot、`useClientTranslator()`。
  - 第 165 行：`view === 'summary'` 时只渲染 `t('settings.description')`。
  - 第 166 行：`!state.available` 时渲染 `null`。
  - 第 168 行：`disabled = !state.writable || state.saving`。
  - 第 170–178 行：`switchControl` —— `role="switch"` 按钮，`checked = fieldState.text === 'true'`，点击切 `'true'`/`'false'`。
  - 第 180–184 行：`inputControl` —— 文本 `<input>`，`inputMode` 数值字段为 `'numeric'`。
  - 第 188–214 行：5 行 `fieldRow`（autoDeliver、autoPush 用 switch；worktreesRoot、gitTimeoutMs、worktreeAddTimeoutMs 用 input）。
  - 第 215–231 行：footer —— 左侧状态文案（failed/saving/readonly），右侧 `Discard`（disabled 当 `!dirty || saving`）与 `Save`（disabled 当 `!writable || !dirty || invalid || saving`）。

### `tests/client-settings-card.test.tsx`

- `makeScope(overrides, mutate)` — 第 15–34 行。构造 `SettingsFormScope` mock，默认 `status:'ready'`、`value:{autoDeliver:true,autoPush:true}`、`base:{}`、`user:{}`、`writable:true`、`revision:7`。`subscribe` 返回 no-op。
- `renderCard(scope, view?)` — 第 36–55 行。实例化 controller、取 `hooks.worktreeCard` 作为 store，用 `useSyncExternalStore` 镜像 slot 运行时对 `useWorktreeCard` 的绑定，包 `ClientI18nProvider language="en"` 渲染 `WorktreeSettingsCard`。
- 4 个测试（第 59–103 行）：渲染 5 行且 Save 默认 disabled；暂存布尔编辑并以读时 revision=7 围栏保存（`mutate` 收到 `[{op:'set',path:['autoDeliver'],value:false}], 7`）；数值草稿非法（`'abc'`）时阻塞 Save 并显示 `Invalid value; the save is blocked.`；`summary` 视图只渲染一句话。

## Architecture

```text
 Host (Plugins page)                 client_settings_card module
 ┌─────────────────────┐             ┌──────────────────────────────────────┐
 │ slots 'plugins.     │             │ mountSettingsCard(ctx)    index.ts   │
 │   bundle.config'    │             │   (35–57) probe configForms/slots    │
 │                     │  inject()   │   fail-soft; whileServed→slots.inject │
 │  render card        │◄───────┐    └───────────────┬──────────────────────┘
 │  (summary|form)     │        │                    │ new Controller(scope)
 └─────────▲──────────┘        │                    ▼
           │ WorktreeSettingsCard.tsx              ┌────────────────────────────┐
           │ (props.useWorktreeCard,              │ WorktreeSettingsCardController
           │  actions: edit/reset/                │   worktree-settings-card.ts │
           │  save/discard)                        │   (39–70) binds 5 fields    │
           │                                       └───────────────┬────────────┘
           │                                       │ form.bind(projection)
           ▼                                       ▼
 ┌─────────────────────┐             ┌──────────────────────────────────────┐
 │ configForms service │◄── get() ──│ SettingsFormModel<WorktreeSettings>   │
 │  scope:             │   mutate()  │   form-model.ts (188–369)             │
 │   getSnapshot/      │   fenced    │   staged drafts → plan() → op[]       │
 │   subscribe/        │   mutation  │   publish() → SnapshotStore           │
 │   mutate(revision)  │───────────►│                                       │
 └─────────────────────┘             └──────────────────────────────────────┘
```

- 组件层（`WorktreeSettingsCard.tsx`）只消费 `useWorktreeCard` 选择器与 actions，不感知 `hooks` prop（第 14–18 行注释）。
- 控制器层（`worktree-settings-card.ts`）把通用 `SettingsFormModel` 绑定到 5 个具体字段，并产出 `SnapshotStore<WorktreeSettingsCardState>`（第 51 行 `this.store = this.form.bind(...)`）。
- 模型层（`form-model.ts`）是唯一理解「暂存 / 覆盖 / 无效 / revision 围栏」语义的地方；它对 `SettingsFormScope<T>` 而非真实 Host 表单编程，因此可被测试用 mock scope 驱动（见 `tests/client-settings-card.test.tsx` 第 15–34 行）。
- 挂载层（`index.ts`）把模型接到 Host 的 `configForms` + `slots` 服务，并声明 namespace `dsh-git-worktree`；若无这些服务则整页不出现（第 39–41 行）。

## Data Flow

1. **挂载**：`mountSettingsCard(ctx)`（第 35–57 行）fail-soft 取 `configForms`、`slots`；`ctx.effect`（第 44–47 行）建 `WorktreeSettingsCardController(configForms.get<WorktreeSettings>(WORKTREE_SETTINGS_NS))`；`configForms.whileServed([WORKTREE_SETTINGS_NS], …)`（第 52 行）在 Host 服务该命名空间时调 `slots.inject('plugins.bundle.config', …)`，其 `inject` 回调返回 `controller.inject()`（即 `WorktreeSettingsCardFace`）。
2. **订阅/绑定**：控制器构造时（第 43–52 行）实例化 `SettingsFormModel`，`bind()`（第 214–218 行）用 `createSnapshotStore(project())` 建 store 并把 `projection()` 投影注册为 listener。此后 scope 或草稿任一变化都触发 `publish()`（第 366–368 行）重算投影。
3. **渲染**：slot 运行时把 `face.hooks.worktreeCard` 绑定成 `useWorktreeCard` 选择器 hook（测试在 `renderCard` 第 41–52 行用 `useSyncExternalStore` 镜像）；`WorktreeSettingsCard` 用 `useWorktreeCard(s => s)` 取 snapshot（第 163 行），按 `state.available`/`writable`/`saving` 决定渲染与禁用（第 166、168 行）。
4. **暂存（stage）**：用户输入不直写文档。布尔 switch 调 `props.edit(field, 'true'|'false')`（第 191、197 行），文本 input 调 `props.edit(field, text)`（第 202、207、212 行）。`actions.edit` → `stage()`（第 262、330–335 行）：首次暂存捕获 `baseline = scope.getSnapshot()`（记下读时 revision），写入 `staged` Map，清 `failed`，`publish()`。`Reset` 按钮调 `resetField` → `stage(…, {clear:true})`，把草稿设为 `format(baseValue)` 表示「清回组合层」（第 263–265 行）。
5. **保存（save）**：`save()`（第 285–303 行）先 `plan()`（第 313–328 行）把 staged 聚合成 `PlannedWrite[]`：`unset`（clear 或文本回退到 section 值）、`set`（parse 出合法值）、或仅有 `{field}`（parse 返回 `undefined` → 无 op，脏但阻塞 Save）。`shell()` 据此把 `dirty`/`invalid` 算出来（第 230–231 行）。Save 按钮 disabled 条件含 `invalid`（第 226 行）。执行时调用 `scope.mutate(plan.map(op), baseline?.revision)`——**用读时 revision 围栏**，防并发覆盖；`landed=true` 才清 staged，否则 `failed=true` 且**保留草稿**便于纠正（第 293–296 行）。
6. **放弃（discard）**：`discard()`（第 267–273 行）清 staged、baseline、`failed`；draft 空且未 failed 时为 no-op（第 268 行）。
7. **覆盖标记**：`stored(field)`（第 361–364 行）用 `Object.hasOwn(user, field)` 判定 user 层是否携带字段——**覆盖靠存在性而非值比较**：等于组合层默认值的覆盖仍显示 `Overridden` 徽章（组件第 146–151 行）与 Reset 按钮。

**revision 围栏示例**（来自测试第 84 行）：切换 `autoDeliver` 后 Save，`scope.mutate` 收到 `[{ op: 'set', path: ['autoDeliver'], value: false }], 7`（revision 7 来自 mock snapshot，第 25、293 行）。

## Connections

- **`[[client_console_remote]]`**（`src/client/console-remote/index.ts`）：本模块唯一的真实挂载调用方。`apply()` 第 73 行 `mountSettingsCard(ctx)`；该文件的 `inject`（第 45–49 行）显式声明 `slots` 与 `configForms`，否则 `ctx.get('slots')` 在 cordis 下永远 `undefined`、卡片静默不挂载。
- **Host 配置表单服务（`configForms`）/`slots`**：由 `index.ts` 第 19–28 行的 `ConfigFormsService`/`SlotsService` 接口抽象，运行时通过 `ctx.get` fail-soft 探测（第 39–40 行）。卡片挂在 `plugins.bundle.config` slot，按 bundle 包名在本 bundle 页面渲染（第 48–56 行注释）。
- **`[[client_i18n]]`**（`src/client/i18n.tsx`）：`WorktreeSettingsCard` 用 `useClientTranslator()`（第 164 行）取 `ClientTranslator`；所有文案键（`settings.title`、`settings.autoDeliver` 等）定义在 `src/i18n/client-messages.ts` 第 1586–1605 行。
- **`dsh-client-store`**（`createSnapshotStore` / `SnapshotStore`）：`form-model.ts` 第 21 行 import，`bind()` 第 215 行建 store，控制器把其作为 `face.hooks.worktreeCard` 交给组件（第 66 行）。
- **Config schema（本插件 `dsh-git-worktree` 命名空间）**：`WorktreeSettings` 接口（第 17–23 行）对应 Config 的 volatile 分区；时间无关、无自动生成/时间戳字段（全部为可选业务字段）。
- **`[[client_settings_card]]` 反向** 由 `tests/client-settings-card.test.tsx` 引用：直接构造 `WorktreeSettingsCardController` 与 mock `SettingsFormScope`，验证渲染、围栏保存、非法草稿阻塞与 summary 视图。

## Known Issues

- **挂载依赖 `slots`/`configForms` 显式声明**：`console-remote/index.ts` 第 30–44 行注释说明，cordis 仅在 fiber 声明过的服务名上解析 `ctx.get`；`index.ts` 第 39–41 行用 `ctx.get` 做 fail-soft 探测。后果是：Host 太老没有 settings 栈时整页不挂（预期行为），但**任何**消费这些 slot 的 Host 都须同样声明它们，否则卡片静默消失。
- **`spec()` 抛错是接线错误信号**：`form-model.ts` 第 337–343 行，调用点若传入未声明字段会抛 `plugin card has no field ${field}`，而非静默失效控件。新增设置字段时必须同步在控制器（第 44–50 行）注册对应 `settingsXxxField`，否则运行时抛错。
- **非法草稿阻塞而非丢弃**：`plan()`（第 313–328 行）对 `parse` 返回 `undefined` 的草稿压入仅有 `{ field }` 的 `PlannedWrite`（`op` 为 `undefined`）。`shell().invalid` 为 `true`、`save()` 第 288 行早返回、`Save` 按钮第 226 行 disabled。这是设计取舍（避免静默丢弃用户编辑），但意味着**一个字段非法会卡住整个卡片的保存**，即使其它字段已合法。
- **未落地的 save 保留草稿**：`save()` 第 294–296 行，若 `mutate` 返回 `landed=false` 或抛异常，staged 不清空、`failed=true`。用户需修正后重试；若此时又改了别的字段，`baseline` 仍是**首次暂存**时的 snapshot（第 331 行 `baseline ??=`），revision 围栏仍基于旧读点——Host 侧若已推进 revision，下一次 `mutate` 可能因 revision 不匹配被拒（由 Host 校验，模型不预测）。
- **`whileServed` 注册在无服务时完全不注入**：`index.ts` 第 52 行回调只在 Host 服务 `WORKTREE_SETTINGS_NS` 时执行；若该命名空间从未被 Host 提供，`slots.inject` 不会被调用，卡片在 Plugins 页无任何痕迹（调试时易被误判为「挂载函数 bug」，实为 Host 未提供命名空间）。
- **`view='summary'` 之外的任意值都渲染完整表单**：`WorktreeSettingsCard` 第 165 行仅对严格 `'summary'` 短路，非 summary 视图（含 `undefined`）一律渲染 5 行表单（第 166 行仅在 `!available` 时返回 `null`）。
- **无专属样式表**：如 `WorktreeSettingsCard.tsx` 第 1–7 行与 `form-model.ts` 第 1–19 行注释所述，因随附 `client-ui-primitives` 早于共享 `SettingsForm`，本卡片全部用内联样式绘制，未在 `src/client/styles.ts` 注册样式，也不受 `client/index.tsx` 第 69–77 行的样式 effect 管理。
