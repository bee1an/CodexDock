<script lang="ts">
  import { onMount } from 'svelte'
  import brandMark from './assets/brand-mark.png'
  import AccountsPanel from './components/AccountsPanel.svelte'
  import AppButton from './components/AppButton.svelte'
  import AppDialog from './components/AppDialog.svelte'
  import { reveal } from './components/gsap-motion'
  import EditAccountTokensDialog from './components/EditAccountTokensDialog.svelte'
  import HeroPanel from './components/HeroPanel.svelte'
  import TrayPanel from './components/TrayPanel.svelte'
  import WakeDialog from './components/WakeDialog.svelte'
  import {
    accountLabel,
    accountScopedRecord,
    loginTone,
    messages,
    pollingOptions,
    preserveAccountScopedRecord,
    statusBarAccounts,
    usageErrorKind
  } from './components/app-view'
  import { isValidWakeScheduleTime, normalizeWakeScheduleTimes } from './components/wake-schedule'

  import type {
    AppLanguage,
    AppMeta,
    AppTheme,
    AppUpdateState,
    AccountWakeSchedule,
    AccountGroup,
    AccountTransferFormat,
    AccountRateLimits,
    AccountSummary,
    AppSnapshot,
    CustomProviderDetail,
    CreateCustomProviderInput,
    LocalGatewayModelMapping,
    LoginEvent,
    LoginMethod,
    PortOccupant,
    ProbeProviderModelsInput,
    ProviderModelsProbeResult,
    StatsDisplaySettings,
    UpdateAccountWakeScheduleInput,
    WakeAccountRequestResult,
    WakeAccountRateLimitsInput,
    UpdateCustomProviderInput
  } from '../../shared/codex'
  import {
    accountTransferFormats,
    defaultWakeModel,
    defaultStatsDisplaySettings,
    formatRelativeReset,
    normalizeStatsDisplaySettings,
    resolveBestAccount,
    shouldAutoPollUsage,
    supportsWeeklyQuota
  } from '../../shared/codex'

  type WakeDialogStatus = 'idle' | 'running' | 'success' | 'skipped' | 'error'
  type WakeDialogTab = 'session' | 'schedule'
  type TransitionMotionState = 'closed' | 'open' | 'closing'
  type ThemeTransitionOrigin = {
    x?: number
    y?: number
    target?: HTMLElement | null
  }
  type DocumentWithViewTransitions = Document & {
    startViewTransition?: (callback: () => void | Promise<void>) => {
      ready: Promise<void>
      finished: Promise<void>
      updateCallbackDone: Promise<void>
      skipTransition: () => void
    }
  }
  type ApplySnapshotOptions = {
    preserveUsageState?: boolean
  }

  let snapshot: AppSnapshot = {
    accounts: [],
    providers: [],
    groups: [],
    codexInstances: [],
    codexInstanceDefaults: {
      rootDir: '',
      defaultCodexHome: ''
    },
    currentSession: null,
    loginInProgress: false,
    settings: {
      usagePollingMinutes: 15,
      statusBarAccountIds: [],
      language: 'zh-CN',
      theme: 'light',
      checkForUpdatesOnStartup: true,
      codexDesktopExecutablePath: '',
      showLocalMockData: true,
      statsDisplay: defaultStatsDisplaySettings(),
      toolbarIconMovable: true,
      collapsedToolbarIconDefaultPosition: true,
      localGateway: {
        host: '127.0.0.1',
        port: 11456,
        apiKey: '',
        stickyTtlMinutes: 360,
        requestTimeoutMs: 120_000
      }
    },
    usageByAccountId: {},
    usageErrorByAccountId: {},
    wakeSchedulesByAccountId: {},
    tokenCostByInstanceId: {},
    tokenCostErrorByInstanceId: {},
    runningTokenCostSummary: null,
    runningTokenCostInstanceIds: [],
    localGatewayStatus: {
      running: false,
      baseUrl: 'http://127.0.0.1:11456',
      apiKeyPreview: ''
    }
  }
  let rawSnapshot: AppSnapshot = snapshot
  let appMeta: AppMeta = {
    version: '--',
    githubUrl: null,
    platform: undefined,
    isPackaged: true
  }
  let loginEvent: LoginEvent | null = null
  let loginStarting = false
  let showCallbackLoginDetails = true
  let showDeviceLoginDetails = true
  let refreshingAllUsage = false
  let pageError = ''
  let pageErrorTimer: ReturnType<typeof setTimeout> | null = null

  const setPageError = (message: string): void => {
    pageError = message
    if (pageErrorTimer) clearTimeout(pageErrorTimer)
    if (message) {
      pageErrorTimer = setTimeout(() => { pageError = '' }, 8000)
    }
  }
  let loginPortOccupant: PortOccupant | null = null
  let windowFocused = true
  let killingLoginPortOccupant = false
  let accountActionKey = ''
  let providerOpeningId = ''
  let updateState: AppUpdateState = {
    status: 'idle',
    delivery: 'auto',
    currentVersion: '--',
    supported: false
  let localGatewayPortOccupant: PortOccupant | null = null
  }
  let usageByAccountId: Record<string, AccountRateLimits> = {}
  let killingLocalGatewayPortOccupant = false
  let usageLoadingByAccountId: Record<string, boolean> = {}
  let usageErrorByAccountId: Record<string, string> = {}
  let wakingAccountId = ''
  let wakeDialogAccount: AccountSummary | null = null
  let wakeDialogTab: WakeDialogTab = 'session'
  let wakePromptDraft = 'ping'
  let wakeModelDraft = defaultWakeModel
  let wakeDialogStatus: WakeDialogStatus = 'idle'
  let wakeDialogLogs: string[] = []
  let wakeRequestResult: WakeAccountRequestResult | null = null
  let wakeRequestError = ''
  let wakeRawResponseBody = ''
  let showExportFormatDialog = false
  let renderExportFormatDialog = false
  let exportDialogMotionState: TransitionMotionState = 'closed'
  let exportDialogCloseTimer: number | null = null
  let exportDialogOpenFrame: number | null = null
  let exportDialogBusy = false
  let exportDialogError = ''
  let exportDialogAccountIds: string[] | null = null
  let exportDialogFormat: AccountTransferFormat = 'codexdock'
  let localGatewayBusy = false
  let localGatewayApiKey = ''
  let wakeScheduleEnabledDraft = true
  let wakeScheduleTimesDraft: string[] = ['09:00']
  let wakeSchedulePromptDraft = 'ping'
  let wakeScheduleModelDraft = defaultWakeModel
  let wakeScheduleError = ''
  let wakeScheduleSaving = false
  let editTokensDialogAccount: AccountSummary | null = null
  let editTokensAccessTokenDraft = ''
  let editTokensRefreshTokenDraft = ''
  let editTokensIdTokenDraft = ''
  let editTokensAccountIdHintDraft = ''
  let editTokensError = ''
  let editTokensSaving = false
  let editTokensLoading = false
  let editTokensLoadRequestId = 0
  const isTrayView =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('tray') === '1'
  let prefersDark = false
  const bodyClasses = [
    'm-0',
    'min-h-screen',
    isTrayView ? 'bg-transparent' : 'bg-snow',
    'text-carbon',
    'font-ui',
    'antialiased'
  ]

  const panelClass = 'theme-workspace bg-snow p-0'

  const copyForLanguage = (): (typeof messages)['zh-CN'] => messages[snapshot.settings.language]
  const exportFormatOptionOrder = [...accountTransferFormats]
  const resolvedTheme = (theme: AppTheme): 'light' | 'dark' =>
    theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme

  const prefersReducedMotion = (): boolean =>
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const themeTransitionPoint = (
    origin?: ThemeTransitionOrigin
  ): { x: number; y: number } | null => {
    if (typeof window === 'undefined' || !origin) {
      return null
    }

    if (Number.isFinite(origin.x) && Number.isFinite(origin.y)) {
      return {
        x: Math.max(0, Math.min(window.innerWidth, origin.x ?? 0)),
        y: Math.max(0, Math.min(window.innerHeight, origin.y ?? 0))
      }
    }

    if (origin.target) {
      const rect = origin.target.getBoundingClientRect()

      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      }
    }

    return null
  }

  const applyThemeWithRipple = (theme: AppTheme, origin?: ThemeTransitionOrigin): void => {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      return
    }

    const transitionDocument = document as DocumentWithViewTransitions
    const point = themeTransitionPoint(origin)

    if (
      !point ||
      prefersReducedMotion() ||
      !transitionDocument.startViewTransition ||
      !document.documentElement.animate
    ) {
      applyTheme(theme)
      return
    }

    const transition = transitionDocument.startViewTransition(() => {
      applyTheme(theme)
    })

    void transition.ready
      .then(() => {
        const endRadius = Math.hypot(
          Math.max(point.x, window.innerWidth - point.x),
          Math.max(point.y, window.innerHeight - point.y)
        )

        document.documentElement.animate(
          {
            clipPath: [
              `circle(0px at ${point.x}px ${point.y}px)`,
              `circle(${endRadius}px at ${point.x}px ${point.y}px)`
            ]
          },
          {
            duration: 520,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            pseudoElement: '::view-transition-new(root)'
          }
        )
      })
      .catch(() => {
        transition.skipTransition()
      })
  }

  const exportFormatLabel = (format: AccountTransferFormat): string => {
    const copy = copyForLanguage()

    switch (format) {
      case 'cockpit_tools':
        return copy.exportFormatCockpitTools
      case 'sub2api':
        return copy.exportFormatSub2api
      case 'cliproxyapi':
        return copy.exportFormatCliProxyApi
      case 'codexdock':
      default:
        return copy.exportFormatCodexDock
    }
  }

  const exportFormatDescription = (format: AccountTransferFormat): string => {
    const copy = copyForLanguage()

    switch (format) {
      case 'cockpit_tools':
        return copy.exportFormatCockpitToolsDescription
      case 'sub2api':
        return copy.exportFormatSub2apiDescription
      case 'cliproxyapi':
        return copy.exportFormatCliProxyApiDescription
      case 'codexdock':
      default:
        return copy.exportFormatCodexDockDescription
    }
  }

  const exportDialogScopeLabel = (): string =>
    exportDialogAccountIds?.length
      ? copyForLanguage().exportFormatTargetSelected(exportDialogAccountIds.length)
      : copyForLanguage().exportFormatTargetAll

  const modalCloseDurationMs = (): number => {
    if (prefersReducedMotion() || typeof document === 'undefined') {
      return 0
    }

    return (
      parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--modal-close-dur')
      ) || 150
    )
  }

  const clearExportDialogTimers = (): void => {
    if (exportDialogCloseTimer != null) {
      window.clearTimeout(exportDialogCloseTimer)
      exportDialogCloseTimer = null
    }
    if (exportDialogOpenFrame != null) {
      window.cancelAnimationFrame(exportDialogOpenFrame)
      exportDialogOpenFrame = null
    }
  }

  const resetExportDialog = (): void => {
    exportDialogError = ''
    exportDialogAccountIds = null
    exportDialogFormat = 'codexdock'
  }

  const finishExportFormatDialogClose = (): void => {
    renderExportFormatDialog = false
    exportDialogMotionState = 'closed'
    exportDialogCloseTimer = null
    resetExportDialog()
  }

  const openExportDialogMotion = (): void => {
    clearExportDialogTimers()
    renderExportFormatDialog = true
    showExportFormatDialog = true
    exportDialogMotionState = 'closed'
    exportDialogOpenFrame = window.requestAnimationFrame(() => {
      exportDialogOpenFrame = null
      exportDialogMotionState = 'open'
    })
  }

  const closeExportDialogMotion = (): void => {
    if (!renderExportFormatDialog) {
      showExportFormatDialog = false
      resetExportDialog()
      return
    }

    clearExportDialogTimers()
    showExportFormatDialog = false
    exportDialogMotionState = 'closing'
    exportDialogCloseTimer = window.setTimeout(
      finishExportFormatDialogClose,
      modalCloseDurationMs()
    )
  }

  const toolbarDialogOpen = (): boolean =>
    (showCallbackLoginDetails &&
      loginEvent?.method === 'browser' &&
      Boolean(loginEvent?.authUrl || loginEvent?.localCallbackUrl || loginEvent?.rawOutput)) ||
    (showDeviceLoginDetails &&
      loginEvent?.method === 'device' &&
      Boolean(loginEvent?.verificationUrl || loginEvent?.userCode || loginEvent?.rawOutput))

  const applyTheme = (theme: AppTheme): void => {
    if (typeof document === 'undefined') {
      return
    }

    const nextTheme = resolvedTheme(theme)
    document.documentElement.dataset.theme = nextTheme
    document.documentElement.style.colorScheme = nextTheme
  }

  const refreshSnapshot = async (): Promise<void> => {
    applySnapshot(await window.codexApp.getSnapshot())
  }

  const closeExpandablePanels = (
    except?: 'browser-login' | 'device-login'
  ): void => {
    if (except !== 'browser-login') {
      showCallbackLoginDetails = false
    }
    if (except !== 'device-login') {
      showDeviceLoginDetails = false
    }
  }

  const hasLoginPortConflict = (): boolean => {
    const message = `${pageError}\n${loginEvent?.message ?? ''}`.toLowerCase()
    return message.includes('1455') && (message.includes('占用') || message.includes('in use'))
  }

  const refreshLoginPortOccupant = async (): Promise<void> => {
    loginPortOccupant = await window.codexApp.getLoginPortOccupant()
  }

  const loginActionBusy = (): boolean => loginStarting || killingLoginPortOccupant

  const refreshAppMeta = async (): Promise<void> => {
  const localGatewayPort = (): number => snapshot.settings.localGateway?.port ?? 11456

  const hasLocalGatewayPortConflict = (): boolean => {
    const message = pageError.toLowerCase()
    const port = String(localGatewayPort())
    return (
      (message.includes(port) || message.includes('local gateway') || message.includes('本地')) &&
      (message.includes('eaddrinuse') ||
        message.includes('address already in use') ||
        message.includes('占用') ||
        message.includes('in use'))
    )
  }

    appMeta = await window.codexApp.getAppMeta()
    applySnapshot(rawSnapshot)
  }

  const refreshLocalGatewayPortOccupant = async (): Promise<void> => {
    localGatewayPortOccupant = await window.codexApp.getLocalGatewayPortOccupant()
  }

  const refreshUpdateState = async (): Promise<void> => {
    updateState = await window.codexApp.getUpdateState()
  }

  const shouldShowCodexDesktopExecutablePath = (): boolean =>
    appMeta.isPackaged === false || appMeta.platform === 'win32'

  const bestAccount = (): AccountSummary | null =>
    resolveBestAccount(snapshot.accounts, usageByAccountId, snapshot.activeAccountId)

  const canAutoPollUsage = (accountId: string): boolean => {
    if (usageErrorByAccountId[accountId]) {
      return true
    }

    return shouldAutoPollUsage(usageByAccountId[accountId], snapshot.settings.usagePollingMinutes)
  }

  const syncUsageState = (accounts: AccountSummary[]): void => {
    const accountIds = new Set(accounts.map((account) => account.id))
    usageByAccountId = Object.fromEntries(
      Object.entries(usageByAccountId).filter(([accountId]) => accountIds.has(accountId))
    )
    usageLoadingByAccountId = Object.fromEntries(
      Object.entries(usageLoadingByAccountId).filter(([accountId]) => accountIds.has(accountId))
    )
    usageErrorByAccountId = Object.fromEntries(
      Object.entries(usageErrorByAccountId).filter(([accountId]) => accountIds.has(accountId))
    )
  }

  const applySnapshot = (nextSnapshot: AppSnapshot, options: ApplySnapshotOptions = {}): void => {
    const snapshotSource = options.preserveUsageState
      ? {
          ...nextSnapshot,
          usageByAccountId: preserveAccountScopedRecord(
            nextSnapshot.accounts,
            nextSnapshot.usageByAccountId,
            usageByAccountId
          ),
          usageErrorByAccountId: preserveAccountScopedRecord(
            nextSnapshot.accounts,
            nextSnapshot.usageErrorByAccountId,
            usageErrorByAccountId
          )
        }
      : nextSnapshot

    rawSnapshot = snapshotSource
    const visibleSnapshot = snapshotSource

    const nextUsageByAccountId = accountScopedRecord(
      visibleSnapshot.accounts,
      visibleSnapshot.usageByAccountId
    )
    const nextUsageErrorByAccountId = accountScopedRecord(
      visibleSnapshot.accounts,
      visibleSnapshot.usageErrorByAccountId
    )

    snapshot = {
      ...visibleSnapshot,
      usageByAccountId: nextUsageByAccountId,
      usageErrorByAccountId: nextUsageErrorByAccountId
    }
    applyTheme(visibleSnapshot.settings.theme)
    usageByAccountId = nextUsageByAccountId
    usageErrorByAccountId = nextUsageErrorByAccountId
    syncUsageState(visibleSnapshot.accounts)
  }

  const clearUsageError = (accountId: string): void => {
    const nextState = { ...usageErrorByAccountId }
    delete nextState[accountId]
    usageErrorByAccountId = nextState
  }

  const wakeTimestamp = (): string =>
    new Intl.DateTimeFormat(snapshot.settings.language === 'en' ? 'en-US' : 'zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(new Date())

  const pushWakeLog = async (message: string): Promise<void> => {
    wakeDialogLogs = [...wakeDialogLogs, `[${wakeTimestamp()}] ${message}`]
  }

  const resetWakeDialogState = (): void => {
    wakeDialogStatus = 'idle'
    wakeDialogLogs = []
    wakeRequestResult = null
    wakeRequestError = ''
    wakeRawResponseBody = ''
  }

  const wakeResponsePreview = (body: string): string => {
    const firstLine = body
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean)

    if (!firstLine) {
      return copyForLanguage().wakeQuotaResultEmpty
    }

    return firstLine.length > 160 ? `${firstLine.slice(0, 157)}...` : firstLine
  }

  const currentWakeScheduleDialog = (): AccountWakeSchedule | null =>
    wakeDialogAccount ? (snapshot.wakeSchedulesByAccountId[wakeDialogAccount.id] ?? null) : null

  const inlineUpdateSummary = (): string => {
    switch (updateState.status) {
      case 'checking':
        return copyForLanguage().checkingUpdates
      case 'available':
        return copyForLanguage().updateAvailableVersion(updateState.availableVersion)
      case 'downloading':
        return updateState.delivery === 'external' && updateState.externalAction === 'homebrew'
          ? copyForLanguage().homebrewUpdateStatus(
              updateState.externalCommandStatus,
              updateState.externalCommand
            )
          : copyForLanguage().updateDownloadProgress(updateState.downloadProgress)
      case 'downloaded':
        return copyForLanguage().updateReady
      case 'up-to-date':
        return copyForLanguage().updateUpToDate
      case 'unsupported':
        return copyForLanguage().updatesUnsupported
      case 'error':
        return updateState.message || copyForLanguage().updateFailed
      default:
        return ''
    }
  }

  const inlineUpdateActionLabel = (): string | null => {
    switch (updateState.status) {
      case 'available':
        return updateState.delivery === 'external'
          ? updateState.externalAction === 'homebrew'
            ? copyForLanguage().updateViaHomebrew(updateState.availableVersion)
            : copyForLanguage().openReleasePage(updateState.availableVersion)
          : copyForLanguage().downloadUpdate(updateState.availableVersion)
      case 'downloaded':
        return copyForLanguage().restartToInstallUpdate
      default:
        return null
    }
  }

  const runInlineUpdateAction = (): void => {
    switch (updateState.status) {
      case 'available':
        void downloadUpdate()
        return
      case 'downloaded':
        void installUpdate()
        return
      default:
        return
    }
  }

  const clearUsageData = (accountId: string): void => {
    const nextUsageByAccountId = { ...usageByAccountId }
    delete nextUsageByAccountId[accountId]
    usageByAccountId = nextUsageByAccountId

    const nextSnapshotUsageByAccountId = { ...snapshot.usageByAccountId }
    delete nextSnapshotUsageByAccountId[accountId]
    snapshot = {
      ...snapshot,
      usageByAccountId: nextSnapshotUsageByAccountId
    }
  }

  const localizeKnownError = (error: unknown, fallback: string): string => {
    if (!(error instanceof Error)) {
      return fallback
    }

    const copy = copyForLanguage()
    return error.message
      .replace(
        'This account was saved with macOS Keychain protection in an older version. Re-import it to use it without Keychain prompts.',
        copy.legacyAccountNeedsReimport
      )
      .replace(
        'Credentials saved by older versions used macOS Keychain storage and can no longer be read. Re-add them in this version.',
        copy.legacyAccountNeedsReimport
      )
      .replace(
        'This provider API key was saved with macOS Keychain protection in an older version. Edit the provider and save the API key again.',
        copy.legacyProviderNeedsApiKey
      )
  }

  const clearUsageLoading = (accountId: string): void => {
    const nextState = { ...usageLoadingByAccountId }
    delete nextState[accountId]
    usageLoadingByAccountId = nextState
  }

  const runAction = async (
    _key: string,
    task: () => Promise<AppSnapshot>,
    options: ApplySnapshotOptions = {}
  ): Promise<void> => {
    setPageError('')

    try {
      applySnapshot(await task(), options)
    } catch (error) {
      setPageError(localizeKnownError(error, copyForLanguage().actionFailed))
    }
  }

  const runAccountAction = async (key: string, task: () => Promise<AppSnapshot>): Promise<void> => {
    if (accountActionKey) {
      return
    }

    accountActionKey = key

    try {
      await runAction(key, task)
    } finally {
      accountActionKey = ''
    }
  }

  const createProvider = async (input: CreateCustomProviderInput): Promise<void> => {
    await runAction(`provider:create:${input.baseUrl}`, () => window.codexApp.createProvider(input))
  }

  const probeProviderModels = (
    input: ProbeProviderModelsInput
  ): Promise<ProviderModelsProbeResult> => window.codexApp.probeProviderModels(input)

  const updateProvider = async (
    providerId: string,
    input: UpdateCustomProviderInput
  ): Promise<void> => {
    await runAction(`provider:update:${providerId}`, () =>
      window.codexApp.updateProvider(providerId, input)
    )
  }

  const removeProvider = async (providerId: string): Promise<void> => {
    await runAction(`provider:remove:${providerId}`, () =>
      window.codexApp.removeProvider(providerId)
    )
  }

  const runLocalGatewayAction = async (task: () => Promise<void>): Promise<void> => {
    if (localGatewayBusy) {
      return
    }

    localGatewayBusy = true
    try {
      await task()
    } finally {
      localGatewayBusy = false
    }
  }

  const startLocalGateway = async (): Promise<void> =>
    runLocalGatewayAction(async () => {
      setPageError('')
      localGatewayPortOccupant = null
      try {
        applySnapshot(await window.codexApp.startLocalGateway())
      } catch (error) {
        setPageError(localizeKnownError(error, copyForLanguage().actionFailed))
        if (hasLocalGatewayPortConflict()) {
          await refreshLocalGatewayPortOccupant()
        }
      }
    })

  const stopLocalGateway = async (): Promise<void> =>
    runLocalGatewayAction(async () => {
      await runAction('gateway:stop', () => window.codexApp.stopLocalGateway())
    })

  const rotateLocalGatewayKey = async (): Promise<void> =>
    runLocalGatewayAction(async () => {
      setPageError('')
      try {
        const result = await window.codexApp.rotateLocalGatewayKey()
        localGatewayApiKey = result.apiKey
        await navigator.clipboard.writeText(result.apiKey)
        await refreshSnapshot()
      } catch (error) {
        setPageError(localizeKnownError(error, copyForLanguage().actionFailed))
      }
    })

  const openLocalGatewayInCodex = async (): Promise<void> =>
    runLocalGatewayAction(async () => {
      await runAction('gateway:open-codex', () => window.codexApp.openLocalGatewayInCodex())
    })

  const updateLocalGatewayModelMappings = async (
    mappings: LocalGatewayModelMapping[]
  ): Promise<void> => {
    const currentGateway = snapshot.settings.localGateway
    await runAction('settings:gateway-mappings', () =>
      window.codexApp.updateSettings({
        localGateway: {
          ...(currentGateway ?? {}),
          modelMappings: mappings
        }
      })
    )
  }

  const updateLocalGatewayAllowedGroups = async (groupIds: string[]): Promise<void> => {
    const currentGateway = snapshot.settings.localGateway
    await runAction('settings:gateway-groups', () =>
      window.codexApp.updateSettings({
        localGateway: {
          ...(currentGateway ?? {}),
          allowedGroupIds: groupIds
        }
      })
    )
  }

  const updateLocalGatewayAllowedAccounts = async (accountIds: string[]): Promise<void> => {
    const currentGateway = snapshot.settings.localGateway
    await runAction('settings:gateway-accounts', () =>
      window.codexApp.updateSettings({
        localGateway: {
          ...(currentGateway ?? {}),
          allowedAccountIds: accountIds
        }
      })
    )
  }

  const getProvider = async (providerId: string): Promise<CustomProviderDetail> =>
    window.codexApp.getProvider(providerId)

  const reorderProviders = async (providerIds: string[]): Promise<void> => {
    if (
      providerIds.length !== snapshot.providers.length ||
      providerIds.every((providerId, index) => providerId === snapshot.providers[index]?.id)
    ) {
      return
    }

    await runAction('providers:reorder', () => window.codexApp.reorderProviders(providerIds))
  }

  const openProviderInCodex = async (providerId: string): Promise<void> => {
    if (providerOpeningId) {
      return
    }

    providerOpeningId = providerId
    try {
      await runAction(`provider:open:${providerId}`, () =>
        window.codexApp.openProviderInCodex(providerId)
      )
    } finally {
      providerOpeningId = ''
    }
  }

  const startLogin = async (method: LoginMethod): Promise<void> => {
    if (
      method === 'browser' &&
      loginEvent?.method === 'browser' &&
      loginEvent.phase === 'waiting'
    ) {
      closeExpandablePanels(showCallbackLoginDetails ? undefined : 'browser-login')
      showCallbackLoginDetails = !showCallbackLoginDetails
      return
    }

    if (method === 'device' && loginEvent?.method === 'device' && loginEvent.phase === 'waiting') {
      closeExpandablePanels(showDeviceLoginDetails ? undefined : 'device-login')
      showDeviceLoginDetails = !showDeviceLoginDetails
      return
    }

    closeExpandablePanels(method === 'browser' ? 'browser-login' : 'device-login')
    setPageError('')
    loginEvent = null
    loginPortOccupant = null
    loginStarting = true

    if (method === 'device') {
      showDeviceLoginDetails = true
    }

    if (method === 'browser') {
      showCallbackLoginDetails = true
    }

    try {
      await window.codexApp.startLogin(method)
      applySnapshot(await window.codexApp.getSnapshot())
    } catch (error) {
      loginStarting = false
      setPageError(localizeKnownError(error, copyForLanguage().startLoginFailed))
      if (hasLoginPortConflict()) {
        await refreshLoginPortOccupant()
      }
    }
  }

  const killLoginPortOccupant = async (): Promise<void> => {
    setPageError('')
    killingLoginPortOccupant = true

    try {
      loginPortOccupant = await window.codexApp.killLoginPortOccupant()
      await refreshLoginPortOccupant()
    } catch (error) {
      setPageError(localizeKnownError(error, copyForLanguage().killPortOccupantFailed))
    } finally {
      killingLoginPortOccupant = false
    }
  }

  const removeAccount = async (account: AccountSummary): Promise<void> => {
    if (
      !window.confirm(copyForLanguage().removeConfirm(accountLabel(account, copyForLanguage())))
    ) {
      return
    }

  const killLocalGatewayPortOccupant = async (): Promise<void> => {
    setPageError('')
    killingLocalGatewayPortOccupant = true

    try {
      localGatewayPortOccupant = await window.codexApp.killLocalGatewayPortOccupant()
      await refreshLocalGatewayPortOccupant()
    } catch (error) {
      setPageError(localizeKnownError(error, copyForLanguage().killLocalGatewayPortOccupantFailed))
    } finally {
      killingLocalGatewayPortOccupant = false
    }
  }

    await runAction(`remove:${account.id}`, () => window.codexApp.removeAccount(account.id))
  }

  const openEditTokensDialog = (account: AccountSummary): void => {
    editTokensDialogAccount = account
    editTokensAccessTokenDraft = ''
    editTokensRefreshTokenDraft = ''
    editTokensIdTokenDraft = ''
    editTokensAccountIdHintDraft = ''
    editTokensError = ''
    editTokensSaving = false
    editTokensLoading = true

    const requestId = ++editTokensLoadRequestId
    void (async () => {
      try {
        const detail = await window.codexApp.getAccountTokens(account.id)
        if (requestId !== editTokensLoadRequestId || editTokensDialogAccount?.id !== account.id) {
          return
        }
        editTokensAccessTokenDraft = detail.accessToken ?? ''
        editTokensRefreshTokenDraft = detail.refreshToken ?? ''
        editTokensIdTokenDraft = detail.idToken ?? ''
        editTokensAccountIdHintDraft = detail.accountId ?? ''
      } catch (error) {
        if (requestId !== editTokensLoadRequestId || editTokensDialogAccount?.id !== account.id) {
          return
        }
        editTokensError = copyForLanguage().editAccountTokensLoadFailed(
          error instanceof Error ? error.message : String(error)
        )
      } finally {
        if (requestId === editTokensLoadRequestId) {
          editTokensLoading = false
        }
      }
    })()
  }

  const closeEditTokensDialog = (): void => {
    if (editTokensSaving) {
      return
    }
    editTokensLoadRequestId += 1
    editTokensDialogAccount = null
    editTokensLoading = false
    editTokensError = ''
  }

  const saveAccountTokens = async (): Promise<void> => {
    const target = editTokensDialogAccount
    if (!target || editTokensSaving || editTokensLoading) {
      return
    }

    const access = editTokensAccessTokenDraft.trim()
    const refresh = editTokensRefreshTokenDraft.trim()
    const idToken = editTokensIdTokenDraft.trim()
    const accountIdHint = editTokensAccountIdHintDraft.trim()

    if (!access && !refresh && !idToken && !accountIdHint) {
      editTokensError = copyForLanguage().editAccountTokensEmptyError
      return
    }

    editTokensSaving = true
    editTokensError = ''

    try {
      const nextSnapshot = await window.codexApp.updateAccountTokens(target.id, {
        accessToken: access || undefined,
        refreshToken: refresh || undefined,
        idToken: idToken || undefined,
        accountId: accountIdHint || undefined
      })
      applySnapshot(nextSnapshot)
      editTokensDialogAccount = null
    } catch (error) {
      editTokensError = copyForLanguage().editAccountTokensFailed(
        error instanceof Error ? error.message : String(error)
      )
    } finally {
      editTokensSaving = false
    }
  }

  const removeAccounts = async (accountIds: string[]): Promise<void> => {
    const uniqueIds = [...new Set(accountIds)]
    if (!uniqueIds.length) {
      return
    }

    if (!window.confirm(copyForLanguage().removeSelectedConfirm(uniqueIds.length))) {
      return
    }

    await runAction(`remove-many:${uniqueIds.join(',')}`, () =>
      window.codexApp.removeAccounts(uniqueIds)
    )
  }

  const closeExportFormatDialog = (): void => {
    if (exportDialogBusy) {
      return
    }

    closeExportDialogMotion()
  }

  const openExportFormatDialog = (accountIds?: string[]): void => {
    const uniqueIds = accountIds?.length ? [...new Set(accountIds)] : null
    if (accountIds?.length && !uniqueIds?.length) {
      return
    }

    exportDialogAccountIds = uniqueIds
    exportDialogFormat = 'codexdock'
    exportDialogError = ''
    openExportDialogMotion()
  }

  const submitExportFormatDialog = async (): Promise<void> => {
    if (exportDialogBusy || exportDialogMotionState === 'closing' || !showExportFormatDialog) {
      return
    }

    exportDialogBusy = true
    exportDialogError = ''

    try {
      const nextSnapshot = exportDialogAccountIds?.length
        ? await window.codexApp.exportSelectedAccountsToFile(
            exportDialogAccountIds,
            exportDialogFormat
          )
        : await window.codexApp.exportAccountsToFile(exportDialogFormat)
      applySnapshot(nextSnapshot)
      closeExportDialogMotion()
    } catch (error) {
      exportDialogError = localizeKnownError(error, copyForLanguage().actionFailed)
    } finally {
      exportDialogBusy = false
    }
  }

  const exportSelectedAccounts = async (accountIds: string[]): Promise<void> => {
    const uniqueIds = [...new Set(accountIds)]
    if (!uniqueIds.length) {
      return
    }

    openExportFormatDialog(uniqueIds)
  }

  const reorderAccounts = async (accountIds: string[]): Promise<void> => {
    if (!accountIds.length) {
      return
    }

    const payloadAccountIds = new Set(accountIds)
    const currentPayloadOrder = snapshot.accounts
      .filter((account) => payloadAccountIds.has(account.id))
      .map((account) => account.id)

    if (
      currentPayloadOrder.length === accountIds.length &&
      accountIds.every((accountId, index) => accountId === currentPayloadOrder[index])
    ) {
      return
    }

    await runAction('accounts:reorder', () => window.codexApp.reorderAccounts(accountIds), {
      preserveUsageState: true
    })
  }

  const createGroup = async (name: string): Promise<void> => {
    await runAction(`groups:create:${name}`, () => window.codexApp.createGroup(name))
  }

  const updateGroup = async (group: AccountGroup, name: string): Promise<void> => {
    await runAction(`groups:update:${group.id}`, () => window.codexApp.updateGroup(group.id, name))
  }

  const deleteGroup = async (group: AccountGroup): Promise<void> => {
    await runAction(`groups:delete:${group.id}`, () => window.codexApp.deleteGroup(group.id))
  }

  const updateAccountGroups = async (
    account: AccountSummary,
    groupIds: string[]
  ): Promise<void> => {
    if (
      groupIds.length === account.groupIds.length &&
      groupIds.every((groupId, index) => groupId === account.groupIds[index])
    ) {
      return
    }

    await runAction(`account-groups:${account.id}`, () =>
      window.codexApp.updateAccountGroups(account.id, groupIds)
    )
  }

  const copyText = async (value?: string): Promise<void> => {
    if (!value) {
      return
    }

    await navigator.clipboard.writeText(value)
  }

  const copyAuthUrl = async (): Promise<void> => {
    await copyText(loginEvent?.verificationUrl ?? loginEvent?.authUrl)
  }

  const copyDeviceCode = async (): Promise<void> => {
    await copyText(loginEvent?.userCode)
  }

  const openExternalLink = (url?: string): void => {
    if (!url) {
      return
    }

    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const readRateLimits = async (
    account: AccountSummary,
    options: { force?: boolean } = {}
  ): Promise<void> => {
    if (usageLoadingByAccountId[account.id] || (!options.force && !canAutoPollUsage(account.id))) {
      return
    }

    usageLoadingByAccountId = {
      ...usageLoadingByAccountId,
      [account.id]: true
    }
    clearUsageError(account.id)

    try {
      const rateLimits = await window.codexApp.readAccountRateLimits(account.id)
      usageByAccountId = {
        ...usageByAccountId,
        [account.id]: rateLimits
      }
      snapshot = {
        ...snapshot,
        usageByAccountId: {
          ...snapshot.usageByAccountId,
          [account.id]: rateLimits
        }
      }
    } catch (error) {
      if (usageErrorKind(error instanceof Error ? error.message : undefined) === 'expired') {
        clearUsageData(account.id)
      }

      usageErrorByAccountId = {
        ...usageErrorByAccountId,
        [account.id]: localizeKnownError(error, copyForLanguage().readRateLimitFailed)
      }
    } finally {
      clearUsageLoading(account.id)
    }
  }

  const closeWakeDialog = (): void => {
    if (wakingAccountId || wakeScheduleSaving) {
      return
    }

    wakeDialogAccount = null
    wakeDialogTab = 'session'
    resetWakeDialogState()
    wakeScheduleError = ''
  }

  const hydrateWakeScheduleDrafts = (account: AccountSummary): void => {
    const schedule = snapshot.wakeSchedulesByAccountId[account.id]
    wakeScheduleEnabledDraft = schedule?.enabled ?? true
    wakeScheduleTimesDraft = schedule?.times.length ? [...schedule.times] : ['09:00']
    wakeSchedulePromptDraft = schedule?.prompt ?? 'ping'
    wakeScheduleModelDraft = schedule?.model ?? defaultWakeModel
    wakeScheduleError = ''
  }

  const openWakeDialog = (account: AccountSummary, initialTab: WakeDialogTab = 'session'): void => {
    if (wakingAccountId || wakeScheduleSaving || usageLoadingByAccountId[account.id]) {
      return
    }

    wakeDialogAccount = account
    wakeDialogTab = initialTab
    resetWakeDialogState()
    hydrateWakeScheduleDrafts(account)
    void pushWakeLog(copyForLanguage().wakeQuotaLogReady(accountLabel(account, copyForLanguage())))
  }

  const handleGlobalKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') {
      return
    }

    if (showExportFormatDialog && !exportDialogBusy) {
      closeExportFormatDialog()
      return
    }

    if (toolbarDialogOpen()) {
      closeExpandablePanels()
      return
    }

    if (wakeDialogAccount && !wakingAccountId && !wakeScheduleSaving) {
      closeWakeDialog()
    }
  }

  const saveWakeSchedule = async (): Promise<void> => {
    if (!wakeDialogAccount || wakeScheduleSaving || wakingAccountId) {
      return
    }

    const times = normalizeWakeScheduleTimes(wakeScheduleTimesDraft)
    if (!times.length) {
      wakeScheduleError = copyForLanguage().wakeScheduleNoTimes
      return
    }

    if (!times.every(isValidWakeScheduleTime)) {
      wakeScheduleError = copyForLanguage().wakeScheduleInvalidTime
      return
    }

    wakeScheduleSaving = true
    wakeScheduleError = ''

    const input: UpdateAccountWakeScheduleInput = {
      enabled: wakeScheduleEnabledDraft,
      times,
      prompt: wakeSchedulePromptDraft.trim() || 'ping',
      model: wakeScheduleModelDraft.trim() || defaultWakeModel
    }

    try {
      applySnapshot(await window.codexApp.updateAccountWakeSchedule(wakeDialogAccount.id, input))
      wakeScheduleError = ''
    } catch (error) {
      wakeScheduleError = localizeKnownError(error, copyForLanguage().actionFailed)
    } finally {
      wakeScheduleSaving = false
    }
  }

  const deleteWakeSchedule = async (): Promise<void> => {
    if (!wakeDialogAccount || wakeScheduleSaving || wakingAccountId) {
      return
    }

    wakeScheduleSaving = true
    wakeScheduleError = ''

    try {
      applySnapshot(await window.codexApp.deleteAccountWakeSchedule(wakeDialogAccount.id))
      hydrateWakeScheduleDrafts(wakeDialogAccount)
    } catch (error) {
      wakeScheduleError = localizeKnownError(error, copyForLanguage().actionFailed)
    } finally {
      wakeScheduleSaving = false
    }
  }

  const wakeRateLimitReset = async (
    account: AccountSummary,
    input?: WakeAccountRateLimitsInput
  ): Promise<WakeAccountRequestResult | null> => {
    if (wakingAccountId || usageLoadingByAccountId[account.id]) {
      return null
    }

    wakingAccountId = account.id
    usageLoadingByAccountId = {
      ...usageLoadingByAccountId,
      [account.id]: true
    }
    clearUsageError(account.id)

    try {
      const result = await window.codexApp.wakeAccountRateLimits(account.id, input)
      usageByAccountId = {
        ...usageByAccountId,
        [account.id]: result.rateLimits
      }
      snapshot = {
        ...snapshot,
        usageByAccountId: {
          ...snapshot.usageByAccountId,
          [account.id]: result.rateLimits
        }
      }
      return result.requestResult
    } catch (error) {
      if (usageErrorKind(error instanceof Error ? error.message : undefined) === 'expired') {
        clearUsageData(account.id)
      }

      usageErrorByAccountId = {
        ...usageErrorByAccountId,
        [account.id]: localizeKnownError(error, copyForLanguage().readRateLimitFailed)
      }
      throw error
    } finally {
      clearUsageLoading(account.id)
      if (wakingAccountId === account.id) {
        wakingAccountId = ''
      }
    }
  }

  const submitWakeDialog = async (): Promise<void> => {
    if (!wakeDialogAccount) {
      return
    }

    resetWakeDialogState()
    wakeDialogStatus = 'running'
    await pushWakeLog(copyForLanguage().wakeQuotaLogStart(wakeModelDraft || defaultWakeModel))
    await pushWakeLog(copyForLanguage().wakeQuotaLogPrompt(wakePromptDraft || 'ping'))
    await pushWakeLog(copyForLanguage().wakeQuotaLogRequesting)

    try {
      wakeRequestResult = await wakeRateLimitReset(wakeDialogAccount, {
        prompt: wakePromptDraft,
        model: wakeModelDraft
      })
      wakeRawResponseBody = wakeRequestResult?.body ?? ''

      if (!wakeRequestResult) {
        wakeDialogStatus = 'skipped'
        await pushWakeLog(copyForLanguage().wakeQuotaLogSkipped)
        return
      }

      await pushWakeLog(copyForLanguage().wakeQuotaLogAccepted(wakeRequestResult.status))
      await pushWakeLog(
        copyForLanguage().wakeQuotaLogResponse(wakeResponsePreview(wakeRequestResult.body))
      )
      await pushWakeLog(copyForLanguage().wakeQuotaLogRefreshingUsage)

      const nextRateLimits = usageByAccountId[wakeDialogAccount.id]
      if (nextRateLimits?.primary?.resetsAt != null) {
        await pushWakeLog(
          copyForLanguage().wakeQuotaLogSessionReset(
            formatRelativeReset(nextRateLimits.primary.resetsAt, snapshot.settings.language)
          )
        )
      }
      if (supportsWeeklyQuota(nextRateLimits) && nextRateLimits?.secondary?.resetsAt != null) {
        await pushWakeLog(
          copyForLanguage().wakeQuotaLogWeeklyReset(
            formatRelativeReset(nextRateLimits.secondary.resetsAt, snapshot.settings.language)
          )
        )
      }

      wakeDialogStatus = 'success'
      await pushWakeLog(copyForLanguage().wakeQuotaLogCompleted)
    } catch (error) {
      wakeRequestError = localizeKnownError(error, copyForLanguage().readRateLimitFailed)
      wakeDialogStatus = 'error'
      await pushWakeLog(copyForLanguage().wakeQuotaLogFailed(wakeRequestError))
    }
  }

  const updatePollingInterval = async (minutes: number): Promise<void> => {
    await runAction('settings:usage-polling', () =>
      window.codexApp.updateSettings({ usagePollingMinutes: minutes })
    )
  }

  const updateLanguage = async (language: AppLanguage): Promise<void> => {
    if (snapshot.settings.language === language) {
      return
    }

    await runAction('settings:language', () => window.codexApp.updateSettings({ language }))
  }

  const updateTheme = async (theme: AppTheme, origin?: ThemeTransitionOrigin): Promise<void> => {
    if (snapshot.settings.theme === theme) {
      return
    }

    applyThemeWithRipple(theme, origin)
    await runAction('settings:theme', () => window.codexApp.updateSettings({ theme }))
  }

  const updateCheckForUpdatesOnStartup = async (enabled: boolean): Promise<void> => {
    if (snapshot.settings.checkForUpdatesOnStartup === enabled) {
      return
    }

    await runAction('settings:update-check', () =>
      window.codexApp.updateSettings({ checkForUpdatesOnStartup: enabled })
    )
  }

  const updateShowLocalMockData = async (enabled: boolean): Promise<void> => {
    if ((snapshot.settings.showLocalMockData ?? true) === enabled) {
      return
    }

    await runAction('settings:show-local-mock-data', () =>
      window.codexApp.updateSettings({ showLocalMockData: enabled })
    )
  }

  const updateCodexDesktopExecutablePath = async (value: string): Promise<void> => {
    const normalized = value.trim()
    if (snapshot.settings.codexDesktopExecutablePath === normalized) {
      return
    }

    await runAction('settings:codex-desktop-executable-path', () =>
      window.codexApp.updateSettings({ codexDesktopExecutablePath: normalized })
    )
  }

  const toggleStatusAccount = async (accountId: string): Promise<void> => {
    const nextIds = snapshot.settings.statusBarAccountIds.includes(accountId)
      ? snapshot.settings.statusBarAccountIds.filter((id) => id !== accountId)
      : [...snapshot.settings.statusBarAccountIds, accountId].slice(0, 5)

    await runAction('settings:status-accounts', () =>
      window.codexApp.updateSettings({ statusBarAccountIds: nextIds })
    )
  }

  const updateStatsDisplay = async (statsDisplay: StatsDisplaySettings): Promise<void> => {
    const current = normalizeStatsDisplaySettings(snapshot.settings.statsDisplay)
    const next = normalizeStatsDisplaySettings(statsDisplay)

    if (JSON.stringify(current) === JSON.stringify(next)) {
      return
    }

    await runAction('settings:stats-display', () =>
      window.codexApp.updateSettings({ statsDisplay: next })
    )
  }

  const openMainPanel = async (): Promise<void> => {
    applySnapshot(await window.codexApp.openMainWindow())
  }

  const openCodex = async (): Promise<void> => {
    await runAction('codex:open', () => window.codexApp.openCodex())
  }

  const downloadUpdate = async (): Promise<void> => {
    if (updateState.delivery === 'external' && updateState.externalAction !== 'homebrew') {
      openExternalLink(updateState.externalDownloadUrl ?? appMeta.githubUrl ?? undefined)
      return
    }

    updateState = await window.codexApp.downloadUpdate()
  }

  const checkForUpdates = async (): Promise<void> => {
    updateState = await window.codexApp.checkForUpdates()
  }

  const installUpdate = async (): Promise<void> => {
    await window.codexApp.installUpdate()
  }

  const refreshAllRateLimits = async (): Promise<void> => {
    if (!snapshot.accounts.length || refreshingAllUsage) {
      return
    }

    closeExpandablePanels()
    refreshingAllUsage = true

    try {
      for (const account of snapshot.accounts) {
        await readRateLimits(account, { force: true })
      }
    } finally {
      refreshingAllUsage = false
    }
  }

  onMount(() => {
    const darkMedia = window.matchMedia('(prefers-color-scheme: dark)')
    prefersDark = darkMedia.matches
    document.body.classList.add(...bodyClasses)
    applyTheme(snapshot.settings.theme)
    void refreshSnapshot()
    void refreshAppMeta()
    void refreshUpdateState()

    const handleThemeChange = (event: MediaQueryListEvent): void => {
      prefersDark = event.matches
      applyTheme(snapshot.settings.theme)
    }

    darkMedia.addEventListener('change', handleThemeChange)

    const disposeSnapshot = window.codexApp.onSnapshotUpdated((nextSnapshot) => {
      applySnapshot(nextSnapshot)
    })

    const disposeUpdateState = window.codexApp.onUpdateState((nextState) => {
      updateState = nextState
    })

    const disposeLogin = window.codexApp.onLoginEvent((event) => {
      loginEvent = event
      loginStarting = event.phase === 'starting'

      if (event.method === 'browser' && event.phase === 'waiting') {
        showCallbackLoginDetails = true
      }

      if (event.method === 'device' && event.phase === 'waiting') {
        showDeviceLoginDetails = true
      }

      if (event.method === 'device' && event.phase === 'success') {
        showDeviceLoginDetails = false
      }

      if (event.snapshot) {
        applySnapshot(event.snapshot)
        return
      }

      if (event.phase === 'error' && hasLoginPortConflict()) {
        void refreshLoginPortOccupant()
      }

      void refreshSnapshot()
    })

    return () => {
      document.body.classList.remove(...bodyClasses)
      delete document.documentElement.dataset.theme
      document.documentElement.style.removeProperty('color-scheme')
      darkMedia.removeEventListener('change', handleThemeChange)
      disposeSnapshot()
      disposeUpdateState()
      disposeLogin()
      clearExportDialogTimers()
    }
  })
