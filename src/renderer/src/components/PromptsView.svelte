<script lang="ts">
  import { onDestroy, onMount } from 'svelte'

  import {
    isBuiltInPromptCategory,
    type CreatePromptInput,
    type PromptAttachment,
    type PromptAttachmentData,
    type PromptAttachmentPayload,
    type PromptCategoryList,
    type PromptDetail,
    type PromptSearchInput,
    type PromptSummary,
    type UpdatePromptInput
  } from '../../../shared/codex'
  import AppButton from './AppButton.svelte'
  import AppButtonGroup from './AppButtonGroup.svelte'
  import AppDialog from './AppDialog.svelte'
  import AppInput from './AppInput.svelte'
  import type { LocalizedCopy } from './app-view'
  import { cascadeIn, reveal } from './gsap-motion'

  const IMAGE_CATEGORY = 'image'
  const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
  const ACCEPTED_MIME_PREFIX = 'image/'

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
  export let addPromptAttachment: (
    promptId: string,
    payload: PromptAttachmentPayload
  ) => Promise<PromptDetail>
  export let removePromptAttachment: (promptId: string, fileName: string) => Promise<PromptDetail>
  export let readPromptAttachment: (
    promptId: string,
    fileName: string
  ) => Promise<PromptAttachmentData>

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
  let editAttachments: PromptAttachment[] = []
  let attachmentPreviews: Record<string, string> = {}
  let attachmentBusy = false
  let lightbox: { url: string; name: string } | null = null
  let saving = false
  let copiedId = ''
  let deletingPromptId = ''
  let removingCategoryName = ''
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
      const detail = await getPromptDetail(prompt.id)
      viewingPrompt = detail
      viewMode = 'detail'
      void loadAttachmentPreviews(detail.id, detail.attachments)
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load prompt'
    }
  }

  function startCreate(): void {
    editingPrompt = null
    editTitle = ''
    editContent = ''
    editCategories = selectedCategory ? [selectedCategory] : []
    editAttachments = []
    clearAttachmentPreviews()
    viewMode = 'edit'
  }

  async function startEdit(prompt: PromptSummary): Promise<void> {
    try {
      const detail = await getPromptDetail(prompt.id)
      editingPrompt = detail
      editTitle = detail.title
      editContent = detail.content
      editCategories = [...detail.categories]
      editAttachments = [...detail.attachments]
      viewMode = 'edit'
      void loadAttachmentPreviews(detail.id, detail.attachments)
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
    if (deletingPromptId) return
    deletingPromptId = prompt.id
    try {
      await removePrompt(prompt.id)
      backToList()
      await refresh()
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to delete'
    } finally {
      deletingPromptId = ''
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
    if (removingCategoryName) return
    removingCategoryName = name
    try {
      const result = await removePromptCategory(name)
      categories = result.categories
      if (selectedCategory === name) selectedCategory = ''
      await refresh()
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to remove category'
    } finally {
      removingCategoryName = ''
    }
  }

  function toggleEditCategory(cat: string): void {
    editCategories = editCategories.includes(cat)
      ? editCategories.filter((c) => c !== cat)
      : [...editCategories, cat]
  }

  function clearAttachmentPreviews(): void {
    for (const url of Object.values(attachmentPreviews)) {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url)
    }
    attachmentPreviews = {}
  }

  function toDataUrl(data: PromptAttachmentData): string {
    return `data:${data.mimeType};base64,${data.dataBase64}`
  }

  async function loadAttachmentPreviews(
    promptId: string,
    attachments: PromptAttachment[]
  ): Promise<void> {
    clearAttachmentPreviews()
    const next: Record<string, string> = {}
    for (const att of attachments) {
      try {
        const data = await readPromptAttachment(promptId, att.fileName)
        next[att.fileName] = toDataUrl(data)
      } catch {
        // skip unreadable attachment
      }
    }
    attachmentPreviews = next
  }

  async function fileToBase64(file: File): Promise<string> {
    const buffer = await file.arrayBuffer()
    let binary = ''
    const bytes = new Uint8Array(buffer)
    const chunk = 0x8000
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
    }
    return btoa(binary)
  }

  async function handleImageFiles(files: FileList | File[] | null): Promise<void> {
    if (!files || !editingPrompt) return
    const list = Array.from(files)
    if (!list.length) return
    attachmentBusy = true
    try {
      for (const file of list) {
        if (!file.type.startsWith(ACCEPTED_MIME_PREFIX)) {
          error = copy.promptsImagesInvalidType(file.name)
          continue
        }
        if (file.size > MAX_ATTACHMENT_BYTES) {
          error = copy.promptsImagesTooLarge(file.name)
          continue
        }
        try {
          const dataBase64 = await fileToBase64(file)
          const detail = await addPromptAttachment(editingPrompt.id, {
            fileName: file.name,
            mimeType: file.type || undefined,
            dataBase64
          })
          editingPrompt = detail
          editAttachments = [...detail.attachments]
          const added = detail.attachments[detail.attachments.length - 1]
          if (added) {
            attachmentPreviews = {
              ...attachmentPreviews,
              [added.fileName]: `data:${added.mimeType};base64,${dataBase64}`
            }
          }
        } catch (e) {
          error = e instanceof Error ? e.message : copy.promptsImagesUploadFailed
        }
      }
    } finally {
      attachmentBusy = false
    }
  }

  async function removeAttachment(fileName: string): Promise<void> {
    if (!editingPrompt) return
    attachmentBusy = true
    try {
      const detail = await removePromptAttachment(editingPrompt.id, fileName)
      editingPrompt = detail
      editAttachments = [...detail.attachments]
      const previewUrl = attachmentPreviews[fileName]
      if (previewUrl?.startsWith('blob:')) URL.revokeObjectURL(previewUrl)
      const rest = { ...attachmentPreviews }
      delete rest[fileName]
      attachmentPreviews = rest
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to remove image'
    } finally {
      attachmentBusy = false
    }
  }

  function onImageInputChange(event: Event): void {
    const input = event.currentTarget as HTMLInputElement
    void handleImageFiles(input.files).finally(() => {
      input.value = ''
    })
  }

  function openLightbox(fileName: string): void {
    const url = attachmentPreviews[fileName]
    if (!url) return
    lightbox = { url, name: fileName }
  }

  function closeLightbox(): void {
    lightbox = null
  }

  function handleLightboxKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') closeLightbox()
  }

  function backToList(): void {
    viewMode = 'list'
    viewingPrompt = null
    editingPrompt = null
    editAttachments = []
    clearAttachmentPreviews()
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
    window.addEventListener('keydown', handleLightboxKey)
  })

  onDestroy(() => {
    clearAttachmentPreviews()
    window.removeEventListener('keydown', handleLightboxKey)
  })
