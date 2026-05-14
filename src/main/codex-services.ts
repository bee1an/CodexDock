import { join, resolve } from 'node:path'

import {
  CodexAccountStore,
  CodexLoginCoordinator,
  getOpenAiCallbackPortOccupant,
  killOpenAiCallbackPortOccupant,
  type CodexAuthPayload
} from './codex-auth'
import {
  CodexInstanceStore,
  type PersistedCodexInstance,
  type PersistedDefaultCodexInstance
} from './codex-instances'
import {
  buildAuthPayloadFromTemplate,
  buildTemplateRateLimits,
  parseTemplateFileRecord,
  serializeAccountExport,
  type TemplateFileRecord
} from './codex-account-template'
import { CodexProviderStore } from './codex-providers'
import {
  type AppSnapshot,
  type CodexInstanceSummary,
  type AccountTokenRefreshLogEntry,
  type AccountTokenRefreshResult,
  canRunWakeRequest,
  isAccountHealthBlocking,
  isLocalMockAccount,
  resolveBestAccount,
  type WakeAccountRateLimitsResult
} from '../shared/codex'
import type {
  CodexServices,
  CreateCodexServicesOptions,
  StoredAuthRefreshResult,
  AuthScopedRefreshFailure
} from './codex-services-shared'
import { DEFAULT_CODEX_INSTANCE_ID, customProviderLabel } from './codex-services-shared'
import { createCodexServicesAuthRuntime } from './codex-services-auth-runtime'
import { createCodexCostUsageService } from './codex-cost-usage'
import { createCodexServicesDiagnosticsRuntime } from './codex-services-diagnostics-runtime'
import { createCodexServicesInstanceRuntime } from './codex-services-instance-runtime'
import { ConfigGuard } from './codex-config-guard'
import {
  copyCodexSessionToProvider,
  listCodexSessionProjects,
  listCodexSessions,
  readCodexSessionDetail,
  trashCodexSession
} from './codex-sessions'
import { createCodexSkillService } from './codex-skills'
import { createCodexPromptService } from './codex-prompts'
import { createSkillLibraryService } from './skill-library'
import { CodexLocalGatewayService } from './local-gateway'
import { decodeJwtPayload } from '../shared/openai-auth'

export type { CodexServices, CreateCodexServicesOptions } from './codex-services-shared'
export { resolveWindowsCodexDesktopExecutable } from './codex-launcher'

