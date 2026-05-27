import { spawn } from 'node:child_process'
import { constants, promises as fsp } from 'node:fs'
import path from 'node:path'

import type { UpgradeProgressEvent } from '../shared/codex'

const DEFAULT_BREW_BINARY_CANDIDATES = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew']

export interface HomebrewUpgradeRunResult {
  success: boolean
  exitCode: number | null
  command?: string
  errorMessage?: string
}

export type HomebrewUpgradeEmit = (event: UpgradeProgressEvent) => void

export interface RunHomebrewCaskUpgradeOptions {
  brewBinaryCandidates?: readonly string[]
  caskToken?: string
  logFilePath: string
  emit: HomebrewUpgradeEmit
  /**
   * Called once after `brew fetch` completes successfully and before `brew upgrade`
   * runs. The runner awaits the returned promise so the caller can flush the UI
   * (e.g., wait for the renderer to acknowledge the install phase) before the
   * destructive step.
   */
  beforeInstall?: () => Promise<void>
  spawnImpl?: typeof spawn
  appendLog?: (line: string) => void | Promise<void>
}

export interface IsHomebrewCaskInstalledOptions {
  brewBinaryCandidates?: readonly string[]
  caskToken?: string
  spawnImpl?: typeof spawn
}

async function resolveExecutable(candidates: readonly string[]): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      await fsp.access(candidate, constants.X_OK)
      return candidate
    } catch {
      continue
    }
  }

  return null
}

function waitForExitCode(
  command: string,
  args: readonly string[],
  spawnImpl: typeof spawn = spawn
): Promise<number | null> {
  return new Promise<number | null>((resolve) => {
    const child = spawnImpl(command, [...args], {
      stdio: 'ignore'
    })

    child.once('error', () => resolve(null))
    child.once('close', (code) => resolve(code))
  })
}

export async function isHomebrewCaskInstalled(
  options?: IsHomebrewCaskInstalledOptions
): Promise<boolean> {
  const brewBinary = await resolveExecutable(
    options?.brewBinaryCandidates ?? DEFAULT_BREW_BINARY_CANDIDATES
  )
  if (!brewBinary) {
    return false
  }

  const exitCode = await waitForExitCode(
    brewBinary,
    ['list', '--cask', options?.caskToken ?? 'codexdock'],
    options?.spawnImpl
  )
  return exitCode === 0
}

interface SpawnStreamResult {
  exitCode: number | null
  /** Either 'spawn-error' or undefined */
  spawnError?: Error
}

function streamCommand(
  command: string,
  args: readonly string[],
  options: {
    emit: HomebrewUpgradeEmit
    appendLog?: (line: string) => void | Promise<void>
    spawnImpl: typeof spawn
    env?: NodeJS.ProcessEnv
  }
): Promise<SpawnStreamResult> {
  return new Promise<SpawnStreamResult>((resolve) => {
    const child = options.spawnImpl(command, [...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: options.env
    })

    let stdoutBuffer = ''
    let stderrBuffer = ''

    const handleLine = (line: string): void => {
      if (!line) {
        return
      }
      options.emit({ kind: 'log', text: line })
      void Promise.resolve(options.appendLog?.(line)).catch(() => undefined)
    }

    const flushBuffer = (which: 'stdout' | 'stderr'): void => {
      const remaining = which === 'stdout' ? stdoutBuffer : stderrBuffer
      if (remaining) {
        handleLine(remaining)
      }
      if (which === 'stdout') {
        stdoutBuffer = ''
      } else {
        stderrBuffer = ''
      }
    }

    const consumeChunk = (which: 'stdout' | 'stderr', chunk: Buffer | string): void => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      const buffer = which === 'stdout' ? stdoutBuffer + text : stderrBuffer + text
      const lines = buffer.split(/\r?\n/)
      const remainder = lines.pop() ?? ''
      if (which === 'stdout') {
        stdoutBuffer = remainder
      } else {
        stderrBuffer = remainder
      }
      for (const line of lines) {
        if (line.length > 0) {
          handleLine(line)
        }
      }
    }

    child.stdout?.on('data', (chunk) => consumeChunk('stdout', chunk))
    child.stderr?.on('data', (chunk) => consumeChunk('stderr', chunk))

    child.once('error', (error) => {
      flushBuffer('stdout')
      flushBuffer('stderr')
      resolve({ exitCode: null, spawnError: error })
    })

    child.once('close', (code) => {
      flushBuffer('stdout')
      flushBuffer('stderr')
      resolve({ exitCode: code })
    })
  })
}

function describeCommand(binary: string, args: readonly string[]): string {
  return [binary, ...args].join(' ')
}

