// Diagnostics cost (almost) nothing unless an app loads them: the 'teamplay'
// main entry reaches only the switch (src/diagnostics/hooks.ts), never the
// collectors, leak checks, instrumentation or trace buffers. Bundlers without
// tree shaking (Metro) ship every module the entry reaches, so this is checked
// on the import graph, and on a real esbuild bundle when esbuild is installed.
// Then each way of loading and enabling diagnostics runs in a child process
// (test/_diagnosticsScenario.js).
import { describe, it } from 'mocha'
import { strict as assert } from 'node:assert'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve as resolvePath, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url))
const SRC = join(PACKAGE_DIR, 'src')
const REPO_ROOT = resolvePath(PACKAGE_DIR, '..', '..')
const SCENARIO_SCRIPT = fileURLToPath(new URL('./_diagnosticsScenario.js', import.meta.url))

// Every module statically reachable from `entry` through relative imports,
// re-exports, dynamic import() and require() with a literal path. Type-only
// imports and exports are skipped: they are erased from the emitted JS.
function reachableModules (entry) {
  const seen = new Set()
  const queue = [entry]
  while (queue.length) {
    const file = queue.pop()
    if (seen.has(file)) continue
    seen.add(file)
    for (const specifier of relativeImports(readFileSync(file, 'utf8'))) {
      const target = resolveModule(dirname(file), specifier)
      assert.ok(target, `${relative(SRC, file)}: cannot resolve ${specifier}`)
      queue.push(target)
    }
  }
  return new Set([...seen].map(file => relative(SRC, file).split(sep).join('/')))
}

