import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'
import type { Envelope, SavedQuery } from '#shared/types'

// server process inherits these via spawn env
const dataDir = mkdtempSync(join(tmpdir(), 'loupedb-api-'))
process.env.LOUPEDB_MASTER_KEY = 'a'.repeat(64)
process.env.LOUPEDB_DATA_DIR = dataDir

describe('saved queries API', async () => {
  await setup({ server: true, browser: false })

  it('loads legacy entries with empty organization metadata', async () => {
    writeFileSync(join(dataDir, 'saved-queries.json'), JSON.stringify([{
      name: 'legacy', sql: 'select 0;', createdAt: 1, updatedAt: 2,
    }]))

    const list = await $fetch<Envelope<SavedQuery[]>>('/api/saved-queries')
    expect(list.ok).toBe(true)
    if (list.ok) {
      expect(list.data).toContainEqual({
        name: 'legacy', sql: 'select 0;', favorite: false, folder: null, tags: [], createdAt: 1, updatedAt: 2,
      })
    }
  })

  it('POST stores a query and GET lists it back', async () => {
    const saved = await $fetch<Envelope<SavedQuery>>('/api/saved-queries', {
      method: 'POST', body: { name: 'daily report', sql: 'select 1;' },
    })
    expect(saved.ok).toBe(true)
    if (saved.ok) {
      expect(saved.data.name).toBe('daily report')
      expect(saved.data).toMatchObject({ favorite: false, folder: null, tags: [] })
      expect(saved.data.createdAt).toBeTypeOf('number')
      expect(saved.data.updatedAt).toBe(saved.data.createdAt)
    }

    const list = await $fetch<Envelope<SavedQuery[]>>('/api/saved-queries')
    expect(list.ok).toBe(true)
    if (list.ok) expect(list.data.map((q) => q.name)).toContain('daily report')
  })

  it('same-name POST upserts: sql updates, createdAt survives, updatedAt bumps', async () => {
    const first = await $fetch<Envelope<SavedQuery>>('/api/saved-queries', {
      method: 'POST', body: { name: 'upsert-me', sql: 'select 1;' },
    })
    await new Promise((resolve) => setTimeout(resolve, 5))
    const second = await $fetch<Envelope<SavedQuery>>('/api/saved-queries', {
      method: 'POST', body: { name: 'upsert-me', sql: 'select 2;' },
    })
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(second.data.sql).toBe('select 2;')
    expect(second.data.createdAt).toBe(first.data.createdAt)
    expect(second.data.updatedAt).toBeGreaterThan(first.data.updatedAt)

    const list = await $fetch<Envelope<SavedQuery[]>>('/api/saved-queries')
    if (list.ok) expect(list.data.filter((q) => q.name === 'upsert-me')).toHaveLength(1)
  })

  it('PATCH organizes a query and same-name POST preserves the metadata', async () => {
    await $fetch('/api/saved-queries', {
      method: 'POST', body: { name: 'organized', sql: 'select 1;' },
    })
    const organized = await $fetch<Envelope<SavedQuery>>('/api/saved-queries/organized', {
      method: 'PATCH',
      body: { favorite: true, folder: ' Reports ', tags: ['daily', 'Audit', 'DAILY', ''] },
    })
    expect(organized.ok).toBe(true)
    if (organized.ok) {
      expect(organized.data).toMatchObject({
        favorite: true, folder: 'Reports', tags: ['daily', 'Audit'],
      })
    }

    const updated = await $fetch<Envelope<SavedQuery>>('/api/saved-queries', {
      method: 'POST', body: { name: 'organized', sql: 'select 2;' },
    })
    expect(updated.ok).toBe(true)
    if (updated.ok) {
      expect(updated.data).toMatchObject({
        sql: 'select 2;', favorite: true, folder: 'Reports', tags: ['daily', 'Audit'],
      })
    }
  })

  it('validates organization updates and reports missing queries', async () => {
    const invalidFavorite = await $fetch<Envelope<never>>('/api/saved-queries/organized', {
      method: 'PATCH', body: { favorite: 'yes' },
    })
    expect(invalidFavorite.ok).toBe(false)
    if (!invalidFavorite.ok) expect(invalidFavorite.error.code).toBe('VALIDATION')

    const tooManyTags = await $fetch<Envelope<never>>('/api/saved-queries/organized', {
      method: 'PATCH', body: { tags: Array.from({ length: 21 }, (_, index) => `tag-${index}`) },
    })
    expect(tooManyTags.ok).toBe(false)
    if (!tooManyTags.ok) expect(tooManyTags.error.code).toBe('VALIDATION')

    const missing = await $fetch<Envelope<never>>('/api/saved-queries/missing', {
      method: 'PATCH', body: { favorite: true },
    })
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error.code).toBe('NOT_FOUND')
  })

  it('rejects blank name or sql with a VALIDATION envelope', async () => {
    const noName = await $fetch<Envelope<never>>('/api/saved-queries', {
      method: 'POST', body: { name: '   ', sql: 'select 1;' },
    })
    expect(noName.ok).toBe(false)
    if (!noName.ok) expect(noName.error.code).toBe('VALIDATION')

    const noSql = await $fetch<Envelope<never>>('/api/saved-queries', {
      method: 'POST', body: { name: 'x', sql: '' },
    })
    expect(noSql.ok).toBe(false)
    if (!noSql.ok) expect(noSql.error.code).toBe('VALIDATION')
  })

  it('rejects an oversized name with a VALIDATION envelope', async () => {
    const r = await $fetch<Envelope<never>>('/api/saved-queries', {
      method: 'POST', body: { name: 'n'.repeat(201), sql: 'select 1;' },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('VALIDATION')
  })

  it('DELETE removes the query; deleting a ghost still succeeds', async () => {
    await $fetch('/api/saved-queries', { method: 'POST', body: { name: 'to-delete', sql: 'select 1;' } })
    const del = await $fetch<Envelope<{ deleted: boolean }>>('/api/saved-queries/to-delete', { method: 'DELETE' })
    expect(del.ok).toBe(true)

    const list = await $fetch<Envelope<SavedQuery[]>>('/api/saved-queries')
    if (list.ok) expect(list.data.map((q) => q.name)).not.toContain('to-delete')

    const ghost = await $fetch<Envelope<{ deleted: boolean }>>('/api/saved-queries/ghost', { method: 'DELETE' })
    expect(ghost.ok).toBe(true)
  })

  it('persists to saved-queries.json in the data dir', async () => {
    await $fetch('/api/saved-queries', { method: 'POST', body: { name: 'on-disk', sql: 'select 42;' } })
    const raw = readFileSync(join(dataDir, 'saved-queries.json'), 'utf8')
    expect(raw).toContain('on-disk')
    expect(raw).toContain('select 42;')
  })
})
