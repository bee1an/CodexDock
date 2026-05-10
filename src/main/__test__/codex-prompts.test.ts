import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createCodexPromptService } from '../codex-prompts'

const createdDirectories: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'codexdock-prompts-'))
  createdDirectories.push(dir)
  return dir
}

afterEach(async () => {
  for (const dir of createdDirectories) {
    await rm(dir, { recursive: true, force: true })
  }
  createdDirectories.length = 0
})

describe('createCodexPromptService', () => {
  it('creates and lists prompts', async () => {
    const dir = await createTempDir()
    const service = createCodexPromptService(dir)

    const created = await service.create({ title: 'Hello World', content: 'Test content' })
    expect(created.id).toBe('hello-world')
    expect(created.title).toBe('Hello World')
    expect(created.content).toBe('Test content')

    const list = await service.list()
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('hello-world')
    expect(list[0].title).toBe('Hello World')
  })

  it('generates unique slugs on conflict', async () => {
    const dir = await createTempDir()
    const service = createCodexPromptService(dir)

    await service.create({ title: 'Test', content: 'first' })
    const second = await service.create({ title: 'Test', content: 'second' })
    expect(second.id).toBe('test-2')
  })

  it('reads prompt detail', async () => {
    const dir = await createTempDir()
    const service = createCodexPromptService(dir)

    await service.create({ title: 'Detail Test', content: 'body here', categories: ['dev'] })
    const detail = await service.detail('detail-test')
    expect(detail.title).toBe('Detail Test')
    expect(detail.content).toBe('body here')
    expect(detail.categories).toEqual(['dev'])
  })

  it('throws on missing prompt', async () => {
    const dir = await createTempDir()
    const service = createCodexPromptService(dir)

    await expect(service.detail('nonexistent')).rejects.toThrow('not found')
  })

  it('updates prompt content', async () => {
    const dir = await createTempDir()
    const service = createCodexPromptService(dir)

    await service.create({ title: 'Update Me', content: 'old' })
    const updated = await service.update('update-me', { content: 'new' })
    expect(updated.content).toBe('new')
    expect(updated.title).toBe('Update Me')
  })

  it('renames file when title changes', async () => {
    const dir = await createTempDir()
    const service = createCodexPromptService(dir)

    await service.create({ title: 'Original', content: 'body' })
    const updated = await service.update('original', { title: 'Renamed' })
    expect(updated.id).toBe('renamed')

    await expect(service.detail('original')).rejects.toThrow('not found')
    const detail = await service.detail('renamed')
    expect(detail.content).toBe('body')
  })

  it('removes prompt', async () => {
    const dir = await createTempDir()
    const service = createCodexPromptService(dir)

    await service.create({ title: 'Remove Me', content: 'x' })
    await service.remove('remove-me')
    const list = await service.list()
    expect(list).toHaveLength(0)
  })

  it('copies prompt content', async () => {
    const dir = await createTempDir()
    const service = createCodexPromptService(dir)

    await service.create({ title: 'Copy', content: 'clipboard text' })
    const text = await service.copy('copy')
    expect(text).toBe('clipboard text')
  })

  it('searches by query', async () => {
    const dir = await createTempDir()
    const service = createCodexPromptService(dir)

    await service.create({ title: 'Alpha', content: 'hello world' })
    await service.create({ title: 'Beta', content: 'goodbye' })

    const results = await service.list({ query: 'hello' })
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('alpha')
  })

  it('filters by category', async () => {
    const dir = await createTempDir()
    const service = createCodexPromptService(dir)

    await service.create({ title: 'A', content: 'x', categories: ['dev'] })
    await service.create({ title: 'B', content: 'y', categories: ['ops'] })

    const results = await service.list({ category: 'dev' })
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('a')
  })

  describe('category management', () => {
    it('creates and lists categories', async () => {
      const dir = await createTempDir()
      const service = createCodexPromptService(dir)

      await service.createCategory('dev')
      await service.createCategory('ops')
      const { categories } = await service.listCategories()
      expect(categories).toEqual(['image', 'dev', 'ops'])
    })

    it('renames category in registry and prompts', async () => {
      const dir = await createTempDir()
      const service = createCodexPromptService(dir)

      await service.createCategory('old-name')
      await service.create({ title: 'P', content: 'x', categories: ['old-name'] })
      await service.renameCategory('old-name', 'new-name')

      const { categories } = await service.listCategories()
      expect(categories).toContain('new-name')
      expect(categories).not.toContain('old-name')

      const detail = await service.detail('p')
      expect(detail.categories).toEqual(['new-name'])
    })

    it('removes category from registry and prompts', async () => {
      const dir = await createTempDir()
      const service = createCodexPromptService(dir)

      await service.createCategory('remove-me')
      await service.create({ title: 'P', content: 'x', categories: ['remove-me', 'keep'] })
      await service.removeCategory('remove-me')

      const { categories } = await service.listCategories()
      expect(categories).not.toContain('remove-me')

      const detail = await service.detail('p')
      expect(detail.categories).toEqual(['keep'])
    })
  })

  describe('import/export', () => {
    it('imports a single file', async () => {
      const dir = await createTempDir()
      const sourceDir = await createTempDir()
      const service = createCodexPromptService(dir)

      const mdContent = '---\ntitle: Imported\ncategories:\n  - test\n---\n\nImported body'
      await writeFile(join(sourceDir, 'imported.md'), mdContent, 'utf8')

      const result = await service.importFile(join(sourceDir, 'imported.md'))
      expect(result.imported).toBe(1)

      const detail = await service.detail('imported')
      expect(detail.title).toBe('Imported')
      expect(detail.content).toBe('Imported body')
      expect(detail.categories).toEqual(['test'])
    })

    it('imports a directory', async () => {
      const dir = await createTempDir()
      const sourceDir = await createTempDir()
      const service = createCodexPromptService(dir)

      await writeFile(join(sourceDir, 'a.md'), '---\ntitle: A\n---\n\nBody A', 'utf8')
      await writeFile(join(sourceDir, 'b.md'), '---\ntitle: B\n---\n\nBody B', 'utf8')

      const result = await service.importDir(sourceDir)
      expect(result.imported).toBe(2)

      const list = await service.list()
      expect(list).toHaveLength(2)
    })

    it('exports to directory', async () => {
      const dir = await createTempDir()
      const exportDir = join(await createTempDir(), 'export')
      const service = createCodexPromptService(dir)

      await service.create({ title: 'Export Me', content: 'exported' })
      const result = await service.exportDir(exportDir)
      expect(result.exported).toBe(1)

      const exported = await readFile(join(exportDir, 'export-me.md'), 'utf8')
      expect(exported).toContain('title: Export Me')
      expect(exported).toContain('exported')
    })
  })

  it('handles file without frontmatter', async () => {
    const dir = await createTempDir()
    await mkdir(join(dir, 'prompts'), { recursive: true })
    await writeFile(join(dir, 'prompts', 'plain.md'), 'Just plain text', 'utf8')

    const service = createCodexPromptService(dir)
    const detail = await service.detail('plain')
    expect(detail.title).toBe('plain')
    expect(detail.content).toBe('Just plain text')
    expect(detail.categories).toEqual([])
  })

  it('migrates prompts from legacy app data directories', async () => {
    const dir = await createTempDir()
    const legacyDir = await createTempDir()
    await mkdir(join(legacyDir, 'prompts'), { recursive: true })
    await writeFile(
      join(legacyDir, 'prompts', '.categories.json'),
      `${JSON.stringify(['legacy'])}\n`,
      'utf8'
    )
    await writeFile(
      join(legacyDir, 'prompts', 'legacy-prompt.md'),
      '---\ntitle: Legacy Prompt\ncategories:\n  - legacy\n---\n\nLegacy body',
      'utf8'
    )

    const service = createCodexPromptService(dir, { legacyUserDataPaths: [legacyDir] })

    await expect(service.detail('legacy-prompt')).resolves.toMatchObject({
      title: 'Legacy Prompt',
      content: 'Legacy body',
      categories: ['legacy']
    })
    await expect(readFile(join(dir, 'prompts', 'legacy-prompt.md'), 'utf8')).resolves.toContain(
      'Legacy body'
    )
    await expect(service.listCategories()).resolves.toEqual({
      categories: ['image', 'legacy']
    })
  })

  it('does not re-duplicate legacy prompts on repeated service creation', async () => {
    const dir = await createTempDir()
    const legacyDir = await createTempDir()
    await mkdir(join(legacyDir, 'prompts'), { recursive: true })
    await writeFile(
      join(legacyDir, 'prompts', 'legacy-prompt.md'),
      '---\ntitle: Legacy\n---\n\nOriginal body',
      'utf8'
    )

    const first = createCodexPromptService(dir, { legacyUserDataPaths: [legacyDir] })
    await first.listCategories()

    // user edits the migrated file locally — simulates realistic divergence
    await writeFile(
      join(dir, 'prompts', 'legacy-prompt.md'),
      '---\ntitle: Overwritten\n---\n\nUser edit',
      'utf8'
    )

    // previously: each subsequent start recopied the legacy file as -2.md, -3.md, ...
    for (let i = 0; i < 3; i += 1) {
      const service = createCodexPromptService(dir, { legacyUserDataPaths: [legacyDir] })
      await service.listCategories()
    }

    const entries = (await readdir(join(dir, 'prompts'))).filter((name) => name.endsWith('.md'))
    expect(entries).toEqual(['legacy-prompt.md'])
    const finalBody = await readFile(join(dir, 'prompts', 'legacy-prompt.md'), 'utf8')
    expect(finalBody).toContain('User edit')
  })

  it('exports attachments alongside markdown', async () => {
    const dir = await createTempDir()
    const exportDir = join(await createTempDir(), 'export')
    const service = createCodexPromptService(dir)

    const created = await service.create({ title: 'With Image', content: 'body' })
    const pngBase64 = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00
    ]).toString('base64')
    await service.addAttachment(created.id, {
      fileName: 'pic.png',
      mimeType: 'image/png',
      dataBase64: pngBase64
    })

    await service.exportDir(exportDir)

    const exportedMd = await readFile(join(exportDir, `${created.id}.md`), 'utf8')
    expect(exportedMd).toContain('fileName: pic.png')

    const copiedAttachment = await readFile(join(exportDir, '.attachments', created.id, 'pic.png'))
    expect(copiedAttachment.length).toBe(11)

    const importRoot = await createTempDir()
    const importService = createCodexPromptService(importRoot)
    await expect(importService.importDir(exportDir)).resolves.toMatchObject({ imported: 1 })
    const imported = await importService.detail(created.id)
    expect(imported.attachments).toEqual([
      {
        fileName: 'pic.png',
        mimeType: 'image/png',
        size: 11
      }
    ])
    await expect(importService.readAttachment(created.id, 'pic.png')).resolves.toMatchObject({
      fileName: 'pic.png',
      mimeType: 'image/png',
      size: 11
    })
  })

  describe('addAttachment validation', () => {
    const smallPngBase64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64')

    it('rejects unsupported mime types', async () => {
      const dir = await createTempDir()
      const service = createCodexPromptService(dir)
      const created = await service.create({ title: 'X', content: 'x' })

      await expect(
        service.addAttachment(created.id, {
          fileName: 'evil.exe',
          mimeType: 'application/x-msdownload',
          dataBase64: smallPngBase64
        })
      ).rejects.toThrow(/not allowed/u)
    })

    it('rejects payloads exceeding the size cap', async () => {
      const dir = await createTempDir()
      const service = createCodexPromptService(dir)
      const created = await service.create({ title: 'X', content: 'x' })

      const oversized = Buffer.alloc(10 * 1024 * 1024 + 1, 0).toString('base64')
      await expect(
        service.addAttachment(created.id, {
          fileName: 'huge.png',
          mimeType: 'image/png',
          dataBase64: oversized
        })
      ).rejects.toThrow(/exceeds maximum size/u)
    })

    it('rejects malformed base64', async () => {
      const dir = await createTempDir()
      const service = createCodexPromptService(dir)
      const created = await service.create({ title: 'X', content: 'x' })

      await expect(
        service.addAttachment(created.id, {
          fileName: 'pic.png',
          mimeType: 'image/png',
          dataBase64: 'not_base64!!!'
        })
      ).rejects.toThrow(/base64/u)
    })
  })
})
