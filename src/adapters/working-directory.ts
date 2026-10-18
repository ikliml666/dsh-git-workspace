/**
 * Session working-directory adapter over the host `workingDirectory` service
 * (`@deepseek-ai/dsh-working-directory`). This is the mechanism the official
 * experimental worktree bundle uses to put a Session *inside* a fresh checkout:
 * its last creation step is `ctx.workingDirectory.set(agent, path)`. Without it
 * a Managed Worktree only changes where files live, not where the Session works.
 *
 * The service is resolved dynamically (`ctx.get`) because it ships as an
 * optional mount: hosts without it degrade to `undefined` and the plugin keeps
 * its long-standing guidance-only behaviour.
 * @module dsh-git-worktree/adapters/working-directory
 */

import type { Context } from '@deepseek-ai/cordis'
import { resolve } from 'node:path'

/** Minimal structural view of the host WorkingDirectoryService. */
export interface WorkingDirectoryServiceLike {
  /** Synchronous committed directory of a Session. */
  get(session: unknown): string
  ensure?(agent: unknown, signal?: AbortSignal): Promise<string>
  /** Durable change; requires a live (or unpublished) Agent. */
  set(agent: unknown, path: string, signal?: AbortSignal): Promise<string>
}

/** Port the tool layer uses to move a Session's cwd. */
export interface SessionWorkingDirectoryPort {
  /** Current effective directory, or undefined when the host has no service. */
  current(agent: unknown): string | undefined
  /**
   * Move the Session into `path`.
   * @returns the canonical directory now in effect, or `undefined` when the host
   *   has no workingDirectory service and nothing was moved. Callers must not
   *   report a selected cwd on `undefined`.
   */
  enter(agent: unknown, path: string): Promise<string | undefined>
  /**
   * Move the Session back to the Local boundary before `path` is removed.
   * Returns the restored directory, `undefined` when the Session is not inside
   * `path`, and does nothing when the host has no workingDirectory service.
   */
  leave(agent: unknown, path: string, fallback: string | undefined): Promise<string | undefined>
}

function isWorkingDirectoryLike(value: unknown): value is WorkingDirectoryServiceLike {
  return Boolean(value)
    && typeof value === 'object'
    && typeof (value as WorkingDirectoryServiceLike).get === 'function'
    && typeof (value as WorkingDirectoryServiceLike).set === 'function'
}

function sessionOf(agent: unknown): unknown {
  return (agent as { session?: unknown } | undefined)?.session
}

/**
 * Build the port. When the host does not mount `workingDirectory` the port
 * reports no current directory and `enter` resolves the requested path without
 * touching the Session — the model-facing guidance then carries the worktree.
 */
export function createSessionWorkingDirectoryPort(ctx: Context): SessionWorkingDirectoryPort {
  const service = (): WorkingDirectoryServiceLike | undefined => {
    // A plugin-only Context (tests, minimal hosts) may have no service registry
    // at all; treat that exactly like an unmounted service.
    if (typeof ctx.get !== 'function') return undefined
    const candidate: unknown = ctx.get('workingDirectory')
    return isWorkingDirectoryLike(candidate) ? candidate : undefined
  }
  return {
    current: (agent) => {
      const target = service()
      const session = sessionOf(agent)
      if (!target || session === undefined) return undefined
      try {
        return target.get(session)
      } catch {
        return undefined
      }
    },
    enter: async (agent, path) => {
      const target = service()
      // No service, or a tool caller without a live Agent: move nothing and say
      // so. Reporting `path` here would let callers claim a cwd they never set.
      if (!target || agent === undefined) return undefined
      return target.set(agent, path)
    },
    leave: async (agent, path, fallback) => {
      const target = service()
      const session = sessionOf(agent)
      if (!target || session === undefined || fallback === undefined) return undefined
      let inside = false
      try {
        inside = isWithin(target.get(session), path)
      } catch {
        // An unresolvable cwd means the caller is not standing in the checkout.
      }
      if (!inside) return undefined
      return target.set(agent, fallback)
    },
  }
}

/** True when `candidate` is `root` itself or nested under it (cross-platform). */
function isWithin(candidate: string, root: string): boolean {
  const normalize = (value: string): string => {
    const slashed = resolve(value).replace(/\\/g, '/').replace(/\/+$/, '')
    return process.platform === 'win32' ? slashed.toLowerCase() : slashed
  }
  const normalizedCandidate = normalize(candidate)
  const normalizedRoot = normalize(root)
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`)
}
