import cloneDeep from 'lodash/cloneDeep.js'
import isFunction from 'lodash/isFunction.js'
import debugModule from 'debug'
import { patternToRegExp, lookup } from './util.js'
import ShareDBAccessError from './error.js'

const debug = debugModule('access')
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
    backend['allow' + op](collection, (...params) => {
      // TODO: rewrite to use $ here, or create a separate root $ for each user
      // const [,, session] = params
      // const userId = session.userId
      // const model = global.__clients[userId].model
      // TODO: first argument was model, it's not needed anymore, or we should pass separate $ for each user
      return fn(undefined, collection, ...params)
    })
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

export default function sharedbAccess (backend, options) {
  return new ShareDBAccess(backend, options)
}

export class ShareDBAccess {
  constructor (backend, options) {
    this.backend = backend
    this.options = options || {}
    this.allow = {}
    this.deny = {}

    backend.use('readSnapshots', this.readSnapshotsHandler.bind(this))
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
    const ok = await this.check('Update', collection, [doc, { collection, docId, session, newDoc, ops }])
    debug('update', ok, collection, docId, doc, newDoc, ops, session)

    if (ok) return
    return new ShareDBAccessError('ERR_ACCESS_DENY_UPDATE', '403: Permission denied (update), collection: ' + collection + ', docId: ' + docId)
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
      const doc = opData.create.data
      const ok = await this.check('Create', collection, [doc, { collection, docId, session }])
      debug('create', ok, collection, docId, doc)

      if (ok) return
      return new ShareDBAccessError('ERR_ACCESS_DENY_CREATE', '403: Permission denied (create), collection: ' + collection + ', docId: ' + docId)
    }

    // ++++++++++++++++++++++++++++++++ DELETE ++++++++++++++++++++++++++++++++++
    if (opData.del) {
      const doc = snapshot.data

      const ok = await this.check('Delete', collection, [doc, { collection, docId, session }])
      debug('delete', ok, collection, docId, doc)
      if (ok) return
      return new ShareDBAccessError('ERR_ACCESS_DENY_DELETE', '403: Permission denied (delete), collection: ' + collection + ', docId: ' + docId)
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

    const stream = shareRequest.agent.stream || {}

    if (stream.isServer && !stream.checkServerAccess) return

    const collection = shareRequest.index || shareRequest.collection
    const docId = shareRequest.id
    const doc = (shareRequest.snapshot && shareRequest.snapshot.data) || {}
    const agent = shareRequest.agent

    const session = agent.connectSession || {}

    const ok = await this.check('Read', collection, [docId, doc, session])

    debug('read', ok, collection, [docId, doc, session])

    if (ok) return
    return new ShareDBAccessError('ERR_ACCESS_DENY_READ', '403: Permission denied (read), collection: ' + collection + ', docId: ' + docId)
  }

  async check (operation, collection, args) {
    const allow = this.allow
    const deny = this.deny

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

      if (regExp.test(collection)) isAllowed = await apply(allowPatterns[i])

      if (isAllowed) break
    }

    for (let i = 0; !isAllowed && i < allowValidators.length; i++) {
      isAllowed = await apply(allowValidators[i])
      if (isAllowed) break
    }

    let isDenied = false

    for (let i = 0, len = denyPatterns.length; i < len; i++) {
      const pattern = denyPatterns[i].pattern

      const regExp = patternToRegExp(pattern)

      if (regExp.test(collection)) isDenied = await apply(denyPatterns[i])

      if (isDenied) break
    }

    for (let j = 0; !isDenied && j < denyValidators.length; j++) {
      isDenied = await apply(denyValidators[j])
      if (isDenied) break
    }

    return isAllowed && !isDenied

    async function apply (validator) {
      if (isFunction(validator)) return await validator.apply(this, args)
      return await validator.fn.apply(this, args)
    }
  }
}

export { lookup }
