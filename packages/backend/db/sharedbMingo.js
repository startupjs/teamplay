import ShareDbMingo from 'sharedb-mingo-memory'

// patch ShareDbMingo to properly support aggregations
let patched
function patchSharedbMingoAggregations () {
  if (patched) return
  patched = true
  const oldCanPollDoc = ShareDbMingo.prototype.canPollDoc
  ShareDbMingo.prototype.canPollDoc = function (collection, query) {
    if (query.hasOwnProperty('$aggregate')) return false // eslint-disable-line no-prototype-builtins
    return oldCanPollDoc.call(this, collection, query)
  }
}

patchSharedbMingoAggregations()

export default ShareDbMingo
