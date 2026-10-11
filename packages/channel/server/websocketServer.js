import { WebSocket, WebSocketServer } from 'ws'
import crypto from 'crypto'
import createWebsocketStream from './websocketStream.js'

export default function createWebsocketServer ({ backend, path, ping, pingInterval, authorize, maxMessageSize, perMessageDeflate }) {
  const websocketServer = new WebSocketServer({
    noServer: true,
    // a larger message closes the connection (1009); compressed messages are
    // measured inflated
    maxPayload: maxMessageSize,
    // on by default, as in ws 1.x (ws 8 turns it off by default)
    perMessageDeflate
  })

  websocketServer.on('error', function (err) {
    console.warn('[@teamplay/channel] websocket server error:', err?.code || err?.message)
  })

  websocketServer.on('connection', function (client, req) {
    client.id = crypto.randomBytes(16).toString('hex')

    // A protocol error (a malformed frame, invalid UTF-8, a message larger
    // than maxPayload) makes ws close the connection and emit 'error', which
    // throws (and takes the process down) without a listener
    client.on('error', function (err) {
      console.warn('[@teamplay/channel] websocket client error, the connection is closed:', err?.code || err?.message)
      if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) client.terminate()
    })

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
      client.once('close', () => clearInterval(client.timer))
    }

    let rejected = false
    let rejectReason

    function reject (reason) {
      rejected = true
      if (reason) rejectReason = reason
    }

    if (req?.session) client.connectSession = req.session

    backend.emit('client', client, reject)
    if (rejected) {
      // Tell the client to stop trying to connect
      closeRejected(client, rejectReason)
      return
    }

    const stream = createWebsocketStream(client)

    backend.listen(stream, req)
  })

  async function websocketUpgrade (req, socket, upgradeHead) {
    // Node's server stops listening to the socket's errors when it hands it
    // over, and ws starts in handleUpgrade(): an error in between (the client
    // went away while authorize() ran) must not go unhandled
    socket.on('error', onUpgradeSocketError)
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
      websocketServer.handleUpgrade(req, socket, head, function (client, request) {
        socket.removeListener('error', onUpgradeSocketError)
        // the request the connection came with, where ws 1.x kept it
        // ('client' event listeners read it)
        client.upgradeReq = request
        websocketServer.emit('connection' + req.url, client, request)
        websocketServer.emit('connection', client, request)
      })
    } catch (err) {
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n')
      socket.destroy()
    }
  }

  return { websocketUpgrade, websocketServer }
}

function onUpgradeSocketError (err) {
  console.warn('[@teamplay/channel] websocket upgrade socket error:', err?.code || err?.message)
  this.destroy()
}

// ws 8 refuses a close reason longer than 123 bytes
function closeRejected (client, reason) {
  try {
    client.close(1001, reason)
  } catch (err) {
    client.close(1001)
  }
}
