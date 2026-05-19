import { parse as parseToml, stringify as stringifyToml } from '@iarna/toml'

export type CodexConfigToml = Record<string, unknown>

const managedConfigKeys = new Set(['model', 'model_provider', 'model_providers'])

function asTomlObject(value: unknown): CodexConfigToml {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as CodexConfigToml)
    : {}
}

function parseTomlObject(raw: string): CodexConfigToml {
  return raw.trim() ? asTomlObject(parseToml(raw)) : {}
}

function stripQuotedTomlKey(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed) as string
    } catch {
      return trimmed.slice(1, -1)
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function firstTomlPathSegment(path: string): string {
  const trimmed = path.trim()
  if (!trimmed) {
    return ''
  }

  if (trimmed.startsWith('"')) {
    const match = trimmed.match(/^"((?:[^"\\]|\\.)*)"/u)
    return match ? stripQuotedTomlKey(`"${match[1]}"`) : ''
  }

  if (trimmed.startsWith("'")) {
    const match = trimmed.match(/^'([^']*)'/u)
    return match ? stripQuotedTomlKey(`'${match[1]}'`) : ''
  }

  return stripQuotedTomlKey(trimmed.split('.')[0] ?? '')
}

function tomlTableKind(line: string): 'root' | 'feature' | 'model_providers' | 'other' | null {
  const trimmed = line.trim()
  const match = trimmed.match(/^\[\[?\s*([^\]]+?)\s*\]\]?\s*(?:#.*)?$/u)
  if (!match) {
    return null
  }

  const firstSegment = firstTomlPathSegment(match[1])
  if (firstSegment === 'model_providers') {
    return 'model_providers'
  }
  if (stripQuotedTomlKey(match[1].trim()) === 'feature') {
    return 'feature'
  }
  return 'other'
}

function tomlKey(line: string): string | null {
  const trimmed = line.trimStart()
  if (!trimmed || trimmed.startsWith('#')) {
    return null
  }

  const match = trimmed.match(/^("[^"]+"|'[^']+'|[A-Za-z0-9_-]+)\s*=/u)
  return match ? stripQuotedTomlKey(match[1]) : null
}

export function stripManagedCodexConfigToml(raw: string): string {
  const lines = raw.split(/\r?\n/u)
  const nextLines: string[] = []
  let tableKind: 'root' | 'feature' | 'model_providers' | 'other' = 'root'

  for (const line of lines) {
    const nextTableKind = tomlTableKind(line)
    if (nextTableKind) {
      tableKind = nextTableKind
      if (tableKind === 'model_providers') {
        continue
      }
      nextLines.push(line)
      continue
    }

    if (tableKind === 'model_providers') {
      continue
    }

    const key = tomlKey(line)
    if ((tableKind === 'root' || tableKind === 'feature') && key && managedConfigKeys.has(key)) {
      continue
    }
    if (tableKind === 'feature' && key === 'fast_mode') {
      continue
    }

    nextLines.push(line)
  }

  return nextLines.join('\n').trim() ? `${nextLines.join('\n').trimEnd()}\n` : ''
}

export function parseCodexConfigToml(raw: string): {
  config: CodexConfigToml
  repaired: boolean
} {
  try {
    return {
      config: parseTomlObject(raw),
      repaired: false
    }
  } catch {
    const stripped = stripManagedCodexConfigToml(raw)
    try {
      return {
        config: parseTomlObject(stripped),
        repaired: true
      }
    } catch {
      return {
        config: {},
        repaired: true
      }
    }
  }
}

export function stringifyCodexConfigToml(config: CodexConfigToml): string {
  if (!Object.keys(config).length) {
    return ''
  }

  const content = stringifyToml(config as Parameters<typeof stringifyToml>[0]).trimEnd()
  if (content) {
    parseToml(content)
  }
  return content ? `${content}\n` : ''
}
