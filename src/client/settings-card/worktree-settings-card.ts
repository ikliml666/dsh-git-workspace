import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  SettingsFormModel,
  settingsBooleanField,
  settingsNumberField,
  settingsTextField,
  type SettingsFieldState,
  type SettingsFormActions,
  type SettingsFormScope,
  type SettingsFormShell,
} from './form-model.js'

/** Loader entry id of this plugin; the Host keys configuration forms by it. */
export const WORKTREE_SETTINGS_NS = 'dsh-git-worktree'

/** The volatile section of this plugin's Config schema the card edits. */
export interface WorktreeSettings {
  autoDeliver?: boolean
  autoPush?: boolean
  worktreesRoot?: string
  gitTimeoutMs?: number
  worktreeAddTimeoutMs?: number
}

/** Card state: the shared form shell plus one entry per edited field. */
export interface WorktreeSettingsCardState extends SettingsFormShell {
  autoDeliver: SettingsFieldState
  autoPush: SettingsFieldState
  worktreesRoot: SettingsFieldState
  gitTimeoutMs: SettingsFieldState
  worktreeAddTimeoutMs: SettingsFieldState
}

/** The face the slot entry injects into the card component. */
export interface WorktreeSettingsCardFace extends SettingsFormActions {
  hooks: { worktreeCard: SnapshotStore<WorktreeSettingsCardState> }
}

export class WorktreeSettingsCardController {
  private readonly form: SettingsFormModel<WorktreeSettings>
  private readonly store: SnapshotStore<WorktreeSettingsCardState>

  constructor(scope: SettingsFormScope<WorktreeSettings>) {
    this.form = new SettingsFormModel(scope, [
      settingsBooleanField('autoDeliver'),
      settingsBooleanField('autoPush'),
      settingsTextField('worktreesRoot'),
      settingsNumberField('gitTimeoutMs'),
      settingsNumberField('worktreeAddTimeoutMs'),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): WorktreeSettingsCardState {
    return {
      ...this.form.shell(),
      autoDeliver: this.form.field('autoDeliver'),
      autoPush: this.form.field('autoPush'),
      worktreesRoot: this.form.field('worktreesRoot'),
      gitTimeoutMs: this.form.field('gitTimeoutMs'),
      worktreeAddTimeoutMs: this.form.field('worktreeAddTimeoutMs'),
    }
  }

  inject(): WorktreeSettingsCardFace {
    return { hooks: { worktreeCard: this.store }, ...this.form.actions() }
  }

  dispose(): void { this.form.dispose() }
}
