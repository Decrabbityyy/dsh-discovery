/**
 * Version coherence: every peer a package declares must be satisfiable both by
 * the copy it compiles against (a devDependency) and by the copy the running
 * host injects from its own node_modules.
 */

import { installedPackage, satisfies } from '../lib.mjs'

export const id = 'deps'
export const title = 'dependency versions'
export const needsHost = false

/** @param {{ packages: any[], hostByName: Map<string, any>, options: any }} context */
export function run(context) {
  const { packages, hostByName, options, rootManifest } = context
  const rootDevDependencies = rootManifest?.devDependencies ?? {}
  const issues = []
  const lines = []
  const fail = (text) => issues.push({ level: 'fail', text })
  const warn = (text) => issues.push({ level: 'warn', text })

  // The harness channel moves as one: a package left on a different range is a failure.
  const pinned = new Map()
  for (const pkg of packages) {
    for (const [dep, range] of Object.entries(pkg.manifest.devDependencies ?? {})) {
      if (!dep.startsWith('@deepseek-ai/')) continue
      if (!pinned.has(dep)) pinned.set(dep, new Map())
      const byRange = pinned.get(dep)
      byRange.set(range, [...(byRange.get(range) ?? []), pkg.name])
    }
  }
  for (const [dep, byRange] of pinned) {
    if (byRange.size < 2) continue
    fail(dep + ' is pinned to different ranges across packages: '
      + [...byRange.entries()].map(([range, who]) => range + ' (' + who.join(', ') + ')').join(' vs '))
  }

  const rows = new Map()
  let peers = 0
  for (const pkg of packages) {
    const peerMeta = pkg.manifest.peerDependenciesMeta ?? {}
    for (const [dep, peerRange] of Object.entries(pkg.manifest.peerDependencies ?? {})) {
      peers += 1
      const optional = peerMeta[dep]?.optional === true
      const devRange = (pkg.manifest.devDependencies ?? {})[dep] ?? rootDevDependencies[dep]
      const compiled = installedPackage(pkg.dir, dep)
      const host = hostByName.get(dep)

      if (devRange === undefined) {
        if (!optional) warn(pkg.name + ': peer ' + dep + ' is not pinned in devDependencies — tsc resolves whichever copy happens to be hoisted')
      } else if (compiled !== null && !satisfies(compiled.version, devRange).ok) {
        fail(pkg.name + ': installed ' + dep + '@' + compiled.version + ' does not satisfy its devDependency range ' + devRange)
      }
      if (compiled === null) {
        if (!optional) warn(pkg.name + ': peer ' + dep + ' is not installed — type checking falls back to another copy')
      } else {
        const check = satisfies(compiled.version, peerRange)
        if (!check.ok) fail(pkg.name + ': compile-time ' + dep + '@' + compiled.version + ' is outside peer range ' + peerRange + ' (' + check.reason + ')')
      }
      if (host === undefined) {
        if (dep.startsWith('@deepseek-ai/') && hostByName.size > 0) warn(pkg.name + ': no host root provides ' + dep + ' — the plugin would fail to resolve it at runtime')
      } else {
        const check = satisfies(host.version, peerRange)
        if (!check.ok) fail(pkg.name + ': host injects ' + dep + '@' + host.version + ' which is outside peer range ' + peerRange + ' (' + check.reason + ')')
      }
      if (!rows.has(dep)) rows.set(dep, { compiled: compiled?.version ?? null, host: host?.version ?? null, peerRange })
    }
  }

  if (options.verbose) {
    const width = Math.max(12, ...[...rows.keys()].map((dep) => dep.length)) + 2
    lines.push('peer'.padEnd(width) + 'compile-time'.padEnd(20) + 'host'.padEnd(20) + 'peer range')
    for (const [dep, row] of [...rows].sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(dep.padEnd(width)
        + String(row.compiled ?? '—').padEnd(20)
        + String(row.host ?? '—').padEnd(20)
        + row.peerRange)
    }
  }

  const failures = issues.filter((issue) => issue.level === 'fail').length
  return {
    id,
    title,
    status: failures > 0 ? 'fail' : (issues.length > 0 ? 'warn' : 'ok'),
    summary: peers + ' peer declarations across ' + packages.length + ' packages'
      + (failures > 0 ? ', ' + failures + ' violation(s)' : ''),
    lines: [...lines, ...issues.map((issue) => (issue.level === 'fail' ? 'FAIL  ' : 'warn  ') + issue.text)],
  }
}
