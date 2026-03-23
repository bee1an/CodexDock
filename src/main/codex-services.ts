import { execFile as execFileCallback, spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { parse as parseToml, stringify as stringifyToml } from '@iarna/toml'

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

const execFile = promisify(execFileCallback)
const DEFAULT_CODEX_INSTANCE_ID = '__default__'
const macosCodexAppBinary = '/Applications/Codex.app/Contents/MacOS/Codex'
const BACKGROUND_AUTH_REFRESH_SKEW_MS = 5 * 60_000
const codexProcessPattern =
  process.platform === 'darwin'
    ? '(/Applications/Codex\\.app/Contents/MacOS/Codex|(^|/)codex( |$))'
    : '(^|/)codex( |$)'

function decodeJwtPayload(token?: string): Record<string, unknown> {
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

interface TemplateCredentialRecord {
  _token_version?: number
  access_token?: string
  chatgpt_account_id?: string
  chatgpt_user_id?: string
  client_id?: string
  email?: string
  expires_at?: string
  expires_in?: number
  id_token?: string
  organization_id?: string
  plan_type?: string
  refresh_token?: string
  scope?: string | null
  token_type?: string | null
}

interface TemplateExtraRecord {
  codex_5h_reset_after_seconds?: number
  codex_5h_reset_at?: string
  codex_5h_used_percent?: number
  codex_5h_window_minutes?: number
  codex_7d_reset_after_seconds?: number
  codex_7d_reset_at?: string
  codex_7d_used_percent?: number
  codex_7d_window_minutes?: number
  codex_primary_over_secondary_percent?: number
  codex_primary_reset_after_seconds?: number
  codex_primary_reset_at?: string
  codex_primary_used_percent?: number
  codex_primary_window_minutes?: number
  codex_secondary_reset_after_seconds?: number
  codex_secondary_reset_at?: string
  codex_secondary_used_percent?: number
  codex_secondary_window_minutes?: number
  codex_usage_updated_at?: string
  email?: string
  privacy_mode?: string
}

interface TemplateAccountRecord {
  name?: string
  notes?: string
  platform?: string
  type?: string
  credentials?: TemplateCredentialRecord
  extra?: TemplateExtraRecord
  concurrency?: number
  priority?: number
  rate_multiplier?: number
  auto_pause_on_expired?: boolean
}

interface TemplateFileRecord {
  exported_at?: string
  proxies?: unknown[]
  accounts?: TemplateAccountRecord[]
}

function toEpochSeconds(value?: string | number | null): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value))
  }

  if (!value || typeof value !== 'string') {
    return null
  }

  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) {
    return null
  }

  return Math.floor(parsed / 1000)
}

function toIsoFromEpochSeconds(value?: number | null): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined
  }

  return new Date(value * 1000).toISOString()
}

function normalizeWindowDuration(value?: number | null): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null
  }

  return Math.floor(value)
}

function normalizeUsedPercent(value?: number | null): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0
  }

  return Math.max(0, Math.min(100, Math.round(value)))
}

function resolveClaimString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}

function resolveAuthMetadata(auth: CodexAuthPayload): {
  email?: string
  userId?: string
  organizationId?: string
  scope?: string
  tokenType?: string
  expiresAt?: string
} {
  const idClaims = decodeJwtPayload(auth.tokens?.id_token)
  const accessClaims = decodeJwtPayload(auth.tokens?.access_token)
  const authClaims =
    accessClaims['https://api.openai.com/auth'] &&
    typeof accessClaims['https://api.openai.com/auth'] === 'object'
      ? (accessClaims['https://api.openai.com/auth'] as Record<string, unknown>)
      : {}
  const expiresAt = toIsoFromEpochSeconds(
    typeof accessClaims.exp === 'number' ? accessClaims.exp : undefined
  )

  return {
    email:
      resolveClaimString(idClaims, 'email') ??
      resolveClaimString(accessClaims, 'email') ??
      resolveClaimString(authClaims, 'email'),
    userId:
      resolveClaimString(idClaims, 'sub') ??
      resolveClaimString(accessClaims, 'sub') ??
      resolveClaimString(authClaims, 'chatgpt_user_id'),
    organizationId:
      resolveClaimString(authClaims, 'organization_id') ??
      resolveClaimString(idClaims, 'organization_id') ??
      resolveClaimString(accessClaims, 'organization_id'),
    scope: resolveClaimString(accessClaims, 'scope'),
    tokenType: resolveClaimString(accessClaims, 'token_type'),
    expiresAt
  }
}

