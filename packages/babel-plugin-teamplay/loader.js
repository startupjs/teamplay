const { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } = require('fs')
const { dirname, join, relative, resolve: pathResolve } = require('path')
const parser = require('@babel/parser')
const jsonSchemaKeywordsModule = require('@teamplay/schema/json-schema-keywords')
const pluralize = require('pluralize')
const {
  JS_EXT_REGEX,
  getModelPatternFromRelativePath,
  isAggregationPattern,
  isCollectionPattern,
  isLegacyAggregationName,
  sanitizeAndMergeModelPatterns,
  toImportPath
} = require('./modelPatternRules')

const JSON_SCHEMA_KEYWORDS = jsonSchemaKeywordsModule.default || jsonSchemaKeywordsModule
const MODEL_MAGIC_IMPORT_REGEX = /['"](?:teamplay|startupjs)['"]/
const MODEL_ELIMINATION_FUNCTION_REGEX = /\b(?:aggregation|serverOnly|accessControl)\b/
const warnedFallbackFolders = new Set()
const warnedLegacyAggregationFiles = new Set()

function normalizeOptions (options = {}) {
  return {
    root: options.root || process.cwd(),
    modelsFolder: options.modelsFolder || 'models',
    fallbackModelsFolders: options.fallbackModelsFolders || ['model'],
    types: options.types !== false,
    typesFile: options.typesFile || 'teamplay-env.d.ts',
    autoInit: options.autoInit !== false,
    clientOnly: options.clientOnly !== false,
    useRequireContext: Boolean(options.useRequireContext),
    shouldTransformFileChecker: options.shouldTransformFileChecker || shouldTransformClientCode,
    warn: options.warn || console.warn
  }
}

function getModelsFolderInfo (options = {}) {
  options = normalizeOptions(options)
  const mainFolder = join(options.root, options.modelsFolder)
  if (existsSync(mainFolder) && lstatSync(mainFolder).isDirectory()) {
    return {
      folder: mainFolder,
      folderName: options.modelsFolder,
      usedFallback: false,
      exists: true
    }
  }

  for (const fallbackFolderName of options.fallbackModelsFolders) {
    const fallbackFolder = join(options.root, fallbackFolderName)
    if (!existsSync(fallbackFolder) || !lstatSync(fallbackFolder).isDirectory()) continue
    const warningKey = `${options.root}:${options.modelsFolder}:${fallbackFolderName}`
    if (!warnedFallbackFolders.has(warningKey)) {
      warnedFallbackFolders.add(warningKey)
      options.warn(
        `[teamplay] Using legacy "${fallbackFolderName}/" models folder. ` +
        `Please migrate to "${options.modelsFolder}/".`
      )
    }
    return {
      folder: fallbackFolder,
      folderName: fallbackFolderName,
      usedFallback: true,
      exists: true
    }
  }

  return {
    folder: mainFolder,
    folderName: options.modelsFolder,
    usedFallback: false,
    exists: false
  }
}

function getRelativeModelPath (sourceFilePath, options = {}) {
  const { folder } = getModelsFolderInfo(options)
  return toImportPath(relative(dirname(pathResolve(options.root || process.cwd(), sourceFilePath)), folder))
}

function getModelFiles (options = {}) {
  const info = getModelsFolderInfo(options)
  if (!info.exists) return []
  return getFilesRecursive(info.folder).sort()
}

function isModelFile (filename, code, options = {}) {
  if (!filename || !JS_EXT_REGEX.test(filename)) return false
  options = normalizeOptions(options)
  const modelFolders = [options.modelsFolder, ...options.fallbackModelsFolders]
  if (!hasModelFolderInPath(pathResolve(options.root, filename), modelFolders)) return false
  if (code != null && !MODEL_MAGIC_IMPORT_REGEX.test(code)) return false
  return true
}

function shouldTransformClientCode (_filename, code) {
  return Boolean(
    code &&
    MODEL_MAGIC_IMPORT_REGEX.test(code) &&
    MODEL_ELIMINATION_FUNCTION_REGEX.test(code)
  )
}

function hasModelFolderInPath (filename, modelFolders) {
  const pathSections = toImportPath(filename).split('/').filter(Boolean)
  return modelFolders
    .map(folder => toImportPath(folder).split('/').filter(Boolean))
    .some(folderSections => containsSubsequence(pathSections, folderSections))
}

function containsSubsequence (sections, subsequence) {
  if (subsequence.length === 0) return false
  for (let i = 0; i <= sections.length - subsequence.length; i++) {
    let matches = true
    for (let j = 0; j < subsequence.length; j++) {
      if (sections[i + j] !== subsequence[j]) {
        matches = false
        break
      }
    }
    if (matches) return true
  }
  return false
}

function getModelEliminationTransformFunctionCalls () {
  const magicImports = ['teamplay', 'startupjs']
  return [{
    functionName: 'aggregation',
    magicImports,
    requirements: {
      argumentsAmount: 1,
      directNamedExportedAsConst: true
    },
    replaceWith: {
      newFunctionNameFromSameImport: '__aggregationHeader',
      newCallArgumentsTemplate: `[
        {
          collection: %%filenameWithoutExtension%%,
          name: %%directNamedExportConstName%%
        }
      ]`
    }
  }, {
    functionName: 'aggregation',
    magicImports,
    requirements: {
      argumentsAmount: 1,
      directDefaultExported: true
    },
    replaceWith: {
      newFunctionNameFromSameImport: '__aggregationHeader',
      newCallArgumentsTemplate: `[
        {
          collection: %%folderAndFilenameWithoutExtension%%.split(/[\\\\/\\.]/).at(-2),
          name: %%folderAndFilenameWithoutExtension%%.split(/[\\\\/\\.]/).at(-1)
        }
      ]`
    }
  }, {
    functionName: 'aggregation',
    magicImports,
    requirements: {
      argumentsAmount: 2
    },
    throwIfRequirementsNotMet: true,
    replaceWith: {
      newFunctionNameFromSameImport: '__aggregationHeader',
      newCallArgumentsTemplate: '[%%argument1%%]'
    }
  }, {
    functionName: 'accessControl',
    magicImports,
    replaceWith: {
      remove: true
    }
  }, {
    functionName: 'serverOnly',
    magicImports,
    replaceWith: {
      remove: true
    }
  }]
}

function getRelativeModelImports (sourceFilePath, options = {}) {
  const root = options.root || process.cwd()
  return getModelFiles(options).map(filePath => {
    const relativePath = toImportPath(relative(dirname(pathResolve(root, sourceFilePath)), filePath))
    return relativePath.startsWith('.') ? relativePath : './' + relativePath
  })
}

function getFilesRecursive (folder) {
  const files = []
  for (const filename of readdirSync(folder).sort()) {
    const filePath = join(folder, filename)
    const stat = lstatSync(filePath)
    if (stat.isDirectory()) {
      files.push(...getFilesRecursive(filePath))
    } else if (JS_EXT_REGEX.test(filename)) {
      files.push(filePath)
    }
  }
  return files
}

function getModelPattern (filePath, options = {}) {
  options = normalizeOptions(options)
  const info = getModelsFolderInfo(options)
  const relativePath = toImportPath(relative(info.folder, filePath))
  const pattern = getModelPatternFromRelativePath(relativePath)
  if (pattern == null) return null
  warnIfLegacyAggregationFile(pattern, filePath, options)
  return pattern
}

function warnIfLegacyAggregationFile (pattern, filePath, options) {
  const sections = pattern.split('.')
  const lastSection = sections.pop()
  if (!isAggregationPattern(sections, lastSection) || !isLegacyAggregationName(lastSection)) return
  const warningKey = pathResolve(filePath)
  if (warnedLegacyAggregationFiles.has(warningKey)) return
  warnedLegacyAggregationFiles.add(warningKey)
  const oldPath = toImportPath(relative(options.root, filePath))
  const newPath = oldPath.replace(/(^|\/)\$\$/, '$1_')
  options.warn(
    `[teamplay] Legacy aggregation filename "${oldPath}" is deprecated. ` +
    `Rename it to "${newPath}". Aggregation files should use "_" prefix.`
  )
}

function discoverModels (options = {}) {
  const files = getModelFiles(options)
  const modelPatterns = {}
  for (const filePath of files) {
    const modelPattern = getModelPattern(filePath, options)
    if (modelPattern == null) continue
    modelPatterns[modelPattern] = filePath
  }
  return sanitizeAndMergeModelPatterns(modelPatterns)
}

function discoverModelImports (sourceFilePath, options = {}) {
  const root = options.root || process.cwd()
  const modelPatterns = {}
  for (const filePath of getModelFiles(options)) {
    const modelPattern = getModelPattern(filePath, options)
    if (modelPattern == null) continue
    let importPath = toImportPath(relative(dirname(pathResolve(root, sourceFilePath)), filePath))
    if (!importPath.startsWith('.')) importPath = './' + importPath
    modelPatterns[modelPattern] = importPath
  }
  return sanitizeAndMergeModelPatterns(modelPatterns)
}

function loadFileBasedModels (options = {}) {
  return loadFileBasedModelsSync(options)
}

function loadFileBasedModelsSync (options = {}) {
  const modelPatterns = discoverModels(options)
  const res = {}
  for (const [modelPattern, parts] of Object.entries(modelPatterns)) {
    const fileParts = []
    for (const part of parts) {
      const mod = requireModelFile(part.value)
      if (part.type === 'model') fileParts.push(normalizeModelModule(mod))
      else fileParts.push({ [part.name]: getDefaultExport(mod) })
    }
    res[modelPattern] = Object.assign({}, ...fileParts)
  }
  return res
}

function requireModelFile (filePath) {
  try {
    return require(filePath)
  } catch (err) {
    if (err?.code === 'ERR_REQUIRE_ASYNC_MODULE') {
      throw Error(
        `[teamplay] Cannot synchronously load file-based model "${filePath}" because it or one of its imports uses top-level await.\n` +
        'Move top-level await out of model files or pass models explicitly to createBackend({ models }).'
      )
    }
    throw err
  }
}

function normalizeModelModule (mod) {
  if (mod && typeof mod === 'object' && ('default' in mod || mod.__esModule)) return mod
  return { default: mod }
}

function getDefaultExport (mod) {
  if (mod && typeof mod === 'object' && 'default' in mod) return mod.default
  return mod
}

function generateTeamplayEnv (options = {}) {
  options = normalizeOptions(options)
  if (!options.types) return
  const models = discoverModels(options)
  const content = buildTeamplayEnvContent(models, options)
  const filePath = pathResolve(options.root, options.typesFile)
  writeGeneratedFile(filePath, content)
  return filePath
}

function buildTeamplayEnvContent (models, options = {}) {
  options = normalizeOptions(options)
  const root = options.root || process.cwd()
  const typesFile = pathResolve(root, options.typesFile || 'teamplay-env.d.ts')
  const typesDir = dirname(typesFile)
  const imports = new Map()
  const declarations = []
  const helperTypes = []
  const manifestLines = []
  const fieldLines = []
  const schemaModuleLines = []
  let counter = 0

  function addImport (filePath, prefix) {
    const id = `__${prefix}${counter++}`
    let importPath = toImportPath(relative(typesDir, filePath))
    if (!importPath.startsWith('.')) importPath = './' + importPath
    imports.set(id, importPath)
    return id
  }

  for (const [pattern, parts] of Object.entries(models)) {
    if (!pattern) continue
    const modelPart = parts.find(part => part.type === 'model')
    const schemaPart = parts.find(part => part.type === 'schema')
    const entryLines = []
    let schemaImport

    if (modelPart) {
      const modelImport = addImport(modelPart.value, isCollectionPattern(pattern) ? 'CollectionModel' : 'PathModel')
      entryLines.push(`    default: typeof ${modelImport}`)
    }

    if (schemaPart) {
      schemaImport = addImport(schemaPart.value, 'Schema')
      entryLines.push(`    schema: typeof ${schemaImport}`)
    }

    if (entryLines.length) {
      manifestLines.push(`  ${JSON.stringify(pattern)}: {\n${entryLines.join('\n')}\n  }`)
    }

    if (isCollectionPattern(pattern) && schemaPart) {
      const collectionName = pattern
      const docPattern = `${collectionName}.*`
      const docType = `__${toTypeName(collectionName)}Doc`
      const fieldsType = `__${toTypeName(collectionName)}Fields`
      helperTypes.push(`type ${docType} = FromJsonSchema<typeof ${schemaImport}>`)
      schemaModuleLines.push(buildSchemaDefaultInterface(
        getRelativeModuleSpecifier(typesDir, schemaPart.value),
        toDocumentTypeName(collectionName),
        docType
      ))

      const schemaDocs = extractSchemaDocs(schemaPart.value)
      if (schemaDocs.fields.length) {
        helperTypes.push(buildFieldsInterface(fieldsType, docType, [collectionName, '*'], schemaDocs.fields))
        fieldLines.push(`    ${JSON.stringify(docPattern)}: ${fieldsType}`)
      }
    }
  }

  if (!manifestLines.length && !fieldLines.length) {
    return [
      '// This file is generated by TeamPlay. Do not edit manually.',
      '/* eslint-disable */',
      "import 'teamplay'",
      ''
    ].join('\n')
  }

  for (const [id, importPath] of imports.entries()) {
    declarations.push(`import type ${id} from ${JSON.stringify(importPath)}`)
  }

  return [
    '// This file is generated by TeamPlay. Do not edit manually.',
    '/* eslint-disable */',
    "import { type CollectionsFromManifest, type FromJsonSchema, type PathModelsFromManifest, type SignalChild } from 'teamplay'",
    ...declarations,
    '',
    manifestLines.length ? 'interface __TeamplayModelManifest {' : null,
    ...manifestLines,
    manifestLines.length ? '}' : null,
    manifestLines.length ? '' : null,
    ...helperTypes,
    helperTypes.length ? '' : null,
    ...schemaModuleLines,
    schemaModuleLines.length ? '' : null,
    "declare module 'teamplay' {",
    manifestLines.length ? '  interface TeamplayCollections extends CollectionsFromManifest<__TeamplayModelManifest> {}' : null,
    manifestLines.length ? '  interface TeamplayModels extends PathModelsFromManifest<__TeamplayModelManifest> {}' : null,
    fieldLines.length ? '  interface TeamplaySignalFields {' : null,
    ...fieldLines,
    fieldLines.length ? '  }' : null,
    '}',
    ''
  ].filter(line => line != null).join('\n')
}

function writeGeneratedFile (filePath, content) {
  mkdirSync(dirname(filePath), { recursive: true })
  if (existsSync(filePath) && readFileSync(filePath, 'utf8') === content) return
  writeFileSync(filePath, content)
}

function getRelativeModuleSpecifier (fromDir, filePath) {
  let importPath = toImportPath(relative(fromDir, filePath))
  if (!importPath.startsWith('.')) importPath = './' + importPath
  return stripJsExtension(importPath)
}

function stripJsExtension (filePath) {
  return filePath.replace(JS_EXT_REGEX, '')
}

function buildSchemaDefaultInterface (moduleSpecifier, interfaceName, docType) {
  return [
    `declare module ${JSON.stringify(moduleSpecifier)} {`,
    `  export default interface ${interfaceName} extends ${docType} {}`,
    '}'
  ].join('\n')
}

function buildFieldsInterface (name, docType, signalPath, fields, typePath = []) {
  const lines = [`interface ${name} {`]
  const nested = []
  for (const field of fields) {
    const childTypePath = [...typePath, field.name]
    const childSignalPath = [...signalPath, field.name]
    const valueType = buildTypeAtPath(docType, childTypePath)
    let signalType = `SignalChild<${valueType}, readonly [${childSignalPath.map(JSON.stringify).join(', ')}]>`
    if (field.fields?.length) {
      const nestedName = `${name}_${toTypeName(field.name)}`
      nested.push(buildFieldsInterface(nestedName, docType, childSignalPath, field.fields, childTypePath))
      signalType = `${signalType} & ${nestedName}`
    }
    const jsdoc = buildJsdoc(field)
    if (jsdoc) lines.push(jsdoc)
    lines.push(`  readonly ${JSON.stringify(field.name)}: ${signalType}`)
    if (jsdoc) lines.push(jsdoc)
    lines.push(`  readonly ${JSON.stringify(`$${field.name}`)}: ${signalType}`)
  }
  lines.push('}')
  return [lines.join('\n'), ...nested].join('\n\n')
}

function buildTypeAtPath (rootType, path) {
  return path.reduce((res, segment) => `NonNullable<${res}>[${JSON.stringify(segment)}]`, rootType)
}

function buildJsdoc (field) {
  const text = [field.label, field.description].filter(Boolean).join('\n\n')
  if (!text) return ''
  return [
    '  /**',
    ...text.replace(/\*\//g, '*\\/').split('\n').map(line => line ? `   * ${line}` : '   *'),
    '   */'
  ].join('\n')
}

function extractSchemaDocs (filePath) {
  try {
    const code = readFileSync(filePath, 'utf8')
    const ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx']
    })
    const objectExpression = findSchemaObject(ast)
    if (!objectExpression) return { fields: [] }
    return { fields: extractFields(objectExpression) }
  } catch {
    return { fields: [] }
  }
}

