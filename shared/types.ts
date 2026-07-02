export type NormalizedType =
  | 'integer' | 'decimal' | 'string' | 'boolean'
  | 'datetime' | 'date' | 'time' | 'json' | 'binary'
  | 'uuid' | 'array' | 'enum' | 'unknown'

export interface ColumnInfo {
  readonly name: string
  readonly nativeType: string
  readonly type: NormalizedType
  readonly nullable: boolean
  readonly defaultValue?: unknown
}

export interface QueryResult {
  readonly columns: ReadonlyArray<ColumnInfo>
  readonly rows: ReadonlyArray<Record<string, unknown>>
  readonly rowCount?: number
  readonly affectedRows?: number
  readonly executionMs: number
  readonly notice?: string
}

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

export interface SchemaInfo { readonly name: string }
export interface TableInfo { readonly schema: string; readonly name: string }
export interface ForeignKeyInfo {
  readonly name: string
  readonly columns: ReadonlyArray<string>
  readonly referencesSchema: string
  readonly referencesTable: string
  readonly referencesColumns: ReadonlyArray<string>
}
export interface TableSchema {
  readonly schema: string
  readonly table: string
  readonly columns: ReadonlyArray<ColumnInfo>
  readonly primaryKey: ReadonlyArray<string>
  readonly foreignKeys: ReadonlyArray<ForeignKeyInfo>
}

export interface BrowseOpts {
  readonly limit: number
  readonly offset: number
  readonly orderBy?: string
  readonly orderDir?: 'asc' | 'desc'
  readonly filter?: ReadonlyArray<{ readonly column: string; readonly op: '=' | '!=' | '>' | '<' | 'like'; readonly value: unknown }>
}

export interface DatabaseError {
  readonly code: string
  readonly message: string
  readonly severity: 'error' | 'warning' | 'fatal'
  readonly retryable: boolean
}

// unified API response envelope, shared by server routes and frontend composables
export type Envelope<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: DatabaseError }
