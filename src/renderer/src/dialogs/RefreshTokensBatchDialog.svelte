<script lang="ts">
  import { onMount } from 'svelte'
  import type {
    AccountGroup,
    AccountSummary,
    AppLanguage,
    BatchRefreshSummary
  } from '../../../shared/codex'
  import { accountEmail, formatDurationCompact, type LocalizedCopy } from '$lib/view/app-view'
  import AppButton from '$lib/ui/AppButton.svelte'
  import AppDialog from '$lib/ui/AppDialog.svelte'
  import { eligibleAccountsForRefresh } from '../views/accounts/accounts-panel-account'
  import type { RowState } from './refresh-tokens-batch-state'

  export let copy: LocalizedCopy
  export let language: AppLanguage
  export let accounts: AccountSummary[] = []
  export let groups: AccountGroup[] = []
  export let phase: 'idle' | 'confirming' | 'running' | 'done' = 'idle'
  export let progressByAccountId: Record<string, RowState> = {}
  export let candidateAccountIds: string[] = []
  export let summary: BatchRefreshSummary | null = null
  export let error = ''
  export let onClose: () => void = () => {}
  export let onSubmit: (accountIds: string[]) => void = () => {}
  export let onRetryFailed: () => void = () => {}

  type PresetHours = 1 | 6 | 24 | 72 | 240

  const PRESET_HOURS: PresetHours[] = [1, 6, 24, 72, 240]

  let thresholdHours = 24
  let nowMs = Date.now()
  let nowTimer: ReturnType<typeof setInterval> | null = null

  $: if (phase === 'idle') {
    nowMs = Date.now()
  }

  $: thresholdMs = thresholdHours * 60 * 60 * 1000

  $: ungroupedIds = accounts
    .filter((account) => account.groupIds.length === 0)
    .map((account) => account.id)

  $: groupOptions = groups.map((group) => {
    const memberIds = accounts
      .filter((account) => account.groupIds.includes(group.id))
      .map((account) => account.id)
    return { group, memberIds }
  })

  let selectedGroupKeys: string[] = []

  // initialize selection: by default include ungrouped + every group that has at least 1 visible member.
  $: if (
    selectedGroupKeys.length === 0 &&
    (ungroupedIds.length > 0 || groupOptions.some((opt) => opt.memberIds.length > 0))
  ) {
    selectedGroupKeys = [
      ...(ungroupedIds.length > 0 ? ['__ungrouped__'] : []),
      ...groupOptions.filter((opt) => opt.memberIds.length > 0).map((opt) => opt.group.id)
    ]
  }

  function isGroupSelected(key: string): boolean {
    return selectedGroupKeys.includes(key)
  }

  function toggleGroupSelected(key: string): void {
    if (selectedGroupKeys.includes(key)) {
      selectedGroupKeys = selectedGroupKeys.filter((existing) => existing !== key)
    } else {
      selectedGroupKeys = [...selectedGroupKeys, key]
    }
  }

  $: selectedAccountIdLookup = (() => {
    const lookup: Record<string, true> = {}
    if (selectedGroupKeys.includes('__ungrouped__')) {
      for (const id of ungroupedIds) lookup[id] = true
    }
    for (const opt of groupOptions) {
      if (selectedGroupKeys.includes(opt.group.id)) {
        for (const id of opt.memberIds) lookup[id] = true
      }
    }
    return lookup
  })()

  $: candidateAccounts = (() => {
    const filtered = accounts.filter((account) => selectedAccountIdLookup[account.id])
    return eligibleAccountsForRefresh(filtered, thresholdMs, nowMs)
  })()

  $: candidateCount = candidateAccounts.length

  $: selectedConfirmCount = candidateAccounts.reduce(
    (count, account) => (selectedConfirmIds[account.id] ? count + 1 : count),
    0
  )

  // selection driven from `confirming` checkbox list — keyed by account id, defaults to "all selected".
  let selectedConfirmIds: Record<string, true> = {}

  function resetConfirmSelection(): void {
    const next: Record<string, true> = {}
    for (const account of candidateAccounts) next[account.id] = true
    selectedConfirmIds = next
  }

  function isConfirmSelected(accountId: string): boolean {
    return selectedConfirmIds[accountId] === true
  }

  function toggleConfirmSelected(accountId: string): void {
    if (selectedConfirmIds[accountId]) {
      const { [accountId]: _omit, ...rest } = selectedConfirmIds
      selectedConfirmIds = rest
    } else {
      selectedConfirmIds = { ...selectedConfirmIds, [accountId]: true }
    }
  }

  function selectAllConfirm(): void {
    resetConfirmSelection()
  }

  function clearConfirmSelection(): void {
    selectedConfirmIds = {}
  }

  $: previewAccounts = (() => {
    if (phase === 'confirming') return candidateAccounts
    if (phase === 'running' || phase === 'done') {
      const map = new Map(accounts.map((account) => [account.id, account]))
      return candidateAccountIds
        .map((accountId) => map.get(accountId))
        .filter((account): account is AccountSummary => Boolean(account))
    }
    return [] as AccountSummary[]
  })()

  $: doneCount =
    phase === 'running' || phase === 'done'
      ? candidateAccountIds.filter((id) => {
          const row = progressByAccountId[id]
          return row?.status === 'success' || row?.status === 'error'
        }).length
      : 0

  $: failureCount = summary?.failureCount ?? 0
  $: successCount = summary?.successCount ?? 0

  $: closeDisabled = phase === 'running'

  function applyPreset(hours: PresetHours): void {
    thresholdHours = hours
  }

  function expiryLabel(account: AccountSummary): string {
    if (typeof account.accessTokenExpiresAt !== 'number') return ''
    const remaining = account.accessTokenExpiresAt - nowMs
    if (remaining <= 0) return copy.refreshTokensBatchExpired
    return copy.refreshTokensBatchExpiresIn(formatDurationCompact(remaining, language))
  }

  function rowStatusLabel(row: RowState | undefined): string {
    if (!row) return copy.refreshTokensBatchRowPending
    switch (row.status) {
      case 'pending':
        return copy.refreshTokensBatchRowPending
      case 'running':
        return copy.refreshTokensBatchRowRunning
      case 'success':
        return copy.refreshTokensBatchRowSuccess
      case 'error':
        return copy.refreshTokensBatchRowError
    }
  }

  function rowStatusClass(row: RowState | undefined): string {
    const status = row?.status ?? 'pending'
    switch (status) {
      case 'pending':
        return 'bg-[var(--surface-soft)] text-muted-strong'
      case 'running':
        return 'bg-sky-500/12 text-sky-700'
      case 'success':
        return 'bg-emerald-500/12 text-emerald-700'
      case 'error':
        return 'border border-danger/30 text-danger'
    }
  }

  function rowDotClass(row: RowState | undefined): string {
    const status = row?.status ?? 'pending'
    switch (status) {
      case 'pending':
        return 'bg-muted-strong/40'
      case 'running':
        return 'bg-sky-500 animate-pulse'
      case 'success':
        return 'bg-emerald-500'
      case 'error':
        return 'bg-danger'
    }
  }

  function truncateError(message: string | undefined): string {
    if (!message) return ''
    if (message.length <= 120) return message
    return `${message.slice(0, 120)}…`
  }

  function handleNext(): void {
    if (!candidateCount) return
    nowMs = Date.now()
    resetConfirmSelection()
    phase = 'confirming'
  }

  function handleConfirm(): void {
    const ids = candidateAccounts
      .filter((account) => isConfirmSelected(account.id))
      .map((account) => account.id)
    if (ids.length === 0) return
    onSubmit(ids)
  }

  function handleBack(): void {
    if (phase === 'running') return
    phase = 'idle'
  }

  function handleClose(): void {
    if (closeDisabled) return
    onClose()
  }

  // refresh "expires in" labels every 30s while idle / confirming
  onMount(() => {
    nowTimer = setInterval(() => {
      if (phase === 'idle' || phase === 'confirming') {
        nowMs = Date.now()
      }
    }, 30_000)

    return () => {
      if (nowTimer) clearInterval(nowTimer)
    }
  })
