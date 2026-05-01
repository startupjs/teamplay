import { Signal } from 'teamplay'

export interface EventComment {
  message: string
}

export default class EventCommentModel extends Signal<EventComment> {
  preview () {
    return this.message.get().slice(0, 10)
  }
}
