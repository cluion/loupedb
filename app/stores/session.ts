import type { ConnectionEnvironment, ConnectionSafetyMode, ConnectionSessionInfo } from '#shared/types'
import { defaultSafetyMode, isConnectionEnvironment, isConnectionSafetyMode } from '#shared/connectionSafety'

export const SESSION_STORAGE_KEY = 'loupedb:session:v1'

type PersistedSession = ConnectionSessionInfo

function persistSession(session: PersistedSession | null): void {
  if (!import.meta.client) return
  if (session) localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
  else localStorage.removeItem(SESSION_STORAGE_KEY)
}

export function useSession() {
  const currentConnectionId = useState<string | null>('conn-id', () => null)
  const currentConnectionName = useState<string | null>('conn-name', () => null)
  const currentConnectionEnvironment = useState<ConnectionEnvironment>('conn-environment', () => 'development')
  const currentConnectionSafetyMode = useState<ConnectionSafetyMode>('conn-safety-mode', () => 'normal')
  return {
    currentConnectionId,
    currentConnectionName,
    currentConnectionEnvironment,
    currentConnectionSafetyMode,
    setCurrentConnection: (session: ConnectionSessionInfo | null) => {
      currentConnectionId.value = session?.id ?? null
      currentConnectionName.value = session?.name ?? null
      currentConnectionEnvironment.value = session?.environment ?? 'development'
      currentConnectionSafetyMode.value = session?.safetyMode ?? 'normal'
      persistSession(session)
    },
    restoreSession: (): string | null => {
      if (!import.meta.client) return null
      try {
        const raw = localStorage.getItem(SESSION_STORAGE_KEY)
        if (!raw) return null
        const value = JSON.parse(raw) as Partial<PersistedSession>
        if (typeof value.id !== 'string' || !value.id || typeof value.name !== 'string') {
          throw new Error('invalid persisted session')
        }
        const environment = isConnectionEnvironment(value.environment) ? value.environment : 'development'
        const safetyMode = isConnectionSafetyMode(value.safetyMode)
          ? value.safetyMode
          : defaultSafetyMode(environment)
        currentConnectionId.value = value.id
        currentConnectionName.value = value.name
        currentConnectionEnvironment.value = environment
        currentConnectionSafetyMode.value = safetyMode
        return value.id
      } catch {
        localStorage.removeItem(SESSION_STORAGE_KEY)
        return null
      }
    },
  }
}
