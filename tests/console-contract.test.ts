import { describe, expect, test } from 'vitest'
import {
  consoleStateFromDomain,
  worktreeConsoleErrorMeta,
  worktreeReachedDelivery,
  type WorktreeConsoleFinalizeRequest,
  type WorktreeConsoleProjectionSource,
} from '../src/console-contract.js'
import { createWorktreeConsoleAdapterFixture } from './support/worktree-console.js'

function source(overrides: Partial<WorktreeConsoleProjectionSource> = {}): WorktreeConsoleProjectionSource {
  return {
    kind: 'isolated',
    phase: 'ready',
    deliveryState: 'working',
    ...overrides,
  }
}

describe('Worktree Console shared contract', () => {
  test('projects one stable Console state from Local, lifecycle phase, and delivery facts', () => {
    expect(consoleStateFromDomain(source({ kind: 'local', deliveryState: undefined }))).toBe('local')
    expect(consoleStateFromDomain(source({ phase: 'preparing' }))).toBe('creating')
    expect(consoleStateFromDomain(source({ deliveryState: 'working' }))).toBe('working')
    expect(consoleStateFromDomain(source({ deliveryState: 'ready_for_review' }))).toBe('ready_for_review')
    expect(consoleStateFromDomain(source({ deliveryState: 'retained' }))).toBe('retained')
    expect(consoleStateFromDomain(source({ deliveryState: 'finalized' }))).toBe('cleanup_pending')
    expect(consoleStateFromDomain(source({ deliveryState: 'delivered' }))).toBe('delivered')
    // A discarded record keeps the delivery label it had before the discard, so
    // only `delivered` may survive it; everything else is an abandoned Worktree.
    expect(consoleStateFromDomain(source({ phase: 'discarded', deliveryState: 'working' }))).toBe('discarded')
    expect(consoleStateFromDomain(source({ phase: 'discarded', deliveryState: 'retained' }))).toBe('discarded')
    expect(consoleStateFromDomain(source({ phase: 'discarded', deliveryState: 'delivered' }))).toBe('delivered')
    expect(consoleStateFromDomain(source({
      phase: 'recovery_required',
      deliveryState: 'ready_for_review',
    }))).toBe('recovery_required')
  })

  test('treats every post-delivery state as completed for sidebar labels', () => {
    expect(worktreeReachedDelivery('ready', 'delivered')).toBe(true)
    expect(worktreeReachedDelivery('ready', 'finalized')).toBe(true)
    expect(worktreeReachedDelivery('ready', 'retained')).toBe(true)
    expect(worktreeReachedDelivery('finalized', 'finalized')).toBe(true)
    expect(worktreeReachedDelivery('retained', 'retained')).toBe(true)
    // 真交付+清理完成会落成 phase discarded + delivery delivered：完成，不是「已放弃」。
    expect(worktreeReachedDelivery('discarded', 'delivered')).toBe(true)
    // 真放弃保留放弃前的前态，仍按「已放弃」显示。
    expect(worktreeReachedDelivery('discarded', 'working')).toBe(false)
    expect(worktreeReachedDelivery('ready', 'preview_active')).toBe(false)
    expect(worktreeReachedDelivery('recovery_required', 'ready_for_review')).toBe(false)
  })

  test('maps stable domain and transport errors to one client recovery policy', () => {
    expect(worktreeConsoleErrorMeta('not_owner')).toEqual({
      category: 'permission',
      recovery: 'none',
      retryable: false,
    })
    expect(worktreeConsoleErrorMeta('stale_target')).toEqual({
      category: 'stale',
      recovery: 'refresh',
      retryable: true,
    })
    expect(worktreeConsoleErrorMeta('dirty_confirmation_required')).toEqual({
      category: 'confirmation',
      recovery: 'confirm_dirty',
      retryable: true,
    })
    expect(worktreeConsoleErrorMeta('transport_unavailable')).toEqual({
      category: 'unavailable',
      recovery: 'retry',
      retryable: true,
    })
  })

  test('provides one reusable adapter fixture that records exact review-bound mutations', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const request: WorktreeConsoleFinalizeRequest = {
      sessionId: 'target-session',
      checkoutId: 'checkout-1',
      expectedRevision: 7,
      expectedReviewId: 'review-1',
      commitMessage: 'fix: exact reviewed message',
      retention: 'cleanup',
    }

    const current = await fixture.adapter.current({ sessionId: 'target-session' })
    const finalized = await fixture.adapter.finalize(request)

    expect(current).toMatchObject({ ok: true, value: { target: { state: 'ready_for_review' } } })
    expect(finalized).toMatchObject({ ok: true, value: { target: { state: 'delivered' } } })
    expect(fixture.calls).toEqual([
      { method: 'current', request: { sessionId: 'target-session' } },
      { method: 'finalize', request },
    ])
  })
})
