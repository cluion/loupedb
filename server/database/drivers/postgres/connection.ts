import postgres from 'postgres'
import type { ConnectionConfig, QueryMessage, QueryMessageSeverity } from '#shared/types'

type Sql = ReturnType<typeof postgres>

interface ConnectionSlot {
  readonly sql: Sql
  readonly messages: QueryMessage[]
}

interface SlotWaiter {
  readonly resolve: (slot: ConnectionSlot) => void
  readonly reject: (cause: Error) => void
}

export interface PostgresSession {
  readonly sql: Sql
  takeMessages(): ReadonlyArray<QueryMessage>
  release(): void
}

export interface PostgresHandle {
  run<T>(operation: (sql: Sql) => Promise<T>): Promise<T>
  reserve(): Promise<PostgresSession>
  close(): Promise<void>
}

function messageSeverity(value: string | undefined): QueryMessageSeverity {
  const severity = value?.toLowerCase()
  if (severity === 'debug' || severity === 'info' || severity === 'log' || severity === 'warning') {
    return severity
  }
  return 'notice'
}

function queryMessage(notice: Record<string, string>): QueryMessage {
  return {
    severity: messageSeverity(notice.severity),
    message: notice.message ?? 'PostgreSQL notice',
    ...(notice.code ? { code: notice.code } : {}),
    ...(notice.detail ? { detail: notice.detail } : {}),
    ...(notice.hint ? { hint: notice.hint } : {}),
    ...(notice.where ? { context: notice.where } : {}),
  }
}

// connection status is NOT stored here: module-level state would be shared
// across all driver instances - each driver holds status in its own closure
export function createConnection(config: ConnectionConfig): PostgresHandle {
  const ssl = config.ssl === 'disable' ? false : config.ssl
  const slots: ConnectionSlot[] = Array.from({ length: 3 }, () => {
    const messages: QueryMessage[] = []
    const sql = postgres({
      host: config.host, port: config.port, database: config.database,
      username: config.username, password: config.password, ssl,
      max: 1, idle_timeout: 1800, connect_timeout: 10,
      connection: { statement_timeout: 30000, application_name: 'loupedb' },
      onnotice: (notice) => { messages.push(queryMessage(notice)) },
    })
    return { sql, messages }
  })
  const available = [...slots]
  const waiters: SlotWaiter[] = []
  let closed = false

  async function reserve(): Promise<PostgresSession> {
    if (closed) throw new Error('connection closed')
    const slot = available.shift() ?? await new Promise<ConnectionSlot>((resolve, reject) => {
      waiters.push({ resolve, reject })
    })
    slot.messages.length = 0
    let released = false
    return {
      sql: slot.sql,
      takeMessages() {
        return slot.messages.splice(0)
      },
      release() {
        if (released) return
        released = true
        slot.messages.length = 0
        if (closed) return
        const waiter = waiters.shift()
        if (waiter) waiter.resolve(slot)
        else available.push(slot)
      },
    }
  }

  return {
    reserve,
    async run<T>(operation: (sql: Sql) => Promise<T>): Promise<T> {
      const session = await reserve()
      try {
        return await operation(session.sql)
      } finally {
        session.release()
      }
    },
    async close() {
      closed = true
      const cause = new Error('connection closed')
      while (waiters.length) waiters.shift()!.reject(cause)
      await Promise.all(slots.map((slot) => slot.sql.end({ timeout: 5 })))
    },
  }
}
