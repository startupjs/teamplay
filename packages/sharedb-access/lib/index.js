import cloneDeep from 'lodash/cloneDeep.js'
import debugModule from 'debug'
import { patternToRegExp, lookup } from './util.js'
import ShareDBAccessError from './error.js'

const debug = debugModule('access')
// How many documents a connection is remembered to be allowed to read (see
// "READ (OPS)" below); past it the oldest are forgotten, and checked again
// when their next op comes.
const DEFAULT_READ_GRANTS_LIMIT = 10000
const CURRENT_SNAPSHOT = 'current'
// The messages ShareDB answers with documents' data (sharedb/lib/agent.js):
// fetch, subscribe, their bulk forms, query fetch and subscribe, snapshot
// fetch by version and by timestamp
const READ_ACTIONS = new Set(['f', 's', 'bf', 'bs', 'qf', 'qs', 'nf', 'nt'])
// The fields of an op that carry no document content (see refuseOp())
const OP_IDENTITY_FIELDS = new Set(['src', 'seq', 'v', 'c', 'd', 'i'])
const HIDDEN = '<hidden>'
const operations = [
  'Read',
  'Create',
  'Delete',
  'Update'
]
const validKeys = operations.map(el => el.charAt(0).toLowerCase() + el.slice(1))

function validateKeys (obj, collectionName) {
  for (const key of Object.keys(obj)) {
    if (!validKeys.includes(key)) {
      throw new Error(`Invalid access property ${key} in collection ${collectionName}. You need to use only 'create', 'read', 'update', 'delete' keys.`)
    }
  }
}

export function registerOrmRules (backend, pattern, access) {
  // if there are extra fields, an exception is thrown
  validateKeys(access, pattern)

  for (const op of operations) {
    // the user can write the first letter of the rules in any case
    const fn = access[op.charAt(0).toLowerCase() + op.slice(1)]
    if (!fn) continue
    const collection = pattern.replace(/\.\*$/u, '')
    backend['allow' + op](collection, fn)
  }
}

// TODO: rewrite to use $ here, or create a separate root $ for each user
// export function registerOrmRulesFromFactory (backend, pattern, factory) {
//   for (const op of operations) {
//     const collection = pattern.replace(/\.\*$/u, '')
//     backend['allow' + op](collection, async (...params) => {
//       const [docId,, session] = params
//       const userId = session.userId
//       const model = global.__clients[userId].model
//       const $doc = model._scope(`${collection}.${docId}`)

//       await $doc.subscribe()
//       const factoryModel = factory($doc, model)
//       $doc.unsubscribe()

//       const access = factoryModel.constructor.access
//       if (!access) return false

//       validateKeys(access, pattern)

//       const opName = op.charAt(0).toLowerCase() + op.slice(1)
//       const fn = access[opName]

//       return fn ? fn(model, collection, ...params) : false
//     })
//   }
// }

// Possible options:
// dontUseOldDocs: false - if true don't save unupdated docs for update action
// opCreatorUserIdPath - path to 'userId' for op's meta
// readGrantsLimit: 10000 - how many documents a connection is remembered to be
//   allowed to read (see "READ (OPS)")

export default function sharedbAccess (backend, options) {
  return new ShareDBAccess(backend, options)
}

export class ShareDBAccess {
  constructor (backend, options = {}) {
    this.backend = backend
    this.options = options
    this.allow = {}
    this.deny = {}
    this.protectedCollections = new Set(options.protectedCollections || [])
    // agent -> { granted: Set of document keys, pending: Map of key -> check }
    this.readGrants = new WeakMap()
    this.readGrantsLimit = options.readGrantsLimit ?? DEFAULT_READ_GRANTS_LIMIT
    // agent -> the messages received while a check of an earlier one is in
    // flight, in order (see receiveHandler())
    this.receiveQueues = new WeakMap()

    backend.use('receive', this.receiveHandler.bind(this))
    backend.use('readSnapshots', this.readSnapshotsHandler.bind(this))
    backend.use('op', this.opHandler.bind(this))
    backend.use('apply', this.applyHandler.bind(this))
    backend.use('commit', this.commitHandler.bind(this))

    this.initBackend(backend)
  }

