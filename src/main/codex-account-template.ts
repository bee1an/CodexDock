import type { CodexAuthPayload } from './codex-auth'
import type { AccountRateLimits, AccountSummary } from '../shared/codex'
import {
  decodeJwtPayload,
  resolveChatGptAccountIdFromTokens,
  resolveJwtStringClaim,
  resolveOpenAiAuthClaim
} from '../shared/openai-auth'

const OPENAI_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const DEFAULT_ACCOUNT_NOTES = ''
const DEFAULT_ACCOUNT_PLATFORM = 'openai'
const DEFAULT_ACCOUNT_TYPE = 'oauth'
const DEFAULT_ACCOUNT_CONCURRENCY = 10
const DEFAULT_ACCOUNT_PRIORITY = 1
const DEFAULT_ACCOUNT_RATE_MULTIPLIER = 1
const DEFAULT_ACCOUNT_AUTO_PAUSE_ON_EXPIRED = false
const DEFAULT_PRIVACY_MODE = 'training_off'

export interface TemplateCredentialsRecord {
  _token_version?: number
  access_token: string
  refresh_token: string
  id_token: string
  chatgpt_account_id: string
  chatgpt_user_id?: string
  client_id?: string | null
  email?: string
  expires_at?: string
  expires_in?: number
  organization_id?: string
  plan_type?: string | null
  scope?: string | null
  token_type?: string | null
}

export interface TemplateExtraRecord {
  codex_5h_reset_after_seconds?: number
  codex_5h_reset_at?: string
  codex_5h_used_percent?: number
  codex_5h_window_minutes?: number | null
  codex_7d_reset_after_seconds?: number
  codex_7d_reset_at?: string
  codex_7d_used_percent?: number
  codex_7d_window_minutes?: number | null
  codex_primary_over_secondary_percent?: number
  codex_primary_reset_after_seconds?: number
  codex_primary_reset_at?: string
  codex_primary_used_percent?: number
  codex_primary_window_minutes?: number | null
  codex_secondary_reset_after_seconds?: number
  codex_secondary_reset_at?: string
  codex_secondary_used_percent?: number
  codex_secondary_window_minutes?: number | null
  codex_usage_updated_at?: string
  email?: string
  privacy_mode?: string
}

export interface TemplateAccountRecord {
  name?: string
  notes?: string
  platform?: string
  type?: string
  credentials: TemplateCredentialsRecord
  extra?: TemplateExtraRecord
  concurrency?: number
  priority?: number
  rate_multiplier?: number
  auto_pause_on_expired?: boolean
}

