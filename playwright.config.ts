import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test/e2e',
  globalSetup: './test/e2e/global-setup',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:3200' },
  webServer: {
    // dedicated port so e2e never collides with a dev server on :3000
    command: 'pnpm exec nuxt dev --port 3200',
    url: 'http://localhost:3200',
    // the server needs LOUPEDB_* env vars from this config - reusing a stray
    // server (wrong env) breaks the run in confusing ways
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      LOUPEDB_MASTER_KEY: 'a'.repeat(64), // e2e-only key, never a real secret
      LOUPEDB_DATA_DIR: mkdtempSync(join(tmpdir(), 'loupedb-e2e-data-')),
    },
  },
})
