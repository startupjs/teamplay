// React Compiler support and the $() call deprecation (options `reactCompiler`
// and `dollarCalls`). See docs/guide/react-integration.md.
//
// The compiler caches a value until one of its inputs changes identity, but a
// signal keeps its identity when its data changes, so compiled components that
// read signals show stale values. `reactCompiler`:
//
// - 'optOut': a component or a hook that uses signals gets 'use no memo', so
//   the compiler leaves it as written. Must run before the compiler (the
//   compiler compiles the whole file on Program enter; this works on Program
//   enter too, so babel-plugin-teamplay has to come first).
// - 'full': the compiler compiles everything, and teamplay keeps the compiled
//   code reactive:
//   - before the compiler (Program enter), a $() call made directly in a
//     component or a hook becomes useSignal(), which the compiler then never
//     caches and always calls, in order; a function passed inline to
//     observer() gets 'use memo' (the compiler doesn't compile it otherwise);
//     and a function body that relies on its function declarations being
//     hoisted gets them moved to its top (the compiler doesn't hoist them all);
//     the compiler's enableTreatFunctionDepsAsConditional is set, unless the
//     app set it (it reads a callback's values ahead, on every render);
//   - after it (Program exit), each memo scope the compiler emitted
//       if (DEPS_CHANGED) { BODY } else { ...cached outputs... }
//     becomes
//       if (DEPS_CHANGED || _tp.dirty($, K, [UPSTREAM], JSX)) { _tp.run($, K, () => { BODY }) } else { ... }
//     K is the scope's first cache slot; UPSTREAM the scopes whose outputs
//     its dependencies are; JSX whether it creates elements (see
//     teamplay/src/react/compilerScopes.ts). A scope that leaves its body
//     (return, break, continue) can't run in a function, and a function whose
//     compiled code isn't recognized can't be instrumented: inside observer()
//     those scopes recompute on every render (`|| _tp.inObserver()`).
// - unset: if the compiler compiled a file that uses signals in the same
//   babel pass, warn that `reactCompiler` should be set. `false` turns it off.
//
// `dollarCalls: 'warn' | 'error'` reports $() calls: useSignal() replaces them
// in components and hooks, signal() everywhere else.

const HOOK_NAME = /^use[A-Z0-9]/
const COMPONENT_NAME = /^[A-Z]/
const WRAPPERS = new Set(['memo', 'forwardRef', 'observer'])
const DEFAULT_SOURCES = ['teamplay', 'startupjs']
const COMPILER_RUNTIMES = new Set(['react/compiler-runtime', 'react-compiler-runtime'])
// babel-plugin-react-compiler's name (its key in a Babel pipeline)
const COMPILER_PLUGIN = 'react-forget'
const CACHE_SENTINEL = 'react.memo_cache_sentinel'
const MODES = new Set(['optOut', 'full'])
const REPORT_LEVELS = new Set(['warn', 'error'])
const DOCS = 'https://github.com/startupjs/teamplay/blob/master/docs/guide/react-integration.md#react-compiler'

