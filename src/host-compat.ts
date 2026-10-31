import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

export type WorkspaceClientFlavor = 'legacy' | 'alpha' | 'next' | 'modern' | 'unsupported'

export function workspaceClientFlavorForAgentVersion(version: string | undefined): WorkspaceClientFlavor {
  if (version === '0.1.2-rc.1') return 'legacy'
  if (version === '0.1.6-alpha.2') return 'alpha'
  if (version === '0.1.7-rc.2') return 'next'
  if (version === '0.2.0-rc.2') return 'modern'
  // The modern derivative ships from the 0.2.1 source line, not the previous
  // 0.2.0 line, so 0.2.1-rc.5 is the pinned modern release upstream (rc.5 is a
  // pure version-number republish of rc.4: the official Workspace Client is
  // byte-identical, 232824 bytes, same SHA-256 as rc.4).
  // Every service and slot the modern branch consumes (slots, sessions,
  // workspaces, locale, remote, layout, shortcuts; sidebar.workspaces and its
  // sub-slots) is verified unchanged against the 0.2.1-rc.5 Host sources —
  // including every seam the decorated official Browser needs — so unpinned
  // 0.2.x agents resolve to the same verified generation instead of going
  // unsupported on every Host bump. 0.1.x maps to three different flavors and
  // 0.3+ has not been source-verified: both stay unsupported.
  if (version !== undefined && isModernGeneration(version)) return 'modern'
  return 'unsupported'
}

function isModernGeneration(version: string): boolean {
  const match = /^(\d+)\.(\d+)\./.exec(version)
  return match !== null && match[1] === '0' && match[2] === '2'
}

function agentVersionFromAnchor(anchor: string | undefined): string | undefined {
  if (!anchor) return undefined
  try {
    const require = createRequire(anchor.startsWith('file:') ? anchor : pathToFileURL(anchor).href)
    const manifest = JSON.parse(readFileSync(require.resolve('@deepseek-ai/dsh-agent/package.json'), 'utf8')) as {
      name?: string; version?: string
    }
    if (manifest.name === '@deepseek-ai/dsh-agent') return manifest.version
  } catch { /* This anchor cannot see a Host agent tree; try the next one. */ }
  return undefined
}

export interface WorkspaceFlavorAnchorDiagnostic {
  kind: 'entry' | 'cwd' | 'plugin' | 'extra'
  anchor: string
  ok: boolean
  version?: string
}

export interface WorkspaceFlavorDiagnostics {
  flavor: WorkspaceClientFlavor
  anchors: WorkspaceFlavorAnchorDiagnostic[]
}

const ANCHOR_KINDS: ReadonlyArray<WorkspaceFlavorAnchorDiagnostic['kind']> = ['entry', 'cwd', 'plugin']

/**
 * The Host-resolved agent package is a version signal, not the plugin's
 * build-time dev dependency. Anchors run most-Host-like first: under a link:
 * install the plugin's own node_modules shadows the Host tree, so the running
 * entry script and its cwd win and the plugin path is only the last resort.
 * The first anchor that resolves a Host agent tree wins; every probe is recorded.
 */
export function workspaceFlavorDiagnostics(
  anchors: ReadonlyArray<string | undefined> = [process.argv[1], process.cwd(), import.meta.url],
): WorkspaceFlavorDiagnostics {
  const probed: WorkspaceFlavorAnchorDiagnostic[] = []
  let flavor: WorkspaceClientFlavor | undefined
  anchors.forEach((anchor, index) => {
    const version = agentVersionFromAnchor(anchor)
    const ok = version !== undefined
    probed.push({ kind: ANCHOR_KINDS[index] ?? 'extra', anchor: anchor ?? '', ok, ...(version === undefined ? {} : { version }) })
    if (ok && flavor === undefined) flavor = workspaceClientFlavorForAgentVersion(version)
  })
  return { flavor: flavor ?? 'unsupported', anchors: probed }
}

export function hostWorkspaceClientFlavor(): WorkspaceClientFlavor {
  return workspaceFlavorDiagnostics().flavor
}
