import type { BinaryCellSummary, BinaryCellUpload } from './types'

export const MAX_BINARY_UPLOAD_BYTES = 8 * 1024 * 1024

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function isBinaryCellSummary(value: unknown): value is BinaryCellSummary {
  return isRecord(value)
    && value.$loupedb === 'binary'
    && Number.isSafeInteger(value.byteLength)
    && Number(value.byteLength) >= 0
    && typeof value.checksum === 'string'
    && /^[0-9a-f]{32}$/u.test(value.checksum)
}

export function isBinaryCellUpload(value: unknown): value is BinaryCellUpload {
  if (!isRecord(value)
    || value.$loupedb !== 'binary-upload'
    || !Number.isSafeInteger(value.byteLength)
    || Number(value.byteLength) < 0
    || Number(value.byteLength) > MAX_BINARY_UPLOAD_BYTES
    || typeof value.base64 !== 'string'
    || typeof value.fileName !== 'string'
    || value.fileName.length > 255
    || typeof value.mediaType !== 'string'
    || value.mediaType.length > 255) return false

  const byteLength = Number(value.byteLength)
  if (value.base64.length !== 4 * Math.ceil(byteLength / 3)) return false
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value.base64)) {
    return false
  }
  const remainder = byteLength % 3
  if (remainder === 1) return value.base64.endsWith('==')
  if (remainder === 2) return value.base64.endsWith('=') && !value.base64.endsWith('==')
  return !value.base64.endsWith('=')
}

export function isBinaryCellValue(value: unknown): value is BinaryCellSummary | BinaryCellUpload {
  return isBinaryCellSummary(value) || isBinaryCellUpload(value)
}
