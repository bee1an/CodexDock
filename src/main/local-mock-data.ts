import { isLocalMockAccount, type AccountSummary } from '../shared/codex'
import type { TemplateAccountRecord, TemplateFileRecord } from './codex-account-template'
import type { CodexServices } from './codex-services'

const localMockTagNames = ['主力', '观察中', '备用', '团队'] as const
const localMockProviderInputs = [
  {
    name: 'Local Mock Provider',
    baseUrl: 'https://mock-provider.local/v1',
    apiKey: 'mock-api-key',
    model: 'gpt-5.4',
    fastMode: false
  },
  {
    name: 'Local Fast Provider',
    baseUrl: 'https://fast-mock-provider.local/v1',
    apiKey: 'mock-fast-api-key',
    model: 'gpt-5.4-mini',
    fastMode: true
  },
  {
    baseUrl: 'https://fallback-provider.local/v1',
    apiKey: 'mock-fallback-api-key',
    model: 'gpt-4.1-mini',
    fastMode: true
  }
] as const

function encodeJwtSegment(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url')
}

function createJwt(payload: Record<string, unknown>): string {
  return `${encodeJwtSegment({ alg: 'none', typ: 'JWT' })}.${encodeJwtSegment(payload)}.sig`
}

function msFromNow(hours: number): number {
  return hours * 60 * 60 * 1000
}

function isoFromNow(hours: number): string {
  return new Date(Date.now() + msFromNow(hours)).toISOString()
}

function secondsFromNow(hours: number): number {
  return Math.max(0, Math.floor(msFromNow(hours) / 1000))
}

function createTemplateAccount(options: {
  name: string
  email: string
  accountId: string
  planType: string
  primaryUsedPercent?: number
  primaryResetHours?: number
  secondaryUsedPercent?: number
  secondaryResetHours?: number
}): TemplateAccountRecord {
  const subject = `user_${options.accountId}`
  const accessToken = createJwt({
    sub: subject,
    exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    'https://api.openai.com/auth': {
      chatgpt_account_id: options.accountId,
      chatgpt_plan_type: options.planType
    }
  })
  const idToken = createJwt({
    sub: subject,
    exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    email: options.email,
    name: options.name,
    'https://api.openai.com/auth': {
      chatgpt_account_id: options.accountId,
      chatgpt_plan_type: options.planType
    }
  })

  return {
    name: options.name,
    notes: '本地开发环境 mock 数据',
    platform: 'openai',
    type: 'oauth',
    credentials: {
      _token_version: 1,
      access_token: accessToken,
      refresh_token: `refresh-${options.accountId}`,
      id_token: idToken,
      chatgpt_account_id: options.accountId,
      chatgpt_user_id: subject,
      client_id: 'app_EMoamEEZ73f0CkXaXp7hrann',
      email: options.email,
      expires_at: isoFromNow(24 * 30),
      expires_in: secondsFromNow(24 * 30),
      plan_type: options.planType,
      scope: null,
      token_type: 'Bearer'
    },
    extra: {
      codex_usage_updated_at: new Date().toISOString(),
      email: options.email,
      privacy_mode: 'training_off',
      ...(options.primaryUsedPercent != null && options.primaryResetHours != null
        ? {
            codex_5h_reset_after_seconds: secondsFromNow(options.primaryResetHours),
            codex_5h_reset_at: isoFromNow(options.primaryResetHours),
            codex_5h_used_percent: options.primaryUsedPercent,
            codex_5h_window_minutes: 5 * 60,
            codex_primary_reset_after_seconds: secondsFromNow(options.primaryResetHours),
            codex_primary_reset_at: isoFromNow(options.primaryResetHours),
            codex_primary_used_percent: options.primaryUsedPercent,
            codex_primary_window_minutes: 5 * 60
          }
        : {}),
      ...(options.secondaryUsedPercent != null && options.secondaryResetHours != null
        ? {
            codex_7d_reset_after_seconds: secondsFromNow(options.secondaryResetHours),
            codex_7d_reset_at: isoFromNow(options.secondaryResetHours),
            codex_7d_used_percent: options.secondaryUsedPercent,
            codex_7d_window_minutes: 7 * 24 * 60,
            codex_secondary_reset_after_seconds: secondsFromNow(options.secondaryResetHours),
            codex_secondary_reset_at: isoFromNow(options.secondaryResetHours),
            codex_secondary_used_percent: options.secondaryUsedPercent,
            codex_secondary_window_minutes: 7 * 24 * 60,
            ...(options.primaryUsedPercent != null
              ? {
                  codex_primary_over_secondary_percent:
                    options.primaryUsedPercent - options.secondaryUsedPercent
                }
              : {})
          }
        : {})
    },
    concurrency: 10,
    priority: 1,
    rate_multiplier: 1,
    auto_pause_on_expired: false
  }
}

