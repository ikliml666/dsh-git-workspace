import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorktreeConsoleGitSwitchIssue } from '../../console-contract.js'
import type { ClientTranslator } from '../i18n.js'

/** Affected paths listed before the rest collapses into a count. */
const VISIBLE_PATH_LIMIT = 8

export interface SwitchBranchAssistModalProps {
  /** `null` keeps the dialog closed; both steps share one modal. */
  step: 'blocked' | 'commit' | null
  branch: string | null
  issue: WorktreeConsoleGitSwitchIssue | null
  /** Uncommitted entries in the Local checkout; `-1` when the count is unknown. */
  dirtyCount: number
  message: string
  busy: boolean
  error: string | null
  t: ClientTranslator
  onClose: () => void
  onOpenCommit: () => void
  onMessageChange: (value: string) => void
  onConfirm: () => void
}

/**
 * Ported from ZCode's branch switch assist: when `git switch` would overwrite
 * Local's uncommitted work, show exactly which files Git reported and offer to
 * commit the whole working set first, then retry the switch.
 */
export function SwitchBranchAssistModal({
  step,
  branch,
  issue,
  dirtyCount,
  message,
  busy,
  error,
  t,
  onClose,
  onOpenCommit,
  onMessageChange,
  onConfirm,
}: SwitchBranchAssistModalProps) {
  const open = step !== null && issue !== null && branch !== null
  const visiblePaths = issue?.paths.slice(0, VISIBLE_PATH_LIMIT) ?? []
  const hiddenPathCount = (issue?.paths.length ?? 0) - visiblePaths.length
  const description = issue?.code === 'untracked-changes-would-be-overwritten'
    ? t('branch.switch.blocked.untracked', { p0: branch ?? '' })
    : t('branch.switch.blocked.tracked', { p0: branch ?? '' })

  return (
    <Modal
      open={open}
      onClose={() => { if (!busy) onClose() }}
      title={step === 'commit' ? t('branch.switch.commit.title') : t('branch.switch.blocked.title')}
      closeLabel={t('cancel')}
      description={step === 'commit' ? t('branch.switch.commit.description', { p0: branch ?? '' }) : description}
      footer={(
        <span className="dsh-wtc-confirm-actions">
          <button type="button" className="dsh-wtc-button" disabled={busy} onClick={onClose}>
            {t('cancel')}
          </button>
          <button
            type="button"
            className="dsh-wtc-button dsh-wtc-primary"
            disabled={busy || (step === 'commit' && message.trim().length === 0)}
            onClick={() => {
              if (busy) return
              if (step === 'commit') onConfirm()
              else onOpenCommit()
            }}
          >
            {busy
              ? t('branch.switch.commit.processing')
              : step === 'commit' ? t('branch.switch.commit.confirm') : t('branch.switch.blocked.confirm')}
          </button>
        </span>
      )}
    >
      {step === 'commit' ? (
        <div className="dsh-wtc-create-branch">
          <input
            className="dsh-wtc-create-branch-input"
            value={message}
            placeholder={t('branch.switch.commit.placeholder')}
            autoFocus
            disabled={busy}
            onChange={event => onMessageChange(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !busy && message.trim().length > 0) onConfirm()
            }}
          />
          {error ? <span className="dsh-wtc-menu-error">{error}</span> : null}
        </div>
      ) : (
        <div className="dsh-wtc-switch-assist">
          <p className="dsh-wtc-switch-warning">{description}</p>
          {visiblePaths.length > 0 ? (
            <div className="dsh-wtc-switch-files">
              <strong>{t('branch.switch.blocked.files')}</strong>
              {visiblePaths.map(path => (
                <span className="dsh-wtc-switch-file" key={path} title={path}>{path}</span>
              ))}
              {hiddenPathCount > 0
                ? <span className="dsh-wtc-switch-hint">{t('branch.switch.blocked.moreFiles', { p0: String(hiddenPathCount) })}</span>
                : null}
            </div>
          ) : null}
          {dirtyCount >= 0
            ? <p className="dsh-wtc-switch-hint">{t('branch.switch.blocked.dirty', { p0: String(dirtyCount) })}</p>
            : null}
          {error ? <span className="dsh-wtc-menu-error">{error}</span> : null}
        </div>
      )}
    </Modal>
  )
}
