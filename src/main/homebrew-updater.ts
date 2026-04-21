import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const DEFAULT_BREW_BINARY_CANDIDATES = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew']

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

async function resolveExecutable(candidates: readonly string[]): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch {
      continue
    }
  }

  return null
}

async function waitForExitCode(command: string, args: readonly string[]): Promise<number | null> {
  return await new Promise<number | null>((resolve) => {
    const child = spawn(command, [...args], {
      stdio: 'ignore'
    })

    child.once('error', () => resolve(null))
    child.once('close', (code) => resolve(code))
  })
}

function resolveAppBundlePath(executablePath: string): string {
  return path.resolve(executablePath, '..', '..', '..')
}

export async function isHomebrewCaskInstalled(options?: {
  brewBinaryCandidates?: readonly string[]
  caskToken?: string
}): Promise<boolean> {
  const brewBinary = await resolveExecutable(
    options?.brewBinaryCandidates ?? DEFAULT_BREW_BINARY_CANDIDATES
  )
  if (!brewBinary) {
    return false
  }

  const exitCode = await waitForExitCode(brewBinary, [
    'list',
    '--cask',
    options?.caskToken ?? 'ilovecodex'
  ])
  return exitCode === 0
}

export async function launchHomebrewCaskUpgrade(options?: {
  appName?: string
  appBundlePath?: string
  brewBinaryCandidates?: readonly string[]
  caskToken?: string
  executablePath?: string
  logFilePath?: string
}): Promise<void> {
  const brewBinary = await resolveExecutable(
    options?.brewBinaryCandidates ?? DEFAULT_BREW_BINARY_CANDIDATES
  )
  if (!brewBinary) {
    throw new Error('Homebrew is not installed on this Mac.')
  }

  const caskToken = options?.caskToken?.trim() || 'ilovecodex'
  const appName = options?.appName?.trim() || 'Ilovecodex'
  const appBundlePath =
    options?.appBundlePath?.trim() ||
    resolveAppBundlePath(options?.executablePath?.trim() || process.execPath)
  const logFilePath =
    options?.logFilePath?.trim() || path.join(tmpdir(), `${caskToken}-homebrew-update.log`)

  const script = [
    `exec >>${shellQuote(logFilePath)} 2>&1`,
    `echo "[${new Date().toISOString()}] Starting Homebrew update for ${caskToken}"`,
    `${shellQuote(brewBinary)} update`,
    `${shellQuote(brewBinary)} upgrade --cask ${shellQuote(caskToken)}`,
    'status=$?',
    'echo "[homebrew-updater] exit status: ${status}"',
    'if [ "$status" -eq 0 ]; then',
    `  /usr/bin/open ${shellQuote(appBundlePath)} >/dev/null 2>&1 || /usr/bin/open -a ${shellQuote(appName)} >/dev/null 2>&1 || true`,
    'fi',
    'exit "$status"'
  ].join('\n')

  const child = spawn('/bin/zsh', ['-lc', script], {
    detached: true,
    stdio: 'ignore'
  })
  child.unref()
}
