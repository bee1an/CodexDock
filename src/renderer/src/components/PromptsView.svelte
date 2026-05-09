<script lang="ts">
  import { onMount } from 'svelte'

  import type {
    CreatePromptInput,
    PromptCategoryList,
    PromptDetail,
    PromptSearchInput,
    PromptSummary,
    UpdatePromptInput
  } from '../../../shared/codex'
  import AppButton from './AppButton.svelte'
  import AppDialog from './AppDialog.svelte'
  import AppInput from './AppInput.svelte'
  import type { LocalizedCopy } from './app-view'
  import { cascadeIn, reveal } from './gsap-motion'

  export let copy: LocalizedCopy
  export let listPrompts: (input?: PromptSearchInput) => Promise<PromptSummary[]>
  export let getPromptDetail: (promptId: string) => Promise<PromptDetail>
  export let createPrompt: (input: CreatePromptInput) => Promise<PromptDetail>
  export let updatePrompt: (promptId: string, input: UpdatePromptInput) => Promise<PromptDetail>
  export let removePrompt: (promptId: string) => Promise<void>
  export let copyPromptContent: (promptId: string) => Promise<string>
  export let listPromptCategories: () => Promise<PromptCategoryList>
  export let createPromptCategory: (name: string) => Promise<PromptCategoryList>
  export let renamePromptCategory: (oldName: string, newName: string) => Promise<PromptCategoryList>
  export let removePromptCategory: (name: string) => Promise<PromptCategoryList>

  type ViewMode = 'list' | 'detail' | 'edit'

  let prompts: PromptSummary[] = []
  let categories: string[] = []
  let loading = false
  let error = ''
  let searchQuery = ''
  let selectedCategory = ''
  let viewMode: ViewMode = 'list'
  let editingPrompt: PromptDetail | null = null
  let viewingPrompt: PromptDetail | null = null
  let editTitle = ''
  let editContent = ''
  let editCategories: string[] = []
  let saving = false
  let copiedId = ''
  let showCategoryManager = false
  let newCategoryName = ''
  let renamingCategory = ''
  let renameCategoryValue = ''

  $: selectedCategoryLabel = selectedCategory || copy.promptsAllCategories

  function closeCategoryManager(): void {
    showCategoryManager = false
    renamingCategory = ''
    renameCategoryValue = ''
  }

  async function refresh(): Promise<void> {
    if (loading) return
    loading = true
    error = ''
    try {
      const [promptList, catList] = await Promise.all([
        listPrompts({ query: searchQuery || undefined, category: selectedCategory || undefined }),
        listPromptCategories()
      ])
      prompts = promptList
      categories = catList.categories
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load prompts'
    } finally {
      loading = false
    }
  }

  async function selectCategory(category: string): Promise<void> {
    selectedCategory = category
    await refresh()
  }

  async function openDetail(prompt: PromptSummary): Promise<void> {
    try {
      viewingPrompt = await getPromptDetail(prompt.id)
      viewMode = 'detail'
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load prompt'
    }
  }

  function startCreate(): void {
    editingPrompt = null
    editTitle = ''
    editContent = ''
    editCategories = []
    viewMode = 'edit'
  }

  async function startEdit(prompt: PromptSummary): Promise<void> {
    try {
      const detail = await getPromptDetail(prompt.id)
      editingPrompt = detail
      editTitle = detail.title
      editContent = detail.content
      editCategories = [...detail.categories]
      viewMode = 'edit'
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load prompt'
    }
  }

  async function savePrompt(): Promise<void> {
    if (!editTitle.trim() || saving) return
    saving = true
    try {
      if (editingPrompt) {
        await updatePrompt(editingPrompt.id, {
          title: editTitle,
          content: editContent,
          categories: editCategories
        })
      } else {
        await createPrompt({
          title: editTitle,
          content: editContent,
          categories: editCategories.length ? editCategories : undefined
        })
      }
      backToList()
      await refresh()
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to save'
    } finally {
      saving = false
    }
  }

  async function deletePrompt(prompt: PromptSummary): Promise<void> {
    if (!window.confirm(copy.promptsDeleteConfirm(prompt.title))) return
    try {
      await removePrompt(prompt.id)
      backToList()
      await refresh()
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to delete'
    }
  }

  async function copyContent(promptId: string): Promise<void> {
    const text = await copyPromptContent(promptId)
    await navigator.clipboard.writeText(text)
    copiedId = promptId
    setTimeout(() => {
      copiedId = ''
    }, 1500)
  }

  async function addCategory(): Promise<void> {
    if (!newCategoryName.trim()) return
    try {
      const result = await createPromptCategory(newCategoryName.trim())
      categories = result.categories
      newCategoryName = ''
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to create category'
    }
  }

  async function doRenameCategory(): Promise<void> {
    if (!renamingCategory || !renameCategoryValue.trim()) return
    try {
      const nextName = renameCategoryValue.trim()
      const result = await renamePromptCategory(renamingCategory, nextName)
      if (selectedCategory === renamingCategory) selectedCategory = nextName
      categories = result.categories
      renamingCategory = ''
      renameCategoryValue = ''
      await refresh()
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to rename category'
    }
  }

  async function doRemoveCategory(name: string): Promise<void> {
    if (!window.confirm(copy.promptsCategoryRemoveConfirm(name))) return
    try {
      const result = await removePromptCategory(name)
      categories = result.categories
      if (selectedCategory === name) selectedCategory = ''
      await refresh()
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to remove category'
    }
  }

  function toggleEditCategory(cat: string): void {
    editCategories = editCategories.includes(cat)
      ? editCategories.filter((c) => c !== cat)
      : [...editCategories, cat]
  }

  function backToList(): void {
    viewMode = 'list'
    viewingPrompt = null
    editingPrompt = null
  }

  function formattedDate(value: string): string {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    return new Intl.DateTimeFormat(undefined, {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date)
  }

  onMount(() => {
    void refresh()
  })
</script>

<div
  class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4"
  use:reveal={{ delay: 0.02 }}
>
  <section class="theme-soft-panel grid gap-3 rounded-[0.55rem] border border-black/8 px-4 py-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="grid gap-1">
        <p class="text-sm font-semibold tracking-[-0.01em] text-carbon">{copy.promptsTitle}</p>
        <p class="max-w-3xl text-xs leading-5 text-muted-strong">
          {copy.promptsDescription}
        </p>
        <p class="text-[11px] text-faint">
          {copy.promptsCount(prompts.length)} · {selectedCategoryLabel}
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <AppButton
          variant="toolbar"
          size="sm"
          onclick={() => {
            showCategoryManager = true
          }}
        >
          <span class="i-lucide-folder-plus h-3.5 w-3.5"></span>
          <span>{copy.promptsCategoryManager}</span>
        </AppButton>
        <AppButton variant="toolbar" size="sm" onclick={() => void refresh()} disabled={loading}>
          <span
            class={`${loading ? 'i-lucide-loader-circle animate-spin' : 'i-lucide-refresh-cw'} h-3.5 w-3.5`}
          ></span>
          <span>{loading ? copy.refreshing : copy.promptsRefresh}</span>
        </AppButton>
        <AppButton variant="primary" size="sm" onclick={startCreate}>
          <span class="i-lucide-plus h-4 w-4"></span>
          <span>{copy.promptsCreate}</span>
        </AppButton>
      </div>
    </div>

    <div class="flex min-h-8 flex-wrap items-center gap-2 pt-1">
      <div
        class="prompts-filter-shell inline-flex min-w-0 max-w-full items-center gap-0 overflow-x-auto rounded-[0.4rem] p-0.5"
      >
        <AppButton
          variant="filter"
          size="sm"
          selected={selectedCategory === ''}
          ariaPressed={selectedCategory === ''}
          onclick={() => void selectCategory('')}
        >
          {copy.promptsAllCategories}
        </AppButton>
        {#each categories as cat (cat)}
          <AppButton
            variant="filter"
            size="sm"
            selected={selectedCategory === cat}
            ariaPressed={selectedCategory === cat}
            onclick={() => void selectCategory(cat)}
          >
            <span class="max-w-[8rem] truncate">{cat}</span>
          </AppButton>
        {/each}
      </div>

      <div class="flex-1"></div>

      <AppInput
        variant="search"
        size="sm"
        icon="i-lucide-search"
        class="w-52"
        placeholder={copy.promptsSearchPlaceholder}
        bind:value={searchQuery}
        oninput={() => void refresh()}
      />
    </div>

    {#if error}
      <div
        class="theme-error-panel rounded-[0.45rem] border border-danger/18 bg-danger/8 px-3 py-2 text-sm text-danger"
      >
        {error}
      </div>
    {/if}
  </section>

  <div class="grid gap-3">
    {#if loading && !prompts.length}
      <section
        class="theme-soft-panel rounded-[0.55rem] border border-black/8 px-4 py-8 text-center text-sm text-muted-strong"
      >
        <div class="flex flex-col items-center justify-center gap-2">
          <span class="i-lucide-loader-circle h-5 w-5 animate-spin text-faint"></span>
          <span>{copy.refreshing}</span>
        </div>
      </section>
    {:else if !prompts.length}
      <section
        class="theme-soft-panel rounded-[0.55rem] border border-black/8 px-4 py-8 text-center text-sm text-muted-strong"
      >
        <div class="flex flex-col items-center justify-center gap-2">
          <span class="i-lucide-file-text h-5 w-5 text-faint"></span>
          <p>{copy.promptsEmpty}</p>
        </div>
      </section>
    {:else}
      <section
        class="theme-soft-panel grid gap-2 rounded-[0.55rem] border border-black/8 px-4 py-4"
        use:cascadeIn={{ selector: '[data-motion-item]' }}
      >
        <div class="flex flex-wrap items-center gap-2">
          <span class="i-lucide-file-text h-3.5 w-3.5 text-faint"></span>
          <span class="text-sm font-semibold text-carbon">{copy.prompts}</span>
          <span
            class="theme-version-pill rounded-[0.3rem] border px-1.5 py-0.5 text-[10px] text-muted-strong"
          >
            {copy.promptsCount(prompts.length)}
          </span>
          <span class="min-w-0 flex-1 truncate text-[11px] text-faint">{selectedCategoryLabel}</span
          >
        </div>

        <div class="grid gap-1.5">
          {#each prompts as prompt (prompt.id)}
            <article class="prompts-card" data-motion-item>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span class="i-lucide-file-text h-3.5 w-3.5 flex-none text-faint"></span>
                  <AppButton
                    variant="link"
                    class="min-w-0 truncate text-sm font-semibold"
                    onclick={() => void openDetail(prompt)}
                  >
                    {prompt.title}
                  </AppButton>
                </div>
                <p class="mt-0.5 truncate pl-5.5 text-xs text-muted-strong">
                  {copy.promptsUpdated(formattedDate(prompt.updatedAt))}
                </p>
                {#if prompt.categories.length}
                  <div class="mt-1.5 flex flex-wrap gap-1.5 pl-5.5">
                    {#each prompt.categories as cat (cat)}
                      <span class="prompts-tag">{cat}</span>
                    {/each}
                  </div>
                {:else}
                  <p class="mt-1 truncate pl-5.5 font-mono text-[10px] text-faint">{prompt.id}</p>
                {/if}
              </div>

              <div class="prompts-card-actions">
                <AppButton
                  variant="icon"
                  size="xs"
                  ariaLabel={copy.promptsCopyContent}
                  onclick={() => void copyContent(prompt.id)}
                >
                  <span
                    class={`${copiedId === prompt.id ? 'i-lucide-check' : 'i-lucide-copy'} h-3.5 w-3.5`}
                  ></span>
                </AppButton>
                <AppButton
                  variant="icon"
                  size="xs"
                  ariaLabel={copy.promptsEdit}
                  onclick={() => void startEdit(prompt)}
                >
                  <span class="i-lucide-pencil h-3.5 w-3.5"></span>
                </AppButton>
                <AppButton
                  variant="icon"
                  size="xs"
                  ariaLabel={copy.promptsDelete}
                  onclick={() => void deletePrompt(prompt)}
                >
                  <span class="i-lucide-trash-2 h-3.5 w-3.5"></span>
                </AppButton>
              </div>
            </article>
          {/each}
        </div>
      </section>
    {/if}
  </div>
</div>

{#if showCategoryManager}
  <AppDialog
    title={copy.promptsCategoryManager}
    maxWidthClass="max-w-3xl"
    panelClass="prompts-dialog-panel"
    onclose={closeCategoryManager}
  >
    <div class="grid gap-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="grid gap-1">
          <p class="text-sm font-semibold text-carbon">{copy.promptsCategoryManager}</p>
          <p class="text-xs leading-5 text-muted-strong">{copy.promptsAllCategories}</p>
        </div>
        <AppButton
          variant="icon"
          size="xs"
          onclick={closeCategoryManager}
          ariaLabel={copy.closeDialog}
          title={copy.closeDialog}
        >
          <span class="i-lucide-x h-4 w-4"></span>
        </AppButton>
      </div>

      <form
        class="flex flex-wrap items-center gap-2"
        onsubmit={(event) => {
          event.preventDefault()
          void addCategory()
        }}
      >
        <AppInput
          class="min-w-[220px] flex-1"
          bind:value={newCategoryName}
          placeholder={copy.promptsCategoryPlaceholder}
        />
        <AppButton
          variant="secondary"
          size="sm"
          type="submit"
          class="min-w-[120px]"
          disabled={!newCategoryName.trim()}
        >
          <span class="i-lucide-plus h-4 w-4"></span>
          <span>{copy.promptsCategoryCreate}</span>
        </AppButton>
      </form>

      {#if categories.length}
        <div class="grid max-h-[52vh] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
          {#each categories as cat (cat)}
            <div class="prompts-category-card">
              {#if renamingCategory === cat}
                <AppInput
                  class="min-w-0 flex-1"
                  bind:value={renameCategoryValue}
                  onkeydown={(event) => {
                    if (event.key === 'Enter') void doRenameCategory()
                  }}
                />
                <AppButton
                  variant="icon"
                  size="xs"
                  onclick={() => void doRenameCategory()}
                  disabled={!renameCategoryValue.trim()}
                  ariaLabel={copy.promptsSave}
                  title={copy.promptsSave}
                >
                  <span class="i-lucide-check h-4 w-4"></span>
                </AppButton>
                <AppButton
                  variant="icon"
                  size="xs"
                  onclick={() => {
                    renamingCategory = ''
                    renameCategoryValue = ''
                  }}
                  ariaLabel={copy.promptsCancel}
                  title={copy.promptsCancel}
                >
                  <span class="i-lucide-x h-4 w-4"></span>
                </AppButton>
              {:else}
                <span
                  class="theme-tag-count-pill inline-flex items-center rounded-full bg-black/[0.05] px-2.5 py-1 text-xs font-medium text-black/72"
                >
                  {cat}
                </span>
                <span class="min-w-0 flex-1 truncate text-sm font-medium text-carbon">{cat}</span>
                <AppButton
                  variant="icon"
                  size="xs"
                  onclick={() => {
                    renamingCategory = cat
                    renameCategoryValue = cat
                  }}
                  ariaLabel={copy.promptsCategoryRename}
                  title={copy.promptsCategoryRename}
                >
                  <span class="i-lucide-pencil h-4 w-4"></span>
                </AppButton>
                <AppButton
                  variant="icon"
                  size="xs"
                  onclick={() => void doRemoveCategory(cat)}
                  ariaLabel={copy.promptsCategoryRemove}
                  title={copy.promptsCategoryRemove}
                >
                  <span class="i-lucide-trash-2 h-4 w-4"></span>
                </AppButton>
              {/if}
            </div>
          {/each}
        </div>
      {:else}
        <div
          class="theme-tag-empty rounded-[0.4rem] border border-dashed border-black/10 bg-white px-4 py-8 text-center"
        >
          <p class="text-sm text-faint">{copy.promptsEmpty}</p>
        </div>
      {/if}
    </div>
  </AppDialog>
{/if}

{#if viewMode === 'detail' && viewingPrompt}
  <AppDialog title={copy.promptsTitle} panelClass="prompts-dialog-panel" onclose={backToList}>
    <div class="flex flex-col gap-4">
      <div class="grid gap-2">
        <p class="text-[11px] text-faint">
          {copy.promptsUpdated(formattedDate(viewingPrompt.updatedAt))}
        </p>
        <h2 class="text-base font-semibold tracking-[-0.01em] text-carbon">
          {viewingPrompt.title}
        </h2>
        {#if viewingPrompt.categories.length}
          <div class="flex flex-wrap gap-1.5">
            {#each viewingPrompt.categories as cat (cat)}
              <span class="prompts-tag">{cat}</span>
            {/each}
          </div>
        {/if}
      </div>

      <pre
        class="theme-code-surface max-h-[52vh] overflow-auto rounded-[0.5rem] border border-black/8 px-3 py-3 font-mono text-[13px] leading-relaxed whitespace-pre-wrap text-carbon">{viewingPrompt.content}</pre>

      <div class="flex flex-wrap justify-end gap-2 pt-1">
        <AppButton variant="secondary" size="sm" onclick={() => void startEdit(viewingPrompt)}>
          <span class="i-lucide-pencil h-3.5 w-3.5"></span>
          <span>{copy.promptsEdit}</span>
        </AppButton>
        <AppButton variant="secondary" size="sm" onclick={() => void copyContent(viewingPrompt.id)}>
          <span
            class={`${copiedId === viewingPrompt.id ? 'i-lucide-check' : 'i-lucide-copy'} h-3.5 w-3.5`}
          ></span>
          <span>{copiedId === viewingPrompt.id ? copy.promptsCopied : copy.promptsCopyContent}</span
          >
        </AppButton>
        <AppButton variant="secondary" size="sm" onclick={backToList}>
          {copy.closeDialog}
        </AppButton>
      </div>
    </div>
  </AppDialog>
{/if}

{#if viewMode === 'edit'}
  <AppDialog
    title={editingPrompt ? copy.promptsEdit : copy.promptsCreate}
    panelClass="prompts-dialog-panel"
    onclose={backToList}
  >
    <form
      class="flex flex-col gap-4"
      onsubmit={(event) => {
        event.preventDefault()
        void savePrompt()
      }}
    >
      <label class="grid gap-1.5">
        <span class="text-xs font-medium text-muted-strong">{copy.promptsTitlePlaceholder}</span>
        <AppInput placeholder={copy.promptsTitlePlaceholder} bind:value={editTitle} />
      </label>

      {#if categories.length}
        <div class="grid gap-1.5">
          <span class="text-xs font-medium text-muted-strong">{copy.promptsAllCategories}</span>
          <div class="flex flex-wrap gap-1.5">
            {#each categories as cat (cat)}
              <AppButton
                variant="filter"
                size="xs"
                selected={editCategories.includes(cat)}
                ariaPressed={editCategories.includes(cat)}
                onclick={() => toggleEditCategory(cat)}
              >
                {cat}
              </AppButton>
            {/each}
          </div>
        </div>
      {/if}

      <label class="grid gap-1.5">
        <span class="text-xs font-medium text-muted-strong">{copy.promptsContentPlaceholder}</span>
        <AppInput
          variant="code"
          multiline
          class="min-h-[260px]"
          inputClass="font-mono text-[13px] leading-relaxed"
          placeholder={copy.promptsContentPlaceholder}
          bind:value={editContent}
        />
      </label>

      <div class="flex justify-end gap-2 pt-1">
        <AppButton variant="secondary" size="sm" onclick={backToList} disabled={saving}>
          {copy.promptsCancel}
        </AppButton>
        <AppButton variant="primary" size="sm" type="submit" disabled={saving || !editTitle.trim()}>
          {#if saving}
            <span class="i-lucide-loader-circle h-3.5 w-3.5 animate-spin"></span>
          {:else}
            <span class="i-lucide-save h-3.5 w-3.5"></span>
          {/if}
          <span>{copy.promptsSave}</span>
        </AppButton>
      </div>
    </form>
  </AppDialog>
{/if}

<style>
  .prompts-filter-shell {
    background: transparent;
    scrollbar-width: none;
  }

  .prompts-filter-shell::-webkit-scrollbar {
    display: none;
  }

  .prompts-card {
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

  .prompts-card:hover,
  .prompts-card:focus-within {
    border-color: color-mix(in srgb, var(--line-strong) 78%, transparent);
    background: color-mix(in srgb, var(--surface-hover) 78%, transparent);
  }

  .prompts-card-actions {
    display: flex;
    flex: none;
    align-items: center;
    gap: 0.25rem;
    opacity: 0.58;
    transition: opacity 140ms ease;
  }

  .prompts-card:hover .prompts-card-actions,
  .prompts-card:focus-within .prompts-card-actions {
    opacity: 1;
  }

  .prompts-tag {
    border: 1px solid color-mix(in srgb, var(--color-arctic-mist) 82%, transparent);
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-carbon) 5%, transparent);
    color: var(--ink-soft-strong);
    font-size: 0.68rem;
    font-weight: 650;
    line-height: 1;
    padding: 0.25rem 0.48rem;
  }

  .prompts-category-card {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    border: 1px solid color-mix(in srgb, var(--color-arctic-mist) 82%, transparent);
    border-radius: 0.45rem;
    background: color-mix(in srgb, var(--panel-strong) 66%, var(--surface-soft));
    padding: 0.55rem 0.65rem;
  }

  :global(html[data-theme='dark']) .theme-tag-empty,
  :global(html[data-theme='dark']) .prompts-category-card {
    background: var(--panel-strong) !important;
    border-color: var(--color-arctic-mist) !important;
    color: var(--color-carbon) !important;
  }

  :global(html[data-theme='dark']) .theme-tag-count-pill {
    background: var(--surface-soft) !important;
    color: var(--ink-soft) !important;
  }

  @media (prefers-reduced-motion: reduce) {
    .prompts-card-actions {
      transition: none;
    }
  }
</style>
