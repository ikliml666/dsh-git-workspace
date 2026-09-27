import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, test } from 'vitest'
import { workspaceClientFlavorForAgentVersion, workspaceClientFlavorFromAnchors } from '../src/host-compat.js'

describe('Host-pinned Workspace generation', () => {
  test('declares only the inspected rc.1 and rc.2 locale peers', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
      peerDependencies: Record<string, string>
    }
    expect(manifest.peerDependencies['@deepseek-ai/dsh-client-locale'])
      .toBe('0.1.2-rc.1 || 0.1.7-rc.2')
  })

  test('only selects source-verified Browser generations and preserves the legacy path', () => {
    expect(workspaceClientFlavorForAgentVersion('0.1.2-rc.1')).toBe('legacy')
    expect(workspaceClientFlavorForAgentVersion('0.1.6-alpha.2')).toBe('alpha')
    expect(workspaceClientFlavorForAgentVersion('0.1.7-rc.2')).toBe('next')
    expect(workspaceClientFlavorForAgentVersion('0.1.7-rc.3')).toBe('unsupported')
    expect(workspaceClientFlavorForAgentVersion(undefined)).toBe('unsupported')
  })
})

describe('Host agent anchor resolution', () => {
  function fixtureAgentRoot(version: string | null): { root: string; anchor: string } {
    const root = mkdtempSync(join(tmpdir(), 'dsh-worktree-anchor-'))
    if (version !== null) {
      const agentDir = join(root, 'node_modules', '@deepseek-ai', 'dsh-agent')
      mkdirSync(agentDir, { recursive: true })
      writeFileSync(join(agentDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-agent', version }))
    }
    const anchor = join(root, 'anchor.mjs')
    writeFileSync(anchor, '')
    return { root, anchor }
  }

  test('resolves the flavor from a Host-like anchor, plain path or file URL', () => {
    const host = fixtureAgentRoot('0.1.7-rc.2')
    try {
      expect(workspaceClientFlavorFromAnchors([host.anchor, undefined])).toBe('next')
      expect(workspaceClientFlavorFromAnchors([pathToFileURL(host.anchor).href])).toBe('next')
    } finally {
      rmSync(host.root, { recursive: true, force: true })
    }
  })

  test('the first resolvable anchor wins even when a later anchor disagrees', () => {
    const shadowing = fixtureAgentRoot('0.1.2-rc.1')
    const host = fixtureAgentRoot('0.1.7-rc.2')
    try {
      expect(workspaceClientFlavorFromAnchors([shadowing.anchor, host.anchor])).toBe('legacy')
    } finally {
      rmSync(shadowing.root, { recursive: true, force: true })
      rmSync(host.root, { recursive: true, force: true })
    }
  })

  test('skips anchors that cannot see an agent tree', () => {
    const blind = fixtureAgentRoot(null)
    const host = fixtureAgentRoot('0.1.6-alpha.2')
    try {
      expect(workspaceClientFlavorFromAnchors([blind.anchor, host.anchor])).toBe('alpha')
      expect(workspaceClientFlavorFromAnchors([blind.anchor, undefined])).toBe('unsupported')
    } finally {
      rmSync(blind.root, { recursive: true, force: true })
      rmSync(host.root, { recursive: true, force: true })
    }
  })

  test('unknown agent versions stay unsupported', () => {
    const host = fixtureAgentRoot('0.1.7-rc.3')
    try {
      expect(workspaceClientFlavorFromAnchors([host.anchor])).toBe('unsupported')
    } finally {
      rmSync(host.root, { recursive: true, force: true })
    }
  })
})
