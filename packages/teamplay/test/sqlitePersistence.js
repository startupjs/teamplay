import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, it } from 'mocha'
import ShareDB from 'sharedb'
import ShareDbMingoMemory from '@startupjs/sharedb-mingo-memory'
import {
  cloneSqliteDb,
  getExistingSqliteDb,
  loadSqliteDbToMingo,
  patchMingoForSQLitePersistence
} from '../../backend/db/utils.js'

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
      await run('CREATE TABLE ops (id TEXT, collection TEXT, documentId TEXT, op TEXT)')

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
        await run('INSERT INTO ops (collection, documentId, op) VALUES (?, ?, ?)', [collection, id, JSON.stringify(op)])
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
          queueMicrotask(() => callback(sql.includes(`FROM ${failedTable}`) ? error : null, []))
        }
      }
      const mingo = new ShareDbMingoMemory()
      await assert.rejects(loadSqliteDbToMingo(sqlite, mingo), err => err === error)
      assert.deepEqual(Object.keys(mingo.docs), [])
      assert.deepEqual(Object.keys(mingo.ops), [])
    })
  }

  it('builds each history up to its document version, without the ops left past it', async () => {
    const op = v => ({ v, op: [{ p: ['n'], na: 1 }] })
    const documents = [
      { collection: 'notes', id: 'leftover', data: JSON.stringify({ v: 2, type: 'json0', data: { n: 1 } }) },
      { collection: 'notes', id: 'unsaved', data: JSON.stringify({ v: 4, type: 'json0', data: { n: 3 } }) }
    ]
    const ops = [
      // a commit whose document write failed left its op at the document's version
      ...[0, 1, 2].map(v => ({
        id: JSON.stringify(['notes', 'leftover', v]), collection: 'notes', documentId: 'leftover', op: JSON.stringify(op(v))
      })),
      // the document was saved before its op, which never was
      ...[2, 0, 1].map(v => ({ collection: 'notes', documentId: 'unsaved', op: JSON.stringify(op(v)) }))
    ]
    const sqlite = {
      all (sql, params, callback) {
        queueMicrotask(() => callback(null, sql.includes('FROM documents') ? documents : ops))
      }
    }
    const mingo = new ShareDbMingoMemory()
    const warnings = await captureConsole('warn', () => loadSqliteDbToMingo(sqlite, mingo))
    assert.deepEqual(mingo.ops.notes.leftover, [op(0), op(1)])
    assert.deepEqual(mingo.ops.notes.unsaved, [op(0), op(1), op(2), undefined])
    assert.deepEqual(warnings, [], 'an op left at the document version is expected')
  })

  it('keeps the op saved under the id of its version, leaves out a version older code saved twice, and reports what it skips', async () => {
    const op = (v, n) => ({ v, op: [{ p: ['n'], na: n }] })
    const documents = [{ collection: 'notes', id: 'a', data: JSON.stringify({ v: 6, type: 'json0', data: { n: 9 } }) }]
    const own = v => JSON.stringify(['notes', 'a', v])
    // in the order they were saved; older commit code saved the commits that
    // lost a race too, under random ids
    const ops = [
      [own(0), op(0, 1)],
      // which of the two memory took is unknown: a gap
      ['legacy-1', op(1, 2)],
      ['legacy-2', op(1, 3)],
      // replaced by the op saved under the id of its version, after an upgrade
      ['legacy-3', op(2, 4)],
      [own(2), op(2, 3)],
      // a single older op: loaded
      ['legacy-4', op(3, 2)],
      // two older ops, then the op of that version committed after an upgrade
      ['legacy-5', op(4, 1)],
      ['legacy-6', op(4, 2)],
      [own(4), op(4, 3)],
      // an older op saved after the op of its version
      [own(5), op(5, 1)],
      ['legacy-7', op(5, 2)],
      // left by a failed document write: expected, not reported
      [own(6), op(6, 6)],
      // at the document's version and past it, saved by older code
      ['legacy-8', op(6, 7)],
      ['legacy-9', op(8, 8)],
      // malformed versions
      ['legacy-10', { v: 'x', op: [] }],
      ['legacy-11', { v: 1.5, op: [] }]
    ].map(([id, op]) => ({ id, collection: 'notes', documentId: 'a', op: JSON.stringify(op) }))
    const sqlite = {
      all (sql, params, callback) {
        queueMicrotask(() => callback(null, sql.includes('FROM documents') ? documents : ops))
      }
    }
    const mingo = new ShareDbMingoMemory()
    const warnings = await captureConsole('warn', () => loadSqliteDbToMingo(sqlite, mingo))
    assert.deepEqual(mingo.ops.notes.a, [op(0, 1), undefined, op(2, 3), op(3, 2), op(4, 3), op(5, 1)])
    assert.equal(warnings.length, 1)
    assert.match(warnings[0][0], /Did not load 10 ops from SQLite/)
  })

  it('keeps the ops of each document apart, whatever its collection and id hold', async () => {
    const documents = [['a', 'b.c'], ['a.b', 'c']].map(([collection, id]) => ({
      collection, id, data: JSON.stringify({ v: 1, type: 'json0', data: {} })
    }))
    const ops = documents.map(({ collection, id }) => ({
      id: JSON.stringify([collection, id, 0]),
      collection,
      documentId: id,
      op: JSON.stringify({ v: 0, create: { type: 'json0', data: { collection } } })
    }))
    const sqlite = {
      all (sql, params, callback) {
        queueMicrotask(() => callback(null, sql.includes('FROM documents') ? documents : ops))
      }
    }
    const mingo = new ShareDbMingoMemory()
    const warnings = await captureConsole('warn', () => loadSqliteDbToMingo(sqlite, mingo))
    assert.deepEqual(mingo.ops.a['b.c'].map(op => op.create.data.collection), ['a'])
    assert.deepEqual(mingo.ops['a.b'].c.map(op => op.create.data.collection), ['a.b'])
    assert.deepEqual(warnings, [])
  })
})

