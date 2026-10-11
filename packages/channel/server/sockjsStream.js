import { Duplex } from 'stream'
import { isDisconnectError } from './isDisconnectError.js'

const OPEN = 1 // WebSocket.OPEN

/**
 * @param {EventEmitter} client is a SockJS client session for each
 *   browser window/tab which connects to the server
 * @param {ClientStream} ClientStream is a stream class that is used to create
 *   the stream. It is passed in as a parameter to allow for different stream implementations
 * @return {Duplex} stream
 */
// Messages handed to ShareDB per turn of the event loop: SockJS hands over a
// whole POST's messages at once, and each costs the receive pipeline some
// work, so a POST is processed a chunk at a time and other connections are
// served in between.
const MESSAGES_PER_TURN = 100

export default function createSockjsStream (client, maxMessageSize = Infinity) {
  const stream = new SockJsClientStream(client)
  const queue = []
  let next = 0
  let scheduled = false
  let closed = false

  client.on('data', function onMessage (message) {
    if (closed) return
    // one message of the POST's batch: capped as a websocket frame is. A
    // client refuses such a message before sending it, so this one comes
    // from a client with a higher limit (or none): close with the code the
    // client reads as "message too big"
    if (typeof message === 'string' && Buffer.byteLength(message) > maxMessageSize) {
      closed = true
      queue.length = 0
      client.close(1009, 'Message too big')
      return
    }
    queue.push(message)
    if (!scheduled) {
      scheduled = true
      setImmediate(drain)
    }
  })

  function drain () {
    scheduled = false
    const end = Math.min(queue.length, next + MESSAGES_PER_TURN)
    for (; next < end && !closed; next++) {
      const message = queue[next]
      queue[next] = undefined
      let data
      try {
        data = JSON.parse(message)
      } catch (err) {
        // JSON.parse()'s error quotes the message: not logged
        closed = true
        stream.emit('error', new Error('A message is not valid JSON'))
        return
      }
      stream.push(data)
    }
    if (closed) return
    if (next < queue.length) {
      scheduled = true
      setImmediate(drain)
    } else {
      queue.length = 0
      next = 0
    }
  }

  client.on('close', function () {
    closed = true
    queue.length = 0
    // Signal data writing is complete. Emits the 'end' event
    stream.push(null)
  })

  return stream
}

export class SockJsClientStream extends Duplex {
  static _type = 'sockjs'

  constructor (client) {
    super({ objectMode: true })
    this.client = client

    this.on('error', err => {
      // log stream type and error
      console.warn(`[@teamplay/channel] ${this.constructor._type} client message stream error`, err)
      this._stopClient()
    })

    // The server ended the writable stream. Triggered by calling stream.end()
    // in agent.close()
    this.on('finish', () => {
      this._stopClient()
    })
  }

  _read () {}

  _write (chunk, encoding, cb) {
    // Silently drop messages after the session is closed
    if (this.client.readyState !== OPEN) return cb()
    try {
      this.client.write(JSON.stringify(chunk))
    } catch (err) {
      // a session that went away meanwhile is not an error (see isDisconnectError)
      if (!isDisconnectError(err, this.client.readyState === OPEN)) {
        console.error(`[@teamplay/channel] ${this.constructor._type} send:`, err)
      }
    }
    cb()
  }

  _stopClient () {
    this.client.close()
  }
}
