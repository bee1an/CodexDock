import type { CodexAuthPayload } from './codex-auth'
import type { AccountRateLimits, AccountSummary, RateLimitWindow } from '../shared/codex'
import { resolveChatGptAccountIdFromTokens } from '../shared/openai-auth'

export interface TemplateUsageWindowRecord {
  used_percent: number
  window_minutes?: number | null
  reset_at?: string
}

export interface TemplateUsageRecord {
  plan_type?: string | null
  primary?: TemplateUsageWindowRecord
  secondary?: TemplateUsageWindowRecord
  updated_at?: string
}

export interface TemplateAuthRecord {
  access_token: string
  refresh_token: string
  id_token: string
  chatgpt_account_id: string
}

export interface TemplateAccountRecord {
  auth: TemplateAuthRecord
  usage?: TemplateUsageRecord
}

export interface TemplateFileRecord {
  exported_at: string
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

function parseUsageWindow(
  value: unknown,
  field: string,
  accountIndex: number
): TemplateUsageWindowRecord | undefined {
  if (value == null) {
    return undefined
  }

  const record = asRecord(value)
  if (!record) {
    throw new Error(`Template account #${accountIndex + 1} has invalid field: ${field}.`)
  }

  return {
    used_percent: readOptionalNumber(record['used_percent']) ?? 0,
    window_minutes: readOptionalNumber(record['window_minutes']),
    reset_at: readOptionalString(record['reset_at'])
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

    const authRecord = asRecord(account['auth'])
    if (!authRecord) {
      throw new Error(`Template account #${index + 1} is missing required field: auth.`)
    }

    const usageRecord = asRecord(account['usage'])

    return {
      auth: {
        access_token: readRequiredString(authRecord['access_token'], 'auth.access_token', index),
        refresh_token: readRequiredString(authRecord['refresh_token'], 'auth.refresh_token', index),
        id_token: readRequiredString(authRecord['id_token'], 'auth.id_token', index),
        chatgpt_account_id: readRequiredString(
          authRecord['chatgpt_account_id'],
          'auth.chatgpt_account_id',
          index
        )
      },
      usage: usageRecord
        ? {
            plan_type:
              typeof usageRecord['plan_type'] === 'string' || usageRecord['plan_type'] == null
                ? (usageRecord['plan_type'] as string | null | undefined)
                : undefined,
            primary: parseUsageWindow(usageRecord['primary'], 'usage.primary', index),
            secondary: parseUsageWindow(usageRecord['secondary'], 'usage.secondary', index),
            updated_at: readOptionalString(usageRecord['updated_at'])
          }
        : undefined
    } satisfies TemplateAccountRecord
  })

  return {
    exported_at: exportedAt,
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

function buildTemplateUsageWindow(
  window?: RateLimitWindow | null
): TemplateUsageWindowRecord | undefined {
  if (!window) {
    return undefined
  }

  return {
    used_percent: window.usedPercent,
    window_minutes: window.windowDurationMins,
    reset_at: toIsoFromEpochSeconds(window.resetsAt)
  }
}

export function buildTemplateRateLimits(
  usage: TemplateUsageRecord | undefined,
  exportedAt: string
): AccountRateLimits | null {
  if (!usage) {
    return null
  }

  const primaryResetsAt = toEpochSeconds(usage.primary?.reset_at)
  const secondaryResetsAt = toEpochSeconds(usage.secondary?.reset_at)
  const hasPrimary = Boolean(usage.primary)
  const hasSecondary = Boolean(usage.secondary)

  if (!hasPrimary && !hasSecondary) {
    return null
  }

  return {
    limitId: 'codex',
    limitName: null,
    planType: usage.plan_type ?? null,
    primary: hasPrimary
      ? {
          usedPercent: normalizeUsedPercent(usage.primary?.used_percent),
          windowDurationMins: normalizeWindowDuration(usage.primary?.window_minutes),
          resetsAt: primaryResetsAt
        }
      : null,
    secondary: hasSecondary
      ? {
          usedPercent: normalizeUsedPercent(usage.secondary?.used_percent),
          windowDurationMins: normalizeWindowDuration(usage.secondary?.window_minutes),
          resetsAt: secondaryResetsAt
        }
      : null,
    credits: {
      hasCredits: false,
      unlimited: false,
      balance: null
    },
    limits: [
      {
        limitId: 'codex',
        limitName: null,
        planType: usage.plan_type ?? null,
        primary: hasPrimary
          ? {
              usedPercent: normalizeUsedPercent(usage.primary?.used_percent),
              windowDurationMins: normalizeWindowDuration(usage.primary?.window_minutes),
              resetsAt: primaryResetsAt
            }
          : null,
        secondary: hasSecondary
          ? {
              usedPercent: normalizeUsedPercent(usage.secondary?.used_percent),
              windowDurationMins: normalizeWindowDuration(usage.secondary?.window_minutes),
              resetsAt: secondaryResetsAt
            }
          : null
      }
    ],
    fetchedAt: usage.updated_at ?? exportedAt
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
      access_token: account.auth.access_token,
      refresh_token: account.auth.refresh_token,
      id_token: account.auth.id_token,
      account_id: account.auth.chatgpt_account_id
    }
  }
}

export function buildTemplateAccountExport(
  account: AccountSummary,
  auth: CodexAuthPayload,
  rateLimits: AccountRateLimits | undefined,
  _exportedAt: string
): TemplateAccountRecord {
  const accessToken = readRequiredString(auth.tokens?.access_token, 'access_token')
  const refreshToken = readRequiredString(auth.tokens?.refresh_token, 'refresh_token')
  const idToken = readRequiredString(auth.tokens?.id_token, 'id_token')
  const accountId = resolveChatGptAccountIdFromTokens(
    auth.tokens?.id_token,
    auth.tokens?.access_token,
    auth.tokens?.account_id ?? account.accountId
  )

  return {
    auth: {
      access_token: accessToken,
      refresh_token: refreshToken,
      id_token: idToken,
      chatgpt_account_id: readRequiredString(accountId, 'chatgpt_account_id')
    },
    usage: rateLimits
      ? {
          plan_type: rateLimits.planType,
          primary: buildTemplateUsageWindow(rateLimits.primary),
          secondary: buildTemplateUsageWindow(rateLimits.secondary),
          updated_at: rateLimits.fetchedAt
        }
      : undefined
  }
}
