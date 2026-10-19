import ShareDbMingoMemory from '@startupjs/sharedb-mingo-memory'
import { resolve } from 'path'
import sqlite3 from 'sqlite3'
import {
  cloneSqliteDb,
  loadSqliteDbToMingo,
  getExistingSqliteDb,
  patchMingoForSQLitePersistence
} from './utils.js'

const DEFAULT_DB_PATH = './local.db'

export const { db, sqlite } = await getMingoSqliteDb({
  dbPath: process.env.DB_PATH,
  loadSnapshotPath: process.env.DB_LOAD_SNAPSHOT
})

async function getMingoSqliteDb ({ dbPath, loadSnapshotPath }) {
  const db = new ShareDbMingoMemory()
  dbPath = resolve(dbPath || DEFAULT_DB_PATH)
  const sqliteDb = await getOrCreateSqliteDb(dbPath)

  await deleteExpiredDocumentsOps(sqliteDb)

  if (loadSnapshotPath) {
    const snapshotSqliteDb = getExistingSqliteDb(loadSnapshotPath)
    await cloneSqliteDb(snapshotSqliteDb, sqliteDb)
  }

  await loadSqliteDbToMingo(sqliteDb, db)

  patchMingoForSQLitePersistence(sqliteDb, db)

  return { db, sqlite: sqliteDb }
}

async function deleteExpiredDocumentsOps (sqliteDb) {
  return await new Promise((resolve, reject) => {
    sqliteDb.run(`
      DELETE FROM ops
      WHERE
          json_extract(op, '$.m.ts') < (strftime('%s', 'now') - 24 * 60 * 60 ) * 1000
          AND
          json_extract(op, '$.v') < (
              SELECT (json_extract(data, '$.v') - 1)
              FROM documents
              WHERE documents.id = ops.documentId AND documents.collection = ops.collection
          );
    `, err => err ? reject(err) : resolve())
  })
}

async function getOrCreateSqliteDb (dbPath) {
  const sqliteDb = new sqlite3.Database(dbPath)

  try {
    await new Promise((resolve, reject) => {
      sqliteDb.run(`
        CREATE TABLE IF NOT EXISTS documents (
          collection TEXT,
          id TEXT,
          data TEXT,
          PRIMARY KEY (collection, id)
        )
      `, err => err ? reject(err) : resolve())
    })
    await new Promise((resolve, reject) => {
      sqliteDb.run(`
        CREATE TABLE IF NOT EXISTS ops (
          id UUID PRIMARY KEY,
          collection TEXT,
          documentId TEXT,
          op TEXT
        )
      `, err => err ? reject(err) : resolve())
    })
    await new Promise((resolve, reject) => {
      sqliteDb.run(`
        CREATE TABLE IF NOT EXISTS files (
          id TEXT PRIMARY KEY,
          data BLOB,
          createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `, err => err ? reject(err) : resolve())
    })
  } catch (err) {
    throw Error('Error creating SQLite file db and/or tables:\n' + err.message)
  }
  console.log('Using SQLite DB from file:', dbPath)
  return sqliteDb
}
