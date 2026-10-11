import SockJS from './SockJS.cjs'
import getByteLength from './byteLength.cjs'
import { DEFAULT_MAX_MESSAGE_SIZE, DEFAULT_PATH, XHR_BATCH_BYTES, XHR_BATCH_MESSAGES } from './constants.js'

export { DEFAULT_MAX_MESSAGE_SIZE, DEFAULT_PATH }

// the xhr-polling fallback batches within the limits the server enforces
SockJS.setBatchLimits({ bytes: XHR_BATCH_BYTES, messages: XHR_BATCH_MESSAGES })

// The server closes a connection that sent a message larger than its
// maxMessageSize: a websocket with this code, the xhr-polling fallback answers
// the POST with 413 (SockJS then closes with 1006 and this reason)
const MESSAGE_TOO_BIG_CODE = 1009
// the request messages whose reply a ShareDB client waits for (so a refused
// one is answered with an error); unsubscribe/presence/ping are fire-and-forget
const REPLY_ACTIONS = new Set(['hs', 'op', 'f', 's', 'bf', 'bs', 'qf', 'qs', 'nf', 'nt'])
const XHR_TOO_BIG_REASON = /\b413\b/
// how long the client waits for the SockJS info path before it treats the
// server as unreachable and reconnects
const XHR_PROBE_TIMEOUT = 10000

export default class Socket {
  constructor ({
    path = DEFAULT_PATH,
    baseUrl = guessBaseUrl(),
    getConnectionUrl,
    reconnect = true,
    allowXhrFallback = false,
    forceXhrFallback = false,
    timeout = 10000,
    timeoutIncrement = 10000,
    // the largest message sent to the server, in bytes (set it to the server's
    // maxMessageSize); a larger one is not sent and its request fails
    maxMessageSize = DEFAULT_MAX_MESSAGE_SIZE,
    // how long to wait for the SockJS info path before treating the server as
    // unreachable (see _checkXhrServed)
    xhrProbeTimeout = XHR_PROBE_TIMEOUT
  } = {}) {
    getConnectionUrl ??= getDefaultConnectionUrl
    this._reconnect = reconnect
    this._maxMessageSize = maxMessageSize
    this._xhrProbeTimeout = xhrProbeTimeout
    // the length of the longest message sent since the connection opened
    this._longestSent = 0
    this._timeout = timeout
    this._timeoutIncrement = timeoutIncrement
    // Resolve the connection URL lazily on every open() rather than once here,
    // so each (re)connect attempt can pick up fresh connection params - most
    // importantly a rotated/reissued auth token carried in the URL. Otherwise a
    // socket created with a token that the server later rejects would retry the
    // same dead URL forever.
    this._getConnectionUrl = () => getConnectionUrl({ baseUrl, path, getDefaultConnectionUrl })
    this._allowXhrFallback = forceXhrFallback || allowXhrFallback
    this._useXhrFallback = forceXhrFallback

    this._messageQueue = []
    this._connectedOnce = false
    this._attemptNum = 0

    this.open()

    function getDefaultConnectionUrl () {
      if (typeof path !== 'string') throw Error(ERRORS.noRoute)
      if (typeof baseUrl !== 'string') throw Error(ERRORS.noBaseUrl)
      baseUrl = baseUrl.replace(/\/$/, '')
      return baseUrl + path
    }
  }

  open () {
    // whether this attempt reached the open state
    this._opened = false
    this._url = this._getConnectionUrl()
    if (this._useXhrFallback) {
      this._type = 'xhr'
      this._url = this._url.replace(/^ws/, 'http')
      this._socket = new SockJS(this._url, undefined, { transports: 'xhr-polling' })
    } else {
      this._type = 'websocket'
      this._url = this._url.replace(/^http/, 'ws')
      this._socket = new WebSocket(this._url)
    }

    this._syncState()

    this._socket.onmessage = this._onmessage.bind(this)
    this._socket.onopen = this._onopen.bind(this)
    this._socket.onclose = this._onclose.bind(this)
    this._socket.onerror = this._onerror.bind(this)
  }

