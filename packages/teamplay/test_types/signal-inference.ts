import {
  $,
  Signal,
  addModel,
  accessControl,
  __aggregationHeader,
  aggregation,
  defineModels,
  defineSchema,
  sub,
  useSub,
  type AccessCreateContext as ExportedAccessCreateContext,
  type CollectionsFromManifest,
  type FromJsonSchema,
  type JsonSchemaSpec,
  type CollectionQuerySignal,
  type DefaultAggregationSession,
  type JoinPath,
  type PathModelsFromManifest,
  type QuerySignal,
  type TypedAggregationInput,
  type TypedSignal,
  type ZodSchemaSpec
} from 'teamplay'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? true
    : false

type Expect<T extends true> = T
type Extends<A, B> = A extends B ? true : false
type AwaitedSub<T> = T extends Promise<infer Value> ? Value : T
type PromiseValue<T> = T extends Promise<infer Value> ? Value : never
type HasFindOpenGames<T> = T extends { findOpenGames: (...args: unknown[]) => unknown } ? true : false
type PathPatternJoin = Expect<Equal<JoinPath<readonly ['games', '*', 'players', number]>, 'games.*.players.*'>>

// Public Signal<T> is intentionally a registry-based facade. When T maps to
// exactly one generated collection document type it exposes that model; when
// multiple collections share the same document type it falls back to plain
// signal fields to avoid guessing the wrong model.
type TypeAssertions = [
  GameSchemaInference,
  PathPatternJoin,
  TitleValue,
  MaxPlayersValue,
  StatusValue,
  RootDollarCollectionAlias,
  DocDollarDestructureTitle,
  DocDollarDestructureStatus,
  DocDollarDestructureNestedModel,
  NestedDollarDestructureTagModel,
  SubKeepsDocumentModel,
  UseSubKeepsDocumentModel,
  ZodStructuralInference,
  NestedPathModelMethod,
  NestedArrayPathModelMethod,
  ModelThisNestedString,
  ModelThisNestedPathMethod,
  QueryNestedPathModelMethod,
  AggregationNestedPathModelMethod,
  QuerySignalType,
  QueryIndexDocumentModel,
  QueryIteratorDocumentModel,
  HookQueryIndexDocumentModel,
  AggregationIndexDocumentModel,
  AggregationDocumentMethods,
  HookAggregationIndexDocumentModel,
  ExplicitAggregationIndexDocumentModel,
  ExplicitAggregationDocumentMethods,
  HeaderAggregationIndexDocumentModel,
  AggregationSecondGenericSession,
  AggregationThirdGenericSession,
  HeaderAggregationSecondGenericSession,
  ClientAggregationSecondGenericSession,
  DefaultAggregationSessionUserId,
  AggregationStatsTotal,
  AggregationStatsUnread,
  ExplicitAggregationRowsField,
  LocalPrimitive,
  LocalExplicitBoolean,
  LocalExplicitBooleanSignal,
  LocalExplicitEventTitle,
  LocalSignalAliasBoolean,
  LocalSignalAliasEventTitle,
  SignalAliasDocumentModelMethod,
  SignalAliasArrayMapDocumentModel,
  SignalAliasArrayIteratorDocumentModel,
  SignalAliasArrayCollectionModelMethod,
  SignalAliasArrayCollectionAdd,
  QueryResultAcceptedAsSignalArray,
  QueryCollectionModelMethod,
  QueryCollectionAdd,
  QueryIdsSignal,
  QueryExtraSignal,
  CollectionQueryIdsSignal,
  CollectionQueryExtraSignal,
  QueryArrayMutatorBlocked,
  AggregationArrayMutatorBlocked,
  HookQueryCollectionModelMethod,
  CollectionSignalArrayMapDocumentModel,
  SignalAliasNestedPathModelMethod,
  LocalNestedString,
  LocalNestedBoolean,
  LocalArrayMapItem,
  LocalArrayMapThisArg,
  LocalArrayReduceNoInitial,
  LocalArrayIteratorItem,
  LocalArrayFindItem,
  LocalArrayFindThisArg,
  QueryArrayReduceNoInitial,
  CollectionAddReturnsId,
  CollectionMethodChainAddReturnsId,
  DocSetReturnsVoidPromise,
  DocAssignReturnsVoidPromise,
  NestedAssignReturnsVoidPromise,
  NestedPopReturnsItem,
  NestedShiftReturnsItem,
  NestedArrayPushParameter,
  NestedArrayPopReturn,
  CollectionArrayMutatorBlocked,
  NestedArrayMapLabels,
  NestedArrayReduceItem,
  QueryLoopTitle,
  QueryLoopDollarDestructureTitle,
  QueryLoopPoppedTag,
  QueryLoopAssignResult,
  QueryLoopTagLabels,
  QueryLoopMaxPlayersTotal,
  QueryLoopFoundTitle,
  AggregationLoopTitle,
  AggregationLoopDollarDestructureTitle,
  AggregationLoopPoppedTag,
  AggregationLoopTagLabels,
  HookQueryMapTitle,
  HookAggregationReduceTitle,
  LocalComplexPopPlayer,
  LocalDollarPrimitive,
  LocalDollarString,
  LocalComplexShiftPlayer,
  LocalComplexInventoryPop,
  LocalComplexMappedInventory,
  LocalComplexFoundInventory,
  ComputedNestedPlayerName,
  ComputedDollarDestructure,
  BatchKeepsCallbackReturn,
  SignalMetadataMethods,
  ComputedNumber,
  ComputedString,
  NullableSchemaInference,
  NullableObjectSchemaInference,
  SimplifiedKeywordFieldSchemaInference,
  TupleSchemaInference,
  DefinedSchemaInference,
  AmbiguousDocumentFallbackField,
  AmbiguousArrayFallbackItem,
  TypedAggregationOutputField,
  TypedAggregationOutputMethod,
  AccessCreateDoc,
  AccessCreateSession,
  AccessReadDoc,
  AccessUpdateOps,
  AccessDeleteDoc,
  ExportedAccessContextDoc,
  AccessDefaultSessionUserId,
  DefinedManifestCollection,
  DefinedManifestDocPathModel,
  DefinedManifestNestedPathModel
]

