<script lang="ts">
  import type { AccountGroup, AccountSummary } from '../../../shared/codex'
  import type { LocalizedCopy } from './app-view'
  import AppButton from './AppButton.svelte'
  import AppDialog from './AppDialog.svelte'
  import AppInput from './AppInput.svelte'

  export let open = false
  export let copy: LocalizedCopy
  export let groups: AccountGroup[] = []
  export let accounts: AccountSummary[] = []
  export let loginActionBusy = false
  export let onClose: () => void
  export let createGroup: (name: string) => Promise<void>
  export let renameGroup: (group: AccountGroup, name: string) => Promise<void>
  export let deleteGroup: (group: AccountGroup) => Promise<void>
  export let groupAccountCount: (groupId: string) => number

  let draftName = ''
  let editingId: string | null = null
  let editingName = ''
  let busy = false

  async function handleCreate(): Promise<void> {
    const name = draftName.trim()
    if (!name || busy) return
    busy = true
    try {
      await createGroup(name)
      draftName = ''
    } finally {
      busy = false
    }
  }

  function beginEditing(group: AccountGroup): void {
    editingId = group.id
    editingName = group.name
  }

  function cancelEditing(): void {
    editingId = null
    editingName = ''
  }

  async function saveEdit(group: AccountGroup): Promise<void> {
    const name = editingName.trim()
    if (!name || busy) return
    busy = true
    try {
      await renameGroup(group, name)
      cancelEditing()
    } finally {
      busy = false
    }
  }

  async function handleDelete(group: AccountGroup): Promise<void> {
    if (busy) return
    busy = true
    try {
      await deleteGroup(group)
      if (editingId === group.id) cancelEditing()
    } finally {
      busy = false
    }
  }

  function handleClose(): void {
    draftName = ''
    cancelEditing()
    onClose()
  }

  $: disabled = loginActionBusy || busy
</script>

{#if open}
  <AppDialog
    title={copy.groupManagerTitle}
    description={copy.groupManagerHint}
    closeLabel={copy.close}
    showClose
    maxWidthClass="max-w-xl"
    panelClass="group-manager-dialog"
    onclose={handleClose}
  >
    <div class="group-manager-content flex flex-col gap-4">
      <div class="group-create-row grid items-center gap-2">
        <AppInput
          class="min-w-[200px] flex-1"
          placeholder={copy.newGroupPlaceholder}
          bind:value={draftName}
          {disabled}
          onkeydown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void handleCreate()
            }
          }}
        />
        <AppButton
          variant="primary"
          size="sm"
          class="group-create-button min-w-[108px]"
          onclick={() => void handleCreate()}
          disabled={disabled || !draftName.trim()}
        >
          {#if busy}
            <span class="i-lucide-loader-circle h-3.5 w-3.5 animate-spin" aria-hidden="true"></span>
          {:else}
            <span class="i-lucide-plus h-3.5 w-3.5" aria-hidden="true"></span>
          {/if}
          <span>{copy.createGroup}</span>
        </AppButton>
      </div>

      {#if groups.length}
        <ul class="group-list flex max-h-[320px] flex-col gap-1.5 overflow-y-auto pr-1">
          {#each groups as group (group.id)}
            <li class="group-row grid items-center gap-2 rounded-[0.55rem] border px-3 py-2.5">
              {#if editingId === group.id}
                <AppInput
                  class="group-edit-input min-w-[180px]"
                  bind:value={editingName}
                  {disabled}
                  onkeydown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void saveEdit(group)
                    } else if (event.key === 'Escape') {
                      cancelEditing()
                    }
                  }}
                />
                <AppButton
                  variant="primary"
                  size="xs"
                  onclick={() => void saveEdit(group)}
                  disabled={disabled || !editingName.trim()}
                >
                  <span class="i-lucide-check h-3.5 w-3.5" aria-hidden="true"></span>
                  <span>{copy.save}</span>
                </AppButton>
                <AppButton variant="secondary" size="xs" onclick={cancelEditing} {disabled}>
                  {copy.cancel}
                </AppButton>
              {:else}
                <span class="group-name min-w-0 truncate text-[13px] font-semibold text-carbon">
                  {group.name}
                </span>
                <span
                  class="group-member-pill inline-flex flex-none items-center rounded-full px-2 py-0.5 text-[10px] font-medium text-muted-strong"
                >
                  {copy.groupMemberCount(groupAccountCount(group.id))}
                </span>
                <AppButton
                  variant="icon"
                  size="xs"
                  class="flex-none"
                  onclick={() => beginEditing(group)}
                  {disabled}
                  ariaLabel={`${copy.renameGroup} · ${group.name}`}
                  title={copy.renameGroup}
                >
                  <span class="i-lucide-pencil h-3.5 w-3.5" aria-hidden="true"></span>
                </AppButton>
                <AppButton
                  variant="icon"
                  size="xs"
                  class="flex-none"
                  onclick={() => void handleDelete(group)}
                  {disabled}
                  ariaLabel={`${copy.deleteGroup} · ${group.name}`}
                  title={copy.deleteGroup}
                >
                  <span class="i-lucide-trash-2 h-3.5 w-3.5 text-danger" aria-hidden="true"></span>
                </AppButton>
              {/if}
            </li>
          {/each}
        </ul>
      {:else}
        <div class="group-empty-state rounded-[0.55rem] border border-dashed px-4 py-6 text-center">
          <p class="text-[12px] text-muted-strong">{copy.noGroups}</p>
        </div>
      {/if}

      {#if accounts.length === 0}
        <p class="text-[11px] leading-4 text-faint">{copy.groupManagerNoAccountsHint}</p>
      {/if}
    </div>
  </AppDialog>
{/if}

<style>
  :global(.group-manager-dialog) {
    background: var(--dialog-bg) !important;
  }

  .group-create-row {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .group-list {
    margin: 0;
    padding: 0 0.25rem 0 0;
    list-style: none;
  }

  .group-row {
    grid-template-columns: minmax(0, 1fr) auto auto auto;
    border-color: color-mix(in srgb, var(--line-strong) 56%, transparent);
    background: color-mix(in srgb, var(--panel-strong) 86%, var(--surface-soft));
    box-shadow: 0 1px 0 color-mix(in srgb, var(--edge-dark) 14%, transparent);
    transition: background-color 140ms ease;
  }

  .group-row:hover {
    border-color: color-mix(in srgb, var(--line-strong) 76%, transparent);
    background: color-mix(in srgb, var(--surface-hover) 58%, var(--panel-strong));
  }

  .group-member-pill {
    border: 1px solid color-mix(in srgb, var(--line-strong) 48%, transparent);
    background: color-mix(in srgb, var(--surface-soft) 76%, transparent);
  }

  :global(.group-edit-input) {
    grid-column: 1 / span 2;
  }

  .group-empty-state {
    border-color: var(--empty-border);
    background: color-mix(in srgb, var(--surface-soft) 46%, transparent);
  }

  @media (max-width: 520px) {
    .group-create-row,
    .group-row {
      grid-template-columns: minmax(0, 1fr);
    }

    .group-row :global(.app-button) {
      width: 100%;
    }
  }
</style>
