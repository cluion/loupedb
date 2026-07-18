import type { ConnectionEnvironment, ConnectionSafetyMode } from './types'
import { listSqlStatements } from './sqlStatements'

const ENVIRONMENTS: ReadonlySet<string> = new Set(['development', 'staging', 'production'])
const SAFETY_MODES: ReadonlySet<string> = new Set(['normal', 'safe', 'read-only'])
const READ_ONLY_COMMANDS: ReadonlySet<string> = new Set(['SELECT', 'SHOW', 'VALUES', 'TABLE', 'EXPLAIN'])
const DANGEROUS_COMMANDS: ReadonlySet<string> = new Set(['UPDATE', 'DELETE', 'DROP', 'TRUNCATE'])
const NESTED_WRITE_COMMANDS: ReadonlySet<string> = new Set(['INSERT', 'UPDATE', 'DELETE', 'MERGE'])
const WITH_COMMANDS: ReadonlySet<string> = new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MERGE'])

export function isConnectionEnvironment(value: unknown): value is ConnectionEnvironment {
  return typeof value === 'string' && ENVIRONMENTS.has(value)
}

export function isConnectionSafetyMode(value: unknown): value is ConnectionSafetyMode {
  return typeof value === 'string' && SAFETY_MODES.has(value)
}

export function defaultSafetyMode(environment: ConnectionEnvironment): ConnectionSafetyMode {
  return environment === 'production' ? 'safe' : 'normal'
}

function sqlWords(source: string, topLevelOnly: boolean): string[] {
  const words: string[] = []
  let depth = 0
  let i = 0
  while (i < source.length) {
    const char = source[i]!
    const next = source[i + 1]
    if (char === '-' && next === '-') {
      i += 2
      while (i < source.length && source[i] !== '\n') i++
      continue
    }
    if (char === '/' && next === '*') {
      i += 2
      let commentDepth = 1
      while (i < source.length && commentDepth) {
        if (source[i] === '/' && source[i + 1] === '*') { commentDepth++; i += 2 }
        else if (source[i] === '*' && source[i + 1] === '/') { commentDepth--; i += 2 }
        else i++
      }
      continue
    }
    if (char === "'") {
      i++
      while (i < source.length) {
        if (source[i] === '\\') { i += 2; continue }
        if (source[i] === "'" && source[i + 1] === "'") { i += 2; continue }
        if (source[i++] === "'") break
      }
      continue
    }
    if (char === '"') {
      i++
      while (i < source.length) {
        if (source[i] === '"' && source[i + 1] === '"') { i += 2; continue }
        if (source[i++] === '"') break
      }
      continue
    }
    if (char === '$') {
      const tag = source.slice(i).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/u)?.[0]
      if (tag) {
        const closing = source.indexOf(tag, i + tag.length)
        i = closing < 0 ? source.length : closing + tag.length
        continue
      }
    }
    if (char === '(') { depth++; i++; continue }
    if (char === ')') { depth = Math.max(0, depth - 1); i++; continue }
    if (/[A-Za-z_]/u.test(char)) {
      let end = i + 1
      while (end < source.length && /[A-Za-z0-9_$]/u.test(source[end]!)) end++
      if (!topLevelOnly || depth === 0) words.push(source.slice(i, end).toUpperCase())
      i = end
      continue
    }
    i++
  }
  return words
}

export function sqlStatementCommand(statement: string): string | null {
  const words = sqlWords(statement, true)
  const first = words[0]
  if (!first) return null
  if (first !== 'WITH') return first
  return words.slice(1).find((word) => WITH_COMMANDS.has(word)) ?? first
}

export function sqlCommands(source: string): ReadonlyArray<string> {
  const ranges = listSqlStatements(source)
  return ranges
    .map((range) => sqlStatementCommand(source.slice(range.from, range.to)))
    .filter((command): command is string => command !== null)
}

export function dangerousSqlCommands(source: string): ReadonlyArray<string> {
  const ranges = listSqlStatements(source)
  return [...new Set(ranges.flatMap((range) => (
    sqlWords(source.slice(range.from, range.to), false)
      .filter((command) => DANGEROUS_COMMANDS.has(command))
  )))]
}

export function isPotentiallyWritingSql(source: string): boolean {
  const commands = sqlCommands(source)
  if (commands.some((command) => !READ_ONLY_COMMANDS.has(command))) return true
  return listSqlStatements(source).some((range) => (
    sqlWords(source.slice(range.from, range.to), false)
      .some((command) => NESTED_WRITE_COMMANDS.has(command))
  ))
}

export function isDangerousSqlCommand(command: string): boolean {
  return DANGEROUS_COMMANDS.has(command.toUpperCase())
}
