import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'

export interface PersistedCodexInstance {
  id: string
  name: string
  codexHome: string
  bindAccountId?: string
  extraArgs: string
  createdAt: string
  updatedAt: string
  lastLaunchedAt?: string
  lastPid?: number
}

export interface PersistedDefaultCodexInstance {
  bindAccountId?: string
  extraArgs: string
  updatedAt: string
  lastLaunchedAt?: string
  lastPid?: number
}

interface PersistedCodexInstancesState {
  version: 1
  defaultInstance: PersistedDefaultCodexInstance
  instances: PersistedCodexInstance[]
}

function defaultState(): PersistedCodexInstancesState {
  return {
    version: 1,
    defaultInstance: {
      extraArgs: '',
      updatedAt: new Date(0).toISOString()
    },
    instances: []
  }
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function slugifyName(value: string): string {
  const normalized = normalizeName(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalized || 'instance'
}

async function pathExists(value: string): Promise<boolean> {
  try {
    await fs.access(value)
    return true
  } catch {
    return false
  }
}

const syncedConfigEntries = new Set([
  'config.toml',
  'memory.md',
  'instructions.md',
  'prompts',
  'automations'
])

export class CodexInstanceStore {
  private readonly stateFile: string
  private readonly instanceRootDir: string
  readonly defaultCodexHome: string

  constructor(userDataPath: string, defaultCodexHome = join(homedir(), '.codex')) {
    this.stateFile = join(userDataPath, 'codex-instances.json')
    this.instanceRootDir = join(userDataPath, 'codex-instance-homes')
    this.defaultCodexHome = defaultCodexHome
  }

  getDefaults(): { rootDir: string; defaultCodexHome: string } {
    return {
      rootDir: this.instanceRootDir,
      defaultCodexHome: this.defaultCodexHome
    }
  }

  async list(): Promise<PersistedCodexInstance[]> {
    return (await this.readState()).instances
  }

  async getDefaultInstance(): Promise<PersistedDefaultCodexInstance> {
    return (await this.readState()).defaultInstance
  }

  async create(params: {
    name: string
    codexHome?: string
    bindAccountId?: string
    extraArgs?: string
  }): Promise<PersistedCodexInstance> {
    const state = await this.readState()
    const name = normalizeName(params.name)
    if (!name) {
      throw new Error('Instance name is required.')
    }

    const codexHome = resolve(
      params.codexHome?.trim() ||
        join(this.instanceRootDir, `${slugifyName(name)}-${randomUUID().slice(0, 8)}`)
    )

    this.assertUnique(state.instances, name, codexHome)

    const now = new Date().toISOString()
    const instance: PersistedCodexInstance = {
      id: randomUUID(),
      name,
      codexHome,
      bindAccountId: params.bindAccountId?.trim() || undefined,
      extraArgs: params.extraArgs?.trim() || '',
      createdAt: now,
      updatedAt: now
    }

    state.instances.unshift(instance)
    await this.writeState(state)
    return instance
  }

  async update(
    instanceId: string,
    params: {
      name?: string
      bindAccountId?: string | null
      extraArgs?: string
    }
  ): Promise<PersistedCodexInstance> {
    const state = await this.readState()
    const instance = state.instances.find((item) => item.id === instanceId)
    if (!instance) {
      throw new Error('Instance not found.')
    }

    if (typeof params.name === 'string') {
      const name = normalizeName(params.name)
      if (!name) {
        throw new Error('Instance name is required.')
      }
      this.assertUnique(state.instances, name, instance.codexHome, instance.id)
      instance.name = name
    }

    if (params.bindAccountId !== undefined) {
      instance.bindAccountId = params.bindAccountId?.trim() || undefined
    }

    if (typeof params.extraArgs === 'string') {
      instance.extraArgs = params.extraArgs.trim()
    }

    instance.updatedAt = new Date().toISOString()
    await this.writeState(state)
    return instance
  }

  async remove(instanceId: string): Promise<void> {
    const state = await this.readState()
    const index = state.instances.findIndex((item) => item.id === instanceId)
    if (index < 0) {
      throw new Error('Instance not found.')
    }

    const [removed] = state.instances.splice(index, 1)
    await this.writeState(state)

    if (removed.codexHome && removed.codexHome !== this.defaultCodexHome) {
      await fs.rm(removed.codexHome, { recursive: true, force: true })
    }
  }

  async markLaunched(instanceId: string, pid: number): Promise<PersistedCodexInstance> {
    const state = await this.readState()
    const instance = state.instances.find((item) => item.id === instanceId)
    if (!instance) {
      throw new Error('Instance not found.')
    }

    const now = new Date().toISOString()
    instance.lastPid = pid
    instance.lastLaunchedAt = now
    instance.updatedAt = now
    await this.writeState(state)
    return instance
  }

  async markStopped(instanceId: string): Promise<PersistedCodexInstance> {
    return this.setInstancePid(instanceId, null)
  }

  async setInstancePid(instanceId: string, pid: number | null): Promise<PersistedCodexInstance> {
    const state = await this.readState()
    const instance = state.instances.find((item) => item.id === instanceId)
    if (!instance) {
      throw new Error('Instance not found.')
    }

    instance.lastPid = pid ?? undefined
    instance.updatedAt = new Date().toISOString()
    await this.writeState(state)
    return instance
  }

  async updateDefaultInstance(params: {
    bindAccountId?: string | null
    extraArgs?: string
    lastPid?: number | null
    touchLaunch?: boolean
  }): Promise<PersistedDefaultCodexInstance> {
    const state = await this.readState()
    const now = new Date().toISOString()

    if (params.bindAccountId !== undefined) {
      state.defaultInstance.bindAccountId = params.bindAccountId?.trim() || undefined
    }

    if (typeof params.extraArgs === 'string') {
      state.defaultInstance.extraArgs = params.extraArgs.trim()
    }

    if (params.lastPid !== undefined) {
      state.defaultInstance.lastPid = params.lastPid ?? undefined
    }

    if (params.touchLaunch) {
      state.defaultInstance.lastLaunchedAt = now
    }

    state.defaultInstance.updatedAt = now
    await this.writeState(state)
    return state.defaultInstance
  }

  async getInstance(instanceId: string): Promise<PersistedCodexInstance> {
    const instance = (await this.readState()).instances.find((item) => item.id === instanceId)
    if (!instance) {
      throw new Error('Instance not found.')
    }
    return instance
  }

  async findByBoundAccountId(accountId: string): Promise<PersistedCodexInstance | null> {
    const normalizedAccountId = accountId.trim()
    if (!normalizedAccountId) {
      return null
    }

    return (
      (await this.readState()).instances.find(
        (item) => item.bindAccountId === normalizedAccountId
      ) ?? null
    )
  }

  async ensureAccountInstance(params: {
    accountId: string
    label: string
  }): Promise<PersistedCodexInstance> {
    const existing = await this.findByBoundAccountId(params.accountId)
    if (existing) {
      return existing
    }

    const preferredDir = join(this.instanceRootDir, `account-${slugifyName(params.accountId)}`)
    return this.create({
      name: params.label,
      codexHome: preferredDir,
      bindAccountId: params.accountId
    })
  }

  async isInitialized(codexHome: string): Promise<boolean> {
    if (!(await pathExists(codexHome))) {
      return false
    }

    const entries = await fs.readdir(codexHome)
    return entries.length > 0
  }

  async ensureInitialized(codexHome: string): Promise<void> {
    if (await this.isInitialized(codexHome)) {
      return
    }

    await fs.mkdir(codexHome, { recursive: true })
  }

  async syncConfigFromDefault(codexHome: string): Promise<void> {
    if (resolve(codexHome) === resolve(this.defaultCodexHome)) {
      return
    }

    if (!(await pathExists(this.defaultCodexHome))) {
      return
    }

    await fs.mkdir(codexHome, { recursive: true })
    await fs.cp(this.defaultCodexHome, codexHome, {
      recursive: true,
      force: true,
      filter: (sourcePath) => {
        const relativePath = relative(this.defaultCodexHome, sourcePath)
        if (!relativePath || relativePath === '') {
          return true
        }

        const topLevelEntry = relativePath.split(sep)[0]
        return syncedConfigEntries.has(topLevelEntry)
      }
    })
  }

  private assertUnique(
    instances: PersistedCodexInstance[],
    name: string,
    codexHome: string,
    ignoreId?: string
  ): void {
    const normalizedName = name.toLowerCase()
    const normalizedPath = codexHome.toLowerCase()

    for (const instance of instances) {
      if (instance.id === ignoreId) {
        continue
      }

      if (instance.name.toLowerCase() === normalizedName) {
        throw new Error('Instance name already exists.')
      }

      if (resolve(instance.codexHome).toLowerCase() === normalizedPath) {
        throw new Error('Instance directory already exists.')
      }
    }
  }

  private async readState(): Promise<PersistedCodexInstancesState> {
    try {
      const raw = await fs.readFile(this.stateFile, 'utf8')
      const parsed = JSON.parse(raw) as Partial<PersistedCodexInstancesState>
      return {
        ...defaultState(),
        ...parsed,
        version: 1,
        defaultInstance: {
          ...defaultState().defaultInstance,
          ...(parsed.defaultInstance ?? {})
        },
        instances: (parsed.instances ?? []).map((instance) => ({
          ...instance,
          name: normalizeName(instance.name ?? ''),
          codexHome: resolve(
            instance.codexHome ?? join(this.instanceRootDir, basename(instance.id ?? 'instance'))
          )
        }))
      }
    } catch {
      return defaultState()
    }
  }

  private async writeState(state: PersistedCodexInstancesState): Promise<void> {
    await fs.mkdir(dirname(this.stateFile), { recursive: true })
    await fs.writeFile(this.stateFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  }
}
