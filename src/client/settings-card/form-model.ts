/**
 * The staged form model behind a plugin's settings page.
 *
 * Trimmed from the harness `@deepseek-ai/dsh-client-ui-primitives`
 * settings-form model (0.1.7-rc.2): the version installed with this plugin
 * predates that module, and the client bundle must stay self-contained. The
 * write-only secret controls are dropped; this card edits visible fields only.
 *
 * A card stages what the user types and writes it only when they save. Each
 * settings write is a durable, revision-fenced document mutation, so a control
 * that committed as it settled turned one edit into a write the user never
 * asked for and could not preview; staged text makes what is on screen exactly
 * what a save would store.
 *
 * A field shows its effective value — the user layer over the composition
 * layer over the schema default — and whether the user layer carries it. That
 * presence, not a value comparison, is what marks a field overridden: an
 * override equal to the composition default is still an override.
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

/** What the model reads of one Host entry's form. */
export interface SettingsFormScopeSnapshot<T> {
  /** `ready` while the Host serves the entry to this client; the form renders nothing otherwise. */
  status: 'loading' | 'ready' | 'unavailable'
  /** Last accepted schema-resolved section; undefined before the first acceptance. */
  value: T | undefined
  /** Composition layer the value resolves over: what a field reverts to once cleared. */
  base: unknown
  /** Raw user layer as stored; a field's PRESENCE here is what marks it overridden. */
  user: unknown
  /** Whether the Host document accepts writes. */
  writable: boolean
  /** Revision the snapshot was read at; a save fences its mutation with the revision its drafts started from. */
  revision: number | undefined
}

/** One path edit a save sends, as the shared configuration form's `mutate` accepts it. */
export type SettingsFormPathOp =
  | { op: 'set'; path: readonly string[]; value: unknown }
  | { op: 'unset'; path: readonly string[] }

/** The entry form the model stages over: the reads and the atomic write of the form `ui-settings` shares per Host entry. */
export interface SettingsFormScope<T> {
  getSnapshot(): SettingsFormScopeSnapshot<T>
  subscribe(listener: () => void): () => void
  mutate(ops: readonly SettingsFormPathOp[], expectedRevision?: number): Promise<boolean>
}

/** The write one field's staged text performs when the card is saved. */
export type SettingsFieldWrite =
  | { kind: 'set'; value: unknown }
  | { kind: 'clear' }

/** How one section field converts between its stored value and its draft text. */
export interface SettingsFieldSpec {
  /** Field name inside the namespace section. */
  field: string
  /** Render a stored value as draft text; the empty string when the section carries none. */
  format: (value: unknown) => string
  /**
   * The write this draft text stages, or undefined when the text is not a
   * value this field accepts — which blocks the save rather than discarding it.
   */
  parse: (text: string) => SettingsFieldWrite | undefined
}

/** One field as a card's control renders it. */
export interface SettingsFieldState {
  /** Draft text the control renders. */
  text: string
  /** Whether saving would leave a user-layer entry for this field. */
  overridden: boolean
  /** Whether the draft is not a value this field accepts, which blocks saving. */
  invalid: boolean
}

/** Form state every plugin card shares. */
export interface SettingsFormShell {
  /** False while the namespace is not served to this client; the card renders nothing. */
  available: boolean
  /** Whether the Host document accepts writes. */
  writable: boolean
  /** Whether the form holds edits that a save would write. */
  dirty: boolean
  /** Whether any staged draft is invalid, which blocks the save. */
  invalid: boolean
  /** Whether a save is crossing the wire. */
  saving: boolean
  /** Whether the last save did not land as staged; cleared by the next edit or save. */
  failed: boolean
}

/** The write actions every plugin card's slot entry injects. */
export interface SettingsFormActions {
  /** Stage draft text for one field. */
  edit: (field: string, text: string) => void
  /** Stage a clear, so saving lets the field re-inherit the composition layer. */
  resetField: (field: string) => void
  /** Write every staged edit, then re-seed from what the Host accepted. */
  save: () => void
  /** Drop every staged edit. */
  discard: () => void
}

