import { readBody } from 'h3'
import type { SavedQuery } from '#shared/types'
import { loadSavedQueries, saveSavedQueries } from '../../utils/savedQueryStore'
import { ok, fail } from '../../utils/api'
import { toDatabaseError } from '../../utils/errors'

const MAX_NAME_LENGTH = 200
const MAX_SQL_LENGTH = 100_000

function invalid(message: string) {
  return fail({ code: 'VALIDATION', message, severity: 'error', retryable: false })
}

// upsert by name: saving under an existing name replaces its sql
export default defineEventHandler(async (event) => {
  const body = await readBody<{ name?: unknown, sql?: unknown }>(event)
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const sql = typeof body.sql === 'string' ? body.sql : ''
  if (!name) return invalid('name is required')
  if (name.length > MAX_NAME_LENGTH) return invalid(`name exceeds ${MAX_NAME_LENGTH} characters`)
  if (!sql.trim()) return invalid('sql is required')
  if (sql.length > MAX_SQL_LENGTH) return invalid(`sql exceeds ${MAX_SQL_LENGTH} characters`)

  try {
    const list = await loadSavedQueries()
    const existing = list.find((q) => q.name === name)
    const now = Date.now()
    const saved: SavedQuery = {
      name,
      sql,
      favorite: existing?.favorite ?? false,
      folder: existing?.folder ?? null,
      tags: existing?.tags ?? [],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    await saveSavedQueries([...list.filter((q) => q.name !== name), saved])
    return ok(saved)
  } catch (err) {
    return fail(toDatabaseError(err))
  }
})
