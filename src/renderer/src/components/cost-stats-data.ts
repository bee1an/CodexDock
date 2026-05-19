import type { AccountSummary, CodexInstanceSummary, TokenCostSummary } from '../../../shared/codex'

export interface InstanceConsumptionEntry {
  instanceId: string
  label: string
  sessionTokens: number
  sessionCostUSD: number | null
  last30DaysTokens: number
  last30DaysCostUSD: number | null
  updatedAt: string
  isRunning: boolean
}

export interface AccountConsumptionEntry {
  accountId: string
  label: string
  sessionTokens: number
  sessionCostUSD: number
  last30DaysTokens: number
  last30DaysCostUSD: number
  updatedAt: string
  instanceCount: number
}

function timestampScore(value?: string): number {
  if (!value) {
    return -1
  }

  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? -1 : parsed
}

function addCost(left: number | null, right: number | null): number {
  return (left ?? 0) + (right ?? 0)
}

export function buildInstanceConsumptionEntries(input: {
  tokenCostByInstanceId: Record<string, TokenCostSummary>
  instances: CodexInstanceSummary[]
  runningInstanceIds: string[]
  resolveLabel: (instanceId: string, instance?: CodexInstanceSummary) => string
}): InstanceConsumptionEntry[] {
  const instancesById = new Map(input.instances.map((instance) => [instance.id, instance]))
  const runningIds = new Set(input.runningInstanceIds)

  return Object.entries(input.tokenCostByInstanceId)
    .map(([instanceId, summary]) => {
      const instance = instancesById.get(instanceId)
      return {
        instanceId,
        label: input.resolveLabel(instanceId, instance),
        sessionTokens: summary.sessionTokens,
        sessionCostUSD: summary.sessionCostUSD,
        last30DaysTokens: summary.last30DaysTokens,
        last30DaysCostUSD: summary.last30DaysCostUSD,
        updatedAt: summary.updatedAt,
        isRunning: runningIds.has(instanceId)
      }
    })
    .filter(
      (entry) =>
        entry.last30DaysTokens > 0 || entry.sessionTokens > 0 || entry.last30DaysCostUSD !== null
    )
    .sort((left, right) => {
      if (left.last30DaysTokens !== right.last30DaysTokens) {
        return right.last30DaysTokens - left.last30DaysTokens
      }
      return timestampScore(right.updatedAt) - timestampScore(left.updatedAt)
    })
}

export function buildAccountConsumptionEntries(input: {
  tokenCostByInstanceId: Record<string, TokenCostSummary>
  instances: CodexInstanceSummary[]
  accounts: AccountSummary[]
  resolveLabel: (accountId: string, account?: AccountSummary) => string
}): AccountConsumptionEntry[] {
  const instancesById = new Map(input.instances.map((instance) => [instance.id, instance]))
  const accountsById = new Map(input.accounts.map((account) => [account.id, account]))
  const byAccount = new Map<string, AccountConsumptionEntry>()

  for (const [instanceId, summary] of Object.entries(input.tokenCostByInstanceId)) {
    const bindAccountId = instancesById.get(instanceId)?.bindAccountId
    if (!bindAccountId) {
      continue
    }

    const current = byAccount.get(bindAccountId) ?? {
      accountId: bindAccountId,
      label: input.resolveLabel(bindAccountId, accountsById.get(bindAccountId)),
      sessionTokens: 0,
      sessionCostUSD: 0,
      last30DaysTokens: 0,
      last30DaysCostUSD: 0,
      updatedAt: '',
      instanceCount: 0
    }

    current.sessionTokens += summary.sessionTokens
    current.sessionCostUSD = addCost(current.sessionCostUSD, summary.sessionCostUSD)
    current.last30DaysTokens += summary.last30DaysTokens
    current.last30DaysCostUSD = addCost(current.last30DaysCostUSD, summary.last30DaysCostUSD)
    current.updatedAt =
      timestampScore(summary.updatedAt) > timestampScore(current.updatedAt)
        ? summary.updatedAt
        : current.updatedAt
    current.instanceCount += 1
    byAccount.set(bindAccountId, current)
  }

  return [...byAccount.values()]
    .filter(
      (entry) =>
        entry.last30DaysTokens > 0 ||
        entry.sessionTokens > 0 ||
        (entry.last30DaysCostUSD ?? 0) > 0 ||
        (entry.sessionCostUSD ?? 0) > 0
    )
    .sort((left, right) => {
      if (left.last30DaysTokens !== right.last30DaysTokens) {
        return right.last30DaysTokens - left.last30DaysTokens
      }
      return timestampScore(right.updatedAt) - timestampScore(left.updatedAt)
    })
}
