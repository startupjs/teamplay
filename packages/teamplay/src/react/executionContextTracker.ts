import type { ScopeRun } from './compilerScopes.ts'

// React Compiler support: what the compiled memo scopes of an observer()
// render need (see compilerScopes.ts)
export interface ScopeContext {
  // re-renders the observer component (through its batched scheduler)
  notify: () => void
  // run when the observer's reaction is destroyed (unmount, discarded render)
  cleanups: Set<() => void>
  // the compiler caches created so far in this render
  cacheCount: number
  // increments on every scope run and every signal change
  seq: number
  // the scope runs of the last committed render, and of the render in progress
  // (or the last one, if it did not commit), by scope id
  committed: Map<string, ScopeRun>
  pending: Map<string, ScopeRun>
  // scope id -> seq when a signal it (or a scope inside it) read changed
  invalidated: Map<string, number>
  // scope id -> the scope its body runs in
  parents: Map<string, string | undefined>
  // the scope whose body runs now
  currentScope?: string
  // the scope dirty() just decided to recompute although its deps did not change
  forced?: string
  // seq of the last signal change; as of the render in progress; as of the last committed render
  notified: number
  renderNotified: number
  committedNotified: number
  // a signal change since the last committed render caused this render
  signalRender: boolean
}

class ExecutionContextTracker {
  #contextId: string | undefined
  #hooksCounter = -1
  #scopeContext: ScopeContext | undefined

  isActive (): boolean {
    return this.#contextId !== undefined
  }

  getComponentId (): string | undefined {
    return this.#contextId
  }

  getScopeContext (): ScopeContext | undefined {
    return this.#scopeContext
  }

  newHookId (): string {
    this.incrementHooksCounter()
    const id = `_${this.#contextId}_${this.#hooksCounter}`
    return id
  }

  incrementHooksCounter (): void {
    if (!this.#contextId) return
    this.#hooksCounter++
  }

  _start (contextId: string, scopeContext?: ScopeContext): void {
    this.#contextId = contextId
    this.#hooksCounter = -1
    this.#scopeContext = scopeContext
  }

  _clear (): void {
    this.#contextId = undefined
    this.#scopeContext = undefined
  }
}

export default new ExecutionContextTracker()
