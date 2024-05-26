import { getSignal } from './src/signal.js'
export { getSignal as signal }
export { sub$ } from './src/sub.js'
export const $ = getSignal()
export default $
