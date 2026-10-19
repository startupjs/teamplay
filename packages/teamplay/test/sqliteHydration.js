import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, it } from 'mocha'
import ShareDbMingoMemory from '@startupjs/sharedb-mingo-memory'
import { cloneSqliteDb, getExistingSqliteDb, loadSqliteDbToMingo } from '../../backend/db/utils.js'

describe('SQLite hydration', () => {
  it('preserves snapshots, operation metadata, version order and pruned history', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'teamplay-sqlite-'))
    let sqlite
    try {
      const path = join(directory, 'snapshot.db')
      await writeFile(path, '')
      sqlite = getExistingSqliteDb(path)
      const run = promisify(sqlite.run.bind(sqlite))
      const all = promisify(sqlite.all.bind(sqlite))
      await run('CREATE TABLE documents (collection TEXT, id TEXT, data TEXT)')
      await run('CREATE TABLE ops (collection TEXT, documentId TEXT, op TEXT)')

      const snapshots = [
        ['notes', 'shared', { v: 5, type: 'json0', data: { title: 'Ready' }, m: { ctime: 10, mtime: 20 } }],
        ['archive', 'shared', { v: 1, type: null, data: null, m: { ctime: 10 } }],
        ['notes', 'empty', { v: 0, type: null, data: null }]
      ]
      const ops = [
        { v: 2, src: 'writer', seq: 3, op: [{ p: ['title'], oi: 'Draft' }], m: { ts: 12 } },
        { v: 3, src: 'writer', seq: 4, op: [{ p: ['title'], od: 'Draft', oi: 'Ready' }], m: { ts: 13 } },
        { v: 4, src: 'writer', seq: 5, op: [], m: { ts: 14 } }
      ]
      for (const [collection, id, snapshot] of snapshots) {
        await run('INSERT INTO documents VALUES (?, ?, ?)', [collection, id, JSON.stringify(snapshot)])
      }
      const deleted = { v: 0, del: true, m: { ts: 11 } }
      for (const [collection, id, op] of [
        ['notes', 'shared', ops[2]],
        ['archive', 'shared', deleted],
        ['notes', 'shared', ops[0]],
        ['notes', 'orphan', { v: 0, create: { type: 'json0', data: {} } }],
        ['notes', 'shared', ops[1]]
      ]) {
        await run('INSERT INTO ops VALUES (?, ?, ?)', [collection, id, JSON.stringify(op)])
      }
      const before = [await all('SELECT * FROM documents'), await all('SELECT * FROM ops')]
      const mingo = new ShareDbMingoMemory()
      await loadSqliteDbToMingo(sqlite, mingo)

      for (const [collection, id, snapshot] of snapshots) {
        assert.deepEqual(mingo.docs[collection][id], snapshot)
      }
      assert.deepEqual(mingo.ops.notes.shared, [undefined, undefined, ...ops])
      assert.deepEqual(mingo.ops.archive.shared, [deleted])
      assert.deepEqual(mingo.ops.notes.empty, [])
      assert.equal(mingo.docs.notes.orphan, undefined)
      assert.equal(mingo.ops.notes.orphan, undefined)
      assert.deepEqual(await promisify(mingo.getOps.bind(mingo))('notes', 'shared', 2, 5, { metadata: true }), ops)
      assert.deepEqual([await all('SELECT * FROM documents'), await all('SELECT * FROM ops')], before)
    } finally {
      try {
        if (sqlite) await promisify(sqlite.close.bind(sqlite))()
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    }
  })

  it('loads many documents and a long history without repeatedly copying accumulated data', async function () {
    this.timeout(10000)
    const documents = Array.from({ length: 10000 }, (_, i) => ({
      collection: 'notes', id: String(i), data: JSON.stringify({ v: 1, data: { n: i } })
    }))
    const ops = documents.map(({ collection, id }) => ({
      collection, documentId: id, op: JSON.stringify({ v: 0, create: { type: 'json0', data: { n: Number(id) } } })
    }))
    documents.push({ collection: 'notes', id: 'history', data: JSON.stringify({ v: 20000, data: {} }) })
    for (let v = 19999; v >= 0; v--) {
      ops.push({ collection: 'notes', documentId: 'history', op: JSON.stringify({ v, op: [], m: { ts: v } }) })
    }
    // Keep this scale check independent of SQLite insertion and filesystem speed.
    const sqlite = {
      all (sql, params, callback) {
        queueMicrotask(() => callback(null, sql.includes('FROM documents') ? documents : ops))
      }
    }
    const mingo = new ShareDbMingoMemory()
    await loadSqliteDbToMingo(sqlite, mingo)
    assert.equal(Object.keys(mingo.docs.notes).length, documents.length)
    for (let i = 0; i < 10000; i++) {
      assert.deepEqual(mingo.docs.notes[i], { v: 1, data: { n: i } })
      assert.deepEqual(mingo.ops.notes[i], [{ v: 0, create: { type: 'json0', data: { n: i } } }])
    }
    assert.equal(mingo.ops.notes.history.length, 20000)
    for (let v = 0; v < 20000; v++) {
      assert.deepEqual(mingo.ops.notes.history[v], { v, op: [], m: { ts: v } })
    }
  })

  for (const failedTable of ['documents', 'ops']) {
    it(`propagates the ${failedTable} query error without hydrating partial data`, async () => {
      const error = new Error('SQLite read failed')
      const sqlite = {
        all (sql, params, callback) {
          queueMicrotask(() => callback(sql.endsWith(failedTable) ? error : null, []))
        }
      }
      const mingo = new ShareDbMingoMemory()
      await assert.rejects(loadSqliteDbToMingo(sqlite, mingo), err => err === error)
      assert.deepEqual(Object.keys(mingo.docs), [])
      assert.deepEqual(Object.keys(mingo.ops), [])
    })
  }
})

