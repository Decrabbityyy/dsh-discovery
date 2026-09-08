/**
 * The package contract the host reads before any plugin code runs: the bundle
 * patch layer, the dsh.client declaration, and the exports/files pairs a
 * published tarball must actually contain.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { matchesFilesPattern } from '../lib.mjs'

export const id = 'manifest'
export const title = 'dsh manifest contract'
export const needsHost = false

/** @param {{ packages: any[], hostByName: Map<string, any>, options: any }} context */
export function run(context) {
  const { packages, hostByName } = context
  const issues = []
  const fail = (text) => issues.push({ level: 'fail', text })
  const warn = (text) => issues.push({ level: 'warn', text })
  let declared = 0

  for (const pkg of packages) {
    const manifest = pkg.manifest
    const dsh = manifest.dsh ?? {}
    const files = manifest.files ?? []

    for (const [subpath, value] of Object.entries(manifest.exports ?? {})) {
      if (typeof value !== 'object' || value === null) continue
      for (const [condition, target] of Object.entries(value)) {
        if (typeof target !== 'string' || target.includes('*')) continue
        const relative = target.replace(/^\.\//, '')
        if (files.length > 0 && !matchesFilesPattern(relative, files)) {
          fail(pkg.name + ': exports["' + subpath + '"].' + condition + ' -> ' + relative + ' is not covered by "files"')
        }
        if (!existsSync(join(pkg.dir, relative))) {
          warn(pkg.name + ': ' + relative + ' is not built yet (run pnpm run build)')
        }
      }
    }

    const patch = dsh.bundle?.patch
    if (typeof patch === 'string') {
      declared += 1
      const patchFile = join(pkg.dir, patch)
      if (!existsSync(patchFile)) {
        fail(pkg.name + ': dsh.bundle.patch points at a missing file (' + patch + ') — the host fails to boot the profile')
      } else {
        if (files.length > 0 && !matchesFilesPattern(patch, files)) {
          fail(pkg.name + ': ' + patch + ' is not covered by "files" — the published tarball loses the bundle layer')
        }
        const meaningful = readFileSync(patchFile, 'utf8').split(/\r?\n/)
          .map((line) => line.trim()).filter((line) => line !== '' && !line.startsWith('#'))
        if (meaningful.length === 0) fail(pkg.name + ': ' + patch + ' is empty — the bundle layer inserts nothing')
        else if (meaningful[0] !== '[]' && !meaningful[0].startsWith('-')) {
          fail(pkg.name + ': ' + patch + ' must be a top-level YAML array of loader patches')
        }
        for (const match of readFileSync(patchFile, 'utf8').matchAll(/^\s*(?:-\s*)?name:\s*['"]?([^'"\s]+)['"]?/gm)) {
          const name = match[1]
          if (name === pkg.name) continue
          if ((manifest.peerDependencies ?? {})[name] === undefined && (manifest.dependencies ?? {})[name] === undefined) {
            warn(pkg.name + ': ' + patch + ' references "' + name + '" which is not a declared dependency')
          }
        }
      }
    }

    if (dsh.client === undefined) continue
    declared += 1
    const client = dsh.client
    if (typeof client !== 'object' || client === null) {
      fail(pkg.name + ': dsh.client must be an object')
      continue
    }
    if (typeof client.platform !== 'string') fail(pkg.name + ': dsh.client.platform must be a string')
    else if (client.platform !== 'web') warn(pkg.name + ': dsh.client.platform is "' + client.platform + '"; the web host activates only "web"')
    for (const field of ['inject', 'external']) {
      const value = client[field]
      if (value === undefined) continue
      if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
        fail(pkg.name + ': dsh.client.' + field + ' must be a string array')
      }
    }
    if (client.immediately !== undefined && typeof client.immediately !== 'boolean') {
      fail(pkg.name + ': dsh.client.immediately must be a boolean')
    }
    if ((manifest.exports ?? {})['./client'] === undefined) {
      fail(pkg.name + ': declares dsh.client but exports no "./client" bundle — the host throws while composing the web graph')
    }
    for (const dep of Array.isArray(client.inject) ? client.inject : []) {
      if ((manifest.peerDependencies ?? {})[dep] === undefined && (manifest.dependencies ?? {})[dep] === undefined) {
        warn(pkg.name + ': dsh.client.inject names ' + dep + ' which is not a declared dependency')
      }
      if (hostByName.size > 0 && !hostByName.has(dep)) {
        warn(pkg.name + ': dsh.client.inject names ' + dep + ' which no discovered host root provides')
      }
    }
  }

  const failures = issues.filter((issue) => issue.level === 'fail').length
  return {
    id,
    title,
    status: failures > 0 ? 'fail' : (issues.length > 0 ? 'warn' : 'ok'),
    summary: declared + ' dsh declaration(s) across ' + packages.length + ' packages',
    lines: issues.map((issue) => (issue.level === 'fail' ? 'FAIL  ' : 'warn  ') + issue.text),
  }
}
