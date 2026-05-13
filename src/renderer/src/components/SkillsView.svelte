<script lang="ts">
  import { onMount } from 'svelte'

  import type {
    CodexInstanceSummary,
    CodexSkillDetail,
    CodexSkillSummary,
    CodexSkillsResult,
    CopyCodexSkillInput,
    CopyCodexSkillResult
  } from '../../../shared/codex'
  import type { LocalizedCopy } from './app-view'
  import AppButton from './AppButton.svelte'
  import AppButtonGroup from './AppButtonGroup.svelte'
  import AppDialog from './AppDialog.svelte'
  import AppInput from './AppInput.svelte'
  import { cascadeIn, reveal } from './gsap-motion'

  export let copy: LocalizedCopy
  export let instances: CodexInstanceSummary[] = []
  export let listCodexSkills: () => Promise<CodexSkillsResult>
  export let readCodexSkillDetail: (
    instanceId: string,
    skillDirName: string
  ) => Promise<CodexSkillDetail>
  export let copyCodexSkill: (input: CopyCodexSkillInput) => Promise<CopyCodexSkillResult>

  let skills: CodexSkillSummary[] = []
  let errorsByInstanceId: Record<string, string> = {}
  let scannedAt = ''
  let loading = false
  let error = ''
  let selectedInstanceId = 'all'
  let searchQuery = ''

  // Detail dialog
  let detailSkill: CodexSkillDetail | null = null
  let detailLoading = false
  let detailError = ''
  let detailOpen = false

  // Copy dialog
  let copySourceSkills: CodexSkillSummary[] = []
  let copyOpen = false
  let copyTargetIds: string[] = []
  let copyBusy = false
  let copyResult: CopyCodexSkillResult | null = null
  let copyProgress = { completed: 0, total: 0 }

  // Multi-select
  let selectedSkillKeys: string[] = []

  function skillKey(skill: CodexSkillSummary): string {
    return skill.filePath
  }

  function isSkillSelected(skill: CodexSkillSummary): boolean {
    return selectedSkillKeys.includes(skillKey(skill))
  }

  function toggleSkillSelection(skill: CodexSkillSummary): void {
    const key = skillKey(skill)
    selectedSkillKeys = selectedSkillKeys.includes(key)
      ? selectedSkillKeys.filter((item) => item !== key)
      : [...selectedSkillKeys, key]
  }

  function clearSelectedSkills(): void {
    selectedSkillKeys = []
  }

  function selectAllVisibleSkills(): void {
    selectedSkillKeys = filteredSkills.map((skill) => skillKey(skill))
  }

  $: filteredSkills = skills.filter((skill) => {
    if (selectedInstanceId !== 'all' && skill.instanceId !== selectedInstanceId) {
      return false
    }

    if (searchQuery.trim()) {
      const query = searchQuery.trim().toLowerCase()
      return (
        skill.name.toLowerCase().includes(query) || skill.description.toLowerCase().includes(query)
      )
    }

    return true
  })

  $: instanceGroups = buildInstanceGroups(filteredSkills, instances)
  $: skillCountByInstance = countSkillsByInstance(skills)

  function buildInstanceGroups(
    filtered: CodexSkillSummary[],
    allInstances: CodexInstanceSummary[]
  ): Array<{ instance: CodexInstanceSummary; skills: CodexSkillSummary[] }> {
    const byId: Record<string, CodexSkillSummary[]> = {}
    for (const skill of filtered) {
      const list = (byId[skill.instanceId] ??= [])
      list.push(skill)
    }

    const groups: Array<{ instance: CodexInstanceSummary; skills: CodexSkillSummary[] }> = []
    for (const instance of allInstances) {
      const instanceSkills = byId[instance.id]
      if (instanceSkills?.length) {
        groups.push({ instance, skills: instanceSkills })
      }
    }

    return groups
  }

  function countSkillsByInstance(items: CodexSkillSummary[]): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const skill of items) {
      counts[skill.instanceId] = (counts[skill.instanceId] ?? 0) + 1
    }

    return counts
  }

  function formatScannedAt(value: string): string {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) {
      return value
    }

    return new Intl.DateTimeFormat(undefined, {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date)
  }

  async function loadSkills(): Promise<void> {
    if (loading) {
      return
    }

    loading = true
    error = ''

    try {
      const result = await listCodexSkills()
      skills = result.skills
      errorsByInstanceId = result.errorsByInstanceId
      scannedAt = result.scannedAt
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  async function openDetail(skill: CodexSkillSummary): Promise<void> {
    detailLoading = true
    detailError = ''
    detailSkill = null
    detailOpen = true

    try {
      detailSkill = await readCodexSkillDetail(skill.instanceId, skill.skillDirName)
    } catch (err) {
      detailSkill = null
      detailError = err instanceof Error ? err.message : String(err)
    } finally {
      detailLoading = false
    }
  }

  function closeDetail(): void {
    detailOpen = false
    detailSkill = null
    detailError = ''
  }

  function openCopyDialog(skill: CodexSkillSummary): void {
    copySourceSkills = [skill]
    copyTargetIds = []
    copyResult = null
    copyProgress = { completed: 0, total: 0 }
    copyOpen = true
  }

  function openBulkCopyDialog(): void {
    const sources = filteredSkills.filter((skill) => isSkillSelected(skill))
    if (!sources.length) return
    copySourceSkills = sources
    copyTargetIds = []
    copyResult = null
    copyProgress = { completed: 0, total: 0 }
    copyOpen = true
  }

  function closeCopyDialog(): void {
    if (copyBusy) return
    copyOpen = false
    copySourceSkills = []
    copyResult = null
    copyTargetIds = []
    copyProgress = { completed: 0, total: 0 }
  }

  function toggleCopyTarget(instanceId: string): void {
    if (copyTargetIds.includes(instanceId)) {
      copyTargetIds = copyTargetIds.filter((id) => id !== instanceId)
    } else {
      copyTargetIds = [...copyTargetIds, instanceId]
    }
  }

  async function executeCopy(): Promise<void> {
    if (!copySourceSkills.length || !copyTargetIds.length || copyBusy) {
      return
    }

    copyBusy = true
    copyProgress = { completed: 0, total: copySourceSkills.length }

    const aggregated: CopyCodexSkillResult = { copied: [], skipped: [], failed: [] }

    for (const source of copySourceSkills) {
      try {
        const partial = await copyCodexSkill({
          sourceInstanceId: source.instanceId,
          sourceSkillDirName: source.skillDirName,
          targetInstanceIds: copyTargetIds
        })
        aggregated.copied.push(...partial.copied)
        aggregated.skipped.push(...partial.skipped)
        aggregated.failed.push(...partial.failed)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        for (const targetId of copyTargetIds) {
          aggregated.failed.push({
            targetInstanceId: targetId,
            targetInstanceName: instances.find((inst) => inst.id === targetId)?.name ?? targetId,
            error: `${source.name}: ${message}`
          })
        }
      } finally {
        copyProgress = { completed: copyProgress.completed + 1, total: copySourceSkills.length }
      }
    }

    copyResult = aggregated
    copyBusy = false
    try {
      await loadSkills()
    } catch {
      /* loadSkills 内部已记录 error，忽略 */
    }

    if (!aggregated.failed.length) {
      selectedSkillKeys = []
    }
  }

  $: sourceInstanceIdSet = new Set(copySourceSkills.map((skill) => skill.instanceId))
  $: availableCopyTargets =
    copySourceSkills.length > 0 ? instances.filter((inst) => !sourceInstanceIdSet.has(inst.id)) : []
  $: selectedSkillCount = selectedSkillKeys.length
  $: bulkBarVisible = selectedSkillCount > 0
  $: allVisibleSelected = filteredSkills.length > 0 && selectedSkillCount >= filteredSkills.length

  onMount(() => {
    void loadSkills()
  })
</script>

<div
  class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4"
  use:reveal={{ delay: 0.02 }}
>
  <!-- Header -->
  <section class="theme-soft-panel grid gap-3 rounded-[0.55rem] border border-[var(--card-border)] px-4 py-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="grid gap-1">
        <p class="text-sm font-semibold tracking-[-0.01em] text-carbon">{copy.skillsTitle}</p>
        <p class="max-w-3xl text-xs leading-5 text-muted-strong">
          {copy.skillsDescription}
        </p>
        {#if scannedAt}
          <p class="text-[11px] text-faint">{copy.sessionsScannedAt(formatScannedAt(scannedAt))}</p>
        {/if}
      </div>
      <AppButton variant="toolbar" size="sm" onclick={() => void loadSkills()} disabled={loading}>
        <span
          class={`${loading ? 'i-lucide-loader-circle animate-spin' : 'i-lucide-refresh-cw'} h-3.5 w-3.5`}
        ></span>
        <span>{loading ? copy.refreshing : copy.skillsRefresh}</span>
      </AppButton>
    </div>

    <div class="flex min-h-8 flex-wrap items-center gap-2 pt-1">
      <AppButtonGroup
        class="skills-filter-shell inline-flex min-w-0 max-w-full items-center gap-0 overflow-x-auto rounded-[0.4rem] p-0.5"
      >
        <AppButton
          variant="filter"
          size="sm"
          selected={selectedInstanceId === 'all'}
          ariaPressed={selectedInstanceId === 'all'}
          onclick={() => {
            selectedInstanceId = 'all'
          }}
        >
          {copy.skillsAllInstances}
        </AppButton>
        {#each instances as instance (instance.id)}
          {@const instanceSkillCount = skillCountByInstance[instance.id] ?? 0}
          {#if instanceSkillCount > 0 || instance.isDefault}
            <AppButton
              variant="filter"
              size="sm"
              selected={selectedInstanceId === instance.id}
              ariaPressed={selectedInstanceId === instance.id}
              onclick={() => {
                selectedInstanceId = instance.id
              }}
            >
              <span class="max-w-[8rem] truncate">{instance.name || copy.defaultInstance}</span>
              {#if instanceSkillCount > 0}
                <span class="skills-tab-count">{instanceSkillCount}</span>
              {/if}
            </AppButton>
          {/if}
        {/each}
      </AppButtonGroup>

      <div class="flex-1"></div>

      <AppInput
        variant="search"
        size="sm"
        icon="i-lucide-search"
        class="w-44"
        placeholder={copy.skillsSearchPlaceholder}
        bind:value={searchQuery}
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

  {#if bulkBarVisible}
    <section
      class="theme-bulk-bar flex flex-wrap items-center justify-between gap-2 rounded-[0.55rem] border border-[var(--pill-border)] bg-[var(--pill-bg)] px-3 py-2"
    >
      <div class="flex items-center gap-2 text-[12px] text-muted-strong">
        <span class="font-semibold text-carbon">{copy.skillsBulkSelected(selectedSkillCount)}</span>
        {#if !allVisibleSelected && filteredSkills.length > selectedSkillCount}
          <AppButton variant="toolbar" size="xs" onclick={selectAllVisibleSkills}>
            {copy.skillsBulkSelectAllVisible}
          </AppButton>
        {/if}
      </div>
      <div class="flex items-center gap-2">
        <AppButton variant="toolbar" size="xs" onclick={clearSelectedSkills}>
          {copy.skillsBulkClear}
        </AppButton>
        <AppButton variant="primary" size="sm" onclick={openBulkCopyDialog}>
          <span class="i-lucide-copy h-3.5 w-3.5"></span>
          <span>{copy.skillsBulkCopyAction(selectedSkillCount)}</span>
        </AppButton>
      </div>
    </section>
  {/if}

  <!-- Content -->
  <div class="grid gap-3">
    {#if loading && !skills.length}
      <section
        class="theme-soft-panel rounded-[0.55rem] border border-[var(--card-border)] px-4 py-8 text-center text-sm text-muted-strong"
      >
        <div class="flex flex-col items-center justify-center gap-2">
          <span class="i-lucide-loader-circle h-5 w-5 animate-spin text-faint"></span>
          <span>{copy.refreshing}</span>
        </div>
      </section>
    {:else if filteredSkills.length === 0}
      <section
        class="theme-soft-panel rounded-[0.55rem] border border-[var(--card-border)] px-4 py-8 text-center text-sm text-muted-strong"
      >
        <div class="flex flex-col items-center justify-center gap-2">
          <span class="i-lucide-puzzle h-5 w-5 text-faint"></span>
          <p>
            {searchQuery.trim()
              ? copy.skillsEmpty
              : selectedInstanceId === 'all'
                ? copy.skillsEmpty
                : copy.skillsInstanceEmpty}
          </p>
        </div>
      </section>
    {:else}
      {#each instanceGroups as group (group.instance.id)}
        <section
          class="theme-soft-panel grid gap-2 rounded-[0.55rem] border border-[var(--card-border)] px-4 py-4"
          use:cascadeIn={{ selector: '[data-motion-item]' }}
        >
          <div class="flex flex-wrap items-center gap-2">
            <span class="i-lucide-box h-3.5 w-3.5 text-faint"></span>
            <span class="text-sm font-semibold text-carbon">
              {group.instance.name || copy.defaultInstance}
            </span>
            <span
              class="theme-version-pill rounded-[0.3rem] border px-1.5 py-0.5 text-[10px] text-muted-strong"
            >
              {copy.skillsCount(group.skills.length)}
            </span>
            <span class="min-w-0 flex-1 truncate text-[11px] text-faint"
              >{group.instance.codexHome}</span
            >
            {#if errorsByInstanceId[group.instance.id]}
              <span
                class="rounded-[0.35rem] border border-danger/18 bg-danger/8 px-2 py-1 text-[11px] text-danger"
                title={errorsByInstanceId[group.instance.id]}
              >
                {copy.skillsReadFailed}
              </span>
            {/if}
          </div>

          <div class="grid gap-1.5">
            {#each group.skills as skill (skill.filePath)}
              <article
                class={`skills-card ${isSkillSelected(skill) ? 'is-selected' : ''}`}
                data-motion-item
              >
                <label
                  class="skills-card-checkbox"
                  title={copy.skillsBulkToggleSelect}
                  aria-label={copy.skillsBulkToggleSelect}
                >
                  <input
                    type="checkbox"
                    checked={isSkillSelected(skill)}
                    onchange={() => toggleSkillSelection(skill)}
                  />
                </label>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <span class="i-lucide-puzzle h-3.5 w-3.5 flex-none text-faint"></span>
                    <AppButton
                      variant="link"
                      class="min-w-0 truncate text-sm font-semibold"
                      onclick={() => void openDetail(skill)}
                    >
                      {skill.name}
                    </AppButton>
                  </div>
                  {#if skill.description}
                    <p class="skills-card-description mt-0.5 truncate pl-5.5 text-xs">
                      {skill.description}
                    </p>
                  {/if}
                  <p class="mt-1 truncate pl-5.5 font-mono text-[10px] text-faint">
                    {skill.skillDirName}
                  </p>
                </div>

                <div class="skills-card-actions">
                  <AppButton
                    variant="icon"
                    size="xs"
                    ariaLabel={copy.skillsDetail}
                    onclick={() => void openDetail(skill)}
                  >
                    <span class="i-lucide-eye h-3.5 w-3.5"></span>
                  </AppButton>
                  <AppButton
                    variant="icon"
                    size="xs"
                    ariaLabel={copy.skillsCopyToInstance}
                    onclick={() => openCopyDialog(skill)}
                  >
                    <span class="i-lucide-copy h-3.5 w-3.5"></span>
                  </AppButton>
                </div>
              </article>
            {/each}
          </div>
        </section>
      {/each}
    {/if}
  </div>
</div>

<!-- Detail Dialog -->
{#if detailOpen}
  <AppDialog title={copy.skillsDetail} panelClass="skills-dialog-panel" onclose={closeDetail}>
    {#if detailLoading}
      <div class="flex items-center gap-2 py-4 text-sm text-muted-strong">
        <span class="i-lucide-loader-circle h-4 w-4 animate-spin"></span>
        <span>{copy.skillsDetailLoading}</span>
      </div>
    {:else if detailError}
      <div
        class="theme-error-panel rounded-[0.45rem] border border-danger/18 bg-danger/8 px-3 py-2 text-sm text-danger"
      >
        {detailError}
      </div>
    {:else if detailSkill}
      <div class="flex flex-col gap-4">
        <dl class="skills-detail-meta">
          <div class="skills-detail-meta-item">
            <dt>{copy.skillsInstance}</dt>
            <dd>{detailSkill.instanceName || copy.defaultInstance}</dd>
          </div>
          <div class="skills-detail-meta-item">
            <dt>{copy.skillsName}</dt>
            <dd>{detailSkill.name}</dd>
          </div>
          <div class="skills-detail-meta-item">
            <dt>{copy.skillsDescription2}</dt>
            <dd>{detailSkill.description || '--'}</dd>
          </div>
          <div class="skills-detail-meta-item">
            <dt>{copy.skillsPath}</dt>
            <dd class="break-all">{detailSkill.filePath}</dd>
          </div>
        </dl>

        <div class="flex flex-col gap-1.5">
          <span class="text-xs font-medium text-muted-strong">SKILL.md</span>
          <pre
            class="theme-code-surface max-h-80 overflow-auto rounded-[0.5rem] border border-[var(--card-border)] px-3 py-3 font-mono text-[13px] leading-relaxed whitespace-pre-wrap text-carbon">{detailSkill.content}</pre>
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <AppButton
            variant="secondary"
            size="sm"
            onclick={() => {
              const skill = detailSkill
              closeDetail()
              if (skill) {
                openCopyDialog(skill)
              }
            }}
          >
            <span class="i-lucide-copy-plus h-3.5 w-3.5"></span>
            <span>{copy.skillsCopyToInstance}</span>
          </AppButton>
          <AppButton variant="secondary" size="sm" onclick={closeDetail}>
            {copy.closeDialog}
          </AppButton>
        </div>
      </div>
    {/if}
  </AppDialog>
{/if}

<!-- Copy Dialog -->
{#if copyOpen && copySourceSkills.length > 0}
  <AppDialog
    title={copy.skillsCopyDialogTitle}
    panelClass="skills-dialog-panel"
    onclose={closeCopyDialog}
  >
    <div class="flex flex-col gap-4">
      <p class="text-xs leading-5 text-muted-strong">
        {copySourceSkills.length === 1
          ? copy.skillsCopyDialogDescription(copySourceSkills[0].name)
          : copy.skillsBulkCopyDialogDescription(copySourceSkills.length)}
      </p>

      <div class="skills-copy-meta-panel grid gap-3 rounded-[0.8rem] border px-3.5 py-3.5">
        <div class="flex items-center gap-2 text-xs font-medium text-muted-strong">
          <span class="i-lucide-file-clock h-3.5 w-3.5 text-faint"></span>
          <span>{copy.skillsCopySourceInstance}</span>
        </div>

        <div class="skills-copy-source-list flex max-h-32 flex-col gap-1 overflow-y-auto pr-1">
          {#each copySourceSkills as source (source.filePath)}
            <div class="skills-copy-source-item" title={source.filePath}>
              <span class="i-lucide-puzzle h-3.5 w-3.5 flex-none text-faint"></span>
              <span class="min-w-0 truncate text-[12px] font-medium text-carbon">
                {source.name}
              </span>
              <span class="min-w-0 truncate text-[11px] text-faint">
                {source.instanceName || copy.defaultInstance}
              </span>
            </div>
          {/each}
        </div>
      </div>

      <div class="skills-copy-target-panel grid gap-4 rounded-[0.9rem] border px-4 py-4">
        <div class="grid gap-2">
          <span class="flex items-center gap-1.5 text-xs font-medium text-muted-strong">
            <span class="i-lucide-box h-3.5 w-3.5 text-faint"></span>
            {copy.skillsCopyTargetInstances}
          </span>
          <p class="text-[11px] text-faint">{copy.skillsCopyTargetHelp}</p>

          {#if availableCopyTargets.length === 0}
            <div
              class="skills-copy-empty-state mt-2 rounded-[0.8rem] border px-4 py-5 text-sm text-muted-strong"
            >
              <span class="i-lucide-circle-alert h-5 w-5 text-faint"></span>
              <span>{copy.skillsEmpty}</span>
            </div>
          {:else}
            <div class="mt-2 flex flex-col gap-1.5">
              {#each availableCopyTargets as target (target.id)}
                <label
                  class="skills-copy-target {copyTargetIds.includes(target.id)
                    ? 'is-selected'
                    : ''}"
                >
                  <input
                    type="checkbox"
                    checked={copyTargetIds.includes(target.id)}
                    onchange={() => toggleCopyTarget(target.id)}
                    class="accent-ink"
                  />
                  <span class="min-w-0">
                    <span class="block truncate text-sm font-semibold text-carbon">
                      {target.name || copy.defaultInstance}
                    </span>
                    <span class="block truncate text-[11px] text-faint">{target.codexHome}</span>
                  </span>
                </label>
              {/each}
            </div>
          {/if}
        </div>

        {#if copyBusy && copyProgress.total > 1}
          <div class="skills-progress" aria-live="polite">
            <span class="i-lucide-loader-circle h-3.5 w-3.5 animate-spin"></span>
            <span>{copy.skillsBulkCopyProgress(copyProgress.completed, copyProgress.total)}</span>
          </div>
        {/if}

        {#if copyResult}
          <div class="skills-result-panel">
            <span class="text-sm font-semibold text-carbon">{copy.skillsCopyResult}</span>
            {#if copyResult.copied.length > 0}
              <span class="text-success">
                {copy.skillsCopySuccess(copyResult.copied.length)}
              </span>
            {/if}
            {#if copyResult.skipped.length > 0}
              <span class="text-amber-600">
                {copy.skillsCopySkipped(copyResult.skipped.length)}
              </span>
            {/if}
            {#if copyResult.failed.length > 0}
              <span class="text-danger">
                {copy.skillsCopyFailed(copyResult.failed.length)}
              </span>
              {#each copyResult.failed as fail, failIndex (`${fail.targetInstanceId}-${failIndex}`)}
                <span class="pl-2 text-[11px] text-danger">
                  {fail.targetInstanceName}: {fail.error}
                </span>
              {/each}
            {/if}
          </div>
        {/if}

        <div class="skills-copy-actions flex justify-end gap-2 pt-1">
          <AppButton variant="secondary" size="sm" onclick={closeCopyDialog}>
            {copy.skillsCopyCancel}
          </AppButton>
          <AppButton
            variant="primary"
            size="sm"
            onclick={() => void executeCopy()}
            disabled={copyTargetIds.length === 0 || copyBusy}
          >
            {#if copyBusy}
              <span class="i-lucide-loader-circle h-3.5 w-3.5 animate-spin"></span>
            {:else}
              <span class="i-lucide-copy h-3.5 w-3.5"></span>
            {/if}
            <span>{copy.skillsCopyConfirm}</span>
          </AppButton>
        </div>
      </div>
    </div>
  </AppDialog>
{/if}

<style>
  :global(.skills-filter-shell) {
    background: transparent;
    scrollbar-width: none;
  }

  :global(.skills-filter-shell::-webkit-scrollbar) {
    display: none;
  }

  .skills-tab-count {
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-carbon) 7%, transparent);
    color: var(--ink-faint);
    font-size: 0.625rem;
    font-weight: 700;
    line-height: 1;
    padding: 0.15rem 0.35rem;
  }

  .skills-card {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
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

  .skills-card:hover,
  .skills-card:focus-within {
    border-color: color-mix(in srgb, var(--line-strong) 78%, transparent);
    background: color-mix(in srgb, var(--surface-hover) 78%, transparent);
  }

  .skills-card.is-selected {
    border-color: var(--line-strong);
    background: color-mix(in srgb, var(--color-carbon) 6%, transparent);
  }

  .skills-card-checkbox {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    margin-top: 0.18rem;
    cursor: pointer;
  }

  .skills-card-checkbox input {
    width: 0.9rem;
    height: 0.9rem;
    cursor: pointer;
    accent-color: var(--color-carbon);
  }

  .skills-copy-source-item {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.5rem;
    border: 1px solid color-mix(in srgb, var(--color-arctic-mist) 72%, transparent);
    border-radius: 0.4rem;
    background: color-mix(in srgb, var(--panel-strong) 52%, transparent);
    padding: 0.35rem 0.55rem;
  }

  .skills-progress {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--ink-soft-strong);
    font-size: 0.72rem;
  }

  .skills-card-description {
    color: var(--ink-soft-strong);
  }

  .skills-card-actions {
    display: flex;
    flex: none;
    align-items: center;
    gap: 0.25rem;
    opacity: 0.58;
    transition: opacity 140ms ease;
  }

  .skills-card:hover .skills-card-actions,
  .skills-card:focus-within .skills-card-actions {
    opacity: 1;
  }

  .skills-detail-meta {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.5rem 0.75rem;
    border: 1px solid color-mix(in srgb, var(--color-arctic-mist) 78%, transparent);
    border-radius: 0.5rem;
    background: color-mix(in srgb, var(--surface-soft) 54%, transparent);
    padding: 0.75rem;
    font-size: 0.75rem;
  }

  .skills-detail-meta-item {
    display: contents;
  }

  .skills-detail-meta dt {
    color: var(--ink-faint);
    font-weight: 650;
    white-space: nowrap;
  }

  .skills-detail-meta dd {
    min-width: 0;
    color: var(--color-carbon);
    font-weight: 600;
  }

  .skills-copy-meta-panel,
  .skills-copy-target-panel,
  .skills-copy-empty-state,
  .skills-result-panel {
    border-color: color-mix(in srgb, var(--color-arctic-mist) 82%, transparent);
    background: color-mix(in srgb, var(--surface-soft) 54%, transparent);
  }

  .skills-copy-empty-state {
    display: flex;
    align-items: center;
    gap: 0.65rem;
  }

  .skills-copy-target {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 0.65rem;
    border: 1px solid color-mix(in srgb, var(--color-arctic-mist) 82%, transparent);
    border-radius: 0.45rem;
    background: transparent;
    cursor: pointer;
    padding: 0.55rem 0.65rem;
    transition:
      background-color 140ms ease,
      border-color 140ms ease;
  }

  .skills-copy-target:hover,
  .skills-copy-target:focus-within {
    border-color: var(--line-strong);
    background: var(--surface-hover);
  }

  .skills-copy-target.is-selected {
    border-color: var(--line-strong);
    background: var(--surface-selected, color-mix(in srgb, var(--color-carbon) 5%, transparent));
  }

  .skills-result-panel {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    border: 1px solid color-mix(in srgb, var(--color-arctic-mist) 82%, transparent);
    border-radius: 0.45rem;
    padding: 0.62rem 0.75rem;
    font-size: 0.72rem;
  }

  :global(.skills-dialog-panel) {
    border-color: color-mix(in srgb, var(--line-strong) 78%, transparent) !important;
    background: var(--panel-strong) !important;
  }
</style>
