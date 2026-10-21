import babel from '@babel/core'
import { beforeEach, describe, it } from 'mocha'
import { jestExpect as expect } from 'mocha-expect-snapshot'
import { createRequire } from 'node:module'
import { serialize } from 'node:v8'
import plugin from '../index.js'
import reactCompiler from '../reactCompiler.js'

const require = createRequire(import.meta.url)
const COMPILER = require.resolve('babel-plugin-react-compiler')
const FILENAME = '/app/src/Component.jsx'

function transform (code, { teamplay = {}, compiler = true, between = [], filename = FILENAME } = {}) {
  const warnings = []
  const { code: output } = babel.transformSync(code, {
    filename,
    babelrc: false,
    configFile: false,
    parserOpts: { plugins: ['jsx'] },
    plugins: [
      [plugin, { types: false, warn: message => warnings.push(message), ...teamplay }],
      ...between,
      compiler && [COMPILER, { target: '19', panicThreshold: 'all_errors' }]
    ].filter(Boolean)
  })
  return { code: output, warnings }
}

// stands in for the React Compiler: replaces the file with already compiled
// code, in the same pass, between babel-plugin-teamplay's Program enter and exit
function compiledAs (compiledCode) {
  return () => ({
    visitor: {
      Program (program) {
        const { program: compiled } = babel.parseSync(compiledCode, {
          filename: 'compiled.js', babelrc: false, configFile: false, parserOpts: { plugins: ['jsx'] }
        })
        program.node.body = compiled.body
        program.scope.crawl()
      }
    }
  })
}

// name -> { directives, compiled } for the named functions of the code
function describeFunctions (code) {
  const functions = {}
  const ast = babel.parseSync(code, { babelrc: false, configFile: false, parserOpts: { plugins: ['jsx'] } })
  babel.traverse(ast, {
    Function (fn) {
      let name = fn.node.id?.name
      if (!name && fn.parentPath.isVariableDeclarator()) name = fn.parentPath.node.id.name
      if (!name && fn.parentPath.isCallExpression()) name = fn.parentPath.parentPath.node.id?.name
      if (!name || functions[name]) return
      let compiled = false
      fn.traverse({
        CallExpression (call) {
          if (call.get('callee').isIdentifier({ name: '_c' })) compiled = true
        }
      })
      functions[name] = {
        directives: (fn.node.body.directives || []).map(directive => directive.value.value),
        compiled
      }
    }
  })
  return functions
}

