import { isObservable, observable } from '@nx-js/observer-util'
import { set as _set, del as _del } from './dataTree.js'
import { SEGMENTS } from './Signal.js'
import { getConnection, fetchOnly } from './connection.js'
import FinalizationRegistry from '../utils/MockFinalizationRegistry.js'

const ERROR_ON_EXCESSIVE_UNSUBSCRIBES = false

class Doc {
  // subscribing // Replaced by _currentSubscribingPromise and operation chain
  // unsubscribing // Replaced by _currentUnsubscribingPromise and operation chain
  subscribed = false // Changed initialization
  initialized

  // New properties
  operation = Promise.resolve()
  intendedState = 'UNSUBSCRIBED'
  _currentSubscribingPromise = undefined
  _currentUnsubscribingPromise = undefined

  constructor (collection, docId) {
    this.collection = collection
    this.docId = docId
    // this.init() // Initialization of operation and state happens before init
    this.operation = Promise.resolve()
    this.intendedState = 'UNSUBSCRIBED'
    this.subscribed = false
    this._currentSubscribingPromise = undefined
    this._currentUnsubscribingPromise = undefined
    this.init()
  }

  init () {
    if (this.initialized) return
    this.initialized = true
    this._initData()
  }

  subscribe () { // Removed async as it returns the operation promise
    this.intendedState = 'SUBSCRIBED';
    this.operation = this.operation.then(async () => {
        if (this.intendedState !== 'SUBSCRIBED') return; // Superseded by a later call
        if (this.subscribed) return; // Already in the desired actual state

        if (this._currentUnsubscribingPromise) {
            try { await this._currentUnsubscribingPromise; } catch (e) { /* Previous op failed, proceed with current intent */ }
        }
        if (this.intendedState !== 'SUBSCRIBED') return; // Re-check after await
        if (this.subscribed) return; // Re-check after await

        const subscribePromise = this._subscribe();
        this._currentSubscribingPromise = subscribePromise;
        try {
            await subscribePromise;
            this.subscribed = true;
            // this.init() is called here in the new logic if needed
            // For Doc.js, this.init() is primarily for _initData and _refData,
            // which should happen after successful subscription.
            this.init(); // Ensure data initialization happens
        } catch (err) {
            this.subscribed = false;
            if (this.intendedState === 'SUBSCRIBED') {
                console.error('Subscription error:', [this.collection, this.docId], err);
                throw err;
            }
        } finally {
            this._currentSubscribingPromise = undefined;
        }
    }).catch(err => {
        if (this.intendedState === 'SUBSCRIBED') {
             // console.error('Chained subscription error:', [this.collection, this.docId], err);
             throw err;
        }
    });
    return this.operation;
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

  unsubscribe () { // Removed async as it returns the operation promise
    this.intendedState = 'UNSUBSCRIBED';
    this.operation = this.operation.then(async () => {
        if (this.intendedState !== 'UNSUBSCRIBED') return; // Superseded by a later call
        if (!this.subscribed) return; // Already in the desired actual state

        if (this._currentSubscribingPromise) {
            try { await this._currentSubscribingPromise; } catch (e) { /* Previous op failed, proceed with current intent */ }
        }
        if (this.intendedState !== 'UNSUBSCRIBED') return; // Re-check after await
        if (!this.subscribed) return; // Re-check after await

        const unsubscribePromise = this._unsubscribe();
        this._currentUnsubscribingPromise = unsubscribePromise;
        try {
            await unsubscribePromise;
            this.subscribed = false;
            if (this.initialized) this.initialized = undefined; // Kept from original logic
            if (this._removeData) this._removeData(); // Kept from original logic
        } catch (err) {
            this.subscribed = true; // Revert state on error
            if (this.intendedState === 'UNSUBSCRIBED') {
                console.error('Unsubscription error:', [this.collection, this.docId], err);
                throw err;
            }
        } finally {
            this._currentUnsubscribingPromise = undefined;
        }
    }).catch(err => {
        if (this.intendedState === 'UNSUBSCRIBED') {
            // console.error('Chained unsubscription error:', [this.collection, this.docId], err);
            throw err;
        }
    });
    return this.operation;
  }

  async _unsubscribe () {
    const doc = getConnection().get(this.collection, this.docId)
    await new Promise((resolve, reject) => {
      doc.destroy(err => {
        if (err) return reject(err)
        resolve()
      })
    })
  }

  _initData () {
    const doc = getConnection().get(this.collection, this.docId)
    // TODO: JSON does not have `undefined`, so we'll be receiving `null`.
    //       Handle this by converting all `null` to `undefined` in the doc's data tree.
    //       To do this we'll probably need to in the `op` event update the data tree
    //       and have a clone of the doc in our local data tree.
    this._refData()
    doc.on('load', () => this._refData())
    doc.on('create', () => this._refData())
    doc.on('del', () => _del([this.collection, this.docId]))
  }

  _refData () {
    const doc = getConnection().get(this.collection, this.docId)
    if (isObservable(doc.data)) return
    if (doc.data == null) return
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
    if (count > 1) return this.docs.get(hash).subscribing

    this.init($doc)
    const doc = this.docs.get(hash)
    return doc.subscribe()
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
    this.destroy(segments)
  }

  async destroy (segments) {
    const hash = hashDoc(segments)
    const doc = this.docs.get(hash)
    if (!doc) return
    // Wait until after unsubscribe to delete subCount and docs
    if (doc.subscribed) await doc.unsubscribe()
    if (doc.subscribed) return // Subscribed again while unsubscribing
    this.subCount.delete(hash)
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
