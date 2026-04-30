const { addDefault, addNamespace } = require('@babel/helper-module-imports')
const eliminatorPlugin = require('@startupjs/babel-plugin-eliminator')
const {
  discoverModelImports,
  generateTeamplayEnv,
  getModelEliminationTransformFunctionCalls,
  getModelsFolderInfo,
  getRelativeModelPath,
  isModelFile,
  normalizeOptions
} = require('./loader')

const VIRTUAL_MODELS_IMPORT_REGEX = /(?:^|\/)teamplay\.models\.virtual\.js$|(?:^|\/)startupjs\.models\.virtual\.js$/
const VIRTUAL_AUTO_INIT_IMPORT_REGEX = /(?:^|\/)teamplay\.models\.auto-init\.virtual\.js$/
const FILE_BASED_MODELS_IMPORT_REGEX = /^(?:teamplay|babel-plugin-teamplay)\/file-based-models$/

module.exports = function teamplayBabelPlugin (api, rawOptions = {}) {
  const { types: t, template } = api
  const options = normalizeOptions(rawOptions)
  const modelEliminator = options.clientOnly
    ? eliminatorPlugin(api, {
      shouldTransformFileChecker: (filename, code) => isModelFile(filename, code, options),
      transformFunctionCalls: getModelEliminationTransformFunctionCalls()
    })
    : null

  return {
    name: 'babel-plugin-teamplay',
    visitor: {
      Program: {
        enter ($program, state) {
          modelEliminator?.visitor?.Program?.enter?.($program, state)

          const filename = state.file.opts.filename
          let triggered = false

          for (const $import of $program.get('body')) {
            if (!$import.isImportDeclaration()) continue
            if (
              isVirtualImport($import, VIRTUAL_MODELS_IMPORT_REGEX) ||
              isVirtualImport($import, FILE_BASED_MODELS_IMPORT_REGEX)
            ) {
              if (options.types) generateTeamplayEnv(options)
              if (options.useRequireContext) {
                loadVirtualModelsRequireContext($import, { $program, filename, t, template, options })
              } else {
                loadVirtualModels($import, { $program, filename, t, template, options })
              }
              triggered = true
              continue
            }
            if (isVirtualImport($import, VIRTUAL_AUTO_INIT_IMPORT_REGEX)) {
              loadVirtualAutoInit($import, { $program, t, template, options })
              triggered = true
            }
          }

          if (triggered) $program.scope.crawl()
        }
      }
    }
  }
}

function loadVirtualModels ($import, { $program, filename, t, template, options }) {
  validateDefaultImport($import, 'Virtual models import')
  const buildModelsConst = template('const %%name%% = %%models%%')
  const modelPatterns = discoverModelImports(filename, options)
  const models = t.objectExpression([])

  for (const modelPattern in modelPatterns) {
    const parts = modelPatterns[modelPattern]
    const fileParts = parts.map(part => {
      if (part.type === 'model') return addNamespaceImport($program, part.value)
      const partImport = addDefaultImport($program, part.value)
      return t.objectExpression([t.objectProperty(t.stringLiteral(part.name), partImport)])
    })
    const objectAssign = t.callExpression(t.memberExpression(t.identifier('Object'), t.identifier('assign')), [
      t.objectExpression([]),
      ...fileParts
    ])
    models.properties.push(t.objectProperty(t.stringLiteral(modelPattern), objectAssign))
  }

  const name = $import.get('specifiers.0.local').node.name
  $import.remove()
  insertAfterLastImport($program, buildModelsConst({ name, models }))
}

