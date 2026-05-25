import type {
  AppLanguage,
  AppTheme,
  AccountRateLimitEntry,
  AccountRateLimits,
  AccountSummary,
  CustomProviderSummary,
  LoginEvent
} from '../../../../shared/codex'
import { remainingPercent } from '../../../../shared/codex'
import { zhMessages } from './app-messages-zh'
import { enMessages } from './app-messages-en'
export { statusBarAccounts } from '../../../../shared/codex'

export const pollingOptions = [5, 15, 30, 60] as const

export const languageOptions: Array<{ value: AppLanguage; label: string }> = [
  { value: 'zh-CN', label: '中文' },
  { value: 'en', label: 'English' }
]

export function accountScopedRecord<T>(
  accounts: Array<Pick<AccountSummary, 'id'>>,
  record: Record<string, T>
): Record<string, T> {
  const accountIds = new Set(accounts.map((account) => account.id))
  return Object.fromEntries(
    Object.entries(record).filter(([accountId]) => accountIds.has(accountId))
  )
}

export function preserveAccountScopedRecord<T>(
  accounts: Array<Pick<AccountSummary, 'id'>>,
  snapshotRecord: Record<string, T>,
  currentRecord: Record<string, T>
): Record<string, T> {
  return accountScopedRecord(accounts, {
    ...snapshotRecord,
    ...currentRecord
  })
}

export const messages = {
  'zh-CN': zhMessages,
  en: enMessages
} as const

export type LocalizedCopy = (typeof messages)['zh-CN']

export function accountLabel(
  account: Pick<AccountSummary, 'name' | 'email' | 'accountId'>,
  copy: LocalizedCopy
): string {
  return account.name ?? account.email ?? account.accountId ?? copy.unnamedAccount
}

export function accountEmail(
  account: Pick<AccountSummary, 'name' | 'email' | 'accountId'>,
  copy: LocalizedCopy
): string {
  return account.email ?? account.name ?? account.accountId ?? copy.unnamedAccount
}

export function providerLabel(
  provider: Pick<CustomProviderSummary, 'name' | 'baseUrl'>,
  copy: Pick<LocalizedCopy, 'providerEmptyName'>
): string {
  return provider.name?.trim() || provider.baseUrl || copy.providerEmptyName
}

export function planLabel(planType?: string | null): string {
  switch ((planType ?? '').toLowerCase()) {
    case 'free':
      return 'Free'
    case 'plus':
      return 'Plus'
    case 'pro':
      return 'Pro'
    case 'team':
      return 'Team'
    case 'enterprise':
      return 'Enterprise'
    default:
      return planType || '--'
  }
}

export function planTagClass(planType?: string | null): string {
  switch ((planType ?? '').toLowerCase()) {
    case 'free':
      return 'theme-plan-neutral bg-[var(--surface-soft)] text-[var(--ink-soft)]'
    case 'plus':
      return 'theme-plan-plus bg-emerald-500/12 text-emerald-700'
    case 'pro':
      return 'theme-plan-pro bg-sky-500/12 text-sky-700'
    case 'team':
      return 'theme-plan-team bg-amber-500/14 text-amber-700'
    case 'enterprise':
      return 'theme-plan-enterprise bg-rose-500/14 text-rose-700'
    default:
      return 'theme-plan-neutral bg-[var(--surface-soft)] text-[var(--ink-soft)]'
  }
}

export function formatDurationCompact(ms: number, language: AppLanguage): string {
  const absoluteMs = Math.abs(ms)
  const dayMs = 24 * 60 * 60 * 1000
  const hourMs = 60 * 60 * 1000
  const minuteMs = 60 * 1000
  const days = Math.floor(absoluteMs / dayMs)
  const hours = Math.floor((absoluteMs % dayMs) / hourMs)
  const minutes = Math.floor((absoluteMs % hourMs) / minuteMs)

  if (language === 'en') {
    if (days > 0) {
      return `${days}d ${hours}h`
    }
    if (hours > 0) {
      return `${hours}h ${minutes}m`
    }
    return `${minutes}m`
  }

  if (days > 0) {
    return `${days}天${hours}小时`
  }
  if (hours > 0) {
    return `${hours}小时${minutes}分钟`
  }
  return `${minutes}分钟`
}

export function formatSubscriptionDateTime(
  subscriptionExpiresAt: string | undefined,
  language: AppLanguage
): string | null {
  if (!subscriptionExpiresAt) {
    return null
  }

  const parsed = Date.parse(subscriptionExpiresAt)
  if (Number.isNaN(parsed)) {
    return subscriptionExpiresAt
  }

  return new Intl.DateTimeFormat(language, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(parsed))
}

