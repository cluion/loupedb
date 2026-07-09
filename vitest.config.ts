import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { defineVitestProject } from '@nuxt/test-utils/config'

// two isolated projects: plain node for server/api specs and a nuxt runtime
// project for component/composable specs - mixing the nuxt vite plugins into
// one global pipeline breaks the @nuxt/test-utils e2e build
export default defineConfig({
  test: {
    coverage: { provider: 'v8', reporter: ['text', 'html'], thresholds: { lines: 80 } },
    projects: [
      {
        resolve: {
          // maps Nuxt 4's built-in #shared alias for plain vitest
          alias: { '#shared': fileURLToPath(new URL('./shared', import.meta.url)) },
        },
        test: {
          name: 'node',
          environment: 'node',
          include: ['test/**/*.spec.ts'],
          exclude: ['**/node_modules/**', 'test/unit/**', 'test/e2e/**'],
          testTimeout: 60_000, // testcontainers needs a longer timeout
          hookTimeout: 300_000, // @nuxt/test-utils setup() builds the app in beforeAll
        },
      },
      await defineVitestProject({
        test: {
          name: 'nuxt',
          environment: 'nuxt',
          include: ['test/unit/**/*.spec.ts'],
          testTimeout: 60_000,
        },
      }),
    ],
  },
})
