import createSockjsServer from './sockjsServer.js'
import createWebsocketServer from './websocketServer.js'
import { DEFAULT_PATH } from '../constants.js'

export { DEFAULT_PATH }

export default function createChannel (backend, {
  session,
  path = DEFAULT_PATH,
  ping = true,
  pingInterval = 30000,
  authorize
} = {}) {
  authorize ??= defaultAuthorize

  const { sockjsMiddleware } = createSockjsServer({ backend, path, authorize })
  const { websocketUpgrade, websocketServer } = createWebsocketServer({ backend, path, authorize, ping, pingInterval })

  backend.use('connect', function (shareRequest, next) {
    const req = shareRequest.req
    const agent = shareRequest.agent

    agent.connectSession ??= (req.connectSession ?? req.session)

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
