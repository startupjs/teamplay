import localforage from 'localforage'
import SharedbCrosstabPubsub from '../lib/sharedb-crosstab-pubsub.cjs'
import createConnectWithPersistence from './index.js'

const STORAGE_NAMESPACE = 'teamplay-offline'
const DOCS_PREFIX = `${STORAGE_NAMESPACE}:docs:`
const LAST_OP_PREFIX = `${STORAGE_NAMESPACE}:last-op:`

export default createConnectWithPersistence(init)

async function init (db) {
  await loadData(db)
  addPersistence(db)
  globalThis.db = db
  function onMessage (channel, data) {
    if (!(data?.c && data?.d)) return
    updateDocInDb(db, data.c, data.d)
  }
  return { pubsub: new SharedbCrosstabPubsub({ onMessage }) }
}

// do same thing as in loadData but for a single doc
async function updateDocInDb (db, collection, docId) {
  try {
    const snapshot = await localforage.getItem(getDocsKey(collection, docId))
    if (!snapshot) return

    if (!db.docs[collection]) {
      db.docs[collection] = {}
      db.ops[collection] = {}
    }
    if (snapshot && typeof snapshot === 'object' && snapshot.v == null) snapshot.v = 0
    db.docs[collection][docId] = snapshot
    if (!db.ops[collection]) db.ops[collection] = {}
    const lastOp = await localforage.getItem(getLastOpKey(collection, docId))
    db.ops[collection][docId] = buildOpsArray(lastOp)
  } catch (err) {
    console.error('Error updating doc from localforage:', err)
  }
}

export async function loadData (db) {
  const docsToLoad = []
  await localforage.iterate((value, key) => {
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
    const lastOp = await localforage.getItem(getLastOpKey(collection, docId))
    if (!db.ops[collection]) db.ops[collection] = {}
    db.ops[collection][docId] = buildOpsArray(lastOp)
  }
  console.log('DB data was loaded from localforage to shareDbMingo')
}

function addPersistence (db) {
  const originalCommit = db.commit

  db.commit = function (collection, docId, op, snapshot, options, callback) {
    originalCommit.call(this, collection, docId, op, snapshot, options, async err => {
      if (err) return callback(err)

      try {
        await localforage.setItem(getDocsKey(collection, docId), snapshot)
        await localforage.setItem(getLastOpKey(collection, docId), op)
      } catch (err) {
        throw Error('Error saving to localforage:\n', err.message)
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
    return [...new Array(version), lastOp]
  }
  return [lastOp]
}
