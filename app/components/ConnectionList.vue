<script setup lang="ts">
const emit = defineEmits<{ connect: [id: string] }>()
const { list, openSaved } = useConnections()
const { data, refresh } = await useAsyncData('conns', () => list())
const error = ref<string | null>(null)

// reconnect via POST /api/connections/open - no password re-entry needed
async function reconnect(name: string) {
  error.value = null
  const res = await openSaved(name)
  if (res.ok) emit('connect', res.data.id)
  else error.value = res.error.message
}
</script>

<template>
  <div>
    <ConnectionForm @created="async (id) => { await refresh(); emit('connect', id) }" />
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="data?.ok && data.data.length">
      <p class="eyebrow saved-label">已存連線</p>
      <ul class="saved">
        <li v-for="c in data.data" :key="c.name">
          <button @click="reconnect(c.name)"><span class="ring small" /> {{ c.name }}</button>
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
.saved button {
  width: 100%;
  text-align: left;
  font-family: var(--font-data);
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 9px;
}
.ring.small { width: 9px; height: 9px; border-width: 2px; opacity: 0.75; }
.saved button:hover .ring.small { opacity: 1; }
</style>
