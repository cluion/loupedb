import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test/e2e',
  globalSetup: './test/e2e/global-setup',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:3000' },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 180_000,
    env: {
      LOUPEDB_MASTER_KEY: 'a'.repeat(64), // e2e-only key, never a real secret
      LOUPEDB_DATA_DIR: mkdtempSync(join(tmpdir(), 'loupedb-e2e-data-')),
    },
  },
})
