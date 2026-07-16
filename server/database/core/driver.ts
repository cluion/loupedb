import type { ConnectionConfig, ConnectionStatus, DatabaseInfo, QueryResult, SchemaInfo, TableColumnInfo, TableInfo, TableSchema, BrowseOpts } from '#shared/types'

export interface DatabaseDriver {
  readonly config: ConnectionConfig
  connect(): Promise<void>
  disconnect(): Promise<void>
  readonly status: ConnectionStatus
  listDatabases(): Promise<ReadonlyArray<DatabaseInfo>>
  listSchemas(): Promise<ReadonlyArray<SchemaInfo>>
  listTables(schema: string): Promise<ReadonlyArray<TableInfo>>
  listColumns(schema: string): Promise<ReadonlyArray<TableColumnInfo>>
  describeTable(schema: string, table: string): Promise<TableSchema>
  execute(sql: string, params?: ReadonlyArray<unknown>, queryId?: string): Promise<QueryResult>
  browse(schema: string, table: string, opts: BrowseOpts, queryId?: string): Promise<QueryResult>
  cancel(queryId: string): Promise<void>
  stream(schema: string, table: string, opts: BrowseOpts, batchSize: number, queryId?: string): AsyncIterable<ReadonlyArray<Record<string, unknown>>>
}
