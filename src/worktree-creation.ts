/**
 * 「新建工作树」的即时建树入口。
 *
 * 早先的版本把这里做成排队：客户端只写一条 plugin record，真正的 `git worktree
 * add` 留到 `agent/pre-step` 兑现。那是照抄官方 forge 面板的设计，理由是「不要为
 * 用户还没打算发的消息付一次 checkout 的代价」。实际用起来是多余的：想建树的人
 * 点完就在等着，还要再发一条消息才算数，中间那一步只制造困惑。现在点了就建。
 *
 * 建树仍然走本插件的 `createOfficialTarget` —— 它负责 `feat/sess-*` 命名、
 * `.worktreeinclude` 与本地未提交修改继承，这些官方 `worktrees.create` 不做。
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import type { IsolatedTargetLaunch, SessionCheckoutModule } from './index.js'

/** `createWorktreeNow` 的结果：建好的树，或失败原因。 */
export type WorktreeCreationResult =
  | { readonly ok: true; readonly launch: IsolatedTargetLaunch }
  | { readonly ok: false; readonly message: string }

/**
 * 立刻为本会话建一棵工作树。
 *
 * 没有排队、没有待办记录：调用即在 `withBindingLock` 内跑完整的建树流程，返回
 * 时树已经在磁盘上、台账已经登记、会话 cwd 已经切过去。
 *
 * @param ctx - Host 插件上下文。
 * @param module - Worktree 领域模块。
 * @param sessionId - 目标会话。
 * @param from - 基点分支；`null` 表示当前 HEAD。
 * @returns 建好的树，或失败原因。
 */
export async function createWorktreeNow(
  ctx: Context,
  module: SessionCheckoutModule,
  sessionId: string,
  from: string | null,
): Promise<WorktreeCreationResult> {
  const agents = ctx.get('agents') as { get?: (id: string) => Agent | undefined } | undefined
  const agent = agents?.get?.(sessionId)
  if (agent === undefined) {
    return { ok: false, message: `Session ${sessionId} is not live, so no Worktree can be created for it.` }
  }
  try {
    // createOfficialTarget 内部调官方 worktrees.create，后者的最后一步就是
    // ctx.workingDirectory.set(agent, path)——这里不需要再切一次目录。
    const launch = await module.createOfficialTarget(agent, from === null ? {} : { branch: from })
    return { ok: true, launch }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}
