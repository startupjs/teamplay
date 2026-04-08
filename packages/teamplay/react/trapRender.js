// trap render function (functional component) to block observer updates and activate cache
// during synchronous rendering
import executionContextTracker from './executionContextTracker.js'
import * as promiseBatcher from './promiseBatcher.js'
import renderAttemptDestroyer from './renderAttemptDestroyer.js'
import { isCompatComponent } from './compatComponentRegistry.js'

export default function trapRender ({ render, cache, destroy, componentId }) {
  return (...args) => {
    executionContextTracker._start(componentId)
    cache.activate()
    let destroyed
    try {
      renderAttemptDestroyer.reset()
      promiseBatcher.reset()
      const res = render(...args)
      if (isDevMode() && promiseBatcher.isActive()) {
        throw Error('[teamplay] useBatch* hooks were used without a closing useBatch() call.')
      }
      return res
    } catch (err) {
      promiseBatcher.reset()
      if (!err.then) {
        destroy('trapRender.js')
        destroyed = true
        throw err
      }
      const destroyAttempt = renderAttemptDestroyer.getDestructor()
      if (destroyAttempt || isCompatComponent(componentId)) {
        throw Promise.resolve(err).then(() => destroyAttempt?.())
      }

      // TODO: this might only be needed only if promise is thrown
      //       (check if useUnmount in convertToObserver is called if a regular error is thrown)
      destroy('trapRender.js')
      destroyed = true
      throw err
    } finally {
      if (!destroyed) cache.deactivate()
      executionContextTracker._clear()
    }
  }
}

function isDevMode () {
  if (typeof process === 'undefined' || !process?.env) return true
  return process.env.NODE_ENV !== 'production'
}
