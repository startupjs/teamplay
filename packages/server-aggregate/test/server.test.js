import assert from 'node:assert/strict'
import test from 'node:test'

import serverAggregate from '../server.js'

test('passes params, context and normalized lookup mutation to shouldRequery', async () => {
  const calls = []
  const { backend, runQuery } = setup()
  backend.addAggregate(
    'courses',
    '_playerOutline',
    ({ courseId }) => [{
      $match: { _id: courseId }
    }, {
      $lookup: { from: 'stores', localField: '_id', foreignField: 'courseId', as: 'stores' }
    }],
    {
      shouldRequery: input => {
        calls.push(input)
        return input.mutation.after?.courseId === input.params.courseId
      }
    }
  )
  const request = clientRequest({
    $aggregationName: '_playerOutline',
    $params: { courseId: 'course-1' }
  })

  await runQuery(request)

  const skip = request.options.skipPoll('courses', 'store-1', { d: 'store-1' }, request.query, {
    collection: 'stores',
    operationType: 'update',
    fullDocumentBeforeChange: { _id: 'store-1', courseId: 'course-2' },
    fullDocument: { _id: 'store-1', courseId: 'course-1' }
  })

  assert.equal(skip, false)
  assert.deepEqual(calls, [{
    collection: 'stores',
    mutation: {
      id: 'store-1',
      operationType: 'update',
      before: { _id: 'store-1', courseId: 'course-2' },
      after: { _id: 'store-1', courseId: 'course-1' }
    },
    params: { courseId: 'course-1' },
    context: {
      session: { userId: 'session-user' },
      collection: 'courses',
      isServer: false
    }
  }])
})

test('skips polling when shouldRequery marks a mutation as irrelevant', async () => {
  const { backend, runQuery } = setup()
  backend.addAggregate('courses', '_playerOutline', () => [], {
    shouldRequery: () => false
  })
  const request = clientRequest({ $aggregationName: '_playerOutline' })

  await runQuery(request)

  assert.equal(request.options.skipPoll('courses', 'store-1', { d: 'store-1' }, request.query, {
    collection: 'stores',
    operationType: 'update',
    fullDocumentBeforeChange: {},
    fullDocument: {}
  }), true)
})

test('fails open when mutation metadata is absent or shouldRequery throws', async () => {
  const errors = []
  const { backend, runQuery } = setup()
  backend.onAggregationShouldRequeryError = (error, details) => errors.push({ error, details })
  backend.addAggregate('courses', '_playerOutline', () => [], {
    shouldRequery: () => {
      throw new Error('broken policy')
    }
  })
  const request = clientRequest({ $aggregationName: '_playerOutline' })

  await runQuery(request)

  assert.equal(request.options.skipPoll('courses', 'course-1', { d: 'course-1' }, request.query), false)
  assert.equal(request.options.skipPoll('courses', 'course-1', { d: 'course-1' }, request.query, {
    collection: 'courses',
    operationType: 'update',
    fullDocumentBeforeChange: {},
    fullDocument: {}
  }), false)
  assert.equal(errors.length, 1)
  assert.equal(errors[0].error.message, 'broken policy')
})

test('fails open when shouldRequery does not return a boolean', async () => {
  const errors = []
  const { backend, runQuery } = setup()
  backend.onAggregationShouldRequeryError = error => errors.push(error)
  backend.addAggregate('courses', '_playerOutline', () => [], {
    shouldRequery: () => Promise.resolve(true)
  })
  const request = clientRequest({ $aggregationName: '_playerOutline' })

  await runQuery(request)

  assert.equal(request.options.skipPoll('courses', 'course-1', {}, request.query, {
    collection: 'courses',
    operationType: 'update'
  }), false)
  assert.equal(errors.length, 1)
  assert.match(errors[0].message, /must return a boolean/)
})

