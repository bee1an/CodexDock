import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { execFile as execFileCallback } from 'node:child_process'
import type { Server } from 'node:http'
import { promisify } from 'node:util'

import type {
  AccountGroup,
  AccountHealth,
  AccountHealthSource,
  AccountRateLimits,
  AccountWakeSchedule,
  AccountSummary,
  AppSettings,
  LoginMethod,
  PortOccupant
} from '../shared/codex'
import type { CodexPlatformAdapter, ProtectedPayload } from '../shared/codex-platform'
import {
  decodeJwtPayload,
  resolveChatGptAccountIdFromTokens,
  resolveChatGptSubscriptionExpiresAtFromTokens
} from '../shared/openai-auth'
import {
  defaultWakeModel,
  defaultStatsDisplaySettings,
  normalizeLocalGatewaySettings,
  normalizeStatsDisplaySettings
} from '../shared/codex'

export interface CodexAuthPayload {
  auth_mode?: string
  OPENAI_API_KEY?: string | null
  last_refresh?: string
  tokens?: {
    access_token?: string
    refresh_token?: string
    id_token?: string
    account_id?: string
  }
}

interface PersistedAccount extends AccountSummary {
  authPayload: ProtectedPayload
}

interface PersistedState {
  version: 4
  activeAccountId?: string
  accounts: PersistedAccount[]
  groups: AccountGroup[]
  settings: AppSettings
  usageByAccountId: Record<string, AccountRateLimits>
  usageErrorByAccountId: Record<string, string>
  accountHealthByAccountId: Record<string, AccountHealth>
  wakeSchedulesByAccountId: Record<string, AccountWakeSchedule>
}

interface LegacyPersistedState {
  version?: 1 | 2 | 3
  activeAccountId?: string
  accounts?: PersistedAccount[]
  groups?: AccountGroup[]
  tags?: AccountGroup[]
  settings?: AppSettings
  usageByAccountId?: Record<string, AccountRateLimits>
  usageErrorByAccountId?: Record<string, string>
  accountHealthByAccountId?: Record<string, AccountHealth>
  wakeSchedulesByAccountId?: Record<string, AccountWakeSchedule>
}

function defaultSettings(): AppSettings {
  return {
    usagePollingMinutes: 15,
    statusBarAccountIds: [],
    language: 'zh-CN',
    theme: 'light',
    checkForUpdatesOnStartup: true,
    codexDesktopExecutablePath: '',
    preserveChatGptAuthOnDirectProviderOpen: false,
    showLocalMockData: true,
    statsDisplay: defaultStatsDisplaySettings(),
    tagVisibility: {},
    toolbarIconMovable: true,
    collapsedToolbarIconDefaultPosition: true,
    localGateway: normalizeLocalGatewaySettings()
  }
}

interface LoginSession {
  attemptId: string
  method: LoginMethod
  server?: Server
  abortController?: AbortController
  rawOutput: string
  cancelled: boolean
  authUrl?: string
  redirectUri?: string
  verificationUrl?: string
  userCode?: string
}

const OPENAI_AUTH_ISSUER = 'https://auth.openai.com'
const OPENAI_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const OPENAI_OAUTH_SCOPE =
  'openid profile email offline_access api.connectors.read api.connectors.invoke'
const OPENAI_AUTHORIZE_URL = `${OPENAI_AUTH_ISSUER}/oauth/authorize`
const OPENAI_TOKEN_URL = `${OPENAI_AUTH_ISSUER}/oauth/token`
const OPENAI_DEVICE_CODE_URL = `${OPENAI_AUTH_ISSUER}/api/accounts/deviceauth/usercode`
const OPENAI_DEVICE_TOKEN_URL = `${OPENAI_AUTH_ISSUER}/api/accounts/deviceauth/token`
const OPENAI_DEVICE_VERIFICATION_URL = `${OPENAI_AUTH_ISSUER}/codex/device`
const OPENAI_DEVICE_REDIRECT_URI = `${OPENAI_AUTH_ISSUER}/deviceauth/callback`
const OPENAI_CALLBACK_PORT = 1455
const execFile = promisify(execFileCallback)

