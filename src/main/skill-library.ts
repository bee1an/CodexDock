import { promises as fs } from 'node:fs'
import { join, basename, resolve, relative, isAbsolute } from 'node:path'

import type {
  CreateSkillLibraryInput,
  SkillLibraryCategoryList,
  SkillLibraryCollectInput,
  SkillLibraryCollectResult,
  SkillLibraryDetail,
  SkillLibraryExportResult,
  SkillLibraryImportResult,
  SkillLibraryInstallInput,
  SkillLibraryInstallResult,
  SkillLibrarySearchInput,
  SkillLibrarySummary,
  UpdateSkillLibraryInput
} from '../shared/codex'

const SKILL_FILE = 'SKILL.md'
const CATEGORIES_FILE = '.categories.json'
const META_FILE = '.meta.json'

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT'
  )
}

function parseFrontmatter(content: string): {
  name?: string
  description?: string
  body: string
} {
  const trimmed = content.trimStart()
  if (!trimmed.startsWith('---')) {
    return { body: content }
  }

  const end = trimmed.indexOf('\n---', 3)
  if (end < 0) {
    return { body: content }
  }

  const frontmatter = trimmed.slice(3, end).trim()
  const body = trimmed.slice(end + 4).replace(/^\r?\n/u, '')

  const nameMatch = frontmatter.match(/^name:\s*(.+)$/mu)
  const descriptionMatch = frontmatter.match(/^description:\s*(.+)$/mu)

  const name = nameMatch?.[1]?.trim().replace(/^["']|["']$/gu, '')
  const description = descriptionMatch?.[1]?.trim().replace(/^["']|["']$/gu, '')

  return { name, description, body }
}

function fallbackDescription(body: string): string {
  const lines = body.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith('#')) {
      return trimmed.slice(0, 200)
    }
  }
  return ''
}

function singleLineYamlValue(value: string): string {
  return value.replace(/\r?\n/gu, ' ').trim()
}

function serializeSkillContent(meta: { name: string; description?: string }, body: string): string {
  const lines = ['---', `name: ${singleLineYamlValue(meta.name)}`]
  if (meta.description) {
    lines.push(`description: ${singleLineYamlValue(meta.description)}`)
  }
  lines.push('---')
  return lines.join('\n') + '\n' + body
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/[\s_]+/gu, '-')
      .replace(/-+/gu, '-')
      .replace(/^-|-$/gu, '')
      .slice(0, 64) || 'untitled'
  )
}

async function isSymlink(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(filePath)
    return stat.isSymbolicLink()
  } catch {
    return false
  }
}

