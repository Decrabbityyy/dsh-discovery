import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// @deepseek-ai/* imports resolve from node_modules (@alpha/@next); the
// package's own public entries and endpoint-base are aliased to source for
// clean-checkout tests.
export default defineConfig({
  resolve: {
    alias: [
      {
        find: 'dsh-llm-endpoint-base/models-dev',
        replacement: fileURLToPath(new URL('../llm-endpoint-base/src/models-dev.ts', import.meta.url)),
      },
      {
        find: 'dsh-llm-endpoint-base/vocabulary',
        replacement: fileURLToPath(new URL('../llm-endpoint-base/src/vocabulary.ts', import.meta.url)),
      },
      {
        find: 'dsh-llm-endpoint-base',
        replacement: fileURLToPath(new URL('../llm-endpoint-base/src/index.ts', import.meta.url)),
      },
      {
        find: 'dsh-client-ui-settings-discovery/client',
        replacement: fileURLToPath(new URL('./src/client/index.ts', import.meta.url)),
      },
      {
        find: 'dsh-client-ui-settings-discovery/invariant',
        replacement: fileURLToPath(new URL('./src/invariant.ts', import.meta.url)),
      },
    ],
  },
  test: {
    include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'],
  },
})
