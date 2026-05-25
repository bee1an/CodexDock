import { describe, expect, it } from 'vitest'
import type { AccountRateLimits } from '../../../../../shared/codex'

import {
  accountFilterCount,
  accountGroupsForDisplay,
  availableGroupsForAccount,
  buildPersistedUsageSortOrder,
  eligibleAccountsForRefresh,
  filterChipLabel,
  filterAccountsBySearch,
  groupFilterLabel,
  groupMemberCount,
  normalizeSelectedAccountIds,
  sortAccountsByUsage,
  ungroupedFilterId,
  visibleAccountsForFilter
} from '../accounts-panel-account'
import { messages } from '$lib/view/app-view'

const copy = messages['zh-CN']

const accounts = [
  {
    id: 'acct-1',
    email: 'grouped@example.com',
    groupIds: ['group-1'],
    createdAt: '2026-04-21T00:00:00.000Z',
    updatedAt: '2026-04-21T00:00:00.000Z'
  },
  {
    id: 'acct-2',
    email: 'ungrouped@example.com',
    groupIds: [],
    createdAt: '2026-04-21T00:00:00.000Z',
    updatedAt: '2026-04-21T00:00:00.000Z'
  }
]

const groups = [
  {
    id: 'group-1',
    name: '重点',
    createdAt: '2026-04-21T00:00:00.000Z',
    updatedAt: '2026-04-21T00:00:00.000Z'
  },
  {
    id: 'group-2',
    name: '候选',
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
      usedPercent: 0,
      windowDurationMins: 300,
      resetsAt: null
    },
    secondary: {
      usedPercent: 0,
      windowDurationMins: 10080,
      resetsAt: null
    },
    credits: null,
    limits: [],
    fetchedAt: '2026-04-21T00:00:00.000Z',
    ...overrides
  }
}

