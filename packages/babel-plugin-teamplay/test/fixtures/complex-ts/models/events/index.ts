import { Signal } from 'teamplay'
import type Event from './schema.ts'

export default class EventsModel extends Signal<Event[]> {
  async addNew (event: Omit<Event, 'createdAt'>) {
    return await this.add({
      ...event,
      createdAt: Date.now()
    })
  }
}
