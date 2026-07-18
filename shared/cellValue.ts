import { isBinaryCellUpload, isBinaryCellValue } from './binaryCell'

const MAX_CELL_VALUE_DEPTH = 100

export function isCellMutationValue(value: unknown): boolean {
  const seen = new WeakSet<object>()

  const visit = (candidate: unknown, depth: number): boolean => {
    if (candidate === null || typeof candidate === 'string' || typeof candidate === 'boolean') return true
    if (typeof candidate === 'number') return Number.isFinite(candidate)
    if (!candidate || typeof candidate !== 'object' || depth >= MAX_CELL_VALUE_DEPTH) return false
    if (isBinaryCellValue(candidate)) return true
    if ('$loupedb' in candidate
      && (candidate.$loupedb === 'binary-upload' || candidate.$loupedb === 'binary')) {
      return isBinaryCellUpload(candidate)
    }
    if (seen.has(candidate)) return false
    seen.add(candidate)
    if (Array.isArray(candidate)) return candidate.every((entry) => visit(entry, depth + 1))
    const prototype = Object.getPrototypeOf(candidate)
    return (prototype === Object.prototype || prototype === null)
      && Object.values(candidate).every((entry) => visit(entry, depth + 1))
  }

  return visit(value, 0)
}
