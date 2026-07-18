<script setup lang="ts">
import type { BrowseOpts, CellUpdateInput, ColumnInfo, NormalizedType, QueryResult, RowDeleteInput, RowInsertInput, TableSchema } from '#shared/types'

const props = defineProps<{ connectionId: string; schema: string; table: string }>()
const { browse, deleteRow, insertRow, updateCell } = useQuery(props.connectionId)
const { describe } = useSchema(props.connectionId)

const INLINE_EDIT_TYPES: ReadonlySet<NormalizedType> = new Set([
  'integer', 'decimal', 'string', 'boolean', 'datetime', 'date', 'time', 'uuid', 'enum',
])

const result = ref<QueryResult | null>(null)
const tableInfo = ref<TableSchema | null>(null)
const error = ref<string | null>(null)
const metadataError = ref<string | null>(null)
const writeError = ref<string | null>(null)
const notice = ref<string | null>(null)
const loading = ref(false)
const saving = ref(false)
const limit = ref(50)
const offset = ref(0)
const orderBy = ref<string | undefined>(undefined)
const orderDir = ref<'asc' | 'desc'>('asc')
// minimal single-condition filter - multi-condition is a future extension
const filterColumn = ref('')
const filterOp = ref<'=' | '!=' | '>' | '<' | 'like'>('=')
const filterValue = ref('')

interface CellEditorState {
  readonly rowIndex: number
  readonly column: string
  readonly originalValue: unknown
  readonly identity: Readonly<Record<string, unknown>>
  value: string
  useNull: boolean
}

interface PendingCellUpdate extends CellUpdateInput {
  readonly rowIndex: number
  readonly sql: string
  readonly params: ReadonlyArray<unknown>
}

type InsertFieldMode = 'default' | 'value' | 'null'

interface InsertField {
  readonly column: ColumnInfo
  mode: InsertFieldMode
  value: string
}

interface InsertDraft {
  readonly kind: 'insert' | 'clone'
  readonly fields: InsertField[]
}

interface PendingRowInsert extends RowInsertInput {
  readonly sql: string
  readonly params: ReadonlyArray<unknown>
}

interface PendingRowDelete extends RowDeleteInput {
  readonly sql: string
  readonly params: ReadonlyArray<unknown>
}

const editor = ref<CellEditorState | null>(null)
const pendingUpdate = ref<PendingCellUpdate | null>(null)
const insertDraft = ref<InsertDraft | null>(null)
const pendingInsert = ref<PendingRowInsert | null>(null)
const pendingDelete = ref<PendingRowDelete | null>(null)

// no total count in mvp (spec section 6): a short page means the last page
const isLastPage = computed(() => (result.value?.rows.length ?? 0) < limit.value)

async function load() {
  error.value = null
  loading.value = true
  const filter: BrowseOpts['filter'] = filterColumn.value
    ? [{ column: filterColumn.value, op: filterOp.value, value: filterValue.value }]
    : undefined
  try {
    const r = await browse(props.schema, props.table, {
      limit: limit.value, offset: offset.value,
      orderBy: orderBy.value, orderDir: orderDir.value, filter,
    })
    if (r.ok) result.value = r.data
    else error.value = r.error.message
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    loading.value = false
  }
}

async function loadTableInfo() {
  metadataError.value = null
  try {
    const response = await describe(props.schema, props.table)
    if (response.ok) tableInfo.value = response.data
    else metadataError.value = response.error.message
  } catch (cause) {
    metadataError.value = cause instanceof Error ? cause.message : String(cause)
  }
}

watch(() => [props.schema, props.table], () => {
  offset.value = 0
  result.value = null
  tableInfo.value = null
  editor.value = null
  pendingUpdate.value = null
  insertDraft.value = null
  pendingInsert.value = null
  pendingDelete.value = null
  notice.value = null
  load()
  loadTableInfo()
}, { immediate: true })

