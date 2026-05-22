<script lang="ts">
  import type {
    AccountGroup,
    AccountHealth,
    AccountRateLimits,
    AccountSummary,
    AccountWakeState,
    AppSettings,
    AutoWakeDecision
  } from '../../../shared/codex'
  import {
    canAutoWakeAccount,
    defaultWakeModel,
    isAccountHealthBlocking
  } from '../../../shared/codex'
  import { accountEmail, type LocalizedCopy } from '$lib/view/app-view'
  import AppButton from '$lib/ui/AppButton.svelte'
  import AppDialog from '$lib/ui/AppDialog.svelte'
  import AppInput from '$lib/ui/AppInput.svelte'
  import Checkbox from '$lib/ui/Checkbox.svelte'

  type WakeAllSubmitOptions = {
    forceWake: boolean
    selectedCount: number
  }

  export let copy: LocalizedCopy
  export let accounts: AccountSummary[] = []
  export let groups: AccountGroup[] = []
  export let rateLimitsByAccountId: Record<string, AccountRateLimits> = {}
  export let wakeStateByAccountId: Record<string, AccountWakeState> = {}
  export let accountHealthByAccountId: Record<string, AccountHealth> = {}
  export let settings: AppSettings | undefined = undefined
  export let prompt = 'ping'
  export let model = defaultWakeModel
  export let logs: string[] = []
  export let awakenedLabels: string[] = []
  export let error = ''
  export let running = false
  export let onClose: () => void = () => {}
  export let onSubmitAll: (
    accountIds: string[],
    options: WakeAllSubmitOptions
  ) => void | Promise<void> = () => {}

  type WakeDetectionItem = {
    account: AccountSummary
    decision: AutoWakeDecision
    groupNames: string[]
  }

  let logPanel: HTMLPreElement | null = null
  let accountSelectionKey = ''
  let selectedAccountIds: string[] = []
  let accountSearchDraft = ''
  let showSmartDetectionDialog = false
  let forceWake = false

  const groupMemberIds = (groupId: string): string[] =>
    accounts.filter((account) => account.groupIds.includes(groupId)).map((account) => account.id)

  const accountGroupNames = (account: AccountSummary, sourceGroups = groups): string[] =>
    account.groupIds
      .map((groupId) => sourceGroups.find((group) => group.id === groupId)?.name)
      .filter((name): name is string => Boolean(name))

  const ungroupedMemberIds = (
    sourceAccounts: AccountSummary[],
    sourceGroups: AccountGroup[]
  ): string[] =>
    sourceAccounts
      .filter((account) => !accountGroupNames(account, sourceGroups).length)
      .map((account) => account.id)

  const normalizeSearch = (value: string): string => value.trim().toLowerCase()

  const accountMatchesSearch = (
    account: AccountSummary,
    sourceGroups: AccountGroup[],
    sourceCopy: LocalizedCopy,
    query: string
  ): boolean => {
    const normalizedQuery = normalizeSearch(query)
    if (!normalizedQuery) {
      return true
    }

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

    return searchableText.includes(normalizedQuery)
  }

  const filterAccountsBySearch = (
    sourceAccounts: AccountSummary[],
    sourceGroups: AccountGroup[],
    sourceCopy: LocalizedCopy,
    query: string
  ): AccountSummary[] =>
    sourceAccounts.filter((account) =>
      accountMatchesSearch(account, sourceGroups, sourceCopy, query)
    )

  const accountWakeDecision = (
    account: AccountSummary,
    sourceRateLimitsByAccountId: Record<string, AccountRateLimits>,
    sourceWakeStateByAccountId: Record<string, AccountWakeState>,
    sourceAccountHealthByAccountId: Record<string, AccountHealth>,
    sourceSettings?: AppSettings
  ): AutoWakeDecision => {
    if (isAccountHealthBlocking(sourceAccountHealthByAccountId[account.id])) {
      return { canWake: false, reason: 'account_health_blocked' }
    }

    return canAutoWakeAccount(
      sourceRateLimitsByAccountId[account.id],
      sourceWakeStateByAccountId[account.id],
      sourceSettings
    )
  }

  const smartDetectedAccountIds = (
    sourceAccounts: AccountSummary[],
    sourceRateLimitsByAccountId: Record<string, AccountRateLimits>,
    sourceWakeStateByAccountId: Record<string, AccountWakeState>,
    sourceAccountHealthByAccountId: Record<string, AccountHealth>,
    sourceSettings?: AppSettings
  ): string[] =>
    sourceAccounts
      .filter(
        (account) =>
          accountWakeDecision(
            account,
            sourceRateLimitsByAccountId,
            sourceWakeStateByAccountId,
            sourceAccountHealthByAccountId,
            sourceSettings
          ).canWake
      )
      .map((account) => account.id)

  const toggleAccount = (accountId: string, checked: boolean): void => {
    selectedAccountIds = accounts
      .map((account) => account.id)
      .filter((id) =>
        checked
          ? id === accountId || selectedAccountIds.includes(id)
          : id !== accountId && selectedAccountIds.includes(id)
      )
  }

  const toggleMemberIds = (memberIds: string[]): void => {
    if (!memberIds.length) {
      return
    }

    const fullySelected = memberIds.every((accountId) => selectedAccountIds.includes(accountId))
    selectedAccountIds = accounts
      .map((account) => account.id)
      .filter((id) => (memberIds.includes(id) ? !fullySelected : selectedAccountIds.includes(id)))
  }

  const toggleGroup = (groupId: string): void => {
    toggleMemberIds(groupMemberIds(groupId))
  }

  const toggleUngrouped = (): void => {
    toggleMemberIds(ungroupedMemberIds(accounts, groups))
  }

  const selectAllAccounts = (): void => {
    selectedAccountIds = accounts.map((account) => account.id)
  }

  const clearSelectedAccounts = (): void => {
    selectedAccountIds = []
  }

  const submitWake = (): void => {
    if (running || !selectedAccountIds.length) {
      return
    }

    void onSubmitAll(forceWake ? selectedAccountIds : selectedSmartEligibleAccountIds, {
      forceWake,
      selectedCount: selectedAccountCount
    })
  }

  $: detectedAccountIds = smartDetectedAccountIds(
    accounts,
    rateLimitsByAccountId,
    wakeStateByAccountId,
    accountHealthByAccountId,
    settings
  )
  $: selectedSmartEligibleAccountIds = accounts
    .map((account) => account.id)
    .filter(
      (accountId) =>
        selectedAccountIds.includes(accountId) && detectedAccountIds.includes(accountId)
    )
  $: smartDetectionItems = accounts.map(
    (account): WakeDetectionItem => ({
      account,
      decision: accountWakeDecision(
        account,
        rateLimitsByAccountId,
        wakeStateByAccountId,
        accountHealthByAccountId,
        settings
      ),
      groupNames: accountGroupNames(account)
    })
  )
  $: smartEligibleItems = smartDetectionItems.filter((item) => item.decision.canWake)
  $: smartIneligibleItems = smartDetectionItems.filter((item) => !item.decision.canWake)

  $: {
    const nextAccountSelectionKey = [
      accounts.map((account) => account.id).join('\u0000'),
      detectedAccountIds.join('\u0000')
    ].join('\u0001')
    if (nextAccountSelectionKey !== accountSelectionKey) {
      const validIds = accounts.map((account) => account.id)
      selectedAccountIds = accountSelectionKey
        ? selectedAccountIds.filter((accountId) => validIds.includes(accountId))
        : detectedAccountIds
      accountSelectionKey = nextAccountSelectionKey
    }
  }

  $: selectedAccounts = accounts.filter((account) => selectedAccountIds.includes(account.id))
  $: selectedAccountCount = selectedAccounts.length
  $: visibleAccounts = filterAccountsBySearch(accounts, groups, copy, accountSearchDraft)
  $: ungroupedIds = ungroupedMemberIds(accounts, groups)
  $: selectedUngroupedCount = ungroupedIds.filter((accountId) =>
    selectedAccountIds.includes(accountId)
  ).length

  $: if (logs.length) {
    queueMicrotask(() => {
      logPanel?.scrollTo({ top: logPanel.scrollHeight })
    })
  }
