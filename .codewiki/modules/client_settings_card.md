---
title: client_settings_card
type: module
source_files:
  - src/client/settings-card/index.ts
  - src/client/settings-card/form-model.ts
  - src/client/settings-card/worktree-settings-card.ts
  - src/client/settings-card/WorktreeSettingsCard.tsx
  - src/client/i18n.tsx
  - src/i18n/client-messages.ts
  - src/client/console-remote/index.ts
  - tests/client-settings-card.test.tsx
  - src/index.ts
tags: [client, settings, config-form, worktree, cordis, snapshot-store]
---

## Overview

`client_settings_card` 是 `dsh-git-worktree` 插件的**工作树设置页（settings page）**与其底层的**暂存式表单模型（staged form model）**。它把插件 `Config` 里标为 `volatile` 的字段（`autoDeliver`、`autoPush`、`worktreesRoot`、`gitTimeoutMs`、`worktreeAddTimeoutMs`，见 `src/index.ts:271-291`）暴露到 Host 的 Plugins 页面上，供用户编辑而**不重新挂载插件**。

模块由两个层次构成：

- **通用表单层**（`form-model.ts`）：一个与具体字段无关的暂存器 `SettingsFormModel<T>`，把用户敲入的草稿（draft）暂存下来，只有在点击「保存」时才把整批改动原子地写入 Host 的配置文档（`mutate`）。它从 `SettingsFormScope` 读取 `value`/`base`/`user` 三层值，并据此计算每个控件的有效值、是否被覆盖（override）、草稿是否非法（invalid）。
- **本插件卡片层**（`worktree-settings-card.ts` + `WorktreeSettingsCard.tsx`）：`WorktreeSettingsCardController` 把上面的通用模型绑定到本插件的五个字段，构造出 `WorktreeSettingsCardState`；`WorktreeSettingsCard` 这个 React 组件负责把状态渲染成一行行控件（开关、输入框、保存/放弃按钮、覆盖徽标、非法提示）。

挂载入口是 `index.ts:35` 的 `mountSettingsCard(ctx)`：通过 `ctx.get('configForms')` 与 `ctx.get('slots')` 以**失败即软退出**的方式探测 Host 是否提供了配置表单服务与插槽服务；若缺其一则整页不挂载（第 41 行）。它把卡片注册进 `plugins.bundle.config` 插槽（第 52 行），让卡片显示在本 bundle 自己的 Plugins 页上。

设计要点（见 `form-model.ts:1-19` 的文件头注释）：

- **暂存而非就地写**：设置写入是带修订围栏（revision-fenced）的持久化文档变更，控件每次敲定就立即提交会把「一次编辑」变成「一次用户没要求、也无法预览的写入」。暂存文本保证屏幕上的内容就是保存会存的内容。
- **覆盖以「存在性」判定**：一个字段是否算 override，看的是 `user` 层是否携带该字段（presence），而不是和默认值做值比较——一个等于组合层（composition）默认值的覆盖，依然是覆盖。

## Key Components

### `src/client/settings-card/index.ts`

- `mountSettingsCard(ctx)` — 第 35–57 行。失败即软退出地挂载设置页：
  - 第 39–41 行：`ctx.get('configForms')` 与 `ctx.get('slots')` 读取这两个服务，`undefined` 则直接 `return`（无服务则无页面）。
  - 第 44–47 行：`ctx.effect` 创建 `WorktreeSettingsCardController`，包在 `configForms.get<WorktreeSettings>(WORKTREE_SETTINGS_NS)` 之上；effect 清理时 `controller.dispose()`。
  - 第 52–56 行：另一个 `ctx.effect` 调用 `configForms.whileServed([WORKTREE_SETTINGS_NS], ...)`，在 Host 服务该命名空间时把卡片 `slots.inject('plugins.bundle.config', ...)` 进去，注册 `WorktreeSettingsCard` 组件，其 `inject` 回调调 `controller?.inject()`。注释说明该插槽渲染在 bundle 自身页面（在描述与其余行之间），而 `plugins.item` 是官方插件列表插槽、不会显示第三方 bundle 的卡片。

