import { readFileSync } from 'fs'
import Redis from 'ioredis'
import RedisMock from 'ioredis-mock'

export { Redis, RedisMock }

export function getRedis ({ enableRedis = true, redisOpts, redisUrl, keyPrefix }) {
  if (enableRedis) {
    if (typeof redisOpts === 'string') {
      redisOpts = JSON.parse(redisOpts)
      let tls = {}

      if (redisOpts.key) {
        tls = {
          key: readFileSync(redisOpts.key),
          cert: readFileSync(redisOpts.cert),
          ca: readFileSync(redisOpts.ca)
        }
      }

      const options = {
        sentinels: redisOpts.sentinels,
        sslPort: redisOpts.ssl_port || '6380',
        tls,
        name: 'mymaster',
        db: redisOpts.db || 0,
        password: redisOpts.password
      }

      _maybeAddKeyPrefixToOptions(options, keyPrefix)

      return new Redis(options)
    } else if (redisUrl) {
      const options = {}
      _maybeAddKeyPrefixToOptions(options, keyPrefix)

      return new Redis(redisUrl, options)
    }
  }

  const options = {}
  _maybeAddKeyPrefixToOptions(options, keyPrefix)

  return new RedisMock(options)
}

function _maybeAddKeyPrefixToOptions (options, keyPrefix) {
  if (keyPrefix) options.keyPrefix = keyPrefix
}