export function accountSubscriptionBadge(
  subscriptionExpiresAt: string | undefined,
  language: AppLanguage,
  copy: Pick<
    LocalizedCopy,
    'subscriptionExpiresAt' | 'subscriptionRemaining' | 'subscriptionExpiredAgo'
  >,
  now = Date.now()
): { label: string; title: string; expired: boolean; critical: boolean } | null {
  if (!subscriptionExpiresAt) {
    return null
  }

  const parsed = Date.parse(subscriptionExpiresAt)
  if (Number.isNaN(parsed)) {
    return null
  }

  const remainingMs = parsed - now
  const duration = formatDurationCompact(remainingMs, language)
  const dateTime =
    formatSubscriptionDateTime(subscriptionExpiresAt, language) ?? subscriptionExpiresAt
  const expired = remainingMs < 0

  return {
    label: expired ? copy.subscriptionExpiredAgo(duration) : copy.subscriptionRemaining(duration),
    title: `${copy.subscriptionExpiresAt}: ${dateTime}`,
    expired,
    critical: remainingMs <= 3 * 24 * 60 * 60 * 1000
  }
}

export function accountTokenExpiryBadge(
  accessTokenExpiresAt: number | undefined,
  language: AppLanguage,
  copy: Pick<LocalizedCopy, 'tokenExpiresAtLabel' | 'tokenExpiringSoon' | 'tokenExpiredAgo'>,
  now = Date.now()
): { label: string; title: string; expired: boolean; critical: boolean } | null {
  if (!accessTokenExpiresAt) {
    return null
  }

  const remainingMs = accessTokenExpiresAt - now
  if (remainingMs > 3 * 24 * 60 * 60 * 1000) {
    return null
  }

  const duration = formatDurationCompact(remainingMs, language)
  const expired = remainingMs <= 0
  const dateTime = new Date(accessTokenExpiresAt).toLocaleString(
    language === 'zh-CN' ? 'zh-CN' : 'en-US'
  )

  return {
    label: expired ? copy.tokenExpiredAgo(duration) : copy.tokenExpiringSoon(duration),
    title: `${copy.tokenExpiresAtLabel}: ${dateTime}`,
    expired,
    critical: remainingMs <= 1 * 24 * 60 * 60 * 1000
  }
}

export function loginTone(phase: LoginEvent['phase']): string {
  if (phase === 'success') {
    return 'text-success'
  }

  if (phase === 'error' || phase === 'cancelled') {
    return 'text-danger'
  }

  return 'text-carbon'
}

export function accountCardTone(active: boolean): string {
  return active
    ? 'theme-account-card theme-account-card-active border-[var(--line-strong)] bg-[var(--surface-selected)]'
    : 'theme-account-card border-[var(--color-arctic-mist)] bg-[var(--panel-strong)]'
}

export function usageErrorKind(message?: string): 'expired' | 'workspace' | 'error' | null {
  if (!message) {
    return null
  }

  const normalized = message.toLowerCase()

  if (normalized.includes('deactivated_workspace')) {
    return 'workspace'
  }

  if (
    normalized.includes('invalid_grant') ||
    normalized.includes('refresh_token_expired') ||
    normalized.includes('refresh_token_reused') ||
    normalized.includes('refresh_token_invalidated') ||
    normalized.includes('already used') ||
    normalized.includes('revoked') ||
    normalized.includes('missing refresh token') ||
    normalized.includes('missing access token') ||
    normalized.includes('token refresh failed (401)') ||
    normalized.includes('token refresh failed (403)') ||
    normalized.includes('failed: 401') ||
    normalized.includes('failed: 403')
  ) {
    return 'expired'
  }

  return 'error'
}

function usageErrorDetail(
  message: string,
  account?: Pick<AccountSummary, 'id' | 'email' | 'name' | 'accountId'>
): string {
  const normalized = message.trim()
  if (!normalized || !account) {
    return normalized
  }

  const prefixes = [account.email, account.name, account.accountId, account.id].filter(
    (value): value is string => Boolean(value)
  )
  for (const prefix of prefixes) {
    if (normalized.startsWith(`${prefix}: `)) {
      return normalized.slice(prefix.length + 2).trim()
    }
  }

  return normalized
}

