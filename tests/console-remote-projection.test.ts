import { describe, expect, it } from 'vitest'
import { WORKTREE_CONSOLE_DESCRIPTORS } from '../src/console-remote/descriptors.js'
import { projectDetails, projectRecord } from '../src/console-host/projection.js'
import type { ManagedCheckoutRecord } from '../src/ports.js'

/**
 * Host 投影与 Client strict schema 的一致性对拍。
 *
 * 两边是分开手写的：`src/console-host/projection.ts` 决定 Host 返回什么键，
 * `src/console-remote/schemas.ts` 用 `.strict()` 决定 Client 接受什么键。任何一边
 * 单方面加字段，整条 `current` 就会被判为「不符合 strict contract」，胶囊塌成
 * 「不可用」——而 Host 与 Client 同版本时也不会在类型检查里暴露，因为契约接口
 * 的字段是可选的，schema 漏的是运行时校验。
 *
 * 这里不手写期望值，而是拿真实投影的输出喂给真实 schema：新增状态或新增字段
 * 时，漏改任何一边都会让本文件失败。
 */

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)

function baseRecord(): ManagedCheckoutRecord {
  return {
    checkoutId: 'checkout-1', projectId: 'project-1', projectName: 'Project',
    ownerSessionId: 'owner-session', sourceSessionId: 'source-session',
    localRoot: '/local', managedRoot: '/managed', managedGitRoot: '/managed',
    gitCommonDir: '/git/common', gitDir: '/git/worktrees/one', baseOid: A,
    sourceRef: 'refs/heads/main', phase: 'ready', journal: null, revision: 7,
    delivery: {
      state: 'ready_for_review',
      review: {
        reviewId: 'review-1', iteration: 1, preparedAt: 1, summary: 'Ready',
        validationStatus: 'passed', tests: [], changedFiles: ['src/index.ts'],
        suggestedCommitMessage: 'fix: persisted review', isolatedFingerprint: 'fingerprint-1', isolatedHeadOid: B,
      },
    },
  } as ManagedCheckoutRecord
}

function reviewOf(record: ManagedCheckoutRecord) {
  if (record.delivery.state !== 'ready_for_review') throw new Error('fixture must start at ready_for_review')
  return record.delivery.review
}

/** Every delivery state the projection can emit, with the fields each one adds. */
const variants: Array<[string, () => ManagedCheckoutRecord]> = [
  ['ready_for_review', baseRecord],
  ['working', () => ({ ...baseRecord(), delivery: { state: 'working', iteration: 1 } }) as ManagedCheckoutRecord],
  ['preview_active', () => {
    const record = baseRecord()
    return { ...record, delivery: { state: 'preview_active', review: reviewOf(record), preview: { previewId: 'preview-1', appliedAt: 1 }, appliedAt: 1 } } as unknown as ManagedCheckoutRecord
  }],
  ['preview_detached', () => {
    const record = baseRecord()
    return {
      ...record,
      delivery: {
        state: 'preview_detached', review: reviewOf(record),
        preview: { previewId: 'preview-1', appliedAt: 1 }, previewedAt: 1,
        detachedAt: 2, reason: 'stale_local', attemptedAction: 'rollback_preview',
      },
    } as unknown as ManagedCheckoutRecord
  }],
  ['recovery_required', () => ({ ...baseRecord(), phase: 'recovery_required' }) as ManagedCheckoutRecord],
  ['finalized_blocked', () => {
    const record = baseRecord()
    return {
      ...record, phase: 'finalized',
      delivery: {
        state: 'finalized', review: reviewOf(record), commitOid: B, isolatedFingerprint: 'fingerprint-1',
        finalizedAt: 1, cleanup: 'blocked', cleanupMessage: 'blocked', cleanupMessageKey: 'cleanupIdentityChanged',
        cleanupReason: 'identity_changed',
      },
    } as unknown as ManagedCheckoutRecord
  }],
  ['retained_scheduled', () => {
    const record = baseRecord()
    return {
      ...record, phase: 'retained',
      delivery: {
        state: 'retained', review: reviewOf(record), commitOid: B, isolatedFingerprint: 'fingerprint-1',
        retention: 'retain_24h', retainedAt: 1, expiresAt: 2, cleanup: 'scheduled',
      },
    } as unknown as ManagedCheckoutRecord
  }],
  ['retained_blocked', () => {
    const record = baseRecord()
    return {
      ...record, phase: 'retained',
      delivery: {
        state: 'retained', review: reviewOf(record), commitOid: B, isolatedFingerprint: 'fingerprint-1',
        retention: 'retain_manual', retainedAt: 1, expiresAt: null,
        cleanup: 'blocked', cleanupMessage: 'blocked', cleanupReason: 'modified_after_finalize',
      },
    } as unknown as ManagedCheckoutRecord
  }],
  ['delivered', () => ({
    ...baseRecord(), phase: 'discarded',
    delivery: { state: 'delivered', iteration: 1, commitOid: B, deliveredAt: 5 },
  }) as ManagedCheckoutRecord],
  ['permanent_with_checkpoints', () => {
    const record = baseRecord()
    return {
      ...record, permanent: true,
      checkpoints: [{
        checkpointId: 'checkpoint-1', sequence: 1, reviewId: 'review-1', commitOid: B, parentOid: A,
        createdAt: 3, summary: 'checkpoint', validationStatus: 'passed', changedFiles: ['src/index.ts'],
      }],
    } as unknown as ManagedCheckoutRecord
  }],
  // 恢复续作是 details 独有的负载；它的四个 kind 各有不同键，漏收同样会让
  // current 被拒，而这条路径只在冲突恢复时才走到，最容易长期不被发现。
  ['recovery_continuation', () => {
    const record = baseRecord()
    return {
      ...record, phase: 'recovery_required',
      recoveryContinuation: {
        kind: 'worktree_apply_conflict',
        requestId: 'apply-conflict:checkout-1:review-1:7:' + A,
        reviewId: 'review-1',
        workingRevision: 8,
        localHeadOid: A,
        conflictingFiles: ['src/index.ts'],
      },
    } as unknown as ManagedCheckoutRecord
  }],
]