  initBackend (backend) {
    const allow = this.allow
    const deny = this.deny

    function registerAllowHandler (op) {
      if (backend['allow' + op]) return

      backend['allow' + op] = function (collection, fn) {
        if (collection.indexOf('*') > -1) {
          allow[op]['**'] = allow[op]['**'] || []
          allow[op]['**'].push({ fn, pattern: collection })
        } else {
          allow[op][collection] = allow[op][collection] || []
          allow[op][collection].push(fn)
        }
      }
    }

    function registerDenyHandler (op) {
      if (backend['deny' + op]) return

      backend['deny' + op] = function (collection, fn) {
        if (collection.indexOf('*') > -1) {
          deny[op]['**'] = deny[op]['**'] || []
          deny[op]['**'].push({ fn, pattern: collection })
        } else {
          deny[op][collection] = deny[op][collection] || []
          deny[op][collection].push(fn)
        }
      }
    }

    // Export functions
    // collection name -> rules; no prototype, so a collection named like an
    // Object.prototype property ('constructor', 'toString') is a plain name
    operations.forEach(function (op) {
      allow[op] = allow[op] || Object.create(null)
      deny[op] = deny[op] || Object.create(null)
      registerAllowHandler(op)
      registerDenyHandler(op)
    })

    if (!backend.protectAccessCollection) {
      backend.protectAccessCollection = collection => {
        this.protectedCollections.add(collection)
      }
    }
  }

  // ++++++++++++++++++++++++++++++++ UPDATE ++++++++++++++++++++++++++++++++++
  commitHandler (shareRequest, done) {
    this.commitHandlerAsync(shareRequest)
      .then((res) => {
        done(res)
      })
      .catch((err) => done(err))
  }

  async commitHandlerAsync (shareRequest) {
    // Only derby-app client-request and server
    // if we set up checkServerAccess flag in stream
    //
    // we can set it up in the express middleware
    // before derby-apps routing in express
    // and set it off after
    const stream = shareRequest.agent.stream || {}
    if (stream.isServer && !stream.checkServerAccess) return

    const opData = shareRequest.op
    if (opData.create || opData.del) return

    const session = shareRequest.agent.connectSession || {}

    const collection = shareRequest.index || shareRequest.collection
    const docId = shareRequest.id

    const doc = (shareRequest.originalSnapshot && shareRequest.originalSnapshot.data) || {}
    const newDoc = shareRequest.snapshot.data

    const ops = opData.op
    const ok = await this.check('Update', collection, { type: 'update', doc, collection, docId, session, newDoc, ops })
    debug('update', ok, collection, docId, doc, newDoc, ops, session)

    if (ok) return
    return new ShareDBAccessError('ERR_ACCESS_DENY_UPDATE', ERRORS.updateDenied({ collection, docId, session }))
  }

  applyHandler (shareRequest, done) {
    this.applyHandlerAsync(shareRequest)
      .then((res) => {
        done(res)
      })
      .catch((err) => done(err))
  }

  async applyHandlerAsync (shareRequest) {
    const opData = shareRequest.op
    const session = shareRequest.agent.connectSession || {}
    const opUId = session[this.options.opCreatorUserIdPath || 'userId']
    const stream = shareRequest.agent.stream || {}

    // Save userId for audit purpose
    opData.m = opData.m || {}
    if (opUId) opData.m.uId = opUId

    if (stream.isServer && !stream.checkServerAccess) return

    const collection = shareRequest.index || shareRequest.collection
    const docId = shareRequest.id
    const snapshot = shareRequest.snapshot

    // ++++++++++++++++++++++++++++++++ CREATE ++++++++++++++++++++++++++++++++++
    if (opData.create) {
      const newDoc = opData.create.data
      const ok = await this.check('Create', collection, { type: 'create', newDoc, collection, docId, session })
      debug('create', ok, collection, docId, newDoc)

      if (ok) return
      return new ShareDBAccessError('ERR_ACCESS_DENY_CREATE', ERRORS.createDenied({ collection, docId, session }))
    }

    // ++++++++++++++++++++++++++++++++ DELETE ++++++++++++++++++++++++++++++++++
    if (opData.del) {
      const doc = snapshot.data

      const ok = await this.check('Delete', collection, { type: 'delete', doc, collection, docId, session })
      debug('delete', ok, collection, docId, doc)
      if (ok) return
      return new ShareDBAccessError('ERR_ACCESS_DENY_DELETE', ERRORS.deleteDenied({ collection, docId, session }))
    }

    // For Update
    if (!this.options.dontUseOldDocs) {
      shareRequest.originalSnapshot = cloneDeep(snapshot)
    }
  }

