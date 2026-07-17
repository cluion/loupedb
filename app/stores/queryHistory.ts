export type QueryHistoryStatus = 'success' | 'error' | 'cancelled'

export interface QueryHistoryEntry {
  readonly id: string
  readonly sql: string
  readonly database: string | null
  readonly at: number
  readonly durationMs: number | null // legacy entries may not have failure duration
  readonly rowCount: number | null
  readonly affectedRows: number | null
  readonly status: QueryHistoryStatus
}

export type QueryHistoryInput = Omit<QueryHistoryEntry, 'id'>

export const QUERY_HISTORY_LIMIT = 200
// keyed by connection *name*, not session id - session ids change on every
// reconnect and history should accumulate across them
const STORAGE_PREFIX = 'loupedb:query-history:v1:'

function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `qh-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function addHistoryEntry(
  list: ReadonlyArray<QueryHistoryEntry>, entry: QueryHistoryEntry,
): ReadonlyArray<QueryHistoryEntry> {
  return [entry, ...list].slice(0, QUERY_HISTORY_LIMIT)
}

function restoreEntry(value: unknown): QueryHistoryEntry | null {
  if (!value || typeof value !== 'object') return null
  const e = value as Record<string, unknown>
  const baseIsValid = typeof e.id === 'string' && typeof e.sql === 'string'
    && (e.database === null || typeof e.database === 'string')
    && typeof e.at === 'number'
    && (e.durationMs === null || typeof e.durationMs === 'number')
    && (e.rowCount === null || typeof e.rowCount === 'number')
  if (!baseIsValid) return null

  // v0.2 stored only `ok`; keep those histories while moving to an explicit
  // three-state model that can distinguish user cancellation from errors.
  const status: QueryHistoryStatus | null = e.status === 'success' || e.status === 'error' || e.status === 'cancelled'
    ? e.status
    : typeof e.ok === 'boolean'
      ? e.ok ? 'success' : 'error'
      : null
  if (!status) return null
  const affectedRows = e.affectedRows === undefined || e.affectedRows === null
    ? null
    : typeof e.affectedRows === 'number' ? e.affectedRows : undefined
  if (affectedRows === undefined) return null
  return {
    id: e.id as string,
    sql: e.sql as string,
    database: e.database as string | null,
    at: e.at as number,
    durationMs: e.durationMs as number | null,
    rowCount: e.rowCount as number | null,
    affectedRows,
    status,
  }
}

export function restoreQueryHistory(raw: string): ReadonlyArray<QueryHistoryEntry> | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return null
    const entries = parsed.map(restoreEntry)
    return entries.every((entry) => entry !== null) ? entries as QueryHistoryEntry[] : null
  } catch {
    return null
  }
}

function storageKey(label: string): string {
  return `${STORAGE_PREFIX}${label}`
}

function loadFromStorage(label: string): ReadonlyArray<QueryHistoryEntry> {
  if (!import.meta.client) return []
  const raw = localStorage.getItem(storageKey(label))
  if (!raw) return []
  const restored = restoreQueryHistory(raw)
  if (!restored) localStorage.removeItem(storageKey(label))
  return restored ?? []
}

export function useQueryHistory(label: string) {
  const entries = useState<ReadonlyArray<QueryHistoryEntry>>(
    `query-history:${label}`, () => loadFromStorage(label),
  )
  const persist = () => {
    if (import.meta.client) localStorage.setItem(storageKey(label), JSON.stringify(entries.value))
  }
  return {
    entries,
    add: (input: QueryHistoryInput) => {
      entries.value = addHistoryEntry(entries.value, { ...input, id: createId() })
      persist()
    },
    clear: () => {
      entries.value = []
      if (import.meta.client) localStorage.removeItem(storageKey(label))
    },
  }
}
