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
    <!-- [DESIGN] 版面與樣式由使用者設計 -->
    <ConnectionForm @created="async (id) => { await refresh(); emit('connect', id) }" />
    <p v-if="error" role="alert">{{ error }}</p>
    <ul>
      <li v-for="c in (data?.ok ? data.data : [])" :key="c.name">
        <button @click="reconnect(c.name)">{{ c.name }}</button>
      </li>
    </ul>
  </div>
</template>
