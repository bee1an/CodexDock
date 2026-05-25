<script lang="ts">
  import WakeDialog from '../dialogs/WakeDialog.svelte'
  import WakeAllDialog from '../dialogs/WakeAllDialog.svelte'
  import { accountEmail, usageErrorKind, type LocalizedCopy } from '$lib/view/app-view'
  import { isValidWakeScheduleTime, normalizeWakeScheduleTimes } from '$lib/view/wake-schedule'
  import {
    defaultWakeModel,
    formatRelativeReset,
    isFreePlan,
    supportsWeeklyQuota
  } from '../../../shared/codex'

  import type {
    AccountRateLimits,
    AccountSummary,
    AccountWakeSchedule,
    AppSnapshot,
    UpdateAccountWakeScheduleInput,
    WakeAccountRateLimitsInput,
    WakeAccountRequestResult
  } from '../../../shared/codex'

  type WakeDialogStatus = 'idle' | 'running' | 'success' | 'skipped' | 'error'
  type WakeDialogTab = 'session' | 'schedule'
  type WakeAllSubmitOptions = {
    forceWake?: boolean
    selectedCount?: number
  }
  type ApplySnapshotOptions = {
    preserveUsageState?: boolean
  }

  const wakeConcurrencyLimit = 6

  export let copy: LocalizedCopy
  export let snapshot: AppSnapshot
  export let usageByAccountId: Record<string, AccountRateLimits>
  export let usageLoadingByAccountId: Record<string, boolean>
  export let usageErrorByAccountId: Record<string, string>
  export let wakingAccountId = ''
  export let wakeAllRunning = false
  export let clearUsageData: (accountId: string) => void
  export let clearUsageError: (accountId: string) => void
  export let clearUsageLoading: (accountId: string) => void
  export let setSnapshotRateLimits: (accountId: string, rateLimits: AccountRateLimits) => void
  export let applySnapshot: (snapshot: AppSnapshot, options?: ApplySnapshotOptions) => void
  export let localizeKnownError: (error: unknown, fallback: string) => string

  let wakeDialogAccount: AccountSummary | null = null
  let wakeDialogTab: WakeDialogTab = 'session'
  let wakePromptDraft = 'ping'
  let wakeModelDraft = defaultWakeModel
  let wakeDialogStatus: WakeDialogStatus = 'idle'
  let wakeDialogLogs: string[] = []
  let wakeRequestResult: WakeAccountRequestResult | null = null
  let wakeRequestError = ''
  let wakeRawResponseBody = ''
  let wakeAllDialogOpen = false
  let wakeAllPromptDraft = 'ping'
  let wakeAllModelDraft = defaultWakeModel
  let wakeAllLogs: string[] = []
  let wakeAllAwakenedLabels: string[] = []
  let wakeAllError = ''
  let wakeScheduleEnabledDraft = true
  let wakeScheduleTimesDraft: string[] = ['09:00']
  let wakeSchedulePromptDraft = 'ping'
  let wakeScheduleModelDraft = defaultWakeModel
  let wakeScheduleError = ''
  let wakeScheduleSaving = false

  async function mapWithConcurrencyLimit<T, R>(
    items: T[],
    limit: number,
    task: (item: T, index: number) => Promise<R>
  ): Promise<R[]> {
    const results: R[] = []
    let nextIndex = 0
    const workerCount = Math.min(Math.max(1, limit), items.length)

    await Promise.all(
      Array.from({ length: workerCount }, async (): Promise<void> => {
        while (nextIndex < items.length) {
          const currentIndex = nextIndex
          nextIndex += 1
          results[currentIndex] = await task(items[currentIndex] as T, currentIndex)
        }
      })
    )

    return results
  }

  const wakeTimestamp = (): string =>
    new Intl.DateTimeFormat(snapshot.settings.language === 'en' ? 'en-US' : 'zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(new Date())

  const pushWakeLog = async (message: string): Promise<void> => {
    wakeDialogLogs = [...wakeDialogLogs, `[${wakeTimestamp()}] ${message}`]
  }

  const pushWakeAllLog = (message: string): void => {
    wakeAllLogs = [...wakeAllLogs, `[${wakeTimestamp()}] ${message}`]
  }

  const pushWakeAllAwakenedLabel = (label: string): void => {
    if (wakeAllAwakenedLabels.includes(label)) {
      return
    }

    wakeAllAwakenedLabels = [...wakeAllAwakenedLabels, label]
  }

  const wakeAllTargetAccounts = (accountIds: string[]): AccountSummary[] => {
    return snapshot.accounts.filter((account) => accountIds.includes(account.id))
  }

  export function openWakeAllDialog(): void {
    if (wakeAllRunning || !snapshot.accounts.length) {
      return
    }

    wakeAllDialogOpen = true
    wakeAllError = ''
    wakeAllLogs = []
    wakeAllAwakenedLabels = []
  }

  const closeWakeAllDialog = (): void => {
    if (wakeAllRunning) {
      return
    }

    wakeAllDialogOpen = false
    wakeAllError = ''
  }

  const resetWakeDialogState = (): void => {
    wakeDialogStatus = 'idle'
    wakeDialogLogs = []
    wakeRequestResult = null
    wakeRequestError = ''
    wakeRawResponseBody = ''
  }

  const wakeResponsePreview = (body: string): string => {
    const firstLine = body
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean)

    if (!firstLine) {
      return copy.wakeQuotaResultEmpty
    }

    return firstLine.length > 160 ? `${firstLine.slice(0, 157)}...` : firstLine
  }

  const currentWakeScheduleDialog = (): AccountWakeSchedule | null =>
    wakeDialogAccount ? (snapshot.wakeSchedulesByAccountId[wakeDialogAccount.id] ?? null) : null

  const wakeDialogAccountIsFree = (): boolean =>
    Boolean(wakeDialogAccount && isFreePlan(usageByAccountId[wakeDialogAccount.id]))

  const closeWakeDialog = (): void => {
    if (wakingAccountId || wakeScheduleSaving) {
      return
    }

    wakeDialogAccount = null
    wakeDialogTab = 'session'
    resetWakeDialogState()
    wakeScheduleError = ''
  }

  const hydrateWakeScheduleDrafts = (account: AccountSummary): void => {
    const schedule = snapshot.wakeSchedulesByAccountId[account.id]
    wakeScheduleEnabledDraft = schedule?.enabled ?? true
    wakeScheduleTimesDraft = schedule?.times.length ? [...schedule.times] : ['09:00']
    wakeSchedulePromptDraft = schedule?.prompt ?? 'ping'
    wakeScheduleModelDraft = schedule?.model ?? defaultWakeModel
    wakeScheduleError = ''
  }

  export function openWakeDialog(
    account: AccountSummary,
    initialTab: WakeDialogTab = 'session'
  ): void {
    if (wakingAccountId || wakeScheduleSaving || usageLoadingByAccountId[account.id]) {
      return
    }

    wakeDialogAccount = account
    wakeDialogTab =
      initialTab === 'schedule' && isFreePlan(usageByAccountId[account.id]) ? 'session' : initialTab
    resetWakeDialogState()
    hydrateWakeScheduleDrafts(account)
    void pushWakeLog(copy.wakeQuotaLogReady(accountEmail(account, copy)))
  }

  export function handleEscape(): boolean {
    if (wakeDialogAccount && !wakingAccountId && !wakeScheduleSaving) {
      closeWakeDialog()
      return true
    }

    return false
  }

  const saveWakeSchedule = async (): Promise<void> => {
    if (!wakeDialogAccount || wakeScheduleSaving || wakingAccountId) {
      return
    }

    if (isFreePlan(usageByAccountId[wakeDialogAccount.id])) {
      wakeScheduleError = copy.wakeScheduleFreeUnsupported
      return
    }

    const times = normalizeWakeScheduleTimes(wakeScheduleTimesDraft)
    if (!times.length) {
      wakeScheduleError = copy.wakeScheduleNoTimes
      return
    }

    if (!times.every(isValidWakeScheduleTime)) {
      wakeScheduleError = copy.wakeScheduleInvalidTime
      return
    }

    wakeScheduleSaving = true
    wakeScheduleError = ''

    const input: UpdateAccountWakeScheduleInput = {
      enabled: wakeScheduleEnabledDraft,
      times,
      prompt: wakeSchedulePromptDraft.trim() || 'ping',
      model: wakeScheduleModelDraft.trim() || defaultWakeModel
    }

    try {
      applySnapshot(await window.codexApp.updateAccountWakeSchedule(wakeDialogAccount.id, input))
      wakeScheduleError = ''
    } catch (error) {
      wakeScheduleError = localizeKnownError(error, copy.actionFailed)
    } finally {
      wakeScheduleSaving = false
    }
  }

  const deleteWakeSchedule = async (): Promise<void> => {
    if (!wakeDialogAccount || wakeScheduleSaving || wakingAccountId) {
      return
    }

    wakeScheduleSaving = true
    wakeScheduleError = ''

    try {
      applySnapshot(await window.codexApp.deleteAccountWakeSchedule(wakeDialogAccount.id))
      hydrateWakeScheduleDrafts(wakeDialogAccount)
    } catch (error) {
      wakeScheduleError = localizeKnownError(error, copy.actionFailed)
    } finally {
      wakeScheduleSaving = false
    }
  }

  const wakeRateLimitReset = async (
    account: AccountSummary,
    input?: WakeAccountRateLimitsInput
  ): Promise<WakeAccountRequestResult | null> => {
    if (wakingAccountId || usageLoadingByAccountId[account.id]) {
      return null
    }

    wakingAccountId = account.id
    usageLoadingByAccountId = {
      ...usageLoadingByAccountId,
      [account.id]: true
    }
    clearUsageError(account.id)

    try {
      const result = await window.codexApp.wakeAccountRateLimits(account.id, input)
      usageByAccountId = {
        ...usageByAccountId,
        [account.id]: result.rateLimits
      }
      setSnapshotRateLimits(account.id, result.rateLimits)
      return result.requestResult
    } catch (error) {
      if (usageErrorKind(error instanceof Error ? error.message : undefined) === 'expired') {
        clearUsageData(account.id)
      }

      usageErrorByAccountId = {
        ...usageErrorByAccountId,
        [account.id]: localizeKnownError(error, copy.readRateLimitFailed)
      }
      throw error
    } finally {
      clearUsageLoading(account.id)
      if (wakingAccountId === account.id) {
        wakingAccountId = ''
      }
    }
  }

  const wakeRateLimitResetConcurrent = async (
    account: AccountSummary,
    input?: WakeAccountRateLimitsInput
  ): Promise<WakeAccountRequestResult | null> => {
    if (usageLoadingByAccountId[account.id]) {
      return null
    }

    usageLoadingByAccountId = {
      ...usageLoadingByAccountId,
      [account.id]: true
    }
    clearUsageError(account.id)

    try {
      const result = await window.codexApp.wakeAccountRateLimits(account.id, input)
      usageByAccountId = {
        ...usageByAccountId,
        [account.id]: result.rateLimits
      }
      setSnapshotRateLimits(account.id, result.rateLimits)
      return result.requestResult
    } catch (error) {
      if (usageErrorKind(error instanceof Error ? error.message : undefined) === 'expired') {
        clearUsageData(account.id)
      }

      usageErrorByAccountId = {
        ...usageErrorByAccountId,
        [account.id]: localizeKnownError(error, copy.readRateLimitFailed)
      }
      throw error
    } finally {
      clearUsageLoading(account.id)
    }
  }

  const submitWakeDialog = async (): Promise<void> => {
    if (!wakeDialogAccount) {
      return
    }

    resetWakeDialogState()
    wakeDialogStatus = 'running'
    await pushWakeLog(copy.wakeQuotaLogStart(wakeModelDraft || defaultWakeModel))
    await pushWakeLog(copy.wakeQuotaLogPrompt(wakePromptDraft || 'ping'))
    await pushWakeLog(copy.wakeQuotaLogRequesting)

    try {
      wakeRequestResult = await wakeRateLimitReset(wakeDialogAccount, {
        prompt: wakePromptDraft,
        model: wakeModelDraft
      })
      wakeRawResponseBody = wakeRequestResult?.body ?? ''

      if (!wakeRequestResult) {
        wakeDialogStatus = 'skipped'
        await pushWakeLog(copy.wakeQuotaLogSkipped)
        return
      }

      await pushWakeLog(copy.wakeQuotaLogAccepted(wakeRequestResult.status))
      await pushWakeLog(copy.wakeQuotaLogResponse(wakeResponsePreview(wakeRequestResult.body)))
      await pushWakeLog(copy.wakeQuotaLogRefreshingUsage)

      const nextRateLimits = usageByAccountId[wakeDialogAccount.id]
      if (nextRateLimits?.primary?.resetsAt != null) {
        await pushWakeLog(
          copy.wakeQuotaLogSessionReset(
            formatRelativeReset(nextRateLimits.primary.resetsAt, snapshot.settings.language)
          )
        )
      }
      if (supportsWeeklyQuota(nextRateLimits) && nextRateLimits?.secondary?.resetsAt != null) {
        await pushWakeLog(
          copy.wakeQuotaLogWeeklyReset(
            formatRelativeReset(nextRateLimits.secondary.resetsAt, snapshot.settings.language)
          )
        )
      }

      wakeDialogStatus = 'success'
      await pushWakeLog(copy.wakeQuotaLogCompleted)
    } catch (error) {
      wakeRequestError = localizeKnownError(error, copy.readRateLimitFailed)
      wakeDialogStatus = 'error'
      await pushWakeLog(copy.wakeQuotaLogFailed(wakeRequestError))
    }
  }

  const submitAutoWakeDialog = async (): Promise<void> => {
    if (!wakeDialogAccount || wakingAccountId) {
      return
    }

    const account = wakeDialogAccount
    resetWakeDialogState()
    wakeDialogStatus = 'running'
    wakingAccountId = account.id
    await pushWakeLog(copy.wakeQuotaLogRequesting)

    try {
      const result = await window.codexApp.autoWakeAccountRateLimits(account.id)
      const entry = result.results.find((item) => item.accountId === account.id)
      if (!entry) {
        wakeDialogStatus = 'skipped'
        await pushWakeLog(copy.wakeQuotaLogSkipped)
        return
      }

      await pushWakeLog(copy.wakeQuotaLogAutoDecision(entry.message))
      wakeRequestResult = entry.requestResult ?? null
      wakeRawResponseBody = entry.requestResult?.body ?? ''
      wakeDialogStatus = entry.status === 'success' ? 'success' : entry.status
      if (entry.status === 'success') {
        await pushWakeLog(copy.wakeQuotaLogCompleted)
      }
      applySnapshot(await window.codexApp.getSnapshot(), { preserveUsageState: true })
    } catch (error) {
      wakeRequestError = localizeKnownError(error, copy.readRateLimitFailed)
      wakeDialogStatus = 'error'
      await pushWakeLog(copy.wakeQuotaLogFailed(wakeRequestError))
    } finally {
      if (wakingAccountId === account.id) {
        wakingAccountId = ''
      }
    }
  }

  const submitWakeAllDialog = async (
    accountIds: string[],
    options: WakeAllSubmitOptions = {}
  ): Promise<void> => {
    if (wakeAllRunning || !snapshot.accounts.length) {
      return
    }

    const forceWake = Boolean(options.forceWake)
    const accounts = wakeAllTargetAccounts(accountIds)
    if (!accounts.length) {
      wakeAllError =
        forceWake || !options.selectedCount ? copy.wakeAllNoTarget : copy.wakeAllNoSmartTarget
      return
    }

    wakeAllRunning = true
    wakeAllError = ''
    wakeAllLogs = []
    wakeAllAwakenedLabels = []
    pushWakeAllLog(
      forceWake ? copy.wakeAllLogStart(accounts.length) : copy.wakeAllLogSmartStart(accounts.length)
    )
    pushWakeAllLog(copy.wakeQuotaLogStart(wakeAllModelDraft || defaultWakeModel))
    pushWakeAllLog(copy.wakeQuotaLogPrompt(wakeAllPromptDraft || 'ping'))

    try {
      const outcomes = await mapWithConcurrencyLimit(
        accounts,
        wakeConcurrencyLimit,
        async (account) => {
          const label = accountEmail(account, copy)
          pushWakeAllLog(copy.wakeAllLogAccountStart(label))
          try {
            const requestResult = await wakeRateLimitResetConcurrent(account, {
              prompt: wakeAllPromptDraft,
              model: wakeAllModelDraft,
              source: forceWake ? 'manual' : 'auto'
            })

            if (requestResult) {
              pushWakeAllAwakenedLabel(label)
              pushWakeAllLog(copy.wakeAllLogAccountSuccess(label, requestResult.status))
              return 'success'
            }

            pushWakeAllLog(copy.wakeAllLogAccountSkipped(label))
            return 'skipped'
          } catch (error) {
            pushWakeAllLog(
              copy.wakeAllLogAccountFailed(
                label,
                localizeKnownError(error, copy.readRateLimitFailed)
              )
            )
            return 'failed'
          }
        }
      )

      const succeeded = outcomes.filter((outcome) => outcome === 'success').length
      const skipped = outcomes.filter((outcome) => outcome === 'skipped').length
      const failed = outcomes.filter((outcome) => outcome === 'failed').length

      applySnapshot(await window.codexApp.getSnapshot(), { preserveUsageState: true })
      pushWakeAllLog(copy.wakeAllLogSummary(succeeded, skipped, failed))
    } catch (error) {
      wakeAllError = localizeKnownError(error, copy.actionFailed)
    } finally {
      wakeAllRunning = false
    }
  }
