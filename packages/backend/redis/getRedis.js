import { readFileSync } from 'fs'
import Redis from 'ioredis'
import RedisMock from 'ioredis-mock'

export { Redis, RedisMock }

export function getRedis ({ enable = true, opts, url, keyPrefix, ...additionalOptions }) {
  if (enable) {
    if (typeof opts === 'string') {
      opts = JSON.parse(opts)
      let tls = {}

      if (opts.key) {
        tls = {
          key: readFileSync(opts.key),
          cert: readFileSync(opts.cert),
          ca: readFileSync(opts.ca)
        }
      }

      const options = {
        sentinels: opts.sentinels,
        sslPort: opts.ssl_port || '6380',
        tls,
        name: 'mymaster',
        db: opts.db || 0,
        password: opts.password,
        ...additionalOptions
      }

      _maybeAddKeyPrefixToOptions(options, keyPrefix)

      return new Redis(options)
    } else if (url) {
      const options = { ...additionalOptions }
      _maybeAddKeyPrefixToOptions(options, keyPrefix)

      return new Redis(url, options)
    }
  }

  const options = { ...additionalOptions }
  _maybeAddKeyPrefixToOptions(options, keyPrefix)

  return new RedisMock(options)
}

function _maybeAddKeyPrefixToOptions (options, keyPrefix) {
  if (keyPrefix) options.keyPrefix = keyPrefix
}
