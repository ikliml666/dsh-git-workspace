# 上游问题：edit 工具改写行尾、写守卫误拦收尾路径

记录日期：2026-11-12
运行环境：DeepSeek Harness V0.2.2-rc.2（安装版 app.asar）
来源：使用者在一个三迭代 Worktree 流程中的实测；dsh-git-worktree 自身只注册 `worktree_*` 工具，
文件写入策略按设计归宿主（见 `src/adapters/git.ts:21-22`），因此这两项无法在本仓库修复。

## 1. `edit` 把整文件行尾从 LF 改成 CRLF

### 现象
- 一次小的 CSS 插入后，`git diff --stat` 把 `index.css`(1209 行)、`App.tsx`(418 行)、
  `BottomNav.tsx`(184 行) 全部判为改动，实际只改了几行。
- 用 node 正则删一行后，行尾混成 `\r` + 换行，只能 `git checkout` 重来。

### 影响
每轮改动都要额外做一次全文件 CRLF→LF 归一化再复查；模型为绕过假 diff 改用 `node fs`
直接写文件，绕过了工具审计。

### 期望
- `edit` 保持文件原有行尾；只有确实需要转换时才转换，并在结果中明说
  "已把 N 行转为 CRLF"，而不是静默。
- 同一文件混用行尾时，按文件中占多数的行尾写入新内容。

### 最小复现
1. 准备一个 LF 行尾、被 Git 跟踪的文件。
2. 用 `edit` 做一次单行替换。
3. `git diff --stat` 显示整文件改动；`git diff --ignore-cr-at-eol` 才只显示那一行。

## 2. 写守卫拦截 Local 的收尾写入

### 现象
- 交付后回到 Local 写 `changelogs/`（在 `.gitignore` 里），`edit`、`write`、`pwsh`、
  `ops_bash` 全部被"改动前先开主题分支"拒绝，最后只能靠 `node fs` 绕过。
- 反向误判：目标是 Worktree，但因为命令字符串里带了主仓库前缀，被判"写入目标在
  Original Local boundary 内"。

### 期望
- 分支守卫放行 gitignored 路径与 `.agents/` 下的清理操作：交付后写 changelog、清理残留目录
  都属于正常收尾。
- 写保护的路径判定使用规范化后的真实目标路径，而不是命令字符串里的子串匹配。

### 说明
插件侧已把"Ordinary Local work is allowed again"这类承诺改掉，不再宣称宿主一定放行
（`src/session-checkout-module.ts` 的 runtime context 文案）；拦截本身仍需宿主修复。
