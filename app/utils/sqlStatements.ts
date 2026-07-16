import { PostgreSQL } from '@codemirror/lang-sql'

export interface StatementRange {
  readonly from: number
  readonly to: number
}

export interface RunnableSql {
  readonly sql: string
  readonly from: number
  readonly to: number
  readonly source: 'selection' | 'statement'
}

// the lezer grammar knows string literals, comments and dollar-quoted bodies,
// so statement boundaries here never split on a quoted/commented semicolon
export function listSqlStatements(doc: string): ReadonlyArray<StatementRange> {
  const tree = PostgreSQL.language.parser.parse(doc)
  const ranges: StatementRange[] = []
  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
    if (node.name === 'Statement') ranges.push({ from: node.from, to: node.to })
  }
  return ranges
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