</script>

<svelte:head>
  <title>CodexDock</title>
</svelte:head>

<svelte:window
  on:keydown={handleGlobalKeydown}
  on:focus={() => {
    windowFocused = true
  }}
  on:blur={() => {
    windowFocused = false
  }}
/>

<div class={`app-shell ${isTrayView ? 'min-h-screen' : 'h-screen overflow-hidden'} flex flex-col`}>
  {#if !isTrayView && appMeta.platform === 'darwin' && !windowFocused}
    <div class="mac-inactive-traffic-lights" aria-hidden="true">
      <span></span>
      <span></span>
      <span></span>
    </div>
  {/if}

  <div
    class={`mx-auto ${isTrayView ? 'grid gap-4 max-w-[420px] px-3 pb-3 pt-2' : 'flex h-0 min-h-0 w-full max-w-none flex-1 flex-col gap-0 p-0'}`}
  >
    {#if isTrayView}
      <TrayPanel
        {brandMark}
        {snapshot}
        {usageByAccountId}
        {pageError}
        copy={copyForLanguage()}
        {pollingOptions}
        statusAccounts={statusBarAccounts(
          snapshot.settings,
          snapshot.accounts,
          snapshot.activeAccountId
        )}
        {openMainPanel}
        {openCodex}
        {toggleStatusAccount}
        {updatePollingInterval}
      />
    {:else}
      <div
        class="relative grid h-full min-h-0 flex-1 items-stretch gap-0 grid-cols-[minmax(0,1fr)]"
      >
        <div class="flex h-full min-h-0 flex-col gap-0 overflow-hidden">
          <div
            class="flex h-0 min-h-0 flex-1 flex-col overflow-hidden"
            use:reveal={{ delay: 0.05 }}
          >
            <AccountsPanel
              {panelClass}
              copy={copyForLanguage()}
              workspaceVersion={appMeta.version}
              workspaceStatusText={loginEvent?.message ?? ''}
              platform={appMeta.platform}
              workspaceStatusToneClass={loginEvent
                ? loginTone(loginEvent.phase)
                : 'text-muted-strong'}
              updateSummary={inlineUpdateSummary()}
              updateActionLabel={inlineUpdateActionLabel()}
              runUpdateAction={runInlineUpdateAction}
              showLocalMockToggle={appMeta.isPackaged === false}
              language={snapshot.settings.language}
              showLocalMockData={snapshot.settings.showLocalMockData !== false}
              accounts={snapshot.accounts}
              codexInstances={snapshot.codexInstances}
              providers={snapshot.providers}
              localGatewayStatus={snapshot.localGatewayStatus ?? {
                running: false,
                baseUrl: 'http://127.0.0.1:11456',
                apiKeyPreview: ''
              }}
              {localGatewayBusy}
              {localGatewayApiKey}
              localGatewayModelMappings={snapshot.settings.localGateway?.modelMappings ?? []}
              localGatewayAllowedGroupIds={snapshot.settings.localGateway?.allowedGroupIds ?? []}
              localGatewayAllowedAccountIds={snapshot.settings.localGateway?.allowedAccountIds ?? []}
              groups={snapshot.groups}
              activeAccountId={snapshot.activeAccountId}
              {usageByAccountId}
              {usageLoadingByAccountId}
              {usageErrorByAccountId}
              tokenCostByInstanceId={snapshot.tokenCostByInstanceId}
              tokenCostErrorByInstanceId={snapshot.tokenCostErrorByInstanceId}
              runningTokenCostSummary={snapshot.runningTokenCostSummary}
              runningTokenCostInstanceIds={snapshot.runningTokenCostInstanceIds}
              statsDisplay={normalizeStatsDisplaySettings(snapshot.settings.statsDisplay)}
              wakeSchedulesByAccountId={snapshot.wakeSchedulesByAccountId}
              loginActionBusy={loginActionBusy()}
              {loginStarting}
              openAccountInCodex={(accountId) =>
                runAccountAction(`open:${accountId}`, () =>
                  window.codexApp.openAccountInCodex(accountId)
                )}
              openAccountInIsolatedCodex={(accountId) =>
                runAccountAction(`open-isolated:${accountId}`, () =>
                  window.codexApp.openAccountInIsolatedCodex(accountId)
                )}
              openingAccountId={accountActionKey.startsWith('open:')
                ? accountActionKey.slice('open:'.length)
                : ''}
              openingIsolatedAccountId={accountActionKey.startsWith('open-isolated:')
                ? accountActionKey.slice('open-isolated:'.length)
                : ''}
              {wakingAccountId}
              openingProviderId={providerOpeningId}
              {createProvider}
              {probeProviderModels}
              {getProvider}
              {reorderProviders}
              {updateProvider}
              {removeProvider}
              {startLocalGateway}
              {stopLocalGateway}
              {rotateLocalGatewayKey}
              {openLocalGatewayInCodex}
              {updateLocalGatewayModelMappings}
              {updateLocalGatewayAllowedGroups}
              {updateLocalGatewayAllowedAccounts}
              {openProviderInCodex}
              {reorderAccounts}
              {createGroup}
              {updateGroup}
              {deleteGroup}
              {updateAccountGroups}
              refreshAccountUsage={(account) => readRateLimits(account, { force: true })}
              {updateShowLocalMockData}
              {localGatewayPortOccupant}
              {killingLocalGatewayPortOccupant}
              {killLocalGatewayPortOccupant}
              {updateStatsDisplay}
              {openWakeDialog}
              {openEditTokensDialog}
              getAccountTokens={(accountId) => window.codexApp.getAccountTokens(accountId)}
              {removeAccount}
              {removeAccounts}
              {exportSelectedAccounts}
              readTokenCost={(input) => window.codexApp.readTokenCost(input)}
              listCodexSessionProjects={() => window.codexApp.listCodexSessionProjects()}
              listCodexSessions={(input) => window.codexApp.listCodexSessions(input)}
              readCodexSessionDetail={(input) => window.codexApp.readCodexSessionDetail(input)}
              copyCodexSessionToProvider={(input) =>
                window.codexApp.copyCodexSessionToProvider(input)}
              listCodexSkills={() => window.codexApp.listCodexSkills()}
              readCodexSkillDetail={(instanceId, skillDirName) =>
                window.codexApp.readCodexSkillDetail(instanceId, skillDirName)}
              copyCodexSkill={(input) => window.codexApp.copyCodexSkill(input)}
              {startLogin}
              importCurrent={() =>
                runAction('import', () => window.codexApp.importCurrentAccount())}
              importAccountsFile={() =>
                runAction('import:file', () => window.codexApp.importAccountsFromFile())}
              exportAccountsFile={() => openExportFormatDialog()}
              {refreshAllRateLimits}
              {refreshingAllUsage}
              activateBestAccount={() => {
                const target = bestAccount()
                if (!target || target.id === snapshot.activeAccountId) {
                  return
                }
                void runAccountAction(`activate:${target.id}`, () =>
                  window.codexApp.activateAccount(target.id)
                )
              }}
              bestAccount={bestAccount()}
              {appMeta}
              appSettings={snapshot.settings}
              theme={snapshot.settings.theme}
              {updateState}
              {updateLanguage}
              {updateTheme}
              {updatePollingInterval}
              {updateCheckForUpdatesOnStartup}
              {checkForUpdates}
              {downloadUpdate}
              {installUpdate}
              {openExternalLink}
              {updateCodexDesktopExecutablePath}
              showCodexDesktopExecutablePath={shouldShowCodexDesktopExecutablePath()}
            />
          </div>
        </div>

        {#if pageError}
          <section
            use:reveal={{ delay: 0 }}
            class="theme-surface theme-error-panel fixed bottom-20 left-1/2 z-[60] w-[min(calc(100vw-2rem),52rem)] -translate-x-1/2 rounded-[1rem] border border-danger/18 bg-white px-4 py-3.5 text-sm text-danger shadow-[0_20px_60px_-36px_var(--paper-shadow),0_10px_30px_-24px_var(--paper-shadow)]"
            role="alert"
            aria-live="assertive"
          >
            <div class="flex items-start gap-3">
              <span class="i-lucide-alert-circle mt-0.5 h-4 w-4 flex-none" aria-hidden="true"></span>
              <div class="grid min-w-0 flex-1 gap-2">
                <p class="break-words">{pageError}</p>
                {#if loginPortOccupant && hasLoginPortConflict()}
                  <div class="flex flex-wrap items-center gap-2 text-sm text-danger">
                    <span>
                      {copyForLanguage().portOccupied(
                        loginPortOccupant.command,
                        loginPortOccupant.pid
                      )}
                    </span>
                    <AppButton
                      variant="secondary"
                      size="sm"
                      onclick={killLoginPortOccupant}
                      disabled={killingLoginPortOccupant}
                    >
                      {copyForLanguage().killPortOccupant}
                    </AppButton>
                  </div>
                {/if}
              </div>
              <button
                type="button"
                class="flex-none rounded-full p-1 opacity-60 transition-opacity hover:opacity-100"
                aria-label="Close"
                onclick={() => { setPageError('') }}
              >
                <span class="i-lucide-x h-4 w-4"></span>
              </button>
            </div>
          </section>
        {/if}
      </div>
    {/if}
  </div>
</div>

{#if renderExportFormatDialog}
  <AppDialog
    ariaLabelledby="export-format-dialog-title"
    maxWidthClass="max-w-xl"
    panelClass="rounded-[1.25rem]"
    zIndexClass="z-[60]"
    closeDisabled={exportDialogBusy}
    closeOnBackdrop={!exportDialogBusy}
    motionSelector="[data-motion-item]"
    onclose={closeExportFormatDialog}
  >
    <div class="grid gap-1" data-motion-item>
      <p class="text-xs font-medium uppercase tracking-[0.22em] text-faint">
        {exportDialogScopeLabel()}
      </p>
      <h2 id="export-format-dialog-title" class="text-[1.15rem] font-semibold text-carbon">
        {copyForLanguage().exportFormatDialogTitle}
      </h2>
      <p class="text-sm leading-6 text-muted-strong">
        {copyForLanguage().exportFormatDialogDescription}
      </p>
    </div>

    <div class="mt-5 grid gap-3">
      {#each exportFormatOptionOrder as format (format)}
        <label
          data-motion-item
          class={`theme-export-format-option grid cursor-pointer gap-1 rounded-2xl border px-4 py-3 transition-colors duration-140 ${exportDialogFormat === format ? 'border-black/14 bg-black/[0.045]' : 'border-black/8 bg-transparent'}`}
        >
          <div class="flex items-start gap-3">
            <input
              class="mt-1 h-4 w-4 accent-black"
              type="radio"
              name="account-export-format"
              value={format}
              checked={exportDialogFormat === format}
              on:change={() => {
                exportDialogFormat = format
              }}
            />
            <div class="grid gap-1">
              <span class="text-sm font-medium text-carbon">{exportFormatLabel(format)}</span>
              <span class="text-xs leading-5 text-muted-strong">
                {exportFormatDescription(format)}
              </span>
            </div>
          </div>
        </label>
      {/each}
    </div>

    {#if exportDialogError}
      <p class="mt-4 text-sm text-danger" data-motion-item>{exportDialogError}</p>
    {/if}

    <svelte:fragment slot="footer">
      <AppButton
        variant="secondary"
        size="sm"
        onclick={closeExportFormatDialog}
        disabled={exportDialogBusy}
      >
        {copyForLanguage().exportFormatCancel}
      </AppButton>
      <AppButton
        variant="primary"
        size="sm"
        onclick={submitExportFormatDialog}
        disabled={exportDialogBusy}
      >
        {copyForLanguage().exportFormatConfirm}
      </AppButton>
    </svelte:fragment>
  </AppDialog>
{/if}

{#if wakeDialogAccount}
  <WakeDialog
    copy={copyForLanguage()}
    language={snapshot.settings.language}
    accountLabelText={accountLabel(wakeDialogAccount, copyForLanguage())}
    bind:activeTab={wakeDialogTab}
    bind:sessionPrompt={wakePromptDraft}
    bind:sessionModel={wakeModelDraft}
    sessionStatus={wakeDialogStatus}
    sessionLogs={wakeDialogLogs}
    requestResult={wakeRequestResult}
    requestError={wakeRequestError}
    rawResponseBody={wakeRawResponseBody}
    sessionBusy={Boolean(wakingAccountId)}
    schedule={currentWakeScheduleDialog()}
    bind:scheduleEnabled={wakeScheduleEnabledDraft}
    bind:scheduleTimes={wakeScheduleTimesDraft}
    bind:schedulePrompt={wakeSchedulePromptDraft}
    bind:scheduleModel={wakeScheduleModelDraft}
    scheduleError={wakeScheduleError}
    scheduleSaving={wakeScheduleSaving}
    onClose={closeWakeDialog}
    onSubmitSession={submitWakeDialog}
    onSaveSchedule={saveWakeSchedule}
    onDeleteSchedule={deleteWakeSchedule}
  />
{/if}

{#if editTokensDialogAccount}
  <EditAccountTokensDialog
    copy={copyForLanguage()}
    accountLabelText={accountLabel(editTokensDialogAccount, copyForLanguage())}
    bind:accessToken={editTokensAccessTokenDraft}
    bind:refreshToken={editTokensRefreshTokenDraft}
    bind:idToken={editTokensIdTokenDraft}
    bind:accountIdHint={editTokensAccountIdHintDraft}
    errorMessage={editTokensError}
    loading={editTokensLoading}
    saving={editTokensSaving}
    onClose={closeEditTokensDialog}
    onSave={saveAccountTokens}
  />
{/if}

<div use:reveal={{ delay: 0.02 }}>
  <HeroPanel
    copy={copyForLanguage()}
    {loginEvent}
    onClose={() => closeExpandablePanels()}
    {showCallbackLoginDetails}
    {showDeviceLoginDetails}
    {copyAuthUrl}
    {copyDeviceCode}
    {openExternalLink}
  />
</div>

<style>
  :global(::view-transition-old(root)),
  :global(::view-transition-new(root)) {
    animation: none;
    mix-blend-mode: normal;
  }

  :global(::view-transition-old(root)) {
    z-index: 0;
  }

  :global(::view-transition-new(root)) {
    z-index: 1;
  }

  .app-shell {
    position: relative;
    isolation: isolate;
    background: var(--color-snow);
  }

  .mac-inactive-traffic-lights {
    position: fixed;
    top: 18px;
    left: 16px;
    z-index: 100;
    display: flex;
    gap: 8px;
    align-items: center;
    pointer-events: none;
  }

  .mac-inactive-traffic-lights span {
    width: 12px;
    height: 12px;
    flex: 0 0 12px;
    border-radius: 999px;
    background: #6d716c;
    box-shadow: none;
    filter: none;
    opacity: 1;
  }

  :global(html[data-theme='dark']) .mac-inactive-traffic-lights span {
    background: #3c4848;
  }

  :global(.theme-workspace) {
    background: var(--color-snow) !important;
    box-shadow: none;
  }

  :global(html[data-theme='dark']) .app-shell {
    background: var(--color-snow);
  }

  :global(.theme-surface) {
    border-color: color-mix(in srgb, var(--line-strong) 72%, transparent) !important;
    background: var(--panel-strong) !important;
    box-shadow: var(--elevation-2) !important;
  }

  :global(.theme-surface[role='dialog']),
  :global(.wake-dialog-panel) {
    border-radius: 0.75rem !important;
    border-color: color-mix(in srgb, var(--line-strong) 58%, transparent) !important;
    background: color-mix(in srgb, var(--panel-strong) 92%, var(--surface-soft)) !important;
    box-shadow:
      0 28px 84px -40px rgba(0, 0, 0, 0.48),
      0 12px 32px -24px rgba(0, 0, 0, 0.36) !important;
  }

  :global(.wake-dialog-backdrop) {
    background: color-mix(in srgb, black 34%, transparent) !important;
  }

  :global(.theme-toolbar),
  :global(.theme-soft-panel) {
    border-color: color-mix(in srgb, var(--color-arctic-mist) 82%, transparent) !important;
    background: color-mix(in srgb, var(--panel-strong) 78%, var(--surface-soft)) !important;
    box-shadow: none;
  }

  :global(.workspace-topbar) {
    position: relative;
    z-index: 1;
    border-bottom: 1px solid color-mix(in srgb, var(--line-strong) 74%, transparent);
    background: color-mix(in srgb, var(--color-fog) 78%, var(--color-snow));
    box-shadow:
      0 1px 0 var(--edge-light) inset,
      0 1px 0 color-mix(in srgb, var(--edge-dark) 22%, transparent);
  }

  :global(.theme-view-toggle-active) {
    box-shadow: none;
  }

  :global(.theme-view-toggle-active) {
    border-color: color-mix(in srgb, var(--line-strong) 68%, transparent) !important;
    background: var(--panel-strong) !important;
  }

  :global(.theme-account-row) {
    border: 0 !important;
    outline: 0 !important;
    border-radius: 0;
    background: transparent !important;
    box-shadow: none;
    position: relative;
  }

  :global(.theme-account-row::before),
  :global(.theme-account-row::after) {
    content: none !important;
  }

  :global(.theme-account-row + .theme-account-row::before) {
    content: '';
    position: absolute;
    top: 0;
    right: 0.75rem;
    left: 3.25rem;
    height: 1px;
    background: color-mix(in srgb, var(--color-arctic-mist) 62%, transparent);
    pointer-events: none;
  }

  :global(.theme-account-row:has(.theme-checkbox-input:checked)) {
    background: var(--surface-selected) !important;
  }

  :global(.theme-account-selector),
  :global(.theme-workbench-chevron),
  :global(.theme-workbench-summary-pill),
  :global(.theme-selection-group-button),
  :global(.theme-selection-export) {
    box-shadow: none;
  }

  :global(.theme-workbench-toolbar) {
    border-color: color-mix(in srgb, var(--line-strong) 64%, transparent) !important;
    background: transparent !important;
    box-shadow: none;
  }

  :global(.theme-filter-chip-idle) {
    box-shadow: none;
  }

  :global(.theme-filter-chip-active) {
    background: var(--color-carbon) !important;
    color: var(--color-snow) !important;
    box-shadow: none;
  }

  :global(.scroll-row .theme-soft-panel) {
    border-radius: 0.34rem !important;
    background: color-mix(in srgb, var(--panel-strong) 58%, var(--surface-soft)) !important;
  }

  :global(.theme-version-pill),
  :global(.theme-plan-neutral),
  :global(.theme-plan-plus),
  :global(.theme-plan-pro),
  :global(.theme-plan-team),
  :global(.theme-plan-enterprise),
  :global(.theme-wake-schedule-pill),
  :global(.theme-tag-assigned) {
    border-radius: 0.28rem !important;
    box-shadow: 0 1px 0 color-mix(in srgb, var(--edge-light) 62%, transparent) inset;
  }

  :global(.theme-provider-card),
  :global(.theme-tag-manager-card) {
    border: 0 !important;
    outline: 0 !important;
    border-radius: 0 !important;
    background: transparent !important;
    box-shadow: none;
    position: relative;
  }

  :global(.theme-provider-card::before),
  :global(.theme-provider-card::after) {
    content: none !important;
  }

  :global(.theme-tag-empty),
  :global(.theme-tag-picker-surface) {
    border-color: color-mix(in srgb, var(--line-strong) 72%, transparent) !important;
    background: color-mix(in srgb, var(--panel-strong) 92%, var(--color-snow)) !important;
    box-shadow: none;
  }

  :global(.theme-provider-card:hover),
  :global(.theme-tag-manager-card:hover) {
    background: var(--surface-hover) !important;
  }

  :global(.theme-select),
  :global(.theme-provider-input),
  :global(.theme-tag-input),
  :global(.wake-dialog-field) {
    border-color: color-mix(in srgb, var(--line-strong) 70%, transparent) !important;
    background: var(--panel-strong) !important;
    box-shadow: var(--input-shadow);
  }

  :global(.theme-primary-button) {
    box-shadow: var(--control-shadow) !important;
  }

  :global(.theme-ghost-button),
  :global(.theme-menu-choice-active) {
    box-shadow: var(--control-shadow);
  }

  :global(.text-muted) {
    color: var(--ink-soft);
  }

  :global(.text-muted-strong) {
    color: var(--ink-soft-strong);
  }

  :global(.text-faint) {
    color: var(--ink-faint);
  }

  :global(.border-soft) {
    border-color: var(--color-arctic-mist);
  }

  :global(html[data-theme='dark'] .theme-surface) {
    border-color: var(--line-strong) !important;
    background: var(--panel-strong) !important;
    box-shadow: var(--elevation-2) !important;
  }

  :global(html[data-theme='dark'] .theme-tray-panel) {
    border-color: var(--line-strong) !important;
    background: var(--color-fog) !important;
    box-shadow: var(--elevation-2) !important;
  }

  :global(html[data-theme='dark'] .theme-soft-panel),
  :global(html[data-theme='dark'] .theme-toolbar),
  :global(html[data-theme='dark'] .theme-version-pill),
  :global(html[data-theme='dark'] .theme-plan-neutral),
  :global(html[data-theme='dark'] .theme-menu-choice-active),
  :global(html[data-theme='dark'] .theme-provider-toggle) {
    background: var(--surface-soft) !important;
  }

  :global(html[data-theme='dark'] .theme-soft-panel) {
    border-color: color-mix(in srgb, var(--color-arctic-mist) 72%, transparent) !important;
  }

  :global(html[data-theme='dark'] [class*='bg-white']) {
    background-color: var(--panel-strong) !important;
  }

  :global(html[data-theme='dark'] [class*='text-black']) {
    color: var(--ink-soft) !important;
  }

  :global(html[data-theme='dark'] .theme-primary-button) {
    background: var(--color-carbon) !important;
    color: var(--color-snow) !important;
  }

  :global(html[data-theme='dark'] .theme-ghost-button) {
    border-color: var(--color-arctic-mist) !important;
    background: var(--color-fog) !important;
    color: var(--color-carbon) !important;
  }

  :global(html[data-theme='dark'] .theme-ghost-button:disabled) {
    color: var(--ink-soft) !important;
  }

  :global(html[data-theme='dark'] .theme-version-pill) {
    color: var(--ink-soft-strong) !important;
  }

  :global(html[data-theme='dark'] .theme-plan-neutral) {
    color: var(--ink-soft) !important;
  }

  :global(html[data-theme='dark'] .theme-plan-plus) {
    background: rgb(16 185 129 / 0.18) !important;
    color: rgb(110 231 183) !important;
  }

  :global(html[data-theme='dark'] .theme-plan-pro) {
    background: rgb(14 165 233 / 0.18) !important;
    color: rgb(125 211 252) !important;
  }

  :global(html[data-theme='dark'] .theme-plan-team) {
    background: rgb(245 158 11 / 0.18) !important;
    color: rgb(253 224 71) !important;
  }

  :global(html[data-theme='dark'] .theme-plan-enterprise) {
    background: rgb(244 63 94 / 0.18) !important;
    color: rgb(253 164 175) !important;
  }

  :global(html[data-theme='dark'] .theme-ghost-button),
  :global(html[data-theme='dark'] .theme-icon-button),
  :global(html[data-theme='dark'] .theme-row-button),
  :global(html[data-theme='dark'] .theme-menu-choice),
  :global(html[data-theme='dark'] .theme-select) {
    color: var(--color-carbon) !important;
  }

  :global(html[data-theme='dark'] .theme-ghost-button:hover),
  :global(html[data-theme='dark'] .theme-icon-button:hover),
  :global(html[data-theme='dark'] .theme-row-button:hover),
  :global(html[data-theme='dark'] .theme-menu-choice:hover),
  :global(html[data-theme='dark'] .theme-select:hover) {
    background: var(--surface-hover) !important;
  }

  :global(html[data-theme='dark'] .theme-ghost-button:focus-visible),
  :global(html[data-theme='dark'] .theme-icon-button:focus-visible),
  :global(html[data-theme='dark'] .theme-row-button:focus-visible),
  :global(html[data-theme='dark'] .theme-menu-choice:focus-visible),
  :global(html[data-theme='dark'] .theme-select:focus-visible) {
    box-shadow: 0 0 0 2px var(--ring) !important;
  }

  :global(html[data-theme='dark'] .theme-select) {
    border-color: var(--color-arctic-mist) !important;
    background: var(--panel-strong) !important;
  }

  :global(html[data-theme='dark'] .theme-provider-card) {
    background: transparent !important;
    box-shadow: none !important;
  }

  :global(html[data-theme='dark'] .theme-provider-input),
  :global(html[data-theme='dark'] .theme-provider-toggle) {
    border-color: var(--color-arctic-mist) !important;
    color: var(--color-carbon) !important;
  }

  :global(html[data-theme='dark'] .theme-provider-input) {
    background: color-mix(in srgb, var(--panel-strong) 86%, var(--surface-soft) 14%) !important;
  }

  :global(html[data-theme='dark'] .theme-provider-input::placeholder) {
    color: var(--ink-faint) !important;
  }

  :global(html[data-theme='dark'] .theme-provider-toggle) {
    background: color-mix(in srgb, var(--surface-soft) 88%, var(--color-fog) 12%) !important;
  }

  :global(html[data-theme='dark'] .theme-provider-status) {
    background: rgb(96 165 250 / 0.7) !important;
    box-shadow: 0 0 0 4px rgb(96 165 250 / 0.08) !important;
  }

  :global(html[data-theme='dark'] .theme-provider-badge) {
    border-color: rgb(56 189 248 / 0.16) !important;
    background: rgb(14 165 233 / 0.1) !important;
    color: rgb(186 230 253 / 0.88) !important;
  }

  :global(html[data-theme='dark'] .theme-provider-fast-badge) {
    border-color: rgb(16 185 129 / 0.16) !important;
    background: rgb(16 185 129 / 0.1) !important;
    color: rgb(167 243 208 / 0.88) !important;
  }

  :global(html[data-theme='dark'] .theme-provider-meta) {
    border-color: color-mix(in srgb, var(--color-arctic-mist) 72%, transparent) !important;
    background: color-mix(in srgb, var(--surface-soft) 82%, var(--color-fog) 18%) !important;
    color: var(--ink-soft) !important;
  }

  :global(html[data-theme='dark'] .theme-select option) {
    color: var(--color-carbon);
    background: var(--panel-strong);
  }

  :global(html[data-theme='dark'] .theme-inline-code) {
    background: var(--panel-strong) !important;
    color: var(--color-carbon) !important;
  }

  :global(html[data-theme='dark'] .theme-code-surface) {
    border-color: var(--color-arctic-mist) !important;
    background: var(--code-bg) !important;
    color: var(--code-ink) !important;
  }

  :global(html[data-theme='dark'] .theme-error-panel) {
    border-color: color-mix(in srgb, var(--danger) 22%, transparent) !important;
    background: color-mix(in srgb, var(--danger) 6%, var(--panel-strong)) !important;
  }

  :global(html[data-theme='dark'] .theme-account-card) {
    border-color: var(--color-arctic-mist) !important;
    background: var(--panel-strong) !important;
  }

  :global(html[data-theme='dark'] .theme-account-card-active) {
    border-color: var(--line-strong) !important;
    background: color-mix(in srgb, var(--surface-soft) 66%, var(--panel-strong)) !important;
  }

  :global(html[data-theme='dark'] .theme-export-format-option) {
    border-color: color-mix(in srgb, var(--line-strong) 78%, transparent) !important;
    background: color-mix(in srgb, var(--panel-strong) 92%, var(--color-fog) 8%) !important;
  }

  :global(html[data-theme='dark'] .theme-progress-track) {
    background: var(--progress-track) !important;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-arctic-mist) 70%, transparent) !important;
  }

  :global(html[data-theme='dark'] .theme-progress-fill) {
    background: var(--progress-fill) !important;
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--progress-fill) 45%, transparent) !important;
  }

  :global(html[data-theme='dark'] .theme-active-pill) {
    background: var(--color-carbon) !important;
    color: var(--color-snow) !important;
  }

  :global(html[data-theme='dark'] .theme-status-active) {
    background: var(--success) !important;
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--success) 14%, transparent) !important;
  }

  :global(html[data-theme='dark'] .theme-status-idle) {
    background: var(--dot-idle) !important;
  }
</style>
