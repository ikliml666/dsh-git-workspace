import { useCallback, useEffect, useRef, useState } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  WorktreeConsoleAdapter,
  WorktreeConsoleGitTag,
} from '../../console-contract.js'
import type { ClientTranslator } from '../i18n.js'

export interface TagManagerModalProps {
  open: boolean
  onClose: () => void
  adapter: WorktreeConsoleAdapter
  sessionId: string
  t: ClientTranslator
}

type BusyAction = 'create' | 'delete' | 'push' | null

/**
 * Local tag manager behind the branch popover. Listing is one RPC; every
 * mutation re-reads the list so the modal never shows a stale tag after a
 * create/delete/push (the git spawns are cheap and the list is small).
 */
export function TagManagerModal({ open, onClose, adapter, sessionId, t }: TagManagerModalProps) {
  const [tags, setTags] = useState<WorktreeConsoleGitTag[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<BusyAction>(null)
  const [createName, setCreateName] = useState('')
  const [createMessage, setCreateMessage] = useState('')
  const [pushOnCreate, setPushOnCreate] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [deleteRemote, setDeleteRemote] = useState(false)
  const requestSeq = useRef(0)

  const load = useCallback(async (): Promise<void> => {
    const seq = ++requestSeq.current
    setLoading(true)
    setError(null)
    const outcome = await adapter.gitListTags(sessionId)
    if (seq !== requestSeq.current) return
    setLoading(false)
    if (!outcome.ok) {
      setError(outcome.error.message)
      return
    }
    setTags(outcome.value.tags)
  }, [adapter, sessionId])

  useEffect(() => {
    if (!open) return
    setTags(null)
    setError(null)
    setNotice(null)
    setBusy(null)
    setCreateName('')
    setCreateMessage('')
    setPushOnCreate(false)
    setConfirmDelete(null)
    setDeleteRemote(false)
    void load()
    return () => { requestSeq.current += 1 }
  }, [open, load])

  const createTag = async (): Promise<void> => {
    const name = createName.trim()
    if (name === '' || busy !== null) return
    setBusy('create')
    setError(null)
    setNotice(null)
    const outcome = await adapter.gitCreateTag({
      sessionId,
      name,
      message: createMessage.trim() === '' ? undefined : createMessage.trim(),
      push: pushOnCreate,
    })
    setBusy(null)
    if (!outcome.ok) {
      setError(outcome.error.message)
      return
    }
    if (outcome.value.pushed === false) {
      // Local create succeeded; only the push failed. Say so without hiding the tag.
      setError(outcome.value.pushMessage ?? t("tag.push.failed"))
    } else {
      setNotice(pushOnCreate ? t("tag.created.and.pushed", { p0: name }) : t("tag.created", { p0: name }))
    }
    setCreateName('')
    setCreateMessage('')
    void load()
  }

  const deleteTag = async (name: string): Promise<void> => {
    if (busy !== null) return
    setBusy('delete')
    setError(null)
    setNotice(null)
    const outcome = await adapter.gitDeleteTag({ sessionId, name, remote: deleteRemote })
    setBusy(null)
    if (!outcome.ok) {
      setError(outcome.error.message)
      return
    }
    if (outcome.value.pushed === false) setError(outcome.value.pushMessage ?? t("tag.delete.remote.failed"))
    else setNotice(deleteRemote ? t("tag.deleted.and.remote", { p0: name }) : t("tag.deleted", { p0: name }))
    setConfirmDelete(null)
    setDeleteRemote(false)
    void load()
  }

  const pushTag = async (name: string): Promise<void> => {
    if (busy !== null) return
    setBusy('push')
    setError(null)
    setNotice(null)
    const outcome = await adapter.gitPushTag({ sessionId, name })
    setBusy(null)
    if (!outcome.ok) {
      setError(outcome.error.message)
      return
    }
    setNotice(t("tag.pushed", { p0: name }))
    void load()
  }

  return (
    <Modal
      open={open}
      onClose={() => { if (busy === null) onClose() }}
      title={t("tag.manager.title")}
      closeLabel={t("close")}
      className="dsh-wtc-tag-modal"
      footer={(
        <span className="dsh-wtc-confirm-actions">
          <button type="button" className="dsh-wtc-button" disabled={busy !== null} onClick={onClose}>
            {t("close")}
          </button>
        </span>
      )}
    >
      <div className="dsh-wtc-tag-manager">
        <div className="dsh-wtc-tag-create">
          <input
            className="dsh-wtc-create-branch-input"
            value={createName}
            placeholder={t("tag.create.placeholder")}
            autoFocus
            onChange={event => setCreateName(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) void createTag() }}
          />
          <input
            className="dsh-wtc-create-branch-input"
            value={createMessage}
            placeholder={t("tag.message.placeholder")}
            onChange={event => setCreateMessage(event.target.value)}
          />
          <label className="dsh-wtc-tag-push-toggle">
            <input
              type="checkbox"
              checked={pushOnCreate}
              onChange={event => setPushOnCreate(event.target.checked)}
            />
            {t("tag.push.on.create")}
          </label>
          <button
            type="button"
            className="dsh-wtc-button dsh-wtc-primary"
            disabled={busy !== null || createName.trim().length === 0}
            onClick={() => { void createTag() }}
          >
            {busy === 'create' ? t("processing") : t("tag.create.confirm")}
          </button>
        </div>
        {error ? <span className="dsh-wtc-menu-error">{error}</span> : null}
        {notice !== null ? <span className="dsh-wtc-tag-notice">{notice}</span> : null}
        <div className="dsh-wtc-tag-list">
          {loading && tags === null ? <span>{t("tag.loading")}</span> : null}
          {tags !== null && tags.length === 0 ? <span>{t("tag.empty")}</span> : null}
          {tags?.map(tag => (
            <div className="dsh-wtc-tag-row" key={tag.name} data-tag-pushed={tag.pushed ? '' : undefined}>
              <span className="dsh-wtc-tag-name" title={tag.name}>{tag.name}</span>
              {tag.annotated ? <span className="dsh-wtc-tag-kind">{t("tag.kind.annotated")}</span> : null}
              {tag.pushed ? <span className="dsh-wtc-tag-kind">{t("tag.kind.pushed")}</span> : null}
              {tag.message !== null ? <span className="dsh-wtc-tag-message" title={tag.message}>{tag.message}</span> : null}
              <span className="dsh-wtc-tag-actions">
                {tag.pushed
                  ? null
                  : (
                    <button
                      type="button"
                      className="dsh-wtc-button dsh-wtc-button-small"
                      disabled={busy !== null}
                      onClick={() => { void pushTag(tag.name) }}
                    >
                      {t("tag.push")}
                    </button>
                  )}
                <button
                  type="button"
                  className="dsh-wtc-button dsh-wtc-button-small dsh-wtc-danger"
                  disabled={busy !== null}
                  onClick={() => { setConfirmDelete(tag.name); setDeleteRemote(false); setError(null) }}
                >
                  {t("tag.delete")}
                </button>
              </span>
            </div>
          ))}
        </div>
        {confirmDelete !== null ? (
          <div className="dsh-wtc-tag-confirm">
            <span>{t("tag.delete.confirm", { p0: confirmDelete })}</span>
            <label className="dsh-wtc-tag-push-toggle">
              <input
                type="checkbox"
                checked={deleteRemote}
                onChange={event => setDeleteRemote(event.target.checked)}
              />
              {t("tag.delete.also.remote")}
            </label>
            <span className="dsh-wtc-confirm-actions">
              <button type="button" className="dsh-wtc-button" disabled={busy !== null} onClick={() => { setConfirmDelete(null); setDeleteRemote(false) }}>
                {t("cancel")}
              </button>
              <button
                type="button"
                className="dsh-wtc-button dsh-wtc-danger"
                disabled={busy !== null}
                onClick={() => { void deleteTag(confirmDelete) }}
              >
                {busy === 'delete' ? t("processing") : t("tag.delete.confirm.action")}
              </button>
            </span>
          </div>
        ) : null}
      </div>
    </Modal>
  )
}
