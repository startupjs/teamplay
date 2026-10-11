// Read rules must cover every way a client can get a document's data, not
// only snapshots. ShareDB hands out a document's ops (and with its create op,
// the whole document) when a client fetches or subscribes from a version, in
// a query resubscribe's version list, and in the ops a submit is transformed
// against. Those go through the 'op' middleware, not 'readSnapshots'.
//
// Every client here is a remote one (its stream is not a server stream), with
// the session the 'connect' middleware attaches, as @teamplay/channel does.
import assert from 'node:assert/strict'
import util from 'node:util'
import { afterEach, beforeEach, describe, it } from 'mocha'
import ShareDB from 'sharedb'
import {
  PRIVATE_NOTE,
  PRIVATE_PHONE,
  assertNoPrivateData,
  connectClient,
  countSnapshotReads,
  create,
  createBackendWithRules,
  del,
  fetch,
  holdSnapshotReads,
  onceReady,
  recordMessages,
  sendRaw,
  settle,
  silenceShareDbLogger,
  submit,
  subscribe,
  waitUntil
} from './_accessControl.js'

describe('access control: reads through ops (versioned fetch and subscribe)', () => {
  let backend, server, snapshotReads, restoreLogger

  beforeEach(async () => {
    restoreLogger = silenceShareDbLogger()
    backend = createBackendWithRules()
    snapshotReads = countSnapshotReads(backend)
    server = backend.connect()
  })

  afterEach(() => {
    restoreLogger()
  })

  // alice's contact: created, then given a phone and a note (v3)
  async function seedContact (id = 'c1') {
    const doc = server.get('contacts', id)
    await create(doc, { ownerId: 'alice', name: 'Contact' })
    await submit(doc, [{ p: ['phone'], oi: PRIVATE_PHONE }])
    await submit(doc, [{ p: ['note'], oi: PRIVATE_NOTE }])
    assert.equal(doc.version, 3)
    return doc
  }

  describe('a client without read access', () => {
    it('cannot fetch the snapshot (control)', async () => {
      await seedContact()
      const bob = connectClient(backend, { userId: 'bob' })
      const doc = bob.get('contacts', 'c1')
      await assert.rejects(fetch(doc), { code: 'ERR_ACCESS_DENY_READ' })
      assert.equal(doc.data, undefined)
    })

    it('cannot fetch the document from version 0', async () => {
      await seedContact()
      const bob = connectClient(backend, { userId: 'bob' })
      const doc = bob.get('contacts', 'c1')
      doc.version = 0
      await assert.rejects(fetch(doc), { code: 'ERR_ACCESS_DENY_READ' })
      assert.equal(doc.data, undefined)
    })

    it('cannot subscribe from version 0', async () => {
      await seedContact()
      const bob = connectClient(backend, { userId: 'bob' })
      const received = recordMessages(bob)
      const reply = await sendRaw(bob, { a: 's', c: 'contacts', d: 'c1', v: 0 })
      assert.equal(reply.error?.code, 'ERR_ACCESS_DENY_READ')
      assertNoPrivateData(received)
    })

    it('cannot subscribe at the current version and then receive the next ops', async () => {
      const contact = await seedContact()
      const bob = connectClient(backend, { userId: 'bob' })
      const received = recordMessages(bob)
      const reply = await sendRaw(bob, { a: 's', c: 'contacts', d: 'c1', v: contact.version })
      assert.equal(reply.error?.code, 'ERR_ACCESS_DENY_READ')
      await submit(contact, [{ p: ['phone2'], oi: PRIVATE_PHONE }])
      await settle()
      assertNoPrivateData(received)
      assert.equal(received.filter(message => message.a === 'op' && message.d === 'c1').length, 0)
    })

    it('cannot fetch or subscribe in bulk with a versions map', async () => {
      await seedContact()
      const bob = connectClient(backend, { userId: 'bob' })
      const received = recordMessages(bob)
      for (const a of ['bf', 'bs']) {
        const reply = await sendRaw(bob, { a, c: 'contacts', b: { c1: 0 } })
        assert.equal(reply.error?.code, 'ERR_ACCESS_DENY_READ', a)
        // a null version in a versions map still asks for ops
        const nullReply = await sendRaw(bob, { a, c: 'contacts', b: { c1: null } })
        assert.equal(nullReply.error?.code, 'ERR_ACCESS_DENY_READ', a + ' null')
      }
      assertNoPrivateData(received)
    })

    it('gets no ops through a query resubscribe version list', async () => {
      // The query is not refused: the doc is resubscribed from its current
      // version, and the poll drops it (it does not match)
      await seedContact()
      const bob = connectClient(backend, { userId: 'bob' })
      const received = recordMessages(bob)
      const reply = await sendRaw(bob, {
        a: 'qs', id: 1, c: 'contacts', q: { ownerId: 'bob' }, r: [['c1', 0]]
      })
      assert.equal(reply.error, undefined)
      assertNoPrivateData(received)
      assert.equal(received.filter(message => message.a === 'op' && message.d === 'c1').length, 0)
    })

    it('receives no ops of an id in its query resubscribe that it may not read', async () => {
      // ShareDB starts the query from the client's ids and forwards their ops
      // until a poll changes the results; this doc matches, so it stays
      const contact = await seedContact()
      const bob = connectClient(backend, { userId: 'bob' })
      const received = recordMessages(bob)
      for (const r of [[['c1']], [['c1', 0]]]) {
        await sendRaw(bob, { a: 'qs', id: r[0].length, c: 'contacts', q: { name: 'Contact' }, r })
      }
      await submit(contact, [{ p: ['phone2'], oi: PRIVATE_PHONE }])
      await settle()
      assertNoPrivateData(received)
      assert.equal(received.filter(message => message.a === 'op' && message.d === 'c1').length, 0)
    })

    it('cannot fetch the history of a deleted doc', async () => {
      const contact = await seedContact()
      await del(contact)
      const bob = connectClient(backend, { userId: 'bob' })
      const received = recordMessages(bob)
      const reply = await sendRaw(bob, { a: 'f', c: 'contacts', d: 'c1', v: 0 })
      assert.equal(reply.error?.code, 'ERR_ACCESS_DENY_READ')
      assertNoPrivateData(received)
    })

    it('receives no create op of a doc it subscribed before it existed', async () => {
      // a rule an empty doc passes: bob may subscribe to a post that does
      // not exist yet, but not read it once it is created hidden
      const bob = connectClient(backend, { userId: 'bob' })
      const doc = bob.get('posts', 'p1')
      await subscribe(doc)
      const received = recordMessages(bob)
      await create(server.get('posts', 'p1'), { hidden: true, text: PRIVATE_NOTE })
      await settle()
      assertNoPrivateData(received)
      assert.equal(doc.data, undefined)
    })

    it('receives no ops of a doc that starts matching its query', async () => {
      // The query's poll adds the doc to the query's ids before the read rule
      // refuses its snapshot, so its later ops would be forwarded.
      const contact = await seedContact()
      const bob = connectClient(backend, { userId: 'bob' })
      const query = bob.createSubscribeQuery('contacts', { tag: 'shared' })
      await onceReady(query)
      const received = recordMessages(bob)
      await submit(contact, [{ p: ['tag'], oi: 'shared' }])
      await settle()
      await submit(contact, [{ p: ['phone2'], oi: PRIVATE_PHONE }])
      await settle()
      assertNoPrivateData(received)
      assert.equal(received.filter(message => message.a === 'op' && message.d === 'c1').length, 0)
    })

    it('is not sent the ops its submit was transformed against', async () => {
      // bob may write the note but not read the contact
      const contact = await seedContact()
      const bob = connectClient(backend, { userId: 'bob', mayAnnotate: true })
      const received = recordMessages(bob)
      const reply = await sendRaw(bob, {
        a: 'op', c: 'contacts', d: 'c1', v: 1, seq: 1, op: [{ p: ['annotation'], oi: 'x' }]
      }, message => message.a === 'op' && message.seq === 1 &&
        (message.error != null || !('op' in message || 'create' in message || 'del' in message)))
      assert.equal(reply.error?.code, 'ERR_ACCESS_DENY_READ')
      assertNoPrivateData(received)
      // the op itself is not lost
      await fetch(contact)
      assert.equal(contact.data.annotation, 'x')
    })

    it('is refused a query that names its collection with a non-string', async () => {
      await seedContact()
      const bob = connectClient(backend, { userId: 'bob' })
      const received = recordMessages(bob)
      const reply = await sendRaw(bob, { a: 'qf', id: 1, c: ['contacts'], q: {} })
      assert.ok(reply.error, 'the query must fail')
      assertNoPrivateData(received)
    })
  })

  describe('the history of a deleted doc', () => {
    // The post rule passes an empty doc (it reads only `hidden`), so the
    // empty state of a deleted post says nothing about its earlier states
    async function seedDeletedHiddenPost (id = 'p1') {
      const post = server.get('posts', id)
      await create(post, { hidden: true, text: PRIVATE_NOTE })
      await submit(post, [{ p: ['phone'], oi: PRIVATE_PHONE }])
      await del(post)
      assert.equal(post.version, 3)
      return post
    }

    it('is judged by its state before the deletion: fetch and subscribe from a version', async () => {
      await seedDeletedHiddenPost()
      const bob = connectClient(backend, { userId: 'bob' })
      const received = recordMessages(bob)
      for (const a of ['f', 's']) {
        const reply = await sendRaw(bob, { a, c: 'posts', d: 'p1', v: 0 })
        assert.equal(reply.error?.code, 'ERR_ACCESS_DENY_READ', a)
      }
      for (const a of ['bf', 'bs']) {
        const reply = await sendRaw(bob, { a, c: 'posts', b: { p1: 0 } })
        assert.equal(reply.error?.code, 'ERR_ACCESS_DENY_READ', a)
      }
      const reply = await sendRaw(bob, { a: 'qs', id: 1, c: 'posts', q: {}, r: [['p1', 0]] })
      assert.equal(reply.error, undefined)
      await settle()
      assertNoPrivateData(received)
      assert.equal(received.filter(message => message.a === 'op' && message.d === 'p1').length, 0)
    })

    it('is judged by its state before the deletion: a live op checked after the deletion', async () => {
      // bob subscribed before the post existed (an empty doc passes the rule);
      // the post is created hidden and deleted before bob's check reads it
      const bob = connectClient(backend, { userId: 'bob' })
      const doc = bob.get('posts', 'p2')
      doc.on('error', () => {})
      await subscribe(doc)
      const received = recordMessages(bob)
      const gate = holdSnapshotReads(backend, 'posts')
      const post = server.get('posts', 'p2')
      await create(post, { hidden: true, text: PRIVATE_NOTE })
      await del(post)
      gate.release()
      await settle()
      assertNoPrivateData(received)
      assert.equal(received.filter(message => message.a === 'op' && message.create).length, 0)
    })

    it('a deleted doc whose last state is readable still syncs after a reconnect', async () => {
      const post = server.get('posts', 'p3')
      await create(post, { text: 'visible' })
      const alice = connectClient(backend, { userId: 'alice' })
      const doc = alice.get('posts', 'p3')
      await subscribe(doc)
      alice.close()
      await submit(post, [{ p: ['text'], od: 'visible', oi: 'last words' }])
      await del(post)
      const errors = []
      doc.on('error', error => errors.push(error))
      connectClient(backend, { userId: 'alice' }, alice)
      await waitUntil(() => doc.type === null && doc.version === 3)
      assert.deepEqual(errors, [])
    })
  })

  describe('a refused live op', () => {
    it('reaches the server log without the document content; other clients get it whole', async () => {
      const contact = await seedContact()
      const alice = connectClient(backend, { userId: 'alice' })
      const aliceDoc = alice.get('contacts', 'c1')
      await subscribe(aliceDoc)
      const bob = connectClient(backend, { userId: 'bob' })
      // ShareDB forwards the ops of every id of a query resubscribe until it
      // polls; bob's are refused, and ShareDB logs each refused live op
      await sendRaw(bob, { a: 'qs', id: 1, c: 'contacts', q: { name: 'Contact' }, r: [['c1', 0]] })
      const logged = []
      ShareDB.logger.setMethods({ error: (...args) => logged.push(util.inspect(args, { depth: 10 })) })
      await submit(contact, [{ p: ['phone2'], oi: PRIVATE_PHONE }])
      await waitUntil(() => aliceDoc.data.phone2 === PRIVATE_PHONE)
      await settle()
      assert.ok(logged.some(entry => entry.includes('ERR_ACCESS_DENY_READ')), 'the refusal is logged')
      for (const entry of logged) {
        assert.ok(!entry.includes(PRIVATE_PHONE) && !entry.includes(PRIVATE_NOTE), entry)
      }
    })
  })

  describe('a document deleted and created again, hidden', () => {
    // A client subscribed to the readable document holds a read grant for its
    // live ops. The deletion ends the grant, so the create op that follows
    // (the document is a different, hidden one now) is checked afresh.
    it('does not reach a client subscribed to its earlier, readable version', async () => {
      const post = server.get('posts', 'p1')
      await create(post, { text: 'public' })
      const bob = connectClient(backend, { userId: 'bob' })
      const doc = bob.get('posts', 'p1')
      doc.on('error', () => {})
      await subscribe(doc)
      assert.equal(doc.data.text, 'public')
      const received = recordMessages(bob)
      await del(post)
      await create(post, { hidden: true, text: PRIVATE_NOTE })
      await settle()
      assertNoPrivateData(received)
      // a fresh fetch is refused too (the rule denies the new document)
      const other = connectClient(backend, { userId: 'bob' })
      await assert.rejects(fetch(other.get('posts', 'p1')), { code: 'ERR_ACCESS_DENY_READ' })
    })

    it('does not reach it through a query subscription either', async () => {
      const post = server.get('posts', 'p2')
      await create(post, { text: 'public', tag: 'shared' })
      const bob = connectClient(backend, { userId: 'bob' })
      const query = bob.createSubscribeQuery('posts', { tag: 'shared' })
      await onceReady(query)
      assert.equal(query.results.length, 1)
      const received = recordMessages(bob)
      await del(post)
      await create(post, { hidden: true, tag: 'shared', text: PRIVATE_NOTE })
      await settle()
      assertNoPrivateData(received)
    })

    it('still reaches a client that may read the new document', async () => {
      // alice owns her contact; it is deleted and created again, still hers
      const contact = await seedContact()
      const alice = connectClient(backend, { userId: 'alice' })
      const doc = alice.get('contacts', 'c1')
      await subscribe(doc)
      await del(contact)
      await create(server.get('contacts', 'c1'), { ownerId: 'alice', name: 'Reborn' })
      await waitUntil(() => doc.data && doc.data.name === 'Reborn')
      assert.equal(doc.data.name, 'Reborn')
    })
  })

  describe('a client with read access', () => {
    it('catches up on a doc and a query after a reconnect and keeps receiving ops', async () => {
      const contact = await seedContact()
      await create(server.get('contacts', 'c2'), { ownerId: 'alice', name: 'Second' })
      const alice = connectClient(backend, { userId: 'alice' })
      const doc = alice.get('contacts', 'c1')
      await subscribe(doc)
      const query = alice.createSubscribeQuery('contacts', { ownerId: 'alice' })
      await onceReady(query)
      assert.equal(query.results.length, 2)

      alice.close()
      await submit(contact, [{ p: ['phone'], od: PRIVATE_PHONE, oi: '+380500000000' }])
      await submit(server.get('contacts', 'c2'), [{ p: ['name'], od: 'Second', oi: 'Renamed' }])

      const received = recordMessages(alice)
      connectClient(backend, { userId: 'alice' }, alice)
      await waitUntil(() => doc.version === 4 && query.results.find(d => d.id === 'c2')?.version === 2)
      assert.equal(doc.data.phone, '+380500000000')
      assert.equal(alice.get('contacts', 'c2').data.name, 'Renamed')
      // the reconnect asked for ops from its versions (not snapshots)
      assert.ok(received.some(message => message.a === 'op' && message.d === 'c1' && message.v === 3))
      assert.equal(received.filter(message => message.error).length, 0)

      await submit(contact, [{ p: ['note'], od: PRIVATE_NOTE, oi: 'live' }])
      await waitUntil(() => doc.data.note === 'live')
    })

    it('catches up on a doc deleted while it was offline', async () => {
      const contact = await seedContact()
      const alice = connectClient(backend, { userId: 'alice' })
      const doc = alice.get('contacts', 'c1')
      await subscribe(doc)
      alice.close()
      await del(contact)
      const errors = []
      doc.on('error', error => errors.push(error))
      connectClient(backend, { userId: 'alice' }, alice)
      await waitUntil(() => doc.type === null && doc.version === 4)
      assert.deepEqual(errors, [])
    })

    it('catches up on a doc edited and then deleted while it was offline', async () => {
      const contact = await seedContact()
      const alice = connectClient(backend, { userId: 'alice' })
      const doc = alice.get('contacts', 'c1')
      await subscribe(doc)
      alice.close()
      await submit(contact, [{ p: ['note'], od: PRIVATE_NOTE, oi: 'last words' }])
      await del(contact)
      const errors = []
      doc.on('error', error => errors.push(error))
      connectClient(backend, { userId: 'alice' }, alice)
      await waitUntil(() => doc.type === null && doc.version === 5)
      assert.deepEqual(errors, [])
    })

    it('resubscribes in bulk: only the docs it may no longer read are refused', async () => {
      const contact = await seedContact()
      await create(server.get('contacts', 'c2'), { ownerId: 'alice', name: 'Second' })
      const alice = connectClient(backend, { userId: 'alice' })
      const doc1 = alice.get('contacts', 'c1')
      const doc2 = alice.get('contacts', 'c2')
      await Promise.all([subscribe(doc1), subscribe(doc2)])
      alice.close()
      // c1 is handed over to carol, c2 changes
      await submit(contact, [{ p: ['ownerId'], od: 'alice', oi: 'carol' }])
      await submit(contact, [{ p: ['phone'], od: PRIVATE_PHONE, oi: '+380501111111' }])
      await submit(server.get('contacts', 'c2'), [{ p: ['name'], od: 'Second', oi: 'Renamed' }])
      const errors = []
      doc1.on('error', error => errors.push(error))
      doc2.on('error', error => errors.push(error))
      const received = recordMessages(alice)
      connectClient(backend, { userId: 'alice' }, alice)
      await waitUntil(() => doc2.version === 2 && errors.length === 1)
      assert.equal(doc2.data.name, 'Renamed')
      assert.equal(errors[0].code, 'ERR_ACCESS_DENY_READ')
      assert.equal(doc1.version, 3)
      assert.ok(!JSON.stringify(received).includes('+380501111111'))
    })

    it('keeps a query working after a reconnect when a result became unreadable', async () => {
      const contact = await seedContact()
      await create(server.get('contacts', 'c2'), { ownerId: 'alice', name: 'Second' })
      const alice = connectClient(backend, { userId: 'alice' })
      const query = alice.createSubscribeQuery('contacts', { ownerId: 'alice' })
      await onceReady(query)
      assert.equal(query.results.length, 2)
      alice.close()
      await submit(contact, [{ p: ['ownerId'], od: 'alice', oi: 'carol' }])
      await submit(contact, [{ p: ['phone'], od: PRIVATE_PHONE, oi: '+380501111111' }])
      const errors = []
      query.on('error', error => errors.push(error))
      const received = recordMessages(alice)
      connectClient(backend, { userId: 'alice' }, alice)
      await waitUntil(() => query.results.length === 1)
      assert.equal(query.results[0].id, 'c2')
      assert.deepEqual(errors, [])
      assert.ok(!JSON.stringify(received).includes('+380501111111'))
    })

    it('fetches again from its version', async () => {
      const contact = await seedContact()
      const alice = connectClient(backend, { userId: 'alice' })
      const doc = alice.get('contacts', 'c1')
      await fetch(doc)
      await submit(contact, [{ p: ['note'], od: PRIVATE_NOTE, oi: 'changed' }])
      await fetch(doc)
      assert.equal(doc.version, 4)
      assert.equal(doc.data.note, 'changed')
    })

    it('needs no snapshot read per live op', async () => {
      const contact = await seedContact()
      const alice = connectClient(backend, { userId: 'alice' })
      const doc = alice.get('contacts', 'c1')
      await subscribe(doc)
      const query = alice.createSubscribeQuery('contacts', { ownerId: 'alice' })
      await onceReady(query)
      snapshotReads.reset()
      for (let i = 0; i < 20; i++) await submit(contact, [{ p: ['counter'], oi: i }])
      await waitUntil(() => doc.data.counter === 19)
      assert.equal(snapshotReads.count, 0)
    })

    it('reads all snapshots of a reconnect in one bulk read', async () => {
      for (let i = 0; i < 5; i++) await create(server.get('contacts', 'd' + i), { ownerId: 'alice' })
      const alice = connectClient(backend, { userId: 'alice' })
      const docs = []
      for (let i = 0; i < 5; i++) docs.push(alice.get('contacts', 'd' + i))
      await Promise.all(docs.map(subscribe))
      alice.close()
      snapshotReads.reset()
      connectClient(backend, { userId: 'alice' }, alice)
      await new Promise(resolve => alice.once('connected', resolve))
      await settle()
      assert.equal(snapshotReads.count, 1)
      assert.equal(snapshotReads.ids, 5)
    })

    it('leaves collections without read rules alone', async () => {
      const notes = server.get('notes', 'n1')
      await create(notes, { text: 'open' })
      await submit(notes, [{ p: ['text'], od: 'open', oi: 'still open' }])
      const anyone = connectClient(backend, { userId: 'bob' })
      const doc = anyone.get('notes', 'n1')
      doc.version = 0
      snapshotReads.reset()
      await fetch(doc)
      assert.equal(doc.data.text, 'still open')
      assert.equal(snapshotReads.count, 0)
    })
  })
})
