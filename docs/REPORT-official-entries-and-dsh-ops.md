# 官方 Worktree 条目无法关闭 & dsh-ops 隐藏官方工具失效 —— 根因报告

日期：2026-11-07
报告人：DSH 会话（分支 `feat/official-base-extension`）

本报告只做定位与给修法，**没有修改 dsh-ops 包内文件，也没有改 profile**。

---

## 一、你说「之前做的取消隐藏官方工具有点问题」

这一判断需要拆分。上一轮（提交 `6eaf200` / `e6a84e5` / `b097967` / `29e1311`）我做的是**删除接管**，即移除本插件通过 Loader 停用官方三条目、并用 `ctx.tools.guard` 拒绝 `create_worktree` 的那套逻辑。这个改动本身没有往任何别人的注册表里塞东西，也没有改 dsh-ops。但它**触发**了两个原本被掩盖的问题：

1. 官方三条目重新进入 Loader 后，`worktree` / `tool-worktree` 两个 id 在 profile 里**各有两条候选**，`plugin_manager` 因此把它们标成 `unaddressable`，开关变灰。
2. dsh-ops 的隐藏逻辑在**当前宿主版本**上本来就跑不通；接管期间它看不到官方 `read`/`glob`/`grep` 之外的现象，所以没人注意。

下面分别给出证据链。

---

## 二、问题甲：`worktree` / `tool-worktree` 无法关闭

### 现象

`plugin_manager list_plugins`（`total: 261`）里：

```
include:worktree        @deepseek-ai/dsh-experimental-worktree        enabled:true  readOnlyReason:"unaddressable"
include:tool-worktree   @deepseek-ai/dsh-experimental-tool-worktree   enabled:true  readOnlyReason:"unaddressable"
include:forge           @deepseek-ai/dsh-experimental-forge           enabled:true  patchId:"forge"
include:forge-github    ...                                          enabled:true  patchId:"forge-github"
include:forge-session   ...                                          enabled:true  patchId:"forge-session"
include:forge-worktree  @deepseek-ai/dsh-experimental-worktree        enabled:true  patchId:"forge-worktree"
include:forge-panel     @deepseek-ai/dsh-experimental-client-ui-forge enabled:true  patchId:"forge-panel"
```

只有前两条是 `unaddressable`，其余五条正常可改。

### 根因

`C:/Users/ik/.dsh/profiles/desktop/package.json` 的 `dsh.profile.bundles` 同时列了两个各自会 insert 同名 id 的 bundle：

- 索引 16：`@deepseek-ai/dsh-experimental-tool-worktree`
- 索引 41：`@deepseek-ai/dsh-experimental-forge-bundle`

两者的 `cordis.patch.yml` 内容（分别位于 `E:/software/deepseek-harness/packages/experimental/tool-worktree/cordis.patch.yml` 与 `.../forge-bundle/cordis.patch.yml`）都包含：

```yaml
- insert:
    - id: worktree
      name: '@deepseek-ai/dsh-experimental-worktree'
    - id: tool-worktree
      name: '@deepseek-ai/dsh-experimental-tool-worktree'
```

`forge-bundle` 的这个 insert 后面还继续 insert `forge` / `forge-github` / `forge-session` / `optional-forge-panel`，**但 `worktree` 和 `tool-worktree` 是重复的**。

`E:/software/deepseek-harness/vendor/include/src/patch.ts:47` 的 `applyPatches` 对无 id 的 insert 只做 `data.push(...clone)`（第 79-81 行），**不查重**。于是顶层出现两条 `id: worktree`、两条 `id: tool-worktree`。

随后 `E:/software/deepseek-harness/packages/boot/plugin-manager/src/index.ts:466-477` 的 `listPlugins` 这样判断可改性：

```ts
const candidates = rows.filter(row => row.id === actual?.options.id)
const candidate = candidates[0]
if (candidate === undefined || candidates.length > 1 || candidate.name !== entry.moduleName
  || actual?.parent.tree.ctx.fiber.entry?.id !== 'include') {
  return { ...entry, readOnlyReason: 'unaddressable' as const }
}
```

`candidates.length > 1` 命中，于是这两条被标成 `unaddressable`，UI 上就是开关灰掉、点不动。`forge` 等其余五条各自只有一条候选，所以正常。

同一段代码里 `include:dsh-everything-find` 等也有 `unaddressable`，那是 `candidates.length === 0`（entry 在 include 之下的位置不符），性质不同。

### 为什么以前能关

接管期间，`src/official-worktree-takeover.ts` 在挂载时通过 `entry.update({ disabled: true })` 直接把这两条运行时停用，所以用户看到的就是「已关闭」，不需要点开关。删掉接管之后，默认状态回到 `enabled:true`，而静态配置又改不动，于是表现为「无法被关闭」。

### 修法（三选一，我都没执行）

**A. 删掉重复的 bundle（最小改动，推荐）**

