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

import SettingsView from '../SettingsView.svelte'
import { messages } from '../app-view'

const copy = messages['zh-CN']

describe('SettingsView', () => {
  it('展示基础设置', () => {
    render(SettingsView, {
      props: {
        copy,
        language: 'zh-CN',
        showCodexDesktopExecutablePath: false,
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
        appMeta: {
          version: '0.4.6',
          githubUrl: 'https://github.com/bee1an/CodexDock'
        },
        updateCheckForUpdatesOnStartup: vi.fn(),
        updateShowLocalMockData: vi.fn(),
        updateLanguage: vi.fn(),
        updateCodexDesktopExecutablePath: vi.fn().mockResolvedValue(undefined),
        showLocalMockToggle: false,
        checkForUpdates: vi.fn(),
        downloadUpdate: vi.fn().mockResolvedValue(undefined),
        installUpdate: vi.fn().mockResolvedValue(undefined)
      }
    })

    expect(screen.getByText(copy.generalSettings)).toBeTruthy()
    expect(screen.getByText(copy.switchLanguage)).toBeTruthy()
    expect(screen.getByText(copy.autoCheckUpdates)).toBeTruthy()
    expect(screen.queryByText(copy.pollingInterval)).toBeNull()
  })
})
