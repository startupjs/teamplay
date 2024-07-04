# Full-stack example

Here's a basic example demonstrating how to use TeamPlay with React and server synchronization:

## Client-side (client.js)

```js
import { createRoot } from 'react-dom/client'
import connect from 'teamplay/connect'
import { observer, $, useSub } from 'teamplay'

connect()

const App = observer(({ userId }) => {
  const $user = useSub($.users[userId])
  if (!$user.get()) throw $user.set({ points: 0 })
  const { $points } = $user
  const increment = () => $points.set($points.get() + 1)
  return <button onClick={increment}>Points: {$points.get()}</button>
})

const container = document.body.appendChild(document.createElement('div'))
createRoot(container).render(<App userId='_1' />)
```

## Server-side (server.js)

```js
import http from 'http'
import { createBackend, initConnection } from 'teamplay/server'

const server = http.createServer() // you can pass expressApp here if needed
const backend = createBackend()
const { upgrade } = initConnection(backend)

server.on('upgrade', upgrade)

server.listen(3000, () => {
  console.log('Server started. Open http://localhost:3000 in your browser')
})
```

This example demonstrates:

1. Setting up the client-side connection
2. Creating a simple React component with TeamPlay integration
3. Setting up the server-side backend and WebSocket connection handler

For more complex examples and use cases, refer to the other sections in this documentation or check out the [TeamPlay GitHub repository](https://github.com/startupjs/teamplay).
