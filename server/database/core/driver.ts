import type { BinaryCellReadInput, BinaryCellReadResult, BrowseOpts, CellUpdateInput, CellUpdateResult, ConnectionConfig, ConnectionStatus, DatabaseFunctionInfo, DatabaseInfo, QueryResult, RowDeleteInput, RowInsertInput, RowMutationResult, SchemaInfo, TableChangesInput, TableChangesResult, TableColumnInfo, TableInfo, TableSchema, TransactionState } from '#shared/types'

export interface DatabaseDriver {
  readonly config: ConnectionConfig
  connect(): Promise<void>
  disconnect(): Promise<void>
  readonly status: ConnectionStatus
  listDatabases(): Promise<ReadonlyArray<DatabaseInfo>>
  listSchemas(): Promise<ReadonlyArray<SchemaInfo>>
  listTables(schema: string): Promise<ReadonlyArray<TableInfo>>
  listColumns(schema: string): Promise<ReadonlyArray<TableColumnInfo>>
  listFunctions(schema: string): Promise<ReadonlyArray<DatabaseFunctionInfo>>
  describeTable(schema: string, table: string): Promise<TableSchema>
  execute(sql: string, params?: ReadonlyArray<unknown>, queryId?: string): Promise<QueryResult>
  executeScript(statements: ReadonlyArray<string>, queryId?: string): AsyncIterable<QueryResult>
  transactionStatus(): TransactionState
  beginTransaction(): Promise<TransactionState>
  commitTransaction(): Promise<TransactionState>
  rollbackTransaction(): Promise<TransactionState>
  browse(schema: string, table: string, opts: BrowseOpts, queryId?: string): Promise<QueryResult>
  readBinaryCell(input: BinaryCellReadInput): Promise<BinaryCellReadResult>
  updateCell(input: CellUpdateInput): Promise<CellUpdateResult>
  insertRow(input: RowInsertInput): Promise<RowMutationResult>
  deleteRow(input: RowDeleteInput): Promise<RowMutationResult>
  applyTableChanges(input: TableChangesInput): Promise<TableChangesResult>
  cancel(queryId: string): Promise<void>
  stream(schema: string, table: string, opts: BrowseOpts, batchSize: number, queryId?: string): AsyncIterable<ReadonlyArray<Record<string, unknown>>>
}
