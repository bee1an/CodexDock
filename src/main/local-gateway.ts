import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from 'node:http'
import { dirname } from 'node:path'

import type { CodexAuthPayload } from './codex-auth'
import type { CodexAccountStore } from './codex-account-store'
import type { CodexProviderStore } from './codex-providers'
import type { StoredAuthRefreshResult } from './codex-services-shared'
import { getTcpPortOccupant } from './codex-auth-shared'
import {
  isLocalMockAccount,
  isAccountHealthBlocking,
  localGatewayBaseUrl,
  maskLocalGatewayApiKey,
  normalizeLocalGatewaySettings,
  resolveBestAccount,
  type AccountSummary,
  type CustomProviderProtocol,
  type CustomProviderSummary,
  type LocalGatewayLogEntry,
  type LocalGatewayModelMapping,
  type LocalGatewaySettings,
  type LocalGatewayStatus,
  type OpenCodexFromServiceInput,
  type OpenCodexFromServiceResult,
  type PortOccupant
} from '../shared/codex'
import type { CodexPlatformAdapter } from '../shared/codex-platform'
import { resolveChatGptAccountIdFromTokens } from '../shared/openai-auth'
import { shouldMarkAccountAuthError } from './codex-services-shared'

type StickyTarget =
  | { kind: 'account'; id: string; protocol: 'openai'; expiresAt: number }
  | { kind: 'provider'; id: string; protocol: CustomProviderProtocol; expiresAt: number }

type GatewayLogMeta = Pick<
  LocalGatewayLogEntry,
  | 'provider'
  | 'model'
  | 'tokens'
  | 'target'
  | 'client'
  | 'requestBytes'
  | 'responseBytes'
  | 'requestContentType'
  | 'responseContentType'
>

const DEFAULT_CHATGPT_BASE_URL = 'https://chatgpt.com/backend-api'

function logTargetFromAccount(account: AccountSummary): string {
  return account.email || account.name || account.id
}
const CHATGPT_HOSTS = ['https://chatgpt.com', 'https://chat.openai.com'] as const

function generateGatewayApiKey(): string {
  return `sk-cdock-${randomBytes(24).toString('base64url')}`
}

function normalizeChatGptBaseUrl(baseUrl: string): string {
  let normalized = baseUrl.trim().replace(/\/+$/, '')
  if (
    CHATGPT_HOSTS.some((host) => normalized.startsWith(host)) &&
    !normalized.includes('/backend-api')
  ) {
    normalized = `${normalized}/backend-api`
  }
  return normalized
}

function resolveCodexResponsesUrl(): string {
  const baseUrl = normalizeChatGptBaseUrl(
    process.env['ILOVECODEX_CHATGPT_BASE_URL'] ?? DEFAULT_CHATGPT_BASE_URL
  )
  return baseUrl.includes('/backend-api')
    ? `${baseUrl}/codex/responses`
    : `${baseUrl}/api/codex/responses`
}

function openAiError(
  message: string,
  status = 400,
  code?: string
): { status: number; body: unknown } {
  return {
    status,
    body: {
      error: {
        message,
        type: 'invalid_request_error',
        code: code ?? null
      }
    }
  }
}

async function readRequestBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

function parseJsonBody(body: Buffer): Record<string, unknown> {
  if (!body.length) {
    return {}
  }
  const parsed = JSON.parse(body.toString('utf8')) as unknown
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {}
}

function headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name.toLowerCase()]
  if (Array.isArray(value)) {
    return value[0]
  }
  return value
}

function extractGatewayToken(headers: IncomingHttpHeaders, url: URL): string | null {
  const authorization = headerValue(headers, 'authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(authorization)
  const bearer = match?.[1]?.trim()
  if (bearer) {
    return bearer
  }

  return (
    headerValue(headers, 'x-api-key')?.trim() ||
    headerValue(headers, 'x-goog-api-key')?.trim() ||
    url.searchParams.get('key')?.trim() ||
    null
  )
}

function stickyKeyFromRequest(
  headers: IncomingHttpHeaders,
  body: Record<string, unknown>
): string | null {
  const fromHeader = headerValue(headers, 'session_id') ?? headerValue(headers, 'x-sticky-session')
  if (fromHeader?.trim()) {
    return fromHeader.trim()
  }

  for (const key of ['conversation', 'previous_response_id', 'prompt_cache_key']) {
    const value = body[key]
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
    if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string') {
      return value.id
    }
  }

  return null
}

function joinUpstreamUrl(baseUrl: string, requestPath: string): string {
  const base = new URL(baseUrl)
  const basePath = base.pathname.replace(/\/+$/, '')
  let path = requestPath
  if (basePath.endsWith('/v1') && path.startsWith('/v1/')) {
    path = path.slice('/v1'.length)
  }
  if (basePath.endsWith('/v1beta') && path.startsWith('/v1beta/')) {
    path = path.slice('/v1beta'.length)
  }
  base.pathname = `${basePath}${path}`.replace(/\/{2,}/g, '/')
  return base.toString()
}

function filteredRequestHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (
      !value ||
      ['host', 'authorization', 'x-api-key', 'x-goog-api-key', 'content-length'].includes(
        key.toLowerCase()
      )
    ) {
      continue
    }
    out[key] = Array.isArray(value) ? value.join(', ') : String(value)
  }
  return out
}

function buildProviderHeaders(
  protocol: CustomProviderProtocol,
  apiKey: string,
  headers: IncomingHttpHeaders
): Record<string, string> {
  const base = filteredRequestHeaders(headers)
  switch (protocol) {
    case 'anthropic':
      return {
        ...base,
        'content-type': base['content-type'] ?? 'application/json',
        'anthropic-version': base['anthropic-version'] ?? '2023-06-01',
        'x-api-key': apiKey
      }
    case 'gemini':
      return {
        ...base,
        'content-type': base['content-type'] ?? 'application/json',
        'x-goog-api-key': apiKey
      }
    case 'openai':
    default:
      return {
        ...base,
        'content-type': base['content-type'] ?? 'application/json',
        authorization: `Bearer ${apiKey}`
      }
  }
}

function setResponseHeaders(response: ServerResponse, upstream: Response): void {
  upstream.headers.forEach((value, key) => {
    if (['content-encoding', 'content-length', 'transfer-encoding'].includes(key.toLowerCase())) {
      return
    }
    response.setHeader(key, value)
  })
}

async function writeFetchResponse(response: ServerResponse, upstream: Response): Promise<void> {
  response.statusCode = upstream.status
  setResponseHeaders(response, upstream)

  if (!upstream.body) {
    response.end(Buffer.from(await upstream.arrayBuffer()))
    return
  }

  const reader = upstream.body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      const ok = response.write(Buffer.from(value))
      if (!ok) {
        await new Promise<void>((resolve) => response.once('drain', resolve))
      }
    }
  } finally {
    response.end()
    reader.releaseLock()
  }
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.end(`${JSON.stringify(body)}\n`)
}