/** One staged edit. */
interface StagedEdit {
  /** Draft text the control renders. */
  text: string
  /** True when this edit clears the field whatever text it shows. */
  clear: boolean
}

/** One staged edit resolved into the write a save performs. */
interface PlannedWrite {
  /** Field this entry writes. */
  field: string
  /** The document edit; undefined when the draft is not a value the field accepts. */
  op?: SettingsFormPathOp
}

/**
 * A boolean field staged as its literal draft text: `'true'` or `'false'`.
 * Any other draft blocks the save, and an empty draft clears the field.
 * @param field - field name inside the namespace section.
 * @returns the field's conversion spec.
 */
export function settingsBooleanField(field: string): SettingsFieldSpec {
  return {
    field,
    format: value => typeof value === 'boolean' ? String(value) : '',
    parse: (text) => {
      const trimmed = text.trim()
      if (trimmed === '') return { kind: 'clear' }
      if (trimmed === 'true') return { kind: 'set', value: true }
      if (trimmed === 'false') return { kind: 'set', value: false }
      return undefined
    },
  }
}

/**
 * A whole-number field. An empty draft clears the field; any other draft that
 * is not a finite number blocks the save.
 * @param field - field name inside the namespace section.
 * @returns the field's conversion spec.
 */
export function settingsNumberField(field: string): SettingsFieldSpec {
  return {
    field,
    // A section that carries no number for this field renders empty rather
    // than as a value nobody chose.
    format: value => typeof value === 'number' ? String(value) : '',
    parse: (text) => {
      const trimmed = text.trim()
      if (trimmed === '') return { kind: 'clear' }
      const parsed = Number(trimmed)
      return Number.isSafeInteger(parsed) ? { kind: 'set', value: parsed } : undefined
    },
  }
}

/**
 * A free-text field. An empty draft clears the field, so emptying the control
 * and saving is the same gesture as resetting it.
 * @param field - field name inside the namespace section.
 * @returns the field's conversion spec.
 */
export function settingsTextField(field: string): SettingsFieldSpec {
  return {
    field,
    format: value => typeof value === 'string' ? value : '',
    parse: (text) => {
      const trimmed = text.trim()
      return trimmed === '' ? { kind: 'clear' } : { kind: 'set', value: trimmed }
    },
  }
}

/**
 * Stages one card's edits over one settings namespace and writes them on save.
 *
 * The form publishes through a snapshot store because slot components read
 * through a snapshot selector, while both the scope and the local drafts
 * change underneath; every projection is rebuilt from the two together.
 */
export class SettingsFormModel<T> {
  private readonly specs: Map<string, SettingsFieldSpec>
  private readonly staged = new Map<string, StagedEdit>()
  private readonly listeners = new Set<() => void>()
  private baseline: SettingsFormScopeSnapshot<T> | undefined
  private readonly unsubscribe: () => void
  private saving = false
  private failed = false

  /**
   * @param scope - the shared configuration form for this card's namespace.
   * @param specs - the section fields this card edits.
   */
  constructor(
    private readonly scope: SettingsFormScope<T>,
    specs: SettingsFieldSpec[],
  ) {
    this.specs = new Map(specs.map(spec => [spec.field, spec]))
    this.unsubscribe = scope.subscribe(() => { this.publish() })
  }

  /**
   * Publish a projection of this form, rebuilt whenever the scope or a draft changes.
   * @param project - build the card's state from the form's current reads.
   * @returns the store the card's component reads through its bound selector.
   */
  bind<S>(project: () => S): SnapshotStore<S> {
    const store = createSnapshotStore(project())
    this.listeners.add(() => { store.set(project()) })
    return store
  }

