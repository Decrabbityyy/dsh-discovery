/**
 * Shared plumbing for the pre-runtime compatibility gate (pnpm run check).
 * Deliberately dependency-free: the workspace ships neither semver nor a YAML
 * parser, and the gate has to run against a lockfile that was just rewritten.
 */

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

/** Repository root (the pnpm workspace holding the plugin packages). */
export const WORKSPACE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Scratch directory for generated gate artifacts (git-ignored). */
export const REPORT_DIR = join(WORKSPACE_ROOT, '.compat')

/** The scope whose packages the harness host injects into a plugin at runtime. */
export const HARNESS_SCOPE = '@deepseek-ai/'

/** Read and parse a JSON file. */
export function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

/** Workspace-relative display path. */
export function rel(p) {
  const absolute = resolve(p)
  const prefix = WORKSPACE_ROOT + (process.platform === 'win32' ? '\\' : '/')
  return absolute.startsWith(prefix) ? absolute.slice(prefix.length).split('\\').join('/') : absolute
}

/** The workspace packages, in pnpm-workspace.yaml order. */
export function workspacePackages() {
  const workspaceFile = readFileSync(join(WORKSPACE_ROOT, 'pnpm-workspace.yaml'), 'utf8')
  const dirs = []
  let inside = false
  for (const line of workspaceFile.split(/\r?\n/)) {
    if (/^packages\s*:/.test(line)) { inside = true; continue }
    if (inside && /^\S/.test(line)) break
    if (!inside) continue
    const match = /^\s*-\s*['"]?([^'"\s#]+)['"]?/.exec(line)
    if (match !== null) dirs.push(match[1])
  }
  return dirs.map((dir) => {
    const manifest = readJson(join(WORKSPACE_ROOT, dir, 'package.json'))
    return { name: manifest.name, dir: join(WORKSPACE_ROOT, dir), rel: dir, manifest }
  })
}

const IMPORT_FROM = /(?:^|[\n;])\s*import\s+([^'";]*?)\s+from\s*['"]([^'"]+)['"]/g
const IMPORT_BARE = /(?:^|[\n;])\s*import\s*['"]([^'"]+)['"]/g
const IMPORT_DYNAMIC = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
const EXPORT_FROM = /\bexport\s+(?:type\s+)?(?:\{[^}]*\}|\*)\s+from\s*['"]([^'"]+)['"]/g
const REQUIRE_CALL = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g
const DECLARE_MODULE = /\bdeclare\s+module\s+['"]([^'"]+)['"]/g

/**
 * Split one import clause into the bindings it takes. Only NAMED bindings are
 * returned: default and namespace bindings name the module, not an export.
 */
function parseClause(clause) {
  const trimmed = clause.trim()
  const typeOnly = /^type\s/.test(trimmed)
  const body = typeOnly ? trimmed.replace(/^type\s+/, '') : trimmed
  const names = []
  const named = /\{([\s\S]*?)\}/.exec(body)
  if (named !== null) {
    for (const part of named[1].split(',')) {
      const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim()
      if (name !== '') names.push(name)
    }
  }
  return { typeOnly, names }
}

/** True when a specifier is a bare package specifier (not relative/absolute/builtin). */
export function isBare(spec) {
  return !spec.startsWith('.') && !spec.startsWith('/') && !spec.startsWith('node:') && !/^[a-z]+:/.test(spec)
}

/** The package name a specifier belongs to: @scope/name or name. */
export function packageNameOf(spec) {
  return spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
}

/** Every module specifier a directory's TypeScript sources pull in. */
export function scanImports(dir) {
  const found = new Map()
  const record = (spec, file, text, index, typeOnly, names) => {
    if (!isBare(spec)) return
    const line = text.slice(0, index).split('\n').length
    if (!found.has(spec)) found.set(spec, [])
    found.get(spec).push({ file: rel(file), line, typeOnly, names })
  }
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const path = join(current, entry.name)
      if (entry.isDirectory()) { walk(path); continue }
      if (!/\.(m?ts|tsx)$/.test(entry.name)) continue
      const text = readFileSync(path, 'utf8')
      for (const match of text.matchAll(IMPORT_FROM)) {
        const { typeOnly, names } = parseClause(match[1])
        record(match[2], path, text, match.index, typeOnly, names)
      }
      for (const match of text.matchAll(IMPORT_BARE)) record(match[1], path, text, match.index, false, [])
      for (const match of text.matchAll(IMPORT_DYNAMIC)) record(match[1], path, text, match.index, false, [])
      for (const match of text.matchAll(EXPORT_FROM)) record(match[1], path, text, match.index, /export\s+type/.test(match[0]), [])
      for (const match of text.matchAll(REQUIRE_CALL)) record(match[1], path, text, match.index, false, [])
      for (const match of text.matchAll(DECLARE_MODULE)) record(match[1], path, text, match.index, true, [])
    }
  }
  walk(dir)
  return found
}

