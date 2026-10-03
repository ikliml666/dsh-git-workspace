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

插件的设置入口（借鉴 dsh-worktree-panel 的设置页并按 DSH 机制重做）：把 Config schema 中 volatile 字段（autoDeliver/autoPush/worktreesRoot/gitTimeoutMs/worktreeAddTimeoutMs）投影为 Plugins 页里的自定义卡片，暂存编辑、按 revision 栅栏原子保存。宿主自动生成的通用设置页依然存在（autoGenerate 默认 true，shell 亦无抑制先例）；本卡片的价值是中文标签、开关形态与说明文案。

## 宿主机制（本插件自建精简版的原因）

- 宿主 settings 服务（packages/settings）把活跃插件 Config schema 的 `meta.volatile` 字段投影为表单；本地 @deepseek-ai/schemastery 3.18.2 没有 `.volatile()` 方法，src/index.ts 用 `volatile()` 助手直接设 `schema.meta.volatile = true`。
- 写入经 configEditor.edit 落 cordis.patch.yml（与手改同一处），revision CAS；volatile 编辑**不重挂载插件**（apply 不重跑），值以 `{get()}` LiveRef 到达 → 消费方逐次解包（见 [[volatile-settings-live-config]] 决策与 src/ports.ts 的 `liveConfigValue`）。
- 安装的 @deepseek-ai/dsh-client-ui-primitives 0.1.2-rc.1 尚无 settings-form 模块（宿主 0.1.7-rc.2 才有），因此 src/client/settings-card/form-model.ts 按宿主源码 vendored 精简版（去掉 secret 控件），并新增 `settingsBooleanField`（'true'/'false' 草稿文本、空=clear、其余 invalid）、`settingsNumberField`（安全整数、空=clear、非有限数 invalid）与 `settingsTextField`（自由文本、空=clear）。

## 挂载（src/client/settings-card/index.ts + console-remote/index.ts:64）

完全照抄 ui-settings-shell 先例，fail-soft（缺 configForms 或 slots 任一服务直接不挂）。**探测必须用 `ctx.get('configForms')` 软读**：cordis 对未在本插件 inject 里声明的服务做属性读取会抛 "cannot get property without inject"（client-bundle.test.ts 曾因此红）；`ctx.get()` 不走注入纪律、缺失返回 undefined（host-compat 探测可选服务的同一手法）。

```ts
ctx.effect(() => { controller = new WorktreeSettingsCardController(configForms.get(NS)); return () => controller?.dispose(); controller = undefined }, 'dsh-git-worktree: settings form subscription')
ctx.effect(() => configForms.whileServed([NS], () => slots.inject('plugins.bundle.config', () => slots.register({
  name: 'plugins.bundle.config', key: NS,
  inject: () => controller?.inject(),
}, WorktreeSettingsCard))), 'dsh-git-worktree: settings page')
```

NS = 'dsh-git-worktree'（loader entry id，宿主按它索引配置表单）。在 `plugins.bundle.config` slot 注册（keyed by bundle package name，显示在 bundle 自身页面 description 与 rows 之间），而非 `plugins.item`（官方插件列表）。卡片在 console-remote/index.ts 的 `ctx.provide('worktreeConsole', adapter)` 之后挂载（第 64 行），不依赖 flavor 分支。

## 模型与组件

- `SettingsFormScopeSnapshot<T>`（form-model.ts:24-37）：包含 status（loading/ready/unavailable）、value、base（composition layer）、user（raw user layer，存在即 overridden）、writable、revision。
- `SettingsFormPathOp`（form-model.ts:40-42）：`{op:'set';path;value}` 或 `{op:'unset';path}`。
- `SettingsFormScope<T>`（form-model.ts:45-49）：getSnapshot/subscribe/mutate(ops, expectedRevision)。
- `SettingsFieldSpec`（form-model.ts:57-67）：field/format/parse(text→write|undefined)，parse 返回 undefined 时阻塞保存。
- `SettingsFieldState`（form-model.ts:70-77）：text/overridden/invalid。
- `SettingsFormShell`（form-model.ts:80-93）：available/writable/dirty/invalid/saving/failed。
- `SettingsFormActions`（form-model.ts:96-105）：edit(field,text)/resetField(field)/save()/discard()。
- 字段转换函数（form-model.ts:129-179）：`settingsBooleanField(field)` 接受 'true'/'false'/空=clear；`settingsNumberField(field)` 接受安全整数/空=clear；`settingsTextField(field)` 接受任意非空文本/空=clear。
- `SettingsFormModel<T>`（form-model.ts:188-369）：staged 编辑模型——`bind<S>(project)` 产出 SnapshotStore，scope 或草稿变化即重投影；`shell()` 给 available/writable/dirty/invalid/saving/failed；`field(name)` 给 text/overridden/invalid；`actions()` 返回 edit/resetField/save/discard；`save()` 经 `scope.mutate(plan.map(item=>item.op), baseline?.revision)` 原子写，landed 才清草稿，否则 failed 留草稿供修正；`plan()` 构建每字段的 PlannedWrite，无效草稿的条目无 op（阻塞保存但不丢弃）；内部 staged Map 记录每个字段的 StagedEdit（含 clear 标志），`stage()` 更新草稿并触发 publish。
- `WorktreeSettings`（worktree-settings-card.ts:17-23）：interface autoDeliver?:boolean / autoPush?:boolean / worktreesRoot?:string / gitTimeoutMs?:number / worktreeAddTimeoutMs?:number。
- `WorktreeSettingsCardState`（worktree-settings-card.ts:26-32）：extends SettingsFormShell，叠加 5 个 SettingsFieldState 字段。
- `WorktreeSettingsCardFace`（worktree-settings-card.ts:35-37）：hooks:{worktreeCard} + SettingsFormActions。
- `WorktreeSettingsCardController`（worktree-settings-card.ts:39-70）：构造函数装配 5 个字段 spec（2 boolean + 1 text + 2 number），bind projection；`inject()` 返回 `{hooks, ...actions}`（face 直接铺成 props）；`dispose()` 释放 form。
- `WorktreeSettingsCard.tsx`（234 行）：React 组件，通过 `useWorktreeCard` selector hook 读取快照；`view==='summary'` 渲染一行简介，正式视图渲染两个 role="switch" 开关（autoDeliver/autoPush）+ 三个输入框（worktreesRoot/gitTimeoutMs/worktreeAddTimeoutMs）+ 覆盖徽章/还原/保存/放弃，全部 inline style、自包含（不用 dsh-ui primitives 组件）；i18n 走 `useClientTranslator()` 的 settings.* key（src/i18n/client-messages.ts:1408-1427）。CSS 常量 ACCENT='#2563eb'/MUTED='#6b7280'/DANGER='#dc2626'/BORDER='#e5e7eb'；switch 带 knob transition 120ms ease。

## 测试

tests/client-settings-card.test.tsx（stub SettingsFormScope：渲染 5 控件+初始禁用保存；switch 编辑→保存带 `set ['autoDeliver'] false` 与 revision 栅栏；number 无效输入阻塞保存；summary 视图）。宿主侧配套用例在 tests/git-timeouts.test.ts（LiveRef 逐次读取/校验/meta.volatile 标记）与 tests/session-checkout-module.test.ts（worktreesRoot LiveRef 容器回收、autoDeliver LiveRef 指引翻转）。
