// simple bundler for client.js with live reload
import esbuild from 'esbuild'
import { watch } from 'fs'

let cache
const reloadClients = new Set()

export default function serveClient (server) {
  server.on('request', async (req, res) => {
    if (req.url === '/client.js') {
      res.setHeader('Content-Type', 'application/javascript')
      res.end(await bundleClientJs())
    } else if (req.url === '/reload') {
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')
      const reload = () => res.write('data: \n\n')
      reloadClients.add(reload)
      req.on('close', () => reloadClients.delete(reload))
    } else {
      res.setHeader('Content-Type', 'text/html')
      res.end('<script type="module" src="/client.js"></script>')
    }
  })
}

async function bundleClientJs () {
  cache ??= esbuild.build({
    entryPoints: ['./client.js'],
    bundle: true,
    write: false,
    format: 'esm',
    jsx: 'automatic',
    loader: { '.js': 'jsx' },
    banner: {
      js: `
        var global = window;
        (new EventSource('/reload')).onmessage = () => window.location.reload();
      `
    }
  })
  return (await cache).outputFiles[0].text
}

watch('./client.js', () => {
  cache = undefined
  for (const reload of reloadClients) reload()
})
