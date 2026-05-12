<script lang="ts">
  import type { LoginEvent } from '../../../shared/codex'
  import { type LocalizedCopy } from './app-view'
  import AppButton from './AppButton.svelte'
  import AppDialog from './AppDialog.svelte'

  export let copy: LocalizedCopy
  export let loginEvent: LoginEvent | null = null
  export let onClose: () => void = () => {}
  export let showCallbackLoginDetails = true
  export let showDeviceLoginDetails = true
  export let copyAuthUrl: () => void
  export let copyDeviceCode: () => void
  export let openExternalLink: (url?: string) => void

  $: showBrowserLoginDetails =
    showCallbackLoginDetails &&
    loginEvent?.method === 'browser' &&
    Boolean(loginEvent?.authUrl || loginEvent?.localCallbackUrl || loginEvent?.rawOutput)

  $: showDeviceLoginDetailsPanel =
    showDeviceLoginDetails &&
    loginEvent?.method === 'device' &&
    Boolean(loginEvent?.verificationUrl || loginEvent?.userCode || loginEvent?.rawOutput)

  $: hasDetailContent = showBrowserLoginDetails || showDeviceLoginDetailsPanel

  const dialogTitle = (): string => {
    if (showBrowserLoginDetails && !showDeviceLoginDetailsPanel) {
      return copy.callbackLogin
    }
    if (!showBrowserLoginDetails && showDeviceLoginDetailsPanel) {
      return copy.deviceLogin
    }
    return copy.toolbarDialogTitle
  }
</script>

{#if hasDetailContent}
  <AppDialog
    ariaLabelledby="hero-panel-dialog-title"
    maxWidthClass="max-w-4xl"
    panelClass="max-h-[calc(100vh-3rem)] overflow-hidden rounded-[1.1rem] p-5 sm:p-6"
    zIndexClass="z-[55]"
    scrollable
    motionSelector="[data-hero-motion]"
    onclose={onClose}
  >
    <div
      class="mb-4 flex items-start justify-between gap-3 border-b border-black/6 pb-4"
      data-hero-motion
    >
      <div class="grid gap-1">
        <h2 id="hero-panel-dialog-title" class="text-[1.15rem] font-semibold text-carbon">
          {dialogTitle()}
        </h2>
      </div>

      <AppButton variant="secondary" size="sm" onclick={onClose}>
        {copy.closeDialog}
      </AppButton>
    </div>

    <div class="grid gap-2" data-hero-motion>
      {#if showBrowserLoginDetails && loginEvent?.method === 'browser' && loginEvent.authUrl}
        <div class="theme-soft-panel grid gap-2 rounded-lg bg-black/[0.03] p-3">
          <p class="text-sm text-muted-strong">{copy.callbackLoginLink}</p>
          <code
            class="theme-inline-code overflow-x-auto rounded-md bg-white px-3 py-2 text-sm text-black"
          >
            {loginEvent.authUrl}
          </code>
          <div class="flex flex-wrap items-center gap-2">
            <AppButton variant="secondary" size="sm" onclick={copyAuthUrl}>
              {copy.copyLink}
            </AppButton>
            <AppButton
              variant="secondary"
              size="sm"
              onclick={() => openExternalLink(loginEvent?.authUrl)}
            >
              {copy.openBrowser}
            </AppButton>
          </div>
        </div>
      {/if}

      {#if showBrowserLoginDetails && loginEvent?.method === 'browser' && loginEvent.localCallbackUrl}
        <p class="text-sm text-muted-strong">{copy.waitingCallback}</p>
      {/if}

      {#if showDeviceLoginDetailsPanel && loginEvent?.method === 'device' && loginEvent.verificationUrl}
        <div class="theme-soft-panel grid gap-2 rounded-lg bg-black/[0.03] p-3">
          <p class="text-sm text-muted-strong">{copy.deviceLoginLink}</p>
          <code
            class="theme-inline-code overflow-x-auto rounded-md bg-white px-3 py-2 text-sm text-black"
          >
            {loginEvent.verificationUrl}
          </code>
          {#if loginEvent.userCode}
            <div class="grid gap-1">
              <p class="text-sm text-muted-strong">{copy.deviceCode}</p>
              <code
                class="theme-inline-code overflow-x-auto rounded-md bg-white px-3 py-2 text-sm font-semibold tracking-[0.18em] text-black"
              >
                {loginEvent.userCode}
              </code>
            </div>
          {/if}
          <div class="flex flex-wrap items-center gap-2">
            <AppButton variant="secondary" size="sm" onclick={copyAuthUrl}>
              {copy.copyLink}
            </AppButton>
            {#if loginEvent.userCode}
              <AppButton variant="secondary" size="sm" onclick={copyDeviceCode}>
                {copy.copyCode}
              </AppButton>
            {/if}
            <AppButton
              variant="secondary"
              size="sm"
              onclick={() => openExternalLink(loginEvent?.verificationUrl)}
            >
              {copy.openBrowser}
            </AppButton>
          </div>
        </div>
      {/if}

      {#if showDeviceLoginDetailsPanel && loginEvent?.method === 'device' && loginEvent.userCode}
        <p class="text-sm text-muted-strong">{copy.waitingDeviceCode}</p>
      {/if}

      {#if loginEvent?.phase === 'error' && loginEvent.rawOutput}
        <pre
          class="theme-code-surface m-0 max-h-60 overflow-auto rounded-lg border border-black/8 bg-[#111111] p-4 font-mono text-sm leading-6 text-[#f5f5f5]">{loginEvent.rawOutput}</pre>
      {/if}
    </div>
  </AppDialog>
{/if}
