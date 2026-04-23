// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import type { AccountRateLimits } from '../../../../shared/codex'

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

function createUsage(overrides: Partial<AccountRateLimits> = {}): AccountRateLimits {
  return {
    limitId: 'codex',
    limitName: null,
    planType: 'plus',
    primary: {
      usedPercent: 40,
      windowDurationMins: 300,
      resetsAt: null
    },
    secondary: {
      usedPercent: 50,
      windowDurationMins: 10080,
      resetsAt: null
    },
    credits: null,
    limits: [],
    fetchedAt: '2026-04-21T00:00:00.000Z',
    ...overrides
  }
}

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

  it('shows full usage errors in a popover', async () => {
    renderAccountsListView({
      usageErrorByAccountId: {
        'acct-1': [
          'Rate-limit lookup failed: 429 Too Many Requests',
          'retry_after: 120s',
          'request_id: req_mock_quota_throttled'
        ].join('\n')
      }
    })

    expect(screen.queryByText('retry_after: 120s')).toBeNull()

    await fireEvent.click(
      screen.getByRole('button', { name: /Rate-limit lookup failed: 429 Too Many Requests/ })
    )

    expect(screen.getByText(/retry_after: 120s/)).toBeTruthy()
    expect(screen.getByText(/request_id: req_mock_quota_throttled/)).toBeTruthy()
  })

  it('hides 5h quota for free accounts and keeps weekly quota visible', () => {
    renderAccountsListView({
      accounts: [
        {
          id: 'free-1',
          email: 'free@example.com',
          tagIds: [],
          createdAt: '2026-04-21T00:00:00.000Z',
          updatedAt: '2026-04-21T00:00:00.000Z'
        }
      ],
      activeAccountId: 'free-1',
      usageByAccountId: {
        'free-1': createUsage({
          planType: 'free',
          primary: null,
          secondary: {
            usedPercent: 30,
            windowDurationMins: 10080,
            resetsAt: null
          }
        })
      }
    })

    expect(screen.queryByText(copy.sessionReset)).toBeNull()
    expect(screen.getByText(copy.weeklyReset)).toBeTruthy()
  })
})
