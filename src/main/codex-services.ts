import { join, resolve } from 'node:path'

import {
  CodexAccountStore,
  CodexLoginCoordinator,
  getOpenAiCallbackPortOccupant,
  killOpenAiCallbackPortOccupant,
  refreshCodexAuthPayload,
  type CodexAuthPayload
} from './codex-auth'
import {
  CodexInstanceStore,
  type PersistedCodexInstance,
  type PersistedDefaultCodexInstance
} from './codex-instances'
import {
  buildAuthPayloadFromTemplate,
  buildTemplateAccountExport,
  buildTemplateRateLimits,
  parseTemplateFileRecord,
  type TemplateAccountRecord,
  type TemplateFileRecord
} from './codex-account-template'
import {
  launchCodexDesktop,
  resolveManagedCodexPid,
  resolveWindowsCodexDesktopExecutable,
  stopCodexProcess,
  writeAuthPayloadToCodexHome,
  writeProviderApiKeyToCodexHome,
  writeProviderConfigToCodexHome
} from './codex-launcher'
import { CodexProviderStore } from './codex-providers'
import { AccountRateLimitLookupError, readAccountRateLimits } from './codex-app-server'
import {
  resolveBestAccount,
  type AccountTag,
  type AccountRateLimits,
  type AccountSummary,
  type AppSettings,
  type AppSnapshot,
  type CodexInstanceDefaults,
  type CodexInstanceSummary,
  type CreateCodexInstanceInput,
  type CreateCustomProviderInput,
  type CustomProviderDetail,
  type CurrentSessionSummary,
  type LoginEvent,
  type CustomProviderSummary,
  type UpdateCustomProviderInput,
  type UpdateCodexInstanceInput
} from '../shared/codex'
import type { CodexPlatformAdapter } from '../shared/codex-platform'
import { decodeJwtPayload } from '../shared/openai-auth'

const DEFAULT_CODEX_INSTANCE_ID = '__default__'
const BACKGROUND_AUTH_REFRESH_SKEW_MS = 5 * 60_000

function accessTokenExpiresSoon(token?: string, skewMs = 60_000): boolean {
  if (!token) {
    return true
  }

  const payload = decodeJwtPayload(token)
  if (typeof payload.exp !== 'number') {
    return false
  }

  return payload.exp * 1000 <= Date.now() + skewMs
}

function accountErrorLabel(account: AccountSummary): string {
  return account.email ?? account.name ?? account.accountId ?? account.id
}

function accountInstanceLabel(account: AccountSummary): string {
  return `Account ${account.email ?? account.name ?? account.accountId ?? account.id}`
}

function customProviderLabel(provider: Pick<CustomProviderSummary, 'name' | 'baseUrl'>): string {
  return provider.name?.trim() || provider.baseUrl || 'custom'
}

function resolveOptionalAccountId(snapshot: AppSnapshot): string | null {
  return snapshot.activeAccountId ?? snapshot.accounts[0]?.id ?? null
}

function shouldRefreshStoredAuth(error: unknown, refreshToken?: string): boolean {
  if (!refreshToken || !(error instanceof Error)) {
    return false
  }

  if (error.message === 'Missing access token required for rate-limit lookup.') {
    return true
  }

  if (!(error instanceof AccountRateLimitLookupError)) {
    return false
  }

  return error.status === 401 || error.status === 403
}

function shouldClearStoredUsage(error: unknown): boolean {
  if (error instanceof AccountRateLimitLookupError) {
    return error.status === 401 || error.status === 403
  }

  if (!(error instanceof Error)) {
    return false
  }

  const message = error.message.toLowerCase()
  if (
    message.includes('missing access token required for rate-limit lookup') ||
    message.includes('missing refresh token required for token refresh')
  ) {
    return true
  }

  if (!message.includes('openai token refresh failed')) {
    return false
  }

  return (
    message.includes('invalid_grant') ||
    message.includes('expired') ||
    message.includes('revoked') ||
    message.includes('invalid token')
  )
}

