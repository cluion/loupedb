<script setup lang="ts">
import type {
  QueryResult,
  ScriptExecutionResult,
  ScriptStatementResult,
  SqlExecutionResult,
} from '#shared/types'
import { listSqlStatements, type RunnableSql } from '../utils/sqlStatements'

const props = withDefaults(defineProps<{
  connectionId: string
  modelValue?: string
  result?: SqlExecutionResult | null
  previousResult?: SqlExecutionResult | null
  defaultSchema?: string | null
}>(), {
  modelValue: 'SELECT * FROM ',
  result: null,
  previousResult: null,
  defaultSchema: null,
})
const emit = defineEmits<{
  'update:modelValue': [sql: string]
  'update:result': [result: SqlExecutionResult | null]
  'execution-started': []
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
  readonly script: {
    readonly executed: number
    readonly total: number
    readonly stoppedAt: number | null
  } | null
}

interface SqlCodeEditorHandle {
  formatSql: () => boolean
}

const sql = ref(props.modelValue)
const codeEditor = ref<SqlCodeEditorHandle | null>(null)
const queryOutput = ref<SqlExecutionResult | null>(props.result)
const previousQueryOutput = ref<SqlExecutionResult | null>(props.previousResult)
const resultVersion = ref<'current' | 'previous'>('current')
const activeScriptIndex = ref(0)
const error = ref<string | null>(null)
const formatError = ref<string | null>(null)
const running = ref(false)
const cancelling = ref(false)
const lastExecution = ref<ExecutionSummary | null>(null)
let activeRun: ActiveRun | null = null
// what ⌘⏎ / the run button would execute right now, reported by the editor:
// the selection when one exists, otherwise the statement under the cursor
const runnable = ref<RunnableSql | null>(null)
const statementCount = computed(() => listSqlStatements(sql.value).length)
const visibleOutput = computed<SqlExecutionResult | null>(() => (
  resultVersion.value === 'previous' ? previousQueryOutput.value : queryOutput.value
))
const scriptResult = computed<ScriptExecutionResult | null>(() => {
  const result = visibleOutput.value
  return result && 'kind' in result && result.kind === 'script' ? result : null
})
const activeScriptStatement = computed<ScriptStatementResult | null>(
  () => scriptResult.value?.statements[activeScriptIndex.value] ?? null,
)
const queryResult = computed<QueryResult | null>(() => {
  const result = visibleOutput.value
  if (!result) return null
  if (!('kind' in result)) return result
  const statement = activeScriptStatement.value
  return statement?.status === 'success' ? statement.result : null
})