function hasAllowedGatewayTargets(settings: LocalGatewaySettings): boolean {
  return settings.allowedGroupIds.length > 0 || settings.allowedAccountIds.length > 0
}

function requiresAllowedGatewayTargets(pathname: string): boolean {
  return (
    pathname === '/v1/models' ||
    pathname === '/v1beta/models' ||
    pathname === '/v1/responses' ||
    pathname === '/v1/chat/completions' ||
    pathname === '/v1/messages' ||
    pathname === '/v1/messages/count_tokens' ||
    pathname.startsWith('/v1beta/')
  )
}

function protocolForPath(pathname: string): CustomProviderProtocol {
  if (pathname === '/v1/messages' || pathname === '/v1/messages/count_tokens') {
    return 'anthropic'
  }
  if (pathname.startsWith('/v1beta/')) {
    return 'gemini'
  }
  return 'openai'
}

function safeStringifyForLog(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function truncateLogMessage(message: string, maxLength = 1200): string {
  const normalized = message.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, maxLength - 1)}…`
}

function logMessageFromResponseBody(rawBody: string): string | undefined {
  const trimmed = rawBody.trim()
  if (!trimmed) {
    return undefined
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>
      const error = record.error
      if (error && typeof error === 'object') {
        const errorRecord = error as Record<string, unknown>
        const message =
          typeof errorRecord.message === 'string'
            ? errorRecord.message
            : safeStringifyForLog(errorRecord)
        const code = typeof errorRecord.code === 'string' ? errorRecord.code : ''
        return truncateLogMessage(code ? `${message} (${code})` : message)
      }
      if (typeof record.message === 'string') {
        return truncateLogMessage(record.message)
      }
      if (typeof record.error === 'string') {
        return truncateLogMessage(record.error)
      }
    }
    return truncateLogMessage(safeStringifyForLog(parsed))
  } catch {
    return truncateLogMessage(trimmed)
  }
}

function isGatewayAuthFailureStatus(status: number): boolean {
  return status === 401 || status === 403
}

async function authFailureReasonFromResponse(upstream: Response): Promise<string> {
  const fallback = `Upstream returned HTTP ${upstream.status}.`
  const raw = await upstream
    .clone()
    .text()
    .catch(() => '')
  const message = logMessageFromResponseBody(raw)
  return message ? `${fallback} ${message}` : fallback
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function installResponseBodyCapture(response: ServerResponse): { text: () => string; bytes: () => number } {
  const chunks: Buffer[] = []
  let capturedBytes = 0
  let totalBytes = 0
  const maxBytes = 8192
  const originalWrite = response.write.bind(response)
  const originalEnd = response.end.bind(response)

  const capture = (chunk: unknown, encoding?: BufferEncoding): void => {
    if (chunk === undefined || chunk === null) {
      return
    }

    let buffer: Buffer | null = null
    if (Buffer.isBuffer(chunk)) {
      buffer = chunk
    } else if (typeof chunk === 'string') {
      buffer = Buffer.from(chunk, encoding)
    } else if (chunk instanceof Uint8Array) {
      buffer = Buffer.from(chunk)
    }

    if (!buffer?.length) {
      return
    }

    totalBytes += buffer.length
    if (capturedBytes < maxBytes) {
      const available = maxBytes - capturedBytes
      chunks.push(buffer.length > available ? buffer.subarray(0, available) : buffer)
      capturedBytes += Math.min(buffer.length, available)
    }
  }

  response.write = ((chunk: unknown, encodingOrCallback?: unknown, callback?: unknown) => {
    capture(
      chunk,
      typeof encodingOrCallback === 'string' ? (encodingOrCallback as BufferEncoding) : undefined
    )
    return originalWrite(chunk as never, encodingOrCallback as never, callback as never)
  }) as typeof response.write

  response.end = ((chunk?: unknown, encodingOrCallback?: unknown, callback?: unknown) => {
    capture(
      chunk,
      typeof encodingOrCallback === 'string' ? (encodingOrCallback as BufferEncoding) : undefined
    )
    return originalEnd(chunk as never, encodingOrCallback as never, callback as never)
  }) as typeof response.end

  return { text: () => Buffer.concat(chunks).toString('utf8'), bytes: () => totalBytes }
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }
  if (!Array.isArray(content)) {
    if (
      content &&
      typeof content === 'object' &&
      typeof (content as Record<string, unknown>).text === 'string'
    ) {
      return (content as Record<string, string>).text
    }
    if (content && typeof content === 'object' && 'parts' in content) {
      return textFromContent((content as Record<string, unknown>).parts)
    }
    if (content && typeof content === 'object' && 'content' in content) {
      return textFromContent((content as Record<string, unknown>).content)
    }
    return ''
  }

  return content
    .map((part) => {
      if (typeof part === 'string') {
        return part
      }
      if (!part || typeof part !== 'object') {
        return ''
      }
      const record = part as Record<string, unknown>
      if (typeof record.text === 'string') {
        return record.text
      }
      if (typeof record.content === 'string') {
        return record.content
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function toResponsesInputMessage(message: unknown): Record<string, unknown> | null {
  if (!message || typeof message !== 'object') {
    return null
  }
  const record = message as Record<string, unknown>
  const role = record.role === 'assistant' || record.role === 'model' ? 'assistant' : 'user'
  const text = textFromContent(record.content ?? record.parts)
  if (!text.trim()) {
    return null
  }
  return {
    role,
    content: [
      {
        type: 'input_text',
        text
      }
    ]
  }
}

function applyModelMapping(
  payload: Record<string, unknown>,
  mappings: LocalGatewayModelMapping[]
): void {
  if (!mappings.length) return
  const raw = typeof payload.model === 'string' ? payload.model.trim() : ''
  if (!raw) return
  const hit = mappings.find((entry) => entry.from === raw)
  if (hit) {
    payload.model = hit.to
  }
}

const DEFAULT_RESPONSES_INSTRUCTIONS = 'You are a helpful assistant.'

function chatToResponsesPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const messages = Array.isArray(payload.messages) ? payload.messages : []
  const responsesPayload = { ...payload }
  delete responsesPayload.messages
  delete responsesPayload.max_tokens
  delete responsesPayload.max_completion_tokens
  delete responsesPayload.n
  delete responsesPayload.frequency_penalty
  delete responsesPayload.presence_penalty
  delete responsesPayload.logit_bias
  delete responsesPayload.logprobs
  delete responsesPayload.top_logprobs
  delete responsesPayload.response_format
  delete responsesPayload.seed
  delete responsesPayload.stop
  delete responsesPayload.user
  delete responsesPayload.tools
  delete responsesPayload.tool_choice
  const systemMessages = messages.filter(
    (message) =>
      message && typeof message === 'object' && (message as { role?: unknown }).role === 'system'
  )
  const input = messages
    .filter(
      (message) =>
        !(
          message &&
          typeof message === 'object' &&
          (message as { role?: unknown }).role === 'system'
        )
    )
    .map(toResponsesInputMessage)
    .filter(Boolean)
  const instructions = systemMessages
    .map((message) => textFromContent((message as { content?: unknown }).content))
    .filter((content) => Boolean(content.trim()))
    .join('\n\n')

  return {
    ...responsesPayload,
    input,
    instructions:
      (typeof payload.instructions === 'string' && payload.instructions) ||
      instructions ||
      DEFAULT_RESPONSES_INSTRUCTIONS,
    store: false,
    stream: true
  }
}

function estimateAnthropicTokenCount(payload: Record<string, unknown>): {
  input_tokens: number
} {
  const parts: string[] = []
  const system = payload.system
  if (typeof system === 'string') {
    parts.push(system)
  } else if (system) {
    parts.push(textFromContent(system))
  }
  const messages = Array.isArray(payload.messages) ? payload.messages : []
  for (const message of messages) {
    if (!message || typeof message !== 'object') {
      continue
    }
    const content = (message as Record<string, unknown>).content
    parts.push(textFromContent(content))
  }
  const charCount = parts.reduce((sum, text) => sum + text.length, 0)
  return { input_tokens: Math.max(1, Math.ceil(charCount / 4)) }
}

function anthropicToResponsesPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const messages = Array.isArray(payload.messages) ? payload.messages : []
  const system =
    typeof payload.system === 'string' ? payload.system : textFromContent(payload.system)
  return {
    model: typeof payload.model === 'string' ? payload.model : undefined,
    instructions: system || DEFAULT_RESPONSES_INSTRUCTIONS,
    input: messages.map(toResponsesInputMessage).filter(Boolean),
    store: false,
    stream: true,
    temperature: payload.temperature,
    top_p: payload.top_p
  }
}

function geminiModelFromPath(pathname: string): string | undefined {
  const match = /\/models\/([^/:]+):/.exec(pathname)
  return match?.[1]
}

function logModelFromRequest(pathname: string, body: Record<string, unknown>): string | undefined {
  if (typeof body.model === 'string' && body.model.trim()) {
    return body.model.trim()
  }
  return geminiModelFromPath(pathname)
}

function geminiToResponsesPayload(
  payload: Record<string, unknown>,
  pathname: string
): Record<string, unknown> {
  const contents = Array.isArray(payload.contents) ? payload.contents : []
  const generationConfig =
    payload.generationConfig && typeof payload.generationConfig === 'object'
      ? (payload.generationConfig as Record<string, unknown>)
      : {}
  return {
    model: geminiModelFromPath(pathname),
    instructions: textFromContent(payload.systemInstruction) || DEFAULT_RESPONSES_INSTRUCTIONS,
    input: contents.map(toResponsesInputMessage).filter(Boolean),
    store: false,
    stream: true,
    temperature: generationConfig.temperature,
    top_p: generationConfig.topP
  }
}

async function collectResponsesText(upstream: Response): Promise<string> {
  const chunks: string[] = []
  await streamResponsesTextDeltas(upstream, (delta) => {
    chunks.push(delta)
  })
  return chunks.join('')
}

async function writeSse(response: ServerResponse, payload: unknown, event?: string): Promise<void> {
  if (event) {
    const ok1 = response.write(`event: ${event}\n`)
    if (!ok1) {
      await new Promise<void>((resolve) => response.once('drain', resolve))
    }
  }
  const ok2 = response.write(
    `data: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n\n`
  )
  if (!ok2) {
    await new Promise<void>((resolve) => response.once('drain', resolve))
  }
}

function textDeltaFromResponsesSseBlock(block: string): string {
  const dataLines: string[] = []
  let event = ''
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim()
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart())
    }
  }

  const data = dataLines.join('\n')
  if (!data || data === '[DONE]') {
    return ''
  }

  try {
    const parsed = JSON.parse(data) as Record<string, unknown>
    if (
      (event === 'response.output_text.delta' || event === 'response.text.delta') &&
      typeof parsed.delta === 'string'
    ) {
      return parsed.delta
    }
  } catch {
    return ''
  }
  return ''
}

async function streamResponsesTextDeltas(
  upstream: Response,
  onDelta: (delta: string) => void | Promise<void>
): Promise<void> {
  if (!upstream.body) {
    return
  }

  const reader = upstream.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      buffer += decoder.decode(value, { stream: true })
      let boundary = buffer.indexOf('\n\n')
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary).trim()
        buffer = buffer.slice(boundary + 2)
        const delta = textDeltaFromResponsesSseBlock(block)
        if (delta) {
          await onDelta(delta)
        }
        boundary = buffer.indexOf('\n\n')
      }
    }

    const tail = `${buffer}${decoder.decode()}`
    const delta = textDeltaFromResponsesSseBlock(tail.trim())
    if (delta) {
      await onDelta(delta)
    }
  } finally {
    reader.releaseLock()
  }
}

export class CodexLocalGatewayService {
  private server: Server | null = null
  private lastError = ''
  private requestLogSeq = 0
  private requestLogs: LocalGatewayLogEntry[] = []
  private logsLoaded = false
  private logsLoadTask: Promise<void> | null = null
  private logsPersistTask: Promise<void> | null = null
  private stickyTargets = new Map<string, StickyTarget>()
  private allowedTargetsSignature = ''

  constructor(
    private readonly options: {
      store: CodexAccountStore
      providerStore: CodexProviderStore
      logFilePath: string
      platform: CodexPlatformAdapter
      refreshAuthForUse: (
        accountId: string,
        auth: CodexAuthPayload,
        options?: { skewMs?: number; allowStaleFallback?: boolean }
      ) => Promise<StoredAuthRefreshResult>
      refreshStoredAuthGuarded: (
        accountId: string,
        expectedAuth: CodexAuthPayload
      ) => Promise<StoredAuthRefreshResult>
      openCodexFromService: (
        input?: OpenCodexFromServiceInput
      ) => Promise<OpenCodexFromServiceResult>
    }
  ) {}

  async status(): Promise<LocalGatewayStatus> {
    await this.ensureLogsLoaded()
    const settings = await this.settings()
    const apiKey = this.readStoredApiKey(settings)
    return {
      running: Boolean(this.server?.listening),
      baseUrl: localGatewayBaseUrl(settings),
      apiKeyPreview: maskLocalGatewayApiKey(apiKey),
      lastError: this.lastError || undefined,
      logs: this.requestLogs
    }
  }

  async getPortOccupant(): Promise<PortOccupant | null> {
    const settings = await this.settings()
    return getTcpPortOccupant(settings.port)
  }

  async killPortOccupant(): Promise<PortOccupant | null> {
    const settings = await this.settings()
    const occupant = await getTcpPortOccupant(settings.port)
    if (!occupant) {
      return null
    }

    if (occupant.pid === process.pid && this.server?.listening) {
      await this.stop()
      return occupant
    }

    process.kill(occupant.pid, 'SIGTERM')
    return occupant
  }

  async start(): Promise<LocalGatewayStatus> {
    await this.ensureLogsLoaded()
    const settings = await this.ensureApiKey()
    if (settings.routingMode !== 'provider' && !hasAllowedGatewayTargets(settings)) {
      throw new Error(
        'Local gateway requires at least one allowed group or account before it can start.'
      )
    }
    if (settings.routingMode === 'provider' && !settings.providerId) {
      throw new Error(
        'Provider routing mode requires an explicit providerId in gateway settings.'
      )
    }
    if (this.server?.listening) {
      return this.status()
    }

    this.server = createServer((request, response) => {
      void this.handleRequest(request, response).catch((error) => {
        const message = error instanceof Error ? error.message : 'Local gateway request failed.'
        writeJson(response, 500, openAiError(message, 500).body)
      })
    })

    await new Promise<void>((resolve, reject) => {
      const server = this.server!
      server.once('error', reject)
      server.listen(settings.port, settings.host, () => {
        server.off('error', reject)
        resolve()
      })
    }).catch((error) => {
      this.lastError = error instanceof Error ? error.message : 'Failed to start local gateway.'
      this.server = null
      throw error
    })

    this.lastError = ''
    await this.pushLog({
      method: 'SYSTEM',
      path: 'gateway',
      status: 200,
      durationMs: 0,
      message: `Started ${localGatewayBaseUrl(settings)}`
    })
    return this.status()
  }

  async stop(): Promise<LocalGatewayStatus> {
    await this.ensureLogsLoaded()
    const server = this.server
    this.server = null
    if (server?.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
    await this.pushLog({
      method: 'SYSTEM',
      path: 'gateway',
      status: 200,
      durationMs: 0,
      message: 'Stopped'
    })
    return this.status()
  }

  async rotateKey(): Promise<LocalGatewayStatus & { apiKey: string }> {
    await this.ensureLogsLoaded()
    const settings = await this.settings()
    const apiKey = generateGatewayApiKey()
    await this.options.store.updateSettings({
      localGateway: {
        ...settings,
        apiKey: this.options.platform.protect(apiKey)
      }
    })
    await this.pushLog({
      method: 'SYSTEM',
      path: 'key',
      status: 200,
      durationMs: 0,
      message: 'API key rotated'
    })
    return {
      ...(await this.status()),
      apiKey
    }
  }

  async getApiKey(): Promise<string> {
    const settings = await this.ensureApiKey()
    return this.readStoredApiKey(settings)
  }

  private async settings(): Promise<LocalGatewaySettings> {
    const snapshot = await this.options.store.getSnapshot(false)
    const settings = normalizeLocalGatewaySettings(snapshot.settings.localGateway)
    this.clearStickyWhenAllowedTargetsChange(settings)
    return settings
  }

  private clearStickyWhenAllowedTargetsChange(settings: LocalGatewaySettings): void {
    const signature = JSON.stringify({
      groups: [...settings.allowedGroupIds].sort(),
      accounts: [...settings.allowedAccountIds].sort()
    })

    if (this.allowedTargetsSignature && this.allowedTargetsSignature !== signature) {
      this.stickyTargets.clear()
    }

    this.allowedTargetsSignature = signature
  }

  private async ensureApiKey(): Promise<LocalGatewaySettings> {
    const settings = await this.settings()
    const existingApiKey = this.readStoredApiKey(settings)
    if (existingApiKey) {
      if (typeof settings.apiKey === 'string') {
        const migrated = {
          ...settings,
          apiKey: this.options.platform.protect(existingApiKey)
        }
        await this.options.store.updateSettings({ localGateway: migrated })
        return migrated
      }
      return settings
    }

    const apiKey = generateGatewayApiKey()
    const nextSettings = {
      ...settings,
      apiKey: this.options.platform.protect(apiKey)
    }
    await this.options.store.updateSettings({ localGateway: nextSettings })
    return nextSettings
  }

  private readStoredApiKey(settings: LocalGatewaySettings): string {
    if (!settings.apiKey) {
      return ''
    }

    if (typeof settings.apiKey === 'string') {
      return settings.apiKey
    }

    return this.options.platform.unprotect(settings.apiKey)
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const startedAt = Date.now()
    const logMeta: GatewayLogMeta = {}
    if (url.pathname !== '/health') {
      const captured = installResponseBodyCapture(response)
      logMeta.client = request.headers['user-agent'] || undefined
      logMeta.requestContentType = request.headers['content-type'] || undefined
      response.once('finish', () => {
        const message =
          response.statusCode === 200
            ? undefined
            : logMessageFromResponseBody(captured.text()) ||
              response.statusMessage ||
              `HTTP ${response.statusCode}`
        logMeta.responseContentType =
          (response.getHeader('content-type') as string | undefined) || undefined
        logMeta.responseBytes = captured.bytes() || undefined
        void this.pushLog({
          method: request.method ?? 'GET',
          path: url.pathname,
          status: response.statusCode,
          durationMs: Date.now() - startedAt,
          message,
          ...logMeta
        })
      })
    }

    if (url.pathname === '/health') {
      writeJson(response, 200, await this.status())
      return
    }

    const settings = await this.settings()
    if (
      !this.readStoredApiKey(settings) ||
      extractGatewayToken(request.headers, url) !== this.readStoredApiKey(settings)
    ) {
      writeJson(
        response,
        401,
        openAiError('Unauthorized local gateway request.', 401, 'unauthorized').body
      )
      return
    }

    const body = await readRequestBody(request)
    const jsonBody = parseJsonBody(body)
    logMeta.model = logModelFromRequest(url.pathname, jsonBody)
    logMeta.requestBytes = body.length

    if (settings.routingMode === 'provider') {
      logMeta.provider = 'Provider'
      if (requiresAllowedGatewayTargets(url.pathname)) {
        if (!settings.providerId) {
          writeJson(
            response,
            503,
            openAiError(
              'Provider routing mode requires an explicit providerId in gateway settings.',
              503,
              'no_provider_configured'
            ).body
          )
          return
        }
        const protocol = protocolForPath(url.pathname)
        await this.proxyProviderById(settings.providerId, protocol, request, response, body)
        return
      }
    } else {
      logMeta.provider = 'Codex'
      if (requiresAllowedGatewayTargets(url.pathname) && !hasAllowedGatewayTargets(settings)) {
        writeJson(
          response,
          403,
          openAiError(
            'Local gateway requires at least one allowed group or account before routing requests.',
            403,
            'no_allowed_target'
          ).body
        )
        return
      }
    }

    if (request.method === 'GET' && url.pathname === '/v1/models') {
      writeJson(response, 200, await this.openAiModels())
      return
    }

    if (request.method === 'GET' && url.pathname === '/v1beta/models') {
      writeJson(response, 200, await this.geminiModels())
      return
    }

    if (request.method !== 'POST') {
      writeJson(
        response,
        405,
        openAiError('Unsupported local gateway method.', 405, 'method_not_allowed').body
      )
      return
    }

    if (url.pathname === '/codex/open') {
      writeJson(
        response,
        200,
        await this.options.openCodexFromService(jsonBody as OpenCodexFromServiceInput)
      )
      return
    }

    if (url.pathname === '/v1/responses') {
      await this.handleOpenAiResponses(request, response, body, jsonBody, logMeta)
      return
    }

    if (url.pathname === '/v1/chat/completions') {
      await this.handleChatCompletions(request, response, body, jsonBody, logMeta)
      return
    }

    if (url.pathname === '/v1/messages') {
      await this.handleAnthropicMessages(request, response, jsonBody, logMeta)
      return
    }

    if (url.pathname === '/v1/messages/count_tokens') {
      writeJson(response, 200, estimateAnthropicTokenCount(jsonBody))
      return
    }

    if (url.pathname.startsWith('/v1beta/')) {
      await this.handleGeminiContent(request, response, jsonBody, url.pathname, logMeta)
      return
    }

    writeJson(
      response,
      404,
      openAiError(`Unsupported local gateway path: ${url.pathname}`, 404, 'not_found').body
    )
  }

  private async openAiModels(): Promise<unknown> {
    const snapshot = await this.options.store.getSnapshot(false)
    const providers = await this.options.providerStore.list()
    const allowed = await this.allowedTargetSets()
    const accountHealthByAccountId = snapshot.accountHealthByAccountId ?? {}
    const data = [
      ...snapshot.accounts
        .filter(
          (account) =>
            !isLocalMockAccount(account) &&
            !isAccountHealthBlocking(accountHealthByAccountId[account.id]) &&
            this.matchesAllowedTargets(account, allowed)
        )
        .map((account) => ({
          id: account.email ? `codex:${account.email}` : `codex:${account.id}`,
          object: 'model',
          owned_by: 'codexdock'
        })),
      ...providers.map((provider) => ({
        id: provider.model,
        object: 'model',
        owned_by: provider.protocol ?? 'openai'
      }))
    ]
    return { object: 'list', data }
  }

  private async geminiModels(): Promise<unknown> {
    const snapshot = await this.options.store.getSnapshot(false)
    const providers = await this.options.providerStore.list()
    const allowed = await this.allowedTargetSets()
    const accountHealthByAccountId = snapshot.accountHealthByAccountId ?? {}
    const modelIds = new Set(providers.map((provider) => provider.model))
    if (
      snapshot.accounts.some(
        (account) =>
          !isLocalMockAccount(account) &&
          !isAccountHealthBlocking(accountHealthByAccountId[account.id]) &&
          this.matchesAllowedTargets(account, allowed)
      )
    ) {
      modelIds.add('gpt-5.4')
    }
    return {
      models: [...modelIds].map((model) => ({
        name: model.startsWith('models/') ? model : `models/${model}`,
        displayName: model,
        supportedGenerationMethods: ['generateContent', 'streamGenerateContent']
      }))
    }
  }

  private async handleOpenAiResponses(
    request: IncomingMessage,
    response: ServerResponse,
    body: Buffer,
    jsonBody: Record<string, unknown>,
    logMeta: GatewayLogMeta
  ): Promise<void> {
    const mappings = (await this.settings()).modelMappings
    applyModelMapping(jsonBody, mappings)
    const effectiveBody = mappings.length ? Buffer.from(JSON.stringify(jsonBody)) : body
    try {
      const { upstream, account } = await this.fetchCodexResponses(request, effectiveBody, jsonBody)
      logMeta.target = logTargetFromAccount(account)
      if (upstream.status === 429) {
        const providerName = await this.proxyProviderProtocol('openai', request, response, effectiveBody)
        if (providerName) logMeta.target = providerName
        return
      }
      await writeFetchResponse(response, upstream)
    } catch {
      const providerName = await this.proxyProviderProtocol('openai', request, response, effectiveBody)
      if (providerName) logMeta.target = providerName
    }
  }

  private async handleChatCompletions(
    request: IncomingMessage,
    response: ServerResponse,
    body: Buffer,
    jsonBody: Record<string, unknown>,
    logMeta: GatewayLogMeta
  ): Promise<void> {
    applyModelMapping(jsonBody, (await this.settings()).modelMappings)
    const responsesBody = Buffer.from(JSON.stringify(chatToResponsesPayload(jsonBody)))
    if (jsonBody.stream === true) {
      await this.handleChatCompletionStream(request, response, responsesBody, body, jsonBody, logMeta)
      return
    }

    const result = await this.fetchCodexResponses(request, responsesBody, jsonBody).catch(
      async () => {
        const providerName = await this.proxyProviderProtocol('openai', request, response, body)
        if (providerName) logMeta.target = providerName
        return null
      }
    )
    if (!result) {
      return
    }
    logMeta.target = logTargetFromAccount(result.account)
    if (result.upstream.status === 429) {
      const providerName = await this.proxyProviderProtocol('openai', request, response, body)
      if (providerName) logMeta.target = providerName
      return
    }
    if (!result.upstream.ok) {
      writeJson(
        response,
        result.upstream.status,
        (await result.upstream.json().catch(() => null)) ??
          openAiError('Upstream request failed.', result.upstream.status).body
      )
      return
    }

    const text = await collectResponsesText(result.upstream)
    const model = typeof jsonBody.model === 'string' ? jsonBody.model : 'codex'
    writeJson(response, 200, {
      id: `chatcmpl-cdock-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: text },
          finish_reason: 'stop'
        }
      ]
    })
  }

  private async handleChatCompletionStream(
    request: IncomingMessage,
    response: ServerResponse,
    body: Buffer,
    originalBody: Buffer,
    jsonBody: Record<string, unknown>,
    logMeta: GatewayLogMeta
  ): Promise<void> {
    const result = await this.fetchCodexResponses(request, body, jsonBody).catch(async () => null)
    if (!result) {
      writeJson(
        response,
        503,
        openAiError('No available Codex account for local gateway.', 503, 'no_account').body
      )
      return
    }
    logMeta.target = logTargetFromAccount(result.account)
    if (result.upstream.status === 429) {
      const providerName = await this.proxyProviderProtocol('openai', request, response, originalBody)
      if (providerName) logMeta.target = providerName
      return
    }
    if (!result.upstream.ok) {
      writeJson(
        response,
        result.upstream.status,
        (await result.upstream.json().catch(() => null)) ??
          openAiError('Upstream request failed.', result.upstream.status).body
      )
      return
    }

    const model = typeof jsonBody.model === 'string' ? jsonBody.model : 'codex'
    const id = `chatcmpl-cdock-${Date.now()}`
    const created = Math.floor(Date.now() / 1000)
    response.statusCode = 200
    response.setHeader('content-type', 'text/event-stream; charset=utf-8')
    response.setHeader('cache-control', 'no-cache')
    await writeSse(response, {
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }]
    })
    await streamResponsesTextDeltas(result.upstream, (delta) => {
      writeSse(response, {
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{ index: 0, delta: { content: delta }, finish_reason: null }]
      })
    })
    await writeSse(response, {
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
    })
    await writeSse(response, '[DONE]')
    response.end()
  }

  private async handleAnthropicMessages(
    request: IncomingMessage,
    response: ServerResponse,
    jsonBody: Record<string, unknown>,
    logMeta: GatewayLogMeta
  ): Promise<void> {
    applyModelMapping(jsonBody, (await this.settings()).modelMappings)
    const responsesPayload = anthropicToResponsesPayload(jsonBody)
    const responsesBody = Buffer.from(JSON.stringify(responsesPayload))
    if (jsonBody.stream === true) {
      await this.handleAnthropicMessageStream(request, response, responsesBody, jsonBody, logMeta)
      return
    }

    const result = await this.fetchCodexResponses(request, responsesBody, responsesPayload).catch(
      () => null
    )
    if (!result) {
      writeJson(
        response,
        503,
        openAiError('No available Codex account for local gateway.', 503, 'no_account').body
      )
      return
    }
    logMeta.target = logTargetFromAccount(result.account)
    if (!result.upstream.ok) {
      writeJson(
        response,
        result.upstream.status,
        (await result.upstream.json().catch(() => null)) ??
          openAiError('Upstream request failed.', result.upstream.status).body
      )
      return
    }

    const text = await collectResponsesText(result.upstream)
    const model = typeof jsonBody.model === 'string' ? jsonBody.model : 'codex'
    writeJson(response, 200, {
      id: `msg_cdock_${Date.now()}`,
      type: 'message',
      role: 'assistant',
      model,
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 }
    })
  }

  private async handleAnthropicMessageStream(
    request: IncomingMessage,
    response: ServerResponse,
    body: Buffer,
    jsonBody: Record<string, unknown>,
    logMeta: GatewayLogMeta
  ): Promise<void> {
    const result = await this.fetchCodexResponses(request, body, jsonBody).catch(() => null)
    if (!result) {
      writeJson(
        response,
        503,
        openAiError('No available Codex account for local gateway.', 503, 'no_account').body
      )
      return
    }
    logMeta.target = logTargetFromAccount(result.account)
    if (!result.upstream.ok) {
      writeJson(
        response,
        result.upstream.status,
        (await result.upstream.json().catch(() => null)) ??
          openAiError('Upstream request failed.', result.upstream.status).body
      )
      return
    }

    const model = typeof jsonBody.model === 'string' ? jsonBody.model : 'codex'
    const id = `msg_cdock_${Date.now()}`
    response.statusCode = 200
    response.setHeader('content-type', 'text/event-stream; charset=utf-8')
    response.setHeader('cache-control', 'no-cache')
    await writeSse(
      response,
      {
        type: 'message_start',
        message: {
          id,
          type: 'message',
          role: 'assistant',
          model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 }
        }
      },
      'message_start'
    )
    await writeSse(
      response,
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' }
      },
      'content_block_start'
    )
    await streamResponsesTextDeltas(result.upstream, (delta) => {
      writeSse(
    })
    await writeSse(response, { type: 'content_block_stop', index: 0 }, 'content_block_stop')
    await writeSse(
      response,
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 0 }
      },
      'message_delta'
    )
    await writeSse(response, { type: 'message_stop' }, 'message_stop')
    response.end()
  }

  private async handleGeminiContent(
    request: IncomingMessage,
    response: ServerResponse,
    jsonBody: Record<string, unknown>,
    pathname: string,
    logMeta: GatewayLogMeta
  ): Promise<void> {
    const mappings = (await this.settings()).modelMappings
    const modelFromPath = geminiModelFromPath(pathname)
    if (modelFromPath) {
      jsonBody.model = modelFromPath
      applyModelMapping(jsonBody, mappings)
      const mapped = typeof jsonBody.model === 'string' ? jsonBody.model : modelFromPath
      if (mapped !== modelFromPath) {
        pathname = pathname.replace(`/models/${modelFromPath}:`, `/models/${mapped}:`)
      }
    }
    const responsesPayload = geminiToResponsesPayload(jsonBody, pathname)
    const responsesBody = Buffer.from(JSON.stringify(responsesPayload))
    if (pathname.includes(':streamGenerateContent')) {
      await this.handleGeminiContentStream(request, response, responsesBody, responsesPayload, logMeta)
      return
    }

    const result = await this.fetchCodexResponses(request, responsesBody, responsesPayload).catch(
      () => null
    )
    if (!result) {
      writeJson(
        response,
        503,
        openAiError('No available Codex account for local gateway.', 503, 'no_account').body
      )
      return
    }
    logMeta.target = logTargetFromAccount(result.account)
    if (!result.upstream.ok) {
      writeJson(
        response,
        result.upstream.status,
        (await result.upstream.json().catch(() => null)) ??
          openAiError('Upstream request failed.', result.upstream.status).body
      )
      return
    }

    const text = await collectResponsesText(result.upstream)
    const model = geminiModelFromPath(pathname) ?? 'codex'
    writeJson(response, 200, {
      candidates: [
        {
          content: { role: 'model', parts: [{ text }] },
          finishReason: 'STOP',
          index: 0
        }
      ],
      modelVersion: model
    })
  }

  private async handleGeminiContentStream(
    request: IncomingMessage,
    response: ServerResponse,
    body: Buffer,
    jsonBody: Record<string, unknown>,
    logMeta: GatewayLogMeta
  ): Promise<void> {
    const result = await this.fetchCodexResponses(request, body, jsonBody).catch(() => null)
    if (!result) {
      writeJson(
        response,
        503,
        openAiError('No available Codex account for local gateway.', 503, 'no_account').body
      )
      return
    }
    logMeta.target = logTargetFromAccount(result.account)
    if (!result.upstream.ok) {
      writeJson(
        response,
        result.upstream.status,
        (await result.upstream.json().catch(() => null)) ??
          openAiError('Upstream request failed.', result.upstream.status).body
      )
      return
    }

    response.statusCode = 200
    response.setHeader('content-type', 'text/event-stream; charset=utf-8')
    response.setHeader('cache-control', 'no-cache')
    await streamResponsesTextDeltas(result.upstream, (delta) => {
      writeSse(response, {
    })
    response.end()
  }

  private async fetchCodexResponses(
    request: IncomingMessage,
    body: Buffer,
    jsonBody: Record<string, unknown>
  ): Promise<{ upstream: Response; account: AccountSummary }> {
    const stickyKey = stickyKeyFromRequest(request.headers, jsonBody)
    const attemptedAccountIds = new Set<string>()

    while (true) {
      const account = await this.selectAccountForCodexRequest(stickyKey, attemptedAccountIds)
      if (!account) {
        throw new Error('No available Codex account for local gateway.')
      }

      attemptedAccountIds.add(account.id)
      const attempt = await this.fetchCodexWithAccountAndRefresh(account, request, body)
      if (!attempt.upstream) {
        continue
      }

      if (isGatewayAuthFailureStatus(attempt.upstream.status)) {
        await this.markGatewayAccountAuthError(
          attempt.account.id,
          await authFailureReasonFromResponse(attempt.upstream),
          attempt.upstream.status
        )
        if (stickyKey) {
          this.evictSticky(stickyKey)
        }
        continue
      }

      if (stickyKey && attempt.upstream.ok) {
        this.rememberSticky(stickyKey, {
          kind: 'account',
          id: attempt.account.id,
          protocol: 'openai',
          expiresAt: this.stickyExpiresAt()
        })
      }
      return { upstream: attempt.upstream, account: attempt.account }
    }
  }

  private async selectAccountForCodexRequest(
    stickyKey: string | null,
    excludedAccountIds: Set<string>
  ): Promise<AccountSummary | null> {
    if (stickyKey) {
      const sticky = this.resolveSticky(stickyKey, 'openai')
      if (sticky?.kind === 'account') {
        if (excludedAccountIds.has(sticky.id)) {
          this.evictSticky(stickyKey)
        } else {
          const stickyAccount = await this.accountById(sticky.id)
          if (stickyAccount) {
            return stickyAccount
          }
          this.evictSticky(stickyKey)
        }
      }
    }

    return this.bestAccount(excludedAccountIds)
  }

  private async fetchCodexWithAccountAndRefresh(
    account: AccountSummary,
    request: IncomingMessage,
    body: Buffer
  ): Promise<{ account: AccountSummary; upstream: Response | null }> {
    let upstream: Response
    try {
      upstream = await this.fetchCodexWithAccount(account, request, body)
    } catch (error) {
      if (shouldMarkAccountAuthError(error)) {
        await this.markGatewayAccountAuthError(
          account.id,
          errorMessage(error, 'Selected Codex account failed before upstream request.')
        )
        return { account, upstream: null }
      }
      throw error
    }

    if (!isGatewayAuthFailureStatus(upstream.status)) {
      return { account, upstream }
    }

    let refreshed: StoredAuthRefreshResult
    try {
      const auth = await this.options.store.getStoredAuthPayload(account.id)
      refreshed = await this.options.refreshStoredAuthGuarded(account.id, auth)
    } catch (error) {
      if (shouldMarkAccountAuthError(error)) {
        await this.markGatewayAccountAuthError(
          account.id,
          errorMessage(error, 'Failed to refresh selected Codex account.'),
          upstream.status
        )
        return { account, upstream: null }
      }
      throw error
    }

    const retryAccount = await this.accountById(refreshed.accountId)
    if (!retryAccount) {
      this.evictStickyForAccount(account.id)
      return { account, upstream: null }
    }

    try {
      return {
        account: retryAccount,
        upstream: await this.fetchCodexWithAccount(retryAccount, request, body)
      }
    } catch (error) {
      if (shouldMarkAccountAuthError(error)) {
        await this.markGatewayAccountAuthError(
          retryAccount.id,
          errorMessage(error, 'Selected Codex account failed after refresh.'),
          upstream.status
        )
        return { account: retryAccount, upstream: null }
      }
      throw error
    }
  }

  private async fetchCodexWithAccount(
    account: AccountSummary,
    request: IncomingMessage,
    body: Buffer
  ): Promise<Response> {
    const prepared = await this.prepareAuth(account.id)
    const chatgptAccountId = resolveChatGptAccountIdFromTokens(
      prepared.auth.tokens?.id_token,
      prepared.auth.tokens?.access_token,
      prepared.auth.tokens?.account_id
    )
    const accessToken = prepared.auth.tokens?.access_token
    if (!accessToken || !chatgptAccountId) {
      throw new Error('Selected Codex account is missing access token or ChatGPT account id.')
    }

    const settings = await this.settings()
    return this.options.platform.fetch(resolveCodexResponsesUrl(), {
      method: 'POST',
      headers: {
        ...filteredRequestHeaders(request.headers),
        authorization: `Bearer ${accessToken}`,
        'chatgpt-account-id': chatgptAccountId,
        originator: 'codex_cli_rs',
        'user-agent': 'codexdock-local-gateway',
        'content-type': 'application/json'
      },
      body: body.toString('utf8'),
      signal: AbortSignal.timeout(settings.requestTimeoutMs)
    })
  }

  private async prepareAuth(accountId: string): Promise<StoredAuthRefreshResult> {
    const auth = await this.options.store.getStoredAuthPayload(accountId)
    return this.options.refreshAuthForUse(accountId, auth, { allowStaleFallback: true })
  }

  private async proxyProviderById(
    providerId: string,
    protocol: CustomProviderProtocol,
    request: IncomingMessage,
    response: ServerResponse,
    body: Buffer
  ): Promise<string | undefined> {
    const bodyJson = parseJsonBody(body)
    const stickyKey = stickyKeyFromRequest(request.headers, bodyJson)
    const sticky = stickyKey ? this.resolveSticky(stickyKey, protocol) : null
    const provider =
      sticky?.kind === 'provider'
        ? await this.providerById(sticky.id, protocol)
        : await this.firstProvider(protocol)

    if (!provider) {
      writeJson(
        response,
        503,
        openAiError(
          `Selected provider "${providerId}" not found or does not match protocol "${protocol}".`,
          503,
          'provider_not_found'
        ).body
      )
      return undefined
    }

    const resolved = await this.options.providerStore.getResolvedProvider(provider.id)
    const requestPath = new URL(request.url ?? '/', 'http://localhost').pathname
    const upstream = await this.options.platform.fetch(
      joinUpstreamUrl(provider.baseUrl, requestPath),
      {
        method: request.method,
        headers: buildProviderHeaders(protocol, resolved.apiKey, request.headers),
        body: body.toString('utf8'),
        signal: AbortSignal.timeout((await this.settings()).requestTimeoutMs)
      }
    )
    await writeFetchResponse(response, upstream)
    return provider.name || provider.id
  }

  private async bestAccount(excludedAccountIds = new Set<string>()): Promise<AccountSummary | null> {
    const snapshot = await this.options.store.getSnapshot(false)
    const accountHealthByAccountId = snapshot.accountHealthByAccountId ?? {}
    this.evictStickyForUnhealthyAccounts(accountHealthByAccountId)
    const allowed = await this.allowedTargetSets()
    const accounts = snapshot.accounts.filter(
      (account) =>
        !excludedAccountIds.has(account.id) &&
        !isLocalMockAccount(account) &&
        !isAccountHealthBlocking(accountHealthByAccountId[account.id]) &&
        this.matchesAllowedTargets(account, allowed)
    )
    return resolveBestAccount(
      accounts,
      snapshot.usageByAccountId,
      snapshot.activeAccountId,
      accountHealthByAccountId
    )
  }

  private async accountById(accountId: string): Promise<AccountSummary | null> {
    const snapshot = await this.options.store.getSnapshot(false)
    const accountHealthByAccountId = snapshot.accountHealthByAccountId ?? {}
    this.evictStickyForUnhealthyAccounts(accountHealthByAccountId)
    const allowed = await this.allowedTargetSets()
    return (
      snapshot.accounts.find(
        (account) =>
          account.id === accountId &&
          !isLocalMockAccount(account) &&
          !isAccountHealthBlocking(accountHealthByAccountId[account.id]) &&
          this.matchesAllowedTargets(account, allowed)
      ) ?? null
    )
  }

  private async allowedTargetSets(): Promise<{
    groupIds: Set<string>
    accountIds: Set<string>
  } | null> {
    const settings = await this.settings()
    if (!settings.allowedGroupIds.length && !settings.allowedAccountIds.length) {
      return null
    }
    return {
      groupIds: new Set(settings.allowedGroupIds),
      accountIds: new Set(settings.allowedAccountIds)
    }
  }

  private matchesAllowedTargets(
    account: AccountSummary,
    allowed: { groupIds: Set<string>; accountIds: Set<string> } | null
  ): boolean {
    if (!allowed) {
      return false
    }
    return (
      (account.groupIds.length === 0 && allowed.accountIds.has(account.id)) ||
      account.groupIds.some((groupId) => allowed.groupIds.has(groupId))
    )
  }

  private async providerById(
    providerId: string,
    protocol: CustomProviderProtocol
  ): Promise<CustomProviderSummary | null> {
    return (
      (await this.options.providerStore.list()).find(
        (provider) => provider.id === providerId && (provider.protocol ?? 'openai') === protocol
      ) ?? null
    )
  }

  private stickyExpiresAt(): number {
    return Date.now() + normalizeLocalGatewaySettings().stickyTtlMinutes * 60_000
  }

  private resolveSticky(key: string, protocol: CustomProviderProtocol): StickyTarget | null {
    const target = this.stickyTargets.get(key)
    if (!target || target.protocol !== protocol || target.expiresAt <= Date.now()) {
      if (target) {
        this.stickyTargets.delete(key)
      }
      return null
    }
    return target
  }

  private rememberSticky(key: string, target: StickyTarget): void {
    this.stickyTargets.set(key, target)
  }

  private evictSticky(key: string): void {
    this.stickyTargets.delete(key)
  }

  private evictStickyForAccount(accountId: string): void {
    for (const [key, target] of this.stickyTargets.entries()) {
      if (target.kind === 'account' && target.id === accountId) {
        this.stickyTargets.delete(key)
      }
    }
  }

  private evictStickyForUnhealthyAccounts(
    accountHealthByAccountId: Record<string, { status?: string }>
  ): void {
    const unhealthyAccountIds = new Set(
      Object.entries(accountHealthByAccountId)
        .filter(([, health]) => health.status === 'auth_error')
        .map(([accountId]) => accountId)
    )
    if (!unhealthyAccountIds.size) {
      return
    }

    for (const [key, target] of this.stickyTargets.entries()) {
      if (target.kind === 'account' && unhealthyAccountIds.has(target.id)) {
        this.stickyTargets.delete(key)
      }
    }
  }

  private async markGatewayAccountAuthError(
    accountId: string,
    reason: string,
    httpStatus?: number
  ): Promise<void> {
    await this.options.store.markAccountAuthError(accountId, reason, 'gateway', httpStatus)
    this.evictStickyForAccount(accountId)
    await this.pushLog({
      method: 'SYSTEM',
      path: 'account-health',
      status: httpStatus ?? 200,
      durationMs: 0,
      message: `Marked account ${accountId} as auth_error: ${truncateLogMessage(reason, 320)}`
    })
  }

  private async ensureLogsLoaded(): Promise<void> {
    if (this.logsLoaded) {
      return
    }

    this.logsLoadTask ??= this.loadLogs().finally(() => {
      this.logsLoadTask = null
      this.logsLoaded = true
    })
    await this.logsLoadTask
  }

  private async loadLogs(): Promise<void> {
    try {
      const raw = await fs.readFile(this.options.logFilePath, 'utf8')
      const parsed = JSON.parse(raw) as { logs?: unknown } | unknown[]
      const entries = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { logs?: unknown }).logs)
          ? (parsed as { logs: unknown[] }).logs
          : []

      this.requestLogs = entries
        .map((entry) => this.normalizePersistedLog(entry))
        .filter((entry): entry is LocalGatewayLogEntry => Boolean(entry))
        .slice(0, 80)
      this.requestLogSeq = this.requestLogs.length
    } catch {
      this.requestLogs = []
      this.requestLogSeq = 0
    }
  }

  private normalizePersistedLog(entry: unknown): LocalGatewayLogEntry | null {
    if (!entry || typeof entry !== 'object') {
      return null
    }

    const record = entry as Record<string, unknown>
    if (
      typeof record.id !== 'string' ||
      typeof record.timestamp !== 'string' ||
      typeof record.method !== 'string' ||
      typeof record.path !== 'string' ||
      typeof record.status !== 'number' ||
      typeof record.durationMs !== 'number'
    ) {
      return null
    }

    return {
      id: record.id,
      timestamp: record.timestamp,
      method: record.method,
      path: record.path,
      status: record.status,
      durationMs: record.durationMs,
      provider: typeof record.provider === 'string' ? record.provider : undefined,
      model: typeof record.model === 'string' ? record.model : undefined,
      tokens: typeof record.tokens === 'number' ? record.tokens : undefined,
      message: typeof record.message === 'string' ? record.message : undefined,
      target: typeof record.target === 'string' ? record.target : undefined,
      client: typeof record.client === 'string' ? record.client : undefined,
      requestBytes: typeof record.requestBytes === 'number' ? record.requestBytes : undefined,
      responseBytes: typeof record.responseBytes === 'number' ? record.responseBytes : undefined,
      requestContentType:
        typeof record.requestContentType === 'string' ? record.requestContentType : undefined,
      responseContentType:
        typeof record.responseContentType === 'string' ? record.responseContentType : undefined
    }
  }

  private persistLogs(): Promise<void> {
    this.logsPersistTask = (this.logsPersistTask ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        await fs.mkdir(dirname(this.options.logFilePath), { recursive: true })
        await fs.writeFile(
          this.options.logFilePath,
          `${JSON.stringify({ version: 1, logs: this.requestLogs }, null, 2)}\n`,
          'utf8'
        )
      })
    return this.logsPersistTask
  }

  private pushLog(input: Omit<LocalGatewayLogEntry, 'id' | 'timestamp'>): Promise<void> {
    const entry: LocalGatewayLogEntry = {
      id: `gw-${Date.now()}-${this.requestLogSeq++}`,
      timestamp: new Date().toISOString(),
      ...input
    }
    this.requestLogs = [entry, ...this.requestLogs].slice(0, 80)
    return this.persistLogs()
  }
}