从 `C:/Users/ik/.dsh/profiles/desktop/package.json` 的 `dsh.profile.bundles` 移除索引 16 的 `@deepseek-ai/dsh-experimental-tool-worktree`。

理由：`forge-bundle` 已经 insert 了 `worktree` 与 `tool-worktree` 两条，且**额外**提供了 `forge` / `forge-github` / `forge-session` / `forge-panel` 四件套。只保留它，功能不减，重复 id 消失。

代价：`tool-worktree` 这个 bundle 本来还提供一个独立的 `create_worktree` 工具注册（`packages/experimental/tool-worktree/src/index.ts` 的 `inject = ['tools', 'worktrees']`），`forge-bundle` 通过 `tool-worktree` 条目同样加载该包，所以能力等价。

**B. 用 profile patch 显式覆盖**

在 `C:/Users/ik/.dsh/profiles/desktop/cordis.patch.yml` 加：

```yaml
- id: worktree
  disabled: true
- id: tool-worktree
  disabled: true
```

但 `listPlugins` 的 `candidates.length > 1` 判断仍会命中（覆盖只改值，不减候选数），**开关依然灰**，只是状态可变。这个方案不能解决「无法关闭」的交互问题，只能预设状态。

**C. 给我改插件，让接管可逆**

不合适。接管本身就是问题甲的历史成因，方向已经定为「官方当底座」。

---

## 三、问题乙：dsh-ops 隐藏 `read` / `glob` / `grep` 失效

### 现象

当前会话的工具表（`cordis_inspect_query` → `host/Tool/listTools`，共 152 个工具）里：

```
read    PRESENT
glob    PRESENT
grep    PRESENT
edit    PRESENT
write   PRESENT
ops_inspect_local_file  PRESENT
ops_glob   PRESENT
ops_grep   PRESENT
```

`dsh-ops` 的行状态：`include:dsh-ops` `enabled:true` / `fiberPhase:"active"`（`plugin_manager list_plugins`）。所以组件是活的，只是没隐藏成功。

### 根因

`C:/Users/ik/.dsh/profiles/desktop/node_modules/dsh-ops/lib/publication/replacements.js:88-92` 的决定逻辑：

```js
const plan = (agent, entry) => {
    if (keepOfficial())
        return [];
    const visible = new Set(visibleNames(tools, agent));
    return [...targets]
        .filter(([official, counterpart]) => visible.has(counterpart) && tools.executable(counterpart, agent) !== undefined
        && (visible.has(official) || entry.deny.includes(official)))
        .map(([official]) => official);
};
```

`targets` 来自 `lib/consumer/replacements.js`，键值对由 `lib/capabilities/replacements.js:2` 固定为：

```js
{ read: 'inspect_local_file', glob: 'glob', grep: 'grep' }
```

`publicToolName`（`lib/policy.js:18-20`）给它们加 `ops_` 前缀，所以实际 counterpart 是 `ops_inspect_local_file` / `ops_glob` / `ops_grep`。

关键在 `tools.executable(counterpart, agent)` —— **第三个参数 `toolSet` 没有传**。宿主实现（`E:/software/deepseek-harness/packages/core/tools/src/index.ts:315-319`）：

```ts
executable(name: string, scope?: ScopeKey, toolSet?: ResolvedToolSet): ToolDefinition | undefined {
  if (toolSet !== undefined) return toolSet.view(scope).get(name)
  const view = this.view(scope)
  return view.registrations.get(name)?.when === undefined ? view.visible.get(name) : undefined
}
```

而 dsh-ops 自己的 native 工具是**带 `when` 条件注册**的（`lib/publication/native.js:78-80`）：

```js
const remove = publicationRegistration(entry.ctx, () => entry.ctx.tools.register(tool, { when: async (activation) => activation.agent === agent && cover(agent)
        && !await activationIsPtc(prompt, activation) }));
```

于是 `view.registrations.get('ops_glob').when !== undefined` → `executable(...)` 返回 `undefined` → 过滤条件 `tools.executable(counterpart, agent) !== undefined` 恒为假 → `deny` 恒为空 → `apply()` 里 `deny.length === 0` 直接 `return`，**一个工具都不隐藏**。

`lib/official-tool-hiding.js:49` 有一处写法是正确的（`toolSet ? tools.executable(counterpart, agent, toolSet) : undefined`），说明作者知道要传 `toolSet`；但同一文件第 59 行的 `readiness()` 与 `replacements.js:90` 的 `plan()` 都漏了。

### 为什么现在才暴露

`lib/official-tool-hiding.js` 与 `lib/publication/replacements.js` 的文件时间都是 `2026-11-06 19:19`（dsh-ops 0.5.0 安装/更新时间），而宿主的 `executable()` 在无 `toolSet` 时对带 `when` 的注册返回 `undefined` —— 这个语义在上游 `packages/core/tools/src/index.ts:315` 就是如此。两者凑在一起必然失效。接管期间官方文件工具被 Loader 层停用，`read`/`glob`/`grep` 压根不在表里，dsh-ops 隐藏与否看不出差别，问题被掩盖。

