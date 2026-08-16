import { fileURLToPath } from 'node:url'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

// @deepseek-ai/* imports resolve to the sibling harness checkout's sources via
// the shared base paths; the package's own public entries are aliased because
// the workspace wildcard no longer covers this directory.
export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['../../tsconfig.base.json'], loose: true })],
  resolve: {
    alias: [
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
