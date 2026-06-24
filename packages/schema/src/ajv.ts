import AjvModule from 'ajv'
import type { Ajv as AjvInstance, Options } from 'ajv'
import ajvErrorsModule from 'ajv-errors'

type AjvConstructor = new (opts?: Options) => AjvInstance
type AjvErrorsPlugin = (ajv: AjvInstance) => AjvInstance

const Ajv = AjvModule as unknown as AjvConstructor
const ajvErrors = ajvErrorsModule as unknown as AjvErrorsPlugin

const ajv = new Ajv({
  allErrors: true,
  strict: false
})

ajvErrors(ajv)

export default ajv
