import createChannel from '@teamplay/channel/server'
import backendCreateBackend from '@teamplay/backend'
import { getModels } from './orm/initModels.ts'
import { connection, setConnection, setDefaultFetchOnly } from './orm/connection.ts'
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
  idFields,
  ...options
} = {}) {
  if (!backend) throw Error('backend is required')
  if (connection) throw Error('Connection already exists')
  if (idFields !== undefined) configureTeamplay({ idFields })
  setConnection(backend.connect())
  setDefaultFetchOnly(fetchOnly)
  return createChannel(backend, options)
}
