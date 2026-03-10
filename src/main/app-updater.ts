import type { AppUpdater, ProgressInfo, UpdateDownloadedEvent, UpdateInfo } from 'electron-updater'
import { autoUpdater } from 'electron-updater'

import type { AppSettings, AppUpdateState } from '../shared/codex'

const DEFAULT_INITIAL_CHECK_DELAY_MS = 10_000
const DEFAULT_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000
const RESET_UP_TO_DATE_DELAY_MS = 8_000

type CheckMode = 'manual' | 'silent'

export interface AppUpdaterService {
  getState(): AppUpdateState
  start(): void
  stop(): void
  syncSettings(settings: AppSettings): void
  checkForUpdates(): Promise<AppUpdateState>
  downloadUpdate(): Promise<AppUpdateState>
  installUpdate(): Promise<void>
  subscribe(listener: (state: AppUpdateState) => void): () => void
}

interface AppUpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowPrerelease: boolean
  logger: {
    info(message?: unknown): void
    warn(message?: unknown): void
    error(message?: unknown): void
  } | null
  on(event: 'checking-for-update', listener: () => void): this
  on(event: 'update-available', listener: (info: UpdateInfo) => void): this
  on(event: 'update-not-available', listener: (info: UpdateInfo) => void): this
  on(event: 'download-progress', listener: (info: ProgressInfo) => void): this
  on(event: 'update-downloaded', listener: (event: UpdateDownloadedEvent) => void): this
  on(event: 'error', listener: (error: Error, message?: string) => void): this
  removeAllListeners(event?: string): this
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

export interface CreateAppUpdaterServiceOptions {
  currentVersion: string
  initialSettings: AppSettings
  isPackaged?: boolean
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  updater?: AppUpdaterLike
  initialCheckDelayMs?: number
  checkIntervalMs?: number
}

function createBaseState(
  currentVersion: string,
  supported: boolean,
  message?: string
): AppUpdateState {
  return {
    status: supported ? 'idle' : 'unsupported',
    currentVersion,
    supported,
    message
  }
}

function resolveSupport(
  isPackaged: boolean,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv
): { supported: boolean; message?: string } {
  if (!isPackaged) {
    return {
      supported: false,
      message: 'Automatic updates are only available in packaged builds.'
    }
  }

  if (platform === 'darwin' || platform === 'win32') {
    return { supported: true }
  }

  if (platform === 'linux') {
    if (env['APPIMAGE']) {
      return { supported: true }
    }

    if (env['SNAP']) {
      return {
        supported: false,
        message: 'Automatic updates are managed by the Snap store for this build.'
      }
    }

    return {
      supported: false,
      message: 'Automatic updates are only supported for the AppImage build on Linux.'
    }
  }

  return {
    supported: false,
    message: `Automatic updates are not supported on ${platform}.`
  }
}