function providerKey(value: string): string {
  try {
    const url = new URL(value)
    url.pathname = url.pathname.replace(/\/+$/, '') || '/'
    return url
      .toString()
      .replace(/\/$/, url.pathname === '/' ? '' : '/')
      .toLowerCase()
  } catch {
    return value.trim().replace(/\/+$/, '').toLowerCase()
  }
}

function compactTagIds(tagIds: Array<string | undefined>): string[] {
  return tagIds.filter((tagId): tagId is string => Boolean(tagId))
}

function isLegacyBusinessMockAccount(account: AccountSummary): boolean {
  return (
    account.accountId === 'acct-local-business' || account.email === 'local-business@mock.local'
  )
}

function buildLocalMockTemplate(): TemplateFileRecord {
  return {
    exported_at: new Date().toISOString(),
    proxies: [],
    accounts: [
      createTemplateAccount({
        name: 'Local Plus 1',
        email: 'local-plus-1@mock.local',
        accountId: 'acct-local-plus-1',
        planType: 'plus',
        primaryUsedPercent: 82,
        primaryResetHours: 2.5,
        secondaryUsedPercent: 96,
        secondaryResetHours: 6 * 24 + 20
      }),
      createTemplateAccount({
        name: 'Local Plus 2',
        email: 'local-plus-2@mock.local',
        accountId: 'acct-local-plus-2',
        planType: 'plus',
        primaryUsedPercent: 18,
        primaryResetHours: 1.2,
        secondaryUsedPercent: 72,
        secondaryResetHours: 5 * 24 + 18
      }),
      createTemplateAccount({
        name: 'Local Pro',
        email: 'local-pro@mock.local',
        accountId: 'acct-local-pro',
        planType: 'pro',
        primaryUsedPercent: 8,
        primaryResetHours: 3.8,
        secondaryUsedPercent: 45,
        secondaryResetHours: 4 * 24 + 8
      }),
      createTemplateAccount({
        name: 'Local Team',
        email: 'local-team@mock.local',
        accountId: 'acct-local-team',
        planType: 'team',
        primaryUsedPercent: 34,
        primaryResetHours: 4.1,
        secondaryUsedPercent: 67,
        secondaryResetHours: 3 * 24 + 12
      }),
      createTemplateAccount({
        name: 'Local Team 2',
        email: 'local-team-2@mock.local',
        accountId: 'acct-local-team-2',
        planType: 'team',
        primaryUsedPercent: 57,
        primaryResetHours: 1.8,
        secondaryUsedPercent: 24,
        secondaryResetHours: 2 * 24 + 6
      }),
      createTemplateAccount({
        name: 'Local Enterprise',
        email: 'local-enterprise@mock.local',
        accountId: 'acct-local-enterprise',
        planType: 'enterprise',
        primaryUsedPercent: 6,
        primaryResetHours: 4.8,
        secondaryUsedPercent: 19,
        secondaryResetHours: 24 + 10
      }),
      createTemplateAccount({
        name: 'Local Free',
        email: 'local-free@mock.local',
        accountId: 'acct-local-free',
        planType: 'free',
        secondaryUsedPercent: 62,
        secondaryResetHours: 6 * 24 + 4
      })
    ]
  }
}

