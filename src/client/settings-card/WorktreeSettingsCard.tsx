/**
 * The Worktree plugin's settings page: delivery and push switches, the
 * Worktree root, and the Git timeouts, staged over the plugin's Config
 * namespace. Self-contained on purpose — the client-ui-primitives version
 * installed with this plugin predates the shared SettingsForm, so the rows
 * are drawn with inline styles and no external stylesheet.
 */

import { type CSSProperties, type ReactNode } from 'react'
import { useClientTranslator, type ClientTranslator } from '../i18n.js'
import type { SettingsFormActions, SettingsFieldState } from './form-model.js'
import type { WorktreeSettingsCardState } from './worktree-settings-card.js'

/**
 * Props the Plugins page slot binds for this card. The renderer turns the
 * face's reserved `hooks.worktreeCard` source into the `useWorktreeCard`
 * selector hook, so the component never sees a `hooks` prop.
 */
export interface WorktreeSettingsCardProps extends SettingsFormActions {
  /** `'summary'` asks for the one-liner the Plugins page lists; anything else renders the form. */
  view?: string
  /** Selector hook the slot runtime binds from the controller's snapshot store. */
  useWorktreeCard: (selector: (snapshot: WorktreeSettingsCardState) => WorktreeSettingsCardState) => WorktreeSettingsCardState
}

const ACCENT = '#2563eb'
const MUTED = '#6b7280'
const DANGER = '#dc2626'
const BORDER = '#e5e7eb'

const cardStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  maxWidth: 640,
  padding: 16,
  border: `1px solid ${BORDER}`,
  borderRadius: 10,
  background: '#fff',
}

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 16,
}

const labelStyle: CSSProperties = { fontSize: 13, fontWeight: 500, color: '#111827' }
const hintStyle: CSSProperties = { fontSize: 12, color: MUTED, marginTop: 2 }
const controlBlockStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }

const inputStyle: CSSProperties = {
  width: 240,
  padding: '4px 8px',
  fontSize: 13,
  color: '#111827',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  background: '#fff',
}

const resetButtonStyle: CSSProperties = {
  padding: '2px 8px',
  fontSize: 12,
  color: '#374151',
  border: `1px solid ${BORDER}`,
  borderRadius: 6,
  background: '#fff',
  cursor: 'pointer',
}

const primaryButtonStyle: CSSProperties = {
  padding: '4px 14px',
  fontSize: 13,
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  background: ACCENT,
  cursor: 'pointer',
}

const badgeStyle: CSSProperties = {
  padding: '1px 6px',
  fontSize: 11,
  color: ACCENT,
  border: `1px solid ${ACCENT}`,
  borderRadius: 999,
  whiteSpace: 'nowrap',
}

const invalidStyle: CSSProperties = { fontSize: 12, color: DANGER, whiteSpace: 'nowrap' }

const footerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  paddingTop: 12,
  borderTop: `1px solid ${BORDER}`,
}

const switchStyle = (checked: boolean): CSSProperties => ({
  position: 'relative',
  width: 40,
  height: 22,
  padding: 0,
  border: 'none',
  borderRadius: 999,
  background: checked ? ACCENT : '#9ca3af',
  cursor: 'pointer',
  flexShrink: 0,
})

const knobStyle = (checked: boolean): CSSProperties => ({
  position: 'absolute',
  top: 3,
  left: checked ? 21 : 3,
  width: 16,
  height: 16,
  borderRadius: '50%',
  background: '#fff',
  transition: 'left 120ms ease',
})

interface FieldRowProps {
  label: string
  hint: string
  state: SettingsFieldState
  control: ReactNode
  disabled: boolean
  onReset: () => void
  t: ClientTranslator
}

