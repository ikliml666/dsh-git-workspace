import { join } from 'node:path'
import { SessionCheckoutError } from './index.js'
import { hostMessage } from './i18n/host.js'

/**
 * 项目级 Worktree 配置：一次声明，之后每轮创建与交付自动沿用。
 *
 * `linkDeps` 与 `preservePaths` 原本只是工具调用参数，模型每轮都要记得传；
 * 忘了就是「依赖没联上」或「草稿被清理」。这两个值由项目决定、跨轮次稳定，
 * 属于项目约定而不是单次调用的意图，所以放进项目根的可提交配置文件。
 *
 * 显式参数仍然优先：项目配置给默认值，模型按需覆盖。
 */
export const WORKTREE_CONFIG_FILE = '.dsh-worktree.json'

export interface WorktreeProjectConfig {
  linkDeps: string[]
  preservePaths: string[]
}

function emptyConfig(): WorktreeProjectConfig {
  return { linkDeps: [], preservePaths: [] }
}

function normalizePaths(value: unknown, file: string, field: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    throw new SessionCheckoutError('invalid_input', hostMessage('worktreeConfigFieldMustBeArray', { p0: file, p1: field }))
  }
  return value.map((item) => {
    if (typeof item !== 'string') {
      throw new SessionCheckoutError('invalid_input', hostMessage('worktreeConfigFieldMustBeArray', { p0: file, p1: field }))
    }
    const path = item.trim().replace(/\\/gu, '/').replace(/^\/+/u, '').replace(/\/+$/u, '')
    if (!path || path.split(/[/\\]/u).includes('..')) {
      throw new SessionCheckoutError('invalid_input', hostMessage('worktreeConfigPathInvalid', { p0: file, p1: field, p2: item }))
    }
    return path
  })
}

/** 解析配置文本；空文件视为没有配置，非法内容直接报错而不是静默忽略。 */
export function parseWorktreeConfig(text: string | null, file: string): WorktreeProjectConfig {
  if (text === null || text.trim() === '') return emptyConfig()
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new SessionCheckoutError('invalid_input', hostMessage('worktreeConfigInvalidJson', {
      p0: file,
      p1: error instanceof Error ? error.message : String(error),
    }))
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SessionCheckoutError('invalid_input', hostMessage('worktreeConfigNotObject', { p0: file }))
  }
  const record = raw as Record<string, unknown>
  return {
    linkDeps: normalizePaths(record.linkDeps, file, 'linkDeps'),
    preservePaths: normalizePaths(record.preservePaths, file, 'preservePaths'),
  }
}

/** 显式参数优先；未传时用项目配置，传空数组表示这轮不用配置。 */
export function resolveConfiguredPaths(explicit: string[] | undefined, configured: readonly string[]): string[] {
  return explicit !== undefined ? [...explicit] : [...configured]
}

/** 读取项目根配置；宿主没有读文件能力时视为没有配置。 */
export function readWorktreeConfig(
  readTextFile: ((path: string) => string | null) | undefined,
  localRoot: string,
): WorktreeProjectConfig {
  if (readTextFile === undefined) return emptyConfig()
  const file = join(localRoot, WORKTREE_CONFIG_FILE)
  return parseWorktreeConfig(readTextFile(file), file)
}
