import type {
  AccountTag,
  AccountSummary,
  AppSettings,
  AppSnapshot,
  CliAccountListPayload,
  CliLoginResult,
  CliResult,
  LoginEvent,
  UpdateCustomProviderInput
} from '../shared/codex'
import type { CodexPlatformAdapter } from '../shared/codex-platform'
import type { CodexServices } from '../main/codex-services'
import { CliError, EXIT_ENVIRONMENT, EXIT_FAILURE, EXIT_OK, EXIT_USAGE } from './cli-errors'
import {
  ensureSettingsKey,
  parseFlags,
  parseProviderOptions,
  parseSettingsValue,
  type CliFlags
} from './cli-parsing'
import {
  accountLabel,
  printAccountList,
  printHelp,
  printIfNeeded,
  printProviders,
  printSettings,
  printTags,
  printUsage,
  providerLabel,
  sessionLabel,
  tagLabel,
  toCliResult
} from './cli-output'

interface CliRuntime {
  services: CodexServices
  platform: Pick<CodexPlatformAdapter, 'openExternal'>
  subscribeLoginEvents(listener: (event: LoginEvent) => void): () => void
}

async function waitForLoginResult(
  runtime: CliRuntime,
  attemptId: string,
  flags: CliFlags,
  method: 'browser' | 'device',
  initialEvents: LoginEvent[] = []
): Promise<CliLoginResult> {
  let opened = false

  return new Promise<CliLoginResult>((resolve, reject) => {
    const handleEvent = (event: LoginEvent): void => {
      if (event.attemptId !== attemptId) {
        return
      }

      if (!flags.json && !flags.quiet) {
        console.log(event.message)
        if (event.authUrl) {
          console.log(`Auth URL: ${event.authUrl}`)
        }
        if (event.localCallbackUrl) {
          console.log(`Callback URL: ${event.localCallbackUrl}`)
        }
        if (event.verificationUrl) {
          console.log(`Verification URL: ${event.verificationUrl}`)
        }
        if (event.userCode) {
          console.log(`User code: ${event.userCode}`)
        }
      }

      if (
        method === 'browser' &&
        flags.openBrowser &&
        event.phase === 'waiting' &&
        event.authUrl &&
        !opened
      ) {
        opened = true
        void runtime.platform.openExternal(event.authUrl).catch((error) => {
          if (!flags.quiet) {
            console.error(
              `Failed to open browser automatically: ${error instanceof Error ? error.message : 'unknown error'}`
            )
          }
        })
      }

      if (!['success', 'error', 'cancelled'].includes(event.phase)) {
        return
      }

      unsubscribe()

      if (event.phase === 'success') {
        resolve({
          attemptId,
          method,
          phase: event.phase,
          snapshot: event.snapshot ?? null
        })
        return
      }

      reject(
        new CliError(
          event.message,
          event.message.includes('占用') || event.message.includes('Missing')
            ? EXIT_ENVIRONMENT
            : EXIT_FAILURE
        )
      )
    }

    const unsubscribe = runtime.subscribeLoginEvents(handleEvent)

    if (flags.timeoutSeconds) {
      const timer = setTimeout(() => {
        unsubscribe()
        reject(
          new CliError(`Command timed out after ${flags.timeoutSeconds} seconds`, EXIT_FAILURE)
        )
      }, flags.timeoutSeconds * 1000)

      const stop = runtime.subscribeLoginEvents((event) => {
        if (
          event.attemptId === attemptId &&
          ['success', 'error', 'cancelled'].includes(event.phase)
        ) {
          clearTimeout(timer)
          stop()
        }
      })
    }

    for (const event of initialEvents) {
      handleEvent(event)
    }
  })
}

function getSnapshotAccount(snapshot: AppSnapshot, accountId: string): AccountSummary {
  const account = snapshot.accounts.find((item) => item.id === accountId)
  if (!account) {
    throw new CliError(`Unknown account-id: ${accountId}`, EXIT_USAGE)
  }

  return account
}

function getSnapshotTag(snapshot: AppSnapshot, tagId: string): AccountTag {
  const tag = snapshot.tags.find((item) => item.id === tagId)
  if (!tag) {
    throw new CliError(`Unknown tag-id: ${tagId}`, EXIT_USAGE)
  }

  return tag
}

