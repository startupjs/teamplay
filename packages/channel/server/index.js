import createSockjsServer, { createDisabledSockjsMiddleware } from './sockjsServer.js'
import createWebsocketServer from './websocketServer.js'
import { DEFAULT_MAX_MESSAGE_SIZE, DEFAULT_PATH } from '../constants.js'

export { DEFAULT_MAX_MESSAGE_SIZE, DEFAULT_PATH }

export default function createChannel (backend, {
  session,
  path = DEFAULT_PATH,
  ping = true,
  pingInterval = 30000,
  authorize,
  // the largest message a client may send, in bytes: a larger one closes its
  // connection (a websocket message; with the xhr-polling fallback, a POST).
  // An explicit option wins; otherwise the TEAMPLAY_MAX_MESSAGE_SIZE
  // environment variable, if set; otherwise the 16 MiB default (for
  // frameworks that do not pass channel options through)
  maxMessageSize = getDefaultMaxMessageSize(),
  // compress websocket messages (permessage-deflate), as ws 1.x did by default
  perMessageDeflate = true,
  // serve the xhr-polling fallback (SockJS) for clients that cannot use a
  // websocket. Default: on outside production, off in production unless the
  // TEAMPLAY_ALLOW_XHR_FALLBACK environment variable turns it on (for
  // frameworks that do not pass channel options through)
  allowXhrFallback = getDefaultAllowXhrFallback()
} = {}) {
  authorize ??= defaultAuthorize
  if (!(Number.isSafeInteger(maxMessageSize) && maxMessageSize > 0)) {
    throw Error(`[@teamplay/channel] maxMessageSize must be a positive integer (bytes). Got: ${maxMessageSize}`)
  }

  const sockjsMiddleware = allowXhrFallback
    ? createSockjsServer({ backend, path, authorize, maxMessageSize }).sockjsMiddleware
    : createDisabledSockjsMiddleware({ path })
  const { websocketUpgrade, websocketServer } = createWebsocketServer({ backend, path, authorize, ping, pingInterval, maxMessageSize, perMessageDeflate })

  backend.use('connect', function (shareRequest, next) {
    const req = shareRequest.req
    const agent = shareRequest.agent

    // a server-side backend.connect() comes without a request
    agent.connectSession ??= (req?.connectSession ?? req?.session)

    next()
  })

  return { middleware: sockjsMiddleware, upgrade: websocketUpgrade, wss: websocketServer }

  async function defaultAuthorize (req) {
    return await new Promise((resolve, reject) => {
      if (!session) return resolve(true)
      session(req, {}, err => {
        if (err) return reject(err)
        resolve(true)
      })
    })
  }
}

// The TEAMPLAY_MAX_MESSAGE_SIZE environment variable (a positive integer
// number of bytes, in plain decimal digits) when set, otherwise the 16 MiB
// default. Anything else (hex, exponents, signs, spaces, separators) throws
// rather than being read as some other number
export function getDefaultMaxMessageSize (env = process.env) {
  const value = env.TEAMPLAY_MAX_MESSAGE_SIZE
  if (value != null && value !== '') {
    const bytes = /^[0-9]+$/.test(value) ? Number(value) : NaN
    if (Number.isSafeInteger(bytes) && bytes > 0) return bytes
    throw Error(`[@teamplay/channel] TEAMPLAY_MAX_MESSAGE_SIZE must be a positive integer (bytes, decimal digits only). Got: ${JSON.stringify(value)}`)
  }
  return DEFAULT_MAX_MESSAGE_SIZE
}

// The env variable, when set, decides ('1'/'true' on, '0'/'false' off);
// otherwise the xhr-polling fallback is served everywhere but in production
export function getDefaultAllowXhrFallback (env = process.env) {
  const value = env.TEAMPLAY_ALLOW_XHR_FALLBACK
  if (value != null && value !== '') return value === '1' || value.toLowerCase() === 'true'
  return env.NODE_ENV !== 'production'
}
