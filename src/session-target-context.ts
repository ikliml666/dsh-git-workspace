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
