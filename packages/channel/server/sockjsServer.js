import sockjs from '@teamplay/sockjs'
import crypto from 'crypto'
import createSockjsStream from './sockjsStream.js'
import { XHR_BATCH_BYTES, XHR_BATCH_MESSAGES, XHR_ESCAPE_FACTOR } from '../constants.js'

export default function createSockjsServer ({ backend, path, authorize, maxMessageSize }) {
  const sockjsServer = sockjs.createServer({ prefix: path, transports: ['xhr-polling'] })
  // a POST carrying one message may be as large as that message escaped
  const singleMessageBytes = maxMessageSize * XHR_ESCAPE_FACTOR + 4
  const maxBodyBytes = Math.max(XHR_BATCH_BYTES, singleMessageBytes)

  let syncTempConnectSession
  let syncReq
  // SockJS session id (from the URL) -> its connection
  const clientsBySessionId = new Map()

  sockjsServer.on('connection', function (client) {
    client.id = crypto.randomBytes(16).toString('hex')

    let rejected = false
    let rejectReason

    function reject (reason) {
      rejected = true
      if (reason) rejectReason = reason
    }

    client.connectSession = syncTempConnectSession
    client.session = syncTempConnectSession
    syncTempConnectSession = undefined

    const req = syncReq
    syncReq = undefined
    req.connectSession = client.connectSession
    client.upgradeReq = req

    const sessionId = getSessionId(req, path)
    if (sessionId) {
      clientsBySessionId.set(sessionId, client)
      client.once('close', () => {
        if (clientsBySessionId.get(sessionId) === client) clientsBySessionId.delete(sessionId)
      })
    }

    backend.emit('client', client, reject)
    if (rejected) {
      // Tell the client to stop trying to connect
      client.close(1001, rejectReason)
      return
    }

    const stream = createSockjsStream(client, maxMessageSize)

    backend.listen(stream, req)
  })

  async function sockjsMiddleware (req, res, next) {
    if (!new RegExp('^' + path + '(/|\\?|$)').test(req.url)) return next()
    try {
      await authorize(req, { type: 'sockjs' })
    } catch (err) {
      res.statusCode = 403
      return res.end('Unauthorized channel connection')
    }
    if (!limitRequestBody(req, res)) return
    try {
      syncTempConnectSession = req.session
      syncReq = req
      sockjsServer.handler(req, res)
    } catch (err) {
      res.statusCode = 500
      res.end('Error initializing channel connection')
    }
  }

  // SockJS reads a request's body whole, parses it, then hands every message
  // in it to the connection at once. The body is checked while it arrives,
  // against the rules the client follows when it batches (see constants.js):
  // at most XHR_BATCH_MESSAGES messages; more than one message only within
  // XHR_BATCH_BYTES; a single message up to maxMessageSize escaped. A body
  // that breaks them is refused (413) as soon as it does, before SockJS keeps
  // or parses it, and its session is closed as a websocket is for a message
  // too big. Returns false when the request is refused already.
  function limitRequestBody (req, res) {
    const declaredLength = Number(req.headers['content-length'])
    if (declaredLength > maxBodyBytes) {
      refuseTooBig(req, res)
      return false
    }
    const scanner = createBatchScanner()
    let received = 0
    req.on('data', function countBody (chunk) {
      received += chunk.length
      scanner.feed(chunk)
      const messages = scanner.messages()
      if (
        received <= maxBodyBytes &&
        messages <= XHR_BATCH_MESSAGES &&
        (messages < 2 || received <= XHR_BATCH_BYTES)
      ) return
      req.removeListener('data', countBody)
      refuseTooBig(req, res)
    })
    return true
  }

  function refuseTooBig (req, res) {
    // no more of the body is read (nor kept by SockJS)
    req.pause()
    clientsBySessionId.get(getSessionId(req, path))?.close(1009, 'Message too big')
    if (!res.headersSent) {
      res.writeHead(413, { 'Content-Type': 'text/plain; charset=UTF-8', Connection: 'close' })
    }
    // the client reads the answer before the connection goes (it may still
    // be sending): paused, the request costs nothing meanwhile
    res.end('Message too big', () => {
      setTimeout(() => req.destroy(), REFUSED_REQUEST_LINGER).unref?.()
    })
  }

  return { sockjsMiddleware }
}

// With the xhr-polling fallback off: the channel's HTTP paths answer a plain
// 404 themselves (rather than falling through to the app, which would render
// a page for them); everything else goes on.
export function createDisabledSockjsMiddleware ({ path }) {
  // async like the enabled middleware, so both have one type
  return async function sockjsDisabledMiddleware (req, res, next) {
    if (!new RegExp('^' + path + '(/|\\?|$)').test(req.url)) return next()
    res.statusCode = 404
    res.setHeader('Content-Type', 'text/plain; charset=UTF-8')
    res.end('Not Found')
  }
}

const REFUSED_REQUEST_LINGER = 1000

// Counts the messages of a SockJS POST body (a JSON array of JSON strings) as
// its bytes arrive, without parsing it: the commas between the array's
// elements, outside strings. JSON's structural characters are ASCII, so a
// multi-byte UTF-8 character never looks like one. It never undercounts: any
// element, string or not, is counted.
function createBatchScanner () {
  let depth = 0
  let inString = false
  let escaped = false
  let commas = 0
  let content = false
  return {
    feed (chunk) {
      for (let i = 0; i < chunk.length; i++) {
        const byte = chunk[i]
        if (inString) {
          if (escaped) escaped = false
          else if (byte === 0x5c) escaped = true // \
          else if (byte === 0x22) inString = false // "
          continue
        }
        if (byte === 0x22) { // "
          inString = true
          content = true
        } else if (byte === 0x5b || byte === 0x7b) { // [ {
          if (depth > 0) content = true
          depth++
        } else if (byte === 0x5d || byte === 0x7d) { // ] }
          depth--
        } else if (byte === 0x2c) { // ,
          if (depth === 1) commas++
        } else if (depth > 0 && byte > 0x20) {
          content = true
        }
      }
    },
    messages () {
      return content ? commas + 1 : 0
    }
  }
}

// '<path>/<server>/<session>/<transport>' (SockJS URLs)
function getSessionId (req, path) {
  const url = req?.url
  if (typeof url !== 'string' || !url.startsWith(path)) return
  const pathname = url.slice(path.length).split('?')[0]
  const match = /^\/[^/.]+\/([^/.]+)\/[^/.]+\/?$/.exec(pathname)
  return match?.[1]
}
