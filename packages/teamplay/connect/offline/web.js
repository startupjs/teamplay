import localforage from 'localforage'
import SharedbCrosstabPubsub from '../lib/sharedb-crosstab-pubsub.cjs'
import createConnectWithPersistence from './index.js'

export const storage = {
  getItem: key => localforage.getItem(key),
  setItem: (key, value) => localforage.setItem(key, value),
  iterate: iterator => localforage.iterate(iterator)
}

export function createPubsub (onMessage) {
  return new SharedbCrosstabPubsub({ onMessage })
}

export default createConnectWithPersistence({ storage, createPubsub })
