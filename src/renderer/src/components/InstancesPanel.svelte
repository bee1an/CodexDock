<script lang="ts">
  import type {
    AccountSummary,
    CodexInstanceDefaults,
    CodexInstanceSummary,
    CreateCodexInstanceInput,
    UpdateCodexInstanceInput
  } from '../../../shared/codex'
  import AppButton from './AppButton.svelte'
  import AppInput from './AppInput.svelte'
  import type { LocalizedCopy } from './app-view'

  export let panelClass: string
  export let copy: LocalizedCopy
  export let instances: CodexInstanceSummary[] = []
  export let defaults: CodexInstanceDefaults
  export let accounts: AccountSummary[] = []
  export let busy = false
  export let createInstance: (input: CreateCodexInstanceInput) => Promise<void>
  export let updateInstance: (instanceId: string, input: UpdateCodexInstanceInput) => Promise<void>
  export let removeInstance: (instanceId: string) => Promise<void>
  export let startInstance: (instanceId: string) => Promise<void>
  export let stopInstance: (instanceId: string) => Promise<void>

  let newInstanceName = ''
  let newInstanceDir = ''
  let newInstanceArgs = ''
  let newInstanceBindAccountId = ''
  let drafts: Record<string, { name: string; bindAccountId: string; extraArgs: string }> = {}

  $: {
    const nextDrafts: typeof drafts = {}
    for (const instance of instances) {
      nextDrafts[instance.id] = drafts[instance.id] ?? {
        name: instance.name,
        bindAccountId: instance.bindAccountId ?? '',
        extraArgs: instance.extraArgs
      }
    }
    drafts = nextDrafts
  }

  async function submitCreate(): Promise<void> {
    const name = newInstanceName.trim()
    if (!name || busy) {
      return
    }

    await createInstance({
      name,
      codexHome: newInstanceDir.trim() || undefined,
      bindAccountId: newInstanceBindAccountId || undefined,
      extraArgs: newInstanceArgs.trim() || undefined
    })

    newInstanceName = ''
    newInstanceDir = ''
    newInstanceArgs = ''
    newInstanceBindAccountId = ''
  }

  async function save(instance: CodexInstanceSummary): Promise<void> {
    const draft = drafts[instance.id]
    if (!draft || busy) {
      return
    }

    const input: UpdateCodexInstanceInput = {}
    if (!instance.isDefault) {
      const nextName = draft.name.trim()
      if (nextName && nextName !== instance.name) {
        input.name = nextName
      }
    }

    const nextBindAccountId = draft.bindAccountId || null
    if (nextBindAccountId !== (instance.bindAccountId ?? null)) {
      input.bindAccountId = nextBindAccountId
    }

    const nextExtraArgs = draft.extraArgs.trim()
    if (nextExtraArgs !== instance.extraArgs) {
      input.extraArgs = nextExtraArgs
    }

    if (!Object.keys(input).length) {
      return
    }

    await updateInstance(instance.id, input)
  }

  async function confirmRemove(instance: CodexInstanceSummary): Promise<void> {
    if (instance.isDefault || busy) {
      return
    }

    const label = instance.name || instance.id
    if (!window.confirm(copy.deleteInstanceConfirm(label))) {
      return
    }

    await removeInstance(instance.id)
  }
</script>

<section class={panelClass}>
  <div class="grid gap-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <div class="text-sm text-faint">{copy.instanceManager}</div>
        <div class="mt-1 text-sm text-muted">{copy.instanceManagerHint}</div>
      </div>
      <div class="text-sm text-muted">{copy.instanceCount(instances.length)}</div>
    </div>

    <div class="theme-soft-panel grid gap-3 rounded-2xl border border-black/8 p-4">
      <div class="grid gap-3 md:grid-cols-2">
        <AppInput
          bind:value={newInstanceName}
          placeholder={copy.instanceNamePlaceholder}
          disabled={busy}
        />
        <AppInput
          bind:value={newInstanceDir}
          placeholder={copy.instanceDirPlaceholder}
          disabled={busy}
        />
      </div>

      <div class="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_auto]">
        <AppInput
          bind:value={newInstanceArgs}
          placeholder={copy.instanceArgsPlaceholder}
          disabled={busy}
        />
        <select
          class="rounded-xl border border-black/10 bg-transparent px-3 py-2 text-sm text-carbon outline-none focus-visible:ring-2 focus-visible:ring-black/16"
          bind:value={newInstanceBindAccountId}
          disabled={busy}
        >
          <option value="">{copy.instanceUnbound}</option>
          {#each accounts as account (account.id)}
            <option value={account.id}>{account.email ?? account.name ?? account.id}</option>
          {/each}
        </select>
        <AppButton variant="primary" size="md" onclick={() => void submitCreate()} disabled={busy}>
          {copy.createInstance}
        </AppButton>
      </div>

      <div class="text-xs text-faint">
        {copy.defaultInstanceRoot}: {defaults.defaultCodexHome}
      </div>
    </div>

    <div class="grid gap-3">
      {#each instances as instance (instance.id)}
        <article class="theme-soft-panel grid gap-3 rounded-2xl border border-black/8 p-4">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div class="text-sm font-medium text-carbon">
                {instance.isDefault ? copy.defaultInstance : instance.name}
              </div>
              <div class="mt-1 text-xs text-muted">
                {copy.instanceDirectory}: {instance.codexHome}
              </div>
            </div>
            <div class="text-xs text-muted">
              {instance.running ? copy.instanceStatusRunning : copy.instanceStatusStopped} ·
              {instance.initialized ? copy.instanceInitialized : copy.instanceNeedsInit}
            </div>
          </div>

          <div class="grid gap-3 md:grid-cols-2">
            {#if !instance.isDefault}
              <AppInput
                bind:value={drafts[instance.id].name}
                placeholder={copy.instanceNamePlaceholder}
                disabled={busy}
              />
            {/if}

            <select
              class="rounded-xl border border-black/10 bg-transparent px-3 py-2 text-sm text-carbon outline-none focus-visible:ring-2 focus-visible:ring-black/16"
              bind:value={drafts[instance.id].bindAccountId}
              disabled={busy}
            >
              <option value="">{copy.instanceUnbound}</option>
              {#each accounts as account (account.id)}
                <option value={account.id}>{account.email ?? account.name ?? account.id}</option>
              {/each}
            </select>
          </div>

          <AppInput
            bind:value={drafts[instance.id].extraArgs}
            placeholder={copy.instanceArgsPlaceholder}
            disabled={busy}
          />

          <div class="flex flex-wrap items-center gap-2">
            <AppButton
              variant="secondary"
              size="sm"
              onclick={() => void save(instance)}
              disabled={busy}
            >
              {copy.saveInstance}
            </AppButton>
            <AppButton
              variant="secondary"
              size="sm"
              onclick={() =>
                void (instance.running ? stopInstance(instance.id) : startInstance(instance.id))}
              disabled={busy}
            >
              {instance.running ? copy.stopInstance : copy.startInstance}
            </AppButton>
            {#if !instance.isDefault}
              <AppButton
                variant="danger"
                size="sm"
                onclick={() => void confirmRemove(instance)}
                disabled={busy}
              >
                {copy.deleteInstance}
              </AppButton>
            {/if}
          </div>
        </article>
      {/each}
    </div>
  </div>
</section>
