import JSON_SCHEMA_KEYWORDS from './jsonSchemaKeywords.ts'

export { JSON_SCHEMA_KEYWORDS }

export type JsonSchemaObject = Record<string, unknown>

export function isSchemaObject (value: unknown): value is JsonSchemaObject {
  return Object.prototype.toString.call(value) === '[object Object]'
}

export function isJsonSchemaKeyword (key: string): boolean {
  return (JSON_SCHEMA_KEYWORDS as readonly string[]).includes(key)
}

export function isFullObjectSchema (schema: unknown): schema is JsonSchemaObject & { type: 'object' } {
  return isSchemaObject(schema) && schema.type === 'object'
}

export function getSchemaPropertiesObject (schema: unknown): JsonSchemaObject {
  if (!schema) return {}
  if (isFullObjectSchema(schema)) {
    return isSchemaObject(schema.properties) ? schema.properties : {}
  }
  return isSchemaObject(schema) ? schema : {}
}

export function getSimplifiedSchemaRequiredFields (properties: JsonSchemaObject): string[] {
  return Object.keys(properties).filter(
    key => isSchemaObject(properties[key]) && properties[key].required === true
  )
}
