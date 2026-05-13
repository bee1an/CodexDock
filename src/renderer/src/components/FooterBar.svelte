<script lang="ts">
  import type { AppLanguage, AppMeta, AppTheme, AppUpdateState } from '../../../shared/codex'
  import {
    languageOptions,
    nextTheme,
    themeIconClass,
    themeTitle,
    type LocalizedCopy
  } from './app-view'
  import AppButton from './AppButton.svelte'

  type ThemeTransitionOrigin = {
    x?: number
    y?: number
    target?: HTMLElement | null
  }

  export let appMeta: AppMeta
  export let updateState: AppUpdateState
  export let language: AppLanguage
  export let theme: AppTheme
  export let copy: LocalizedCopy
  export let updateLanguage: (language: AppLanguage) => void
  export let updateTheme: (theme: AppTheme, origin?: ThemeTransitionOrigin) => void
  export let openExternalLink: (url?: string) => void
  export let downloadUpdate: () => void
  export let installUpdate: () => void

  const themeOriginFromClick = (event: MouseEvent): ThemeTransitionOrigin => {
    const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : null

    if (event.detail > 0) {
      return { x: event.clientX, y: event.clientY, target }
    }

    return { target }
  }

  const updateActionLabel = (): string | null => {
    switch (updateState.status) {
      case 'available':
        return updateState.delivery === 'external'
          ? updateState.externalAction === 'homebrew'
            ? copy.updateViaHomebrew(updateState.availableVersion)
            : copy.openReleasePage(updateState.availableVersion)
          : copy.downloadUpdate(updateState.availableVersion)
      case 'downloaded':
        return copy.restartToInstallUpdate
      default:
        return null
    }
  }

  const updateAction = (): (() => void) | null => {
    switch (updateState.status) {
      case 'available':
        return downloadUpdate
      case 'downloaded':
        return installUpdate
      default:
        return null
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
</script>

<section class="theme-surface rounded-[1rem] border border-[var(--card-border)] bg-[var(--panel-strong)] px-3 py-2.5">
  <div class="flex flex-wrap items-center justify-between gap-2.5">
    <div class="flex flex-wrap items-center gap-2 text-sm text-faint">
      <span
        class="theme-version-pill rounded-full bg-[var(--surface-soft)] px-2 py-1 text-[11px] text-muted-strong"
      >
        v{appMeta.version}
      </span>

      {#if updateStatus()}
        <span class="text-xs text-muted-strong" aria-live="polite">{updateStatus()}</span>
      {/if}

      {#if updateActionLabel() && updateAction()}
        <AppButton
          variant="secondary"
          size="sm"
          onclick={() => updateAction()?.()}
          disabled={updateState.status === 'downloading'}
        >
          {#if updateState.status === 'downloading'}
            <span class="i-lucide-loader-circle h-3.5 w-3.5 animate-spin"></span>
          {/if}
          <span>{updateActionLabel()}</span>
        </AppButton>
      {/if}
    </div>

    <div class="theme-toolbar inline-flex items-center gap-0.5 rounded-lg bg-[var(--surface-soft)] p-1">
      <div class="relative">
        <span
          class="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-faint i-lucide-languages"
        ></span>
        <select
          class="theme-select h-8 appearance-none rounded-md border-0 bg-transparent py-0 pl-8 pr-7 text-sm text-carbon outline-none transition-colors duration-140 hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          aria-label={copy.switchLanguage}
          value={language}
          on:change={(event) =>
            updateLanguage((event.currentTarget as HTMLSelectElement).value as AppLanguage)}
        >
          {#each languageOptions as option (option.value)}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
        <span
          class="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-faint i-lucide-chevron-down"
        ></span>
      </div>

      <AppButton
        variant="icon"
        size="md"
        onclick={(event) => updateTheme(nextTheme(theme), themeOriginFromClick(event))}
        ariaLabel={copy.switchTheme(themeTitle(theme, copy))}
        title={copy.switchTheme(themeTitle(theme, copy))}
      >
        <span class={`${themeIconClass(theme)} h-4.5 w-4.5`}></span>
      </AppButton>

      <AppButton
        variant="icon"
        size="md"
        onclick={() => openExternalLink(appMeta.githubUrl ?? undefined)}
        disabled={!appMeta.githubUrl}
        ariaLabel="GitHub"
        title={appMeta.githubUrl ? copy.openGithub : copy.githubPending}
      >
        <span class="i-lucide-github h-4.5 w-4.5"></span>
      </AppButton>
    </div>
  </div>
</section>
