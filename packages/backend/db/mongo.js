import fs from 'fs'
import { MongoClient } from 'mongodb'
import ShareDbMongo from 'sharedb-mongo'

export const { db, mongo, mongoClient, createMongoIndex } = getMongoDb(process.env.MONGO_URL, {
  // ssl key, cert and ca can be provided as paths or base64 or directly as strings

  // ssl as string
  key: process.env.MONGO_SSL_KEY,
  cert: process.env.MONGO_SSL_CERT,
  ca: process.env.MONGO_SSL_CA,

  // ssl as path to the file
  keyPath: process.env.MONGO_SSL_KEY_PATH,
  certPath: process.env.MONGO_SSL_CERT_PATH,
  caPath: process.env.MONGO_SSL_CA_PATH,

  // ssl as base64
  keyBase64: process.env.MONGO_SSL_KEY_BASE64,
  certBase64: process.env.MONGO_SSL_CERT_BASE64,
  caBase64: process.env.MONGO_SSL_CA_BASE64,

  ...(process.env.MONGO_OPTIONS ? JSON.parse(process.env.MONGO_OPTIONS) : undefined)
})

function getMongoDb (url, options = {}) {
  options = { ...options }
  options = processSslOptions(options)

  options.useUnifiedTopology ??= true

  const mongoClient = new MongoClient(url, options)
  const mongo = mongoClient.db()
  return {
    db: ShareDbMongo({
      mongo: callback => callback(null, mongoClient),
      allowAggregateQueries: true
    }),
    mongo,
    mongoClient,
    createMongoIndex (collection, keys, options) {
      return mongo.collection(collection).createIndex(keys, options)
    }
  }
}

function processSslOptions (options = {}) {
  options = { ...options }
  let initialized = false
  if (options.key || options.cert || options.ca) {
    if (!(options.key && options.cert && options.ca)) {
      throw Error('[teamplay/mongo] SSL: All 3 strings must be provided: key, cert, ca')
    }
    if (!(typeof options.key === 'string' && typeof options.cert === 'string' && typeof options.ca === 'string')) {
      throw Error('[teamplay/mongo] SSL: All 3 strings must be provided as strings')
    }
    options = {
      ...options,
      key: Buffer.from(options.key),
      cert: Buffer.from(options.cert),
      ca: Buffer.from(options.ca)
    }
    initialized = true
  }
  if (options.keyPath || options.certPath || options.caPath) {
    if (initialized) {
      throw Error('[teamplay/mongo] SSL: Cannot mix paths and strings or base64')
    }
    if (!(options.keyPath && options.certPath && options.caPath)) {
      throw Error('[teamplay/mongo] SSL: All 3 paths to files must be provided: keyPath, certPath, caPath')
    }
    options = {
      ...options,
      key: fs.readFileSync(options.keyPath),
      cert: fs.readFileSync(options.certPath),
      ca: fs.readFileSync(options.caPath)
    }
    initialized = true
  }
  if (options.keyBase64 || options.certBase64 || options.caBase64) {
    if (initialized) {
      throw Error('[teamplay/mongo] SSL: Cannot mix base64 and strings or paths')
    }
    if (!(options.keyBase64 && options.certBase64 && options.caBase64)) {
      throw Error('[teamplay/mongo] SSL: All 3 base64 strings must be provided: keyBase64, certBase64, caBase64')
    }
    options = {
      ...options,
      key: Buffer.from(options.keyBase64, 'base64'),
      cert: Buffer.from(options.certBase64, 'base64'),
      ca: Buffer.from(options.caBase64, 'base64')
    }
  }
  // enable tls mode if certificates are provided (unless explicitly disabled)
  if (options.key && options.cert && options.ca) {
    options.tls ??= true
  }
  // cleanup options object from the processed keys
  delete options.keyPath
  delete options.certPath
  delete options.caPath
  delete options.keyBase64
  delete options.certBase64
  delete options.caBase64
  // delete the undefined values if they were not provided
  if (!options.key) delete options.key
  if (!options.cert) delete options.cert
  if (!options.ca) delete options.ca
  return options
}
