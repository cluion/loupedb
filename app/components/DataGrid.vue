<script setup lang="ts">
import type { QueryResult, BrowseOpts } from '#shared/types'

const props = defineProps<{ connectionId: string; schema: string; table: string }>()
const { browse } = useQuery(props.connectionId)

const result = ref<QueryResult | null>(null)
const error = ref<string | null>(null)
const limit = ref(50)
const offset = ref(0)
const orderBy = ref<string | undefined>(undefined)
const orderDir = ref<'asc' | 'desc'>('asc')
// minimal single-condition filter - multi-condition is a future extension
const filterColumn = ref('')
const filterOp = ref<'=' | '!=' | '>' | '<' | 'like'>('=')
const filterValue = ref('')

// no total count in mvp (spec section 6): a short page means the last page
const isLastPage = computed(() => (result.value?.rows.length ?? 0) < limit.value)

async function load() {
  error.value = null
  const filter: BrowseOpts['filter'] = filterColumn.value
    ? [{ column: filterColumn.value, op: filterOp.value, value: filterValue.value }]
    : undefined
  const r = await browse(props.schema, props.table, {
    limit: limit.value, offset: offset.value,
    orderBy: orderBy.value, orderDir: orderDir.value, filter,
  })
  if (r.ok) result.value = r.data
  else error.value = r.error.message
}

watch(() => [props.schema, props.table], () => { offset.value = 0; load() }, { immediate: true })

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
</script>

<template>
  <div class="grid">
    <div v-if="error" role="alert">{{ error }}</div>
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
    </form>
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
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in result.rows" :key="i">
            <td v-for="c in result.columns" :key="c.name" :class="{ isnull: row[c.name] === null }">
              {{ row[c.name] === null ? 'NULL' : row[c.name] }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="pager">
      <button :disabled="offset === 0" @click="prevPage">上一頁</button>
      <button :disabled="isLastPage" @click="nextPage">下一頁</button>
      <span v-if="result" class="meta">{{ offset + 1 }}–{{ offset + result.rows.length }} 列・{{ Math.round(result.executionMs) }} ms</span>
    </div>
  </div>
</template>

<style scoped>
.grid { display: flex; flex-direction: column; gap: 10px; }
.toolbar { display: flex; gap: 8px; }
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
.dir { font-size: 11px; }
tbody tr:hover { background: var(--brass-soft); }
tbody tr:last-child td { border-bottom: none; }
.isnull { color: var(--muted); font-style: italic; }

.pager { display: flex; gap: 8px; align-items: center; }
.meta { margin-left: auto; font-family: var(--font-data); font-size: 12px; color: var(--muted); }
</style>
