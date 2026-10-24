---
title: 宿主 rc 升级会拒载精确钉版本的 dsh-* peer
type: learning
source_files:
  - package.json
tags:
  - compatibility
  - peerDependencies
  - dsh-runtime
---

# 宿主 rc 升级会拒载精确钉版本的 dsh-* peer

## 现象

当宿主 DeepSeek Harness (dsh) 进行预发布版本（rc）升级时，如果插件 `package.json` 中使用了精确版本号（exact pin，即不带 `^` 或 `~` 的单个版本或固定 OR 列表）来声明 `@deepseek-ai/dsh-*` 系列的 peer dependencies，宿主启动时的 bundle 加载器会直接跳过该插件。

错误日志示例（宿主升级至未列入清单的 rc 版本时）：
```text
dsh: skipping profile bundle "dsh-git-worktree": Error: Plugin dsh-git-worktree@0.11.0 is
incompatible with dsh 0.2.2-rc.1: peerDependencies {"@deepseek-ai/dsh-client-locale":"0.1.2-rc.1 || 0.1.7-rc.2 || 0.2.0-rc.1 || 0.2.0-rc.2 || 0.2.1-alpha.1 || 0.2.1-rc.1 || 0.2.1-rc.2"}.
```

当前插件版本为 `0.11.0`（见 `package.json:3`）。此问题源于宿主内部的兼容性检查机制对“精确钉版本”与“当前运行时版本”的严格匹配要求。

## 根因

宿主启动预检逻辑位于 DeepSeek Harness 仓库的 `packages/boot/app-boot/src/plugin-compatibility.ts` 文件中的 `evaluatePluginCompatibility` 函数。该函数在清单里每个 `@deepseek-ai/dsh-*` peer 上执行以下操作：

1. 使用 `semver.satisfies(runtimeVersion, range, { includePrerelease: true })` 判断宿主当前版本是否满足 peer 声明的范围。
2. 如果不满足，汇总所有不匹配的 peer，并拒绝加载整个插件包。

该文件不属于本插件仓库，但行为决定于本插件 `package.json` 中 peer 的写法。

### 为什么精确钉版本会失败？

- **精确钉版本**（如 `0.2.1-rc.2`）被视为一个具体的点版本。如果宿主运行的是 `0.2.1-rc.3`，即使两者同属 `0.2.1` 大版本，semver 精确比较也会判定为不匹配（rc 号差一即败）。
- **范围风格**（如 `^0.2.0-rc.1`）则允许同元组（major.minor）下的任何预发布版本（包括 `0.2.0-rc.2`、`0.2.1-rc.1` 等），因此其余 peer 全部无恙。
- 该兼容检查脚本还支持 `workspace:^|~|*` 协议，会将其直接映射为当前运行时版本，从而绕过 semver 比较。

目前本插件中唯一使用精确钉风格（无 `^` 前缀的 OR 列表）的 peer 是 `@deepseek-ai/dsh-client-locale`（见 `package.json:93`），它是潜在兼容性报错的唯一失配点。

## 当前 peerDependencies 状态（package.json:89-105）

本插件共声明了 15 个 peer dependencies（含 react）。以下是详细分类：

