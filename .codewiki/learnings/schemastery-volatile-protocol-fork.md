# Learning: schemastery 版本分叉让 volatile 热更新静默失效

日期：2026-10-04 · 关联：插件页设置卡保存回显旧值

## 现象

设置卡（`plugins.bundle.config` 暂存表单）点保存后：磁盘（cordis.patch.yml）、user 覆盖层、revision、覆盖标记全部正确更新，但卡片立即弹回旧值；重启 DSH 后值才变对。

## 根因

volatile 热更新是三方协议，两端版本必须匹配：

1. **schema 端**：schemastery ≥3.18.4 的 `Schema.resolve` 看到 `schema.meta.volatile` 时产出 cosmokit volatile 引用（`Object.freeze({ get, [write] })`）；3.18.2 产出普通值（无此代码路径）。
2. **Loader 端**：cordis-plugin-loader 的 `Entry.update` 检测到 volatile-only 变更时走 `_commitVolatile()`——用 `volatileEntries(fiber.config)` 收集引用，逐个 `updateVolatile(ref, source)` 原地改值，**不 remount 插件**。
3. **collect 端**：`volatileEntries` 只认带 cosmokit volatile write symbol 的对象。

插件当时把 `@deepseek-ai/schemastery` 精确锁在 `3.18.2`（`package.json` dependencies），link 安装后运行时解析到自己的 3.18.2：`fiber.config` 的 volatile 字段是普通值 → `volatileEntries` 收集到 0 个引用 → `_commitVolatile` 直接返回（不更新、不 remount）→ `fiber.config` 永停启动时快照 → 宿主 settings describe 投影的 `value` 永远是旧值。而写入侧（configEditor→patch.yml→user 层→revision）全部正常，所以表现为「保存成功但 UI 回弹」。

## 修复

`pnpm up @deepseek-ai/schemastery@3.18.4`（对齐宿主运行时版本）。升级后插件内所有读取点（`liveConfigValue`）无需改动——它们本来就把字段当 `LiveValue` 设计。

## 教训

- **给字段打 `meta.volatile` 标记是对运行时协议的承诺**，不是元数据装饰：标记只有在 schema 解析器、Loader、值收集器三方都实现引用协议时才生效，任何一端版本落后都让热更新静默退化（不报错、不 remount、值不动）。
- **锁版本的 internal 依赖要与宿主运行时对齐**，尤其是协议型的（schemastery/cosmokit/cordis）。升级前可用最小模拟判定：`Config['~standard'].validate(raw)` 产出的字段是引用还是普通值。
- 断言 schema 解析产物的测试要 volatile-aware（引用对象 vs 裸值），例如 `tests/git-timeouts.test.ts` 的 `resolveField` 解包。
