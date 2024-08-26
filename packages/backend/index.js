import ShareDB from 'sharedb'
import shareDbHooks from 'sharedb-hooks'
import { pubsub } from './redis/index.js'
import { db } from './db/index.js'
import maybeFlushRedis from './redis/maybeFlushRedis.js'
import initValidateSchema from './features/validateSchema.js'
import initServerAggregate from './features/serverAggregate.js'
import initAccessControl from './features/accessControl.js'

export { redis, redlock, Redlock } from './redis/index.js'
export { db, mongo, mongoClient, createMongoIndex, sqlite } from './db/index.js'

const usersConnectionCounter = {}

export default function createBackend ({
  secure = false,
  pollDebounce,
  flushRedis = true,
  extraDbs,
  hooks,
  accessControl = secure,
  serverAggregate = secure,
  validateSchema = secure,
  models,
  verbose = true
} = {}) {
  // pollDebounce is the minimum time in ms between query polls in sharedb
  if (pollDebounce) db.pollDebounce = pollDebounce

  // Maybe flush redis when starting the app.
  // When running in cluster this should only run on one instance and once a day
  // so redlock is used to guarantee that.
  if (flushRedis) maybeFlushRedis()

  const backend = new ShareDB({
    db,
    pubsub,
    extraDbs
  })

  // sharedb-hooks
  shareDbHooks(backend)

  if (hooks) hooks(backend)

  if (accessControl) {
    initAccessControl(backend, { models, ...(typeof accessControl === 'object' ? accessControl : {}) })
  }

  if (serverAggregate) {
    initServerAggregate(backend, { models, ...(typeof serverAggregate === 'object' ? serverAggregate : {}) })
  }

  if (validateSchema && process.env.NODE_ENV !== 'production') {
    initValidateSchema(backend, { models, ...(typeof validateSchema === 'object' ? validateSchema : {}) })
  }

  backend.on('client', (client, reject) => {
    const req = client.upgradeReq
    if (!req) return

    const userId = client.session?.userId || req.session?.userId

    // TODO: rewrite to use $ here, or create a separate root $ for each user
    // if (!global.__clients[userId]) {
    //   const model = backend.createModel()
    //   global.__clients[userId] = { model }
    // }

    usersConnectionCounter[userId] = ~~usersConnectionCounter[userId] + 1

    const userAgent = req.headers && req.headers['user-agent']
    if (verbose) console.log('[WS OPENED]:', userId, userAgent)

    client.once('close', () => {
      if (verbose) console.log('[WS CLOSED]', userId)

      usersConnectionCounter[userId] -= 1

      // TODO: rewrite to use $ here, or create a separate root $ for each user
      // if (usersConnectionCounter[userId] <= 0) {
      //   global.__clients[userId].model.close()
      //   delete global.__clients[userId]
      // }
    })
  })

  return backend
}