describe('babel-plugin-teamplay: React Compiler', () => {
  beforeEach(() => reactCompiler.__resetWarnings())

  it('validates its options', () => {
    expect(() => transform('', { teamplay: { reactCompiler: 'partial' } })).toThrow(/reactCompiler: expected 'optOut', 'full' or false/)
    expect(() => transform('', { teamplay: { dollarCalls: 'loud' } })).toThrow(/dollarCalls: expected 'warn', 'error' or false/)
  })

  describe("reactCompiler: 'optOut'", () => {
    it("adds 'use no memo' to what observer() wraps, also without $-named values", () => {
      const { code } = transform(`
        import { observer } from 'startupjs'
        function TagsBase ({ user }) { return <i>{user.tags.join('+')}</i> }
        export const Tags = observer(TagsBase)
        const NameBase = function ({ user }) { return <b>{user.name}</b> }
        export const Name = observer(NameBase)
      `, { teamplay: { reactCompiler: 'optOut' } })
      const functions = describeFunctions(code)
      expect(functions.TagsBase).toEqual({ directives: ['use no memo'], compiled: false })
      expect(functions.NameBase).toEqual({ directives: ['use no memo'], compiled: false })
    })

    it("adds 'use no memo' to the components and hooks that use signals", () => {
      const { code } = transform(`
        import { $, observer, useSub } from 'startupjs'
        export function useCount ($doc) { return $doc.count.get() }
        export function Plain ({ n }) { return <b>{n * 2}</b> }
        export const Arrow = ({ $doc }) => <i>{$doc.name.get()}</i>
        export const Wrapped = observer(function Wrapped ({ id }) {
          const user = useSub($.users[id])
          return <b>{user.name.get()}</b>
        })
        export function Kept ({ $doc }) {
          'use memo'
          return <b>{$doc.x.get()}</b>
        }
        function helper ($doc) { return $doc.x.get() }
        export const value = helper
      `, { teamplay: { reactCompiler: 'optOut' } })
      const functions = describeFunctions(code)
      expect(functions.useCount).toEqual({ directives: ['use no memo'], compiled: false })
      expect(functions.Arrow).toEqual({ directives: ['use no memo'], compiled: false })
      expect(functions.Wrapped).toEqual({ directives: ['use no memo'], compiled: false })
      expect(functions.Plain).toEqual({ directives: [], compiled: true })
      expect(functions.Kept).toEqual({ directives: ['use memo'], compiled: true })
      expect(functions.helper).toEqual({ directives: [], compiled: false })
    })
  })

  it('leaves a value that only has a hook name', () => {
    const { code } = transform(`
      import { useNativeDriver } from './config'
      const nativeDriver = useNativeDriver
      export function Fade ({ n }) { return <b data-native={nativeDriver}>{n * 2}</b> }
    `, { teamplay: { reactCompiler: 'full' } })
    expect(code).toContain('const nativeDriver = useNativeDriver')
  })

  it('gives a hook called under another name a hook name, so the compiler calls it on every render', () => {
    const source = `
      import { useCssxLayer as _useCssxLayer } from 'cssxjs/runtime'
      import { useCssxLayer2 } from './taken'
      const _cssxLayer = _useCssxLayer
      export function Box ({ n }) {
        const _local = _cssxLayer('box')
        return <div style={_local}>{n * 2}</div>
      }
    `
    for (const mode of ['optOut', 'full']) {
      const { code } = transform(source, { teamplay: { reactCompiler: mode } })
      // the name it's called by (a free one)
      expect(code).toContain('const useCssxLayer = _useCssxLayer')
      // called on every render: before the compiler's first scope
      const call = code.indexOf('const _local = useCssxLayer("box")')
      expect(call).toBeGreaterThan(-1)
      expect(call).toBeLessThan(code.indexOf('if ($['))
    }
  })

  describe("reactCompiler: 'full'", () => {
    it('makes $() in components and hooks useSignal()', () => {
      const { code } = transform(`
        import { $, observer } from 'startupjs'
        const $global = $(1)
        export function Counter () {
          const $count = $(0)
          const onClick = () => { const $temp = $(2); $temp.set(3) }
          return <b onClick={onClick}>{$count.get()}</b>
        }
        export function useDraft (value) { return $(value) }
        export function Shadowed () {
          const $ = value => value
          return <b>{$(1)}</b>
        }
      `, { teamplay: { reactCompiler: 'full' }, compiler: false })
      expect(code).toContain("import { $, observer, useSignal } from 'startupjs'")
      expect(code).toContain('const $global = $(1)')
      expect(code).toContain('const $count = useSignal(0)')
      expect(code).toContain('const $temp = $(2)')
      expect(code).toContain('return useSignal(value)')
      expect(code).toContain('{$(1)}')
    })

    it('compiles the functions passed inline to observer()', () => {
      const { code } = transform(`
        import { observer } from 'startupjs'
        import { observer as mobxObserver } from 'mobx-react'
        export const Inline = observer(function Inline ({ $doc }) { return <b>{$doc.a.get()}</b> })
        export const Arrow = observer(({ $doc }) => <b>{$doc.a.get()}</b>)
        export const Skipped = observer(function Skipped ({ $doc }) {
          'use no memo'
          return <b>{$doc.a.get()}</b>
        })
        export const Other = mobxObserver(function Other ({ store }) { return <b>{store.a}</b> })
      `, { teamplay: { reactCompiler: 'full' } })
      const functions = describeFunctions(code)
      expect(functions.Inline).toEqual({ directives: ['use memo'], compiled: true })
      expect(functions.Arrow).toEqual({ directives: ['use memo'], compiled: true })
      expect(functions.Skipped).toEqual({ directives: ['use no memo'], compiled: false })
      expect(functions.Other).toEqual({ directives: [], compiled: false })
    })

    it('leaves $() in a function that only has a component name', () => {
      const { code } = transform(`
        import { $ } from 'teamplay'
        function Cart () {
          const $items = $([])
          return { $items }
        }
        export const cart = Cart()
        export function Counter () { return <b>{$(0).get()}</b> }
      `, { teamplay: { reactCompiler: 'full' }, compiler: false })
      expect(code).toContain('const $items = $([])')
      expect(code).toContain('{useSignal(0).get()}')
    })

    it('uses useSignal imported under another name', () => {
      const { code } = transform(`
        import { $, observer, useSignal as localSignal } from 'teamplay'
        function CounterBase () {
          const $count = $(0)
          const $other = localSignal(1)
          return <b>{$count.get()}{$other.get()}</b>
        }
        export const Counter = observer(CounterBase)
      `, { teamplay: { reactCompiler: 'full' }, compiler: false })
      expect(code).toContain("import { $, observer, useSignal } from 'teamplay'")
      expect(code).toContain('const $count = useSignal(0)')
      expect(code).toContain('const $other = useSignal(1)')
    })

    it('uses the useSignal the file imports, or a free name', () => {
      const imported = transform(`
        import { $, useSignal as useLocal } from 'teamplay'
        export function A () { return <b>{$(1).get()}{useLocal(2).get()}</b> }
      `, { teamplay: { reactCompiler: 'full' }, compiler: false })
      expect(imported.code).toContain('{useLocal(1).get()}{useLocal(2).get()}')
      const taken = transform(`
        import { $ } from 'teamplay'
        import { useSignal } from './elsewhere'
        export function A () { return <b>{$(1).get()}{useSignal()}</b> }
        function B () {
          const useSignal2 = 1
          return useSignal2
        }
      `, { teamplay: { reactCompiler: 'full' }, compiler: false })
      // a name used nowhere in the file
      expect(taken.code).toContain("import { $, useSignal as useSignal3 } from 'teamplay'")
      expect(taken.code).toContain('{useSignal3(1).get()}{useSignal()}')
    })

    it('instruments the compiled scopes', () => {
      const { code, warnings } = transform(`
        import { observer } from 'startupjs'
        function DocCountBase ({ $doc }) { return <span>{$doc.count.get()}</span> }
        export const DocCount = observer(DocCountBase)
      `, { teamplay: { reactCompiler: 'full' } })
      expect(warnings).toEqual([])
      expect(code).toMatch(/^import \{ __reactCompiler as _tp \} from "startupjs";\nimport \{ c as _c \} from "react\/compiler-runtime";\nimport \{ observer \} from 'startupjs';\n_tp\.enable\(\);\nconst _tpKeys = \[0\];\nconst _tpKeys2 = \[2\];/)
      // one more slot: the scopes' state
      expect(code).toContain('const $ = _tp.cache(_c(5))')
      // _tp.dirty($, K, UPSTREAM_KEYS, JSX, DEP_SLOTS)
      expect(code).toContain('if ($[0] !== $doc.count || _tp.dirty($, 0, null, false, _tpKeys)) {\n    _tp.run($, 0, () => {')
      expect(code).toContain('if ($[2] !== t1 || _tp.dirty($, 2, _tpKeys, true, _tpKeys2)) {\n    _tp.run($, 2, () => {')
    })

    it("imports teamplay's runtime from 'teamplay', or from the reactCompilerRuntime option", () => {
      const source = 'export function Count ({ $doc }) { return <span>{$doc.count.get()}</span> }'
      expect(transform(source, { teamplay: { reactCompiler: 'full' } }).code)
        .toContain('import { __reactCompiler as _tp } from "teamplay"')
      expect(transform(source, { teamplay: { reactCompiler: 'full', reactCompilerRuntime: 'my-app/teamplay' } }).code)
        .toContain('import { __reactCompiler as _tp } from "my-app/teamplay"')
    })

    it('instruments nested scopes, inner first', () => {
      const { code } = transform('', {
        teamplay: { reactCompiler: 'full' },
        compiler: false,
        between: [compiledAs(`
          import { c as _c } from 'react/compiler-runtime'
          export function Nested (t0) {
            const $ = _c(5)
            const { $doc } = t0
            let t1
            if ($[0] !== $doc) {
              let t2
              if ($[2] !== $doc.a) {
                t2 = { a: $doc.a.get() }
                $[2] = $doc.a
                $[3] = t2
              } else {
                t2 = $[3]
              }
              t1 = [t2, $doc.b.get()]
              $[0] = $doc
              $[1] = t1
            } else {
              t1 = $[1]
            }
            return t1
          }
        `)]
      })
      expect(code).toContain('const $ = _tp.cache(_c(6))')
      expect(code).toMatch(/if \(\$\[0\] !== \$doc \|\| _tp\.dirty\(\$, 0, null, false, _tpKeys\d*\)\) \{\n {4}_tp\.run\(\$, 0, \(\) => \{/)
      expect(code).toMatch(/if \(\$\[2\] !== \$doc\.a \|\| _tp\.dirty\(\$, 2, null, false, _tpKeys\d*\)\) \{\n {8}_tp\.run\(\$, 2, \(\) => \{/)
    })

    it('recomputes inside observer() a scope that returns from its body', () => {
      const { code } = transform('', {
        teamplay: { reactCompiler: 'full' },
        compiler: false,
        between: [compiledAs(`
          import { c as _c } from 'react/compiler-runtime'
          export function Early (t0) {
            const $ = _c(2)
            const { $doc } = t0
            let t1
            if ($[0] !== $doc) {
              if (!$doc.ready.get()) return null
              t1 = <b>{$doc.name.get()}</b>
              $[0] = $doc
              $[1] = t1
            } else {
              t1 = $[1]
            }
            return t1
          }
        `)]
      })
      expect(code).toContain('if ($[0] !== $doc || _tp.inObserver()) {\n    if (!$doc.ready.get()) return null;')
    })

    it('recomputes inside observer() every scope of a function whose compiled code it does not recognize', () => {
      const { code, warnings } = transform('', {
        teamplay: { reactCompiler: 'full' },
        compiler: false,
        between: [compiledAs(`
          import { c as _c } from 'react/compiler-runtime'
          export function Unknown (t0) {
            const $ = _c(2)
            const { $doc } = t0
            let t1
            if ($[0] !== $doc) {
              t1 = { name: $doc.name.get() }
              $[0] = $doc
              $[1] = t1
            } else {
              t1 = $[1]
            }
            log($[1])
            return t1
          }
        `)]
      })
      expect(code).toContain('if ($[0] !== $doc || _tp.inObserver()) {\n    t1 = {')
      expect(code).not.toContain('_tp.run(')
      expect(warnings).toEqual([
        expect.stringMatching(/Component\.jsx: the React Compiler's output for Unknown\(\) \(line \d+\) is not recognized/)
      ])
    })

    it('recomputes on every render a scope that reads the clock', () => {
      const { code } = transform(`
        import { observer } from 'startupjs'
        export const Clock = observer(function Clock ({ $tick, dueAt }) {
          $tick.get()
          const now = Date.now()
          const today = new Date().getDay()
          const onPress = () => console.log(Date.now())
          return <b onClick={onPress}>{dueAt < now ? 'late' : 'ok'}{today}</b>
        })
      `, { teamplay: { reactCompiler: 'full' } })
      // the scope of new Date() (the compiler computes Date.now() outside scopes here)
      expect(code).toContain('if ($[0] === Symbol.for("react.memo_cache_sentinel") || true || _tp.dirty($, 0)) {\n    _tp.run($, 0, () => {\n      t1 = new Date().getDay();')
      expect(code.match(/\|\| true \|\|/g)).toHaveLength(1)
    })

    it('recomputes on every render a scope that calls moment() or dayjs() for the current time', () => {
      const { code } = transform(`
        import moment from 'moment'
        import { observer } from 'startupjs'
        export const Late = observer(function Late ({ dueAt }) {
          const today = { day: moment().format('L'), year: moment.utc().year() }
          const due = { day: moment(dueAt).format('L') }
          return <b>{today.day}{today.year}{due.day}</b>
        })
      `, { teamplay: { reactCompiler: 'full' } })
      // the scope of today, not the one of due (moment(dueAt) is not the clock)
      expect(code.match(/\|\| true \|\|/g)).toHaveLength(1)
      expect(code).toContain('if ($[0] === Symbol.for("react.memo_cache_sentinel") || true || _tp.dirty($, 0)) {\n    _tp.run($, 0, () => {\n      t1 = {\n        day: moment().format("L")')
    })

    it('clears the Symbol locations of compiled nodes (an AST a bundler sends to another process)', () => {
      // the compiler's GeneratedSource, copied by a later transform
      const generatedLocation = () => ({
        visitor: { Identifier (identifier) { if (identifier.node.name === 't1') identifier.node.loc = Symbol('GeneratedSource') } }
      })
      const { ast } = babel.transformSync('', {
        filename: FILENAME,
        babelrc: false,
        configFile: false,
        ast: true,
        code: false,
        plugins: [
          [plugin, { types: false, reactCompiler: 'full', warn: () => {} }],
          compiledAs(`
            import { c as _c } from 'react/compiler-runtime'
            export function Spread (t0) {
              const $ = _c(2)
              let t1
              if ($[0] !== t0) {
                t1 = Object.assign({}, t0, { children: 1 })
                $[0] = t0
                $[1] = t1
              } else {
                t1 = $[1]
              }
              return t1
            }
          `),
          generatedLocation
        ]
      })
      expect(() => serialize(ast)).not.toThrow()
    })

    it('leaves files in node_modules alone', () => {
      const { code } = transform(`
        import { $ } from 'teamplay'
        export function Counter () { return <b>{$(0).get()}</b> }
      `, { teamplay: { reactCompiler: 'full' }, compiler: false, filename: '/app/node_modules/lib/Counter.jsx' })
      expect(code).toContain('$(0).get()')
    })
  })

  it('leaves alone a file that is compiled code as written (a package\'s built files)', () => {
    const { code: compiled } = babel.transformSync('export function Count ({ $doc }) { return <span>{$doc.count.get()}</span> }', {
      filename: FILENAME, babelrc: false, configFile: false, parserOpts: { plugins: ['jsx'] }, plugins: [COMPILER]
    })
    for (const reactCompilerMode of ['optOut', 'full', undefined]) {
      const { code, warnings } = transform(compiled, { teamplay: { reactCompiler: reactCompilerMode }, compiler: false, filename: '/repo/packages/ui/dist/Count.js' })
      expect(code).not.toContain('_tp')
      expect(warnings).toEqual([])
    }
  })

  it('needs to run before the React Compiler', () => {
    // the compiler listed first, in the same pass
    for (const reactCompilerMode of ['optOut', 'full']) {
      expect(() => babel.transformSync('export function Count ({ $doc }) { return <span>{$doc.count.get()}</span> }', {
        filename: FILENAME,
        babelrc: false,
        configFile: false,
        parserOpts: { plugins: ['jsx'] },
        plugins: [COMPILER, [plugin, { types: false, reactCompiler: reactCompilerMode }]]
      })).toThrow(/needs babel-plugin-teamplay to run before the React Compiler/)
    }
  })

  it('warns once when the React Compiler compiles signals and reactCompiler is not set', () => {
    const signals = 'export function Count ({ $doc }) { return <span>{$doc.count.get()}</span> }'
    const plain = 'export function Double ({ n }) { return <span>{n * 2}</span> }'
    expect(transform(plain).warnings).toEqual([])
    expect(transform(signals, { teamplay: { reactCompiler: false } }).warnings).toEqual([])
    expect(transform(signals).warnings).toEqual([
      expect.stringMatching(/The React Compiler compiled \/app\/src\/Component\.jsx, which uses signals/)
    ])
    expect(transform(signals).warnings).toEqual([])
  })

  describe('dollarCalls', () => {
    const source = `
      import { $, signal } from 'startupjs'
      import { $ as other } from './other'
      const $global = $(1)
      const $legacy = signal($, ['users'])
      export function Counter () {
        const $count = $(0)
        const $lost = signal(0)
        return <b>{$count.get()}{$lost.get()}{other(1)}</b>
      }
    `

    it("'warn' reports the $() calls and signal() in components", () => {
      const { warnings } = transform(source, { teamplay: { dollarCalls: 'warn' }, compiler: false })
      expect(warnings).toEqual([
        expect.stringMatching(/Component\.jsx:4:\d+: Use signal\(\) instead of \$\(\) outside components and hooks/),
        expect.stringMatching(/Component\.jsx:7:\d+: Use useSignal\(\) instead of \$\(\) in components and hooks/),
        expect.stringMatching(/Component\.jsx:8:\d+: signal\(\) creates a new signal on every render/)
      ])
    })

    it("'error' fails the build", () => {
      expect(() => transform(source, { teamplay: { dollarCalls: 'error' }, compiler: false }))
        .toThrow(/Use signal\(\) instead of \$\(\) outside components and hooks/)
    })
  })
})
