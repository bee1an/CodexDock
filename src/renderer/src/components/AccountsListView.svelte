<script lang="ts">
  import { flip } from 'svelte/animate'
  import { onDestroy, onMount } from 'svelte'
  import { fly, slide } from 'svelte/transition'
  import {
    dragHandle,
    dragHandleZone,
    SHADOW_ITEM_MARKER_PROPERTY_NAME,
    SHADOW_PLACEHOLDER_ITEM_ID,
    type DndEvent as SortEvent
  } from 'svelte-dnd-action'

  import type {
    AccountRateLimits,
    AccountSummary,
    AccountGroup,
    AccountTokensDetail,
    AccountWakeSchedule,
    AppLanguage,
    LoginMethod,
    TagVisibilitySettings
  } from '../../../shared/codex'
  import {
    formatRelativeReset,
    isLocalMockAccount,
    remainingPercent,
    supportsWakeSessionQuota
  } from '../../../shared/codex'
  import {
    accountUsageBadge,
    accountEmail,
    accountSubscriptionBadge,
    accountTokenExpiryBadge,
    aggregateAccountQuotas,
    extraLimits,
    limitLabel,
    planLabel,
    planTagClass,
    progressWidth,
    weeklyResetTimeToneClass,
    type LocalizedCopy
  } from './app-view'
  import {
    accountGroupsForDisplay,
    availableGroupsForAccount,
    filterChipLabel,
    normalizeSelectedAccountIds,
    groupFilterLabel,
    ungroupedFilterId,
    visibleAccountsForFilter
  } from './accounts-panel-account'
  import { animateProgress } from './gsap-motion'
  import {
    eventTargetsFloatingRoot,
    floatingAnchor,
    portal,
    stopFloatingPointerPropagation
  } from './floating'
  import AppButton from './AppButton.svelte'
  import AccountDetailsPanel from './AccountDetailsPanel.svelte'
  import Checkbox from './Checkbox.svelte'
  import {
    formatWakeScheduleLastTriggeredAt,
    nextWakeScheduleLabel,
    wakeScheduleSummary as wakeScheduleSummaryText
  } from './wake-schedule'

  const flipDurationMs = 160

  export let copy: LocalizedCopy
  export let language: AppLanguage
  export let accounts: AccountSummary[] = []
  export let groups: AccountGroup[] = []
  export let activeAccountId: string | undefined
  export let usageByAccountId: Record<string, AccountRateLimits>
  export let usageLoadingByAccountId: Record<string, boolean>
  export let usageErrorByAccountId: Record<string, string>
  export let wakeSchedulesByAccountId: Record<string, AccountWakeSchedule>
  export let loginActionBusy: boolean
  export let loginStarting = false
  export let groupMutationBusy = false
  export let refreshingAllUsage = false
  export let bestAccount: AccountSummary | null = null
  export let startLogin: (method: LoginMethod) => void = () => {}
  export let importCurrent: () => void = () => {}
  export let importAccountsFile: () => void = () => {}
  export let importAccountsFromRaw: () => void = () => {}
  export let exportAccountsFile: () => void = () => {}
  export let refreshAllRateLimits: () => void = () => {}
  export let activateBestAccount: () => void = () => {}
  export let activeGroupFilter = 'all'
  export let selectedAccountIds: string[] = []
  export let accountWorkbenchExpanded = false
  export let openingAccountId = ''
  export let openingIsolatedAccountId = ''
  export let wakingAccountId = ''
  export let openAccountInCodex: (accountId: string) => void
  export let openAccountInIsolatedCodex: (accountId: string) => void
  export let openWakeDialog: (account: AccountSummary, initialTab?: 'session' | 'schedule') => void
  export let openEditTokensDialog: (account: AccountSummary) => void
  export let openRefreshTokensDialog: (account: AccountSummary) => void
  export let reorderAccounts: (accountIds: string[]) => Promise<void>
  export let updateAccountGroups: (account: AccountSummary, groupIds: string[]) => Promise<void>
  export let openGroupManager: () => void = () => {}
  export let refreshAccountUsage: (account: AccountSummary) => void
  export let removeAccount: (account: AccountSummary) => void
  export let removeAccounts: (accountIds: string[]) => Promise<void>
  export let exportSelectedAccounts: (accountIds: string[]) => Promise<void>
  export let getAccountTokens: (accountId: string) => Promise<AccountTokensDetail>
  export let tagVisibility: TagVisibilitySettings = {}
  export let updateTagVisibility: (settings: TagVisibilitySettings) => Promise<void> = async () => {}

  let expandedAccountIds: string[] = []
  let tokensByAccountId: Record<string, AccountTokensDetail> = {}
  let tokensLoadingAccountId = ''
  let tokensErrorByAccountId: Record<string, string> = {}
  let tokensLoadRequestId = 0

  async function loadTokensForAccount(accountId: string): Promise<void> {
    if (tokensLoadingAccountId === accountId) {
      return
    }

    tokensLoadingAccountId = accountId
    tokensErrorByAccountId = { ...tokensErrorByAccountId, [accountId]: '' }
    const requestId = ++tokensLoadRequestId

    try {
      const detail = await getAccountTokens(accountId)
      if (requestId !== tokensLoadRequestId) {
        return
      }
      tokensByAccountId = { ...tokensByAccountId, [accountId]: detail }
    } catch (error) {
      if (requestId !== tokensLoadRequestId) {
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      tokensErrorByAccountId = {
        ...tokensErrorByAccountId,
        [accountId]: copy.accountDetailsTokenLoadFailed(message)
      }
    } finally {
      if (tokensLoadingAccountId === accountId) {
        tokensLoadingAccountId = ''
      }
    }
  }

  function toggleAccountExpanded(accountId: string): void {
    if (expandedAccountIds.includes(accountId)) {
      expandedAccountIds = expandedAccountIds.filter((id) => id !== accountId)
      return
    }

    expandedAccountIds = [...expandedAccountIds, accountId]
    if (!tokensByAccountId[accountId]) {
      void loadTokensForAccount(accountId)
    }
  }

  $: if (accounts) {
    const accountIds = new Set(accounts.map((account) => account.id))
    const nextExpanded = expandedAccountIds.filter((id) => accountIds.has(id))
    if (nextExpanded.length !== expandedAccountIds.length) {
      expandedAccountIds = nextExpanded
    }
  }

  let accountActionMenuAccountId: string | null = null
  let accountActionMenuAnchorRect: DOMRect | null = null
  let accountGroupMenuAccountId = ''
  let accountGroupMenuAnchorRect: DOMRect | null = null
  let usageErrorPopoverAccountId: string | null = null
  let usageErrorPopoverAnchorRect: DOMRect | null = null
  let tagVisibilityMenuOpen = false
  let tagVisibilityMenuAnchorRect: DOMRect | null = null
  let sortableAccounts: AccountSummary[] = []
  let sortInteractionActive = false
  let sortDraggedAccountId = ''
  let removingSelection = false
  let removingGroupLink = ''
  let accountWorkbenchRendered = accountWorkbenchExpanded
  let accountWorkbenchPanelOpen = accountWorkbenchExpanded
  let lastAccountWorkbenchExpanded = accountWorkbenchExpanded
  let accountWorkbenchCloseTimer: number | null = null
  let accountWorkbenchOpenFrame: number | null = null

  $: if (
    activeGroupFilter !== 'all' &&
    activeGroupFilter !== ungroupedFilterId &&
    !groups.some((group) => group.id === activeGroupFilter)
  ) {
    activeGroupFilter = 'all'
  }

  $: visibleAccounts = visibleAccountsForFilter(accounts, activeGroupFilter)
  $: quotaSummary = aggregateAccountQuotas(visibleAccounts, usageByAccountId)

  $: {
    const nextSelectedAccountIds = normalizeSelectedAccountIds(selectedAccountIds, visibleAccounts)
    if (nextSelectedAccountIds.length !== selectedAccountIds.length) {
      selectedAccountIds = nextSelectedAccountIds
    }
  }

  $: if (!sortInteractionActive) {
    sortableAccounts = visibleAccounts
  }

  $: if (accountWorkbenchExpanded !== lastAccountWorkbenchExpanded) {
    lastAccountWorkbenchExpanded = accountWorkbenchExpanded
    if (accountWorkbenchExpanded) {
      openAccountWorkbenchPanel()
    } else {
      closeAccountWorkbenchPanel()
    }
  }

  $: selectedVisibleCount = selectedAccountIds.length
  $: allVisibleSelected =
    visibleAccounts.length > 0 && selectedVisibleCount === visibleAccounts.length
  $: showAccountFilterTools = accounts.length > 0 || groups.length > 0
  $: showAccountSelectionTools = visibleAccounts.length > 0 || selectedVisibleCount > 0
  $: if (
    usageErrorPopoverAccountId &&
    !accounts.some((account) => account.id === usageErrorPopoverAccountId)
  ) {
    closeUsageErrorPopover()
  }

  function usageErrorLines(detail: string): string[] {
    const lines = detail
      .split(/\r?\n+/)
      .map((line) => line.trim())
      .filter(Boolean)

    return lines.length ? lines : [detail.trim()].filter(Boolean)
  }

  function usageErrorToneClass(kind: 'expired' | 'workspace' | 'error'): string {
    switch (kind) {
      case 'expired':
        return 'border-red-700/18 bg-red-700/8 text-red-700'
      case 'workspace':
        return 'border-orange-500/20 bg-orange-500/10 text-orange-700'
      case 'error':
      default:
        return 'border-amber-500/18 bg-amber-500/10 text-amber-700'
    }
  }

  function stopUsageErrorEvent(event: Event): void {
    event.stopPropagation()
  }

  function toggleUsageErrorPopover(event: MouseEvent, accountId: string): void {
    event.preventDefault()
    event.stopPropagation()

    if (usageErrorPopoverAccountId === accountId) {
      closeUsageErrorPopover()
      return
    }

    closeAccountActionMenu()
    closeAccountGroupMenu()
    usageErrorPopoverAccountId = accountId
    usageErrorPopoverAnchorRect =
      (event.currentTarget as HTMLElement | null)?.getBoundingClientRect() ?? null
  }

  function closeUsageErrorPopover(): void {
    usageErrorPopoverAccountId = null
    usageErrorPopoverAnchorRect = null
  }

  function toggleTagVisibilityMenu(event: MouseEvent): void {
    if (tagVisibilityMenuOpen) {
      closeTagVisibilityMenu()
      return
    }
    closeAccountActionMenu()
    closeAccountGroupMenu()
    closeUsageErrorPopover()
    tagVisibilityMenuAnchorRect =
      (event.currentTarget as HTMLElement | null)?.getBoundingClientRect() ?? null
    tagVisibilityMenuOpen = true
  }

  function closeTagVisibilityMenu(): void {
    tagVisibilityMenuOpen = false
    tagVisibilityMenuAnchorRect = null
  }

  function toggleTagSetting(key: keyof TagVisibilitySettings): void {
    const current = tagVisibility[key] !== false
    void updateTagVisibility({ ...tagVisibility, [key]: !current })
  }

  function showWakeAccount(accountId: string): boolean {
    const rateLimits = usageByAccountId[accountId]
    return !rateLimits || supportsWakeSessionQuota(rateLimits)
  }

  function hasEnabledWakeSchedule(accountId: string): boolean {
    const schedule = wakeSchedulesByAccountId[accountId]
    return Boolean(schedule?.enabled && schedule.times.length)
  }

  function wakeScheduleStatusLabel(status?: AccountWakeSchedule['lastStatus']): string {
    switch (status) {
      case 'success':
        return copy.wakeScheduleStatusSuccess
      case 'error':
        return copy.wakeScheduleStatusError
      case 'skipped':
        return copy.wakeScheduleStatusSkipped
      default:
        return copy.wakeScheduleStatusIdle
    }
  }

  function wakeScheduleTitle(accountId: string): string {
    const schedule = wakeSchedulesByAccountId[accountId]
    if (!schedule) {
      return copy.wakeSchedule
    }

    const lines = [
      `${copy.wakeSchedule} · ${wakeScheduleSummaryText(schedule, copy.wakeScheduleEmpty)}`,
      `${copy.wakeScheduleNextRun}: ${nextWakeScheduleLabel(schedule, language, copy.wakeScheduleEmpty)}`,
      `${copy.wakeScheduleLastRun}: ${formatWakeScheduleLastTriggeredAt(schedule.lastTriggeredAt, language, copy.wakeScheduleEmpty)}`,
      `${copy.wakeScheduleLastStatus}: ${wakeScheduleStatusLabel(schedule.lastStatus)}`
    ]

    if (schedule.lastMessage) {
      lines.push(`${copy.wakeScheduleLastMessage}: ${schedule.lastMessage}`)
    }

    return lines.join('\n')
  }

  function wakeScheduleSummary(accountId: string): string {
    const schedule = wakeSchedulesByAccountId[accountId]
    return wakeScheduleSummaryText(schedule, copy.wakeSchedule)
  }

  function isSortShadowAccount(account: AccountSummary): boolean {
    const sortableAccount = account as AccountSummary & Record<string, unknown>
    return (
      Boolean(sortableAccount[SHADOW_ITEM_MARKER_PROPERTY_NAME]) ||
      account.id === SHADOW_PLACEHOLDER_ITEM_ID
    )
  }

  function sortableAccountId(account: AccountSummary): string {
    return isSortShadowAccount(account) ? sortDraggedAccountId || account.id : account.id
  }

  function accountWithSortableId(account: AccountSummary): AccountSummary {
    const accountId = sortableAccountId(account)
    return account.id === accountId ? account : { ...account, id: accountId }
  }

  function selectAllVisibleAccounts(): void {
    selectedAccountIds = visibleAccounts.map((account) => account.id)
  }

  function clearSelectedAccounts(): void {
    selectedAccountIds = []
  }

  function setAccountSelected(accountId: string, selected: boolean): void {
    if (selected) {
      selectedAccountIds = selectedAccountIds.includes(accountId)
        ? selectedAccountIds
        : [...selectedAccountIds, accountId]
      return
    }

    selectedAccountIds = selectedAccountIds.filter(
      (selectedAccountId) => selectedAccountId !== accountId
    )
  }

  function panelCloseDurationMs(): number {
    if (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return 0
    }

    return (
      parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--panel-close-dur')
      ) || 350
    )
  }

  function clearAccountWorkbenchMotionTimers(): void {
    if (accountWorkbenchCloseTimer != null) {
      window.clearTimeout(accountWorkbenchCloseTimer)
      accountWorkbenchCloseTimer = null
    }
    if (accountWorkbenchOpenFrame != null) {
      window.cancelAnimationFrame(accountWorkbenchOpenFrame)
      accountWorkbenchOpenFrame = null
    }
  }

  function openAccountWorkbenchPanel(): void {
    clearAccountWorkbenchMotionTimers()
    accountWorkbenchRendered = true
    accountWorkbenchPanelOpen = false
    accountWorkbenchOpenFrame = window.requestAnimationFrame(() => {
      accountWorkbenchOpenFrame = null
      accountWorkbenchPanelOpen = true
    })
  }

  function closeAccountWorkbenchPanel(): void {
    if (!accountWorkbenchRendered) {
      accountWorkbenchPanelOpen = false
      return
    }

    clearAccountWorkbenchMotionTimers()
    accountWorkbenchPanelOpen = false
    accountWorkbenchCloseTimer = window.setTimeout(() => {
      accountWorkbenchCloseTimer = null
      accountWorkbenchRendered = false
    }, panelCloseDurationMs())
  }

  async function exportCurrentSelection(): Promise<void> {
    if (!selectedAccountIds.length || loginActionBusy) {
      return
    }

    await exportSelectedAccounts(selectedAccountIds)
  }

  async function exportSingleAccount(account: AccountSummary): Promise<void> {
    if (loginActionBusy) {
      return
    }

    closeAccountActionMenu()
    await exportSelectedAccounts([account.id])
  }

  async function removeCurrentSelection(): Promise<void> {
    if (!selectedAccountIds.length || loginActionBusy || removingSelection) {
      return
    }

    removingSelection = true
    try {
      await removeAccounts(selectedAccountIds)
      clearSelectedAccounts()
    } finally {
      removingSelection = false
    }
  }

  function accountActionBusy(accountId: string): boolean {
    return openingAccountId === accountId || openingIsolatedAccountId === accountId
  }

  function accountRowTone(account: AccountSummary): string {
    let tone = ''
    const accountId = sortableAccountId(account)

    if (selectedAccountIds.includes(accountId)) {
      tone += 'bg-[var(--surface-selected)]'
    } else if (activeAccountId === accountId) {
      tone += 'bg-transparent'
    } else {
      tone += 'bg-transparent'
    }

    return tone
  }

  function accountLaunchDisabled(account: AccountSummary): boolean {
    return (
      loginActionBusy ||
      accountActionBusy(sortableAccountId(account)) ||
      isLocalMockAccount(account)
    )
  }

  function accountRefreshDisabled(account: AccountSummary): boolean {
    const usageLoading = Boolean(usageLoadingByAccountId[sortableAccountId(account)])
    return loginActionBusy || usageLoading || isLocalMockAccount(account)
  }

  function wakeDialogDisabled(account: AccountSummary): boolean {
    const usageLoading = Boolean(usageLoadingByAccountId[sortableAccountId(account)])
    return loginActionBusy || Boolean(wakingAccountId) || usageLoading
  }

  function accountMoreActionsLabel(): string {
    return language === 'en' ? 'More actions' : '更多操作'
  }

  async function addGroupToAccount(account: AccountSummary, groupId: string): Promise<void> {
    await updateAccountGroups(account, [...account.groupIds, groupId])
    closeAccountActionMenu()
    closeAccountGroupMenu()
  }

  async function removeGroupFromAccount(account: AccountSummary, groupId: string): Promise<void> {
    const linkKey = `${sortableAccountId(account)}:${groupId}`
    if (removingGroupLink === linkKey) return
    removingGroupLink = linkKey
    try {
      await updateAccountGroups(
        account,
        account.groupIds.filter((id) => id !== groupId)
      )
    } finally {
      removingGroupLink = ''
    }
  }

  function toggleAccountActionMenu(event: MouseEvent, accountId: string): void {
    event.stopPropagation()

    if (accountActionMenuAccountId === accountId) {
      closeAccountActionMenu()
      return
    }

    const trigger = event.currentTarget as HTMLElement | null
    if (!trigger) {
      return
    }

    closeUsageErrorPopover()
    closeAccountGroupMenu()
    accountActionMenuAnchorRect = trigger.getBoundingClientRect()
    accountActionMenuAccountId = accountId
  }

  function closeAccountActionMenu(): void {
    accountActionMenuAccountId = null
    accountActionMenuAnchorRect = null
  }

  function closeAccountGroupMenu(): void {
    accountGroupMenuAccountId = ''
    accountGroupMenuAnchorRect = null
  }

  function openAccountGroupMenuFromActionMenu(accountId: string): void {
    if (!accountActionMenuAnchorRect) {
      return
    }

    accountGroupMenuAnchorRect = accountActionMenuAnchorRect
    accountGroupMenuAccountId = accountId
    closeAccountActionMenu()
  }

  function returnToAccountActionMenu(): void {
    if (!accountGroupMenuAnchorRect || !accountGroupMenuAccountId) {
      return
    }

    accountActionMenuAnchorRect = accountGroupMenuAnchorRect
    accountActionMenuAccountId = accountGroupMenuAccountId
    closeAccountGroupMenu()
  }

  function handleSortConsider(event: CustomEvent<SortEvent<AccountSummary>>): void {
    sortInteractionActive = true
    sortDraggedAccountId = event.detail.info.id
    sortableAccounts = event.detail.items
  }

  async function handleSortFinalize(event: CustomEvent<SortEvent<AccountSummary>>): Promise<void> {
    sortDraggedAccountId = event.detail.info.id
    sortableAccounts = event.detail.items

    if (activeGroupFilter !== 'all') {
      sortInteractionActive = false
      sortDraggedAccountId = ''
      return
    }

    try {
      await reorderAccounts(event.detail.items.map((account) => sortableAccountId(account)))
    } finally {
      sortInteractionActive = false
      sortDraggedAccountId = ''
    }
  }

  onMount(() => {
    const handlePointerDown = (event: PointerEvent): void => {
      if (!eventTargetsFloatingRoot(event)) {
        closeAccountActionMenu()
        closeAccountGroupMenu()
        closeUsageErrorPopover()
        closeTagVisibilityMenu()
      }
    }
    const handleScroll = (): void => {
      closeAccountActionMenu()
      closeAccountGroupMenu()
      closeUsageErrorPopover()
      closeTagVisibilityMenu()
    }

    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('scroll', handleScroll, true)

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('scroll', handleScroll, true)
    }
  })

  onDestroy(clearAccountWorkbenchMotionTimers)
