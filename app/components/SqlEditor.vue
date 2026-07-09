<script setup lang="ts">
const props = defineProps<{ connectionId: string }>()
const { execute } = useQuery(props.connectionId)
const { setQueryResult } = useSession()

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
  <div>
    <!-- [DESIGN] 編輯器樣式由使用者設計; 進階版可換 CodeMirror/Monaco -->
    <textarea v-model="sql" rows="6" />
    <button :disabled="running" @click="run">{{ running ? '執行中…' : '執行' }}</button>
    <p v-if="error" role="alert">{{ error }}</p>
  </div>
</template>
