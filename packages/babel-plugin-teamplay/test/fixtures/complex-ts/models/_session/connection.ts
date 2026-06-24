import { Signal } from 'teamplay'

interface ConnectionState {
  token?: string
}

export default class SessionConnectionModel extends Signal<ConnectionState> {
  isConnected () {
    return Boolean(this.token.get())
  }
}
