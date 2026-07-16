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

export async function loadSavedQueries(): Promise<SavedQuery[]> {
  try {
    return JSON.parse(await readFile(file(), 'utf8')) as SavedQuery[]
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}

export async function saveSavedQueries(list: ReadonlyArray<SavedQuery>): Promise<void> {
  await mkdir(dataDir(), { recursive: true })
  await writeFile(file(), JSON.stringify(list, null, 2), 'utf8')
}
