import { promises as fs } from 'node:fs'
import { join, basename, dirname, extname, resolve } from 'node:path'

import {
  BUILT_IN_PROMPT_CATEGORIES,
  isBuiltInPromptCategory,
  type CreatePromptInput,
  type PromptAttachment,
  type PromptAttachmentData,
  type PromptAttachmentPayload,
  type PromptCategoryList,
  type PromptDetail,
  type PromptImportResult,
  type PromptSearchInput,
  type PromptSummary,
  type UpdatePromptInput
} from '../shared/codex'

const CATEGORIES_FILE = '.categories.json'
const ATTACHMENTS_DIR = '.attachments'
const MIGRATION_MARKER_FILE = '.migrated-legacy.json'
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
const ALLOWED_ATTACHMENT_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/bmp',
  'image/avif'
])
const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif'
}

export interface CreateCodexPromptServiceOptions {
  legacyUserDataPaths?: string[]
}

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
  attachments?: PromptAttachment[]
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

  const attachments = parseAttachmentsFromFrontmatter(frontmatter)

  return {
    title,
    categories: categories.length ? categories : undefined,
    createdAt,
    updatedAt,
    attachments: attachments.length ? attachments : undefined,
    body
  }
}

function parseAttachmentsFromFrontmatter(frontmatter: string): PromptAttachment[] {
  const marker = 'attachments:'
  const start = frontmatter.indexOf(marker)
  if (start < 0) {
    return []
  }
  const after = frontmatter.slice(start + marker.length)
  const lines = after.split('\n')
  const attachments: PromptAttachment[] = []
  let current: Partial<PromptAttachment> | null = null

  for (const rawLine of lines) {
    // detect start of a new top-level key (e.g. "title:", "createdAt:") at column 0
    if (rawLine.length && !rawLine.startsWith(' ') && !rawLine.startsWith('-')) {
      break
    }
    const itemMatch = rawLine.match(/^\s*-\s*(.*)$/u)
    if (itemMatch) {
      if (current && typeof current.fileName === 'string') {
        attachments.push({
          fileName: current.fileName,
          mimeType: current.mimeType || guessMimeType(current.fileName),
          size: typeof current.size === 'number' ? current.size : 0
        })
      }
      current = {}
      const rest = itemMatch[1]
      if (rest) {
        const kv = rest.match(/^(\w+):\s*(.+)$/u)
        if (kv) {
          applyAttachmentField(current, kv[1], kv[2])
        }
      }
      continue
    }
    if (!current) continue
    const kv = rawLine.match(/^\s+(\w+):\s*(.+)$/u)
    if (kv) {
      applyAttachmentField(current, kv[1], kv[2])
    }
  }

  if (current && typeof current.fileName === 'string') {
    attachments.push({
      fileName: current.fileName,
      mimeType: current.mimeType || guessMimeType(current.fileName),
      size: typeof current.size === 'number' ? current.size : 0
    })
  }

  return attachments
}

