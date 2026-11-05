import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { decorateOfficialWorkspaceClient } from './workspace-sidebar-upstream.mjs'

export const RC5_WORKSPACE_VERSION = '0.2.1-rc.5'
export const RC5_WORKSPACE_SHA256 = '9c2c17a66a5c20de00ac2852cb76debb5237439e97f877403bcaa2a471086544'
export const RC5_WORKSPACE_VIRTUAL_ID = 'virtual:dsh-official-workspace-client-rc5'
export const RESOLVED_RC5_WORKSPACE_VIRTUAL_ID = `\0${RC5_WORKSPACE_VIRTUAL_ID}`

/**
 * The 0.2.1 line has no `contextMenus` service and no `cwd` field, so its
 * decoration must come from its own Client bytes instead of the 0.2.2 shard:
 * a derivative is frozen at build time and cannot span both Host generations.
 */
export function readRc5WorkspaceClient() {
  const require = createRequire(import.meta.url)
  const packageName = '@deepseek-ai/dsh-client-ui-workspace-rc5'
  const packageJson = JSON.parse(readFileSync(require.resolve(`${packageName}/package.json`), 'utf8'))
  if (packageJson.name !== '@deepseek-ai/dsh-client-ui-workspace' || packageJson.version !== RC5_WORKSPACE_VERSION) {
    throw new Error(`Unsupported official Workspace source ${packageJson.name}@${packageJson.version}; expected ${RC5_WORKSPACE_VERSION}`)
  }
  const clientPath = require.resolve(`${packageName}/client`)
  const source = readFileSync(clientPath, 'utf8')
  const hash = createHash('sha256').update(source).digest('hex')
  if (hash !== RC5_WORKSPACE_SHA256) throw new Error(`Official Workspace Client hash drifted: ${hash}; expected ${RC5_WORKSPACE_SHA256}`)
  return { source, clientPath }
}

export function decorateRc5WorkspaceClient(source) {
  // The 0.2.1 row reads `useSessionAccess` nowhere, so its `draggable` line has
  // no `reorderable` term and the shared setup seam cannot match. Declaring the
  // decoration here keeps one seam definition on the shared side instead of
  // forking all 38 anchors; the shared optional seam then stays a no-op.
  const setup = '\t\t\tconst draggable = drag !== void 0 && !row.blank && !row.archived;\n\t\t\tconst [menuOpen, setMenuOpen]'
  const first = source.indexOf(setup)
  if (first < 0 || first !== source.lastIndexOf(setup)) {
    throw new Error('Unable to derive the 0.2.1-rc.5 Workspace row setup: expected one stable source seam')
  }
  const prepared = source.slice(0, first)
    + '\t\t\tconst draggable = drag !== void 0 && !row.blank && !row.archived;\n'
    + '\t\t\tconst worktreeDecoration = managedWorktreeDecoration(node, t);\n'
    + '\t\t\tconst [menuOpen, setMenuOpen]'
    + source.slice(first + setup.length)
  return decorateOfficialWorkspaceClient(prepared)
}

export function materializeRc5WorkspaceClientModule() {
  const source = decorateRc5WorkspaceClient(readRc5WorkspaceClient().source)
  const factoryToken = 'factory: (require) => {'
  const start = source.indexOf(factoryToken)
  const end = source.lastIndexOf('\n\t}\n});')
  if (start < 0 || end < 0 || end <= start) {
    throw new Error('Unable to extract the 0.2.1-rc.5 Workspace Client ModuleLoader factory')
  }
  const body = source.slice(start + factoryToken.length, end)
  return `
import * as cordis from '@deepseek-ai/cordis'
import * as store from '@deepseek-ai/dsh-client-store'
import * as jsxRuntime from 'react/jsx-runtime'
import * as react from 'react'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
const modules = {
  '@deepseek-ai/cordis': cordis,
  '@deepseek-ai/dsh-client-store': store,
  'react/jsx-runtime': jsxRuntime,
  'react': react,
  '@deepseek-ai/dsh-client-ui-primitives': primitives,
}
const official = ((require) => {${body}
})(specifier => {
  const value = modules[specifier]
  if (value === undefined) throw new Error('Unsupported official Workspace Client require: ' + specifier)
  return value
})
export const apply = official.apply
export const inject = official.inject
export const WorkspaceBrowser = official.WorkspaceBrowser
`
}