function strictSchema(method: string) {
  const descriptor = WORKTREE_CONSOLE_DESCRIPTORS.find(item => item.method === method)
  if (descriptor?.result.mode !== 'strict') throw new Error(`${method} must stay a strict result descriptor`)
  return descriptor.result.schema
}

function collectFailures(
  method: string,
  build: (record: ManagedCheckoutRecord) => unknown,
): string[] {
  const schema = strictSchema(method)
  const failures: string[] = []
  for (const [name, make] of variants) {
    const result = schema.safeParse(build(make()))
    if (!result.success) failures.push(`${name}: ${JSON.stringify(result.error.issues.slice(0, 3))}`)
  }
  return failures
}

describe('Host projection stays inside the Client strict contract', () => {
  it('current accepts every projected delivery state', () => {
    const failures = collectFailures('current', record => ({
      ok: true,
      value: {
        adoptionFailure: null,
        target: projectDetails(record, 'owner-session', record.managedRoot, { branch: 'main', headOid: B }, false, true, false),
      },
    }))
    expect(failures).toEqual([])
  })

  it('inspect accepts every projected delivery state', () => {
    const failures = collectFailures('inspect', record => ({
      ok: true,
      value: { target: projectDetails(record, 'owner-session', record.managedRoot, { branch: 'main', headOid: B }, false, true, false) },
    }))
    expect(failures).toEqual([])
  })

  it('list accepts every projected delivery state', () => {
    const failures = collectFailures('list', record => ({
      ok: true,
      value: {
        project: { id: record.projectId, name: record.projectName },
        worktrees: [projectRecord(record, 'owner-session', { ownerSessionAvailable: true })],
      },
    }))
    expect(failures).toEqual([])
  })

  it('mutations accept the summary they echo back', () => {
    const failures = collectFailures('deliver', record => ({
      ok: true,
      value: { target: projectRecord(record, 'owner-session', { ownerSessionAvailable: true }), changedFiles: ['src/index.ts'] },
    }))
    expect(failures).toEqual([])
  })

  it('carries the structured cleanup reason a blocked cleanup produces', () => {
    // 这条记录是本机上真实卡住的形态：finalized + cleanup blocked + identity_changed。
    // 投影一直输出 cleanupReason，schema 曾经漏收它，于是 current 整条被拒、胶囊
    // 显示「不可用」——合并后读不到 Local 分支就是这么暴露出来的。
    const schema = strictSchema('current')
    const record = variants.find(([name]) => name === 'finalized_blocked')![1]()
    const target = projectDetails(record, 'owner-session', record.managedRoot, { branch: 'main', headOid: B }, false, true, false)
    expect(target.cleanupReason).toBe('identity_changed')
    expect(schema.safeParse({ ok: true, value: { adoptionFailure: null, target } }).success).toBe(true)
  })
})
