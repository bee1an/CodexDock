import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { CodexAccountStore, refreshCodexAuthPayload, type CodexAuthPayload } from '../codex-auth'
import { parseTokenEndpointError } from '../codex-auth-shared'
import type { CodexPlatformAdapter, ProtectedPayload } from '../../shared/codex-platform'

function createPlatform(): CodexPlatformAdapter {
  return {
    fetch: vi.fn(),
    protect: (value: string): ProtectedPayload => ({
      mode: 'plain',
      value
    }),
    unprotect: (payload: ProtectedPayload): string => payload.value,
    openExternal: vi.fn(),
    trashItem: vi.fn(async () => undefined)
  }
}

function createJwt(payload: Record<string, unknown>): string {
  const encode = (value: Record<string, unknown>): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url')

  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.sig`
}

function createAuthPayload(
  accountId: string,
  identity: { email?: string; sub?: string; subscriptionExpiresAt?: string } = {}
): CodexAuthPayload {
  return {
    auth_mode: 'chatgpt',
    tokens: {
      account_id: accountId,
      id_token:
        identity.email || identity.sub || identity.subscriptionExpiresAt
          ? createJwt({
              email: identity.email,
              sub: identity.sub,
              'https://api.openai.com/auth': identity.subscriptionExpiresAt
                ? {
                    chatgpt_subscription_active_until: identity.subscriptionExpiresAt
                  }
                : undefined
            })
          : undefined,
      refresh_token: `refresh-${accountId}`
    }
  }
}

describe('parseTokenEndpointError', () => {
  it('extracts readable object-shaped token endpoint errors', () => {
    const raw = JSON.stringify({
      error: {
        code: 'unsupported_country_region_territory',
        message: 'Country, region, or territory not supported',
        param: null,
        type: 'request_forbidden'
      }
    })

    expect(parseTokenEndpointError(raw)).toBe('Country, region, or territory not supported')
  })

  it('keeps plain string token endpoint details readable', () => {
    expect(
      parseTokenEndpointError(
        JSON.stringify({
          error: 'invalid_grant',
          error_description: 'refresh_token_expired'
        })
      )
    ).toBe('refresh_token_expired')
  })
})

describe('refreshCodexAuthPayload', () => {
  it('uses the Codex JSON refresh token request format', async () => {
    const platform = createPlatform()
    ;(platform.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: 'access-next',
          refresh_token: 'refresh-next',
          id_token: createJwt({
            'https://api.openai.com/auth': {
              chatgpt_account_id: 'acct-a'
            }
          })
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        }
      )
    )

    await expect(
      refreshCodexAuthPayload(
        {
          auth_mode: 'chatgpt',
          tokens: {
            refresh_token: 'refresh-current'
          }
        },
        platform
      )
    ).resolves.toMatchObject({
      tokens: {
        access_token: 'access-next',
        refresh_token: 'refresh-next',
        account_id: 'acct-a'
      }
    })

    expect(platform.fetch).toHaveBeenCalledWith('https://auth.openai.com/oauth/token', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        client_id: 'app_EMoamEEZ73f0CkXaXp7hrann',
        grant_type: 'refresh_token',
        refresh_token: 'refresh-current'
      }),
      signal: undefined
    })
  })
})

describe('CodexAccountStore', () => {
  const createdDirectories: string[] = []

  afterEach(async () => {
    await Promise.all(
      createdDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true }))
    )
  })

  async function createStore(): Promise<CodexAccountStore> {
    const directory = await mkdtemp(join(tmpdir(), 'codexdock-store-'))
    createdDirectories.push(directory)
    return new CodexAccountStore(directory, createPlatform())
  }

  it('persists the reordered account sequence', async () => {
    const store = await createStore()

    await store.importAuthPayload(createAuthPayload('a'))
    await store.importAuthPayload(createAuthPayload('b'))
    await store.importAuthPayload(createAuthPayload('c'))

    await store.reorderAccounts(['b', 'a', 'c'])

    expect((await store.getSnapshot(false)).accounts.map((account) => account.id)).toEqual([
      'b',
      'a',
      'c'
    ])
  })

  it('reorders a visible account subset while preserving hidden account slots', async () => {
    const store = await createStore()

    await store.importAuthPayload(createAuthPayload('a'))
    await store.importAuthPayload(createAuthPayload('b'))
    await store.importAuthPayload(createAuthPayload('c'))
    await store.importAuthPayload(createAuthPayload('d'))

    await store.reorderAccounts(['b', 'd'])

    expect((await store.getSnapshot(false)).accounts.map((account) => account.id)).toEqual([
      'b',
      'c',
      'd',
      'a'
    ])
  })

  it('rejects duplicate accounts in reorder payloads', async () => {
    const store = await createStore()

    await store.importAuthPayload(createAuthPayload('a'))
    await store.importAuthPayload(createAuthPayload('b'))

    await expect(store.reorderAccounts(['b', 'b'])).rejects.toThrow(
      'Account reorder payload contains duplicate accounts.'
    )
  })

  it('creates, renames, and deletes groups while syncing account group bindings', async () => {
    const store = await createStore()
    const account = await store.importAuthPayload(createAuthPayload('a'))
    const group = await store.createGroup('工作')

    await store.updateAccountGroups(account.id, [group.id])
    expect((await store.getSnapshot(false)).accounts[0]?.groupIds).toEqual([group.id])

    await store.updateGroup(group.id, '重点')
    expect((await store.getSnapshot(false)).groups[0]?.name).toBe('重点')

    await store.deleteGroup(group.id)
    const snapshot = await store.getSnapshot(false)
    expect(snapshot.groups).toEqual([])
    expect(snapshot.accounts[0]?.groupIds).toEqual([])
  })

  it('migrates wake schedules when refreshed auth changes account identity', async () => {
    const store = await createStore()
    const account = await store.importAuthPayload(
      createAuthPayload('acct-a', { email: 'a@example.com' })
    )

    await store.updateAccountWakeSchedule(account.id, {
      enabled: true,
      times: ['09:00'],
      model: 'gpt-5.4',
      prompt: 'ping'
    })

    const refreshed = await store.importAuthPayload(
      createAuthPayload('acct-a', { email: 'a@example.com', sub: 'user-a' })
    )
    const snapshot = await store.getSnapshot(false)

    expect(refreshed.id).toBe('user-a:acct-a')
    expect(snapshot.wakeSchedulesByAccountId[refreshed.id]?.times).toEqual(['09:00'])
    expect(snapshot.wakeSchedulesByAccountId[account.id]).toBeUndefined()
  })

  it('exposes subscription expiration from auth token claims', async () => {
    const store = await createStore()

    const account = await store.importAuthPayload(
      createAuthPayload('acct-a', {
        email: 'a@example.com',
        subscriptionExpiresAt: '2026-05-15T04:28:55.000Z'
      })
    )
    const snapshot = await store.getSnapshot(false)

    expect(account.subscriptionExpiresAt).toBe('2026-05-15T04:28:55.000Z')
    expect(snapshot.accounts[0]?.subscriptionExpiresAt).toBe('2026-05-15T04:28:55.000Z')
  })

  it('preserves imported subscription expiration when synced auth lacks the claim', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'codexdock-store-'))
    createdDirectories.push(directory)
    const codexHome = join(directory, '.codex')
    await mkdir(codexHome, { recursive: true })
    const store = new CodexAccountStore(directory, createPlatform(), codexHome)

    const account = await store.importAuthPayload(
      createAuthPayload('acct-a', { email: 'a@example.com' }),
      { subscriptionExpiresAt: '2026-05-15T04:28:55.000Z' }
    )
    const currentAuth = createAuthPayload('acct-a', { email: 'a@example.com' })
    currentAuth.tokens!.refresh_token = 'refresh-acct-a-next'
    await writeFile(join(codexHome, 'auth.json'), JSON.stringify(currentAuth), 'utf8')

    const result = await store.importCurrentAuthPayloadForAccount(account.id)
    const snapshot = await store.getSnapshot(false)

    expect(result?.account.subscriptionExpiresAt).toBe('2026-05-15T04:28:55.000Z')
    expect(snapshot.accounts[0]?.subscriptionExpiresAt).toBe('2026-05-15T04:28:55.000Z')
  })

  it('rejects legacy safeStorage accounts with a re-import hint', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'codexdock-store-'))
    createdDirectories.push(directory)
    await writeFile(
      join(directory, 'codex-accounts.json'),
      JSON.stringify(
        {
          version: 3,
          activeAccountId: 'legacy',
          accounts: [
            {
              id: 'legacy',
              groupIds: [],
              createdAt: '2026-03-01T00:00:00.000Z',
              updatedAt: '2026-03-01T00:00:00.000Z',
              authPayload: {
                mode: 'safeStorage',
                value: 'encrypted'
              }
            }
          ],
          groups: [],
          settings: {
            usagePollingMinutes: 15,
            statusBarAccountIds: [],
            language: 'zh-CN',
            theme: 'light',
            checkForUpdatesOnStartup: true,
            codexDesktopExecutablePath: ''
          },
          usageByAccountId: {},
          usageErrorByAccountId: {}
        },
        null,
        2
      ),
      'utf8'
    )

    const store = new CodexAccountStore(directory, createPlatform())
    await expect(store.getStoredAuthPayload('legacy')).rejects.toThrow('Re-import it')
  })

  it('serializes concurrent state updates without dropping changes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'codexdock-store-'))
    createdDirectories.push(directory)

    const store = new CodexAccountStore(directory, createPlatform())
    const account = await store.importAuthPayload(createAuthPayload('a'))
    await store.saveAccountUsageError(account.id, 'boom')

    const rateLimits = {
      limitId: null,
      limitName: null,
      planType: 'plus',
      primary: {
        usedPercent: 12,
        windowDurationMins: 300,
        resetsAt: Date.parse('2026-03-25T10:00:00.000Z')
      },
      secondary: null,
      credits: null,
      limits: [],
      fetchedAt: '2026-03-25T08:00:00.000Z'
    }

    await Promise.all([
      store.saveAccountRateLimits(account.id, rateLimits),
      store.clearAccountUsageError(account.id)
    ])

    const snapshot = await store.getSnapshot(false)
    expect(snapshot.usageByAccountId[account.id]).toEqual(rateLimits)
    expect(snapshot.usageErrorByAccountId[account.id]).toBeUndefined()

    const persisted = await readFile(join(directory, 'codex-accounts.json'), 'utf8')
    const backup = await readFile(join(directory, 'codex-accounts.json.bak'), 'utf8')
    expect(JSON.parse(persisted)).toMatchObject({
      usageByAccountId: {
        [account.id]: rateLimits
      }
    })
    expect(JSON.parse(backup)).toMatchObject({
      usageByAccountId: {
        [account.id]: rateLimits
      }
    })
  })

  it('persists account auth errors and clears them only through explicit repair paths', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'codexdock-store-'))
    createdDirectories.push(directory)

    const store = new CodexAccountStore(directory, createPlatform())
    const account = await store.importAuthPayload(
      createAuthPayload('acct-a', { email: 'a@example.com' })
    )

    await store.markAccountAuthError(account.id, 'HTTP 401 from gateway', 'gateway', 401)

    let snapshot = await store.getSnapshot(false)
    expect(snapshot.accountHealthByAccountId[account.id]).toMatchObject({
      status: 'auth_error',
      reason: 'HTTP 401 from gateway',
      source: 'gateway',
      httpStatus: 401
    })

    const persisted = JSON.parse(await readFile(join(directory, 'codex-accounts.json'), 'utf8'))
    expect(persisted.version).toBe(4)
    expect(persisted.accountHealthByAccountId[account.id]).toMatchObject({
      status: 'auth_error',
      reason: 'HTTP 401 from gateway'
    })

    await store.updateAccountHealth(account.id, { status: 'normal' })
    snapshot = await store.getSnapshot(false)
    expect(snapshot.accountHealthByAccountId[account.id]).toBeUndefined()
  })

  it('clears account auth errors when tokens are updated manually', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'codexdock-store-'))
    createdDirectories.push(directory)

    const store = new CodexAccountStore(directory, createPlatform())
    const account = await store.importAuthPayload(
      createAuthPayload('acct-a', { email: 'a@example.com' })
    )

    await store.markAccountAuthError(account.id, 'expired refresh token', 'refresh')
    await store.updateAccountTokens(account.id, {
      accessToken: 'access-token-next'
    })

    const snapshot = await store.getSnapshot(false)
    expect(snapshot.accountHealthByAccountId[account.id]).toBeUndefined()
  })
})
