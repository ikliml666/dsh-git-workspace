import { liveConfigValue, type LiveValue } from '../ports.js'

export interface GitTimeoutOptions {
  gitTimeoutMs?: number | LiveValue<number | undefined>
  worktreeAddTimeoutMs?: number | LiveValue<number | undefined>
}

export const DEFAULT_GIT_TIMEOUT_MS = 120_000
export const DEFAULT_WORKTREE_ADD_TIMEOUT_MS = 5 * 60_000
export const MAX_GIT_TIMEOUT_MS = 60 * 60_000

export function validateGitTimeouts(options: GitTimeoutOptions): void {
  for (const key of ['gitTimeoutMs', 'worktreeAddTimeoutMs'] as const) {
    const value = liveConfigValue(options[key])
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 1_000 || value > MAX_GIT_TIMEOUT_MS)) {
      throw new RangeError(`${key} must be an integer between 1000 and ${MAX_GIT_TIMEOUT_MS} ms`)
    }
  }
}

export function gitTimeoutMs(args: readonly string[], options: GitTimeoutOptions): number {
  // Volatile fields are read per call so a settings-page edit applies to the
  // next command without remounting the plugin.
  if (args[0] === 'worktree' && args[1] === 'add') return liveConfigValue(options.worktreeAddTimeoutMs) ?? DEFAULT_WORKTREE_ADD_TIMEOUT_MS
  if (args[0] === 'worktree' && args[1] === 'remove') return 5 * 60_000
  return liveConfigValue(options.gitTimeoutMs) ?? DEFAULT_GIT_TIMEOUT_MS
}
