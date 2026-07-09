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
})