function defaultState(): PersistedState {
  return {
    version: 4,
    accounts: [],
    groups: [],
    settings: defaultSettings(),
    usageByAccountId: {},
    usageErrorByAccountId: {},
    accountHealthByAccountId: {},
    wakeSchedulesByAccountId: {}
  }
}

function normalizeWakeSchedule(
  schedule?: Partial<AccountWakeSchedule> | null
): AccountWakeSchedule | null {
  if (!schedule) {
    return null
  }

  const times = [...new Set((schedule.times ?? []).map((value) => value.trim()).filter(Boolean))]
    .filter((value) => /^\d{2}:\d{2}$/.test(value))
    .sort()

  return {
    enabled: Boolean(schedule.enabled),
    times,
    model: schedule.model?.trim() || defaultWakeModel,
    prompt: schedule.prompt?.trim() || 'ping',
    lastTriggeredAt: schedule.lastTriggeredAt,
    lastSucceededAt: schedule.lastSucceededAt,
    lastStatus: schedule.lastStatus ?? 'idle',
    lastMessage: schedule.lastMessage?.trim() || undefined
  }
}

function normalizePersistedState(parsed: PersistedState | LegacyPersistedState): PersistedState {
  const raw = parsed as Record<string, unknown>
  const rawAccounts = (raw.accounts ?? []) as Array<PersistedAccount & { tagIds?: string[] }>
  const rawGroups = (raw.groups ?? raw.tags ?? []) as AccountGroup[]
  const accounts = rawAccounts.map((account) => ({
    ...account,
    groupIds: dedupeAccountGroupIds(account.groupIds ?? account.tagIds ?? [])
  }))
  const accountIds = new Set(accounts.map((account) => account.id))

  return {
    ...defaultState(),
    ...parsed,
    version: 4,
    accounts,
    groups: rawGroups,
    settings: {
      ...defaultSettings(),
      ...('settings' in parsed ? parsed.settings : {}),
      statsDisplay: normalizeStatsDisplaySettings(parsed.settings?.statsDisplay),
      localGateway: normalizeLocalGatewaySettings(parsed.settings?.localGateway)
    },
    usageByAccountId: parsed.usageByAccountId ?? {},
    usageErrorByAccountId: parsed.usageErrorByAccountId ?? {},
    accountHealthByAccountId: Object.fromEntries(
      Object.entries(
        normalizeAccountHealthByAccountId(parsed.accountHealthByAccountId ?? {})
      ).filter(([accountId]) => accountIds.has(accountId))
    ),
    wakeSchedulesByAccountId: Object.fromEntries(
      Object.entries(parsed.wakeSchedulesByAccountId ?? {})
        .map(([accountId, schedule]) => [accountId, normalizeWakeSchedule(schedule)])
        .filter((entry): entry is [string, AccountWakeSchedule] => Boolean(entry[1]))
    )
  }
}

function normalizeAccountHealthSource(value: unknown): AccountHealthSource {
  switch (value) {
    case 'gateway':
    case 'refresh':
    case 'usage':
    case 'manual':
      return value
    default:
      return 'manual'
  }
}

