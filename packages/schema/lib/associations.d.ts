export interface AssociationSchema {
  /** JSON Schema type produced by the association helper. */
  readonly type: string
  /** TeamPlay association metadata used by schema transforms. */
  readonly $association: {
    /** Association kind, such as `belongsTo`, `hasOne`, `hasMany`, or `hasManyFlags`. */
    readonly type: string
    /** Target collection name. */
    readonly collection: string
  }
}

export interface StringAssociationSchema extends AssociationSchema {
  /** Stored value is a document id string. */
  readonly type: 'string'
  /** GUID pattern used to validate the related document id. */
  readonly pattern: string
}

export interface HasManyAssociationSchema extends AssociationSchema {
  /** Stored value is an array of document id strings. */
  readonly type: 'array'
  /** Schema for each related document id. */
  readonly items: {
    readonly type: 'string'
    readonly pattern: string
  }
}

export interface HasManyFlagsAssociationSchema extends AssociationSchema {
  /** Stored value is an object keyed by related document id. */
  readonly type: 'object'
  /** Pattern properties that validate related document id keys. */
  readonly patternProperties: Record<string, { readonly type: 'boolean' }>
  /** Only GUID-pattern keys are allowed. */
  readonly additionalProperties: false
}

/**
 * Define a string foreign key pointing to one document in another collection.
 * @param collectionName Target collection name.
 */
export function belongsTo (collectionName: string): StringAssociationSchema
/**
 * Define an array of string foreign keys pointing to documents in another collection.
 * @param collectionName Target collection name.
 */
export function hasMany (collectionName: string): HasManyAssociationSchema
/**
 * Define a flags object whose keys are ids from another collection and whose values are booleans.
 * @param collectionName Target collection name.
 */
export function hasManyFlags (collectionName: string): HasManyFlagsAssociationSchema
/**
 * Define a string foreign key pointing to one owned document in another collection.
 * @param collectionName Target collection name.
 */
export function hasOne (collectionName: string): StringAssociationSchema
