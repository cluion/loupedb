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
    command: 'pnpm run dev',
    url: 'http://localhost:3000',
    // the server needs LOUPEDB_* env vars from this config - reusing a stray
    // server on :3000 (wrong env) breaks the run in confusing ways
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      LOUPEDB_MASTER_KEY: 'a'.repeat(64), // e2e-only key, never a real secret
      LOUPEDB_DATA_DIR: mkdtempSync(join(tmpdir(), 'loupedb-e2e-data-')),
    },
  },
})