function normalizeAccountHealthByAccountId(
  raw: Record<string, AccountHealth>
): Record<string, AccountHealth> {
  return Object.fromEntries(
    Object.entries(raw)
      .map(([accountId, health]): [string, AccountHealth] | null => {
        if (!health || typeof health !== 'object' || health.status !== 'auth_error') {
          return null
        }

        const reason =
          typeof health.reason === 'string' && health.reason.trim()
            ? health.reason.trim()
            : 'Account authentication failed.'
        const markedAt =
          typeof health.markedAt === 'string' && !Number.isNaN(Date.parse(health.markedAt))
            ? health.markedAt
            : new Date().toISOString()
        const httpStatus =
          typeof health.httpStatus === 'number' && Number.isFinite(health.httpStatus)
            ? health.httpStatus
            : undefined

        return [
          accountId,
          {
            status: 'auth_error',
            reason,
            markedAt,
            source: normalizeAccountHealthSource(health.source),
            ...(httpStatus ? { httpStatus } : {})
          }
        ]
      })
      .filter((entry): entry is [string, AccountHealth] => Boolean(entry))
  )
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function normalizeGroupName(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function dedupeAccountGroupIds(groupIds: string[]): string[] {
  return [...new Set(groupIds)]
}

function base64UrlEncode(value: Buffer): string {
  return value.toString('base64url')
}

function createPkceVerifier(): string {
  return base64UrlEncode(randomBytes(48))
}

function createPkceChallenge(verifier: string): string {
  return base64UrlEncode(createHash('sha256').update(verifier).digest())
}

function encodeFormComponent(value: string): string {
  return encodeURIComponent(value)
}

function buildAuthorizeUrl(redirectUri: string, codeChallenge: string, state: string): string {
  const query = [
    ['response_type', 'code'],
    ['client_id', OPENAI_OAUTH_CLIENT_ID],
    ['redirect_uri', redirectUri],
    ['scope', OPENAI_OAUTH_SCOPE],
    ['code_challenge', codeChallenge],
    ['code_challenge_method', 'S256'],
    ['id_token_add_organizations', 'true'],
    ['codex_cli_simplified_flow', 'true'],
    ['state', state],
    ['originator', 'Codex Desktop']
  ]
    .map(([key, value]) => `${key}=${encodeFormComponent(value)}`)
    .join('&')

  return `${OPENAI_AUTHORIZE_URL}?${query}`
}

function stringifyTokenEndpointErrorValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || undefined
  }

  if (value === undefined || value === null) {
    return undefined
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function parseTokenEndpointError(raw: string): string {
  const fallback = raw.trim()

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const errorValue = parsed.error
    const nestedError =
      errorValue && typeof errorValue === 'object' ? (errorValue as Record<string, unknown>) : null

    return (
      stringifyTokenEndpointErrorValue(parsed.error_description) ??
      stringifyTokenEndpointErrorValue(parsed.message) ??
      stringifyTokenEndpointErrorValue(nestedError?.message) ??
      stringifyTokenEndpointErrorValue(nestedError?.code) ??
      stringifyTokenEndpointErrorValue(parsed.code) ??
      stringifyTokenEndpointErrorValue(errorValue) ??
      stringifyTokenEndpointErrorValue(parsed) ??
      fallback
    )
  } catch {
    return fallback
  }
}

function extractTokenEndpointErrorCode(raw: string): string | undefined {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const errorValue = parsed.error
    if (errorValue && typeof errorValue === 'object') {
      const code = (errorValue as Record<string, unknown>).code
      if (typeof code === 'string' && code.trim()) {
        return code.trim()
      }
    }
    if (typeof errorValue === 'string' && errorValue.trim()) {
      return errorValue.trim()
    }
    if (typeof parsed.code === 'string' && parsed.code.trim()) {
      return parsed.code.trim()
    }
  } catch {
    // Ignore malformed error bodies; callers still use the textual detail.
  }

  return undefined
}

export class CodexAuthRefreshError extends Error {
  readonly status: number
  readonly code?: string
  readonly permanent: boolean

  constructor(status: number, detail: string, code?: string) {
    const normalizedDetail = detail || 'Unknown token refresh error'
    const suffix =
      code && !normalizedDetail.includes(code) ? `${code}: ${normalizedDetail}` : normalizedDetail
    super(`OpenAI token refresh failed (${status}): ${suffix}`)
    this.name = 'CodexAuthRefreshError'
    this.status = status
    this.code = code
    // GitHub openai/codex treats 401 refresh responses as non-retryable and caches them.
    this.permanent = status === 401
  }
}

