// A render that checks readiness imperatively — sub(); if pending throw
// promise.then(unsub); else unsub() — and then useSub()s the same target must
// commit. Before transport grace, releasing the last owner tore the ShareDB
// transport down at once (or made unsub() wait for the whole GC delay), so
// every retry subscribed again and the component never committed.
import { createElement as el } from 'react'
import { afterEach, beforeAll, describe, expect, it } from '@jest/globals'
import { act, cleanup, render } from '@testing-library/react'
import { getRootSignal, observer, sub, unsub, useSub, useSuspendMemo } from '../src/index.ts'
import { docSubscriptions } from '../src/orm/Doc.js'
import { querySubscriptions } from '../src/orm/Query.js'
import { aggregationSubscriptions } from '../src/orm/Aggregation.js'
import { getConnection } from '../src/orm/connection.ts'
import { getSubscriptionGcDelay, setSubscriptionGcDelay } from '../src/orm/subscriptionGcDelay.ts'
import connect from '../src/connect/test.js'

beforeAll(connect)

const baselineGcDelay = getSubscriptionGcDelay()
const $testRoot = getRootSignal({ rootId: 'transport-grace-react' })
const MAX_RENDERS = 200
const COMMIT_TIMEOUT_MS = 1500
const WIRE_ACTIONS = new Set(['s', 'u', 'bs', 'bu', 'qs', 'qu'])
let counter = 0

afterEach(cleanup)
afterEach(async () => {
  setSubscriptionGcDelay(0)
  await docSubscriptions.flushPendingDestroys()
  await querySubscriptions.flushPendingDestroys()
  await aggregationSubscriptions.flushPendingDestroys()
  setSubscriptionGcDelay(baselineGcDelay)
})

const TARGETS = {
  query: marker => [$testRoot.transportGraceReactStores, { _id: { $in: [] }, marker }],
  aggregation: marker => [$testRoot.transportGraceReactStores, { $aggregate: [{ $match: { marker } }] }],
  doc: marker => [$testRoot.transportGraceReactDocs[marker]]
}

function checkReadiness (args) {
  const subscription = sub(...args)
  if (typeof subscription.then === 'function') throw subscription.then(unsub)
  unsub(subscription)
}

function useMemoReadiness (args) {
  const key = JSON.stringify(args.slice(1))
  useSuspendMemo(() => checkReadiness(args), [args[0], key])
}

describe.each(Object.keys(TARGETS))('%s: readiness check followed by useSub of the same target', kind => {
  it.each([
    ['plain', false],
    ['useSuspendMemo', true]
  ])('commits (%s readiness)', async (_name, memo) => {
    setSubscriptionGcDelay(3000)
    const marker = `readiness-${kind}-${++counter}`
    const args = TARGETS[kind](marker)
    const stats = { renders: 0 }
    const wire = []
    const onSend = message => { if (WIRE_ACTIONS.has(message.a)) wire.push(message.a) }

    // The render-count guard bails out of a render loop for good, so the hook
    // order is stable for every render that reaches the hooks.
    const Component = observer(function ReadinessThenUseSub () {
      stats.renders += 1
      if (stats.renders > MAX_RENDERS) return el('span', {}, 'RenderLoop')
      if (memo) useMemoReadiness(args) // eslint-disable-line react-hooks/rules-of-hooks
      else checkReadiness(args)
      const $signal = useSub(...args, { defer: false }) // eslint-disable-line react-hooks/rules-of-hooks
      return el('span', {}, $signal ? 'Ready' : 'Missing')
    }, { suspenseProps: { fallback: el('span', {}, 'Loading') } })

    getConnection().on('send', onSend)
    try {
      const view = render(el(Component))
      const startedAt = Date.now()
      while (view.container.textContent !== 'Ready' && Date.now() - startedAt < COMMIT_TIMEOUT_MS) {
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
        if (view.container.textContent === 'RenderLoop') break
      }

      expect(view.container.textContent).toBe('Ready')
      expect(stats.renders).toBeLessThan(10)
      const unsubscribeAction = kind === 'doc' ? 'u' : 'qu'
      expect(wire.filter(action => action === unsubscribeAction)).toEqual([])
    } finally {
      getConnection().off('send', onSend)
    }
  })
})
