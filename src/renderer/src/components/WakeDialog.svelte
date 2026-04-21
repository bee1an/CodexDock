<script lang="ts">
  import { tick } from 'svelte'

  import type {
    AccountWakeSchedule,
    AppLanguage,
    WakeAccountRequestResult
  } from '../../../shared/codex'
  import type { LocalizedCopy } from './app-view'
  import { cascadeIn, reveal } from './gsap-motion'
  import { formatWakeScheduleLastTriggeredAt, nextWakeScheduleLabel } from './wake-schedule'

  export let copy: LocalizedCopy
  export let language: AppLanguage
  export let accountLabelText = ''
  export let compactGhostButton = ''
  export let primaryActionButton = ''
  export let activeTab: 'session' | 'schedule' = 'session'

  export let sessionPrompt = 'ping'
  export let sessionModel = 'gpt-5.4'
  export let sessionStatus: 'idle' | 'running' | 'success' | 'skipped' | 'error' = 'idle'
  export let sessionLogs: string[] = []
  export let requestResult: WakeAccountRequestResult | null = null
  export let requestError = ''
  export let rawResponseBody = ''
  export let sessionBusy = false

  export let schedule: AccountWakeSchedule | null = null
  export let scheduleEnabled = true
  export let scheduleTimes: string[] = ['09:00']
  export let schedulePrompt = 'ping'
  export let scheduleModel = 'gpt-5.4'
  export let scheduleError = ''
  export let scheduleSaving = false

  export let onClose: () => void = () => {}
  export let onSubmitSession: () => void | Promise<void> = () => {}
  export let onSaveSchedule: () => void | Promise<void> = () => {}
  export let onDeleteSchedule: () => void | Promise<void> = () => {}

  let logPanel: HTMLPreElement | null = null

  const statusToneClass = (value: typeof sessionStatus): string => {
    switch (value) {
      case 'running':
        return 'wake-status-running'
      case 'success':
        return 'wake-status-success'
      case 'skipped':
        return 'wake-status-skipped'
      case 'error':
        return 'wake-status-error'
      default:
        return 'theme-version-pill'
    }
  }

  const sessionStatusLabel = (value: typeof sessionStatus): string => {
    switch (value) {
      case 'running':
        return copy.wakeQuotaStatusRunning
      case 'success':
        return copy.wakeQuotaStatusSuccess
      case 'skipped':
        return copy.wakeQuotaStatusSkipped
      case 'error':
        return copy.wakeQuotaStatusError
      default:
        return copy.wakeQuotaStatusIdle
    }
  }

  const scheduleStatusLabel = (status: AccountWakeSchedule['lastStatus'] | undefined): string => {
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

  const responsePreview = (body: string): string => {
    const firstLine = body
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean)

    if (!firstLine) {
      return copy.wakeQuotaResultEmpty
    }

    return firstLine.length > 160 ? `${firstLine.slice(0, 157)}...` : firstLine
  }

  const addTime = (): void => {
    scheduleTimes = [...scheduleTimes, '']
  }

  const updateTime = (index: number, value: string): void => {
    scheduleTimes = scheduleTimes.map((item, itemIndex) => (itemIndex === index ? value : item))
  }

  const removeTime = (index: number): void => {
    scheduleTimes = scheduleTimes.filter((_, itemIndex) => itemIndex !== index)
    if (!scheduleTimes.length) {
      scheduleTimes = ['']
    }
  }

  const dialogBusy = (): boolean => sessionBusy || scheduleSaving

  $: if (sessionLogs.length && activeTab === 'session') {
    void tick().then(() => {
      logPanel?.scrollTo({ top: logPanel.scrollHeight })
    })
  }
</script>

<div
  class="wake-dialog-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6 backdrop-blur-sm"
  use:reveal={{ y: 0, scale: 1, blur: 0, duration: 0.18 }}
