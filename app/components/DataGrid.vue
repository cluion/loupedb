<script setup lang="ts">
import {
  BROWSE_FILTER_OPERATORS,
  MAX_BROWSE_FILTERS,
  VALUELESS_BROWSE_FILTER_OPERATORS,
  type BrowseFilterCombinator,
  type BrowseFilterCondition,
  type BrowseFilterOperator,
  type BrowseOpts,
  type CellUpdateInput,
  type ColumnInfo,
  type ConnectionSafetyMode,
  type NormalizedType,
  type QueryResult,
  type RowDeleteInput,
  type RowInsertInput,
  type TableChange,
  type TableSchema,
} from '#shared/types'
import { isBinaryCellSummary, isBinaryCellValue } from '#shared/binaryCell'
import {
  DEFAULT_COLUMN_WIDTH,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  clampColumnWidth,
  useTableColumnDisplay,
} from '../stores/tableColumnDisplay'
import { useTableFilterHistory, type TableFilterHistoryEntry } from '../stores/tableFilterHistory'
import { cellContentValuesEqual, usesCellContentDialog } from '../utils/cellContent'
import { binaryCellLabel } from '../utils/binaryCell'
import {
  normalizeGridRange,
  parseSpreadsheetTsv,
  selectionToTsv,
  type GridCoordinate,
} from '../utils/tableSelection'

const props = withDefaults(defineProps<{
  connectionId: string
  schema: string
  table: string
  database?: string
  historyLabel?: string
  safetyMode?: ConnectionSafetyMode
}>(), { database: '', historyLabel: '', safetyMode: 'normal' })
const emit = defineEmits<{ 'dirty-state': [dirty: boolean] }>()
const { applyTableChanges, browse, downloadBinaryCell } = useQuery(props.connectionId)
const { describe } = useSchema(props.connectionId)

const SCALAR_EDIT_TYPES: ReadonlySet<NormalizedType> = new Set([
  'integer', 'decimal', 'string', 'boolean', 'datetime', 'date', 'time', 'uuid', 'enum',
])
const CELL_EDIT_TYPES: ReadonlySet<NormalizedType> = new Set([...SCALAR_EDIT_TYPES, 'json', 'array', 'binary'])

const result = ref<QueryResult | null>(null)
const tableInfo = ref<TableSchema | null>(null)
const error = ref<string | null>(null)
const metadataError = ref<string | null>(null)
const writeError = ref<string | null>(null)
const notice = ref<string | null>(null)
const binaryDownloadError = ref<string | null>(null)
const loading = ref(false)
const saving = ref(false)
const downloadingBinary = ref(false)
const limit = ref(50)
const offset = ref(0)
const orderBy = ref<string | undefined>(undefined)
const orderDir = ref<'asc' | 'desc'>('asc')

interface FilterDraftCondition {
  readonly id: number
  column: string
  op: BrowseFilterOperator
  value: string
}

const FILTER_OPERATOR_LABELS: Readonly<Record<BrowseFilterOperator, string>> = {
  '=': '=',
  '!=': '!=',
  '>': '>',
  '>=': '>=',
  '<': '<',
  '<=': '<=',
  'like': 'LIKE',
  'not like': 'NOT LIKE',
  'ilike': 'ILIKE',
  'is null': 'IS NULL',
  'is not null': 'IS NOT NULL',
}
const valuelessFilterOperators: ReadonlySet<BrowseFilterOperator> = new Set(VALUELESS_BROWSE_FILTER_OPERATORS)
let nextFilterConditionId = 1
const createFilterCondition = (): FilterDraftCondition => ({
  id: nextFilterConditionId++, column: '', op: '=', value: '',
})
const filterCombinator = ref<BrowseFilterCombinator>('and')
const filterConditions = ref<FilterDraftCondition[]>([createFilterCondition()])
const appliedFilters = ref<ReadonlyArray<BrowseFilterCondition>>([])
const appliedFilterCombinator = ref<BrowseFilterCombinator>('and')
const tableScope = [
  props.historyLabel || props.connectionId,
  props.database,
  props.schema,
  props.table,
].join('\u001f')
const filterHistory = useTableFilterHistory(tableScope)
const columnDisplay = useTableColumnDisplay(tableScope)
const selectionAnchor = ref<GridCoordinate | null>(null)
const selectionExtent = ref<GridCoordinate | null>(null)
const selectionMessage = ref<string | null>(null)
const selectionError = ref<string | null>(null)
let selectingCells = false

interface CellEditorState {
  readonly rowIndex: number
  readonly column: string
  readonly originalValue: unknown
  readonly identity: Readonly<Record<string, unknown>>
  readonly version: string
  value: string
  useNull: boolean
}

interface ActiveCellContent {
  readonly rowIndex: number
  readonly column: ColumnInfo
  readonly value: unknown
  readonly originalValue: unknown
  readonly identity: Readonly<Record<string, unknown>> | null
  readonly version: string | null
  readonly nullable: boolean
  readonly editable: boolean
}

