import { PostgreSQL } from '@codemirror/lang-sql'

export interface StatementRange {
  readonly from: number
  readonly to: number
}

// The PostgreSQL grammar understands strings, comments and dollar-quoted
// bodies, so semicolons inside them never split a script.
export function listSqlStatements(doc: string): ReadonlyArray<StatementRange> {
  const tree = PostgreSQL.language.parser.parse(doc)
  const ranges: StatementRange[] = []
  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
    if (node.name === 'Statement') ranges.push({ from: node.from, to: node.to })
  }
  return ranges
}