</script>

<svelte:window
  onresize={() => {
    closeAccountActionMenu()
    closeAccountGroupMenu()
    closeUsageErrorPopover()
    closeTagVisibilityMenu()
  }}
/>

<div class="flex flex-none flex-wrap items-center gap-1.5 border-b border-black/8 px-4 py-2">
  <AppButton
    variant="secondary"
    size="xs"
    onclick={() => startLogin('browser')}
    disabled={loginActionBusy}
    ariaLabel={copy.callbackLogin}
    title={copy.callbackLogin}
  >
    <span class={`${loginStarting ? 'i-lucide-loader-circle animate-spin' : 'i-lucide-log-in'} h-3.5 w-3.5`}></span>
    <span>{copy.callbackLogin}</span>
  </AppButton>
  <AppButton
    variant="secondary"
    size="xs"
    onclick={() => startLogin('device')}
    disabled={loginActionBusy}
    ariaLabel={copy.deviceLogin}
    title={copy.deviceLogin}
  >
    <span class="i-lucide-key-round h-3.5 w-3.5"></span>
    <span>{copy.deviceLogin}</span>
  </AppButton>
  <AppButton
    variant="secondary"
    size="xs"
    onclick={importCurrent}
    disabled={loginActionBusy}
    ariaLabel={copy.importCurrent}
    title={copy.importCurrent}
  >
    <span class="i-lucide-monitor-down h-3.5 w-3.5"></span>
    <span>{copy.importCurrent}</span>
  </AppButton>
  <AppButton
    variant="icon"
    size="xs"
    onclick={importAccountsFile}
    disabled={loginActionBusy}
    ariaLabel={copy.importAccountsFile}
    title={copy.importAccountsFile}
  >
    <span class="i-lucide-file-up h-3.5 w-3.5"></span>
  </AppButton>
  <AppButton
    variant="icon"
    size="xs"
    onclick={importAccountsFromRaw}
    disabled={loginActionBusy}
    ariaLabel={copy.pasteSession}
    title={copy.pasteSession}
  >
    <span class="i-lucide-clipboard-paste h-3.5 w-3.5"></span>
  </AppButton>
  <AppButton
    variant="icon"
    size="xs"
    onclick={exportAccountsFile}
    disabled={loginActionBusy}
    ariaLabel={copy.exportAccountsFile}
    title={copy.exportAccountsFile}
  >
    <span class="i-lucide-file-down h-3.5 w-3.5"></span>
  </AppButton>

  <div class="ml-auto flex items-center gap-1.5">
    <div class="relative" use:stopFloatingPointerPropagation data-floating-root="">
      <AppButton
        variant="secondary"
        size="xs"
        onclick={toggleTagVisibilityMenu}
        ariaLabel={copy.tagVisibilityTitle}
        title={copy.tagVisibilityTitle}
      >
        <span class="i-lucide-eye h-3.5 w-3.5"></span>
      </AppButton>

      {#if tagVisibilityMenuOpen}
        <div
          use:portal
          use:floatingAnchor={{
            anchorRect: tagVisibilityMenuAnchorRect,
            minWidth: 180,
            matchAnchorWidth: false
          }}
          use:stopFloatingPointerPropagation
          data-floating-root=""
          transition:fly={{ y: -6, duration: 200 }}
          class="theme-tag-picker-surface z-[999] w-[200px] rounded-[1.1rem] p-1.5"
          style="background-color: var(--panel-strong); box-shadow: var(--elevation-2), 0 0 0 1px var(--line-strong);"
        >
          <div class="px-2.5 pb-1.5 pt-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--ink-faint)]">
            {copy.tagVisibilityTitle}
          </div>
          <button
            class="theme-tag-picker-item group flex w-full appearance-none items-center gap-2.5 rounded-[0.75rem] border-0 bg-transparent px-2.5 py-2 text-left text-[13px] font-medium text-carbon shadow-none outline-none transition-colors duration-140 hover:bg-[var(--surface-hover)] active:scale-[0.98]"
            type="button"
            onclick={() => toggleTagSetting('subscription')}
          >
            <Checkbox checked={tagVisibility.subscription !== false} />
            <span>{copy.tagVisibilitySubscription}</span>
          </button>
          <button
            class="theme-tag-picker-item group flex w-full appearance-none items-center gap-2.5 rounded-[0.75rem] border-0 bg-transparent px-2.5 py-2 text-left text-[13px] font-medium text-carbon shadow-none outline-none transition-colors duration-140 hover:bg-[var(--surface-hover)] active:scale-[0.98]"
            type="button"
            onclick={() => toggleTagSetting('tokenExpiry')}
          >
            <Checkbox checked={tagVisibility.tokenExpiry !== false} />
            <span>{copy.tagVisibilityTokenExpiry}</span>
          </button>
          <button
            class="theme-tag-picker-item group flex w-full appearance-none items-center gap-2.5 rounded-[0.75rem] border-0 bg-transparent px-2.5 py-2 text-left text-[13px] font-medium text-carbon shadow-none outline-none transition-colors duration-140 hover:bg-[var(--surface-hover)] active:scale-[0.98]"
            type="button"
            onclick={() => toggleTagSetting('wakeSchedule')}
          >
            <Checkbox checked={tagVisibility.wakeSchedule !== false} />
            <span>{copy.tagVisibilityWakeSchedule}</span>
          </button>
          <button
            class="theme-tag-picker-item group flex w-full appearance-none items-center gap-2.5 rounded-[0.75rem] border-0 bg-transparent px-2.5 py-2 text-left text-[13px] font-medium text-carbon shadow-none outline-none transition-colors duration-140 hover:bg-[var(--surface-hover)] active:scale-[0.98]"
            type="button"
            onclick={() => toggleTagSetting('groups')}
          >
            <Checkbox checked={tagVisibility.groups !== false} />
            <span>{copy.tagVisibilityGroups}</span>
          </button>
          <button
            class="theme-tag-picker-item group flex w-full appearance-none items-center gap-2.5 rounded-[0.75rem] border-0 bg-transparent px-2.5 py-2 text-left text-[13px] font-medium text-carbon shadow-none outline-none transition-colors duration-140 hover:bg-[var(--surface-hover)] active:scale-[0.98]"
            type="button"
            onclick={() => toggleTagSetting('quotaSummary')}
          >
            <Checkbox checked={tagVisibility.quotaSummary !== false} />
            <span>{copy.tagVisibilityQuotaSummary}</span>
          </button>
        </div>
      {/if}
    </div>
    <AppButton
      variant="secondary"
      size="xs"
      onclick={refreshAllRateLimits}
      disabled={loginActionBusy || refreshingAllUsage}
      ariaLabel={copy.refreshAllQuota}
      title={copy.refreshAllQuota}
    >
      <span class={`${refreshingAllUsage ? 'i-lucide-loader-circle animate-spin' : 'i-lucide-refresh-cw'} h-3.5 w-3.5`}></span>
    </AppButton>
    <AppButton
      variant="secondary"
      size="xs"
      onclick={activateBestAccount}
      disabled={loginActionBusy || !bestAccount || bestAccount.id === activeAccountId}
      ariaLabel={copy.switchBest}
      title={copy.switchBest}
    >
      <span class="i-lucide-sparkles h-3.5 w-3.5"></span>
    </AppButton>
  </div>
</div>

<div class="theme-workbench-toolbar border-b border-black/8 px-4 py-1.5">
  <button
    class="theme-workbench-toggle flex w-full items-center justify-between gap-3 rounded-[0.35rem] border-0 bg-transparent px-1.5 py-1 text-left transition-colors duration-140 hover:bg-black/[0.03]"
    type="button"
    aria-expanded={accountWorkbenchExpanded}
    aria-controls="account-workbench-panel"
    aria-label={accountWorkbenchExpanded
      ? copy.hideFiltersAndBulkActions
      : copy.showFiltersAndBulkActions}
    title={accountWorkbenchExpanded
      ? copy.hideFiltersAndBulkActions
      : copy.showFiltersAndBulkActions}
    onclick={() => {
      accountWorkbenchExpanded = !accountWorkbenchExpanded
    }}
  >
    <div class="min-w-0 flex flex-wrap items-center gap-2">
      <span class="i-lucide-sliders-horizontal h-3.5 w-3.5 flex-none text-muted-strong"></span>
      <span class="text-[10px] font-medium uppercase tracking-[0.12em] text-faint">
        {copy.filtersAndBulkActions}
      </span>
    </div>

    {#if !accountWorkbenchExpanded && (selectedVisibleCount || activeGroupFilter !== 'all')}
      <span
        class="theme-workbench-collapsed-summary ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1.5"
      >
        {#if selectedVisibleCount}
          <span
            class="theme-workbench-summary-pill inline-flex items-center gap-1 rounded-[0.32rem] border border-black/8 bg-white px-1.5 py-0.5 text-[10px] font-medium leading-none text-carbon"
          >
            <span class="i-lucide-check-check h-3 w-3 text-muted-strong"></span>
            <span class="truncate">{copy.selectedAccountCount(selectedVisibleCount)}</span>
          </span>
        {/if}

        {#if activeGroupFilter !== 'all'}
          <span
            class="theme-workbench-summary-pill inline-flex items-center gap-1 rounded-[0.32rem] border border-black/8 bg-white px-1.5 py-0.5 text-[10px] font-medium leading-none text-carbon"
          >
            <span class="i-lucide-tags h-3 w-3 text-muted-strong"></span>
            <span class="max-w-[12rem] truncate"
              >{groupFilterLabel(activeGroupFilter, groups, copy)}</span
            >
          </span>
        {/if}
      </span>
    {/if}

    <span
      class={`theme-workbench-chevron inline-flex h-6 w-6 items-center justify-center rounded-[0.35rem] border border-black/8 bg-white text-black/58 transition-[transform,background-color,color] duration-180 ${
        accountWorkbenchExpanded ? 'rotate-180' : ''
      }`}
    >
      <span class="i-lucide-chevron-down h-4 w-4"></span>
    </span>
  </button>

  {#if accountWorkbenchRendered}
    <div
      id="account-workbench-panel"
      class="t-panel-slide grid gap-2 px-2 pb-2 pt-1"
      data-open={accountWorkbenchPanelOpen ? 'true' : 'false'}
      style="--panel-translate-y: 12px;"
    >
      {#if showAccountFilterTools}
        <div class="grid gap-1.5">
          <div class="flex items-center justify-between gap-2">
            <p class="text-[10px] font-medium uppercase tracking-[0.08em] text-faint">
              {copy.filterByGroup}
            </p>
            <AppButton
              variant="secondary"
              size="xs"
              class="gap-1.5"
              onclick={openGroupManager}
              disabled={loginActionBusy || groupMutationBusy}
              ariaLabel={copy.manageGroups}
            >
              <span class="i-lucide-settings-2 h-3.5 w-3.5"></span>
              <span>{copy.manageGroups}</span>
            </AppButton>
          </div>
          <div class="flex flex-wrap gap-1.5">
            <AppButton
              variant="filter"
              size="xs"
              selected={activeGroupFilter === 'all'}
              ariaPressed={activeGroupFilter === 'all'}
              onclick={() => {
                activeGroupFilter = 'all'
              }}
            >
              {filterChipLabel(accounts, 'all', groups, copy)}
            </AppButton>
            <AppButton
              variant="filter"
              size="xs"
              selected={activeGroupFilter === ungroupedFilterId}
              ariaPressed={activeGroupFilter === ungroupedFilterId}
              onclick={() => {
                activeGroupFilter = ungroupedFilterId
              }}
            >
              {filterChipLabel(accounts, ungroupedFilterId, groups, copy)}
            </AppButton>
            {#each groups as group (group.id)}
              <AppButton
                variant="filter"
                size="xs"
                selected={activeGroupFilter === group.id}
                ariaPressed={activeGroupFilter === group.id}
                onclick={() => {
                  activeGroupFilter = group.id
                }}
              >
                {filterChipLabel(accounts, group.id, groups, copy)}
              </AppButton>
            {/each}
          </div>
        </div>
      {/if}

      {#if showAccountSelectionTools}
        <div
          class={`theme-selection-toolbar flex flex-wrap items-center justify-between gap-2 border-t border-black/6 pt-3 ${
            selectedVisibleCount ? 'theme-selection-toolbar-active' : 'theme-selection-toolbar-idle'
          }`}
        >
          <div class="flex min-w-0 flex-wrap items-center gap-1.5">
            {#if selectedVisibleCount}
              <span
                class="theme-workbench-summary-pill inline-flex items-center gap-1 rounded-[0.32rem] border border-black/8 bg-white px-1.5 py-0.5 text-[10px] font-medium text-carbon"
              >
                <span class="i-lucide-check-check h-3 w-3 text-muted-strong"></span>
                <span>{copy.selectedAccountCount(selectedVisibleCount)}</span>
              </span>
            {/if}

            {#if activeGroupFilter !== 'all'}
              <span
                class="theme-workbench-summary-pill inline-flex items-center gap-1 rounded-[0.32rem] border border-black/8 bg-white px-1.5 py-0.5 text-[10px] font-medium text-carbon"
              >
                <span class="i-lucide-tags h-3 w-3 text-muted-strong"></span>
                <span>{groupFilterLabel(activeGroupFilter, groups, copy)}</span>
              </span>
            {/if}
          </div>

          <div class="flex flex-wrap items-center justify-end gap-1.5">
            {#if visibleAccounts.length && !allVisibleSelected}
              <AppButton
                variant="secondary"
                size="xs"
                class="min-w-[108px]"
                onclick={selectAllVisibleAccounts}
                disabled={loginActionBusy || !visibleAccounts.length}
              >
                <span class="i-lucide-check-check h-3.5 w-3.5"></span>
                <span>{copy.selectAllVisibleAccounts}</span>
              </AppButton>
            {/if}

            {#if selectedVisibleCount}
              <AppButton
                variant="secondary"
                size="xs"
                class="min-w-[96px]"
                onclick={clearSelectedAccounts}
                disabled={loginActionBusy}
              >
                <span class="i-lucide-eraser h-3.5 w-3.5"></span>
                <span>{copy.clearSelectedAccounts}</span>
              </AppButton>

              <AppButton
                variant="secondary"
                size="xs"
                class="min-w-[104px]"
                onclick={() => void exportCurrentSelection()}
                disabled={loginActionBusy}
              >
                <span class="i-lucide-download h-3.5 w-3.5"></span>
                <span>{copy.exportSelectedAccounts}</span>
              </AppButton>

              <AppButton
                variant="danger"
                size="xs"
                class="min-w-[104px]"
                onclick={() => void removeCurrentSelection()}
                disabled={loginActionBusy || removingSelection}
              >
                {#if removingSelection}
                  <span class="i-lucide-loader-circle h-3.5 w-3.5 animate-spin"></span>
                {:else}
                  <span class="i-lucide-trash-2 h-3.5 w-3.5"></span>
                {/if}
                <span>{copy.deleteSelectedAccounts}</span>
              </AppButton>
            {/if}
          </div>
        </div>
      {:else if !showAccountFilterTools}
        <div
          class="theme-workbench-empty rounded-[0.85rem] border border-dashed border-black/8 bg-white px-3 py-3 text-[12px] text-muted-strong"
        >
          {copy.emptyFilterTools}
        </div>
      {/if}
    </div>
  {/if}
</div>

{#if visibleAccounts.length && quotaSummary.totalAccounts > 0 && tagVisibility.quotaSummary !== false}
  <div class="px-4 pt-3" transition:slide={{ duration: 200 }}>
    <div
      class="theme-quota-summary flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[0.55rem] border border-black/8 bg-white px-3.5 py-2.5"
    >
      <span class="text-[12px] font-semibold text-carbon">{copy.quotaSummaryTitle}</span>

      <div class="theme-quota-summary-row flex min-w-0 flex-1 items-center gap-3">
        <div
          class="theme-quota-summary-item flex min-w-0 flex-1 items-center gap-2 rounded-[0.4rem] bg-black/[0.03] px-2.5 py-1.5"
        >
          <span class="i-lucide-timer flex-none text-[13px] text-emerald-600"></span>
          <span class="flex-none text-[11px] font-medium text-muted-strong"
            >{copy.quotaSummaryPrimaryLabel}</span
          >
          <span
            class="theme-quota-summary-bar relative h-2 min-w-[3.5rem] flex-1 overflow-hidden rounded-full bg-black/[0.06]"
          >
            <span
              class="theme-quota-summary-bar-fill absolute inset-y-0 left-0 rounded-full bg-emerald-500/80 transition-[width] duration-300 ease-out"
              style={`width: ${quotaSummary.primary.accountCount ? quotaSummary.primary.averageRemaining : 0}%`}
            ></span>
          </span>
          <span class="flex flex-none items-center gap-1 text-[11px] tabular-nums text-carbon">
            {#if quotaSummary.primary.accountCount}
              <span class="font-semibold">{quotaSummary.primary.averageRemaining}%</span>
            {:else}
              <span class="text-faint">{copy.quotaSummaryEmpty}</span>
            {/if}
          </span>
        </div>

        <span class="h-6 w-px flex-none bg-black/10" aria-hidden="true"></span>

        <div
          class="theme-quota-summary-item flex min-w-0 flex-1 items-center gap-2 rounded-[0.4rem] bg-black/[0.03] px-2.5 py-1.5"
        >
          <span class="i-lucide-calendar-range flex-none text-[13px] text-sky-600"></span>
          <span class="flex-none text-[11px] font-medium text-muted-strong"
            >{copy.quotaSummarySecondaryLabel}</span
          >
          <span
            class="theme-quota-summary-bar relative h-2 min-w-[3.5rem] flex-1 overflow-hidden rounded-full bg-black/[0.06]"
          >
            <span
              class="theme-quota-summary-bar-fill absolute inset-y-0 left-0 rounded-full bg-sky-500/80 transition-[width] duration-300 ease-out"
              style={`width: ${quotaSummary.secondary.accountCount ? quotaSummary.secondary.averageRemaining : 0}%`}
            ></span>
          </span>
          <span class="flex flex-none items-center gap-1 text-[11px] tabular-nums text-carbon">
            {#if quotaSummary.secondary.accountCount}
              <span class="font-semibold">{quotaSummary.secondary.averageRemaining}%</span>
            {:else}
              <span class="text-faint">{copy.quotaSummaryEmpty}</span>
            {/if}
          </span>
        </div>
      </div>
    </div>
  </div>
{/if}

{#if visibleAccounts.length}
  <div class="accounts-scrollbar min-h-0 flex-1 overflow-y-auto px-4">
    <div
      class="grid"
      use:dragHandleZone={{
        items: sortableAccounts,
        type: 'accounts',
        flipDurationMs,
        dragDisabled:
          loginActionBusy ||
          groupMutationBusy ||
          activeGroupFilter !== 'all' ||
          sortableAccounts.length < 2,
        autoAriaDisabled: false,
        zoneItemTabIndex: -1,
        dropTargetStyle: {
          outline: '2px solid rgba(0,0,0,0.16)'
        },
        delayTouchStart: true
      }}
      onconsider={handleSortConsider}
      onfinalize={(event) => void handleSortFinalize(event)}
      aria-label={copy.accountCount(sortableAccounts.length)}
    >
      {#each sortableAccounts as account, accountIndex (account.id)}
        {@const accountId = sortableAccountId(account)}
        {@const actionAccount = accountWithSortableId(account)}
        {@const usageBadge = accountUsageBadge(usageErrorByAccountId[accountId], account, copy)}
        {@const subscriptionBadge = accountSubscriptionBadge(
          account.subscriptionExpiresAt,
          language,
          copy
        )}
        {@const tokenBadge = accountTokenExpiryBadge(
          account.accessTokenExpiresAt,
          language,
          copy
        )}
        {@const assignableGroups = availableGroupsForAccount(groups, account)}
        <article
          class={`theme-account-row group grid items-center gap-3 px-2.5 py-2.5 md:grid-cols-[auto_auto_minmax(0,1fr)_auto_auto] ${accountRowTone(
            actionAccount
          )} ${isSortShadowAccount(account) ? 'is-dnd-shadow' : ''}`}
          animate:flip={{ duration: flipDurationMs }}
          aria-label={accountEmail(account, copy)}
        >
          <AppButton
            variant="icon"
            size="xs"
            class={`theme-account-expand-btn ${expandedAccountIds.includes(accountId) ? 'is-expanded' : ''}`}
            ariaLabel={expandedAccountIds.includes(accountId)
              ? copy.accountDetailsCollapse
              : copy.accountDetailsExpand}
            title={expandedAccountIds.includes(accountId)
              ? copy.accountDetailsCollapse
              : copy.accountDetailsExpand}
            ariaExpanded={expandedAccountIds.includes(accountId)}
            onclick={() => toggleAccountExpanded(accountId)}
          >
            <span class="i-lucide-chevron-down h-4 w-4"></span>
          </AppButton>

          <div class="flex items-center gap-2">
            <label
              class={`theme-account-selector inline-flex h-7 w-7 flex-none items-center justify-center rounded-[0.35rem] border transition-[border-color,background-color,box-shadow] duration-180 ${
                selectedAccountIds.includes(accountId)
                  ? 'border-black/18 bg-white text-black'
                  : 'border-black/10 bg-white text-black/72'
              }`}
              title={copy.selectAccount}
            >
              <Checkbox
                value={accountId}
                checked={selectedAccountIds.includes(accountId)}
                disabled={loginActionBusy}
                ariaLabel={`${copy.selectAccount} · ${accountEmail(account, copy)}`}
                onCheckedChange={(checked) => setAccountSelected(accountId, checked)}
              />
            </label>
            <button
              class={`account-drag-button self-center ${activeGroupFilter === 'all' ? 'cursor-grab active:cursor-grabbing' : ''}`}
              type="button"
              use:dragHandle
              aria-label={`${copy.dragSortHandle} · ${accountEmail(account, copy)}`}
              title={copy.dragSortHandle}
              disabled={loginActionBusy ||
                groupMutationBusy ||
                activeGroupFilter !== 'all' ||
                sortableAccounts.length < 2}
            >
              <span class="i-lucide-grip-vertical h-4 w-4"></span>
            </button>
          </div>

          <div class="grid min-w-0 gap-2.5 overflow-visible">
            <div class="flex min-w-0 items-center gap-2">
              <span
                class={`h-2 w-2 flex-none rounded-full ${activeAccountId === accountId ? 'theme-status-active bg-success ring-3 ring-emerald-500/12' : 'theme-status-idle bg-black/14'}`}
              ></span>
              <p class="min-w-0 truncate text-sm font-medium leading-5 text-carbon">
                {accountEmail(account, copy)}
              </p>
            </div>

            <div class="mt-[-2px] flex min-w-0 flex-wrap items-center gap-1.5">
              <span
                class={`inline-flex flex-none items-center rounded-[0.32rem] px-1.5 py-0.5 text-[10px] font-medium ${planTagClass(usageByAccountId[accountId]?.planType)}`}
              >
                {planLabel(usageByAccountId[accountId]?.planType)}
              </span>

              {#if subscriptionBadge && tagVisibility.subscription !== false}
                <span
                  transition:fly={{ x: -8, duration: 180 }}
                  class={`inline-flex max-w-full items-center gap-1 rounded-[0.32rem] border px-1.75 py-0.5 text-[10px] font-medium leading-none ${
                    subscriptionBadge.expired
                      ? 'border-red-500/16 bg-red-500/10 text-red-700'
                      : subscriptionBadge.critical
                        ? 'border-amber-500/16 bg-amber-500/12 text-amber-700'
                        : 'border-violet-500/14 bg-violet-500/10 text-violet-700'
                  }`}
                  title={subscriptionBadge.title}
                >
                  <span class="i-lucide-calendar-days h-3 w-3 flex-none"></span>
                  <span class="truncate">{subscriptionBadge.label}</span>
                </span>
              {/if}

              {#if tokenBadge && tagVisibility.tokenExpiry !== false}
                <button
                  type="button"
                  transition:fly={{ x: -8, duration: 180 }}
                  class={`inline-flex max-w-full items-center gap-1 rounded-[0.32rem] border px-1.75 py-0.5 text-[10px] font-medium leading-none transition-colors duration-140 hover:bg-black/[0.04] ${
                    tokenBadge.expired
                      ? 'border-red-500/16 bg-red-500/10 text-red-700'
                      : tokenBadge.critical
                        ? 'border-amber-500/16 bg-amber-500/12 text-amber-700'
                        : 'border-orange-500/14 bg-orange-500/10 text-orange-700'
                  }`}
                  title={tokenBadge.title}
                  onclick={() => openRefreshTokensDialog(actionAccount)}
                  disabled={loginActionBusy}
                >
                  <span class="i-lucide-key-round h-3 w-3 flex-none"></span>
                  <span class="truncate">{tokenBadge.label}</span>
                </button>
              {/if}

              {#if showWakeAccount(accountId) && hasEnabledWakeSchedule(accountId) && tagVisibility.wakeSchedule !== false}
                <button
                  transition:fly={{ x: -8, duration: 180 }}
                  class="theme-wake-schedule-pill inline-flex min-w-0 max-w-full items-center rounded-[0.32rem] border border-sky-500/16 bg-sky-500/10 px-2 py-0.75 text-[10px] text-sky-700 transition-colors duration-140 hover:bg-sky-500/14"
                  type="button"
                  onclick={() => openWakeDialog(actionAccount, 'schedule')}
                  disabled={loginActionBusy || usageLoadingByAccountId[accountId]}
                  title={wakeScheduleTitle(accountId)}
                >
                  <span class="i-lucide-calendar-clock mr-1.5 h-3.5 w-3.5 flex-none"></span>
                  <span class="truncate">{wakeScheduleSummary(accountId)}</span>
                </button>
              {/if}

              {#if tagVisibility.groups !== false}
                {#each accountGroupsForDisplay(groups, account) as group (group.id)}
                  {@const groupLinkKey = `${accountId}:${group.id}`}
                  <span
                    transition:fly={{ x: -8, duration: 180 }}
                    class="theme-tag-assigned inline-flex max-w-full items-center rounded-[0.32rem] border border-emerald-500/14 bg-emerald-500/10 px-1.75 py-0.5 text-[10px] font-medium leading-none text-emerald-700"
                  >
                    <span class="max-w-28 truncate">{group.name}</span>
                    <button
                      class="theme-tag-remove ml-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-transparent p-0 text-emerald-700/72 transition-colors duration-140 hover:bg-emerald-500/12 hover:text-emerald-800"
                      type="button"
                      onclick={() => void removeGroupFromAccount(actionAccount, group.id)}
                      disabled={loginActionBusy || groupMutationBusy}
                      aria-label={`${copy.removeGroup} · ${group.name}`}
                      title={copy.removeGroup}
                    >
                      {#if removingGroupLink === groupLinkKey}
                        <span class="i-lucide-loader-circle h-2.5 w-2.5 animate-spin"></span>
                      {:else}
                        <span class="i-lucide-x h-2.5 w-2.5"></span>
                      {/if}
                    </button>
                  </span>
                {/each}
              {/if}
            </div>

            {#if usageBadge}
              {@const errorLines = usageErrorLines(usageBadge.detail)}
              <div class="min-w-0">
                <button
                  class={`inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-left text-[11px] leading-4 transition-colors duration-140 hover:bg-black/[0.04] ${usageErrorToneClass(
                    usageBadge.kind
                  )}`}
                  type="button"
                  data-no-dnd="true"
                  onpointerdown={stopUsageErrorEvent}
                  onmousedown={stopUsageErrorEvent}
                  onclick={(event) => toggleUsageErrorPopover(event, accountId)}
                  aria-expanded={usageErrorPopoverAccountId === accountId}
                  title={usageBadge.title}
                >
                  <span class="min-w-0 truncate whitespace-nowrap">{errorLines[0]}</span>
                  <span class="i-lucide-info h-3.5 w-3.5 flex-none opacity-70"></span>
                </button>

                {#if usageErrorPopoverAccountId === accountId}
                  <div
                    use:portal
                    use:floatingAnchor={{
                      anchorRect: usageErrorPopoverAnchorRect,
                      minWidth: 360,
                      gap: 8,
                      placement: 'right'
                    }}
                    use:stopFloatingPointerPropagation
                    data-floating-root=""
                    class="theme-tag-picker-surface z-[999] w-[380px] max-w-[min(380px,calc(100vw-24px))] rounded-[1.1rem] p-2"
                    style="background-color: var(--panel-strong); box-shadow: var(--elevation-2), 0 0 0 1px var(--line-strong);"
                  >
                    <div class="flex items-center justify-between gap-2 px-2 pb-1.5 pt-1">
                      <span
                        class="min-w-0 truncate text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--ink-faint)]"
                      >
                        {copy.accountUsageRefreshFailed}
                      </span>
                      <button
                        class="inline-flex h-6 w-6 flex-none appearance-none items-center justify-center rounded-full border-0 bg-transparent p-0 text-[var(--ink-faint)] shadow-none outline-none transition-colors duration-140 hover:bg-[var(--surface-hover)] hover:text-carbon"
                        type="button"
                        onclick={closeUsageErrorPopover}
                        aria-label="关闭"
                        title="关闭"
                      >
                        <span class="i-lucide-x h-3.5 w-3.5"></span>
                      </button>
                    </div>
                    <div
                      class="max-h-52 overflow-auto rounded-[0.85rem] bg-black/[0.035] p-2.5 text-[12px] leading-5 text-carbon"
                    >
                      <pre
                        class="m-0 whitespace-pre-wrap break-words font-sans">{usageBadge.detail}</pre>
                    </div>
                  </div>
                {/if}
              </div>
            {/if}
          </div>

          <div
            class="scroll-row flex min-w-0 flex-wrap items-center justify-start gap-1.5 overflow-x-auto self-center md:justify-end"
          >
            {#if !usageByAccountId[accountId] || usageByAccountId[accountId]?.primary}
              <div
                class="theme-soft-panel inline-grid grid-cols-[auto_auto_3.5rem_2.75rem] items-center gap-x-2 rounded-full border border-black/6 bg-black/[0.03] px-2.5 py-1.5 text-[10px] text-muted-strong"
                title={`${copy.sessionQuota} · ${
                  usageByAccountId[accountId]?.primary
                    ? `${remainingPercent(usageByAccountId[accountId].primary?.usedPercent)}%`
                    : '--'
                }`}
              >
                <span class="font-medium">{copy.sessionReset}</span>
                {#if usageLoadingByAccountId[accountId] && !usageByAccountId[accountId]}
                  <span class="inline-flex h-4 items-center leading-none">…</span>
                {:else if usageByAccountId[accountId]?.primary}
                  <span class="theme-reset-time-neutral inline-flex h-4 items-center leading-none"
                    >{formatRelativeReset(
                      usageByAccountId[accountId]?.primary?.resetsAt,
                      language
                    )}</span
                  >
                {:else}
                  <span class="inline-flex h-4 items-center leading-none">--</span>
                {/if}
                <span
                  class="theme-progress-track self-center h-1.5 w-14 overflow-hidden rounded-full bg-black/8"
                >
                  <span
                    class="theme-progress-fill block h-full rounded-full bg-black/70"
                    style={`width: ${progressWidth(usageByAccountId[accountId]?.primary?.usedPercent)}`}
                    use:animateProgress={{
                      targetWidth: progressWidth(usageByAccountId[accountId]?.primary?.usedPercent),
                      delay: Math.min(accountIndex * 0.028, 0.14),
                      duration: 0.46,
                      critical: (usageByAccountId[accountId]?.primary?.usedPercent ?? 0) > 85
                    }}
                  ></span>
                </span>
                {#if usageLoadingByAccountId[accountId] && !usageByAccountId[accountId]}
                  <span
                    class="inline-flex h-5 min-w-[2.75rem] items-center justify-end leading-none tabular-nums"
                    >…</span
                  >
                {:else if usageByAccountId[accountId]?.primary}
                  <span
                    class="inline-flex h-5 min-w-[2.75rem] items-center justify-end leading-none tabular-nums"
                    >{remainingPercent(usageByAccountId[accountId].primary?.usedPercent)}%</span
                  >
                {:else}
                  <span
                    class="inline-flex h-5 min-w-[2.75rem] items-center justify-end leading-none tabular-nums"
                    >-</span
                  >
                {/if}
              </div>
            {/if}

            {#if !usageByAccountId[accountId] || usageByAccountId[accountId]?.secondary}
              <div
                class="theme-soft-panel inline-grid grid-cols-[auto_auto_3.5rem_2.75rem] items-center gap-x-2 rounded-full border border-black/6 bg-black/[0.03] px-2.5 py-1.5 text-[10px] text-muted-strong"
                title={`${copy.weeklyQuota} · ${
                  usageByAccountId[accountId]?.secondary
                    ? `${remainingPercent(usageByAccountId[accountId].secondary?.usedPercent)}%`
                    : '--'
                }`}
              >
                <span class="font-medium">{copy.weeklyReset}</span>
                {#if usageLoadingByAccountId[accountId] && !usageByAccountId[accountId]}
                  <span class="inline-flex h-4 items-center leading-none">…</span>
                {:else if usageByAccountId[accountId]?.secondary}
                  <span
                    class={`${weeklyResetTimeToneClass(
                      usageByAccountId[accountId]?.secondary?.resetsAt
                    )} inline-flex h-4 items-center leading-none`}
                    >{formatRelativeReset(
                      usageByAccountId[accountId]?.secondary?.resetsAt,
                      language
                    )}</span
                  >
                {:else}
                  <span class="inline-flex h-4 items-center leading-none">--</span>
                {/if}
                <span
                  class="theme-progress-track self-center h-1.5 w-14 overflow-hidden rounded-full bg-black/8"
                >
                  <span
                    class="theme-progress-fill block h-full rounded-full bg-black/70"
                    style={`width: ${progressWidth(usageByAccountId[accountId]?.secondary?.usedPercent)}`}
                    use:animateProgress={{
                      targetWidth: progressWidth(
                        usageByAccountId[accountId]?.secondary?.usedPercent
                      ),
                      delay: Math.min(accountIndex * 0.028 + 0.03, 0.18),
                      duration: 0.5,
                      critical: (usageByAccountId[accountId]?.secondary?.usedPercent ?? 0) > 85
                    }}
                  ></span>
                </span>
                {#if usageLoadingByAccountId[accountId] && !usageByAccountId[accountId]}
                  <span
                    class="inline-flex h-5 min-w-[2.75rem] items-center justify-end leading-none tabular-nums"
                    >…</span
                  >
                {:else if usageByAccountId[accountId]?.secondary}
                  <span
                    class="inline-flex h-5 min-w-[2.75rem] items-center justify-end leading-none tabular-nums"
                    >{remainingPercent(usageByAccountId[accountId].secondary?.usedPercent)}%</span
                  >
                {:else}
                  <span
                    class="inline-flex h-5 min-w-[2.75rem] items-center justify-end leading-none tabular-nums"
                    >-</span
                  >
                {/if}
              </div>
            {/if}

            {#if extraLimits(usageByAccountId, accountId).length}
              {#each extraLimits(usageByAccountId, accountId) as limit (`${accountId}:${limit.limitId ?? 'extra'}`)}
                <div
                  class="theme-soft-panel inline-flex items-center gap-1.5 rounded-full border border-black/6 bg-black/[0.03] px-2.5 py-1.5 text-[10px]"
                >
                  <span class="font-medium uppercase tracking-[0.08em]">{limitLabel(limit)}</span>
                  {#if limit.primary}
                    <span>h {remainingPercent(limit.primary.usedPercent)}%</span>
                  {/if}
                  {#if limit.secondary}
                    <span>w {remainingPercent(limit.secondary.usedPercent)}%</span>
                  {/if}
                </div>
              {/each}
            {/if}
          </div>

          <div class="flex items-center self-center justify-end gap-1">
            <AppButton
              variant="icon"
              size="xs"
              onclick={() => openAccountInCodex(accountId)}
              disabled={accountLaunchDisabled(actionAccount)}
              ariaLabel={`${copy.openCodex} · ${accountEmail(account, copy)}`}
              title={copy.openCodex}
            >
              {#if openingAccountId === accountId}
                <span class="i-lucide-loader-circle h-4 w-4 animate-spin"></span>
              {:else}
                <span class="i-lucide-square-arrow-out-up-right h-4 w-4"></span>
              {/if}
            </AppButton>
            <AppButton
              variant="icon"
              size="xs"
              onclick={() => openAccountInIsolatedCodex(accountId)}
              disabled={accountLaunchDisabled(actionAccount)}
              ariaLabel={`${copy.openCodexIsolated} · ${accountEmail(account, copy)}`}
              title={copy.openCodexIsolated}
            >
              {#if openingIsolatedAccountId === accountId}
                <span class="i-lucide-loader-circle h-4 w-4 animate-spin"></span>
              {:else}
                <span class="i-lucide-copy-plus h-4 w-4"></span>
              {/if}
            </AppButton>
            <AppButton
              variant="icon"
              size="xs"
              onclick={() => refreshAccountUsage(actionAccount)}
              disabled={accountRefreshDisabled(actionAccount)}
              ariaLabel={`${copy.refreshQuota} · ${accountEmail(account, copy)}`}
              title={copy.refreshQuota}
            >
              {#if usageLoadingByAccountId[accountId]}
                <span class="i-lucide-loader-circle h-4 w-4 animate-spin"></span>
              {:else}
                <span class="i-lucide-refresh-cw h-4 w-4"></span>
              {/if}
            </AppButton>
            <div class="relative" use:stopFloatingPointerPropagation data-floating-root="">
              <AppButton
                variant="icon"
                size="xs"
                onclick={(event) => toggleAccountActionMenu(event, accountId)}
                ariaLabel={`${accountMoreActionsLabel()} · ${accountEmail(account, copy)}`}
                title={accountMoreActionsLabel()}
              >
                <span class="i-lucide-ellipsis h-4 w-4"></span>
              </AppButton>

              {#if accountActionMenuAccountId === accountId}
                <div
                  use:portal
                  use:floatingAnchor={{
                    anchorRect: accountActionMenuAnchorRect,
                    minWidth: 220,
                    matchAnchorWidth: true
                  }}
                  use:stopFloatingPointerPropagation
                  data-floating-root=""
                  transition:fly={{ y: -6, duration: 200 }}
                  class="theme-tag-picker-surface z-[999] w-[264px] rounded-[1.25rem] p-1.5"
                  style="background-color: var(--panel-strong); box-shadow: var(--elevation-2), 0 0 0 1px var(--line-strong);"
                >
                  <div
                    class="px-2.5 pb-2 pt-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--ink-faint)]"
                  >
                    {accountMoreActionsLabel()}
                  </div>

                  {#if showWakeAccount(accountId)}
                    <button
                      class="theme-tag-picker-item group flex w-full appearance-none items-center gap-2.5 rounded-[0.75rem] border-0 bg-transparent px-2 py-1.5 text-left text-[13px] font-medium text-carbon shadow-none outline-none transition-colors duration-140 hover:bg-[var(--surface-hover)] active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
                      type="button"
                      onclick={() => {
                        openWakeDialog(actionAccount)
                        closeAccountActionMenu()
                      }}
                      disabled={wakeDialogDisabled(actionAccount)}
                    >
                      <span
                        class="flex h-7 w-7 flex-none items-center justify-center rounded-md bg-[var(--surface-soft)] text-[var(--ink-faint)] transition-colors duration-140 group-hover:bg-[var(--color-snow)] group-hover:text-carbon"
                      >
                        {#if wakingAccountId === accountId}
                          <span class="i-lucide-loader-circle h-4 w-4 animate-spin"></span>
                        {:else}
                          <span class="i-lucide-alarm-clock h-4 w-4"></span>
                        {/if}
                      </span>
                      <span class="flex-1">{copy.wakeQuota}</span>
                    </button>
                  {/if}

                  <button
                    class="theme-tag-picker-item group flex w-full appearance-none items-center gap-2.5 rounded-[0.75rem] border-0 bg-transparent px-2 py-1.5 text-left text-[13px] font-medium text-carbon shadow-none outline-none transition-colors duration-140 hover:bg-[var(--surface-hover)] active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
                    type="button"
                    onclick={() => {
                      openAccountInIsolatedCodex(accountId)
                      closeAccountActionMenu()
                    }}
                    disabled={accountLaunchDisabled(actionAccount)}
                  >
                    <span
                      class="flex h-7 w-7 flex-none items-center justify-center rounded-md bg-[var(--surface-soft)] text-[var(--ink-faint)] transition-colors duration-140 group-hover:bg-[var(--color-snow)] group-hover:text-carbon"
                    >
                      {#if openingIsolatedAccountId === accountId}
                        <span class="i-lucide-loader-circle h-4 w-4 animate-spin"></span>
                      {:else}
                        <span class="i-lucide-copy-plus h-4 w-4"></span>
                      {/if}
                    </span>
                    <span class="flex-1">{copy.openCodexIsolated}</span>
                  </button>

                  <button
                    class="theme-tag-picker-item group flex w-full appearance-none items-center gap-2.5 rounded-[0.75rem] border-0 bg-transparent px-2 py-1.5 text-left text-[13px] font-medium text-carbon shadow-none outline-none transition-colors duration-140 hover:bg-[var(--surface-hover)] active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
                    type="button"
                    onclick={() => {
                      openEditTokensDialog(actionAccount)
                      closeAccountActionMenu()
                    }}
                    disabled={loginActionBusy}
                  >
                    <span
                      class="flex h-7 w-7 flex-none items-center justify-center rounded-md bg-[var(--surface-soft)] text-[var(--ink-faint)] transition-colors duration-140 group-hover:bg-[var(--color-snow)] group-hover:text-carbon"
                    >
                      <span class="i-lucide-pencil h-4 w-4"></span>
                    </span>
                    <span class="flex-1">{copy.editAccount}</span>
                  </button>

                  <button
                    class="theme-tag-picker-item group flex w-full appearance-none items-center gap-2.5 rounded-[0.75rem] border-0 bg-transparent px-2 py-1.5 text-left text-[13px] font-medium text-carbon shadow-none outline-none transition-colors duration-140 hover:bg-[var(--surface-hover)] active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
                    type="button"
                    onclick={() => {
                      openRefreshTokensDialog(actionAccount)
                      closeAccountActionMenu()
                    }}
                    disabled={loginActionBusy}
                  >
                    <span
                      class="flex h-7 w-7 flex-none items-center justify-center rounded-md bg-[var(--surface-soft)] text-[var(--ink-faint)] transition-colors duration-140 group-hover:bg-[var(--color-snow)] group-hover:text-carbon"
                    >
                      <span class="i-lucide-refresh-cw h-4 w-4"></span>
                    </span>
                    <span class="flex-1">{copy.forceRefreshTokensButton}</span>
                  </button>

                  <button
                    class="theme-tag-picker-item group flex w-full appearance-none items-center gap-2.5 rounded-[0.75rem] border-0 bg-transparent px-2 py-1.5 text-left text-[13px] font-medium text-carbon shadow-none outline-none transition-colors duration-140 hover:bg-[var(--surface-hover)] active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
                    type="button"
                    onclick={() => void exportSingleAccount(actionAccount)}
                    disabled={loginActionBusy}
                  >
                    <span
                      class="flex h-7 w-7 flex-none items-center justify-center rounded-md bg-[var(--surface-soft)] text-[var(--ink-faint)] transition-colors duration-140 group-hover:bg-[var(--color-snow)] group-hover:text-carbon"
                    >
                      <span class="i-lucide-download h-4 w-4"></span>
                    </span>
                    <span class="flex-1">{copy.exportAccount}</span>
                  </button>

                  <button
                    class="theme-tag-picker-item group flex w-full appearance-none items-center gap-2.5 rounded-[0.75rem] border-0 bg-transparent px-2 py-1.5 text-left text-[13px] font-medium text-danger shadow-none outline-none transition-colors duration-140 hover:bg-danger/10 active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
                    type="button"
                    onclick={() => {
                      removeAccount(actionAccount)
                      closeAccountActionMenu()
                    }}
                    disabled={loginActionBusy}
                  >
                    <span
                      class="flex h-7 w-7 flex-none items-center justify-center rounded-md bg-[var(--surface-soft)] text-danger transition-colors duration-140 group-hover:bg-[var(--color-snow)]"
                    >
                      <span class="i-lucide-trash-2 h-4 w-4"></span>
                    </span>
                    <span class="flex-1">{copy.deleteSaved}</span>
                  </button>

                  {#if assignableGroups.length}
                    <div class="mx-2 my-1.5 border-t border-[var(--color-arctic-mist)]"></div>
                    <button
                      class="theme-tag-picker-item group flex w-full appearance-none items-center gap-2.5 rounded-[0.75rem] border-0 bg-transparent px-2 py-1.5 text-left text-[13px] font-medium text-carbon shadow-none outline-none transition-colors duration-140 hover:bg-[var(--surface-hover)] active:scale-[0.98]"
                      type="button"
                      onclick={() => openAccountGroupMenuFromActionMenu(accountId)}
                    >
                      <span
                        class="flex h-7 w-7 flex-none items-center justify-center rounded-md bg-[var(--surface-soft)] text-[var(--ink-faint)] transition-colors duration-140 group-hover:bg-[var(--color-snow)] group-hover:text-carbon"
                      >
                        <span class="i-lucide-tags h-4 w-4"></span>
                      </span>
                      <span class="flex-1">{copy.addGroup}</span>
                      <span
                        class="i-lucide-chevron-right h-4 w-4 text-[var(--ink-faint)] transition-colors"
                      ></span>
                    </button>
                  {/if}
                </div>
              {/if}

              {#if accountGroupMenuAccountId === accountId}
                <div
                  use:portal
                  use:floatingAnchor={{
                    anchorRect: accountGroupMenuAnchorRect,
                    minWidth: 220,
                    matchAnchorWidth: true
                  }}
                  use:stopFloatingPointerPropagation
                  data-floating-root=""
                  transition:fly={{ y: -6, duration: 200 }}
                  class="theme-tag-picker-surface z-[999] w-[210px] rounded-[1.25rem] p-1.5"
                  style="background-color: var(--panel-strong); box-shadow: var(--elevation-2), 0 0 0 1px var(--line-strong);"
                >
                  <button
                    class="theme-tag-picker-item group flex w-full appearance-none items-center gap-2 rounded-[0.75rem] border-0 bg-transparent px-2.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-faint)] shadow-none outline-none transition-colors duration-140 hover:bg-[var(--surface-hover)] hover:text-carbon active:scale-[0.98]"
                    type="button"
                    onclick={returnToAccountActionMenu}
                  >
                    <span class="i-lucide-chevron-left h-3.5 w-3.5 flex-none transition-colors"
                    ></span>
                    {copy.addGroup}
                  </button>
                  <div class="mx-2 my-1 border-t border-[var(--color-arctic-mist)]"></div>
                  <div class="mt-1 max-h-[300px] overflow-y-auto pr-1">
                    {#each assignableGroups as group (group.id)}
                      <button
                        class="theme-tag-picker-item group flex w-full appearance-none items-center justify-between gap-2.5 rounded-[0.75rem] border-0 bg-transparent px-2.5 py-2 text-left text-[13px] font-medium text-carbon shadow-none outline-none transition-colors duration-140 hover:bg-[var(--surface-hover)] active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
                        type="button"
                        onclick={() => void addGroupToAccount(actionAccount, group.id)}
                        disabled={loginActionBusy || groupMutationBusy}
                      >
                        <span class="flex-1 truncate">{group.name}</span>
                        <span
                          class="theme-tag-picker-plus inline-flex h-6 w-6 flex-none items-center justify-center rounded-md bg-[var(--surface-soft)] text-[var(--ink-faint)] transition-colors duration-140 group-hover:bg-[var(--color-snow)] group-hover:text-carbon"
                        >
                          <span class="i-lucide-plus h-3.5 w-3.5"></span>
                        </span>
                      </button>
                    {/each}
                  </div>
                </div>
              {/if}
            </div>
          </div>

          {#if expandedAccountIds.includes(accountId)}
            <div id={`account-details-${accountId}`} class="col-span-full pt-1" data-no-dnd="true">
              <AccountDetailsPanel
                {copy}
                {language}
                account={actionAccount}
                rateLimits={usageByAccountId[accountId]}
                wakeSchedule={wakeSchedulesByAccountId[accountId]}
                tokens={tokensByAccountId[accountId] ?? null}
                tokensLoading={tokensLoadingAccountId === accountId}
                tokensError={tokensErrorByAccountId[accountId] ?? ''}
                onReloadTokens={() => void loadTokensForAccount(accountId)}
                onForceRefreshTokens={() => openRefreshTokensDialog(actionAccount)}
              />
            </div>
          {/if}

          {#if accountIndex < sortableAccounts.length - 1}
            <div class="theme-account-divider col-span-full"></div>
          {/if}
        </article>
      {/each}
    </div>
  </div>
{:else}
  <div
    class="theme-tag-empty flex min-h-0 flex-1 items-center justify-center overflow-y-auto rounded-[0.875rem] border border-dashed border-black/10 bg-black/[0.02] px-4 py-8 text-center"
  >
    <p class="text-sm text-muted-strong">{copy.noAccountsForFilter}</p>
  </div>
{/if}

<style>
  .scroll-row {
    scrollbar-width: none;
    -ms-overflow-style: none;
  }

  .scroll-row::-webkit-scrollbar {
    display: none;
  }

  .accounts-scrollbar {
    scrollbar-width: thin;
    scrollbar-color: color-mix(in srgb, var(--ink-faint) 46%, transparent) transparent;
  }

  .accounts-scrollbar::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }

  .accounts-scrollbar::-webkit-scrollbar-track {
    background: transparent;
  }

  .accounts-scrollbar::-webkit-scrollbar-thumb {
    border: 2px solid transparent;
    border-radius: 999px;
    background-clip: padding-box;
    background-color: color-mix(in srgb, var(--ink-faint) 38%, transparent);
  }

  .accounts-scrollbar::-webkit-scrollbar-thumb:hover {
    background-color: color-mix(in srgb, var(--ink-soft-strong) 46%, transparent);
  }

  .theme-account-divider {
    height: 1px;
    background: color-mix(in srgb, var(--color-arctic-mist) 62%, transparent);
  }

  .theme-account-expand-btn :global(.i-lucide-chevron-down) {
    transition: transform 180ms ease;
  }

  .theme-account-expand-btn.is-expanded :global(.i-lucide-chevron-down) {
    transform: rotate(180deg);
  }

  .theme-selection-toolbar-idle,
  .theme-selection-toolbar-active {
    opacity: 1;
  }

  .theme-workbench-toggle:hover .theme-workbench-chevron,
  .theme-workbench-toggle:focus-visible .theme-workbench-chevron {
    background: rgba(24, 24, 27, 0.06);
    color: var(--color-carbon);
  }

  .account-drag-button {
    appearance: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.5rem;
    min-width: 1.5rem;
    height: 1.5rem;
    min-height: 1.5rem;
    border: 1px solid color-mix(in srgb, var(--color-arctic-mist) 82%, transparent);
    border-radius: 0.38rem;
    background: transparent;
    color: var(--ink-faint);
    padding: 0;
    transition:
      background-color 140ms ease,
      border-color 140ms ease,
      color 140ms ease,
      opacity 140ms ease;
  }

  .account-drag-button:hover:not(:disabled),
  .account-drag-button:focus-visible {
    border-color: var(--line-strong);
    background: var(--surface-hover);
    color: var(--color-carbon);
  }

  .account-drag-button:disabled {
    cursor: not-allowed;
    opacity: 0.48;
  }

  :global(html[data-theme='dark']) .accounts-scrollbar {
    scrollbar-color: color-mix(in srgb, var(--color-arctic-mist) 48%, transparent) transparent;
  }

  :global(html[data-theme='dark']) .accounts-scrollbar::-webkit-scrollbar-thumb {
    background-color: color-mix(in srgb, var(--color-arctic-mist) 38%, transparent);
  }

  :global(html[data-theme='dark']) .accounts-scrollbar::-webkit-scrollbar-thumb:hover {
    background-color: color-mix(in srgb, var(--color-arctic-mist) 58%, transparent);
  }

  :global(html[data-theme='dark']) .theme-account-divider {
    background: var(--color-arctic-mist) !important;
  }

  :global(html[data-theme='dark']) .theme-tag-picker-surface,
  :global(html[data-theme='dark']) .theme-tag-empty {
    background: var(--panel-strong) !important;
    border-color: var(--color-arctic-mist) !important;
    color: var(--color-carbon) !important;
  }

  :global(html[data-theme='dark']) .theme-tag-assigned {
    background: rgb(16 185 129 / 0.14) !important;
    border-color: rgb(16 185 129 / 0.18) !important;
    color: rgb(167 243 208) !important;
  }

  :global(html[data-theme='dark']) .theme-tag-remove {
    color: rgb(167 243 208 / 0.78) !important;
  }

  :global(html[data-theme='dark']) .theme-tag-remove:hover {
    background: rgb(16 185 129 / 0.16) !important;
    color: rgb(209 250 229) !important;
  }

  :global(html[data-theme='dark']) .theme-tag-picker-plus {
    background: var(--surface-soft) !important;
    color: var(--ink-soft) !important;
  }

  :global(html[data-theme='dark']) .theme-tag-picker-item {
    color: var(--color-carbon) !important;
  }

  :global(html[data-theme='dark']) .theme-tag-picker-item:hover,
  :global(html[data-theme='dark']) .theme-tag-picker-item:focus-visible {
    background: color-mix(in srgb, var(--surface-hover) 88%, transparent) !important;
    color: var(--color-carbon) !important;
  }

  :global(html[data-theme='dark']) .theme-tag-picker-item:hover .theme-tag-picker-plus,
  :global(html[data-theme='dark']) .theme-tag-picker-item:focus-visible .theme-tag-picker-plus {
    background: color-mix(in srgb, var(--color-carbon) 10%, var(--surface-soft)) !important;
    color: var(--color-carbon) !important;
  }

  :global(html[data-theme='dark']) .theme-workbench-toolbar {
    background: color-mix(in srgb, var(--surface-soft) 90%, var(--color-fog) 10%) !important;
    border-color: var(--color-arctic-mist) !important;
  }

  :global(html[data-theme='dark']) .theme-workbench-toggle,
  :global(html[data-theme='dark']) .theme-workbench-summary-pill,
  :global(html[data-theme='dark']) .theme-workbench-chevron,
  :global(html[data-theme='dark']) .theme-workbench-empty {
    background: var(--panel-strong) !important;
    border-color: var(--color-arctic-mist) !important;
    color: var(--color-carbon) !important;
  }

  :global(html[data-theme='dark']) .theme-workbench-toggle:hover {
    background: color-mix(in srgb, var(--surface-hover) 84%, var(--panel-strong) 16%) !important;
  }

  :global(html[data-theme='dark']) .theme-workbench-toggle:hover .theme-workbench-chevron,
  :global(html[data-theme='dark']) .theme-workbench-toggle:focus-visible .theme-workbench-chevron {
    background: var(--surface-hover) !important;
    color: var(--color-carbon) !important;
  }

  :global(html[data-theme='dark']) .theme-selection-toolbar-idle {
    color: var(--color-carbon) !important;
    border-top-color: color-mix(in srgb, var(--color-arctic-mist) 72%, transparent) !important;
  }

  :global(html[data-theme='dark']) .theme-selection-toolbar-active {
    color: var(--color-carbon) !important;
    border-top-color: color-mix(in srgb, var(--line-strong) 78%, transparent) !important;
  }

  :global(html[data-theme='dark']) .theme-selection-divider {
    background: color-mix(in srgb, var(--color-arctic-mist) 72%, transparent) !important;
  }

  .theme-reset-time-neutral {
    color: var(--ink-soft-strong);
  }

  .theme-quota-summary {
    background: color-mix(in srgb, var(--panel-strong) 88%, var(--surface-soft));
  }

  .theme-quota-summary-bar {
    background: color-mix(in srgb, var(--color-carbon) 8%, transparent);
  }

  :global(html[data-theme='dark']) .theme-quota-summary {
    background: var(--panel-strong) !important;
    border-color: var(--color-arctic-mist) !important;
  }

  :global(html[data-theme='dark']) .theme-quota-summary-bar {
    background: color-mix(in srgb, var(--color-snow) 14%, transparent) !important;
  }

  :global(html[data-theme='dark']) .account-drag-button {
    border-color: var(--color-arctic-mist);
    color: var(--ink-soft);
  }

  :global(html[data-theme='dark']) .theme-account-card-selected {
    background: var(--panel-strong) !important;
    border-color: var(--color-arctic-mist) !important;
  }

  :global(html[data-theme='dark']) .theme-account-selector {
    border-color: var(--color-arctic-mist) !important;
    background: var(--panel-strong) !important;
    color: var(--ink-soft) !important;
  }

  :global(html[data-theme='dark']) .theme-account-selector-input {
    accent-color: var(--color-carbon);
  }

  :global(html[data-theme='dark']) .theme-reset-time-neutral {
    color: rgb(255 255 255 / 0.88) !important;
  }

  :global(html[data-theme='dark']) .theme-selection-danger:hover {
    background: color-mix(in srgb, rgb(239 68 68) 12%, var(--surface-hover)) !important;
  }

  :global(.theme-account-row.is-dnd-shadow) + .theme-account-row {
    transform: translateY(3px);
    transition: transform 0.18s cubic-bezier(0.33, 1, 0.68, 1);
  }

  :global(.theme-account-row.is-dnd-shadow) + .theme-account-row::before {
    content: '' !important;
    position: absolute;
    top: -1px;
    right: 0.75rem;
    left: 0.75rem;
    height: 1px;
    background: color-mix(in srgb, var(--color-carbon) 22%, transparent);
    opacity: 1;
    transition: opacity 0.18s ease;
    pointer-events: none;
  }

  @media (prefers-reduced-motion: reduce) {
    :global(.theme-account-row.is-dnd-shadow) + .theme-account-row {
      transform: none;
    }
  }
</style>
