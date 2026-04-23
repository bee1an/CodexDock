import type { MenuItemConstructorOptions } from 'electron'

import {
  remainingPercent,
  type AccountSummary,
  type AppLanguage,
  type AppSnapshot,
  type AppUpdateState,
  type TokenCostSummary
} from '../shared/codex'

function accountUsageLabel(
  snapshot: AppSnapshot,
  accountId: string
): { hour: string; week: string } {
  const limits = snapshot.usageByAccountId[accountId]

  return {
    hour: limits?.primary ? `${remainingPercent(limits.primary.usedPercent)}%` : '--',
    week: limits?.secondary ? `${remainingPercent(limits.secondary.usedPercent)}%` : '--'
  }
}

export function resolveTrayAccounts(snapshot: AppSnapshot): AccountSummary[] {
  if (!snapshot.accounts.length) {
    return []
  }

  const activeAccount = snapshot.activeAccountId
    ? snapshot.accounts.find((account) => account.id === snapshot.activeAccountId)
    : undefined
  const remainingAccounts = snapshot.accounts.filter((account) => account.id !== activeAccount?.id)

  return [activeAccount, ...remainingAccounts]
    .filter((account): account is AccountSummary => Boolean(account))
    .slice(0, 5)
}

export function buildTrayUsageMenuItems(
  snapshot: AppSnapshot,
  options: {
    activePrefix: string
    noVisibleAccount: string
    language: AppLanguage
    accountLabel: (account: AccountSummary, language: AppLanguage) => string
    openAccount: (accountId: string) => void
  }
): MenuItemConstructorOptions[] {
  const accounts = resolveTrayAccounts(snapshot)

  if (!accounts.length) {
    return [{ label: options.noVisibleAccount, enabled: false }]
  }

  return accounts.map((account) => {
    const usage = accountUsageLabel(snapshot, account.id)
    const isActive = account.id === snapshot.activeAccountId
    const prefix = isActive ? options.activePrefix : ''

    return {
      label: `${prefix}${options.accountLabel(account, options.language)}  h${usage.hour}  w${usage.week}`,
      type: 'radio',
      checked: isActive,
      enabled: !isActive,
      click: () => {
        if (!isActive) {
          options.openAccount(account.id)
        }
      }
    }
  })
}

function formatTokenCount(value: number): string {
  return new Intl.NumberFormat('en-US', {
    notation: value >= 1_000_000 ? 'compact' : 'standard',
    maximumFractionDigits: 1
  }).format(value)
}

function formatCostUSD(value: number | null): string {
  if (value === null) {
    return '--'
  }

  if (value > 0 && value < 0.0001) {
    return `$${value.toExponential(1)}`
  }

  return `$${value.toFixed(4)}`
}

function resolveTrayTokenCostSummary(snapshot: AppSnapshot): {
  summary: TokenCostSummary | null
  errors: string[]
  fallbackToDefault: boolean
} {
  const summary = snapshot.runningTokenCostSummary ?? null
  const targetInstanceIds = snapshot.runningTokenCostInstanceIds
  const errors = targetInstanceIds
    .map((instanceId) => snapshot.tokenCostErrorByInstanceId[instanceId])
    .filter((message): message is string => Boolean(message))

  return {
    summary,
    errors,
    fallbackToDefault: false
  }
}

export function buildTrayTokenCostMenuItems(
  snapshot: AppSnapshot,
  options: {
    title: string
    today: string
    last30Days: string
    noData: string
    fallbackToDefault: string
  }
): MenuItemConstructorOptions[] {
  const { summary, errors, fallbackToDefault } = resolveTrayTokenCostSummary(snapshot)
  const items: MenuItemConstructorOptions[] = [
    {
      label: options.title,
      enabled: false
    }
  ]

  if (fallbackToDefault) {
    items.push({
      label: options.fallbackToDefault,
      enabled: false
    })
  }

  if (!summary) {
    items.push({
      label: errors[0] ?? options.noData,
      enabled: false
    })
    return items
  }

  if (summary.sessionTokens === 0 && summary.last30DaysTokens === 0 && errors.length === 0) {
    items.push({
      label: options.noData,
      enabled: false
    })
    return items
  }

  items.push(
    {
      label: `${options.today} · ${formatTokenCount(summary.sessionTokens)} tokens · ${formatCostUSD(summary.sessionCostUSD)}`,
      enabled: false
    },
    {
      label: `${options.last30Days} · ${formatTokenCount(summary.last30DaysTokens)} tokens · ${formatCostUSD(summary.last30DaysCostUSD)}`,
      enabled: false
    }
  )

  if (errors[0]) {
    items.push({
      label: errors[0],
      enabled: false
    })
  }

  return items
}

export function buildTrayUpdateMenuItem(
  updateState: AppUpdateState,
  options: {
    checkForUpdates: string
    checkingForUpdates: string
    downloadUpdate: (version?: string) => string
    updatingViaHomebrew: string
    homebrewUpdateStatus: (status?: string, command?: string) => string
    updateViaHomebrew: (version?: string) => string
    openReleasePage: (version?: string) => string
    installUpdate: string
    unsupported: string
    downloadingUpdate: (progress?: number) => string
    onCheck: () => void
    onDownload: () => void
    onInstall: () => void
  }
): MenuItemConstructorOptions | null {
  switch (updateState.status) {
    case 'idle':
    case 'up-to-date':
    case 'error':
      return {
        label: options.checkForUpdates,
        click: () => options.onCheck()
      }
    case 'checking':
      return {
        label: options.checkingForUpdates,
        enabled: false
      }
    case 'available':
      return {
        label:
          updateState.delivery === 'external'
            ? updateState.externalAction === 'homebrew'
              ? options.updateViaHomebrew(updateState.availableVersion)
              : options.openReleasePage(updateState.availableVersion)
            : options.downloadUpdate(updateState.availableVersion),
        click: () => options.onDownload()
      }
    case 'downloading':
      return {
        label:
          updateState.delivery === 'external' && updateState.externalAction === 'homebrew'
            ? options.homebrewUpdateStatus(
                updateState.externalCommandStatus,
                updateState.externalCommand
              )
            : options.downloadingUpdate(updateState.downloadProgress),
        enabled: false
      }
    case 'downloaded':
      return {
        label: options.installUpdate,
        click: () => options.onInstall()
      }
    case 'unsupported':
      return {
        label: options.unsupported,
        enabled: false
      }
    default:
      return null
  }
}
