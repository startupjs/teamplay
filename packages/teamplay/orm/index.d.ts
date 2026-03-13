export const BaseModel: any
export default BaseModel

export function belongsTo (AssociatedOrmEntity: any, options?: Record<string, any>): (OrmEntity: any) => any
export function hasMany (AssociatedOrmEntity: any, options?: Record<string, any>): (OrmEntity: any) => any
export function hasOne (AssociatedOrmEntity: any, options?: Record<string, any>): (OrmEntity: any) => any
