import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: [{
      find: 'dsh-llm-discovery/catalog/service',
      replacement: fileURLToPath(new URL('../llm-discovery/src/catalog/service.ts', import.meta.url)),
    }, {
      find: 'dsh-llm-discovery/engine',
      replacement: fileURLToPath(new URL('../llm-discovery/src/engine.ts', import.meta.url)),
    }, {
      find: 'dsh-llm-discovery/vocabulary',
      replacement: fileURLToPath(new URL('../llm-discovery/src/vocabulary.ts', import.meta.url)),
    }],
  },
  test: {
    include: ['tests/**/*.spec.ts'],
  },
})
