// ShareDB database adapter backed by Pongo (https://github.com/event-driven-io/Pongo)
// running directly over a local SQLite file.
//
// Unlike the mingo adapter (which loads the WHOLE database into RAM at boot and
// serves everything from memory with SQLite as a write-through log), this adapter
// keeps nothing in memory: every read and query runs as SQL over the SQLite file,
// so process RSS no longer scales with database size.
//
// Storage layout (managed by Pongo, one table per collection):
//   <collection>        - snapshot docs: { _id, v, type, data, m, alive }
//                         `alive: 1|0` mirrors `type != null` because SQL can't
//                         test JSON null/missing; tombstones of deleted docs are
//                         kept (same as sharedb-mongo / the mingo adapter) so a
//                         recreated doc continues its version numbering.
//   <collection>__ops   - op docs: { _id: '<docId>.<v>', d, v, op }
//                         The deterministic primary key makes getOps a pure
//                         primary-key lookup (no scans) and op writes idempotent.
//
// Query execution is two-tier:
//   1. SQL fast path - filters/sorts Pongo can translate to SQL run in SQLite.
//   2. JS fallback   - anything else ($or, $ne, regex, null equality, $exists,
//                      $aggregate, ...) fetches the collection's live docs and
//                      runs the EXACT same mingo pipeline as the mingo adapter
//                      (castToSnapshotQuery + Mingo.Query / Mingo.Aggregator),
//                      so results always match the mingo adapter's semantics.
//
// Concurrency: `commit` uses a conditional write as the version arbiter - the
// snapshot row is replaced only when its stored `v` still equals `snapshot.v - 1`
// (or inserted for v=1). SQLite serializes writers, so only one concurrent commit
// per doc version can win; only the winner writes its op.
import { pongoClient } from '@event-driven-io/pongo'
import { sqlite3Driver } from '@event-driven-io/pongo/sqlite3'
import mingo from 'mingo'
// load all Mingo query operators so fallback semantics match the mingo adapter
import 'mingo/init/system'
import sharedb from 'sharedb'
import Snapshot from 'sharedb/lib/snapshot.js'

const DB = sharedb.DB

// Snapshot properties added to the root doc by `castToDoc()` in sharedb-mongo
const MONGO_DOC_PROPERTIES = {
  _id: 'id',
  _v: 'v',
  _type: 'type',
  _m: 'm',
  _o: 'o'
}

// Query keys to strip, because Mingo doesn't already ignore them.
const STRIPPED_QUERY_KEYS = {
  $comment: true,
  $hint: true
}

const OPS_SUFFIX = '__ops'
// tables in the same SQLite file owned by other parts of the stack
// (raw `sqlite` export consumers: express sessions, file uploads)
const RESERVED_COLLECTIONS = ['files', 'sessions']

// sentinel: a filter/sort that can't be translated to Pongo SQL
const FALLBACK = Symbol('fallback')

// SQLite requires LIMIT before OFFSET; Pongo emits a bare OFFSET when only
// skip is set, so inject an "unlimited" limit (max SQLite int64-safe JS int)
const UNLIMITED = Number.MAX_SAFE_INTEGER

const SQL_COMPARISON_OPERATORS = { $eq: true, $gt: true, $gte: true, $lt: true, $lte: true }

export default class ShareDbPongoSqlite extends DB {
  constructor ({ dbPath, connectionString, ...options } = {}) {
    super(options)
    if (!dbPath && !connectionString) throw Error('[sharedb-pongo-sqlite] dbPath or connectionString is required')
    this.closed = false
    this.client = pongoClient({
      driver: sqlite3Driver,
      connectionString: connectionString || 'file:' + dbPath
    })
    this.pongo = this.client.db()
    this._collections = new Map()
    this._inflight = new Set()
  }

  close (callback) {
    this.closed = true
    // drain in-flight operations first: a multi-statement operation (e.g.
    // commit = snapshot write + op write) interrupted mid-sequence by the pool
    // closing would surface as spurious errors on live client connections
    Promise.allSettled([...this._inflight])
      .then(() => this.client.close())
      .then(() => callback && callback(), err => callback ? callback(err) : console.error(err))
  }