function buildTemplateRateLimits(
  extra: TemplateExtraRecord | undefined,
  credentials: TemplateCredentialRecord | undefined,
  exportedAt: string
): AccountRateLimits | null {
  if (!extra) {
    return null
  }

  const primaryResetsAt =
    toEpochSeconds(extra.codex_primary_reset_at) ??
    (typeof extra.codex_primary_reset_after_seconds === 'number'
      ? Math.floor(Date.now() / 1000) + Math.max(0, Math.floor(extra.codex_primary_reset_after_seconds))
      : null)
  const secondaryResetsAt =
    toEpochSeconds(extra.codex_secondary_reset_at) ??
    (typeof extra.codex_secondary_reset_after_seconds === 'number'
      ? Math.floor(Date.now() / 1000) + Math.max(0, Math.floor(extra.codex_secondary_reset_after_seconds))
      : null)

  const hasPrimary =
    primaryResetsAt !== null ||
    typeof extra.codex_primary_used_percent === 'number' ||
    typeof extra.codex_primary_window_minutes === 'number'
  const hasSecondary =
    secondaryResetsAt !== null ||
    typeof extra.codex_secondary_used_percent === 'number' ||
    typeof extra.codex_secondary_window_minutes === 'number'

  if (!hasPrimary && !hasSecondary) {
    return null
  }

  return {
    limitId: 'codex',
    limitName: null,
    planType: credentials?.plan_type ?? null,
    primary: hasPrimary
      ? {
          usedPercent: normalizeUsedPercent(extra.codex_primary_used_percent),
          windowDurationMins: normalizeWindowDuration(extra.codex_primary_window_minutes),
          resetsAt: primaryResetsAt
        }
      : null,
    secondary: hasSecondary
      ? {
          usedPercent: normalizeUsedPercent(extra.codex_secondary_used_percent),
          windowDurationMins: normalizeWindowDuration(extra.codex_secondary_window_minutes),
          resetsAt: secondaryResetsAt
        }
      : null,
    credits: {
      hasCredits: false,
      unlimited: false,
      balance: null
    },
    limits: [
      {
        limitId: 'codex',
        limitName: null,
        planType: credentials?.plan_type ?? null,
        primary: hasPrimary
          ? {
              usedPercent: normalizeUsedPercent(extra.codex_primary_used_percent),
              windowDurationMins: normalizeWindowDuration(extra.codex_primary_window_minutes),
              resetsAt: primaryResetsAt
            }
          : null,
        secondary: hasSecondary
          ? {
              usedPercent: normalizeUsedPercent(extra.codex_secondary_used_percent),
              windowDurationMins: normalizeWindowDuration(extra.codex_secondary_window_minutes),
              resetsAt: secondaryResetsAt
            }
          : null
      }
    ],
    fetchedAt: extra.codex_usage_updated_at ?? exportedAt
  }
}

function buildAuthPayloadFromTemplate(
  account: TemplateAccountRecord,
  exportedAt: string
): CodexAuthPayload {
  const credentials = account.credentials
  if (!credentials) {
    throw new Error('Template account is missing credentials.')
  }

  return {
    auth_mode: 'chatgpt',
    OPENAI_API_KEY: null,
    last_refresh: exportedAt,
    tokens: {
      access_token: credentials.access_token,
      refresh_token: credentials.refresh_token,
      id_token: credentials.id_token,
      account_id: credentials.chatgpt_account_id
    }
  }
}

