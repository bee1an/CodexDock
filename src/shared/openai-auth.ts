export function decodeJwtPayload(token?: string): Record<string, unknown> {
  if (!token) {
    return {}
  }

  const parts = token.split('.')
  if (parts.length < 2) {
    return {}
  }

  const payload = parts[1]
  const padding = '='.repeat((4 - (payload.length % 4)) % 4)
  const normalized = `${payload}${padding}`.replaceAll('-', '+').replaceAll('_', '/')

  try {
    return JSON.parse(Buffer.from(normalized, 'base64').toString('utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

export function resolveJwtStringClaim(
  payload: Record<string, unknown>,
  key: string
): string | undefined {
  const value = payload[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}

export function resolveOpenAiAuthClaim(payload: Record<string, unknown>): Record<string, unknown> {
  const value = payload['https://api.openai.com/auth']
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

export function resolveChatGptAccountIdFromTokens(
  idToken?: string,
  accessToken?: string,
  fallbackAccountId?: string
): string | undefined {
  if (fallbackAccountId) {
    return fallbackAccountId
  }

  const claims = [decodeJwtPayload(idToken), decodeJwtPayload(accessToken)]
  for (const payload of claims) {
    const authClaim = resolveOpenAiAuthClaim(payload)
    if (typeof authClaim.chatgpt_account_id === 'string') {
      return authClaim.chatgpt_account_id
    }
  }

  return undefined
}