test('keeps an existing skipPoll decision ahead of shouldRequery', async () => {
  let policyCalls = 0
  const { backend, runQuery } = setup()
  backend.addAggregate('courses', '_playerOutline', () => [], {
    shouldRequery: () => {
      policyCalls++
      return true
    }
  })
  const request = clientRequest({ $aggregationName: '_playerOutline' })
  request.options.skipPoll = () => true

  await runQuery(request)

  assert.equal(request.options.skipPoll('courses', 'course-1', {}, request.query, {
    collection: 'courses',
    operationType: 'update'
  }), true)
  assert.equal(policyCalls, 0)
})

test('applies server-defined polling options to the resolved query', async () => {
  const { backend, runQuery } = setup()
  backend.addAggregate('courses', '_playerOutline', () => [], {
    pollDebounce: 15,
    pollInterval: 0
  })
  const request = clientRequest({ $aggregationName: '_playerOutline' })

  await runQuery(request)

  assert.equal(request.options.pollDebounce, 15)
  assert.equal(request.options.pollInterval, 0)
})

test('rejects invalid live query options at registration time', () => {
  const { backend } = setup()

  assert.throws(
    () => backend.addAggregate('courses', 'bad-policy', () => [], { shouldRequery: true }),
    /shouldRequery must be a function/
  )
  assert.throws(
    () => backend.addAggregate('courses', 'bad-debounce', () => [], { pollDebounce: -1 }),
    /pollDebounce must be a non-negative finite number/
  )
  assert.throws(
    () => backend.addAggregate('courses', 'bad-interval', () => [], { pollInterval: Infinity }),
    /pollInterval must be a non-negative finite number/
  )
})

test('keeps named aggregation registries isolated between backend instances', async () => {
  const first = setup()
  const second = setup()
  first.backend.addAggregate('courses', '_outline', () => [{ $match: { source: 'first' } }])
  second.backend.addAggregate('courses', '_outline', () => [{ $match: { source: 'second' } }])
  const firstRequest = clientRequest({ $aggregationName: '_outline' })
  const secondRequest = clientRequest({ $aggregationName: '_outline' })

  await first.runQuery(firstRequest)
  await second.runQuery(secondRequest)

  assert.deepEqual(firstRequest.query, { $aggregate: [{ $match: { source: 'first' } }] })
  assert.deepEqual(secondRequest.query, { $aggregate: [{ $match: { source: 'second' } }] })
})

test('rejects direct client aggregations by default', async () => {
  const { runQuery } = setup()

  await assert.rejects(
    runQuery(clientRequest({ $aggregate: [{ $match: { active: true } }] })),
    error => error.name === 'ShareDBAccessError'
  )
})

test('allows direct client aggregations only with explicit migration opt-in', async () => {
  const { runQuery } = setup({ allowDirectClientAggregations: true })
  const request = clientRequest({ $aggregate: [{ $match: { active: true } }] })

  await runQuery(request)

  assert.deepEqual(request.query, { $aggregate: [{ $match: { active: true } }] })
})

test('does not let migration opt-in bypass named aggregation resolution', async () => {
  const { backend, runQuery } = setup({ allowDirectClientAggregations: true })
  backend.addAggregate('courses', '_outline', () => [{ $match: { trusted: true } }])
  const request = clientRequest({ $aggregationName: '_outline' })

  await runQuery(request)

  assert.deepEqual(request.query, { $aggregate: [{ $match: { trusted: true } }] })
})

function setup (options) {
  let queryMiddleware
  const backend = {
    use (action, middleware) {
      if (action === 'query') queryMiddleware = middleware
    }
  }

  serverAggregate(backend, options)

  return {
    backend,
    runQuery (request) {
      return new Promise((resolve, reject) => {
        queryMiddleware(request, error => error ? reject(error) : resolve())
      })
    }
  }
}

function clientRequest (query) {
  return {
    collection: 'courses',
    query,
    options: {},
    agent: {
      connectSession: { userId: 'session-user' },
      stream: { isServer: false }
    }
  }
}
