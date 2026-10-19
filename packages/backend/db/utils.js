import sqlite3 from 'sqlite3'
import { existsSync } from 'fs'
import { resolve } from 'path'

export async function loadSqliteDbToMingo (sqliteDb, mingo) {
  return new Promise((resolve, reject) => {
    sqliteDb.all('SELECT collection, id, data FROM documents', [], (err, docsRows) => {
      if (err) return reject(err)

      sqliteDb.all('SELECT id, collection, documentId, op FROM ops ORDER BY rowid', [], (err, opsRows) => {
        if (err) return reject(err)

        const docsOpsByDocId = opsRows.reduce((byId, row) => {
          const values = byId[`${row.collection}.${row.documentId}`] || []
          values.push({ id: row.id, op: JSON.parse(row.op) })
          byId[`${row.collection}.${row.documentId}`] = values
          return byId
        }, Object.create(null))

        let skipped = 0
        for (const row of docsRows) {
          if (!mingo.docs[row.collection]) {
            mingo.docs[row.collection] = {}
            mingo.ops[row.collection] = {}
          }

          // The document decides (see patchMingoForSQLitePersistence()): an op
          // at its version is left from a commit whose document write failed,
          // and an op missing below it (pruned history) leaves a gap. Ops past
          // it, and a second op of one version, come from the commit code of
          // older versions, which saved the commits that lost a race too: the
          // op saved under the id of its version wins, or else the first saved.
          const snapshot = JSON.parse(row.data)
          const version = Number.isInteger(snapshot.v) && snapshot.v > 0 ? snapshot.v : 0
          const docOps = new Array(version).fill(undefined)
          for (const { id, op } of docsOpsByDocId[`${row.collection}.${row.id}`] || []) {
            if (op.v > version) skipped++
            if (!(op.v < version)) continue
            if (docOps[op.v] !== undefined) {
              skipped++
              if (id !== JSON.stringify([row.collection, row.id, op.v])) continue
            }
            docOps[op.v] = op
          }

          mingo.ops[row.collection][row.id] = docOps
          mingo.docs[row.collection][row.id] = snapshot
        }
        if (skipped) {
          console.warn(`[mingo] Skipped ${skipped} ops in SQLite that are past their document's version or repeat a version (saved by older versions)`)
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
    }).catch(err => {
      // a commit that throws still answers ShareDB and lets the doc's next one run
      console.error(`[mingo] Error committing ${collection}.${docId} v${snapshot.v}:`, err)
      return [err]
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

const CLONED_TABLES = {
  documents: 'collection, id, data',
  ops: 'id, collection, documentId, op',
  files: 'id, data'
}

// Clones each table of source's file into target in one transaction, one
// INSERT ... SELECT per table: the rows stay inside SQLite (no copy of a whole
// table in memory), and a failed statement adds no row. A failed clone leaves
// target as it was, also when SQLite rolls the transaction back by itself (a
// full disk or an I/O error), since no statement follows the failed one.
export async function cloneSqliteDb (source, target) {
  try {
    await runSql(target, 'ATTACH DATABASE ? AS snapshot', [source.filename])
  } catch (err) {
    throw Error('Error cloning SQLite DB:\n' + err.message)
  }
  let failure
  try {
    await runSql(target, 'BEGIN')
    try {
      for (const [table, columns] of Object.entries(CLONED_TABLES)) {
        await runSql(target, `INSERT INTO ${table} (${columns}) SELECT ${columns} FROM snapshot.${table}`)
      }
      await runSql(target, 'COMMIT')
    } catch (err) {
      await runSql(target, 'ROLLBACK').catch(() => {})
      throw err
    }
  } catch (err) {
    failure = err
  }
  // a failed DETACH is the error only when the clone itself went well
  await runSql(target, 'DETACH DATABASE snapshot').catch(err => { failure ??= err })
  if (failure) throw Error('Error cloning SQLite DB:\n' + failure.message)
}

function runSql (db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, err => err ? reject(err) : resolve())
  })
}
