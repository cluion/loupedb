import type postgres from 'postgres'
import type { QueryResult, ColumnInfo, BrowseOpts } from '#shared/types'
import { normalizePgType } from '../../core/normalizer'

type Sql = ReturnType<typeof postgres>

export interface CancellableQuery { cancel(): void }

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

interface RowListMeta {
  readonly columns?: ReadonlyArray<{ name: string; type: number }>
  readonly count?: number
}

export async function executeUnsafe(
  sql: Sql, text: string, params: ReadonlyArray<unknown>, queryId: string | undefined,
  activeQueries: Map<string, CancellableQuery>, oidCache: Map<number, string>,
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
    return {
      columns,
      rows: [...result] as Record<string, unknown>[],
      rowCount: result.length,
      affectedRows: meta.count,
      executionMs: performance.now() - start,
    }
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

  const where: string[] = []
  const params: unknown[] = []
  for (const f of opts.filter ?? []) {
    if (!validCols.has(f.column)) continue // whitelist: unknown columns dropped
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
