<script lang="ts">
  import { onMount } from 'svelte'

  import type {
    CodexInstanceSummary,
    CreateSkillLibraryInput,
    SkillLibraryCategoryList,
    SkillLibraryDetail,
    SkillLibraryInstallInput,
    SkillLibraryInstallResult,
    SkillLibrarySearchInput,
    SkillLibrarySummary,
    UpdateSkillLibraryInput
  } from '../../../shared/codex'
  import type { LocalizedCopy } from './app-view'
  import AppButton from './AppButton.svelte'
  import AppButtonGroup from './AppButtonGroup.svelte'
  import AppDialog from './AppDialog.svelte'
  import AppInput from './AppInput.svelte'
  import { cascadeIn, reveal } from './gsap-motion'

  export let copy: LocalizedCopy
  export let instances: CodexInstanceSummary[] = []
  export let listSkillLibrary: (input?: SkillLibrarySearchInput) => Promise<SkillLibrarySummary[]>
  export let getSkillLibraryDetail: (skillId: string) => Promise<SkillLibraryDetail>
  export let createSkillLibrary: (input: CreateSkillLibraryInput) => Promise<SkillLibraryDetail>
  export let updateSkillLibrary: (
    skillId: string,
    input: UpdateSkillLibraryInput
  ) => Promise<SkillLibraryDetail>
  export let removeSkillLibrary: (skillId: string) => Promise<void>
  export let listSkillLibraryCategories: () => Promise<SkillLibraryCategoryList>
  export let createSkillLibraryCategory: (name: string) => Promise<SkillLibraryCategoryList>
  export let renameSkillLibraryCategory: (
    oldName: string,
    newName: string
  ) => Promise<SkillLibraryCategoryList>
  export let removeSkillLibraryCategory: (name: string) => Promise<SkillLibraryCategoryList>
  export let installSkillLibrary: (
    input: SkillLibraryInstallInput
  ) => Promise<SkillLibraryInstallResult>

  let skills: SkillLibrarySummary[] = []
  let loading = false
  let error = ''
  let searchQuery = ''
  let selectedCategory = ''
  let categories: string[] = []

  // Detail / Edit
  let currentSkill: SkillLibraryDetail | null = null
  let editMode = false
  let editName = ''
  let editContent = ''
  let editCategories: string[] = []
  let saving = false

  // Create
  let createMode = false
  let createName = ''
  let createContent = ''
  let createCategories: string[] = []

  // Install dialog
  let installOpen = false
  let installSkill: SkillLibrarySummary | null = null
  let installTargetIds: string[] = []
  let installBusy = false
  let installResult: SkillLibraryInstallResult | null = null

  // Category manager
  let categoryManagerOpen = false
  let newCategoryName = ''
  let renamingCategory = ''
  let renameCategoryValue = ''

  async function loadSkills(): Promise<void> {
    loading = true
    error = ''
    try {
      skills = await listSkillLibrary({
        query: searchQuery || undefined,
        category: selectedCategory || undefined
      })
    } catch (err) {
      error = String(err instanceof Error ? err.message : err)
    } finally {
      loading = false
    }
  }

  async function loadCategories(): Promise<void> {
    try {
      const result = await listSkillLibraryCategories()
      categories = result.categories
    } catch {
      // ignore
    }
  }

  onMount(() => {
    loadSkills()
    loadCategories()
  })

  async function openDetail(skill: SkillLibrarySummary): Promise<void> {
    try {
      currentSkill = await getSkillLibraryDetail(skill.id)
      editMode = false
    } catch (err) {
      error = String(err instanceof Error ? err.message : err)
    }
  }

  function startEdit(): void {
    if (!currentSkill) return
    editName = currentSkill.name
    editContent = currentSkill.content
    editCategories = [...currentSkill.categories]
    editMode = true
  }

  async function saveEdit(): Promise<void> {
    if (!currentSkill) return
    saving = true
    try {
      currentSkill = await updateSkillLibrary(currentSkill.id, {
        name: editName || undefined,
        content: editContent,
        categories: editCategories.length ? editCategories : undefined,
        clearCategories: editCategories.length === 0
      })
      editMode = false
      await loadSkills()
    } catch (err) {
      error = String(err instanceof Error ? err.message : err)
    } finally {
      saving = false
    }
  }

  async function deleteSkill(): Promise<void> {
    if (!currentSkill) return
    try {
      await removeSkillLibrary(currentSkill.id)
      currentSkill = null
      await loadSkills()
    } catch (err) {
      error = String(err instanceof Error ? err.message : err)
    }
  }

  async function handleCreate(): Promise<void> {
    saving = true
    try {
      await createSkillLibrary({
        name: createName,
        content: createContent,
        categories: createCategories.length ? createCategories : undefined
      })
      createMode = false
      createName = ''
      createContent = ''
      createCategories = []
      await loadSkills()
    } catch (err) {
      error = String(err instanceof Error ? err.message : err)
    } finally {
      saving = false
    }
  }

  function openInstall(skill: SkillLibrarySummary): void {
    installSkill = skill
    installTargetIds = []
    installResult = null
    installOpen = true
  }

  async function confirmInstall(): Promise<void> {
    if (!installSkill || !installTargetIds.length) return
    installBusy = true
    try {
      installResult = await installSkillLibrary({
        skillId: installSkill.id,
        targetInstanceIds: installTargetIds
      })
    } catch (err) {
      error = String(err instanceof Error ? err.message : err)
    } finally {
      installBusy = false
    }
  }

  async function handleCreateCategory(): Promise<void> {
    if (!newCategoryName.trim()) return
    const result = await createSkillLibraryCategory(newCategoryName.trim())
    categories = result.categories
    newCategoryName = ''
  }

  async function handleRenameCategory(): Promise<void> {
    if (!renamingCategory || !renameCategoryValue.trim()) return
    const result = await renameSkillLibraryCategory(renamingCategory, renameCategoryValue.trim())
    categories = result.categories
    renamingCategory = ''
    renameCategoryValue = ''
  }

  async function handleRemoveCategory(name: string): Promise<void> {
    const result = await removeSkillLibraryCategory(name)
    categories = result.categories
  }

  function backToList(): void {
    currentSkill = null
    editMode = false
    createMode = false
  }

  $: if (searchQuery !== undefined || selectedCategory !== undefined) {
    loadSkills()
  }
