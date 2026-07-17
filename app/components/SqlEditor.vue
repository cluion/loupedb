<script setup lang="ts">
import type {
  QueryMessage,
  QueryResult,
  ScriptExecutionResult,
  ScriptStatementResult,
  SqlExecutionResult,
} from '#shared/types'
import { listSqlParameterPositions } from '#shared/sqlParameters'
import { listSqlStatements, type RunnableSql } from '../utils/sqlStatements'

const MAX_QUERY_PARAMETER_POSITION = 65535

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

interface QueryParameterInput {
  readonly position: number
  value: string
  isNull: boolean
}

interface QueryParameterDialog {
  readonly sql: string
  readonly inputs: QueryParameterInput[]
}

const sql = ref(props.modelValue)
const codeEditor = ref<SqlCodeEditorHandle | null>(null)
const queryOutput = ref<SqlExecutionResult | null>(props.result)
const previousQueryOutput = ref<SqlExecutionResult | null>(props.previousResult)
const resultVersion = ref<'current' | 'previous'>('current')
const activeScriptIndex = ref(0)
const error = ref<string | null>(null)
const failedMessages = ref<ReadonlyArray<QueryMessage>>([])
const formatError = ref<string | null>(null)
const parameterDialog = ref<QueryParameterDialog | null>(null)
const running = ref(false)
const cancelling = ref(false)
const lastExecution = ref<ExecutionSummary | null>(null)
let activeRun: ActiveRun | null = null
let lastParameterizedRun: {
  readonly sql: string
  readonly values: ReadonlyMap<number, Pick<QueryParameterInput, 'value' | 'isNull'>>
} | null = null
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
const visibleMessages = computed<ReadonlyArray<QueryMessage>>(() => {
  if (!visibleOutput.value) {
    return resultVersion.value === 'current' ? failedMessages.value : []
  }
  if (!scriptResult.value) return queryResult.value?.messages ?? []
  const statement = activeScriptStatement.value
  if (!statement) return []
  return statement.status === 'success' ? statement.result.messages ?? [] : statement.error.messages ?? []
})

