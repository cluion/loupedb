// @vitest-environment nuxt
import { describe, it, expect } from 'vitest'
import type { QueryResult } from '#shared/types'
import {
  EXPORT_FORMATS,
  exportResult,
  toCsv,
  toTsv,
  toJson,
  toMarkdown,
} from '../../app/utils/resultExport'

function result(over: Partial<QueryResult> = {}): QueryResult {
  return {
    columns: [
      { name: 'id', nativeType: 'int4', type: 'integer', nullable: false },
      { name: 'note', nativeType: 'text', type: 'string', nullable: true },
    ],
    rows: [
      { id: 1, note: 'plain' },
      { id: 2, note: null },
    ],
    executionMs: 1,
    ...over,
  }
}

describe('toCsv', () => {
  it('emits a header row and CRLF-joined records', () => {
    expect(toCsv(result())).toBe('id,note\r\n1,plain\r\n2,')
  })

  it('quotes values containing commas, quotes or newlines per RFC 4180', () => {
    const r = result({ rows: [{ id: 1, note: 'a,b' }, { id: 2, note: 'say "hi"' }, { id: 3, note: 'line1\nline2' }] })
    expect(toCsv(r)).toBe('id,note\r\n1,"a,b"\r\n2,"say ""hi"""\r\n3,"line1\nline2"')
  })

  it('serializes object and array values as JSON', () => {
    const r = result({ rows: [{ id: 1, note: { deep: true } }] })
    expect(toCsv(r)).toBe('id,note\r\n1,"{""deep"":true}"')
  })
})

describe('toTsv', () => {
  it('joins with tabs and flattens tabs/newlines inside values', () => {
    const r = result({ rows: [{ id: 1, note: 'a\tb\nc' }, { id: 2, note: null }] })
    expect(toTsv(r)).toBe('id\tnote\n1\ta b c\n2\t')
  })
})

describe('toJson', () => {
  it('keeps value types and nulls intact', () => {
    const parsed = JSON.parse(toJson(result())) as unknown
    expect(parsed).toEqual([{ id: 1, note: 'plain' }, { id: 2, note: null }])
  })
})

describe('toMarkdown', () => {
  it('renders a GFM table with escaped pipes and empty cells for NULL', () => {
    const r = result({ rows: [{ id: 1, note: 'a|b' }, { id: 2, note: null }] })
    expect(toMarkdown(r)).toBe('| id | note |\n| --- | --- |\n| 1 | a\\|b |\n| 2 |  |')
  })
})

describe('exportResult / EXPORT_FORMATS', () => {
  it('dispatches by format key', () => {
    expect(exportResult(result(), 'csv')).toBe(toCsv(result()))
    expect(exportResult(result(), 'json')).toBe(toJson(result()))
  })

  it('declares extension and mime for every format', () => {
    expect(EXPORT_FORMATS.map((f) => f.format).sort()).toEqual(['csv', 'json', 'markdown', 'tsv'])
    for (const f of EXPORT_FORMATS) {
      expect(f.extension).toBeTruthy()
      expect(f.mime).toContain('/')
      expect(f.label).toBeTruthy()
    }
  })
})
