// A message the server sends to a client that is disconnecting is dropped
// quietly: the connection is going away, nothing is wrong. With
// permessage-deflate ws compresses a large message off the main thread, and
// when the socket closes or ends meanwhile it hands the send callback an error
// ("The socket was closed while data was being compressed", "write after
// end"). Those are not logged; a send that fails on an open socket still is.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import net from 'node:net'
import { after, before, describe, test } from 'node:test'
import { WebSocket as WsClient, WebSocketServer } from 'ws'

import { WebSocketClientStream } from '../server/websocketStream.js'
import { isDisconnectError } from '../server/isDisconnectError.js'

// large enough that compressing it takes a while
const BIG = { a: 'op', html: crypto.randomBytes(1.5e6).toString('base64') }

describe('sending to a websocket client that goes away', () => {
  let wss, port
  before(async () => {
    wss = new WebSocketServer({ port: 0, host: '127.0.0.1', perMessageDeflate: true })
    await new Promise(resolve => wss.once('listening', resolve))
    port = wss.address().port
  })
  after(() => new Promise(resolve => wss.close(() => resolve())))

  async function connectPair () {
    const accepted = new Promise(resolve => wss.once('connection', resolve))
    const client = new WsClient(`ws://127.0.0.1:${port}`, { perMessageDeflate: true })
    client.on('error', () => {})
    await new Promise(resolve => client.once('open', resolve))
    const server = await accepted
    server.on('error', () => {})
    return { client, server }
  }

  // a websocket peer that never ends its side of the connection (a ws client
  // ends its side as soon as the server ends the other one)
  async function connectHalfOpenPeer () {
    const accepted = new Promise(resolve => wss.once('connection', resolve))
    const peer = net.connect({ port, host: '127.0.0.1', allowHalfOpen: true })
    peer.on('error', () => {})
    peer.resume()
    await new Promise(resolve => peer.once('connect', resolve))
    peer.write([
      'GET / HTTP/1.1',
      `Host: 127.0.0.1:${port}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}`,
      'Sec-WebSocket-Version: 13',
      'Sec-WebSocket-Extensions: permessage-deflate',
      '', ''
    ].join('\r\n'))
    const server = await accepted
    server.on('error', () => {})
    return { peer, server }
  }

  // resolves with the error ws hands the send callback (undefined if none)
  function watchSend (server) {
    const send = server.send.bind(server)
    return new Promise(resolve => {
      server.send = (data, cb) => send(data, err => { cb(err); resolve(err) })
    })
  }

  function captureLogs () {
    const lines = []
    const saved = { error: console.error, warn: console.warn }
    console.error = (...args) => lines.push(args)
    console.warn = (...args) => lines.push(args)
    return { lines, restore: () => Object.assign(console, saved) }
  }

  test('the socket closes while a large message is being compressed: dropped, nothing logged', async () => {
    const { client, server } = await connectPair()
    const stream = new WebSocketClientStream(server)
    const sent = watchSend(server)
    const logs = captureLogs()
    try {
      stream.write(BIG)
      // the connection drops while ws compresses the message
      server._socket.destroy()
      const err = await sent
      assert.match(err?.message ?? '', /closed while data was being compressed/)
      await new Promise(resolve => setTimeout(resolve, 20))
      assert.deepEqual(logs.lines, [])
    } finally {
      logs.restore()
      client.terminate()
    }
  })

  test('the socket ends while a large message is being compressed (write after end): dropped, nothing logged', async () => {
    const { peer, server } = await connectHalfOpenPeer()
    const stream = new WebSocketClientStream(server)
    const sent = watchSend(server)
    const logs = captureLogs()
    try {
      stream.write(BIG)
      // the writable side ends while ws compresses the message; the peer
      // keeps its own side open, so the socket is ended but not destroyed
      server._socket.end()
      const err = await sent
      assert.equal(err?.code, 'ERR_STREAM_WRITE_AFTER_END', err?.message)
      await new Promise(resolve => setTimeout(resolve, 20))
      assert.deepEqual(logs.lines, [])
    } finally {
      logs.restore()
      peer.destroy()
    }
  })

  test('the client closes right after a large message is queued: nothing logged', async () => {
    const { client, server } = await connectPair()
    const stream = new WebSocketClientStream(server)
    const sent = watchSend(server)
    const logs = captureLogs()
    try {
      stream.write(BIG)
      client.close()
      await sent
      await new Promise(resolve => server.readyState === WsClient.CLOSED ? resolve() : server.once('close', resolve))
      assert.deepEqual(logs.lines, [])
    } finally {
      logs.restore()
      client.terminate()
    }
  })

  test('a send that fails on an open socket is still logged', async () => {
    const { client, server } = await connectPair()
    const stream = new WebSocketClientStream(server)
    server.send = (data, cb) => cb(new Error('boom'))
    const logs = captureLogs()
    try {
      stream.write({ a: 'x' })
      await new Promise(resolve => setImmediate(resolve))
      assert.equal(logs.lines.length, 1)
      assert.match(String(logs.lines[0][0]), /send/)
      assert.equal(logs.lines[0][1]?.message, 'boom')
    } finally {
      logs.restore()
      client.terminate()
    }
  })
})

describe('isDisconnectError', () => {
  test('a failed send on a socket that is no longer open is a disconnect', () => {
    assert.equal(isDisconnectError(new Error('anything'), false), true)
  })

  test('on an open socket, only the errors of a connection going away are', () => {
    for (const code of ['EPIPE', 'ECONNRESET', 'ECONNABORTED', 'ERR_STREAM_WRITE_AFTER_END', 'ERR_STREAM_DESTROYED']) {
      assert.equal(isDisconnectError(Object.assign(new Error('x'), { code }), true), true, code)
    }
    assert.equal(isDisconnectError(new Error('The socket was closed while data was being compressed'), true), true)
    assert.equal(isDisconnectError(new Error('The socket was closed while the blob was being read'), true), true)
    assert.equal(isDisconnectError(new Error('boom'), true), false)
    assert.equal(isDisconnectError(Object.assign(new Error('x'), { code: 'ERR_INVALID_ARG_TYPE' }), true), false)
    assert.equal(isDisconnectError(undefined, true), false)
  })
})
