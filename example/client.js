import { createElement as el, Fragment } from 'react'
import { createRoot } from 'react-dom/client'
import connect from 'teamplay/connect'
import { observer, $, sub } from 'teamplay'

connect()

const App = observer(({ userId }) => {
  const $user = sub($.users[userId])
  if (!$user.get()) throw $user.set({ points: 0 })
  const { $points } = $user
  const increment = () => $points.set($points.get() + 1)
  const reset = () => $points.set(0)
  return el(Fragment, null,
    el('button', { onClick: increment }, 'Points: ' + $points.get()),
    el('button', { onClick: reset }, 'Reset')
  )
})

const container = document.body.appendChild(document.createElement('div'))
createRoot(container).render(
  el(App, { userId: '_1' })
)
