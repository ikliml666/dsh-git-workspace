---
title: "按分支创建只选基准提交，不adopt分支——交付目标始终跟随源会话分支"
type: decision
source_files:
  - "src/session-checkout-module.ts"
  - "src/session-checkout-apply.ts"
  - "src/console-host/control-plane.ts"
  - "src/console-contract.ts"
tags:
  - design
  - create
  - delivery
---

## 背景

借鉴 dsh-worktree-panel 的「为已有分支一键创建」时发现：该插件的 worktree 会 checkout 到分支上（adopt），删除/切换都围绕分支。而本插件的隔离 checkout 是 **detached** 设计（src/adapters/worktree-creation.ts:44 `worktree add --detach --no-checkout --lock`），且交付链路写的是**源会话当前检出的分支**——src/session-checkout-apply.ts:1943 `const branchRef = current.headRef`（要求 refs/heads/ 前缀，:1944），用 `update-ref <branchRef> <commitOid> <current.headOid>` 的 CAS 快进（:1980），索引替换同事务（:1982）。`record.sourceRef` 只进回执与展示投影，不参与交付写。

## 决定

- create 的 `branch` 参数（src/console-contract.ts WorktreeConsoleCreateRequest.branch）= **基准选择**：src/session-checkout-module.ts:4013-4019 用 `git.resolveLocalBranchTip` 取该分支当前 tip 作为 `record.baseOid` 并在其上 detached 创建 worktree。
- `binding.sourceRef`/`sourceOid` 仍记录源会话的分支与 HEAD（src/session-checkout-module.ts:4121-4120 区域）——交付目标语义完全不变。
- UI 措辞是「从分支创建」（以该分支当前指向为起点），不承诺工作会落到该分支。

## 否决的替代方案

- **让 worktree adopt 分支（checkout 到分支上）**：交付仍写源会话分支（apply.ts:1943），adopt 后 worktree HEAD 与交付目标脱节，用户预期「工作在分支 X 上落地」被静默打破；改交付目标为 record.sourceRef 则要动 CAS/回滚/索引替换事务（apply.ts:1943-2068），风险与收益不成比例。
- **创建时新建分支 ref**：detached 设计下没有任何东西指向它，交付也不使用它；纯粹的状态残留。
- **409「分支已被其他 worktree 检出」语义**：detached 创建不 checkout 分支，冲突在 detached 模型里不存在；不需要照搬。

## 后果

- 想把工作落到其他分支，仍须在源会话切换分支后创建/交付——这是生命周期安全性的代价，管理面板的敏捷性让位于交付确定性。
- 分支在创建后移动了也没关系：base 是提交而非引用，apply 的 applyBase/CAS 链路按提交工作。