/**
 * Resolution roots the harness host uses at runtime, highest priority first:
 * explicit --host arguments, the installed dsh CLI tree, then every DSH_HOME
 * profile (which carries the client-side packages the CLI tree lacks).
 */
export function discoverHostRoots(cliHosts = []) {
  const roots = []
  const seen = new Set()
  const add = (dir, label) => {
    if (dir === undefined || dir === null) return
    for (const candidate of [dir, join(dir, 'node_modules')]) {
      if (!existsSync(join(candidate, '@deepseek-ai'))) continue
      const key = resolve(candidate).toLowerCase()
      if (seen.has(key)) return
      seen.add(key)
      roots.push({ dir: resolve(candidate), label })
      // An npm-installed CLI nests its dependency closure one level deeper.
      const nested = join(candidate, '@deepseek-ai', 'dsh', 'node_modules')
      if (existsSync(join(nested, '@deepseek-ai'))) {
        const nestedKey = resolve(nested).toLowerCase()
        if (!seen.has(nestedKey)) {
          seen.add(nestedKey)
          roots.push({ dir: resolve(nested), label: label + ' deps' })
        }
      }
      return
    }
  }
  for (const host of cliHosts) add(host, '--host ' + rel(host))
  // Locate the dsh launcher by scanning PATH instead of spawning "where"/"which":
  // a failed lookup would silently degrade every host-facing check.
  for (const binDir of (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':')) {
    if (binDir === '') continue
    const launchers = process.platform === 'win32'
      ? ['dsh.cmd', 'dsh.exe', 'dsh.ps1', 'dsh']
      : ['dsh']
    for (const launcher of launchers) {
      if (!existsSync(join(binDir, launcher))) continue
      let current = binDir
      for (let depth = 0; depth < 6; depth += 1) {
        if (existsSync(join(current, 'node_modules', '@deepseek-ai', 'dsh'))) {
          add(join(current, 'node_modules'), 'dsh CLI')
          break
        }
        const parent = dirname(current)
        if (parent === current) break
        current = parent
      }
    }
  }
  const home = process.env.DSH_HOME
  if (home !== undefined && existsSync(join(home, 'profiles'))) {
    for (const entry of readdirSync(join(home, 'profiles'), { withFileTypes: true })) {
      if (entry.isDirectory()) add(join(home, 'profiles', entry.name, 'node_modules'), 'profile ' + entry.name)
    }
  }
  return roots
}

/** The @deepseek-ai packages each host root provides, first root winning. */
export function hostPackages(roots) {
  const packages = new Map()
  for (const root of roots) {
    const scope = join(root.dir, '@deepseek-ai')
    if (!existsSync(scope)) continue
    for (const entry of readdirSync(scope, { withFileTypes: true })) {
      // pnpm links packages; a symlink is not a directory entry, so both count.
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
      const dir = join(scope, entry.name)
      const manifestFile = join(dir, 'package.json')
      if (!existsSync(manifestFile)) continue
      const name = HARNESS_SCOPE + entry.name
      if (packages.has(name)) continue
      const manifest = readJson(manifestFile)
      packages.set(name, {
        name, version: manifest.version, dir, root: root.label, exports: manifest.exports ?? null,
      })
    }
  }
  return packages
}

/**
 * Locate any package (scoped or not) in the host roots, not just the
 * @deepseek-ai scope. Host-injected peers must resolve from the SAME tree as the
 * harness packages, or a structural type from one copy fails against the other.
 */
export function hostPackage(roots, name) {
  for (const root of roots) {
    const dir = join(root.dir, ...name.split('/'))
    const manifestFile = join(dir, 'package.json')
    if (!existsSync(manifestFile)) continue
    const manifest = readJson(manifestFile)
    return { name, version: manifest.version, dir, root: root.label, exports: manifest.exports ?? null }
  }
  return undefined
}

/**
 * Whether a resolved entry actually ships type declarations. A JS-only host
 * copy must NOT be mapped into a type-checking program: doing so replaces good
 * local types with implicit any.
 */
export function providesTypes(file) {
  if (file.endsWith('.d.ts')) return true
  if (existsSync(file) && statSync(file).isDirectory()) {
    const manifestFile = join(file, 'package.json')
    if (existsSync(manifestFile)) {
      const manifest = readJson(manifestFile)
      if (typeof manifest.types === 'string' || typeof manifest.typings === 'string') return true
    }
    return existsSync(join(file, 'index.d.ts'))
  }
  return existsSync(file.replace(/\.(js|mjs|cjs)$/, '') + '.d.ts')
}

