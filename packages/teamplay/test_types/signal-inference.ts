import {
  $,
  Signal,
  addModel,
  aggregation,
  sub,
  useSub,
  type FromJsonSchema,
  type JsonSchemaSpec,
  type QuerySignal,
  type ZodSchemaSpec
} from 'teamplay'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? true
    : false

type Expect<T extends true> = T
type AwaitedSub<T> = T extends Promise<infer Value> ? Value : T
type TypeAssertions = [
  GameSchemaInference,
  TitleValue,
  MaxPlayersValue,
  StatusValue,
  SubKeepsDocumentModel,
  UseSubKeepsDocumentModel,
  ZodStructuralInference,
  QuerySignalType,
  QueryIndexDocumentModel,
  QueryIteratorDocumentModel,
  HookQueryIndexDocumentModel,
  AggregationIndexDocumentModel,
  AggregationDocumentMethods,
  HookAggregationIndexDocumentModel,
  LocalPrimitive,
  LocalNestedString,
  LocalNestedBoolean,
  ComputedNumber,
  ComputedString
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

addModel('games.*', GameModel)

interface ZodLikeGame {
  _output?: {
    info: {
      title: string
      maxPlayers: number
    }
  }
}

declare module 'teamplay' {
  interface TeamplayCollections {
    games: JsonSchemaSpec<typeof gameSchema, typeof GamesModel, typeof GameModel>
    zodGames: ZodSchemaSpec<ZodLikeGame, typeof GamesModel, typeof GameModel>
  }
}

declare const gameId: string

const $games = $.games
$games.findOpenGames()
$games.add({
  info: {
    title: 'Chess',
    maxPlayers: 2
  },
  status: 'draft'
})

const $game = $.games[gameId]
const $subGame = sub($game)
function useHookGame () {
  return useSub($game)
}
const $zodGame = $.zodGames[gameId]
$game.start()
$game.info.title.set('Chess')
$game.info.maxPlayers.increment()
$game.info.tags[0].set('board')

type GameSchemaInference = Expect<Equal<FromJsonSchema<typeof gameSchema>, Game>>
type TitleValue = Expect<Equal<ReturnType<typeof $game.info.title.get>, string>>
type MaxPlayersValue = Expect<Equal<ReturnType<typeof $game.info.maxPlayers.get>, number>>
type StatusValue = Expect<Equal<ReturnType<typeof $game.status.get>, 'draft' | 'started' | undefined>>
type SubKeepsDocumentModel = Expect<Equal<AwaitedSub<typeof $subGame>, typeof $game>>
type UseSubKeepsDocumentModel = Expect<Equal<ReturnType<typeof useHookGame>, typeof $game>>
type ZodStructuralInference = Expect<Equal<ReturnType<typeof $zodGame.info.title.get>, string>>

const $queryGames = sub($.games, { status: 'draft' })
function useHookQueryGames () {
  return useSub($.games, { status: 'draft' })
}
const $$activeGames = aggregation('games', ({ active }: { active: boolean }) => [{ $match: { active } }])
const $aggregationGames = sub($$activeGames, { active: true })
function useHookAggregationGames () {
  return useSub($$activeGames, { active: true })
}
const $hookQueryGame = (null as unknown as ReturnType<typeof useHookQueryGames>)[0]
const $aggregationGame = (null as unknown as AggregationGames)[0]
const $hookAggregationGame = (null as unknown as ReturnType<typeof useHookAggregationGames>)[0]

type QueryGames = AwaitedSub<typeof $queryGames>
type AggregationGames = AwaitedSub<typeof $aggregationGames>
type QueryGameItem = QueryGames extends Iterable<infer Item> ? Item : never
type QuerySignalType = Expect<Equal<QueryGames, QuerySignal<Game, typeof GameModel>>>
type QueryIndexDocumentModel = Expect<Equal<ReturnType<QueryGames[0]['info']['title']['get']>, string>>
type QueryIteratorDocumentModel = Expect<Equal<ReturnType<QueryGameItem['info']['title']['get']>, string>>
type HookQueryIndexDocumentModel = Expect<Equal<ReturnType<typeof $hookQueryGame.info.maxPlayers.get>, number>>
type AggregationIndexDocumentModel = Expect<Equal<ReturnType<typeof $aggregationGame.info.title.get>, string>>
type AggregationDocumentMethods = Expect<Equal<ReturnType<typeof $aggregationGame.start>, Promise<void>>>
type HookAggregationIndexDocumentModel = Expect<Equal<ReturnType<typeof $hookAggregationGame.info.maxPlayers.get>, number>>

const $score = $(0)
$score.increment()

const $scoreboard = $({
  players: [{ name: 'Robot 1', robot: true }],
  totalPlayers: 0,
  round: 0
})
$scoreboard.players[0].name.set('Robot 2')
$scoreboard.players[0].robot.set(false)
$scoreboard.totalPlayers.increment()

const $computedScoreboard = $(() => ({
  nextRound: $scoreboard.round.get() + 1,
  firstPlayerName: $scoreboard.players[0].name.get()
}))

type LocalPrimitive = Expect<Equal<ReturnType<typeof $score.get>, number>>
const $localPlayer = $scoreboard.players[0]
type LocalNestedString = Expect<Equal<ReturnType<typeof $localPlayer.name.get>, string>>
type LocalNestedBoolean = Expect<Equal<ReturnType<typeof $localPlayer.robot.get>, boolean>>
type ComputedNumber = Expect<Equal<ReturnType<typeof $computedScoreboard.nextRound.get>, number>>
type ComputedString = Expect<Equal<ReturnType<typeof $computedScoreboard.firstPlayerName.get>, string>>

declare const typeAssertions: TypeAssertions
void typeAssertions
