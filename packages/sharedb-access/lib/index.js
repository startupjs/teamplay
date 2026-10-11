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
    operations.forEach(function (op) {
      allow[op] = allow[op] || {}
      deny[op] = deny[op] || {}
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
    // An empty document (deleted, or not created yet) grants none of the ops
    // that make it a document again.
    if (shareRequest.snapshotType === CURRENT_SNAPSHOT && this.needsReadCheck(collection)) {
      const snapshot = shareRequest.snapshot
      const until = snapshot && snapshot.type != null ? Infinity : (snapshot && snapshot.v) || 0
      if (ok) this.grantRead(agent, collection, docId, until)
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
  //   that left the query);
  // - opHandler checks every op sent to a client. A document this connection
  //   was allowed to read (its snapshot passed the rule, or a check above
  //   did) passes at once: that is every live op of its subscribed documents
  //   and queries. Any other document is checked once against its current
  //   snapshot, the check shared by all its ops in flight.
  // A deletion carries no data and always passes. A deleted document's
  // earlier ops are judged by its last state before the deletion.
  //
  // Not covered: a document a connection could read stays readable to it, its
  // live ops included, until it reads the document again and is refused, or
  // reconnects (read rules are not re-run for every live op). And the ops of
  // a document readable now are all sent, older states included.

  receiveHandler (request, done) {
    const agent = request.agent
    const message = request.data
    if (!this.isClientAgent(agent) || !message || typeof message !== 'object') return done()

    // ShareDB checks the collection name of doc messages but not of queries,
    // and a database adapter may read ['items'] as 'items'
    if (message.c != null && typeof message.c !== 'string') {
      const session = agent.connectSession || {}
      const collection = `<${typeof message.c}>`
      return done(new ShareDBAccessError('ERR_ACCESS_DENY_READ', ERRORS.readDenied({ collection, session })))
    }

    const reads = getOpReads(message)
    if (!reads) return done()

    const projection = this.backend.projections && this.backend.projections[message.c]
    const collection = projection ? projection.target : message.c
    if (!this.needsReadCheck(collection)) return done()

    this.checkOpReadsAsync(agent, collection, reads)
      .then(denied => done(this.applyDenials(agent, message, denied)))
      .catch(err => done(err))
  }

  // reads: [[docId, version]] of one request.
  // Returns a Map of the refused docId -> { reason, snapshot }
  async checkOpReadsAsync (agent, collection, reads) {
    const denied = new Map()
    // the lowest version each document is read from (-Infinity: from the start)
    const fromVersions = new Map()
    for (const [docId, version] of reads) {
      if (typeof docId !== 'string') {
        const session = agent.connectSession || {}
        const reason = new ShareDBAccessError('ERR_ACCESS_DENY_READ', ERRORS.readDenied({ collection, docId: `<${typeof docId}>`, session }))
        denied.set(docId, { reason })
        return denied
      }
      const from = typeof version === 'number' ? version : -Infinity
      fromVersions.set(docId, Math.min(from, fromVersions.get(docId) ?? Infinity))
    }
    if (!fromVersions.size) return denied

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
    if (op && op.del && !('op' in op) && !op.create) return done()
    if (this.hasReadGrant(agent, collection, id, op)) return done()

    this.checkCurrentReadAsync(agent, collection, id)
      .then(reason => {
        if (reason || this.hasReadGrant(agent, collection, id, op)) return done(reason)
        // granted only up to a deletion, and the op is past it: a document
        // created again that the snapshot read does not show yet
        const session = agent.connectSession || {}
        done(new ShareDBAccessError('ERR_ACCESS_DENY_READ', ERRORS.readDenied({ collection, docId: id, session })))
      })
      .catch(err => done(err))
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
  // connection is granted its ops
  async checkDocReadAsync (agent, collection, docId, snapshot) {
    const reason = await this.docHandlerAsync({ collection, id: docId, snapshot, snapshotType: CURRENT_SNAPSHOT, agent })
    if (!reason || !snapshot || snapshot.type != null || !(snapshot.v > 0)) return reason
    // Deleted: its ops up to the deletion are judged by its state before it
    // (read through ShareDB, so every 'readSnapshots' middleware applies)
    const lastState = await this.fetchSnapshotAsync(agent, collection, docId, snapshot.v - 1).catch(() => null)
    if (!lastState) return reason
    this.grantRead(agent, collection, docId, snapshot.v)
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

    // First, check pattern matching collections
    allow[operation]['**'] = allow[operation]['**'] || []
    deny[operation]['**'] = deny[operation]['**'] || []

    const allowPatterns = allow[operation]['**']
    const denyPatterns = deny[operation]['**']

    allow[operation][collection] = allow[operation][collection] || []
    deny[operation][collection] = deny[operation][collection] || []

    const allowValidators = allow[operation][collection]
    const denyValidators = deny[operation][collection]

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

async function defaultValidator (validator, props) {
  if (typeof validator === 'function') return await validator(props)
  if (typeof validator === 'boolean') return validator
  if (typeof validator?.fn === 'function') return await validator.fn(props)
  throw Error(ERRORS.incorrectValidator(validator))
}

// The documents a client message reads through ops, as [[docId, version]],
// the way ShareDB's agent reads the message (sharedb/lib/agent.js):
// fetch/subscribe with a version, bulk fetch/subscribe with a versions map,
// a query subscribe with the client's results ('r', every id: ShareDB
// forwards the ops of all of them to the query until it polls)
function getOpReads (message) {
  switch (message.a) {
    case 'f':
    case 's':
      if (message.v == null) return
      return [[message.d, message.v]]
    case 'bf':
    case 'bs': {
      const versions = message.b
      if (versions == null || typeof versions !== 'object' || Array.isArray(versions)) return
      const reads = []
      for (const docId in versions) reads.push([docId, versions[docId]])
      return reads
    }
    case 'qs': {
      const results = message.r
      if (!results) return
      const reads = []
      for (let i = 0; i < results.length; i++) {
        const result = results[i]
        reads.push(result == null ? [] : [result[0], result[1]])
      }
      return reads
    }
  }
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
