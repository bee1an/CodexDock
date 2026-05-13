<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import type {
    AccountGroup,
    AccountSummary,
    LocalGatewayLogEntry,
    LocalGatewayModelMapping,
    LocalGatewayStatus,
    PortOccupant
  } from '../../../shared/codex'
  import { accountEmail, type LocalizedCopy } from './app-view'
  import AppButton from './AppButton.svelte'
  import AppDialog from './AppDialog.svelte'
  import AppInput from './AppInput.svelte'

  type StatusFilter = 'all' | 'ok' | 'warn' | 'error'

  export let copy: LocalizedCopy
  export let localGatewayStatus: LocalGatewayStatus
  export let localGatewayBusy = false
  export let localGatewayApiKey = ''
  export let modelMappings: LocalGatewayModelMapping[] = []
  export let allowedGroupIds: string[] = []
  export let allowedAccountIds: string[] = []
  export let groups: AccountGroup[] = []
  export let accounts: AccountSummary[] = []
  export let startLocalGateway: () => Promise<void>
  export let stopLocalGateway: () => Promise<void>
  export let rotateLocalGatewayKey: () => Promise<void>
  export let openLocalGatewayInCodex: () => Promise<void> = async () => {}
  export let updateModelMappings: (
    mappings: LocalGatewayModelMapping[]
  ) => Promise<void> = async () => {}
  export let updateAllowedGroups: (groupIds: string[]) => Promise<void> = async () => {}
  export let updateAllowedAccounts: (accountIds: string[]) => Promise<void> = async () => {}
  export let portOccupant: PortOccupant | null = null
  export let killingPortOccupant = false
  export let killPortOccupant: () => Promise<void> = async () => {}

  let allowedGroupsBusy = false
  let allowedAccountsBusy = false
  let showAccountPicker = false

  const toggleAllowedGroup = async (groupId: string): Promise<void> => {
    if (allowedGroupsBusy) return
    const next = allowedGroupIds.includes(groupId)
      ? allowedGroupIds.filter((id) => id !== groupId)
      : [...allowedGroupIds, groupId]
    allowedGroupsBusy = true
    try {
      await updateAllowedGroups(next)
    } finally {
      allowedGroupsBusy = false
    }
  }

  const toggleAllowedAccount = async (accountId: string): Promise<void> => {
    if (allowedAccountsBusy) return
    const next = allowedAccountIdSet.has(accountId)
      ? allowedStandaloneAccountIds.filter((id) => id !== accountId)
      : [...allowedStandaloneAccountIds, accountId]
    allowedAccountsBusy = true
    try {
      await updateAllowedAccounts(next)
    } finally {
      allowedAccountsBusy = false
    }
  }

  let draftFrom = ''
  let draftTo = ''
  let mappingError = ''
  let mappingBusy = false
  let showMappingDialog = false

  const normalizeMappingValue = (value: string): string => value.trim()

  const addMapping = async (): Promise<void> => {
    if (mappingBusy) return
    const from = normalizeMappingValue(draftFrom)
    const to = normalizeMappingValue(draftTo)
    if (!from || !to) {
      mappingError = ''
      return
    }
    if (modelMappings.some((entry) => entry.from === from)) {
      mappingError = copy.localGatewayModelMappingDuplicate
      return
    }
    mappingError = ''
    mappingBusy = true
    try {
      await updateModelMappings([...modelMappings, { from, to }])
      draftFrom = ''
      draftTo = ''
    } finally {
      mappingBusy = false
    }
  }

  const removeMapping = async (from: string): Promise<void> => {
    if (mappingBusy) return
    mappingError = ''
    mappingBusy = true
    try {
      await updateModelMappings(modelMappings.filter((entry) => entry.from !== from))
    } finally {
      mappingBusy = false
    }
  }

  const onAddMappingKey = (event: KeyboardEvent): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void addMapping()
    }
  }

  let displayedStatus: LocalGatewayStatus = localGatewayStatus
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let logSearch = ''
  let statusFilter: StatusFilter = 'all'
  let gatewayApiKeyVisible = false
  let gatewayApiKeyBusy = false
  let revealedLocalGatewayApiKey = ''

  const statusFilters: StatusFilter[] = ['all', 'ok', 'warn', 'error']

  const copyText = async (value: string): Promise<void> => {
    if (value) await navigator.clipboard.writeText(value)
  }

  const revealGatewayApiKey = async (): Promise<string> => {
    if (revealedLocalGatewayApiKey || localGatewayApiKey) {
      return localGatewayApiKey || revealedLocalGatewayApiKey
    }
    if (gatewayApiKeyBusy) {
      return ''
    }
    gatewayApiKeyBusy = true
    try {
      revealedLocalGatewayApiKey = await window.codexApp.getLocalGatewayApiKey()
      await refreshGatewayStatus()
      return revealedLocalGatewayApiKey
    } finally {
      gatewayApiKeyBusy = false
    }
  }

  const toggleGatewayApiKeyVisible = async (): Promise<void> => {
    if (gatewayApiKeyVisible) {
      gatewayApiKeyVisible = false
      return
    }
    const apiKey = await revealGatewayApiKey()
    gatewayApiKeyVisible = Boolean(apiKey)
  }

  const copyGatewayApiKey = async (): Promise<void> => {
    const apiKey = await revealGatewayApiKey()
    await copyText(apiKey)
  }

  let refreshingStatus = false

  const refreshGatewayStatus = async (): Promise<void> => {
    try {
      displayedStatus = await window.codexApp.getLocalGatewayStatus()
    } catch {
      displayedStatus = localGatewayStatus
    }
  }

  const refreshGatewayManually = async (): Promise<void> => {
    if (refreshingStatus) return
    refreshingStatus = true
    try {
      await refreshGatewayStatus()
    } finally {
      refreshingStatus = false
    }
  }

  const formatNumber = (value: number): string =>
    new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)

  const formatLogTime = (value: string): string => {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return '--:--:--'
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(date)
  }

  const methodClass = (method: string): string => {
    if (method === 'GET') return 'gateway-method-get'
    if (method === 'SYSTEM') return 'gateway-method-system'
    return 'gateway-method-write'
  }

  const statusClass = (status: number): string => {
    if (status >= 500) return 'gateway-status-error'
    if (status >= 400) return 'gateway-status-warn'
    return 'gateway-status-success'
  }

  const latencyClass = (durationMs: number): string => {
    if (durationMs >= 800) return 'gateway-latency-error'
    if (durationMs >= 350) return 'gateway-latency-warn'
    return 'text-carbon'
  }

  const statusFilterLabel = (filter: StatusFilter): string => {
    if (filter === 'all') return copy.localGatewayAllStatus
    if (filter === 'ok') return '2xx / 3xx'
    if (filter === 'warn') return '4xx'
    return '5xx'
  }

  const matchesStatusFilter = (log: LocalGatewayLogEntry, filter: StatusFilter): boolean => {
    if (filter === 'all') return true
    if (filter === 'ok') return log.status < 400
    if (filter === 'warn') return log.status >= 400 && log.status < 500
    return log.status >= 500
  }

  const matchesSearch = (log: LocalGatewayLogEntry, query: string): boolean => {
    if (!query) return true
    return [log.method, log.path, log.provider, log.model, String(log.status), log.message]
      .filter(Boolean)
      .some((value) => value?.toLowerCase().includes(query))
  }

  const logDetail = (log: LocalGatewayLogEntry): string =>
    log.status !== 200 ? log.message || `HTTP ${log.status}` : ''

  const resolvePort = (baseUrl: string): string => {
    try {
      const parsed = new URL(baseUrl)
      if (parsed.port) return parsed.port
      return parsed.protocol === 'https:' ? '443' : '80'
    } catch {
      return '-'
    }
  }

  $: displayedStatus = localGatewayStatus
  $: fullGatewayApiKey = localGatewayApiKey || revealedLocalGatewayApiKey
  $: gatewayKey =
    gatewayApiKeyVisible && fullGatewayApiKey
      ? fullGatewayApiKey
      : displayedStatus.apiKeyPreview || 'sk-cdock-…'
  $: endpointUrl = `${displayedStatus.baseUrl}/v1`
  $: logs = displayedStatus.logs ?? []
  $: statusText = displayedStatus.running ? copy.localGatewayRunning : copy.localGatewayStopped
  $: healthText = displayedStatus.running
    ? copy.localGatewayHealthReady
    : copy.localGatewayHealthIdle
  $: gatewayPort = resolvePort(displayedStatus.baseUrl)
  $: totalRequests = logs.length
  $: errorCount = logs.filter((log) => log.status >= 400).length
  $: successRate = totalRequests
    ? new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 0 }).format(
        (totalRequests - errorCount) / totalRequests
      )
    : '—'
  $: avgLatency = totalRequests
    ? `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(
        Math.round(logs.reduce((total, log) => total + log.durationMs, 0) / totalRequests)
      )} ms`
    : '—'
  $: normalizedLogSearch = logSearch.trim().toLowerCase()
  $: visibleLogs = logs.filter(
    (log) => matchesStatusFilter(log, statusFilter) && matchesSearch(log, normalizedLogSearch)
  )
  $: allowedGroupIdSet = new Set(allowedGroupIds)
  $: standaloneAccounts = accounts.filter((account) => account.groupIds.length === 0)
  $: standaloneAccountIdSet = new Set(standaloneAccounts.map((account) => account.id))
  $: allowedStandaloneAccountIds = allowedAccountIds.filter((id) => standaloneAccountIdSet.has(id))
  $: allowedAccountIdSet = new Set(allowedStandaloneAccountIds)
  $: selectedStandaloneAccounts = standaloneAccounts.filter((account) =>
    allowedAccountIdSet.has(account.id)
  )
  $: availableStandaloneAccounts = standaloneAccounts.filter(
    (account) => !allowedAccountIdSet.has(account.id)
  )
  $: allowedTargetCount = allowedGroupIds.length + selectedStandaloneAccounts.length
  $: hasAllowedEntities = allowedTargetCount > 0
  $: startDisabled = localGatewayBusy || !hasAllowedEntities

  onMount(() => {
    void refreshGatewayStatus()
    pollTimer = setInterval(() => void refreshGatewayStatus(), 2000)
  })

  onDestroy(() => {
    if (pollTimer) clearInterval(pollTimer)
  })
