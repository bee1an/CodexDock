<script lang="ts">
  import { onMount } from 'svelte'

  import EditAccountTokensDialog from '../dialogs/EditAccountTokensDialog.svelte'
  import RefreshAccountTokensDialog from '../dialogs/RefreshAccountTokensDialog.svelte'
  import RefreshTokensBatchDialog from '../dialogs/RefreshTokensBatchDialog.svelte'
  import {
    applyProgress as applyRefreshBatchProgress,
    failedAccountIds as refreshBatchFailedAccountIds,
    initialBatchState as initialRefreshBatchState,
    type RowState as RefreshTokensBatchRowState
  } from '../dialogs/refresh-tokens-batch-state'
  import { accountLabel, type LocalizedCopy } from '$lib/view/app-view'

  import type {
    AccountGroup,
    AccountSummary,
    AppLanguage,
    AppSnapshot,
    BatchRefreshProgressEvent,
    BatchRefreshSummary
  } from '../../../shared/codex'

  export let copy: LocalizedCopy
  export let language: AppLanguage
  export let accounts: AccountSummary[] = []
  export let groups: AccountGroup[] = []
  export let applySnapshot: (snapshot: AppSnapshot) => void
  export let refreshTokensBatchPhase: 'idle' | 'confirming' | 'running' | 'done' = 'idle'

  let refreshTokensBatchOpen = false
  let refreshTokensBatchProgress: Record<string, RefreshTokensBatchRowState> = {}
  let refreshTokensBatchCandidateIds: string[] = []
  let refreshTokensBatchSummary: BatchRefreshSummary | null = null
  let refreshTokensBatchError = ''
  let editTokensDialogAccount: AccountSummary | null = null
  let editTokensAccessTokenDraft = ''
  let editTokensRefreshTokenDraft = ''
  let editTokensIdTokenDraft = ''
  let editTokensAccountIdHintDraft = ''
  let editTokensError = ''
  let editTokensSaving = false
  let editTokensLoading = false
  let editTokensLoadRequestId = 0
  let refreshTokensDialogAccount: AccountSummary | null = null
  let refreshTokensStatus: 'idle' | 'running' | 'success' | 'error' = 'idle'
  let refreshTokensResult: import('../../../shared/codex').AccountTokenRefreshResult | null = null
  let refreshTokensError = ''

  export function openRefreshTokensBatchDialog(): void {
    if (refreshTokensBatchPhase === 'running') return
    if (!accounts.length) return

    refreshTokensBatchOpen = true
    refreshTokensBatchPhase = 'idle'
    refreshTokensBatchProgress = {}
    refreshTokensBatchCandidateIds = []
    refreshTokensBatchSummary = null
    refreshTokensBatchError = ''
  }

  const closeRefreshTokensBatchDialog = (): void => {
    if (refreshTokensBatchPhase === 'running') return
    refreshTokensBatchOpen = false
  }

  const startRefreshTokensBatch = async (accountIds: string[]): Promise<void> => {
    const uniqueIds = Array.from(new Set(accountIds))
    if (!uniqueIds.length) return

    refreshTokensBatchError = ''
    refreshTokensBatchSummary = null
    refreshTokensBatchCandidateIds = uniqueIds
    refreshTokensBatchProgress = initialRefreshBatchState(uniqueIds)
    refreshTokensBatchPhase = 'running'

    try {
      const summary = await window.codexApp.refreshAccountTokensBatch(uniqueIds)
      refreshTokensBatchSummary = summary
      // ensure final state matches even if some progress events were missed (e.g. arrived
      // before currentBatchId was assigned).
      const finalState: Record<string, RefreshTokensBatchRowState> = {
        ...refreshTokensBatchProgress
      }
      for (const result of summary.results) {
        finalState[result.accountId] = {
          status: result.success ? 'success' : 'error',
          durationMs: finalState[result.accountId]?.durationMs,
          error: result.error ?? undefined
        }
      }
      refreshTokensBatchProgress = finalState
      refreshTokensBatchPhase = 'done'
    } catch (error) {
      refreshTokensBatchError = error instanceof Error ? error.message : String(error)
      refreshTokensBatchPhase = 'done'
    }
  }

  const handleRefreshTokensBatchSubmit = (accountIds: string[]): void => {
    void startRefreshTokensBatch(accountIds)
  }

  const handleRefreshTokensBatchRetryFailed = (): void => {
    if (!refreshTokensBatchSummary) return
    const failedIds = refreshBatchFailedAccountIds(refreshTokensBatchProgress)
    if (!failedIds.length) return
    void startRefreshTokensBatch(failedIds)
  }

  export function openEditTokensDialog(account: AccountSummary): void {
    editTokensDialogAccount = account
    editTokensAccessTokenDraft = ''
    editTokensRefreshTokenDraft = ''
    editTokensIdTokenDraft = ''
    editTokensAccountIdHintDraft = ''
    editTokensError = ''
    editTokensSaving = false
    editTokensLoading = true

    const requestId = ++editTokensLoadRequestId
    void (async () => {
      try {
        const detail = await window.codexApp.getAccountTokens(account.id)
        if (requestId !== editTokensLoadRequestId || editTokensDialogAccount?.id !== account.id) {
          return
        }
        editTokensAccessTokenDraft = detail.accessToken ?? ''
        editTokensRefreshTokenDraft = detail.refreshToken ?? ''
        editTokensIdTokenDraft = detail.idToken ?? ''
        editTokensAccountIdHintDraft = detail.accountId ?? ''
      } catch (error) {
        if (requestId !== editTokensLoadRequestId || editTokensDialogAccount?.id !== account.id) {
          return
        }
        editTokensError = copy.editAccountTokensLoadFailed(
          error instanceof Error ? error.message : String(error)
        )
      } finally {
        if (requestId === editTokensLoadRequestId) {
          editTokensLoading = false
        }
      }
    })()
  }

  const closeEditTokensDialog = (): void => {
    if (editTokensSaving) {
      return
    }
    editTokensLoadRequestId += 1
    editTokensDialogAccount = null
    editTokensLoading = false
    editTokensError = ''
  }

  const saveAccountTokens = async (): Promise<void> => {
    const target = editTokensDialogAccount
    if (!target || editTokensSaving || editTokensLoading) {
      return
    }

    const access = editTokensAccessTokenDraft.trim()
    const refresh = editTokensRefreshTokenDraft.trim()
    const idToken = editTokensIdTokenDraft.trim()
    const accountIdHint = editTokensAccountIdHintDraft.trim()

    if (!access && !refresh && !idToken && !accountIdHint) {
      editTokensError = copy.editAccountTokensEmptyError
      return
    }

    editTokensSaving = true
    editTokensError = ''

    try {
      const nextSnapshot = await window.codexApp.updateAccountTokens(target.id, {
        accessToken: access || undefined,
        refreshToken: refresh || undefined,
        idToken: idToken || undefined,
        accountId: accountIdHint || undefined
      })
      applySnapshot(nextSnapshot)
      editTokensDialogAccount = null
    } catch (error) {
      editTokensError = copy.editAccountTokensFailed(
        error instanceof Error ? error.message : String(error)
      )
    } finally {
      editTokensSaving = false
    }
  }

  export function openRefreshTokensDialog(account: AccountSummary): void {
    refreshTokensDialogAccount = account
    refreshTokensStatus = 'idle'
    refreshTokensResult = null
    refreshTokensError = ''
  }

  const closeRefreshTokensDialog = (): void => {
    if (refreshTokensStatus === 'running') {
      return
    }
    refreshTokensDialogAccount = null
    refreshTokensStatus = 'idle'
    refreshTokensResult = null
    refreshTokensError = ''
  }

  const submitRefreshTokens = async (): Promise<void> => {
    if (!refreshTokensDialogAccount || refreshTokensStatus === 'running') {
      return
    }

    refreshTokensStatus = 'running'
    refreshTokensError = ''
    refreshTokensResult = null

    try {
      const result = await window.codexApp.refreshAccountTokens(refreshTokensDialogAccount.id)
      refreshTokensResult = result
      refreshTokensStatus = result.success ? 'success' : 'error'
      refreshTokensError = result.error ?? ''
      if (result.success) {
        applySnapshot(await window.codexApp.getSnapshot())
      }
    } catch (error) {
      refreshTokensStatus = 'error'
      refreshTokensError = error instanceof Error ? error.message : String(error)
    }
  }

  onMount(() => {
    const disposeRefreshTokensBatchProgress = window.codexApp.onRefreshAccountTokensBatchProgress(
      (event: BatchRefreshProgressEvent) => {
        // Only apply progress while a batch is actively running. We do not filter by batchId
        // because progress events arrive before the IPC `invoke` promise resolves with the
        // summary that carries the batchId; the UI guarantees only one batch runs at a time.
        if (refreshTokensBatchPhase !== 'running') return
        refreshTokensBatchProgress = applyRefreshBatchProgress(refreshTokensBatchProgress, event)
      }
    )

    return () => {
      disposeRefreshTokensBatchProgress()
    }
  })