function relativeImports (source) {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(line => !line.trim().startsWith('//'))
    .join('\n')
  const specifiers = []
  const patterns = [
    /\b(?:import|export)\s+(type\s+)?[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*()['"]([^'"]+)['"]/g,
    /\bimport\(\s*()['"]([^'"]+)['"]\s*\)/g,
    /\brequire\(\s*()['"]([^'"]+)['"]\s*\)/g
  ]
  for (const pattern of patterns) {
    for (const [, typeOnly, specifier] of code.matchAll(pattern)) {
      if (typeOnly) continue
      if (specifier.startsWith('./') || specifier.startsWith('../')) specifiers.push(specifier)
    }
  }
  return specifiers
}

function resolveModule (from, specifier) {
  const base = resolvePath(from, specifier)
  const candidates = [base, base + '.ts', base + '.js', join(base, 'index.ts'), join(base, 'index.js')]
  return candidates.find(candidate => existsSync(candidate) && statSync(candidate).isFile())
}

function diagnosticsModules (modules) {
  return [...modules].filter(name => name.startsWith('diagnostics/')).sort()
}

function hasEsbuild () {
  try {
    createRequire(join(REPO_ROOT, 'package.json')).resolve('esbuild')
    return true
  } catch {
    return false
  }
}

function runScenario (scenario, env = {}) {
  return new Promise((resolve, reject) => {
    const childEnv = { ...process.env, SCENARIO: scenario, ...env }
    if (!('TEAMPLAY_DIAGNOSTICS' in env)) delete childEnv.TEAMPLAY_DIAGNOSTICS
    const child = spawn(process.execPath, ['--expose-gc', '-C', 'teamplay-ts', SCENARIO_SCRIPT], {
      cwd: PACKAGE_DIR,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    const killer = setTimeout(() => child.kill('SIGKILL'), 30000)
    child.on('error', reject)
    child.on('exit', code => {
      clearTimeout(killer)
      if (code !== 0) return reject(Error(`scenario ${scenario} exited with ${code}\n${stdout}\n${stderr}`))
      const lines = stdout.trim().split('\n')
      resolve(JSON.parse(lines[lines.length - 1]))
    })
  })
}

const FULL_IMPLEMENTATION = [
  'diagnostics/collect.ts',
  'diagnostics/finalization.ts',
  'diagnostics/hooks.ts',
  'diagnostics/index.ts',
  'diagnostics/install.ts',
  'diagnostics/instrument.ts',
  'diagnostics/leaks.ts',
  'diagnostics/runtimeRefs.js',
  'diagnostics/state.ts'
]

describe('diagnostics: lazy loading', () => {
  describe('import graph', () => {
    it('the main entry reaches only the diagnostics switch', () => {
      const modules = reachableModules(join(SRC, 'index.ts'))
      assert.ok(modules.has('orm/Doc.js') && modules.has('react/useSub.ts'), 'the scan follows the runtime')
      assert.deepEqual(diagnosticsModules(modules), ['diagnostics/hooks.ts'])
    })

    it('the Node entry loads the full implementation', () => {
      const modules = reachableModules(join(SRC, 'index.node.ts'))
      assert.deepEqual(diagnosticsModules(modules), FULL_IMPLEMENTATION)
    })

    it('the installer loads no runtime module, so it runs before the runtime creates its registries', () => {
      const modules = reachableModules(join(SRC, 'diagnostics', 'install.ts'))
      const runtime = [...modules].filter(name => !name.startsWith('diagnostics/')).sort()
      assert.deepEqual(runtime, ['orm/signalSymbols.ts'])
    })

    it('diagnostics/index.ts loads the installer first', () => {
      const source = readFileSync(join(SRC, 'diagnostics', 'index.ts'), 'utf8')
      assert.match(source, /^import '\.\/install\.ts'$/m)
      const firstImport = source.split('\n').find(line => /^import\b/.test(line))
      assert.equal(firstImport, "import './install.ts'")
    })
  })

  describe('bundle', () => {
    it('an esbuild bundle of the main entry (no tree shaking, like Metro) contains no diagnostics implementation', function () {
      if (!hasEsbuild()) this.skip()
      this.timeout(120000)
      const result = spawnSync(process.execPath, [join(REPO_ROOT, 'scripts', 'bundle-size.mjs'), '--check', '--json', '.'], {
        cwd: REPO_ROOT,
        encoding: 'utf8'
      })
      assert.equal(result.status, 0, result.stderr + result.stdout)
      const [report] = JSON.parse(result.stdout)
      for (const row of report.rows) {
        assert.deepEqual(row.diagnosticsModules.map(item => item.module), ['diagnostics/hooks.ts'], row.mode)
      }
    })
  })

  describe('enabling', function () {
    this.timeout(60000)

    it('main entry without the subpath: switch off, enable() explains what to import, flags are ignored', async () => {
      const result = await runScenario('main', { TEAMPLAY_DIAGNOSTICS: 'trace' })
      assert.equal(result.enabledAfterLoad, false)
      assert.match(result.enableError, /import 'teamplay\/diagnostics'/)
      assert.equal(result.methods.disable, 'function')
      assert.equal(result.methods.snapshot, 'undefined')
      assert.equal(result.exposedGlobally, false)
      if (result.moduleTracking) assert.deepEqual(result.loadedDiagnosticsModules, ['diagnostics/hooks.ts'])
    })

    it('Node: TEAMPLAY_DIAGNOSTICS switches diagnostics on at load through the package entry', async () => {
      const result = await runScenario('node', { TEAMPLAY_DIAGNOSTICS: 'trace' })
      assert.equal(result.enabledAfterLoad, true)
      assert.ok(result.trace > 0, 'tracing')
      assert.ok(result.counters.docSubscribe >= 2 && result.counters.querySubscribe >= 2)
      assert.equal(result.counters.rootGet, 1, 'the global root was created after diagnostics loaded')
      assert.equal(result.finalization.exact, true)
      assert.deepEqual(result.finalization.untracked, [])
      assert.ok(result.finalization.registered.signalCache > 0)
      assert.ok(result.finalization.registered.docSubscriptions >= 2)
      assert.equal(result.leakErrors, 0)
      assert.equal(result.exposedGlobally, true)
      if (result.moduleTracking) assert.deepEqual(result.loadedDiagnosticsModules, FULL_IMPLEMENTATION)
    })

    it('Node: without the env var the package entry has the full API, switched off', async () => {
      const result = await runScenario('node')
      assert.equal(result.enabledAfterLoad, false)
      assert.equal(result.methods.snapshot, 'function')
      assert.equal(result.enabled, true, 'enable() at runtime works')
      assert.ok(result.trace > 0)
      assert.equal(result.finalization.exact, false, 'enabled after load')
      assert.deepEqual(result.finalization.untracked, [], 'registries are counted from enable()')
    })

    it('browser: the global flag plus "teamplay/diagnostics" as the first import counts from the start', async () => {
      const result = await runScenario('flag-first')
      assert.equal(result.enabledAfterLoad, true)
      assert.ok(result.trace > 0)
      assert.equal(result.counters.rootGet, 1)
      assert.equal(result.finalization.exact, true)
      assert.ok(result.finalization.registered.signalCache > 0)
      assert.equal(result.exposedGlobally, true)
    })

    it('"teamplay/diagnostics/enable" switches diagnostics on without a flag', async () => {
      const result = await runScenario('enable-subpath')
      assert.equal(result.enabledAfterLoad, true)
      assert.equal(result.trace, 0, 'no tracing unless asked for')
      assert.ok(result.counters.docSubscribe >= 2)
      assert.equal(result.finalization.exact, true)
      assert.equal(result.exposedGlobally, true)
    })

    it('loading the subpath after the runtime works, without FinalizationRegistry counts', async () => {
      const result = await runScenario('late')
      assert.equal(result.enabledAfterLoad, false)
      assert.equal(result.enabled, true)
      assert.ok(result.trace > 0)
      assert.ok(result.counters.docSubscribe >= 1)
      assert.equal(result.finalization.exact, false)
      assert.ok(result.finalization.untracked.includes('docSubscriptions'))
      assert.equal(result.leakErrors, 0)
      assert.equal(result.exposedGlobally, true)
    })
  })
})
