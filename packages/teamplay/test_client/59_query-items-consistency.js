// A query's items agree with each other at every render: $query.get(),
// $query.getIds() and the doc signals of an iteration over the query list the
// same docs in the same order, and every one of them exists. A result whose
// doc does not exist (deleted on this client or by another one, or deleted
// while the query results were on their way) is left out of all of them
// until it exists again; it is never a hole in the list.
import { createElement as el } from 'react'
import { afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals'
import { act, cleanup, render } from '@testing-library/react'
import { raw } from '@nx-js/observer-util'
import { $, observer, sub, unsub, useSub } from '../src/index.ts'
import { getConnection } from '../src/orm/connection.ts'
import connect from '../src/connect/test.js'

jest.setTimeout(20000)

const COLLECTION = 'consistencyGames'
const wait = ms => act(async () => { await new Promise(resolve => setTimeout(resolve, ms)) })

let backend
let writer
beforeAll(() => {
  connect()
  backend = getConnection().agent.backend
  writer = backend.connect()
})

const releases = []
afterEach(async () => {
  cleanup()
  for (const release of releases.splice(0)) await release()
})

function cbPromise (fn) {
  return new Promise((resolve, reject) => fn(err => err ? reject(err) : resolve()))
}

// created and deleted through another client
async function writeDoc (id, data) {
  const doc = writer.get(COLLECTION, id)
  await cbPromise(cb => doc.fetch(cb))
  if (data === undefined) return cbPromise(cb => doc.del(cb))
  if (doc.type) return cbPromise(cb => doc.submitOp([{ p: ['name'], od: doc.data.name, oi: data.name }], cb))
  return cbPromise(cb => doc.create(data, cb))
}

// Delays query diffs (removals, inserts) on the client connection, the way
// network latency does.
function holdQueryDiffs () {
  const connection = getConnection()
  const handleMessage = connection.handleMessage
  const queued = []
  let holding = true
  connection.handleMessage = function (message) {
    if (holding && message?.a === 'q') return queued.push(message)
    return handleMessage.call(this, message)
  }
  const release = () => {
    if (!holding) return
    holding = false
    delete connection.handleMessage
    for (const message of queued.splice(0)) connection.handleMessage(message)
  }
  releases.push(release)
  return release
}

// Holds the results of the next query that lists `docId` after the server
// read them.
function holdQueryResults (docId) {
  let release
  let reached
  const released = new Promise(resolve => { release = resolve })
  const reachedPromise = new Promise(resolve => { reached = resolve })
  let held = false
  const middleware = (request, next) => {
    if (held || request.collection !== COLLECTION) return next()
    if (!request.snapshots.some(snapshot => snapshot.id === docId && snapshot.type != null)) return next()
    held = true
    reached()
    released.then(() => next())
  }
  backend.use('readSnapshots', middleware)
  releases.push(() => {
    release()
    const list = backend.middleware.readSnapshots
    list.splice(list.indexOf(middleware), 1)
  })
  return { reached: reachedPromise, release }
}

// Renders a query the way apps do (mapping $query.get(), iterating the query
// signal) and records, at every render, any disagreement between them.
function createGames () {
  const problems = []
  const renders = []
  const Games = observer(function Games ({ kind }) {
    const $games = useSub($[COLLECTION], { kind, $sort: { n: 1 } })
    const ids = $games.getIds()
    const docs = $games.get()
    const iterated = []
    for (const $game of $games) iterated.push([$game.getId(), $game.get()])
    const mapped = $games.map($game => $game.getId())
    if (docs.length !== ids.length) problems.push(`get() lists ${docs.length} docs, getIds() ${ids.length}`)
    docs.forEach((doc, index) => {
      if (!doc) problems.push(`get()[${index}] is ${doc}`)
      else if (doc._id !== ids[index]) problems.push(`get()[${index}] is ${doc._id}, getIds() has ${ids[index]}`)
    })
    iterated.forEach(([id, doc], index) => {
      if (!doc) problems.push(`the doc signal of ${id} reads ${doc}`)
      else if (raw(doc) !== raw(docs[index])) problems.push(`iteration item ${index} (${id}) is not get()[${index}]`)
    })
    if (mapped.join() !== ids.join()) problems.push(`map() gives ${mapped.join()}, getIds() ${ids.join()}`)
    // what an app does: crashes on a hole
    const text = docs.map(doc => doc.name).join(',')
    renders.push(text)
    return el('span', { id: 'result' }, text)
  }, { suspenseProps: { fallback: el('span', { id: 'result' }, 'loading') } })
  return { Games, problems, renders }
}

async function waitForResult (container, text, timeout = 2000) {
  const start = Date.now()
  while (container.querySelector('#result')?.textContent !== text && Date.now() - start < timeout) await wait(20)
  expect(container.querySelector('#result')?.textContent).toBe(text)
}

describe('the items of a query agree at every render', () => {
  it('through a local delete, a remote delete and a create again', async () => {
    const kind = `kind_${Date.now()}`
    const ids = ['a', 'b', 'c'].map(name => `${name}_${kind}`)
    await writeDoc(ids[0], { kind, name: 'A', n: 1 })
    await writeDoc(ids[1], { kind, name: 'B', n: 2 })
    await writeDoc(ids[2], { kind, name: 'C', n: 3 })
    const { Games, problems } = createGames()
    const { container } = render(el(Games, { kind }))
    await waitForResult(container, 'A,B,C')
    const $a = await sub($[COLLECTION][ids[0]])

    // the server's removals and inserts arrive later
    const releaseDiffs = holdQueryDiffs()
    await act(async () => { await $a.del() })
    await waitForResult(container, 'B,C')

    await act(async () => { await writeDoc(ids[1]) })
    await waitForResult(container, 'C')

    await act(async () => { await $a.set({ kind, name: 'A again', n: 1 }) })
    await waitForResult(container, 'A again,C')

    await act(async () => { releaseDiffs() })
    await wait(100)
    await waitForResult(container, 'A again,C')
    expect(problems).toEqual([])
    await unsub($a)
  })

  it('when a doc of the results was deleted while the results were on their way', async () => {
    const kind = `kind_race_${Date.now()}`
    const ids = ['a', 'b'].map(name => `${name}_${kind}`)
    await writeDoc(ids[0], { kind, name: 'A', n: 1 })
    await writeDoc(ids[1], { kind, name: 'B', n: 2 })
    const $a = await sub($[COLLECTION][ids[0]])
    const { Games, problems } = createGames()

    const results = holdQueryResults(ids[0])
    const releaseDiffs = holdQueryDiffs()
    const { container } = render(el(Games, { kind }))
    await act(async () => { await results.reached })
    await act(async () => { await $a.del() })
    await act(async () => { results.release() })
    await waitForResult(container, 'B')

    await act(async () => { releaseDiffs() })
    await wait(100)
    await waitForResult(container, 'B')
    expect(problems).toEqual([])
    await unsub($a)
  })
})
