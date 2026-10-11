// Shared by the access control tests that talk ShareDB's protocol: a backend
// with read rules, remote clients, raw protocol messages and their replies.
import assert from 'node:assert/strict'
import ShareDB from 'sharedb'
import { Connection } from 'sharedb/lib/client/index.js'
import StreamSocket from 'sharedb/lib/stream-socket.js'
import ShareDbMingo from '@startupjs/sharedb-mingo-memory'
import { accessControl } from '@teamplay/utils/accessControl'
import initAccessControl from '../../backend/features/accessControl.js'

export const PRIVATE_PHONE = '+380509999999'
export const PRIVATE_NOTE = 'private note'

// The setup @teamplay/backend makes without `secure` (open by default) plus
// forced rules: only the owner reads a contact; the owner, or a session that
// may annotate, updates it. A post is read unless it is hidden (the rule
// passes an empty doc). `backend.accessControl` is the middleware instance.
export function createBackendWithRules () {
  const backend = new ShareDB({ db: new ShareDbMingo() })
  backend.use('connect', (context, next) => {
    context.agent.connectSession = context.req?.session
    next()
  })
  const models = {
    contacts: {
      access: accessControl({
        create: () => true,
        read: ({ doc, session }) => doc.ownerId === session.userId,
        update: ({ doc, session }) => doc.ownerId === session.userId || session.mayAnnotate === true,
        delete: ({ doc, session }) => doc.ownerId === session.userId
      }, { force: true })
    },
    posts: {
      access: accessControl({
        create: () => true,
        read: ({ doc }) => !doc.hidden
      }, { force: true })
    }
  }
  const log = console.log
  console.log = () => {}
  try {
    backend.accessControl = initAccessControl(backend, { models, forceOnly: true, openByDefault: true })
  } finally {
    console.log = log
  }
  return backend
}

// A remote client: its stream is not a server stream
export function connectClient (backend, session, connection) {
  const socket = new StreamSocket()
  socket.stream.isServer = false
  if (connection) connection.bindToSocket(socket)
  else connection = new Connection(socket)
  socket._open()
  connection.agent = backend.listen(socket.stream, { session })
  return connection
}

export function countSnapshotReads (backend) {
  const db = backend.db
  const counter = {
    count: 0,
    ids: 0,
    reset () {
      counter.count = 0
      counter.ids = 0
    }
  }
  const getSnapshot = db.getSnapshot
  const getSnapshotBulk = db.getSnapshotBulk
  db.getSnapshot = function (collection, id, fields, ...rest) {
    // a submit reads the snapshot it applies the op to: not a read for a client
    if (!fields?.$submit) {
      counter.count++
      counter.ids++
    }
    return getSnapshot.call(this, collection, id, fields, ...rest)
  }
  db.getSnapshotBulk = function (collection, ids, ...rest) {
    counter.count++
    counter.ids += ids.length
    // the default bulk read calls getSnapshot per id: count the bulk once
    const single = db.getSnapshot
    db.getSnapshot = getSnapshot
    try {
      return getSnapshotBulk.call(this, collection, ids, ...rest)
    } finally {
      db.getSnapshot = single
    }
  }
  return counter
}

export function recordMessages (connection) {
  const messages = []
  connection.on('receive', request => messages.push(request.data))
  return messages
}

export function assertNoPrivateData (messages) {
  const text = JSON.stringify(messages)
  assert.ok(!text.includes(PRIVATE_PHONE), 'a message carries the phone: ' + text)
  assert.ok(!text.includes(PRIVATE_NOTE), 'a message carries the note: ' + text)
}

// Sends a raw protocol message and resolves with its reply, which the client
// connection then ignores (it did not make the request)
export function sendRaw (connection, message, isReply = defaultIsReply(message)) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('No reply to ' + JSON.stringify(message))), 2000)
    connection.on('receive', function onReceive (request) {
      const data = request.data
      if (!data || !isReply(data)) return
      clearTimeout(timer)
      connection.removeListener('receive', onReceive)
      request.data = null
      resolve(data)
    })
    whenConnected(connection, () => connection.send(message))
  })
}

export function defaultIsReply (message) {
  return reply => {
    if (reply.a !== message.a) return false
    if (message.id != null) return reply.id === message.id
    if (message.b != null) return reply.c === message.c && !('d' in reply)
    return reply.c === message.c && reply.d === message.d && !('v' in reply && 'op' in reply)
  }
}

export function whenConnected (connection, fn) {
  if (connection.canSend) return fn()
  connection.once('connected', fn)
}

export function create (doc, data) {
  return new Promise((resolve, reject) => doc.create(data, error => error ? reject(error) : resolve()))
}

export function submit (doc, op) {
  return new Promise((resolve, reject) => doc.submitOp(op, error => error ? reject(error) : resolve()))
}

export function del (doc) {
  return new Promise((resolve, reject) => doc.del(error => error ? reject(error) : resolve()))
}

export function fetch (doc) {
  return new Promise((resolve, reject) => doc.fetch(error => error ? reject(error) : resolve()))
}

export function subscribe (doc) {
  return new Promise((resolve, reject) => doc.subscribe(error => error ? reject(error) : resolve()))
}

export function onceReady (query) {
  return new Promise((resolve, reject) => {
    query.once('ready', resolve)
    query.once('error', reject)
  })
}

export async function waitUntil (condition, timeout = 2000) {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeout) throw new Error('Timed out waiting for ' + condition)
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

// Lets in-flight ops reach the clients (in-memory transport, a few ticks)
export function settle () {
  return new Promise(resolve => setTimeout(resolve, 50))
}

export function silenceShareDbLogger () {
  const methods = { info: ShareDB.logger.info, warn: ShareDB.logger.warn, error: ShareDB.logger.error }
  ShareDB.logger.setMethods({ info () {}, warn () {}, error () {} })
  return () => ShareDB.logger.setMethods(methods)
}

// Holds the bulk snapshot reads of `collection` (the access checks' reads)
// until release()
export function holdSnapshotReads (backend, collection) {
  const db = backend.db
  const getSnapshotBulk = db.getSnapshotBulk
  const held = []
  let holding = true
  db.getSnapshotBulk = function (readCollection, ...args) {
    if (!holding || readCollection !== collection) return getSnapshotBulk.call(this, readCollection, ...args)
    held.push(() => getSnapshotBulk.call(this, readCollection, ...args))
  }
  return {
    release () {
      holding = false
      db.getSnapshotBulk = getSnapshotBulk
      for (const read of held.splice(0)) read()
    }
  }
}