function buildTemplateAccountExport(
  account: AccountSummary,
  auth: CodexAuthPayload,
  rateLimits: AccountRateLimits | undefined,
  exportedAt: string
): TemplateAccountRecord {
  const metadata = resolveAuthMetadata(auth)
  const primary = rateLimits?.primary
  const secondary = rateLimits?.secondary

  return {
    name: account.name ?? account.email ?? account.accountId ?? account.id,
    notes: '',
    platform: 'openai',
    type: 'oauth',
    credentials: {
      _token_version: 1,
      access_token: auth.tokens?.access_token,
      chatgpt_account_id: auth.tokens?.account_id ?? account.accountId,
      chatgpt_user_id: metadata.userId,
      client_id: 'app_EMoamEEZ73f0CkXaXp7hrann',
      email: account.email ?? metadata.email,
      expires_at: metadata.expiresAt,
      expires_in:
        metadata.expiresAt != null
          ? Math.max(0, Math.floor((Date.parse(metadata.expiresAt) - Date.now()) / 1000))
          : undefined,
      id_token: auth.tokens?.id_token,
      organization_id: metadata.organizationId,
      plan_type: rateLimits?.planType ?? undefined,
      refresh_token: auth.tokens?.refresh_token,
      scope: metadata.scope ?? null,
      token_type: metadata.tokenType ?? null
    },
    extra: {
      codex_5h_reset_after_seconds:
        typeof primary?.resetsAt === 'number'
          ? Math.max(0, primary.resetsAt - Math.floor(Date.now() / 1000))
          : undefined,
      codex_5h_reset_at: toIsoFromEpochSeconds(primary?.resetsAt),
      codex_5h_used_percent: primary?.usedPercent ?? undefined,
      codex_5h_window_minutes: primary?.windowDurationMins ?? undefined,
      codex_7d_reset_after_seconds:
        typeof secondary?.resetsAt === 'number'
          ? Math.max(0, secondary.resetsAt - Math.floor(Date.now() / 1000))
          : undefined,
      codex_7d_reset_at: toIsoFromEpochSeconds(secondary?.resetsAt),
      codex_7d_used_percent: secondary?.usedPercent ?? undefined,
      codex_7d_window_minutes: secondary?.windowDurationMins ?? undefined,
      codex_primary_over_secondary_percent:
        typeof primary?.usedPercent === 'number' && typeof secondary?.usedPercent === 'number'
          ? Math.max(0, primary.usedPercent - secondary.usedPercent)
          : undefined,
      codex_primary_reset_after_seconds:
        typeof primary?.resetsAt === 'number'
          ? Math.max(0, primary.resetsAt - Math.floor(Date.now() / 1000))
          : undefined,
      codex_primary_reset_at: toIsoFromEpochSeconds(primary?.resetsAt),
      codex_primary_used_percent: primary?.usedPercent ?? undefined,
      codex_primary_window_minutes: primary?.windowDurationMins ?? undefined,
      codex_secondary_reset_after_seconds:
        typeof secondary?.resetsAt === 'number'
          ? Math.max(0, secondary.resetsAt - Math.floor(Date.now() / 1000))
          : undefined,
      codex_secondary_reset_at: toIsoFromEpochSeconds(secondary?.resetsAt),
      codex_secondary_used_percent: secondary?.usedPercent ?? undefined,
      codex_secondary_window_minutes: secondary?.windowDurationMins ?? undefined,
      codex_usage_updated_at: rateLimits?.fetchedAt ?? exportedAt,
      email: account.email ?? metadata.email,
      privacy_mode: 'training_off'
    },
    concurrency: 10,
    priority: 1,
    rate_multiplier: 1,
    auto_pause_on_expired: false
  }
}