const gameSchema = {
  info: {
    type: 'object',
    required: true,
    properties: {
      title: { type: 'string', required: true },
      maxPlayers: { type: 'integer', required: true },
      tags: {
        type: 'array',
        items: { type: 'string' }
      }
    }
  },
  status: {
    type: 'string',
    enum: ['draft', 'started'] as const
  }
} as const

const nullableSchema = {
  type: ['string', 'null']
} as const

const nullableObjectSchema = {
  type: ['object', 'null'],
  required: ['name'],
  properties: {
    name: { type: 'string' },
    score: { type: ['integer', 'null'] }
  }
} as const

const simplifiedKeywordFieldSchema = {
  title: { type: 'string', required: true },
  description: { type: 'string' },
  type: { type: 'string' },
  required: { type: 'boolean' },
  enum: { type: 'string' },
  const: { type: 'number' },
  properties: {
    type: 'object',
    properties: {
      color: { type: 'string', required: true }
    }
  },
  name: { type: 'string' }
} as const

const tupleSchema = {
  type: 'array',
  items: [
    { type: 'string' },
    { type: 'integer' },
    { type: 'boolean' }
  ]
} as const

const definedSchema = defineSchema({
  status: {
    type: 'string',
    enum: ['draft', 'published']
  },
  score: { type: 'integer', required: true }
})

interface Game {
  info: {
    title: string
    maxPlayers: number
    tags?: string[]
  }
  status?: 'draft' | 'started'
}

class GamesModel extends Signal<Game[]> {
  findOpenGames () {
    return this
  }
}

class GameModel extends Signal<Game> {
  titleFromThis () {
    return this.info.title.get()
  }

  async start () {
    await this.set({
      info: {
        title: 'Untitled',
        maxPlayers: 4
      },
      status: 'started'
    })
  }
}

class GameInfoModel extends Signal<Game['info']> {
  titleCase () {
    return this.title.get().toUpperCase()
  }
}

class GameTagModel extends Signal<string> {
  label () {
    return `#${this.get()}`
  }
}

addModel('games', GamesModel)
addModel('games.*', GameModel)
addModel('games.*.info', GameInfoModel)
addModel('games.*.info.tags.*', GameTagModel)
// @ts-expect-error registered model patterns require the matching model class
addModel('games.*.info', GameTagModel)

interface ZodLikeGame {
  _output?: {
    info: {
      title: string
      maxPlayers: number
    }
  }
}

interface SharedDocShape {
  name: string
}

const ambiguousSharedSchema = {
  name: { type: 'string', required: true }
} as const

class SharedDocsAModel extends Signal<SharedDocShape[]> {
  onlyOnSharedA () {
    return this
  }
}

class SharedDocAModel extends Signal<SharedDocShape> {
  onlyOnSharedDocA () {
    return this.name.get()
  }
}

class SharedDocsBModel extends Signal<SharedDocShape[]> {
  onlyOnSharedB () {
    return this
  }
}

class SharedDocBModel extends Signal<SharedDocShape> {
  onlyOnSharedDocB () {
    return this.name.get()
  }
}

interface RoleCount {
  role: string
  count: number
}

class RoleCountModel extends Signal<RoleCount> {
  label () {
    return `${this.role.get()}: ${this.count.get()}`
  }
}

const definedModels = defineModels({
  games: {
    default: GamesModel,
    schema: gameSchema
  },
  'games.*': {
    default: GameModel
  },
  'games.*.info': {
    default: GameInfoModel
  }
})

type DefinedManifestCollections = CollectionsFromManifest<typeof definedModels>
type DefinedManifestPathModels = PathModelsFromManifest<typeof definedModels>
type DefinedManifestCollection = Expect<Equal<
  DefinedManifestCollections['games'],
  JsonSchemaSpec<typeof gameSchema, typeof GamesModel, typeof GameModel>
>>
type DefinedManifestDocPathModel = Expect<Equal<DefinedManifestPathModels['games.*'], typeof GameModel>>
type DefinedManifestNestedPathModel = Expect<Equal<DefinedManifestPathModels['games.*.info'], typeof GameInfoModel>>

declare module 'teamplay' {
  interface TeamplayCollections {
    games: JsonSchemaSpec<typeof gameSchema, typeof GamesModel, typeof GameModel>
    zodGames: ZodSchemaSpec<ZodLikeGame, typeof GamesModel, typeof GameModel>
    sharedAs: JsonSchemaSpec<typeof ambiguousSharedSchema, typeof SharedDocsAModel, typeof SharedDocAModel>
    sharedBs: JsonSchemaSpec<typeof ambiguousSharedSchema, typeof SharedDocsBModel, typeof SharedDocBModel>
  }

  interface TeamplayModels {
    'games.*.info': typeof GameInfoModel
    'games.*.info.tags.*': typeof GameTagModel
  }
}

declare const gameId: string

