import { it, describe, beforeEach, afterEach } from 'mocha'
import { strict as assert } from 'node:assert'
import { getForceDefer, setForceDefer } from '../src/index.ts'
import { configureTeamplay, getTeamplayConfig, TEAMPLAY_RUNTIME_CONFIG_SYMBOL } from '../src/config.ts'
import { __resetForceDeferForTests } from '../src/react/forceDefer.ts'

// forceDefer (React subscription hooks ignore `defer: false`) can come from the
// runtime config object that an app sets before (or after) it loads teamplay,
// next to idFields: globalThis[Symbol.for('teamplay.runtimeConfig')] = { forceDefer }
// (its effect on rendering: test_client/56_subscription-chain-consistency.js)
describe('forceDefer in the runtime config', () => {
  let previousConfig
  beforeEach(() => {
    previousConfig = globalThis[TEAMPLAY_RUNTIME_CONFIG_SYMBOL]
    __resetForceDeferForTests()
  })
  afterEach(() => {
    if (previousConfig === undefined) delete globalThis[TEAMPLAY_RUNTIME_CONFIG_SYMBOL]
    else globalThis[TEAMPLAY_RUNTIME_CONFIG_SYMBOL] = previousConfig
    __resetForceDeferForTests()
  })

  function setRuntimeConfig (config) {
    globalThis[TEAMPLAY_RUNTIME_CONFIG_SYMBOL] = { ...previousConfig, ...config }
  }

  it('is off without it', () => {
    setRuntimeConfig({})
    assert.equal(getForceDefer(), false)
    assert.equal(getTeamplayConfig().forceDefer, false)
  })

  it('applies when the app sets it, also after teamplay loaded', () => {
    setRuntimeConfig({ forceDefer: true })
    assert.equal(getForceDefer(), true)
    assert.equal(getTeamplayConfig().forceDefer, true)
  })

  it('is overridden by setForceDefer() until it is reset with null', () => {
    setRuntimeConfig({ forceDefer: true })
    assert.equal(setForceDefer(false), false)
    assert.equal(getForceDefer(), false)
    assert.equal(setForceDefer(null), true)
    assert.equal(getForceDefer(), true)
  })

  it('can be set with configureTeamplay() and removed with null', () => {
    setRuntimeConfig({})
    configureTeamplay({ forceDefer: true })
    assert.equal(getForceDefer(), true)
    configureTeamplay({ forceDefer: null })
    assert.equal(getForceDefer(), false)
    assert.equal('forceDefer' in globalThis[TEAMPLAY_RUNTIME_CONFIG_SYMBOL], false)
  })

  it('must be a boolean', () => {
    setRuntimeConfig({})
    for (const value of [1, 'true', {}]) {
      assert.throws(() => configureTeamplay({ forceDefer: value }), /expects a boolean/)
      assert.throws(() => setForceDefer(value), /expects a boolean/)
    }
    setRuntimeConfig({ forceDefer: 'true' })
    assert.throws(() => getForceDefer(), /runtime config forceDefer expects a boolean/)
  })
})
