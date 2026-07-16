// @vitest-environment nuxt
import { beforeEach, describe, it, expect } from 'vitest'
import {
  QUERY_HISTORY_LIMIT,
  addHistoryEntry,
  restoreQueryHistory,
  useQueryHistory,
  type QueryHistoryEntry,
} from '../../app/stores/queryHistory'

function entry(id: string, over: Partial<QueryHistoryEntry> = {}): QueryHistoryEntry {
  return {
    id, sql: `select ${id};`, database: 'appdb', at: 1000,
    durationMs: 5, rowCount: 1, ok: true, ...over,
  }
}

beforeEach(() => localStorage.clear())

describe('addHistoryEntry', () => {
  it('prepends the newest entry', () => {
    const list = addHistoryEntry([entry('old')], entry('new'))
    expect(list.map((e) => e.id)).toEqual(['new', 'old'])
  })

  it('caps the list at the history limit', () => {
    const full = Array.from({ length: QUERY_HISTORY_LIMIT }, (_, i) => entry(`e${i}`))
    const list = addHistoryEntry(full, entry('overflow'))
    expect(list).toHaveLength(QUERY_HISTORY_LIMIT)
    expect(list[0]!.id).toBe('overflow')
    expect(list.at(-1)!.id).toBe(`e${QUERY_HISTORY_LIMIT - 2}`)
  })
})

describe('restoreQueryHistory', () => {
  it('round-trips a serialized list', () => {
    const list = [entry('a'), entry('b', { ok: false, durationMs: null, rowCount: null })]
    expect(restoreQueryHistory(JSON.stringify(list))).toEqual(list)
  })

  it('returns null for malformed payloads', () => {
    expect(restoreQueryHistory('{broken')).toBeNull()
    expect(restoreQueryHistory(JSON.stringify([{ id: 1 }]))).toBeNull()
    expect(restoreQueryHistory(JSON.stringify({ not: 'a list' }))).toBeNull()
  })
})

describe('useQueryHistory', () => {
  it('records executions and persists them per connection label', () => {
    const h = useQueryHistory('prod')
    h.add({ sql: 'select 1;', database: 'appdb', durationMs: 7, rowCount: 3, ok: true })
    expect(h.entries.value).toHaveLength(1)
    expect(h.entries.value[0]).toMatchObject({ sql: 'select 1;', ok: true, rowCount: 3 })
    expect(h.entries.value[0]!.id).toBeTypeOf('string')

    const raw = localStorage.getItem('loupedb:query-history:v1:prod')
    expect(raw).not.toBeNull()
    expect(restoreQueryHistory(raw!)).toHaveLength(1)
  })

  it('keeps different connection labels apart', () => {
    useQueryHistory('one').add({ sql: 'select 1;', database: null, durationMs: 1, rowCount: 0, ok: true })
    expect(useQueryHistory('two').entries.value).toHaveLength(0)
  })

  it('clear empties the list and the storage', () => {
    const h = useQueryHistory('wipe')
    h.add({ sql: 'select 1;', database: null, durationMs: 1, rowCount: 0, ok: true })
    h.clear()
    expect(h.entries.value).toEqual([])
    expect(localStorage.getItem('loupedb:query-history:v1:wipe')).toBeNull()
  })
})
