---
title: Settings Card 插件设置页
type: module
source_files:
  - src/client/settings-card/form-model.ts
  - src/client/settings-card/worktree-settings-card.ts
  - src/client/settings-card/WorktreeSettingsCard.tsx
  - src/client/settings-card/index.ts
  - src/client/console-remote/index.ts
  - src/i18n/client-messages.ts
tags:
  - client
  - settings
  - volatile-config
  - slots
---

# Settings Card 插件设置页

插件的设置入口：将 Config schema 中 `dsh-git-worktree` namespace 的 volatile 字段（autoDeliver/autoPush/worktreesRoot/gitTimeoutMs/worktreeAddTimeoutMs）投影为 Plugins 页面中的自定义卡片。该卡片支持暂存编辑、按 revision 栅栏原子保存，并提供中文标签、开关形态与说明文案。

## Overview

由于宿主安装的 `@deepseek-ai/dsh-client-ui-primitives` 版本（0.1.7-rc.2 之前）尚未包含共享的 `SettingsForm` 模块，本插件在客户端 bundle 中自包含了精简版的表单模型（`form-model.ts`）。该模型去掉了写密（write-only secret）控件，仅处理可见字段的编辑。

卡片通过 `ctx.get()` fail-soft 探测宿主的 `configForms` 和 `slots` 服务。如果宿主未提供这些服务，挂载过程静默跳过。卡片注册在 `plugins.bundle.config` slot 中，仅在 Host 服务对应的 namespace 时渲染。

## Key Components

### form-model.ts

**类型定义：**

*   **`SettingsFormScopeSnapshot<T>`** (行 24-37): 快照接口
    *   `status`: `'loading' | 'ready' | 'unavailable'` (行 26)
    *   `value`: `T | undefined` (行 29)
    *   `base`: `unknown` (行 32) - Composition layer，清除字段后的还原值。
    *   `user`: `unknown` (行 35) - Raw user layer，存在即标记为 overridden。
    *   `writable`: `boolean` (行 38)
    *   `revision`: `number | undefined` (行 41)
*   **`SettingsFormPathOp`** (行 44-46): 路径操作类型
    *   `{ op: 'set'; path: readonly string[]; value: unknown }`
    *   `{ op: 'unset'; path: readonly string[] }`
*   **`SettingsFormScope<T>`** (行 49-53): 作用域接口
    *   `getSnapshot(): SettingsFormScopeSnapshot<T>`
    *   `subscribe(listener: () => void): () => void`
    *   `mutate(ops: readonly SettingsFormPathOp[], expectedRevision?: number): Promise<boolean>`
*   **`SettingsFieldWrite`** (行 56-59): 字段写入类型
    *   `{ kind: 'set'; value: unknown }`
    *   `{ kind: 'clear' }`
*   **`SettingsFieldSpec`** (行 62-72): 字段规格接口
    *   `field: string` (行 63)
    *   `format: (value: unknown) => string` (行 66)
    *   `parse: (text: string) => SettingsFieldWrite | undefined` (行 70) - 返回 undefined 表示无效，阻塞保存。
*   **`SettingsFieldState`** (行 75-81): 字段状态接口
    *   `text: string` (行 76)
    *   `overridden: boolean` (行 79)
    *   `invalid: boolean` (行 82)
*   **`SettingsFormShell`** (行 84-97): 表单壳状态接口
    *   `available: boolean` (行 85)
    *   `writable: boolean` (行 88)
    *   `dirty: boolean` (行 91)
    *   `invalid: boolean` (行 94)
    *   `saving: boolean` (行 97)
    *   `failed: boolean` (行 100)
*   **`SettingsFormActions`** (行 103-112): 动作接口
    *   `edit: (field: string, text: string) => void` (行 104)
    *   `resetField: (field: string) => void` (行 107)
    *   `save: () => void` (行 110)
    *   `discard: () => void` (行 113)

**类与方法：**

