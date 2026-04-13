import { readFileSync } from 'fs'
import { createClient, createSentinel } from 'redis'

export function getNodeRedis ({ opts, url }) {
  const parsedOpts = typeof opts === 'string' ? JSON.parse(opts) : opts

  let client

  if (parsedOpts?.sentinels) {
    client = createSentinel(_getSentinelOptions(parsedOpts))
  } else if (url) {
    client = createClient({ url })
  }

  if (!client) {
    throw new Error('[@teamplay/backend] REDIS_URL or REDIS_OPTS is required when Redis pubsub is enabled')
  }

  client.on('error', error => {
    console.error('[@teamplay/backend] Redis pubsub client error:', error)
  })

  return client
}

function _getSentinelOptions (opts) {
  const tls = _getTlsOptions(opts)
  const socket = tls ? { tls: true, ...tls } : undefined
  const sentinelRootNodes = opts.sentinels.map(sentinel => ({
    host: sentinel.host || sentinel.hostname || sentinel.ip || sentinel.address,
    port: Number(sentinel.port || opts.sentinel_port || 26379)
  }))

  return {
    name: opts.name || 'mymaster',
    sentinelRootNodes,
    nodeClientOptions: {
      socket,
      username: opts.username,
      password: opts.password,
      database: opts.db || 0
    },
    sentinelClientOptions: {
      socket,
      username: opts.sentinelUsername,
      password: opts.sentinelPassword
    }
  }
}

function _getTlsOptions (opts) {
  if (!opts?.key) return

  return {
    key: readFileSync(opts.key),
    cert: readFileSync(opts.cert),
    ca: readFileSync(opts.ca)
  }
}
