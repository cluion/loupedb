import { describe, expect, it } from 'vitest'
import {
  LARGE_TEXT_THRESHOLD,
  cellContentKindLabel,
  cellContentText,
  cellContentValuesEqual,
  parseCellContent,
  usesCellContentDialog,
} from '../../app/utils/cellContent'

describe('cell content dialog helpers', () => {
  it('uses the dialog for JSON, arrays, multiline and long text', () => {
    expect(usesCellContentDialog('json', {})).toBe(true)
    expect(usesCellContentDialog('array', [])).toBe(true)
    expect(usesCellContentDialog('string', 'one\ntwo')).toBe(true)
    expect(usesCellContentDialog('string', 'x'.repeat(LARGE_TEXT_THRESHOLD + 1))).toBe(true)
    expect(usesCellContentDialog('string', 'short')).toBe(false)
  })

  it('pretty prints structured values and preserves plain text', () => {
    expect(cellContentText('json', { active: true })).toBe('{\n  "active": true\n}')
    expect(cellContentText('array', ['a', 'b'])).toBe('[\n  "a",\n  "b"\n]')
    expect(cellContentText('string', 'line one')).toBe('line one')
    expect(cellContentText('json', null)).toBe('')
  })

  it('parses JSON and requires array values for PostgreSQL arrays', () => {
    expect(parseCellContent('json', '{"count":2}')).toEqual({ count: 2 })
    expect(parseCellContent('array', '["a","b"]')).toEqual(['a', 'b'])
    expect(() => parseCellContent('json', '{')).toThrow('有效的 JSON')
    expect(() => parseCellContent('array', '{"not":"array"}')).toThrow('JSON array 格式')
  })

  it('labels each modal content kind', () => {
    expect(cellContentKindLabel('json')).toBe('JSON')
    expect(cellContentKindLabel('array')).toBe('ARRAY')
    expect(cellContentKindLabel('string')).toBe('LARGE TEXT')
  })

  it('compares structured values without depending on object key order', () => {
    expect(cellContentValuesEqual(
      { status: 'draft', nested: { count: 1, active: true } },
      { nested: { active: true, count: 1 }, status: 'draft' },
    )).toBe(true)
    expect(cellContentValuesEqual(['a', 'b'], ['a', 'b'])).toBe(true)
    expect(cellContentValuesEqual(['a', 'b'], ['b', 'a'])).toBe(false)
  })
})
