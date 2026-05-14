import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { promises as fs } from 'node:fs'

import type { ProtectedPayload, CodexPlatformAdapter } from '../shared/codex-platform'

export interface ProviderOverrideState {
  version: 1
  activeOverride: {
    providerId: string
    appliedAt: string
  } | null
  baseline: {
    capturedAt: string
    configToml: string | null
    authJson: ProtectedPayload | null
  } | null
}

function emptyState(): ProviderOverrideState {
  return { version: 1, activeOverride: null, baseline: null }
}

export class DefaultConfigBackupManager {
  constructor(
    private readonly stateFile: string,
    private readonly defaultCodexHome: string,
    private readonly platform: CodexPlatformAdapter
  ) {}

  async getState(): Promise<ProviderOverrideState> {
    try {
      const raw = await fs.readFile(this.stateFile, 'utf8')
      return JSON.parse(raw) as ProviderOverrideState
    } catch {
      return emptyState()
    }
  }

  async isOverrideActive(): Promise<boolean> {
    const state = await this.getState()
    return state.activeOverride !== null
  }

  async captureBaselineIfNeeded(): Promise<void> {
    const state = await this.getState()
    if (state.baseline) {
      return
    }

    const configPath = join(this.defaultCodexHome, 'config.toml')
    const authPath = join(this.defaultCodexHome, 'auth.json')

    let configToml: string | null = null
    try {
      configToml = await fs.readFile(configPath, 'utf8')
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }

    let authJsonRaw: string | null = null
    try {
      authJsonRaw = await fs.readFile(authPath, 'utf8')
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }

    state.baseline = {
      capturedAt: new Date().toISOString(),
      configToml,
      authJson: authJsonRaw ? this.platform.protect(authJsonRaw) : null
    }

    await this.writeState(state)
  }

  async markOverrideActive(providerId: string): Promise<void> {
    const state = await this.getState()
    state.activeOverride = {
      providerId,
      appliedAt: new Date().toISOString()
    }
    await this.writeState(state)
  }

  async restoreBaseline(): Promise<void> {
    const state = await this.getState()
    if (!state.baseline) {
      state.activeOverride = null
      await this.writeState(state)
      return
    }

    const configPath = join(this.defaultCodexHome, 'config.toml')
    const authPath = join(this.defaultCodexHome, 'auth.json')

    await fs.mkdir(this.defaultCodexHome, { recursive: true })

    if (state.baseline.configToml !== null) {
      await this.atomicWrite(configPath, state.baseline.configToml)
    } else {
      await fs.rm(configPath, { force: true })
    }

    if (state.baseline.authJson !== null) {
      const authContent = this.platform.unprotect(state.baseline.authJson)
      await this.atomicWrite(authPath, authContent)
    } else {
      await fs.rm(authPath, { force: true })
    }

    state.activeOverride = null
    state.baseline = null
    await this.writeState(state)
  }

  async clearState(): Promise<void> {
    await this.writeState(emptyState())
  }

  private async writeState(state: ProviderOverrideState): Promise<void> {
    const raw = JSON.stringify(state, null, 2) + '\n'
    const tmpFile = `${this.stateFile}.${process.pid}.${randomUUID()}.tmp`
    await fs.writeFile(tmpFile, raw, 'utf8')
    await fs.rename(tmpFile, this.stateFile)
  }

  private async atomicWrite(filePath: string, content: string): Promise<void> {
    const tmpFile = `${filePath}.${process.pid}.${randomUUID()}.tmp`
    await fs.writeFile(tmpFile, content, 'utf8')
    await fs.rename(tmpFile, filePath)
  }
}
