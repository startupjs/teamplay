import * as React from 'react'
import $, {
  Signal,
  aggregation,
  defineSchema,
  getConnection,
  getRootSignal,
  getSubscriptionGcDelay,
  observer,
  setSubscriptionGcDelay,
  sub,
  useApi,
  useDidUpdate,
  useId,
  useNow,
  useOnce,
  useScheduleUpdate,
  useSub,
  useSyncEffect,
  useSuspendMemo,
  useTriggerUpdate,
  type FromJsonSchema,
  type JsonSchemaSpec,
  type JoinPath,
  type RuntimeSignalInstance,
  type SignalBaseInstance,
  type SignalModelConstructor,
  type TeamplayConnection,
  type TeamplayShareDoc,
  type RootSignal
} from 'teamplay'
import BaseModel, { defineModels, initModels, type ModelManifest } from 'teamplay/orm'

type Assert<T extends true> = T
type IsEqual<TActual, TExpected> =
  (<T>() => T extends TActual ? 1 : 2) extends
  (<T>() => T extends TExpected ? 1 : 2) ? true : false

const userSchema = defineSchema({
  name: { type: 'string', required: true },
  age: { type: 'number' }
})

type UserDoc = FromJsonSchema<typeof userSchema>
type _schemaInference = Assert<IsEqual<UserDoc, { name: string, age?: number }>>
type _pathPatternJoin = Assert<IsEqual<JoinPath<readonly ['users', '*', 'tags', number]>, 'users.*.tags.*'>>

class Users extends BaseModel<UserDoc[]> {}
class User extends Signal<UserDoc> {}
const userModelConstructor: SignalModelConstructor<UserDoc> = User

declare module 'teamplay' {
  interface TeamplayCollections {
    users: JsonSchemaSpec<typeof userSchema, typeof Users, typeof User>
  }
}

const models = defineModels({
  users: { default: Users, schema: userSchema },
  'users.*': { default: User }
})

const manifest: ModelManifest = models
initModels(manifest)

const root: RootSignal = $
const scopedRoot = getRootSignal()
const $user = scopedRoot.users.user1
const typedUserSignal: Signal<UserDoc> = $user
const runtimeSignal: RuntimeSignalInstance<UserDoc> = typedUserSignal
const baseSignal: SignalBaseInstance<UserDoc> = runtimeSignal

const maybeSubscribedUser = sub(typedUserSignal)
type _subResult = Assert<IsEqual<typeof maybeSubscribedUser, Signal<UserDoc> | Promise<Signal<UserDoc>>>>

const userStats = aggregation<{ total: number }>(() => [])
const $stats = sub(userStats)
type _aggregationResult = Assert<IsEqual<typeof $stats, Signal<{ total: number }> | Promise<Signal<{ total: number }>>>>

const ObservedUser = observer(({ name }: { name: string }) => React.createElement('span', null, name))
React.createElement(ObservedUser, { name: 'Ada' })
// @ts-expect-error name is required by the observed component props.
React.createElement(ObservedUser, {})

const gcDelay: number = getSubscriptionGcDelay()
const nextGcDelay: number = setSubscriptionGcDelay(gcDelay)
const activeConnection: TeamplayConnection = getConnection()
const maybeDoc: TeamplayShareDoc | undefined = activeConnection.collections?.users?.user1
const fetchedDoc: TeamplayShareDoc = activeConnection.get('users', 'user1')

function ExternalConsumerComponent () {
  const maybeHookUser = useSub(typedUserSignal)
  type _useSubResult = Assert<IsEqual<typeof maybeHookUser, Signal<UserDoc>>>

  const maybeHookUserWithOptions = useSub(typedUserSignal, { defer: false })
  type _useSubOptionsResult = Assert<IsEqual<typeof maybeHookUserWithOptions, Signal<UserDoc>>>

  const [apiCount, apiLoading, apiError] = useApi(async (userId: string) => userId.length, 'user1', { debounce: 5 })
  const countValue: number | undefined = apiCount
  const loadingValue: boolean = apiLoading
  const errorValue: unknown = apiError

  const memoValue = useSuspendMemo(() => ({ id: 'memo-id' }), [])
  const memoId: string = memoValue.id
  const componentId: string = useId()
  const createdAt: number = useNow()
  const triggerUpdate: () => void = useTriggerUpdate()
  const scheduleUpdate: (promise: PromiseLike<unknown>) => void = useScheduleUpdate()
  useDidUpdate(() => undefined, [])
  useOnce(true, () => undefined)
  useSyncEffect(() => undefined, [])

  root.batch(() => [
    countValue,
    loadingValue,
    errorValue,
    memoId,
    componentId,
    createdAt,
    triggerUpdate,
    scheduleUpdate(Promise.resolve()),
    maybeDoc,
    fetchedDoc,
    nextGcDelay
  ])

  return React.createElement(ObservedUser, { name: 'Ada' })
}

React.createElement(ExternalConsumerComponent)
