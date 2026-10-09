import { it, describe, before, beforeEach, afterEach } from 'mocha'
import { strict as assert } from 'node:assert'
import { $, sub, unsub, getSubscriptionGcDelay, setSubscriptionGcDelay } from '../src/index.ts'
import { configureTeamplay, getTeamplayConfig, TEAMPLAY_RUNTIME_CONFIG_SYMBOL } from '../src/config.ts'
import { __resetSubscriptionGcDelayForTests } from '../src/orm/subscriptionGcDelay.ts'
import { getConnection } from '../src/orm/connection.ts'
import connect from '../src/connect/test.js'

before(connect)

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

// The subscription GC delay can come from the runtime config object that an
// app sets before (or after) it loads teamplay, next to idFields:
// globalThis[Symbol.for('teamplay.runtimeConfig')] = { subscriptionGcDelay }
describe('subscriptionGcDelay in the runtime config', () => {
  let previousConfig
  beforeEach(() => {
    previousConfig = globalThis[TEAMPLAY_RUNTIME_CONFIG_SYMBOL]
    __resetSubscriptionGcDelayForTests()
  })
  afterEach(() => {
    if (previousConfig === undefined) delete globalThis[TEAMPLAY_RUNTIME_CONFIG_SYMBOL]
    else globalThis[TEAMPLAY_RUNTIME_CONFIG_SYMBOL] = previousConfig
    __resetSubscriptionGcDelayForTests()
  })

  function setRuntimeConfig (config) {
    globalThis[TEAMPLAY_RUNTIME_CONFIG_SYMBOL] = { ...previousConfig, ...config }
  }

  it('is 3000 ms without it', () => {
    setRuntimeConfig({})
    assert.equal(getSubscriptionGcDelay(), 3000)
    assert.equal(getTeamplayConfig().subscriptionGcDelay, 3000)
  })

  it('applies when the app sets it, also after teamplay loaded', () => {
    setRuntimeConfig({ subscriptionGcDelay: 600000 })
    assert.equal(getSubscriptionGcDelay(), 600000)
    assert.equal(getTeamplayConfig().subscriptionGcDelay, 600000)
  })

  it('is overridden by setSubscriptionGcDelay() until it is reset with null', () => {
    setRuntimeConfig({ subscriptionGcDelay: 5000 })
    setSubscriptionGcDelay(20)
    assert.equal(getSubscriptionGcDelay(), 20)
    assert.equal(setSubscriptionGcDelay(null), 5000)
    assert.equal(getSubscriptionGcDelay(), 5000)
  })

  it('can be set with configureTeamplay() and removed with null', () => {
    setRuntimeConfig({})
    configureTeamplay({ subscriptionGcDelay: 0 })
    assert.equal(getSubscriptionGcDelay(), 0)
    configureTeamplay({ subscriptionGcDelay: null })
    assert.equal(getSubscriptionGcDelay(), 3000)
    assert.equal('subscriptionGcDelay' in globalThis[TEAMPLAY_RUNTIME_CONFIG_SYMBOL], false)
  })

  it('must be a non-negative finite number', () => {
    setRuntimeConfig({})
    for (const value of [-1, Infinity, NaN, '100']) {
      assert.throws(() => configureTeamplay({ subscriptionGcDelay: value }), /non-negative finite number/)
    }
    setRuntimeConfig({ subscriptionGcDelay: '100' })
    assert.throws(() => getSubscriptionGcDelay(), /runtime config subscriptionGcDelay expects a non-negative finite number/)
  })

  it('keeps an unsubscribed doc subscribed for that long', async () => {
    const isSubscribed = () => !!getConnection().get('gcDelayConfigDocs', 'a').subscribed
    setRuntimeConfig({ subscriptionGcDelay: 150 })
    await unsub(await sub($.gcDelayConfigDocs.a))
    await wait(50)
    assert.equal(isSubscribed(), true, 'subscribed during the delay')
    await wait(200)
    assert.equal(isSubscribed(), false, 'unsubscribed after the delay')

    setRuntimeConfig({ subscriptionGcDelay: 0 })
    await unsub(await sub($.gcDelayConfigDocs.a))
    await wait(20)
    assert.equal(isSubscribed(), false, 'unsubscribed at once without a delay')
  })
})
