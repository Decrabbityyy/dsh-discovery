import { fileURLToPath } from 'node:url'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

// Harness packages resolve to the checkout's sources; the sibling endpoint-base
// package is aliased to its source because the harness wildcard cannot see it.
export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['../../tsconfig.base.json'], loose: true })],
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
