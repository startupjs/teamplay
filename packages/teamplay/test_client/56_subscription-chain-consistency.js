// Subscriptions that depend on each other: A, then the B that A points to,
// then the C that B points to (also as queries, an aggregation and batches).
// When A changes to a document that is not subscribed yet, the component must
// never commit a state in which a link does not belong to the one above it
// (A2 with B1) or a document that is not loaded:
// - deferred (the default): it keeps showing the previous chain, without its
//   Suspense fallback, until every link of the new chain is ready, then
//   commits the new chain at once;
// - defer: false: it suspends (shows the fallback) until the new chain is
//   ready;
// The first mount suspends to the fallback in every mode.
//
// Every scenario runs twice: under act() (@testing-library/react) and with
// React's own scheduler (createRoot() without act(), which yields and retries
// the way a browser does). Every commit is recorded (useLayoutEffect), and
// every DOM state (MutationObserver). The documents are created through a
// separate connection, and the server answers the client's requests after a
// delay (a slow network), so every first subscription takes a while.
import '../src/diagnostics/index.ts' // 'teamplay/diagnostics' first, as an app does
import { createElement as el, Fragment, useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from '@jest/globals'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import {
  $,
  aggregation,
  diagnostics,
  observer,
  useBatchSub,
  useSub
} from '../src/index.ts'
import { getConnection } from '../src/orm/connection.ts'
import { getSubscriptionGcDelay, setSubscriptionGcDelay } from '../src/orm/subscriptionGcDelay.ts'
import connect from '../src/connect/test.js'

// network latency of every request of the client connection, in ms
const THROTTLE = 80
const FALLBACK = 'Loading...'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const baselineGcDelay = getSubscriptionGcDelay()
let collectionCounter = 0
let seedConnection
let networkDelay = 0
// collection -> latency of its requests, when it differs from networkDelay
const collectionDelays = new Map()
const activeHarnesses = new Set()

beforeAll(() => {
  connect()
  const clientAgent = getConnection().agent
  const backend = clientAgent.backend
  seedConnection = backend.connect()
  // delays the client's requests, in order per collection
  const lastReleaseAt = new Map()
  backend.use('receive', (context, next) => {
    if (context.agent !== clientAgent) return next()
    const collection = context.data?.c
    const delay = collectionDelays.get(collection) ?? networkDelay
    const releaseAt = Math.max(Date.now() + delay, lastReleaseAt.get(collection) ?? 0)
    lastReleaseAt.set(collection, releaseAt)
    if (releaseAt <= Date.now()) return next()
    setTimeout(next, releaseAt - Date.now())
  })
})
afterEach(async () => {
  for (const harness of activeHarnesses) await harness.unmount()
  activeHarnesses.clear()
  cleanup()
  networkDelay = 0
  collectionDelays.clear()
  setSubscriptionGcDelay(baselineGcDelay)
  diagnostics.disable()
})

async function createDoc (collection, id, data) {
  const doc = seedConnection.get(collection, id)
  await new Promise((resolve, reject) => doc.fetch(err => err ? reject(err) : resolve()))
  if (doc.type == null) await new Promise((resolve, reject) => doc.create(data, err => err ? reject(err) : resolve()))
}

// a{n} -> b{n} -> c{n} (and a{n} -> d{n}), in collections no other test uses,
// so that the first subscription of every document is a cold (slow) one
async function seedDocChain () {
  const name = `chain${++collectionCounter}`
  for (const n of [1, 2, 3]) {
    await createDoc(name + 'A', 'a' + n, { bId: 'b' + n, dId: 'd' + n })
    await createDoc(name + 'B', 'b' + n, { cId: 'c' + n })
    await createDoc(name + 'C', 'c' + n, { name: 'C' + n })
    await createDoc(name + 'D', 'd' + n, { name: 'D' + n })
  }
  return name
}

// a{n} has tag t{n}; two B documents per tag, each pointing to its C document
async function seedQueryChain () {
  const name = `queryChain${++collectionCounter}`
  for (const n of [1, 2, 3]) {
    await createDoc(name + 'A', 'a' + n, { tag: 't' + n })
    for (const [suffix, order] of [['x', 1], ['y', 2]]) {
      await createDoc(name + 'B', 'b' + n + suffix, { tag: 't' + n, order, cId: 'c' + n + suffix })
      await createDoc(name + 'C', 'c' + n + suffix, { name: 'C' + n + suffix })
    }
  }
  return name
}

const docChainText = n => `a${n}>b${n} b${n}>c${n} c${n}:C${n}`
const batchChainText = n => `a${n}>b${n},d${n} b${n}>c${n} c${n}:C${n} d${n}:D${n}`
const queryChainText = n => `a${n}:t${n} [b${n}x,b${n}y] [c${n}x:C${n}x,c${n}y:C${n}y]`

function useDocChain (name, aId, options) {
  const $a = useSub($[name + 'A'][aId], options)
  const $b = useSub($[name + 'B'][$a.bId.get()], options)
  const $c = useSub($[name + 'C'][$b.cId.get()], options)
  return {
    a: $a.getId(),
    text: `${$a.getId()}>${$a.bId.get()} ${$b.getId()}>${$b.cId.get()} ${$c.getId()}:${$c.name.get()}`,
    consistent: $a.bId.get() === $b.getId() &&
      $b.cId.get() === $c.getId() &&
      $c.name.get() === $c.getId().toUpperCase()
  }
}

function useBatchChain (name, aId, options) {
  const $a = useBatchSub($[name + 'A'][aId], options)
  useBatchSub()
  const $b = useBatchSub($[name + 'B'][$a.bId.get()], options)
  const $d = useBatchSub($[name + 'D'][$a.dId.get()], options)
  useBatchSub()
  const $c = useBatchSub($[name + 'C'][$b.cId.get()], options)
  useBatchSub()
  return {
    a: $a.getId(),
    text: `${$a.getId()}>${$a.bId.get()},${$a.dId.get()} ${$b.getId()}>${$b.cId.get()} ` +
      `${$c.getId()}:${$c.name.get()} ${$d.getId()}:${$d.name.get()}`,
    consistent: $a.bId.get() === $b.getId() &&
      $a.dId.get() === $d.getId() &&
      $b.cId.get() === $c.getId() &&
      $c.name.get() === $c.getId().toUpperCase() &&
      $d.name.get() === $d.getId().toUpperCase()
  }
}

const B_BY_TAG = aggregation(({ tag }) => [{ $match: { tag } }, { $sort: { order: 1 } }])

function useQueryChain (name, aId, options, { aggregate = false } = {}) {
  const $a = useSub($[name + 'A'][aId], options)
  const tag = $a.tag.get()
  const bArgs = aggregate
    ? [B_BY_TAG, { $collection: name + 'B', tag }]
    : [$[name + 'B'], { tag, $sort: { order: 1 } }]
  const $bs = useSub(bArgs[0], bArgs[1], options)
  const bs = $bs.map($b => ({ id: $b.getId(), tag: $b.tag.get(), cId: $b.cId.get() }))
  const cIds = bs.map(b => b.cId)
  const $cs = useSub($[name + 'C'], { _id: { $in: cIds } }, options)
  const cs = $cs.map($c => ({ id: $c.getId(), name: $c.name.get() })).sort((x, y) => x.id < y.id ? -1 : 1)
  return {
    a: $a.getId(),
    text: `${$a.getId()}:${tag} [${bs.map(b => b.id).join(',')}] [${cs.map(c => c.id + ':' + c.name).join(',')}]`,
    consistent: bs.length === 2 &&
      bs.every(b => b.tag === tag) &&
      cs.length === cIds.length &&
      cs.every(c => cIds.includes(c.id) && c.name === 'C' + c.id.slice(1))
  }
}

// --- harness ---

function createChainComponent ({ useChain, name, options, observerOptions, log }) {
  function Fallback () {
    useLayoutEffect(() => { log.commits.push(FALLBACK) })
    return el('span', { id: 'fallback' }, FALLBACK)
  }
  return observer(function Chain () {
    const $aId = $('a1')
    const state = useChain(name, $aId.get(), options)
    useLayoutEffect(() => {
      log.commits.push(state.text)
      log.consistency.set(state.text, state.consistent)
    })
    return el(Fragment, {},
      el('span', { id: 'chain' }, state.text),
      el('button', { id: 'toA1', onClick: () => $aId.set('a1') }),
      el('button', { id: 'toA2', onClick: () => $aId.set('a2') }),
      el('button', { id: 'toA3', onClick: () => $aId.set('a3') })
    )
  }, { ...observerOptions, suspenseProps: { fallback: el(Fallback) } })
}

// The chain across components: the parent subscribes to A and passes A's
// bId to a child observer, which subscribes to B and then C. Each records
// what is on screen when it commits.
function createCrossComponentChain ({ name, options, log }) {
  function Fallback () {
    useLayoutEffect(() => { log.commits.push(FALLBACK) })
    return el('span', { id: 'fallback' }, FALLBACK)
  }
  function recordScreen () {
    const sample = sampleDom(document.body)
    if (sample.text == null) return
    log.commits.push(sample.text)
    log.consistency.set(sample.text, isConsistentDocChainText(sample.text))
  }
  const Child = observer(function ChainChild ({ bId }) {
    const $b = useSub($[name + 'B'][bId], options)
    const $c = useSub($[name + 'C'][$b.cId.get()], options)
    useLayoutEffect(recordScreen)
    return el('span', {}, `${$b.getId()}>${$b.cId.get()} ${$c.getId()}:${$c.name.get()}`)
  }, { suspenseProps: { fallback: el(Fallback) } })
  return observer(function ChainParent () {
    const $aId = $('a1')
    const $a = useSub($[name + 'A'][$aId.get()], options)
    useLayoutEffect(recordScreen)
    return el(Fragment, {},
      el('span', { id: 'chain' }, `${$a.getId()}>${$a.bId.get()} `, el(Child, { bId: $a.bId.get() })),
      el('button', { id: 'toA1', onClick: () => $aId.set('a1') }),
      el('button', { id: 'toA2', onClick: () => $aId.set('a2') }),
      el('button', { id: 'toA3', onClick: () => $aId.set('a3') })
    )
  }, { suspenseProps: { fallback: el(Fallback) } })
}

// the parent's A with the child's B and C, or with the child's fallback
function isConsistentDocChainText (text) {
  if (/^a\d>b\d Loading\.\.\.$/.test(text)) return true
  const match = /^a(\d)>b(\d) b(\d)>c(\d) c(\d):C(\d)$/.exec(text)
  return !!match && match[2] === match[3] && match[4] === match[5] && match[5] === match[6]
}

function isHidden (node, container) {
  for (; node && node !== container; node = node.parentNode) {
    if (node.style?.display === 'none') return true
  }
  return false
}

// the text on screen (React hides suspended content with display: none)
function visibleTextOf (node) {
  if (node.nodeType === 3) return node.textContent
  if (node.style?.display === 'none') return ''
  return Array.from(node.childNodes).map(visibleTextOf).join('')
}

function sampleDom (container) {
  const fallback = Array.from(container.querySelectorAll('#fallback')).some(node => !isHidden(node, container))
  const chain = container.querySelector('#chain')
  return {
    fallback,
    text: chain && !isHidden(chain, container) ? visibleTextOf(chain) : null
  }
}

async function mountChain (Component, mode) {
  const log = Component.log
  let harness
  if (mode === 'act') {
    const view = render(el(Component))
    harness = {
      container: view.container,
      click: id => fireEvent.click(view.container.querySelector('#' + id)),
      wait: ms => act(async () => { await sleep(ms) }),
      unmount: async () => view.unmount()
    }
  } else {
    const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT
    globalThis.IS_REACT_ACT_ENVIRONMENT = false
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    root.render(el(Component))
    harness = {
      container,
      click: id => container.querySelector('#' + id).dispatchEvent(new MouseEvent('click', { bubbles: true })),
      wait: sleep,
      unmount: async () => {
        root.unmount()
        container.remove()
        globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
      }
    }
  }
  activeHarnesses.add(harness)
  const observerOfDom = new MutationObserver(() => log.dom.push(sampleDom(harness.container)))
  observerOfDom.observe(harness.container, { subtree: true, childList: true, characterData: true, attributes: true })
  const unmount = harness.unmount
  harness.unmount = async () => {
    observerOfDom.disconnect()
    await unmount()
  }
  harness.waitForText = async text => {
    const startedAt = Date.now()
    while (sampleDom(harness.container).text !== text && Date.now() - startedAt < 5000) await harness.wait(10)
    expect(sampleDom(harness.container).text).toBe(text)
  }
  return harness
}

function createLog () {
  return { commits: [], dom: [], consistency: new Map() }
}

// Mounts the chain at a1 (through the fallback), clears the log, then
// switches to every id of `steps` in turn and waits for the last one.
async function runSwitch ({
  mode, useChain, chainText, name, options, observerOptions, steps = ['a2'], betweenSteps = 30,
  createComponent = createChainComponent
}) {
  const log = createLog()
  const Component = createComponent({ useChain, name, options, observerOptions, log })
  Component.log = log
  networkDelay = THROTTLE
  const harness = await mountChain(Component, mode)
  await harness.waitForText(chainText(1))
  // the first mount suspends to the fallback
  expect(log.commits[0]).toBe(FALLBACK)
  expect(log.commits.at(-1)).toBe(chainText(1))
  log.commits.length = 0
  log.dom.length = 0
  for (let i = 0; i < steps.length; i++) {
    harness.click('toA' + steps[i].slice(1))
    if (i < steps.length - 1) await harness.wait(betweenSteps)
  }
  const last = Number(steps.at(-1).slice(1))
  await harness.waitForText(chainText(last))
  await harness.wait(THROTTLE * 2)
  return { log, harness }
}

function expectOnlyConsistentStates (log, { fallback }) {
  const states = log.commits.filter(text => text !== FALLBACK)
  for (const text of states) {
    expect({ text, consistent: log.consistency.get(text) }).toEqual({ text, consistent: true })
  }
  for (const sample of log.dom) {
    if (sample.text != null) {
      expect({ text: sample.text, consistent: log.consistency.get(sample.text) })
        .toEqual({ text: sample.text, consistent: true })
    }
  }
  const fallbackCommitted = log.commits.includes(FALLBACK)
  const fallbackShown = log.dom.some(sample => sample.fallback)
  if (fallback === 'never') {
    expect(fallbackCommitted).toBe(false)
    expect(fallbackShown).toBe(false)
    // the previous chain stays visible until the new one replaces it
    expect(log.dom.every(sample => sample.text != null)).toBe(true)
  } else if (fallback === 'shown') {
    expect(fallbackCommitted).toBe(true)
    expect(fallbackShown).toBe(true)
  }
}

for (const mode of ['act', 'scheduler']) {
  describe(`dependent subscriptions commit only consistent states (${mode})`, () => {
    describe('document chain', () => {
      it('deferred (default): keeps the previous chain, without the fallback, and commits the new one at once', async () => {
        const name = await seedDocChain()
        const { log } = await runSwitch({ mode, name, useChain: useDocChain, chainText: docChainText })
        expectOnlyConsistentStates(log, { fallback: 'never' })
        // nothing but the previous and the new chain
        expect(new Set(log.commits)).toEqual(new Set([docChainText(1), docChainText(2)].filter(text => log.commits.includes(text))))
        expect(log.commits.at(-1)).toBe(docChainText(2))
      })

      it('defer: false suspends to the fallback until the new chain is ready', async () => {
        const name = await seedDocChain()
        const { log } = await runSwitch({ mode, name, useChain: useDocChain, chainText: docChainText, options: { defer: false } })
        expectOnlyConsistentStates(log, { fallback: 'shown' })
        expect(log.commits.at(-1)).toBe(docChainText(2))
      })

      it('observer({ defer: false }) suspends to the fallback until the new chain is ready', async () => {
        const name = await seedDocChain()
        const { log } = await runSwitch({ mode, name, useChain: useDocChain, chainText: docChainText, observerOptions: { defer: false } })
        expectOnlyConsistentStates(log, { fallback: 'shown' })
      })

      it('deferred: a1 -> a2 -> a3 in quick succession ends at a3 without committing a2', async () => {
        const name = await seedDocChain()
        const { log } = await runSwitch({ mode, name, useChain: useDocChain, chainText: docChainText, steps: ['a2', 'a3'] })
        expectOnlyConsistentStates(log, { fallback: 'never' })
        expect(log.commits).not.toContain(docChainText(2))
        expect(log.commits.at(-1)).toBe(docChainText(3))
      })

      it('defer: false: a1 -> a2 -> a3 in quick succession ends at a3', async () => {
        const name = await seedDocChain()
        const { log } = await runSwitch({
          mode, name, useChain: useDocChain, chainText: docChainText, options: { defer: false }, steps: ['a2', 'a3']
        })
        expectOnlyConsistentStates(log, { fallback: 'shown' })
        expect(log.commits.at(-1)).toBe(docChainText(3))
      })

      for (const options of [undefined, { defer: false }]) {
        it(`switches back to a warm chain without waiting (defer: ${options?.defer ?? 'default'})`, async () => {
          const name = await seedDocChain()
          const { log, harness } = await runSwitch({ mode, name, useChain: useDocChain, chainText: docChainText, options })
          log.commits.length = 0
          log.dom.length = 0
          // a1's chain is still subscribed (subscription GC delay)
          harness.click('toA1')
          await harness.wait(THROTTLE / 4)
          expect(sampleDom(harness.container).text).toBe(docChainText(1))
          expectOnlyConsistentStates(log, { fallback: 'never' })
        })
      }
    })

    describe('document -> query -> documents', () => {
      it('deferred (default): commits only consistent states, without the fallback', async () => {
        const name = await seedQueryChain()
        const { log } = await runSwitch({ mode, name, useChain: useQueryChain, chainText: queryChainText })
        expectOnlyConsistentStates(log, { fallback: 'never' })
        expect(log.commits.at(-1)).toBe(queryChainText(2))
      })

      it('defer: false: commits only consistent states', async () => {
        const name = await seedQueryChain()
        const { log } = await runSwitch({ mode, name, useChain: useQueryChain, chainText: queryChainText, options: { defer: false } })
        expectOnlyConsistentStates(log, { fallback: 'shown' })
        expect(log.commits.at(-1)).toBe(queryChainText(2))
      })

      it('deferred: a1 -> a2 -> a3 in quick succession ends at a3 without committing a2', async () => {
        const name = await seedQueryChain()
        const { log } = await runSwitch({ mode, name, useChain: useQueryChain, chainText: queryChainText, steps: ['a2', 'a3'] })
        expectOnlyConsistentStates(log, { fallback: 'never' })
        expect(log.commits).not.toContain(queryChainText(2))
      })
    })

    describe('document -> aggregation -> documents', () => {
      const useAggregationChain = (name, aId, options) => useQueryChain(name, aId, options, { aggregate: true })

      it('deferred (default): commits only consistent states, without the fallback', async () => {
        const name = await seedQueryChain()
        const { log } = await runSwitch({ mode, name, useChain: useAggregationChain, chainText: queryChainText })
        expectOnlyConsistentStates(log, { fallback: 'never' })
        expect(log.commits.at(-1)).toBe(queryChainText(2))
      })

    })

    describe('useBatchSub() chain', () => {
      it('deferred (default): commits only consistent states, without the fallback', async () => {
        const name = await seedDocChain()
        const { log } = await runSwitch({ mode, name, useChain: useBatchChain, chainText: batchChainText })
        expectOnlyConsistentStates(log, { fallback: 'never' })
        expect(log.commits.at(-1)).toBe(batchChainText(2))
      })

      it('defer: false suspends to the fallback until the new chain is ready', async () => {
        const name = await seedDocChain()
        const { log } = await runSwitch({ mode, name, useChain: useBatchChain, chainText: batchChainText, options: { defer: false } })
        expectOnlyConsistentStates(log, { fallback: 'shown' })
        expect(log.commits.at(-1)).toBe(batchChainText(2))
      })

      it('deferred: a1 -> a2 -> a3 in quick succession ends at a3 without committing a2', async () => {
        const name = await seedDocChain()
        const { log } = await runSwitch({ mode, name, useChain: useBatchChain, chainText: batchChainText, steps: ['a2', 'a3'] })
        expectOnlyConsistentStates(log, { fallback: 'never' })
        expect(log.commits).not.toContain(batchChainText(2))
      })
    })

    describe('across components (a parent passes a field to a child observer)', () => {
      it('deferred (default): switches the parent and the child together, without the fallback', async () => {
        const name = await seedDocChain()
        const { log } = await runSwitch({ mode, name, chainText: docChainText, createComponent: createCrossComponentChain })
        expectOnlyConsistentStates(log, { fallback: 'never' })
        expect(log.commits.at(-1)).toBe(docChainText(2))
      })

      it('defer: false: commits only consistent states', async () => {
        const name = await seedDocChain()
        const { log } = await runSwitch({
          mode, name, chainText: docChainText, createComponent: createCrossComponentChain, options: { defer: false }
        })
        expectOnlyConsistentStates(log, { fallback: 'shown' })
        expect(log.commits.at(-1)).toBe(docChainText(2))
      })
    })

    it('keeps the chain consistent when uncommitted leases are released at once (subscription GC delay 0)', async () => {
      diagnostics.enable()
      setSubscriptionGcDelay(0)
      const name = await seedDocChain()
      const { log } = await runSwitch({ mode, name, useChain: useDocChain, chainText: docChainText })
      expectOnlyConsistentStates(log, { fallback: 'never' })
      expect(log.commits.at(-1)).toBe(docChainText(2))
      const loop = diagnostics.checkLeaks().findings.find(item => item.code === 'react.lease.reacquireLoop')
      expect(loop).toBe(undefined)
    })

    it('keeps the chain consistent when a link takes longer than an uncommitted lease is held', async () => {
      diagnostics.enable()
      const name = await seedDocChain()
      // the leases of the links before B wait for B longer than the 1000 ms
      // an uncommitted lease is held
      collectionDelays.set(name + 'B', 1100)
      const { log } = await runSwitch({ mode, name, useChain: useDocChain, chainText: docChainText })
      expectOnlyConsistentStates(log, { fallback: 'never' })
      expect(log.commits.at(-1)).toBe(docChainText(2))
      const loop = diagnostics.checkLeaks().findings.find(item => item.code === 'react.lease.reacquireLoop')
      expect(loop).toBe(undefined)
    }, 15000)

    it('a chained switch neither loops nor churns subscription leases', async () => {
      diagnostics.enable()
      const name = await seedDocChain()
      const leasesBefore = diagnostics.getCounters()['react.lease.create'] || 0
      const { log } = await runSwitch({ mode, name, useChain: useDocChain, chainText: docChainText })
      expectOnlyConsistentStates(log, { fallback: 'never' })
      // 3 for the first mount, 3 for the switch, and a few re-acquisitions
      // at most
      const leases = (diagnostics.getCounters()['react.lease.create'] || 0) - leasesBefore
      expect(leases).toBeLessThanOrEqual(9)
      const loop = diagnostics.checkLeaks().findings.find(item => item.code === 'react.lease.reacquireLoop')
      expect(loop).toBe(undefined)
    })
  })
}
