import { fileURLToPath } from 'node:url'
import { defineVitestConfig } from '@nuxt/test-utils/config'

// defineVitestConfig enables the optional 'nuxt' environment used by
// component tests (opt-in per file via @vitest-environment nuxt docblock);
// server tests keep the default node environment
export default defineVitestConfig({
  resolve: {
    // maps Nuxt 4's built-in #shared alias so plain vitest (without Nuxt) can resolve it
    alias: { '#shared': fileURLToPath(new URL('./shared', import.meta.url)) },
  },
  test: {
    environment: 'node',
    exclude: ['**/node_modules/**', 'test/e2e/**'], // e2e runs under playwright, not vitest
    coverage: { provider: 'v8', reporter: ['text', 'html'], thresholds: { lines: 80 } },
    testTimeout: 60_000, // testcontainers needs a longer timeout
    hookTimeout: 300_000, // @nuxt/test-utils setup() builds the app in beforeAll
  },
})
