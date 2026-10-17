// A component subscribed to a doc (directly or through a query) renders the
// data of a whole-doc replace made by another client ({ p: [] }, as
// setReplace() on a doc signal sends it), and of the ops after it: ShareDB
// sets doc.data to a new object, which the data tree follows (see Doc.js).
import { createElement as el } from 'react'
import { afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals'
import { act, cleanup, render } from '@testing-library/react'
import { $, observer, useSub } from '../src/index.ts'
import { getConnection } from '../src/orm/connection.ts'
import connect from '../src/connect/test.js'

jest.setTimeout(20000)

const COLLECTION = 'rootReplaceGames'

let writer
beforeAll(() => {
  connect()
  writer = getConnection().agent.backend.connect()
})

afterEach(() => {
  cleanup()
})

function cbPromise (fn) {
  return new Promise((resolve, reject) => fn(err => err ? reject(err) : resolve()))
}

async function create (id, data) {
  await cbPromise(cb => writer.get(COLLECTION, id).create(data, cb))
}

async function remoteOp (id, op) {
  const doc = writer.get(COLLECTION, id)
  await cbPromise(cb => doc.fetch(cb))
  await cbPromise(cb => doc.submitOp(op, cb))
}

async function remoteReplace (id, next) {
  const doc = writer.get(COLLECTION, id)
  await cbPromise(cb => doc.fetch(cb))
  await cbPromise(cb => doc.submitOp([{ p: [], od: doc.data, oi: next }], cb))
}

async function waitForText (container, text) {
  for (let i = 0; i < 200 && container.textContent !== text; i++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
  }
  expect(container.textContent).toBe(text)
}

describe('a whole-doc replace from another client', () => {
  it('re-renders a doc subscriber with the new data and the ops after it', async () => {
    const id = `doc_${Date.now()}`
    await create(id, { name: 'Ann', score: 1 })
    const Game = observer(function Game () {
      const $game = useSub($[COLLECTION][id])
      return el('span', null, `${$game.name.get()}:${$game.score.get() ?? '-'}`)
    })
    const { container } = render(el(Game))
    await waitForText(container, 'Ann:1')
    await remoteReplace(id, { name: 'Bob' })
    await waitForText(container, 'Bob:-')
    await remoteOp(id, [{ p: ['score'], oi: 5 }])
    await waitForText(container, 'Bob:5')
  })

  it('re-renders a query subscriber with the new data', async () => {
    const kind = `kind_${Date.now()}`
    const id = `query_${Date.now()}`
    await create(id, { kind, name: 'Ann' })
    const Games = observer(function Games () {
      const $games = useSub($[COLLECTION], { kind })
      return el('span', null, $games.get().map(game => game.name).join(','))
    })
    const { container } = render(el(Games))
    await waitForText(container, 'Ann')
    await remoteReplace(id, { kind, name: 'Bob' })
    await waitForText(container, 'Bob')
    await remoteOp(id, [{ p: ['name'], od: 'Bob', oi: 'Cid' }])
    await waitForText(container, 'Cid')
  })
})
