import { defaultClientTranslator, type ClientTranslator } from './i18n.js'
/** Pure replay-stable ToolView models derived only from logged call/result slices. */

export interface ToolContentBlock {
  type: string
  text?: string
  [key: string]: unknown
}

export interface ToolCallBlockLike {
  callId: string
  argsRaw?: string
  call?: { argsRaw?: string }
  content?: ToolContentBlock[]
  kind?: string
  isError?: boolean
  error?: { name?: string; code?: string }
}

export interface ToolCallViewPropsLike {
  callId: string
  /** Supplied by Harness for every session-scoped ToolView. */
  sessionId?: string
  toolName: string
  block: ToolCallBlockLike
  cwd?: string
  openFile?: (path: string) => void
  inspect?: () => void
}

export interface WorktreeCreatePayload {
  kind: 'worktree_target_created'
  checkoutId: string
  targetSessionId: string
  managedRoot: string
  phase: string
  currentOid: string
  sourceSessionId: string
  /** Canonical cwd the Session was moved into, when the host could move it. */
  cwd?: string
  /** True when this Session now works inside the checkout and needs no handoff. */
  cwdSelected?: boolean
}



export type ToolLifecycle = 'running' | 'ok' | 'error' | 'stopped'

export interface ParsedTool<TPayload, TArgs = Record<string, never>> {
  lifecycle: ToolLifecycle
  payload: TPayload | null
  args: TArgs | null
  error: string | null
}

function textContent(block: ToolCallBlockLike): string | null {
  if (!block.kind) return null
  const parts = (block.content ?? []).map((item) => item.type === 'text'
    ? String(item.text ?? '')
    : JSON.stringify(item))
  if (parts.length === 0 && block.error) parts.push(`${block.error.name ?? 'Error'}: ${block.error.code ?? 'unknown'}`)
  return parts.join('\n') || null
}

function parseJson(value: string | undefined): unknown {
  if (!value) return null
  try { return JSON.parse(value) as unknown } catch { return null }
}

function lifecycle(block: ToolCallBlockLike): ToolLifecycle {
  if (!block.kind) return 'running'
  if (block.error?.code === 'interrupted') return 'stopped'
  return block.isError ? 'error' : 'ok'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  return typeof record[key] === 'string' && record[key] !== '' ? record[key] : null
}

export function parseCreateTool(block: ToolCallBlockLike, t: ClientTranslator = defaultClientTranslator): ParsedTool<WorktreeCreatePayload> {
  const state = lifecycle(block)
  const raw = textContent(block)
  const parsed = parseJson(raw ?? undefined)
  if (state === 'running') return { lifecycle: state, payload: null, args: null, error: null }
  if (state !== 'ok') return { lifecycle: state, payload: null, args: null, error: raw ?? t("worktree.creation.failed") }
  if (!isRecord(parsed)
    || parsed.kind !== 'worktree_target_created'
    || !stringField(parsed, 'checkoutId')
    || !stringField(parsed, 'targetSessionId')
    || !stringField(parsed, 'managedRoot')
    || !stringField(parsed, 'phase')
    || !stringField(parsed, 'currentOid')
    || !stringField(parsed, 'sourceSessionId')) {
    return { lifecycle: 'error', payload: null, args: null, error: t("malformed.worktree.create.result") }
  }
  return { lifecycle: state, payload: parsed as unknown as WorktreeCreatePayload, args: null, error: null }
}


