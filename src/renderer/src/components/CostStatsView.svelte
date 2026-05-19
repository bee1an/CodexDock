<script lang="ts">
  import { onMount } from 'svelte'
  import {
    BarController,
    BarElement,
    CategoryScale,
    Chart,
    Filler,
    Legend,
    LineController,
    LineElement,
    LinearScale,
    PointElement,
    Tooltip,
    type ChartConfiguration
  } from 'chart.js'
  import type {
    AccountSummary,
    AppLanguage,
    CodexInstanceSummary,
    StatsDisplaySettings,
    TokenCostDetail,
    TokenCostModelBreakdown,
    TokenCostReadOptions,
    TokenCostSummary
  } from '../../../shared/codex'
  import { normalizeStatsDisplaySettings } from '../../../shared/codex'
  import {
    buildAccountConsumptionEntries,
    buildInstanceConsumptionEntries
  } from './cost-stats-data'
  import type {
    AccountConsumptionEntry,
    InstanceConsumptionEntry
  } from './cost-stats-data'
  import { type LocalizedCopy } from './app-view'
  import AppButton from './AppButton.svelte'
  import AppPopover from './AppPopover.svelte'
  import Checkbox from './Checkbox.svelte'
  import { cascadeIn, reveal } from './gsap-motion'

  Chart.register(
    BarController,
    BarElement,
    CategoryScale,
    LinearScale,
    LineController,
    LineElement,
    PointElement,
    Filler,
    Tooltip,
    Legend
  )

  type TrendMetric = 'tokens' | 'cost'

  export let copy: LocalizedCopy
  export let language: AppLanguage
  export let accounts: AccountSummary[] = []
  export let codexInstances: CodexInstanceSummary[] = []
  export let tokenCostByInstanceId: Record<string, TokenCostSummary> = {}
  export let tokenCostErrorByInstanceId: Record<string, string> = {}
  export let runningTokenCostSummary: TokenCostSummary | null = null
  export let runningTokenCostInstanceIds: string[] = []
  export let statsDisplay: StatsDisplaySettings
  export let updateStatsDisplay: (statsDisplay: StatsDisplaySettings) => Promise<void>
  export let readTokenCost: (input?: TokenCostReadOptions) => Promise<TokenCostDetail>

  let lastLoadedKey = ''
  let detailRequestVersion = 0
  let pendingSnapshotSyncs: Array<{
    topologyKey: string
    updatedAt: string
  }> = []
  let detail: TokenCostDetail | null = null
  let loadingDetail = false
  let detailError = ''
  let detailWarnings: string[] = []
  let detailTopologyKey = ''
  let snapshotSelectedSummary: TokenCostSummary | null = null
  let selectedSummary: TokenCostSummary | null = null
  let currentSnapshotTopologyKey = ''
  let snapshotError = ''
  let warningMessages: string[] = []
  let modelBreakdowns: TokenCostModelBreakdown[] = []
  let accountUsageRows: AccountConsumptionEntry[] = []
  let instanceUsageRows: InstanceUsageRow[] = []
  let chartDaily: TokenCostDetail['daily'] = []
  let trendCanvas: HTMLCanvasElement | null = null
  let modelCanvas: HTMLCanvasElement | null = null
  let accountCanvas: HTMLCanvasElement | null = null
  let instanceCanvas: HTMLCanvasElement | null = null
  let trendChart: Chart<'line', number[], string> | null = null
  let modelChart: Chart<'bar', number[], string> | null = null
  let accountChart: Chart<'bar', number[], string> | null = null
  let instanceChart: Chart<'bar', number[], string> | null = null
  let trendChartSyncKey = ''
  let modelChartSyncKey = ''
  let accountChartSyncKey = ''
  let instanceChartSyncKey = ''
  let modelChartHeight = 280
  let accountChartHeight = 280
  let instanceChartHeight = 280
  let statsDisplayDraft = normalizeStatsDisplaySettings(statsDisplay)
  let showStatsDisplayPopover = false
  let statsDisplayButton: HTMLButtonElement | null = null
  let statsDisplayAnchorRect: DOMRect | null = null
  let trendMetric: TrendMetric = 'tokens'
  let trendMetricOptions: Array<{ value: TrendMetric; label: string }> = []

  const summaryHasData = (summary: TokenCostSummary | null): boolean =>
    Boolean(summary && (summary.sessionTokens > 0 || summary.last30DaysTokens > 0))

  const formatTokens = (value: number): string =>
    new Intl.NumberFormat(language === 'en' ? 'en-US' : 'zh-CN').format(value)

  const formatCost = (value: number | null): string => {
    if (value === null) {
      return copy.costUnknown
    }

    if (value > 0 && value < 0.0001) {
      return `$${value.toExponential(2)}`
    }

    return `$${value.toFixed(4)}`
  }

  const trendMetricValue = (entry: TokenCostDetail['daily'][number]): number =>
    trendMetric === 'tokens' ? entry.totalTokens : (entry.costUSD ?? 0)

  const formatTrendMetricValue = (value: number): string =>
    trendMetric === 'tokens' ? formatTokens(value) : formatCost(value)

  const formatUpdatedAt = (value?: string): string => {
    if (!value) {
      return '--'
    }

    const date = new Date(value)
    if (Number.isNaN(date.getTime())) {
      return value
    }

    return new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(date)
  }

  const formatLocalDayKey = (date: Date): string => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  const formatInstanceName = (instanceId: string, instance?: CodexInstanceSummary): string => {
    if (instance?.isDefault || instanceId === '__default__') {
      return 'default'
    }

    const name = instance?.name?.trim()
    if (name) {
      return name
    }

    const segments = instance?.codexHome?.split('/').filter(Boolean) ?? []
    return segments.at(-1) || instanceId
  }

  const formatAccountLabel = (account: AccountSummary): string =>
    account.email ?? account.name ?? account.accountId ?? account.id

  const formatDayLabel = (value: string): string => {
    const [, month = '0', day = '0'] = value.split('-')
    return `${Number(month)}/${Number(day)}`
  }

  const setStatsDisplay = (key: keyof StatsDisplaySettings, enabled: boolean): void => {
    const next = normalizeStatsDisplaySettings({
      ...statsDisplayDraft,
      [key]: enabled
    })
    statsDisplayDraft = next
    void updateStatsDisplay(next)
  }

  interface CostRollup {
    total: number
    hasKnown: boolean
  }

  interface InstanceUsageRow {
    label: string
    tokens: number
    costUSD: number | null
    sessionTokens: number
    sessionCostUSD: number | null
    isRunning: boolean
    updatedAt: string
  }

  const createCostRollup = (): CostRollup => ({
    total: 0,
    hasKnown: false
  })

  const addCostToRollup = (
    rollup: CostRollup,
    costUSD: number | null
  ): void => {
    if (costUSD === null) {
      return
    }

    rollup.total += costUSD
    rollup.hasKnown = true
  }

  const finalizeCostRollup = (rollup: CostRollup): number | null => {
    if (!rollup.hasKnown) {
      return null
    }

    return rollup.total
  }

  const buildSnapshotTopologyKey = (
    instanceIds = runningTokenCostInstanceIds,
    costByInstanceId = tokenCostByInstanceId,
    errorByInstanceId = tokenCostErrorByInstanceId
  ): string =>
    JSON.stringify({
      runningTokenCostInstanceIds: [...instanceIds],
      tokenCostInstanceIds: Object.keys(costByInstanceId).sort(),
      tokenCostErrorEntries: Object.entries(errorByInstanceId).sort(([left], [right]) =>
        left.localeCompare(right)
      )
    })

  const buildSnapshotLoadKey = (): string =>
    JSON.stringify({
      topologyKey: buildSnapshotTopologyKey(),
      runningTokenCostSummary,
      tokenCostByInstanceId: Object.entries(tokenCostByInstanceId)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([instanceId, summary]) => [instanceId, summary]),
      tokenCostErrorByInstanceId: Object.entries(tokenCostErrorByInstanceId)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([instanceId, message]) => [instanceId, message])
    })

  const rememberPendingSnapshotSync = (topologyKey: string, updatedAt: string): void => {
    const nextSync = { topologyKey, updatedAt }
    pendingSnapshotSyncs = [
      ...pendingSnapshotSyncs.filter(
        (sync) => sync.topologyKey !== topologyKey || sync.updatedAt !== updatedAt
      ),
      nextSync
    ].slice(-8)
  }

  const consumePendingSnapshotSync = (topologyKey: string, updatedAt: string): boolean => {
    const index = pendingSnapshotSyncs.findIndex(
      (sync) => sync.topologyKey === topologyKey && sync.updatedAt === updatedAt
    )
    if (index === -1) {
      return false
    }

    pendingSnapshotSyncs = pendingSnapshotSyncs.filter((_, currentIndex) => currentIndex !== index)
    return true
  }

  const readCssVar = (name: string, fallback: string): string => {
    if (typeof window === 'undefined') {
      return fallback
    }
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
  }

  const toggleStatsDisplayPopover = (): void => {
    if (showStatsDisplayPopover) {
      showStatsDisplayPopover = false
      return
    }
    statsDisplayAnchorRect = statsDisplayButton?.getBoundingClientRect() ?? null
    showStatsDisplayPopover = true
  }

  const withAlpha = (color: string, alpha: number): string => {
    const normalized = color.trim()
    if (!normalized) {
      return color
    }

    if (normalized.startsWith('#')) {
      const hex = normalized.slice(1)
      const expanded =
        hex.length === 3
          ? hex
              .split('')
              .map((segment) => segment + segment)
              .join('')
          : hex
      if (expanded.length === 6) {
        const red = Number.parseInt(expanded.slice(0, 2), 16)
        const green = Number.parseInt(expanded.slice(2, 4), 16)
        const blue = Number.parseInt(expanded.slice(4, 6), 16)
        return `rgba(${red}, ${green}, ${blue}, ${alpha})`
      }
    }

    const rgbMatch = normalized.match(/^rgba?\(([^)]+)\)$/i)
    if (rgbMatch) {
      const [red = '0', green = '0', blue = '0'] = rgbMatch[1].split(',').map((part) => part.trim())
      return `rgba(${red}, ${green}, ${blue}, ${alpha})`
    }

    const hslMatch = normalized.match(/^hsla?\(([^)]+)\)$/i)
    if (hslMatch) {
      return normalized.replace(/hsla?\(([^)]+)\)/i, (match, p1) => {
        const parts = p1.split(',')
        if (parts.length === 3) {
          return `hsla(${p1}, ${alpha})`
        }
        if (parts.length === 4) {
          parts[3] = alpha.toString()
          return `hsla(${parts.join(',')})`
        }
        return match
      })
    }

    return color
  }

  const aggregateModelBreakdowns = (
    currentDetail: TokenCostDetail | null
  ): TokenCostModelBreakdown[] => {
    if (!currentDetail) {
      return []
    }

    const byModel: Record<string, TokenCostModelBreakdown & { cost: CostRollup }> = {}
    for (const entry of currentDetail.daily) {
      for (const breakdown of entry.modelBreakdowns) {
        const existing = byModel[breakdown.modelName]
        const cost = existing?.cost ?? createCostRollup()
        addCostToRollup(cost, breakdown.costUSD)
        byModel[breakdown.modelName] = {
          modelName: breakdown.modelName,
          totalTokens: (existing?.totalTokens ?? 0) + breakdown.totalTokens,
          costUSD: finalizeCostRollup(cost),
          cost
        }
      }
    }

    return Object.values(byModel)
      .map(({ modelName, totalTokens, costUSD }) => ({
        modelName,
        totalTokens,
        costUSD
      }))
      .sort((left, right) => {
        const leftCost = left.costUSD ?? -1
        const rightCost = right.costUSD ?? -1
        if (leftCost !== rightCost) {
          return rightCost - leftCost
        }
        return right.totalTokens - left.totalTokens
      })
  }

  const syncTrendChart = (): void => {
    if (!trendCanvas) {
      return
    }

    if (!chartDaily.length) {
      trendChart?.destroy()
      trendChart = null
      return
    }

    const context = trendCanvas.getContext('2d')
    if (!context) {
      return
    }

    const accentTokens = readCssVar('--ink', '#18181b')
    const accentCost = readCssVar('--success', '#16a34a')
    const accent = trendMetric === 'tokens' ? accentTokens : accentCost
    const ink = readCssVar('--ink', '#18181b')
    const muted = readCssVar('--muted-strong', '#6b7280')
    const line = readCssVar('--line', 'rgba(24, 24, 27, 0.1)')
    const surface = readCssVar('--panel-strong', '#ffffff')

    const config: ChartConfiguration<'line', number[], string> = {
      type: 'line',
      data: {
        labels: chartDaily.map((entry) => formatDayLabel(entry.date)),
        datasets: [
          {
            label: trendMetric === 'tokens' ? copy.tokens : copy.trendMetricCost,
            data: chartDaily.map((entry) => trendMetricValue(entry)),
            borderColor: accent,
            backgroundColor: withAlpha(accent, 0.08),
            fill: true,
            tension: 0.32,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointBackgroundColor: accent,
            pointHitRadius: 14
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        animation: {
          duration: 260
        },
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            backgroundColor: surface,
            borderColor: line,
            borderWidth: 1,
            titleColor: ink,
            bodyColor: ink,
            padding: 12,
            displayColors: false,
            callbacks: {
              title: (items) => {
                const index = items[0]?.dataIndex ?? 0
                return chartDaily[index]?.date ?? items[0]?.label ?? ''
              },
              label: (context) => {
                const value = typeof context.parsed.y === 'number' ? context.parsed.y : 0
                return trendMetric === 'tokens'
                  ? `${copy.tokens}: ${formatTokens(value)}`
                  : `${copy.trendMetricCost}: ${formatCost(value)}`
              },
              afterLabel: (context) => {
                const entry = chartDaily[context.dataIndex]
                if (!entry) return ''
                const lines: string[] = []
                if (trendMetric === 'tokens') {
                  lines.push(`${copy.inputTokens}: ${formatTokens(entry.inputTokens)}`)
                  lines.push(`${copy.outputTokens}: ${formatTokens(entry.outputTokens)}`)
                  lines.push(copy.costReference(formatCost(entry.costUSD ?? null)))
                } else {
                  lines.push(`${copy.tokens}: ${formatTokens(entry.totalTokens)}`)
                  lines.push(`${copy.inputTokens}: ${formatTokens(entry.inputTokens)}`)
                  lines.push(`${copy.outputTokens}: ${formatTokens(entry.outputTokens)}`)
                }
                if (entry.modelsUsed.length) {
                  lines.push(
                    `${copy.trendTooltipModels}: ${entry.modelsUsed.length <= 3 ? entry.modelsUsed.join(', ') : `${entry.modelsUsed.slice(0, 3).join(', ')} +${entry.modelsUsed.length - 3}`}`
                  )
                }
                return lines
              }
            }
          }
        },
        scales: {
          x: {
            grid: {
              display: false
            },
            ticks: {
              color: muted,
              autoSkip: true,
              maxTicksLimit: 7
            }
          },
          y: {
            type: 'linear',
            beginAtZero: true,
            grid: {
              color: withAlpha(line, 0.55)
            },
            ticks: {
              color: muted,
              maxTicksLimit: 5,
              callback: (value) => formatTrendMetricValue(Number(value))
            }
          }
        }
      }
    }

    if (trendChart) {
      trendChart.data = config.data
      trendChart.options = config.options ?? {}
      trendChart.update()
      return
    }

    trendChart = new Chart(context, config)
  }

  const syncModelChart = (): void => {
    if (!modelCanvas) {
      return
    }

    if (!modelBreakdowns.length) {
      modelChart?.destroy()
      modelChart = null
      return
    }

    const context = modelCanvas.getContext('2d')
    if (!context) {
      return
    }

    const accentTokens = readCssVar('--ink', '#18181b')
    const ink = readCssVar('--ink', '#18181b')
    const muted = readCssVar('--muted-strong', '#6b7280')
    const line = readCssVar('--line', 'rgba(24, 24, 27, 0.1)')
    const surface = readCssVar('--panel-strong', '#ffffff')

    const config: ChartConfiguration<'bar', number[], string> = {
      type: 'bar',
      data: {
        labels: modelBreakdowns.map((entry) => entry.modelName),
        datasets: [
          {
            label: copy.tokens,
            data: modelBreakdowns.map((entry) => entry.totalTokens),
            backgroundColor: withAlpha(accentTokens, 0.75),
            borderColor: accentTokens,
            borderWidth: 1,
            borderRadius: 6,
            borderSkipped: false,
            barThickness: 16,
            maxBarThickness: 18
          }
        ]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        animation: {
          duration: 240
        },
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            backgroundColor: surface,
            borderColor: line,
            borderWidth: 1,
            titleColor: ink,
            bodyColor: ink,
            padding: 12,
            displayColors: false,
            callbacks: {
              title: (items) => items[0]?.label ?? '',
              label: (context) => {
                const model = modelBreakdowns[context.dataIndex]
                if (!model) return ''
                const totalAllTokens = modelBreakdowns.reduce((sum, m) => sum + m.totalTokens, 0)
                const tokenPct =
                  totalAllTokens > 0
                    ? ((model.totalTokens / totalAllTokens) * 100).toFixed(1)
                    : '0.0'
                return `${copy.tokens}: ${formatTokens(model.totalTokens)} (${tokenPct}%)`
              },
              afterLabel: (context) => {
                const model = modelBreakdowns[context.dataIndex]
                if (!model) return ''
                if (model.costUSD === null) {
                  return `${copy.cost}: ${copy.costUnknown}`
                }
                const totalAllCost = modelBreakdowns.reduce((sum, m) => sum + (m.costUSD ?? 0), 0)
                const costPct =
                  totalAllCost > 0 ? ((model.costUSD / totalAllCost) * 100).toFixed(1) : '0.0'
                return `${copy.cost}: ${formatCost(model.costUSD)} (${costPct}%)`
              }
            }
          }
        },
        scales: {
          x: {
            beginAtZero: true,
            grid: {
              color: withAlpha(line, 0.55)
            },
            ticks: {
              color: muted,
              maxTicksLimit: 5,
              callback: (value) => formatTokens(Number(value))
            }
          },
          y: {
            grid: {
              display: false
            },
            ticks: {
              color: ink,
              font: {
                size: 11,
                weight: 600
              }
            }
          }
        }
      }
    }

    if (modelChart) {
      modelChart.data = config.data
      modelChart.options = config.options ?? {}
      modelChart.update()
      return
    }

    modelChart = new Chart(context, config)
  }

  const syncAccountChart = (): void => {
    if (!accountCanvas) {
      return
    }

    if (!accountUsageRows.length) {
      accountChart?.destroy()
      accountChart = null
      return
    }

    const context = accountCanvas.getContext('2d')
    if (!context) {
      return
    }

    const accent = readCssVar('--success', '#16a34a')
    const ink = readCssVar('--ink', '#18181b')
    const muted = readCssVar('--muted-strong', '#6b7280')
    const line = readCssVar('--line', 'rgba(24, 24, 27, 0.1)')
    const surface = readCssVar('--panel-strong', '#ffffff')

    const config: ChartConfiguration<'bar', number[], string> = {
      type: 'bar',
      data: {
        labels: accountUsageRows.map((entry) => entry.label),
        datasets: [
          {
            label: copy.tokens,
            data: accountUsageRows.map((entry) => entry.last30DaysTokens),
            backgroundColor: withAlpha(accent, 0.72),
            borderColor: accent,
            borderWidth: 1,
            borderRadius: 6,
            borderSkipped: false,
            barThickness: 16,
            maxBarThickness: 18
          }
        ]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        animation: {
          duration: 240
        },
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            backgroundColor: surface,
            borderColor: line,
            borderWidth: 1,
            titleColor: ink,
            bodyColor: ink,
            padding: 12,
            displayColors: false,
            callbacks: {
              title: (items) => items[0]?.label ?? '',
              label: (context) => {
                const item = accountUsageRows[context.dataIndex]
                if (!item) return ''
                const totalAll = accountUsageRows.reduce(
                  (sum, row) => sum + row.last30DaysTokens,
                  0
                )
                const pct =
                  totalAll > 0 ? ((item.last30DaysTokens / totalAll) * 100).toFixed(1) : '0.0'
                return `${copy.last30Days} ${copy.tokens}: ${formatTokens(item.last30DaysTokens)} (${pct}%)`
              },
              afterLabel: (context) => {
                const item = accountUsageRows[context.dataIndex]
                if (!item) return ''
                return [
                  copy.costReference(formatCost(item.last30DaysCostUSD)),
                  `${copy.today}: ${formatTokens(item.sessionTokens)} / ${formatCost(item.sessionCostUSD)}`,
                  `${copy.instanceCount(item.instanceCount)} · ${formatUpdatedAt(item.updatedAt)}`
                ]
              }
            }
          }
        },
        scales: {
          x: {
            beginAtZero: true,
            grid: {
              color: withAlpha(line, 0.55)
            },
            ticks: {
              color: muted,
              maxTicksLimit: 5,
              callback: (value) => formatTokens(Number(value))
            }
          },
          y: {
            grid: {
              display: false
            },
            ticks: {
              color: ink,
              font: {
                size: 11,
                weight: 600
              }
            }
          }
        }
      }
    }

    if (accountChart) {
      accountChart.data = config.data
      accountChart.options = config.options ?? {}
      accountChart.update()
      return
    }

    accountChart = new Chart(context, config)
  }

  const syncInstanceChart = (): void => {
    if (!instanceCanvas) {
      return
    }

    if (!instanceUsageRows.length) {
      instanceChart?.destroy()
      instanceChart = null
      return
    }

    const context = instanceCanvas.getContext('2d')
    if (!context) {
      return
    }

    const accent = readCssVar('--ink', '#18181b')
    const ink = readCssVar('--ink', '#18181b')
    const muted = readCssVar('--muted-strong', '#6b7280')
    const line = readCssVar('--line', 'rgba(24, 24, 27, 0.1)')
    const surface = readCssVar('--panel-strong', '#ffffff')

    const config: ChartConfiguration<'bar', number[], string> = {
      type: 'bar',
      data: {
        labels: instanceUsageRows.map((entry) => entry.label),
        datasets: [
          {
            label: copy.tokens,
            data: instanceUsageRows.map((entry) => entry.tokens),
            backgroundColor: withAlpha(accent, 0.72),
            borderColor: accent,
            borderWidth: 1,
            borderRadius: 6,
            borderSkipped: false,
            barThickness: 16,
            maxBarThickness: 18
          }
        ]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        animation: {
          duration: 240
        },
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            backgroundColor: surface,
            borderColor: line,
            borderWidth: 1,
            titleColor: ink,
            bodyColor: ink,
            padding: 12,
            displayColors: false,
            callbacks: {
              title: (items) => items[0]?.label ?? '',
              label: (context) => {
                const item = instanceUsageRows[context.dataIndex]
                if (!item) return ''
                const totalAll = instanceUsageRows.reduce((sum, r) => sum + r.tokens, 0)
                const pct = totalAll > 0 ? ((item.tokens / totalAll) * 100).toFixed(1) : '0.0'
                return `${copy.last30Days} ${copy.tokens}: ${formatTokens(item.tokens)} (${pct}%)`
              },
              afterLabel: (context) => {
                const item = instanceUsageRows[context.dataIndex]
                if (!item) return ''
                const lines: string[] = []
                lines.push(copy.costReference(formatCost(item.costUSD)))
                lines.push(
                  `${copy.today}: ${formatTokens(item.sessionTokens)} / ${formatCost(item.sessionCostUSD)}`
                )
                lines.push(
                  `${item.isRunning ? copy.instanceRunning : copy.instanceStopped} · ${formatUpdatedAt(item.updatedAt)}`
                )
                return lines
              }
            }
          }
        },
        scales: {
          x: {
            beginAtZero: true,
            grid: {
              color: withAlpha(line, 0.55)
            },
            ticks: {
              color: muted,
              maxTicksLimit: 5,
              callback: (value) => formatTokens(Number(value))
            }
          },
          y: {
            grid: {
              display: false
            },
            ticks: {
              color: ink,
              font: {
                size: 11,
                weight: 600
              }
            }
          }
        }
      }
    }

    if (instanceChart) {
      instanceChart.data = config.data
      instanceChart.options = config.options ?? {}
      instanceChart.update()
      return
    }

    instanceChart = new Chart(context, config)
  }

  async function loadDetail(refresh = false): Promise<void> {
    const requestVersion = ++detailRequestVersion
    const requestTopologyKey = buildSnapshotTopologyKey()
    loadingDetail = true
    detailError = ''
    detailWarnings = []

    try {
      const nextDetail = await readTokenCost({ refresh })
      rememberPendingSnapshotSync(buildSnapshotTopologyKey(), nextDetail.summary.updatedAt)
      if (requestVersion !== detailRequestVersion) {
        return
      }
      detail = nextDetail
      detailWarnings = nextDetail.warnings ?? []
      detailTopologyKey = requestTopologyKey
    } catch (error) {
      if (requestVersion !== detailRequestVersion) {
        return
      }
      detail = null
      detailError = error instanceof Error ? error.message : copy.tokenStatsReadFailed
      detailTopologyKey = ''
    } finally {
      if (requestVersion === detailRequestVersion) {
        loadingDetail = false
      }
    }
  }

  onMount(() => {
    const observer =
      typeof MutationObserver === 'undefined'
        ? null
        : new MutationObserver(() => {
            syncTrendChart()
            syncModelChart()
            syncAccountChart()
            syncInstanceChart()
          })

    observer?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    })

    syncTrendChart()
    syncModelChart()
    syncAccountChart()
    syncInstanceChart()
    return () => {
      observer?.disconnect()
      trendChart?.destroy()
      trendChart = null
      modelChart?.destroy()
      modelChart = null
      accountChart?.destroy()
      accountChart = null
      instanceChart?.destroy()
      instanceChart = null
    }
  })

  $: {
    const key = buildSnapshotLoadKey()
    const topologyKey = buildSnapshotTopologyKey()
    if (key && key !== lastLoadedKey) {
      const shouldSkipAutoLoad = consumePendingSnapshotSync(
        topologyKey,
        snapshotSelectedSummary?.updatedAt ?? ''
      )
      lastLoadedKey = key
      if (!shouldSkipAutoLoad) {
        void loadDetail(false)
      }
    }
  }

  $: snapshotSelectedSummary =
    runningTokenCostSummary ?? Object.values(tokenCostByInstanceId)[0] ?? null
  $: selectedSummary = detail?.summary ?? snapshotSelectedSummary
  $: currentSnapshotTopologyKey = buildSnapshotTopologyKey(
    runningTokenCostInstanceIds,
    tokenCostByInstanceId,
    tokenCostErrorByInstanceId
  )
  $: snapshotError = Object.values(tokenCostErrorByInstanceId).find(Boolean) ?? ''
  $: warningMessages = [
    ...new Set(
      [
        !detail || detailTopologyKey !== currentSnapshotTopologyKey ? snapshotError : '',
        ...detailWarnings
      ].filter((message): message is string => Boolean(message))
    )
  ]
  $: modelBreakdowns = aggregateModelBreakdowns(detail)
  $: statsDisplayDraft = normalizeStatsDisplaySettings(statsDisplay)
  $: trendMetricOptions = [
    { value: 'tokens', label: copy.trendMetricTokens },
    { value: 'cost', label: copy.trendMetricCost }
  ]
  $: accountUsageRows = buildAccountConsumptionEntries({
    tokenCostByInstanceId,
    instances: codexInstances,
    accounts,
    resolveLabel: (accountId, account) => (account ? formatAccountLabel(account) : accountId)
  })
  $: instanceUsageRows = buildInstanceConsumptionEntries({
    tokenCostByInstanceId,
    instances: codexInstances,
    runningInstanceIds: runningTokenCostInstanceIds,
    resolveLabel: (instanceId, instance) => formatInstanceName(instanceId, instance)
  }).map((entry) => ({
    label: entry.label,
    tokens: entry.last30DaysTokens,
    costUSD: entry.last30DaysCostUSD,
    sessionTokens: entry.sessionTokens,
    sessionCostUSD: entry.sessionCostUSD,
    isRunning: entry.isRunning,
    updatedAt: entry.updatedAt
  }))
  $: chartDaily = detail ? [...detail.daily] : []
  $: todayEntry = (() => {
    const today = formatLocalDayKey(new Date())
    return chartDaily.find((e) => e.date === today) ?? null
  })()
  $: last30InputTokens = chartDaily.reduce((sum, e) => sum + e.inputTokens, 0)
  $: last30OutputTokens = chartDaily.reduce((sum, e) => sum + e.outputTokens, 0)
  $: dailyAvgTokens = chartDaily.length
    ? Math.round((selectedSummary?.last30DaysTokens ?? 0) / 30)
    : 0
  $: dailyAvgCost = chartDaily.length
    ? (() => {
        const totalCost = chartDaily.reduce((sum, e) => sum + (e.costUSD ?? 0), 0)
        return totalCost / 30
      })()
    : null
  $: peakDayEntry = chartDaily.length
    ? chartDaily.reduce((peak, e) => (e.totalTokens > peak.totalTokens ? e : peak), chartDaily[0])
    : null
  $: allModelsUsed = [...new Set(chartDaily.flatMap((e) => e.modelsUsed))]
  $: costStatusLabel = (() => {
    if (!chartDaily.length) return copy.costStatusNoCost
    const hasKnown = chartDaily.some((e) => e.costUSD !== null)
    const hasUnknown = modelBreakdowns.some((m) => m.costUSD === null)
    if (hasUnknown) return copy.costStatusPartialUnknown
    if (!hasKnown) return copy.costStatusNoCost
    return copy.costStatusAllKnown
  })()
  $: modelChartHeight = Math.max(280, modelBreakdowns.length * 38)
  $: accountChartHeight = Math.max(280, accountUsageRows.length * 38)
  $: instanceChartHeight = Math.max(280, instanceUsageRows.length * 38)
  $: trendChartSyncKey = [
    language,
    copy.tokens,
    copy.cost,
    copy.trendMetricTokens,
    copy.trendMetricCost,
    trendMetric,
    runningTokenCostInstanceIds.join(','),
    selectedSummary?.updatedAt ?? '',
    ...chartDaily.map((entry) => `${entry.date}:${entry.totalTokens}:${entry.costUSD ?? ''}`)
  ].join('|')
  $: modelChartSyncKey = [
    language,
    copy.tokens,
    copy.cost,
    runningTokenCostInstanceIds.join(','),
    ...modelBreakdowns.map(
      (entry) => `${entry.modelName}:${entry.totalTokens}:${entry.costUSD ?? ''}`
    )
  ].join('|')
  $: accountChartSyncKey = [
    language,
    copy.accountUsageOverview,
    copy.tokens,
    copy.cost,
    ...accountUsageRows.map(
      (entry) => `${entry.label}:${entry.last30DaysTokens}:${entry.last30DaysCostUSD ?? ''}`
    )
  ].join('|')
  $: instanceChartSyncKey = [
    language,
    copy.instanceUsage,
    copy.tokens,
    copy.cost,
    ...instanceUsageRows.map((entry) => `${entry.label}:${entry.tokens}:${entry.costUSD ?? ''}`)
  ].join('|')
  $: if (!trendCanvas && trendChart) {
    trendChart.destroy()
    trendChart = null
  }
  $: if (!modelCanvas && modelChart) {
    modelChart.destroy()
    modelChart = null
  }
  $: if (!accountCanvas && accountChart) {
    accountChart.destroy()
    accountChart = null
  }
  $: if (!instanceCanvas && instanceChart) {
    instanceChart.destroy()
    instanceChart = null
  }
  $: if (trendCanvas && trendChartSyncKey) {
    syncTrendChart()
  }
  $: if (modelCanvas && modelChartSyncKey) {
    syncModelChart()
  }
  $: if (accountCanvas && accountChartSyncKey) {
    syncAccountChart()
  }
  $: if (instanceCanvas && instanceChartSyncKey) {
    syncInstanceChart()
  }
