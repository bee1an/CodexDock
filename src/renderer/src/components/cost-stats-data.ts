import type { CodexInstanceSummary, TokenCostSummary } from '../../../shared/codex'

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

function timestampScore(value?: string): number {
  if (!value) {
    return -1
  }

  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? -1 : parsed
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
