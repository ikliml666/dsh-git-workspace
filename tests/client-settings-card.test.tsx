// @vitest-environment jsdom

import { ClientI18nProvider } from '../src/client/i18n.js'
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SettingsFormPathOp, SettingsFormScope, SettingsFormScopeSnapshot } from '../src/client/settings-card/form-model.js'
import { WorktreeSettingsCard } from '../src/client/settings-card/WorktreeSettingsCard.js'
import { WorktreeSettingsCardController, type WorktreeSettings } from '../src/client/settings-card/worktree-settings-card.js'

afterEach(cleanup)

type ScopeSnapshot = SettingsFormScopeSnapshot<WorktreeSettings>

function makeScope(
  overrides: Partial<ScopeSnapshot> = {},
  mutate: (ops: readonly SettingsFormPathOp[], expectedRevision?: number) => Promise<boolean> = async () => true,
): SettingsFormScope<WorktreeSettings> & { mutate: ReturnType<typeof vi.fn> } {
  const snapshot: ScopeSnapshot = {
    status: 'ready',
    value: { autoDeliver: true, autoPush: true },
    base: {},
    user: {},
    writable: true,
    revision: 7,
    ...overrides,
  }
  const mutateFn = vi.fn(mutate)
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    mutate: mutateFn,
  }
}

function renderCard(scope: SettingsFormScope<WorktreeSettings>, view?: string) {
  const controller = new WorktreeSettingsCardController(scope)
  const face = controller.inject()
  const entry = (
    <ClientI18nProvider language="en">
      <WorktreeSettingsCard {...face} view={view} />
    </ClientI18nProvider>
  )
  const mounted = render(entry)
  return { controller, mounted }
}

const saveButton = (): HTMLButtonElement => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement

test('renders the five settings rows and keeps save disabled until edited', () => {
  renderCard(makeScope())

  const switches = screen.getAllByRole('switch')
  expect(switches).toHaveLength(2)
  expect(screen.getByRole('switch', { name: 'Auto deliver' }).getAttribute('aria-checked')).toBe('true')
  expect(screen.getByRole('switch', { name: 'Auto push Local branch' }).getAttribute('aria-checked')).toBe('true')

  expect(screen.getByLabelText('Worktree root')).toBeTruthy()
  expect(screen.getByLabelText('Git command timeout (ms)')).toBeTruthy()
  expect(screen.getByLabelText('worktree add timeout (ms)')).toBeTruthy()

  expect(saveButton().disabled).toBe(true)
  expect((screen.getByRole('button', { name: 'Discard' }) as HTMLButtonElement).disabled).toBe(true)
})

test('stages a boolean edit and saves it fenced at the read revision', async () => {
  const scope = makeScope({}, async () => true)
  renderCard(scope)

  fireEvent.click(screen.getByRole('switch', { name: 'Auto deliver' }))
  expect(saveButton().disabled).toBe(false)

  fireEvent.click(saveButton())
  await waitFor(() => expect(scope.mutate).toHaveBeenCalledTimes(1))
  expect(scope.mutate).toHaveBeenCalledWith([{ op: 'set', path: ['autoDeliver'], value: false }], 7)

  await waitFor(() => expect(saveButton().disabled).toBe(true))
})

test('blocks the save while a numeric draft is invalid', () => {
  renderCard(makeScope())

  fireEvent.change(screen.getByLabelText('Git command timeout (ms)'), { target: { value: 'abc' } })

  expect(saveButton().disabled).toBe(true)
  expect(screen.getByText('Invalid value; the save is blocked.')).toBeTruthy()
})

test('summary view renders the one-liner only', () => {
  renderCard(makeScope(), 'summary')

  expect(screen.getByText('Delivery and push switches, the Worktree root, and Git timeouts.')).toBeTruthy()
  expect(screen.queryByRole('switch')).toBeNull()
})
