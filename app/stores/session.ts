export const SESSION_STORAGE_KEY = 'loupedb:session:v1'

interface PersistedSession {
  readonly id: string
  readonly name: string | null
}

function persistSession(session: PersistedSession | null): void {
  if (!import.meta.client) return
  if (session) localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
  else localStorage.removeItem(SESSION_STORAGE_KEY)
}

export function useSession() {
  const currentConnectionId = useState<string | null>('conn-id', () => null)
  const currentConnectionName = useState<string | null>('conn-name', () => null)
  return {
    currentConnectionId,
    currentConnectionName,
    setCurrentConnection: (id: string | null, name: string | null = null) => {
      currentConnectionId.value = id
      currentConnectionName.value = id ? name : null
      persistSession(id ? { id, name } : null)
    },
    restoreSession: (): string | null => {
      if (!import.meta.client) return null
      try {
        const raw = localStorage.getItem(SESSION_STORAGE_KEY)
        if (!raw) return null
        const value = JSON.parse(raw) as Partial<PersistedSession>
        if (typeof value.id !== 'string' || !value.id || (value.name !== null && typeof value.name !== 'string')) {
          throw new Error('invalid persisted session')
        }
        currentConnectionId.value = value.id
        currentConnectionName.value = value.name
        return value.id
      } catch {
        localStorage.removeItem(SESSION_STORAGE_KEY)
        return null
      }
    },
  }
}