</script>

<div
  class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4"
  use:reveal={{ delay: 0.02 }}
>
  <section class="theme-soft-panel grid gap-3 rounded-[0.55rem] border border-[var(--card-border)] px-4 py-4">
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
      <AppButtonGroup
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
      </AppButtonGroup>

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
        class="theme-soft-panel rounded-[0.55rem] border border-[var(--card-border)] px-4 py-8 text-center text-sm text-muted-strong"
      >
        <div class="flex flex-col items-center justify-center gap-2">
          <span class="i-lucide-loader-circle h-5 w-5 animate-spin text-faint"></span>
          <span>{copy.refreshing}</span>
        </div>
      </section>
    {:else if !prompts.length}
      <section
        class="theme-soft-panel rounded-[0.55rem] border border-[var(--card-border)] px-4 py-8 text-center text-sm text-muted-strong"
      >
        <div class="flex flex-col items-center justify-center gap-2">
          <span class="i-lucide-file-text h-5 w-5 text-faint"></span>
          <p>{copy.promptsEmpty}</p>
        </div>
      </section>
    {:else}
      <section
        class="theme-soft-panel grid gap-2 rounded-[0.55rem] border border-[var(--card-border)] px-4 py-4"
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
                  disabled={deletingPromptId === prompt.id}
                >
                  {#if deletingPromptId === prompt.id}
                    <span class="i-lucide-loader-circle h-3.5 w-3.5 animate-spin"></span>
                  {:else}
                    <span class="i-lucide-trash-2 h-3.5 w-3.5"></span>
                  {/if}
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
                  class="theme-tag-count-pill inline-flex items-center rounded-full bg-[var(--surface-soft)] px-2.5 py-1 text-xs font-medium text-[var(--ink-soft)]"
                >
                  {cat}
                </span>
                <span class="min-w-0 flex-1 truncate text-sm font-medium text-carbon">{cat}</span>
                {#if isBuiltInPromptCategory(cat)}
                  <span
                    class="text-[11px] text-faint"
                    title={copy.promptsImageBuiltInHint}
                    aria-label={copy.promptsImageBuiltInHint}
                  >
                    <span class="i-lucide-lock h-3.5 w-3.5"></span>
                  </span>
                {:else}
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
                    disabled={removingCategoryName === cat}
                    ariaLabel={copy.promptsCategoryRemove}
                    title={copy.promptsCategoryRemove}
                  >
                    {#if removingCategoryName === cat}
                      <span class="i-lucide-loader-circle h-4 w-4 animate-spin"></span>
                    {:else}
                      <span class="i-lucide-trash-2 h-4 w-4"></span>
                    {/if}
                  </AppButton>
                {/if}
              {/if}
            </div>
          {/each}
        </div>
      {:else}
        <div
          class="theme-tag-empty rounded-[0.4rem] border border-dashed border-[var(--empty-border)] bg-[var(--empty-bg)] px-4 py-8 text-center"
        >
          <p class="text-sm text-faint">{copy.promptsEmpty}</p>
        </div>
      {/if}
    </div>
  </AppDialog>
{/if}

{#if viewMode === 'detail' && viewingPrompt}
  <AppDialog
    title={copy.promptsTitle}
    maxWidthClass="max-w-4xl"
    panelClass="prompts-dialog-panel"
    onclose={backToList}
  >
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
        class="theme-code-surface max-h-[62vh] min-h-[40vh] overflow-auto rounded-[0.5rem] border border-[var(--card-border)] px-3 py-3 font-mono text-[13px] leading-relaxed whitespace-pre-wrap text-carbon">{viewingPrompt.content}</pre>

      {#if viewingPrompt.attachments.length}
        <div class="grid gap-2">
          <span class="text-xs font-medium text-muted-strong">{copy.promptsImagesLabel}</span>
          <div class="prompts-attachment-grid">
            {#each viewingPrompt.attachments as att (att.fileName)}
              <figure class="prompts-attachment-card">
                <button
                  type="button"
                  class="prompts-attachment-thumb-button"
                  onclick={() => openLightbox(att.fileName)}
                  disabled={!attachmentPreviews[att.fileName]}
                  title={att.fileName}
                  aria-label={att.fileName}
                >
                  {#if attachmentPreviews[att.fileName]}
                    <img
                      src={attachmentPreviews[att.fileName]}
                      alt={att.fileName}
                      class="prompts-attachment-thumb"
                      loading="lazy"
                    />
                  {:else}
                    <div
                      class="prompts-attachment-thumb flex items-center justify-center text-faint"
                    >
                      <span class="i-lucide-image h-6 w-6"></span>
                    </div>
                  {/if}
                </button>
                <figcaption class="prompts-attachment-caption" title={att.fileName}>
                  {att.fileName}
                </figcaption>
              </figure>
            {/each}
          </div>
        </div>
      {/if}

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
    maxWidthClass="max-w-4xl"
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
          class="min-h-[58vh]"
          inputClass="max-h-[72vh] font-mono text-[13px] leading-relaxed"
          placeholder={copy.promptsContentPlaceholder}
          bind:value={editContent}
        />
      </label>

      {#if editCategories.includes(IMAGE_CATEGORY)}
        <div class="grid gap-2">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <span class="text-xs font-medium text-muted-strong">{copy.promptsImagesLabel}</span>
            <span class="text-[11px] text-faint">{copy.promptsImagesHint}</span>
          </div>

          {#if !editingPrompt}
            <div
              class="theme-tag-empty rounded-[0.4rem] border border-dashed border-[var(--empty-border)] bg-[var(--empty-bg)] px-4 py-6 text-center"
            >
              <p class="text-sm text-faint">{copy.promptsImagesCreateFirst}</p>
            </div>
          {:else}
            <div class="flex flex-wrap items-center gap-2">
              <label class="inline-flex">
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  class="sr-only"
                  disabled={attachmentBusy}
                  onchange={onImageInputChange}
                />
                <span
                  class="inline-flex cursor-pointer items-center gap-1.5 rounded-[0.4rem] border border-[var(--empty-border)] bg-[var(--panel-strong)] px-2.5 py-1.5 text-xs font-medium text-carbon transition hover:bg-[var(--surface-hover)] aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
                  aria-disabled={attachmentBusy}
                >
                  {#if attachmentBusy}
                    <span class="i-lucide-loader-circle h-3.5 w-3.5 animate-spin"></span>
                  {:else}
                    <span class="i-lucide-image-plus h-3.5 w-3.5"></span>
                  {/if}
                  <span>{copy.promptsImagesUpload}</span>
                </span>
              </label>
            </div>

            {#if editAttachments.length}
              <div class="prompts-attachment-grid">
                {#each editAttachments as att (att.fileName)}
                  <figure class="prompts-attachment-card">
                    <button
                      type="button"
                      class="prompts-attachment-thumb-button"
                      onclick={() => openLightbox(att.fileName)}
                      disabled={!attachmentPreviews[att.fileName]}
                      title={att.fileName}
                      aria-label={att.fileName}
                    >
                      {#if attachmentPreviews[att.fileName]}
                        <img
                          src={attachmentPreviews[att.fileName]}
                          alt={att.fileName}
                          class="prompts-attachment-thumb"
                          loading="lazy"
                        />
                      {:else}
                        <div
                          class="prompts-attachment-thumb flex items-center justify-center text-faint"
                        >
                          <span class="i-lucide-image h-6 w-6"></span>
                        </div>
                      {/if}
                    </button>
                    <AppButton
                      variant="icon"
                      size="xs"
                      class="prompts-attachment-remove"
                      onclick={() => void removeAttachment(att.fileName)}
                      disabled={attachmentBusy}
                      ariaLabel={copy.promptsImagesRemove}
                      title={copy.promptsImagesRemove}
                    >
                      <span class="i-lucide-x h-4 w-4"></span>
                    </AppButton>
                    <figcaption class="prompts-attachment-caption" title={att.fileName}>
                      {att.fileName}
                    </figcaption>
                  </figure>
                {/each}
              </div>
            {:else}
              <div
                class="theme-tag-empty rounded-[0.4rem] border border-dashed border-[var(--empty-border)] bg-[var(--empty-bg)] px-4 py-6 text-center"
              >
                <p class="text-sm text-faint">{copy.promptsImagesEmpty}</p>
              </div>
            {/if}
          {/if}
        </div>
      {/if}

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

{#if lightbox}
  <AppDialog
    ariaLabel={lightbox.name}
    maxWidthClass="max-w-[min(92vw,72rem)]"
    maxHeightClass="max-h-[calc(100vh-2rem)]"
    panelClass="prompts-lightbox-panel p-2 sm:p-2"
    backdropClass="prompts-lightbox-backdrop"
    zIndexClass="z-[80]"
    closeLabel={copy.closeDialog}
    showClose
    onclose={closeLightbox}
  >
    <img src={lightbox.url} alt={lightbox.name} class="prompts-lightbox-image" />
  </AppDialog>
{/if}

<style>
  :global(.prompts-filter-shell) {
    background: transparent;
    scrollbar-width: none;
  }

  :global(.prompts-filter-shell::-webkit-scrollbar) {
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

  .prompts-attachment-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(128px, 1fr));
    gap: 0.5rem;
  }

  .prompts-attachment-card {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    border: 1px solid color-mix(in srgb, var(--color-arctic-mist) 82%, transparent);
    border-radius: 0.45rem;
    background: color-mix(in srgb, var(--panel-strong) 66%, var(--surface-soft));
    padding: 0.4rem;
  }

  .prompts-attachment-thumb {
    width: 100%;
    aspect-ratio: 1 / 1;
    border-radius: 0.35rem;
    object-fit: cover;
    background: color-mix(in srgb, var(--color-arctic-mist) 22%, white 78%);
  }

  .prompts-attachment-thumb-button {
    display: block;
    width: 100%;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: zoom-in;
    border-radius: 0.35rem;
    transition:
      transform 140ms ease,
      box-shadow 140ms ease;
  }

  .prompts-attachment-thumb-button:hover:not(:disabled),
  .prompts-attachment-thumb-button:focus-visible:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 6px 18px -8px rgba(0, 0, 0, 0.35);
  }

  .prompts-attachment-thumb-button:disabled {
    cursor: default;
  }

  :global(.prompts-lightbox-backdrop) {
    background: rgba(12, 16, 24, 0.82) !important;
    backdrop-filter: blur(6px);
  }

  :global(.prompts-lightbox-panel) {
    background: rgba(0, 0, 0, 0.24) !important;
    border-color: rgba(255, 255, 255, 0.18) !important;
    box-shadow: 0 28px 72px -20px rgba(0, 0, 0, 0.6) !important;
  }

  .prompts-lightbox-image {
    display: block;
    max-width: min(88vw, 72rem);
    max-height: calc(100vh - 7rem);
    border-radius: 0.5rem;
    cursor: default;
  }

  .prompts-attachment-caption {
    font-size: 0.68rem;
    color: var(--ink-soft-strong);
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global(.prompts-attachment-card .prompts-attachment-remove) {
    position: absolute;
    top: 0.3rem;
    right: 0.3rem;
    background: color-mix(in srgb, white 82%, transparent);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
  }


  @media (prefers-reduced-motion: reduce) {
    .prompts-card-actions {
      transition: none;
    }
  }
</style>