  _onmessage (message) {
    this._syncState()
    this.onmessage?.(message)
  }

  _onopen (event) {
    this._opened = true
    this._attemptNum = 0
    this._connectedOnce = true
    this._longestSent = 0

    this._syncState()
    this._flushQueue()

    this.onopen?.(event)
  }

  _onclose (event) {
    this._syncState()

    this.onclose?.(event)

    // The xhr-polling fallback never opened: the server may not serve it
    // (production servers do not by default). Ask it before trying again
    if (this._type === 'xhr' && !this._opened && typeof fetch === 'function') {
      return this._checkXhrServed(event)
    }

    this._afterClose(event)
  }

  _afterClose (event) {
    if (!this._useXhrFallback && this._allowXhrFallback && !this._connectedOnce) {
      this._useXhrFallback = true
      return this.open()
    }

    const tooBig = isMessageTooBigClose(event, this._type)
    if (tooBig) this._onMessageTooBig()

    if (this._reconnect && (tooBig || !event.wasClean)) {
      setTimeout(() => this.reconnect(), this._getTimeout())
    }
    this._attemptNum++
  }

  // The server's maxMessageSize is lower than this socket's: the message that
  // made it close the connection was the longest one sent on it or a shorter
  // one, and ShareDB sends it again after the reconnect. Refusing here every
  // message at least that long ends the loop: its request fails instead. On
  // the xhr-polling fallback as on a websocket (a POST is cut to the server's
  // batch limits, so a refusal is about one message there too).
  _onMessageTooBig () {
    const longest = this._longestSent
    if (longest > 0 && longest - 1 < this._maxMessageSize) {
      this._maxMessageSize = longest - 1
    }
    console.error(ERRORS.closedTooBig(this._type, this._maxMessageSize))
  }

  // A 404 from the SockJS info path means the server does not serve the
  // xhr-polling fallback: say so once and connect with the websocket at once
  // (it is a different transport, not a retry), using it from now on. Anything
  // else (the server is down) goes on as before.
  _checkXhrServed (event) {
    const infoUrl = this._url.replace(/\/$/, '') + '/info?t=' + Date.now()
    // a server that accepts TCP but never answers must not wedge reconnection:
    // time the probe out and treat a timeout like the server being down. The
    // timed-out request is aborted, so probes do not pile up against the host
    const controller = typeof AbortController === 'function' ? new AbortController() : undefined
    let timer
    const timeout = new Promise(resolve => { timer = setTimeout(() => resolve('timeout'), this._xhrProbeTimeout) })
    if (timer && typeof timer.unref === 'function') timer.unref()
    Promise.race([
      fetch(infoUrl, controller && { signal: controller.signal })
        .then(response => response.status === 404 ? 'notServed' : 'served', () => 'down'),
      timeout
    ]).then(outcome => {
      clearTimeout(timer)
      if (outcome === 'timeout') controller?.abort()
      if (outcome === 'notServed') {
        this._useXhrFallback = false
        this._allowXhrFallback = false
        console.error(ERRORS.xhrNotServed(this._url))
        if (this._reconnect) this.reconnect()
        return
      }
      // 'served' (the info path answered, the close was for another reason),
      // 'down' or 'timeout': reconnect as usual
      this._afterClose(event)
    })
  }

  _onerror (err) {
    this._syncState()
    this.onerror?.(err)
  }

  _getTimeout () {
    const base = this._timeout
    const increment = this._timeoutIncrement * this._attemptNum
    const maxTimeout = base + increment
    return getRandom(maxTimeout / 3, maxTimeout)
  }

  _flushQueue () {
    while (this._messageQueue.length !== 0) {
      const data = this._messageQueue.shift()
      this._send(data)
    }
  }

  _send (data) {
    if (data.length > this._longestSent) this._longestSent = data.length
    this._socket.send(data)
  }

