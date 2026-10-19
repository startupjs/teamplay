import sqlite3 from 'sqlite3'
import { existsSync } from 'fs'
import { resolve } from 'path'

export async function loadSqliteDbToMingo (sqliteDb, mingo) {
  return new Promise((resolve, reject) => {
    sqliteDb.all('SELECT collection, id, data FROM documents', [], (err, docsRows) => {
      if (err) return reject(err)

      sqliteDb.all('SELECT collection, documentId, op FROM ops', [], (err, opsRows) => {
        if (err) return reject(err)

        const docsOpsByDocId = opsRows.reduce((byId, row) => {
          const values = byId[`${row.collection}.${row.documentId}`] || []
          const op = JSON.parse(row.op)
          values.push(op)
          byId[`${row.collection}.${row.documentId}`] = values
          return byId
        }, Object.create(null))

        for (const row of docsRows) {
          if (!mingo.docs[row.collection]) {
            mingo.docs[row.collection] = {}
            mingo.ops[row.collection] = {}
          }

          // The document decides (see patchMingoForSQLitePersistence()): an op
          // at or past its version is left from a commit whose document write
          // failed, and an op missing below it (pruned history) leaves a gap
          const snapshot = JSON.parse(row.data)
          const docOps = Array.from({ length: snapshot.v })
          for (const op of docsOpsByDocId[`${row.collection}.${row.id}`] || []) {
            if (op.v < snapshot.v) docOps[op.v] = op
          }

          mingo.ops[row.collection][row.id] = docOps
          mingo.docs[row.collection][row.id] = snapshot
        }
        resolve()
        console.log('DB data was loaded from SQLite to shareDbMingo')
      })
    })
  })
}

// Saves each commit to SQLite before the in-memory DB takes it, as sharedb-mongo
// does with Mongo: a write that fails is the commit's error, which ShareDB
// returns to the client that submitted the op (nothing is published), and
// memory stays as it was. There is no transaction: apps keep files on this
// connection (the files table), and each statement here commits on its own.
// The op goes first, under an id of its version, and the document last, which
// decides: an op whose document write failed stays at the document's version,
// where the next commit of that version replaces it and loading skips it.
export function patchMingoForSQLitePersistence (sqliteDb, shareDbMingo) {
  const originalCommit = shareDbMingo.commit
  // a doc's commits run one at a time: each checks the version that memory
  // has after the one before it
  const commitsByDoc = new Map()

  shareDbMingo.commit = function (collection, docId, op, snapshot, options, callback) {
    const key = JSON.stringify([collection, docId])
    const committed = (commitsByDoc.get(key) || Promise.resolve()).then(async () => {
      try {
        // ShareDB retries a commit made on an older version (see MemoryDB#commit)
        if (snapshot.v !== this._getVersionSync(collection, docId) + 1) return [null, false]
        await runSql(sqliteDb, 'REPLACE INTO ops (id, collection, documentId, op) VALUES (?, ?, ?, ?)', [
          JSON.stringify([collection, docId, op.v]), collection, docId, JSON.stringify(op)
        ])
        await runSql(sqliteDb, 'REPLACE INTO documents (collection, id, data) VALUES (?, ?, ?)', [
          collection, docId, JSON.stringify(snapshot)
        ])
      } catch (err) {
        console.error(`[mingo] Error saving ${collection}.${docId} v${snapshot.v} to SQLite:`, err)
        return [Error('Error saving to SQLite: ' + err.message, { cause: err })]
      }
      return await new Promise(resolve => {
        originalCommit.call(this, collection, docId, op, snapshot, options, (...args) => resolve(args))
      })
    })
    commitsByDoc.set(key, committed)
    committed.then(([err, succeeded]) => {
      if (commitsByDoc.get(key) === committed) commitsByDoc.delete(key)
      callback(err, succeeded)
    })
  }
}

export function getExistingSqliteDb (dbPath) {
  dbPath = resolve(dbPath)
  console.log('[mingo] Getting existing sqlite db from:', dbPath)
  if (!existsSync(dbPath)) {
    throw Error('[mingo] SQLite db file doesn\'t exist: ' + dbPath)
  }
  return new sqlite3.Database(dbPath)
}

// Clones each table from source to target in one transaction: SQLite commits
// every statement outside a transaction on its own, which makes a row-by-row
// copy of a large snapshot take minutes. A failed clone leaves target as it was.
// TODO: Do it in batches to avoid holding a whole table in memory.
export async function cloneSqliteDb (source, target) {
  try {
    await runSql(target, 'BEGIN')
    try {
      await cloneSqliteTable(source, target, 'documents', ['collection', 'id', 'data'])
      await cloneSqliteTable(source, target, 'ops', ['id', 'collection', 'documentId', 'op'])
      await cloneSqliteTable(source, target, 'files', ['id', 'data'])
      await runSql(target, 'COMMIT')
    } catch (err) {
      await runSql(target, 'ROLLBACK').catch(() => {})
      throw err
    }
  } catch (err) {
    throw Error('Error cloning SQLite DB:\n' + err.message)
  }
}

async function cloneSqliteTable (source, target, table, columns) {
  const rows = await new Promise((resolve, reject) => {
    source.all(`SELECT * FROM ${table}`, [], (err, rows) => err ? reject(err) : resolve(rows))
  })
  const insert = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
  // node-sqlite3 can run queued statements in any order: every insert has to
  // be done before the transaction ends, the failed ones too
  const results = await Promise.allSettled(rows.map(row => runSql(target, insert, columns.map(column => row[column]))))
  const failed = results.find(result => result.status === 'rejected')
  if (failed) throw failed.reason
}

function runSql (db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, err => err ? reject(err) : resolve())
  })
}