  readSnapshotsHandler (shareRequest, done) {
    Promise.all(shareRequest.snapshots.map(snapshot => {
      return this.docHandlerAsync({
        index: shareRequest.index,
        collection: shareRequest.collection,
        id: snapshot.id,
        snapshot,
        snapshotType: shareRequest.snapshotType,
        agent: shareRequest.agent
      })
    }))
      .then(reasons => {
        const reason = reasons.find(reason => reason)
        done(reason)
      })
      .catch(err => done(err))
  }

  async docHandlerAsync (shareRequest) {
    // ++++++++++++++++++++++++++++++++ READ ++++++++++++++++++++++++++++++++++

    const agent = shareRequest.agent

    if (!this.isClientAgent(agent)) return

    const collection = shareRequest.index || shareRequest.collection
    const docId = shareRequest.id
    const doc = (shareRequest.snapshot && shareRequest.snapshot.data) || {}

    const session = agent.connectSession || {}

    const ok = await this.check('Read', collection, { type: 'read', doc, collection, docId, session })

    debug('read', ok, collection, [docId, doc, session])

    // Remember what this connection may read now, for the ops that follow.
    // An empty document (deleted, or not created yet) grants no ops: not the
    // ones that make it a document again, and not a deleted document's
    // earlier ones, which are judged by its last state (checkDocReadAsync())
    if (shareRequest.snapshotType === CURRENT_SNAPSHOT && this.needsReadCheck(collection)) {
      const snapshot = shareRequest.snapshot
      if (ok && snapshot && snapshot.type != null) this.grantRead(agent, collection, docId)
      else this.revokeRead(agent, collection, docId)
    }

    if (ok) return
    return new ShareDBAccessError('ERR_ACCESS_DENY_READ', ERRORS.readDenied({ collection, docId, session }))
  }

  // +++++++++++++++++++++++++++++ READ (OPS) +++++++++++++++++++++++++++++++
  // ShareDB sends a client a document's ops instead of its snapshot when the
  // client fetches or subscribes from a version (a reconnect, a refetch),
  // resubscribes a query with the versions of its results, or submits an op
  // that is transformed against ops it had not seen. Ops pass the 'op'
  // middleware only, never 'readSnapshots', and a create op carries the whole
  // document, so the read rule is applied to them as well, per document, to
  // its current snapshot:
  // - receiveHandler checks every document such a request names before
  //   ShareDB reads any op, in one bulk snapshot read. A refused fetch or
  //   subscribe gets the read error; in a bulk one, only the refused
  //   documents do. A query resubscribe is not refused: the documents of its
  //   results the client may not read are resubscribed from their current
  //   version, so it gets none of their ops (and the next poll drops the ones
  //   that left the query). A request whose fields are not in the shape
  //   ShareDB's client sends is refused (ERR_MESSAGE_BADLY_FORMED): ShareDB
  //   reads array-likes and strings as lists as well, so passing it on would
  //   let it read ops nothing checked;
  // - opHandler checks every op sent to a client. A document this connection
  //   was allowed to read (its snapshot passed the rule, or a check above
  //   did) passes at once: that is every live op of its subscribed documents
  //   and queries. Any other document is checked once against its current
  //   snapshot, the check shared by all its ops in flight.
  // A deletion carries no data and always passes. A deleted document's
  // earlier ops are judged by its last state before the deletion, never by
  // its empty state (a rule may pass an empty document).
  //
  // A check that fails (the database, a rule that throws) refuses the request
  // or the op with ERR_ACCESS_CHECK_FAILED and logs the cause on the server.
  //
  // Not covered: a document a connection could read stays readable to it, its
  // live ops included, until it reads the document again and is refused, or
  // reconnects (read rules are not re-run for every live op). And the ops of
  // a document readable now are all sent, older states included.

