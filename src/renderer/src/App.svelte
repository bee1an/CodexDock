<script lang="ts">
  import { onMount } from 'svelte'
  import brandMark from './assets/brand-mark.png'
  import { reveal } from '$lib/motion/gsap-motion'
  import HeroPanel from './shell/HeroPanel.svelte'
  import TrayPanel from './shell/TrayPanel.svelte'
  import AccountTransferDialogsHost from './app/AccountTransferDialogsHost.svelte'
  import AccountTokensDialogsHost from './app/AccountTokensDialogsHost.svelte'
  import WakeDialogsHost from './app/WakeDialogsHost.svelte'
  import LocalGatewayActionsHost from './app/LocalGatewayActionsHost.svelte'
  import AccountActionsHost from './app/AccountActionsHost.svelte'
  import WorkspaceShellHost from './app/WorkspaceShellHost.svelte'
  import PageErrorToast from './app/PageErrorToast.svelte'
  import {
    accountScopedRecord,
    messages,
    pollingOptions,
    preserveAccountScopedRecord,
    statusBarAccounts,
    usageErrorKind
  } from '$lib/view/app-view'
  import { createDefaultSnapshot } from './app/default-snapshot'
  import { applyTheme, applyThemeWithRipple, type ThemeTransitionOrigin } from './app/theme'

  import type {
    AppLanguage,
    AppMeta,
    AppTheme,
    AppUpdateState,
    AccountGroup,
    AccountRateLimits,
    AccountSummary,
    AppSettings,
    AppSnapshot,
    CustomProviderDetail,
    CreateCustomProviderInput,
    LoginEvent,
    LocalGatewayModelMapping,
    LoginMethod,
    PortOccupant,
    ProbeProviderModelsInput,
    ProviderModelsProbeResult,
    StatsDisplaySettings,
    TagVisibilitySettings,
    UpdateAccountHealthInput,
    UpdateCustomProviderInput
  } from '../../shared/codex'
  import {
    normalizeStatsDisplaySettings,
    resolveBestAccount,
    shouldAutoPollUsage
  } from '../../shared/codex'

  type ApplySnapshotOptions = {
    preserveUsageState?: boolean
  }

  type AccountActionsHostApi = {
    removeAccount(account: AccountSummary): Promise<void>
    updateAccountHealth(account: AccountSummary, input: UpdateAccountHealthInput): Promise<void>
    removeAccounts(accountIds: string[]): Promise<void>
    reorderAccounts(accountIds: string[]): Promise<void>
    reorderAccountsInGroup(groupId: string, accountIds: string[]): Promise<void>
    createGroup(name: string): Promise<void>
    updateGroup(group: AccountGroup, name: string): Promise<void>
    deleteGroup(group: AccountGroup): Promise<void>
    updateAccountGroups(account: AccountSummary, groupIds: string[]): Promise<void>
  }

  type LocalGatewayActionsHostApi = {
    startLocalGateway(): Promise<void>
    stopLocalGateway(): Promise<void>
    rotateLocalGatewayKey(): Promise<void>
    openLocalGatewayInCodex(): Promise<void>
    openLocalGatewayIsolatedInCodex(): Promise<void>
    updateLocalGatewayModelMappings(mappings: LocalGatewayModelMapping[]): Promise<void>
    updateLocalGatewayAllowedGroups(groupIds: string[]): Promise<void>
    updateLocalGatewayAllowedAccounts(accountIds: string[]): Promise<void>
    updateLocalGatewayDisabledAccounts(accountIds: string[]): Promise<void>
    updateLocalGatewayAllowedProviders(providerIds: string[]): Promise<void>
    updateLocalGatewayPort(port: number): Promise<void>
    updateLocalGatewayAutoStart(autoStart: boolean): Promise<void>
    updateLocalGatewayVisibleColumns(columns: string[]): Promise<void>
    killLocalGatewayPortOccupant(): Promise<void>
  }

  type WakeDialogsHostApi = {
    openWakeDialog(account: AccountSummary, initialTab?: 'session' | 'schedule'): void
    openWakeAllDialog(): void
    handleEscape(): boolean
  }

  type AccountTokensDialogsHostApi = {
    openRefreshTokensBatchDialog(): void
    openEditTokensDialog(account: AccountSummary): void
    openRefreshTokensDialog(account: AccountSummary): void
  }

  type AccountTransferDialogsHostApi = {
    openImportMethodDialog(): void
    openExportFormatDialog(accountIds?: string[]): void
    exportSelectedAccounts(accountIds: string[]): Promise<void>
    handleEscape(): boolean
  }

  let snapshot: AppSnapshot = createDefaultSnapshot()
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
  let appReady = false
  let pageError = ''
  let pageErrorTimer: ReturnType<typeof setTimeout> | null = null

  const setPageError = (message: string): void => {
    pageError = message
    if (pageErrorTimer) clearTimeout(pageErrorTimer)
    if (message) {
      pageErrorTimer = setTimeout(() => {
        pageError = ''
      }, 8000)
    }
  }
  let loginPortOccupant: PortOccupant | null = null
  let localGatewayPortOccupant: PortOccupant | null = null
  let windowFocused = true
  let killingLoginPortOccupant = false
  let killingLocalGatewayPortOccupant = false
  let accountActionKey = ''
  let providerOpeningId = ''
  let updateState: AppUpdateState = {
    status: 'idle',
    delivery: 'auto',
    currentVersion: '--',
    supported: false
  }
  let usageByAccountId: Record<string, AccountRateLimits> = {}
  let usageLoadingByAccountId: Record<string, boolean> = {}
  let usageErrorByAccountId: Record<string, string> = {}
  let wakingAccountId = ''
  let wakeAllRunning = false
  let refreshTokensBatchPhase: 'idle' | 'confirming' | 'running' | 'done' = 'idle'
  let localGatewayBusy = false
  let localGatewayApiKey = ''
  let transferDialogs: AccountTransferDialogsHostApi | null = null
  let accountTokensDialogs: AccountTokensDialogsHostApi | null = null
  let wakeDialogs: WakeDialogsHostApi | null = null
  let localGatewayActions: LocalGatewayActionsHostApi | null = null
  let accountActions: AccountActionsHostApi | null = null
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
  const refreshSnapshot = async (): Promise<void> => {
    applySnapshot(await window.codexApp.getSnapshot())
  }

  const closeExpandablePanels = (except?: 'browser-login' | 'device-login'): void => {
    if (except !== 'browser-login') {
      showCallbackLoginDetails = false
    }
    if (except !== 'device-login') {
      showDeviceLoginDetails = false
    }
  }

  const toolbarDialogOpen = (): boolean =>
    (showCallbackLoginDetails &&
      loginEvent?.method === 'browser' &&
      Boolean(loginEvent?.authUrl || loginEvent?.localCallbackUrl || loginEvent?.rawOutput)) ||
    (showDeviceLoginDetails &&
      loginEvent?.method === 'device' &&
      Boolean(loginEvent?.verificationUrl || loginEvent?.userCode || loginEvent?.rawOutput))

  const hasLoginPortConflict = (): boolean => {
    const message = `${pageError}\n${loginEvent?.message ?? ''}`.toLowerCase()
    return message.includes('1455') && (message.includes('占用') || message.includes('in use'))
  }

  const refreshLoginPortOccupant = async (): Promise<void> => {
    loginPortOccupant = await window.codexApp.getLoginPortOccupant()
  }

  const loginActionBusy = (): boolean => loginStarting || killingLoginPortOccupant

  const refreshAppMeta = async (): Promise<void> => {
    appMeta = await window.codexApp.getAppMeta()
    applySnapshot(rawSnapshot)
  }

  const refreshUpdateState = async (): Promise<void> => {
    updateState = await window.codexApp.getUpdateState()
  }

  const shouldShowCodexDesktopExecutablePath = (): boolean =>
    appMeta.isPackaged === false || appMeta.platform === 'win32'

  const bestAccount = (): AccountSummary | null =>
    resolveBestAccount(
      snapshot.accounts,
      usageByAccountId,
      snapshot.activeAccountId,
      snapshot.accountHealthByAccountId
    )

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
      usageErrorByAccountId: nextUsageErrorByAccountId,
      accountHealthByAccountId: accountScopedRecord(
        visibleSnapshot.accounts,
        visibleSnapshot.accountHealthByAccountId ?? {}
      )
    }
    applyTheme(visibleSnapshot.settings.theme, prefersDark)
    usageByAccountId = nextUsageByAccountId
    usageErrorByAccountId = nextUsageErrorByAccountId
    syncUsageState(visibleSnapshot.accounts)
  }

  const clearUsageError = (accountId: string): void => {
    const nextState = { ...usageErrorByAccountId }
    delete nextState[accountId]
    usageErrorByAccountId = nextState
  }

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

  const setSnapshotRateLimits = (accountId: string, rateLimits: AccountRateLimits): void => {
    snapshot = {
      ...snapshot,
      usageByAccountId: {
        ...snapshot.usageByAccountId,
        [accountId]: rateLimits
      }
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

  const openProviderIsolatedInCodex = async (providerId: string): Promise<void> => {
    if (providerOpeningId) {
      return
    }

    providerOpeningId = providerId
    try {
      await runAction(`provider:open-isolated:${providerId}`, () =>
        window.codexApp.openProviderIsolatedInCodex(providerId)
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

  const handleGlobalKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') {
      return
    }

    if (transferDialogs?.handleEscape()) {
      return
    }

    if (toolbarDialogOpen()) {
      closeExpandablePanels()
      return
    }

    if (wakeDialogs?.handleEscape()) {
      return
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

    applyThemeWithRipple(theme, prefersDark, origin)
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

  const updateAutoWakeSettings = async (settings: Partial<AppSettings>): Promise<void> => {
    await runAction('settings:auto-wake', () => window.codexApp.updateSettings(settings))
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

  const updatePreserveChatGptAuthOnDirectProviderOpen = async (enabled: boolean): Promise<void> => {
    if (Boolean(snapshot.settings.preserveChatGptAuthOnDirectProviderOpen) === enabled) {
      return
    }

    await runAction('settings:preserve-chatgpt-auth-provider-open', () =>
      window.codexApp.updateSettings({ preserveChatGptAuthOnDirectProviderOpen: enabled })
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

  const updateTagVisibility = async (tagVisibility: TagVisibilitySettings): Promise<void> => {
    await runAction('settings:tag-visibility', () =>
      window.codexApp.updateSettings({ tagVisibility })
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

  const refreshAllRateLimits = async (accounts?: AccountSummary[]): Promise<void> => {
    const targets = accounts ?? snapshot.accounts
    if (!targets.length || refreshingAllUsage) {
      return
    }

    closeExpandablePanels()
    refreshingAllUsage = true

    try {
      const concurrency = 6
      const queue = [...targets]
      const runWorker = async (): Promise<void> => {
        while (queue.length) {
          const account = queue.shift()
          if (!account) return
          await readRateLimits(account, { force: true })
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(concurrency, targets.length) }, () => runWorker())
      )
    } finally {
      refreshingAllUsage = false
    }
  }

  onMount(() => {
    const darkMedia = window.matchMedia('(prefers-color-scheme: dark)')
    prefersDark = darkMedia.matches
    document.body.classList.add(...bodyClasses)
    applyTheme(snapshot.settings.theme, prefersDark)
    void refreshSnapshot().then(() => {
      appReady = true
      document.getElementById('splash')?.remove()
    })
    void refreshAppMeta()
    void refreshUpdateState()

    const handleThemeChange = (event: MediaQueryListEvent): void => {
      prefersDark = event.matches
      applyTheme(snapshot.settings.theme, prefersDark)
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
            <WorkspaceShellHost
              {panelClass}
              copy={copyForLanguage()}
              {appMeta}
              {loginEvent}
              {snapshot}
              {usageByAccountId}
              {usageLoadingByAccountId}
              {usageErrorByAccountId}
              {loginStarting}
              {accountActionKey}
              {providerOpeningId}
              {localGatewayBusy}
              {localGatewayApiKey}
              {localGatewayPortOccupant}
              {killingLocalGatewayPortOccupant}
              {wakingAccountId}
              {wakeAllRunning}
              {refreshTokensBatchPhase}
              {refreshingAllUsage}
              {updateState}
              {accountActions}
              {localGatewayActions}
              {wakeDialogs}
              {accountTokensDialogs}
              {transferDialogs}
              {inlineUpdateSummary}
              {inlineUpdateActionLabel}
              {runInlineUpdateAction}
              {loginActionBusy}
              {runAccountAction}
              {createProvider}
              {probeProviderModels}
              {getProvider}
              {reorderProviders}
              {updateProvider}
              {removeProvider}
              {openProviderInCodex}
              {openProviderIsolatedInCodex}
              {readRateLimits}
              {updateShowLocalMockData}
              {updateStatsDisplay}
              {updateTagVisibility}
              {startLogin}
              {runAction}
              {refreshAllRateLimits}
              {bestAccount}
              {updateLanguage}
              {updateTheme}
              {updatePollingInterval}
              {updateCheckForUpdatesOnStartup}
              {updateAutoWakeSettings}
              {checkForUpdates}
              {downloadUpdate}
              {installUpdate}
              {openExternalLink}
              {updateCodexDesktopExecutablePath}
              {updatePreserveChatGptAuthOnDirectProviderOpen}
              {shouldShowCodexDesktopExecutablePath}
            />
          </div>
        </div>

        <PageErrorToast
          {pageError}
          copy={copyForLanguage()}
          {loginPortOccupant}
          loginPortConflict={hasLoginPortConflict()}
          {killingLoginPortOccupant}
          {killLoginPortOccupant}
          {setPageError}
        />
      </div>
    {/if}
  </div>
</div>

<AccountActionsHost bind:this={accountActions} copy={copyForLanguage()} {snapshot} {runAction} />

<LocalGatewayActionsHost
  bind:this={localGatewayActions}
  bind:localGatewayBusy
  bind:localGatewayApiKey
  bind:localGatewayPortOccupant
  bind:killingLocalGatewayPortOccupant
  copy={copyForLanguage()}
  {snapshot}
  {runAction}
  {applySnapshot}
  {setPageError}
  {localizeKnownError}
/>

<AccountTransferDialogsHost
  bind:this={transferDialogs}
  copy={copyForLanguage()}
  {runAction}
  {applySnapshot}
  {localizeKnownError}
/>

<WakeDialogsHost
  bind:this={wakeDialogs}
  bind:usageByAccountId
  bind:usageLoadingByAccountId
  bind:usageErrorByAccountId
  bind:wakingAccountId
  bind:wakeAllRunning
  copy={copyForLanguage()}
  {snapshot}
  {clearUsageData}
  {clearUsageError}
  {clearUsageLoading}
  {setSnapshotRateLimits}
  {applySnapshot}
  {localizeKnownError}
/>

<AccountTokensDialogsHost
  bind:this={accountTokensDialogs}
  bind:refreshTokensBatchPhase
  copy={copyForLanguage()}
  language={snapshot.settings.language}
  accounts={snapshot.accounts}
  groups={snapshot.groups}
  {applySnapshot}
/>

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
