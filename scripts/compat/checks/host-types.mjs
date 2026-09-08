/**
 * The core check: type-check the plugin sources (and specs) against the
 * declarations the RUNNING host supplies, not the compile-time copies in this
 * workspace's node_modules. Diagnostics land at the exact file:line that must
 * change.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPORT_DIR, hostEntry, hostPackage, packageNameOf, providesTypes, rel, runTsc, scanImports } from '../lib.mjs'

export const id = 'host-types'
export const title = 'plugin sources vs host declarations'
export const needsHost = true

const PROJECT_DIR = join(REPORT_DIR, 'host-types')
const PROJECT_FILE = join(PROJECT_DIR, 'tsconfig.json')

/** @param {{ packages: any[], hostByName: Map<string, any>, options: any }} context */
export function generateProject(context) {
  const { packages, hostByName, options } = context
  const paths = {}
  const include = []
  const specifiers = new Map()
  const unmapped = []
  const mapped = new Map()
  // Host-injected third-party peers must be checked against the host's copy;
  // ordinary bundled dependencies must not.
  const peerNames = new Set()
  for (const pkg of packages) for (const name of Object.keys(pkg.manifest.peerDependencies ?? {})) peerNames.add(name)

  for (const pkg of packages) {
    const dirs = ['src']
    if (options.includeTests) dirs.push('tests')
    for (const dir of dirs) {
      const absolute = join(pkg.dir, dir)
      if (!existsSync(absolute)) continue
      include.push('../../' + pkg.rel + '/' + dir)
      for (const [spec, hits] of scanImports(absolute)) {
        if (!specifiers.has(spec)) specifiers.set(spec, [])
        specifiers.get(spec).push(...hits)
      }
    }
    // Sibling workspace packages resolve to their sources, so the check runs on
    // a clean checkout before any build.
    for (const sibling of packages) {
      if (sibling.name === pkg.name) continue
      for (const subpath of Object.keys(sibling.manifest.exports ?? {})) {
        const spec = subpath === '.' ? sibling.name : sibling.name + subpath.slice(1)
        const source = subpath === '.'
          ? join(sibling.dir, 'src', 'index.ts')
          : join(sibling.dir, 'src', subpath.replace(/^\.\//, '') + '.ts')
        if (existsSync(source)) paths[spec] = [source]
      }
    }
  }

  for (const [spec, hits] of [...specifiers].sort(([a], [b]) => a.localeCompare(b))) {
    const name = packageNameOf(spec)
    // Harness packages come from the host; host-injected third-party peers must
    // come from the SAME tree, or a structural type from one copy is rejected by
    // the other. Everything else keeps its normal resolution.
    const harness = name.startsWith('@deepseek-ai/')
    if (!harness && !peerNames.has(name)) continue
    const host = harness ? hostByName.get(name) : hostPackage(context.hostRoots, name)
    if (host === undefined) {
      if (harness) unmapped.push({ spec, reason: 'no host root provides ' + name, hits })
      continue
    }
    const entry = hostEntry(host, spec, 'types')
    if (!entry.ok) {
      if (harness) unmapped.push({ spec, reason: entry.reason, hits })
      continue
    }
    if (!providesTypes(entry.file)) continue
    paths[spec] = [entry.file]
    mapped.set(spec, host.version)
  }

  mkdirSync(PROJECT_DIR, { recursive: true })
  const config = {
    compilerOptions: {
      target: 'es2024',
      module: 'esnext',
      moduleResolution: 'bundler',
      strict: true,
      noUncheckedIndexedAccess: true,
      exactOptionalPropertyTypes: true,
      noImplicitOverride: true,
      noFallthroughCasesInSwitch: true,
      noEmit: true,
      skipLibCheck: true,
      esModuleInterop: true,
      allowImportingTsExtensions: true,
      resolveJsonModule: true,
      verbatimModuleSyntax: false,
      jsx: 'react-jsx',
      lib: ['ES2024', 'DOM', 'DOM.Iterable'],
      types: ['node'],
      paths,
    },
    include,
  }
  writeFileSync(PROJECT_FILE, JSON.stringify(config, null, 2) + '\n')
  return { projectFile: PROJECT_FILE, paths, include, unmapped, mapped }
}

/** @param {{ packages: any[], hostByName: Map<string, any>, options: any }} context */
export function run(context) {
  const generated = generateProject(context)
  const lines = []
  let failures = 0
  for (const item of generated.unmapped) {
    failures += 1
    lines.push('FAIL  ' + item.spec + ' — ' + item.reason
      + ' (imported by ' + [...new Set(item.hits.map((hit) => hit.file))].join(', ') + ')')
  }
  const result = runTsc(generated.projectFile)
  if (result.failed) {
    failures += 1
    for (const error of result.errors.slice(0, 60)) {
      lines.push('FAIL  ' + error.file + (error.line > 0 ? ':' + error.line + ':' + error.column : '')
        + '  ' + error.code + '  ' + error.message)
    }
    if (result.errors.length === 0) {
      lines.push('FAIL  compiler failed: ' + result.raw.trim().split(/\r?\n/).slice(0, 6).join('\n        '))
    }
  }
  return {
    id,
    title,
    status: failures > 0 ? 'fail' : 'ok',
    summary: generated.mapped.size + ' specifiers checked against host types'
      + (failures > 0 ? ', ' + failures + ' problem(s)' : ''),
    lines: [
      ...lines,
      ...(failures > 0 ? ['', 'generated project: ' + rel(generated.projectFile)] : []),
    ],
  }
}
