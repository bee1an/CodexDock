import { EventEmitter } from 'node:events'
import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  LocalGatewayLogEntry,
  LoginEvent,
  OpenCodexFromServiceInput,
  OpenCodexFromServiceResult
} from '../../shared/codex'
import type { CodexPlatformAdapter, ProtectedPayload } from '../../shared/codex-platform'
import { CodexAccountStore } from '../codex-auth'
import { CodexInstanceStore } from '../codex-instances'
import { CodexProviderStore } from '../codex-providers'
import { CodexLocalGatewayService } from '../local-gateway'

const mockedProcessState = vi.hoisted(() => {
  return {
    execFile: vi.fn(),
    spawn: vi.fn(),
    runningPids: new Set<number>(),
    pidHomes: new Map<number, string>(),
    spawnedCommands: [] as string[],
    nextPid: 4000
  }
})

vi.mock('node:child_process', () => ({
  execFile: mockedProcessState.execFile,
  spawn: mockedProcessState.spawn
}))

import { createCodexServices, resolveWindowsCodexDesktopExecutable } from '../codex-services'

interface TestAuthPayload {
  auth_mode: 'chatgpt'
  last_refresh: string
  tokens: {
    access_token: string
    refresh_token: string
    id_token: string
    account_id: string
  }
}

interface TestRefreshPayload {
  access_token: string
  refresh_token: string
  id_token: string
}

function createPlatform(): CodexPlatformAdapter {
  return {
    fetch: vi.fn(),
    protect: (value: string): ProtectedPayload => ({
      mode: 'plain',
      value
    }),
    unprotect: (payload: ProtectedPayload): string => payload.value,
    openExternal: vi.fn(async () => undefined),
    trashItem: vi.fn(async () => undefined)
  }
}

