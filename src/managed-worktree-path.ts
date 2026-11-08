import { createHash } from 'node:crypto'
import { basename, dirname, join } from 'node:path'

const WINDOWS_INVALID_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f]/g
const WINDOWS_RESERVED_NAME = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i
const REPEATED_DASHES = /-{2,}/g
const MAX_LABEL_LENGTH = 40
const DEFAULT_IDENTITY_LENGTH = 8

function truncateCodePoints(value: string, maxLength: number): string {
  return Array.from(value).slice(0, maxLength).join('')
}

/** Convert a canonical repository basename into one safe, readable path segment. */
export function sanitizeManagedWorktreeLabel(rawName: string | undefined): string {
  let cleaned = (rawName ?? '')
    .trim()
    .normalize('NFC')
    .replace(WINDOWS_INVALID_CHARACTERS, '-')
    .replace(/\s+/g, '-')
    .replace(REPEATED_DASHES, '-')
    .replace(/^[.\s-]+|[.\s-]+$/g, '')

  cleaned = truncateCodePoints(cleaned, MAX_LABEL_LENGTH)
    .replace(/[.\s-]+$/g, '')

  if (!cleaned) return 'repository'
  return WINDOWS_RESERVED_NAME.test(cleaned) ? `_${cleaned}` : cleaned
}

function checkoutIdentity(value: string, length: number): string {
  const normalized = value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
  if (!normalized) return 'checkout'
  return normalized.slice(0, Math.max(DEFAULT_IDENTITY_LENGTH, length))
}

/** Stable fallback partition that distinguishes repositories sharing one basename. */
export function createManagedWorktreeRepositoryKey(canonicalGitRoot: string): string {
  return createHash('sha256').update(canonicalGitRoot).digest('hex').slice(0, 12)
}

const BRANCH_INVALID_CHARACTERS = /[^A-Za-z0-9._/-]+/g
const BRANCH_SEGMENT_FORBIDDEN = /^\.|\.\.|@\{|\/\.|\/\/|\.lock$|\/$/g

/** 把任意会话标识/主题压成一个安全的 git 分支路径片段（保留 `-`/`_`/`.`）。 */
export function sanitizeBranchSegment(raw: string | undefined): string {
  const cleaned = (raw ?? '')
    .trim()
    .normalize('NFC')
    .replace(/\s+/g, '-')
    .replace(BRANCH_INVALID_CHARACTERS, '-')
    .replace(REPEATED_DASHES, '-')
    .replace(/^[.\s-]+|[.\s-]+$/g, '')
  return truncateCodePoints(cleaned, MAX_LABEL_LENGTH).replace(/[.\s-]+$/g, '')
}

/**
 * 会话自己的分支名候选：`feat/sess-<会话>[--主题]`。
 *
 * 会话分支是交付目标，所以必须一眼能看出属于哪个会话、对应哪次任务；重名时
 * 用 `-2`、`-3`… 递增，由调用方逐个尝试创建。
 */
export function createSessionBranchCandidates(input: {
  sessionId: string
  topic?: string | null
  limit?: number
}): string[] {
  const session = sanitizeBranchSegment(input.sessionId) || 'session'
  const topic = sanitizeBranchSegment(input.topic ?? '')
  const base = topic ? `feat/sess-${session}--${topic}` : `feat/sess-${session}`
  const limit = Math.max(1, input.limit ?? 5)
  const names = [base]
  for (let index = 2; index <= limit; index += 1) names.push(`${base}-${index}`)
  return names.map((name) => name.replace(BRANCH_SEGMENT_FORBIDDEN, '-'))
}

/** Physical basename: repository identity + trusted checkout identity only. */
export function createManagedWorktreeDirectoryName(input: {
  repositoryName: string
  checkoutId: string
  identityLength?: number
}): string {
  const repositoryLabel = sanitizeManagedWorktreeLabel(input.repositoryName)
  const identity = checkoutIdentity(input.checkoutId, input.identityLength ?? DEFAULT_IDENTITY_LENGTH)
  return `${repositoryLabel}--${identity}--worktree`
}

export interface ManagedWorktreePathCandidates {
  siblingContainer: string
  siblingRoot: string
  fallbackContainer: string
  fallbackRoot: string
}

export interface ManagedWorktreePathCandidates {
  siblingContainer: string
  siblingRoot: string
  fallbackContainer: string
  fallbackRoot: string
}

/**
 * Generate one collision-length candidate without touching the filesystem.
 * The caller probes 8/12/full checkout identities and chooses the first path
 * that does not already exist.
 *
 */
export function createManagedWorktreePathCandidates(input: {
  localGitRoot: string
  managedCheckoutsRoot: string
  repositoryKey: string
  checkoutId: string
  identityLength?: number
}): ManagedWorktreePathCandidates {
  const repositoryLabel = sanitizeManagedWorktreeLabel(basename(input.localGitRoot))
  const directoryName = createManagedWorktreeDirectoryName({
    repositoryName: repositoryLabel,
    checkoutId: input.checkoutId,
    ...(input.identityLength === undefined ? {} : { identityLength: input.identityLength }),
  })
  const siblingContainer = join(dirname(input.localGitRoot), `${repositoryLabel}--worktrees`)
  const fallbackContainer = join(input.managedCheckoutsRoot, 'worktrees', input.repositoryKey)
  return {
    siblingContainer,
    siblingRoot: join(siblingContainer, directoryName),
    fallbackContainer,
    fallbackRoot: join(fallbackContainer, directoryName),
  }
}