watch(() => props.modelValue, (value) => {
  if (value !== sql.value) sql.value = value
})
watch(() => props.result, (value) => {
  if (value !== queryOutput.value) {
    queryOutput.value = value
    activeScriptIndex.value = 0
    if (value) failedMessages.value = []
  }
})
watch(() => props.previousResult, (value) => {
  if (value !== previousQueryOutput.value) previousQueryOutput.value = value
})
watch(() => props.connectionId, () => {
  error.value = null
  failedMessages.value = []
  formatError.value = null
  parameterDialog.value = null
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
  failedMessages.value = []
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

function failRun(
  runState: ActiveRun,
  message: string,
  code?: string,
  messages: ReadonlyArray<QueryMessage> = [],
) {
  const cancelled = runState.cancelRequested && code === '57014'
  if (!cancelled) error.value = message
  failedMessages.value = messages
  finish(runState, {
    status: cancelled ? 'cancelled' : 'error',
    startedAt: runState.startedAt,
    durationMs: elapsedSince(runState.startedAt),
    rowCount: null,
    affectedRows: null,
    script: null,
  })
}

function run(target: RunnableSql | null = runnable.value) {
  // Mod-Enter can still emit while the button is disabled; never overlap two
  // requests inside one editor instance.
  const executedSql = target?.sql ?? sql.value
  if (activeRun) return
  const positions = listSqlParameterPositions(executedSql)
  const maxPosition = positions.at(-1) ?? 0
  if (maxPosition > MAX_QUERY_PARAMETER_POSITION) {
    error.value = `參數 $${maxPosition} 超過 PostgreSQL 上限 $${MAX_QUERY_PARAMETER_POSITION}`
    return
  }
  if (positions.length) {
    const remembered = lastParameterizedRun?.sql === executedSql ? lastParameterizedRun.values : null
    parameterDialog.value = {
      sql: executedSql,
      inputs: positions.map((position) => ({
        position,
        value: remembered?.get(position)?.value ?? '',
        isNull: remembered?.get(position)?.isNull ?? false,
      })),
    }
    return
  }
  return executeRun(executedSql, [])
}

async function submitParameters() {
  const dialog = parameterDialog.value
  if (!dialog) return
  const maxPosition = dialog.inputs.at(-1)?.position ?? 0
  const params: unknown[] = Array.from({ length: maxPosition }, () => null)
  const remembered = new Map<number, Pick<QueryParameterInput, 'value' | 'isNull'>>()
  for (const input of dialog.inputs) {
    params[input.position - 1] = input.isNull ? null : input.value
    remembered.set(input.position, { value: input.value, isNull: input.isNull })
  }
  lastParameterizedRun = { sql: dialog.sql, values: remembered }
  parameterDialog.value = null
  await executeRun(dialog.sql, params)
}

function cancelParameters() {
  parameterDialog.value = null
}

async function executeRun(executedSql: string, params: ReadonlyArray<unknown>) {
  const runState = beginRun(executedSql)
  if (!runState) return
  try {
    const r = await useQuery(runState.connectionId).execute(runState.sql, params, runState.queryId)
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
      failRun(runState, r.error.message, r.error.code, r.error.messages)
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
  if (listSqlParameterPositions(sql.value).length) {
    error.value = '完整 Script 暫不支援參數；請執行選取範圍或游標所在 statement'
    return
  }
  const runState = beginRun(sql.value)
  if (!runState) return
  try {
    const r = await useQuery(runState.connectionId).executeScript(runState.sql, runState.queryId)
    if (activeRun !== runState) return
    if (!r.ok) {
      failRun(runState, r.error.message, r.error.code, r.error.messages)
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
    <div
      v-if="parameterDialog"
      class="parameter-backdrop"
      @click.self="cancelParameters"
    >
      <form
        class="parameter-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="查詢參數"
        @submit.prevent="submitParameters"
        @keydown.esc.prevent="cancelParameters"
      >
        <div class="parameter-head">
          <div>
            <strong>查詢參數</strong>
            <p>值以文字傳送；需要特定型別時請在 SQL 中加上 cast</p>
          </div>
          <button type="button" class="close" aria-label="關閉查詢參數" @click="cancelParameters">×</button>
        </div>
        <label v-for="(input, index) in parameterDialog.inputs" :key="input.position" class="parameter-row">
          <code>${{ input.position }}</code>
          <input
            v-model="input.value"
            type="text"
            :aria-label="`參數 $${input.position}`"
            :disabled="input.isNull"
            :autofocus="index === 0"
            autocomplete="off"
          >
          <span class="null-toggle">
            <input
              v-model="input.isNull"
              type="checkbox"
              :aria-label="`參數 $${input.position} 使用 NULL`"
            > NULL
          </span>
        </label>
        <div class="parameter-actions">
          <button type="button" @click="cancelParameters">取消</button>
          <button type="submit" class="primary">使用參數執行</button>
        </div>
      </form>
    </div>
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
    <details v-if="visibleMessages.length" open class="query-messages" data-testid="query-messages">
      <summary>訊息・{{ visibleMessages.length }}</summary>
      <ul>
        <li v-for="(message, index) in visibleMessages" :key="`${message.code ?? ''}-${index}`">
          <span :class="['message-severity', message.severity]">{{ message.severity.toUpperCase() }}</span>
          <code v-if="message.code">{{ message.code }}</code>
          <span>{{ message.message }}</span>
          <small v-if="message.detail">詳細：{{ message.detail }}</small>
          <small v-if="message.hint">提示：{{ message.hint }}</small>
          <small v-if="message.context">{{ message.context }}</small>
        </li>
      </ul>
    </details>
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
.parameter-backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(10, 14, 18, 0.72);
}
.parameter-dialog {
  display: grid;
  gap: 14px;
  width: min(560px, 100%);
  max-height: min(680px, calc(100vh - 40px));
  overflow-y: auto;
  padding: 18px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--panel);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
}
.parameter-head, .parameter-actions, .parameter-row { display: flex; align-items: center; gap: 10px; }
.parameter-head { justify-content: space-between; }
.parameter-head p { margin: 4px 0 0; color: var(--muted); font-size: 12px; }
.parameter-row > code { width: 36px; color: var(--brass); }
.parameter-row > input[type="text"] { min-width: 0; flex: 1; }
.null-toggle { display: flex; align-items: center; gap: 5px; color: var(--muted); font-size: 12px; }
.parameter-actions { justify-content: flex-end; }
.actions { display: flex; align-items: center; gap: 12px; }
.meta { font-family: var(--font-data); font-size: 12px; color: var(--muted); }
.stop { border-color: var(--danger); color: var(--danger); }
.stop:hover { border-color: var(--danger); background: rgba(224, 108, 94, 0.1); }
.result-versions { display: flex; gap: 6px; }
.result-versions button { display: flex; align-items: baseline; gap: 8px; }
.result-versions button[aria-selected="true"] { border-color: var(--brass); color: var(--brass); }
.result-versions small { color: var(--muted); font-family: var(--font-data); }
.query-messages { border: 1px solid var(--line); border-radius: var(--radius); }
.query-messages summary { cursor: pointer; padding: 8px 12px; color: var(--muted); font-size: 12px; }
.query-messages ul { display: grid; gap: 8px; margin: 0; padding: 0 12px 10px; list-style: none; }
.query-messages li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; font-size: 12px; }
.query-messages li > small { flex-basis: 100%; color: var(--muted); padding-left: 62px; }
.message-severity { min-width: 56px; font-family: var(--font-data); color: var(--muted); }
.message-severity.warning { color: var(--brass); }
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
