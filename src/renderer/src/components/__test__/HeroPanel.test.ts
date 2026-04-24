// @vitest-environment jsdom

import { render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../gsap-motion', () => {
  const action = (): { update: () => undefined; destroy: () => undefined } => ({
    update: () => undefined,
    destroy: () => undefined
  })

  return {
    cascadeIn: action,
    reveal: action
  }
})

import HeroPanel from '../HeroPanel.svelte'
import { messages } from '../app-view'

const copy = messages['zh-CN']

describe('HeroPanel', () => {
  it('在设置弹层里展示基础设置', () => {
    render(HeroPanel, {
      props: {
        heroClass: 'hero',
        compactGhostButton: 'ghost',
        copy,
        loginEvent: null,
        showSettings: true,
        showProviderComposer: false,
        onClose: vi.fn(),
        showCodexDesktopExecutablePath: false,
        showCallbackLoginDetails: true,
        showDeviceLoginDetails: true,
        loginActionBusy: false,
        pollingOptions: [5, 15, 30],
        settings: {
          usagePollingMinutes: 15,
          statusBarAccountIds: [],
          language: 'zh-CN',
          theme: 'light',
          checkForUpdatesOnStartup: true,
          codexDesktopExecutablePath: '',
          showLocalMockData: true
        },
        updateState: {
          status: 'idle',
          delivery: 'auto',
          currentVersion: '0.3.5',
          supported: true
        },
        createProvider: vi.fn().mockResolvedValue(undefined),
        updatePollingInterval: vi.fn(),
        updateCheckForUpdatesOnStartup: vi.fn(),
        updateShowLocalMockData: vi.fn(),
        updateCodexDesktopExecutablePath: vi.fn().mockResolvedValue(undefined),
        showLocalMockToggle: false,
        checkForUpdates: vi.fn(),
        downloadUpdate: vi.fn().mockResolvedValue(undefined),
        installUpdate: vi.fn().mockResolvedValue(undefined),
        copyAuthUrl: vi.fn(),
        copyDeviceCode: vi.fn(),
        openExternalLink: vi.fn()
      }
    })

    expect(screen.getByText(copy.pollingInterval)).toBeTruthy()
  })
})
