// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'

type MockAction = {
  update: () => void
  destroy: () => void
}

vi.mock('svelte-dnd-action', () => {
  const noop = (): void => undefined
  const action = (): MockAction => ({
    update: noop,
    destroy: noop
  })

  return {
    dragHandle: action,
    dragHandleZone: action
  }
})

vi.mock('../gsap-motion', () => {
  const noop = (): void => undefined

  return {
    animateProgress: () => ({
      update: noop,
      destroy: noop
    })
  }
})

import AccountsListView from '../AccountsListView.svelte'
import { messages } from '../app-view'

const copy = messages['zh-CN']

const accounts = [
  {
    id: 'acct-1',
    email: 'tagged@example.com',
    tagIds: ['tag-1'],
    createdAt: '2026-04-21T00:00:00.000Z',
    updatedAt: '2026-04-21T00:00:00.000Z'
  },
  {
    id: 'acct-2',
    email: 'untagged@example.com',
    tagIds: [],
    createdAt: '2026-04-21T00:00:00.000Z',
    updatedAt: '2026-04-21T00:00:00.000Z'
  }
]

const tags = [
  {
    id: 'tag-1',
    name: '重点',
    createdAt: '2026-04-21T00:00:00.000Z',
    updatedAt: '2026-04-21T00:00:00.000Z'
  }
]

function renderAccountsListView(
  overrideProps: Record<string, unknown> = {}
): ReturnType<typeof render> {
  return render(AccountsListView, {
    props: {
      iconRowButton: 'icon',
      copy,
      language: 'zh-CN',
      accounts,
      tags,
      activeAccountId: 'acct-1',
      usageByAccountId: {},
      usageLoadingByAccountId: {},
      usageErrorByAccountId: {},
      wakeSchedulesByAccountId: {},
      loginActionBusy: false,
      tagMutationBusy: false,
      openingAccountId: '',
      openingIsolatedAccountId: '',
      wakingAccountId: '',
      openAccountInCodex: vi.fn(),
      openAccountInIsolatedCodex: vi.fn(),
      openWakeDialog: vi.fn(),
      reorderAccounts: vi.fn().mockResolvedValue(undefined),
      updateAccountTags: vi.fn().mockResolvedValue(undefined),
      refreshAccountUsage: vi.fn(),
      removeAccount: vi.fn(),
      removeAccounts: vi.fn().mockResolvedValue(undefined),
      exportSelectedAccounts: vi.fn().mockResolvedValue(undefined),
      ...overrideProps
    }
  })
}

describe('AccountsListView', () => {
  it('filters visible accounts by tag chip', async () => {
    renderAccountsListView()

    await fireEvent.click(screen.getByRole('button', { name: copy.showFiltersAndBulkActions }))
    await fireEvent.click(screen.getByRole('button', { name: '重点 · 1' }))

    expect(screen.getByText('tagged@example.com')).toBeTruthy()
    expect(screen.queryByText('untagged@example.com')).toBeNull()
  })

  it('exports the currently selected visible accounts', async () => {
    const exportSelectedAccounts = vi.fn().mockResolvedValue(undefined)

    renderAccountsListView({
      exportSelectedAccounts
    })

    await fireEvent.click(screen.getByRole('button', { name: copy.showFiltersAndBulkActions }))
    await fireEvent.click(screen.getByRole('button', { name: '重点 · 1' }))
    await fireEvent.click(screen.getByRole('button', { name: copy.selectAllVisibleAccounts }))
    await fireEvent.click(screen.getByRole('button', { name: copy.exportSelectedAccounts }))

    expect(exportSelectedAccounts).toHaveBeenCalledWith(['acct-1'])
  })
})