const $games = $.games
const { $games: $gamesFromRootDestructure } = $
$games.findOpenGames()
$gamesFromRootDestructure.findOpenGames()
const rootAliasAddId = $gamesFromRootDestructure.add({
  info: {
    title: 'Root Alias Game',
    maxPlayers: 4
  }
})
const collectionAddId = $games.add({
  info: {
    title: 'Chess',
    maxPlayers: 2
  },
  status: 'draft'
})
const collectionMethodChainAddId = $games.findOpenGames().add({
  info: {
    title: 'Go',
    maxPlayers: 2
  }
})
// @ts-expect-error top-level collection signals use add(), not array mutators
$games.push({
  info: {
    title: 'Mutator Chess',
    maxPlayers: 2
  }
})
// @ts-expect-error collection add should require schema-compatible documents
$games.add({ status: 'draft' })

const $game = $.games[gameId]
const { $info: $destructuredInfo, $status: $destructuredStatus } = $game
const {
  $title: $destructuredTitle,
  $maxPlayers: $destructuredMaxPlayers,
  $tags: $destructuredTags
} = $destructuredInfo
const $subGame = sub($game)
function useHookGame () {
  return useSub($game)
}
const $zodGame = $.zodGames[gameId]
$game.start()
$game.info.title.set('Chess')
$game.info.maxPlayers.increment()
$game.info.tags[0].set('board')
$game.info.titleCase()
$game.info.tags[0].label()
$destructuredTitle.set('Destructured Chess')
$destructuredMaxPlayers.increment()
$destructuredInfo.titleCase()
$destructuredTags[0].label()
const docSetResult = $game.set({
  info: {
    title: 'Checkers',
    maxPlayers: 2
  },
  status: 'draft'
})
const docAssignResult = $game.assign({ status: 'started' })
const nestedAssignResult = $game.info.assign({ maxPlayers: 4 })
const poppedTag = $game.info.tags.pop()
const shiftedTag = $game.info.tags.shift()
$game.info.tags.push('classic')
$game.info.tags.unshift('strategy')
$game.info.tags.insert(0, ['board', 'turn-based'])
$game.info.tags.remove(0)
$game.info.tags.move(0, 1)
$game.info.title.stringInsert(0, 'The ')
$game.info.title.stringRemove(0, 4)
const nestedTagLabels = $game.info.tags.map($tag => $tag.get())
const nestedReducedTag = $game.info.tags.reduce(($firstTag, $secondTag) => $firstTag)
const batchTitle = $game.batch(() => $game.info.title.get())
const signalPath = $game.info.title.path()
const signalLeaf = $game.info.title.leaf()
const signalPrimitivePath = $game.info.title[Symbol.toPrimitive]('string')
const signalToStringValue = $game.info.title.toString()
const signalToStringTag = $game.info.title[Symbol.toStringTag]
const signalId = $game.getId()
const signalCollection = $game.getCollection()
const signalAssociations = $game.getAssociations()
// @ts-expect-error unknown schema fields should not be suggested or accepted
void $game.info.typo
// @ts-expect-error setter values should follow schema inference
$game.info.maxPlayers.set('two')
// @ts-expect-error assign should reject fields which are not in the schema
$game.assign({ typo: true })
// @ts-expect-error assign should reject invalid nested field values
$game.info.assign({ maxPlayers: 'many' })
// @ts-expect-error array mutators should use the array item type
$game.info.tags.push(123)
// @ts-expect-error insert should use the array item type for individual values and arrays
$game.info.tags.insert(0, [123])

type GameSchemaInference = Expect<Equal<FromJsonSchema<typeof gameSchema>, Game>>
type TitleValue = Expect<Equal<ReturnType<typeof $game.info.title.get>, string>>
type MaxPlayersValue = Expect<Equal<ReturnType<typeof $game.info.maxPlayers.get>, number>>
type StatusValue = Expect<Equal<ReturnType<typeof $game.status.get>, 'draft' | 'started' | undefined>>
type RootDollarCollectionAlias = Expect<Equal<typeof rootAliasAddId, Promise<string>>>
type DocDollarDestructureTitle = Expect<Equal<ReturnType<typeof $destructuredTitle.get>, string>>
type DocDollarDestructureStatus = Expect<Equal<ReturnType<typeof $destructuredStatus.get>, 'draft' | 'started' | undefined>>
type DocDollarDestructureNestedModel = Expect<Equal<ReturnType<typeof $destructuredInfo.titleCase>, string>>
type NestedDollarDestructureTagModel = Expect<Equal<ReturnType<typeof $destructuredTags[0]['label']>, string>>
type SubKeepsDocumentModel = Expect<Equal<AwaitedSub<typeof $subGame>, typeof $game>>
type UseSubKeepsDocumentModel = Expect<Equal<ReturnType<typeof useHookGame>, typeof $game>>
type ZodStructuralInference = Expect<Equal<ReturnType<typeof $zodGame.info.title.get>, string>>
type NestedPathModelMethod = Expect<Equal<ReturnType<typeof $game.info.titleCase>, string>>
type NestedArrayPathModelMethod = Expect<Equal<ReturnType<typeof $game.info.tags[0]['label']>, string>>
type ModelThisNestedString = Expect<Equal<ReturnType<GameModel['titleFromThis']>, string>>
type ModelThisNestedPathMethod = Expect<Equal<ReturnType<GameInfoModel['titleCase']>, string>>
type CollectionAddReturnsId = Expect<Equal<typeof collectionAddId, Promise<string>>>
type CollectionMethodChainAddReturnsId = Expect<Equal<typeof collectionMethodChainAddId, Promise<string>>>
type DocSetReturnsVoidPromise = Expect<Equal<typeof docSetResult, Promise<void>>>
type DocAssignReturnsVoidPromise = Expect<Equal<typeof docAssignResult, Promise<void>>>
type NestedAssignReturnsVoidPromise = Expect<Equal<typeof nestedAssignResult, Promise<void>>>
type NestedPopReturnsItem = Expect<Equal<PromiseValue<typeof poppedTag>, string | undefined>>
type NestedShiftReturnsItem = Expect<Equal<PromiseValue<typeof shiftedTag>, string | undefined>>
type NestedArrayPushParameter = Expect<Equal<Parameters<typeof $game.info.tags.push>[0], string>>
type NestedArrayPopReturn = Expect<Equal<PromiseValue<ReturnType<typeof $game.info.tags.pop>>, string | undefined>>
type CollectionArrayMutatorBlocked = Expect<Equal<NonNullable<typeof $games.push>, never>>
type NestedArrayMapLabels = Expect<Equal<typeof nestedTagLabels[number], string>>
type NestedArrayReduceItem = Expect<Equal<ReturnType<typeof nestedReducedTag.get>, string>>
type BatchKeepsCallbackReturn = Expect<Equal<typeof batchTitle, string>>
type SignalMetadataMethods = Expect<Equal<
[
  typeof signalPath,
  typeof signalLeaf,
  typeof signalPrimitivePath,
  typeof signalToStringValue,
  typeof signalToStringTag,
  typeof signalId,
  typeof signalCollection,
  typeof signalAssociations
],
[
  string,
  string,
  string,
  string,
  string,
  string | number,
  string,
  readonly unknown[]
]
>>
type NullableSchemaInference = Expect<Equal<FromJsonSchema<typeof nullableSchema>, string | null>>
type NullableObjectSchemaInference = Expect<Equal<FromJsonSchema<typeof nullableObjectSchema>, { name: string, score?: number | null } | null>>
type SimplifiedKeywordFieldSchemaInference = Expect<Equal<FromJsonSchema<typeof simplifiedKeywordFieldSchema>, {
  title: string
  description?: string
  type?: string
  required?: boolean
  enum?: string
  const?: number
  properties?: {
    color: string
  }
  name?: string
}>>
type TupleSchemaInference = Expect<Equal<FromJsonSchema<typeof tupleSchema>, readonly [string, number, boolean]>>
type DefinedSchemaInference = Expect<Equal<FromJsonSchema<typeof definedSchema>, {
  status?: 'draft' | 'published'
  score: number
}>>

