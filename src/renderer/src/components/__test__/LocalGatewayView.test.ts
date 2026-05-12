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
      groups: [{ id: 'group-1', name: '默认组', createdAt: '2026-01-01T00:00:00.000Z' }],
      startLocalGateway: vi.fn().mockResolvedValue(undefined),
      stopLocalGateway: vi.fn().mockResolvedValue(undefined),
      rotateLocalGatewayKey: vi.fn().mockResolvedValue(undefined),
      updateModelMappings: vi.fn().mockResolvedValue(undefined),
      updateAllowedGroups: vi.fn().mockResolvedValue(undefined),
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
})
