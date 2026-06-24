import { aggregation } from 'teamplay'
import type Event from './schema.ts'

interface EventSession {
  userId?: string
  role?: 'admin' | 'member'
}

export default aggregation<Event[], EventSession>(function activeEvents ({ active = true }: { active?: boolean }, { session }) {
  return [{
    $match: {
      active,
      ...(session.role === 'admin' ? {} : { createdBy: session.userId })
    }
  }]
})
