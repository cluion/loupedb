<script setup lang="ts">
const props = defineProps<{ connectionId: string; schema: string; table: string }>()
const { streamUrl, cancel } = useQuery(props.connectionId)

const rows = ref<ReadonlyArray<Record<string, unknown>>>([])
const error = ref<string | null>(null)
let es: EventSource | null = null
let qid = ''

function start() {
  es?.close() // restarting drops the previous stream
  rows.value = []
  error.value = null
  qid = crypto.randomUUID()
  // qid goes into the url so the server registers the stream in activeQueries -
  // without it the cancel endpoint has nothing to abort
  es = new EventSource(streamUrl(props.schema, props.table, qid))
  es.onmessage = (e) => {
    const batch = JSON.parse(e.data) as unknown
    if (Array.isArray(batch)) {
      rows.value = [...rows.value, ...batch]
    } else if (batch && typeof batch === 'object' && 'error' in batch) {
      error.value = String((batch as { error: unknown }).error)
      es?.close()
    }
  }
  es.onerror = () => { es?.close() }
}

function stop() {
  es?.close()
  void cancel(qid)
}

onUnmounted(() => es?.close())
</script>

<template>
  <div class="stream">
    <button @click="start">串流載入</button>
    <button class="ghost" @click="stop">取消</button>
    <span class="count">已載入 {{ rows.length }} 列</span>
    <p v-if="error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.stream {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  margin-top: 10px;
}
.count { font-family: var(--font-data); font-size: 12px; color: var(--muted); }
</style>
