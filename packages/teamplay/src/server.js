import createChannel from '@teamplay/channel/server'
import backendCreateBackend from '@teamplay/backend'
import { getModels } from './orm/initModels.ts'
import { connection, setConnection, setDefaultFetchOnly, setPublicOnly } from './orm/connection.ts'
import { getRootContext } from './orm/rootContext.ts'
import { GLOBAL_ROOT_ID } from './orm/Root.ts'
import { configureTeamplay } from './config.ts'

export { default as ShareDB } from 'sharedb'
export {
  mongo,
  mongoClient,
  createMongoIndex,
  redis,
  redlock,
  sqlite,
  getRedis,
  Redis,
  getRedisOptions,
  redisPrefix,
  generateRedisPrefix
} from '@teamplay/backend'

export function createBackend (options = {}) {
  let nextOptions = options
  const initializedModels = getModels()

  if (!('models' in nextOptions) && Object.keys(initializedModels).length > 0) {
    nextOptions = {
      ...nextOptions,
      models: initializedModels
    }
  }

  return backendCreateBackend(nextOptions)
}

export default createBackend

export function initConnection (backend, {
  fetchOnly = true,
  publicOnly = true,
  idFields,
  ...options
} = {}) {
  if (!backend) throw Error('backend is required')
  if (connection) throw Error('Connection already exists')
  if (idFields !== undefined) configureTeamplay({ idFields })
  setConnection(backend.connect())
  setDefaultFetchOnly(fetchOnly)
  // The global root is auto-created at import time (before the server can set the
  // default), so it froze the old default. Server-side sub() on the global root
  // should follow the server's choice, so propagate it explicitly. (Per-request
  // roots are created later and pick up the default on their own.)
  getRootContext(GLOBAL_ROOT_ID, false)?.setFetchOnly(fetchOnly)
  setPublicOnly(publicOnly)
  return createChannel(backend, options)
}