interface PendingCellUpdate extends CellUpdateInput {
  readonly rowIndex: number
  readonly version: string
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

interface StagedCellUpdate extends PendingCellUpdate { readonly order: number }
interface StagedRowInsert extends PendingRowInsert { readonly id: number; readonly order: number }
interface StagedRowDelete extends PendingRowDelete { readonly order: number }

const editor = ref<CellEditorState | null>(null)
const activeCellContent = ref<ActiveCellContent | null>(null)
const pendingUpdate = ref<PendingCellUpdate | null>(null)
const insertDraft = ref<InsertDraft | null>(null)
const pendingInsert = ref<PendingRowInsert | null>(null)
const pendingDelete = ref<PendingRowDelete | null>(null)
const stagedUpdates = ref<StagedCellUpdate[]>([])
const stagedInserts = ref<StagedRowInsert[]>([])
const stagedDeletes = ref<StagedRowDelete[]>([])
let nextStagedInsertId = 1
let nextStagedChangeOrder = 1

// no total count in mvp (spec section 6): a short page means the last page
const isLastPage = computed(() => (result.value?.rows.length ?? 0) < limit.value)
const stagedCount = computed(() => (
  stagedUpdates.value.length + stagedInserts.value.length + stagedDeletes.value.length
))
const stagedChanges = computed<ReadonlyArray<TableChange>>(() => [
  ...stagedUpdates.value.map((change) => ({
    order: change.order,
    change: {
      kind: 'update' as const,
      column: change.column,
      value: change.value,
      originalValue: change.originalValue,
      identity: change.identity,
      version: change.version,
    },
  })),
  ...stagedInserts.value.map((change) => ({
    order: change.order, change: { kind: 'insert' as const, values: change.values },
  })),
  ...stagedDeletes.value.map((change) => ({
    order: change.order,
    change: { kind: 'delete' as const, identity: change.identity, version: change.version },
  })),
].sort((left, right) => left.order - right.order).map(({ change }) => change))
const isConnectionReadOnly = computed(() => props.safetyMode === 'read-only')
const stagedNeedsSafetyConfirmation = computed(() => (
  stagedChanges.value.some((change) => change.kind === 'update' || change.kind === 'delete')
))
const orderedColumns = computed<ReadonlyArray<ColumnInfo>>(() => {
  const byName = new Map((result.value?.columns ?? []).map((column) => [column.name, column]))
  return columnDisplay.settings.value.order
    .map((name) => byName.get(name))
    .filter((column): column is ColumnInfo => Boolean(column))
})
const hiddenColumns = computed(() => new Set(columnDisplay.settings.value.hidden))
const visibleColumns = computed(() => orderedColumns.value.filter((column) => !hiddenColumns.value.has(column.name)))
const frozenColumns = computed(() => visibleColumns.value.slice(0, columnDisplay.settings.value.frozenCount))
const cellSelection = computed(() => {
  if (!selectionAnchor.value || !selectionExtent.value || !result.value) return null
  const range = normalizeGridRange(selectionAnchor.value, selectionExtent.value)
  if (range.rowStart < 0 || range.rowEnd >= result.value.rows.length) return null
  if (range.columnStart < 0 || range.columnEnd >= visibleColumns.value.length) return null
  return range
})
const selectedRowCount = computed(() => cellSelection.value
  ? cellSelection.value.rowEnd - cellSelection.value.rowStart + 1
  : 0)
const selectedColumnCount = computed(() => cellSelection.value
  ? cellSelection.value.columnEnd - cellSelection.value.columnStart + 1
  : 0)
const selectedCellCount = computed(() => selectedRowCount.value * selectedColumnCount.value)
const frozenOffsets = computed(() => {
  const offsets = new Map<string, number>()
  let left = 0
  for (const column of frozenColumns.value) {
    offsets.set(column.name, left)
    left += columnWidth(column.name)
  }
  return offsets
})
watch(stagedCount, (count) => emit('dirty-state', count > 0), { immediate: true })
onUnmounted(() => {
  emit('dirty-state', false)
  stopColumnResize()
  stopCellSelection()
})

async function load() {
  clearCellSelection()
  error.value = null
  loading.value = true
  const filter: BrowseOpts['filter'] = appliedFilters.value.length ? appliedFilters.value : undefined
  try {
    const r = await browse(props.schema, props.table, {
      limit: limit.value, offset: offset.value,
      orderBy: orderBy.value, orderDir: orderDir.value, filter,
      filterCombinator: filter ? appliedFilterCombinator.value : undefined,
    })
    if (r.ok) {
      result.value = r.data
      columnDisplay.reconcile(r.data.columns.map((column) => column.name))
    }
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
  stagedUpdates.value = []
  stagedInserts.value = []
  stagedDeletes.value = []
  notice.value = null
  load()
  loadTableInfo()
}, { immediate: true })

function sort(col: string) {
  if (stagedCount.value) return
  if (orderBy.value === col) orderDir.value = orderDir.value === 'asc' ? 'desc' : 'asc'
  else { orderBy.value = col; orderDir.value = 'asc' }
  load()
}

function columnWidth(column: string): number {
  return columnDisplay.settings.value.widths[column] ?? DEFAULT_COLUMN_WIDTH
}

function updateColumnWidth(column: string, width: number, persistNow = true) {
  columnDisplay.update({
    ...columnDisplay.settings.value,
    widths: { ...columnDisplay.settings.value.widths, [column]: clampColumnWidth(width) },
  }, persistNow)
}

function updateColumnWidthFromInput(column: string, event: Event) {
  const value = Number((event.target as HTMLInputElement).value)
  updateColumnWidth(column, value)
}

function toggleColumn(column: string) {
  if (stagedCount.value) return
  clearCellSelection()
  const hidden = new Set(columnDisplay.settings.value.hidden)
  if (hidden.has(column)) hidden.delete(column)
  else {
    if (visibleColumns.value.length <= 1) return
    hidden.add(column)
  }
  const visibleCount = columnDisplay.settings.value.order.filter((name) => !hidden.has(name)).length
  columnDisplay.update({
    ...columnDisplay.settings.value,
    hidden: columnDisplay.settings.value.order.filter((name) => hidden.has(name)),
    frozenCount: Math.min(columnDisplay.settings.value.frozenCount, visibleCount),
  })
}

function moveColumn(column: string, delta: -1 | 1) {
  if (stagedCount.value) return
  const order = [...columnDisplay.settings.value.order]
  const from = order.indexOf(column)
  const to = from + delta
  if (from < 0 || to < 0 || to >= order.length) return
  clearCellSelection()
  ;[order[from], order[to]] = [order[to]!, order[from]!]
  columnDisplay.update({ ...columnDisplay.settings.value, order })
}

function freezeThrough(column: string) {
  if (stagedCount.value || hiddenColumns.value.has(column)) return
  const index = visibleColumns.value.findIndex((candidate) => candidate.name === column)
  if (index < 0) return
  columnDisplay.update({ ...columnDisplay.settings.value, frozenCount: index + 1 })
}

function clearFrozenColumns() {
  if (stagedCount.value) return
  columnDisplay.update({ ...columnDisplay.settings.value, frozenCount: 0 })
}

function resetColumnDisplay() {
  if (stagedCount.value) return
  clearCellSelection()
  columnDisplay.reset(result.value?.columns.map((column) => column.name) ?? [])
}

function columnStyle(column: string): Record<string, string> {
  const width = `${columnWidth(column)}px`
  const style: Record<string, string> = { width, minWidth: width, maxWidth: width }
  const frozenLeft = frozenOffsets.value.get(column)
  if (frozenLeft !== undefined) style['--frozen-left'] = `${frozenLeft}px`
  return style
}

function isFrozenColumn(column: string): boolean {
  return frozenOffsets.value.has(column)
}

function isLastFrozenColumn(column: string): boolean {
  return frozenColumns.value.at(-1)?.name === column
}

interface ColumnResizeState {
  readonly column: string
  readonly startX: number
  readonly startWidth: number
}

let columnResize: ColumnResizeState | null = null

function startColumnResize(event: PointerEvent, column: string) {
  if (stagedCount.value) return
  event.preventDefault()
  event.stopPropagation()
  columnResize = { column, startX: event.clientX, startWidth: columnWidth(column) }
  window.addEventListener('pointermove', resizeColumn)
  window.addEventListener('pointerup', stopColumnResize)
  window.addEventListener('pointercancel', stopColumnResize)
}

function resizeColumn(event: PointerEvent) {
  if (!columnResize) return
  updateColumnWidth(
    columnResize.column,
    columnResize.startWidth + event.clientX - columnResize.startX,
    false,
  )
}

function stopColumnResize() {
  if (!columnResize) return
  columnResize = null
  columnDisplay.persist()
  window.removeEventListener('pointermove', resizeColumn)
  window.removeEventListener('pointerup', stopColumnResize)
  window.removeEventListener('pointercancel', stopColumnResize)
}

function clearCellSelection() {
  selectionAnchor.value = null
  selectionExtent.value = null
  selectionMessage.value = null
  selectionError.value = null
  stopCellSelection()
}

function startCellSelection(event: PointerEvent, row: number, column: number) {
  if (event.button !== 0 || (event.target as HTMLElement).closest('.cell-editor, .cell-content-trigger')) return
  if (!event.shiftKey || !selectionAnchor.value) selectionAnchor.value = { row, column }
  selectionExtent.value = { row, column }
  selectionMessage.value = null
  selectionError.value = null
  selectingCells = true
  ;(event.currentTarget as HTMLElement).focus()
  event.preventDefault()
  window.addEventListener('pointermove', moveCellSelection)
  window.addEventListener('pointerup', stopCellSelection)
  window.addEventListener('pointercancel', stopCellSelection)
}

function moveCellSelection(event: PointerEvent) {
  if (!selectingCells || !selectionAnchor.value) return
  const cell = document.elementFromPoint(event.clientX, event.clientY)
    ?.closest<HTMLElement>('[data-selection-row][data-selection-column]')
  if (!cell) return
  const row = Number(cell.dataset.selectionRow)
  const column = Number(cell.dataset.selectionColumn)
  if (Number.isInteger(row) && Number.isInteger(column)) extendCellSelection(row, column)
}

function extendCellSelection(row: number, column: number) {
  if (!selectingCells || !selectionAnchor.value) return
  selectionExtent.value = { row, column }
}

function stopCellSelection() {
  selectingCells = false
  if (typeof window === 'undefined') return
  window.removeEventListener('pointermove', moveCellSelection)
  window.removeEventListener('pointerup', stopCellSelection)
  window.removeEventListener('pointercancel', stopCellSelection)
}

function isSelectedCell(row: number, column: number): boolean {
  const range = cellSelection.value
  return Boolean(range
    && row >= range.rowStart && row <= range.rowEnd
    && column >= range.columnStart && column <= range.columnEnd)
}

function isSelectionAnchor(row: number, column: number): boolean {
  return selectionAnchor.value?.row === row && selectionAnchor.value.column === column
}

function focusSelectedCell(row: number, column: number) {
  nextTick(() => {
    document.querySelector<HTMLElement>(
      `[data-selection-row="${row}"][data-selection-column="${column}"]`,
    )?.focus()
  })
}

function handleCellKeydown(event: KeyboardEvent, row: number, column: number) {
  if ((event.target as HTMLElement).closest('.cell-editor')) return
  if (event.key === 'Escape') {
    clearCellSelection()
    return
  }
  const movements: Readonly<Record<string, readonly [number, number]>> = {
    ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1],
  }
  const movement = movements[event.key]
  if (!movement || !result.value) return
  const next = {
    row: Math.max(0, Math.min(result.value.rows.length - 1, row + movement[0])),
    column: Math.max(0, Math.min(visibleColumns.value.length - 1, column + movement[1])),
  }
  if (!event.shiftKey) selectionAnchor.value = next
  else if (!selectionAnchor.value) selectionAnchor.value = { row, column }
  selectionExtent.value = next
  selectionMessage.value = null
  selectionError.value = null
  event.preventDefault()
  focusSelectedCell(next.row, next.column)
}

