import createConnectWithPersistence from './index.js'

export default createConnectWithPersistence(initPersistence)

async function initPersistence (db) {
  throw new Error('Not implemented')
}
