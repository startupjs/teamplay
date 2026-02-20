import { isObservable, observable } from '@nx-js/observer-util'
import { set as _set, del as _del } from './dataTree.js'
import { SEGMENTS } from './Signal.js'
import { getConnection, fetchOnly } from './connection.js'
import FinalizationRegistry from '../utils/MockFinalizationRegistry.js'
import SubscriptionState from './SubscriptionState.js'
import { getIdFieldsForSegments, injectIdFields, isPlainObject } from './idFields.js'

const ERROR_ON_EXCESSIVE_UNSUBSCRIBES = false

class Doc {
  initialized

  constructor (collection, docId) {
    this.collection = collection
    this.docId = docId
    this.lifecycle = new SubscriptionState({
      onSubscribe: () => this._subscribe(),
      onUnsubscribe: () => this._unsubscribe()
    })
    this.init()
  }

  get subscribed () {
    return this.lifecycle.subscribed
  }

  init () {
    if (this.initialized) return
    this.initialized = true
    this._initData()
  }

  async subscribe () {
    await this.lifecycle.subscribe()
    this.init()
  }

  async unsubscribe () {
    await this.lifecycle.unsubscribe()
    if (!this.subscribed) {
      this.initialized = undefined
      this._removeData()
    }
  }

  async _subscribe () {
    const doc = getConnection().get(this.collection, this.docId)
    await new Promise((resolve, reject) => {
      const method = fetchOnly ? 'fetch' : 'subscribe'
      doc[method](err => {
        if (err) return reject(err)
        resolve()
      })
    })
  }

  async _unsubscribe () {
    const doc = getConnection().get(this.collection, this.docId)
    await new Promise((resolve, reject) => {
      // First unsubscribe cleanly, then destroy to remove from connection.collections.
      // We can't call destroy() directly because it has a race condition: if connection.get()
      // is called before destroy completes (e.g. rapid unsub/resub), it resets _wantsDestroy
      // creating a corrupted state ("Cannot read properties of null (reading 'callback')").
      // By unsubscribing first and destroying in the callback, the doc is in a clean state.
      doc.unsubscribe(err => {
        if (err) return reject(err)
        doc.destroy(err => {
          if (err) return reject(err)
          resolve()
        })
      })
    })
  }

  _initData () {
    const doc = getConnection().get(this.collection, this.docId)
    this._refData()
    doc.on('load', () => this._refData())
    doc.on('create', () => this._refData())
    doc.on('del', () => _del([this.collection, this.docId]))
  }

  _refData () {
    const doc = getConnection().get(this.collection, this.docId)
    if (doc.data == null) return
    const idFields = getIdFieldsForSegments([this.collection, this.docId])
    if (isPlainObject(doc.data)) injectIdFields(doc.data, idFields, this.docId)
    if (isObservable(doc.data)) return
    _set([this.collection, this.docId], doc.data)
    doc.data = observable(doc.data)
  }

  _removeData () {
    _del([this.collection, this.docId])
  }
}

class DocSubscriptions {
  constructor () {
    this.subCount = new Map()
    this.docs = new Map()
    this.fr = new FinalizationRegistry(segments => this.destroy(segments))
  }

  init ($doc) {
    const segments = [...$doc[SEGMENTS]]
    const hash = hashDoc(segments)
    let doc = this.docs.get(hash)
    if (doc) {
      if (doc.initialized) return
      doc.init()
    } else {
      doc = new Doc(...segments)
      this.docs.set(hash, doc)
      this.fr.register($doc, segments, $doc)
      doc.init()
    }
  }

  subscribe ($doc) {
    const segments = [...$doc[SEGMENTS]]
    const hash = hashDoc(segments)
    let count = this.subCount.get(hash) || 0
    count += 1
    this.subCount.set(hash, count)
    if (count > 1) return this.docs.get(hash)._subscribing

    this.init($doc)
    const doc = this.docs.get(hash)
    doc._subscribing = doc.subscribe().then(() => { doc._subscribing = undefined })
    return doc._subscribing
  }

  async unsubscribe ($doc) {
    const segments = [...$doc[SEGMENTS]]
    const hash = hashDoc(segments)
    let count = this.subCount.get(hash) || 0
    count -= 1
    if (count < 0) {
      if (ERROR_ON_EXCESSIVE_UNSUBSCRIBES) throw ERRORS.notSubscribed($doc)
      return
    }
    if (count > 0) {
      this.subCount.set(hash, count)
      return
    }
    this.fr.unregister($doc)
    await this.destroy(segments)
  }

  async destroy (segments) {
    const hash = hashDoc(segments)
    const doc = this.docs.get(hash)
    if (!doc) return
    this.subCount.delete(hash)
    // Always call unsubscribe() - if doc is in SUBSCRIBING state, the state machine
    // will queue a pending unsubscribe to execute after subscribe completes
    await doc.unsubscribe()
    if (doc.subscribed) return // Subscribed again while unsubscribing
    this.docs.delete(hash)
  }
}

export const docSubscriptions = new DocSubscriptions()

function hashDoc (segments) {
  return JSON.stringify(segments)
}

const ERRORS = {
  notSubscribed: $doc => Error('trying to unsubscribe when not subscribed. Doc: ' + $doc.path())
}
