// Runs the standard ShareDB DB conformance suite against the pongo-sqlite
// adapter (the same suite @startupjs/sharedb-mingo-memory runs), plus a
// differential test that executes an identical query battery against both the
// mingo adapter and the pongo adapter and requires identical results.
import { createRequire } from 'module'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import ShareDbPongoSqlite from '../db/sharedb-pongo-sqlite.js'

const require = createRequire(import.meta.url)
const { expect } = require('chai')
const ShareDBMingo = require('@startupjs/sharedb-mingo-memory')
const Backend = require('sharedb')

const tmp = mkdtempSync(join(tmpdir(), 'sharedb-pongo-test-'))
let fileCounter = 0
const liveDbs = []

function createPongoDb () {
  const db = new ShareDbPongoSqlite({ dbPath: join(tmp, `db-${fileCounter++}.db`) })
  liveDbs.push(db)
  return db
}

after(async () => {
  for (const db of liveDbs) {
    if (!db.closed) await new Promise(resolve => db.close(resolve))
  }
  rmSync(tmp, { recursive: true, force: true })
})

// Given a key/value comparison query, return a query object with that filter
// and a specified sort order ([['foo', 1], ['bar', -1]]). Same mapper the
// mingo adapter passes to the suite.
function getQuery ({ query, sort }) {
  if (sort && sort.length > 0) {
    const mongoSort = {}
    for (const [field, direction] of sort) mongoSort[field] = direction
    return { ...query, $sort: mongoSort }
  }
  return query
}

require('sharedb/test/db')({
  create (callback) {
    callback(null, createPongoDb())
  },
  getQuery
})

describe('pongo-sqlite specifics', function () {
  this.timeout(10000)

  it('rejects an $aggregate-free unsupported top-level operator via mingo parity', done => {
    const db = createPongoDb()
    db.query('testcollection', { $mapReduce: [] }, null, null, err => {
      expect(err).an('error')
      done()
    })
  })

  it('persists across adapter restarts on the same file', done => {
    const dbPath = join(tmp, 'restart.db')
    const db1 = new ShareDbPongoSqlite({ dbPath })
    liveDbs.push(db1)
    const backend1 = new Backend({ db: db1 })
    const connection1 = backend1.connect()
    const doc = connection1.get('col', 'doc1')
    doc.create({ title: 'persisted' }, err => {
      if (err) return done(err)
      db1.close(() => {
        const db2 = new ShareDbPongoSqlite({ dbPath })
        liveDbs.push(db2)
        db2.getSnapshot('col', 'doc1', null, null, (err, snapshot) => {
          if (err) return done(err)
          expect(snapshot.v).to.equal(1)
          expect(snapshot.data).to.eql({ title: 'persisted' })
          done()
        })
      })
    })
  })

  it('keeps version numbering across delete + recreate (tombstones)', done => {
    const db = createPongoDb()
    const backend = new Backend({ db })
    const connection = backend.connect()
    const doc = connection.get('col', 'doc1')
    doc.create({ n: 1 }, err => {
      if (err) return done(err)
      doc.del(err => {
        if (err) return done(err)
        db.getSnapshot('col', 'doc1', null, null, (err, snapshot) => {
          if (err) return done(err)
          expect(snapshot.v).to.equal(2)
          expect(snapshot.type).to.equal(null)
          doc.create({ n: 2 }, err => {
            if (err) return done(err)
            db.getSnapshot('col', 'doc1', null, null, (err, snapshot) => {
              if (err) return done(err)
              expect(snapshot.v).to.equal(3)
              expect(snapshot.data).to.eql({ n: 2 })
              done()
            })
          })
        })
      })
    })
  })

  it('refuses a commit with a stale version (concurrency arbiter)', done => {
    const db = createPongoDb()
    const backend = new Backend({ db })
    const connection = backend.connect()
    const doc = connection.get('col', 'doc1')
    doc.create({ n: 1 }, err => {
      if (err) return done(err)
      const op = { v: 1, op: [{ p: ['n'], na: 1 }], m: { ts: Date.now() } }
      const snapshot = { id: 'doc1', v: 2, type: doc.type.uri, data: { n: 2 }, m: null }
      db.commit('col', 'doc1', op, snapshot, null, (err, succeeded) => {
        if (err) return done(err)
        expect(succeeded).to.equal(true)
        // same version again - must lose the arbiter
        db.commit('col', 'doc1', op, snapshot, null, (err, succeeded) => {
          if (err) return done(err)
          expect(succeeded).to.equal(false)
          done()
        })
      })
    })
  })
})

