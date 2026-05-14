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
  <AppDialog ariaLabel={copy.groupManagerTitle} maxWidthClass="max-w-xl" onclose={handleClose}>
    <div class="flex flex-col gap-4">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 class="text-[15px] font-semibold text-carbon">{copy.groupManagerTitle}</h2>
          <p class="mt-1 text-[11px] leading-4 text-muted-strong">
            {copy.groupManagerHint}
          </p>
        </div>
        <AppButton
          variant="icon"
          size="xs"
          class="flex-none"
          onclick={handleClose}
          ariaLabel={copy.close}
          title={copy.close}
        >
          <span class="i-lucide-x h-4 w-4" aria-hidden="true"></span>
        </AppButton>
      </div>

      <div class="flex flex-wrap items-center gap-2">
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
          class="min-w-[108px]"
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
        <ul class="flex max-h-[320px] flex-col gap-1.5 overflow-y-auto pr-1">
          {#each groups as group (group.id)}
            <li
              class="group-row flex flex-wrap items-center gap-2 rounded-[0.45rem] border border-[var(--card-border)] bg-[var(--surface-soft)] px-3 py-2"
            >
              {#if editingId === group.id}
                <AppInput
                  class="min-w-[180px] flex-1"
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
                <span class="min-w-0 flex-1 truncate text-[13px] font-medium text-carbon">
                  {group.name}
                </span>
                <span
                  class="inline-flex flex-none items-center rounded-full bg-[var(--surface-soft)] px-2 py-0.5 text-[10px] font-medium text-muted-strong"
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
        <div
          class="rounded-[0.45rem] border border-dashed border-[var(--empty-border)] bg-[var(--surface-soft)] px-4 py-6 text-center"
        >
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
  .group-row {
    transition: background-color 140ms ease;
  }

  .group-row:hover {
    background: color-mix(in srgb, var(--surface-soft) 70%, transparent);
  }
</style>
