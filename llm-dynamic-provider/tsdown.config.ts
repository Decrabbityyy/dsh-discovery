import { defineConfig } from 'tsdown'

// The shared discovery primitives are inlined so the plugin tarball needs no
// extra install; harness-side peers stay external and resolve from the installation.
export default defineConfig({
  entry: ['src/index.ts', 'src/invariant.ts'],
  outDir: 'lib',
  format: ['esm'],
  deps: {
    neverBundle: [/^@deepseek-ai\//, /^@earendil-works\//],
    alwaysBundle: ['dsh-llm-discovery/engine', 'dsh-llm-discovery/vocabulary', 'dsh-llm-discovery/catalog/service'],
  },
  dts: false,
  clean: false,
  outExtensions: () => ({ js: '.js' }),
})
