<script setup lang="ts">
const emit = defineEmits<{ connect: [id: string, name: string] }>()
const { list, openSaved, removeSaved } = useConnections()
const { data, refresh } = await useAsyncData('conns', () => list())
const error = ref<string | null>(null)

// reconnect via POST /api/connections/open - no password re-entry needed
async function reconnect(name: string) {
  error.value = null
  const res = await openSaved(name)
  if (res.ok) emit('connect', res.data.id, name)
  else error.value = res.error.message
}

async function forget(name: string) {
  error.value = null
  const res = await removeSaved(name)
  if (res.ok) await refresh()
  else error.value = res.error.message
}
</script>

<template>
  <div>
    <ConnectionForm @created="async (id, name) => { await refresh(); emit('connect', id, name) }" />
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="data?.ok && data.data.length">
      <p class="eyebrow saved-label">已存連線</p>
      <ul class="saved">
        <li v-for="c in data.data" :key="c.name">
          <button class="connect-btn" @click="reconnect(c.name)"><span class="ring small" /> {{ c.name }}</button>
          <button class="ghost forget" :aria-label="`刪除已存連線 ${c.name}`" @click="forget(c.name)">×</button>
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.saved-label { margin-top: 22px; }
.saved {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.saved li { display: flex; gap: 6px; }
.saved .connect-btn {
  flex: 1;
  text-align: left;
  font-family: var(--font-data);
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 9px;
}
.forget { padding: 7px 10px; }
.forget:hover { color: var(--danger); }
.ring.small { width: 9px; height: 9px; border-width: 2px; opacity: 0.75; }
.saved .connect-btn:hover .ring.small { opacity: 1; }
</style>