  // register an operation so close() can wait for it (must be called
  // synchronously with the promise's creation - no await gap)
  _run (promise) {
    this._inflight.add(promise)
    const remove = () => this._inflight.delete(promise)
    promise.then(remove, remove)
    return promise
  }

  // ShareDB query subscriptions poll on debounce timers that can fire after
  // Backend.close(); refuse those calls here so they never hit the closed
  // connection pool (whose internal task rejections would go unhandled)
  _assertOpen () {
    if (this.closed) throw new Error('DB is closed')
  }

  async _snaps (collection) {
    return await this._collection(collection)
  }

  async _ops (collection) {
    return await this._collection(collection + OPS_SUFFIX)
  }

  async _collection (name) {
    let entry = this._collections.get(name)
    if (!entry) {
      if (RESERVED_COLLECTIONS.includes(name)) {
        throw Error(`[sharedb-pongo-sqlite] Collection name "${name}" is reserved`)
      }
      const col = this.pongo.collection(name)
      // gate every first use behind an awaited CREATE TABLE: pongo's lazy
      // auto-migration clears its "should migrate" flag before the CREATE
      // completes, so concurrent first ops can otherwise race it
      const ready = col.createCollection().catch(err => {
        this._collections.delete(name)
        throw err
      })
      entry = { col, ready }
      this._collections.set(name, entry)
    }
    await entry.ready
    return entry.col
  }

  // -- writes -----------------------------------------------------------------

  commit (collection, id, op, snapshot, options, callback) {
    if (typeof callback !== 'function') throw new Error('Callback required')
    this._run(this._commit(collection, id, op, snapshot)).then(
      succeeded => callback(null, succeeded),
      err => callback(err)
    )
  }

  async _commit (collection, id, op, snapshot) {
    this._assertOpen()
    const snaps = await this._snaps(collection)
    const doc = snapshotToDoc(snapshot)
    let succeeded
    if (snapshot.v === 1) {
      // create of a brand-new doc: primary key uniqueness is the version arbiter
      const res = await snaps.insertOne({ _id: id, ...doc })
      succeeded = !!res.successful
    } else {
      // update/delete/recreate: replace succeeds only if the stored version
      // still matches - one atomic UPDATE, SQLite serializes the writers
      const res = await snaps.replaceOne({ _id: id, v: snapshot.v - 1 }, doc)
      succeeded = res.matchedCount > 0
    }
    if (!succeeded) return false

    // only the winner of the version arbiter writes its op, so concurrent
    // commits can't overwrite each other's op log entries
    const opV = op.v != null ? op.v : snapshot.v - 1
    const opDoc = { d: id, v: opV, op }
    const ops = await this._ops(collection)
    const res = await ops.insertOne({ _id: opId(id, opV), ...opDoc })
    // a leftover row at this version can only be garbage from a commit whose
    // process crashed between the two writes - overwrite it
    if (!res.successful) await ops.replaceOne({ _id: opId(id, opV) }, opDoc)
    return true
  }

  // -- snapshots ----------------------------------------------------------------

  getSnapshot (collection, id, fields, options, callback) {
    const includeMetadata = (fields && fields.$submit) || (options && options.metadata)
    this._run(this._findSnapshotRow(collection, id)).then(
      row => callback(null, docToSnapshot(id, row, includeMetadata)),
      err => callback(err)
    )
  }

  async _findSnapshotRow (collection, id) {
    this._assertOpen()
    const snaps = await this._snaps(collection)
    return await snaps.findOne({ _id: id })
  }

  getSnapshotBulk (collection, ids, fields, options, callback) {
    const includeMetadata = (fields && fields.$submit) || (options && options.metadata)
    this._run(this._getSnapshotBulk(collection, ids)).then(rows => {
      const byId = new Map(rows.map(row => [row._id, row]))
      const results = Object.create(null)
      for (const id of ids) results[id] = docToSnapshot(id, byId.get(id), includeMetadata)
      callback(null, results)
    }, err => callback(err))
  }

  async _getSnapshotBulk (collection, ids) {
    this._assertOpen()
    const snaps = await this._snaps(collection)
    return await snaps.find({ _id: { $in: ids } })
  }

  // -- ops ------------------------------------------------------------------------

