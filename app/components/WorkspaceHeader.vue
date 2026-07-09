<script setup lang="ts">
defineProps<{ connectionLabel: string }>()
const emit = defineEmits<{ disconnect: [] }>()
</script>

<template>
  <header class="bar">
    <span class="wordmark"><span class="ring" /> LoupeDB</span>
    <span class="conn">
      <span class="dot" aria-hidden="true" />
      {{ connectionLabel }}
    </span>
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
</style>