const $queryGames = sub($.games, { status: 'draft' })
sub($.games, { 'info.maxPlayers': { $gte: 2 }, 'info.title': { $regex: /chess/i } })
sub($.games, { $sort: { 'info.maxPlayers': -1 } })
function useHookQueryGames () {
  return useSub($.games, { status: 'draft' })
}
function useHookQueryByTitle () {
  return useSub($.games, { 'info.title': 'Chess' })
}
// @ts-expect-error collection query params must be an object
sub($.games, 'draft')
// @ts-expect-error query params should reject misspelled schema fields
sub($.games, { stauts: 'draft' })
// @ts-expect-error query params should reject wrong schema value types
sub($.games, { 'info.maxPlayers': 'two' })
// @ts-expect-error query operators should follow the field value type
sub($.games, { status: { $in: ['draft', 'archived'] } })
const _activeGames = aggregation('games', ({ active }: { active: boolean }) => [{ $match: { active } }])
const $aggregationGames = sub(_activeGames, { active: true })
const _typedActiveGames = aggregation<Game[]>(({ active }: { active: boolean }) => [{ $match: { active } }])
const $typedAggregationGames = sub(_typedActiveGames, { active: true })
const _headerActiveGames = __aggregationHeader<Game[]>({ collection: 'games', name: '_active' })
const $headerAggregationGames = sub(_headerActiveGames, { active: true })
interface AggregationSessionShape {
  userId?: string
  role: 'admin' | 'member'
}
const _secondGenericSessionGames = aggregation<Game[], AggregationSessionShape>((_params, { session }) => {
  const role = session.role
  return [{ $match: { role } }]
})
const _thirdGenericSessionGames = aggregation<Game[], 'games', AggregationSessionShape>((_params, { collection, session }) => {
  const gamesCollection = collection
  const role = session.role
  return [{ $match: { collection: gamesCollection, role } }]
})
const _headerSessionGames = __aggregationHeader<Game[], AggregationSessionShape>({ collection: 'games', name: '_active' })
const _clientSecondGenericSessionGames = aggregation<Game[], AggregationSessionShape>('games', (_params, { session }) => {
  const role = session.role
  return [{ $match: { role } }]
})
const _notificationStats = aggregation<{ total: number, currentDay: number, unread: number }>('games', () => [])
const $notificationStats = sub(_notificationStats, {})
const _roleCountRows = aggregation<RoleCount[]>('games', () => [])
const $roleCountRows = sub(_roleCountRows, {})
const _roleCounts = null as unknown as TypedAggregationInput<RoleCount, typeof RoleCountModel>
const $roleCounts = sub(_roleCounts, { active: true })
function useHookAggregationGames () {
  return useSub(_activeGames, { active: true })
}
const $hookQueryGame = (null as unknown as ReturnType<typeof useHookQueryGames>)[0]
const $aggregationGame = (null as unknown as AggregationGames)[0]
const $typedAggregationGame = (null as unknown as TypedAggregationGames)[0]
const $hookAggregationGame = (null as unknown as ReturnType<typeof useHookAggregationGames>)[0]

