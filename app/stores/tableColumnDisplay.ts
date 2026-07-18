export interface TableColumnDisplaySettings {
  readonly order: ReadonlyArray<string>
  readonly hidden: ReadonlyArray<string>
  readonly widths: Readonly<Record<string, number>>
  readonly frozenCount: number
}

export const DEFAULT_COLUMN_WIDTH = 180
export const MIN_COLUMN_WIDTH = 80
export const MAX_COLUMN_WIDTH = 600
const STORAGE_PREFIX = 'loupedb:table-column-display:v1:'

function emptySettings(): TableColumnDisplaySettings {
  return { order: [], hidden: [], widths: {}, frozenCount: 0 }
}

function uniqueStrings(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item)) return null
  const items = value as string[]
  return new Set(items).size === items.length ? items : null
}

function restoreWidths(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const widths: Record<string, number> = {}
  for (const [column, width] of Object.entries(value)) {
    if (!column || typeof width !== 'number' || !Number.isInteger(width)) return null
    if (width < MIN_COLUMN_WIDTH || width > MAX_COLUMN_WIDTH) return null
    widths[column] = width
  }
  return widths
}

export function restoreTableColumnDisplay(raw: string): TableColumnDisplaySettings | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const value = parsed as Record<string, unknown>
    const order = uniqueStrings(value.order)
    const hidden = uniqueStrings(value.hidden)
    const widths = restoreWidths(value.widths)
    if (!order || !hidden || !widths) return null
    if (!Number.isInteger(value.frozenCount) || (value.frozenCount as number) < 0) return null
    return { order, hidden, widths, frozenCount: value.frozenCount as number }
  } catch {
    return null
  }
}

export function clampColumnWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_COLUMN_WIDTH
  return Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, Math.round(width)))
}

export function reconcileTableColumnDisplay(
  settings: TableColumnDisplaySettings | null,
  columns: ReadonlyArray<string>,
): TableColumnDisplaySettings {
  const available = [...new Set(columns.filter(Boolean))]
  const availableSet = new Set(available)
  const savedOrder = settings?.order.filter((column) => availableSet.has(column)) ?? []
  const ordered = [...savedOrder, ...available.filter((column) => !savedOrder.includes(column))]
  const hidden = new Set(settings?.hidden.filter((column) => availableSet.has(column)) ?? [])
  if (ordered.length && hidden.size === ordered.length) hidden.delete(ordered[0]!)
  const widths = Object.fromEntries(
    Object.entries(settings?.widths ?? {}).filter(([column]) => availableSet.has(column)),
  )
  const visibleCount = ordered.filter((column) => !hidden.has(column)).length
  return {
    order: ordered,
    hidden: ordered.filter((column) => hidden.has(column)),
    widths,
    frozenCount: Math.min(settings?.frozenCount ?? 0, visibleCount),
  }
}

function storageKey(scope: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(scope)}`
}

function loadFromStorage(scope: string): TableColumnDisplaySettings | null {
  if (!import.meta.client) return null
  const key = storageKey(scope)
  const raw = localStorage.getItem(key)
  if (!raw) return null
  const restored = restoreTableColumnDisplay(raw)
  if (!restored) localStorage.removeItem(key)
  return restored
}

export function useTableColumnDisplay(scope: string) {
  const restored = loadFromStorage(scope)
  const settings = ref<TableColumnDisplaySettings>(restored ?? emptySettings())
  let shouldPersist = restored !== null
  const persist = () => {
    shouldPersist = true
    if (import.meta.client) localStorage.setItem(storageKey(scope), JSON.stringify(settings.value))
  }
  return {
    settings,
    reconcile: (columns: ReadonlyArray<string>) => {
      const reconciled = reconcileTableColumnDisplay(settings.value, columns)
      if (JSON.stringify(reconciled) === JSON.stringify(settings.value)) return
      settings.value = reconciled
      if (shouldPersist) persist()
    },
    update: (next: TableColumnDisplaySettings, persistNow = true) => {
      settings.value = next
      shouldPersist = true
      if (persistNow) persist()
    },
    persist,
    reset: (columns: ReadonlyArray<string>) => {
      settings.value = reconcileTableColumnDisplay(null, columns)
      shouldPersist = false
      if (import.meta.client) localStorage.removeItem(storageKey(scope))
    },
  }
}
