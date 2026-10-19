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

          const docOps = (docsOpsByDocId[`${row.collection}.${row.id}`] || []).sort((a, b) => a.v - b.v)
          const firstOp = docOps[0]

          mingo.ops[row.collection][row.id] = firstOp?.v > 0 ? [...new Array(firstOp.v), ...docOps] : docOps
          mingo.docs[row.collection][row.id] = JSON.parse(row.data)
        }
        resolve()
        console.log('DB data was loaded from SQLite to shareDbMingo')
      })
    })
  })
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