function sort(col: string) {
  if (orderBy.value === col) orderDir.value = orderDir.value === 'asc' ? 'desc' : 'asc'
  else { orderBy.value = col; orderDir.value = 'asc' }
  load()
}

function applyFilter() {
  offset.value = 0
  load()
}

function prevPage() {
  offset.value = Math.max(0, offset.value - limit.value)
  load()
}

function nextPage() {
  offset.value = offset.value + limit.value
  load()
}

function closeWritePanels() {
  editor.value = null
  pendingUpdate.value = null
  insertDraft.value = null
  pendingInsert.value = null
  pendingDelete.value = null
  writeError.value = null
}

function isScalar(value: unknown): boolean {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value)
}

function identityFor(row: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return Object.fromEntries((tableInfo.value?.primaryKey ?? []).map((key) => [key, row[key]]))
}

function canEditCell(column: ColumnInfo, row: Readonly<Record<string, unknown>>): boolean {
  const primaryKey = tableInfo.value?.primaryKey ?? []
  const schemaColumn = tableInfo.value?.columns.find((candidate) => candidate.name === column.name)
  return primaryKey.length > 0
    && !primaryKey.includes(column.name)
    && schemaColumn?.editable !== false
    && INLINE_EDIT_TYPES.has(column.type)
    && primaryKey.every((key) => isScalar(row[key]))
}

function displayValue(value: unknown): string {
  if (value === null) return 'NULL'
  if (typeof value === 'object') return JSON.stringify(value) ?? String(value)
  return String(value)
}

function beginEdit(row: Readonly<Record<string, unknown>>, rowIndex: number, column: ColumnInfo) {
  if (!canEditCell(column, row) || saving.value) return
  closeWritePanels()
  const originalValue = row[column.name]
  editor.value = {
    rowIndex,
    column: column.name,
    originalValue,
    identity: identityFor(row),
    value: originalValue === null ? '' : displayValue(originalValue),
    useNull: originalValue === null,
  }
  notice.value = null
}

function cancelEdit() {
  closeWritePanels()
}

function quotePreviewIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

function prepareUpdate() {
  if (!editor.value) return
  const value = editor.value.useNull ? null : editor.value.value
  const identityEntries = Object.entries(editor.value.identity)
  const params = [value, ...identityEntries.map(([, identity]) => identity), editor.value.originalValue]
  const conditions = identityEntries.map(([column], index) =>
    `${quotePreviewIdentifier(column)} IS NOT DISTINCT FROM $${index + 2}`)
  conditions.push(`${quotePreviewIdentifier(editor.value.column)} IS NOT DISTINCT FROM $${params.length}`)
  const sql = `UPDATE ${quotePreviewIdentifier(props.schema)}.${quotePreviewIdentifier(props.table)}\n`
    + `SET ${quotePreviewIdentifier(editor.value.column)} = $1\n`
    + `WHERE ${conditions.join('\n  AND ')};`
  pendingUpdate.value = {
    schema: props.schema,
    table: props.table,
    column: editor.value.column,
    value,
    originalValue: editor.value.originalValue,
    identity: editor.value.identity,
    rowIndex: editor.value.rowIndex,
    sql,
    params,
  }
}

function parameterLabel(value: unknown): string {
  if (value === null) return 'NULL'
  return typeof value === 'string' ? JSON.stringify(value) : String(value)
}

async function confirmUpdate() {
  if (!pendingUpdate.value || saving.value) return
  saving.value = true
  writeError.value = null
  const input = pendingUpdate.value
  try {
    const response = await updateCell({
      schema: input.schema,
      table: input.table,
      column: input.column,
      value: input.value,
      originalValue: input.originalValue,
      identity: input.identity,
    })
    if (!response.ok) {
      writeError.value = response.error.message
      return
    }
    closeWritePanels()
    notice.value = '已更新 1 列'
    await load()
  } catch (cause) {
    writeError.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    saving.value = false
  }
}

