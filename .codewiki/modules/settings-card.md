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
- 安装的 @deepseek-ai/dsh-client-ui-primitives 0.1.2-rc.1 尚无 settings-form 模块（宿主 0.1.7-rc.2 才有），因此 src/client/settings-card/form-model.ts 按宿主源码 vendored 精简版（去掉 secret 控件），并新增 `settingsBooleanField`（'true'/'false' 草稿文本、空=clear、其余 invalid）。

## 挂载（src/client/settings-card/index.ts + console-remote/index.ts:10,45）

完全照抄 ui-settings-shell 先例，fail-soft（缺 configForms 或 slots 任一服务直接不挂）。**探测必须用 `ctx.get('configForms')` 软读**：cordis 对未在本插件 inject 里声明的服务做属性读取会抛 "cannot get property without inject"（client-bundle.test.ts 曾因此红）；`ctx.get()` 不走注入纪律、缺失返回 undefined（host-compat 探测可选服务的同一手法）。

```ts
ctx.effect(() => { controller = new WorktreeSettingsCardController(configForms.get(NS)); return () => controller?.dispose() })
ctx.effect(() => configForms.whileServed([NS], () => slots.inject('plugins.item', () => slots.register({
  name: 'plugins.item', id: 'dsh-git-worktree', order: 40,
  label: () => translatorForServices({ locale: ctx.get('locale') })('settings.title'),
  inject: () => controller?.inject(),
}, WorktreeSettingsCard))))
```

NS = 'dsh-git-worktree'（loader entry id，宿主按它索引配置表单）。卡片在 console-remote/index.ts 的 `ctx.provide('worktreeConsole', adapter)` 之后挂载，不依赖 flavor 分支。

## 模型与组件

- `SettingsFormModel<T>`（form-model.ts）：staged 编辑模型——`bind(project)` 产出 SnapshotStore，scope 或草稿变化即重投影；`shell()` 给 available/writable/dirty/invalid/saving/failed；`field(name)` 给 text/overridden/invalid；`save()` 经 `scope.mutate(ops, baselineRevision)` 原子写，landed 才清草稿，否则 failed 留草稿供修正；parse 返回 undefined 的草稿阻塞保存而不是被丢弃。
- `WorktreeSettingsCardController`（worktree-settings-card.ts）：5 个字段的 spec 装配 + `inject()` 返回 `{ hooks: { worktreeCard: store }, edit/resetField/save/discard }`（face 直接铺成组件 props）。
- `WorktreeSettingsCard.tsx`：React 组件，通过 `useWorktreeCard` selector hook（由 slot runtime 将 `hooks.worktreeCard` 绑为 `useSyncExternalStore` 封装）读取快照；`view === 'summary'` 渲染一行简介，正式视图渲染两个 role="switch" 开关（autoDeliver/autoPush）+ 三个输入框（worktreesRoot/两超时）+ 覆盖徽章/还原/保存/放弃，全部 inline style、自包含（不用 dsh-ui primitives 组件）；i18n 走 `useClientTranslator()` 的 settings.* key（src/i18n/client-messages.ts）。

## 测试

tests/client-settings-card.test.tsx（stub SettingsFormScope：渲染 5 控件+初始禁用保存；switch 编辑→保存带 `set ['autoDeliver'] false` 与 revision 栅栏；number 无效输入阻塞保存；summary 视图）。宿主侧配套用例在 tests/git-timeouts.test.ts（LiveRef 逐次读取/校验/meta.volatile 标记）与 tests/session-checkout-module.test.ts（worktreesRoot LiveRef 容器回收、autoDeliver LiveRef 指引翻转）。
