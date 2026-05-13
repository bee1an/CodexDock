<script lang="ts">
  import type { LocalizedCopy } from './app-view'
  import AppButton from './AppButton.svelte'
  import AppDialog from './AppDialog.svelte'
  import AppInput from './AppInput.svelte'

  export let copy: LocalizedCopy
  export let errorMessage = ''
  export let saving = false
  export let onClose: () => void = () => {}
  export let onSubmit: (raw: string) => void | Promise<void> = () => {}

  let rawInput = ''
</script>

<AppDialog
  ariaLabel={copy.pasteSessionTitle}
  maxWidthClass="max-w-2xl"
  closeDisabled={saving}
  onclose={onClose}
>
  <div class="flex flex-col gap-4 px-6 pt-5 pb-2">
    <header class="flex flex-col gap-1" data-dialog-motion>
      <h2 class="text-base font-semibold text-carbon">{copy.pasteSessionTitle}</h2>
      <p class="text-[13px] text-[var(--ink-faint)]">{copy.pasteSessionHint}</p>
    </header>

    <div class="flex flex-col gap-1.5" data-dialog-motion>
      <label class="text-[13px] font-medium text-carbon" for="paste-session-input">
        {copy.pasteSessionLabel}
      </label>
      <AppInput
        id="paste-session-input"
        multiline
        rows={8}
        size="md"
        bind:value={rawInput}
        placeholder={copy.pasteSessionPlaceholder}
        spellcheck={false}
        disabled={saving}
      />
    </div>

    {#if errorMessage}
      <p class="text-[13px] text-danger" role="alert" data-dialog-motion>{errorMessage}</p>
    {/if}
  </div>

  <svelte:fragment slot="footer">
    <AppButton variant="secondary" size="sm" onclick={onClose} disabled={saving}>
      {copy.exportFormatCancel}
    </AppButton>
    <AppButton
      variant="primary"
      size="sm"
      onclick={() => onSubmit(rawInput)}
      disabled={saving || !rawInput.trim()}
    >
      {copy.pasteSessionConfirm}
    </AppButton>
  </svelte:fragment>
</AppDialog>
