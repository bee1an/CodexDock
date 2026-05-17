<script lang="ts">
  import type {
    CodexInstanceSummary,
    CodexSkillsResult,
    CreatePromptInput,
    CreateSkillLibraryInput,
    PromptAttachmentData,
    PromptAttachmentPayload,
    PromptCategoryList,
    PromptDetail,
    PromptSearchInput,
    PromptSummary,
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
    UpdatePromptInput,
    UpdateSkillLibraryInput
  } from '../../../shared/codex'
  import type { LocalizedCopy } from './app-view'
  import AppButton from './AppButton.svelte'
  import AppButtonGroup from './AppButtonGroup.svelte'
  import PromptsView from './PromptsView.svelte'
  import SkillLibraryView from './SkillLibraryView.svelte'

  export let copy: LocalizedCopy
  export let instances: CodexInstanceSummary[] = []

  // SkillLibrary props
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

  // Prompts props
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

  let activeTab: 'skills' | 'prompts' = 'skills'
</script>

<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
  <div class="flex items-center px-4 pt-3 pb-1">
    <AppButtonGroup
      class="stash-tab-group inline-flex min-w-0 items-center gap-0 rounded-[0.4rem] p-0.5"
    >
      <AppButton
        variant="filter"
        size="sm"
        selected={activeTab === 'skills'}
        ariaPressed={activeTab === 'skills'}
        onclick={() => {
          activeTab = 'skills'
        }}
      >
        <span class="i-lucide-sparkles h-3.5 w-3.5"></span>
        <span>{copy.stashSkillsTab}</span>
      </AppButton>
      <AppButton
        variant="filter"
        size="sm"
        selected={activeTab === 'prompts'}
        ariaPressed={activeTab === 'prompts'}
        onclick={() => {
          activeTab = 'prompts'
        }}
      >
        <span class="i-lucide-file-text h-3.5 w-3.5"></span>
        <span>{copy.stashPromptsTab}</span>
      </AppButton>
    </AppButtonGroup>
  </div>

  {#if activeTab === 'skills'}
    <SkillLibraryView
      {copy}
      {instances}
      {listSkillLibrary}
      {getSkillLibraryDetail}
      {createSkillLibrary}
      {updateSkillLibrary}
      {removeSkillLibrary}
      {listSkillLibraryCategories}
      {createSkillLibraryCategory}
      {renameSkillLibraryCategory}
      {removeSkillLibraryCategory}
      {installSkillLibrary}
      {listCodexSkills}
      {importSkillLibraryDirWithDialog}
      {exportSkillLibraryDirWithDialog}
      {collectSkillLibrary}
      {readSkillLibraryFile}
    />
  {:else}
    <PromptsView
      {copy}
      {listPrompts}
      {getPromptDetail}
      {createPrompt}
      {updatePrompt}
      {removePrompt}
      {copyPromptContent}
      {listPromptCategories}
      {createPromptCategory}
      {renamePromptCategory}
      {removePromptCategory}
      {addPromptAttachment}
      {removePromptAttachment}
      {readPromptAttachment}
    />
  {/if}
</div>

<style>
  :global(.stash-tab-group) {
    background: transparent;
  }
</style>