function loadVirtualModelsRequireContext ($import, { $program, filename, t, template, options }) {
  validateDefaultImport($import, 'Virtual models import')
  const info = getModelsFolderInfo(options)
  const name = $import.get('specifiers.0.local').node.name
  $import.remove()

  if (!info.exists) {
    const buildEmptyModelsConst = template('const %%name%% = {}')
    insertAfterLastImport($program, buildEmptyModelsConst({ name }))
    return
  }

  const buildModelsConst = template(/* js */`
    const __teamplayModelsContext = require.context(%%folder%%, true, /\\.[mc]?[jt]sx?$/)
    const %%name%% = (() => {
      let modelPatterns = __teamplayModelsContext.keys().reduce(
        (res, filePath) => {
          const pattern = __teamplayGetModelPattern(filePath)
          if (pattern === null) return res
          return { ...res, [pattern]: filePath }
        },
        {}
      )
      modelPatterns = __teamplaySanitizeAndMergeModelPatterns(modelPatterns)
      const res = {}
      for (const [modelPattern, parts] of Object.entries(modelPatterns)) {
        const fileParts = parts.map(part => {
          if (part.type === 'model') return __teamplayModelsContext(part.value)
          return { [part.name]: __teamplayModelsContext(part.value).default }
        })
        res[modelPattern] = Object.assign({}, ...fileParts)
      }
      return res
    })()
    function __teamplayGetModelPattern (modelFilename) {
      const MODEL_PATTERN_REGEX = /^[a-zA-Z0-9$_*.]+$/
      let pattern = modelFilename
      if (/\\*/.test(pattern)) throw Error("[models] Instead of '*' in model filename use '[id]'. Got: " + modelFilename)
      pattern = pattern.replace(/\\[[^\\]]+\\]/g, '*')
      pattern = pattern.replace(/^\\.\\//, '')
      pattern = pattern.replace(/\\.[^.]+$/, '')
      pattern = pattern.replace(/[\\\\/]/g, '.')
      if (pattern.split('.').some(section => section.startsWith('-'))) return null
      if (!MODEL_PATTERN_REGEX.test(pattern)) {
        throw Error("[models] Invalid model filename pattern: " + modelFilename + "\\n" +
          "It has to comply with the following regex: " + MODEL_PATTERN_REGEX.toString() + " with '[id]' instead of '*'")
      }
      if (pattern === 'index') pattern = ''
      if (/\\.index$/.test(pattern)) pattern = pattern.replace(/\\.index$/, '')
      return pattern
    }
    function __teamplaySanitizeAndMergeModelPatterns (modelPatterns) {
      const res = {}
      for (const [modelPattern, value] of Object.entries(modelPatterns)) {
        const sections = modelPattern.split('.')
        const lastSection = sections.pop()
        let pattern = sections.join('.')
        let type
        let method = 'push'
        if (/^\\$\\$/.test(lastSection)) type = 'aggregation'
        else if (lastSection === 'schema') type = 'schema'
        else if (lastSection === 'access') type = 'access'
        else {
          type = 'model'
          pattern = modelPattern
          method = 'unshift'
        }
        res[pattern] ??= []
        res[pattern][method]({ type, name: lastSection, value })
      }
      return res
    }
  `)

  insertAfterLastImport($program, buildModelsConst({
    name,
    folder: t.stringLiteral(getRelativeModelPath(filename, options))
  }))
}

function loadVirtualAutoInit ($import, { $program, template, options }) {
  validateDefaultImport($import, 'Virtual auto-init import')
  const name = $import.get('specifiers.0.local').node.name
  const buildConst = template(`const %%name%% = ${options.autoInit ? 'true' : 'false'}`)
  $import.remove()
  insertAfterLastImport($program, buildConst({ name }))
}

function isVirtualImport ($import, regex) {
  return regex.test($import.get('source').node.value)
}

function validateDefaultImport ($import, label) {
  const $specifiers = $import.get('specifiers')
  if ($specifiers.length === 0 || $specifiers.length > 1 || !$specifiers[0].isImportDefaultSpecifier()) {
    throw $import.buildCodeFrameError(`${label} must have a single default import`)
  }
}

function addDefaultImport ($program, sourceName) {
  return addDefault($program, sourceName, {
    importedType: 'es6',
    importPosition: 'after'
  })
}

function addNamespaceImport ($program, sourceName) {
  return addNamespace($program, sourceName, {
    importedType: 'es6',
    importPosition: 'after'
  })
}

function insertAfterLastImport ($program, node) {
  const $lastImport = $program.get('body').filter($i => $i.isImportDeclaration()).pop()
  if ($lastImport) $lastImport.insertAfter(node)
  else $program.unshiftContainer('body', node)
}
