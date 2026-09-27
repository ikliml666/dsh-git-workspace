import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

export type WorkspaceClientFlavor = 'legacy' | 'alpha' | 'next' | 'unsupported'

export function workspaceClientFlavorForAgentVersion(version: string | undefined): WorkspaceClientFlavor {
  if (version === '0.1.2-rc.1') return 'legacy'
  if (version === '0.1.6-alpha.2') return 'alpha'
  if (version === '0.1.7-rc.2') return 'next'
  return 'unsupported'
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

/**
 * The Host-resolved agent package is a version signal, not the plugin's
 * build-time dev dependency. Anchors run most-Host-like first: under a link:
 * install the plugin's own node_modules shadows the Host tree, so the running
 * entry script and its cwd win and the plugin path is only the last resort.
 */
export function workspaceClientFlavorFromAnchors(anchors: ReadonlyArray<string | undefined>): WorkspaceClientFlavor {
  for (const anchor of anchors) {
    const version = agentVersionFromAnchor(anchor)
    if (version !== undefined) return workspaceClientFlavorForAgentVersion(version)
  }
  return 'unsupported'
}

export function hostWorkspaceClientFlavor(): WorkspaceClientFlavor {
  return workspaceClientFlavorFromAnchors([process.argv[1], process.cwd(), import.meta.url])
}
