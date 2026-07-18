import type postgres from 'postgres'
import { createHash } from 'node:crypto'
import type { BinaryCellReadInput, BinaryCellReadResult, BinaryCellSummary, BrowseFilterCondition, BrowseOpts, CellUpdateInput, CellUpdateResult, ColumnInfo, NormalizedType, QueryMessage, QueryResult, RowDeleteInput, RowInsertInput, RowMutationResult } from '#shared/types'
import { BROWSE_FILTER_OPERATORS, MAX_BROWSE_FILTERS, VALUELESS_BROWSE_FILTER_OPERATORS } from '#shared/types'
import { isBinaryCellSummary, isBinaryCellUpload } from '#shared/binaryCell'
import { normalizePgType } from '../../core/normalizer'
import { listUniqueKeys } from './schema'

type Sql = ReturnType<typeof postgres>

export interface CancellableQuery { cancel(): void }

const INLINE_EDIT_TYPES: ReadonlySet<NormalizedType> = new Set([
  'integer', 'decimal', 'string', 'boolean', 'datetime', 'date', 'time', 'uuid', 'enum',
])
const CELL_EDIT_TYPES: ReadonlySet<NormalizedType> = new Set([...INLINE_EDIT_TYPES, 'json', 'array', 'binary'])

interface ErrorWithMessages {
  messages?: ReadonlyArray<QueryMessage>
}

function attachMessages(cause: unknown, messages: ReadonlyArray<QueryMessage>): unknown {
  if (!messages.length) return cause
  if (cause && typeof cause === 'object') {
    try {
      ;(cause as ErrorWithMessages).messages = messages
      return cause
    } catch { /* fall through to a writable wrapper */ }
  }
  const wrapped = new Error(cause instanceof Error ? cause.message : String(cause), { cause })
  ;(wrapped as ErrorWithMessages).messages = messages
  return wrapped
}

// oid -> type name cache must be per-driver: custom type oids differ across databases
async function oidToTypeName(sql: Sql, oid: number, oidCache: Map<number, string>): Promise<string> {
  const cached = oidCache.get(oid)
  if (cached) return cached
  const rows = await sql`select typname from pg_type where oid = ${oid}`
  const name = rows[0] ? String(rows[0].typname) : 'unknown'
  oidCache.set(oid, name)
  return name
}

export function quoteIdent(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) throw new Error(`invalid identifier: ${name}`)
  return `"${name}"`
}

function editError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code, severity: 'ERROR' })
}