async function execute(
  runtime: CliRuntime,
  argv: string[]
): Promise<{ code: number; payload?: CliResult<unknown> }> {
  const { flags, positionals } = parseFlags(argv)
  const silent = flags.quiet || flags.json

  if (flags.help || !positionals.length) {
    printHelp()
    return { code: EXIT_OK }
  }

  const [command, subcommand, ...rest] = positionals

  switch (command) {
    case 'account': {
      switch (subcommand) {
        case 'list': {
          const snapshot = await runtime.services.accounts.list()
          const payload: CliAccountListPayload = {
            accounts: snapshot.accounts,
            activeAccountId: snapshot.activeAccountId,
            currentSession: snapshot.currentSession
          }
          printAccountList(payload, silent)
          return { code: EXIT_OK, payload: toCliResult(payload) }
        }
        case 'import-current': {
          const snapshot = await runtime.services.accounts.importCurrent()
          const active = snapshot.accounts.find(
            (account) => account.id === snapshot.activeAccountId
          )
          printIfNeeded(`Imported current Codex account: ${accountLabel(active)}`, silent)
          return { code: EXIT_OK, payload: toCliResult(snapshot) }
        }
        case 'activate': {
          const accountId = rest[0]
          if (!accountId) {
            throw new CliError('Missing account-id', EXIT_USAGE)
          }
          const snapshot = await runtime.services.accounts.activate(accountId)
          const active = snapshot.accounts.find(
            (account) => account.id === snapshot.activeAccountId
          )
          printIfNeeded(`Activated account: ${accountLabel(active)}`, silent)
          return { code: EXIT_OK, payload: toCliResult(snapshot) }
        }
        case 'best': {
          const snapshot = await runtime.services.accounts.activateBest()
          const active = snapshot.accounts.find(
            (account) => account.id === snapshot.activeAccountId
          )
          printIfNeeded(`Best account active: ${accountLabel(active)}`, silent)
          return { code: EXIT_OK, payload: toCliResult(snapshot) }
        }
        case 'remove': {
          const accountId = rest[0]
          if (!accountId) {
            throw new CliError('Missing account-id', EXIT_USAGE)
          }
          const snapshot = await runtime.services.accounts.remove(accountId)
          printIfNeeded(`Removed account: ${accountId}`, silent)
          return { code: EXIT_OK, payload: toCliResult(snapshot) }
        }
        default:
          throw new CliError('Unknown account command', EXIT_USAGE)
      }
    }
    case 'provider': {
      switch (subcommand) {
        case 'list': {
          const providers = await runtime.services.providers.list()
          printProviders(providers, silent)
          return { code: EXIT_OK, payload: toCliResult(providers) }
        }
        case 'create': {
          const { input } = parseProviderOptions(rest)
          if (!input.baseUrl || !input.apiKey) {
            throw new CliError(
              'Usage: ilc provider create --base-url <url> --api-key <key>',
              EXIT_USAGE
            )
          }

          const snapshot = await runtime.services.providers.create({
            name: input.name,
            baseUrl: input.baseUrl,
            apiKey: input.apiKey,
            model: input.model ?? '5.4',
            fastMode: input.fastMode
          })
          const created = snapshot.providers[0] ?? null
          printIfNeeded(`Created provider: ${providerLabel(created)}`, silent)
          return { code: EXIT_OK, payload: toCliResult(snapshot) }
        }
        case 'update': {
          const { input, positionals } = parseProviderOptions(rest)
          const providerId = positionals[0]
          if (!providerId) {
            throw new CliError('Missing provider-id', EXIT_USAGE)
          }

          const updateInput: UpdateCustomProviderInput = {}
          if (input.name !== undefined) {
            updateInput.name = input.name
          }
          if (input.baseUrl !== undefined) {
            updateInput.baseUrl = input.baseUrl
          }
          if (input.apiKey !== undefined) {
            updateInput.apiKey = input.apiKey
          }
          if (input.model !== undefined) {
            updateInput.model = input.model
          }
          if (input.fastMode !== undefined) {
            updateInput.fastMode = input.fastMode
          }
          if (!Object.keys(updateInput).length) {
            throw new CliError('No provider changes provided', EXIT_USAGE)
          }

          const snapshot = await runtime.services.providers.update(providerId, updateInput)
          const updated = snapshot.providers.find((provider) => provider.id === providerId) ?? null
          printIfNeeded(`Updated provider: ${providerLabel(updated)}`, silent)
          return { code: EXIT_OK, payload: toCliResult(snapshot) }
        }
        case 'remove': {
          const providerId = rest[0]
          if (!providerId) {
            throw new CliError('Missing provider-id', EXIT_USAGE)
          }

          const snapshot = await runtime.services.providers.remove(providerId)
          printIfNeeded(`Removed provider: ${providerId}`, silent)
          return { code: EXIT_OK, payload: toCliResult(snapshot) }
        }
        case 'open': {
          const providerId = rest[0]
          if (!providerId) {
            throw new CliError('Missing provider-id', EXIT_USAGE)
          }

          const snapshot = await runtime.services.providers.open(providerId)
          printIfNeeded(`Opened provider in isolated Codex: ${providerId}`, silent)
          return { code: EXIT_OK, payload: toCliResult(snapshot) }
        }
        default:
          throw new CliError('Unknown provider command', EXIT_USAGE)
      }
    }
    case 'session': {
      if (subcommand !== 'current') {
        throw new CliError('Unknown session command', EXIT_USAGE)
      }
      const session = await runtime.services.session.current()
      printIfNeeded(`Current session: ${sessionLabel(session)}`, silent)
      return { code: EXIT_OK, payload: toCliResult(session) }
    }
    case 'tag': {
      switch (subcommand) {
        case 'list': {
          const tags = await runtime.services.tags.getAll()
          printTags(tags, silent)
          return { code: EXIT_OK, payload: toCliResult(tags) }
        }
        case 'create': {
          const name = rest.join(' ').trim()
          if (!name) {
            throw new CliError('Missing tag name', EXIT_USAGE)
          }

          const snapshot = await runtime.services.tags.create(name)
          const createdTag =
            snapshot.tags.find((tag) => tag.name === name) ?? snapshot.tags.at(-1) ?? null
          printIfNeeded(`Created tag: ${tagLabel(createdTag)}`, silent)
          return { code: EXIT_OK, payload: toCliResult(snapshot) }
        }
        case 'rename': {
          const tagId = rest[0]
          const name = rest.slice(1).join(' ').trim()
          if (!tagId) {
            throw new CliError('Missing tag-id', EXIT_USAGE)
          }
          if (!name) {
            throw new CliError('Missing tag name', EXIT_USAGE)
          }

          const snapshot = await runtime.services.tags.update(tagId, name)
          const updatedTag = getSnapshotTag(snapshot, tagId)
          printIfNeeded(`Renamed tag: ${tagLabel(updatedTag)}`, silent)
          return { code: EXIT_OK, payload: toCliResult(snapshot) }
        }
        case 'remove': {
          const tagId = rest[0]
          if (!tagId) {
            throw new CliError('Missing tag-id', EXIT_USAGE)
          }

          const snapshot = await runtime.services.accounts.list()
          const tag = getSnapshotTag(snapshot, tagId)
          const updatedSnapshot = await runtime.services.tags.remove(tagId)
          printIfNeeded(`Removed tag: ${tagLabel(tag)}`, silent)
          return { code: EXIT_OK, payload: toCliResult(updatedSnapshot) }
        }
        case 'assign':
        case 'unassign': {
          const accountId = rest[0]
          const tagId = rest[1]
          if (!accountId) {
            throw new CliError('Missing account-id', EXIT_USAGE)
          }
          if (!tagId) {
            throw new CliError('Missing tag-id', EXIT_USAGE)
          }

          const snapshot = await runtime.services.accounts.list()
          const account = getSnapshotAccount(snapshot, accountId)
          const tag = getSnapshotTag(snapshot, tagId)
          const hasTag = account.tagIds.includes(tagId)
          const nextTagIds =
            subcommand === 'assign'
              ? hasTag
                ? account.tagIds
                : [...account.tagIds, tagId]
              : account.tagIds.filter((id) => id !== tagId)

          if (subcommand === 'assign' && hasTag) {
            printIfNeeded(
              `Tag already assigned: ${tagLabel(tag)} -> ${accountLabel(account)}`,
              silent
            )
            return { code: EXIT_OK, payload: toCliResult(snapshot) }
          }

          if (subcommand === 'unassign' && nextTagIds.length === account.tagIds.length) {
            printIfNeeded(
              `Tag already removed: ${tagLabel(tag)} -> ${accountLabel(account)}`,
              silent
            )
            return { code: EXIT_OK, payload: toCliResult(snapshot) }
          }

          const updatedSnapshot = await runtime.services.accounts.updateTags(accountId, nextTagIds)
          printIfNeeded(
            `${
              subcommand === 'assign' ? 'Assigned' : 'Removed'
            } tag: ${tagLabel(tag)} ${subcommand === 'assign' ? '->' : '<-'} ${accountLabel(account)}`,
            silent
          )
          return { code: EXIT_OK, payload: toCliResult(updatedSnapshot) }
        }
        default:
          throw new CliError('Unknown tag command', EXIT_USAGE)
      }
    }
    case 'usage': {
      if (subcommand !== 'read') {
        throw new CliError('Unknown usage command', EXIT_USAGE)
      }
      const rateLimits = await runtime.services.usage.read(rest[0])
      printUsage(rateLimits, silent)
      return { code: EXIT_OK, payload: toCliResult(rateLimits) }
    }
    case 'login': {
      if (subcommand === 'port') {
        switch (rest[0]) {
          case 'status': {
            const occupant = await runtime.services.login.getPortOccupant()
            printIfNeeded(
              occupant
                ? `1455 occupied by ${occupant.command} (${occupant.pid})`
                : '1455 is available',
              silent
            )
            return { code: EXIT_OK, payload: toCliResult(occupant) }
          }
          case 'kill': {
            const occupant = await runtime.services.login.killPortOccupant()
            printIfNeeded(
              occupant
                ? `Stopped ${occupant.command} (${occupant.pid})`
                : 'No process was listening on 1455',
              silent
            )
            return { code: EXIT_OK, payload: toCliResult(occupant) }
          }
          default:
            throw new CliError('Unknown login port command', EXIT_USAGE)
        }
      }

      if (subcommand !== 'browser' && subcommand !== 'device') {
        throw new CliError('Unknown login command', EXIT_USAGE)
      }

      const initialEvents: LoginEvent[] = []
      const stopBuffering = runtime.subscribeLoginEvents((event) => {
        initialEvents.push(event)
      })
      const attempt = await runtime.services.login.start(subcommand)
      stopBuffering()
      const result = await waitForLoginResult(
        runtime,
        attempt.attemptId,
        flags,
        subcommand,
        initialEvents
      )
      if (!flags.json) {
        printIfNeeded(`Login finished with phase: ${result.phase}`, silent)
      }
      return { code: EXIT_OK, payload: toCliResult(result) }
    }
    case 'codex': {
      if (subcommand === 'open') {
        const snapshot = await runtime.services.codex.open(rest[0])
        const active = snapshot.accounts.find((account) => account.id === snapshot.activeAccountId)
        printIfNeeded(`Opened Codex with account: ${accountLabel(active)}`, silent)
        return { code: EXIT_OK, payload: toCliResult(snapshot) }
      }
      if (subcommand === 'open-isolated') {
        const accountId = rest[0]
        if (!accountId) {
          throw new CliError('Missing account-id', EXIT_USAGE)
        }

        const snapshot = await runtime.services.codex.openIsolated(accountId)
        printIfNeeded(`Opened isolated Codex session for account: ${accountId}`, silent)
        return { code: EXIT_OK, payload: toCliResult(snapshot) }
      }
      throw new CliError('Unknown codex command', EXIT_USAGE)
    }
    case 'settings': {
      switch (subcommand) {
        case 'get': {
          const settings = await runtime.services.settings.get()
          const key = rest[0]
          if (!key) {
            printSettings(settings, silent)
            return { code: EXIT_OK, payload: toCliResult(settings) }
          }

          const settingKey = ensureSettingsKey(key)
          if (!silent) {
            const value = settings[settingKey]
            console.log(Array.isArray(value) ? value.join(',') : value)
          }
          return { code: EXIT_OK, payload: toCliResult(settings[settingKey]) }
        }
        case 'set': {
          const key = rest[0]
          const rawValue = rest[1]
          if (!key || rawValue == null) {
            throw new CliError('Usage: ilc settings set <key> <value>', EXIT_USAGE)
          }

          const settingKey = ensureSettingsKey(key)
          const nextValue = parseSettingsValue(settingKey, rawValue)
          const snapshot = await runtime.services.settings.update({
            [settingKey]: nextValue
          } as Partial<AppSettings>)
          printSettings(snapshot.settings, silent)
          return { code: EXIT_OK, payload: toCliResult(snapshot.settings) }
        }
        default:
          throw new CliError('Unknown settings command', EXIT_USAGE)
      }
    }
    default:
      throw new CliError(`Unknown command: ${command}`, EXIT_USAGE)
  }
}

export async function runCli(runtime: CliRuntime, argv: string[]): Promise<number> {
  try {
    const result = await execute(runtime, argv)
    if (result.payload && argv.includes('--json')) {
      console.log(JSON.stringify(result.payload))
    }
    return result.code
  } catch (error) {
    const resolved =
      error instanceof CliError
        ? error
        : new CliError(error instanceof Error ? error.message : 'Command failed', EXIT_FAILURE)

    if (argv.includes('--json')) {
      console.log(
        JSON.stringify({
          ok: false,
          data: null,
          error: {
            code: resolved.code,
            message: resolved.message
          }
        } satisfies CliResult<never>)
      )
    } else {
      console.error(resolved.message)
    }
    return resolved.code
  }
}