function selectedRangeTsv(): string | null {
  const range = cellSelection.value
  if (!range || !result.value) return null
  const values = []
  for (let row = range.rowStart; row <= range.rowEnd; row++) {
    const record = result.value.rows[row]!
    values.push(visibleColumns.value
      .slice(range.columnStart, range.columnEnd + 1)
      .map((column) => column.type === 'binary'
        ? binaryCellLabel(cellValue(record, column.name))
        : cellValue(record, column.name)))
  }
  return selectionToTsv(values)
}

function isClipboardInput(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

function copySelectionEvent(event: ClipboardEvent) {
  if (isClipboardInput(event.target)) return
  const text = selectedRangeTsv()
  if (text === null || !event.clipboardData) return
  event.clipboardData.setData('text/plain', text)
  event.preventDefault()
  selectionMessage.value = `已複製 ${selectedCellCount.value} 格 TSV`
  selectionError.value = null
}

async function copyCellSelection() {
  const text = selectedRangeTsv()
  if (text === null) return
  try {
    await navigator.clipboard.writeText(text)
    selectionMessage.value = `已複製 ${selectedCellCount.value} 格 TSV`
    selectionError.value = null
  } catch {
    selectionError.value = '無法寫入剪貼簿，請使用 ⌘/Ctrl+C'
  }
}

function buildPendingCellUpdate(
  rowIndex: number,
  column: string,
  value: unknown,
  originalValue: unknown,
  identity: Readonly<Record<string, unknown>>,
  version: string,
): PendingCellUpdate {
  const identityEntries = Object.entries(identity)
  const params: unknown[] = [value, ...identityEntries.map(([, identityValue]) => identityValue)]
  const conditions = identityEntries.map(([identityColumn], index) =>
    `${quotePreviewIdentifier(identityColumn)} IS NOT DISTINCT FROM $${index + 2}`)
  const binaryColumn = tableInfo.value?.columns.find((candidate) => candidate.name === column)?.type === 'binary'
  if (binaryColumn && isBinaryCellSummary(originalValue)) {
    params.push(originalValue.byteLength)
    conditions.push(`octet_length(${quotePreviewIdentifier(column)}) = $${params.length}`)
    params.push(originalValue.checksum)
    conditions.push(`md5(${quotePreviewIdentifier(column)}) = $${params.length}`)
  } else {
    params.push(originalValue)
    conditions.push(`${quotePreviewIdentifier(column)} IS NOT DISTINCT FROM $${params.length}`)
  }
  params.push(version)
  conditions.push(`xmin::text = $${params.length}`)
  return {
    schema: props.schema,
    table: props.table,
    column,
    value,
    originalValue,
    identity,
    version,
    rowIndex,
    sql: `UPDATE ${quotePreviewIdentifier(props.schema)}.${quotePreviewIdentifier(props.table)}\n`
      + `SET ${quotePreviewIdentifier(column)} = $1\n`
      + `WHERE ${conditions.join('\n  AND ')};`,
    params,
  }
}

function pastedUpdate(
  row: Readonly<Record<string, unknown>>, rowIndex: number, column: ColumnInfo, value: string,
): PendingCellUpdate {
  const staged = stagedUpdateFor(row, column.name)
  return buildPendingCellUpdate(
    rowIndex,
    column.name,
    value,
    staged ? staged.originalValue : row[column.name],
    identityFor(row)!.values,
    rowVersion(rowIndex)!,
  )
}

function stagePastedUpdates(updates: ReadonlyArray<PendingCellUpdate>): number {
  let next = [...stagedUpdates.value]
  for (const input of updates) {
    const signature = identitySignature(input.identity)
    const previous = next.find((change) => (
      identitySignature(change.identity) === signature && change.column === input.column
    ))
    next = next.filter((change) => !(
      identitySignature(change.identity) === signature && change.column === input.column
    ))
    if (!cellContentValuesEqual(input.value, input.originalValue)) {
      next.push({ ...input, order: previous?.order ?? nextStagedChangeOrder++ })
    }
  }
  stagedUpdates.value = next
  return updates.filter((update) => !cellContentValuesEqual(update.value, update.originalValue)).length
}

function pasteSpreadsheetText(text: string) {
  const range = cellSelection.value
  if (!range || !result.value) return
  selectionMessage.value = null
  selectionError.value = null
  if (saving.value) {
    selectionError.value = '資料仍在套用中，請稍後再貼上'
    return
  }
  let matrix: ReadonlyArray<ReadonlyArray<string>>
  try {
    matrix = parseSpreadsheetTsv(text)
  } catch (cause) {
    selectionError.value = cause instanceof Error ? cause.message : String(cause)
    return
  }
  const rowEnd = range.rowStart + matrix.length - 1
  const columnEnd = range.columnStart + matrix[0]!.length - 1
  if (rowEnd >= result.value.rows.length || columnEnd >= visibleColumns.value.length) {
    selectionError.value = '貼上範圍超出目前已載入的資料列或可見欄位'
    return
  }

  const updates: PendingCellUpdate[] = []
  for (let rowOffset = 0; rowOffset < matrix.length; rowOffset++) {
    const rowIndex = range.rowStart + rowOffset
    const row = result.value.rows[rowIndex]!
    for (let columnOffset = 0; columnOffset < matrix[rowOffset]!.length; columnOffset++) {
      const column = visibleColumns.value[range.columnStart + columnOffset]!
      if (!SCALAR_EDIT_TYPES.has(column.type) || !canEditCell(column, row, rowIndex)) {
        selectionError.value = `第 ${offset.value + rowIndex + 1} 列的 ${column.name} 不可安全貼上`
        return
      }
      updates.push(pastedUpdate(row, rowIndex, column, matrix[rowOffset]![columnOffset]!))
    }
  }

  closeWritePanels()
  const staged = stagePastedUpdates(updates)
  selectionAnchor.value = { row: range.rowStart, column: range.columnStart }
  selectionExtent.value = { row: rowEnd, column: columnEnd }
  selectionMessage.value = staged
    ? `已從剪貼簿暫存 ${staged} 個欄位變更`
    : '貼上內容與原始資料相同，沒有新增變更'
}

function pasteSelectionEvent(event: ClipboardEvent) {
  if (isClipboardInput(event.target) || !cellSelection.value || !event.clipboardData) return
  event.preventDefault()
  pasteSpreadsheetText(event.clipboardData.getData('text/plain'))
}

async function pasteCellSelection() {
  try {
    pasteSpreadsheetText(await navigator.clipboard.readText())
  } catch {
    selectionError.value = '無法讀取剪貼簿，請使用 ⌘/Ctrl+V'
  }
}

function filterNeedsValue(op: BrowseFilterOperator): boolean {
  return !valuelessFilterOperators.has(op)
}

function addFilterCondition() {
  if (stagedCount.value || filterConditions.value.length >= MAX_BROWSE_FILTERS) return
  filterConditions.value.push(createFilterCondition())
}

function removeFilterCondition(id: number) {
  if (stagedCount.value) return
  if (filterConditions.value.length === 1) {
    filterConditions.value = [createFilterCondition()]
    return
  }
  filterConditions.value = filterConditions.value.filter((condition) => condition.id !== id)
}

function draftToFilters(): ReadonlyArray<BrowseFilterCondition> {
  return filterConditions.value
    .filter((condition) => condition.column)
    .map((condition) => filterNeedsValue(condition.op)
      ? { column: condition.column, op: condition.op, value: condition.value }
      : { column: condition.column, op: condition.op })
}

function setAppliedFilters(filters: ReadonlyArray<BrowseFilterCondition>, combinator: BrowseFilterCombinator) {
  appliedFilters.value = filters.map((filter) => ({ ...filter }))
  appliedFilterCombinator.value = combinator
}

function applyFilter() {
  if (stagedCount.value) return
  const filters = draftToFilters()
  setAppliedFilters(filters, filterCombinator.value)
  if (filters.length) filterHistory.add({ filters, combinator: filterCombinator.value })
  offset.value = 0
  load()
}

function clearFilter() {
  if (stagedCount.value) return
  filterCombinator.value = 'and'
  filterConditions.value = [createFilterCondition()]
  setAppliedFilters([], 'and')
  offset.value = 0
  load()
}

function restoreFilter(entry: TableFilterHistoryEntry) {
  if (stagedCount.value || loading.value) return
  const availableColumns = new Set(result.value?.columns.map((column) => column.name) ?? [])
  if (entry.filters.some((filter) => !availableColumns.has(filter.column))) {
    notice.value = '此篩選歷史包含已不存在的欄位，未予套用'
    return
  }
  filterCombinator.value = entry.combinator
  filterConditions.value = entry.filters.map((filter) => ({
    id: nextFilterConditionId++,
    column: filter.column,
    op: filter.op,
    value: filter.value === undefined || filter.value === null ? '' : String(filter.value),
  }))
  setAppliedFilters(entry.filters, entry.combinator)
  filterHistory.add({ filters: entry.filters, combinator: entry.combinator })
  offset.value = 0
  load()
}

function filterSummary(
  filters: ReadonlyArray<BrowseFilterCondition>, combinator: BrowseFilterCombinator,
): string {
  const joiner = combinator === 'and' ? ' AND ' : ' OR '
  return filters.map((filter) => {
    const operator = FILTER_OPERATOR_LABELS[filter.op]
    return filterNeedsValue(filter.op)
      ? `${filter.column} ${operator} ${JSON.stringify(filter.value ?? '')}`
      : `${filter.column} ${operator}`
  }).join(joiner)
}

function filterTimeLabel(at: number): string {
  return new Date(at).toLocaleString('zh-TW', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

function prevPage() {
  if (stagedCount.value) return
  offset.value = Math.max(0, offset.value - limit.value)
  load()
}

function nextPage() {
  if (stagedCount.value) return
  offset.value = offset.value + limit.value
  load()
}

function closeWritePanels() {
  editor.value = null
  activeCellContent.value = null
  pendingUpdate.value = null
  insertDraft.value = null
  pendingInsert.value = null
  pendingDelete.value = null
  writeError.value = null
  binaryDownloadError.value = null
}

function isScalar(value: unknown): boolean {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value)
}

interface SafeRowIdentity {
  readonly columns: ReadonlyArray<string>
  readonly values: Readonly<Record<string, unknown>>
}

function identityFor(row: Readonly<Record<string, unknown>>): SafeRowIdentity | null {
  const primaryKey = tableInfo.value?.primaryKey ?? []
  if (primaryKey.length && primaryKey.every((column) => isScalar(row[column]) && row[column] !== null)) {
    return {
      columns: primaryKey,
      values: Object.fromEntries(primaryKey.map((column) => [column, row[column]])),
    }
  }
  for (const key of tableInfo.value?.uniqueKeys ?? []) {
    if (key.columns.length && key.columns.every((column) => isScalar(row[column]) && row[column] !== null)) {
      return {
        columns: key.columns,
        values: Object.fromEntries(key.columns.map((column) => [column, row[column]])),
      }
    }
  }
  return null
}

function identitySignature(identity: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(Object.keys(identity).sort().map((key) => [key, identity[key]]))
}

function rowSignature(row: Readonly<Record<string, unknown>>): string | null {
  const identity = identityFor(row)
  return identity ? identitySignature(identity.values) : null
}

function stagedUpdateFor(
  row: Readonly<Record<string, unknown>>, column: string,
): PendingCellUpdate | undefined {
  const signature = rowSignature(row)
  return signature === null ? undefined : stagedUpdates.value.find((change) => (
    identitySignature(change.identity) === signature && change.column === column
  ))
}

function isStagedDelete(row: Readonly<Record<string, unknown>>): boolean {
  const signature = rowSignature(row)
  return signature !== null && stagedDeletes.value.some((change) => (
    identitySignature(change.identity) === signature
  ))
}

function rowVersion(rowIndex: number): string | null {
  const version = result.value?.rowVersions?.[rowIndex]
  return typeof version === 'string' && /^\d+$/u.test(version) ? version : null
}

function canEditCell(
  column: ColumnInfo, row: Readonly<Record<string, unknown>>, rowIndex: number,
): boolean {
  const identity = identityFor(row)
  const schemaColumn = tableInfo.value?.columns.find((candidate) => candidate.name === column.name)
  return identity !== null
    && !isConnectionReadOnly.value
    && rowVersion(rowIndex) !== null
    && !isStagedDelete(row)
    && !identity.columns.includes(column.name)
    && schemaColumn?.editable !== false
    && CELL_EDIT_TYPES.has(column.type)
}

function displayValue(value: unknown): string {
  if (value === null) return 'NULL'
  if (isBinaryCellValue(value)) return binaryCellLabel(value)
  if (typeof value === 'object') return JSON.stringify(value) ?? String(value)
  return String(value)
}

function usesExpandedCell(column: ColumnInfo, value: unknown): boolean {
  return column.type === 'binary' || usesCellContentDialog(column.type, value)
}

function cellValue(row: Readonly<Record<string, unknown>>, column: string): unknown {
  const staged = stagedUpdateFor(row, column)
  return staged ? staged.value : row[column]
}

function openCellContent(row: Readonly<Record<string, unknown>>, rowIndex: number, column: ColumnInfo) {
  const staged = stagedUpdateFor(row, column.name)
  const identity = identityFor(row)
  const version = rowVersion(rowIndex)
  const schemaColumn = tableInfo.value?.columns.find((candidate) => candidate.name === column.name)
  const value = staged ? staged.value : row[column.name]
  const editable = canEditCell(column, row, rowIndex) && !saving.value
  closeWritePanels()
  activeCellContent.value = {
    rowIndex,
    column,
    value,
    originalValue: staged ? staged.originalValue : row[column.name],
    identity: identity ? identity.values : null,
    version,
    nullable: schemaColumn?.nullable ?? column.nullable,
    editable,
  }
  notice.value = null
  binaryDownloadError.value = null
}

function activateCell(row: Readonly<Record<string, unknown>>, rowIndex: number, column: ColumnInfo) {
  if (usesExpandedCell(column, cellValue(row, column.name))) {
    openCellContent(row, rowIndex, column)
  } else beginEdit(row, rowIndex, column)
}

function prepareCellContentUpdate(value: unknown) {
  const content = activeCellContent.value
  if (!content?.editable || !content.identity || !content.version) return
  pendingUpdate.value = buildPendingCellUpdate(
    content.rowIndex,
    content.column.name,
    value,
    content.originalValue,
    content.identity,
    content.version,
  )
  activeCellContent.value = null
}

function beginEdit(row: Readonly<Record<string, unknown>>, rowIndex: number, column: ColumnInfo) {
  if (usesExpandedCell(column, cellValue(row, column.name))) {
    openCellContent(row, rowIndex, column)
    return
  }
  if (!canEditCell(column, row, rowIndex) || saving.value) return
  const identity = identityFor(row)
  const version = rowVersion(rowIndex)
  if (!identity || !version) return
  closeWritePanels()
  const staged = stagedUpdateFor(row, column.name)
  const originalValue = staged ? staged.originalValue : row[column.name]
  const value = staged ? staged.value : row[column.name]
  editor.value = {
    rowIndex,
    column: column.name,
    originalValue,
    identity: identity.values,
    version,
    value: value === null ? '' : displayValue(value),
    useNull: value === null,
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
  pendingUpdate.value = buildPendingCellUpdate(
    editor.value.rowIndex,
    editor.value.column,
    value,
    editor.value.originalValue,
    editor.value.identity,
    editor.value.version,
  )
}

function parameterLabel(value: unknown): string {
  if (value === null) return 'NULL'
  if (isBinaryCellValue(value)) return binaryCellLabel(value)
  if (typeof value === 'object') return JSON.stringify(value) ?? String(value)
  return typeof value === 'string' ? JSON.stringify(value) : String(value)
}

function activeBinaryDownloadable(): boolean {
  return Boolean(
    activeCellContent.value?.column.type === 'binary'
    && activeCellContent.value.identity
    && activeCellContent.value.version
    && isBinaryCellSummary(activeCellContent.value.originalValue),
  )
}

async function downloadActiveBinary() {
  const content = activeCellContent.value
  if (!content || content.column.type !== 'binary' || !content.identity || !content.version) return
  downloadingBinary.value = true
  binaryDownloadError.value = null
  try {
    const download = await downloadBinaryCell({
      schema: props.schema,
      table: props.table,
      column: content.column.name,
      identity: content.identity,
      version: content.version,
    })
    const url = URL.createObjectURL(download.blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = download.fileName
    anchor.click()
    URL.revokeObjectURL(url)
  } catch (cause) {
    binaryDownloadError.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    downloadingBinary.value = false
  }
}

function stageUpdate() {
  if (!pendingUpdate.value || saving.value) return
  const input = pendingUpdate.value
  const signature = identitySignature(input.identity)
  const previous = stagedUpdates.value.find((change) => (
    identitySignature(change.identity) === signature && change.column === input.column
  ))
  stagedUpdates.value = stagedUpdates.value.filter((change) => !(
    identitySignature(change.identity) === signature && change.column === input.column
  ))
  const unchanged = cellContentValuesEqual(input.value, input.originalValue)
  if (!unchanged) {
    stagedUpdates.value.push({ ...input, order: previous?.order ?? nextStagedChangeOrder++ })
  }
  closeWritePanels()
  notice.value = unchanged ? '已移除此欄位變更' : '已暫存 1 個欄位變更'
}

function startInsert(source?: Readonly<Record<string, unknown>>) {
  if (!tableInfo.value || saving.value || isConnectionReadOnly.value) return
  closeWritePanels()
  notice.value = null
  const keyColumns = new Set([
    ...tableInfo.value.primaryKey,
    ...tableInfo.value.uniqueKeys.flatMap((key) => key.columns),
  ])
  const fields = tableInfo.value.columns
    .filter((column) => column.insertable !== false && SCALAR_EDIT_TYPES.has(column.type))
    .map((column): InsertField => {
      if (!source) {
        return {
          column,
          mode: column.defaultValue !== undefined || column.nullable ? 'default' : 'value',
          value: '',
        }
      }
      if (keyColumns.has(column.name)) {
        return {
          column,
          mode: column.defaultValue !== undefined ? 'default' : 'value',
          value: '',
        }
      }
      const sourceValue = cellValue(source, column.name)
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

function stageInsert() {
  if (!pendingInsert.value || saving.value) return
  stagedInserts.value.push({
    ...pendingInsert.value, id: nextStagedInsertId++, order: nextStagedChangeOrder++,
  })
  closeWritePanels()
  notice.value = '已暫存新增 1 列'
}

function canDeleteRow(row: Readonly<Record<string, unknown>>, rowIndex: number): boolean {
  return !isConnectionReadOnly.value
    && identityFor(row) !== null
    && rowVersion(rowIndex) !== null
    && !isStagedDelete(row)
}

function prepareDelete(row: Readonly<Record<string, unknown>>, rowIndex: number) {
  if (!canDeleteRow(row, rowIndex) || saving.value) return
  const safeIdentity = identityFor(row)
  if (!safeIdentity) return
  closeWritePanels()
  notice.value = null
  const identity = safeIdentity.values
  const identityEntries = Object.entries(identity)
  const version = rowVersion(rowIndex)!
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

function stageDelete() {
  if (!pendingDelete.value || saving.value) return
  const input = pendingDelete.value
  const signature = identitySignature(input.identity)
  stagedUpdates.value = stagedUpdates.value.filter((change) => (
    identitySignature(change.identity) !== signature
  ))
  stagedDeletes.value = [
    ...stagedDeletes.value.filter((change) => identitySignature(change.identity) !== signature),
    { ...input, order: nextStagedChangeOrder++ },
  ]
  closeWritePanels()
  notice.value = '已暫存刪除 1 列'
}

function identityLabel(identity: Readonly<Record<string, unknown>>): string {
  return Object.entries(identity).map(([key, value]) => `${key}=${parameterLabel(value)}`).join(', ')
}

function revertAll() {
  if (saving.value) return
  const count = stagedCount.value
  stagedUpdates.value = []
  stagedInserts.value = []
  stagedDeletes.value = []
  closeWritePanels()
  notice.value = `已回復 ${count} 項未套用變更`
}

async function applyAll() {
  if (!stagedCount.value || saving.value) return
  if (isConnectionReadOnly.value) {
    writeError.value = '整批未套用：此連線為 Read-only，禁止寫入'
    return
  }
  const confirmedDangerous = props.safetyMode === 'safe' && stagedNeedsSafetyConfirmation.value
    ? window.confirm(`Safe mode：即將套用 ${stagedCount.value} 項變更，其中包含 UPDATE／DELETE。確定繼續嗎？`)
    : false
  if (props.safetyMode === 'safe' && stagedNeedsSafetyConfirmation.value && !confirmedDangerous) return
  saving.value = true
  writeError.value = null
  try {
    const input = {
      schema: props.schema, table: props.table, changes: stagedChanges.value,
    }
    const response = confirmedDangerous
      ? await applyTableChanges(input, true)
      : await applyTableChanges(input)
    if (!response.ok) {
      writeError.value = `整批未套用：${response.error.message}`
      return
    }
    stagedUpdates.value = []
    stagedInserts.value = []
    stagedDeletes.value = []
    closeWritePanels()
    notice.value = `已套用 ${response.data.affectedRows} 項變更`
    await load()
  } catch (cause) {
    writeError.value = `整批未套用：${cause instanceof Error ? cause.message : String(cause)}`
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
      <template v-if="isConnectionReadOnly">Read-only 連線：資料僅供瀏覽，新增、編輯與刪除皆停用</template>
      <template v-else-if="tableInfo.primaryKey.length">可編輯：使用 primary key 安全定位；雙擊非鍵欄位</template>
      <template v-else-if="tableInfo.uniqueKeys.length">可編輯：使用 unique key 安全定位；NULL 唯一鍵資料列維持唯讀</template>
      <template v-else>無 primary key 或 unique key：可新增或 Clone，但既有資料唯讀且不可刪除</template>
    </p>
    <p v-if="notice" class="notice" role="status">{{ notice }}</p>
    <p v-if="writeError" class="write-error" role="alert">{{ writeError }}</p>
    <section class="filter-builder" aria-label="多條件篩選">
      <form @submit.prevent="applyFilter">
        <div class="filter-head">
          <strong>篩選</strong>
          <label>
            <span>條件關係</span>
            <select v-model="filterCombinator" aria-label="filter combinator" :disabled="stagedCount > 0">
              <option value="and">全部符合 AND</option>
              <option value="or">任一符合 OR</option>
            </select>
          </label>
        </div>
        <div class="filter-conditions">
          <div
            v-for="(condition, index) in filterConditions"
            :key="condition.id"
            class="filter-condition"
            data-testid="filter-condition"
          >
            <span class="condition-number">{{ index + 1 }}</span>
            <select
              v-model="condition.column"
              :aria-label="index === 0 ? 'filter column' : `filter column ${index + 1}`"
              :disabled="stagedCount > 0"
            >
              <option value="">選擇欄位</option>
              <option v-for="c in result?.columns ?? []" :key="c.name" :value="c.name">{{ c.name }}</option>
            </select>
            <select
              v-model="condition.op"
              :aria-label="index === 0 ? 'filter op' : `filter op ${index + 1}`"
              :disabled="stagedCount > 0"
            >
              <option v-for="op in BROWSE_FILTER_OPERATORS" :key="op" :value="op">
                {{ FILTER_OPERATOR_LABELS[op] }}
              </option>
            </select>
            <input
              v-if="filterNeedsValue(condition.op)"
              v-model="condition.value"
              :aria-label="index === 0 ? 'filter value' : `filter value ${index + 1}`"
              placeholder="值"
              :disabled="stagedCount > 0"
            >
            <span v-else class="no-filter-value">不需輸入值</span>
            <button
              type="button"
              class="ghost remove-filter"
              :aria-label="`移除篩選條件 ${index + 1}`"
              :disabled="stagedCount > 0"
              @click="removeFilterCondition(condition.id)"
            >×</button>
          </div>
        </div>
        <div class="filter-actions">
          <button
            type="button" class="ghost"
            :disabled="stagedCount > 0 || filterConditions.length >= MAX_BROWSE_FILTERS"
            @click="addFilterCondition"
          >＋ 新增條件</button>
          <button type="button" class="ghost" :disabled="stagedCount > 0" @click="clearFilter">清除</button>
          <button type="submit" :disabled="stagedCount > 0">套用篩選</button>
          <button type="button" :disabled="!tableInfo || saving || isConnectionReadOnly" @click="startInsert()">新增資料列</button>
        </div>
      </form>
      <p v-if="appliedFilters.length" class="active-filter" data-testid="active-filter">
        已套用：{{ filterSummary(appliedFilters, appliedFilterCombinator) }}
      </p>
      <details v-if="filterHistory.entries.value.length" class="filter-history">
        <summary>最近篩選・{{ filterHistory.entries.value.length }}</summary>
        <ul>
          <li v-for="(entry, index) in filterHistory.entries.value" :key="entry.id">
            <button
              type="button"
              class="ghost history-filter"
              :aria-label="`套用篩選歷史 ${index + 1}`"
              :disabled="loading || stagedCount > 0"
              @click="restoreFilter(entry)"
            >{{ filterSummary(entry.filters, entry.combinator) }}</button>
            <time :datetime="new Date(entry.at).toISOString()">{{ filterTimeLabel(entry.at) }}</time>
            <button
              type="button"
              class="ghost remove-filter"
              :aria-label="`刪除篩選歷史 ${index + 1}`"
              @click="filterHistory.remove(entry.id)"
            >×</button>
          </li>
        </ul>
        <button type="button" class="ghost clear-filter-history" @click="filterHistory.clear">清除篩選歷史</button>
      </details>
    </section>
    <details v-if="result" class="column-display" data-testid="column-display-settings">
      <summary>
        欄位設定・顯示 {{ visibleColumns.length }}/{{ orderedColumns.length }}
        <template v-if="columnDisplay.settings.value.frozenCount">
          ・凍結 {{ columnDisplay.settings.value.frozenCount }}
        </template>
      </summary>
      <p>拖曳欄名右側可調整寬度；此處可隱藏、排序或凍結前置欄位。</p>
      <ul>
        <li v-for="(column, index) in orderedColumns" :key="column.name">
          <label class="column-visible">
            <input
              type="checkbox"
              :checked="!hiddenColumns.has(column.name)"
              :aria-label="`顯示欄位 ${column.name}`"
              :disabled="stagedCount > 0 || (!hiddenColumns.has(column.name) && visibleColumns.length <= 1)"
              @change="toggleColumn(column.name)"
            >
            <code>{{ column.name }}</code>
          </label>
          <label class="column-width">
            <span>寬度</span>
            <input
              type="number"
              :min="MIN_COLUMN_WIDTH"
              :max="MAX_COLUMN_WIDTH"
              :value="columnWidth(column.name)"
              :aria-label="`欄位 ${column.name} 寬度`"
              :disabled="stagedCount > 0"
              @change="updateColumnWidthFromInput(column.name, $event)"
            >
          </label>
          <div class="column-order-actions">
            <button
              type="button" class="ghost" :aria-label="`欄位 ${column.name} 左移`"
              :disabled="stagedCount > 0 || index === 0" @click="moveColumn(column.name, -1)"
            >←</button>
            <button
              type="button" class="ghost" :aria-label="`欄位 ${column.name} 右移`"
              :disabled="stagedCount > 0 || index === orderedColumns.length - 1" @click="moveColumn(column.name, 1)"
            >→</button>
            <button
              type="button" class="ghost freeze-through" :aria-label="`凍結至欄位 ${column.name}`"
              :disabled="stagedCount > 0 || hiddenColumns.has(column.name)" @click="freezeThrough(column.name)"
            >凍結至此</button>
          </div>
        </li>
      </ul>
      <div class="column-display-actions">
        <button
          type="button" class="ghost"
          :disabled="stagedCount > 0 || columnDisplay.settings.value.frozenCount === 0"
          @click="clearFrozenColumns"
        >解除凍結</button>
        <button type="button" class="ghost" :disabled="stagedCount > 0" @click="resetColumnDisplay">重設欄位設定</button>
      </div>
    </details>
    <div v-if="loading && !result" class="loading">載入中…</div>
    <div class="scroll" @copy="copySelectionEvent" @paste="pasteSelectionEvent">
      <table v-if="result">
        <thead>
          <tr>
            <th
              v-for="c in visibleColumns" :key="c.name"
              :class="{
                sorted: orderBy === c.name,
                locked: stagedCount > 0,
                'frozen-column': isFrozenColumn(c.name),
                'last-frozen-column': isLastFrozenColumn(c.name),
              }"
              :style="columnStyle(c.name)"
              :data-column="c.name"
              :title="stagedCount > 0 ? '請先套用或回復待處理變更' : undefined"
              @click="sort(c.name)"
            >
              {{ c.name }}<span v-if="orderBy === c.name" class="dir">{{ orderDir === 'asc' ? ' ↑' : ' ↓' }}</span>
              <span
                class="column-resizer"
                :class="{ disabled: stagedCount > 0 }"
                aria-hidden="true"
                @pointerdown="startColumnResize($event, c.name)"
                @click.stop
              />
            </th>
            <th class="row-actions-head">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in result.rows" :key="i" :class="{ 'pending-delete': isStagedDelete(row) }">
            <td
              v-for="(c, columnIndex) in visibleColumns"
              :key="c.name"
              :style="columnStyle(c.name)"
              :data-column="c.name"
              :data-selection-row="i"
              :data-selection-column="columnIndex"
              :class="{
                isnull: cellValue(row, c.name) === null,
                editable: canEditCell(c, row, i),
                editing: editor?.rowIndex === i && editor.column === c.name,
                dirty: Boolean(stagedUpdateFor(row, c.name)),
                'selected-cell': isSelectedCell(i, columnIndex),
                'selection-anchor': isSelectionAnchor(i, columnIndex),
                'frozen-column': isFrozenColumn(c.name),
                'last-frozen-column': isLastFrozenColumn(c.name),
              }"
              tabindex="0"
              :aria-selected="isSelectedCell(i, columnIndex) ? 'true' : undefined"
              :title="usesExpandedCell(c, cellValue(row, c.name))
                ? '點擊展開完整內容'
                : canEditCell(c, row, i) ? '拖曳選取；雙擊或按 Enter 編輯' : '拖曳選取'"
              @pointerdown="startCellSelection($event, i, columnIndex)"
              @pointerenter="extendCellSelection(i, columnIndex)"
              @dblclick="activateCell(row, i, c)"
              @keydown="handleCellKeydown($event, i, columnIndex)"
              @keydown.enter.prevent="activateCell(row, i, c)"
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
              <button
                v-else-if="usesExpandedCell(c, cellValue(row, c.name))"
                type="button"
                class="cell-content-trigger"
                :aria-label="c.type === 'binary'
                  ? `開啟 ${c.name} 第 ${offset + i + 1} 列 binary`
                  : `開啟 ${c.name} 第 ${offset + i + 1} 列完整內容`"
                @click.stop="openCellContent(row, i, c)"
                @keydown.stop
              >
                <span>{{ displayValue(cellValue(row, c.name)) }}</span>
                <span aria-hidden="true">↗</span>
              </button>
              <template v-else>{{ displayValue(cellValue(row, c.name)) }}</template>
            </td>
            <td class="row-actions">
              <button
                type="button" class="ghost" :aria-label="`Clone 第 ${offset + i + 1} 列`"
                :disabled="saving || isStagedDelete(row) || isConnectionReadOnly" @click="startInsert(row)"
              >
                Clone
              </button>
              <button
                type="button"
                class="ghost delete-row"
                :aria-label="`刪除第 ${offset + i + 1} 列`"
                :disabled="saving || !canDeleteRow(row, i)"
                @click="prepareDelete(row, i)"
              >刪除</button>
              <span v-if="isStagedDelete(row)" class="dirty-badge">待刪除</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div
      v-if="cellSelection"
      class="cell-selection-toolbar"
      data-testid="cell-selection-toolbar"
      role="group"
      aria-label="儲存格選取工具"
    >
      <strong>已選取 {{ selectedRowCount }} × {{ selectedColumnCount }}・{{ selectedCellCount }} 格</strong>
      <small>拖曳或 Shift＋方向鍵延伸；⌘/Ctrl+C 複製、⌘/Ctrl+V 貼上</small>
      <button type="button" class="ghost" @click="copyCellSelection">複製選取</button>
      <button
        type="button"
        class="ghost"
        :disabled="saving || isConnectionReadOnly"
        @click="pasteCellSelection"
      >貼上</button>
      <button type="button" class="ghost" @click="clearCellSelection">清除選取</button>
    </div>
    <p v-if="selectionMessage" class="selection-message" role="status">{{ selectionMessage }}</p>
    <p v-if="selectionError" class="selection-error" role="alert">{{ selectionError }}</p>
    <BinaryCellDialog
      v-if="activeCellContent?.column.type === 'binary'"
      :key="`${activeCellContent.rowIndex}:${activeCellContent.column.name}:binary`"
      :column="activeCellContent.column"
      :row-number="offset + activeCellContent.rowIndex + 1"
      :value="activeCellContent.value"
      :nullable="activeCellContent.nullable"
      :editable="activeCellContent.editable"
      :downloadable="activeBinaryDownloadable()"
      :downloading="downloadingBinary"
      :download-error="binaryDownloadError"
      @close="activeCellContent = null"
      @download="downloadActiveBinary"
      @preview="prepareCellContentUpdate"
    />
    <CellContentDialog
      v-else-if="activeCellContent"
      :key="`${activeCellContent.rowIndex}:${activeCellContent.column.name}`"
      :column="activeCellContent.column"
      :row-number="offset + activeCellContent.rowIndex + 1"
      :value="activeCellContent.value"
      :nullable="activeCellContent.nullable"
      :editable="activeCellContent.editable"
      @close="activeCellContent = null"
      @preview="prepareCellContentUpdate"
    />
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
        <button type="button" class="write-confirm" :disabled="saving" @click="stageInsert">
          暫存新增
        </button>
      </div>
    </section>
    <section v-if="pendingUpdate" class="write-preview" role="dialog" aria-label="確認資料寫入">
      <strong>確認寫入</strong>
      <p>使用參數化 SQL、原值與 row version；先加入待套用清單，不會立即寫入。</p>
      <pre>{{ pendingUpdate.sql }}</pre>
      <ol>
        <li v-for="(param, index) in pendingUpdate.params" :key="index">
          <code>${{ index + 1 }}</code> = <code>{{ parameterLabel(param) }}</code>
        </li>
      </ol>
      <div class="preview-actions">
        <button type="button" class="ghost" :disabled="saving" @click="pendingUpdate = null">返回修改</button>
        <button type="button" class="write-confirm" :disabled="saving" @click="stageUpdate">
          暫存更新
        </button>
      </div>
    </section>
    <section v-if="pendingDelete" class="write-preview delete-preview" role="dialog" aria-label="確認刪除資料列">
      <strong>確認刪除 1 列</strong>
      <p>刪除只會在完整 primary key／unique key 與 row version 都仍相符時執行。</p>
      <pre>{{ pendingDelete.sql }}</pre>
      <ol>
        <li v-for="(param, index) in pendingDelete.params" :key="index">
          <code>${{ index + 1 }}</code> = <code>{{ parameterLabel(param) }}</code>
        </li>
      </ol>
      <div class="preview-actions">
        <button type="button" class="ghost" :disabled="saving" @click="closeWritePanels">取消</button>
        <button type="button" class="delete-confirm" :disabled="saving" @click="stageDelete">
          暫存刪除
        </button>
      </div>
    </section>
    <section v-if="stagedCount" class="staged-changes" data-testid="staged-changes">
      <div class="staged-head">
        <div>
          <strong>待套用變更・{{ stagedCount }}</strong>
          <p>尚未寫入資料庫；全部套用會使用單一 transaction，任一衝突會整批 rollback。</p>
        </div>
        <span class="dirty-badge">DIRTY</span>
      </div>
      <ol class="staged-list">
        <li
          v-for="change in stagedUpdates"
          :key="`update:${identitySignature(change.identity)}:${change.column}`"
        >
          <strong>更新 {{ identityLabel(change.identity) }}・{{ change.column }}</strong>
          <pre>{{ change.sql }}</pre>
          <small v-for="(param, index) in change.params" :key="index">
            <code>${{ index + 1 }}</code> = <code>{{ parameterLabel(param) }}</code>
          </small>
        </li>
        <li v-for="change in stagedInserts" :key="`insert:${change.id}`">
          <strong>新增資料列</strong>
          <pre>{{ change.sql }}</pre>
          <small v-for="(param, index) in change.params" :key="index">
            <code>${{ index + 1 }}</code> = <code>{{ parameterLabel(param) }}</code>
          </small>
        </li>
        <li v-for="change in stagedDeletes" :key="`delete:${identitySignature(change.identity)}`">
          <strong>刪除 {{ identityLabel(change.identity) }}</strong>
          <pre>{{ change.sql }}</pre>
          <small v-for="(param, index) in change.params" :key="index">
            <code>${{ index + 1 }}</code> = <code>{{ parameterLabel(param) }}</code>
          </small>
        </li>
      </ol>
      <div class="preview-actions">
        <button type="button" class="ghost" :disabled="saving" @click="revertAll">全部回復</button>
        <button type="button" class="write-confirm" :disabled="saving" @click="applyAll">
          {{ saving ? '套用中…' : `全部套用 ${stagedCount} 項` }}
        </button>
      </div>
    </section>
    <div class="pager">
      <button :disabled="offset === 0 || stagedCount > 0" @click="prevPage">上一頁</button>
      <button :disabled="isLastPage || stagedCount > 0" @click="nextPage">下一頁</button>
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
.filter-builder { display: grid; gap: 8px; padding: 10px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--panel-2); }
.filter-builder form { display: grid; gap: 8px; }
.filter-head, .filter-head label, .filter-actions { display: flex; align-items: center; gap: 8px; }
.filter-head { justify-content: space-between; }
.filter-head label span { color: var(--muted); font-size: 11px; }
.filter-conditions { display: grid; gap: 6px; }
.filter-condition { display: grid; grid-template-columns: 22px minmax(120px, 1fr) 110px minmax(100px, 1fr) 30px; align-items: center; gap: 6px; }
.filter-condition select, .filter-condition input { min-width: 0; width: 100%; }
.condition-number { color: var(--muted); font: 11px var(--font-data); text-align: center; }
.no-filter-value { color: var(--muted); font-size: 11px; }
.filter-actions { flex-wrap: wrap; }
.filter-actions button:nth-last-child(2) { margin-left: auto; }
.active-filter { margin: 0; color: var(--glass); font: 11px var(--font-data); overflow-wrap: anywhere; }
.filter-history summary { color: var(--muted); cursor: pointer; font-size: 12px; }
.filter-history ul { display: grid; gap: 5px; margin: 7px 0; padding: 0; list-style: none; }
.filter-history li { display: grid; grid-template-columns: minmax(0, 1fr) auto 30px; align-items: center; gap: 6px; }
.history-filter { min-width: 0; overflow: hidden; text-align: left; text-overflow: ellipsis; white-space: nowrap; }
.filter-history time { color: var(--muted); font: 10px var(--font-data); }
.remove-filter { padding-inline: 7px; color: var(--muted); }
.clear-filter-history { font-size: 11px; }

.column-display { padding: 8px 10px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--panel-2); }
.column-display summary { color: var(--glass); cursor: pointer; font-size: 12px; }
.column-display > p { margin: 8px 0; color: var(--muted); font-size: 11px; }
.column-display ul { display: grid; gap: 5px; margin: 0; padding: 0; list-style: none; }
.column-display li { display: grid; grid-template-columns: minmax(140px, 1fr) 130px auto; align-items: center; gap: 8px; padding: 5px 0; border-bottom: 1px solid var(--line); }
.column-display li:last-child { border-bottom: 0; }
.column-visible, .column-width, .column-order-actions, .column-display-actions { display: flex; align-items: center; gap: 6px; }
.column-visible code { overflow: hidden; text-overflow: ellipsis; }
.column-width { color: var(--muted); font-size: 11px; }
.column-width input { width: 76px; }
.column-order-actions { justify-content: flex-end; }
.column-order-actions button { padding-inline: 8px; }
.freeze-through { min-width: 76px; }
.column-display-actions { justify-content: flex-end; margin-top: 8px; }

.cell-selection-toolbar { display: flex; align-items: center; gap: 8px; padding: 7px 9px; border: 1px solid var(--brass); border-radius: var(--radius); background: var(--panel-2); }
.cell-selection-toolbar strong { color: var(--brass); font: 12px var(--font-data); }
.cell-selection-toolbar small { flex: 1; color: var(--muted); font-size: 11px; }
.cell-selection-toolbar button { white-space: nowrap; }
.selection-message, .selection-error { margin: 0; font-size: 12px; }
.selection-message { color: #86b98d; }
.selection-error { color: var(--danger); }

.scroll { overflow-x: auto; border: 1px solid var(--line); border-radius: var(--radius); }
table {
  border-collapse: collapse;
  width: max-content;
  min-width: 100%;
  table-layout: fixed;
  font-family: var(--font-data);
  font-size: 13px;
}
th, td {
  box-sizing: border-box;
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
  z-index: 3;
  background: var(--panel-2);
  color: var(--glass); /* column names in lens-glass blue */
  font-weight: 500;
  cursor: pointer;
  user-select: none;
}
.column-resizer { position: absolute; top: 0; right: 0; bottom: 0; width: 8px; cursor: col-resize; touch-action: none; }
.column-resizer::after { content: ''; position: absolute; top: 20%; right: 2px; bottom: 20%; width: 1px; background: var(--line); }
.column-resizer:hover::after { background: var(--brass); }
.column-resizer.disabled { cursor: not-allowed; }
.frozen-column { position: sticky; left: var(--frozen-left); z-index: 2; background: var(--panel); }
th.frozen-column { z-index: 4; background: var(--panel-2); }
.last-frozen-column { box-shadow: inset -1px 0 var(--brass); }
th.sorted { color: var(--brass); }
th.locked { cursor: not-allowed; }
.row-actions-head { cursor: default; }
.dir { font-size: 11px; }
tbody tr:hover { background: var(--brass-soft); }
tbody tr:hover td.frozen-column { background: var(--panel-2); }
tbody tr:last-child td { border-bottom: none; }
tbody td:not(.row-actions) { user-select: none; }
.isnull { color: var(--muted); font-style: italic; }
.dirty { background: var(--brass-soft); box-shadow: inset 3px 0 var(--brass); }
.selected-cell, tbody tr:hover .selected-cell { background: color-mix(in srgb, var(--brass) 18%, var(--panel)); box-shadow: inset 0 0 0 1px var(--brass); }
.selected-cell.frozen-column, tbody tr:hover .selected-cell.frozen-column { background: color-mix(in srgb, var(--brass) 18%, var(--panel)); }
.selection-anchor { box-shadow: inset 0 0 0 2px var(--brass); }
.pending-delete td:not(.row-actions) { opacity: 0.55; text-decoration: line-through; }
.editable { cursor: text; }
.editable:focus { outline: 1px solid var(--brass); outline-offset: -2px; }
.editing { z-index: 5; overflow: visible; min-width: 320px; background: var(--panel-2); }
.editing:not(.frozen-column) { position: relative; }
.cell-editor { display: flex; align-items: center; gap: 6px; color: var(--text); font-style: normal; }
.cell-editor > input[type="text"], .cell-editor > input:not([type]) { min-width: 120px; flex: 1; }
.cell-editor label { display: flex; align-items: center; gap: 3px; font-size: 11px; }
.cell-content-trigger { display: inline-flex; max-width: 100%; align-items: center; gap: 7px; padding: 0; border: 0; background: transparent; color: inherit; font: inherit; }
.cell-content-trigger span:first-child { overflow: hidden; text-overflow: ellipsis; }
.cell-content-trigger span:last-child { color: var(--brass); font-size: 10px; }
.cell-content-trigger:hover { border: 0; background: transparent; color: var(--brass); }
.row-actions { display: flex; gap: 4px; overflow: visible; max-width: none; }
.delete-row { color: var(--danger); }
.dirty-badge { color: var(--brass); font: 10px var(--font-data); letter-spacing: 0.08em; }

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

.staged-changes { display: grid; gap: 10px; padding: 12px; border: 1px solid var(--brass); border-radius: var(--radius); background: var(--panel-2); }
.staged-head { display: flex; justify-content: space-between; gap: 12px; }
.staged-head p { margin: 3px 0 0; color: var(--muted); font-size: 12px; }
.staged-list { display: grid; gap: 8px; margin: 0; padding-left: 24px; }
.staged-list li { display: grid; gap: 5px; }
.staged-list pre { margin: 0; padding: 8px; overflow-x: auto; background: var(--ink); color: var(--text); font: 11px var(--font-data); }
.staged-list small { color: var(--muted); font-family: var(--font-data); }

.pager { display: flex; gap: 8px; align-items: center; }
.meta { margin-left: auto; font-family: var(--font-data); font-size: 12px; color: var(--muted); }

@media (max-width: 720px) {
  .filter-condition { grid-template-columns: 22px minmax(0, 1fr) 96px 30px; }
  .filter-condition input, .no-filter-value { grid-column: 2 / 4; }
  .filter-actions button:nth-last-child(2) { margin-left: 0; }
  .filter-history li { grid-template-columns: minmax(0, 1fr) 30px; }
  .filter-history time { display: none; }
  .column-display li { grid-template-columns: minmax(0, 1fr) 112px; }
  .column-order-actions { grid-column: 1 / 3; justify-content: flex-start; padding-left: 24px; }
  .cell-selection-toolbar { flex-wrap: wrap; }
  .cell-selection-toolbar small { flex-basis: 100%; order: 2; }
  .insert-field { grid-template-columns: 1fr; }
}
</style>