export async function seedLocalMockData(services: CodexServices): Promise<boolean> {
  const initialSnapshot = await services.getSnapshot()
  const template = buildLocalMockTemplate()
  let changed = template.accounts.some(
    (templateAccount) =>
      !initialSnapshot.accounts.some(
        (account) =>
          account.accountId === templateAccount.credentials.chatgpt_account_id ||
          account.email === templateAccount.credentials.email
      )
  )

  await services.accounts.importFromTemplate(`${JSON.stringify(template, null, 2)}\n`)

  let nextSnapshot = await services.getSnapshot()
  const legacyBusinessMockAccounts = nextSnapshot.accounts.filter(isLegacyBusinessMockAccount)
  const removedActiveLegacyBusinessMock = legacyBusinessMockAccounts.some(
    (account) => account.id === initialSnapshot.activeAccountId
  )
  for (const account of legacyBusinessMockAccounts) {
    await services.accounts.remove(account.id)
    changed = true
  }

  if (legacyBusinessMockAccounts.length) {
    nextSnapshot = await services.getSnapshot()
  }

  for (const tagName of localMockTagNames) {
    if (!nextSnapshot.tags.some((tag) => tag.name === tagName)) {
      await services.tags.create(tagName)
      changed = true
    }
  }

  nextSnapshot = await services.getSnapshot()
  const tagsByName = new Map(nextSnapshot.tags.map((tag) => [tag.name, tag.id]))
  const findAccountByEmail = (email: string): AccountSummary => {
    const account = nextSnapshot.accounts.find((item) => item.email === email)
    if (!account) {
      throw new Error(`Local mock account not found: ${email}`)
    }
    return account
  }

  await services.accounts.updateTags(
    findAccountByEmail('local-plus-1@mock.local').id,
    compactTagIds([tagsByName.get('主力')])
  )
  await services.accounts.updateTags(
    findAccountByEmail('local-plus-2@mock.local').id,
    compactTagIds([tagsByName.get('观察中')])
  )
  await services.accounts.updateTags(
    findAccountByEmail('local-pro@mock.local').id,
    compactTagIds([tagsByName.get('备用')])
  )
  await services.accounts.updateTags(
    findAccountByEmail('local-team@mock.local').id,
    compactTagIds([tagsByName.get('团队')])
  )
  await services.accounts.updateTags(findAccountByEmail('local-team-2@mock.local').id, [
    ...compactTagIds([tagsByName.get('主力'), tagsByName.get('团队')])
  ])
  await services.accounts.updateTags(findAccountByEmail('local-enterprise@mock.local').id, [
    ...compactTagIds([tagsByName.get('观察中'), tagsByName.get('团队')])
  ])

  const lastTriggeredAt = new Date().toISOString()
  await services.accounts.updateWakeSchedule(findAccountByEmail('local-plus-1@mock.local').id, {
    enabled: true,
    times: ['09:00', '14:00'],
    prompt: 'ping',
    model: 'gpt-5.4'
  })
  await services.accounts.updateWakeScheduleRuntime(
    findAccountByEmail('local-plus-1@mock.local').id,
    {
      lastTriggeredAt,
      lastSucceededAt: lastTriggeredAt,
      lastStatus: 'success',
      lastMessage: '本地 mock 数据：上次执行成功。'
    }
  )

  await services.accounts.updateWakeSchedule(findAccountByEmail('local-pro@mock.local').id, {
    enabled: true,
    times: ['11:30'],
    prompt: 'health check',
    model: 'gpt-5.4-mini'
  })
  await services.accounts.updateWakeScheduleRuntime(findAccountByEmail('local-pro@mock.local').id, {
    lastTriggeredAt,
    lastStatus: 'skipped',
    lastMessage: '本地 mock 数据：额度条件未满足，已跳过。'
  })
  await services.accounts.updateWakeSchedule(findAccountByEmail('local-team@mock.local').id, {
    enabled: true,
    times: ['08:30', '20:30'],
    prompt: 'team sync',
    model: 'gpt-5.4'
  })
  await services.accounts.updateWakeSchedule(findAccountByEmail('local-team-2@mock.local').id, {
    enabled: true,
    times: ['10:45'],
    prompt: 'quota probe',
    model: 'gpt-5.4'
  })
  await services.accounts.updateWakeScheduleRuntime(
    findAccountByEmail('local-team-2@mock.local').id,
    {
      lastTriggeredAt,
      lastStatus: 'idle',
      lastMessage: '本地 mock 数据：等待下一次定时唤醒。'
    }
  )
  await services.accounts.updateWakeSchedule(findAccountByEmail('local-free@mock.local').id, {
    enabled: false,
    times: ['07:30'],
    prompt: 'free plan noop',
    model: 'gpt-5.4-mini'
  })

  nextSnapshot = await services.getSnapshot()
  const existingProviderKeys = new Set(
    nextSnapshot.providers.map((provider) => providerKey(provider.baseUrl))
  )
  for (const providerInput of localMockProviderInputs) {
    const key = providerKey(providerInput.baseUrl)
    if (!existingProviderKeys.has(key)) {
      await services.providers.create(providerInput)
      existingProviderKeys.add(key)
      changed = true
    }
  }

  nextSnapshot = await services.getSnapshot()
  const defaultAccountId = findAccountByEmail('local-plus-1@mock.local').id

  await services.settings.update({
    statusBarAccountIds: [
      defaultAccountId,
      findAccountByEmail('local-pro@mock.local').id,
      findAccountByEmail('local-team-2@mock.local').id
    ]
  })

  const existingInstanceNames = new Set(
    nextSnapshot.codexInstances.map((instance) => instance.name)
  )
  if (!existingInstanceNames.has('Mock Bound Workspace')) {
    await services.codex.instances.create({
      name: 'Mock Bound Workspace',
      bindAccountId: defaultAccountId,
      extraArgs: '--sandbox workspace-write'
    })
    changed = true
  }
  if (!existingInstanceNames.has('Mock Research Workspace')) {
    await services.codex.instances.create({
      name: 'Mock Research Workspace',
      extraArgs: '--model gpt-5.4-mini'
    })
    changed = true
  }

  const defaultAccount = nextSnapshot.accounts.find(
    (account) => account.email === 'local-plus-1@mock.local'
  )
  if (
    ((!initialSnapshot.activeAccountId && !initialSnapshot.accounts.length) ||
      removedActiveLegacyBusinessMock) &&
    defaultAccount
  ) {
    await services.accounts.activate(defaultAccount.id)
    changed = true
  }

  return changed
}

export async function refreshLocalMockData(services: CodexServices): Promise<{
  usageRefreshed: number
  scheduleErrorsCleared: number
}> {
  const snapshot = await services.getSnapshot()
  const mockAccounts = snapshot.accounts.filter((account) => isLocalMockAccount(account))
  let usageRefreshed = 0
  let scheduleErrorsCleared = 0

  for (const account of mockAccounts) {
    try {
      await services.usage.read(account.id)
      usageRefreshed += 1
    } catch {
      // ignore local mock refresh failures so one bad seed does not block startup
    }

    const schedule = snapshot.wakeSchedulesByAccountId[account.id]
    if (schedule?.lastStatus === 'error') {
      await services.accounts.updateWakeScheduleRuntime(account.id, {
        lastStatus: 'idle',
        lastMessage: ''
      })
      scheduleErrorsCleared += 1
    }
  }

  return {
    usageRefreshed,
    scheduleErrorsCleared
  }
}
