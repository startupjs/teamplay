import { existsSync } from 'fs'
import { resolve } from 'path'
import sqlite3 from 'sqlite3'
import ShareDbPongoSqlite from './sharedb-pongo-sqlite.js'

const DEFAULT_DB_PATH = './local.db'
const OPS_TTL_MS = 24 * 60 * 60 * 1000

export const { db, sqlite } = await getPongoSqliteDb({
  dbPath: process.env.DB_PATH,
  loadSnapshotPath: process.env.DB_LOAD_SNAPSHOT
})

async function getPongoSqliteDb ({ dbPath, loadSnapshotPath }) {
  if (loadSnapshotPath) {
    // the mingo-sqlite clone path copies mingo-format tables; a pongo db has a
    // different (per-collection) layout. Copy the whole file instead.
    dbPath = resolve(dbPath || DEFAULT_DB_PATH)
    if (!existsSync(dbPath)) {
      const { copyFileSync } = await import('fs')
      const from = resolve(loadSnapshotPath)
      if (!existsSync(from)) throw Error(`[pongo-sqlite] DB_LOAD_SNAPSHOT file doesn't exist: ${from}`)
      copyFileSync(from, dbPath)
      console.log('[pongo-sqlite] Cloned snapshot db:', from, '->', dbPath)
    }
  }
  dbPath = resolve(dbPath || DEFAULT_DB_PATH)

  const db = new ShareDbPongoSqlite({ dbPath })

  // raw handle on the same file for the rest of the stack (express sessions,
  // file uploads). Pongo's connections run WAL with busy_timeout, mirror that.
  const sqliteDb = new sqlite3.Database(dbPath)
  await run(sqliteDb, 'PRAGMA journal_mode = WAL')
  await run(sqliteDb, 'PRAGMA busy_timeout = 5000')
  await run(sqliteDb, `
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      data BLOB,
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `)

  await deleteExpiredOps(sqliteDb)

  console.log('Using SQLite DB from file:', dbPath)
  return { db, sqlite: sqliteDb }
}

// same policy as the mingo-sqlite adapter: drop ops older than 24h except the
// latest op of each doc (kept so a resubscribing client one version behind can
// still catch up without a refetch)
async function deleteExpiredOps (sqliteDb) {
  const tables = await all(sqliteDb, `
    SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%__ops'
  `)
  const cutoff = Date.now() - OPS_TTL_MS
  for (const { name } of tables) {
    const snapshots = name.slice(0, -'__ops'.length)
    await run(sqliteDb, `
      DELETE FROM "${name.replaceAll('"', '""')}"
      WHERE
        json_extract(data, '$.op.m.ts') < ?
        AND
        json_extract(data, '$.v') < (
          SELECT json_extract(s.data, '$.v') - 1
          FROM "${snapshots.replaceAll('"', '""')}" s
          WHERE s._id = json_extract("${name.replaceAll('"', '""')}".data, '$.d')
        )
    `, [cutoff])
  }
}

async function run (sqliteDb, sql, params = []) {
  return await new Promise((resolve, reject) => {
    sqliteDb.run(sql, params, err => err ? reject(err) : resolve())
  })
}

async function all (sqliteDb, sql, params = []) {
  return await new Promise((resolve, reject) => {
    sqliteDb.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows))
  })
}
