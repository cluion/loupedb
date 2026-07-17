import { describe, expect, it } from 'vitest'
import { formatPostgresSql } from '../../app/utils/sqlFormatter'

describe('formatPostgresSql', () => {
  it('formats PostgreSQL with stable casing and indentation', async () => {
    await expect(formatPostgresSql(
      'select u.id,u.name,count(o.id) as orders from users u left join orders o on o.user_id=u.id where u.active=true and u.name is not null group by u.id,u.name order by orders desc;',
    )).resolves.toBe(`SELECT
  u.id,
  u.name,
  count(o.id) AS orders
FROM
  users u
  LEFT JOIN orders o ON o.user_id = u.id
WHERE
  u.active = TRUE
  AND u.name IS NOT NULL
GROUP BY
  u.id,
  u.name
ORDER BY
  orders DESC;`)
  })

  it('preserves comments, strings and dollar-quoted function bodies', async () => {
    const source = `-- keep this
create function demo() returns void as $body$
begin
  raise notice 'hello; world';
end
$body$ language plpgsql;`
    const formatted = await formatPostgresSql(source)

    expect(formatted).toContain('-- keep this')
    expect(formatted).toContain(`$body$
begin
  raise notice 'hello; world';
end
$body$`)
  })

  it('is idempotent', async () => {
    const once = await formatPostgresSql('select id,name from users where active=true;')
    await expect(formatPostgresSql(once)).resolves.toBe(once)
  })

  it('keeps whitespace-only input unchanged', async () => {
    await expect(formatPostgresSql('  \n\t')).resolves.toBe('  \n\t')
  })

  it('throws on formatter parse errors so the editor can keep the original SQL', async () => {
    await expect(formatPostgresSql("select 'unterminated")).rejects.toThrow('Parse error')
  })
})