function parseExtraArgs(raw: string): string[] {
  const tokens = raw.match(/"([^"\\]|\\.)*"|'([^'\\]|\\.)*'|[^\s]+/g) ?? []
  return tokens
    .map((token) => {
      if (
        (token.startsWith('"') && token.endsWith('"')) ||
        (token.startsWith("'") && token.endsWith("'"))
      ) {
        return token.slice(1, -1).replace(/\\(["'])/g, '$1')
      }

      return token
    })
    .filter(Boolean)
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

async function pathExists(value: string): Promise<boolean> {
  try {
    await fs.access(value)
    return true
  } catch {
    return false
  }
}

export async function resolveWindowsCodexDesktopExecutable(): Promise<string | null> {
  const powershellPath = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'

  try {
    const stdout = await new Promise<string>((resolveStdout, rejectStdout) => {
      execFileCallback(
        powershellPath,
        [
          '-NoProfile',
          '-Command',
          '(Get-AppxPackage *Codex* | Select-Object -ExpandProperty InstallLocation -First 1)'
        ],
        (error, commandStdout) => {
          if (error) {
            rejectStdout(error)
            return
          }

          resolveStdout(commandStdout)
        }
      )
    })
    const installLocation = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean)

    if (installLocation) {
      return join(installLocation, 'app', 'Codex.exe')
    }
  } catch {
    // Fall through to explicit configuration or PATH-based fallback.
  }

  return null
}

async function listCodexProcessIds(): Promise<number[]> {
  try {
    const { stdout } = await execFile('pgrep', ['-f', codexProcessPattern])
    return stdout
      .split('\n')
      .map((line) => Number(line.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0)
  } catch {
    return []
  }
}

function isPidRunning(pid?: number): boolean {
  if (!pid || pid <= 0) {
    return false
  }

  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function pidTouchesCodexHome(pid: number, codexHome: string): Promise<boolean> {
  try {
    const { stdout } = await execFile('lsof', ['-Fn', '-p', String(pid)])
    const normalizedPath = resolve(codexHome)

    return stdout
      .split('\n')
      .filter((line) => line.startsWith('n'))
      .map((line) => line.slice(1))
      .some((openedPath) => openedPath === normalizedPath || openedPath.startsWith(`${normalizedPath}/`))
  } catch {
    return false
  }
}

async function resolveRunningCodexPid(
  codexHome: string,
  lastPid?: number
): Promise<number | undefined> {
  if (lastPid && isPidRunning(lastPid) && (await pidTouchesCodexHome(lastPid, codexHome))) {
    return lastPid
  }

  for (const pid of await listCodexProcessIds()) {
    if (await pidTouchesCodexHome(pid, codexHome)) {
      return pid
    }
  }

  return undefined
}

async function resolveManagedCodexPid(
  codexHome: string,
  lastPid?: number
): Promise<number | undefined> {
  if (lastPid && isPidRunning(lastPid)) {
    return lastPid
  }

  return resolveRunningCodexPid(codexHome, lastPid)
}

async function stopCodexProcess(pid: number): Promise<void> {
  if (!isPidRunning(pid)) {
    return
  }

  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (!isPidRunning(pid)) {
      return
    }

    await new Promise((resolveSleep) => setTimeout(resolveSleep, 200))
  }

  if (isPidRunning(pid)) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // Ignore a process that exited between checks.
    }
  }
}

async function resolveCodexLaunchCommand(options?: {
  preferAppBundle?: boolean
  requireDesktopExecutable?: boolean
  desktopExecutablePath?: string
}): Promise<string> {
  const explicitPath = process.env['ILOVECODEX_CODEX_BIN']?.trim()
  if (explicitPath) {
    return explicitPath
  }

  const configuredDesktopPath = options?.desktopExecutablePath?.trim()
  if (configuredDesktopPath) {
    return configuredDesktopPath
  }

  if (options?.preferAppBundle && process.platform === 'darwin' && (await pathExists(macosCodexAppBinary))) {
    return macosCodexAppBinary
  }

  if (options?.requireDesktopExecutable) {
    const detectedWindowsExecutable = await resolveWindowsCodexDesktopExecutable()
    if (detectedWindowsExecutable) {
      return detectedWindowsExecutable
    }
  }

  if (options?.requireDesktopExecutable) {
    throw new Error(
      process.platform === 'darwin'
        ? 'Codex app bundle not found. Install Codex.app or set ILOVECODEX_CODEX_BIN.'
        : 'Codex desktop executable not configured. Set ILOVECODEX_CODEX_BIN to the Codex desktop executable path.'
    )
  }

  try {
    const locator = process.platform === 'win32' ? 'where.exe' : 'which'
    const { stdout } = await execFile(locator, ['codex'])
    const resolved = stdout
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean)

    if (resolved) {
      return resolved
    }
  } catch {
    // Fall through to bundle fallback.
  }

  if (process.platform === 'darwin' && (await pathExists(macosCodexAppBinary))) {
    return macosCodexAppBinary
  }

  throw new Error(
    'Codex executable not found. Install Codex, add `codex` to PATH, or set ILOVECODEX_CODEX_BIN.'
  )
}

