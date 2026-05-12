import type { AppLanguage } from '../../../shared/codex'

export interface JwtExpiryInfo {
  expiresAt: number | null
  issuedAt: number | null
}

/**
 * 在渲染进程内解析 JWT payload 的 exp / iat 字段
 * 仅做 base64url 解码，不校验签名
 */
export function parseJwtExpiry(token?: string | null): JwtExpiryInfo {
  if (!token || typeof token !== 'string') {
    return { expiresAt: null, issuedAt: null }
  }

  const segments = token.split('.')
  if (segments.length < 2) {
    return { expiresAt: null, issuedAt: null }
  }

  try {
    const normalized = segments[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
    const decoded = atob(padded)
    const payload = JSON.parse(decoded) as { exp?: number; iat?: number }
    const expiresAt = typeof payload.exp === 'number' ? payload.exp * 1000 : null
    const issuedAt = typeof payload.iat === 'number' ? payload.iat * 1000 : null
    return { expiresAt, issuedAt }
  } catch {
    return { expiresAt: null, issuedAt: null }
  }
}

export function formatAbsoluteDateTime(
  value: string | number | null | undefined,
  language: AppLanguage
): string | null {
  if (value == null || value === '') {
    return null
  }

  const parsed = typeof value === 'number' ? value : Date.parse(value)
  if (!Number.isFinite(parsed)) {
    return null
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

export function formatDurationCompact(diffMs: number, language: AppLanguage): string {
  const totalMinutes = Math.max(1, Math.round(Math.abs(diffMs) / 60000))
  const days = Math.floor(totalMinutes / (24 * 60))
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60)
  const minutes = totalMinutes % 60

  if (language === 'en') {
    if (days > 0) {
      return hours > 0 ? `${days}d ${hours}h` : `${days}d`
    }
    if (hours > 0) {
      return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
    }
    return `${minutes}m`
  }

  if (days > 0) {
    return hours > 0 ? `${days}天${hours}小时` : `${days}天`
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours}小时${minutes}分钟` : `${hours}小时`
  }
  return `${minutes}分钟`
}

export type TokenExpiryTone = 'neutral' | 'warning' | 'danger' | 'expired'

export interface TokenExpiryDescriptor {
  label: string
  absolute: string | null
  tone: TokenExpiryTone
  title: string
  expiresAt: number | null
}

export function describeTokenExpiry(
  token: string | undefined | null,
  language: AppLanguage,
  copy: {
    tokenMissing: string
    tokenNoExpiry: string
    tokenExpired: (value: string) => string
    tokenExpiresIn: (value: string) => string
  },
  now: number = Date.now()
): TokenExpiryDescriptor {
  if (!token) {
    return {
      label: copy.tokenMissing,
      absolute: null,
      tone: 'neutral',
      title: copy.tokenMissing,
      expiresAt: null
    }
  }

  const { expiresAt } = parseJwtExpiry(token)
  if (!expiresAt) {
    return {
      label: copy.tokenNoExpiry,
      absolute: null,
      tone: 'neutral',
      title: copy.tokenNoExpiry,
      expiresAt: null
    }
  }

  const absolute = formatAbsoluteDateTime(expiresAt, language)
  const diffMs = expiresAt - now
  const duration = formatDurationCompact(diffMs, language)

  if (diffMs <= 0) {
    const label = copy.tokenExpired(duration)
    return {
      label,
      absolute,
      tone: 'expired',
      title: absolute ? `${label} · ${absolute}` : label,
      expiresAt
    }
  }

  const tone: TokenExpiryTone =
    diffMs <= 30 * 60 * 1000 ? 'danger' : diffMs <= 24 * 60 * 60 * 1000 ? 'warning' : 'neutral'
  const label = copy.tokenExpiresIn(duration)
  return {
    label,
    absolute,
    tone,
    title: absolute ? `${label} · ${absolute}` : label,
    expiresAt
  }
}

export function formatTimestampWithRelative(
  value: string | number | null | undefined,
  language: AppLanguage,
  copy: {
    justNow: string
    agoSuffix: (value: string) => string
    inFutureSuffix: (value: string) => string
    empty: string
  },
  now: number = Date.now()
): string {
  if (value == null || value === '') {
    return copy.empty
  }

  const parsed = typeof value === 'number' ? value : Date.parse(value)
  if (!Number.isFinite(parsed)) {
    return copy.empty
  }

  const absolute = formatAbsoluteDateTime(parsed, language) ?? String(value)
  const diffMs = parsed - now

  if (Math.abs(diffMs) < 45 * 1000) {
    return `${absolute} · ${copy.justNow}`
  }

  const duration = formatDurationCompact(diffMs, language)
  const relative = diffMs < 0 ? copy.agoSuffix(duration) : copy.inFutureSuffix(duration)
  return `${absolute} · ${relative}`
}
