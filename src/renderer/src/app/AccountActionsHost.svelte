<script lang="ts">
  import { accountLabel, type LocalizedCopy } from '$lib/view/app-view'
  import type {
    AccountGroup,
    AccountSummary,
    AppSnapshot,
    UpdateAccountHealthInput
  } from '../../../shared/codex'

  type ApplySnapshotOptions = {
    preserveUsageState?: boolean
  }
  type RunAction = (
    key: string,
    task: () => Promise<AppSnapshot>,
    options?: ApplySnapshotOptions
  ) => Promise<void>

  export let snapshot: AppSnapshot
  export let copy: LocalizedCopy
  export let runAction: RunAction

  export const removeAccount = async (account: AccountSummary): Promise<void> => {
    if (!window.confirm(copy.removeConfirm(accountLabel(account, copy)))) {
      return
    }

    await runAction(`remove:${account.id}`, () => window.codexApp.removeAccount(account.id))
  }

  export const updateAccountHealth = async (
    account: AccountSummary,
    input: UpdateAccountHealthInput
  ): Promise<void> => {
    await runAction(`account-health:${account.id}:${input.status}`, () =>
      window.codexApp.updateAccountHealth(account.id, input)
    )
  }

  export const removeAccounts = async (accountIds: string[]): Promise<void> => {
    const uniqueIds = [...new Set(accountIds)]
    if (!uniqueIds.length) {
      return
    }

    if (!window.confirm(copy.removeSelectedConfirm(uniqueIds.length))) {
      return
    }

    await runAction(`remove-many:${uniqueIds.join(',')}`, () =>
      window.codexApp.removeAccounts(uniqueIds)
    )
  }

  export const reorderAccounts = async (accountIds: string[]): Promise<void> => {
    if (!accountIds.length) {
      return
    }

    const payloadAccountIds = new Set(accountIds)
    const currentPayloadOrder = snapshot.accounts
      .filter((account) => payloadAccountIds.has(account.id))
      .map((account) => account.id)

    if (
      currentPayloadOrder.length === accountIds.length &&
      accountIds.every((accountId, index) => accountId === currentPayloadOrder[index])
    ) {
      return
    }

    await runAction('accounts:reorder', () => window.codexApp.reorderAccounts(accountIds), {
      preserveUsageState: true
    })
  }

  export const reorderAccountsInGroup = async (
    groupId: string,
    accountIds: string[]
  ): Promise<void> => {
    if (!groupId || !accountIds.length) {
      return
    }

    await runAction(
      `accounts:reorder-in-group:${groupId}`,
      () => window.codexApp.reorderAccountsInGroup(groupId, accountIds),
      { preserveUsageState: true }
    )
  }

  export const createGroup = async (name: string): Promise<void> => {
    await runAction(`groups:create:${name}`, () => window.codexApp.createGroup(name))
  }

  export const updateGroup = async (group: AccountGroup, name: string): Promise<void> => {
    await runAction(`groups:update:${group.id}`, () => window.codexApp.updateGroup(group.id, name))
  }

  export const deleteGroup = async (group: AccountGroup): Promise<void> => {
    await runAction(`groups:delete:${group.id}`, () => window.codexApp.deleteGroup(group.id))
  }

  export const updateAccountGroups = async (
    account: AccountSummary,
    groupIds: string[]
  ): Promise<void> => {
    if (
      groupIds.length === account.groupIds.length &&
      groupIds.every((groupId, index) => groupId === account.groupIds[index])
    ) {
      return
    }

    await runAction(`account-groups:${account.id}`, () =>
      window.codexApp.updateAccountGroups(account.id, groupIds)
    )
  }
</script>
