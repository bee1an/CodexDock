import { describe, expect, it } from 'vitest'

import {
  buildAuthPayloadFromTemplate,
  parseTemplateFileRecord
} from '../codex-account-template-import'

function createJwt(payload: Record<string, unknown>): string {
  const encode = (value: Record<string, unknown>): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.sig`
}

function createChatGptWebSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    user: {
      id: 'user-abc123',
      name: 'Test User',
      email: 'test@example.com',
      image: 'https://example.com/avatar.png',
      picture: 'https://example.com/avatar.png'
    },
    expires: '2026-04-15T12:00:00.000Z',
    accessToken: createJwt({
      exp: Math.floor(new Date('2026-04-15T12:00:00.000Z').getTime() / 1000),
      sub: 'auth0|user-abc123',
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'acct-xyz789',
        chatgpt_user_id: 'user-abc123',
        chatgpt_plan_type: 'plus',
        chatgpt_subscription_active_until: '2026-05-01T00:00:00.000Z'
      },
      'https://api.openai.com/profile': {
        email: 'test@example.com',
        name: 'Test User'
      }
    }),
    authProvider: 'auth0',
    account: {
      id: 'acct-xyz789',
      planType: 'plus'
    },
    ...overrides
  }
}

describe('parseTemplateFileRecord — ChatGPT Web Session', () => {
  it('parses a standard ChatGPT web session object', () => {
    const session = createChatGptWebSession()
    const result = parseTemplateFileRecord(JSON.stringify(session))

    expect(result.accounts).toHaveLength(1)
    const creds = result.accounts[0].credentials
    expect(creds.access_token).toBeTruthy()
    expect(creds.chatgpt_account_id).toBe('acct-xyz789')
    expect(creds.email).toBe('test@example.com')
    expect(creds.plan_type).toBe('plus')
    expect(creds.expires_at).toBe('2026-04-15T12:00:00.000Z')
  })

  it('does not include id_token when source has none', () => {
    const session = createChatGptWebSession()
    const result = parseTemplateFileRecord(JSON.stringify(session))
    expect(result.accounts[0].credentials.id_token).toBeUndefined()
  })

  it('does not include refresh_token when source has none', () => {
    const session = createChatGptWebSession()
    const result = parseTemplateFileRecord(JSON.stringify(session))
    expect(result.accounts[0].credentials.refresh_token).toBeUndefined()
  })

  it('resolves chatgpt_account_id from JWT when account.id is missing', () => {
    const session = createChatGptWebSession({
      account: { planType: 'pro' }
    })
    const result = parseTemplateFileRecord(JSON.stringify(session))
    expect(result.accounts[0].credentials.chatgpt_account_id).toBe('acct-xyz789')
  })

  it('throws when accessToken is missing', () => {
    const session = createChatGptWebSession()
    delete (session as Record<string, unknown>)['accessToken']
    expect(() => parseTemplateFileRecord(JSON.stringify(session))).toThrow()
  })

  it('throws when both account and user are missing (not recognized as web session)', () => {
    const session = {
      accessToken: 'eyJhbGciOiJub25lIn0.eyJ0ZXN0Ijp0cnVlfQ.sig',
      expires: '2026-04-15T12:00:00.000Z'
    }
    expect(() => parseTemplateFileRecord(JSON.stringify(session))).toThrow(
      'Invalid account template file.'
    )
  })

  it('maps account.planType to plan_type', () => {
    const session = createChatGptWebSession({
      account: { id: 'acct-pro', planType: 'pro' }
    })
    const result = parseTemplateFileRecord(JSON.stringify(session))
    expect(result.accounts[0].credentials.plan_type).toBe('pro')
  })

  it('uses expires as exported_at', () => {
    const session = createChatGptWebSession()
    const result = parseTemplateFileRecord(JSON.stringify(session))
    expect(result.exported_at).toBe('2026-04-15T12:00:00.000Z')
  })

  it('extracts chatgpt_user_id from user.id', () => {
    const session = createChatGptWebSession()
    const result = parseTemplateFileRecord(JSON.stringify(session))
    expect(result.accounts[0].credentials.chatgpt_user_id).toBe('user-abc123')
  })
})

describe('buildAuthPayloadFromTemplate — ChatGPT Web Session', () => {
  it('builds a valid CodexAuthPayload from parsed web session', () => {
    const session = createChatGptWebSession()
    const parsed = parseTemplateFileRecord(JSON.stringify(session))
    const account = parsed.accounts[0]
    const payload = buildAuthPayloadFromTemplate(account, parsed.exported_at)

    expect(payload.auth_mode).toBe('chatgpt')
    expect(payload.OPENAI_API_KEY).toBeNull()
    expect(payload.tokens?.access_token).toBeTruthy()
    expect(payload.tokens?.account_id).toBe('acct-xyz789')
    expect(payload.tokens?.refresh_token).toBeUndefined()
    expect(payload.tokens?.id_token).toBeUndefined()
  })

  it('sets last_refresh to exported_at when account has no last_refresh', () => {
    const session = createChatGptWebSession()
    const parsed = parseTemplateFileRecord(JSON.stringify(session))
    const account = parsed.accounts[0]
    const payload = buildAuthPayloadFromTemplate(account, parsed.exported_at)

    expect(payload.last_refresh).toBe('2026-04-15T12:00:00.000Z')
  })
})
