// Jest transform for the React Compiler fixtures. Compiles them as an app's
// babel config does, in one pass: babel-plugin-teamplay (listed first), the
// React Compiler with the options babel-preset-expo passes when an app sets
// `experiments.reactCompiler: true` (development build), then JSX.
// The file name picks babel-plugin-teamplay's `reactCompiler` option:
//   *.react-compiler.jsx  no babel-plugin-teamplay (the compiler alone)
//   *.rc-optout.jsx       'optOut'
//   *.rc-full.jsx         'full'
const { createHash } = require('node:crypto')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const babel = require('@babel/core')

const PLUGIN = require.resolve('babel-plugin-teamplay')
const PLUGIN_FILES = [PLUGIN, path.join(path.dirname(PLUGIN), 'reactCompiler.js')]
const MODES = { '.rc-optout.': 'optOut', '.rc-full.': 'full' }
// the fixtures import teamplay from its source
const TEAMPLAY_SOURCES = [/\/src\/index\.ts$/]

function getMode (sourcePath) {
  for (const marker in MODES) if (sourcePath.includes(marker)) return MODES[marker]
}

module.exports = {
  process (sourceText, sourcePath) {
    const mode = getMode(sourcePath)
    const { code } = babel.transformSync(sourceText, {
      filename: sourcePath,
      babelrc: false,
      configFile: false,
      plugins: [
        mode && [require(PLUGIN), { reactCompiler: mode, teamplaySources: TEAMPLAY_SOURCES }],
        ['babel-plugin-react-compiler', {
          target: '19',
          environment: { enableResetCacheOnSourceFileChanges: true },
          // fail the test run instead of silently leaving a fixture uncompiled
          panicThreshold: 'all_errors'
        }],
        ['@babel/plugin-transform-react-jsx', { runtime: 'automatic' }]
      ].filter(Boolean)
    })
    return { code }
  },
  // the output depends on babel-plugin-teamplay too
  getCacheKey (sourceText, sourcePath) {
    const hash = createHash('sha1').update(sourceText).update(sourcePath).update(readFileSync(__filename))
    for (const file of PLUGIN_FILES) hash.update(readFileSync(file))
    return hash.digest('hex')
  }
}
