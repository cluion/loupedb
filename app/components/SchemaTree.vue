<script setup lang="ts">
import type { SchemaInfo, TableInfo } from '#shared/types'

const props = defineProps<{ connectionId: string }>()
const emit = defineEmits<{ 'select-table': [schema: string, table: string] }>()
const { schemas, tables } = useSchema(props.connectionId)

const expanded = ref<string | null>(null)
const schemasData = ref<ReadonlyArray<SchemaInfo>>([])
const tablesData = ref<Record<string, ReadonlyArray<TableInfo>>>({})
const error = ref<string | null>(null)

onMounted(async () => {
  const r = await schemas()
  if (r.ok) schemasData.value = r.data
  else error.value = r.error.message
})

async function toggle(schema: string) {
  expanded.value = expanded.value === schema ? null : schema
  // refetch on every expand - tables created since the last look must show up
  if (expanded.value) {
    const r = await tables(schema)
    if (r.ok) tablesData.value = { ...tablesData.value, [schema]: r.data }
    else error.value = r.error.message
  }
}
</script>

<template>
  <div class="tree">
    <p v-if="error" role="alert">{{ error }}</p>
    <div v-for="s in schemasData" :key="s.name">
      <button class="node" @click="toggle(s.name)">{{ expanded === s.name ? '▼' : '▶' }} {{ s.name }}</button>
      <ul v-if="expanded === s.name">
        <li v-for="t in tablesData[s.name] ?? []" :key="t.name">
          <button class="leaf" @click="emit('select-table', s.name, t.name)">{{ t.name }}</button>
        </li>
        <li v-if="tablesData[s.name]?.length === 0" class="empty">（沒有資料表）</li>
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
.node:hover, .leaf:hover { background: var(--panel-2); border: none; }
.leaf:hover { color: var(--brass); }
.empty { color: var(--muted); padding: 4px 6px; font-style: italic; }
</style>
