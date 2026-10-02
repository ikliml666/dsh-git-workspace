import { readClientLanguage } from '../i18n.js'
import { createTranslator } from '../../i18n/core.js'
import { transportMessages } from '../../i18n/transport-messages.js'
import type { Context } from '@deepseek-ai/cordis'
import type { ClientRemote } from '@deepseek-ai/dsh-api-gateway/client'
import type { WorktreeClientBootReport, WorktreeConsoleAdapter } from '../../console-contract.js'
import contribution, { type GitWorktreeRemote } from '../../console-remote/remote.js'
import { apply as applyToolViews, inject as toolViewInject } from '../index.js'
import { registerDecoratedWorkspaceSidebar, registerManagedWorkspaceSidebar } from '../workspace-sidebar/index.js'
import { mountSettingsCard } from '../settings-card/index.js'
import { apply as applyOfficialWorkspace, inject as officialWorkspaceInject } from 'virtual:dsh-official-workspace-client'
import { apply as applyNextWorkspace, inject as nextWorkspaceInject } from 'virtual:dsh-official-workspace-client-next'
import { apply as applyAlphaWorkspace, inject as alphaWorkspaceInject } from 'virtual:dsh-official-workspace-client-alpha'
import { createWorktreeConsoleRemoteAdapter } from './adapter.js'

export { createWorktreeConsoleRemoteAdapter } from './adapter.js'

/**
 * Activate on nearly the same prerequisites as the official Workspace Client.
 * The conversation-dependent Worktree surfaces run in a child fiber below so
 * the Workspace service can break the uiConversation -> uiWorkspace boot edge.
 *
 * The modern (0.2.x) official Browser additionally injects
 * `remote.directoryPicker`, whose provider entry waits for `uiWorkspace`
 * itself. Requiring it here would deadlock the web boot: this entry could not
 * provide `uiWorkspace` before the picker activates, and the picker would wait
 * for `uiWorkspace` forever. The picker is therefore resolved lazily at call
 * time through the managed context proxy (see officialContextProxy).
 */
export const inject = officialWorkspaceInject.filter(service => service !== 'remote.directoryPicker')

interface ConsoleClientContext extends Context {
  remote: ClientRemote & { gitWorktree: GitWorktreeRemote }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    worktreeConsole: WorktreeConsoleAdapter
  }
}