辅助类型（仅本文件内部使用，未导出）：

- `ConfigFormsService` — 第 19–22 行。卡片对 Host 配置表单服务的最小需求：`get<T>(ns)` 返回 `SettingsFormScope<T>`；`whileServed(namespaces, cb)` 返回取消订阅函数。
- `SlotsService` — 第 25–28 行。卡片对 Host 插槽服务的最小需求：`inject(slot, register)` 与 `register(options, component)`。

### `src/client/settings-card/form-model.ts`

**导出类型 / 常量：**

- `SettingsFormScopeSnapshot<T>` — 第 24–37 行。模型读取的单条 Host 表单快照：`status`（`'loading' | 'ready' | 'unavailable'`）、`value`（已解析的 schema 段，首接受前为 `undefined`）、`base`（组合层，清空字段后回退到此）、`user`（原始用户层，字段**是否在此层出现**标记其被覆盖）、`writable`、`revision`（快照读取时的修订号，保存用它给变更加围栏）。
- `SettingsFormPathOp` — 第 40–42 行。`{ op: 'set'; path: readonly string[]; value: unknown }` 或 `{ op: 'unset'; path: readonly string[] }`，即共享配置表单 `mutate` 接受的单条路径编辑。
- `SettingsFormScope<T>` — 第 45–49 行。模型暂存其上的条目表单：`getSnapshot()`、`subscribe(listener)`、`mutate(ops, expectedRevision?)`。
- `SettingsFieldWrite` — 第 52–54 行。单个字段保存时执行的写入：`{ kind: 'set'; value: unknown }` 或 `{ kind: 'clear' }`。
- `SettingsFieldSpec` — 第 57–67 行。单字段的存取规约：`field`、`format(value): string`（空串表示段内无此值）、`parse(text): SettingsFieldWrite | undefined`（返回 `undefined` 表示草稿不被接受，从而**阻断保存**而非丢弃）。
- `SettingsFieldState` — 第 70–77 行。控件渲染的单字段状态：`text`（草稿文本）、`overridden`（保存是否会留下该字段的用户层条目）、`invalid`（草稿非法、阻断保存）。
- `SettingsFormShell` — 第 80–93 行。每张卡片共享的表单级状态：`available`、`writable`、`dirty`、`invalid`、`saving`、`failed`。
- `SettingsFormActions` — 第 96–105 行。卡片插槽注入的写动作：`edit(field, text)`、`resetField(field)`、`save()`、`discard()`。

**导出工厂函数（字段规约构造器）：**

- `settingsBooleanField(field)` — 第 129–141 行。布尔字段：草稿为字面量 `'true'`/`'false'`；其余草稿（包括空串）返回 `undefined` 阻断保存，空草稿则 `kind: 'clear'`。
- `settingsNumberField(field)` — 第 149–162 行。整数（`Number.isSafeInteger`）字段；空草稿 `clear`，非有限整数 `undefined` 阻断保存。
- `settingsTextField(field)` — 第 170–179 行。自由文本字段；空草稿 `clear`，非空草稿 `set(trimmed)`。

**导出类：**

