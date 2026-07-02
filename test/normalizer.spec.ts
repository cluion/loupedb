import { describe, it, expect } from 'vitest'
import { normalizePgType } from '../server/database/core/normalizer'

describe('normalizePgType', () => {
  it.each([
    ['integer', 'integer'],
    ['bigint', 'integer'],
    ['smallint', 'integer'],
    ['numeric', 'decimal'],
    ['text', 'string'],
    ['varchar', 'string'],
    ['boolean', 'boolean'],
    ['jsonb', 'json'],
    ['json', 'json'],
    ['uuid', 'uuid'],
    ['timestamp', 'datetime'],
    ['timestamptz', 'datetime'],
    ['date', 'date'],
    ['time', 'time'],
    ['bytea', 'binary'],
    ['_int4', 'array'],
    ['_text', 'array'],
    ['user_status', 'unknown'], // 自訂型別由 schema 層判斷 enum, normalizer 回 unknown
    ['weird_unmapped_type', 'unknown'],
  ])('%s -> %s', (native, expected) => {
    expect(normalizePgType(native)).toBe(expected)
  })
})
