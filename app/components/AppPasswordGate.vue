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
  <form @submit.prevent="submit">
    <!-- [DESIGN] 樣式由使用者設計 -->
    <input v-model="input" type="password" placeholder="App 密碼" required>
    <button type="submit">解鎖</button>
  </form>
</template>
