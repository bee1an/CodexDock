<script lang="ts">
  import { onDestroy } from 'svelte'
  import AppButton from '$lib/ui/AppButton.svelte'
  import AppDialog from '$lib/ui/AppDialog.svelte'
  import AppInput from '$lib/ui/AppInput.svelte'
  import type { LocalizedCopy } from '$lib/view/app-view'
  import { accountTransferFormats } from '../../../shared/codex'

  import type { AccountTransferFormat, AppSnapshot } from '../../../shared/codex'

  type TransitionMotionState = 'closed' | 'open' | 'closing'
  type RunAction = (key: string, task: () => Promise<AppSnapshot>) => Promise<void>

  export let copy: LocalizedCopy
  export let runAction: RunAction
  export let applySnapshot: (snapshot: AppSnapshot) => void
  export let localizeKnownError: (error: unknown, fallback: string) => string

  let showExportFormatDialog = false
  let renderExportFormatDialog = false
  let exportDialogMotionState: TransitionMotionState = 'closed'
  let exportDialogCloseTimer: number | null = null
  let exportDialogOpenFrame: number | null = null
  let exportDialogBusy = false
  let exportDialogError = ''
  let exportDialogAccountIds: string[] | null = null
  let exportDialogFormat: AccountTransferFormat = 'codexdock'
  let pasteSessionError = ''
  let pasteSessionSaving = false
  let showImportMethodDialog = false
  let importDialogStep: 'choose' | 'paste' = 'choose'
  let importDialogRawInput = ''

  const exportFormatOptionOrder = [...accountTransferFormats]

  const prefersReducedMotion = (): boolean =>
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const exportFormatLabel = (format: AccountTransferFormat): string => {
    switch (format) {
      case 'cockpit_tools':
        return copy.exportFormatCockpitTools
      case 'sub2api':
        return copy.exportFormatSub2api
      case 'cliproxyapi':
        return copy.exportFormatCliProxyApi
      case 'codexdock':
      default:
        return copy.exportFormatCodexDock
    }
  }

  const exportFormatDescription = (format: AccountTransferFormat): string => {
    switch (format) {
      case 'cockpit_tools':
        return copy.exportFormatCockpitToolsDescription
      case 'sub2api':
        return copy.exportFormatSub2apiDescription
      case 'cliproxyapi':
        return copy.exportFormatCliProxyApiDescription
      case 'codexdock':
      default:
        return copy.exportFormatCodexDockDescription
    }
  }

  const exportDialogScopeLabel = (): string =>
    exportDialogAccountIds?.length
      ? copy.exportFormatTargetSelected(exportDialogAccountIds.length)
      : copy.exportFormatTargetAll

  const modalCloseDurationMs = (): number => {
    if (prefersReducedMotion() || typeof document === 'undefined') {
      return 0
    }

    return (
      parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--modal-close-dur')
      ) || 150
    )
  }

  const clearExportDialogTimers = (): void => {
    if (exportDialogCloseTimer != null) {
      window.clearTimeout(exportDialogCloseTimer)
      exportDialogCloseTimer = null
    }
    if (exportDialogOpenFrame != null) {
      window.cancelAnimationFrame(exportDialogOpenFrame)
      exportDialogOpenFrame = null
    }
  }

  const resetExportDialog = (): void => {
    exportDialogError = ''
    exportDialogAccountIds = null
    exportDialogFormat = 'codexdock'
  }

  const finishExportFormatDialogClose = (): void => {
    renderExportFormatDialog = false
    exportDialogMotionState = 'closed'
    exportDialogCloseTimer = null
    resetExportDialog()
  }

  const openExportDialogMotion = (): void => {
    clearExportDialogTimers()
    renderExportFormatDialog = true
    showExportFormatDialog = true
    exportDialogMotionState = 'closed'
    exportDialogOpenFrame = window.requestAnimationFrame(() => {
      exportDialogOpenFrame = null
      exportDialogMotionState = 'open'
    })
  }

  const closeExportDialogMotion = (): void => {
    if (!renderExportFormatDialog) {
      showExportFormatDialog = false
      resetExportDialog()
      return
    }

    clearExportDialogTimers()
    showExportFormatDialog = false
    exportDialogMotionState = 'closing'
    exportDialogCloseTimer = window.setTimeout(
      finishExportFormatDialogClose,
      modalCloseDurationMs()
    )
  }

  export function closeExportFormatDialog(): void {
    if (exportDialogBusy) {
      return
    }

    closeExportDialogMotion()
  }

  export function openExportFormatDialog(accountIds?: string[]): void {
    const uniqueIds = accountIds?.length ? [...new Set(accountIds)] : null
    if (accountIds?.length && !uniqueIds?.length) {
      return
    }

    exportDialogAccountIds = uniqueIds
    exportDialogFormat = 'codexdock'
    exportDialogError = ''
    openExportDialogMotion()
  }

  const submitExportFormatDialog = async (): Promise<void> => {
    if (exportDialogBusy || exportDialogMotionState === 'closing' || !showExportFormatDialog) {
      return
    }

    exportDialogBusy = true
    exportDialogError = ''

    try {
      const nextSnapshot = exportDialogAccountIds?.length
        ? await window.codexApp.exportSelectedAccountsToFile(
            exportDialogAccountIds,
            exportDialogFormat
          )
        : await window.codexApp.exportAccountsToFile(exportDialogFormat)
      applySnapshot(nextSnapshot)
      closeExportDialogMotion()
    } catch (error) {
      exportDialogError = localizeKnownError(error, copy.actionFailed)
    } finally {
      exportDialogBusy = false
    }
  }

  export async function exportSelectedAccounts(accountIds: string[]): Promise<void> {
    const uniqueIds = [...new Set(accountIds)]
    if (!uniqueIds.length) {
      return
    }

    openExportFormatDialog(uniqueIds)
  }

  export function openImportMethodDialog(): void {
    importDialogStep = 'choose'
    importDialogRawInput = ''
    pasteSessionError = ''
    pasteSessionSaving = false
    showImportMethodDialog = true
  }

  const closeImportMethodDialog = (): void => {
    if (pasteSessionSaving) return
    showImportMethodDialog = false
  }

  const selectImportFromFile = (): void => {
    showImportMethodDialog = false
    void runAction('import:file', () => window.codexApp.importAccountsFromFile())
  }

  const selectImportFromSession = (): void => {
    importDialogStep = 'paste'
  }

  const submitImportDialogPaste = async (): Promise<void> => {
    if (pasteSessionSaving || !importDialogRawInput.trim()) return
    pasteSessionSaving = true
    pasteSessionError = ''
    try {
      applySnapshot(await window.codexApp.importAccountsFromRaw(importDialogRawInput))
      showImportMethodDialog = false
    } catch (error) {
      pasteSessionError = localizeKnownError(error, copy.actionFailed)
    } finally {
      pasteSessionSaving = false
    }
  }

  onDestroy(clearExportDialogTimers)

  export function handleEscape(): boolean {
    if (showExportFormatDialog && !exportDialogBusy) {
      closeExportFormatDialog()
      return true
    }

    return false
  }
