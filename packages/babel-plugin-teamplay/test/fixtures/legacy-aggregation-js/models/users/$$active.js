import { aggregation } from 'teamplay'

export default aggregation(function activeUsers () {
  return [{ $match: { active: true } }]
})
