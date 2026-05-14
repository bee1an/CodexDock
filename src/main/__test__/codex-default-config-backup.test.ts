import { describe, it, expect, beforeEach } from 'vitest'
import { join } from 'node:path'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

import { DefaultConfigBackupManager } from '../codex-default-config-backup'
import type { CodexPlatformAdapter } from '../../shared/codex-platform'

function createTestPlatform(): CodexPlatformAdapter {
  return {
    fetch: async () => new Response(),
    protect: (value) => ({ mode: 'plain', value: Buffer.from(value, 'utf8').toString('base64') }),
    unprotect: (payload) => Buffer.from(payload.value, 'base64').toString('utf8'),
    openExternal: async () => undefined
  }
}

describe('DefaultConfigBackupManager', () => {
  let testDir: string
  let codexHome: string
  let stateFile: string
  let platform: CodexPlatformAdapter
  let manager: DefaultConfigBackupManager

  beforeEach(async () => {
    testDir = join(tmpdir(), `backup-test-${randomUUID()}`)
    codexHome = join(testDir, '.codex')
    stateFile = join(testDir, 'provider-override-state.json')
    await fs.mkdir(codexHome, { recursive: true })
    platform = createTestPlatform()
    manager = new DefaultConfigBackupManager(stateFile, codexHome, platform)
  })

  it('returns empty state when no state file exists', async () => {
    const state = await manager.getState()
    expect(state.version).toBe(1)
    expect(state.activeOverride).toBeNull()
    expect(state.baseline).toBeNull()
  })

  it('isOverrideActive returns false when no override is set', async () => {
    expect(await manager.isOverrideActive()).toBe(false)
  })

  it('captures baseline from existing config and auth files', async () => {
    await fs.writeFile(join(codexHome, 'config.toml'), 'model = "gpt-5"\n', 'utf8')
    await fs.writeFile(join(codexHome, 'auth.json'), '{"OPENAI_API_KEY":"secret"}', 'utf8')

    await manager.captureBaselineIfNeeded()

    const state = await manager.getState()
    expect(state.baseline).not.toBeNull()
    expect(state.baseline!.configToml).toBe('model = "gpt-5"\n')
    expect(state.baseline!.authJson).not.toBeNull()
    expect(platform.unprotect(state.baseline!.authJson!)).toBe('{"OPENAI_API_KEY":"secret"}')
  })

  it('captures null for missing files', async () => {
    await fs.rm(join(codexHome, 'config.toml'), { force: true })
    await fs.rm(join(codexHome, 'auth.json'), { force: true })

    await manager.captureBaselineIfNeeded()

    const state = await manager.getState()
    expect(state.baseline!.configToml).toBeNull()
    expect(state.baseline!.authJson).toBeNull()
  })

  it('captureBaselineIfNeeded is a no-op when baseline already exists', async () => {
    await fs.writeFile(join(codexHome, 'config.toml'), 'model = "gpt-5"\n', 'utf8')
    await manager.captureBaselineIfNeeded()

    await fs.writeFile(join(codexHome, 'config.toml'), 'model = "gpt-5.4"\n', 'utf8')
    await manager.captureBaselineIfNeeded()

    const state = await manager.getState()
    expect(state.baseline!.configToml).toBe('model = "gpt-5"\n')
  })

  it('markOverrideActive sets the active provider', async () => {
    await manager.markOverrideActive('provider-123')

    const state = await manager.getState()
    expect(state.activeOverride).not.toBeNull()
    expect(state.activeOverride!.providerId).toBe('provider-123')
    expect(await manager.isOverrideActive()).toBe(true)
  })

  it('restoreBaseline writes back original content', async () => {
    await fs.writeFile(join(codexHome, 'config.toml'), 'model = "gpt-5"\n', 'utf8')
    await fs.writeFile(join(codexHome, 'auth.json'), '{"OPENAI_API_KEY":"original"}', 'utf8')

    await manager.captureBaselineIfNeeded()
    await manager.markOverrideActive('provider-1')

    await fs.writeFile(join(codexHome, 'config.toml'), 'model = "overridden"\n', 'utf8')
    await fs.writeFile(join(codexHome, 'auth.json'), '{"OPENAI_API_KEY":"new-key"}', 'utf8')

    await manager.restoreBaseline()

    const config = await fs.readFile(join(codexHome, 'config.toml'), 'utf8')
    const auth = await fs.readFile(join(codexHome, 'auth.json'), 'utf8')
    expect(config).toBe('model = "gpt-5"\n')
    expect(auth).toBe('{"OPENAI_API_KEY":"original"}')
  })

  it('restoreBaseline removes files when baseline has null entries', async () => {
    await manager.captureBaselineIfNeeded()
    await manager.markOverrideActive('provider-1')

    await fs.writeFile(join(codexHome, 'config.toml'), 'model = "new"\n', 'utf8')
    await fs.writeFile(join(codexHome, 'auth.json'), '{}', 'utf8')

    await manager.restoreBaseline()

    await expect(fs.access(join(codexHome, 'config.toml'))).rejects.toThrow()
    await expect(fs.access(join(codexHome, 'auth.json'))).rejects.toThrow()
  })

  it('restoreBaseline clears activeOverride and baseline from state', async () => {
    await fs.writeFile(join(codexHome, 'config.toml'), 'model = "gpt-5"\n', 'utf8')
    await manager.captureBaselineIfNeeded()
    await manager.markOverrideActive('provider-1')

    await manager.restoreBaseline()

    const state = await manager.getState()
    expect(state.activeOverride).toBeNull()
    expect(state.baseline).toBeNull()
  })

  it('restoreBaseline with no baseline just clears activeOverride', async () => {
    await manager.markOverrideActive('provider-1')
    await manager.restoreBaseline()

    const state = await manager.getState()
    expect(state.activeOverride).toBeNull()
  })

  it('clearState resets to empty state', async () => {
    await fs.writeFile(join(codexHome, 'config.toml'), 'model = "gpt-5"\n', 'utf8')
    await manager.captureBaselineIfNeeded()
    await manager.markOverrideActive('provider-1')

    await manager.clearState()

    const state = await manager.getState()
    expect(state.activeOverride).toBeNull()
    expect(state.baseline).toBeNull()
  })

  it('state file uses atomic write', async () => {
    await manager.markOverrideActive('provider-1')

    const stateContent = await fs.readFile(stateFile, 'utf8')
    expect(JSON.parse(stateContent).activeOverride.providerId).toBe('provider-1')

    const files = await fs.readdir(testDir)
    const tmpFiles = files.filter((f) => f.endsWith('.tmp'))
    expect(tmpFiles).toHaveLength(0)
  })
})
