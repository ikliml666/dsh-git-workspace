---
title: 平台门控测试：win32 上跳过的 4 个用例均为有意设计
type: learning
source_files:
  - tests/git-unborn.test.ts
  - tests/project-skills.test.ts
  - tests/session-checkout-apply.test.ts
tags:
  - testing
  - windows
---

# 平台门控测试：win32 上跳过的 4 个用例均为有意设计

## 背景

2026-10-01 全量 vitest 报告「594 passed / 4 skipped」时，曾怀疑 4 个 skipped 是被遗忘的死测试。逐个排查结论：全部是 POSIX 语义平台门控，在 Windows 上跳过是正确行为，不应强行启用。

## 清单与理由

| 位置 | 用例 | 跳过条件 | 为什么不能在 win32 跑 |
| --- | --- | --- | --- |
| tests/git-unborn.test.ts:72 | newline 仓库路径回退单身份读取 | `skipIf(win32)` | 目录名含 `\n` 依赖 POSIX 文件系统语义，Win32 路径层行为不同且不可靠 |
| tests/project-skills.test.ts:88 | 保留可执行位并保护后续权限变更 | `skipIf(win32)` | 断言 chmod 0o755/0o644 的 exec-bit，NTFS 无此语义 |
| tests/session-checkout-apply.test.ts:1224 | Isolated 可执行位变更同步 Local | `win32 ? test.skip : test` | 依赖 `core.filemode=true` 与 chmod，Windows 上 git 恒视 filemode 为 false |
| tests/session-checkout-apply.test.ts:1240 | Isolated 新增 symlink 同步 Local | `win32 ? test.skip : test` | 需要符号链接权限/语义，Windows 上 `fs.symlink` 需特权或开发者模式 |

## 对策

- 修改这些用例前先确认平台语义，不要为了消灭 skipped 而删除或强行启用。
- 若未来新增依赖 POSIX 语义（exec-bit、symlink、换行路径、大小写敏感）的用例，沿用 `skipIf(process.platform === 'win32')` 惯例。