interface TokenEndpointPayload {
  access_token?: string
  refresh_token?: string
  id_token?: string
}

export async function getTcpPortOccupant(port: number): Promise<PortOccupant | null> {
  try {
    const { stdout } = await execFile('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'])
    const lines = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

    if (lines.length < 2) {
      return null
    }

    const columns = lines[1].split(/\s+/)
    const command = columns[0]
    const pid = Number(columns[1])
    if (!command || Number.isNaN(pid)) {
      return null
    }

    return { pid, command }
  } catch {
    return null
  }
}

export async function killTcpPortOccupant(port: number): Promise<PortOccupant | null> {
  const occupant = await getTcpPortOccupant(port)
  if (!occupant) {
    return null
  }

  process.kill(occupant.pid, 'SIGTERM')
  return occupant
}

export async function getOpenAiCallbackPortOccupant(): Promise<PortOccupant | null> {
  return getTcpPortOccupant(OPENAI_CALLBACK_PORT)
}

export async function killOpenAiCallbackPortOccupant(): Promise<PortOccupant | null> {
  return killTcpPortOccupant(OPENAI_CALLBACK_PORT)
}

function buildAuthPayloadFromTokenResponse(tokens: TokenEndpointPayload): CodexAuthPayload {
  return {
    auth_mode: 'chatgpt',
    OPENAI_API_KEY: null,
    last_refresh: new Date().toISOString(),
    tokens: {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      id_token: tokens.id_token,
      account_id: resolveChatGptAccountIdFromTokens(tokens.id_token, tokens.access_token)
    }
  }
}

export async function refreshCodexAuthPayload(
  auth: CodexAuthPayload,
  platform: CodexPlatformAdapter,
  signal?: AbortSignal
): Promise<CodexAuthPayload> {
  const refreshToken = auth.tokens?.refresh_token
  if (!refreshToken) {
    throw new Error('Missing refresh token required for token refresh.')
  }

  const response = await platform.fetch(OPENAI_TOKEN_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      client_id: OPENAI_OAUTH_CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    }),
    signal
  })
  const raw = await response.text()

  if (!response.ok) {
    const detail = parseTokenEndpointError(raw)
    const code = extractTokenEndpointErrorCode(raw)
    throw new CodexAuthRefreshError(response.status, detail, code)
  }

  const parsed = JSON.parse(raw) as TokenEndpointPayload

  return buildAuthPayloadFromTokenResponse({
    access_token: parsed.access_token,
    refresh_token: parsed.refresh_token ?? refreshToken,
    id_token: parsed.id_token
  })
}