function findSchemaObject (ast) {
  let schemaObject
  for (const node of ast.program.body) {
    if (node.type === 'ExportDefaultDeclaration') {
      const declaration = getSchemaObjectExpression(node.declaration)
      if (declaration) return declaration
    }
    if (node.type === 'VariableDeclaration') {
      for (const declaration of node.declarations) {
        const init = getSchemaObjectExpression(declaration.init)
        if (declaration.id.type === 'Identifier' && declaration.id.name === 'schema' && init) {
          schemaObject = init
        }
      }
    }
  }
  return schemaObject
}

function getSchemaObjectExpression (node) {
  node = unwrapExpression(node)
  if (node?.type === 'ObjectExpression') return node
  if (node?.type !== 'CallExpression') return null
  if (!isDefineSchemaCallee(node.callee)) return null
  const schemaArg = unwrapExpression(node.arguments?.[0])
  return schemaArg?.type === 'ObjectExpression' ? schemaArg : null
}

function isDefineSchemaCallee (callee) {
  if (callee.type === 'Identifier') return callee.name === 'defineSchema'
  if (callee.type !== 'MemberExpression') return false
  const property = callee.property
  return !callee.computed && property.type === 'Identifier' && property.name === 'defineSchema'
}

function extractFields (objectExpression, options = {}) {
  const explicitProperties = Boolean(options.explicitProperties)
  const propertiesObject = !explicitProperties && isFullObjectSchema(objectExpression)
    ? getObjectProperty(objectExpression, 'properties')
    : null
  if (propertiesObject) {
    return extractFields(propertiesObject, { explicitProperties: true })
  }
  return extractFieldsFromPropertiesObject(objectExpression, { explicitProperties })
}