  // ShareDB handles a message once every 'receive' middleware has passed it,
  // so a check that waits for the database would let the connection's later
  // messages overtake the message it checks. While a check of an agent's
  // message is in flight, the agent's later messages wait behind it (each is
  // checked at once and passed on in the order they came); with none in
  // flight, a message that needs no check passes at once.
  receiveHandler (request, done) {
    const agent = request.agent
    if (!this.isClientAgent(agent)) return done()
    const action = request.data?.a
    let result
    try {
      result = this.checkReceivedMessage(agent, request.data)
    } catch (err) {
      result = this.checkFailed(err, { action })
    }
    let queue = this.receiveQueues.get(agent)
    if (!queue) {
      if (!isThenable(result)) return done(result)
      queue = { entries: [], flushing: false }
      this.receiveQueues.set(agent, queue)
    }
    const entry = { done, settled: !isThenable(result), result }
    queue.entries.push(entry)
    if (entry.settled) return
    // settled whatever happens: the agent's later messages wait for it
    const settle = reason => {
      entry.settled = true
      entry.result = reason
      this.flushReceiveQueue(agent, queue)
    }
    result.then(settle, err => settle(this.checkFailed(err, { action })))
  }

  flushReceiveQueue (agent, queue) {
    // a message passed on can make the agent receive another one at once
    if (queue.flushing) return
    queue.flushing = true
    while (queue.entries.length && queue.entries[0].settled) {
      const { done, result } = queue.entries.shift()
      try {
        done(result)
      } catch (err) {
        // what it would have done outside the queue: an uncaught exception
        queueMicrotask(() => { throw err })
      }
    }
    queue.flushing = false
    if (!queue.entries.length && this.receiveQueues.get(agent) === queue) this.receiveQueues.delete(agent)
  }

  // Returns nothing when the message passes, the error that refuses it, or a
  // promise (never rejected) of either when it waits for the read rules
  checkReceivedMessage (agent, message) {
    if (!message || typeof message !== 'object') return
    // ShareDB's agent handles the message after every 'receive' middleware,
    // and its own _checkRequest leaves some shapes unchecked: a bulk `b`
    // beyond `typeof === 'object'` (so a bulk unsubscribe with a huge
    // `length` loops, and a bulk fetch/subscribe with a duplicated or
    // non-string id leaks a pubsub stream per id), and the snapshot-fetch
    // `d` not at all (so an operator object reaches the database as a query
    // and the read rule as a non-string id). Those shapes are refused here
    if (!isValidMessageShape(message)) {
      return new ShareDBAccessError('ERR_MESSAGE_BADLY_FORMED', ERRORS.badlyFormed(message.a))
    }
    const reading = READ_ACTIONS.has(message.a)
    // ShareDB checks the collection name of doc messages only when there is
    // one, and not at all for queries; this runs first anyway. A database
    // adapter may read ['items'] as 'items'
    if (reading ? !isCollectionName(message.c) : (message.c != null && typeof message.c !== 'string')) {
      return this.readDenied(agent, typeof message.c === 'string' ? message.c : `<${typeof message.c}>`)
    }
    if (!reading) return

    const reads = getOpReads(message)
    if (reads === MALFORMED) {
      return new ShareDBAccessError('ERR_MESSAGE_BADLY_FORMED', ERRORS.badlyFormed(message.a))
    }
    if (!reads || !reads.length) return

    const projection = this.backend.projections && this.backend.projections[message.c]
    const collection = projection ? projection.target : message.c
    if (!this.needsReadCheck(collection)) return

    return this.checkOpReadsAsync(agent, collection, reads).then(
      denied => this.applyDenials(agent, message, denied),
      err => this.checkFailed(err, { action: message.a, collection })
    )
  }

  // reads: [[docId, version]] of one request (see getOpReads()).
  // Returns a Map of the refused docId -> { reason, snapshot }
  async checkOpReadsAsync (agent, collection, reads) {
    const denied = new Map()
    // the lowest version each document is read from (-Infinity: from the start)
    const fromVersions = new Map()
    for (const [docId, version] of reads) {
      const from = version == null ? -Infinity : version
      fromVersions.set(docId, Math.min(from, fromVersions.get(docId) ?? Infinity))
    }

    const snapshots = await this.getSnapshots(agent, collection, [...fromVersions.keys()])
    await Promise.all([...fromVersions].map(async ([docId, from]) => {
      const snapshot = snapshots[docId]
      // a deleted (or never created) document: from here on its ops are at
      // most the deletion
      if (snapshot && snapshot.type == null && from >= snapshot.v - 1) return
      const reason = await this.checkDocReadAsync(agent, collection, docId, snapshot)
      if (reason) denied.set(docId, { reason, snapshot })
    }))
    return denied
  }

