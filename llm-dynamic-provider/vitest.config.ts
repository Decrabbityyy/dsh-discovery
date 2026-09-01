import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Harness packages resolve from node_modules (@alpha/@next); the sibling
// endpoint-base package is aliased to its source for clean-checkout tests.
export default defineConfig({
  resolve: {
    alias: [{
      find: 'dsh-llm-endpoint-base/store',
      replacement: fileURLToPath(new URL('../llm-endpoint-base/src/store.ts', import.meta.url)),
    }, {
      find: 'dsh-llm-endpoint-base',
      replacement: fileURLToPath(new URL('../llm-endpoint-base/src/index.ts', import.meta.url)),
    }],
  },
  test: {
    include: ['tests/**/*.spec.ts'],
  },
})
