<script setup lang="ts">
import type { ColumnInfo } from '#shared/types'
import {
  cellContentKindLabel,
  cellContentText,
  parseCellContent,
} from '../utils/cellContent'

const props = defineProps<{
  column: ColumnInfo
  rowNumber: number
  value: unknown
  nullable: boolean
  editable: boolean
}>()
const emit = defineEmits<{
  close: []
  preview: [value: unknown]
}>()

const text = ref(cellContentText(props.column.type, props.value))
const useNull = ref(props.value === null)
const error = ref<string | null>(null)
const copyMessage = ref<string | null>(null)
const isStructured = computed(() => props.column.type === 'json' || props.column.type === 'array')

function parsedValue(): unknown {
  if (useNull.value) return null
  return parseCellContent(props.column.type, text.value)
}

function format() {
  error.value = null
  try {
    text.value = cellContentText(props.column.type, parsedValue())
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}

function preview() {
  if (!props.editable) return
  error.value = null
  try {
    emit('preview', parsedValue())
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}

async function copy() {
  try {
    await navigator.clipboard.writeText(useNull.value ? 'NULL' : text.value)
    copyMessage.value = '已複製完整內容'
    error.value = null
  } catch {
    error.value = '無法寫入剪貼簿'
  }
}
</script>

<template>
  <div class="content-backdrop" @click.self="emit('close')">
    <form
      class="content-dialog"
      role="dialog"
      aria-modal="true"
      :aria-label="`${editable ? '檢視與編輯' : '檢視'} ${column.name} 第 ${rowNumber} 列`"
      @submit.prevent="preview"
      @keydown.esc.prevent="emit('close')"
    >
      <header>
        <div>
          <span class="kind">{{ cellContentKindLabel(column.type) }}</span>
          <strong>{{ column.name }}・第 {{ rowNumber }} 列</strong>
          <small>{{ column.nativeType }}</small>
        </div>
        <button type="button" class="close" :aria-label="`關閉 ${column.name} 內容`" @click="emit('close')">×</button>
      </header>
      <p v-if="!editable" class="readonly-note">
        此儲存格沒有安全 row identity、屬於鍵欄位或連線為 Read-only，目前僅供檢視
      </p>
      <textarea
        v-model="text"
        :aria-label="`${column.name} 完整內容`"
        :readonly="!editable || useNull"
        :class="{ structured: isStructured }"
        autofocus
        spellcheck="false"
      />
      <div class="content-meta">
        <span>{{ useNull ? 'NULL' : `${text.length} 字元` }}</span>
        <label v-if="editable" class="null-toggle">
          <input v-model="useNull" type="checkbox" :disabled="!nullable">
          NULL
        </label>
      </div>
      <p v-if="error" class="content-error" role="alert">{{ error }}</p>
      <p v-if="copyMessage" class="copy-message" role="status">{{ copyMessage }}</p>
      <footer>
        <button type="button" class="ghost" @click="copy">複製完整內容</button>
        <button
          v-if="isStructured && editable"
          type="button"
          class="ghost"
          :disabled="useNull"
          @click="format"
        >格式化</button>
        <span />
        <button type="button" class="ghost" @click="emit('close')">{{ editable ? '取消' : '關閉' }}</button>
        <button v-if="editable" type="submit">預覽寫入</button>
      </footer>
    </form>
  </div>
</template>

<style scoped>
.content-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(10, 14, 18, 0.76);
}
.content-dialog {
  display: grid;
  gap: 10px;
  width: min(760px, 100%);
  max-height: calc(100vh - 40px);
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--panel);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
}
header, header > div, footer, .content-meta, .null-toggle { display: flex; align-items: center; gap: 8px; }
header { justify-content: space-between; }
header small { color: var(--muted); font: 10px var(--font-data); }
.kind { padding: 2px 6px; border: 1px solid var(--brass); border-radius: 999px; color: var(--brass); font: 10px var(--font-data); }
.close { padding: 4px 9px; color: var(--muted); }
.readonly-note { margin: 0; color: var(--muted); font-size: 12px; }
textarea {
  box-sizing: border-box;
  width: 100%;
  min-height: min(420px, 55vh);
  resize: vertical;
  white-space: pre-wrap;
  font: 13px/1.55 var(--font-data);
}
textarea.structured { tab-size: 2; }
textarea[readonly] { color: var(--muted); }
.content-meta { justify-content: space-between; color: var(--muted); font-size: 11px; }
.content-error, .copy-message { margin: 0; font-size: 12px; }
.content-error { color: var(--danger); }
.copy-message { color: #86b98d; }
footer { justify-content: flex-end; }
footer span { flex: 1; }

@media (max-width: 640px) {
  .content-backdrop { padding: 8px; }
  .content-dialog { max-height: calc(100vh - 16px); padding: 12px; }
  header > div { align-items: flex-start; flex-direction: column; gap: 3px; }
  textarea { min-height: 48vh; }
  footer { flex-wrap: wrap; }
  footer span { display: none; }
}
</style>
