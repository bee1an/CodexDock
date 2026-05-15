<script lang="ts">
  import type { DndEvent as SortEvent } from 'svelte-dnd-action'

  import type {
    AccountHealth,
    AccountRateLimits,
    AccountSummary,
    AccountGroup,
    AccountTokensDetail,
    AccountWakeSchedule,
    AppLanguage,
    AppMeta,
    AppSettings,
    AppTheme,
    AppUpdateState,
    CodexInstanceSummary,
    CodexSessionDetail,
    CodexSessionProjectsResult,
    CodexSessionsResult,
    CodexSkillDetail,
    CodexSkillsResult,
    CopyCodexSessionToProviderInput,
    CopyCodexSessionToProviderResult,
    CopyCodexSkillInput,
    CopyCodexSkillResult,
    CreateCustomProviderInput,
    CustomProviderDetail,
    CustomProviderSummary,
    LocalGatewayStatus,
    LocalGatewayModelMapping,
    ListCodexSessionsInput,
    LoginMethod,
    PortOccupant,
    ProbeProviderModelsInput,
    ProviderModelsProbeResult,
    StatsDisplaySettings,
    TagVisibilitySettings,
    TokenCostDetail,
    TokenCostReadOptions,
    TokenCostSummary,
    ReadCodexSessionDetailInput,
    UpdateAccountHealthInput,
    UpdateCustomProviderInput
  } from '../../../shared/codex'
  import type { LocalizedCopy } from './app-view'
  import AccountsListView from './AccountsListView.svelte'
  import AccountsProvidersView from './AccountsProvidersView.svelte'
  import GroupManagerDialog from './GroupManagerDialog.svelte'
  import AppButton from './AppButton.svelte'
  import AppButtonGroup from './AppButtonGroup.svelte'
  import Checkbox from './Checkbox.svelte'
  import CostStatsView from './CostStatsView.svelte'
  import LocalGatewayView from './LocalGatewayView.svelte'
  import MotionNumber from './MotionNumber.svelte'
  import SessionsView from './SessionsView.svelte'
  import SettingsView from './SettingsView.svelte'
  import SkillsView from './SkillsView.svelte'
  import PromptsView from './PromptsView.svelte'
  import { groupMemberCount as groupMemberCountForAccounts } from './accounts-panel-account'
  import {
    buildProviderUpdateInput,
    createProviderDraft,
    type ProviderDraft
  } from './accounts-panel-provider'
  import { providerLabel, nextTheme, themeIconClass, themeTitle } from './app-view'
  import { cascadeIn, reveal } from './gsap-motion'

  const flipDurationMs = 160

  export let panelClass: string
  export let copy: LocalizedCopy
  export let workspaceVersion = '--'
  export let workspaceStatusText = ''
  export let workspaceStatusToneClass = 'text-muted-strong'
  export let platform: string | undefined
  export let updateSummary = ''
  export let updateActionLabel: string | null = null
  export let runUpdateAction: () => void = () => {}
  export let showLocalMockToggle = false
  export let language: AppLanguage
  export let showLocalMockData = true
  export let accounts: AccountSummary[] = []
  export let codexInstances: CodexInstanceSummary[] = []
  export let providers: CustomProviderSummary[] = []
  export let localGatewayStatus: LocalGatewayStatus
  export let localGatewayBusy = false
  export let localGatewayApiKey = ''
  export let localGatewayModelMappings: LocalGatewayModelMapping[] = []
  export let groups: AccountGroup[] = []
  export let activeAccountId: string | undefined
  export let usageByAccountId: Record<string, AccountRateLimits>
  export let usageLoadingByAccountId: Record<string, boolean>
  export let usageErrorByAccountId: Record<string, string>
  export let accountHealthByAccountId: Record<string, AccountHealth> = {}
  export let tokenCostByInstanceId: Record<string, TokenCostSummary>
  export let tokenCostErrorByInstanceId: Record<string, string>
  export let runningTokenCostSummary: TokenCostSummary | null
  export let runningTokenCostInstanceIds: string[]
  export let statsDisplay: StatsDisplaySettings
  export let tagVisibility: TagVisibilitySettings = {}
  export let wakeSchedulesByAccountId: Record<string, AccountWakeSchedule>
  export let loginActionBusy: boolean
  export let loginStarting = false
  export let openingAccountId = ''
  export let openingIsolatedAccountId = ''
  export let wakingAccountId = ''
  export let openingProviderId = ''
  export let openAccountInCodex: (accountId: string) => void
  export let openAccountInIsolatedCodex: (accountId: string) => void
  export let openWakeDialog: (account: AccountSummary, initialTab?: 'session' | 'schedule') => void
  export let openEditTokensDialog: (account: AccountSummary) => void
  export let openRefreshTokensDialog: (account: AccountSummary) => void
  export let getAccountTokens: (accountId: string) => Promise<AccountTokensDetail>
  export let createProvider: (input: CreateCustomProviderInput) => Promise<void>
  export let probeProviderModels: (
    input: ProbeProviderModelsInput
  ) => Promise<ProviderModelsProbeResult>
  export let openProviderInCodex: (providerId: string) => Promise<void>
  export let getProvider: (providerId: string) => Promise<CustomProviderDetail>
  export let reorderProviders: (providerIds: string[]) => Promise<void>
  export let updateProvider: (providerId: string, input: UpdateCustomProviderInput) => Promise<void>
  export let removeProvider: (providerId: string) => Promise<void>
  export let startLocalGateway: () => Promise<void>
  export let stopLocalGateway: () => Promise<void>
  export let rotateLocalGatewayKey: () => Promise<void>
  export let openLocalGatewayInCodex: () => Promise<void>
  export let updateLocalGatewayModelMappings: (
    mappings: LocalGatewayModelMapping[]
  ) => Promise<void> = async () => {}
  export let localGatewayAllowedGroupIds: string[] = []
  export let localGatewayAllowedAccountIds: string[] = []
  export let updateLocalGatewayAllowedGroups: (groupIds: string[]) => Promise<void> = async () => {}
  export let updateLocalGatewayAllowedAccounts: (
    accountIds: string[]
  ) => Promise<void> = async () => {}
  export let localGatewayPortOccupant: PortOccupant | null = null
  export let killingLocalGatewayPortOccupant = false
  export let killLocalGatewayPortOccupant: () => Promise<void> = async () => {}
  export let reorderAccounts: (accountIds: string[]) => Promise<void>
  export let createGroup: (name: string) => Promise<void>
  export let updateGroup: (group: AccountGroup, name: string) => Promise<void>
  export let deleteGroup: (group: AccountGroup) => Promise<void>
  export let updateAccountGroups: (account: AccountSummary, groupIds: string[]) => Promise<void>
  export let updateAccountHealth: (
    account: AccountSummary,
    input: UpdateAccountHealthInput
  ) => Promise<void>
  export let refreshAccountUsage: (account: AccountSummary) => void
  export let updateShowLocalMockData: (enabled: boolean) => void
  export let updateStatsDisplay: (statsDisplay: StatsDisplaySettings) => Promise<void>
  export let updateTagVisibility: (tagVisibility: TagVisibilitySettings) => Promise<void>
  export let removeAccount: (account: AccountSummary) => void
  export let removeAccounts: (accountIds: string[]) => Promise<void>
  export let exportSelectedAccounts: (accountIds: string[]) => Promise<void>
  export let readTokenCost: (input?: TokenCostReadOptions) => Promise<TokenCostDetail>
  export let listCodexSessionProjects: () => Promise<CodexSessionProjectsResult>
  export let listCodexSessions: (input?: ListCodexSessionsInput) => Promise<CodexSessionsResult>
  export let readCodexSessionDetail: (
    input: ReadCodexSessionDetailInput
  ) => Promise<CodexSessionDetail>
  export let copyCodexSessionToProvider: (
    input: CopyCodexSessionToProviderInput
  ) => Promise<CopyCodexSessionToProviderResult>
  export let listCodexSkills: () => Promise<CodexSkillsResult>
  export let readCodexSkillDetail: (
    instanceId: string,
    skillDirName: string
  ) => Promise<CodexSkillDetail>
  export let copyCodexSkill: (input: CopyCodexSkillInput) => Promise<CopyCodexSkillResult>
  export let startLogin: (method: LoginMethod) => void
  export let importCurrent: () => void
  export let importAccountsFile: () => void = () => {}
  export let exportAccountsFile: () => void = () => {}
  export let refreshAllRateLimits: () => void = () => {}
  export let refreshingAllUsage = false
  export let activateBestAccount: () => void = () => {}
  export let bestAccount: AccountSummary | null = null
  export let appMeta: AppMeta
  export let appSettings: AppSettings
  export let theme: AppTheme = 'light'
  export let updateState: AppUpdateState
  export let updateLanguage: (language: AppLanguage) => void = () => {}
  export let updateTheme: (
    theme: AppTheme,
    origin?: { x?: number; y?: number; target?: HTMLElement | null }
  ) => void = () => {}
  export let updatePollingInterval: (minutes: number) => void = () => {}
  export let updateCheckForUpdatesOnStartup: (enabled: boolean) => void = () => {}
  export let checkForUpdates: () => void = () => {}
  export let downloadUpdate: () => Promise<void> = async () => {}
  export let installUpdate: () => Promise<void> = async () => {}
  export let openExternalLink: (url?: string) => void = () => {}
  export let updateCodexDesktopExecutablePath: (value: string) => Promise<void> = async () => {}
  export let showCodexDesktopExecutablePath = false

  let currentView:
    | 'accounts'
    | 'providers'
    | 'gateway'
    | 'stats'
    | 'sessions'
    | 'skills'
    | 'prompts'
    | 'settings' = 'accounts'
  let activeGroupFilter = 'all'
  let groupMutationBusy = false
  let showGroupManagerDialog = false
  let selectedAccountIds: string[] = []
  let accountWorkbenchExpanded = false
  let sortableProviders: CustomProviderSummary[] = []
  let providerSortInteractionActive = false
  let providerMutationBusy = false
  let editingProviderId = ''
  let providerDrafts: Record<string, ProviderDraft> = {}

  $: if (!providerSortInteractionActive) {
    sortableProviders = providers
  }

  $: {
    const nextDrafts: typeof providerDrafts = {}
    for (const provider of providers) {
      nextDrafts[provider.id] = providerDrafts[provider.id] ?? createProviderDraft(provider)
    }
    providerDrafts = nextDrafts
  }

  function providerActionBusy(providerId: string): boolean {
    return openingProviderId === providerId || providerMutationBusy
  }

  async function runProviderMutation(task: () => Promise<void>): Promise<void> {
    if (providerMutationBusy || loginActionBusy) {
      return
    }

    providerMutationBusy = true
    try {
      await task()
    } finally {
      providerMutationBusy = false
    }
  }

  async function startEditingProvider(provider: CustomProviderSummary): Promise<void> {
    editingProviderId = provider.id
    const detail = await getProvider(provider.id)
    providerDrafts = {
      ...providerDrafts,
      [provider.id]: createProviderDraft(detail)
    }
  }

  function cancelEditingProvider(): void {
    editingProviderId = ''
  }

  async function saveProvider(provider: CustomProviderSummary): Promise<void> {
    const draft = providerDrafts[provider.id]
    if (!draft) {
      return
    }

    const input = buildProviderUpdateInput(provider, draft)
    if (!Object.keys(input).length) {
      cancelEditingProvider()
      return
    }

    await runProviderMutation(async () => {
      await updateProvider(provider.id, input)
      cancelEditingProvider()
    })
  }

  async function confirmRemoveProvider(provider: CustomProviderSummary): Promise<void> {
    if (!window.confirm(copy.deleteProviderConfirm(providerLabel(provider, copy)))) {
      return
    }

    await runProviderMutation(async () => {
      await removeProvider(provider.id)
      if (editingProviderId === provider.id) {
        cancelEditingProvider()
      }
    })
  }

  async function runGroupMutation(task: () => Promise<void>): Promise<void> {
    if (loginActionBusy || groupMutationBusy) {
      return
    }

    groupMutationBusy = true

    try {
      await task()
    } finally {
      groupMutationBusy = false
    }
  }

  async function handleCreateGroup(name: string): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed) return
    await runGroupMutation(async () => {
      await createGroup(trimmed)
    })
  }

  async function handleRenameGroup(group: AccountGroup, nextName: string): Promise<void> {
    const trimmed = nextName.trim()
    if (!trimmed || trimmed === group.name) return
    await runGroupMutation(async () => {
      await updateGroup(group, trimmed)
    })
  }

  async function handleDeleteGroup(group: AccountGroup): Promise<void> {
    if (!window.confirm(copy.deleteGroupConfirm(group.name))) {
      return
    }
    await runGroupMutation(async () => {
      await deleteGroup(group)
    })
  }

  async function updateAccountGroupsWithProtection(
    account: AccountSummary,
    groupIds: string[]
  ): Promise<void> {
    await runGroupMutation(async () => {
      await updateAccountGroups(account, groupIds)
    })
  }

  function handleProviderSortConsider(event: CustomEvent<SortEvent<CustomProviderSummary>>): void {
    providerSortInteractionActive = true
    sortableProviders = event.detail.items
  }

  async function handleProviderSortFinalize(
    event: CustomEvent<SortEvent<CustomProviderSummary>>
  ): Promise<void> {
    sortableProviders = event.detail.items

    try {
      await reorderProviders(event.detail.items.map((provider) => provider.id))
    } finally {
      providerSortInteractionActive = false
    }
  }