function extractFieldsFromPropertiesObject (objectExpression, { explicitProperties }) {
  const fields = []
  for (const property of objectExpression.properties || []) {
    if (property.type !== 'ObjectProperty' && property.type !== 'Property') continue
    const name = getPropertyName(property.key)
    if (!name) continue
    const value = unwrapExpression(property.value)
    if (value.type !== 'ObjectExpression') continue
    if (!explicitProperties && isJsonSchemaKeyword(name) && !isSimplifiedKeywordField(value)) continue
    const field = {
      name,
      label: getStringProperty(value, 'label'),
      description: getStringProperty(value, 'description'),
      fields: []
    }
    const nestedProperties = getObjectProperty(value, 'properties')
    if (nestedProperties) field.fields = extractFields(nestedProperties, { explicitProperties: true })
    fields.push(field)
  }
  return fields
}

function isSimplifiedKeywordField (value) {
  return value?.type === 'ObjectExpression' && hasSchemaFieldIndicators(value)
}

function isFullObjectSchema (value) {
  return getStringProperty(value, 'type') === 'object'
}

function isSchemaPropertiesMap (value) {
  return value?.type === 'ObjectExpression' && !hasSchemaFieldIndicators(value)
}

function hasSchemaFieldIndicators (objectExpression) {
  if (hasStringOrArrayProperty(objectExpression, 'type')) return true
  if (hasStringProperty(objectExpression, 'label')) return true
  if (hasStringProperty(objectExpression, 'description')) return true
  if (hasStringProperty(objectExpression, 'input')) return true
  if (hasBooleanOrArrayProperty(objectExpression, 'required')) return true
  if (hasArrayProperty(objectExpression, 'enum')) return true
  const propertiesObject = getObjectProperty(objectExpression, 'properties')
  return propertiesObject ? isSchemaPropertiesMap(propertiesObject) : false
}

