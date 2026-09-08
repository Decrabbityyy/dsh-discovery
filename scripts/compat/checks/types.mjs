/**
 * Workspace types: src AND tests, checked with noEmit. The build's `tsc -b`
 * covers src alone and tsdown transpiles without checking.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { WORKSPACE_ROOT, rel, runTsc } from '../lib.mjs'

export const id = 'types'
export const title = 'workspace types (src + tests)'
export const needsHost = false

const PROJECTS = ['tsconfig.check.host.json', 'tsconfig.check.client.json']

export function run() {
  const lines = []
  let failures = 0
  let checked = 0
  for (const project of PROJECTS) {
    const file = join(WORKSPACE_ROOT, project)
    if (!existsSync(file)) {
      lines.push('skip  ' + project + ' is missing')
      continue
    }
    checked += 1
    const result = runTsc(file)
    if (!result.failed) continue
    failures += 1
    lines.push('FAIL  ' + project + ' (' + result.errors.length + ' diagnostic(s))')
    for (const error of result.errors.slice(0, 40)) {
      lines.push('        ' + error.file + (error.line > 0 ? ':' + error.line + ':' + error.column : '')
        + '  ' + error.code + '  ' + error.message)
    }
    if (result.errors.length === 0) lines.push('        ' + result.raw.trim().split(/\r?\n/).slice(0, 6).join('\n        '))
  }
  return {
    id,
    title,
    status: failures > 0 ? 'fail' : (checked === 0 ? 'skip' : 'ok'),
    summary: checked + ' project(s) checked',
    lines,
  }
}
