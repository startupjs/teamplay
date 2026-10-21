// React Compiler support (babel-plugin-teamplay's `reactCompiler: 'full'`):
// the runtime of the compiler's memo scopes, as the plugin instruments them:
//
//   const $ = _tp.cache(_c(N))
//   if (DEPS_CHANGED || _tp.dirty($, K, [UPSTREAM_KEYS], JSX)) {
//     _tp.run($, K, () => { BODY })
//   } else { ...the cached outputs... }
//
// The compiler recomputes a scope only when a dependency changes identity,
// but a signal keeps its identity when its data changes. So inside an
// observer() render each scope body runs in its own reaction. When a signal it
// read changes, the scope (and the scopes around it) is marked dirty and the
// component re-renders: that scope recomputes, and so do the scopes that use
// its outputs (UPSTREAM_KEYS, found statically: a recomputed value can keep
// its identity, e.g. a doc's object changed in place) and, on a render a
// signal change caused, the scopes that create elements (JSX). The other
// scopes keep their cache, so a callback the compiler memoized (a useCallback()
// it replaced) keeps its identity. Reads in a scope that stays cached stay
// tracked by its reaction from when it last ran.
// Outside observer(), the scopes behave as the compiler wrote them.
//
// React gives each render a copy of the cache array, so a scope is known by
// its cache's position among the render's caches (the compiled component and
// hooks call _c() in hook order) and its first slot.
//
// React keeps a render's cache only if the render commits: a render that
// suspends, is interrupted, or is StrictMode's first one is thrown away, and
// the next render starts from the committed cache. So a scope stays dirty
// until a render that recomputed it commits (commitScopes()), and a scope the
// context has no committed run of (a new context: after a suspended render
// destroyed the observer's reaction) recomputes.
import { observe, unobserve } from '@nx-js/observer-util'
import executionContextTracker, { type ScopeContext } from './executionContextTracker.ts'

export interface ScopeRun {
  // context.seq when it ran
  seq: number
  // it recomputed although its deps did not change
  forced: boolean
  cleanup?: () => void
}

const CACHE_POSITIONS = new WeakMap<object, number>()

// Set when compiled code is loaded (each file the plugin instrumented calls
// enable()). An observer() decides on its first render whether to track
// scopes, so it calls the same hooks on every render, and observers cost
// nothing extra in an app without compiled code.
let enabled = false

export function enable (): void {
  enabled = true
}

export function isEnabled (): boolean {
  return enabled
}

export function createScopeContext (notify: () => void): ScopeContext {
  return {
    notify,
    cleanups: new Set(),
    cacheCount: 0,
    seq: 0,
    committed: new Map(),
    pending: new Map(),
    invalidated: new Map(),
    parents: new Map(),
    notified: 0,
    renderNotified: 0,
    committedNotified: 0,
    signalRender: false
  }
}

// a signal one of the component's reactions read changed
export function notifyScopes (context: ScopeContext): void {
  context.notified = ++context.seq
  context.notify()
}

export function startRender (context: ScopeContext): void {
  context.cacheCount = 0
  // the runs of a render that did not commit
  for (const run of context.pending.values()) dispose(context, run)
  context.pending.clear()
  context.renderNotified = context.notified
  context.signalRender = context.notified > context.committedNotified
}

export function commitScopes (context: ScopeContext): void {
  for (const [id, run] of context.pending) {
    const previous = context.committed.get(id)
    if (previous) dispose(context, previous)
    context.committed.set(id, run)
  }
  context.pending.clear()
  context.committedNotified = context.renderNotified
}

export function destroyScopes (context: ScopeContext): void {
  for (const cleanup of context.cleanups) cleanup()
  context.cleanups.clear()
  context.committed.clear()
  context.pending.clear()
}

export function cache<T extends object> (memoCache: T): T {
  const context = executionContextTracker.getScopeContext()
  if (context) CACHE_POSITIONS.set(memoCache, context.cacheCount++)
  return memoCache
}

function scopeId (memoCache: object, key: number): string {
  return CACHE_POSITIONS.get(memoCache) + ':' + key
}

// `jsx`: the scope creates elements. On a render a signal change caused, it
// recomputes, as every element does without the compiler: a child that is not
// an observer() and reads an object changed in place (same identity) renders again.
export function dirty (memoCache: object, key: number, upstream?: number[] | null, jsx?: boolean): boolean {
  const context = executionContextTracker.getScopeContext()
  // an observer() that started before compiled code was loaded: recompute,
  // and the render tracks the reads
  if (!context) return executionContextTracker.isActive()
  const id = scopeId(memoCache, key)
  const committed = context.committed.get(id)
  let forced = !committed || (context.invalidated.get(id) ?? -1) > committed.seq || (!!jsx && context.signalRender)
  if (!forced && upstream) {
    forced = upstream.some(upstreamKey => context.pending.get(scopeId(memoCache, upstreamKey))?.forced)
  }
  if (forced) context.forced = id
  return forced
}

export function run (memoCache: object, key: number, body: () => void): void {
  const context = executionContextTracker.getScopeContext()
  if (!context) return body()
  const id = scopeId(memoCache, key)
  const previous = context.pending.get(id)
  if (previous) dispose(context, previous)
  const scopeRun: ScopeRun = { seq: ++context.seq, forced: context.forced === id }
  context.forced = undefined
  context.parents.set(id, context.currentScope)
  context.pending.set(id, scopeRun)
  const reaction = observe(() => {
    const parent = context.currentScope
    context.currentScope = id
    try {
      body()
    } finally {
      context.currentScope = parent
    }
  }, {
    lazy: true,
    scheduler: () => {
      const seq = ++context.seq
      for (let marked: string | undefined = id; marked; marked = context.parents.get(marked)) {
        context.invalidated.set(marked, seq)
      }
      notifyScopes(context)
    }
  })
  scopeRun.cleanup = () => unobserve(reaction)
  context.cleanups.add(scopeRun.cleanup)
  reaction()
}

// for a scope that can't run in a function (it returns, or breaks out of its
// block) or that the plugin didn't recognize: inside observer() it recomputes
// on every render (its reads are then tracked by the render itself)
export function inObserver (): boolean {
  return executionContextTracker.isActive()
}

function dispose (context: ScopeContext, scopeRun: ScopeRun): void {
  if (!scopeRun.cleanup) return
  scopeRun.cleanup()
  context.cleanups.delete(scopeRun.cleanup)
}

// what the code babel-plugin-teamplay generates calls (exported by 'teamplay'
// as __reactCompiler)
export const compiledCodeRuntime = { enable, cache, dirty, run, inObserver }
