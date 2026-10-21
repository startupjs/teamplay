// Jest transform for `*.react-compiler.jsx` fixtures: compiles them with the
// React Compiler using the options babel-preset-expo passes when an app sets
// `experiments.reactCompiler: true` (development build), then compiles JSX.
const babel = require('@babel/core')

module.exports = {
  process (sourceText, sourcePath) {
    const { code } = babel.transformSync(sourceText, {
      filename: sourcePath,
      babelrc: false,
      configFile: false,
      plugins: [
        ['babel-plugin-react-compiler', {
          target: '19',
          environment: { enableResetCacheOnSourceFileChanges: true },
          // fail the test run instead of silently leaving a fixture uncompiled
          panicThreshold: 'all_errors'
        }],
        ['@babel/plugin-transform-react-jsx', { runtime: 'automatic' }]
      ]
    })
    return { code }
  }
}
