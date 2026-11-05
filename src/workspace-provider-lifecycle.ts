import type { Context, FiberState } from '@deepseek-ai/cordis'
import type { Entry } from '@deepseek-ai/cordis-plugin-loader'
import { hostWorkspaceClientFlavor, type WorkspaceClientFlavor } from './host-compat.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    worktreeWorkspaceProvider: boolean
  }
}

const OFFICIAL_WORKSPACE = '@deepseek-ai/dsh-client-ui-workspace'
// Cordis exposes FiberState as a declaration-only const enum, not a JS export.
const UNLOADING: FiberState = 5
// One Loader election operation that has not settled by this ceiling stops
// blocking the chain: plugin activation must never depend on the Host's
// concurrent entry startup unwinding first (a wedged official-fiber dispose
// would otherwise starve every Remote, tool, and command mount).
const DEFAULT_OPERATION_TIMEOUT_MS = 10_000
// Cross-generation ownership. A restart unloads the previous lifecycle and
// installs a new one whose `adopted` set starts empty, while the official
// entry may still carry the `disabled: true` this plugin wrote — its restore
// is scheduled from the unload and can land after the next activation. The
// Entry object is shared by every generation, so ownership is recorded there:
// a later generation must not mistake our own pending disable for a user or
// market decision, and must re-elect (disable again) once that restore lands.
const ownedDisables = new WeakSet<Entry>()

/** Tuning seams for {@link mountWorkspaceProviderLifecycle} (tests). */
export interface WorkspaceProviderLifecycleOptions {
  /** Ceiling for a single Loader disable/restore operation in milliseconds. */
  operationTimeoutMs?: number
}

/** Outcome of the provider election, consumed by the Sidebar topology response. */
export interface WorkspaceProviderLifecycleResult {
  /** False only when this plugin actually disabled the official ui-workspace entry (takeover). */
  officialWorkspaceActive: boolean
}

/**
 * Elect exactly one `uiWorkspace` provider with Loader operations — never a
 * client-evaluated `!!js` disabled expression. The previous conditional patch
 * (`disabled: !!get('worktreeWorkspaceProvider') && ...`) evaluated the same
 * expression at two unsynchronized moments: during this plugin's Host apply
 * the plugin fiber was still LOADING, so Cordis' strict service read returned
 * `undefined` and the election always failed (decorate fallback), while the
 * Web renderer's later audit saw the plugin ACTIVE, evaluated the same
 * expression to `true` and skipped the official entry — leaving no
 * `uiWorkspace` provider at all and crashing the 0.2.x web boot (crashes
 * 2026-10-17 18:11 and 20:25, 17 entries pending). The election is therefore
 * decided once, here on the Host side: owned official entries are disabled
 * with `entry.update({ disabled: true })` (a plain boolean, so every later
 * read — Host audit, serialized renderer tree, module events — is
 * deterministic) and restored when this fiber is disposed. Official entries
 * the user disabled before this plugin activated are never owned.
 *
 * Election never blocks (or fails) plugin activation: Host boots start entries
 * concurrently, so the official entry's disable may race a fiber that is still
 * starting, and Loader versions differ in how such a dispose settles. Each
 * operation therefore races a ceiling; a wedged one is reported once and the
 * entry stays guarded until the real operation settles, while the next Loader
 * event retries the election. With the official entry disabled before the
 * page loads, the renderer never observes two `uiWorkspace` providers from a
 * slow reconciliation.
 */
