import type { ConnectionConfig } from '#shared/types'
import { dangerousSqlCommands, isDangerousSqlCommand, isPotentiallyWritingSql } from '#shared/connectionSafety'

function safetyError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code, severity: 'ERROR' })
}

export function assertSqlAllowed(
  config: ConnectionConfig,
  source: string,
  confirmedDangerous = false,
): void {
  if (config.safetyMode === 'read-only' && isPotentiallyWritingSql(source)) {
    throw safetyError('READ_ONLY_MODE', 'connection is read-only')
  }
  const commands = dangerousSqlCommands(source)
  if (config.safetyMode === 'safe' && commands.length && !confirmedDangerous) {
    throw safetyError(
      'SAFETY_CONFIRMATION_REQUIRED',
      `safe mode requires confirmation for ${commands.join(', ')}`,
    )
  }
}

export function assertMutationAllowed(
  config: ConnectionConfig,
  command: 'INSERT' | 'UPDATE' | 'DELETE',
  confirmedDangerous = false,
): void {
  if (config.safetyMode === 'read-only') {
    throw safetyError('READ_ONLY_MODE', 'connection is read-only')
  }
  if (config.safetyMode === 'safe' && isDangerousSqlCommand(command) && !confirmedDangerous) {
    throw safetyError('SAFETY_CONFIRMATION_REQUIRED', `safe mode requires confirmation for ${command}`)
  }
}
