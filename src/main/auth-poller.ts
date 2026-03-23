import type { AccountSummary, AppSnapshot } from '../shared/codex'

export interface AuthRefreshController {
  start(): void
  stop(): void
  sync(snapshot?: AppSnapshot): void
}

export interface CreateAuthRefreshControllerOptions {
  getSnapshot(): Promise<AppSnapshot>
  refreshExpiringSession(accountId: string): Promise<boolean>
  onSnapshotChanged(): Promise<unknown> | unknown
  onRefreshError?: (account: AccountSummary, error: unknown) => void
}

const AUTH_REFRESH_POLLING_INTERVAL_MS = 60_000
const AUTH_REFRESH_ERROR_BACKOFF_MS = 15 * 60_000

export function createAuthRefreshController(
  options: CreateAuthRefreshControllerOptions
): AuthRefreshController {
  let active = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let inFlight: Promise<void> | null = null
  let scheduleToken = 0
  const retryAfterByAccountId = new Map<string, number>()

  function clearTimer(): void {
    if (!timer) {
      return
    }

    clearTimeout(timer)
    timer = null
  }

  function cleanupRetryState(snapshot: AppSnapshot): void {
    const accountIds = new Set(snapshot.accounts.map((account) => account.id))
    for (const accountId of retryAfterByAccountId.keys()) {
      if (!accountIds.has(accountId)) {
        retryAfterByAccountId.delete(accountId)
      }
    }
  }

  async function schedule(snapshotOverride?: AppSnapshot): Promise<void> {
    if (!active) {
      return
    }

    const token = ++scheduleToken
    const snapshot = snapshotOverride ?? (await options.getSnapshot())
    if (!active || token !== scheduleToken) {
      return
    }

    cleanupRetryState(snapshot)
    clearTimer()

    timer = setTimeout(() => {
      timer = null
      void poll()
    }, AUTH_REFRESH_POLLING_INTERVAL_MS)
  }

  async function poll(): Promise<void> {
    if (!active) {
      return
    }

    if (inFlight) {
      await inFlight
      return
    }

    inFlight = (async () => {
      try {
        const snapshot = await options.getSnapshot()
        cleanupRetryState(snapshot)

        let changed = false
        for (const account of snapshot.accounts) {
          const retryAfter = retryAfterByAccountId.get(account.id)
          if (retryAfter && retryAfter > Date.now()) {
            continue
          }

          try {
            const refreshed = await options.refreshExpiringSession(account.id)
            if (refreshed) {
              changed = true
            }
            retryAfterByAccountId.delete(account.id)
          } catch (error) {
            retryAfterByAccountId.set(account.id, Date.now() + AUTH_REFRESH_ERROR_BACKOFF_MS)
            options.onRefreshError?.(account, error)
          }
        }

        if (changed) {
          await options.onSnapshotChanged()
        } else {
          await schedule(snapshot)
        }
      } finally {
        inFlight = null
      }
    })()

    try {
      await inFlight
    } finally {
      if (active && !timer) {
        await schedule()
      }
    }
  }

  return {
    start(): void {
      if (active) {
        return
      }

      active = true
      void poll()
    },
    stop(): void {
      active = false
      scheduleToken += 1
      clearTimer()
    },
    sync(snapshot?: AppSnapshot): void {
      if (!active) {
        return
      }

      void schedule(snapshot)
    }
  }
}