export async function mountWorkspaceProviderLifecycle(
  ctx: Context,
  flavor: WorkspaceClientFlavor = hostWorkspaceClientFlavor(),
  options: WorkspaceProviderLifecycleOptions & { enabled?: boolean } = {},
): Promise<WorkspaceProviderLifecycleResult> {
  // Local adaptation: taking over the official Workspace is opt-in on legacy
  // hosts (0.1.x), where the takeover once broke new-conversation creation.
  // On modern hosts (0.2.x) the takeover is mandatory: the decorated
  // registration cannot obtain the official Browser's child-slot seat (the
  // 0.2.x Browser calls renderSlot for declared child slots and crashes with
  // "renderSlot is not a function" without them, breaking session rows and
  // new-session workspace selection), so the flag stays advisory there.
  // A takeover disables the official ui-workspace entry, which drops its
  // client package from the Host client graph; every package importing it
  // then fails to load its bundle, so the takeover runs only on request.
  if (!options.enabled) {
    ctx.logger.info('Workspace takeover disabled (enableWorkspaceProvider is not true); official ui-workspace stays active.')
    return { officialWorkspaceActive: true }
  }
  if (flavor === 'unsupported') {
    ctx.logger.warn('No pinned Workspace Browser for this Host generation; leaving the official Workspace provider active.')
    return { officialWorkspaceActive: true }
  }
  const operationTimeoutMs = options.operationTimeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS
  const loader = ctx.loader
  // The market replays its persisted disable list the moment a bundle entry
  // appears — frequently while this apply is still in flight — so this entry
  // can be externally disabled before (or while) the election runs. A disabled
  // owner must not take anything over: the election yields to the official
  // provider and retries if the entry is ever re-enabled.
  const selfDisabled = (): boolean => {
    try {
      return Boolean(ctx.fiber.entry?.disabled)
    } catch {
      return true
    }
  }
  // Ownership bookkeeping, by entry id:
  // - adopted: entries THIS lifecycle disabled (`options.disabled === true`
  //   written by us) — the only entries we may ever restore.
  // - overridden: official entries already disabled (plain truthy value) when
  //   first seen and not ours — a user or market decision we never touch.
  // A stale `__jsExpr` conditional patch from an older release is owned and
  // reconciled away (replaced by our deterministic boolean on disable).
  const adopted = new Set<string>()
  const overridden = new Set<string>()
  const official = (): Entry[] => {
    const result: Entry[] = []
    for (const entry of [...loader.entries()]) {
      if (entry.options.name !== OFFICIAL_WORKSPACE || overridden.has(entry.id)) continue
      const disabled = entry.options.disabled as unknown
      const conditional = disabled !== null && typeof disabled === 'object' && '__jsExpr' in disabled
      if (!conditional && !adopted.has(entry.id) && !ownedDisables.has(entry) && Boolean(disabled)) {
        overridden.add(entry.id)
        continue
      }
      result.push(entry)
    }
    return result
  }
  let released = false
  let pending = Promise.resolve()
  // Entries whose real Loader operation is still in flight (possibly past the
  // ceiling). Later reconciles skip them until the operation itself settles,
  // which keeps at most one Loader mutation per entry alive at any time.
  const inFlight = new Set<string>()
  const operate = (entry: Entry, kind: 'disable' | 'restore'): Promise<void> => new Promise(resolve => {
    const key = entry.id
    const label = kind === 'disable' ? 'official Workspace disable' : 'official Workspace restore'
    let operation: Promise<unknown>
    try {
      // `disabled: true` disposes the running fiber; `disabled: null` deletes
      // the key (isNullable) so the entry can start again. Plain values keep
      // every subsequent read deterministic — no expression evaluation.
      // Loader 1.0.6 adaptation (absorbed from upstream e2c6c70): update()
      // disposes the fiber without awaiting it, and it retains the disposed
      // fiber on the entry — refresh() then treats any surviving reference as
      // running, while only init() replaces the dead generation. So a disable
      // must await the old fiber, and a restore must rebuild a dead
      // generation instead of refreshing it.
      const fiber = entry.fiber
      operation = kind === 'disable'
        ? entry.update({ disabled: true }, false, true).then(() => fiber?.await())
        : (async () => {
          await entry.update({ disabled: null }, false, true)
          const current = entry.fiber
          if (!current || current.uid === null) await entry.init()
          else await entry.refresh()
        })()
    } catch (error) {
      ctx.logger.warn(`dsh-git-worktree: ${label} threw during Loader reconciliation`, error)
      resolve()
      return
    }
    const settle = (): void => { inFlight.delete(key) }
    inFlight.add(key)
    void operation.then(settle, settle)
    const timer = setTimeout(() => {
      ctx.logger.warn(
        `dsh-git-worktree: ${label} did not settle within ${String(operationTimeoutMs)}ms; `
        + 'plugin activation continues and election retries on the next Loader event.',
      )
      resolve()
    }, operationTimeoutMs)
    timer.unref?.()
    void operation.then(
      () => { clearTimeout(timer); settle(); resolve() },
      error => {
        clearTimeout(timer)
        settle()
        ctx.logger.warn(`dsh-git-worktree: ${label} failed during Loader reconciliation`, error)
        resolve()
      },
    )
  })
  const reconcile = (): Promise<void> => {
    pending = pending.then(async () => {
      if (released || selfDisabled()) return
      for (const entry of official()) {
        if (inFlight.has(entry.id)) continue
        let disabled: boolean
        try {
          disabled = entry.disabled
        } catch (error) {
          ctx.logger.warn('dsh-git-worktree: could not read the official Workspace disabled state', error)
          continue
        }
        if (!disabled) {
          await operate(entry, 'disable')
          // `update` commits `options.disabled = true` synchronously before
          // disposing, so only a genuinely committed disable is adopted; a
          // wedged or failed operation stays unowned and retries later.
          if (entry.options.disabled === true) {
            adopted.add(entry.id)
            ownedDisables.add(entry)
          }
        }
      }
    })
    return pending
  }
  const releaseMarker = ctx.provide('worktreeWorkspaceProvider', true)
  ctx.effect(() => async () => {
    released = true
    // Cordis 4.0.5 unloads effects concurrently, not in LIFO order. Explicitly
    // withdraw the marker before evaluating the official disabled expression.
    await releaseMarker()
    // Loader retains failed/disposed fibers and the Web registry only checks
    // the entry reference, not fiber state. Withdraw this generation alone and
    // publish the same owning-fiber event the registry consumes on disposal.
    // A later activation must never be cleared by this generation's cleanup.
    // Cordis 4.1.0 returns `Object.create(fiber)` from `ctx.plugin()`, and
    // Loader stores that wrapper on `entry.fiber`, so the entry reference is no
    // longer identical to `ctx.fiber`; it only inherits from it. Cordis 4.0.5
    // stored the fiber itself, so both forms stay recognised.
    const sameFiber = (candidate: typeof ctx.fiber | undefined): boolean =>
      candidate !== undefined && (candidate === ctx.fiber || Object.getPrototypeOf(candidate) === ctx.fiber)
    const withdraw = (): void => {
      const replacement = ctx.fiber.entry
      if (replacement === undefined || !sameFiber(replacement.fiber)) return
      replacement.fiber = undefined
      ctx.emit('internal/plugin', ctx.fiber)
    }
    // A restart also unloads effects, but reuses its live fiber, so a clean
    // unload must not clear the reference. A failed activation is different:
    // Loader 1.0.6 keeps that fiber on the entry, `fiber.await()` spins on the
    // retained transition (`while (inertia)` re-awaits an already-settled
    // promise and starves timers — measured 2026-10-24 on Windows), and
    // clearing `entry.fiber` while the entry is still UNLOADING breaks the
    // Loader's own teardown. So wait for the state to leave UNLOADING and
    // withdraw then, which is also when the registry re-reads the entry.
    if (ctx.fiber.uid === null) withdraw()
    // Root/Include teardown owns these entries; do not resurrect that tree.
    if (ctx.root.fiber.uid === null || ctx.root.fiber.state === UNLOADING) return
    await pending.catch(() => {})
    for (const entry of official()) {
      if (!adopted.has(entry.id) || inFlight.has(entry.id)) continue
      // Only a still-committed disable needs the restart: an entry someone
      // else re-enabled in the meantime already runs its fiber, and a wedged
      // in-flight operation owns the entry until it settles.
      if (!entry.disabled) continue
      if (entry.parent.ctx.fiber.uid === null || entry.parent.ctx.fiber.state === UNLOADING) continue
      adopted.delete(entry.id)
      ownedDisables.delete(entry)
      await operate(entry, 'restore')
    }
    // Loader 1.0.6 leaves the failed fiber on the entry and the Web registry
    // only checks that reference, so this generation must drop it. Clearing it
    // while the entry is still UNLOADING breaks the Loader's own teardown, and
    // `fiber.await()` spins on the retained transition (see above), so set the
    // reference aside once the unload has settled.
    const settle = (): void => {
      if (ctx.fiber.uid !== null && ctx.fiber.state === UNLOADING) {
        setTimeout(settle, 0)
        return
      }
      if (ctx.fiber.uid === null || Boolean((ctx.fiber as unknown as { _error?: unknown })._error)) withdraw()
    }
    setTimeout(settle, 0)
  })
  // The marker above is registered through `releaseMarker` so that Cordis 4.0.5
  // (which unloads effects concurrently, not in LIFO order) can withdraw the
  // selection before restoring Workspace, including when the replacement apply
  // fails. Registering it twice would collide at <Loader>.
  // Includes may add the official row after the replacement has activated,
  // and an external actor may re-enable a disabled official entry; both
  // re-enter the election here.
  ctx.on('internal/status', fiber => {
    if (fiber === ctx.fiber && !released) {
      void reconcile().catch(error => ctx.logger.warn(error))
    }
  })
  ctx.on('internal/plugin', fiber => {
    if (fiber.uid && fiber.entry?.options.name === OFFICIAL_WORKSPACE) {
      void reconcile().catch(error => ctx.logger.warn(error))
    }
  })
  // Local adaptation: the first pass settles before activation returns so the
  // Sidebar topology reports a truthful outcome. The opt-in gate above makes
  // this a no-op by default on legacy hosts (modern hosts auto-enable), and
  // every Loader operation is ceiling-bounded.
  await reconcile()
  // Report the real outcome: takeover is claimed only when every owned
  // official entry is actually disabled (a committed plain boolean, so this
  // read cannot race a service-activation state). Claiming a takeover
  // otherwise would make the Web client replay the official apply and crash
  // with `service "uiWorkspace" has been registered` (2026-10-11 incident).
  // The decorate branch is the safe coexistence path whenever the official
  // provider survived, including a disable that has not settled yet.
  const owned = official()
  let takeover = owned.length > 0 && !selfDisabled()
  for (const entry of owned) {
    if (inFlight.has(entry.id)) continue
    try {
      if (!entry.disabled) { takeover = false; break }
    } catch {
      takeover = false
      break
    }
  }
  if (!takeover) {
    ctx.logger.warn('dsh-git-worktree: the official Workspace entry could not be disabled through Loader operations; falling back to decorated coexistence.')
  }
  return { officialWorkspaceActive: !takeover }
}