- `SettingsFormModel<T>` — 第 188–369 行。暂存并写入一张卡片的编辑。
  - 私有字段：第 189–195 行。`specs: Map<string, SettingsFieldSpec>`、`staged: Map<string, StagedEdit>`、`listeners: Set<() => void>`、`baseline: SettingsFormScopeSnapshot<T> | undefined`、`unsubscribe`、`saving = false`、`failed = false`。
  - 构造器 `constructor(scope, specs)` — 第 201–207 行。建立 `specs` 映射并对 `scope` 订阅 `() => this.publish()`。
  - `bind<S>(project): SnapshotStore<S>` — 第 214–218 行。用 `createSnapshotStore(project())` 建快照存储，把后续每帧投影写进 `store.set(project())`；返回卡片组件经选择器读取的 store。
  - `shell(): SettingsFormShell` — 第 224–235 行。读取卡片级状态：`available = status === 'ready'`；`dirty = plan.length > 0`；`invalid = plan` 中任一 `op === undefined`；外加 `writable`/`saving`/`failed`。
  - `field(field): SettingsFieldState` — 第 242–254 行。读取控件状态：未暂存时返回有效值文本、`overridden = stored(field)`、`invalid = false`；已暂存时按 `clear` 或 `spec.parse` 解析出 `overridden` 与 `invalid`。
  - `actions(): SettingsFormActions` — 第 260–275 行。返回 `edit`/`resetField`/`save`/`discard` 四动作实现；`discard` 在未暂存且未失败时直接返回（第 268 行）。
  - `save(): Promise<void>` — 第 285–303 行。先 `plan()`，若空/正在保存/`!writable`/有非法项则直接返回；置 `saving` 后调用 `scope.mutate(plan.map(op), this.baseline?.revision)`；`landed` 则清暂存，`failed = !landed`，并把 `baseline` 置 `undefined`；异常则 `failed = true`；finally 中 `saving = false` 并 `publish()`。
  - `dispose()` — 第 306 行。取消 scope 订阅并清空 listeners。
  - 私有 `plan(): PlannedWrite[]` — 第 313–328 行。遍历 `staged`：已 `clear` 且 `stored(field)` 真时产出 `unset`；草稿等于 `sectionValue` 则跳过；`parse` 为 `undefined` 则产出无 `op` 的项（仍 dirty、保存拒绝）；`clear` 取 `unset`；否则 `set`。
  - 私有 `stage(field, edit)` — 第 330–335 行。惰性记录 `baseline`，写入 `staged`，清 `failed` 并 `publish()`。
  - 私有 `spec(field)` — 第 337–343 行。取规约，缺失则抛 `plugin card has no field ${field}`（防止静默失效的接线错误）。
  - 私有 `snapshotOf()` / `sectionValue(field)` / `baseValue(field)` / `userLayer()` / `stored(field)` / `publish()` — 第 345–368 行。`sectionValue` 取 `value[field]`；`baseValue` 取 `base[field]`；`userLayer` 取 `user`；`stored` 判断 `user` 层是否 `Object.hasOwn(user, field)`（**覆盖判定核心**）；`publish` 触发所有 listener。
  - 内部接口 `StagedEdit`（第 108–113 行：`text`/`clear`）、`PlannedWrite`（第 116–121 行：`field`/`op?`）仅本文件使用。

### `src/client/settings-card/worktree-settings-card.ts`

- `WORKTREE_SETTINGS_NS = 'dsh-git-worktree'` — 第 14 行。Host 据此外键配置表单；与 `src/index.ts:245` 的 loader 名 `git-worktree` 不同（注意：此处是配置命名空间 id，非插件名）。
- `WorktreeSettings` — 第 17–23 行。接口，本插件 Config schema 中卡片编辑的 volatile 段：`autoDeliver?: boolean`、`autoPush?: boolean`、`worktreesRoot?: string`、`gitTimeoutMs?: number`、`worktreeAddTimeoutMs?: number`。
- `WorktreeSettingsCardState` — 第 26–32 行。卡片状态 = `SettingsFormShell` 扩展出五个字段各自的 `SettingsFieldState`（`autoDeliver`/`autoPush`/`worktreesRoot`/`gitTimeoutMs`/`worktreeAddTimeoutMs`）。
- `WorktreeSettingsCardFace` — 第 35–37 行。插槽条目注入组件的 face：`SettingsFormActions` 外加 `hooks: { worktreeCard: SnapshotStore<WorktreeSettingsCardState> }`。
- `WorktreeSettingsCardController` — 第 39–70 行。
  - 构造器 `constructor(scope)` — 第 43–52 行。用五个 `settingsXxxField(...)` 规约建 `SettingsFormModel`，并 `bind` 出 `store`。
  - 私有 `projection(): WorktreeSettingsCardState` — 第 54–63 行。把 `form.shell()` 与五个 `form.field(...)` 合成卡片状态。
  - `inject(): WorktreeSettingsCardFace` — 第 65–67 行。返回 `{ hooks: { worktreeCard: this.store }, ...this.form.actions() }`（即插槽运行时把 `hooks.worktreeCard` 绑定成 `useWorktreeCard` 选择器 hook）。
  - `dispose()` — 第 69 行。委托 `form.dispose()`。

