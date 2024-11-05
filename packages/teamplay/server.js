import createChannel from '@teamplay/channel/server'
import { connection, setConnection, setFetchOnly, setPublicOnly } from './orm/connection.js'

export { default as ShareDB } from 'sharedb'
export {
  default as createBackend,
  mongo, mongoClient, createMongoIndex, redis, redlock, sqlite, getRedis, Redis
} from '@teamplay/backend'

export function initConnection (backend, {
  fetchOnly = true,
  publicOnly = true,
  ...options
} = {}) {
  if (!backend) throw Error('backend is required')
  if (connection) throw Error('Connection already exists')
  setConnection(backend.connect())
  setFetchOnly(fetchOnly)
  setPublicOnly(publicOnly)
  return createChannel(backend, options)
}
