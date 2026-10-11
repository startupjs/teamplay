// maxMessageSize: the largest message a client may send. The server closes a
// websocket that sends a larger one (1009) and answers a larger xhr-polling
// POST with 413, without reading it whole, and keeps serving everyone else.
// The client does not send a larger message: its request fails with
// ERR_MESSAGE_TOO_BIG, and a 1009 from a server with a lower limit does not
// turn into a reconnect loop.
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import crypto from 'node:crypto'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { after, afterEach, before, describe, test as rawTest } from 'node:test'
import ShareDB from 'sharedb'
import { Connection } from 'sharedb/lib/client/index.js'

import Socket, { DEFAULT_MAX_MESSAGE_SIZE } from '../index.js'
import createChannel, { getDefaultAllowXhrFallback, getDefaultMaxMessageSize } from '../server/index.js'
import { XHR_BATCH_BYTES, XHR_BATCH_MESSAGES } from '../constants.js'

const LIMIT = 64 * 1024
const TEST_TIMEOUT = 15000

// every test gets a timeout, so a regression that would hang (a missing cap,
// a lost close) fails fast instead of stalling the run
function test (name, fn) {
  return rawTest(name, { timeout: TEST_TIMEOUT }, fn)
}

async function startServer (options = {}) {
  const backend = new ShareDB()
  const { middleware, upgrade, wss } = createChannel(backend, { maxMessageSize: LIMIT, allowXhrFallback: true, ...options })
  const server = http.createServer((req, res) => {
    // what the app would do with a request the channel passed on
    middleware(req, res, () => {
      res.statusCode = 418
      res.end('the app page')
    })
  })
  server.on('upgrade', upgrade)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    backend,
    wss,
    port,
    url: `ws://127.0.0.1:${port}/channel`,
    close: () => new Promise(resolve => {
      server.closeAllConnections?.()
      server.close(() => resolve())
    })
  }
}

function openWebSocket (url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const messages = []
    ws.onmessage = event => messages.push(JSON.parse(event.data))
    ws.onopen = () => resolve({ ws, messages })
    ws.onerror = reject
  })
}

function whenClosed (ws) {
  return new Promise(resolve => {
    if (ws.readyState === WebSocket.CLOSED) return resolve({})
    ws.addEventListener('close', event => resolve({ code: event.code, wasClean: event.wasClean }))
  })
}

async function handshake ({ ws, messages }) {
  const count = messages.length
  ws.send(JSON.stringify({ a: 'hs', protocol: 1, protocolMinor: 2 }))
  await waitFor(() => messages.slice(count).some(message => message.a === 'hs'))
}

async function waitFor (condition, timeout = 3000) {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeout) throw Error('Timed out waiting for ' + condition)
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

