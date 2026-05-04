import { Ajv } from 'ajv/dist/ajv.js'
import type { Plugin } from 'ajv/dist/core.js'
import * as ajvErrorsModule from 'ajv-errors/dist/index.js'

const ajvErrors = (ajvErrorsModule.default || ajvErrorsModule) as unknown as Plugin<any>

const ajv = new Ajv({
  allErrors: true,
  strict: false
})

ajvErrors(ajv)

export default ajv
