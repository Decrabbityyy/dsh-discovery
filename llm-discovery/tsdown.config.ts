import { defineConfig } from 'tsdown'

// The plugin row plus the library entries the other packages inline; the
// harness-side peers and zod stay external and resolve from the installation.
export default defineConfig({
  entry: [
    'src/index.ts',
    'src/engine.ts',
    'src/vocabulary.ts',
    'src/catalog/models-dev.ts',
    'src/invariant.ts',
  ],
  outDir: 'lib',
  format: ['esm'],
  deps: { neverBundle: [/^@deepseek-ai\//, /^@earendil-works\//, 'zod'] },
  dts: false,
  clean: false,
  outExtensions: () => ({ js: '.js' }),
})
