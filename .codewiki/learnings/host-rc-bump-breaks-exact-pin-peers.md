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

2026-09-30 宿主 dsh 从 0.1.7-rc.2 升到 0.2.0-rc.2 后，重启时 bundle 加载器直接跳过本插件：

```
dsh: skipping profile bundle "dsh-git-worktree": Error: Plugin dsh-git-worktree@0.9.3-local.2 is
incompatible with dsh 0.2.0-rc.2: peerDependencies {"@deepseek-ai/dsh-client-locale":"0.1.2-rc.1 || 0.1.7-rc.2 || 0.2.0-rc.1"}.
```

当前版本已升至 `0.10.0-local.1`（`package.json:3`）。

## 根因

宿主启动预检位于 DeepSeek Harness 仓库 `packages/boot/app-boot/src/plugin-compatibility.ts`（`evaluatePluginCompatibility`）：对清单里每个 `@deepseek-ai/dsh-*` peer 做 `semver.satisfies(runtimeVersion, range, { includePrerelease: true })`，不满足的汇总后拒载整包。该文件不在本插件仓库内。

- 精确钉版本 `0.2.0-rc.1` 不匹配 `0.2.0-rc.2`（semver 精确比较，rc 号差一即败）——本插件只有 `client-locale` 用了这种风格，是唯一失配点。
- 范围风格 `^0.2.0-rc.1` 对同元组预发布（`0.2.0-rc.2`）判定满足，所以其余 peer 全部无恙。
- 该文件 76 行还支持 `workspace:^|~|*` 协议，直接指代当前运行时版本。

## 当前 peerDependencies 状态（package.json:88-104）

共 14 个 peer（含 react）：

| peer | 范围风格 | 精确钉风格 |
|------|---------|-----------|
| `@deepseek-ai/cordis` | `^4.0.4` | — |
| `@deepseek-ai/cordis-plugin-loader` | `^1.0.3` | — |
| `@deepseek-ai/dsh-agent` | `^0.1.2-rc.1 \|\| ^0.2.0-rc.1` | — |
| `@deepseek-ai/dsh-client-locale` | — | `0.1.2-rc.1 \|\| 0.1.7-rc.2 \|\| 0.2.0-rc.1 \|\| 0.2.0-rc.2` |
| `@deepseek-ai/dsh-commands` | `^0.1.2-rc.1 \|\| ^0.2.0-rc.1` | — |
| `@deepseek-ai/dsh-fs` | `^0.1.2-rc.1 \|\| ^0.2.0-rc.1` | — |
| `@deepseek-ai/dsh-session` | `^0.1.2-rc.1 \|\| ^0.2.0-rc.1` | — |
| `@deepseek-ai/dsh-skill` | `^0.1.2-rc.1 \|\| ^0.2.0-rc.1` | — |
| `@deepseek-ai/dsh-skill-filesystem` | `^0.1.2-rc.1 \|\| ^0.2.0-rc.1` | — |
| `@deepseek-ai/dsh-subprocess` | `^0.1.2-rc.1 \|\| ^0.2.0-rc.1` | — |
| `@deepseek-ai/dsh-system-prompt` | `^0.1.2-rc.1 \|\| ^0.2.0-rc.1` | — |
| `@deepseek-ai/dsh-tools` | `^0.1.2-rc.1 \|\| ^0.2.0-rc.1` | — |
| `@deepseek-ai/dsh-typert-protocol` | `^0.1.2-rc.1 \|\| ^0.2.0-rc.1` | — |
| `@deepseek-ai/dsh-typert-registry` | `^0.1.2-rc.1 \|\| ^0.2.0-rc.1` | — |
| `react` | `^18.2.0` | — |

唯一精确钉风格的只有 `dsh-client-locale`（第92行），其余 13 个均为 `^` 范围风格或 react 的宽范围。

## 修复与验证

peer 范围追加 `|| 0.2.0-rc.2`（`package.json:92`，沿用文件既有精确钉风格）。验证方式：用宿主同款 semver 库与参数复刻预检循环跑实际 package.json，所有 peer 全 OK。

## 复发与对策

每次宿主 rc 升级都会再打掉精确钉 peer。三个选项：

1. 同步追加新 rc 到范围（本次做法，一行）。
2. 改用 `workspace:*` / `workspace:^`——加载器将其映射为当前运行时版本，本地适配版一劳永逸；代价是 pnpm publish 时会被改写为具体版本，对发布语义有影响（本地 fork 未发布，影响为零）。
3. 应急豁免：`dsh plugin allow-version dsh-git-worktree@<版本> on dsh <运行时版本>`，按精确「插件版本 + 运行时版本」对授权，明确接受风险，不推荐长期挂。
