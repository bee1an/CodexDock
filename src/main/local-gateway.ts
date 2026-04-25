import { randomBytes } from 'node:crypto'
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from 'node:http'

import type { CodexAuthPayload } from './codex-auth'
import type { CodexAccountStore } from './codex-account-store'
import type { CodexProviderStore } from './codex-providers'
import type { StoredAuthRefreshResult } from './codex-services-shared'
import {
  isLocalMockAccount,
  localGatewayBaseUrl,
  maskLocalGatewayApiKey,
  normalizeLocalGatewaySettings,
  resolveBestAccount,
  type AccountSummary,
  type CustomProviderProtocol,
  type CustomProviderSummary,
  type LocalGatewayLogEntry,
  type LocalGatewaySettings,
  type LocalGatewayStatus
} from '../shared/codex'
import type { CodexPlatformAdapter } from '../shared/codex-platform'
import { resolveChatGptAccountIdFromTokens } from '../shared/openai-auth'

type StickyTarget =
  | { kind: 'account'; id: string; protocol: 'openai'; expiresAt: number }
  | { kind: 'provider'; id: string; protocol: CustomProviderProtocol; expiresAt: number }

const DEFAULT_CHATGPT_BASE_URL = 'https://chatgpt.com/backend-api'
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
      response.write(Buffer.from(value))
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

function extractResponseText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return ''
  }
  const record = payload as Record<string, unknown>
  if (typeof record.output_text === 'string') {
    return record.output_text
  }
  const output = Array.isArray(record.output) ? record.output : []
  const chunks: string[] = []
  for (const item of output) {
    if (!item || typeof item !== 'object') {
      continue
    }
    const content = Array.isArray((item as Record<string, unknown>).content)
      ? ((item as Record<string, unknown>).content as unknown[])
      : []
    for (const part of content) {
      if (
        part &&
        typeof part === 'object' &&
        typeof (part as Record<string, unknown>).text === 'string'
      ) {
        chunks.push((part as Record<string, string>).text)
      }
    }
  }
  return chunks.join('')
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

function chatToResponsesPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const messages = Array.isArray(payload.messages) ? payload.messages : []
  const responsesPayload = { ...payload }
  delete responsesPayload.messages
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
      typeof payload.instructions === 'string' ? payload.instructions : instructions || undefined
  }
}

function anthropicToResponsesPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const messages = Array.isArray(payload.messages) ? payload.messages : []
  const system =
    typeof payload.system === 'string' ? payload.system : textFromContent(payload.system)
  const maxTokens =
    typeof payload.max_tokens === 'number' ? { max_output_tokens: payload.max_tokens } : {}
  return {
    model: typeof payload.model === 'string' ? payload.model : undefined,
    instructions: system || undefined,
    input: messages.map(toResponsesInputMessage).filter(Boolean),
    stream: payload.stream === true,
    temperature: payload.temperature,
    top_p: payload.top_p,
    ...maxTokens
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
  const maxTokens =
    typeof generationConfig.maxOutputTokens === 'number'
      ? { max_output_tokens: generationConfig.maxOutputTokens }
      : {}
  return {
    model: geminiModelFromPath(pathname),
    instructions: textFromContent(payload.systemInstruction) || undefined,
    input: contents.map(toResponsesInputMessage).filter(Boolean),
    stream: pathname.includes(':streamGenerateContent'),
    temperature: generationConfig.temperature,
    top_p: generationConfig.topP,
    ...maxTokens
  }
}

function responsesToChatCompletion(payload: unknown, model: string): unknown {
  const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
  const id = typeof record.id === 'string' ? record.id : `chatcmpl-cdock-${Date.now()}`
  const created =
    typeof record.created_at === 'number' ? record.created_at : Math.floor(Date.now() / 1000)
  const text = extractResponseText(payload)
  const usage =
    record.usage && typeof record.usage === 'object'
      ? {
          prompt_tokens: (record.usage as Record<string, unknown>).input_tokens ?? 0,
          completion_tokens: (record.usage as Record<string, unknown>).output_tokens ?? 0,
          total_tokens: (record.usage as Record<string, unknown>).total_tokens ?? 0
        }
      : undefined

  return {
    id,
    object: 'chat.completion',
    created,
    model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: text
        },
        finish_reason: 'stop'
      }
    ],
    usage
  }
}

