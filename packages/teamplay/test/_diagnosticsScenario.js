// Child process for test/diagnosticsLazy.js: loads teamplay the way one kind of
// app does (SCENARIO env var), runs a few subscriptions and prints what
// diagnostics look like as JSON on the last stdout line.
//
//   main            the bundler entry (src/index.ts) without 'teamplay/diagnostics'
//   node            'teamplay' through package.json exports in Node (src/index.node.ts)
//   flag-first      globalThis.__TEAMPLAY_DIAGNOSTICS__, then 'teamplay/diagnostics', then the bundler entry
//   enable-subpath  'teamplay/diagnostics/enable', then the bundler entry
//   late            the bundler entry, then 'teamplay/diagnostics' and diagnostics.enable()
import * as nodeModule from 'node:module'

// Which src/diagnostics/* modules get loaded (Node >= 22.15 / 23.5).
const loadedDiagnosticsModules = new Set()
let moduleTracking = false
if (typeof nodeModule.registerHooks === 'function') {
  moduleTracking = true
  nodeModule.registerHooks({
    resolve (specifier, context, nextResolve) {
      const result = nextResolve(specifier, context)
      const index = result.url.indexOf('/src/diagnostics/')
      if (index !== -1) loadedDiagnosticsModules.add(result.url.slice(index + '/src/'.length))
      return result
    }
  })
}

const scenario = process.env.SCENARIO
let teamplay
if (scenario === 'main') {
  teamplay = await import('../src/index.ts')
} else if (scenario === 'node') {
  teamplay = await import('teamplay')
} else if (scenario === 'flag-first') {
  globalThis.__TEAMPLAY_DIAGNOSTICS__ = { trace: true }
  await import('../src/diagnostics/index.ts')
  teamplay = await import('../src/index.ts')
} else if (scenario === 'enable-subpath') {
  await import('teamplay/diagnostics/enable')
  teamplay = await import('../src/index.ts')
} else if (scenario === 'late') {
  teamplay = await import('../src/index.ts')
} else {
  throw Error('Unknown SCENARIO: ' + scenario)
}

const { $, sub, unsub, diagnostics } = teamplay
const { default: connect } = await import('../src/connect/test.js')
const { setSubscriptionGcDelay } = await import('../src/orm/subscriptionGcDelay.ts')
connect()
setSubscriptionGcDelay(0)

async function workload (id) {
  const $doc = await sub($.lazyDiagnostics[id])
  await $doc.set({ name: 'lazy ' + id })
  const $query = await sub($.lazyDiagnostics, { name: 'lazy ' + id })
  await unsub($query)
  await unsub($doc)
}

await workload('a')

const result = {
  scenario,
  moduleTracking,
  enabledAfterLoad: diagnostics.isEnabled(),
  methods: {
    enable: typeof diagnostics.enable,
    disable: typeof diagnostics.disable,
    snapshot: typeof diagnostics.snapshot,
    checkLeaks: typeof diagnostics.checkLeaks
  }
}

if (scenario === 'main') {
  try {
    diagnostics.enable()
  } catch (error) {
    result.enableError = error.message
  }
  diagnostics.disable()
} else {
  if (scenario === 'late') {
    await import('../src/diagnostics/index.ts')
    diagnostics.enable({ trace: true })
  } else if (scenario === 'node' && !diagnostics.isEnabled()) {
    diagnostics.enable({ trace: true })
  }
  await workload('b')
  await diagnostics.waitForIdle({ timeoutMs: 5000 })
  const snapshot = diagnostics.snapshot()
  const leaks = diagnostics.checkLeaks()
  const counters = diagnostics.getCounters()
  result.enabled = diagnostics.isEnabled()
  result.trace = diagnostics.getTrace().length
  result.counters = {
    docSubscribe: counters['doc.subscribe'] || 0,
    querySubscribe: counters['query.subscribe'] || 0,
    rootGet: counters['root.get'] || 0
  }
  result.finalization = {
    exact: snapshot.finalization.exact,
    untracked: snapshot.finalization.untracked,
    registered: Object.fromEntries(snapshot.finalization.registries.map(item => [item.name, item.registered]))
  }
  result.leakErrors = leaks.errors
}

result.exposedGlobally = globalThis.__teamplay__?.diagnostics === diagnostics
result.loadedDiagnosticsModules = [...loadedDiagnosticsModules].sort()
console.log(JSON.stringify(result))
process.exit(0)
