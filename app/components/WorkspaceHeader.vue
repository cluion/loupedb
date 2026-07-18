<script setup lang="ts">
import type { ConnectionEnvironment, ConnectionSafetyMode } from '#shared/types'

defineProps<{
  connectionLabel: string
  environment: ConnectionEnvironment
  safetyMode: ConnectionSafetyMode
}>()
const emit = defineEmits<{ disconnect: [] }>()

const environmentLabel = {
  development: 'DEVELOPMENT', staging: 'STAGING', production: 'PRODUCTION',
} as const

const safetyLabel = {
  normal: 'NORMAL', safe: 'SAFE MODE', 'read-only': 'READ-ONLY',
} as const
</script>

<template>
  <header class="bar">
    <span class="wordmark"><span class="ring" /> LoupeDB</span>
    <span class="conn">
      <span class="dot" aria-hidden="true" />
      {{ connectionLabel }}
    </span>
    <span :class="['badge', 'environment', environment]">{{ environmentLabel[environment] }}</span>
    <span :class="['badge', 'safety', safetyMode]">{{ safetyLabel[safetyMode] }}</span>
    <button class="ghost" @click="emit('disconnect')">中斷連線</button>
  </header>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--line);
  background: var(--panel);
}
.conn {
  margin-left: auto;
  font-family: var(--font-data);
  font-size: 12px;
  color: var(--muted);
  display: inline-flex;
  align-items: center;
  gap: 7px;
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--brass);
}
.badge {
  padding: 3px 6px;
  border: 1px solid var(--line);
  border-radius: 999px;
  font: 9px var(--font-data);
  letter-spacing: 0.08em;
}
.environment.development { border-color: #557a5b; color: #86b98d; }
.environment.staging, .safety.safe { border-color: var(--brass); color: var(--brass); }
.environment.production, .safety.read-only { border-color: var(--danger); color: var(--danger); }
.safety.normal { color: var(--muted); }
</style>