type QueryGames = AwaitedSub<typeof $queryGames>
type AggregationGames = AwaitedSub<typeof $aggregationGames>
type TypedAggregationGames = AwaitedSub<typeof $typedAggregationGames>
type HeaderAggregationGames = AwaitedSub<typeof $headerAggregationGames>
type NotificationStats = AwaitedSub<typeof $notificationStats>
type RoleCountRows = AwaitedSub<typeof $roleCountRows>
type RoleCounts = AwaitedSub<typeof $roleCounts>
type QueryGameItem = QueryGames extends Iterable<infer Item> ? Item : never
const $roleCount = (null as unknown as RoleCounts)[0]
const $roleCountRow = (null as unknown as RoleCountRows)[0]
type QuerySignalType = Expect<Equal<QueryGames, CollectionQuerySignal<Game, typeof GamesModel, typeof GameModel, readonly ['games']>>>
type QueryIndexDocumentModel = Expect<Equal<ReturnType<QueryGames[0]['info']['title']['get']>, string>>
type QueryIteratorDocumentModel = Expect<Equal<ReturnType<QueryGameItem['info']['title']['get']>, string>>
type HookQueryIndexDocumentModel = Expect<Equal<ReturnType<typeof $hookQueryGame.info.maxPlayers.get>, number>>
type AggregationIndexDocumentModel = Expect<Equal<ReturnType<typeof $aggregationGame.info.title.get>, string>>
type AggregationDocumentMethods = Expect<Equal<ReturnType<typeof $aggregationGame.start>, Promise<void>>>
type HookAggregationIndexDocumentModel = Expect<Equal<ReturnType<typeof $hookAggregationGame.info.maxPlayers.get>, number>>
type ExplicitAggregationIndexDocumentModel = Expect<Equal<ReturnType<typeof $typedAggregationGame.info.title.get>, string>>
type ExplicitAggregationDocumentMethods = Expect<Equal<ReturnType<typeof $typedAggregationGame.start>, Promise<void>>>
type HeaderAggregationIndexDocumentModel = Expect<Equal<ReturnType<HeaderAggregationGames[0]['info']['title']['get']>, string>>
type AggregationSecondGenericSession = Expect<Equal<typeof _secondGenericSessionGames['__teamplayAggregationSession'], AggregationSessionShape | undefined>>
type AggregationThirdGenericSession = Expect<Equal<typeof _thirdGenericSessionGames['__teamplayAggregationSession'], AggregationSessionShape | undefined>>
type HeaderAggregationSecondGenericSession = Expect<Equal<typeof _headerSessionGames['__teamplayAggregationSession'], AggregationSessionShape | undefined>>
type ClientAggregationSecondGenericSession = Expect<Equal<typeof _clientSecondGenericSessionGames['__teamplayAggregationSession'], AggregationSessionShape | undefined>>
type DefaultAggregationSessionUserId = Expect<Equal<DefaultAggregationSession['userId'], string | undefined>>
type AggregationStatsTotal = Expect<Equal<ReturnType<NotificationStats['total']['get']>, number>>
type AggregationStatsUnread = Expect<Equal<ReturnType<NotificationStats['unread']['get']>, number>>
type ExplicitAggregationRowsField = Expect<Equal<ReturnType<typeof $roleCountRow.count.get>, number>>
type QueryNestedPathModelMethod = Expect<Equal<ReturnType<typeof $hookQueryGame.info.titleCase>, string>>
type AggregationNestedPathModelMethod = Expect<Equal<ReturnType<typeof $aggregationGame.info.tags[0]['label']>, string>>
type TypedAggregationOutputField = Expect<Equal<ReturnType<typeof $roleCount.count.get>, number>>
type TypedAggregationOutputMethod = Expect<Equal<ReturnType<typeof $roleCount.label>, string>>
const gameAccess = accessControl<Game, { userId?: string }>({
  create ({ newDoc, session, type }) {
    const operation: 'create' = type
    void operation
    return Boolean(session.userId && newDoc.info.title)
  },
  read ({ doc }) {
    return doc.info.maxPlayers > 0
  },
  update: {
    fn ({ doc, newDoc, ops }) {
      return ops.length > 0 && doc.info.title !== newDoc.info.title
    }
  },
  delete ({ doc }) {
    return doc.status !== 'started'
  }
})
accessControl<Game, { userId?: string }, string>({
  read: 'admin'
})
accessControl<Game>({
  read ({ session }) {
    const userId = session.userId
    return Boolean(userId)
  },
  create ({ newDoc }) {
    // @ts-expect-error create access receives newDoc, not doc
    return Boolean(newDoc.info.title && newDoc.doc)
  }
})
accessControl<Game>({
  // @ts-expect-error accessControl only accepts create/read/update/delete rules
  publish: true
})
type AccessCreateRule = Extract<Exclude<typeof gameAccess.create, boolean | undefined>, (context: any) => any>
type AccessCreateContext = AccessCreateRule extends (context: infer Context) => any ? Context : never
type AccessReadRule = Extract<Exclude<typeof gameAccess.read, boolean | undefined>, (context: any) => any>
type AccessReadContext = AccessReadRule extends (context: infer Context) => any ? Context : never
type AccessUpdateRule = Extract<Exclude<typeof gameAccess.update, boolean | undefined>, { fn: (context: any) => any }>
type AccessUpdateContext = AccessUpdateRule extends { fn: (context: infer Context) => any } ? Context : never
type AccessDeleteRule = Extract<Exclude<typeof gameAccess.delete, boolean | undefined>, (context: any) => any>
type AccessDeleteContext = AccessDeleteRule extends (context: infer Context) => any ? Context : never
type AccessCreateDoc = Expect<Equal<AccessCreateContext['newDoc'], Game>>
type AccessCreateSession = Expect<Equal<AccessCreateContext['session'], { userId?: string }>>
type AccessReadDoc = Expect<Equal<AccessReadContext['doc'], Game>>
type AccessUpdateOps = Expect<Equal<AccessUpdateContext['ops'], unknown[]>>
type AccessDeleteDoc = Expect<Equal<AccessDeleteContext['doc'], Game>>
type ExportedAccessContextDoc = Expect<Equal<ExportedAccessCreateContext<Game>['newDoc'], Game>>
type AccessDefaultSessionUserId = Expect<Equal<ExportedAccessCreateContext<Game>['session']['userId'], string | undefined>>
declare const $resolvedQueryGames: QueryGames
declare const $plainQuerySignal: QuerySignal
const $firstQueryGame = $resolvedQueryGames.reduce(($firstGame, $secondGame) => $firstGame)
const $resolvedOpenQueryGames = $resolvedQueryGames.findOpenGames()
const $plainQueryIds = $plainQuerySignal.ids
const $plainQueryExtra = $plainQuerySignal.extra
const $resolvedQueryIds = $resolvedQueryGames.ids
const $resolvedQueryExtra = $resolvedQueryGames.extra
// @ts-expect-error query signals are array-readable but not array-mutable at the top level
$resolvedQueryGames.push({
  info: {
    title: 'Queried Mutator Go',
    maxPlayers: 2
  }
})
// @ts-expect-error aggregation signals are array-readable but not array-mutable at the top level
$aggregationGames.push({
  info: {
    title: 'Aggregated Mutator Go',
    maxPlayers: 2
  }
})
const $hookOpenQueryGames = (null as unknown as ReturnType<typeof useHookQueryGames>).findOpenGames()
const resolvedOpenQueryAddId = $resolvedOpenQueryGames.add({
  info: {
    title: 'Queried Go',
    maxPlayers: 2
  }
})
const hookOpenQueryAddId = $hookOpenQueryGames.add({
  info: {
    title: 'Hook Queried Go',
    maxPlayers: 2
  }
})
type QueryArrayReduceNoInitial = Expect<Equal<ReturnType<typeof $firstQueryGame.info.title.get>, string>>
type QueryCollectionModelMethod = Expect<Equal<HasFindOpenGames<QueryGames>, true>>
type QueryCollectionAdd = Expect<Equal<typeof resolvedOpenQueryAddId, Promise<string>>>
type QueryIdsSignal = Expect<Equal<ReturnType<typeof $plainQueryIds.get>, Array<string | number>>>
type QueryExtraSignal = Expect<Equal<ReturnType<typeof $plainQueryExtra.get>, unknown>>
type CollectionQueryIdsSignal = Expect<Equal<ReturnType<typeof $resolvedQueryIds.get>, Array<string | number>>>
type CollectionQueryExtraSignal = Expect<Extends<typeof $resolvedQueryExtra, { get: () => unknown }>>
type QueryArrayMutatorBlocked = Expect<Equal<NonNullable<QueryGames['push']>, never>>
type AggregationArrayMutatorBlocked = Expect<Equal<NonNullable<AggregationGames['push']>, never>>
type HookQueryCollectionModelMethod = Expect<Equal<typeof hookOpenQueryAddId, Promise<string>>>

