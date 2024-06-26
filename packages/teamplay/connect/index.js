import Socket from '@teamplay/channel'
import Connection from './sharedbConnection.cjs'
import { connection, setConnection } from '../orm/connection.js'

export default function connect (options) {
  if (connection) return
  const socket = new Socket(options)
  setConnection(new Connection(socket))
}
