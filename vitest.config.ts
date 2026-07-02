import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Maps Nuxt 4's built-in #shared alias so plain vitest (without Nuxt) can resolve it
    alias: { '#shared': fileURLToPath(new URL('./shared', import.meta.url)) },
  },
  test: {
    environment: 'node',
    coverage: { provider: 'v8', reporter: ['text', 'html'], thresholds: { lines: 80 } },
    testTimeout: 60_000, // testcontainers needs a longer timeout
  },
})
