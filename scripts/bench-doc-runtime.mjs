#!/usr/bin/env node
// Benchmarks of the doc runtime (packages/teamplay/src/orm/Doc.js), to compare
// two sources of teamplay, e.g. master and a working tree:
//   ops       remote field ops applied on a connection holding 10k docs (the
//             per-op cost of the runtime's ShareDB listeners)
//   e2e       the same ops end to end: another connection submits them to an
//             in-process ShareDB backend, this connection applies them
//   replace   a remote whole-doc replace ({ p: [] }) of a 1 KB, 100 KB and
//             1 MB doc: parse + apply (+ the data tree re-link)
//   memory    heap per doc held by a query, and the heap over long churns of
//             doc and query subscriptions (released and destroyed every time)
//   churn     the time of those churns (subscribe, release, GC destroy)
//
// Usage (from the repo root):
//   node scripts/bench-doc-runtime.mjs                      # master vs the working tree
//   node scripts/bench-doc-runtime.mjs upstream/master .    # any git refs or "."
//   node scripts/bench-doc-runtime.mjs --rounds 5 --json master .
// Each source's packages/teamplay/src is copied into a temp dir (a git ref is
// read with `git archive`); everything else resolves from this checkout's
// node_modules. Every round runs each source once, in a fresh process
// (node --expose-gc -C teamplay-ts), alternating the sources; the table shows
// the median over the rounds.
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir, cpus, totalmem } from 'node:os'
import v8 from 'node:v8'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SELF = fileURLToPath(import.meta.url)

if (process.env.TEAMPLAY_BENCH_SRC) {
  await runWorker(process.env.TEAMPLAY_BENCH_SRC)
} else {
  runMain(process.argv.slice(2))
}

// ---------------------------------------------------------------- runner

function runMain (argv) {
  const options = { sources: [], rounds: 3, json: false, only: undefined }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--rounds') options.rounds = Number(argv[++i])
    else if (arg === '--json') options.json = true
    else if (arg === '--only') options.only = argv[++i]
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/bench-doc-runtime.mjs [--rounds N] [--only ops,e2e,replace,memory,churn] [--json] [source ...]  (source: git ref or ".")')
      process.exit(0)
    } else options.sources.push(arg)
  }
  if (options.sources.length === 0) options.sources.push('master', '.')
  const prepared = options.sources.map(prepareSource)
  const results = prepared.map(() => [])
  try {
    for (let round = 0; round < options.rounds; round++) {
      for (let i = 0; i < prepared.length; i++) {
        const { label, src } = prepared[i]
        if (!options.json) console.error(`round ${round + 1}/${options.rounds}: ${label}`)
        const child = spawnSync(process.execPath, ['--expose-gc', '-C', 'teamplay-ts', SELF], {
          env: { ...process.env, TEAMPLAY_BENCH_SRC: src, TEAMPLAY_BENCH_ONLY: options.only || '' },
          encoding: 'utf8',
          maxBuffer: 1 << 26
        })
        if (child.status !== 0) {
          console.error(child.stdout, child.stderr)
          throw Error(`the benchmark failed for ${label}`)
        }
        results[i].push(JSON.parse(child.stdout.trim().split('\n').pop()))
      }
    }
  } finally {
    for (const { tmp } of prepared) rmSync(tmp, { recursive: true, force: true })
  }
  const medians = results.map(runs => medianOfRuns(runs))
  const machine = `${cpus()[0]?.model} (${cpus().length} cores, ${Math.round(totalmem() / 2 ** 30)} GB), Node ${process.version}, ${process.platform}`
  if (options.json) {
    console.log(JSON.stringify({ machine, rounds: options.rounds, sources: prepared.map(p => p.label), medians, runs: results }, null, 2))
    return
  }
  console.log(`\n${machine}, ${options.rounds} rounds, medians\n`)
  printTable(prepared.map(p => p.label), medians)
}