export interface CodexServices {
  getSnapshot(): Promise<AppSnapshot>
  accounts: {
    list(): Promise<AppSnapshot>
    importCurrent(): Promise<AppSnapshot>
    importFromTemplate(raw: string): Promise<AppSnapshot>
    exportToTemplate(accountIds?: string[]): Promise<string>
    activate(accountId: string): Promise<AppSnapshot>
    activateBest(): Promise<AppSnapshot>
    refreshExpiringSession(accountId: string): Promise<boolean>
    reorder(accountIds: string[]): Promise<AppSnapshot>
    remove(accountId: string): Promise<AppSnapshot>
    removeMany(accountIds: string[]): Promise<AppSnapshot>
    updateTags(accountId: string, tagIds: string[]): Promise<AppSnapshot>
    get(accountId: string): Promise<AccountSummary>
  }
  tags: {
    create(name: string): Promise<AppSnapshot>
    update(tagId: string, name: string): Promise<AppSnapshot>
    remove(tagId: string): Promise<AppSnapshot>
    getAll(): Promise<AccountTag[]>
  }
  providers: {
    list(): Promise<CustomProviderSummary[]>
    create(input: CreateCustomProviderInput): Promise<AppSnapshot>
    reorder(providerIds: string[]): Promise<AppSnapshot>
    update(providerId: string, input: UpdateCustomProviderInput): Promise<AppSnapshot>
    remove(providerId: string): Promise<AppSnapshot>
    get(providerId: string): Promise<CustomProviderDetail>
    open(providerId: string, workspacePath?: string): Promise<AppSnapshot>
  }
  session: {
    current(): Promise<CurrentSessionSummary | null>
  }
  settings: {
    get(): Promise<AppSettings>
    update(nextSettings: Partial<AppSettings>): Promise<AppSnapshot>
  }
  usage: {
    read(accountId?: string): Promise<AccountRateLimits>
  }
  login: {
    start(
      method: 'browser' | 'device'
    ): Promise<{ attemptId: string; method: 'browser' | 'device' }>
    isRunning(): boolean
    getPortOccupant: typeof getOpenAiCallbackPortOccupant
    killPortOccupant: typeof killOpenAiCallbackPortOccupant
  }
  codex: {
    open(accountId?: string, workspacePath?: string): Promise<AppSnapshot>
    openIsolated(accountId: string, workspacePath?: string): Promise<AppSnapshot>
    instances: {
      list(): Promise<CodexInstanceSummary[]>
      getDefaults(): Promise<CodexInstanceDefaults>
      create(input: CreateCodexInstanceInput): Promise<CodexInstanceSummary>
      update(instanceId: string, input: UpdateCodexInstanceInput): Promise<CodexInstanceSummary>
      remove(instanceId: string): Promise<void>
      start(instanceId: string, workspacePath?: string): Promise<CodexInstanceSummary>
      stop(instanceId: string): Promise<CodexInstanceSummary>
    }
  }
}

export interface CreateCodexServicesOptions {
  userDataPath: string
  defaultWorkspacePath: string
  platform: CodexPlatformAdapter
  emitLoginEvent?: (event: LoginEvent) => void
}

export { resolveWindowsCodexDesktopExecutable }

