import localforage from 'localforage'
import createConnectWithPersistence from './index.js'

export default createConnectWithPersistence(initPersistence)

async function initPersistence (db) {
  await loadData(db)
  addPersistence(db)
}

export async function loadData (db) {
  await localforage.iterate((value, key) => {
    const [namespace, type, collection, ...docSegments] = key.split(':')
    if (!(namespace === 'teamplay-offline' && type === 'docs')) return
    const docId = docSegments.join(':') // in case docId contains ':'
    if (!db.docs[collection]) {
      db.docs[collection] = {}
      db.ops[collection] = {}
    }
    // restore document with version 0 and empty ops.
    // We don't support multiplayer in offline-only mode.
    // Note: if you have multiple tabs open in browser then the last operation wins.
    db.docs[collection][docId] = { ...value, v: 0 }
    db.ops[collection][docId] = []
  })
  console.log('DB data was loaded from localforage to shareDbMingo')
}

function addPersistence (db) {
  const originalCommit = db.commit

  db.commit = function (collection, docId, op, snapshot, options, callback) {
    originalCommit.call(this, collection, docId, op, snapshot, options, async err => {
      if (err) return callback(err)

      try {
        await localforage.setItem(`teamplay-offline:docs:${collection}:${docId}`, snapshot)
      } catch (err) {
        throw Error('Error saving to localforage:\n', err.message)
      }

      callback(null, true)
    })
  }
}
