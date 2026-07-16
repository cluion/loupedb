<script setup lang="ts">
import type { QueryResult } from '#shared/types'
import type { RunnableSql } from '../utils/sqlStatements'

const props = withDefaults(defineProps<{
  connectionId: string
  modelValue?: string
  result?: QueryResult | null
}>(), { modelValue: 'SELECT * FROM ', result: null })
const emit = defineEmits<{
  'update:modelValue': [sql: string]
  'update:result': [result: QueryResult | null]
  executed: [outcome: {
    sql: string
    ok: boolean
    durationMs: number | null
    rowCount: number | null
  }]
}>()

const sql = ref(props.modelValue)
const queryResult = ref<QueryResult | null>(props.result)
const error = ref<string | null>(null)
const running = ref(false)
// what ⌘⏎ / the run button would execute right now, reported by the editor:
// the selection when one exists, otherwise the statement under the cursor
const runnable = ref<RunnableSql | null>(null)

watch(() => props.modelValue, (value) => {
  if (value !== sql.value) sql.value = value
})
watch(() => props.result, (value) => { queryResult.value = value })
watch(() => props.connectionId, () => { error.value = null })

function updateSql(value: string) {
  sql.value = value
  emit('update:modelValue', value)
}

async function run(target: RunnableSql | null = runnable.value) {
  error.value = null
  queryResult.value = null
  emit('update:result', null)
  running.value = true
  // Resolve from the latest prop: rebinding a tab to another database must not
  // leave a closure executing against the previous connection id.
  const executedSql = target?.sql ?? sql.value
  const r = await useQuery(props.connectionId).execute(executedSql)
  running.value = false
  if (r.ok) {
    queryResult.value = r.data
    emit('update:result', r.data)
    emit('executed', {
      sql: executedSql, ok: true, durationMs: r.data.executionMs, rowCount: r.data.rows.length,
    })
  } else {
    error.value = r.error.message
    emit('executed', { sql: executedSql, ok: false, durationMs: null, rowCount: null })
  }
}
</script>

<template>
  <div class="editor">
    <SqlCodeEditor
      :model-value="sql"
      @update:model-value="updateSql"
      @update:runnable="runnable = $event"
      @run="run($event)"
    />
    <div class="actions">
      <button class="primary" :disabled="running" title="⌘⏎ / Ctrl+Enter" @click="run()">
        {{ running ? '執行中…' : runnable?.source === 'selection' ? '執行選取' : '執行' }}
      </button>
      <span v-if="queryResult" class="meta">
        {{ queryResult.rows.length }} 列・{{ Math.round(queryResult.executionMs) }} ms
      </span>
      <ResultExport v-if="queryResult && queryResult.columns.length" :result="queryResult" />
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
    <div v-if="queryResult && queryResult.columns.length" class="scroll">
      <table>
        <thead>
          <tr><th v-for="c in queryResult.columns" :key="c.name">{{ c.name }}</th></tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in queryResult.rows" :key="i">
            <td v-for="c in queryResult.columns" :key="c.name" :class="{ isnull: row[c.name] === null }">
              {{ row[c.name] === null ? 'NULL' : row[c.name] }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.editor { display: flex; flex-direction: column; gap: 10px; }
.actions { display: flex; align-items: center; gap: 12px; }
.meta { font-family: var(--font-data); font-size: 12px; color: var(--muted); }

.scroll { overflow-x: auto; border: 1px solid var(--line); border-radius: var(--radius); }
table {
  border-collapse: collapse;
  width: 100%;
  font-family: var(--font-data);
  font-size: 13px;
}
th, td {
  text-align: left;
  padding: 6px 12px;
  border-bottom: 1px solid var(--line);
  white-space: nowrap;
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
}
th { background: var(--panel-2); color: var(--glass); font-weight: 500; }
tbody tr:hover { background: var(--brass-soft); }
tbody tr:last-child td { border-bottom: none; }
.isnull { color: var(--muted); font-style: italic; }
</style>