export function createAppUpdaterService(
  options: CreateAppUpdaterServiceOptions
): AppUpdaterService {
  const updater = (options.updater ?? autoUpdater) as AppUpdaterLike
  const support = resolveSupport(
    options.isPackaged ?? false,
    options.platform ?? process.platform,
    options.env ?? process.env
  )

  let settings = options.initialSettings
  let state = createBaseState(options.currentVersion, support.supported, support.message)
  let activeCheckMode: CheckMode | null = null
  let started = false
  let checkPromise: Promise<AppUpdateState> | null = null
  let initialTimer: ReturnType<typeof setTimeout> | null = null
  let intervalTimer: ReturnType<typeof setInterval> | null = null
  let resetTimer: ReturnType<typeof setTimeout> | null = null
  const listeners = new Set<(nextState: AppUpdateState) => void>()

  function notify(): void {
    for (const listener of listeners) {
      listener(state)
    }
  }

  function setState(nextState: AppUpdateState): AppUpdateState {
    state = nextState
    notify()
    return state
  }

  function mergeState(nextState: Partial<AppUpdateState>): AppUpdateState {
    return setState({
      ...state,
      ...nextState
    })
  }

  function clearResetTimer(): void {
    if (!resetTimer) {
      return
    }

    clearTimeout(resetTimer)
    resetTimer = null
  }

  function scheduleUpToDateReset(): void {
    clearResetTimer()
    resetTimer = setTimeout(() => {
      resetTimer = null
      if (state.status === 'up-to-date') {
        mergeState({
          status: 'idle',
          message: undefined,
          downloadProgress: undefined
        })
      }
    }, RESET_UP_TO_DATE_DELAY_MS)
  }

  function clearTimers(): void {
    if (initialTimer) {
      clearTimeout(initialTimer)
      initialTimer = null
    }

    if (intervalTimer) {
      clearInterval(intervalTimer)
      intervalTimer = null
    }
  }

  async function runCheck(mode: CheckMode): Promise<AppUpdateState> {
    if (!support.supported) {
      return setState(createBaseState(options.currentVersion, false, support.message))
    }

    if (checkPromise) {
      return checkPromise
    }

    clearResetTimer()
    activeCheckMode = mode
    if (mode === 'manual') {
      mergeState({
        status: 'checking',
        message: undefined,
        downloadProgress: undefined
      })
    }

    checkPromise = updater
      .checkForUpdates()
      .then(() => state)
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Failed to check for updates.'
        if (mode === 'manual') {
          return mergeState({
            status: 'error',
            checkedAt: new Date().toISOString(),
            message
          })
        }
        return state
      })
      .finally(() => {
        activeCheckMode = null
        checkPromise = null
      })

    return checkPromise
  }

  function scheduleAutoChecks(): void {
    clearTimers()
    if (!support.supported || !settings.checkForUpdatesOnStartup) {
      return
    }

    initialTimer = setTimeout(() => {
      initialTimer = null
      void runCheck('silent')
    }, options.initialCheckDelayMs ?? DEFAULT_INITIAL_CHECK_DELAY_MS)

    intervalTimer = setInterval(() => {
      void runCheck('silent')
    }, options.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS)
  }

  updater.autoDownload = false
  updater.autoInstallOnAppQuit = false
  updater.allowPrerelease = false
  updater.logger = console

  if (support.supported) {
    updater.removeAllListeners('checking-for-update')
    updater.removeAllListeners('update-available')
    updater.removeAllListeners('update-not-available')
    updater.removeAllListeners('download-progress')
    updater.removeAllListeners('update-downloaded')
    updater.removeAllListeners('error')

    updater.on('checking-for-update', () => {
      if (activeCheckMode === 'manual') {
        mergeState({
          status: 'checking',
          message: undefined,
          downloadProgress: undefined
        })
      }
    })

    updater.on('update-available', (info) => {
      mergeState({
        status: 'available',
        availableVersion: info.version,
        checkedAt: new Date().toISOString(),
        message: undefined,
        downloadProgress: undefined
      })
    })

    updater.on('update-not-available', () => {
      if (activeCheckMode === 'manual') {
        mergeState({
          status: 'up-to-date',
          checkedAt: new Date().toISOString(),
          availableVersion: undefined,
          message: 'You are already using the latest version.',
          downloadProgress: undefined
        })
        scheduleUpToDateReset()
        return
      }

      mergeState({
        status: 'idle',
        checkedAt: new Date().toISOString(),
        availableVersion: undefined,
        message: undefined,
        downloadProgress: undefined
      })
    })

    updater.on('download-progress', (info) => {
      mergeState({
        status: 'downloading',
        downloadProgress: Math.round(info.percent),
        message: undefined
      })
    })

    updater.on('update-downloaded', (event) => {
      mergeState({
        status: 'downloaded',
        availableVersion: event.version,
        checkedAt: new Date().toISOString(),
        downloadProgress: 100,
        message: 'Update downloaded and ready to install.'
      })
    })

    updater.on('error', (error, message) => {
      const detail = message || error.message || 'Update failed.'
      if (activeCheckMode === 'manual') {
        mergeState({
          status: 'error',
          checkedAt: new Date().toISOString(),
          message: detail,
          downloadProgress: undefined
        })
      } else {
        console.warn(`Auto-update check failed: ${detail}`)
      }
    })
  }

  return {
    getState(): AppUpdateState {
      return state
    },
    start(): void {
      if (started) {
        return
      }

      started = true
      scheduleAutoChecks()
    },
    stop(): void {
      started = false
      clearTimers()
      clearResetTimer()
    },
    syncSettings(nextSettings): void {
      settings = nextSettings
      if (started) {
        scheduleAutoChecks()
      }
    },
    async checkForUpdates(): Promise<AppUpdateState> {
      return runCheck('manual')
    },
    async downloadUpdate(): Promise<AppUpdateState> {
      if (!support.supported) {
        return setState(createBaseState(options.currentVersion, false, support.message))
      }

      if (state.status !== 'available') {
        return state
      }

      clearResetTimer()
      mergeState({
        status: 'downloading',
        message: undefined,
        downloadProgress: 0
      })

      try {
        await updater.downloadUpdate()
      } catch (error) {
        return mergeState({
          status: 'error',
          checkedAt: new Date().toISOString(),
          message: error instanceof Error ? error.message : 'Failed to download the update.',
          downloadProgress: undefined
        })
      }

      return state
    },
    async installUpdate(): Promise<void> {
      if (!support.supported || state.status !== 'downloaded') {
        return
      }

      updater.quitAndInstall(false, true)
    },
    subscribe(listener): () => void {
      listeners.add(listener)
      listener(state)
      return () => listeners.delete(listener)
    }
  }
}

export type { AppUpdaterLike as AppUpdaterTestDouble, AppUpdater as ElectronAppUpdater }