### `src/client/settings-card/WorktreeSettingsCard.tsx`

- `WorktreeSettingsCardProps` — 第 19–24 行。插件插槽给本组件绑定的 props：继承 `SettingsFormActions`，外加 `view?`（值为 `'summary'` 时只渲染一句话摘要，其它值渲染表单）、`useWorktreeCard`（由插槽运行时从 `hooks.worktreeCard` 绑定的选择器 hook）。
- `WorktreeSettingsCard(props)` — 第 162–234 行。主渲染函数：
  - 第 163–164 行：经 `useWorktreeCard` 取状态、`useClientTranslator()` 取翻译器。
  - 第 165 行：`view === 'summary'` 仅渲染 `t('settings.description')` 一句话。
  - 第 166 行：`!state.available` 返回 `null`（Host 未服务该命名空间则整卡不渲染）。
  - 第 168 行：`disabled = !state.writable || state.saving`。
  - 第 170–178 行：`switchControl` 渲染 `role="switch"` 按钮，`checked = fieldState.text === 'true'`，点击在 `true`/`false` 间 `props.edit(...)` 切换。
  - 第 180–184 行：`inputControl` 渲染 `type="text"` 输入框，数字字段 `inputMode="numeric"`，`onChange` 调 `props.edit(...)`。
  - 第 188–214 行：五个 `fieldRow` 调用（autoDeliver / autoPush 用开关，worktreesRoot / gitTimeoutMs / worktreeAddTimeoutMs 用输入框），各自带 `label`/`hint`/`onReset`（调 `props.resetField`）。
  - 第 215–231 行：底部 `footer`——左侧按 `failed`/`saving`/`!writable` 显示 `settings.failed`/`settings.saving`/`settings.readonly`；右侧 `Discard`（`disabled` 条件：`!dirty || saving`）与 `Save`（`disabled` 条件：`!writable || !dirty || invalid || saving`）。
- `fieldRow({label, hint, state, control, disabled, onReset, t})` — 第 136–155 行。通用行渲染：`state.invalid` 时显示 `settings.invalid.value`；`state.overridden` 时显示 `settings.overridden` 徽标与 `settings.reset` 还原按钮。
- 颜色/样式常量：第 26–124 行（`ACCENT`/`MUTED`/`DANGER`/`BORDER` 与各类 `CSSProperties`），均为内联样式，无外部样式表（注释 `WorktreeSettingsCard.tsx:29-35` 说明：因本插件随附的 client-ui-primitives 版本早于共享 `SettingsForm`，故行内手绘）。

### `src/client/i18n.tsx`（被卡片组件依赖的翻译基础设施）

- `useClientTranslator(): ClientTranslator` — 第 43–46 行。卡片经此取得 `t(...)`；`ClientTranslator = Translator<typeof clientMessages>`（第 5 行），键集合来自 `clientMessages`。
- `ClientI18nProvider` — 第 29–40 行。测试 `tests/client-settings-card.test.tsx:42` 用 `<ClientI18nProvider language="en">` 包住卡片以固定英文文案。

### `src/i18n/client-messages.ts`（设置页文案，全部为 `settings.*`）

