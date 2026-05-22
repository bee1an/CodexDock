<script lang="ts">
  import type {
    AccountGroup,
    AccountSummary,
    AppLanguage,
    AppMeta,
    AppSettings,
    AppUpdateState
  } from '../../../../shared/codex'
  import { autoWakeTargetAccountIds } from '../../../../shared/codex'
  import { accountEmail, languageOptions, type LocalizedCopy } from '$lib/view/app-view'
  import AppButton from '$lib/ui/AppButton.svelte'
  import AppButtonGroup from '$lib/ui/AppButtonGroup.svelte'
  import AppInput from '$lib/ui/AppInput.svelte'
  import Checkbox from '$lib/ui/Checkbox.svelte'

  export let copy: LocalizedCopy
  export let language: AppLanguage
  export let settings: AppSettings
  export let accounts: AccountSummary[] = []
  export let groups: AccountGroup[] = []
  export let updateState: AppUpdateState
  export let appMeta: AppMeta
  export let showLocalMockToggle = false
  export let showCodexDesktopExecutablePath = false
  export let updateCheckForUpdatesOnStartup: (enabled: boolean) => void
  export let updateAutoWakeSettings: (
    settings: Partial<AppSettings>
  ) => Promise<void> = async () => {}
  export let updateShowLocalMockData: (enabled: boolean) => void
  export let updateLanguage: (language: AppLanguage) => void
  export let updateCodexDesktopExecutablePath: (value: string) => Promise<void>
  export let updatePreserveChatGptAuthOnDirectProviderOpen: (
    enabled: boolean
  ) => Promise<void> = async () => {}
  export let checkForUpdates: () => void
  export let downloadUpdate: () => Promise<void>
  export let installUpdate: () => Promise<void>

  let codexDesktopExecutablePathDraft = settings.codexDesktopExecutablePath ?? ''
  let lastSyncedPath = settings.codexDesktopExecutablePath ?? ''
  let showPathEditor = Boolean(settings.codexDesktopExecutablePath?.trim())
  let autoWakeAccountSearchDraft = ''

  $: if ((settings.codexDesktopExecutablePath ?? '') !== lastSyncedPath) {
    lastSyncedPath = settings.codexDesktopExecutablePath ?? ''
    codexDesktopExecutablePathDraft = lastSyncedPath
  }

  const updateActionLabel = (): string => {
    switch (updateState.status) {
      case 'checking':
        return copy.checkingUpdates
      case 'available':
        return updateState.delivery === 'external'
          ? updateState.externalAction === 'homebrew'
            ? copy.updateViaHomebrew(updateState.availableVersion)
            : copy.openReleasePage(updateState.availableVersion)
          : copy.downloadUpdate(updateState.availableVersion)
      case 'downloaded':
        return copy.restartToInstallUpdate
      default:
        return copy.checkUpdates
    }
  }

  const updateActionDisabled = (): boolean =>
    updateState.status === 'checking' ||
    updateState.status === 'downloading' ||
    updateState.status === 'unsupported'

  const runUpdateAction = (): void => {
    switch (updateState.status) {
      case 'available':
        void downloadUpdate()
        return
      case 'downloaded':
        void installUpdate()
        return
      case 'checking':
      case 'downloading':
      case 'unsupported':
        return
      default:
        void checkForUpdates()
    }
  }

  const updateStatus = (): string => {
    switch (updateState.status) {
      case 'checking':
        return copy.checkingUpdates
      case 'available':
        return copy.updateAvailableVersion(updateState.availableVersion)
      case 'downloading':
        return updateState.delivery === 'external' && updateState.externalAction === 'homebrew'
          ? copy.homebrewUpdateStatus(
              updateState.externalCommandStatus,
              updateState.externalCommand
            )
          : copy.updateDownloadProgress(updateState.downloadProgress)
      case 'downloaded':
        return copy.updateReady
      case 'up-to-date':
        return copy.updateUpToDate
      case 'unsupported':
        return copy.updatesUnsupported
      case 'error':
        return updateState.message || copy.updateFailed
      default:
        return ''
    }
  }

  const updateAutoWakeNumber = (
    key:
      | 'autoWakeFirstWindowRemainingThresholdPercent'
      | 'autoWakeResetToleranceMinutes'
      | 'autoWakeCooldownWindowRatio',
    value: string
  ): void => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed < 0) {
      return
    }

    void updateAutoWakeSettings({ [key]: parsed } as Partial<AppSettings>)
  }

  const autoWakeGroupIds = (): string[] => settings.autoWakeGroupIds ?? []
  const autoWakeAccountIds = (): string[] => settings.autoWakeAccountIds ?? []

  const accountGroupNames = (account: AccountSummary, sourceGroups = groups): string[] =>
    account.groupIds
      .map((groupId) => sourceGroups.find((group) => group.id === groupId)?.name)
      .filter((name): name is string => Boolean(name))

  const ungroupedAccountIds = (
    sourceAccounts: AccountSummary[],
    sourceGroups: AccountGroup[]
  ): string[] =>
    sourceAccounts
      .filter((account) => !accountGroupNames(account, sourceGroups).length)
      .map((account) => account.id)

  const normalizeSearch = (value: string): string => value.trim().toLowerCase()

  const visibleAutoWakeAccounts = (
    sourceAccounts: AccountSummary[],
    sourceGroups: AccountGroup[],
    sourceCopy: LocalizedCopy,
    search: string
  ): AccountSummary[] => {
    const query = normalizeSearch(search)
    if (!query) {
      return sourceAccounts
    }

    return sourceAccounts.filter((account) => {
      const searchableText = [
        accountEmail(account, sourceCopy),
        account.name,
        account.email,
        account.accountId,
        account.id,
        ...accountGroupNames(account, sourceGroups)
      ]
        .filter((value): value is string => Boolean(value))
        .join('\n')
        .toLowerCase()

      return searchableText.includes(query)
    })
  }

  const setAutoWakeTargetMode = (mode: AppSettings['autoWakeTargetMode']): void => {
    void updateAutoWakeSettings({ autoWakeTargetMode: mode })
  }

  const toggleAutoWakeGroup = (groupId: string): void => {
    const current = autoWakeGroupIds()
    const next = current.includes(groupId)
      ? current.filter((id) => id !== groupId)
      : [...current, groupId]
    void updateAutoWakeSettings({
      autoWakeTargetMode: 'selected',
      autoWakeGroupIds: next
    })
  }

  const toggleAutoWakeAccount = (accountId: string, checked: boolean): void => {
    const current = autoWakeAccountIds()
    const next = checked
      ? accounts
          .map((account) => account.id)
          .filter((id) => id === accountId || current.includes(id))
      : current.filter((id) => id !== accountId)
    void updateAutoWakeSettings({
      autoWakeTargetMode: 'selected',
      autoWakeAccountIds: next
    })
  }

  $: autoWakeTargetMode = settings.autoWakeTargetMode ?? 'all'
  $: autoWakeSelectedAccountIds = autoWakeTargetAccountIds(accounts, groups, settings)
  $: autoWakeVisibleAccounts = visibleAutoWakeAccounts(
    accounts,
    groups,
    copy,
    autoWakeAccountSearchDraft
  )
  $: autoWakeUngroupedAccountIds = ungroupedAccountIds(accounts, groups)
  $: autoWakeSelectedUngroupedCount = autoWakeUngroupedAccountIds.filter((accountId) =>
    autoWakeSelectedAccountIds.includes(accountId)
  ).length
