<script lang="ts">
  import type { AppLanguage, AppMeta, AppSettings, AppUpdateState } from '../../../shared/codex'
  import { languageOptions, type LocalizedCopy } from './app-view'
  import AppButton from './AppButton.svelte'
  import AppButtonGroup from './AppButtonGroup.svelte'
  import AppInput from './AppInput.svelte'
  import Checkbox from './Checkbox.svelte'

  export let copy: LocalizedCopy
  export let language: AppLanguage
  export let settings: AppSettings
  export let updateState: AppUpdateState
  export let appMeta: AppMeta
  export let showLocalMockToggle = false
  export let showCodexDesktopExecutablePath = false
  export let updateCheckForUpdatesOnStartup: (enabled: boolean) => void
  export let updateShowLocalMockData: (enabled: boolean) => void
  export let updateLanguage: (language: AppLanguage) => void
  export let updateCodexDesktopExecutablePath: (value: string) => Promise<void>
  export let checkForUpdates: () => void
  export let downloadUpdate: () => Promise<void>
  export let installUpdate: () => Promise<void>

  let codexDesktopExecutablePathDraft = settings.codexDesktopExecutablePath ?? ''
  let lastSyncedPath = settings.codexDesktopExecutablePath ?? ''
  let showPathEditor = Boolean(settings.codexDesktopExecutablePath?.trim())

  $: if ((settings.codexDesktopExecutablePath ?? '') !== lastSyncedPath) {
    lastSyncedPath = settings.codexDesktopExecutablePath ?? ''
    codexDesktopExecutablePathDraft = lastSyncedPath
  }

  const updateActionLabel = (): string => {
    switch (updateState.status) {
      case 'checking':
        return copy.checkingUpdates
      case 'available':
        return updateState.delivery === 'external'
          ? updateState.externalAction === 'homebrew'
            ? copy.updateViaHomebrew(updateState.availableVersion)
            : copy.openReleasePage(updateState.availableVersion)
          : copy.downloadUpdate(updateState.availableVersion)
      case 'downloaded':
        return copy.restartToInstallUpdate
      default:
        return copy.checkUpdates
    }
  }

  const updateActionDisabled = (): boolean =>
    updateState.status === 'checking' ||
    updateState.status === 'downloading' ||
    updateState.status === 'unsupported'

  const runUpdateAction = (): void => {
    switch (updateState.status) {
      case 'available':
        void downloadUpdate()
        return
      case 'downloaded':
        void installUpdate()
        return
      case 'checking':
      case 'downloading':
      case 'unsupported':
        return
      default:
        void checkForUpdates()
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

<div class="settings-container flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
  <section
    class="settings-section theme-soft-panel rounded-[0.55rem] border border-[var(--card-border)] px-4 py-4"
  >
    <div class="flex items-center gap-3 mb-4">
      <div
        class="settings-section-icon flex h-7 w-7 flex-none items-center justify-center rounded-[0.4rem] border"
      >
        <span class="i-lucide-sliders-horizontal h-4 w-4" aria-hidden="true"></span>
      </div>
      <div class="min-w-0">
        <p class="text-[13px] font-semibold text-carbon">{copy.generalSettings}</p>
        <p class="mt-0.5 text-[10px] leading-4 text-muted-strong">
          {copy.generalSettingsDescription}
        </p>
      </div>
    </div>

    <div class="grid gap-3">
      <div
        class="settings-row flex flex-wrap items-center gap-3 rounded-[0.45rem] border px-3 py-2.5"
      >
        <span class="text-xs font-medium text-carbon">{copy.switchLanguage}</span>
        <AppButtonGroup ariaLabel={copy.switchLanguage}>
          {#each languageOptions as option (option.value)}
            <AppButton
              variant="filter"
              size="xs"
              selected={language === option.value}
              ariaPressed={language === option.value}
              onclick={() => updateLanguage(option.value)}
            >
              {option.label}
            </AppButton>
          {/each}
        </AppButtonGroup>

        <label class="ml-auto inline-flex items-center gap-2 text-xs text-muted-strong">
          <Checkbox
            checked={settings.checkForUpdatesOnStartup}
            onCheckedChange={(checked) => updateCheckForUpdatesOnStartup(checked)}
          />
          <span>{copy.autoCheckUpdates}</span>
        </label>
      </div>

      {#if showLocalMockToggle}
        <div class="settings-row flex items-center gap-3 rounded-[0.45rem] border px-3 py-2.5">
          <label class="inline-flex items-center gap-2 text-xs text-muted-strong">
            <Checkbox
              checked={settings.showLocalMockData !== false}
              onCheckedChange={(checked) => updateShowLocalMockData(checked)}
            />
            <span>{copy.showLocalMockData}</span>
          </label>
        </div>
      {/if}
    </div>
  </section>

  {#if showCodexDesktopExecutablePath}
    <section
      class="settings-section theme-soft-panel rounded-[0.55rem] border border-[var(--card-border)] px-4 py-4"
    >
      <div class="flex items-center gap-3 mb-4">
        <div
          class="settings-section-icon flex h-7 w-7 flex-none items-center justify-center rounded-[0.4rem] border"
        >
          <span class="i-lucide-terminal h-4 w-4" aria-hidden="true"></span>
        </div>
        <div class="min-w-0">
          <p class="text-[13px] font-semibold text-carbon">{copy.codexDesktopExecutablePath}</p>
        </div>
        <AppButton
          variant="secondary"
          size="xs"
          class="ml-auto"
          onclick={() => {
            showPathEditor = !showPathEditor
          }}
        >
          {showPathEditor
            ? copy.hideCodexDesktopExecutablePath
            : copy.showCodexDesktopExecutablePath}
        </AppButton>
      </div>

      {#if showPathEditor}
        <div class="settings-row flex items-center gap-3 rounded-[0.45rem] border px-3 py-2.5">
          <AppInput
            class="min-w-0 flex-1"
            size="sm"
            bind:value={codexDesktopExecutablePathDraft}
            placeholder={copy.codexDesktopExecutablePlaceholder}
            onblur={() => void updateCodexDesktopExecutablePath(codexDesktopExecutablePathDraft)}
            onkeydown={(event) => {
              if (event.key === 'Enter') {
                void updateCodexDesktopExecutablePath(codexDesktopExecutablePathDraft)
              }
            }}
          />
        </div>
      {/if}
    </section>
  {/if}

  <section
    class="settings-section theme-soft-panel rounded-[0.55rem] border border-[var(--card-border)] px-4 py-4"
  >
    <div class="flex items-center gap-3 mb-4">
      <div
        class="settings-section-icon flex h-7 w-7 flex-none items-center justify-center rounded-[0.4rem] border"
      >
        <span class="i-lucide-download h-4 w-4" aria-hidden="true"></span>
      </div>
      <div class="min-w-0">
        <p class="text-[13px] font-semibold text-carbon">{copy.checkUpdates}</p>
        {#if updateStatus()}
          <p class="mt-0.5 text-[10px] leading-4 text-muted-strong">{updateStatus()}</p>
        {/if}
      </div>
    </div>

    <div
      class="settings-row flex flex-wrap items-center gap-3 rounded-[0.45rem] border px-3 py-2.5"
    >
      <span class="text-xs text-muted-strong">v{appMeta.version}</span>
      <AppButton
        variant="secondary"
        size="xs"
        onclick={runUpdateAction}
        disabled={updateActionDisabled()}
      >
        {#if updateState.status === 'checking' || updateState.status === 'downloading'}
          <span class="i-lucide-loader-circle h-3.5 w-3.5 animate-spin"></span>
        {/if}
        <span>{updateActionLabel()}</span>
      </AppButton>
    </div>
  </section>
</div>

<style>
  .settings-container {
    scrollbar-width: thin;
    scrollbar-color: color-mix(in srgb, var(--ink-faint) 46%, transparent) transparent;
  }

  .settings-section-icon {
    border-color: color-mix(in srgb, var(--line-strong) 76%, transparent);
    background: color-mix(in srgb, var(--surface-soft) 72%, transparent);
    color: var(--ink-soft-strong);
    box-shadow: 0 1px 0 color-mix(in srgb, var(--edge-light) 58%, transparent) inset;
  }

  .settings-row {
    border-color: color-mix(in srgb, var(--line-strong) 68%, transparent);
    background: color-mix(in srgb, var(--panel-strong) 84%, var(--surface-soft));
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, var(--edge-light) 44%, transparent),
      0 1px 0 color-mix(in srgb, var(--edge-dark) 12%, transparent);
  }
</style>