function fieldRow({ label, hint, state, control, disabled, onReset, t }: FieldRowProps): ReactNode {
  return (
    <div style={rowStyle}>
      <div>
        <div style={labelStyle}>{label}</div>
        <div style={hintStyle}>{hint}</div>
      </div>
      <div style={controlBlockStyle}>
        {control}
        {state.invalid ? <span style={invalidStyle}>{t('settings.invalid.value')}</span> : null}
        {state.overridden ? (
          <>
            <span style={badgeStyle}>{t('settings.overridden')}</span>
            <button type="button" disabled={disabled} onClick={onReset} style={resetButtonStyle}>{t('settings.reset')}</button>
          </>
        ) : null}
      </div>
    </div>
  )
}

/**
 * Render the Worktree settings one-liner or its staged form, as the Plugins page asks.
 * @param props - the view asked for, the form snapshot store, and its actions.
 * @returns the one-liner, or the form.
 */
export function WorktreeSettingsCard(props: WorktreeSettingsCardProps) {
  const state = props.useWorktreeCard(snapshot => snapshot)
  const t = useClientTranslator()
  if (props.view === 'summary') return <>{t('settings.description')}</>
  if (!state.available) return null

  const disabled = !state.writable || state.saving

  const switchControl = (label: string, fieldState: SettingsFieldState, onToggle: () => void): ReactNode => {
    const checked = fieldState.text === 'true'
    return (
      <button type="button" role="switch" aria-checked={checked} aria-label={label}
        disabled={disabled} onClick={onToggle} style={switchStyle(checked)}>
        <span style={knobStyle(checked)} aria-hidden="true" />
      </button>
    )
  }

  const inputControl = (label: string, fieldState: SettingsFieldState, numeric: boolean, onEdit: (text: string) => void): ReactNode => (
    <input type="text" value={fieldState.text} inputMode={numeric ? 'numeric' : undefined}
      disabled={disabled} aria-label={label} style={inputStyle}
      onChange={event => { onEdit(event.target.value) }} />
  )

  return (
    <div style={cardStyle}>
      {fieldRow({
        label: t('settings.autoDeliver'), hint: t('settings.autoDeliver.hint'), state: state.autoDeliver,
        control: switchControl(t('settings.autoDeliver'), state.autoDeliver,
          () => props.edit('autoDeliver', state.autoDeliver.text === 'true' ? 'false' : 'true')),
        disabled, onReset: () => props.resetField('autoDeliver'), t,
      })}
      {fieldRow({
        label: t('settings.autoPush'), hint: t('settings.autoPush.hint'), state: state.autoPush,
        control: switchControl(t('settings.autoPush'), state.autoPush,
          () => props.edit('autoPush', state.autoPush.text === 'true' ? 'false' : 'true')),
        disabled, onReset: () => props.resetField('autoPush'), t,
      })}
      {fieldRow({
        label: t('settings.gitTimeoutMs'), hint: t('settings.gitTimeoutMs.hint'), state: state.gitTimeoutMs,
        control: inputControl(t('settings.gitTimeoutMs'), state.gitTimeoutMs, true, text => props.edit('gitTimeoutMs', text)),
        disabled, onReset: () => props.resetField('gitTimeoutMs'), t,
      })}
      {fieldRow({
        label: t('settings.worktreeAddTimeoutMs'), hint: t('settings.worktreeAddTimeoutMs.hint'), state: state.worktreeAddTimeoutMs,
        control: inputControl(t('settings.worktreeAddTimeoutMs'), state.worktreeAddTimeoutMs, true, text => props.edit('worktreeAddTimeoutMs', text)),
        disabled, onReset: () => props.resetField('worktreeAddTimeoutMs'), t,
      })}
      <div style={footerStyle}>
        <div style={{ fontSize: 12, color: state.failed ? DANGER : MUTED }}>
          {state.failed ? t('settings.failed')
            : state.saving ? t('settings.saving')
            : !state.writable ? t('settings.readonly')
            : ''}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" disabled={!state.dirty || state.saving} onClick={props.discard} style={resetButtonStyle}>
            {t('settings.discard')}
          </button>
          <button type="button" disabled={!state.writable || !state.dirty || state.invalid || state.saving}
            onClick={props.save} style={primaryButtonStyle}>
            {t('settings.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
