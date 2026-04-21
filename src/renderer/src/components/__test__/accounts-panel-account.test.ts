import { describe, expect, it } from 'vitest'

import {
  accountFilterCount,
  accountTagsForDisplay,
  availableTagsForAccount,
  filterChipLabel,
  normalizeSelectedAccountIds,
  taggedAccountCount,
  tagFilterLabel,
  untaggedFilterId,
  visibleAccountsForFilter
} from '../accounts-panel-account'
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
  },
  {
    id: 'tag-2',
    name: '候选',
    createdAt: '2026-04-21T00:00:00.000Z',
    updatedAt: '2026-04-21T00:00:00.000Z'
  }
]

describe('accounts panel account helpers', () => {
  it('filters tagged and untagged accounts correctly', () => {
    expect(visibleAccountsForFilter(accounts, 'all').map((account) => account.id)).toEqual([
      'acct-1',
      'acct-2'
    ])
    expect(
      visibleAccountsForFilter(accounts, untaggedFilterId).map((account) => account.id)
    ).toEqual(['acct-2'])
    expect(visibleAccountsForFilter(accounts, 'tag-1').map((account) => account.id)).toEqual([
      'acct-1'
    ])
  })

  it('normalizes selected ids against the visible account set', () => {
    expect(
      normalizeSelectedAccountIds(['acct-1', 'acct-3'], visibleAccountsForFilter(accounts, 'tag-1'))
    ).toEqual(['acct-1'])
  })

  it('derives account tags and remaining available tags', () => {
    expect(accountTagsForDisplay(tags, accounts[0]).map((tag) => tag.id)).toEqual(['tag-1'])
    expect(availableTagsForAccount(tags, accounts[0]).map((tag) => tag.id)).toEqual(['tag-2'])
  })

  it('builds filter labels and counts from localized copy', () => {
    expect(accountFilterCount(accounts, 'all')).toBe(2)
    expect(accountFilterCount(accounts, untaggedFilterId)).toBe(1)
    expect(taggedAccountCount(accounts, 'tag-1')).toBe(1)
    expect(tagFilterLabel('tag-1', tags, copy)).toBe('重点')
    expect(tagFilterLabel(untaggedFilterId, tags, copy)).toBe(copy.untagged)
    expect(filterChipLabel(accounts, 'tag-1', tags, copy)).toBe('重点 · 1')
    expect(filterChipLabel(accounts, 'tag-2', tags, copy)).toBe('候选')
  })
})
