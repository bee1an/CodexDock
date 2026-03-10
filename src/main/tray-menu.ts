import type { MenuItemConstructorOptions } from 'electron'

import {
  remainingPercent,
  type AccountSummary,
  type AppLanguage,
  type AppSnapshot,
  type AppUpdateState
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

export function buildTrayUpdateMenuItem(
  updateState: AppUpdateState,
  options: {
    checkForUpdates: string
    checkingForUpdates: string
    downloadUpdate: (version?: string) => string
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
        label: options.downloadUpdate(updateState.availableVersion),
        click: () => options.onDownload()
      }
    case 'downloading':
      return {
        label: options.downloadingUpdate(updateState.downloadProgress),
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
