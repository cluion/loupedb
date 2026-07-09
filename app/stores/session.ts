import type { QueryResult } from '#shared/types'

export function useSession() {
  const currentConnectionId = useState<string | null>('conn-id', () => null)
  const currentConnectionName = useState<string | null>('conn-name', () => null)
  const queryResult = useState<QueryResult | null>('query-result', () => null)
  return {
    currentConnectionId,
    currentConnectionName,
    setCurrentConnection: (id: string | null, name: string | null = null) => {
      currentConnectionId.value = id
      currentConnectionName.value = id ? name : null
    },
    queryResult,
    setQueryResult: (r: QueryResult | null) => { queryResult.value = r },
  }
}
