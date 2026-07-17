import { describe, expect, it } from 'vitest'
import { listSqlParameterPositions } from '../../shared/sqlParameters'

describe('listSqlParameterPositions', () => {
  it('returns unique positions in numeric order', () => {
    expect(listSqlParameterPositions('select $3, $1, $3, $10')).toEqual([1, 3, 10])
  })

  it('ignores placeholders inside literals, comments and quoted identifiers', () => {
    const sql = `select '$1', "$2", $$ $3 $$, $tag$ $4 $tag$, real$5, $6
-- $7
/* $8 */`
    expect(listSqlParameterPositions(sql)).toEqual([6])
  })

  it('requires identifier boundaries and positive positions', () => {
    expect(listSqlParameterPositions('select foo$1, 名$2, $3bar, $0, $4::int')).toEqual([4])
  })
})
