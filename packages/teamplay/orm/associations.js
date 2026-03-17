import pluralize from 'pluralize'

function getCollectionName (OrmEntity, options = {}, helperName = 'association') {
  if (options.key) return undefined
  const collection = OrmEntity?.collection
  if (typeof collection === 'string' && collection) return collection
  throw new Error(
    `teamplay/${helperName}: Associated model must define static "collection" ` +
    'or pass options.key explicitly'
  )
}

function toSingular (name) {
  if (typeof name !== 'string' || !name) return name
  return pluralize.singular(name)
}

export function belongsTo (AssociatedOrmEntity, options = {}) {
  return function decorateBelongsTo (OrmEntity) {
    const key = options.key || (toSingular(
      getCollectionName(AssociatedOrmEntity, options, 'belongsTo')
    ) + 'Id')

    OrmEntity.addAssociation(
      Object.assign({
        type: 'belongsTo',
        orm: AssociatedOrmEntity,
        key
      }, options)
    )

    AssociatedOrmEntity.addAssociation(
      Object.assign({
        type: 'oppositeBelongsTo',
        orm: OrmEntity,
        key,
        opposite: true
      }, options)
    )

    return OrmEntity
  }
}

export function hasMany (AssociatedOrmEntity, options = {}) {
  return function decorateHasMany (OrmEntity) {
    const key = options.key || (toSingular(
      getCollectionName(AssociatedOrmEntity, options, 'hasMany')
    ) + 'Ids')

    OrmEntity.addAssociation(
      Object.assign({
        type: 'hasMany',
        orm: AssociatedOrmEntity,
        key
      }, options)
    )

    AssociatedOrmEntity.addAssociation(
      Object.assign({
        type: 'oppositeHasMany',
        orm: OrmEntity,
        key,
        opposite: true
      }, options)
    )

    return OrmEntity
  }
}

export function hasOne (AssociatedOrmEntity, options = {}) {
  return function decorateHasOne (OrmEntity) {
    const key = options.key || (toSingular(
      getCollectionName(AssociatedOrmEntity, options, 'hasOne')
    ) + 'Id')

    OrmEntity.addAssociation(
      Object.assign({
        type: 'hasOne',
        orm: AssociatedOrmEntity,
        key
      }, options)
    )

    AssociatedOrmEntity.addAssociation(
      Object.assign({
        type: 'oppositeHasOne',
        orm: OrmEntity,
        key,
        opposite: true
      }, options)
    )

    return OrmEntity
  }
}
