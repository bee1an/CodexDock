import { createHash, randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import { promises as fs } from 'node:fs'

import type { CodexPlatformAdapter } from '../shared/codex-platform'

export interface BackupRecord {
  file: string
  hash: string
  backupPath: string
  createdAt: string
  protected: boolean
}

export interface ConfigGuardState {
  version: 2
  hashes: Record<string, string>
  backups: BackupRecord[]
}

function emptyState(): ConfigGuardState {
  return { version: 2, hashes: {}, backups: [] }
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

export class ConfigGuard {
  private readonly stateFile: string

  constructor(
    private readonly userDataPath: string,
    private readonly platform: CodexPlatformAdapter
  ) {
    this.stateFile = join(userDataPath, 'config-guard-state.json')
  }

  async getState(): Promise<ConfigGuardState> {
    try {
      const raw = await fs.readFile(this.stateFile, 'utf8')
      const parsed = JSON.parse(raw)
      if (parsed?.version === 2) {
        return {
          version: 2,
          hashes: parsed.hashes ?? {},
          backups: parsed.backups ?? []
        } as ConfigGuardState
      }
      return emptyState()
    } catch {
      return emptyState()
    }
  }

  async guardBeforeWrite(filePath: string, opts?: { sensitive?: boolean }): Promise<void> {
    const content = await this.readOptionalFile(filePath)
    const state = await this.getState()

    if (content === null) {
      if (!state.hashes[filePath]) {
        state.hashes[filePath] = ''
      }
      await this.writeState(state)
      return
    }

    const currentHash = sha256(content)
    const lastKnown = state.hashes[filePath]

    if (lastKnown === currentHash) {
      return
    }

    await this.ensureBackupRecord(state, filePath, content, opts)

    state.hashes[filePath] = currentHash
    await this.writeState(state)
  }

  async recordWriteComplete(filePath: string): Promise<void> {
    let content: string
    try {
      content = await fs.readFile(filePath, 'utf8')
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        const state = await this.getState()
        state.hashes[filePath] = ''
        await this.writeState(state)
        return
      }
      throw error
    }

    const state = await this.getState()
    state.hashes[filePath] = sha256(content)
    await this.writeState(state)
  }

  async listBackups(filePath?: string): Promise<BackupRecord[]> {
    const state = await this.getState()
    if (filePath) {
      return state.backups.filter((b) => b.file === filePath)
    }
    return state.backups
  }

  private async writeState(state: ConfigGuardState): Promise<void> {
    await fs.mkdir(this.userDataPath, { recursive: true })
    await this.atomicWrite(this.stateFile, JSON.stringify(state, null, 2) + '\n')
  }

  private async readOptionalFile(filePath: string): Promise<string | null> {
    try {
      return await fs.readFile(filePath, 'utf8')
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      return null
    }
  }

  private async ensureBackupRecord(
    state: ConfigGuardState,
    filePath: string,
    content: string,
    opts?: { sensitive?: boolean }
  ): Promise<void> {
    const currentHash = sha256(content)
    const backupDir = this.backupDirFor(filePath)
    const staleCurrentBackupPaths: string[] = []
    for (const backup of state.backups) {
      if (
        backup.file === filePath &&
        backup.hash === currentHash &&
        dirname(backup.backupPath) === backupDir
      ) {
        if (await this.fileExists(backup.backupPath)) {
          return
        }
        staleCurrentBackupPaths.push(backup.backupPath)
      }
    }

    if (staleCurrentBackupPaths.length) {
      const stalePaths = new Set(staleCurrentBackupPaths)
      state.backups = state.backups.filter((backup) => !stalePaths.has(backup.backupPath))
    }

    const ts = Date.now()
    const base = basename(filePath)
    const sensitive = opts?.sensitive ?? false
    const ext = sensitive ? '.bak.enc' : '.bak'
    const backupFileName = `${base}-${currentHash.slice(0, 8)}-${ts}${ext}`
    const backupPath = join(this.backupDirFor(filePath), backupFileName)

    if (sensitive) {
      const payload = this.platform.protect(content)
      await this.atomicWrite(backupPath, JSON.stringify(payload))
    } else {
      await this.atomicWrite(backupPath, content)
    }

    state.backups.push({
      file: filePath,
      hash: currentHash,
      backupPath,
      createdAt: new Date(ts).toISOString(),
      protected: sensitive
    })
  }

  private backupDirFor(filePath: string): string {
    return join(dirname(filePath), 'config-backups')
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  }

  private async atomicWrite(filePath: string, content: string): Promise<void> {
    const tmpFile = `${filePath}.${process.pid}.${randomUUID()}.tmp`
    try {
      await fs.mkdir(dirname(filePath), { recursive: true })
      await fs.writeFile(tmpFile, content, 'utf8')
      await fs.rename(tmpFile, filePath)
    } finally {
      await fs.rm(tmpFile, { force: true })
    }
  }
}