export interface TemplateFileRecord {
  exported_at: string
  proxies: unknown[]
  accounts: TemplateAccountRecord[]
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readRequiredString(value: unknown, label: string, accountIndex?: number): string {
  if (typeof value === 'string' && value.trim()) {
    return value
  }

  const prefix =
    typeof accountIndex === 'number' ? `Template account #${accountIndex + 1}` : 'Template file'
  throw new Error(`${prefix} is missing required field: ${label}.`)
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function parseTemplateCredentials(
  value: unknown,
  accountIndex: number
): TemplateCredentialsRecord | undefined {
  if (value == null) {
    return undefined
  }

  const record = asRecord(value)
  if (!record) {
    throw new Error(`Template account #${accountIndex + 1} has invalid field: credentials.`)
  }

  return {
    _token_version: readOptionalNumber(record['_token_version']),
    access_token: readRequiredString(record['access_token'], 'credentials.access_token', accountIndex),
    refresh_token: readRequiredString(
      record['refresh_token'],
      'credentials.refresh_token',
      accountIndex
    ),
    id_token: readRequiredString(record['id_token'], 'credentials.id_token', accountIndex),
    chatgpt_account_id: readRequiredString(
      record['chatgpt_account_id'],
      'credentials.chatgpt_account_id',
      accountIndex
    ),
    chatgpt_user_id: readOptionalString(record['chatgpt_user_id']),
    client_id: typeof record['client_id'] === 'string' ? record['client_id'] : undefined,
    email: readOptionalString(record['email']),
    expires_at: readOptionalString(record['expires_at']),
    expires_in: readOptionalNumber(record['expires_in']),
    organization_id: readOptionalString(record['organization_id']),
    plan_type:
      typeof record['plan_type'] === 'string' || record['plan_type'] == null
        ? (record['plan_type'] as string | null | undefined)
        : undefined,
    scope:
      typeof record['scope'] === 'string' || record['scope'] == null
        ? (record['scope'] as string | null | undefined)
        : undefined,
    token_type:
      typeof record['token_type'] === 'string' || record['token_type'] == null
        ? (record['token_type'] as string | null | undefined)
        : undefined
  }
}

function parseTemplateExtra(value: unknown, accountIndex: number): TemplateExtraRecord | undefined {
  if (value == null) {
    return undefined
  }

  const record = asRecord(value)
  if (!record) {
    throw new Error(`Template account #${accountIndex + 1} has invalid field: extra.`)
  }

  return {
    codex_5h_reset_after_seconds: readOptionalNumber(record['codex_5h_reset_after_seconds']),
    codex_5h_reset_at: readOptionalString(record['codex_5h_reset_at']),
    codex_5h_used_percent: readOptionalNumber(record['codex_5h_used_percent']),
    codex_5h_window_minutes: readOptionalNumber(record['codex_5h_window_minutes']),
    codex_7d_reset_after_seconds: readOptionalNumber(record['codex_7d_reset_after_seconds']),
    codex_7d_reset_at: readOptionalString(record['codex_7d_reset_at']),
    codex_7d_used_percent: readOptionalNumber(record['codex_7d_used_percent']),
    codex_7d_window_minutes: readOptionalNumber(record['codex_7d_window_minutes']),
    codex_primary_over_secondary_percent: readOptionalNumber(
      record['codex_primary_over_secondary_percent']
    ),
    codex_primary_reset_after_seconds: readOptionalNumber(record['codex_primary_reset_after_seconds']),
    codex_primary_reset_at: readOptionalString(record['codex_primary_reset_at']),
    codex_primary_used_percent: readOptionalNumber(record['codex_primary_used_percent']),
    codex_primary_window_minutes: readOptionalNumber(record['codex_primary_window_minutes']),
    codex_secondary_reset_after_seconds: readOptionalNumber(
      record['codex_secondary_reset_after_seconds']
    ),
    codex_secondary_reset_at: readOptionalString(record['codex_secondary_reset_at']),
    codex_secondary_used_percent: readOptionalNumber(record['codex_secondary_used_percent']),
    codex_secondary_window_minutes: readOptionalNumber(record['codex_secondary_window_minutes']),
    codex_usage_updated_at: readOptionalString(record['codex_usage_updated_at']),
    email: readOptionalString(record['email']),
    privacy_mode: readOptionalString(record['privacy_mode'])
  }
}

export function parseTemplateFileRecord(raw: string): TemplateFileRecord {
  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Invalid account template file.')
  }

  const record = asRecord(parsed)
  if (!record) {
    throw new Error('Invalid account template file.')
  }

  const exportedAt = readRequiredString(record['exported_at'], 'exported_at')
  const accountsValue = record['accounts']
  if (!Array.isArray(accountsValue) || accountsValue.length === 0) {
    throw new Error('Template file does not contain any accounts.')
  }

  const accounts = accountsValue.map((value, index) => {
    const account = asRecord(value)
    if (!account) {
      throw new Error(`Template account #${index + 1} is invalid.`)
    }

    const credentials = parseTemplateCredentials(account['credentials'], index)
    if (!credentials) {
      throw new Error(`Template account #${index + 1} is missing required field: credentials.`)
    }

    return {
      name: readOptionalString(account['name']),
      notes: readOptionalString(account['notes']) ?? DEFAULT_ACCOUNT_NOTES,
      platform: readOptionalString(account['platform']) ?? DEFAULT_ACCOUNT_PLATFORM,
      type: readOptionalString(account['type']) ?? DEFAULT_ACCOUNT_TYPE,
      credentials,
      extra: parseTemplateExtra(account['extra'], index),
      concurrency:
        readOptionalNumber(account['concurrency']) ?? DEFAULT_ACCOUNT_CONCURRENCY,
      priority: readOptionalNumber(account['priority']) ?? DEFAULT_ACCOUNT_PRIORITY,
      rate_multiplier:
        readOptionalNumber(account['rate_multiplier']) ?? DEFAULT_ACCOUNT_RATE_MULTIPLIER,
      auto_pause_on_expired:
        typeof account['auto_pause_on_expired'] === 'boolean'
          ? (account['auto_pause_on_expired'] as boolean)
          : DEFAULT_ACCOUNT_AUTO_PAUSE_ON_EXPIRED
    } satisfies TemplateAccountRecord
  })

  return {
    exported_at: exportedAt,
    proxies: Array.isArray(record['proxies']) ? record['proxies'] : [],
    accounts
  }
}

function toEpochSeconds(value?: string | number | null): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value))
  }

  if (!value || typeof value !== 'string') {
    return null
  }

  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) {
    return null
  }

  return Math.floor(parsed / 1000)
}

function toEpochSecondsFromRelative(
  offsetSeconds?: number,
  baseTime?: string
): number | null {
  if (typeof offsetSeconds !== 'number' || !Number.isFinite(offsetSeconds) || offsetSeconds < 0) {
    return null
  }

  const base = Date.parse(baseTime ?? '')
  if (Number.isNaN(base)) {
    return null
  }

  return Math.floor(base / 1000) + Math.floor(offsetSeconds)
}

