// mock of client connection to sharedb to use inside tests.
// This just creates a sharedb server with in-memory database
// and creates a server connection to it.
import ShareDbMingo from '@startupjs/sharedb-mingo-memory'
import ShareBackend from 'sharedb'
import { connection, setConnection } from '../orm/connection.ts'
import { configureTeamplay } from '../config.ts'

export default function connect (options = {}) {
  const { idFields } = options || {}
  if (idFields !== undefined) configureTeamplay({ idFields })
  if (connection) return
  const backend = new ShareBackend({ db: new ShareDbMingo() })
  setConnection(backend.connect())
}
