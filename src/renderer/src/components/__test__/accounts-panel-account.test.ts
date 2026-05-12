import { describe, expect, it } from 'vitest'

import {
  accountFilterCount,
  accountGroupsForDisplay,
  availableGroupsForAccount,
  filterChipLabel,
  groupFilterLabel,
  groupMemberCount,
  normalizeSelectedAccountIds,
  ungroupedFilterId,
  visibleAccountsForFilter
} from '../accounts-panel-account'
import { messages } from '../app-view'

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
})