function startInsert(source?: Readonly<Record<string, unknown>>) {
  if (!tableInfo.value || saving.value) return
  closeWritePanels()
  notice.value = null
  const primaryKey = tableInfo.value.primaryKey
  const fields = tableInfo.value.columns
    .filter((column) => column.insertable !== false && INLINE_EDIT_TYPES.has(column.type))
    .map((column): InsertField => {
      if (!source) {
        return {
          column,
          mode: column.defaultValue !== undefined || column.nullable ? 'default' : 'value',
          value: '',
        }
      }
      if (primaryKey.includes(column.name)) {
        return {
          column,
          mode: column.defaultValue !== undefined ? 'default' : 'value',
          value: '',
        }
      }
      const sourceValue = source[column.name]
      return {
        column,
        mode: sourceValue === null ? 'null' : 'value',
        value: sourceValue === null ? '' : displayValue(sourceValue),
      }
    })
  insertDraft.value = { kind: source ? 'clone' : 'insert', fields }
}

function prepareInsert() {
  if (!insertDraft.value) return
  const values: Record<string, unknown> = {}
  for (const field of insertDraft.value.fields) {
    if (field.mode === 'value') values[field.column.name] = field.value
    else if (field.mode === 'null') values[field.column.name] = null
  }
  const entries = Object.entries(values)
  const params = entries.map(([, value]) => value)
  const sql = entries.length
    ? `INSERT INTO ${quotePreviewIdentifier(props.schema)}.${quotePreviewIdentifier(props.table)}`
      + ` (${entries.map(([name]) => quotePreviewIdentifier(name)).join(', ')})\n`
      + `VALUES (${params.map((_, index) => `$${index + 1}`).join(', ')})\nRETURNING *;`
    : `INSERT INTO ${quotePreviewIdentifier(props.schema)}.${quotePreviewIdentifier(props.table)}\nDEFAULT VALUES\nRETURNING *;`
  pendingInsert.value = {
    schema: props.schema,
    table: props.table,
    values,
    sql,
    params,
  }
}

async function confirmInsert() {
  if (!pendingInsert.value || saving.value) return
  saving.value = true
  writeError.value = null
  const input = pendingInsert.value
  try {
    const response = await insertRow({
      schema: input.schema, table: input.table, values: input.values,
    })
    if (!response.ok) {
      writeError.value = response.error.message
      return
    }
    closeWritePanels()
    notice.value = '已新增 1 列'
    await load()
  } catch (cause) {
    writeError.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    saving.value = false
  }
}

function canDeleteRow(row: Readonly<Record<string, unknown>>, rowIndex: number): boolean {
  const primaryKey = tableInfo.value?.primaryKey ?? []
  const version = result.value?.rowVersions?.[rowIndex]
  return primaryKey.length > 0
    && primaryKey.every((key) => isScalar(row[key]))
    && typeof version === 'string'
    && /^\d+$/u.test(version)
}

function prepareDelete(row: Readonly<Record<string, unknown>>, rowIndex: number) {
  if (!canDeleteRow(row, rowIndex) || saving.value) return
  closeWritePanels()
  notice.value = null
  const identity = identityFor(row)
  const identityEntries = Object.entries(identity)
  const version = result.value!.rowVersions![rowIndex]!
  const params = [...identityEntries.map(([, value]) => value), version]
  const conditions = identityEntries.map(([column], index) =>
    `${quotePreviewIdentifier(column)} IS NOT DISTINCT FROM $${index + 1}`)
  conditions.push(`xmin::text = $${params.length}`)
  pendingDelete.value = {
    schema: props.schema,
    table: props.table,
    identity,
    version,
    sql: `DELETE FROM ${quotePreviewIdentifier(props.schema)}.${quotePreviewIdentifier(props.table)}\n`
      + `WHERE ${conditions.join('\n  AND ')}\nRETURNING *;`,
    params,
  }
}

