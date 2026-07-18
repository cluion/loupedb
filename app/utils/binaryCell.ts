import type { BinaryCellUpload } from '#shared/types'
import { MAX_BINARY_UPLOAD_BYTES, isBinaryCellSummary, isBinaryCellUpload } from '#shared/binaryCell'

export function formatBinaryBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

export function binaryCellLabel(value: unknown): string {
  if (value === null) return 'NULL'
  if (isBinaryCellSummary(value)) return `BINARY · ${formatBinaryBytes(value.byteLength)}`
  if (isBinaryCellUpload(value)) return `BINARY · ${formatBinaryBytes(value.byteLength)} · ${value.fileName}`
  return 'BINARY'
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(String(reader.result)))
    reader.addEventListener('error', () => reject(reader.error ?? new Error('無法讀取檔案')))
    reader.readAsDataURL(file)
  })
}

export async function fileToBinaryUpload(file: File): Promise<BinaryCellUpload> {
  if (file.size > MAX_BINARY_UPLOAD_BYTES) {
    throw new Error(`檔案不可超過 ${formatBinaryBytes(MAX_BINARY_UPLOAD_BYTES)}`)
  }
  const dataUrl = await readDataUrl(file)
  const separator = dataUrl.indexOf(',')
  if (separator < 0) throw new Error('無法讀取檔案內容')
  const value: BinaryCellUpload = {
    $loupedb: 'binary-upload',
    base64: dataUrl.slice(separator + 1),
    byteLength: file.size,
    fileName: file.name.slice(0, 255),
    mediaType: file.type.slice(0, 255),
  }
  if (!isBinaryCellUpload(value)) throw new Error('檔案內容格式無效')
  return value
}