/** Match one exports-map key, which may contain a single `*`, against a subpath. */
function exportsKeyMatch(key, subpath) {
  if (key === subpath) return {}
  const star = key.indexOf('*')
  if (star === -1) return null
  const prefix = key.slice(0, star)
  const suffix = key.slice(star + 1)
  if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) return null
  return { star: subpath.slice(prefix.length, subpath.length - suffix.length) }
}

/**
 * Resolve a bare specifier inside one host package the way Node resolves it at
 * runtime: through its exports map, falling back to a plain file path for legacy
 * packages.
 * @param {'types'|'runtime'} [field] - which export condition to read
 */
export function hostEntry(hostPackage, specifier, field = 'types') {
  const name = packageNameOf(specifier)
  const rest = specifier.slice(name.length)
  const subpath = rest === '' ? '.' : '.' + rest
  if (hostPackage === undefined) return { ok: false, reason: name + ' is not installed on the host' }
  if (hostPackage.exports === null) {
    return subpath === '.'
      ? { ok: true, file: hostPackage.dir }
      : { ok: true, file: join(hostPackage.dir, rest.replace(/^\//, '')) }
  }
  for (const [key, value] of Object.entries(hostPackage.exports)) {
    if (typeof value !== 'object' || value === null) continue
    const matched = exportsKeyMatch(key, subpath)
    if (matched === null) continue
    const target = field === 'types'
      ? (value.types ?? value.default ?? value.import)
      : (value.default ?? value.import ?? value.types)
    if (typeof target !== 'string') continue
    const expanded = matched.star === undefined ? target : target.replace('*', matched.star)
    if (subpath === '.') return { ok: true, file: hostPackage.dir }
    return { ok: true, file: join(hostPackage.dir, expanded) }
  }
  return { ok: false, reason: name + '@' + hostPackage.version + ' has no export "' + subpath + '"' }
}

/**
 * Resolve a package as installed for one workspace package (its compile-time
 * copy), falling back to a filesystem walk for packages that hide
 * package.json behind an exports map.
 */
export function installedPackage(packageDir, name) {
  const require = createRequire(join(packageDir, 'package.json'))
  try {
    const manifest = require(name + '/package.json')
    return { version: manifest.version, dir: dirname(require.resolve(name + '/package.json')) }
  } catch {
    // Fall through to the walk below.
  }
  let current = packageDir
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(current, 'node_modules', name, 'package.json')
    if (existsSync(candidate)) {
      const manifest = readJson(candidate)
      return { version: manifest.version, dir: dirname(candidate) }
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return null
}

/** Parse `x.y.z[-pre][+build]`; `null` when the string is not a version. */
export function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(value).trim())
  if (match === null) return null
  return {
    major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]),
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  }
}

function comparePrerelease(a, b) {
  if (a.length === 0 && b.length === 0) return 0
  if (a.length === 0) return 1
  if (b.length === 0) return -1
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const left = a[i]
    const right = b[i]
    if (left === undefined) return -1
    if (right === undefined) return 1
    const leftNum = /^\d+$/.test(left)
    const rightNum = /^\d+$/.test(right)
    if (leftNum && rightNum) {
      if (Number(left) !== Number(right)) return Number(left) < Number(right) ? -1 : 1
    } else if (leftNum !== rightNum) {
      return leftNum ? -1 : 1
    } else if (left !== right) {
      return left < right ? -1 : 1
    }
  }
  return 0
}

/** Standard semver precedence, as -1, 0, or 1. */
export function compareVersions(a, b) {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1
  return comparePrerelease(a.prerelease, b.prerelease)
}

function caretUpper(target) {
  if (target.major > 0) return { major: target.major + 1, minor: 0, patch: 0, prerelease: [] }
  if (target.minor > 0) return { major: 0, minor: target.minor + 1, patch: 0, prerelease: [] }
  return { major: 0, minor: 0, patch: target.patch + 1, prerelease: [] }
}

function comparatorHolds(version, operator, target) {
  const order = compareVersions(version, target)
  if (operator === '>=') return order >= 0
  if (operator === '>') return order > 0
  if (operator === '<=') return order <= 0
  if (operator === '<') return order < 0
  if (operator === '~') {
    const upper = { major: target.major, minor: target.minor + 1, patch: 0, prerelease: [] }
    return order >= 0 && compareVersions(version, upper) < 0
  }
  if (operator === '^') return order >= 0 && compareVersions(version, caretUpper(target)) < 0
  return order === 0
}

/**
 * Whether a version satisfies a range, with npm's prerelease rule: a prerelease
 * version matches only when a comparator names the same x.y.z tuple.
 */
