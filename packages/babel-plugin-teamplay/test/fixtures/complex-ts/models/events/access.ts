import { accessControl } from 'teamplay'
import type Event from './schema.ts'

export default accessControl<Event, { userId?: string }>({
  create ({ newDoc, session }) {
    return Boolean(session?.userId && newDoc.title)
  },
  read: true,
  update ({ doc, newDoc }) {
    return doc.title !== newDoc.title
  },
  delete: false
})