function isPathInsideBase(basePath: string, targetPath: string): boolean {
  const rel = relative(resolve(basePath), resolve(targetPath))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

function normalizeDirName(name: string): string {
  const normalized = name.trim()
  if (
    !normalized ||
    normalized.includes('/') ||
    normalized.includes('\\') ||
    normalized.includes('..') ||
    normalized.startsWith('.')
  ) {
    throw new Error(`Invalid directory name: "${name}"`)
  }
  return normalized
}

function normalizeSkillName(name: string): string {
  const normalized = name.trim()
  if (!normalized) {
    throw new Error('Skill name is required.')
  }
  return normalized
}

interface SkillMeta {
  id: string
  categories: string[]
  createdAt: string
  updatedAt: string
}

interface ResolvedInstance {
  id: string
  name: string
  codexHome: string
}

export interface SkillLibraryService {
  list(input?: SkillLibrarySearchInput): Promise<SkillLibrarySummary[]>
  detail(skillId: string): Promise<SkillLibraryDetail>
  create(input: CreateSkillLibraryInput): Promise<SkillLibraryDetail>
  update(skillId: string, input: UpdateSkillLibraryInput): Promise<SkillLibraryDetail>
  remove(skillId: string): Promise<void>
  listCategories(): Promise<SkillLibraryCategoryList>
  createCategory(name: string): Promise<SkillLibraryCategoryList>
  renameCategory(oldName: string, newName: string): Promise<SkillLibraryCategoryList>
  removeCategory(name: string): Promise<SkillLibraryCategoryList>
  importDir(dirPath: string): Promise<SkillLibraryImportResult>
  exportDir(targetDir: string): Promise<SkillLibraryExportResult>
  collect(
    input: SkillLibraryCollectInput,
    instances: ResolvedInstance[]
  ): Promise<SkillLibraryCollectResult>
  install(
    input: SkillLibraryInstallInput,
    instances: ResolvedInstance[]
  ): Promise<SkillLibraryInstallResult>
}

export function createSkillLibraryService(userDataPath: string): SkillLibraryService {
  const libraryDir = join(userDataPath, 'skill-library')

  async function ensureDir(): Promise<void> {
    await fs.mkdir(libraryDir, { recursive: true })
  }

  async function readMeta(skillDir: string): Promise<SkillMeta | null> {
    try {
      const raw = await fs.readFile(join(skillDir, META_FILE), 'utf8')
      return JSON.parse(raw) as SkillMeta
    } catch {
      return null
    }
  }

  async function writeMeta(skillDir: string, meta: SkillMeta): Promise<void> {
    await fs.writeFile(join(skillDir, META_FILE), JSON.stringify(meta, null, 2), 'utf8')
  }

  async function readCategories(): Promise<string[]> {
    try {
      const raw = await fs.readFile(join(libraryDir, CATEGORIES_FILE), 'utf8')
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === 'string')
        : []
    } catch {
      return []
    }
  }

  async function writeCategories(categories: string[]): Promise<void> {
    await ensureDir()
    await fs.writeFile(
      join(libraryDir, CATEGORIES_FILE),
      JSON.stringify(categories, null, 2),
      'utf8'
    )
  }

  async function listSkillDirs(): Promise<string[]> {
    try {
      const entries = await fs.readdir(libraryDir, { withFileTypes: true })
      return entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name)
    } catch {
      return []
    }
  }

  async function readSkillSummary(dirName: string): Promise<SkillLibrarySummary | null> {
    const skillDir = join(libraryDir, dirName)
    const skillFile = join(skillDir, SKILL_FILE)

    let content: string
    try {
      content = await fs.readFile(skillFile, 'utf8')
    } catch {
      return null
    }

    const meta = await readMeta(skillDir)
    const { name, description, body } = parseFrontmatter(content)

    return {
      id: meta?.id ?? dirName,
      name: name || dirName,
      description: description || fallbackDescription(body),
      categories: meta?.categories ?? [],
      createdAt: meta?.createdAt ?? new Date().toISOString(),
      updatedAt: meta?.updatedAt ?? new Date().toISOString()
    }
  }

  async function listFiles(skillDir: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(skillDir, { withFileTypes: true })
      return entries.filter((e) => e.isFile() && !e.name.startsWith('.')).map((e) => e.name)
    } catch {
      return []
    }
  }

  async function findDirById(skillId: string): Promise<string | null> {
    const dirs = await listSkillDirs()
    for (const dirName of dirs) {
      if (dirName === skillId) return dirName
      const meta = await readMeta(join(libraryDir, dirName))
      if (meta?.id === skillId) return dirName
    }
    return null
  }

  async function list(input?: SkillLibrarySearchInput): Promise<SkillLibrarySummary[]> {
    await ensureDir()
    const dirs = await listSkillDirs()
    const results: SkillLibrarySummary[] = []

    for (const dirName of dirs) {
      const summary = await readSkillSummary(dirName)
      if (summary) results.push(summary)
    }

    let filtered = results

    if (input?.category) {
      const cat = input.category.toLowerCase()
      filtered = filtered.filter((s) => s.categories.some((c) => c.toLowerCase() === cat))
    }

    if (input?.query) {
      const q = input.query.toLowerCase()
      filtered = filtered.filter(
        (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
      )
    }

    return filtered.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async function detail(skillId: string): Promise<SkillLibraryDetail> {
    await ensureDir()
    const dirName = await findDirById(skillId)
    if (!dirName) throw new Error(`Skill "${skillId}" not found in library.`)

    const skillDir = join(libraryDir, dirName)
    const skillFile = join(skillDir, SKILL_FILE)

    const content = await fs.readFile(skillFile, 'utf8')
    const meta = await readMeta(skillDir)
    const { name, description, body } = parseFrontmatter(content)
    const files = await listFiles(skillDir)

    return {
      id: meta?.id ?? dirName,
      name: name || dirName,
      description: description || fallbackDescription(body),
      categories: meta?.categories ?? [],
      createdAt: meta?.createdAt ?? new Date().toISOString(),
      updatedAt: meta?.updatedAt ?? new Date().toISOString(),
      content,
      files
    }
  }

  async function create(input: CreateSkillLibraryInput): Promise<SkillLibraryDetail> {
    await ensureDir()
    const inputName = normalizeSkillName(input.name)
    const id = slugify(input.id ?? inputName)

    let dirName = id
    let counter = 1
    while (true) {
      try {
        await fs.access(join(libraryDir, dirName))
        counter++
        dirName = `${id}-${counter}`
      } catch {
        break
      }
    }

    const skillDir = join(libraryDir, dirName)
    await fs.mkdir(skillDir, { recursive: true })

    const now = new Date().toISOString()
    const meta: SkillMeta = {
      id: dirName,
      categories: input.categories ?? [],
      createdAt: now,
      updatedAt: now
    }

    const parsedInput = parseFrontmatter(input.content)
    const content = serializeSkillContent(
      {
        name: inputName,
        description: input.description ?? parsedInput.description
      },
      parsedInput.body
    )

    await writeMeta(skillDir, meta)
    await fs.writeFile(join(skillDir, SKILL_FILE), content, 'utf8')

    const { name, description, body } = parseFrontmatter(content)
    const files = await listFiles(skillDir)

    return {
      id: meta.id,
      name: name || inputName,
      description: description || fallbackDescription(body),
      categories: meta.categories,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      content,
      files
    }
  }

  async function update(
    skillId: string,
    input: UpdateSkillLibraryInput
  ): Promise<SkillLibraryDetail> {
    await ensureDir()
    const dirName = await findDirById(skillId)
    if (!dirName) throw new Error(`Skill "${skillId}" not found in library.`)

    const skillDir = join(libraryDir, dirName)
    const skillFile = join(skillDir, SKILL_FILE)
    const meta = (await readMeta(skillDir)) ?? {
      id: dirName,
      categories: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }

    if (input.content !== undefined) {
      await fs.writeFile(skillFile, input.content, 'utf8')
    }

    if (input.name !== undefined || input.description !== undefined) {
      const currentContent = await fs.readFile(skillFile, 'utf8')
      const parsed = parseFrontmatter(currentContent)
      const newName =
        input.name !== undefined ? normalizeSkillName(input.name) : (parsed.name ?? dirName)
      const newDescription = input.description ?? parsed.description
      const newContent = serializeSkillContent(
        { name: newName, description: newDescription },
        parsed.body
      )
      await fs.writeFile(skillFile, newContent, 'utf8')
    }

    if (input.clearCategories) {
      meta.categories = []
    } else if (input.categories !== undefined) {
      meta.categories = input.categories
    }

    meta.updatedAt = new Date().toISOString()
    await writeMeta(skillDir, meta)

    const content = await fs.readFile(skillFile, 'utf8')
    const { name, description, body } = parseFrontmatter(content)
    const files = await listFiles(skillDir)

    return {
      id: meta.id,
      name: name || dirName,
      description: description || fallbackDescription(body),
      categories: meta.categories,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      content,
      files
    }
  }

  async function remove(skillId: string): Promise<void> {
    await ensureDir()
    const dirName = await findDirById(skillId)
    if (!dirName) throw new Error(`Skill "${skillId}" not found in library.`)

    await fs.rm(join(libraryDir, dirName), { recursive: true, force: true })
  }

  async function listCategories(): Promise<SkillLibraryCategoryList> {
    await ensureDir()
    return { categories: await readCategories() }
  }

  async function createCategory(name: string): Promise<SkillLibraryCategoryList> {
    const categories = await readCategories()
    if (!categories.includes(name)) {
      categories.push(name)
      await writeCategories(categories)
    }
    return { categories }
  }

  async function renameCategory(
    oldName: string,
    newName: string
  ): Promise<SkillLibraryCategoryList> {
    const categories = await readCategories()
    const idx = categories.indexOf(oldName)
    if (idx >= 0) {
      categories[idx] = newName
      await writeCategories(categories)
    }

    const dirs = await listSkillDirs()
    for (const dirName of dirs) {
      const skillDir = join(libraryDir, dirName)
      const meta = await readMeta(skillDir)
      if (meta && meta.categories.includes(oldName)) {
        meta.categories = meta.categories.map((c) => (c === oldName ? newName : c))
        await writeMeta(skillDir, meta)
      }
    }

    return { categories }
  }

  async function removeCategory(name: string): Promise<SkillLibraryCategoryList> {
    const categories = await readCategories()
    const filtered = categories.filter((c) => c !== name)
    await writeCategories(filtered)

    const dirs = await listSkillDirs()
    for (const dirName of dirs) {
      const skillDir = join(libraryDir, dirName)
      const meta = await readMeta(skillDir)
      if (meta && meta.categories.includes(name)) {
        meta.categories = meta.categories.filter((c) => c !== name)
        await writeMeta(skillDir, meta)
      }
    }

    return { categories: filtered }
  }

  async function importDir(dirPath: string): Promise<SkillLibraryImportResult> {
    await ensureDir()
    const resolvedPath = resolve(dirPath)
    let imported = 0
    let skipped = 0
    const errors: string[] = []

    let stat: Awaited<ReturnType<typeof fs.stat>>
    try {
      stat = await fs.stat(resolvedPath)
    } catch {
      return { imported: 0, skipped: 0, errors: [`Path not found: ${dirPath}`] }
    }

    if (stat.isDirectory()) {
      const skillFile = join(resolvedPath, SKILL_FILE)
      try {
        await fs.access(skillFile)
        const result = await importSingleSkillDir(resolvedPath)
        if (result === 'imported') imported++
        else if (result === 'skipped') skipped++
      } catch {
        const entries = await fs.readdir(resolvedPath, { withFileTypes: true })
        const subDirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        for (const sub of subDirs) {
          const subPath = join(resolvedPath, sub.name)
          try {
            await fs.access(join(subPath, SKILL_FILE))
            const result = await importSingleSkillDir(subPath)
            if (result === 'imported') imported++
            else if (result === 'skipped') skipped++
          } catch (err) {
            if (!isMissingPathError(err)) {
              errors.push(`${sub.name}: ${String(err)}`)
            } else {
              skipped++
            }
          }
        }
      }
    } else {
      errors.push('Path is not a directory.')
    }

    return { imported, skipped, errors }
  }

  async function importSingleSkillDir(sourcePath: string): Promise<'imported' | 'skipped'> {
    if (await isSymlink(sourcePath)) {
      throw new Error('Symlink directories are not allowed.')
    }

    const dirName = basename(sourcePath)
    const id = slugify(dirName)

    let targetDirName = id
    let counter = 1
    const existing = await findDirById(id)
    if (existing) return 'skipped'

    while (true) {
      try {
        await fs.access(join(libraryDir, targetDirName))
        counter++
        targetDirName = `${id}-${counter}`
      } catch {
        break
      }
    }

    const targetDir = join(libraryDir, targetDirName)
    await fs.cp(sourcePath, targetDir, {
      recursive: true,
      force: false,
      filter: async (src) => !(await isSymlink(src))
    })

    const existingMeta = await readMeta(targetDir)
    if (!existingMeta) {
      const now = new Date().toISOString()
      await writeMeta(targetDir, {
        id: targetDirName,
        categories: [],
        createdAt: now,
        updatedAt: now
      })
    }

    return 'imported'
  }

  async function exportDir(targetDir: string): Promise<SkillLibraryExportResult> {
    await ensureDir()
    const resolvedTarget = resolve(targetDir)
    const resolvedLibraryDir = resolve(libraryDir)
    if (
      resolvedTarget === resolvedLibraryDir ||
      isPathInsideBase(resolvedLibraryDir, resolvedTarget)
    ) {
      throw new Error('Export target must be outside Skill Library storage.')
    }

    await fs.mkdir(resolvedTarget, { recursive: true })

    const dirs = await listSkillDirs()
    let exported = 0

    for (const dirName of dirs) {
      const sourceDir = join(libraryDir, dirName)
      const destDir = join(resolvedTarget, dirName)

      await fs.cp(sourceDir, destDir, {
        recursive: true,
        force: true,
        filter: async (src) => !(await isSymlink(src))
      })
      exported++
    }

    return { exported, outputPath: resolvedTarget }
  }

  async function collect(
    input: SkillLibraryCollectInput,
    instances: ResolvedInstance[]
  ): Promise<SkillLibraryCollectResult> {
    await ensureDir()
    const instance = instances.find((i) => i.id === input.sourceInstanceId)
    if (!instance) {
      return { collected: 0, skipped: 0, errors: [`Instance ${input.sourceInstanceId} not found.`] }
    }

    let collected = 0
    let skipped = 0
    const errors: string[] = []

    for (const skillDirName of input.sourceSkillDirNames) {
      let normalizedName: string
      try {
        normalizedName = normalizeDirName(skillDirName)
      } catch {
        errors.push(`${skillDirName}: invalid directory name.`)
        continue
      }

      const skillsBase = join(instance.codexHome, 'skills')
      const sourcePath = join(skillsBase, normalizedName)

      if (!isPathInsideBase(skillsBase, sourcePath)) {
        errors.push(`${normalizedName}: path escapes skills directory.`)
        continue
      }

      try {
        if (await isSymlink(sourcePath)) {
          errors.push(`${normalizedName}: symlink, skipped.`)
          continue
        }

        await fs.access(join(sourcePath, SKILL_FILE))

        const existing = await findDirById(slugify(normalizedName))
        if (existing) {
          skipped++
          continue
        }

        const result = await importSingleSkillDir(sourcePath)
        if (result === 'imported') collected++
        else skipped++
      } catch (err) {
        if (isMissingPathError(err)) {
          errors.push(`${normalizedName}: SKILL.md not found.`)
        } else {
          errors.push(`${normalizedName}: ${String(err instanceof Error ? err.message : err)}`)
        }
      }
    }

    return { collected, skipped, errors }
  }

  async function install(
    input: SkillLibraryInstallInput,
    instances: ResolvedInstance[]
  ): Promise<SkillLibraryInstallResult> {
    await ensureDir()
    const dirName = await findDirById(input.skillId)
    if (!dirName) throw new Error(`Skill "${input.skillId}" not found in library.`)

    const sourceDir = join(libraryDir, dirName)
    const installed: SkillLibraryInstallResult['installed'] = []
    const installSkipped: SkillLibraryInstallResult['skipped'] = []
    const failed: SkillLibraryInstallResult['failed'] = []

    for (const targetInstanceId of input.targetInstanceIds) {
      const instance = instances.find((i) => i.id === targetInstanceId)
      if (!instance) {
        failed.push({
          targetInstanceId,
          targetInstanceName: targetInstanceId,
          error: 'Instance not found.'
        })
        continue
      }

      const targetSkillsDir = join(instance.codexHome, 'skills')
      const targetSkillDir = join(targetSkillsDir, dirName)

      if (await isSymlink(targetSkillsDir)) {
        failed.push({
          targetInstanceId,
          targetInstanceName: instance.name,
          error: 'Target skills directory is a symlink.'
        })
        continue
      }

      if (!isPathInsideBase(targetSkillsDir, targetSkillDir)) {
        failed.push({
          targetInstanceId,
          targetInstanceName: instance.name,
          error: 'Target path is outside instance skills directory.'
        })
        continue
      }

      try {
        try {
          await fs.access(targetSkillDir)
          installSkipped.push({
            targetInstanceId,
            targetInstanceName: instance.name,
            reason: 'Skill already exists in target instance.'
          })
          continue
        } catch (err) {
          if (!isMissingPathError(err)) throw err
        }

        await fs.mkdir(targetSkillsDir, { recursive: true })
        await fs.cp(sourceDir, targetSkillDir, {
          recursive: true,
          force: false,
          filter: async (src) => {
            if (await isSymlink(src)) return false
            if (basename(src) === META_FILE) return false
            return true
          }
        })

        installed.push({
          targetInstanceId,
          targetInstanceName: instance.name
        })
      } catch (err) {
        failed.push({
          targetInstanceId,
          targetInstanceName: instance.name,
          error: String(err instanceof Error ? err.message : err)
        })
      }
    }

    return { installed, skipped: installSkipped, failed }
  }

  return {
    list,
    detail,
    create,
    update,
    remove,
    listCategories,
    createCategory,
    renameCategory,
    removeCategory,
    importDir,
    exportDir,
    collect,
    install
  }
}
