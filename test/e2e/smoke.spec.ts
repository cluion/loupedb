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
  await page.click('button[type="submit"]')

  // connected: main workspace appears
  await expect(page.getByRole('button', { name: '執行' })).toBeVisible()

  // tree: expand database (opens a sibling session), then schema, then table
  await page.getByRole('button', { name: new RegExp(process.env.E2E_PG_DB!) }).click()
  await page.getByRole('button', { name: /public/ }).click()
  await page.getByRole('button', { name: 'items', exact: true }).click()

  // data grid renders the table content end to end
  await expect(page.getByRole('cell', { name: 'x', exact: true })).toBeVisible()

  // structure tab shows columns with pk badge
  await page.getByRole('button', { name: '結構' }).click()
  await expect(page.getByRole('cell', { name: 'PK' })).toBeVisible()
  await expect(page.getByText('int4').first()).toBeVisible()

  // the real codemirror editor accepts input and executes (Mod-Enter path is the same run())
  await page.locator('.cm-content').click()
  await page.locator('.cm-content').fill("select 'lens' as tag")
  await page.getByRole('button', { name: '執行', exact: true }).click()
  await expect(page.getByRole('cell', { name: 'lens', exact: true })).toBeVisible()

  // with two statements, only the one under the cursor runs (fill leaves the
  // cursor at the end, i.e. inside the second statement, which gets highlighted)
  await page.locator('.cm-content').fill("select 'first' as a;\nselect 'second' as b;")
  await expect(page.locator('.cm-current-statement').first()).toBeVisible()
  await page.getByRole('button', { name: '執行', exact: true }).click()
  await expect(page.getByRole('cell', { name: 'second', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'first', exact: true })).not.toBeVisible()

  // an explicit selection takes priority and relabels the run button
  await page.locator('.cm-line').first().click()
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+End')
  await page.getByRole('button', { name: '執行選取', exact: true }).click()
  await expect(page.getByRole('cell', { name: 'first', exact: true })).toBeVisible()

  // the loaded result downloads as a CSV file
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
  const tabsBefore = await page.getByRole('tab').count()
  await page.getByTestId('history-entry').first().click()
  await expect(page.getByRole('tab')).toHaveCount(tabsBefore + 1)
  await expect(page.locator('.cm-content')).toContainText("select 'first' as a")

  // save the current tab as a named query on the server
  await page.getByRole('button', { name: '已存查詢' }).click()
  await page.getByRole('button', { name: '儲存目前分頁' }).click()
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
  await page.getByTestId('saved-entry').first().click()
  await expect(page.getByRole('tab', { name: /Query 2/, selected: true })).toBeVisible()

  // header shows the connection name, and disconnect returns to the lens screen
  await expect(page.getByText('e2e', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '中斷連線' }).click()
  await expect(page.getByRole('button', { name: '連線' })).toBeVisible()
})