</script>

{#if renderExportFormatDialog}
  <AppDialog
    ariaLabelledby="export-format-dialog-title"
    maxWidthClass="max-w-xl"
    panelClass="rounded-[1.25rem]"
    zIndexClass="z-[60]"
    closeDisabled={exportDialogBusy}
    closeOnBackdrop={!exportDialogBusy}
    motionSelector="[data-motion-item]"
    onclose={closeExportFormatDialog}
  >
    <div class="grid gap-1" data-motion-item>
      <p class="text-xs font-medium uppercase tracking-[0.22em] text-faint">
        {exportDialogScopeLabel()}
      </p>
      <h2 id="export-format-dialog-title" class="text-[1.15rem] font-semibold text-carbon">
        {copy.exportFormatDialogTitle}
      </h2>
      <p class="text-sm leading-6 text-muted-strong">
        {copy.exportFormatDialogDescription}
      </p>
    </div>

    <div class="mt-5 grid gap-3">
      {#each exportFormatOptionOrder as format (format)}
        <label
          data-motion-item
          class={`theme-export-format-option grid cursor-pointer gap-1 rounded-2xl border px-4 py-3 transition-colors duration-140 ${exportDialogFormat === format ? 'border-[var(--line-strong)] bg-[var(--surface-soft)]' : 'border-[var(--card-border)] bg-transparent'}`}
        >
          <div class="flex items-start gap-3">
            <input
              class="mt-1 h-4 w-4 accent-black"
              type="radio"
              name="account-export-format"
              value={format}
              checked={exportDialogFormat === format}
              onchange={() => {
                exportDialogFormat = format
              }}
            />
            <div class="grid gap-1">
              <span class="text-sm font-medium text-carbon">{exportFormatLabel(format)}</span>
              <span class="text-xs leading-5 text-muted-strong">
                {exportFormatDescription(format)}
              </span>
            </div>
          </div>
        </label>
      {/each}
    </div>

    {#if exportDialogError}
      <p class="mt-4 text-sm text-danger" data-motion-item>{exportDialogError}</p>
    {/if}

    <svelte:fragment slot="footer">
      <AppButton
        variant="secondary"
        size="sm"
        onclick={closeExportFormatDialog}
        disabled={exportDialogBusy}
      >
        {copy.exportFormatCancel}
      </AppButton>
      <AppButton
        variant="primary"
        size="sm"
        onclick={submitExportFormatDialog}
        disabled={exportDialogBusy}
      >
        {copy.exportFormatConfirm}
      </AppButton>
    </svelte:fragment>
  </AppDialog>
{/if}

{#if showImportMethodDialog}
  <AppDialog
    ariaLabel={importDialogStep === 'choose' ? copy.importMethodTitle : copy.pasteSessionTitle}
    title={importDialogStep === 'choose' ? copy.importMethodTitle : copy.pasteSessionTitle}
    showClose
    closeLabel={copy.closeDialog}
    maxWidthClass={importDialogStep === 'choose' ? 'max-w-sm' : 'max-w-2xl'}
    closeDisabled={pasteSessionSaving}
    onclose={closeImportMethodDialog}
  >
    {#if importDialogStep === 'choose'}
      <div class="grid gap-3">
        <div
          role="button"
          tabindex="0"
          class="theme-import-method-card grid cursor-pointer gap-1 rounded-2xl border border-[var(--card-border)] bg-transparent px-4 py-3 text-left transition-colors duration-140 hover:border-[var(--line-strong)] hover:bg-[var(--surface-soft)]"
          onclick={selectImportFromFile}
          onkeydown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') selectImportFromFile()
          }}
        >
          <div class="flex items-start gap-3">
            <span class="i-lucide-file-up mt-0.5 h-4 w-4 shrink-0 text-muted-strong"></span>
            <div class="grid gap-0.5">
              <span class="text-sm font-medium text-carbon">
                {copy.importFromFile}
              </span>
              <span class="text-xs leading-5 text-muted-strong">
                {copy.importFromFileDescription}
              </span>
            </div>
          </div>
        </div>
        <div
          role="button"
          tabindex="0"
          class="theme-import-method-card grid cursor-pointer gap-1 rounded-2xl border border-[var(--card-border)] bg-transparent px-4 py-3 text-left transition-colors duration-140 hover:border-[var(--line-strong)] hover:bg-[var(--surface-soft)]"
          onclick={selectImportFromSession}
          onkeydown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') selectImportFromSession()
          }}
        >
          <div class="flex items-start gap-3">
            <span class="i-lucide-clipboard-paste mt-0.5 h-4 w-4 shrink-0 text-muted-strong"></span>
            <div class="grid gap-0.5">
              <span class="text-sm font-medium text-carbon">
                {copy.importFromSession}
              </span>
              <span class="text-xs leading-5 text-muted-strong">
                {copy.importFromSessionDescription}
              </span>
            </div>
          </div>
        </div>
      </div>
    {:else}
      <div class="flex flex-col gap-4">
        <p class="text-[13px] text-[var(--ink-faint)]">{copy.pasteSessionHint}</p>
        <div class="flex flex-col gap-1.5">
          <label class="text-[13px] font-medium text-carbon" for="paste-session-input">
            {copy.pasteSessionLabel}
          </label>
          <AppInput
            id="paste-session-input"
            multiline
            rows={8}
            size="md"
            bind:value={importDialogRawInput}
            placeholder={copy.pasteSessionPlaceholder}
            spellcheck={false}
            disabled={pasteSessionSaving}
          />
        </div>
        {#if pasteSessionError}
          <p class="text-[13px] text-danger" role="alert">{pasteSessionError}</p>
        {/if}
      </div>
    {/if}

    <svelte:fragment slot="footer">
      {#if importDialogStep === 'paste'}
        <AppButton
          variant="secondary"
          size="sm"
          onclick={closeImportMethodDialog}
          disabled={pasteSessionSaving}
        >
          {copy.exportFormatCancel}
        </AppButton>
        <AppButton
          variant="primary"
          size="sm"
          onclick={submitImportDialogPaste}
          disabled={pasteSessionSaving || !importDialogRawInput.trim()}
        >
          {copy.pasteSessionConfirm}
        </AppButton>
      {/if}
    </svelte:fragment>
  </AppDialog>
{/if}
