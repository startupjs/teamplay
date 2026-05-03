import neostandard, { resolveIgnoresFromGitignore } from 'neostandard'
import reactHooks from 'eslint-plugin-react-hooks'

export default [
  ...neostandard({
    ts: true,
    env: ['browser', 'node', 'mocha', 'jest'],
    ignores: [
      ...resolveIgnoresFromGitignore(),
      'coverage*/**',
      'doc_build/**'
    ]
  }),
  {
    plugins: {
      'react-hooks': reactHooks
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn'
    }
  },
  {
    files: ['packages/teamplay/test_types/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      'no-void': 'off'
    }
  }
]
