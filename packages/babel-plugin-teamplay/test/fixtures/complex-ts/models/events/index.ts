import { Signal } from 'teamplay'
import type { EventDoc } from './schema.ts'

export default class Events extends Signal<EventDoc[]> {
  async addNew (event: Omit<EventDoc, 'createdAt'>) {
    return await this.add({
      ...event,
      createdAt: Date.now()
    })
  }
}
