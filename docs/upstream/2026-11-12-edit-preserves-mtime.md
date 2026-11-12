# 上游问题：ops_edit_file 保留 mtime、改写行尾

记录日期：2026-11-12
运行环境：DeepSeek Harness V0.2.2-rc.2（安装版 app.asar），Windows 11
来源：给本插件升级版本号时的实测；`ops_edit_file` 是宿主的文件编辑工具，本仓库无法修复。

## 一、写回内容但不更新 mtime

### 现象

`ops_edit_file` 写回文件内容后，**不更新文件的 mtime**。工具说明里也写着
"Windows preserves available owner/group/ordered DACL and basic attributes/timestamps"，
看起来是刻意的元数据保留。

问题在于 git 的 stat 缓存：当文件大小与 mtime 都没变时，`git status` / `git diff` /
`git add` 都认为文件未修改。等长替换（`0.14.0` → `0.15.0`）正好满足这个条件。

### 最小复现

1. 创建一个文件，内容 `AAAA\n`（5 字节）。
2. 等 1.5 秒，记录 `stat -c '%y %s'`。
3. 用 `ops_edit_file` 把 `AAAA` 换成 `BBBB`（同样 5 字节）。
4. 再 `stat`：mtime 与编辑前逐纳秒相同，内容已经是 `BBBB`。

实测输出：

```
before: 2026-11-12 20:29:31.343865100 +0800 5
after:  2026-11-12 20:29:31.343865100 +0800 5
BBBB
```

### 影响

- `git status` 显示干净，`git add <file>` 无效果，提交里静默缺少该文件。
- 本次实际踩到：`package.json` 的 `0.14.0` → `0.15.0` 被漏提交，直到
  `git show HEAD:package.json` 才发现 HEAD 里还是旧版本。
- 同类问题也会影响 make / turbo / ninja 这类按 mtime 判断是否重建的工具。

### 期望

- 内容变化时更新 mtime（默认行为），把"保留时间戳"变成显式选项。
- 或至少在写入后把 mtime 设为当前时间，同时保留其余元数据（ACL、属主、属性）。

## 二、把整文件行尾从 LF 改成 CRLF

### 现象

同一轮里，`ops_edit_file` 把 `scripts/check-publish.mjs`（原本 LF）整文件转成了 CRLF：
`git diff` 显示 256 行全部改动（512 行变更），实际只改了一行方法表。用 Node 逐字节还原成
LF 后，diff 才收缩为 1 行。

### 影响

- 每一轮编辑都产生假 diff，必须额外做一次全文件行尾归一化再复查。
- 假 diff 会掩盖真实改动，也让 review 与提交信息失真。
- 本仓库的源文件全部是 LF（`file` 检查无 CRLF），转换是工具引入的。

### 期望

- 保持文件原有行尾；确实需要转换时在结果里明说"已把 N 行转为 CRLF"，不要静默。
- 同一文件混用行尾时，按文件中占多数的行尾写入新内容。

## 当前规避

- 等长编辑后 `touch <file>`，让 git 的 stat 缓存失效。
- 编辑后用 `file` 或 `grep -c $'\r'` 检查行尾，必要时用 Node 还原为 LF。
