/**
 * Runtime surface: every harness specifier a plugin imports must resolve
 * through the host's exports map, and every value it binds must exist in the
 * host's runtime module, not merely in the .d.ts that tsc read.
 */

import { existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { hostEntry, packageNameOf, parseVersion, readJson, scanImports } from '../lib.mjs'

export const id = 'surface'
export const title = 'harness surface'
export const needsHost = true

/** Resolve a specifier from inside a host package, the way Node resolves it at runtime. */
function hostRuntimeFile(hostPackage, specifier) {
  try {
    const require = createRequire(join(hostPackage.dir, 'package.json'))
    return require.resolve(specifier)
  } catch {
    const entry = hostEntry(hostPackage, specifier, 'runtime')
    return entry.ok && existsSync(entry.file) ? entry.file : null
  }
}

/** @param {{ packages: any[], hostByName: Map<string, any>, options: any }} context */
export async function run(context) {
  const { packages, hostByName, options } = context
  const issues = []
  const lines = []
  const fail = (text) => issues.push({ level: 'fail', text })
  const warn = (text) => issues.push({ level: 'warn', text })

  const specifiers = new Map()
  const imported = new Set()
  for (const pkg of packages) {
    const dirs = [join(pkg.dir, 'src')]
    if (options.includeTests) dirs.push(join(pkg.dir, 'tests'))
    for (const dir of dirs) {
      if (!existsSync(dir)) continue
      for (const [spec, hits] of scanImports(dir)) {
        imported.add(packageNameOf(spec))
        if (!specifiers.has(spec)) specifiers.set(spec, { owners: new Set(), names: new Set() })
        const entry = specifiers.get(spec)
        entry.owners.add(pkg.name)
        for (const hit of hits) {
          if (!hit.typeOnly) for (const name of hit.names) entry.names.add(name)
        }
      }
    }
  }

  let checked = 0
  let harness = 0
  for (const [spec, info] of [...specifiers].sort(([a], [b]) => a.localeCompare(b))) {
    const name = packageNameOf(spec)
    if (!name.startsWith('@deepseek-ai/')) continue
    harness += 1
    const hostPackage = hostByName.get(name)
    const entry = hostEntry(hostPackage, spec, 'types')
    if (!entry.ok) {
      fail(spec + ' — ' + entry.reason + ' (imported by ' + [...info.owners].join(', ') + ')')
      continue
    }
    checked += 1
    if (info.names.size === 0) continue
    const runtimeFile = hostRuntimeFile(hostPackage, spec)
    if (runtimeFile === null) {
      warn(spec + ' — host has no runtime file for this subpath')
      continue
    }
    try {
      const module = await import(pathToFileURL(runtimeFile).href)
      const missing = [...info.names].filter((binding) => !(binding in module))
      if (missing.length > 0) {
        fail(spec + ' — host ' + hostPackage.version + ' does not export ' + missing.join(', ')
          + ' (bound by ' + [...info.owners].join(', ') + ')')
      }
    } catch (error) {
      warn(spec + ' — could not load the host copy to verify exports: ' + error.message)
    }
  }

  // One package at two versions across host roots means two cordis instances and
  // two service registries.
  const seen = new Map()
  for (const root of context.hostRoots) {
    const scope = join(root.dir, '@deepseek-ai')
    if (!existsSync(scope)) continue
    for (const entry of readdirSync(scope)) {
      const packageDir = join(scope, entry)
      const manifestFile = join(packageDir, 'package.json')
      if (!existsSync(manifestFile)) continue
      const manifest = readJson(manifestFile)
      if (!seen.has(manifest.name)) seen.set(manifest.name, new Map())
      seen.get(manifest.name).set(manifest.version, [...(seen.get(manifest.name).get(manifest.version) ?? []), root.label])
    }
  }
  for (const [name, versions] of seen) {
    if (versions.size < 2) continue
    const rendered = [...versions.entries()].map(([version, roots]) => version + ' (' + roots.join(', ') + ')').join(' vs ')
    if (!imported.has(name)) continue
    const parsed = [...versions.keys()].map(parseVersion).filter((version) => version !== null)
    const breaking = parsed.some((left) => parsed.some((right) => left !== right
      && (left.major !== right.major || (left.major === 0 && left.minor !== right.minor))))
    if (breaking) warn(name + ' resolves to ' + versions.size + ' incompatible versions across host roots: ' + rendered)
    else lines.push('note  ' + name + ' differs across host roots but stays compatible: ' + rendered)
  }

  const failures = issues.filter((issue) => issue.level === 'fail').length
  return {
    id,
    title,
    status: failures > 0 ? 'fail' : (issues.length > 0 ? 'warn' : 'ok'),
    summary: checked + '/' + harness + ' harness specifiers resolve on the host'
      + (failures > 0 ? ', ' + failures + ' problem(s)' : ''),
    lines: [...lines, ...issues.map((issue) => (issue.level === 'fail' ? 'FAIL  ' : 'warn  ') + issue.text)],
  }
}
