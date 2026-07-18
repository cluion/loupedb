import { readBody } from 'h3'
import type { SavedQueryOrganizationPatch } from '#shared/types'
import { loadSavedQueries, saveSavedQueries } from '../../utils/savedQueryStore'
import { ok, fail } from '../../utils/api'
import { toDatabaseError } from '../../utils/errors'

const MAX_FOLDER_LENGTH = 100
const MAX_TAGS = 20
const MAX_TAG_LENGTH = 50

function invalid(message: string) {
  return fail({ code: 'VALIDATION', message, severity: 'error', retryable: false })
}

export default defineEventHandler(async (event) => {
  const name = decodeURIComponent(getRouterParam(event, 'name') as string)
  const body = await readBody<Record<string, unknown>>(event)
  const patch: SavedQueryOrganizationPatch = {}

  if (!('favorite' in body) && !('folder' in body) && !('tags' in body)) {
    return invalid('organization update is required')
  }
  if ('favorite' in body) {
    if (typeof body.favorite !== 'boolean') return invalid('favorite must be a boolean')
    Object.assign(patch, { favorite: body.favorite })
  }
  if ('folder' in body) {
    if (body.folder !== null && typeof body.folder !== 'string') return invalid('folder must be a string or null')
    const folder = typeof body.folder === 'string' ? body.folder.trim() : null
    if (folder && folder.length > MAX_FOLDER_LENGTH) {
      return invalid(`folder exceeds ${MAX_FOLDER_LENGTH} characters`)
    }
    Object.assign(patch, { folder: folder || null })
  }
  if ('tags' in body) {
    if (!Array.isArray(body.tags) || body.tags.some((tag) => typeof tag !== 'string')) {
      return invalid('tags must be an array of strings')
    }
    if (body.tags.length > MAX_TAGS) return invalid(`tags exceed ${MAX_TAGS} items`)
    const tags: string[] = []
    const seen = new Set<string>()
    for (const value of body.tags as string[]) {
      const tag = value.trim()
      if (tag.length > MAX_TAG_LENGTH) return invalid(`tag exceeds ${MAX_TAG_LENGTH} characters`)
      const key = tag.toLowerCase()
      if (!tag || seen.has(key)) continue
      seen.add(key)
      tags.push(tag)
    }
    Object.assign(patch, { tags })
  }

  try {
    const list = await loadSavedQueries()
    const existing = list.find((query) => query.name === name)
    if (!existing) {
      return fail({ code: 'NOT_FOUND', message: `saved query ${name} not found`, severity: 'error', retryable: false })
    }
    const saved = { ...existing, ...patch, updatedAt: Date.now() }
    await saveSavedQueries(list.map((query) => query.name === name ? saved : query))
    return ok(saved)
  } catch (error) {
    return fail(toDatabaseError(error))
  }
})
