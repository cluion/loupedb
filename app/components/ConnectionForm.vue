<script setup lang="ts">
import type { SslMode } from '#shared/types'

const emit = defineEmits<{ created: [id: string] }>()
const { create } = useConnections()
const form = reactive({
  name: '', host: '', port: 5432, database: '', username: '', password: '',
  ssl: 'auto' as SslMode | 'auto',
})
const error = ref<string | null>(null)

async function submit() {
  error.value = null
  const res = await create({ ...form })
  if (res.ok) emit('created', res.data.id)
  else error.value = res.error.message
}
</script>

<template>
  <form @submit.prevent="submit">
    <!-- [DESIGN] 欄位排版與樣式由使用者設計 -->
    <input v-model="form.name" placeholder="連線名稱" required>
    <input v-model="form.host" placeholder="host" required>
    <input v-model.number="form.port" type="number" placeholder="port">
    <input v-model="form.database" placeholder="database" required>
    <input v-model="form.username" placeholder="username" required>
    <input v-model="form.password" type="password" placeholder="password" required>
    <!-- SSL mode always offered (spec 4.5.2); auto = server resolves by host -->
    <select v-model="form.ssl" aria-label="SSL mode">
      <option value="auto">SSL: 自動判斷</option>
      <option value="disable">disable</option>
      <option value="prefer">prefer</option>
      <option value="require">require</option>
      <option value="verify-full">verify-full</option>
    </select>
    <button type="submit">連線</button>
    <p v-if="error" role="alert">{{ error }}</p>
  </form>
</template>
