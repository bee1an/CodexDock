<script lang="ts">
  import { flip } from 'svelte/animate'
  import {
    dragHandle,
    dragHandleZone,
    SHADOW_ITEM_MARKER_PROPERTY_NAME,
    SHADOW_PLACEHOLDER_ITEM_ID,
    type DndEvent as SortEvent
  } from 'svelte-dnd-action'
  import type {
    CreateCustomProviderInput,
    CustomProviderSummary,
    ProbeProviderModelsInput,
    ProviderModelsProbeResult
  } from '../../../../shared/codex'
  import { providerLabel, type LocalizedCopy } from '$lib/view/app-view'
  import type { ProviderDraft } from './accounts-panel-provider'
  import AppButton from '$lib/ui/AppButton.svelte'
  import AppDialog from '$lib/ui/AppDialog.svelte'
  import AppInput from '$lib/ui/AppInput.svelte'

  export let copy: LocalizedCopy
  export let providers: CustomProviderSummary[] = []
  export let sortableProviders: CustomProviderSummary[] = []
  export let flipDurationMs = 160
  export let loginActionBusy = false
  export let providerMutationBusy = false
  export let providerDrafts: Record<string, ProviderDraft> = {}
  export let openingProviderId = ''
  export let providerActionBusy: (providerId: string) => boolean = () => false
  export let createProvider: (input: CreateCustomProviderInput) => Promise<void>
  export let probeProviderModels: (
    input: ProbeProviderModelsInput
  ) => Promise<ProviderModelsProbeResult>
  export let openProviderInCodex: (providerId: string) => Promise<void>
  export let openProviderIsolatedInCodex: (providerId: string) => Promise<void> = async () => {}
  export let startEditingProvider: (provider: CustomProviderSummary) => Promise<void>
  export let saveProvider: (provider: CustomProviderSummary) => Promise<void>
  export let cancelEditingProvider: () => void
  export let confirmRemoveProvider: (provider: CustomProviderSummary) => Promise<void>
  export let handleProviderSortConsider: (
    event: CustomEvent<SortEvent<CustomProviderSummary>>
  ) => void
  export let handleProviderSortFinalize: (
    event: CustomEvent<SortEvent<CustomProviderSummary>>
  ) => Promise<void>

  let savingProviderId = ''
  let removingProviderId = ''
  let showCreateDialog = false
  let showEditDialog = false
  let editDialogProvider: CustomProviderSummary | null = null
  let editProbingModels = false
  let editProbeError = ''
  let editProbedModels: string[] = []

  function isSortShadowProvider(provider: CustomProviderSummary): boolean {
    const sortable = provider as CustomProviderSummary & Record<string, unknown>
    return (
      Boolean(sortable[SHADOW_ITEM_MARKER_PROPERTY_NAME]) ||
      provider.id === SHADOW_PLACEHOLDER_ITEM_ID
    )
  }
  let creatingProvider = false
  let probingModels = false
  let probeError = ''
  let probedModels: string[] = []
  let newProviderName = ''
  let newProviderBaseUrl = ''
  let newProviderApiKey = ''
  let newProviderModel = '5.4'

  function resetCreateDialog(): void {
    creatingProvider = false
    probingModels = false
    probeError = ''
    probedModels = []
    newProviderName = ''
    newProviderBaseUrl = ''
    newProviderApiKey = ''
    newProviderModel = '5.4'
  }

  function openCreateDialog(): void {
    resetCreateDialog()
    showCreateDialog = true
  }

  function closeCreateDialog(): void {
    if (creatingProvider || probingModels) return
    showCreateDialog = false
    resetCreateDialog()
  }

  async function handleProbeModels(): Promise<void> {
    const baseUrl = newProviderBaseUrl.trim()
    const apiKey = newProviderApiKey.trim()
    if (!baseUrl || !apiKey || probingModels || creatingProvider) return
    probingModels = true
    probeError = ''
    probedModels = []
    try {
      const result = await probeProviderModels({ baseUrl, apiKey, protocol: 'openai' })
      probedModels = result.availableModels
      if (
        result.availableModels.length &&
        (!newProviderModel.trim() || newProviderModel === '5.4')
      ) {
        newProviderModel = result.availableModels[0]
      }
      if (!result.ok) {
        probeError = result.error || copy.providerModelProbeFailed
      }
    } catch (error) {
      probeError = error instanceof Error ? error.message : copy.providerModelProbeFailed
    } finally {
      probingModels = false
    }
  }

  async function handleCreateProvider(): Promise<void> {
    const baseUrl = newProviderBaseUrl.trim()
    const apiKey = newProviderApiKey.trim()
    if (!baseUrl || !apiKey || creatingProvider || probingModels) return

    creatingProvider = true
    try {
      await createProvider({
        name: newProviderName.trim() || undefined,
        baseUrl,
        apiKey,
        protocol: 'openai',
        model: newProviderModel.trim() || '5.4'
      })
      showCreateDialog = false
      resetCreateDialog()
    } finally {
      creatingProvider = false
    }
  }

  function openEditDialog(provider: CustomProviderSummary): void {
    editDialogProvider = provider
    showEditDialog = true
    editProbingModels = false
    editProbeError = ''
    editProbedModels = []
    void startEditingProvider(provider)
  }

  function closeEditDialog(): void {
    if (savingProviderId) return
    showEditDialog = false
    editDialogProvider = null
    editProbingModels = false
    editProbeError = ''
    editProbedModels = []
    cancelEditingProvider()
  }

  async function handleEditProbeModels(): Promise<void> {
    if (!editDialogProvider) return
    const draft = providerDrafts[editDialogProvider.id]
    if (!draft) return
    const baseUrl = draft.baseUrl.trim()
    const apiKey = draft.apiKey.trim()
    if (!baseUrl || !apiKey || editProbingModels || !!savingProviderId) return
    editProbingModels = true
    editProbeError = ''
    editProbedModels = []
    try {
      const result = await probeProviderModels({ baseUrl, apiKey, protocol: 'openai' })
      editProbedModels = result.availableModels
      if (!result.ok) {
        editProbeError = result.error || copy.providerModelProbeFailed
      }
    } catch (error) {
      editProbeError = error instanceof Error ? error.message : copy.providerModelProbeFailed
    } finally {
      editProbingModels = false
    }
  }

  async function handleSaveProvider(provider: CustomProviderSummary): Promise<void> {
    if (savingProviderId) return
    savingProviderId = provider.id
    try {
      await saveProvider(provider)
      showEditDialog = false
      editDialogProvider = null
    } finally {
      savingProviderId = ''
    }
  }

  async function handleRemoveProvider(provider: CustomProviderSummary): Promise<void> {
    if (removingProviderId) return
    removingProviderId = provider.id
    try {
      await confirmRemoveProvider(provider)
    } finally {
      removingProviderId = ''
    }
  }
