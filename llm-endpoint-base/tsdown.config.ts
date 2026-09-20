import { defineConfig } from 'tsdown'

// Self-contained transpile for the shared library: no project references, no
// type resolution — the harness-side peer imports stay bare and resolve from
// the installation at runtime. Type checking and .d.ts emission are the
// dev-time `tsc -p tsconfig.json` step, which reads the sibling harness
// checkout. The library is pure logic (no Cordis), so both the host plugins
// and the browser client bundle it the same way.
export default defineConfig({
  entry: ['src/index.ts', 'src/vocabulary.ts', 'src/models-dev.ts', 'src/store.ts'],
  outDir: 'lib',
  format: ['esm'],
  deps: { neverBundle: [/^@deepseek-ai\//, /^@earendil-works\//, 'zod'] },
  dts: false,
  // tsc emits lib/types into the same tree in this package's build; tsdown's
  // default outDir cleanup would delete it.
  clean: false,
  outExtensions: () => ({ js: '.js' }),
})
