import sqlite3 from 'sqlite3'
import { existsSync } from 'fs'
import { resolve } from 'path'

export async function loadSqliteDbToMingo (sqliteDb, mingo) {
  return new Promise((resolve, reject) => {
    sqliteDb.all('SELECT collection, id, data FROM documents', [], (err, docsRows) => {
      if (err) return reject(err)

      sqliteDb.all('SELECT id, collection, documentId, op FROM ops ORDER BY rowid', [], (err, opsRows) => {
        if (err) return reject(err)

        // collection -> document id -> its op rows, in the order they were saved
        const opsByDoc = Object.create(null)
        for (const row of opsRows) {
          const docs = opsByDoc[row.collection] ??= Object.create(null)
          ;(docs[row.documentId] ??= []).push({ id: row.id, op: JSON.parse(row.op) })
        }

        let skipped = 0
        for (const row of docsRows) {
          if (!mingo.docs[row.collection]) {
            mingo.docs[row.collection] = {}
            mingo.ops[row.collection] = {}
          }

          // The document decides (see patchMingoForSQLitePersistence()), which
          // saves each op under the id of its version: an op at the document's
          // version is left from a commit whose document write failed, and an
          // op missing below it (pruned history) leaves a gap. The commit code
          // of older teamplay versions saved the commits that lost a race too:
          // ops past the document's version, and several ops of one version.
          // The op saved under the id of its version wins; of several older
          // ones, which memory took is unknown, and none is loaded (a gap).
          const snapshot = JSON.parse(row.data)
          const version = Number.isInteger(snapshot.v) && snapshot.v > 0 ? snapshot.v : 0
          const docOps = new Array(version).fill(undefined)
          // the id of an op of version v is ownIdPrefix + v + ']'
          const ownIdPrefix = JSON.stringify([row.collection, row.id]).slice(0, -1) + ','
          const ownVersions = new Set()
          const repeatedVersions = new Set()
          for (const { id, op } of opsByDoc[row.collection]?.[row.id] || []) {
            const v = op.v
            const own = id === ownIdPrefix + v + ']'
            if (v === version && own) continue
            if (!(Number.isInteger(v) && v >= 0 && v < version)) {
              skipped++
            } else if (own) {
              if (docOps[v] !== undefined) skipped++
              docOps[v] = op
              ownVersions.add(v)
            } else if (ownVersions.has(v)) {
              skipped++
            } else if (docOps[v] === undefined && !repeatedVersions.has(v)) {
              docOps[v] = op
            } else {
              skipped++
              repeatedVersions.add(v)
            }
          }
          for (const v of repeatedVersions) {
            if (ownVersions.has(v) || docOps[v] === undefined) continue
            docOps[v] = undefined
            skipped++
          }

          mingo.ops[row.collection][row.id] = docOps
          mingo.docs[row.collection][row.id] = snapshot
        }
        if (skipped) {
          console.warn(`[mingo] Did not load ${skipped} ops from SQLite: past their document's version, of a version saved more than once, or malformed (left by an older teamplay version)`)
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
      // MemoryDB's commit does not fail once its version check passed (ShareDB
      // 5.2.2). If it did, the client would get the error while SQLite keeps
      // the op until the doc's next commit of that version replaces it.
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
// Target reads the file source was opened with (source.filename), which must
// be a file database at an absolute path, as getExistingSqliteDb() opens:
// source's own connection is not used.
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
