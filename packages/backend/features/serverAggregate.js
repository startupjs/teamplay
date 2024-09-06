import _serverAggregate from '@teamplay/server-aggregate'
import { isAggregationFunction } from '@teamplay/utils/aggregation'

export default function serverAggregate (backend, { models = {}, ...options } = {}) {
  _serverAggregate(backend, options)

  for (const modelPattern in models) {
    for (const aggregationName in models[modelPattern]) {
      const aggregation = models[modelPattern][aggregationName]
      if (!isAggregationFunction(aggregation)) continue
      // support only top-level collections
      const collection = modelPattern
      if (/\./.test(collection)) throw Error(ERRORS.onlyTopLevelCollections(modelPattern, aggregationName))
      backend.addAggregate(
        collection,
        aggregationName,
        (queryParams, shareRequest) => {
          const session = shareRequest.agent.connectSession || {}
          const isServer = shareRequest.agent.stream?.isServer
          // should match the context in teamplay/orm/sub.js
          const context = { session, collection, isServer }
          return aggregation(queryParams, context)
        }
      )
    }
  }

  console.log('✓ Security: only server-side aggregations are allowed')
}

const ERRORS = {
  onlyTopLevelCollections: (modelPattern, aggregationName) => `
    serverAggregate: you can only define aggregations in the top-level collection models
      (i.e. 'model/items.js')
      Found aggregation '${aggregationName}' in '${modelPattern}'.
      Move it to the top-level collection model: 'models/${modelPattern.split('.')[0]}.js'
  `
}
