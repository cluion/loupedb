<script setup lang="ts">
const { currentConnectionId, setCurrentConnectionId } = useSession()
const locked = ref(false)
const selected = ref<{ schema: string; table: string } | null>(null)

// probe the app password gate (server middleware): 401 = unlock needed
onMounted(async () => {
  try {
    await $fetch('/api/connections')
  } catch (err) {
    if ((err as { statusCode?: number }).statusCode === 401) locked.value = true
  }
})
</script>

<template>
  <AppPasswordGate v-if="locked" @unlocked="locked = false; refreshNuxtData()" />
  <ConnectionList v-else-if="!currentConnectionId" @connect="(id) => setCurrentConnectionId(id)" />
  <div v-else class="layout">
    <!-- [DESIGN] 主介面版面由使用者設計 -->
    <SchemaTree
      :connection-id="currentConnectionId"
      @select-table="(s, t) => selected = { schema: s, table: t }"
    />
    <div v-if="selected">
      <DataGrid :connection-id="currentConnectionId" :schema="selected.schema" :table="selected.table" />
      <StreamResult :connection-id="currentConnectionId" :schema="selected.schema" :table="selected.table" />
    </div>
    <SqlEditor :connection-id="currentConnectionId" />
  </div>
</template>
