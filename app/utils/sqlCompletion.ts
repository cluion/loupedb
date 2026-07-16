import type { TableColumnInfo, TableInfo } from '#shared/types'

// schema → table → column names, the shape @codemirror/lang-sql takes as
// its `schema` config for completion
export type SqlNamespace = Record<string, Record<string, string[]>>

export interface SchemaMetadata {
  readonly schema: string
  readonly tables: ReadonlyArray<TableInfo>
  readonly columns: ReadonlyArray<TableColumnInfo>
}

export function buildSqlNamespace(metadata: ReadonlyArray<SchemaMetadata>): SqlNamespace {
  const namespace: SqlNamespace = {}
  for (const entry of metadata) {
    const tables: Record<string, string[]> = {}
    for (const table of entry.tables) tables[table.name] = []
    for (const column of entry.columns) tables[column.table]?.push(column.name)
    namespace[entry.schema] = tables
  }
  return namespace
}
