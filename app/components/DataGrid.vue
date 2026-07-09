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
  <div>
    <!-- [DESIGN] grid 與 filter 列樣式由使用者設計 -->
    <div v-if="error" role="alert">{{ error }}</div>
    <form @submit.prevent="applyFilter">
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
    <table v-if="result">
      <thead>
        <tr><th v-for="c in result.columns" :key="c.name" @click="sort(c.name)">{{ c.name }}</th></tr>
      </thead>
      <tbody>
        <tr v-for="(row, i) in result.rows" :key="i">
          <td v-for="c in result.columns" :key="c.name">{{ row[c.name] }}</td>
        </tr>
      </tbody>
    </table>
    <button :disabled="offset === 0" @click="prevPage">上一頁</button>
    <button :disabled="isLastPage" @click="nextPage">下一頁</button>
  </div>
</template>
