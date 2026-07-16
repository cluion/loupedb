import { buildSqlNamespace, type SqlNamespace } from '../utils/sqlCompletion'

// completion metadata is an enhancement: failures leave the namespace null
// and the editor simply falls back to keyword-only completion
export function useSqlCompletion(connId: string) {
  const namespace = useState<SqlNamespace | null>(`sql-completion:${connId}`, () => null)
  const loading = useState<boolean>(`sql-completion-loading:${connId}`, () => false)

  async function ensureLoaded(): Promise<void> {
    if (namespace.value || loading.value) return
    loading.value = true
    try {
      const api = useSchema(connId)
      const schemas = await api.schemas()
      if (!schemas.ok) return
      const metadata = await Promise.all(schemas.data.map(async (s) => {
        const [tables, columns] = await Promise.all([api.tables(s.name), api.columns(s.name)])
        return {
          schema: s.name,
          tables: tables.ok ? tables.data : [],
          columns: columns.ok ? columns.data : [],
        }
      }))
      namespace.value = buildSqlNamespace(metadata)
    } finally {
      loading.value = false
    }
  }

  return { namespace, ensureLoaded }
}