</script>

<div class="flex flex-col gap-3 p-4" use:reveal>
  <div class="flex items-center justify-between">
    <div>
      <h2 class="text-base font-semibold">{copy.skillLibraryTitle}</h2>
      <p class="text-xs text-neutral-500">{copy.skillLibraryDescription}</p>
    </div>
    <AppButtonGroup>
      <AppButton size="sm" onclick={() => { createMode = true; currentSkill = null }}>
        {copy.skillLibraryCreate}
      </AppButton>
      <AppButton size="sm" onclick={() => { categoryManagerOpen = true }}>
        {copy.skillLibraryCategoryManager}
      </AppButton>
      <AppButton size="sm" onclick={loadSkills}>
        {copy.skillLibraryRefresh}
      </AppButton>
    </AppButtonGroup>
  </div>

  {#if !currentSkill && !createMode}
    <div class="flex gap-2">
      <AppInput
        placeholder={copy.skillLibrarySearchPlaceholder}
        bind:value={searchQuery}
        class="flex-1"
      />
      <select
        class="rounded border border-neutral-300 bg-white px-2 py-1 text-xs dark:border-neutral-600 dark:bg-neutral-800"
        bind:value={selectedCategory}
      >
        <option value="">{copy.skillLibraryAllCategories}</option>
        {#each categories as cat}
          <option value={cat}>{cat}</option>
        {/each}
      </select>
    </div>

    {#if loading}
      <p class="text-xs text-neutral-500">{copy.skillLibraryLoading}</p>
    {:else if error}
      <p class="text-xs text-red-500">{error}</p>
    {:else if !skills.length}
      <p class="text-xs text-neutral-500">{copy.skillLibraryEmpty}</p>
    {:else}
      <p class="text-xs text-neutral-500">{copy.skillLibraryCount(skills.length)}</p>
      <div class="flex flex-col gap-1" use:cascadeIn>
        {#each skills as skill}
          <div
            class="flex items-center justify-between rounded border border-neutral-200 px-3 py-2 dark:border-neutral-700"
          >
            <button
              class="flex flex-1 flex-col items-start text-left"
              onclick={() => openDetail(skill)}
            >
              <span class="text-sm font-medium">{skill.name}</span>
              {#if skill.description}
                <span class="text-xs text-neutral-500 line-clamp-1">{skill.description}</span>
              {/if}
              {#if skill.categories.length}
                <span class="text-xs text-blue-500">{skill.categories.join(', ')}</span>
              {/if}
            </button>
            <AppButton size="sm" onclick={() => openInstall(skill)}>
              {copy.skillLibraryInstall}
            </AppButton>
          </div>
        {/each}
      </div>
    {/if}
  {/if}

  {#if createMode}
    <div class="flex flex-col gap-2">
      <AppButton size="sm" variant="ghost" onclick={backToList}>
        {copy.skillLibraryBackToList}
      </AppButton>
      <AppInput placeholder={copy.skillLibraryNamePlaceholder} bind:value={createName} />
      <textarea
        class="min-h-48 w-full rounded border border-neutral-300 p-2 font-mono text-xs dark:border-neutral-600 dark:bg-neutral-800"
        placeholder={copy.skillLibraryContentPlaceholder}
        bind:value={createContent}
      ></textarea>
      <AppButtonGroup>
        <AppButton size="sm" onclick={handleCreate} disabled={!createName || !createContent || saving}>
          {copy.skillLibrarySave}
        </AppButton>
        <AppButton size="sm" variant="ghost" onclick={backToList}>
          {copy.skillLibraryCancel}
        </AppButton>
      </AppButtonGroup>
    </div>
  {/if}

  {#if currentSkill && !createMode}
    <div class="flex flex-col gap-2">
      <AppButton size="sm" variant="ghost" onclick={backToList}>
        {copy.skillLibraryBackToList}
      </AppButton>

      {#if !editMode}
        <div class="flex flex-col gap-1">
          <h3 class="text-sm font-semibold">{currentSkill.name}</h3>
          {#if currentSkill.description}
            <p class="text-xs text-neutral-500">{currentSkill.description}</p>
          {/if}
          {#if currentSkill.categories.length}
            <p class="text-xs text-blue-500">{currentSkill.categories.join(', ')}</p>
          {/if}
          {#if currentSkill.files.length}
            <p class="text-xs text-neutral-400">Files: {currentSkill.files.join(', ')}</p>
          {/if}
          <pre class="mt-2 max-h-96 overflow-auto rounded bg-neutral-100 p-2 font-mono text-xs dark:bg-neutral-800">{currentSkill.content}</pre>
          <AppButtonGroup>
            <AppButton size="sm" onclick={startEdit}>{copy.skillLibraryEdit}</AppButton>
            <AppButton size="sm" onclick={() => openInstall(currentSkill!)}>{copy.skillLibraryInstall}</AppButton>
            <AppButton size="sm" variant="danger" onclick={deleteSkill}>{copy.skillLibraryDelete}</AppButton>
          </AppButtonGroup>
        </div>
      {:else}
        <AppInput placeholder={copy.skillLibraryNamePlaceholder} bind:value={editName} />
        <textarea
          class="min-h-48 w-full rounded border border-neutral-300 p-2 font-mono text-xs dark:border-neutral-600 dark:bg-neutral-800"
          bind:value={editContent}
        ></textarea>
        <AppButtonGroup>
          <AppButton size="sm" onclick={saveEdit} disabled={saving}>
            {copy.skillLibrarySave}
          </AppButton>
          <AppButton size="sm" variant="ghost" onclick={() => { editMode = false }}>
            {copy.skillLibraryCancel}
          </AppButton>
        </AppButtonGroup>
      {/if}
    </div>
  {/if}
</div>

<!-- Install Dialog -->
{#if installOpen}
  <AppDialog
    title={copy.skillLibraryInstallTitle}
    open={installOpen}
    onclose={() => { installOpen = false }}
  >
    {#if installSkill}
      <p class="text-xs">{copy.skillLibraryInstallDescription(installSkill.name)}</p>
    {/if}

    {#if !installResult}
      <div class="mt-2 flex flex-col gap-1">
        {#each instances as instance}
          <label class="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              value={instance.id}
              checked={installTargetIds.includes(instance.id)}
              onchange={(e) => {
                const target = e.currentTarget
                if (target.checked) {
                  installTargetIds = [...installTargetIds, instance.id]
                } else {
                  installTargetIds = installTargetIds.filter((id) => id !== instance.id)
                }
              }}
            />
            {instance.name || instance.id}
          </label>
        {/each}
      </div>
      <div class="mt-3">
        <AppButton
          size="sm"
          onclick={confirmInstall}
          disabled={!installTargetIds.length || installBusy}
        >
          {copy.skillLibraryInstallConfirm}
        </AppButton>
      </div>
    {:else}
      <div class="mt-2 flex flex-col gap-1 text-xs">
        {#if installResult.installed.length}
          <p class="text-green-600">{copy.skillLibraryInstallSuccess(installResult.installed.length)}</p>
        {/if}
        {#if installResult.skipped.length}
          <p class="text-yellow-600">{copy.skillLibraryInstallSkipped(installResult.skipped.length)}</p>
        {/if}
        {#if installResult.failed.length}
          <p class="text-red-600">{copy.skillLibraryInstallFailed(installResult.failed.length)}</p>
        {/if}
      </div>
    {/if}
  </AppDialog>
{/if}

<!-- Category Manager Dialog -->
{#if categoryManagerOpen}
  <AppDialog
    title={copy.skillLibraryCategoryManager}
    open={categoryManagerOpen}
    onclose={() => { categoryManagerOpen = false }}
  >
    <div class="flex flex-col gap-2">
      <div class="flex gap-2">
        <AppInput
          placeholder={copy.skillLibraryCategoryPlaceholder}
          bind:value={newCategoryName}
          class="flex-1"
        />
        <AppButton size="sm" onclick={handleCreateCategory}>
          {copy.skillLibraryCategoryCreate}
        </AppButton>
      </div>
      {#each categories as cat}
        <div class="flex items-center justify-between text-xs">
          {#if renamingCategory === cat}
            <AppInput bind:value={renameCategoryValue} class="flex-1 mr-2" />
            <AppButton size="sm" onclick={handleRenameCategory}>
              {copy.skillLibrarySave}
            </AppButton>
          {:else}
            <span>{cat}</span>
            <AppButtonGroup>
              <AppButton
                size="sm"
                variant="ghost"
                onclick={() => { renamingCategory = cat; renameCategoryValue = cat }}
              >
                {copy.skillLibraryCategoryRename}
              </AppButton>
              <AppButton size="sm" variant="danger" onclick={() => handleRemoveCategory(cat)}>
                {copy.skillLibraryCategoryRemove}
              </AppButton>
            </AppButtonGroup>
          {/if}
        </div>
      {/each}
    </div>
  </AppDialog>
{/if}
