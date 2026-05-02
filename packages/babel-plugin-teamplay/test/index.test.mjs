import babel from '@babel/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { cpSync, lstatSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import plugin from '../index.js'
import loader from '../loader.js'
import modelPatternRules from '../modelPatternRules.js'
import { schemaRuntimeFixtureMatrix } from '../../teamplay/test/schemaFixtureMatrix.ts'

const {
  discoverModels,
  generateTeamplayEnv,
  loadFileBasedModels,
  loadFileBasedModelsSync
} = loader
const {
  getModelPatternFromRelativePath,
  getRequireContextModelPatternHelperSource,
  sanitizeAndMergeModelPatterns: sanitizeModelPatterns
} = modelPatternRules

const TEST_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(TEST_DIR, '../../..')
const TSC_BIN = join(REPO_ROOT, 'node_modules/typescript/bin/tsc')
const FIXTURES_DIR = join(TEST_DIR, 'fixtures')
const SOURCE_FILE_REGEX = /\.[mc]?[jt]sx?$/
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

  it('normalizes file model paths with shared pattern rules', () => {
    expect(getModelPatternFromRelativePath('index.ts')).toBe('')
    expect(getModelPatternFromRelativePath('users/index.ts')).toBe('users')
    expect(getModelPatternFromRelativePath('users/[id].ts')).toBe('users.*')
    expect(getModelPatternFromRelativePath('events/[id]/comments/[commentId].ts')).toBe('events.*.comments.*')
    expect(getModelPatternFromRelativePath('./_session/connection.ts')).toBe('_session.connection')
    expect(getModelPatternFromRelativePath('events/[id]/index.ts')).toBe('events.*')
    expect(getModelPatternFromRelativePath('users/-helpers/format.ts')).toBeNull()
    expect(getModelPatternFromRelativePath('users/-format.ts')).toBeNull()
  })

  it('rejects invalid file model path patterns with shared errors', () => {
    expect(() => getModelPatternFromRelativePath('users/*.ts')).toThrow(/Instead of '\*' in model filename use '\[id\]'/)
    expect(() => getModelPatternFromRelativePath('users/bad-name.ts')).toThrow(/Invalid model filename pattern: users\.bad-name/)
  })

  it('merges model, schema, access, and aggregation files through shared pattern rules', () => {
    const models = sanitizeModelPatterns({
      users: '/models/users/index.ts',
      'users.*': '/models/users/[id].ts',
      'users.schema': '/models/users/schema.ts',
      'users.access': '/models/users/access.ts',
      'users._active': '/models/users/_active.ts',
      '_session.connection': '/models/_session/connection.ts',
      'events.*.comments.*': '/models/events/[id]/comments/[commentId].ts'
    })

    expect(models.users.map(part => `${part.type}:${part.name}`)).toEqual([
      'model:users',
      'schema:schema',
      'access:access',
      'aggregation:_active'
    ])
    expect(models['users.*'].map(part => `${part.type}:${part.name}`)).toEqual(['model:*'])
    expect(models['_session.connection'].map(part => `${part.type}:${part.name}`)).toEqual(['model:connection'])
    expect(models['events.*.comments.*'].map(part => `${part.type}:${part.name}`)).toEqual(['model:*'])
  })

  it('keeps generated require.context model-pattern helpers aligned with shared rules', () => {
    const generatedHelpers = getGeneratedRequireContextHelpers()
    const paths = [
      'index.ts',
      'users/index.ts',
      'users/[id].ts',
      'events/[id]/comments/[commentId].ts',
      './_session/connection.ts',
      'events/[id]/index.ts',
      'users/-helpers/format.ts'
    ]

    for (const path of paths) {
      expect(generatedHelpers.getPattern(path)).toEqual(getModelPatternFromRelativePath(path))
    }

    expect(() => generatedHelpers.getPattern('users/*.ts')).toThrow(/Instead of '\*' in model filename use '\[id\]'/)
    expect(() => generatedHelpers.getPattern('users/bad-name.ts')).toThrow(/Invalid model filename pattern/)

    const modelPatterns = {
      users: './users/index.ts',
      'users.*': './users/[id].ts',
      'users.schema': './users/schema.ts',
      'users.access': './users/access.ts',
      'users._active': './users/_active.ts',
      '_session.connection': './_session/connection.ts'
    }
    expect(summarizeModelPatternParts(generatedHelpers.sanitizeAndMerge(modelPatterns)))
      .toEqual(summarizeModelPatternParts(sanitizeModelPatterns(modelPatterns)))
  })

  it('supports legacy $$ aggregation files with a warning', () => {
    const warnings = []
    useFixture(root, 'legacy-aggregation-js')

    const models = discoverModels({ root, warn: message => warnings.push(message) })

    expect(Object.keys(models)).toEqual(['users'])
    expect(models.users.map(part => `${part.type}:${part.name}`)).toEqual(['aggregation:$$active'])
    expect(warnings).toMatchSnapshot()
  })

  it('treats private collections starting with _ as model paths', () => {
    useFixture(root, 'complex-ts')

    const models = discoverModels({ root })

    expect(models._session.map(part => `${part.type}:${part.name}`)).toEqual(['model:_session'])
    expect(models['_session.connection'].map(part => `${part.type}:${part.name}`)).toEqual(['model:connection'])
    expect(models.events.map(part => `${part.type}:${part.name}`)).toContain('aggregation:_active')
  })

  it('supports dot notation without confusing private collections and aggregations', () => {
    useFixture(root, 'dot-notation-ts')

    const models = discoverModels({ root })

    expect(models['_session.connection'].map(part => `${part.type}:${part.name}`)).toEqual(['model:connection'])
    expect(models.events.map(part => `${part.type}:${part.name}`)).toEqual(['aggregation:_active'])
  })

  it('generates teamplay-env.d.ts with schema field jsdoc', () => {
    useFixture(root, 'complex-ts')
    const filePath = generateTeamplayEnv({ root })

    expect(readFileSync(filePath, 'utf8')).toMatchSnapshot()
  })

  it('generates env field metadata from the shared schema fixture matrix', () => {
    writeSchemaMatrixModels(root)
    const filePath = generateTeamplayEnv({ root })
    const content = readFileSync(filePath, 'utf8')

    for (const fixture of schemaRuntimeFixtureMatrix) {
      const generatedEnv = fixture.generatedEnv
      if (!generatedEnv) continue
      expect(content).toContain(JSON.stringify(generatedEnv.collectionName))
      for (const fieldName of generatedEnv.expectedFieldNames) {
        expect(content).toContain(`readonly ${JSON.stringify(fieldName)}:`)
        expect(content).toContain(`readonly ${JSON.stringify(`$${fieldName}`)}:`)
      }
      for (const snippet of generatedEnv.expectedJsdocSnippets || []) {
        expect(content).toContain(snippet)
      }
    }
  })

  it('generates schema default interfaces which work through resolved module identity', () => {
    useFixture(root, 'complex-ts')
    generateTeamplayEnv({ root })
    linkNodeModules(root)
    mkdirSync(join(root, 'app', 'nested'), { recursive: true })
    writeFileSync(join(root, 'app-relative.ts'), `
      import { Signal } from 'teamplay'
      import Event from './models/events/schema'
      import AliasEvent from '@/models/events/schema'
      import _active from '@/models/events/_active.ts'

      const schemaType: 'string' = Event.title.type
      const aliasSchemaType: 'string' = AliasEvent.title.type
      const event: Event = { title: 'Launch', createdAt: 1 }
      const aliasEvent: AliasEvent = event
      const activeRows: NonNullable<typeof _active.__teamplayAggregationOutput> = [event]
      const $event = null as unknown as Signal<Event>
      const title: string = $event.title.get()

      class EventModel extends Signal<Event> {
        getTitle () {
          return this.title.get()
        }
      }

      const model = null as unknown as EventModel
      const modelTitle: string = model.getTitle()

      // @ts-expect-error generated default interface should reject wrong field types
      const badEvent: Event = { title: 123, createdAt: 1 }
      // @ts-expect-error generated aggregation alias should keep the aggregation output type
      const badActiveRows: NonNullable<typeof _active.__teamplayAggregationOutput> = [{ title: 123, createdAt: 1 }]

      void schemaType
      void aliasSchemaType
      void aliasEvent
      void activeRows
      void title
      void modelTitle
      void badEvent
      void badActiveRows
    `)
    writeFileSync(join(root, 'app', 'nested', 'nested-relative.ts'), `
      import Event from '../../models/events/schema.ts'

      const event: Event = { title: 'Nested', createdAt: 2 }
      // @ts-expect-error resolved relative imports with extensions should use the same default interface
      const badEvent: Event = { title: 'Nested', createdAt: 'today' }

      void event
      void badEvent
    `)
    writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        strict: true,
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        allowImportingTsExtensions: true,
        baseUrl: '.',
        paths: { '@/*': ['./*'] },
        skipLibCheck: true,
        ignoreDeprecations: '6.0'
      },
      include: ['**/*.ts', 'teamplay-env.d.ts']
    }, null, 2))

    expect(() => runTsc(root)).not.toThrow()
  })

  it('does not rewrite teamplay-env.d.ts when generated content is unchanged', () => {
    useFixture(root, 'complex-ts')
    const filePath = generateTeamplayEnv({ root })
    const oldTime = new Date('2000-01-01T00:00:00.000Z')
    utimesSync(filePath, oldTime, oldTime)

    generateTeamplayEnv({ root })

    expect(statSync(filePath).mtime.getTime()).toBe(oldTime.getTime())
  })

  it('generates env imports relative to a custom typesFile location', () => {
    useFixture(root, 'complex-ts')
    const filePath = generateTeamplayEnv({
      root,
      typesFile: 'types/generated/teamplay-env.d.ts'
    })
    const content = readFileSync(filePath, 'utf8')

    expect(toSnapshotPath(root, filePath)).toBe('types/generated/teamplay-env.d.ts')
    expect(content).toContain('from "../../models/events/schema.ts"')
    expect(content).toContain('declare module "../../models/events/schema"')
  })

  it('loads file-based models directly in Node', async () => {
    useFixture(root, 'simple-js')
    linkNodeModules(root)

    expect(summarizeLoadedModels(await loadFileBasedModels({ root }))).toMatchSnapshot()
  })

  it('loads file-based models synchronously in Node', () => {
    useFixture(root, 'simple-js')
    linkNodeModules(root)

    expect(summarizeLoadedModels(loadFileBasedModelsSync({ root }))).toMatchSnapshot()
  })

  it('exports synchronous Node file-based models', () => {
    useFixture(root, 'simple-js')
    linkNodeModules(root)
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
      type User = { active: boolean }

      export const _active = aggregation<User[]>(({ active }: { active: boolean }) => [{ $match: { active } }])
      export const access = accessControl({ create: () => true })
      export const secret = serverOnly(() => 'secret')
    `, {
      root,
      filename: join(root, 'models', 'users.ts')
    })).toMatchSnapshot()
  })

  it('eliminates default aggregation files for client builds', () => {
    expect(transformModelCode(`
      import { aggregation } from 'startupjs'
      type User = { active: boolean }

      export default aggregation<User[]>(({ active }: { active: boolean }) => [{ $match: { active } }])
    `, {
      root,
      filename: join(root, 'model', 'users', '_active.ts'),
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

  it('eliminates serverOnly code outside model folders based on source usage', () => {
    expect(transformModelCode(`
      import { serverOnly, Signal } from 'startupjs'
      import { getFileBlob } from './providers/index.js'

      export default class FileModel extends Signal {
        getBlob = serverOnly(function () {
          return getFileBlob(this.storageType.get(), this.getId())
        })
      }
    `, {
      root,
      filename: join(root, 'node_modules', '@startupjs-ui', 'file-input', 'files.plugin.js')
    })).toMatchSnapshot()
  })

  it('snapshots client-transformed complex TypeScript model fixtures', () => {
    useFixture(root, 'complex-ts')

    const output = transformFixtureModelFiles(root)

    expect(output['models/events/_active.ts']).toContain('__aggregationHeader<Event[], EventSession>')
    expect(output['models/events/_active.ts']).not.toContain('$match')
    expect(output['models/events/access.ts']).not.toContain('accessControl')
    expect(output['models/events/access.ts']).not.toContain('session')
    expect(output).toMatchSnapshot()
  })

  it('snapshots client-transformed simple JavaScript model fixtures', () => {
    useFixture(root, 'simple-js')

    const output = transformFixtureModelFiles(root)

    expect(output['models/users/_active.js']).toContain('__aggregationHeader')
    expect(output['models/users/_active.js']).not.toContain('$match')
    expect(output['models/users/access.js']).not.toContain('accessControl')
    expect(output['models/users/access.js']).not.toContain('session')
    expect(output).toMatchSnapshot()
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
    parserOpts: {
      plugins: ['typescript']
    },
    plugins: [[plugin, options]]
  })
  return result.code
}

function transformFixtureModelFiles (root) {
  const files = getSourceFiles(join(root, 'models'))
  return Object.fromEntries(
    files.map(filePath => [
      toSnapshotPath(root, filePath),
      `\n${transformModelCode(readFileSync(filePath, 'utf8'), {
        root,
        filename: filePath,
        types: false
      })}\n`
    ])
  )
}

function getSourceFiles (folder) {
  const files = []
  for (const filename of readdirSync(folder).sort()) {
    const filePath = join(folder, filename)
    const stat = lstatSync(filePath)
    if (stat.isDirectory()) {
      files.push(...getSourceFiles(filePath))
    } else if (SOURCE_FILE_REGEX.test(filename)) {
      files.push(filePath)
    }
  }
  return files
}

function toSnapshotPath (root, filePath) {
  return relative(root, filePath).replace(/\\/g, '/')
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

function getGeneratedRequireContextHelpers () {
  return runInNewContext(`${getRequireContextModelPatternHelperSource()}
    ({
      getPattern: __teamplayGetModelPattern,
      sanitizeAndMerge: __teamplaySanitizeAndMergeModelPatterns
    })
  `, { console })
}

function summarizeModelPatternParts (models) {
  return Object.fromEntries(
    Object.entries(models)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([pattern, parts]) => [
        pattern,
        parts.map(part => ({
          type: part.type,
          name: part.name,
          value: part.value
        }))
      ])
  )
}

function summarizeLoadedValue (value) {
  if (typeof value === 'function') {
    return { type: 'function', name: value.name }
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, summarizeLoadedValue(child)])
    )
  }
  return value
}

function useFixture (root, name) {
  cpSync(join(FIXTURES_DIR, name), root, { recursive: true })
  mkdirSync(join(root, 'src'), { recursive: true })
}

function writeSchemaMatrixModels (root) {
  for (const fixture of schemaRuntimeFixtureMatrix) {
    const generatedEnv = fixture.generatedEnv
    if (!generatedEnv) continue
    const folder = join(root, 'models', generatedEnv.collectionName)
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'index.ts'), [
      "import { Signal } from 'teamplay'",
      '',
      `export default class ${toClassName(generatedEnv.collectionName)} extends Signal {}`,
      ''
    ].join('\n'))
    writeFileSync(join(folder, 'schema.ts'), generatedEnv.source || buildStaticSchemaSource(fixture.schema))
  }
}

function buildStaticSchemaSource (schema) {
  return [
    "import { defineSchema } from 'teamplay'",
    '',
    `export default defineSchema(${JSON.stringify(schema, null, 2)} as const)`,
    ''
  ].join('\n')
}

function toClassName (value) {
  const name = value
    .replace(/^[^a-zA-Z_$]+/, '')
    .replace(/[^a-zA-Z0-9_$]+(.)?/g, (_, char = '') => char.toUpperCase())
  return name ? name[0].toUpperCase() + name.slice(1) : 'Model'
}

function linkNodeModules (root) {
  symlinkSync(join(REPO_ROOT, 'node_modules'), join(root, 'node_modules'), 'dir')
}

function runTsc (root) {
  execFileSync(process.execPath, [TSC_BIN, '--noEmit', '--project', join(root, 'tsconfig.json')], {
    cwd: root,
    encoding: 'utf8',
    stdio: 'pipe'
  })
}