</script>

{#if refreshTokensBatchOpen}
  <RefreshTokensBatchDialog
    {copy}
    {language}
    {accounts}
    {groups}
    bind:phase={refreshTokensBatchPhase}
    progressByAccountId={refreshTokensBatchProgress}
    candidateAccountIds={refreshTokensBatchCandidateIds}
    summary={refreshTokensBatchSummary}
    error={refreshTokensBatchError}
    onClose={closeRefreshTokensBatchDialog}
    onSubmit={handleRefreshTokensBatchSubmit}
    onRetryFailed={handleRefreshTokensBatchRetryFailed}
  />
{/if}

{#if editTokensDialogAccount}
  <EditAccountTokensDialog
    {copy}
    accountLabelText={accountLabel(editTokensDialogAccount, copy)}
    bind:accessToken={editTokensAccessTokenDraft}
    bind:refreshToken={editTokensRefreshTokenDraft}
    bind:idToken={editTokensIdTokenDraft}
    bind:accountIdHint={editTokensAccountIdHintDraft}
    errorMessage={editTokensError}
    loading={editTokensLoading}
    saving={editTokensSaving}
    onClose={closeEditTokensDialog}
    onSave={saveAccountTokens}
  />
{/if}

{#if refreshTokensDialogAccount}
  <RefreshAccountTokensDialog
    {copy}
    accountLabelText={accountLabel(refreshTokensDialogAccount, copy)}
    status={refreshTokensStatus}
    result={refreshTokensResult}
    errorMessage={refreshTokensError}
    busy={refreshTokensStatus === 'running'}
    onClose={closeRefreshTokensDialog}
    onSubmit={submitRefreshTokens}
  />
{/if}
