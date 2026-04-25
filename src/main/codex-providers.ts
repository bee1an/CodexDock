import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'

import type {
  CreateCustomProviderInput,
  CustomProviderProtocol,
  CustomProviderSummary,
  UpdateCustomProviderInput
} from '../shared/codex'
import type { CodexPlatformAdapter, ProtectedPayload } from '../shared/codex-platform'

interface PersistedCustomProvider {
  id: string
  name?: string
  baseUrl: string
  protocol?: CustomProviderProtocol
  apiKey: ProtectedPayload
  model: string
  fastMode: boolean
  createdAt: string
  updatedAt: string
  lastUsedAt?: string
}

interface PersistedProvidersState {
  version: 1
  providers: PersistedCustomProvider[]
}

function defaultState(): PersistedProvidersState {
  return {
    version: 1,
    providers: []
  }
}

function normalizeOptionalName(value?: string | null): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, ' ')
  return normalized || undefined
}

function normalizeModel(value?: string | null): string {
  const normalized = value?.trim().replace(/\s+/g, ' ')
  return normalized || '5.4'
}

function normalizeProtocol(value?: string | null): CustomProviderProtocol {
  void value
  return 'openai'
}

function normalizeBaseUrl(value: string): string {
  const normalized = value.trim()
  if (!normalized) {
    throw new Error('Provider base URL is required.')
  }

  const url = new URL(normalized)
  const pathname = url.pathname.replace(/\/+$/, '')
  url.pathname = pathname || '/'
  return url.toString().replace(/\/$/, url.pathname === '/' ? '' : '/')
}

function toProviderSummary(provider: PersistedCustomProvider): CustomProviderSummary {
  return {
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    protocol: normalizeProtocol(provider.protocol),
    model: provider.model,
    fastMode: provider.fastMode,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
    lastUsedAt: provider.lastUsedAt
  }
}

export class CodexProviderStore {
  private readonly stateFile: string

  constructor(
    userDataPath: string,
    private readonly platform: CodexPlatformAdapter
  ) {
    this.stateFile = join(userDataPath, 'codex-providers.json')
  }

  async list(): Promise<CustomProviderSummary[]> {
    const state = await this.readState()
    return state.providers.map(toProviderSummary)
  }

  async get(providerId: string): Promise<CustomProviderSummary> {
    return toProviderSummary(await this.getPersistedProvider(providerId))
  }

  async create(input: CreateCustomProviderInput): Promise<CustomProviderSummary> {
    const state = await this.readState()
    const now = new Date().toISOString()
    const provider: PersistedCustomProvider = {
      id: randomUUID(),
      name: normalizeOptionalName(input.name),
      baseUrl: normalizeBaseUrl(input.baseUrl),
      protocol: normalizeProtocol(input.protocol),
      apiKey: this.platform.protect(this.requireApiKey(input.apiKey)),
      model: normalizeModel(input.model),
      fastMode: input.fastMode ?? true,
      createdAt: now,
      updatedAt: now
    }

    state.providers.unshift(provider)
    await this.writeState(state)
    return toProviderSummary(provider)
  }

  async update(
    providerId: string,
    input: UpdateCustomProviderInput
  ): Promise<CustomProviderSummary> {
    const state = await this.readState()
    const provider = state.providers.find((item) => item.id === providerId)
    if (!provider) {
      throw new Error('Provider not found.')
    }

    if (input.name !== undefined) {
      provider.name = normalizeOptionalName(input.name)
    }

    if (typeof input.baseUrl === 'string') {
      provider.baseUrl = normalizeBaseUrl(input.baseUrl)
    }

    if (input.protocol !== undefined) {
      provider.protocol = normalizeProtocol(input.protocol)
    }

    if (typeof input.apiKey === 'string') {
      provider.apiKey = this.platform.protect(this.requireApiKey(input.apiKey))
    }

    if (input.model !== undefined) {
      provider.model = normalizeModel(input.model)
    }

    if (typeof input.fastMode === 'boolean') {
      provider.fastMode = input.fastMode
    }

    provider.updatedAt = new Date().toISOString()
    await this.writeState(state)
    return toProviderSummary(provider)
  }

  async reorder(providerIds: string[]): Promise<CustomProviderSummary[]> {
    const state = await this.readState()
    if (providerIds.length !== state.providers.length) {
      throw new Error('Provider reorder payload is invalid.')
    }

    const providersById = new Map(state.providers.map((provider) => [provider.id, provider]))
    const reordered = providerIds.map((providerId) => {
      const provider = providersById.get(providerId)
      if (!provider) {
        throw new Error('Provider reorder payload is invalid.')
      }
      return provider
    })

    if (new Set(providerIds).size !== state.providers.length) {
      throw new Error('Provider reorder payload is invalid.')
    }

    state.providers = reordered
    await this.writeState(state)
    return state.providers.map(toProviderSummary)
  }

  async remove(providerId: string): Promise<void> {
    const state = await this.readState()
    const index = state.providers.findIndex((item) => item.id === providerId)
    if (index < 0) {
      throw new Error('Provider not found.')
    }

    state.providers.splice(index, 1)
    await this.writeState(state)
  }

  async markUsed(providerId: string): Promise<CustomProviderSummary> {
    const state = await this.readState()
    const provider = state.providers.find((item) => item.id === providerId)
    if (!provider) {
      throw new Error('Provider not found.')
    }

    const now = new Date().toISOString()
    provider.lastUsedAt = now
    provider.updatedAt = now
    await this.writeState(state)
    return toProviderSummary(provider)
  }

  async getResolvedProvider(providerId: string): Promise<{
    summary: CustomProviderSummary
    apiKey: string
  }> {
    const provider = await this.getPersistedProvider(providerId)
    if (provider.apiKey.mode === 'safeStorage') {
      throw new Error(
        'This provider API key was saved with macOS Keychain protection in an older version. Edit the provider and save the API key again.'
      )
    }

    return {
      summary: toProviderSummary(provider),
      apiKey: this.platform.unprotect(provider.apiKey)
    }
  }

  private requireApiKey(value?: string): string {
    const normalized = value?.trim()
    if (!normalized) {
      throw new Error('Provider API key is required.')
    }

    return normalized
  }

  private async getPersistedProvider(providerId: string): Promise<PersistedCustomProvider> {
    const provider = (await this.readState()).providers.find((item) => item.id === providerId)
    if (!provider) {
      throw new Error('Provider not found.')
    }
    return provider
  }

  private async readState(): Promise<PersistedProvidersState> {
    try {
      const raw = await fs.readFile(this.stateFile, 'utf8')
      const parsed = JSON.parse(raw) as Partial<PersistedProvidersState>
      return {
        version: 1,
        providers: (parsed.providers ?? []).map((provider) => ({
          id: provider.id ?? randomUUID(),
          name: normalizeOptionalName(provider.name),
          baseUrl: normalizeBaseUrl(provider.baseUrl ?? ''),
          protocol: normalizeProtocol(provider.protocol),
          apiKey: provider.apiKey as ProtectedPayload,
          model: normalizeModel(provider.model),
          fastMode: typeof provider.fastMode === 'boolean' ? provider.fastMode : true,
          createdAt: provider.createdAt ?? new Date(0).toISOString(),
          updatedAt: provider.updatedAt ?? provider.createdAt ?? new Date(0).toISOString(),
          lastUsedAt: provider.lastUsedAt
        }))
      }
    } catch {
      return defaultState()
    }
  }

  private async writeState(state: PersistedProvidersState): Promise<void> {
    await fs.mkdir(dirname(this.stateFile), { recursive: true })
    await fs.writeFile(this.stateFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  }
}