  // What a request does with its refused documents (see above). Returns the
  // error that refuses the whole request, if it is refused
  applyDenials (agent, message, denied) {
    if (!denied.size) return
    const [first] = denied.values()
    switch (message.a) {
      case 'bf':
      case 'bs': {
        const docIds = Object.keys(message.b)
        if (docIds.every(docId => denied.has(docId))) return first.reason
        const action = message.a === 'bs' ? 's' : 'f'
        for (const [docId, { reason }] of denied) {
          delete message.b[docId]
          agent.send({ a: action, c: message.c, d: docId, error: { code: reason.code, message: reason.message } })
        }
        return
      }
      case 'qs': {
        if (!first.snapshot) return first.reason
        for (let i = 0; i < message.r.length; i++) {
          const docId = message.r[i][0]
          const refused = denied.get(docId)
          if (!refused) continue
          if (!refused.snapshot) return refused.reason
          message.r[i] = [docId, refused.snapshot.v]
        }
        return
      }
      default:
        return first.reason
    }
  }

  opHandler (request, done) {
    const { agent, collection, id, op } = request
    if (!this.isClientAgent(agent) || !this.needsReadCheck(collection)) return done()
    if (op && op.del && !('op' in op) && !op.create) {
      // A document deleted now may be created again with content this
      // connection may not read. End its grant at the deletion so the
      // recreate op (and anything after) is checked against the new snapshot,
      // instead of riding the grant the readable document had.
      if (typeof op.v === 'number' && this.hasReadGrant(agent, collection, id, op)) {
        this.grantRead(agent, collection, id, op.v + 1)
      }
      return done()
    }
    if (this.hasReadGrant(agent, collection, id, op)) return done()

    this.checkCurrentReadAsync(agent, collection, id).then(reason => {
      if (reason) return refuseOp(request, reason, done)
      if (this.hasReadGrant(agent, collection, id, op)) return done()
      // granted only up to a deletion, and the op is past it: a document
      // created again that the snapshot read does not show yet
      refuseOp(request, this.readDenied(agent, collection, id), done)
    }, err => {
      refuseOp(request, this.checkFailed(err, { action: 'op', collection, docId: id }), done)
    })
  }

  checkCurrentReadAsync (agent, collection, docId) {
    const { pending } = this.getReadGrants(agent)
    const key = getDocKey(collection, docId)
    let check = pending.get(key)
    if (!check) {
      check = this.getSnapshots(agent, collection, [docId])
        .then(snapshots => this.checkDocReadAsync(agent, collection, docId, snapshots[docId]))
        .finally(() => pending.delete(key))
      pending.set(key, check)
    }
    return check
  }

  // The read rule on the document as it is now (`snapshot`); allowed, the
  // connection is granted its ops. A deleted document is judged by its last
  // state before the deletion, read through ShareDB (so every 'readSnapshots'
  // middleware applies), whatever the rule says of its empty state; allowed,
  // the connection is granted its ops up to the deletion.
  async checkDocReadAsync (agent, collection, docId, snapshot) {
    if (!snapshot || snapshot.type != null || !(snapshot.v > 0)) {
      return this.docHandlerAsync({ collection, id: docId, snapshot, snapshotType: CURRENT_SNAPSHOT, agent })
    }
    this.revokeRead(agent, collection, docId)
    try {
      await this.fetchSnapshotAsync(agent, collection, docId, snapshot.v - 1)
    } catch (err) {
      if (isReadRefusal(err)) return this.readDenied(agent, collection, docId)
      throw err
    }
    this.grantRead(agent, collection, docId, snapshot.v)
  }

  readDenied (agent, collection, docId) {
    const session = agent.connectSession || {}
    return new ShareDBAccessError('ERR_ACCESS_DENY_READ', ERRORS.readDenied({ collection, docId, session }))
  }

