<script setup lang="ts">
import type { QueryResult } from '#shared/types'
import {
  EXPORT_FORMATS,
  exportFilename,
  exportResult,
  type ExportFormat,
} from '../utils/resultExport'

const props = defineProps<{ result: QueryResult }>()

const format = ref<ExportFormat>('csv')
const copied = ref(false)
const copyError = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | undefined

async function copy() {
  copyError.value = false
  try {
    await navigator.clipboard.writeText(exportResult(props.result, format.value))
    copied.value = true
    clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => { copied.value = false }, 1600)
  } catch {
    copyError.value = true // clipboard needs a secure context; download still works
  }
}

function download() {
  const info = EXPORT_FORMATS.find((f) => f.format === format.value)!
  const blob = new Blob([exportResult(props.result, format.value)], { type: `${info.mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = exportFilename(format.value)
  a.click()
  URL.revokeObjectURL(url)
}

onUnmounted(() => clearTimeout(copiedTimer))
</script>

<template>
  <div class="result-export">
    <select v-model="format" aria-label="匯出格式">
      <option v-for="f in EXPORT_FORMATS" :key="f.format" :value="f.format">{{ f.label }}</option>
    </select>
    <button type="button" class="ghost" aria-label="複製結果" @click="copy">
      {{ copied ? '已複製' : '複製' }}
    </button>
    <button type="button" class="ghost" aria-label="下載結果" @click="download">下載</button>
    <span v-if="copyError" role="alert" class="copy-error">無法存取剪貼簿</span>
  </div>
</template>

<style scoped>
.result-export { display: flex; align-items: center; gap: 4px; }
.result-export select { padding: 3px 6px; font: 12px var(--font-data); }
.copy-error { color: var(--danger); font-size: 12px; }
</style>