describe('SQLite commits', () => {
  const { open, dump } = useSqliteFiles()
  const backends = []

  afterEach(async () => {
    for (const backend of backends.splice(0)) await promisify(backend.close.bind(backend))()
  })

  function serve (sqlite, mingo = new ShareDbMingoMemory()) {
    patchMingoForSQLitePersistence(sqlite, mingo)
    // a commit that never succeeds fails the test instead of retrying forever
    const backend = new ShareDB({ db: mingo, maxSubmitRetries: 20 })
    backends.push(backend)
    return { mingo, backend }
  }

  async function reload (sqlite) {
    const mingo = new ShareDbMingoMemory()
    await loadSqliteDbToMingo(sqlite, mingo)
    return mingo
  }

  // the documents and op histories of an in-memory DB, as plain data
  function contents (mingo) {
    return JSON.parse(JSON.stringify({ docs: mingo.docs, ops: mingo.ops }))
  }

  function call (target, method, ...args) {
    return new Promise((resolve, reject) => target[method](...args, err => err ? reject(err) : resolve()))
  }

  // the server's error logs made by fn; ShareDB's own log of an error it
  // returns to a client (its stack) is left out
  async function captureServerErrors (fn) {
    const { info } = ShareDB.logger
    ShareDB.logger.setMethods({ info () {} })
    try {
      return await captureConsole('error', fn)
    } finally {
      ShareDB.logger.setMethods({ info })
    }
  }

  it('saves each op and the document, which load back as memory has them', async () => {
    const sqlite = await open('app.db')
    const { mingo, backend } = serve(sqlite)
    const doc = backend.connect().get('notes', 'a')
    await call(doc, 'create', { title: 'A', tags: [] })
    await call(doc, 'submitOp', [{ p: ['title'], od: 'A', oi: 'B' }])
    await call(doc, 'submitOp', [{ p: ['tags', 0], li: 'x' }])

    const rows = await dump(sqlite)
    assert.deepEqual(rows.ops.map(row => row.id), [0, 1, 2].map(v => JSON.stringify(['notes', 'a', v])))
    assert.deepEqual(JSON.parse(rows.documents[0].data).data, { title: 'B', tags: ['x'] })
    assert.deepEqual(contents(await reload(sqlite)), contents(mingo))
  })

  it('returns a failed write as the commit error, and memory and the next commit go on as before', async () => {
    const sqlite = await open('app.db')
    let failDocumentWrite = false
    const flaky = {
      run (sql, params, callback) {
        if (failDocumentWrite && sql.includes('INTO documents')) {
          failDocumentWrite = false
          return queueMicrotask(() => callback(new Error('SQLITE_FULL: database or disk is full')))
        }
        return sqlite.run(sql, params, callback)
      }
    }
    const { mingo, backend } = serve(flaky)
    const doc = backend.connect().get('notes', 'a')
    await call(doc, 'create', { n: 1 })

    failDocumentWrite = true
    const logged = await captureServerErrors(() =>
      assert.rejects(call(doc, 'submitOp', [{ p: ['n'], na: 10 }]), /Error saving to SQLite: SQLITE_FULL/)
    )
    assert.ok(logged.some(args => /Error saving notes\.a v2 to SQLite/.test(args[0])), 'logged on the server')
    assert.equal(mingo._getVersionSync('notes', 'a'), 1, 'memory did not take the op')
    assert.equal((await dump(sqlite)).ops.length, 2, 'the op is left at the document version')
    assert.deepEqual(contents(await reload(sqlite)), contents(mingo), 'loading leaves it out')

    await call(doc, 'fetch')
    assert.deepEqual([doc.version, doc.data], [1, { n: 1 }])
    await call(doc, 'submitOp', [{ p: ['n'], na: 2 }])
    const rows = await dump(sqlite)
    assert.equal(rows.ops.length, 2, 'the next commit of that version replaced the op left there')
    assert.deepEqual(JSON.parse(rows.ops[1].op).op, [{ p: ['n'], na: 2 }])
    assert.deepEqual(contents(await reload(sqlite)), contents(mingo))
    assert.deepEqual(mingo.docs.notes.a.data, { n: 3 })
  })

  it('answers a commit that throws, and the next commit of the doc runs', async () => {
    const sqlite = await open('app.db')
    const mingo = new ShareDbMingoMemory()
    const memoryCommit = mingo.commit
    let throwOnCommit = false
    mingo.commit = function (...args) {
      if (!throwOnCommit) return memoryCommit.apply(this, args)
      throwOnCommit = false
      throw Error('memory commit failed')
    }
    const { backend } = serve(sqlite, mingo)
    const doc = backend.connect().get('notes', 'a')
    await call(doc, 'create', { n: 1 })

    throwOnCommit = true
    const logged = await captureServerErrors(() =>
      assert.rejects(call(doc, 'submitOp', [{ p: ['n'], na: 10 }]), /memory commit failed/)
    )
    assert.ok(logged.some(args => /Error committing notes\.a v2/.test(args[0])), 'logged on the server')
    await call(doc, 'fetch')
    await call(doc, 'submitOp', [{ p: ['n'], na: 2 }])
    assert.deepEqual(mingo.docs.notes.a.data, { n: 3 })
    assert.deepEqual(contents(await reload(sqlite)), contents(mingo))
  })

  it('saves the commits several clients make to one document at once in their order', async () => {
    const sqlite = await open('app.db')
    const { mingo, backend } = serve(sqlite)
    const docs = Array.from({ length: 4 }, () => backend.connect().get('notes', 'a'))
    await call(docs[0], 'create', { n: 0 })
    await Promise.all(docs.map(doc => call(doc, 'fetch')))
    await Promise.all(docs.map((doc, i) => call(doc, 'submitOp', [{ p: ['n'], na: i + 1 }])))

    assert.equal(mingo._getVersionSync('notes', 'a'), 5)
    assert.deepEqual(mingo.docs.notes.a.data, { n: 10 })
    assert.equal((await dump(sqlite)).ops.length, 5)
    assert.deepEqual(contents(await reload(sqlite)), contents(mingo))
  })

  it('loads a document saved without its last op, which then takes commits again', async () => {
    const json0 = 'http://sharejs.org/types/JSONv0'
    const sqlite = await open('app.db', {
      documents: [{ collection: 'notes', id: 'a', data: JSON.stringify({ v: 2, type: json0, data: { n: 2 }, m: {} }) }],
      ops: [{ id: 'f47ac10b', collection: 'notes', documentId: 'a', op: JSON.stringify({ v: 0, create: { type: json0, data: { n: 1 } } }) }]
    })
    const { backend } = serve(sqlite, await reload(sqlite))
    const doc = backend.connect().get('notes', 'a')
    await call(doc, 'fetch')
    await call(doc, 'submitOp', [{ p: ['n'], na: 1 }])
    assert.deepEqual((await reload(sqlite)).docs.notes.a.data, { n: 3 })
  })
})

