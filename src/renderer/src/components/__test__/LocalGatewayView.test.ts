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

function renderGateway(props = {}): void {
  render(LocalGatewayView, {
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
      rotateLocalGatewayKey: vi.fn().mockResolvedValue(undefined),
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

  it('manages model mappings from a dialog', async () => {
    const updateModelMappings = vi.fn().mockResolvedValue(undefined)
    renderGateway({ updateModelMappings })

    await fireEvent.click(
      screen.getByRole('button', { name: copy.localGatewayModelMappingsManage })
    )
    await fireEvent.input(screen.getByPlaceholderText(copy.localGatewayModelMappingFromPlaceholder), {
      target: { value: 'client-model' }
    })
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

  it('hides accounts that already belong to a group from gateway account choices', async () => {
    const updateAllowedAccounts = vi.fn().mockResolvedValue(undefined)
    renderGateway({
      allowedGroupIds: [],
      allowedAccountIds: ['grouped-account'],
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
    await fireEvent.click(screen.getByRole('button', { name: 'standalone@example.com' }))

    expect(screen.queryByText('grouped@example.com')).toBeNull()
    expect(screen.getByText('standalone@example.com')).toBeTruthy()
    await waitFor(() =>
      expect(updateAllowedAccounts).toHaveBeenCalledWith(['standalone-account'])
    )
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

    const expandSpan = screen.getByText(copy.localGatewayExpandDetail)
    const expandBtn = expandSpan.closest('button')!
    expandBtn.click()
    await waitFor(() => {
      expect(screen.getByText('Upstream request failed')).toBeTruthy()
    })
  })
})