  getOps (collection, id, from, to, options, callback) {
    const includeMetadata = options && options.metadata
    this._run(this._getOps(collection, id, from, to)).then(rows => {
      const ops = rows.map(row => {
        const op = row.op
        if (!includeMetadata) delete op.m
        return op
      })
      callback(null, ops)
    }, err => callback(err))
  }

  async _getOps (collection, id, from, to) {
    this._assertOpen()
    if (!from) from = 0
    if (to == null) {
      const row = await this._findSnapshotRow(collection, id)
      to = row ? row.v : 0
    }
    if (to <= from) return []
    const rows = await this._findOpsRange(collection, id, from, to)
    if (rows.length < to - from) throw new Error('Missing ops')
    rows.sort((a, b) => a.v - b.v)
    return rows
  }

  async _findOpsRange (collection, id, from, to) {
    const ops = await this._ops(collection)
    const rows = []
    // fetch by deterministic primary keys (chunked to stay under the SQLite
    // bound-parameter limit)
    const CHUNK = 400
    for (let start = from; start < to; start += CHUNK) {
      const ids = []
      for (let v = start; v < Math.min(start + CHUNK, to); v++) ids.push(opId(id, v))
      rows.push(...await ops.find({ _id: { $in: ids } }))
    }
    return rows
  }

  deleteOps (collection, id, from, to, options, callback) {
    this._run(this._deleteOps(collection, id, from, to)).then(
      () => callback(null),
      err => callback(err)
    )
  }

  async _deleteOps (collection, id, from, to) {
    const rows = await this._getOps(collection, id, from, to)
    const ids = rows.map(row => row._id)
    if (!ids.length) return
    const ops = await this._ops(collection)
    await ops.deleteMany({ _id: { $in: ids } })
  }

  // -- queries ----------------------------------------------------------------------

  query (collection, inputQuery, fields, options, callback) {
    if (typeof callback !== 'function') throw new Error('Callback required')
    this._run(this._query(collection, inputQuery, options)).then(
      result => callback(null, result.snapshots, result.extra),
      err => callback(err)
    )
  }

  async _query (collection, inputQuery, options) {
    this._assertOpen()
    const includeMetadata = options && options.metadata
    if (Array.isArray(inputQuery.$aggregate)) {
      return await this._queryAggregate(collection, inputQuery.$aggregate)
    }
    const parsed = parseQuery(inputQuery)
    const filter = translateFilter(parsed.query)
    const sort = parsed.sort == null ? undefined : translateSort(parsed.sort)
    if (filter !== FALLBACK && sort !== FALLBACK) {
      return await this._querySql(collection, parsed, filter, sort, includeMetadata)
    }
    return await this._queryFallback(collection, parsed, includeMetadata)
  }

  async _querySql (collection, parsed, filter, sort, includeMetadata) {
    const snaps = await this._snaps(collection)
    if (parsed.count) {
      const extra = await snaps.countDocuments(filter)
      return { snapshots: [], extra }
    }
    const findOptions = {}
    if (sort) findOptions.sort = sort
    if (parsed.limit) findOptions.limit = parsed.limit
    if (parsed.skip) {
      findOptions.skip = parsed.skip
      if (!findOptions.limit) findOptions.limit = UNLIMITED
    }
    const rows = await snaps.find(filter, findOptions)
    const snapshots = rows.map(row => docToSnapshot(row._id, row, includeMetadata))
    return { snapshots }
  }

  // exact mingo-adapter semantics for whatever SQL can't express: fetch the
  // live docs once and run the same Mingo.Query the mingo adapter runs
  async _queryFallback (collection, parsed, includeMetadata) {
    const snapshots = await this._liveSnapshots(collection)
    const mingoQuery = new mingo.Query(castToSnapshotQuery(parsed.query))
    let filtered = snapshots.filter(snapshot => mingoQuery.test(snapshot))
    if (parsed.sort) sortSnapshots(filtered, parsed.sort)
    if (parsed.skip) filtered.splice(0, parsed.skip)
    if (parsed.limit) filtered = filtered.slice(0, parsed.limit)
    if (parsed.count) return { snapshots: [], extra: filtered.length }
    if (!includeMetadata) for (const snapshot of filtered) snapshot.m = null
    return { snapshots: filtered }
  }