| peer | 范围风格 (`^`) | 精确钉风格 (Exact) | 状态 |
|------|---------|-----------|------|
| `@deepseek-ai/cordis` | `^4.0.5` (`package.json:90`) | — | OK |
| `@deepseek-ai/cordis-plugin-loader` | `^1.0.6` (`package.json:91`) | — | OK |
| `@deepseek-ai/dsh-agent` | `^0.1.2-rc.1 \|\| ^0.2.0-rc.1 \|\| ^0.2.1-rc.1` (`package.json:92`) | — | OK |
| `@deepseek-ai/dsh-client-locale` | — | `0.1.2-rc.1 \|\| 0.1.7-rc.2 \|\| 0.2.0-rc.1 \|\| 0.2.0-rc.2 \|\| 0.2.1-alpha.1 \|\| 0.2.1-rc.1 \|\| 0.2.1-rc.2` (`package.json:93`) | **需关注** |
| `@deepseek-ai/dsh-commands` | `^0.1.2-rc.1 \|\| ^0.2.0-rc.1 \|\| ^0.2.1-rc.1` (`package.json:94`) | — | OK |
| `@deepseek-ai/dsh-fs` | `^0.1.2-rc.1 \|\| ^0.2.0-rc.1 \|\| ^0.2.1-rc.1` (`package.json:95`) | — | OK |
| `@deepseek-ai/dsh-session` | `^0.1.2-rc.1 \|\| ^0.2.0-rc.1 \|\| ^0.2.1-rc.1` (`package.json:96`) | — | OK |
| `@deepseek-ai/dsh-skill` | `^0.1.2-rc.1 \|\| ^0.2.0-rc.1 \|\| ^0.2.1-rc.1` (`package.json:97`) | — | OK |
| `@deepseek-ai/dsh-skill-filesystem` | `^0.1.2-rc.1 \|\| ^0.2.0-rc.1 \|\| ^0.2.1-rc.1` (`package.json:98`) | — | OK |
| `@deepseek-ai/dsh-subprocess` | `^0.1.2-rc.1 \|\| ^0.2.0-rc.1 \|\| ^0.2.1-rc.1` (`package.json:99`) | — | OK |
| `@deepseek-ai/dsh-system-prompt` | `^0.1.2-rc.1 \|\| ^0.2.0-rc.1 \|\| ^0.2.1-rc.1` (`package.json:100`) | — | OK |
| `@deepseek-ai/dsh-tools` | `^0.1.2-rc.1 \|\| ^0.2.0-rc.1 \|\| ^0.2.1-rc.1` (`package.json:101`) | — | OK |
| `@deepseek-ai/dsh-typert-protocol` | `^0.1.2-rc.1 \|\| ^0.2.0-rc.1 \|\| ^0.2.1-rc.1` (`package.json:102`) | — | OK |
| `@deepseek-ai/dsh-typert-registry` | `^0.1.2-rc.1 \|\| ^0.2.0-rc.1 \|\| ^0.2.1-rc.1` (`package.json:103`) | — | OK |
| `react` | `^18.2.0` (`package.json:104`) | — | OK |

如上表所示，`@deepseek-ai/dsh-client-locale` 是唯一采用精确钉风格的 peer（见 `package.json:93`）。其余 14 个均为 `^` 范围风格或 react 的宽范围，能够自动兼容同大版本的后续 rc 更新。注意当前 `@deepseek-ai/dsh-client-locale` 的 OR 列表中已包含 `0.2.1-rc.2`（见 `package.json:93`），这说明之前针对 `0.2.0-rc.2` 或 `0.2.1-rc.2` 的升级已通过手动追加方式临时修复，但本质上仍是精确钉，未来新 rc 仍会触发拒载。

## 修复与验证

### 修复方案

针对 `@deepseek-ai/dsh-client-locale` 的精确钉风格，最简单的修复方式是追加新的 rc 版本到 OR 列表中。

例如，当宿主升级到 `0.2.1-rc.3` 时，将 `package.json:93` 修改为：
```json
"@deepseek-ai/dsh-client-locale": "0.1.2-rc.1 || 0.1.7-rc.2 || 0.2.0-rc.1 || 0.2.0-rc.2 || 0.2.1-alpha.1 || 0.2.1-rc.1 || 0.2.1-rc.2 || 0.2.1-rc.3"
```

这种做法沿用了文件中已有的精确钉风格，只需一行修改即可解决当次升级导致的拒载问题。

### 验证方式

可以使用宿主同款 semver 库与参数复刻预检循环，读取实际的 `package.json` 进行验证：
1. 获取宿主当前版本 `runtimeVersion`。
2. 遍历 `peerDependencies`（位于 `package.json:89-105`）。
3. 对每个 peer 执行 `semver.satisfies(runtimeVersion, range, { includePrerelease: true })`。
4. 确认所有 peer 返回 `true`。

## 复发与对策

每次宿主 dsh 进行 rc 升级，都会再次打掉那些未更新的精确钉 peer。面对这一重复性问题，有三个主要选项：

1. **同步追加新 rc 到范围**（当前做法）：
   - **优点**：简单直接，一行代码，立即生效。
   - **缺点**：每次宿主发新版 rc 都需要手动维护插件，属于被动响应。

2. **改用 `workspace:*` / `workspace:^`**：
   - **原理**：加载器会将这些协议直接映射为当前运行时版本，从而彻底绕过 semver 比较。本地适配版可以一劳永逸地解决版本漂移问题。
   - **代价**：在使用 `pnpm publish` 发布到公共仓库时，这些依赖会被改写为具体版本号。对于仅作为本地 fork 或未发布的内部插件，影响为零；但如果计划公开发布，需注意语义变化。

3. **应急豁免**：
   - **命令**：`dsh plugin allow-version dsh-git-worktree@<版本> on dsh <运行时版本>`
   - **说明**：按精确「插件版本 + 运行时版本」对授权，明确接受风险。
   - **建议**：不推荐长期挂起，仅用于紧急恢复服务。

## Connections

[[learnings/host-rc-bump-breaks-exact-pin-peers]]