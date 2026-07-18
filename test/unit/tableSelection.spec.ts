import { describe, expect, it } from 'vitest'
import {
  normalizeGridRange,
  parseSpreadsheetTsv,
  selectionToTsv,
} from '../../app/utils/tableSelection'

describe('normalizeGridRange', () => {
  it('normalizes selections dragged in either direction', () => {
    expect(normalizeGridRange({ row: 4, column: 3 }, { row: 1, column: 7 })).toEqual({
      rowStart: 1,
      rowEnd: 4,
      columnStart: 3,
      columnEnd: 7,
    })
  })
})

describe('selectionToTsv', () => {
  it('serializes a rectangle with spreadsheet-safe cells', () => {
    expect(selectionToTsv([
      [null, 'a\tb\nc', '=1+1'],
      [-5, { active: true }, '@cmd'],
    ])).toBe("\ta b c\t'=1+1\n-5\t{\"active\":true}\t'@cmd")
  })
})

describe('parseSpreadsheetTsv', () => {
  it('parses tabs, CRLF records and a trailing line break', () => {
    expect(parseSpreadsheetTsv('a\tb\r\nc\td\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })

  it('preserves quoted tabs, line breaks and doubled quotes', () => {
    expect(parseSpreadsheetTsv('"a\tb"\t"line 1\nline 2"\n"say ""hi"""\tx')).toEqual([
      ['a\tb', 'line 1\nline 2'],
      ['say "hi"', 'x'],
    ])
  })

  it('rejects incomplete rectangles and unterminated quoted cells', () => {
    expect(() => parseSpreadsheetTsv('a\tb\nc')).toThrow('完整的矩形範圍')
    expect(() => parseSpreadsheetTsv('"a')).toThrow('未結束的引號')
  })
})
