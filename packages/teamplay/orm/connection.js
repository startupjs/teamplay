import { isCompatEnv } from './compatEnv.js'

export let connection
// Transitional note: this is the default fetchOnly mode used when a new root is
// created without an explicit fetchOnly option. Runtime behavior will move to
// RootContext ownership in follow-up commits.
export let fetchOnly
export let publicOnly

export function setConnection (_connection) {
  connection = _connection
}

export function getConnection () {
  if (!connection) throw Error(ERRORS.notSet)
  return connection
}

export function setFetchOnly (_fetchOnly) {
  fetchOnly = _fetchOnly
}

export function getDefaultFetchOnly () {
  return !!fetchOnly
}

export function setPublicOnly (_publicOnly) {
  publicOnly = _publicOnly
}

export function isPrivateMutationForbidden () {
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
