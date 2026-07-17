<script setup lang="ts">
import type { QueryResult } from '#shared/types'
import type { RunnableSql } from '../utils/sqlStatements'

const props = withDefaults(defineProps<{
  connectionId: string
  modelValue?: string
  result?: QueryResult | null
  defaultSchema?: string | null
}>(), { modelValue: 'SELECT * FROM ', result: null, defaultSchema: null })
const emit = defineEmits<{
  'update:modelValue': [sql: string]
  'update:result': [result: QueryResult | null]
  executed: [outcome: {
    sql: string
    status: 'success' | 'error' | 'cancelled'
    startedAt: number
    durationMs: number
    rowCount: number | null
    affectedRows: number | null
  }]
}>()

interface ActiveRun {
  readonly queryId: string
  readonly connectionId: string
  readonly sql: string
  readonly startedAt: number
  cancelRequested: boolean
}

interface ExecutionSummary {
  readonly status: 'success' | 'error' | 'cancelled'
  readonly startedAt: number
  readonly durationMs: number
  readonly rowCount: number | null
  readonly affectedRows: number | null
}

interface SqlCodeEditorHandle {
  formatSql: () => boolean
}

const sql = ref(props.modelValue)
const codeEditor = ref<SqlCodeEditorHandle | null>(null)
const queryResult = ref<QueryResult | null>(props.result)
const error = ref<string | null>(null)
const formatError = ref<string | null>(null)
const running = ref(false)
const cancelling = ref(false)
const lastExecution = ref<ExecutionSummary | null>(null)
let activeRun: ActiveRun | null = null
// what ⌘⏎ / the run button would execute right now, reported by the editor:
// the selection when one exists, otherwise the statement under the cursor
const runnable = ref<RunnableSql | null>(null)

watch(() => props.modelValue, (value) => {
  if (value !== sql.value) sql.value = value
})
watch(() => props.result, (value) => { queryResult.value = value })
watch(() => props.connectionId, () => {
  error.value = null
  formatError.value = null
})

// completion metadata for the bound connection - loads lazily, cached per id
const completion = computed(() => useSqlCompletion(props.connectionId))
watch(completion, (c) => { c.ensureLoaded() }, { immediate: true })

function updateSql(value: string) {
  sql.value = value
  formatError.value = null
  emit('update:modelValue', value)
}

function formatSql() {
  codeEditor.value?.formatSql()
}

function onFormatted() {
  formatError.value = null
}

function onFormatError(message: string) {
  formatError.value = `SQL 格式化失敗：${message}`
}

function createQueryId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `query-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function elapsedSince(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt)
}

function finish(run: ActiveRun, summary: ExecutionSummary): void {
  if (activeRun !== run) return
  lastExecution.value = summary
  activeRun = null
  running.value = false
  cancelling.value = false
  emit('executed', { sql: run.sql, ...summary })
}

async function run(target: RunnableSql | null = runnable.value) {
  // Mod-Enter can still emit while the button is disabled; never overlap two
  // requests inside one editor instance.
  if (activeRun) return
  error.value = null
  queryResult.value = null
  lastExecution.value = null
  emit('update:result', null)
  const executedSql = target?.sql ?? sql.value
  const runState: ActiveRun = {
    queryId: createQueryId(),
    connectionId: props.connectionId,
    sql: executedSql,
    startedAt: Date.now(),
    cancelRequested: false,
  }
  activeRun = runState
  running.value = true
  try {
    const r = await useQuery(runState.connectionId).execute(runState.sql, runState.queryId)
    // A future flow may allow a new request immediately after cancellation.
    // Guard now so a late response can never overwrite the newer result.
    if (activeRun !== runState) return
    if (r.ok) {
      queryResult.value = r.data
      emit('update:result', r.data)
      const hasResultSet = r.data.columns.length > 0
      finish(runState, {
        status: 'success',
        startedAt: runState.startedAt,
        durationMs: r.data.executionMs,
        rowCount: hasResultSet ? r.data.rowCount ?? r.data.rows.length : null,
        affectedRows: hasResultSet ? null : r.data.affectedRows ?? null,
      })
    } else {
      const cancelled = runState.cancelRequested && r.error.code === '57014'
      if (!cancelled) error.value = r.error.message
      finish(runState, {
        status: cancelled ? 'cancelled' : 'error',
        startedAt: runState.startedAt,
        durationMs: elapsedSince(runState.startedAt),
        rowCount: null,
        affectedRows: null,
      })
    }
  } catch (err) {
    if (activeRun !== runState) return
    error.value = err instanceof Error ? err.message : String(err)
    finish(runState, {
      status: 'error',
      startedAt: runState.startedAt,
      durationMs: elapsedSince(runState.startedAt),
      rowCount: null,
      affectedRows: null,
    })
  }
}

async function stop() {
  const runState = activeRun
  if (!runState || cancelling.value) return
  runState.cancelRequested = true
  cancelling.value = true
  try {
    const r = await useQuery(runState.connectionId).cancel(runState.queryId)
    if (activeRun !== runState) return
    if (!r.ok) {
      runState.cancelRequested = false
      cancelling.value = false
      error.value = `取消失敗：${r.error.message}`
    }
    // On success the query request resolves with PG code 57014. Keep the UI in
    // "cancelling" until that response arrives so another run cannot overlap.
  } catch (err) {
    if (activeRun !== runState) return
    runState.cancelRequested = false
    cancelling.value = false
    error.value = `取消失敗：${err instanceof Error ? err.message : String(err)}`
  }
}

function startTime(at: number): string {
  return new Date(at).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}
</script>

<template>
  <div class="editor">
    <SqlCodeEditor
      ref="codeEditor"
      :model-value="sql"
      :schema="completion.namespace.value"
      :default-schema="defaultSchema ?? 'public'"
      @update:model-value="updateSql"
      @update:runnable="runnable = $event"
      @run="run($event)"
      @formatted="onFormatted"
      @format-error="onFormatError"
    />
    <div class="actions">
      <button v-if="!running" class="primary" title="⌘⏎ / Ctrl+Enter" @click="run()">
        {{ runnable?.source === 'selection' ? '執行選取' : '執行' }}
      </button>
      <button v-else class="stop" :disabled="cancelling" aria-label="停止查詢" @click="stop">
        {{ cancelling ? '取消中…' : '停止' }}
      </button>
      <button type="button" aria-label="格式化 SQL" title="⇧⌥F / Shift+Alt+F" @click="formatSql">
        格式化
      </button>
      <span v-if="lastExecution" class="meta" data-testid="execution-summary">
        <template v-if="lastExecution.status === 'success'">
          <template v-if="lastExecution.rowCount !== null">{{ lastExecution.rowCount }} 列</template>
          <template v-else-if="lastExecution.affectedRows !== null">{{ lastExecution.affectedRows }} 列受影響</template>
          <template v-else>完成</template>
        </template>
        <template v-else-if="lastExecution.status === 'cancelled'">已取消</template>
        <template v-else>失敗</template>
        ・{{ startTime(lastExecution.startedAt) }} 開始・{{ Math.round(lastExecution.durationMs) }} ms
      </span>
      <span v-else-if="queryResult" class="meta">
        {{ queryResult.rows.length }} 列・{{ Math.round(queryResult.executionMs) }} ms
      </span>
      <ResultExport v-if="queryResult && queryResult.columns.length" :result="queryResult" />
    </div>
    <p v-if="formatError" role="alert" data-testid="format-error">{{ formatError }}</p>
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
.stop { border-color: var(--danger); color: var(--danger); }
.stop:hover { border-color: var(--danger); background: rgba(224, 108, 94, 0.1); }

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