  send (data) {
    if (typeof data !== 'string') data = JSON.stringify(data)
    if (isLargerThan(data, this._maxMessageSize)) return this._refuse(data)
    if (this._socket.readyState === this.OPEN && this._messageQueue.length === 0) {
      this._send(data)
    } else {
      this._messageQueue.push(data)
    }
  }

  // A message the server would refuse (closing the connection) is not sent.
  // Its request fails the way ShareDB's server fails a request: the request
  // comes back with an error
  _refuse (data) {
    const size = getByteLength(data)
    console.error(ERRORS.messageTooBig(size, this._maxMessageSize))
    let reply
    try {
      reply = JSON.parse(data)
    } catch (err) {
      return
    }
    if (!reply || typeof reply !== 'object' || Array.isArray(reply)) return
    // Only a request the server would answer gets a synthetic failure reply;
    // a fire-and-forget message (unsubscribe, presence, ping) is dropped, so
    // the client is not handed a reply it never waits for.
    if (!REPLY_ACTIONS.has(reply.a)) return
    reply.error = {
      code: 'ERR_MESSAGE_TOO_BIG',
      message: `The message is ${size} bytes, larger than maxMessageSize (${this._maxMessageSize} bytes)`
    }
    setTimeout(() => this._onmessage({ data: reply }))
  }

  close () {
    this._socket.close()
  }

  _syncState () {
    this.readyState = this._socket.readyState
  }

  reconnect () {
    if (this.readyState === this.CLOSED) {
      this.open()
    }
  }
}

Object.assign(Socket.prototype, {
  // ShareJS constants
  canSendWhileConnecting: true,
  canSendJSON: true,

  // WebSocket constants
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3
})

function getRandom (min, max) {
  return Math.random() * (max - min) + min
}

function isMessageTooBigClose (event, type) {
  if (event?.code === MESSAGE_TOO_BIG_CODE) return true
  return type === 'xhr' && XHR_TOO_BIG_REASON.test(String(event?.reason ?? ''))
}

// Whether the UTF-8 encoding of `text` is longer than `limit` bytes. A UTF-16
// code unit takes 1 to 3 bytes, so only a text between limit / 3 and limit
// code units long is measured.
function isLargerThan (text, limit) {
  if (text.length * 3 <= limit) return false
  if (text.length > limit) return true
  return getByteLength(text) > limit
}

function guessBaseUrl () {
  let baseUrl
  if (typeof window !== 'undefined') baseUrl = window.location?.origin
  if (!baseUrl) throw Error(ERRORS.noBaseUrl)
  return baseUrl
}

// Maybe need to use reconnection timing algorithm from
// http://blog.johnryding.com/post/78544969349/how-to-reconnect-web-sockets-in-a-realtime-web-app

const ERRORS = {
  xhrNotServed: url => `[@teamplay/channel] The server does not serve the xhr-polling fallback at ${url} ` +
    '(off by default in production: see allowXhrFallback / TEAMPLAY_ALLOW_XHR_FALLBACK in @teamplay/channel). ' +
    'Connecting with a websocket instead.',
  messageTooBig: (size, limit) => `[@teamplay/channel] A message of ${size} bytes was not sent: it is larger than ` +
    `maxMessageSize (${limit} bytes). Its request fails with ERR_MESSAGE_TOO_BIG. The server's maxMessageSize ` +
    '(initConnection() / createChannel() option) and the client\'s (connect() option) should be the same.',
  closedTooBig: (type, limit) => '[@teamplay/channel] The server closed the connection: a message sent over it was ' +
    `larger than the server's maxMessageSize${type === 'xhr' ? ' (with the xhr-polling fallback, one POST carries several messages)' : ''}. ` +
    `Reconnecting; messages larger than ${limit} bytes are not sent any more. Set the client's maxMessageSize ` +
    '(connect() option) to the server\'s (initConnection() / createChannel() option).',
  noBaseUrl: '[@teamplay/channel] No baseUrl provided to connect to the server',
  noRoute: '[@teamplay/channel] Route must be a string. If you want to connect to the root, pass an empty string'
}
