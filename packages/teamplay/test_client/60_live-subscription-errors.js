// A subscription the server stops: after a reconnect ShareDB re-subscribes
// every doc and query on its own (no callback), and the server can refuse that
// (the read rules no longer let the user read the doc, an unreadable doc now
// matches the query). ShareDB's client reports it with an 'error' event on the
// doc or query, which throws when nothing listens (an uncaught exception in the
// browser). Teamplay listens while it uses a ShareDB doc or query: the
// subscription becomes a failed one, like a sub() the server refused (0.6.1),
// so the components using it throw the error to their error boundary; a
// remount subscribes again. Nothing is thrown uncaught.
import '../src/diagnostics/index.ts'
import { Component, createElement as el, Fragment } from 'react'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { act, cleanup, render } from '@testing-library/react'
import ShareDB from 'sharedb'
import { Connection } from 'sharedb/lib/client/index.js'
import StreamSocket from 'sharedb/lib/stream-socket.js'
import ShareDbMingo from '@startupjs/sharedb-mingo-memory'
import { accessControl } from '@teamplay/utils/accessControl'
import initAccessControl from '../../backend/features/accessControl.js'
import { $, diagnostics, observer, sub, unsub, useAsyncSub, useBatchSub, useSub } from '../src/index.ts'
import { setConnection } from '../src/orm/connection.ts'
import { docSubscriptions } from '../src/orm/Doc.js'
import { querySubscriptions, hashQuery } from '../src/orm/Query.js'
import { setSubscriptionGcDelay } from '../src/orm/subscriptionGcDelay.ts'
import { resetTestThrottling, setTestThrottling } from '../src/react/useSub.ts'
import { runGc } from '../test/_helpers.js'

const GC_DELAY = 200
const USER = 'alice'
const DENIED = 'ERR_ACCESS_DENY_READ'

jest.setTimeout(20000)

let backend, server, connection, connectionErrors

beforeAll(() => {
  backend = new ShareDB({ db: new ShareDbMingo() })
  backend.use('connect', (context, next) => {
    context.agent.connectSession = context.req?.session
    next()
  })
  const log = console.log
  console.log = () => {}
  try {
    initAccessControl(backend, {
      models: {
        liveContacts: {
          access: accessControl({
            create: () => true,
            read: ({ doc, session }) => doc.ownerId === session.userId,
            update: () => true,
            delete: () => true
          }, { force: true })
        }
      },
      forceOnly: true,
      openByDefault: true
    })
  } finally {
    console.log = log
  }
  server = backend.connect()
  // the tested client: a remote one, as a browser's
  connection = new Connection(openSocket())
  connectionErrors = []
  // what an app without a listener would get as an uncaught exception
  connection.on('error', error => connectionErrors.push(error))
  setConnection(connection)
})

function openSocket (socket = new StreamSocket()) {
  socket.stream.isServer = false
  socket._open()
  backend.listen(socket.stream, { session: { userId: USER } })
  return socket
}

async function reconnect (whileOffline) {
  connection.close()
  await whileOffline()
  const socket = new StreamSocket()
  connection.bindToSocket(socket)
  openSocket(socket)
  await new Promise(resolve => connection.once('connected', resolve))
}

let consoleError, consoleWarn
let idCounter = 0
beforeEach(() => {
  connectionErrors.length = 0
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
  consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {})
  setSubscriptionGcDelay(GC_DELAY)
  diagnostics.enable()
})
afterEach(async () => {
  cleanup()
  resetTestThrottling()
  await wait(GC_DELAY + 300)
  consoleError.mockRestore()
  consoleWarn.mockRestore()
  diagnostics.disable()
})
afterAll(() => setSubscriptionGcDelay(null))

const wait = ms => act(async () => { await new Promise(resolve => setTimeout(resolve, ms)) })

function newId (prefix) {
  idCounter += 1
  return prefix + idCounter
}

function serverDoc (id) {
  return server.get('liveContacts', id)
}

function create (id, data) {
  return new Promise((resolve, reject) => serverDoc(id).create(data, err => err ? reject(err) : resolve()))
}

async function setOwner (id, ownerId) {
  const doc = serverDoc(id)
  await new Promise((resolve, reject) => doc.fetch(err => err ? reject(err) : resolve()))
  await new Promise((resolve, reject) => doc.submitOp([{ p: ['ownerId'], od: doc.data.ownerId, oi: ownerId }], err => err ? reject(err) : resolve()))
}

class ErrorBoundary extends Component {
  constructor (props) {
    super(props)
    this.state = { error: undefined }
  }

