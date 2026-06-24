import { describe, it } from 'mocha'
import { strictEqual } from 'assert'
import { isQueryReady } from '../src/orm/queryReadiness.js'
import { hashQuery, QUERIES } from '../src/orm/Query.js'
import { AGGREGATIONS } from '../src/orm/Aggregation.js'
import { set as _set, del as _del } from '../src/orm/dataTree.js'

function checkReady (collection, hash, isAggregate, hasExtraResult = false) {
  return isQueryReady(
    collection,
    [QUERIES, hash, 'ids'],
    [QUERIES, hash, 'docs'],
    [QUERIES, hash, 'extra'],
    [AGGREGATIONS, hash],
    isAggregate,
    hasExtraResult
  )
}

describe('Query readiness', () => {
  it('aggregate query is ready when $queries.<hash>.docs exists (including empty array)', () => {
    const collection = 'stores'
    const query = { $aggregate: [{ $group: { _id: null, count: { $sum: 1 } } }] }
    const hash = hashQuery(collection, query)
    const querySegments = [QUERIES, hash]

    try {
      _del(querySegments)
      _set([QUERIES, hash, 'docs'], [])
      strictEqual(checkReady(collection, hash, true), true)
    } finally {
      _del(querySegments)
      _del([AGGREGATIONS, hash])
    }
  })

  it('aggregate query is ready when only extra exists', () => {
    const collection = 'stores'
    const query = { $aggregate: [{ $group: { _id: null, count: { $sum: 1 } } }] }
    const hash = hashQuery(collection, query)
    const querySegments = [QUERIES, hash]

    try {
      _del(querySegments)
      _set([QUERIES, hash, 'extra'], { total: 1 })
      strictEqual(checkReady(collection, hash, true), true)
    } finally {
      _del(querySegments)
      _del([AGGREGATIONS, hash])
    }
  })

  it('aggregate query is not ready when only query root exists', () => {
    const collection = 'stores'
    const query = { $aggregate: [{ $group: { _id: null, count: { $sum: 1 } } }] }
    const hash = hashQuery(collection, query)
    const querySegments = [QUERIES, hash]

    try {
      _del(querySegments)
      _set(querySegments, {})
      strictEqual(checkReady(collection, hash, true), false)
    } finally {
      _del(querySegments)
      _del([AGGREGATIONS, hash])
    }
  })

  it('aggregate query is not ready when only ids exist', () => {
    const collection = 'stores'
    const query = { $aggregate: [{ $group: { _id: null, count: { $sum: 1 } } }] }
    const hash = hashQuery(collection, query)
    const querySegments = [QUERIES, hash]

    try {
      _del(querySegments)
      _set([QUERIES, hash, 'ids'], [null])
      strictEqual(checkReady(collection, hash, true), false)
    } finally {
      _del(querySegments)
      _del([AGGREGATIONS, hash])
    }
  })

  it('extra query ($count) is ready only when extra is materialized', () => {
    const collection = 'messages'
    const query = { chatId: 'c1', $count: true }
    const hash = hashQuery(collection, query)
    const querySegments = [QUERIES, hash]

    try {
      _del(querySegments)
      strictEqual(checkReady(collection, hash, false, true), false)

      _set([QUERIES, hash, 'ids'], ['m1'])
      _set([collection, 'm1'], { _id: 'm1', chatId: 'c1' })
      strictEqual(checkReady(collection, hash, false, true), false)

      _set([QUERIES, hash, 'extra'], 1)
      strictEqual(checkReady(collection, hash, false, true), true)
    } finally {
      _del(querySegments)
      _del([collection, 'm1'])
      _del([AGGREGATIONS, hash])
    }
  })

  it('non-aggregate query stays strict: ids must exist before query is ready', () => {
    const collection = 'lessons'
    const query = { courseId: 'c1' }
    const hash = hashQuery(collection, query)
    const querySegments = [QUERIES, hash]

    try {
      _del(querySegments)
      strictEqual(checkReady(collection, hash, false), false)
      _set([QUERIES, hash, 'ids'], ['l1'])
      _set([collection, 'l1'], { _id: 'l1', stageIds: [] })
      strictEqual(checkReady(collection, hash, false), true)
    } finally {
      _del(querySegments)
      _del([collection, 'l1'])
      _del([AGGREGATIONS, hash])
    }
  })

  it('null/undefined ids are ignored and do not block readiness', () => {
    const collection = 'lessons'
    const query = { courseId: 'c2' }
    const hash = hashQuery(collection, query)
    const querySegments = [QUERIES, hash]

    try {
      _del(querySegments)
      _set([QUERIES, hash, 'ids'], [null, undefined, 'l2'])
      _set([collection, 'l2'], { _id: 'l2' })
      strictEqual(checkReady(collection, hash, false), true)
    } finally {
      _del(querySegments)
      _del([collection, 'l2'])
      _del([AGGREGATIONS, hash])
    }
  })
})
