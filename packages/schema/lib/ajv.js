import Ajv from 'ajv'
import ajvErrors from 'ajv-errors'

const ajv = new Ajv({
  allErrors: true,
  strict: false
})

ajvErrors(ajv)

export default ajv