function hasOwn(record: Readonly<Record<string, unknown>>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

interface TableColumnMetadata {
  readonly name: string
  readonly native: string
  readonly type: NormalizedType
  readonly updatable: boolean
  readonly insertable: boolean
}

function summarizeBinaryValue(value: unknown): BinaryCellSummary | null {
  if (value === null) return null
  if (!(value instanceof Uint8Array)) throw editError('INVALID_BINARY', 'binary column returned an invalid value')
  return {
    $loupedb: 'binary',
    byteLength: value.byteLength,
    checksum: createHash('md5').update(value).digest('hex'),
  }
}

function summarizeBinaryRow(
  row: Readonly<Record<string, unknown>>, columns: ReadonlyArray<TableColumnMetadata>,
): Readonly<Record<string, unknown>> {
  const result = { ...row }
  for (const column of columns) {
    if (column.type === 'binary') result[column.name] = summarizeBinaryValue(result[column.name])
  }
  return result
}

async function tableColumnMetadata(sql: Sql, schema: string, table: string): Promise<TableColumnMetadata[]> {
  const rows = await sql`
    select c.column_name as name,
           c.udt_name as native,
           c.is_updatable = 'YES' as is_updatable,
           c.is_generated = 'NEVER' and c.is_identity = 'NO' as is_insertable,
           t.typtype as type_kind
    from information_schema.columns c
    join pg_type t on t.typname = c.udt_name
    join pg_namespace tn on tn.oid = t.typnamespace and tn.nspname = c.udt_schema
    where c.table_schema = ${schema} and c.table_name = ${table}
    order by c.ordinal_position`
  return rows.map((row) => {
    const native = String(row.native)
    return {
      name: String(row.name),
      native,
      type: row.type_kind === 'e' ? 'enum' : normalizePgType(native),
      updatable: Boolean(row.is_updatable),
      insertable: Boolean(row.is_insertable),
    }
  })
}

async function primaryKeyColumns(sql: Sql, schema: string, table: string): Promise<string[]> {
  const rows = await sql`
    select kcu.column_name as col from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
    where tc.table_schema = ${schema} and tc.table_name = ${table}
      and tc.constraint_type = 'PRIMARY KEY'
    order by kcu.ordinal_position`
  return rows.map((row) => String(row.col))
}

interface IdentityKey {
  readonly kind: 'primary key' | 'unique key'
  readonly columns: ReadonlyArray<string>
}

async function identityKey(
  sql: Sql, schema: string, table: string, identity: Readonly<Record<string, unknown>>,
): Promise<IdentityKey> {
  const primaryKey = await primaryKeyColumns(sql, schema, table)
  const uniqueKeys = await listUniqueKeys(sql, schema, table)
  const keys: IdentityKey[] = [
    ...(primaryKey.length ? [{ kind: 'primary key' as const, columns: primaryKey }] : []),
    ...uniqueKeys.map((key) => ({ kind: 'unique key' as const, columns: key.columns })),
  ]
  if (!keys.length) {
    throw editError('SAFE_EDIT_REQUIRED', 'table has no primary or unique key and is read-only')
  }
  const identityKeys = Object.keys(identity)
  const key = keys.find((candidate) => (
    identityKeys.length === candidate.columns.length
    && candidate.columns.every((column) => hasOwn(identity, column))
    && identityKeys.every((column) => candidate.columns.includes(column))
  ))
  if (!key) {
    throw editError('INVALID_IDENTITY', 'row identity must contain one complete primary or unique key')
  }
  if (key.kind === 'unique key' && key.columns.some((column) => identity[column] === null)) {
    throw editError('INVALID_IDENTITY', 'NULL unique key values cannot safely identify one row')
  }
  return key
}

function identityConditions(
  identity: Readonly<Record<string, unknown>>, key: IdentityKey, params: unknown[],
): string[] {
  return key.columns.map((column) => {
    params.push(identity[column])
    return `${quoteIdent(column)} is not distinct from $${params.length}`
  })
}

interface RowListMeta {
  readonly columns?: ReadonlyArray<{ name: string; type: number }>
  readonly count?: number
  readonly command?: string
}

export async function executeUnsafe(
  sql: Sql, text: string, params: ReadonlyArray<unknown>, queryId: string | undefined,
  activeQueries: Map<string, CancellableQuery>, oidCache: Map<number, string>,
  takeMessages: () => ReadonlyArray<QueryMessage> = () => [],
): Promise<QueryResult> {
  const start = performance.now()
  const query = sql.unsafe(text, [...params] as never[])
  if (queryId) activeQueries.set(queryId, query as unknown as CancellableQuery)
  try {
    const result = await query // postgres.js RowList carries columns and count
    const meta = result as unknown as RowListMeta
    const columns: ColumnInfo[] = await Promise.all((meta.columns ?? []).map(async (c) => {
      const native = await oidToTypeName(sql, c.type, oidCache)
      return { name: c.name, nativeType: native, type: normalizePgType(native), nullable: true }
    }))
    const messages = takeMessages()
    return {
      columns,
      rows: [...result] as Record<string, unknown>[],
      command: meta.command,
      rowCount: result.length,
      affectedRows: meta.count,
      executionMs: performance.now() - start,
      ...(messages.length ? { messages } : {}),
    }
  } catch (cause) {
    throw attachMessages(cause, takeMessages())
  } finally {
    if (queryId) activeQueries.delete(queryId)
  }
}

export async function browseTable(
  sql: Sql, schema: string, table: string, opts: BrowseOpts, queryId: string | undefined,
  activeQueries: Map<string, CancellableQuery>, oidCache: Map<number, string>,
): Promise<QueryResult> {
  const colRows = await sql`
    select c.column_name as name, c.udt_name as native, t.typtype as type_kind
    from information_schema.columns c
    join pg_type t on t.typname = c.udt_name
    join pg_namespace tn on tn.oid = t.typnamespace and tn.nspname = c.udt_schema
    where c.table_schema = ${schema} and c.table_name = ${table}
    order by c.ordinal_position`
  const tableColumns = colRows.map((row) => {
    const native = String(row.native)
    return {
      name: String(row.name),
      native,
      type: row.type_kind === 'e' ? 'enum' as const : normalizePgType(native),
    }
  })
  const validCols = new Set(tableColumns.map((column) => column.name))

  // ops are interpolated into SQL - runtime whitelist required because BrowseOpts
  // arrives from API request bodies where TS types do not hold
  const ALLOWED_OPS: ReadonlySet<string> = new Set(BROWSE_FILTER_OPERATORS)
  const VALUELESS_OPS: ReadonlySet<string> = new Set(VALUELESS_BROWSE_FILTER_OPERATORS)

  const where: string[] = []
  const params: unknown[] = []
  const requestedFilters: ReadonlyArray<unknown> = Array.isArray(opts.filter) ? opts.filter : []
  for (const candidate of requestedFilters.slice(0, MAX_BROWSE_FILTERS)) {
    if (!candidate || typeof candidate !== 'object') continue
    const f = candidate as Partial<BrowseFilterCondition>
    if (typeof f.column !== 'string' || typeof f.op !== 'string') continue
    if (!validCols.has(f.column)) continue // whitelist: unknown columns dropped
    if (VALUELESS_OPS.has(f.op)) {
      where.push(`${quoteIdent(f.column)} ${f.op}`)
      continue
    }
    if (!ALLOWED_OPS.has(f.op)) continue // whitelist: unknown operators dropped
    where.push(`${quoteIdent(f.column)} ${f.op} $${params.length + 1}`)
    params.push(f.value)
  }

  let orderClause = ''
  if (opts.orderBy && validCols.has(opts.orderBy)) {
    orderClause = ` order by ${quoteIdent(opts.orderBy)} ${opts.orderDir === 'desc' ? 'desc' : 'asc'}`
  }

  const filterCombinator = opts.filterCombinator === 'or' ? ' or ' : ' and '
  const whereClause = where.length ? ` where (${where.join(filterCombinator)})` : ''
  let versionColumn = '__loupedb_xmin'
  while (validCols.has(versionColumn)) versionColumn += '_'
  const selectedColumns = tableColumns.map((column) => column.type === 'binary'
    ? `case when ${quoteIdent(column.name)} is null then null else json_build_object(`
      + `'$loupedb', 'binary', 'byteLength', octet_length(${quoteIdent(column.name)}), `
      + `'checksum', md5(${quoteIdent(column.name)})) end as ${quoteIdent(column.name)}`
    : quoteIdent(column.name))
  const text = `select ${selectedColumns.join(', ')}, xmin::text as ${quoteIdent(versionColumn)}`
    + ` from ${quoteIdent(schema)}.${quoteIdent(table)}${whereClause}${orderClause}`
    + ` limit $${params.length + 1} offset $${params.length + 2}`
  const result = await executeUnsafe(
    sql, text, [...params, opts.limit, opts.offset], queryId, activeQueries, oidCache,
  )
  return {
    ...result,
    columns: result.columns.filter((column) => column.name !== versionColumn).map((column) => {
      const metadata = tableColumns.find((candidate) => candidate.name === column.name)
      return metadata
        ? { ...column, nativeType: metadata.native, type: metadata.type }
        : column
    }),
    rows: result.rows.map((row) => {
      const { [versionColumn]: _version, ...data } = row
      return data
    }),
    rowVersions: result.rows.map((row) => String(row[versionColumn])),
  }
}

export async function updateTableCell(sql: Sql, input: CellUpdateInput): Promise<CellUpdateResult> {
  const columns = await tableColumnMetadata(sql, input.schema, input.table)
  const column = columns.find((candidate) => candidate.name === input.column)
  if (!column || !column.updatable) {
    throw editError('READ_ONLY_COLUMN', 'column is not available for inline editing')
  }
  if (!CELL_EDIT_TYPES.has(column.type)) {
    throw editError('READ_ONLY_COLUMN', `cell editing is not supported for ${column.native}`)
  }

  const key = await identityKey(sql, input.schema, input.table, input.identity)
  if (key.columns.includes(input.column)) {
    throw editError('READ_ONLY_COLUMN', 'row identity columns are read-only')
  }

  let mutationValue = input.value
  if (column.type === 'binary') {
    if (input.value !== null) {
      if (!isBinaryCellUpload(input.value)) {
        throw editError('INVALID_BINARY', 'binary updates require a valid uploaded file')
      }
      mutationValue = Buffer.from(input.value.base64, 'base64')
      if ((mutationValue as Buffer).byteLength !== input.value.byteLength) {
        throw editError('INVALID_BINARY', 'binary upload size does not match its content')
      }
    }
  }

  const params: unknown[] = [mutationValue]
  const rowConditions = identityConditions(input.identity, key, params)
  if (column.type === 'binary' && input.originalValue !== null) {
    if (!isBinaryCellSummary(input.originalValue)) {
      throw editError('INVALID_BINARY', 'binary update is missing its original summary')
    }
    params.push(input.originalValue.byteLength)
    rowConditions.push(`octet_length(${quoteIdent(input.column)}) = $${params.length}`)
    params.push(input.originalValue.checksum)
    rowConditions.push(`md5(${quoteIdent(input.column)}) = $${params.length}`)
  } else {
    params.push(input.originalValue)
    rowConditions.push(`${quoteIdent(input.column)} is not distinct from $${params.length}`)
  }
  if (input.version !== undefined) {
    if (!/^\d+$/u.test(input.version)) throw editError('INVALID_IDENTITY', 'row version is invalid')
    params.push(input.version)
    rowConditions.push(`xmin::text = $${params.length}`)
  }
  const text = `update ${quoteIdent(input.schema)}.${quoteIdent(input.table)}`
    + ` set ${quoteIdent(input.column)} = $1`
    + ` where ${rowConditions.join(' and ')}`
    + ' returning *'
  const rows = await sql.unsafe(text, params as never[])
  if (rows.length !== 1) {
    throw editError('ROW_CHANGED', 'row changed or disappeared; reload before editing again')
  }
  return { affectedRows: 1, row: summarizeBinaryRow(rows[0]!, columns) }
}

export async function readTableBinaryCell(sql: Sql, input: BinaryCellReadInput): Promise<BinaryCellReadResult> {
  const columns = await tableColumnMetadata(sql, input.schema, input.table)
  const column = columns.find((candidate) => candidate.name === input.column)
  if (!column || column.type !== 'binary') {
    throw editError('READ_ONLY_COLUMN', 'column is not available as binary data')
  }
  if (!/^\d+$/u.test(input.version)) throw editError('INVALID_IDENTITY', 'row version is invalid')
  const key = await identityKey(sql, input.schema, input.table, input.identity)
  const params: unknown[] = []
  const conditions = identityConditions(input.identity, key, params)
  params.push(input.version)
  conditions.push(`xmin::text = $${params.length}`)
  const rows = await sql.unsafe(
    `select ${quoteIdent(input.column)} from ${quoteIdent(input.schema)}.${quoteIdent(input.table)}`
      + ` where ${conditions.join(' and ')}`,
    params as never[],
  )
  if (rows.length !== 1) {
    throw editError('ROW_CHANGED', 'row changed or disappeared; reload before downloading again')
  }
  const value = rows[0]![input.column]
  if (value === null) return { data: null }
  if (!(value instanceof Uint8Array)) throw editError('INVALID_BINARY', 'binary column returned an invalid value')
  return { data: Buffer.from(value) }
}

export async function insertTableRow(sql: Sql, input: RowInsertInput): Promise<RowMutationResult> {
  const columns = await tableColumnMetadata(sql, input.schema, input.table)
  if (!columns.length) throw editError('TABLE_NOT_FOUND', 'table was not found')
  const valueColumns = Object.keys(input.values)
  for (const name of valueColumns) {
    const column = columns.find((candidate) => candidate.name === name)
    if (!column || !column.insertable) {
      throw editError('READ_ONLY_COLUMN', `column ${name} is not available for insert`)
    }
    if (!INLINE_EDIT_TYPES.has(column.type)) {
      throw editError('READ_ONLY_COLUMN', `insert is not supported for ${column.native}`)
    }
  }
  const params = valueColumns.map((name) => input.values[name])
  const text = valueColumns.length
    ? `insert into ${quoteIdent(input.schema)}.${quoteIdent(input.table)}`
      + ` (${valueColumns.map(quoteIdent).join(', ')})`
      + ` values (${params.map((_, index) => `$${index + 1}`).join(', ')}) returning *`
    : `insert into ${quoteIdent(input.schema)}.${quoteIdent(input.table)} default values returning *`
  const rows = await sql.unsafe(text, params as never[])
  if (rows.length !== 1) throw editError('ROW_CHANGED', 'insert did not return exactly one row')
  return { affectedRows: 1, row: summarizeBinaryRow(rows[0]!, columns) }
}

export async function deleteTableRow(sql: Sql, input: RowDeleteInput): Promise<RowMutationResult> {
  const columns = await tableColumnMetadata(sql, input.schema, input.table)
  if (!/^\d+$/u.test(input.version)) throw editError('INVALID_IDENTITY', 'row version is invalid')
  const key = await identityKey(sql, input.schema, input.table, input.identity)
  const params: unknown[] = []
  const conditions = identityConditions(input.identity, key, params)
  params.push(input.version)
  conditions.push(`xmin::text = $${params.length}`)
  const text = `delete from ${quoteIdent(input.schema)}.${quoteIdent(input.table)}`
    + ` where ${conditions.join(' and ')} returning *`
  const rows = await sql.unsafe(text, params as never[])
  if (rows.length !== 1) {
    throw editError('ROW_CHANGED', 'row changed or disappeared; reload before deleting it')
  }
  return { affectedRows: 1, row: summarizeBinaryRow(rows[0]!, columns) }
}