</script>

<section
  class={`${panelClass} flex h-full min-h-0 flex-1 w-full flex-col gap-0 overflow-hidden`}
  use:reveal={{ delay: 0.05 }}
  use:cascadeIn={{ selector: '[data-panel-motion]' }}
>
  <div
    class={`workspace-topbar flex min-h-12 flex-wrap items-center justify-between gap-2 py-0 pr-4 ${
      platform === 'darwin' ? 'workspace-topbar-mac pl-[5.5rem]' : 'workspace-topbar-standard pl-4'
    }`}
    style="-webkit-app-region: drag; app-region: drag;"
    data-panel-motion
  >
    <div class="min-w-0 flex flex-1 items-center self-stretch">
      <div class="workspace-meta min-w-0 flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span class="workspace-title text-[13px] font-semibold tracking-[-0.015em] text-carbon">
          CodexDock
        </span>
        <span
          class="theme-version-pill inline-flex items-center rounded-[0.3rem] border border-[var(--soft-panel-border)] bg-transparent px-1.5 py-0.5 text-[9px] font-medium tabular-nums text-faint"
        >
          v{workspaceVersion}
        </span>
        {#if workspaceStatusText}
          <span class="inline-flex min-w-0 items-center gap-1.5">
            <span class="h-1.5 w-1.5 flex-none rounded-full bg-success"></span>
            <span
              class={`min-w-0 truncate text-[10px] ${workspaceStatusToneClass}`}
              aria-live="polite"
            >
              {workspaceStatusText}
            </span>
          </span>
        {/if}
      </div>
    </div>

    <div class="topbar-actions flex flex-wrap items-center justify-end gap-1.5">
      {#if updateSummary}
        <span
          class="topbar-update-note hidden max-w-[28rem] truncate text-[11px] text-muted-strong xl:inline"
          aria-live="polite">{updateSummary}</span
        >
      {/if}

      {#if showLocalMockToggle}
        <label
          class="topbar-mock-toggle inline-flex items-center gap-1.5 rounded-[0.35rem] border border-[var(--card-border)] bg-[var(--surface-soft)] px-2 py-1.5 text-[11px] text-muted-strong"
        >
          <Checkbox
            checked={showLocalMockData}
            onCheckedChange={(checked) => updateShowLocalMockData(checked)}
          />
          <span>{copy.showLocalMockData}</span>
        </label>
      {/if}

      {#if updateActionLabel}
        <AppButton variant="secondary" size="sm" class="relative" onclick={runUpdateAction}>
          {updateActionLabel}
          <span class="t-badge" data-open="true" aria-hidden="true">
            <span class="t-badge-dot h-2 w-2 rounded-full bg-success"></span>
          </span>
        </AppButton>
      {/if}

      <AppButtonGroup
        class="theme-toolbar inline-flex items-center gap-0 rounded-[0.45rem] border border-[var(--card-border)] bg-[var(--surface-soft)] p-0.5"
      >
        <AppButton
          variant="filter"
          size="sm"
          selected={currentView === 'accounts'}
          ariaPressed={currentView === 'accounts'}
          onclick={() => {
            currentView = 'accounts'
          }}
          ariaLabel={copy.accountCount(accounts.length)}
        >
          <span class="i-lucide-layout-list h-3.5 w-3.5"></span>
          <MotionNumber value={accounts.length} label={copy.accountCount(accounts.length)} />
        </AppButton>
        <AppButton
          variant="filter"
          size="sm"
          selected={currentView === 'providers'}
          ariaPressed={currentView === 'providers'}
          onclick={() => {
            currentView = 'providers'
          }}
          ariaLabel={copy.providerCount(providers.length)}
        >
          <span class="i-lucide-plug-zap h-3.5 w-3.5"></span>
          <MotionNumber value={providers.length} label={copy.providerCount(providers.length)} />
        </AppButton>
        <AppButton
          variant="filter"
          size="sm"
          selected={currentView === 'gateway'}
          ariaPressed={currentView === 'gateway'}
          onclick={() => {
            currentView = 'gateway'
          }}
        >
          <span class="i-lucide-radio-tower h-3.5 w-3.5"></span>
          <span>{copy.localGateway}</span>
        </AppButton>
        <AppButton
          variant="filter"
          size="sm"
          selected={currentView === 'stats'}
          ariaPressed={currentView === 'stats'}
          onclick={() => {
            currentView = 'stats'
          }}
        >
          <span class="i-lucide-chart-no-axes-combined h-3.5 w-3.5"></span>
          <span>{copy.tokenStats}</span>
        </AppButton>
        <AppButton
          variant="filter"
          size="sm"
          selected={currentView === 'sessions'}
          ariaPressed={currentView === 'sessions'}
          onclick={() => {
            currentView = 'sessions'
          }}
        >
          <span class="i-lucide-messages-square h-3.5 w-3.5"></span>
          <span>{copy.sessions}</span>
        </AppButton>
        <AppButton
          variant="filter"
          size="sm"
          selected={currentView === 'skills'}
          ariaPressed={currentView === 'skills'}
          onclick={() => {
            currentView = 'skills'
          }}
        >
          <span class="i-lucide-puzzle h-3.5 w-3.5"></span>
          <span>{copy.skills}</span>
        </AppButton>
        <AppButton
          variant="filter"
          size="sm"
          selected={currentView === 'prompts'}
          ariaPressed={currentView === 'prompts'}
          onclick={() => {
            currentView = 'prompts'
          }}
        >
          <span class="i-lucide-file-text h-3.5 w-3.5"></span>
          <span>{copy.prompts}</span>
        </AppButton>
        <AppButton
          variant="filter"
          size="sm"
          selected={currentView === 'settings'}
          ariaPressed={currentView === 'settings'}
          onclick={() => {
            currentView = 'settings'
          }}
        >
          <span class="i-lucide-cog h-3.5 w-3.5"></span>
          <span>{copy.settings}</span>
        </AppButton>
      </AppButtonGroup>

      <div class="flex items-center gap-1">
        <AppButton
          variant="secondary"
          size="sm"
          onclick={(event) => {
            const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
            const origin =
              event.detail > 0 ? { x: event.clientX, y: event.clientY, target } : { target }
            updateTheme(nextTheme(theme), origin)
          }}
          ariaLabel={copy.switchTheme(themeTitle(theme, copy))}
        >
          <span class={`${themeIconClass(theme)} h-3.5 w-3.5`}></span>
        </AppButton>

        {#if appMeta.githubUrl}
          <AppButton
            variant="secondary"
            size="sm"
            onclick={() => openExternalLink(appMeta.githubUrl ?? undefined)}
            ariaLabel={copy.openGithub}
          >
            <span class="i-lucide-github h-3.5 w-3.5"></span>
          </AppButton>
        {/if}
      </div>
    </div>
  </div>

  {#if currentView === 'stats'}
    <CostStatsView
      {copy}
      {language}
      {accounts}
      {codexInstances}
      {tokenCostByInstanceId}
      {tokenCostErrorByInstanceId}
      {runningTokenCostSummary}
      {runningTokenCostInstanceIds}
      {statsDisplay}
      {readTokenCost}
      {updateStatsDisplay}
    />
  {:else if currentView === 'sessions'}
    <SessionsView
      {copy}
      {language}
      instances={codexInstances}
      {providers}
      {listCodexSessionProjects}
      {listCodexSessions}
      {readCodexSessionDetail}
      {copyCodexSessionToProvider}
    />
  {:else if currentView === 'skills'}
    <SkillsView
      {copy}
      instances={codexInstances}
      {listCodexSkills}
      {readCodexSkillDetail}
      {copyCodexSkill}
    />
  {:else if currentView === 'prompts'}
    <PromptsView
      {copy}
      listPrompts={(input) => window.codexApp.listPrompts(input)}
      getPromptDetail={(id) => window.codexApp.getPromptDetail(id)}
      createPrompt={(input) => window.codexApp.createPrompt(input)}
      updatePrompt={(id, input) => window.codexApp.updatePrompt(id, input)}
      removePrompt={(id) => window.codexApp.removePrompt(id)}
      copyPromptContent={(id) => window.codexApp.copyPromptContent(id)}
      listPromptCategories={() => window.codexApp.listPromptCategories()}
      createPromptCategory={(name) => window.codexApp.createPromptCategory(name)}
      renamePromptCategory={(old, name) => window.codexApp.renamePromptCategory(old, name)}
      removePromptCategory={(name) => window.codexApp.removePromptCategory(name)}
      addPromptAttachment={(id, payload) => window.codexApp.addPromptAttachment(id, payload)}
      removePromptAttachment={(id, fileName) =>
        window.codexApp.removePromptAttachment(id, fileName)}
      readPromptAttachment={(id, fileName) => window.codexApp.readPromptAttachment(id, fileName)}
    />
  {:else if currentView === 'settings'}
    <SettingsView
      {copy}
      {language}
      {theme}
      settings={appSettings}
      {updateState}
      {appMeta}
      showLocalMockToggle={appMeta.isPackaged === false}
      {showCodexDesktopExecutablePath}
      {updateCheckForUpdatesOnStartup}
      {updateShowLocalMockData}
      {updateLanguage}
      {updateCodexDesktopExecutablePath}
      {checkForUpdates}
      {downloadUpdate}
      {installUpdate}
      {openExternalLink}
    />
  {:else if currentView === 'accounts'}
    <AccountsListView
      bind:activeGroupFilter
      bind:selectedAccountIds
      bind:accountWorkbenchExpanded
      {copy}
      {language}
      {accounts}
      {groups}
      {activeAccountId}
      {usageByAccountId}
      {usageLoadingByAccountId}
      {usageErrorByAccountId}
      {accountHealthByAccountId}
      {wakeSchedulesByAccountId}
      {loginActionBusy}
      {loginStarting}
      {groupMutationBusy}
      {refreshingAllUsage}
      {bestAccount}
      {startLogin}
      {importCurrent}
      {importAccountsFile}
      {exportAccountsFile}
      {refreshAllRateLimits}
      {activateBestAccount}
      openGroupManager={() => {
        showGroupManagerDialog = true
      }}
      {openingAccountId}
      {openingIsolatedAccountId}
      {wakingAccountId}
      {openAccountInCodex}
      {openAccountInIsolatedCodex}
      {openWakeDialog}
      {openEditTokensDialog}
      {openRefreshTokensDialog}
      {getAccountTokens}
      {tagVisibility}
      {updateTagVisibility}
      {reorderAccounts}
      updateAccountGroups={updateAccountGroupsWithProtection}
      {updateAccountHealth}
      {refreshAccountUsage}
      {removeAccount}
      {removeAccounts}
      {exportSelectedAccounts}
      usagePollingMinutes={appSettings.usagePollingMinutes}
      {updatePollingInterval}
    />
  {:else if currentView === 'gateway'}
    <LocalGatewayView
      {copy}
      {localGatewayStatus}
      {localGatewayBusy}
      {localGatewayApiKey}
      modelMappings={localGatewayModelMappings}
      allowedGroupIds={localGatewayAllowedGroupIds}
      allowedAccountIds={localGatewayAllowedAccountIds}
      {groups}
      {accounts}
      {startLocalGateway}
      {stopLocalGateway}
      {rotateLocalGatewayKey}
      {openLocalGatewayInCodex}
      updateModelMappings={updateLocalGatewayModelMappings}
      updateAllowedGroups={updateLocalGatewayAllowedGroups}
      updateAllowedAccounts={updateLocalGatewayAllowedAccounts}
      portOccupant={localGatewayPortOccupant}
      {killingLocalGatewayPortOccupant}
      killPortOccupant={killLocalGatewayPortOccupant}
    />
  {:else if currentView === 'providers'}
    <AccountsProvidersView
      {copy}
      {providers}
      {sortableProviders}
      {flipDurationMs}
      {loginActionBusy}
      {providerMutationBusy}
      {providerDrafts}
      {openingProviderId}
      {providerActionBusy}
      {createProvider}
      {probeProviderModels}
      {openProviderInCodex}
      {startEditingProvider}
      {saveProvider}
      {cancelEditingProvider}
      {confirmRemoveProvider}
      {handleProviderSortConsider}
      {handleProviderSortFinalize}
    />
  {:else}
    <div class="flex min-h-0 flex-1 items-center justify-center overflow-y-auto">
      <div class="w-full max-w-2xl px-4 py-8">
        <div class="mx-auto mb-4 flex h-12 w-12 items-center justify-center">
          <span class="i-lucide-users-round h-6 w-6 text-muted-strong"></span>
        </div>

        <div class="mx-auto grid max-w-xl gap-2 text-center">
          <h3 class="text-lg font-semibold text-carbon sm:text-xl">{copy.emptyStateTitle}</h3>
          <p class="text-sm leading-6 text-muted-strong">{copy.emptyStateDescription}</p>
        </div>

        <div class="mt-5 grid gap-4">
          <div class="flex flex-wrap items-center justify-center gap-2.5">
            <AppButton
              variant="primary"
              size="lg"
              onclick={() => startLogin('browser')}
              disabled={loginActionBusy}
            >
              <span
                class={`${loginStarting ? 'i-lucide-loader-circle animate-spin' : 'i-lucide-log-in'} h-4.5 w-4.5`}
              ></span>
              <span>{copy.callbackLogin}</span>
            </AppButton>

            <AppButton variant="secondary" size="lg" onclick={() => startLogin('device')}>
              <span class="i-lucide-key-round h-4.5 w-4.5"></span>
              <span>{copy.deviceLogin}</span>
            </AppButton>

            <AppButton
              variant="secondary"
              size="lg"
              onclick={importCurrent}
              disabled={loginActionBusy}
            >
              <span class="i-lucide-monitor-down h-4.5 w-4.5"></span>
              <span>{copy.importCurrent}</span>
            </AppButton>
          </div>
        </div>
      </div>
    </div>
  {/if}
</section>

<GroupManagerDialog
  open={showGroupManagerDialog}
  {copy}
  {groups}
  {accounts}
  loginActionBusy={loginActionBusy || groupMutationBusy}
  onClose={() => {
    showGroupManagerDialog = false
  }}
  createGroup={handleCreateGroup}
  renameGroup={handleRenameGroup}
  deleteGroup={handleDeleteGroup}
  groupAccountCount={(groupId) => groupMemberCountForAccounts(accounts, groupId)}
/>

<style>
  .workspace-topbar {
    border-bottom: 0;
  }

  .workspace-meta {
    opacity: 0.76;
  }

  .workspace-title {
    line-height: 1;
  }

  .topbar-actions,
  .topbar-actions :global(*) {
    -webkit-app-region: no-drag;
    app-region: no-drag;
  }

  .theme-view-toggle {
    position: relative;
  }
</style>
