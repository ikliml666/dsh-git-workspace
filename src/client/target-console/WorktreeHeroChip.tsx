import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { WorktreeConsoleAdapter } from '../../console-contract.js'
import type { WorktreeClientServices } from '../actions.js'
import { TargetStatusAction } from './TargetStatusAction.js'

type PortalRenderer = (children: ReactNode, container: Element) => ReactNode

let cachedPortalRenderer: PortalRenderer | null | undefined

function resolvePortalRenderer(): PortalRenderer | null {
  if (cachedPortalRenderer !== undefined) return cachedPortalRenderer
  try {
    // `require` is the module-loader seam injected around the client bundle;
    // resolve react-dom lazily so a shell without it degrades to "no hero
    // chip" instead of failing the whole plugin bundle at load time.
    const nodeRequire: ((id: string) => unknown) | undefined =
      typeof require === 'function' ? (require as unknown as (id: string) => unknown) : undefined
    const reactDom = nodeRequire?.('react-dom') as
      | PortalRenderer
      | { createPortal?: PortalRenderer }
      | null
      | undefined
    const impl = typeof reactDom === 'function' ? reactDom : reactDom?.createPortal
    cachedPortalRenderer = typeof impl === 'function' ? impl : null
  } catch {
    cachedPortalRenderer = null
  }
  return cachedPortalRenderer
}

function isHeroRow(element: Element | null): element is HTMLElement {
  return element !== null
    && element instanceof HTMLElement
    && element.isConnected
    && element.className.includes('heroWorkspaceRow')
}

/**
 * Resolve the hero workspace row from the dock anchor instead of polling the
 * document: the official hero row is the composerStack sibling right before
 * the dock outlet, so walk the structure first (the git-graph lift pattern)
 * and only fall back to a document query.
 */
function findHeroRowFrom(anchor: HTMLElement | null): HTMLElement | null {
  if (anchor === null || !anchor.isConnected) return null
  const outlet = anchor.parentElement
  if (outlet !== null) {
    // 1. Previous sibling of the dock outlet, walking up a bounded chain of
    // wrapper spans the shell may add around the dock slot.
    let node: HTMLElement | null = outlet
    for (let depth = 0; depth < 4 && node !== null; depth += 1) {
      const prev = node.previousElementSibling as HTMLElement | null
      if (isHeroRow(prev)) return prev
      node = node.parentElement
    }
    // 2. Query inside the composerStack ancestor.
    const stack = outlet.closest('[class*="composerStack"], [class*="composerHero"]')
    if (stack !== null) {
      const rowInStack = stack.querySelector('[class*="heroWorkspaceRow"]')
      if (isHeroRow(rowInStack)) return rowInStack
    }
  }
  // 3. Fallback to any heroWorkspaceRow in the document.
  if (typeof document !== 'undefined') {
    const docRow = document.querySelector('[class*="heroWorkspaceRow"]')
    if (isHeroRow(docRow)) return docRow
  }
  return null
}

export interface WorktreeHeroChipProps {
  session?: { sessionId?: string; blank?: boolean } | null
  sessionId?: string
  adapter: WorktreeConsoleAdapter
  services: WorktreeClientServices
}

/**
 * Blank-conversation seat. The Harness hero workspace row only exists while
 * the conversation is blank, so mounting through the input dock and
 * portalling into that row places the target capsule beside the agent preset
 * picker — the same lift pattern the git-graph branch chip uses.
 */
export function WorktreeHeroChip({ session, sessionId, adapter, services }: WorktreeHeroChipProps) {
  const dockAnchor = useRef<HTMLSpanElement | null>(null)
  const [heroRow, setHeroRow] = useState<HTMLElement | null>(null)
  const targetSessionId = sessionId ?? session?.sessionId ?? null
  useEffect(() => {
    if (targetSessionId === null) {
      setHeroRow(null)
      return
    }
    // Zero-latency discovery: resolve from the dock anchor's structure and
    // re-resolve on any nearby DOM change; a short bounded poll remains as
    // the fallback for shells that mount the hero row outside the observed
    // subtree (e.g. a different portal root).
    let pollTimer: number | undefined
    let tries = 0
    const stopPolling = (): void => {
      if (pollTimer !== undefined) {
        window.clearInterval(pollTimer)
        pollTimer = undefined
      }
    }
    const resolve = (): void => {
      const row = findHeroRowFrom(dockAnchor.current)
      setHeroRow(current => (current === row ? current : row))
      if (row !== null) stopPolling()
    }
    resolve()
    const observer = typeof MutationObserver === 'function'
      ? new MutationObserver(resolve)
      : null
    const scope: ParentNode | null = dockAnchor.current?.parentElement
      ?? (typeof document !== 'undefined' ? document.body : null)
    if (observer !== null && scope !== null) {
      observer.observe(scope, { childList: true, subtree: true })
    }
    pollTimer = window.setInterval(() => {
      resolve()
      tries += 1
      // Bounded fallback (4s): the observer owns discovery from here.
      if (tries >= 8) stopPolling()
    }, 500)
    return () => {
      observer?.disconnect()
      stopPolling()
    }
  }, [targetSessionId])
  const renderPortal = resolvePortalRenderer()
  if (targetSessionId === null || session?.blank === false) return null
  return (
    <span ref={dockAnchor} data-dsh-part="worktree-hero-anchor" style={{ display: 'contents' }}>
      {heroRow !== null && renderPortal !== null
        ? renderPortal(
          <TargetStatusAction sessionId={targetSessionId} adapter={adapter} services={services} />,
          heroRow,
        )
        : null}
    </span>
  )
}