const SKIP = 'teamplayReactCompilerSkip'
const COMPILED_SOURCE = /(?:from|require\()\s*['"]react(?:\/|-)compiler-runtime['"]/

let warnedUnconfigured = false

function normalizeReactCompilerOptions (options = {}) {
  const { reactCompiler, dollarCalls } = options
  if (reactCompiler != null && reactCompiler !== false && !MODES.has(reactCompiler)) {
    throw Error(`[babel-plugin-teamplay] reactCompiler: expected 'optOut', 'full' or false, got ${JSON.stringify(reactCompiler)}`)
  }
  if (dollarCalls != null && dollarCalls !== false && !REPORT_LEVELS.has(dollarCalls)) {
    throw Error(`[babel-plugin-teamplay] dollarCalls: expected 'warn', 'error' or false, got ${JSON.stringify(dollarCalls)}`)
  }
  return {
    reactCompiler: reactCompiler ?? undefined,
    dollarCalls: dollarCalls || undefined,
    // the modules signals are imported from
    teamplaySources: options.teamplaySources || DEFAULT_SOURCES,
    // where the code 'full' generates imports teamplay's runtime from
    // (default: the module the file imports teamplay from, or 'teamplay')
    reactCompilerRuntime: options.reactCompilerRuntime
  }
}

function reactCompilerProgramEnter (program, state, options, t) {
  if (options.reactCompiler === 'full') readFunctionDepsConditionally(state.file)
  const filename = state.file.opts.filename || ''
  if (isDependency(filename)) return
  // compiled code as written (a package's built files): left as it is
  if (COMPILED_SOURCE.test(state.file.code || '')) {
    state.set(SKIP, true)
    return
  }
  const { reactCompiler, dollarCalls } = options
  if (!reactCompiler && !dollarCalls) return
  if (MODES.has(reactCompiler) && getCompilerCacheFactory(program)) {
    throw program.buildCodeFrameError(
      `[babel-plugin-teamplay] reactCompiler: '${reactCompiler}' needs babel-plugin-teamplay to run before ` +
      'the React Compiler, and the React Compiler has already compiled this file. List babel-plugin-teamplay ' +
      `before babel-plugin-react-compiler (or before the preset that adds it). See ${DOCS}`
    )
  }
  if (MODES.has(reactCompiler)) nameHooksAsHooks(program, t)
  const teamplay = getTeamplayImports(program, options.teamplaySources)
  if (dollarCalls) reportDollarCalls(program, teamplay, filename, dollarCalls, options.warn)
  if (reactCompiler === 'optOut') {
    optOut(program, teamplay, t)
  } else if (reactCompiler === 'full') {
    renameLocalSignals(program, teamplay, t)
    compileInlineObservers(program, teamplay, t)
    hoistFunctionDeclarations(program)
  }
}

function reactCompilerProgramExit (program, state, options, t) {
  const filename = state.file.opts.filename || ''
  if (isDependency(filename) || state.get(SKIP)) return
  const { reactCompiler } = options
  const cacheFactory = getCompilerCacheFactory(program)
  if (!cacheFactory) return
  if (reactCompiler) clearGeneratedLocations(program)
  if (reactCompiler === false || reactCompiler === 'optOut') return
  if (reactCompiler === undefined) {
    if (!warnedUnconfigured && sourceUsesSignals(state.file.code, program, options)) {
      warnedUnconfigured = true
      options.warn(
        `[teamplay] The React Compiler compiled ${filename}, which uses signals: compiled components ` +
        'and hooks show stale values unless babel-plugin-teamplay\'s `reactCompiler` option is set ' +
        `('optOut' or 'full', or false to silence this warning). See ${DOCS}`
      )
    }
    return
  }
  instrumentCompiledCode(program, cacheFactory, filename, options, t)
}

// The compiler takes a function given to an element, to a hook, or returned
// for one called while rendering, and reads ahead what it reads unconditionally
// (`course.id` in an onPress) as its dependency, on every render: that throws
// while `course` is undefined (a doc not loaded yet). 'full' compiles observer()
// components the compiler skipped before, whose code may read such values only
// on press. The compiler's enableTreatFunctionDepsAsConditional makes the
// dependency the object itself. It's set on the compiler's options, which the
// compiler reads on its Program enter (after this one; as the compiler finds
// Reanimated's plugin), unless the app set it.
function readFunctionDepsConditionally (file) {
  const compiler = file.opts.plugins?.find(plugin => plugin?.key === COMPILER_PLUGIN)
  const options = compiler?.options
  if (!options || typeof options !== 'object') return
  if (options.environment?.enableTreatFunctionDepsAsConditional !== undefined) return
  options.environment = { ...options.environment, enableTreatFunctionDepsAsConditional: true }
}

// The compiler marks a node it generates with a Symbol location (its
// GeneratedSource), which later transforms copy (a JSX spread of a compiled
// temporary becomes `Object.assign({}, t7, ...)`). Code generation ignores it,
// but a bundler that sends the AST to another process (Expo's tree shaking:
// Metro's workers) can't serialize a Symbol.
function clearGeneratedLocations (program) {
  program.traverse({
    enter (path) {
      if (typeof path.node.loc === 'symbol') path.node.loc = null
    }
  })
}

// ----- the files to leave alone

function isDependency (filename) {
  return /[\\/]node_modules[\\/]/.test(filename)
}

// ----- imports

function isTeamplaySource (source, sources) {
  return sources.some(s => typeof s === 'string' ? s === source : s.test(source))
}

// the local names of $, signal, useSignal and observer imported from
// teamplay, and the import declarations of those modules
function getTeamplayImports (program, sources) {
  const result = { $: new Set(), signal: new Set(), useSignal: new Set(), observer: new Set(), declarations: [], all: new Set() }
  for (const statement of program.get('body')) {
    if (!statement.isImportDeclaration()) continue
    if (!isTeamplaySource(statement.node.source.value, sources)) continue
    if (statement.node.importKind === 'type') continue
    result.declarations.push(statement)
    for (const specifier of statement.node.specifiers) {
      if (specifier.importKind === 'type') continue
      result.all.add(specifier.local.name)
      if (specifier.type === 'ImportDefaultSpecifier') {
        result.$.add(specifier.local.name)
        continue
      }
      if (specifier.type !== 'ImportSpecifier') continue
      const imported = specifier.imported.name ?? specifier.imported.value
      if (imported === '$') result.$.add(specifier.local.name)
      else if (imported === 'signal') result.signal.add(specifier.local.name)
      else if (imported === 'useSignal') result.useSignal.add(specifier.local.name)
      else if (imported === 'observer') result.observer.add(specifier.local.name)
    }
  }
  return result
}

// a call of one of the imported names (not of a local variable shadowing it)
function isImportedCall (call, names) {
  const callee = call.node.callee
  if (callee.type !== 'Identifier' || !names.has(callee.name)) return false
  return call.scope.getBinding(callee.name)?.kind === 'module'
}

function getCompilerCacheFactory (program) {
  for (const statement of program.get('body')) {
    if (!statement.isImportDeclaration() || !COMPILER_RUNTIMES.has(statement.node.source.value)) continue
    for (const specifier of statement.node.specifiers) {
      if (specifier.type === 'ImportSpecifier' && (specifier.imported.name ?? specifier.imported.value) === 'c') {
        return specifier.local.name
      }
    }
  }
}

// ----- dollarCalls

function reportDollarCalls (program, teamplay, filename, level, warn) {
  if (!teamplay.$.size && !teamplay.signal.size) return
  program.traverse({
    CallExpression (call) {
      let message
      if (isImportedCall(call, teamplay.$)) {
        message = inComponentOrHook(call)
          ? 'Use useSignal() instead of $() in components and hooks.'
          : 'Use signal() instead of $() outside components and hooks. If this function runs while a ' +
            'component renders, $() is a hook here: name the function use...() and call useSignal().'
      } else if (isImportedCall(call, teamplay.signal) && call.node.arguments.length <= 1 && inComponentOrHook(call)) {
        message = 'signal() creates a new signal on every render: use useSignal() in components and hooks.'
      }
      if (!message) return
      if (level === 'error') throw call.buildCodeFrameError(`[teamplay] ${message}`)
      const { line, column } = call.node.loc?.start || {}
      warn(`[teamplay] ${filename}${line ? `:${line}:${column + 1}` : ''}: ${message}`)
    }
  })
}

function inComponentOrHook (path) {
  const fn = path.getFunctionParent()
  return !!fn && isComponentOrHook(fn)
}

// ----- both modes, before the compiler

// The compiler knows a hook by the name it is called by (use..., then an
// uppercase letter or a digit) and caches the calls of anything else like
// any other value, so a hook called under another name runs only on the
// renders that recompute it: React then sees fewer hooks ("Rendered fewer
// hooks than expected"). Plugins that run before the compiler call hooks this
// way: CSSX imports `useCssxLayer` and calls it through
// `const _cssxLayer = _useCssxLayer` (babel's generated names start with
// "_"). A function imported under a hook name, and a module-level constant
// that is just another name for it, get a hook name.
function nameHooksAsHooks (program, t) {
  const hookBindings = []
  for (const statement of program.get('body')) {
    if (!statement.isImportDeclaration() || statement.node.importKind === 'type') continue
    for (const specifier of statement.node.specifiers) {
      if (specifier.type !== 'ImportSpecifier' || specifier.importKind === 'type') continue
      const imported = specifier.imported.name ?? specifier.imported.value
      if (HOOK_NAME.test(imported)) hookBindings.push({ local: specifier.local.name, hook: imported })
    }
  }
  if (!hookBindings.length) return
  const hookNames = new Map(hookBindings.map(({ local, hook }) => [local, hook]))
  // const alias = hook
  for (const statement of program.get('body')) {
    if (!statement.isVariableDeclaration({ kind: 'const' })) continue
    for (const declarator of statement.node.declarations) {
      if (!t.isIdentifier(declarator.id) || !t.isIdentifier(declarator.init)) continue
      const hook = hookNames.get(declarator.init.name)
      if (!hook) continue
      hookNames.set(declarator.id.name, hook)
      hookBindings.push({ local: declarator.id.name, hook })
    }
  }
  // the names called (a constant that only shares a hook's name isn't one)
  const called = new Set()
  program.traverse({
    CallExpression (call) {
      if (call.node.callee.type === 'Identifier') called.add(call.node.callee.name)
    }
  })
  const renames = hookBindings.filter(({ local }) => !HOOK_NAME.test(local) && called.has(local))
  if (!renames.length) return
  const used = usedNames(program)
  for (const { local, hook } of renames) {
    let name = hook
    for (let i = 2; used.has(name); i++) name = hook + i
    used.add(name)
    program.scope.rename(local, name)
  }
}

// every name in the file: a new name from outside it is captured by no
// inner binding
function usedNames (program) {
  const used = new Set()
  program.traverse({
    Identifier (identifier) {
      // not a name in this file: `imported` in `import { imported as local }`
      if (identifier.parentPath.isImportSpecifier() && identifier.key === 'imported') return
      used.add(identifier.node.name)
    }
  })
  return used
}

// ----- 'full', before the compiler

function renameLocalSignals (program, teamplay, t) {
  if (!teamplay.$.size) return
  let hookName = [...teamplay.useSignal][0]
  program.traverse({
    CallExpression (call) {
      if (!isImportedCall(call, teamplay.$) || !inComponentOrHook(call)) return
      if (!hookName) {
        const used = usedNames(program)
        hookName = 'useSignal'
        for (let i = 2; used.has(hookName); i++) hookName = 'useSignal' + i
        const declaration = teamplay.declarations.find(d => d.node.specifiers.some(s => teamplay.$.has(s.local.name)))
        declaration.pushContainer('specifiers', t.importSpecifier(t.identifier(hookName), t.identifier('useSignal')))
      }
      call.get('callee').replaceWith(t.identifier(hookName))
    }
  })
}

// The compiler compiles a function passed to memo() or forwardRef(), but not
// one passed to observer(), the usual way to write a teamplay component:
// 'use memo' makes it compile that one too.
function compileInlineObservers (program, teamplay, t) {
  if (!teamplay.observer.size) return
  program.traverse({
    CallExpression (call) {
      if (!isImportedCall(call, teamplay.observer)) return
      const fn = call.get('arguments.0')
      if (!fn?.isFunctionExpression() && !fn?.isArrowFunctionExpression()) return
      if (hasDirective(fn, 'use no memo') || hasDirective(fn, 'use memo')) return
      addDirective(fn, 'use memo', t)
    }
  })
}

// The compiler turns a function declaration in place into an assignment
// (`g = function g () {}`) when the code before it reaches it only through
// another hoisted function:
//   const x = prepare()            // calls g() before it is assigned
//   function g () { ... }
//   function prepare () { return g() }
// A function body that uses a function declared further down gets its
// function declarations moved to its top, where JavaScript hoists them anyway,
// so the code means the same and the compiler sees them declared before use.
// Any function: the compiler compiles nested ones too, and its settings decide
// which functions it compiles.
function hoistFunctionDeclarations (program) {
  program.traverse({
    Function (fn) {
      const body = fn.get('body')
      if (!body.isBlockStatement()) return
      const statements = body.get('body')
      const declarations = statements.filter(statement => statement.isFunctionDeclaration() && statement.node.id)
      if (!declarations.length || !declarations.some(usedBeforeDeclared)) return
      const nodes = declarations.map(declaration => declaration.node)
      for (const declaration of declarations) declaration.remove()
      body.unshiftContainer('body', nodes)
      fn.scope.crawl()
    }
  })
}

function usedBeforeDeclared (declaration) {
  const binding = declaration.parentPath.scope.getBinding(declaration.node.id.name)
  if (binding?.path !== declaration) return false
  return binding.referencePaths.some(reference => {
    const statement = reference.find(path => path.parent === declaration.parent && path.listKey === 'body')
    return !!statement && statement.key < declaration.key
  })
}

// ----- 'optOut'

function optOut (program, teamplay, t) {
  // what observer() wraps reads signals, whatever it names them
  program.traverse({
    CallExpression (call) {
      if (!isImportedCall(call, teamplay.observer)) return
      const fn = getFunction(call.get('arguments.0'))
      if (fn && !hasDirective(fn, 'use no memo') && !hasDirective(fn, 'use memo')) addDirective(fn, 'use no memo', t)
    }
  })
  program.traverse({
    'FunctionDeclaration|FunctionExpression|ArrowFunctionExpression' (fn) {
      if (!isComponentOrHook(fn)) return
      if (hasDirective(fn, 'use no memo') || hasDirective(fn, 'use memo') || !usesSignals(fn, teamplay)) return
      addDirective(fn, 'use no memo', t)
    }
  })
}

// the function a path is, or names (a declaration or `const X = function`)
function getFunction (path) {
  if (!path?.node) return
  if (path.isFunctionExpression() || path.isArrowFunctionExpression() || path.isFunctionDeclaration()) return path
  if (!path.isIdentifier()) return
  const binding = path.scope.getBinding(path.node.name)
  if (!binding || binding.constantViolations.length) return
  if (binding.path.isFunctionDeclaration()) return binding.path
  if (binding.path.isVariableDeclarator()) {
    const init = binding.path.get('init')
    if (init.isFunctionExpression() || init.isArrowFunctionExpression()) return init
  }
}

function addDirective (fn, value, t) {
  if (!t.isBlockStatement(fn.node.body)) {
    fn.get('body').replaceWith(t.blockStatement([t.returnStatement(fn.node.body)]))
  }
  fn.get('body').unshiftContainer('directives', t.directive(t.directiveLiteral(value)))
}

// the source as written (in the compiled code, the compiler's cache is `$`)
// imports teamplay or names a value $something
function sourceUsesSignals (code, program, options) {
  return getTeamplayImports(program, options.teamplaySources).declarations.length > 0 ||
    /(^|[^\w$])\$[A-Za-z_]/.test(code || '')
}

// a $-named value (teamplay's naming of signals) or anything imported from teamplay
function usesSignals (path, teamplay) {
  let found = false
  path.traverse({
    Identifier (identifier) {
      const name = identifier.node.name
      if (!identifier.isReferencedIdentifier()) return
      if (!name.startsWith('$') && !teamplay.all.has(name)) return
      found = true
      identifier.stop()
    }
  })
  return found
}

function hasDirective (fn, value) {
  return (fn.node.body.directives || []).some(directive => directive.value.value === value)
}

// a component or a hook, as the compiler sees it: a hook name, the argument of
// a wrapper, or a component name (a declaration, or `const X = ...`) on a
// function that creates elements or calls a hook
function isComponentOrHook (fn) {
  const name = getFunctionName(fn)
  if (name && HOOK_NAME.test(name)) return true
  if (isWrapperArgument(fn)) return true
  return !!name && COMPONENT_NAME.test(name) && callsHooksOrCreatesJsx(fn)
}

function callsHooksOrCreatesJsx (fn) {
  let found = false
  fn.traverse({
    Function (inner) { inner.skip() },
    'JSXElement|JSXFragment' (path) { found = true; path.stop() },
    CallExpression (call) {
      const callee = call.node.callee
      const hook = callee.type === 'Identifier'
        ? HOOK_NAME.test(callee.name)
        : callee.type === 'MemberExpression' && !callee.computed && callee.object.type === 'Identifier' &&
          COMPONENT_NAME.test(callee.object.name) && HOOK_NAME.test(callee.property.name)
      if (hook) { found = true; call.stop() }
    }
  })
  return found
}

function isWrapperArgument (fn) {
  const parent = fn.parentPath
  if (!parent.isCallExpression() || parent.node.arguments[0] !== fn.node) return false
  const callee = parent.node.callee
  const calleeName = callee.type === 'Identifier'
    ? callee.name
    : (callee.type === 'MemberExpression' && !callee.computed ? callee.property.name : undefined)
  return WRAPPERS.has(calleeName)
}

function getFunctionName (fn) {
  if (fn.isFunctionDeclaration()) return fn.node.id?.name
  const parent = fn.parentPath
  if (parent.isVariableDeclarator() && parent.get('id').isIdentifier()) return parent.node.id.name
}

// ----- 'full', after the compiler

function instrumentCompiledCode (program, cacheFactory, filename, options, t) {
  let runtime
  let enableStatement
  const getRuntime = () => {
    if (runtime) return t.identifier(runtime.name)
    runtime = program.scope.generateUidIdentifier('tp')
    const teamplay = getTeamplayImports(program, options.teamplaySources)
    const source = options.reactCompilerRuntime || teamplay.declarations[0]?.node.source.value || 'teamplay'
    program.unshiftContainer('body', t.importDeclaration(
      [t.importSpecifier(runtime, t.identifier('__reactCompiler'))],
      t.stringLiteral(source)
    ))
    // the observers rendered from now on track compiled scopes
    const imports = program.get('body').filter(statement => statement.isImportDeclaration())
    ;[enableStatement] = imports[imports.length - 1].insertAfter(t.expressionStatement(
      t.callExpression(t.memberExpression(t.identifier(runtime.name), t.identifier('enable')), [])
    ))
    return t.identifier(runtime.name)
  }
  const helper = name => t.memberExpression(getRuntime(), t.identifier(name))
  // the arrays the generated calls pass, as module constants (no allocation per render)
  const constants = new Map()
  const constant = values => {
    const id = values.join()
    if (!constants.has(id)) constants.set(id, { name: program.scope.generateUidIdentifier('tpKeys'), values })
    return t.identifier(constants.get(id).name.name)
  }
  program.traverse({
    VariableDeclarator (declarator) {
      const init = declarator.node.init
      if (!t.isCallExpression(init) || !t.isIdentifier(init.callee, { name: cacheFactory })) return
      if (!t.isIdentifier(declarator.node.id)) return
      const fn = declarator.getFunctionParent()
      if (!fn) return
      declarator.skip()
      const [size] = init.arguments
      const sized = t.isNumericLiteral(size)
      if (sized) declarator.get('init').replaceWith(t.callExpression(helper('cache'), [init]))
      const { recognized, extraSlots } = instrumentScopes(fn, declarator.node.id.name, t, helper, constant, sized ? size.value : undefined)
      // the slots of the extra dependencies, then one more, the last: the
      // runtime keeps the scopes' state in the cache (React gives each render
      // a copy of the cache it keeps)
      if (sized) init.arguments[0] = t.numericLiteral(size.value + extraSlots + 1)
      if (!recognized) {
        options.warn(
          `[teamplay] ${filename}: the React Compiler's output for ${describeFunction(fn)} is not recognized; ` +
          'inside observer() it recomputes on every render. Please report it: ' +
          'https://github.com/startupjs/teamplay/issues'
        )
      }
    }
  })
  // `var`, not `const`: a compiled function can run before its module's body
  // has (an import cycle, a bundler that concatenates modules), and a `const`
  // would throw then ("Cannot access ... before initialization"). An array
  // still undefined only makes the scope recompute.
  if (constants.size) {
    enableStatement.insertAfter([...constants.values()].map(({ name, values }) => t.variableDeclaration('var', [
      t.variableDeclarator(name, t.arrayExpression(values.map(value => t.numericLiteral(value))))
    ])))
  }
}

function describeFunction (fn) {
  const name = getFunctionName(fn)
  const line = fn.node.loc?.start.line
  return (name ? `${name}()` : 'a function') + (line ? ` (line ${line})` : '')
}

// `recognized` is false if the function's compiled code has a shape it
// doesn't know (or its cache size isn't known): then every scope recomputes
// inside observer(). `extraSlots`: the cache slots it added after the
// compiler's `size`.
function instrumentScopes (fn, cacheName, t, helper, constant, size) {
  const sized = size !== undefined
  const cacheBinding = fn.scope.getBinding(cacheName)
  const scopes = []
  const resets = []
  // the compiler's temporaries can shadow each other (a block's `t1` and the
  // function's `t1`): values are known by their bindings, not their names.
  // `const x = y` and `x = y`: x's values are y's
  const aliases = new Map()
  const addAlias = (scope, name, sourceName) => {
    const binding = scope.getBinding(name)
    const source = scope.getBinding(sourceName)
    if (!binding || !source) return
    if (!aliases.has(binding)) aliases.set(binding, new Set())
    aliases.get(binding).add(source)
  }
  fn.traverse({
    Function (inner) { inner.skip() },
    VariableDeclarator (declarator) {
      if (!t.isIdentifier(declarator.node.id) || !t.isIdentifier(declarator.node.init)) return
      addAlias(declarator.scope, declarator.node.id.name, declarator.node.init.name)
    },
    AssignmentExpression (assignment) {
      if (assignment.node.operator !== '=') return
      if (!t.isIdentifier(assignment.node.left) || !t.isIdentifier(assignment.node.right)) return
      addAlias(assignment.scope, assignment.node.left.name, assignment.node.right.name)
    },
    IfStatement (statement) {
      const test = statement.node.test
      if (!referencesCache(test, cacheName, t)) return
      // the reset of the whole cache when the source file changed (development)
      if (isCacheReset(test, cacheName, t)) {
        resets.push(statement)
        statement.skip()
        return
      }
      const keys = getScopeTestKeys(test, cacheName, t)
      scopes.push({
        statement,
        key: keys ? Math.min(...keys.map(({ slot }) => slot)) : undefined,
        // the slots that hold its dependencies (not the sentinel's)
        depSlots: keys ? keys.filter(({ dep }) => dep).map(({ slot }) => slot) : [],
        recognized: !!keys,
        inputs: collectReferenced(statement.get('test')),
        outputs: collectAssigned(statement.get('consequent'))
      })
    }
  })
  const recognized = sized && scopes.every(scope => scope.recognized) &&
    cacheUsesRecognized(cacheBinding, scopes, resets, t)
  // a binding and every binding its values can come from
  const sourcesOf = binding => {
    const found = new Set([binding])
    for (const current of found) {
      for (const source of aliases.get(current) || []) found.add(source)
    }
    return found
  }
  const outputs = new Set(scopes.flatMap(scope => [...scope.outputs]))
  const fromScopes = binding => [...sourcesOf(binding)].some(source => outputs.has(source))
  let extraSlots = 0
  for (const scope of scopes) {
    const consequent = scope.statement.get('consequent')
    // what its body uses, not only its dependencies: the compiler leaves out
    // the values it takes for constants (computed from the imported $)
    const used = [...collectUsed(consequent, fn, fromScopes)].filter(binding => !scope.outputs.has(binding))
    scope.upstream = new Set()
    for (const input of [...scope.inputs, ...used]) {
      for (const source of sourcesOf(input)) {
        for (const other of scopes) {
          if (other !== scope && other.outputs.has(source)) scope.upstream.add(other.key)
        }
      }
    }
    // extra dependencies: the values computed on every render outside the
    // scopes, that the body uses and the compiler didn't make dependencies
    scope.extraDeps = []
    if (!recognized) continue
    for (const binding of used) {
      if (binding === cacheBinding || binding.kind === 'param' || scope.inputs.has(binding) || fromScopes(binding)) continue
      // declared before the scope, and the same binding in its test
      if (!precedes(binding.path, scope.statement)) continue
      if (scope.statement.scope.getBinding(binding.identifier.name) !== binding) continue
      scope.extraDeps.push({ name: binding.identifier.name, slot: size + extraSlots++ })
    }
  }
  // inner scopes first: an outer scope's body moves into a function
  for (const { statement, key, upstream, depSlots, extraDeps } of [...scopes].reverse()) {
    const consequent = statement.get('consequent')
    // the clock, read while rendering: recomputed on every render, as without
    // the compiler (the compiler takes it for a pure value and computes it once)
    if (readsClock(consequent)) {
      statement.node.test = t.logicalExpression('||', statement.node.test, t.booleanLiteral(true))
    }
    const slot = index => t.memberExpression(t.identifier(cacheName), t.numericLiteral(index), true)
    // $[N] !== x || ..., and $[N] = x first thing in the body
    let changed
    for (const { name, slot: index } of extraDeps) {
      const test = t.binaryExpression('!==', slot(index), t.identifier(name))
      changed = changed ? t.logicalExpression('||', changed, test) : test
    }
    if (extraDeps.length) {
      if (!consequent.isBlockStatement()) consequent.replaceWith(t.blockStatement([consequent.node]))
      statement.get('consequent').unshiftContainer('body', extraDeps.map(({ name, slot: index }) =>
        t.expressionStatement(t.assignmentExpression('=', slot(index), t.identifier(name)))
      ))
    }
    if (!recognized || leavesBody(consequent)) {
      const test = changed ? t.logicalExpression('||', statement.node.test, changed) : statement.node.test
      statement.node.test = t.logicalExpression('||', test, t.callExpression(helper('inObserver'), []))
      continue
    }
    // _tp.dirty($, K, UPSTREAM_KEYS, JSX, DEP_SLOTS, PURE), trailing defaults left out
    const jsx = createsElements(consequent.node, t)
    // a body that can't read signals (it only builds elements, callbacks and
    // literals from values already computed) needs no reaction
    const pure = readsNothing(consequent, cacheName, t)
    const allDepSlots = [...depSlots, ...extraDeps.map(({ slot: index }) => index)]
    const dirtyArgs = [
      t.identifier(cacheName),
      t.numericLiteral(key),
      upstream.size ? constant([...upstream]) : t.nullLiteral(),
      t.booleanLiteral(jsx),
      allDepSlots.length ? constant(allDepSlots) : t.identifier('undefined'),
      t.booleanLiteral(pure),
      changed || t.booleanLiteral(false)
    ]
    while (dirtyArgs.length > 2 && isDefaultArg(dirtyArgs[dirtyArgs.length - 1], t)) dirtyArgs.pop()
    statement.node.test = t.logicalExpression('||', statement.node.test, t.callExpression(helper('dirty'), dirtyArgs))
    if (pure) continue
    const body = t.isBlockStatement(consequent.node) ? consequent.node.body : [consequent.node]
    consequent.replaceWith(t.blockStatement([
      t.expressionStatement(t.callExpression(helper('run'), [
        t.identifier(cacheName), t.numericLiteral(key), t.arrowFunctionExpression([], t.blockStatement(body))
      ]))
    ]))
  }
  return { recognized, extraSlots }
}

// nothing in the body (outside the functions it creates, which don't run
// now) can read a signal: no member reads but cache slots and imported
// namespaces (Modal.Content), no calls but element factories, no spreads
function readsNothing (body, cacheName, t) {
  let reads = false
  const stop = path => { reads = true; path.stop() }
  body.traverse({
    Function (inner) { inner.skip() },
    MemberExpression (member) {
      const object = member.node.object
      if (member.node.computed && t.isIdentifier(object, { name: cacheName }) && t.isNumericLiteral(member.node.property)) return
      if (!member.node.computed && t.isIdentifier(object) && member.scope.getBinding(object.name)?.kind === 'module') return
      stop(member)
    },
    CallExpression (call) {
      const callee = call.node.callee
      if (t.isIdentifier(callee) && ELEMENT_FACTORY.test(callee.name) && call.scope.getBinding(callee.name)?.kind === 'module') return
      stop(call)
    },
    'OptionalMemberExpression|OptionalCallExpression|NewExpression|TaggedTemplateExpression|SpreadElement|JSXSpreadAttribute|JSXSpreadChild|AwaitExpression|YieldExpression|UpdateExpression' (path) { stop(path) },
    UnaryExpression (unary) { if (unary.node.operator === 'delete') stop(unary) },
    // `a in b` reads b
    BinaryExpression (binary) { if (binary.node.operator === 'in' || binary.node.operator === 'instanceof') stop(binary) },
    ForInStatement: stop,
    ForOfStatement: stop
  })
  return !reads
}

function isDefaultArg (node, t) {
  return t.isNullLiteral(node) || t.isBooleanLiteral(node, { value: false }) || t.isIdentifier(node, { name: 'undefined' })
}

function referencesCache (node, cacheName, t) {
  let found = false
  walk(node, n => { if (t.isIdentifier(n, { name: cacheName })) found = true })
  return found
}

// $[0] !== "<hash>"
function isCacheReset (test, cacheName, t) {
  return t.isBinaryExpression(test, { operator: '!==' }) && isCacheSlot(test.left, cacheName, t) &&
    t.isStringLiteral(test.right)
}

// $[i] !== x || $[j] !== y ..., or $[i] === Symbol.for("react.memo_cache_sentinel"):
// the slots compared ({ slot, dep: whether it holds a dependency }), or
// undefined for another shape
function getScopeTestKeys (test, cacheName, t) {
  if (t.isLogicalExpression(test, { operator: '||' })) {
    const left = getScopeTestKeys(test.left, cacheName, t)
    const right = getScopeTestKeys(test.right, cacheName, t)
    return left && right && [...left, ...right]
  }
  if (!t.isBinaryExpression(test) || !isCacheSlot(test.left, cacheName, t)) return
  if (referencesCache(test.right, cacheName, t)) return
  if (test.operator === '!==') return [{ slot: test.left.property.value, dep: true }]
  if (test.operator === '===' && isSentinel(test.right, t)) return [{ slot: test.left.property.value, dep: false }]
}

function isCacheSlot (node, cacheName, t) {
  return t.isMemberExpression(node, { computed: true }) && t.isIdentifier(node.object, { name: cacheName }) &&
    t.isNumericLiteral(node.property)
}

function isSentinel (node, t) {
  return t.isCallExpression(node) && t.isMemberExpression(node.callee) &&
    t.isIdentifier(node.callee.object, { name: 'Symbol' }) && t.isIdentifier(node.callee.property, { name: 'for' }) &&
    t.isStringLiteral(node.arguments[0], { value: CACHE_SENTINEL })
}

// every use of the cache is one the instrumentation knows: a slot in a
// scope's test, a slot a scope's body writes ($[i] = x), a slot its else
// branch reads (x = $[i]), or the cache reset
function cacheUsesRecognized (cacheBinding, scopes, resets, t) {
  if (!cacheBinding) return false
  const tests = new Set(scopes.map(scope => scope.statement.node.test))
  const consequents = new Set(scopes.map(scope => scope.statement.node.consequent))
  const alternates = new Set(scopes.map(scope => scope.statement.node.alternate).filter(Boolean))
  const within = (path, nodes) => nodes.has(path.node) || !!path.findParent(parent => nodes.has(parent.node))
  return cacheBinding.referencePaths.every(reference => {
    if (resets.some(reset => reference.isDescendant(reset))) return true
    const slot = reference.parentPath
    if (!slot.isMemberExpression({ computed: true }) || slot.node.object !== reference.node) return false
    if (!t.isNumericLiteral(slot.node.property)) return false
    if (within(slot, tests)) return true
    const parent = slot.parentPath
    if (!parent.isAssignmentExpression({ operator: '=' })) return false
    if (parent.node.left === slot.node) return within(parent, consequents)
    return parent.node.right === slot.node && within(parent, alternates)
  })
}

function collectReferenced (path) {
  const bindings = new Set()
  const add = identifier => {
    const binding = identifier.scope.getBinding(identifier.node.name)
    if (binding) bindings.add(binding)
  }
  if (path.isIdentifier()) add(path)
  path.traverse({ ReferencedIdentifier: add })
  return bindings
}

// the bindings of the compiled function `fn`, declared outside `path`, that
// `path` uses (also in the functions it creates), and that the functions it
// uses use, if they are declared outside the scopes (a function is recreated
// on every render, and what it does depends on the values it captures)
function collectUsed (path, fn, fromScopes) {
  const used = new Set()
  const visited = new Set()
  const visit = target => {
    visited.add(target.node)
    target.traverse({
      ReferencedIdentifier (identifier) {
        const binding = identifier.scope.getBinding(identifier.node.name)
        if (!binding || binding.scope.getFunctionParent() !== fn.scope) return
        if (isWithin(binding.path, target)) return
        const closure = fromScopes(binding) ? undefined : getFunction(identifier)
        if (!closure) {
          used.add(binding)
        } else if (!visited.has(closure.node)) {
          visit(closure)
        }
      }
    })
  }
  visit(path)
  return used
}

function isWithin (path, ancestor) {
  return path.node === ancestor.node || !!path.findParent(parent => parent.node === ancestor.node)
}

// whether `path` comes before `target` in the code of a block they share
function precedes (path, target) {
  const targetAncestry = target.getAncestry()
  const depth = new Map(targetAncestry.map((ancestor, index) => [ancestor.node, index]))
  for (let child = path; child.parentPath; child = child.parentPath) {
    const index = depth.get(child.parentPath.node)
    if (index === undefined) continue
    const targetChild = targetAncestry[index - 1]
    return !!targetChild && child.listKey !== undefined && child.listKey === targetChild.listKey &&
      child.key < targetChild.key
  }
  return false
}

function collectAssigned (path) {
  const bindings = new Set()
  path.traverse({
    Function (inner) { inner.skip() },
    AssignmentExpression (assignment) {
      if (assignment.node.left.type !== 'Identifier') return
      const binding = assignment.scope.getBinding(assignment.node.left.name)
      if (binding) bindings.add(binding)
    }
  })
  return bindings
}

// JSX, or the calls JSX compiles to (when it is compiled first), that the
// body runs: also in a function it passes to a call (items.map(item => <Row />)),
// not in one it only creates (a callback, a render prop: a memoized callback
// keeps its identity)
const ELEMENT_FACTORY = /^_?(jsxs?|jsxDEV|createElement)$/
function createsElements (node, t) {
  if (!node || typeof node.type !== 'string') return false
  if (t.isJSXElement(node) || t.isJSXFragment(node)) return true
  if (t.isCallExpression(node)) {
    const callee = node.callee
    const name = t.isIdentifier(callee) ? callee.name : (t.isMemberExpression(callee) && t.isIdentifier(callee.property) ? callee.property.name : '')
    if (ELEMENT_FACTORY.test(name)) return true
  }
  const calls = t.isCallExpression(node) || t.isOptionalCallExpression(node) || t.isNewExpression(node)
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'leadingComments' || key === 'trailingComments') continue
    for (const child of [].concat(node[key])) {
      if (!child || typeof child.type !== 'string') continue
      if (t.isFunction(child) && !(calls && key === 'arguments')) continue
      if (createsElements(child, t)) return true
    }
  }
  return false
}