describe('SQLite snapshot clone', () => {
  // the tables getOrCreateSqliteDb() in mingo-sqlite.js creates
  const SCHEMA = [
    'CREATE TABLE documents (collection TEXT, id TEXT, data TEXT, PRIMARY KEY (collection, id))',
    'CREATE TABLE ops (id UUID PRIMARY KEY, collection TEXT, documentId TEXT, op TEXT)',
    'CREATE TABLE files (id TEXT PRIMARY KEY, data BLOB, createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP)'
  ]
  let directory
  const databases = []

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'teamplay-sqlite-clone-'))
  })

  afterEach(async () => {
    try {
      for (const sqlite of databases.splice(0)) await promisify(sqlite.close.bind(sqlite))()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  async function open (name, rowsByTable = {}) {
    const path = join(directory, name)
    await writeFile(path, '')
    const sqlite = getExistingSqliteDb(path)
    databases.push(sqlite)
    const run = promisify(sqlite.run.bind(sqlite))
    for (const sql of SCHEMA) await run(sql)
    for (const [table, rows] of Object.entries(rowsByTable)) {
      for (const row of rows) {
        const columns = Object.keys(row)
        await run(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`, Object.values(row))
      }
    }
    return sqlite
  }

  async function dump (sqlite) {
    const all = promisify(sqlite.all.bind(sqlite))
    return {
      documents: await all('SELECT collection, id, data FROM documents ORDER BY collection, id'),
      ops: await all('SELECT id, collection, documentId, op FROM ops ORDER BY id'),
      files: await all('SELECT id, data FROM files ORDER BY id')
    }
  }

  it('copies documents, operations and files', async () => {
    const rows = {
      documents: [
        { collection: 'notes', id: 'a', data: JSON.stringify({ v: 2, type: 'json0', data: { title: 'A' } }) },
        { collection: 'users', id: 'a', data: JSON.stringify({ v: 1, type: 'json0', data: { name: 'Ann' } }) }
      ],
      ops: [
        { id: 'op1', collection: 'notes', documentId: 'a', op: JSON.stringify({ v: 0, create: { type: 'json0', data: {} } }) },
        { id: 'op2', collection: 'notes', documentId: 'a', op: JSON.stringify({ v: 1, op: [{ p: ['title'], oi: 'A' }] }) },
        { id: 'op3', collection: 'users', documentId: 'a', op: JSON.stringify({ v: 0, create: { type: 'json0', data: { name: 'Ann' } } }) }
      ],
      files: Array.from({ length: 3 }, (_, i) => ({ id: 'file' + i, data: Buffer.from([i, 0, 255]) }))
    }
    const source = await open('source.db', rows)
    const target = await open('target.db')
    await cloneSqliteDb(source, target)
    assert.deepEqual(await dump(target), rows)
    assert.deepEqual(await dump(source), rows)
  })

  it('leaves the target as it was when a row fails to copy', async () => {
    const source = await open('source.db', {
      documents: [{ collection: 'notes', id: 'new', data: '{"v":1}' }],
      ops: [{ id: 'op1', collection: 'notes', documentId: 'new', op: '{"v":0}' }],
      files: [{ id: 'other', data: Buffer.from('a') }, { id: 'taken', data: Buffer.from('source') }]
    })
    const target = await open('target.db', {
      documents: [{ collection: 'notes', id: 'kept', data: '{"v":1}' }],
      files: [{ id: 'taken', data: Buffer.from('target') }]
    })
    const before = await dump(target)
    await assert.rejects(cloneSqliteDb(source, target), /^Error: Error cloning SQLite DB:\n.*UNIQUE constraint failed: files\.id/)
    // read through the target's own connection, which would see the rows of a
    // transaction left open
    assert.deepEqual(await dump(target), before)
  })
})