/** Mount the package-owned strict Remote contribution in this Client fiber. */
export async function apply(ctx: ConsoleClientContext): Promise<void> {
  const bootStartedAt = Date.now()
  const disposeRemote = await ctx.remote.$mount(contribution)
  const elapsedMountMs = Date.now() - bootStartedAt
  ctx.effect(() => disposeRemote)
  const remote = ctx.get('remote.gitWorktree') as GitWorktreeRemote | undefined
  const getLanguage = () => readClientLanguage(ctx.get('locale'))
  if (remote === undefined) throw new Error(createTranslator(transportMessages, getLanguage())('mountFailed'))
  const adapter = createWorktreeConsoleRemoteAdapter(remote, getLanguage)
  ctx.provide('worktreeConsole', adapter)
  mountSettingsCard(ctx as unknown as Parameters<typeof mountSettingsCard>[0])

  const mountTools = (workspaceCtx: Context): void => {
    // Conversation-dependent views are below their UI Workspace provider;
    // a sibling fiber could not safely assume the navigation service exists.
    workspaceCtx.inject(toolViewInject, child => {
      applyToolViews(child as unknown as Parameters<typeof applyToolViews>[0], adapter)
    })
  }

  // All three official Browser generations declare the same top-level Slot.
  // Pick exactly one based on the Host-resolved package version, not timing of
  // Client services (shortcuts is absent in alpha and late to start in rc.2).
  const reportBoot = (branch: WorktreeClientBootReport['branch'], registered: boolean, detail?: string): void => {
    try {
      // The Remote proxy enforces descriptor arity positionally: the trailing
      // locale must be passed even when undefined. Diagnostics are best effort
      // and must never break the boot path.
      void remote.clientBootReport({
        flavor: topology.ok ? String(topology.value.workspaceClientFlavor ?? 'missing') : 'unknown',
        branch, registered, ...(detail === undefined ? {} : { detail }),
        elapsedMountMs, elapsedTopologyMs,
      }, undefined).catch(() => { /* best effort */ })
    } catch { /* best effort */ }
  }
  const topologyStartedAt = Date.now()
  const topology = await adapter.sidebarTopology()
  const elapsedTopologyMs = Date.now() - topologyStartedAt
  if (!topology.ok) {
    reportBoot('topology-failed', false, `${topology.error.code}: ${topology.error.message}`)
    throw new Error(createTranslator(transportMessages, getLanguage())('workspaceGenerationUnknown'))
  }
  const flavor = topology.value.workspaceClientFlavor
  if (flavor === 'legacy') {
    const sessions = ctx.get('sessions') as { open?: unknown } | undefined
    if (typeof sessions?.open !== 'function') {
      reportBoot('legacy', false, 'sessions.open() unavailable')
      throw new Error('Legacy Workspace Browser requires sessions.open().')
    }
    registerManagedWorkspaceSidebar(
      ctx as unknown as Parameters<typeof registerManagedWorkspaceSidebar>[0], adapter,
    )
    mountTools(ctx)
  } else if (flavor === 'modern') {
    // Same filtered subset as the entry inject: providing `uiWorkspace` must
    // never wait for the directory picker (see the inject comment above).
    // Local adaptation mirrors alpha/next: with the official Workspace kept
    // live (takeover disabled), decorate instead of re-providing uiWorkspace.
    if (topology.value.officialWorkspaceActive === true) {
      reportBoot('modern', false, 'decorate-pending')
      ctx.inject(inject, child => {
        try {
          registerDecoratedWorkspaceSidebar(
            child as unknown as Parameters<typeof registerDecoratedWorkspaceSidebar>[0],
            adapter,
          )
          mountTools(child)
          reportBoot('modern', true)
        } catch (error) {
          reportBoot('modern', false, error instanceof Error ? error.message : String(error))
          throw error
        }
      })
    } else {
      reportBoot('modern', false, 'inject-pending')
      ctx.inject(inject, child => {
        try {
          registerManagedWorkspaceSidebar(
            child as unknown as Parameters<typeof registerManagedWorkspaceSidebar>[0],
            adapter,
            applyOfficialWorkspace,
          )
          mountTools(child)
          reportBoot('modern', true)
        } catch (error) {
          reportBoot('modern', false, error instanceof Error ? error.message : String(error))
          throw error
        }
      })
    }
  } else if (flavor === 'alpha' || flavor === 'next') {
    const [required, applyWorkspace] = flavor === 'alpha'
      ? [alphaWorkspaceInject, applyAlphaWorkspace] as const
      : [nextWorkspaceInject, applyNextWorkspace] as const
    if (topology.value.officialWorkspaceActive === true) {
      // The Host kept the official Workspace Client live (takeover disabled):
      // replaying the module apply would re-provide uiWorkspace and crash.
      // Decorate the running registration instead.
      reportBoot(flavor, false, 'decorate-pending')
      ctx.inject(required, child => {
        try {
          registerDecoratedWorkspaceSidebar(
            child as unknown as Parameters<typeof registerDecoratedWorkspaceSidebar>[0],
            adapter,
          )
          mountTools(child)
          reportBoot(flavor, true)
        } catch (error) {
          reportBoot(flavor, false, error instanceof Error ? error.message : String(error))
          throw error
        }
      })
    } else {
      reportBoot(flavor, false, 'inject-pending')
      ctx.inject(required, child => {
        try {
          registerManagedWorkspaceSidebar(
            child as unknown as Parameters<typeof registerManagedWorkspaceSidebar>[0],
            adapter,
            applyWorkspace,
          )
          mountTools(child)
          reportBoot(flavor, true)
        } catch (error) {
          reportBoot(flavor, false, error instanceof Error ? error.message : String(error))
          throw error
        }
      })
    }
  } else {
    // Host lifecycle leaves the official provider enabled in this case.
    reportBoot('unsupported', false)
    mountTools(ctx)
  }
}
