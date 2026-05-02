/// <reference path="./pluralize.d.ts" />
import pluralize from 'pluralize'

export interface AssociationOptions extends Readonly<Record<string, unknown>> {
  readonly key?: string
}

export interface AssociationModelConstructor {
  readonly collection?: string
  addAssociation: (association: AssociationRecord) => void
}

export interface AssociationRecord<
  TAssociatedModel extends AssociationModelConstructor = AssociationModelConstructor
> extends Record<string, unknown> {
  readonly type: string
  readonly orm: TAssociatedModel
  readonly key: string
  readonly opposite?: true
}

type AssociationDefaults<
  TAssociatedModel extends AssociationModelConstructor
> = AssociationRecord<TAssociatedModel>

type AssociationDecorator = <TModel extends AssociationModelConstructor>(OrmEntity: TModel) => TModel

function getCollectionName (
  OrmEntity: AssociationModelConstructor,
  options: AssociationOptions = {},
  helperName = 'association'
): string | undefined {
  if (options.key) return undefined
  const collection = OrmEntity?.collection
  if (typeof collection === 'string' && collection) return collection
  throw new Error(
    `teamplay/${helperName}: Associated model must define static "collection" ` +
    'or pass options.key explicitly'
  )
}

function toSingular (name: string | undefined): string | undefined {
  if (typeof name !== 'string' || !name) return name
  return pluralize.singular(name)
}

function withOptions<
  TAssociatedModel extends AssociationModelConstructor
> (
  defaults: AssociationDefaults<TAssociatedModel>,
  options: AssociationOptions
): AssociationRecord<TAssociatedModel> {
  return Object.assign({}, defaults, options)
}

export function belongsTo<
  TAssociatedModel extends AssociationModelConstructor
> (
  AssociatedOrmEntity: TAssociatedModel,
  options: AssociationOptions = {}
): AssociationDecorator {
  return function decorateBelongsTo<TModel extends AssociationModelConstructor> (OrmEntity: TModel): TModel {
    const key = options.key || (toSingular(
      getCollectionName(AssociatedOrmEntity, options, 'belongsTo')
    ) + 'Id')

    OrmEntity.addAssociation(
      withOptions({
        type: 'belongsTo',
        orm: AssociatedOrmEntity,
        key
      }, options)
    )

    AssociatedOrmEntity.addAssociation(
      withOptions({
        type: 'oppositeBelongsTo',
        orm: OrmEntity,
        key,
        opposite: true
      }, options)
    )

    return OrmEntity
  }
}

export function hasMany<
  TAssociatedModel extends AssociationModelConstructor
> (
  AssociatedOrmEntity: TAssociatedModel,
  options: AssociationOptions = {}
): AssociationDecorator {
  return function decorateHasMany<TModel extends AssociationModelConstructor> (OrmEntity: TModel): TModel {
    const key = options.key || (toSingular(
      getCollectionName(AssociatedOrmEntity, options, 'hasMany')
    ) + 'Ids')

    OrmEntity.addAssociation(
      withOptions({
        type: 'hasMany',
        orm: AssociatedOrmEntity,
        key
      }, options)
    )

    AssociatedOrmEntity.addAssociation(
      withOptions({
        type: 'oppositeHasMany',
        orm: OrmEntity,
        key,
        opposite: true
      }, options)
    )

    return OrmEntity
  }
}

export function hasOne<
  TAssociatedModel extends AssociationModelConstructor
> (
  AssociatedOrmEntity: TAssociatedModel,
  options: AssociationOptions = {}
): AssociationDecorator {
  return function decorateHasOne<TModel extends AssociationModelConstructor> (OrmEntity: TModel): TModel {
    const key = options.key || (toSingular(
      getCollectionName(AssociatedOrmEntity, options, 'hasOne')
    ) + 'Id')

    OrmEntity.addAssociation(
      withOptions({
        type: 'hasOne',
        orm: AssociatedOrmEntity,
        key
      }, options)
    )

    AssociatedOrmEntity.addAssociation(
      withOptions({
        type: 'oppositeHasOne',
        orm: OrmEntity,
        key,
        opposite: true
      }, options)
    )

    return OrmEntity
  }
}
