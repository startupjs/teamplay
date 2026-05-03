import { Signal } from 'teamplay'
import type Event from './schema.ts'

export default class EventModel extends Signal<Event> {
  titleUpper () {
    return this.title.get().toUpperCase()
  }
}
