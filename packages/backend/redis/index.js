import Redlock from 'redlock'
import redisPubSub from 'sharedb-redis-pubsub'
import { getRedis, Redis, RedisMock } from './getRedis.js'

const enableRedis = !process.env.NO_REDIS

const getRedisOptions = {
  enableRedis,
  redisOpts: process.env.REDIS_OPTS,
  redisUrl: process.env.REDIS_URL,
  keyPrefix: generatePrefix({
    mongoUrl: process.env.MONGO_URL,
    baseUrl: process.env.BASE_URL
  })
}

const RedisClient = enableRedis ? Redis : RedisMock
export { RedisClient as Redis }
export { getRedis }
export const redis = getRedis(getRedisOptions)
export const redisObserver = getRedis(getRedisOptions)

export const pubsub = redisPubSub({
  client: redis,
  observer: redisObserver
})

export const redlock = getRedlock(redis)

export { Redlock }

function getRedlock (redis) {
  return new Redlock([redis], {
    driftFactor: 0.01,
    retryCount: 2,
    retryDelay: 10,
    retryJitter: 10
  })
}

// Use prefix for ShareDB's pubsub. This prevents issues with multiple
// projects using the same redis db.
// We use a combination of MONGO_URL and BASE_URL to generate a simple
// hash because together they are going to be unique no matter whether
// it's run on localhost or on the production server.
// ref: https://github.com/share/sharedb/issues/420
function generatePrefix ({ mongoUrl, baseUrl }) {
  return '_' + simpleNumericHash('' + mongoUrl + baseUrl)
}

// ref: https://gist.github.com/hyamamoto/fd435505d29ebfa3d9716fd2be8d42f0?permalink_comment_id=2694461#gistcomment-2694461
function simpleNumericHash (s) {
  let i, h
  for (i = 0, h = 0; i < s.length; i++) h = Math.imul(31, h) + s.charCodeAt(i) | 0
  return h
}