  // A check that could not be made refuses what it was checking. The client
  // gets a generic error; the cause (a database or rule error) is logged
  // here, with no document data
  checkFailed (err, context) {
    console.error('[@teamplay/sharedb-access] An access check failed; refused.', context, err)
    return new ShareDBAccessError('ERR_ACCESS_CHECK_FAILED', ERRORS.checkFailed())
  }

  getSnapshots (agent, collection, docIds) {
    return new Promise((resolve, reject) => {
      const options = { agentCustom: agent.custom }
      this.backend.db.getSnapshotBulk(collection, docIds, null, options, (err, snapshotMap) => {
        if (err) return reject(err)
        resolve(snapshotMap)
      })
    })
  }

  fetchSnapshotAsync (agent, collection, docId, version) {
    return new Promise((resolve, reject) => {
      this.backend.fetchSnapshot(agent, collection, docId, version, (err, snapshot) => {
        if (err) return reject(err)
        resolve(snapshot)
      })
    })
  }

  isClientAgent (agent) {
    if (!agent) return false
    const stream = agent.stream || {}
    return !(stream.isServer && !stream.checkServerAccess)
  }

  // Whether reads of the collection depend on the rules (see check())
  needsReadCheck (collection) {
    if (typeof collection !== 'string') return true
    return !(this.options.openByDefault && !this.protectedCollections.has(collection))
  }

  getReadGrants (agent) {
    let grants = this.readGrants.get(agent)
    if (!grants) {
      // granted: document key -> the version its ops are granted below
      grants = { granted: new Map(), pending: new Map() }
      this.readGrants.set(agent, grants)
    }
    return grants
  }

  hasReadGrant (agent, collection, docId, op) {
    const grants = this.readGrants.get(agent)
    const until = grants && grants.granted.get(getDocKey(collection, docId))
    if (until == null) return false
    return until === Infinity || Boolean(op && op.v < until)
  }

  grantRead (agent, collection, docId, until = Infinity) {
    const { granted } = this.getReadGrants(agent)
    const key = getDocKey(collection, docId)
    // most recent last
    granted.delete(key)
    granted.set(key, until)
    if (granted.size > this.readGrantsLimit) granted.delete(granted.keys().next().value)
  }

  revokeRead (agent, collection, docId) {
    const grants = this.readGrants.get(agent)
    if (grants) grants.granted.delete(getDocKey(collection, docId))
  }

  async check (operation, collection, props) {
    const allow = this.allow
    const deny = this.deny

    // a database adapter may read ['items'] as 'items', the rules would not
    if (typeof collection !== 'string') return false

    if (this.options.openByDefault && !this.protectedCollections.has(collection)) return true

    // First, check pattern matching collections. Lookups only: a rule map
    // gets no entry for a collection a client names
    const allowPatterns = allow[operation]['**'] || NO_RULES
    const denyPatterns = deny[operation]['**'] || NO_RULES

    const allowValidators = allow[operation][collection] || NO_RULES
    const denyValidators = deny[operation][collection] || NO_RULES

    let isAllowed = false

    for (let i = 0, len = allowPatterns.length; i < len; i++) {
      const pattern = allowPatterns[i].pattern

      const regExp = patternToRegExp(pattern)

      if (regExp.test(collection)) isAllowed = await this.applyValidator(allowPatterns[i], props)

      if (isAllowed) break
    }

    for (let i = 0; !isAllowed && i < allowValidators.length; i++) {
      isAllowed = await this.applyValidator(allowValidators[i], props)
      if (isAllowed) break
    }

    let isDenied = false

    for (let i = 0, len = denyPatterns.length; i < len; i++) {
      const pattern = denyPatterns[i].pattern

      const regExp = patternToRegExp(pattern)

      if (regExp.test(collection)) isDenied = await this.applyValidator(denyPatterns[i], props)

      if (isDenied) break
    }

    for (let j = 0; !isDenied && j < denyValidators.length; j++) {
      isDenied = await this.applyValidator(denyValidators[j], props)
      if (isDenied) break
    }

    return isAllowed && !isDenied
  }

