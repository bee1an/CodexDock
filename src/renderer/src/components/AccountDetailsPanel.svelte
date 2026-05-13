<script lang="ts">
  import type {
    AccountRateLimits,
    AccountSummary,
    AccountTokensDetail,
    AccountWakeSchedule,
    AppLanguage
  } from '../../../shared/codex'
  import { formatRelativeReset } from '../../../shared/codex'
  import {
    describeTokenExpiry,
    formatAbsoluteDateTime,
    formatTimestampWithRelative,
    type TokenExpiryDescriptor
  } from './account-details'
  import {
    formatWakeScheduleLastTriggeredAt,
    nextWakeScheduleLabel,
    wakeScheduleSummary
  } from './wake-schedule'
  import AppButton from './AppButton.svelte'
  import { planLabel } from './app-view'
  import type { LocalizedCopy } from './app-view'

  export let copy: LocalizedCopy
  export let language: AppLanguage
  export let account: AccountSummary
  export let rateLimits: AccountRateLimits | undefined = undefined
  export let wakeSchedule: AccountWakeSchedule | undefined = undefined
  export let tokens: AccountTokensDetail | null = null
  export let tokensLoading = false
  export let tokensError = ''
  export let onReloadTokens: () => void = () => {}
  export let onForceRefreshTokens: () => void = () => {}

  let tick = Date.now()
  let tickTimer: ReturnType<typeof setInterval> | null = null

  import { onDestroy, onMount } from 'svelte'

  onMount(() => {
    tickTimer = setInterval(() => {
      tick = Date.now()
    }, 30_000)
  })

  onDestroy(() => {
    if (tickTimer) {
      clearInterval(tickTimer)
      tickTimer = null
    }
  })

  const timestampCopy = {
    justNow: copy.accountDetailsJustNow,
    agoSuffix: copy.accountDetailsAgo,
    inFutureSuffix: copy.accountDetailsInFuture,
    empty: copy.accountDetailsEmpty
  }

  const tokenExpiryCopy = {
    tokenMissing: copy.accountDetailsTokenMissing,
    tokenNoExpiry: copy.accountDetailsTokenNoExpiry,
    tokenExpired: copy.accountDetailsTokenExpired,
    tokenExpiresIn: copy.accountDetailsTokenExpiresIn
  }

  $: accessTokenExpiry = describeTokenExpiry(tokens?.accessToken, language, tokenExpiryCopy, tick)
  $: refreshTokenExpiry = describeTokenExpiry(tokens?.refreshToken, language, tokenExpiryCopy, tick)
  $: idTokenExpiry = describeTokenExpiry(tokens?.idToken, language, tokenExpiryCopy, tick)

  $: createdAt = formatTimestampWithRelative(account.createdAt, language, timestampCopy, tick)
  $: updatedAt = formatTimestampWithRelative(account.updatedAt, language, timestampCopy, tick)
  $: lastUsedAt = formatTimestampWithRelative(account.lastUsedAt, language, timestampCopy, tick)
  $: subscriptionExpiresAt = account.subscriptionExpiresAt
    ? formatTimestampWithRelative(account.subscriptionExpiresAt, language, timestampCopy, tick)
    : copy.accountDetailsEmpty

  function tokenExpiryToneClass(descriptor: TokenExpiryDescriptor): string {
    switch (descriptor.tone) {
      case 'expired':
        return 'text-red-600'
      case 'danger':
        return 'text-red-600'
      case 'warning':
        return 'text-amber-600'
      default:
        return 'text-muted-strong'
    }
  }

  function wakeSummary(schedule: AccountWakeSchedule | undefined): string {
    if (!schedule || !schedule.enabled || !schedule.times.length) {
      return copy.accountDetailsEmpty
    }

    const summary = wakeScheduleSummary(schedule, copy.accountDetailsEmpty)
    const nextRun = nextWakeScheduleLabel(schedule, language, copy.accountDetailsEmpty)
    if (nextRun && nextRun !== copy.accountDetailsEmpty) {
      return `${summary} · ${copy.wakeScheduleNextRun} ${nextRun}`
    }
    return summary
  }

  function wakeStatusLabel(status?: AccountWakeSchedule['lastStatus']): string {
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

  function resetAtLabel(resetsAt: number | null | undefined): string {
    if (!resetsAt) {
      return copy.accountDetailsEmpty
    }
    const relative = formatRelativeReset(resetsAt, language)
    const normalized = resetsAt < 1_000_000_000_000 ? resetsAt * 1000 : resetsAt
    const absolute = formatAbsoluteDateTime(normalized, language)
    return absolute ? `${absolute} · ${relative}` : relative
  }

  function creditsLabel(): string {
    const credits = rateLimits?.credits
    if (!credits || !credits.hasCredits) {
      return copy.accountDetailsCreditsNone
    }
    if (credits.unlimited) {
      return copy.accountDetailsCreditsUnlimited
    }
    if (credits.balance == null) {
      return copy.accountDetailsEmpty
    }
    return String(credits.balance)
  }

  let copiedKey = ''
  let copiedTimer: ReturnType<typeof setTimeout> | null = null

  async function copyValue(key: string, value: string | undefined | null): Promise<void> {
    if (!value || typeof navigator === 'undefined' || !navigator.clipboard) {
      return
    }

    try {
      await navigator.clipboard.writeText(value)
      copiedKey = key
      if (copiedTimer) {
        clearTimeout(copiedTimer)
      }
      copiedTimer = setTimeout(() => {
        copiedKey = ''
        copiedTimer = null
      }, 1500)
    } catch {
      // 剪贴板不可用时静默失败
    }
  }

  onDestroy(() => {
    if (copiedTimer) {
      clearTimeout(copiedTimer)
      copiedTimer = null
    }
  })
</script>

<div
  class="theme-account-details rounded-[0.85rem] border border-black/8 bg-black/[0.02] px-3 py-3"
>
  <div class="grid gap-3 md:grid-cols-2">
    <!-- 身份信息 -->
    <section
      class="theme-account-details-card flex flex-col gap-1.5 rounded-[0.65rem] bg-white/60 px-3 py-2.5"
    >
      <h4 class="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">
        {copy.accountDetailsSectionIdentity}
      </h4>
      <dl class="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-2 gap-y-1 text-[12px]">
        <dt class="text-muted-strong">{copy.accountDetailsFieldEmail}</dt>
        <dd class="min-w-0 truncate text-carbon">{account.email ?? copy.accountDetailsEmpty}</dd>
        <dd>
          {#if account.email}
            <button
              class="theme-details-copy-btn"
              type="button"
              onclick={() => void copyValue('email', account.email)}
              title={copy.accountDetailsCopyValue}
            >
              {copiedKey === 'email' ? copy.accountDetailsCopied : copy.accountDetailsCopyValue}
            </button>
          {/if}
        </dd>

        <dt class="text-muted-strong">{copy.accountDetailsFieldName}</dt>
        <dd class="min-w-0 truncate text-carbon">{account.name ?? copy.accountDetailsEmpty}</dd>
        <dd></dd>

        <dt class="text-muted-strong">{copy.accountDetailsFieldAccountId}</dt>
        <dd class="min-w-0 truncate text-carbon font-mono text-[11px]">
          {account.accountId ?? copy.accountDetailsEmpty}
        </dd>
        <dd>
          {#if account.accountId}
            <button
              class="theme-details-copy-btn"
              type="button"
              onclick={() => void copyValue('accountId', account.accountId)}
              title={copy.accountDetailsCopyValue}
            >
              {copiedKey === 'accountId' ? copy.accountDetailsCopied : copy.accountDetailsCopyValue}
            </button>
          {/if}
        </dd>

        <dt class="text-muted-strong">{copy.accountDetailsFieldRowId}</dt>
        <dd class="min-w-0 truncate text-carbon font-mono text-[11px]">{account.id}</dd>
        <dd>
          <button
            class="theme-details-copy-btn"
            type="button"
            onclick={() => void copyValue('rowId', account.id)}
            title={copy.accountDetailsCopyValue}
          >
            {copiedKey === 'rowId' ? copy.accountDetailsCopied : copy.accountDetailsCopyValue}
          </button>
        </dd>
      </dl>
    </section>

    <!-- 订阅与计划 -->
    <section
      class="theme-account-details-card flex flex-col gap-1.5 rounded-[0.65rem] bg-white/60 px-3 py-2.5"
    >
      <h4 class="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">
        {copy.accountDetailsSectionSubscription}
      </h4>
      <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 text-[12px]">
        <dt class="text-muted-strong">{copy.accountDetailsFieldPlanType}</dt>
        <dd class="min-w-0 truncate text-carbon">{planLabel(rateLimits?.planType)}</dd>

        <dt class="text-muted-strong">{copy.accountDetailsFieldLimitName}</dt>
        <dd class="min-w-0 truncate text-carbon">
          {rateLimits?.limitName ?? copy.accountDetailsEmpty}
        </dd>

        <dt class="text-muted-strong">{copy.accountDetailsFieldSubscriptionExpiresAt}</dt>
        <dd class="min-w-0 truncate text-carbon">{subscriptionExpiresAt}</dd>

        <dt class="text-muted-strong">{copy.accountDetailsFieldCredits}</dt>
        <dd class="min-w-0 truncate text-carbon">{creditsLabel()}</dd>

        {#if rateLimits?.credits?.approxLocalMessages != null}
          <dt class="text-muted-strong">{copy.accountDetailsFieldCreditsLocal}</dt>
          <dd class="min-w-0 truncate text-carbon tabular-nums">
            {rateLimits.credits.approxLocalMessages}
          </dd>
        {/if}

        {#if rateLimits?.credits?.approxCloudMessages != null}
          <dt class="text-muted-strong">{copy.accountDetailsFieldCreditsCloud}</dt>
          <dd class="min-w-0 truncate text-carbon tabular-nums">
            {rateLimits.credits.approxCloudMessages}
          </dd>
        {/if}

        <dt class="text-muted-strong">{copy.accountDetailsFieldPrimaryReset}</dt>
        <dd class="min-w-0 truncate text-carbon">
          {resetAtLabel(rateLimits?.primary?.resetsAt ?? null)}
        </dd>

        <dt class="text-muted-strong">{copy.accountDetailsFieldSecondaryReset}</dt>
        <dd class="min-w-0 truncate text-carbon">
          {resetAtLabel(rateLimits?.secondary?.resetsAt ?? null)}
        </dd>
      </dl>
    </section>

    <!-- 令牌状态 -->
    <section
      class="theme-account-details-card flex flex-col gap-1.5 rounded-[0.65rem] bg-white/60 px-3 py-2.5"
    >
      <header class="flex items-center justify-between gap-2">
        <h4 class="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">
          {copy.accountDetailsSectionTokens}
        </h4>
        <div class="flex items-center gap-1">
          <AppButton
            variant="ghost"
            size="xs"
            onclick={onForceRefreshTokens}
            disabled={tokensLoading}
            title={copy.forceRefreshTokensButton}
            ariaLabel={copy.forceRefreshTokensButton}
          >
            <span class="i-lucide-rotate-cw h-3.5 w-3.5"></span>
          </AppButton>
          <AppButton
            variant="ghost"
            size="xs"
            onclick={onReloadTokens}
            disabled={tokensLoading}
            title={copy.accountDetailsTokenRefresh}
            ariaLabel={copy.accountDetailsTokenRefresh}
          >
            {#if tokensLoading}
              <span class="i-lucide-loader-circle h-3.5 w-3.5 animate-spin"></span>
            {:else}
              <span class="i-lucide-refresh-cw h-3.5 w-3.5"></span>
            {/if}
          </AppButton>
        </div>
      </header>

      {#if tokensError}
        <p
          class="rounded-[0.4rem] border border-red-500/16 bg-red-500/8 px-2 py-1 text-[11px] text-red-700"
        >
          {tokensError}
        </p>
      {/if}

      <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1.5 text-[12px]">
        <dt class="text-muted-strong">{copy.accountDetailsFieldAccessToken}</dt>
        <dd class="min-w-0">
          {#if tokensLoading && !tokens}
            <span class="text-muted-strong">{copy.accountDetailsTokenLoading}</span>
          {:else}
            <div class="flex min-w-0 flex-col">
              <span
                class={`truncate ${tokenExpiryToneClass(accessTokenExpiry)}`}
                title={accessTokenExpiry.title}
              >
                {accessTokenExpiry.label}
              </span>
              {#if accessTokenExpiry.absolute}
                <span class="truncate text-[11px] text-faint">{accessTokenExpiry.absolute}</span>
              {/if}
            </div>
          {/if}
        </dd>

        <dt class="text-muted-strong">{copy.accountDetailsFieldRefreshToken}</dt>
        <dd class="min-w-0">
          {#if tokensLoading && !tokens}
            <span class="text-muted-strong">{copy.accountDetailsTokenLoading}</span>
          {:else}
            <div class="flex min-w-0 flex-col">
              <span
                class={`truncate ${tokenExpiryToneClass(refreshTokenExpiry)}`}
                title={refreshTokenExpiry.title}
              >
                {refreshTokenExpiry.label}
              </span>
              {#if refreshTokenExpiry.absolute}
                <span class="truncate text-[11px] text-faint">{refreshTokenExpiry.absolute}</span>
              {/if}
            </div>
          {/if}
        </dd>

        <dt class="text-muted-strong">{copy.accountDetailsFieldIdToken}</dt>
        <dd class="min-w-0">
          {#if tokensLoading && !tokens}
            <span class="text-muted-strong">{copy.accountDetailsTokenLoading}</span>
          {:else}
            <div class="flex min-w-0 flex-col">
              <span
                class={`truncate ${tokenExpiryToneClass(idTokenExpiry)}`}
                title={idTokenExpiry.title}
              >
                {idTokenExpiry.label}
              </span>
              {#if idTokenExpiry.absolute}
                <span class="truncate text-[11px] text-faint">{idTokenExpiry.absolute}</span>
              {/if}
            </div>
          {/if}
        </dd>
      </dl>
    </section>

    <!-- 时间戳与唤醒 -->
    <section
      class="theme-account-details-card flex flex-col gap-1.5 rounded-[0.65rem] bg-white/60 px-3 py-2.5"
    >
      <h4 class="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">
        {copy.accountDetailsSectionTimestamps}
      </h4>
      <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 text-[12px]">
        <dt class="text-muted-strong">{copy.accountDetailsFieldCreatedAt}</dt>
        <dd class="min-w-0 truncate text-carbon">{createdAt}</dd>

        <dt class="text-muted-strong">{copy.accountDetailsFieldUpdatedAt}</dt>
        <dd class="min-w-0 truncate text-carbon">{updatedAt}</dd>

        <dt class="text-muted-strong">{copy.accountDetailsFieldLastUsedAt}</dt>
        <dd class="min-w-0 truncate text-carbon">{lastUsedAt}</dd>

        <dt class="text-muted-strong">{copy.accountDetailsFieldWakeSchedule}</dt>
        <dd class="min-w-0 truncate text-carbon">{wakeSummary(wakeSchedule)}</dd>

        {#if wakeSchedule?.lastTriggeredAt}
          <dt class="text-muted-strong">{copy.accountDetailsFieldWakeLastRun}</dt>
          <dd class="min-w-0 truncate text-carbon">
            {formatWakeScheduleLastTriggeredAt(
              wakeSchedule.lastTriggeredAt,
              language,
              copy.accountDetailsEmpty
            )}
          </dd>

          <dt class="text-muted-strong">{copy.accountDetailsFieldWakeLastStatus}</dt>
          <dd class="min-w-0 truncate text-carbon">
            {wakeStatusLabel(wakeSchedule.lastStatus)}
          </dd>
        {/if}
      </dl>
    </section>
  </div>
</div>

<style>
  .theme-account-details {
    animation: details-fade-in 180ms ease-out;
  }

  @keyframes details-fade-in {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .theme-details-copy-btn {
    appearance: none;
    border: 0;
    background: transparent;
    padding: 2px 6px;
    font-size: 10px;
    color: var(--ink-faint);
    border-radius: 4px;
    cursor: pointer;
    transition:
      background-color 140ms ease,
      color 140ms ease;
  }

  .theme-details-copy-btn:hover {
    background: var(--surface-hover);
    color: var(--color-carbon);
  }

  :global(html[data-theme='dark']) .theme-account-details {
    background: color-mix(in srgb, var(--surface-soft) 70%, transparent) !important;
    border-color: var(--color-arctic-mist) !important;
  }

  :global(html[data-theme='dark']) .theme-account-details-card {
    background: var(--panel-strong) !important;
  }
</style>
