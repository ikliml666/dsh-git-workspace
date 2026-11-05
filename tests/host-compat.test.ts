import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { workspaceClientFlavorForAgentVersion } from '../src/host-compat.js'

describe('Host-pinned Workspace generation', () => {
  test('declares the inspected Workspace generations as open peer ranges', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
      peerDependencies: Record<string, string>
    }
    expect(manifest.peerDependencies['@deepseek-ai/dsh-client-locale'])
      .toBe('^0.1.2-rc.1 || ^0.1.6-alpha.2 || ^0.1.7-rc.2 || ^0.2.0-rc.1')
  })

  test('only selects source-verified Browser generations and preserves the legacy path', () => {
    expect(workspaceClientFlavorForAgentVersion('0.1.2-rc.1')).toBe('legacy')
    expect(workspaceClientFlavorForAgentVersion('0.1.6-alpha.2')).toBe('alpha')
    expect(workspaceClientFlavorForAgentVersion('0.1.7-rc.2')).toBe('next')
    expect(workspaceClientFlavorForAgentVersion('0.2.1-rc.2')).toBe('modern-rc5')
    expect(workspaceClientFlavorForAgentVersion('0.2.1-rc.3')).toBe('modern-rc5')
    expect(workspaceClientFlavorForAgentVersion('0.2.1-rc.4')).toBe('modern-rc5')
    expect(workspaceClientFlavorForAgentVersion('0.2.1-rc.5')).toBe('modern-rc5')
    expect(workspaceClientFlavorForAgentVersion('0.1.7-rc.3')).toBe('unsupported')
    expect(workspaceClientFlavorForAgentVersion(undefined)).toBe('unsupported')
  })

  // A decoration is compiled in against one pinned official Client, so the
  // 0.2.1 and 0.2.2 lines need their own shard: 0.2.2-rc.1 added the
  // `contextMenus` service and the `cwd` field, neither of which a 0.2.1 Host
  // provides or understands.
  test('splits the modern line at the 0.2.2 contextMenus generation', () => {
    expect(workspaceClientFlavorForAgentVersion('0.2.0-rc.2')).toBe('modern-rc5')
    expect(workspaceClientFlavorForAgentVersion('0.2.1-alpha.1')).toBe('modern-rc5')
    expect(workspaceClientFlavorForAgentVersion('0.2.1-rc.1')).toBe('modern-rc5')
    expect(workspaceClientFlavorForAgentVersion('0.2.2-alpha.3')).toBe('modern-rc1')
    expect(workspaceClientFlavorForAgentVersion('0.2.2-rc.1')).toBe('modern-rc1')
    expect(workspaceClientFlavorForAgentVersion('0.2.3')).toBe('modern-rc1')
    expect(workspaceClientFlavorForAgentVersion('0.3.0-alpha.1')).toBe('unsupported')
    expect(workspaceClientFlavorForAgentVersion('1.2.0')).toBe('unsupported')
  })
})
