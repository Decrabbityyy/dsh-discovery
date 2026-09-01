import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Harness packages resolve from node_modules (@alpha/@next); endpoint-base is
// aliased to its source so tests pass on a clean checkout before its build.
export default defineConfig({
  resolve: {
    alias: [{
      find: 'dsh-llm-endpoint-base',
      replacement: fileURLToPath(new URL('../llm-endpoint-base/src/index.ts', import.meta.url)),
    }],
  },
  test: {
    include: ['tests/**/*.spec.ts'],
  },
})