  // you can override default validation logic by providing customValidator in options:
  // customValidator: (validator, props, { defaultValidator }) => {
  //   if (typeof validator === 'string') return checkPermission(validator, props)
  //   else return defaultValidator(validator, props)
  // }
  async applyValidator (validator, props) {
    if (this.options.customValidator) {
      return await this.options.customValidator.call(undefined, validator, props, { defaultValidator })
    } else {
      return await defaultValidator(validator, props)
    }
  }
}

const NO_RULES = Object.freeze([])

async function defaultValidator (validator, props) {
  if (typeof validator === 'function') return await validator(props)
  if (typeof validator === 'boolean') return validator
  if (typeof validator?.fn === 'function') return await validator.fn(props)
  throw Error(ERRORS.incorrectValidator(validator))
}

// The documents a client message reads through ops, as [[docId, version]]
// (a null version: from the start), read the way ShareDB's agent reads the
// message (sharedb/lib/agent.js): fetch/subscribe with a version, bulk
// fetch/subscribe with a versions map (an array of ids is a snapshot read),
// a query subscribe with the client's results ('r', every id: ShareDB
// forwards the ops of all of them to the query until it polls). Nothing:
// the message reads no ops. MALFORMED: ShareDB would read ops for it, but
// it is not in the shape ShareDB's client sends (ShareDB reads array-likes,
// strings and other versions too): refused, never passed on.
function getOpReads (message) {
  switch (message.a) {
    case 'f':
    case 's':
      if (message.v == null) return
      if (!isDocId(message.d) || !isVersion(message.v)) return MALFORMED
      return [[message.d, message.v]]
    case 'bf':
    case 'bs': {
      const versions = message.b
      if (Array.isArray(versions)) return
      if (versions === null || typeof versions !== 'object') return MALFORMED
      const reads = []
      for (const docId of Object.keys(versions)) {
        const version = versions[docId]
        if (!isDocId(docId) || (version != null && !isVersion(version))) return MALFORMED
        reads.push([docId, version])
      }
      return reads
    }
    case 'qs': {
      const results = message.r
      // ShareDB reads `r` when it is truthy
      if (!results) return
      if (!Array.isArray(results)) return MALFORMED
      const reads = []
      for (const result of results) {
        if (!Array.isArray(result) || !isDocId(result[0])) return MALFORMED
        const version = result[1]
        if (version != null && !isVersion(version)) return MALFORMED
        reads.push([result[0], version])
      }
      return reads
    }
  }
}

const MALFORMED = Symbol('malformed')

// The shape ShareDB's agent needs for the message types its own _checkRequest
// does not fully validate (see checkReceivedMessage). Everything else passes
// here and ShareDB validates it next (query ids, doc-message collection and
// id, presence). Returns false for a shape that would be mishandled.
function isValidMessageShape (message) {
  switch (message.a) {
    // bulk unsubscribe: ShareDB iterates `b` as an array of ids
    case 'bu':
      return isIdList(message.b)
    // bulk fetch/subscribe: an array of ids (snapshots) or a versions map (ops)
    case 'bf':
    case 'bs':
      return Array.isArray(message.b) ? isIdList(message.b) : isVersionsMap(message.b)
    // snapshot fetch by version / by timestamp: `d` is not checked by ShareDB
    case 'nf':
      return isDocId(message.d) && (message.v == null || isVersion(message.v))
    case 'nt':
      return isDocId(message.d) && (message.ts == null || Number.isFinite(message.ts))
    // query fetch/subscribe: ShareDB reads `r` (the client's results) as an
    // array of [id, version]; a query fetch never reaches getOpReads, so its
    // `r` is checked here too
    case 'qf':
    case 'qs':
      return message.r == null || isResultList(message.r)
    // doc messages: `d` must be a string id when present (ShareDB checks too).
    // A write too: a doc stored under an id a read refuses (`length`,
    // `prototype`) could never be fetched or subscribed
    case 'f':
    case 's':
    case 'u':
    case 'op':
      return message.d == null || isDocId(message.d)
    default:
      return true
  }
}

// An array of distinct doc ids (ShareDB's client builds these from object
// keys, so it never repeats one or sends a non-string)
function isIdList (value) {
  if (!Array.isArray(value)) return false
  for (const id of value) if (!isDocId(id)) return false
  return new Set(value).size === value.length
}