export function satisfies(version, range) {
  const parsed = parseVersion(version)
  if (parsed === null) return { ok: false, reason: 'unparseable version "' + version + '"' }
  const alternatives = String(range).split('||').map((part) => part.trim()).filter((part) => part !== '')
  if (alternatives.length === 0) return { ok: false, reason: 'empty range' }
  const reasons = []
  for (const alternative of alternatives) {
    if (alternative === '*' || alternative === 'x') return { ok: true }
    const comparators = alternative.split(/\s+/).filter((part) => part !== '')
    let held = true
    let failed = null
    for (const comparator of comparators) {
      const match = /^(\^|~|>=|<=|>|<|=)?\s*(.+)$/.exec(comparator)
      const target = parseVersion(match[2])
      if (target === null) { held = false; failed = 'unsupported comparator "' + comparator + '"'; break }
      if (!comparatorHolds(parsed, match[1] ?? '=', target)) {
        held = false
        failed = version + ' does not satisfy "' + comparator + '"'
        break
      }
    }
    if (held && parsed.prerelease.length > 0) {
      const twin = comparators.some((comparator) => {
        const match = /^(\^|~|>=|<=|>|<|=)?\s*(.+)$/.exec(comparator)
        const target = parseVersion(match[2])
        return target !== null && target.prerelease.length > 0
          && target.major === parsed.major && target.minor === parsed.minor && target.patch === parsed.patch
      })
      if (!twin) {
        held = false
        failed = version + ' is a prerelease and "' + alternative + '" has no prerelease comparator for '
          + parsed.major + '.' + parsed.minor + '.' + parsed.patch
      }
    }
    if (held) return { ok: true }
    reasons.push(failed)
  }
  return { ok: false, reason: reasons.join('; ') }
}

/** Path to the workspace's TypeScript compiler entry, or null. */
export function tscBin() {
  const require = createRequire(join(WORKSPACE_ROOT, 'package.json'))
  try {
    return join(dirname(require.resolve('typescript/package.json')), 'bin', 'tsc')
  } catch {
    return null
  }
}

/**
 * Run a child process and capture its output through a log FILE rather than a
 * pipe: piped stdio is unavailable under some sandboxes, and the gate must never
 * confuse "could not run the compiler" with "compiles cleanly".
 */
export function spawnCapture(command, args, cwd = WORKSPACE_ROOT) {
  mkdirSync(REPORT_DIR, { recursive: true })
  const logFile = join(REPORT_DIR, 'last-command.log')
  const fd = openSync(logFile, 'w')
  try {
    const result = spawnSync(command, args, { cwd, stdio: ['ignore', fd, fd] })
    return { status: result.status, output: readFileSync(logFile, 'utf8'), error: result.error ?? null }
  } finally {
    closeSync(fd)
  }
}

/** Run the compiler on one project and parse its diagnostics. */
export function runTsc(projectFile) {
  const bin = tscBin()
  if (bin === null) return { code: null, errors: [], raw: 'typescript is not installed in the workspace', failed: true }
  const result = spawnCapture(process.execPath, [bin, '-p', projectFile, '--pretty', 'false'])
  if (result.error !== null) {
    return { code: null, errors: [], raw: 'could not start tsc: ' + result.error.message, failed: true }
  }
  const raw = result.output
  const errors = []
  for (const line of raw.split(/\r?\n/)) {
    const located = /^(.+?)\((\d+),(\d+)\): (?:error|warning) (TS\d+): (.*)$/.exec(line.trim())
    if (located !== null) {
      errors.push({ file: rel(located[1]), line: Number(located[2]), column: Number(located[3]), code: located[4], message: located[5] })
      continue
    }
    const fileWide = /^(.+?): (?:error|warning) (TS\d+): (.*)$/.exec(line.trim())
    if (fileWide !== null) errors.push({ file: rel(fileWide[1]), line: 0, column: 0, code: fileWide[2], message: fileWide[3] })
  }
  return { code: result.status, errors, raw, failed: result.status !== 0 }

}

/** Glob a package.json "files" pattern against a package-relative path. */
export function matchesFilesPattern(target, patterns) {
  const relativePath = target.replace(/^\.\//, '').split('\\').join('/')
  for (const pattern of patterns) {
    const cleaned = pattern.replace(/^\.\//, '').replace(/\/+$/, '').split('\\').join('/')
    if (cleaned === relativePath || cleaned === relativePath.replace(/\/.*$/, '')) return true
    if (!cleaned.includes('*')) {
      if (relativePath === cleaned || relativePath.startsWith(cleaned + '/')) return true
      continue
    }
    const regex = new RegExp('^' + cleaned
      .replace(/[.+?^$()|[\]{}\\]/g, '\\$&')
      .replace(/\*\*\//g, '(?:.*/)?')
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*') + '$')
    if (regex.test(relativePath)) return true
  }
  return false
}
