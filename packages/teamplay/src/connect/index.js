import Socket from '@teamplay/channel'
import Connection from './sharedbConnection.cjs'
import { connection, setConnection } from '../orm/connection.ts'
import { configureTeamplay } from '../config.ts'

export default function connect (options = {}) {
  const { idFields, ...socketOptions } = options || {}
  if (idFields !== undefined) configureTeamplay({ idFields })
  if (connection) return
  const socket = new Socket(socketOptions)
  setConnection(new Connection(socket))
}