function hasStringProperty (objectExpression, name) {
  const property = findProperty(objectExpression, name)
  const value = unwrapExpression(property?.value)
  return value?.type === 'StringLiteral'
}

function hasStringOrArrayProperty (objectExpression, name) {
  const property = findProperty(objectExpression, name)
  const value = unwrapExpression(property?.value)
  return value?.type === 'StringLiteral' || value?.type === 'ArrayExpression'
}

function hasBooleanOrArrayProperty (objectExpression, name) {
  const property = findProperty(objectExpression, name)
  const value = unwrapExpression(property?.value)
  return value?.type === 'BooleanLiteral' || value?.type === 'ArrayExpression'
}

function hasArrayProperty (objectExpression, name) {
  const property = findProperty(objectExpression, name)
  const value = unwrapExpression(property?.value)
  return value?.type === 'ArrayExpression'
}

function getObjectProperty (objectExpression, name) {
  const property = findProperty(objectExpression, name)
  const value = unwrapExpression(property?.value)
  return value?.type === 'ObjectExpression' ? value : undefined
}

function getStringProperty (objectExpression, name) {
  const property = findProperty(objectExpression, name)
  const value = unwrapExpression(property?.value)
  return value?.type === 'StringLiteral' ? value.value : undefined
}

function findProperty (objectExpression, name) {
  return (objectExpression.properties || []).find(property => {
    if (property.type !== 'ObjectProperty' && property.type !== 'Property') return false
    return getPropertyName(property.key) === name
  })
}

