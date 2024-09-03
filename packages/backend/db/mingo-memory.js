import ShareDbMingoMemory from './sharedbMingo.js'
import { getExistingSqliteDb, loadSqliteDbToMingo } from './utils.js'

export const db = await getMingoDb({
  loadSnapshotPath: process.env.DB_LOAD_SNAPSHOT
})

async function getMingoDb ({ loadSnapshotPath }) {
  const db = new ShareDbMingoMemory()

  if (loadSnapshotPath) {
    const sqliteDb = getExistingSqliteDb(loadSnapshotPath)
    await loadSqliteDbToMingo(sqliteDb, db)
  }

  return db
}
