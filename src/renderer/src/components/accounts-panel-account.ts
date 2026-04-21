import type { AccountSummary, AccountTag } from '../../../shared/codex'

import type { LocalizedCopy } from './app-view'

export const untaggedFilterId = '__untagged__'

export function visibleAccountsForFilter(
  accounts: AccountSummary[],
  activeTagFilter: string
): AccountSummary[] {
  if (activeTagFilter === 'all') {
    return accounts
  }

  if (activeTagFilter === untaggedFilterId) {
    return accounts.filter((account) => account.tagIds.length === 0)
  }

  return accounts.filter((account) => account.tagIds.includes(activeTagFilter))
}

export function normalizeSelectedAccountIds(
  selectedAccountIds: string[],
  visibleAccounts: AccountSummary[]
): string[] {
  const visibleAccountIds = new Set(visibleAccounts.map((account) => account.id))
  return selectedAccountIds.filter((accountId) => visibleAccountIds.has(accountId))
}

export function accountTagsForDisplay(tags: AccountTag[], account: AccountSummary): AccountTag[] {
  return tags.filter((tag) => account.tagIds.includes(tag.id))
}

export function availableTagsForAccount(tags: AccountTag[], account: AccountSummary): AccountTag[] {
  return tags.filter((tag) => !account.tagIds.includes(tag.id))
}

export function accountFilterCount(accounts: AccountSummary[], tagId: string): number {
  if (tagId === 'all') {
    return accounts.length
  }

  if (tagId === untaggedFilterId) {
    return accounts.filter((account) => account.tagIds.length === 0).length
  }

  return accounts.filter((account) => account.tagIds.includes(tagId)).length
}

export function tagFilterLabel(tagId: string, tags: AccountTag[], copy: LocalizedCopy): string {
  if (tagId === 'all') {
    return copy.allTags
  }

  if (tagId === untaggedFilterId) {
    return copy.untagged
  }

  return tags.find((tag) => tag.id === tagId)?.name ?? copy.allTags
}

export function filterChipLabel(
  accounts: AccountSummary[],
  tagId: string,
  tags: AccountTag[],
  copy: LocalizedCopy
): string {
  const label = tagFilterLabel(tagId, tags, copy)
  const count = accountFilterCount(accounts, tagId)

  return count > 0 ? `${label} · ${count}` : label
}

export function taggedAccountCount(accounts: AccountSummary[], tagId: string): number {
  return accounts.filter((account) => account.tagIds.includes(tagId)).length
}
