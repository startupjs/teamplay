class ExecutionContextTracker {
  #contextId: string | undefined
  #hooksCounter = -1

  isActive (): boolean {
    return this.#contextId !== undefined
  }

  getComponentId (): string | undefined {
    return this.#contextId
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

  _start (contextId: string): void {
    this.#contextId = contextId
    this.#hooksCounter = -1
  }

  _clear (): void {
    this.#contextId = undefined
  }
}

export default new ExecutionContextTracker()