function toIsoFromEpochSeconds(value?: number | null): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined
  }

  return new Date(value * 1000).toISOString()
}

function normalizeWindowDuration(value?: number | null): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null
  }

  return Math.floor(value)
}

function normalizeUsedPercent(value?: number | null): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0
  }

  return Math.max(0, Math.min(100, Math.round(value)))
}

function resolveWindowResetAt(
  resetAt?: string,
  resetAfterSeconds?: number,
  exportedAt?: string
): number | null {
  return toEpochSeconds(resetAt) ?? toEpochSecondsFromRelative(resetAfterSeconds, exportedAt)
}

function buildRateLimitWindow(
  usedPercent: number | undefined,
  windowMinutes: number | null | undefined,
  resetsAt: number | null,
  hasData: boolean
) {
  if (!hasData) {
    return null
  }

  return {
    usedPercent: normalizeUsedPercent(usedPercent),
    windowDurationMins: normalizeWindowDuration(windowMinutes),
    resetsAt
  }
}

export function buildTemplateRateLimits(
  account: TemplateAccountRecord,
  exportedAt: string
): AccountRateLimits | null {
  const extra = account.extra
  if (!extra) {
    return null
  }

  const primaryUsedPercent = extra.codex_primary_used_percent ?? extra.codex_5h_used_percent
  const secondaryUsedPercent = extra.codex_secondary_used_percent ?? extra.codex_7d_used_percent
  const primaryWindowMinutes =
    extra.codex_primary_window_minutes ?? extra.codex_5h_window_minutes
  const secondaryWindowMinutes =
    extra.codex_secondary_window_minutes ?? extra.codex_7d_window_minutes
  const primaryResetsAt = resolveWindowResetAt(
    extra.codex_primary_reset_at ?? extra.codex_5h_reset_at,
    extra.codex_primary_reset_after_seconds ?? extra.codex_5h_reset_after_seconds,
    exportedAt
  )
  const secondaryResetsAt = resolveWindowResetAt(
    extra.codex_secondary_reset_at ?? extra.codex_7d_reset_at,
    extra.codex_secondary_reset_after_seconds ?? extra.codex_7d_reset_after_seconds,
    exportedAt
  )
  const hasPrimary =
    primaryUsedPercent != null || primaryWindowMinutes != null || primaryResetsAt != null
  const hasSecondary =
    secondaryUsedPercent != null || secondaryWindowMinutes != null || secondaryResetsAt != null

  if (!hasPrimary && !hasSecondary) {
    return null
  }

  const primary = buildRateLimitWindow(
    primaryUsedPercent,
    primaryWindowMinutes,
    primaryResetsAt,
    hasPrimary
  )
  const secondary = buildRateLimitWindow(
    secondaryUsedPercent,
    secondaryWindowMinutes,
    secondaryResetsAt,
    hasSecondary
  )
  const planType = account.credentials.plan_type ?? null
  const fetchedAt = extra.codex_usage_updated_at ?? exportedAt

  return {
    limitId: 'codex',
    limitName: null,
    planType,
    primary,
    secondary,
    credits: {
      hasCredits: false,
      unlimited: false,
      balance: null
    },
    limits: [
      {
        limitId: 'codex',
        limitName: null,
        planType,
        primary,
        secondary
      }
    ],
    fetchedAt
  }
}

export function buildAuthPayloadFromTemplate(
  account: TemplateAccountRecord,
  exportedAt: string
): CodexAuthPayload {
  return {
    auth_mode: 'chatgpt',
    OPENAI_API_KEY: null,
    last_refresh: exportedAt,
    tokens: {
      access_token: readRequiredString(
        account.credentials?.access_token,
        'credentials.access_token'
      ),
      refresh_token: readRequiredString(
        account.credentials?.refresh_token,
        'credentials.refresh_token'
      ),
      id_token: readRequiredString(account.credentials?.id_token, 'credentials.id_token'),
      account_id: readRequiredString(
        account.credentials?.chatgpt_account_id,
        'credentials.chatgpt_account_id'
      )
    }
  }
}

function toIsoFromJwtExp(token?: string): string | undefined {
  const payload = decodeJwtPayload(token)
  return typeof payload.exp === 'number' ? new Date(payload.exp * 1000).toISOString() : undefined
}

function toSecondsUntilJwtExp(token?: string): number | undefined {
  const payload = decodeJwtPayload(token)
  if (typeof payload.exp !== 'number') {
    return undefined
  }

  return Math.max(0, Math.floor(payload.exp - Date.now() / 1000))
}

