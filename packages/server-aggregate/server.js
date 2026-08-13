import ShareDBAccessError from './error.js'
import { ACCESS_ERROR_CODES } from './constants.js'

const {
  ERR_ACCESS_ONLY_SERVER_AGGREATE,
  ERR_ACCESS_NO_SERVER_AGGREGATE_NAME,
  ERR_ACCESS_IN_SERVER_QUERY
} = ACCESS_ERROR_CODES

export default (backend, {
  customCheck,
  allowDirectClientAggregations = false
} = {}) => {
  const queries = {}

  backend.addAggregate = (collection, queryName, queryFunction, options = {}) => {
    if (options.shouldRequery !== undefined && typeof options.shouldRequery !== 'function') {
      throw TypeError('addAggregate: options.shouldRequery must be a function')
    }
    validatePollingOption('pollDebounce', options.pollDebounce)
    validatePollingOption('pollInterval', options.pollInterval)
    queries[collection + '.' + queryName] = { queryFunction, options }
  }

  const handleQuery = async (shareRequest) => {
    const { query, collection } = shareRequest

    if (query.$aggregate) {
      const { stream } = shareRequest.agent
      // allow any aggregations initiated from the server code
      if (stream?.isServer && !stream?.checkServerAccess) return
      // Migration mode for applications which already have direct client
      // aggregations. Named aggregations are still resolved on the server.
      if (allowDirectClientAggregations && !query.$aggregationName) return
      // deny any direct aggregations made from the client
      throw new ShareDBAccessError(ERR_ACCESS_ONLY_SERVER_AGGREATE, `
        access denied - only server-queries for $aggregate are allowed from the client
        collection: '${collection}',
        query: \n${JSON.stringify(query, null, 2)}
      `)
    }

    const { $aggregationName: queryName, $params: queryParams = {} } = query
    if (!queryName) return

    const definition = queries[collection + '.' + queryName]

    if (!definition) {
      throw new ShareDBAccessError(
        ERR_ACCESS_NO_SERVER_AGGREGATE_NAME,
        'there is no such server-query, name: ' +
        `'${queryName}', collection: '${collection}'`
      )
    }

    let serverQuery

    try {
      serverQuery = await definition.queryFunction(queryParams, shareRequest)
    } catch (err) {
      throw new ShareDBAccessError(ERR_ACCESS_IN_SERVER_QUERY, err.message)
    }

    if (isString(serverQuery)) throw new ShareDBAccessError(ERR_ACCESS_IN_SERVER_QUERY, serverQuery)

    if (Array.isArray(serverQuery)) serverQuery = { $aggregate: serverQuery }

    if (typeof serverQuery !== 'object') {
      throw new ShareDBAccessError(ERR_ACCESS_IN_SERVER_QUERY, `
        access denied for server aggregation
        {
          collection: '${collection}',
          $aggregationName: '${queryName}'
        }
      `)
    }

    if (customCheck) {
      const customPermissionMessage = await customCheck(shareRequest)
      if (isString(customPermissionMessage)) {
        throw new ShareDBAccessError(ERR_ACCESS_IN_SERVER_QUERY, customPermissionMessage)
      }
    }

    shareRequest.query = serverQuery
    installLiveQueryOptions(backend, shareRequest, definition.options, queryParams)
  }

  backend.use('query', (shareRequest, next) => {
    handleQuery(shareRequest).then(() => {
      next()
    }).catch((err) => {
      next(err)
    })
  })
}

function installLiveQueryOptions (backend, shareRequest, options, params) {
  const { shouldRequery, pollDebounce, pollInterval } = options
  shareRequest.options ||= {}
  if (pollDebounce !== undefined) shareRequest.options.pollDebounce = pollDebounce
  if (pollInterval !== undefined) shareRequest.options.pollInterval = pollInterval
  if (!shouldRequery) return
  const previousSkipPoll = shareRequest.options.skipPoll
  const context = getAggregationContext(shareRequest)

  shareRequest.options.skipPoll = (rootCollection, id, op, query, metadata) => {
    if (previousSkipPoll?.(rootCollection, id, op, query, metadata)) return true
    if (!metadata?.collection || !metadata.operationType) return false

    const input = {
      collection: metadata.collection,
      mutation: {
        id,
        operationType: metadata.operationType,
        before: metadata.fullDocumentBeforeChange,
        after: metadata.fullDocument
      },
      params,
      context
    }

    try {
      const decision = shouldRequery(input)
      if (typeof decision !== 'boolean') {
        throw TypeError('aggregation shouldRequery must return a boolean')
      }
      return !decision
    } catch (error) {
      backend.onAggregationShouldRequeryError?.(error, input)
      return false
    }
  }
}

function getAggregationContext (shareRequest) {
  return {
    session: shareRequest.agent.connectSession || {},
    collection: shareRequest.collection,
    isServer: shareRequest.agent.stream?.isServer
  }
}

function validatePollingOption (name, value) {
  if (value === undefined) return
  if (!Number.isFinite(value) || value < 0) {
    throw TypeError(`addAggregate: options.${name} must be a non-negative finite number`)
  }
}

function isString (obj) {
  return typeof obj === 'string' || obj instanceof String
}
