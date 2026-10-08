// useSub() defers by default (useDeferredValue): when its signal or query
// changes, the component keeps rendering the previous signal until the new
// subscription is ready, without suspending. With subscriptions that depend
// on each other (a user, then the user's course, then the course's lesson),
// switching the first one therefore never shows the Suspense fallback and
// never renders a document that is not loaded, and it switches the whole
// chain at once: the deferred render suspends on each new subscription in
// turn while the previous chain stays on screen, and commits once every one
// is ready (56_subscription-chain-consistency.js covers queries, batches and
// the other defer modes).
import { createElement as el, Fragment, useLayoutEffect } from 'react'
import { afterEach, beforeAll, describe, expect, it } from '@jest/globals'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { $, observer, useSub } from '../src/index.ts'
import { setTestThrottling, resetTestThrottling } from '../src/react/useSub.ts'
import { getConnection } from '../src/orm/connection.ts'
import connect from '../src/connect/test.js'

const wait = ms => act(async () => { await new Promise(resolve => setTimeout(resolve, ms)) })

async function createDoc (collection, id, data) {
  const doc = getConnection().get(collection, id)
  await new Promise((resolve, reject) => doc.fetch(err => err ? reject(err) : resolve()))
  if (doc.type == null) await new Promise((resolve, reject) => doc.create(data, err => err ? reject(err) : resolve()))
}

beforeAll(async () => {
  connect()
  await createDoc('chainUsers', 'u1', { name: 'U1', courseId: 'c1' })
  await createDoc('chainUsers', 'u2', { name: 'U2', courseId: 'c2' })
  await createDoc('chainCourses', 'c1', { name: 'C1', lessonId: 'l1' })
  await createDoc('chainCourses', 'c2', { name: 'C2', lessonId: 'l2' })
  await createDoc('chainLessons', 'l1', { name: 'L1' })
  await createDoc('chainLessons', 'l2', { name: 'L2' })
})
afterEach(cleanup)
afterEach(resetTestThrottling)

async function waitForText (container, text) {
  for (let i = 0; i < 50 && container.querySelector('#chain')?.textContent !== text; i++) await wait(20)
  expect(container.querySelector('#chain')?.textContent).toBe(text)
}

describe('dependent useSub() calls (deferred by default)', () => {
  it('switching the first one keeps the previous documents, without a fallback, until the chain is loaded', async () => {
    // every subscription takes a while
    setTestThrottling(40)
    const commits = []
    function Fallback () {
      useLayoutEffect(() => { commits.push('fallback') })
      return el('span', {}, 'Loading...')
    }
    const Chain = observer(function Chain () {
      const $userId = $('u1')
      const $user = useSub($.chainUsers[$userId.get()])
      const $course = useSub($.chainCourses[$user.courseId.get()])
      const $lesson = useSub($.chainLessons[$course.lessonId.get()])
      const text = [$user.name.get(), $course.name.get(), $lesson.name.get()].join('/')
      useLayoutEffect(() => { commits.push(text) })
      return el(Fragment, {},
        el('span', { id: 'chain' }, text),
        el('button', { id: 'switch', onClick: () => $userId.set('u2') })
      )
    }, { suspenseProps: { fallback: el(Fallback) } })
    const { container } = render(el(Chain))
    await waitForText(container, 'U1/C1/L1')

    commits.length = 0
    fireEvent.click(container.querySelector('#switch'))
    await waitForText(container, 'U2/C2/L2')
    expect(commits).not.toContain('fallback')
    // the previous chain, then the new one: never a mix of the two
    for (const text of commits) expect(['U1/C1/L1', 'U2/C2/L2']).toContain(text)
    expect(commits.at(-1)).toBe('U2/C2/L2')
  })
})