</script>

<div class="flex flex-none px-4 pb-3">
  <div
    class="theme-soft-panel flex w-full flex-wrap items-center justify-between gap-3 rounded-[0.55rem] border border-[var(--card-border)] px-4 py-3"
  >
    <div class="min-w-0">
      <p class="text-sm font-semibold tracking-[-0.01em] text-carbon">{copy.createProvider}</p>
      <p class="mt-0.5 text-xs leading-5 text-muted-strong">
        {copy.providerCreateDialogDescription}
      </p>
    </div>
    <AppButton
      variant="primary"
      size="sm"
      onclick={openCreateDialog}
      disabled={loginActionBusy || providerMutationBusy}
      ariaLabel={copy.createProvider}
    >
      <span class="i-lucide-plus h-3.5 w-3.5" aria-hidden="true"></span>
      <span>{copy.createProvider}</span>
    </AppButton>
  </div>
</div>

{#if providers.length}
  <div class="provider-list-panel min-h-0 flex-1 overflow-y-auto px-4 pb-4">
    <div
      class="grid"
      use:dragHandleZone={{
        items: sortableProviders,
        type: 'providers',
        flipDurationMs,
        dragDisabled: loginActionBusy || providerMutationBusy || sortableProviders.length < 2,
        autoAriaDisabled: false,
        zoneItemTabIndex: -1,
        dropTargetStyle: {
          outline: '2px solid rgba(0,0,0,0.16)'
        },
        delayTouchStart: true
      }}
      onconsider={handleProviderSortConsider}
      onfinalize={(event) => void handleProviderSortFinalize(event)}
      aria-label={copy.providerCount(sortableProviders.length)}
    >
      {#each sortableProviders as provider, providerIndex (provider.id)}
        <article
          class={`theme-provider-card group grid items-center gap-3 px-2.5 py-2.5 transition-colors duration-140 md:grid-cols-[auto_minmax(0,1fr)_auto] ${isSortShadowProvider(provider) ? 'is-dnd-shadow' : ''}`}
          animate:flip={{ duration: flipDurationMs }}
          aria-label={providerLabel(provider, copy)}
        >
          <button
            class={`provider-drag-button self-center ${sortableProviders.length > 1 ? 'cursor-grab active:cursor-grabbing' : ''}`}
            type="button"
            use:dragHandle
            aria-label={`${copy.dragSortHandle} · ${providerLabel(provider, copy)}`}
            title={copy.dragSortHandle}
            disabled={loginActionBusy || providerMutationBusy || sortableProviders.length < 2}
          >
            <span class="i-lucide-grip-vertical h-4 w-4"></span>
          </button>

          <div class="flex min-w-0 items-center gap-3 overflow-visible">
            <div class="min-w-0 flex-1">
              <div class="grid min-w-0 gap-1.5">
                <div class="flex min-w-0 items-center gap-1.5 overflow-hidden">
                  <span
                    class="theme-provider-status h-1.5 w-1.5 flex-none rounded-full bg-sky-500/55 ring-2 ring-sky-500/12"
                  ></span>
                  <p class="min-w-0 truncate text-sm font-medium text-carbon">
                    {providerLabel(provider, copy)}
                  </p>
                  <span
                    class="theme-provider-badge inline-flex flex-none items-center rounded-full border border-sky-500/16 bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium text-sky-700"
                  >
                    {copy.providerBadge}
                  </span>
                  {#if provider.fastMode}
                    <span
                      class="theme-provider-fast-badge inline-flex flex-none items-center rounded-full border border-emerald-500/16 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700"
                    >
                      Fast
                    </span>
                  {/if}
                </div>
                <div class="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span
                    class="theme-provider-meta theme-soft-panel inline-flex items-center gap-1.5 rounded-full border border-[var(--soft-panel-border)] bg-[var(--surface-soft)] px-2 py-1 text-[11px] text-muted-strong"
                  >
                    <span class="font-medium uppercase tracking-[0.08em]">API</span>
                    <span>{provider.protocol ?? 'openai'}</span>
                  </span>
                  <span
                    class="theme-provider-meta theme-soft-panel inline-flex items-center gap-1.5 rounded-full border border-[var(--soft-panel-border)] bg-[var(--surface-soft)] px-2 py-1 text-[11px] text-muted-strong"
                  >
                    <span class="font-medium uppercase tracking-[0.08em]">Model</span>
                    <span>{provider.model}</span>
                  </span>
                  <span
                    class="theme-provider-meta theme-soft-panel inline-flex min-w-0 items-center gap-1.5 rounded-full border border-[var(--soft-panel-border)] bg-[var(--surface-soft)] px-2 py-1 text-[11px] text-muted-strong"
                  >
                    <span class="font-medium uppercase tracking-[0.08em]">URL</span>
                    <span class="max-w-[340px] truncate">{provider.baseUrl}</span>
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div class="flex items-center justify-end gap-1">
            <AppButton
              variant="icon"
              size="xs"
              onclick={() => void openProviderInCodex(provider.id)}
              disabled={loginActionBusy || providerActionBusy(provider.id)}
              ariaLabel={`${copy.openCustomProvider} · ${providerLabel(provider, copy)}`}
              title={copy.openCustomProvider}
            >
              {#if openingProviderId === provider.id}
                <span class="i-lucide-loader-circle h-4 w-4 animate-spin"></span>
              {:else}
                <span class="i-lucide-plug-zap h-4 w-4"></span>
              {/if}
            </AppButton>
            <AppButton
              variant="icon"
              size="xs"
              onclick={() => void openProviderIsolatedInCodex(provider.id)}
              disabled={loginActionBusy || providerActionBusy(provider.id)}
              ariaLabel={`${copy.openCustomProviderIsolated} · ${providerLabel(provider, copy)}`}
              title={copy.openCustomProviderIsolated}
            >
              <span class="i-lucide-copy-plus h-4 w-4"></span>
            </AppButton>
            <AppButton
              variant="icon"
              size="xs"
              onclick={() => openEditDialog(provider)}
              disabled={loginActionBusy || providerMutationBusy}
              ariaLabel={`${copy.editProvider} · ${providerLabel(provider, copy)}`}
              title={copy.editProvider}
            >
              <span class="i-lucide-pencil h-4 w-4"></span>
            </AppButton>
            <AppButton
              variant="icon"
              size="xs"
              onclick={() => void handleRemoveProvider(provider)}
              disabled={loginActionBusy || providerMutationBusy}
              ariaLabel={`${copy.deleteProvider} · ${providerLabel(provider, copy)}`}
              title={copy.deleteProvider}
            >
              {#if removingProviderId === provider.id}
                <span class="i-lucide-loader-circle h-4 w-4 animate-spin"></span>
              {:else}
                <span class="i-lucide-trash-2 h-4 w-4"></span>
              {/if}
            </AppButton>
          </div>

          {#if providerIndex < sortableProviders.length - 1}
            <div class="theme-provider-divider col-span-full"></div>
          {/if}
        </article>
      {/each}
    </div>
  </div>
{:else}
  <div class="providers-empty">
    <div class="providers-empty-icon">
      <span class="i-lucide-plug-zap h-7 w-7"></span>
    </div>
    <p class="providers-empty-title">{copy.noProviders}</p>
    <p class="providers-empty-hint">{copy.providerCreateDialogDescription}</p>
    <div class="providers-empty-actions">
      <AppButton
        variant="primary"
        size="sm"
        onclick={openCreateDialog}
        disabled={loginActionBusy || providerMutationBusy}
        ariaLabel={copy.createProvider}
      >
        <span class="i-lucide-plus h-3.5 w-3.5" aria-hidden="true"></span>
        <span>{copy.createProvider}</span>
      </AppButton>
    </div>
  </div>
{/if}

{#if showCreateDialog}
  <AppDialog
    title={copy.createProvider}
    description={copy.providerCreateDialogDescription}
    closeLabel={copy.closeDialog}
    showClose
    scrollable
    closeDisabled={creatingProvider || probingModels}
    maxWidthClass="max-w-2xl"
    onclose={closeCreateDialog}
  >
    <div class="grid gap-4">
      <div class="grid gap-3 md:grid-cols-2" data-dialog-motion>
        <AppInput
          bind:value={newProviderName}
          placeholder={copy.providerNamePlaceholder}
          disabled={creatingProvider || probingModels}
        />
        <AppInput
          bind:value={newProviderBaseUrl}
          placeholder={copy.providerBaseUrlPlaceholder}
          disabled={creatingProvider || probingModels}
        />
        <AppInput
          type="password"
          bind:value={newProviderApiKey}
          placeholder={copy.providerApiKeyPlaceholder}
          disabled={creatingProvider || probingModels}
          onkeydown={(event) => {
            if (event.key === 'Enter') {
              void handleProbeModels()
            }
          }}
        />
        <AppInput
          bind:value={newProviderModel}
          placeholder={copy.providerModelPlaceholder}
          disabled={creatingProvider}
          onkeydown={(event) => {
            if (event.key === 'Enter') {
              void handleCreateProvider()
            }
          }}
        />
      </div>

      <div class="flex flex-wrap items-center gap-2" data-dialog-motion>
        <AppButton
          variant="secondary"
          size="sm"
          onclick={() => void handleProbeModels()}
          disabled={creatingProvider ||
            probingModels ||
            !newProviderBaseUrl.trim() ||
            !newProviderApiKey.trim()}
        >
          <span
            class={`${probingModels ? 'i-lucide-loader-circle animate-spin' : 'i-lucide-search'} h-3.5 w-3.5`}
            aria-hidden="true"
          ></span>
          <span>{probingModels ? copy.providerModelProbeLoading : copy.providerModelProbe}</span>
        </AppButton>
        {#if probedModels.length}
          <span class="text-xs text-muted-strong">
            {copy.providerModelProbeFound(probedModels.length)}
          </span>
        {/if}
      </div>

      {#if probeError}
        <p class="text-sm text-danger" role="alert" data-dialog-motion>{probeError}</p>
      {/if}

      {#if probedModels.length}
        <div class="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto pr-1" data-dialog-motion>
          {#each probedModels as model (model)}
            <AppButton
              variant="filter"
              size="xs"
              selected={newProviderModel === model}
              ariaPressed={newProviderModel === model}
              onclick={() => {
                newProviderModel = model
              }}
            >
              <span class="font-mono">{model}</span>
            </AppButton>
          {/each}
        </div>
      {/if}
    </div>

    <svelte:fragment slot="footer">
      <AppButton
        variant="secondary"
        size="sm"
        onclick={closeCreateDialog}
        disabled={creatingProvider || probingModels}
      >
        {copy.cancel}
      </AppButton>
      <AppButton
        variant="primary"
        size="sm"
        onclick={() => void handleCreateProvider()}
        disabled={creatingProvider ||
          probingModels ||
          !newProviderBaseUrl.trim() ||
          !newProviderApiKey.trim()}
      >
        <span
          class={`${creatingProvider ? 'i-lucide-loader-circle animate-spin' : 'i-lucide-plug-zap'} h-3.5 w-3.5`}
          aria-hidden="true"
        ></span>
        <span>{copy.createProvider}</span>
      </AppButton>
    </svelte:fragment>
  </AppDialog>
{/if}

{#if showEditDialog && editDialogProvider && providerDrafts[editDialogProvider.id]}
  <AppDialog
    title={copy.editProvider}
    description={copy.providerCreateDialogDescription}
    closeLabel={copy.closeDialog}
    showClose
    scrollable
    closeDisabled={!!savingProviderId || editProbingModels}
    maxWidthClass="max-w-2xl"
    onclose={closeEditDialog}
  >
    <div class="grid gap-4">
      <div class="grid gap-3 md:grid-cols-2" data-dialog-motion>
        <AppInput
          bind:value={providerDrafts[editDialogProvider.id].name}
          placeholder={copy.providerNamePlaceholder}
          disabled={!!savingProviderId || editProbingModels}
        />
        <AppInput
          bind:value={providerDrafts[editDialogProvider.id].baseUrl}
          placeholder={copy.providerBaseUrlPlaceholder}
          disabled={!!savingProviderId || editProbingModels}
        />
        <AppInput
          type="password"
          bind:value={providerDrafts[editDialogProvider.id].apiKey}
          placeholder={copy.providerApiKeyPlaceholder}
          disabled={!!savingProviderId || editProbingModels}
          onkeydown={(event) => {
            if (event.key === 'Enter') {
              void handleEditProbeModels()
            }
          }}
        />
        <AppInput
          bind:value={providerDrafts[editDialogProvider.id].model}
          placeholder={copy.providerModelPlaceholder}
          disabled={!!savingProviderId}
          onkeydown={(event) => {
            if (event.key === 'Enter' && editDialogProvider) {
              void handleSaveProvider(editDialogProvider)
            }
          }}
        />
      </div>

      <div class="flex flex-wrap items-center gap-2" data-dialog-motion>
        <AppButton
          variant="secondary"
          size="sm"
          onclick={() => void handleEditProbeModels()}
          disabled={!!savingProviderId ||
            editProbingModels ||
            !providerDrafts[editDialogProvider.id].baseUrl.trim() ||
            !providerDrafts[editDialogProvider.id].apiKey.trim()}
        >
          <span
            class={`${editProbingModels ? 'i-lucide-loader-circle animate-spin' : 'i-lucide-search'} h-3.5 w-3.5`}
            aria-hidden="true"
          ></span>
          <span>{editProbingModels ? copy.providerModelProbeLoading : copy.providerModelProbe}</span>
        </AppButton>
        {#if editProbedModels.length}
          <span class="text-xs text-muted-strong">
            {copy.providerModelProbeFound(editProbedModels.length)}
          </span>
        {/if}
      </div>

      {#if editProbeError}
        <p class="text-sm text-danger" role="alert" data-dialog-motion>{editProbeError}</p>
      {/if}

      {#if editProbedModels.length}
        <div class="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto pr-1" data-dialog-motion>
          {#each editProbedModels as model (model)}
            <AppButton
              variant="filter"
              size="xs"
              selected={providerDrafts[editDialogProvider.id].model === model}
              ariaPressed={providerDrafts[editDialogProvider.id].model === model}
              onclick={() => {
                if (editDialogProvider) {
                  providerDrafts[editDialogProvider.id].model = model
                }
              }}
            >
              <span class="font-mono">{model}</span>
            </AppButton>
          {/each}
        </div>
      {/if}
    </div>

    <svelte:fragment slot="footer">
      <AppButton
        variant="secondary"
        size="sm"
        onclick={closeEditDialog}
        disabled={!!savingProviderId || editProbingModels}
      >
        {copy.cancel}
      </AppButton>
      <AppButton
        variant="primary"
        size="sm"
        onclick={() => editDialogProvider && void handleSaveProvider(editDialogProvider)}
        disabled={!!savingProviderId || editProbingModels || !providerDrafts[editDialogProvider.id].baseUrl.trim()}
      >
        <span
          class={`${savingProviderId ? 'i-lucide-loader-circle animate-spin' : 'i-lucide-check'} h-3.5 w-3.5`}
          aria-hidden="true"
        ></span>
        <span>{copy.saveProvider}</span>
      </AppButton>
    </svelte:fragment>
  </AppDialog>
{/if}

<style>
  .theme-provider-divider {
    height: 1px;
    margin-right: 0.75rem;
    margin-left: 3.25rem;
    background: var(--card-border);
  }

  :global(.theme-provider-card) {
    border-radius: 0.5rem;
  }

  .provider-drag-button {
    appearance: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.5rem;
    min-width: 1.5rem;
    height: 1.5rem;
    min-height: 1.5rem;
    border: 1px solid var(--card-border);
    border-radius: 0.38rem;
    background: transparent;
    color: var(--ink-faint);
    padding: 0;
    transition:
      background-color 140ms ease,
      border-color 140ms ease,
      color 140ms ease,
      opacity 140ms ease;
  }

  .provider-drag-button:hover:not(:disabled),
  .provider-drag-button:focus-visible {
    border-color: var(--line-strong);
    background: var(--surface-hover);
    color: var(--color-carbon);
  }

  .provider-drag-button:disabled {
    cursor: not-allowed;
    opacity: 0.48;
  }

  :global(.theme-provider-card.is-dnd-shadow) + .theme-provider-card {
    transform: translateY(3px);
    transition: transform 0.18s cubic-bezier(0.33, 1, 0.68, 1);
  }

  :global(.theme-provider-card.is-dnd-shadow) + .theme-provider-card::before {
    content: '' !important;
    position: absolute;
    top: -1px;
    right: 0.75rem;
    left: 0.75rem;
    height: 1px;
    background: color-mix(in srgb, var(--color-carbon) 22%, transparent);
    opacity: 1;
    pointer-events: none;
  }

  @media (prefers-reduced-motion: reduce) {
    :global(.theme-provider-card.is-dnd-shadow) + .theme-provider-card {
      transform: none;
    }
  }

  .providers-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.65rem;
    min-height: 14rem;
    margin: 0 1rem 1rem;
    padding: 2rem 1.25rem;
    border: 1px dashed var(--card-border);
    border-radius: 0.65rem;
    background: var(--panel-rise);
    text-align: center;
  }

  .providers-empty-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.75rem;
    height: 2.75rem;
    border-radius: 999px;
    border: 1px solid var(--card-border);
    background: var(--panel-rise-strong);
    color: var(--ink-soft-strong);
  }

  .providers-empty-title {
    font-size: 0.875rem;
    font-weight: 650;
    color: var(--color-carbon);
    letter-spacing: -0.01em;
  }

  .providers-empty-hint {
    max-width: 26rem;
    font-size: 0.75rem;
    line-height: 1.55;
    color: var(--ink-soft-strong);
  }

  .providers-empty-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.5rem;
    margin-top: 0.4rem;
  }
</style>
