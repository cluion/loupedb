import {
  BROWSE_FILTER_COMBINATORS,
  BROWSE_FILTER_OPERATORS,
  MAX_BROWSE_FILTERS,
  VALUELESS_BROWSE_FILTER_OPERATORS,
  type BrowseFilterCombinator,
  type BrowseFilterCondition,
  type BrowseFilterOperator,
} from '#shared/types'

export interface TableFilterHistoryEntry {
  readonly id: string
  readonly at: number
  readonly combinator: BrowseFilterCombinator
  readonly filters: ReadonlyArray<BrowseFilterCondition>
}

export interface TableFilterHistoryInput {
  readonly combinator: BrowseFilterCombinator
  readonly filters: ReadonlyArray<BrowseFilterCondition>
}

export const TABLE_FILTER_HISTORY_LIMIT = 10
const STORAGE_PREFIX = 'loupedb:table-filter-history:v1:'
const OPERATORS: ReadonlySet<string> = new Set(BROWSE_FILTER_OPERATORS)
const VALUELESS_OPERATORS: ReadonlySet<string> = new Set(VALUELESS_BROWSE_FILTER_OPERATORS)
const COMBINATORS: ReadonlySet<string> = new Set(BROWSE_FILTER_COMBINATORS)

function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `fh-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function historySignature(entry: Pick<TableFilterHistoryEntry, 'combinator' | 'filters'>): string {
  return JSON.stringify([entry.combinator, entry.filters])
}

export function addTableFilterHistoryEntry(
  list: ReadonlyArray<TableFilterHistoryEntry>, entry: TableFilterHistoryEntry,
): ReadonlyArray<TableFilterHistoryEntry> {
  const signature = historySignature(entry)
  return [entry, ...list.filter((candidate) => historySignature(candidate) !== signature)]
    .slice(0, TABLE_FILTER_HISTORY_LIMIT)
}

function isScalar(value: unknown): boolean {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value)
}

function restoreFilter(value: unknown): BrowseFilterCondition | null {
  if (!value || typeof value !== 'object') return null
  const filter = value as Record<string, unknown>
  if (typeof filter.column !== 'string' || !filter.column) return null
  if (typeof filter.op !== 'string' || !OPERATORS.has(filter.op)) return null
  const op = filter.op as BrowseFilterOperator
  if (VALUELESS_OPERATORS.has(op)) return { column: filter.column, op }
  if (!Object.hasOwn(filter, 'value') || !isScalar(filter.value)) return null
  return { column: filter.column, op, value: filter.value }
}

function restoreEntry(value: unknown): TableFilterHistoryEntry | null {
  if (!value || typeof value !== 'object') return null
  const entry = value as Record<string, unknown>
  if (typeof entry.id !== 'string' || !entry.id || typeof entry.at !== 'number') return null
  if (typeof entry.combinator !== 'string' || !COMBINATORS.has(entry.combinator)) return null
  if (!Array.isArray(entry.filters) || !entry.filters.length || entry.filters.length > MAX_BROWSE_FILTERS) return null
  const filters = entry.filters.map(restoreFilter)
  if (filters.some((filter) => filter === null)) return null
  return {
    id: entry.id,
    at: entry.at,
    combinator: entry.combinator as BrowseFilterCombinator,
    filters: filters as BrowseFilterCondition[],
  }
}

export function restoreTableFilterHistory(raw: string): ReadonlyArray<TableFilterHistoryEntry> | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed) || parsed.length > TABLE_FILTER_HISTORY_LIMIT) return null
    const entries = parsed.map(restoreEntry)
    return entries.every((entry) => entry !== null) ? entries as TableFilterHistoryEntry[] : null
  } catch {
    return null
  }
}

function storageKey(scope: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(scope)}`
}

function loadFromStorage(scope: string): ReadonlyArray<TableFilterHistoryEntry> {
  if (!import.meta.client) return []
  const key = storageKey(scope)
  const raw = localStorage.getItem(key)
  if (!raw) return []
  const restored = restoreTableFilterHistory(raw)
  if (!restored) localStorage.removeItem(key)
  return restored ?? []
}

export function useTableFilterHistory(scope: string) {
  const entries = useState<ReadonlyArray<TableFilterHistoryEntry>>(
    `table-filter-history:${scope}`, () => loadFromStorage(scope),
  )
  const persist = () => {
    if (import.meta.client) localStorage.setItem(storageKey(scope), JSON.stringify(entries.value))
  }
  return {
    entries,
    add: (input: TableFilterHistoryInput) => {
      if (!input.filters.length) return
      entries.value = addTableFilterHistoryEntry(entries.value, {
        ...input, id: createId(), at: Date.now(),
      })
      persist()
    },
    remove: (id: string) => {
      entries.value = entries.value.filter((entry) => entry.id !== id)
      if (entries.value.length) persist()
      else if (import.meta.client) localStorage.removeItem(storageKey(scope))
    },
    clear: () => {
      entries.value = []
      if (import.meta.client) localStorage.removeItem(storageKey(scope))
    },
  }
}