>
  <div
    class="theme-surface wake-dialog-panel flex w-full max-w-4xl flex-col overflow-hidden rounded-[1.25rem] border border-black/8 bg-white p-6 shadow-[0_32px_120px_rgba(0,0,0,0.12)] md:p-8"
    use:reveal={{ y: 12, scale: 0.992, blur: 6, duration: 0.34 }}
    use:cascadeIn={{
      selector: '[data-wake-motion]',
      y: 8,
      blur: 4,
      duration: 0.28,
      stagger: 0.024
    }}
    role="dialog"
    aria-modal="true"
    aria-labelledby="wake-dialog-title"
  >
    <div class="grid gap-6 md:gap-7">
      <div class="grid gap-1.5" data-wake-motion>
        <p id="wake-dialog-title" class="text-lg font-semibold tracking-tight text-ink">
          {copy.wakeDialogTitle}
        </p>
        <p class="text-sm text-muted-strong">
          {copy.wakeDialogDescription}
        </p>
        <p class="mt-0.5 text-xs text-faint">{accountLabelText}</p>
      </div>

      <div
        class="inline-flex w-fit items-center gap-1.5 rounded-[0.85rem] border border-black/5 bg-black/[0.02] p-1 shadow-inner"
        data-wake-motion
      >
        <button
          class={`wake-tab-button inline-flex items-center gap-2 rounded-[0.6rem] px-4 py-2 text-sm font-medium transition-colors duration-150 ${
            activeTab === 'session'
              ? 'bg-white text-ink shadow-[0_1px_2px_rgba(15,23,42,0.06)]'
              : 'bg-transparent text-black/58 hover:bg-black/[0.04] hover:text-ink'
          }`}
          type="button"
          onclick={() => {
            if (!dialogBusy()) {
              activeTab = 'session'
            }
          }}
          disabled={dialogBusy()}
          aria-pressed={activeTab === 'session'}
        >
          <span class="i-lucide-zap h-4 w-4"></span>
          <span>{copy.wakeQuota}</span>
        </button>
        <button
          class={`wake-tab-button inline-flex items-center gap-2 rounded-[0.6rem] px-4 py-2 text-sm font-medium transition-colors duration-150 ${
            activeTab === 'schedule'
              ? 'bg-white text-ink shadow-[0_1px_2px_rgba(15,23,42,0.06)]'
              : 'bg-transparent text-black/58 hover:bg-black/[0.04] hover:text-ink'
          }`}
          type="button"
          onclick={() => {
            if (!dialogBusy()) {
              activeTab = 'schedule'
            }
          }}
          disabled={dialogBusy()}
          aria-pressed={activeTab === 'schedule'}
        >
          <span class="i-lucide-calendar-clock h-4 w-4"></span>
          <span>{copy.wakeSchedule}</span>
        </button>
      </div>

      {#if activeTab === 'session'}
        <div class="grid gap-4" data-wake-motion use:reveal={{ y: 6, blur: 3, duration: 0.22 }}>
          <div class="flex items-center justify-between gap-3">
            <div class="grid gap-1">
              <p class="text-sm font-medium text-ink">{copy.wakeQuotaDialogTitle}</p>
              <p class="text-xs text-muted-strong">{copy.wakeQuotaDialogDescription}</p>
            </div>
            <span
              class={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium ${statusToneClass(sessionStatus)}`}
            >
              {sessionStatusLabel(sessionStatus)}
            </span>
          </div>

          <div class="grid gap-3 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]">
            <div class="grid content-start gap-3">
              <label class="grid gap-1.5">
                <span class="text-xs font-medium text-muted-strong">
                  {copy.wakeQuotaPromptLabel}
                </span>
                <textarea
                  class="theme-select wake-dialog-field min-h-28 rounded-[0.85rem] border border-black/8 bg-black/[0.02] px-3.5 py-3 text-sm text-ink shadow-[0_1px_2px_rgba(0,0,0,0.02)_inset] outline-none transition hover:bg-black/[0.04] focus-visible:border-black/20 focus-visible:bg-white focus-visible:ring-2 focus-visible:ring-black/5"
                  bind:value={sessionPrompt}
                  placeholder={copy.wakeQuotaPromptPlaceholder}
                  disabled={dialogBusy()}
                ></textarea>
              </label>

              <label class="grid gap-1.5">
                <span class="text-xs font-medium text-muted-strong">
                  {copy.wakeQuotaModelLabel}
                </span>
                <input
                  class="theme-select wake-dialog-field rounded-[0.85rem] border border-black/8 bg-black/[0.02] px-3.5 py-3 text-sm text-ink shadow-[0_1px_2px_rgba(0,0,0,0.02)_inset] outline-none transition hover:bg-black/[0.04] focus-visible:border-black/20 focus-visible:bg-white focus-visible:ring-2 focus-visible:ring-black/5"
                  type="text"
                  bind:value={sessionModel}
                  placeholder={copy.wakeQuotaModelPlaceholder}
                  disabled={dialogBusy()}
                />
              </label>

              {#if requestError}
                <div
                  class="theme-error-panel rounded-xl border border-danger/18 bg-danger/6 px-3 py-2.5 text-sm text-danger"
                >
                  {requestError}
                </div>
              {/if}
            </div>

            <div class="grid min-h-0 gap-3">
              <div class="grid gap-2">
                <div class="flex items-center justify-between gap-3">
                  <span class="text-xs font-medium text-muted-strong">
                    {copy.wakeQuotaLogTitle}
                  </span>
                  {#if requestResult}
                    <span
                      class="theme-version-pill inline-flex items-center rounded-md bg-black/[0.05] px-2 py-0.5 text-[10px] font-medium tabular-nums text-muted-strong"
                    >
                      {copy.wakeQuotaResultStatus}&nbsp;{requestResult.status}
                    </span>
                  {/if}
                </div>

                <pre
                  bind:this={logPanel}
                  class="theme-code-surface wake-log-panel min-h-48 max-h-72 overflow-auto rounded-[0.85rem] border border-black/8 bg-black/[0.03] px-3.5 py-3 text-[13px] leading-relaxed text-ink shadow-[0_2px_4px_rgba(0,0,0,0.02)_inset]"><code
                    >{sessionLogs.length ? sessionLogs.join('\n') : copy.wakeQuotaLogEmpty}</code
                  ></pre>
              </div>

              {#if requestResult}
                <div class="grid gap-2">
                  <div class="flex items-center justify-between gap-3">
                    <span class="text-xs font-medium text-muted-strong">
                      {copy.wakeQuotaResult}
                    </span>
                    <span class="text-[10px] text-faint">{responsePreview(rawResponseBody)}</span>
                  </div>
                  <pre
                    class="theme-code-surface max-h-56 overflow-auto overscroll-contain rounded-[0.85rem] border border-black/8 bg-black/[0.03] px-3.5 py-3 text-[13px] leading-relaxed text-ink shadow-[0_2px_4px_rgba(0,0,0,0.02)_inset]"><code
                      >{rawResponseBody || copy.wakeQuotaResultEmpty}</code
                    ></pre>
                </div>
              {/if}
            </div>
          </div>

          <div class="flex justify-end gap-2" data-wake-motion>
            <button
              class={compactGhostButton}
              type="button"
              onclick={onClose}
              disabled={dialogBusy()}
            >
              {copy.cancel}
            </button>
            <button
              class={primaryActionButton}
              type="button"
              onclick={onSubmitSession}
              disabled={dialogBusy()}
            >
              {#if sessionBusy}
                <span class="i-lucide-loader-circle h-4 w-4 animate-spin"></span>
              {/if}
              <span>{copy.wakeQuotaConfirm}</span>
            </button>
          </div>
        </div>
      {:else}
        <div class="grid gap-4" data-wake-motion use:reveal={{ y: 6, blur: 3, duration: 0.22 }}>
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="grid gap-1">
              <p class="text-sm font-medium text-ink">{copy.wakeScheduleDialogTitle}</p>
              <p class="text-xs text-muted-strong">{copy.wakeScheduleDialogDescription}</p>
            </div>
            <label class="inline-flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" bind:checked={scheduleEnabled} disabled={dialogBusy()} />
              <span>{copy.wakeScheduleEnabled}</span>
            </label>
          </div>

          <div class="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]">
            <div class="grid gap-4">
              <div class="grid gap-2">
                <div class="flex items-center justify-between gap-3">
                  <span class="text-sm font-medium text-ink">{copy.wakeScheduleTimes}</span>
                  <button
                    class="theme-select rounded-md border border-black/10 px-3 py-2 text-sm"
                    type="button"
                    onclick={addTime}
                    disabled={dialogBusy()}
                  >
                    {copy.wakeScheduleAddTime}
                  </button>
                </div>

                <div class="grid gap-2">
                  {#each scheduleTimes as timeValue, timeIndex (timeIndex)}
                    <div class="flex items-center gap-2">
                      <input
                        class="theme-select wake-dialog-field h-11 min-w-0 flex-1 rounded-[0.85rem] border border-black/8 bg-black/[0.02] px-3.5 text-sm text-ink shadow-[0_1px_2px_rgba(0,0,0,0.02)_inset] outline-none transition hover:bg-black/[0.04] focus-visible:border-black/20 focus-visible:bg-white focus-visible:ring-2 focus-visible:ring-black/5"
                        type="text"
                        value={timeValue}
                        placeholder={copy.wakeScheduleTimePlaceholder}
                        disabled={dialogBusy()}
                        oninput={(event) =>
                          updateTime(timeIndex, (event.currentTarget as HTMLInputElement).value)}
                      />
                      <button
                        class="theme-select rounded-md border border-black/10 px-3 py-2 text-sm"
                        type="button"
                        onclick={() => removeTime(timeIndex)}
                        disabled={dialogBusy()}
                      >
                        {copy.wakeScheduleRemoveTime}
                      </button>
                    </div>
                  {/each}
                </div>
              </div>

              <div class="grid gap-3 md:grid-cols-2">
                <label class="grid gap-1">
                  <span class="text-sm font-medium text-ink">{copy.wakeQuotaPromptLabel}</span>
                  <textarea
                    class="theme-select wake-dialog-field min-h-24 rounded-[0.85rem] border border-black/8 bg-black/[0.02] px-3.5 py-3 text-sm text-ink shadow-[0_1px_2px_rgba(0,0,0,0.02)_inset] outline-none transition hover:bg-black/[0.04] focus-visible:border-black/20 focus-visible:bg-white focus-visible:ring-2 focus-visible:ring-black/5"
                    bind:value={schedulePrompt}
                    placeholder={copy.wakeQuotaPromptPlaceholder}
                    disabled={dialogBusy()}
                  ></textarea>
                </label>
                <label class="grid gap-1">
                  <span class="text-sm font-medium text-ink">{copy.wakeQuotaModelLabel}</span>
                  <input
                    class="theme-select wake-dialog-field h-11 rounded-[0.85rem] border border-black/8 bg-black/[0.02] px-3.5 text-sm text-ink shadow-[0_1px_2px_rgba(0,0,0,0.02)_inset] outline-none transition hover:bg-black/[0.04] focus-visible:border-black/20 focus-visible:bg-white focus-visible:ring-2 focus-visible:ring-black/5"
                    type="text"
                    bind:value={scheduleModel}
                    placeholder={copy.wakeQuotaModelPlaceholder}
                    disabled={dialogBusy()}
                  />
                </label>
              </div>

              {#if scheduleError}
                <div
                  class="rounded-xl border border-danger/16 bg-danger/8 px-3 py-2 text-sm text-danger"
                >
                  {scheduleError}
                </div>
              {/if}
            </div>

            <div
              class="grid content-start gap-2 rounded-xl border border-black/8 bg-black/[0.02] px-3 py-3 text-xs text-muted-strong"
            >
              <div class="flex items-center justify-between gap-3">
                <span>{copy.wakeScheduleNextRun}</span>
                <span>{nextWakeScheduleLabel(schedule, language, copy.wakeScheduleEmpty)}</span>
              </div>
              <div class="flex items-center justify-between gap-3">
                <span>{copy.wakeScheduleLastRun}</span>
                <span
                  >{formatWakeScheduleLastTriggeredAt(
                    schedule?.lastTriggeredAt,
                    language,
                    copy.wakeScheduleEmpty
                  )}</span
                >
              </div>
              <div class="flex items-center justify-between gap-3">
                <span>{copy.wakeScheduleLastStatus}</span>
                <span>{scheduleStatusLabel(schedule?.lastStatus)}</span>
              </div>
              {#if schedule?.lastMessage}
                <div class="grid gap-1 pt-1">
                  <span>{copy.wakeScheduleLastMessage}</span>
                  <pre
                    class="theme-code-surface max-h-28 overflow-auto rounded-xl border border-black/8 bg-black/[0.02] px-3 py-2 text-[11px] leading-5 text-ink"><code
                      >{schedule.lastMessage}</code
                    ></pre>
                </div>
              {/if}
            </div>
          </div>

          <div class="flex items-center justify-between gap-3" data-wake-motion>
            <button
              class="theme-select rounded-md border border-black/10 px-3 py-2 text-sm"
              type="button"
              onclick={onDeleteSchedule}
              disabled={dialogBusy() || !schedule}
            >
              {copy.wakeScheduleDelete}
            </button>

            <div class="flex justify-end gap-2">
              <button
                class={compactGhostButton}
                type="button"
                onclick={onClose}
                disabled={dialogBusy()}
              >
                {copy.cancel}
              </button>
              <button
                class={primaryActionButton}
                type="button"
                onclick={onSaveSchedule}
                disabled={dialogBusy()}
              >
                {#if scheduleSaving}
                  <span class="i-lucide-loader-circle h-4 w-4 animate-spin"></span>
                {/if}
                <span>{copy.wakeScheduleSave}</span>
              </button>
            </div>
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .wake-status-running {
    background: rgb(59 130 246 / 0.1);
    color: rgb(37 99 235);
  }

  .wake-status-success {
    background: rgb(16 185 129 / 0.12);
    color: rgb(5 150 105);
  }

  .wake-status-skipped {
    background: rgb(245 158 11 / 0.14);
    color: rgb(180 83 9);
  }

  .wake-status-error {
    background: rgb(239 68 68 / 0.12);
    color: rgb(220 38 38);
  }

  .wake-log-panel {
    font-family:
      'SFMono-Regular', 'SF Mono', ui-monospace, Menlo, Monaco, Consolas, 'Liberation Mono',
      monospace;
  }

  :global(html[data-theme='dark']) .wake-dialog-backdrop {
    background: color-mix(in srgb, black 48%, transparent) !important;
  }

  :global(html[data-theme='dark']) .wake-dialog-panel {
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.06) inset,
      0 24px 80px color-mix(in srgb, var(--paper-shadow) 72%, transparent) !important;
  }

  :global(html[data-theme='dark']) .wake-dialog-field {
    border-color: var(--line) !important;
    background: color-mix(in srgb, var(--panel-strong) 88%, var(--surface-soft) 12%) !important;
    color: var(--ink) !important;
  }

  :global(html[data-theme='dark']) .wake-dialog-field::placeholder {
    color: var(--ink-faint) !important;
  }

  :global(html[data-theme='dark']) .wake-status-running {
    background: rgb(59 130 246 / 0.16) !important;
    color: rgb(147 197 253) !important;
  }

  :global(html[data-theme='dark']) .wake-status-skipped {
    background: rgb(245 158 11 / 0.18) !important;
    color: rgb(253 224 71) !important;
  }

  :global(html[data-theme='dark']) .wake-status-success {
    background: rgb(16 185 129 / 0.16) !important;
    color: rgb(167 243 208) !important;
  }

  :global(html[data-theme='dark']) .wake-status-error {
    background: rgb(239 68 68 / 0.16) !important;
    color: rgb(252 165 165) !important;
  }

  :global(html[data-theme='dark']) .wake-tab-button {
    color: var(--ink-soft-strong) !important;
  }

  :global(html[data-theme='dark']) .wake-tab-button:hover:not(:disabled) {
    background: var(--surface-hover) !important;
    color: var(--ink) !important;
  }

  :global(html[data-theme='dark']) .wake-tab-button[aria-pressed='true'] {
    background: color-mix(in srgb, var(--surface-hover) 86%, var(--ink) 6%) !important;
    color: var(--ink) !important;
  }
</style>
