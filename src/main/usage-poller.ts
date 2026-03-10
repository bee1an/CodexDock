import {
  usagePollDueInMs,
  usagePollingIntervalMs,
  type AccountSummary,
  type AppSnapshot
} from '../shared/codex'

export interface UsagePollingController {
  start(): void
  stop(): void
  sync(snapshot?: AppSnapshot): void
}

export interface CreateUsagePollingControllerOptions {
  getSnapshot(): Promise<AppSnapshot>
  readAccountRateLimits(accountId: string): Promise<unknown>
  onSnapshotChanged(): Promise<unknown> | unknown
  onReadError?: (account: AccountSummary, error: unknown) => void
}

export function createUsagePollingController(
  options: CreateUsagePollingControllerOptions
): UsagePollingController {
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

  function accountDueInMs(snapshot: AppSnapshot, account: AccountSummary, now: number): number {
    const usageDueInMs = usagePollDueInMs(
      snapshot.usageByAccountId[account.id],
      snapshot.settings.usagePollingMinutes,
      now
    )
    const retryAfter = retryAfterByAccountId.get(account.id)
    const retryDueInMs = retryAfter ? Math.max(0, retryAfter - now) : 0

    return Math.max(usageDueInMs, retryDueInMs)
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

    const defaultDelay = usagePollingIntervalMs(snapshot.settings.usagePollingMinutes)
    const nextDelay = snapshot.accounts.length
      ? Math.min(
          ...snapshot.accounts.map((account) => accountDueInMs(snapshot, account, Date.now()))
        )
      : defaultDelay

    timer = setTimeout(() => {
      timer = null
      void poll()
    }, nextDelay)
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
        const dueAccounts = snapshot.accounts.filter(
          (account) => accountDueInMs(snapshot, account, Date.now()) === 0
        )

        if (!dueAccounts.length) {
          await schedule(snapshot)
          return
        }

        let changed = false
        for (const account of dueAccounts) {
          try {
            await options.readAccountRateLimits(account.id)
            retryAfterByAccountId.delete(account.id)
            changed = true
          } catch (error) {
            retryAfterByAccountId.set(
              account.id,
              Date.now() + usagePollingIntervalMs(snapshot.settings.usagePollingMinutes)
            )
            options.onReadError?.(account, error)
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
      void schedule()
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
