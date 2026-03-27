import { describe, expect, it } from 'vitest'

import { accountUsageBadge, extraLimits, messages } from './app-view'

describe('app view account usage badge', () => {
  it('shows the underlying refresh error detail instead of only the generic label', () => {
    const badge = accountUsageBadge(
      'user@example.com: OpenAI token refresh failed (400): invalid_grant',
      {
        id: 'acct-1',
        email: 'user@example.com'
      },
      messages['en']
    )

    expect(badge).toEqual({
      kind: 'expired',
      detail: 'OpenAI token refresh failed (400): invalid_grant',
      title:
        'Session is no longer valid. Sign in again or re-import the current login.\nOpenAI token refresh failed (400): invalid_grant'
    })
  })

  it('keeps non-expired errors visible on the account card', () => {
    const badge = accountUsageBadge(
      'service temporarily unavailable',
      {
        id: 'acct-2',
        email: 'user@example.com'
      },
      messages['zh-CN']
    )

    expect(badge).toEqual({
      kind: 'error',
      detail: 'service temporarily unavailable',
      title: 'service temporarily unavailable'
    })
  })

  it('classifies deactivated workspace as a dedicated workspace error', () => {
    const badge = accountUsageBadge(
      'deactivated_workspace',
      {
        id: 'acct-4',
        email: 'user@example.com'
      },
      messages['zh-CN']
    )

    expect(badge).toEqual({
      kind: 'workspace',
      detail: 'deactivated_workspace',
      title: 'deactivated_workspace'
    })
  })

  it('returns null for healthy accounts', () => {
    expect(
      accountUsageBadge(
        undefined,
        {
          id: 'acct-3',
          email: 'user@example.com'
        },
        messages['zh-CN']
      )
    ).toBeNull()
  })

  it('hides review limits from extra limits display', () => {
    expect(
      extraLimits(
        {
          'acct-5': {
            limitId: 'codex',
            limitName: 'Codex',
            planType: 'team',
            primary: null,
            secondary: null,
            credits: null,
            fetchedAt: '2026-03-27T00:00:00.000Z',
            limits: [
              {
                limitId: 'codex',
                limitName: 'Codex',
                planType: 'team',
                primary: null,
                secondary: null
              },
              {
                limitId: 'code-review',
                limitName: 'Code Review',
                planType: 'team',
                primary: null,
                secondary: null
              },
              {
                limitId: 'gpt-4.1',
                limitName: 'GPT-4.1',
                planType: 'team',
                primary: null,
                secondary: null
              }
            ]
          }
        },
        'acct-5'
      ).map((limit) => limit.limitId)
    ).toEqual(['gpt-4.1'])
  })
})
