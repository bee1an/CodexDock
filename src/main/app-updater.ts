import type { AppUpdater, ProgressInfo, UpdateDownloadedEvent, UpdateInfo } from 'electron-updater'
import { autoUpdater } from 'electron-updater'

import type { AppSettings, AppUpdateDelivery, AppUpdateState } from '../shared/codex'

const DEFAULT_INITIAL_CHECK_DELAY_MS = 10_000
const DEFAULT_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000
const RESET_UP_TO_DATE_DELAY_MS = 8_000

type CheckMode = 'manual' | 'silent'
type UpdateStrategyMode = 'auto' | 'unsupported'

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

export interface AppUpdaterLike {
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

export interface HomebrewUpgradeOutcome {
  success: boolean
  message?: string
  command?: string
  logFilePath?: string
}

interface UpdateStrategy {
  mode: UpdateStrategyMode
  delivery: AppUpdateDelivery
  supported: boolean
  message?: string
  githubRepo?: {
    owner: string
    repo: string
    releasesUrl: string
  }
}

function createNoopUpdater(): AppUpdaterLike {
  return {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    allowPrerelease: false,
    logger: console,
    on() {
      return this
    },
    removeAllListeners() {
      return this
    },
    checkForUpdates: async () => undefined,
    downloadUpdate: async () => undefined,
    quitAndInstall: () => undefined
  }
}

export interface CreateAppUpdaterServiceOptions {
  currentVersion: string
  initialSettings: AppSettings
  githubUrl?: string | null
  isPackaged?: boolean
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  updater?: AppUpdaterLike
  initialCheckDelayMs?: number
  checkIntervalMs?: number
  isHomebrewCaskInstalled?: () => Promise<boolean>
  /**
   * Triggers the Homebrew upgrade flow (opens the progress window, runs the
   * brew commands, etc.). Resolves once the upgrade completes (successfully or
   * with an error). The resolved object describes the outcome.
   */
  runHomebrewUpgrade?: () => Promise<HomebrewUpgradeOutcome>
  /** Called when the renderer should relaunch the app for a Homebrew install. */
  performHomebrewRelaunch?: () => void
}

function createBaseState(
  currentVersion: string,
  strategy: Pick<UpdateStrategy, 'delivery' | 'supported'>,
  message?: string
): AppUpdateState {
  return {
    status: strategy.supported ? 'idle' : 'unsupported',
    delivery: strategy.delivery,
    currentVersion,
    message,
    supported: strategy.supported
  }
}

function parseGithubRepository(githubUrl?: string | null):
  | {
      owner: string
      repo: string
      releasesUrl: string
    }
  | undefined {
  if (!githubUrl) {
    return undefined
  }

  try {
    const url = new URL(githubUrl)
    if (!url.hostname.includes('github.com')) {
      return undefined
    }

    const [owner, repo] = url.pathname.replace(/^\/+|\/+$/g, '').split('/')
    if (!owner || !repo) {
      return undefined
    }

    return {
      owner,
      repo,
      releasesUrl: `https://github.com/${owner}/${repo}/releases`
    }
  } catch {
    return undefined
  }
}

function resolveStrategy(
  isPackaged: boolean,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  githubUrl?: string | null
): UpdateStrategy {
  if (!isPackaged) {
    return {
      mode: 'unsupported',
      delivery: 'auto',
      supported: false,
      message: 'Automatic updates are only available in packaged builds.'
    }
  }

  const githubRepo = parseGithubRepository(githubUrl)

  if (platform === 'darwin') {
    return {
      mode: 'auto',
      delivery: 'auto',
      supported: true,
      githubRepo
    }
  }

  if (platform === 'win32') {
    return {
      mode: 'auto',
      delivery: 'auto',
      supported: true,
      githubRepo
    }
  }

  if (platform === 'linux') {
    if (env['APPIMAGE']) {
      return {
        mode: 'auto',
        delivery: 'auto',
        supported: true,
        githubRepo
      }
    }

    if (env['SNAP']) {
      return {
        mode: 'unsupported',
        delivery: 'auto',
        supported: false,
        message: 'Automatic updates are managed by the Snap store for this build.'
      }
    }

    return {
      mode: 'unsupported',
      delivery: 'auto',
      supported: false,
      message: 'Automatic updates are only supported for the AppImage build on Linux.'
    }
  }

  return {
    mode: 'unsupported',
    delivery: 'auto',
    supported: false,
    message: `Automatic updates are not supported on ${platform}.`
  }
}

export function createAppUpdaterService(
  options: CreateAppUpdaterServiceOptions
): AppUpdaterService {
  const platform = options.platform ?? process.platform
  const strategy = resolveStrategy(
    options.isPackaged ?? false,
    platform,
    options.env ?? process.env,
    options.githubUrl
  )
  const updater =
    strategy.mode === 'auto'
      ? ((options.updater ?? autoUpdater) as AppUpdaterLike)
      : createNoopUpdater()

  let settings = options.initialSettings
  let state = createBaseState(options.currentVersion, strategy, strategy.message)
  let activeCheckMode: CheckMode | null = null
  let started = false
  let checkPromise: Promise<AppUpdateState> | null = null
  let initialTimer: ReturnType<typeof setTimeout> | null = null
  let intervalTimer: ReturnType<typeof setInterval> | null = null
  let resetTimer: ReturnType<typeof setTimeout> | null = null
  let homebrewUpgradePromise: Promise<AppUpdateState> | null = null
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
          downloadProgress: undefined,
          externalDownloadUrl: undefined
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

  function buildReleaseUrl(version: string): string | undefined {
    if (!strategy.githubRepo) {
      return undefined
    }
    return `${strategy.githubRepo.releasesUrl}/tag/v${version.replace(/^v/i, '')}`
  }

  async function decorateAvailableUpdate(info: { version: string }): Promise<void> {
    const baseDelivery: AppUpdateDelivery = platform === 'darwin' ? 'external' : 'auto'
    const releaseUrl = buildReleaseUrl(info.version)
    mergeState({
      status: 'available',
      availableVersion: info.version,
      checkedAt: new Date().toISOString(),
      message: undefined,
      downloadProgress: undefined,
      delivery: baseDelivery,
      externalDownloadUrl: platform === 'darwin' ? releaseUrl : undefined,
      externalAction: undefined,
      externalCommand: undefined,
      externalCommandStatus: undefined,
      externalLogFilePath: undefined
    })

    if (platform === 'darwin') {
      const homebrew = await detectHomebrewCask()
      mergeState({
        externalAction: homebrew ? 'homebrew' : 'release'
      })
    }
  }

  async function detectHomebrewCask(): Promise<boolean> {
    if (!options.isHomebrewCaskInstalled) {
      return false
    }

    try {
      return await options.isHomebrewCaskInstalled()
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : 'Failed to detect the Homebrew cask installation.'
      console.warn(`Homebrew update detection failed: ${detail}`)
      return false
    }
  }

  async function runAutoCheck(mode: CheckMode): Promise<AppUpdateState> {
    return updater
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
  }

  async function runCheck(mode: CheckMode): Promise<AppUpdateState> {
    if (!strategy.supported) {
      return setState(createBaseState(options.currentVersion, strategy, strategy.message))
    }

    if (checkPromise) {
      if (mode === 'manual' && activeCheckMode === 'silent') {
        activeCheckMode = 'manual'
        clearResetTimer()
        mergeState({
          status: 'checking',
          message: undefined,
          downloadProgress: undefined
        })
      }
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

    checkPromise = runAutoCheck(mode).finally(() => {
      activeCheckMode = null
      checkPromise = null
    })

    return checkPromise
  }

  function scheduleAutoChecks(): void {
    clearTimers()
    if (
      !strategy.supported ||
      !settings.checkForUpdatesOnStartup ||
      state.status === 'downloaded'
    ) {
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

  if (strategy.mode === 'auto') {
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = false
    updater.allowPrerelease = false
    updater.logger = console

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
      if (state.status === 'downloaded' && activeCheckMode !== 'manual') {
        return
      }

      void decorateAvailableUpdate(info)
    })

    updater.on('update-not-available', () => {
      if (state.status === 'downloaded' && activeCheckMode !== 'manual') {
        return
      }

      if (activeCheckMode === 'manual') {
        mergeState({
          status: 'up-to-date',
          checkedAt: new Date().toISOString(),
          availableVersion: undefined,
          message: 'You are already using the latest version.',
          downloadProgress: undefined,
          externalDownloadUrl: undefined,
          externalAction: undefined,
          externalCommand: undefined,
          externalCommandStatus: undefined,
          externalLogFilePath: undefined
        })
        scheduleUpToDateReset()
        return
      }

      mergeState({
        status: 'idle',
        checkedAt: new Date().toISOString(),
        availableVersion: undefined,
        message: undefined,
        downloadProgress: undefined,
        externalDownloadUrl: undefined,
        externalAction: undefined,
        externalCommand: undefined,
        externalCommandStatus: undefined,
        externalLogFilePath: undefined
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
      clearTimers()
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
      if (state.status === 'downloaded' && activeCheckMode !== 'manual') {
        return
      }

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

  async function performHomebrewUpgrade(): Promise<AppUpdateState> {
    if (!options.runHomebrewUpgrade) {
      return mergeState({
        status: 'error',
        checkedAt: new Date().toISOString(),
        message: 'Homebrew update is not configured for this build.',
        downloadProgress: undefined
      })
    }

    mergeState({
      status: 'downloading',
      message: 'Starting Homebrew update…',
      downloadProgress: undefined,
      externalCommand: undefined,
      externalCommandStatus: 'starting',
      externalLogFilePath: undefined
    })

    let outcome: HomebrewUpgradeOutcome
    try {
      outcome = await options.runHomebrewUpgrade()
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Failed to start the Homebrew update.'
      return mergeState({
        status: 'error',
        checkedAt: new Date().toISOString(),
        message: detail,
        downloadProgress: undefined
      })
    }

    if (outcome.success) {
      clearTimers()
      return mergeState({
        status: 'downloaded',
        checkedAt: new Date().toISOString(),
        downloadProgress: 100,
        message: 'Homebrew update installed. Restart to use the new version.',
        externalAction: 'homebrew',
        externalCommand: outcome.command,
        externalCommandStatus: 'success',
        externalLogFilePath: outcome.logFilePath
      })
    }

    return mergeState({
      status: 'error',
      checkedAt: new Date().toISOString(),
      message: outcome.message ?? 'Homebrew update failed.',
      downloadProgress: undefined,
      externalCommand: outcome.command,
      externalCommandStatus: 'error',
      externalLogFilePath: outcome.logFilePath
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
      if (!strategy.supported) {
        return setState(createBaseState(options.currentVersion, strategy, strategy.message))
      }

      if (state.status !== 'available') {
        return state
      }

      if (state.delivery === 'external' && state.externalAction === 'homebrew') {
        if (homebrewUpgradePromise) {
          return homebrewUpgradePromise
        }

        homebrewUpgradePromise = performHomebrewUpgrade().finally(() => {
          homebrewUpgradePromise = null
        })
        return homebrewUpgradePromise
      }

      if (state.delivery === 'external') {
        // Caller should open the release URL; nothing for us to do here.
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
      if (!strategy.supported || state.status !== 'downloaded') {
        return
      }

      if (state.delivery === 'external' && state.externalAction === 'homebrew') {
        options.performHomebrewRelaunch?.()
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
