// React Compiler support (babel-plugin-teamplay's `reactCompiler: 'full'`):
// the runtime of the compiler's memo scopes, as the plugin instruments them:
//
//   const $ = _tp.cache(_c(N + E + 1))       // the last slot: the scopes' state (below)
//   if (DEPS_CHANGED || _tp.dirty($, K, UPSTREAM_KEYS, JSX, DEP_SLOTS, PURE, $[N] !== x)) {
//     $[N] = x
//     _tp.run($, K, () => { BODY })
//   } else { ...the cached outputs... }
//
// A body that can't read signals (it only builds elements, callbacks and
// literals from values already computed: PURE) runs as written, with no
// reaction; only JSX, UPSTREAM_KEYS and its extra dependencies can make it
// recompute.
//
// The extra dependencies ($[N] !== x, in slots after the compiler's) are the
// values the body uses that are computed on every render outside the scopes
// and that the compiler took for constants: values read from the imported $
// (`const search = $._page.search.get()`).
//
// The compiler recomputes a scope only when a dependency changes identity,
// but a signal keeps its identity when its data changes. So inside an
// observer() render each scope body runs in its own reaction. When a signal it
// read changes, the scope (and the scopes around it) is invalidated and the
// component re-renders: that scope recomputes, and so do the scopes that use
// its outputs (UPSTREAM_KEYS, found statically: a recomputed value can keep its
// identity, e.g. a doc's object changed in place) and, on a render a signal
// change caused, the scopes that create elements (JSX). The other scopes keep
// their cache, so a callback the compiler memoized (a useCallback() it
// replaced) keeps its identity. Reads in a scope that stays cached stay
// tracked by its reaction from when it last ran.
//
// Outside observer() nothing tracks reads, and nothing re-renders the
// component when a signal changes. But when something does (its parent), a
// scope that reads signals (directly, or through a helper such as i18n's t())
// recomputes, as every render recomputes it without the compiler: such a scope
// runs once in a throwaway reaction that only notes whether it read any. So
// does a scope whose cached dependencies (DEP_SLOTS) may be a doc's data,
// which changes in place: a plain object or array (outside a reaction, a doc's
// data reads as its raw objects), and one whose extra dependencies changed.
//
// Where the scopes' state lives: React keeps the cache of a render only if
// the render commits (a render that suspends, is interrupted, or is
// StrictMode's first one is thrown away), and gives the next render a copy of
// the committed cache. So each run of a scope (its reaction) is kept in the
// cache itself, in slot N, copied on write: whatever cache React keeps carries
// the runs that computed it. The runs a kept cache no longer holds are disposed
// when a render commits; all of them when the component is collected.
// The runs outlive the observer's own reaction (destroyed and created again
// for StrictMode's effect replay, a hidden <Activity>, a suspended render):
// while it is gone a run only marks its scope invalid, and the next render
// recomputes just what changed.
import { observe, unobserve } from '@nx-js/observer-util'
import executionContextTracker, { type ScopeContext } from './executionContextTracker.ts'

export interface ScopeRun {
  // context.seq when it ran
  seq: number
  // the render (context.renderId) that recomputed it although its deps did not change
  forcedIn: number
  dispose: () => void
}

// one per compiled function call (a component's or a hook's cache), the same
// in every copy of its cache
interface ScopeOwner {
  // scope key -> context.seq when a signal it (or a scope inside it) read changed
  invalidated: Map<number, number>
  // scope key -> the key of the scope its body runs in
  parents: Map<number, number | undefined>
  // outside observer(): the scopes whose last run read signals
  reading: Set<number>
  // scope key -> the render that recomputed it although its deps did not
  // change, for a PURE scope (it has no run to keep it in)
  pureForcedIn: Map<number, number>
}

// slot N of the cache
interface ScopeState {
  owner: ScopeOwner
  // scope key -> its run that computed this cache's values
  runs: Map<number, ScopeRun>
  // the render that copied it into this cache
  renderId: number
}

const STATE = Symbol('teamplay compiler scopes')
type MemoCache = unknown[]

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

export function createScopeContext (): ScopeContext {
  return {
    notify: undefined,
    seq: 0,
    renderId: 0,
    renderCaches: new Set(),
    runs: new Set(),
    notified: 0,
    renderNotified: 0,
    committedNotified: 0,
    signalRender: false
  }
}

// the observer's reaction (re)created: renders go through its scheduler;
// detached (destroyed): runs only invalidate their scopes
export function attachScopes (context: ScopeContext, notify: (() => void) | undefined): void {
  context.notify = notify
}

// a signal one of the component's reactions read changed
export function notifyScopes (context: ScopeContext): void {
  context.notified = ++context.seq
  context.notify?.()
}

export function startRender (context: ScopeContext): void {
  context.renderId++
  context.renderCaches = new Set()
  context.renderNotified = context.notified
  context.signalRender = context.notified > context.committedNotified
}

// the render committed: its caches are the ones React keeps
export function commitScopes (context: ScopeContext): void {
  const kept = new Set<ScopeRun>()
  for (const memoCache of context.renderCaches) {
    for (const run of getState(memoCache).runs.values()) kept.add(run)
  }
  for (const run of context.runs) {
    if (!kept.has(run)) run.dispose()
  }
  context.committedNotified = context.renderNotified
}