function getPropertyName (key) {
  if (key.type === 'Identifier') return key.name
  if (key.type === 'StringLiteral') return key.value
  return undefined
}

function unwrapExpression (node) {
  while (
    node?.type === 'TSAsExpression' ||
    node?.type === 'TSSatisfiesExpression' ||
    node?.type === 'TypeCastExpression'
  ) {
    node = node.expression
  }
  return node
}

function isJsonSchemaKeyword (key) {
  return JSON_SCHEMA_KEYWORDS.includes(key)
}

function toTypeName (value) {
  const res = String(value)
    .replace(/^[^a-zA-Z_$]+/, '')
    .replace(/[^a-zA-Z0-9_$]+(.)?/g, (_, char = '') => char.toUpperCase())
  return res ? res[0].toUpperCase() + res.slice(1) : 'Model'
}

function toDocumentTypeName (collectionName) {
  return toTypeName(pluralize.singular(collectionName))
}

module.exports = {
  buildTeamplayEnvContent,
  discoverModelImports,
  discoverModels,
  generateTeamplayEnv,
  getModelEliminationTransformFunctionCalls,
  getModelFiles,
  getModelPattern,
  getModelPatternFromRelativePath,
  getModelsFolderInfo,
  getRelativeModelImports,
  getRelativeModelPath,
  isModelFile,
  loadFileBasedModels,
  loadFileBasedModelsSync,
  normalizeOptions,
  sanitizeAndMergeModelPatterns,
  shouldTransformClientCode,
  toImportPath
}