</script>

<AppDialog
  ariaLabel={copy.refreshTokensBatchTitle}
  title={copy.refreshTokensBatchTitle}
  description={copy.refreshTokensBatchDescription}
  maxWidthClass="max-w-3xl"
  panelClass="refresh-tokens-batch-panel"
  zIndexClass="z-50"
  closeOnBackdrop={false}
  {closeDisabled}
  showClose
  scrollable
  onclose={handleClose}
>
  <div class="flex flex-col gap-4 px-4 py-3 text-[13px]">
    {#if error}
      <p
        class="theme-error-panel rounded-[0.45rem] border border-danger/18 bg-danger/8 px-3 py-2 text-sm font-medium text-danger"
      >
        {error}
      </p>
    {/if}

    {#if phase === 'idle'}
      <section class="flex flex-col gap-3 rounded-[0.65rem] bg-[var(--panel-strong)] px-3 py-3">
        <header class="flex items-center justify-between gap-2">
          <h4 class="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">
            {copy.refreshTokensBatchThresholdLabel}
          </h4>
          <span class="text-[12px] font-semibold text-carbon">
            {copy.refreshTokensBatchThresholdValue(thresholdHours)}
          </span>
        </header>
        <input
          type="range"
          min="1"
          max="240"
          step="1"
          bind:value={thresholdHours}
          class="threshold-range"
          aria-label={copy.refreshTokensBatchThresholdLabel}
        />
        <div class="flex flex-wrap items-center gap-1.5">
          {#each PRESET_HOURS as hours (hours)}
            <AppButton
              variant={thresholdHours === hours ? 'primary' : 'secondary'}
              size="xs"
              onclick={() => applyPreset(hours)}
            >
              {#if hours === 1}{copy.refreshTokensBatchPreset1h}
              {:else if hours === 6}{copy.refreshTokensBatchPreset6h}
              {:else if hours === 24}{copy.refreshTokensBatchPreset24h}
              {:else if hours === 72}{copy.refreshTokensBatchPreset3d}
              {:else}{copy.refreshTokensBatchPreset10d}{/if}
            </AppButton>
          {/each}
        </div>
        <p class="text-[11px] text-faint">{copy.refreshTokensBatchExcludedNoExpiry}</p>
      </section>

      <section class="flex flex-col gap-2 rounded-[0.65rem] bg-[var(--panel-strong)] px-3 py-3">
        <h4 class="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">
          {copy.refreshTokensBatchGroupTargets}
        </h4>
        <div class="flex flex-wrap gap-1.5">
          {#if ungroupedIds.length > 0}
            <button
              type="button"
              class="group-toggle"
              class:is-selected={isGroupSelected('__ungrouped__')}
              onclick={() => toggleGroupSelected('__ungrouped__')}
            >
              <span class="i-lucide-circle-slash h-3 w-3"></span>
              <span>{copy.refreshTokensBatchUngrouped}</span>
              <span class="group-toggle-count">{ungroupedIds.length}</span>
            </button>
          {/if}
          {#each groupOptions as opt (opt.group.id)}
            {#if opt.memberIds.length > 0}
              <button
                type="button"
                class="group-toggle"
                class:is-selected={isGroupSelected(opt.group.id)}
                onclick={() => toggleGroupSelected(opt.group.id)}
              >
                <span class="i-lucide-tag h-3 w-3"></span>
                <span>{opt.group.name}</span>
                <span class="group-toggle-count">{opt.memberIds.length}</span>
              </button>
            {/if}
          {/each}
        </div>
      </section>

      <div class="flex items-center justify-between gap-2">
        <span class="text-[12px] text-carbon"
          >{copy.refreshTokensBatchCandidateCount(candidateCount)}</span
        >
        <AppButton variant="primary" size="sm" disabled={candidateCount === 0} onclick={handleNext}>
          <span class="i-lucide-list-checks h-3.5 w-3.5"></span>
          <span>{copy.refreshTokensBatchNext}</span>
        </AppButton>
      </div>
    {:else if phase === 'confirming'}
      <section class="flex flex-col gap-2 rounded-[0.65rem] bg-[var(--panel-strong)] px-3 py-3">
        <header class="flex flex-wrap items-center justify-between gap-2">
          <h4 class="text-[12px] font-semibold text-carbon">
            {copy.refreshTokensBatchPreviewTitle}
          </h4>
          <div class="flex items-center gap-2">
            <span class="text-[11px] text-muted-strong"
              >{copy.refreshTokensBatchSelectedCount(
                selectedConfirmCount,
                previewAccounts.length
              )}</span
            >
            <AppButton
              variant="secondary"
              size="xs"
              disabled={selectedConfirmCount === previewAccounts.length}
              onclick={selectAllConfirm}
            >
              <span>{copy.refreshTokensBatchSelectAll}</span>
            </AppButton>
            <AppButton
              variant="secondary"
              size="xs"
              disabled={selectedConfirmCount === 0}
              onclick={clearConfirmSelection}
            >
              <span>{copy.refreshTokensBatchClearSelection}</span>
            </AppButton>
          </div>
        </header>
        <ul class="flex max-h-72 flex-col gap-1.5 overflow-y-auto pr-1">
          {#each previewAccounts as account (account.id)}
            {@const checked = isConfirmSelected(account.id)}
            <li
              class="flex items-center justify-between gap-3 rounded-[0.45rem] bg-[var(--surface-soft)] px-2.5 py-2"
            >
              <label class="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  class="confirm-check"
                  {checked}
                  onchange={() => toggleConfirmSelected(account.id)}
                />
                <span class="truncate text-[12px] font-medium text-carbon"
                  >{accountEmail(account, copy)}</span
                >
              </label>
              <span class="flex-none text-[11px] text-muted-strong">{expiryLabel(account)}</span>
            </li>
          {/each}
        </ul>
      </section>
    {:else}
      <section class="flex flex-col gap-2 rounded-[0.65rem] bg-[var(--panel-strong)] px-3 py-3">
        <header class="flex items-center justify-between gap-2">
          <h4 class="text-[12px] font-semibold text-carbon">
            {phase === 'done'
              ? copy.refreshTokensBatchSummary(successCount, failureCount)
              : copy.refreshTokensBatchRunning(doneCount, candidateAccountIds.length)}
          </h4>
        </header>
        <ul class="flex max-h-80 flex-col gap-1.5 overflow-y-auto pr-1">
          {#each previewAccounts as account (account.id)}
            {@const row = progressByAccountId[account.id]}
            <li
              class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 rounded-[0.45rem] bg-[var(--surface-soft)] px-2.5 py-2"
            >
              <span class={`row-dot h-2 w-2 rounded-full ${rowDotClass(row)}`} aria-hidden="true"
              ></span>
              <div class="flex min-w-0 flex-col gap-0.5">
                <span class="truncate text-[12px] font-medium text-carbon"
                  >{accountEmail(account, copy)}</span
                >
                {#if row?.status === 'error' && row.error}
                  <span class="break-words text-[11px] leading-snug text-danger" title={row.error}
                    >{truncateError(row.error)}</span
                  >
                {/if}
              </div>
              <div class="flex flex-none items-center gap-2">
                <span
                  class={`inline-flex items-center rounded-[0.32rem] px-1.5 py-0.5 text-[10px] font-medium ${rowStatusClass(row)}`}
                  >{rowStatusLabel(row)}</span
                >
                {#if row?.durationMs !== undefined}
                  <span class="text-[10px] tabular-nums text-muted-strong"
                    >{copy.refreshTokensBatchDuration(row.durationMs)}</span
                  >
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  </div>

  <svelte:fragment slot="footer">
    <div class="flex w-full items-center justify-end gap-2 px-4 py-3">
      {#if phase === 'idle'}
        <AppButton variant="secondary" size="sm" onclick={handleClose}>
          <span>{copy.refreshTokensBatchClose}</span>
        </AppButton>
      {:else if phase === 'confirming'}
        <AppButton variant="secondary" size="sm" onclick={handleBack}>
          <span class="i-lucide-arrow-left h-3.5 w-3.5"></span>
          <span>{copy.refreshTokensBatchBack}</span>
        </AppButton>
        <AppButton
          variant="primary"
          size="sm"
          onclick={handleConfirm}
          disabled={selectedConfirmCount === 0}
        >
          <span class="i-lucide-refresh-ccw-dot h-3.5 w-3.5"></span>
          <span>{copy.refreshTokensBatchConfirm}</span>
        </AppButton>
      {:else if phase === 'running'}
        <AppButton variant="secondary" size="sm" disabled>
          <span class="i-lucide-loader-circle h-3.5 w-3.5 animate-spin"></span>
          <span>{copy.refreshTokensBatchRunning(doneCount, candidateAccountIds.length)}</span>
        </AppButton>
      {:else}
        {#if failureCount > 0}
          <AppButton variant="secondary" size="sm" onclick={onRetryFailed}>
            <span class="i-lucide-refresh-ccw h-3.5 w-3.5"></span>
            <span>{copy.refreshTokensBatchRetryFailed}</span>
          </AppButton>
        {/if}
        <AppButton variant="primary" size="sm" onclick={handleClose}>
          <span>{copy.refreshTokensBatchClose}</span>
        </AppButton>
      {/if}
    </div>
  </svelte:fragment>
</AppDialog>

<style>
  .threshold-range {
    width: 100%;
    accent-color: var(--color-carbon);
  }

  .confirm-check {
    width: 14px;
    height: 14px;
    accent-color: var(--color-carbon);
    flex: none;
    cursor: pointer;
  }

  .group-toggle {
    appearance: none;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    border: 1px solid var(--line-strong);
    border-radius: 0.42rem;
    background: transparent;
    color: var(--ink-soft-strong);
    cursor: pointer;
    padding: 0.28rem 0.55rem;
    font-size: 11px;
    font-weight: 600;
    transition:
      background-color 140ms ease,
      border-color 140ms ease,
      color 140ms ease;
  }

  .group-toggle:hover:not(:disabled) {
    background: var(--surface-hover);
    color: var(--color-carbon);
  }

  .group-toggle.is-selected {
    border-color: var(--color-carbon);
    background: var(--color-carbon);
    color: var(--color-snow);
  }

  .group-toggle-count {
    display: inline-flex;
    min-width: 1.1rem;
    align-items: center;
    justify-content: center;
    border-radius: 0.32rem;
    padding: 0 0.32rem;
    font-size: 10px;
    font-weight: 700;
    background: color-mix(in srgb, var(--color-carbon) 12%, transparent);
  }

  .group-toggle.is-selected .group-toggle-count {
    background: color-mix(in srgb, var(--color-snow) 22%, transparent);
  }

  :global(.refresh-tokens-batch-panel) {
    background: var(--dialog-bg);
  }
</style>
