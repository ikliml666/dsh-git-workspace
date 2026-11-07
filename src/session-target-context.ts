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
  ctx.inject(['systemPrompt'], (scope: Context) => {
    scope.systemPrompt.context({
      name: 'git-worktree:session-target',
      order: 118,
      text: (context) => {
        const sessionId = (context.agent as ContextAgent | undefined)?.session?.id
        return withHostLanguage(languageForInvocation(context.agent, scope), () => (
          typeof sessionId === 'string'
            ? module.runtimeContext(sessionId, workingDirectory.current(context.agent))
            : ''
        ))
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
    // rejection 会逃出这个 fire-and-forget 调用，所以这里必须接住并记录。
    void module.adoptOfficialWorktree(sessionId, cwd).catch(error => {
      console.warn('[dsh-git-worktree] could not adopt the official Worktree:', error)
    })
  })
}