  static getDerivedStateFromError (error) {
    return { error }
  }

  render () {
    if (this.state.error) {
      return el('span', { className: 'result' }, 'threw ' + (this.state.error.code || this.state.error.message))
    }
    return this.props.children
  }
}

const fallback = el('span', { className: 'result' }, 'loading')

async function waitForResults (container, texts, timeout = 3000) {
  const read = () => Array.from(container.querySelectorAll('.result')).map(node => node.textContent)
  const start = Date.now()
  while (JSON.stringify(read()) !== JSON.stringify(texts) && Date.now() - start < timeout) await wait(20)
  expect(read()).toEqual(texts)
}

function failureWarnings () {
  return consoleWarn.mock.calls.filter(args => String(args[0]).startsWith('[teamplay] The server refused'))
}

function shareDoc (id) {
  return connection.collections.liveContacts?.[id]
}

async function expectNoLeaks () {
  await wait(GC_DELAY + 300)
  await runGc()
  const report = diagnostics.checkLeaks({ afterGc: true })
  expect(report.findings.filter(finding => finding.severity !== 'info')).toEqual([])
}

const ContactName = observer(function ContactName ({ id }) {
  const $contact = useSub($.liveContacts[id])
  return el('span', { className: 'result' }, $contact.name.get())
}, { suspenseProps: { fallback } })

const AsyncContactName = observer(function AsyncContactName ({ id }) {
  const $contact = useAsyncSub($.liveContacts[id])
  return el('span', { className: 'result' }, $contact ? $contact.name.get() : 'pending')
}, { suspenseProps: { fallback } })

const ContactCount = observer(function ContactCount ({ tag }) {
  const $contacts = useSub($.liveContacts, { tag })
  return el('span', { className: 'result' }, 'count ' + $contacts.getIds().length)
}, { suspenseProps: { fallback } })

const BatchedContacts = observer(function BatchedContacts ({ tag, id }) {
  const $contacts = useBatchSub($.liveContacts, { tag })
  const $contact = useBatchSub($.liveContacts[id])
  useBatchSub()
  return el('span', { className: 'result' }, 'count ' + $contacts.getIds().length + ' ' + $contact.name.get())
}, { suspenseProps: { fallback } })

describe('a doc whose re-subscribe the server refuses after a reconnect', () => {
  it('throws to the error boundary, not uncaught, and recovers on a remount once readable again', async () => {
    const id = newId('d')
    await create(id, { ownerId: USER, name: 'Contact' })
    const view = attempt => el(ErrorBoundary, { key: attempt }, el(ContactName, { id }))
    const { container, rerender } = render(view(1))
    await waitForResults(container, ['Contact'])

    // while offline the contact is handed over to carol
    await reconnect(() => setOwner(id, 'carol'))
    await waitForResults(container, ['threw ' + DENIED])
    expect(connectionErrors).toEqual([])
    expect(failureWarnings()).toHaveLength(1)
    expect(String(failureWarnings()[0][0])).toContain('liveContacts.' + id)
    // ShareDB does not keep re-subscribing it on every reconnect
    expect(shareDoc(id).subscribed).toBe(false)
    expect(shareDoc(id).wantSubscribe).toBe(false)

    // carol hands it back; resetting the boundary subscribes again
    await setOwner(id, USER)
    rerender(view(2))
    await waitForResults(container, ['Contact'])
    expect(shareDoc(id).subscribed).toBe(true)
    expect(shareDoc(id).listenerCount('error')).toBe(1)
    expect(connectionErrors).toEqual([])

    cleanup()
    await expectNoLeaks()
    expect(shareDoc(id)).toBeUndefined()
  })

  it('a remount while it is still refused throws again, once per mount', async () => {
    const id = newId('d')
    await create(id, { ownerId: USER, name: 'Contact' })
    const view = attempt => el(ErrorBoundary, { key: attempt }, el(ContactName, { id }))
    const { container, rerender } = render(view(1))
    await waitForResults(container, ['Contact'])
    await reconnect(() => setOwner(id, 'carol'))
    await waitForResults(container, ['threw ' + DENIED])

    rerender(view(2))
    await waitForResults(container, ['threw ' + DENIED])
    await wait(GC_DELAY + 300)
    expect(container.querySelector('.result').textContent).toBe('threw ' + DENIED)
    expect(connectionErrors).toEqual([])
    cleanup()
    await expectNoLeaks()
  })

  it('every component using it throws; a sub() owner keeps its last data; useAsyncSub() throws too', async () => {
    const id = newId('d')
    await create(id, { ownerId: USER, name: 'Contact' })
    const $contact = await sub($.liveContacts[id])
    const { container } = render(el(Fragment, {},
      el(ErrorBoundary, {}, el(ContactName, { id })),
      el(ErrorBoundary, {}, el(ContactName, { id })),
      el(ErrorBoundary, {}, el(AsyncContactName, { id }))
    ))
    await waitForResults(container, ['Contact', 'Contact', 'Contact'])

    await reconnect(() => setOwner(id, 'carol'))
    await waitForResults(container, ['threw ' + DENIED, 'threw ' + DENIED, 'threw ' + DENIED])
    expect(connectionErrors).toEqual([])
    expect(failureWarnings()).toHaveLength(1)
    // the last data stays (the server sent nothing new)
    expect($contact.name.get()).toBe('Contact')
    expect($contact.ownerId.get()).toBe(USER)

    await unsub($contact)
    cleanup()
    await expectNoLeaks()
  })

  it('is only logged when nothing uses it any more (its subscription lingering in the GC grace)', async () => {
    const id = newId('d')
    await create(id, { ownerId: USER, name: 'Contact' })
    setSubscriptionGcDelay(5000)
    const $contact = await sub($.liveContacts[id])
    await unsub($contact)
    expect(shareDoc(id).subscribed).toBe(true)

    await reconnect(() => setOwner(id, 'carol'))
    await wait(100)
    expect(connectionErrors).toEqual([])
    expect(failureWarnings()).toHaveLength(1)
    expect(shareDoc(id).wantSubscribe).toBe(false)

    // a new owner subscribes on the wire (and is refused), not to the dead transport
    await expect(sub($.liveContacts[id])).rejects.toMatchObject({ code: DENIED })
    setSubscriptionGcDelay(GC_DELAY)
    await docSubscriptions.flushPendingDestroys()
    await expectNoLeaks()
  })
})

