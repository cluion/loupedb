import type postgres from 'postgres'
import type { DatabaseFunctionInfo, DatabaseInfo, SchemaInfo, TableColumnInfo, TableInfo, TableSchema, ColumnInfo, ForeignKeyInfo, UniqueKeyInfo } from '#shared/types'
import { normalizePgType } from '../../core/normalizer'

type Sql = ReturnType<typeof postgres>

// any pg connection can list the server's databases even though it can only
// read the one it is bound to - the ui opens sibling sessions to browse others
export async function listDatabases(sql: Sql): Promise<ReadonlyArray<DatabaseInfo>> {
  const rows = await sql`
    select datname as name from pg_database
    where datistemplate = false and datallowconn = true
    order by datname`
  return rows.map((r) => ({ name: String(r.name) }))
}

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

// every column of every base table in one round trip - autocomplete metadata
export async function listColumns(sql: Sql, schema: string): Promise<ReadonlyArray<TableColumnInfo>> {
  const rows = await sql`
    select c.table_name as tbl, c.column_name as name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = ${schema} and t.table_type = 'BASE TABLE'
    order by c.table_name, c.ordinal_position`
  return rows.map((r) => ({ table: String(r.tbl), name: String(r.name) }))
}

export async function listFunctions(sql: Sql, schema: string): Promise<ReadonlyArray<DatabaseFunctionInfo>> {
  const rows = await sql`
    select p.proname as name,
           pg_get_function_identity_arguments(p.oid) as arguments,
           pg_get_function_result(p.oid) as result_type,
           p.prokind as kind
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = ${schema}
      and p.prokind in ('f', 'a', 'w')
      and has_function_privilege(p.oid, 'EXECUTE')
    order by p.proname, pg_get_function_identity_arguments(p.oid)`
  return rows.map((r) => ({
    schema,
    name: String(r.name),
    arguments: String(r.arguments ?? ''),
    resultType: String(r.result_type),
    kind: r.kind === 'a' ? 'aggregate' : r.kind === 'w' ? 'window' : 'function',
  }))
}

export async function listUniqueKeys(sql: Sql, schema: string, table: string): Promise<ReadonlyArray<UniqueKeyInfo>> {
  const rows = await sql`
    select index_class.relname as name,
           attribute.attname as col
    from pg_class table_class
    join pg_namespace namespace on namespace.oid = table_class.relnamespace
    join pg_index index_meta on index_meta.indrelid = table_class.oid
    join pg_class index_class on index_class.oid = index_meta.indexrelid
    join lateral unnest(index_meta.indkey) with ordinality as key_column(attnum, position)
      on key_column.position <= index_meta.indnkeyatts
    join pg_attribute attribute
      on attribute.attrelid = table_class.oid and attribute.attnum = key_column.attnum
    where namespace.nspname = ${schema}
      and table_class.relname = ${table}
      and index_meta.indisunique
      and not index_meta.indisprimary
      and index_meta.indisvalid
      and index_meta.indisready
      and index_meta.indpred is null
      and index_meta.indexprs is null
    order by index_class.relname, key_column.position`
  const keys = new Map<string, string[]>()
  for (const row of rows) {
    const name = String(row.name)
    const columns = keys.get(name) ?? []
    columns.push(String(row.col))
    keys.set(name, columns)
  }
  return [...keys].map(([name, columns]) => ({ name, columns }))
}

export async function describeTable(sql: Sql, schema: string, table: string): Promise<TableSchema> {
  // udt_name gives pg internal type names (int4, timestamptz, _int4 for arrays)
  // pg_type.typtype = 'e' marks custom enum types
  const colRows = await sql`
    select c.column_name as name,
           c.udt_name as native,
           c.is_nullable = 'YES' as nullable,
           c.is_updatable = 'YES' as editable,
           c.is_generated = 'NEVER' and c.is_identity = 'NO' as insertable,
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
      nullable: Boolean(r.nullable), editable: Boolean(r.editable),
      insertable: Boolean(r.insertable),
      defaultValue: r.col_default ?? undefined,
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
  const uniqueKeys = await listUniqueKeys(sql, schema, table)

  const fkRows = await sql`
    select con.conname as name, pg_get_constraintdef(con.oid) as def
    from pg_constraint con
    join pg_class cls on cls.oid = con.conrelid
    join pg_namespace n on n.oid = cls.relnamespace
    where n.nspname = ${schema} and cls.relname = ${table} and con.contype = 'f'`
  const foreignKeys: ForeignKeyInfo[] = fkRows.map((r) => parseFkDef(String(r.name), String(r.def), schema))

  return { schema, table, columns, primaryKey, uniqueKeys, foreignKeys }
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
