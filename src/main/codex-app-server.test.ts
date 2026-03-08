import { afterEach, describe, expect, it } from 'vitest'

import { AccountRateLimitLookupError, readAccountRateLimits } from './codex-app-server'

describe('readAccountRateLimits', () => {
  const originalBaseUrl = process.env['ILOVECODEX_CHATGPT_BASE_URL']

  afterEach(() => {
    if (originalBaseUrl == null) {
      delete process.env['ILOVECODEX_CHATGPT_BASE_URL']
      return
    }

    process.env['ILOVECODEX_CHATGPT_BASE_URL'] = originalBaseUrl
  })

  it('maps the usage payload and normalizes the chatgpt base url', async () => {
    process.env['ILOVECODEX_CHATGPT_BASE_URL'] = 'https://chatgpt.com'

    let requestedUrl = ''
    const result = await readAccountRateLimits(
      {
        tokens: {
          access_token: 'token',
          account_id: 'acct_123'
        }
      },
      {
        fetch: async (input, init) => {
          requestedUrl = input
          expect(init?.headers).toMatchObject({
            authorization: 'Bearer token',
            'chatgpt-account-id': 'acct_123',
            'user-agent': 'ilovecodex'
          })

          return new Response(
            JSON.stringify({
              plan_type: 'education',
              rate_limit: {
                allowed: true,
                limit_reached: false,
                primary_window: {
                  used_percent: 42,
                  limit_window_seconds: 3600,
                  reset_after_seconds: 60,
                  reset_at: 1_746_390_000
                },
                secondary_window: {
                  used_percent: 10,
                  limit_window_seconds: 86_400,
                  reset_after_seconds: 600,
                  reset_at: 1_746_450_000
                }
              },
              credits: {
                has_credits: true,
                unlimited: false,
                balance: '12.5'
              },
              additional_rate_limits: [
                {
                  limit_name: 'GPT-4.1',
                  metered_feature: 'gpt-4.1',
                  rate_limit: {
                    allowed: true,
                    limit_reached: false,
                    primary_window: {
                      used_percent: 20,
                      limit_window_seconds: 7200,
                      reset_after_seconds: 10,
                      reset_at: 1_746_392_000
                    }
                  }
                }
              ]
            }),
            {
              status: 200,
              headers: { 'content-type': 'application/json' }
            }
          )
        }
      }
    )

    expect(requestedUrl).toBe('https://chatgpt.com/backend-api/wham/usage')
    expect(result.planType).toBe('edu')
    expect(result.primary?.usedPercent).toBe(42)
    expect(result.primary?.windowDurationMins).toBe(60)
    expect(result.secondary?.windowDurationMins).toBe(1440)
    expect(result.credits).toEqual({
      hasCredits: true,
      unlimited: false,
      balance: 12.5
    })
    expect(result.limits).toHaveLength(2)
    expect(result.limits[1]).toMatchObject({
      limitId: 'gpt-4.1',
      limitName: 'GPT-4.1',
      primary: {
        usedPercent: 20,
        windowDurationMins: 120,
        resetsAt: 1_746_392_000
      }
    })
  })

  it('fails fast when the access token is missing', async () => {
    await expect(readAccountRateLimits({ tokens: { account_id: 'acct_123' } }, { fetch: async () => new Response() }))
      .rejects.toThrow('Missing access token required for rate-limit lookup.')
  })

  it('wraps non-ok responses in AccountRateLimitLookupError', async () => {
    await expect(
      readAccountRateLimits(
        {
          tokens: {
            access_token: 'token',
            account_id: 'acct_123'
          }
        },
        {
          fetch: async () =>
            new Response('unauthorized', {
              status: 401,
              headers: { 'content-type': 'text/plain' }
            })
        }
      )
    ).rejects.toBeInstanceOf(AccountRateLimitLookupError)
  })
})
