export const isAccessControlSymbol = Symbol('is access control object')
export const OPERATIONS = [
  'create',
  'read',
  'update',
  'delete'
]

export function isAccessControl (something) {
  if (something?.[isAccessControlSymbol]) return true
  return false
}

export function accessControl (props) {
  if (typeof props !== 'object') throw Error(ERRORS.mustBeObject(props))
  for (const key in props) {
    if (!OPERATIONS.includes(key)) throw Error(ERRORS.unknownOperation(key))
  }
  props[isAccessControlSymbol] ??= true
  return props
}

const ERRORS = {
  mustBeObject: props => `
    accessControl: must be an object.
    Got: ${JSON.stringify(props)}
  `,
  unknownOperation: (op) => `
    accessControl: unknown operation is specified.
    Got: '${op}'
    Available: ${JSON.stringify(OPERATIONS)}
  `
}
