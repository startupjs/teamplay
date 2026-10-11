// The 'receive' middleware of @teamplay/sharedb-access runs before ShareDB
// checks a message. A message that may read ops (a fetch or subscribe from a
// version, a bulk request with a versions map, a query resubscribe with the
// versions of its results) is refused when its shape is not one ShareDB's
// client sends, instead of being passed on: ShareDB reads array-likes and
// strings as lists too, so a message passed on unchecked could read ops no
// rule saw. The checks keep the order of a connection's messages, and a
// failed check answers with a generic error.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import util from 'node:util'
import { afterEach, beforeEach, describe, it } from 'mocha'
import {
  PRIVATE_PHONE,
  assertNoPrivateData,
  connectClient,
  countSnapshotReads,
  create,
  createBackendWithRules,
  fetch,
  recordMessages,
  sendRaw,
  settle,
  silenceShareDbLogger,
  submit,
  subscribe,
  waitUntil,
  whenConnected
} from './_accessControl.js'

const BADLY_FORMED = 'ERR_MESSAGE_BADLY_FORMED'

describe('access control: requests that may read ops', () => {
  let backend, server, snapshotReads, restoreLogger

  beforeEach(() => {
    restoreLogger = silenceShareDbLogger()
    backend = createBackendWithRules()
    snapshotReads = countSnapshotReads(backend)
    server = backend.connect()
  })

  afterEach(() => {
    restoreLogger()
  })

  async function seedContact (id = 'c1') {
    const doc = server.get('contacts', id)
    await create(doc, { ownerId: 'alice', name: 'Contact' })
    await submit(doc, [{ p: ['phone'], oi: PRIVATE_PHONE }])
    return doc
  }

  describe('a malformed message', () => {
    // every shape ShareDB would read as an op read but its client never sends
    const MALFORMED = [
      // a query resubscribe: `r` is read as an array-like of [id, version]
      { a: 'qs', id: 1, c: 'contacts', q: {}, r: { 0: ['c1', 0], length: 1 } },
      { a: 'qs', id: 2, c: 'contacts', q: {}, r: 'c1' },
      { a: 'qs', id: 3, c: 'contacts', q: {}, r: 1 },
      { a: 'qs', id: 4, c: 'contacts', q: {}, r: [{ 0: 'c1', 1: 0, length: 2 }] },
      { a: 'qs', id: 5, c: 'contacts', q: {}, r: ['c1'] },
      { a: 'qs', id: 6, c: 'contacts', q: {}, r: [null] },
      { a: 'qs', id: 7, c: 'contacts', q: {}, r: [['c1', '0']] },
      { a: 'qs', id: 8, c: 'contacts', q: {}, r: [['c1', -1]] },
      { a: 'qs', id: 9, c: 'contacts', q: {}, r: [[['c1'], 0]] },
      { a: 'qs', id: 10, c: 'contacts', q: {}, r: [['__proto__', 0]] },
      // a query fetch also reads `r` (ShareDB's getQueryOptions loops it)
      { a: 'qf', id: 30, c: 'contacts', q: {}, r: { length: 1e9 } },
      { a: 'qf', id: 31, c: 'contacts', q: {}, r: 'c1' },
      { a: 'qf', id: 32, c: 'contacts', q: {}, r: [['c1', -1]] },
      // a bulk request: a non-array `b` is a versions map
      { a: 'bf', c: 'contacts', b: null },
      { a: 'bs', c: 'contacts', b: null },
      { a: 'bf', c: 'contacts', b: { c1: '0' } },
      { a: 'bs', c: 'contacts', b: { c1: {} } },
      { a: 'bf', c: 'contacts', b: { c1: 1.5 } },
      { a: 'bs', c: 'contacts', b: { c1: -1 } },
      { a: 'bf', c: 'contacts', b: 'c1' },
      // a bulk unsubscribe: ShareDB iterates `b` as an array of ids
      { a: 'bu', c: 'contacts', b: { length: 1e9 } },
      { a: 'bu', c: 'contacts', b: { 0: 'c1', length: 2 } },
      { a: 'bu', c: 'contacts', b: 'c1' },
      { a: 'bu', c: 'contacts', b: { c1: 1 } },
      { a: 'bu', c: 'contacts', b: null },
      // a bulk fetch/subscribe versions map that async/lodash read as an array
      // (a numeric `length`), so ShareDB's bulk path would loop `length` times
      { a: 'bf', c: 'contacts', b: { length: 1e7 } },
      { a: 'bs', c: 'contacts', b: { length: 1e7 } },
      { a: 'bf', c: 'contacts', b: { length: 0 } },
      { a: 'bs', c: 'contacts', b: { c1: 0, length: 5 } },
      // a versions map or result id that names a prototype
      { a: 'bf', c: 'contacts', b: { prototype: 0 } },
      { a: 'qs', id: 40, c: 'contacts', q: {}, r: [['length', 0]] },
      { a: 'qs', id: 41, c: 'contacts', q: {}, r: [['prototype', 0]] },
      { a: 'qf', id: 42, c: 'contacts', q: {}, r: [['length', 1e7]] },
      // a bulk fetch/subscribe with an array of ids: duplicate or non-string
      { a: 'bs', c: 'contacts', b: ['c1', 'c1'] },
      { a: 'bf', c: 'contacts', b: ['c1', 123] },
      { a: 'bs', c: 'contacts', b: [['c1']] },
      { a: 'bf', c: 'contacts', b: ['__proto__'] },
      // a snapshot fetch whose doc id is not a string (would reach the db as
      // a query and the rule as a non-string id)
      { a: 'nf', c: 'contacts', d: { $gt: '' }, v: 1 },
      { a: 'nt', c: 'contacts', d: { $eq: 'c1' }, ts: 1 },
      { a: 'nf', c: 'contacts', d: ['c1'] },
      { a: 'nf', c: 'contacts', d: 'c1', v: -1 },
      // a fetch or subscribe from a version
      { a: 'f', c: 'contacts', d: 'c1', v: '0' },
      { a: 's', c: 'contacts', d: 'c1', v: -1 },
      { a: 'f', c: 'contacts', d: 'c1', v: {} },
      { a: 's', c: 'contacts', v: 0 },
      { a: 'f', c: 'contacts', d: ['c1'], v: 0 },
      { a: 's', c: 'contacts', d: '__proto__', v: 0 }
    ]

    for (const message of MALFORMED) {
      it(`is refused before anything is read: ${JSON.stringify(message)}`, async () => {
        await seedContact()
        const bob = connectClient(backend, { userId: 'bob' })
        const received = recordMessages(bob)
        snapshotReads.reset()
        const reply = await sendRaw(bob, message, isReplyTo(message))
        assert.equal(reply.error?.code, BADLY_FORMED)
        assert.equal(snapshotReads.count, 0)
        await settle()
        assertNoPrivateData(received)
        assert.equal(received.filter(message => message.a === 'op').length, 0)
      })
    }

    it('claiming a huge result list costs nothing, and the server keeps serving', async () => {
      await seedContact()
      const bob = connectClient(backend, { userId: 'bob' })
      await new Promise(resolve => whenConnected(bob, resolve))
      global.gc?.()
      const heapBefore = process.memoryUsage().heapUsed
      const start = Date.now()
      const reply = await sendRaw(bob, { a: 'qs', id: 1, c: 'contacts', q: {}, r: { length: 5e6 } })
      const elapsed = Date.now() - start
      const grown = process.memoryUsage().heapUsed - heapBefore
      assert.equal(reply.error?.code, BADLY_FORMED)
      assert.ok(grown < 32 * 1024 * 1024, `the heap grew by ${Math.round(grown / 1024 / 1024)} MB`)
      assert.ok(elapsed < 1000, `took ${elapsed} ms`)

      const alice = connectClient(backend, { userId: 'alice' })
      const doc = alice.get('contacts', 'c1')
      await fetch(doc)
      assert.equal(doc.data.phone, PRIVATE_PHONE)
    })

    it('claiming a billion results does not take the server down (64 MB heap)', async function () {
      this.timeout(20000)
      const script = fileURLToPath(new URL('./_malformedRequestServer.js', import.meta.url))
      const { code, stdout, stderr } = await runNode(['--max-old-space-size=64', script])
      assert.equal(code, 0, stderr.slice(-2000))
      assert.match(stdout, /refused ERR_MESSAGE_BADLY_FORMED/)
      assert.match(stdout, /still serving/)
    })

    it('a bulk unsubscribe with a huge length is refused at once, without blocking the event loop', async function () {
      this.timeout(5000)
      const mallory = connectClient(backend, { userId: 'mallory' })
      await new Promise(resolve => whenConnected(mallory, resolve))
      // a timer that keeps firing shows the event loop is not blocked
      const ticks = []
      const timer = setInterval(() => ticks.push(Date.now()), 10)
      const start = Date.now()
      const reply = await sendRaw(mallory, { a: 'bu', c: 'contacts', b: { length: 1e9 } })
      await settle()
      const elapsed = Date.now() - start
      clearInterval(timer)
      assert.equal(reply.error?.code, BADLY_FORMED)
      assert.ok(elapsed < 1000, `took ${elapsed} ms`)
      // the timer kept firing while the message was handled
      assert.ok(ticks.length >= 2, `only ${ticks.length} timer ticks`)
    })

    it('a bulk subscribe naming one id many times leaks no pubsub streams', async () => {
      await create(server.get('notes', 'n1'), { text: 'open' })
      const mallory = connectClient(backend, { userId: 'mallory' })
      await new Promise(resolve => whenConnected(mallory, resolve))
      const before = backend.pubsub.streamsCount
      for (let round = 0; round < 5; round++) {
        const reply = await sendRaw(mallory, { a: 'bs', c: 'notes', b: new Array(20000).fill('n1') })
        assert.equal(reply.error?.code, BADLY_FORMED)
      }
      await settle()
      assert.ok(backend.pubsub.streamsCount - before <= 1, `streams grew by ${backend.pubsub.streamsCount - before}`)
    })

    it('an array-like versions map is refused at once, without looping ShareDB\'s bulk path', async function () {
      this.timeout(5000)
      const mallory = connectClient(backend, { userId: 'mallory' })
      await new Promise(resolve => whenConnected(mallory, resolve))
      global.gc?.()
      const heapBefore = process.memoryUsage().heapUsed
      const ticks = []
      const timer = setInterval(() => ticks.push(Date.now()), 10)
      const start = Date.now()
      for (const a of ['bf', 'bs']) {
        const reply = await sendRaw(mallory, { a, c: 'contacts', b: { length: 1e7 } })
        assert.equal(reply.error?.code, BADLY_FORMED, a)
      }
      await settle()
      const elapsed = Date.now() - start
      clearInterval(timer)
      const grown = process.memoryUsage().heapUsed - heapBefore
      assert.ok(elapsed < 1000, `took ${elapsed} ms`)
      assert.ok(ticks.length >= 2, `only ${ticks.length} timer ticks`)
      assert.ok(grown < 64 * 1024 * 1024, `the heap grew by ${Math.round(grown / 1024 / 1024)} MB`)
    })

    it('refuses a versions map with an own __proto__ key', async () => {
      const bob = connectClient(backend, { userId: 'bob' })
      for (const a of ['bf', 'bs']) {
        // JSON.parse makes __proto__ an own key (an object literal would not)
        const reply = await sendRaw(bob, JSON.parse(`{"a":"${a}","c":"contacts","b":{"__proto__":{"x":1}}}`))
        assert.equal(reply.error?.code, BADLY_FORMED, a)
      }
      // Object.prototype was not touched
      assert.equal({}.x, undefined)
    })

    it('accepts a versions map with ordinary numeric-string keys (not array-like)', async () => {
      await create(server.get('contacts', '0'), { ownerId: 'alice', name: 'zero' })
      await create(server.get('contacts', '1'), { ownerId: 'alice', name: 'one' })
      const alice = connectClient(backend, { userId: 'alice' })
      for (const a of ['bf', 'bs']) {
        const reply = await sendRaw(alice, { a, c: 'contacts', b: { 0: 1, 1: 1 } })
        assert.notEqual(reply.error?.code, BADLY_FORMED, a)
      }
    })
  })

  describe('a write to a doc id that could never be read back', () => {
    // the ids a read refuses (see 'a malformed message'): a doc written under
    // one could never be fetched or subscribed, so the write is refused too
    const UNSAFE_IDS = ['length', 'prototype', '__proto__', 'constructor', 'toString', 'hasOwnProperty']
    const JSON0 = 'http://sharejs.org/types/JSONv0'

    function isReplyToOp (id) {
      return reply => reply.a === 'op' && reply.c === 'contacts' && reply.d === id && 'error' in reply
    }

    for (const id of UNSAFE_IDS) {
      it(`refuses a create, an op and a delete on '${id}'; nothing is submitted`, async () => {
        const submitted = []
        backend.use('submit', (request, next) => { submitted.push(request.id); next() })
        const alice = connectClient(backend, { userId: 'alice' })
        const writes = [
          { a: 'op', c: 'contacts', d: id, v: null, seq: 1, create: { type: JSON0, data: { ownerId: 'alice', name: 'x' } } },
          { a: 'op', c: 'contacts', d: id, v: 0, seq: 2, op: [{ p: ['name'], oi: 'y' }] },
          { a: 'op', c: 'contacts', d: id, v: 0, seq: 3, del: true }
        ]
        for (const message of writes) {
          const reply = await sendRaw(alice, message, isReplyToOp(id))
          assert.equal(reply.error?.code, BADLY_FORMED, JSON.stringify(message))
        }
        assert.deepEqual(submitted, [])
      })
    }

    it('accepts a write to an ordinary id, numeric ones included', async () => {
      const alice = connectClient(backend, { userId: 'alice' })
      for (const id of ['c9', '0', 'lengthy', 'my-prototype']) {
        await create(alice.get('contacts', id), { ownerId: 'alice', name: id })
      }
    })
  })

  describe('the messages ShareDB\'s client sends', () => {
    it('keep working: ids without versions, versions maps with nulls, results without versions', async () => {
      await seedContact('c1')
      await seedContact('c2')
      const alice = connectClient(backend, { userId: 'alice' })
      const messages = [
        { a: 'bf', c: 'contacts', b: ['c1', 'c2'] },
        { a: 'bs', c: 'contacts', b: ['c1', 'c2'] },
        { a: 'bf', c: 'contacts', b: { c1: 0, c2: null } },
        { a: 'bs', c: 'contacts', b: { c1: 1, c2: 2 } },
        { a: 'f', c: 'contacts', d: 'c1', v: 0 },
        { a: 's', c: 'contacts', d: 'c2', v: 2 },
        { a: 'qs', id: 1, c: 'contacts', q: { ownerId: 'alice' }, r: [['c1', 1], ['c2', null]] },
        { a: 'qs', id: 2, c: 'contacts', q: { ownerId: 'alice' }, r: [] },
        { a: 'qf', id: 3, c: 'contacts', q: { ownerId: 'alice' } },
        { a: 'qf', id: 4, c: 'contacts', q: { ownerId: 'alice' }, r: [['c1', 1], ['c2', null]] },
        { a: 'bs', c: 'contacts', b: ['c1', 'c2'] },
        { a: 'bu', c: 'contacts', b: ['c1', 'c2'] }
      ]
      for (const message of messages) {
        const reply = await sendRaw(alice, message)
        assert.equal(reply.error, undefined, JSON.stringify(message))
      }
    })

    it('a reconnect resubscribing thousands of docs in one bulk request is not capped', async () => {
      const count = 2000
      const versions = {}
      for (let i = 0; i < count; i++) {
        await create(server.get('contacts', 'd' + i), { ownerId: 'alice' })
        versions['d' + i] = 1
      }
      const alice = connectClient(backend, { userId: 'alice' })
      snapshotReads.reset()
      const reply = await sendRaw(alice, { a: 'bs', c: 'contacts', b: versions })
      assert.equal(reply.error, undefined)
      assert.equal(snapshotReads.count, 1)
      assert.equal(snapshotReads.ids, count)
    })
  })

  describe('a reading message without a usable collection', () => {
    const MESSAGES = [
      { a: 'f', d: 'c1', v: 0 },
      { a: 's', d: 'c1', v: 0 },
      { a: 'f', d: 'c1' },
      { a: 'bf', b: { c1: 0 } },
      { a: 'bs', b: ['c1'] },
      { a: 'qs', id: 1, q: {}, r: [['c1', 0]] },
      { a: 'qf', id: 2, q: {} },
      { a: 'qs', id: 3, c: '__proto__', q: {}, r: [['c1', 0]] },
      { a: 'qs', id: 4, c: 'constructor', q: {} },
      { a: 'f', c: 'hasOwnProperty', d: 'c1', v: 0 }
    ]
    for (const message of MESSAGES) {
      it(`is refused before anything is read: ${JSON.stringify(message)}`, async () => {
        await seedContact()
        const bob = connectClient(backend, { userId: 'bob' })
        snapshotReads.reset()
        const reply = await sendRaw(bob, message)
        assert.equal(reply.error?.code, 'ERR_ACCESS_DENY_READ')
        assert.equal(snapshotReads.count, 0)
      })
    }
  })

  describe('a check that fails', () => {
    const CAUSE = 'adapter detail mongodb://user:secret@db'
    let consoleError, logged

    beforeEach(() => {
      logged = []
      consoleError = console.error
      console.error = (...args) => logged.push(util.inspect(args, { depth: 10 }))
    })

    afterEach(() => {
      console.error = consoleError
    })

    function failSnapshotReads () {
      const getSnapshotBulk = backend.db.getSnapshotBulk
      backend.db.getSnapshotBulk = (collection, ids, fields, options, callback) => {
        process.nextTick(callback, new Error(CAUSE))
      }
      return () => { backend.db.getSnapshotBulk = getSnapshotBulk }
    }

    it('answers the client with a generic error and logs the cause on the server', async () => {
      await seedContact()
      const alice = connectClient(backend, { userId: 'alice' })
      await new Promise(resolve => whenConnected(alice, resolve))
      const restore = failSnapshotReads()
      const reply = await sendRaw(alice, { a: 'f', c: 'contacts', d: 'c1', v: 0 })
      restore()
      assert.equal(reply.error?.code, 'ERR_ACCESS_CHECK_FAILED')
      assert.ok(!JSON.stringify(reply).includes(CAUSE), JSON.stringify(reply))
      assert.ok(logged.some(entry => entry.includes(CAUSE)), 'the cause is logged')
    })

    it('does not hold back the connection\'s later messages', async () => {
      await seedContact()
      const alice = connectClient(backend, { userId: 'alice' })
      await new Promise(resolve => whenConnected(alice, resolve))
      const restore = failSnapshotReads()
      const replies = []
      alice.on('receive', request => {
        if (request.data?.a === 'f' || request.data?.a === 'pp') replies.push(request.data.a)
      })
      alice.send({ a: 'f', c: 'contacts', d: 'c1', v: 0 })
      alice.send({ a: 'pp' })
      await waitUntil(() => replies.length === 2)
      restore()
      assert.deepEqual(replies, ['f', 'pp'])
      const reply = await sendRaw(alice, { a: 'f', c: 'contacts', d: 'c1', v: 0 })
      assert.equal(reply.error, undefined)
    })

    it('refuses a live op whose check fails, and logs the cause without the op', async () => {
      const contact = await seedContact()
      const bob = connectClient(backend, { userId: 'bob' })
      // ShareDB forwards the ops of every id of a query resubscribe until it polls
      await sendRaw(bob, { a: 'qs', id: 1, c: 'contacts', q: { name: 'Contact' }, r: [['c1', 0]] })
      const received = recordMessages(bob)
      const restore = failSnapshotReads()
      await submit(contact, [{ p: ['secret'], oi: PRIVATE_PHONE }])
      await settle()
      restore()
      assertNoPrivateData(received)
      assert.ok(logged.some(entry => entry.includes(CAUSE)), 'the cause is logged')
      assert.ok(!logged.some(entry => entry.includes(PRIVATE_PHONE)), 'the log carries the op')
    })
  })

  describe('the order of a connection\'s messages', () => {
    it('reaches ShareDB as they arrive, while some wait for a check', async () => {
      await seedContact()
      const alice = connectClient(backend, { userId: 'alice' })
      await new Promise(resolve => whenConnected(alice, resolve))
      const order = []
      backend.use('receive', (request, next) => {
        if (request.agent === alice.agent) order.push(describe(request.data))
        next()
      })
      // the version reads wait for the access check, the others need none
      const burst = [
        { a: 's', c: 'contacts', d: 'c1', v: 1 },
        { a: 'u', c: 'contacts', d: 'c1' },
        { a: 'pp' },
        { a: 'qs', id: 7, c: 'contacts', q: {}, r: [['c1', 1]] },
        { a: 'qu', id: 7 },
        { a: 'f', c: 'contacts', d: 'c1' },
        { a: 'bf', c: 'contacts', b: { c1: 1 } },
        { a: 'bf', c: 'contacts', b: ['c1'] },
        { a: 'pp' }
      ]
      for (const message of burst) alice.send(message)
      await waitUntil(() => order.length === burst.length)
      assert.deepEqual(order, burst.map(describe))

      function describe (message) {
        return message.a + (message.id ?? '') + (message.b ? (Array.isArray(message.b) ? '[]' : '{}') : '')
      }
    })

    it('passes a message at once when no check is in flight, and holds it behind one that is', async () => {
      await seedContact()
      const alice = connectClient(backend, { userId: 'alice' })
      await new Promise(resolve => whenConnected(alice, resolve))
      const access = backend.accessControl
      const agent = alice.agent
      const passed = []
      access.receiveHandler({ agent, data: { a: 'pp' } }, err => passed.push(['pp', err]))
      assert.deepEqual(passed, [['pp', undefined]])

      access.receiveHandler({ agent, data: { a: 'f', c: 'contacts', d: 'c1', v: 0 } }, err => passed.push(['f', err]))
      access.receiveHandler({ agent, data: { a: 'u', c: 'contacts', d: 'c1' } }, err => passed.push(['u', err]))
      access.receiveHandler({ agent, data: { a: 'qs', id: 1, c: 'contacts', q: {}, r: [1] } }, err => passed.push(['qs', err?.code]))
      assert.equal(passed.length, 1)
      await waitUntil(() => passed.length === 4)
      assert.deepEqual(passed.slice(1), [['f', undefined], ['u', undefined], ['qs', BADLY_FORMED]])

      // and passes at once again when the checks are done
      access.receiveHandler({ agent, data: { a: 'pp' } }, err => passed.push(['pp', err]))
      assert.equal(passed.length, 5)
    })

    it('a subscribe from a version that the client drops right away (ShareDB\'s client never sends this)', async () => {
      // ShareDB itself subscribes asynchronously and an unsubscribe does not
      // cancel a subscribe in flight; ShareDB's client sends a doc's subscribe
      // and unsubscribe one at a time. What the middleware owes is the order.
      const contact = await seedContact()
      const alice = connectClient(backend, { userId: 'alice' })
      const doc = alice.get('contacts', 'c1')
      await subscribe(doc)
      await new Promise(resolve => doc.unsubscribe(resolve))
      const received = recordMessages(alice)
      await submit(contact, [{ p: ['name'], od: 'Contact', oi: 'Renamed' }])
      await settle()
      assert.equal(received.filter(message => message.a === 'op').length, 0)
    })
  })
})

function runNode (args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', reject)
    child.on('close', code => resolve({ code, stdout, stderr }))
  })
}

// ShareDB answers a refused request with the request itself and its error;
// `d` may be a non-string here
function isReplyTo (message) {
  return reply => reply.a === message.a && reply.id === message.id && reply.c === message.c &&
    JSON.stringify(reply.d) === JSON.stringify(message.d) && !('op' in reply || 'create' in reply)
}
