class RenderAttemptDestroyer {
  constructor () {
    this.fns = []
    this.compatArmed = false
  }

  add (fn, { compat = false } = {}) {
    if (typeof fn !== 'function') return
    this.fns.push(fn)
    if (compat) this.compatArmed = true
  }

  armCompat () {
    this.compatArmed = true
  }

  getDestructor () {
    if (!this.compatArmed) {
      this.reset()
      return undefined
    }

    const fns = [...this.fns]
    this.reset()
    return async () => {
      if (fns.length === 0) return
      await Promise.allSettled(fns.map(fn => fn()))
      fns.length = 0
    }
  }

  reset () {
    this.fns.length = 0
    this.compatArmed = false
  }
}

export default new RenderAttemptDestroyer()