// An array of [docId, version?] result rows (a query's current results)
function isResultList (value) {
  if (!Array.isArray(value)) return false
  for (const row of value) {
    if (!Array.isArray(row) || !isDocId(row[0])) return false
    if (row[1] != null && !isVersion(row[1])) return false
  }
  return true
}

// A map of doc id -> version (null means from the start). Not an array, and
// not array-like: a `length` property (even a string-keyed one) makes async
// (sharedb's bulk path) and lodash iterate it `length` times, so a
// `{ length: 1e7 }` would loop. Its keys are doc ids, which refuse `length`
// and prototype names, so the key check alone is enough; the array-like
// guard is kept as defence in depth.
function isVersionsMap (value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false
  if (looksArrayLike(value)) return false
  for (const id of Object.keys(value)) {
    if (!isDocId(id)) return false
    const version = value[id]
    if (version != null && !isVersion(version)) return false
  }
  return true
}

// What async/lodash take for an array (and iterate by index, `length` times)
function looksArrayLike (value) {
  return typeof value.length === 'number'
}

function isVersion (value) {
  return Number.isSafeInteger(value) && value >= 0
}

function isDocId (value) {
  return typeof value === 'string' && !isUnsafeKey(value)
}

// What ShareDB takes for a collection name: a string, and not a name of
// Object.prototype (ShareDB refuses those for doc messages, after this)
function isCollectionName (value) {
  return typeof value === 'string' && !isObjectPrototypeName(value)
}

// A key that pollutes a prototype, names a prototype, or makes an object
// array-like. ShareDB builds maps and runs iterators over client ids, so an
// id that is one of these turns a one-doc request into a prototype write or
// an N-length loop.
function isUnsafeKey (name) {
  return name === '__proto__' || name === 'prototype' || name === 'length' ||
    Object.hasOwn(Object.prototype, name)
}

function isObjectPrototypeName (name) {
  return name === '__proto__' || name === 'prototype' || Object.hasOwn(Object.prototype, name)
}

// The errors a snapshot read refused by a 'readSnapshots' middleware ends with
function isReadRefusal (err) {
  return !!err && (
    err.code === 'ERR_ACCESS_DENY_READ' ||
    err.code === 'ERR_SNAPSHOT_READS_REJECTED' ||
    err.code === 'ERR_SNAPSHOT_READ_SILENT_REJECTION'
  )
}

function isThenable (value) {
  return !!value && typeof value.then === 'function'
}

// Refuses an op on its way to a client. ShareDB logs a refused live op
// (sharedb/lib/agent.js, _onOp()) with the op it was sanitizing: this
// client's shallow copy, whose fields hold values every client's copy shares.
// Its fields that may carry document data are replaced on the copy, never
// changed in place, so the log names the op without its content.
function refuseOp (request, reason, done) {
  const op = request.op
  if (op && typeof op === 'object') {
    for (const key of Object.keys(op)) {
      if (!OP_IDENTITY_FIELDS.has(key) && op[key] !== undefined) op[key] = HIDDEN
    }
  }
  done(reason)
}

function getDocKey (collection, docId) {
  return JSON.stringify([collection, docId])
}

export { lookup }

const ERRORS = {
  incorrectValidator: validator => `
    accessControl: Incorrect validator.
    It must be either a function or a boolean value.
    Received:
      Type: ${typeof validator}
      Value: ${validator.toString()}
  `,
  badlyFormed: action => `Invalid '${action}' message: not in the shape ShareDB's client sends`,
  checkFailed: () => 'Access check failed',
  readDenied: ({ collection, docId, session }) => `
    403: Permission denied (read)
         - collection: ${collection}
         - docId: ${docId}
         - userId: ${session?.userId}
  `,
  createDenied: ({ collection, docId, session }) => `
    403: Permission denied (create)
         - collection: ${collection}
         - docId: ${docId}
         - userId: ${session?.userId}
  `,
  deleteDenied: ({ collection, docId, session }) => `
    403: Permission denied (delete)
         - collection: ${collection}
         - docId: ${docId}
         - userId: ${session?.userId}
  `,
  updateDenied: ({ collection, docId, session }) => `
    403: Permission denied (update)
         - collection: ${collection}
         - docId: ${docId}
         - userId: ${session?.userId}
  `
}
