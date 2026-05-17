<script lang="ts">
  import { onMount } from 'svelte'

  import type {
    CodexInstanceSummary,
    CodexSkillSummary,
    CodexSkillsResult,
    CreateSkillLibraryInput,
    SkillLibraryCategoryList,
    SkillLibraryCollectInput,
    SkillLibraryCollectResult,
    SkillLibraryDetail,
    SkillLibraryExportResult,
    SkillLibraryImportResult,
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
  import FloatingSelect, { type FloatingSelectOption } from './FloatingSelect.svelte'
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
  export let listCodexSkills: () => Promise<CodexSkillsResult>
  export let importSkillLibraryDirWithDialog: () => Promise<SkillLibraryImportResult | null>
  export let exportSkillLibraryDirWithDialog: () => Promise<SkillLibraryExportResult | null>
  export let collectSkillLibrary: (
    input: SkillLibraryCollectInput
  ) => Promise<SkillLibraryCollectResult>
  export let readSkillLibraryFile: (skillId: string, filePath: string) => Promise<string>

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

  // Install (inline, no dialog)
  let installSkillId = ''
  let installTargetIds: string[] = []
  let installBusy = false
  let installResult: SkillLibraryInstallResult | null = null

  // Category manager
  let categoryManagerOpen = false
  let newCategoryName = ''
  let renamingCategory = ''

  // Delete confirmation
  let deleteConfirmOpen = false
  let renameCategoryValue = ''

  // Import/Export/Collect
  let importExportMessage = ''
  let collectOpen = false
  let collectInstanceId = ''
  let collectSourceSkills: CodexSkillSummary[] = []
  let collectSelectedSkillDirNames: string[] = []
  let collectBusy = false
  let collectScanBusy = false
  let collectScanError = ''
  let mounted = false
  let lastSearchQuery = ''
  let lastSelectedCategory = ''

  // File viewer
  let expandedFiles: Record<string, string> = {}
  let fileLoadingSet: Set<string> = new Set()

  async function toggleFileExpand(filePath: string): Promise<void> {
    if (expandedFiles[filePath] !== undefined) {
      const nextExpandedFiles = { ...expandedFiles }
      delete nextExpandedFiles[filePath]
      expandedFiles = nextExpandedFiles
      return
    }
    if (!currentSkill) return
    fileLoadingSet = new Set([...fileLoadingSet, filePath])
    try {
      const content = await readSkillLibraryFile(currentSkill.id, filePath)
      expandedFiles = { ...expandedFiles, [filePath]: content }
    } catch (err) {
      expandedFiles = {
        ...expandedFiles,
        [filePath]: `Error: ${err instanceof Error ? err.message : String(err)}`
      }
    } finally {
      fileLoadingSet = new Set([...fileLoadingSet].filter((f) => f !== filePath))
    }
  }

  const floatingSelectButtonClass =
    'theme-select flex h-9 w-full items-center justify-between rounded-[0.4rem] border border-[var(--empty-border)] bg-transparent px-3 py-2 text-xs text-carbon outline-none transition-colors duration-140 hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-60'
  const floatingSelectMenuClass = 'theme-tag-picker-surface z-[999] rounded-[0.75rem] p-1.5'
  const floatingSelectOptionClass =
    'theme-menu-choice flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-xs text-muted-strong transition-colors duration-140 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]'

  $: collectInstanceOptions = instances.map(
    (instance): FloatingSelectOption => ({
      value: instance.id,
      label: instance.name || instance.id
    })
  )

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
    mounted = true
    void loadSkills()
    void loadCategories()
  })

  async function openDetail(skill: SkillLibrarySummary): Promise<void> {
    try {
      currentSkill = await getSkillLibraryDetail(skill.id)
      editMode = false
      expandedFiles = {}
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
        name: editName.trim(),
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
        name: createName.trim(),
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

  function toggleInstall(skill: SkillLibrarySummary): void {
    if (installSkillId === skill.id) {
      installSkillId = ''
      installTargetIds = []
      installResult = null
      return
    }
    installSkillId = skill.id
    installTargetIds = []
    installResult = null
  }

  function toggleInstallTarget(instanceId: string): void {
    installTargetIds = installTargetIds.includes(instanceId)
      ? installTargetIds.filter((id) => id !== instanceId)
      : [...installTargetIds, instanceId]
  }

  async function confirmInstall(): Promise<void> {
    if (!installSkillId || !installTargetIds.length) return
    installBusy = true
    try {
      installResult = await installSkillLibrary({
        skillId: installSkillId,
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
    try {
      const result = await createSkillLibraryCategory(newCategoryName.trim())
      categories = result.categories
      newCategoryName = ''
    } catch (err) {
      error = String(err instanceof Error ? err.message : err)
    }
  }

  async function handleRenameCategory(): Promise<void> {
    if (!renamingCategory || !renameCategoryValue.trim()) return
    try {
      const oldName = renamingCategory
      const nextName = renameCategoryValue.trim()
      const result = await renameSkillLibraryCategory(oldName, nextName)
      if (selectedCategory === oldName) selectedCategory = nextName
      categories = result.categories
      renamingCategory = ''
      renameCategoryValue = ''
      await loadSkills()
    } catch (err) {
      error = String(err instanceof Error ? err.message : err)
    }
  }

  async function handleRemoveCategory(name: string): Promise<void> {
    try {
      const result = await removeSkillLibraryCategory(name)
      if (selectedCategory === name) selectedCategory = ''
      categories = result.categories
      await loadSkills()
    } catch (err) {
      error = String(err instanceof Error ? err.message : err)
    }
  }

  async function handleImport(): Promise<void> {
    importExportMessage = ''
    error = ''
    try {
      const result = await importSkillLibraryDirWithDialog()
      if (!result) return
      importExportMessage = copy.skillLibraryImportResult(result.imported, result.skipped)
      if (result.errors.length) {
        importExportMessage += ` (${copy.skillLibraryErrorCount(result.errors.length)})`
      }
      await loadSkills()
    } catch (err) {
      error = String(err instanceof Error ? err.message : err)
    }
  }

  async function handleExport(): Promise<void> {
    importExportMessage = ''
    error = ''
    try {
      const result = await exportSkillLibraryDirWithDialog()
      if (!result) return
      importExportMessage = copy.skillLibraryExportResult(result.exported, result.outputPath)
    } catch (err) {
      error = String(err instanceof Error ? err.message : err)
    }
  }

  async function scanCollectSkills(instanceId = collectInstanceId): Promise<void> {
    collectScanBusy = true
    collectScanError = ''
    collectSourceSkills = []
    collectSelectedSkillDirNames = []
    try {
      const result = await listCodexSkills()
      collectSourceSkills = result.skills
        .filter((skill) => skill.instanceId === instanceId)
        .sort((a, b) => a.name.localeCompare(b.name))
      collectSelectedSkillDirNames = collectSourceSkills.map((skill) => skill.skillDirName)
      collectScanError = result.errorsByInstanceId[instanceId] ?? ''
    } catch (err) {
      collectScanError = String(err instanceof Error ? err.message : err)
    } finally {
      collectScanBusy = false
    }
  }

  function openCollect(): void {
    const firstInstanceId = instances[0]?.id ?? ''
    collectInstanceId = firstInstanceId
    collectSourceSkills = []
    collectSelectedSkillDirNames = []
    collectScanError = ''
    collectOpen = true
    importExportMessage = ''
    if (firstInstanceId) {
      void scanCollectSkills(firstInstanceId)
    }
  }

  function toggleCollectSkill(skillDirName: string): void {
    collectSelectedSkillDirNames = collectSelectedSkillDirNames.includes(skillDirName)
      ? collectSelectedSkillDirNames.filter((item) => item !== skillDirName)
      : [...collectSelectedSkillDirNames, skillDirName]
  }

  function selectAllCollectSkills(): void {
    collectSelectedSkillDirNames = collectSourceSkills.map((skill) => skill.skillDirName)
  }

  function clearCollectSkills(): void {
    collectSelectedSkillDirNames = []
  }

  async function confirmCollect(): Promise<void> {
    if (!collectInstanceId || !collectSelectedSkillDirNames.length) return
    collectBusy = true
    try {
      const result = await collectSkillLibrary({
        sourceInstanceId: collectInstanceId,
        sourceSkillDirNames: collectSelectedSkillDirNames
      })
      importExportMessage = copy.skillLibraryCollectResult(result.collected, result.skipped)
      if (result.errors.length) {
        importExportMessage += ` (${copy.skillLibraryErrorCount(result.errors.length)})`
      }
      collectOpen = false
      await loadSkills()
    } catch (err) {
      error = String(err instanceof Error ? err.message : err)
    } finally {
      collectBusy = false
    }
  }

  function backToList(): void {
    currentSkill = null
    editMode = false
    createMode = false
  }

  function toggleCreateCategory(category: string): void {
    createCategories = createCategories.includes(category)
      ? createCategories.filter((item) => item !== category)
      : [...createCategories, category]
  }

  function toggleEditCategory(category: string): void {
    editCategories = editCategories.includes(category)
      ? editCategories.filter((item) => item !== category)
      : [...editCategories, category]
  }

  $: if (
    mounted &&
    (searchQuery !== lastSearchQuery || selectedCategory !== lastSelectedCategory)
  ) {
    lastSearchQuery = searchQuery
    lastSelectedCategory = selectedCategory
    void loadSkills()
  }
</script>

<div
  class="flex min-h-0 flex-1 flex-col gap-4 px-4 pb-4"
  class:overflow-y-auto={!currentSkill || createMode}
  use:reveal={{ delay: 0.02 }}
>
  <!-- Header -->
  <section
    class="theme-soft-panel grid gap-3 rounded-[0.55rem] border border-[var(--card-border)] px-4 py-4"
  >
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="grid gap-1">
        <p class="text-sm font-semibold tracking-[-0.01em] text-carbon">{copy.skillLibraryTitle}</p>
        <p class="max-w-3xl text-xs leading-5 text-muted-strong">{copy.skillLibraryDescription}</p>
      </div>
      <div class="flex flex-wrap items-center gap-1.5">
        <AppButton
          variant="primary"
          size="sm"
          onclick={() => {
            createMode = true
            currentSkill = null
          }}
        >
          <span class="i-lucide-plus h-3.5 w-3.5"></span>
          <span>{copy.skillLibraryCreate}</span>
        </AppButton>
        <AppButton variant="toolbar" size="sm" onclick={handleImport}>
          <span class="i-lucide-download h-3.5 w-3.5"></span>
          <span>{copy.skillLibraryImport}</span>
        </AppButton>
        <AppButton variant="toolbar" size="sm" onclick={handleExport}>
          <span class="i-lucide-upload h-3.5 w-3.5"></span>
          <span>{copy.skillLibraryExport}</span>
        </AppButton>
        <AppButton variant="toolbar" size="sm" onclick={openCollect}>
          <span class="i-lucide-package h-3.5 w-3.5"></span>
          <span>{copy.skillLibraryCollect}</span>
        </AppButton>
        <AppButton
          variant="toolbar"
          size="sm"
          onclick={() => {
            categoryManagerOpen = true
          }}
        >
          <span class="i-lucide-tags h-3.5 w-3.5"></span>
          <span>{copy.skillLibraryCategoryManager}</span>
        </AppButton>
        <AppButton variant="toolbar" size="sm" onclick={loadSkills} disabled={loading}>
          <span
            class={`${loading ? 'i-lucide-loader-circle animate-spin' : 'i-lucide-refresh-cw'} h-3.5 w-3.5`}
          ></span>
          <span>{loading ? copy.skillLibraryLoading : copy.skillLibraryRefresh}</span>
        </AppButton>
      </div>
    </div>
  </section>

  {#if !currentSkill && !createMode}
    <div class="flex min-h-8 flex-wrap items-center gap-2 pt-1">
      <AppButtonGroup
        class="skill-lib-filter-shell inline-flex min-w-0 max-w-full items-center gap-0 overflow-x-auto rounded-[0.4rem] p-0.5"
      >
        <AppButton
          variant="filter"
          size="sm"
          selected={selectedCategory === ''}
          ariaPressed={selectedCategory === ''}
          onclick={() => {
            selectedCategory = ''
          }}
        >
          {copy.skillLibraryAllCategories}
        </AppButton>
        {#each categories as cat (cat)}
          <AppButton
            variant="filter"
            size="sm"
            selected={selectedCategory === cat}
            ariaPressed={selectedCategory === cat}
            onclick={() => {
              selectedCategory = cat
            }}
          >
            <span class="max-w-[8rem] truncate">{cat}</span>
          </AppButton>
        {/each}
      </AppButtonGroup>

      <div class="flex-1"></div>

      <AppInput
        variant="search"
        size="sm"
        icon="i-lucide-search"
        class="w-44"
        placeholder={copy.skillLibrarySearchPlaceholder}
        bind:value={searchQuery}
      />
    </div>

    {#if importExportMessage}
      <div class="skill-lib-success-banner rounded-[0.45rem] px-3 py-2 text-xs">
        {importExportMessage}
      </div>
    {/if}

    {#if error}
      <div
        class="theme-error-panel rounded-[0.45rem] border border-danger/18 bg-danger/8 px-3 py-2 text-sm text-danger"
      >
        {error}
      </div>
    {/if}

    <!-- Content -->
    <div class="grid gap-3">
      {#if loading && !skills.length}
        <section
          class="theme-soft-panel rounded-[0.55rem] border border-[var(--card-border)] px-4 py-8 text-center text-sm text-muted-strong"
        >
          <div class="flex flex-col items-center justify-center gap-2">
            <span class="i-lucide-loader-circle h-5 w-5 animate-spin text-faint"></span>
            <span>{copy.skillLibraryLoading}</span>
          </div>
        </section>
      {:else if !skills.length}
        <section
          class="theme-soft-panel rounded-[0.55rem] border border-[var(--card-border)] px-4 py-8 text-center text-sm text-muted-strong"
        >
          <div class="flex flex-col items-center justify-center gap-2">
            <span class="i-lucide-book-open h-5 w-5 text-faint"></span>
            <p>{copy.skillLibraryEmpty}</p>
          </div>
        </section>
      {:else}
        <section
          class="theme-soft-panel grid gap-2 rounded-[0.55rem] border border-[var(--card-border)] px-4 py-4"
          use:cascadeIn={{ selector: '[data-motion-item]' }}
        >
          <div class="flex flex-wrap items-center gap-2">
            <span class="i-lucide-book-open h-3.5 w-3.5 text-faint"></span>
            <span class="text-sm font-semibold text-carbon">{copy.skillLibraryTitle}</span>
            <span class="skill-lib-count-pill">{copy.skillLibraryCount(skills.length)}</span>
          </div>

          <div class="grid gap-1.5">
            {#each skills as skill (skill.id)}
              <article class="skill-lib-card" data-motion-item>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <span class="i-lucide-sparkles h-3.5 w-3.5 flex-none text-faint"></span>
                    <AppButton
                      variant="link"
                      class="min-w-0 truncate text-sm font-semibold"
                      onclick={() => openDetail(skill)}
                    >
                      {skill.name}
                    </AppButton>
                  </div>
                  {#if skill.description}
                    <p class="skill-lib-card-description mt-0.5 truncate pl-5.5 text-xs">
                      {skill.description}
                    </p>
                  {/if}
                  {#if skill.categories.length}
                    <div class="mt-1.5 flex flex-wrap gap-1.5 pl-5.5">
                      {#each skill.categories as cat (cat)}
                        <span class="skill-lib-tag">{cat}</span>
                      {/each}
                    </div>
                  {/if}
                </div>
                <div class="skill-lib-card-actions">
                  <AppButton
                    variant="icon"
                    size="xs"
                    ariaLabel={copy.skillLibraryInstall}
                    onclick={() => toggleInstall(skill)}
                  >
                    <span class="i-lucide-download h-3.5 w-3.5"></span>
                  </AppButton>
                </div>
                {#if installSkillId === skill.id}
                  <div class="skill-lib-install-inline">
                    {#if !installResult}
                      <div class="flex flex-wrap items-center gap-2">
                        {#each instances as instance (instance.id)}
                          <label class="skill-lib-checkbox-label">
                            <input
                              type="checkbox"
                              checked={installTargetIds.includes(instance.id)}
                              onchange={() => toggleInstallTarget(instance.id)}
                            />
                            <span>{instance.name || instance.id}</span>
                          </label>
                        {/each}
                        <AppButton
                          variant="primary"
                          size="xs"
                          onclick={confirmInstall}
                          disabled={!installTargetIds.length || installBusy}
                        >
                          {#if installBusy}
                            <span class="i-lucide-loader-circle h-3 w-3 animate-spin"></span>
                          {/if}
                          <span>{copy.skillLibraryInstallConfirm}</span>
                        </AppButton>
                      </div>
                    {:else}
                      <div class="flex flex-wrap items-center gap-3 text-xs">
                        {#if installResult.installed.length}
                          <span class="text-success"
                            >{copy.skillLibraryInstallSuccess(installResult.installed.length)}</span
                          >
                        {/if}
                        {#if installResult.skipped.length}
                          <span class="text-warn"
                            >{copy.skillLibraryInstallSkipped(installResult.skipped.length)}</span
                          >
                        {/if}
                        {#if installResult.failed.length}
                          <span class="text-danger"
                            >{copy.skillLibraryInstallFailed(installResult.failed.length)}</span
                          >
                        {/if}
                      </div>
                    {/if}
                  </div>
                {/if}
              </article>
            {/each}
          </div>
        </section>
      {/if}
    </div>
  {/if}

  {#if currentSkill && !createMode}
    <section class="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4">
      <div class="flex items-center gap-2">
        <AppButton variant="toolbar" size="sm" onclick={backToList}>
          <span class="i-lucide-arrow-left h-3.5 w-3.5"></span>
          <span>{copy.skillLibraryBackToList}</span>
        </AppButton>
        <span class="text-sm font-semibold text-carbon">{currentSkill.name}</span>
      </div>

      {#if !editMode}
        <dl class="skill-lib-detail-meta">
          {#if currentSkill.description}
            <div class="skill-lib-detail-meta-item">
              <dt>Description</dt>
              <dd>{currentSkill.description}</dd>
            </div>
          {/if}
          {#if currentSkill.categories.length}
            <div class="skill-lib-detail-meta-item">
              <dt>Categories</dt>
              <dd>
                <div class="flex flex-wrap gap-1.5">
                  {#each currentSkill.categories as cat (cat)}
                    <span class="skill-lib-tag">{cat}</span>
                  {/each}
                </div>
              </dd>
            </div>
          {/if}
          {#if currentSkill.files.length}
            <div class="skill-lib-detail-meta-item">
              <dt>Files</dt>
              <dd>
                <div class="grid gap-1">
                  {#each currentSkill.files as file (file)}
                    <div class="skill-lib-file-item">
                      <button
                        class="skill-lib-file-toggle"
                        type="button"
                        onclick={() => toggleFileExpand(file)}
                      >
                        <span
                          class={`h-3 w-3 flex-none transition-transform duration-140 ${expandedFiles[file] !== undefined ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'}`}
                        ></span>
                        <span class="min-w-0 truncate">{file}</span>
                        {#if fileLoadingSet.has(file)}
                          <span
                            class="i-lucide-loader-circle h-3 w-3 flex-none animate-spin text-faint"
                          ></span>
                        {/if}
                      </button>
                      {#if expandedFiles[file] !== undefined}
                        <pre class="skill-lib-file-content">{expandedFiles[file]}</pre>
                      {/if}
                    </div>
                  {/each}
                </div>
              </dd>
            </div>
          {/if}
        </dl>

        <div class="flex min-h-0 flex-1 flex-col gap-1.5">
          <span class="text-xs font-medium text-muted-strong">Content</span>
          <pre
            class="skill-lib-content-pre min-h-0 flex-1 overflow-auto rounded-[0.5rem] border border-[var(--card-border)] px-3 py-3 font-mono text-[13px] leading-relaxed whitespace-pre-wrap text-carbon">{currentSkill.content}</pre>
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <AppButton variant="secondary" size="sm" onclick={startEdit}>
            <span class="i-lucide-pencil h-3.5 w-3.5"></span>
            <span>{copy.skillLibraryEdit}</span>
          </AppButton>
          <AppButton variant="secondary" size="sm" onclick={() => toggleInstall(currentSkill!)}>
            <span class="i-lucide-download h-3.5 w-3.5"></span>
            <span>{copy.skillLibraryInstall}</span>
          </AppButton>
          <AppButton
            variant="danger"
            size="sm"
            onclick={() => {
              deleteConfirmOpen = true
            }}
          >
            <span class="i-lucide-trash-2 h-3.5 w-3.5"></span>
            <span>{copy.skillLibraryDelete}</span>
          </AppButton>
        </div>

        {#if currentSkill && installSkillId === currentSkill.id}
          <div class="skill-lib-install-inline">
            {#if !installResult}
              <div class="flex flex-wrap items-center gap-2">
                {#each instances as instance (instance.id)}
                  <label class="skill-lib-checkbox-label">
                    <input
                      type="checkbox"
                      checked={installTargetIds.includes(instance.id)}
                      onchange={() => toggleInstallTarget(instance.id)}
                    />
                    <span>{instance.name || instance.id}</span>
                  </label>
                {/each}
                <AppButton
                  variant="primary"
                  size="xs"
                  onclick={confirmInstall}
                  disabled={!installTargetIds.length || installBusy}
                >
                  {#if installBusy}
                    <span class="i-lucide-loader-circle h-3 w-3 animate-spin"></span>
                  {/if}
                  <span>{copy.skillLibraryInstallConfirm}</span>
                </AppButton>
              </div>
            {:else}
              <div class="flex flex-wrap items-center gap-3 text-xs">
                {#if installResult.installed.length}
                  <span class="text-success"
                    >{copy.skillLibraryInstallSuccess(installResult.installed.length)}</span
                  >
                {/if}
                {#if installResult.skipped.length}
                  <span class="text-warn"
                    >{copy.skillLibraryInstallSkipped(installResult.skipped.length)}</span
                  >
                {/if}
                {#if installResult.failed.length}
                  <span class="text-danger"
                    >{copy.skillLibraryInstallFailed(installResult.failed.length)}</span
                  >
                {/if}
              </div>
            {/if}
          </div>
        {/if}
      {:else}
        <AppInput placeholder={copy.skillLibraryNamePlaceholder} bind:value={editName} />
        <textarea class="skill-lib-textarea" bind:value={editContent}></textarea>

        {#if categories.length}
          <div class="grid gap-1.5">
            <span class="text-xs font-medium text-muted-strong">
              {copy.skillLibraryCategorySelection}
            </span>
            <div class="flex flex-wrap gap-2">
              {#each categories as cat (cat)}
                <label class="skill-lib-checkbox-label">
                  <input
                    type="checkbox"
                    checked={editCategories.includes(cat)}
                    onchange={() => toggleEditCategory(cat)}
                  />
                  <span>{cat}</span>
                </label>
              {/each}
            </div>
          </div>
        {/if}

        <div class="flex justify-end gap-2 pt-2">
          <AppButton
            variant="ghost"
            size="sm"
            onclick={() => {
              editMode = false
            }}
          >
            {copy.skillLibraryCancel}
          </AppButton>
          <AppButton
            variant="primary"
            size="sm"
            onclick={saveEdit}
            disabled={!editName.trim() || saving}
          >
            {#if saving}
              <span class="i-lucide-loader-circle h-3.5 w-3.5 animate-spin"></span>
            {:else}
              <span class="i-lucide-check h-3.5 w-3.5"></span>
            {/if}
            <span>{copy.skillLibrarySave}</span>
          </AppButton>
        </div>
      {/if}
    </section>
  {/if}
</div>

<!-- Create Dialog -->
{#if createMode}
  <AppDialog
    title={copy.skillLibraryCreate}
    panelClass="skill-lib-dialog-panel"
    showClose
    onclose={backToList}
  >
    <div class="flex flex-col gap-3">
      <AppInput placeholder={copy.skillLibraryNamePlaceholder} bind:value={createName} />
      <textarea
        class="skill-lib-textarea"
        placeholder={copy.skillLibraryContentPlaceholder}
        bind:value={createContent}
      ></textarea>

      {#if categories.length}
        <div class="grid gap-1.5">
          <span class="text-xs font-medium text-muted-strong">
            {copy.skillLibraryCategorySelection}
          </span>
          <div class="flex flex-wrap gap-2">
            {#each categories as cat (cat)}
              <label class="skill-lib-checkbox-label">
                <input
                  type="checkbox"
                  checked={createCategories.includes(cat)}
                  onchange={() => toggleCreateCategory(cat)}
                />
                <span>{cat}</span>
              </label>
            {/each}
          </div>
        </div>
      {/if}

      <div class="flex justify-end gap-2 pt-2">
        <AppButton variant="ghost" size="sm" onclick={backToList}>
          {copy.skillLibraryCancel}
        </AppButton>
        <AppButton
          variant="primary"
          size="sm"
          onclick={handleCreate}
          disabled={!createName.trim() || !createContent || saving}
        >
          {#if saving}
            <span class="i-lucide-loader-circle h-3.5 w-3.5 animate-spin"></span>
          {:else}
            <span class="i-lucide-check h-3.5 w-3.5"></span>
          {/if}
          <span>{copy.skillLibrarySave}</span>
        </AppButton>
      </div>
    </div>
  </AppDialog>
{/if}

<!-- Category Manager Dialog -->
{#if categoryManagerOpen}
  <AppDialog
    title={copy.skillLibraryCategoryManager}
    panelClass="skill-lib-dialog-panel"
    showClose
    onclose={() => {
      categoryManagerOpen = false
    }}
  >
    <div class="flex flex-col gap-3">
      <div class="flex gap-2">
        <AppInput
          placeholder={copy.skillLibraryCategoryPlaceholder}
          bind:value={newCategoryName}
          class="flex-1"
        />
        <AppButton variant="primary" size="sm" onclick={handleCreateCategory}>
          <span class="i-lucide-plus h-3.5 w-3.5"></span>
          <span>{copy.skillLibraryCategoryCreate}</span>
        </AppButton>
      </div>
      {#each categories as cat (cat)}
        <div class="skill-lib-category-item">
          {#if renamingCategory === cat}
            <AppInput bind:value={renameCategoryValue} class="flex-1" />
            <AppButton variant="primary" size="sm" onclick={handleRenameCategory}>
              <span class="i-lucide-check h-3.5 w-3.5"></span>
              <span>{copy.skillLibrarySave}</span>
            </AppButton>
          {:else}
            <span class="flex-1 text-sm text-carbon">{cat}</span>
            <div class="flex items-center gap-1.5">
              <AppButton
                variant="icon"
                size="xs"
                ariaLabel={copy.skillLibraryCategoryRename}
                onclick={() => {
                  renamingCategory = cat
                  renameCategoryValue = cat
                }}
              >
                <span class="i-lucide-pencil h-3.5 w-3.5"></span>
              </AppButton>
              <AppButton
                variant="icon"
                size="xs"
                ariaLabel={copy.skillLibraryCategoryRemove}
                onclick={() => handleRemoveCategory(cat)}
              >
                <span class="i-lucide-trash-2 h-3.5 w-3.5 text-danger"></span>
              </AppButton>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </AppDialog>
{/if}

<!-- Delete Confirmation Dialog -->
{#if deleteConfirmOpen && currentSkill}
  <AppDialog
    title={copy.skillLibraryDelete}
    panelClass="skill-lib-dialog-panel"
    showClose
    onclose={() => {
      deleteConfirmOpen = false
    }}
  >
    <p class="text-xs text-muted-strong">{copy.skillLibraryDeleteConfirm(currentSkill.name)}</p>
    <div class="mt-4 flex justify-end gap-2">
      <AppButton
        variant="ghost"
        size="sm"
        onclick={() => {
          deleteConfirmOpen = false
        }}
      >
        {copy.skillLibraryCancel}
      </AppButton>
      <AppButton
        variant="danger"
        size="sm"
        onclick={() => {
          deleteConfirmOpen = false
          deleteSkill()
        }}
      >
        <span class="i-lucide-trash-2 h-3.5 w-3.5"></span>
        <span>{copy.skillLibraryDelete}</span>
      </AppButton>
    </div>
  </AppDialog>
{/if}

<!-- Collect Dialog -->
{#if collectOpen}
  <AppDialog
    title={copy.skillLibraryCollect}
    panelClass="skill-lib-dialog-panel"
    showClose
    onclose={() => {
      collectOpen = false
    }}
  >
    <div class="flex flex-col gap-3">
      <div class="grid gap-1.5">
        <span class="text-xs font-medium text-muted-strong">
          {copy.skillLibraryCollectInstance}
        </span>
        <FloatingSelect
          options={collectInstanceOptions}
          value={collectInstanceId}
          ariaLabel={copy.skillLibraryCollectInstance}
          buttonClass={floatingSelectButtonClass}
          menuClass={floatingSelectMenuClass}
          optionClass={floatingSelectOptionClass}
          activeOptionClass="theme-menu-choice-active bg-[var(--surface-soft)]"
          inactiveOptionClass="bg-transparent hover:bg-[var(--surface-hover)]"
          on:change={(event) => {
            collectInstanceId = event.detail
            void scanCollectSkills(event.detail)
          }}
        />
      </div>
      <div class="grid gap-2">
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs font-medium text-muted-strong">
            {copy.skillLibraryCollectNames}
          </span>
          {#if collectSourceSkills.length}
            <div class="flex items-center gap-1.5">
              <AppButton variant="ghost" size="xs" onclick={selectAllCollectSkills}>
                {copy.skillLibraryCollectSelectAll}
              </AppButton>
              <AppButton variant="ghost" size="xs" onclick={clearCollectSkills}>
                {copy.skillLibraryCollectClear}
              </AppButton>
            </div>
          {/if}
        </div>

        {#if collectScanBusy}
          <div
            class="flex items-center gap-2 rounded-[0.45rem] border border-[var(--card-border)] px-3 py-2 text-xs text-muted-strong"
          >
            <span class="i-lucide-loader-circle h-3.5 w-3.5 animate-spin"></span>
            <span>{copy.skillLibraryCollectScanning}</span>
          </div>
        {:else if collectScanError}
          <div
            class="theme-error-panel rounded-[0.45rem] border border-danger/18 bg-danger/8 px-3 py-2 text-xs text-danger"
          >
            {collectScanError}
          </div>
        {:else if collectSourceSkills.length}
          <div
            class="grid max-h-64 gap-1.5 overflow-auto rounded-[0.5rem] border border-[var(--card-border)] bg-[var(--surface-soft)] p-2"
          >
            {#each collectSourceSkills as skill (skill.skillDirName)}
              <label
                class="flex cursor-pointer items-start gap-2 rounded-[0.4rem] px-2 py-1.5 text-xs hover:bg-[var(--surface-hover)]"
              >
                <input
                  class="mt-0.5"
                  type="checkbox"
                  checked={collectSelectedSkillDirNames.includes(skill.skillDirName)}
                  onchange={() => toggleCollectSkill(skill.skillDirName)}
                />
                <span class="min-w-0 flex-1">
                  <span class="block truncate font-medium text-carbon">{skill.name}</span>
                  <span class="block truncate text-muted-strong">{skill.skillDirName}</span>
                </span>
              </label>
            {/each}
          </div>
        {:else}
          <div
            class="rounded-[0.45rem] border border-[var(--card-border)] px-3 py-2 text-xs text-muted-strong"
          >
            {copy.skillLibraryCollectEmpty}
          </div>
        {/if}
      </div>
      <div class="flex justify-end pt-1">
        <AppButton
          variant="primary"
          size="sm"
          onclick={confirmCollect}
          disabled={!collectInstanceId ||
            !collectSelectedSkillDirNames.length ||
            collectBusy ||
            collectScanBusy}
        >
          {#if collectBusy}
            <span class="i-lucide-loader-circle h-3.5 w-3.5 animate-spin"></span>
          {:else}
            <span class="i-lucide-package h-3.5 w-3.5"></span>
          {/if}
          <span>{copy.skillLibraryCollect}</span>
        </AppButton>
      </div>
    </div>
  </AppDialog>
{/if}

<style>
  :global(.skill-lib-filter-shell) {
    background: transparent;
    scrollbar-width: none;
  }

  :global(.skill-lib-filter-shell::-webkit-scrollbar) {
    display: none;
  }

  :global(.skill-lib-dialog-panel) {
    border-color: color-mix(in srgb, var(--line-strong) 78%, transparent) !important;
    background: var(--panel-strong) !important;
  }

  .skill-lib-count-pill {
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-carbon) 7%, transparent);
    color: var(--ink-faint);
    font-size: 0.625rem;
    font-weight: 700;
    line-height: 1;
    padding: 0.15rem 0.35rem;
  }

  .skill-lib-card {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
    gap: 0.75rem;
    border: 1px solid color-mix(in srgb, var(--color-arctic-mist) 82%, transparent);
    border-radius: 0.45rem;
    background: color-mix(in srgb, var(--panel-strong) 66%, var(--surface-soft));
    padding: 0.62rem 0.75rem;
    transition:
      background-color 140ms ease,
      border-color 140ms ease;
  }

  .skill-lib-card:hover,
  .skill-lib-card:focus-within {
    border-color: color-mix(in srgb, var(--line-strong) 78%, transparent);
    background: color-mix(in srgb, var(--surface-hover) 78%, transparent);
  }

  .skill-lib-card-description {
    color: var(--ink-soft-strong);
  }

  .skill-lib-card-actions {
    display: flex;
    flex: none;
    align-items: center;
    gap: 0.25rem;
    opacity: 0.58;
    transition: opacity 140ms ease;
  }

  .skill-lib-card:hover .skill-lib-card-actions,
  .skill-lib-card:focus-within .skill-lib-card-actions {
    opacity: 1;
  }

  .skill-lib-install-inline {
    grid-column: 1 / -1;
    border-top: 1px solid color-mix(in srgb, var(--color-arctic-mist) 60%, transparent);
    padding-top: 0.5rem;
    margin-top: 0.25rem;
  }

  .skill-lib-content-pre {
    background: color-mix(in srgb, var(--panel-strong) 66%, var(--surface-soft));
    box-shadow: inset 0 1px 3px color-mix(in srgb, var(--color-carbon) 4%, transparent);
  }

  .skill-lib-file-item {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .skill-lib-file-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    border: none;
    background: none;
    color: var(--color-carbon);
    font-size: 0.75rem;
    font-weight: 500;
    cursor: pointer;
    padding: 0.15rem 0;
    text-align: left;
  }

  .skill-lib-file-toggle:hover {
    color: var(--color-link-blue);
  }

  .skill-lib-file-content {
    max-height: 16rem;
    overflow: auto;
    border: 1px solid color-mix(in srgb, var(--color-arctic-mist) 60%, transparent);
    border-radius: 0.4rem;
    background: color-mix(in srgb, var(--panel-strong) 66%, var(--surface-soft));
    padding: 0.5rem 0.65rem;
    font-family: 'SF Mono', 'Fira Code', ui-monospace, monospace;
    font-size: 0.7rem;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-all;
    color: var(--color-carbon);
  }

  .skill-lib-tag {
    border: 1px solid color-mix(in srgb, var(--color-arctic-mist) 82%, transparent);
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-carbon) 5%, transparent);
    color: var(--ink-soft-strong);
    font-size: 0.68rem;
    font-weight: 650;
    line-height: 1;
    padding: 0.25rem 0.48rem;
  }

  .skill-lib-detail-meta {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.5rem 0.75rem;
    border: 1px solid color-mix(in srgb, var(--color-arctic-mist) 78%, transparent);
    border-radius: 0.5rem;
    background: color-mix(in srgb, var(--surface-soft) 54%, transparent);
    padding: 0.75rem;
    font-size: 0.75rem;
  }

  .skill-lib-detail-meta-item {
    display: contents;
  }

  .skill-lib-detail-meta dt {
    color: var(--ink-faint);
    font-weight: 650;
    white-space: nowrap;
  }

  .skill-lib-detail-meta dd {
    min-width: 0;
    color: var(--color-carbon);
    font-weight: 600;
  }

  .skill-lib-textarea {
    min-height: 12rem;
    width: 100%;
    resize: vertical;
    border: 1px solid color-mix(in srgb, var(--line-strong) 70%, transparent);
    border-radius: 0.45rem;
    background: var(--panel-strong);
    box-shadow: var(--input-shadow);
    color: var(--color-carbon);
    font-family: 'SF Mono', 'Fira Code', ui-monospace, monospace;
    font-size: 0.75rem;
    line-height: 1.6;
    padding: 0.62rem 0.75rem;
    transition:
      border-color 140ms ease,
      box-shadow 140ms ease;
  }

  .skill-lib-textarea:focus {
    border-color: var(--line-strong);
    outline: 2px solid color-mix(in srgb, var(--ring) 78%, var(--color-carbon) 22%);
    outline-offset: 2px;
  }

  .skill-lib-checkbox-label {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.75rem;
    color: var(--ink-soft-strong);
    cursor: pointer;
  }

  .skill-lib-checkbox-label input {
    width: 0.9rem;
    height: 0.9rem;
    cursor: pointer;
    accent-color: var(--color-carbon);
  }

  .skill-lib-category-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    border: 1px solid color-mix(in srgb, var(--color-arctic-mist) 82%, transparent);
    border-radius: 0.45rem;
    background: color-mix(in srgb, var(--panel-strong) 66%, var(--surface-soft));
    padding: 0.55rem 0.65rem;
    transition:
      background-color 140ms ease,
      border-color 140ms ease;
  }

  .skill-lib-category-item:hover {
    border-color: color-mix(in srgb, var(--line-strong) 78%, transparent);
    background: color-mix(in srgb, var(--surface-hover) 78%, transparent);
  }

  .skill-lib-success-banner {
    border: 1px solid color-mix(in srgb, var(--success) 18%, transparent);
    background: color-mix(in srgb, var(--success) 8%, transparent);
    color: var(--success);
  }
</style>
