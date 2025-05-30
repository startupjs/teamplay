import { raw } from '@nx-js/observer-util'
import { get as _get, set as _set, del as _del } from './dataTree.js'
import getSignal from './getSignal.js'
import { getConnection, fetchOnly } from './connection.js'
import { docSubscriptions } from './Doc.js'
import FinalizationRegistry from '../utils/MockFinalizationRegistry.js'

const ERROR_ON_EXCESSIVE_UNSUBSCRIBES = false
export const COLLECTION_NAME = Symbol('query collection name')
export const PARAMS = Symbol('query params')
export const HASH = Symbol('query hash')
export const IS_QUERY = Symbol('is query signal')
export const QUERIES = '$queries'

export class Query {
  // subscribing // Replaced by _currentSubscribingPromise and operation chain
  // unsubscribing // Replaced by _currentUnsubscribingPromise and operation chain
  subscribed = false // Changed initialization
  initialized
  shareQuery

  // New properties
  operation = Promise.resolve()
  intendedState = 'UNSUBSCRIBED'
  _currentSubscribingPromise = undefined
  _currentUnsubscribingPromise = undefined

  constructor (collectionName, params) {
    this.collectionName = collectionName
    this.params = params
    this.hash = hashQuery(this.collectionName, this.params)
    this.docSignals = new Set()

    this.operation = Promise.resolve()
    this.intendedState = 'UNSUBSCRIBED'
    this.subscribed = false
    this._currentSubscribingPromise = undefined
    this._currentUnsubscribingPromise = undefined
    // init() is called after successful subscription in the new logic
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
            this.init(); // Called after successful subscription
        } catch (err) {
            this.subscribed = false;
            if (this.intendedState === 'SUBSCRIBED') {
                console.error('Subscription error:', [this.collectionName, this.params], err);
                throw err;
            }
        } finally {
            this._currentSubscribingPromise = undefined;
        }
    }).catch(err => {
        if (this.intendedState === 'SUBSCRIBED') {
             // console.error('Chained subscription error:', [this.collectionName, this.params], err);
             throw err;
        }
    });
    return this.operation;
  }

  async _subscribe () {
    await new Promise((resolve, reject) => {
      const method = fetchOnly ? 'createFetchQuery' : 'createSubscribeQuery'
      this.shareQuery = getConnection()[method](this.collectionName, this.params, {}, err => {
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
                console.error('Unsubscription error:', [this.collectionName, this.params], err);
                throw err;
            }
        } finally {
            this._currentUnsubscribingPromise = undefined;
        }
    }).catch(err => {
        if (this.intendedState === 'UNSUBSCRIBED') {
            // console.error('Chained unsubscription error:', [this.collectionName, this.params], err);
            throw err;
        }
    });
    return this.operation;
  }

  async _unsubscribe () {
    if (!this.shareQuery) throw Error('this.shareQuery is not defined. This should never happen')
    await new Promise((resolve, reject) => {
      this.shareQuery.destroy(err => {
        if (err) return reject(err)
        resolve()
      })
      this.shareQuery = undefined
    })
  }

  _initData () {
    { // reference the fetched docs
      const docs = this.shareQuery.results.map(doc => raw(doc.data))
      _set([QUERIES, this.hash, 'docs'], docs)

      const ids = this.shareQuery.results.map(doc => doc.id)
      for (const docId of ids) {
        const $doc = getSignal(undefined, [this.collectionName, docId])
        docSubscriptions.init($doc)
        this.docSignals.add($doc)
      }
      _set([QUERIES, this.hash, 'ids'], ids)
    }

    this.shareQuery.on('insert', (shareDocs, index) => {
      const newDocs = shareDocs.map(doc => raw(doc.data))
      _get([QUERIES, this.hash, 'docs']).splice(index, 0, ...newDocs)

      const ids = shareDocs.map(doc => doc.id)
      for (const docId of ids) {
        const $doc = getSignal(undefined, [this.collectionName, docId])
        docSubscriptions.init($doc)
        this.docSignals.add($doc)
      }
      _get([QUERIES, this.hash, 'ids']).splice(index, 0, ...ids)
    })
    this.shareQuery.on('move', (shareDocs, from, to) => {
      const docs = _get([QUERIES, this.hash, 'docs'])
      docs.splice(from, shareDocs.length)
      docs.splice(to, 0, ...shareDocs.map(doc => raw(doc.data)))

      const ids = _get([QUERIES, this.hash, 'ids'])
      ids.splice(from, shareDocs.length)
      ids.splice(to, 0, ...shareDocs.map(doc => doc.id))
    })
    this.shareQuery.on('remove', (shareDocs, index) => {
      const docs = _get([QUERIES, this.hash, 'docs'])
      docs.splice(index, shareDocs.length)

      const docIds = shareDocs.map(doc => doc.id)
      for (const docId of docIds) {
        const $doc = getSignal(undefined, [this.collectionName, docId])
        this.docSignals.delete($doc)
      }
      const ids = _get([QUERIES, this.hash, 'ids'])
      ids.splice(index, docIds.length)
    })
  }

  _removeData () {
    this.docSignals.clear()
    _del([QUERIES, this.hash])
  }
}

