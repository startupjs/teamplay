import localforage from 'localforage'
import uuid from '@teamplay/utils/uuid'
import SharedbCrosstabPubsub from '../lib/sharedb-crosstab-pubsub.cjs'
import createConnectWithPersistence from './index.js'

const STORAGE_NAMESPACE = 'teamplay-offline'
const DOCS_PREFIX = `${STORAGE_NAMESPACE}:docs:`
const OPS_PREFIX = `${STORAGE_NAMESPACE}:ops:`
const OPS_RETENTION_MS = 3 * 24 * 60 * 60 * 1000

export default createConnectWithPersistence(init)

async function init (db) {
  await deleteExpiredDocumentsOps()
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
    db.ops[collection][docId] = []

    await localforage.iterate((value, key) => {
      const parsedKey = parseOpsStorageKey(key)
      if (!parsedKey) return
      if (parsedKey.collection !== collection || parsedKey.docId !== docId) return
      if (value) db.ops[collection][docId].push(value)
    })

    const ops = db.ops[collection][docId]
    if (ops.length > 1) ops.sort(sortOpsByTimeOrVersion)
  } catch (err) {
    console.error('Error updating doc from localforage:', err)
  }
}

export async function loadData (db) {
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
  })
  await localforage.iterate((value, key) => {
    const parsedKey = parseOpsStorageKey(key)
    if (!parsedKey) return
    const { collection, docId } = parsedKey
    if (!db.docs[collection] || !db.docs[collection][docId]) return
    if (!db.ops[collection]) db.ops[collection] = {}
    if (!db.ops[collection][docId]) db.ops[collection][docId] = []
    if (value) db.ops[collection][docId].push(value)
  })
  for (const collection of Object.keys(db.ops)) {
    for (const docId of Object.keys(db.ops[collection])) {
      const ops = db.ops[collection][docId]
      if (ops.length > 1) ops.sort(sortOpsByTimeOrVersion)
    }
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
        await localforage.setItem(getOpsKey(collection, docId, uuid()), op)
      } catch (err) {
        throw Error('Error saving to localforage:\n', err.message)
      }

      callback(null, true)
    })
  }
}

export async function deleteExpiredDocumentsOps () {
  const cutoffTs = Date.now() - OPS_RETENTION_MS
  const opsByDoc = new Map()

  await localforage.iterate((value, key) => {
    const parsedKey = parseOpsStorageKey(key)
    if (!parsedKey) return
    const docKey = `${parsedKey.collection}:${parsedKey.docId}`
    if (!value) return
    const entry = { key, collection: parsedKey.collection, docId: parsedKey.docId, op: value }
    const list = opsByDoc.get(docKey)
    if (list) list.push(entry)
    else opsByDoc.set(docKey, [entry])
  })

  const deletions = []
  for (const entries of opsByDoc.values()) {
    if (entries.length === 0) continue
    const { collection, docId } = entries[0]
    const snapshot = await localforage.getItem(getDocsKey(collection, docId))
    const docVersion = snapshot && Number.isFinite(snapshot.v) ? snapshot.v : null

    let latestEntry = entries[0]
    let latestScore = getOpSortScore(entries[0].op)
    for (const entry of entries) {
      const score = getOpSortScore(entry.op)
      if (score >= latestScore) {
        latestScore = score
        latestEntry = entry
      }
    }
    for (const entry of entries) {
      const isLatest = entry === latestEntry
      if (isLatest) {
        continue
      }
      const opTs = entry.op && entry.op.m && entry.op.m.ts
      if (typeof opTs !== 'number' || opTs >= cutoffTs) {
        continue
      }
      const opVersion = entry.op && entry.op.v
      if (Number.isFinite(docVersion) && Number.isFinite(opVersion)) {
        if (opVersion >= docVersion - 1) {
          continue
        }
      }
      deletions.push(localforage.removeItem(entry.key))
    }
  }

  await Promise.all(deletions)
}

function parseStorageKey (key) {
  const [namespace, type, collection, ...docSegments] = key.split(':')
  if (namespace !== STORAGE_NAMESPACE) return null
  if (type === 'ops') {
    const opId = docSegments.pop()
    return { type, collection, docId: docSegments.join(':'), opId }
  }
  return { type, collection, docId: docSegments.join(':') }
}

function parseOpsStorageKey (key) {
  const [namespace, type, collection, ...docSegments] = key.split(':')
  if (namespace !== STORAGE_NAMESPACE || type !== 'ops') return null
  const opId = docSegments.pop()
  return { type, collection, docId: docSegments.join(':'), opId }
}

function getDocsKey (collection, docId) {
  return `${DOCS_PREFIX}${collection}:${docId}`
}

function getOpsKey (collection, docId, opId) {
  return `${OPS_PREFIX}${collection}:${docId}:${opId}`
}

function getOpSortScore (op) {
  const opTs = op && op.m && op.m.ts
  if (typeof opTs === 'number') return opTs
  const opVersion = op && op.v
  return Number.isFinite(opVersion) ? opVersion : -Infinity
}

function sortOpsByTimeOrVersion (a, b) {
  return getOpSortScore(a) - getOpSortScore(b)
}
