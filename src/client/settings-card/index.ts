/**
 * Mounts the Worktree settings page into the Host's Plugins page: the card
 * edits the `dsh-git-worktree` namespace through the shared configuration
 * forms service and registers into the `plugins.item` slot while the Host
 * serves that namespace. Every service is probed fail-soft — a Host without
 * the settings stack simply gets no page.
 */

import type { Context } from '@deepseek-ai/cordis'
import { translatorForServices } from '../i18n.js'
import { WorktreeSettingsCard } from './WorktreeSettingsCard.js'
import type { SettingsFormScope } from './form-model.js'
import { WORKTREE_SETTINGS_NS, WorktreeSettingsCardController, type WorktreeSettings } from './worktree-settings-card.js'

export { WORKTREE_SETTINGS_NS, WorktreeSettingsCardController } from './worktree-settings-card.js'
export type { WorktreeSettings, WorktreeSettingsCardFace, WorktreeSettingsCardState } from './worktree-settings-card.js'

/** What the card needs of the Host's shared configuration-form service. */
interface ConfigFormsService {
  get<T>(ns: string): SettingsFormScope<T>
  whileServed(namespaces: readonly string[], callback: (served: Set<string>) => (() => void) | void): () => void
}

/** What the card needs of the Host's Plugins page slot. */
interface SlotsService {
  inject(slot: string, register: () => () => void): () => void
  register(options: Record<string, unknown>, component: unknown): () => void
}

/**
 * Mount the settings page. A no-op when the Host does not expose the
 * configuration-form or slot services this page collaborates with.
 * @param ctx - the client plugin context.
 */
export function mountSettingsCard(ctx: Context): void {
  // Cordis throws "cannot get property without inject" when a plugin fiber
  // reads an undeclared service through the property getter; ctx.get() is the
  // fail-soft read (the same pattern host-compat uses for optional services).
  const configForms = ctx.get('configForms') as ConfigFormsService | undefined
  const slots = ctx.get('slots') as SlotsService | undefined
  if (configForms === undefined || slots === undefined) return

  let controller: WorktreeSettingsCardController | undefined
  ctx.effect(() => {
    controller = new WorktreeSettingsCardController(configForms.get<WorktreeSettings>(WORKTREE_SETTINGS_NS))
    return () => { controller?.dispose(); controller = undefined }
  }, 'dsh-git-worktree: settings form subscription')
  ctx.effect(() => configForms.whileServed([WORKTREE_SETTINGS_NS], () => slots.inject('plugins.item', () => slots.register({
    name: 'plugins.item',
    id: 'dsh-git-worktree',
    order: 40,
    label: () => translatorForServices({ locale: ctx.get('locale') })('settings.title'),
    inject: () => controller?.inject(),
  }, WorktreeSettingsCard))), 'dsh-git-worktree: settings page')
}
