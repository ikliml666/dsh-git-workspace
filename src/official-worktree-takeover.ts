import type { Context } from '@deepseek-ai/cordis'
import type { Entry } from '@deepseek-ai/cordis-plugin-loader'

/**
 * Packages whose entries provide the experimental `create_worktree` tool.
 * Disabling them removes both the Worktree service and its tool from the
 * running Host, which is what "take over" means here: this plugin owns
 * Worktree creation, and a second creator writing checkouts no registry of
 * ours records is a checkout nobody can list, deliver, or clean up.
 */
const OFFICIAL_WORKTREE_PACKAGES = new Set([
  '@deepseek-ai/dsh-experimental-tool-worktree',
  '@deepseek-ai/dsh-experimental-worktree',
])

/** Tool name the official package registers. */
const OFFICIAL_CREATE_TOOL = 'create_worktree'

// Host boots start entries concurrently, and Loader versions differ in how a
// dispose that races a starting fiber settles. Bounding one operation keeps
// plugin activation from depending on the official fiber unwinding first.
const DEFAULT_OPERATION_TIMEOUT_MS = 10_000

/** Outcome of the takeover, reported once at activation. */
export interface OfficialWorktreeTakeoverResult {
  /** Entries this activation disabled and therefore may restore on unload. */
  disabled: string[]
  /** Entries that were already disabled by the user; never restored by us. */
  overridden: string[]
}

/** Tuning seams for {@link mountOfficialWorktreeTakeover} (tests). */
export interface OfficialWorktreeTakeoverOptions {
  /** Ceiling for a single Loader disable operation in milliseconds. */
  operationTimeoutMs?: number
}

/**
 * Disable the official Worktree entries so that only this plugin's tools create
 * checkouts. Entries the user disabled before this plugin activated stay
 * untouched: a restore of those would re-enable something the user turned off.
 */
export async function mountOfficialWorktreeTakeover(
  ctx: Context,
  options: OfficialWorktreeTakeoverOptions = {},
): Promise<OfficialWorktreeTakeoverResult> {
  const operationTimeoutMs = options.operationTimeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS
  const loader = ctx.loader
  const adopted = new Set<string>()
  const overridden = new Set<string>()
  const inFlight = new Set<string>()

  const official = (): Entry[] => {
    const result: Entry[] = []
    for (const entry of [...loader.entries()]) {
      const name = entry.options.name
      if (name === undefined || !OFFICIAL_WORKTREE_PACKAGES.has(name)) continue
      if (overridden.has(entry.id)) continue
      // `update()` commits `disabled: true` before the operation settles, so an
      // in-flight disable already reads as disabled. Classifying it here would
      // mistake our own pending disable for a user override and never restore
      // it on unload.
      if (inFlight.has(entry.id)) continue
      if (!adopted.has(entry.id) && Boolean(entry.options.disabled)) {
        overridden.add(entry.id)
        continue
      }
      result.push(entry)
    }
    return result
  }

  const disable = (entry: Entry): Promise<void> => new Promise(resolve => {
    const key = entry.id
    const fiber = entry.fiber
    // Claim the entry before touching it: `update()` commits
    // `options.disabled = true` and emits `internal/plugin` synchronously, so a
    // re-entrant reconcile would otherwise see our own pending disable as a
    // user override and never restore it.
    inFlight.add(key)
    let operation: Promise<unknown>
    try {
      // A disable disposes the running fiber without awaiting it; Loader keeps
      // the disposed fiber on the entry, so await it before treating the entry
      // as settled. Same Loader 1.0.6 adaptation as the Workspace election.
      operation = entry.update({ disabled: true }, false, true).then(() => fiber?.await())
    } catch (error) {
      inFlight.delete(key)
      ctx.logger.warn('dsh-git-worktree: official Worktree disable threw', error)
      resolve()
      return
    }
    const settle = (): void => { inFlight.delete(key) }
    const timer = setTimeout(() => {
      ctx.logger.warn(
        `dsh-git-worktree: official Worktree disable did not settle within ${String(operationTimeoutMs)}ms; `
        + 'the tool guard still denies create_worktree.',
      )
      resolve()
    }, operationTimeoutMs)
    timer.unref?.()
    void operation.then(
      () => { clearTimeout(timer); settle(); resolve() },
      error => {
        clearTimeout(timer)
        settle()
        ctx.logger.warn('dsh-git-worktree: official Worktree disable failed', error)
        resolve()
      },
    )
  })

  const reconcile = async (): Promise<void> => {
    for (const entry of official()) {
      if (inFlight.has(entry.id)) continue
      if (!entry.disabled) {
        await disable(entry)
        if (entry.options.disabled === true) adopted.add(entry.id)
      }
    }
  }

  // The tool stays reachable whenever the entry disable has not settled, so
  // the guard is the part that actually guarantees "hidden": it denies by
  // tool name, independent of which plugin currently provides it.
  const releaseGuard = ctx.tools.guard(execution => execution.name === OFFICIAL_CREATE_TOOL
    ? 'Worktree creation is handled by dsh-git-worktree; the experimental create_worktree tool is disabled.'
    : undefined)

  // Includes may add the official entries after this activation, and a user may
  // re-enable one; both re-enter the takeover here.
  ctx.on('internal/plugin', fiber => {
    const name = fiber.entry?.options.name
    if (name !== undefined && OFFICIAL_WORKTREE_PACKAGES.has(name)) {
      void reconcile().catch(error => ctx.logger.warn(error))
    }
  })
  ctx.on('internal/status', fiber => {
    if (fiber === ctx.fiber) void reconcile().catch(error => ctx.logger.warn(error))
  })
  await reconcile()

  ctx.effect(() => async () => {
    await releaseGuard()
    for (const entry of [...loader.entries()]) {
      if (!adopted.has(entry.id)) continue
      if (!entry.disabled) continue
      // Root/Include teardown owns these entries; do not resurrect that tree.
      if (entry.parent.ctx.fiber.uid === null) continue
      adopted.delete(entry.id)
      try {
        await entry.update({ disabled: null }, false, true)
        const current = entry.fiber
        if (!current || current.uid === null) await entry.init()
        else await entry.refresh()
      } catch (error) {
        ctx.logger.warn('dsh-git-worktree: official Worktree restore failed', error)
      }
    }
  })

  return { disabled: [...adopted], overridden: [...overridden] }
}
