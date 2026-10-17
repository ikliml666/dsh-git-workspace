import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { workspaceClientFlavorForAgentVersion } from '../src/host-compat.js'

describe('Host-pinned Workspace generation', () => {
  test('declares only the inspected rc.1, rc.2 and 0.2.x locale peers', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
      peerDependencies: Record<string, string>
    }
    expect(manifest.peerDependencies['@deepseek-ai/dsh-client-locale'])
      .toBe('0.1.2-rc.1 || 0.1.7-rc.2 || 0.2.0-rc.1 || 0.2.0-rc.2 || 0.2.1-alpha.1 || 0.2.1-rc.1')
  })

  test('only selects source-verified Browser generations and preserves the legacy path', () => {
    expect(workspaceClientFlavorForAgentVersion('0.1.2-rc.1')).toBe('legacy')
    expect(workspaceClientFlavorForAgentVersion('0.1.6-alpha.2')).toBe('alpha')
    expect(workspaceClientFlavorForAgentVersion('0.1.7-rc.2')).toBe('next')
    expect(workspaceClientFlavorForAgentVersion('0.2.0-rc.2')).toBe('modern')
    expect(workspaceClientFlavorForAgentVersion('0.1.7-rc.3')).toBe('unsupported')
    expect(workspaceClientFlavorForAgentVersion(undefined)).toBe('unsupported')
  })

  test('falls back to modern for unpinned 0.2.x agents, not for 0.1.x or 0.3+', () => {
    expect(workspaceClientFlavorForAgentVersion('0.2.1-alpha.1')).toBe('modern')
    expect(workspaceClientFlavorForAgentVersion('0.2.1-rc.1')).toBe('modern')
    expect(workspaceClientFlavorForAgentVersion('0.2.3')).toBe('modern')
    expect(workspaceClientFlavorForAgentVersion('0.3.0-alpha.1')).toBe('unsupported')
    expect(workspaceClientFlavorForAgentVersion('1.2.0')).toBe('unsupported')
  })
})
