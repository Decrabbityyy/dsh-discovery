import { fileURLToPath } from 'node:url'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

// Harness imports resolve to the pinned checkout's sources; endpoint-base is
// aliased explicitly so tests pass on a clean plugin checkout before build.
export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['../../tsconfig.base.json'], loose: true })],
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
