import { describe, expect, test, vi } from 'vitest'
import { registerTools } from '../src/tools.js'
import { registerWorktreeCommand } from '../src/commands.js'
import type { SessionCheckoutModule } from '../src/index.js'
import type { SessionTargetView } from '../src/types.js'

const readyTarget: SessionTargetView = {
  project: { id: 'project-1', name: 'Project' },
  checkout: { id: 'checkout-1', kind: 'isolated', label: 'Isolated Checkout', phase: 'ready' },
  source: { ref: 'refs/heads/main', oid: 'a'.repeat(40) },
  current: { branch: null, oid: 'b'.repeat(40) },
  ownership: 'owner',
  dirty: true,
  revision: 7,
  delivery: {
    state: 'ready_for_review',
    review: {
      reviewId: 'review-1',
      iteration: 1,
      preparedAt: 1,
      summary: 'summary',
      validationStatus: 'passed',
      tests: [],
      changedFiles: ['src/index.ts'],
      suggestedCommitMessage: 'fix: exact reviewed message',
    },
  },
}

describe('public surfaces', () => {
  test('model tools expose creation, scoped listing, same-session iteration, delivery, and a schema-valid Ready for Review result', () => {
    const tools: Array<{
      name: string
      output?: { schema?: { properties?: Record<string, { type?: string; required?: boolean }> } }
    }> = []
    const ctx = { tools: { register: (tool: (typeof tools)[number]) => { tools.push(tool) } } }
    registerTools(ctx as never, {} as SessionCheckoutModule, {} as never)

    expect(tools.map(tool => tool.name)).toEqual([
      'worktree_create',
      'worktree_list',
      'worktree_begin_next_iteration',
      'worktree_deliver',
      'worktree_cleanup',
      'worktree_force_cleanup',
      'worktree_switch_branch',
      'worktree_return_to_local',
      'worktree_prune_branches',
      'worktree_merge',
    ])
  })

  test('a refused branch switch hands the model the reason and the affected files', async () => {
    const tools: Array<{ name: string; execute: (args: unknown, exec: unknown) => Promise<unknown> }> = []
    const branches = {
      // 覆盖型拒绝：模型必须先提交再切，所以 paths 与 nextAction 必须原样带回去。
      gitSwitchBranch: vi.fn(async () => ({
        ok: false as const,
        error: {
          code: 'git_operation_failed',
          message: 'git switch failed',
          switchIssue: { code: 'tracked-changes-would-be-overwritten', paths: ['src/index.ts'], detail: 'error: Your local changes' },
        },
      })),
      gitCreateBranchAndSwitch: vi.fn(),
    }
    registerTools({ tools: { register: (tool: typeof tools[number]) => { tools.push(tool) } } } as never, {} as SessionCheckoutModule, branches as never)
    const tool = tools.find(candidate => candidate.name === 'worktree_switch_branch')
    if (!tool) throw new Error('switch tool was not registered')

    const result = await tool.execute({ branch: 'main' }, { agent: { session: { id: 'target-session' } } }) as unknown as Record<string, unknown>

    expect(branches.gitSwitchBranch).toHaveBeenCalledWith('target-session', 'main')
    expect(result).toMatchObject({
      kind: 'worktree_branch_switch_blocked',
      branch: 'main',
      created: false,
      code: 'tracked-changes-would-be-overwritten',
      paths: ['src/index.ts'],
    })
    expect(typeof result.nextAction).toBe('string')
  })

  test('return to local releases a delivered checkout through the shared cwd-moving path', async () => {
    const tools: Array<{ name: string; execute: (args: unknown, exec: unknown) => Promise<unknown> }> = []
    const control = {
      gitSwitchBranch: vi.fn(),
      gitCreateBranchAndSwitch: vi.fn(),
      returnToLocal: vi.fn(async () => ({ ok: true as const, value: { target: { currentBranch: 'main' } } })),
    }
    const module = {
      inspect: vi.fn(async () => ({ checkout: { id: 'checkout-1', kind: 'isolated', label: 'Task', phase: 'retained' } })),
    }
    registerTools({ tools: { register: (tool: typeof tools[number]) => { tools.push(tool) } } } as never, module as never, control as never)
    const tool = tools.find(candidate => candidate.name === 'worktree_return_to_local')
    if (!tool) throw new Error('return-to-local tool was not registered')

    const result = await tool.execute({}, { agent: { session: { id: 'target-session' } } }) as unknown as Record<string, unknown>

    expect(control.returnToLocal).toHaveBeenCalledTimes(1)
    const [request, leave] = control.returnToLocal.mock.calls[0] as unknown as [
      Record<string, unknown>,
      (sessionId: string, managedRoot: string, localRoot: string) => Promise<void>,
    ]
    expect(request).toEqual({ sessionId: 'target-session', checkoutId: 'checkout-1' })
    // 只解绑不移出，模型拿到的是一个「看起来成功了」的假 Local。
    expect(typeof leave).toBe('function')
    await leave('target-session', '/managed', '/local')
    expect(result).toMatchObject({ kind: 'worktree_returned_to_local', state: 'local', branch: 'main' })
  })

  test('return to local reports the real location without unbinding when the session is already on Local', async () => {
    const tools: Array<{ name: string; execute: (args: unknown, exec: unknown) => Promise<unknown> }> = []
    const control = { gitSwitchBranch: vi.fn(), gitCreateBranchAndSwitch: vi.fn(), returnToLocal: vi.fn() }
    const module = { inspect: vi.fn(async () => ({ checkout: { id: 'local', kind: 'local', label: 'Local', phase: 'ready' } })) }
    registerTools({ tools: { register: (tool: typeof tools[number]) => { tools.push(tool) } } } as never, module as never, control as never)
    const tool = tools.find(candidate => candidate.name === 'worktree_return_to_local')
    if (!tool) throw new Error('return-to-local tool was not registered')

    const result = await tool.execute({}, { agent: { session: { id: 'target-session' } } }) as unknown as Record<string, unknown>

    expect(control.returnToLocal).not.toHaveBeenCalled()
    expect(result).toMatchObject({ kind: 'worktree_returned_to_local', state: 'local' })
  })

  test('list output never carries a key whose value is undefined (the host rejects that as not lossless JSON)', async () => {
    const tools: Array<{ name: string; execute: (args: unknown, exec: unknown) => Promise<unknown> }> = []
    const module = {
      listManagedWorktreesForSession: vi.fn(async () => [
        // The uncommitted case: commitOid is null, which `?? undefined` used to
        // turn into a present-but-empty key and kill the tool on a real host.
        {
          checkoutId: 'checkout-1', project: { id: 'project-1', name: 'Project' },
          ownerSessionId: 'target-session', iteration: 1, revision: 2,
          state: 'ready', phase: 'ready', dirty: true, commitOid: null,
          branch: 'feat/sess-target-session--task',
        },
      ]),
    } as unknown as SessionCheckoutModule
    registerTools({ tools: { register: (tool: typeof tools[number]) => { tools.push(tool) } } } as never, module, {} as never)
    const tool = tools.find(candidate => candidate.name === 'worktree_list')
    if (!tool) throw new Error('list tool was not registered')

    const result = await tool.execute({}, { agent: { session: { id: 'target-session' } } }) as unknown as {
      worktrees: Array<Record<string, unknown>>
    }

    expect(result.worktrees[0]).not.toHaveProperty('commitOid')
    // 模型要靠 branch 才知道这棵树的工作落在哪条分支上。
    expect(result.worktrees[0].branch).toBe('feat/sess-target-session--task')
    const undefinedKeys = (value: unknown, path = ''): string[] => {
      if (Array.isArray(value)) return value.flatMap((item, index) => undefinedKeys(item, `${path}[${index}]`))
      if (value === null || typeof value !== 'object') return []
      return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) =>
        item === undefined ? [`${path}.${key}`] : undefinedKeys(item, `${path}.${key}`))
    }
    expect(undefinedKeys(result)).toEqual([])
  })

  test('next-iteration model tool keeps the current Session and uses the latest delivered revision', async () => {
    const tools: Array<{ name: string; execute: (args: unknown, exec: unknown) => Promise<unknown> }> = []
    const delivered: SessionTargetView = {
      ...readyTarget,
      checkout: { ...readyTarget.checkout, phase: 'discarded' },
      dirty: false,
      revision: 9,
      delivery: { state: 'delivered', iteration: 1, commitOid: 'c'.repeat(40), deliveredAt: 2 },
    }
    const next: SessionTargetView = {
      ...readyTarget,
      checkout: { ...readyTarget.checkout, id: 'checkout-2' },
      dirty: false,
      revision: 11,
      delivery: { state: 'working', iteration: 2 },
    }
    const module = {
      inspect: vi.fn(async () => delivered),
      beginNextIteration: vi.fn(async () => next),
    } as unknown as SessionCheckoutModule
    registerTools({ tools: { register: (tool: typeof tools[number]) => { tools.push(tool) } } } as never, module, {} as never)
    const tool = tools.find(candidate => candidate.name === 'worktree_begin_next_iteration')
    if (!tool) throw new Error('next iteration tool was not registered')

    const result = await tool.execute({}, { agent: { session: { id: 'target-session' } } })

    expect(module.beginNextIteration).toHaveBeenCalledWith('target-session', 9)
    expect(result).toMatchObject({
      kind: 'worktree_next_iteration_started', checkoutId: 'checkout-2', iteration: 2, sessionId: 'target-session',
    })
  })

  test('/worktree next starts the next iteration through the same Session revision', async () => {
    let command: { name: string; handler: (invocation: unknown) => Promise<unknown> } | undefined
    const delivered: SessionTargetView = {
      ...readyTarget,
      checkout: { ...readyTarget.checkout, phase: 'discarded' },
      revision: 9,
      delivery: { state: 'delivered', iteration: 1, commitOid: 'c'.repeat(40), deliveredAt: 2 },
    }
    const next: SessionTargetView = {
      ...readyTarget,
      checkout: { ...readyTarget.checkout, id: 'checkout-2' },
      revision: 11,
      delivery: { state: 'working', iteration: 2 },
    }
    const module = {
      inspect: vi.fn(async () => delivered),
      beginNextIteration: vi.fn(async () => next),
    } as unknown as SessionCheckoutModule
    registerWorktreeCommand({ commands: { register: (value: typeof command) => { command = value } } } as never, module)
    if (!command) throw new Error('command was not registered')

    const result = await command.handler({ rawInput: 'next', agent: { session: { id: 'target-session' } } })

    expect(result).toMatchObject({ kind: 'success', text: expect.stringContaining('Worktree 第 2 轮') })
    expect(module.beginNextIteration).toHaveBeenCalledWith('target-session', 9)
  })

  test('deliver model tool finishes the delivery in place with auto-push passthrough', async () => {
    const tools: Array<{ name: string; execute: (args: unknown, exec: unknown) => Promise<unknown> }> = []
    const working: SessionTargetView = { ...readyTarget, revision: 8, delivery: { state: 'working', iteration: 1 } }
    const delivered: SessionTargetView = {
      ...working,
      dirty: false,
      delivery: { state: 'delivered', iteration: 1, commitOid: 'c'.repeat(40), deliveredAt: 2 },
    }
    const operate = vi.fn(async () => ({
      status: 'finished' as const,
      target: delivered,
      changedFiles: ['src/index.ts'],
      commitOid: 'c'.repeat(40),
      cleanup: 'cleanup' as const,
      push: { status: 'pushed' as const },
    }))
    const module = { inspect: vi.fn(async () => working), operate, isAutoDeliverEnabled: () => true } as unknown as SessionCheckoutModule
    registerTools({ tools: { register: (tool: typeof tools[number]) => { tools.push(tool) } } } as never, module, {} as never)
    const tool = tools.find(candidate => candidate.name === 'worktree_deliver')
    if (!tool) throw new Error('deliver tool was not registered')

    const result = await tool.execute(
      { commitMessage: 'feat: done', retention: 'retain_24h', report: 'all green' },
      { agent: { session: { id: 'target-session' } } },
    )

    expect(operate).toHaveBeenCalledWith({
      sessionId: 'target-session',
      expectedRevision: 8,
      action: 'finish',
      commitMessage: 'feat: done',
      retention: 'retain_24h',
    })
    expect(result).toMatchObject({
      kind: 'worktree_delivered',
      state: 'delivered',
      commitOid: 'c'.repeat(40),
      cleanup: 'cleanup',
      push: { status: 'pushed' },
      report: 'all green',
    })
  })

  test('deliver model tool defaults the commit message from the review and pins the review id', async () => {
    const tools: Array<{ name: string; execute: (args: unknown, exec: unknown) => Promise<unknown> }> = []
    const operate = vi.fn(async () => ({
      status: 'finished' as const,
      target: readyTarget,
      changedFiles: ['src/index.ts'],
      commitOid: 'c'.repeat(40),
      cleanup: 'cleanup' as const,
    }))
    const module = { inspect: vi.fn(async () => readyTarget), operate, isAutoDeliverEnabled: () => true } as unknown as SessionCheckoutModule
    registerTools({ tools: { register: (tool: typeof tools[number]) => { tools.push(tool) } } } as never, module, {} as never)
    const tool = tools.find(candidate => candidate.name === 'worktree_deliver')
    if (!tool) throw new Error('deliver tool was not registered')

    const result = await tool.execute({}, { agent: { session: { id: 'target-session' } } })

    expect(operate).toHaveBeenCalledWith({
      sessionId: 'target-session',
      expectedRevision: 7,
      action: 'finish',
      commitMessage: 'fix: exact reviewed message',
      retention: 'retain_manual',
      expectedReviewId: 'review-1',
    })
    expect(result).toMatchObject({ kind: 'worktree_delivered', state: 'ready_for_review' })
  })

  test('create moves this Session cwd into the checkout and reports it (official create_worktree parity)', async () => {
    const tools: Array<{ name: string; execute: (args: unknown, exec: unknown) => Promise<unknown> }> = []
    const set = vi.fn(async (_agent: unknown, path: string) => path)
    const module = {
      createOfficialTarget: vi.fn(async () => ({
        targetSessionId: 'session-abc',
        managedRoot: 'C:/repo/wt/topic-20261018',
        target: { checkout: { id: 'checkout-9', phase: 'ready' }, current: { oid: 'c'.repeat(40) } },
      })),
      resolveManagedRoot: vi.fn(async () => 'C:/repo/wt/topic-20261018'),
    } as unknown as SessionCheckoutModule
    registerTools({
      get: (name: string) => (name === 'workingDirectory' ? { get: () => 'C:/repo', set } : undefined),
      tools: { register: (tool: typeof tools[number]) => { tools.push(tool) } },
    } as never, module)
    const tool = tools.find(candidate => candidate.name === 'worktree_create')
    if (!tool) throw new Error('create tool was not registered')

    const result = await tool.execute({}, { agent: { session: { id: 'session-abc' } } }) as Record<string, unknown>

    expect(set).toHaveBeenCalledWith(expect.anything(), 'C:/repo/wt/topic-20261018')
    expect(result.cwdSelected).toBe(true)
    expect(result.cwd).toBe('C:/repo/wt/topic-20261018')
  })

  test('create without a workingDirectory service reports cwdSelected:false instead of a fake cwd', async () => {
    const tools: Array<{ name: string; execute: (args: unknown, exec: unknown) => Promise<unknown> }> = []
    const module = {
      createOfficialTarget: vi.fn(async () => ({
        targetSessionId: 'session-abc',
        managedRoot: 'C:/repo/wt/topic-20261018',
        target: { checkout: { id: 'checkout-9', phase: 'ready' }, current: { oid: 'c'.repeat(40) } },
      })),
      resolveManagedRoot: vi.fn(async () => 'C:/repo/wt/topic-20261018'),
    } as unknown as SessionCheckoutModule
    registerTools({
      get: () => undefined,
      tools: { register: (tool: typeof tools[number]) => { tools.push(tool) } },
    } as never, module)
    const tool = tools.find(candidate => candidate.name === 'worktree_create')
    if (!tool) throw new Error('create tool was not registered')

    const result = await tool.execute({}, { agent: { session: { id: 'session-abc' } } }) as Record<string, unknown>

    expect(result.cwdSelected).toBe(false)
    expect(result.cwd).toBeUndefined()
  })

  test('cleanup aborts instead of deleting the checkout when the Session cwd cannot be moved out first', async () => {
    const tools: Array<{ name: string; execute: (args: unknown, exec: unknown) => Promise<unknown> }> = []
    const cleanup = vi.fn()
    const set = vi.fn(async () => { throw new Error('cwd is locked by the sandbox') })
    const module = {
      resolveRoots: vi.fn(() => ({ managedRoot: 'C:/repo/wt/topic-20261018', localRoot: 'C:/repo' })),
      manageManagedWorktreeForSession: cleanup,
    } as unknown as SessionCheckoutModule
    registerTools({
      get: (name: string) => (name === 'workingDirectory'
        // The Session IS standing in the checkout, but the move back fails.
        ? { get: () => 'C:/repo/wt/topic-20261018/sub', set }
        : undefined),
      tools: { register: (tool: typeof tools[number]) => { tools.push(tool) } },
    } as never, module)
    const tool = tools.find(candidate => candidate.name === 'worktree_cleanup')
    if (!tool) throw new Error('cleanup tool was not registered')

    // The reason is surfaced (locale-independent: it is the raw service error)
    // and, crucially, the removal never ran.
    await expect(tool.execute({ checkoutId: 'checkout-9', expectedRevision: 3 }, { agent: { session: { id: 'session-abc' } } }))
      .rejects.toThrow(/cwd is locked by the sandbox/)
    expect(cleanup).not.toHaveBeenCalled()
  })

  test('force cleanup forwards mode and confirm and reports the quarantine path', async () => {
    const tools: Array<{ name: string; execute: (args: unknown, exec: unknown) => Promise<unknown> }> = []
    const forceCleanup = vi.fn(async () => ({
      kind: 'worktree_force_cleanup',
      checkoutId: 'checkout-9',
      mode: 'quarantine' as const,
      quarantinedPath: 'C:/repo/wt/.dsh-wt-quarantine--checkout--1',
      revision: 4,
    }))
    const module = {
      resolveRoots: vi.fn(() => ({ managedRoot: 'C:/repo/wt/topic-20261112', localRoot: 'C:/repo' })),
      forceCleanupManagedWorktree: forceCleanup,
    } as unknown as SessionCheckoutModule
    registerTools({
      get: (name: string) => (name === 'workingDirectory' ? { get: () => 'C:/repo', set: vi.fn() } : undefined),
      tools: { register: (tool: typeof tools[number]) => { tools.push(tool) } },
    } as never, module)
    const tool = tools.find(candidate => candidate.name === 'worktree_force_cleanup')
    if (!tool) throw new Error('force cleanup tool was not registered')

    const result = await tool.execute(
      { checkoutId: 'checkout-9', expectedRevision: 3, mode: 'discard', confirm: 'checkout-9' },
      { agent: { session: { id: 'session-abc' } } },
    )
    expect(forceCleanup).toHaveBeenCalledWith('session-abc', expect.objectContaining({
      checkoutId: 'checkout-9',
      expectedRevision: 3,
      mode: 'discard',
      confirm: 'checkout-9',
    }))
    expect(result).toMatchObject({ mode: 'quarantine', quarantinedPath: 'C:/repo/wt/.dsh-wt-quarantine--checkout--1' })
  })

  test('create forwards linkDeps and returns the link outcome', async () => {
    const tools: Array<{ name: string; execute: (args: unknown, exec: unknown) => Promise<unknown> }> = []
    const module = {
      createOfficialTarget: vi.fn(async () => ({
        targetSessionId: 'session-abc',
        managedRoot: 'C:/repo/wt/topic-20261112',
        target: { ...readyTarget, checkout: { ...readyTarget.checkout, phase: 'working' as const }, delivery: { state: 'working' as const, iteration: 1 } },
        linkResult: { linked: ['app/node_modules'], failures: [{ path: 'api/node_modules', reason: 'already exists in the Worktree' }] },
      })),
    }
    registerTools({ tools: { register: (tool: typeof tools[number]) => { tools.push(tool) } } } as never, module as never)
    const tool = tools.find(candidate => candidate.name === 'worktree_create')
    if (!tool) throw new Error('create tool was not registered')

    const result = await tool.execute(
      { topic: 'topic', linkDeps: ['app/node_modules', 'api/node_modules'] },
      { agent: { session: { id: 'session-abc' } } },
    ) as Record<string, unknown>

    expect(module.createOfficialTarget).toHaveBeenCalledWith(expect.anything(), {
      topic: 'topic',
      linkDeps: ['app/node_modules', 'api/node_modules'],
    })
    expect(result.linkedDeps).toEqual(['app/node_modules'])
    expect(result.linkFailures).toEqual([{ path: 'api/node_modules', reason: 'already exists in the Worktree' }])
  })

  test('next iteration forwards linkDeps and returns the link outcome', async () => {
    const tools: Array<{ name: string; execute: (args: unknown, exec: unknown) => Promise<unknown> }> = []
    const delivered: SessionTargetView = {
      ...readyTarget,
      checkout: { ...readyTarget.checkout, phase: 'discarded' },
      revision: 9,
      delivery: { state: 'delivered', iteration: 1, commitOid: 'c'.repeat(40), deliveredAt: 2 },
    }
    const next = {
      ...readyTarget,
      checkout: { ...readyTarget.checkout, phase: 'working' as const },
      revision: 10,
      delivery: { state: 'working' as const, iteration: 2 },
      linkResult: { linked: ['app/node_modules'], failures: [] },
    }
    const module = {
      inspect: vi.fn(async () => delivered),
      beginNextIteration: vi.fn(async () => next),
    }
    registerTools({ tools: { register: (tool: typeof tools[number]) => { tools.push(tool) } } } as never, module as never)
    const tool = tools.find(candidate => candidate.name === 'worktree_begin_next_iteration')
    if (!tool) throw new Error('next-iteration tool was not registered')

    const result = await tool.execute({ linkDeps: ['app/node_modules'] }, { agent: { session: { id: 'target-session' } } }) as Record<string, unknown>

    expect(module.beginNextIteration).toHaveBeenCalledWith('target-session', 9, ['app/node_modules'])
    expect(result.linkedDeps).toEqual(['app/node_modules'])
  })

  test('deliver forwards preservePaths and reports preserved and dropped paths', async () => {
    const tools: Array<{ name: string; execute: (args: unknown, exec: unknown) => Promise<unknown> }> = []
    const working: SessionTargetView = {
      ...readyTarget,
      checkout: { ...readyTarget.checkout, phase: 'working' },
      revision: 8,
      delivery: { state: 'working', iteration: 1 },
    }
    const operate = vi.fn(async () => ({
      status: 'finished' as const,
      target: readyTarget,
      changedFiles: ['src/index.ts'],
      preservedFiles: ['changelogs/1.2.3.md'],
      droppedIgnoredFiles: ['dist'],
      commitOid: 'c'.repeat(40),
      cleanup: 'discarded' as const,
    }))
    const module = { inspect: vi.fn(async () => working), operate, isAutoDeliverEnabled: () => true }
    registerTools({ tools: { register: (tool: typeof tools[number]) => { tools.push(tool) } } } as never, module as never)
    const tool = tools.find(candidate => candidate.name === 'worktree_deliver')
    if (!tool) throw new Error('deliver tool was not registered')

    const result = await tool.execute(
      { commitMessage: 'feat: done', preservePaths: ['changelogs/1.2.3.md'] },
      { agent: { session: { id: 'target-session' } } },
    ) as Record<string, unknown>

    expect(operate).toHaveBeenCalledWith(expect.objectContaining({ preservePaths: ['changelogs/1.2.3.md'] }))
    expect(result.preservedFiles).toEqual(['changelogs/1.2.3.md'])
    expect(result.droppedIgnoredFiles).toEqual(['dist'])
  })
})