export function createCodexServices(options: CreateCodexServicesOptions): CodexServices {
  const store = new CodexAccountStore(options.userDataPath, options.platform)
  const instanceStore = new CodexInstanceStore(options.userDataPath)
  const providerStore = new CodexProviderStore(options.userDataPath, options.platform)
  const loginCoordinator = new CodexLoginCoordinator(
    store,
    options.emitLoginEvent ?? (() => undefined),
    options.platform
  )

  async function persistRefreshedAuth(
    accountId: string,
    refreshedAuth: CodexAuthPayload
  ): Promise<{ accountId: string; auth: CodexAuthPayload }> {
    await store.syncCurrentAuthPayload(accountId, refreshedAuth)
    const refreshedAccount = await store.importAuthPayload(refreshedAuth)
    return {
      accountId: refreshedAccount.id,
      auth: refreshedAuth
    }
  }

  async function readUsageForAuth(
    accountId: string,
    account: AccountSummary,
    auth: CodexAuthPayload
  ): Promise<AccountRateLimits> {
    let targetAccountId = accountId

    try {
      let rateLimits: AccountRateLimits

      try {
        rateLimits = await readAccountRateLimits(auth, options.platform)
      } catch (error) {
        if (!shouldRefreshStoredAuth(error, auth.tokens?.refresh_token)) {
          throw error
        }

        const refreshedAuth = await refreshCodexAuthPayload(auth, options.platform)
        const persisted = await persistRefreshedAuth(targetAccountId, refreshedAuth)
        targetAccountId = persisted.accountId
        rateLimits = await readAccountRateLimits(persisted.auth, options.platform)
      }

      await Promise.all([
        store.saveAccountRateLimits(targetAccountId, rateLimits),
        store.clearAccountUsageError(targetAccountId)
      ])
      return rateLimits
    } catch (error) {
      if (shouldClearStoredUsage(error)) {
        await store.clearAccountRateLimits(targetAccountId)
      }

      const detail = error instanceof Error ? error.message : 'Failed to read account limits.'
      await store.saveAccountUsageError(targetAccountId, detail)
      throw new Error(`${accountErrorLabel(account)}: ${detail}`)
    }
  }

  async function prepareLaunchAuthPayload(accountId: string): Promise<CodexAuthPayload> {
    const storedAuth = await store.getStoredAuthPayload(accountId)

    if (
      !accessTokenExpiresSoon(storedAuth.tokens?.access_token) ||
      !storedAuth.tokens?.refresh_token
    ) {
      return storedAuth
    }

    const refreshed = await refreshCodexAuthPayload(storedAuth, options.platform)
    return (await persistRefreshedAuth(accountId, refreshed)).auth
  }

  async function refreshExpiringAccountSession(accountId: string): Promise<boolean> {
    const storedAuth = await store.getStoredAuthPayload(accountId)

    if (
      !storedAuth.tokens?.refresh_token ||
      !accessTokenExpiresSoon(storedAuth.tokens?.access_token, BACKGROUND_AUTH_REFRESH_SKEW_MS)
    ) {
      return false
    }

    try {
      const refreshed = await refreshCodexAuthPayload(storedAuth, options.platform)
      await Promise.all([
        persistRefreshedAuth(accountId, refreshed),
        store.clearAccountUsageError(accountId)
      ])
      return true
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Failed to refresh account session.'
      await store.saveAccountUsageError(accountId, detail)
      throw error
    }
  }

  async function resolveAccountIdOrThrow(explicitAccountId?: string): Promise<string> {
    if (explicitAccountId) {
      return explicitAccountId
    }

    const snapshot = await getSnapshot()
    const resolved = resolveOptionalAccountId(snapshot)
    if (!resolved) {
      throw new Error('Account not found.')
    }

    return resolved
  }

  async function resolveAccountsForExport(accountIds?: string[]): Promise<AccountSummary[]> {
    const snapshot = await getSnapshot()
    if (!accountIds?.length) {
      return snapshot.accounts
    }

    const accountsById = new Map(snapshot.accounts.map((account) => [account.id, account]))
    return accountIds.map((accountId) => {
      const account = accountsById.get(accountId)
      if (!account) {
        throw new Error(`Account not found: ${accountId}`)
      }

      return account
    })
  }

  async function toInstanceSummary(
    instance: PersistedCodexInstance
  ): Promise<CodexInstanceSummary> {
    const runningPid = await resolveManagedCodexPid(instance.codexHome, instance.lastPid)
    if (runningPid !== instance.lastPid) {
      await instanceStore.setInstancePid(instance.id, runningPid ?? null)
      instance = {
        ...instance,
        lastPid: runningPid
      }
    }

    return {
      id: instance.id,
      name: instance.name,
      codexHome: instance.codexHome,
      bindAccountId: instance.bindAccountId,
      extraArgs: instance.extraArgs,
      isDefault: false,
      createdAt: instance.createdAt,
      updatedAt: instance.updatedAt,
      lastLaunchedAt: instance.lastLaunchedAt,
      lastPid: runningPid,
      running: Boolean(runningPid),
      initialized: await instanceStore.isInitialized(instance.codexHome)
    }
  }

  async function toDefaultInstanceSummary(
    instance: PersistedDefaultCodexInstance
  ): Promise<CodexInstanceSummary> {
    const { defaultCodexHome } = instanceStore.getDefaults()
    const runningPid = await resolveManagedCodexPid(defaultCodexHome, instance.lastPid)
    if (runningPid !== instance.lastPid) {
      instance = await instanceStore.updateDefaultInstance({
        lastPid: runningPid ?? null
      })
    }

    return {
      id: DEFAULT_CODEX_INSTANCE_ID,
      name: '',
      codexHome: defaultCodexHome,
      bindAccountId: instance.bindAccountId,
      extraArgs: instance.extraArgs,
      isDefault: true,
      createdAt: instance.updatedAt,
      updatedAt: instance.updatedAt,
      lastLaunchedAt: instance.lastLaunchedAt,
      lastPid: runningPid,
      running: Boolean(runningPid),
      initialized: await instanceStore.isInitialized(defaultCodexHome)
    }
  }

  async function listCodexInstances(): Promise<CodexInstanceSummary[]> {
    const defaultInstance = await instanceStore.getDefaultInstance()
    return [await toDefaultInstanceSummary(defaultInstance)]
  }

  async function getSnapshot(): Promise<AppSnapshot> {
    const [snapshot, providers] = await Promise.all([
      store.getSnapshot(loginCoordinator.isRunning()),
      providerStore.list()
    ])

    return {
      ...snapshot,
      providers,
      codexInstances: [],
      codexInstanceDefaults: instanceStore.getDefaults()
    }
  }

  async function getDesktopExecutablePathOverride(): Promise<string | undefined> {
    const snapshot = await store.getSnapshot(loginCoordinator.isRunning())
    const value = snapshot.settings.codexDesktopExecutablePath.trim()
    return value || undefined
  }

  async function startDefaultInstance(
    workspacePath: string,
    accountId?: string
  ): Promise<CodexInstanceSummary> {
    const defaultInstance = await instanceStore.getDefaultInstance()
    const targetAccountId = accountId ?? defaultInstance.bindAccountId

    if (targetAccountId) {
      await store.activateAccount(targetAccountId)
    }

    const { defaultCodexHome } = instanceStore.getDefaults()
    const runningPid = await resolveManagedCodexPid(defaultCodexHome, defaultInstance.lastPid)
    if (runningPid) {
      await stopCodexProcess(runningPid)
    }

    const pid = await launchCodexDesktop({
      workspacePath,
      codexHome: defaultCodexHome,
      extraArgs: defaultInstance.extraArgs,
      preferAppBundle: false,
      requireDesktopExecutable: false,
      desktopExecutablePath: await getDesktopExecutablePathOverride()
    })

    const updated = await instanceStore.updateDefaultInstance({
      lastPid: pid,
      touchLaunch: true
    })

    return toDefaultInstanceSummary(updated)
  }

  async function startNamedInstance(
    instanceId: string,
    workspacePath: string
  ): Promise<CodexInstanceSummary> {
    const instance = await instanceStore.getInstance(instanceId)
    await instanceStore.ensureInitialized(instance.codexHome)
    await instanceStore.syncConfigFromDefault(instance.codexHome)

    if (instance.bindAccountId) {
      const authPayload = await prepareLaunchAuthPayload(instance.bindAccountId)
      await writeAuthPayloadToCodexHome(instance.codexHome, authPayload)
    }

    const runningPid = await resolveManagedCodexPid(instance.codexHome, instance.lastPid)
    if (runningPid) {
      await stopCodexProcess(runningPid)
    }

    const pid = await launchCodexDesktop({
      workspacePath,
      codexHome: instance.codexHome,
      extraArgs: instance.extraArgs,
      preferAppBundle: true,
      requireDesktopExecutable: true,
      desktopExecutablePath: await getDesktopExecutablePathOverride()
    })

    return toInstanceSummary(await instanceStore.markLaunched(instance.id, pid))
  }

  async function startAccountInstance(
    accountId: string,
    workspacePath: string
  ): Promise<CodexInstanceSummary> {
    const account = await store.getAccountSummary(accountId)
    const instance = await instanceStore.ensureAccountInstance({
      accountId,
      label: accountInstanceLabel(account)
    })

    return startNamedInstance(instance.id, workspacePath)
  }

  async function ensureProviderInstance(
    providerId: string,
    label: string
  ): Promise<PersistedCodexInstance> {
    const { rootDir } = instanceStore.getDefaults()
    const providerCodexHome = join(rootDir, `provider-${providerId}`)
    const existing = (await instanceStore.list()).find(
      (instance) => resolve(instance.codexHome) === resolve(providerCodexHome)
    )
    if (existing) {
      return existing
    }

    return instanceStore.create({
      name: `Provider ${label}`,
      codexHome: providerCodexHome
    })
  }

  async function startProviderInstance(
    providerId: string,
    workspacePath: string
  ): Promise<CustomProviderSummary> {
    const provider = await providerStore.getResolvedProvider(providerId)
    const instance = await ensureProviderInstance(providerId, customProviderLabel(provider.summary))
    await instanceStore.ensureInitialized(instance.codexHome)
    await instanceStore.syncConfigFromDefault(instance.codexHome)
    await writeProviderApiKeyToCodexHome(instance.codexHome, provider.apiKey)
    await writeProviderConfigToCodexHome(instance.codexHome, provider.summary)

    const runningPid = await resolveManagedCodexPid(instance.codexHome, instance.lastPid)
    if (runningPid) {
      await stopCodexProcess(runningPid)
    }

    const pid = await launchCodexDesktop({
      workspacePath,
      codexHome: instance.codexHome,
      extraArgs: instance.extraArgs,
      preferAppBundle: true,
      requireDesktopExecutable: true,
      desktopExecutablePath: await getDesktopExecutablePathOverride()
    })

    await instanceStore.markLaunched(instance.id, pid)
    return providerStore.markUsed(providerId)
  }

  async function stopInstance(instanceId: string): Promise<CodexInstanceSummary> {
    if (instanceId === DEFAULT_CODEX_INSTANCE_ID) {
      const defaultInstance = await instanceStore.getDefaultInstance()
      const { defaultCodexHome } = instanceStore.getDefaults()
      const pid = await resolveManagedCodexPid(defaultCodexHome, defaultInstance.lastPid)
      if (pid) {
        await stopCodexProcess(pid)
      }

      return toDefaultInstanceSummary(
        await instanceStore.updateDefaultInstance({
          lastPid: null
        })
      )
    }

    const instance = await instanceStore.getInstance(instanceId)
    const pid = await resolveManagedCodexPid(instance.codexHome, instance.lastPid)
    if (pid) {
      await stopCodexProcess(pid)
    }

    return toInstanceSummary(await instanceStore.setInstancePid(instance.id, null))
  }

  return {
    getSnapshot,
    accounts: {
      list: getSnapshot,
      importCurrent: async () => {
        await store.importCurrentAuth()
        return getSnapshot()
      },
      importFromTemplate: async (raw) => {
        const parsed: TemplateFileRecord = parseTemplateFileRecord(raw)
        const accounts = parsed.accounts
        const exportedAt = parsed.exported_at ?? new Date().toISOString()

        for (const account of accounts) {
          const authPayload = buildAuthPayloadFromTemplate(account, exportedAt)
          const imported = await store.importAuthPayload(authPayload)
          const rateLimits = buildTemplateRateLimits(account, exportedAt)
          if (rateLimits) {
            await store.saveAccountRateLimits(imported.id, rateLimits)
          }
        }

        return getSnapshot()
      },
      exportToTemplate: async (accountIds) => {
        const accountsToExport = await resolveAccountsForExport(accountIds)
        const snapshot = await getSnapshot()
        const exportedAt = new Date().toISOString()
        const accounts: TemplateAccountRecord[] = []

        for (const account of accountsToExport) {
          const auth = await store.getStoredAuthPayload(account.id)
          accounts.push(
            buildTemplateAccountExport(
              account,
              auth,
              snapshot.usageByAccountId[account.id],
              exportedAt
            )
          )
        }

        return `${JSON.stringify(
          {
            exported_at: exportedAt,
            proxies: [],
            accounts
          },
          null,
          2
        )}\n`
      },
      activate: async (accountId) => {
        await store.activateAccount(accountId)
        return getSnapshot()
      },
      activateBest: async () => {
        const snapshot = await getSnapshot()
        const bestAccount = resolveBestAccount(
          snapshot.accounts,
          snapshot.usageByAccountId,
          snapshot.activeAccountId
        )

        if (!bestAccount || bestAccount.id === snapshot.activeAccountId) {
          return getSnapshot()
        }

        await store.activateAccount(bestAccount.id)
        return getSnapshot()
      },
      reorder: async (accountIds) => {
        await store.reorderAccounts(accountIds)
        return getSnapshot()
      },
      refreshExpiringSession: refreshExpiringAccountSession,
      remove: async (accountId) => {
        await store.removeAccount(accountId)
        return getSnapshot()
      },
      removeMany: async (accountIds) => {
        for (const accountId of [...new Set(accountIds)]) {
          await store.removeAccount(accountId)
        }
        return getSnapshot()
      },
      updateTags: async (accountId, tagIds) => {
        await store.updateAccountTags(accountId, tagIds)
        return getSnapshot()
      },
      get: (accountId) => store.getAccountSummary(accountId)
    },
    tags: {
      create: async (name) => {
        await store.createTag(name)
        return getSnapshot()
      },
      update: async (tagId, name) => {
        await store.updateTag(tagId, name)
        return getSnapshot()
      },
      remove: async (tagId) => {
        await store.deleteTag(tagId)
        return getSnapshot()
      },
      getAll: async () => (await getSnapshot()).tags
    },
    providers: {
      list: () => providerStore.list(),
      create: async (input) => {
        await providerStore.create(input)
        return getSnapshot()
      },
      reorder: async (providerIds) => {
        await providerStore.reorder(providerIds)
        return getSnapshot()
      },
      update: async (providerId, input) => {
        await providerStore.update(providerId, input)
        return getSnapshot()
      },
      remove: async (providerId) => {
        const { rootDir } = instanceStore.getDefaults()
        const providerCodexHome = join(rootDir, `provider-${providerId}`)
        const instance = (await instanceStore.list()).find(
          (item) => resolve(item.codexHome) === resolve(providerCodexHome)
        )
        if (instance) {
          await stopInstance(instance.id)
          await instanceStore.remove(instance.id)
        }

        await providerStore.remove(providerId)
        return getSnapshot()
      },
      get: async (providerId) => {
        const provider = await providerStore.getResolvedProvider(providerId)
        return {
          ...provider.summary,
          apiKey: provider.apiKey
        }
      },
      open: async (providerId, workspacePath = options.defaultWorkspacePath) => {
        await startProviderInstance(providerId, workspacePath)
        return getSnapshot()
      }
    },
    session: {
      current: async () => (await getSnapshot()).currentSession
    },
    settings: {
      get: async () => (await getSnapshot()).settings,
      update: async (nextSettings) => {
        await store.updateSettings(nextSettings)
        return getSnapshot()
      }
    },
    usage: {
      read: async (accountId) => {
        const resolvedAccountId = await resolveAccountIdOrThrow(accountId)
        const account = await store.getAccountSummary(resolvedAccountId)
        const auth = await store.getStoredAuthPayload(resolvedAccountId)
        return readUsageForAuth(resolvedAccountId, account, auth)
      }
    },
    login: {
      start: (method) => loginCoordinator.start(method),
      isRunning: () => loginCoordinator.isRunning(),
      getPortOccupant: getOpenAiCallbackPortOccupant,
      killPortOccupant: killOpenAiCallbackPortOccupant
    },
    codex: {
      open: async (accountId, workspacePath = options.defaultWorkspacePath) => {
        const resolvedAccountId = accountId ? await resolveAccountIdOrThrow(accountId) : undefined
        await startDefaultInstance(workspacePath, resolvedAccountId)
        return getSnapshot()
      },
      openIsolated: async (accountId, workspacePath = options.defaultWorkspacePath) => {
        const resolvedAccountId = await resolveAccountIdOrThrow(accountId)
        await startAccountInstance(resolvedAccountId, workspacePath)
        return getSnapshot()
      },
      instances: {
        list: listCodexInstances,
        getDefaults: async () => instanceStore.getDefaults(),
        create: async (input) =>
          toInstanceSummary(
            await instanceStore.create({
              name: input.name,
              codexHome: input.codexHome,
              bindAccountId: input.bindAccountId,
              extraArgs: input.extraArgs
            })
          ),
        update: async (instanceId, input) => {
          if (instanceId === DEFAULT_CODEX_INSTANCE_ID) {
            if (input.name) {
              throw new Error('Default instance name cannot be changed.')
            }

            return toDefaultInstanceSummary(
              await instanceStore.updateDefaultInstance({
                bindAccountId: input.bindAccountId,
                extraArgs: input.extraArgs
              })
            )
          }

          return toInstanceSummary(
            await instanceStore.update(instanceId, {
              name: input.name,
              bindAccountId: input.bindAccountId,
              extraArgs: input.extraArgs
            })
          )
        },
        remove: async (instanceId) => {
          if (instanceId === DEFAULT_CODEX_INSTANCE_ID) {
            throw new Error('Default instance cannot be removed.')
          }

          await stopInstance(instanceId)
          await instanceStore.remove(instanceId)
        },
        start: async (instanceId, workspacePath = options.defaultWorkspacePath) => {
          if (instanceId === DEFAULT_CODEX_INSTANCE_ID) {
            return startDefaultInstance(workspacePath)
          }

          return startNamedInstance(instanceId, workspacePath)
        },
        stop: stopInstance
      }
    }
  }
}
