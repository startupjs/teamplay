import assert from 'node:assert/strict'
import test from 'node:test'

import Socket from '../index.js'

class StubWebSocket {
  constructor (url) {
    this.url = url
    StubWebSocket.urls.push(url)
    this.readyState = 0
  }

  close () {}
  send () {}
}
StubWebSocket.urls = []

function withStubWebSocket (fn) {
  const real = globalThis.WebSocket
  StubWebSocket.urls = []
  globalThis.WebSocket = StubWebSocket
  try {
    return fn()
  } finally {
    globalThis.WebSocket = real
  }
}

test('resolves getConnectionUrl on every open() so reconnects pick up fresh params', () => {
  withStubWebSocket(() => {
    let token = 'boot-token'
    const socket = new Socket({
      baseUrl: 'https://example.test',
      reconnect: false,
      getConnectionUrl: ({ getDefaultConnectionUrl }) =>
        `${getDefaultConnectionUrl()}?token=${token}`
    })

    assert.equal(StubWebSocket.urls.length, 1)
    assert.match(StubWebSocket.urls[0], /token=boot-token$/)

    // The token was replaced between attempts (e.g. the server reissued it, or
    // rejected the first one and the app stored a fresh session). A reopen must
    // adopt it instead of reusing the boot-time URL.
    token = 'reissued-token'
    socket.readyState = socket.CLOSED
    socket.reconnect()

    assert.equal(StubWebSocket.urls.length, 2)
    assert.match(StubWebSocket.urls[1], /token=reissued-token$/)
    assert.match(StubWebSocket.urls[1], /^wss:\/\/example\.test\//)
  })
})

test('default connection URL still works and is stable across opens', () => {
  withStubWebSocket(() => {
    const socket = new Socket({ baseUrl: 'https://example.test', reconnect: false })
    socket.readyState = socket.CLOSED
    socket.reconnect()

    assert.equal(StubWebSocket.urls.length, 2)
    for (const url of StubWebSocket.urls) {
      assert.match(url, /^wss:\/\/example\.test\//)
    }
  })
})