  async _queryAggregate (collection, pipeline) {
    // NOTE: like the mingo adapter (and real sharedb-mongo), aggregation runs
    // over ALL stored docs including deleted-doc tombstone stubs
    const mongoDocs = (await this._allSnapshots(collection)).map(castToMongoDoc)
    // support $lookup: prefetch every referenced collection so the resolver
    // (which mingo calls synchronously) has the data ready
    const lookups = new Map()
    for (const name of collectLookupCollections(pipeline)) {
      lookups.set(name, (await this._allSnapshots(name)).map(castToMongoDoc))
    }
    const aggregator = new mingo.Aggregator(pipeline, {
      collectionResolver: name => lookups.get(name) || []
    })
    return { snapshots: [], extra: aggregator.run(mongoDocs) }
  }

  async _liveSnapshots (collection) {
    const snaps = await this._snaps(collection)
    const rows = await snaps.find({ alive: 1 })
    // metadata is included so queries can filter on it; the caller strips it
    return rows.map(row => docToSnapshot(row._id, row, true))
  }

  async _allSnapshots (collection) {
    const snaps = await this._snaps(collection)
    const rows = await snaps.find({})
    return rows.map(row => docToSnapshot(row._id, row, true))
  }

  queryPollDoc (collection, id, query, options, callback) {
    const includeMetadata = options && options.metadata
    let mingoQuery
    try {
      mingoQuery = new mingo.Query(castToSnapshotQuery(query))
    } catch (err) {
      return callback(err)
    }
    this._run(this._findSnapshotRow(collection, id)).then(row => {
      if (!row || !row.alive) return callback(null, false)
      callback(null, mingoQuery.test(docToSnapshot(id, row, includeMetadata)))
    }, err => callback(err))
  }

  canPollDoc (collection, query) {
    return !(
      Object.prototype.hasOwnProperty.call(query, '$orderby') ||
      Object.prototype.hasOwnProperty.call(query, '$sort') ||
      Object.prototype.hasOwnProperty.call(query, '$limit') ||
      Object.prototype.hasOwnProperty.call(query, '$skip') ||
      Object.prototype.hasOwnProperty.call(query, '$count') ||
      Object.prototype.hasOwnProperty.call(query, '$aggregate')
    )
  }
}

// -- doc <-> snapshot mapping ----------------------------------------------------

function snapshotToDoc (snapshot) {
  const doc = {
    v: snapshot.v,
    type: snapshot.type || null,
    m: snapshot.m ?? null,
    alive: snapshot.type ? 1 : 0
  }
  // JSON can't hold undefined (deleted docs have no data)
  if (snapshot.data !== undefined) doc.data = snapshot.data
  return doc
}

function docToSnapshot (id, row, includeMetadata) {
  if (!row) return new Snapshot(id, 0, null, undefined, null)
  const data = row.alive ? row.data : undefined
  const m = includeMetadata ? (row.m ?? null) : null
  return new Snapshot(id, row.v, row.type || null, data, m)
}

function opId (docId, v) {
  return docId + '.' + v
}

// -- query parsing (mirrors the mingo adapter) ------------------------------------

function parseQuery (inputQuery) {
  const query = { ...inputQuery }

  if (inputQuery.$orderby) {
    console.warn('Warning: query.$orderby deprecated. Use query.$sort instead.')
  }
  const sort = query.$sort || query.$orderby
  delete query.$sort
  delete query.$orderby

  const skip = query.$skip
  delete query.$skip

  const limit = query.$limit
  delete query.$limit

  const count = query.$count
  delete query.$count

  // If needed, modify query to exclude "tombstones" left after deleting docs,
  // using the same approach that sharedb-mongo uses.
  makeQuerySafe(query)

  return { query, sort, skip, limit, count }
}

