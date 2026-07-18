import { readFileSync } from 'node:fs'
import { test, expect } from '@playwright/test'

test('connect via form, browse schema tree and open a table', async ({ page }) => {
  await page.goto('/')
  // the onMounted gate probe fires after hydration - waiting for it guarantees
  // vue listeners (submit.prevent) are attached before we interact
  await page.waitForResponse((r) => r.url().includes('/api/connections'))

  await page.fill('input[placeholder="連線名稱"]', 'e2e')
  await page.fill('input[placeholder="host"]', process.env.E2E_PG_HOST!)
  await page.fill('input[placeholder="port"]', process.env.E2E_PG_PORT!) // container port is random
  await page.fill('input[placeholder="database（選填，預設 postgres）"]', process.env.E2E_PG_DB!)
  await page.fill('input[placeholder="username"]', process.env.E2E_PG_USER!)
  await page.fill('input[placeholder="password"]', process.env.E2E_PG_PASS!)
  const columnsLoaded = page.waitForResponse((r) => r.url().includes('/columns'))
  const functionsLoaded = page.waitForResponse((r) => r.url().includes('/functions'))
  await page.click('button[type="submit"]')

  // connected: main workspace appears
  await expect(page.getByRole('button', { name: '執行' })).toBeVisible()
  await expect(page.locator('header.bar')).toContainText('DEVELOPMENT')
  await expect(page.locator('header.bar')).toContainText('NORMAL')

  // schema-aware autocomplete: typing a partial table name suggests it
  await columnsLoaded
  await page.locator('.cm-content').click()
  await page.keyboard.type('select * from ite')
  await expect(page.locator('.cm-tooltip-autocomplete')).toContainText('items')
  await page.keyboard.press('Escape')

  // user-schema PostgreSQL functions include signatures and insert a call
  await functionsLoaded
  await page.locator('.cm-content').fill('select double_v')
  await expect(page.locator('.cm-tooltip-autocomplete')).toContainText('double_value()')
  await page.locator('.cm-completionLabel', { hasText: 'double_value()' }).click()
  await expect(page.locator('.cm-content')).toContainText('select double_value(')
  await page.locator('.cm-content').fill('select double_value(21) as doubled')
  await page.getByRole('button', { name: '執行', exact: true }).click()
  await expect(page.getByRole('cell', { name: '42', exact: true })).toBeVisible()

  // tree: expand database (opens a sibling session), then schema, then table
  await page.getByRole('button', { name: new RegExp(process.env.E2E_PG_DB!) }).click()
  await page.getByRole('button', { name: /public/ }).click()
  await page.getByRole('button', { name: 'items', exact: true }).click()

  // data grid renders the table content end to end
  await expect(page.getByRole('cell', { name: 'x', exact: true })).toBeVisible()

  // multiple filters can be combined and replayed from per-table browser history
  const filterBuilder = page.getByRole('region', { name: '多條件篩選' })
  await filterBuilder.getByLabel('filter column').selectOption('label')
  await filterBuilder.getByLabel('filter op').selectOption('ilike')
  await filterBuilder.getByLabel('filter value').fill('%')
  await filterBuilder.getByRole('button', { name: /新增條件/ }).click()
  await filterBuilder.getByLabel('filter column 2').selectOption('id')
  await filterBuilder.getByLabel('filter op 2').selectOption('>')
  await filterBuilder.getByLabel('filter value 2').fill('1')
  await filterBuilder.getByRole('button', { name: '套用篩選' }).click()
  await expect(page.getByRole('cell', { name: 'x', exact: true })).not.toBeVisible()
  await expect(page.getByRole('cell', { name: 'y', exact: true })).toBeVisible()
  await expect(page.getByTestId('active-filter')).toContainText('label ILIKE "%" AND id > "1"')
  await filterBuilder.getByRole('button', { name: '清除', exact: true }).click()
  await expect(page.getByRole('cell', { name: 'x', exact: true })).toBeVisible()
  await filterBuilder.getByText('最近篩選・1').click()
  await filterBuilder.getByRole('button', { name: '套用篩選歷史 1' }).click()
  await expect(page.getByRole('cell', { name: 'x', exact: true })).not.toBeVisible()
  await filterBuilder.getByRole('button', { name: '清除', exact: true }).click()
  await expect(page.getByRole('cell', { name: 'x', exact: true })).toBeVisible()

  // edits stay local with a dirty marker until the atomic batch is applied
  await expect(page.getByTestId('editability-status')).toContainText('可編輯')
  await page.getByRole('cell', { name: 'x', exact: true }).dblclick()
  await page.getByRole('textbox', { name: '編輯 label 第 1 列' }).fill('inline edited')
  await page.getByRole('button', { name: '預覽寫入' }).click()
  const writePreview = page.getByRole('dialog', { name: '確認資料寫入' })
  await expect(writePreview).toContainText('UPDATE "public"."items"')
  await expect(writePreview).toContainText('"id" IS NOT DISTINCT FROM $2')
  await expect(writePreview).toContainText('xmin::text')
  await page.getByRole('button', { name: '暫存更新' }).click()
  await expect(page.getByTestId('staged-changes')).toContainText('待套用變更・1')
  await expect(page.getByRole('cell', { name: 'inline edited', exact: true })).toBeVisible()

  // inserts join the same staged batch; one transaction applies both changes
  await page.getByRole('button', { name: '新增資料列' }).click()
  await page.getByRole('textbox', { name: 'label 的值' }).fill('added row')
  await page.getByRole('button', { name: '預覽新增' }).click()
  const insertPreview = page.getByRole('dialog', { name: '確認新增資料列' })
  await expect(insertPreview).toContainText('INSERT INTO "public"."items" ("label")')
  await page.getByRole('button', { name: '暫存新增' }).click()
  await expect(page.getByTestId('staged-changes')).toContainText('待套用變更・2')
  await page.getByRole('button', { name: '全部套用 2 項' }).click()
  await expect(page.getByRole('status')).toContainText('已套用 2 項變更')
  await expect(page.getByRole('cell', { name: 'inline edited', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'added row', exact: true })).toBeVisible()

  const dataGrid = page.locator('.grid').first()
  await dataGrid.getByRole('row').filter({ hasText: 'added row' }).getByRole('button', { name: /Clone/ }).click()
  await page.getByRole('textbox', { name: 'label 的值' }).fill('cloned row')
  await page.getByRole('button', { name: '預覽新增' }).click()
  await page.getByRole('button', { name: '暫存新增' }).click()
  await page.getByRole('button', { name: '全部套用 1 項' }).click()
  await expect(page.getByRole('cell', { name: 'cloned row', exact: true })).toBeVisible()

  await dataGrid.getByRole('row').filter({ hasText: 'cloned row' }).getByRole('button', { name: /刪除/ }).click()
  const deletePreview = page.getByRole('dialog', { name: '確認刪除資料列' })
  await expect(deletePreview).toContainText('xmin::text')
  await page.getByRole('button', { name: '暫存刪除' }).click()
  await expect(dataGrid.getByRole('row').filter({ hasText: 'cloned row' })).toContainText('待刪除')
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('尚有未套用的資料變更')
    await dialog.dismiss()
  })
  await page.getByRole('button', { name: '結構' }).click()
  await expect(page.getByTestId('staged-changes')).toBeVisible()
  await page.getByRole('button', { name: '全部回復' }).click()
  await expect(page.getByRole('cell', { name: 'cloned row', exact: true })).toBeVisible()
  await dataGrid.getByRole('row').filter({ hasText: 'cloned row' }).getByRole('button', { name: /刪除/ }).click()
  await page.getByRole('button', { name: '暫存刪除' }).click()
  await page.getByRole('button', { name: '全部套用 1 項' }).click()
  await expect(page.getByRole('cell', { name: 'cloned row', exact: true })).not.toBeVisible()

  // without a primary key, a complete non-NULL unique key still provides safe row identity
  await page.getByRole('button', { name: 'contacts', exact: true }).click()
  await expect(page.getByTestId('editability-status')).toContainText('unique key')
  await page.getByRole('cell', { name: 'unique row', exact: true }).dblclick()
  await page.getByRole('textbox', { name: '編輯 label 第 1 列' }).fill('unique edited')
  await page.getByRole('button', { name: '預覽寫入' }).click()
  await expect(page.getByRole('dialog', { name: '確認資料寫入' })).toContainText(
    '"email" IS NOT DISTINCT FROM $2',
  )
  await page.getByRole('button', { name: '暫存更新' }).click()
  await page.getByRole('button', { name: '全部套用 1 項' }).click()
  await expect(page.getByRole('cell', { name: 'unique edited', exact: true })).toBeVisible()
  const contactsGrid = page.locator('.grid').first()
  await contactsGrid.getByRole('row').filter({ hasText: 'unique edited' }).getByRole('button', { name: /刪除/ }).click()
  await expect(page.getByRole('dialog', { name: '確認刪除資料列' })).toContainText(
    '"email" IS NOT DISTINCT FROM $1',
  )
  await page.getByRole('button', { name: '暫存刪除' }).click()
  await page.getByRole('button', { name: '全部套用 1 項' }).click()
  await expect(page.getByRole('cell', { name: 'unique edited', exact: true })).not.toBeVisible()

  await page.getByRole('button', { name: 'items', exact: true }).click()

  // structure tab shows columns with pk badge
  await page.getByRole('button', { name: '結構' }).click()
  await expect(page.getByRole('cell', { name: 'PK' })).toBeVisible()
  await expect(page.getByText('int4').first()).toBeVisible()

  // the real codemirror editor accepts input and executes (Mod-Enter path is the same run())
  await page.locator('.cm-content').click()
  await page.locator('.cm-content').fill("select 'lens' as tag")
  await page.getByRole('button', { name: '執行', exact: true }).click()
  await expect(page.getByRole('cell', { name: 'lens', exact: true })).toBeVisible()

  // format only the active selection, keep it selected, and leave the rest untouched
  await page.locator('.cm-content').fill('select 1;\nselect id,name from items where id=1;')
  await page.locator('.cm-line').nth(1).click()
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+End')
  await page.getByRole('button', { name: '格式化 SQL' }).click()
  await expect.poll(() => page.locator('.cm-content').evaluate((editor) => (
    [...editor.querySelectorAll('.cm-line')].map(line => line.textContent).join('\n')
  ))).toBe(`select 1;
SELECT
  id,
  name
FROM
  items
WHERE
  id = 1;`)
  await page.keyboard.type('REPLACED')
  await expect(page.locator('.cm-content')).toContainText('select 1;REPLACED')

  // a formatter parse error never overwrites the original draft
  await page.locator('.cm-content').fill("select 'unterminated")
  await page.getByRole('button', { name: '格式化 SQL' }).click()
  await expect(page.getByTestId('format-error')).toContainText('SQL 格式化失敗')
  await expect(page.locator('.cm-content')).toContainText("select 'unterminated")

  // macOS Option+Shift+F reports the typed character Ï instead of key f;
  // matching the physical KeyF still formats and prevents that character input
  await page.locator('.cm-content').fill('select id,name from items where id=1;')
  await page.locator('.cm-content').evaluate(editor => editor.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Ï', code: 'KeyF', shiftKey: true, altKey: true, bubbles: true, cancelable: true,
  })))
  await expect.poll(() => page.locator('.cm-content').evaluate((editor) => (
    [...editor.querySelectorAll('.cm-line')].map(line => line.textContent).join('\n')
  ))).toBe(`SELECT
  id,
  name
FROM
  items
WHERE
  id = 1;`)
  await expect(page.getByTestId('format-error')).not.toBeVisible()
  await expect(page.locator('.cm-content')).not.toContainText('Ï')

  // PostgreSQL notices and warnings are attached to the query that emitted them
  await page.locator('.cm-content').fill(`do $$ begin
raise notice 'refresh complete';
raise warning 'using fallback';
end $$;`)
  await page.getByRole('button', { name: '執行', exact: true }).click()
  await expect(page.getByTestId('query-messages')).toContainText('NOTICE')
  await expect(page.getByTestId('query-messages')).toContainText('refresh complete')
  await expect(page.getByTestId('query-messages')).toContainText('WARNING')
  await expect(page.getByTestId('query-messages')).toContainText('using fallback')

  // positional parameters are collected before execution and never interpolated into SQL
  await page.locator('.cm-content').fill(
    'select $1::text as label, $2::int as amount, $3::text is null as was_null',
  )
  await page.getByRole('button', { name: '執行', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '查詢參數' })).toBeVisible()
  await page.getByRole('textbox', { name: '參數 $1' }).fill('bound value')
  await page.getByRole('textbox', { name: '參數 $2' }).fill('42')
  await page.getByRole('checkbox', { name: '參數 $3 使用 NULL' }).check()
  await page.getByRole('button', { name: '使用參數執行' }).click()
  await expect(page.getByRole('cell', { name: 'bound value', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: '42', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'true', exact: true })).toBeVisible()

  // manual transactions keep every statement on one PostgreSQL connection
  // until the user explicitly commits or rolls back
  await expect(page.getByTestId('transaction-status')).toHaveText('自動提交')
  await page.getByRole('button', { name: '開始交易' }).click()
  await expect(page.getByTestId('transaction-status')).toHaveText('交易中')
  await page.locator('.cm-content').fill("update items set label = 'pending' where id = 1")
  await page.getByRole('button', { name: '執行', exact: true }).click()
  await expect(page.getByTestId('execution-summary')).toContainText('1 列受影響')
  await page.locator('.cm-content').fill('select label from items where id = 1')
  await page.getByRole('button', { name: '執行', exact: true }).click()
  await expect(page.getByRole('cell', { name: 'pending', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Rollback 交易' }).click()
  await expect(page.getByTestId('transaction-status')).toHaveText('自動提交')
  await page.getByRole('button', { name: '執行', exact: true }).click()
  await expect(page.getByRole('cell', { name: 'inline edited', exact: true })).toBeVisible()

  // with two statements, only the one under the cursor runs (fill leaves the
  // cursor at the end, i.e. inside the second statement, which gets highlighted)
  await page.locator('.cm-content').fill("select 'first' as a;\nselect 'second' as b;")
  await expect(page.locator('.cm-current-statement').first()).toBeVisible()
  await expect(page.getByTestId('execution-scope')).toContainText('目前只會執行編輯器中標示的語句')
  await expect(page.getByTestId('execution-scope')).toContainText('由上到下執行 2 個 statement')
  await page.getByRole('button', { name: '執行目前語句', exact: true }).click()
  await expect(page.getByRole('cell', { name: 'second', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'first', exact: true })).not.toBeVisible()

  // an explicit selection takes priority and relabels the run button
  await page.locator('.cm-line').first().click()
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+End')
  await page.getByRole('button', { name: '執行選取', exact: true }).click()
  await expect(page.getByRole('cell', { name: 'first', exact: true })).toBeVisible()

  // every SQL tab keeps one prior result in memory for quick comparison
  await expect(page.getByRole('tab', { name: '顯示目前結果' })).toBeVisible()
  await page.getByRole('tab', { name: '顯示前次結果' }).click()
  await expect(page.getByRole('cell', { name: 'second', exact: true })).toBeVisible()
  await page.getByRole('tab', { name: '顯示目前結果' }).click()
  await expect(page.getByRole('cell', { name: 'first', exact: true })).toBeVisible()

  // complete scripts run sequentially and expose each result or command in tabs
  await page.locator('.cm-content').fill(`select 'script first' as step;
update items set label = label where id = 1;
select 'script last' as step;`)
  await page.getByRole('button', { name: '執行完整 Script' }).click()
  await expect(page.getByRole('tab', { name: '結果 1 SELECT' })).toBeVisible()
  await expect(page.getByRole('tab', { name: '結果 2 UPDATE' })).toBeVisible()
  await expect(page.getByRole('tab', { name: '結果 3 SELECT' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'script first', exact: true })).toBeVisible()
  await page.getByRole('tab', { name: '結果 2 UPDATE' }).click()
  await expect(page.getByTestId('script-statement-message')).toContainText('UPDATE・1 列受影響')
  await page.getByRole('tab', { name: '結果 3 SELECT' }).click()
  await expect(page.getByRole('cell', { name: 'script last', exact: true })).toBeVisible()

  // an error stops following statements but keeps earlier results available
  await page.locator('.cm-content').fill(`select 'kept result' as step;
select * from definitely_missing_script_table;
select 'never runs' as step;`)
  await page.getByRole('button', { name: '執行完整 Script' }).click()
  await expect(page.getByTestId('execution-summary')).toContainText('第 2 / 3 個失敗')
  await expect(page.getByTestId('script-statement-message')).toContainText('definitely_missing_script_table')
  await expect(page.getByRole('tab', { name: '結果 3 SELECT' })).not.toBeVisible()
  await page.getByRole('tab', { name: '結果 1 SELECT' }).click()
  await expect(page.getByRole('cell', { name: 'kept result', exact: true })).toBeVisible()

  // cancelling a script stops the active statement and skips the remainder
  await page.locator('.cm-content').fill(`select 'before cancel' as step;
select pg_sleep(10);
select 'never runs' as step;`)
  await page.getByRole('button', { name: '執行完整 Script' }).click()
  await expect(page.getByRole('button', { name: '停止查詢' })).toBeVisible()
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: '停止查詢' }).click()
  await expect(page.getByTestId('execution-summary')).toContainText('第 2 / 3 個已取消')
  await expect(page.getByTestId('script-statement-message')).toContainText('已取消')
  await expect(page.getByRole('tab', { name: '結果 3 SELECT' })).not.toBeVisible()

  // a client-generated query id connects the editor stop button to the
  // existing server-side cancellation pipeline
  await page.locator('.cm-content').fill('select pg_sleep(10)')
  await page.getByRole('button', { name: '執行', exact: true }).click()
  await expect(page.getByRole('button', { name: '停止查詢' })).toBeVisible()
  // let postgres.js register the in-flight handle before sending cancel
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: '停止查詢' }).click()
  await expect(page.getByTestId('execution-summary')).toContainText('已取消')
  await expect(page.getByRole('button', { name: '執行', exact: true })).toBeVisible()

  // the loaded result downloads as a CSV file
  await page.locator('.cm-content').fill("select 'first' as a")
  await page.getByRole('button', { name: '執行', exact: true }).click()
  await expect(page.getByRole('cell', { name: 'first', exact: true })).toBeVisible()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('.editor').getByRole('button', { name: '下載結果' }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/^loupedb-.+\.csv$/)
  const csv = readFileSync((await download.path())!, 'utf8')
  expect(csv).toBe('a\r\nfirst')

  // history drawer lists past executions, newest first, and reopens one in a new tab
  await page.getByRole('button', { name: '查詢歷史' }).click()
  await expect(page.getByTestId('history-entry').first()).toContainText("select 'first' as a")
  await expect(page.getByTestId('history-entry').filter({ hasText: 'select pg_sleep(10)' }).first()).toContainText('已取消')
  const sqlTabs = page.getByRole('tablist', { name: 'SQL 分頁' }).getByRole('tab')
  const tabsBefore = await sqlTabs.count()
  await page.getByTestId('history-entry').first().click()
  await expect(sqlTabs).toHaveCount(tabsBefore + 1)
  await expect(page.locator('.cm-content')).toContainText("select 'first' as a")

  // save the current tab as a named query on the server
  await page.getByRole('button', { name: '已存查詢' }).click()
  await page.getByRole('button', { name: '儲存目前分頁' }).click()
  await expect(page.getByTestId('saved-entry')).toContainText('Query 2')
  await page.getByRole('button', { name: '收藏 Query 2' }).click()
  await expect(page.getByRole('button', { name: '取消收藏 Query 2' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '整理 Query 2' }).click()
  await page.getByLabel('資料夾 Query 2').fill('Reports')
  await page.getByLabel('標籤 Query 2').fill('daily, audit')
  await page.getByRole('button', { name: '儲存整理' }).click()
  await expect(page.getByTestId('saved-entry')).toContainText('Reports')
  await expect(page.getByTestId('saved-entry')).toContainText('#daily')
  await expect(page.getByTestId('saved-entry')).toContainText('#audit')
  await page.getByRole('button', { name: '只顯示收藏' }).click()
  await page.getByRole('combobox', { name: '依資料夾篩選' }).selectOption('Reports')
  await page.getByRole('combobox', { name: '依標籤篩選' }).selectOption('daily')
  await expect(page.getByTestId('saved-entry')).toContainText('Query 2')

  // SQL tabs keep independent drafts and survive a full browser refresh
  await page.getByRole('button', { name: '新增 SQL 分頁' }).click()
  await page.locator('.cm-content').fill("select 'persisted draft' as note")
  await page.getByRole('tab', { selected: true }).dblclick()
  await page.getByRole('textbox', { name: '重新命名 SQL 分頁' }).fill('Report draft')
  await page.getByRole('textbox', { name: '重新命名 SQL 分頁' }).press('Enter')

  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/connections') && r.request().method() === 'GET'),
    page.reload(),
  ])
  await expect(page.getByRole('tab', { name: /Report draft/, selected: true })).toBeVisible()
  await expect(page.locator('.cm-content')).toContainText("select 'persisted draft' as note")

  // saved queries live on the server, so they also survive the refresh
  await page.getByRole('button', { name: '已存查詢' }).click()
  await expect(page.getByTestId('saved-entry')).toContainText('Query 2')
  await expect(page.getByTestId('saved-entry')).toContainText('Reports')
  await expect(page.getByTestId('saved-entry')).toContainText('#daily')
  await expect(page.getByRole('button', { name: '取消收藏 Query 2' })).toBeVisible()
  await page.getByTestId('saved-entry').first().click()
  await expect(page.getByRole('tab', { name: /Query 2/, selected: true })).toBeVisible()

  // header shows the connection name, and disconnect returns to the lens screen
  await expect(page.getByText('e2e', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '中斷連線' }).click()
  await expect(page.getByRole('button', { name: '連線' })).toBeVisible()
})