</script>

<div
  class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4"
  use:reveal={{ delay: 0.02 }}
>
  <section
    class="stats-stage theme-soft-panel rounded-[0.55rem] border border-[var(--card-border)] px-4 py-4 sm:px-5 sm:py-5"
    use:cascadeIn={{
      selector: '[data-motion-item]'
    }}
  >
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div class="grid gap-2" data-motion-item>
        <p class="text-[11px] font-bold uppercase tracking-[0.26em] text-faint opacity-80">
          {copy.tokenStats}
        </p>
        <h2 class="text-[1.4rem] font-semibold tracking-[-0.03em] text-carbon sm:text-[1.65rem]">
          {copy.tokenStatsTitle}
        </h2>
        <p class="max-w-2xl text-sm text-muted-strong">
          {copy.tokenStatsDescription}
        </p>
      </div>

      <div class="relative flex items-center gap-2" data-motion-item>
        <AppButton
          variant="icon"
          size="sm"
          bind:element={statsDisplayButton}
          ariaLabel={copy.displayConfig}
          ariaExpanded={showStatsDisplayPopover}
          ariaHaspopup="dialog"
          onclick={toggleStatsDisplayPopover}
        >
          <span class="i-lucide-sliders-horizontal h-4 w-4"></span>
        </AppButton>

        <AppPopover
          open={showStatsDisplayPopover}
          anchorRect={statsDisplayAnchorRect}
          align="end"
          ignoreNode={statsDisplayButton}
          class="stats-config-popover w-[min(20rem,calc(100vw-2rem))] rounded-[0.45rem] px-4 py-4"
          onclose={() => {
            showStatsDisplayPopover = false
          }}
        >
          <div role="dialog" aria-label={copy.displayConfig} use:reveal={{ y: -4, duration: 0.12 }}>
            <div class="mb-3 grid gap-1">
              <p class="text-sm font-semibold tracking-tight text-carbon">{copy.displayConfig}</p>
              <p class="text-xs leading-5 text-muted-strong">{copy.displayConfigDescription}</p>
            </div>
            <div class="grid gap-2">
              {#each [{ key: 'dailyTrend', label: copy.dailyTrend }, { key: 'modelBreakdown', label: copy.modelBreakdown }, { key: 'instanceUsage', label: copy.instanceUsage }] as option (option.key)}
                <label
                  class="stats-toggle-row flex items-center justify-between gap-3 rounded-[0.35rem] px-3 py-2 text-sm text-carbon"
                >
                  <span class="font-medium">{option.label}</span>
                  <Checkbox
                    checked={statsDisplayDraft[option.key]}
                    onCheckedChange={(checked) => setStatsDisplay(option.key, checked)}
                  />
                </label>
              {/each}
            </div>
          </div>
        </AppPopover>

        <AppButton
          variant="secondary"
          size="sm"
          onclick={() => loadDetail(true)}
          disabled={loadingDetail}
        >
          <span
            class={`${loadingDetail ? 'i-lucide-loader-circle animate-spin' : 'i-lucide-refresh-cw'} h-4 w-4`}
          ></span>
          <span>{loadingDetail ? copy.refreshing : copy.refresh}</span>
        </AppButton>
      </div>
    </div>

    <div class="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.18fr)_minmax(300px,0.82fr)]">
      <div class="grid gap-4" data-motion-item>
        <div class="grid gap-3 sm:grid-cols-2">
          <div
            class="stats-metric-block stats-metric-tokens group grid gap-2 rounded-[0.45rem] px-4 py-4 sm:px-5"
            data-motion-item
          >
            <div class="flex items-center justify-between gap-3">
              <p class="text-[11px] font-bold uppercase tracking-[0.24em] text-faint">
                {copy.today}
              </p>
              <span class="h-1.5 w-1.5 rounded-full bg-ink/60"></span>
            </div>
            <div class="flex items-end gap-2">
              <span
                class="text-[1.8rem] font-semibold tabular-nums tracking-[-0.04em] text-carbon sm:text-[2.25rem]"
              >
                {formatTokens(selectedSummary?.sessionTokens ?? 0)}
              </span>
              <span
                class="pb-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-strong"
              >
                {copy.tokens}
              </span>
            </div>
            <p class="text-sm font-medium tabular-nums text-muted-strong">
              {copy.costReference(formatCost(selectedSummary?.sessionCostUSD ?? null))}
            </p>
          </div>

          <div
            class="stats-metric-block stats-metric-cost group grid gap-2 rounded-[0.45rem] px-4 py-4 sm:px-5"
            data-motion-item
          >
            <div class="flex items-center justify-between gap-3">
              <p class="text-[11px] font-bold uppercase tracking-[0.24em] text-faint">
                {copy.last30Days}
              </p>
              <span class="h-1.5 w-1.5 rounded-full bg-success/60"></span>
            </div>
            <div class="flex items-end gap-2">
              <span
                class="text-[1.8rem] font-semibold tabular-nums tracking-[-0.04em] text-carbon sm:text-[2.25rem]"
              >
                {formatTokens(selectedSummary?.last30DaysTokens ?? 0)}
              </span>
              <span
                class="pb-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-strong"
              >
                {copy.tokens}
              </span>
            </div>
            <p class="text-sm font-medium tabular-nums text-muted-strong">
              {copy.costReference(formatCost(selectedSummary?.last30DaysCostUSD ?? null))}
            </p>
          </div>
        </div>
      </div>

      <div
        class="stats-info-rail grid gap-3 rounded-[0.45rem] border px-4 py-4 sm:px-5"
        data-motion-item
      >
        <div class="grid gap-1">
          <p class="text-[11px] font-bold uppercase tracking-[0.2em] text-faint">
            {copy.updatedAt}
          </p>
          <p class="text-sm font-medium tabular-nums text-carbon">
            {formatUpdatedAt(selectedSummary?.updatedAt)}
          </p>
        </div>

        <div class="grid grid-cols-2 gap-3 border-t border-arcticMist/70 pt-3">
          <div class="grid gap-1">
            <p class="text-[10px] font-bold uppercase tracking-[0.18em] text-faint">
              {copy.statsDays}
            </p>
            <p class="text-sm font-medium text-carbon">{chartDaily.length}</p>
          </div>
          <div class="grid gap-1">
            <p class="text-[10px] font-bold uppercase tracking-[0.18em] text-faint">
              {copy.modelsUsedCount}
            </p>
            <p class="text-sm font-medium text-carbon">{allModelsUsed.length}</p>
          </div>
          <div class="grid gap-1">
            <p class="text-[10px] font-bold uppercase tracking-[0.18em] text-faint">
              {copy.dailyAvgTokens}
            </p>
            <p class="text-sm font-medium tabular-nums text-carbon">
              {formatTokens(dailyAvgTokens)}
            </p>
          </div>
          <div class="grid gap-1">
            <p class="text-[10px] font-bold uppercase tracking-[0.18em] text-faint">
              {copy.dailyAvgCost}
            </p>
            <p class="text-sm font-medium tabular-nums text-carbon">{formatCost(dailyAvgCost)}</p>
          </div>
          {#if peakDayEntry}
            <div class="grid gap-1">
              <p class="text-[10px] font-bold uppercase tracking-[0.18em] text-faint">
                {copy.peakDay}
              </p>
              <p class="text-sm font-medium tabular-nums text-carbon">
                {formatDayLabel(peakDayEntry.date)}
              </p>
            </div>
            <div class="grid gap-1">
              <p class="text-[10px] font-bold uppercase tracking-[0.18em] text-faint">
                {copy.peakDayTokens}
              </p>
              <p class="text-sm font-medium tabular-nums text-carbon">
                {formatTokens(peakDayEntry.totalTokens)}
              </p>
            </div>
          {/if}
          <div class="grid gap-1">
            <p class="text-[10px] font-bold uppercase tracking-[0.18em] text-faint">
              {copy.costStatus}
            </p>
            <p class="text-sm font-medium text-carbon">{costStatusLabel}</p>
          </div>
        </div>

        {#if todayEntry}
          <div class="grid grid-cols-2 gap-3 border-t border-arcticMist/70 pt-3">
            <div class="grid gap-1">
              <p class="text-[10px] font-bold uppercase tracking-[0.18em] text-faint">
                {copy.today}
                {copy.inputTokens}
              </p>
              <p class="text-sm font-medium tabular-nums text-carbon">
                {formatTokens(todayEntry.inputTokens)}
              </p>
            </div>
            <div class="grid gap-1">
              <p class="text-[10px] font-bold uppercase tracking-[0.18em] text-faint">
                {copy.today}
                {copy.outputTokens}
              </p>
              <p class="text-sm font-medium tabular-nums text-carbon">
                {formatTokens(todayEntry.outputTokens)}
              </p>
            </div>
          </div>
        {/if}

        {#if chartDaily.length}
          <div class="grid grid-cols-2 gap-3 border-t border-arcticMist/70 pt-3">
            <div class="grid gap-1">
              <p class="text-[10px] font-bold uppercase tracking-[0.18em] text-faint">
                {copy.last30Days}
                {copy.inputTokens}
              </p>
              <p class="text-sm font-medium tabular-nums text-carbon">
                {formatTokens(last30InputTokens)}
              </p>
            </div>
            <div class="grid gap-1">
              <p class="text-[10px] font-bold uppercase tracking-[0.18em] text-faint">
                {copy.last30Days}
                {copy.outputTokens}
              </p>
              <p class="text-sm font-medium tabular-nums text-carbon">
                {formatTokens(last30OutputTokens)}
              </p>
            </div>
          </div>
        {/if}

        {#if detailError}
          <div
            class="rounded-[0.45rem] border border-danger/18 bg-danger/6 px-3 py-3 text-sm text-danger"
          >
            {detailError}
          </div>
        {:else if loadingDetail && !detail}
          <div
            class="flex items-center gap-2 rounded-[0.45rem] border border-arcticMist bg-snow/50 px-3 py-3 text-sm text-muted-strong"
          >
            <span class="i-lucide-loader-circle h-4 w-4 animate-spin"></span>
            <span>{copy.refreshing}</span>
          </div>
        {:else if !summaryHasData(selectedSummary)}
          <div
            class="grid gap-1.5 rounded-[0.45rem] border border-dashed border-arcticMist bg-snow/35 px-3 py-3 text-sm text-muted-strong"
          >
            <p class="font-medium">{copy.tokenStatsNoData}</p>
            <ul class="grid gap-0.5 pl-3 text-xs opacity-80">
              <li>· {copy.emptyReasonNoLogs}</li>
              <li>· {copy.emptyReasonNoTokenCount}</li>
              <li>· {copy.emptyReasonNoRecentUsage}</li>
            </ul>
          </div>
        {/if}

        {#if warningMessages.length}
          <div
            class="grid gap-2 rounded-[0.45rem] border border-danger/18 bg-danger/6 px-3 py-3 text-sm text-danger"
          >
            {#each warningMessages as message (message)}
              <p>{message}</p>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </section>

  <section
    class="stats-surface flex flex-col rounded-[0.45rem] border px-4 py-4 sm:px-5"
    use:reveal={{ delay: 0.04 }}
  >
    <div class="flex items-center justify-between gap-3 border-b border-arcticMist/70 pb-3">
      <div>
        <h4 class="text-sm font-semibold tracking-tight text-carbon">
          {copy.accountUsageOverview}
        </h4>
        <p class="mt-1 text-xs text-muted-strong">{copy.accountUsageOverviewDescription}</p>
      </div>
      <span class="i-lucide-users-round h-4 w-4 text-muted-strong opacity-60"></span>
    </div>

    <div
      class="mt-3 rounded-[0.4rem] border border-arcticMist/70 bg-snow/35 px-3 py-2 text-xs leading-5 text-muted-strong"
    >
      {copy.accountUsageAttributionHint}
    </div>

    {#if accountUsageRows.length}
      <div class="stats-chart-shell mt-4 rounded-[0.35rem] border px-3 py-4 sm:px-4">
        <div class="stats-model-chart-canvas" style={`min-height: ${accountChartHeight}px`}>
          <canvas bind:this={accountCanvas} aria-label={copy.accountUsageOverview}></canvas>
        </div>
      </div>

      <div class="mt-3 grid gap-2.5">
        {#each accountUsageRows as row (row.accountId)}
          <article
            class="account-usage-row grid gap-3 rounded-[0.45rem] border px-3.5 py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:px-4"
          >
            <div class="min-w-0">
              <p class="truncate text-sm font-semibold text-carbon" title={row.label}>
                {row.label}
              </p>
              <p class="mt-1 text-[11px] text-muted-strong">
                {copy.instanceCount(row.instanceCount)} · {copy.updatedAt}: {formatUpdatedAt(
                  row.updatedAt
                )}
              </p>
            </div>
            <div class="grid gap-1 text-sm tabular-nums text-carbon sm:text-right">
              <span class="font-semibold">{formatTokens(row.last30DaysTokens)}</span>
              <span class="text-[11px] text-muted-strong">{copy.last30Days} {copy.tokens}</span>
            </div>
            <div class="grid gap-1 text-sm tabular-nums text-carbon sm:text-right">
              <span class="font-semibold">{formatCost(row.last30DaysCostUSD)}</span>
              <span class="text-[11px] text-muted-strong">{copy.cost}</span>
            </div>
          </article>
        {/each}
      </div>
    {:else}
      <div class="mt-4 stats-empty-state">
        <span class="i-lucide-users h-8 w-8 opacity-20"></span>
        <p class="text-sm font-semibold text-carbon">{copy.accountUsageNoData}</p>
        <p class="max-w-md text-sm font-medium text-muted-strong">
          {copy.accountUsageUnavailable}
        </p>
      </div>
    {/if}
  </section>

  <div class="grid gap-4">
    {#if !statsDisplayDraft.modelBreakdown && !statsDisplayDraft.dailyTrend && !statsDisplayDraft.instanceUsage}
      <div class="stats-empty-state">
        <span class="i-lucide-layout-dashboard h-8 w-8 opacity-20"></span>
        <p class="text-sm font-medium text-muted-strong">{copy.noChartsVisible}</p>
      </div>
    {/if}

    {#if statsDisplayDraft.modelBreakdown}
      <section
        class="stats-surface flex flex-col rounded-[0.45rem] border px-4 py-4 sm:px-5"
        use:reveal={{ delay: 0.04 }}
      >
        <div class="flex items-center justify-between gap-3 border-b border-arcticMist/70 pb-3">
          <div>
            <h4 class="text-sm font-semibold tracking-tight text-carbon">{copy.modelBreakdown}</h4>
            <p class="mt-1 text-xs text-muted-strong">{copy.last30Days}</p>
          </div>
          <span class="i-lucide-pie-chart h-4 w-4 text-muted-strong opacity-60"></span>
        </div>

        {#if modelBreakdowns.length}
          <div
            class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs text-muted-strong"
          >
            {#if modelBreakdowns[0]}
              {@const totalAllTokens = modelBreakdowns.reduce((sum, m) => sum + m.totalTokens, 0)}
              {@const topPct =
                totalAllTokens > 0
                  ? ((modelBreakdowns[0].totalTokens / totalAllTokens) * 100).toFixed(1)
                  : '0.0'}
              <span class="font-medium"
                >{copy.topModel}: {copy.topModelSummary(
                  modelBreakdowns[0].modelName,
                  `${topPct}%`
                )}</span
              >
            {/if}
            {#if modelBreakdowns.some((m) => m.costUSD === null)}
              <span class="text-warning">{copy.costUnknownModelsHint}</span>
            {/if}
          </div>
          <div class="stats-chart-shell mt-4 rounded-[0.35rem] border px-3 py-4 sm:px-4">
            <div class="stats-model-chart-canvas" style={`min-height: ${modelChartHeight}px`}>
              <canvas bind:this={modelCanvas} aria-label={copy.modelBreakdown}></canvas>
            </div>
          </div>
        {:else}
          <div class="mt-4 stats-empty-state">
            <span class="i-lucide-layers h-8 w-8 opacity-20"></span>
            <p class="text-sm font-medium text-muted-strong">{copy.tokenStatsNoData}</p>
          </div>
        {/if}
      </section>
    {/if}

    {#if statsDisplayDraft.instanceUsage}
      <section
        class="stats-surface flex flex-col rounded-[0.45rem] border px-4 py-4 sm:px-5"
        use:reveal={{ delay: 0.08 }}
      >
        <div class="flex items-center justify-between gap-3 border-b border-arcticMist/70 pb-3">
          <div>
            <h4 class="text-sm font-semibold tracking-tight text-carbon">{copy.instanceUsage}</h4>
            <p class="mt-1 text-xs text-muted-strong">{copy.instanceUsageDescription}</p>
          </div>
          <span class="i-lucide-monitor-smartphone h-4 w-4 text-muted-strong opacity-60"></span>
        </div>

        {#if instanceUsageRows.length}
          <div class="stats-chart-shell mt-4 rounded-[0.35rem] border px-3 py-4 sm:px-4">
            <div class="stats-model-chart-canvas" style={`min-height: ${instanceChartHeight}px`}>
              <canvas bind:this={instanceCanvas} aria-label={copy.instanceUsage}></canvas>
            </div>
          </div>
        {:else}
          <div class="mt-4 stats-empty-state">
            <span class="i-lucide-monitor-x h-8 w-8 opacity-20"></span>
            <p class="text-sm font-medium text-muted-strong">{copy.tokenStatsNoData}</p>
          </div>
        {/if}
      </section>
    {/if}
  </div>

  {#if statsDisplayDraft.dailyTrend}
    <section
      class="stats-surface flex flex-col rounded-[0.45rem] border px-4 py-4 sm:px-5"
      use:reveal={{ delay: 0.12 }}
    >
      <div
        class="flex flex-wrap items-center justify-between gap-3 border-b border-arcticMist/70 pb-3"
      >
        <div>
          <h4 class="text-sm font-semibold tracking-tight text-carbon">{copy.dailyTrend}</h4>
          <p class="mt-1 text-xs text-muted-strong">
            {formatTokens(selectedSummary?.last30DaysTokens ?? 0)}
            {copy.tokens}
            <span class="mx-1.5 opacity-40">·</span>
            {copy.costReference(formatCost(selectedSummary?.last30DaysCostUSD ?? null))}
          </p>
        </div>
        <div class="flex items-center gap-2">
          <div
            class="stats-trend-switch relative inline-flex rounded-full p-[2px]"
            role="group"
            aria-label={copy.trendMetric}
          >
            <span
              class="stats-trend-switch-indicator absolute top-[2px] bottom-[2px] rounded-full transition-transform duration-200 ease-out"
              style={`width: calc(50% - 2px); transform: translateX(${trendMetric === trendMetricOptions[0]?.value ? '0%' : '100%'})`}
            ></span>
            {#each trendMetricOptions as option (option.value)}
              <button
                type="button"
                class={`stats-trend-switch-button relative rounded-full px-3.5 py-1 text-[11px] font-semibold ${trendMetric === option.value ? 'is-active' : ''}`}
                aria-pressed={trendMetric === option.value}
                onclick={() => {
                  trendMetric = option.value
                }}
              >
                {option.label}
              </button>
            {/each}
          </div>
          <span class="i-lucide-chart-column-big h-4 w-4 text-muted-strong opacity-60"></span>
        </div>
      </div>

      {#if chartDaily.length}
        <div class="stats-chart-shell mt-4 rounded-[0.35rem] border px-3 py-4 sm:px-4">
          <div class="stats-chart-canvas">
            <canvas bind:this={trendCanvas} aria-label={copy.dailyTrend}></canvas>
          </div>
        </div>
      {:else}
        <div class="mt-4 stats-empty-state">
          <span class="i-lucide-chart-no-axes-combined h-8 w-8 opacity-20"></span>
          <p class="text-sm font-medium text-muted-strong">{copy.tokenStatsNoData}</p>
        </div>
      {/if}
    </section>
  {/if}
</div>

<style>
  .stats-stage {
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, var(--edge-light) 64%, transparent),
      0 1px 0 color-mix(in srgb, var(--edge-dark) 16%, transparent);
  }

  .stats-surface {
    border-color: color-mix(in srgb, var(--line-strong) 76%, transparent);
    background: color-mix(in srgb, var(--panel-strong) 92%, var(--surface-soft));
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, var(--edge-light) 46%, transparent),
      0 1px 0 color-mix(in srgb, var(--edge-dark) 14%, transparent);
    transition:
      border-color 140ms ease,
      box-shadow 140ms ease;
  }

  .stats-surface:hover {
    border-color: color-mix(in srgb, var(--line-strong) 92%, transparent);
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, var(--edge-light) 64%, transparent),
      0 2px 6px color-mix(in srgb, var(--edge-dark) 18%, transparent);
  }

  .stats-info-rail {
    border-color: color-mix(in srgb, var(--line-strong) 68%, transparent);
    background: color-mix(in srgb, var(--panel-strong) 84%, var(--surface-soft));
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, var(--edge-light) 44%, transparent),
      0 1px 0 color-mix(in srgb, var(--edge-dark) 12%, transparent);
  }

  .account-usage-row {
    border-color: color-mix(in srgb, var(--line-strong) 58%, transparent);
    background: color-mix(in srgb, var(--panel-strong) 92%, transparent);
    box-shadow: inset 0 1px 0 color-mix(in srgb, var(--edge-light) 36%, transparent);
  }

  .account-usage-row {
    transition:
      border-color 140ms ease,
      background-color 140ms ease,
      box-shadow 140ms ease;
  }

  .account-usage-row:hover {
    border-color: color-mix(in srgb, var(--line-strong) 82%, transparent);
    background: color-mix(in srgb, var(--panel-strong) 98%, transparent);
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, var(--edge-light) 52%, transparent),
      0 1px 4px color-mix(in srgb, var(--edge-dark) 12%, transparent);
  }

  .stats-metric-block {
    border: 1px solid color-mix(in srgb, var(--line-strong) 76%, transparent);
    background: color-mix(in srgb, var(--panel-strong) 96%, transparent);
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, var(--edge-light) 44%, transparent),
      0 1px 0 color-mix(in srgb, var(--edge-dark) 12%, transparent);
    transition:
      background-color 140ms ease,
      border-color 140ms ease,
      box-shadow 140ms ease;
  }

  .stats-metric-block:hover {
    border-color: color-mix(in srgb, var(--line-strong) 92%, transparent);
    background: color-mix(in srgb, var(--panel-strong) 100%, transparent);
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, var(--edge-light) 64%, transparent),
      0 2px 6px color-mix(in srgb, var(--edge-dark) 18%, transparent);
  }

  .stats-config-popover {
    background: var(--panel-strong);
    border-color: color-mix(in srgb, var(--line-strong) 76%, transparent);
    box-shadow: var(--elevation-2);
  }

  .stats-toggle-row {
    background: color-mix(in srgb, var(--surface-soft) 72%, transparent);
    border: 1px solid color-mix(in srgb, var(--line-strong) 48%, transparent);
    box-shadow: none;
    transition:
      background-color 140ms ease,
      border-color 140ms ease;
  }

  .stats-toggle-row:hover {
    background: var(--surface-hover);
    border-color: color-mix(in srgb, var(--line-strong) 72%, transparent);
  }

  .stats-trend-switch {
    background: color-mix(in srgb, var(--ink) 18%, transparent);
    border: 1px solid color-mix(in srgb, var(--ink) 16%, transparent);
  }

  .stats-trend-switch-indicator {
    background: var(--ink);
    left: 2px;
    z-index: 0;
    box-shadow: 0 1px 2px color-mix(in srgb, var(--edge-dark) 20%, transparent);
  }

  .stats-trend-switch-button {
    color: color-mix(in srgb, var(--ink) 65%, transparent);
    z-index: 1;
    background: transparent;
    border: 0;
    cursor: pointer;
    transition: color 180ms ease;
  }

  .stats-trend-switch-button:hover:not(.is-active) {
    color: var(--ink);
  }

  .stats-trend-switch-button.is-active {
    color: var(--panel-strong);
  }

  .stats-chart-shell {
    border-color: color-mix(in srgb, var(--line-strong) 68%, transparent);
    background: color-mix(in srgb, var(--panel-strong) 84%, var(--surface-soft));
    box-shadow: inset 0 1px 0 color-mix(in srgb, var(--edge-light) 38%, transparent);
  }

  .stats-chart-canvas {
    position: relative;
    min-height: 300px;
  }

  .stats-chart-canvas canvas {
    display: block;
    height: 100% !important;
    width: 100% !important;
  }

  .stats-model-chart-canvas {
    position: relative;
  }

  .stats-model-chart-canvas canvas {
    display: block;
    height: 100% !important;
    width: 100% !important;
  }

  .stats-empty-state {
    display: flex;
    min-height: 180px;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    border: 1px dashed color-mix(in srgb, var(--line-strong) 48%, transparent);
    border-radius: 0.45rem;
    background: color-mix(in srgb, var(--surface-soft) 36%, transparent);
    box-shadow: inset 0 2px 8px color-mix(in srgb, var(--edge-dark) 6%, transparent);
    text-align: center;
  }

  @media (prefers-reduced-motion: reduce) {
    .stats-surface,
    .stats-metric-block,
    .stats-toggle-row {
      transition-duration: 0ms;
    }
  }
</style>
