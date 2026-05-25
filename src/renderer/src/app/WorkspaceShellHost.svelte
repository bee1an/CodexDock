<script lang="ts">
  import WorkspaceShell from '../shell/WorkspaceShell.svelte'
  import { loginTone, type LocalizedCopy } from '$lib/view/app-view'
  import {
    normalizeStatsDisplaySettings,
    type AccountGroup,
    type AccountRateLimits,
    type AccountSummary,
    type AppMeta,
    type AppSnapshot,
    type AppTheme,
    type AppUpdateState,
    type CreateCustomProviderInput,
    type CustomProviderDetail,
    type LocalGatewayModelMapping,
    type LoginEvent,
    type LoginMethod,
    type ProbeProviderModelsInput,
    type ProviderModelsProbeResult,
    type StatsDisplaySettings,
    type TagVisibilitySettings,
    type UpdateAccountHealthInput,
    type UpdateCustomProviderInput
  } from '../../../shared/codex'
  import type { ThemeTransitionOrigin } from './theme'

  type AccountActionsHostApi = {
    reorderAccounts(accountIds: string[]): Promise<void>
    reorderAccountsInGroup(groupId: string, accountIds: string[]): Promise<void>
    createGroup(name: string): Promise<void>
    updateGroup(group: AccountGroup, name: string): Promise<void>
    deleteGroup(group: AccountGroup): Promise<void>
    updateAccountGroups(account: AccountSummary, groupIds: string[]): Promise<void>
    updateAccountHealth(account: AccountSummary, input: UpdateAccountHealthInput): Promise<void>
    removeAccount(account: AccountSummary): Promise<void>
    removeAccounts(accountIds: string[]): Promise<void>
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
    updateLocalGatewayAllowedProviders(providerIds: string[]): Promise<void>
    updateLocalGatewayPort(port: number): Promise<void>
    updateLocalGatewayAutoStart(autoStart: boolean): Promise<void>
    updateLocalGatewayVisibleColumns(columns: string[]): Promise<void>
    killLocalGatewayPortOccupant(): Promise<void>
  }

  type WakeDialogsHostApi = {
    openWakeDialog(account: AccountSummary, initialTab?: 'session' | 'schedule'): void
    openWakeAllDialog(): void
  }

  type AccountTokensDialogsHostApi = {
    openRefreshTokensBatchDialog(): void
    openEditTokensDialog(account: AccountSummary): void
    openRefreshTokensDialog(account: AccountSummary): void
  }

  type AccountTransferDialogsHostApi = {
    openImportMethodDialog(): void
    openExportFormatDialog(): void
    exportSelectedAccounts(accountIds: string[]): Promise<void>
  }

  export let panelClass: string
  export let copy: LocalizedCopy
  export let appMeta: AppMeta
  export let loginEvent: LoginEvent | null
  export let snapshot: AppSnapshot
  export let usageByAccountId: Record<string, AccountRateLimits>
  export let usageLoadingByAccountId: Record<string, boolean>
  export let usageErrorByAccountId: Record<string, string>
  export let loginStarting = false
  export let accountActionKey = ''
  export let providerOpeningId = ''
  export let localGatewayBusy = false
  export let localGatewayApiKey = ''
  export let localGatewayPortOccupant = null
  export let killingLocalGatewayPortOccupant = false
  export let wakingAccountId = ''
  export let wakeAllRunning = false
  export let refreshTokensBatchPhase: 'idle' | 'confirming' | 'running' | 'done' = 'idle'
  export let refreshingAllUsage = false
  export let updateState: AppUpdateState
  export let accountActions: AccountActionsHostApi | null
  export let localGatewayActions: LocalGatewayActionsHostApi | null
  export let wakeDialogs: WakeDialogsHostApi | null
  export let accountTokensDialogs: AccountTokensDialogsHostApi | null
  export let transferDialogs: AccountTransferDialogsHostApi | null
  export let inlineUpdateSummary: () => string
  export let inlineUpdateActionLabel: () => string | null
  export let runInlineUpdateAction: () => void
  export let loginActionBusy: () => boolean
  export let runAccountAction: (key: string, task: () => Promise<AppSnapshot>) => Promise<void>
  export let createProvider: (input: CreateCustomProviderInput) => Promise<void>
  export let probeProviderModels: (
    input: ProbeProviderModelsInput
  ) => Promise<ProviderModelsProbeResult>
  export let getProvider: (providerId: string) => Promise<CustomProviderDetail>
  export let reorderProviders: (providerIds: string[]) => Promise<void>
  export let updateProvider: (providerId: string, input: UpdateCustomProviderInput) => Promise<void>
  export let removeProvider: (providerId: string) => Promise<void>
  export let openProviderInCodex: (providerId: string) => Promise<void>
  export let openProviderIsolatedInCodex: (providerId: string) => Promise<void>
  export let readRateLimits: (
    account: AccountSummary,
    options?: { force?: boolean }
  ) => Promise<void>
  export let updateShowLocalMockData: (enabled: boolean) => Promise<void>
  export let updateStatsDisplay: (statsDisplay: StatsDisplaySettings) => Promise<void>
  export let updateTagVisibility: (tagVisibility: TagVisibilitySettings) => Promise<void>
  export let startLogin: (method: LoginMethod) => Promise<void>
  export let runAction: (key: string, task: () => Promise<AppSnapshot>) => Promise<void>
  export let refreshAllRateLimits: () => Promise<void>
  export let bestAccount: () => AccountSummary | null
  export let updateLanguage: (language: 'zh-CN' | 'en') => Promise<void>
  export let updateTheme: (theme: AppTheme, origin?: ThemeTransitionOrigin) => Promise<void>
  export let updatePollingInterval: (minutes: number) => Promise<void>
  export let updateCheckForUpdatesOnStartup: (enabled: boolean) => Promise<void>
  export let updateAutoWakeSettings: (settings: Partial<typeof snapshot.settings>) => Promise<void>
  export let checkForUpdates: () => Promise<void>
  export let downloadUpdate: () => Promise<void>
  export let installUpdate: () => Promise<void>
  export let openExternalLink: (url?: string) => void
  export let updateCodexDesktopExecutablePath: (value: string) => Promise<void>
  export let updatePreserveChatGptAuthOnDirectProviderOpen: (enabled: boolean) => Promise<void>
  export let shouldShowCodexDesktopExecutablePath: () => boolean
