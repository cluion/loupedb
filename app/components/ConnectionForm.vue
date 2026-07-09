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
  <form class="conn-form" @submit.prevent="submit">
    <input v-model="form.name" class="full" placeholder="連線名稱" required>
    <input v-model="form.host" placeholder="host" required>
    <input v-model.number="form.port" type="number" placeholder="port">
    <input v-model="form.database" class="full" placeholder="database（選填，預設 postgres）">
    <input v-model="form.username" placeholder="username" required>
    <input v-model="form.password" type="password" placeholder="password" required>
    <!-- SSL mode always offered (spec 4.5.2); auto = server resolves by host -->
    <select v-model="form.ssl" class="full" aria-label="SSL mode">
      <option value="auto">SSL: 自動判斷</option>
      <option value="disable">disable</option>
      <option value="prefer">prefer</option>
      <option value="require">require</option>
      <option value="verify-full">verify-full</option>
    </select>
    <button type="submit" class="primary full">連線</button>
    <p v-if="error" role="alert" class="full">{{ error }}</p>
  </form>
</template>

<style scoped>
.conn-form {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.full { grid-column: 1 / -1; }
</style>
