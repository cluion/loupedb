import type { DatabaseError } from '#shared/types'

// driver error messages may embed credentials - strip connection strings and
// password fragments before anything reaches a response or log (spec 4.5.5)
function redact(message: string): string {
  return message
    .replace(/postgres(ql)?:\/\/\S+/gi, '[redacted-connection-string]')
    .replace(/password[=:]\s*\S+/gi, 'password=[redacted]')
}

export function toDatabaseError(err: unknown): DatabaseError {
  if (err && typeof err === 'object' && 'code' in err && 'message' in err) {
    const e = err as { code: string; message: string; severity?: string }
    const sev = (e.severity ?? 'ERROR').toLowerCase()
    return {
      code: String(e.code),
      message: redact(String(e.message)),
      severity: sev.includes('fatal') ? 'fatal' : sev.includes('warn') ? 'warning' : 'error',
      retryable: String(e.code).startsWith('08'), // class 08 = connection errors
    }
  }
  const msg = err instanceof Error ? err.message : String(err)
  return { code: 'UNKNOWN', message: redact(msg), severity: 'error', retryable: false }
}