describe('a query whose re-subscribe the server refuses after a reconnect', () => {
  it('throws to the error boundary, not uncaught, and recovers on a remount', async () => {
    const tag = newId('t')
    await create(newId('q'), { ownerId: USER, name: 'Mine', tag })
    const view = attempt => el(ErrorBoundary, { key: attempt }, el(ContactCount, { tag }))
    const { container, rerender } = render(view(1))
    await waitForResults(container, ['count 1'])

    // while offline a contact alice may not read starts matching the query
    const hidden = newId('q')
    await reconnect(() => create(hidden, { ownerId: 'carol', name: 'Not mine', tag }))
    await waitForResults(container, ['threw ' + DENIED])
    expect(connectionErrors).toEqual([])
    expect(failureWarnings()).toHaveLength(1)

    await setOwner(hidden, USER)
    rerender(view(2))
    await waitForResults(container, ['count 2'])
    expect(connectionErrors).toEqual([])
    cleanup()
    await expectNoLeaks()
  })

  it('in a batched subscription, throws to the error boundary', async () => {
    const tag = newId('t')
    const id = newId('q')
    await create(id, { ownerId: USER, name: 'Mine', tag })
    const { container } = render(el(ErrorBoundary, {}, el(BatchedContacts, { tag, id })))
    await waitForResults(container, ['count 1 Mine'])

    await reconnect(() => create(newId('q'), { ownerId: 'carol', name: 'Not mine', tag }))
    await waitForResults(container, ['threw ' + DENIED])
    expect(connectionErrors).toEqual([])
    cleanup()
    await expectNoLeaks()
  })

  for (const batched of [false, true]) {
    it(`stopped while its component still waits for it, throws instead of waiting for good${batched ? ' (batched)' : ''}`, async () => {
      const tag = newId('t')
      const id = newId('q')
      await create(id, { ownerId: USER, name: 'Mine', tag })
      // the hook sees the subscription only after this; the transport is live before
      setTestThrottling(400)
      const { container } = render(el(ErrorBoundary, {}, batched ? el(BatchedContacts, { tag, id }) : el(ContactCount, { tag })))
      await wait(100)
      expect(container.querySelector('.result').textContent).toBe('loading')
      await reconnect(() => create(newId('q'), { ownerId: 'carol', name: 'Not mine', tag }))
      await waitForResults(container, ['threw ' + DENIED])
      expect(connectionErrors).toEqual([])
      resetTestThrottling()
      cleanup()
      await expectNoLeaks()
    })
  }

  it('in a batched subscription refused at once, throws to the error boundary every time', async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const tag = newId('t')
      const id = newId('q')
      await create(id, { ownerId: USER, name: 'Mine', tag })
      await create(newId('q'), { ownerId: 'carol', name: 'Not mine', tag })
      const { container } = render(el(ErrorBoundary, {}, el(BatchedContacts, { tag, id })))
      await waitForResults(container, ['threw ' + DENIED])
      cleanup()
    }
    expect(connectionErrors).toEqual([])
    await expectNoLeaks()
    for (const [hash, entry] of querySubscriptions.entries) {
      expect({ hash, owners: entry.owners.size, runtime: !!entry.runtime }).toEqual({ hash, owners: 0, runtime: false })
    }
  })
})

