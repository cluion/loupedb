<script setup lang="ts">
import type { TableSchema } from '#shared/types'

const props = defineProps<{ connectionId: string; schema: string; table: string }>()
const { describe } = useSchema(props.connectionId)

const info = ref<TableSchema | null>(null)
const error = ref<string | null>(null)

async function load() {
  error.value = null
  const r = await describe(props.schema, props.table)
  if (r.ok) info.value = r.data
  else error.value = r.error.message
}
watch(() => [props.schema, props.table], load, { immediate: true })

function fkTarget(colName: string): string | null {
  const fk = info.value?.foreignKeys.find(f => f.columns.includes(colName))
  if (!fk) return null
  return `${fk.referencesSchema}.${fk.referencesTable}(${fk.referencesColumns.join(', ')})`
}
</script>

<template>
  <div>
    <p v-if="error" role="alert">{{ error }}</p>
    <div v-if="!info && !error" class="loading">載入中…</div>
    <div v-if="info" class="scroll">
      <table>
        <thead>
          <tr><th>欄位</th><th>型別</th><th>Nullable</th><th>預設值</th><th>鍵</th></tr>
        </thead>
        <tbody>
          <tr v-for="c in info.columns" :key="c.name">
            <td class="colname">{{ c.name }}</td>
            <td><span class="native">{{ c.nativeType }}</span> <span class="norm">{{ c.type }}</span></td>
            <td :class="{ muted: !c.nullable }">{{ c.nullable ? 'null' : 'not null' }}</td>
            <td class="muted">{{ c.defaultValue ?? '—' }}</td>
            <td>
              <span v-if="info.primaryKey.includes(c.name)" class="badge pk">PK</span>
              <span v-if="fkTarget(c.name)" class="badge fk">FK → {{ fkTarget(c.name) }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.loading { color: var(--muted); font-size: 13px; }
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
}
th { background: var(--panel-2); color: var(--glass); font-weight: 500; }
tbody tr:last-child td { border-bottom: none; }
.colname { font-weight: 600; }
.native { color: var(--text); }
.norm { color: var(--muted); font-size: 11px; }
.muted { color: var(--muted); }
.badge {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 3px;
  margin-right: 6px;
}
.badge.pk { background: var(--brass-soft); color: var(--brass); }
.badge.fk { background: rgba(127, 180, 201, 0.14); color: var(--glass); }
</style>
