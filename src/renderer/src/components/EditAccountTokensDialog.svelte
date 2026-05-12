<script lang="ts">
  import type { LocalizedCopy } from './app-view'
  import AppButton from './AppButton.svelte'
  import AppDialog from './AppDialog.svelte'
  import AppInput from './AppInput.svelte'

  export let copy: LocalizedCopy
  export let accountLabelText = ''
  export let accessToken = ''
  export let refreshToken = ''
  export let idToken = ''
  export let accountIdHint = ''
  export let errorMessage = ''
  export let loading = false
  export let saving = false
  export let onClose: () => void = () => {}
  export let onSave: () => void | Promise<void> = () => {}
</script>

<AppDialog ariaLabel={copy.editAccountTokensTitle} maxWidthClass="max-w-2xl" onclose={onClose}>
  <div class="flex flex-col gap-4">
    <header class="flex flex-col gap-1" data-dialog-motion>
      <h2 class="text-lg font-semibold text-carbon">{copy.editAccountTokensTitle}</h2>
      {#if accountLabelText}
        <p class="text-sm text-[var(--ink-faint)]">{accountLabelText}</p>
      {/if}
      <p class="text-[13px] text-[var(--ink-faint)]">{copy.editAccountTokensHint}</p>
    </header>

    <div class="flex flex-col gap-3" data-dialog-motion>
      {#if loading}
        <div
          class="flex items-center gap-2 rounded-[0.65rem] border border-[var(--color-arctic-mist)] bg-[var(--surface-soft)] px-3 py-2 text-[13px] text-[var(--ink-faint)]"
          role="status"
          aria-live="polite"
        >
          <span class="i-lucide-loader-circle h-4 w-4 animate-spin"></span>
          <span>{copy.editAccountTokensLoading}</span>
        </div>
      {/if}

      <label class="flex flex-col gap-1.5">
        <span class="text-[13px] font-medium text-carbon">{copy.accessTokenLabel}</span>
        <AppInput
          multiline
          rows={3}
          size="md"
          bind:value={accessToken}
          placeholder={copy.accessTokenPlaceholder}
          spellcheck={false}
          disabled={saving || loading}
          inputClass="font-mono text-[12px]"
        />
      </label>

      <label class="flex flex-col gap-1.5">
        <span class="text-[13px] font-medium text-carbon">{copy.refreshTokenLabel}</span>
        <AppInput
          multiline
          rows={3}
          size="md"
          bind:value={refreshToken}
          placeholder={copy.refreshTokenPlaceholder}
          spellcheck={false}
          disabled={saving || loading}
          inputClass="font-mono text-[12px]"
        />
      </label>

      <label class="flex flex-col gap-1.5">
        <span class="text-[13px] font-medium text-carbon">{copy.idTokenLabel}</span>
        <AppInput
          multiline
          rows={2}
          size="md"
          bind:value={idToken}
          placeholder={copy.idTokenPlaceholder}
          spellcheck={false}
          disabled={saving || loading}
          inputClass="font-mono text-[12px]"
        />
      </label>

      <label class="flex flex-col gap-1.5">
        <span class="text-[13px] font-medium text-carbon">{copy.accountIdHintLabel}</span>
        <AppInput
          size="md"
          bind:value={accountIdHint}
          placeholder={copy.accountIdHintPlaceholder}
          spellcheck={false}
          disabled={saving || loading}
          inputClass="font-mono text-[12px]"
        />
      </label>
    </div>

    {#if errorMessage}
      <p class="text-sm text-danger" role="alert" data-dialog-motion>{errorMessage}</p>
    {/if}

    <footer class="flex items-center justify-end gap-2 pt-1" data-dialog-motion>
      <AppButton variant="ghost" size="sm" onclick={onClose} disabled={saving}>
        {copy.cancel}
      </AppButton>
      <AppButton
        variant="primary"
        size="sm"
        onclick={() => void onSave()}
        disabled={saving || loading}
      >
        {#if saving}
          <span class="i-lucide-loader-circle h-4 w-4 animate-spin"></span>
        {/if}
        <span>{copy.saveAccountTokens}</span>
      </AppButton>
    </footer>
  </div>
</AppDialog>