async function confirmDelete() {
  if (!pendingDelete.value || saving.value) return
  saving.value = true
  writeError.value = null
  const input = pendingDelete.value
  try {
    const response = await deleteRow({
      schema: input.schema, table: input.table, identity: input.identity, version: input.version,
    })
    if (!response.ok) {
      writeError.value = response.error.message
      return
    }
    closeWritePanels()
    notice.value = '已刪除 1 列'
    await load()
  } catch (cause) {
    writeError.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="grid">
    <div v-if="error" role="alert">{{ error }}</div>
    <div v-if="metadataError" role="alert">{{ metadataError }}</div>
    <p v-if="tableInfo" class="editability" data-testid="editability-status">
      <template v-if="tableInfo.primaryKey.length">可編輯：雙擊非主鍵的純量欄位</template>
      <template v-else>無 primary key：可新增或 Clone，但既有資料唯讀且不可刪除</template>
    </p>
    <p v-if="notice" class="notice" role="status">{{ notice }}</p>
    <p v-if="writeError" class="write-error" role="alert">{{ writeError }}</p>
    <form class="toolbar" @submit.prevent="applyFilter">
      <select v-model="filterColumn" aria-label="filter column">
        <option value="">(不篩選)</option>
        <option v-for="c in result?.columns ?? []" :key="c.name" :value="c.name">{{ c.name }}</option>
      </select>
      <select v-model="filterOp" aria-label="filter op">
        <option>=</option>
        <option>!=</option>
        <option>&gt;</option>
        <option>&lt;</option>
        <option>like</option>
      </select>
      <input v-model="filterValue" placeholder="值">
      <button type="submit">套用</button>
      <button type="button" :disabled="!tableInfo || saving" @click="startInsert()">新增資料列</button>
    </form>
    <div v-if="loading && !result" class="loading">載入中…</div>
    <div class="scroll">
      <table v-if="result">
        <thead>
          <tr>
            <th
              v-for="c in result.columns" :key="c.name"
              :class="{ sorted: orderBy === c.name }"
              @click="sort(c.name)"
            >
              {{ c.name }}<span v-if="orderBy === c.name" class="dir">{{ orderDir === 'asc' ? ' ↑' : ' ↓' }}</span>
            </th>
            <th class="row-actions-head">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in result.rows" :key="i">
            <td
              v-for="c in result.columns"
              :key="c.name"
              :class="{
                isnull: row[c.name] === null,
                editable: canEditCell(c, row),
                editing: editor?.rowIndex === i && editor.column === c.name,
              }"
              :tabindex="canEditCell(c, row) ? 0 : undefined"
              :title="canEditCell(c, row) ? '雙擊或按 Enter 編輯' : undefined"
              @dblclick="beginEdit(row, i, c)"
              @keydown.enter.prevent="beginEdit(row, i, c)"
            >
              <div
                v-if="editor?.rowIndex === i && editor.column === c.name"
                class="cell-editor"
                @click.stop
              >
                <input
                  v-model="editor.value"
                  :aria-label="`編輯 ${c.name} 第 ${offset + i + 1} 列`"
                  :disabled="editor.useNull || Boolean(pendingUpdate)"
                  autofocus
                  @keydown.esc="cancelEdit"
                >
                <label>
                  <input v-model="editor.useNull" type="checkbox" :disabled="Boolean(pendingUpdate)">
                  NULL
                </label>
                <button type="button" :disabled="Boolean(pendingUpdate)" @click="prepareUpdate">預覽寫入</button>
                <button type="button" class="ghost" @click="cancelEdit">取消</button>
              </div>
              <template v-else>{{ displayValue(row[c.name]) }}</template>
            </td>
            <td class="row-actions">
              <button type="button" class="ghost" :aria-label="`Clone 第 ${offset + i + 1} 列`" @click="startInsert(row)">
                Clone
              </button>
              <button
                type="button"
                class="ghost delete-row"
                :aria-label="`刪除第 ${offset + i + 1} 列`"
                :disabled="!canDeleteRow(row, i)"
                @click="prepareDelete(row, i)"
              >刪除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <section
      v-if="insertDraft && !pendingInsert"
      class="row-insert"
      role="dialog"
      :aria-label="insertDraft.kind === 'clone' ? 'Clone 資料列' : '新增資料列'"
    >
      <strong>{{ insertDraft.kind === 'clone' ? 'Clone 資料列' : '新增資料列' }}</strong>
      <p>DEFAULT 欄位不會送出值；generated、identity 與複雜型別欄位不在此表單中寫入。</p>
      <div class="insert-fields">
        <label v-for="field in insertDraft.fields" :key="field.column.name" class="insert-field">
          <span>
            {{ field.column.name }}
            <small>{{ field.column.nativeType }}<template v-if="!field.column.nullable">・必填</template></small>
          </span>
          <select v-model="field.mode" :aria-label="`${field.column.name} 輸入方式`">
            <option value="default">DEFAULT</option>
            <option value="value">輸入值</option>
            <option value="null" :disabled="!field.column.nullable">NULL</option>
          </select>
          <input
            v-if="field.mode === 'value'"
            v-model="field.value"
            :aria-label="`${field.column.name} 的值`"
            :placeholder="field.column.defaultValue !== undefined ? `預設 ${field.column.defaultValue}` : undefined"
          >
        </label>
      </div>
      <div class="preview-actions">
        <button type="button" class="ghost" @click="closeWritePanels">取消</button>
        <button type="button" @click="prepareInsert">預覽新增</button>
      </div>
    </section>
    <section v-if="pendingInsert" class="write-preview" role="dialog" aria-label="確認新增資料列">
      <strong>確認新增 1 列</strong>
      <p>使用參數化 SQL；DEFAULT 欄位由 PostgreSQL 產生。</p>
      <pre>{{ pendingInsert.sql }}</pre>
      <ol>
        <li v-for="(param, index) in pendingInsert.params" :key="index">
          <code>${{ index + 1 }}</code> = <code>{{ parameterLabel(param) }}</code>
        </li>
      </ol>
      <div class="preview-actions">
        <button type="button" class="ghost" :disabled="saving" @click="pendingInsert = null">返回修改</button>
        <button type="button" class="write-confirm" :disabled="saving" @click="confirmInsert">
          {{ saving ? '新增中…' : '確認新增 1 列' }}
        </button>
      </div>
    </section>
    <section v-if="pendingUpdate" class="write-preview" role="dialog" aria-label="確認資料寫入">
      <strong>確認寫入</strong>
      <p>使用參數化 SQL，最多更新 1 列；若原值已改變，伺服器會拒絕寫入。</p>
      <pre>{{ pendingUpdate.sql }}</pre>
      <ol>
        <li v-for="(param, index) in pendingUpdate.params" :key="index">
          <code>${{ index + 1 }}</code> = <code>{{ parameterLabel(param) }}</code>
        </li>
      </ol>
      <div class="preview-actions">
        <button type="button" class="ghost" :disabled="saving" @click="pendingUpdate = null">返回修改</button>
        <button type="button" class="write-confirm" :disabled="saving" @click="confirmUpdate">
          {{ saving ? '寫入中…' : '確認寫入 1 列' }}
        </button>
      </div>
    </section>
    <section v-if="pendingDelete" class="write-preview delete-preview" role="dialog" aria-label="確認刪除資料列">
      <strong>確認刪除 1 列</strong>
      <p>刪除只會在完整 primary key 與 row version 都仍相符時執行。</p>
      <pre>{{ pendingDelete.sql }}</pre>
      <ol>
        <li v-for="(param, index) in pendingDelete.params" :key="index">
          <code>${{ index + 1 }}</code> = <code>{{ parameterLabel(param) }}</code>
        </li>
      </ol>
      <div class="preview-actions">
        <button type="button" class="ghost" :disabled="saving" @click="closeWritePanels">取消</button>
        <button type="button" class="delete-confirm" :disabled="saving" @click="confirmDelete">
          {{ saving ? '刪除中…' : '確認刪除 1 列' }}
        </button>
      </div>
    </section>
    <div class="pager">
      <button :disabled="offset === 0" @click="prevPage">上一頁</button>
      <button :disabled="isLastPage" @click="nextPage">下一頁</button>
      <!-- exports the currently loaded page - full-table export is a milestone C item -->
      <ResultExport v-if="result && result.columns.length" :result="result" />
      <span v-if="result" class="meta">{{ offset + 1 }}–{{ offset + result.rows.length }} 列・{{ Math.round(result.executionMs) }} ms</span>
    </div>
  </div>
</template>

<style scoped>
.grid { display: flex; flex-direction: column; gap: 10px; }
.loading { color: var(--muted); font-size: 13px; }
.editability, .notice, .write-error { margin: 0; font-size: 12px; }
.editability { color: var(--muted); }
.notice { color: #86b98d; }
.write-error { color: var(--danger); }
.toolbar { display: flex; flex-wrap: wrap; gap: 8px; }
.toolbar input { flex: 1; min-width: 80px; }

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
th {
  position: sticky;
  top: 0;
  background: var(--panel-2);
  color: var(--glass); /* column names in lens-glass blue */
  font-weight: 500;
  cursor: pointer;
  user-select: none;
}
th.sorted { color: var(--brass); }
.row-actions-head { cursor: default; }
.dir { font-size: 11px; }
tbody tr:hover { background: var(--brass-soft); }
tbody tr:last-child td { border-bottom: none; }
.isnull { color: var(--muted); font-style: italic; }
.editable { cursor: text; }
.editable:focus { outline: 1px solid var(--brass); outline-offset: -2px; }
.editing { overflow: visible; min-width: 320px; background: var(--panel-2); }
.cell-editor { display: flex; align-items: center; gap: 6px; color: var(--text); font-style: normal; }
.cell-editor > input[type="text"], .cell-editor > input:not([type]) { min-width: 120px; flex: 1; }
.cell-editor label { display: flex; align-items: center; gap: 3px; font-size: 11px; }
.row-actions { display: flex; gap: 4px; overflow: visible; max-width: none; }
.delete-row { color: var(--danger); }

.row-insert { display: grid; gap: 10px; padding: 12px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--panel-2); }
.row-insert > p { margin: 0; color: var(--muted); font-size: 12px; }
.insert-fields { display: grid; gap: 7px; }
.insert-field { display: grid; grid-template-columns: minmax(140px, 1fr) 120px minmax(160px, 2fr); align-items: center; gap: 8px; }
.insert-field > span { display: flex; flex-direction: column; font: 12px var(--font-data); }
.insert-field small { color: var(--muted); font-size: 10px; }
.insert-field input, .insert-field select { min-width: 0; width: 100%; }

.write-preview { display: grid; gap: 8px; padding: 12px; border: 1px solid var(--brass); border-radius: var(--radius); background: var(--panel-2); }
.write-preview p, .write-preview ol { margin: 0; color: var(--muted); font-size: 12px; }
.write-preview pre { margin: 0; padding: 10px; overflow-x: auto; background: var(--ink); color: var(--text); font: 12px var(--font-data); }
.write-preview ol { padding-left: 24px; font-family: var(--font-data); }
.preview-actions { display: flex; justify-content: flex-end; gap: 8px; }
.write-confirm { border-color: var(--brass); color: var(--brass); }
.delete-preview { border-color: var(--danger); }
.delete-confirm { border-color: var(--danger); color: var(--danger); }

.pager { display: flex; gap: 8px; align-items: center; }
.meta { margin-left: auto; font-family: var(--font-data); font-size: 12px; color: var(--muted); }

@media (max-width: 720px) {
  .insert-field { grid-template-columns: 1fr; }
}
</style>
