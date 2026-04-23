// @ts-nocheck
import { isCompatEnv } from './compatEnv.js'

export let connection
let defaultFetchOnly
export let publicOnly

export function setConnection (_connection) {
  connection = _connection
}

export function getConnection () {
  if (!connection) throw Error(ERRORS.notSet)
  return connection
}

export function setDefaultFetchOnly (_fetchOnly) {
  defaultFetchOnly = !!_fetchOnly
}

export function getDefaultFetchOnly () {
  return !!defaultFetchOnly
}

// Deprecated alias kept for internal transition.
export function setFetchOnly (_fetchOnly) {
  setDefaultFetchOnly(_fetchOnly)
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
