<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte'
  import type { UpgradeProgressEvent, UpgradeProgressPhase } from '../../../../shared/codex'
  import AppButton from '$lib/ui/AppButton.svelte'

  type LogEntry = {
    id: number
    text: string
  }

  let phase: UpgradeProgressPhase = 'download'
  let logs: LogEntry[] = []
  let errorMessage = ''
  let logCounter = 0
  let logContainer: HTMLDivElement | null = null
  let dispose: (() => void) | null = null
  let installAckSent = false

  const language = ((): 'en' | 'zh-CN' => {
    const queryLang = new URLSearchParams(window.location.search).get('lang')
    if (queryLang === 'en' || queryLang === 'zh-CN') {
      return queryLang
    }
    return 'zh-CN'
  })()

  const copy = {
    en: {
      titleDownload: 'Preparing Homebrew update',
      titleInstall: 'Installing update via Homebrew',
      titleSuccess: 'Update installed',
      titleError: 'Update failed',
      restart: 'Restart now',
      later: 'Later',
      close: 'Close',
      openReleases: 'Open releases page',
      cancel: 'Cancel',
      logHeader: 'Logs',
      installNote: 'Installing the new version. This step may take a moment, please wait…',
      successNote: 'CodexDock has been updated. Restart now to use the new version.',
      errorPrefix: 'Error: '
    },
    'zh-CN': {
      titleDownload: '正在准备 Homebrew 更新',
      titleInstall: '正在通过 Homebrew 安装更新',
      titleSuccess: '更新已安装',
      titleError: '更新失败',
      restart: '立即重启',
      later: '稍后',
      close: '关闭',
      openReleases: '前往 Releases 页',
      cancel: '取消',
      logHeader: '日志',
      installNote: '正在安装新版本，这一步可能需要一点时间，请耐心等待…',
      successNote: 'CodexDock 已更新完成，立即重启以使用新版本。',
      errorPrefix: '错误：'
    }
  }[language]

  function appendLog(text: string): void {
    logCounter += 1
    logs = [...logs, { id: logCounter, text }]
    queueMicrotask(() => {
      if (logContainer) {
        logContainer.scrollTop = logContainer.scrollHeight
      }
    })
  }

  async function handleEvent(event: UpgradeProgressEvent): Promise<void> {
    if (event.kind === 'log') {
      appendLog(event.text)
      return
    }

    if (event.kind === 'error') {
      errorMessage = event.message
      appendLog(`${copy.errorPrefix}${event.message}`)
      return
    }

    if (event.kind === 'phase') {
      phase = event.phase
      if (event.message) {
        appendLog(event.message)
      }
      if (event.phase === 'install' && !installAckSent) {
        installAckSent = true
        await tick()
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
        try {
          await window.codexApp.upgradeProgressInstallRendered()
        } catch {
          /* main may have torn down */
        }
      }
    }
  }

  onMount(() => {
    dispose = window.codexApp.onUpgradeEvent((event) => {
      void handleEvent(event)
    })
    void window.codexApp.upgradeProgressReady()
  })

  onDestroy(() => {
    dispose?.()
  })

  function title(): string {
    switch (phase) {
      case 'download':
        return copy.titleDownload
      case 'install':
        return copy.titleInstall
      case 'success':
        return copy.titleSuccess
      case 'error':
        return copy.titleError
      default:
        return copy.titleDownload
    }
  }
</script>

<main class="upgrade-progress">
  <header class="upgrade-progress__header">
    <h1>{title()}</h1>
    {#if phase === 'install'}
      <p class="upgrade-progress__note">{copy.installNote}</p>
    {/if}
    {#if phase === 'success'}
      <p class="upgrade-progress__note">{copy.successNote}</p>
    {/if}
    {#if phase === 'error' && errorMessage}
      <p class="upgrade-progress__note upgrade-progress__note--error">
        {copy.errorPrefix}{errorMessage}
      </p>
    {/if}
  </header>

  <section class="upgrade-progress__logs" aria-label={copy.logHeader}>
    <div class="upgrade-progress__logs-inner" bind:this={logContainer}>
      {#each logs as entry (entry.id)}
        <div class="upgrade-progress__log-line">{entry.text}</div>
      {/each}
    </div>
  </section>

  <footer class="upgrade-progress__actions">
    {#if phase === 'download'}
      <AppButton
        variant="ghost"
        onclick={() => {
          void window.codexApp.upgradeCancel()
        }}
      >
        {copy.cancel}
      </AppButton>
    {/if}
    {#if phase === 'success'}
      <AppButton
        variant="ghost"
        onclick={() => {
          void window.codexApp.upgradeCancel()
        }}
      >
        {copy.later}
      </AppButton>
      <AppButton
        variant="primary"
        onclick={() => {
          void window.codexApp.upgradeRestart()
        }}
      >
        {copy.restart}
      </AppButton>
    {/if}
    {#if phase === 'error'}
      <AppButton
        variant="ghost"
        onclick={() => {
          void window.codexApp.upgradeOpenReleases()
        }}
      >
        {copy.openReleases}
      </AppButton>
      <AppButton
        variant="primary"
        onclick={() => {
          void window.codexApp.upgradeCancel()
        }}
      >
        {copy.close}
      </AppButton>
    {/if}
  </footer>
</main>

<style>
  :global(body) {
    margin: 0;
    background: #0d0d0d;
    color: #f5f5f5;
    font-family:
      ui-sans-serif,
      system-ui,
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      Roboto,
      sans-serif;
  }

  .upgrade-progress {
    display: flex;
    flex-direction: column;
    height: 100vh;
    padding: 24px;
    gap: 16px;
    box-sizing: border-box;
  }

  .upgrade-progress__header h1 {
    margin: 0 0 8px;
    font-size: 18px;
    font-weight: 600;
  }

  .upgrade-progress__note {
    margin: 0;
    color: #c4c4c4;
    font-size: 13px;
    line-height: 1.5;
  }

  .upgrade-progress__note--error {
    color: #ff7b72;
  }

  .upgrade-progress__logs {
    flex: 1;
    background: #1a1a1a;
    border: 1px solid #2a2a2a;
    border-radius: 10px;
    overflow: hidden;
  }

  .upgrade-progress__logs-inner {
    height: 100%;
    overflow: auto;
    padding: 12px 14px;
    font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    line-height: 1.5;
    color: #d0d0d0;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .upgrade-progress__log-line {
    padding: 0;
  }

  .upgrade-progress__actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
</style>
