<script setup lang="ts">
import type { BrowseFilterCondition, ForeignKeyNavigationTarget } from '#shared/types'
import { clearSqlWorkspacePersistence } from '../stores/sqlWorkspace'

const {
  currentConnectionId,
  currentConnectionName,
  currentConnectionEnvironment,
  currentConnectionSafetyMode,
  setCurrentConnection,
  restoreSession,
} = useSession()
const { remove } = useConnections()
const locked = ref(false)
// connId is the sibling session bound to the selected database
interface SelectedTable {
  readonly connId: string
  readonly database: string
  readonly schema: string
  readonly table: string
  readonly initialFilters: ReadonlyArray<BrowseFilterCondition>
  readonly selectionKey: number
}
let nextSelectionKey = 1
const selected = ref<SelectedTable | null>(null)
const view = ref<'data' | 'structure'>('data')
const hasStagedChanges = ref(false)
// sql runs against the database the user is currently looking at
const activeConnId = computed(() => selected.value?.connId ?? currentConnectionId.value!)

// probe the app password gate (server middleware): 401 = unlock needed
// Restoring during Vue's hydration phase can leave client-only CodeMirror on
// its SSR placeholder. Wait until Nuxt has fully mounted before opening the
// persisted workspace.
onNuxtReady(async () => {
  const restoredId = restoreSession()
  try {
    await $fetch('/api/connections')
  } catch (err) {
    if ((err as { statusCode?: number }).statusCode === 401) {
      locked.value = true
      return
    }
  }
  // Browser storage can outlive the in-memory server session. Do not strand the
  // user in a workspace bound to an id that disappeared after a server restart.
  if (restoredId) {
    const check = await useSchema(restoredId).databases()
    if (!check.ok && check.error.code === 'NO_CONN') {
      clearSqlWorkspacePersistence(restoredId)
      setCurrentConnection(null)
    }
  }
})

async function disconnect() {
  if (!confirmDiscardStagedChanges()) return
  const id = currentConnectionId.value
  if (id) await remove(id) // server cascades sibling sessions
  if (id) clearSqlWorkspacePersistence(id)
  setCurrentConnection(null)
  selected.value = null
}

function confirmDiscardStagedChanges(): boolean {
  return !hasStagedChanges.value || window.confirm('尚有未套用的資料變更，確定要全部捨棄嗎？')
}

function selectTable(connId: string, database: string, schema: string, table: string) {
  const current = selected.value
  const changed = !current
    || current.connId !== connId || current.schema !== schema || current.table !== table
  if (changed && !confirmDiscardStagedChanges()) return
  if (!changed) return
  hasStagedChanges.value = false
  selected.value = {
    connId, database, schema, table, initialFilters: [], selectionKey: nextSelectionKey++,
  }
}

function navigateForeignKey(target: ForeignKeyNavigationTarget) {
  const current = selected.value
  if (!current || !confirmDiscardStagedChanges()) return
  hasStagedChanges.value = false
  view.value = 'data'
  selected.value = {
    connId: current.connId,
    database: current.database,
    schema: target.schema,
    table: target.table,
    initialFilters: target.filters.map((filter) => ({ ...filter })),
    selectionKey: nextSelectionKey++,
  }
}

function selectView(next: 'data' | 'structure') {
  if (view.value === 'data' && next !== 'data' && !confirmDiscardStagedChanges()) return
  hasStagedChanges.value = false
  view.value = next
}

function beforeUnload(event: BeforeUnloadEvent) {
  if (!hasStagedChanges.value) return
  event.preventDefault()
  event.returnValue = ''
}

onMounted(() => window.addEventListener('beforeunload', beforeUnload))
onUnmounted(() => window.removeEventListener('beforeunload', beforeUnload))
</script>

