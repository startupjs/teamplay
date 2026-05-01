import { Signal } from 'teamplay'

interface SessionConnectionState {
  token?: string
}

export default class SessionConnectionModel extends Signal<SessionConnectionState> {
  isConnected () {
    return Boolean(this.token.get())
  }
}