</script>

{#if wakeDialogAccount}
  <WakeDialog
    {copy}
    language={snapshot.settings.language}
    accountLabelText={accountEmail(wakeDialogAccount, copy)}
    bind:activeTab={wakeDialogTab}
    bind:sessionPrompt={wakePromptDraft}
    bind:sessionModel={wakeModelDraft}
    sessionStatus={wakeDialogStatus}
    sessionLogs={wakeDialogLogs}
    requestResult={wakeRequestResult}
    requestError={wakeRequestError}
    rawResponseBody={wakeRawResponseBody}
    sessionBusy={Boolean(wakingAccountId)}
    schedule={currentWakeScheduleDialog()}
    scheduleDisabled={wakeDialogAccountIsFree()}
    scheduleDisabledReason={copy.wakeScheduleFreeUnsupported}
    bind:scheduleEnabled={wakeScheduleEnabledDraft}
    bind:scheduleTimes={wakeScheduleTimesDraft}
    bind:schedulePrompt={wakeSchedulePromptDraft}
    bind:scheduleModel={wakeScheduleModelDraft}
    scheduleError={wakeScheduleError}
    scheduleSaving={wakeScheduleSaving}
    onClose={closeWakeDialog}
    onSubmitSession={submitWakeDialog}
    onSubmitAuto={submitAutoWakeDialog}
    onSaveSchedule={saveWakeSchedule}
    onDeleteSchedule={deleteWakeSchedule}
  />
{/if}

{#if wakeAllDialogOpen}
  <WakeAllDialog
    {copy}
    accounts={snapshot.accounts}
    groups={snapshot.groups}
    settings={snapshot.settings}
    rateLimitsByAccountId={usageByAccountId}
    wakeStateByAccountId={snapshot.wakeStateByAccountId ?? {}}
    accountHealthByAccountId={snapshot.accountHealthByAccountId}
    bind:prompt={wakeAllPromptDraft}
    bind:model={wakeAllModelDraft}
    logs={wakeAllLogs}
    awakenedLabels={wakeAllAwakenedLabels}
    error={wakeAllError}
    running={wakeAllRunning}
    onClose={closeWakeAllDialog}
    onSubmitAll={submitWakeAllDialog}
  />
{/if}