function responsesToAnthropicMessage(payload: unknown, model: string): unknown {
  const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
  const usage =
    record.usage && typeof record.usage === 'object'
      ? {
          input_tokens: (record.usage as Record<string, unknown>).input_tokens ?? 0,
          output_tokens: (record.usage as Record<string, unknown>).output_tokens ?? 0
        }
      : { input_tokens: 0, output_tokens: 0 }

  return {
    id: typeof record.id === 'string' ? record.id : `msg_cdock_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    model,
    content: [
      {
        type: 'text',
        text: extractResponseText(payload)
      }
    ],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage
  }
}

function responsesToGeminiContent(payload: unknown, model: string): unknown {
  const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
  const usage =
    record.usage && typeof record.usage === 'object'
      ? (record.usage as Record<string, unknown>)
      : {}
  return {
    candidates: [
      {
        content: {
          role: 'model',
          parts: [
            {
              text: extractResponseText(payload)
            }
          ]
        },
        finishReason: 'STOP',
        index: 0
      }
    ],
    usageMetadata: {
      promptTokenCount: usage.input_tokens ?? 0,
      candidatesTokenCount: usage.output_tokens ?? 0,
      totalTokenCount: usage.total_tokens ?? 0
    },
    modelVersion: model
  }
}

function writeSse(response: ServerResponse, payload: unknown, event?: string): void {
  if (event) {
    response.write(`event: ${event}\n`)
  }
  response.write(`data: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n\n`)
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
      (event === 'response.output_text.delta' || event === 'response.text.delta' || !event) &&
      typeof parsed.delta === 'string'
    ) {
      return parsed.delta
    }
    if (typeof parsed.text === 'string') {
      return parsed.text
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
  private stickyTargets = new Map<string, StickyTarget>()

  constructor(
    private readonly options: {
      store: CodexAccountStore
      providerStore: CodexProviderStore
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
    }
  ) {}

  async status(): Promise<LocalGatewayStatus> {
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

  async start(): Promise<LocalGatewayStatus> {
    const settings = await this.ensureApiKey()
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
    this.pushLog({
      method: 'SYSTEM',
      path: 'gateway',
      status: 200,
      durationMs: 0,
      message: `Started ${localGatewayBaseUrl(settings)}`
    })
    return this.status()
  }

  async stop(): Promise<LocalGatewayStatus> {
    const server = this.server
    this.server = null
    if (server?.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
    this.pushLog({
      method: 'SYSTEM',
      path: 'gateway',
      status: 200,
      durationMs: 0,
      message: 'Stopped'
    })
    return this.status()
  }

  async rotateKey(): Promise<LocalGatewayStatus & { apiKey: string }> {
    const settings = await this.settings()
    const apiKey = generateGatewayApiKey()
    await this.options.store.updateSettings({
      localGateway: {
        ...settings,
        apiKey: this.options.platform.protect(apiKey)
      }
    })
    this.pushLog({
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

  private async settings(): Promise<LocalGatewaySettings> {
    const snapshot = await this.options.store.getSnapshot(false)
    return normalizeLocalGatewaySettings(snapshot.settings.localGateway)
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
    const logMeta: Pick<LocalGatewayLogEntry, 'provider' | 'model' | 'tokens'> = {}
    if (url.pathname !== '/health') {
      response.once('finish', () => {
        this.pushLog({
          method: request.method ?? 'GET',
          path: url.pathname,
          status: response.statusCode,
          durationMs: Date.now() - startedAt,
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
    logMeta.provider = 'Codex'
    logMeta.model = logModelFromRequest(url.pathname, jsonBody)

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

    if (url.pathname === '/v1/responses') {
      await this.handleOpenAiResponses(request, response, body, jsonBody)
      return
    }

    if (url.pathname === '/v1/chat/completions') {
      await this.handleChatCompletions(request, response, body, jsonBody)
      return
    }

    if (url.pathname === '/v1/messages') {
      await this.handleAnthropicMessages(request, response, jsonBody)
      return
    }

    if (url.pathname.startsWith('/v1beta/')) {
      await this.handleGeminiContent(request, response, jsonBody, url.pathname)
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
    const data = [
      ...snapshot.accounts
        .filter((account) => !isLocalMockAccount(account))
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
    const modelIds = new Set(providers.map((provider) => provider.model))
    if (snapshot.accounts.some((account) => !isLocalMockAccount(account))) {
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
    jsonBody: Record<string, unknown>
  ): Promise<void> {
    try {
      const upstream = await this.fetchCodexResponses(request, body, jsonBody)
      if (upstream.status === 429) {
        await this.proxyProviderProtocol('openai', request, response, body)
        return
      }
      await writeFetchResponse(response, upstream)
    } catch {
      await this.proxyProviderProtocol('openai', request, response, body)
    }
  }

  private async handleChatCompletions(
    request: IncomingMessage,
    response: ServerResponse,
    body: Buffer,
    jsonBody: Record<string, unknown>
  ): Promise<void> {
    const responsesBody = Buffer.from(JSON.stringify(chatToResponsesPayload(jsonBody)))
    if (jsonBody.stream === true) {
      await this.handleChatCompletionStream(request, response, responsesBody, body, jsonBody)
      return
    }

    const upstream = await this.fetchCodexResponses(request, responsesBody, jsonBody).catch(
      async () => {
        await this.proxyProviderProtocol('openai', request, response, body)
        return null
      }
    )
    if (!upstream) {
      return
    }
    if (upstream.status === 429) {
      await this.proxyProviderProtocol('openai', request, response, body)
      return
    }
    const upstreamPayload = await upstream.json().catch(() => null)
    if (!upstream.ok) {
      writeJson(
        response,
        upstream.status,
        upstreamPayload ?? openAiError('Upstream request failed.', upstream.status).body
      )
      return
    }

    writeJson(
      response,
      200,
      responsesToChatCompletion(
        upstreamPayload,
        typeof jsonBody.model === 'string' ? jsonBody.model : 'codex'
      )
    )
  }

  private async handleChatCompletionStream(
    request: IncomingMessage,
    response: ServerResponse,
    body: Buffer,
    originalBody: Buffer,
    jsonBody: Record<string, unknown>
  ): Promise<void> {
    const upstream = await this.fetchCodexResponses(request, body, jsonBody).catch(async () => null)
    if (!upstream) {
      writeJson(
        response,
        503,
        openAiError('No available Codex account for local gateway.', 503, 'no_account').body
      )
      return
    }
    if (upstream.status === 429) {
      await this.proxyProviderProtocol('openai', request, response, originalBody)
      return
    }
    if (!upstream.ok) {
      writeJson(
        response,
        upstream.status,
        (await upstream.json().catch(() => null)) ??
          openAiError('Upstream request failed.', upstream.status).body
      )
      return
    }

    const model = typeof jsonBody.model === 'string' ? jsonBody.model : 'codex'
    const id = `chatcmpl-cdock-${Date.now()}`
    const created = Math.floor(Date.now() / 1000)
    response.statusCode = 200
    response.setHeader('content-type', 'text/event-stream; charset=utf-8')
    response.setHeader('cache-control', 'no-cache')
    writeSse(response, {
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }]
    })
    await streamResponsesTextDeltas(upstream, (delta) => {
      writeSse(response, {
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{ index: 0, delta: { content: delta }, finish_reason: null }]
      })
    })
    writeSse(response, {
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
    })
    writeSse(response, '[DONE]')
    response.end()
  }

  private async handleAnthropicMessages(
    request: IncomingMessage,
    response: ServerResponse,
    jsonBody: Record<string, unknown>
  ): Promise<void> {
    const responsesPayload = anthropicToResponsesPayload(jsonBody)
    const responsesBody = Buffer.from(JSON.stringify(responsesPayload))
    if (jsonBody.stream === true) {
      await this.handleAnthropicMessageStream(request, response, responsesBody, jsonBody)
      return
    }

    const upstream = await this.fetchCodexResponses(request, responsesBody, responsesPayload).catch(
      () => null
    )
    if (!upstream) {
      writeJson(
        response,
        503,
        openAiError('No available Codex account for local gateway.', 503, 'no_account').body
      )
      return
    }
    const upstreamPayload = await upstream.json().catch(() => null)
    if (!upstream.ok) {
      writeJson(
        response,
        upstream.status,
        upstreamPayload ?? openAiError('Upstream request failed.', upstream.status).body
      )
      return
    }
    writeJson(
      response,
      200,
      responsesToAnthropicMessage(
        upstreamPayload,
        typeof jsonBody.model === 'string' ? jsonBody.model : 'codex'
      )
    )
  }

  private async handleAnthropicMessageStream(
    request: IncomingMessage,
    response: ServerResponse,
    body: Buffer,
    jsonBody: Record<string, unknown>
  ): Promise<void> {
    const upstream = await this.fetchCodexResponses(request, body, jsonBody).catch(() => null)
    if (!upstream) {
      writeJson(
        response,
        503,
        openAiError('No available Codex account for local gateway.', 503, 'no_account').body
      )
      return
    }
    if (!upstream.ok) {
      writeJson(
        response,
        upstream.status,
        (await upstream.json().catch(() => null)) ??
          openAiError('Upstream request failed.', upstream.status).body
      )
      return
    }

    const model = typeof jsonBody.model === 'string' ? jsonBody.model : 'codex'
    const id = `msg_cdock_${Date.now()}`
    response.statusCode = 200
    response.setHeader('content-type', 'text/event-stream; charset=utf-8')
    response.setHeader('cache-control', 'no-cache')
    writeSse(
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
    writeSse(
      response,
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' }
      },
      'content_block_start'
    )
    await streamResponsesTextDeltas(upstream, (delta) => {
      writeSse(
        response,
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: delta }
        },
        'content_block_delta'
      )
    })
    writeSse(response, { type: 'content_block_stop', index: 0 }, 'content_block_stop')
    writeSse(
      response,
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 0 }
      },
      'message_delta'
    )
    writeSse(response, { type: 'message_stop' }, 'message_stop')
    response.end()
  }

  private async handleGeminiContent(
    request: IncomingMessage,
    response: ServerResponse,
    jsonBody: Record<string, unknown>,
    pathname: string
  ): Promise<void> {
    const responsesPayload = geminiToResponsesPayload(jsonBody, pathname)
    const responsesBody = Buffer.from(JSON.stringify(responsesPayload))
    if (pathname.includes(':streamGenerateContent')) {
      await this.handleGeminiContentStream(request, response, responsesBody, responsesPayload)
      return
    }

    const upstream = await this.fetchCodexResponses(request, responsesBody, responsesPayload).catch(
      () => null
    )
    if (!upstream) {
      writeJson(
        response,
        503,
        openAiError('No available Codex account for local gateway.', 503, 'no_account').body
      )
      return
    }
    const upstreamPayload = await upstream.json().catch(() => null)
    if (!upstream.ok) {
      writeJson(
        response,
        upstream.status,
        upstreamPayload ?? openAiError('Upstream request failed.', upstream.status).body
      )
      return
    }
    writeJson(
      response,
      200,
      responsesToGeminiContent(upstreamPayload, geminiModelFromPath(pathname) ?? 'codex')
    )
  }

  private async handleGeminiContentStream(
    request: IncomingMessage,
    response: ServerResponse,
    body: Buffer,
    jsonBody: Record<string, unknown>
  ): Promise<void> {
    const upstream = await this.fetchCodexResponses(request, body, jsonBody).catch(() => null)
    if (!upstream) {
      writeJson(
        response,
        503,
        openAiError('No available Codex account for local gateway.', 503, 'no_account').body
      )
      return
    }
    if (!upstream.ok) {
      writeJson(
        response,
        upstream.status,
        (await upstream.json().catch(() => null)) ??
          openAiError('Upstream request failed.', upstream.status).body
      )
      return
    }

    response.statusCode = 200
    response.setHeader('content-type', 'text/event-stream; charset=utf-8')
    response.setHeader('cache-control', 'no-cache')
    await streamResponsesTextDeltas(upstream, (delta) => {
      writeSse(response, {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: delta }]
            },
            index: 0
          }
        ]
      })
    })
    response.end()
  }

  private async fetchCodexResponses(
    request: IncomingMessage,
    body: Buffer,
    jsonBody: Record<string, unknown>
  ): Promise<Response> {
    const stickyKey = stickyKeyFromRequest(request.headers, jsonBody)
    const sticky = stickyKey ? this.resolveSticky(stickyKey, 'openai') : null
    const account =
      sticky?.kind === 'account' ? await this.accountById(sticky.id) : await this.bestAccount()
    if (!account) {
      throw new Error('No available Codex account for local gateway.')
    }

    const upstream = await this.fetchCodexWithAccount(account, request, body)
    if ((upstream.status === 401 || upstream.status === 403) && account.id) {
      const auth = await this.options.store.getStoredAuthPayload(account.id)
      await this.options.refreshStoredAuthGuarded(account.id, auth)
      return this.fetchCodexWithAccount(account, request, body)
    }

    if (stickyKey && upstream.ok) {
      this.rememberSticky(stickyKey, {
        kind: 'account',
        id: account.id,
        protocol: 'openai',
        expiresAt: this.stickyExpiresAt()
      })
    }
    return upstream
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

  private async proxyProviderProtocol(
    protocol: CustomProviderProtocol,
    request: IncomingMessage,
    response: ServerResponse,
    body: Buffer
  ): Promise<void> {
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
        openAiError(`No ${protocol} provider configured for local gateway.`, 503, 'no_provider')
          .body
      )
      return
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
    if (stickyKey && upstream.ok) {
      this.rememberSticky(stickyKey, {
        kind: 'provider',
        id: provider.id,
        protocol,
        expiresAt: this.stickyExpiresAt()
      })
    }
    await writeFetchResponse(response, upstream)
  }

  private async bestAccount(): Promise<AccountSummary | null> {
    const snapshot = await this.options.store.getSnapshot(false)
    const accounts = snapshot.accounts.filter((account) => !isLocalMockAccount(account))
    return resolveBestAccount(accounts, snapshot.usageByAccountId, snapshot.activeAccountId)
  }

  private async accountById(accountId: string): Promise<AccountSummary | null> {
    const snapshot = await this.options.store.getSnapshot(false)
    return (
      snapshot.accounts.find(
        (account) => account.id === accountId && !isLocalMockAccount(account)
      ) ?? null
    )
  }

  private async firstProvider(
    protocol: CustomProviderProtocol
  ): Promise<CustomProviderSummary | null> {
    return (
      (await this.options.providerStore.list()).find(
        (provider) => (provider.protocol ?? 'openai') === protocol
      ) ?? null
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

  private pushLog(input: Omit<LocalGatewayLogEntry, 'id' | 'timestamp'>): void {
    const entry: LocalGatewayLogEntry = {
      id: `gw-${Date.now()}-${this.requestLogSeq++}`,
      timestamp: new Date().toISOString(),
      ...input
    }
    this.requestLogs = [entry, ...this.requestLogs].slice(0, 80)
  }
}
