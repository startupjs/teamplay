// A useSub() lease and imperative sub()/unsub() calls on the same signal must
// not release each other's ownership: an unsub() meant for an imperative
// fetch must not downgrade the subscription a mounted component holds.
import { createElement as el } from 'react'
import { afterEach, beforeAll, describe, expect, it } from '@jest/globals'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { $, observer, sub, unsub, useSub } from '../src/index.ts'
import { docSubscriptions } from '../src/orm/Doc.js'
import { getConnection } from '../src/orm/connection.ts'
import { getSubscriptionGcDelay, setSubscriptionGcDelay } from '../src/orm/subscriptionGcDelay.ts'
import connect from '../src/connect/test.js'

const COLLECTION = 'unsubIntentsReact'
const baselineGcDelay = getSubscriptionGcDelay()

beforeAll(async () => {
  connect()
  const doc = getConnection().get(COLLECTION, 'a')
  await new Promise((resolve, reject) => doc.fetch(err => err ? reject(err) : resolve()))
  if (doc.type == null) await new Promise((resolve, reject) => doc.create({ name: 'a' }, err => err ? reject(err) : resolve()))
})
afterEach(cleanup)
afterEach(async () => {
  setSubscriptionGcDelay(0)
  await docSubscriptions.flushPendingDestroys()
  setSubscriptionGcDelay(baselineGcDelay)
})

function counts () {
  const record = docSubscriptions.ownerRecords.get(JSON.stringify({ owner: [null, JSON.stringify([COLLECTION, 'a'])] }))
  return { fetch: record?.fetchCount ?? 0, subscribe: record?.subscribeCount ?? 0 }
}

describe('useSub() lease and imperative unsub() on the same signal', () => {
  it('an imperative fetch released while the component is mounted keeps its subscription', async () => {
    setSubscriptionGcDelay(1000)
    const $doc = await sub($[COLLECTION].a, { mode: 'fetch' })
    const Component = observer(function Reader () {
      const $a = useSub($[COLLECTION].a)
      return el('span', {}, $a.name.get())
    })
    const view = render(el(Component))
    await waitFor(() => expect(view.container.textContent).toBe('a'))
    expect(counts()).toEqual({ fetch: 1, subscribe: 1 })

    await act(async () => { await unsub($doc) })
    expect(counts()).toEqual({ fetch: 0, subscribe: 1 })
    expect(docSubscriptions.entries.get(JSON.stringify([COLLECTION, 'a']))?.mode).toBe('subscribe')

    view.unmount()
    await waitFor(() => expect(counts()).toEqual({ fetch: 0, subscribe: 0 }))
  })
})
