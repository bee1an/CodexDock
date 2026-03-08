import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { runCli } from './run-cli'
import type {
  AccountRateLimits,
  AppSettings,
  AppSnapshot,
  CurrentSessionSummary,
  LoginEvent,
  PortOccupant
} from '../shared/codex'

function createSnapshot(overrides: Partial<AppSnapshot> = {}): AppSnapshot {
  return {
    accounts: [],
    activeAccountId: undefined,
    currentSession: null,
    loginInProgress: false,
    settings: {
      usagePollingMinutes: 15,
      statusBarAccountIds: [],
      language: 'zh-CN',
      theme: 'light'
    },
    usageByAccountId: {},
    ...overrides
  }
}

function createRuntime() {
  const listeners = new Set<(event: LoginEvent) => void>()
  const snapshot = createSnapshot({
    accounts: [
      {
        id: 'acct_1',
        email: 'one@example.com',
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z'
      }
    ],
    activeAccountId: 'acct_1',
    currentSession: {
      email: 'one@example.com',
      storedAccountId: 'acct_1'
    }
  })
  const rateLimits: AccountRateLimits = {
    limitId: 'codex',
    limitName: 'Codex',
    planType: 'plus',
    primary: {
      usedPercent: 25,
      windowDurationMins: 300,
      resetsAt: null
    },
    secondary: {
      usedPercent: 10,
      windowDurationMins: 10080,
      resetsAt: null
    },
    credits: null,
    limits: [],
    fetchedAt: '2026-03-08T00:00:00.000Z'
  }
  const settings: AppSettings = {
    usagePollingMinutes: 15,
    statusBarAccountIds: [],
    language: 'zh-CN',
    theme: 'light'
  }
  const currentSession: CurrentSessionSummary = {
    email: 'one@example.com',
    storedAccountId: 'acct_1'
  }
  const portOccupant: PortOccupant = { pid: 123, command: 'node' }

  const runtime = {
    platform: {
      openExternal: vi.fn(async () => undefined)
    },
    subscribeLoginEvents(listener: (event: LoginEvent) => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    emit(event: LoginEvent) {
      for (const listener of listeners) {
        listener(event)
      }
    },
    services: {
      accounts: {
        list: vi.fn(async () => snapshot),
        importCurrent: vi.fn(async () => snapshot),
        activate: vi.fn(async () => snapshot),
        activateBest: vi.fn(async () => snapshot),
        remove: vi.fn(async () => snapshot),
        get: vi.fn()
      },
      session: {
        current: vi.fn(async () => currentSession)
      },
      settings: {
        get: vi.fn(async () => settings),
        update: vi.fn(async (nextSettings: Partial<AppSettings>) =>
          createSnapshot({
            settings: {
              ...settings,
              ...nextSettings
            }
          })
        )
      },
      usage: {
        read: vi.fn(async () => rateLimits)
      },
      login: {
        start: vi.fn(async (method: 'browser' | 'device') => {
          const attemptId = `${method}-attempt`
          const waitingEvent: LoginEvent =
            method === 'browser'
              ? {
                  attemptId,
                  method,
                  phase: 'waiting',
                  message: 'Browser login is waiting for the OpenAI callback.',
                  authUrl: 'https://auth.openai.com/authorize',
                  localCallbackUrl: 'http://localhost:1455/auth/callback'
                }
              : {
                  attemptId,
                  method,
                  phase: 'waiting',
                  message: 'Open the verification page and enter the device code.',
                  verificationUrl: 'https://auth.openai.com/codex/device',
                  userCode: 'ABCD-EFGH'
                }

          const successEvent: LoginEvent = {
            attemptId,
            method,
            phase: 'success',
            message: `Saved the new ${method} login to the local account vault.`,
            snapshot
          }

          runtime.emit(waitingEvent)
          runtime.emit(successEvent)

          return { attemptId, method }
        }),
        isRunning: vi.fn(() => false),
        getPortOccupant: vi.fn(async () => portOccupant),
        killPortOccupant: vi.fn(async () => portOccupant)
      },
      codex: {
        open: vi.fn(async () => snapshot)
      },
      getSnapshot: vi.fn(async () => snapshot)
    }
  }

  return { runtime, snapshot, rateLimits, settings, currentSession, portOccupant }
}

function parseJsonLog(logSpy: ReturnType<typeof vi.spyOn>, callIndex = 0): unknown {
  return JSON.parse(String(logSpy.mock.calls[callIndex]?.[0]))
}

describe('runCli', () => {
  let logSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    logSpy.mockRestore()
    errorSpy.mockRestore()
    vi.useRealTimers()
  })

  it('prints help when no arguments are provided', async () => {
    const { runtime } = createRuntime()

    const code = await runCli(runtime as never, [])

    expect(code).toBe(0)
    expect(String(logSpy.mock.calls[0][0])).toContain('Usage:')
  })

  it('covers the account commands', async () => {
    const { runtime, snapshot } = createRuntime()

    await expect(runCli(runtime as never, ['account', 'list', '--json'])).resolves.toBe(0)
    expect(runtime.services.accounts.list).toHaveBeenCalledOnce()
    expect(parseJsonLog(logSpy)).toEqual({
      ok: true,
      data: {
        accounts: snapshot.accounts,
        activeAccountId: snapshot.activeAccountId,
        currentSession: snapshot.currentSession
      },
      error: null
    })

    logSpy.mockClear()
    await expect(runCli(runtime as never, ['account', 'import-current', '--json'])).resolves.toBe(0)
    expect(runtime.services.accounts.importCurrent).toHaveBeenCalledOnce()

    logSpy.mockClear()
    await expect(runCli(runtime as never, ['account', 'activate', 'acct_1', '--json'])).resolves.toBe(0)
    expect(runtime.services.accounts.activate).toHaveBeenCalledWith('acct_1')

    logSpy.mockClear()
    await expect(runCli(runtime as never, ['account', 'best', '--json'])).resolves.toBe(0)
    expect(runtime.services.accounts.activateBest).toHaveBeenCalledOnce()

    logSpy.mockClear()
    await expect(runCli(runtime as never, ['account', 'remove', 'acct_1', '--json'])).resolves.toBe(0)
    expect(runtime.services.accounts.remove).toHaveBeenCalledWith('acct_1')
  })

  it('covers session current and usage read', async () => {
    const { runtime, currentSession, rateLimits } = createRuntime()

    await expect(runCli(runtime as never, ['session', 'current', '--json'])).resolves.toBe(0)
    expect(runtime.services.session.current).toHaveBeenCalledOnce()
    expect(parseJsonLog(logSpy)).toEqual({
      ok: true,
      data: currentSession,
      error: null
    })

    logSpy.mockClear()
    await expect(runCli(runtime as never, ['usage', 'read', 'acct_1', '--json'])).resolves.toBe(0)
    expect(runtime.services.usage.read).toHaveBeenCalledWith('acct_1')
    expect(parseJsonLog(logSpy)).toEqual({
      ok: true,
      data: rateLimits,
      error: null
    })
  })

  it('covers browser and device login commands', async () => {
    const { runtime, snapshot } = createRuntime()

    await expect(runCli(runtime as never, ['login', 'browser', '--json'])).resolves.toBe(0)
    expect(runtime.services.login.start).toHaveBeenCalledWith('browser')
    expect(runtime.platform.openExternal).toHaveBeenCalledWith('https://auth.openai.com/authorize')
    expect(parseJsonLog(logSpy)).toEqual({
      ok: true,
      data: {
        attemptId: 'browser-attempt',
        method: 'browser',
        phase: 'success',
        snapshot
      },
      error: null
    })

    logSpy.mockClear()
    runtime.platform.openExternal.mockClear()
    await expect(runCli(runtime as never, ['login', 'browser', '--json', '--no-open'])).resolves.toBe(0)
    expect(runtime.platform.openExternal).not.toHaveBeenCalled()

    logSpy.mockClear()
    await expect(runCli(runtime as never, ['login', 'device', '--json'])).resolves.toBe(0)
    expect(runtime.services.login.start).toHaveBeenCalledWith('device')
    expect(parseJsonLog(logSpy)).toEqual({
      ok: true,
      data: {
        attemptId: 'device-attempt',
        method: 'device',
        phase: 'success',
        snapshot
      },
      error: null
    })
  })

  it('covers login port status and kill', async () => {
    const { runtime, portOccupant } = createRuntime()

    await expect(runCli(runtime as never, ['login', 'port', 'status', '--json'])).resolves.toBe(0)
    expect(runtime.services.login.getPortOccupant).toHaveBeenCalledOnce()
    expect(parseJsonLog(logSpy)).toEqual({
      ok: true,
      data: portOccupant,
      error: null
    })

    logSpy.mockClear()
    await expect(runCli(runtime as never, ['login', 'port', 'kill', '--json'])).resolves.toBe(0)
    expect(runtime.services.login.killPortOccupant).toHaveBeenCalledOnce()
    expect(parseJsonLog(logSpy)).toEqual({
      ok: true,
      data: portOccupant,
      error: null
    })
  })

  it('covers codex open and settings commands', async () => {
    const { runtime } = createRuntime()

    await expect(runCli(runtime as never, ['codex', 'open', 'acct_1', '--json'])).resolves.toBe(0)
    expect(runtime.services.codex.open).toHaveBeenCalledWith('acct_1')

    logSpy.mockClear()
    await expect(runCli(runtime as never, ['settings', 'get', 'theme', '--json'])).resolves.toBe(0)
    expect(runtime.services.settings.get).toHaveBeenCalled()
    expect(parseJsonLog(logSpy)).toEqual({
      ok: true,
      data: 'light',
      error: null
    })

    logSpy.mockClear()
    await expect(runCli(runtime as never, ['settings', 'set', 'statusBarAccountIds', 'a,b,c', '--json'])).resolves.toBe(0)
    expect(runtime.services.settings.update).toHaveBeenCalledWith({
      statusBarAccountIds: ['a', 'b', 'c']
    })
    expect(parseJsonLog(logSpy)).toEqual({
      ok: true,
      data: {
        usagePollingMinutes: 15,
        statusBarAccountIds: ['a', 'b', 'c'],
        language: 'zh-CN',
        theme: 'light'
      },
      error: null
    })
  })

  it('returns usage errors for bad CLI input', async () => {
    const { runtime } = createRuntime()

    await expect(runCli(runtime as never, ['account', 'activate', '--json'])).resolves.toBe(2)
    expect(parseJsonLog(logSpy)).toEqual({
      ok: false,
      data: null,
      error: {
        code: 2,
        message: 'Missing account-id'
      }
    })

    logSpy.mockClear()
    await expect(runCli(runtime as never, ['settings', 'set', 'theme', 'blue', '--json'])).resolves.toBe(2)
    expect(parseJsonLog(logSpy)).toEqual({
      ok: false,
      data: null,
      error: {
        code: 2,
        message: 'theme must be light, dark, or system'
      }
    })

    logSpy.mockClear()
    await expect(runCli(runtime as never, ['wat', '--json'])).resolves.toBe(2)
    expect(parseJsonLog(logSpy)).toEqual({
      ok: false,
      data: null,
      error: {
        code: 2,
        message: 'Unknown command: wat'
      }
    })
  })

  it('returns a timeout failure for stalled logins', async () => {
    vi.useFakeTimers()
    const { runtime } = createRuntime()
    runtime.services.login.start = vi.fn(async (method: 'browser' | 'device') => ({
      attemptId: `${method}-attempt`,
      method
    }))

    const pending = runCli(runtime as never, ['login', 'device', '--json', '--timeout=0.01'])
    await vi.advanceTimersByTimeAsync(20)

    await expect(pending).resolves.toBe(1)
    expect(parseJsonLog(logSpy)).toEqual({
      ok: false,
      data: null,
      error: {
        code: 1,
        message: 'Command timed out after 0.01 seconds'
      }
    })
  })
})
