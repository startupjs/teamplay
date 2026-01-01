// client-side PubSub implementation for cross-tab communication using BroadcastChannel API.
const PubSub = require('sharedb').PubSub

const subscribedChannels = new Map()
const NAMESPACE = 'sharedb-crosstab-pubsub'

function namespaceChannel (channel) {
  return `${NAMESPACE}-${channel}`
}

function CrossTabPubSub ({ onMessage, ...options } = {}) {
  if (!(this instanceof CrossTabPubSub)) return new CrossTabPubSub({ onMessage, ...options })
  PubSub.call(this, options)
  this._onMessage = onMessage
}

module.exports = CrossTabPubSub

CrossTabPubSub.prototype = Object.create(PubSub.prototype)

CrossTabPubSub.prototype.close = function (callback) {
  if (!callback) {
    callback = function (err) {
      if (err) throw err
    }
  }

  PubSub.prototype.close.call(this, (err) => {
    if (err) return callback(err)
    for (const bc of subscribedChannels.values()) bc.close()
    subscribedChannels.clear()
    callback?.()
  })
}

CrossTabPubSub.prototype._subscribe = function (channel, callback) {
  if (subscribedChannels.has(channel)) {
    return callback?.(new AlreadySubscribedError(channel))
  }
  const bc = new BroadcastChannel(namespaceChannel(channel))
  subscribedChannels.set(channel, bc)
  bc.addEventListener('message', ({ data }) => {
    this._emit(channel, data)
    this._onMessage?.(channel, data)
  })
  callback?.()
}

CrossTabPubSub.prototype._unsubscribe = function (channel, callback) {
  const bc = subscribedChannels.get(channel)
  if (!bc) return callback?.(new NotSubscribedError(channel))
  bc.close()
  subscribedChannels.delete(channel)
  callback?.()
}

CrossTabPubSub.prototype._publish = function (channels, data, callback) {
  for (const channel of (channels || [])) {
    if (this.subscribed[channel]) {
      const bc = subscribedChannels.get(channel)
      if (!bc) return callback?.(new NotSubscribedError(channel))
      bc.postMessage(data)
      this._emit(channel, data)
    }
  }
  callback?.()
}

class AlreadySubscribedError extends Error {
  constructor (channel) {
    super(`[sharedb-crosstab-pubsub] Already subscribed to channel: ${channel}`)
    this.name = 'AlreadySubscribedError'
  }
}

class NotSubscribedError extends Error {
  constructor (channel) {
    super(`[sharedb-crosstab-pubsub] Not subscribed to channel: ${channel}`)
    this.name = 'NotSubscribedError'
  }
}
