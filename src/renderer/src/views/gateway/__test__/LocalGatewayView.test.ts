// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { messages } from '$lib/view/app-view'

type MockChartConfig = {
  type: string
  data?: {
    labels?: unknown[]
    datasets?: Array<{ label?: string; data?: unknown[] }>
  }
  options?: unknown
}

type MockChartOptions = {
  events?: string[]
  transitions?: {
    active?: {
      animation?: {
        duration?: number
      }
    }
  }
}

const { chartConfigs } = vi.hoisted(() => ({
  chartConfigs: [] as MockChartConfig[]
}))

vi.mock('chart.js', () => {
  class MockChart {
    static register = vi.fn()
    type: string
    data: unknown
    options: unknown
    chartArea = { left: 0, top: 0, right: 500, bottom: 500 }

    constructor(_context: unknown, config: MockChartConfig) {
      this.type = config.type
      this.data = config.data
      this.options = config.options
      chartConfigs.push(config)
    }

    getElementsAtEventForMode(event: MouseEvent): Array<{ index: number }> {
      const values = (this.data as MockChartConfig['data'])?.datasets?.[0]?.data ?? []
      const index = Math.floor(event.clientY / 34)
      const value = Number(values[index])
      const max = Math.max(...values.map((item) => Number(item)), 1)
      const barEnd = (value / max) * this.chartArea.right
      if (Number.isFinite(value) && value > 0 && event.clientX >= 0 && event.clientX <= barEnd) {
        return [{ index }]
      }
      return []
    }

    update(): void {
      chartConfigs.push({
        type: this.type,
        data: this.data as MockChartConfig['data'],
        options: this.options
      })
    }

    destroy(): void {
      return undefined
    }
  }

  class MockChartPart {}

  return {
    BarController: MockChartPart,
    BarElement: MockChartPart,
    CategoryScale: MockChartPart,
    Chart: MockChart,
    Legend: MockChartPart,
    LinearScale: MockChartPart,
    Tooltip: MockChartPart
  }
})

import LocalGatewayView from '../LocalGatewayView.svelte'

const copy = messages['zh-CN']
const status = {
  running: false,
  baseUrl: 'http://127.0.0.1:11456',
  apiKeyPreview: 'sk-cdock-a…1234',
  logs: []
}

function installCodexAppMock(): void {
  Object.defineProperty(window, 'codexApp', {
    configurable: true,
    value: {
      getLocalGatewayStatus: vi.fn().mockResolvedValue(status),
      getLocalGatewayApiKey: vi.fn().mockResolvedValue('sk-cdock-full-secret')
    }
  })
}

function renderGateway(props = {}): ReturnType<typeof render> {
  return render(LocalGatewayView, {
    props: {
      copy,
      localGatewayStatus: status,
      localGatewayBusy: false,
      localGatewayApiKey: '',
      modelMappings: [],
      allowedGroupIds: ['group-1'],
      allowedAccountIds: [],
      groups: [{ id: 'group-1', name: '默认组', createdAt: '2026-01-01T00:00:00.000Z' }],
      accounts: [],
      startLocalGateway: vi.fn().mockResolvedValue(undefined),
      stopLocalGateway: vi.fn().mockResolvedValue(undefined),
      updateModelMappings: vi.fn().mockResolvedValue(undefined),
      updateAllowedGroups: vi.fn().mockResolvedValue(undefined),
      updateAllowedAccounts: vi.fn().mockResolvedValue(undefined),
      updateAutoStart: vi.fn().mockResolvedValue(undefined),
      ...props
    }
  })
}

function latestChartConfig(): (typeof chartConfigs)[number] {
  const config = chartConfigs.at(-1)
  if (!config) {
    throw new Error('Chart.js mock has not received any config')
  }
  return config
}

function usageCanvas(container: HTMLElement): HTMLCanvasElement {
  const canvas = container.querySelector(`canvas[aria-label="${copy.accountUsageOverview}"]`)
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('Usage canvas not found')
  }
  canvas.getBoundingClientRect = vi.fn(
    () =>
      ({
        left: 0,
        top: 0,
        right: 500,
        bottom: 300,
        width: 500,
        height: 300,
        x: 0,
        y: 0,
        toJSON: () => ({})
      }) as DOMRect
  )
  return canvas
}

