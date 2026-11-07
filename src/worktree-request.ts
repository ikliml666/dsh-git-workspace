/**
 * 「发首条消息时建树」的待办请求。
 *
 * 官方 forge 面板把这条语义拆在两处：面板写一条 plugin record 记下请求，
 * 客户端在 `agent/pre-step` 的第 1 步把它变成真正的 worktree。本模块把同一
 * 件事收进 Host 侧，因为建树要走本插件的 createOfficialTarget —— 它负责
 * `feat/sess-*` 命名、`.worktreeinclude` 与本地未提交修改继承。
 *
 * 请求落在 session log 里（plugin record），不是内存状态：刷新页面、重启
 * Host 之后仍然有效，正是「勾了但还没发消息」跨进程必须成立的那部分。
 */

import { appendPluginRecord, pluginRecordOf } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionCheckoutModule } from './index.js'
import { createSessionWorkingDirectoryPort } from './adapters/working-directory.js'

/** Plugin record type：记录本会话「下一次 turn 要在新树里开始」。 */
export const WORKTREE_REQUEST_RECORD = 'plugin:dsh-git-worktree/worktree-request'

declare module '@deepseek-ai/dsh-session/types' {
  interface PluginRecordMap {
    /** 一次「下一次 turn 在新树里开始」的请求，或对它的撤回。 */
    'plugin:dsh-git-worktree/worktree-request': RequestRecord
  }
}

/** 一个待建请求：基点分支（null 表示当前 HEAD）与上次失败的原因。 */
export interface WorktreeRequest {
  readonly from: string | null
  /**
   * 上一次建树失败的说明；null 表示还没失败过。
   *
   * 失败发生在 `agent/pre-step`，客户端不在那条链路上，只能靠这条记录把原因
   * 带回界面——否则用户看到的只是「发了消息却没动静」。
   */
  readonly failure: string | null
}

interface RequestRecord {
  readonly action: 'request' | 'cancel' | 'failed'
  readonly from?: string | null
  readonly reason?: string
}

function isRequestRecord(value: unknown): value is RequestRecord {
  if (value === null || typeof value !== 'object') return false
  const record = value as { action?: unknown; from?: unknown; reason?: unknown }
  if (record.action !== 'request' && record.action !== 'cancel' && record.action !== 'failed') return false
  const fromValid = record.from === undefined || record.from === null || typeof record.from === 'string'
  const reasonValid = record.reason === undefined || typeof record.reason === 'string'
  return fromValid && reasonValid
}

/**
 * 从 session log 折叠出当前待办请求。
 * @param session - 目标会话。
 * @returns 仍在等待的请求，或 null。
 */
export function pendingWorktreeRequest(session: Session): WorktreeRequest | null {
  let pending: WorktreeRequest | null = null
  for (const event of session.snapshotEvents()) {
    const record = pluginRecordOf(event)
    if (record === undefined || record.type !== WORKTREE_REQUEST_RECORD) continue
    if (!isRequestRecord(record.data)) continue
    if (record.data.action === 'cancel') {
      pending = null
      continue
    }
    if (record.data.action === 'failed') {
      // 失败不撤销请求：用户修好原因后重发即会重试。只把原因挂上去。
      if (pending !== null) pending = { from: pending.from, failure: record.data.reason ?? 'unknown' }
      continue
    }
    pending = { from: record.data.from ?? null, failure: null }
  }
  return pending
}

/**
 * 记下「下一次 turn 在新树里开始」。
 * @param session - 目标会话。
 * @param from - 基点分支，null 表示当前 HEAD。
 */
export function requestWorktree(session: Session, from: string | null): void {
  appendPluginRecord(session, WORKTREE_REQUEST_RECORD, { action: 'request', from })
}

/**
 * 撤回待办请求。
 * @param session - 目标会话。
 */
export function cancelWorktreeRequest(session: Session): void {
  appendPluginRecord(session, WORKTREE_REQUEST_RECORD, { action: 'cancel' })
}

/**
 * 记下这次建树失败的原因，请求本身保留。
 * @param session - 目标会话。
 * @param reason - 给用户看的失败说明。
 */
export function failWorktreeRequest(session: Session, reason: string): void {
  appendPluginRecord(session, WORKTREE_REQUEST_RECORD, { action: 'failed', reason })
}

