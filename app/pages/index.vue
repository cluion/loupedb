<script setup lang="ts">
const { currentConnectionId, currentConnectionName, setCurrentConnection } = useSession()
const { remove } = useConnections()
const locked = ref(false)
// connId is the sibling session bound to the selected database
const selected = ref<{ connId: string; database: string; schema: string; table: string } | null>(null)
const view = ref<'data' | 'structure'>('data')
// sql runs against the database the user is currently looking at
const activeConnId = computed(() => selected.value?.connId ?? currentConnectionId.value!)

// probe the app password gate (server middleware): 401 = unlock needed
onMounted(async () => {
  try {
    await $fetch('/api/connections')
  } catch (err) {
    if ((err as { statusCode?: number }).statusCode === 401) locked.value = true
  }
})

async function disconnect() {
  const id = currentConnectionId.value
  if (id) await remove(id) // server cascades sibling sessions
  setCurrentConnection(null)
  selected.value = null
}
</script>

<template>
  <div v-if="locked || !currentConnectionId" class="lens-stage">
    <div class="lens-card">
      <p class="wordmark mark"><span class="ring" /> LoupeDB</p>
      <AppPasswordGate v-if="locked" @unlocked="locked = false; refreshNuxtData()" />
      <ConnectionList v-else @connect="(id, name) => setCurrentConnection(id, name)" />
    </div>
  </div>

  <div v-else class="workspace">
    <WorkspaceHeader
      class="area-header"
      :connection-label="currentConnectionName ?? currentConnectionId.slice(0, 8)"
      @disconnect="disconnect"
    />
    <aside class="rail">
      <p class="eyebrow">Schema</p>
      <SchemaTree
        :connection-id="currentConnectionId"
        @select-table="(cid, db, s, t) => selected = { connId: cid, database: db, schema: s, table: t }"
      />
    </aside>
    <main class="main">
      <section v-if="selected" class="panel">
        <div class="panel-head">
          <p class="eyebrow">{{ selected.database }} / {{ selected.schema }}.{{ selected.table }}</p>
          <div class="tabs">
            <button class="ghost" :class="{ active: view === 'data' }" @click="view = 'data'">資料</button>
            <button class="ghost" :class="{ active: view === 'structure' }" @click="view = 'structure'">結構</button>
          </div>
        </div>
        <template v-if="view === 'data'">
          <DataGrid
            :key="`${selected.connId}.${selected.schema}.${selected.table}`"
            :connection-id="selected.connId" :schema="selected.schema" :table="selected.table"
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
        <p class="eyebrow">SQL{{ selected ? ` @ ${selected.database}` : '' }}</p>
        <SqlEditor :key="activeConnId" :connection-id="activeConnId" />
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
