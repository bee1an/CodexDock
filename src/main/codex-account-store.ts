import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'

import type {
  AccountHealthSource,
  AccountRateLimits,
  AccountSummary,
  AccountGroup,
  AccountTokensDetail,
  AccountWakeSchedule,
  AppSettings,
  AppSnapshot,
  CurrentSessionSummary,
  UpdateAccountHealthInput,
  UpdateAccountTokensInput,
  UpdateAccountWakeScheduleInput
} from '../shared/codex'
import type { CodexPlatformAdapter, ProtectedPayload } from '../shared/codex-platform'
import type { ConfigGuard } from './codex-config-guard'
import { decodeJwtPayload } from '../shared/openai-auth'
import {
  defaultWakeModel,
  normalizeLocalGatewaySettings,
  normalizeStatsDisplaySettings
} from '../shared/codex'
import {
  type CodexAuthPayload,
  type LegacyPersistedState,
  type PersistedAccount,
  type PersistedState,
  defaultState,
  dedupeAccountGroupIds,
  describeError,
  findMatchingAccount,
  normalizePersistedState,
  normalizeGroupName,
  normalizeWakeSchedule,
  resolveAccountId,
  summarizeAuth,
  toAccountSummary
} from './codex-auth-shared'

function normalizeTokenInput(
  value: string | undefined,
  fallback: string | undefined
): string | undefined {
  if (value === undefined) {
    return fallback
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export class CodexAccountStore {
  private readonly stateFile: string
  private readonly stateBackupFile: string
  private readonly codexAuthFile: string
  private stateQueue: Promise<void> = Promise.resolve()

  constructor(
    userDataPath: string,
    private readonly platform: CodexPlatformAdapter,
    private readonly defaultCodexHome = join(process.env.HOME ?? '', '.codex'),
    private readonly configGuard?: ConfigGuard
  ) {
    this.stateFile = join(userDataPath, 'codex-accounts.json')
    this.stateBackupFile = `${this.stateFile}.bak`
    this.codexAuthFile = join(this.defaultCodexHome, 'auth.json')
  }

  async getSnapshot(loginInProgress: boolean): Promise<AppSnapshot> {
    return this.runStateTask(async () => {
      const state = await this.readState()
      const currentSession = await this.getCurrentSession(state)
      const resolvedActiveAccountId = currentSession?.storedAccountId

      if (state.activeAccountId !== resolvedActiveAccountId) {
        state.activeAccountId = resolvedActiveAccountId
        await this.writeState(state)
      }

      return {
        accounts: state.accounts.map((account) => this.toAccountSummary(account)),
        providers: [],
        groups: state.groups,
        codexInstances: [],
        codexInstanceDefaults: {
          rootDir: '',
          defaultCodexHome: this.defaultCodexHome
        },
        activeAccountId: resolvedActiveAccountId,
        currentSession,
        loginInProgress,
        settings: state.settings,
        usageByAccountId: state.usageByAccountId,
        usageErrorByAccountId: state.usageErrorByAccountId,
        accountHealthByAccountId: state.accountHealthByAccountId,
        wakeSchedulesByAccountId: state.wakeSchedulesByAccountId,
        tokenCostByInstanceId: {},
        tokenCostErrorByInstanceId: {},
        runningTokenCostSummary: null,
        runningTokenCostInstanceIds: [],
        localGatewayStatus: {
          running: false,
          baseUrl: '',
          apiKeyPreview: ''
        }
      }
    })
  }

  async getSettings(): Promise<AppSettings> {
    return this.runStateTask(async () => (await this.readState()).settings)
  }

  async updateSettings(nextSettings: Partial<AppSettings>): Promise<void> {
    await this.runStateTask(async () => {
      const state = await this.readState()
      state.settings = {
        ...state.settings,
        ...nextSettings,
        statsDisplay: normalizeStatsDisplaySettings(
          nextSettings.statsDisplay ?? state.settings.statsDisplay
        ),
        localGateway: normalizeLocalGatewaySettings(
          nextSettings.localGateway ?? state.settings.localGateway
        ),
        statusBarAccountIds: (
          nextSettings.statusBarAccountIds ?? state.settings.statusBarAccountIds
        ).slice(0, 5)
      }
      await this.writeState(state)
    })
  }

  async saveAccountRateLimits(accountId: string, rateLimits: AccountRateLimits): Promise<void> {
    await this.runStateTask(async () => {
      const state = await this.readState()

      if (!state.accounts.some((account) => account.id === accountId)) {
        throw new Error('Account not found.')
      }

      state.usageByAccountId = {
        ...state.usageByAccountId,
        [accountId]: rateLimits
      }
      await this.writeState(state)
    })
  }

  async clearAccountRateLimits(accountId: string): Promise<void> {
    await this.runStateTask(async () => {
      const state = await this.readState()

      if (!state.accounts.some((account) => account.id === accountId)) {
        throw new Error('Account not found.')
      }

      if (!(accountId in state.usageByAccountId)) {
        return
      }

      const nextUsageByAccountId = { ...state.usageByAccountId }
      delete nextUsageByAccountId[accountId]
      state.usageByAccountId = nextUsageByAccountId
      await this.writeState(state)
    })
  }

  async saveAccountUsageError(accountId: string, message: string): Promise<void> {
    await this.runStateTask(async () => {
      const state = await this.readState()

      if (!state.accounts.some((account) => account.id === accountId)) {
        throw new Error('Account not found.')
      }

      state.usageErrorByAccountId = {
        ...state.usageErrorByAccountId,
        [accountId]: message
      }
      await this.writeState(state)
    })
  }

  async clearAccountUsageError(accountId: string): Promise<void> {
    await this.runStateTask(async () => {
      const state = await this.readState()

      if (!state.accounts.some((account) => account.id === accountId)) {
        throw new Error('Account not found.')
      }

      if (!(accountId in state.usageErrorByAccountId)) {
        return
      }

      const nextUsageErrorByAccountId = { ...state.usageErrorByAccountId }
      delete nextUsageErrorByAccountId[accountId]
      state.usageErrorByAccountId = nextUsageErrorByAccountId
      await this.writeState(state)
    })
  }

  async markAccountAuthError(
    accountId: string,
    reason: string,
    source: AccountHealthSource,
    httpStatus?: number
  ): Promise<void> {
    await this.runStateTask(async () => {
      const state = await this.readState()

      if (!state.accounts.some((account) => account.id === accountId)) {
        throw new Error('Account not found.')
      }

      state.accountHealthByAccountId = {
        ...state.accountHealthByAccountId,
        [accountId]: {
          status: 'auth_error',
          reason: reason.trim() || 'Account authentication failed.',
          source,
          markedAt: new Date().toISOString(),
          ...(httpStatus ? { httpStatus } : {})
        }
      }
      await this.writeState(state)
    })
  }

  async clearAccountHealth(accountId: string): Promise<void> {
    await this.runStateTask(async () => {
      const state = await this.readState()

      if (!state.accounts.some((account) => account.id === accountId)) {
        throw new Error('Account not found.')
      }

      const nextAccountHealthByAccountId = { ...state.accountHealthByAccountId }
      delete nextAccountHealthByAccountId[accountId]
      state.accountHealthByAccountId = nextAccountHealthByAccountId

      const nextUsageErrorByAccountId = { ...state.usageErrorByAccountId }
      delete nextUsageErrorByAccountId[accountId]
      state.usageErrorByAccountId = nextUsageErrorByAccountId

      await this.writeState(state)
    })
  }

  async updateAccountHealth(accountId: string, input: UpdateAccountHealthInput): Promise<void> {
    await this.runStateTask(async () => {
      const state = await this.readState()

      if (!state.accounts.some((account) => account.id === accountId)) {
        throw new Error('Account not found.')
      }

      if (input.status === 'normal') {
        const nextAccountHealthByAccountId = { ...state.accountHealthByAccountId }
        delete nextAccountHealthByAccountId[accountId]
        state.accountHealthByAccountId = nextAccountHealthByAccountId

        const nextUsageErrorByAccountId = { ...state.usageErrorByAccountId }
        delete nextUsageErrorByAccountId[accountId]
        state.usageErrorByAccountId = nextUsageErrorByAccountId

        await this.writeState(state)
        return
      }

      state.accountHealthByAccountId = {
        ...state.accountHealthByAccountId,
        [accountId]: {
          status: 'auth_error',
          reason: input.reason?.trim() || 'Account authentication failed.',
          source: 'manual',
          markedAt: new Date().toISOString()
        }
      }
      await this.writeState(state)
    })
  }

  async getAccountWakeSchedule(accountId: string): Promise<AccountWakeSchedule | null> {
    return this.runStateTask(async () => {
      const state = await this.readState()
      if (!state.accounts.some((account) => account.id === accountId)) {
        throw new Error('Account not found.')
      }

      return state.wakeSchedulesByAccountId[accountId] ?? null
    })
  }

  async updateAccountWakeSchedule(
    accountId: string,
    input: UpdateAccountWakeScheduleInput
  ): Promise<AccountWakeSchedule> {
    return this.runStateTask(async () => {
      const state = await this.readState()
      if (!state.accounts.some((account) => account.id === accountId)) {
        throw new Error('Account not found.')
      }

      const current = state.wakeSchedulesByAccountId[accountId]
      const next = normalizeWakeSchedule({
        ...current,
        ...input,
        model: input.model ?? current?.model ?? defaultWakeModel,
        prompt: input.prompt ?? current?.prompt ?? 'ping'
      })

      if (!next) {
        throw new Error('Invalid wake schedule.')
      }

      state.wakeSchedulesByAccountId = {
        ...state.wakeSchedulesByAccountId,
        [accountId]: next
      }
      await this.writeState(state)
      return next
    })
  }

  async patchAccountWakeSchedule(
    accountId: string,
    patch: Partial<AccountWakeSchedule>
  ): Promise<AccountWakeSchedule | null> {
    return this.runStateTask(async () => {
      const state = await this.readState()
      if (!state.accounts.some((account) => account.id === accountId)) {
        throw new Error('Account not found.')
      }

      const current = state.wakeSchedulesByAccountId[accountId]
      if (!current) {
        return null
      }

      const next = normalizeWakeSchedule({
        ...current,
        ...patch,
        times: patch.times ?? current.times,
        enabled: patch.enabled ?? current.enabled,
        model: patch.model ?? current.model,
        prompt: patch.prompt ?? current.prompt,
        lastTriggeredAt: patch.lastTriggeredAt ?? current.lastTriggeredAt,
        lastSucceededAt: patch.lastSucceededAt ?? current.lastSucceededAt,
        lastStatus: patch.lastStatus ?? current.lastStatus,
        lastMessage: patch.lastMessage ?? current.lastMessage
      })

      if (!next) {
        return null
      }

      state.wakeSchedulesByAccountId = {
        ...state.wakeSchedulesByAccountId,
        [accountId]: next
      }
      await this.writeState(state)
      return next
    })
  }

  async deleteAccountWakeSchedule(accountId: string): Promise<void> {
    await this.runStateTask(async () => {
      const state = await this.readState()
      if (!state.accounts.some((account) => account.id === accountId)) {
        throw new Error('Account not found.')
      }

      if (!(accountId in state.wakeSchedulesByAccountId)) {
        return
      }

      const nextWakeSchedulesByAccountId = { ...state.wakeSchedulesByAccountId }
      delete nextWakeSchedulesByAccountId[accountId]
      state.wakeSchedulesByAccountId = nextWakeSchedulesByAccountId
      await this.writeState(state)
    })
  }

  async createGroup(name: string): Promise<AccountGroup> {
    return this.runStateTask(async () => {
      const state = await this.readState()
      const normalizedName = normalizeGroupName(name)

      if (!normalizedName) {
        throw new Error('Group name is required.')
      }

      if (
        state.groups.some(
          (group) =>
            group.name.localeCompare(normalizedName, undefined, { sensitivity: 'accent' }) === 0
        )
      ) {
        throw new Error('Group name already exists.')
      }

      const now = new Date().toISOString()
      const group: AccountGroup = {
        id: randomUUID(),
        name: normalizedName,
        createdAt: now,
        updatedAt: now
      }

      state.groups = [...state.groups, group]
      await this.writeState(state)
      return group
    })
  }

  async updateGroup(groupId: string, name: string): Promise<AccountGroup> {
    return this.runStateTask(async () => {
      const state = await this.readState()
      const group = state.groups.find((item) => item.id === groupId)
      const normalizedName = normalizeGroupName(name)

      if (!group) {
        throw new Error('Group not found.')
      }

      if (!normalizedName) {
        throw new Error('Group name is required.')
      }

      if (
        state.groups.some(
          (item) =>
            item.id !== groupId &&
            item.name.localeCompare(normalizedName, undefined, { sensitivity: 'accent' }) === 0
        )
      ) {
        throw new Error('Group name already exists.')
      }

      group.name = normalizedName
      group.updatedAt = new Date().toISOString()
      await this.writeState(state)
      return group
    })
  }

  async deleteGroup(groupId: string): Promise<void> {
    await this.runStateTask(async () => {
      const state = await this.readState()

      if (!state.groups.some((group) => group.id === groupId)) {
        throw new Error('Group not found.')
      }

      state.groups = state.groups.filter((group) => group.id !== groupId)
      state.accounts = state.accounts.map((account) => ({
        ...account,
        groupIds: account.groupIds.filter((item) => item !== groupId)
      }))
      const gateway = state.settings.localGateway
      if (gateway && Array.isArray(gateway.allowedGroupIds) && gateway.allowedGroupIds.length) {
        const nextAllowed = gateway.allowedGroupIds.filter((item) => item !== groupId)
        if (nextAllowed.length !== gateway.allowedGroupIds.length) {
          state.settings = {
            ...state.settings,
            localGateway: normalizeLocalGatewaySettings({
              ...gateway,
              allowedGroupIds: nextAllowed
            })
          }
        }
      }

      await this.writeState(state)
    })
  }

  async importCurrentAuth(): Promise<void> {
    await this.runStateTask(async () => {
      const auth = await this.readCodexAuthFile()
      await this.upsertAccount(auth, true)
    })
  }

  async importAuthFile(authFile: string, makeActive = true): Promise<void> {
    await this.runStateTask(async () => {
      const raw = await fs.readFile(authFile, 'utf8')
      const auth = JSON.parse(raw) as CodexAuthPayload
      await this.upsertAccount(auth, makeActive)
    })
  }

  async importAccountsFromStateFile(stateFile: string): Promise<number> {
    let importedCount = 0
    const raw = await fs.readFile(stateFile, 'utf8')
    const externalState = normalizePersistedState(
      JSON.parse(raw) as PersistedState | LegacyPersistedState
    )

    for (const account of externalState.accounts) {
      let imported: AccountSummary

      try {
        const auth = JSON.parse(this.unprotect(account.authPayload)) as CodexAuthPayload
        imported = await this.importAuthPayload(auth, {
          subscriptionExpiresAt: account.subscriptionExpiresAt
        })
      } catch {
        // Skip accounts that cannot be read from another profile, for example legacy safeStorage rows.
        continue
      }

      try {
        const usage = externalState.usageByAccountId[account.id]
        if (usage) {
          await this.saveAccountRateLimits(imported.id, usage)
        }
      } catch {
        // Keep importing account metadata even if the cached usage snapshot is stale or invalid.
      }

      try {
        const wakeSchedule = externalState.wakeSchedulesByAccountId[account.id]
        if (wakeSchedule) {
          await this.updateAccountWakeSchedule(imported.id, {
            enabled: wakeSchedule.enabled,
            times: wakeSchedule.times,
            model: wakeSchedule.model,
            prompt: wakeSchedule.prompt
          })
          await this.patchAccountWakeSchedule(imported.id, {
            lastTriggeredAt: wakeSchedule.lastTriggeredAt,
            lastSucceededAt: wakeSchedule.lastSucceededAt,
            lastStatus: wakeSchedule.lastStatus,
            lastMessage: wakeSchedule.lastMessage
          })
        }
      } catch {
        // Keep importing account metadata even if the wake schedule cannot be copied.
      }

      importedCount += 1
    }

    return importedCount
  }

  async importAuthPayload(
    auth: CodexAuthPayload,
    metadata: Partial<Pick<AccountSummary, 'subscriptionExpiresAt'>> = {}
  ): Promise<AccountSummary> {
    return this.runStateTask(() => this.upsertAccount(auth, false, metadata))
  }

  async activateAccount(accountId: string): Promise<void> {
    await this.runStateTask(async () => {
      const state = await this.readState()
      const account = state.accounts.find((item) => item.id === accountId)

      if (!account) {
        throw new Error('Account not found.')
      }

      const rawAuth = this.unprotect(account.authPayload)
      const parsed = JSON.parse(rawAuth) as CodexAuthPayload

      await this.writeCodexAuthFile(parsed)

      const now = new Date().toISOString()
      state.activeAccountId = accountId
      state.accounts = state.accounts.map((item) =>
        item.id === accountId
          ? {
              ...item,
              lastUsedAt: now,
              updatedAt: now
            }
          : item
      )

      await this.writeState(state)
    })
  }

  async getStoredAuthPayload(accountId: string): Promise<CodexAuthPayload> {
    return this.runStateTask(() => this.getStoredAuth(accountId))
  }

  async syncCurrentAuthPayload(accountId: string, auth: CodexAuthPayload): Promise<boolean> {
    return this.runStateTask(async () => {
      const state = await this.readState()

      try {
        const currentAuth = await this.readCodexAuthFile()
        const matched = findMatchingAccount(state.accounts, currentAuth)
        if (!matched || matched.id !== accountId) {
          return false
        }

        await this.writeCodexAuthFile(auth)
        return true
      } catch {
        return false
      }
    })
  }

  async importCurrentAuthPayloadForAccount(accountId: string): Promise<{
    account: AccountSummary
    auth: CodexAuthPayload
    changed: boolean
  } | null> {
    return this.runStateTask(async () => {
      const state = await this.readState()

      let currentAuth: CodexAuthPayload
      try {
        currentAuth = await this.readCodexAuthFile()
      } catch {
        return null
      }

      const existing = findMatchingAccount(state.accounts, currentAuth)
      if (!existing || existing.id !== accountId) {
        return null
      }

      const rawAuth = JSON.stringify(currentAuth)
      if (this.unprotect(existing.authPayload) === rawAuth) {
        return {
          account: this.toAccountSummary(existing),
          auth: currentAuth,
          changed: false
        }
      }

      const previousId = existing.id
      const identity = resolveAccountId(currentAuth)
      const summary = summarizeAuth(currentAuth)
      const now = new Date().toISOString()

      if (previousId !== identity) {
        if (state.activeAccountId === previousId) {
          state.activeAccountId = identity
        }

        state.settings.statusBarAccountIds = state.settings.statusBarAccountIds.map((storedId) =>
          storedId === previousId ? identity : storedId
        )

        if (state.usageByAccountId[previousId]) {
          state.usageByAccountId = {
            ...state.usageByAccountId,
            [identity]: state.usageByAccountId[previousId]
          }
          delete state.usageByAccountId[previousId]
        }

        if (state.usageErrorByAccountId[previousId]) {
          state.usageErrorByAccountId = {
            ...state.usageErrorByAccountId,
            [identity]: state.usageErrorByAccountId[previousId]
          }
          delete state.usageErrorByAccountId[previousId]
        }

        if (state.accountHealthByAccountId[previousId]) {
          state.accountHealthByAccountId = {
            ...state.accountHealthByAccountId,
            [identity]: state.accountHealthByAccountId[previousId]
          }
          delete state.accountHealthByAccountId[previousId]
        }

        if (state.wakeSchedulesByAccountId[previousId]) {
          state.wakeSchedulesByAccountId = {
            ...state.wakeSchedulesByAccountId,
            [identity]: state.wakeSchedulesByAccountId[previousId]
          }
          delete state.wakeSchedulesByAccountId[previousId]
        }
      }

      existing.id = identity
      existing.email = summary.email
      existing.name = summary.name
      existing.accountId = summary.accountId
      existing.subscriptionExpiresAt =
        summary.subscriptionExpiresAt ?? existing.subscriptionExpiresAt
      existing.groupIds = dedupeAccountGroupIds(existing.groupIds ?? [])
      existing.updatedAt = now
      existing.authPayload = this.protect(rawAuth)
      state.activeAccountId = identity

      if (state.usageErrorByAccountId[identity]) {
        delete state.usageErrorByAccountId[identity]
      }
      if (state.accountHealthByAccountId[identity]) {
        delete state.accountHealthByAccountId[identity]
      }

      await this.writeState(state)

      return {
        account: this.toAccountSummary(existing),
        auth: currentAuth,
        changed: true
      }
    })
  }

  async getAccountSummary(accountId: string): Promise<AccountSummary> {
    return this.runStateTask(async () => {
      const state = await this.readState()
      const account = state.accounts.find((item) => item.id === accountId)

      if (!account) {
        throw new Error('Account not found.')
      }

      return this.toAccountSummary(account)
    })
  }

  async getAccountTokens(accountId: string): Promise<AccountTokensDetail> {
    return this.runStateTask(async () => {
      const state = await this.readState()
      const account = state.accounts.find((item) => item.id === accountId)

      if (!account) {
        throw new Error('Account not found.')
      }

      const auth = JSON.parse(this.unprotect(account.authPayload)) as CodexAuthPayload
      const tokens = auth.tokens ?? {}
      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        idToken: tokens.id_token,
        accountId: tokens.account_id
      }
    })
  }

  async updateAccountGroups(accountId: string, groupIds: string[]): Promise<void> {
    await this.runStateTask(async () => {
      const state = await this.readState()
      const account = state.accounts.find((item) => item.id === accountId)

      if (!account) {
        throw new Error('Account not found.')
      }

      const nextGroupIds = dedupeAccountGroupIds(groupIds)
      if (!nextGroupIds.every((groupId) => state.groups.some((group) => group.id === groupId))) {
        throw new Error('One or more groups do not exist.')
      }

      const previousGroupIds = new Set(account.groupIds)
      const nextGroupIdSet = new Set(nextGroupIds)
      const removedGroupIds = [...previousGroupIds].filter(
        (groupId) => !nextGroupIdSet.has(groupId)
      )
      if (removedGroupIds.length) {
        const removedSet = new Set(removedGroupIds)
        state.groups = state.groups.map((group) =>
          removedSet.has(group.id) && group.orderedAccountIds?.includes(accountId)
            ? {
                ...group,
                orderedAccountIds: group.orderedAccountIds.filter((id) => id !== accountId)
              }
            : group
        )
      }

      account.groupIds = nextGroupIds
      account.updatedAt = new Date().toISOString()
      await this.writeState(state)
    })
  }

  async updateAccountTokens(
    accountId: string,
    input: UpdateAccountTokensInput
  ): Promise<AccountSummary> {
    return this.runStateTask(async () => {
      const state = await this.readState()
      const existing = state.accounts.find((item) => item.id === accountId)

      if (!existing) {
        throw new Error('Account not found.')
      }

      const currentAuth = JSON.parse(this.unprotect(existing.authPayload)) as CodexAuthPayload
      const previousTokens = currentAuth.tokens ?? {}

      const nextAccessToken = normalizeTokenInput(input.accessToken, previousTokens.access_token)
      const nextRefreshToken = normalizeTokenInput(input.refreshToken, previousTokens.refresh_token)
      const nextIdToken = normalizeTokenInput(input.idToken, previousTokens.id_token)
      const nextAccountIdHint = normalizeTokenInput(input.accountId, previousTokens.account_id)

      if (!nextAccessToken && !nextRefreshToken && !nextIdToken) {
        throw new Error('At least one of access_token, refresh_token, or id_token is required.')
      }

      const nextAuth: CodexAuthPayload = {
        ...currentAuth,
        auth_mode: currentAuth.auth_mode ?? 'chatgpt',
        last_refresh: new Date().toISOString(),
        tokens: {
          ...previousTokens,
          access_token: nextAccessToken,
          refresh_token: nextRefreshToken,
          id_token: nextIdToken,
          account_id: nextAccountIdHint
        }
      }

      const previousId = existing.id
      const identity = resolveAccountId(nextAuth)
      const summary = summarizeAuth(nextAuth)
      const now = new Date().toISOString()
      const payload = this.protect(JSON.stringify(nextAuth))

      if (previousId !== identity) {
        if (state.accounts.some((item) => item.id === identity)) {
          throw new Error(
            'Token payload matches another saved account. Remove the duplicate first.'
          )
        }

        if (state.activeAccountId === previousId) {
          state.activeAccountId = identity
        }

        state.settings.statusBarAccountIds = state.settings.statusBarAccountIds.map((storedId) =>
          storedId === previousId ? identity : storedId
        )

        if (state.usageByAccountId[previousId]) {
          state.usageByAccountId = {
            ...state.usageByAccountId,
            [identity]: state.usageByAccountId[previousId]
          }
          delete state.usageByAccountId[previousId]
        }

        if (state.usageErrorByAccountId[previousId]) {
          state.usageErrorByAccountId = {
            ...state.usageErrorByAccountId,
            [identity]: state.usageErrorByAccountId[previousId]
          }
          delete state.usageErrorByAccountId[previousId]
        }

        if (state.accountHealthByAccountId[previousId]) {
          state.accountHealthByAccountId = {
            ...state.accountHealthByAccountId,
            [identity]: state.accountHealthByAccountId[previousId]
          }
          delete state.accountHealthByAccountId[previousId]
        }

        if (state.wakeSchedulesByAccountId[previousId]) {
          state.wakeSchedulesByAccountId = {
            ...state.wakeSchedulesByAccountId,
            [identity]: state.wakeSchedulesByAccountId[previousId]
          }
          delete state.wakeSchedulesByAccountId[previousId]
        }
      }

      existing.id = identity
      existing.email = summary.email ?? existing.email
      existing.name = summary.name ?? existing.name
      existing.accountId = summary.accountId ?? existing.accountId
      existing.subscriptionExpiresAt =
        summary.subscriptionExpiresAt ?? existing.subscriptionExpiresAt
      existing.groupIds = dedupeAccountGroupIds(existing.groupIds ?? [])
      existing.updatedAt = now
      existing.authPayload = payload

      if (state.usageErrorByAccountId[identity]) {
        delete state.usageErrorByAccountId[identity]
      }
      if (state.accountHealthByAccountId[identity]) {
        delete state.accountHealthByAccountId[identity]
      }

      await this.writeState(state)

      if (state.activeAccountId === identity) {
        try {
          await this.writeCodexAuthFile(nextAuth)
        } catch (error) {
          console.warn(`Failed to sync updated auth to codex auth file: ${describeError(error)}`)
        }
      }

      return this.toAccountSummary(existing)
    })
  }

  async removeAccount(accountId: string): Promise<void> {
    await this.runStateTask(async () => {
      const state = await this.readState()
      state.accounts = state.accounts.filter((item) => item.id !== accountId)

      if (state.activeAccountId === accountId) {
        state.activeAccountId = undefined
      }

      if (state.usageByAccountId[accountId]) {
        delete state.usageByAccountId[accountId]
      }

      if (state.usageErrorByAccountId[accountId]) {
        delete state.usageErrorByAccountId[accountId]
      }

      if (state.accountHealthByAccountId[accountId]) {
        delete state.accountHealthByAccountId[accountId]
      }

      if (state.wakeSchedulesByAccountId[accountId]) {
        delete state.wakeSchedulesByAccountId[accountId]
      }

      state.groups = state.groups.map((group) =>
        group.orderedAccountIds?.includes(accountId)
          ? {
              ...group,
              orderedAccountIds: group.orderedAccountIds.filter((id) => id !== accountId)
            }
          : group
      )

      const gateway = state.settings.localGateway
      if (gateway && Array.isArray(gateway.allowedAccountIds) && gateway.allowedAccountIds.length) {
        const nextAllowed = gateway.allowedAccountIds.filter((item) => item !== accountId)
        if (nextAllowed.length !== gateway.allowedAccountIds.length) {
          state.settings = {
            ...state.settings,
            localGateway: normalizeLocalGatewaySettings({
              ...gateway,
              allowedAccountIds: nextAllowed
            })
          }
        }
      }

      await this.writeState(state)
    })
  }

  async reorderAccounts(accountIds: string[]): Promise<void> {
    await this.runStateTask(async () => {
      const state = await this.readState()

      const uniqueAccountIds = new Set(accountIds)
      if (uniqueAccountIds.size !== accountIds.length) {
        throw new Error('Account reorder payload contains duplicate accounts.')
      }

      const accountsById = new Map(state.accounts.map((account) => [account.id, account]))
      const reorderedAccounts = accountIds.map((accountId) => {
        const account = accountsById.get(accountId)
        if (!account) {
          throw new Error(`Account not found: ${accountId}`)
        }

        return account
      })

      if (!reorderedAccounts.length) {
        return
      }

      let nextVisibleIndex = 0
      state.accounts = state.accounts.map((account) =>
        uniqueAccountIds.has(account.id) ? reorderedAccounts[nextVisibleIndex++] : account
      )
      await this.writeState(state)
    })
  }

  async reorderAccountsInGroup(groupId: string, accountIds: string[]): Promise<void> {
    await this.runStateTask(async () => {
      const state = await this.readState()

      const group = state.groups.find((item) => item.id === groupId)
      if (!group) {
        throw new Error('Group not found.')
      }

      const uniqueAccountIds = new Set(accountIds)
      if (uniqueAccountIds.size !== accountIds.length) {
        throw new Error('Account reorder payload contains duplicate accounts.')
      }

      const accountsById = new Map(state.accounts.map((account) => [account.id, account]))
      for (const accountId of accountIds) {
        const account = accountsById.get(accountId)
        if (!account) {
          throw new Error(`Account not found: ${accountId}`)
        }
        if (!account.groupIds.includes(groupId)) {
          throw new Error(`Account ${accountId} is not a member of group ${groupId}.`)
        }
      }

      group.orderedAccountIds = accountIds
      group.updatedAt = new Date().toISOString()
      await this.writeState(state)
    })
  }

  private async getCurrentSession(state: PersistedState): Promise<CurrentSessionSummary | null> {
    try {
      const auth = await this.readCodexAuthFile()
      const summary = summarizeAuth(auth)
      const storedAccountId = findMatchingAccount(state.accounts, auth)?.id

      return {
        email: summary.email,
        name: summary.name,
        accountId: summary.accountId,
        subscriptionExpiresAt: summary.subscriptionExpiresAt,
        lastRefresh: auth.last_refresh,
        storedAccountId
      }
    } catch {
      return null
    }
  }

  private async upsertAccount(
    auth: CodexAuthPayload,
    makeActive: boolean,
    metadata: Partial<Pick<AccountSummary, 'subscriptionExpiresAt'>> = {}
  ): Promise<AccountSummary> {
    const state = await this.readState()
    const identity = resolveAccountId(auth)
    const summary = summarizeAuth(auth)
    const now = new Date().toISOString()
    const payload = this.protect(JSON.stringify(auth))
    const existing = findMatchingAccount(state.accounts, auth)
    const subscriptionExpiresAt =
      metadata.subscriptionExpiresAt ??
      summary.subscriptionExpiresAt ??
      existing?.subscriptionExpiresAt

    if (existing) {
      const previousId = existing.id
      if (previousId !== identity) {
        if (state.activeAccountId === previousId) {
          state.activeAccountId = identity
        }

        state.settings.statusBarAccountIds = state.settings.statusBarAccountIds.map((accountId) =>
          accountId === previousId ? identity : accountId
        )

        if (state.usageByAccountId[previousId]) {
          state.usageByAccountId = {
            ...state.usageByAccountId,
            [identity]: state.usageByAccountId[previousId]
          }
          delete state.usageByAccountId[previousId]
        }

        if (state.usageErrorByAccountId[previousId]) {
          state.usageErrorByAccountId = {
            ...state.usageErrorByAccountId,
            [identity]: state.usageErrorByAccountId[previousId]
          }
          delete state.usageErrorByAccountId[previousId]
        }

        if (state.accountHealthByAccountId[previousId]) {
          state.accountHealthByAccountId = {
            ...state.accountHealthByAccountId,
            [identity]: state.accountHealthByAccountId[previousId]
          }
          delete state.accountHealthByAccountId[previousId]
        }

        if (state.wakeSchedulesByAccountId[previousId]) {
          state.wakeSchedulesByAccountId = {
            ...state.wakeSchedulesByAccountId,
            [identity]: state.wakeSchedulesByAccountId[previousId]
          }
          delete state.wakeSchedulesByAccountId[previousId]
        }
      }

      existing.id = identity
      existing.email = summary.email
      existing.name = summary.name
      existing.accountId = summary.accountId
      existing.subscriptionExpiresAt = subscriptionExpiresAt
      existing.groupIds = dedupeAccountGroupIds(existing.groupIds ?? [])
      existing.updatedAt = now
      existing.authPayload = payload
      if (makeActive) {
        existing.lastUsedAt = now
      }
    } else {
      state.accounts.unshift({
        id: identity,
        email: summary.email,
        name: summary.name,
        accountId: summary.accountId,
        subscriptionExpiresAt,
        groupIds: [],
        createdAt: now,
        updatedAt: now,
        lastUsedAt: makeActive ? now : undefined,
        authPayload: payload
      })
    }

    if (makeActive) {
      state.activeAccountId = identity
    }

    if (state.usageErrorByAccountId[identity]) {
      delete state.usageErrorByAccountId[identity]
    }
    if (state.accountHealthByAccountId[identity]) {
      delete state.accountHealthByAccountId[identity]
    }

    await this.writeState(state)
    const persistedAccount =
      existing ?? state.accounts.find((account) => account.id === identity) ?? null
    if (!persistedAccount) {
      throw new Error('Failed to persist account.')
    }

    return this.toAccountSummary(persistedAccount)
  }

  private toAccountSummary(account: PersistedAccount): AccountSummary {
    const summary = toAccountSummary(account)

    try {
      const auth = JSON.parse(this.unprotect(account.authPayload)) as CodexAuthPayload
      const claims = decodeJwtPayload(auth.tokens?.access_token)
      if (typeof claims.exp === 'number') {
        summary.accessTokenExpiresAt = claims.exp * 1000
      }
      if (!summary.subscriptionExpiresAt) {
        const authSummary = summarizeAuth(auth)
        if (authSummary.subscriptionExpiresAt) {
          summary.subscriptionExpiresAt = authSummary.subscriptionExpiresAt
        }
      }
    } catch {
      // Keep account listing resilient for legacy safeStorage or malformed entries.
    }

    return summary
  }

  private protect(value: string): ProtectedPayload {
    return this.platform.protect(value)
  }

  private unprotect(payload: ProtectedPayload): string {
    if (payload.mode === 'safeStorage') {
      throw new Error(
        'This account was saved with macOS Keychain protection in an older version. Re-import it to use it without Keychain prompts.'
      )
    }

    return this.platform.unprotect(payload)
  }

  private async readCodexAuthFile(): Promise<CodexAuthPayload> {
    const raw = await fs.readFile(this.codexAuthFile, 'utf8')
    return JSON.parse(raw) as CodexAuthPayload
  }

  private runStateTask<T>(task: () => Promise<T>): Promise<T> {
    const run = this.stateQueue.then(task, task)
    this.stateQueue = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  private async getStoredAuth(accountId: string): Promise<CodexAuthPayload> {
    const state = await this.readState()
    const account = state.accounts.find((item) => item.id === accountId)

    if (!account) {
      throw new Error('Account not found.')
    }

    return JSON.parse(this.unprotect(account.authPayload)) as CodexAuthPayload
  }

  private async readState(): Promise<PersistedState> {
    const primaryState = await this.readStateFile(this.stateFile)
    if (primaryState) {
      return primaryState
    }

    const backupState = await this.readStateFile(this.stateBackupFile)
    if (backupState) {
      console.warn(`Recovered account state from backup: ${this.stateBackupFile}`)
      return backupState
    }

    return defaultState()
  }

  private async readStateFile(path: string): Promise<PersistedState | null> {
    try {
      const raw = await fs.readFile(path, 'utf8')
      return normalizePersistedState(JSON.parse(raw) as PersistedState | LegacyPersistedState)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null
      }

      console.warn(`Failed to read account state from ${path}: ${describeError(error)}`)
      return null
    }
  }

  private async writeState(state: PersistedState): Promise<void> {
    await fs.mkdir(dirname(this.stateFile), { recursive: true })
    const raw = `${JSON.stringify(state, null, 2)}\n`
    const tempFile = `${this.stateFile}.${process.pid}.${randomUUID()}.tmp`

    try {
      await fs.writeFile(tempFile, raw, 'utf8')
      await fs.rename(tempFile, this.stateFile)
      await fs.copyFile(this.stateFile, this.stateBackupFile)
    } finally {
      await fs.rm(tempFile, { force: true })
    }
  }

  private async writeCodexAuthFile(auth: CodexAuthPayload): Promise<void> {
    if (this.configGuard) {
      await this.configGuard.guardBeforeWrite(this.codexAuthFile, { sensitive: true })
    }
    await fs.mkdir(this.defaultCodexHome, { recursive: true })
    await fs.writeFile(this.codexAuthFile, `${JSON.stringify(auth, null, 2)}\n`, 'utf8')
    if (this.configGuard) {
      await this.configGuard.recordWriteComplete(this.codexAuthFile)
    }
  }
}
