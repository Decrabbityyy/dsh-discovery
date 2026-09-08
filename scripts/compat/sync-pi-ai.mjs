#!/usr/bin/env node
/**
 * Mirror the pi-ai range the harness adapter pins. `@earendil-works/pi-ai` is
 * not ours to choose: the profile hands over objects typed by
 * `@deepseek-ai/dsh-llm-pi-ai`'s own copy, so compiling against a different
 * pi-ai makes two structurally different `Provider` types meet. The authority
 * is the range declared by the `@deepseek-ai/dsh-llm-pi-ai` this workspace
 * installs.
 *
 * Exit 0 = every declaration matches, 1 = drift (with `--check`), 2 = the
 * authority package is not installed.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { workspacePackages } from './lib.mjs'
import { authorityOf, declarationsOf } from './checks/pi-ai.mjs'

const DEP = '@earendil-works/pi-ai'
const SECTIONS = ['peerDependencies', 'devDependencies']

const check = process.argv.includes('--check')
const packages = workspacePackages()
const authority = authorityOf(packages)
if (authority === null) {
  console.error('sync-pi-ai: the pinned @deepseek-ai/dsh-llm-pi-ai is not installed — run pnpm install first')
  process.exit(2)
}
console.log('@deepseek-ai/dsh-llm-pi-ai@' + authority.version + ' depends on ' + DEP + ' ' + authority.range)

const drift = declarationsOf(packages).filter((entry) => entry.declared !== authority.range)
if (drift.length === 0) {
  console.log('every declaration already mirrors ' + authority.range)
  process.exit(0)
}
for (const entry of drift) {
  console.log((check ? 'DRIFT  ' : 'update ') + entry.name + ' ' + entry.section + ': '
    + entry.declared + ' -> ' + authority.range)
}
if (check) process.exit(1)

for (const dir of new Set(drift.map((entry) => packages.find((pkg) => pkg.name === entry.name).dir))) {
  const file = join(dir, 'package.json')
  const manifest = JSON.parse(readFileSync(file, 'utf8'))
  for (const section of SECTIONS) {
    if (manifest[section]?.[DEP] !== undefined) manifest[section][DEP] = authority.range
  }
  writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n')
  console.log('rewrote ' + file)
}
console.log('run pnpm install to refresh the lockfile')
