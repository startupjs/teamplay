import babel from '@babel/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import plugin from '../index.js'
import loader from '../loader.js'

const {
  discoverModels,
  generateTeamplayEnv,
  loadFileBasedModels,
  loadFileBasedModelsSync
} = loader

const TEST_DIR = dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = join(TEST_DIR, 'fixtures')
const require = createRequire(import.meta.url)

describe('babel-plugin-teamplay', () => {
  let root

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'teamplay-models-'))
    mkdirSync(join(root, 'src'), { recursive: true })
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('generates static imports for file-based models', () => {
    useFixture(root, 'complex-ts')

    expect(transformVirtualImports({
      root,
      autoInit: false,
      types: false
    })).toMatchSnapshot()
  })

  it('generates require.context loading code', () => {
    useFixture(root, 'complex-ts')

    expect(transformVirtualImports({
      root,
      autoInit: true,
      types: false,
      useRequireContext: true
    })).toMatchSnapshot()
  })

  it('uses the legacy fallback folder with a warning', () => {
    const warnings = []
    useFixture(root, 'legacy-js')

    const models = discoverModels({ root, warn: message => warnings.push(message) })

    expect(Object.keys(models).sort()).toEqual(['users', 'users.*'])
    expect(warnings).toMatchSnapshot()
  })

  it('generates teamplay-env.d.ts with schema field jsdoc', () => {
    useFixture(root, 'complex-ts')
    const filePath = generateTeamplayEnv({ root })

    expect(readFileSync(filePath, 'utf8')).toMatchSnapshot()
  })

  it('does not rewrite teamplay-env.d.ts when generated content is unchanged', () => {
    useFixture(root, 'complex-ts')
    const filePath = generateTeamplayEnv({ root })
    const oldTime = new Date('2000-01-01T00:00:00.000Z')
    utimesSync(filePath, oldTime, oldTime)

    generateTeamplayEnv({ root })

    expect(statSync(filePath).mtime.getTime()).toBe(oldTime.getTime())
  })

  it('loads file-based models directly in Node', async () => {
    useFixture(root, 'simple-js')

    expect(summarizeLoadedModels(await loadFileBasedModels({ root }))).toMatchSnapshot()
  })

  it('loads file-based models synchronously in Node', () => {
    useFixture(root, 'simple-js')

    expect(summarizeLoadedModels(loadFileBasedModelsSync({ root }))).toMatchSnapshot()
  })

  it('exports synchronous Node file-based models', () => {
    useFixture(root, 'simple-js')
    const previousCwd = process.cwd()
    process.chdir(root)
    try {
      const moduleId = require.resolve('babel-plugin-teamplay/file-based-models')
      delete require.cache[moduleId]
      expect(summarizeLoadedModels(require('babel-plugin-teamplay/file-based-models'))).toMatchSnapshot()
    } finally {
      process.chdir(previousCwd)
    }
  })

  it('throws a friendly error when a model uses top-level await', () => {
    useFixture(root, 'top-level-await-js')

    expect(() => loadFileBasedModelsSync({ root })).toThrow(
      /Cannot synchronously load file-based model.*top-level await/s
    )
  })

  it('eliminates server-only model code for client builds', () => {
    expect(transformModelCode(`
      import { aggregation, accessControl, serverOnly } from 'teamplay'

      export const $$active = aggregation(({ active }) => [{ $match: { active } }])
      export const access = accessControl({ create: () => true })
      export const secret = serverOnly(() => 'secret')
    `, {
      root,
      filename: join(root, 'models', 'users.js')
    })).toMatchSnapshot()
  })

  it('eliminates default aggregation files for client builds', () => {
    expect(transformModelCode(`
      import { aggregation } from 'startupjs'

      export default aggregation(({ active }) => [{ $match: { active } }])
    `, {
      root,
      filename: join(root, 'model', 'users', '$$active.js'),
      fallbackModelsFolders: ['model']
    })).toMatchSnapshot()
  })

  it('eliminates server-only model code from nested plugin model folders', () => {
    expect(transformModelCode(`
      import { accessControl, serverOnly } from 'startupjs'

      export const access = accessControl({ create: () => true })
      export const secret = serverOnly(() => 'secret')
    `, {
      root,
      filename: join(root, 'node_modules', '@startupjs', 'plugin-example', 'model', 'users.js'),
      fallbackModelsFolders: ['model']
    })).toMatchSnapshot()
  })

  it('keeps model server code when clientOnly is false', () => {
    expect(transformModelCode(`
      import { accessControl } from 'teamplay'

      export const access = accessControl({ create: () => true })
    `, {
      root,
      filename: join(root, 'models', 'users.js'),
      clientOnly: false
    })).toMatchSnapshot()
  })

  it('transforms direct file-based models imports', () => {
    useFixture(root, 'complex-ts')

    const result = babel.transformSync(`
      import models from 'teamplay/file-based-models'
      export default models
    `, {
      filename: join(root, 'src', 'entry.js'),
      babelrc: false,
      configFile: false,
      plugins: [[plugin, {
        root,
        autoInit: false,
        types: false
      }]]
    })

    expect(result.code).toMatchSnapshot()
  })

  it('transforms direct file-based models imports with fallback folders', () => {
    useFixture(root, 'legacy-js')

    const result = babel.transformSync(`
      import models from 'teamplay/file-based-models'
      export default models
    `, {
      filename: join(root, 'src', 'entry.js'),
      babelrc: false,
      configFile: false,
      plugins: [[plugin, {
        root,
        fallbackModelsFolders: ['model'],
        autoInit: false,
        types: false,
        warn: () => {}
      }]]
    })

    expect(result.code).toMatchSnapshot()
  })
})

function transformVirtualImports (options) {
  const result = babel.transformSync(`
    import models from './teamplay.models.virtual.js'
    import autoInit from './teamplay.models.auto-init.virtual.js'
    export { models, autoInit }
  `, {
    filename: join(options.root, 'src', 'entry.js'),
    babelrc: false,
    configFile: false,
    plugins: [[plugin, options]]
  })
  return result.code
}

function transformModelCode (code, options) {
  const result = babel.transformSync(code, {
    filename: options.filename,
    babelrc: false,
    configFile: false,
    plugins: [[plugin, options]]
  })
  return result.code
}

function summarizeLoadedModels (models) {
  return Object.fromEntries(
    Object.entries(models)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([pattern, parts]) => [
        pattern,
        Object.fromEntries(
          Object.entries(parts)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([name, value]) => [name, summarizeLoadedValue(value)])
        )
      ])
  )
}

function summarizeLoadedValue (value) {
  if (typeof value === 'function') {
    return { type: 'function', name: value.name }
  }
  return value
}

function useFixture (root, name) {
  cpSync(join(FIXTURES_DIR, name), root, { recursive: true })
  mkdirSync(join(root, 'src'), { recursive: true })
}