function resolvePlanType(
  auth: CodexAuthPayload,
  rateLimits: AccountRateLimits | undefined
): string | null {
  if (rateLimits?.planType) {
    return rateLimits.planType
  }

  const idPayload = decodeJwtPayload(auth.tokens?.id_token)
  const authClaim = resolveOpenAiAuthClaim(idPayload)
  return typeof authClaim.chatgpt_plan_type === 'string' ? authClaim.chatgpt_plan_type : null
}

function resolveChatGptUserId(auth: CodexAuthPayload): string | undefined {
  const idPayload = decodeJwtPayload(auth.tokens?.id_token)
  return resolveJwtStringClaim(idPayload, 'sub')
}

function toResetAfterSeconds(resetAt?: string): number | undefined {
  if (!resetAt) {
    return undefined
  }

  const parsed = Date.parse(resetAt)
  if (Number.isNaN(parsed)) {
    return undefined
  }

  return Math.max(0, Math.floor((parsed - Date.now()) / 1000))
}

export function buildTemplateAccountExport(
  account: AccountSummary,
  auth: CodexAuthPayload,
  rateLimits: AccountRateLimits | undefined,
  exportedAt: string
): TemplateAccountRecord {
  const accessToken = readRequiredString(auth.tokens?.access_token, 'access_token')
  const refreshToken = readRequiredString(auth.tokens?.refresh_token, 'refresh_token')
  const idToken = readRequiredString(auth.tokens?.id_token, 'id_token')
  const accountId = resolveChatGptAccountIdFromTokens(
    auth.tokens?.id_token,
    auth.tokens?.access_token,
    auth.tokens?.account_id ?? account.accountId
  )
  const email = account.email
  const name = email ?? account.accountId ?? account.id
  const planType = resolvePlanType(auth, rateLimits)
  const primaryResetAt = toIsoFromEpochSeconds(rateLimits?.primary?.resetsAt)
  const secondaryResetAt = toIsoFromEpochSeconds(rateLimits?.secondary?.resetsAt)
  const primaryUsedPercent = rateLimits?.primary?.usedPercent ?? 0
  const secondaryUsedPercent = rateLimits?.secondary?.usedPercent ?? 0

  return {
    name,
    notes: DEFAULT_ACCOUNT_NOTES,
    platform: DEFAULT_ACCOUNT_PLATFORM,
    type: DEFAULT_ACCOUNT_TYPE,
    credentials: {
      _token_version: 1,
      access_token: accessToken,
      refresh_token: refreshToken,
      id_token: idToken,
      chatgpt_account_id: readRequiredString(accountId, 'chatgpt_account_id'),
      chatgpt_user_id: resolveChatGptUserId(auth),
      client_id: OPENAI_OAUTH_CLIENT_ID,
      email,
      expires_at: toIsoFromJwtExp(accessToken),
      expires_in: toSecondsUntilJwtExp(accessToken),
      plan_type: planType,
      scope: null,
      token_type: null
    },
    extra: {
      codex_5h_reset_after_seconds: toResetAfterSeconds(primaryResetAt),
      codex_5h_reset_at: primaryResetAt,
      codex_5h_used_percent: primaryUsedPercent,
      codex_5h_window_minutes: rateLimits?.primary?.windowDurationMins,
      codex_7d_reset_after_seconds: toResetAfterSeconds(secondaryResetAt),
      codex_7d_reset_at: secondaryResetAt,
      codex_7d_used_percent: secondaryUsedPercent,
      codex_7d_window_minutes: rateLimits?.secondary?.windowDurationMins,
      codex_primary_over_secondary_percent: primaryUsedPercent - secondaryUsedPercent,
      codex_primary_reset_after_seconds: toResetAfterSeconds(primaryResetAt),
      codex_primary_reset_at: primaryResetAt,
      codex_primary_used_percent: primaryUsedPercent,
      codex_primary_window_minutes: rateLimits?.primary?.windowDurationMins,
      codex_secondary_reset_after_seconds: toResetAfterSeconds(secondaryResetAt),
      codex_secondary_reset_at: secondaryResetAt,
      codex_secondary_used_percent: secondaryUsedPercent,
      codex_secondary_window_minutes: rateLimits?.secondary?.windowDurationMins,
      codex_usage_updated_at: rateLimits?.fetchedAt ?? exportedAt,
      email,
      privacy_mode: DEFAULT_PRIVACY_MODE
    },
    concurrency: DEFAULT_ACCOUNT_CONCURRENCY,
    priority: DEFAULT_ACCOUNT_PRIORITY,
    rate_multiplier: DEFAULT_ACCOUNT_RATE_MULTIPLIER,
    auto_pause_on_expired: DEFAULT_ACCOUNT_AUTO_PAUSE_ON_EXPIRED
  }
}
