const definedObjectSchemas = new WeakSet<object>()
const definedPrimitiveSchemas = new Set<unknown>()

function isObjectLike (value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function'
}

export function defineSchema<const TSchema> (schema: TSchema): TSchema {
  if (isObjectLike(schema)) {
    definedObjectSchemas.add(schema)
  } else {
    definedPrimitiveSchemas.add(schema)
  }
  return schema
}

export function isDefinedSchema (schema: unknown): boolean {
  if (isObjectLike(schema)) return definedObjectSchemas.has(schema)
  return definedPrimitiveSchemas.has(schema)
}