<template>
  <div v-if="locked || !currentConnectionId" class="lens-stage">
    <div class="lens-card">
      <p class="wordmark mark"><span class="ring" /> LoupeDB</p>
      <AppPasswordGate v-if="locked" @unlocked="locked = false; refreshNuxtData()" />
      <ConnectionList v-else @connect="setCurrentConnection" />
    </div>
  </div>

  <div v-else class="workspace">
    <WorkspaceHeader
      class="area-header"
      :connection-label="currentConnectionName ?? currentConnectionId.slice(0, 8)"
      :environment="currentConnectionEnvironment"
      :safety-mode="currentConnectionSafetyMode"
      @disconnect="disconnect"
    />
    <aside class="rail">
      <p class="eyebrow">Schema</p>
      <SchemaTree
        :connection-id="currentConnectionId"
        @select-table="selectTable"
      />
    </aside>
    <main class="main">
      <section v-if="selected" class="panel">
        <div class="panel-head">
          <p class="eyebrow">{{ selected.database }} / {{ selected.schema }}.{{ selected.table }}</p>
          <div class="tabs">
            <button class="ghost" :class="{ active: view === 'data' }" @click="selectView('data')">資料</button>
            <button class="ghost" :class="{ active: view === 'structure' }" @click="selectView('structure')">結構</button>
          </div>
        </div>
        <template v-if="view === 'data'">
          <DataGrid
            :key="selected.selectionKey"
            :connection-id="selected.connId" :schema="selected.schema" :table="selected.table"
            :database="selected.database"
            :history-label="currentConnectionName ?? currentConnectionId"
            :safety-mode="currentConnectionSafetyMode"
            :initial-filters="selected.initialFilters"
            @dirty-state="hasStagedChanges = $event"
            @navigate-foreign-key="navigateForeignKey"
          />
          <StreamResult :connection-id="selected.connId" :schema="selected.schema" :table="selected.table" />
        </template>
        <TableStructure
          v-else
          :key="`${selected.connId}.${selected.schema}.${selected.table}`"
          :connection-id="selected.connId" :schema="selected.schema" :table="selected.table"
        />
      </section>
      <section v-else class="panel empty">
        <p>從左側展開資料庫、選擇一張表開始瀏覽，或直接在下方執行 SQL。</p>
      </section>
      <section class="panel">
        <SqlWorkspace
          :workspace-id="currentConnectionId"
          :history-label="currentConnectionName ?? currentConnectionId"
          :suggested-connection-id="activeConnId"
          :suggested-database="selected?.database ?? null"
          :suggested-schema="selected?.schema ?? null"
          :safety-mode="currentConnectionSafetyMode"
        />
      </section>
    </main>
  </div>
</template>

<style scoped>
/* connect screen: light falling through a lens onto the card */
.lens-stage {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
  background:
    radial-gradient(640px circle at 50% 28%, rgba(127, 180, 201, 0.07), transparent 62%),
    var(--ink);
}
.lens-card {
  width: min(440px, 100%);
  background: var(--panel);
  border: 1px solid var(--line);
  border-top: 2px solid var(--brass);
  border-radius: var(--radius);
  padding: 28px;
}
.mark { font-size: 18px; margin: 0 0 22px; }

/* workspace: header on top, schema rail left, work area right */
.workspace {
  height: 100vh;
  display: grid;
  grid-template:
    "header header" auto
    "rail   main" 1fr / 240px 1fr;
}
.area-header { grid-area: header; }
.rail {
  grid-area: rail;
  border-right: 1px solid var(--line);
  padding: 14px;
  overflow-y: auto;
  background: var(--panel);
}
.main {
  grid-area: main;
  padding: 14px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.empty { color: var(--muted); }
.panel-head { display: flex; align-items: baseline; justify-content: space-between; }
.tabs { display: flex; gap: 4px; }
.tabs .active { color: var(--brass); }

@media (max-width: 720px) {
  .workspace {
    grid-template:
      "header" auto
      "rail" auto
      "main" 1fr / 1fr;
  }
  .rail { border-right: none; border-bottom: 1px solid var(--line); max-height: 30vh; }
}
</style>