function prepareSource (ref) {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'teamplay-bench-')))
  const target = join(tmp, 'packages', 'teamplay')
  mkdirSync(target, { recursive: true })
  let label
  if (ref === '.') {
    cpSync(join(ROOT, 'packages', 'teamplay', 'src'), join(target, 'src'), { recursive: true })
    const sha = git(['rev-parse', '--short', 'HEAD'])
    const dirty = git(['status', '--porcelain', '--', 'packages/teamplay/src'])
    label = `working tree (${sha}${dirty ? '+changes' : ''})`
  } else {
    const tar = execFileSync('git', ['archive', '--format=tar', ref, 'packages/teamplay/src'], { cwd: ROOT, maxBuffer: 1 << 30 })
    execFileSync('tar', ['-x', '-C', tmp], { input: tar })
    label = `${ref} (${git(['rev-parse', '--short', ref])})`
  }
  // third-party and @teamplay/* packages resolve from this checkout
  symlinkSync(join(ROOT, 'node_modules'), join(tmp, 'node_modules'), 'dir')
  if (existsSync(join(ROOT, 'packages', 'teamplay', 'node_modules'))) {
    symlinkSync(join(ROOT, 'packages', 'teamplay', 'node_modules'), join(target, 'node_modules'), 'dir')
  }
  return { label, tmp, src: join(target, 'src') }
}

function git (args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
}

function medianOfRuns (runs) {
  const out = {}
  for (const key of Object.keys(runs[0])) out[key] = median(runs.map(run => run[key]))
  return out
}

function printTable (labels, medians) {
  const keys = Object.keys(medians[0])
  const rows = [['metric', ...labels, labels.length === 2 ? 'change' : undefined].filter(Boolean)]
  for (const key of keys) {
    const values = medians.map(m => m[key])
    const row = [key, ...values.map(formatValue)]
    if (labels.length === 2) row.push(formatChange(values[0], values[1]))
    rows.push(row)
  }
  const widths = rows[0].map((_, i) => Math.max(...rows.map(row => String(row[i]).length)))
  for (const [index, row] of rows.entries()) {
    console.log(row.map((cell, i) => i === 0 ? String(cell).padEnd(widths[i]) : String(cell).padStart(widths[i])).join('  '))
    if (index === 0) console.log(widths.map(width => '-'.repeat(width)).join('  '))
  }
}

function formatValue (value) {
  if (typeof value !== 'number') return String(value)
  if (Number.isInteger(value)) return value.toLocaleString('en-US')
  return value.toLocaleString('en-US', { maximumSignificantDigits: 4 })
}

function formatChange (before, after) {
  if (typeof before !== 'number' || typeof after !== 'number' || before === 0) return ''
  const change = (after - before) / Math.abs(before) * 100
  return `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`
}

function median (values) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

// ---------------------------------------------------------------- worker

