import { Signal } from 'teamplay'

export interface CommentDoc {
  message: string
}

export default class EventComment extends Signal<CommentDoc> {
  preview () {
    return this.message.get().slice(0, 10)
  }
}