describe('the server', () => {
  // what would take a real server process down
  const uncaught = []
  const onUncaught = err => uncaught.push(err.message)
  let server, warn
  before(async () => {
    server = await startServer()
    warn = console.warn
    console.warn = () => {}
    process.on('uncaughtException', onUncaught)
  })
  after(async () => {
    process.removeListener('uncaughtException', onUncaught)
    console.warn = warn
    await server.close()
  })
  afterEach(async () => {
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.deepEqual(uncaught.splice(0), [])
  })

  test('closes a websocket that sends a message larger than maxMessageSize (1009); others keep working', async () => {
    // Node's WebSocket (undici) loses the close code when the server closes
    // while it is still compressing its message (1006); browsers get 1009
    // either way. Without compression it gets 1009 too
    const plain = await startServer({ perMessageDeflate: false })
    try {
      const other = await openWebSocket(plain.url)
      const sender = await openWebSocket(plain.url)
      const closed = whenClosed(sender.ws)
      sender.ws.send(JSON.stringify({ a: 'hs', protocol: 1, padding: 'x'.repeat(LIMIT) }))
      const { code } = await closed
      assert.equal(code, 1009)
      await handshake(other)
      other.ws.close()
    } finally {
      await plain.close()
    }
  })

  test('closes a websocket whose compressed message inflates past maxMessageSize; others keep working', async () => {
    const other = await openWebSocket(server.url)
    const sender = await openWebSocket(server.url)
    assert.equal(sender.ws.extensions, 'permessage-deflate')
    const closed = whenClosed(sender.ws)
    // 8 MB of the same letter: a few kilobytes on the wire
    sender.ws.send('x'.repeat(8 * 1024 * 1024))
    await closed
    await handshake(other)
    other.ws.close()
  })

  test('pings an open websocket to keep it alive', async () => {
    const pinging = await startServer({ pingInterval: 30 })
    try {
      const socket = await rawWebSocket(pinging.port)
      const pings = await new Promise(resolve => {
        let count = 0
        socket.on('data', chunk => {
          for (const byte of chunk) if (byte === 0x89) count++
          if (count >= 2) resolve(count)
        })
      })
      assert.ok(pings >= 2)
      socket.destroy()
    } finally {
      await pinging.close()
    }
  })

  test('passes a message up to maxMessageSize', async () => {
    const client = await openWebSocket(server.url)
    const message = JSON.stringify({ a: 'hs', protocol: 1, protocolMinor: 2, padding: '' })
    client.ws.send(JSON.stringify({ a: 'hs', protocol: 1, protocolMinor: 2, padding: 'x'.repeat(LIMIT - message.length) }))
    await waitFor(() => client.messages.some(message => message.a === 'hs'))
    client.ws.close()
  })

  test('closes a websocket at the header of a frame larger than maxMessageSize, before reading it', async () => {
    const socket = await rawWebSocket(server.port)
    // a masked text frame announcing 200 MB; only its header is sent
    const header = Buffer.alloc(14)
    header[0] = 0x81
    header[1] = 0x80 | 127
    header.writeBigUInt64BE(200n * 1024n * 1024n, 2)
    crypto.randomFillSync(header, 10, 4)
    socket.write(header)
    assert.equal(await readCloseCode(socket), 1009)
    const other = await openWebSocket(server.url)
    await handshake(other)
    other.ws.close()
  })

  for (const [name, bytes, code] of [
    ['an unmasked frame', Buffer.from([0x81, 0x01, 0x41]), 1002],
    ['a reserved opcode', maskedFrame(0x83, Buffer.from('A')), 1002],
    ['RSV2 set', maskedFrame(0xa1, Buffer.from('{}')), 1002],
    ['RSV1 set without compression', maskedFrame(0xc1, Buffer.from('{}')), 1002],
    ['invalid UTF-8 in a text frame', maskedFrame(0x81, Buffer.from([0x7b, 0xc3, 0x28, 0x7d])), 1007],
    ['a fragmented control frame', maskedFrame(0x09, Buffer.from('ping')), 1002]
  ]) {
    test(`closes a websocket that sends ${name} (${code}) and stays up`, async () => {
      const other = await openWebSocket(server.url)
      const socket = await rawWebSocket(server.port)
      socket.write(bytes)
      assert.equal(await readCloseCode(socket), code)
      await handshake(other)
      other.ws.close()
    })
  }

  test('takes a JSON message sent as a binary frame', async () => {
    const client = await openWebSocket(server.url)
    client.ws.send(new TextEncoder().encode(JSON.stringify({ a: 'hs', protocol: 1, protocolMinor: 2 })))
    await waitFor(() => client.messages.some(message => message.a === 'hs'))
    client.ws.close()
  })

  test('closes a websocket that sends a message that is not JSON, logging no content', async () => {
    const warnings = []
    console.warn = (...args) => warnings.push(args.map(String).join(' '))
    const client = await openWebSocket(server.url)
    const closed = whenClosed(client.ws)
    client.ws.send('secret-' + 'x'.repeat(20))
    await closed
    assert.ok(warnings.length > 0)
    assert.ok(!warnings.join('\n').includes('secret-'), warnings.join('\n'))
    console.warn = () => {}
  })

  test('stays up when a client goes away while authorize() runs', async () => {
    const slow = await startServer({
      authorize: () => new Promise((resolve, reject) => setTimeout(() => reject(new Error('no')), 100))
    })
    const socket = net.connect(slow.port, '127.0.0.1', () => {
      socket.write(upgradeRequest(slow.port))
      setTimeout(() => socket.resetAndDestroy(), 20)
    })
    socket.on('error', () => {})
    await new Promise(resolve => setTimeout(resolve, 300))
    await slow.close()
  })

  test('hands the upgrade request to \'client\' listeners, and closes a rejected one (1001) whatever its reason', async () => {
    const urls = []
    const onClient = (client, reject) => {
      urls.push(client.upgradeReq?.url)
      if (client.upgradeReq?.url.includes('reject')) reject('a reason longer than a close frame takes: ' + 'x'.repeat(200))
    }
    server.backend.on('client', onClient)
    try {
      const rejected = new WebSocket(server.url + '?reject')
      const { code } = await whenClosed(rejected)
      assert.equal(code, 1001)
      const accepted = await openWebSocket(server.url + '?ok')
      accepted.ws.close()
      assert.deepEqual(urls, ['/channel?reject', '/channel?ok'])
    } finally {
      server.backend.removeListener('client', onClient)
    }
  })

  test('answers an xhr-polling POST over the body limit with 413 and closes its session (1009)', async () => {
    const session = crypto.randomUUID()
    const base = `http://127.0.0.1:${server.port}/channel/000/${session}`
    const open = await fetch(base + '/xhr', { method: 'POST' })
    assert.equal(await open.text(), 'o\n')

    const small = await fetch(base + '/xhr_send', { method: 'POST', body: JSON.stringify([JSON.stringify({ a: 'hs', protocol: 1 })]) })
    assert.equal(small.status, 204)

    // one message past the larger of the batch limit and 3 x maxMessageSize
    const { status } = await postBody(server.port, `/channel/000/${session}/xhr_send`, JSON.stringify(['x'.repeat(2 * XHR_BATCH_BYTES)]))
    assert.ok(status === 413 || status === undefined, `status ${status}`)
    assert.match(await pollClose(base), /^c\[1009,/)
  })

  test('closes the session (1009) on one xhr message over maxMessageSize inside a legal POST', async () => {
    const session = crypto.randomUUID()
    const base = `http://127.0.0.1:${server.port}/channel/000/${session}`
    await fetch(base + '/xhr', { method: 'POST' })
    // 1.5 x the cap: the POST is within the limits, the message is not
    const big = await fetch(base + '/xhr_send', { method: 'POST', body: JSON.stringify(['x'.repeat(Math.floor(LIMIT * 1.5))]) })
    assert.equal(big.status, 204)
    assert.match(await pollClose(base), /^c\[1009,/)
  })

  test('refuses an xhr-polling POST of more than one message past the batch byte limit', async () => {
    const session = crypto.randomUUID()
    await fetch(`http://127.0.0.1:${server.port}/channel/000/${session}/xhr`, { method: 'POST' })
    const message = JSON.stringify('x'.repeat(Math.floor(XHR_BATCH_BYTES / 3)))
    const { status } = await postBody(server.port, `/channel/000/${session}/xhr_send`, '[' + [message, message, message, message].join(',') + ']')
    assert.ok(status === 413 || status === undefined, `status ${status}`)
  })

  test('stops reading an xhr-polling POST without a Content-Length once it breaks the limits', async () => {
    const session = crypto.randomUUID()
    const path = `/channel/000/${session}`
    await fetch(`http://127.0.0.1:${server.port}${path}/xhr`, { method: 'POST' })
    const total = 64 * 1024 * 1024
    const { status, sent } = await postChunked(server.port, path + '/xhr_send', total)
    // the 413 is sent, but this client is still uploading when the server
    // drops the connection, so it may get a reset before it reads the answer
    // (browsers send an xhr body with a Content-Length: refused up front)
    assert.ok(status === 413 || status === undefined, `status ${status}`)
    assert.ok(sent < total / 4, `the server read on (${sent} bytes sent)`)
  })
})

// One anonymous POST full of tiny messages: refused by the message count as
// soon as it passes it (without the server reading or parsing the rest), and
// a POST within the count is handed to ShareDB a chunk at a time, so the event
// loop keeps turning and the heap stays bounded. Default maxMessageSize (16
// MiB), as an attacker meets it.
describe('an xhr-polling POST of many messages', () => {
  let server, warn
  before(async () => {
    warn = console.warn
    console.warn = () => {}
    server = await startServer({ maxMessageSize: undefined })
  })
  after(async () => {
    console.warn = warn
    await server.close()
  })

  for (const [kind, message] of [
    ['empty objects', {}],
    ['pings', { a: 'pp' }],
    ['fetches', { a: 'f', c: 'notes', d: 'n1' }]
  ]) {
    test(`a 32 MiB POST of ${kind} is refused at once; the event loop keeps turning, the heap stays bounded`, async () => {
      const session = crypto.randomUUID()
      await fetch(`http://127.0.0.1:${server.port}/channel/000/${session}/xhr`, { method: 'POST' })
      const one = JSON.stringify(JSON.stringify(message))
      const count = Math.floor((32 * 1024 * 1024 - 2) / (one.length + 1))
      const body = '[' + new Array(count).fill(one).join(',') + ']'
      global.gc?.()
      const heapBefore = process.memoryUsage().heapUsed
      const delay = monitorEventLoopDelay({ resolution: 10 })
      delay.enable()
      const { status } = await postBody(server.port, `/channel/000/${session}/xhr_send`, body)
      delay.disable()
      const grown = process.memoryUsage().heapUsed - heapBefore - body.length * 2
      assert.ok(status === 413 || status === undefined, `status ${status}`)
      assert.ok(delay.max / 1e6 < 200, `the event loop was blocked for ${Math.round(delay.max / 1e6)} ms`)
      assert.ok(grown < 64 * 1024 * 1024, `the heap grew by ${Math.round(grown / 1048576)} MiB`)
    })
  }

  test(`a POST of ${XHR_BATCH_MESSAGES} messages is handled a chunk at a time`, async () => {
    let handled = 0
    server.backend.use('receive', (request, next) => {
      if (request.data?.a === 'pp') handled++
      next()
    })
    const session = crypto.randomUUID()
    await fetch(`http://127.0.0.1:${server.port}/channel/000/${session}/xhr`, { method: 'POST' })
    const one = JSON.stringify(JSON.stringify({ a: 'pp' }))
    const body = '[' + new Array(XHR_BATCH_MESSAGES).fill(one).join(',') + ']'
    const delay = monitorEventLoopDelay({ resolution: 1 })
    delay.enable()
    const response = await fetch(`http://127.0.0.1:${server.port}/channel/000/${session}/xhr_send`, { method: 'POST', body })
    assert.equal(response.status, 204)
    await waitFor(() => handled === XHR_BATCH_MESSAGES)
    delay.disable()
    assert.ok(delay.max / 1e6 < 100, `the event loop was blocked for ${Math.round(delay.max / 1e6)} ms`)
  })

  test(`a POST of ${XHR_BATCH_MESSAGES + 1} messages is refused`, async () => {
    const session = crypto.randomUUID()
    await fetch(`http://127.0.0.1:${server.port}/channel/000/${session}/xhr`, { method: 'POST' })
    const one = JSON.stringify(JSON.stringify({ a: 'pp' }))
    const body = '[' + new Array(XHR_BATCH_MESSAGES + 1).fill(one).join(',') + ']'
    const { status } = await postBody(server.port, `/channel/000/${session}/xhr_send`, body)
    assert.ok(status === 413 || status === undefined, `status ${status}`)
  })
})

describe('the client', () => {
  let errors, consoleError
  before(() => {
    consoleError = console.error
    console.error = (...args) => errors.push(args.join(' '))
  })
  after(() => {
    console.error = consoleError
  })

  test('defaults maxMessageSize to 16 MiB, like the server', () => {
    assert.equal(DEFAULT_MAX_MESSAGE_SIZE, 16 * 1024 * 1024)
  })

  test('does not send a message larger than maxMessageSize; its request comes back with ERR_MESSAGE_TOO_BIG', async () => {
    errors = []
    await withStubWebSocket(async sockets => {
      const socket = new Socket({ baseUrl: 'https://example.test', reconnect: false, maxMessageSize: 100 })
      const received = []
      socket.onmessage = event => received.push(event.data)
      sockets[0].open()
      socket.send(JSON.stringify({ a: 'op', c: 'items', d: 'i1', seq: 1, op: [{ p: ['text'], oi: 'x'.repeat(10) }] }))
      // 2-byte characters count twice
      socket.send(JSON.stringify({ a: 'op', c: 'items', d: 'i1', seq: 2, op: [{ p: ['text'], oi: 'é'.repeat(45) }] }))
      await new Promise(resolve => setTimeout(resolve, 10))
      assert.equal(sockets[0].sent.length, 1)
      assert.equal(JSON.parse(sockets[0].sent[0]).seq, 1)
      assert.equal(received.length, 1)
      assert.equal(received[0].seq, 2)
      assert.equal(received[0].a, 'op')
      assert.equal(received[0].error.code, 'ERR_MESSAGE_TOO_BIG')
      assert.equal(errors.length, 1)
    })
  })

  test('reconnects after a 1009 and no longer sends a message as long as the one the server refused', async () => {
    errors = []
    await withStubWebSocket(async sockets => {
      const socket = new Socket({ baseUrl: 'https://example.test', timeout: 1, timeoutIncrement: 0, maxMessageSize: 1000 })
      const received = []
      socket.onmessage = event => received.push(event.data)
      sockets[0].open()
      const big = JSON.stringify({ a: 'op', c: 'items', d: 'i1', seq: 1, op: [{ p: ['text'], oi: 'x'.repeat(500) }] })
      socket.send(big)
      assert.equal(sockets[0].sent.length, 1)
      // the server's limit is lower than the client's
      sockets[0].serverClose(1009)
      await waitFor(() => sockets.length === 2)
      assert.match(errors.join('\n'), /closed the connection/)
      sockets[1].open()
      socket.send(big)
      await waitFor(() => received.length === 1)
      assert.equal(sockets[1].sent.length, 0)
      assert.equal(received[0].error.code, 'ERR_MESSAGE_TOO_BIG')
      socket.close()
    })
  })
})

describe('ShareDB over the channel', () => {
  let server, consoleError, consoleWarn
  before(() => {
    consoleError = console.error
    consoleWarn = console.warn
    console.error = () => {}
    console.warn = () => {}
  })
  after(() => {
    console.error = consoleError
    console.warn = consoleWarn
  })
  afterEach(async () => {
    await server?.close()
  })

  test('reconnects after the server drops the connection and keeps syncing', async () => {
    server = await startServer()
    const socket = new Socket({ baseUrl: `http://127.0.0.1:${server.port}`, timeout: 20, timeoutIncrement: 0 })
    const connection = new Connection(socket)
    await waitFor(() => connection.state === 'connected')
    const doc = connection.get('items', 'r1')
    await new Promise((resolve, reject) => doc.create({ n: 0 }, err => err ? reject(err) : resolve()))
    await new Promise((resolve, reject) => doc.subscribe(err => err ? reject(err) : resolve()))
    for (const client of server.wss.clients) client.terminate()
    await waitFor(() => connection.state === 'disconnected')
    await waitFor(() => connection.state === 'connected')
    const serverDoc = server.backend.connect().get('items', 'r1')
    await new Promise((resolve, reject) => serverDoc.fetch(err => err ? reject(err) : resolve()))
    await new Promise((resolve, reject) => serverDoc.submitOp([{ p: ['n'], na: 1 }], err => err ? reject(err) : resolve()))
    await waitFor(() => doc.data.n === 1)
    socket._reconnect = false
    connection.close()
  })

  for (const [name, clientLimit] of [['the same limit', LIMIT], ['a client limit higher than the server\'s', 16 * LIMIT]]) {
    test(`a write too big fails, the connection keeps working (${name})`, async () => {
      // without compression: see the first server test about Node's WebSocket
      server = await startServer({ perMessageDeflate: false })
      const socket = new Socket({ baseUrl: `http://127.0.0.1:${server.port}`, timeout: 20, timeoutIncrement: 0, maxMessageSize: clientLimit })
      const connection = new Connection(socket)
      let opens = 0
      const shareDbOnOpen = socket.onopen
      socket.onopen = event => {
        opens++
        shareDbOnOpen(event)
      }
      await waitFor(() => connection.state === 'connected')
      const doc = connection.get('items', 'i1')
      await new Promise((resolve, reject) => doc.create({ text: 'small' }, err => err ? reject(err) : resolve()))

      const error = await new Promise(resolve => {
        doc.submitOp([{ p: ['text'], od: 'small', oi: 'x'.repeat(2 * LIMIT) }], resolve)
      })
      assert.equal(error?.code, 'ERR_MESSAGE_TOO_BIG')
      await waitFor(() => connection.state === 'connected')
      await new Promise((resolve, reject) => doc.fetch(err => err ? reject(err) : resolve()))
      assert.equal(doc.data.text, 'small')
      await new Promise((resolve, reject) => doc.submitOp([{ p: ['n'], oi: 1 }], err => err ? reject(err) : resolve()))
      await new Promise(resolve => setTimeout(resolve, 200))
      // one reconnect when the server refused the message itself
      assert.equal(opens, clientLimit > LIMIT ? 2 : 1)
      socket._reconnect = false
      connection.close()
    })
  }
})

// The xhr-polling fallback (SockJS, which React Native / Metro clients use)
// escapes each message inside a JSON string and batches the queued messages
// into one POST, so a POST body can exceed maxMessageSize while every message
// in it is under the cap. Such writes must still complete, with no reconnect
// loop; a single message over the cap fails that one request.
describe('the xhr-polling fallback', () => {
  let server, consoleError, consoleWarn
  before(() => {
    consoleError = console.error
    consoleWarn = console.warn
    console.error = () => {}
    console.warn = () => {}
  })
  after(() => {
    console.error = consoleError
    console.warn = consoleWarn
  })
  afterEach(async () => {
    await server?.close()
  })

  for (const [name, makeDocs] of [
    ['small messages', () => [1, 2, 3].map(i => ['s' + i, { text: 'x'.repeat(100) }])],
    ['one message at 0.9 of the cap', () => [['p1', { text: 'x'.repeat(Math.floor(LIMIT * 0.9)) }]]],
    ['one message under the cap that quoting inflates past it', () => [['q1', { text: '"'.repeat(Math.floor(LIMIT * 0.45)) }]]],
    ['three messages under the cap sent together', () => [1, 2, 3].map(i => ['b' + i, { text: 'x'.repeat(Math.floor(LIMIT * 0.6)) }])],
    // SockJS escapes each half of a surrogate pair as \uXXXX: 3 x on the wire
    ['one emoji message at 0.7 of the cap', () => [['e1', { text: '\u{1F600}'.repeat(Math.floor(LIMIT * 0.7 / 4)) }]]],
    ['four messages at 0.6 of the cap sent together', () => [1, 2, 3, 4].map(i => ['f' + i, { text: 'x'.repeat(Math.floor(LIMIT * 0.6)) }])],
    ['many small writes at once (cut into several POSTs)', () => Array.from({ length: 2500 }, (_, i) => ['m' + i, { n: i }])]
  ]) {
    test(`${name}: every write is answered, no reconnect loop`, async () => {
      server = await startServer()
      const socket = new Socket({ baseUrl: `http://127.0.0.1:${server.port}`, forceXhrFallback: true, timeout: 20, timeoutIncrement: 0, maxMessageSize: LIMIT })
      const connection = new Connection(socket)
      let opens = 0
      const onopen = socket.onopen
      socket.onopen = event => { opens++; onopen(event) }
      await waitFor(() => connection.state === 'connected')
      const results = []
      const docs = makeDocs()
      for (const [id, data] of docs) {
        connection.get('items', id).create(data, err => results.push(err?.code ?? 'ok'))
      }
      await new Promise(resolve => setTimeout(resolve, 2500))
      socket._reconnect = false
      connection.close()
      assert.ok(opens <= 2, `${opens} connections opened; results ${JSON.stringify(results)}`)
      assert.equal(results.length, docs.length, `every write answered: ${JSON.stringify(results)}`)
      assert.ok(results.every(r => r === 'ok'), `writes under the cap succeed: ${JSON.stringify(results)}`)
    })
  }

  test('a single message over the cap fails that write and nothing else loops', async () => {
    server = await startServer()
    const socket = new Socket({ baseUrl: `http://127.0.0.1:${server.port}`, forceXhrFallback: true, timeout: 20, timeoutIncrement: 0, maxMessageSize: LIMIT })
    const connection = new Connection(socket)
    let opens = 0
    const onopen = socket.onopen
    socket.onopen = event => { opens++; onopen(event) }
    await waitFor(() => connection.state === 'connected')
    const results = []
    connection.get('items', 'big').create({ text: 'x'.repeat(2 * LIMIT) }, err => results.push(err?.code ?? 'ok'))
    connection.get('items', 'small').create({ text: 'ok' }, err => results.push(err?.code ?? 'ok'))
    await waitFor(() => results.length === 2)
    await new Promise(resolve => setTimeout(resolve, 500))
    socket._reconnect = false
    connection.close()
    assert.ok(results.includes('ERR_MESSAGE_TOO_BIG'), JSON.stringify(results))
    assert.ok(results.includes('ok'), JSON.stringify(results))
    assert.ok(opens <= 2, `${opens} connections opened`)
  })
})

describe('the xhr-polling fallback, client limit above the server\'s', () => {
  let server, consoleError, consoleWarn
  before(() => {
    consoleError = console.error
    consoleWarn = console.warn
    console.error = () => {}
    console.warn = () => {}
  })
  after(() => {
    console.error = consoleError
    console.warn = consoleWarn
  })
  afterEach(async () => {
    await server?.close()
  })

  test('a write between the two limits fails with ERR_MESSAGE_TOO_BIG and the connection recovers', async () => {
    server = await startServer()
    const socket = new Socket({ baseUrl: `http://127.0.0.1:${server.port}`, forceXhrFallback: true, timeout: 20, timeoutIncrement: 0, maxMessageSize: 16 * LIMIT })
    const connection = new Connection(socket)
    let opens = 0
    const onopen = socket.onopen
    socket.onopen = event => { opens++; onopen(event) }
    await waitFor(() => connection.state === 'connected')
    const results = []
    connection.get('items', 'm1').create({ text: 'x'.repeat(Math.floor(LIMIT * 1.5)) }, err => results.push(err?.code ?? 'ok'))
    await waitFor(() => results.length === 1)
    await waitFor(() => connection.state === 'connected')
    const after = []
    connection.get('items', 'm2').create({ text: 'small' }, err => after.push(err?.code ?? 'ok'))
    await waitFor(() => after.length === 1)
    socket._reconnect = false
    connection.close()
    assert.deepEqual(results, ['ERR_MESSAGE_TOO_BIG'])
    assert.deepEqual(after, ['ok'])
    assert.ok(opens <= 2, `${opens} connections opened`)
  })
})

describe('serving the xhr-polling fallback', () => {
  const env = { NODE_ENV: process.env.NODE_ENV, TEAMPLAY_ALLOW_XHR_FALLBACK: process.env.TEAMPLAY_ALLOW_XHR_FALLBACK }
  let server
  afterEach(async () => {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await server?.close()
    server = undefined
  })

  function setEnv (nodeEnv, allow) {
    if (nodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = nodeEnv
    if (allow === undefined) delete process.env.TEAMPLAY_ALLOW_XHR_FALLBACK
    else process.env.TEAMPLAY_ALLOW_XHR_FALLBACK = allow
  }

  async function infoStatus (options) {
    server = await startServer({ allowXhrFallback: undefined, ...options })
    const response = await fetch(`http://127.0.0.1:${server.port}/channel/info`)
    return { status: response.status, text: await response.text() }
  }

  test('is off in production by default: its paths answer a plain 404, not the app page; websockets still work', async () => {
    setEnv('production')
    const { status, text } = await infoStatus()
    assert.equal(status, 404)
    assert.notEqual(text, 'the app page')
    // other paths still reach the app
    const other = await fetch(`http://127.0.0.1:${server.port}/somewhere`)
    assert.equal(other.status, 418)
    const client = await openWebSocket(server.url)
    await handshake(client)
    client.ws.close()
  })

  test('is on in production with allowXhrFallback: true', async () => {
    setEnv('production')
    assert.equal((await infoStatus({ allowXhrFallback: true })).status, 200)
  })

  test('is on in production with TEAMPLAY_ALLOW_XHR_FALLBACK=1', async () => {
    setEnv('production', '1')
    assert.equal((await infoStatus()).status, 200)
  })

  test('is on in development by default, and off with allowXhrFallback: false', async () => {
    setEnv('development')
    assert.equal((await infoStatus()).status, 200)
    await server.close()
    server = undefined
    assert.equal((await infoStatus({ allowXhrFallback: false })).status, 404)
  })

  test('reads its default from NODE_ENV and TEAMPLAY_ALLOW_XHR_FALLBACK', () => {
    assert.equal(getDefaultAllowXhrFallback({}), true)
    assert.equal(getDefaultAllowXhrFallback({ NODE_ENV: 'development' }), true)
    assert.equal(getDefaultAllowXhrFallback({ NODE_ENV: 'production' }), false)
    assert.equal(getDefaultAllowXhrFallback({ NODE_ENV: 'production', TEAMPLAY_ALLOW_XHR_FALLBACK: '1' }), true)
    assert.equal(getDefaultAllowXhrFallback({ NODE_ENV: 'production', TEAMPLAY_ALLOW_XHR_FALLBACK: 'true' }), true)
    assert.equal(getDefaultAllowXhrFallback({ NODE_ENV: 'development', TEAMPLAY_ALLOW_XHR_FALLBACK: '0' }), false)
    assert.equal(getDefaultAllowXhrFallback({ NODE_ENV: 'production', TEAMPLAY_ALLOW_XHR_FALLBACK: '' }), false)
  })

  test('an info probe that never answers times out and the client reconnects (does not wedge)', async () => {
    // a server whose /info request hangs forever
    const hanging = http.createServer(req => { /* never responds */ })
    await new Promise(resolve => hanging.listen(0, '127.0.0.1', resolve))
    const consoleError = console.error
    console.error = () => {}
    try {
      const socket = new Socket({ baseUrl: `http://127.0.0.1:${hanging.address().port}`, forceXhrFallback: true, reconnect: true, timeout: 20, timeoutIncrement: 0, xhrProbeTimeout: 100 })
      socket._reconnect = false // do not actually loop; we only watch the probe
      let reconnected = false
      socket._afterClose = () => { reconnected = true }
      // drive the close path that runs the probe, as a real xhr close would
      const start = Date.now()
      socket._checkXhrServed({ code: 1006, wasClean: false })
      await waitFor(() => reconnected, 3000)
      assert.ok(Date.now() - start >= 90, 'the probe waited for its timeout')
    } finally {
      console.error = consoleError
      hanging.closeAllConnections?.()
      await new Promise(resolve => hanging.close(resolve))
    }
  })

  test('after learning the server does not serve it, the client connects by websocket at once, not after a reconnect delay', async () => {
    server = await startServer({ allowXhrFallback: false })
    const consoleError = console.error
    console.error = () => {}
    const start = Date.now()
    // a reconnect delay would be 10-30 s here
    const socket = new Socket({ baseUrl: `http://127.0.0.1:${server.port}`, forceXhrFallback: true, timeout: 30000, timeoutIncrement: 0 })
    const connection = new Connection(socket)
    try {
      await waitFor(() => connection.state === 'connected', 8000)
      assert.equal(socket._type, 'websocket')
      assert.ok(Date.now() - start < 5000, `took ${Date.now() - start} ms`)
    } finally {
      console.error = consoleError
      socket._reconnect = false
      connection.close()
    }
  })

  test('an info probe that times out is aborted, so hung requests do not pile up', async () => {
    let requests = 0
    let closed = 0
    const hanging = http.createServer(req => {
      // count the probes only (SockJS itself asks the info path too)
      if (!req.url.startsWith('/probe/info')) return
      requests++
      req.socket.once('close', () => closed++)
    })
    await new Promise(resolve => hanging.listen(0, '127.0.0.1', resolve))
    try {
      const baseUrl = `http://127.0.0.1:${hanging.address().port}`
      const socket = new Socket({ baseUrl, forceXhrFallback: true, reconnect: false, xhrProbeTimeout: 100 })
      socket._afterClose = () => {}
      socket._url = baseUrl + '/probe'
      for (let i = 0; i < 3; i++) socket._checkXhrServed({ code: 1006, wasClean: false })
      await waitFor(() => requests === 3, 3000)
      await waitFor(() => closed === 3, 3000)
    } finally {
      hanging.closeAllConnections?.()
      await new Promise(resolve => hanging.close(resolve))
    }
  })

  test('a client set to use it, against a server that does not serve it, logs one error and connects with a websocket', async () => {
    server = await startServer({ allowXhrFallback: false })
    const errors = []
    const consoleError = console.error
    console.error = (...args) => errors.push(args.map(String).join(' '))
    try {
      const socket = new Socket({ baseUrl: `http://127.0.0.1:${server.port}`, forceXhrFallback: true, timeout: 20, timeoutIncrement: 0 })
      const connection = new Connection(socket)
      await waitFor(() => connection.state === 'connected', 5000)
      assert.equal(socket._type, 'websocket')
      const doc = connection.get('items', 'w1')
      await new Promise((resolve, reject) => doc.create({ ok: true }, err => err ? reject(err) : resolve()))
      socket._reconnect = false
      connection.close()
    } finally {
      console.error = consoleError
    }
    const notServed = errors.filter(line => line.includes('does not serve the xhr-polling fallback'))
    assert.equal(notServed.length, 1, errors.join('\n'))
  })
})

describe('maxMessageSize from the environment', () => {
  const saved = process.env.TEAMPLAY_MAX_MESSAGE_SIZE
  let server
  afterEach(async () => {
    if (saved === undefined) delete process.env.TEAMPLAY_MAX_MESSAGE_SIZE
    else process.env.TEAMPLAY_MAX_MESSAGE_SIZE = saved
    await server?.close()
    server = undefined
  })

  test('reads TEAMPLAY_MAX_MESSAGE_SIZE, with the option winning', () => {
    assert.equal(getDefaultMaxMessageSize({}), 16 * 1024 * 1024)
    assert.equal(getDefaultMaxMessageSize({ TEAMPLAY_MAX_MESSAGE_SIZE: '2048' }), 2048)
    assert.equal(getDefaultMaxMessageSize({ TEAMPLAY_MAX_MESSAGE_SIZE: '' }), 16 * 1024 * 1024)
    assert.throws(() => getDefaultMaxMessageSize({ TEAMPLAY_MAX_MESSAGE_SIZE: 'lots' }), /positive integer/)
    assert.throws(() => getDefaultMaxMessageSize({ TEAMPLAY_MAX_MESSAGE_SIZE: '-1' }), /positive integer/)
  })

  test('takes TEAMPLAY_MAX_MESSAGE_SIZE as plain decimal digits only', () => {
    for (const value of ['0x10', '1e6', ' 1024', '1024 ', '+1024', '1_024', '1024.0', '0', '000', 'Infinity', '9007199254740993']) {
      assert.throws(() => getDefaultMaxMessageSize({ TEAMPLAY_MAX_MESSAGE_SIZE: value }), /positive integer/, JSON.stringify(value))
    }
    assert.equal(getDefaultMaxMessageSize({ TEAMPLAY_MAX_MESSAGE_SIZE: '1048576' }), 1048576)
    assert.equal(getDefaultMaxMessageSize({ TEAMPLAY_MAX_MESSAGE_SIZE: '01024' }), 1024)
  })

  test('a websocket server configured only through the env var refuses a larger message', async () => {
    process.env.TEAMPLAY_MAX_MESSAGE_SIZE = String(LIMIT)
    const backend = new ShareDB()
    // no maxMessageSize option: it comes from the env var
    // compression off: Node's WebSocket loses the close code otherwise (see
    // the first server test)
    const { upgrade } = createChannel(backend, { allowXhrFallback: true, perMessageDeflate: false })
    const httpServer = http.createServer()
    httpServer.on('upgrade', upgrade)
    await new Promise(resolve => httpServer.listen(0, '127.0.0.1', resolve))
    server = { close: () => new Promise(resolve => { httpServer.closeAllConnections?.(); httpServer.close(() => resolve()) }) }
    const warn = console.warn
    console.warn = () => {}
    try {
      const client = await openWebSocket(`ws://127.0.0.1:${httpServer.address().port}/channel`)
      const closed = whenClosed(client.ws)
      client.ws.send(JSON.stringify({ a: 'hs', protocol: 1, padding: 'x'.repeat(LIMIT) }))
      const { code } = await closed
      assert.equal(code, 1009)
    } finally {
      console.warn = warn
    }
  })

  test('a client with the default (higher) limit against an env-configured lower server fails just that write', async () => {
    process.env.TEAMPLAY_MAX_MESSAGE_SIZE = String(LIMIT)
    const backend = new ShareDB()
    const { upgrade } = createChannel(backend)
    const httpServer = http.createServer()
    httpServer.on('upgrade', upgrade)
    await new Promise(resolve => httpServer.listen(0, '127.0.0.1', resolve))
    server = { close: () => new Promise(resolve => { httpServer.closeAllConnections?.(); httpServer.close(() => resolve()) }) }
    const consoleError = console.error
    console.error = () => {}
    try {
      // the client keeps the 16 MiB default; it learns the server's lower limit
      // from the 1009 close and fails just the oversized write
      const socket = new Socket({ baseUrl: `http://127.0.0.1:${httpServer.address().port}`, timeout: 20, timeoutIncrement: 0 })
      const connection = new Connection(socket)
      await waitFor(() => connection.state === 'connected')
      const doc = connection.get('items', 'big')
      const bigError = await new Promise(resolve => doc.create({ text: 'x'.repeat(2 * LIMIT) }, err => resolve(err?.code ?? 'ok')))
      assert.equal(bigError, 'ERR_MESSAGE_TOO_BIG')
      await waitFor(() => connection.state === 'connected')
      const small = connection.get('items', 'small')
      await new Promise((resolve, reject) => small.create({ text: 'ok' }, err => err ? reject(err) : resolve()))
      assert.equal(small.data.text, 'ok')
      socket._reconnect = false
      connection.close()
    } finally {
      console.error = consoleError
    }
  })
})

function upgradeRequest (port) {
  return [
    'GET /channel HTTP/1.1',
    `Host: 127.0.0.1:${port}`,
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}`,
    'Sec-WebSocket-Version: 13',
    '', ''
  ].join('\r\n')
}

// A client frame (masked): `first` is the FIN/RSV/opcode byte
function maskedFrame (first, payload) {
  const mask = crypto.randomBytes(4)
  const masked = Buffer.from(payload.map((byte, i) => byte ^ mask[i % 4]))
  return Buffer.concat([Buffer.from([first, 0x80 | payload.length]), mask, masked])
}

function rawWebSocket (port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(upgradeRequest(port))
    })
    socket.once('error', reject)
    let head = Buffer.alloc(0)
    socket.on('data', function onData (chunk) {
      head = Buffer.concat([head, chunk])
      const end = head.indexOf('\r\n\r\n')
      if (end === -1) return
      socket.removeListener('data', onData)
      assert.match(head.toString('latin1', 0, end), /^HTTP\/1\.1 101/)
      const rest = head.subarray(end + 4)
      if (rest.length) socket.unshift(rest)
      resolve(socket)
    })
  })
}

// The code of the close frame the server sends (skipping the other frames
// it sends first, ShareDB's init message); then drops the socket
function readCloseCode (socket) {
  return new Promise(resolve => {
    let data = Buffer.alloc(0)
    socket.on('error', () => {})
    socket.on('close', () => resolve(null))
    socket.on('data', chunk => {
      data = Buffer.concat([data, chunk])
      let offset = 0
      while (offset + 2 <= data.length) {
        let length = data[offset + 1] & 0x7f
        let start = offset + 2
        if (length === 126) {
          if (offset + 4 > data.length) return
          length = data.readUInt16BE(offset + 2)
          start = offset + 4
        }
        if (start + length > data.length) return
        if ((data[offset] & 0x0f) === 0x8) {
          socket.destroy()
          return resolve(length >= 2 ? data.readUInt16BE(start) : 1005)
        }
        offset = start + length
      }
    })
  })
}

// POSTs `body` with its Content-Length; resolves with the status, or no
// status when the server dropped the connection before this client read it
function postBody (port, path, body) {
  return new Promise(resolve => {
    let status
    const req = http.request({ host: '127.0.0.1', port, path, method: 'POST', headers: { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(body) } }, res => {
      status = res.statusCode
      res.resume()
      res.on('end', () => resolve({ status }))
      res.on('error', () => resolve({ status }))
    })
    req.on('error', () => resolve({ status }))
    req.end(body)
  })
}

// The close frame a closed SockJS session answers a poll with (the messages
// queued for it come first)
async function pollClose (base) {
  let frame
  for (let i = 0; i < 5 && !frame?.startsWith('c'); i++) {
    frame = await (await fetch(base + '/xhr', { method: 'POST' })).text()
  }
  return frame ?? ''
}

// Streams `total` bytes in a chunked POST; resolves with the response status
// and how much was written before the server stopped the request
function postChunked (port, path, total) {
  return new Promise((resolve, reject) => {
    let sent = 0
    let status
    const req = http.request({ host: '127.0.0.1', port, path, method: 'POST', headers: { 'Content-Type': 'text/plain' } }, res => {
      status = res.statusCode
      res.resume()
      res.on('end', () => resolve({ status, sent }))
    })
    req.on('error', () => resolve({ status, sent }))
    const chunk = Buffer.alloc(16 * 1024, 'x')
    function writeMore () {
      for (;;) {
        if (status !== undefined) return
        if (sent >= total) return req.end()
        sent += chunk.length
        if (!req.write(chunk)) return req.once('drain', () => setTimeout(writeMore, 1))
      }
    }
    writeMore()
  })
}

class StubWebSocket {
  constructor (url) {
    this.url = url
    this.readyState = 0
    this.sent = []
    StubWebSocket.sockets.push(this)
  }

  open () {
    this.readyState = 1
    this.onopen?.({})
  }

  serverClose (code) {
    this.readyState = 3
    this.onclose?.({ code, wasClean: true, reason: '' })
  }

  close () {
    this.readyState = 3
  }

  send (data) {
    this.sent.push(data)
  }
}

async function withStubWebSocket (fn) {
  const real = globalThis.WebSocket
  StubWebSocket.sockets = []
  globalThis.WebSocket = StubWebSocket
  try {
    return await fn(StubWebSocket.sockets)
  } finally {
    globalThis.WebSocket = real
  }
}