function resolveOpenAiProfileClaim(payload: Record<string, unknown>): Record<string, unknown> {
  const value = payload['https://api.openai.com/profile']
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function resolveStringFromTokens(
  tokens: Array<string | undefined>,
  extract: (payload: Record<string, unknown>) => unknown
): string | undefined {
  for (const token of tokens) {
    const payload = decodeJwtPayload(token)
    const value = extract(payload)
    if (typeof value === 'string' && value.trim()) {
      return value
    }
  }

  return undefined
}

function summarizeAuth(
  auth: CodexAuthPayload
): Pick<AccountSummary, 'email' | 'name' | 'accountId' | 'subscriptionExpiresAt'> {
  const tokens = [auth.tokens?.id_token, auth.tokens?.access_token]
  const email = resolveStringFromTokens(tokens, (payload) => {
    if (typeof payload.email === 'string' && payload.email.trim()) {
      return payload.email
    }
    return resolveOpenAiProfileClaim(payload).email
  })
  const name = resolveStringFromTokens(tokens, (payload) => {
    if (typeof payload.name === 'string' && payload.name.trim()) {
      return payload.name
    }
    return resolveOpenAiProfileClaim(payload).name
  })
  const accountId = extractChatGptAccountId(auth)
  const subscriptionExpiresAt = resolveChatGptSubscriptionExpiresAtFromTokens(
    auth.tokens?.id_token,
    auth.tokens?.access_token
  )

  return {
    email,
    name,
    accountId,
    subscriptionExpiresAt
  }
}

function authIdentityFingerprint(auth: CodexAuthPayload): string | undefined {
  const source =
    auth.tokens?.refresh_token ?? auth.tokens?.id_token ?? auth.tokens?.access_token ?? undefined

  if (!source) {
    return undefined
  }

  return createHash('sha256').update(source).digest('hex').slice(0, 16)
}

function resolveSubject(auth: CodexAuthPayload): string | undefined {
  const identityPayloads = [
    decodeJwtPayload(auth.tokens?.id_token),
    decodeJwtPayload(auth.tokens?.access_token)
  ]
  return identityPayloads
    .map((payload) => (typeof payload.sub === 'string' ? payload.sub : undefined))
    .find(Boolean)
}

function resolveAccountId(auth: CodexAuthPayload): string {
  const summary = summarizeAuth(auth)
  const subject = resolveSubject(auth)
  const fingerprint = authIdentityFingerprint(auth)

  if (subject && summary.accountId) {
    return `${subject}:${summary.accountId}`
  }

  return summary.accountId ?? subject ?? fingerprint ?? randomUUID()
}

function extractChatGptAccountId(auth: CodexAuthPayload): string | undefined {
  return resolveChatGptAccountIdFromTokens(
    auth.tokens?.id_token,
    auth.tokens?.access_token,
    auth.tokens?.account_id
  )
}

function findMatchingAccount(
  accounts: PersistedAccount[],
  auth: CodexAuthPayload
): PersistedAccount | undefined {
  const summary = summarizeAuth(auth)
  const identity = resolveAccountId(auth)
  const subject = resolveSubject(auth)

  return accounts.find((account) => {
    if (account.id === identity) {
      return true
    }

    // Legacy compatibility: older entries may have used account_id or sub alone.
    if (summary.email && summary.accountId) {
      return (
        account.id === summary.accountId &&
        account.accountId === summary.accountId &&
        account.email === summary.email
      )
    }

    if (summary.email && subject) {
      return account.id === subject && account.email === summary.email
    }

    return false
  })
}

function toAccountSummary(account: PersistedAccount): AccountSummary {
  return {
    id: account.id,
    email: account.email,
    name: account.name,
    accountId: account.accountId,
    subscriptionExpiresAt: account.subscriptionExpiresAt,
    groupIds: account.groupIds,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    lastUsedAt: account.lastUsedAt
  }
}

export type {
  LegacyPersistedState,
  LoginSession,
  PersistedAccount,
  PersistedState,
  TokenEndpointPayload
}
export {
  buildAuthPayloadFromTokenResponse,
  buildAuthorizeUrl,
  defaultSettings,
  defaultState,
  dedupeAccountGroupIds,
  describeError,
  encodeFormComponent,
  extractChatGptAccountId,
  findMatchingAccount,
  normalizePersistedState,
  normalizeGroupName,
  normalizeWakeSchedule,
  parseTokenEndpointError,
  extractTokenEndpointErrorCode,
  resolveAccountId,
  resolveSubject,
  summarizeAuth,
  toAccountSummary,
  authIdentityFingerprint,
  createPkceChallenge,
  createPkceVerifier,
  base64UrlEncode,
  OPENAI_AUTH_ISSUER,
  OPENAI_AUTHORIZE_URL,
  OPENAI_CALLBACK_PORT,
  OPENAI_DEVICE_CODE_URL,
  OPENAI_DEVICE_REDIRECT_URI,
  OPENAI_DEVICE_TOKEN_URL,
  OPENAI_DEVICE_VERIFICATION_URL,
  OPENAI_OAUTH_CLIENT_ID,
  OPENAI_OAUTH_SCOPE,
  OPENAI_TOKEN_URL
}
