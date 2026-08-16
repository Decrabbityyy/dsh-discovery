import { defineConfig } from 'tsdown'

// Self-contained transpile for the host plugin: no project references, no type
// resolution — the harness-side peer imports stay bare and resolve from the
// installation at runtime. The shared endpoint-base primitives are INLINED so
// the plugin tarball works without a separate base install. Type checking and
// .d.ts emission are the dev-time `tsc -p tsconfig.json` step, which reads the
// sibling harness checkout.
export default defineConfig({
  entry: ['src/index.ts', 'src/invariant.ts'],
  outDir: 'lib',
  format: ['esm'],
  deps: {
    neverBundle: [/^@deepseek-ai\//, /^@earendil-works\//],
    alwaysBundle: ['dsh-llm-endpoint-base'],
  },
  dts: false,
  // tsc emits lib/types into the same tree in this package's build; tsdown's
  // default outDir cleanup would delete it.
  clean: false,
  outExtensions: () => ({ js: '.js' }),
})
