class RenderAttemptDestroyer {
  constructor () {
    this.fns = []
    this.compatAttemptCleanupArmed = false
    this.suspenseGateArmed = false
  }

  add (fn, { compat = false } = {}) {
    if (typeof fn !== 'function') return
    this.fns.push(fn)
    if (compat) this.compatAttemptCleanupArmed = true
  }

  armCompatAttemptCleanup () {
    this.compatAttemptCleanupArmed = true
  }

  armSuspenseGate () {
    this.suspenseGateArmed = true
  }

  consumeThenableHandling () {
    const shouldRunAttemptCleanup = this.compatAttemptCleanupArmed && this.fns.length > 0
    const shouldKeepShellAlive = this.suspenseGateArmed || shouldRunAttemptCleanup
    let destroyAttempt
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

  reset () {
    this.fns.length = 0
    this.compatAttemptCleanupArmed = false
    this.suspenseGateArmed = false
  }
}

export default new RenderAttemptDestroyer()