export async function runHomebrewCaskUpgrade(
  options: RunHomebrewCaskUpgradeOptions
): Promise<HomebrewUpgradeRunResult> {
  const spawnImpl = options.spawnImpl ?? spawn
  const brewBinary = await resolveExecutable(
    options.brewBinaryCandidates ?? DEFAULT_BREW_BINARY_CANDIDATES
  )
  const caskToken = options.caskToken?.trim() || 'codexdock'

  if (!brewBinary) {
    const message = 'Homebrew is not installed on this Mac.'
    options.emit({ kind: 'error', message })
    return {
      success: false,
      exitCode: null,
      errorMessage: message
    }
  }

  const sharedEnv: NodeJS.ProcessEnv = {
    ...process.env,
    HOMEBREW_NO_ANALYTICS: '1'
  }

  options.emit({ kind: 'phase', phase: 'download' })

  const updateCommand = describeCommand(brewBinary, ['update'])
  options.emit({ kind: 'log', text: `$ ${updateCommand}` })
  void Promise.resolve(options.appendLog?.(`$ ${updateCommand}`)).catch(() => undefined)
  const updateResult = await streamCommand(brewBinary, ['update'], {
    emit: options.emit,
    appendLog: options.appendLog,
    spawnImpl,
    env: sharedEnv
  })

  if (updateResult.spawnError || updateResult.exitCode !== 0) {
    const message =
      updateResult.spawnError?.message ??
      `brew update failed with exit code ${updateResult.exitCode ?? 'unknown'}.`
    options.emit({ kind: 'error', message })
    options.emit({ kind: 'phase', phase: 'error', message })
    return {
      success: false,
      exitCode: updateResult.exitCode ?? null,
      command: updateCommand,
      errorMessage: message
    }
  }

  const fetchArgs = ['fetch', '--cask', caskToken]
  const fetchCommand = describeCommand(brewBinary, fetchArgs)
  options.emit({ kind: 'log', text: `$ ${fetchCommand}` })
  void Promise.resolve(options.appendLog?.(`$ ${fetchCommand}`)).catch(() => undefined)
  const fetchResult = await streamCommand(brewBinary, fetchArgs, {
    emit: options.emit,
    appendLog: options.appendLog,
    spawnImpl,
    env: sharedEnv
  })

  if (fetchResult.spawnError || fetchResult.exitCode !== 0) {
    const message =
      fetchResult.spawnError?.message ??
      `brew fetch failed with exit code ${fetchResult.exitCode ?? 'unknown'}.`
    options.emit({ kind: 'error', message })
    options.emit({ kind: 'phase', phase: 'error', message })
    return {
      success: false,
      exitCode: fetchResult.exitCode ?? null,
      command: fetchCommand,
      errorMessage: message
    }
  }

  options.emit({ kind: 'phase', phase: 'install' })

  if (options.beforeInstall) {
    try {
      await options.beforeInstall()
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to prepare the install phase.'
      options.emit({ kind: 'error', message })
      options.emit({ kind: 'phase', phase: 'error', message })
      return {
        success: false,
        exitCode: null,
        errorMessage: message
      }
    }
  }

  const upgradeArgs = ['upgrade', '--cask', caskToken]
  const upgradeCommand = describeCommand(brewBinary, upgradeArgs)
  options.emit({ kind: 'log', text: `$ ${upgradeCommand}` })
  void Promise.resolve(options.appendLog?.(`$ ${upgradeCommand}`)).catch(() => undefined)
  const upgradeResult = await streamCommand(brewBinary, upgradeArgs, {
    emit: options.emit,
    appendLog: options.appendLog,
    spawnImpl,
    env: sharedEnv
  })

  if (upgradeResult.spawnError || upgradeResult.exitCode !== 0) {
    const message =
      upgradeResult.spawnError?.message ??
      `brew upgrade failed with exit code ${upgradeResult.exitCode ?? 'unknown'}.`
    options.emit({ kind: 'error', message })
    options.emit({ kind: 'phase', phase: 'error', message })
    return {
      success: false,
      exitCode: upgradeResult.exitCode ?? null,
      command: upgradeCommand,
      errorMessage: message
    }
  }

  options.emit({ kind: 'phase', phase: 'success' })
  return {
    success: true,
    exitCode: 0,
    command: upgradeCommand
  }
}

export async function ensureLogDir(logFilePath: string): Promise<void> {
  await fsp.mkdir(path.dirname(logFilePath), { recursive: true })
}

export async function appendLogLine(logFilePath: string, line: string): Promise<void> {
  const timestamp = new Date().toISOString()
  await fsp.appendFile(logFilePath, `[${timestamp}] ${line}\n`, 'utf8')
}
