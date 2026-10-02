import { useEffect, useState, type ReactNode } from 'react'
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

function findHeroWorkspaceRow(): HTMLElement | null {
  const row = window.document.querySelector<HTMLElement>('[class*="heroWorkspaceRow"]')
  return row !== null && row.isConnected ? row : null
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
  const [heroRow, setHeroRow] = useState<HTMLElement | null>(null)
  const targetSessionId = sessionId ?? session?.sessionId ?? null
  useEffect(() => {
    if (targetSessionId === null) {
      setHeroRow(null)
      return
    }
    setHeroRow(findHeroWorkspaceRow())
    // ponytail: poll for a late-mounted hero row (blank shell renders it after
    // us); MutationObserver would be the zero-latency upgrade if 10s misses.
    let tries = 0
    const timer = window.setInterval(() => {
      const row = findHeroWorkspaceRow()
      if (row !== null) {
        setHeroRow(row)
        window.clearInterval(timer)
        return
      }
      tries += 1
      if (tries >= 40) window.clearInterval(timer)
    }, 250)
    return () => { window.clearInterval(timer) }
  }, [targetSessionId])
  const renderPortal = resolvePortalRenderer()
  if (targetSessionId === null || heroRow === null || renderPortal === null || session?.blank === false) return null
  return renderPortal(
    <TargetStatusAction sessionId={targetSessionId} adapter={adapter} services={services} />,
    heroRow,
  )
}