/**
 * 记录或撤回「下一次 turn 在新树里开始」。
 *
 * 这是 Host 侧的写入口：客户端只表达意图，请求进 session log 之后就由
 * `mountWorktreeRequest` 在第 1 步兑现。
 *
 * @param ctx - Host 插件上下文。
 * @param sessionId - 目标会话。
 * @param from - 基点分支；`null` 表示当前 HEAD；传 `undefined` 表示撤回。
 * @returns 写入后的待办请求。
 * @throws 会话不在存储里时（已关闭 / 从未创建）。
 */
export function setWorktreeRequest(
  ctx: Context,
  sessionId: string,
  from: string | null | undefined,
): WorktreeRequest | null {
  const sessions: unknown = ctx.get('sessions')
  const session: Session | undefined = (sessions as { get?(id: string): Session | undefined } | undefined)?.get?.(sessionId)
  if (session === undefined) {
    throw new Error(`Session ${sessionId} is not live, so its worktree request cannot be recorded.`)
  }
  if (from === undefined) cancelWorktreeRequest(session)
  else requestWorktree(session, from)
  return pendingWorktreeRequest(session)
}

/**
 * 从活会话读待办请求，供 `current` 回给胶囊。
 * @param ctx - Host 插件上下文。
 * @param sessionId - 目标会话。
 * @returns 仍在等待的请求，或 null（会话不活时也没有待办）。
 */
export function liveWorktreeRequest(ctx: Context, sessionId: string): WorktreeRequest | null {
  const sessions = ctx.get('sessions') as { get?: (id: string) => Session | undefined } | undefined
  const session = sessions?.get?.(sessionId)
  return session === undefined ? null : pendingWorktreeRequest(session)
}

/**
 * 在下一个 step 边界之前把待办请求变成真实的 worktree。
 *
 * 建树发生在 `agent/pre-step` 而不是 UI 点击时：官方 worktrees.create 要写
 * `.agents/worktrees/` 并做一次 `reset --hard`，勾选即建等于为用户没打算发的
 * 消息付一次完整 checkout 的代价；放在 pre-step 又比挂住 inbox 简单，消息在
 * 树上就绪后照常进入这一步。
 *
 * 不限定 `step === 1`：turn 正在跑时排队，那条消息会作为 steering 进入**当前
 * turn 的后续 step**（`inbox.claim` 对其他 target 把它放进 `next-step`）。
 * 只认第 1 步就永远等不到它，请求会一直挂着、消息照常在旧目录里跑——这正是
 * 真机上观察到的现象。
 *
 * @param ctx - Host 插件上下文。
 * @param module - Worktree 领域模块。
 */
export function mountWorktreeRequest(ctx: Context, module: SessionCheckoutModule): void {
  const workingDirectory = createSessionWorkingDirectoryPort(ctx)
  ctx.on('agent/pre-step', async (payload, next) => {
    const { agent, messages } = payload
    const session = agent.session
    const pending = pendingWorktreeRequest(session)
    if (pending === null) return next()
    // 请求过期（会话已经不是 Local）时只清掉标记，不建第二棵树。
    // 读不出目标不算「过期」：还没绑定的会话根本没有 Session Target，inspect
    // 会抛 target_unselected——而那正是最需要建树的场景。所以只认读得出的
    // isolated；读不出来就继续往下建，失败由下面的 catch 兜住。
    const isolated = await module.inspect(session.id).then(
      current => current.checkout.kind === 'isolated',
      () => false,
    )
    if (isolated) {
      cancelWorktreeRequest(session)
      return next()
    }
    let managedRoot: string
    try {
      const launch = await module.createOfficialTarget(
        agent,
        pending.from === null ? {} : { branch: pending.from },
      )
      managedRoot = launch.managedRoot
    } catch (error) {
      // inbox.claim() 已经把这批消息移出队列，这里是它们唯一的归途：不还回去
      // 就等于用户的消息凭空消失。请求也留着，改好原因后重发即会重试。
      for (const message of [...messages].reverse()) agent.inbox.prepend('next-turn', message)
      // pre-step 之后没有第二次机会跟用户说话：原因必须落进 session log，胶囊
      // 下一次轮询 current 时才读得到。只写 console 等于用户永远看不见。
      failWorktreeRequest(session, error instanceof Error ? error.message : String(error))
      console.warn('[dsh-git-worktree] could not create the queued Worktree:', error)
      return { kind: 'reject' }
    }
    cancelWorktreeRequest(session)
    const cwd = await workingDirectory.enter(agent, managedRoot)
    if (cwd === undefined) {
      console.warn('[dsh-git-worktree] created the Worktree but this host has no workingDirectory service')
    }
    return next()
  })
}
