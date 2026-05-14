import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { describe, it, expect, beforeEach } from 'vitest'

import { ConfigGuard } from '../codex-config-guard'
import type { CodexPlatformAdapter, ProtectedPayload } from '../../shared/codex-platform'

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

function createPlatform(): CodexPlatformAdapter {
  return {
    fetch: async () => new Response(),
    protect: (value: string): ProtectedPayload => ({ mode: 'plain', value }),
    unprotect: (payload: ProtectedPayload): string => payload.value,
    openExternal: async () => undefined
  }
}

describe('ConfigGuard', () => {
  let testDir: string
  let codexHome: string
  let guard: ConfigGuard
  let platform: CodexPlatformAdapter

  beforeEach(async () => {
    testDir = join(tmpdir(), `config-guard-test-${randomUUID()}`)
    codexHome = join(testDir, '.codex')
    await fs.mkdir(codexHome, { recursive: true })
    platform = createPlatform()
    guard = new ConfigGuard(testDir, platform)
  })

  it('records empty hash when file does not exist', async () => {
    const filePath = join(codexHome, 'config.toml')
    await guard.guardBeforeWrite(filePath)

    const state = await guard.getState()
    expect(state.hashes[filePath]).toBe('')
    expect(state.backups).toHaveLength(0)
  })

  it('backs up file when no lastKnownHash exists', async () => {
    const filePath = join(codexHome, 'config.toml')
    await fs.writeFile(filePath, 'model = "gpt-4"\n', 'utf8')

    await guard.guardBeforeWrite(filePath)

    const state = await guard.getState()
    expect(state.backups).toHaveLength(1)
    expect(state.backups[0].file).toBe(filePath)
    expect(state.backups[0].protected).toBe(false)
    expect(state.backups[0].backupPath).toContain(join(codexHome, 'config-backups'))

    const backupContent = await fs.readFile(state.backups[0].backupPath, 'utf8')
    expect(backupContent).toBe('model = "gpt-4"\n')
  })

  it('does not backup when hash matches lastKnownHash', async () => {
    const filePath = join(codexHome, 'config.toml')
    await fs.writeFile(filePath, 'model = "gpt-4"\n', 'utf8')

    await guard.guardBeforeWrite(filePath)
    await guard.recordWriteComplete(filePath)

    await guard.guardBeforeWrite(filePath)

    const state = await guard.getState()
    expect(state.backups).toHaveLength(1)
  })

  it('backs up when file content changed externally', async () => {
    const filePath = join(codexHome, 'config.toml')
    await fs.writeFile(filePath, 'model = "gpt-4"\n', 'utf8')

    await guard.guardBeforeWrite(filePath)
    await guard.recordWriteComplete(filePath)

    await fs.writeFile(filePath, 'model = "claude-4"\n', 'utf8')
    await guard.guardBeforeWrite(filePath)

    const state = await guard.getState()
    expect(state.backups).toHaveLength(2)
    expect(state.backups[1].file).toBe(filePath)

    const backupContent = await fs.readFile(state.backups[1].backupPath, 'utf8')
    expect(backupContent).toBe('model = "claude-4"\n')
  })

  it('deduplicates backups by file + hash', async () => {
    const filePath = join(codexHome, 'config.toml')
    const originalContent = 'model = "gpt-4"\n'
    await fs.writeFile(filePath, originalContent, 'utf8')

    // First guard: no lastKnownHash → backs up original
    await guard.guardBeforeWrite(filePath)

    // Simulate CodexDock writing something else
    await fs.writeFile(filePath, 'model = "other"\n', 'utf8')
    await guard.recordWriteComplete(filePath)

    // External change back to original content
    await fs.writeFile(filePath, originalContent, 'utf8')

    // Second guard: hash differs from lastKnown, but same hash was already backed up → no new backup
    await guard.guardBeforeWrite(filePath)

    const state = await guard.getState()
    const matchingBackups = state.backups.filter((b) => b.file === filePath)
    expect(matchingBackups).toHaveLength(1)
  })

  it('ignores backup records outside the config sibling backup directory', async () => {
    const filePath = join(codexHome, 'config.toml')
    const content = 'model = "gpt-4"\n'
    const hash = sha256(content)
    const oldBackupDir = join(testDir, 'config-backups')
    const oldBackupPath = join(oldBackupDir, 'config.toml-old.bak')
    await fs.writeFile(filePath, content, 'utf8')
    await fs.mkdir(oldBackupDir, { recursive: true })
    await fs.writeFile(oldBackupPath, content, 'utf8')
    await fs.writeFile(
      join(testDir, 'config-guard-state.json'),
      `${JSON.stringify(
        {
          version: 2,
          hashes: {},
          backups: [
            {
              file: filePath,
              hash,
              backupPath: oldBackupPath,
              createdAt: new Date(0).toISOString(),
              protected: false
            }
          ]
        },
        null,
        2
      )}\n`,
      'utf8'
    )

    await guard.guardBeforeWrite(filePath)

    const state = await guard.getState()
    const sameHashBackups = state.backups.filter(
      (backup) => backup.file === filePath && backup.hash === hash
    )
    expect(sameHashBackups).toHaveLength(2)
    expect(sameHashBackups.some((backup) => backup.backupPath === oldBackupPath)).toBe(true)
    expect(
      sameHashBackups.some((backup) =>
        backup.backupPath.startsWith(join(codexHome, 'config-backups'))
      )
    ).toBe(true)
  })

  it('encrypts sensitive file backups', async () => {
    const filePath = join(codexHome, 'auth.json')
    const content = '{"OPENAI_API_KEY": "sk-secret"}\n'
    await fs.writeFile(filePath, content, 'utf8')

    await guard.guardBeforeWrite(filePath, { sensitive: true })

    const state = await guard.getState()
    expect(state.backups).toHaveLength(1)
    expect(state.backups[0].protected).toBe(true)
    expect(state.backups[0].backupPath).toContain(join(codexHome, 'config-backups'))
    expect(state.backups[0].backupPath).toMatch(/\.bak\.enc$/)

    const raw = await fs.readFile(state.backups[0].backupPath, 'utf8')
    const payload = JSON.parse(raw) as ProtectedPayload
    expect(payload.mode).toBe('plain')
    expect(platform.unprotect(payload)).toBe(content)
  })

  it('recordWriteComplete updates hash after write', async () => {
    const filePath = join(codexHome, 'config.toml')
    await fs.writeFile(filePath, 'model = "gpt-4"\n', 'utf8')

    await guard.recordWriteComplete(filePath)

    const state = await guard.getState()
    expect(state.hashes[filePath]).toBeTruthy()
    expect(state.hashes[filePath]).not.toBe('')
  })

  it('recordWriteComplete sets empty hash when file removed', async () => {
    const filePath = join(codexHome, 'config.toml')
    await fs.writeFile(filePath, 'content', 'utf8')
    await guard.recordWriteComplete(filePath)

    await fs.rm(filePath)
    await guard.recordWriteComplete(filePath)

    const state = await guard.getState()
    expect(state.hashes[filePath]).toBe('')
  })

  it('listBackups filters by file path', async () => {
    const configPath = join(codexHome, 'config.toml')
    const authPath = join(codexHome, 'auth.json')
    await fs.writeFile(configPath, 'config content', 'utf8')
    await fs.writeFile(authPath, 'auth content', 'utf8')

    await guard.guardBeforeWrite(configPath)
    await guard.guardBeforeWrite(authPath, { sensitive: true })

    const configBackups = await guard.listBackups(configPath)
    const authBackups = await guard.listBackups(authPath)
    const allBackups = await guard.listBackups()

    expect(configBackups).toHaveLength(1)
    expect(authBackups).toHaveLength(1)
    expect(allBackups).toHaveLength(2)
  })

  it('does not leave temporary files after atomic writes', async () => {
    const filePath = join(codexHome, 'config.toml')
    await fs.writeFile(filePath, 'content', 'utf8')

    await guard.guardBeforeWrite(filePath)

    const backupDir = join(codexHome, 'config-backups')
    const files = await fs.readdir(backupDir)
    const tmpFiles = files.filter((f) => f.endsWith('.tmp'))
    expect(tmpFiles).toHaveLength(0)
  })
})
