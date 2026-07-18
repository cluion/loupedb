// @vitest-environment nuxt
import { beforeEach, describe, expect, it } from 'vitest'
import {
  TABLE_FILTER_HISTORY_LIMIT,
  addTableFilterHistoryEntry,
  restoreTableFilterHistory,
  useTableFilterHistory,
  type TableFilterHistoryEntry,
} from '../../app/stores/tableFilterHistory'

function entry(id: string, over: Partial<TableFilterHistoryEntry> = {}): TableFilterHistoryEntry {
  return {
    id,
    at: 1000,
    combinator: 'and',
    filters: [{ column: 'label', op: 'ilike', value: '%loupe%' }],
    ...over,
  }
}

beforeEach(() => localStorage.clear())

describe('table filter history', () => {
  it('keeps the newest unique filters and caps the list', () => {
    const duplicate = addTableFilterHistoryEntry([entry('old')], entry('new', { at: 2000 }))
    expect(duplicate).toEqual([entry('new', { at: 2000 })])

    const full = Array.from({ length: TABLE_FILTER_HISTORY_LIMIT }, (_, index) => entry(`e${index}`, {
      filters: [{ column: 'id', op: '>=', value: String(index) }],
    }))
    const capped = addTableFilterHistoryEntry(full, entry('latest'))
    expect(capped).toHaveLength(TABLE_FILTER_HISTORY_LIMIT)
    expect(capped[0]!.id).toBe('latest')
  })

  it('round-trips AND, OR and valueless operators', () => {
    const list = [entry('or', {
      combinator: 'or',
      filters: [
        { column: 'deleted_at', op: 'is null' },
        { column: 'label', op: 'not like', value: 'draft%' },
      ],
    })]
    expect(restoreTableFilterHistory(JSON.stringify(list))).toEqual(list)
  })

  it('rejects malformed or unsafe persisted payloads', () => {
    expect(restoreTableFilterHistory('{broken')).toBeNull()
    expect(restoreTableFilterHistory(JSON.stringify([entry('bad', {
      filters: [{ column: 'id', op: 'or true --' as never, value: '1' }],
    })]))).toBeNull()
    expect(restoreTableFilterHistory(JSON.stringify([entry('bad', {
      filters: [{ column: '', op: '=', value: '1' }],
    })]))).toBeNull()
  })

  it('persists, removes and clears entries per table scope', () => {
    const history = useTableFilterHistory('prod:appdb:public.items')
    history.add({
      combinator: 'and',
      filters: [{ column: 'qty', op: '>=', value: '10' }],
    })
    expect(history.entries.value).toHaveLength(1)
    const key = 'loupedb:table-filter-history:v1:prod%3Aappdb%3Apublic.items'
    expect(restoreTableFilterHistory(localStorage.getItem(key)!)).toHaveLength(1)

    history.remove(history.entries.value[0]!.id)
    expect(localStorage.getItem(key)).toBeNull()
    history.add({ combinator: 'and', filters: [{ column: 'id', op: '>', value: '1' }] })
    history.clear()
    expect(history.entries.value).toEqual([])
    expect(localStorage.getItem(key)).toBeNull()
  })
})
