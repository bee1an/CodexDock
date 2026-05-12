import type { AccountSummary, AccountGroup } from '../../../shared/codex'

import type { LocalizedCopy } from './app-view'

export const ungroupedFilterId = '__ungrouped__'

export function visibleAccountsForFilter(
  accounts: AccountSummary[],
  activeGroupFilter: string
): AccountSummary[] {
  if (activeGroupFilter === 'all') {
    return accounts
  }

  if (activeGroupFilter === ungroupedFilterId) {
    return accounts.filter((account) => account.groupIds.length === 0)
  }

  return accounts.filter((account) => account.groupIds.includes(activeGroupFilter))
}

export function normalizeSelectedAccountIds(
  selectedAccountIds: string[],
  visibleAccounts: AccountSummary[]
): string[] {
  const visibleAccountIds = new Set(visibleAccounts.map((account) => account.id))
  return selectedAccountIds.filter((accountId) => visibleAccountIds.has(accountId))
}

export function accountGroupsForDisplay(
  groups: AccountGroup[],
  account: AccountSummary
): AccountGroup[] {
  return groups.filter((group) => account.groupIds.includes(group.id))
}

export function availableGroupsForAccount(
  groups: AccountGroup[],
  account: AccountSummary
): AccountGroup[] {
  return groups.filter((group) => !account.groupIds.includes(group.id))
}

export function accountFilterCount(accounts: AccountSummary[], groupId: string): number {
  if (groupId === 'all') {
    return accounts.length
  }

  if (groupId === ungroupedFilterId) {
    return accounts.filter((account) => account.groupIds.length === 0).length
  }

  return accounts.filter((account) => account.groupIds.includes(groupId)).length
}

export function groupFilterLabel(
  groupId: string,
  groups: AccountGroup[],
  copy: LocalizedCopy
): string {
  if (groupId === 'all') {
    return copy.allGroups
  }

  if (groupId === ungroupedFilterId) {
    return copy.ungrouped
  }

  return groups.find((group) => group.id === groupId)?.name ?? copy.allGroups
}

export function filterChipLabel(
  accounts: AccountSummary[],
  groupId: string,
  groups: AccountGroup[],
  copy: LocalizedCopy
): string {
  const label = groupFilterLabel(groupId, groups, copy)
  const count = accountFilterCount(accounts, groupId)

  return count > 0 ? `${label} · ${count}` : label
}

export function groupMemberCount(accounts: AccountSummary[], groupId: string): number {
  return accounts.filter((account) => account.groupIds.includes(groupId)).length
}
