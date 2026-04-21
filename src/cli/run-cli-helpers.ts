import type {
  AccountTag,
  AccountSummary,
  AppSnapshot,
  CliLoginResult,
  CodexInstanceSummary,
  LoginEvent
} from '../shared/codex'
import type { CodexPlatformAdapter } from '../shared/codex-platform'
import type { CodexServices } from '../main/codex-services'
import { CliError, EXIT_ENVIRONMENT, EXIT_FAILURE, EXIT_USAGE } from './cli-errors'
import type { CliFlags } from './cli-parsing'

const DEFAULT_INSTANCE_ID = '__default__'

interface CliRuntime {
  services: CodexServices
  platform: Pick<CodexPlatformAdapter, 'openExternal'>
  subscribeLoginEvents(listener: (event: LoginEvent) => void): () => void
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []

  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  return Buffer.concat(chunks).toString('utf8')
}

function parseJsonMaybe<T>(raw: string): T | string {
  try {
    return JSON.parse(raw) as T
  } catch {
    return raw
  }
}

function normalizeInstanceId(value: string): string {
  return value === 'default' ? DEFAULT_INSTANCE_ID : value
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

function getSnapshotInstance(snapshot: AppSnapshot, instanceId: string): CodexInstanceSummary {
  const resolvedInstanceId = normalizeInstanceId(instanceId)
  const instance = snapshot.codexInstances.find((item) => item.id === resolvedInstanceId)
  if (!instance) {
    throw new CliError(`Unknown instance-id: ${instanceId}`, EXIT_USAGE)
  }

  return instance
}

export type { CliRuntime }
export {
  DEFAULT_INSTANCE_ID,
  readStdin,
  parseJsonMaybe,
  normalizeInstanceId,
  waitForLoginResult,
  getSnapshotAccount,
  getSnapshotTag,
  getSnapshotInstance
}
