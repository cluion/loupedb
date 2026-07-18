import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { SavedQuery } from '#shared/types'

// plain JSON on disk - saved queries carry no credentials, unlike connectionStore

function dataDir(): string {
  return process.env.LOUPEDB_DATA_DIR ?? './data'
}

function file(): string {
  return join(dataDir(), 'saved-queries.json')
}

function normalizedTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const tags: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'string') continue
    const tag = item.trim()
    const key = tag.toLowerCase()
    if (!tag || seen.has(key)) continue
    seen.add(key)
    tags.push(tag)
  }
  return tags
}

function normalizeSavedQuery(value: unknown): SavedQuery {
  if (!value || typeof value !== 'object') throw new Error('invalid saved query entry')
  const entry = value as Record<string, unknown>
  if (
    typeof entry.name !== 'string'
    || typeof entry.sql !== 'string'
    || typeof entry.createdAt !== 'number'
    || typeof entry.updatedAt !== 'number'
  ) throw new Error('invalid saved query entry')
  return {
    name: entry.name,
    sql: entry.sql,
    favorite: entry.favorite === true,
    folder: typeof entry.folder === 'string' && entry.folder.trim() ? entry.folder.trim() : null,
    tags: normalizedTags(entry.tags),
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  }
}

export async function loadSavedQueries(): Promise<SavedQuery[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(file(), 'utf8'))
    if (!Array.isArray(parsed)) throw new Error('invalid saved queries file')
    return parsed.map(normalizeSavedQuery)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}

export async function saveSavedQueries(list: ReadonlyArray<SavedQuery>): Promise<void> {
  await mkdir(dataDir(), { recursive: true })
  await writeFile(file(), JSON.stringify(list, null, 2), 'utf8')
}
