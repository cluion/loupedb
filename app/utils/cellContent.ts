import type { NormalizedType } from '#shared/types'

export const LARGE_TEXT_THRESHOLD = 120

function canonicalCellValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalCellValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalCellValue(entry)]))
  }
  return value
}

export function cellContentValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  try {
    return JSON.stringify(canonicalCellValue(left)) === JSON.stringify(canonicalCellValue(right))
  } catch {
    return false
  }
}

export function usesCellContentDialog(type: NormalizedType, value: unknown): boolean {
  if (type === 'json' || type === 'array') return true
  return type === 'string'
    && typeof value === 'string'
    && (value.length > LARGE_TEXT_THRESHOLD || /[\r\n]/u.test(value))
}

export function cellContentText(type: NormalizedType, value: unknown): string {
  if (value === null) return ''
  if (type === 'json' || type === 'array') {
    const formatted = JSON.stringify(value, null, 2)
    return formatted ?? String(value)
  }
  return String(value)
}

export function parseCellContent(type: NormalizedType, text: string): unknown {
  if (type !== 'json' && type !== 'array') return text
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(type === 'array' ? '請輸入有效的 JSON array' : '請輸入有效的 JSON')
  }
  if (type === 'array' && !Array.isArray(parsed)) throw new Error('PostgreSQL array 必須使用 JSON array 格式')
  return parsed
}

export function cellContentKindLabel(type: NormalizedType): string {
  if (type === 'json') return 'JSON'
  if (type === 'array') return 'ARRAY'
  return 'LARGE TEXT'
}
