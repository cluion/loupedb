<script setup lang="ts">
const props = defineProps<{ connectionId: string }>()
const { execute } = useQuery(props.connectionId)
const { queryResult, setQueryResult } = useSession()

const sql = ref('SELECT * FROM ')
const error = ref<string | null>(null)
const running = ref(false)

async function run() {
  error.value = null
  running.value = true
  const r = await execute(sql.value)
  running.value = false
  if (r.ok) setQueryResult(r.data)
  else error.value = r.error.message
}
</script>

<template>
  <div class="editor">
    <!-- plain textarea for mvp; CodeMirror/Monaco is a future upgrade -->
    <textarea v-model="sql" rows="6" spellcheck="false" />
    <div class="actions">
      <button class="primary" :disabled="running" @click="run">{{ running ? '執行中…' : '執行' }}</button>
      <span v-if="queryResult" class="meta">
        {{ queryResult.rows.length }} 列・{{ Math.round(queryResult.executionMs) }} ms
      </span>
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
textarea { width: 100%; }
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
