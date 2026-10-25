import { createElement } from 'react'

export const inject = ['slots', 'workspaces', 'sessions', 'conversation', 'connection', 'locale']

/**
 * Props the shadow registration handed to the derived Browser. The decorate
 * path must route through THIS component rather than the stock official
 * `component`: the official Browser has no row decoration, so the Worktree
 * icon/badge and workspace protection were silently dropped.
 */
export const derivedBrowserCalls: Array<Record<string, unknown>> = []

export const resetDerivedBrowserCalls = (): void => {
  derivedBrowserCalls.length = 0
}

export const WorkspaceBrowser = (props: any): unknown => {
  derivedBrowserCalls.push(props as Record<string, unknown>)
  return createElement('div', { 'data-derived-workspace-browser': 'true', 'data-testid': 'derived-browser-marker' })
}

export const apply = (ctx: any): void => {
  const OfficialBrowser = (_props: any) => null
  ctx.effect(() => ctx.locale?.register?.('workspace', {}), 'ui-workspace: dictionaries')
  ctx.slots.inject('sidebar.workspaces', () => ctx.slots.register({
    name: 'sidebar.workspaces',
    children: {
      'sidebar.workspaces.directoryFlow': { kind: 'single', scope: 'root' },
    },
    inject: () => ({}),
    locale: 'workspace',
  }, OfficialBrowser))
  ctx.slots.inject('conversation.hero.workspace', () => ctx.slots.register({
    name: 'conversation.hero.workspace',
    children: {
      'conversation.hero.workspace.directoryFlow': { kind: 'single', scope: 'root' },
    },
  }, OfficialBrowser))
}
