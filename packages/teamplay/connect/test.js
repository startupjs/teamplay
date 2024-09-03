// mock of client connection to sharedb to use inside tests.
// This just creates a sharedb server with in-memory database
// and creates a server connection to it.
import ShareBackend from 'sharedb'
import ShareDbMingo from 'sharedb-mingo-memory'
import { connection, setConnection } from '../orm/connection.js'

export default function connect () {
  if (connection) return
  patchSharedbMingoAggregations()
  const backend = new ShareBackend({ db: new ShareDbMingo() })
  setConnection(backend.connect())
}

let patched
function patchSharedbMingoAggregations () {
  if (patched) return
  patched = true
  const oldCanPollDoc = ShareDbMingo.prototype.canPollDoc
  ShareDbMingo.prototype.canPollDoc = function (collection, query) {
    if (query.hasOwnProperty('$aggregate')) return false // eslint-disable-line no-prototype-builtins
    return oldCanPollDoc.call(this, collection, query)
  }
}
