import { promises as fs } from 'node:fs'
import { join, basename, extname } from 'node:path'

import type {
  CreatePromptInput,
  PromptCategoryList,
  PromptDetail,
  PromptImportResult,
  PromptSearchInput,
  PromptSummary,
  UpdatePromptInput
} from '../shared/codex'

const CATEGORIES_FILE = '.categories.json'

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT'
  )
}

interface ParsedFrontmatter {
  title?: string
  categories?: string[]
  createdAt?: string
  updatedAt?: string
  body: string
}

function parseFrontmatter(content: string): ParsedFrontmatter {
  const trimmed = content.trimStart()
  if (!trimmed.startsWith('---')) {
    return { body: content }
  }

  const end = trimmed.indexOf('\n---', 3)
  if (end < 0) {
    return { body: content }
  }

  const frontmatter = trimmed.slice(3, end).trim()
  const body = trimmed.slice(end + 4).trimStart()

  const titleMatch = frontmatter.match(/^title:\s*(.+)$/mu)
  const createdAtMatch = frontmatter.match(/^createdAt:\s*(.+)$/mu)
  const updatedAtMatch = frontmatter.match(/^updatedAt:\s*(.+)$/mu)

  const title = titleMatch?.[1]?.trim().replace(/^["']|["']$/gu, '')
  const createdAt = createdAtMatch?.[1]?.trim()
  const updatedAt = updatedAtMatch?.[1]?.trim()

  const categories: string[] = []
  const categoriesStart = frontmatter.indexOf('categories:')
  if (categoriesStart >= 0) {
    const afterCategories = frontmatter.slice(categoriesStart + 'categories:'.length)
    const lines = afterCategories.split('\n')
    for (const line of lines) {
      const itemMatch = line.match(/^\s*-\s+(.+)$/u)
      if (itemMatch) {
        categories.push(itemMatch[1].trim().replace(/^["']|["']$/gu, ''))
      } else if (line.trim() && !line.match(/^\s*-/u)) {
        break
      }
    }
  }

  return {
    title,
    categories: categories.length ? categories : undefined,
    createdAt,
    updatedAt,
    body
  }
}

function serializeFrontmatter(meta: {
  title: string
  categories: string[]
  createdAt: string
  updatedAt: string
}): string {
  const lines = ['---', `title: ${meta.title}`]
  if (meta.categories.length) {
    lines.push('categories:')
    for (const cat of meta.categories) {
      lines.push(`  - ${cat}`)
    }
  }
  lines.push(`createdAt: ${meta.createdAt}`)
  lines.push(`updatedAt: ${meta.updatedAt}`)
  lines.push('---')
  return lines.join('\n')
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

async function findAvailableSlug(dir: string, baseSlug: string): Promise<string> {
  let slug = baseSlug
  let counter = 1
  while (true) {
    try {
      await fs.access(join(dir, `${slug}.md`))
      counter++
      slug = `${baseSlug}-${counter}`
    } catch {
      return slug
    }
  }
}

export interface CodexPromptService {
  list(input?: PromptSearchInput): Promise<PromptSummary[]>
  detail(promptId: string): Promise<PromptDetail>
  create(input: CreatePromptInput): Promise<PromptDetail>
  update(promptId: string, input: UpdatePromptInput): Promise<PromptDetail>
  remove(promptId: string): Promise<void>
  copy(promptId: string): Promise<string>
  listCategories(): Promise<PromptCategoryList>
  createCategory(name: string): Promise<PromptCategoryList>
  renameCategory(oldName: string, newName: string): Promise<PromptCategoryList>
  removeCategory(name: string): Promise<PromptCategoryList>
  importFile(filePath: string): Promise<PromptImportResult>
  importDir(dirPath: string): Promise<PromptImportResult>
  exportDir(targetDir: string): Promise<{ exported: number }>
}

export function createCodexPromptService(userDataPath: string): CodexPromptService {
  const promptsDir = join(userDataPath, 'prompts')

  async function ensureDir(): Promise<void> {
    await fs.mkdir(promptsDir, { recursive: true })
  }

  async function readCategoriesFile(): Promise<string[]> {
    try {
      const raw = await fs.readFile(join(promptsDir, CATEGORIES_FILE), 'utf8')
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === 'string')
        : []
    } catch {
      return []
    }
  }

  async function writeCategoriesFile(categories: string[]): Promise<void> {
    await ensureDir()
    await fs.writeFile(
      join(promptsDir, CATEGORIES_FILE),
      JSON.stringify(categories, null, 2),
      'utf8'
    )
  }

  function parsePromptFile(fileName: string, content: string): PromptSummary & { content: string } {
    const id = fileName.replace(/\.md$/u, '')
    const parsed = parseFrontmatter(content)
    return {
      id,
      title: parsed.title || id,
      categories: parsed.categories || [],
      createdAt: parsed.createdAt || new Date().toISOString(),
      updatedAt: parsed.updatedAt || new Date().toISOString(),
      content: parsed.body
    }
  }

  async function scanAllPrompts(): Promise<Array<PromptSummary & { content: string }>> {
    await ensureDir()
    let entries: string[]
    try {
      const dirEntries = await fs.readdir(promptsDir, { withFileTypes: true })
      entries = dirEntries
        .filter(
          (entry) => entry.isFile() && entry.name.endsWith('.md') && !entry.name.startsWith('.')
        )
        .map((entry) => entry.name)
    } catch {
      return []
    }

    const results: Array<PromptSummary & { content: string }> = []
    for (const fileName of entries) {
      try {
        const content = await fs.readFile(join(promptsDir, fileName), 'utf8')
        results.push(parsePromptFile(fileName, content))
      } catch {
        // skip unreadable files
      }
    }

    return results
  }

  async function list(input?: PromptSearchInput): Promise<PromptSummary[]> {
    const all = await scanAllPrompts()
    let filtered = all

    if (input?.category) {
      const cat = input.category.toLowerCase()
      filtered = filtered.filter((p) => p.categories.some((c) => c.toLowerCase() === cat))
    }

    if (input?.query) {
      const q = input.query.toLowerCase()
      filtered = filtered.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.content.toLowerCase().includes(q) ||
          p.categories.some((c) => c.toLowerCase().includes(q))
      )
    }

    return filtered.map((prompt) => ({
      id: prompt.id,
      title: prompt.title,
      categories: prompt.categories,
      createdAt: prompt.createdAt,
      updatedAt: prompt.updatedAt
    }))
  }

  async function detail(promptId: string): Promise<PromptDetail> {
    const filePath = join(promptsDir, `${promptId}.md`)
    let raw: string
    try {
      raw = await fs.readFile(filePath, 'utf8')
    } catch (error) {
      if (isMissingPathError(error)) {
        throw new Error(`Prompt "${promptId}" not found.`)
      }
      throw error
    }
    const parsed = parsePromptFile(`${promptId}.md`, raw)
    return parsed
  }

  async function create(input: CreatePromptInput): Promise<PromptDetail> {
    await ensureDir()
    const baseSlug = slugify(input.title)
    const slug = await findAvailableSlug(promptsDir, baseSlug)
    const now = new Date().toISOString()
    const meta = {
      title: input.title,
      categories: input.categories || [],
      createdAt: now,
      updatedAt: now
    }
    const fileContent = `${serializeFrontmatter(meta)}\n\n${input.content}`
    await fs.writeFile(join(promptsDir, `${slug}.md`), fileContent, 'utf8')
    return { id: slug, ...meta, content: input.content }
  }

  async function update(promptId: string, input: UpdatePromptInput): Promise<PromptDetail> {
    const current = await detail(promptId)
    const nextTitle = input.title ?? current.title
    const nextContent = input.content ?? current.content
    const nextCategories = input.clearCategories ? [] : (input.categories ?? current.categories)
    const now = new Date().toISOString()
    const meta = {
      title: nextTitle,
      categories: nextCategories,
      createdAt: current.createdAt,
      updatedAt: now
    }
    const fileContent = `${serializeFrontmatter(meta)}\n\n${nextContent}`

    let finalId = promptId
    if (input.title && slugify(input.title) !== promptId) {
      const baseSlug = slugify(input.title)
      const newSlug =
        baseSlug === promptId ? promptId : await findAvailableSlug(promptsDir, baseSlug)
      if (newSlug !== promptId) {
        await fs.writeFile(join(promptsDir, `${newSlug}.md`), fileContent, 'utf8')
        await fs.unlink(join(promptsDir, `${promptId}.md`))
        finalId = newSlug
      } else {
        await fs.writeFile(join(promptsDir, `${promptId}.md`), fileContent, 'utf8')
      }
    } else {
      await fs.writeFile(join(promptsDir, `${promptId}.md`), fileContent, 'utf8')
    }

    return { id: finalId, ...meta, content: nextContent }
  }

  async function remove(promptId: string): Promise<void> {
    const filePath = join(promptsDir, `${promptId}.md`)
    try {
      await fs.unlink(filePath)
    } catch (error) {
      if (isMissingPathError(error)) {
        throw new Error(`Prompt "${promptId}" not found.`)
      }
      throw error
    }
  }

  async function copy(promptId: string): Promise<string> {
    const prompt = await detail(promptId)
    return prompt.content
  }

  async function listCategories(): Promise<PromptCategoryList> {
    return { categories: await readCategoriesFile() }
  }

  async function createCategory(name: string): Promise<PromptCategoryList> {
    const categories = await readCategoriesFile()
    if (!categories.includes(name)) {
      categories.push(name)
      await writeCategoriesFile(categories)
    }
    return { categories }
  }

  async function renameCategory(oldName: string, newName: string): Promise<PromptCategoryList> {
    const categories = await readCategoriesFile()
    const index = categories.indexOf(oldName)
    if (index >= 0) {
      categories[index] = newName
      await writeCategoriesFile(categories)
    }

    const all = await scanAllPrompts()
    for (const prompt of all) {
      if (prompt.categories.includes(oldName)) {
        const updated = prompt.categories.map((c) => (c === oldName ? newName : c))
        const meta = {
          title: prompt.title,
          categories: updated,
          createdAt: prompt.createdAt,
          updatedAt: prompt.updatedAt
        }
        const fileContent = `${serializeFrontmatter(meta)}\n\n${prompt.content}`
        await fs.writeFile(join(promptsDir, `${prompt.id}.md`), fileContent, 'utf8')
      }
    }

    return { categories }
  }

  async function removeCategory(name: string): Promise<PromptCategoryList> {
    const categories = await readCategoriesFile()
    const filtered = categories.filter((c) => c !== name)
    await writeCategoriesFile(filtered)

    const all = await scanAllPrompts()
    for (const prompt of all) {
      if (prompt.categories.includes(name)) {
        const updated = prompt.categories.filter((c) => c !== name)
        const meta = {
          title: prompt.title,
          categories: updated,
          createdAt: prompt.createdAt,
          updatedAt: prompt.updatedAt
        }
        const fileContent = `${serializeFrontmatter(meta)}\n\n${prompt.content}`
        await fs.writeFile(join(promptsDir, `${prompt.id}.md`), fileContent, 'utf8')
      }
    }

    return { categories: filtered }
  }

  async function importSingleFile(
    filePath: string
  ): Promise<{ imported: boolean; error?: string }> {
    try {
      const raw = await fs.readFile(filePath, 'utf8')
      const parsed = parseFrontmatter(raw)
      const title = parsed.title || basename(filePath, extname(filePath))
      const baseSlug = slugify(title)
      const slug = await findAvailableSlug(promptsDir, baseSlug)
      const now = new Date().toISOString()
      const meta = {
        title,
        categories: parsed.categories || [],
        createdAt: parsed.createdAt || now,
        updatedAt: parsed.updatedAt || now
      }
      const fileContent = `${serializeFrontmatter(meta)}\n\n${parsed.body}`
      await fs.writeFile(join(promptsDir, `${slug}.md`), fileContent, 'utf8')
      return { imported: true }
    } catch (error) {
      return { imported: false, error: String(error instanceof Error ? error.message : error) }
    }
  }

  async function importFile(filePath: string): Promise<PromptImportResult> {
    await ensureDir()
    const result = await importSingleFile(filePath)
    return {
      imported: result.imported ? 1 : 0,
      skipped: result.imported ? 0 : 1,
      errors: result.error ? [result.error] : []
    }
  }

  async function importDir(dirPath: string): Promise<PromptImportResult> {
    await ensureDir()
    let entries: string[]
    try {
      const dirEntries = await fs.readdir(dirPath, { withFileTypes: true })
      entries = dirEntries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
        .map((entry) => join(dirPath, entry.name))
    } catch {
      throw new Error(`Cannot read directory: ${dirPath}`)
    }

    let imported = 0
    let skipped = 0
    const errors: string[] = []

    for (const filePath of entries) {
      const result = await importSingleFile(filePath)
      if (result.imported) {
        imported++
      } else {
        skipped++
        if (result.error) {
          errors.push(result.error)
        }
      }
    }

    return { imported, skipped, errors }
  }

  async function exportDir(targetDir: string): Promise<{ exported: number }> {
    await fs.mkdir(targetDir, { recursive: true })
    const all = await scanAllPrompts()
    for (const prompt of all) {
      const meta = {
        title: prompt.title,
        categories: prompt.categories,
        createdAt: prompt.createdAt,
        updatedAt: prompt.updatedAt
      }
      const fileContent = `${serializeFrontmatter(meta)}\n\n${prompt.content}`
      await fs.writeFile(join(targetDir, `${prompt.id}.md`), fileContent, 'utf8')
    }
    return { exported: all.length }
  }

  return {
    list,
    detail,
    create,
    update,
    remove,
    copy,
    listCategories,
    createCategory,
    renameCategory,
    removeCategory,
    importFile,
    importDir,
    exportDir
  }
}