async function queryLoopAssertions () {
  const $draftGames = await sub($.games, { status: 'draft' })
  const titles = $draftGames.map($draftGame => $draftGame.info.title.get())
  const destructuredTitles = $draftGames.map(({ $info }) => $info.$title.get())
  const maxPlayersTotal = $draftGames.reduce((total, $draftGame) => {
    $draftGame.info.maxPlayers.increment()
    return total + $draftGame.info.maxPlayers.get()
  }, 0)
  const $foundGame = $draftGames.find($draftGame => $draftGame.info.maxPlayers.get() > 1)
  let loopTitle = ''
  let poppedTag: string | undefined
  let assignResult: void | undefined

  for (const $draftGame of $draftGames) {
    await $draftGame.start()
    assignResult = await $draftGame.assign({ status: 'started' })
    await $draftGame.info.assign({ title: $draftGame.titleFromThis() })
    await $draftGame.info.tags.push('ranked')
    poppedTag = await $draftGame.info.tags.pop()
    loopTitle = $draftGame.info.title.get()
    $draftGame.info.tags[0].label()
  }

  return {
    loopTitle,
    destructuredTitle: destructuredTitles[0],
    poppedTag,
    assignResult,
    tagLabels: $draftGames.map($draftGame => $draftGame.info.tags[0].label()),
    maxPlayersTotal,
    foundTitle: $foundGame?.info.title.get()
  }
}

async function aggregationLoopAssertions () {
  const $activeGames = await sub(_activeGames, { active: true })
  let loopTitle = ''
  let destructuredTitle = ''
  let poppedTag: string | undefined

  for (const $activeGame of $activeGames) {
    const { $info } = $activeGame
    await $activeGame.start()
    await $activeGame.info.tags.unshift('featured')
    poppedTag = await $activeGame.info.tags.shift()
    loopTitle = $activeGame.titleFromThis()
    destructuredTitle = $info.$title.get()
  }

  return {
    loopTitle,
    destructuredTitle,
    poppedTag,
    tagLabels: $activeGames.map($activeGame => $activeGame.info.tags[0].label())
  }
}

function useHookSignalChainAssertions () {
  const $hookDraftGames = useSub($.games, { status: 'draft' })
  const hookQueryTitles = $hookDraftGames.map($hookDraftGame => $hookDraftGame.info.title.get())
  const $hookActiveGames = useSub(_activeGames, { active: true })
  const hookAggregationTitle = $hookActiveGames.reduce(($firstGame, $secondGame) => $firstGame).titleFromThis()

  return {
    hookQueryTitles,
    hookAggregationTitle
  }
}