  /**
   * Read the card-level state: what the Host serves, and what a save would do.
   * @returns the form state every card shares.
   */
  shell(): SettingsFormShell {
    const snapshot = this.scope.getSnapshot()
    const plan = this.plan()
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: plan.length > 0,
      invalid: plan.some(item => item.op === undefined),
      saving: this.saving,
      failed: this.failed,
    }
  }

  /**
   * Read one control's state.
   * @param field - field name of a section field.
   * @returns the draft text, whether a save would leave an override, and whether it is invalid.
   */
  field(field: string): SettingsFieldState {
    const staged = this.staged.get(field)
    const spec = this.spec(field)
    if (staged === undefined) {
      return { text: spec.format(this.sectionValue(field)), overridden: this.stored(field), invalid: false }
    }
    const write = staged.clear ? { kind: 'clear' as const } : spec.parse(staged.text)
    return {
      text: staged.text,
      overridden: write?.kind === 'set',
      invalid: write === undefined,
    }
  }

  /**
   * Build the edit, reset, save, and discard actions bound to this form.
   * @returns the actions a card's slot entry injects.
   */
  actions(): SettingsFormActions {
    return {
      edit: (field, text) => { this.stage(field, { text, clear: false }) },
      resetField: (field) => {
        this.stage(field, { text: this.spec(field).format(this.baseValue(field)), clear: true })
      },
      save: () => { void this.save() },
      discard: () => {
        if (this.staged.size === 0 && !this.failed) return
        this.staged.clear()
        this.baseline = undefined
        this.failed = false
        this.publish()
      },
    }
  }

  /**
   * Write every staged edit, then re-seed from what the Host accepted.
   *
   * The Host is the only authority on whether a value was accepted — its
   * validators own the constraints no schema can express — so the outcome is
   * read back from the section rather than predicted here. A save that did not
   * land keeps its drafts, so the user can correct them instead of retyping.
   */
  async save(): Promise<void> {
    const plan = this.plan()
    if (!plan.length || this.saving || !this.scope.getSnapshot().writable
      || plan.some(item => item.op === undefined)) return
    this.saving = true
    this.failed = false
    this.publish()
    try {
      const landed = await this.scope.mutate(plan.map(item => item.op as SettingsFormPathOp), this.baseline?.revision)
      if (landed) this.staged.clear()
      this.failed = !landed
      this.baseline = undefined
    } catch {
      this.failed = true
    } finally {
      this.saving = false
      this.publish()
    }
  }

  /** Release the form's accepted-value subscription. */
  dispose(): void { this.unsubscribe(); this.listeners.clear() }

  /**
   * Every staged edit a save would write. An entry whose draft is not a value
   * its field accepts carries no write: the form is still dirty, and the save
   * refuses rather than dropping the edit.
   */
  private plan(): PlannedWrite[] {
    const plan: PlannedWrite[] = []
    for (const [field, staged] of this.staged) {
      const spec = this.spec(field)
      if (staged.clear) {
        if (this.stored(field)) plan.push({ field, op: { op: 'unset', path: [field] } })
        continue
      }
      if (staged.text === spec.format(this.sectionValue(field))) continue
      const write = spec.parse(staged.text)
      if (write === undefined) plan.push({ field })
      else if (write.kind === 'clear') plan.push({ field, op: { op: 'unset', path: [field] } })
      else plan.push({ field, op: { op: 'set', path: [field], value: write.value } })
    }
    return plan
  }

  private stage(field: string, edit: StagedEdit): void {
    this.baseline ??= this.scope.getSnapshot()
    this.staged.set(field, edit)
    this.failed = false
    this.publish()
  }

  private spec(field: string): SettingsFieldSpec {
    const spec = this.specs.get(field)
    // Every call site names a field this card declared; a missing one is a
    // wiring mistake that must not degrade into a silently inert control.
    if (spec === undefined) throw new Error(`plugin card has no field ${field}`)
    return spec
  }

  private snapshotOf(): SettingsFormScopeSnapshot<T> {
    return this.scope.getSnapshot()
  }

  private sectionValue(field: string): unknown {
    return (this.snapshotOf().value as Record<string, unknown> | undefined)?.[field]
  }

  private baseValue(field: string): unknown {
    return (this.snapshotOf().base as Record<string, unknown> | undefined)?.[field]
  }

  private userLayer(): Record<string, unknown> | undefined {
    return this.snapshotOf().user as Record<string, unknown> | undefined
  }

  private stored(field: string): boolean {
    const user = this.userLayer()
    return user !== undefined && Object.hasOwn(user, field)
  }

  private publish(): void {
    for (const listener of this.listeners) listener()
  }
}