// Build a query object that mimics how the query would be executed if it were
// made against snapshots persisted with `sharedb-mongo`
function castToSnapshotQuery (query) {
  if (!isPlainObjectLoose(query) || Array.isArray(query)) {
    throw new Error('Invalid mongo query format')
  }

  const snapshotQuery = {}
  for (const property in query) {
    // Ignore $-prefixed keys like $comment and $hint that aren't already
    // ignored by Mingo. sharedb-mongo would normally map them to cursor calls.
    if (STRIPPED_QUERY_KEYS[property]) continue

    const propertySegments = property.split('.')

    if (MONGO_DOC_PROPERTIES[propertySegments[0]]) {
      // Mongo doc property
      propertySegments[0] = MONGO_DOC_PROPERTIES[propertySegments[0]]
      snapshotQuery[propertySegments.join('.')] = query[property]
    } else if (property[0] === '$' && Array.isArray(query[property])) {
      // top-level boolean operator
      snapshotQuery[property] = query[property].map(castToSnapshotQuery)
    } else {
      // nested `data` document
      snapshotQuery['data.' + property] = query[property]
    }
  }
  return snapshotQuery
}

// Support sorting with the Mongo $orderby syntax
function sortSnapshots (snapshots, orderby) {
  if (!orderby) return snapshots
  snapshots.sort((snapshotA, snapshotB) => {
    for (const key in orderby) {
      const value = orderby[key]
      if (value !== 1 && value !== -1) {
        throw new Error('Invalid $orderby value')
      }
      const a = snapshotA.data && snapshotA.data[key]
      const b = snapshotB.data && snapshotB.data[key]
      if (a > b) return value
      if (b > a) return -value
    }
    return 0
  })
}

/** Casts the Snapshot into a Mongo document object */
function castToMongoDoc (snapshot) {
  const doc = Object.assign({}, snapshot.data)
  doc._id = snapshot.id
  doc._type = snapshot.type
  doc._v = snapshot.v
  doc._m = snapshot.m
  return doc
}

function collectLookupCollections (value, found = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectLookupCollections(item, found)
  } else if (isPlainObjectLoose(value)) {
    if (typeof value.$lookup?.from === 'string') found.add(value.$lookup.from)
    for (const key in value) collectLookupCollections(value[key], found)
  }
  return found
}

// -- SQL translation ----------------------------------------------------------------
//
// Returns a Pongo filter/sort when the query can run as SQL with semantics
// identical to the mingo adapter, or FALLBACK otherwise. Everything here is
// deliberately conservative: any construct with even slightly different
// semantics in SQL (null/missing handling, $ne, array equality, subdocument
// equality, regex, logical operators) is kicked to the JS fallback.

function translateFilter (query) {
  const filter = {}
  for (const key in query) {
    if (STRIPPED_QUERY_KEYS[key]) continue
    if (key[0] === '$') return FALLBACK // $or/$and/$nor/$where/...
    const path = translatePath(key)
    if (path === FALLBACK) return FALLBACK
    const condition = translateCondition(query[key])
    if (condition === FALLBACK) return FALLBACK
    filter[path] = condition
  }
  // exclude deleted-doc tombstones (the SQL twin of makeQuerySafe's
  // `_type: {$type: 2}`; queries with an explicit _type fall back above)
  filter.alive = 1
  return filter
}

function translatePath (key) {
  const segments = key.split('.')
  const head = segments[0]
  if (head === '_id') return segments.length === 1 ? '_id' : FALLBACK
  if (head === '_v') { segments[0] = 'v'; return segments.join('.') }
  if (head === '_m') { segments[0] = 'm'; return segments.join('.') }
  if (head[0] === '_') return FALLBACK // _type/_o and other unknown meta fields
  return 'data.' + key
}

function translateCondition (value) {
  if (isComparableScalar(value)) return value
  if (!isPlainObjectLoose(value) || value instanceof RegExp) return FALLBACK
  const keys = Object.keys(value)
  if (!keys.length) return FALLBACK // {} is exact-equality in mongo
  const condition = {}
  for (const op of keys) {
    const operand = value[op]
    if (SQL_COMPARISON_OPERATORS[op]) {
      // NOTE: $ne is NOT here - in mongo `$ne` also matches docs where the
      // field is missing, which SQL's `json_extract(...) != x` excludes
      if (!isComparableScalar(operand)) return FALLBACK
      condition[op] = operand
    } else if (op === '$in') {
      // ($nin matches missing fields in mongo - fallback territory)
      if (!Array.isArray(operand) || !operand.every(isComparableScalar)) return FALLBACK
      if (!operand.length) return FALLBACK
      condition[op] = operand
    } else {
      return FALLBACK
    }
  }
  return condition
}

