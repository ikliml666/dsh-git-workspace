import { useCallback, useEffect, useSyncExternalStore } from 'react'
import type {
  WorktreeConsoleAdapter,
  WorktreeConsoleError,
  WorktreeConsoleOutcome,
} from '../../console-contract.js'

/** One identity-keyed console read, published to React through `useSyncExternalStore`. */
export type RequestSnapshot<TPreflight> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; preflight: TPreflight }
  | { status: 'error'; error: WorktreeConsoleError }

interface Entry<TPreflight> {
  snapshot: RequestSnapshot<TPreflight>
  listeners: Set<() => void>
  promise?: Promise<RequestSnapshot<TPreflight>>
  generation: number
}

export interface RequestCache<TIdentity, TPreflight> {
  read(adapter: WorktreeConsoleAdapter, identity: TIdentity, force?: boolean): Promise<RequestSnapshot<TPreflight>>
  invalidate(adapter: WorktreeConsoleAdapter, identity: TIdentity): void
  useSnapshot(
    adapter: WorktreeConsoleAdapter | null | undefined,
    identity: TIdentity | undefined,
    enabled: boolean,
  ): { snapshot: RequestSnapshot<TPreflight>; refresh(): Promise<RequestSnapshot<TPreflight>> }
}

/**
 * ponytail: the one cache shape behind every identity-keyed console read. Entries live in a
 * per-adapter WeakMap, so a remounted client can never read another adapter's data, and the
 * identity string is the only sharing key. `read` is single-flight — a concurrent call joins
 * the in-flight promise instead of re-requesting — serves the last success/error until `force`
 * is passed, and publishes `loading` before the request goes out. `invalidate` bumps that
 * entry's generation, which is what keeps a response landing after invalidation from
 * republishing a stale snapshot or clearing a newer promise.
 */
export function createRequestCache<TIdentity, TPreflight>(options: {
  /** Stable identity string; two identities never share an entry. */
  key(identity: TIdentity): string
  /** The single adapter call this cache wraps; the response's `preflight` payload is what it publishes. */
  request(
    adapter: WorktreeConsoleAdapter,
    identity: TIdentity,
  ): Promise<WorktreeConsoleOutcome<{ preflight: TPreflight }>>
}): RequestCache<TIdentity, TPreflight> {
  const idle: RequestSnapshot<TPreflight> = { status: 'idle' }
  const caches = new WeakMap<WorktreeConsoleAdapter, Map<string, Entry<TPreflight>>>()

  function cacheFor(adapter: WorktreeConsoleAdapter): Map<string, Entry<TPreflight>> {
    let cache = caches.get(adapter)
    if (!cache) {
      cache = new Map()
      caches.set(adapter, cache)
    }
    return cache
  }

  function entryFor(adapter: WorktreeConsoleAdapter, identity: TIdentity): Entry<TPreflight> {
    const cache = cacheFor(adapter)
    const key = options.key(identity)
    let entry = cache.get(key)
    if (!entry) {
      entry = { snapshot: idle, listeners: new Set(), generation: 0 }
      cache.set(key, entry)
    }
    return entry
  }

  function publish(entry: Entry<TPreflight>, snapshot: RequestSnapshot<TPreflight>): void {
    entry.snapshot = snapshot
    for (const listener of entry.listeners) listener()
  }

  async function read(
    adapter: WorktreeConsoleAdapter,
    identity: TIdentity,
    force = false,
  ): Promise<RequestSnapshot<TPreflight>> {
    const entry = entryFor(adapter, identity)
    if (entry.promise) return entry.promise
    if (!force && (entry.snapshot.status === 'success' || entry.snapshot.status === 'error')) return entry.snapshot
    publish(entry, { status: 'loading' })
    const generation = entry.generation
    const promise: Promise<RequestSnapshot<TPreflight>> = options.request(adapter, identity).then(
      (outcome): RequestSnapshot<TPreflight> => {
        const snapshot: RequestSnapshot<TPreflight> = outcome.ok
          ? { status: 'success', preflight: outcome.value.preflight }
          : { status: 'error', error: outcome.error }
        if (entry.generation === generation) publish(entry, snapshot)
        return snapshot
      },
      (reason): RequestSnapshot<TPreflight> => {
        const snapshot: RequestSnapshot<TPreflight> = {
          status: 'error',
          error: { code: 'transport_unavailable', message: reason instanceof Error ? reason.message : String(reason) },
        }
        if (entry.generation === generation) publish(entry, snapshot)
        return snapshot
      },
    ).finally(() => {
      if (entry.generation === generation) entry.promise = undefined
    })
    entry.promise = promise
    return promise
  }

  function invalidate(adapter: WorktreeConsoleAdapter, identity: TIdentity): void {
    const entry = cacheFor(adapter).get(options.key(identity))
    if (!entry) return
    entry.generation += 1
    entry.promise = undefined
    publish(entry, idle)
  }

  function useSnapshot(
    adapter: WorktreeConsoleAdapter | null | undefined,
    identity: TIdentity | undefined,
    enabled: boolean,
  ): { snapshot: RequestSnapshot<TPreflight>; refresh(): Promise<RequestSnapshot<TPreflight>> } {
    const key = identity ? options.key(identity) : ''
    const subscribe = useCallback((listener: () => void) => {
      if (!adapter || !identity) return () => undefined
      const entry = entryFor(adapter, identity)
      entry.listeners.add(listener)
      return () => { entry.listeners.delete(listener) }
    }, [adapter, key])
    const getSnapshot = useCallback(() => {
      if (!adapter || !identity) return idle
      return entryFor(adapter, identity).snapshot
    }, [adapter, key])
    const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

    useEffect(() => {
      if (adapter && identity && enabled) void read(adapter, identity)
    }, [adapter, enabled, key])

    return {
      snapshot,
      refresh: useCallback(async () => {
        if (!adapter || !identity) return idle
        return read(adapter, identity, true)
      }, [adapter, key]),
    }
  }

  return { read, invalidate, useSnapshot }
}
