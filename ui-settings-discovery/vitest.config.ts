import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'


export default defineConfig({
  resolve: {
    alias: [
      {
        find: 'dsh-llm-discovery/catalog/models-dev',
        replacement: fileURLToPath(new URL('../llm-discovery/src/catalog/models-dev.ts', import.meta.url)),
      },
      {
        find: 'dsh-llm-discovery/vocabulary',
        replacement: fileURLToPath(new URL('../llm-discovery/src/vocabulary.ts', import.meta.url)),
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
