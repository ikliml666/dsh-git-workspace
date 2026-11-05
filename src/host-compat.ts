import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

export type WorkspaceClientFlavor = 'legacy' | 'alpha' | 'next' | 'modern-rc5' | 'modern-rc1' | 'unsupported'

export function workspaceClientFlavorForAgentVersion(version: string | undefined): WorkspaceClientFlavor {
  if (version === '0.1.2-rc.1') return 'legacy'
  if (version === '0.1.6-alpha.2') return 'alpha'
  if (version === '0.1.7-rc.2') return 'next'
  if (version === '0.2.0-rc.2') return 'modern-rc5'
  // Two modern derivatives, because a decoration is frozen into the build
  // against one pinned official Client and cannot span both generations:
  // 0.2.2-rc.1 introduced the `contextMenus` service, moved the built-in
  // Session actions onto it, changed `apply` to read `ctx.remoteAccess` as a
  // property, and added a `cwd` field to the Session node and its hover card.
  // The 0.2.1 line has none of that (Client 232824 → 284999 bytes), so its
  // shard is derived from its own bytes and serves every 0.2.1 Host.
  if (version !== undefined && isModernGeneration(version)) {
    return patchVersion(version) >= 2 ? 'modern-rc1' : 'modern-rc5'
  }
  return 'unsupported'
}

function patchVersion(version: string): number {
  const match = /^\d+\.\d+\.(\d+)/.exec(version)
  if (match === null) throw new Error(`Unparsable Host version ${version}`)
  return Number(match[1])
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
