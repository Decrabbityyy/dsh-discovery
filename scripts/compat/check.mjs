#!/usr/bin/env node
/**
 * Pre-runtime compatibility checks. Run them after any dependency bump, before
 * starting the harness.
 *
 * Exit 0 = compatible (warnings allowed), 1 = a check failed, 2 = bad arguments
 * or `--require-host` without a host tree.
 */

import { WORKSPACE_ROOT, hostPackages, discoverHostRoots, installedPackage, readJson, workspacePackages } from './lib.mjs'
import { join } from 'node:path'
import * as deps from './checks/deps.mjs'
import * as piAi from './checks/pi-ai.mjs'
import * as surface from './checks/surface.mjs'
import * as types from './checks/types.mjs'
import * as hostTypes from './checks/host-types.mjs'
import * as manifest from './checks/manifest.mjs'

const CHECKS = [deps, piAi, surface, types, hostTypes, manifest]
const STATUS = { ok: 'ok', warn: 'warn', fail: 'FAIL', skip: 'skip' }

function parseArgs(argv) {
  const options = { only: null, hosts: [], includeTests: true, verbose: false, requireHost: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--only') options.only = String(argv[++i] ?? '').split(',').map((part) => part.trim()).filter(Boolean)
    else if (arg === '--host') options.hosts.push(String(argv[++i] ?? ''))
    else if (arg === '--no-tests') options.includeTests = false
    else if (arg === '--verbose') options.verbose = true
    else if (arg === '--require-host') options.requireHost = true
    else if (arg === '--help' || arg === '-h') {
      console.log('usage: node scripts/compat/check.mjs [--only <ids>] [--host <dir>] [--no-tests] [--verbose] [--require-host]')
      console.log('checks: ' + CHECKS.map((check) => check.id).join(', '))
      process.exit(0)
    } else {
      console.error('unknown option: ' + arg)
      process.exit(2)
    }
  }
  return options
}

function pad(text, width) {
  return text.length >= width ? text + ' ' : text + ' ' + '.'.repeat(width - text.length) + ' '
}

const options = parseArgs(process.argv.slice(2))
const packages = workspacePackages()
const hostRoots = discoverHostRoots(options.hosts)
const hostByName = hostPackages(hostRoots)

const compileVersions = new Map()
for (const pkg of packages) {
  for (const dep of Object.keys(pkg.manifest.devDependencies ?? {})) {
    if (!dep.startsWith('@deepseek-ai/')) continue
    const installed = installedPackage(pkg.dir, dep)
    if (installed === null) continue
    if (!compileVersions.has(dep)) compileVersions.set(dep, new Set())
    compileVersions.get(dep).add(installed.version)
  }
}

console.log('dsh plugin compatibility checks')
console.log('  workspace  ' + packages.length + ' package(s): ' + packages.map((pkg) => pkg.name).join(', '))
const compileSummary = [...compileVersions.entries()].map(([name, versions]) => name.replace('@deepseek-ai/', '') + ' ' + [...versions].join('/'))
console.log('  compiled   ' + (compileSummary.length > 0 ? compileSummary.join(' · ') : '(nothing installed — run pnpm install)'))
if (hostRoots.length === 0) {
  console.log('  host       (not found — pass --host <dir> or set DSH_HOME)')
} else {
  for (const root of hostRoots) {
    const names = [...hostByName.values()].filter((pkg) => pkg.root === root.label)
    const versions = [...new Set(names.map((pkg) => pkg.version))]
    console.log('  host       ' + pad(root.label, 14) + (versions.length === 1 ? versions[0] : versions.join(' / ') || '—') + '  ' + root.dir)
  }
}
console.log('')

const context = { packages, hostRoots, hostByName, options, rootManifest: readJson(join(WORKSPACE_ROOT, 'package.json')) }
if (options.requireHost && hostRoots.length === 0) {
  console.error('RESULT: --require-host was given but no host tree was found (pass --host <dir> or set DSH_HOME).')
  process.exit(2)
}
const selected = options.only === null ? CHECKS : CHECKS.filter((check) => options.only.includes(check.id))
const results = []
for (let index = 0; index < selected.length; index += 1) {
  const check = selected[index]
  const label = '[' + (index + 1) + '/' + selected.length + '] ' + check.title
  if (check.needsHost && hostByName.size === 0) {
    console.log(pad(label, 46) + 'skip  no host tree discovered')
    results.push({ status: 'skip' })
    continue
  }
  let result
  try {
    result = await check.run(context)
  } catch (error) {
    result = { id: check.id, title: check.title, status: 'fail', summary: 'check crashed: ' + error.message, lines: [error.stack ?? ''] }
  }
  console.log(pad(label, 46) + pad(STATUS[result.status], 5) + result.summary)
  for (const line of result.lines) console.log('      ' + line)
  results.push(result)
}

const failed = results.filter((result) => result.status === 'fail')
const warned = results.filter((result) => result.status === 'warn')
console.log('')
if (failed.length > 0) {
  console.log('RESULT: ' + failed.length + ' check(s) failed — fix these before starting the harness.')
  process.exit(1)
}
if (warned.length > 0) {
  console.log('RESULT: pass with ' + warned.length + ' warning(s).')
  process.exit(0)
}
console.log('RESULT: compatible.')
