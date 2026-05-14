<script lang="ts">
  import { tick } from 'svelte'

  import type { AccountTokenRefreshResult } from '../../../shared/codex'
  import type { LocalizedCopy } from './app-view'
  import AppButton from './AppButton.svelte'
  import AppDialog from './AppDialog.svelte'

  type RefreshStatus = 'idle' | 'running' | 'success' | 'error'

  export let copy: LocalizedCopy
  export let accountLabelText = ''
  export let status: RefreshStatus = 'idle'
  export let result: AccountTokenRefreshResult | null = null
  export let errorMessage = ''
  export let busy = false
  export let onClose: () => void = () => {}
  export let onSubmit: () => void = () => {}

  let showRaw = false
  let rawConfirmed = false
  let logPanel: HTMLPreElement | null = null

  $: logs = result ? (showRaw && rawConfirmed ? result.rawLogs : result.sanitizedLogs) : []

  $: if (logs.length) {
    void tick().then(() => {
      logPanel?.scrollTo({ top: logPanel.scrollHeight })
    })
  }

  const formatExpiry = (ms: number | null | undefined): string => {
    if (ms == null) return copy.forceRefreshTokensNoExpiry
    const now = Date.now()
    const diffMs = ms - now
    if (diffMs <= 0) {
      const ago = formatDuration(Math.abs(diffMs))
      return `${ago} ago`
    }
    return formatDuration(diffMs)
  }

  const formatDuration = (ms: number): string => {
    const seconds = Math.floor(ms / 1000)
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ${minutes % 60}m`
    const days = Math.floor(hours / 24)
    return `${days}d ${hours % 24}h`
  }

  const statusLabel = (): string => {
    switch (status) {
      case 'running':
        return copy.forceRefreshTokensRunning
      case 'success':
        return copy.forceRefreshTokensSuccess
      case 'error':
        return copy.forceRefreshTokensError
      default:
        return copy.forceRefreshTokensIdle
    }
  }

  const statusToneClass = (): string => {
    switch (status) {
      case 'running':
        return 'refresh-status-running'
      case 'success':
        return 'refresh-status-success'
      case 'error':
        return 'refresh-status-error'
      default:
        return 'refresh-status-idle'
    }
  }

  const handleShowRaw = (): void => {
    if (rawConfirmed) {
      showRaw = !showRaw
      return
    }
    if (window.confirm(copy.forceRefreshTokensRawWarning)) {
      rawConfirmed = true
      showRaw = true
    }
  }
</script>

<AppDialog
  ariaLabel={copy.forceRefreshTokensTitle}
  maxWidthClass="max-w-3xl"
  panelClass="refresh-dialog-panel rounded-[0.65rem] p-4 md:p-5"
  zIndexClass="z-[70]"
  closeDisabled={busy}
  closeOnBackdrop={!busy}
  onclose={onClose}
>
  <div class="refresh-dialog-content" data-dialog-motion>
    <!-- Header -->
    <div class="refresh-header">
      <div class="refresh-header-top">
        <h2 class="refresh-title">{copy.forceRefreshTokensTitle}</h2>
        <span class={`refresh-status-pill ${statusToneClass()}`}>
          {#if status === 'running'}
            <span class="i-lucide-loader-circle h-3 w-3 animate-spin"></span>
          {/if}
          {statusLabel()}
        </span>
      </div>
      <p class="refresh-description">{copy.forceRefreshTokensDescription}</p>
      {#if accountLabelText}
        <p class="refresh-account-label">{accountLabelText}</p>
      {/if}
    </div>

    <!-- Token cards -->
    {#if result}
      <div class="refresh-cards" data-dialog-motion>
        <div class="refresh-card" class:refresh-card-full={!result.after}>
          <p class="refresh-card-title">{copy.forceRefreshTokensBefore}</p>
          <dl class="refresh-card-list">
            <div class="refresh-card-row">
              <dt>{copy.forceRefreshTokensAccessToken}</dt>
              <dd>{formatExpiry(result.before.accessTokenExpiresAt)}</dd>
            </div>
            <div class="refresh-card-row">
              <dt>{copy.forceRefreshTokensRefreshToken}</dt>
              <dd>{formatExpiry(result.before.refreshTokenExpiresAt)}</dd>
            </div>
            <div class="refresh-card-row">
              <dt>{copy.forceRefreshTokensIdToken}</dt>
              <dd>{formatExpiry(result.before.idTokenExpiresAt)}</dd>
            </div>
          </dl>
        </div>
        {#if result.after}
          <div class="refresh-card">
            <p class="refresh-card-title">{copy.forceRefreshTokensAfter}</p>
            <dl class="refresh-card-list">
              <div class="refresh-card-row">
                <dt>{copy.forceRefreshTokensAccessToken}</dt>
                <dd>{formatExpiry(result.after.accessTokenExpiresAt)}</dd>
              </div>
              <div class="refresh-card-row">
                <dt>{copy.forceRefreshTokensRefreshToken}</dt>
                <dd>{formatExpiry(result.after.refreshTokenExpiresAt)}</dd>
              </div>
              <div class="refresh-card-row">
                <dt>{copy.forceRefreshTokensIdToken}</dt>
                <dd>{formatExpiry(result.after.idTokenExpiresAt)}</dd>
              </div>
            </dl>
          </div>
        {/if}
      </div>
    {/if}

    <!-- Error -->
    {#if errorMessage}
      <div class="refresh-error" role="alert" data-dialog-motion>
        <span class="i-lucide-circle-alert refresh-error-icon"></span>
        <p class="refresh-error-text">{errorMessage}</p>
      </div>
    {/if}

    <!-- Logs -->
    <div class="refresh-logs-section" data-dialog-motion>
      <div class="refresh-logs-header">
        <span class="refresh-logs-title">{copy.forceRefreshTokensLogTitle}</span>
        {#if result && result.rawLogs.length}
          <button type="button" class="refresh-raw-toggle" onclick={handleShowRaw}>
            {showRaw ? copy.forceRefreshTokensHideRaw : copy.forceRefreshTokensShowRaw}
          </button>
        {/if}
      </div>
      <pre bind:this={logPanel} class="refresh-log-panel"><code
          >{#if logs.length}{#each logs as entry, i (i)}{entry.timestamp}  {entry.message}
            {/each}{:else}{copy.forceRefreshTokensLogEmpty}{/if}</code
        ></pre>
    </div>

    <!-- Footer -->
    <div class="refresh-footer" data-dialog-motion>
      <AppButton variant="secondary" size="sm" onclick={onClose} disabled={busy}>
        {copy.exportFormatCancel}
      </AppButton>
      <AppButton variant="primary" size="sm" onclick={onSubmit} disabled={busy}>
        {#if busy}
          <span class="i-lucide-loader-circle h-4 w-4 animate-spin"></span>
        {/if}
        {copy.forceRefreshTokensButton}
      </AppButton>
    </div>
  </div>
</AppDialog>

<style>
  .refresh-dialog-content {
    display: grid;
    gap: 1rem;
    min-width: 0;
    width: 100%;
  }

  /* Header */
  .refresh-header {
    display: grid;
    gap: 0.25rem;
  }

  .refresh-header-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .refresh-title {
    font-size: 1rem;
    font-weight: 600;
    letter-spacing: -0.015em;
    color: var(--color-carbon);
  }

  .refresh-description {
    font-size: 0.75rem;
    line-height: 1.25rem;
    color: var(--ink-soft-strong);
  }

  .refresh-account-label {
    font-size: 11px;
    line-height: 1rem;
    color: var(--ink-faint);
  }

  /* Status pill */
  .refresh-status-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    flex-shrink: 0;
    border-radius: 0.35rem;
    padding: 0.25rem 0.625rem;
    font-size: 11px;
    font-weight: 500;
  }

  .refresh-status-idle {
    background: rgba(0, 0, 0, 0.05);
    color: var(--ink-soft-strong, #6b7280);
  }

  .refresh-status-running {
    background: rgb(59 130 246 / 0.1);
    color: rgb(37 99 235);
  }

  .refresh-status-success {
    background: rgb(16 185 129 / 0.12);
    color: rgb(5 150 105);
  }

  .refresh-status-error {
    background: rgb(239 68 68 / 0.12);
    color: rgb(220 38 38);
  }

  /* Token cards */
  .refresh-cards {
    display: grid;
    gap: 0.75rem;
    grid-template-columns: 1fr 1fr;
  }

  .refresh-card {
    display: grid;
    gap: 0.5rem;
    border-radius: 0.5rem;
    border: 1px solid var(--color-arctic-mist, rgba(0, 0, 0, 0.08));
    padding: 0.625rem 0.75rem;
    background: color-mix(in srgb, var(--panel-strong, #f9fafb) 74%, var(--color-snow, #fff));
  }

  .refresh-card-full {
    grid-column: 1 / -1;
  }

  .refresh-card-title {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--ink-faint);
  }

  .refresh-card-list {
    display: grid;
    gap: 0;
    margin: 0;
  }

  .refresh-card-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.3rem 0;
    font-size: 12px;
  }

  .refresh-card-row + .refresh-card-row {
    border-top: 1px solid var(--color-arctic-mist, rgba(0, 0, 0, 0.06));
  }

  .refresh-card-row dt {
    color: var(--ink-soft-strong);
    white-space: nowrap;
  }

  .refresh-card-row dd {
    margin: 0;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    color: var(--color-carbon);
    text-align: right;
    word-break: break-all;
  }

  /* Error */
  .refresh-error {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    border-radius: 0.4rem;
    border: 1px solid rgb(239 68 68 / 0.2);
    background: rgb(239 68 68 / 0.06);
    padding: 0.625rem 0.75rem;
  }

  .refresh-error-icon {
    flex-shrink: 0;
    width: 0.875rem;
    height: 0.875rem;
    margin-top: 0.125rem;
    color: rgb(220 38 38);
  }

  .refresh-error-text {
    font-size: 13px;
    line-height: 1.4;
    color: rgb(220 38 38);
    overflow-wrap: anywhere;
    word-break: break-word;
    min-width: 0;
  }

  /* Logs */
  .refresh-logs-section {
    display: grid;
    gap: 0.5rem;
    min-width: 0;
  }

  .refresh-logs-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .refresh-logs-title {
    font-size: 12px;
    font-weight: 500;
    color: var(--ink-soft-strong);
  }

  .refresh-raw-toggle {
    font-size: 11px;
    color: var(--ink-faint);
    text-decoration: underline;
    text-decoration-style: dotted;
    text-underline-offset: 2px;
    cursor: pointer;
    border: none;
    background: none;
    padding: 0.125rem 0.25rem;
    border-radius: 0.2rem;
    transition:
      color 0.14s,
      background 0.14s;
  }

  .refresh-raw-toggle:hover {
    color: var(--color-carbon);
    background: rgba(0, 0, 0, 0.04);
  }

  .refresh-log-panel {
    max-height: 12rem;
    min-height: 5rem;
    overflow: auto;
    border-radius: 0.4rem;
    border: 1px solid var(--color-arctic-mist, rgba(0, 0, 0, 0.08));
    padding: 0.75rem;
    font-family: 'SFMono-Regular', 'SF Mono', ui-monospace, Menlo, Monaco, Consolas, monospace;
    font-size: 11px;
    line-height: 1.25rem;
    color: var(--color-carbon);
    white-space: pre-wrap;
    word-break: break-all;
    background: color-mix(in srgb, var(--panel-strong, #f9fafb) 74%, var(--color-snow, #fff));
    margin: 0;
  }

  /* Footer */
  .refresh-footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }
</style>
