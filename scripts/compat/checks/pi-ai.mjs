/**
 * pi-ai alignment: the copy these packages compile against must be the one the
 * harness adapter they plug into depends on. pi-ai is the single dependency
 * whose type identity crosses the plugin boundary: an assembled
 * `ResolvedPiAiProviderProfile` carries the host's `Provider`, so a second copy
 * in the tree makes two structurally different types meet. The authority is the
 * `@earendil-works/pi-ai` range declared by the `@deepseek-ai/dsh-llm-pi-ai`
 * this workspace installs.
 */

import { join } from 'node:path'
import { installedPackage, readJson, satisfies } from '../lib.mjs'

export const id = 'pi-ai'
export const title = 'pi-ai alignment'
export const needsHost = false

const DEP = '@earendil-works/pi-ai'
const AUTHORITY = '@deepseek-ai/dsh-llm-pi-ai'
const SECTIONS = ['peerDependencies', 'devDependencies']

/**
 * The pi-ai range the harness adapter pins, taken from the installed copy this
 * workspace compiles against; `null` when nothing is installed yet.
 */
export function authorityOf(packages) {
  for (const pkg of packages) {
    const installed = installedPackage(pkg.dir, AUTHORITY)
    if (installed === null) continue
    const manifest = readJson(join(installed.dir, 'package.json'))
    const range = manifest.dependencies?.[DEP]
    if (range !== undefined) return { range, version: installed.version }
  }
  return null
}

export function declarationsOf(packages) {
  const found = []
  for (const pkg of packages) {
    for (const section of SECTIONS) {
      const declared = pkg.manifest[section]?.[DEP]
      if (declared !== undefined) found.push({ name: pkg.name, section, declared })
    }
  }
  return found
}

export function run(context) {
  const { packages, hostByName } = context
  const issues = []
  const lines = []
  const fail = (text) => issues.push({ level: 'fail', text })
  const warn = (text) => issues.push({ level: 'warn', text })

  const authority = authorityOf(packages)
  if (authority === null) {
    return {
      id,
      title,
      status: 'warn',
      summary: AUTHORITY + ' is not installed — nothing to align against (run pnpm install)',
      lines: [],
    }
  }

  const declared = declarationsOf(packages)
  lines.push('authority  ' + AUTHORITY + '@' + authority.version + ' declares ' + DEP + ' ' + authority.range)

  const ranges = [...new Set(declared.map((entry) => entry.declared))]
  lines.push('declared   ' + ranges.join(' / ') + '  (' + declared.length + ' declaration(s) across '
    + new Set(declared.map((entry) => entry.name)).size + ' package(s))')

  const installedVersions = new Set()
  for (const pkg of packages) {
    const installed = installedPackage(pkg.dir, DEP)
    if (installed === null) continue
    installedVersions.add(installed.version)
    const check = satisfies(installed.version, authority.range)
    if (!check.ok) {
      fail(pkg.name + ': installed ' + DEP + '@' + installed.version + ' does not satisfy '
        + authority.range + ' (' + check.reason + ')')
    }
  }
  if (installedVersions.size > 0) lines.push('installed  ' + [...installedVersions].join(' / '))

  for (const entry of declared) {
    if (entry.declared === authority.range) continue
    fail(entry.name + ' ' + entry.section + ' pins ' + DEP + ' ' + entry.declared + ', but '
      + AUTHORITY + '@' + authority.version + ' depends on ' + authority.range
      + ' — run "pnpm run sync:pi-ai"')
  }

  // A host on another channel line is reported as a warning, never a failure.
  const hostPiAi = hostByName.get(AUTHORITY)
  if (hostPiAi !== undefined) {
    const manifest = readJson(join(hostPiAi.dir, 'package.json'))
    const hostRange = manifest.dependencies?.[DEP]
    if (hostRange !== undefined && hostRange !== authority.range) {
      warn('host ' + AUTHORITY + '@' + hostPiAi.version + ' depends on ' + DEP + ' ' + hostRange
        + ' while this repo mirrors ' + authority.range + ' (' + AUTHORITY + '@' + authority.version
        + ') — expected while the repo spans more than one harness channel')
    }
  }

  const failures = issues.filter((issue) => issue.level === 'fail').length
  return {
    id,
    title,
    status: failures > 0 ? 'fail' : (issues.length > 0 ? 'warn' : 'ok'),
    summary: declared.length + ' declaration(s) mirroring ' + AUTHORITY + '@' + authority.version
      + (failures > 0 ? ', ' + failures + ' violation(s)' : ''),
    lines: [...lines, ...issues.map((issue) => (issue.level === 'fail' ? 'FAIL  ' : 'warn  ') + issue.text)],
  }
}
