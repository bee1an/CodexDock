// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'

type MockAction = {
  update: () => void
  destroy: () => void
}

function createDeferred(): {
  promise: Promise<void>
  resolve: () => void
} {
  let resolve = (): void => undefined
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve
  })

  return {
    promise,
    resolve
  }
}

vi.mock('svelte-dnd-action', () => {
  const noop = (): void => undefined
  const action = (): MockAction => ({
    update: noop,
    destroy: noop
  })

  return {
    dragHandle: action,
    dragHandleZone: action
  }
})

vi.mock('../gsap-motion', () => {
  const noop = (): void => undefined
  const action = (): MockAction => ({
    update: noop,
    destroy: noop
  })

  return {
    animateProgress: action,
    cascadeIn: action,
    reveal: action
  }
})

import AccountsPanel from '../AccountsPanel.svelte'
import { messages } from '../app-view'

const copy = messages['zh-CN']

const accounts = [
  {
    id: 'acct-1',
    email: 'tagged@example.com',
    tagIds: ['tag-1'],
    createdAt: '2026-04-21T00:00:00.000Z',
    updatedAt: '2026-04-21T00:00:00.000Z'
  },
  {
    id: 'acct-2',
    email: 'untagged@example.com',
    tagIds: [],
    createdAt: '2026-04-21T00:00:00.000Z',
    updatedAt: '2026-04-21T00:00:00.000Z'
  }
]

const tags = [
  {
    id: 'tag-1',
    name: '重点',
    createdAt: '2026-04-21T00:00:00.000Z',
    updatedAt: '2026-04-21T00:00:00.000Z'
  }
]

function renderAccountsPanel(
  overrideProps: Record<string, unknown> = {}
): ReturnType<typeof render> {
  return render(AccountsPanel, {
    props: {
      panelClass: 'panel',
      primaryActionButton: 'primary',
      compactGhostButton: 'ghost',
      iconRowButton: 'icon',
      copy,
      workspaceVersion: '0.3.3',
      workspaceStatusText: '',
      workspaceStatusToneClass: 'text-muted-strong',
      updateSummary: '',
      updateActionLabel: null,
      runUpdateAction: vi.fn(),
      language: 'zh-CN',
      accounts,
      providers: [],
      tags,
      activeAccountId: 'acct-1',
      usageByAccountId: {},
      usageLoadingByAccountId: {},
      usageErrorByAccountId: {},
      wakeSchedulesByAccountId: {},
      loginActionBusy: false,
      loginStarting: false,
      openingAccountId: '',
      openingIsolatedAccountId: '',
      wakingAccountId: '',
      openingProviderId: '',
      openAccountInCodex: vi.fn(),
      openAccountInIsolatedCodex: vi.fn(),
      openWakeDialog: vi.fn(),
      openProviderInCodex: vi.fn().mockResolvedValue(undefined),
      getProvider: vi.fn().mockResolvedValue({
        id: 'provider-1',
        name: 'Mirror',
        baseUrl: 'https://mirror.example.com',
        apiKey: '',
        model: 'gpt-5.4',
        fastMode: true,
        createdAt: '2026-04-21T00:00:00.000Z',
        updatedAt: '2026-04-21T00:00:00.000Z'
      }),
      reorderProviders: vi.fn().mockResolvedValue(undefined),
      updateProvider: vi.fn().mockResolvedValue(undefined),
      removeProvider: vi.fn().mockResolvedValue(undefined),
      reorderAccounts: vi.fn().mockResolvedValue(undefined),
      createTag: vi.fn().mockResolvedValue(undefined),
      updateTag: vi.fn().mockResolvedValue(undefined),
      deleteTag: vi.fn().mockResolvedValue(undefined),
      updateAccountTags: vi.fn().mockResolvedValue(undefined),
      refreshAccountUsage: vi.fn(),
      removeAccount: vi.fn(),
      removeAccounts: vi.fn().mockResolvedValue(undefined),
      exportSelectedAccounts: vi.fn().mockResolvedValue(undefined),
      startLogin: vi.fn(),
      importCurrent: vi.fn(),
      ...overrideProps
    }
  })
}

describe('AccountsPanel', () => {
  it('在切换 tabs 后保持账户筛选、选择和工作台展开状态', async () => {
    renderAccountsPanel()

    await fireEvent.click(screen.getByRole('button', { name: copy.showFiltersAndBulkActions }))
    await fireEvent.click(screen.getByRole('button', { name: '重点 · 1' }))
    await fireEvent.click(screen.getByRole('button', { name: copy.selectAllVisibleAccounts }))

    expect(
      (
        screen.getByRole('checkbox', {
          name: `${copy.selectAccount} · tagged@example.com`
        }) as HTMLInputElement
      ).checked
    ).toBe(true)
    expect(screen.queryByText('untagged@example.com')).toBeNull()

    await fireEvent.click(screen.getByRole('button', { name: copy.providerCount(0) }))
    await fireEvent.click(screen.getByRole('button', { name: copy.accountCount(accounts.length) }))

    expect(screen.getByRole('button', { name: copy.hideFiltersAndBulkActions })).toBeTruthy()
    expect(
      (
        screen.getByRole('checkbox', {
          name: `${copy.selectAccount} · tagged@example.com`
        }) as HTMLInputElement
      ).checked
    ).toBe(true)
    expect(screen.queryByText('untagged@example.com')).toBeNull()
  })

  it('账户标签变更在忙碌期间只允许串行执行一次', async () => {
    const updateAccountTagsDeferred = createDeferred()
    const updateAccountTags = vi.fn().mockReturnValue(updateAccountTagsDeferred.promise)

    renderAccountsPanel({
      updateAccountTags
    })

    const removeTagButton = screen.getByRole('button', { name: `${copy.removeTag} · 重点` })

    await fireEvent.click(removeTagButton)

    expect(updateAccountTags).toHaveBeenCalledOnce()
    expect(updateAccountTags).toHaveBeenCalledWith(accounts[0], [])
    expect((removeTagButton as HTMLButtonElement).disabled).toBe(true)

    await fireEvent.click(removeTagButton)

    expect(updateAccountTags).toHaveBeenCalledOnce()

    updateAccountTagsDeferred.resolve()
    await updateAccountTagsDeferred.promise
  })
})
