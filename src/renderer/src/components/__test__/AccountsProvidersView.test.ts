// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'

type MockDndAction = {
  update: () => void
  destroy: () => void
}

vi.mock('svelte-dnd-action', () => {
  const noop = (): void => undefined
  const action = (): MockDndAction => ({
    update: noop,
    destroy: noop
  })

  return {
    dragHandle: action,
    dragHandleZone: action,
    SHADOW_ITEM_MARKER_PROPERTY_NAME: '__dnd_shadow__',
    SHADOW_PLACEHOLDER_ITEM_ID: '__dnd_placeholder__'
  }
})

import AccountsProvidersView from '../AccountsProvidersView.svelte'
import type { ProviderDraft } from '../accounts-panel-provider'
import { messages } from '../app-view'

const copy = messages['zh-CN']
const provider = {
  id: 'provider-1',
  name: 'Mirror',
  baseUrl: 'https://mirror.example.com',
  model: 'gpt-5.4',
  fastMode: true,
  createdAt: '2026-04-21T00:00:00.000Z',
  updatedAt: '2026-04-21T00:00:00.000Z'
}

function draft(): Record<string, ProviderDraft> {
  return {
    [provider.id]: {
      name: provider.name ?? '',
      baseUrl: provider.baseUrl,
      apiKey: '',
      model: provider.model,
      fastMode: provider.fastMode
    }
  }
}

describe('AccountsProvidersView', () => {
  it('renders editing mode and forwards save/cancel actions', async () => {
    const saveProvider = vi.fn().mockResolvedValue(undefined)
    const cancelEditingProvider = vi.fn()

    render(AccountsProvidersView, {
      props: {
        copy,
        iconRowButton: 'icon',
        providers: [provider],
        sortableProviders: [provider],
        flipDurationMs: 160,
        loginActionBusy: false,
        providerMutationBusy: false,
        editingProviderId: provider.id,
        providerDrafts: draft(),
        openingProviderId: '',
        providerActionBusy: () => false,
        createProvider: vi.fn().mockResolvedValue(undefined),
        probeProviderModels: vi.fn().mockResolvedValue({ ok: true, availableModels: [] }),
        openProviderInCodex: vi.fn().mockResolvedValue(undefined),
        startEditingProvider: vi.fn().mockResolvedValue(undefined),
        saveProvider,
        cancelEditingProvider,
        confirmRemoveProvider: vi.fn().mockResolvedValue(undefined),
        handleProviderSortConsider: vi.fn(),
        handleProviderSortFinalize: vi.fn().mockResolvedValue(undefined)
      }
    })

    expect(screen.getByDisplayValue('Mirror')).toBeTruthy()
    expect(screen.getByDisplayValue('https://mirror.example.com')).toBeTruthy()

    await fireEvent.click(
      screen.getByRole('button', { name: `${copy.saveProvider} · ${provider.name}` })
    )
    await fireEvent.click(screen.getByRole('button', { name: `${copy.cancel} · ${provider.name}` }))

    expect(saveProvider).toHaveBeenCalledWith(provider)
    expect(cancelEditingProvider).toHaveBeenCalledOnce()
  })

  it('renders action buttons in readonly mode', async () => {
    const openProviderInCodex = vi.fn().mockResolvedValue(undefined)
    const startEditingProvider = vi.fn().mockResolvedValue(undefined)
    const confirmRemoveProvider = vi.fn().mockResolvedValue(undefined)

    render(AccountsProvidersView, {
      props: {
        copy,
        iconRowButton: 'icon',
        providers: [provider],
        sortableProviders: [provider],
        flipDurationMs: 160,
        loginActionBusy: false,
        providerMutationBusy: false,
        editingProviderId: '',
        providerDrafts: draft(),
        openingProviderId: '',
        providerActionBusy: () => false,
        createProvider: vi.fn().mockResolvedValue(undefined),
        probeProviderModels: vi.fn().mockResolvedValue({ ok: true, availableModels: [] }),
        openProviderInCodex,
        startEditingProvider,
        saveProvider: vi.fn().mockResolvedValue(undefined),
        cancelEditingProvider: vi.fn(),
        confirmRemoveProvider,
        handleProviderSortConsider: vi.fn(),
        handleProviderSortFinalize: vi.fn().mockResolvedValue(undefined)
      }
    })

    await fireEvent.click(
      screen.getByRole('button', { name: `${copy.openCustomProvider} · ${provider.name}` })
    )
    await fireEvent.click(
      screen.getByRole('button', { name: `${copy.editProvider} · ${provider.name}` })
    )
    await fireEvent.click(
      screen.getByRole('button', { name: `${copy.deleteProvider} · ${provider.name}` })
    )

    expect(openProviderInCodex).toHaveBeenCalledWith(provider.id)
    expect(startEditingProvider).toHaveBeenCalledWith(provider)
    expect(confirmRemoveProvider).toHaveBeenCalledWith(provider)
  })

  it('creates providers from the quick add dialog without fastMode and supports model probing', async () => {
    const createProvider = vi.fn().mockResolvedValue(undefined)
    const probeProviderModels = vi.fn().mockResolvedValue({
      ok: true,
      baseUrl: 'https://api.example.com/v1',
      latencyMs: 12,
      httpStatus: 200,
      availableModels: ['gpt-5.4', 'gpt-5.4-mini']
    })

    render(AccountsProvidersView, {
      props: {
        copy,
        providers: [],
        sortableProviders: [],
        flipDurationMs: 160,
        loginActionBusy: false,
        providerMutationBusy: false,
        editingProviderId: '',
        providerDrafts: {},
        openingProviderId: '',
        providerActionBusy: () => false,
        createProvider,
        probeProviderModels,
        openProviderInCodex: vi.fn().mockResolvedValue(undefined),
        startEditingProvider: vi.fn().mockResolvedValue(undefined),
        saveProvider: vi.fn().mockResolvedValue(undefined),
        cancelEditingProvider: vi.fn(),
        confirmRemoveProvider: vi.fn().mockResolvedValue(undefined),
        handleProviderSortConsider: vi.fn(),
        handleProviderSortFinalize: vi.fn().mockResolvedValue(undefined)
      }
    })

    await fireEvent.click(screen.getByRole('button', { name: copy.createProvider }))
    await fireEvent.input(screen.getByPlaceholderText(copy.providerNamePlaceholder), {
      target: { value: 'Mirror' }
    })
    await fireEvent.input(screen.getByPlaceholderText(copy.providerBaseUrlPlaceholder), {
      target: { value: 'https://api.example.com/v1' }
    })
    await fireEvent.input(screen.getByPlaceholderText(copy.providerApiKeyPlaceholder), {
      target: { value: 'sk-test' }
    })

    await fireEvent.click(screen.getByRole('button', { name: copy.providerModelProbe }))
    await waitFor(() => expect(screen.getByText('gpt-5.4-mini')).toBeTruthy())
    await fireEvent.click(screen.getByRole('button', { name: 'gpt-5.4-mini' }))
    await fireEvent.click(screen.getAllByRole('button', { name: copy.createProvider }).at(-1)!)

    expect(probeProviderModels).toHaveBeenCalledWith({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      protocol: 'openai'
    })
    expect(createProvider).toHaveBeenCalledWith({
      name: 'Mirror',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      protocol: 'openai',
      model: 'gpt-5.4-mini'
    })
    expect(createProvider.mock.calls[0][0]).not.toHaveProperty('fastMode')
  })
})
