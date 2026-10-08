#!/usr/bin/env node
// Bundle-size check for the `teamplay` main entry.
//
// Bundles a typical app entry
//   import { $, useSub, sub, observer } from 'teamplay'
// (react external) with esbuild, minified, and prints raw and gzip bytes for:
//   tree-shaken  esbuild with tree shaking, dependencies bundled (webpack/Vite-like)
//   metro-like   no tree shaking, dependencies bundled: every module reachable
//                from the entry ships whole, as with Metro (React Native / Expo)
//   own-code     no tree shaking, only teamplay's own packages (other deps external)
// and which src/diagnostics/* modules end up in the metro-like bundle.
//
// Usage (from the repo root):
//   node scripts/bundle-size.mjs                       # the working tree
//   node scripts/bundle-size.mjs master teamplay-leakfix .
//   node scripts/bundle-size.mjs master ../other-checkout
//   node scripts/bundle-size.mjs --json master .
//   node scripts/bundle-size.mjs --check               # exit 1 if a diagnostics module
//                                                      # other than hooks.ts reaches the
//                                                      # main entry of the working tree
// A source is "." (this working tree, tracked and untracked files), a path to
// another checkout (a directory with packages/teamplay) or a git ref (read with
// `git archive`). Each is copied into a temp dir; third-party dependencies
// resolve from this checkout's node_modules. esbuild comes from node_modules
// (a transitive dependency of the docs tooling).
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, readdirSync, existsSync, realpathSync, copyFileSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const WORKTREE = '.'

// Modules that must never be reachable from the main entry: they hold the
// collectors, leak checks, instrumentation and trace buffers and are loaded
// only through 'teamplay/diagnostics'.
const ALLOWED_DIAGNOSTICS_MODULES = new Set(['hooks.ts'])

const DEFAULT_ENTRY = [
  "import { $, useSub, sub, observer } from 'teamplay'",
  'globalThis.__app = [$, useSub, sub, observer]'
].join('\n')

const MODES = [
  { name: 'tree-shaken', treeShaking: true, ownOnly: false },
  { name: 'metro-like', treeShaking: false, ownOnly: false },
  { name: 'own-code', treeShaking: false, ownOnly: true }
]

const REACT_EXTERNALS = ['react', 'react-dom', 'react-dom/*', 'react/*', 'react-native', '@react-native-async-storage/async-storage']

async function loadEsbuild () {
  try {
    return await import('esbuild')
  } catch {
    console.error('esbuild is not installed in node_modules (run `yarn install`).')
    process.exit(2)
  }
}

function parseArgs (argv) {
  const options = { refs: [], json: false, check: false, entry: DEFAULT_ENTRY }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--json') options.json = true
    else if (arg === '--check') options.check = true
    else if (arg === '--entry') options.entry = argv[++i]
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/bundle-size.mjs [--json] [--check] [--entry <code>] [ref ...]  (ref "." = working tree)')
      process.exit(0)
    } else options.refs.push(arg)
  }
  if (options.refs.length === 0) options.refs.push(WORKTREE)
  return options
}

function isCheckout (ref) {
  return ref !== WORKTREE && existsSync(join(ref, 'packages', 'teamplay', 'package.json'))
}

function git (cwd, args, options = {}) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'ignore'], ...options })
}

// Copies packages/ of a checkout: tracked and untracked (not ignored) files of
// a git checkout, or everything but node_modules and dist otherwise.
function copyPackages (checkout, tmp) {
  let files
  try {
    files = git(checkout, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', 'packages']).split('\0')
  } catch {
    cpSync(join(checkout, 'packages'), join(tmp, 'packages'), {
      recursive: true,
      filter: path => !/[\\/](node_modules|dist)([\\/]|$)/.test(path)
    })
    return
  }
  for (const file of files) {
    if (!file || !existsSync(join(checkout, file))) continue
    mkdirSync(dirname(join(tmp, file)), { recursive: true })
    copyFileSync(join(checkout, file), join(tmp, file))
  }
}

function describeCheckout (checkout, name) {
  try {
    const sha = git(checkout, ['rev-parse', '--short', 'HEAD']).trim()
    const dirty = git(checkout, ['status', '--porcelain', '--', 'packages']).trim()
    return `${name} (${sha}${dirty ? '+changes' : ''})`
  } catch {
    return name
  }
}

// A temp dir holding the chosen source's packages/ and node_modules/{teamplay,
// @teamplay/*} links to them, so the entry and teamplay's cross-package imports
// resolve to that source while third-party deps resolve from ROOT/node_modules.
// Every source gets the same layout, so module paths (kept by esbuild in CJS
// wrappers) and therefore sizes are comparable.
function prepareSource (ref) {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'teamplay-bundle-size-')))
  const packagesDir = join(tmp, 'packages')
  let label
  // The root tsconfig.json comes along: esbuild reads verbatimModuleSyntax from
  // it and then keeps value imports that are unused, as tsc does in dist/.
  if (ref === WORKTREE || isCheckout(ref)) {
    const checkout = ref === WORKTREE ? ROOT : resolve(ref)
    label = describeCheckout(checkout, ref === WORKTREE ? 'working tree' : ref)
    copyPackages(checkout, tmp)
    if (existsSync(join(checkout, 'tsconfig.json'))) copyFileSync(join(checkout, 'tsconfig.json'), join(tmp, 'tsconfig.json'))
  } else {
    label = `${ref} (${git(ROOT, ['rev-parse', '--short', ref]).trim()})`
    const hasTsconfig = git(ROOT, ['ls-tree', '--name-only', ref, 'tsconfig.json']).trim() !== ''
    const paths = hasTsconfig ? ['packages', 'tsconfig.json'] : ['packages']
    const tar = execFileSync('git', ['archive', '--format=tar', ref, ...paths], { cwd: ROOT, maxBuffer: 1 << 30 })
    execFileSync('tar', ['-x', '-C', tmp], { input: tar })
  }
  const nodeModules = join(tmp, 'node_modules')
  mkdirSync(join(nodeModules, '@teamplay'), { recursive: true })
  symlinkSync(join(packagesDir, 'teamplay'), join(nodeModules, 'teamplay'), 'dir')
  for (const name of readdirSync(packagesDir)) {
    if (name === 'teamplay' || !existsSync(join(packagesDir, name, 'package.json'))) continue
    symlinkSync(join(packagesDir, name), join(nodeModules, '@teamplay', name), 'dir')
  }
  return { tmp, packagesDir, label }
}

