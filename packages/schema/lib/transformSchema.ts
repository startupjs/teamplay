import { onTransformSchema } from './onTransformSchema.ts'
import {
  type JsonSchemaObject,
  getSimplifiedSchemaRequiredFields,
  getSchemaPropertiesObject,
  isFullObjectSchema,
  isSchemaObject
} from './schemaIntrospection.ts'

type TransformSchemaOptions = {
  additionalProperties?: boolean
}

// allow schema to be specified in a simplified format - as "properties" themselves
// and also with 'required' being part of each property
export default function transformSchema (
  schema: unknown,
  { additionalProperties = false }: TransformSchemaOptions = {}
): JsonSchemaObject {
  schema = JSON.parse(JSON.stringify(schema))
  // if schema is not an object, assume it's in a simplified format
  if (!isFullObjectSchema(schema)) {
    const properties = getSchemaPropertiesObject(schema)
    schema = {
      type: 'object',
      properties,
      required: getSimplifiedSchemaRequiredFields(properties),
      errorMessage: getErrorMessage(properties),
      additionalProperties
    }
  }
  stripExtraUiKeywords(schema as JsonSchemaObject)
  if (onTransformSchema) schema = onTransformSchema(schema)
  // schema = MODULE.reduceHook('transformSchema', schema)
  return schema as JsonSchemaObject
}

// traverse type 'object' and type 'array' recursively
// and remove extra keywords (like a boolean 'require') from all objects in schema
// WARNING: this is self-mutating
function stripExtraUiKeywords (schema: JsonSchemaObject): void {
  if (schema.type === 'object') {
    const properties = isSchemaObject(schema.properties) ? schema.properties : {}
    for (const key in properties) {
      const property = properties[key]
      if (isSchemaObject(property)) {
        if (typeof property.required === 'boolean') delete property.required
        if (isSchemaObject(property.errorMessage) && property.errorMessage.required) {
          delete property.errorMessage.required
        }
        stripExtraUiKeywords(property)
      }
    }
  } else if (schema.type === 'array') {
    if (isSchemaObject(schema.items)) stripExtraUiKeywords(schema.items)
  }
}

function getErrorMessage (schema: JsonSchemaObject): unknown {
  if (schema.errorMessage && !isSchemaObject(schema.errorMessage)) {
    return schema.errorMessage
  }

  const requiredErrorMessage: Record<string, unknown> = {}

  for (const [key, property] of Object.entries(schema)) {
    if (!isSchemaObject(property)) continue
    if (!isSchemaObject(property.errorMessage)) continue
    if (!property.errorMessage.required) continue
    requiredErrorMessage[key] = property.errorMessage.required
  }

  return Object.assign(
    {},
    schema.errorMessage,
    { required: requiredErrorMessage }
  )
}
