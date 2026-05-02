const JS_EXT_REGEX = /\.[mc]?[jt]sx?$/
const MODEL_PATTERN_REGEX = /^[a-zA-Z0-9$_*.]+$/

function toImportPath (filePath) {
  return filePath.replace(/\\/g, '/')
}

function getModelPatternFromRelativePath (relativeFilePath) {
  const normalizedPath = toImportPath(relativeFilePath).replace(/^\.\//, '')
  if (normalizedPath.includes('*')) {
    throw Error(`[models] Instead of '*' in model filename use '[id]'. Got: ${relativeFilePath}`)
  }
  let pattern = normalizedPath
    .replace(/\[[^\]]+\]/g, '*')
    .replace(JS_EXT_REGEX, '')
    .replace(/[\\/]/g, '.')

  if (pattern.split('.').some(section => section.startsWith('-'))) return null
  if (!MODEL_PATTERN_REGEX.test(pattern)) {
    throw Error(
      `[models] Invalid model filename pattern: ${pattern}\n` +
      `It has to comply with the following regex: ${MODEL_PATTERN_REGEX.toString()} with '[id]' instead of '*'`
    )
  }
  if (pattern === 'index') pattern = ''
  if (/\.index$/.test(pattern)) pattern = pattern.replace(/\.index$/, '')
  return pattern
}

function sanitizeAndMergeModelPatterns (modelPatterns) {
  const res = {}
  for (const [modelPattern, value] of Object.entries(modelPatterns)) {
    const sections = modelPattern.split('.')
    const lastSection = sections.pop()
    let pattern = sections.join('.')
    let type
    let method = 'push'
    if (isAggregationPattern(sections, lastSection)) type = 'aggregation'
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

function isCollectionPattern (pattern) {
  return pattern && !pattern.includes('*') && !pattern.includes('.')
}

function isAggregationName (name) {
  return /^_/.test(name) || isLegacyAggregationName(name)
}

function isAggregationPattern (parentSections, name) {
  return (
    isAggregationName(name) &&
    parentSections.length === 1 &&
    parentSections[0] &&
    !parentSections[0].startsWith('_')
  )
}

function isLegacyAggregationName (name) {
  return /^\$\$/.test(name)
}

module.exports = {
  JS_EXT_REGEX,
  MODEL_PATTERN_REGEX,
  getModelPatternFromRelativePath,
  isAggregationName,
  isAggregationPattern,
  isCollectionPattern,
  isLegacyAggregationName,
  sanitizeAndMergeModelPatterns,
  toImportPath
}
