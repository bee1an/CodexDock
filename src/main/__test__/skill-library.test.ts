import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createSkillLibraryService } from '../skill-library'

const createdDirectories: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'codexdock-skill-library-'))
  createdDirectories.push(dir)
  return dir
}

afterEach(async () => {
  for (const dir of createdDirectories) {
    await rm(dir, { recursive: true, force: true })
  }
  createdDirectories.length = 0
})

describe('createSkillLibraryService', () => {
  it('creates and lists skills', async () => {
    const dir = await createTempDir()
    const service = createSkillLibraryService(dir)

    const created = await service.create({
      name: 'My Skill',
      content: '---\nname: My Skill\ndescription: A test skill\n---\nBody here'
    })
    expect(created.id).toBe('my-skill')
    expect(created.name).toBe('My Skill')

    const list = await service.list()
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('my-skill')
  })

  it('generates unique ids on conflict', async () => {
    const dir = await createTempDir()
    const service = createSkillLibraryService(dir)

    await service.create({ name: 'Test', content: '---\nname: Test\n---\nfirst' })
    const second = await service.create({ name: 'Test', content: '---\nname: Test\n---\nsecond' })
    expect(second.id).toBe('test-2')
  })

  it('reads skill detail', async () => {
    const dir = await createTempDir()
    const service = createSkillLibraryService(dir)

    await service.create({
      name: 'Detail Test',
      content: '---\nname: Detail Test\ndescription: desc\n---\nbody',
      categories: ['dev']
    })
    const detail = await service.detail('detail-test')
    expect(detail.name).toBe('Detail Test')
    expect(detail.description).toBe('desc')
    expect(detail.content).toContain('body')
    expect(detail.categories).toEqual(['dev'])
    expect(detail.files).toContain('SKILL.md')
  })

  it('throws on missing skill', async () => {
    const dir = await createTempDir()
    const service = createSkillLibraryService(dir)

    await expect(service.detail('nonexistent')).rejects.toThrow('not found')
  })

  it('updates skill content', async () => {
    const dir = await createTempDir()
    const service = createSkillLibraryService(dir)

    await service.create({ name: 'Update Me', content: '---\nname: Update Me\n---\nold' })
    const updated = await service.update('update-me', {
      content: '---\nname: Update Me\n---\nnew content'
    })
    expect(updated.content).toContain('new content')
  })

  it('updates skill categories', async () => {
    const dir = await createTempDir()
    const service = createSkillLibraryService(dir)

    await service.create({ name: 'Cat Test', content: '---\nname: Cat Test\n---\nbody' })
    const updated = await service.update('cat-test', { categories: ['tools', 'dev'] })
    expect(updated.categories).toEqual(['tools', 'dev'])
  })

  it('clears categories', async () => {
    const dir = await createTempDir()
    const service = createSkillLibraryService(dir)

    await service.create({
      name: 'Clear Cat',
      content: '---\nname: Clear Cat\n---\nbody',
      categories: ['old']
    })
    const updated = await service.update('clear-cat', { clearCategories: true })
    expect(updated.categories).toEqual([])
  })

  it('removes a skill', async () => {
    const dir = await createTempDir()
    const service = createSkillLibraryService(dir)

    await service.create({ name: 'Remove Me', content: '---\nname: Remove Me\n---\nbody' })
    await service.remove('remove-me')
    const list = await service.list()
    expect(list).toHaveLength(0)
  })

  it('throws on removing nonexistent skill', async () => {
    const dir = await createTempDir()
    const service = createSkillLibraryService(dir)

    await expect(service.remove('ghost')).rejects.toThrow('not found')
  })

  it('manages categories', async () => {
    const dir = await createTempDir()
    const service = createSkillLibraryService(dir)

    await service.createCategory('tools')
    await service.createCategory('dev')
    let result = await service.listCategories()
    expect(result.categories).toEqual(['tools', 'dev'])

    await service.renameCategory('tools', 'utilities')
    result = await service.listCategories()
    expect(result.categories).toEqual(['utilities', 'dev'])

    await service.removeCategory('dev')
    result = await service.listCategories()
    expect(result.categories).toEqual(['utilities'])
  })

  it('renames category in skill meta', async () => {
    const dir = await createTempDir()
    const service = createSkillLibraryService(dir)

    await service.create({
      name: 'Rename Cat Skill',
      content: '---\nname: Rename Cat Skill\n---\nbody',
      categories: ['old-cat']
    })
    await service.createCategory('old-cat')
    await service.renameCategory('old-cat', 'new-cat')

    const detail = await service.detail('rename-cat-skill')
    expect(detail.categories).toEqual(['new-cat'])
  })

  it('removes category from skill meta', async () => {
    const dir = await createTempDir()
    const service = createSkillLibraryService(dir)

    await service.create({
      name: 'Remove Cat Skill',
      content: '---\nname: Remove Cat Skill\n---\nbody',
      categories: ['doomed']
    })
    await service.createCategory('doomed')
    await service.removeCategory('doomed')

    const detail = await service.detail('remove-cat-skill')
    expect(detail.categories).toEqual([])
  })

  it('searches by query', async () => {
    const dir = await createTempDir()
    const service = createSkillLibraryService(dir)

    await service.create({ name: 'Alpha', content: '---\nname: Alpha\n---\nbody' })
    await service.create({ name: 'Beta', content: '---\nname: Beta\n---\nbody' })

    const results = await service.list({ query: 'alph' })
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('Alpha')
  })

  it('filters by category', async () => {
    const dir = await createTempDir()
    const service = createSkillLibraryService(dir)

    await service.create({
      name: 'Skill A',
      content: '---\nname: Skill A\n---\nbody',
      categories: ['tools']
    })
    await service.create({
      name: 'Skill B',
      content: '---\nname: Skill B\n---\nbody',
      categories: ['dev']
    })

    const results = await service.list({ category: 'tools' })
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('Skill A')
  })

  it('imports a skill directory', async () => {
    const dir = await createTempDir()
    const service = createSkillLibraryService(dir)

    const sourceDir = await createTempDir()
    const skillDir = join(sourceDir, 'my-imported-skill')
    await mkdir(skillDir, { recursive: true })
    await writeFile(
      join(skillDir, 'SKILL.md'),
      '---\nname: Imported\ndescription: from dir\n---\nContent'
    )

    const result = await service.importDir(sourceDir)
    expect(result.imported).toBe(1)
    expect(result.skipped).toBe(0)

    const list = await service.list()
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('Imported')
  })

  it('skips import if skill already exists', async () => {
    const dir = await createTempDir()
    const service = createSkillLibraryService(dir)

    const sourceDir = await createTempDir()
    const skillDir = join(sourceDir, 'existing')
    await mkdir(skillDir, { recursive: true })
    await writeFile(join(skillDir, 'SKILL.md'), '---\nname: Existing\n---\nBody')

    await service.importDir(sourceDir)
    const result = await service.importDir(sourceDir)
    expect(result.imported).toBe(0)
    expect(result.skipped).toBe(1)
  })

  it('exports all skills', async () => {
    const dir = await createTempDir()
    const service = createSkillLibraryService(dir)

    await service.create({ name: 'Export A', content: '---\nname: Export A\n---\nbody a' })
    await service.create({ name: 'Export B', content: '---\nname: Export B\n---\nbody b' })

    const exportDir = await createTempDir()
    const result = await service.exportDir(exportDir)
    expect(result.exported).toBe(2)

    const entries = await readdir(exportDir)
    expect(entries.sort()).toEqual(['export-a', 'export-b'])
  })

  it('installs skill to instance', async () => {
    const dir = await createTempDir()
    const service = createSkillLibraryService(dir)

    await service.create({ name: 'Install Me', content: '---\nname: Install Me\n---\nbody' })

    const instanceHome = await createTempDir()
    const instances = [{ id: 'inst-1', name: 'Instance 1', codexHome: instanceHome }]

    const result = await service.install(
      { skillId: 'install-me', targetInstanceIds: ['inst-1'] },
      instances
    )
    expect(result.installed).toHaveLength(1)
    expect(result.installed[0].targetInstanceId).toBe('inst-1')

    const skillFile = join(instanceHome, 'skills', 'install-me', 'SKILL.md')
    const content = await readFile(skillFile, 'utf8')
    expect(content).toContain('Install Me')
  })

  it('skips install if skill already exists in target', async () => {
    const dir = await createTempDir()
    const service = createSkillLibraryService(dir)

    await service.create({ name: 'Dup Skill', content: '---\nname: Dup Skill\n---\nbody' })

    const instanceHome = await createTempDir()
    const targetSkillDir = join(instanceHome, 'skills', 'dup-skill')
    await mkdir(targetSkillDir, { recursive: true })
    await writeFile(join(targetSkillDir, 'SKILL.md'), 'existing')

    const instances = [{ id: 'inst-1', name: 'Instance 1', codexHome: instanceHome }]
    const result = await service.install(
      { skillId: 'dup-skill', targetInstanceIds: ['inst-1'] },
      instances
    )
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0].reason).toContain('already exists')
  })

  it('does not copy .meta.json to instance on install', async () => {
    const dir = await createTempDir()
    const service = createSkillLibraryService(dir)

    await service.create({
      name: 'No Meta',
      content: '---\nname: No Meta\n---\nbody',
      categories: ['internal']
    })

    const instanceHome = await createTempDir()
    const instances = [{ id: 'inst-1', name: 'Instance 1', codexHome: instanceHome }]

    await service.install({ skillId: 'no-meta', targetInstanceIds: ['inst-1'] }, instances)

    const installedDir = join(instanceHome, 'skills', 'no-meta')
    const files = await readdir(installedDir)
    expect(files).not.toContain('.meta.json')
    expect(files).toContain('SKILL.md')
  })

  it('collects skills from instance', async () => {
    const dir = await createTempDir()
    const service = createSkillLibraryService(dir)

    const instanceHome = await createTempDir()
    const skillDir = join(instanceHome, 'skills', 'collected-skill')
    await mkdir(skillDir, { recursive: true })
    await writeFile(
      join(skillDir, 'SKILL.md'),
      '---\nname: Collected\ndescription: from instance\n---\nContent'
    )

    const instances = [{ id: 'inst-1', name: 'Instance 1', codexHome: instanceHome }]
    const result = await service.collect(
      { sourceInstanceId: 'inst-1', sourceSkillDirNames: ['collected-skill'] },
      instances
    )
    expect(result.collected).toBe(1)

    const list = await service.list()
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('Collected')
  })
})