export function destroyScopes (context: ScopeContext): void {
  for (const run of context.runs) run.dispose()
}

export function cache (memoCache: MemoCache): MemoCache {
  const context = executionContextTracker.getScopeContext()
  const slot = memoCache.length - 1
  const state = memoCache[slot] as ScopeState | undefined
  if (!(state as any)?.[STATE]) {
    memoCache[slot] = {
      [STATE]: true,
      owner: { invalidated: new Map(), parents: new Map(), reading: new Set(), pureForcedIn: new Map() },
      runs: new Map(),
      renderId: context ? context.renderId : -1
    }
  }
  context?.renderCaches.add(memoCache)
  return memoCache
}

function getState (memoCache: MemoCache): ScopeState {
  return memoCache[memoCache.length - 1] as ScopeState
}

// `jsx`: the scope creates elements. On a render a signal change caused, it
// recomputes, as every element does without the compiler: a child that is not
// an observer() and reads an object changed in place (same identity) renders again.
// `changed`: one of its extra dependencies changed.
export function dirty (
  memoCache: MemoCache,
  key: number,
  upstream?: readonly number[] | null,
  jsx?: boolean,
  depSlots?: readonly number[],
  pure?: boolean,
  changed?: boolean
): boolean {
  const context = executionContextTracker.getScopeContext()
  if (!context) {
    if (changed) return true
    // an observer() that started before compiled code was loaded: recompute,
    // and the render tracks the reads
    if (executionContextTracker.isActive()) return true
    if (getState(memoCache)?.owner?.reading.has(key)) return true
    return !!depSlots?.some(slot => mayChangeInPlace(memoCache[slot]))
  }
  const state = getState(memoCache)
  const { owner } = state
  let forced = !!changed || (!!jsx && context.signalRender)
  if (!forced && !pure) {
    const run = state.runs.get(key)
    forced = !run || (owner.invalidated.get(key) ?? -1) > run.seq
  }
  if (!forced && upstream) {
    forced = upstream.some(upstreamKey =>
      (state.runs.get(upstreamKey)?.forcedIn ?? owner.pureForcedIn.get(upstreamKey)) === context.renderId
    )
  }
  if (forced) {
    if (pure) owner.pureForcedIn.set(key, context.renderId)
    else context.forced = key
  }
  return forced
}

export function run (memoCache: MemoCache, key: number, body: () => void): void {
  const context = executionContextTracker.getScopeContext()
  if (!context) return runOutsideObserver(memoCache, key, body)
  const slot = memoCache.length - 1
  let state = getState(memoCache)
  // this render's own copy: the cache it was copied from may be the one React keeps
  if (state.renderId !== context.renderId) {
    state = memoCache[slot] = { [STATE]: true, owner: state.owner, runs: new Map(state.runs), renderId: context.renderId } as ScopeState
  }
  const { owner } = state
  const previous = state.runs.get(key)
  const invalidated = !!previous && (owner.invalidated.get(key) ?? -1) > previous.seq
  const forced = context.forced === key || invalidated
  context.forced = undefined
  const parent = context.current?.owner === owner ? context.current.key : undefined
  owner.parents.set(key, parent)
  let disposed = false
  const reaction = observe(() => {
    const current = context.current
    context.current = { owner, key }
    try {
      body()
    } finally {
      context.current = current
    }
  }, {
    lazy: true,
    scheduler: () => {
      if (disposed) return
      const seq = ++context.seq
      for (let marked: number | undefined = key; marked !== undefined; marked = owner.parents.get(marked)) {
        owner.invalidated.set(marked, seq)
      }
      notifyScopes(context)
    }
  })
  const scopeRun: ScopeRun = {
    seq: ++context.seq,
    forcedIn: forced ? context.renderId : -1,
    dispose: () => {
      if (disposed) return
      disposed = true
      unobserve(reaction)
      context.runs.delete(scopeRun)
    }
  }
  state.runs.set(key, scopeRun)
  context.runs.add(scopeRun)
  reaction()
}

// notes whether the body reads signals (see above)
function runOutsideObserver (memoCache: MemoCache, key: number, body: () => void): void {
  const owner = getState(memoCache)?.owner
  if (!owner || executionContextTracker.isActive()) return body()
  const reaction = observe(body, { lazy: true, scheduler: () => {} })
  try {
    reaction()
  } finally {
    // observer-util keeps what a reaction read in `cleaners` (unknown: count it as a read)
    const reads = (reaction as unknown as { cleaners?: unknown[] }).cleaners
    if (!reads || reads.length) owner.reading.add(key)
    else owner.reading.delete(key)
    unobserve(reaction)
  }
}

function mayChangeInPlace (value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null) return false
  // an element (not frozen in production)
  return !('$$typeof' in value)
}

// for a scope that can't run in a function (it returns, or breaks out of its
// block) or that the plugin didn't recognize: inside observer() it recomputes
// on every render (its reads are then tracked by the render itself)
export function inObserver (): boolean {
  return executionContextTracker.isActive()
}

// what the code babel-plugin-teamplay generates calls (exported by 'teamplay'
// as __reactCompiler)
export const compiledCodeRuntime = { enable, cache, dirty, run, inObserver }
