import type { NormalizedType } from '#shared/types'

const PG_TYPE_MAP: Readonly<Record<string, NormalizedType>> = {
  integer: 'integer', int2: 'integer', int4: 'integer', int8: 'integer',
  bigint: 'integer', smallint: 'integer', serial: 'integer', bigserial: 'integer',
  numeric: 'decimal', decimal: 'decimal', money: 'decimal', real: 'decimal',
  float4: 'decimal', float8: 'decimal', 'double precision': 'decimal',
  'character varying': 'string', varchar: 'string', character: 'string',
  char: 'string', bpchar: 'string', text: 'string', name: 'string',
  boolean: 'boolean', bool: 'boolean',
  jsonb: 'json', json: 'json',
  uuid: 'uuid',
  timestamp: 'datetime', timestamptz: 'datetime',
  'timestamp without time zone': 'datetime', 'timestamp with time zone': 'datetime',
  date: 'date',
  time: 'time', timetz: 'time', 'time without time zone': 'time',
  bytea: 'binary', blob: 'binary',
}

export function normalizePgType(native: string): NormalizedType {
  const key = native.toLowerCase()
  const mapped = PG_TYPE_MAP[key]
  if (mapped) return mapped
  if (key.startsWith('_')) return 'array' // PG array types use underscore prefix
  // custom types (enum etc) are resolved by the schema layer via pg_type kind
  return 'unknown'
}
