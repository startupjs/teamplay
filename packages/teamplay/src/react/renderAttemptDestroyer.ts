class RenderAttemptDestroyer {
  suspenseGateArmed: boolean

  constructor () {
    this.suspenseGateArmed = false
  }

  armSuspenseGate (): void {
    this.suspenseGateArmed = true
  }

  consumeThenableHandling (): {
    shouldKeepShellAlive: boolean
  } {
    const shouldKeepShellAlive = this.suspenseGateArmed
    this.reset()
    return {
      shouldKeepShellAlive
    }
  }

  reset (): void {
    this.suspenseGateArmed = false
  }
}

export default new RenderAttemptDestroyer()