async function launchCodexDesktop(options: {
  workspacePath: string
  codexHome: string
  extraArgs: string
  preferAppBundle?: boolean
  requireDesktopExecutable?: boolean
  desktopExecutablePath?: string
}): Promise<number> {
  const launchCommand = await resolveCodexLaunchCommand({
    preferAppBundle: options.preferAppBundle,
    requireDesktopExecutable: options.requireDesktopExecutable,
    desktopExecutablePath: options.desktopExecutablePath
  })
  const args = [...parseExtraArgs(options.extraArgs), 'app', options.workspacePath]

  return await new Promise<number>((resolveLaunch, rejectLaunch) => {
    const child = spawn(launchCommand, args, {
      cwd: options.workspacePath,
      env: {
        ...process.env,
        CODEX_HOME: options.codexHome
      },
      detached: true,
      stdio: 'ignore'
    })

    child.once('error', (error) => {
      rejectLaunch(error)
    })
    child.once('spawn', () => {
      const pid = child.pid
      child.unref()

      if (!pid) {
        rejectLaunch(new Error('Codex process started without a PID.'))
        return
      }

      resolveLaunch(pid)
    })
  }).catch((error: NodeJS.ErrnoException) => {
    if (error?.code === 'ENOENT') {
      throw new Error(
        'Codex executable not found. Install Codex, add `codex` to PATH, or set ILOVECODEX_CODEX_BIN.'
      )
    }

    if (error?.code === 'EACCES') {
      throw new Error(`Codex executable is not runnable: ${launchCommand}`)
    }

    throw error
  })
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

async function writeAuthPayloadToCodexHome(
  codexHome: string,
  authPayload: CodexAuthPayload
): Promise<void> {
  await fs.mkdir(codexHome, { recursive: true })
  await fs.writeFile(join(codexHome, 'auth.json'), `${JSON.stringify(authPayload, null, 2)}\n`, 'utf8')
}

async function writeProviderApiKeyToCodexHome(
  codexHome: string,
  apiKey: string
): Promise<void> {
  await fs.mkdir(codexHome, { recursive: true })
  await fs.writeFile(
    join(codexHome, 'auth.json'),
    `${JSON.stringify({ OPENAI_API_KEY: apiKey }, null, 2)}\n`,
    'utf8'
  )
}

async function writeProviderConfigToCodexHome(
  codexHome: string,
  provider: Pick<CustomProviderSummary, 'name' | 'baseUrl' | 'model' | 'fastMode'>
): Promise<void> {
  const configPath = join(codexHome, 'config.toml')
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
    name: provider.name?.trim() || 'custom',
    wire_api: 'responses',
    requires_openai_auth: true,
    base_url: provider.baseUrl
  }

  const feature =
    nextConfig['feature'] && typeof nextConfig['feature'] === 'object'
      ? { ...(nextConfig['feature'] as Record<string, unknown>) }
      : {}
  feature['fast_mode'] = provider.fastMode

  nextConfig['model'] = provider.model?.trim() || '5.4'
  nextConfig['model_provider'] = 'custom'
  nextConfig['model_providers'] = modelProviders
  nextConfig['feature'] = feature

  await fs.mkdir(codexHome, { recursive: true })
  await fs.writeFile(
    configPath,
    `${stringifyToml(nextConfig as Parameters<typeof stringifyToml>[0])}\n`,
    'utf8'
  )
}

export interface CodexServices {
  getSnapshot(): Promise<AppSnapshot>
  accounts: {
    list(): Promise<AppSnapshot>
    importCurrent(): Promise<AppSnapshot>
    importFromTemplate(raw: string): Promise<AppSnapshot>
    exportToTemplate(): Promise<string>
    activate(accountId: string): Promise<AppSnapshot>
    activateBest(): Promise<AppSnapshot>
    refreshExpiringSession(accountId: string): Promise<boolean>
    reorder(accountIds: string[]): Promise<AppSnapshot>
    remove(accountId: string): Promise<AppSnapshot>
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
    start(method: 'browser' | 'device'): Promise<{ attemptId: string; method: 'browser' | 'device' }>
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

    if (!accessTokenExpiresSoon(storedAuth.tokens?.access_token) || !storedAuth.tokens?.refresh_token) {
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
      const detail =
        error instanceof Error ? error.message : 'Failed to refresh account session.'
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
        let parsed: TemplateFileRecord

        try {
          parsed = JSON.parse(raw) as TemplateFileRecord
        } catch {
          throw new Error('Invalid account template file.')
        }

        const accounts = Array.isArray(parsed.accounts) ? parsed.accounts : []
        if (!accounts.length) {
          throw new Error('Template file does not contain any accounts.')
        }

        const exportedAt = parsed.exported_at ?? new Date().toISOString()

        for (const account of accounts) {
          const authPayload = buildAuthPayloadFromTemplate(account, exportedAt)
          const imported = await store.importAuthPayload(authPayload)
          const rateLimits = buildTemplateRateLimits(account.extra, account.credentials, exportedAt)
          if (rateLimits) {
            await store.saveAccountRateLimits(imported.id, rateLimits)
          }
        }

        return getSnapshot()
      },
      exportToTemplate: async () => {
        const snapshot = await getSnapshot()
        const exportedAt = new Date().toISOString()
        const accounts: TemplateAccountRecord[] = []

        for (const account of snapshot.accounts) {
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
        const resolvedAccountId = accountId
          ? await resolveAccountIdOrThrow(accountId)
          : undefined
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
