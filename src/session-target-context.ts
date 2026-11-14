/** Dynamic replay-stable model context for the current Worktree Session Target. */

import type { Context } from '@deepseek-ai/cordis'
import '@deepseek-ai/dsh-system-prompt'
import type { SessionCheckoutModule } from './index.js'
import { createSessionWorkingDirectoryPort } from './adapters/working-directory.js'
import { languageForInvocation, withHostLanguage } from './i18n/host.js'

interface ContextAgent {
  session?: { id?: unknown }
}

/** Register a per-assembly snapshot without performing Git or filesystem I/O. */
export function registerSessionTargetContext(ctx: Context, module: SessionCheckoutModule): void {
  // The snapshot needs the live cwd to tell whether this Session already stands
  // inside its checkout (worktree_create moved it) or still sits in Local.
  const workingDirectory = createSessionWorkingDirectoryPort(ctx)
  // Sessions are announced before their first assembly, so warming the branch
  // probe here makes the contention notice complete on the very first turn
  // instead of appearing one turn later.
  ctx.on('session/created', (session: { id?: unknown }) => {
    const sessionId = session.id
    if (typeof sessionId !== 'string') return
    module.warmContentionForSession?.(sessionId)
  })
  ctx.inject(['systemPrompt'], (scope: Context) => {
    scope.systemPrompt.context({
      name: 'git-worktree:session-target',
      order: 118,
      text: (context) => {
        const sessionId = (context.agent as ContextAgent | undefined)?.session?.id
        if (typeof sessionId !== 'string') return ''
        const cwd = workingDirectory.current(context.agent)
        return withHostLanguage(languageForInvocation(context.agent, scope), () => [
          // Contention first: when another Session already shares this Local
          // checkout, that fact must be read before the ordinary target rules.
          module.workspaceContention(sessionId, cwd),
          module.runtimeContext(sessionId, cwd),
        ].filter((part) => part.length > 0).join('\n\n'))
      },
    })
  })
}

/**
 * 会话走进树时把这棵树接进台账。
 *
 * 官方 `worktrees.create` 的最后一步是 `workingDirectory.set`，所以
 * `working-directory/change` 是「树建好了、且是某个会话的落脚点」的唯一信号：
 * 官方 `create_worktree` 与 forge 面板都走这条路，比轮询 `git worktree list`
 * 及时，也不需要为每个项目起子进程。
 */
export function registerOfficialWorktreeAdoption(ctx: Context, module: SessionCheckoutModule): void {
  ctx.on('session/event', (session: { id?: unknown }, event: { type?: unknown; data?: unknown }) => {
    if (event.type !== 'working-directory/change') return
    const sessionId = session.id
    const cwd = (event.data as { cwd?: unknown } | undefined)?.cwd
    if (typeof sessionId !== 'string' || typeof cwd !== 'string') return
    // 事件 feed 不等待监听者：登记要读 Git 与写台账，只能异步做。未捕获的
    // rejection 会逃出这个 fire-and-forget 调用，所以这里必须接住。
    void module.adoptOfficialWorktree(sessionId, cwd).catch(error => {
      // 接管失败必须让用户看见：那棵树没进台账，列表、交付、清理就都找不到它。
      // 胶囊每 5 秒轮询一次，把原因挂到会话上比 console.warn 有用得多。
      appendAdoptionFailure(module, sessionId, error)
    })
  })
}

/**
 * 把一次接管失败写进会话日志，胶囊下一次 current 时读到并显示。
 *
 * 只用 module 已有的入口落盘：`adoptOfficialWorktree` 的失败在这里无法复现
 * 结构化错误码，所以留一句人能读的原文。
 */
function appendAdoptionFailure(
  module: SessionCheckoutModule,
  sessionId: string,
  error: unknown,
): void {
  const reason = error instanceof Error ? error.message : String(error)
  console.warn('[dsh-git-workspace] could not adopt the official Worktree:', error)
  module.recordAdoptionFailure(sessionId, reason)
}
