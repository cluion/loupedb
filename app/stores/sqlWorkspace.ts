import type { SqlExecutionResult } from '#shared/types'

export interface SqlTabContext {
  readonly connectionId: string
  readonly database: string | null
  readonly schema: string | null
}

export interface SqlTab extends SqlTabContext {
  readonly id: string
  readonly title: string
  readonly sql: string
  // Results stay in memory while switching tabs, but are deliberately omitted
  // from localStorage because database rows may contain sensitive data.
  readonly result: SqlExecutionResult | null
}

export interface SqlWorkspaceState {
  readonly tabs: ReadonlyArray<SqlTab>
  readonly activeTabId: string
}

type SqlTabPatch = Partial<Pick<SqlTab, 'sql' | 'result' | 'connectionId' | 'database' | 'schema'>>

const DEFAULT_SQL = 'SELECT * FROM '
const STORAGE_PREFIX = 'loupedb:sql-workspace:v1:'

function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `sql-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function nextTitle(tabs: ReadonlyArray<SqlTab>): string {
  const used = new Set(tabs.map((tab) => tab.title))
  let number = 1
  while (used.has(`Query ${number}`)) number += 1
  return `Query ${number}`
}

function createTab(context: SqlTabContext, id: string, title: string): SqlTab {
  return { id, title, sql: DEFAULT_SQL, result: null, ...context }
}

export function createSqlWorkspace(context: SqlTabContext, id = createId()): SqlWorkspaceState {
  const tab = createTab(context, id, 'Query 1')
  return { tabs: [tab], activeTabId: tab.id }
}

export function addSqlTab(
  state: SqlWorkspaceState, context: SqlTabContext, id = createId(),
): SqlWorkspaceState {
  const tab = createTab(context, id, nextTitle(state.tabs))
  return { tabs: [...state.tabs, tab], activeTabId: tab.id }
}

export function activateSqlTab(state: SqlWorkspaceState, id: string): SqlWorkspaceState {
  return state.tabs.some((tab) => tab.id === id) ? { ...state, activeTabId: id } : state
}

export function renameSqlTab(state: SqlWorkspaceState, id: string, title: string): SqlWorkspaceState {
  const trimmed = title.trim()
  if (!trimmed) return state
  return { ...state, tabs: state.tabs.map((tab) => tab.id === id ? { ...tab, title: trimmed } : tab) }
}

export function updateSqlTab(state: SqlWorkspaceState, id: string, patch: SqlTabPatch): SqlWorkspaceState {
  return { ...state, tabs: state.tabs.map((tab) => tab.id === id ? { ...tab, ...patch } : tab) }
}

export function moveSqlTab(state: SqlWorkspaceState, movingId: string, targetId: string): SqlWorkspaceState {
  if (movingId === targetId) return state
  const moving = state.tabs.find((tab) => tab.id === movingId)
  if (!moving || !state.tabs.some((tab) => tab.id === targetId)) return state
  const tabs = state.tabs.filter((tab) => tab.id !== movingId)
  const targetIndex = tabs.findIndex((tab) => tab.id === targetId)
  return { ...state, tabs: [...tabs.slice(0, targetIndex), moving, ...tabs.slice(targetIndex)] }
}

export function closeSqlTab(
  state: SqlWorkspaceState, id: string, fallbackContext: SqlTabContext, fallbackId = createId(),
): SqlWorkspaceState {
  const closingIndex = state.tabs.findIndex((tab) => tab.id === id)
  if (closingIndex < 0) return state
  const tabs = state.tabs.filter((tab) => tab.id !== id)
  if (!tabs.length) return createSqlWorkspace(fallbackContext, fallbackId)
  if (state.activeTabId !== id) return { ...state, tabs }
  const nextActive = tabs[Math.min(closingIndex, tabs.length - 1)]!
  return { tabs, activeTabId: nextActive.id }
}

export function serializeSqlWorkspace(state: SqlWorkspaceState): string {
  return JSON.stringify({
    activeTabId: state.activeTabId,
    tabs: state.tabs.map(({ result: _result, ...draft }) => draft),
  })
}

function optionalString(value: unknown): string | null | undefined {
  return value === null ? null : typeof value === 'string' ? value : undefined
}

export function restoreSqlWorkspace(raw: string, fallbackContext: SqlTabContext): SqlWorkspaceState | null {
  try {
    const parsed = JSON.parse(raw) as { tabs?: unknown; activeTabId?: unknown }
    if (!Array.isArray(parsed.tabs) || !parsed.tabs.length) return null
    const tabs: SqlTab[] = []
    for (const value of parsed.tabs) {
      if (!value || typeof value !== 'object') return null
      const tab = value as Record<string, unknown>
      if (typeof tab.id !== 'string' || typeof tab.title !== 'string' || typeof tab.sql !== 'string') return null
      const database = optionalString(tab.database)
      const schema = optionalString(tab.schema)
      if (database === undefined || schema === undefined) return null
      const connectionId = typeof tab.connectionId === 'string' && tab.connectionId
        ? tab.connectionId
        : fallbackContext.connectionId
      tabs.push({
        id: tab.id, title: tab.title, sql: tab.sql, connectionId,
        database, schema, result: null,
      })
    }
    const requestedActive = typeof parsed.activeTabId === 'string' ? parsed.activeTabId : ''
    const activeTabId = tabs.some((tab) => tab.id === requestedActive) ? requestedActive : tabs[0]!.id
    return { tabs, activeTabId }
  } catch {
    return null
  }
}

function storageKey(workspaceId: string): string {
  return `${STORAGE_PREFIX}${workspaceId}`
}

export function clearSqlWorkspacePersistence(workspaceId: string): void {
  if (import.meta.client) localStorage.removeItem(storageKey(workspaceId))
}

export function useSqlWorkspace(workspaceId: string, initialContext: SqlTabContext) {
  const state = useState<SqlWorkspaceState>(`sql-workspace:${workspaceId}`, () => createSqlWorkspace(initialContext))
  const persistenceReady = ref(false)

  const stopPersistence = watch(state, (next) => {
    if (import.meta.client && persistenceReady.value) {
      localStorage.setItem(storageKey(workspaceId), serializeSqlWorkspace(next))
    }
  })

  onMounted(() => {
    const stored = localStorage.getItem(storageKey(workspaceId))
    if (stored) {
      const restored = restoreSqlWorkspace(stored, initialContext)
      if (restored) state.value = restored
      else localStorage.removeItem(storageKey(workspaceId))
    }
    persistenceReady.value = true
  })
  onUnmounted(stopPersistence)

  const activeTab = computed(() => state.value.tabs.find((tab) => tab.id === state.value.activeTabId))

  return {
    state,
    activeTab,
    ready: persistenceReady,
    addTab: (context: SqlTabContext) => { state.value = addSqlTab(state.value, context) },
    activateTab: (id: string) => { state.value = activateSqlTab(state.value, id) },
    renameTab: (id: string, title: string) => { state.value = renameSqlTab(state.value, id, title) },
    updateTab: (id: string, patch: SqlTabPatch) => { state.value = updateSqlTab(state.value, id, patch) },
    moveTab: (movingId: string, targetId: string) => { state.value = moveSqlTab(state.value, movingId, targetId) },
    closeTab: (id: string, context: SqlTabContext) => { state.value = closeSqlTab(state.value, id, context) },
    setActiveContext: (context: SqlTabContext) => {
      const id = state.value.activeTabId
      state.value = updateSqlTab(state.value, id, { ...context, result: null })
    },
  }
}
