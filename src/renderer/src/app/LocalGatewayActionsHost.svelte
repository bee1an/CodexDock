<script lang="ts">
  import type { AppSnapshot, LocalGatewayModelMapping, PortOccupant } from '../../../shared/codex'
  import type { LocalizedCopy } from '$lib/view/app-view'

  type RunAction = (key: string, task: () => Promise<AppSnapshot>) => Promise<void>

  export let snapshot: AppSnapshot
  export let copy: LocalizedCopy
  export let runAction: RunAction
  export let applySnapshot: (snapshot: AppSnapshot) => void
  export let setPageError: (message: string) => void
  export let localizeKnownError: (error: unknown, fallback: string) => string
  export let localGatewayBusy = false
  export let localGatewayApiKey = ''
  export let localGatewayPortOccupant: PortOccupant | null = null
  export let killingLocalGatewayPortOccupant = false

  const localGatewayPort = (): number => snapshot.settings.localGateway?.port ?? 11456

  const hasLocalGatewayPortConflictMessage = (message: string): boolean => {
    const normalizedMessage = message.toLowerCase()
    const port = String(localGatewayPort())
    return (
      (normalizedMessage.includes(port) ||
        normalizedMessage.includes('local gateway') ||
        normalizedMessage.includes('本地')) &&
      (normalizedMessage.includes('eaddrinuse') ||
        normalizedMessage.includes('address already in use') ||
        normalizedMessage.includes('占用') ||
        normalizedMessage.includes('in use'))
    )
  }

  const refreshLocalGatewayPortOccupant = async (): Promise<void> => {
    localGatewayPortOccupant = await window.codexApp.getLocalGatewayPortOccupant()
  }

  const runLocalGatewayAction = async (task: () => Promise<void>): Promise<void> => {
    if (localGatewayBusy) {
      return
    }

    localGatewayBusy = true
    try {
      await task()
    } finally {
      localGatewayBusy = false
    }
  }

  export const startLocalGateway = async (): Promise<void> =>
    runLocalGatewayAction(async () => {
      setPageError('')
      localGatewayPortOccupant = null
      try {
        applySnapshot(await window.codexApp.startLocalGateway())
      } catch (error) {
        const message = localizeKnownError(error, copy.actionFailed)
        setPageError(message)
        if (hasLocalGatewayPortConflictMessage(message)) {
          await refreshLocalGatewayPortOccupant()
        }
      }
    })

  export const stopLocalGateway = async (): Promise<void> =>
    runLocalGatewayAction(async () => {
      await runAction('gateway:stop', () => window.codexApp.stopLocalGateway())
    })

  export const rotateLocalGatewayKey = async (): Promise<void> =>
    runLocalGatewayAction(async () => {
      setPageError('')
      try {
        const result = await window.codexApp.rotateLocalGatewayKey()
        localGatewayApiKey = result.apiKey
        await navigator.clipboard.writeText(result.apiKey)
        applySnapshot(await window.codexApp.getSnapshot())
      } catch (error) {
        setPageError(localizeKnownError(error, copy.actionFailed))
      }
    })

  export const openLocalGatewayInCodex = async (): Promise<void> =>
    runLocalGatewayAction(async () => {
      await runAction('gateway:open-codex', () => window.codexApp.openLocalGatewayInCodex())
    })

  export const openLocalGatewayIsolatedInCodex = async (): Promise<void> =>
    runLocalGatewayAction(async () => {
      await runAction('gateway:open-codex-isolated', () =>
        window.codexApp.openLocalGatewayIsolatedInCodex()
      )
    })

  export const updateLocalGatewayModelMappings = async (
    mappings: LocalGatewayModelMapping[]
  ): Promise<void> => {
    const currentGateway = snapshot.settings.localGateway
    await runAction('settings:gateway-mappings', () =>
      window.codexApp.updateSettings({
        localGateway: {
          ...(currentGateway ?? {}),
          modelMappings: mappings
        }
      })
    )
  }

  export const updateLocalGatewayAllowedGroups = async (groupIds: string[]): Promise<void> => {
    const currentGateway = snapshot.settings.localGateway
    await runAction('settings:gateway-groups', () =>
      window.codexApp.updateSettings({
        localGateway: {
          ...(currentGateway ?? {}),
          allowedGroupIds: groupIds
        }
      })
    )
  }

  export const updateLocalGatewayAllowedAccounts = async (accountIds: string[]): Promise<void> => {
    const currentGateway = snapshot.settings.localGateway
    await runAction('settings:gateway-accounts', () =>
      window.codexApp.updateSettings({
        localGateway: {
          ...(currentGateway ?? {}),
          allowedAccountIds: accountIds
        }
      })
    )
  }

  export const updateLocalGatewayAllowedProviders = async (
    providerIds: string[]
  ): Promise<void> => {
    const currentGateway = snapshot.settings.localGateway
    await runAction('settings:gateway-providers', () =>
      window.codexApp.updateSettings({
        localGateway: {
          ...(currentGateway ?? {}),
          allowedProviderIds: providerIds
        }
      })
    )
  }

  export const updateLocalGatewayPort = async (port: number): Promise<void> => {
    const currentGateway = snapshot.settings.localGateway
    await runAction('settings:gateway-port', () =>
      window.codexApp.updateSettings({
        localGateway: {
          ...(currentGateway ?? {}),
          port
        }
      })
    )
  }

  export const updateLocalGatewayAutoStart = async (autoStart: boolean): Promise<void> => {
    const currentGateway = snapshot.settings.localGateway
    await runAction('settings:gateway-auto-start', () =>
      window.codexApp.updateSettings({
        localGateway: {
          ...(currentGateway ?? {}),
          autoStart
        }
      })
    )
  }

  export const updateLocalGatewayVisibleColumns = async (columns: string[]): Promise<void> => {
    const currentGateway = snapshot.settings.localGateway
    await runAction('settings:gateway-columns', () =>
      window.codexApp.updateSettings({
        localGateway: {
          ...(currentGateway ?? {}),
          visibleColumns: columns
        }
      })
    )
  }

  export const killLocalGatewayPortOccupant = async (): Promise<void> => {
    setPageError('')
    killingLocalGatewayPortOccupant = true

    try {
      localGatewayPortOccupant = await window.codexApp.killLocalGatewayPortOccupant()
      await refreshLocalGatewayPortOccupant()
    } catch (error) {
      setPageError(localizeKnownError(error, copy.killLocalGatewayPortOccupantFailed))
    } finally {
      killingLocalGatewayPortOccupant = false
    }
  }
</script>