### 修法（我都没执行，因为 dsh-ops 在 node_modules 里）

**A. 上报给 dsh-ops 作者（推荐）**

问题在 `dsh-ops@0.5.0` 自身，正确修法是让这两处调用带上当前 step 的 `toolSet`：

- `lib/publication/replacements.js:90`：`plan(agent, entry)` 需要能拿到 `toolSet`。现有签名只有 `(agent, entry)`，而 `apply()` 是在 `system-prompt/assemble` 的 `flush()` 之后跑的，拿不到 step 的 `ResolvedToolSet`。可行的修法是把 `executable` 换成 `visible.has(counterpart)`（官方 `visibleNames` 已经用同一个函数的默认视图判断过），或者改用 `tools.get(counterpart, agent) !== undefined`（`get` 对带 `when` 的注册仍会返回定义，因为它只读 `visible`，不检查 `when`，见 `packages/core/tools/src/index.ts:303-305`）。
- `lib/official-tool-hiding.js:59` 的 `readiness()` 同理。

**B. 本地临时补丁（不推荐，会被重装覆盖）**

把 `replacements.js:90` 的 `tools.executable(counterpart, agent) !== undefined` 改成 `tools.get(counterpart, agent) !== undefined`，并把 `official-tool-hiding.js:59` 同样处理。改完必须重启 Host。pnpm 重装或升级 dsh-ops 会丢失。

**C. 关掉 dsh-ops 的这个功能**

在 dsh-ops 行设置里把 `global.hideOfficialTools` 设为 `false`。这样不会有「看起来开了却没生效」的错觉，官方文件工具与 `ops_*` 并存。这是最诚实的兜底。

---

## 四、两个问题的关系

它们**没有共同根因**，都指向「本插件删除接管」这一个时间点之后暴露出来的独立问题：

| | 问题甲 | 问题乙 |
| --- | --- | --- |
| 出错位置 | profile 的 bundles 列表 | dsh-ops 0.5.0 的 `replacements.js` |
| 机制 | 两个 bundle 各自 insert 同名 id → 候选数 > 1 → `unaddressable` | `executable()` 漏传 `toolSet` → 带 `when` 的 OPS 工具被判为不可用 |
| 与本插件改动的关系 | 接管删除后默认状态回到 enabled，问题可见 | 无直接关系；接管期间官方工具不出现，问题被掩盖 |
| 我的责任 | 我删了接管，导致「无法关闭」变得可见 | 无。我没有改动 dsh-ops，也没有改动 `tools.executable` 的语义 |
| 修在哪 | profile 配置（一行） | dsh-ops 包（两行）或上报作者 |

---

## 五、建议的执行顺序

1. **问题甲**：从 `package.json` 的 `dsh.profile.bundles` 删掉 `@deepseek-ai/dsh-experimental-tool-worktree`，重启。开关立刻恢复可点。
2. **问题乙**：给 dsh-ops 开 issue，附本报告第三节的调用栈与两处行号。临时可以先把它关掉，避免「开了没生效」。
3. 两步都不需要改本插件（`dsh-git-worktree`）的任何代码。

---

## 六、证据文件清单

| 用途 | 路径 |
| --- | --- |
| patch 合并不查重 | `E:/software/deepseek-harness/vendor/include/src/patch.ts:47,79-81` |
| `unaddressable` 判定 | `E:/software/deepseek-harness/packages/boot/plugin-manager/src/index.ts:466-477` |
| bundle patch 收集顺序 | `E:/software/deepseek-harness/packages/boot/app-boot/src/profile-context.ts:63-85` |
| 重复 insert 的两个来源 | `E:/software/deepseek-harness/packages/experimental/tool-worktree/cordis.patch.yml`、`.../forge-bundle/cordis.patch.yml` |
| 宿主 `executable` 语义 | `E:/software/deepseek-harness/packages/core/tools/src/index.ts:315-319` |
| dsh-ops 漏传 toolSet（隐藏） | `C:/Users/ik/.dsh/profiles/desktop/node_modules/dsh-ops/lib/publication/replacements.js:90` |
| dsh-ops 漏传 toolSet（就绪检查） | `.../dsh-ops/lib/official-tool-hiding.js:59` |
| dsh-ops 带 `when` 注册 native 工具 | `.../dsh-ops/lib/publication/native.js:78-80` |
| 替换映射（read/glob/grep） | `.../dsh-ops/lib/capabilities/replacements.js:2`、`.../dsh-ops/lib/policy.js:18-20` |
| profile bundles 顺序 | `C:/Users/ik/.dsh/profiles/desktop/package.json` 的 `dsh.profile.bundles`（索引 16 与 41） |
