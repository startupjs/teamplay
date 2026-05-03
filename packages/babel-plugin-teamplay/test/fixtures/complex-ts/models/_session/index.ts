import { Signal } from 'teamplay'

interface SessionState {
  currentConnection?: string
}

export default class SessionModel extends Signal<SessionState> {
  hasConnection () {
    return Boolean(this.currentConnection.get())
  }
}
