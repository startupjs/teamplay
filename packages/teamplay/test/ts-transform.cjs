const ts = require('typescript')

module.exports = {
  process (sourceText, sourcePath) {
    const result = ts.transpileModule(sourceText, {
      fileName: sourcePath,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        sourceMap: false,
        inlineSourceMap: false,
        importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove
      }
    })
    return { code: result.outputText }
  }
}
