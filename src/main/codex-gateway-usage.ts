import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'

import {
  GATEWAY_USAGE_ALL_ACCOUNT_ID,
  GATEWAY_USAGE_RETENTION_DAYS,
  GATEWAY_USAGE_UNKNOWN_INSTANCE_ID,
  type GatewayUsageDailyEntry,
  type GatewayUsageDetail,
  type GatewayUsageInstanceBreakdown,
  type GatewayUsageReadOptions,
  type GatewayUsageRecordInput,
  type GatewayUsageSummary,
  type TokenCostModelBreakdown
} from '../shared/codex'
import {
  addCostToRollup,
  addDays,
  codexCostUSD,
  createCostRollup,
  finalizeCostRollup,
  localDayKey,
  normalizeCodexModel,
  type CostRollup
} from './codex-cost-usage'

const STORE_VERSION = 1

type PackedUsage = [input: number, cached: number, output: number]
type DayModelUsage = Record<string, PackedUsage>
type DaysByDayKey = Record<string, DayModelUsage>
type InstancesByInstanceId = Record<string, { days: DaysByDayKey }>

interface GatewayUsageStoreFile {
  version: number
  accounts: Record<
    string,
    {
      instances: InstancesByInstanceId
      updatedAt: string
    }
  >
}

function emptyStoreFile(): GatewayUsageStoreFile {
  return { version: STORE_VERSION, accounts: {} }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clonePacked(packed: PackedUsage): PackedUsage {
  return [packed[0], packed[1], packed[2]]
}

function emptySummary(updatedAt: string): GatewayUsageSummary {
  return {
    todayTokens: 0,
    todayCostUSD: null,
    last30DaysTokens: 0,
    last30DaysCostUSD: null,
    updatedAt
  }
}

function sortedModelBreakdowns(breakdowns: TokenCostModelBreakdown[]): TokenCostModelBreakdown[] {
  return breakdowns.sort((left, right) => {
    const leftCost = left.costUSD ?? -1
    const rightCost = right.costUSD ?? -1
    if (leftCost !== rightCost) {
      return rightCost - leftCost
    }

    if (left.totalTokens !== right.totalTokens) {
      return right.totalTokens - left.totalTokens
    }

    return right.modelName.localeCompare(left.modelName)
  })
}

function sortedInstanceBreakdowns(
  breakdowns: GatewayUsageInstanceBreakdown[]
): GatewayUsageInstanceBreakdown[] {
  return breakdowns.sort((left, right) => {
    const leftCost = left.costUSD ?? -1
    const rightCost = right.costUSD ?? -1
    if (leftCost !== rightCost) {
      return rightCost - leftCost
    }
    if (left.totalTokens !== right.totalTokens) {
      return right.totalTokens - left.totalTokens
    }
    return left.instanceId.localeCompare(right.instanceId)
  })
}

function normalizeStore(value: unknown): GatewayUsageStoreFile {
  if (!isRecord(value) || value.version !== STORE_VERSION) {
    return emptyStoreFile()
  }

  const accountsValue = isRecord(value.accounts) ? value.accounts : {}
  const accounts: GatewayUsageStoreFile['accounts'] = {}

  for (const [accountId, accountState] of Object.entries(accountsValue)) {
    if (!isRecord(accountState)) {
      continue
    }

    const instancesValue = isRecord(accountState.instances) ? accountState.instances : {}
    const instances: InstancesByInstanceId = {}

    for (const [instanceId, instanceState] of Object.entries(instancesValue)) {
      if (!isRecord(instanceState)) {
        continue
      }

      const daysValue = isRecord(instanceState.days) ? instanceState.days : {}
      const days: DaysByDayKey = {}

      for (const [dayKey, models] of Object.entries(daysValue)) {
        if (!isRecord(models)) {
          continue
        }

        const dayModels: DayModelUsage = {}
        for (const [model, packed] of Object.entries(models)) {
          if (Array.isArray(packed) && packed.length === 3) {
            const [input, cached, output] = packed
            dayModels[model] = [
              Math.max(0, Math.trunc(Number(input) || 0)),
              Math.max(0, Math.trunc(Number(cached) || 0)),
              Math.max(0, Math.trunc(Number(output) || 0))
            ]
          }
        }

        if (Object.keys(dayModels).length) {
          days[dayKey] = dayModels
        }
      }

      if (Object.keys(days).length) {
        instances[instanceId] = { days }
      }
    }

    const updatedAt =
      typeof accountState.updatedAt === 'string' && accountState.updatedAt
        ? accountState.updatedAt
        : ''

    if (Object.keys(instances).length) {
      accounts[accountId] = { instances, updatedAt }
    }
  }

  return { version: STORE_VERSION, accounts }
}

function pruneOlderThan(store: GatewayUsageStoreFile, cutoffKey: string): boolean {
  let mutated = false
  for (const accountState of Object.values(store.accounts)) {
    for (const [instanceId, instanceState] of Object.entries(accountState.instances)) {
      for (const dayKey of Object.keys(instanceState.days)) {
        if (dayKey < cutoffKey) {
          delete instanceState.days[dayKey]
          mutated = true
        }
      }
      if (Object.keys(instanceState.days).length === 0) {
        delete accountState.instances[instanceId]
        mutated = true
      }
    }
  }

  for (const [accountId, accountState] of Object.entries(store.accounts)) {
    if (Object.keys(accountState.instances).length === 0) {
      delete store.accounts[accountId]
      mutated = true
    }
  }

  return mutated
}

function clampTimestampString(timestamp: string | undefined, fallback: Date): Date {
  if (!timestamp) {
    return fallback
  }

  const parsed = Date.parse(timestamp)
  return Number.isFinite(parsed) ? new Date(parsed) : fallback
}

function aggregateDailyEntries(
  daysBy: Record<string, Map<string, PackedUsage>>,
  daysInstanceMap: Record<string, Map<string, PackedUsage>>,
  daysInstanceModelMap: Record<string, Map<string, Map<string, PackedUsage>>>,
  sinceKey: string,
  untilKey: string
): GatewayUsageDailyEntry[] {
  const entries: GatewayUsageDailyEntry[] = []
  const dayKeys = Object.keys(daysBy)
    .filter((dayKey) => dayKey >= sinceKey && dayKey <= untilKey)
    .sort()

  for (const dayKey of dayKeys) {
    const modelMap = daysBy[dayKey] ?? new Map<string, PackedUsage>()
    const modelNames = [...modelMap.keys()].sort()
    let inputTokens = 0
    let outputTokens = 0
    const dayCost = createCostRollup()
    const modelBreakdowns: TokenCostModelBreakdown[] = []

    for (const model of modelNames) {
      const [input, cached, output] = modelMap.get(model) ?? [0, 0, 0]
      const totalTokens = input + output
      const costUSD = codexCostUSD(model, input, cached, output)
      inputTokens += input
      outputTokens += output
      addCostToRollup(dayCost, costUSD)
      modelBreakdowns.push({ modelName: model, totalTokens, costUSD })
    }

    const instanceMap = daysInstanceMap[dayKey] ?? new Map<string, PackedUsage>()
    const instanceModelMap =
      daysInstanceModelMap[dayKey] ?? new Map<string, Map<string, PackedUsage>>()
    const instanceBreakdowns: GatewayUsageInstanceBreakdown[] = []
    for (const [instanceId, packed] of instanceMap.entries()) {
      const [input, , output] = packed
      instanceBreakdowns.push({
        instanceId,
        totalTokens: input + output,
        costUSD: costFromModelMap(instanceModelMap.get(instanceId) ?? new Map())
      })
    }

    entries.push({
      date: dayKey,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      costUSD: finalizeCostRollup(dayCost),
      modelsUsed: modelNames,
      modelBreakdowns: sortedModelBreakdowns(modelBreakdowns),
      instanceBreakdowns: sortedInstanceBreakdowns(instanceBreakdowns)
    })
  }

  return entries
}

function costFromModelMap(modelMap: Map<string, PackedUsage>): number | null {
  const rollup = createCostRollup()
  for (const [model, [input, cached, output]] of modelMap.entries()) {
    addCostToRollup(rollup, codexCostUSD(model, input, cached, output))
  }
  return finalizeCostRollup(rollup)
}

function buildSummaryFromDaily(
  daily: GatewayUsageDailyEntry[],
  todayKey: string,
  updatedAt: string
): GatewayUsageSummary {
  const today = daily.find((entry) => entry.date === todayKey)
  const cost = createCostRollup()
  let last30DaysTokens = 0
  for (const entry of daily) {
    last30DaysTokens += entry.totalTokens
    addCostToRollup(cost, entry.costUSD)
  }

  return {
    todayTokens: today?.totalTokens ?? 0,
    todayCostUSD: today?.costUSD ?? null,
    last30DaysTokens,
    last30DaysCostUSD: finalizeCostRollup(cost),
    updatedAt
  }
}

interface AccountAggregate {
  daysModel: Record<string, Map<string, PackedUsage>>
  daysInstance: Record<string, Map<string, PackedUsage>>
  daysInstanceModel: Record<string, Map<string, Map<string, PackedUsage>>>
  instanceTotals: Map<string, PackedUsage>
  modelTotals: Map<string, PackedUsage>
  updatedAt: string
}

function emptyAggregate(): AccountAggregate {
  return {
    daysModel: {},
    daysInstance: {},
    daysInstanceModel: {},
    instanceTotals: new Map<string, PackedUsage>(),
    modelTotals: new Map<string, PackedUsage>(),
    updatedAt: ''
  }
}

function addPacked(target: Map<string, PackedUsage>, key: string, packed: PackedUsage): void {
  const existing = target.get(key) ?? [0, 0, 0]
  target.set(key, [existing[0] + packed[0], existing[1] + packed[1], existing[2] + packed[2]])
}

function aggregateAccount(
  accountId: string,
  store: GatewayUsageStoreFile,
  options: { instanceId?: string; sinceKey: string; untilKey: string }
): AccountAggregate {
  const aggregate = emptyAggregate()
  const accountState = store.accounts[accountId]
  if (!accountState) {
    return aggregate
  }

  for (const [instanceId, instanceState] of Object.entries(accountState.instances)) {
    if (options.instanceId && options.instanceId !== instanceId) {
      continue
    }

    for (const [dayKey, models] of Object.entries(instanceState.days)) {
      if (dayKey < options.sinceKey || dayKey > options.untilKey) {
        continue
      }

      const dayModelMap = (aggregate.daysModel[dayKey] ??= new Map<string, PackedUsage>())
      const dayInstanceMap = (aggregate.daysInstance[dayKey] ??= new Map<string, PackedUsage>())
      const dayInstanceModelMap = (aggregate.daysInstanceModel[dayKey] ??= new Map<
        string,
        Map<string, PackedUsage>
      >())
      const instanceModelMap = dayInstanceModelMap.get(instanceId) ?? new Map<string, PackedUsage>()
      dayInstanceModelMap.set(instanceId, instanceModelMap)

      for (const [model, packed] of Object.entries(models)) {
        const cloned = clonePacked(packed)
        addPacked(dayModelMap, model, cloned)
        addPacked(dayInstanceMap, instanceId, cloned)
        addPacked(instanceModelMap, model, cloned)
        addPacked(aggregate.modelTotals, model, cloned)
        addPacked(aggregate.instanceTotals, instanceId, cloned)
      }
    }
  }

  aggregate.updatedAt = accountState.updatedAt ?? ''
  return aggregate
}

function aggregateAllAccounts(
  store: GatewayUsageStoreFile,
  options: { instanceId?: string; sinceKey: string; untilKey: string }
): AccountAggregate {
  const aggregate = emptyAggregate()
  for (const accountId of Object.keys(store.accounts)) {
    const part = aggregateAccount(accountId, store, options)
    for (const [dayKey, modelMap] of Object.entries(part.daysModel)) {
      const target = (aggregate.daysModel[dayKey] ??= new Map<string, PackedUsage>())
      for (const [model, packed] of modelMap.entries()) {
        addPacked(target, model, packed)
      }
    }
    for (const [dayKey, instanceMap] of Object.entries(part.daysInstance)) {
      const target = (aggregate.daysInstance[dayKey] ??= new Map<string, PackedUsage>())
      for (const [instanceId, packed] of instanceMap.entries()) {
        addPacked(target, instanceId, packed)
      }
    }
    for (const [dayKey, instanceModelMap] of Object.entries(part.daysInstanceModel)) {
      const targetDayMap = (aggregate.daysInstanceModel[dayKey] ??= new Map<
        string,
        Map<string, PackedUsage>
      >())
      for (const [instanceId, modelMap] of instanceModelMap.entries()) {
        const targetModelMap = targetDayMap.get(instanceId) ?? new Map<string, PackedUsage>()
        targetDayMap.set(instanceId, targetModelMap)
        for (const [model, packed] of modelMap.entries()) {
          addPacked(targetModelMap, model, packed)
        }
      }
    }
    for (const [model, packed] of part.modelTotals.entries()) {
      addPacked(aggregate.modelTotals, model, packed)
    }
    for (const [instanceId, packed] of part.instanceTotals.entries()) {
      addPacked(aggregate.instanceTotals, instanceId, packed)
    }
    if (part.updatedAt > aggregate.updatedAt) {
      aggregate.updatedAt = part.updatedAt
    }
  }
  return aggregate
}

function instanceBreakdownsFromAggregate(
  aggregate: AccountAggregate,
  modelMapByInstance: (instanceId: string) => Map<string, PackedUsage>
): GatewayUsageInstanceBreakdown[] {
  const breakdowns: GatewayUsageInstanceBreakdown[] = []
  for (const [instanceId, packed] of aggregate.instanceTotals.entries()) {
    const [input, , output] = packed
    const modelMap = modelMapByInstance(instanceId)
    const cost = costFromModelMap(modelMap)
    breakdowns.push({
      instanceId,
      totalTokens: input + output,
      costUSD: cost
    })
  }
  return sortedInstanceBreakdowns(breakdowns)
}

function buildInstanceModelMap(
  accountId: string | null,
  store: GatewayUsageStoreFile,
  instanceId: string,
  options: { sinceKey: string; untilKey: string }
): Map<string, PackedUsage> {
  const modelMap = new Map<string, PackedUsage>()
  const accountIds = accountId ? [accountId] : Object.keys(store.accounts)
  for (const id of accountIds) {
    const instanceState = store.accounts[id]?.instances[instanceId]
    if (!instanceState) {
      continue
    }
    for (const [dayKey, models] of Object.entries(instanceState.days)) {
      if (dayKey < options.sinceKey || dayKey > options.untilKey) {
        continue
      }
      for (const [model, packed] of Object.entries(models)) {
        addPacked(modelMap, model, clonePacked(packed))
      }
    }
  }
  return modelMap
}

export class CodexGatewayUsageService {
  private storeFilePath: string
  private cache: GatewayUsageStoreFile | null = null
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly options: {
      userDataPath: string
      now?: () => Date
    }
  ) {
    this.storeFilePath = join(options.userDataPath, 'gateway-usage', 'v1.json')
  }

  private now(): Date {
    return this.options.now?.() ?? new Date()
  }

  private async loadStore(): Promise<GatewayUsageStoreFile> {
    if (this.cache) {
      return this.cache
    }

    try {
      const raw = await fs.readFile(this.storeFilePath, 'utf8')
      this.cache = normalizeStore(JSON.parse(raw))
    } catch (error) {
      if (this.isMissingFile(error)) {
        this.cache = emptyStoreFile()
      } else {
        // Corrupt file falls back to empty in-memory state; do not throw.
        this.cache = emptyStoreFile()
      }
    }
    return this.cache
  }

  private isMissingFile(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
  }

  private async persistStore(store: GatewayUsageStoreFile): Promise<void> {
    await fs.mkdir(dirname(this.storeFilePath), { recursive: true })
    const tmpFile = `${this.storeFilePath}.tmp`
    await fs.writeFile(tmpFile, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
    await fs.rename(tmpFile, this.storeFilePath)
  }

  private enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
    const next = this.writeQueue.then(task, task)
    this.writeQueue = next.then(
      () => undefined,
      () => undefined
    )
    return next
  }

  async record(input: GatewayUsageRecordInput): Promise<void> {
    const inputTokens = Math.max(0, Math.trunc(input.inputTokens))
    const cachedTokens = Math.min(Math.max(0, Math.trunc(input.cachedTokens)), inputTokens)
    const outputTokens = Math.max(0, Math.trunc(input.outputTokens))
    if (inputTokens === 0 && cachedTokens === 0 && outputTokens === 0) {
      return
    }

    const accountId = input.accountId.trim()
    if (!accountId) {
      return
    }

    const instanceId = input.instanceId?.trim() || GATEWAY_USAGE_UNKNOWN_INSTANCE_ID
    const model = normalizeCodexModel(input.model || 'unknown')
    const timestamp = clampTimestampString(input.timestamp, this.now())
    const dayKey = localDayKey(timestamp)

    await this.enqueueWrite(async () => {
      // The gateway usage file is intentionally durable user data. Reload it
      // before each write so app restarts, recovery merges, or another running
      // process do not get overwritten by a stale in-memory snapshot.
      this.cache = null
      const store = await this.loadStore()

      const accountState =
        store.accounts[accountId] ??
        (store.accounts[accountId] = {
          instances: {},
          updatedAt: ''
        })
      const instanceState =
        accountState.instances[instanceId] ?? (accountState.instances[instanceId] = { days: {} })
      const dayModels = instanceState.days[dayKey] ?? (instanceState.days[dayKey] = {})
      const current = dayModels[model] ?? [0, 0, 0]
      dayModels[model] = [
        current[0] + inputTokens,
        current[1] + cachedTokens,
        current[2] + outputTokens
      ]
      accountState.updatedAt = this.now().toISOString()

      const cutoffKey = localDayKey(addDays(this.now(), -(GATEWAY_USAGE_RETENTION_DAYS - 1)))
      pruneOlderThan(store, cutoffKey)
      await this.persistStore(store)
    })
  }

  async read(options: GatewayUsageReadOptions = {}): Promise<GatewayUsageDetail> {
    this.cache = null
    const store = await this.loadStore()
    const now = this.now()
    const todayKey = localDayKey(now)
    const sinceKey =
      options.sinceKey ?? localDayKey(addDays(now, -(GATEWAY_USAGE_RETENTION_DAYS - 1)))
    const untilKey = options.untilKey ?? todayKey

    const accountId = options.accountId?.trim()
    if (sinceKey > untilKey) {
      return emptyDetail(accountId ?? GATEWAY_USAGE_ALL_ACCOUNT_ID, now.toISOString())
    }

    const aggregate =
      accountId && accountId !== GATEWAY_USAGE_ALL_ACCOUNT_ID
        ? aggregateAccount(accountId, store, {
            instanceId: options.instanceId,
            sinceKey,
            untilKey
          })
        : aggregateAllAccounts(store, {
            instanceId: options.instanceId,
            sinceKey,
            untilKey
          })

    const daily = aggregateDailyEntries(
      aggregate.daysModel,
      aggregate.daysInstance,
      aggregate.daysInstanceModel,
      sinceKey,
      untilKey
    )
    const summary = buildSummaryFromDaily(daily, todayKey, aggregate.updatedAt || now.toISOString())
    const instanceBreakdowns = instanceBreakdownsFromAggregate(aggregate, (instanceId) =>
      buildInstanceModelMap(
        accountId && accountId !== GATEWAY_USAGE_ALL_ACCOUNT_ID ? accountId : null,
        store,
        instanceId,
        { sinceKey, untilKey }
      )
    )

    return {
      accountId: accountId || GATEWAY_USAGE_ALL_ACCOUNT_ID,
      source: 'gateway',
      retentionDays: GATEWAY_USAGE_RETENTION_DAYS,
      summary,
      daily,
      instanceBreakdowns
    }
  }

  async readSnapshotSummaries(
    accountIds: string[]
  ): Promise<{ gatewayUsageByAccountId: Record<string, GatewayUsageSummary> }> {
    this.cache = null
    const store = await this.loadStore()
    const now = this.now()
    const todayKey = localDayKey(now)
    const sinceKey = localDayKey(addDays(now, -(GATEWAY_USAGE_RETENTION_DAYS - 1)))
    const summaries: Record<string, GatewayUsageSummary> = {}

    for (const accountId of accountIds) {
      const aggregate = aggregateAccount(accountId, store, {
        sinceKey,
        untilKey: todayKey
      })

      if (!Object.keys(aggregate.daysModel).length) {
        continue
      }

      const daily = aggregateDailyEntries(
        aggregate.daysModel,
        aggregate.daysInstance,
        aggregate.daysInstanceModel,
        sinceKey,
        todayKey
      )
      summaries[accountId] = buildSummaryFromDaily(
        daily,
        todayKey,
        aggregate.updatedAt || now.toISOString()
      )
    }

    return { gatewayUsageByAccountId: summaries }
  }
}

function emptyDetail(accountId: string, updatedAt: string): GatewayUsageDetail {
  return {
    accountId,
    source: 'gateway',
    retentionDays: GATEWAY_USAGE_RETENTION_DAYS,
    summary: emptySummary(updatedAt),
    daily: [],
    instanceBreakdowns: []
  }
}

export function createCodexGatewayUsageService(options: {
  userDataPath: string
  now?: () => Date
}): CodexGatewayUsageService {
  return new CodexGatewayUsageService(options)
}

export type { CostRollup }