// Marks every bare import outside teamplay's own packages as external.
function ownCodeOnlyPlugin () {
  return {
    name: 'own-code-only',
    setup (build) {
      build.onResolve({ filter: /^[^./]/ }, args => {
        if (args.path === 'teamplay' || args.path.startsWith('teamplay/')) return undefined
        if (args.path.startsWith('@teamplay/') && !args.path.startsWith('@teamplay/sockjs')) return undefined
        return { path: args.path, external: true }
      })
    }
  }
}

async function measure (esbuild, source, entry, mode) {
  const result = await esbuild.build({
    stdin: { contents: entry, resolveDir: source.tmp, sourcefile: 'app-entry.js', loader: 'js' },
    // same relative module paths (kept in CJS wrappers) for every source
    absWorkingDir: dirname(source.packagesDir),
    bundle: true,
    write: false,
    minify: true,
    treeShaking: mode.treeShaking,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    conditions: ['teamplay-ts'],
    nodePaths: [join(ROOT, 'node_modules')],
    external: REACT_EXTERNALS,
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: mode.ownOnly ? [ownCodeOnlyPlugin()] : [],
    metafile: true,
    logLevel: 'silent'
  })
  const code = result.outputFiles[0].contents
  const output = Object.values(result.metafile.outputs)[0]
  const diagnosticsModules = []
  const teamplaySrc = join(source.packagesDir, 'teamplay', 'src') + sep
  for (const [input, info] of Object.entries(output.inputs)) {
    const absolute = resolve(dirname(source.packagesDir), input)
    if (!absolute.startsWith(teamplaySrc)) continue
    const rel = relative(teamplaySrc, absolute).split(sep).join('/')
    if (rel.startsWith('diagnostics/')) diagnosticsModules.push({ module: rel, bytes: info.bytesInOutput })
  }
  return {
    mode: mode.name,
    raw: code.length,
    gzip: gzipSync(code, { level: 9 }).length,
    diagnosticsModules
  }
}

function formatBytes (n) {
  return n.toLocaleString('en-US')
}

function forbiddenModules (row) {
  return row.diagnosticsModules
    .map(item => item.module.slice('diagnostics/'.length))
    .filter(name => !ALLOWED_DIAGNOSTICS_MODULES.has(name))
}

async function main () {
  const options = parseArgs(process.argv.slice(2))
  const esbuild = await loadEsbuild()
  const report = []
  for (const ref of options.refs) {
    const source = prepareSource(ref)
    try {
      const rows = []
      for (const mode of MODES) rows.push(await measure(esbuild, source, options.entry, mode))
      report.push({ ref, label: source.label, rows })
    } finally {
      rmSync(source.tmp, { recursive: true, force: true })
    }
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    const base = report[0]
    console.log(`entry: ${options.entry.split('\n')[0]}  (react external, minified, gzip -9)\n`)
    const header = ['source', 'mode', 'raw', 'gzip', ...(report.length > 1 ? ['Δgzip vs ' + base.ref] : [])]
    const lines = [header]
    for (const item of report) {
      for (const row of item.rows) {
        const baseRow = base.rows.find(candidate => candidate.mode === row.mode)
        const delta = row.gzip - baseRow.gzip
        lines.push([
          item.label,
          row.mode,
          formatBytes(row.raw),
          formatBytes(row.gzip),
          ...(report.length > 1 ? [(delta >= 0 ? '+' : '') + formatBytes(delta)] : [])
        ])
      }
    }
    const widths = header.map((_, column) => Math.max(...lines.map(line => String(line[column]).length)))
    for (const line of lines) {
      console.log(line.map((cell, column) => column >= 2 ? String(cell).padStart(widths[column]) : String(cell).padEnd(widths[column])).join('  '))
    }
    for (const item of report) {
      const metro = item.rows.find(row => row.mode === 'metro-like')
      const list = metro.diagnosticsModules.map(m => `${m.module} ${formatBytes(m.bytes)} B`).join(', ') || 'none'
      console.log(`\n${item.label}: diagnostics modules in the metro-like bundle: ${list}`)
    }
  }

  if (options.check) {
    // Only the working tree (and other checkouts) are checked: older refs may
    // predate the lazy diagnostics split.
    let failed = false
    const checked = report.filter(item => item.ref === WORKTREE || isCheckout(item.ref))
    if (checked.length === 0) {
      console.error('--check needs the working tree (".") or a checkout among the sources')
      process.exit(1)
    }
    for (const item of checked) {
      for (const row of item.rows) {
        const forbidden = forbiddenModules(row)
        if (forbidden.length === 0) continue
        failed = true
        console.error(`FAIL ${item.label} [${row.mode}]: the main entry pulls in src/diagnostics/{${forbidden.join(', ')}}`)
      }
    }
    if (failed) process.exit(1)
    if (!options.json) console.log('\ncheck: ok (only diagnostics/hooks.ts, the always-loaded switch, is reachable from the main entry)')
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