export class QuerySubscriptions {
  constructor (QueryClass = Query) {
    this.QueryClass = QueryClass
    this.subCount = new Map()
    this.queries = new Map()
    this.fr = new FinalizationRegistry(({ collectionName, params }) => this.destroy(collectionName, params))
  }

  subscribe ($query) {
    const collectionName = $query[COLLECTION_NAME]
    const params = JSON.parse(JSON.stringify($query[PARAMS]))
    const hash = $query[HASH]
    let count = this.subCount.get(hash) || 0
    count += 1
    this.subCount.set(hash, count)
    if (count > 1) return this.queries.get(hash).subscribing

    this.fr.register($query, { collectionName, params }, $query)

    let query = this.queries.get(hash)
    if (!query) {
      query = new this.QueryClass(collectionName, params)
      this.queries.set(hash, query)
    }
    return query.subscribe()
  }

  async unsubscribe ($query) {
    const hash = $query[HASH]
    let count = this.subCount.get(hash) || 0
    count -= 1
    if (count < 0) {
      if (ERROR_ON_EXCESSIVE_UNSUBSCRIBES) throw Error(ERRORS.notSubscribed($query))
      return
    }
    if (count > 0) {
      this.subCount.set(hash, count)
      return
    }
    this.subCount.delete(hash)
    this.fr.unregister($query)
    const query = this.queries.get(hash)
    await query.unsubscribe()
    if (query.subscribed) return // if we subscribed again while waiting for unsubscribe, we don't delete the doc
    this.queries.delete(hash)
  }

  async destroy (collectionName, params) {
    const hash = hashQuery(collectionName, params)
    const query = this.queries.get(hash)
    if (!query) return
    this.subCount.delete(hash)
    await query.unsubscribe()
    if (query.subscribed) return // if we subscribed again while waiting for unsubscribe, we don't delete the doc
    this.queries.delete(hash)
  }
}

export const querySubscriptions = new QuerySubscriptions()

export function hashQuery (collectionName, params) {
  // TODO: probably makes sense to use fast-stable-json-stringify for this because of the params
  return JSON.stringify({ query: [collectionName, params] })
}

export function parseQueryHash (hash) {
  try {
    const { query: [collectionName, params] } = JSON.parse(hash)
    return { collectionName, params }
  } catch (err) {
    return {}
  }
}

export function getQuerySignal (collectionName, params, options) {
  params = JSON.parse(JSON.stringify(params))
  const hash = hashQuery(collectionName, params)

  const $query = getSignal(undefined, [collectionName], {
    signalHash: hash,
    ...options
  })
  $query[IS_QUERY] ??= true
  $query[COLLECTION_NAME] ??= collectionName
  $query[PARAMS] ??= params
  $query[HASH] ??= hash
  return $query
}

const ERRORS = {
  notSubscribed: $query => `
    Trying to unsubscribe from Query when not subscribed.
      Collection: ${$query[COLLECTION_NAME]}
      Params: ${$query[PARAMS]}
  `
}
