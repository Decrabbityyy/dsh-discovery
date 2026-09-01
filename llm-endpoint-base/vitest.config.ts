import { defineConfig } from 'vitest/config'

// Harness packages (@deepseek-ai/*) resolve from node_modules (@alpha/@next
// channels) — vite's default node resolution handles them; no tsconfig-paths
// facade into a harness checkout is needed anymore.
export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
  },
})
