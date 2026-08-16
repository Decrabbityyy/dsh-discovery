import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

// Resolve @deepseek-ai/* imports to the sibling harness checkout's sources —
// the same source-plane convention the harness's own vitest config uses.
export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['../../tsconfig.base.json'], loose: true })],
  test: {
    include: ['tests/**/*.spec.ts'],
  },
})
