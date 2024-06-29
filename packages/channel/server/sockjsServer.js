import sockjs from 'sockjs'
import crypto from 'crypto'
import createSockjsStream from './sockjsStream.js'

export default function createSockjsServer ({ backend, path, authorize }) {
  const sockjsServer = sockjs.createServer({ prefix: path, transports: ['xhr-polling'] })

  let syncTempConnectSession
  let syncReq

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

    backend.emit('client', client, reject)
    if (rejected) {
      // Tell the client to stop trying to connect
      client.close(1001, rejectReason)
      return
    }

    const stream = createSockjsStream(client)

    backend.listen(stream, req)
  })

  async function sockjsMiddleware (req, res, next) {
    if (!new RegExp('^' + path + '(/|\\?|$)').test(req.url)) return next()
    try {
      await authorize(req, { type: 'sockjs' })
    } catch (err) {
      return res.status(403).end('Unauthorized channel connection')
    }
    try {
      syncTempConnectSession = req.session
      syncReq = req
      sockjsServer.handler(req, res)
    } catch (err) {
      res.status(500).end('Error initializing channel connection')
    }
  }

  return { sockjsMiddleware }
}
