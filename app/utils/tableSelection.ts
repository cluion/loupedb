import { toSpreadsheetCell } from './resultExport'

export interface GridCoordinate {
  readonly row: number
  readonly column: number
}

export interface GridRange {
  readonly rowStart: number
  readonly rowEnd: number
  readonly columnStart: number
  readonly columnEnd: number
}

export function normalizeGridRange(anchor: GridCoordinate, extent: GridCoordinate): GridRange {
  return {
    rowStart: Math.min(anchor.row, extent.row),
    rowEnd: Math.max(anchor.row, extent.row),
    columnStart: Math.min(anchor.column, extent.column),
    columnEnd: Math.max(anchor.column, extent.column),
  }
}

export function selectionToTsv(values: ReadonlyArray<ReadonlyArray<unknown>>): string {
  return values.map((row) => row.map(toSpreadsheetCell).join('\t')).join('\n')
}

export function parseSpreadsheetTsv(text: string): ReadonlyArray<ReadonlyArray<string>> {
  const rows: string[][] = [[]]
  let field = ''
  let quoted = false

  const finishField = () => {
    rows.at(-1)!.push(field)
    field = ''
  }
  const finishRow = () => {
    finishField()
    rows.push([])
  }

  for (let index = 0; index < text.length; index++) {
    const character = text[index]!
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"'
        index++
      } else if (character === '"') quoted = false
      else field += character
      continue
    }
    if (character === '"' && field === '') quoted = true
    else if (character === '\t') finishField()
    else if (character === '\r' || character === '\n') {
      if (character === '\r' && text[index + 1] === '\n') index++
      finishRow()
    } else field += character
  }
  if (quoted) throw new Error('剪貼簿含有未結束的引號')
  finishField()
  if (rows.length > 1 && rows.at(-1)?.length === 1 && rows.at(-1)?.[0] === '') rows.pop()

  const width = rows[0]?.length ?? 0
  if (!width || rows.some((row) => row.length !== width)) throw new Error('剪貼簿資料不是完整的矩形範圍')
  return rows
}