</script>

<div
  class="gateway-container gateway-scrollbar flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4"
>
  <div
    class="gateway-toolbar theme-soft-panel flex flex-wrap items-center justify-between gap-3 rounded-[0.55rem] border border-black/8 px-4 py-4"
  >
    <div class="flex min-w-[18rem] flex-1 items-center gap-3">
      <div
        class="gateway-title-icon flex h-7 w-7 flex-none items-center justify-center rounded-[0.4rem] border"
      >
        <span class="i-lucide-network h-4 w-4" aria-hidden="true"></span>
      </div>
      <div class="min-w-0">
        <div class="flex min-w-0 items-center gap-2">
          <h2 class="truncate text-[13px] font-semibold text-carbon text-balance">
            {copy.localGatewayTitle}
          </h2>
          <div
            class={`gateway-status-pill inline-flex flex-none items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium ${displayedStatus.running ? 'gateway-status-pill-running' : 'gateway-status-pill-idle'}`}
            aria-live="polite"
          >
            <span class="h-1.5 w-1.5 rounded-full" aria-hidden="true"></span>
            <span>{statusText}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="flex flex-wrap items-center justify-end gap-1.5">
      <AppButton
        variant="secondary"
        size="xs"
        class="hidden max-w-[18rem] gap-1.5 text-muted-strong lg:inline-flex"
        onclick={() => void copyText(endpointUrl)}
        ariaLabel={copy.copyLocalGatewayBaseUrl}
        title={endpointUrl}
      >
        <span class="i-lucide-link h-3.5 w-3.5 flex-none" aria-hidden="true"></span>
        <span class="truncate font-mono tabular-nums" translate="no">{endpointUrl}</span>
      </AppButton>

      <AppButton
        variant="secondary"
        size="xs"
        onclick={() => void rotateLocalGatewayKey()}
        disabled={localGatewayBusy}
        ariaLabel={copy.rotateLocalGatewayKey}
      >
        <span class="i-lucide-rotate-cw h-3.5 w-3.5" aria-hidden="true"></span>
        <span>{copy.rotateLocalGatewayKey}</span>
      </AppButton>

      <AppButton
        variant="secondary"
        size="xs"
        onclick={() => void openLocalGatewayInCodex()}
        disabled={localGatewayBusy || !displayedStatus.running}
        ariaLabel={copy.localGatewayOpenCodex}
        title={displayedStatus.running
          ? copy.localGatewayOpenCodex
          : copy.localGatewayOpenCodexRequiresRunning}
      >
        {#if localGatewayBusy}
          <span
            class="i-lucide-loader-circle gateway-spinner h-3.5 w-3.5 animate-spin"
            aria-hidden="true"
          ></span>
        {:else}
          <span class="i-lucide-copy-plus h-3.5 w-3.5" aria-hidden="true"></span>
        {/if}
        <span>{copy.localGatewayOpenCodex}</span>
      </AppButton>

      {#if displayedStatus.running}
        <AppButton
          variant="danger"
          size="xs"
          onclick={() => void stopLocalGateway()}
          disabled={localGatewayBusy}
          ariaLabel={copy.stopLocalGateway}
        >
          {#if localGatewayBusy}
            <span
              class="i-lucide-loader-circle gateway-spinner h-3.5 w-3.5 animate-spin"
              aria-hidden="true"
            ></span>
          {:else}
            <span class="i-lucide-square h-3.5 w-3.5" aria-hidden="true"></span>
          {/if}
          <span>{copy.stopLocalGateway}</span>
        </AppButton>
      {:else}
        <AppButton
          variant="primary"
          size="xs"
          onclick={() => void startLocalGateway()}
          disabled={startDisabled}
          ariaLabel={copy.startLocalGateway}
          title={hasAllowedEntities ? copy.startLocalGateway : copy.localGatewayAllowedGroupsRequired}
        >
          {#if localGatewayBusy}
            <span
              class="i-lucide-loader-circle gateway-spinner h-3.5 w-3.5 animate-spin"
              aria-hidden="true"
            ></span>
          {:else}
            <span class="i-lucide-play h-3.5 w-3.5" aria-hidden="true"></span>
          {/if}
          <span>{copy.startLocalGateway}</span>
        </AppButton>
      {/if}
    </div>
  </div>

  <div class="gateway-scroll flex flex-col gap-4 overflow-x-hidden">
    {#if displayedStatus.lastError}
      <div
        class="gateway-error flex items-start gap-2 rounded-[0.45rem] border p-2.5 text-xs text-danger"
        role="alert"
        aria-live="polite"
      >
        <span class="i-lucide-alert-circle mt-0.5 h-4 w-4 flex-none" aria-hidden="true"></span>
        <span class="min-w-0 break-words leading-relaxed">{displayedStatus.lastError}</span>
      </div>
    {/if}

    {#if portOccupant}
      <div
        class="gateway-port-conflict flex flex-wrap items-center justify-between gap-3 rounded-[0.45rem] border px-3 py-2.5"
        role="status"
      >
        <div class="flex min-w-0 items-start gap-2 text-xs">
          <span
            class="i-lucide-alert-triangle mt-0.5 h-4 w-4 flex-none gateway-port-conflict-icon"
            aria-hidden="true"
          ></span>
          <span class="gateway-port-conflict-text min-w-0 break-words leading-relaxed">
            {copy.localGatewayPortOccupied(Number(gatewayPort) || 0, portOccupant.command, portOccupant.pid)}
          </span>
        </div>
        <AppButton
          variant="secondary"
          size="xs"
          onclick={killPortOccupant}
          disabled={killingPortOccupant}
        >
          {#if killingPortOccupant}
            <span class="i-lucide-loader-circle h-3.5 w-3.5 animate-spin" aria-hidden="true"></span>
          {:else}
            <span class="i-lucide-skull h-3.5 w-3.5" aria-hidden="true"></span>
          {/if}
          <span>{copy.killLocalGatewayPortOccupant}</span>
        </AppButton>
      </div>
    {/if}

    <section
      class="gateway-overview-grid grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)] xl:grid-cols-[minmax(0,1.15fr)_minmax(420px,0.85fr)]"
      aria-label={copy.localGatewayConfigHint}
    >
      <div class="gateway-panel gateway-config-panel overflow-hidden rounded-[0.45rem] border">
        <div
          class="gateway-config-header flex items-center justify-between gap-3 border-b px-3 py-2"
        >
          <div class="flex min-w-0 items-center gap-2">
            <span
              class="gateway-section-icon flex h-6 w-6 flex-none items-center justify-center rounded-[0.35rem] border"
              aria-hidden="true"
            >
              <span class="i-lucide-sliders-horizontal h-3.5 w-3.5"></span>
            </span>
            <div class="min-w-0">
              <h3 class="truncate text-[12px] font-semibold leading-4 text-carbon">
                {copy.localGatewayConfigHint}
              </h3>
              <p class="truncate text-[10px] leading-4 text-muted-strong">
                OpenAI / Claude / Gemini
              </p>
            </div>
          </div>
          <div class="flex flex-none items-center gap-1.5">
            <span
              class="gateway-config-badge inline-flex items-center rounded-[0.28rem] border px-1.5 py-0.5 text-[10px] font-medium text-muted-strong"
            >
              Sub2API
            </span>
            <span
              class="gateway-config-badge inline-flex items-center gap-1 rounded-[0.28rem] border px-1.5 py-0.5 text-[10px] font-mono font-medium tabular-nums text-muted-strong"
            >
              <span class="i-lucide-radio-tower h-3 w-3" aria-hidden="true"></span>
              {gatewayPort}
            </span>
          </div>
        </div>

        <div class="grid gap-2 p-2.5">
          <div class="gateway-config-field min-w-0 overflow-hidden rounded-[0.35rem] border">
            <div class="gateway-config-value flex min-w-0 items-center gap-2 px-2.5 py-2">
              <span
                class="gateway-config-icon flex h-7 w-7 flex-none items-center justify-center rounded-[0.35rem] border"
                aria-hidden="true"
              >
                <span class="i-lucide-link h-3.5 w-3.5"></span>
              </span>
              <div class="min-w-0 flex-1">
                <p
                  class="mb-1 truncate text-[9px] font-medium uppercase leading-none tracking-[0.08em] text-faint"
                >
                  OPENAI_BASE_URL
                </p>
                <code
                  class="gateway-config-code min-w-0 truncate font-mono text-[12px] font-semibold text-carbon select-all"
                  title={endpointUrl}
                  translate="no"
                >
                  {endpointUrl}
                </code>
              </div>
              <AppButton
                variant="icon"
                size="xs"
                class="flex-none"
                onclick={() => void copyText(endpointUrl)}
                ariaLabel={copy.copyLocalGatewayBaseUrl}
                title={copy.copyLocalGatewayBaseUrl}
              >
                <span class="i-lucide-copy h-3.5 w-3.5" aria-hidden="true"></span>
              </AppButton>
            </div>
          </div>

          <div class="gateway-config-field min-w-0 overflow-hidden rounded-[0.35rem] border">
            <div class="gateway-config-value flex min-w-0 items-center gap-2 px-2.5 py-2">
              <span
                class="gateway-config-icon flex h-7 w-7 flex-none items-center justify-center rounded-[0.35rem] border"
                aria-hidden="true"
              >
                <span class="i-lucide-key-round h-3.5 w-3.5"></span>
              </span>
              <div class="min-w-0 flex-1">
                <p
                  class="mb-1 truncate text-[9px] font-medium uppercase leading-none tracking-[0.08em] text-faint"
                >
                  OPENAI_API_KEY
                </p>
                <code
                  class="gateway-config-code min-w-0 truncate font-mono text-[12px] font-semibold text-carbon select-all"
                  title={gatewayKey}
                  translate="no"
                >
                  {gatewayKey || copy.localGatewayNoApiKey}
                </code>
              </div>
              <AppButton
                variant="icon"
                size="xs"
                class="flex-none"
                onclick={() => void toggleGatewayApiKeyVisible()}
                disabled={gatewayApiKeyBusy}
                ariaLabel={gatewayApiKeyVisible
                  ? copy.localGatewayHideApiKey
                  : copy.localGatewayShowApiKey}
                title={gatewayApiKeyVisible
                  ? copy.localGatewayHideApiKey
                  : copy.localGatewayShowApiKey}
              >
                <span
                  class={`${gatewayApiKeyBusy ? 'i-lucide-loader-circle animate-spin' : gatewayApiKeyVisible ? 'i-lucide-eye-off' : 'i-lucide-eye'} h-3.5 w-3.5`}
                  aria-hidden="true"
                ></span>
              </AppButton>
              <AppButton
                variant="icon"
                size="xs"
                class="flex-none"
                onclick={() => void copyGatewayApiKey()}
                disabled={gatewayApiKeyBusy}
                ariaLabel={copy.copyLocalGatewayApiKey}
                title={copy.copyLocalGatewayApiKey}
              >
                <span class="i-lucide-copy h-3.5 w-3.5" aria-hidden="true"></span>
              </AppButton>
            </div>
          </div>
        </div>
      </div>

      <div
        class="gateway-metrics-grid grid grid-cols-2 gap-2 rounded-[0.45rem] border p-2"
      >
        <div class="gateway-metric-card rounded-[0.45rem] border p-3">
          <div class="mb-2 flex items-center justify-between gap-2">
            <p class="truncate text-[10px] font-medium uppercase tracking-[0.08em] text-faint">
              {copy.localGatewayHealth}
            </p>
            <span class="i-lucide-heart-pulse h-3.5 w-3.5 text-muted-strong" aria-hidden="true"
            ></span>
          </div>
          <p class="truncate text-sm font-semibold text-carbon">{healthText}</p>
        </div>
        <div class="gateway-metric-card rounded-[0.45rem] border p-3">
          <div class="mb-2 flex items-center justify-between gap-2">
            <p class="truncate text-[10px] font-medium uppercase tracking-[0.08em] text-faint">
              {copy.localGatewayRequests}
            </p>
            <span class="i-lucide-activity h-3.5 w-3.5 text-muted-strong" aria-hidden="true"></span>
          </div>
          <p
            class="truncate font-mono text-sm font-semibold tabular-nums text-carbon"
            translate="no"
          >
            {formatNumber(totalRequests)}
          </p>
        </div>
        <div class="gateway-metric-card rounded-[0.45rem] border p-3">
          <div class="mb-2 flex items-center justify-between gap-2">
            <p class="truncate text-[10px] font-medium uppercase tracking-[0.08em] text-faint">
              {copy.localGatewaySuccessRate}
            </p>
            <span class="i-lucide-badge-check h-3.5 w-3.5 text-muted-strong" aria-hidden="true"
            ></span>
          </div>
          <p class="truncate font-mono text-sm font-semibold tabular-nums text-carbon">
            {successRate}
          </p>
        </div>
        <div class="gateway-metric-card rounded-[0.45rem] border p-3">
          <div class="mb-2 flex items-center justify-between gap-2">
            <p class="truncate text-[10px] font-medium uppercase tracking-[0.08em] text-faint">
              {copy.localGatewayAvgLatency}
            </p>
            <span class="i-lucide-timer h-3.5 w-3.5 text-muted-strong" aria-hidden="true"></span>
          </div>
          <p class="truncate font-mono text-sm font-semibold tabular-nums text-carbon">
            {avgLatency}
          </p>
        </div>
      </div>
    </section>

    <section
      class="gateway-panel gateway-groups-panel rounded-[0.45rem] border"
      aria-labelledby="local-gateway-groups-heading"
    >
      <div
        class="gateway-mappings-header flex flex-wrap items-start justify-between gap-3 border-b px-3 py-2.5"
      >
        <div class="flex min-w-0 items-start gap-2">
          <span
            class="gateway-section-icon flex h-6 w-6 flex-none items-center justify-center rounded-[0.35rem] border"
            aria-hidden="true"
          >
            <span class="i-lucide-users h-3.5 w-3.5"></span>
          </span>
          <div class="min-w-0">
            <div class="flex min-w-0 items-center gap-2">
              <h3 id="local-gateway-groups-heading" class="text-[12px] font-semibold text-carbon">
                {copy.localGatewayAllowedGroupsTitle}
              </h3>
              <span
                class="gateway-status-pill inline-flex items-center rounded border px-1.5 py-0.5 text-[9px] font-mono font-medium tabular-nums text-muted-strong"
              >
                {formatNumber(allowedTargetCount)}
              </span>
            </div>
            <p class="mt-0.5 text-[10px] leading-4 text-faint">
              {copy.localGatewayAllowedGroupsHint}
            </p>
          </div>
        </div>
      </div>

      <div class="flex flex-col gap-2 p-3">
        <div class="flex flex-wrap gap-1.5">
          {#each groups.filter((g) => allowedGroupIdSet.has(g.id)) as group (group.id)}
            <AppButton
              variant="filter"
              size="xs"
              selected
              ariaPressed={true}
              disabled={allowedGroupsBusy || localGatewayBusy}
              onclick={() => void toggleAllowedGroup(group.id)}
            >
              <span class="i-lucide-check h-3 w-3" aria-hidden="true"></span>
              <span>{group.name}</span>
            </AppButton>
          {/each}
          {#each selectedStandaloneAccounts as account (account.id)}
            <AppButton
              variant="filter"
              size="xs"
              selected
              ariaPressed={true}
              disabled={allowedAccountsBusy || localGatewayBusy}
              onclick={() => void toggleAllowedAccount(account.id)}
            >
              <span class="i-lucide-check h-3 w-3" aria-hidden="true"></span>
              <span>{accountEmail(account, copy)}</span>
            </AppButton>
          {/each}
          <AppButton
            variant="secondary"
            size="xs"
            onclick={() => { showAccountPicker = !showAccountPicker }}
            ariaLabel={showAccountPicker ? copy.closeDialog : copy.localGatewayAllowedTargetsAdd}
            title={showAccountPicker ? copy.closeDialog : copy.localGatewayAllowedTargetsAdd}
          >
            <span class={`${showAccountPicker ? 'i-lucide-minus' : 'i-lucide-plus'} h-3 w-3`} aria-hidden="true"></span>
          </AppButton>
        </div>
        {#if showAccountPicker}
          <div class="flex flex-wrap gap-1.5 border-t border-black/8 pt-2">
            {#each groups.filter((g) => !allowedGroupIdSet.has(g.id)) as group (group.id)}
              <AppButton
                variant="filter"
                size="xs"
                selected={false}
                ariaPressed={false}
                disabled={allowedGroupsBusy || localGatewayBusy}
                onclick={() => void toggleAllowedGroup(group.id)}
              >
                <span class="i-lucide-folder h-3 w-3" aria-hidden="true"></span>
                <span>{group.name}</span>
              </AppButton>
            {/each}
            {#each availableStandaloneAccounts as account (account.id)}
              <AppButton
                variant="filter"
                size="xs"
                selected={false}
                ariaPressed={false}
                disabled={allowedAccountsBusy || localGatewayBusy}
                onclick={() => void toggleAllowedAccount(account.id)}
              >
                <span class="i-lucide-user h-3 w-3" aria-hidden="true"></span>
                <span>{accountEmail(account, copy)}</span>
              </AppButton>
            {/each}
          </div>
        {/if}
        {#if !hasAllowedEntities && !showAccountPicker}
          <p class="text-[11px] leading-4 text-danger" role="alert">
            {copy.localGatewayAllowedGroupsRequired}
          </p>
        {/if}
      </div>
    </section>

    <div class="gateway-panel flex items-center gap-2 rounded-[0.45rem] border px-3 py-2.5">
      <span
        class="gateway-section-icon flex h-6 w-6 flex-none items-center justify-center rounded-[0.35rem] border"
        aria-hidden="true"
      >
        <span class="i-lucide-arrow-left-right h-3.5 w-3.5"></span>
      </span>
      <div class="min-w-0 flex-1">
        <div class="flex min-w-0 items-center gap-2">
          <h3 class="text-[12px] font-semibold text-carbon">
            {copy.localGatewayModelMappingsTitle}
          </h3>
          <span
            class="gateway-status-pill inline-flex items-center rounded border px-1.5 py-0.5 text-[9px] font-mono font-medium tabular-nums text-muted-strong"
          >
            {formatNumber(modelMappings.length)}
          </span>
        </div>
      </div>
      <AppButton
        variant="secondary"
        size="xs"
        onclick={() => {
          showMappingDialog = true
        }}
      >
        <span class="i-lucide-settings-2 h-3.5 w-3.5" aria-hidden="true"></span>
        <span>{copy.localGatewayModelMappingsManage}</span>
      </AppButton>
    </div>

    <section
      class="gateway-panel gateway-logs-panel rounded-[0.45rem] border"
      aria-labelledby="local-gateway-logs-heading"
    >
      <div
        class="gateway-logs-header flex flex-wrap items-center justify-between gap-3 border-b px-3 py-2.5"
      >
        <div class="flex min-w-0 items-center gap-2">
          <div class="min-w-0">
            <div class="flex min-w-0 items-center gap-2">
              <h3 id="local-gateway-logs-heading" class="text-[12px] font-semibold text-carbon">
                {copy.localGatewayLogs}
              </h3>
              <span
                class="gateway-status-pill inline-flex items-center rounded border px-1.5 py-0.5 text-[9px] font-mono font-medium tabular-nums text-muted-strong"
              >
                {formatNumber(visibleLogs.length)} / {formatNumber(totalRequests)}
              </span>
              {#if errorCount}
                <span
                  class="gateway-errors-badge inline-flex items-center rounded border px-1.5 py-0.5 text-[9px] font-mono font-medium tabular-nums"
                >
                  {formatNumber(errorCount)}
                  {copy.localGatewayErrors}
                </span>
              {/if}
            </div>
            <p class="mt-0.5 truncate text-[10px] leading-4 text-faint">
              {copy.localGatewayLogsHint}
            </p>
          </div>
        </div>

        <div class="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
          <AppInput
            id="local-gateway-log-search"
            name="local-gateway-log-search"
            type="search"
            variant="search"
            size="xs"
            icon="i-lucide-search"
            class="min-w-[180px] flex-1 sm:flex-none sm:w-56"
            autocomplete="off"
            spellcheck={false}
            ariaLabel={copy.localGatewaySearchLogs}
            placeholder={copy.localGatewaySearchLogs}
            bind:value={logSearch}
          />
          <AppButton
            variant="icon"
            size="sm"
            onclick={() => void refreshGatewayManually()}
            disabled={refreshingStatus}
            ariaLabel={copy.localGatewayLogs}
            title={copy.localGatewayLogs}
          >
            <span
              class={`${refreshingStatus ? 'i-lucide-loader-circle animate-spin' : 'i-lucide-refresh-cw'} h-3.5 w-3.5`}
              aria-hidden="true"
            ></span>
          </AppButton>
        </div>
      </div>

      <div class="gateway-log-filters flex flex-wrap gap-1.5 border-b px-3 py-2">
        {#each statusFilters as option (option)}
          <AppButton
            variant="filter"
            size="xs"
            selected={statusFilter === option}
            ariaPressed={statusFilter === option}
            ariaLabel={`${copy.localGatewayStatusFilter}: ${statusFilterLabel(option)}`}
            onclick={() => (statusFilter = option)}
          >
            {statusFilterLabel(option)}
          </AppButton>
        {/each}
      </div>

      <div class="gateway-table-container">
        {#if visibleLogs.length}
          <div class="gateway-scrollbar max-h-[400px] overflow-auto">
            <table class="w-full text-left text-xs" aria-label={copy.localGatewayLogs}>
              <thead
                class="sticky top-0 z-10 gateway-table-head text-[10px] font-medium uppercase tracking-[0.08em] text-faint"
              >
                <tr>
                  <th class="px-3 py-2 font-normal whitespace-nowrap">{copy.localGatewayLogTime}</th
                  >
                  <th class="px-3 py-2 font-normal whitespace-nowrap"
                    >{copy.localGatewayLogMethod}</th
                  >
                  <th class="px-3 py-2 font-normal w-full min-w-[180px] max-w-[280px]"
                    >{copy.localGatewayLogPath}</th
                  >
                  <th class="px-3 py-2 font-normal whitespace-nowrap"
                    >{copy.localGatewayLogProvider}</th
                  >
                  <th class="px-3 py-2 font-normal whitespace-nowrap"
                    >{copy.localGatewayLogModel}</th
                  >
                  <th class="px-3 py-2 font-normal whitespace-nowrap text-right"
                    >{copy.localGatewayLogTokens}</th
                  >
                  <th class="px-3 py-2 font-normal whitespace-nowrap text-right"
                    >{copy.localGatewayLogLatency}</th
                  >
                  <th class="px-3 py-2 font-normal whitespace-nowrap text-right"
                    >{copy.localGatewayLogStatus}</th
                  >
                </tr>
              </thead>
              <tbody class="divide-y gateway-divide">
                {#each visibleLogs as log (log.id)}
                  <tr class="gateway-table-row transition-colors duration-140">
                    <td
                      class="px-3 py-1.5 font-mono text-[11px] text-muted-strong whitespace-nowrap tabular-nums"
                      >{formatLogTime(log.timestamp)}</td
                    >
                    <td class="px-3 py-1.5 whitespace-nowrap">
                      <span
                        class={`gateway-method-pill rounded-[0.28rem] border px-1.5 py-0.5 font-mono text-[9px] font-bold leading-none ${methodClass(log.method)}`}
                        >{log.method}</span
                      >
                    </td>
                    <td
                      class="px-3 py-1.5 font-mono text-[11px] text-carbon truncate max-w-[280px]"
                      title={log.path}
                      translate="no">{log.path}</td
                    >
                    <td
                      class="px-3 py-1.5 text-muted-strong truncate max-w-[120px]"
                      title={log.provider ?? '—'}>{log.provider ?? '—'}</td
                    >
                    <td
                      class="px-3 py-1.5 font-mono text-[11px] text-carbon truncate max-w-[140px]"
                      title={log.model ?? '—'}
                      translate="no">{log.model ?? '—'}</td
                    >
                    <td
                      class="px-3 py-1.5 text-right font-mono text-[11px] text-muted-strong tabular-nums"
                      >{formatNumber(log.tokens ?? 0)}</td
                    >
                    <td class="px-3 py-1.5 text-right whitespace-nowrap">
                      <span
                        class={`font-mono text-[11px] tabular-nums ${latencyClass(log.durationMs)}`}
                        >{formatNumber(log.durationMs)} ms</span
                      >
                    </td>
                    <td class="px-3 py-1.5 text-right whitespace-nowrap">
                      <span
                        class={`gateway-status-code rounded-[0.28rem] border px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums ${statusClass(log.status)}`}
                        >{log.status}</span
                      >
                    </td>
                  </tr>
                  {#if logDetail(log)}
                    <tr class="gateway-log-detail-row">
                      <td colspan="8" class="px-3 pb-2">
                        <div
                          class="gateway-log-detail flex min-w-0 items-start gap-2 rounded-[0.35rem] border px-2.5 py-2"
                        >
                          <span
                            class="i-lucide-alert-circle mt-0.5 h-3.5 w-3.5 flex-none text-danger/70"
                            aria-hidden="true"
                          ></span>
                          <span class="text-[10px] font-medium text-muted-strong"
                            >{copy.localGatewayLogDetail}</span
                          >
                          <code
                            class="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-carbon"
                            >{logDetail(log)}</code
                          >
                        </div>
                      </td>
                    </tr>
                  {/if}
                {/each}
              </tbody>
            </table>
          </div>
        {:else}
          <div
            class="gateway-empty-state flex flex-col items-center justify-center px-6 py-10 text-center text-muted-strong"
          >
            <span class="i-lucide-inbox mb-2 h-6 w-6 opacity-50" aria-hidden="true"></span>
            <p class="text-[11px] font-medium">
              {totalRequests ? copy.localGatewayNoMatchedLogs : copy.localGatewayNoLogs}
            </p>
            <p class="mt-1 max-w-[18rem] text-[10px] leading-4 text-faint">
              {copy.localGatewayLogsHint}
            </p>
          </div>
        {/if}
      </div>
    </section>
  </div>
</div>

{#if showMappingDialog}
  <AppDialog
    title={copy.localGatewayModelMappingsTitle}
    description={copy.localGatewayModelMappingsHint}
    closeLabel={copy.closeDialog}
    showClose
    scrollable
    closeDisabled={mappingBusy}
    maxWidthClass="max-w-2xl"
    onclose={() => {
      if (!mappingBusy) showMappingDialog = false
    }}
  >
    <div class="grid gap-4">
      <div class="flex flex-wrap items-center gap-2" data-dialog-motion>
        <AppInput
          id="local-gateway-mapping-from"
          name="local-gateway-mapping-from"
          size="xs"
          class="min-w-[180px] flex-1"
          autocomplete="off"
          spellcheck={false}
          placeholder={copy.localGatewayModelMappingFromPlaceholder}
          bind:value={draftFrom}
          onkeydown={onAddMappingKey}
        />
        <span
          class="i-lucide-arrow-right h-3.5 w-3.5 flex-none text-muted-strong"
          aria-hidden="true"
        ></span>
        <AppInput
          id="local-gateway-mapping-to"
          name="local-gateway-mapping-to"
          size="xs"
          class="min-w-[180px] flex-1"
          autocomplete="off"
          spellcheck={false}
          placeholder={copy.localGatewayModelMappingToPlaceholder}
          bind:value={draftTo}
          onkeydown={onAddMappingKey}
        />
        <AppButton
          variant="primary"
          size="xs"
          onclick={() => void addMapping()}
          disabled={mappingBusy || !draftFrom.trim() || !draftTo.trim()}
          ariaLabel={copy.localGatewayModelMappingAdd}
        >
          <span class="i-lucide-plus h-3.5 w-3.5" aria-hidden="true"></span>
          <span>{copy.localGatewayModelMappingAdd}</span>
        </AppButton>
      </div>

      {#if mappingError}
        <p class="text-[11px] leading-4 text-danger" role="alert" data-dialog-motion>
          {mappingError}
        </p>
      {/if}

      {#if modelMappings.length}
        <ul class="flex flex-col gap-1.5" data-dialog-motion>
          {#each modelMappings as entry (entry.from)}
            <li
              class="gateway-mapping-row flex items-center gap-2 rounded-[0.35rem] border px-2.5 py-1.5"
            >
              <code
                class="min-w-0 flex-1 truncate font-mono text-[11px] font-semibold text-carbon"
                title={entry.from}
                translate="no">{entry.from}</code
              >
              <span
                class="i-lucide-arrow-right h-3.5 w-3.5 flex-none text-muted-strong"
                aria-hidden="true"
              ></span>
              <code
                class="min-w-0 flex-1 truncate font-mono text-[11px] font-semibold text-carbon"
                title={entry.to}
                translate="no">{entry.to}</code
              >
              <AppButton
                variant="icon"
                size="xs"
                class="flex-none"
                onclick={() => void removeMapping(entry.from)}
                disabled={mappingBusy}
                ariaLabel={copy.localGatewayModelMappingRemove}
                title={copy.localGatewayModelMappingRemove}
              >
                <span class="i-lucide-trash-2 h-3.5 w-3.5" aria-hidden="true"></span>
              </AppButton>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="text-[11px] leading-4 text-faint" data-dialog-motion>
          {copy.localGatewayModelMappingsEmpty}
        </p>
      {/if}
    </div>

    <svelte:fragment slot="footer">
      <AppButton
        variant="secondary"
        size="sm"
        onclick={() => {
          showMappingDialog = false
        }}
        disabled={mappingBusy}
      >
        {copy.closeDialog}
      </AppButton>
    </svelte:fragment>
  </AppDialog>
{/if}

<style>
  .gateway-container {
    background: transparent;
  }

  .gateway-scrollbar {
    scrollbar-width: thin;
    scrollbar-color: color-mix(in srgb, var(--ink-faint) 46%, transparent) transparent;
  }

  .gateway-scrollbar::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }

  .gateway-scrollbar::-webkit-scrollbar-track {
    background: transparent;
  }

  .gateway-scrollbar::-webkit-scrollbar-thumb {
    border: 2px solid transparent;
    border-radius: 999px;
    background-clip: padding-box;
    background-color: color-mix(in srgb, var(--ink-faint) 38%, transparent);
  }

  .gateway-scrollbar::-webkit-scrollbar-thumb:hover {
    background-color: color-mix(in srgb, var(--ink-soft-strong) 46%, transparent);
  }

  .gateway-toolbar {
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, var(--edge-light) 64%, transparent),
      0 1px 0 color-mix(in srgb, var(--edge-dark) 16%, transparent);
  }

  .gateway-title-icon,
  .gateway-section-icon,
  .gateway-config-icon,
  .gateway-config-badge,
  .gateway-config-field,
  .gateway-metric-card,
  .gateway-metrics-grid {
    border-color: color-mix(in srgb, var(--line-strong) 76%, transparent);
    background: color-mix(in srgb, var(--panel-strong) 84%, var(--surface-soft));
  }

  .gateway-title-icon {
    color: var(--ink-soft-strong);
    box-shadow: 0 1px 0 color-mix(in srgb, var(--edge-light) 58%, transparent) inset;
  }

  .gateway-panel {
    background: color-mix(in srgb, var(--panel-strong) 92%, var(--surface-soft));
    border-color: color-mix(in srgb, var(--line-strong) 76%, transparent);
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, var(--edge-light) 46%, transparent),
      0 1px 0 color-mix(in srgb, var(--edge-dark) 14%, transparent);
  }

  .gateway-config-panel {
    min-height: 100%;
  }

  .gateway-config-header {
    border-color: color-mix(in srgb, var(--line-strong) 74%, transparent);
    background: color-mix(in srgb, var(--surface-soft) 66%, transparent);
  }

  .gateway-section-icon,
  .gateway-config-icon {
    color: var(--ink-soft-strong);
    background: color-mix(in srgb, var(--surface-soft) 72%, transparent);
  }

  .gateway-config-field {
    background: color-mix(in srgb, var(--panel-strong) 76%, var(--surface-soft));
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, var(--edge-light) 48%, transparent),
      0 0 0 1px color-mix(in srgb, var(--edge-dark) 10%, transparent);
  }

  .gateway-config-value {
    background: color-mix(in srgb, var(--panel-strong) 90%, transparent);
    min-height: 3rem;
  }

  .gateway-config-code {
    display: block;
    padding: 0;
    border-radius: 0;
    background: transparent;
    color: var(--color-carbon);
    line-height: 1.2;
  }

  .gateway-metric-card {
    min-width: 0;
    background: color-mix(in srgb, var(--panel-strong) 96%, transparent);
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, var(--edge-light) 44%, transparent),
      0 1px 0 color-mix(in srgb, var(--edge-dark) 12%, transparent);
    transition:
      border-color 140ms ease,
      background-color 140ms ease,
      box-shadow 140ms ease;
  }

  .gateway-metric-card:hover {
    border-color: color-mix(in srgb, var(--line-strong) 92%, transparent);
    background: color-mix(in srgb, var(--panel-strong) 100%, transparent);
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, var(--edge-light) 64%, transparent),
      0 2px 6px color-mix(in srgb, var(--edge-dark) 18%, transparent);
  }

  .gateway-metrics-grid {
    background: color-mix(in srgb, var(--surface-soft) 50%, transparent);
  }

  .gateway-status-pill {
    border-color: var(--color-arctic-mist);
    background: var(--surface-soft);
    color: var(--ink-soft-strong);
  }

  .gateway-status-pill-running span:first-child {
    background: var(--success);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--success) 14%, transparent);
  }

  .gateway-status-pill-idle span:first-child {
    background: var(--ink-faint);
  }

  .gateway-error {
    border-color: color-mix(in srgb, var(--danger) 30%, var(--color-arctic-mist));
    background: color-mix(in srgb, var(--danger) 8%, transparent);
  }

  .gateway-port-conflict {
    border-color: color-mix(in srgb, var(--warn) 35%, transparent);
    background: color-mix(in srgb, var(--warn) 10%, transparent);
  }

  .gateway-port-conflict-icon {
    color: var(--warn);
  }

  .gateway-port-conflict-text {
    color: color-mix(in srgb, var(--ink) 85%, var(--warn));
  }

  .gateway-divide {
    border-color: color-mix(in srgb, var(--color-arctic-mist) 82%, transparent);
  }

  .gateway-table-container {
    border-color: color-mix(in srgb, var(--line-strong) 76%, transparent);
    background: color-mix(in srgb, var(--panel-strong) 96%, transparent);
  }

  .gateway-logs-header,
  .gateway-log-filters {
    border-color: color-mix(in srgb, var(--line-strong) 72%, transparent);
  }

  .gateway-logs-header {
    background: color-mix(in srgb, var(--surface-soft) 62%, transparent);
  }

  .gateway-log-filters {
    background: color-mix(in srgb, var(--panel-strong) 78%, var(--surface-soft));
  }

  .gateway-table-head {
    background: color-mix(in srgb, var(--surface-soft) 92%, var(--panel-strong));
    border-bottom: 1px solid color-mix(in srgb, var(--line-strong) 78%, transparent);
    backdrop-filter: blur(10px);
  }

  .gateway-table-row {
    background: color-mix(in srgb, var(--panel-strong) 98%, transparent);
  }

  .gateway-table-row:nth-child(even) {
    background: color-mix(in srgb, var(--surface-soft) 22%, var(--panel-strong));
  }

  .gateway-table-row:hover {
    background: var(--surface-hover);
    box-shadow: inset 3px 0 0 color-mix(in srgb, var(--ink-soft-strong) 72%, transparent);
  }

  .gateway-log-detail {
    border-color: color-mix(in srgb, var(--line-strong) 64%, transparent);
    background: transparent;
    border-left: 3px solid color-mix(in srgb, var(--color-danger) 56%, transparent);
  }

  .gateway-method-pill,
  .gateway-status-code {
    display: inline-flex;
    min-width: 2.75rem;
    align-items: center;
    justify-content: center;
    border-color: var(--color-arctic-mist);
    background: var(--surface-soft);
  }

  .gateway-empty-state {
    background: color-mix(in srgb, var(--surface-soft) 36%, transparent);
  }

  .gateway-mapping-row {
    border-color: color-mix(in srgb, var(--line-strong) 68%, transparent);
    background: color-mix(in srgb, var(--panel-strong) 90%, var(--surface-soft));
  }

  .gateway-mappings-header {
    border-color: color-mix(in srgb, var(--line-strong) 72%, transparent);
    background: color-mix(in srgb, var(--surface-soft) 62%, transparent);
  }

  .gateway-method-get {
    border-color: color-mix(in srgb, var(--success) 22%, var(--color-arctic-mist));
    background: color-mix(in srgb, var(--success) 8%, transparent);
    color: var(--success);
  }

  .gateway-method-system {
    border-color: var(--color-arctic-mist);
    background: color-mix(in srgb, var(--surface-soft) 80%, transparent);
    color: var(--ink-soft-strong);
  }

  .gateway-method-write {
    border-color: color-mix(in srgb, var(--color-carbon) 18%, var(--color-arctic-mist));
    background: color-mix(in srgb, var(--color-carbon) 7%, transparent);
    color: var(--accent-deep);
  }

  .gateway-status-success {
    border-color: color-mix(in srgb, var(--success) 22%, var(--color-arctic-mist));
    background: transparent;
    color: var(--success);
  }

  .gateway-status-warn {
    border-color: color-mix(in srgb, var(--warn) 24%, var(--color-arctic-mist));
    background: color-mix(in srgb, var(--warn) 10%, transparent);
    color: var(--warn);
  }

  .gateway-status-error {
    border-color: color-mix(in srgb, var(--danger) 24%, var(--color-arctic-mist));
    background: color-mix(in srgb, var(--danger) 10%, transparent);
    color: var(--danger);
  }

  .gateway-errors-badge {
    border-color: color-mix(in srgb, var(--danger) 24%, var(--color-arctic-mist));
    background: color-mix(in srgb, var(--danger) 10%, transparent);
    color: var(--danger);
  }

  .gateway-latency-warn {
    color: var(--warn);
  }

  .gateway-latency-error {
    color: var(--danger);
  }

  :global(html[data-theme='dark']) .gateway-toolbar {
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, var(--edge-light) 46%, transparent),
      0 1px 0 color-mix(in srgb, var(--edge-dark) 14%, transparent);
  }

  :global(html[data-theme='dark']) .gateway-scrollbar {
    scrollbar-color: color-mix(in srgb, var(--color-arctic-mist) 48%, transparent) transparent;
  }

  :global(html[data-theme='dark']) .gateway-scrollbar::-webkit-scrollbar-thumb {
    background-color: color-mix(in srgb, var(--color-arctic-mist) 38%, transparent);
  }

  :global(html[data-theme='dark']) .gateway-scrollbar::-webkit-scrollbar-thumb:hover {
    background-color: color-mix(in srgb, var(--color-arctic-mist) 58%, transparent);
  }

  :global(html[data-theme='dark']) .gateway-title-icon,
  :global(html[data-theme='dark']) .gateway-section-icon,
  :global(html[data-theme='dark']) .gateway-config-icon,
  :global(html[data-theme='dark']) .gateway-config-badge,
  :global(html[data-theme='dark']) .gateway-config-field,
  :global(html[data-theme='dark']) .gateway-metric-card,
  :global(html[data-theme='dark']) .gateway-metrics-grid,
  :global(html[data-theme='dark']) .gateway-status-pill,
  :global(html[data-theme='dark']) .gateway-panel,
  :global(html[data-theme='dark']) .gateway-table-container {
    background: color-mix(in srgb, var(--panel-strong) 90%, var(--surface-soft));
    border-color: color-mix(in srgb, var(--color-arctic-mist) 82%, transparent);
  }

  :global(html[data-theme='dark']) .gateway-config-header {
    background: color-mix(in srgb, var(--surface-soft) 72%, transparent);
    border-color: color-mix(in srgb, var(--color-arctic-mist) 86%, transparent);
  }

  :global(html[data-theme='dark']) .gateway-config-value {
    background: color-mix(in srgb, var(--surface-soft) 42%, transparent);
  }

  :global(html[data-theme='dark']) .gateway-metric-card,
  :global(html[data-theme='dark']) .gateway-config-field {
    background: color-mix(in srgb, var(--panel-strong) 96%, transparent);
  }

  :global(html[data-theme='dark']) .gateway-logs-header,
  :global(html[data-theme='dark']) .gateway-log-filters {
    border-color: color-mix(in srgb, var(--color-arctic-mist) 84%, transparent);
  }

  :global(html[data-theme='dark']) .gateway-logs-header {
    background: color-mix(in srgb, var(--surface-soft) 70%, transparent);
  }

  :global(html[data-theme='dark']) .gateway-log-filters {
    background: color-mix(in srgb, var(--surface-soft) 38%, var(--panel-strong));
  }

  :global(html[data-theme='dark']) .gateway-table-head {
    background: color-mix(in srgb, var(--surface-soft) 76%, var(--panel-strong));
    border-bottom-color: color-mix(in srgb, var(--color-arctic-mist) 86%, transparent);
  }

  :global(html[data-theme='dark']) .gateway-table-row {
    background: color-mix(in srgb, var(--panel-strong) 96%, transparent);
  }

  :global(html[data-theme='dark']) .gateway-table-row:nth-child(even) {
    background: color-mix(in srgb, var(--surface-soft) 28%, var(--panel-strong));
  }

  :global(html[data-theme='dark']) .gateway-log-detail {
    border-color: color-mix(in srgb, var(--color-arctic-mist) 72%, transparent);
    background: transparent;
    border-left-color: color-mix(in srgb, var(--color-danger) 62%, transparent);
  }

  :global(html[data-theme='dark']) .gateway-mappings-header {
    background: color-mix(in srgb, var(--surface-soft) 70%, transparent);
    border-color: color-mix(in srgb, var(--color-arctic-mist) 84%, transparent);
  }

  :global(html[data-theme='dark']) .gateway-mapping-row {
    background: color-mix(in srgb, var(--panel-strong) 94%, transparent);
    border-color: color-mix(in srgb, var(--color-arctic-mist) 80%, transparent);
  }

  @media (prefers-reduced-motion: reduce) {
    .gateway-table-row {
      transition-duration: 0ms;
    }

    .gateway-spinner {
      animation: none !important;
    }
  }
</style>
