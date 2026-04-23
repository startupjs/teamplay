export const ajv: any
export function transformSchema (schema: any, options?: Record<string, any>): any
export function onTransformSchema (schema: any): any
export function setOnTransformSchema (fn?: (schema: any) => any): void
export function hasMany (AssociatedOrmEntity: any, options?: Record<string, any>): (OrmEntity: any) => any
export function hasOne (AssociatedOrmEntity: any, options?: Record<string, any>): (OrmEntity: any) => any
export function hasManyFlags (AssociatedOrmEntity: any, options?: Record<string, any>): (OrmEntity: any) => any
export function belongsTo (AssociatedOrmEntity: any, options?: Record<string, any>): (OrmEntity: any) => any
export const GUID_PATTERN: string
export function pickFormFields (schema: any, fields: string[]): any
