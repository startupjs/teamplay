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
/** @deprecated Root-scoped private data made the publicOnly write guard obsolete. */
export const publicOnly = false

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

/**
 * @deprecated No-op kept for compatibility with older server bootstrap code.
 * Private collections are root-scoped; server safety now relies on avoiding
 * writes to private collections through the global root.
 */
export function setPublicOnly (_publicOnly: boolean): void {
}

/** @deprecated publicOnly no longer blocks private writes. */
export function isPrivateMutationForbidden (): boolean {
  return false
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
