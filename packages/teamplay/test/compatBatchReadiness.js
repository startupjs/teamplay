import { describe, it } from 'mocha'
import { strictEqual } from 'assert'
import { __COMPAT_BATCH_READY__ } from '../orm/Compat/hooksCompat.js'
import { hashQuery, QUERIES } from '../orm/Query.js'
import { set as _set, del as _del } from '../orm/dataTree.js'

describe('Compat batch query readiness', () => {
  it('aggregate query is ready when $queries.<hash>.docs exists (including empty array)', () => {
    const collection = 'stores'
    const query = { $aggregate: [{ $group: { _id: null, count: { $sum: 1 } } }] }
    const hash = hashQuery(collection, query)
    const idsSegments = [QUERIES, hash, 'ids']
    const docsSegments = [QUERIES, hash, 'docs']
    const extraSegments = [QUERIES, hash, 'extra']
    const querySegments = [QUERIES, hash]

    try {
      _del(querySegments)
      _set(docsSegments, [])
      strictEqual(
        __COMPAT_BATCH_READY__.isQueryReady(collection, idsSegments, docsSegments, extraSegments, querySegments, true),
        true
      )
    } finally {
      _del(querySegments)
    }
  })

  it('aggregate query is ready when only extra exists', () => {
    const collection = 'stores'
    const query = { $aggregate: [{ $group: { _id: null, count: { $sum: 1 } } }] }
    const hash = hashQuery(collection, query)
    const idsSegments = [QUERIES, hash, 'ids']
    const docsSegments = [QUERIES, hash, 'docs']
    const extraSegments = [QUERIES, hash, 'extra']
    const querySegments = [QUERIES, hash]

    try {
      _del(querySegments)
      _set(extraSegments, { total: 1 })
      strictEqual(
        __COMPAT_BATCH_READY__.isQueryReady(collection, idsSegments, docsSegments, extraSegments, querySegments, true),
        true
      )
    } finally {
      _del(querySegments)
    }
  })

  it('non-aggregate query stays strict: ids must exist before query is ready', () => {
    const collection = 'lessons'
    const query = { courseId: 'c1' }
    const hash = hashQuery(collection, query)
    const idsSegments = [QUERIES, hash, 'ids']
    const docsSegments = [QUERIES, hash, 'docs']
    const extraSegments = [QUERIES, hash, 'extra']
    const querySegments = [QUERIES, hash]

    try {
      _del(querySegments)
      strictEqual(
        __COMPAT_BATCH_READY__.isQueryReady(collection, idsSegments, docsSegments, extraSegments, querySegments, false),
        false
      )
      _set(idsSegments, ['l1'])
      _set([collection, 'l1'], { _id: 'l1', stageIds: [] })
      strictEqual(
        __COMPAT_BATCH_READY__.isQueryReady(collection, idsSegments, docsSegments, extraSegments, querySegments, false),
        true
      )
    } finally {
      _del(querySegments)
      _del([collection, 'l1'])
    }
  })

  it('null/undefined ids are ignored and do not block readiness', () => {
    const collection = 'lessons'
    const query = { courseId: 'c2' }
    const hash = hashQuery(collection, query)
    const idsSegments = [QUERIES, hash, 'ids']
    const docsSegments = [QUERIES, hash, 'docs']
    const extraSegments = [QUERIES, hash, 'extra']
    const querySegments = [QUERIES, hash]

    try {
      _del(querySegments)
      _set(idsSegments, [null, undefined, 'l2'])
      _set([collection, 'l2'], { _id: 'l2' })
      strictEqual(
        __COMPAT_BATCH_READY__.isQueryReady(collection, idsSegments, docsSegments, extraSegments, querySegments, false),
        true
      )
    } finally {
      _del(querySegments)
      _del([collection, 'l2'])
    }
  })
})
