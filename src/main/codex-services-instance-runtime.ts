import { randomUUID } from 'node:crypto'
import { join, relative, resolve, sep } from 'node:path'
import { promises as fs } from 'node:fs'
import { parse as parseToml, stringify as stringifyToml } from '@iarna/toml'

import type { ConfigGuard } from './codex-config-guard'

import type { CodexAuthPayload } from './codex-auth'
import type { PersistedCodexInstance, PersistedDefaultCodexInstance } from './codex-instances'
import {
  launchCodexDesktop,
  revealCodexDesktop,
  resolveAnyCodexDesktopPid,
  resolveManagedCodexPid,
  stopCodexProcess,
  writeAuthPayloadToCodexHome,
  writeProviderApiKeyToCodexHome,
  writeProviderConfigToCodexHome
} from './codex-launcher'
import {
  isAccountHealthBlocking,
  isLocalMockAccount,
  localGatewayBaseUrl,
  normalizeLocalGatewaySettings,
  type AccountSummary,
  type AppSnapshot,
  type CodexInstanceSummary,
  type CustomProviderSummary,
  type OpenCodexFromServiceInput,
  type OpenCodexFromServiceResult,
  type OpenCodexFromServiceTarget
} from '../shared/codex'
import {
  DEFAULT_CODEX_INSTANCE_ID,
  LOCAL_MOCK_OPEN_ERROR,
  LOCAL_MOCK_OPEN_ISOLATED_ERROR,
  accountInstanceLabel,
  authRefreshReason,
  customProviderLabel,
  resolveOptionalAccountId,
  type CodexServicesRuntimeContext
} from './codex-services-shared'
import type { CodexServicesAuthRuntime } from './codex-services-auth-runtime'

export interface CodexServicesInstanceRuntime {
  prepareLaunchAuthPayload(accountId: string): Promise<CodexAuthPayload>
  refreshExpiringAccountSession(accountId: string): Promise<boolean>
  resolveAccountIdOrThrow(explicitAccountId?: string): Promise<string>
  resolveAccountsForExport(accountIds?: string[]): Promise<AccountSummary[]>
  toInstanceSummary(instance: PersistedCodexInstance): Promise<CodexInstanceSummary>
  toDefaultInstanceSummary(instance: PersistedDefaultCodexInstance): Promise<CodexInstanceSummary>
  listCodexInstances(): Promise<CodexInstanceSummary[]>
  getSnapshot(): Promise<AppSnapshot>
  getDesktopExecutablePathOverride(): Promise<string | undefined>
  startDefaultInstance(workspacePath: string, accountId?: string): Promise<CodexInstanceSummary>
  revealRunningCodex(): Promise<void>
  showDefaultCodex(workspacePath: string): Promise<CodexInstanceSummary>
  startNamedInstance(instanceId: string, workspacePath: string): Promise<CodexInstanceSummary>
  startAccountInstance(accountId: string, workspacePath: string): Promise<CodexInstanceSummary>
  startProviderInstance(providerId: string, workspacePath: string): Promise<CustomProviderSummary>
  startDirectProviderInstance(
    providerId: string,
    workspacePath: string
  ): Promise<CustomProviderSummary>
  syncLocalGatewayInstanceConfig(input: {
    baseUrl: string
    apiKey: string
    create?: boolean
  }): Promise<CodexInstanceSummary | null>
  startLocalGatewayInstance(input: {
    baseUrl: string
    apiKey: string
    workspacePath: string
  }): Promise<CodexInstanceSummary>
  startDirectLocalGatewayInstance(input: {
    baseUrl: string
    apiKey: string
    workspacePath: string
  }): Promise<CodexInstanceSummary>
  openFromService(input?: OpenCodexFromServiceInput): Promise<OpenCodexFromServiceResult>
  stopInstance(instanceId: string): Promise<CodexInstanceSummary>
}

