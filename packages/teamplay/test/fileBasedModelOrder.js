import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const TEST_DIR = dirname(fileURLToPath(import.meta.url))
const TEAMPLAY_DIR = join(TEST_DIR, '..')
const PACKAGES_DIR = join(TEAMPLAY_DIR, '..')
const COMPLEX_MODELS_FIXTURE = join(PACKAGES_DIR, 'babel-plugin-teamplay', 'test', 'fixtures', 'complex-ts')
const EXPECTED_COMPLEX_KEYS = ['_session', '_session.connection', 'events', 'events.*', 'events.*.comments.*']

describe('file-based model initialization order', function () {
  this.timeout(10000)

  it('does not load file-based models from the root teamplay import on Node', () => {
    const result = runInFixture(`
      const teamplay = await import('teamplay')
      console.log(JSON.stringify(Object.keys(teamplay.getModels()).sort()))
    `)

    assert.deepEqual(result, [])
  })

  it('does not load or initialize file-based models from createBackend()', () => {
    const result = runInFixture(`
      const { createBackend } = await import('teamplay/server')
      createBackend({
        flushRedis: false,
        accessControl: false,
        serverAggregate: false,
        validateSchema: false
      })
      const teamplay = await import('teamplay')
      console.log(JSON.stringify(Object.keys(teamplay.getModels()).sort()))
      setTimeout(() => process.exit(0), 50)
    `)

    assert.deepEqual(result, [])
  })

  it('supports explicit file-based model initialization before importing root teamplay', () => {
    const result = runInFixture(`
      const models = (await import('teamplay/file-based-models')).default
      const teamplay = await import('teamplay')
      teamplay.initModels(models)

      console.log(JSON.stringify({
        keys: Object.keys(teamplay.getModels()).sort(),
        collectionClassName: teamplay.getSignalClass(['events']).name,
        documentClassName: teamplay.getSignalClass(['events', '123']).name
      }))
    `)

    assert.deepEqual(result, {
      keys: EXPECTED_COMPLEX_KEYS,
      collectionClassName: 'EventsModel',
      documentClassName: 'EventModel'
    })
  })

  it('lets createBackend() reuse explicitly initialized models without owning initialization', () => {
    const result = runInFixture(`
      const teamplay = await import('teamplay')
      const models = (await import('teamplay/file-based-models')).default
      teamplay.initModels(models)

      const { createBackend } = await import('teamplay/server')
      createBackend({
        flushRedis: false,
        accessControl: false,
        serverAggregate: false,
        validateSchema: false
      })

      console.log(JSON.stringify(Object.keys(teamplay.getModels()).sort()))
      setTimeout(() => process.exit(0), 50)
    `)

    assert.deepEqual(result, EXPECTED_COMPLEX_KEYS)
  })

  it('uses explicitly passed registry models without loading file-based models', () => {
    const result = runInFixture(`
      const teamplay = await import('teamplay')
      const { initModels: initRegistryModels } = await import('teamplay/orm')
      class RegistryEvents extends teamplay.Signal {}
      const registryModels = { events: { default: RegistryEvents } }

      initRegistryModels(registryModels)

      const { createBackend } = await import('teamplay/server')
      createBackend({
        models: registryModels,
        flushRedis: false,
        accessControl: false,
        serverAggregate: false,
        validateSchema: false
      })

      console.log(JSON.stringify({
        keys: Object.keys(teamplay.getModels()).sort(),
        registeredDefaultName: teamplay.getSignalClass(['events']).name
      }))
      setTimeout(() => process.exit(0), 50)
    `)

    assert.deepEqual(result, {
      keys: ['events'],
      registeredDefaultName: 'RegistryEvents'
    })
  })
})

function runInFixture (source) {
  const root = mkdtempSync(join(tmpdir(), 'teamplay-order-'))

  try {
    cpSync(COMPLEX_MODELS_FIXTURE, root, { recursive: true })
    mkdirSync(join(root, 'node_modules'), { recursive: true })
    symlinkSync(TEAMPLAY_DIR, join(root, 'node_modules', 'teamplay'), 'dir')
    symlinkSync(join(PACKAGES_DIR, 'babel-plugin-teamplay'), join(root, 'node_modules', 'babel-plugin-teamplay'), 'dir')

    const result = spawnSync(process.execPath, ['-C', 'teamplay-ts', '--input-type=module', '--eval', withErrorHandling(source)], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        NO_REDIS: '1',
        NO_MONGO: '1',
        DB_READONLY: '1'
      }
    })

    assert.equal(result.status, 0, result.stderr)
    return JSON.parse(getLastStdoutLine(result.stdout))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function withErrorHandling (source) {
  return `
    process.on('uncaughtException', err => {
      if (/Redis is already connecting/.test(err.message)) {
        return setTimeout(() => process.exit(0), 20)
      }
      console.error(err)
      process.exit(1)
    })

    ${source}
  `
}

function getLastStdoutLine (stdout) {
  const line = stdout
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .pop()
  assert.ok(line, 'Expected child process to print a JSON result')
  return line
}