export function createCodexServices(options: CreateCodexServicesOptions): CodexServices {
  const configGuard = new ConfigGuard(options.userDataPath, options.platform)
  const store = new CodexAccountStore(
    options.userDataPath,
    options.platform,
    options.defaultCodexHome,
    configGuard
  )
  const instanceStore = new CodexInstanceStore(options.userDataPath, options.defaultCodexHome)
  const providerStore = new CodexProviderStore(options.userDataPath, options.platform)
  const loadImmediateSnapshotForLoginEvent = async (): Promise<AppSnapshot | undefined> => {
    try {
      return await getBaseSnapshot()
    } catch {
      return getFallbackSnapshotForLoginEvent(false)
    }
  }
  const loadHydratedSnapshotForLoginEvent = async (): Promise<AppSnapshot | undefined> => {
    try {
      return await getSnapshot()
    } catch {
      return getFallbackSnapshotForLoginEvent(true)
    }
  }
  const loginCoordinator = new CodexLoginCoordinator(
    store,
    options.emitLoginEvent ?? (() => undefined),
    options.platform,
    loadImmediateSnapshotForLoginEvent,
    loadHydratedSnapshotForLoginEvent
  )
  const authRefreshTasksByAccountId = new Map<string, Promise<StoredAuthRefreshResult>>()
  const authRefreshFailuresByAccountId = new Map<string, AuthScopedRefreshFailure>()
  const wakeTasksByAccountId = new Map<string, Promise<WakeAccountRateLimitsResult>>()
  const context = {
    store,
    instanceStore,
    providerStore,
    loginCoordinator,
    options,
    authRefreshTasksByAccountId,
    authRefreshFailuresByAccountId,
    wakeTasksByAccountId
  }

  const authRuntime = createCodexServicesAuthRuntime(context)
  const instanceRuntime = createCodexServicesInstanceRuntime(context, authRuntime, configGuard)
  const costUsageService = createCodexCostUsageService({
    userDataPath: options.userDataPath,
    listInstances: () => instanceRuntime.listCodexInstances()
  })
  const diagnosticsRuntime = createCodexServicesDiagnosticsRuntime(context, instanceRuntime)
  const skillService = createCodexSkillService()
  const promptService = createCodexPromptService(options.promptDataPath ?? options.userDataPath, {
    legacyUserDataPaths: options.legacyPromptDataPaths
  })
  const skillLibraryService = createSkillLibraryService(options.userDataPath)

  const localGatewayService = new CodexLocalGatewayService({
    store,
    providerStore,
    logFilePath: join(options.userDataPath, 'local-gateway-logs.json'),
    platform: options.platform,
    refreshAuthForUse: authRuntime.refreshAuthForUse,
    refreshStoredAuthGuarded: authRuntime.refreshStoredAuthGuarded,
    openCodexFromService: (input) => instanceRuntime.openFromService(input)
  })

  const {
    refreshStoredAuthGuarded,
    readStoredMockUsage,
    readUsageForAuth,
    readUsageForAuthResult,
    wakeMockUsage,
    wakeUsageForAuth,
    wakeUsageGuarded
  } = authRuntime
  const {
    getSnapshot: getBaseSnapshot,
    listCodexInstances,
    refreshExpiringAccountSession,
    resolveAccountIdOrThrow,
    resolveAccountsForExport,
    showDefaultCodex,
    startAccountInstance,
    startDefaultInstance,
    startNamedInstance,
    startProviderInstance,
    startDirectProviderInstance,
    syncLocalGatewayInstanceConfig,
    startLocalGatewayInstance,
    startDirectLocalGatewayInstance,
    openFromService,
    stopInstance,
    toDefaultInstanceSummary,
    toInstanceSummary
  } = instanceRuntime
  const { checkProvider, runDoctor } = diagnosticsRuntime
  const { probeProviderModels } = diagnosticsRuntime

  const getSnapshot = async (): Promise<AppSnapshot> => {
    const snapshot = await getBaseSnapshot()
    const costSnapshot = await costUsageService.readSnapshotSummaries(snapshot.codexInstances)
    const localGatewayStatus = await localGatewayService.status()
    return {
      ...snapshot,
      ...costSnapshot,
      localGatewayStatus
    }
  }

  async function fallbackNamedInstanceSummary(
    instance: PersistedCodexInstance
  ): Promise<CodexInstanceSummary> {
    try {
      return await toInstanceSummary(instance)
    } catch {
      const persistedInstance =
        (await instanceStore
          .list()
          .then((instances) => instances.find((item) => item.id === instance.id))
          .catch(() => undefined)) ?? instance
      return {
        id: persistedInstance.id,
        name: persistedInstance.name,
        codexHome: persistedInstance.codexHome,
        bindAccountId: persistedInstance.bindAccountId,
        extraArgs: persistedInstance.extraArgs,
        isDefault: false,
        createdAt: persistedInstance.createdAt,
        updatedAt: persistedInstance.updatedAt,
        lastLaunchedAt: persistedInstance.lastLaunchedAt,
        lastPid: persistedInstance.lastPid,
        running: Boolean(persistedInstance.lastPid),
        initialized: false
      }
    }
  }

  async function fallbackDefaultInstanceSummary(
    instance: PersistedDefaultCodexInstance
  ): Promise<CodexInstanceSummary> {
    try {
      return await toDefaultInstanceSummary(instance)
    } catch {
      const persistedInstance = await instanceStore.getDefaultInstance().catch(() => instance)
      const { defaultCodexHome } = instanceStore.getDefaults()
      return {
        id: DEFAULT_CODEX_INSTANCE_ID,
        name: '',
        codexHome: defaultCodexHome,
        bindAccountId: persistedInstance.bindAccountId,
        extraArgs: persistedInstance.extraArgs,
        isDefault: true,
        createdAt: persistedInstance.updatedAt,
        updatedAt: persistedInstance.updatedAt,
        lastLaunchedAt: persistedInstance.lastLaunchedAt,
        lastPid: persistedInstance.lastPid,
        running: Boolean(persistedInstance.lastPid),
        initialized: false
      }
    }
  }

  async function ensureProviderInstanceSummary(providerId: string): Promise<CodexInstanceSummary> {
    const provider = await providerStore.get(providerId)
    const { rootDir } = instanceStore.getDefaults()
    const providerCodexHome = join(rootDir, `provider-${providerId}`)
    const existing = (await instanceStore.list()).find(
      (instance) => resolve(instance.codexHome) === resolve(providerCodexHome)
    )
    const instance =
      existing ??
      (await instanceStore.create({
        name: `Provider ${customProviderLabel(provider)}`,
        codexHome: providerCodexHome
      }))

    return fallbackNamedInstanceSummary(instance)
  }

  async function getFallbackSnapshotForLoginEvent(
    includeTokenCost: boolean
  ): Promise<AppSnapshot | undefined> {
    try {
      const [snapshot, providers, defaultInstance, namedInstances] = await Promise.all([
        store.getSnapshot(false),
        providerStore.list(),
        instanceStore.getDefaultInstance(),
        instanceStore.list()
      ])
      const codexInstances = await Promise.all([
        fallbackDefaultInstanceSummary(defaultInstance),
        ...namedInstances.map((instance) => fallbackNamedInstanceSummary(instance))
      ])
      const costSnapshot = includeTokenCost
        ? await costUsageService.readSnapshotSummaries(codexInstances)
        : {
            tokenCostByInstanceId: {},
            tokenCostErrorByInstanceId: {},
            runningTokenCostSummary: null,
            runningTokenCostInstanceIds: []
          }

      return {
        ...snapshot,
        providers,
        codexInstances,
        codexInstanceDefaults: instanceStore.getDefaults(),
        ...costSnapshot,
        localGatewayStatus: await localGatewayService.status()
      }
    } catch {
      return undefined
    }
  }

  return {
    getSnapshot,
    accounts: {
      list: getSnapshot,
      importCurrent: async () => {
        await store.importCurrentAuth()
        return getSnapshot()
      },
      importFromAuthFile: async (authFile) => {
        await store.importAuthFile(authFile)
        return getSnapshot()
      },
      importFromStateFile: async (stateFile) => {
        await store.importAccountsFromStateFile(stateFile)
        return getSnapshot()
      },
      importFromTemplate: async (raw) => {
        const parsed: TemplateFileRecord = parseTemplateFileRecord(raw)
        const accounts = parsed.accounts
        const exportedAt = parsed.exported_at ?? new Date().toISOString()

        for (const account of accounts) {
          const authPayload = buildAuthPayloadFromTemplate(account, exportedAt)
          const imported = await store.importAuthPayload(authPayload, {
            subscriptionExpiresAt: account.credentials.subscription_expires_at
          })
          const rateLimits = buildTemplateRateLimits(account, exportedAt)
          if (rateLimits) {
            await store.saveAccountRateLimits(imported.id, rateLimits)
          }
        }

        return getSnapshot()
      },
      exportToTemplate: async (accountIds, format = 'codexdock') => {
        const accountsToExport = await resolveAccountsForExport(accountIds)
        const snapshot = await getSnapshot()
        const exportedAt = new Date().toISOString()
        const sources = await Promise.all(
          accountsToExport.map(async (account) => ({
            account,
            auth: await store.getStoredAuthPayload(account.id),
            rateLimits: snapshot.usageByAccountId[account.id]
          }))
        )

        return serializeAccountExport(sources, exportedAt, format)
      },
      activate: async (accountId) => {
        const snapshot = await getSnapshot()
        if (isAccountHealthBlocking((snapshot.accountHealthByAccountId ?? {})[accountId])) {
          throw new Error(
            'Account is marked as auth_error. Repair it and mark it normal before using it.'
          )
        }
        await store.activateAccount(accountId)
        return getSnapshot()
      },
      activateBest: async () => {
        const snapshot = await getSnapshot()
        const bestAccount = resolveBestAccount(
          snapshot.accounts,
          snapshot.usageByAccountId,
          snapshot.activeAccountId,
          snapshot.accountHealthByAccountId
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
      updateGroups: async (accountId, groupIds) => {
        await store.updateAccountGroups(accountId, groupIds)
        return getSnapshot()
      },
      updateTokens: async (accountId, input) => {
        await store.updateAccountTokens(accountId, input)
        return getSnapshot()
      },
      updateHealth: async (accountId, input) => {
        await store.updateAccountHealth(accountId, input)
        return getSnapshot()
      },
      getTokens: (accountId) => store.getAccountTokens(accountId),
      getWakeSchedule: (accountId) => store.getAccountWakeSchedule(accountId),
      updateWakeSchedule: async (accountId, input) => {
        await store.updateAccountWakeSchedule(accountId, input)
        return getSnapshot()
      },
      deleteWakeSchedule: async (accountId) => {
        await store.deleteAccountWakeSchedule(accountId)
        return getSnapshot()
      },
      updateWakeScheduleRuntime: async (accountId, patch) => {
        await store.patchAccountWakeSchedule(accountId, patch)
        return getSnapshot()
      },
      get: (accountId) => store.getAccountSummary(accountId),
      refreshTokens: async (accountId): Promise<AccountTokenRefreshResult> => {
        const account = await store.getAccountSummary(accountId)
        const label = account.email ?? account.name ?? account.accountId ?? account.id
        const sanitizedLogs: AccountTokenRefreshLogEntry[] = []
        const rawLogs: AccountTokenRefreshLogEntry[] = []

        const ts = (): string => new Date().toISOString()
        const sanitizeToken = (token?: string): string => {
          if (!token) return '(empty)'
          if (token.length <= 12) return `***[len=${token.length}]`
          return `${token.slice(0, 6)}...${token.slice(-4)} [len=${token.length}]`
        }
        const jwtExp = (token?: string): number | null => {
          const payload = decodeJwtPayload(token)
          return typeof payload.exp === 'number' ? payload.exp * 1000 : null
        }

        const pushLog = (message: string, rawMessage?: string): void => {
          const timestamp = ts()
          sanitizedLogs.push({ timestamp, message, sensitive: rawMessage !== undefined })
          rawLogs.push({
            timestamp,
            message: rawMessage ?? message,
            sensitive: rawMessage !== undefined
          })
        }

        let auth: CodexAuthPayload
        try {
          auth = await store.getStoredAuthPayload(accountId)
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          pushLog(`Failed to load auth payload: ${msg}`)
          return {
            success: false,
            accountId,
            accountLabel: label,
            before: {
              accessTokenExpiresAt: null,
              refreshTokenExpiresAt: null,
              idTokenExpiresAt: null
            },
            after: null,
            sanitizedLogs,
            rawLogs,
            error: msg
          }
        }

        const before = {
          accessTokenExpiresAt: jwtExp(auth.tokens?.access_token),
          refreshTokenExpiresAt: jwtExp(auth.tokens?.refresh_token),
          idTokenExpiresAt: jwtExp(auth.tokens?.id_token)
        }

        pushLog(`Account: ${label}`)
        pushLog(
          `Refresh token: ${sanitizeToken(auth.tokens?.refresh_token)}`,
          `Refresh token: ${auth.tokens?.refresh_token ?? '(empty)'}`
        )
        pushLog('Starting guarded refresh with the latest saved auth...')

        try {
          const refreshed = await refreshStoredAuthGuarded(accountId, auth)
          const refreshedAuth = refreshed.auth

          if (refreshed.refreshed) {
            pushLog('Refresh request succeeded and refreshed tokens were persisted')
          } else {
            pushLog('Stored auth changed before refresh; using the latest saved tokens')
          }
          pushLog(
            `New access token: ${sanitizeToken(refreshedAuth.tokens?.access_token)}`,
            `New access token: ${refreshedAuth.tokens?.access_token ?? '(empty)'}`
          )
          pushLog(
            `New id token: ${sanitizeToken(refreshedAuth.tokens?.id_token)}`,
            `New id token: ${refreshedAuth.tokens?.id_token ?? '(empty)'}`
          )

          const after = {
            accessTokenExpiresAt: jwtExp(refreshedAuth.tokens?.access_token),
            refreshTokenExpiresAt: jwtExp(refreshedAuth.tokens?.refresh_token),
            idTokenExpiresAt: jwtExp(refreshedAuth.tokens?.id_token)
          }

          pushLog('Force refresh completed successfully')

          return {
            success: true,
            accountId: refreshed.accountId,
            accountLabel: label,
            before,
            after,
            sanitizedLogs,
            rawLogs,
            error: null
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          pushLog(`Refresh failed: ${msg}`)
          return {
            success: false,
            accountId,
            accountLabel: label,
            before,
            after: null,
            sanitizedLogs,
            rawLogs,
            error: msg
          }
        }
      }
    },
    groups: {
      create: async (name) => {
        await store.createGroup(name)
        return getSnapshot()
      },
      update: async (groupId, name) => {
        await store.updateGroup(groupId, name)
        return getSnapshot()
      },
      remove: async (groupId) => {
        await store.deleteGroup(groupId)
        return getSnapshot()
      },
      getAll: async () => (await getSnapshot()).groups
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
      check: checkProvider,
      probeModels: probeProviderModels,
      open: async (providerId, workspacePath = options.defaultWorkspacePath) => {
        await startDirectProviderInstance(providerId, workspacePath)
        return getSnapshot()
      },
      openIsolated: async (providerId, workspacePath = options.defaultWorkspacePath) => {
        await startProviderInstance(providerId, workspacePath)
        return getSnapshot()
      }
    },
    doctor: {
      run: runDoctor
    },
    session: {
      current: async () => (await getSnapshot()).currentSession,
      projects: async (input) => listCodexSessionProjects(await listCodexInstances(), input),
      list: async (input) => listCodexSessions(await listCodexInstances(), input),
      detail: async (input) => readCodexSessionDetail(await listCodexInstances(), input),
      copyToProvider: async (input) => {
        const [instances, targetProvider] = await Promise.all([
          listCodexInstances(),
          input.targetProviderId
            ? providerStore.get(input.targetProviderId)
            : Promise.resolve(undefined)
        ])
        const targetInstance = input.targetInstanceId
          ? instances.find((instance) => instance.id === input.targetInstanceId)
          : input.targetProviderId
            ? await ensureProviderInstanceSummary(input.targetProviderId)
            : undefined

        if (!targetInstance) {
          throw new Error('Target instance not found.')
        }

        return copyCodexSessionToProvider(instances, input, targetInstance, targetProvider)
      },
      trash: async (input) => trashCodexSession(await listCodexInstances(), input, options.platform)
    },
    settings: {
      get: async () => store.getSettings(),
      update: async (nextSettings) => {
        await store.updateSettings(nextSettings)
        return getSnapshot()
      }
    },
    usage: {
      read: async (accountId) => {
        const resolvedAccountId = await resolveAccountIdOrThrow(accountId)
        const account = await store.getAccountSummary(resolvedAccountId)
        if (isLocalMockAccount(account)) {
          return readStoredMockUsage(resolvedAccountId)
        }

        const auth = await store.getStoredAuthPayload(resolvedAccountId)
        return readUsageForAuth(resolvedAccountId, account, auth)
      },
      wake: async (accountId, input) => {
        const resolvedAccountId = await resolveAccountIdOrThrow(accountId)
        const account = await store.getAccountSummary(resolvedAccountId)
        if (isLocalMockAccount(account)) {
          return wakeMockUsage(resolvedAccountId, input)
        }

        const auth = await store.getStoredAuthPayload(resolvedAccountId)
        const currentUsage = await readUsageForAuthResult(resolvedAccountId, account, auth)
        const currentAccountId = currentUsage.accountId
        const currentRateLimits = currentUsage.rateLimits

        if (!canRunWakeRequest(currentRateLimits)) {
          return {
            rateLimits: currentRateLimits,
            requestResult: null
          }
        }

        const wakeResult = await wakeUsageGuarded(currentAccountId, async () => {
          const currentAccount = await store.getAccountSummary(currentAccountId)
          const latestAuth = await store.getStoredAuthPayload(currentAccountId)
          const wakeUsage = await wakeUsageForAuth(
            currentAccountId,
            currentAccount,
            latestAuth,
            input
          )
          const finalAccount = await store.getAccountSummary(wakeUsage.accountId)
          const finalAuth = await store.getStoredAuthPayload(wakeUsage.accountId)

          return {
            rateLimits: await readUsageForAuth(wakeUsage.accountId, finalAccount, finalAuth),
            requestResult: wakeUsage.requestResult
          }
        })

        if (!wakeResult) {
          return {
            rateLimits: await readUsageForAuth(
              currentAccountId,
              await store.getAccountSummary(currentAccountId),
              await store.getStoredAuthPayload(currentAccountId)
            ),
            requestResult: null
          }
        }

        return wakeResult
      }
    },
    cost: {
      read: (input) => costUsageService.read(input)
    },
    gateway: {
      start: async () => {
        await localGatewayService.start()
        return getSnapshot()
      },
      stop: async () => {
        await localGatewayService.stop()
        return getSnapshot()
      },
      status: () => localGatewayService.status(),
      rotateKey: async () => {
        const status = await localGatewayService.rotateKey()
        await syncLocalGatewayInstanceConfig({
          baseUrl: status.baseUrl,
          apiKey: status.apiKey,
          create: false
        })
        return status
      },
      getApiKey: () => localGatewayService.getApiKey(),
      getPortOccupant: () => localGatewayService.getPortOccupant(),
      killPortOccupant: () => localGatewayService.killPortOccupant()
    },
    login: {
      start: (method) => loginCoordinator.start(method),
      isRunning: () => loginCoordinator.isRunning(),
      getPortOccupant: getOpenAiCallbackPortOccupant,
      killPortOccupant: killOpenAiCallbackPortOccupant
    },
    codex: {
      show: async (workspacePath = options.defaultWorkspacePath) => {
        await showDefaultCodex(workspacePath)
        return getSnapshot()
      },
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
      openLocalGateway: async (workspacePath = options.defaultWorkspacePath) => {
        const status = await localGatewayService.status()
        if (!status.running) {
          throw new Error('Local gateway is not running.')
        }
        const apiKey = await localGatewayService.getApiKey()
        await startDirectLocalGatewayInstance({
          baseUrl: status.baseUrl,
          apiKey,
          workspacePath
        })
        return getSnapshot()
      },
      openLocalGatewayIsolated: async (workspacePath = options.defaultWorkspacePath) => {
        const status = await localGatewayService.status()
        if (!status.running) {
          throw new Error('Local gateway is not running.')
        }
        const apiKey = await localGatewayService.getApiKey()
        await startLocalGatewayInstance({
          baseUrl: status.baseUrl,
          apiKey,
          workspacePath
        })
        return getSnapshot()
      },
      openFromService,
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
    },
    skill: {
      list: async () => skillService.list(await listCodexInstances()),
      detail: async (instanceId, skillDirName) =>
        skillService.detail(await listCodexInstances(), instanceId, skillDirName),
      copy: async (input) => skillService.copy(await listCodexInstances(), input)
    },
    prompt: {
      list: (input) => promptService.list(input),
      detail: (promptId) => promptService.detail(promptId),
      create: (input) => promptService.create(input),
      update: (promptId, input) => promptService.update(promptId, input),
      remove: (promptId) => promptService.remove(promptId),
      copy: (promptId) => promptService.copy(promptId),
      listCategories: () => promptService.listCategories(),
      createCategory: (name) => promptService.createCategory(name),
      renameCategory: (oldName, newName) => promptService.renameCategory(oldName, newName),
      removeCategory: (name) => promptService.removeCategory(name),
      importFile: (filePath) => promptService.importFile(filePath),
      importDir: (dirPath) => promptService.importDir(dirPath),
      exportDir: (targetDir) => promptService.exportDir(targetDir),
      addAttachment: (promptId, payload) => promptService.addAttachment(promptId, payload),
      removeAttachment: (promptId, fileName) => promptService.removeAttachment(promptId, fileName),
      readAttachment: (promptId, fileName) => promptService.readAttachment(promptId, fileName)
    },
    skillLibrary: {
      list: (input) => skillLibraryService.list(input),
      detail: (skillId) => skillLibraryService.detail(skillId),
      create: (input) => skillLibraryService.create(input),
      update: (skillId, input) => skillLibraryService.update(skillId, input),
      remove: (skillId) => skillLibraryService.remove(skillId),
      listCategories: () => skillLibraryService.listCategories(),
      createCategory: (name) => skillLibraryService.createCategory(name),
      renameCategory: (oldName, newName) => skillLibraryService.renameCategory(oldName, newName),
      removeCategory: (name) => skillLibraryService.removeCategory(name),
      importDir: (dirPath) => skillLibraryService.importDir(dirPath),
      exportDir: (targetDir) => skillLibraryService.exportDir(targetDir),
      collect: async (input) =>
        skillLibraryService.collect(input, await listCodexInstances()),
      install: async (input) =>
        skillLibraryService.install(input, await listCodexInstances())
    }
  }
}
