import type { BatchRefreshProgressEvent } from '../../../shared/codex'

export type RowStatus = 'pending' | 'running' | 'success' | 'error'

export interface RowState {
  status: RowStatus
  durationMs?: number
  error?: string
}

export function initialBatchState(accountIds: string[]): Record<string, RowState> {
  const next: Record<string, RowState> = {}
  for (const accountId of accountIds) {
    next[accountId] = { status: 'pending' }
  }
  return next
}

export function applyProgress(
  state: Record<string, RowState>,
  event: BatchRefreshProgressEvent
): Record<string, RowState> {
  const previous = state[event.accountId]
  const next: RowState = {
    status: event.result.success ? 'success' : 'error',
    durationMs: event.durationMs,
    error: event.result.error ?? undefined
  }

  if (
    previous &&
    previous.status === next.status &&
    previous.durationMs === next.durationMs &&
    previous.error === next.error
  ) {
    return state
  }

  return {
    ...state,
    [event.accountId]: next
  }
}

export function failedAccountIds(state: Record<string, RowState>): string[] {
  return Object.entries(state)
    .filter(([, row]) => row.status === 'error')
    .map(([accountId]) => accountId)
}
