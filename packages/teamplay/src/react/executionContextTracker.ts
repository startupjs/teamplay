import type { ScopeRun } from './compilerScopes.ts'

// React Compiler support: what the compiled memo scopes of an observer()
// render need (see compilerScopes.ts)
export interface ScopeContext {
  // re-renders the observer component (through its batched scheduler);
  // undefined while the observer's reaction is destroyed
  notify: (() => void) | undefined
  // increments on every scope run and every signal change
  seq: number
  // increments on every render (every call of the component's function)
  renderId: number
  // the compiler caches of the render in progress (or the last one)
  renderCaches: Set<unknown[]>
  // the live runs of the component's scopes
  runs: Set<ScopeRun>
  // the scope whose body runs now
  current?: { owner: unknown, key: number }
  // the scope key dirty() just decided to recompute
  forced?: number
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