function isComparableScalar (value) {
  const type = typeof value
  return type === 'string' || type === 'number' || type === 'boolean'
}

function translateSort (sort) {
  if (!isPlainObjectLoose(sort)) return FALLBACK
  const out = {}
  for (const key in sort) {
    const value = sort[key]
    // invalid values throw in the JS comparator - keep that behavior
    if (value !== 1 && value !== -1) return FALLBACK
    // the mingo adapter sorts on the SHALLOW `data[key]` (a dotted key is a
    // literal property name there, not a path) and `_`-prefixed meta keys
    // would also read from `data` - both mean something else in SQL
    if (key.includes('.') || key[0] === '_' || key[0] === '$') return FALLBACK
    out['data.' + key] = value
  }
  return out
}

function isPlainObjectLoose (value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// -- makeQuerySafe (taken straight from sharedb-mongo) -------------------------------

// Call on a query after it gets parsed to make it safe against
// matching deleted documents.
function makeQuerySafe (query) {
  // Don't modify the query if the user explicitly sets _type already
  if (Object.prototype.hasOwnProperty.call(query, '_type')) return
  // Deleted documents are kept around so that we can start their version from
  // the last version if they get recreated. When docs are deleted, their data
  // properties are cleared and _type is set to null. Filter out deleted docs
  // by requiring that _type is a string if the query does not naturally
  // restrict the results with other keys
  if (deletedDocCouldSatisfyQuery(query)) {
    query._type = { $type: 2 }
  }
}

// Could a deleted doc (one that contains {_type: null} and no other
// fields) satisfy a query?
//
// Return true if it definitely can, or if we're not sure.
function deletedDocCouldSatisfyQuery (query) {
  if (Object.prototype.hasOwnProperty.call(query, '$and')) {
    if (Array.isArray(query.$and)) {
      for (const clause of query.$and) {
        if (!deletedDocCouldSatisfyQuery(clause)) return false
      }
    } else {
      // Malformed? Play it safe.
      return true
    }
  }

  for (const prop in query) {
    // Ignore fields that remain set on deleted docs
    if (
      prop === '_id' ||
      prop === '_v' ||
      prop === '_o' ||
      prop === '_m' || (
        prop[0] === '_' &&
        prop[1] === 'm' &&
        prop[2] === '.'
      )
    ) continue
    // Top-level operators with special handling in this function
    if (prop === '$and' || prop === '$or') continue
    // When using top-level operators that we don't understand, play it safe
    if (prop[0] === '$') return true
    if (!couldMatchNull(query[prop])) return false
  }

  if (Object.prototype.hasOwnProperty.call(query, '$or')) {
    if (Array.isArray(query.$or)) {
      for (const clause of query.$or) {
        if (deletedDocCouldSatisfyQuery(clause)) return true
      }
      return false
    } else {
      // Malformed? Play it safe.
      return true
    }
  }

  return true
}

function couldMatchNull (clause) {
  if (
    typeof clause === 'number' ||
    typeof clause === 'boolean' ||
    typeof clause === 'string'
  ) {
    return false
  } else if (clause === null) {
    return true
  } else if (isPlainObject(clause)) {
    // Mongo interprets clauses with multiple properties with an
    // implied 'and' relationship, e.g. {$gt: 3, $lt: 6}. If every
    // part of the clause could match null then the full clause could
    // match null.
    for (const prop in clause) {
      const value = clause[prop]
      if (prop === '$in' && Array.isArray(value)) {
        if (!value.some(item => item === null)) return false
      } else if (prop === '$ne') {
        if (value === null) return false
      } else if (prop === '$exists') {
        if (value) return false
      } else if (prop === '$gt' || prop === '$gte' || prop === '$lt' || prop === '$lte') {
        if (value !== null) return false
      }
      // else: not sure what to do with this part of the clause; assume it
      // could match null.
    }
    // All parts of the clause could match null.
    return true
  } else {
    // Not a POJO, string, number, or boolean. Not sure what it is,
    // but play it safe.
    return true
  }
}

function isPlainObject (value) {
  return (
    typeof value === 'object' && value !== null && (
      Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null
    )
  )
}