const CLOCK_LIBRARIES = new Set(['moment', 'dayjs'])

// Date.now(), new Date() or performance.now(), or moment() / dayjs() (and
// their .utc()) with no argument, in the body (not in the functions it
// creates, which don't run while rendering)
function readsClock (body) {
  let reads = false
  // the default import of moment or dayjs
  const isClockLibrary = (path, name) => {
    const binding = path.scope.getBinding(name)
    if (!binding || binding.kind !== 'module') return false
    const declaration = binding.path.parentPath
    return (binding.path.isImportDefaultSpecifier() || binding.path.isImportNamespaceSpecifier()) &&
      declaration.isImportDeclaration() && CLOCK_LIBRARIES.has(declaration.node.source.value)
  }
  // the global one, not a variable of that name
  const isGlobal = (path, name) => !path.scope.getBinding(name)
  const isCall = (call, object, property) => {
    const callee = call.node.callee
    return callee.type === 'MemberExpression' && !callee.computed && callee.object.type === 'Identifier' &&
      callee.object.name === object && callee.property.name === property && isGlobal(call, object)
  }
  body.traverse({
    Function (inner) { inner.skip() },
    CallExpression (call) {
      const callee = call.node.callee
      const library = !call.node.arguments.length && (
        (callee.type === 'Identifier' && isClockLibrary(call, callee.name)) ||
        (callee.type === 'MemberExpression' && !callee.computed && callee.object.type === 'Identifier' &&
          callee.property.name === 'utc' && isClockLibrary(call, callee.object.name))
      )
      if (library || isCall(call, 'Date', 'now') || isCall(call, 'performance', 'now')) { reads = true; call.stop() }
    },
    NewExpression (expression) {
      if (expression.get('callee').isIdentifier({ name: 'Date' }) && !expression.node.arguments.length && isGlobal(expression, 'Date')) {
        reads = true
        expression.stop()
      }
    }
  })
  return reads
}

