// Offline 'connect' implementation with persistence to local storage.
// This creates a full sharedb server with mingo database in the browser or react-native app.
import ShareDbMingo from '@startupjs/sharedb-mingo-memory'
import ShareBackend from 'sharedb'
import { connection, setConnection } from '../../orm/connection.js'

export default function createConnectWithPersistence (initPersistence) {
  return async function connect () {
    if (connection) return
    const db = new ShareDbMingo()
    await initPersistence(db)
    const backend = new ShareBackend({ db })
    setConnection(backend.connect())
  }
}