function createJwt(payload: Record<string, unknown>): string {
  const encode = (value: Record<string, unknown>): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url')

  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.sig`
}

function createAuthPayload(accountId: string, email: string): TestAuthPayload {
  return {
    auth_mode: 'chatgpt',
    last_refresh: new Date().toISOString(),
    tokens: {
      access_token: createJwt({
        exp: Math.floor(Date.now() / 1000) + 3600,
        'https://api.openai.com/auth': {
          chatgpt_account_id: accountId
        }
      }),
      refresh_token: `refresh-${accountId}`,
      id_token: createJwt({
        email,
        name: email.split('@')[0],
        'https://api.openai.com/auth': {
          chatgpt_account_id: accountId
        }
      }),
      account_id: accountId
    }
  }
}

function createRefreshPayload(
  accountId: string,
  email: string,
  refreshToken: string,
  subject?: string
): TestRefreshPayload {
  return {
    access_token: createJwt({
      sub: subject,
      exp: Math.floor(Date.now() / 1000) + 3600,
      'https://api.openai.com/auth': {
        chatgpt_account_id: accountId
      }
    }),
    refresh_token: refreshToken,
    id_token: createJwt({
      sub: subject,
      email,
      name: email.split('@')[0],
      'https://api.openai.com/auth': {
        chatgpt_account_id: accountId
      }
    })
  }
}

function createJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json'
    }
  })
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (address && typeof address === 'object') {
          resolve(address.port)
          return
        }
        reject(new Error('Failed to allocate a free port.'))
      })
    })
  })
}

function createLocalGatewayForTest(
  env: { userDataPath: string },
  platform: CodexPlatformAdapter,
  openCodexFromService: (
    input?: OpenCodexFromServiceInput
  ) => Promise<OpenCodexFromServiceResult> = vi.fn(async () => ({
    ok: true as const,
    pid: 4321,
    codexHome: join(env.userDataPath, 'codex-home'),
    workspacePath: join(env.userDataPath, 'workspace'),
    multi: false,
    target: {
      type: 'default' as const,
      name: 'Default'
    }
  }))
): CodexLocalGatewayService {
  return new CodexLocalGatewayService({
    store: new CodexAccountStore(env.userDataPath, platform, join(env.userDataPath, '.codex')),
    providerStore: new CodexProviderStore(env.userDataPath, platform),
    logFilePath: join(env.userDataPath, 'local-gateway-logs.json'),
    platform,
    refreshAuthForUse: vi.fn(async () => {
      throw new Error('unused')
    }),
    refreshStoredAuthGuarded: vi.fn(async () => {
      throw new Error('unused')
    }),
    openCodexFromService
  })
}

function createUsageResponse(overrides?: {
  planType?: string
  primaryUsedPercent?: number
  primaryResetAt?: number
  secondaryUsedPercent?: number
  secondaryResetAt?: number
}): Response {
  return createJsonResponse({
    user_id: 'user_123',
    account_id: 'acct-a',
    email: 'a@example.com',
    plan_type: overrides?.planType ?? 'plus',
    rate_limit: {
      allowed: true,
      limit_reached: false,
      primary_window: {
        used_percent: overrides?.primaryUsedPercent ?? 12,
        limit_window_seconds: 18_000,
        reset_after_seconds: 60,
        reset_at: overrides?.primaryResetAt ?? 1_800_000_000
      },
      secondary_window: {
        used_percent: overrides?.secondaryUsedPercent ?? 34,
        limit_window_seconds: 604_800,
        reset_after_seconds: 600,
        reset_at: overrides?.secondaryResetAt ?? 1_800_500_000
      }
    },
    credits: null,
    additional_rate_limits: []
  })
}

function createTemplateImport(options: {
  accountId: string
  email: string
  planType?: string
  primaryUsedPercent?: number
  primaryResetAt?: string
  secondaryUsedPercent?: number
  secondaryResetAt?: string
}): string {
  return JSON.stringify({
    exported_at: '2026-03-24T08:00:00.000Z',
    proxies: [],
    accounts: [
      {
        name: options.email,
        notes: '',
        platform: 'openai',
        type: 'oauth',
        credentials: {
          _token_version: 1,
          access_token: createJwt({
            exp: Math.floor(Date.now() / 1000) + 3600,
            'https://api.openai.com/auth': {
              chatgpt_account_id: options.accountId
            }
          }),
          refresh_token: `refresh-${options.accountId}`,
          id_token: createJwt({
            email: options.email,
            name: options.email.split('@')[0],
            'https://api.openai.com/auth': {
              chatgpt_account_id: options.accountId
            }
          }),
          chatgpt_account_id: options.accountId,
          client_id: 'app_EMoamEEZ73f0CkXaXp7hrann',
          email: options.email,
          expires_at: '2026-03-24T09:00:00.000Z',
          expires_in: 3600,
          plan_type: options.planType ?? 'plus',
          scope: null,
          token_type: null
        },
        extra: {
          codex_5h_reset_after_seconds: 7200,
          codex_5h_reset_at: options.primaryResetAt ?? '2026-03-24T10:00:00.000Z',
          codex_5h_used_percent: options.primaryUsedPercent ?? 20,
          codex_5h_window_minutes: 300,
          codex_7d_reset_after_seconds: 604800,
          codex_7d_reset_at: options.secondaryResetAt ?? '2026-03-31T08:00:00.000Z',
          codex_7d_used_percent: options.secondaryUsedPercent ?? 40,
          codex_7d_window_minutes: 10080,
          codex_primary_over_secondary_percent:
            (options.primaryUsedPercent ?? 20) - (options.secondaryUsedPercent ?? 40),
          codex_primary_reset_after_seconds: 7200,
          codex_primary_reset_at: options.primaryResetAt ?? '2026-03-24T10:00:00.000Z',
          codex_primary_used_percent: options.primaryUsedPercent ?? 20,
          codex_primary_window_minutes: 300,
          codex_secondary_reset_after_seconds: 604800,
          codex_secondary_reset_at: options.secondaryResetAt ?? '2026-03-31T08:00:00.000Z',
          codex_secondary_used_percent: options.secondaryUsedPercent ?? 40,
          codex_secondary_window_minutes: 10080,
          codex_usage_updated_at: '2026-03-24T08:00:00.000Z',
          email: options.email,
          privacy_mode: 'training_off'
        },
        concurrency: 10,
        priority: 1,
        rate_multiplier: 1,
        auto_pause_on_expired: false
      }
    ]
  })
}

describe('createCodexServices', () => {
  const createdDirectories: string[] = []
  let originalHome: string | undefined
  let originalCodexBin: string | undefined
  const originalPlatform = process.platform
  let processKillSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    mockedProcessState.execFile.mockReset()
    mockedProcessState.spawn.mockReset()
    mockedProcessState.runningPids.clear()
    mockedProcessState.pidHomes.clear()
    mockedProcessState.spawnedCommands.splice(0)
    mockedProcessState.nextPid = 4000
    originalCodexBin = process.env.ILOVECODEX_CODEX_BIN
    process.env.ILOVECODEX_CODEX_BIN = '/Applications/Codex.app/Contents/MacOS/Codex'

    mockedProcessState.execFile.mockImplementation(
      (
        file: string,
        args: string[] | ((error: Error | null, stdout: string, stderr: string) => void),
        options:
          | { cwd?: string; env?: NodeJS.ProcessEnv }
          | ((error: Error | null, stdout: string, stderr: string) => void),
        callback?: (error: Error | null, stdout: string, stderr: string) => void
      ) => {
        const resolvedArgs = Array.isArray(args) ? args : []
        const resolvedCallback =
          typeof args === 'function' ? args : typeof options === 'function' ? options : callback

        if (!resolvedCallback) {
          throw new Error('Missing execFile callback')
        }

        if (file === 'which' || file === 'where.exe') {
          resolvedCallback(null, '/usr/local/bin/codex\n', '')
          return
        }

        if (file === 'open') {
          resolvedCallback(null, '', '')
          return
        }

        if (file === 'pgrep') {
          const stdout = [...mockedProcessState.runningPids].join('\n')
          if (stdout) {
            resolvedCallback(null, `${stdout}\n`, '')
            return
          }

          const error = Object.assign(new Error('not found'), { code: 1 })
          resolvedCallback(error, '', '')
          return
        }

        if (file === 'lsof') {
          const pid = Number(resolvedArgs.at(-1))
          const codexHome = mockedProcessState.pidHomes.get(pid)
          if (!codexHome) {
            const error = Object.assign(new Error('not found'), { code: 1 })
            resolvedCallback(error, '', '')
            return
          }

          resolvedCallback(null, `p${pid}\nn${codexHome}/auth.json\n`, '')
          return
        }

        throw new Error(`Unexpected execFile call: ${file}`)
      }
    )

    mockedProcessState.spawn.mockImplementation(
      (command: string, _args: string[], options?: { env?: NodeJS.ProcessEnv }) => {
        const child = new EventEmitter() as EventEmitter & {
          pid: number
          unref: () => void
          once: EventEmitter['once']
        }
        mockedProcessState.spawnedCommands.push(command)
        const pid = mockedProcessState.nextPid++
        child.pid = pid
        child.unref = vi.fn()

        mockedProcessState.runningPids.add(pid)
        mockedProcessState.pidHomes.set(pid, options?.env?.CODEX_HOME ?? '')

        queueMicrotask(() => {
          child.emit('spawn')
        })

        return child
      }
    )

    processKillSpy = vi
      .spyOn(process, 'kill')
      .mockImplementation((pid: number, signal?: string | number) => {
        if (signal === 0) {
          if (!mockedProcessState.runningPids.has(pid)) {
            throw Object.assign(new Error('not running'), { code: 'ESRCH' })
          }
          return true
        }

        mockedProcessState.runningPids.delete(pid)
        mockedProcessState.pidHomes.delete(pid)
        return true
      })
  })

  afterEach(async () => {
    processKillSpy.mockRestore()
    Object.defineProperty(process, 'platform', { value: originalPlatform })
    if (originalCodexBin === undefined) {
      delete process.env.ILOVECODEX_CODEX_BIN
    } else {
      process.env.ILOVECODEX_CODEX_BIN = originalCodexBin
    }
    process.env.HOME = originalHome
    await Promise.all(
      createdDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true }))
    )
  })

  async function createEnvironment(): Promise<{
    userDataPath: string
    workspacePath: string
    globalAuthPath: string
  }> {
    const directory = await mkdtemp(join(tmpdir(), 'codexdock-services-'))
    createdDirectories.push(directory)

    originalHome = process.env.HOME
    process.env.HOME = join(directory, 'home')

    const workspacePath = join(directory, 'workspace')
    await mkdir(workspacePath, { recursive: true })

    return {
      userDataPath: join(directory, 'user-data'),
      workspacePath,
      globalAuthPath: join(process.env.HOME, '.codex', 'auth.json')
    }
  }

  async function writeGlobalAuth(path: string, payload: unknown): Promise<void> {
    await mkdir(join(process.env.HOME ?? '', '.codex'), { recursive: true })
    await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  }

  async function writeTokenCostSessionLog(codexHome: string): Promise<void> {
    const now = new Date()
    const year = String(now.getFullYear())
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    const sessionDir = join(codexHome, 'sessions', year, month, day)
    await mkdir(sessionDir, { recursive: true })
    await writeFile(
      join(sessionDir, 'session.jsonl'),
      [
        JSON.stringify({
          timestamp: now.toISOString(),
          type: 'session_meta',
          payload: {
            session_id: 'session-login'
          }
        }),
        JSON.stringify({
          timestamp: now.toISOString(),
          type: 'turn_context',
          payload: {
            model: 'gpt-5'
          }
        }),
        JSON.stringify({
          timestamp: now.toISOString(),
          type: 'event_msg',
          payload: {
            type: 'token_count',
            info: {
              last_token_usage: {
                input_tokens: 9,
                output_tokens: 3
              }
            }
          }
        })
      ].join('\n') + '\n',
      'utf8'
    )
  }

  it('settings.get 只读取 CodexDock 配置，不触发实例和 token/cost 快照', async () => {
    const env = await createEnvironment()
    const brokenCodexHome = join(env.userDataPath, 'broken-default-home')
    await mkdir(env.userDataPath, { recursive: true })
    await writeFile(brokenCodexHome, 'not-a-directory', 'utf8')
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      defaultCodexHome: brokenCodexHome,
      platform: createPlatform()
    })

    await expect(services.settings.get()).resolves.toMatchObject({
      language: 'zh-CN',
      usagePollingMinutes: 15
    })
  })

  it('opens an isolated account instance without changing the global auth file', async () => {
    const env = await createEnvironment()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform: createPlatform()
    })

    await writeGlobalAuth(env.globalAuthPath, createAuthPayload('acct-a', 'a@example.com'))
    await services.accounts.importCurrent()

    await writeGlobalAuth(env.globalAuthPath, createAuthPayload('acct-b', 'b@example.com'))
    await services.accounts.importCurrent()

    const snapshot = await services.getSnapshot()
    const accountA = snapshot.accounts.find((account) => account.email === 'a@example.com')
    const accountB = snapshot.accounts.find((account) => account.email === 'b@example.com')
    expect(accountA).toBeTruthy()
    expect(accountB).toBeTruthy()

    await services.accounts.activate(accountA!.id)
    await services.codex.openIsolated(accountB!.id, env.workspacePath)

    const globalAuth = JSON.parse(await readFile(env.globalAuthPath, 'utf8')) as {
      tokens?: { account_id?: string }
    }
    const isolatedHome = [...mockedProcessState.pidHomes.values()].find(
      (value) => value && value !== join(process.env.HOME ?? '', '.codex')
    )
    expect(isolatedHome).toBeTruthy()
    const isolatedAuthPath = join(isolatedHome!, 'auth.json')
    const instanceAuth = JSON.parse(await readFile(isolatedAuthPath, 'utf8')) as {
      tokens?: { account_id?: string }
    }

    expect(globalAuth.tokens?.account_id).toBe('acct-a')
    expect(instanceAuth.tokens?.account_id).toBe('acct-b')
    expect(mockedProcessState.spawnedCommands.at(-1)).toBe(
      '/Applications/Codex.app/Contents/MacOS/Codex'
    )
  })

  it('登录成功会先发送快速快照，再异步补齐 token/cost 快照', async () => {
    const env = await createEnvironment()
    const platform = createPlatform()
    await writeTokenCostSessionLog(join(process.env.HOME ?? '', '.codex'))

    const successEvents: LoginEvent[] = []
    let resolveFirstSuccessEvent: ((event: LoginEvent) => void) | undefined
    let resolveHydratedSuccessEvent: ((event: LoginEvent) => void) | undefined
    const firstSuccessEventPromise = new Promise<LoginEvent>((resolve) => {
      resolveFirstSuccessEvent = resolve
    })
    const hydratedSuccessEventPromise = new Promise<LoginEvent>((resolve) => {
      resolveHydratedSuccessEvent = resolve
    })

    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform,
      emitLoginEvent: (event) => {
        if (event.phase !== 'success') {
          return
        }

        successEvents.push(event)
        if (successEvents.length === 1) {
          resolveFirstSuccessEvent?.(event)
        }
        if (event.snapshot?.runningTokenCostSummary) {
          resolveHydratedSuccessEvent?.(event)
        }
      }
    })

    vi.mocked(platform.fetch)
      .mockResolvedValueOnce(
        createJsonResponse({
          device_auth_id: 'device-auth-1',
          user_code: 'CODE-1234',
          interval: 1
        })
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          authorization_code: 'authorization-code',
          code_verifier: 'verifier-code'
        })
      )
      .mockResolvedValueOnce(
        createJsonResponse(
          createRefreshPayload('acct-device', 'device@example.com', 'refresh-device', 'user-device')
        )
      )

    await services.login.start('device')

    const firstSuccessEvent = await firstSuccessEventPromise
    expect(firstSuccessEvent.snapshot?.runningTokenCostSummary).toBeNull()
    expect(firstSuccessEvent.snapshot?.tokenCostByInstanceId).toEqual({})

    const hydratedSuccessEvent = await hydratedSuccessEventPromise

    expect(hydratedSuccessEvent.snapshot?.tokenCostByInstanceId.__default__).toMatchObject({
      sessionTokens: 12,
      last30DaysTokens: 12
    })
    expect(hydratedSuccessEvent.snapshot?.runningTokenCostSummary).toMatchObject({
      sessionTokens: 12,
      last30DaysTokens: 12
    })
    expect(hydratedSuccessEvent.snapshot?.runningTokenCostInstanceIds).toContain('__default__')
  })

  it('hydrated 快照失败时仍异步发送带 fallback snapshot 的登录成功事件', async () => {
    const env = await createEnvironment()
    const platform = createPlatform()
    const brokenCodexHome = join(env.userDataPath, 'broken-home')
    const instanceStore = new CodexInstanceStore(env.userDataPath)
    await mkdir(env.userDataPath, { recursive: true })
    await writeFile(brokenCodexHome, 'not-a-directory', 'utf8')
    const brokenInstance = await instanceStore.create({
      name: 'Broken',
      codexHome: brokenCodexHome
    })
    await instanceStore.setInstancePid(brokenInstance.id, 43210)

    const successEvents: LoginEvent[] = []
    let resolveFirstSuccessEvent: ((event: LoginEvent) => void) | undefined
    let resolveFallbackSuccessEvent: ((event: LoginEvent) => void) | undefined
    const firstSuccessEventPromise = new Promise<LoginEvent>((resolve) => {
      resolveFirstSuccessEvent = resolve
    })
    const fallbackSuccessEventPromise = new Promise<LoginEvent>((resolve) => {
      resolveFallbackSuccessEvent = resolve
    })

    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform,
      emitLoginEvent: (event) => {
        if (event.phase !== 'success') {
          return
        }

        successEvents.push(event)
        if (successEvents.length === 1) {
          resolveFirstSuccessEvent?.(event)
        }
        if (event.snapshot?.tokenCostErrorByInstanceId[brokenInstance.id]) {
          resolveFallbackSuccessEvent?.(event)
        }
      }
    })

    vi.mocked(platform.fetch)
      .mockResolvedValueOnce(
        createJsonResponse({
          device_auth_id: 'device-auth-2',
          user_code: 'CODE-5678',
          interval: 1
        })
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          authorization_code: 'authorization-code-2',
          code_verifier: 'verifier-code-2'
        })
      )
      .mockResolvedValueOnce(
        createJsonResponse(
          createRefreshPayload(
            'acct-device-fallback',
            'fallback@example.com',
            'refresh-device-fallback',
            'user-device-fallback'
          )
        )
      )

    await services.login.start('device')

    const firstSuccessEvent = await firstSuccessEventPromise
    expect(firstSuccessEvent.snapshot?.tokenCostErrorByInstanceId).toEqual({})

    const successEvent = await fallbackSuccessEventPromise

    expect(successEvent.message).toContain('Saved the new device code login')
    expect(successEvent.snapshot?.accounts[0]).toMatchObject({
      email: 'fallback@example.com',
      accountId: 'acct-device-fallback'
    })
    expect(successEvent.snapshot?.codexInstances.map((instance) => instance.id)).toEqual([
      '__default__',
      brokenInstance.id
    ])
    expect(
      successEvent.snapshot?.codexInstances.find((instance) => instance.id === brokenInstance.id)
    ).toMatchObject({
      running: false,
      lastPid: undefined
    })
    expect(successEvent.snapshot?.tokenCostErrorByInstanceId).toMatchObject({
      [brokenInstance.id]: expect.any(String)
    })
  })

  it('shows a running Codex process without launching a duplicate default instance', async () => {
    const env = await createEnvironment()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform: createPlatform()
    })

    await writeGlobalAuth(env.globalAuthPath, createAuthPayload('acct-a', 'a@example.com'))
    await services.accounts.importCurrent()
    const snapshot = await services.getSnapshot()

    await services.codex.openIsolated(snapshot.accounts[0]!.id, env.workspacePath)
    expect(mockedProcessState.spawnedCommands).toHaveLength(1)

    await services.codex.show(env.workspacePath)

    expect(mockedProcessState.spawnedCommands).toHaveLength(1)
  })

  it('opens default Codex without switching to the default bound account', async () => {
    const env = await createEnvironment()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform: createPlatform()
    })

    await writeGlobalAuth(env.globalAuthPath, createAuthPayload('acct-a', 'a@example.com'))
    await services.accounts.importCurrent()
    await writeGlobalAuth(env.globalAuthPath, createAuthPayload('acct-b', 'b@example.com'))
    await services.accounts.importCurrent()

    const snapshot = await services.getSnapshot()
    const accountA = snapshot.accounts.find((account) => account.email === 'a@example.com')
    const accountB = snapshot.accounts.find((account) => account.email === 'b@example.com')
    expect(accountA).toBeTruthy()
    expect(accountB).toBeTruthy()

    await services.accounts.activate(accountA!.id)
    await services.codex.instances.update('__default__', { bindAccountId: accountB!.id })

    await services.codex.show(env.workspacePath)

    let nextSnapshot = await services.getSnapshot()
    let globalAuth = JSON.parse(await readFile(env.globalAuthPath, 'utf8')) as {
      tokens?: { account_id?: string }
    }
    expect(nextSnapshot.activeAccountId).toBe(accountA!.id)
    expect(globalAuth.tokens?.account_id).toBe('acct-a')
    expect(mockedProcessState.spawnedCommands).toHaveLength(1)

    processKillSpy.mockClear()
    await services.codex.show(env.workspacePath)

    nextSnapshot = await services.getSnapshot()
    globalAuth = JSON.parse(await readFile(env.globalAuthPath, 'utf8')) as {
      tokens?: { account_id?: string }
    }
    const terminationCalls = processKillSpy.mock.calls.filter(
      ([, signal]) => signal && signal !== 0
    )

    expect(nextSnapshot.activeAccountId).toBe(accountA!.id)
    expect(globalAuth.tokens?.account_id).toBe('acct-a')
    expect(mockedProcessState.spawnedCommands).toHaveLength(1)
    expect(terminationCalls).toHaveLength(0)
  })

  it('uses the configured desktop executable path for isolated launches when provided', async () => {
    const env = await createEnvironment()
    delete process.env.ILOVECODEX_CODEX_BIN
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform: createPlatform()
    })

    await services.settings.update({
      codexDesktopExecutablePath: 'C:\\Program Files\\Codex\\Codex.exe'
    })
    await writeGlobalAuth(env.globalAuthPath, createAuthPayload('acct-a', 'a@example.com'))
    await services.accounts.importCurrent()

    const snapshot = await services.getSnapshot()
    await services.codex.openIsolated(snapshot.accounts[0]!.id, env.workspacePath)

    expect(mockedProcessState.spawnedCommands.at(-1)).toBe('C:\\Program Files\\Codex\\Codex.exe')
  })

  it('detects the Windows Store desktop executable from InstallLocation', async () => {
    mockedProcessState.execFile.mockImplementation(
      (
        file: string,
        args: string[] | ((error: Error | null, stdout: string, stderr: string) => void),
        options:
          | { cwd?: string; env?: NodeJS.ProcessEnv }
          | ((error: Error | null, stdout: string, stderr: string) => void),
        callback?: (error: Error | null, stdout: string, stderr: string) => void
      ) => {
        const resolvedCallback =
          typeof args === 'function' ? args : typeof options === 'function' ? options : callback

        if (!resolvedCallback) {
          throw new Error('Missing execFile callback')
        }

        if (file.toLowerCase().endsWith('powershell.exe')) {
          resolvedCallback(
            null,
            'C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.309.3504.0_x64__2p2nqsdec76g0\r\n',
            ''
          )
          return
        }

        throw new Error(`Unexpected execFile call: ${file}`)
      }
    )

    await expect(resolveWindowsCodexDesktopExecutable()).resolves.toBe(
      'C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.309.3504.0_x64__2p2nqsdec76g0/app/Codex.exe'
    )
  })

  it('syncs only config files into isolated instances', async () => {
    const env = await createEnvironment()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform: createPlatform()
    })

    await writeGlobalAuth(env.globalAuthPath, createAuthPayload('acct-a', 'a@example.com'))
    await writeFile(
      join(process.env.HOME ?? '', '.codex', 'config.toml'),
      'model = "gpt-5"\n',
      'utf8'
    )
    await writeFile(join(process.env.HOME ?? '', '.codex', 'memory.md'), '# memory\n', 'utf8')
    await writeFile(join(process.env.HOME ?? '', '.codex', 'history.jsonl'), '{}\n', 'utf8')
    await mkdir(join(process.env.HOME ?? '', '.codex', 'worktrees', 'demo'), { recursive: true })
    await writeFile(
      join(process.env.HOME ?? '', '.codex', 'worktrees', 'demo', 'note.txt'),
      'demo\n',
      'utf8'
    )

    await services.accounts.importCurrent()
    const snapshot = await services.getSnapshot()

    await services.codex.openIsolated(snapshot.accounts[0].id, env.workspacePath)

    const isolatedHome = [...mockedProcessState.pidHomes.values()].find(
      (value) => value && value !== join(process.env.HOME ?? '', '.codex')
    )
    expect(isolatedHome).toBeTruthy()

    await expect(readFile(join(isolatedHome!, 'config.toml'), 'utf8')).resolves.toContain('gpt-5')
    await expect(readFile(join(isolatedHome!, 'memory.md'), 'utf8')).resolves.toContain('# memory')
    await expect(stat(join(isolatedHome!, 'history.jsonl'))).rejects.toBeTruthy()
    await expect(stat(join(isolatedHome!, 'worktrees'))).rejects.toBeTruthy()
  })

  it('opens a custom provider directly in the default codex home with provider auth and config', async () => {
    const env = await createEnvironment()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform: createPlatform()
    })

    await writeGlobalAuth(env.globalAuthPath, createAuthPayload('acct-a', 'a@example.com'))
    await writeFile(
      join(process.env.HOME ?? '', '.codex', 'config.toml'),
      'model = "gpt-5"\n',
      'utf8'
    )
    await services.accounts.importCurrent()

    const created = await services.providers.create({
      name: 'Bee',
      baseUrl: 'https://api.bee1an.us.kg/v1',
      apiKey: 'provider-secret',
      model: 'gpt-5.4',
      fastMode: true
    })
    const providerId = created.providers[0]?.id
    expect(providerId).toBeTruthy()

    await services.providers.open(providerId!, env.workspacePath)

    const defaultHome = join(process.env.HOME ?? '', '.codex')
    await expect(readFile(join(defaultHome, 'auth.json'), 'utf8')).resolves.toContain(
      '"OPENAI_API_KEY": "provider-secret"'
    )
    await expect(readFile(join(defaultHome, 'config.toml'), 'utf8')).resolves.toContain(
      'model = "gpt-5.4"'
    )
    await expect(readFile(join(defaultHome, 'config.toml'), 'utf8')).resolves.toContain(
      'model_provider = "custom"'
    )
    await expect(readFile(join(defaultHome, 'config.toml'), 'utf8')).resolves.toContain(
      'base_url = "https://api.bee1an.us.kg/v1"'
    )
    const backupDir = join(defaultHome, 'config-backups')
    const backupsAfterProvider = await readdir(backupDir)

    const account = (await services.getSnapshot()).accounts[0]
    await services.codex.open(account.id, env.workspacePath)
    const restoredConfig = await readFile(join(defaultHome, 'config.toml'), 'utf8')
    expect(restoredConfig).toBe('')
    await expect(readdir(backupDir)).resolves.toEqual(backupsAfterProvider)
    await expect(readFile(join(defaultHome, 'auth.json'), 'utf8')).resolves.toContain(
      '"account_id": "acct-a"'
    )

    await services.providers.open(providerId!, env.workspacePath)
    await expect(readdir(backupDir)).resolves.toEqual(backupsAfterProvider)
    await services.codex.open(account.id, env.workspacePath)
    await expect(readdir(backupDir)).resolves.toEqual(backupsAfterProvider)
  })

  it('保留 ChatGPT 登录直连自定义 Provider 时把 API Key 写入 config.toml', async () => {
    const env = await createEnvironment()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform: createPlatform()
    })

    await writeGlobalAuth(env.globalAuthPath, createAuthPayload('acct-a', 'a@example.com'))
    await services.accounts.importCurrent()
    await services.settings.update({
      preserveChatGptAuthOnDirectProviderOpen: true
    })

    const created = await services.providers.create({
      name: 'OpenAI',
      baseUrl: 'https://api.bee1an.us.kg/v1',
      apiKey: 'provider-secret',
      model: 'gpt-5.4',
      fastMode: true
    })
    const providerId = created.providers[0]?.id
    expect(providerId).toBeTruthy()

    await services.providers.open(providerId!, env.workspacePath)

    const defaultHome = join(process.env.HOME ?? '', '.codex')
    const auth = await readFile(join(defaultHome, 'auth.json'), 'utf8')
    const config = await readFile(join(defaultHome, 'config.toml'), 'utf8')

    expect(auth).toContain('"auth_mode": "chatgpt"')
    expect(auth).toContain('"OPENAI_API_KEY": null')
    expect(auth).toContain('"account_id": "acct-a"')
    expect(auth).not.toContain('provider-secret')
    expect(config).toContain('model_provider = "OpenAI"')
    expect(config).toContain('[model_providers.OpenAI]')
    expect(config).toContain('name = "OpenAI"')
    expect(config).toContain('requires_openai_auth = true')
    expect(config).toContain('experimental_bearer_token = "provider-secret"')
    expect(config).toContain('base_url = "https://api.bee1an.us.kg/v1"')
  })

  it('opens a normal account by clearing provider config from default config.toml with backup', async () => {
    const env = await createEnvironment()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform: createPlatform()
    })
    const defaultHome = join(process.env.HOME ?? '', '.codex')
    const originalConfig =
      [
        'approval_policy = "never"',
        'model = "external-model"',
        'model_provider = "external_provider"',
        '',
        '[model_providers.external_provider]',
        'name = "External Provider"',
        'wire_api = "responses"',
        'base_url = "https://external.example.com/v1"',
        '',
        '[feature]',
        'fast_mode = true',
        'notify = true'
      ].join('\n') + '\n'

    await writeGlobalAuth(env.globalAuthPath, createAuthPayload('acct-a', 'a@example.com'))
    await writeFile(join(defaultHome, 'config.toml'), originalConfig, 'utf8')
    await services.accounts.importCurrent()

    const account = (await services.getSnapshot()).accounts[0]
    await services.codex.open(account.id, env.workspacePath)

    const nextConfig = await readFile(join(defaultHome, 'config.toml'), 'utf8')
    expect(nextConfig).toContain('approval_policy = "never"')
    expect(nextConfig).toContain('notify = true')
    expect(nextConfig).not.toContain('model =')
    expect(nextConfig).not.toContain('model_provider')
    expect(nextConfig).not.toContain('model_providers')
    expect(nextConfig).not.toContain('fast_mode')

    const backupDir = join(defaultHome, 'config-backups')
    const backupFiles = await readdir(backupDir)
    const configBackup = backupFiles.find((file) => file.startsWith('config.toml-'))
    expect(configBackup).toBeTruthy()
    await expect(readFile(join(backupDir, configBackup!), 'utf8')).resolves.toBe(originalConfig)
  })

  it('opens a custom provider in an isolated instance with provider auth and config', async () => {
    const env = await createEnvironment()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform: createPlatform()
    })

    await writeGlobalAuth(env.globalAuthPath, createAuthPayload('acct-a', 'a@example.com'))
    await writeFile(
      join(process.env.HOME ?? '', '.codex', 'config.toml'),
      'model = "gpt-5"\n',
      'utf8'
    )
    await services.accounts.importCurrent()

    const created = await services.providers.create({
      name: 'Bee',
      baseUrl: 'https://api.bee1an.us.kg/v1',
      apiKey: 'provider-secret',
      model: 'gpt-5.4',
      fastMode: true
    })
    const providerId = created.providers[0]?.id
    expect(providerId).toBeTruthy()

    await services.providers.openIsolated(providerId!, env.workspacePath)

    const isolatedHome = [...mockedProcessState.pidHomes.values()].find(
      (value) => value && value !== join(process.env.HOME ?? '', '.codex')
    )
    expect(isolatedHome).toBeTruthy()

    await expect(readFile(join(isolatedHome!, 'auth.json'), 'utf8')).resolves.toContain(
      '"OPENAI_API_KEY": "provider-secret"'
    )
    await expect(readFile(join(isolatedHome!, 'config.toml'), 'utf8')).resolves.toContain(
      'model = "gpt-5.4"'
    )
    await expect(readFile(join(isolatedHome!, 'config.toml'), 'utf8')).resolves.toContain(
      'model_provider = "custom"'
    )
    await expect(readFile(join(isolatedHome!, 'config.toml'), 'utf8')).resolves.toContain(
      'base_url = "https://api.bee1an.us.kg/v1"'
    )
    expect(mockedProcessState.spawnedCommands.at(-1)).toBe(
      '/Applications/Codex.app/Contents/MacOS/Codex'
    )
  })

  it('opens the local gateway directly in the default Codex home with guarded config writes', async () => {
    const env = await createEnvironment()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform: createPlatform()
    })
    const port = await getFreePort()
    const defaultCodexHome = join(process.env.HOME ?? '', '.codex')

    await mkdir(defaultCodexHome, { recursive: true })
    await writeFile(join(defaultCodexHome, 'config.toml'), 'approval_policy = "never"\n', 'utf8')
    await writeFile(
      join(defaultCodexHome, 'auth.json'),
      `${JSON.stringify({ OPENAI_API_KEY: 'old-secret' }, null, 2)}\n`,
      'utf8'
    )

    await services.settings.update({
      localGateway: {
        host: '127.0.0.1',
        port,
        apiKey: 'gateway-secret-a',
        stickyTtlMinutes: 360,
        requestTimeoutMs: 120_000,
        modelMappings: [],
        allowedGroupIds: ['group-1'],
        allowedAccountIds: [],
        allowedProviderIds: []
      }
    })

    await services.gateway.start()
    try {
      await services.codex.openLocalGateway(env.workspacePath)
      const defaultPid = [...mockedProcessState.runningPids].find(
        (pid) => mockedProcessState.pidHomes.get(pid) === defaultCodexHome
      )
      const config = await readFile(join(defaultCodexHome, 'config.toml'), 'utf8')
      const auth = await readFile(join(defaultCodexHome, 'auth.json'), 'utf8')
      const backups = await readdir(join(defaultCodexHome, 'config-backups'))

      expect(defaultPid).toBeDefined()
      expect(config).toContain('approval_policy = "never"')
      expect(config).toContain('model = "gpt-5.4"')
      expect(config).toContain('model_provider = "custom"')
      expect(config).toContain('[model_providers.custom]')
      expect(config).toContain(`base_url = "http://127.0.0.1:${port}/v1"`)
      expect(auth).toContain('"OPENAI_API_KEY": "gateway-secret-a"')
      expect(backups.some((fileName) => fileName.startsWith('config.toml-'))).toBe(true)
      expect(backups.some((fileName) => fileName.startsWith('auth.json-'))).toBe(true)
      expect(
        [...mockedProcessState.pidHomes.values()].some((value) =>
          value.endsWith('codex-instance-homes/local-gateway')
        )
      ).toBe(false)
    } finally {
      await services.gateway.stop()
    }
  })

  it('保留 ChatGPT 登录直连本地服务时把网关 Key 写入 config.toml', async () => {
    const env = await createEnvironment()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform: createPlatform()
    })
    const port = await getFreePort()
    const defaultCodexHome = join(process.env.HOME ?? '', '.codex')

    await services.settings.update({
      preserveChatGptAuthOnDirectProviderOpen: true,
      localGateway: {
        host: '127.0.0.1',
        port,
        apiKey: 'gateway-secret-a',
        stickyTtlMinutes: 360,
        requestTimeoutMs: 120_000,
        modelMappings: [],
        allowedGroupIds: ['group-1'],
        allowedAccountIds: [],
        allowedProviderIds: []
      }
    })

    await services.gateway.start()
    try {
      await services.codex.openLocalGateway(env.workspacePath)
      const config = await readFile(join(defaultCodexHome, 'config.toml'), 'utf8')
      const auth = await readFile(join(defaultCodexHome, 'auth.json'), 'utf8')

      expect(auth).toContain('"auth_mode": "chatgpt"')
      expect(auth).toContain('"OPENAI_API_KEY": null')
      expect(auth).not.toContain('gateway-secret-a')
      expect(config).toContain('model_provider = "Local Gateway"')
      expect(config).toContain('[model_providers."Local Gateway"]')
      expect(config).toContain('name = "Local Gateway"')
      expect(config).toContain(`base_url = "http://127.0.0.1:${port}/v1"`)
      expect(config).toContain('experimental_bearer_token = "gateway-secret-a"')
    } finally {
      await services.gateway.stop()
    }
  })

  it('opens the local gateway as a single reusable isolated provider instance and refreshes rotated keys', async () => {
    const env = await createEnvironment()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform: createPlatform()
    })
    const port = await getFreePort()

    await services.settings.update({
      localGateway: {
        host: '127.0.0.1',
        port,
        apiKey: 'gateway-secret-a',
        stickyTtlMinutes: 360,
        requestTimeoutMs: 120_000,
        modelMappings: [],
        allowedGroupIds: ['group-1'],
        allowedAccountIds: [],
        allowedProviderIds: []
      }
    })

    await services.gateway.start()
    try {
      await services.codex.openLocalGatewayIsolated(env.workspacePath)
      const localGatewayHome = join(env.userDataPath, 'codex-instance-homes', 'local-gateway')
      const firstPid = [...mockedProcessState.runningPids].find(
        (pid) => mockedProcessState.pidHomes.get(pid) === localGatewayHome
      )

      expect(firstPid).toBeDefined()
      await expect(readFile(join(localGatewayHome, 'auth.json'), 'utf8')).resolves.toContain(
        '"OPENAI_API_KEY": "gateway-secret-a"'
      )
      await expect(readFile(join(localGatewayHome, 'config.toml'), 'utf8')).resolves.toContain(
        `base_url = "http://127.0.0.1:${port}/v1"`
      )

      const rotated = await services.gateway.rotateKey()
      await expect(readFile(join(localGatewayHome, 'auth.json'), 'utf8')).resolves.toContain(
        `"OPENAI_API_KEY": "${rotated.apiKey}"`
      )

      await services.codex.openLocalGatewayIsolated(env.workspacePath)
      const localGatewayHomes = [...mockedProcessState.pidHomes.values()].filter(
        (value) => value === localGatewayHome
      )
      expect(localGatewayHomes).toHaveLength(1)
      expect(mockedProcessState.runningPids.has(firstPid ?? -1)).toBe(false)
    } finally {
      await services.gateway.stop()
    }
  })

  it('普通 instance 启动 Local Gateway 时保留本地网关 base_url 和 API key', async () => {
    const env = await createEnvironment()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform: createPlatform()
    })
    const port = await getFreePort()

    await services.settings.update({
      localGateway: {
        host: '127.0.0.1',
        port,
        apiKey: 'gateway-secret-a',
        stickyTtlMinutes: 360,
        requestTimeoutMs: 120_000,
        modelMappings: [],
        allowedGroupIds: ['group-1'],
        allowedAccountIds: [],
        allowedProviderIds: []
      }
    })

    await services.gateway.start()
    try {
      await services.codex.openLocalGatewayIsolated(env.workspacePath)
      const localGatewayHome = join(env.userDataPath, 'codex-instance-homes', 'local-gateway')
      const localGatewayInstance = (await services.codex.instances.list()).find(
        (instance) => instance.codexHome === localGatewayHome
      )
      expect(localGatewayInstance).toBeTruthy()

      const defaultCodexHome = join(process.env.HOME ?? '', '.codex')
      await mkdir(defaultCodexHome, { recursive: true })
      await writeFile(
        join(defaultCodexHome, 'config.toml'),
        [
          'model = "gpt-5.4"',
          'model_provider = "openai"',
          '',
          '[model_providers.openai]',
          'name = "OpenAI"',
          'wire_api = "responses"',
          'base_url = "https://api.openai.com/v1"'
        ].join('\n') + '\n',
        'utf8'
      )

      await services.codex.instances.start(localGatewayInstance!.id, env.workspacePath)

      const config = await readFile(join(localGatewayHome, 'config.toml'), 'utf8')
      expect(config).toContain('model_provider = "custom"')
      expect(config).toContain('[model_providers.custom]')
      expect(config).toContain(`base_url = "http://127.0.0.1:${port}/v1"`)
      await expect(readFile(join(localGatewayHome, 'auth.json'), 'utf8')).resolves.toContain(
        '"OPENAI_API_KEY": "gateway-secret-a"'
      )
    } finally {
      await services.gateway.stop()
    }
  })

  it('starts the local gateway with account-only routing enabled', async () => {
    const env = await createEnvironment()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform: createPlatform()
    })
    const port = await getFreePort()

    await services.settings.update({
      localGateway: {
        host: '127.0.0.1',
        port,
        apiKey: 'gateway-secret-a',
        stickyTtlMinutes: 360,
        requestTimeoutMs: 120_000,
        modelMappings: [],
        allowedGroupIds: [],
        allowedAccountIds: ['account-1'],
        allowedProviderIds: []
      }
    })

    await expect(services.gateway.start()).resolves.toMatchObject({
      localGatewayStatus: {
        running: true,
        baseUrl: `http://127.0.0.1:${port}`
      }
    })
    await expect(services.getSnapshot()).resolves.toMatchObject({
      settings: {
        localGateway: {
          allowedGroupIds: [],
          allowedAccountIds: ['account-1']
        }
      }
    })
    await services.gateway.stop()

    const reloadedServices = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform: createPlatform()
    })
    await expect(reloadedServices.getSnapshot()).resolves.toMatchObject({
      settings: {
        localGateway: {
          allowedGroupIds: [],
          allowedAccountIds: ['account-1']
        }
      }
    })
  })

  it('routes local gateway traffic through an individually allowed account even when the account belongs to a group', async () => {
    const env = await createEnvironment()
    const platform = createPlatform()
    platform.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const chatgptAccountId = new Headers(init?.headers as HeadersInit).get('chatgpt-account-id')
      return createJsonResponse({ ok: true, accountId: chatgptAccountId })
    })
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform
    })
    const port = await getFreePort()

    let snapshot = await services.accounts.importFromTemplate(
      createTemplateImport({
        accountId: 'acct-a',
        email: 'a@example.com',
        primaryUsedPercent: 10,
        secondaryUsedPercent: 10
      })
    )
    snapshot = await services.groups.create('Team')
    const account = snapshot.accounts.find((item) => item.email === 'a@example.com')
    const group = snapshot.groups[0]
    expect(account).toBeTruthy()
    snapshot = await services.accounts.updateGroups(account!.id, [group.id])

    await services.settings.update({
      localGateway: {
        host: '127.0.0.1',
        port,
        apiKey: 'gateway-secret-a',
        stickyTtlMinutes: 360,
        requestTimeoutMs: 120_000,
        modelMappings: [],
        allowedGroupIds: [],
        allowedAccountIds: [snapshot.accounts[0].id],
        allowedProviderIds: []
      }
    })

    await services.gateway.start()
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer gateway-secret-a',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ model: 'gpt-5.4', messages: [] })
      })
      await response.json()

      expect(response.status).toBe(200)
      expect(platform.fetch).toHaveBeenCalledOnce()
      expect(
        new Headers((platform.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]?.headers).get(
          'chatgpt-account-id'
        )
      ).toBe('acct-a')
    } finally {
      await services.gateway.stop()
    }
  })

  it('rejects model requests when allowed gateway targets are cleared while running', async () => {
    const env = await createEnvironment()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform: createPlatform()
    })
    const port = await getFreePort()

    await services.settings.update({
      localGateway: {
        host: '127.0.0.1',
        port,
        apiKey: 'gateway-secret-a',
        stickyTtlMinutes: 360,
        requestTimeoutMs: 120_000,
        modelMappings: [],
        allowedGroupIds: ['group-1'],
        allowedAccountIds: [],
        allowedProviderIds: []
      }
    })

    await services.gateway.start()
    try {
      await services.settings.update({
        localGateway: {
          host: '127.0.0.1',
          port,
          apiKey: 'gateway-secret-a',
          stickyTtlMinutes: 360,
          requestTimeoutMs: 120_000,
          modelMappings: [],
          allowedGroupIds: [],
          allowedAccountIds: [],
          allowedProviderIds: []
        }
      })

      const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer gateway-secret-a',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ model: 'gpt-5.4', messages: [] })
      })
      const payload = (await response.json()) as { error?: { code?: string; message?: string } }

      expect(response.status).toBe(403)
      expect(payload.error?.code).toBe('no_allowed_target')
      expect(payload.error?.message).toContain('allowed group, account, or provider')
    } finally {
      await services.gateway.stop()
    }
  })

  it('marks local gateway auth failures unhealthy and retries with the next allowed account', async () => {
    const env = await createEnvironment()
    const platform = createPlatform()
    platform.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlText = String(url)
      if (urlText.includes('/oauth/token')) {
        return createJsonResponse({ error: 'invalid_grant' }, 401)
      }
      if (urlText.includes('/codex/responses')) {
        const chatgptAccountId = new Headers(init?.headers as HeadersInit).get('chatgpt-account-id')
        if (chatgptAccountId === 'acct-a') {
          return createJsonResponse(
            { error: { message: 'invalid token', code: 'invalid_token' } },
            401
          )
        }
        return createJsonResponse({ ok: true, accountId: chatgptAccountId })
      }

      throw new Error(`Unexpected fetch: ${urlText}`)
    })
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform
    })
    const port = await getFreePort()

    await services.accounts.importFromTemplate(
      createTemplateImport({
        accountId: 'acct-a',
        email: 'a@example.com',
        primaryUsedPercent: 10,
        secondaryUsedPercent: 10
      })
    )
    let snapshot = await services.accounts.importFromTemplate(
      createTemplateImport({
        accountId: 'acct-b',
        email: 'b@example.com',
        primaryUsedPercent: 60,
        secondaryUsedPercent: 60
      })
    )
    const accountA = snapshot.accounts.find((account) => account.email === 'a@example.com')
    const accountB = snapshot.accounts.find((account) => account.email === 'b@example.com')
    expect(accountA).toBeTruthy()
    expect(accountB).toBeTruthy()

    await services.settings.update({
      localGateway: {
        host: '127.0.0.1',
        port,
        apiKey: 'gateway-secret-a',
        stickyTtlMinutes: 360,
        requestTimeoutMs: 120_000,
        modelMappings: [],
        allowedGroupIds: [],
        allowedAccountIds: [accountA!.id, accountB!.id],
        allowedProviderIds: []
      }
    })

    await services.gateway.start()
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer gateway-secret-a',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ model: 'gpt-5.4', input: 'hello' })
      })
      const payload = (await response.json()) as { accountId?: string }

      expect(response.status).toBe(200)
      expect(payload.accountId).toBe('acct-b')

      const codexAccountIds = vi
        .mocked(platform.fetch)
        .mock.calls.filter(([url]) => String(url).includes('/codex/responses'))
        .map(([, init]) => new Headers(init?.headers as HeadersInit).get('chatgpt-account-id'))
      expect(codexAccountIds).toEqual(['acct-a', 'acct-b'])

      snapshot = await services.getSnapshot()
      expect(snapshot.accountHealthByAccountId[accountA!.id]).toMatchObject({
        status: 'auth_error',
        httpStatus: 401
      })
      expect(snapshot.accountHealthByAccountId[accountB!.id]).toBeUndefined()
    } finally {
      await services.gateway.stop()
    }
  })

  it('evicts unhealthy sticky local gateway accounts until they are manually marked normal', async () => {
    const env = await createEnvironment()
    const platform = createPlatform()
    platform.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlText = String(url)
      if (!urlText.includes('/codex/responses')) {
        throw new Error(`Unexpected fetch: ${urlText}`)
      }

      const chatgptAccountId = new Headers(init?.headers as HeadersInit).get('chatgpt-account-id')
      return createJsonResponse({ ok: true, accountId: chatgptAccountId })
    })
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform
    })
    const port = await getFreePort()

    await services.accounts.importFromTemplate(
      createTemplateImport({
        accountId: 'acct-a',
        email: 'a@example.com',
        primaryUsedPercent: 10,
        secondaryUsedPercent: 10
      })
    )
    const snapshot = await services.accounts.importFromTemplate(
      createTemplateImport({
        accountId: 'acct-b',
        email: 'b@example.com',
        primaryUsedPercent: 60,
        secondaryUsedPercent: 60
      })
    )
    const accountA = snapshot.accounts.find((account) => account.email === 'a@example.com')
    const accountB = snapshot.accounts.find((account) => account.email === 'b@example.com')
    expect(accountA).toBeTruthy()
    expect(accountB).toBeTruthy()

    await services.settings.update({
      localGateway: {
        host: '127.0.0.1',
        port,
        apiKey: 'gateway-secret-a',
        stickyTtlMinutes: 360,
        requestTimeoutMs: 120_000,
        modelMappings: [],
        allowedGroupIds: [],
        allowedAccountIds: [accountA!.id, accountB!.id],
        allowedProviderIds: []
      }
    })

    const requestWithSticky = async (stickySession: string): Promise<string | undefined> => {
      const response = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer gateway-secret-a',
          'content-type': 'application/json',
          'x-sticky-session': stickySession
        },
        body: JSON.stringify({ model: 'gpt-5.4', input: 'hello' })
      })
      const payload = (await response.json()) as { accountId?: string }
      expect(response.status).toBe(200)
      return payload.accountId
    }

    await services.gateway.start()
    try {
      await expect(requestWithSticky('sticky-session')).resolves.toBe('acct-a')

      await services.accounts.updateHealth(accountA!.id, {
        status: 'auth_error',
        reason: 'manual repair required'
      })
      await expect(requestWithSticky('sticky-session')).resolves.toBe('acct-b')

      await services.accounts.updateHealth(accountA!.id, { status: 'normal' })
      await expect(requestWithSticky('fresh-session')).resolves.toBe('acct-a')
    } finally {
      await services.gateway.stop()
    }
  })

  it('lists default and named instances in service results and snapshots', async () => {
    const env = await createEnvironment()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform: createPlatform()
    })

    const created = await services.codex.instances.create({
      name: 'Work',
      bindAccountId: 'acct-a',
      extraArgs: '--approval never'
    })

    const instances = await services.codex.instances.list()
    expect(instances.map((instance) => instance.id)).toEqual(['__default__', created.id])
    expect(instances[1]).toMatchObject({
      name: 'Work',
      bindAccountId: 'acct-a',
      extraArgs: '--approval never'
    })

    const snapshot = await services.getSnapshot()
    expect(snapshot.codexInstances.map((instance) => instance.id)).toEqual([
      '__default__',
      created.id
    ])
  })

  it('checks provider health via /models', async () => {
    const env = await createEnvironment()
    const platform = createPlatform()
    platform.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          data: [{ id: 'gpt-5.4' }, { id: 'gpt-5.4-mini' }]
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        }
      )
    })
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform
    })

    const created = await services.providers.create({
      name: 'Bee',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'provider-secret',
      model: 'gpt-5.4',
      fastMode: true
    })
    const providerId = created.providers[0]?.id
    expect(providerId).toBeTruthy()

    const report = await services.providers.check(providerId!)
    expect(platform.fetch).toHaveBeenCalledWith('https://api.example.com/v1/models', {
      method: 'GET',
      headers: {
        authorization: 'Bearer provider-secret'
      }
    })
    expect(report.ok).toBe(true)
    expect(report.httpStatus).toBe(200)
    expect(report.availableModels).toEqual(['gpt-5.4', 'gpt-5.4-mini'])
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'model',
          status: 'pass'
        })
      ])
    )
  })

  it('probes provider model lists before a provider is saved', async () => {
    const env = await createEnvironment()
    const platform = createPlatform()
    platform.fetch = vi.fn(async () =>
      createJsonResponse({
        data: [{ id: 'gpt-5.4' }, { id: 'gpt-5.4-mini' }]
      })
    )
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform
    })

    const report = await services.providers.probeModels({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'provider-secret'
    })

    expect(platform.fetch).toHaveBeenCalledWith('https://api.example.com/v1/models', {
      method: 'GET',
      headers: {
        authorization: 'Bearer provider-secret'
      }
    })
    expect(report).toMatchObject({
      ok: true,
      httpStatus: 200,
      availableModels: ['gpt-5.4', 'gpt-5.4-mini']
    })
  })

  it('reveals the local gateway API key without exposing it in status', async () => {
    const env = await createEnvironment()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform: createPlatform()
    })

    const apiKey = await services.gateway.getApiKey()
    const status = await services.gateway.status()

    expect(apiKey).toMatch(/^sk-cdock-/)
    expect(status.apiKeyPreview).not.toBe(apiKey)
    expect(status.apiKeyPreview).toContain('…')
  })

  it('persists the latest local gateway logs across service instances', async () => {
    const env = await createEnvironment()
    const platform = createPlatform()
    const gateway = createLocalGatewayForTest(env, platform)
    const writableGateway = gateway as unknown as {
      pushLog(input: Omit<LocalGatewayLogEntry, 'id' | 'timestamp'>): Promise<void>
    }

    for (let index = 0; index < 85; index += 1) {
      await writableGateway.pushLog({
        method: 'GET',
        path: `/v1/models/${index}`,
        status: 200,
        durationMs: index,
        model: `model-${index}`
      })
    }

    const reloaded = createLocalGatewayForTest(env, platform)
    const logs = (await reloaded.status()).logs ?? []

    expect(logs).toHaveLength(80)
    expect(logs[0]).toMatchObject({
      method: 'GET',
      path: '/v1/models/84',
      model: 'model-84'
    })
    expect(logs.at(-1)?.path).toBe('/v1/models/5')
  })

  it('protects and routes local gateway /codex/open requests', async () => {
    const env = await createEnvironment()
    const platform = createPlatform()
    const port = await getFreePort()
    const openCodexFromService = vi.fn(async (input?: OpenCodexFromServiceInput) => ({
      ok: true as const,
      pid: 4567,
      codexHome: join(env.userDataPath, 'codex-instance-homes', 'service-launch-account-abcd1234'),
      workspacePath:
        typeof input?.workspacePath === 'string' ? input.workspacePath : env.workspacePath,
      multi: input?.multi === true,
      target: {
        type: input?.target ?? ('default' as const),
        id: input?.accountId,
        name: 'Gateway Account'
      }
    }))
    const gateway = createLocalGatewayForTest(env, platform, openCodexFromService)
    const writableGateway = gateway as unknown as {
      options: { store: CodexAccountStore }
    }
    await writableGateway.options.store.updateSettings({
      localGateway: {
        host: '127.0.0.1',
        port,
        apiKey: 'test-gateway-key',
        stickyTtlMinutes: 360,
        requestTimeoutMs: 120_000,
        modelMappings: [],
        allowedGroupIds: ['all'],
        allowedAccountIds: [],
        allowedProviderIds: []
      }
    })

    await gateway.start()
    try {
      const baseUrl = `http://127.0.0.1:${port}`
      const unauthorized = await fetch(`${baseUrl}/codex/open`, {
        method: 'POST',
        body: '{}'
      })
      expect(unauthorized.status).toBe(401)
      await unauthorized.text()
      const unauthorizedLog = (await gateway.status()).logs?.find((log) => log.status === 401)
      expect(unauthorizedLog).toMatchObject({
        status: 401,
        message: 'Unauthorized local gateway request. (unauthorized)'
      })

      const wrongMethod = await fetch(`${baseUrl}/codex/open`, {
        method: 'GET',
        headers: {
          authorization: 'Bearer test-gateway-key'
        }
      })
      expect(wrongMethod.status).toBe(405)

      const authorized = await fetch(`${baseUrl}/codex/open`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer test-gateway-key',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          target: 'account',
          accountId: 'acct-a',
          multi: true,
          workspacePath: env.workspacePath
        })
      })
      const payload = (await authorized.json()) as {
        ok?: boolean
        pid?: number
        codexHome?: string
        target?: { type?: string; id?: string }
      }

      expect(authorized.status).toBe(200)
      expect(payload).toMatchObject({
        ok: true,
        pid: 4567,
        target: {
          type: 'account',
          id: 'acct-a'
        }
      })
      expect(openCodexFromService).toHaveBeenCalledTimes(1)
      expect(openCodexFromService).toHaveBeenCalledWith({
        target: 'account',
        accountId: 'acct-a',
        multi: true,
        workspacePath: env.workspacePath
      })
    } finally {
      await gateway.stop()
    }
  })

  it('routes requests directly to provider in provider routing mode', async () => {
    const env = await createEnvironment()
    const platform = createPlatform()
    const port = await getFreePort()
    const gateway = createLocalGatewayForTest(env, platform)
    const writableGateway = gateway as unknown as {
      options: { store: CodexAccountStore; providerStore: CodexProviderStore }
    }

    await writableGateway.options.providerStore.create({
      name: 'Test Provider',
      baseUrl: 'https://api.test-provider.local',
      apiKey: 'provider-key-123',
      protocol: 'openai',
      model: 'gpt-5.4'
    })
    const providers = await writableGateway.options.providerStore.list()
    const providerId = providers[0].id

    await writableGateway.options.store.updateSettings({
      localGateway: {
        host: '127.0.0.1',
        port,
        apiKey: 'test-gateway-key',
        stickyTtlMinutes: 360,
        requestTimeoutMs: 120_000,
        modelMappings: [],
        allowedGroupIds: [],
        allowedAccountIds: [],
        allowedProviderIds: [providerId]
      }
    })

    const mockUpstream = new Response(JSON.stringify({ choices: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
    ;(platform.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockUpstream)

    await gateway.start()
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer test-gateway-key',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ model: 'gpt-5.4', messages: [{ role: 'user', content: 'hi' }] })
      })

      expect(response.status).toBe(200)
      expect(platform.fetch).toHaveBeenCalledTimes(1)
      const fetchCall = (platform.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(fetchCall[0]).toContain('api.test-provider.local')
    } finally {
      await gateway.stop()
    }
  })

  it('does not fall back to unallowed providers when Codex returns rate limit', async () => {
    const env = await createEnvironment()
    const platform = createPlatform()
    platform.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlText = String(url)
      if (urlText.includes('/codex/responses')) {
        return createJsonResponse({ error: { code: 'rate_limit_exceeded' } }, 429)
      }

      throw new Error(`Unexpected provider fallback: ${urlText}`)
    })
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform
    })
    const port = await getFreePort()

    const snapshot = await services.accounts.importFromTemplate(
      createTemplateImport({
        accountId: 'acct-a',
        email: 'a@example.com',
        primaryUsedPercent: 10,
        secondaryUsedPercent: 10
      })
    )
    const account = snapshot.accounts[0]

    await services.providers.create({
      name: 'Unallowed Provider',
      baseUrl: 'https://api.unallowed-provider.local/v1',
      apiKey: 'provider-key-123',
      protocol: 'openai',
      model: 'gpt-5.4'
    })

    await services.settings.update({
      localGateway: {
        host: '127.0.0.1',
        port,
        apiKey: 'test-gateway-key',
        stickyTtlMinutes: 360,
        requestTimeoutMs: 120_000,
        modelMappings: [],
        allowedGroupIds: [],
        allowedAccountIds: [account.id],
        allowedProviderIds: []
      }
    })

    await services.gateway.start()
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer test-gateway-key',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ model: 'gpt-5.4', input: 'hi' })
      })
      const payload = (await response.json()) as { error?: { code?: string } }

      expect(response.status).toBe(429)
      expect(payload.error?.code).toBe('rate_limit_exceeded')
      expect(platform.fetch).toHaveBeenCalledTimes(1)
      expect(String((platform.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0])).toContain(
        '/codex/responses'
      )
    } finally {
      await services.gateway.stop()
    }
  })

  it('filters OpenAI model list to allowed OpenAI providers', async () => {
    const env = await createEnvironment()
    const platform = createPlatform()
    const port = await getFreePort()
    const gateway = createLocalGatewayForTest(env, platform)
    const writableGateway = gateway as unknown as {
      options: { store: CodexAccountStore; providerStore: CodexProviderStore }
    }

    const allowedProvider = await writableGateway.options.providerStore.create({
      name: 'Allowed Provider',
      baseUrl: 'https://api.allowed-provider.local/v1',
      apiKey: 'allowed-key',
      protocol: 'openai',
      model: 'allowed-openai-model'
    })
    await writableGateway.options.providerStore.create({
      name: 'Blocked Provider',
      baseUrl: 'https://api.blocked-provider.local/v1',
      apiKey: 'blocked-key',
      protocol: 'openai',
      model: 'blocked-openai-model'
    })

    await writableGateway.options.store.updateSettings({
      localGateway: {
        host: '127.0.0.1',
        port,
        apiKey: 'test-gateway-key',
        stickyTtlMinutes: 360,
        requestTimeoutMs: 120_000,
        modelMappings: [],
        allowedGroupIds: [],
        allowedAccountIds: [],
        allowedProviderIds: [allowedProvider.id]
      }
    })

    await gateway.start()
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/models`, {
        headers: {
          authorization: 'Bearer test-gateway-key'
        }
      })
      const payload = (await response.json()) as { data?: Array<{ id?: string }> }
      const ids = payload.data?.map((model) => model.id) ?? []

      expect(response.status).toBe(200)
      expect(ids).toEqual(['allowed-openai-model'])

      await writableGateway.options.store.updateSettings({
        localGateway: {
          host: '127.0.0.1',
          port,
          apiKey: 'test-gateway-key',
          stickyTtlMinutes: 360,
          requestTimeoutMs: 120_000,
          modelMappings: [],
          allowedGroupIds: ['empty-group'],
          allowedAccountIds: [],
          allowedProviderIds: []
        }
      })

      const emptyResponse = await fetch(`http://127.0.0.1:${port}/v1/models`, {
        headers: {
          authorization: 'Bearer test-gateway-key'
        }
      })
      const emptyPayload = (await emptyResponse.json()) as { data?: Array<{ id?: string }> }

      expect(emptyResponse.status).toBe(200)
      expect(emptyPayload.data?.map((model) => model.id) ?? []).toEqual([])
    } finally {
      await gateway.stop()
    }
  })

  it('keeps OpenAI providers out of Gemini model list', async () => {
    const env = await createEnvironment()
    const platform = createPlatform()
    const port = await getFreePort()
    const gateway = createLocalGatewayForTest(env, platform)
    const writableGateway = gateway as unknown as {
      options: { store: CodexAccountStore; providerStore: CodexProviderStore }
    }

    const openAiProvider = await writableGateway.options.providerStore.create({
      name: 'OpenAI Provider',
      baseUrl: 'https://api.openai-provider.local/v1',
      apiKey: 'openai-key',
      protocol: 'openai',
      model: 'openai-only-model'
    })

    await writableGateway.options.store.updateSettings({
      localGateway: {
        host: '127.0.0.1',
        port,
        apiKey: 'test-gateway-key',
        stickyTtlMinutes: 360,
        requestTimeoutMs: 120_000,
        modelMappings: [],
        allowedGroupIds: [],
        allowedAccountIds: [],
        allowedProviderIds: [openAiProvider.id]
      }
    })

    await gateway.start()
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1beta/models`, {
        headers: {
          authorization: 'Bearer test-gateway-key'
        }
      })
      const payload = (await response.json()) as { models?: Array<{ name?: string }> }

      expect(response.status).toBe(200)
      expect(payload.models?.map((model) => model.name) ?? []).toEqual([])

      await writableGateway.options.store.updateSettings({
        localGateway: {
          host: '127.0.0.1',
          port,
          apiKey: 'test-gateway-key',
          stickyTtlMinutes: 360,
          requestTimeoutMs: 120_000,
          modelMappings: [],
          allowedGroupIds: ['empty-group'],
          allowedAccountIds: [],
          allowedProviderIds: []
        }
      })

      const emptyResponse = await fetch(`http://127.0.0.1:${port}/v1beta/models`, {
        headers: {
          authorization: 'Bearer test-gateway-key'
        }
      })
      const emptyPayload = (await emptyResponse.json()) as { models?: Array<{ name?: string }> }

      expect(emptyResponse.status).toBe(200)
      expect(emptyPayload.models?.map((model) => model.name) ?? []).toEqual([])
    } finally {
      await gateway.stop()
    }
  })

  it('rejects start when no targets configured', async () => {
    const env = await createEnvironment()
    const platform = createPlatform()
    const port = await getFreePort()
    const gateway = createLocalGatewayForTest(env, platform)
    const writableGateway = gateway as unknown as {
      options: { store: CodexAccountStore }
    }

    await writableGateway.options.store.updateSettings({
      localGateway: {
        host: '127.0.0.1',
        port,
        apiKey: 'test-gateway-key',
        stickyTtlMinutes: 360,
        requestTimeoutMs: 120_000,
        modelMappings: [],
        allowedGroupIds: [],
        allowedAccountIds: [],
        allowedProviderIds: []
      }
    })

    await expect(gateway.start()).rejects.toThrow(
      'Local gateway requires at least one allowed group, account, or provider before it can start.'
    )
  })

  it('returns 503 when selected provider is deleted', async () => {
    const env = await createEnvironment()
    const platform = createPlatform()
    const port = await getFreePort()
    const gateway = createLocalGatewayForTest(env, platform)
    const writableGateway = gateway as unknown as {
      options: { store: CodexAccountStore; providerStore: CodexProviderStore }
    }

    await writableGateway.options.providerStore.create({
      name: 'Ephemeral Provider',
      baseUrl: 'https://api.ephemeral.local',
      apiKey: 'eph-key',
      protocol: 'openai',
      model: 'gpt-5.4'
    })
    const providers = await writableGateway.options.providerStore.list()
    const providerId = providers[0].id

    await writableGateway.options.store.updateSettings({
      localGateway: {
        host: '127.0.0.1',
        port,
        apiKey: 'test-gateway-key',
        stickyTtlMinutes: 360,
        requestTimeoutMs: 120_000,
        modelMappings: [],
        allowedGroupIds: [],
        allowedAccountIds: [],
        allowedProviderIds: [providerId]
      }
    })

    await writableGateway.options.providerStore.remove(providerId)

    await gateway.start()
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer test-gateway-key',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ model: 'gpt-5.4', messages: [] })
      })
      const payload = (await response.json()) as { error?: { code?: string } }

      expect(response.status).toBe(503)
      expect(payload.error?.code).toBe('no_provider')
      expect(platform.fetch).not.toHaveBeenCalled()
    } finally {
      await gateway.stop()
    }
  })

  it('runs doctor checks for current session and desktop resolution', async () => {
    const env = await createEnvironment()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform: createPlatform()
    })

    await services.settings.update({
      codexDesktopExecutablePath: '/usr/local/bin/codex'
    })
    await writeGlobalAuth(env.globalAuthPath, createAuthPayload('acct-a', 'a@example.com'))
    await services.accounts.importCurrent()

    const report = await services.doctor.run()
    expect(report.ok).toBe(true)
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'codex-desktop',
          status: 'pass'
        }),
        expect.objectContaining({
          id: 'current-session',
          status: 'pass'
        })
      ])
    )
  })

  it('restarts only the default instance when codex.open(accountId) is called', async () => {
    const env = await createEnvironment()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform: createPlatform()
    })

    await writeGlobalAuth(env.globalAuthPath, createAuthPayload('acct-a', 'a@example.com'))
    await services.accounts.importCurrent()
    const snapshot = await services.getSnapshot()
    const accountA = snapshot.accounts[0]

    await services.codex.openIsolated(accountA.id, env.workspacePath)
    const isolatedPid = [...mockedProcessState.runningPids].find(
      (pid) => mockedProcessState.pidHomes.get(pid) !== join(process.env.HOME ?? '', '.codex')
    )
    expect(isolatedPid).toBeDefined()

    await services.codex.open(accountA.id, env.workspacePath)
    const defaultPid = [...mockedProcessState.runningPids].find(
      (pid) => mockedProcessState.pidHomes.get(pid) === join(process.env.HOME ?? '', '.codex')
    )
    expect(defaultPid).toBeDefined()

    processKillSpy.mockClear()
    await services.codex.open(accountA.id, env.workspacePath)

    const terminationCalls = processKillSpy.mock.calls
      .filter(([, signal]) => signal && signal !== 0)
      .map(([pid]) => pid)

    expect(terminationCalls).toContain(defaultPid)
    expect(terminationCalls).not.toContain(isolatedPid)
    expect(mockedProcessState.runningPids.has(isolatedPid ?? -1)).toBe(true)
  })

  it('opens account targets from the local service in multi mode without stopping existing instances', async () => {
    const env = await createEnvironment()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform: createPlatform()
    })

    await writeGlobalAuth(env.globalAuthPath, createAuthPayload('acct-a', 'a@example.com'))
    await services.accounts.importCurrent()
    const account = (await services.getSnapshot()).accounts[0]

    await services.codex.openIsolated(account.id, env.workspacePath)
    const existingPid = [...mockedProcessState.runningPids].find((pid) =>
      mockedProcessState.pidHomes.get(pid)?.includes('account-')
    )
    expect(existingPid).toBeDefined()

    processKillSpy.mockClear()
    const result = await services.codex.openFromService({
      target: 'account',
      accountId: account.id,
      multi: true,
      workspacePath: env.workspacePath
    })
    const terminationCalls = processKillSpy.mock.calls.filter(
      ([, signal]) => signal && signal !== 0
    )
    const instanceRoot = join(env.userDataPath, 'codex-instance-homes')
    const serviceLaunchPrefix = join(instanceRoot, 'service-launch-account-')
    const serviceAuth = JSON.parse(await readFile(join(result.codexHome, 'auth.json'), 'utf8')) as {
      tokens?: { account_id?: string }
    }

    expect(terminationCalls).toHaveLength(0)
    expect(mockedProcessState.runningPids.has(existingPid ?? -1)).toBe(true)
    expect(result).toMatchObject({
      ok: true,
      pid: expect.any(Number),
      workspacePath: env.workspacePath,
      multi: true,
      target: {
        type: 'account',
        id: account.id
      }
    })
    expect(result.pid).not.toBe(existingPid)
    expect(result.codexHome.startsWith(serviceLaunchPrefix)).toBe(true)
    expect(serviceAuth.tokens?.account_id).toBe('acct-a')
  })

  it('clears stale usage after an expired usage refresh fails', async () => {
    const env = await createEnvironment()
    const platform = createPlatform()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform
    })

    const baseAuth = createAuthPayload('acct-a', 'a@example.com')
    const { refresh_token: refreshToken, ...tokensWithoutRefresh } = baseAuth.tokens
    void refreshToken
    const expiredAuth = {
      ...baseAuth,
      tokens: tokensWithoutRefresh
    }

    await writeGlobalAuth(env.globalAuthPath, expiredAuth)
    await services.accounts.importCurrent()
    const snapshot = await services.getSnapshot()
    const account = snapshot.accounts[0]
    const statePath = join(env.userDataPath, 'codex-accounts.json')
    const staleUsage = {
      limitId: 'codex',
      limitName: null,
      planType: 'plus',
      primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1_800_000_000 },
      secondary: { usedPercent: 34, windowDurationMins: 10_080, resetsAt: 1_800_000_000 },
      credits: null,
      limits: [],
      fetchedAt: '2026-03-19T00:00:00.000Z'
    }

    const persistedState = JSON.parse(await readFile(statePath, 'utf8')) as {
      usageByAccountId: Record<string, unknown>
    }
    persistedState.usageByAccountId = {
      ...persistedState.usageByAccountId,
      [account.id]: staleUsage
    }
    await writeFile(statePath, `${JSON.stringify(persistedState, null, 2)}\n`, 'utf8')
    ;(platform.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('unauthorized', {
        status: 401,
        headers: {
          'content-type': 'text/plain'
        }
      })
    )

    await expect(services.usage.read(account.id)).rejects.toThrow('unauthorized')

    const nextSnapshot = await services.getSnapshot()
    expect(nextSnapshot.usageByAccountId[account.id]).toBeUndefined()
  })

  it('exports accounts with the minimal aligned template schema', async () => {
    const env = await createEnvironment()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform: createPlatform()
    })

    await writeGlobalAuth(env.globalAuthPath, createAuthPayload('acct-a', 'a@example.com'))
    await services.accounts.importCurrent()

    const statePath = join(env.userDataPath, 'codex-accounts.json')
    const persistedState = JSON.parse(await readFile(statePath, 'utf8')) as {
      accounts: Array<{ id: string }>
      usageByAccountId: Record<string, unknown>
    }
    const accountId = persistedState.accounts[0]?.id
    expect(accountId).toBeTruthy()
    persistedState.usageByAccountId = {
      ...persistedState.usageByAccountId,
      [accountId!]: {
        limitId: 'codex',
        limitName: null,
        planType: 'plus',
        primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1_800_000_000 },
        secondary: { usedPercent: 34, windowDurationMins: 10_080, resetsAt: 1_800_500_000 },
        credits: null,
        limits: [],
        fetchedAt: '2026-03-19T00:00:00.000Z'
      }
    }
    await writeFile(statePath, `${JSON.stringify(persistedState, null, 2)}\n`, 'utf8')

    const exported = JSON.parse(await services.accounts.exportToTemplate()) as {
      exported_at: string
      accounts: Array<Record<string, unknown>>
      proxies?: unknown
    }

    expect(typeof exported.exported_at).toBe('string')
    expect(exported.proxies).toEqual([])
    expect(exported.accounts).toHaveLength(1)
    expect(exported.accounts[0]).toEqual({
      name: 'a@example.com',
      notes: '',
      platform: 'openai',
      type: 'oauth',
      credentials: {
        _token_version: 1,
        access_token: expect.any(String),
        refresh_token: 'refresh-acct-a',
        id_token: expect.any(String),
        chatgpt_account_id: 'acct-a',
        client_id: 'app_EMoamEEZ73f0CkXaXp7hrann',
        email: 'a@example.com',
        expires_at: expect.any(String),
        expires_in: expect.any(Number),
        plan_type: 'plus',
        scope: null,
        token_type: null
      },
      extra: {
        codex_5h_reset_after_seconds: expect.any(Number),
        codex_5h_reset_at: '2027-01-15T08:00:00.000Z',
        codex_5h_used_percent: 12,
        codex_5h_window_minutes: 300,
        codex_7d_reset_after_seconds: expect.any(Number),
        codex_7d_reset_at: '2027-01-21T02:53:20.000Z',
        codex_7d_used_percent: 34,
        codex_7d_window_minutes: 10080,
        codex_primary_over_secondary_percent: -22,
        codex_primary_reset_after_seconds: expect.any(Number),
        codex_primary_reset_at: '2027-01-15T08:00:00.000Z',
        codex_primary_used_percent: 12,
        codex_primary_window_minutes: 300,
        codex_secondary_reset_after_seconds: expect.any(Number),
        codex_secondary_reset_at: '2027-01-21T02:53:20.000Z',
        codex_secondary_used_percent: 34,
        codex_secondary_window_minutes: 10080,
        codex_usage_updated_at: '2026-03-19T00:00:00.000Z',
        email: 'a@example.com',
        privacy_mode: 'training_off'
      },
      concurrency: 10,
      priority: 1,
      rate_multiplier: 1,
      auto_pause_on_expired: false
    })
  })

  it('exports only the selected accounts', async () => {
    const env = await createEnvironment()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform: createPlatform()
    })

    await writeGlobalAuth(env.globalAuthPath, createAuthPayload('acct-a', 'a@example.com'))
    await services.accounts.importCurrent()
    await writeGlobalAuth(env.globalAuthPath, createAuthPayload('acct-b', 'b@example.com'))
    await services.accounts.importCurrent()

    const snapshot = await services.getSnapshot()
    const accountA = snapshot.accounts.find((account) => account.email === 'a@example.com')
    expect(accountA).toBeTruthy()

    const exported = JSON.parse(await services.accounts.exportToTemplate([accountA!.id])) as {
      accounts: Array<{
        credentials: {
          chatgpt_account_id: string
        }
      }>
    }

    expect(exported.accounts).toHaveLength(1)
    expect(exported.accounts[0]?.credentials.chatgpt_account_id).toBe('acct-a')
  })

  it('exports cockpit tools compatible payloads', async () => {
    const env = await createEnvironment()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform: createPlatform()
    })

    await writeGlobalAuth(env.globalAuthPath, createAuthPayload('acct-a', 'a@example.com'))
    await services.accounts.importCurrent()

    const exported = JSON.parse(
      await services.accounts.exportToTemplate(undefined, 'cockpit_tools')
    ) as Array<Record<string, unknown>>

    expect(exported).toHaveLength(1)
    expect(exported[0]).toMatchObject({
      id: expect.any(String),
      email: 'a@example.com',
      account_id: 'acct-a',
      account_name: 'a@example.com',
      tokens: {
        id_token: expect.any(String),
        access_token: expect.any(String),
        refresh_token: 'refresh-acct-a'
      },
      created_at: expect.any(Number),
      last_used: expect.any(Number)
    })
  })

  it('exports sub2api compatible payloads', async () => {
    const env = await createEnvironment()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform: createPlatform()
    })

    await writeGlobalAuth(env.globalAuthPath, createAuthPayload('acct-a', 'a@example.com'))
    await services.accounts.importCurrent()

    const exported = JSON.parse(await services.accounts.exportToTemplate(undefined, 'sub2api')) as {
      type: string
      version: number
      accounts: Array<{
        name: string
        platform: string
        type: string
        credentials: Record<string, unknown>
      }>
    }

    expect(exported.type).toBe('sub2api-data')
    expect(exported.version).toBe(1)
    expect(exported.accounts).toHaveLength(1)
    expect(exported.accounts[0]).toMatchObject({
      name: 'a@example.com',
      platform: 'openai',
      type: 'oauth'
    })
    expect(exported.accounts[0]?.credentials).toMatchObject({
      access_token: expect.any(String),
      refresh_token: 'refresh-acct-a',
      id_token: expect.any(String),
      email: 'a@example.com',
      chatgpt_account_id: 'acct-a'
    })
  })

  it('exports cliproxyapi compatible payloads', async () => {
    const env = await createEnvironment()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform: createPlatform()
    })

    await writeGlobalAuth(env.globalAuthPath, createAuthPayload('acct-a', 'a@example.com'))
    await services.accounts.importCurrent()

    const exported = JSON.parse(
      await services.accounts.exportToTemplate(undefined, 'cliproxyapi')
    ) as Record<string, unknown>

    expect(exported).toMatchObject({
      id_token: expect.any(String),
      access_token: expect.any(String),
      refresh_token: 'refresh-acct-a',
      account_id: 'acct-a',
      email: 'a@example.com',
      type: 'codex',
      last_refresh: expect.any(String),
      expired: expect.any(String)
    })
  })

  it('imports the reference template schema and rejects missing credentials fields', async () => {
    const env = await createEnvironment()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform: createPlatform()
    })

    await services.accounts.importFromTemplate(
      JSON.stringify({
        exported_at: '2026-03-24T08:00:00.000Z',
        proxies: [],
        accounts: [
          {
            name: 'b@example.com',
            notes: '',
            platform: 'openai',
            type: 'oauth',
            credentials: {
              _token_version: 1,
              access_token: createJwt({
                exp: Math.floor(Date.now() / 1000) + 3600,
                'https://api.openai.com/auth': {
                  chatgpt_account_id: 'acct-b'
                }
              }),
              refresh_token: 'refresh-acct-b',
              id_token: createJwt({
                email: 'b@example.com',
                name: 'b',
                'https://api.openai.com/auth': {
                  chatgpt_account_id: 'acct-b'
                }
              }),
              chatgpt_account_id: 'acct-b',
              client_id: 'app_EMoamEEZ73f0CkXaXp7hrann',
              email: 'b@example.com',
              expires_at: '2026-03-24T09:00:00.000Z',
              expires_in: 3600,
              plan_type: 'pro',
              scope: null,
              token_type: null
            },
            extra: {
              codex_5h_reset_after_seconds: 7200,
              codex_5h_reset_at: '2026-03-24T10:00:00.000Z',
              codex_5h_used_percent: 20,
              codex_5h_window_minutes: 300,
              codex_7d_reset_after_seconds: 604800,
              codex_7d_reset_at: '2026-03-31T08:00:00.000Z',
              codex_7d_used_percent: 40,
              codex_7d_window_minutes: 10080,
              codex_primary_over_secondary_percent: -20,
              codex_primary_reset_after_seconds: 7200,
              codex_primary_reset_at: '2026-03-24T10:00:00.000Z',
              codex_primary_used_percent: 20,
              codex_primary_window_minutes: 300,
              codex_secondary_reset_after_seconds: 604800,
              codex_secondary_reset_at: '2026-03-31T08:00:00.000Z',
              codex_secondary_used_percent: 40,
              codex_secondary_window_minutes: 10080,
              codex_usage_updated_at: '2026-03-24T08:00:00.000Z',
              email: 'b@example.com',
              privacy_mode: 'training_off'
            },
            concurrency: 10,
            priority: 1,
            rate_multiplier: 1,
            auto_pause_on_expired: false
          }
        ]
      })
    )

    const snapshot = await services.getSnapshot()
    expect(snapshot.accounts[0]?.email).toBe('b@example.com')
    expect(snapshot.usageByAccountId[snapshot.accounts[0]!.id]).toMatchObject({
      planType: 'pro',
      primary: {
        usedPercent: 20,
        windowDurationMins: 300
      },
      secondary: {
        usedPercent: 40,
        windowDurationMins: 10080
      }
    })

    await expect(
      services.accounts.importFromTemplate(
        JSON.stringify({
          exported_at: '2026-03-24T08:00:00.000Z',
          proxies: [],
          accounts: [{}]
        })
      )
    ).rejects.toThrow('missing required field: credentials')
  })

  it('imports grouped templates when id_token is absent by deriving identity from access_token', async () => {
    const env = await createEnvironment()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform: createPlatform()
    })

    const accessToken = createJwt({
      exp: Math.floor(Date.now() / 1000) + 3600,
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'acct-no-id-token',
        chatgpt_plan_type: 'plus'
      },
      'https://api.openai.com/profile': {
        email: 'no-id-token@example.com'
      }
    })

    await services.accounts.importFromTemplate(
      JSON.stringify({
        exported_at: '2026-03-24T08:00:00.000Z',
        proxies: [],
        accounts: [
          {
            name: 'no-id-token@example.com',
            platform: 'openai',
            type: 'oauth',
            credentials: {
              access_token: accessToken,
              refresh_token: 'refresh-no-id-token',
              chatgpt_account_id: 'acct-no-id-token',
              email: 'no-id-token@example.com',
              plan_type: 'plus'
            }
          }
        ]
      })
    )

    const snapshot = await services.getSnapshot()
    expect(snapshot.accounts).toHaveLength(1)
    expect(snapshot.accounts[0]?.email).toBe('no-id-token@example.com')
    expect(snapshot.accounts[0]?.accountId).toBe('acct-no-id-token')
  })

  it('imports cockpit tools compatible payloads', async () => {
    const env = await createEnvironment()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform: createPlatform()
    })

    await services.accounts.importFromTemplate(
      JSON.stringify([
        {
          id: 'acct-cockpit',
          email: 'cockpit@example.com',
          account_id: 'acct-cockpit',
          user_id: 'user-cockpit',
          organization_id: 'org-cockpit',
          plan_type: 'team',
          account_name: 'Cockpit Account',
          tokens: {
            id_token: createJwt({
              sub: 'user-cockpit',
              email: 'cockpit@example.com',
              name: 'cockpit',
              'https://api.openai.com/auth': {
                chatgpt_account_id: 'acct-cockpit',
                chatgpt_user_id: 'user-cockpit',
                organization_id: 'org-cockpit',
                chatgpt_plan_type: 'team'
              }
            }),
            access_token: createJwt({
              exp: Math.floor(Date.now() / 1000) + 3600,
              'https://api.openai.com/auth': {
                chatgpt_account_id: 'acct-cockpit',
                chatgpt_user_id: 'user-cockpit',
                organization_id: 'org-cockpit',
                chatgpt_plan_type: 'team'
              }
            }),
            refresh_token: 'refresh-cockpit'
          },
          quota: {
            hourly_percentage: 11,
            hourly_reset_time: 1_800_000_100,
            hourly_window_minutes: 300,
            hourly_window_present: true,
            weekly_percentage: 27,
            weekly_reset_time: 1_800_500_200,
            weekly_window_minutes: 10080,
            weekly_window_present: true
          }
        }
      ])
    )

    const snapshot = await services.getSnapshot()
    expect(snapshot.accounts[0]?.email).toBe('cockpit@example.com')
    expect(snapshot.usageByAccountId[snapshot.accounts[0]!.id]).toMatchObject({
      planType: 'team',
      primary: {
        usedPercent: 11,
        windowDurationMins: 300,
        resetsAt: 1_800_000_100
      },
      secondary: {
        usedPercent: 27,
        windowDurationMins: 10080,
        resetsAt: 1_800_500_200
      }
    })
  })

  it('imports sub2api compatible payloads', async () => {
    const env = await createEnvironment()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform: createPlatform()
    })

    await services.accounts.importFromTemplate(
      JSON.stringify({
        type: 'sub2api-data',
        version: 1,
        exported_at: '2026-03-24T08:00:00Z',
        proxies: [],
        accounts: [
          {
            name: 'sub2api@example.com',
            platform: 'openai',
            type: 'oauth',
            credentials: {
              access_token: createJwt({
                exp: Math.floor(Date.now() / 1000) + 3600,
                'https://api.openai.com/auth': {
                  chatgpt_account_id: 'acct-sub2api',
                  chatgpt_user_id: 'user-sub2api',
                  organization_id: 'org-sub2api',
                  chatgpt_plan_type: 'pro'
                }
              }),
              refresh_token: 'refresh-sub2api',
              id_token: createJwt({
                sub: 'user-sub2api',
                email: 'sub2api@example.com',
                name: 'sub2api',
                'https://api.openai.com/auth': {
                  chatgpt_account_id: 'acct-sub2api',
                  chatgpt_user_id: 'user-sub2api',
                  organization_id: 'org-sub2api',
                  chatgpt_plan_type: 'pro'
                }
              }),
              email: 'sub2api@example.com',
              plan_type: 'pro',
              subscription_expires_at: '2026-05-15T04:28:55.000Z'
            },
            concurrency: 0,
            priority: 0
          }
        ]
      })
    )

    const snapshot = await services.getSnapshot()
    expect(snapshot.accounts[0]).toMatchObject({
      email: 'sub2api@example.com',
      accountId: 'acct-sub2api',
      subscriptionExpiresAt: '2026-05-15T04:28:55.000Z'
    })
  })

  it('imports cliproxyapi compatible payloads', async () => {
    const env = await createEnvironment()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform: createPlatform()
    })

    await services.accounts.importFromTemplate(
      JSON.stringify({
        id_token: createJwt({
          sub: 'user-cpa',
          email: 'cliproxy@example.com',
          name: 'cliproxy',
          'https://api.openai.com/auth': {
            chatgpt_account_id: 'acct-cpa',
            chatgpt_user_id: 'user-cpa',
            organization_id: 'org-cpa',
            chatgpt_plan_type: 'plus'
          }
        }),
        access_token: createJwt({
          exp: Math.floor(Date.now() / 1000) + 3600,
          'https://api.openai.com/auth': {
            chatgpt_account_id: 'acct-cpa',
            chatgpt_user_id: 'user-cpa',
            organization_id: 'org-cpa',
            chatgpt_plan_type: 'plus'
          }
        }),
        refresh_token: 'refresh-cpa',
        account_id: 'acct-cpa',
        last_refresh: '2026-03-24T08:00:00Z',
        email: 'cliproxy@example.com',
        type: 'codex',
        expired: '2026-03-24T09:00:00Z'
      })
    )

    const snapshot = await services.getSnapshot()
    expect(snapshot.accounts[0]).toMatchObject({
      email: 'cliproxy@example.com',
      accountId: 'acct-cpa'
    })
  })

  it('skips remote refresh and wake requests for seeded local mock accounts', async () => {
    const env = await createEnvironment()
    const platform = createPlatform()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform
    })

    await services.accounts.importFromTemplate(
      createTemplateImport({
        accountId: 'acct-local-plus-1',
        email: 'local-plus-1@mock.local',
        planType: 'plus'
      })
    )

    const snapshot = await services.getSnapshot()
    const account = snapshot.accounts[0]
    const importedUsage = snapshot.usageByAccountId[account.id]

    await expect(services.accounts.refreshExpiringSession(account.id)).resolves.toBe(false)
    await expect(services.usage.read(account.id)).resolves.toMatchObject({
      planType: 'plus',
      primary: {
        usedPercent: 20
      }
    })

    await expect(
      services.usage.wake(account.id, {
        model: 'gpt-5.4-mini',
        prompt: 'ping'
      })
    ).resolves.toMatchObject({
      rateLimits: {
        planType: 'plus'
      },
      requestResult: {
        status: 200,
        accepted: true,
        model: 'gpt-5.4-mini',
        prompt: 'ping'
      }
    })

    expect(platform.fetch).not.toHaveBeenCalled()
    expect((await services.usage.read(account.id)).fetchedAt).not.toBe(importedUsage?.fetchedAt)
  })

  it('returns seeded usage errors for local mock error accounts', async () => {
    const env = await createEnvironment()
    const platform = createPlatform()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform
    })

    await services.accounts.importFromTemplate(
      createTemplateImport({
        accountId: 'acct-local-team',
        email: 'local-team@mock.local',
        planType: 'team'
      })
    )

    const account = (await services.getSnapshot()).accounts[0]

    await expect(services.usage.read(account.id)).rejects.toThrow('deactivated_workspace')
    expect(platform.fetch).not.toHaveBeenCalled()

    const snapshot = await services.getSnapshot()
    expect(snapshot.usageErrorByAccountId[account.id]).toContain('deactivated_workspace')
    expect(snapshot.usageErrorByAccountId[account.id]).toContain('\n')
  })

  it('blocks opening Codex for local mock accounts', async () => {
    const env = await createEnvironment()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform: createPlatform()
    })

    await services.accounts.importFromTemplate(
      createTemplateImport({
        accountId: 'acct-local-plus-1',
        email: 'local-plus-1@mock.local'
      })
    )

    const account = (await services.getSnapshot()).accounts[0]
    await services.accounts.activate(account.id)

    await expect(services.codex.open(account.id, env.workspacePath)).rejects.toThrow(
      'Local mock accounts do not support opening Codex.'
    )
    await expect(services.codex.show(env.workspacePath)).rejects.toThrow(
      'Local mock accounts do not support opening Codex.'
    )

    expect(mockedProcessState.spawn).not.toHaveBeenCalled()
  })

  it('blocks opening isolated Codex for local mock accounts', async () => {
    const env = await createEnvironment()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform: createPlatform()
    })

    await services.accounts.importFromTemplate(
      createTemplateImport({
        accountId: 'acct-local-plus-1',
        email: 'local-plus-1@mock.local'
      })
    )

    const account = (await services.getSnapshot()).accounts[0]

    await expect(services.codex.openIsolated(account.id, env.workspacePath)).rejects.toThrow(
      'Local mock accounts do not support opening isolated Codex.'
    )

    expect(mockedProcessState.spawn).not.toHaveBeenCalled()
    await expect(services.codex.instances.list()).resolves.toHaveLength(1)
  })

  it('removes multiple accounts in one call', async () => {
    const env = await createEnvironment()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform: createPlatform()
    })

    await writeGlobalAuth(env.globalAuthPath, createAuthPayload('acct-a', 'a@example.com'))
    await services.accounts.importCurrent()
    await writeGlobalAuth(env.globalAuthPath, createAuthPayload('acct-b', 'b@example.com'))
    await services.accounts.importCurrent()
    await writeGlobalAuth(env.globalAuthPath, createAuthPayload('acct-c', 'c@example.com'))
    await services.accounts.importCurrent()

    const snapshot = await services.getSnapshot()
    const targets = snapshot.accounts
      .filter((account) => ['a@example.com', 'c@example.com'].includes(account.email ?? ''))
      .map((account) => account.id)

    const nextSnapshot = await services.accounts.removeMany(targets)
    expect(nextSnapshot.accounts.map((account) => account.email)).toEqual(['b@example.com'])
  })

  it('keeps fresh access tokens even when last_refresh is stale', async () => {
    const env = await createEnvironment()
    const platform = createPlatform()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform
    })

    await writeGlobalAuth(env.globalAuthPath, {
      ...createAuthPayload('acct-a', 'a@example.com'),
      last_refresh: '2026-03-11T00:00:00.000Z'
    })
    await services.accounts.importCurrent()

    const snapshot = await services.getSnapshot()
    const account = snapshot.accounts[0]

    await expect(services.accounts.refreshExpiringSession(account.id)).resolves.toBe(false)

    expect(platform.fetch).not.toHaveBeenCalled()
  })

  it('refreshes sessions when Codex-style last_refresh is stale and token expiry is unavailable', async () => {
    const env = await createEnvironment()
    const platform = createPlatform()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform
    })

    const staleAuth = createAuthPayload('acct-a', 'a@example.com')
    staleAuth.last_refresh = '2026-03-11T00:00:00.000Z'
    staleAuth.tokens.access_token = createJwt({
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'acct-a'
      }
    })
    await writeGlobalAuth(env.globalAuthPath, staleAuth)
    await services.accounts.importCurrent()

    const snapshot = await services.getSnapshot()
    const account = snapshot.accounts[0]

    ;(platform.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createJsonResponse(createRefreshPayload('acct-a', 'a@example.com', 'refresh-acct-a-2'))
    )

    await expect(services.accounts.refreshExpiringSession(account.id)).resolves.toBe(true)

    expect(platform.fetch).toHaveBeenCalledTimes(1)
    const storedAuth = await readFile(join(env.userDataPath, 'codex-accounts.json'), 'utf8')
    expect(storedAuth).toContain('refresh-acct-a-2')
    await expect(readFile(env.globalAuthPath, 'utf8')).resolves.toContain('refresh-acct-a-2')
  })

  it('uses one guarded refresh for concurrent session refreshes', async () => {
    const env = await createEnvironment()
    const platform = createPlatform()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform
    })

    const staleAuth = createAuthPayload('acct-a', 'a@example.com')
    staleAuth.last_refresh = '2026-03-11T00:00:00.000Z'
    staleAuth.tokens.access_token = createJwt({
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'acct-a'
      }
    })
    await writeGlobalAuth(env.globalAuthPath, staleAuth)
    await services.accounts.importCurrent()

    const snapshot = await services.getSnapshot()
    const account = snapshot.accounts[0]

    ;(platform.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      createJsonResponse(createRefreshPayload('acct-a', 'a@example.com', 'refresh-acct-a-2'))
    )

    await expect(
      Promise.all([
        services.accounts.refreshExpiringSession(account.id),
        services.accounts.refreshExpiringSession(account.id)
      ])
    ).resolves.toEqual([true, true])

    expect(platform.fetch).toHaveBeenCalledTimes(1)
  })

  it('does not retry permanent refresh token failures for unchanged auth', async () => {
    const env = await createEnvironment()
    const platform = createPlatform()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform
    })

    const staleAuth = createAuthPayload('acct-a', 'a@example.com')
    staleAuth.last_refresh = '2026-03-11T00:00:00.000Z'
    staleAuth.tokens.access_token = createJwt({
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'acct-a'
      }
    })
    await writeGlobalAuth(env.globalAuthPath, staleAuth)
    await services.accounts.importCurrent()

    const account = (await services.getSnapshot()).accounts[0]
    ;(platform.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      createJsonResponse(
        {
          error: {
            code: 'refresh_token_expired',
            message: 'Refresh token expired'
          }
        },
        401
      )
    )

    await expect(services.accounts.refreshExpiringSession(account.id)).rejects.toThrow(
      'refresh_token_expired'
    )
    await expect(services.accounts.refreshExpiringSession(account.id)).rejects.toThrow(
      'refresh_token_expired'
    )

    expect(platform.fetch).toHaveBeenCalledTimes(1)
  })

  it('uses one guarded refresh for concurrent manual token refreshes', async () => {
    const env = await createEnvironment()
    const platform = createPlatform()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform
    })

    await writeGlobalAuth(env.globalAuthPath, createAuthPayload('acct-a', 'a@example.com'))
    await services.accounts.importCurrent()

    const account = (await services.getSnapshot()).accounts[0]
    ;(platform.fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      return createJsonResponse(createRefreshPayload('acct-a', 'a@example.com', 'refresh-acct-a-2'))
    })

    const [first, second] = await Promise.all([
      services.accounts.refreshTokens(account.id),
      services.accounts.refreshTokens(account.id)
    ])

    expect(first.success).toBe(true)
    expect(second.success).toBe(true)
    expect(platform.fetch).toHaveBeenCalledTimes(1)
  })

  it('syncs a Codex-refreshed global auth file before using the stored refresh token', async () => {
    const env = await createEnvironment()
    const platform = createPlatform()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform
    })

    const staleAuth = createAuthPayload('acct-a', 'a@example.com')
    staleAuth.last_refresh = '2026-03-11T00:00:00.000Z'
    staleAuth.tokens.access_token = createJwt({
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'acct-a'
      }
    })
    await writeGlobalAuth(env.globalAuthPath, staleAuth)
    await services.accounts.importCurrent()

    const account = (await services.getSnapshot()).accounts[0]
    await writeGlobalAuth(env.globalAuthPath, {
      ...createAuthPayload('acct-a', 'a@example.com'),
      last_refresh: new Date().toISOString(),
      tokens: {
        ...createAuthPayload('acct-a', 'a@example.com').tokens,
        refresh_token: 'refresh-acct-a-from-codex'
      }
    })

    await expect(services.accounts.refreshExpiringSession(account.id)).resolves.toBe(false)

    expect(platform.fetch).not.toHaveBeenCalled()
    const storedAuth = await readFile(join(env.userDataPath, 'codex-accounts.json'), 'utf8')
    expect(storedAuth).toContain('refresh-acct-a-from-codex')
  })

  it('refreshes stale auth before reading usage and stores rotated refresh tokens', async () => {
    const env = await createEnvironment()
    const platform = createPlatform()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform
    })

    const staleAuth = createAuthPayload('acct-a', 'a@example.com')
    staleAuth.last_refresh = '2026-03-11T00:00:00.000Z'
    staleAuth.tokens.access_token = createJwt({
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'acct-a'
      }
    })
    await writeGlobalAuth(env.globalAuthPath, staleAuth)
    await services.accounts.importCurrent()

    const account = (await services.getSnapshot()).accounts[0]

    ;(platform.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        createJsonResponse(createRefreshPayload('acct-a', 'a@example.com', 'refresh-acct-a-2'))
      )
      .mockResolvedValueOnce(createUsageResponse())

    await expect(services.usage.read(account.id)).resolves.toMatchObject({
      planType: 'plus',
      primary: {
        usedPercent: 12
      },
      secondary: {
        usedPercent: 34
      }
    })

    expect(platform.fetch).toHaveBeenCalledTimes(2)
    const storedAuth = await readFile(join(env.userDataPath, 'codex-accounts.json'), 'utf8')
    expect(storedAuth).toContain('refresh-acct-a-2')
  })

  it('does not trigger wake-up requests when the session quota is not full', async () => {
    const env = await createEnvironment()
    const platform = createPlatform()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform
    })

    await writeGlobalAuth(env.globalAuthPath, createAuthPayload('acct-a', 'a@example.com'))
    await services.accounts.importCurrent()

    const account = (await services.getSnapshot()).accounts[0]

    ;(platform.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(createUsageResponse({ primaryUsedPercent: 80, primaryResetAt: 0 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: 'rate_limit_exceeded'
            }
          }),
          {
            status: 429,
            headers: {
              'content-type': 'application/json'
            }
          }
        )
      )
      .mockResolvedValueOnce(
        createUsageResponse({ primaryUsedPercent: 80, primaryResetAt: 1_900_000_000 })
      )

    await expect(services.usage.wake(account.id)).resolves.toMatchObject({
      rateLimits: {
        primary: {
          usedPercent: 80,
          resetsAt: 1_900_000_000
        }
      },
      requestResult: {
        status: 429,
        accepted: true
      }
    })

    expect(platform.fetch).toHaveBeenCalledTimes(3)
    expect(platform.fetch).toHaveBeenNthCalledWith(
      2,
      'https://chatgpt.com/backend-api/codex/responses',
      expect.objectContaining({
        method: 'POST'
      })
    )
  })

  it('does not trigger wake-up requests for free accounts', async () => {
    const env = await createEnvironment()
    const platform = createPlatform()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform
    })

    await writeGlobalAuth(env.globalAuthPath, createAuthPayload('acct-a', 'a@example.com'))
    await services.accounts.importCurrent()

    const account = (await services.getSnapshot()).accounts[0]

    ;(platform.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createUsageResponse({ planType: 'free', primaryUsedPercent: 0 })
    )

    await expect(services.usage.wake(account.id)).resolves.toMatchObject({
      rateLimits: {
        planType: 'free',
        primary: {
          usedPercent: 0
        }
      },
      requestResult: null
    })

    expect(platform.fetch).toHaveBeenCalledTimes(1)
    expect(platform.fetch).toHaveBeenCalledWith(
      'https://chatgpt.com/backend-api/wham/usage',
      expect.objectContaining({
        method: 'GET'
      })
    )
  })

  it('does not trigger wake-up requests when weekly quota is depleted', async () => {
    const env = await createEnvironment()
    const platform = createPlatform()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform
    })

    await writeGlobalAuth(env.globalAuthPath, createAuthPayload('acct-a', 'a@example.com'))
    await services.accounts.importCurrent()

    const account = (await services.getSnapshot()).accounts[0]

    ;(platform.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createUsageResponse({
        primaryUsedPercent: 0,
        secondaryUsedPercent: 100
      })
    )

    await expect(services.usage.wake(account.id)).resolves.toMatchObject({
      rateLimits: {
        primary: {
          usedPercent: 0
        },
        secondary: {
          usedPercent: 100
        }
      },
      requestResult: null
    })

    expect(platform.fetch).toHaveBeenCalledTimes(1)
    expect(platform.fetch).toHaveBeenCalledWith(
      'https://chatgpt.com/backend-api/wham/usage',
      expect.objectContaining({
        method: 'GET'
      })
    )
  })

  it('triggers a wake-up request for non-free accounts regardless of session usage', async () => {
    const env = await createEnvironment()
    const platform = createPlatform()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform
    })

    await writeGlobalAuth(env.globalAuthPath, createAuthPayload('acct-a', 'a@example.com'))
    await services.accounts.importCurrent()

    const account = (await services.getSnapshot()).accounts[0]

    ;(platform.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(createUsageResponse({ primaryUsedPercent: 0, primaryResetAt: 0 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: 'rate_limit_exceeded'
            }
          }),
          {
            status: 429,
            headers: {
              'content-type': 'application/json'
            }
          }
        )
      )
      .mockResolvedValueOnce(
        createUsageResponse({ primaryUsedPercent: 0, primaryResetAt: 1_900_000_000 })
      )

    await expect(services.usage.wake(account.id)).resolves.toMatchObject({
      rateLimits: {
        primary: {
          usedPercent: 0,
          resetsAt: 1_900_000_000
        }
      },
      requestResult: {
        status: 429,
        accepted: true
      }
    })

    expect(platform.fetch).toHaveBeenCalledTimes(3)
    expect(platform.fetch).toHaveBeenNthCalledWith(
      2,
      'https://chatgpt.com/backend-api/codex/responses',
      expect.objectContaining({
        method: 'POST'
      })
    )
  })

  it('continues wake-up flow when auth refresh changes the account identity', async () => {
    const env = await createEnvironment()
    const platform = createPlatform()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform
    })

    await writeGlobalAuth(env.globalAuthPath, createAuthPayload('acct-a', 'a@example.com'))
    await services.accounts.importCurrent()

    const account = (await services.getSnapshot()).accounts[0]

    ;(platform.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(createUsageResponse({ primaryUsedPercent: 0, primaryResetAt: 0 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'expired' } }), {
          status: 401,
          headers: {
            'content-type': 'application/json'
          }
        })
      )
      .mockResolvedValueOnce(
        createJsonResponse(
          createRefreshPayload('acct-a', 'a@example.com', 'refresh-acct-a-2', 'user-a')
        )
      )
      .mockResolvedValueOnce(
        new Response('{}', {
          status: 200,
          headers: {
            'content-type': 'text/event-stream'
          }
        })
      )
      .mockResolvedValueOnce(
        createUsageResponse({ primaryUsedPercent: 0, primaryResetAt: 1_900_000_000 })
      )

    await expect(services.usage.wake(account.id)).resolves.toMatchObject({
      rateLimits: {
        primary: {
          usedPercent: 0,
          resetsAt: 1_900_000_000
        }
      },
      requestResult: {
        status: 200,
        accepted: true
      }
    })

    expect((await services.getSnapshot()).accounts[0]?.id).toBe('user-a:acct-a')
    expect(platform.fetch).toHaveBeenCalledTimes(5)
  })

  it('refreshes expiring stored sessions and syncs the current auth file', async () => {
    const env = await createEnvironment()
    const platform = createPlatform()
    const services = createCodexServices({
      userDataPath: env.userDataPath,
      defaultWorkspacePath: env.workspacePath,
      platform
    })

    await writeGlobalAuth(env.globalAuthPath, {
      auth_mode: 'chatgpt',
      last_refresh: '2026-03-11T00:00:00.000Z',
      tokens: {
        access_token: createJwt({
          exp: Math.floor(Date.now() / 1000) - 60,
          'https://api.openai.com/auth': {
            chatgpt_account_id: 'acct-a'
          }
        }),
        refresh_token: 'refresh-acct-a',
        id_token: createJwt({
          email: 'a@example.com',
          name: 'a',
          'https://api.openai.com/auth': {
            chatgpt_account_id: 'acct-a'
          }
        }),
        account_id: 'acct-a'
      }
    })
    await services.accounts.importCurrent()

    const snapshot = await services.getSnapshot()
    const account = snapshot.accounts[0]

    ;(platform.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: createJwt({
            exp: Math.floor(Date.now() / 1000) + 3600,
            'https://api.openai.com/auth': {
              chatgpt_account_id: 'acct-a'
            }
          }),
          refresh_token: 'refresh-acct-a-2',
          id_token: createJwt({
            email: 'a@example.com',
            name: 'a',
            'https://api.openai.com/auth': {
              chatgpt_account_id: 'acct-a'
            }
          })
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        }
      )
    )

    await expect(services.accounts.refreshExpiringSession(account.id)).resolves.toBe(true)

    const storedAuth = await readFile(join(env.userDataPath, 'codex-accounts.json'), 'utf8')
    expect(storedAuth).toContain('refresh-acct-a-2')
    await expect(readFile(env.globalAuthPath, 'utf8')).resolves.toContain('refresh-acct-a-2')
  })
})
