type DestroyAttempt = () => unknown | Promise<unknown>

class RenderAttemptDestroyer {
  fns: DestroyAttempt[]
  renderAttemptCleanupArmed: boolean
  suspenseGateArmed: boolean

  constructor () {
    this.fns = []
    this.renderAttemptCleanupArmed = false
    this.suspenseGateArmed = false
  }

  add (
    fn: DestroyAttempt | undefined,
    { renderAttemptCleanup = false }: { renderAttemptCleanup?: boolean } = {}
  ): void {
    if (typeof fn !== 'function') return
    this.fns.push(fn)
    if (renderAttemptCleanup) this.renderAttemptCleanupArmed = true
  }

  armRenderAttemptCleanup (): void {
    this.renderAttemptCleanupArmed = true
  }

  armSuspenseGate (): void {
    this.suspenseGateArmed = true
  }

  consumeThenableHandling (): {
    shouldKeepShellAlive: boolean
    destroyAttempt?: () => Promise<void>
  } {
    const shouldRunAttemptCleanup = this.renderAttemptCleanupArmed && this.fns.length > 0
    const shouldKeepShellAlive = this.suspenseGateArmed || shouldRunAttemptCleanup
    let destroyAttempt: (() => Promise<void>) | undefined
    if (shouldRunAttemptCleanup) {
      const fns = [...this.fns]
      destroyAttempt = async () => {
        await Promise.allSettled(fns.map(fn => fn()))
        fns.length = 0
      }
    }
    this.reset()
    return {
      shouldKeepShellAlive,
      destroyAttempt
    }
  }

  reset (): void {
    this.fns.length = 0
    this.renderAttemptCleanupArmed = false
    this.suspenseGateArmed = false
  }
}

export default new RenderAttemptDestroyer()
