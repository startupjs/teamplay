// Offline 'connect' implementation with persistence to local storage.
// This creates a full sharedb server with mingo database in the browser or react-native app.
import ShareDbMingo from '@startupjs/sharedb-mingo-memory'
import ShareBackend from 'sharedb'
import { connection, setConnection } from '../../orm/connection.js'

const STORAGE_NAMESPACE = 'teamplay-offline'
const DOCS_PREFIX = `${STORAGE_NAMESPACE}:docs:`
const LAST_OP_PREFIX = `${STORAGE_NAMESPACE}:last-op:`

export default function createConnectWithPersistence ({ storage, createPubsub } = {}) {
  if (!storage) throw new Error('[connect-offline] storage is required')
  return async function connect () {
    if (connection) return
    const db = new ShareDbMingo()
    const options = { db }
    const { pubsub } = (await init(db, storage, createPubsub)) || {}
    if (pubsub) options.pubsub = pubsub
    const backend = new ShareBackend(options)
    setConnection(backend.connect())
  }
}

async function init (db, storage, createPubsub) {
  await loadData(db, storage)
  addPersistence(db, storage)
  globalThis.db = db
  const pubsub = createPubsub
    ? createPubsub((channel, data) => {
      if (!(data?.c && data?.d)) return
      updateDocInDb(db, storage, data.c, data.d)
    })
    : null
  return { pubsub }
}

// do same thing as in loadData but for a single doc
async function updateDocInDb (db, storage, collection, docId) {
  try {
    const snapshot = await storage.getItem(getDocsKey(collection, docId))
    if (!snapshot) return

    if (!db.docs[collection]) {
      db.docs[collection] = {}
      db.ops[collection] = {}
    }
    if (snapshot && typeof snapshot === 'object' && snapshot.v == null) snapshot.v = 0
    db.docs[collection][docId] = snapshot
    if (!db.ops[collection]) db.ops[collection] = {}
    const lastOp = await storage.getItem(getLastOpKey(collection, docId))
    db.ops[collection][docId] = buildOpsArray(lastOp)
  } catch (err) {
    console.error('Error updating doc from storage:', err)
  }
}

async function loadData (db, storage) {
  const docsToLoad = []
  await storage.iterate((value, key) => {
    const parsedKey = parseStorageKey(key)
    if (!parsedKey || parsedKey.type !== 'docs') return
    const { collection, docId } = parsedKey
    if (!db.docs[collection]) {
      db.docs[collection] = {}
      db.ops[collection] = {}
    }
    // We don't support multiplayer in offline-only mode.
    // Note: if you have multiple tabs open in browser then the last operation wins.
    if (value && typeof value === 'object' && value.v == null) value.v = 0
    db.docs[collection][docId] = value
    if (!db.ops[collection][docId]) db.ops[collection][docId] = []
    docsToLoad.push({ collection, docId })
  })
  for (const { collection, docId } of docsToLoad) {
    const lastOp = await storage.getItem(getLastOpKey(collection, docId))
    if (!db.ops[collection]) db.ops[collection] = {}
    db.ops[collection][docId] = buildOpsArray(lastOp)
  }
  console.log('DB data was loaded from storage to shareDbMingo')
}

function addPersistence (db, storage) {
  const originalCommit = db.commit

  db.commit = function (collection, docId, op, snapshot, options, callback) {
    originalCommit.call(this, collection, docId, op, snapshot, options, async err => {
      if (err) return callback(err)

      try {
        await storage.setItem(getDocsKey(collection, docId), snapshot)
        await storage.setItem(getLastOpKey(collection, docId), op)
      } catch (err) {
        throw Error('Error saving to storage:\n', err.message)
      }

      callback(null, true)
    })
  }
}

function parseStorageKey (key) {
  const [namespace, type, collection, ...docSegments] = key.split(':')
  if (namespace !== STORAGE_NAMESPACE) return null
  return { type, collection, docId: docSegments.join(':') }
}

function getDocsKey (collection, docId) {
  return `${DOCS_PREFIX}${collection}:${docId}`
}

function getLastOpKey (collection, docId) {
  return `${LAST_OP_PREFIX}${collection}:${docId}`
}

function buildOpsArray (lastOp) {
  if (!lastOp) return []
  const version = lastOp.v
  if (Number.isFinite(version) && version > 0) {
    const ops = new Array(version + 1)
    ops[version] = lastOp
    return ops
  }
  return [lastOp]
}
