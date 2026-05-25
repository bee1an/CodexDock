import { describe, expect, it } from 'vitest'
import type { BatchRefreshProgressEvent, AccountTokenRefreshResult } from '../../../../shared/codex'

import { applyProgress, failedAccountIds, initialBatchState } from '../refresh-tokens-batch-state'

const baseResult: AccountTokenRefreshResult = {
  success: true,
  accountId: 'acct-a',
  accountLabel: 'Account A',
  before: {
    accessTokenExpiresAt: null,
    refreshTokenExpiresAt: null,
    idTokenExpiresAt: null
  },
  after: null,
  sanitizedLogs: [],
  rawLogs: [],
  error: null
}

function makeEvent(overrides: Partial<BatchRefreshProgressEvent> = {}): BatchRefreshProgressEvent {
  return {
    batchId: 'batch-1',
    accountId: 'acct-a',
    result: baseResult,
    doneCount: 1,
    total: 1,
    durationMs: 120,
    ...overrides
  }
}

describe('refresh-tokens-batch-state', () => {
  it('initializes every requested account as pending', () => {
    const state = initialBatchState(['a', 'b', 'c'])
    expect(state).toEqual({
      a: { status: 'pending' },
      b: { status: 'pending' },
      c: { status: 'pending' }
    })
  })

  it('flips a row to success with duration', () => {
    const state = initialBatchState(['acct-a'])
    const next = applyProgress(state, makeEvent({ durationMs: 240 }))
    expect(next['acct-a']).toEqual({ status: 'success', durationMs: 240, error: undefined })
  })

  it('flips a row to error with the failure reason', () => {
    const state = initialBatchState(['acct-a'])
    const next = applyProgress(
      state,
      makeEvent({
        durationMs: 80,
        result: { ...baseResult, success: false, error: 'Refresh failed: 500 server error' }
      })
    )
    expect(next['acct-a']).toEqual({
      status: 'error',
      durationMs: 80,
      error: 'Refresh failed: 500 server error'
    })
  })

  it('returns the same reference when applying an idempotent progress event', () => {
    const state: Record<string, ReturnType<typeof applyProgress>[string]> = {
      'acct-a': { status: 'success', durationMs: 200, error: undefined }
    }
    const next = applyProgress(
      state,
      makeEvent({ durationMs: 200, result: { ...baseResult, success: true, error: null } })
    )
    expect(next).toBe(state)
  })

  it('overwrites previous state on retry (success → error)', () => {
    let state = initialBatchState(['acct-a'])
    state = applyProgress(state, makeEvent({ durationMs: 100 }))
    state = applyProgress(
      state,
      makeEvent({
        durationMs: 50,
        result: { ...baseResult, success: false, error: 'network down' }
      })
    )
    expect(state['acct-a']).toEqual({ status: 'error', durationMs: 50, error: 'network down' })
  })

  it('lists failed account ids', () => {
    let state = initialBatchState(['a', 'b', 'c'])
    state = applyProgress(state, makeEvent({ accountId: 'a' }))
    state = applyProgress(
      state,
      makeEvent({
        accountId: 'b',
        result: { ...baseResult, accountId: 'b', success: false, error: 'fail b' }
      })
    )
    state = applyProgress(
      state,
      makeEvent({
        accountId: 'c',
        result: { ...baseResult, accountId: 'c', success: false, error: 'fail c' }
      })
    )
    expect(failedAccountIds(state).sort()).toEqual(['b', 'c'])
  })
})
