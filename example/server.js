import http from 'http'
import { createBackend, initConnection } from 'teamplay/server'
import _serveClient from './_serveClient.js'

const server = http.createServer()
const backend = createBackend()
const { upgrade } = initConnection(backend)

server.on('upgrade', upgrade)

server.listen(3000, () => {
  console.log('Server started. Open http://localhost:3000 in your browser')
})

_serveClient(server)