describe('LocalGatewayView', () => {
  beforeEach(() => {
    chartConfigs.length = 0
    installCodexAppMock()
  })

  it('reveals and hides the local gateway API key on demand', async () => {
    renderGateway()

    await fireEvent.click(screen.getByRole('button', { name: copy.localGatewayShowApiKey }))
    await waitFor(() => expect(screen.getByText('sk-cdock-full-secret')).toBeTruthy())
    expect(window.codexApp.getLocalGatewayApiKey).toHaveBeenCalledOnce()

    await fireEvent.click(screen.getByRole('button', { name: copy.localGatewayHideApiKey }))
    expect(screen.queryByText('sk-cdock-full-secret')).toBeNull()
  })

  it('opens local gateway in direct and isolated Codex modes', async () => {
    const openLocalGatewayInCodex = vi.fn().mockResolvedValue(undefined)
    const openLocalGatewayIsolatedInCodex = vi.fn().mockResolvedValue(undefined)
    renderGateway({
      localGatewayStatus: {
        ...status,
        running: true
      },
      openLocalGatewayInCodex,
      openLocalGatewayIsolatedInCodex
    })

    await fireEvent.click(screen.getByRole('button', { name: copy.localGatewayOpenCodex }))
    expect(openLocalGatewayInCodex).toHaveBeenCalledOnce()

    await fireEvent.click(screen.getByRole('button', { name: copy.localGatewayOpenCodexIsolated }))
    expect(openLocalGatewayIsolatedInCodex).toHaveBeenCalledOnce()
  })

  it('rotates api key from the api key config row', async () => {
    const rotateLocalGatewayKey = vi.fn().mockResolvedValue(undefined)
    renderGateway({ rotateLocalGatewayKey })

    await fireEvent.click(screen.getByRole('button', { name: copy.rotateLocalGatewayKey }))

    expect(rotateLocalGatewayKey).toHaveBeenCalledOnce()
  })

  it('updates local gateway auto-start setting', async () => {
    const updateAutoStart = vi.fn().mockResolvedValue(undefined)
    renderGateway({ autoStart: false, updateAutoStart })

    await fireEvent.click(screen.getByLabelText(copy.localGatewayAutoStart))

    expect(updateAutoStart).toHaveBeenCalledWith(true)
  })

  it('hides duplicated port conflict error when occupant details are shown', () => {
    renderGateway({
      localGatewayStatus: {
        ...status,
        lastError: 'listen EADDRINUSE: address already in use 127.0.0.1:11456'
      },
      portOccupant: {
        command: 'CodexDock',
        pid: 76451
      }
    })

    expect(
      screen.queryByText('listen EADDRINUSE: address already in use 127.0.0.1:11456')
    ).toBeNull()
    expect(screen.getByText(copy.localGatewayPortOccupied(11456, 'CodexDock', 76451))).toBeTruthy()
  })

  it('manages model mappings from a dialog', async () => {
    const updateModelMappings = vi.fn().mockResolvedValue(undefined)
    renderGateway({ updateModelMappings })

    await fireEvent.click(
      screen.getByRole('button', { name: copy.localGatewayModelMappingsManage })
    )
    await fireEvent.input(
      screen.getByPlaceholderText(copy.localGatewayModelMappingFromPlaceholder),
      {
        target: { value: 'client-model' }
      }
    )
    await fireEvent.input(screen.getByPlaceholderText(copy.localGatewayModelMappingToPlaceholder), {
      target: { value: 'gpt-5.4' }
    })
    await fireEvent.click(screen.getByRole('button', { name: copy.localGatewayModelMappingAdd }))

    await waitFor(() =>
      expect(updateModelMappings).toHaveBeenCalledWith([{ from: 'client-model', to: 'gpt-5.4' }])
    )
  })

  it('allows routing by individual accounts and uses account-aware copy', async () => {
    const updateAllowedAccounts = vi.fn().mockResolvedValue(undefined)
    renderGateway({
      allowedGroupIds: [],
      accounts: [
        {
          id: 'account-1',
          email: 'bee@example.com',
          name: 'Bee',
          accountId: 'acct-1',
          groupIds: [],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      updateAllowedAccounts
    })

    expect(screen.getByText(copy.localGatewayAllowedGroupsTitle)).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: copy.localGatewayAllowedTargetsAdd }))
    await fireEvent.click(screen.getByRole('button', { name: 'bee@example.com' }))

    await waitFor(() => expect(updateAllowedAccounts).toHaveBeenCalledWith(['account-1']))
  })

  it('allows choosing grouped accounts individually when their group is not selected', async () => {
    const updateAllowedAccounts = vi.fn().mockResolvedValue(undefined)
    renderGateway({
      allowedGroupIds: [],
      allowedAccountIds: [],
      groups: [{ id: 'group-1', name: '默认组', createdAt: '2026-01-01T00:00:00.000Z' }],
      accounts: [
        {
          id: 'grouped-account',
          email: 'grouped@example.com',
          name: 'Grouped',
          accountId: 'acct-grouped',
          groupIds: ['group-1'],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        },
        {
          id: 'standalone-account',
          email: 'standalone@example.com',
          name: 'Standalone',
          accountId: 'acct-standalone',
          groupIds: [],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      updateAllowedAccounts
    })

    await fireEvent.click(screen.getByRole('button', { name: copy.localGatewayAllowedTargetsAdd }))

    expect(screen.getByText('grouped@example.com')).toBeTruthy()
    expect(screen.getByText('standalone@example.com')).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'grouped@example.com' }))

    await waitFor(() => expect(updateAllowedAccounts).toHaveBeenCalledWith(['grouped-account']))
  })

  it('hides member accounts when their group is selected and drops duplicate account targets', async () => {
    const updateAllowedGroups = vi.fn().mockResolvedValue(undefined)
    const updateAllowedAccounts = vi.fn().mockResolvedValue(undefined)
    const groupedAccount = {
      id: 'grouped-account',
      email: 'grouped@example.com',
      name: 'Grouped',
      accountId: 'acct-grouped',
      groupIds: ['group-1'],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }

    const view = renderGateway({
      allowedGroupIds: [],
      allowedAccountIds: ['grouped-account'],
      groups: [{ id: 'group-1', name: '默认组', createdAt: '2026-01-01T00:00:00.000Z' }],
      accounts: [groupedAccount],
      updateAllowedGroups,
      updateAllowedAccounts
    })

    expect(screen.getByText('grouped@example.com')).toBeTruthy()

    await fireEvent.click(screen.getByRole('button', { name: copy.localGatewayAllowedTargetsAdd }))
    await fireEvent.click(screen.getByRole('button', { name: '默认组' }))

    await waitFor(() => expect(updateAllowedGroups).toHaveBeenCalledWith(['group-1']))
    await waitFor(() => expect(updateAllowedAccounts).toHaveBeenCalledWith([]))

    view.unmount()

    renderGateway({
      allowedGroupIds: ['group-1'],
      allowedAccountIds: ['grouped-account'],
      groups: [{ id: 'group-1', name: '默认组', createdAt: '2026-01-01T00:00:00.000Z' }],
      accounts: [groupedAccount],
      updateAllowedGroups,
      updateAllowedAccounts
    })

    expect(screen.queryByText('grouped@example.com')).toBeNull()
  })

  it('shows details for non-200 request logs', async () => {
    renderGateway({
      localGatewayStatus: {
        ...status,
        logs: [
          {
            id: 'log-1',
            timestamp: '2026-01-01T00:00:00.000Z',
            method: 'POST',
            path: '/v1/chat/completions',
            status: 500,
            durationMs: 42,
            provider: 'Codex',
            model: 'gpt-5.4',
            tokens: 0,
            message: 'Upstream request failed'
          }
        ]
      }
    })

    const pathCell = screen.getByText('/v1/chat/completions')
    const row = pathCell.closest('tr')!
    row.click()
    await waitFor(() => {
      expect(screen.getByText('Upstream request failed')).toBeTruthy()
    })
  })

  it('renders gateway account usage as a chart-only multi-account ranking', async () => {
    const view = renderGateway({
      accounts: [
        {
          id: 'account-alpha',
          email: 'alpha@example.com',
          name: 'Alpha',
          accountId: 'acct-alpha',
          groupIds: [],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        },
        {
          id: 'account-beta',
          email: 'beta@example.com',
          name: 'Beta',
          accountId: 'acct-beta',
          groupIds: [],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      gatewayUsageByAccountId: {
        'account-alpha': {
          todayTokens: 1234,
          todayCostUSD: 0.012,
          last30DaysTokens: 12345,
          last30DaysCostUSD: 0.12,
          updatedAt: '2026-05-21T06:57:00.000Z'
        },
        'account-beta': {
          todayTokens: 234,
          todayCostUSD: 0.002,
          last30DaysTokens: 2345,
          last30DaysCostUSD: 0.02,
          updatedAt: '2026-05-21T06:58:00.000Z'
        }
      }
    })

    expect(screen.getByText(copy.accountCount(2))).toBeTruthy()
    expect(screen.getByRole('button', { name: `${copy.last90Days} ${copy.tokens}` })).toBeTruthy()
    expect(screen.getByRole('button', { name: `${copy.today} ${copy.tokens}` })).toBeTruthy()
    expect(screen.getByRole('button', { name: `${copy.last90Days} ${copy.cost}` })).toBeTruthy()
    expect(screen.getByRole('button', { name: copy.updatedAt })).toBeTruthy()
    expect(
      view.container.querySelector(`canvas[aria-label="${copy.accountUsageOverview}"]`)
    ).toBeInstanceOf(HTMLCanvasElement)
    expect(view.container.querySelector('.account-usage-chart-scroll')).toBeTruthy()
    expect(view.container.querySelector('.account-usage-table')).toBeNull()

    await waitFor(() => expect(chartConfigs.length).toBeGreaterThan(0))
    expect(latestChartConfig().data?.labels).toEqual(['alpha@example.com', 'beta@example.com'])
    expect(latestChartConfig().data?.datasets?.[0]?.data).toEqual([12345, 2345])
    expect((latestChartConfig().options as MockChartOptions).events).toEqual([])
    expect(
      (latestChartConfig().options as MockChartOptions).transitions?.active?.animation?.duration
    ).toBe(0)

    const canvas = usageCanvas(view.container)
    await fireEvent.pointerMove(canvas, { clientX: 60, clientY: 10 })
    await waitFor(() =>
      expect(screen.getByRole('tooltip').textContent).toContain('alpha@example.com')
    )
    expect(screen.getByRole('tooltip').textContent).toContain(`${copy.last90Days} ${copy.tokens}`)

    await fireEvent.pointerLeave(canvas)
    expect(screen.queryByRole('tooltip')).toBeNull()

    await fireEvent.pointerMove(canvas, { clientX: 490, clientY: 45 })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('resorts the account usage chart by the selected metric', async () => {
    renderGateway({
      accounts: [
        {
          id: 'account-alpha',
          email: 'alpha@example.com',
          name: 'Alpha',
          accountId: 'acct-alpha',
          groupIds: [],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        },
        {
          id: 'account-beta',
          email: 'beta@example.com',
          name: 'Beta',
          accountId: 'acct-beta',
          groupIds: [],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      gatewayUsageByAccountId: {
        'account-alpha': {
          todayTokens: 20,
          todayCostUSD: 0.001,
          last30DaysTokens: 12345,
          last30DaysCostUSD: 0.12,
          updatedAt: '2026-05-21T06:57:00.000Z'
        },
        'account-beta': {
          todayTokens: 5000,
          todayCostUSD: 0.05,
          last30DaysTokens: 2345,
          last30DaysCostUSD: 0.5,
          updatedAt: '2026-05-21T06:58:00.000Z'
        }
      }
    })

    await waitFor(() =>
      expect(latestChartConfig().data?.labels).toEqual(['alpha@example.com', 'beta@example.com'])
    )

    await fireEvent.click(screen.getByRole('button', { name: `${copy.today} ${copy.tokens}` }))
    await waitFor(() =>
      expect(latestChartConfig().data?.labels).toEqual(['beta@example.com', 'alpha@example.com'])
    )
    expect(latestChartConfig().data?.datasets?.[0]?.data).toEqual([5000, 20])

    await fireEvent.click(screen.getByRole('button', { name: `${copy.last90Days} ${copy.cost}` }))
    await waitFor(() =>
      expect(latestChartConfig().data?.labels).toEqual(['beta@example.com', 'alpha@example.com'])
    )
    expect(latestChartConfig().data?.datasets?.[0]?.data).toEqual([0.5, 0.12])
  })

  it('can switch the gateway usage chart to group aggregation', async () => {
    renderGateway({
      groups: [
        {
          id: 'group-1',
          name: '研发组',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        },
        {
          id: 'group-2',
          name: '设计组',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      accounts: [
        {
          id: 'account-alpha',
          email: 'alpha@example.com',
          name: 'Alpha',
          accountId: 'acct-alpha',
          groupIds: ['group-1', 'group-2'],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        },
        {
          id: 'account-beta',
          email: 'beta@example.com',
          name: 'Beta',
          accountId: 'acct-beta',
          groupIds: ['group-1'],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      gatewayUsageByAccountId: {
        'account-alpha': {
          todayTokens: 1234,
          todayCostUSD: 0.012,
          last30DaysTokens: 12345,
          last30DaysCostUSD: 0.12,
          updatedAt: '2026-05-21T06:57:00.000Z'
        },
        'account-beta': {
          todayTokens: 234,
          todayCostUSD: 0.002,
          last30DaysTokens: 2345,
          last30DaysCostUSD: 0.02,
          updatedAt: '2026-05-21T06:58:00.000Z'
        }
      }
    })

    await waitFor(() =>
      expect(latestChartConfig().data?.labels).toEqual(['alpha@example.com', 'beta@example.com'])
    )

    await fireEvent.click(screen.getByRole('button', { name: copy.accountUsageByGroup }))

    await waitFor(() => expect(latestChartConfig().data?.labels).toEqual(['研发组', '设计组']))
    expect(screen.getByText(copy.groupCount(2))).toBeTruthy()
    expect(latestChartConfig().data?.datasets?.[0]?.data).toEqual([14690, 12345])
  })

  it('drills down from a group usage bar to that group account usage and returns', async () => {
    const view = renderGateway({
      groups: [
        {
          id: 'group-1',
          name: '研发组',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        },
        {
          id: 'group-2',
          name: '设计组',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      accounts: [
        {
          id: 'account-alpha',
          email: 'alpha@example.com',
          name: 'Alpha',
          accountId: 'acct-alpha',
          groupIds: ['group-1'],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        },
        {
          id: 'account-beta',
          email: 'beta@example.com',
          name: 'Beta',
          accountId: 'acct-beta',
          groupIds: ['group-1'],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        },
        {
          id: 'account-gamma',
          email: 'gamma@example.com',
          name: 'Gamma',
          accountId: 'acct-gamma',
          groupIds: ['group-2'],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      gatewayUsageByAccountId: {
        'account-alpha': {
          todayTokens: 1234,
          todayCostUSD: 0.012,
          last30DaysTokens: 12000,
          last30DaysCostUSD: 0.12,
          updatedAt: '2026-05-21T06:57:00.000Z'
        },
        'account-beta': {
          todayTokens: 234,
          todayCostUSD: 0.002,
          last30DaysTokens: 2000,
          last30DaysCostUSD: 0.02,
          updatedAt: '2026-05-21T06:58:00.000Z'
        },
        'account-gamma': {
          todayTokens: 99,
          todayCostUSD: 0.001,
          last30DaysTokens: 5000,
          last30DaysCostUSD: 0.05,
          updatedAt: '2026-05-21T07:00:00.000Z'
        }
      }
    })

    await waitFor(() =>
      expect(latestChartConfig().data?.labels).toEqual([
        'alpha@example.com',
        'gamma@example.com',
        'beta@example.com'
      ])
    )

    await fireEvent.click(screen.getByRole('button', { name: copy.accountUsageByGroup }))
    await waitFor(() => expect(latestChartConfig().data?.labels).toEqual(['研发组', '设计组']))

    await fireEvent.click(usageCanvas(view.container), { clientX: 40, clientY: 10 })

    await waitFor(() =>
      expect(latestChartConfig().data?.labels).toEqual(['alpha@example.com', 'beta@example.com'])
    )
    expect(screen.getByText(copy.accountUsageGroupDrilldown('研发组'))).toBeTruthy()
    expect(screen.getByText(copy.accountCount(2))).toBeTruthy()

    await fireEvent.click(screen.getByRole('button', { name: copy.accountUsageBackToGroups }))

    await waitFor(() => expect(latestChartConfig().data?.labels).toEqual(['研发组', '设计组']))
    expect(screen.getByText(copy.groupCount(2))).toBeTruthy()
  })
})
