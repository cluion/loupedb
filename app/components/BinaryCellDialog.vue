<script setup lang="ts">
import type { BinaryCellUpload, ColumnInfo } from '#shared/types'
import { MAX_BINARY_UPLOAD_BYTES, isBinaryCellSummary, isBinaryCellUpload } from '#shared/binaryCell'
import { binaryCellLabel, fileToBinaryUpload, formatBinaryBytes } from '../utils/binaryCell'

const props = defineProps<{
  column: ColumnInfo
  rowNumber: number
  value: unknown
  nullable: boolean
  editable: boolean
  downloadable: boolean
  downloading: boolean
  downloadError: string | null
}>()
const emit = defineEmits<{
  close: []
  download: []
  preview: [value: BinaryCellUpload | null]
}>()

const selected = ref<BinaryCellUpload | null>(isBinaryCellUpload(props.value) ? props.value : null)
const useNull = ref(props.value === null)
const error = ref<string | null>(null)
const reading = ref(false)
const currentSummary = computed(() => isBinaryCellSummary(props.value) ? props.value : null)

async function selectFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  reading.value = true
  error.value = null
  try {
    selected.value = await fileToBinaryUpload(file)
    useNull.value = false
  } catch (cause) {
    selected.value = null
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    reading.value = false
  }
}

function preview() {
  if (!props.editable || reading.value) return
  error.value = null
  if (useNull.value) {
    emit('preview', null)
    return
  }
  if (!selected.value) {
    error.value = '請先選擇要上傳的檔案'
    return
  }
  emit('preview', selected.value)
}
</script>

<template>
  <div class="binary-backdrop" @click.self="emit('close')">
    <form
      class="binary-dialog"
      role="dialog"
      aria-modal="true"
      :aria-label="`${editable ? '檢視與編輯' : '檢視'} ${column.name} 第 ${rowNumber} 列 binary`"
      @submit.prevent="preview"
      @keydown.esc.prevent="emit('close')"
    >
      <header>
        <div>
          <span class="kind">BINARY</span>
          <strong>{{ column.name }}・第 {{ rowNumber }} 列</strong>
          <small>{{ column.nativeType }}</small>
        </div>
        <button type="button" class="close" :aria-label="`關閉 ${column.name} binary`" @click="emit('close')">×</button>
      </header>

      <p v-if="!editable" class="readonly-note">
        此儲存格沒有安全 row identity、屬於鍵欄位或連線為 Read-only，目前不可上傳
      </p>
      <section class="binary-summary" data-testid="binary-summary">
        <strong>{{ binaryCellLabel(value) }}</strong>
        <template v-if="currentSummary">
          <span>{{ formatBinaryBytes(currentSummary.byteLength) }}</span>
          <small>MD5 {{ currentSummary.checksum }}</small>
        </template>
        <span v-else-if="value === null">目前沒有 binary 內容</span>
        <span v-else-if="selected">已暫存 {{ selected.fileName }}</span>
      </section>

      <section v-if="editable" class="binary-upload">
        <label>
          <span>選擇上傳檔案</span>
          <input
            type="file"
            :aria-label="`${column.name} 上傳檔案`"
            :disabled="reading || useNull"
            @change="selectFile"
          >
          <small>單檔上限 {{ formatBinaryBytes(MAX_BINARY_UPLOAD_BYTES) }}；選取後先進入 staged changes</small>
        </label>
        <div v-if="selected" class="selected-file" data-testid="selected-binary-file">
          <strong>{{ selected.fileName }}</strong>
          <span>{{ formatBinaryBytes(selected.byteLength) }}</span>
          <small>{{ selected.mediaType || 'application/octet-stream' }}</small>
        </div>
        <label class="null-toggle">
          <input v-model="useNull" type="checkbox" :disabled="!nullable || reading">
          設定為 NULL
        </label>
      </section>

      <p v-if="error || downloadError" class="binary-error" role="alert">
        {{ error ?? downloadError }}
      </p>
      <footer>
        <button
          type="button"
          class="ghost"
          :disabled="!downloadable || downloading"
          @click="emit('download')"
        >{{ downloading ? '下載中…' : '下載原始內容' }}</button>
        <span />
        <button type="button" class="ghost" @click="emit('close')">{{ editable ? '取消' : '關閉' }}</button>
        <button v-if="editable" type="submit" :disabled="reading">
          {{ reading ? '讀取中…' : '預覽寫入' }}
        </button>
      </footer>
    </form>
  </div>
</template>

<style scoped>
.binary-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(10, 14, 18, 0.76);
}
.binary-dialog {
  display: grid;
  gap: 12px;
  width: min(620px, 100%);
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--panel);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
}
header, header > div, footer, .null-toggle { display: flex; align-items: center; gap: 8px; }
header { justify-content: space-between; }
header small { color: var(--muted); font: 10px var(--font-data); }
.kind { padding: 2px 6px; border: 1px solid var(--brass); border-radius: 999px; color: var(--brass); font: 10px var(--font-data); }
.close { padding: 4px 9px; color: var(--muted); }
.readonly-note, .binary-error { margin: 0; font-size: 12px; }
.readonly-note { color: var(--muted); }
.binary-error { color: var(--danger); }
.binary-summary, .binary-upload, .binary-upload label, .selected-file {
  display: grid;
  gap: 6px;
}
.binary-summary, .binary-upload {
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--panel-2);
}
.binary-summary span, .binary-summary small, .selected-file span, .selected-file small {
  color: var(--muted);
  font: 11px var(--font-data);
  overflow-wrap: anywhere;
}
.binary-upload input[type="file"] { width: 100%; }
.null-toggle { display: flex !important; font-size: 12px; }
footer { justify-content: flex-end; }
footer span { flex: 1; }

@media (max-width: 640px) {
  .binary-backdrop { padding: 8px; }
  .binary-dialog { padding: 12px; }
  header > div { align-items: flex-start; flex-direction: column; gap: 3px; }
  footer { flex-wrap: wrap; }
  footer span { display: none; }
}
</style>
