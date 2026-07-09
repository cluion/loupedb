<script setup lang="ts">
const { currentConnectionId, setCurrentConnectionId } = useSession()
const locked = ref(false)

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
  <div v-else-if="!currentConnectionId">
    <ConnectionList @connect="(id) => setCurrentConnectionId(id)" />
  </div>
  <div v-else>
    <!-- main workspace assembled in P3-T8 -->
    <p>已連線:{{ currentConnectionId }}(主介面待組裝)</p>
  </div>
</template>
