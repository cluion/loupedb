// @vitest-environment nuxt
import { describe, expect, it } from 'vitest'
import {
  dangerousSqlCommands,
  defaultSafetyMode,
  isPotentiallyWritingSql,
  sqlCommands,
  sqlStatementCommand,
} from '../../shared/connectionSafety'

describe('connection safety SQL inspection', () => {
  it('defaults production to safe mode and other environments to normal', () => {
    expect(defaultSafetyMode('development')).toBe('normal')
    expect(defaultSafetyMode('staging')).toBe('normal')
    expect(defaultSafetyMode('production')).toBe('safe')
  })

  it('detects dangerous statements without matching strings or comments', () => {
    const sql = `
      select 'DROP TABLE hidden' as example;
      -- DELETE FROM ignored
      update items set label = 'updated';
      /* TRUNCATE ignored */ delete from logs;
    `
    expect(sqlCommands(sql)).toEqual(['SELECT', 'UPDATE', 'DELETE'])
    expect(dangerousSqlCommands(sql)).toEqual(['UPDATE', 'DELETE'])
  })

  it('finds the main command after a CTE and ignores dollar-quoted bodies', () => {
    expect(sqlStatementCommand('with current as (select 1) update items set label = label')).toBe('UPDATE')
    expect(dangerousSqlCommands(`select $$ DROP TABLE hidden $$; truncate table logs;`)).toEqual(['TRUNCATE'])
    expect(dangerousSqlCommands(`with removed as (delete from logs returning *) select * from removed`))
      .toEqual(['DELETE'])
    expect(isPotentiallyWritingSql(`with added as (insert into logs default values returning *) select * from added`))
      .toBe(true)
  })

  it('treats only read commands as read-only compatible', () => {
    expect(isPotentiallyWritingSql('select 1; show search_path; values (1)')).toBe(false)
    expect(isPotentiallyWritingSql('insert into items default values')).toBe(true)
    expect(isPotentiallyWritingSql('set default_transaction_read_only = off')).toBe(true)
  })
})
