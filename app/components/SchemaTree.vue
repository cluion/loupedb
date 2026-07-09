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
  if (expanded.value && !tablesData.value[schema]) {
    const r = await tables(schema)
    if (r.ok) tablesData.value = { ...tablesData.value, [schema]: r.data }
    else error.value = r.error.message
  }
}
</script>

<template>
  <div>
    <!-- [DESIGN] 樹狀樣式由使用者設計 -->
    <p v-if="error" role="alert">{{ error }}</p>
    <div v-for="s in schemasData" :key="s.name">
      <button @click="toggle(s.name)">{{ expanded === s.name ? '▼' : '▶' }} {{ s.name }}</button>
      <ul v-if="expanded === s.name">
        <li v-for="t in tablesData[s.name] ?? []" :key="t.name">
          <button @click="emit('select-table', s.name, t.name)">{{ t.name }}</button>
        </li>
      </ul>
    </div>
  </div>
</template>
