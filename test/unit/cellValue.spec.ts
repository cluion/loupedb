import { describe, expect, it } from 'vitest'
import { isCellMutationValue } from '../../shared/cellValue'

describe('isCellMutationValue', () => {
  it('accepts scalar, JSON object and array cell values', () => {
    expect(isCellMutationValue(null)).toBe(true)
    expect(isCellMutationValue('text')).toBe(true)
    expect(isCellMutationValue({ nested: [1, true, null, { label: 'x' }] })).toBe(true)
  })

  it('rejects non-JSON, cyclic and excessively deep values', () => {
    expect(isCellMutationValue(undefined)).toBe(false)
    expect(isCellMutationValue(new Date())).toBe(false)
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(isCellMutationValue(cyclic)).toBe(false)
    let deep: Record<string, unknown> = {}
    const root = deep
    for (let index = 0; index < 101; index++) deep = deep.next = {}
    expect(isCellMutationValue(root)).toBe(false)
  })
})