type QueryLoopResult = Awaited<ReturnType<typeof queryLoopAssertions>>
type AggregationLoopResult = Awaited<ReturnType<typeof aggregationLoopAssertions>>
type HookSignalChainResult = ReturnType<typeof useHookSignalChainAssertions>
type QueryLoopTitle = Expect<Equal<QueryLoopResult['loopTitle'], string>>
type QueryLoopDollarDestructureTitle = Expect<Equal<QueryLoopResult['destructuredTitle'], string>>
type QueryLoopPoppedTag = Expect<Equal<QueryLoopResult['poppedTag'], string | undefined>>
type QueryLoopAssignResult = Expect<Equal<QueryLoopResult['assignResult'], void | undefined>>
type QueryLoopTagLabels = Expect<Equal<QueryLoopResult['tagLabels'][number], string>>
type QueryLoopMaxPlayersTotal = Expect<Equal<QueryLoopResult['maxPlayersTotal'], number>>
type QueryLoopFoundTitle = Expect<Equal<QueryLoopResult['foundTitle'], string | undefined>>
type AggregationLoopTitle = Expect<Equal<AggregationLoopResult['loopTitle'], string>>
type AggregationLoopDollarDestructureTitle = Expect<Equal<AggregationLoopResult['destructuredTitle'], string>>
type AggregationLoopPoppedTag = Expect<Equal<AggregationLoopResult['poppedTag'], string | undefined>>
type AggregationLoopTagLabels = Expect<Equal<AggregationLoopResult['tagLabels'][number], string>>
type HookQueryMapTitle = Expect<Equal<HookSignalChainResult['hookQueryTitles'][number], string>>
type HookAggregationReduceTitle = Expect<Equal<HookSignalChainResult['hookAggregationTitle'], string>>

const $score = $(0)
$score.increment()
// @ts-expect-error primitive local signals should not expose arbitrary child paths
void $score.nope

interface NewEventDoc {
  title: string
  active?: boolean
}

const $explicitBoolean = $<boolean>()
const $explicitEvent = $<NewEventDoc>()
const $signalAliasBoolean: Signal<boolean> = $<boolean>()
const $signalAliasEvent: Signal<NewEventDoc> = $<NewEventDoc>()
const $signalAliasGame: Signal<Game> = $.games[gameId]
const $signalAliasGames: Signal<Game[]> = $.games
const $ambiguousSharedDoc = null as unknown as Signal<SharedDocShape>
const $ambiguousSharedDocs = null as unknown as Signal<SharedDocShape[]>
const signalAliasGameTitles = $signalAliasGames.map($game => $game.titleFromThis())
const collectionSignalGameTitles = $.games.map($game => $game.titleFromThis())
const ambiguousSharedNames = $ambiguousSharedDocs.map($doc => $doc.name.get())
const $signalAliasOpenGames = $signalAliasGames.findOpenGames()
const signalAliasOpenGameAddId = $signalAliasOpenGames.add({
  info: {
    title: 'Signal Alias Go',
    maxPlayers: 2
  }
})
$explicitBoolean.set(true)
$explicitEvent.assign({ title: 'Launch' })
// @ts-expect-error ambiguous document shapes should not guess a document model
$ambiguousSharedDoc.onlyOnSharedDocA()
// @ts-expect-error ambiguous document arrays should not guess a collection model
$ambiguousSharedDocs.onlyOnSharedA()
// @ts-expect-error explicit generic no-arg local signals should keep the requested primitive type
$explicitBoolean.set('true')
// @ts-expect-error explicit generic no-arg local signals should keep object field types
$explicitEvent.assign({ title: 1 })

const $scoreboard = $({
  players: [{ name: 'Robot 1', robot: true }],
  totalPlayers: 0,
  round: 0
})
$scoreboard.players[0].name.set('Robot 2')
$scoreboard.players[0].robot.set(false)
$scoreboard.totalPlayers.increment()
const localPlayerNames = $scoreboard.players.map($player => $player.name.get())
const localPlayerNamesWithThisArg = $scoreboard.players.map($player => $player.name.get(), { prefix: '#' })
const localFirstPlayerFromReduce = $scoreboard.players.reduce(($firstPlayer, $secondPlayer) => $firstPlayer)
const foundLocalPlayer = $scoreboard.players.find($player => $player.robot.get())
const foundLocalPlayerWithThisArg = $scoreboard.players.find($player => $player.robot.get(), { robot: true })
const {
  $score: $destructuredLocalScore,
  $title: $destructuredLocalTitle
} = $({ score: 0, title: 'New Game' })
$destructuredLocalScore.increment()
$destructuredLocalTitle.stringInsert(0, 'Draft: ')

const $localTournament = $({
  teams: [{
    name: 'Blue',
    players: [{
      name: 'Ada',
      score: 0,
      inventory: ['map']
    }]
  }],
  meta: {
    round: 1,
    started: false
  }
})
const localComplexPopPlayer = $localTournament.teams[0].players.pop()
const localComplexShiftPlayer = $localTournament.teams[0].players.shift()
$localTournament.teams[0].players.push({
  name: 'Grace',
  score: 1,
  inventory: ['shield']
})
$localTournament.teams[0].players[0].score.increment(2)
$localTournament.teams[0].players[0].assign({ score: 3 })
const localComplexInventoryPop = $localTournament.teams[0].players[0].inventory.pop()
const localComplexMappedInventory = $localTournament.teams[0].players[0].inventory.map($item => $item.get().toUpperCase())
const localComplexFoundPlayer = $localTournament.teams[0].players.find($player => $player.inventory[0].get() === 'map')
// @ts-expect-error local array item pushes should follow the inferred item shape
$localTournament.teams[0].players.push({ name: 'Bad', inventory: ['missing score'] })
// @ts-expect-error local nested assign should follow the inferred field types
$localTournament.teams[0].players[0].assign({ score: 'high' })

