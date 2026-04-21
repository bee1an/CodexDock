// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/svelte'
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
    dragHandleZone: action
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
})
