import _isPlainObject from 'lodash/isPlainObject.js'
import JSON_SCHEMA_KEYWORDS from './jsonSchemaKeywords.cjs'

export { JSON_SCHEMA_KEYWORDS }

export function isJsonSchemaKeyword (key) {
  return JSON_SCHEMA_KEYWORDS.includes(key)
}

export function isFullObjectSchema (schema) {
  return _isPlainObject(schema) && schema.type === 'object'
}

export function getSchemaPropertiesObject (schema) {
  if (!schema) return {}
  return isFullObjectSchema(schema) ? schema.properties || {} : schema
}

export function getSimplifiedSchemaRequiredFields (properties) {
  return Object.keys(properties).filter(
    key => properties[key] && properties[key].required === true
  )
}