export function accountUsageBadge(
  message: string | undefined,
  account: Pick<AccountSummary, 'id' | 'email' | 'name' | 'accountId'>,
  copy: Pick<LocalizedCopy, 'accountExpired' | 'accountExpiredHint' | 'accountUsageRefreshFailed'>
): { kind: 'expired' | 'workspace' | 'error'; title: string; detail: string } | null {
  const kind = usageErrorKind(message)

  if (!message || !kind) {
    return null
  }

  const detail = usageErrorDetail(message, account)

  if (kind === 'expired') {
    return {
      kind,
      detail,
      title: `${copy.accountExpiredHint}\n${detail}`
    }
  }

  return {
    kind,
    detail,
    title: detail
  }
}

export function progressWidth(value?: number | null): string {
  return `${remainingPercent(value)}%`
}

export interface QuotaAggregate {
  averageRemaining: number
  accountCount: number
}

export interface QuotaAggregateSummary {
  primary: QuotaAggregate
  secondary: QuotaAggregate
  totalAccounts: number
}

export function aggregateAccountQuotas(
  accounts: Array<Pick<AccountSummary, 'id'>>,
  usageByAccountId: Record<string, AccountRateLimits>
): QuotaAggregateSummary {
  let primarySum = 0
  let primaryCount = 0
  let secondarySum = 0
  let secondaryCount = 0
  let totalAccounts = 0

  for (const account of accounts) {
    const rateLimits = usageByAccountId[account.id]
    if (!rateLimits) {
      continue
    }

    if (!rateLimits.primary && !rateLimits.secondary) {
      continue
    }

    totalAccounts += 1

    if (rateLimits.primary) {
      primarySum += remainingPercent(rateLimits.primary.usedPercent)
      primaryCount += 1
    }

    if (rateLimits.secondary) {
      secondarySum += remainingPercent(rateLimits.secondary.usedPercent)
      secondaryCount += 1
    }
  }

  return {
    primary: {
      averageRemaining: primaryCount ? Math.round(primarySum / primaryCount) : 0,
      accountCount: primaryCount
    },
    secondary: {
      averageRemaining: secondaryCount ? Math.round(secondarySum / secondaryCount) : 0,
      accountCount: secondaryCount
    },
    totalAccounts
  }
}

function normalizeResetTimestamp(value?: number | null): number | null {
  if (!value) {
    return null
  }

  return value < 1_000_000_000_000 ? value * 1000 : value
}

export function weeklyResetTimeToneClass(value?: number | null, now = Date.now()): string {
  const normalized = normalizeResetTimestamp(value)
  if (!normalized) {
    return 'text-muted-strong'
  }

  const diffMs = normalized - now
  if (diffMs <= 0) {
    return 'text-emerald-700'
  }

  const remainingDays = Math.ceil(diffMs / (24 * 60 * 60_000))

  if (remainingDays <= 1) {
    return 'text-emerald-700'
  }

  if (remainingDays <= 3) {
    return 'text-sky-700'
  }

  if (remainingDays <= 5) {
    return 'text-amber-700'
  }

  return 'text-red-700'
}

export function limitLabel(limit: AccountRateLimitEntry): string {
  const raw = (limit.limitName ?? limit.limitId ?? '').toLowerCase()

  if (raw.includes('review')) {
    return 'review'
  }

  if (raw.includes('codex')) {
    return 'codex'
  }

  return limit.limitName ?? limit.limitId ?? 'extra'
}

export function themeIconClass(theme: AppTheme): string {
  switch (theme) {
    case 'dark':
      return 'i-lucide-moon-star'
    case 'system':
      return 'i-lucide-monitor'
    default:
      return 'i-lucide-sun-medium'
  }
}

export function themeTitle(theme: AppTheme, copy: LocalizedCopy): string {
  switch (theme) {
    case 'dark':
      return copy.darkTheme
    case 'system':
      return copy.systemTheme
    default:
      return copy.lightTheme
  }
}

export function nextTheme(theme: AppTheme): AppTheme {
  switch (theme) {
    case 'light':
      return 'dark'
    case 'dark':
      return 'system'
    default:
      return 'light'
  }
}

export function extraLimits(
  usageByAccountId: Record<string, AccountRateLimits>,
  accountId: string
): AccountRateLimitEntry[] {
  const rateLimits = usageByAccountId[accountId]
  if (!rateLimits) {
    return []
  }

  return rateLimits.limits.filter((limit) => {
    if (limit.limitId === rateLimits.limitId) {
      return false
    }

    const raw = (limit.limitName ?? limit.limitId ?? '').toLowerCase()
    if (raw.includes('review')) {
      return false
    }

    return true
  })
}
