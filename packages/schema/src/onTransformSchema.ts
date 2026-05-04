export type SchemaTransformHook = (schema: unknown) => unknown

export let onTransformSchema: SchemaTransformHook | undefined

export function setOnTransformSchema (fn: SchemaTransformHook | undefined): void {
  onTransformSchema = fn
}