describe('accounts panel account helpers', () => {
  it('filters grouped and ungrouped accounts correctly', () => {
    expect(visibleAccountsForFilter(accounts, 'all').map((account) => account.id)).toEqual([
      'acct-1',
      'acct-2'
    ])
    expect(
      visibleAccountsForFilter(accounts, ungroupedFilterId).map((account) => account.id)
    ).toEqual(['acct-2'])
    expect(visibleAccountsForFilter(accounts, 'group-1').map((account) => account.id)).toEqual([
      'acct-1'
    ])
  })

  it('honors orderedAccountIds for in-group sort', () => {
    const groupAccounts = [
      { ...accounts[0], id: 'acct-a', groupIds: ['group-3'] },
      { ...accounts[0], id: 'acct-b', groupIds: ['group-3'] },
      { ...accounts[0], id: 'acct-c', groupIds: ['group-3'] }
    ]
    const groupsWithOrder = [
      ...groups,
      {
        id: 'group-3',
        name: '排序',
        createdAt: '2026-04-21T00:00:00.000Z',
        updatedAt: '2026-04-21T00:00:00.000Z',
        orderedAccountIds: ['acct-c', 'acct-a']
      }
    ]
    expect(
      visibleAccountsForFilter(groupAccounts, 'group-3', groupsWithOrder).map((a) => a.id)
    ).toEqual(['acct-c', 'acct-a', 'acct-b'])
  })

  it('normalizes selected ids against the visible account set', () => {
    expect(
      normalizeSelectedAccountIds(
        ['acct-1', 'acct-3'],
        visibleAccountsForFilter(accounts, 'group-1')
      )
    ).toEqual(['acct-1'])
  })

  it('derives account groups and remaining available groups', () => {
    expect(accountGroupsForDisplay(groups, accounts[0]).map((group) => group.id)).toEqual([
      'group-1'
    ])
    expect(availableGroupsForAccount(groups, accounts[0]).map((group) => group.id)).toEqual([
      'group-2'
    ])
  })

  it('builds filter labels and counts from localized copy', () => {
    expect(accountFilterCount(accounts, 'all')).toBe(2)
    expect(accountFilterCount(accounts, ungroupedFilterId)).toBe(1)
    expect(groupMemberCount(accounts, 'group-1')).toBe(1)
    expect(groupFilterLabel('group-1', groups, copy)).toBe('重点')
    expect(groupFilterLabel(ungroupedFilterId, groups, copy)).toBe(copy.ungrouped)
    expect(filterChipLabel(accounts, 'group-1', groups, copy)).toBe('重点 · 1')
    expect(filterChipLabel(accounts, 'group-2', groups, copy)).toBe('候选')
  })

  it('filters accounts by identity and group name', () => {
    expect(filterAccountsBySearch(accounts, groups, 'GROUPED', copy).map((a) => a.id)).toEqual([
      'acct-1',
      'acct-2'
    ])
    expect(filterAccountsBySearch(accounts, groups, '重点', copy).map((a) => a.id)).toEqual([
      'acct-1'
    ])
    expect(filterAccountsBySearch(accounts, groups, 'acct-2', copy).map((a) => a.id)).toEqual([
      'acct-2'
    ])
  })

  it('sorts accounts by primary and secondary remaining usage with missing data last', () => {
    const sortableAccounts = [
      { ...accounts[0], id: 'acct-a' },
      { ...accounts[0], id: 'acct-b' },
      { ...accounts[0], id: 'acct-c' }
    ]
    const usageByAccountId = {
      'acct-a': createUsage({
        primary: { usedPercent: 90, windowDurationMins: 300, resetsAt: null },
        secondary: { usedPercent: 10, windowDurationMins: 10080, resetsAt: null }
      }),
      'acct-b': createUsage({
        primary: { usedPercent: 20, windowDurationMins: 300, resetsAt: null },
        secondary: { usedPercent: 80, windowDurationMins: 10080, resetsAt: null }
      })
    }

    expect(
      sortAccountsByUsage(sortableAccounts, usageByAccountId, 'primary', 'asc').map((a) => a.id)
    ).toEqual(['acct-a', 'acct-b', 'acct-c'])
    expect(
      sortAccountsByUsage(sortableAccounts, usageByAccountId, 'secondary', 'desc').map((a) => a.id)
    ).toEqual(['acct-a', 'acct-b', 'acct-c'])
  })

  it('sorts accounts by access token expiry with missing values trailing', () => {
    const sortableAccounts = [
      { ...accounts[0], id: 'acct-late', accessTokenExpiresAt: 3_000 },
      { ...accounts[0], id: 'acct-soon', accessTokenExpiresAt: 1_000 },
      { ...accounts[0], id: 'acct-mid', accessTokenExpiresAt: 2_000 },
      { ...accounts[0], id: 'acct-none' }
    ]

    expect(
      sortAccountsByUsage(sortableAccounts, {}, 'accessTokenExpiry', 'asc').map((a) => a.id)
    ).toEqual(['acct-soon', 'acct-mid', 'acct-late', 'acct-none'])
    expect(
      sortAccountsByUsage(sortableAccounts, {}, 'accessTokenExpiry', 'desc').map((a) => a.id)
    ).toEqual(['acct-late', 'acct-mid', 'acct-soon', 'acct-none'])
  })

  it('selects accounts whose access token expires within the threshold', () => {
    const now = 10_000
    const candidates = [
      { ...accounts[0], id: 'acct-soon', accessTokenExpiresAt: 11_000 }, // +1000ms
      { ...accounts[0], id: 'acct-edge', accessTokenExpiresAt: 13_000 }, // exactly threshold
      { ...accounts[0], id: 'acct-far', accessTokenExpiresAt: 20_000 }, // beyond threshold
      { ...accounts[0], id: 'acct-expired', accessTokenExpiresAt: 5_000 }, // already expired
      { ...accounts[0], id: 'acct-unknown' } // accessTokenExpiresAt undefined
    ]

    expect(eligibleAccountsForRefresh(candidates, 3_000, now).map((a) => a.id)).toEqual([
      'acct-soon',
      'acct-edge',
      'acct-expired'
    ])
    expect(eligibleAccountsForRefresh(candidates, 0, now).map((a) => a.id)).toEqual([
      'acct-expired'
    ])
    expect(eligibleAccountsForRefresh([], 3_000, now)).toEqual([])
  })

  it('builds persisted sort payloads for all accounts and group searches', () => {
    const groupAccounts = [
      { ...accounts[0], id: 'acct-a', groupIds: ['group-3'] },
      { ...accounts[0], id: 'acct-b', groupIds: ['group-3'] },
      { ...accounts[0], id: 'acct-c', groupIds: ['group-3'] }
    ]
    const groupsWithOrder = [
      ...groups,
      {
        id: 'group-3',
        name: '排序',
        createdAt: '2026-04-21T00:00:00.000Z',
        updatedAt: '2026-04-21T00:00:00.000Z'
      }
    ]

    expect(
      buildPersistedUsageSortOrder(
        'all',
        groupAccounts,
        [groupAccounts[2], groupAccounts[0]],
        groups
      )
    ).toEqual({
      type: 'accounts',
      accountIds: ['acct-c', 'acct-a']
    })
    expect(
      buildPersistedUsageSortOrder(
        'group-3',
        groupAccounts,
        [groupAccounts[2], groupAccounts[0]],
        groupsWithOrder
      )
    ).toEqual({
      type: 'group',
      groupId: 'group-3',
      accountIds: ['acct-c', 'acct-b', 'acct-a']
    })
  })
})
