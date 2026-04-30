import { Signal } from 'teamplay'
import type { EventDoc } from './schema.ts'

export default class Event extends Signal<EventDoc> {
  titleUpper () {
    return this.title.get().toUpperCase()
  }
}
