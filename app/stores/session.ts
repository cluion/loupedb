import type { QueryResult } from '#shared/types'

export function useSession() {
  const currentConnectionId = useState<string | null>('conn-id', () => null)
  const queryResult = useState<QueryResult | null>('query-result', () => null)
  return {
    currentConnectionId,
    setCurrentConnectionId: (id: string | null) => { currentConnectionId.value = id },
    queryResult,
    setQueryResult: (r: QueryResult | null) => { queryResult.value = r },
  }
}