*   **`SettingsFormModel<T>`** (行 130-369): 核心模型类
    *   `constructor(scope: SettingsFormScope<T>, specs: SettingsFieldSpec[])` (行 135-140)
        *   初始化 specs Map，订阅 scope 变化。
    *   `bind<S>(project: () => S): SnapshotStore<S>` (行 148-153)
        *   创建并绑定 SnapshotStore，scope 或草稿变化时重投影。
    *   `shell(): SettingsFormShell` (行 161-171)
        *   读取表单级状态（available/writable/dirty/invalid/saving/failed）。
    *   `field(field: string): SettingsFieldState` (行 179-191)
        *   读取单个控件状态（text/overridden/invalid）。
    *   `actions(): SettingsFormActions` (行 199-215)
        *   返回 edit/resetField/save/discard 动作绑定。
    *   `async save(): Promise<void>` (行 223-247)
        *   执行原子保存。检查 plan 长度、saving 状态、writable 状态及 invalid 状态。调用 `scope.mutate`，成功后清除 staged edits，失败则设置 failed 标志并保留草稿。
    *   `dispose(): void` (行 250)
        *   释放订阅。
    *   `private plan(): PlannedWrite[]` (行 258-277)
        *   构建待写入的计划列表。过滤掉未更改的字段，识别 clear 和 set 操作。
    *   `private stage(field: string, edit: StagedEdit): void` (行 279-285)
        *   记录草稿，触发 publish。
    *   `private spec(field: string): SettingsFieldSpec` (行 287-293)
        *   获取字段规格，缺失则抛错。
    *   `private snapshotOf(): SettingsFormScopeSnapshot<T>` (行 295-297)
    *   `private sectionValue(field: string): unknown` (行 299-301)
    *   `private baseValue(field: string): unknown` (行 303-305)
    *   `private userLayer(): Record<string, unknown> | undefined` (行 307-309)
    *   `private stored(field: string): boolean` (行 311-314)
        *   检查 user layer 中是否存在该字段。
    *   `private publish(): void` (行 316-318)

**工厂函数：**

*   **`settingsBooleanField(field: string): SettingsFieldSpec`** (行 115-127)
    *   处理布尔值。格式化为 'true'/'false'，解析时空字符串为 clear，其余为 invalid。
*   **`settingsNumberField(field: string): SettingsFieldSpec`** (行 132-146)
    *   处理整数。格式化为字符串，解析时要求 `Number.isSafeInteger`，否则 invalid。
*   **`settingsTextField(field: string): SettingsFieldSpec`** (行 151-163)
    *   处理自由文本。空字符串为 clear，非空为 set。

### worktree-settings-card.ts

**常量：**

*   **`WORKTREE_SETTINGS_NS`** (行 6): `'dsh-git-worktree'`

**接口：**

*   **`WorktreeSettings`** (行 9-15): 配置接口
    *   `autoDeliver?: boolean`
    *   `autoPush?: boolean`
    *   `worktreesRoot?: string`
    *   `gitTimeoutMs?: number`
    *   `worktreeAddTimeoutMs?: number`
*   **`WorktreeSettingsCardState`** (行 18-24): 卡片状态接口
    *   extends `SettingsFormShell`
    *   `autoDeliver: SettingsFieldState`
    *   `autoPush: SettingsFieldState`
    *   `worktreesRoot: SettingsFieldState`
    *   `gitTimeoutMs: SettingsFieldState`
    *   `worktreeAddTimeoutMs: SettingsFieldState`
*   **`WorktreeSettingsCardFace`** (行 27-29): 注入面接口
    *   `hooks: { worktreeCard: SnapshotStore<WorktreeSettingsCardState> }`
    *   extends `SettingsFormActions`

**类：**

*   **`WorktreeSettingsCardController`** (行 31-65): 控制器类
    *   `constructor(scope: SettingsFormScope<WorktreeSettings>)` (行 33-46)
        *   创建 `SettingsFormModel`，装配 5 个字段 spec（2 boolean, 1 text, 2 number）。
        *   绑定 projection store。
    *   `private projection(): WorktreeSettingsCardState` (行 48-58)
        *   组合 shell 和 5 个 field 状态。
    *   `inject(): WorktreeSettingsCardFace` (行 60-62)
        *   返回 hooks 和 actions。
    *   `dispose(): void` (行 64)

### WorktreeSettingsCard.tsx

**组件：**

*   **`WorktreeSettingsCard`** (行 53-138): React 组件
    *   Props: `view`, `useWorktreeCard`, `edit`, `resetField`, `save`, `discard`。
    *   逻辑：
        *   使用 `useWorktreeCard` hook 读取状态。
        *   `view === 'summary'` 时返回简介。
        *   不可用时返回 null。
        *   渲染 5 个 `fieldRow`：
            *   `autoDeliver`: Switch 控件。
            *   `autoPush`: Switch 控件。
            *   `worktreesRoot`: Text Input。
            *   `gitTimeoutMs`: Numeric Input。
            *   `worktreeAddTimeoutMs`: Numeric Input。
        *   Footer: 显示状态信息（failed/saving/readonly），包含 Discard 和 Save 按钮。
    *   样式：全部 inline style，无外部依赖。

### index.ts

**函数：**