</script>

<div class="settings-container flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
  <section
    class="settings-section theme-soft-panel rounded-[0.55rem] border border-[var(--card-border)] px-4 py-4"
  >
    <div class="flex items-center gap-3 mb-4">
      <div
        class="settings-section-icon flex h-7 w-7 flex-none items-center justify-center rounded-[0.4rem] border"
      >
        <span class="i-lucide-sliders-horizontal h-4 w-4" aria-hidden="true"></span>
      </div>
      <div class="min-w-0">
        <p class="text-[13px] font-semibold text-carbon">{copy.generalSettings}</p>
        <p class="mt-0.5 text-[10px] leading-4 text-muted-strong">
          {copy.generalSettingsDescription}
        </p>
      </div>
    </div>

    <div class="grid gap-3">
      <div
        class="settings-row flex flex-wrap items-center gap-3 rounded-[0.45rem] border px-3 py-2.5"
      >
        <span class="text-xs font-medium text-carbon">{copy.switchLanguage}</span>
        <AppButtonGroup ariaLabel={copy.switchLanguage}>
          {#each languageOptions as option (option.value)}
            <AppButton
              variant="filter"
              size="xs"
              selected={language === option.value}
              ariaPressed={language === option.value}
              onclick={() => updateLanguage(option.value)}
            >
              {option.label}
            </AppButton>
          {/each}
        </AppButtonGroup>

        <label class="ml-auto inline-flex items-center gap-2 text-xs text-muted-strong">
          <Checkbox
            checked={settings.checkForUpdatesOnStartup}
            onCheckedChange={(checked) => updateCheckForUpdatesOnStartup(checked)}
          />
          <span>{copy.autoCheckUpdates}</span>
        </label>
      </div>

      {#if showLocalMockToggle}
        <div class="settings-row flex items-center gap-3 rounded-[0.45rem] border px-3 py-2.5">
          <label class="inline-flex items-center gap-2 text-xs text-muted-strong">
            <Checkbox
              checked={settings.showLocalMockData !== false}
              onCheckedChange={(checked) => updateShowLocalMockData(checked)}
            />
            <span>{copy.showLocalMockData}</span>
          </label>
        </div>
      {/if}

      <div class="settings-row flex items-start gap-3 rounded-[0.45rem] border px-3 py-2.5">
        <label class="inline-flex min-w-0 items-start gap-2 text-xs text-muted-strong">
          <Checkbox
            checked={settings.preserveChatGptAuthOnDirectProviderOpen === true}
            onCheckedChange={(checked) =>
              void updatePreserveChatGptAuthOnDirectProviderOpen(checked)}
          />
          <span class="grid gap-1">
            <span class="font-medium text-carbon"
              >{copy.preserveChatGptAuthOnDirectProviderOpen}</span
            >
            <span class="leading-4 text-muted-strong">
              {copy.preserveChatGptAuthOnDirectProviderOpenDescription}
            </span>
          </span>
        </label>
      </div>

      <div class="settings-row grid gap-3 rounded-[0.45rem] border px-3 py-2.5">
        <label class="inline-flex min-w-0 items-start gap-2 text-xs text-muted-strong">
          <Checkbox
            checked={settings.autoWakeOnStartup === true}
            onCheckedChange={(checked) =>
              void updateAutoWakeSettings({ autoWakeOnStartup: checked })}
          />
          <span class="grid gap-1">
            <span class="font-medium text-carbon">{copy.autoWakeOnStartup}</span>
            <span class="leading-4 text-muted-strong">{copy.autoWakeOnStartupDescription}</span>
          </span>
        </label>

        <div class="grid gap-2 rounded-[0.4rem] border border-[var(--card-border)] px-3 py-2.5">
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div class="grid gap-1">
              <span class="text-xs font-medium text-carbon">{copy.autoWakeTargets}</span>
              <span class="text-[11px] leading-4 text-muted-strong">
                {copy.autoWakeTargetsDescription}
              </span>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <span class="theme-version-pill rounded-md px-2 py-0.5 text-[10px] text-muted-strong">
                {copy.autoWakeTargetSelectedCount(
                  autoWakeTargetMode === 'all'
                    ? accounts.length
                    : autoWakeSelectedAccountIds.length,
                  accounts.length
                )}
              </span>
              <AppButtonGroup ariaLabel={copy.autoWakeTargets}>
                <AppButton
                  variant="filter"
                  size="xs"
                  selected={autoWakeTargetMode === 'all'}
                  ariaPressed={autoWakeTargetMode === 'all'}
                  onclick={() => setAutoWakeTargetMode('all')}
                >
                  {copy.autoWakeTargetAll}
                </AppButton>
                <AppButton
                  variant="filter"
                  size="xs"
                  selected={autoWakeTargetMode === 'selected'}
                  ariaPressed={autoWakeTargetMode === 'selected'}
                  onclick={() => setAutoWakeTargetMode('selected')}
                >
                  {copy.autoWakeTargetCustom}
                </AppButton>
              </AppButtonGroup>
            </div>
          </div>

          {#if autoWakeTargetMode === 'selected'}
            <div class="grid gap-2">
              <div class="grid gap-1.5">
                <span class="text-[11px] font-medium text-muted-strong">
                  {copy.autoWakeTargetGroups}
                </span>
                <div class="flex max-h-20 flex-wrap gap-1 overflow-auto pr-1">
                  {#if autoWakeUngroupedAccountIds.length}
                    <button
                      type="button"
                      class={`inline-flex items-center gap-1 rounded-[0.32rem] border px-1.5 py-0.5 text-[10px] transition-colors ${
                        settings.autoWakeIncludeUngrouped === true
                          ? 'border-[var(--selector-border-checked)] bg-[var(--selector-bg)] text-carbon'
                          : 'border-[var(--card-border)] bg-[var(--panel)] text-muted-strong'
                      }`}
                      onclick={() =>
                        void updateAutoWakeSettings({
                          autoWakeTargetMode: 'selected',
                          autoWakeIncludeUngrouped: settings.autoWakeIncludeUngrouped !== true
                        })}
                    >
                      <span
                        class={`inline-grid h-3.5 w-3.5 flex-none place-items-center rounded-[0.24rem] border ${
                          settings.autoWakeIncludeUngrouped === true
                            ? 'border-[var(--color-carbon)] bg-[var(--color-carbon)] text-[var(--color-snow)]'
                            : 'border-[var(--line-strong)] bg-[var(--color-fog)] text-transparent'
                        }`}
                        aria-hidden="true"
                      >
                        {#if settings.autoWakeIncludeUngrouped === true}
                          <span class="i-lucide-check h-2.5 w-2.5"></span>
                        {/if}
                      </span>
                      <span>{copy.autoWakeTargetUngrouped}</span>
                      <span class="text-faint">
                        {copy.autoWakeTargetGroupCount(
                          autoWakeSelectedUngroupedCount,
                          autoWakeUngroupedAccountIds.length
                        )}
                      </span>
                    </button>
                  {/if}
                  {#each groups as group (group.id)}
                    {@const groupMemberCount = accounts.filter((account) =>
                      account.groupIds.includes(group.id)
                    ).length}
                    <button
                      type="button"
                      class={`inline-flex items-center gap-1 rounded-[0.32rem] border px-1.5 py-0.5 text-[10px] transition-colors ${
                        autoWakeGroupIds().includes(group.id)
                          ? 'border-[var(--selector-border-checked)] bg-[var(--selector-bg)] text-carbon'
                          : 'border-[var(--card-border)] bg-[var(--panel)] text-muted-strong'
                      }`}
                      disabled={!groupMemberCount}
                      onclick={() => toggleAutoWakeGroup(group.id)}
                    >
                      <span
                        class={`inline-grid h-3.5 w-3.5 flex-none place-items-center rounded-[0.24rem] border ${
                          autoWakeGroupIds().includes(group.id)
                            ? 'border-[var(--color-carbon)] bg-[var(--color-carbon)] text-[var(--color-snow)]'
                            : 'border-[var(--line-strong)] bg-[var(--color-fog)] text-transparent'
                        }`}
                        aria-hidden="true"
                      >
                        {#if autoWakeGroupIds().includes(group.id)}
                          <span class="i-lucide-check h-2.5 w-2.5"></span>
                        {/if}
                      </span>
                      <span>{group.name}</span>
                      <span class="text-faint">{groupMemberCount}</span>
                    </button>
                  {/each}
                </div>
              </div>

              <div class="grid gap-1.5">
                <div class="flex items-center justify-between gap-2">
                  <span class="text-[11px] font-medium text-muted-strong">
                    {copy.autoWakeTargetAccounts}
                  </span>
                  <span class="text-[10px] text-faint">
                    {copy.autoWakeTargetSearchResult(
                      autoWakeVisibleAccounts.length,
                      accounts.length
                    )}
                  </span>
                </div>
                <AppInput
                  variant="search"
                  type="search"
                  icon="i-lucide-search"
                  bind:value={autoWakeAccountSearchDraft}
                  placeholder={copy.autoWakeTargetSearchPlaceholder}
                  ariaLabel={copy.autoWakeTargetSearchAria}
                />
                <div class="grid max-h-32 gap-1 overflow-auto pr-1 sm:grid-cols-2 md:grid-cols-3">
                  {#if autoWakeVisibleAccounts.length}
                    {#each autoWakeVisibleAccounts as account (account.id)}
                      {@const groupNames = accountGroupNames(account)}
                      <label
                        class={`flex min-w-0 cursor-pointer items-center gap-1.5 rounded-[0.35rem] border px-2 py-1.5 text-left transition-colors ${
                          autoWakeAccountIds().includes(account.id)
                            ? 'border-[var(--selector-border-checked)] bg-[var(--selector-bg)]'
                            : 'border-[var(--card-border)] bg-[var(--panel)]'
                        }`}
                      >
                        <Checkbox
                          checked={autoWakeAccountIds().includes(account.id)}
                          ariaLabel={accountEmail(account, copy)}
                          onCheckedChange={(checked) => toggleAutoWakeAccount(account.id, checked)}
                        />
                        <span class="grid min-w-0 gap-0.5">
                          <span class="truncate text-[11px] font-medium leading-4 text-carbon">
                            {accountEmail(account, copy)}
                          </span>
                          <span class="truncate text-[9px] leading-3 text-faint">
                            {groupNames.length
                              ? groupNames.join(' · ')
                              : copy.autoWakeTargetUngrouped}
                          </span>
                        </span>
                      </label>
                    {/each}
                  {:else}
                    <div
                      class="rounded-[0.4rem] border border-dashed border-[var(--card-border)] px-3 py-4 text-center text-[11px] text-muted-strong sm:col-span-2 md:col-span-3"
                    >
                      {copy.autoWakeTargetSearchEmpty}
                    </div>
                  {/if}
                </div>
              </div>
            </div>
          {/if}
        </div>

        <div class="grid gap-2 md:grid-cols-3">
          <label class="grid gap-1 text-[11px] font-medium text-muted-strong">
            <span>{copy.autoWakeFirstWindowRemainingThreshold}</span>
            <AppInput
              type="number"
              value={String(settings.autoWakeFirstWindowRemainingThresholdPercent ?? 96)}
              onblur={(event) =>
                updateAutoWakeNumber(
                  'autoWakeFirstWindowRemainingThresholdPercent',
                  (event.currentTarget as HTMLInputElement).value
                )}
            />
          </label>
          <label class="grid gap-1 text-[11px] font-medium text-muted-strong">
            <span>{copy.autoWakeResetTolerance}</span>
            <AppInput
              type="number"
              value={String(settings.autoWakeResetToleranceMinutes ?? 5)}
              onblur={(event) =>
                updateAutoWakeNumber(
                  'autoWakeResetToleranceMinutes',
                  (event.currentTarget as HTMLInputElement).value
                )}
            />
          </label>
          <label class="grid gap-1 text-[11px] font-medium text-muted-strong">
            <span>{copy.autoWakeCooldownRatio}</span>
            <AppInput
              type="number"
              value={String(settings.autoWakeCooldownWindowRatio ?? 0.1)}
              onblur={(event) =>
                updateAutoWakeNumber(
                  'autoWakeCooldownWindowRatio',
                  (event.currentTarget as HTMLInputElement).value
                )}
            />
          </label>
        </div>
      </div>
    </div>
  </section>

  {#if showCodexDesktopExecutablePath}
    <section
      class="settings-section theme-soft-panel rounded-[0.55rem] border border-[var(--card-border)] px-4 py-4"
    >
      <div class="flex items-center gap-3 mb-4">
        <div
          class="settings-section-icon flex h-7 w-7 flex-none items-center justify-center rounded-[0.4rem] border"
        >
          <span class="i-lucide-terminal h-4 w-4" aria-hidden="true"></span>
        </div>
        <div class="min-w-0">
          <p class="text-[13px] font-semibold text-carbon">{copy.codexDesktopExecutablePath}</p>
        </div>
        <AppButton
          variant="secondary"
          size="xs"
          class="ml-auto"
          onclick={() => {
            showPathEditor = !showPathEditor
          }}
        >
          {showPathEditor
            ? copy.hideCodexDesktopExecutablePath
            : copy.showCodexDesktopExecutablePath}
        </AppButton>
      </div>

      {#if showPathEditor}
        <div class="settings-row flex items-center gap-3 rounded-[0.45rem] border px-3 py-2.5">
          <AppInput
            class="min-w-0 flex-1"
            size="sm"
            bind:value={codexDesktopExecutablePathDraft}
            placeholder={copy.codexDesktopExecutablePlaceholder}
            onblur={() => void updateCodexDesktopExecutablePath(codexDesktopExecutablePathDraft)}
            onkeydown={(event) => {
              if (event.key === 'Enter') {
                void updateCodexDesktopExecutablePath(codexDesktopExecutablePathDraft)
              }
            }}
          />
        </div>
      {/if}
    </section>
  {/if}

  <section
    class="settings-section theme-soft-panel rounded-[0.55rem] border border-[var(--card-border)] px-4 py-4"
  >
    <div class="flex items-center gap-3 mb-4">
      <div
        class="settings-section-icon flex h-7 w-7 flex-none items-center justify-center rounded-[0.4rem] border"
      >
        <span class="i-lucide-download h-4 w-4" aria-hidden="true"></span>
      </div>
      <div class="min-w-0">
        <p class="text-[13px] font-semibold text-carbon">{copy.checkUpdates}</p>
        {#if updateStatus()}
          <p class="mt-0.5 text-[10px] leading-4 text-muted-strong">{updateStatus()}</p>
        {/if}
      </div>
    </div>

    <div
      class="settings-row flex flex-wrap items-center gap-3 rounded-[0.45rem] border px-3 py-2.5"
    >
      <span class="text-xs text-muted-strong">v{appMeta.version}</span>
      <AppButton
        variant="secondary"
        size="xs"
        onclick={runUpdateAction}
        disabled={updateActionDisabled()}
      >
        {#if updateState.status === 'checking' || updateState.status === 'downloading'}
          <span class="i-lucide-loader-circle h-3.5 w-3.5 animate-spin"></span>
        {/if}
        <span>{updateActionLabel()}</span>
      </AppButton>
    </div>
  </section>
</div>

<style>
  .settings-container {
    scrollbar-width: thin;
    scrollbar-color: color-mix(in srgb, var(--ink-faint) 46%, transparent) transparent;
  }

  .settings-section-icon {
    border-color: color-mix(in srgb, var(--line-strong) 76%, transparent);
    background: color-mix(in srgb, var(--surface-soft) 72%, transparent);
    color: var(--ink-soft-strong);
    box-shadow: 0 1px 0 color-mix(in srgb, var(--edge-light) 58%, transparent) inset;
  }

  .settings-row {
    border-color: color-mix(in srgb, var(--line-strong) 68%, transparent);
    background: color-mix(in srgb, var(--panel-strong) 84%, var(--surface-soft));
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, var(--edge-light) 44%, transparent),
      0 1px 0 color-mix(in srgb, var(--edge-dark) 12%, transparent);
  }
</style>