function applyAttachmentField(target: Partial<PromptAttachment>, key: string, value: string): void {
  const cleaned = value.trim().replace(/^["']|["']$/gu, '')
  if (key === 'fileName') {
    target.fileName = cleaned
  } else if (key === 'mimeType') {
    target.mimeType = cleaned
  } else if (key === 'size') {
    const n = Number(cleaned)
    target.size = Number.isFinite(n) ? n : 0
  }
}

function guessMimeType(fileName: string): string {
  const ext = extname(fileName).toLowerCase()
  return MIME_BY_EXT[ext] || 'application/octet-stream'
}

function decodeBase64Strict(input: unknown): Buffer {
  if (typeof input !== 'string' || !input.length) {
    throw new Error('Attachment payload is empty or not a string.')
  }
  const compact = input.replace(/\s+/gu, '')
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(compact) || compact.length % 4 !== 0) {
    throw new Error('Attachment payload is not valid base64.')
  }
  const buffer = Buffer.from(compact, 'base64')
  // round-trip guard: Node silently drops unknown chars; if lengths disagree the payload was malformed
  const expectedLen =
    (compact.length / 4) * 3 - (compact.endsWith('==') ? 2 : compact.endsWith('=') ? 1 : 0)
  if (buffer.byteLength !== expectedLen) {
    throw new Error('Attachment payload failed base64 round-trip validation.')
  }
  return buffer
}

function serializeFrontmatter(meta: {
  title: string
  categories: string[]
  createdAt: string
  updatedAt: string
  attachments?: PromptAttachment[]
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
  if (meta.attachments && meta.attachments.length) {
    lines.push('attachments:')
    for (const att of meta.attachments) {
      lines.push(`  - fileName: ${att.fileName}`)
      lines.push(`    mimeType: ${att.mimeType}`)
      lines.push(`    size: ${att.size}`)
    }
  }
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
  addAttachment(promptId: string, payload: PromptAttachmentPayload): Promise<PromptDetail>
  removeAttachment(promptId: string, fileName: string): Promise<PromptDetail>
  readAttachment(promptId: string, fileName: string): Promise<PromptAttachmentData>
}

async function readCategoriesFromDir(dir: string): Promise<string[]> {
  try {
    const raw = await fs.readFile(join(dir, CATEGORIES_FILE), 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

async function writeCategoriesToDir(dir: string, categories: string[]): Promise<void> {
  await fs.writeFile(join(dir, CATEGORIES_FILE), JSON.stringify(categories, null, 2), 'utf8')
}

function withBuiltInCategories(categories: string[]): string[] {
  const merged = [...categories]
  for (const name of BUILT_IN_PROMPT_CATEGORIES) {
    if (!merged.includes(name)) {
      merged.unshift(name)
    }
  }
  return merged
}

function sanitizeAttachmentFileName(fileName: string): string {
  const base = basename(fileName).replace(/[\\/\0]/gu, '_')
  return base.slice(0, 200) || 'attachment'
}

export function createCodexPromptService(
  userDataPath: string,
  options: CreateCodexPromptServiceOptions = {}
): CodexPromptService {
  const promptsDir = join(userDataPath, 'prompts')
  const legacyPromptsDirs = Array.from(
    new Set(
      (options.legacyUserDataPaths ?? [])
        .map((legacyUserDataPath) => join(legacyUserDataPath, 'prompts'))
        .filter((legacyPromptsDir) => resolve(legacyPromptsDir) !== resolve(promptsDir))
    )
  )
  let migrationPromise: Promise<void> | null = null

  async function ensureDir(): Promise<void> {
    migrationPromise ??= migrateLegacyPrompts()
    await migrationPromise
  }

  async function readCategoriesFile(): Promise<string[]> {
    await ensureDir()
    return readCategoriesFromDir(promptsDir)
  }

  async function writeCategoriesFile(categories: string[]): Promise<void> {
    await ensureDir()
    await writeCategoriesToDir(promptsDir, categories)
  }

  async function migrateLegacyPrompts(): Promise<void> {
    await fs.mkdir(promptsDir, { recursive: true })

    if (!legacyPromptsDirs.length) {
      return
    }

    const migratedSet = await readMigrationMarker()
    const pending = legacyPromptsDirs.filter((dir) => !migratedSet.has(resolve(dir)))
    if (!pending.length) {
      return
    }

    const categorySet = new Set(await readCategoriesFromDir(promptsDir))
    let categoriesChanged = false
    const existingContents = await readExistingPromptContents(promptsDir)

    for (const legacyPromptsDir of pending) {
      let entries: string[]
      try {
        const dirEntries = await fs.readdir(legacyPromptsDir, { withFileTypes: true })
        entries = dirEntries
          .filter(
            (entry) => entry.isFile() && entry.name.endsWith('.md') && !entry.name.startsWith('.')
          )
          .map((entry) => entry.name)
      } catch {
        migratedSet.add(resolve(legacyPromptsDir))
        continue
      }

      for (const category of await readCategoriesFromDir(legacyPromptsDir)) {
        if (!categorySet.has(category)) {
          categorySet.add(category)
          categoriesChanged = true
        }
      }

      for (const fileName of entries) {
        const sourcePath = join(legacyPromptsDir, fileName)
        const targetPath = join(promptsDir, fileName)
        const sourceContent = await fs.readFile(sourcePath, 'utf8')

        if (existingContents.has(sourceContent)) {
          continue
        }

        try {
          const existingContent = await fs.readFile(targetPath, 'utf8')
          if (existingContent === sourceContent) {
            existingContents.add(sourceContent)
            continue
          }

          const fallbackSlug = await findAvailableSlug(promptsDir, basename(fileName, '.md'))
          await fs.writeFile(join(promptsDir, `${fallbackSlug}.md`), sourceContent, 'utf8')
          existingContents.add(sourceContent)
        } catch (error) {
          if (!isMissingPathError(error)) {
            throw error
          }
          await fs.writeFile(targetPath, sourceContent, 'utf8')
          existingContents.add(sourceContent)
        }
      }

      migratedSet.add(resolve(legacyPromptsDir))
    }

    if (categoriesChanged) {
      await writeCategoriesToDir(promptsDir, [...categorySet])
    }
    await writeMigrationMarker(migratedSet)
  }

  async function readMigrationMarker(): Promise<Set<string>> {
    try {
      const raw = await fs.readFile(join(promptsDir, MIGRATION_MARKER_FILE), 'utf8')
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return new Set(
          parsed.filter((item): item is string => typeof item === 'string').map((p) => resolve(p))
        )
      }
    } catch {
      // missing or malformed marker — treat as empty
    }
    return new Set()
  }

  async function writeMigrationMarker(paths: Set<string>): Promise<void> {
    await fs.writeFile(
      join(promptsDir, MIGRATION_MARKER_FILE),
      JSON.stringify([...paths], null, 2),
      'utf8'
    )
  }

  async function readExistingPromptContents(dir: string): Promise<Set<string>> {
    const seen = new Set<string>()
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name.startsWith('.')) continue
        try {
          seen.add(await fs.readFile(join(dir, entry.name), 'utf8'))
        } catch {
          // skip unreadable
        }
      }
    } catch {
      // missing dir — nothing to seed
    }
    return seen
  }

  function parsePromptFile(
    fileName: string,
    content: string
  ): PromptSummary & { content: string; attachments: PromptAttachment[] } {
    const id = fileName.replace(/\.md$/u, '')
    const parsed = parseFrontmatter(content)
    return {
      id,
      title: parsed.title || id,
      categories: parsed.categories || [],
      createdAt: parsed.createdAt || new Date().toISOString(),
      updatedAt: parsed.updatedAt || new Date().toISOString(),
      content: parsed.body,
      attachments: parsed.attachments || []
    }
  }

  async function scanAllPrompts(): Promise<
    Array<PromptSummary & { content: string; attachments: PromptAttachment[] }>
  > {
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

    const results: Array<PromptSummary & { content: string; attachments: PromptAttachment[] }> = []
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
    await ensureDir()
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
      updatedAt: now,
      attachments: [] as PromptAttachment[]
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
      updatedAt: now,
      attachments: current.attachments
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
        await renameAttachmentDir(promptId, newSlug)
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
    await ensureDir()
    const filePath = join(promptsDir, `${promptId}.md`)
    try {
      await fs.unlink(filePath)
    } catch (error) {
      if (isMissingPathError(error)) {
        throw new Error(`Prompt "${promptId}" not found.`)
      }
      throw error
    }
    await fs.rm(attachmentDirFor(promptId), { recursive: true, force: true })
  }

  async function copy(promptId: string): Promise<string> {
    const prompt = await detail(promptId)
    return prompt.content
  }

  async function listCategories(): Promise<PromptCategoryList> {
    return { categories: withBuiltInCategories(await readCategoriesFile()) }
  }

  async function createCategory(name: string): Promise<PromptCategoryList> {
    if (isBuiltInPromptCategory(name)) {
      return { categories: withBuiltInCategories(await readCategoriesFile()) }
    }
    const categories = await readCategoriesFile()
    if (!categories.includes(name)) {
      categories.push(name)
      await writeCategoriesFile(categories)
    }
    return { categories: withBuiltInCategories(categories) }
  }

  async function renameCategory(oldName: string, newName: string): Promise<PromptCategoryList> {
    if (isBuiltInPromptCategory(oldName)) {
      throw new Error(`Category "${oldName}" is built-in and cannot be renamed.`)
    }
    if (isBuiltInPromptCategory(newName)) {
      throw new Error(`Category name "${newName}" is reserved.`)
    }
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
          updatedAt: prompt.updatedAt,
          attachments: prompt.attachments
        }
        const fileContent = `${serializeFrontmatter(meta)}\n\n${prompt.content}`
        await fs.writeFile(join(promptsDir, `${prompt.id}.md`), fileContent, 'utf8')
      }
    }

    return { categories: withBuiltInCategories(categories) }
  }

  async function removeCategory(name: string): Promise<PromptCategoryList> {
    if (isBuiltInPromptCategory(name)) {
      throw new Error(`Category "${name}" is built-in and cannot be removed.`)
    }
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
          updatedAt: prompt.updatedAt,
          attachments: prompt.attachments
        }
        const fileContent = `${serializeFrontmatter(meta)}\n\n${prompt.content}`
        await fs.writeFile(join(promptsDir, `${prompt.id}.md`), fileContent, 'utf8')
      }
    }

    return { categories: withBuiltInCategories(filtered) }
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
      const attachments = await importAttachmentsForFile(filePath, slug, parsed.attachments || [])
      const meta = {
        title,
        categories: parsed.categories || [],
        createdAt: parsed.createdAt || now,
        updatedAt: parsed.updatedAt || now,
        attachments
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

  async function importAttachmentsForFile(
    filePath: string,
    targetPromptId: string,
    attachments: PromptAttachment[]
  ): Promise<PromptAttachment[]> {
    if (!attachments.length) {
      return []
    }

    const sourcePromptId = basename(filePath, extname(filePath))
    const sourceDir = join(dirname(filePath), ATTACHMENTS_DIR, sourcePromptId)
    const targetDir = attachmentDirFor(targetPromptId)
    const copied: PromptAttachment[] = []
    const copiedNames = new Set<string>()

    for (const attachment of attachments) {
      const safeName = sanitizeAttachmentFileName(attachment.fileName)
      if (copiedNames.has(safeName)) {
        continue
      }

      const mimeType = attachment.mimeType || guessMimeType(safeName)
      if (!ALLOWED_ATTACHMENT_MIME.has(mimeType)) {
        continue
      }

      let buffer: Buffer
      try {
        buffer = await fs.readFile(join(sourceDir, safeName))
      } catch (error) {
        if (isMissingPathError(error)) {
          continue
        }
        throw error
      }

      if (buffer.byteLength > MAX_ATTACHMENT_BYTES) {
        continue
      }

      await fs.mkdir(targetDir, { recursive: true })
      await fs.writeFile(join(targetDir, safeName), buffer)
      copied.push({
        fileName: safeName,
        mimeType,
        size: buffer.byteLength
      })
      copiedNames.add(safeName)
    }

    return copied
  }

  async function exportDir(targetDir: string): Promise<{ exported: number }> {
    await fs.mkdir(targetDir, { recursive: true })
    const all = await scanAllPrompts()
    for (const prompt of all) {
      const meta = {
        title: prompt.title,
        categories: prompt.categories,
        createdAt: prompt.createdAt,
        updatedAt: prompt.updatedAt,
        attachments: prompt.attachments
      }
      const fileContent = `${serializeFrontmatter(meta)}\n\n${prompt.content}`
      await fs.writeFile(join(targetDir, `${prompt.id}.md`), fileContent, 'utf8')

      if (prompt.attachments.length) {
        const sourceDir = attachmentDirFor(prompt.id)
        const targetAttachmentsDir = join(targetDir, ATTACHMENTS_DIR, prompt.id)
        try {
          await fs.cp(sourceDir, targetAttachmentsDir, { recursive: true, force: true })
        } catch (error) {
          if (!isMissingPathError(error)) throw error
        }
      }
    }
    return { exported: all.length }
  }

  function attachmentDirFor(promptId: string): string {
    return join(promptsDir, ATTACHMENTS_DIR, promptId)
  }

  async function renameAttachmentDir(oldId: string, newId: string): Promise<void> {
    const from = attachmentDirFor(oldId)
    const to = attachmentDirFor(newId)
    try {
      await fs.rename(from, to)
    } catch (error) {
      if (isMissingPathError(error)) return
      throw error
    }
  }

  async function rewriteFrontmatter(
    promptId: string,
    attachments: PromptAttachment[]
  ): Promise<PromptDetail> {
    const current = await detail(promptId)
    const now = new Date().toISOString()
    const meta = {
      title: current.title,
      categories: current.categories,
      createdAt: current.createdAt,
      updatedAt: now,
      attachments
    }
    const fileContent = `${serializeFrontmatter(meta)}\n\n${current.content}`
    await fs.writeFile(join(promptsDir, `${promptId}.md`), fileContent, 'utf8')
    return { id: promptId, ...meta, content: current.content }
  }

  async function addAttachment(
    promptId: string,
    payload: PromptAttachmentPayload
  ): Promise<PromptDetail> {
    await ensureDir()
    const current = await detail(promptId)
    const cleanName = sanitizeAttachmentFileName(payload.fileName)
    const resolvedMime = payload.mimeType || guessMimeType(cleanName)
    if (!ALLOWED_ATTACHMENT_MIME.has(resolvedMime)) {
      throw new Error(
        `Attachment type "${resolvedMime}" is not allowed. Supported: ${[
          ...ALLOWED_ATTACHMENT_MIME
        ].join(', ')}.`
      )
    }

    const buffer = decodeBase64Strict(payload.dataBase64)
    if (buffer.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new Error(
        `Attachment exceeds maximum size of ${MAX_ATTACHMENT_BYTES} bytes (got ${buffer.byteLength}).`
      )
    }

    const dir = attachmentDirFor(promptId)
    await fs.mkdir(dir, { recursive: true })

    const ext = extname(cleanName)
    const base = cleanName.slice(0, cleanName.length - ext.length) || 'file'
    const existingNames = new Set(current.attachments.map((a) => a.fileName))
    let finalName = cleanName
    let counter = 1
    while (existingNames.has(finalName)) {
      counter += 1
      finalName = `${base}-${counter}${ext}`
    }

    await fs.writeFile(join(dir, finalName), buffer)

    const attachment: PromptAttachment = {
      fileName: finalName,
      mimeType: resolvedMime,
      size: buffer.byteLength
    }
    return rewriteFrontmatter(promptId, [...current.attachments, attachment])
  }

  async function removeAttachment(promptId: string, fileName: string): Promise<PromptDetail> {
    await ensureDir()
    const current = await detail(promptId)
    const safeName = sanitizeAttachmentFileName(fileName)
    const nextList = current.attachments.filter((a) => a.fileName !== safeName)
    try {
      await fs.unlink(join(attachmentDirFor(promptId), safeName))
    } catch (error) {
      if (!isMissingPathError(error)) throw error
    }
    return rewriteFrontmatter(promptId, nextList)
  }

  async function readAttachment(promptId: string, fileName: string): Promise<PromptAttachmentData> {
    await ensureDir()
    const safeName = sanitizeAttachmentFileName(fileName)
    const current = await detail(promptId)
    const meta = current.attachments.find((a) => a.fileName === safeName)
    let buffer: Buffer
    try {
      buffer = await fs.readFile(join(attachmentDirFor(promptId), safeName))
    } catch (error) {
      if (isMissingPathError(error)) {
        throw new Error(`Attachment "${safeName}" not found on prompt "${promptId}".`)
      }
      throw error
    }
    return {
      fileName: safeName,
      mimeType: meta?.mimeType || guessMimeType(safeName),
      size: buffer.byteLength,
      dataBase64: buffer.toString('base64')
    }
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
    exportDir,
    addAttachment,
    removeAttachment,
    readAttachment
  }
}
