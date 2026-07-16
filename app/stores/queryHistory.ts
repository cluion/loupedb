export interface QueryHistoryEntry {
  readonly id: string
  readonly sql: string
  readonly database: string | null
  readonly at: number
  readonly durationMs: number | null // null when the execution failed
  readonly rowCount: number | null
  readonly ok: boolean
}

export type QueryHistoryInput = Omit<QueryHistoryEntry, 'id' | 'at'>

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

function isEntry(value: unknown): value is QueryHistoryEntry {
  if (!value || typeof value !== 'object') return false
  const e = value as Record<string, unknown>
  return typeof e.id === 'string' && typeof e.sql === 'string'
    && (e.database === null || typeof e.database === 'string')
    && typeof e.at === 'number'
    && (e.durationMs === null || typeof e.durationMs === 'number')
    && (e.rowCount === null || typeof e.rowCount === 'number')
    && typeof e.ok === 'boolean'
}

export function restoreQueryHistory(raw: string): ReadonlyArray<QueryHistoryEntry> | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) && parsed.every(isEntry) ? parsed : null
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
      entries.value = addHistoryEntry(entries.value, { ...input, id: createId(), at: Date.now() })
      persist()
    },
    clear: () => {
      entries.value = []
      if (import.meta.client) localStorage.removeItem(storageKey(label))
    },
  }
}
