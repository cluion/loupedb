// @vitest-environment nuxt
import { describe, it, expect } from 'vitest'
import { listSqlStatements, resolveRunnableSql } from '../../app/utils/sqlStatements'

describe('listSqlStatements', () => {
  it('splits a script into per-statement ranges', () => {
    const doc = 'select 1;\nselect 2;'
    const ranges = listSqlStatements(doc)
    expect(ranges).toHaveLength(2)
    expect(doc.slice(ranges[0]!.from, ranges[0]!.to)).toBe('select 1;')
    expect(doc.slice(ranges[1]!.from, ranges[1]!.to)).toBe('select 2;')
  })

  it('ignores semicolons inside string literals', () => {
    const doc = "select 'a;b' as v;\nselect 2;"
    const ranges = listSqlStatements(doc)
    expect(ranges).toHaveLength(2)
    expect(doc.slice(ranges[0]!.from, ranges[0]!.to)).toBe("select 'a;b' as v;")
  })

  it('ignores semicolons inside comments', () => {
    const doc = 'select 1 -- not a boundary ;\n, 2;\nselect 3;'
    expect(listSqlStatements(doc)).toHaveLength(2)
  })

  it('ignores semicolons inside dollar-quoted bodies', () => {
    const doc = 'create function f() returns int as $$ select 1; $$ language sql;\nselect 2;'
    expect(listSqlStatements(doc)).toHaveLength(2)
  })

  it('returns empty for blank input', () => {
    expect(listSqlStatements('')).toEqual([])
    expect(listSqlStatements('   \n  ')).toEqual([])
  })
})

describe('resolveRunnableSql', () => {
  const doc = 'select 1 as first;\nselect 2 as second;'

  it('returns the trimmed selection when text is selected', () => {
    const from = doc.indexOf('select 2')
    const r = resolveRunnableSql(doc, from, doc.length)
    expect(r).toMatchObject({ sql: 'select 2 as second;', source: 'selection' })
  })

  it('trims surrounding whitespace off the selection range', () => {
    const start = doc.indexOf('\n') // selection starts on the newline
    const r = resolveRunnableSql(doc, start, doc.length)
    expect(r!.sql).toBe('select 2 as second;')
    expect(r!.from).toBe(doc.indexOf('select 2'))
    expect(r!.to).toBe(doc.length)
  })

  it('falls back to the cursor statement when the selection is only whitespace', () => {
    const start = doc.indexOf('\n')
    const r = resolveRunnableSql(doc, start, start + 1)
    expect(r).toMatchObject({ sql: 'select 1 as first;', source: 'statement' })
  })

  it('returns the statement under a collapsed cursor', () => {
    const pos = doc.indexOf('second')
    const r = resolveRunnableSql(doc, pos, pos)
    expect(r).toMatchObject({ sql: 'select 2 as second;', source: 'statement' })
  })

  it('picks the first statement when the cursor sits in leading whitespace', () => {
    const padded = `\n\n${doc}`
    const r = resolveRunnableSql(padded, 0, 0)
    expect(r!.sql).toBe('select 1 as first;')
  })

  it('picks the previous statement when the cursor sits between statements', () => {
    const spaced = 'select 1 as first;\n\n\nselect 2 as second;'
    const between = spaced.indexOf(';') + 2 // blank line after the first statement
    const r = resolveRunnableSql(spaced, between, between)
    expect(r!.sql).toBe('select 1 as first;')
  })

  it('picks the last statement when the cursor sits at the very end', () => {
    const r = resolveRunnableSql(doc, doc.length, doc.length)
    expect(r!.sql).toBe('select 2 as second;')
  })

  it('returns null for blank input', () => {
    expect(resolveRunnableSql('', 0, 0)).toBeNull()
    expect(resolveRunnableSql('  \n ', 1, 1)).toBeNull()
  })
})
