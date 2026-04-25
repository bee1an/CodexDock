<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import type { LocalGatewayLogEntry, LocalGatewayStatus } from '../../../shared/codex'
  import type { LocalizedCopy } from './app-view'

  type StatusFilter = 'all' | 'ok' | 'warn' | 'error'

  export let copy: LocalizedCopy
  export let iconRowButton: string
  export let primaryActionButton: string
  export let compactGhostButton: string
  export let localGatewayStatus: LocalGatewayStatus
  export let localGatewayBusy = false
  export let localGatewayApiKey = ''
  export let startLocalGateway: () => Promise<void>
  export let stopLocalGateway: () => Promise<void>
  export let rotateLocalGatewayKey: () => Promise<void>

  let displayedStatus: LocalGatewayStatus = localGatewayStatus
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let logSearch = ''
  let statusFilter: StatusFilter = 'all'

  const statusFilters: StatusFilter[] = ['all', 'ok', 'warn', 'error']

  const copyText = async (value: string): Promise<void> => {
    if (value) await navigator.clipboard.writeText(value)
  }

  const refreshGatewayStatus = async (): Promise<void> => {
    try {
      displayedStatus = await window.codexApp.getLocalGatewayStatus()
    } catch {
      displayedStatus = localGatewayStatus
    }
  }

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
    if (method === 'GET') return 'text-sky-600'
    if (method === 'SYSTEM') return 'text-muted-strong'
    return 'text-emerald-600'
  }

  const statusClass = (status: number): string => {
    if (status >= 500) return 'text-danger'
    if (status >= 400) return 'text-warn'
    return 'text-success'
  }

  const latencyClass = (durationMs: number): string => {
    if (durationMs >= 800) return 'text-danger'
    if (durationMs >= 350) return 'text-warn'
    return 'text-ink'
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
  $: gatewayKey = localGatewayApiKey || displayedStatus.apiKeyPreview || 'sk-cdock-...'
  $: logs = displayedStatus.logs ?? []
  $: statusText = displayedStatus.running ? copy.localGatewayRunning : copy.localGatewayStopped
  $: healthText = displayedStatus.running
    ? copy.localGatewayHealthReady
    : copy.localGatewayHealthIdle
  $: gatewayPort = resolvePort(displayedStatus.baseUrl)
  $: totalRequests = logs.length
  $: errorCount = logs.filter((log) => log.status >= 400).length
  $: successRate = totalRequests
    ? `${Math.round(((totalRequests - errorCount) / totalRequests) * 100)}%`
    : '--'
  $: avgLatency = totalRequests
    ? `${Math.round(logs.reduce((total, log) => total + log.durationMs, 0) / totalRequests)} ms`
    : '--'
  $: normalizedLogSearch = logSearch.trim().toLowerCase()
  $: visibleLogs = logs.filter(
    (log) => matchesStatusFilter(log, statusFilter) && matchesSearch(log, normalizedLogSearch)
  )

  onMount(() => {
    void refreshGatewayStatus()
    pollTimer = setInterval(() => void refreshGatewayStatus(), 2000)
  })

  onDestroy(() => {
    if (pollTimer) clearInterval(pollTimer)
  })
</script>

<div class="gateway-container flex h-full min-h-0 flex-1 flex-col overflow-hidden">
  <!-- Top action bar area, analogous to AccountsListView toolbar -->
  <div class="gateway-toolbar flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2">
    <div class="flex items-center gap-3">
      <div class="flex items-center gap-2">
        <span class="i-lucide-network h-4.5 w-4.5 text-muted-strong"></span>
        <h2 class="text-[13px] font-semibold text-ink">{copy.localGatewayTitle}</h2>
      </div>
      <div class="flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium gateway-status-pill">
        <span class={`h-1.5 w-1.5 rounded-full ${displayedStatus.running ? 'bg-success' : 'bg-black/20 dark:bg-white/20'}`}></span>
        <span>{statusText}</span>
      </div>
    </div>
    <div class="flex flex-wrap items-center justify-end gap-1.5">
      <button
        class="inline-flex min-w-[80px] items-center justify-center gap-1.5 rounded-[0.35rem] border border-black/8 dark:border-white/10 bg-white dark:bg-white/5 px-2.5 py-1.5 text-[11px] font-medium leading-none text-ink transition-colors duration-140 hover:bg-black/[0.04] dark:hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
        type="button"
        onclick={() => void rotateLocalGatewayKey()}
        disabled={localGatewayBusy}
        title={copy.rotateLocalGatewayKey}
      >
        <span class="i-lucide-rotate-cw h-3.5 w-3.5"></span>
        <span>{copy.rotateLocalGatewayKey}</span>
      </button>

      {#if displayedStatus.running}
        <button
          class="inline-flex min-w-[80px] items-center justify-center gap-1.5 rounded-[0.35rem] border border-red-500/14 dark:border-red-500/20 bg-red-500/[0.08] dark:bg-red-500/10 px-2.5 py-1.5 text-[11px] font-medium leading-none text-danger transition-colors duration-140 hover:bg-red-500/[0.12] dark:hover:bg-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
          type="button"
          onclick={() => void stopLocalGateway()}
          disabled={localGatewayBusy}
        >
          {#if localGatewayBusy}
            <span class="i-lucide-loader-circle h-3.5 w-3.5 animate-spin"></span>
          {:else}
            <span class="i-lucide-square h-3.5 w-3.5"></span>
          {/if}
          <span>{copy.stopLocalGateway}</span>
        </button>
      {:else}
        <button
          class="inline-flex min-w-[80px] items-center justify-center gap-1.5 rounded-[0.35rem] border border-transparent bg-ink px-2.5 py-1.5 text-[11px] font-medium leading-none text-paper transition-colors duration-140 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          type="button"
          onclick={() => void startLocalGateway()}
          disabled={localGatewayBusy}
        >
          {#if localGatewayBusy}
            <span class="i-lucide-loader-circle h-3.5 w-3.5 animate-spin"></span>
          {:else}
            <span class="i-lucide-play h-3.5 w-3.5"></span>
          {/if}
          <span>{copy.startLocalGateway}</span>
        </button>
      {/if}
    </div>
  </div>

  <div class="flex-1 overflow-y-auto px-4 py-4 pb-8 space-y-5">
    {#if displayedStatus.lastError}
      <div class="gateway-error flex items-start gap-2 rounded-[0.45rem] border p-2.5 text-xs text-danger">
        <span class="i-lucide-alert-circle h-4 w-4 flex-none mt-0.5"></span>
        <span class="leading-relaxed">{displayedStatus.lastError}</span>
      </div>
    {/if}

    <p class="text-[12px] leading-5 text-muted-strong">{copy.localGatewayDescription}</p>

    <!-- Stats & Config Cards -->
    <div class="grid gap-3 lg:grid-cols-2">
      <div class="gateway-panel flex flex-col gap-4 rounded-[0.45rem] border p-3">
        <div class="flex justify-between gap-4">
          <div class="flex-1">
            <p class="text-[10px] font-medium uppercase tracking-[0.08em] text-faint mb-1.5">OPENAI_BASE_URL</p>
            <div class="flex items-center gap-1.5">
              <code class="text-xs font-mono text-ink truncate select-all">{displayedStatus.baseUrl}/v1</code>
              <button
                class="gateway-icon-button"
                type="button"
                onclick={() => void copyText(`${displayedStatus.baseUrl}/v1`)}
                title={copy.copyLocalGatewayBaseUrl}
              >
                <span class="i-lucide-copy h-3.5 w-3.5"></span>
              </button>
            </div>
          </div>
          <div class="w-px gateway-divider"></div>
          <div class="flex-1">
            <p class="text-[10px] font-medium uppercase tracking-[0.08em] text-faint mb-1.5">OPENAI_API_KEY</p>
            <div class="flex items-center gap-1.5">
              <code class="text-xs font-mono text-ink truncate select-all">
                {localGatewayApiKey || displayedStatus.apiKeyPreview || copy.localGatewayNoApiKey}
              </code>
              {#if localGatewayApiKey}
                <button
                  class="gateway-icon-button"
                  type="button"
                  onclick={() => void copyText(localGatewayApiKey)}
                  title={copy.copyLocalGatewayApiKey}
                >
                  <span class="i-lucide-copy h-3.5 w-3.5"></span>
                </button>
              {/if}
            </div>
          </div>
        </div>
      </div>

      <div class="gateway-panel grid grid-cols-4 items-center rounded-[0.45rem] border p-3 divide-x gateway-divide">
        <div class="px-2 text-center">
          <p class="text-[10px] font-medium uppercase tracking-[0.08em] text-faint mb-1.5 truncate">{copy.localGatewayHealth}</p>
          <p class="text-sm font-semibold text-ink truncate">{healthText}</p>
        </div>
        <div class="px-2 text-center">
          <p class="text-[10px] font-medium uppercase tracking-[0.08em] text-faint mb-1.5 truncate">{copy.localGatewayPort}</p>
          <p class="font-mono text-sm font-semibold text-ink truncate">{gatewayPort}</p>
        </div>
        <div class="px-2 text-center">
          <p class="text-[10px] font-medium uppercase tracking-[0.08em] text-faint mb-1.5 truncate">{copy.localGatewaySuccessRate}</p>
          <p class="font-mono text-sm font-semibold text-ink truncate">{successRate}</p>
        </div>
        <div class="px-2 text-center">
          <p class="text-[10px] font-medium uppercase tracking-[0.08em] text-faint mb-1.5 truncate">{copy.localGatewayAvgLatency}</p>
          <p class="font-mono text-sm font-semibold text-ink truncate">{avgLatency}</p>
        </div>
      </div>
    </div>

    <!-- Logs Area -->
    <div class="flex flex-col gap-3">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <h3 class="text-[12px] font-semibold text-ink">{copy.localGatewayLogs}</h3>
          <span class="inline-flex items-center rounded border gateway-status-pill px-1.5 py-0.5 text-[9px] font-mono font-medium text-muted-strong">
            {visibleLogs.length} / {totalRequests}
          </span>
          {#if errorCount}
            <span class="inline-flex items-center rounded border border-danger/20 bg-danger/10 px-1.5 py-0.5 text-[9px] font-mono font-medium text-danger">
              {errorCount} {copy.localGatewayErrors}
            </span>
          {/if}
        </div>
        <div class="flex items-center gap-2">
          <div class="relative w-48">
            <span class="i-lucide-search absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-strong"></span>
            <input
              class="gateway-input h-7 w-full rounded-[0.35rem] border pl-7 pr-2 text-xs text-ink placeholder-muted-strong outline-none"
              type="search"
              placeholder={copy.localGatewaySearchLogs}
              bind:value={logSearch}
            />
          </div>
          <button
            class="gateway-icon-button h-7 w-7 border rounded-[0.35rem]"
            type="button"
            onclick={() => void refreshGatewayStatus()}
            title={copy.localGatewayLogs}
          >
            <span class="i-lucide-refresh-cw h-3.5 w-3.5"></span>
          </button>
        </div>
      </div>

      <div class="flex flex-wrap gap-1.5">
        {#each statusFilters as option (option)}
          <button
            class={`theme-filter-chip rounded-[0.32rem] px-1.5 py-0.75 text-[10px] font-medium leading-none transition-colors duration-140 ${
              statusFilter === option
                ? 'theme-filter-chip-active bg-black text-white'
                : 'theme-filter-chip-idle border border-black/10 bg-black/[0.03] text-black/72 hover:bg-black/[0.06]'
            }`}
            type="button"
            onclick={() => (statusFilter = option)}
          >
            {statusFilterLabel(option)}
          </button>
        {/each}
      </div>

      <div class="gateway-table-container overflow-hidden rounded-[0.45rem] border">
        {#if visibleLogs.length}
          <div class="overflow-auto max-h-[400px]">
            <table class="w-full text-left text-xs">
              <thead class="sticky top-0 z-10 gateway-table-head text-[10px] font-medium text-faint">
                <tr>
                  <th class="px-3 py-2 font-normal whitespace-nowrap">{copy.localGatewayLogTime}</th>
                  <th class="px-3 py-2 font-normal whitespace-nowrap">{copy.localGatewayLogMethod}</th>
                  <th class="px-3 py-2 font-normal w-full max-w-[240px]">{copy.localGatewayLogPath}</th>
                  <th class="px-3 py-2 font-normal whitespace-nowrap">{copy.localGatewayLogProvider}</th>
                  <th class="px-3 py-2 font-normal whitespace-nowrap">{copy.localGatewayLogModel}</th>
                  <th class="px-3 py-2 font-normal whitespace-nowrap">{copy.localGatewayLogTokens}</th>
                  <th class="px-3 py-2 font-normal whitespace-nowrap text-right">{copy.localGatewayLogLatency}</th>
                  <th class="px-3 py-2 font-normal whitespace-nowrap text-right">{copy.localGatewayLogStatus}</th>
                </tr>
              </thead>
              <tbody class="divide-y gateway-divide">
                {#each visibleLogs as log (log.id)}
                  <tr class="gateway-table-row transition-colors duration-140">
                    <td class="px-3 py-1.5 font-mono text-[11px] text-muted-strong whitespace-nowrap">{formatLogTime(log.timestamp)}</td>
                    <td class="px-3 py-1.5 whitespace-nowrap">
                      <span class={`font-mono text-[10px] font-bold ${methodClass(log.method)}`}>{log.method}</span>
                    </td>
                    <td class="px-3 py-1.5 font-mono text-[11px] text-ink truncate max-w-[240px]" title={log.path}>{log.path}</td>
                    <td class="px-3 py-1.5 text-muted-strong truncate max-w-[100px]">{log.provider ?? '-'}</td>
                    <td class="px-3 py-1.5 font-mono text-[11px] text-ink truncate max-w-[120px]" title={log.model ?? '-'}>{log.model ?? '-'}</td>
                    <td class="px-3 py-1.5 font-mono text-[11px] text-muted-strong">{log.tokens ?? 0}</td>
                    <td class="px-3 py-1.5 text-right whitespace-nowrap">
                      <span class={`font-mono text-[11px] ${latencyClass(log.durationMs)}`}>{log.durationMs}ms</span>
                    </td>
                    <td class="px-3 py-1.5 text-right whitespace-nowrap">
                      <span class={`font-mono text-[11px] font-bold ${statusClass(log.status)}`}>{log.status}</span>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {:else}
          <div class="flex flex-col items-center justify-center p-8 text-center text-muted-strong">
            <span class="i-lucide-inbox h-6 w-6 opacity-50 mb-2"></span>
            <p class="text-[11px] font-medium">{totalRequests ? copy.localGatewayNoMatchedLogs : copy.localGatewayNoLogs}</p>
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .gateway-container {
    background: transparent;
  }

  .gateway-toolbar {
    border-color: var(--line);
    background: color-mix(in srgb, var(--surface-soft) 90%, var(--panel) 10%);
  }

  .gateway-status-pill {
    border-color: var(--line);
    background: var(--panel-strong);
    color: var(--ink-soft);
  }

  .gateway-error {
    border-color: color-mix(in srgb, var(--danger) 30%, var(--line));
    background: color-mix(in srgb, var(--danger) 8%, transparent);
  }

  .gateway-panel {
    background: var(--panel-strong);
    border-color: var(--line);
  }

  .gateway-divider {
    background: var(--line);
  }

  .gateway-divide {
    border-color: var(--line);
  }

  .gateway-icon-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--ink-soft);
    background: transparent;
    transition: color 140ms, background-color 140ms;
    border-color: var(--line);
  }

  .gateway-icon-button:hover {
    color: var(--ink);
    background: var(--surface-hover);
  }

  .gateway-input {
    background: var(--panel-strong);
    border-color: var(--line);
  }

  .gateway-input:focus {
    border-color: color-mix(in srgb, var(--ink) 30%, var(--line));
  }

  .gateway-table-container {
    border-color: var(--line);
    background: var(--panel-strong);
  }

  .gateway-table-head {
    background: var(--surface-soft);
    border-bottom: 1px solid var(--line);
  }

  .gateway-table-row:hover {
    background: var(--surface-hover);
  }

  :global(html[data-theme='dark']) .gateway-toolbar {
    border-color: var(--line);
    background: transparent;
  }

  :global(html[data-theme='dark']) .gateway-status-pill {
    border-color: var(--line);
    background: var(--panel-strong);
    color: var(--ink-soft);
  }

  :global(html[data-theme='dark']) .gateway-panel,
  :global(html[data-theme='dark']) .gateway-table-container {
    background: var(--panel-strong);
    border-color: var(--line);
  }

  :global(html[data-theme='dark']) .gateway-input {
    background: var(--panel-strong);
    border-color: var(--line);
  }

  :global(html[data-theme='dark']) .gateway-table-head {
    background: color-mix(in srgb, var(--surface-soft) 60%, transparent);
    border-bottom-color: var(--line);
    backdrop-filter: blur(12px);
  }

  :global(html[data-theme='dark']) .theme-filter-chip-active {
    background: var(--ink) !important;
    color: var(--paper) !important;
  }

  :global(html[data-theme='dark']) .theme-filter-chip-idle {
    background: var(--surface-soft) !important;
    border-color: var(--line) !important;
    color: var(--ink-soft) !important;
  }

  :global(html[data-theme='dark']) .theme-filter-chip-idle:hover {
    background: var(--surface-hover) !important;
    color: var(--ink) !important;
  }
</style>