</script>

<WorkspaceShell
  {panelClass}
  {copy}
  workspaceVersion={appMeta.version}
  workspaceStatusText={loginEvent?.message ?? ''}
  platform={appMeta.platform}
  workspaceStatusToneClass={loginEvent ? loginTone(loginEvent.phase) : 'text-muted-strong'}
  updateSummary={inlineUpdateSummary()}
  updateActionLabel={inlineUpdateActionLabel()}
  {runInlineUpdateAction}
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
  accountHealthByAccountId={snapshot.accountHealthByAccountId}
  tokenCostByInstanceId={snapshot.tokenCostByInstanceId}
  tokenCostErrorByInstanceId={snapshot.tokenCostErrorByInstanceId}
  runningTokenCostSummary={snapshot.runningTokenCostSummary}
  runningTokenCostInstanceIds={snapshot.runningTokenCostInstanceIds}
  gatewayUsageByAccountId={snapshot.gatewayUsageByAccountId ?? {}}
  statsDisplay={normalizeStatsDisplaySettings(snapshot.settings.statsDisplay)}
  wakeSchedulesByAccountId={snapshot.wakeSchedulesByAccountId}
  loginActionBusy={loginActionBusy()}
  {loginStarting}
  openAccountInCodex={(accountId) =>
    runAccountAction(`open:${accountId}`, () => window.codexApp.openAccountInCodex(accountId))}
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
  startLocalGateway={() => localGatewayActions?.startLocalGateway()}
  stopLocalGateway={() => localGatewayActions?.stopLocalGateway()}
  rotateLocalGatewayKey={() => localGatewayActions?.rotateLocalGatewayKey()}
  openLocalGatewayInCodex={() => localGatewayActions?.openLocalGatewayInCodex()}
  openLocalGatewayIsolatedInCodex={() => localGatewayActions?.openLocalGatewayIsolatedInCodex()}
  updateLocalGatewayModelMappings={(mappings) =>
    localGatewayActions?.updateLocalGatewayModelMappings(mappings)}
  updateLocalGatewayAllowedGroups={(groupIds) =>
    localGatewayActions?.updateLocalGatewayAllowedGroups(groupIds)}
  updateLocalGatewayAllowedAccounts={(accountIds) =>
    localGatewayActions?.updateLocalGatewayAllowedAccounts(accountIds)}
  localGatewayAllowedProviderIds={snapshot.settings.localGateway?.allowedProviderIds ?? []}
  updateLocalGatewayAllowedProviders={(providerIds) =>
    localGatewayActions?.updateLocalGatewayAllowedProviders(providerIds)}
  updateLocalGatewayPort={(port) => localGatewayActions?.updateLocalGatewayPort(port)}
  localGatewayAutoStart={snapshot.settings.localGateway?.autoStart === true}
  updateLocalGatewayAutoStart={(autoStart) =>
    localGatewayActions?.updateLocalGatewayAutoStart(autoStart)}
  localGatewayVisibleColumns={snapshot.settings.localGateway?.visibleColumns}
  updateLocalGatewayVisibleColumns={(columns) =>
    localGatewayActions?.updateLocalGatewayVisibleColumns(columns)}
  {localGatewayPortOccupant}
  {killingLocalGatewayPortOccupant}
  killLocalGatewayPortOccupant={() => localGatewayActions?.killLocalGatewayPortOccupant()}
  {openProviderInCodex}
  {openProviderIsolatedInCodex}
  reorderAccounts={(accountIds) => accountActions?.reorderAccounts(accountIds)}
  reorderAccountsInGroup={(groupId, accountIds) =>
    accountActions?.reorderAccountsInGroup(groupId, accountIds)}
  createGroup={(name) => accountActions?.createGroup(name)}
  updateGroup={(group, name) => accountActions?.updateGroup(group, name)}
  deleteGroup={(group) => accountActions?.deleteGroup(group)}
  updateAccountGroups={(account, groupIds) =>
    accountActions?.updateAccountGroups(account, groupIds)}
  updateAccountHealth={(account, input) => accountActions?.updateAccountHealth(account, input)}
  refreshAccountUsage={(account) => readRateLimits(account, { force: true })}
  {updateShowLocalMockData}
  {updateStatsDisplay}
  tagVisibility={snapshot.settings.tagVisibility ?? {}}
  {updateTagVisibility}
  openWakeDialog={(account, initialTab) => wakeDialogs?.openWakeDialog(account, initialTab)}
  openWakeAllDialog={() => wakeDialogs?.openWakeAllDialog()}
  wakeAllBusy={wakeAllRunning}
  openRefreshTokensBatchDialog={() => accountTokensDialogs?.openRefreshTokensBatchDialog()}
  refreshTokensBatchBusy={refreshTokensBatchPhase === 'running'}
  openEditTokensDialog={(account) => accountTokensDialogs?.openEditTokensDialog(account)}
  openRefreshTokensDialog={(account) => accountTokensDialogs?.openRefreshTokensDialog(account)}
  getAccountTokens={(accountId) => window.codexApp.getAccountTokens(accountId)}
  removeAccount={(account) => accountActions?.removeAccount(account)}
  removeAccounts={(accountIds) => accountActions?.removeAccounts(accountIds)}
  exportSelectedAccounts={(accountIds) =>
    transferDialogs?.exportSelectedAccounts(accountIds) ?? Promise.resolve()}
  readTokenCost={(input) => window.codexApp.readTokenCost(input)}
  listCodexSessionProjects={() => window.codexApp.listCodexSessionProjects()}
  listCodexSessions={(input) => window.codexApp.listCodexSessions(input)}
  readCodexSessionDetail={(input) => window.codexApp.readCodexSessionDetail(input)}
  copyCodexSessionToProvider={(input) => window.codexApp.copyCodexSessionToProvider(input)}
  trashCodexSession={(input) => window.codexApp.trashCodexSession(input)}
  listCodexSkills={() => window.codexApp.listCodexSkills()}
  readCodexSkillDetail={(instanceId, skillDirName) =>
    window.codexApp.readCodexSkillDetail(instanceId, skillDirName)}
  copyCodexSkill={(input) => window.codexApp.copyCodexSkill(input)}
  {startLogin}
  importCurrent={() => runAction('import', () => window.codexApp.importCurrentAccount())}
  importAccountsFile={() => transferDialogs?.openImportMethodDialog()}
  exportAccountsFile={() => transferDialogs?.openExportFormatDialog()}
  {refreshAllRateLimits}
  {refreshingAllUsage}
  activateBestAccount={() => {
    const target = bestAccount()
    if (!target || target.id === snapshot.activeAccountId) return
    void runAccountAction(`activate:${target.id}`, () => window.codexApp.activateAccount(target.id))
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
  {updateAutoWakeSettings}
  {checkForUpdates}
  {downloadUpdate}
  {installUpdate}
  {openExternalLink}
  {updateCodexDesktopExecutablePath}
  {updatePreserveChatGptAuthOnDirectProviderOpen}
  showCodexDesktopExecutablePath={shouldShowCodexDesktopExecutablePath()}
/>