</script>

<AppDialog
  ariaLabelledby="wake-all-dialog-title"
  maxWidthClass="max-w-3xl"
  panelClass="wake-all-dialog-panel flex w-full flex-col overflow-hidden rounded-[0.65rem] p-4 md:p-5"
  footerClass="wake-all-dialog-footer border-t border-[var(--card-border)] pt-3"
  zIndexClass="z-50"
  closeOnBackdrop={false}
  closeDisabled={running}
  scrollable
  onclose={() => {
    if (!running) onClose()
  }}
>
  <div class="grid gap-3">
    <div class="grid gap-1">
      <p id="wake-all-dialog-title" class="text-base font-semibold tracking-[-0.015em] text-carbon">
        {copy.wakeAllDialogTitle}
      </p>
      <p class="text-xs leading-5 text-muted-strong">
        {copy.wakeAllDialogDescription(accounts.length)}
      </p>
    </div>

    <div
      class="grid gap-2.5 rounded-[0.5rem] border border-[var(--card-border)] bg-[var(--surface-soft)] p-2.5"
    >
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div class="grid gap-1">
          <p class="text-xs font-semibold text-carbon">{copy.wakeAllTargetTitle}</p>
          <p class="text-[11px] leading-4 text-muted-strong">{copy.wakeAllTargetDescription}</p>
        </div>
        <div class="flex flex-wrap items-center gap-1.5">
          <span class="theme-version-pill rounded-md px-2 py-0.5 text-[10px] text-muted-strong">
            {copy.wakeAllSelectedTargetCount(selectedAccountCount, accounts.length)}
          </span>
          <AppButton
            variant="secondary"
            size="xs"
            onclick={() => {
              showSmartDetectionDialog = true
            }}
            disabled={running}
          >
            {copy.wakeAllViewSmartAccounts}
          </AppButton>
          <AppButton
            variant="secondary"
            size="xs"
            onclick={selectAllAccounts}
            disabled={running || selectedAccountCount === accounts.length}
          >
            {copy.wakeAllSelectAll}
          </AppButton>
          <AppButton
            variant="secondary"
            size="xs"
            onclick={clearSelectedAccounts}
            disabled={running || selectedAccountCount === 0}
          >
            {copy.wakeAllClearSelection}
          </AppButton>
        </div>
      </div>

      {#if groups.length || ungroupedIds.length}
        <div class="grid gap-1.5">
          <span class="text-[11px] font-medium text-muted-strong">{copy.wakeAllGroupTargets}</span>
          <div class="flex max-h-20 flex-wrap gap-1 overflow-auto pr-1">
            {#if ungroupedIds.length}
              <button
                type="button"
                class={`inline-flex items-center gap-1 rounded-[0.32rem] border px-1.5 py-0.5 text-[10px] transition-colors ${
                  selectedUngroupedCount
                    ? 'border-[var(--selector-border-checked)] bg-[var(--selector-bg)] text-carbon'
                    : 'border-[var(--card-border)] bg-[var(--panel)] text-muted-strong'
                }`}
                disabled={running}
                onclick={toggleUngrouped}
              >
                <span
                  class={`inline-grid h-3.5 w-3.5 flex-none place-items-center rounded-[0.24rem] border ${
                    selectedUngroupedCount
                      ? 'border-[var(--color-carbon)] bg-[var(--color-carbon)] text-[var(--color-snow)]'
                      : 'border-[var(--line-strong)] bg-[var(--color-fog)] text-transparent'
                  }`}
                  aria-hidden="true"
                >
                  {#if selectedUngroupedCount === ungroupedIds.length}
                    <span class="i-lucide-check h-2.5 w-2.5"></span>
                  {:else if selectedUngroupedCount > 0}
                    <span class="h-1.5 w-1.5 rounded-full bg-current"></span>
                  {/if}
                </span>
                <span class="font-medium">{copy.wakeAllUngroupedAccount}</span>
                <span class="text-faint">
                  {copy.wakeAllGroupMemberCount(selectedUngroupedCount, ungroupedIds.length)}
                </span>
              </button>
            {/if}
            {#each groups as group (group.id)}
              {@const memberIds = groupMemberIds(group.id)}
              {@const selectedMembers = memberIds.filter((accountId) =>
                selectedAccountIds.includes(accountId)
              ).length}
              <button
                type="button"
                class={`inline-flex items-center gap-1 rounded-[0.32rem] border px-1.5 py-0.5 text-[10px] transition-colors ${
                  selectedMembers
                    ? 'border-[var(--selector-border-checked)] bg-[var(--selector-bg)] text-carbon'
                    : 'border-[var(--card-border)] bg-[var(--panel)] text-muted-strong'
                }`}
                disabled={running || !memberIds.length}
                onclick={() => toggleGroup(group.id)}
              >
                <span
                  class={`inline-grid h-3.5 w-3.5 flex-none place-items-center rounded-[0.24rem] border ${
                    selectedMembers
                      ? 'border-[var(--color-carbon)] bg-[var(--color-carbon)] text-[var(--color-snow)]'
                      : 'border-[var(--line-strong)] bg-[var(--color-fog)] text-transparent'
                  }`}
                  aria-hidden="true"
                >
                  {#if memberIds.length > 0 && selectedMembers === memberIds.length}
                    <span class="i-lucide-check h-2.5 w-2.5"></span>
                  {:else if selectedMembers > 0}
                    <span class="h-1.5 w-1.5 rounded-full bg-current"></span>
                  {/if}
                </span>
                <span class="font-medium">{group.name}</span>
                <span class="text-faint">
                  {copy.wakeAllGroupMemberCount(selectedMembers, memberIds.length)}
                </span>
              </button>
            {/each}
          </div>
        </div>
      {/if}

      <label
        class={`flex items-start gap-2 rounded-[0.45rem] border border-[var(--card-border)] bg-[var(--panel)] px-3 py-2.5 ${
          running ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
        }`}
      >
        <Checkbox
          checked={forceWake}
          disabled={running}
          ariaLabel={copy.wakeAllForceLabel}
          onCheckedChange={(checked) => {
            forceWake = checked
          }}
        />
        <span class="grid min-w-0 gap-1">
          <span class="flex flex-wrap items-center gap-2">
            <span class="text-xs font-semibold text-carbon">{copy.wakeAllForceLabel}</span>
            <span class="theme-version-pill rounded-md px-2 py-0.5 text-[10px] text-muted-strong">
              {copy.wakeAllSubmitTargetCount(
                forceWake ? selectedAccountCount : selectedSmartEligibleAccountIds.length,
                selectedAccountCount
              )}
            </span>
          </span>
          <span class="text-[11px] leading-4 text-muted-strong">
            {copy.wakeAllForceDescription}
          </span>
        </span>
      </label>

      <div class="grid gap-1.5">
        <div class="flex items-center justify-between gap-2">
          <span class="text-[11px] font-medium text-muted-strong">
            {copy.wakeAllAccountTargets}
          </span>
          <span class="text-[10px] text-faint">
            {copy.wakeAllAccountSearchResult(visibleAccounts.length, accounts.length)}
          </span>
        </div>
        <div class="relative">
          <AppInput
            class="w-full"
            inputClass={accountSearchDraft ? 'pr-7' : ''}
            variant="search"
            type="search"
            icon="i-lucide-search"
            bind:value={accountSearchDraft}
            placeholder={copy.wakeAllAccountSearchPlaceholder}
            ariaLabel={copy.wakeAllAccountSearchAria}
            disabled={running}
          />
          {#if accountSearchDraft}
            <button
              type="button"
              class="absolute right-2 top-1/2 inline-grid h-5 w-5 -translate-y-1/2 place-items-center rounded-full text-muted-strong transition-colors hover:bg-[var(--surface-hover)] hover:text-carbon"
              aria-label={copy.wakeAllAccountSearchClear}
              disabled={running}
              onclick={() => {
                accountSearchDraft = ''
              }}
            >
              <span class="i-lucide-x h-3.5 w-3.5"></span>
            </button>
          {/if}
        </div>
        <div class="grid max-h-36 gap-1 overflow-auto pr-1 sm:grid-cols-2 md:grid-cols-3">
          {#if visibleAccounts.length}
            {#each visibleAccounts as account (account.id)}
              {@const groupNames = accountGroupNames(account)}
              {@const decision = accountWakeDecision(
                account,
                rateLimitsByAccountId,
                wakeStateByAccountId,
                accountHealthByAccountId,
                settings
              )}
              <label
                class={`flex min-w-0 cursor-pointer items-center gap-1.5 rounded-[0.35rem] border px-2 py-1.5 text-left transition-colors ${
                  selectedAccountIds.includes(account.id)
                    ? 'border-[var(--selector-border-checked)] bg-[var(--selector-bg)]'
                    : 'border-[var(--card-border)] bg-[var(--panel)]'
                } ${running ? 'cursor-not-allowed opacity-60' : ''}`}
              >
                <Checkbox
                  checked={selectedAccountIds.includes(account.id)}
                  disabled={running}
                  ariaLabel={accountEmail(account, copy)}
                  onCheckedChange={(checked) => toggleAccount(account.id, checked)}
                />
                <span class="grid min-w-0 gap-0.5">
                  <span class="flex min-w-0 items-center gap-1">
                    <span class="truncate text-[11px] font-medium leading-4 text-carbon">
                      {accountEmail(account, copy)}
                    </span>
                    <span
                      class={`wake-smart-badge flex-none rounded-full px-1.5 py-0.5 text-[9px] font-semibold leading-none ${
                        decision.canWake ? 'wake-smart-badge-success' : 'wake-smart-badge-skipped'
                      }`}
                    >
                      {decision.canWake
                        ? copy.wakeAllSmartDetectedEligible
                        : copy.wakeAllSmartDetectedIneligible}
                    </span>
                  </span>
                  {#if groupNames.length}
                    <span class="truncate text-[9px] leading-3 text-faint">
                      {groupNames.join(' · ')}
                    </span>
                  {:else}
                    <span class="text-[9px] leading-3 text-faint">
                      {copy.wakeAllUngroupedAccount}
                    </span>
                  {/if}
                </span>
              </label>
            {/each}
          {:else}
            <div
              class="rounded-[0.4rem] border border-dashed border-[var(--card-border)] px-3 py-4 text-center text-[11px] text-muted-strong sm:col-span-2"
            >
              {copy.wakeAllAccountSearchEmpty}
            </div>
          {/if}
        </div>
      </div>
    </div>

    <div class="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(12rem,0.55fr)]">
      <label class="grid gap-1.5">
        <span class="text-xs font-medium text-muted-strong">{copy.wakeQuotaPromptLabel}</span>
        <AppInput
          multiline
          class="min-h-16"
          bind:value={prompt}
          placeholder={copy.wakeQuotaPromptPlaceholder}
          disabled={running}
        />
      </label>
      <label class="grid content-start gap-1.5">
        <span class="text-xs font-medium text-muted-strong">{copy.wakeQuotaModelLabel}</span>
        <AppInput
          bind:value={model}
          placeholder={copy.wakeQuotaModelPlaceholder}
          disabled={running}
        />
      </label>
    </div>

    {#if error}
      <div
        class="theme-error-panel rounded-[0.4rem] border border-danger/18 bg-danger/8 px-3 py-2 text-sm font-medium text-danger"
        role="alert"
      >
        {error}
      </div>
    {/if}

    <div class="grid gap-2">
      <div class="flex items-center justify-between gap-3">
        <span class="text-xs font-medium text-muted-strong">{copy.wakeQuotaLogTitle}</span>
        <span class="theme-version-pill rounded-md px-2 py-0.5 text-[10px] text-muted-strong">
          {copy.selectedAccountCount(selectedAccountCount)}
        </span>
      </div>
      <pre
        bind:this={logPanel}
        class="theme-code-surface wake-all-log-panel min-h-32 max-h-56 overflow-auto rounded-[0.4rem] border border-[var(--card-border)] bg-transparent px-3.5 py-3 text-[13px] leading-relaxed text-carbon"><code
          >{logs.length ? logs.join('\n') : copy.wakeQuotaLogEmpty}</code
        ></pre>
    </div>

    {#if awakenedLabels.length}
      <div
        class="grid gap-2 rounded-[0.45rem] border border-[var(--card-border)] bg-[var(--surface-soft)] px-3 py-2.5"
      >
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs font-semibold text-carbon">{copy.wakeAllAwakenedAccounts}</span>
          <span class="theme-version-pill rounded-md px-2 py-0.5 text-[10px] text-muted-strong">
            {copy.selectedAccountCount(awakenedLabels.length)}
          </span>
        </div>
        <div class="flex flex-wrap gap-1.5">
          {#each awakenedLabels as label (label)}
            <span
              class="rounded-full border border-[var(--card-border)] bg-[var(--panel)] px-2 py-1 text-[11px] font-medium text-carbon"
            >
              {label}
            </span>
          {/each}
        </div>
      </div>
    {/if}
  </div>

  <svelte:fragment slot="footer">
    <AppButton variant="secondary" size="sm" onclick={onClose} disabled={running}>
      {copy.cancel}
    </AppButton>
    <AppButton
      variant="primary"
      size="sm"
      onclick={submitWake}
      disabled={running || !selectedAccountCount}
    >
      {#if running}
        <span class="i-lucide-loader-circle h-4 w-4 animate-spin"></span>
      {/if}
      <span>{forceWake ? copy.wakeAllForceSubmit : copy.wakeAllSmartWakeSelected}</span>
    </AppButton>
  </svelte:fragment>
</AppDialog>

{#if showSmartDetectionDialog}
  <AppDialog
    title={copy.wakeAllSmartPreviewTitle}
    description={copy.wakeAllSmartPreviewDescription(
      smartEligibleItems.length,
      smartIneligibleItems.length,
      accounts.length
    )}
    closeLabel={copy.close}
    showClose
    maxWidthClass="max-w-5xl"
    panelClass="wake-all-smart-preview-panel flex w-full flex-col overflow-hidden rounded-[0.65rem] p-4 md:p-5"
    zIndexClass="z-[80]"
    scrollable
    onclose={() => {
      showSmartDetectionDialog = false
    }}
  >
    <div class="grid items-start gap-3 lg:grid-cols-2">
      <section
        class="grid min-h-0 content-start gap-2 rounded-[0.5rem] border border-[var(--card-border)] bg-[var(--surface-soft)] p-3"
      >
        <div class="flex items-center justify-between gap-2">
          <span class="text-sm font-semibold text-carbon">
            {copy.wakeAllSmartPreviewIneligibleTitle}
          </span>
          <span class="theme-version-pill rounded-md px-2 py-0.5 text-[10px] text-muted-strong">
            {copy.selectedAccountCount(smartIneligibleItems.length)}
          </span>
        </div>

        {#if smartIneligibleItems.length}
          <div class="grid max-h-[56vh] auto-rows-max content-start gap-1.5 overflow-auto pr-1">
            {#each smartIneligibleItems as item (item.account.id)}
              <div
                class="grid self-start gap-1 rounded-[0.4rem] border border-[var(--card-border)] bg-[var(--panel)] px-2.5 py-2"
              >
                <div class="flex min-w-0 items-center justify-between gap-2">
                  <span class="truncate text-xs font-semibold text-carbon">
                    {accountEmail(item.account, copy)}
                  </span>
                  <span
                    class="wake-smart-badge wake-smart-badge-skipped flex-none rounded-full px-1.5 py-0.5 text-[9px] font-semibold leading-none"
                  >
                    {copy.wakeAllSmartDetectedIneligible}
                  </span>
                </div>
                <span class="text-[11px] leading-4 text-warning">
                  {copy.wakeAllSmartDecisionReason(item.decision.reason)}
                </span>
                {#if item.groupNames.length}
                  <span class="truncate text-[10px] leading-3 text-faint">
                    {item.groupNames.join(' · ')}
                  </span>
                {:else}
                  <span class="text-[10px] leading-3 text-faint">
                    {copy.wakeAllUngroupedAccount}
                  </span>
                {/if}
              </div>
            {/each}
          </div>
        {:else}
          <div
            class="rounded-[0.45rem] border border-dashed border-[var(--card-border)] px-3 py-8 text-center text-xs text-muted-strong"
          >
            {copy.wakeAllSmartPreviewIneligibleEmpty}
          </div>
        {/if}
      </section>

      <section
        class="grid min-h-0 content-start gap-2 rounded-[0.5rem] border border-[var(--card-border)] bg-[var(--surface-soft)] p-3"
      >
        <div class="flex items-center justify-between gap-2">
          <span class="text-sm font-semibold text-carbon">
            {copy.wakeAllSmartPreviewEligibleTitle}
          </span>
          <span class="theme-version-pill rounded-md px-2 py-0.5 text-[10px] text-muted-strong">
            {copy.selectedAccountCount(smartEligibleItems.length)}
          </span>
        </div>

        {#if smartEligibleItems.length}
          <div class="grid max-h-[56vh] auto-rows-max content-start gap-1.5 overflow-auto pr-1">
            {#each smartEligibleItems as item (item.account.id)}
              <div
                class="wake-smart-eligible-card grid self-start gap-1 rounded-[0.4rem] px-2.5 py-2"
              >
                <div class="flex min-w-0 items-center justify-between gap-2">
                  <span class="truncate text-xs font-semibold text-carbon">
                    {accountEmail(item.account, copy)}
                  </span>
                  <span
                    class="wake-smart-badge wake-smart-badge-success flex-none rounded-full px-1.5 py-0.5 text-[9px] font-semibold leading-none"
                  >
                    {copy.wakeAllSmartDetectedEligible}
                  </span>
                </div>
                {#if item.groupNames.length}
                  <span class="truncate text-[10px] leading-3 text-faint">
                    {item.groupNames.join(' · ')}
                  </span>
                {:else}
                  <span class="text-[10px] leading-3 text-faint">
                    {copy.wakeAllUngroupedAccount}
                  </span>
                {/if}
              </div>
            {/each}
          </div>
        {:else}
          <div
            class="rounded-[0.45rem] border border-dashed border-[var(--card-border)] px-3 py-8 text-center text-xs text-muted-strong"
          >
            {copy.wakeAllSmartPreviewEligibleEmpty}
          </div>
        {/if}
      </section>
    </div>

    <svelte:fragment slot="footer">
      <AppButton
        variant="secondary"
        size="sm"
        onclick={() => {
          showSmartDetectionDialog = false
        }}
      >
        {copy.close}
      </AppButton>
    </svelte:fragment>
  </AppDialog>
{/if}

<style>
  .wake-all-log-panel {
    font-family:
      'SFMono-Regular', 'SF Mono', ui-monospace, Menlo, Monaco, Consolas, 'Liberation Mono',
      monospace;
  }

  .wake-all-dialog-panel :global(.theme-code-surface) {
    box-shadow: none !important;
    background: color-mix(in srgb, var(--panel-strong) 74%, var(--color-snow)) !important;
    color: var(--color-carbon) !important;
  }

  .wake-smart-badge {
    min-width: 2.5rem;
    border: 1px solid transparent;
    text-align: center;
    white-space: nowrap;
  }

  .wake-smart-badge-success {
    border-color: color-mix(in srgb, var(--status-success-color) 22%, transparent);
    background: var(--status-success-bg);
    color: var(--status-success-color);
  }

  .wake-smart-badge-skipped {
    border-color: color-mix(in srgb, var(--status-skipped-color) 22%, transparent);
    background: var(--status-skipped-bg);
    color: var(--status-skipped-color);
  }

  .wake-smart-eligible-card {
    border: 1px solid color-mix(in srgb, var(--status-success-color) 18%, var(--card-border));
    background: color-mix(in srgb, var(--status-success-bg) 82%, var(--panel));
  }
</style>
