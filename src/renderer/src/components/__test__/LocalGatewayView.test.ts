// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import LocalGatewayView from '../LocalGatewayView.svelte'
import { messages } from '../app-view'

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
      ...props
    }
  })
}

describe('LocalGatewayView', () => {
  beforeEach(() => {
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
})