watch(() => props.modelValue, (value) => {
  if (value !== sql.value) sql.value = value
})
watch(() => props.result, (value) => {
  if (value !== queryOutput.value) {
    queryOutput.value = value
    activeScriptIndex.value = 0
  }
})
watch(() => props.previousResult, (value) => {
  if (value !== previousQueryOutput.value) previousQueryOutput.value = value
})
watch(() => props.connectionId, () => {
  error.value = null
  formatError.value = null
  resultVersion.value = 'current'
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
  emit('executed', {
    sql: run.sql,
    status: summary.status,
    startedAt: summary.startedAt,
    durationMs: summary.durationMs,
    rowCount: summary.rowCount,
    affectedRows: summary.affectedRows,
  })
}

function beginRun(executedSql: string): ActiveRun | null {
  if (activeRun) return null
  error.value = null
  if (queryOutput.value) previousQueryOutput.value = queryOutput.value
  queryOutput.value = null
  resultVersion.value = 'current'
  activeScriptIndex.value = 0
  lastExecution.value = null
  emit('execution-started')
  const runState: ActiveRun = {
    queryId: createQueryId(),
    connectionId: props.connectionId,
    sql: executedSql,
    startedAt: Date.now(),
    cancelRequested: false,
  }
  activeRun = runState
  running.value = true
  return runState
}

function failRun(runState: ActiveRun, message: string, code?: string) {
  const cancelled = runState.cancelRequested && code === '57014'
  if (!cancelled) error.value = message
  finish(runState, {
    status: cancelled ? 'cancelled' : 'error',
    startedAt: runState.startedAt,
    durationMs: elapsedSince(runState.startedAt),
    rowCount: null,
    affectedRows: null,
    script: null,
  })
}

async function run(target: RunnableSql | null = runnable.value) {
  // Mod-Enter can still emit while the button is disabled; never overlap two
  // requests inside one editor instance.
  const executedSql = target?.sql ?? sql.value
  const runState = beginRun(executedSql)
  if (!runState) return
  try {
    const r = await useQuery(runState.connectionId).execute(runState.sql, runState.queryId)
    // A future flow may allow a new request immediately after cancellation.
    // Guard now so a late response can never overwrite the newer result.
    if (activeRun !== runState) return
    if (r.ok) {
      queryOutput.value = r.data
      emit('update:result', r.data)
      const hasResultSet = r.data.columns.length > 0
      finish(runState, {
        status: 'success',
        startedAt: runState.startedAt,
        durationMs: r.data.executionMs,
        rowCount: hasResultSet ? r.data.rowCount ?? r.data.rows.length : null,
        affectedRows: hasResultSet ? null : r.data.affectedRows ?? null,
        script: null,
      })
    } else {
      failRun(runState, r.error.message, r.error.code)
    }
  } catch (err) {
    if (activeRun !== runState) return
    failRun(runState, err instanceof Error ? err.message : String(err))
  }
}

function scriptCounts(result: ScriptExecutionResult): Pick<ExecutionSummary, 'rowCount' | 'affectedRows'> {
  const successes = result.statements.filter((entry) => entry.status === 'success')
  const rowResults = successes.filter((entry) => entry.status === 'success' && entry.result.columns.length > 0)
  if (rowResults.length) {
    return {
      rowCount: rowResults.reduce((total, entry) => total + (entry.status === 'success'
        ? entry.result.rowCount ?? entry.result.rows.length
        : 0), 0),
      affectedRows: null,
    }
  }
  const affected = successes.reduce((total, entry) => total + (entry.status === 'success'
    ? entry.result.affectedRows ?? 0
    : 0), 0)
  return { rowCount: null, affectedRows: successes.length ? affected : null }
}

async function runScript() {
  const runState = beginRun(sql.value)
  if (!runState) return
  try {
    const r = await useQuery(runState.connectionId).executeScript(runState.sql, runState.queryId)
    if (activeRun !== runState) return
    if (!r.ok) {
      failRun(runState, r.error.message, r.error.code)
      return
    }

    queryOutput.value = r.data
    emit('update:result', r.data)
    const stoppedAt = r.data.statements.findIndex((entry) => entry.status !== 'success')
    activeScriptIndex.value = stoppedAt >= 0 ? stoppedAt : 0
    const counts = scriptCounts(r.data)
    finish(runState, {
      status: r.data.status,
      startedAt: runState.startedAt,
      durationMs: r.data.executionMs,
      ...counts,
      script: {
        executed: r.data.statements.length,
        total: r.data.totalStatements,
        stoppedAt: stoppedAt >= 0 ? stoppedAt + 1 : null,
      },
    })
  } catch (err) {
    if (activeRun !== runState) return
    failRun(runState, err instanceof Error ? err.message : String(err))
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

function statementCommand(statement: ScriptStatementResult): string {
  if (statement.status === 'success' && statement.result.command) return statement.result.command
  return statement.sql.match(/^\s*([a-z]+)/i)?.[1]?.toUpperCase() ?? 'SQL'
}

function resultLabel(result: SqlExecutionResult | null): string {
  if (!result) return '無結果'
  if ('kind' in result) return `${result.statements.length} 個結果`
  if (result.columns.length) return `${result.rowCount ?? result.rows.length} 列`
  if (result.affectedRows !== undefined) return `${result.affectedRows} 列受影響`
  return result.command ?? '完成'
}

function showResultVersion(version: 'current' | 'previous') {
  resultVersion.value = version
  activeScriptIndex.value = 0
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
      <button
        v-if="!running && statementCount > 1"
        type="button"
        aria-label="執行完整 Script"
        title="依序執行全部 statement"
        @click="runScript"
      >執行全部</button>
      <button type="button" aria-label="格式化 SQL" title="⇧⌥F / Shift+Alt+F" @click="formatSql">
        格式化
      </button>
      <span v-if="lastExecution" class="meta" data-testid="execution-summary">
        <template v-if="lastExecution.script">
          <template v-if="lastExecution.status === 'success'">
            {{ lastExecution.script.executed }} 個 statement
          </template>
          <template v-else-if="lastExecution.status === 'cancelled'">
            第 {{ lastExecution.script.stoppedAt }} / {{ lastExecution.script.total }} 個已取消
          </template>
          <template v-else>
            第 {{ lastExecution.script.stoppedAt }} / {{ lastExecution.script.total }} 個失敗
          </template>
        </template>
        <template v-else-if="lastExecution.status === 'success'">
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
    <div
      v-if="previousQueryOutput"
      class="result-versions"
      role="tablist"
      aria-label="結果版本"
    >
      <button
        type="button"
        role="tab"
        aria-label="顯示目前結果"
        :aria-selected="resultVersion === 'current'"
        @click="showResultVersion('current')"
      >目前結果 <small>{{ resultLabel(queryOutput) }}</small></button>
      <button
        type="button"
        role="tab"
        aria-label="顯示前次結果"
        :aria-selected="resultVersion === 'previous'"
        @click="showResultVersion('previous')"
      >前次結果 <small>{{ resultLabel(previousQueryOutput) }}</small></button>
    </div>
    <p v-if="formatError" role="alert" data-testid="format-error">{{ formatError }}</p>
    <p v-if="error && resultVersion === 'current'" role="alert">{{ error }}</p>
    <div v-if="scriptResult" class="script-results">
      <div class="result-tabs" role="tablist" aria-label="Script 結果">
        <button
          v-for="(statement, position) in scriptResult.statements"
          :key="statement.index"
          type="button"
          role="tab"
          :aria-selected="position === activeScriptIndex"
          :class="['result-tab', statement.status]"
          :aria-label="`結果 ${statement.index + 1} ${statementCommand(statement)}`"
          @click="activeScriptIndex = position"
        >{{ statement.index + 1 }} {{ statementCommand(statement) }}</button>
      </div>
      <div v-if="activeScriptStatement" class="statement-head">
        <code>{{ activeScriptStatement.sql }}</code>
        <span>{{ Math.round(activeScriptStatement.executionMs) }} ms</span>
      </div>
      <p
        v-if="activeScriptStatement?.status === 'error' || activeScriptStatement?.status === 'cancelled'"
        role="alert"
        data-testid="script-statement-message"
      >{{ activeScriptStatement.status === 'cancelled' ? '已取消：' : '執行失敗：' }}{{ activeScriptStatement.error.message }}</p>
      <p
        v-else-if="queryResult && !queryResult.columns.length"
        class="statement-message"
        data-testid="script-statement-message"
      >{{ queryResult.command ?? '完成' }}・{{ queryResult.affectedRows ?? 0 }} 列受影響</p>
    </div>
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
.result-versions { display: flex; gap: 6px; }
.result-versions button { display: flex; align-items: baseline; gap: 8px; }
.result-versions button[aria-selected="true"] { border-color: var(--brass); color: var(--brass); }
.result-versions small { color: var(--muted); font-family: var(--font-data); }
.script-results { display: flex; flex-direction: column; gap: 8px; }
.result-tabs { display: flex; gap: 6px; overflow-x: auto; }
.result-tab { font-family: var(--font-data); font-size: 12px; white-space: nowrap; }
.result-tab[aria-selected="true"] { border-color: var(--brass); color: var(--brass); }
.result-tab.error, .result-tab.cancelled { border-color: var(--danger); }
.statement-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; color: var(--muted); font-size: 12px; }
.statement-head code { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.statement-message { margin: 0; color: var(--muted); }

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
