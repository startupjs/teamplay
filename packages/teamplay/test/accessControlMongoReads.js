// A snapshot-fetch (nf / nt) whose doc id is an operator object must not reach
// MongoDB as a query (sharedb-mongo passes the id straight into the Mongo
// filter) and must not reach the read rule as a non-string id. The access
// middleware refuses the message before anything is read, so an id blocklist
// rule is not bypassed. Runs against a local MongoDB; skipped when there is
// none (or the driver is not installed), as the rest of the suite needs none.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'mocha'
import ShareDB from 'sharedb'
import { connectClient, create, sendRaw, silenceShareDbLogger, submit } from './_accessControl.js'

const URL = 'mongodb://localhost:27017/teamplay_access_mongo_' + process.pid
const SECRET = 'SECRET-API-KEY'

describe('access control: snapshot fetch doc id type on sharedb-mongo', () => {
  let backend, server, client, restore, ShareDbMongo, MongoClient

  before(async function () {
    this.timeout(8000)
    try {
      ;({ default: ShareDbMongo } = await import('sharedb-mongo'))
      ;({ MongoClient } = await import('mongodb'))
      client = new MongoClient(URL, { serverSelectionTimeoutMS: 1500 })
      await client.connect()
      await client.db().command({ ping: 1 })
    } catch (err) {
      await client?.close().catch(() => {})
      this.skip()
      return
    }
    restore = silenceShareDbLogger()
    const { ShareDBAccess } = await import('@teamplay/sharedb-access')
    backend = new ShareDB({ db: new ShareDbMongo({ mongo: cb => cb(null, client) }) })
    backend.use('connect', (context, next) => { context.agent.connectSession = context.req?.session; next() })
    // eslint-disable-next-line no-new
    new ShareDBAccess(backend, {})
    // an open read rule with a doc-id blocklist on top
    backend.allowRead('settings', () => true)
    backend.denyRead('settings', ({ docId }) => docId === 'master')
    server = backend.connect()
    await create(server.get('settings', 'master'), { apiKey: SECRET })
    await submit(server.get('settings', 'master'), [{ p: ['n'], oi: 1 }])
    await create(server.get('settings', 'public'), { theme: 'dark' })
  })

  after(async () => {
    if (!client) return
    restore?.()
    await client.db().dropDatabase().catch(() => {})
    await client.close().catch(() => {})
  })

  it('refuses a plain nf of the blocked doc (control)', async () => {
    const bob = connectClient(backend, { userId: 'bob' })
    const reply = await sendRaw(bob, { a: 'nf', c: 'settings', d: 'master', v: 1 }, m => m.a === 'nf')
    assert.equal(reply.error?.code, 'ERR_ACCESS_DENY_READ')
  })

  it('reads a doc the rule allows (control)', async () => {
    const bob = connectClient(backend, { userId: 'bob' })
    const reply = await sendRaw(bob, { a: 'nf', c: 'settings', d: 'public', v: 1 }, m => m.a === 'nf')
    assert.equal(reply.error, undefined)
    assert.equal(reply.data?.theme, 'dark')
  })

  it('refuses nf with an operator object as the doc id; the blocked doc is not returned', async () => {
    const bob = connectClient(backend, { userId: 'bob' })
    const reply = await sendRaw(bob, { a: 'nf', c: 'settings', d: { $eq: 'master' }, v: 1 }, m => m.a === 'nf')
    assert.equal(reply.error?.code, 'ERR_MESSAGE_BADLY_FORMED')
    assert.ok(!JSON.stringify(reply).includes(SECRET), JSON.stringify(reply))
  })

  it('refuses nt with an operator object as the doc id; the blocked doc is not returned', async () => {
    const bob = connectClient(backend, { userId: 'bob' })
    const reply = await sendRaw(bob, { a: 'nt', c: 'settings', d: { $eq: 'master' }, ts: Date.now() + 1000 }, m => m.a === 'nt')
    assert.equal(reply.error?.code, 'ERR_MESSAGE_BADLY_FORMED')
    assert.ok(!JSON.stringify(reply).includes(SECRET), JSON.stringify(reply))
  })
})