describe('differential: pongo-sqlite vs mingo (identical query battery)', function () {
  this.timeout(30000)

  const DOCS = [
    { id: 'a', data: { kind: 'fruit', name: 'apple', price: 3, tags: ['red', 'sweet'], meta: { origin: 'PL' }, ok: true } },
    { id: 'b', data: { kind: 'fruit', name: 'banana', price: 1, tags: ['yellow'] } },
    { id: 'c', data: { kind: 'veg', name: 'carrot', price: 2, archived: true } },
    { id: 'd', data: { kind: 'fruit', name: 'date', price: 7, rating: null } },
    { id: 'e', data: { kind: 'veg', name: 'endive', price: 7 } },
    { id: 'deleted-doc', data: { kind: 'ghost', name: 'gone', price: 100 } }
  ]

  // battery spanning the SQL fast path AND every fallback trigger
  const QUERIES = [
    {},
    { kind: 'fruit' },
    { name: 'apple' },
    { ok: true },
    { price: { $gt: 2 } },
    { price: { $gte: 2, $lt: 7 } },
    { kind: { $in: ['veg', 'ghost'] } },
    { kind: { $nin: ['veg'] } }, // fallback: $nin matches missing fields in mongo
    { kind: { $ne: 'veg' } }, // fallback: $ne matches missing fields in mongo
    { archived: { $ne: true } }, // fallback: must include docs without the field
    { tags: 'red' }, // array-contains
    { tags: ['red', 'sweet'] }, // fallback: exact array equality
    { 'meta.origin': 'PL' }, // nested path
    { meta: { origin: 'PL' } }, // fallback: exact subdocument equality
    { rating: null }, // fallback: null matches missing fields in mongo
    { rating: { $exists: true } }, // fallback
    { rating: { $exists: false } }, // fallback
    { name: { $regex: '^a' } }, // fallback
    { $or: [{ name: 'apple' }, { price: 7 }] }, // fallback
    { $and: [{ kind: 'fruit' }, { price: { $lt: 5 } }] }, // fallback
    { _id: 'a' },
    { _id: { $in: ['a', 'c', 'deleted-doc'] } },
    { price: 100 }, // only the deleted doc had it - must return nothing
    { kind: 'fruit', $sort: { price: -1 } },
    { $sort: { price: 1, name: -1 } },
    { $sort: { price: 1 }, $skip: 1, $limit: 2 },
    { $sort: { price: 1 }, $skip: 2 },
    { $limit: 3, $sort: { name: 1 } },
    { kind: 'fruit', $count: true },
    { $count: true },
    { $aggregate: [{ $group: { _id: '$kind', total: { $sum: '$price' } } }, { $sort: { _id: 1 } }] }
  ]

  let mingoDb, pongoDb

  before(async () => {
    mingoDb = new ShareDBMingo()
    pongoDb = createPongoDb()
    for (const db of [mingoDb, pongoDb]) {
      const backend = new Backend({ db })
      const connection = backend.connect()
      for (const { id, data } of DOCS) {
        const doc = connection.get('battery', id)
        await new Promise((resolve, reject) => doc.create(data, err => err ? reject(err) : resolve()))
      }
      const doc = connection.get('battery', 'deleted-doc')
      await new Promise((resolve, reject) => doc.del(err => err ? reject(err) : resolve()))
    }
  })

  function runQuery (db, query) {
    return new Promise((resolve, reject) => {
      db.query('battery', query, null, null, (err, snapshots, extra) => {
        if (err) return reject(err)
        resolve({ snapshots, extra })
      })
    })
  }

  for (const query of QUERIES) {
    const label = JSON.stringify(query)
    it(label, async () => {
      const expected = await runQuery(mingoDb, query)
      const actual = await runQuery(pongoDb, query)
      const sorted = '$sort' in query
      const expectedIds = expected.snapshots.map(s => s.id)
      const actualIds = actual.snapshots.map(s => s.id)
      if (sorted) {
        expect(actualIds).to.eql(expectedIds)
      } else {
        expect(actualIds.slice().sort()).to.eql(expectedIds.slice().sort())
      }
      // same snapshot contents (data, version, metadata stripped identically)
      const byId = Object.fromEntries(expected.snapshots.map(s => [s.id, s]))
      for (const snapshot of actual.snapshots) {
        expect(snapshot.data).to.eql(byId[snapshot.id].data)
        expect(snapshot.v).to.equal(byId[snapshot.id].v)
        expect(snapshot.m).to.eql(byId[snapshot.id].m)
      }
      expect(actual.extra).to.eql(expected.extra)
    })
  }

  it('queryPollDoc parity', async () => {
    const cases = [
      ['a', { kind: 'fruit' }],
      ['a', { kind: 'veg' }],
      ['deleted-doc', {}],
      ['missing', { kind: 'fruit' }]
    ]
    for (const [id, query] of cases) {
      const run = db => new Promise((resolve, reject) => {
        db.queryPollDoc('battery', id, query, null, (err, matches) => err ? reject(err) : resolve(matches))
      })
      expect(await run(pongoDb)).to.equal(await run(mingoDb), JSON.stringify([id, query]))
    }
  })
})