// What fn logs with console[method], which is restored after
async function captureConsole (method, fn) {
  const logged = []
  const original = console[method]
  console[method] = (...args) => logged.push(args)
  try {
    await fn()
  } finally {
    console[method] = original
  }
  return logged
}

// SQLite files in a temporary directory, with the tables getOrCreateSqliteDb()
// in mingo-sqlite.js creates; closed and removed after each test
function useSqliteFiles () {
  const SCHEMA = [
    'CREATE TABLE documents (collection TEXT, id TEXT, data TEXT, PRIMARY KEY (collection, id))',
    'CREATE TABLE ops (id UUID PRIMARY KEY, collection TEXT, documentId TEXT, op TEXT)',
    'CREATE TABLE files (id TEXT PRIMARY KEY, data BLOB, createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP)'
  ]
  let directory
  const databases = []

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'teamplay-sqlite-'))
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
    await run('BEGIN')
    for (const [table, rows] of Object.entries(rowsByTable)) {
      for (const row of rows) {
        const columns = Object.keys(row)
        await run(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`, Object.values(row))
      }
    }
    await run('COMMIT')
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

  return { open, dump }
}

describe('SQLite snapshot clone', () => {
  const { open, dump } = useSqliteFiles()

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

  it('leaves the target as it was when its disk fills up during the copy', async () => {
    const source = await open('source.db', {
      documents: Array.from({ length: 2000 }, (_, i) => ({
        collection: 'notes', id: 'd' + i, data: JSON.stringify({ v: 1, data: { text: 'x'.repeat(200) } })
      }))
    })
    const target = await open('target.db', {
      documents: [{ collection: 'notes', id: 'kept', data: '{"v":1}' }]
    })
    const before = await dump(target)
    const all = promisify(target.all.bind(target))
    // SQLite rolls a transaction back by itself when the disk is full
    const [{ page_count: pageCount }] = await all('PRAGMA page_count')
    await promisify(target.run.bind(target))(`PRAGMA max_page_count = ${pageCount + 40}`)
    await assert.rejects(cloneSqliteDb(source, target), /SQLITE_FULL/)
    assert.deepEqual(await dump(target), before)
    assert.deepEqual((await all('PRAGMA database_list')).map(({ name }) => name), ['main'], 'the source is detached')
  })
})