export function createCodexServicesInstanceRuntime(
  context: CodexServicesRuntimeContext,
  authRuntime: CodexServicesAuthRuntime,
  configGuard: ConfigGuard
): CodexServicesInstanceRuntime {
  const { store, instanceStore, providerStore, loginCoordinator } = context
  const { refreshAuthForUse, refreshStoredAuthGuarded } = authRuntime
  const serviceLaunchConfigEntries = new Set([
    'auth.json',
    'config.toml',
    'memory.md',
    'instructions.md',
    'prompts',
    'automations'
  ])

  async function assertAccountHealthAllowsUse(accountId: string): Promise<void> {
    const snapshot = await store.getSnapshot(loginCoordinator.isRunning())
    if (isAccountHealthBlocking((snapshot.accountHealthByAccountId ?? {})[accountId])) {
      throw new Error(
        'Account is marked as auth_error. Repair it and mark it normal before using it.'
      )
    }
  }
  const localGatewayInstanceName = 'Local Gateway'
  const localGatewayProviderModel = 'gpt-5.4'

  function normalizeBaseUrl(value: string): string {
    return value.trim().replace(/\/+$/u, '').toLowerCase()
  }

  function addUniqueProviderId(ids: string[], providerId: string): void {
    if (!ids.includes(providerId)) {
      ids.push(providerId)
    }
  }

  function collectProviderIdsFromConfig(
    config: Record<string, unknown>,
    providers: CustomProviderSummary[]
  ): string[] {
    const ids: string[] = []
    const modelProviders =
      config.model_providers && typeof config.model_providers === 'object'
        ? (config.model_providers as Record<string, unknown>)
        : {}

    for (const rawProvider of Object.values(modelProviders)) {
      if (!rawProvider || typeof rawProvider !== 'object') {
        continue
      }

      const providerConfig = rawProvider as Record<string, unknown>
      const baseUrl = typeof providerConfig.base_url === 'string' ? providerConfig.base_url : ''
      const name = typeof providerConfig.name === 'string' ? providerConfig.name.trim() : ''
      const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
      const matched = providers.find((provider) => {
        if (normalizedBaseUrl && normalizeBaseUrl(provider.baseUrl) === normalizedBaseUrl) {
          return true
        }

        return Boolean(name && provider.name?.trim() === name)
      })

      if (matched) {
        addUniqueProviderId(ids, matched.id)
      }
    }

    return ids
  }

  async function resolveInstanceProviderIds(codexHome: string): Promise<string[]> {
    const providers = await providerStore.list()
    const ids: string[] = []
    const normalizedCodexHome = resolve(codexHome).replace(/\\/gu, '/')

    for (const provider of providers) {
      if (normalizedCodexHome.endsWith(`/provider-${provider.id}`)) {
        addUniqueProviderId(ids, provider.id)
      }
    }

    try {
      const raw = await fs.readFile(join(codexHome, 'config.toml'), 'utf8')
      const config = raw.trim() ? (parseToml(raw) as Record<string, unknown>) : {}
      for (const providerId of collectProviderIdsFromConfig(config, providers)) {
        addUniqueProviderId(ids, providerId)
      }
    } catch {
      // Missing or invalid config should not block instance listing.
    }

    return ids
  }

  async function assertDefaultCodexLaunchAllowed(explicitAccountId?: string): Promise<void> {
    if (explicitAccountId) {
      await assertAccountHealthAllowsUse(explicitAccountId)
      if (isLocalMockAccount(await store.getAccountSummary(explicitAccountId))) {
        throw new Error(LOCAL_MOCK_OPEN_ERROR)
      }
      return
    }

    const defaultInstance = await instanceStore.getDefaultInstance()
    if (defaultInstance.bindAccountId) {
      await assertAccountHealthAllowsUse(defaultInstance.bindAccountId)
      if (isLocalMockAccount(await store.getAccountSummary(defaultInstance.bindAccountId))) {
        throw new Error(LOCAL_MOCK_OPEN_ERROR)
      }
      return
    }

    const snapshot = await store.getSnapshot(loginCoordinator.isRunning())
    if (
      snapshot.currentSession?.storedAccountId &&
      isAccountHealthBlocking(
        (snapshot.accountHealthByAccountId ?? {})[snapshot.currentSession.storedAccountId]
      )
    ) {
      throw new Error(
        'Account is marked as auth_error. Repair it and mark it normal before using it.'
      )
    }
    if (isLocalMockAccount(snapshot.currentSession)) {
      throw new Error(LOCAL_MOCK_OPEN_ERROR)
    }
  }

  async function assertIsolatedCodexLaunchAllowed(bindAccountId?: string): Promise<void> {
    if (bindAccountId) {
      await assertAccountHealthAllowsUse(bindAccountId)
      if (isLocalMockAccount(await store.getAccountSummary(bindAccountId))) {
        throw new Error(LOCAL_MOCK_OPEN_ISOLATED_ERROR)
      }
      return
    }

    const snapshot = await store.getSnapshot(loginCoordinator.isRunning())
    if (isLocalMockAccount(snapshot.currentSession)) {
      throw new Error(LOCAL_MOCK_OPEN_ISOLATED_ERROR)
    }
  }

  async function prepareLaunchAuthPayload(accountId: string): Promise<CodexAuthPayload> {
    await assertAccountHealthAllowsUse(accountId)
    const storedAuth = await store.getStoredAuthPayload(accountId)

    return (
      await refreshAuthForUse(accountId, storedAuth, {
        allowStaleFallback: true
      })
    ).auth
  }

  async function refreshExpiringAccountSession(accountId: string): Promise<boolean> {
    const account = await store.getAccountSummary(accountId)
    if (isLocalMockAccount(account)) {
      return false
    }

    const storedAuth = await store.getStoredAuthPayload(accountId)

    if (!authRefreshReason(storedAuth)) {
      return false
    }

    try {
      const refreshed = await refreshStoredAuthGuarded(accountId, storedAuth)
      if (refreshed.refreshed) {
        await store.clearAccountUsageError(refreshed.accountId)
      }
      return refreshed.refreshed
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Failed to refresh account session.'
      await store.saveAccountUsageError(accountId, detail)
      throw error
    }
  }

  async function resolveAccountIdOrThrow(explicitAccountId?: string): Promise<string> {
    if (explicitAccountId) {
      await assertAccountHealthAllowsUse(explicitAccountId)
      return explicitAccountId
    }

    const snapshot = await getSnapshot()
    const resolved = resolveOptionalAccountId(snapshot)
    if (!resolved) {
      throw new Error('Account not found.')
    }

    await assertAccountHealthAllowsUse(resolved)
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
      initialized: await instanceStore.isInitialized(instance.codexHome),
      providerIds: await resolveInstanceProviderIds(instance.codexHome)
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
      initialized: await instanceStore.isInitialized(defaultCodexHome),
      providerIds: await resolveInstanceProviderIds(defaultCodexHome)
    }
  }

  async function listCodexInstances(): Promise<CodexInstanceSummary[]> {
    const defaultInstance = await instanceStore.getDefaultInstance()
    const instances = await instanceStore.list()
    return Promise.all([
      toDefaultInstanceSummary(defaultInstance),
      ...instances.map((instance) => toInstanceSummary(instance))
    ])
  }

  async function getSnapshot(): Promise<AppSnapshot> {
    const [snapshot, providers, codexInstances] = await Promise.all([
      store.getSnapshot(loginCoordinator.isRunning()),
      providerStore.list(),
      listCodexInstances()
    ])

    return {
      ...snapshot,
      providers,
      codexInstances,
      codexInstanceDefaults: instanceStore.getDefaults()
    }
  }

  async function getDesktopExecutablePathOverride(): Promise<string | undefined> {
    const snapshot = await store.getSnapshot(loginCoordinator.isRunning())
    const value = snapshot.settings.codexDesktopExecutablePath.trim()
    return value || undefined
  }

  function serviceLaunchSlug(value: string): string {
    return (
      value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'codex'
    )
  }

  function serviceTargetKind(input?: OpenCodexFromServiceInput): OpenCodexFromServiceTarget {
    switch (input?.target ?? 'default') {
      case 'default':
      case 'account':
      case 'provider':
      case 'instance':
      case 'localGateway':
        return input?.target ?? 'default'
      default:
        throw new Error('Unsupported Codex open target.')
    }
  }

  async function pathExists(value: string): Promise<boolean> {
    try {
      await fs.access(value)
      return true
    } catch {
      return false
    }
  }

  async function copyServiceLaunchHome(
    sourceCodexHome: string,
    targetCodexHome: string
  ): Promise<void> {
    await fs.mkdir(targetCodexHome, { recursive: true })
    try {
      await fs.cp(sourceCodexHome, targetCodexHome, {
        recursive: true,
        force: true,
        filter: (sourcePath) => {
          const relativePath = relative(sourceCodexHome, sourcePath)
          if (!relativePath) {
            return true
          }

          return serviceLaunchConfigEntries.has(relativePath.split(sep)[0] ?? '')
        }
      })
    } catch {
      // Missing source homes are valid for first launches; the target directory was created above.
    }
  }

  function serviceLaunchHome(target: string): string {
    const { rootDir } = instanceStore.getDefaults()
    return join(rootDir, `service-launch-${serviceLaunchSlug(target)}-${randomUUID().slice(0, 8)}`)
  }

  function localGatewayCodexHome(): string {
    const { rootDir } = instanceStore.getDefaults()
    return join(rootDir, 'local-gateway')
  }

  function isLocalGatewayCodexHome(codexHome: string): boolean {
    return resolve(codexHome) === resolve(localGatewayCodexHome())
  }

  function localGatewayProviderBaseUrl(baseUrl: string): string {
    return `${baseUrl.replace(/\/+$/u, '')}/v1`
  }

  async function resolveLocalGatewayOpenConfig(): Promise<{ baseUrl: string; apiKey: string }> {
    const settings = normalizeLocalGatewaySettings((await store.getSettings()).localGateway)
    const apiKey =
      typeof settings.apiKey === 'string'
        ? settings.apiKey
        : settings.apiKey
          ? context.options.platform.unprotect(settings.apiKey)
          : ''

    if (!apiKey) {
      throw new Error('Local gateway API key is required.')
    }

    return {
      baseUrl: localGatewayBaseUrl(settings),
      apiKey
    }
  }

  async function launchServiceCodex(input: {
    workspacePath: string
    codexHome: string
    extraArgs: string
    preferAppBundle: boolean
    requireDesktopExecutable: boolean
  }): Promise<number> {
    return launchCodexDesktop({
      workspacePath: input.workspacePath,
      codexHome: input.codexHome,
      extraArgs: input.extraArgs,
      preferAppBundle: input.preferAppBundle,
      requireDesktopExecutable: input.requireDesktopExecutable,
      desktopExecutablePath: await getDesktopExecutablePathOverride()
    })
  }

  function removeConfigKey(config: Record<string, unknown>, key: string): boolean {
    if (!Object.prototype.hasOwnProperty.call(config, key)) {
      return false
    }

    delete config[key]
    return true
  }

  async function clearDefaultConfigProviderOverrides(): Promise<void> {
    const { defaultCodexHome } = instanceStore.getDefaults()
    const configPath = join(defaultCodexHome, 'config.toml')
    let rawConfig: string
    try {
      rawConfig = await fs.readFile(configPath, 'utf8')
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return
      }
      throw error
    }

    let nextConfig: Record<string, unknown>
    let shouldWrite = false
    try {
      nextConfig = rawConfig.trim() ? (parseToml(rawConfig) as Record<string, unknown>) : {}
    } catch {
      nextConfig = {}
      shouldWrite = true
    }

    shouldWrite = removeConfigKey(nextConfig, 'model') || shouldWrite
    shouldWrite = removeConfigKey(nextConfig, 'model_provider') || shouldWrite
    shouldWrite = removeConfigKey(nextConfig, 'model_providers') || shouldWrite

    const feature = nextConfig['feature']
    if (feature && typeof feature === 'object' && !Array.isArray(feature)) {
      const nextFeature = { ...(feature as Record<string, unknown>) }
      if (removeConfigKey(nextFeature, 'fast_mode')) {
        shouldWrite = true
        if (Object.keys(nextFeature).length) {
          nextConfig['feature'] = nextFeature
        } else {
          delete nextConfig['feature']
        }
      }
    }

    if (!shouldWrite) {
      return
    }

    const tomlContent = Object.keys(nextConfig).length
      ? stringifyToml(nextConfig as Parameters<typeof stringifyToml>[0])
      : ''
    if (tomlContent) {
      parseToml(tomlContent)
    }

    await configGuard.guardBeforeWrite(configPath)
    await fs.mkdir(defaultCodexHome, { recursive: true })
    const tmpConfig = `${configPath}.${process.pid}.${randomUUID()}.tmp`
    try {
      await fs.writeFile(tmpConfig, tomlContent ? `${tomlContent}\n` : '', 'utf8')
      await fs.rename(tmpConfig, configPath)
    } finally {
      await fs.rm(tmpConfig, { force: true })
    }
    await configGuard.recordWriteComplete(configPath)
  }

  async function startDefaultInstance(
    workspacePath: string,
    accountId?: string
  ): Promise<CodexInstanceSummary> {
    await assertDefaultCodexLaunchAllowed(accountId)

    const defaultInstance = await instanceStore.getDefaultInstance()
    const targetAccountId = accountId ?? defaultInstance.bindAccountId

    if (targetAccountId) {
      await prepareLaunchAuthPayload(targetAccountId)
      await clearDefaultConfigProviderOverrides()
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

  async function revealRunningCodex(): Promise<void> {
    await revealCodexDesktop({
      desktopExecutablePath: await getDesktopExecutablePathOverride()
    })
  }

  async function showDefaultCodex(workspacePath: string): Promise<CodexInstanceSummary> {
    await assertDefaultCodexLaunchAllowed()

    const defaultInstance = await instanceStore.getDefaultInstance()
    const { defaultCodexHome } = instanceStore.getDefaults()

    const defaultRunningPid = await resolveManagedCodexPid(
      defaultCodexHome,
      defaultInstance.lastPid
    )
    if (defaultRunningPid) {
      await revealRunningCodex()
      return toDefaultInstanceSummary(defaultInstance)
    }

    for (const instance of await instanceStore.list()) {
      if (resolve(instance.codexHome) === resolve(defaultCodexHome)) {
        continue
      }

      const runningPid = await resolveManagedCodexPid(instance.codexHome, instance.lastPid)
      if (runningPid) {
        await revealRunningCodex()
        return toDefaultInstanceSummary(defaultInstance)
      }
    }

    const anyRunningPid = await resolveAnyCodexDesktopPid()
    if (anyRunningPid) {
      await revealRunningCodex()
      return toDefaultInstanceSummary(defaultInstance)
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
    if (isLocalGatewayCodexHome(instance.codexHome)) {
      const gateway = await resolveLocalGatewayOpenConfig()
      return startLocalGatewayInstance({
        ...gateway,
        workspacePath
      })
    }

    await assertIsolatedCodexLaunchAllowed(instance.bindAccountId)
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
    if (isLocalMockAccount(account)) {
      throw new Error(LOCAL_MOCK_OPEN_ISOLATED_ERROR)
    }

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

  async function startDirectProviderInstance(
    providerId: string,
    workspacePath: string
  ): Promise<CustomProviderSummary> {
    const provider = await providerStore.getResolvedProvider(providerId)
    const { defaultCodexHome } = instanceStore.getDefaults()

    const configPath = join(defaultCodexHome, 'config.toml')
    const authPath = join(defaultCodexHome, 'auth.json')

    await configGuard.guardBeforeWrite(configPath)
    await configGuard.guardBeforeWrite(authPath, { sensitive: true })

    let nextConfig: Record<string, unknown> = {}
    try {
      const raw = await fs.readFile(configPath, 'utf8')
      nextConfig = raw.trim() ? (parseToml(raw) as Record<string, unknown>) : {}
    } catch {
      nextConfig = {}
    }

    const modelProviders =
      nextConfig['model_providers'] && typeof nextConfig['model_providers'] === 'object'
        ? { ...(nextConfig['model_providers'] as Record<string, unknown>) }
        : {}
    modelProviders['custom'] = {
      name: provider.summary.name?.trim() || 'custom',
      wire_api: 'responses',
      requires_openai_auth: true,
      base_url: provider.summary.baseUrl
    }

    const feature =
      nextConfig['feature'] && typeof nextConfig['feature'] === 'object'
        ? { ...(nextConfig['feature'] as Record<string, unknown>) }
        : {}
    feature['fast_mode'] = provider.summary.fastMode

    nextConfig['model'] = provider.summary.model?.trim() || '5.4'
    nextConfig['model_provider'] = 'custom'
    nextConfig['model_providers'] = modelProviders
    nextConfig['feature'] = feature

    const tomlContent = stringifyToml(nextConfig as Parameters<typeof stringifyToml>[0])
    parseToml(tomlContent)

    await fs.mkdir(defaultCodexHome, { recursive: true })
    const tmpConfig = `${configPath}.${process.pid}.${randomUUID()}.tmp`
    try {
      await fs.writeFile(tmpConfig, `${tomlContent}\n`, 'utf8')
      await fs.rename(tmpConfig, configPath)
    } catch (error) {
      await fs.rm(tmpConfig, { force: true })
      throw error
    }

    await configGuard.recordWriteComplete(configPath)
    await writeProviderApiKeyToCodexHome(defaultCodexHome, provider.apiKey)
    await configGuard.recordWriteComplete(authPath)

    const defaultInstance = await instanceStore.getDefaultInstance()
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

    await instanceStore.updateDefaultInstance({ lastPid: pid, touchLaunch: true })
    return providerStore.markUsed(providerId)
  }

  async function ensureLocalGatewayInstance(): Promise<PersistedCodexInstance> {
    const codexHome = localGatewayCodexHome()
    const existing = (await instanceStore.list()).find(
      (instance) => resolve(instance.codexHome) === resolve(codexHome)
    )
    if (existing) {
      return existing
    }

    return instanceStore.create({
      name: localGatewayInstanceName,
      codexHome
    })
  }

  async function syncLocalGatewayInstanceConfig(input: {
    baseUrl: string
    apiKey: string
    create?: boolean
  }): Promise<CodexInstanceSummary | null> {
    const codexHome = localGatewayCodexHome()
    const existing = (await instanceStore.list()).find(
      (instance) => resolve(instance.codexHome) === resolve(codexHome)
    )
    if (!input.create && !existing && !(await pathExists(codexHome))) {
      return null
    }

    const instance = existing ?? (input.create ? await ensureLocalGatewayInstance() : undefined)
    await instanceStore.ensureInitialized(codexHome)
    await instanceStore.syncConfigFromDefault(codexHome)
    await writeProviderApiKeyToCodexHome(codexHome, input.apiKey)
    await writeProviderConfigToCodexHome(codexHome, {
      name: localGatewayInstanceName,
      baseUrl: localGatewayProviderBaseUrl(input.baseUrl),
      model: localGatewayProviderModel,
      fastMode: true
    })

    return instance ? toInstanceSummary(instance) : null
  }

  async function startLocalGatewayInstance(input: {
    baseUrl: string
    apiKey: string
    workspacePath: string
  }): Promise<CodexInstanceSummary> {
    const instance =
      (await syncLocalGatewayInstanceConfig({
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
        create: true
      })) ?? (await toInstanceSummary(await ensureLocalGatewayInstance()))

    const runningPid = await resolveManagedCodexPid(instance.codexHome, instance.lastPid)
    if (runningPid) {
      await stopCodexProcess(runningPid)
    }

    const persisted = await ensureLocalGatewayInstance()
    const pid = await launchServiceCodex({
      workspacePath: input.workspacePath,
      codexHome: persisted.codexHome,
      extraArgs: persisted.extraArgs,
      preferAppBundle: true,
      requireDesktopExecutable: true
    })

    return toInstanceSummary(await instanceStore.markLaunched(persisted.id, pid))
  }

  async function startDirectLocalGatewayInstance(input: {
    baseUrl: string
    apiKey: string
    workspacePath: string
  }): Promise<CodexInstanceSummary> {
    const { defaultCodexHome } = instanceStore.getDefaults()
    const configPath = join(defaultCodexHome, 'config.toml')
    const authPath = join(defaultCodexHome, 'auth.json')

    await configGuard.guardBeforeWrite(configPath)
    await configGuard.guardBeforeWrite(authPath, { sensitive: true })

    await writeProviderConfigToCodexHome(defaultCodexHome, {
      name: localGatewayInstanceName,
      baseUrl: localGatewayProviderBaseUrl(input.baseUrl),
      model: localGatewayProviderModel,
      fastMode: true
    })
    await configGuard.recordWriteComplete(configPath)

    await writeProviderApiKeyToCodexHome(defaultCodexHome, input.apiKey)
    await configGuard.recordWriteComplete(authPath)

    const defaultInstance = await instanceStore.getDefaultInstance()
    const runningPid = await resolveManagedCodexPid(defaultCodexHome, defaultInstance.lastPid)
    if (runningPid) {
      await stopCodexProcess(runningPid)
    }

    const pid = await launchCodexDesktop({
      workspacePath: input.workspacePath,
      codexHome: defaultCodexHome,
      extraArgs: defaultInstance.extraArgs,
      preferAppBundle: false,
      requireDesktopExecutable: false,
      desktopExecutablePath: await getDesktopExecutablePathOverride()
    })

    return toDefaultInstanceSummary(
      await instanceStore.updateDefaultInstance({ lastPid: pid, touchLaunch: true })
    )
  }

  function requiredServiceTargetId(value: string | undefined, label: string): string {
    const normalized = value?.trim()
    if (!normalized) {
      throw new Error(`${label} is required.`)
    }
    return normalized
  }

  function serviceTargetName(
    target: OpenCodexFromServiceTarget,
    value: { name?: string; email?: string; accountId?: string; baseUrl?: string; id?: string }
  ): string {
    switch (target) {
      case 'default':
        return 'Default'
      case 'account':
        return value.email ?? value.name ?? value.accountId ?? value.id ?? 'Account'
      case 'provider':
        return value.name ?? value.baseUrl ?? value.id ?? 'Provider'
      case 'instance':
        return value.name ?? value.id ?? 'Instance'
      case 'localGateway':
        return localGatewayInstanceName
    }
  }

  async function openManagedFromService(input: {
    target: OpenCodexFromServiceTarget
    workspacePath: string
    accountId?: string
    providerId?: string
    instanceId?: string
  }): Promise<OpenCodexFromServiceResult> {
    switch (input.target) {
      case 'default': {
        const summary = await startDefaultInstance(input.workspacePath)
        return {
          ok: true,
          pid: summary.lastPid,
          codexHome: summary.codexHome,
          workspacePath: input.workspacePath,
          multi: false,
          target: {
            type: 'default',
            name: serviceTargetName('default', {})
          }
        }
      }
      case 'account': {
        const accountId = await resolveAccountIdOrThrow(input.accountId)
        const account = await store.getAccountSummary(accountId)
        const summary = await startDefaultInstance(input.workspacePath, accountId)
        return {
          ok: true,
          pid: summary.lastPid,
          codexHome: summary.codexHome,
          workspacePath: input.workspacePath,
          multi: false,
          target: {
            type: 'account',
            id: accountId,
            name: serviceTargetName('account', account)
          }
        }
      }
      case 'provider': {
        const providerId = requiredServiceTargetId(input.providerId, 'Provider id')
        const provider = await startDirectProviderInstance(providerId, input.workspacePath)
        const { defaultCodexHome } = instanceStore.getDefaults()
        const defaultInstance = await instanceStore.getDefaultInstance()
        return {
          ok: true,
          pid: defaultInstance.lastPid,
          codexHome: defaultCodexHome,
          workspacePath: input.workspacePath,
          multi: false,
          target: {
            type: 'provider',
            id: providerId,
            name: serviceTargetName('provider', provider)
          }
        }
      }
      case 'instance': {
        const instanceId = requiredServiceTargetId(input.instanceId, 'Instance id')
        const summary = await startNamedInstance(instanceId, input.workspacePath)
        return {
          ok: true,
          pid: summary.lastPid,
          codexHome: summary.codexHome,
          workspacePath: input.workspacePath,
          multi: false,
          target: {
            type: 'instance',
            id: instanceId,
            name: serviceTargetName('instance', summary)
          }
        }
      }
      case 'localGateway': {
        const gateway = await resolveLocalGatewayOpenConfig()
        const summary = await startDirectLocalGatewayInstance({
          ...gateway,
          workspacePath: input.workspacePath
        })
        return {
          ok: true,
          pid: summary.lastPid,
          codexHome: summary.codexHome,
          workspacePath: input.workspacePath,
          multi: false,
          target: {
            type: 'localGateway',
            name: serviceTargetName('localGateway', summary)
          }
        }
      }
    }
  }

  async function openMultiFromService(input: {
    target: OpenCodexFromServiceTarget
    workspacePath: string
    accountId?: string
    providerId?: string
    instanceId?: string
  }): Promise<OpenCodexFromServiceResult> {
    const { defaultCodexHome } = instanceStore.getDefaults()

    switch (input.target) {
      case 'default': {
        await assertDefaultCodexLaunchAllowed()
        const defaultInstance = await instanceStore.getDefaultInstance()
        const codexHome = serviceLaunchHome('default')
        await copyServiceLaunchHome(defaultCodexHome, codexHome)
        if (defaultInstance.bindAccountId) {
          const authPayload = await prepareLaunchAuthPayload(defaultInstance.bindAccountId)
          await writeAuthPayloadToCodexHome(codexHome, authPayload)
        }
        const pid = await launchServiceCodex({
          workspacePath: input.workspacePath,
          codexHome,
          extraArgs: defaultInstance.extraArgs,
          preferAppBundle: false,
          requireDesktopExecutable: false
        })
        return {
          ok: true,
          pid,
          codexHome,
          workspacePath: input.workspacePath,
          multi: true,
          target: {
            type: 'default',
            name: serviceTargetName('default', {})
          }
        }
      }
      case 'account': {
        const accountId = await resolveAccountIdOrThrow(input.accountId)
        const account = await store.getAccountSummary(accountId)
        await assertIsolatedCodexLaunchAllowed(accountId)
        const existingInstance = await instanceStore.findByBoundAccountId(accountId)
        const codexHome = serviceLaunchHome(`account-${accountId}`)
        await copyServiceLaunchHome(existingInstance?.codexHome ?? defaultCodexHome, codexHome)
        const authPayload = await prepareLaunchAuthPayload(accountId)
        await writeAuthPayloadToCodexHome(codexHome, authPayload)
        const pid = await launchServiceCodex({
          workspacePath: input.workspacePath,
          codexHome,
          extraArgs: existingInstance?.extraArgs ?? '',
          preferAppBundle: true,
          requireDesktopExecutable: true
        })
        return {
          ok: true,
          pid,
          codexHome,
          workspacePath: input.workspacePath,
          multi: true,
          target: {
            type: 'account',
            id: accountId,
            name: serviceTargetName('account', account)
          }
        }
      }
      case 'provider': {
        const providerId = requiredServiceTargetId(input.providerId, 'Provider id')
        const provider = await providerStore.getResolvedProvider(providerId)
        const { rootDir } = instanceStore.getDefaults()
        const providerCodexHome = join(rootDir, `provider-${providerId}`)
        const existingInstance = (await instanceStore.list()).find(
          (item) => resolve(item.codexHome) === resolve(providerCodexHome)
        )
        const codexHome = serviceLaunchHome(`provider-${providerId}`)
        await copyServiceLaunchHome(existingInstance?.codexHome ?? defaultCodexHome, codexHome)
        await writeProviderApiKeyToCodexHome(codexHome, provider.apiKey)
        await writeProviderConfigToCodexHome(codexHome, provider.summary)
        const pid = await launchServiceCodex({
          workspacePath: input.workspacePath,
          codexHome,
          extraArgs: existingInstance?.extraArgs ?? '',
          preferAppBundle: true,
          requireDesktopExecutable: true
        })
        await providerStore.markUsed(providerId)
        return {
          ok: true,
          pid,
          codexHome,
          workspacePath: input.workspacePath,
          multi: true,
          target: {
            type: 'provider',
            id: providerId,
            name: serviceTargetName('provider', provider.summary)
          }
        }
      }
      case 'instance': {
        const instanceId = requiredServiceTargetId(input.instanceId, 'Instance id')
        const instance = await instanceStore.getInstance(instanceId)
        await assertIsolatedCodexLaunchAllowed(instance.bindAccountId)
        const codexHome = serviceLaunchHome(`instance-${instance.id}`)
        await copyServiceLaunchHome(instance.codexHome, codexHome)
        if (instance.bindAccountId) {
          const authPayload = await prepareLaunchAuthPayload(instance.bindAccountId)
          await writeAuthPayloadToCodexHome(codexHome, authPayload)
        }
        const pid = await launchServiceCodex({
          workspacePath: input.workspacePath,
          codexHome,
          extraArgs: instance.extraArgs,
          preferAppBundle: true,
          requireDesktopExecutable: true
        })
        return {
          ok: true,
          pid,
          codexHome,
          workspacePath: input.workspacePath,
          multi: true,
          target: {
            type: 'instance',
            id: instanceId,
            name: serviceTargetName('instance', instance)
          }
        }
      }
      case 'localGateway': {
        const gateway = await resolveLocalGatewayOpenConfig()
        const summary = await startLocalGatewayInstance({
          ...gateway,
          workspacePath: input.workspacePath
        })
        return {
          ok: true,
          pid: summary.lastPid,
          codexHome: summary.codexHome,
          workspacePath: input.workspacePath,
          multi: true,
          target: {
            type: 'localGateway',
            name: serviceTargetName('localGateway', summary)
          }
        }
      }
    }
  }

  async function openFromService(
    input: OpenCodexFromServiceInput = {}
  ): Promise<OpenCodexFromServiceResult> {
    const target = serviceTargetKind(input)
    const workspacePath = input.workspacePath?.trim() || context.options.defaultWorkspacePath
    const payload = {
      target,
      workspacePath,
      accountId: input.accountId,
      providerId: input.providerId,
      instanceId: input.instanceId
    }

    if (input.multi === true) {
      return openMultiFromService(payload)
    }

    return openManagedFromService(payload)
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
    prepareLaunchAuthPayload,
    refreshExpiringAccountSession,
    resolveAccountIdOrThrow,
    resolveAccountsForExport,
    toInstanceSummary,
    toDefaultInstanceSummary,
    listCodexInstances,
    getSnapshot,
    getDesktopExecutablePathOverride,
    startDefaultInstance,
    revealRunningCodex,
    showDefaultCodex,
    startNamedInstance,
    startAccountInstance,
    startProviderInstance,
    startDirectProviderInstance,
    syncLocalGatewayInstanceConfig,
    startLocalGatewayInstance,
    startDirectLocalGatewayInstance,
    openFromService,
    stopInstance
  }
}
