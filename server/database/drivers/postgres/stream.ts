import type postgres from 'postgres'
import type { BrowseOpts } from '#shared/types'
import { quoteIdent, type CancellableQuery } from './query'

type Sql = ReturnType<typeof postgres>

export async function cancelQuery(activeQueries: Map<string, CancellableQuery>, queryId: string): Promise<void> {
  const q = activeQueries.get(queryId)
  if (q) q.cancel()
}

// streams must register in activeQueries too, or cancel(queryId) never affects them
// a cursor has no direct cancel handle - a flag plus break stops iteration and
// closing the cursor releases its connection
export async function* streamTable(
  sql: Sql, schema: string, table: string, opts: BrowseOpts, batchSize: number,
  queryId: string | undefined, activeQueries: Map<string, CancellableQuery>,
): AsyncIterable<ReadonlyArray<Record<string, unknown>>> {
  let cancelled = false
  if (queryId) activeQueries.set(queryId, { cancel: () => { cancelled = true } })
  try {
    const tbl = `${quoteIdent(schema)}.${quoteIdent(table)}` // never interpolate raw identifiers
    const cursor = sql.unsafe(
      `select * from ${tbl} limit ${Number(opts.limit)} offset ${Number(opts.offset)}`,
    ).cursor(batchSize)
    for await (const rows of cursor as AsyncIterable<ReadonlyArray<Record<string, unknown>>>) {
      if (cancelled) break
      yield rows
    }
  } finally {
    if (queryId) activeQueries.delete(queryId)
  }
}