- `settings.title` 第 1586、`settings.description` 第 1587、`settings.readonly` 第 1588、`settings.autoDeliver`(+`.hint`) 第 1589/1590、`settings.autoPush`(+`.hint`) 第 1591/1592、`settings.worktreesRoot`(+`.hint`) 第 1593/1594、`settings.gitTimeoutMs`(+`.hint`) 第 1595/1596、`settings.worktreeAddTimeoutMs`(+`.hint`) 第 1597/1598、`settings.save` 第 1599、`settings.discard` 第 1600、`settings.saving` 第 1601、`settings.failed` 第 1602、`settings.overridden` 第 1603、`settings.reset` 第 1604、`settings.invalid.value` 第 1605。

## Architecture

```text
Host Config (dsh-git-worktree ns)          Client bundle (dsh-git-worktree)
┌───────────────────────────┐              ┌──────────────────────────────────────────────┐
│ configForms.get(WORKTREE_ │              │ mountSettingsCard(ctx)        index.ts:35     │
│   SETTINGS_NS)            │              │   ctx.get('configForms'|'slots') 软探测        │
│ SettingsFormScope<Worktree│◄── snapshot ─┤   whileServed([NS]) → slots.inject(           │
│   Settings>               │   subscribe │     'plugins.bundle.config')  index.ts:52      │
└───────────────────────────┘              │                                              │
                                           │ WorktreeSettingsCardController  w-s-c.ts:39  │
                                           │   form = SettingsFormModel(scope, 5 specs)    │
                                           │   store = form.bind(projection)               │
                                           │   inject() → { hooks.worktreeCard, actions }  │
                                           │        │                                       │
                                           │        ▼                                       │
                                           │ SettingsFormModel<T>  form-model.ts:188       │
                                           │   staged: Map  ·  shell()/field()/actions()   │
                                           │   save() → scope.mutate(ops, revision)         │
                                           │        │                                       │
                                           │        ▼                                       │
                                           │ SnapshotStore<WorktreeSettingsCardState>      │
                                           │        │  useWorktreeCard(selector)            │
                                           │        ▼                                       │
                                           │ WorktreeSettingsCard.tsx  (React 组件)        │
                                           │   switches / inputs / save / discard / badge   │
                                           └──────────────────────────────────────────────┘
```

组件职责切分：

- **挂载层**（`index.ts:35`）只负责以 fail-soft 方式探测 `configForms` 与 `slots` 两个服务，并在 Host 服务该命名空间时把卡片插进 `plugins.bundle.config`。它本身不持有状态，仅创建并持有 `WorktreeSettingsCardController` 的生命周期（effect 进入/退出时建/毁）。
- **控制器层**（`worktree-settings-card.ts:39`）把通用模型与具体字段绑定，把 `SettingsFormShell + 5×SettingsFieldState` 投影成 `WorktreeSettingsCardState`，并产出 `inject()` 的 `WorktreeSettingsCardFace`。
- **模型层**（`form-model.ts:188`）完全与字段无关——它通过 `SettingsFieldSpec` 数组被配置，只负责「暂存草稿 / 计算有效值、覆盖、非法 / 保存时原子写入」这套状态机。
- **视图层**（`WorktreeSettingsCard.tsx:23`）纯函数式渲染：从 `useWorktreeCard` 选择器读 `WorktreeSettingsCardState`，按 `state.view` 决定摘要或表单，按 `state.available` 决定渲染与否，按 `state.invalid`/`state.overridden`/`state.saving`/`state.writable` 决定控件与按钮的禁用与提示。

## Data Flow

1. **装载（mount）**：`mountSettingsCard(ctx)` 在 `src/client/console-remote/index.ts:73` 被 `apply` 调用。它 `ctx.get('configForms')`/`ctx.get('slots')`（`index.ts:39-41`），缺一则 `return`。存在则：
   - `ctx.effect`（`index.ts:44-47`）建 `WorktreeSettingsCardController`，其构造器（`worktree-settings-card.ts:39-48`）用 `configForms.get<WorktreeSettings>(WORKTREE_SETTINGS_NS)` 的 `SettingsFormScope` 建 `SettingsFormModel`，并 `bind` 出 `SnapshotStore`；
   - `ctx.effect`（`index.ts:52-56`）调 `configForms.whileServed([WORKTREE_SETTINGS_NS], …)`：仅在 Host 服务该命名空间时 `slots.inject('plugins.bundle.config', () => slots.register({ key: WORKTREE_SETTINGS_NS, inject: () => controller?.inject() }, WorktreeSettingsCard))`。