const $computedScoreboard = $(() => ({
  nextRound: $scoreboard.round.get() + 1,
  firstPlayerName: $scoreboard.players[0].name.get(),
  tournament: {
    leaderName: $localTournament.teams[0].players[0].name.get(),
    nextRound: $localTournament.meta.round.get() + 1
  }
}))

type LocalPrimitive = Expect<Equal<ReturnType<typeof $score.get>, number>>
type LocalExplicitBoolean = Expect<Equal<ReturnType<typeof $explicitBoolean.get>, boolean>>
type LocalExplicitBooleanSignal = Expect<Equal<typeof $explicitBoolean, TypedSignal<boolean>>>
type LocalExplicitEventTitle = Expect<Equal<ReturnType<typeof $explicitEvent.title.get>, string>>
type LocalSignalAliasBoolean = Expect<Equal<ReturnType<typeof $signalAliasBoolean.get>, boolean>>
type LocalSignalAliasEventTitle = Expect<Equal<ReturnType<typeof $signalAliasEvent.title.get>, string>>
type SignalAliasDocumentModelMethod = Expect<Equal<ReturnType<typeof $signalAliasGame.titleFromThis>, string>>
type SignalAliasArrayMapDocumentModel = Expect<Equal<typeof signalAliasGameTitles[number], string>>
type CollectionSignalArrayMapDocumentModel = Expect<Equal<typeof collectionSignalGameTitles[number], string>>
type SignalAliasArrayCollectionModelMethod = Expect<Equal<HasFindOpenGames<typeof $signalAliasGames>, true>>
type SignalAliasArrayCollectionAdd = Expect<Equal<typeof signalAliasOpenGameAddId, Promise<string>>>
type SignalAliasNestedPathModelMethod = Expect<Equal<ReturnType<typeof $signalAliasGame.info.titleCase>, string>>
type AmbiguousDocumentFallbackField = Expect<Equal<ReturnType<typeof $ambiguousSharedDoc.name.get>, string>>
type AmbiguousArrayFallbackItem = Expect<Equal<typeof ambiguousSharedNames[number], string>>
type LocalDollarPrimitive = Expect<Equal<ReturnType<typeof $destructuredLocalScore.get>, number>>
type LocalDollarString = Expect<Equal<ReturnType<typeof $destructuredLocalTitle.get>, string>>
const $localPlayer = $scoreboard.players[0]
type LocalNestedString = Expect<Equal<ReturnType<typeof $localPlayer.name.get>, string>>
type LocalNestedBoolean = Expect<Equal<ReturnType<typeof $localPlayer.robot.get>, boolean>>
type LocalPlayerIteratorItem = typeof $scoreboard.players extends Iterable<infer Item> ? Item : never
type LocalArrayMapItem = Expect<Equal<typeof localPlayerNames[number], string>>
type LocalArrayMapThisArg = Expect<Equal<typeof localPlayerNamesWithThisArg[number], string>>
type LocalArrayReduceNoInitial = Expect<Equal<ReturnType<typeof localFirstPlayerFromReduce.name.get>, string>>
type LocalArrayIteratorItem = Expect<Equal<ReturnType<LocalPlayerIteratorItem['name']['get']>, string>>
type LocalArrayFindItem = Expect<Equal<ReturnType<NonNullable<typeof foundLocalPlayer>['robot']['get']>, boolean>>
type LocalArrayFindThisArg = Expect<Equal<ReturnType<NonNullable<typeof foundLocalPlayerWithThisArg>['robot']['get']>, boolean>>
type LocalComplexPopPlayer = Expect<Equal<PromiseValue<typeof localComplexPopPlayer>, { name: string, score: number, inventory: string[] } | undefined>>
type LocalComplexShiftPlayer = Expect<Equal<PromiseValue<typeof localComplexShiftPlayer>, { name: string, score: number, inventory: string[] } | undefined>>
type LocalComplexInventoryPop = Expect<Equal<PromiseValue<typeof localComplexInventoryPop>, string | undefined>>
type LocalComplexMappedInventory = Expect<Equal<typeof localComplexMappedInventory[number], string>>
type LocalComplexFoundInventory = Expect<Equal<ReturnType<NonNullable<typeof localComplexFoundPlayer>['inventory'][0]['get']>, string>>
type ComputedNumber = Expect<Equal<ReturnType<typeof $computedScoreboard.nextRound.get>, number>>
type ComputedString = Expect<Equal<ReturnType<typeof $computedScoreboard.firstPlayerName.get>, string>>
type ComputedNestedPlayerName = Expect<Equal<ReturnType<typeof $computedScoreboard.tournament.leaderName.get>, string>>
const { $tournament: $computedTournament } = $computedScoreboard
type ComputedDollarDestructure = Expect<Equal<ReturnType<typeof $computedTournament.$leaderName.get>, string>>

function printGameTitles ($games: Signal<Game[]>) {
  const titles = $games.map($game => $game.titleFromThis())
  let loopTitle = ''

  for (const $game of $games) {
    $game.start()
    loopTitle = $game.titleFromThis()
  }

  return {
    titles,
    loopTitle,
    firstTitle: $games[0].titleFromThis()
  }
}

async function printQueriedGameTitles () {
  const $draftGames = await sub($.games, { status: 'draft' })
  return printGameTitles($draftGames)
}

type PrintGameTitlesResult = ReturnType<typeof printGameTitles>
type PrintQueriedGameTitlesResult = Awaited<ReturnType<typeof printQueriedGameTitles>>
type SignalAliasArrayIteratorDocumentModel = Expect<Equal<PrintGameTitlesResult['loopTitle'], string>>
type QueryResultAcceptedAsSignalArray = Expect<Equal<PrintQueriedGameTitlesResult['firstTitle'], string>>

declare const typeAssertions: TypeAssertions
void typeAssertions
