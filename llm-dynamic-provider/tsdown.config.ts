import { defineConfig } from 'tsdown'

// Self-contained transpile. The shared endpoint-base primitives are dev-linked
// and INLINED so the tarball works without a separate install; harness-side
// peers stay bare and resolve from the installation's dependency closure at
// runtime.
export default defineConfig({
  entry: ['src/index.ts', 'src/invariant.ts'],
  outDir: 'lib',
  format: ['esm'],
  deps: {
    neverBundle: [/^@deepseek-ai\//, /^@earendil-works\//],
    alwaysBundle: ['dsh-llm-endpoint-base', 'dsh-llm-endpoint-base/store'],
  },
  dts: false,
  clean: false,
  outExtensions: () => ({ js: '.js' }),
})
