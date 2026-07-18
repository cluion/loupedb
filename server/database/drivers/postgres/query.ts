import type postgres from 'postgres'
import type { BrowseOpts, CellUpdateInput, CellUpdateResult, ColumnInfo, NormalizedType, QueryMessage, QueryResult } from '#shared/types'
import { normalizePgType } from '../../core/normalizer'

type Sql = ReturnType<typeof postgres>

export interface CancellableQuery { cancel(): void }

const INLINE_EDIT_TYPES: ReadonlySet<NormalizedType> = new Set([
  'integer', 'decimal', 'string', 'boolean', 'datetime', 'date', 'time', 'uuid', 'enum',
])

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
    select column_name from information_schema.columns
    where table_schema = ${schema} and table_name = ${table}`
  const validCols = new Set(colRows.map((r) => String(r.column_name)))

  // ops are interpolated into SQL - runtime whitelist required because BrowseOpts
  // arrives from API request bodies where TS types do not hold
  const ALLOWED_OPS: ReadonlySet<string> = new Set(['=', '!=', '>', '<', 'like'])

  const where: string[] = []
  const params: unknown[] = []
  for (const f of opts.filter ?? []) {
    if (!validCols.has(f.column)) continue // whitelist: unknown columns dropped
    if (!ALLOWED_OPS.has(f.op)) continue // whitelist: unknown operators dropped
    where.push(`${quoteIdent(f.column)} ${f.op} $${params.length + 1}`)
    params.push(f.value)
  }

  let orderClause = ''
  if (opts.orderBy && validCols.has(opts.orderBy)) {
    orderClause = ` order by ${quoteIdent(opts.orderBy)} ${opts.orderDir === 'desc' ? 'desc' : 'asc'}`
  }

  const whereClause = where.length ? ` where ${where.join(' and ')}` : ''
  const text = `select * from ${quoteIdent(schema)}.${quoteIdent(table)}${whereClause}${orderClause}`
    + ` limit $${params.length + 1} offset $${params.length + 2}`
  return executeUnsafe(sql, text, [...params, opts.limit, opts.offset], queryId, activeQueries, oidCache)
}

export async function updateTableCell(sql: Sql, input: CellUpdateInput): Promise<CellUpdateResult> {
  const columnRows = await sql`
    select c.udt_name as native,
           c.is_updatable = 'YES' as is_updatable,
           t.typtype as type_kind
    from information_schema.columns c
    join pg_type t on t.typname = c.udt_name
    join pg_namespace tn on tn.oid = t.typnamespace and tn.nspname = c.udt_schema
    where c.table_schema = ${input.schema}
      and c.table_name = ${input.table}
      and c.column_name = ${input.column}`
  const column = columnRows[0]
  if (!column || !column.is_updatable) {
    throw editError('READ_ONLY_COLUMN', 'column is not available for inline editing')
  }
  const native = String(column.native)
  const type = column.type_kind === 'e' ? 'enum' : normalizePgType(native)
  if (!INLINE_EDIT_TYPES.has(type)) {
    throw editError('READ_ONLY_COLUMN', `inline editing is not supported for ${native}`)
  }

  const pkRows = await sql`
    select kcu.column_name as col from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
    where tc.table_schema = ${input.schema} and tc.table_name = ${input.table}
      and tc.constraint_type = 'PRIMARY KEY'
    order by kcu.ordinal_position`
  const primaryKey = pkRows.map((row) => String(row.col))
  if (!primaryKey.length) {
    throw editError('SAFE_EDIT_REQUIRED', 'table has no primary key and is read-only')
  }
  if (primaryKey.includes(input.column)) {
    throw editError('READ_ONLY_COLUMN', 'primary key columns are read-only')
  }
  const identityKeys = Object.keys(input.identity)
  if (
    identityKeys.length !== primaryKey.length
    || primaryKey.some((key) => !hasOwn(input.identity, key))
    || identityKeys.some((key) => !primaryKey.includes(key))
  ) {
    throw editError('INVALID_IDENTITY', 'row identity must contain the complete primary key')
  }

  const params: unknown[] = [input.value]
  const identityConditions = primaryKey.map((key) => {
    params.push(input.identity[key])
    return `${quoteIdent(key)} is not distinct from $${params.length}`
  })
  params.push(input.originalValue)
  const originalCondition = `${quoteIdent(input.column)} is not distinct from $${params.length}`
  const text = `update ${quoteIdent(input.schema)}.${quoteIdent(input.table)}`
    + ` set ${quoteIdent(input.column)} = $1`
    + ` where ${[...identityConditions, originalCondition].join(' and ')}`
    + ' returning *'
  const rows = await sql.unsafe(text, params as never[])
  if (rows.length !== 1) {
    throw editError('ROW_CHANGED', 'row changed or disappeared; reload before editing again')
  }
  return { affectedRows: 1, row: { ...rows[0] } }
}
