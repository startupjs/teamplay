import WebSocket from 'ws'
import crypto from 'crypto'
import createWebsocketStream from './websocketStream.js'

export default function createWebsocketServer ({ backend, path, ping, pingInterval, authorize }) {
  const websocketServer = new WebSocket.Server({ noServer: true })

  websocketServer.on('connection', function (client) {
    client.id = crypto.randomBytes(16).toString('hex')

    // Some proxy drop out long connections
    // so do ping periodically to prevent this
    // interval = 30s by default
    if (ping) {
      client.timer = setInterval(function () {
        if (client.readyState === WebSocket.OPEN) {
          client.ping()
        } else {
          clearInterval(client.timer)
        }
      }, pingInterval)
    }

    let rejected = false
    let rejectReason

    function reject (reason) {
      rejected = true
      if (reason) rejectReason = reason
    }

    if (client.upgradeReq.session) client.connectSession = client.upgradeReq.session

    backend.emit('client', client, reject)
    if (rejected) {
      // Tell the client to stop trying to connect
      client.close(1001, rejectReason)
      return
    }

    const stream = createWebsocketStream(client)

    backend.listen(stream, client.upgradeReq)
  })

  async function websocketUpgrade (req, socket, upgradeHead) {
    if (!new RegExp('^' + path + '(/|\\?|$)').test(req.url)) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
      socket.destroy()
      return
    }
    try {
      await authorize(req, { type: 'websocket' })
    } catch (err) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }
    try {
      // copy upgradeHead to avoid retention of large slab buffers used in node core
      const head = Buffer.alloc(upgradeHead.length)
      upgradeHead.copy(head)
      websocketServer.handleUpgrade(req, socket, head, function (client) {
        websocketServer.emit('connection' + req.url, client)
        websocketServer.emit('connection', client)
      })
    } catch (err) {
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n')
      socket.destroy()
    }
  }

  return { websocketUpgrade, websocketServer }
}
