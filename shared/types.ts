export type NormalizedType =
  | 'integer' | 'decimal' | 'string' | 'boolean'
  | 'datetime' | 'date' | 'time' | 'json' | 'binary'
  | 'uuid' | 'array' | 'enum' | 'unknown'

export interface ColumnInfo {
  readonly name: string
  readonly nativeType: string
  readonly type: NormalizedType
  readonly nullable: boolean
  readonly editable?: boolean
  readonly insertable?: boolean
  readonly defaultValue?: unknown
}

export type QueryMessageSeverity = 'debug' | 'info' | 'log' | 'notice' | 'warning'

export interface QueryMessage {
  readonly severity: QueryMessageSeverity
  readonly message: string
  readonly code?: string
  readonly detail?: string
  readonly hint?: string
  readonly context?: string
}

export interface QueryResult {
  readonly columns: ReadonlyArray<ColumnInfo>
  readonly rows: ReadonlyArray<Record<string, unknown>>
  readonly command?: string
  readonly rowCount?: number
  readonly affectedRows?: number
  readonly executionMs: number
  readonly messages?: ReadonlyArray<QueryMessage>
  readonly rowVersions?: ReadonlyArray<string>
}

export type TransactionStatus = 'idle' | 'active' | 'failed'

export interface TransactionState {
  readonly status: TransactionStatus
  readonly startedAt: number | null
}

interface ScriptStatementBase {
  readonly index: number
  readonly sql: string
  readonly executionMs: number
}

export type ScriptStatementResult =
  | ScriptStatementBase & { readonly status: 'success'; readonly result: QueryResult }
  | ScriptStatementBase & { readonly status: 'error' | 'cancelled'; readonly error: DatabaseError }

export interface ScriptExecutionResult {
  readonly kind: 'script'
  readonly status: 'success' | 'error' | 'cancelled'
  readonly totalStatements: number
  readonly statements: ReadonlyArray<ScriptStatementResult>
  readonly executionMs: number
}

export type SqlExecutionResult = QueryResult | ScriptExecutionResult

export type ConnectionStatus = 'connecting' | 'connected' | 'error' | 'closed'

export type SslMode = 'disable' | 'prefer' | 'require' | 'verify-full'

export interface ConnectionConfig {
  readonly name: string
  readonly driver: 'postgres'
  readonly host: string
  readonly port: number
  readonly database: string
  readonly username: string
  readonly password: string // memory only, never written to disk in plaintext
  readonly ssl: SslMode
}

export interface DatabaseInfo { readonly name: string }
export interface SchemaInfo { readonly name: string }
export interface TableInfo { readonly schema: string; readonly name: string }
// one flat row per column - bulk metadata for editor autocomplete
export interface TableColumnInfo { readonly table: string; readonly name: string }
export interface DatabaseFunctionInfo {
  readonly schema: string
  readonly name: string
  readonly arguments: string
  readonly resultType: string
  readonly kind: 'function' | 'aggregate' | 'window'
}
export interface ForeignKeyInfo {
  readonly name: string
  readonly columns: ReadonlyArray<string>
  readonly referencesSchema: string
  readonly referencesTable: string
  readonly referencesColumns: ReadonlyArray<string>
}
export interface UniqueKeyInfo {
  readonly name: string
  readonly columns: ReadonlyArray<string>
}
export interface TableSchema {
  readonly schema: string
  readonly table: string
  readonly columns: ReadonlyArray<ColumnInfo>
  readonly primaryKey: ReadonlyArray<string>
  readonly uniqueKeys: ReadonlyArray<UniqueKeyInfo>
  readonly foreignKeys: ReadonlyArray<ForeignKeyInfo>
}

export interface BrowseOpts {
  readonly limit: number
  readonly offset: number
  readonly orderBy?: string
  readonly orderDir?: 'asc' | 'desc'
  readonly filter?: ReadonlyArray<{ readonly column: string; readonly op: '=' | '!=' | '>' | '<' | 'like'; readonly value: unknown }>
}

export interface CellUpdateInput {
  readonly schema: string
  readonly table: string
  readonly column: string
  readonly value: unknown
  readonly originalValue: unknown
  readonly identity: Readonly<Record<string, unknown>>
}

export interface CellUpdateResult {
  readonly affectedRows: 1
  readonly row: Readonly<Record<string, unknown>>
}

export interface RowInsertInput {
  readonly schema: string
  readonly table: string
  readonly values: Readonly<Record<string, unknown>>
}

export interface RowDeleteInput {
  readonly schema: string
  readonly table: string
  readonly identity: Readonly<Record<string, unknown>>
  readonly version: string
}

export interface RowMutationResult {
  readonly affectedRows: 1
  readonly row: Readonly<Record<string, unknown>>
}

export interface DatabaseError {
  readonly code: string
  readonly message: string
  readonly severity: 'error' | 'warning' | 'fatal'
  readonly retryable: boolean
  readonly messages?: ReadonlyArray<QueryMessage>
}

export interface SavedQuery {
  readonly name: string // unique key - saving under an existing name overwrites
  readonly sql: string
  readonly favorite: boolean
  readonly folder: string | null
  readonly tags: ReadonlyArray<string>
  readonly createdAt: number
  readonly updatedAt: number
}

export interface SavedQueryOrganizationPatch {
  readonly favorite?: boolean
  readonly folder?: string | null
  readonly tags?: ReadonlyArray<string>
}

// unified API response envelope, shared by server routes and frontend composables
export type Envelope<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: DatabaseError }
