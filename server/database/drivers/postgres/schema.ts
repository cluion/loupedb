import type postgres from 'postgres'
import type { SchemaInfo, TableInfo, TableSchema, ColumnInfo, ForeignKeyInfo } from '#shared/types'
import { normalizePgType } from '../../core/normalizer'

type Sql = ReturnType<typeof postgres>

export async function listSchemas(sql: Sql): Promise<ReadonlyArray<SchemaInfo>> {
  const rows = await sql`
    select schema_name as name from information_schema.schemata
    where schema_name not like 'pg_%' and schema_name <> 'information_schema'
    order by schema_name`
  return rows.map((r) => ({ name: String(r.name) }))
}

export async function listTables(sql: Sql, schema: string): Promise<ReadonlyArray<TableInfo>> {
  const rows = await sql`
    select table_name as name from information_schema.tables
    where table_schema = ${schema} and table_type = 'BASE TABLE'
    order by table_name`
  return rows.map((r) => ({ schema, name: String(r.name) }))
}

export async function describeTable(sql: Sql, schema: string, table: string): Promise<TableSchema> {
  // udt_name gives pg internal type names (int4, timestamptz, _int4 for arrays)
  // pg_type.typtype = 'e' marks custom enum types
  const colRows = await sql`
    select c.column_name as name,
           c.udt_name as native,
           c.is_nullable = 'YES' as nullable,
           c.column_default as col_default,
           t.typtype as type_kind
    from information_schema.columns c
    join pg_type t on t.typname = c.udt_name
    join pg_namespace tn on tn.oid = t.typnamespace and tn.nspname = c.udt_schema
    where c.table_schema = ${schema} and c.table_name = ${table}
    order by c.ordinal_position`
  const columns: ColumnInfo[] = colRows.map((r) => {
    const native = String(r.native)
    const type = r.type_kind === 'e' ? 'enum' as const : normalizePgType(native)
    return {
      name: String(r.name), nativeType: native, type,
      nullable: Boolean(r.nullable), defaultValue: r.col_default ?? undefined,
    }
  })

  const pkRows = await sql`
    select kcu.column_name as col from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
    where tc.table_schema = ${schema} and tc.table_name = ${table}
      and tc.constraint_type = 'PRIMARY KEY'
    order by kcu.ordinal_position`
  const primaryKey = pkRows.map((r) => String(r.col))

  const fkRows = await sql`
    select con.conname as name, pg_get_constraintdef(con.oid) as def
    from pg_constraint con
    join pg_class cls on cls.oid = con.conrelid
    join pg_namespace n on n.oid = cls.relnamespace
    where n.nspname = ${schema} and cls.relname = ${table} and con.contype = 'f'`
  const foreignKeys: ForeignKeyInfo[] = fkRows.map((r) => parseFkDef(String(r.name), String(r.def), schema))

  return { schema, table, columns, primaryKey, foreignKeys }
}

// parses pg_get_constraintdef output like:
//   FOREIGN KEY (a, b) REFERENCES other.t2(c, d)
//   FOREIGN KEY (a) REFERENCES t2(c)          <- schema omitted when on search_path
function parseFkDef(name: string, def: string, fallbackSchema: string): ForeignKeyInfo {
  const m = def.match(/FOREIGN KEY \(([^)]+)\) REFERENCES (?:"?([\w$]+)"?\.)?"?([\w$]+)"?\s*\(([^)]+)\)/i)
  if (!m) return { name, columns: [], referencesSchema: '', referencesTable: '', referencesColumns: [] }
  const [, cols, refSchema, refTable, refCols] = m
  const split = (s: string) => s.split(',').map((x) => x.trim().replace(/^"|"$/g, ''))
  return {
    name,
    columns: split(cols!),
    referencesSchema: refSchema ?? fallbackSchema,
    referencesTable: refTable!,
    referencesColumns: split(refCols!),
  }
}