*   **`mountSettingsCard(ctx: Context): void`** (行 35-65): 挂载入口
    *   Fail-soft 检查 `configForms` 和 `slots` 服务。
    *   `ctx.effect` 创建 Controller 并管理生命周期。
    *   `configForms.whileServed` 监听 namespace 服务状态。
    *   `slots.inject` 将卡片注册到 `plugins.bundle.config` slot。

### console-remote/index.ts

**连接点：**

*   **`apply` 函数** (行 43-165): 主应用逻辑
    *   行 64: 调用 `mountSettingsCard(ctx)`。
    *   此挂载发生在 `ctx.provide('worktreeConsole', adapter)` 之后，不依赖 flavor 分支。
*   **`inject` 数组** (行 32-37):
    *   包含 `'slots'` 和 `'configForms'`，确保 cordis 能正确解析这些服务。

### client-messages.ts

**i18n 键值对：**

*   `settings.title`, `settings.description`, `settings.readonly`
*   `settings.autoDeliver`, `settings.autoDeliver.hint`
*   `settings.autoPush`, `settings.autoPush.hint`
*   `settings.worktreesRoot`, `settings.worktreesRoot.hint`
*   `settings.gitTimeoutMs`, `settings.gitTimeoutMs.hint`
*   `settings.worktreeAddTimeoutMs`, `settings.worktreeAddTimeoutMs.hint`
*   `settings.save`, `settings.discard`, `settings.saving`, `settings.failed`
*   `settings.overridden`, `settings.reset`, `settings.invalid.value`

## Architecture

```text
┌──────────────────────────────────────────────────────────────┐
│                      Host Environment                        │
│  ┌─────────────────┐   ┌──────────────────────────────────┐  │
│  │ configForms     │   │ slots                            │  │
│  │ (Service)       │   │ (Service)                        │  │
│  └───────┬─────────┘   └──────────────┬───────────────────┘  │
│          │ get()                       │ inject/register()   │
│          ▼                             ▼                     │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │              Client Bundle (dsh-git-worktree)           │ │
│  │                                                         │ │
│  │  ┌─────────────────────┐                                │ │
│  │  │ console-remote      │                                │ │
│  │  │ apply()             │                                │ │
│  │  │ mountSettingsCard() │                                │ │
│  │  └─────────┬───────────┘                                │ │
│  │            │                                             │ │
│  │  ┌─────────▼───────────┐                                │ │
│  │  │ index.ts            │                                │ │
│  │  │ mountSettingsCard() │                                │ │
│  │  └─────────┬───────────┘                                │ │
│  │            │                                             │ │
│  │  ┌─────────▼───────────┐                                │ │
│  │  │ worktree-settings-  │                                │ │
│  │  │ card.ts             │                                │ │
│  │  │ Controller          │                                │ │
│  │  └─────────┬───────────┘                                │ │
│  │            │ inject()                                    │ │
│  │  ┌─────────▼───────────┐                                │ │
│  │  │ WorktreeSettings    │                                │ │
│  │  │ Card.tsx            │                                │ │
│  │  └─────────┬───────────┘                                │ │
│  │            │ useWorktreeCard                             │ │
│  │  ┌─────────▼───────────┐                                │ │
│  │  │ form-model.ts       │                                │ │
│  │  │ SettingsFormModel   │                                │ │
│  │  └─────────────────────┘                                │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

## Data Flow

1.  **Mount**: `console-remote/index.ts` 的 `apply` 函数调用 `mountSettingsCard`。
2.  **Probe**: `index.ts` 中的 `mountSettingsCard` 使用 `ctx.get('configForms')` 和 `ctx.get('slots')` 进行软读。若任一为 undefined，函数返回。
3.  **Subscribe**: `configForms.whileServed([WORKTREE_SETTINGS_NS], ...)` 监听 namespace 是否就绪。
4.  **Inject**: 当 namespace 就绪，`slots.inject` 将卡片注册到 `plugins.bundle.config`。
5.  **Render**: 卡片组件通过 `useWorktreeCard` hook 从 `SnapshotStore` 读取状态。
6.  **Edit**: 用户输入触发 `props.edit(field, text)`，调用 `SettingsFormModel.stage`。
7.  **Save**: 用户点击保存，触发 `props.save()`，调用 `SettingsFormModel.save`。
8.  **Mutate**: `save` 方法构建 `plan`，调用 `scope.mutate` 发送 `SettingsFormPathOp`。
9.  **Re-seed**: 保存成功后，staged edits 被清除，状态重新同步。

## Connections

*   [[volatile-settings-live-config]]: Volatile 配置的生命周期管理。
*   [[console-remote-adapter]]: Console Remote Adapter 的实现。
*   [[client-i18n]]: 客户端国际化机制。