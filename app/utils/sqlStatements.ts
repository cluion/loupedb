import { listSqlStatements } from '#shared/sqlStatements'
export { listSqlStatements, type StatementRange } from '#shared/sqlStatements'

export interface RunnableSql {
  readonly sql: string
  readonly from: number
  readonly to: number
  readonly source: 'selection' | 'statement'
}

function statementAt(doc: string, pos: number): RunnableSql | null {
  const ranges = listSqlStatements(doc)
  if (!ranges.length) return null
  // the statement under the cursor, or the previous one when the cursor sits
  // in the gap between statements; leading whitespace maps to the first
  const range = [...ranges].reverse().find((r) => r.from <= pos) ?? ranges[0]!
  return { sql: doc.slice(range.from, range.to), from: range.from, to: range.to, source: 'statement' }
}

export function resolveRunnableSql(doc: string, from: number, to: number): RunnableSql | null {
  const selected = doc.slice(from, to)
  const trimmed = selected.trim()
  if (!trimmed) return statementAt(doc, from)
  const start = from + selected.indexOf(trimmed)
  return { sql: trimmed, from: start, to: start + trimmed.length, source: 'selection' }
}
