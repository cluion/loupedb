<script setup lang="ts">
import type { DatabaseInfo, SchemaInfo, TableInfo } from '#shared/types'

const props = defineProps<{ connectionId: string }>()
// emits the sibling session id - the grid must query through it, not the root
const emit = defineEmits<{ 'select-table': [connId: string, database: string, schema: string, table: string] }>()

const { openDatabase } = useConnections()

const databases = ref<ReadonlyArray<DatabaseInfo>>([])
const expandedDb = ref<string | null>(null)
const dbSessions = ref<Record<string, string>>({}) // database -> sibling session id
const schemasByDb = ref<Record<string, ReadonlyArray<SchemaInfo>>>({})
const expandedSchema = ref<string | null>(null)
const tablesData = ref<Record<string, ReadonlyArray<TableInfo>>>({}) // `${db}.${schema}` -> tables
const error = ref<string | null>(null)
const connectingDb = ref<string | null>(null) // sibling session being opened

onMounted(async () => {
  const r = await useSchema(props.connectionId).databases()
  if (r.ok) databases.value = r.data
  else error.value = r.error.message
})

async function toggleDb(db: string) {
  error.value = null
  expandedSchema.value = null
  expandedDb.value = expandedDb.value === db ? null : db
  if (!expandedDb.value) return

  let sid = dbSessions.value[db]
  if (!sid) {
    connectingDb.value = db
    const r = await openDatabase(props.connectionId, db)
    connectingDb.value = null
    if (!r.ok) {
      error.value = r.error.message
      expandedDb.value = null
      return
    }
    sid = r.data.id
    dbSessions.value = { ...dbSessions.value, [db]: sid }
  }
  const rs = await useSchema(sid).schemas()
  if (rs.ok) schemasByDb.value = { ...schemasByDb.value, [db]: rs.data }
  else error.value = rs.error.message
}

async function toggleSchema(db: string, schema: string) {
  expandedSchema.value = expandedSchema.value === schema ? null : schema
  if (!expandedSchema.value) return
  const sid = dbSessions.value[db]
  if (!sid) return
  // refetch on every expand - tables created since the last look must show up
  const r = await useSchema(sid).tables(schema)
  if (r.ok) tablesData.value = { ...tablesData.value, [`${db}.${schema}`]: r.data }
  else error.value = r.error.message
}
</script>

<template>
  <div class="tree">
    <p v-if="error" role="alert">{{ error }}</p>
    <div v-for="d in databases" :key="d.name">
      <button class="node db" @click="toggleDb(d.name)">
        {{ expandedDb === d.name ? '▼' : '▶' }} <span class="dbname">{{ d.name }}</span>
        <span v-if="connectingDb === d.name" class="connecting">連線中…</span>
      </button>
      <ul v-if="expandedDb === d.name">
        <li v-for="s in schemasByDb[d.name] ?? []" :key="s.name">
          <button class="node" @click="toggleSchema(d.name, s.name)">
            {{ expandedSchema === s.name ? '▼' : '▶' }} {{ s.name }}
          </button>
          <ul v-if="expandedSchema === s.name">
            <li v-for="t in tablesData[`${d.name}.${s.name}`] ?? []" :key="t.name">
              <button class="leaf" @click="emit('select-table', dbSessions[d.name]!, d.name, s.name, t.name)">
                {{ t.name }}
              </button>
            </li>
            <li v-if="tablesData[`${d.name}.${s.name}`]?.length === 0" class="empty">（沒有資料表）</li>
          </ul>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.tree { font-family: var(--font-data); font-size: 13px; }
.tree ul {
  list-style: none;
  margin: 2px 0 6px;
  padding: 0 0 0 14px;
  border-left: 1px solid var(--line);
}
.node, .leaf {
  display: block;
  width: 100%;
  text-align: left;
  background: transparent;
  border: none;
  padding: 4px 6px;
  border-radius: 4px;
  color: var(--text);
}
.node { color: var(--muted); }
.dbname { color: var(--glass); }
.node:hover, .leaf:hover { background: var(--panel-2); border: none; }
.leaf:hover { color: var(--brass); }
.empty { color: var(--muted); padding: 4px 6px; font-style: italic; }
.connecting { color: var(--muted); font-size: 11px; margin-left: 6px; }
</style>