// a return, or a break/continue whose target is outside the body
function leavesBody (body) {
  let leaves = false
  const escapes = (jump, isBreak) => {
    const label = jump.node.label?.name
    for (let parent = jump.parentPath; parent && parent !== body; parent = parent.parentPath) {
      if (label) {
        if (parent.isLabeledStatement() && parent.node.label.name === label) return false
      } else if (parent.isLoop() || (isBreak && parent.isSwitchStatement())) {
        return false
      }
    }
    return true
  }
  body.traverse({
    Function (inner) { inner.skip() },
    ReturnStatement (statement) { leaves = true; statement.stop() },
    BreakStatement (statement) { if (escapes(statement, true)) { leaves = true; statement.stop() } },
    ContinueStatement (statement) { if (escapes(statement, false)) { leaves = true; statement.stop() } }
  })
  return leaves
}

function walk (node, visit) {
  if (!node || typeof node.type !== 'string') return
  visit(node)
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'leadingComments' || key === 'trailingComments') continue
    const value = node[key]
    if (Array.isArray(value)) for (const item of value) walk(item, visit)
    else if (value && typeof value.type === 'string') walk(value, visit)
  }
}

module.exports = {
  normalizeReactCompilerOptions,
  reactCompilerProgramEnter,
  reactCompilerProgramExit,
  // for tests
  __resetWarnings () { warnedUnconfigured = false }
}
