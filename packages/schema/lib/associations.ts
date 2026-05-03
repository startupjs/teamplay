import GUID_PATTERN from './GUID_PATTERN.ts'

export interface AssociationSchema {
  readonly type: string
  readonly $association: {
    readonly type: string
    readonly collection: string
  }
}

export interface StringAssociationSchema extends AssociationSchema {
  readonly type: 'string'
  readonly pattern: string
}

export interface HasManyAssociationSchema extends AssociationSchema {
  readonly type: 'array'
  readonly items: {
    readonly type: 'string'
    readonly pattern: string
  }
}

export interface HasManyFlagsAssociationSchema extends AssociationSchema {
  readonly type: 'object'
  readonly patternProperties: Record<string, { readonly type: 'boolean' }>
  readonly additionalProperties: false
}

export function belongsTo (collectionName: string): StringAssociationSchema {
  return {
    type: 'string',
    pattern: GUID_PATTERN,
    $association: {
      type: 'belongsTo',
      collection: collectionName
    }
  }
}

export function hasMany (collectionName: string): HasManyAssociationSchema {
  return {
    type: 'array',
    items: {
      type: 'string',
      pattern: GUID_PATTERN
    },
    $association: {
      type: 'hasMany',
      collection: collectionName
    }
  }
}

export function hasManyFlags (collectionName: string): HasManyFlagsAssociationSchema {
  return {
    type: 'object',
    patternProperties: {
      [GUID_PATTERN]: { type: 'boolean' }
    },
    additionalProperties: false,
    $association: {
      type: 'hasManyFlags',
      collection: collectionName
    }
  }
}

export function hasOne (collectionName: string): StringAssociationSchema {
  return {
    type: 'string',
    pattern: GUID_PATTERN,
    $association: {
      type: 'hasOne',
      collection: collectionName
    }
  }
}
