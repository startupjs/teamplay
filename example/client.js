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
  return <>
    <button onClick={increment}>Points: {$points.get()}</button>
    <button onClick={reset}>Reset</button>
  </>
})

const container = document.body.appendChild(document.createElement('div'))
createRoot(container).render(<App userId='_1' />)