// A subscription the server stopped keeps its owners (they hold its signal)
// but must not stay, nor be re-opened, on the wire: the client query is
// released so the server drops its side, and the stopped entry stays idle
// through any reconcile until a fresh owner asks for it again.
describe('a stopped query is released on the wire and not re-subscribed', () => {
  it('destroys the client query and stays idle through a reconcile while an owner remains', async () => {
    const tag = newId('t')
    await create(newId('q'), { ownerId: USER, name: 'Mine', tag })
    const queryBaseline = Object.keys(connection.queries).length
    // an imperative owner that stays (no component to unmount)
    const $contacts = await sub($.liveContacts, { tag })
    const hash = hashQuery('liveContacts', { tag })
    expect(Object.keys(connection.queries).length).toBe(queryBaseline + 1)
    expect(querySubscriptions.entries.get(hash)?.mode).toBe('subscribe')

    // offline, a contact the owner may not read starts matching the query;
    // the re-subscribe is refused
    await reconnect(() => create(newId('q'), { ownerId: 'carol', name: 'Hidden', tag }))
    await wait(200)

    const entry = querySubscriptions.entries.get(hash)
    expect(entry?.stopped).toBe(true)
    expect(entry.owners.size).toBeGreaterThan(0)
    // released on the wire: the runtime dropped its ShareDB query (so the
    // server is told to drop it and its error listener is gone), and the
    // client connection holds no query for it
    expect(entry.runtime?.shareQuery).toBeUndefined()
    expect(Object.keys(connection.queries).length).toBe(queryBaseline)
    expect(querySubscriptions.getTargetTransportMode(hash)).toBe('idle')
    // the manager recorded the failure for this query
    expect(querySubscriptions.getSubscriptionFailureKey($contacts)).toContain('liveContacts')

    // a reconcile must not re-open the transport
    await querySubscriptions.reconcileTransport(hash)
    await wait(50)
    expect(querySubscriptions.getTargetTransportMode(hash)).toBe('idle')
    expect(querySubscriptions.entries.get(hash)?.mode).toBe('idle')
    expect(Object.keys(connection.queries).length).toBe(queryBaseline)
    expect(connectionErrors).toEqual([])

    await unsub($contacts)
    await expectNoLeaks()
  })
})

describe('a stopped doc is not re-subscribed', () => {
  it('stays idle through a reconcile while an owner remains, and is unsubscribed on the wire', async () => {
    const id = newId('d')
    await create(id, { ownerId: USER, name: 'Contact' })
    // an imperative owner that stays (no component to unmount)
    const $contact = await sub($.liveContacts[id])
    const hash = JSON.stringify(['liveContacts', id])
    expect(docSubscriptions.entries.get(hash)?.mode).toBe('subscribe')

    // offline, the contact is handed over to carol; the re-subscribe is refused
    await reconnect(() => setOwner(id, 'carol'))
    await wait(200)

    const entry = docSubscriptions.entries.get(hash)
    expect(entry?.stopped).toBe(true)
    expect(entry.owners.size).toBeGreaterThan(0)
    expect(docSubscriptions.getTargetTransportMode(hash)).toBe('idle')
    expect(shareDoc(id).subscribed).toBe(false)
    expect(shareDoc(id).wantSubscribe).toBe(false)

    // a reconcile must not subscribe it again (the server would refuse it)
    await docSubscriptions.reconcileTransport(hash)
    await wait(50)
    expect(docSubscriptions.getTargetTransportMode(hash)).toBe('idle')
    expect(docSubscriptions.entries.get(hash)?.mode).toBe('idle')
    expect(shareDoc(id).subscribed).toBe(false)
    expect(connectionErrors).toEqual([])
    // the last data stays
    expect($contact.name.get()).toBe('Contact')

    await unsub($contact)
    await expectNoLeaks()
  })
})
