import http from 'http'
import { createBackend, initConnection } from 'teamplay/server'
import esbuild from 'esbuild'

const server = http.createServer()
const backend = createBackend()
const { upgrade } = initConnection(backend)

server.on('upgrade', upgrade)

const bundleClientJs = async () => {
  const result = await esbuild.build({
    entryPoints: ['./client.js'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    banner: {
      js: 'var global = window;'
    }
  })
  return result.outputFiles[0].text
}

let clientJsContent = null

server.on('request', async (req, res) => {
  if (req.url === '/client.js') {
    if (!clientJsContent) clientJsContent = await bundleClientJs()
    res.setHeader('Content-Type', 'application/javascript')
    res.end(clientJsContent)
  } else {
    res.setHeader('Content-Type', 'text/html')
    res.end('<script type="module" src="/client.js"></script>')
  }
})

server.listen(3000, () => {
  console.log('Server started. Open http://localhost:3000 in your browser')
})
