import type { QueryResult } from '#shared/types'

export type ExportFormat = 'csv' | 'tsv' | 'json' | 'markdown'

export interface ExportFormatInfo {
  readonly format: ExportFormat
  readonly label: string
  readonly extension: string
  readonly mime: string
}

export const EXPORT_FORMATS: ReadonlyArray<ExportFormatInfo> = [
  { format: 'csv', label: 'CSV', extension: 'csv', mime: 'text/csv' },
  { format: 'tsv', label: 'TSV', extension: 'tsv', mime: 'text/tab-separated-values' },
  { format: 'json', label: 'JSON', extension: 'json', mime: 'application/json' },
  { format: 'markdown', label: 'Markdown', extension: 'md', mime: 'text/markdown' },
]

// NULL becomes an empty cell in tabular formats; objects/arrays stay JSON
function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

// OWASP CSV-injection guard: a string cell starting with =, +, - or @ would
// execute as a formula in Excel/Sheets, so it gets an apostrophe prefix.
// Only strings are guarded - typed numbers like -5 must round-trip untouched.
function formulaSafe(value: unknown, text: string): string {
  return typeof value === 'string' && /^[=+\-@]/.test(text) ? `'${text}` : text
}

export function toSpreadsheetCell(value: unknown): string {
  return formulaSafe(value, cellText(value).replaceAll(/[\t\r\n]+/g, ' '))
}

function csvField(value: unknown): string {
  const text = formulaSafe(value, cellText(value))
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function toCsv(result: QueryResult): string {
  const names = result.columns.map((c) => c.name)
  const lines = [
    names.map(csvField).join(','),
    ...result.rows.map((row) => names.map((n) => csvField(row[n])).join(',')),
  ]
  return lines.join('\r\n') // RFC 4180 record separator
}

export function toTsv(result: QueryResult): string {
  const names = result.columns.map((c) => c.name)
  // tabs/newlines inside a value would break the grid when pasted into a spreadsheet
  const lines = [
    names.map(toSpreadsheetCell).join('\t'),
    ...result.rows.map((row) => names.map((n) => toSpreadsheetCell(row[n])).join('\t')),
  ]
  return lines.join('\n')
}

export function toJson(result: QueryResult): string {
  return JSON.stringify(result.rows, null, 2)
}

export function toMarkdown(result: QueryResult): string {
  const names = result.columns.map((c) => c.name)
  const field = (value: unknown) => cellText(value).replaceAll(/[\r\n]+/g, ' ').replaceAll('|', '\\|')
  const line = (cells: ReadonlyArray<string>) => `| ${cells.join(' | ')} |`
  const lines = [
    line(names.map(field)),
    line(names.map(() => '---')),
    ...result.rows.map((row) => line(names.map((n) => field(row[n])))),
  ]
  return lines.join('\n')
}

export function exportResult(result: QueryResult, format: ExportFormat): string {
  switch (format) {
    case 'csv': return toCsv(result)
    case 'tsv': return toTsv(result)
    case 'json': return toJson(result)
    case 'markdown': return toMarkdown(result)
  }
}

export function exportFilename(format: ExportFormat, now = new Date()): string {
  const stamp = now.toISOString().slice(0, 19).replaceAll(':', '-')
  const info = EXPORT_FORMATS.find((f) => f.format === format)!
  return `loupedb-${stamp}.${info.extension}`
}