2. **快照流入**：`SettingsFormModel` 构造时 `scope.subscribe(() => this.publish())`（`form-model.ts:206`）。每次 Host 表单快照变化（status/value/base/user/writable/revision），`publish()` 触发所有 listener，进而 `store.set(project())` 刷新 `WorktreeSettingsCardState`（`form-model.ts:215`）。

3. **用户编辑（暂存）**：用户敲开关/输入框 → `WorktreeSettingsCard` 调 `props.edit(field, text)`（`WorktreeSettingsCard.tsx:191/197/202/207/212`）或 `switchControl` 在 `true`/`false` 间切换；`edit` 落进 `SettingsFormModel.actions().edit`（`form-model.ts:262`）→ `stage(field, { text, clear: false })`（`form-model.ts:330`），惰性记录 `baseline` 为当前快照（`form-model.ts:331`）、写入 `staged`、清 `failed`、并 `publish()` 立即反映新草稿。`field()`（`form-model.ts:242`）据此重算 `text`/`overridden`/`invalid`。

4. **覆盖判定（核心）**：`field(field)`（`form-model.ts:242-254`）的 `overridden` 来自 `stored(field)`（`form-model.ts:361-364`）——即 `user` 层是否 `Object.hasOwn(user, field)`。注意它**不比较值**：即使草稿等于组合层默认值，只要 `user` 层带着该字段，`overridden` 即为 `true`，组件据此显示「已覆盖」徽标 + 还原按钮（`WorktreeSettingsCard.tsx:146-151`）。

5. **保存（原子写入 + 修订围栏）**：点 `Save`（`WorktreeSettingsCard.tsx:226-229`）调 `props.save()` → `SettingsFormModel.save()`（`form-model.ts:285-303`）：
   - 若 `plan()` 为空、`saving`、`!writable`、或任一暂存项 `op === undefined`（非法草稿）则直接 `return`（`form-model.ts:287-288`）；
   - 置 `saving = true`、`failed = false`、`publish()`；
   - `await scope.mutate(plan.map(op), this.baseline?.revision)`（`form-model.ts:293`）——用最初暂存时的 `revision` 给整批路径编辑加围栏；
   - `landed` 真则 `staged.clear()`、`failed = !landed`、`baseline = undefined`；异常 `catch` 置 `failed = true`；`finally` 中 `saving = false` 并 `publish()`（`form-model.ts:294-302`）。失败保留草稿，便于用户修正而非重输（`form-model.ts:299-306`）。

6. **还原（reset）**：点「还原」按钮（`WorktreeSettingsCard.tsx:149`）或走 `discard` 全量放弃（`WorktreeSettingsCard.tsx:223`）。`resetField(field)`（`form-model.ts:263-265`）把该字段 `stage` 为 `clear: true`，其草稿文本被设为 `baseValue(field)` 的格式化值（视觉上占位但不另起覆盖）；保存时 `plan()`（`form-model.ts:317-319`）仅在 `stored(field)` 为真时发 `unset`，让字段重新继承组合层。`discard`（`form-model.ts:267-274`）在未暂存且未失败时直接返回，否则清空 `staged`、`baseline`、`failed` 并 `publish()`。

7. **摘要视图**：`view === 'summary'`（`WorktreeSettingsCard.tsx:163`）只渲染 `t('settings.description')` 一句话（`client-messages.ts:1587`），不读 `state`，用于 Plugins 页列表位。

## Connections

