// trap render function (functional component) to block observer updates and activate cache
// during synchronous rendering
import executionContextTracker from './executionContextTracker.js'

export default function trapRender ({ render, cache, destroy, componentId }) {
  return (...args) => {
    executionContextTracker._start(componentId)
    cache.activate()
    let destroyed
    try {
      // destroyer.reset() // TODO: this one is for any destructuring logic which might be needed
      // promiseBatcher.reset() // TODO: this is to support useBatch* hooks
      const res = render(...args)
      // if (promiseBatcher.isActive()) {
      //   throw Error('[react-sharedb] useBatch* hooks were used without a closing useBatch() call.')
      // }
      return res
    } catch (err) {
      // TODO: this might only be needed only if promise is thrown
      //       (check if useUnmount in convertToObserver is called if a regular error is thrown)
      destroy('trapRender.js')
      destroyed = true

      if (!err.then) throw err
      // If the Promise was thrown, we catch it before Suspense does.
      // And we run destructors for each hook previous to the one
      // which did throw this Promise.
      // We have to manually do it since the unmount logic is not working
      // for components which were terminated by Suspense as a result of
      // a promise being thrown.
      // const destroy = destroyer.getDestructor()
      // throw err.then(destroy)
      throw err
    } finally {
      if (!destroyed) cache.deactivate()
      executionContextTracker._clear()
    }
  }
}
