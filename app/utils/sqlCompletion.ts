import type { DatabaseFunctionInfo, TableColumnInfo, TableInfo } from '#shared/types'

// schema → table → column names, the shape @codemirror/lang-sql takes as
// its `schema` config for completion
interface SqlCompletionOption {
  readonly label: string
  readonly type: 'function'
  readonly detail: string
  readonly info?: string
  readonly apply: string
}

type SqlNamespaceEntry = string[] | {
  readonly self: SqlCompletionOption
  readonly children: readonly string[]
}

export type SqlNamespace = Record<string, Record<string, SqlNamespaceEntry>>

export interface SchemaMetadata {
  readonly schema: string
  readonly tables: ReadonlyArray<TableInfo>
  readonly columns: ReadonlyArray<TableColumnInfo>
  readonly functions: ReadonlyArray<DatabaseFunctionInfo>
}

function functionIdentifier(name: string): string {
  return /^[a-z_][a-z0-9_$]*$/.test(name) ? name : `"${name.replaceAll('"', '""')}"`
}

function functionSignature(fn: DatabaseFunctionInfo): string {
  return `${fn.arguments ? `(${fn.arguments})` : '()'} → ${fn.resultType}`
}

function functionDetail(overloads: ReadonlyArray<DatabaseFunctionInfo>): string {
  return overloads.length > 1 ? `${overloads.length} overloads` : functionSignature(overloads[0]!)
}

export function buildSqlNamespace(metadata: ReadonlyArray<SchemaMetadata>): SqlNamespace {
  const namespace: SqlNamespace = {}
  for (const entry of metadata) {
    const objects: Record<string, SqlNamespaceEntry> = {}
    for (const table of entry.tables) objects[table.name] = []
    for (const column of entry.columns) {
      const table = objects[column.table]
      if (Array.isArray(table)) table.push(column.name)
    }

    const groupedFunctions = new Map<string, DatabaseFunctionInfo[]>()
    for (const fn of entry.functions) {
      const overloads = groupedFunctions.get(fn.name) ?? []
      overloads.push(fn)
      groupedFunctions.set(fn.name, overloads)
    }
    for (const [name, overloads] of groupedFunctions) {
      const label = `${name}()`
      objects[label] = {
        self: {
          label,
          type: 'function',
          detail: functionDetail(overloads),
          ...(overloads.length > 1 ? { info: overloads.map(functionSignature).join('\n') } : {}),
          apply: `${functionIdentifier(name)}(`,
        },
        children: [],
      }
    }
    namespace[entry.schema] = objects
  }
  return namespace
}