- [[client-console-remote]]（`src/client/console-remote/index.ts:73` 调 `mountSettingsCard(ctx)`）——本卡片的挂载由 Client 远程入口的 `apply` 触发，而非 `src/client/index.tsx`（浏览器 ToolView 入口不挂载设置卡）。
- [[index-config]]（`src/index.ts:261-319` 的 `Config`，`volatile(...)` 在 `src/index.ts:256-259`）——本卡片编辑的正是 `Config` 中被标记为 volatile 的五个字段（`gitTimeoutMs`/`worktreeAddTimeoutMs`/`autoDeliver`/`autoPush`/`worktreesRoot`，`src/index.ts:271-291`）；volatile 标记使这些字段能进入 settings 页、写入 `cordis.patch.yml` 而**不重挂插件**。注意 `WorktreeSettings` 只有五个字段，比 `Config` 少（`Config` 另有 `inheritLocalChanges`/`worktreeKeepCount`/`branchRaceGuard`/`branchRaceWindowMs`，这些**不在设置卡上编辑**）。
- `src/client/i18n.tsx`（`useClientTranslator`，第 43–46 行）与 `src/i18n/client-messages.ts`（`clientMessages` 的 `settings.*` 键）——提供卡片全部可见文案；`WorktreeSettingsCard.tsx` 经 `useClientTranslator()` 取得 `t(...)`。
- `@deepseek-ai/dsh-client-store`（`createSnapshotStore` / `SnapshotStore`，`form-model.ts:21`）——卡片状态经快照 store 暴露给 React 组件经选择器读取（测试 `tests/client-settings-card.test.tsx:46` 用 `useSyncExternalStore(store.subscribe, store.getSnapshot)` 镜像插槽运行时绑定）。
- Host 的 `configForms` 与 `slots` 服务——本模块仅以最小接口 `ConfigFormsService`/`SlotsService`（`index.ts:19-28`）与之协作，且通过 `ctx.get` 失败即软退出探测；无该服务栈的旧 Host 整页静默不挂载。

## Known Issues

- **挂载依赖隐性服务声明**：`mountSettingsCard` 经由 `ctx.get('configForms')`/`ctx.get('slots')` 读取服务（`index.ts:39-41`）。cordis 仅在 fiber 声明过的服务名上才能解析到该 fiber 的实例，否则 `ctx.get` 返回 `undefined`，导致卡片永久不挂载。该声明来自 `src/client/console-remote/index.ts:73-77` 的 `inject` 数组（含 `'slots'`、`'configForms'`），注释在 `src/client/console-remote/index.ts:30-44` 详述了为何必须将二者纳入声明。
- **`WORKTREE_SETTINGS_NS` 与 loader 名不一致**：配置命名空间 id 为 `'dsh-git-worktree'`（`worktree-settings-card.ts:14`），而插件 loader 名为 `'git-worktree'`（`src/index.ts:245`）。二者易混，但分别用于「Host 配置外键」与「cordis 插件名」，不可互换。
- **`settings.failed` 文案可能误导**：保存未落地（`landed === false` 或抛异常）时组件显示 `settings.failed`（`WorktreeSettingsCard.tsx:217`，文案 `client-messages.ts:1602`「保存未生效，请重试」），但草稿被保留（`form-model.ts:294-298`），用户下次直接改即可；若用户先 `discard`（第 7 步）则 `failed` 一并清空。
- **`resetField` 视觉占位而非直接清空**：`resetField`（`form-model.ts:263-265`）把草稿文本设为 `baseValue` 的格式化值并 `clear: true`，控件并非显示为空白，而是显示组合层默认值，且只有 `user` 层原本携带该字段时才会在保存时发 `unset`（`form-model.ts:317-319`）。这是有意为之（清空即还原），但与直观「清空输入框」不同。
- **`plugin card has no field ${field}` 会抛异常**：若调用方（视图层或测试）对一个未在构造器 `specs` 中声明的字段调 `field()`/`edit()`，模型抛错（`form-model.ts:337-343`）而非静默失灵。当前视图层严格只调五个已知字段，故线上不会触发，但属硬性接线约束。
- **无独立子模块**：本模块（4 文件 + 测试）体量小、组件边界清晰，按规范不拆分独立子文章，全部在本篇内写完。
