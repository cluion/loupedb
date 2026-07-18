<script setup lang="ts">
import type { ConnectionEnvironment, ConnectionSafetyMode, ConnectionSessionInfo, SslMode } from '#shared/types'
import { defaultSafetyMode } from '#shared/connectionSafety'

const emit = defineEmits<{ created: [session: ConnectionSessionInfo] }>()
const { create } = useConnections()
const form = reactive({
  name: '', host: '', port: 5432, database: '', username: '', password: '',
  ssl: 'auto' as SslMode | 'auto',
  environment: 'development' as ConnectionEnvironment,
  safetyMode: 'normal' as ConnectionSafetyMode,
})
const error = ref<string | null>(null)

watch(() => form.environment, (environment) => {
  form.safetyMode = defaultSafetyMode(environment)
})

async function submit() {
  error.value = null
  const res = await create({ ...form })
  if (res.ok) emit('created', res.data)
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
    <select v-model="form.environment" aria-label="連線環境">
      <option value="development">Development</option>
      <option value="staging">Staging</option>
      <option value="production">Production</option>
    </select>
    <select v-model="form.safetyMode" aria-label="安全模式">
      <option value="normal">Normal・一般模式</option>
      <option value="safe">Safe・危險操作需確認</option>
      <option value="read-only">Read-only・禁止寫入</option>
    </select>
    <p v-if="form.environment === 'production'" class="full safety-hint">
      Production 預設使用 Safe mode；也可改為 Read-only
    </p>
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
.safety-hint { margin: 0; color: var(--brass); font-size: 12px; }
</style>