async function runWorker (src) {
  const load = path => import(pathToFileURL(join(src, path)).href)
  const [{ $, sub, unsub, getRootSignal }, { setConnection }, { docSubscriptions }, { querySubscriptions }, { setSubscriptionGcDelay }, { getRaw }] = await Promise.all([
    load('index.ts'),
    load('orm/connection.ts'),
    load('orm/Doc.js'),
    load('orm/Query.js'),
    load('orm/subscriptionGcDelay.ts'),
    load('orm/dataTree.js')
  ])
  const { default: ShareDB } = await import('sharedb')
  const { default: ShareDbMingo } = await import('@startupjs/sharedb-mingo-memory')
  const only = new Set((process.env.TEAMPLAY_BENCH_ONLY || 'ops,e2e,replace,memory,churn').split(',').filter(Boolean))

  const backend = new ShareDB({ db: new ShareDbMingo() })
  const connection = backend.connect()
  setConnection(connection)
  const writer = backend.connect()
  const callback = run => new Promise((resolve, reject) => run(err => err ? reject(err) : resolve()))
  const results = {}
  let seq = 0

  async function createDocs (collection, count, makeData) {
    const ids = []
    for (let i = 0; i < count; i += 500) {
      const batch = []
      for (let j = i; j < Math.min(count, i + 500); j++) {
        const id = `${collection}_${j}`
        ids.push(id)
        batch.push(callback(done => writer.get(collection, id).create(makeData(j), done)))
      }
      await Promise.all(batch)
    }
    return ids
  }

  // a message as another client's op reaches this connection (a string the
  // socket parses, as over a network)
  function opMessage (collection, id, version, op) {
    return JSON.stringify({ a: 'op', c: collection, d: id, v: version, src: 'bench-remote', seq: ++seq, op })
  }

  function receive (text) {
    connection.socket.onmessage({ data: text })
  }

  // the heap once collected garbage is gone, finalizers included (released
  // signals leave teamplay's caches from FinalizationRegistry callbacks)
  async function heapUsed () {
    for (let i = 0; i < 4; i++) {
      global.gc()
      await new Promise(resolve => setTimeout(resolve, 5))
      await querySubscriptions.flushPendingDestroys()
      await docSubscriptions.flushPendingDestroys()
    }
    return process.memoryUsage().heapUsed
  }

  // the old space holds what survives: a leak grows it cycle after cycle (the
  // large object space jumps when a big backing store is reallocated)
  function oldSpaceUsed () {
    return v8.getHeapSpaceStatistics().find(space => space.space_name === 'old_space').space_used_size
  }

  const settle = () => new Promise(resolve => setImmediate(resolve))

  // ops: 100k remote field ops round-robin over 10k docs a query holds
  if (only.has('ops') || only.has('memory')) {
    const collection = 'benchOps'
    const DOCS = 10000
    const ids = await createDocs(collection, DOCS, i => ({ kind: 'ops', name: `doc ${i}`, score: 0, tags: ['a', 'b'] }))
    const heapCreated = await heapUsed()
    const $root = getRootSignal({ rootId: 'bench-ops' })
    // kept referenced: a query signal garbage-collected releases its query
    const $query = await sub($root[collection], { kind: 'ops' })
    const heapHeld = await heapUsed()
    if ($query.getIds().length !== DOCS) throw Error('ops: the query does not hold the docs')
    results['memory: heap per doc held by a query (bytes)'] = Math.round((heapHeld - heapCreated) / DOCS)
    const shareDoc = connection.get(collection, ids[0])
    results['memory: runtime listeners per ShareDB doc'] = ['load', 'create', 'del', 'op', 'error'].reduce((sum, event) => sum + shareDoc.listenerCount(event), 0)
    if (only.has('ops')) {
      const OPS = 100000
      const runs = []
      for (let run = 0; run < 6; run++) {
        const messages = new Array(OPS)
        for (let i = 0; i < OPS; i++) {
          const id = ids[i % DOCS]
          const version = connection.get(collection, id).version + Math.floor(i / DOCS)
          messages[i] = opMessage(collection, id, version, [{ p: ['score'], na: 1 }])
        }
        const start = performance.now()
        for (let i = 0; i < OPS; i++) receive(messages[i])
        const ms = performance.now() - start
        if (run > 0) runs.push(ms) // the first run warms up
      }
      const last = connection.get(collection, ids[DOCS - 1])
      if (getRaw([collection, ids[DOCS - 1]]).score !== last.data.score || last.data.score !== OPS / DOCS * 6) {
        throw Error('ops: the data tree does not hold the applied ops')
      }
      results['ops: 100k field ops on 10k docs (ms)'] = round(median(runs), 1)
      results['ops: per op (µs)'] = round(median(runs) * 1000 / OPS, 3)
    }
    if ($query.getIds().length !== DOCS) throw Error('ops: the query does not hold the docs')
    await $root.close()
    await querySubscriptions.flushPendingDestroys()
    await docSubscriptions.flushPendingDestroys()
  }

  // e2e: 20k field ops submitted by another connection, applied here
  if (only.has('e2e')) {
    const collection = 'benchE2e'
    const DOCS = 1000
    const OPS = 20000
    const ids = await createDocs(collection, DOCS, i => ({ kind: 'e2e', score: 0 }))
    const $root = getRootSignal({ rootId: 'bench-e2e' })
    const $query = await sub($root[collection], { kind: 'e2e' })
    const writerDocs = ids.map(id => writer.get(collection, id))
    await Promise.all(writerDocs.map(doc => callback(done => doc.fetch(done))))
    const runs = []
    for (let run = 0; run < 4; run++) {
      const target = (run + 1) * OPS / DOCS
      const start = performance.now()
      const submits = []
      for (let i = 0; i < OPS; i++) {
        const doc = writerDocs[i % DOCS]
        submits.push(callback(done => doc.submitOp([{ p: ['score'], na: 1 }], done)))
        if (submits.length === 1000) await Promise.all(submits.splice(0))
      }
      await Promise.all(submits)
      while (getRaw([collection, ids[DOCS - 1]])?.score !== target) await settle()
      const ms = performance.now() - start
      if (run > 0) runs.push(ms)
    }
    if ($query.getIds().length !== DOCS) throw Error('e2e: the query does not hold the docs')
    results['e2e: 20k field ops, submit to applied (ms)'] = round(median(runs), 1)
    await $root.close()
    await querySubscriptions.flushPendingDestroys()
    await docSubscriptions.flushPendingDestroys()
  }

  // replace: a remote whole-doc replace of a 1 KB, 100 KB and 1 MB doc
  if (only.has('replace')) {
    const collection = 'benchReplace'
    for (const [label, bytes, count] of [['1 KB', 1024, 2000], ['100 KB', 100 * 1024, 200], ['1 MB', 1024 * 1024, 30]]) {
      for (const variant of ['one field changed', 'every value changed']) {
        const id = `replace_${bytes}_${variant.split(' ')[0]}`
        const base = makeDoc(bytes)
        await callback(done => writer.get(collection, id).create(base, done))
        const $doc = await sub($[collection][id])
        const shareDoc = connection.get(collection, id)
        const versions = [base, variant === 'one field changed' ? withOneChange(base) : withEveryValueChanged(base)]
        const messages = []
        for (let i = 0; i < count; i++) {
          messages.push(opMessage(collection, id, shareDoc.version + i, [{ p: [], od: versions[i % 2], oi: versions[(i + 1) % 2] }]))
        }
        const times = []
        for (const message of messages) {
          const start = performance.now()
          receive(message)
          times.push(performance.now() - start)
        }
        results[`replace ${label} (${variant}): per replace (ms)`] = round(median(times.slice(Math.floor(count / 10))), 4)
        if (bytes === 1024 && variant === 'one field changed') {
          // 1: the doc signal reads the data of a replace
          const final = { ...versions[count % 2], title: 'final' }
          receive(opMessage(collection, id, shareDoc.version, [{ p: [], od: versions[count % 2], oi: final }]))
          results['replace: the data tree holds the replaced data'] = JSON.stringify(stripId($doc.get())) === JSON.stringify(final) ? 1 : 0
        }
        await unsub($doc)
        await docSubscriptions.flushPendingDestroys()
      }
    }
  }

  // memory + churn: doc subscriptions and queries taken and released
  if (only.has('memory') || only.has('churn')) {
    setSubscriptionGcDelay(0)
    const collection = 'benchChurn'
    const ids = await createDocs(collection, 500, i => ({ kind: 'churn', group: i % 10, name: `doc ${i}`, score: i }))
    await settle()
    // a doc subscribed and released (and destroyed: GC delay 0) over and
    // over: 50k cycles timed, the heap compared after 100k and 200k
    const docCycle = async i => {
      const $doc = await sub($[collection][ids[i % ids.length]])
      await unsub($doc)
    }
    let n = 0
    for (; n < 20000; n++) await docCycle(n)
    let start = performance.now()
    for (; n < 70000; n++) await docCycle(n)
    const docChurnMs = performance.now() - start
    for (; n < 100000; n++) await docCycle(n)
    const docHeap0 = await heapUsed()
    const docOld0 = oldSpaceUsed()
    for (; n < 200000; n++) await docCycle(n)
    const docHeap1 = await heapUsed()
    const docOld1 = oldSpaceUsed()
    if (docSubscriptions.entries.size !== 0 || Object.keys(connection.collections[collection] || {}).length !== 0) {
      throw Error('churn: doc subscriptions left behind')
    }
    // a root per job closed when it ends, its query's docs destroyed (GC
    // delay 0) while the next job's query takes them: 5k cycles timed, the
    // heap compared after 5k and 10k
    let unreadable = 0
    const queryCycle = async i => {
      const $root = getRootSignal({ rootId: `bench-churn-${i}` })
      const $query = await sub($root[collection], { kind: 'churn', group: i % 10 })
      for (const id of $query.getIds()) if ($root[collection][id].name.get() === undefined) unreadable++
      await $root.close()
    }
    n = 0
    for (; n < 500; n++) await queryCycle(n)
    start = performance.now()
    for (; n < 5500; n++) await queryCycle(n)
    const queryChurnMs = performance.now() - start
    const queryHeap0 = await heapUsed()
    const queryOld0 = oldSpaceUsed()
    for (; n < 10500; n++) await queryCycle(n)
    const queryHeap1 = await heapUsed()
    const queryOld1 = oldSpaceUsed()
    if (only.has('churn')) {
      results['churn: doc sub + unsub + destroy (µs per cycle)'] = round(docChurnMs * 1000 / 50000, 2)
      results['churn: root + query of 50 docs + close (µs per cycle)'] = round(queryChurnMs * 1000 / 5000, 1)
      results['churn: listed docs read without data'] = unreadable
    }
    if (only.has('memory')) {
      results['memory: heap growth, doc churns 100k → 200k (KB)'] = Math.round((docHeap1 - docHeap0) / 1024)
      results['memory: old space growth, doc churns 100k → 200k (KB)'] = Math.round((docOld1 - docOld0) / 1024)
      results['memory: heap growth, query churns 5k → 10k (KB)'] = Math.round((queryHeap1 - queryHeap0) / 1024)
      results['memory: old space growth, query churns 5k → 10k (KB)'] = Math.round((queryOld1 - queryOld0) / 1024)
    }
    // a ShareDB doc that outlives the runtimes (ShareDB keeps a doc that
    // connection.get() asks for during its destroy): listeners left on it
    if (only.has('memory')) {
      const id = ids[0]
      for (let i = 0; i < 1000; i++) {
        const $doc = await sub($[collection][id])
        const shareDoc = connection.get(collection, id)
        const destroy = shareDoc.destroy
        shareDoc.destroy = function (cb) {
          delete shareDoc.destroy
          destroy.call(this, cb)
          connection.get(collection, id)
        }
        await unsub($doc)
      }
      await docSubscriptions.flushPendingDestroys()
      const kept = connection.get(collection, id)
      results['memory: listeners left on a ShareDB doc kept over 1k destroys'] = ['load', 'create', 'del', 'op', 'error'].reduce((sum, event) => sum + kept.listenerCount(event), 0)
    }
  }

  console.log(JSON.stringify(results))
  process.exit(0)
}

// a doc of about `bytes` bytes of JSON: items with a few fields each
function makeDoc (bytes) {
  const items = []
  const doc = { title: 'bench', items }
  let size = JSON.stringify(doc).length
  for (let i = 0; size < bytes; i++) {
    const item = { id: `item${i}`, name: `Item number ${i}`, score: i, active: i % 2 === 0, tags: ['alpha', 'beta'] }
    items.push(item)
    size += JSON.stringify(item).length + 1
  }
  return doc
}

function withOneChange (doc) {
  const next = structuredClone(doc)
  next.items[Math.floor(next.items.length / 2)].score += 1
  return next
}

function withEveryValueChanged (doc) {
  const next = structuredClone(doc)
  for (const item of next.items) item.score += 1
  return next
}

function stripId (doc) {
  const { _id, ...rest } = doc
  return rest
}

function round (value, digits) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
