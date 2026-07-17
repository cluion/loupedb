import { PostgreSQL } from '@codemirror/lang-sql'

interface TextRange {
  readonly from: number
  readonly to: number
}

const IGNORED_NODES = new Set(['String', 'LineComment', 'BlockComment', 'QuotedIdentifier'])

function isIdentifierChar(value: string | undefined): boolean {
  return value !== undefined && /^[\p{L}\p{N}_$]$/u.test(value)
}

// PostgreSQL parameters are positional ($1, $2, ...). The grammar marks
// literals/comments as complete nodes even though it parses $n as error+number.
export function listSqlParameterPositions(sql: string): ReadonlyArray<number> {
  const ignored: TextRange[] = []
  PostgreSQL.language.parser.parse(sql).iterate({
    enter(node) {
      if (IGNORED_NODES.has(node.name)) ignored.push({ from: node.from, to: node.to })
    },
  })

  const positions = new Set<number>()
  for (const match of sql.matchAll(/\$(\d+)/g)) {
    const from = match.index
    const to = from + match[0].length
    if (ignored.some((range) => range.from <= from && to <= range.to)) continue
    const before = sql.slice(0, from).match(/.$/u)?.[0]
    const after = sql.slice(to).match(/^./u)?.[0]
    if (isIdentifierChar(before) || isIdentifierChar(after)) continue
    const position = Number(match[1])
    if (Number.isSafeInteger(position) && position > 0) positions.add(position)
  }
  return [...positions].sort((a, b) => a - b)
}
