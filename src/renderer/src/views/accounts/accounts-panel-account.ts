import type { AccountSummary, AccountGroup, AccountRateLimits } from '../../../../shared/codex'
import { remainingPercent } from '../../../../shared/codex'

import type { LocalizedCopy } from '$lib/view/app-view'

export const ungroupedFilterId = '__ungrouped__'

export type AccountUsageSortField = 'primary' | 'secondary'
export type AccountUsageSortDirection = 'asc' | 'desc'

export interface PersistedUsageSortOrder {
  type: 'accounts' | 'group'
  accountIds: string[]
  groupId?: string
}

export function visibleAccountsForFilter(
  accounts: AccountSummary[],
  activeGroupFilter: string,
  groups: AccountGroup[] = []
): AccountSummary[] {
  if (activeGroupFilter === 'all') {
    return accounts
  }

  if (activeGroupFilter === ungroupedFilterId) {
    return accounts.filter((account) => account.groupIds.length === 0)
  }

  const members = accounts.filter((account) => account.groupIds.includes(activeGroupFilter))
  const orderedIds = groups.find((group) => group.id === activeGroupFilter)?.orderedAccountIds
  if (!orderedIds?.length) {
    return members
  }

  const indexById = new Map<string, number>()
  orderedIds.forEach((accountId, index) => {
    if (!indexById.has(accountId)) {
      indexById.set(accountId, index)
    }
  })
  const fallbackIndex = orderedIds.length
  return [...members].sort((a, b) => {
    const ai = indexById.get(a.id) ?? fallbackIndex
    const bi = indexById.get(b.id) ?? fallbackIndex
    if (ai !== bi) return ai - bi
    return accounts.indexOf(a) - accounts.indexOf(b)
  })
}

export function normalizeSelectedAccountIds(
  selectedAccountIds: string[],
  visibleAccounts: AccountSummary[]
): string[] {
  const visibleAccountIds = new Set(visibleAccounts.map((account) => account.id))
  return selectedAccountIds.filter((accountId) => visibleAccountIds.has(accountId))
}

export function filterAccountsBySearch(
  accounts: AccountSummary[],
  groups: AccountGroup[],
  query: string,
  copy: Pick<LocalizedCopy, 'unnamedAccount'>
): AccountSummary[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) {
    return accounts
  }

  return accounts.filter((account) => {
    const groupNames = groups
      .filter((group) => account.groupIds.includes(group.id))
      .map((group) => group.name)
    const text = [
      account.email ?? account.name ?? account.accountId ?? copy.unnamedAccount,
      account.name,
      account.email,
      account.accountId,
      account.id,
      ...groupNames
    ]
      .filter((value): value is string => Boolean(value))
      .join('\n')
      .toLowerCase()

    return text.includes(normalizedQuery)
  })
}

function usageRemainingForSort(
  accountId: string,
  usageByAccountId: Record<string, AccountRateLimits>,
  field: AccountUsageSortField
): number | null {
  const window = usageByAccountId[accountId]?.[field]
  return window ? remainingPercent(window.usedPercent) : null
}

export function sortAccountsByUsage(
  accounts: AccountSummary[],
  usageByAccountId: Record<string, AccountRateLimits>,
  field: AccountUsageSortField,
  direction: AccountUsageSortDirection
): AccountSummary[] {
  const indexByAccountId = new Map(accounts.map((account, index) => [account.id, index]))

  return [...accounts].sort((a, b) => {
    const aRemaining = usageRemainingForSort(a.id, usageByAccountId, field)
    const bRemaining = usageRemainingForSort(b.id, usageByAccountId, field)
    const aMissing = aRemaining == null
    const bMissing = bRemaining == null

    if (aMissing !== bMissing) {
      return aMissing ? 1 : -1
    }
    if (aMissing && bMissing) {
      return (indexByAccountId.get(a.id) ?? 0) - (indexByAccountId.get(b.id) ?? 0)
    }

    const usageCompare =
      direction === 'asc'
        ? (aRemaining as number) - (bRemaining as number)
        : (bRemaining as number) - (aRemaining as number)

    return usageCompare || (indexByAccountId.get(a.id) ?? 0) - (indexByAccountId.get(b.id) ?? 0)
  })
}

export function buildPersistedUsageSortOrder(
  activeGroupFilter: string,
  groupFilteredAccounts: AccountSummary[],
  sortedAccounts: AccountSummary[],
  groups: AccountGroup[]
): PersistedUsageSortOrder | null {
  if (!sortedAccounts.length) {
    return null
  }

  if (
    activeGroupFilter !== 'all' &&
    activeGroupFilter !== ungroupedFilterId &&
    groups.some((group) => group.id === activeGroupFilter)
  ) {
    const sortedIds = sortedAccounts.map((account) => account.id)
    const sortedIdSet = new Set(sortedIds)
    let nextSortedIndex = 0
    const accountIds = groupFilteredAccounts.map((account) =>
      sortedIdSet.has(account.id) ? (sortedIds[nextSortedIndex++] as string) : account.id
    )

    return {
      type: 'group',
      groupId: activeGroupFilter,
      accountIds
    }
  }

  return {
    type: 'accounts',
    accountIds: sortedAccounts.map((account) => account.id)
  }
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
