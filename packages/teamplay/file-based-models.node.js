import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const models = require('babel-plugin-teamplay/file-based-models')

export default models
