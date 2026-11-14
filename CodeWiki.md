# CodeWiki

本仓库的活 wiki 由 dsh-codewiki 编译流水线自动维护（`codewiki_generate` 工具 / 编译面板）。

- 入口与全部文章位于仓库根 `E:\ik\Documents\trae_projects\1\dsh plugin\dsh-git-workspace\.codewiki`（在仓库根之外读写它们时一律用绝对路径）
- 索引 .codewiki/_index.md · 架构总览 .codewiki/_architecture.md · 模块文章 .codewiki/modules/ · 概念 .codewiki/concepts/
- 涉及代码改动的任务收尾必须运行 codewiki_generate（scope=auto）更新受影响文章；.codewiki/ 改动与代码一起提交

> 本文件由编译流水线在缺失时自动生成；若改写为人工速查手册，流水线不会覆盖。
