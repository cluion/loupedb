<script setup lang="ts">
// unlock screen when LOUPEDB_APP_PASSWORD is enabled - the password lives in a
// cookie because EventSource (SSE) cannot send custom headers
const emit = defineEmits<{ unlocked: [] }>()
const pw = useCookie<string | null>('loupedb_app_pw', { sameSite: 'strict' })
const input = ref('')

function submit() {
  pw.value = input.value
  emit('unlocked')
}
</script>

<template>
  <form class="gate" @submit.prevent="submit">
    <input v-model="input" type="password" placeholder="App 密碼" required>
    <button type="submit" class="primary">解鎖</button>
  </form>
</template>

<style scoped>
.gate {
  display: flex;
  gap: 10px;
}
.gate input { flex: 1; }
</style>
