import { isCompatEnv } from './compatEnv.js'

export interface TeamplayShareDoc {
  data?: unknown
  fetch?: (callback?: (error?: unknown) => void) => void
  subscribe?: (callback?: (error?: unknown) => void) => void
  unsubscribe?: (callback?: (error?: unknown) => void) => void
  destroy?: () => void
  create?: (...args: unknown[]) => unknown
  del?: (...args: unknown[]) => unknown
  submitOp?: (...args: unknown[]) => unknown
}

export interface TeamplayConnection {
  collections?: Record<string, Record<string, TeamplayShareDoc>>
  get: (collection: string, docId: string) => TeamplayShareDoc
  createFetchQuery?: (...args: unknown[]) => unknown
  createSubscribeQuery?: (...args: unknown[]) => unknown
  [key: string]: unknown
}

export let connection: TeamplayConnection | undefined
let defaultFetchOnly: boolean | undefined
export let publicOnly: boolean | undefined

export function setConnection (_connection: TeamplayConnection | undefined): void {
  connection = _connection
}

export function getConnection (): TeamplayConnection {
  if (!connection) throw Error(ERRORS.notSet)
  return connection
}

export function setDefaultFetchOnly (_fetchOnly: boolean): void {
  defaultFetchOnly = !!_fetchOnly
}

export function getDefaultFetchOnly (): boolean {
  return !!defaultFetchOnly
}

// Deprecated alias kept for internal transition.
export function setFetchOnly (_fetchOnly: boolean): void {
  setDefaultFetchOnly(_fetchOnly)
}

export function setPublicOnly (_publicOnly: boolean): void {
  publicOnly = _publicOnly
}

export function isPrivateMutationForbidden (): boolean {
  return !!publicOnly && !isCompatEnv()
}

const ERRORS = {
  notSet: `
    Connection is not set.
    You must set the initialized ShareDB connection before using subscriptions.
    You've probably forgotten to call connect() in your app:

    import connect from 'teamplay/connect'
    connect({ baseUrl: 'http://localhost:3000' })
  `
}
